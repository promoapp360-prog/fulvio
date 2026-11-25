import { Router } from "express";
import crypto from "node:crypto";
import { z } from "zod";
import { and, asc, desc, eq, ilike, or, sql, inArray } from "drizzle-orm";
import { db } from "../../db";
import {
  users, dogs, dogCustomFields, appointments, services, operators, payments, loyaltyCards, loyaltyTransactions, boardingRequests, orders,
  guestCustomers,guestDogs,guestBookings,dogPhotos,
} from "../../../shared/schema";
import { requirePerm, hashPassword, publicUser } from "../../auth";
import { crud } from "../../crud";
import { dogSchema, validateCustomFields } from "../account";
import { ensureCard, upcomingExpiries } from "../../services/loyalty";
import { recordConsent } from "../../services/consents";
import { averageGapDays, normalizePhone } from "../../logic";
import { customerConsents, emailQueue, notifications } from "../../../shared/schema";
import { audit } from "../../services/audit";
import { sendTemplate } from "../../services/email";
import { readStored } from "../../services/storage";
import { h, HttpError, id, paging, zOptStr, zOptDay, toCsv } from "../../util";

const r = Router();

/** Anagrafiche ospiti separate dagli account; possibili conflitti evidenziati, mai uniti automaticamente. */
r.get("/guest-customers",requirePerm("clienti"),h(async(req,res)=>{
  const q=String(req.query.q||"").trim();
  const rows=await db.select({
    id:guestCustomers.id,firstName:guestCustomers.firstName,lastName:guestCustomers.lastName,email:guestCustomers.email,phone:guestCustomers.phone,
    source:guestCustomers.source,createdAt:guestCustomers.createdAt,needsManualReview:guestCustomers.needsManualReview,reviewReason:guestCustomers.reviewReason,
    emailVerifiedAt:guestCustomers.emailVerifiedAt,linkedUserId:guestCustomers.linkedUserId,marketingConsent:guestCustomers.marketingConsent,
    dogs:sql<string>`(select string_agg(d.name || ' · ' || d.breed, ', ' order by d.name) from guest_dogs d where d.guest_customer_id=${guestCustomers.id})`,
    lastRequest:sql<Date>`(select max(b.created_at) from guest_bookings b where b.guest_customer_id=${guestCustomers.id})`,
    requests:sql<number>`(select count(*)::int from guest_bookings b where b.guest_customer_id=${guestCustomers.id})`,
  }).from(guestCustomers).where(q?or(
    ilike(guestCustomers.firstName,`%${q}%`),ilike(guestCustomers.lastName,`%${q}%`),
    ilike(guestCustomers.email,`%${q}%`),ilike(guestCustomers.phone,`%${q}%`),
    sql`exists(select 1 from guest_dogs d where d.guest_customer_id=${guestCustomers.id} and (d.name ilike ${"%"+q+"%"} or d.breed ilike ${"%"+q+"%"}))`,
  ):undefined).orderBy(desc(guestCustomers.createdAt)).limit(200);
  res.json({rows,total:rows.length});
}));

r.get("/guest-customers/:id",requirePerm("clienti"),h(async(req,res)=>{
  const guestCustomerId=id(req.params.id);
  const [customer]=await db.select().from(guestCustomers).where(eq(guestCustomers.id,guestCustomerId));
  if(!customer) throw new HttpError(404,"Anagrafica ospite non trovata.");
  const [ds,requests]=await Promise.all([
    db.select().from(guestDogs).where(eq(guestDogs.guestCustomerId,guestCustomerId)).orderBy(asc(guestDogs.name)),
    db.select({booking:guestBookings,serviceName:services.name,operatorName:operators.name}).from(guestBookings)
      .innerJoin(services,eq(services.id,guestBookings.serviceId)).leftJoin(operators,eq(operators.id,guestBookings.operatorId))
      .where(eq(guestBookings.guestCustomerId,guestCustomerId)).orderBy(desc(guestBookings.createdAt)).limit(100),
  ]);
  res.json({customer,dogs:ds.map(({photoKey:_privatePhotoKey,...dog})=>dog),requests:requests.map(x=>x.booking).map((b,i)=>({...b,serviceName:b.servicePriceSnapshot?.map((s:any)=>s.name).filter(Boolean).join(", ")||requests[i].serviceName,operatorName:requests[i].operatorName}))});
}));

r.get("/dogs/:id/photo", requirePerm("clienti", "richieste"), h(async (req, res) => {
  const [photo] = await db.select({ storageKey: dogPhotos.storageKey }).from(dogPhotos).where(eq(dogPhotos.dogId, id(req.params.id)));
  const data = photo ? await readStored(photo.storageKey) : null;
  if (!data) throw new HttpError(404, "Foto non disponibile.");
  res.set({ "Content-Type": "image/webp", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" }).send(data);
}));

r.get("/guest-dogs/:id/photo",requirePerm("clienti","richieste"),h(async(req,res)=>{
  const [photo]=await db.select({storageKey:dogPhotos.storageKey}).from(dogPhotos).where(eq(dogPhotos.guestDogId,id(req.params.id)));
  const data=photo?await readStored(photo.storageKey):null;
  if(!data) throw new HttpError(404,"Foto non disponibile.");
  res.set({"Content-Type":"image/webp","Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}).send(data);
}));

// ---------- clienti ----------
r.get("/customers", requirePerm("clienti"), h(async (req, res) => {
  const { page, pageSize, offset } = paging(req);
  const q = String(req.query.q || "").trim();
  const f = z.object({
    marketing: z.enum(["si", "no"]).optional(), size: z.enum(["piccola", "media", "grande", "gigante"]).optional(),
    inactiveDays: z.coerce.number().int().min(1).optional(), minVisits: z.coerce.number().int().min(1).optional(), serviceId: z.coerce.number().int().optional(), city: z.string().max(80).optional(),
  }).parse(req.query);
  const extra: any[] = [];
  if (f.marketing) extra.push(eq(users.consentMarketing, f.marketing === "si"));
  if (f.size) extra.push(sql`exists (select 1 from dogs d where d.owner_id = ${users.id} and d.size = ${f.size} and not d.archived)`);
  if (f.inactiveDays) extra.push(sql`not exists (select 1 from appointments a where a.customer_id = ${users.id} and a.status = 'completata' and a.start_at >= now() - make_interval(days => ${f.inactiveDays}))`);
  if (f.minVisits) extra.push(sql`(select count(*) from appointments a where a.customer_id = ${users.id} and a.status = 'completata' and a.start_at >= now() - interval '12 months') >= ${f.minVisits}`);
  if (f.serviceId) extra.push(sql`exists (select 1 from appointments a where a.customer_id = ${users.id} and a.status = 'completata' and a.service_id = ${f.serviceId})`);
  if (f.city) extra.push(ilike(users.city, `%${f.city}%`));
  const where = and(eq(users.role, "customer"), ...extra, q ? or(
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

/** Possibili duplicati: stesso telefono normalizzato o stesso nome e cognome. */
r.get("/customers/duplicates", requirePerm("clienti"), h(async (_req, res) => {
  const all = await db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName, email: users.email, phone: users.phone, createdAt: users.createdAt })
    .from(users).where(eq(users.role, "customer"));
  const groups = new Map<string, typeof all>();
  for (const u of all) {
    const keys = [normalizePhone(u.phone) && normalizePhone(u.phone).length >= 8 ? "tel:" + normalizePhone(u.phone) : null, "nome:" + `${u.firstName} ${u.lastName}`.toLowerCase().replace(/\s+/g, " ").trim()];
    for (const k of keys.filter(Boolean) as string[]) { const g = groups.get(k) || []; g.push(u); groups.set(k, g); }
  }
  res.json([...groups.entries()].filter(([, g]) => g.length > 1).map(([key, list]) => ({ reason: key.startsWith("tel:") ? "Stesso telefono" : "Stesso nome e cognome", key, customers: list })));
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
  const [consents, comms, notifs, expiries] = await Promise.all([
    db.select().from(customerConsents).where(eq(customerConsents.userId, cid)).orderBy(desc(customerConsents.createdAt)).limit(100),
    db.select({ id: emailQueue.id, subject: emailQueue.subject, template: emailQueue.template, status: emailQueue.status, createdAt: emailQueue.createdAt }).from(emailQueue).where(eq(emailQueue.userId, cid)).orderBy(desc(emailQueue.id)).limit(50),
    db.select().from(notifications).where(eq(notifications.userId, cid)).orderBy(desc(notifications.id)).limit(30),
    upcomingExpiries(card.id),
  ]);
  const done = apps.filter((x) => x.a.status === "completata");
  const now = Date.now();
  const spentServices = pays.filter((p) => p.status === "pagato" && p.appointmentId).reduce((a, p) => a + (p.kind === "rimborso" ? -p.amountCents : p.amountCents), 0);
  const spentShop = pays.filter((p) => p.status === "pagato" && p.orderId).reduce((a, p) => a + (p.kind === "rimborso" ? -p.amountCents : p.amountCents), 0);
  const appsOut = apps.map((x) => ({ ...x.a, serviceName: x.a.servicePriceSnapshot?.map((s:any)=>s.name).filter(Boolean).join(", ")||x.serviceName, operatorName: x.operatorName }));
  res.json({
    customer: publicUser(u), dogs: ds,
    appointments: appsOut,
    upcoming: appsOut.filter((a) => new Date(a.startAt).getTime() >= now && ["richiesta", "in_valutazione", "proposta", "confermata", "attesa_pagamento"].includes(a.status)),
    kpi: {
      visits: done.length, lastVisit: done[0]?.a.startAt ?? null, frequencyDays: averageGapDays(done.map((x) => x.a.startAt)),
      spentServicesCents: spentServices, spentShopCents: spentShop, totalSpentCents: spentServices + spentShop,
      cancellations: apps.filter((x) => x.a.status === "annullata").length, noShows: apps.filter((x) => x.a.status === "assente").length,
    },
    payments: pays, loyalty: { card, transactions: lt, expiries }, boarding: board, orders: ords,
    consents, communications: { emails: comms, notifications: notifs },
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
r.post("/customers", requirePerm("clienti_edit"), h(async (req, res) => {
  const d = customerSchema.extend({ sendInvite: z.boolean().optional(), consentProof: zOptStr(500) }).parse(req.body);
  if (d.consentMarketing && !d.consentProof) throw new HttpError(400, "Per registrare il consenso marketing dal banco indica la prova del consenso (es. modulo firmato del …)");
  const [exists] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${d.email}`);
  if (exists) throw new HttpError(409, "Email già registrata");
  const { sendInvite, consentProof, ...data } = d;
  const [u] = await db.insert(users).values({ ...data, role: "customer", passwordHash: await hashPassword(crypto.randomBytes(24).toString("hex")), consentDate: new Date(), unsubscribeToken: crypto.randomBytes(24).toString("hex") }).returning();
  await recordConsent(null, { userId: u.id, kind: "privacy", granted: d.consentPrivacy, source: "inserimento_salone", proof: consentProof, createdBy: req.user!.id });
  await recordConsent(null, { userId: u.id, kind: "marketing", granted: d.consentMarketing, source: "inserimento_salone", proof: consentProof, createdBy: req.user!.id });
  await ensureCard(u.id);
  if (sendInvite) {
    const base = process.env.PUBLIC_URL || "";
    await sendTemplate("comunicazione", u.email, { oggetto: "Il tuo account Dog's Planet", messaggio: `Ciao ${u.firstName}, abbiamo creato il tuo account. Imposta la tua password con "Password dimenticata" e accedi per vedere appuntamenti e Fidelity Card.` }, { userId: u.id, cta: { label: "Imposta la password", url: `${base}/password-dimenticata` } });
  }
  await audit(req, "create", "customer", u.id);
  res.status(201).json(publicUser(u));
}));

r.patch("/customers/:id", requirePerm("clienti_edit"), h(async (req, res) => {
  const d = customerSchema.partial().extend({ consentProof: zOptStr(500) }).parse(req.body);
  const { consentProof, ...upd } = d;
  const [before] = await db.select().from(users).where(and(eq(users.id, id(req.params.id)), eq(users.role, "customer")));
  if (!before) throw new HttpError(404, "Cliente non trovato");
  if (d.consentMarketing === true && !before.consentMarketing && !consentProof) throw new HttpError(400, "Indica la prova del consenso marketing raccolto");
  for (const k of ["consentPrivacy", "consentMarketing"] as const) {
    if (d[k] !== undefined && d[k] !== before[k]) await recordConsent(null, { userId: before.id, kind: k === "consentPrivacy" ? "privacy" : "marketing", granted: !!d[k], source: "salone", proof: consentProof, createdBy: req.user!.id });
  }
  const [u] = await db.update(users).set({ ...upd, ...(d.consentMarketing !== undefined && d.consentMarketing !== before.consentMarketing ? { consentDate: new Date() } : {}), updatedAt: new Date() }).where(and(eq(users.id, id(req.params.id)), eq(users.role, "customer"))).returning();
  if (!u) throw new HttpError(404, "Cliente non trovato");
  await audit(req, "update", "customer", u.id, { fields: Object.keys(d) });
  res.json(publicUser(u));
}));

// ---------- cani (lato salone) ----------
const adminDogSchema = dogSchema.extend({ recallDays: z.coerce.number().int().min(1).max(365).nullable().optional() });

r.post("/customers/:id/dogs", requirePerm("cani_edit"), h(async (req, res) => {
  const d = adminDogSchema.parse(req.body);
  d.customFields = await validateCustomFields(d.customFields);
  const [dog] = await db.insert(dogs).values({ ...d, ownerId: id(req.params.id) } as any).returning();
  await audit(req, "create", "dog", dog.id);
  res.status(201).json(dog);
}));
r.patch("/dogs/:id", requirePerm("cani_edit"), h(async (req, res) => {
  const d = adminDogSchema.extend({ archived: z.boolean() }).partial().parse(req.body);
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
  table: dogCustomFields, entity: "dog_field", perm: "impostazioni",
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
