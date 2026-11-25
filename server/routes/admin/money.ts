import { Router } from "express";
import { z } from "zod";
import { and, asc, desc, eq, gte, lt, lte, sql, ilike, or } from "drizzle-orm";
import { db } from "../../db";
import { payments, appointments, selfserviceIncomes, loyaltyCards, loyaltyTransactions, loyaltyRewards, users, orders, privacyContacts } from "../../../shared/schema";
import { requirePerm, requireAdmin } from "../../auth";
import { crud } from "../../crud";
import { audit } from "../../services/audit";
import { ensureCard, adjust, redeem, reverseFor, extendExpiry, upcomingExpiries } from "../../services/loyalty";
import { sendXlsx, sendPdf } from "../../services/exporter";
import { services as servicesT, dogs as dogsT } from "../../../shared/schema";
import { paidTotal, logEvent } from "../../services/appointments";
import { getSettings } from "../../services/settings";
import { h, HttpError, id, paging, zDay, zOptStr, toCsv } from "../../util";
import { romeToDate, addDays } from "../../time";
import membershipRoutes from "./membership";
import { cardTarget, memberPhone, memberPhoneSql, resolveCard } from "../../services/loyalty-membership";

const r = Router();
r.use(membershipRoutes);

// ---------- pagamenti ----------
r.get("/payments", requirePerm("incassi"), h(async (req, res) => {
  const q = z.object({ from: zDay, to: zDay, method: z.string().optional(), status: z.string().optional(), channel: z.enum(["toelettatura", "shop", "pensione", "altro"]).optional() }).parse(req.query);
  const from = romeToDate(q.from, "00:00"), to = romeToDate(addDays(q.to, 1), "00:00");
  const where = and(
    sql`coalesce(${payments.paidAt}, ${payments.createdAt}) >= ${from}`, sql`coalesce(${payments.paidAt}, ${payments.createdAt}) < ${to}`,
    q.method ? eq(payments.method, q.method) : undefined, q.status ? eq(payments.status, q.status) : undefined,
    q.channel === "toelettatura" ? sql`${payments.appointmentId} is not null` : q.channel === "shop" ? sql`${payments.orderId} is not null` : q.channel === "pensione" ? sql`${payments.boardingId} is not null`
      : q.channel === "altro" ? sql`${payments.appointmentId} is null and ${payments.orderId} is null and ${payments.boardingId} is null` : undefined,
  );
  const rows = await db.select({ p: payments, customer: sql<string>`${users.firstName} || ' ' || ${users.lastName}` })
    .from(payments).leftJoin(users, eq(users.id, payments.customerId)).where(where).orderBy(desc(payments.createdAt)).limit(1000);
  const list = rows.map((x) => ({ ...x.p, customer: x.customer }));
  if (req.query.format === "csv") {
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="incassi-${q.from}-${q.to}.csv"`);
    return res.send(toCsv(list.map((p) => ({ data: p.paidAt ?? p.createdAt, cliente: p.customer, causale: p.reason, tipo: p.kind, metodo: p.methodLabel || p.method, importo: ((p.kind === "rimborso" ? -1 : 1) * p.amountCents / 100).toFixed(2), stato: p.status, appuntamento: p.appointmentId, ordine: p.orderId, note: p.note }))));
  }
  if (req.query.format === "xlsx" || req.query.format === "pdf") {
    const sheet = { name: "Movimenti", columns: [
      { key: "data", label: "Data", width: 14 }, { key: "customer", label: "Cliente", width: 16 }, { key: "reason", label: "Causale", width: 18 }, { key: "rif", label: "Collegato a", width: 12 },
      { key: "kind", label: "Tipo", width: 9 }, { key: "metodo", label: "Metodo", width: 12 }, { key: "importo", label: "Importo", money: true, width: 10 }, { key: "status", label: "Stato", width: 9 }, { key: "note", label: "Note", width: 18 }],
      rows: list.map((p) => ({ ...p, data: (p.paidAt ?? p.createdAt).toLocaleString("it-IT", { timeZone: "Europe/Rome" }), rif: p.appointmentId ? `App. #${p.appointmentId}` : p.orderId ? `Ordine #${p.orderId}` : "", metodo: p.methodLabel || p.method, importo: (p.kind === "rimborso" ? -1 : 1) * p.amountCents })) } as any;
    return req.query.format === "xlsx" ? sendXlsx(res, `incassi-${q.from}-${q.to}`, [sheet]) : sendPdf(res, `incassi-${q.from}-${q.to}`, "Pagamenti e incassi", `Dal ${q.from} al ${q.to}`, [sheet], "Contabilità gestionale: non sostituisce gli obblighi fiscali né la fatturazione elettronica.");
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
  amountCents: z.number().int().positive().max(10_000_000), note: zOptStr(1000), paidDate: zDay.optional(), reason: zOptStr(160),
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
    // rimborso: storno proporzionale dei punti fedeltà accreditati
    if (d.kind === "rimborso" && (d.appointmentId || d.orderId)) {
      const ref = d.appointmentId ? { appointmentId: d.appointmentId } : { orderId: d.orderId! };
      const [{ paid }] = await tx.select({ paid: sql<number>`coalesce(sum(case when kind='rimborso' then 0 else amount_cents end),0)::int` }).from(payments)
        .where(and(d.appointmentId ? eq(payments.appointmentId, d.appointmentId) : eq(payments.orderId, d.orderId!), eq(payments.status, "pagato")));
      await reverseFor(ref, d.amountCents, paid, `Storno per rimborso di ${(d.amountCents / 100).toFixed(2)} €`, req.user!.id, tx);
    }
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
  const p = await db.transaction(async (tx) => {
    const [p] = await tx.update(payments).set({ status: "annullato", note: sql`coalesce(${payments.note} || E'\n', '') || ${"ANNULLATO: " + reason}` })
      .where(and(eq(payments.id, id(req.params.id)), eq(payments.status, "pagato"))).returning();
    if (!p) throw new HttpError(400, "Pagamento non annullabile");
    if (p.kind !== "rimborso" && (p.appointmentId || p.orderId)) {
      const ref = p.appointmentId ? { appointmentId: p.appointmentId } : { orderId: p.orderId! };
      const [{ rest }] = await tx.select({ rest: sql<number>`coalesce(sum(case when kind='rimborso' then 0 else amount_cents end),0)::int` }).from(payments)
        .where(and(p.appointmentId ? eq(payments.appointmentId, p.appointmentId) : eq(payments.orderId, p.orderId!), eq(payments.status, "pagato")));
      await reverseFor(ref, p.amountCents, rest + p.amountCents, `Storno per pagamento annullato #${p.id}`, req.user!.id, tx);
    }
    return p;
  });
  await audit(req, "void", "payment", p.id, { reason });
  res.json(p);
}));

/** Importi ancora da incassare: appuntamenti completati/confermati e ordini non saldati. */
r.get("/outstanding", requirePerm("incassi"), h(async (_req, res) => {
  const apps = (await db.execute(sql`select a.id, a.start_at, a.status, coalesce(a.final_price_cents, a.estimated_price_cents) as price,
      coalesce((select sum(case when p.kind='rimborso' then -p.amount_cents else p.amount_cents end) from payments p where p.appointment_id = a.id and p.status='pagato'),0)::int as paid,
      u.first_name || ' ' || u.last_name as customer, d.name as dog, s.name as service
    from appointments a join users u on u.id = a.customer_id join dogs d on d.id = a.dog_id join services s on s.id = a.service_id
    where a.status in ('completata','confermata','attesa_pagamento') and coalesce(a.final_price_cents, a.estimated_price_cents) is not null
    order by a.start_at desc limit 500`)).rows.filter((r: any) => r.price - r.paid > 0);
  const ords = (await db.execute(sql`select o.id, o.created_at, o.status, o.total_cents as price,
      coalesce((select sum(case when p.kind='rimborso' then -p.amount_cents else p.amount_cents end) from payments p where p.order_id = o.id and p.status='pagato'),0)::int as paid,
      coalesce(u.first_name || ' ' || u.last_name, 'Banco') as customer
    from orders o left join users u on u.id = o.customer_id where o.status not in ('annullato') order by o.created_at desc limit 500`)).rows.filter((r: any) => r.price - r.paid > 0);
  res.json({ appointments: apps, orders: ords, totalCents: [...apps, ...ords].reduce((a: number, r: any) => a + r.price - r.paid, 0) });
}));

r.get("/payment-methods", requirePerm("pagamenti", "incassi"), h(async (_req, res) => {
  const s = await getSettings();
  res.json({ custom: s.payments.customMethods });
}));

// ---------- self-service ----------
r.use("/selfservice", crud({
  table: selfserviceIncomes, entity: "selfservice_income", perm: "pagamenti", filters: ["station", "method", "category"],
  order: [{ col: "incomeDate", dir: "desc" }, { col: "id", dir: "desc" }],
  schema: z.object({
    incomeDate: zDay, station: z.string().trim().min(1).max(60), amountCents: z.number().int().positive().max(10_000_000),
    method: z.enum(["contanti", "pos", "satispay", "bonifico_istantaneo", "bonifico", "altro"]).default("contanti"),
    category: zOptStr(60), note: zOptStr(1000),
  }),
  afterSave: async () => {},
}));

r.get("/selfservice-summary", requirePerm("incassi", "pagamenti"), h(async (req, res) => {
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
  const digits = memberPhone(q);
  const name = sql<string>`coalesce(nullif(concat_ws(' ', ${users.firstName}, ${users.lastName}), ''), concat_ws(' ', ${privacyContacts.firstName}, ${privacyContacts.lastName}))`;
  const where = and(eq(loyaltyCards.active, true), q ? or(
    ilike(loyaltyCards.code, `%${q}%`), sql`${name} ilike ${`%${q}%`}`,
    ilike(users.email, `%${q}%`), ilike(privacyContacts.email, `%${q}%`),
    digits.length >= 3 ? sql`(${memberPhoneSql(users.phone)} like ${`%${digits}%`} or ${memberPhoneSql(privacyContacts.phone)} like ${`%${digits}%`})` : undefined,
    sql`exists(select 1 from loyalty_cards previous where previous.merged_into_card_id = ${loyaltyCards.id} and previous.code ilike ${`%${q}%`})`,
  ) : undefined);
  const rows = await db.select({ c: loyaltyCards, name, email: sql`coalesce(${users.email}, ${privacyContacts.email})`, phone: sql`coalesce(${users.phone}, ${privacyContacts.phone})` })
    .from(loyaltyCards).leftJoin(users, eq(users.id, loyaltyCards.customerId)).leftJoin(privacyContacts, eq(privacyContacts.id, loyaltyCards.contactId))
    .where(where).orderBy(desc(loyaltyCards.points)).limit(pageSize).offset(offset);
  res.json({ rows: rows.map((x) => ({ ...x.c, name: x.name, email: x.email, phone: x.phone })), page, pageSize });
}));

/** Rettifica manuale motivata (+/-). */
r.post("/loyalty/adjust", requirePerm("fidelity"), h(async (req, res) => {
  const d = z.object({ points: z.number().int().min(-100_000).max(100_000).refine((n) => n !== 0), reason: z.string().trim().min(3).max(160) }).and(cardTarget).parse(req.body);
  const out = await db.transaction(async (tx) => {
    const card = await resolveCard(d, tx);
    await adjust(card.id, d.points, d.reason, req.user!.id, tx);
    const [c] = await tx.select().from(loyaltyCards).where(eq(loyaltyCards.id, card.id));
    return c;
  });
  await audit(req, "loyalty_adjust", "loyalty_card", out.id, d);
  res.json(out);
}));

/** Utilizzo punti: premio, sconto su un appuntamento, sconto prodotti o credito shop. */
r.post("/loyalty/redeem", requirePerm("fidelity", "pagamenti"), h(async (req, res) => {
  const d = z.object({
    points: z.number().int().positive().optional(), rewardId: z.number().int().positive().optional(),
    appointmentId: z.number().int().positive().optional(), note: zOptStr(160),
  }).and(cardTarget).parse(req.body);
  const s = await getSettings();
  const out = await db.transaction(async (tx) => {
    const card = await resolveCard(d, tx);
    let points = d.points ?? 0, valueCents: number | null = null, reason = d.note || "Utilizzo punti";
    if (d.rewardId) {
      const [rw] = await tx.select().from(loyaltyRewards).where(and(eq(loyaltyRewards.id, d.rewardId), eq(loyaltyRewards.active, true)));
      if (!rw) throw new HttpError(404, "Premio non disponibile");
      points = rw.pointsCost; valueCents = rw.valueCents ?? null; reason = `Premio: ${rw.name}`;
    } else {
      if (!s.loyalty.pointValueCents) throw new HttpError(400, "Imposta prima il valore di un punto in Impostazioni → Fidelity");
      if (points < (s.loyalty.minRedeemPoints || 0)) throw new HttpError(400, `Minimo ${s.loyalty.minRedeemPoints} punti`);
      valueCents = points * s.loyalty.pointValueCents;
    }
    if (d.appointmentId) {
      const [a] = await tx.select().from(appointments).where(and(eq(appointments.id, d.appointmentId), eq(appointments.customerId, card.customerId ?? 0)));
      if (!a) throw new HttpError(404, "Appuntamento non trovato");
      const price = a.finalPriceCents ?? a.estimatedPriceCents;
      if (price == null) throw new HttpError(400, "Imposta prima il prezzo dell'appuntamento");
      if (valueCents && valueCents > price) throw new HttpError(400, "Lo sconto supera il prezzo del servizio");
      if (valueCents) {
        await tx.update(appointments).set({ finalPriceCents: price - valueCents, updatedAt: new Date() }).where(eq(appointments.id, a.id));
        await logEvent(tx, a.id, req.user!.id, "sconto_punti", null, null, { points, valueCents });
      }
    }
    const t = await redeem(card.id, points, reason, { appointmentId: d.appointmentId ?? null, valueCents, createdBy: req.user!.id }, tx);
    const [c] = await tx.select().from(loyaltyCards).where(eq(loyaltyCards.id, card.id));
    return { card: c, transaction: t };
  });
  await audit(req, "loyalty_redeem", "loyalty_card", out.card.id, d);
  res.json(out);
}));

/** Proroga manuale della scadenza (tutti i lotti della tessera o uno solo). */
r.post("/loyalty/extend", requirePerm("fidelity"), h(async (req, res) => {
  const d = z.object({ newDate: zDay, reason: z.string().trim().min(3).max(160), lotId: z.number().int().positive().optional() }).and(cardTarget).parse(req.body);
  const card = await resolveCard(d);
  const n = await extendExpiry(card.id, romeToDate(d.newDate, "23:59"), d.reason, req.user!.id, d.lotId);
  await audit(req, "loyalty_extend", "loyalty_card", card.id, d);
  res.json({ updatedLots: n });
}));

r.get("/loyalty/cards/:customerId", requirePerm("fidelity"), h(async (req, res) => {
  const card = await ensureCard(id(req.params.customerId));
  const [tx, exp] = await Promise.all([
    db.select().from(loyaltyTransactions).where(eq(loyaltyTransactions.cardId, card.id)).orderBy(desc(loyaltyTransactions.id)).limit(200),
    upcomingExpiries(card.id),
  ]);
  res.json({ card, transactions: tx, expiries: exp });
}));

r.use("/loyalty/rewards", crud({
  table: loyaltyRewards, entity: "loyalty_reward", perm: "fidelity", order: [{ col: "pointsCost", dir: "asc" }],
  schema: z.object({
    name: z.string().trim().min(1).max(120), description: zOptStr(1000), pointsCost: z.number().int().positive(), active: z.boolean().default(true),
    rewardType: z.enum(["premio", "sconto_servizi", "sconto_prodotti", "credito_shop"]).default("premio"), valueCents: z.number().int().min(0).nullable().optional(),
  }),
}));

export default r;
