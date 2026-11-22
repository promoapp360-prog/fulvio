import { Router } from "express";
import { z } from "zod";
import { and, asc, desc, eq, inArray, isNull, sql, gte } from "drizzle-orm";
import { db } from "../db";
import {
  users, dogs, dogCustomFields, appointments, services, operators, payments, loyaltyCards, loyaltyTransactions, loyaltyRewards,
  boardingRequests, orders, orderItems, products, notifications, pushSubscriptions, promotions, appointmentEvents,
} from "../../shared/schema";
import { requireAuth, publicUser } from "../auth";
import { createRequest, applyAction, paidTotal, logEvent } from "../services/appointments";
import { ensureCard } from "../services/loyalty";
import { getSettings } from "../services/settings";
import { createCheckout, stripeEnabled } from "../services/payments";
import { notifyStaff } from "../services/notify";
import { audit } from "../services/audit";
import { h, HttpError, id, zOptStr, zOptDay, zDay, zTime } from "../util";
import { romeToDate, todayRome, fmtRome } from "../time";

const r = Router();
r.use(requireAuth);

// ---------- profilo ----------
const profileSchema = z.object({
  firstName: z.string().trim().min(1).max(100), lastName: z.string().trim().min(1).max(100),
  phone: z.string().trim().min(6).max(40),
  address: zOptStr(), city: zOptStr(120), province: zOptStr(10), cap: zOptStr(10), country: zOptStr(80),
  birthDate: zOptDay, notes: zOptStr(2000),
  commEmail: z.boolean(), commPush: z.boolean(), commWhatsapp: z.boolean(), consentMarketing: z.boolean(),
}).partial();

r.get("/profile", (req, res) => res.json(publicUser(req.user!)));
r.patch("/profile", h(async (req, res) => {
  const d = profileSchema.parse(req.body);
  const extra = d.consentMarketing !== undefined && d.consentMarketing !== req.user!.consentMarketing ? { consentDate: new Date() } : {};
  const [u] = await db.update(users).set({ ...d, ...extra, updatedAt: new Date() }).where(eq(users.id, req.user!.id)).returning();
  await audit(req, "profile_update", "user", u.id, { fields: Object.keys(d) });
  res.json(publicUser(u));
}));

/** Esportazione dati personali (GDPR art. 20) */
r.get("/export", h(async (req, res) => {
  const uid = req.user!.id;
  const [myDogs, myApps, myPays, myOrders, myBoard] = await Promise.all([
    db.select().from(dogs).where(eq(dogs.ownerId, uid)),
    db.select().from(appointments).where(eq(appointments.customerId, uid)),
    db.select().from(payments).where(eq(payments.customerId, uid)),
    db.select().from(orders).where(eq(orders.customerId, uid)),
    db.select().from(boardingRequests).where(eq(boardingRequests.customerId, uid)),
  ]);
  res.setHeader("Content-Disposition", 'attachment; filename="miei-dati-dogs-planet.json"');
  res.json({ profilo: publicUser(req.user!), cani: myDogs, appuntamenti: myApps, pagamenti: myPays, ordini: myOrders, pensione: myBoard });
}));

// ---------- cani ----------
const dogSchema = z.object({
  name: z.string().trim().min(1).max(80),
  breed: zOptStr(120),
  size: z.enum(["piccola", "media", "grande", "gigante"]),
  weightKg: z.union([z.coerce.number().min(0).max(150), z.literal("").transform(() => null), z.null()]).optional().transform((v) => (v == null ? null : String(v))),
  birthDate: zOptDay, notes: zOptStr(2000),
  coatKnots: z.boolean().default(false), coatShedding: z.boolean().default(false), lastBath: zOptDay,
  coatType: zOptStr(80), coatNotes: zOptStr(2000),
  jointIssues: zOptStr(1000), dermatitis: zOptStr(1000), intolerances: zOptStr(1000), sensitivities: zOptStr(1000),
  aggressive: z.boolean().default(false), aggressiveNotes: zOptStr(1000), otherNeeds: zOptStr(1000), otherPets: zOptStr(1000),
  food: z.record(z.unknown()).default({}),
  customFields: z.record(z.unknown()).default({}),
  photoUrl: zOptStr(500),
});
export { dogSchema };

export async function validateCustomFields(values: Record<string, unknown>) {
  const defs = await db.select().from(dogCustomFields).where(eq(dogCustomFields.active, true));
  const out: Record<string, unknown> = {};
  for (const d of defs) {
    const v = values[d.fieldKey];
    if (v === undefined || v === null || v === "") {
      if (d.required) throw new HttpError(400, `Il campo "${d.label}" è obbligatorio`);
      continue;
    }
    switch (d.fieldType) {
      case "number": if (isNaN(Number(v))) throw new HttpError(400, `"${d.label}" deve essere un numero`); out[d.fieldKey] = Number(v); break;
      case "checkbox": out[d.fieldKey] = !!v; break;
      case "date": if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v))) throw new HttpError(400, `"${d.label}" non è una data valida`); out[d.fieldKey] = String(v); break;
      case "select": if (!d.options.includes(String(v))) throw new HttpError(400, `Valore non valido per "${d.label}"`); out[d.fieldKey] = String(v); break;
      default: out[d.fieldKey] = String(v).slice(0, 2000);
    }
  }
  return out;
}

r.get("/dog-fields", h(async (_req, res) => {
  res.json(await db.select().from(dogCustomFields).where(eq(dogCustomFields.active, true)).orderBy(asc(dogCustomFields.sortOrder)));
}));

r.get("/dogs", h(async (req, res) => {
  res.json(await db.select().from(dogs).where(and(eq(dogs.ownerId, req.user!.id), eq(dogs.archived, false))).orderBy(asc(dogs.name)));
}));

r.post("/dogs", h(async (req, res) => {
  const d = dogSchema.parse(req.body);
  d.customFields = await validateCustomFields(d.customFields);
  const [dog] = await db.insert(dogs).values({ ...d, ownerId: req.user!.id } as any).returning();
  res.status(201).json(dog);
}));

r.patch("/dogs/:id", h(async (req, res) => {
  const d = dogSchema.partial().parse(req.body);
  if (d.customFields) d.customFields = await validateCustomFields(d.customFields);
  const [dog] = await db.update(dogs).set({ ...d, updatedAt: new Date() } as any).where(and(eq(dogs.id, id(req.params.id)), eq(dogs.ownerId, req.user!.id))).returning();
  if (!dog) throw new HttpError(404, "Cane non trovato");
  res.json(dog);
}));

r.delete("/dogs/:id", h(async (req, res) => {
  // archiviazione: lo storico trattamenti resta consultabile dal salone
  const [dog] = await db.update(dogs).set({ archived: true, updatedAt: new Date() }).where(and(eq(dogs.id, id(req.params.id)), eq(dogs.ownerId, req.user!.id))).returning();
  if (!dog) throw new HttpError(404, "Cane non trovato");
  res.json({ ok: true });
}));

// ---------- appuntamenti ----------
r.get("/appointments", h(async (req, res) => {
  const rows = await db.select({
    a: appointments, serviceName: services.name, dogName: dogs.name, operatorName: operators.name,
  }).from(appointments)
    .innerJoin(services, eq(services.id, appointments.serviceId))
    .innerJoin(dogs, eq(dogs.id, appointments.dogId))
    .leftJoin(operators, eq(operators.id, appointments.operatorId))
    .where(eq(appointments.customerId, req.user!.id))
    .orderBy(desc(appointments.startAt)).limit(200);
  const ids = rows.map((x) => x.a.id);
  const pays = ids.length ? await db.select().from(payments).where(and(inArray(payments.appointmentId, ids), eq(payments.status, "pagato"))) : [];
  res.json(rows.map(({ a, ...rest }) => {
    const paid = pays.filter((p) => p.appointmentId === a.id).reduce((s, p) => s + (p.kind === "rimborso" ? -p.amountCents : p.amountCents), 0);
    return { ...a, ...rest, adminNotes: undefined, paidCents: paid };
  }));
}));

r.post("/appointments", h(async (req, res) => {
  const d = z.object({
    dogId: z.number().int().positive(), serviceId: z.number().int().positive(), operatorId: z.number().int().positive().nullable(),
    date: zDay, time: zTime, notes: zOptStr(1000),
  }).parse(req.body);
  if (d.date < todayRome()) throw new HttpError(400, "Data nel passato");
  const app = await createRequest(req.user!.id, { ...d, start: romeToDate(d.date, d.time) });
  res.status(201).json({ ok: true, id: app.id, message: "Richiesta inviata. Attendi la conferma di Dog's Planet." });
}));

r.post("/appointments/:id/action", h(async (req, res) => {
  const { action } = z.object({ action: z.enum(["accetta_proposta", "rifiuta_proposta", "annulla"]) }).parse(req.body);
  res.json(await applyAction(id(req.params.id), { id: req.user!.id, role: "customer" }, { action }));
}));

/** Richiesta di modifica/cancellazione per appuntamenti già confermati (gestita dal salone). */
r.post("/appointments/:id/change-request", h(async (req, res) => {
  const { message, kind } = z.object({ message: z.string().trim().min(3).max(1000), kind: z.enum(["modifica", "cancellazione"]) }).parse(req.body);
  const aid = id(req.params.id);
  const [a] = await db.select().from(appointments).where(and(eq(appointments.id, aid), eq(appointments.customerId, req.user!.id)));
  if (!a) throw new HttpError(404, "Appuntamento non trovato");
  const text = `[${kind.toUpperCase()}] ${message}`;
  await db.update(appointments).set({ changeRequest: text, updatedAt: new Date() }).where(eq(appointments.id, aid));
  await logEvent(db, aid, req.user!.id, "richiesta_" + kind, a.status, a.status, { message });
  await notifyStaff("richieste", { title: `Richiesta di ${kind}`, body: `${req.user!.firstName} ${req.user!.lastName}: ${message}`, url: `/admin/richieste?id=${aid}` });
  res.json({ ok: true });
}));

r.get("/appointments/:id/events", h(async (req, res) => {
  const aid = id(req.params.id);
  const [a] = await db.select({ id: appointments.id }).from(appointments).where(and(eq(appointments.id, aid), eq(appointments.customerId, req.user!.id)));
  if (!a) throw new HttpError(404, "Non trovato");
  res.json(await db.select({ action: appointmentEvents.action, toStatus: appointmentEvents.toStatus, createdAt: appointmentEvents.createdAt })
    .from(appointmentEvents).where(eq(appointmentEvents.appointmentId, aid)).orderBy(asc(appointmentEvents.id)));
}));

/** Avvia il pagamento online richiesto da Dog's Planet. */
r.post("/appointments/:id/pay", h(async (req, res) => {
  const aid = id(req.params.id);
  const [row] = await db.select({ a: appointments, serviceName: services.name }).from(appointments)
    .innerJoin(services, eq(services.id, appointments.serviceId))
    .where(and(eq(appointments.id, aid), eq(appointments.customerId, req.user!.id)));
  if (!row) throw new HttpError(404, "Appuntamento non trovato");
  const a = row.a;
  if (a.status !== "attesa_pagamento") throw new HttpError(400, "Nessun pagamento richiesto per questo appuntamento");
  const s = await getSettings();
  if (!stripeEnabled() || !s.payments.onlineEnabled) throw new HttpError(400, "Pagamento online non attivo: paga in negozio");
  const total = a.paymentMode === "saldo" ? (a.finalPriceCents ?? a.estimatedPriceCents ?? 0) : (a.depositCents ?? 0);
  const due = total - (await paidTotal(a.id));
  if (due <= 0) throw new HttpError(400, "Importo già saldato");
  const base = process.env.PUBLIC_URL || `${req.protocol}://${req.get("host")}`;
  const kind = a.paymentMode === "saldo" ? "saldo" : "acconto";
  const co = await createCheckout({
    amountCents: due, email: req.user!.email,
    description: `Dog's Planet – ${kind} ${row.serviceName} (${fmtRome(a.startAt)})`,
    successUrl: `${base}/account/appuntamenti?pagamento=ok&session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${base}/account/appuntamenti?pagamento=annullato`,
    metadata: { appointmentId: String(a.id), customerId: String(req.user!.id), kind },
  });
  await db.insert(payments).values({
    appointmentId: a.id, customerId: req.user!.id, kind, method: "online", amountCents: due, status: "in_attesa",
    provider: "stripe", providerRef: co.id, checkoutUrl: co.url,
  });
  res.json({ url: co.url });
}));

r.get("/payments", h(async (req, res) => {
  res.json(await db.select().from(payments).where(eq(payments.customerId, req.user!.id)).orderBy(desc(payments.createdAt)).limit(200));
}));

// ---------- fidelity ----------
r.get("/loyalty", h(async (req, res) => {
  const card = await ensureCard(req.user!.id);
  const [tx, rewards] = await Promise.all([
    db.select().from(loyaltyTransactions).where(eq(loyaltyTransactions.cardId, card.id)).orderBy(desc(loyaltyTransactions.createdAt)).limit(100),
    db.select().from(loyaltyRewards).where(eq(loyaltyRewards.active, true)).orderBy(asc(loyaltyRewards.pointsCost)),
  ]);
  res.json({ card, transactions: tx, rewards });
}));

// ---------- pensione casalinga ----------
r.get("/boarding", h(async (req, res) => {
  res.json(await db.select({ b: boardingRequests, dogName: dogs.name }).from(boardingRequests).innerJoin(dogs, eq(dogs.id, boardingRequests.dogId))
    .where(eq(boardingRequests.customerId, req.user!.id)).orderBy(desc(boardingRequests.startDate)));
}));
r.post("/boarding", h(async (req, res) => {
  const s = await getSettings();
  if (!s.site.boardingEnabled) throw new HttpError(400, "Le richieste di pensione non sono al momento attive");
  const d = z.object({ dogId: z.number().int().positive(), startDate: zDay, endDate: zDay, customerNotes: zOptStr(2000) }).parse(req.body);
  if (d.endDate < d.startDate || d.startDate < todayRome()) throw new HttpError(400, "Date non valide");
  const [dog] = await db.select().from(dogs).where(and(eq(dogs.id, d.dogId), eq(dogs.ownerId, req.user!.id)));
  if (!dog) throw new HttpError(404, "Cane non trovato");
  const [b] = await db.insert(boardingRequests).values({ ...d, customerId: req.user!.id }).returning();
  await notifyStaff("pensione", { title: "Nuova richiesta pensione casalinga", body: `${dog.name}: dal ${d.startDate} al ${d.endDate}`, url: "/admin/pensione" });
  res.status(201).json(b);
}));
r.post("/boarding/:id/cancel", h(async (req, res) => {
  const [b] = await db.update(boardingRequests).set({ status: "annullata", updatedAt: new Date() })
    .where(and(eq(boardingRequests.id, id(req.params.id)), eq(boardingRequests.customerId, req.user!.id), inArray(boardingRequests.status, ["richiesta", "confermata"]))).returning();
  if (!b) throw new HttpError(400, "Richiesta non annullabile");
  await notifyStaff("pensione", { title: "Pensione annullata dal cliente", body: `Richiesta #${b.id}`, url: "/admin/pensione" });
  res.json(b);
}));

// ---------- shop ----------
r.get("/orders", h(async (req, res) => {
  const os = await db.select().from(orders).where(eq(orders.customerId, req.user!.id)).orderBy(desc(orders.createdAt)).limit(100);
  const items = os.length ? await db.select().from(orderItems).where(inArray(orderItems.orderId, os.map((o) => o.id))) : [];
  res.json(os.map((o) => ({ ...o, items: items.filter((i) => i.orderId === o.id) })));
}));

r.post("/orders", h(async (req, res) => {
  const s = await getSettings();
  if (!s.site.shopEnabled) throw new HttpError(400, "Lo shop online non è ancora attivo");
  const d = z.object({
    items: z.array(z.object({ productId: z.number().int().positive(), qty: z.number().int().min(1).max(50) })).min(1).max(50),
    delivery: z.enum(["ritiro", "consegna"]).default("ritiro"), notes: zOptStr(1000), promoCode: zOptStr(40),
  }).parse(req.body);
  if (d.delivery === "consegna" && s.shop.pickupOnly) throw new HttpError(400, "Al momento è disponibile solo il ritiro in negozio");
  const order = await db.transaction(async (tx) => {
    const prods = await tx.select().from(products).where(inArray(products.id, d.items.map((i) => i.productId)));
    let total = 0;
    const lines = d.items.map((i) => {
      const p = prods.find((x) => x.id === i.productId);
      if (!p || !p.active || !p.visibleOnline) throw new HttpError(400, "Prodotto non disponibile");
      if (p.stock < i.qty) throw new HttpError(409, `Disponibilità insufficiente per ${p.name}`);
      const unit = p.salePriceCents ?? p.priceCents;
      total += unit * i.qty;
      return { productId: p.id, name: p.name, qty: i.qty, unitPriceCents: unit };
    });
    let discount = 0;
    if (d.promoCode) {
      const today = todayRome();
      const [promo] = await tx.select().from(promotions).where(and(sql`upper(${promotions.code}) = upper(${d.promoCode})`, eq(promotions.active, true)));
      if (!promo || (promo.startsAt && promo.startsAt > today) || (promo.endsAt && promo.endsAt < today) || promo.appliesTo === "servizi") throw new HttpError(400, "Codice promozionale non valido");
      discount = promo.discountType === "percent" ? Math.round((total * promo.discountValue) / 100) : promo.discountType === "amount" ? Math.min(total, promo.discountValue) : 0;
    }
    const shipping = d.delivery === "consegna" && !(s.shop.freeShippingFromCents && total >= s.shop.freeShippingFromCents) ? s.shop.shippingCents : 0;
    const [o] = await tx.insert(orders).values({ customerId: req.user!.id, totalCents: total - discount + shipping, discountCents: discount, promoCode: d.promoCode, delivery: d.delivery, notes: d.notes }).returning();
    await tx.insert(orderItems).values(lines.map((l) => ({ ...l, orderId: o.id })));
    return o;
  });
  await notifyStaff("shop", { title: "Nuovo ordine shop", body: `Ordine #${order.id} – ${(order.totalCents / 100).toFixed(2)} €`, url: "/admin/ordini" });
  let url: string | null = null;
  if (stripeEnabled() && s.payments.onlineEnabled) {
    const base = process.env.PUBLIC_URL || `${req.protocol}://${req.get("host")}`;
    const co = await createCheckout({
      amountCents: order.totalCents, email: req.user!.email, description: `Dog's Planet – ordine #${order.id}`,
      successUrl: `${base}/account/ordini?pagamento=ok`, cancelUrl: `${base}/account/ordini?pagamento=annullato`,
      metadata: { orderId: String(order.id), customerId: String(req.user!.id), kind: "totale" },
    });
    await db.insert(payments).values({ orderId: order.id, customerId: req.user!.id, kind: "totale", method: "online", amountCents: order.totalCents, status: "in_attesa", provider: "stripe", providerRef: co.id, checkoutUrl: co.url });
    url = co.url;
  }
  res.status(201).json({ order, paymentUrl: url });
}));

// ---------- notifiche ----------
r.get("/notifications", h(async (req, res) => {
  res.json(await db.select().from(notifications).where(eq(notifications.userId, req.user!.id)).orderBy(desc(notifications.createdAt)).limit(50));
}));
r.post("/notifications/read", h(async (req, res) => {
  await db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.userId, req.user!.id), isNull(notifications.readAt)));
  res.json({ ok: true });
}));
r.post("/push/subscribe", h(async (req, res) => {
  const d = z.object({ endpoint: z.string().url().max(1000), keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }) }).parse(req.body);
  await db.insert(pushSubscriptions).values({ userId: req.user!.id, endpoint: d.endpoint, p256dh: d.keys.p256dh, auth: d.keys.auth })
    .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { userId: req.user!.id, p256dh: d.keys.p256dh, auth: d.keys.auth } });
  res.json({ ok: true });
}));
r.post("/push/unsubscribe", h(async (req, res) => {
  const { endpoint } = z.object({ endpoint: z.string() }).parse(req.body);
  await db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.userId, req.user!.id)));
  res.json({ ok: true });
}));

/** Prossimi appuntamenti per la dashboard cliente */
r.get("/summary", h(async (req, res) => {
  const uid = req.user!.id;
  const [[next], [{ n }], card] = await Promise.all([
    db.select({ a: appointments, serviceName: services.name, dogName: dogs.name }).from(appointments)
      .innerJoin(services, eq(services.id, appointments.serviceId)).innerJoin(dogs, eq(dogs.id, appointments.dogId))
      .where(and(eq(appointments.customerId, uid), gte(appointments.startAt, new Date()), inArray(appointments.status, ["richiesta", "in_valutazione", "proposta", "confermata", "attesa_pagamento"])))
      .orderBy(asc(appointments.startAt)).limit(1),
    db.select({ n: sql<number>`count(*)::int` }).from(notifications).where(and(eq(notifications.userId, uid), isNull(notifications.readAt))),
    ensureCard(uid),
  ]);
  res.json({ next: next ? { ...next.a, serviceName: next.serviceName, dogName: next.dogName, adminNotes: undefined } : null, unread: n, points: card.points, cardCode: card.code });
}));

export default r;
