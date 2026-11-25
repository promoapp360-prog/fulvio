import { Router, type Request } from "express";
import { z } from "zod";
import multer from "multer";
import rateLimit from "express-rate-limit";
import { and, asc, desc, eq, inArray, isNull, sql, gte, or } from "drizzle-orm";
import { db } from "../db";
import {
  users, dogs, dogPhotos, appointmentPhotos, dogCustomFields, appointments, services, operators, payments, loyaltyCards, loyaltyTransactions, loyaltyRewards,
  boardingRequests, orders, orderItems, products, notifications, pushSubscriptions, promotions, appointmentEvents, auditLog,
  guestCustomers, guestBookings, guestBookingEvents,
} from "../../shared/schema";
import { requireAuth, publicUser } from "../auth";
import { createRequest, applyAction, paidTotal, logEvent, bookingAvailability } from "../services/appointments";
import { appointmentRequestSchema, customerDogSchema } from "../../shared/customer-booking";
import { ensureCard, upcomingExpiries, redeem } from "../services/loyalty";
import { recordConsent, currentPolicyVersion } from "../services/consents";
import { priceItems, promoDiscount } from "../services/shop";
import { sendTemplate } from "../services/email";
import { deliveryQuote, normalizePhone } from "../logic";
import { boardingEvents } from "../../shared/schema";
import { euro } from "../../shared/constants";
import { getSettings } from "../services/settings";
import { createCheckout, stripeEnabled } from "../services/payments";
import { notifyStaff } from "../services/notify";
import { audit } from "../services/audit";
import { h, HttpError, id, zOptStr, zOptDay, zDay, zTime } from "../util";
import { romeToDate, todayRome, fmtRome } from "../time";
import { pushConfiguration, validPushEndpoint } from "../services/push-config";
import { storeDogPhoto, deleteStored, readStored } from "../services/storage";
import { privacyPolicyVersion } from "../services/privacy-policy";

const r = Router();
r.use(requireAuth);
const requestPhotoUpload=multer({storage:multer.memoryStorage(),limits:{fileSize:2*1024*1024,files:1}});
const appointmentRequestLimiter=rateLimit({windowMs:60*60_000,limit:8,standardHeaders:true,legacyHeaders:false,message:{error:"Hai inviato diverse richieste. Riprova più tardi."}});
const normalizeName=(v:string)=>v.normalize("NFD").replace(/[\u0300-\u036f]/g,"").trim().toLocaleLowerCase("it-IT").replace(/\s+/g," ");

/** L'associazione richiede accesso autenticato, email verificata e un click esplicito; non fonde né sovrascrive schede. */
r.post("/guest-records/claim",h(async(req,res)=>{
  const user=req.user!;
  if(!user.emailVerifiedAt) throw new HttpError(403,"Verifica prima il tuo indirizzo email.");
  const emailNormalized=user.email.trim().toLowerCase(),phoneNormalized=normalizePhone(user.phone);
  if(!phoneNormalized||phoneNormalized.length<8)throw new HttpError(400,"Aggiungi un telefono al profilo prima di cercare le richieste ospite.");
  const matched=await db.transaction(async tx=>{
    const candidates=await tx.select().from(guestCustomers).where(or(eq(guestCustomers.emailNormalized,emailNormalized),eq(guestCustomers.phoneNormalized,phoneNormalized)));
    const exact=candidates.filter((c:any)=>c.emailNormalized===emailNormalized&&c.phoneNormalized===phoneNormalized&&normalizeName(c.firstName)===normalizeName(user.firstName)&&normalizeName(c.lastName)===normalizeName(user.lastName));
    const conflicts=candidates.filter((c:any)=>!exact.some((e:any)=>e.id===c.id)&&!c.linkedUserId);
    for(const c of conflicts)await tx.update(guestCustomers).set({needsManualReview:true,reviewReason:"Possibile conflitto durante la richiesta di associazione dell’account.",updatedAt:new Date()}).where(eq(guestCustomers.id,c.id));
    const eligible=exact.filter((c:any)=>!c.linkedUserId||c.linkedUserId===user.id);
    let linked=0;
    for(const c of eligible){
      await tx.update(guestCustomers).set({linkedUserId:user.id,linkedAt:c.linkedAt||new Date(),emailVerifiedAt:c.emailVerifiedAt||new Date(),updatedAt:new Date()}).where(eq(guestCustomers.id,c.id));
      const requests=await tx.select({id:guestBookings.id}).from(guestBookings).where(and(eq(guestBookings.guestCustomerId,c.id),or(isNull(guestBookings.claimedById),eq(guestBookings.claimedById,user.id))));
      if(requests.length){
        await tx.update(guestBookings).set({claimedById:user.id,claimedAt:new Date(),updatedAt:new Date()}).where(and(eq(guestBookings.guestCustomerId,c.id),or(isNull(guestBookings.claimedById),eq(guestBookings.claimedById,user.id))));
        await tx.insert(guestBookingEvents).values(requests.map((x:any)=>({bookingId:x.id,actorId:user.id,action:"richiesta_ospite_associata_account_verificato",data:{emailVerified:true,ownerAction:true}})));
        linked+=requests.length;
      }
    }
    return {linked,manualReview:conflicts.length+exact.filter((c:any)=>c.linkedUserId&&c.linkedUserId!==user.id).length};
  });
  res.json({...matched,message:matched.linked?`${matched.linked} richieste ospite collegate. Le schede restano separate e non sono stati sovrascritti dati.`:"Non ci sono richieste ospite collegabili con i dati verificati del profilo."});
}));

r.get("/guest-records",h(async(req,res)=>{
  const rows=await db.select({booking:guestBookings,serviceName:services.name}).from(guestBookings)
    .innerJoin(services,eq(services.id,guestBookings.serviceId)).where(eq(guestBookings.claimedById,req.user!.id))
    .orderBy(desc(guestBookings.createdAt)).limit(100);
  res.json(rows.map(row=>({...row,serviceName:row.booking.servicePriceSnapshot?.map((s:any)=>s.name).filter(Boolean).join(", ")||row.serviceName})));
}));

// ---------- profilo ----------
const profileSchema = z.object({
  firstName: z.string().trim().min(1).max(100), lastName: z.string().trim().min(1).max(100),
  phone: z.string().trim().min(6).max(40),
  address: zOptStr(), city: zOptStr(120), province: zOptStr(10), cap: zOptStr(10), country: zOptStr(80),
  birthDate: zOptDay, notes: zOptStr(2000),
  commEmail: z.boolean(), commPush: z.boolean(), commWhatsapp: z.boolean(), commRecall: z.boolean(), consentMarketing: z.boolean(),
}).partial();

r.get("/profile", (req, res) => res.json(publicUser(req.user!)));
r.patch("/profile", h(async (req, res) => {
  const d = profileSchema.parse(req.body);
  const extra = d.consentMarketing !== undefined && d.consentMarketing !== req.user!.consentMarketing ? { consentDate: new Date() } : {};
  const [u] = await db.update(users).set({ ...d, ...extra, updatedAt: new Date() }).where(eq(users.id, req.user!.id)).returning();
  // storico delle autorizzazioni: concessione o revoca
  if (d.consentMarketing !== undefined && d.consentMarketing !== req.user!.consentMarketing) {
    await recordConsent(null, { userId: u.id, kind: "marketing", granted: d.consentMarketing, source: "area_personale", req, policyVersion: await currentPolicyVersion("marketing") });
  }
  if (d.commRecall !== undefined && d.commRecall !== req.user!.commRecall) await recordConsent(null, { userId: u.id, kind: "richiami", granted: d.commRecall, source: "area_personale", req });
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
  species: z.enum(["cane", "gatto"]).default("cane"),
  breed: zOptStr(120),
  size: z.enum(["mini", "piccola", "media", "grande", "gigante"]),
  weightKg: z.union([z.coerce.number().min(0).max(150), z.literal("").transform(() => null), z.null()]).optional().transform((v) => (v == null ? null : String(v))),
  birthDate: zOptDay, notes: zOptStr(2000),
  coatKnots: z.boolean().default(false), coatShedding: z.boolean().default(false), lastBath: zOptDay,
  coatType: zOptStr(80), coatLength: zOptStr(20), coatNotes: zOptStr(2000),
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
  const rows = await db.select({ dog: dogs, photoId: dogPhotos.id }).from(dogs).leftJoin(dogPhotos, eq(dogPhotos.dogId, dogs.id))
    .where(and(eq(dogs.ownerId, req.user!.id), eq(dogs.archived, false))).orderBy(asc(dogs.name));
  res.json(rows.map(({ dog, photoId }) => ({ ...dog, hasPhoto: !!photoId, photoUrl: photoId ? `/api/account/dogs/${dog.id}/photo` : null })));
}));

r.post("/dogs", requestPhotoUpload.single("photo"), h(async (req, res) => {
  const d = customerDogSchema.parse(parseDogPayload(req));
  d.customFields = await validateCustomFields(d.customFields);
  if (!req.file) throw new HttpError(400, "Carica la foto del cane");
  const photo = await storeDogPhoto(req.file.buffer, req.file.mimetype);
  let dog;
  try { dog = await db.transaction(async tx => {
    const [pet] = await tx.insert(dogs).values({ ...d, ownerId: req.user!.id }).returning();
    await tx.insert(dogPhotos).values({ dogId: pet.id, storageKey: photo.key });
    const [saved] = await tx.update(dogs).set({ photoUrl: `/api/account/dogs/${pet.id}/photo` }).where(eq(dogs.id, pet.id)).returning();
    return saved;
  }); } catch (error) { await deleteStored(photo.key); throw error; }
  res.status(201).json(dog);
}));

r.patch("/dogs/:id", requestPhotoUpload.single("photo"), h(async (req, res) => {
  const dogId = id(req.params.id);
  const [current] = await db.select().from(dogs).where(and(eq(dogs.id, dogId), eq(dogs.ownerId, req.user!.id)));
  if (!current) throw new HttpError(404, "Cane non trovato");
  const d = customerDogSchema.parse({ ...current, ...parseDogPayload(req) });
  d.customFields = await validateCustomFields(d.customFields);
  const [oldPhoto] = await db.select().from(dogPhotos).where(eq(dogPhotos.dogId, dogId));
  if (!oldPhoto && !req.file) throw new HttpError(400, "Carica la foto del cane");
  const photo = req.file ? await storeDogPhoto(req.file.buffer, req.file.mimetype) : null;
  let dog;
  try { dog = await db.transaction(async tx => {
    const [saved] = await tx.update(dogs).set({ ...d, photoUrl: `/api/account/dogs/${dogId}/photo`, updatedAt: new Date() }).where(eq(dogs.id, dogId)).returning();
    if (photo) await tx.insert(dogPhotos).values({ dogId, storageKey: photo.key }).onConflictDoUpdate({ target: dogPhotos.dogId, set: { storageKey: photo.key, createdAt: new Date() } });
    return saved;
  }); } catch (error) { if (photo) await deleteStored(photo.key); throw error; }
  // Non eliminare la foto precedente: può essere referenziata dallo storico.
  res.json(dog);
}));

function parseDogPayload(req: any) {
  if (typeof req.body?.payload !== "string") return req.body;
  try { return JSON.parse(req.body.payload); } catch { throw new HttpError(400, "Scheda cane non valida"); }
}

r.delete("/dogs/:id", h(async (req, res) => {
  // archiviazione: lo storico trattamenti resta consultabile dal salone
  const [dog] = await db.update(dogs).set({ archived: true, updatedAt: new Date() }).where(and(eq(dogs.id, id(req.params.id)), eq(dogs.ownerId, req.user!.id))).returning();
  if (!dog) throw new HttpError(404, "Cane non trovato");
  res.json({ ok: true });
}));

/** Foto cane privata: il cliente vede solo i propri cani. */
r.get("/dogs/:id/photo",h(async(req,res)=>{
  const dogId=id(req.params.id);
  const [dog]=await db.select({id:dogs.id}).from(dogs).where(and(eq(dogs.id,dogId),eq(dogs.ownerId,req.user!.id)));
  if(!dog) throw new HttpError(404,"Foto non trovata.");
  const [photo]=await db.select().from(dogPhotos).where(eq(dogPhotos.dogId,dogId));
  const data=photo?await readStored(photo.storageKey):null;
  if(!data) throw new HttpError(404,"Foto non disponibile.");
  res.set({"Content-Type":"image/webp","Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}).send(data);
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
    return { ...a, ...rest, serviceName:a.servicePriceSnapshot?.map((s:any)=>s.name).filter(Boolean).join(", ")||rest.serviceName, adminNotes: undefined, paidCents: paid };
  }));
}));

r.get("/booking-availability", h(async (req, res) => {
  res.set("Cache-Control", "no-store");
  const q = z.object({ dogId: z.coerce.number().int().positive(), date: zDay,
    serviceIds: z.string().regex(/^\d+(,\d+)*$/).transform(value => value.split(",").map(Number)) }).parse(req.query);
  res.json(await bookingAvailability(req.user!.id, q.dogId, q.serviceIds, q.date));
}));

r.post("/appointments",appointmentRequestLimiter,h(async(req,res)=>{
  let payload:unknown;
  try{payload=typeof req.body?.payload==="string"?JSON.parse(req.body.payload):req.body;}catch{throw new HttpError(400,"Dati della richiesta non validi.");}
  const d=appointmentRequestSchema.parse(payload);
  if(d.date<todayRome()) throw new HttpError(400,"Data nel passato.");
  const app=await createRequest(req.user!.id,{ ...d, request:req });
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(appointments).where(eq(appointments.customerId, req.user!.id));
  res.status(app.duplicate?200:201).json({ok:true,id:app.id,duplicate:app.duplicate,firstRequest:total===1,
    message:"Richiesta inviata! L'appuntamento è confermato solo dopo la risposta del salone."});
}));

r.post("/appointments/:id/action", h(async (req, res) => {
  const { action, reason } = z.object({ action: z.enum(["accetta_proposta", "rifiuta_proposta", "annulla"]), reason: zOptStr(255) }).parse(req.body);
  res.json(await applyAction(id(req.params.id), { id: req.user!.id, role: "customer" }, { action, reason }));
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
  const s = await getSettings();
  const [tx, rewards, expiries] = await Promise.all([
    db.select().from(loyaltyTransactions).where(eq(loyaltyTransactions.cardId, card.id)).orderBy(desc(loyaltyTransactions.id)).limit(100),
    db.select().from(loyaltyRewards).where(eq(loyaltyRewards.active, true)).orderBy(asc(loyaltyRewards.pointsCost)),
    upcomingExpiries(card.id),
  ]);
  res.json({ card, transactions: tx.filter((t) => !(t.kind === "proroga" && t.points === 0) || true), rewards, expiries,
    rules: { pointsPerEuro: s.loyalty.pointsPerEuro, pointValueCents: s.loyalty.pointValueCents, minRedeemPoints: s.loyalty.minRedeemPoints, expiryMode: s.loyalty.expiryMode, expiryFixedDate: s.loyalty.expiryFixedDate, expiryDays: s.loyalty.expiryDays } });
}));

// ---------- pensione casalinga ----------
r.get("/boarding", h(async (req, res) => {
  res.json(await db.select({ b: boardingRequests, dogName: dogs.name }).from(boardingRequests).innerJoin(dogs, eq(dogs.id, boardingRequests.dogId))
    .where(eq(boardingRequests.customerId, req.user!.id)).orderBy(desc(boardingRequests.startDate)));
}));
r.post("/boarding", h(async (req, res) => {
  const s = await getSettings();
  if (!s.site.boardingEnabled) throw new HttpError(400, "Le richieste di pensione non sono al momento attive");
  const d = z.object({ dogId: z.number().int().positive(), startDate: zDay, endDate: zDay, needs: zOptStr(2000), customerNotes: zOptStr(2000) }).parse(req.body);
  if (d.endDate < d.startDate || d.startDate < todayRome()) throw new HttpError(400, "Date non valide");
  const [dog] = await db.select().from(dogs).where(and(eq(dogs.id, d.dogId), eq(dogs.ownerId, req.user!.id)));
  if (!dog) throw new HttpError(404, "Cane non trovato");
  const [b] = await db.insert(boardingRequests).values({ ...d, customerId: req.user!.id }).returning();
  await db.insert(boardingEvents).values({ boardingId: b.id, actorId: req.user!.id, action: "richiesta", message: d.customerNotes });
  await notifyStaff("pensione", { title: "Nuova richiesta pensione casalinga", body: `${dog.name}: dal ${d.startDate} al ${d.endDate}`, url: "/admin/pensione" });
  res.status(201).json(b);
}));
/** Risposta del cliente: accetta le nuove date proposte o invia le informazioni richieste. */
r.post("/boarding/:id/reply", h(async (req, res) => {
  const d = z.object({ action: z.enum(["accetta_date", "rifiuta_date", "rispondi"]), message: zOptStr(2000) }).parse(req.body);
  const bid = id(req.params.id);
  const [b0] = await db.select().from(boardingRequests).where(and(eq(boardingRequests.id, bid), eq(boardingRequests.customerId, req.user!.id)));
  if (!b0) throw new HttpError(404, "Richiesta non trovata");
  let patch: any = { updatedAt: new Date() };
  if (d.action === "accetta_date") {
    if (b0.status !== "proposta" || !b0.proposedStart || !b0.proposedEnd) throw new HttpError(400, "Nessuna proposta da accettare");
    // torna al salone per la conferma definitiva: nessuna conferma automatica
    patch = { ...patch, startDate: b0.proposedStart, endDate: b0.proposedEnd, proposedStart: null, proposedEnd: null, status: "richiesta" };
  } else if (d.action === "rifiuta_date") {
    if (b0.status !== "proposta") throw new HttpError(400, "Nessuna proposta da rifiutare");
    patch = { ...patch, status: "annullata" };
  } else {
    if (!d.message) throw new HttpError(400, "Scrivi la risposta");
    if (b0.status !== "info_richieste") throw new HttpError(400, "Il salone non ha richiesto informazioni");
    patch = { ...patch, status: "richiesta", customerNotes: [b0.customerNotes, d.message].filter(Boolean).join("\n---\n") };
  }
  const [b] = await db.update(boardingRequests).set(patch).where(eq(boardingRequests.id, bid)).returning();
  await db.insert(boardingEvents).values({ boardingId: bid, actorId: req.user!.id, action: "cliente_" + d.action, message: d.message });
  await notifyStaff("pensione", { title: "Pensione: risposta del cliente", body: `${req.user!.firstName} ${req.user!.lastName}: ${d.action.replace("_", " ")}${d.message ? " – " + d.message : ""}`, url: "/admin/pensione" });
  res.json(b);
}));

r.post("/boarding/:id/cancel", h(async (req, res) => {
  const [b] = await db.update(boardingRequests).set({ status: "annullata", updatedAt: new Date() })
    .where(and(eq(boardingRequests.id, id(req.params.id)), eq(boardingRequests.customerId, req.user!.id), inArray(boardingRequests.status, ["richiesta", "info_richieste", "proposta", "confermata"]))).returning();
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

/** Preventivo consegna per CAP (zone configurate dall'admin). */
r.get("/delivery-quote", h(async (req, res) => {
  const q = z.object({ cap: z.string().trim().min(4).max(10), subtotal: z.coerce.number().int().min(0) }).parse(req.query);
  const s = await getSettings();
  if (!s.shop.deliveryEnabled) return res.json(null);
  res.json(deliveryQuote(s.shop.deliveryZones, q.cap, q.subtotal));
}));

r.post("/orders", h(async (req, res) => {
  const s = await getSettings();
  if (!s.site.shopEnabled) throw new HttpError(400, "Lo shop online non è ancora attivo");
  const d = z.object({
    items: z.array(z.object({ productId: z.number().int().positive(), variantId: z.number().int().positive().nullable().optional(), qty: z.number().int().min(1).max(50) })).min(1).max(50),
    delivery: z.enum(["ritiro", "consegna"]).default("ritiro"), notes: zOptStr(1000), promoCode: zOptStr(40), pointsToUse: z.number().int().min(0).default(0),
    address: zOptStr(255), city: zOptStr(120), cap: zOptStr(10),
  }).parse(req.body);
  if (d.delivery === "ritiro" && !s.shop.pickupEnabled) throw new HttpError(400, "Il ritiro in negozio non è disponibile");
  if (d.delivery === "consegna" && !s.shop.deliveryEnabled) throw new HttpError(400, "La consegna a domicilio non è disponibile");
  if (d.delivery === "consegna" && (!d.address || !d.city || !d.cap)) throw new HttpError(400, "Indica indirizzo, comune e CAP per la consegna");
  const order = await db.transaction(async (tx) => {
    const { lines, subtotal } = await priceItems(tx, d.items, { onlineOnly: true });
    const discount = await promoDiscount(tx, d.promoCode, subtotal);
    let delivery = 0, zone: string | null = null, eta: string | null = null;
    if (d.delivery === "consegna") {
      const q = deliveryQuote(s.shop.deliveryZones, d.cap!, subtotal - discount);
      if (!q) throw new HttpError(400, "Il CAP indicato non è servito dalla consegna a domicilio");
      delivery = q.costCents; zone = q.zone; eta = q.eta;
    }
    let pointsDiscount = 0;
    if (d.pointsToUse > 0) {
      if (!s.loyalty.pointValueCents) throw new HttpError(400, "L'utilizzo dei punti nello shop non è ancora attivo");
      if (d.pointsToUse < (s.loyalty.minRedeemPoints || 0)) throw new HttpError(400, `Puoi usare almeno ${s.loyalty.minRedeemPoints} punti`);
      pointsDiscount = Math.min(d.pointsToUse * s.loyalty.pointValueCents, subtotal - discount);
    }
    const total = subtotal - discount - pointsDiscount + delivery;
    const [o] = await tx.insert(orders).values({
      customerId: req.user!.id, channel: "online", subtotalCents: subtotal, discountCents: discount, totalCents: total, promoCode: d.promoCode, delivery: d.delivery,
      deliveryCents: delivery, deliveryZone: zone, deliveryEta: eta, deliveryAddress: d.address, deliveryCity: d.city, deliveryCap: d.cap,
      pointsUsed: pointsDiscount ? d.pointsToUse : 0, pointsDiscountCents: pointsDiscount, notes: d.notes,
    }).returning();
    await tx.insert(orderItems).values(lines.map((l) => ({ ...l, orderId: o.id })));
    if (pointsDiscount) {
      const card = await ensureCard(req.user!.id, tx);
      await redeem(card.id, d.pointsToUse, `Credito punti – ordine #${o.id}`, { orderId: o.id, valueCents: pointsDiscount }, tx);
    }
    return o;
  });
  await notifyStaff("shop", { title: "Nuovo ordine shop", body: `Ordine #${order.id} – ${euro(order.totalCents)}`, url: "/admin/ordini" });
  await sendTemplate("ordine_confermato", req.user!.email, {
    nome: req.user!.firstName, ordine: order.id, importo: euro(order.totalCents),
    consegna: order.delivery === "ritiro" ? s.shop.pickupInfo : `Consegna a ${order.deliveryAddress}, ${order.deliveryCap} ${order.deliveryCity}${order.deliveryEta ? ` – tempi indicativi: ${order.deliveryEta}` : ""}.`,
  }, { userId: req.user!.id });
  let url: string | null = null;
  if (stripeEnabled() && s.payments.onlineEnabled && order.totalCents > 0) {
    const base = process.env.PUBLIC_URL || `${req.protocol}://${req.get("host")}`;
    const co = await createCheckout({
      amountCents: order.totalCents, email: req.user!.email, description: `Dog's Planet – ordine #${order.id}`,
      successUrl: `${base}/account/ordini?pagamento=ok`, cancelUrl: `${base}/account/ordini?pagamento=annullato`,
      metadata: { orderId: String(order.id), customerId: String(req.user!.id), kind: "totale" },
    });
    await db.insert(payments).values({ orderId: order.id, customerId: req.user!.id, kind: "totale", method: "online", amountCents: order.totalCents, status: "in_attesa", provider: "stripe", providerRef: co.id, checkoutUrl: co.url, reason: `Ordine shop #${order.id}` });
    url = co.url;
  }
  res.status(201).json({ order, paymentUrl: url });
}));

async function recordPushConsent(tx: any, req: Request, granted: boolean) {
  await tx.insert(auditLog).values({
    actorId: req.user!.id, action: "push_consent", entity: "user", entityId: String(req.user!.id),
    data: { granted, source: "area_personale_click", purpose: "conferme_e_promemoria_appuntamenti", version: "1" },
    ip: String(req.ip || "").slice(0, 64),
  });
}

/** Controllo senza permessi tecnici, sottoscrizioni automatiche o modifiche ai dati. */
r.post("/push/offer", h(async (req, res) => {
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(appointments).where(eq(appointments.customerId, req.user!.id));
  if (!pushConfiguration.configured || total !== 1 || !req.user!.consentMarketing) return res.json({ offer: false });
  const rows = await db.update(users).set({ pushOfferedAt: new Date() }).where(and(eq(users.id, req.user!.id),
    isNull(users.pushOfferedAt), eq(users.consentMarketing, true))).returning({ id: users.id });
  res.json({ offer: rows.length > 0 });
}));

r.post("/push/status", h(async (req, res) => {
  const { endpoint } = z.object({ endpoint: z.string().url().max(1000).nullable() }).parse(req.body);
  const matches = endpoint ? await db.select({ id: pushSubscriptions.id }).from(pushSubscriptions)
    .where(and(eq(pushSubscriptions.userId, req.user!.id), eq(pushSubscriptions.endpoint, endpoint))).limit(1) : [];
  res.json({ configured: pushConfiguration.configured, preference: req.user!.commPush, subscribed: matches.length > 0 });
}));

/** Disattiva le notifiche push di tutti i dispositivi dell'utente. */
r.post("/push/disable", h(async (req, res) => {
  await db.transaction(async (tx) => {
    await tx.delete(pushSubscriptions).where(eq(pushSubscriptions.userId, req.user!.id));
    await tx.update(users).set({ commPush: false, updatedAt: new Date() }).where(eq(users.id, req.user!.id));
    await recordPushConsent(tx, req, false);
  });
  res.json({ ok: true });
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
  if (!pushConfiguration.configured) throw new HttpError(503, "Le notifiche push non sono ancora disponibili. Le comunicazioni restano nell’area personale.");
  const d = z.object({
    endpoint: z.string().url().max(1000).refine(validPushEndpoint, "Servizio push non supportato"),
    keys: z.object({ p256dh: z.string().regex(/^[A-Za-z0-9_-]{86,88}={0,2}$/), auth: z.string().regex(/^[A-Za-z0-9_-]{22,24}={0,2}$/) }),
  }).parse(req.body);
  await db.transaction(async (tx) => {
    await tx.insert(pushSubscriptions).values({ userId: req.user!.id, endpoint: d.endpoint, p256dh: d.keys.p256dh, auth: d.keys.auth })
      .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { userId: req.user!.id, p256dh: d.keys.p256dh, auth: d.keys.auth } });
    await tx.update(users).set({ commPush: true, updatedAt: new Date() }).where(eq(users.id, req.user!.id));
    await recordPushConsent(tx, req, true);
  });
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
