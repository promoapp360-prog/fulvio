import { Router } from "express";
import { z } from "zod";
import { and, asc, desc, eq, gte, lt, lte, sql, ilike, or } from "drizzle-orm";
import { db } from "../../db";
import { payments, appointments, selfserviceIncomes, loyaltyCards, loyaltyTransactions, loyaltyRewards, users, orders } from "../../../shared/schema";
import { requirePerm, requireAdmin } from "../../auth";
import { crud } from "../../crud";
import { audit } from "../../services/audit";
import { addPoints, ensureCard } from "../../services/loyalty";
import { paidTotal, logEvent } from "../../services/appointments";
import { getSettings } from "../../services/settings";
import { h, HttpError, id, paging, zDay, zOptStr, toCsv } from "../../util";
import { romeToDate, addDays } from "../../time";

const r = Router();

// ---------- pagamenti ----------
r.get("/payments", requirePerm("pagamenti"), h(async (req, res) => {
  const q = z.object({ from: zDay, to: zDay, method: z.string().optional(), status: z.string().optional() }).parse(req.query);
  const from = romeToDate(q.from, "00:00"), to = romeToDate(addDays(q.to, 1), "00:00");
  const where = and(
    sql`coalesce(${payments.paidAt}, ${payments.createdAt}) >= ${from}`, sql`coalesce(${payments.paidAt}, ${payments.createdAt}) < ${to}`,
    q.method ? eq(payments.method, q.method) : undefined, q.status ? eq(payments.status, q.status) : undefined,
  );
  const rows = await db.select({ p: payments, customer: sql<string>`${users.firstName} || ' ' || ${users.lastName}` })
    .from(payments).leftJoin(users, eq(users.id, payments.customerId)).where(where).orderBy(desc(payments.createdAt)).limit(1000);
  const list = rows.map((x) => ({ ...x.p, customer: x.customer }));
  if (req.query.format === "csv") {
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="incassi-${q.from}-${q.to}.csv"`);
    return res.send(toCsv(list.map((p) => ({ data: p.paidAt ?? p.createdAt, cliente: p.customer, tipo: p.kind, metodo: p.methodLabel || p.method, importo: ((p.kind === "rimborso" ? -1 : 1) * p.amountCents / 100).toFixed(2), stato: p.status, appuntamento: p.appointmentId, ordine: p.orderId, note: p.note }))));
  }
  const paid = list.filter((p) => p.status === "pagato");
  const byMethod: Record<string, number> = {};
  for (const p of paid) byMethod[p.method] = (byMethod[p.method] || 0) + (p.kind === "rimborso" ? -p.amountCents : p.amountCents);
  res.json({ rows: list, totalCents: Object.values(byMethod).reduce((a, b) => a + b, 0), byMethod });
}));

const manualPayment = z.object({
  appointmentId: z.number().int().positive().nullable().optional(), orderId: z.number().int().positive().nullable().optional(),
  boardingId: z.number().int().positive().nullable().optional(), customerId: z.number().int().positive().nullable().optional(),
  kind: z.enum(["acconto", "saldo", "totale", "parziale", "rimborso"]),
  method: z.enum(["contanti", "pos", "satispay", "bonifico_istantaneo", "bonifico", "online", "altro"]), methodLabel: zOptStr(60),
  amountCents: z.number().int().positive().max(10_000_000), note: zOptStr(1000), paidDate: zDay.optional(),
});

/** Registrazione incasso in negozio. Previene doppioni identici registrati a pochi secondi di distanza. */
r.post("/payments", requirePerm("pagamenti"), h(async (req, res) => {
  const d = manualPayment.parse(req.body);
  const p = await db.transaction(async (tx) => {
    let customerId = d.customerId ?? null;
    if (d.appointmentId) {
      const [a] = await tx.select().from(appointments).where(eq(appointments.id, d.appointmentId));
      if (!a) throw new HttpError(404, "Appuntamento non trovato");
      customerId = a.customerId;
      await tx.execute(sql`SELECT pg_advisory_xact_lock(777, ${d.appointmentId}::int)`);
      if (d.kind === "rimborso" && d.amountCents > (await paidTotal(a.id, tx))) throw new HttpError(400, "Il rimborso supera quanto incassato");
    }
    if (d.orderId) {
      const [o] = await tx.select().from(orders).where(eq(orders.id, d.orderId));
      if (!o) throw new HttpError(404, "Ordine non trovato");
      customerId = o.customerId;
    }
    const [dup] = await tx.select({ id: payments.id }).from(payments).where(and(
      eq(payments.amountCents, d.amountCents), eq(payments.method, d.method), eq(payments.kind, d.kind),
      d.appointmentId ? eq(payments.appointmentId, d.appointmentId) : sql`${payments.appointmentId} is null`,
      d.orderId ? eq(payments.orderId, d.orderId) : sql`${payments.orderId} is null`,
      gte(payments.createdAt, new Date(Date.now() - 60_000)),
    ));
    if (dup) throw new HttpError(409, "Pagamento identico appena registrato: possibile doppio inserimento");
    const paidAt = d.paidDate ? romeToDate(d.paidDate, "12:00") : new Date();
    const { paidDate, ...rest } = d;
    const [row] = await tx.insert(payments).values({ ...rest, customerId, status: "pagato", paidAt, createdBy: req.user!.id }).returning();
    if (d.appointmentId) {
      await logEvent(tx, d.appointmentId, req.user!.id, "pagamento_" + d.kind, null, null, { amountCents: d.amountCents, method: d.method });
      // se era in attesa di pagamento e ora è coperto, conferma
      const [a] = await tx.select().from(appointments).where(eq(appointments.id, d.appointmentId));
      const due = a.paymentMode === "saldo" ? (a.finalPriceCents ?? a.estimatedPriceCents ?? 0) : (a.depositCents ?? 0);
      if (a.status === "attesa_pagamento" && (await paidTotal(a.id, tx)) >= due) {
        await tx.update(appointments).set({ status: "confermata", updatedAt: new Date() }).where(eq(appointments.id, a.id));
        await logEvent(tx, a.id, req.user!.id, "conferma_pagamento", "attesa_pagamento", "confermata");
      }
    }
    return row;
  });
  await audit(req, "create", "payment", p.id, d);
  res.status(201).json(p);
}));

/** Annullamento di una registrazione errata (non si cancella: resta tracciata). */
r.post("/payments/:id/void", requireAdmin, h(async (req, res) => {
  const { reason } = z.object({ reason: z.string().trim().min(3).max(500) }).parse(req.body);
  const [p] = await db.update(payments).set({ status: "annullato", note: sql`coalesce(${payments.note} || E'\n', '') || ${"ANNULLATO: " + reason}` })
    .where(and(eq(payments.id, id(req.params.id)), eq(payments.status, "pagato"))).returning();
  if (!p) throw new HttpError(400, "Pagamento non annullabile");
  await audit(req, "void", "payment", p.id, { reason });
  res.json(p);
}));

r.get("/payment-methods", requirePerm("pagamenti"), h(async (_req, res) => {
  const s = await getSettings();
  res.json({ custom: s.payments.customMethods });
}));

// ---------- self-service ----------
r.use("/selfservice", crud({
  table: selfserviceIncomes, entity: "selfservice_income", perm: "selfservice", filters: ["station", "method", "category"],
  order: [{ col: "incomeDate", dir: "desc" }, { col: "id", dir: "desc" }],
  schema: z.object({
    incomeDate: zDay, station: z.string().trim().min(1).max(60), amountCents: z.number().int().positive().max(10_000_000),
    method: z.enum(["contanti", "pos", "satispay", "bonifico_istantaneo", "bonifico", "altro"]).default("contanti"),
    category: zOptStr(60), note: zOptStr(1000),
  }),
  afterSave: async () => {},
}));

r.get("/selfservice-summary", requirePerm("selfservice"), h(async (req, res) => {
  const q = z.object({ from: zDay, to: zDay }).parse(req.query);
  const where = and(gte(selfserviceIncomes.incomeDate, q.from), lte(selfserviceIncomes.incomeDate, q.to));
  const [byStation, byDay, [tot]] = await Promise.all([
    db.select({ station: selfserviceIncomes.station, cents: sql<number>`sum(${selfserviceIncomes.amountCents})::int` }).from(selfserviceIncomes).where(where).groupBy(selfserviceIncomes.station),
    db.select({ day: selfserviceIncomes.incomeDate, cents: sql<number>`sum(${selfserviceIncomes.amountCents})::int` }).from(selfserviceIncomes).where(where).groupBy(selfserviceIncomes.incomeDate).orderBy(asc(selfserviceIncomes.incomeDate)),
    db.select({ cents: sql<number>`coalesce(sum(${selfserviceIncomes.amountCents}),0)::int` }).from(selfserviceIncomes).where(where),
  ]);
  res.json({ totalCents: tot.cents, byStation, byDay });
}));

// ---------- fidelity card ----------
r.get("/loyalty/cards", requirePerm("fidelity"), h(async (req, res) => {
  const { page, pageSize, offset } = paging(req);
  const q = String(req.query.q || "").trim();
  const where = q ? or(ilike(loyaltyCards.code, `%${q}%`), ilike(users.lastName, `%${q}%`), ilike(users.firstName, `%${q}%`), ilike(users.email, `%${q}%`)) : undefined;
  const rows = await db.select({ c: loyaltyCards, name: sql<string>`${users.firstName} || ' ' || ${users.lastName}`, email: users.email })
    .from(loyaltyCards).innerJoin(users, eq(users.id, loyaltyCards.customerId)).where(where).orderBy(desc(loyaltyCards.points)).limit(pageSize).offset(offset);
  res.json({ rows: rows.map((x) => ({ ...x.c, name: x.name, email: x.email })), page, pageSize });
}));

r.post("/loyalty/adjust", requirePerm("fidelity"), h(async (req, res) => {
  const d = z.object({ customerId: z.number().int().positive(), points: z.number().int().min(-100_000).max(100_000).refine((n) => n !== 0), reason: z.string().trim().min(2).max(160), rewardId: z.number().int().positive().optional() }).parse(req.body);
  const out = await db.transaction(async (tx) => {
    const card = await ensureCard(d.customerId, tx);
    const [locked] = await tx.select().from(loyaltyCards).where(eq(loyaltyCards.id, card.id)).for("update");
    if (d.points < 0 && locked.points + d.points < 0) throw new HttpError(400, "Punti insufficienti");
    await addPoints(card.id, d.points, d.reason, { createdBy: req.user!.id }, tx);
    const [c] = await tx.select().from(loyaltyCards).where(eq(loyaltyCards.id, card.id));
    return c;
  });
  await audit(req, "loyalty_adjust", "loyalty_card", out.id, d);
  res.json(out);
}));

r.use("/loyalty/rewards", crud({
  table: loyaltyRewards, entity: "loyalty_reward", perm: "fidelity", order: [{ col: "pointsCost", dir: "asc" }],
  schema: z.object({ name: z.string().trim().min(1).max(120), description: zOptStr(1000), pointsCost: z.number().int().positive(), active: z.boolean().default(true) }),
}));

export default r;
