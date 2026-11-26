import { Router } from "express";
import { z } from "zod";
import { and, asc, desc, eq, gte, inArray, lt, sql, isNotNull, or } from "drizzle-orm";
import { db } from "../../db";
import { appointments, appointmentEvents, appointmentPhotos, dogs, guestBookings, guestBookingEvents, guestCustomers, guestDogs, operators, services, users, payments } from "../../../shared/schema";
import { requirePerm, hasPerm } from "../../auth";
import { applyAction, logEvent, paidTotal } from "../../services/appointments";
import { assertSlotFree, quote, operatorSlots, availability, compatibleOperatorsForServices } from "../../services/availability";
import { notifyUser } from "../../services/notify";
import { notifyAppointmentConfirmed } from "../../services/appointment-mail";
import { cancelOneSignalAppointmentReminder, scheduleOneSignalReminder } from "../../services/onesignal";
import { audit } from "../../services/audit";
import { h, HttpError, id, zDay, zTime, zOptStr } from "../../util";
import { romeToDate, addDays, fmtRome } from "../../time";
import { readStored } from "../../services/storage";

const r = Router();
// A proposal reserves its proposed time, not the superseded original time.
const planningStartAt = sql<Date>`case when ${appointments.status}='proposta' then coalesce(${appointments.proposedStartAt}, ${appointments.startAt}) else ${appointments.startAt} end`;
const planningOperatorId = sql<number>`case when ${appointments.status}='proposta' then coalesce(${appointments.proposedOperatorId}, ${appointments.operatorId}, ${appointments.reservedOperatorId}) else coalesce(${appointments.operatorId}, ${appointments.reservedOperatorId}) end`;

const baseSelect = {
  id: appointments.id, startAt: appointments.startAt, endAt: appointments.endAt, durationMin: appointments.durationMin, status: appointments.status,
  operatorId: appointments.operatorId, serviceId: appointments.serviceId, dogId: appointments.dogId, customerId: appointments.customerId,
  reservedOperatorId: appointments.reservedOperatorId, proposedOperatorId: appointments.proposedOperatorId, updatedAt: appointments.updatedAt,
  customerNotes: appointments.customerNotes, adminNotes: appointments.adminNotes, changeRequest: appointments.changeRequest,
  coatKnotsToday: appointments.coatKnotsToday, coatSheddingToday: appointments.coatSheddingToday,
  durationNeedsReview: appointments.durationNeedsReview,
  requestedServiceIds:appointments.requestedServiceIds,alternativeAvailability:appointments.alternativeAvailability,
  servicePriceSnapshot:appointments.servicePriceSnapshot,
  privacyAcknowledgedAt:appointments.privacyAcknowledgedAt,privacyVersion:appointments.privacyVersion,
  estimatedPriceCents: appointments.estimatedPriceCents, finalPriceCents: appointments.finalPriceCents, paymentMode: appointments.paymentMode,
  depositCents: appointments.depositCents, proposedStartAt: appointments.proposedStartAt, allowOverlap: appointments.allowOverlap, createdAt: appointments.createdAt,
  serviceName: services.name, dogName: dogs.name, dogSize: dogs.size, dogBreed: dogs.breed, dogAggressive: dogs.aggressive,
  customerName: sql<string>`${users.firstName} || ' ' || ${users.lastName}`, customerPhone: users.phone,
  operatorName: operators.name, operatorColor: operators.color,
};

function joined() {
  return db.select(baseSelect).from(appointments)
    .innerJoin(services, eq(services.id, appointments.serviceId))
    .innerJoin(dogs, eq(dogs.id, appointments.dogId))
    .innerJoin(users, eq(users.id, appointments.customerId))
    .leftJoin(operators, eq(operators.id, appointments.operatorId));
}

/** Agenda: appuntamenti in un intervallo (giorno/settimana/mese), filtrabile per operatore. */
r.get("/appointments", requirePerm("agenda_view"), h(async (req, res) => {
  const q = z.object({ from: zDay, to: zDay, operatorId: z.coerce.number().int().optional(), all: z.string().optional() }).parse(req.query);
  const from = romeToDate(q.from, "00:00"), to = romeToDate(addDays(q.to, 1), "00:00");
  if (to.getTime() - from.getTime() > 1000 * 3600 * 24 * 45) throw new HttpError(400, "Intervallo troppo ampio");
  const conds = [gte(planningStartAt, from), lt(planningStartAt, to)];
  // un operatore senza permessi estesi vede solo la propria agenda
  if (req.user!.role === "operator" && !(req.user!.permissions || []).some((p) => p === "richieste" || p === "agenda_edit")) {
    const [me] = await db.select().from(operators).where(eq(operators.userId, req.user!.id));
    conds.push(eq(appointments.operatorId, me?.id ?? -1));
  } else if (q.operatorId) conds.push(eq(planningOperatorId, q.operatorId));
  if (!q.all) conds.push(inArray(appointments.status, ["richiesta", "in_valutazione", "proposta", "confermata", "attesa_pagamento", "completata", "assente"]));
  const rows = await joined().where(and(...conds)).orderBy(asc(planningStartAt));
  res.json(rows.map(row => ({ ...row, serviceName: row.servicePriceSnapshot?.map((s: any) => s.name).filter(Boolean).join(", ") || row.serviceName })));
}));

/** Coda richieste da gestire */
r.get("/requests", requirePerm("richieste"), h(async (req, res) => {
  const status = String(req.query.status || "aperte");
  const cond = status === "aperte"
    ? or(inArray(appointments.status, ["richiesta", "in_valutazione", "proposta", "attesa_pagamento"]), isNotNull(appointments.changeRequest))
    : eq(appointments.status, status as any);
  const rows = await joined().where(cond).orderBy(asc(appointments.startAt)).limit(200);
  res.json(rows.map(row => ({ ...row, serviceName: row.servicePriceSnapshot?.map((s: any) => s.name).filter(Boolean).join(", ") || row.serviceName })));
}));

/** Ospiti: archivio separato, nessun account o scheda appuntamento fittizia. */
r.get("/guest-requests",requirePerm("richieste"),h(async(req,res)=>{
  res.status(410).json({ error: "Il percorso ospite è disattivato. I dati precedenti sono conservati nell’archivio storico del CRM." });
}));

r.get("/guest-bookings/:id",requirePerm("richieste","clienti"),h(async(req,res)=>{
  const gid=id(req.params.id);
  const [row]=await db.select({booking:guestBookings,customer:guestCustomers,dog:guestDogs,serviceName:services.name,operatorName:operators.name})
    .from(guestBookings).leftJoin(guestCustomers,eq(guestCustomers.id,guestBookings.guestCustomerId))
    .leftJoin(guestDogs,eq(guestDogs.id,guestBookings.guestDogId))
    .innerJoin(services,eq(services.id,guestBookings.serviceId))
    .leftJoin(operators,eq(operators.id,guestBookings.operatorId)).where(eq(guestBookings.id,gid));
  if(!row) throw new HttpError(404,"Richiesta ospite non trovata.");
  const serviceNames=row.booking.servicePriceSnapshot?.length?row.booking.servicePriceSnapshot.map((s:any)=>({name:s.name})):
    row.booking.requestedServiceIds.length?await db.select({id:services.id,name:services.name}).from(services).where(inArray(services.id,row.booking.requestedServiceIds)):[];
  const events=await db.select().from(guestBookingEvents).where(eq(guestBookingEvents.bookingId,gid)).orderBy(asc(guestBookingEvents.id));
  res.json({...row,serviceNames:serviceNames.map(s=>s.name),events});
}));

r.get("/guest-bookings/:id/photo",requirePerm("richieste","clienti"),h(async(req,res)=>{
  const [photo]=await db.select({storageKey:appointmentPhotos.storageKey}).from(appointmentPhotos).where(eq(appointmentPhotos.guestBookingId,id(req.params.id)));
  const data=photo?await readStored(photo.storageKey):null;
  if(!data) throw new HttpError(404,"Foto non disponibile.");
  res.set({"Content-Type":"image/webp","Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}).send(data);
}));

r.post("/guest-bookings/:id/action", requirePerm("richieste"), (_req, res) => {
  res.status(410).json({ error: "Le richieste ospite sono archiviate e non sono più gestibili. Il cliente deve registrarsi e inviare una nuova richiesta." });
});

r.get("/appointments/:id/photo",requirePerm("richieste","clienti"),h(async(req,res)=>{
  const [photo]=await db.select({storageKey:appointmentPhotos.storageKey}).from(appointmentPhotos).where(eq(appointmentPhotos.appointmentId,id(req.params.id)));
  const data=photo?await readStored(photo.storageKey):null;
  if(!data) throw new HttpError(404,"Foto non disponibile.");
  res.set({"Content-Type":"image/webp","Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}).send(data);
}));

r.get("/appointments/:id", requirePerm("agenda_view"), h(async (req, res) => {
  const aid = id(req.params.id);
  const [a] = await joined().where(eq(appointments.id, aid));
  if (!a) throw new HttpError(404, "Non trovato");
  const [events, pays, [dog]] = await Promise.all([
    db.select({ e: appointmentEvents, actor: sql<string>`${users.firstName} || ' ' || ${users.lastName}` }).from(appointmentEvents)
      .leftJoin(users, eq(users.id, appointmentEvents.actorId)).where(eq(appointmentEvents.appointmentId, aid)).orderBy(asc(appointmentEvents.id)),
    db.select().from(payments).where(eq(payments.appointmentId, aid)).orderBy(asc(payments.createdAt)),
    db.select().from(dogs).where(eq(dogs.id, a.dogId)),
  ]);
  const [extra] = await db.select({ treatmentNotes: appointments.treatmentNotes, cancelReason: appointments.cancelReason, cancelledAt: appointments.cancelledAt, cancelledBy: appointments.cancelledBy, lateCancel: appointments.lateCancel })
    .from(appointments).where(eq(appointments.id, aid));
  const requestedIds=a.requestedServiceIds?.length?a.requestedServiceIds:[a.serviceId];
  const requestedServices=a.servicePriceSnapshot?.length?a.servicePriceSnapshot.map((s:any)=>({...s,id:s.serviceId})):
    await db.select({id:services.id,name:services.name}).from(services).where(inArray(services.id,requestedIds));
  res.json({ ...a, ...extra, requestedServices, dog, events: events.map((x) => ({ ...x.e, actor: x.actor })), payments: pays, paidCents: await paidTotal(aid) });
}));

const actionSchema = z.object({
  action: z.enum(["valuta", "conferma", "rifiuta", "proponi", "richiedi_pagamento", "completa", "assente", "annulla"]),
  reason: zOptStr(1000),
  date: zDay.optional(), time: zTime.optional(),
  operatorId: z.number().int().positive().nullable().optional(),
  durationMin: z.number().int().min(5).max(600).optional(),
  finalPriceCents: z.number().int().min(0).nullable().optional(),
  paymentMode: z.enum(["nessuno", "acconto", "saldo", "negozio"]).optional(),
  depositCents: z.number().int().min(0).nullable().optional(),
  force: z.boolean().optional(),
  treatmentNotes: zOptStr(4000),
  expectedUpdatedAt: z.string().datetime().optional(),
});

r.post("/appointments/:id/action", requirePerm("richieste"), h(async (req, res) => {
  const d = actionSchema.parse(req.body);
  const startAt = d.date && d.time ? romeToDate(d.date, d.time) : undefined;
  const u = await applyAction(id(req.params.id), { id: req.user!.id, role: req.user!.role }, { ...d, startAt });
  await audit(req, "appointment_" + d.action, "appointment", u.id, d);
  res.json(u);
}));

/** Modifica diretta (operatore, orario, durata, prezzo, note) con controllo turni/sovrapposizioni. */
r.patch("/appointments/:id", requirePerm("agenda_edit"), h(async (req, res) => {
  const aid = id(req.params.id);
  const d = z.object({
    date: zDay.optional(), time: zTime.optional(), operatorId: z.number().int().positive().optional(),
    durationMin: z.number().int().min(5).max(600).optional(), finalPriceCents: z.number().int().min(0).nullable().optional(),
    estimatedPriceCents: z.number().int().min(0).nullable().optional(), adminNotes: zOptStr(4000), treatmentNotes: zOptStr(4000), paymentMode: z.enum(["nessuno", "acconto", "saldo", "negozio"]).optional(),
    depositCents: z.number().int().min(0).nullable().optional(), clearChangeRequest: z.boolean().optional(), force: z.boolean().optional(),
    expectedUpdatedAt: z.string().datetime().optional(),
  }).parse(req.body);
  if (!!d.date !== !!d.time) throw new HttpError(400, "Indica sia la data sia l’ora");
  if (d.force && req.user!.role !== "admin") throw new HttpError(403, "Solo l'amministratore può autorizzare sovrapposizioni");
  const out = await db.transaction(async (tx) => {
    const [a] = await tx.select().from(appointments).where(eq(appointments.id, aid)).for("update");
    if (!a) throw new HttpError(404, "Non trovato");
    if (d.expectedUpdatedAt && new Date(d.expectedUpdatedAt).getTime() !== a.updatedAt.getTime()) throw new HttpError(409, "L’appuntamento è stato aggiornato: riaprilo prima di riprovare.");
    const start = d.date && d.time ? romeToDate(d.date, d.time) : a.startAt;
    const op = d.operatorId ?? a.operatorId ?? a.reservedOperatorId;
    const dur = d.durationMin ?? a.durationMin;
    const timingChanged = start.getTime() !== a.startAt.getTime() || op !== (a.operatorId ?? a.reservedOperatorId) || dur !== a.durationMin;
    const active = ["richiesta", "in_valutazione", "proposta", "confermata", "attesa_pagamento"].includes(a.status);
    if (timingChanged && active) {
      if (a.status === "proposta") throw new HttpError(400, "Per cambiare una proposta usa «Proponi questo orario» o confermala esplicitamente.");
      if (!op) throw new HttpError(400, "Scegli un operatore abilitato per verificare l’orario");
      if (!(await compatibleOperatorsForServices(a.requestedServiceIds?.length ? a.requestedServiceIds : [a.serviceId], false, tx)).some((o: any) => o.id === op))
        throw new HttpError(400, "L’operatore deve essere abilitato a tutti i servizi richiesti");
      if (!d.force) await assertSlotFree(tx, op, start, dur, a.id);
    }
    const patch: any = {
      startAt: start, endAt: new Date(start.getTime() + dur * 60_000), durationMin: dur, updatedAt: new Date(),
      // Moving an unconfirmed request must not silently assign or confirm it.
      ...(!a.operatorId && active
        ? { operatorId: null, reservedOperatorId: op }
        : { operatorId: a.operatorId ? op : null }),
      ...(start.getTime() !== a.startAt.getTime() ? { reminderSentAt: null } : {}),
      ...(d.force ? { allowOverlap: true } : {}),
    };
    for (const k of ["finalPriceCents", "estimatedPriceCents", "adminNotes", "treatmentNotes", "paymentMode", "depositCents"] as const) if (d[k] !== undefined) patch[k] = d[k];
    if (d.clearChangeRequest) patch.changeRequest = null;
    const [u] = await tx.update(appointments).set(patch).where(eq(appointments.id, aid)).returning();
    if (!u) throw new HttpError(409, "L’appuntamento è stato aggiornato: riaprilo prima di riprovare.");
    await logEvent(tx, aid, req.user!.id, "modifica", a.status, a.status, { ...d, startTimeChanged: start.getTime() !== a.startAt.getTime(), before: { startAt: a.startAt, operatorId: a.operatorId, durationMin: a.durationMin } });
    return { u, timingChanged, a };
  });
  if (out.timingChanged && ["confermata", "attesa_pagamento"].includes(out.u.status)) {
    const [c] = await db.select().from(users).where(eq(users.id, out.u.customerId));
    const [info] = await db.select({ dog: dogs.name, service: services.name, op: operators.name }).from(appointments).innerJoin(dogs, eq(dogs.id, appointments.dogId))
      .innerJoin(services, eq(services.id, appointments.serviceId)).leftJoin(operators, eq(operators.id, appointments.operatorId)).where(eq(appointments.id, aid));
    if (c) await notifyUser(c, { title: "Appuntamento modificato", body: `Il tuo appuntamento è stato spostato a ${fmtRome(out.u.startAt)}.`, url: "/account/appuntamenti",
      template: "appuntamento_modificato", vars: { cane: info?.dog, servizio: info?.service, data: fmtRome(out.u.startAt), operatore: info?.op ?? "" } });
  }
  if (out.u.status === "confermata" && out.timingChanged) await scheduleOneSignalReminder(aid);
  else if (out.timingChanged && out.a.status === "confermata") await cancelOneSignalAppointmentReminder(aid);
  await audit(req, "appointment_update", "appointment", aid, d);
  res.json(out.u);
}));

/** Inserimento manuale dal salone (telefono/WhatsApp/banco): nasce già confermato. */
r.post("/appointments", requirePerm("agenda_edit"), h(async (req, res) => {
  const d = z.object({
    customerId: z.number().int().positive(), dogId: z.number().int().positive(), serviceId: z.number().int().positive(),
    operatorId: z.number().int().positive(), date: zDay, time: zTime, durationMin: z.number().int().min(5).max(600).optional(),
    finalPriceCents: z.number().int().min(0).nullable().optional(), adminNotes: zOptStr(4000), force: z.boolean().optional(), notify: z.boolean().optional(),
  }).parse(req.body);
  if (d.force && req.user!.role !== "admin") throw new HttpError(403, "Solo l'amministratore può autorizzare sovrapposizioni");
  const [dog] = await db.select().from(dogs).where(and(eq(dogs.id, d.dogId), eq(dogs.ownerId, d.customerId)));
  if (!dog) throw new HttpError(400, "Il cane non appartiene al cliente selezionato");
  const qt = await quote(d.serviceId, dog);
  const dur = d.durationMin ?? qt.durationMin;
  const start = romeToDate(d.date, d.time);
  const a = await db.transaction(async (tx) => {
    if (!d.force) await assertSlotFree(tx, d.operatorId, start, dur);
    const [x] = await tx.insert(appointments).values({
      customerId: d.customerId, dogId: d.dogId, serviceId: d.serviceId, operatorId: d.operatorId, startAt: start,
      endAt: new Date(start.getTime() + dur * 60_000), durationMin: dur, status: "confermata", estimatedPriceCents: qt.estimatedPriceCents,
      finalPriceCents: d.finalPriceCents ?? null, adminNotes: d.adminNotes, allowOverlap: !!d.force, source: "salone", paymentMode: "negozio",
    }).returning();
    await logEvent(tx, x.id, req.user!.id, "creato_dal_salone", null, "confermata", { force: !!d.force });
    return x;
  });
  if (d.notify) {
    await notifyAppointmentConfirmed(a.id);
  }
  await scheduleOneSignalReminder(a.id);
  await audit(req, "appointment_create", "appointment", a.id, d);
  res.status(201).json(a);
}));

/** Slot liberi per un operatore (per inserimenti/spostamenti dal gestionale) */
r.get("/slots", requirePerm("agenda_view"), h(async (req, res) => {
  const q = z.object({ operatorId: z.coerce.number().int().optional(), serviceId: z.coerce.number().int().optional(), date: zDay, durationMin: z.coerce.number().int().min(5).max(600), excludeId: z.coerce.number().int().optional() }).parse(req.query);
  if (q.operatorId) return res.json({ [q.operatorId]: await operatorSlots(q.operatorId, q.date, q.durationMin, { excludeId: q.excludeId }) });
  if (q.serviceId) return res.json(await availability(q.serviceId, q.date, q.durationMin, null, false));
  throw new HttpError(400, "Indica operatore o servizio");
}));

/** Storico trattamenti (punto 15): ricerca e filtri su tutti i trattamenti eseguiti. */
r.get("/treatments", requirePerm("clienti", "agenda_view"), h(async (req, res) => {
  const q = z.object({
    dogId: z.coerce.number().int().optional(), customerId: z.coerce.number().int().optional(), serviceId: z.coerce.number().int().optional(),
    operatorId: z.coerce.number().int().optional(), from: zDay.optional(), to: zDay.optional(), q: z.string().max(80).optional(),
    page: z.coerce.number().int().min(1).default(1), format: z.enum(["xlsx", "pdf"]).optional(),
  }).parse(req.query);
  const conds: any[] = [eq(appointments.status, "completata")];
  if (q.dogId) conds.push(eq(appointments.dogId, q.dogId));
  if (q.customerId) conds.push(eq(appointments.customerId, q.customerId));
  if (q.serviceId) conds.push(eq(appointments.serviceId, q.serviceId));
  if (q.operatorId) conds.push(eq(appointments.operatorId, q.operatorId));
  if (q.from) conds.push(gte(appointments.startAt, romeToDate(q.from, "00:00")));
  if (q.to) conds.push(lt(appointments.startAt, romeToDate(addDays(q.to, 1), "00:00")));
  if (q.q) conds.push(sql`(${dogs.name} ilike ${"%" + q.q + "%"} or ${users.lastName} ilike ${"%" + q.q + "%"} or ${appointments.treatmentNotes} ilike ${"%" + q.q + "%"})`);
  const rows = await db.select({
    ...baseSelect, treatmentNotes: appointments.treatmentNotes,
    paidCents: sql<number>`(select coalesce(sum(case when p.kind='rimborso' then -p.amount_cents else p.amount_cents end),0) from payments p where p.appointment_id = ${appointments.id} and p.status='pagato')::int`,
    payMethods: sql<string>`(select string_agg(distinct p.method, ', ') from payments p where p.appointment_id = ${appointments.id} and p.status='pagato')`,
  }).from(appointments).innerJoin(services, eq(services.id, appointments.serviceId)).innerJoin(dogs, eq(dogs.id, appointments.dogId))
    .innerJoin(users, eq(users.id, appointments.customerId)).leftJoin(operators, eq(operators.id, appointments.operatorId))
    .where(and(...conds)).orderBy(desc(appointments.startAt)).limit(q.format ? 5000 : 50).offset(q.format ? 0 : (q.page - 1) * 50);
  if (q.format) {
    const { sendXlsx, sendPdf } = await import("../../services/exporter");
    const sheet = { name: "Storico trattamenti", columns: [
      { key: "data", label: "Data", width: 14 }, { key: "dogName", label: "Cane", width: 12 }, { key: "customerName", label: "Cliente", width: 16 }, { key: "serviceName", label: "Servizio", width: 18 },
      { key: "operatorName", label: "Operatore", width: 11 }, { key: "durationMin", label: "Min", width: 6 }, { key: "finalPriceCents", label: "Prezzo", money: true, width: 9 },
      { key: "paidCents", label: "Pagato", money: true, width: 9 }, { key: "treatmentNotes", label: "Note", width: 24 }], rows: rows.map((r) => ({ ...r, data: fmtRome(r.startAt) })) };
    return q.format === "xlsx" ? sendXlsx(res, "storico-trattamenti", [sheet as any]) : sendPdf(res, "storico-trattamenti", "Storico trattamenti", `Estratto del ${new Date().toLocaleDateString("it-IT")}`, [sheet as any]);
  }
  res.json(rows);
}));

/** Storico cancellazioni e assenze con motivi (punto 23). */
r.get("/cancellations", requirePerm("richieste", "statistiche"), h(async (req, res) => {
  const q = z.object({ from: zDay, to: zDay }).parse(req.query);
  res.json(await joined().where(and(inArray(appointments.status, ["annullata", "assente", "rifiutata"]),
    gte(appointments.startAt, romeToDate(q.from, "00:00")), lt(appointments.startAt, romeToDate(addDays(q.to, 1), "00:00"))))
    .orderBy(desc(appointments.startAt)).limit(500).then(async (rows) => {
      const ids = rows.map((r) => r.id);
      const extra = ids.length ? await db.select({ id: appointments.id, cancelReason: appointments.cancelReason, cancelledBy: appointments.cancelledBy, cancelledAt: appointments.cancelledAt, lateCancel: appointments.lateCancel }).from(appointments).where(inArray(appointments.id, ids)) : [];
      return rows.map((r) => ({ ...r, ...extra.find((e) => e.id === r.id) }));
    }));
}));

export default r;
