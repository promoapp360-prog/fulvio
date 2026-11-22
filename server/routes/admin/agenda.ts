import { Router } from "express";
import { z } from "zod";
import { and, asc, desc, eq, gte, inArray, lt, sql, isNotNull, or } from "drizzle-orm";
import { db } from "../../db";
import { appointments, appointmentEvents, dogs, operators, services, users, payments } from "../../../shared/schema";
import { requirePerm, hasPerm } from "../../auth";
import { applyAction, logEvent, paidTotal } from "../../services/appointments";
import { assertSlotFree, quote, operatorSlots, availability } from "../../services/availability";
import { notifyUser } from "../../services/notify";
import { audit } from "../../services/audit";
import { h, HttpError, id, zDay, zTime, zOptStr } from "../../util";
import { romeToDate, addDays, fmtRome } from "../../time";

const r = Router();

const baseSelect = {
  id: appointments.id, startAt: appointments.startAt, endAt: appointments.endAt, durationMin: appointments.durationMin, status: appointments.status,
  operatorId: appointments.operatorId, serviceId: appointments.serviceId, dogId: appointments.dogId, customerId: appointments.customerId,
  customerNotes: appointments.customerNotes, adminNotes: appointments.adminNotes, changeRequest: appointments.changeRequest,
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
r.get("/appointments", requirePerm("agenda"), h(async (req, res) => {
  const q = z.object({ from: zDay, to: zDay, operatorId: z.coerce.number().int().optional(), all: z.string().optional() }).parse(req.query);
  const from = romeToDate(q.from, "00:00"), to = romeToDate(addDays(q.to, 1), "00:00");
  if (to.getTime() - from.getTime() > 1000 * 3600 * 24 * 45) throw new HttpError(400, "Intervallo troppo ampio");
  const conds = [gte(appointments.startAt, from), lt(appointments.startAt, to)];
  // un operatore senza permessi estesi vede solo la propria agenda
  if (req.user!.role === "operator" && !(req.user!.permissions || []).includes("richieste")) {
    const [me] = await db.select().from(operators).where(eq(operators.userId, req.user!.id));
    conds.push(eq(appointments.operatorId, me?.id ?? -1));
  } else if (q.operatorId) conds.push(eq(appointments.operatorId, q.operatorId));
  if (!q.all) conds.push(inArray(appointments.status, ["richiesta", "in_valutazione", "proposta", "confermata", "attesa_pagamento", "completata", "assente"]));
  res.json(await joined().where(and(...conds)).orderBy(asc(appointments.startAt)));
}));

/** Coda richieste da gestire */
r.get("/requests", requirePerm("richieste"), h(async (req, res) => {
  const status = String(req.query.status || "aperte");
  const cond = status === "aperte"
    ? or(inArray(appointments.status, ["richiesta", "in_valutazione", "proposta", "attesa_pagamento"]), isNotNull(appointments.changeRequest))
    : eq(appointments.status, status as any);
  res.json(await joined().where(cond).orderBy(asc(appointments.startAt)).limit(200));
}));

r.get("/appointments/:id", requirePerm("agenda"), h(async (req, res) => {
  const aid = id(req.params.id);
  const [a] = await joined().where(eq(appointments.id, aid));
  if (!a) throw new HttpError(404, "Non trovato");
  const [events, pays, [dog]] = await Promise.all([
    db.select({ e: appointmentEvents, actor: sql<string>`${users.firstName} || ' ' || ${users.lastName}` }).from(appointmentEvents)
      .leftJoin(users, eq(users.id, appointmentEvents.actorId)).where(eq(appointmentEvents.appointmentId, aid)).orderBy(asc(appointmentEvents.id)),
    db.select().from(payments).where(eq(payments.appointmentId, aid)).orderBy(asc(payments.createdAt)),
    db.select().from(dogs).where(eq(dogs.id, a.dogId)),
  ]);
  res.json({ ...a, dog, events: events.map((x) => ({ ...x.e, actor: x.actor })), payments: pays, paidCents: await paidTotal(aid) });
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
});

r.post("/appointments/:id/action", requirePerm("richieste"), h(async (req, res) => {
  const d = actionSchema.parse(req.body);
  const startAt = d.date && d.time ? romeToDate(d.date, d.time) : undefined;
  const u = await applyAction(id(req.params.id), { id: req.user!.id, role: req.user!.role }, { ...d, startAt });
  await audit(req, "appointment_" + d.action, "appointment", u.id, d);
  res.json(u);
}));

/** Modifica diretta (operatore, orario, durata, prezzo, note) con controllo turni/sovrapposizioni. */
r.patch("/appointments/:id", requirePerm("richieste"), h(async (req, res) => {
  const aid = id(req.params.id);
  const d = z.object({
    date: zDay.optional(), time: zTime.optional(), operatorId: z.number().int().positive().optional(),
    durationMin: z.number().int().min(5).max(600).optional(), finalPriceCents: z.number().int().min(0).nullable().optional(),
    estimatedPriceCents: z.number().int().min(0).nullable().optional(), adminNotes: zOptStr(4000), paymentMode: z.enum(["nessuno", "acconto", "saldo", "negozio"]).optional(),
    depositCents: z.number().int().min(0).nullable().optional(), clearChangeRequest: z.boolean().optional(), force: z.boolean().optional(),
  }).parse(req.body);
  if (d.force && req.user!.role !== "admin") throw new HttpError(403, "Solo l'amministratore può autorizzare sovrapposizioni");
  const out = await db.transaction(async (tx) => {
    const [a] = await tx.select().from(appointments).where(eq(appointments.id, aid));
    if (!a) throw new HttpError(404, "Non trovato");
    const start = d.date && d.time ? romeToDate(d.date, d.time) : a.startAt;
    const op = d.operatorId ?? a.operatorId;
    const dur = d.durationMin ?? a.durationMin;
    const timingChanged = start.getTime() !== a.startAt.getTime() || op !== a.operatorId || dur !== a.durationMin;
    const active = ["richiesta", "in_valutazione", "proposta", "confermata", "attesa_pagamento"].includes(a.status);
    if (timingChanged && active && op && !d.force) await assertSlotFree(tx, op, start, dur, a.id);
    const patch: any = {
      startAt: start, endAt: new Date(start.getTime() + dur * 60_000), operatorId: op, durationMin: dur, updatedAt: new Date(),
      ...(d.force ? { allowOverlap: true } : {}),
    };
    for (const k of ["finalPriceCents", "estimatedPriceCents", "adminNotes", "paymentMode", "depositCents"] as const) if (d[k] !== undefined) patch[k] = d[k];
    if (d.clearChangeRequest) patch.changeRequest = null;
    const [u] = await tx.update(appointments).set(patch).where(eq(appointments.id, aid)).returning();
    await logEvent(tx, aid, req.user!.id, "modifica", a.status, a.status, { ...d, before: { startAt: a.startAt, operatorId: a.operatorId, durationMin: a.durationMin } });
    return { u, timingChanged, a };
  });
  if (out.timingChanged && ["confermata", "attesa_pagamento"].includes(out.u.status)) {
    const [c] = await db.select().from(users).where(eq(users.id, out.u.customerId));
    if (c) await notifyUser(c, { title: "Appuntamento modificato", body: `Il tuo appuntamento è stato spostato a ${fmtRome(out.u.startAt)}.`, url: "/account/appuntamenti" });
  }
  await audit(req, "appointment_update", "appointment", aid, d);
  res.json(out.u);
}));

/** Inserimento manuale dal salone (telefono/WhatsApp/banco): nasce già confermato. */
r.post("/appointments", requirePerm("richieste"), h(async (req, res) => {
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
    const [c] = await db.select().from(users).where(eq(users.id, d.customerId));
    if (c) await notifyUser(c, { title: "Appuntamento confermato", body: `${dog.name}: ${qt.service.name} il ${fmtRome(start)}.`, url: "/account/appuntamenti" });
  }
  await audit(req, "appointment_create", "appointment", a.id, d);
  res.status(201).json(a);
}));

/** Slot liberi per un operatore (per inserimenti/spostamenti dal gestionale) */
r.get("/slots", requirePerm("agenda"), h(async (req, res) => {
  const q = z.object({ operatorId: z.coerce.number().int().optional(), serviceId: z.coerce.number().int().optional(), date: zDay, durationMin: z.coerce.number().int().min(5).max(600), excludeId: z.coerce.number().int().optional() }).parse(req.query);
  if (q.operatorId) return res.json({ [q.operatorId]: await operatorSlots(q.operatorId, q.date, q.durationMin, { excludeId: q.excludeId }) });
  if (q.serviceId) return res.json(await availability(q.serviceId, q.date, q.durationMin, null, false));
  throw new HttpError(400, "Indica operatore o servizio");
}));

export default r;
