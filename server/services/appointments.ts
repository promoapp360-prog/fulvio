import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { appointments, appointmentEvents, dogs, operators, services, users, payments, type Appointment, type AppointmentStatus } from "../../shared/schema";
import { assertSlotFree, operatorCanDo, quote, compatibleOperators, SlotError } from "./availability";
import { getSettings } from "./settings";
import { notifyUser, notifyStaff } from "./notify";
import { awardForAmount } from "./loyalty";
import { fmtRome } from "../time";
import { STATUS_LABELS } from "../../shared/constants";
import { HttpError } from "../util";

export async function logEvent(tx: any, appointmentId: number, actorId: number | null, action: string, from: string | null, to: string | null, data: Record<string, unknown> = {}) {
  await tx.insert(appointmentEvents).values({ appointmentId, actorId, action, fromStatus: from, toStatus: to, data });
}

/** Richiesta di prenotazione del cliente: NON è mai una prenotazione definitiva. */
export async function createRequest(customerId: number, input: { dogId: number; serviceId: number; operatorId: number | null; start: Date; notes?: string | null }) {
  const [dog] = await db.select().from(dogs).where(and(eq(dogs.id, input.dogId), eq(dogs.ownerId, customerId), eq(dogs.archived, false)));
  if (!dog) throw new HttpError(404, "Cane non trovato");
  const qt = await quote(input.serviceId, dog);
  if (!qt.service.bookable || !qt.service.visible) throw new HttpError(400, "Servizio non prenotabile online");
  const s = await getSettings();
  if (input.start.getTime() < Date.now() + s.booking.minNoticeHours * 3600_000) throw new HttpError(400, `Serve un preavviso di almeno ${s.booking.minNoticeHours} ore`);

  let candidates: number[];
  if (input.operatorId) {
    if (!(await operatorCanDo(input.operatorId, input.serviceId))) throw new HttpError(400, "L'operatore scelto non esegue questo servizio");
    candidates = [input.operatorId];
  } else {
    if (!s.booking.allowAnyOperator) throw new HttpError(400, "Seleziona un operatore");
    candidates = (await compatibleOperators(input.serviceId, true)).map((o: any) => o.id);
  }

  let lastErr: Error | null = null;
  for (const opId of candidates) {
    try {
      const app = await db.transaction(async (tx) => {
        await assertSlotFree(tx, opId, input.start, qt.durationMin);
        const [a] = await tx.insert(appointments).values({
          customerId, dogId: dog.id, serviceId: input.serviceId, operatorId: opId,
          startAt: input.start, endAt: new Date(input.start.getTime() + qt.durationMin * 60_000), durationMin: qt.durationMin,
          status: "richiesta", customerNotes: input.notes || null, estimatedPriceCents: qt.estimatedPriceCents,
          paymentMode: s.payments.defaultMode, source: "online",
        }).returning();
        await logEvent(tx, a.id, customerId, "richiesta_creata", null, "richiesta", { operatorId: opId, supplements: qt.supplements });
        return a;
      });
      const [op] = await db.select().from(operators).where(eq(operators.id, opId));
      await notifyStaff("richieste", {
        title: "Nuova richiesta di prenotazione",
        body: `${dog.name} – ${qt.service.name} con ${op?.name ?? "operatore"} il ${fmtRome(app.startAt)}`,
        url: `/admin/richieste?id=${app.id}`,
      });
      return app;
    } catch (e) {
      if (e instanceof SlotError) { lastErr = e; continue; }
      throw e;
    }
  }
  throw lastErr || new HttpError(409, "Nessun operatore disponibile in quell'orario");
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
  if (isCustomer && input.action === "annulla" && !["richiesta", "in_valutazione"].includes(a.status)) {
    throw new HttpError(400, "L'appuntamento è già confermato: invia una richiesta di cancellazione");
  }
  if (input.force && actor.role !== "admin") throw new HttpError(403, "Solo l'amministratore può forzare sovrapposizioni o orari fuori turno");

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
        if (!input.force) await assertSlotFree(tx, opId, start, dur, a.id);
        Object.assign(patch, { operatorId: opId, startAt: start, durationMin: dur, endAt: new Date(start.getTime() + dur * 60_000), allowOverlap: !!input.force, proposedStartAt: null, proposedOperatorId: null });
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
        const opId = input.operatorId ?? a.operatorId!;
        const dur = input.durationMin ?? a.durationMin;
        if (!input.force) await assertSlotFree(tx, opId, input.startAt, dur, a.id);
        Object.assign(patch, { proposedStartAt: input.startAt, proposedOperatorId: opId, durationMin: dur });
        to = "proposta"; break;
      }
      case "accetta_proposta": {
        if (!a.proposedStartAt) throw new HttpError(400, "Nessuna proposta da accettare");
        const opId = a.proposedOperatorId ?? a.operatorId!;
        await assertSlotFree(tx, opId, a.proposedStartAt, a.durationMin, a.id);
        Object.assign(patch, { startAt: a.proposedStartAt, endAt: new Date(a.proposedStartAt.getTime() + a.durationMin * 60_000), operatorId: opId, proposedStartAt: null, proposedOperatorId: null });
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
        break;
      }
      case "assente": to = "assente"; break;
      case "annulla": to = "annullata"; break;
    }
    patch.status = to;
    if (input.reason && !isCustomer) patch.adminNotes = [a.adminNotes, input.reason].filter(Boolean).join("\n");
    const [u] = await tx.update(appointments).set(patch).where(eq(appointments.id, a.id)).returning();
    await logEvent(tx, a.id, actor.id, input.action, a.status, to, { reason: input.reason, force: !!input.force, ...(input.startAt ? { startAt: input.startAt } : {}) });

    if (to === "completata") {
      const paid = await paidTotal(a.id, tx);
      const base = paid > 0 ? paid : (u.finalPriceCents ?? 0);
      await awardForAmount(a.customerId, base, `Servizio: ${before.service.name}`, { appointmentId: a.id, createdBy: actor.id }, tx);
    }
    return u;
  });

  // notifiche al cliente
  const c = before.customer;
  const when = fmtRome(updated.proposedStartAt ?? updated.startAt);
  const msgs: Partial<Record<AppointmentStatus, { title: string; body: string }>> = {
    confermata: { title: "Prenotazione confermata ✔", body: `Ti aspettiamo ${when} per ${before.service.name} di ${before.dog.name}.` },
    attesa_pagamento: { title: "Prenotazione: pagamento richiesto", body: `Per confermare ${before.service.name} del ${when} completa il pagamento dalla tua area personale.` },
    rifiutata: { title: "Richiesta non accettata", body: `Purtroppo non possiamo accogliere la richiesta del ${fmtRome(a.startAt)}.${input.reason ? " " + input.reason : ""} Contattaci per trovare un'alternativa.` },
    proposta: { title: "Ti proponiamo un nuovo orario", body: `Per ${before.dog.name} ti proponiamo ${when}. Accetta o rifiuta dalla tua area personale.` },
    annullata: { title: "Appuntamento annullato", body: `L'appuntamento del ${fmtRome(a.startAt)} è stato annullato.` },
    completata: { title: "Grazie per aver scelto Dog's Planet!", body: `${before.dog.name} è pronto e bellissimo. I punti Fidelity sono stati accreditati.` },
  };
  const m = msgs[updated.status];
  if (m && updated.status !== a.status) {
    if (isCustomer) await notifyStaff("richieste", { title: `Cliente: ${m.title}`, body: `${c.firstName} ${c.lastName} – ${before.dog.name}`, url: `/admin/richieste?id=${a.id}` });
    else await notifyUser(c, { ...m, url: "/account/appuntamenti", template: `app_${updated.status}` });
  }
  return updated;
}
