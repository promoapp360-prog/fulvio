import { and, eq, sql, desc } from "drizzle-orm";
import { db } from "../db";
import { appointments, appointmentEvents, appointmentPhotos, dogPhotos, dogs, operators, services, users, payments, customerConsents, boardingRequests, boardingEvents, type Appointment, type AppointmentStatus, type Dog } from "../../shared/schema";
import { assertSlotFree, operatorSlots, operatorCanDo, quote, compatibleOperators, compatibleOperatorsForServices, SlotError } from "./availability";
import { getSettings } from "./settings";
import { notifyUser, notifyStaff, pushUserNotification } from "./notify";
import { kickQueue } from "./email";
import { awardForAmount } from "./loyalty";
import { fmtRome, romeToDate, todayRome, addDays } from "../time";
import { withinDeadline } from "../logic";
import { euro } from "../../shared/constants";
import { STATUS_LABELS } from "../../shared/constants";
import { HttpError } from "../util";
import { recordConsent } from "./consents";
import type { Request } from "express";
import type { z } from "zod";
import { appointmentRequestSchema, bookingServiceIds, customerDogSchema } from "../../shared/customer-booking";
import { notifyAppointmentConfirmed } from "./appointment-mail";

export async function logEvent(tx: any, appointmentId: number, actorId: number | null, action: string, from: string | null, to: string | null, data: Record<string, unknown> = {}) {
  await tx.insert(appointmentEvents).values({ appointmentId, actorId, action, fromStatus: from, toStatus: to, data });
}

/** Richiesta di prenotazione del cliente: NON è mai una prenotazione definitiva. */
export async function quoteServices(serviceIds: number[], dog?: Pick<Dog, "size" | "coatKnots" | "coatShedding" | "aggressive"> & Partial<Pick<Dog, "species" | "coatType" | "coatLength">> | null, tx: any = db) {
  const catalog = await tx.select().from(services);
  let ids: number[];
  try { ids = bookingServiceIds(serviceIds, catalog, dog?.coatLength); }
  catch (error: any) { throw new HttpError(400, error.message); }
  if (!ids.length || ids.length > 10 || ids.length !== serviceIds.length) throw new HttpError(400, "Seleziona da uno a dieci servizi diversi");
  const quotes = await Promise.all(ids.map((serviceId) => quote(serviceId, dog, tx)));
  if (dog?.species && quotes.some((q) => q.service.species !== "entrambi" && q.service.species !== dog.species)) {
    throw new HttpError(400, "Uno dei servizi selezionati non è previsto per la specie dell’animale");
  }
  if (quotes.some((q) => !q.service.bookable || !q.service.visible)) throw new HttpError(400, "Uno dei servizi selezionati non è prenotabile online");
  const operators = await compatibleOperatorsForServices(ids, true, tx);
  if (!operators.length) throw new HttpError(409, "Nessun operatore è abilitato a tutti i servizi selezionati");
  return {
    serviceIds: ids,
    services: quotes.map((q) => q.service),
    servicePriceSnapshot: quotes.map((q) => q.priceSnapshot),
    durationMin: quotes.reduce((n, q) => n + q.durationMin, 0),
    estimatedPriceCents: quotes.some((q) => q.estimatedPriceCents == null) ? null : quotes.reduce((n, q) => n + (q.estimatedPriceCents || 0), 0),
    supplements: quotes.flatMap((q) => q.supplements),
    operators,
  };
}

export async function bookingAvailability(customerId: number, dogId: number, serviceIds: number[], date: string) {
  const [dog] = await db.select().from(dogs).where(and(eq(dogs.id, dogId), eq(dogs.ownerId, customerId), eq(dogs.archived, false)));
  if (!dog) throw new HttpError(404, "Cane non trovato");
  const qt = await quoteServices(serviceIds, { ...dog, coatKnots: false, coatShedding: false });
  const settings = await getSettings();
  const earliest = Date.now() + settings.booking.minNoticeHours * 3_600_000;
  const times = new Set<string>();
  if (date >= todayRome() && date <= addDays(todayRome(), settings.booking.maxDaysAhead)) {
    for (const op of qt.operators) for (const time of await operatorSlots(op.id, date, qt.durationMin)) {
      if (romeToDate(date, time).getTime() >= earliest) times.add(time);
    }
  }
  return { slots: [...times].sort(), durationMin: qt.durationMin, estimatedPriceCents: qt.estimatedPriceCents, serviceIds: qt.serviceIds };
}

export async function createRequest(customerId: number, input: z.infer<typeof appointmentRequestSchema> & { request?: Request }) {
  const [dog] = await db.select().from(dogs).where(and(eq(dogs.id, input.dogId), eq(dogs.ownerId, customerId), eq(dogs.archived, false)));
  if (!dog) throw new HttpError(404, "Cane non trovato");
  if (!customerDogSchema.safeParse(dog).success) throw new HttpError(422, "Completa i dati obbligatori della scheda cane nella tua area personale.");
  const [photo] = await db.select().from(dogPhotos).where(eq(dogPhotos.dogId, dog.id)).limit(1);
  if (!photo) throw new HttpError(422, "Aggiungi la foto nella scheda cane prima di prenotare.");
  const [cust] = await db.select().from(users).where(eq(users.id, customerId));
  if (!cust?.consentPrivacy) throw new HttpError(422, "Completa la registrazione e la presa visione dell’informativa prima di prenotare.");
  const [receipt] = await db.select().from(customerConsents)
    .where(and(eq(customerConsents.userId, customerId), eq(customerConsents.kind, "privacy"), eq(customerConsents.granted, true)))
    .orderBy(desc(customerConsents.id)).limit(1);
  const qt = await quoteServices(input.serviceIds, { ...dog, coatKnots: false, coatShedding: false });
  const s = await getSettings();
  const start = romeToDate(input.date, input.time);
  const [received] = await db.select().from(appointments).where(eq(appointments.requestKey, input.requestKey));
  if (received) {
    if (received.customerId !== customerId || received.dogId !== dog.id || received.startAt.getTime() !== start.getTime() ||
      JSON.stringify(received.requestedServiceIds) !== JSON.stringify(qt.serviceIds)) throw new HttpError(409, "Identificativo già usato per una richiesta diversa");
    return { ...received, duplicate: true };
  }
  if (start.getTime() < Date.now() + s.booking.minNoticeHours * 3600_000) throw new HttpError(409, "L’orario è troppo vicino: scegli un altro orario.");
  if (input.date > addDays(todayRome(), s.booking.maxDaysAhead)) throw new HttpError(400, "Data oltre il periodo prenotabile");
  if (input.boarding && !s.site.boardingEnabled) throw new HttpError(400, "Le richieste pensione non sono attive.");
  const candidates = qt.operators.map((op: any) => op.id);

  let lastErr: Error | null = null;
  for (const opId of candidates) {
    try {
      const app = await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`booking-dog:${dog.id}:${input.date}`}))`);
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`booking:${customerId}:${input.requestKey}`}))`);
        const [replay] = await tx.select().from(appointments).where(eq(appointments.requestKey, input.requestKey));
        if (replay) {
          if (replay.customerId !== customerId || replay.dogId !== dog.id || replay.startAt.getTime() !== start.getTime() ||
            JSON.stringify(replay.requestedServiceIds) !== JSON.stringify(qt.serviceIds)) throw new HttpError(409, "Identificativo già usato per una richiesta diversa");
          return { ...replay, duplicate: true };
        }
        const [same] = await tx.select().from(appointments).where(and(eq(appointments.dogId, dog.id),
          sql`${appointments.startAt} < ${new Date(start.getTime() + qt.durationMin * 60_000)}`,
          sql`${appointments.endAt} > ${start}`,
          sql`${appointments.status} in ('richiesta','in_valutazione','proposta','confermata','attesa_pagamento')`));
        if (same) throw new HttpError(409, "Esiste già una richiesta per questo animale in questo intervallo.");
        await assertSlotFree(tx, opId, start, qt.durationMin);
        if (!(await operatorSlots(opId, input.date, qt.durationMin, { tx })).includes(input.time)) throw new SlotError("Scegli un orario tra quelli disponibili.");
        const [a] = await tx.insert(appointments).values({
          customerId, dogId: dog.id, serviceId: qt.serviceIds[0], requestedServiceIds: qt.serviceIds, operatorId: null, reservedOperatorId: opId,
          startAt: start, endAt: new Date(start.getTime() + qt.durationMin * 60_000), durationMin: qt.durationMin,
          coatKnotsToday: input.coatKnotsToday, coatSheddingToday: input.coatSheddingToday,
          durationNeedsReview: input.coatKnotsToday || input.coatSheddingToday,
          status: "richiesta", customerNotes: input.notes || null, alternativeAvailability: input.alternativeAvailability || null,
          estimatedPriceCents: qt.estimatedPriceCents, privacyAcknowledgedAt: receipt?.createdAt ?? cust.consentDate, privacyVersion: receipt?.policyVersion ?? null,
          servicePriceSnapshot: qt.servicePriceSnapshot,
          privacyAcknowledgementProof: "presa_visione_gia_registrata_alla_registrazione", requestKey: input.requestKey,
          paymentMode: s.payments.defaultMode, source: "online",
        }).returning();
        await logEvent(tx, a.id, customerId, "richiesta_creata", null, "richiesta", { serviceIds: qt.serviceIds,
          coatKnotsToday: input.coatKnotsToday, coatSheddingToday: input.coatSheddingToday,
          durationNeedsReview: a.durationNeedsReview, privacySource: "registrazione" });
        await tx.insert(appointmentPhotos).values({ appointmentId: a.id, storageKey: photo.storageKey });
        if (input.boarding) {
          const [boarding] = await tx.insert(boardingRequests).values({ ...input.boarding, customerId, dogId: dog.id,
            customerNotes: `Collegata alla richiesta toelettatura ${a.id}. ${input.notes || ""}`.slice(0, 2000) }).returning();
          await tx.insert(boardingEvents).values({ boardingId: boarding.id, actorId: customerId, action: "richiesta",
            message: `Richiesta congiunta alla toelettatura ${a.id}` });
          await logEvent(tx, a.id, customerId, "pensione_richiesta", null, null, { boardingRequestId: boarding.id });
        }
        return { ...a, duplicate: false };
      });
      if (app.duplicate) return app;
      try {
        await notifyUser(cust, {
        title: "Richiesta inviata", body: `${qt.services.map((x) => x.name).join(", ")} per ${dog.name} il ${fmtRome(app.startAt)}: attendi la conferma di Dog's Planet.`,
        url: "/account/appuntamenti", template: "richiesta_ricevuta", dedupeKey: `booking-received:${app.id}`, vars: { cane: dog.name,
          servizio: qt.services.map((x) => x.name).join(", ") + (input.boarding ? `; richiesta pensione dal ${input.boarding.startDate} al ${input.boarding.endDate}` : ""), data: fmtRome(app.startAt) },
      });
      await notifyStaff("richieste", {
        title: "Nuova richiesta di prenotazione",
        body: `${dog.name} – ${qt.services.map((x) => x.name).join(", ")} il ${fmtRome(app.startAt)}. Operatore da assegnare.${app.durationNeedsReview ? " Durata da verificare: muta e/o nodi." : ""}${input.boarding ? ` Anche pensione dal ${input.boarding.startDate} al ${input.boarding.endDate}.` : ""}`,
        url: `/admin/richieste?id=${app.id}`, emailTo: s.business.email, dedupeKey: `booking-staff:${app.id}`,
      });
      } catch {
        await logEvent(db, app.id, null, "notifiche_da_verificare", null, null, { message: "Richiesta salvata; controllare i registri di invio." });
      }
      return app;
    } catch (e) {
      if (e instanceof SlotError) { lastErr = e; continue; }
      throw e;
    }
  }
  throw new HttpError(409, "L’orario non è più disponibile per i servizi selezionati. Scegline un altro: i dati sono conservati.");
}

async function loadFull(id: number) {
  const [row] = await db.select({ a: appointments, customer: users, dog: dogs, service: services })
    .from(appointments)
    .innerJoin(users, eq(users.id, appointments.customerId))
    .innerJoin(dogs, eq(dogs.id, appointments.dogId))
    .innerJoin(services, eq(services.id, appointments.serviceId))
    .where(eq(appointments.id, id));
  if (!row) throw new HttpError(404, "Appuntamento non trovato");
  return row;
}

export async function paidTotal(appointmentId: number, tx: any = db) {
  const [r] = await tx.select({
    paid: sql<number>`coalesce(sum(case when ${payments.kind} = 'rimborso' then -${payments.amountCents} else ${payments.amountCents} end), 0)::int`,
  }).from(payments).where(and(eq(payments.appointmentId, appointmentId), eq(payments.status, "pagato")));
  return r?.paid ?? 0;
}

type ActionInput = {
  action: "valuta" | "conferma" | "rifiuta" | "proponi" | "richiedi_pagamento" | "completa" | "assente" | "annulla" | "accetta_proposta" | "rifiuta_proposta";
  reason?: string | null;
  startAt?: Date; operatorId?: number | null; durationMin?: number; finalPriceCents?: number | null;
  paymentMode?: "nessuno" | "acconto" | "saldo" | "negozio"; depositCents?: number | null; force?: boolean;
  treatmentNotes?: string | null;
};

const ALLOWED: Record<ActionInput["action"], AppointmentStatus[]> = {
  valuta: ["richiesta"],
  conferma: ["richiesta", "in_valutazione", "proposta", "attesa_pagamento"],
  rifiuta: ["richiesta", "in_valutazione", "proposta"],
  proponi: ["richiesta", "in_valutazione", "proposta", "confermata"],
  richiedi_pagamento: ["richiesta", "in_valutazione", "confermata"],
  completa: ["confermata", "attesa_pagamento"],
  assente: ["confermata", "attesa_pagamento"],
  annulla: ["richiesta", "in_valutazione", "proposta", "confermata", "attesa_pagamento"],
  accetta_proposta: ["proposta"],
  rifiuta_proposta: ["proposta"],
};

/** Applica un'azione di flusso all'appuntamento con validazioni, tracciamento e notifiche. */
export async function applyAction(appointmentId: number, actor: { id: number; role: string }, input: ActionInput) {
  const before = await loadFull(appointmentId);
  const a = before.a;
  if (!ALLOWED[input.action].includes(a.status)) throw new HttpError(400, `Azione non consentita nello stato "${STATUS_LABELS[a.status]}"`);
  const isCustomer = actor.role === "customer";
  if (isCustomer && !["accetta_proposta", "rifiuta_proposta", "annulla"].includes(input.action)) throw new HttpError(403, "Permesso negato");
  if (isCustomer && a.customerId !== actor.id) throw new HttpError(404, "Appuntamento non trovato");
  const settings = await getSettings();
  let lateCancel = false;
  if (input.action === "annulla" && !["richiesta", "in_valutazione"].includes(a.status)) {
    lateCancel = !withinDeadline(a.startAt, settings.cancellation.cancelHours);
    if (isCustomer && lateCancel) throw new HttpError(400, `Il termine per annullare online è di ${settings.cancellation.cancelHours} ore prima: invia una richiesta al salone`);
  }
  if (input.action === "annulla" && !isCustomer && !input.reason) throw new HttpError(400, "Indica il motivo dell'annullamento");
  if (input.force && actor.role !== "admin") throw new HttpError(403, "Solo l'amministratore può forzare sovrapposizioni o orari fuori turno");

  let earnedPoints = 0;
  const updated = await db.transaction(async (tx) => {
    const patch: Partial<Appointment> = { updatedAt: new Date() };
    let to: AppointmentStatus = a.status;
    const s = await getSettings();
    const payModeOnline = (m?: string) => m === "acconto" || m === "saldo";

    switch (input.action) {
      case "valuta": to = "in_valutazione"; break;
      case "conferma": {
        const opId = input.operatorId ?? a.operatorId;
        const start = input.startAt ?? a.startAt;
        const dur = input.durationMin ?? a.durationMin;
        if (!opId) throw new HttpError(400, "Assegna un operatore");
        if (!(await compatibleOperatorsForServices(a.requestedServiceIds?.length ? a.requestedServiceIds : [a.serviceId], false, tx)).some((op: any) => op.id === opId))
          throw new HttpError(400, "L’operatore deve essere abilitato a tutti i servizi richiesti");
        if (!input.force) await assertSlotFree(tx, opId, start, dur, a.id);
        Object.assign(patch, { operatorId: opId, reservedOperatorId: null, durationNeedsReview: false, startAt: start, durationMin: dur, endAt: new Date(start.getTime() + dur * 60_000), allowOverlap: !!input.force, proposedStartAt: null, proposedOperatorId: null });
        if (input.finalPriceCents !== undefined) patch.finalPriceCents = input.finalPriceCents;
        const mode = input.paymentMode ?? a.paymentMode;
        patch.paymentMode = mode;
        if (input.depositCents !== undefined) patch.depositCents = input.depositCents;
        const due = mode === "saldo" ? (patch.finalPriceCents ?? a.finalPriceCents ?? a.estimatedPriceCents ?? 0)
          : mode === "acconto" ? (patch.depositCents ?? a.depositCents ?? 0) : 0;
        const paid = await paidTotal(a.id, tx);
        to = payModeOnline(mode) && due > paid ? "attesa_pagamento" : "confermata";
        break;
      }
      case "rifiuta": to = "rifiutata"; break;
      case "proponi": {
        if (!input.startAt) throw new HttpError(400, "Indica il nuovo orario proposto");
        const opId = input.operatorId ?? a.operatorId ?? a.reservedOperatorId;
        if (!opId || !(await compatibleOperatorsForServices(a.requestedServiceIds?.length ? a.requestedServiceIds : [a.serviceId], false, tx)).some((op: any) => op.id === opId))
          throw new HttpError(400, "Scegli un operatore abilitato a tutti i servizi");
        const dur = input.durationMin ?? a.durationMin;
        if (!input.force) await assertSlotFree(tx, opId, input.startAt, dur, a.id);
        Object.assign(patch, { proposedStartAt: input.startAt, proposedOperatorId: opId, durationMin: dur });
        to = "proposta"; break;
      }
      case "accetta_proposta": {
        if (!a.proposedStartAt) throw new HttpError(400, "Nessuna proposta da accettare");
        const opId = a.proposedOperatorId ?? a.operatorId!;
        if (!(await compatibleOperatorsForServices(a.requestedServiceIds?.length ? a.requestedServiceIds : [a.serviceId], false, tx)).some((op: any) => op.id === opId))
          throw new HttpError(409, "Il salone deve verificare nuovamente l’operatore proposto");
        await assertSlotFree(tx, opId, a.proposedStartAt, a.durationMin, a.id);
        Object.assign(patch, { startAt: a.proposedStartAt, endAt: new Date(a.proposedStartAt.getTime() + a.durationMin * 60_000), operatorId: opId, reservedOperatorId: null, durationNeedsReview: false, proposedStartAt: null, proposedOperatorId: null });
        const due = a.paymentMode === "saldo" ? (a.finalPriceCents ?? a.estimatedPriceCents ?? 0) : a.paymentMode === "acconto" ? (a.depositCents ?? 0) : 0;
        to = payModeOnline(a.paymentMode) && due > (await paidTotal(a.id, tx)) ? "attesa_pagamento" : "confermata";
        break;
      }
      case "rifiuta_proposta": to = "annullata"; break;
      case "richiedi_pagamento": {
        const mode = input.paymentMode ?? (a.paymentMode === "nessuno" || a.paymentMode === "negozio" ? "acconto" : a.paymentMode);
        if (!payModeOnline(mode)) throw new HttpError(400, "Scegli acconto o saldo online");
        if (input.finalPriceCents !== undefined) patch.finalPriceCents = input.finalPriceCents;
        let dep = input.depositCents ?? a.depositCents;
        const price = patch.finalPriceCents ?? a.finalPriceCents ?? a.estimatedPriceCents;
        if (mode === "acconto" && !dep && price) dep = Math.round((price * s.payments.depositPercent) / 100);
        if (mode === "acconto" && !dep) throw new HttpError(400, "Indica l'importo dell'acconto");
        if (mode === "saldo" && !price) throw new HttpError(400, "Indica il prezzo definitivo");
        if (a.status !== "confermata" && a.operatorId) await assertSlotFree(tx, a.operatorId, a.startAt, a.durationMin, a.id);
        Object.assign(patch, { paymentMode: mode, depositCents: dep ?? null });
        to = "attesa_pagamento"; break;
      }
      case "completa": {
        to = "completata";
        if (input.finalPriceCents !== undefined) patch.finalPriceCents = input.finalPriceCents;
        if (input.treatmentNotes !== undefined) patch.treatmentNotes = input.treatmentNotes;
        break;
      }
      case "assente": to = "assente"; break;
      case "annulla": {
        to = "annullata";
        Object.assign(patch, { cancelReason: input.reason || (isCustomer ? "Annullato dal cliente" : null), cancelledAt: new Date(), cancelledBy: isCustomer ? "cliente" : "salone", lateCancel });
        break;
      }
    }
    patch.status = to;
    if (input.action === "conferma" || input.action === "accetta_proposta") patch.reminderSentAt = null;
    if (input.reason && !isCustomer && input.action !== "annulla") patch.adminNotes = [a.adminNotes, input.reason].filter(Boolean).join("\n");
    const [u] = await tx.update(appointments).set(patch)
      .where(and(eq(appointments.id, a.id), eq(appointments.status, a.status), eq(appointments.updatedAt, a.updatedAt))).returning();
    if (!u) throw new HttpError(409, "L’appuntamento è stato aggiornato: ricarica prima di riprovare.");
    await logEvent(tx, a.id, actor.id, input.action, a.status, to, { reason: input.reason, force: !!input.force, ...(input.startAt ? { startAt: input.startAt } : {}) });
    if (to === "confermata" && a.status !== to) await notifyAppointmentConfirmed(a.id, tx);

    if (to === "completata" && before.service.earnsPoints) {
      const paid = await paidTotal(a.id, tx);
      const base = paid > 0 ? paid : (u.finalPriceCents ?? 0);
      earnedPoints = await awardForAmount(a.customerId, base, `Servizio: ${before.service.name}`, { appointmentId: a.id, createdBy: actor.id, target: "servizi" }, tx);
    }
    return u;
  });

  // notifiche al cliente (email da template + push + in-app)
  const c = before.customer;
  const [op] = updated.operatorId ? await db.select().from(operators).where(eq(operators.id, updated.operatorId)) : [];
  const when = fmtRome(updated.proposedStartAt ?? updated.startAt);
  const due = updated.paymentMode === "saldo" ? (updated.finalPriceCents ?? updated.estimatedPriceCents) : updated.depositCents;
  const vars = { cane: before.dog.name, servizio: before.service.name, data: when, operatore: op?.name ?? "", messaggio: input.reason ?? "", importo: euro(due), punti: earnedPoints };
  const msgs: Partial<Record<AppointmentStatus, { title: string; body: string; template: string }>> = {
    confermata: { title: "Prenotazione confermata ✔", body: `Ti aspettiamo ${when} per ${before.service.name} di ${before.dog.name}.`, template: "appuntamento_confermato" },
    attesa_pagamento: { title: "Prenotazione: pagamento richiesto", body: `Per confermare ${before.service.name} del ${when} completa il pagamento dalla tua area personale.`, template: "appuntamento_pagamento" },
    rifiutata: { title: "Richiesta non accettata", body: `Non possiamo accogliere la richiesta del ${fmtRome(a.startAt)}.${input.reason ? " " + input.reason : ""}`, template: "appuntamento_rifiutato" },
    proposta: { title: "Ti proponiamo un nuovo orario", body: `Per ${before.dog.name} ti proponiamo ${when}. Accetta o rifiuta dalla tua area personale.`, template: "appuntamento_proposta" },
    annullata: { title: "Appuntamento annullato", body: `L'appuntamento del ${fmtRome(a.startAt)} è stato annullato.`, template: "appuntamento_annullato" },
    completata: { title: "Grazie per aver scelto Dog's Planet!", body: `${before.dog.name} è pronto e bellissimo.${earnedPoints ? ` +${earnedPoints} punti Fidelity.` : ""}`, template: "appuntamento_completato" },
  };
  const m = msgs[updated.status];
  if (m && updated.status !== a.status) {
    if (isCustomer) await notifyStaff("richieste", { title: `Cliente: ${m.title}`, body: `${c.firstName} ${c.lastName} – ${before.dog.name}`, url: `/admin/richieste?id=${a.id}` });
    if (updated.status === "confermata") {
      kickQueue();
      await pushUserNotification(c, m);
    }
    else if (!isCustomer) await notifyUser(c, { title: m.title, body: m.body, url: "/account/appuntamenti", template: m.template, vars });
  }
  return updated;
}
