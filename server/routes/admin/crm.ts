import { Router } from "express";
import crypto from "node:crypto";
import { z } from "zod";
import { and, asc, desc, eq, ilike, or, sql, inArray } from "drizzle-orm";
import { db } from "../../db";
import {
  users, dogs, dogCustomFields, appointments, services, operators, payments, loyaltyCards, loyaltyTransactions, boardingRequests, orders,
} from "../../../shared/schema";
import { requirePerm, hashPassword, publicUser } from "../../auth";
import { crud } from "../../crud";
import { dogSchema, validateCustomFields } from "../account";
import { ensureCard } from "../../services/loyalty";
import { audit } from "../../services/audit";
import { sendEmail, emailLayout, p } from "../../services/email";
import { h, HttpError, id, paging, zOptStr, zOptDay, toCsv } from "../../util";

const r = Router();

// ---------- clienti ----------
r.get("/customers", requirePerm("clienti"), h(async (req, res) => {
  const { page, pageSize, offset } = paging(req);
  const q = String(req.query.q || "").trim();
  const where = and(eq(users.role, "customer"), q ? or(
    ilike(users.firstName, `%${q}%`), ilike(users.lastName, `%${q}%`), ilike(users.email, `%${q}%`), ilike(users.phone, `%${q}%`),
    sql`exists (select 1 from dogs d where d.owner_id = ${users.id} and d.name ilike ${"%" + q + "%"})`,
  ) : undefined);
  const [rows, [{ count }]] = await Promise.all([
    db.select({
      id: users.id, firstName: users.firstName, lastName: users.lastName, email: users.email, phone: users.phone, city: users.city,
      active: users.active, consentMarketing: users.consentMarketing, createdAt: users.createdAt,
      dogs: sql<string>`(select string_agg(d.name, ', ') from dogs d where d.owner_id = ${users.id} and not d.archived)`,
      lastVisit: sql<string>`(select max(a.start_at) from appointments a where a.customer_id = ${users.id} and a.status = 'completata')`,
    }).from(users).where(where).orderBy(asc(users.lastName), asc(users.firstName)).limit(pageSize).offset(offset),
    db.select({ count: sql<number>`count(*)::int` }).from(users).where(where),
  ]);
  res.json({ rows, total: count, page, pageSize });
}));

r.get("/customers/export.csv", requirePerm("clienti"), h(async (_req, res) => {
  const rows = await db.select({
    nome: users.firstName, cognome: users.lastName, email: users.email, telefono: users.phone, indirizzo: users.address, comune: users.city,
    provincia: users.province, cap: users.cap, data_nascita: users.birthDate, consenso_marketing: users.consentMarketing, registrato: users.createdAt,
  }).from(users).where(eq(users.role, "customer")).orderBy(asc(users.lastName));
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="clienti.csv"');
  res.send(toCsv(rows));
}));

r.get("/customers/:id", requirePerm("clienti"), h(async (req, res) => {
  const cid = id(req.params.id);
  const [u] = await db.select().from(users).where(eq(users.id, cid));
  if (!u) throw new HttpError(404, "Cliente non trovato");
  const card = await ensureCard(cid);
  const [ds, apps, pays, lt, board, ords] = await Promise.all([
    db.select().from(dogs).where(eq(dogs.ownerId, cid)).orderBy(asc(dogs.name)),
    db.select({ a: appointments, serviceName: services.name, operatorName: operators.name }).from(appointments)
      .innerJoin(services, eq(services.id, appointments.serviceId)).leftJoin(operators, eq(operators.id, appointments.operatorId))
      .where(eq(appointments.customerId, cid)).orderBy(desc(appointments.startAt)).limit(200),
    db.select().from(payments).where(eq(payments.customerId, cid)).orderBy(desc(payments.createdAt)).limit(200),
    db.select().from(loyaltyTransactions).where(eq(loyaltyTransactions.cardId, card.id)).orderBy(desc(loyaltyTransactions.createdAt)).limit(100),
    db.select().from(boardingRequests).where(eq(boardingRequests.customerId, cid)).orderBy(desc(boardingRequests.startDate)),
    db.select().from(orders).where(eq(orders.customerId, cid)).orderBy(desc(orders.createdAt)).limit(100),
  ]);
  res.json({
    customer: publicUser(u), dogs: ds,
    appointments: apps.map((x) => ({ ...x.a, serviceName: x.serviceName, operatorName: x.operatorName })),
    payments: pays, loyalty: { card, transactions: lt }, boarding: board, orders: ords,
  });
}));

const customerSchema = z.object({
  firstName: z.string().trim().min(1).max(100), lastName: z.string().trim().min(1).max(100),
  email: z.string().trim().toLowerCase().email().max(255), phone: zOptStr(40),
  address: zOptStr(), city: zOptStr(120), province: zOptStr(10), cap: zOptStr(10), country: zOptStr(80),
  birthDate: zOptDay, notes: zOptStr(4000),
  consentPrivacy: z.boolean().default(false), consentMarketing: z.boolean().default(false),
  commEmail: z.boolean().default(true), commWhatsapp: z.boolean().default(false), active: z.boolean().default(true),
});

/** Creazione cliente dal banco: password casuale, il cliente potrà reimpostarla con "password dimenticata". */
r.post("/customers", requirePerm("clienti"), h(async (req, res) => {
  const d = customerSchema.extend({ sendInvite: z.boolean().optional() }).parse(req.body);
  const [exists] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${d.email}`);
  if (exists) throw new HttpError(409, "Email già registrata");
  const { sendInvite, ...data } = d;
  const [u] = await db.insert(users).values({ ...data, role: "customer", passwordHash: await hashPassword(crypto.randomBytes(24).toString("hex")), consentDate: new Date() }).returning();
  await ensureCard(u.id);
  if (sendInvite) {
    const base = process.env.PUBLIC_URL || "";
    await sendEmail(u.email, "Il tuo account Dog's Planet", emailLayout("Il tuo account è pronto", p(`Ciao ${u.firstName}, abbiamo creato il tuo account. Imposta la tua password con "Password dimenticata" e accedi per vedere appuntamenti e Fidelity Card.`), { label: "Accedi", url: `${base}/password-dimenticata` }), "invite");
  }
  await audit(req, "create", "customer", u.id);
  res.status(201).json(publicUser(u));
}));

r.patch("/customers/:id", requirePerm("clienti"), h(async (req, res) => {
  const d = customerSchema.partial().parse(req.body);
  const [u] = await db.update(users).set({ ...d, updatedAt: new Date() }).where(and(eq(users.id, id(req.params.id)), eq(users.role, "customer"))).returning();
  if (!u) throw new HttpError(404, "Cliente non trovato");
  await audit(req, "update", "customer", u.id, { fields: Object.keys(d) });
  res.json(publicUser(u));
}));

// ---------- cani (lato salone) ----------
r.post("/customers/:id/dogs", requirePerm("clienti"), h(async (req, res) => {
  const d = dogSchema.parse(req.body);
  d.customFields = await validateCustomFields(d.customFields);
  const [dog] = await db.insert(dogs).values({ ...d, ownerId: id(req.params.id) } as any).returning();
  await audit(req, "create", "dog", dog.id);
  res.status(201).json(dog);
}));
r.patch("/dogs/:id", requirePerm("clienti"), h(async (req, res) => {
  const d = dogSchema.extend({ archived: z.boolean() }).partial().parse(req.body);
  if (d.customFields) d.customFields = await validateCustomFields(d.customFields);
  const [dog] = await db.update(dogs).set({ ...d, updatedAt: new Date() } as any).where(eq(dogs.id, id(req.params.id))).returning();
  if (!dog) throw new HttpError(404, "Cane non trovato");
  await audit(req, "update", "dog", dog.id, { fields: Object.keys(d) });
  res.json(dog);
}));
r.get("/dogs", requirePerm("clienti"), h(async (req, res) => {
  const ownerId = req.query.ownerId ? id(req.query.ownerId) : null;
  const q = String(req.query.q || "").trim();
  res.json(await db.select({ d: dogs, owner: sql<string>`${users.firstName} || ' ' || ${users.lastName}` }).from(dogs).innerJoin(users, eq(users.id, dogs.ownerId))
    .where(and(ownerId ? eq(dogs.ownerId, ownerId) : undefined, q ? or(ilike(dogs.name, `%${q}%`), ilike(dogs.breed, `%${q}%`)) : undefined, eq(dogs.archived, false)))
    .orderBy(asc(dogs.name)).limit(100).then((rows) => rows.map((x) => ({ ...x.d, owner: x.owner }))));
}));

// ---------- campi personalizzati scheda cane ----------
r.use("/dog-fields", crud({
  table: dogCustomFields, entity: "dog_field", perm: "clienti",
  order: [{ col: "sortOrder", dir: "asc" }, { col: "id", dir: "asc" }],
  schema: z.object({
    fieldKey: z.string().trim().regex(/^[a-z0-9_]{2,60}$/, "solo lettere minuscole, numeri e _"),
    label: z.string().trim().min(1).max(120),
    fieldType: z.enum(["text", "number", "date", "select", "checkbox"]),
    options: z.array(z.string().trim().min(1).max(80)).max(50).default([]),
    required: z.boolean().default(false),
    section: z.enum(["principali", "pelo", "benessere", "alimentazione", "altro"]).default("altro"),
    sortOrder: z.coerce.number().int().default(0),
    active: z.boolean().default(true),
  }),
}));

export default r;
