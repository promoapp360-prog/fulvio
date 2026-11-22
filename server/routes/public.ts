import { Router } from "express";
import rateLimit from "express-rate-limit";
import multer from "multer";
import crypto from "node:crypto";
import { z } from "zod";
import { and, asc, eq, gte, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "../db";
import {
  pages, faqs, services, serviceVariants, serviceSupplements, operators, operatorServices, operatorShifts, products, promotions, dogs, cookieChoices,
} from "../../shared/schema";
import { publicSettings } from "../services/settings";
import { availability, quote } from "../services/availability";
import { sendEmail, emailLayout, p } from "../services/email";
import { getSettings } from "../services/settings";
import { h, HttpError, id, zDay } from "../util";
import { todayRome, addDays } from "../time";
import { BUSINESS } from "../../shared/constants";
import { users, productVariants, productCategories } from "../../shared/schema";
import { recordConsent } from "../services/consents";
import { storeDogPhoto, deleteStored } from "../services/storage";
import { guestBookingSchema } from "../../shared/guest-booking";
import { createGuestBooking, guestRequestStatus } from "../services/guest-bookings";
import { privacyPolicyVersion } from "../services/privacy-policy";
import { cookieConfiguration } from "../services/cookie-config";

const r = Router();
const guestPhotoUpload=multer({storage:multer.memoryStorage(),limits:{fileSize:2*1024*1024,files:1}});
const guestBookingLimiter=rateLimit({windowMs:60*60_000,limit:5,standardHeaders:true,legacyHeaders:false,message:{error:"Hai inviato diverse richieste. Riprova più tardi o contatta il salone."}});

// cache HTTP breve per i contenuti pubblici: riduce le query ripetute
r.use((req, res, next) => { if (req.method === "GET") res.set("Cache-Control", "public, max-age=60"); next(); });

r.get("/settings", h(async (_req, res) => res.json(await publicSettings())));

r.get("/cookie-config",h(async(_req,res)=>{
  res.set("Cache-Control","no-store");res.json(await cookieConfiguration());
}));
r.post("/cookie-choices",rateLimit({windowMs:60*60_000,limit:60,standardHeaders:true,legacyHeaders:false}),h(async(req,res)=>{
  const input=z.object({
    receiptId:z.string().uuid(),version:z.string().regex(/^[a-f0-9]{64}$/),
    analytics:z.boolean(),marketing:z.boolean(),externalContent:z.boolean(),
    action:z.enum(["accept","reject","customize"]),
  }).parse(req.body);
  const config=await cookieConfiguration();
  if(input.version!==config.version)throw new HttpError(409,"Le informazioni cookie sono cambiate. Riapri le preferenze e riprova.");
  const effective={...input,analytics:input.action!=="reject"&&config.analytics&&input.analytics,marketing:input.action!=="reject"&&config.marketing&&input.marketing,externalContent:input.action!=="reject"&&input.externalContent};
  const [record]=await db.insert(cookieChoices).values(effective).returning({date:cookieChoices.createdAt});
  res.status(201).json({...effective,date:record.date.toISOString(),necessary:true});
}));

r.get("/pages/:slug", h(async (req, res) => {
  const [pg] = await db.select().from(pages).where(and(eq(pages.slug, req.params.slug), eq(pages.published, true)));
  if (!pg) throw new HttpError(404, "Pagina non trovata");
  res.json(pg);
}));

r.get("/faqs", h(async (req, res) => {
  const section = String(req.query.section || "generale");
  res.json(await db.select().from(faqs).where(and(eq(faqs.section, section), eq(faqs.active, true))).orderBy(asc(faqs.sortOrder), asc(faqs.id)));
}));

r.get("/services", h(async (_req, res) => {
  const [svcs, vars, sups, links, ops] = await Promise.all([
    db.select().from(services).where(and(eq(services.active, true), eq(services.visible, true))).orderBy(asc(services.sortOrder), asc(services.id)),
    db.select().from(serviceVariants),
    db.select().from(serviceSupplements).where(eq(serviceSupplements.active, true)),
    db.select().from(operatorServices),
    db.select({ id: operators.id, name: operators.name, color: operators.color }).from(operators).where(and(eq(operators.active, true), eq(operators.bookableOnline, true))),
  ]);
  const opIds = new Set(ops.map((o) => o.id));
  res.json(svcs.map((s) => ({
    ...s,
    variants: vars.filter((v) => v.serviceId === s.id),
    supplements: sups.filter((x) => x.serviceId === s.id || x.serviceId == null).map(({ name, priceCents, condition }) => ({ name, priceCents, condition })),
    operatorIds: links.filter((l) => l.serviceId === s.id && opIds.has(l.operatorId)).map((l) => l.operatorId),
  })));
}));

r.get("/operators", h(async (_req, res) => {
  const ops = await db.select({ id: operators.id, name: operators.name, color: operators.color, bio: operators.bio })
    .from(operators).where(and(eq(operators.active, true), eq(operators.bookableOnline, true))).orderBy(asc(operators.sortOrder));
  const [links, shifts] = await Promise.all([db.select().from(operatorServices), db.select().from(operatorShifts)]);
  res.json(ops.map((o) => ({
    ...o,
    serviceIds: links.filter((l) => l.operatorId === o.id).map((l) => l.serviceId),
    shifts: shifts.filter((s) => s.operatorId === o.id).map(({ weekday, startTime, endTime }) => ({ weekday, startTime, endTime })),
  })));
}));

r.get("/availability", h(async (req, res) => {
  res.set("Cache-Control", "no-store");
  const q = z.object({
    serviceId: z.coerce.number().int().positive(),
    date: zDay,
    operatorId: z.coerce.number().int().positive().optional(),
    dogId: z.coerce.number().int().positive().optional(),
    size: z.enum(["piccola", "media", "grande", "gigante"]).optional(),
  }).parse(req.query);
  if (q.date < todayRome()) return res.json({ durationMin: 0, slots: {} });
  let dog: any = null;
  if (q.dogId && req.user) {
    [dog] = await db.select().from(dogs).where(and(eq(dogs.id, q.dogId), eq(dogs.ownerId, req.user.id)));
  }
  if (!dog && q.size) dog = { size: q.size, coatKnots: false, coatShedding: false, aggressive: false };
  const qt = await quote(q.serviceId, dog);
  if (!qt.service.bookable) throw new HttpError(400, "Servizio non prenotabile online");
  const slots = await availability(q.serviceId, q.date, qt.durationMin, q.operatorId ?? null, true);
  res.json({ durationMin: qt.durationMin, estimatedPriceCents: qt.estimatedPriceCents, supplements: qt.supplements, slots });
}));

/** Primo calendario: propone solo orari liberi per almeno un servizio attivo del catalogo. */
r.get("/guest-slots", h(async (req,res)=>{
  res.set("Cache-Control","no-store");
  const {date}=z.object({date:zDay}).parse(req.query);
  if(date<todayRome()) return res.json({date,slots:[]});
  const settings=await getSettings();
  if(date>addDays(todayRome(),settings.booking.maxDaysAhead)) return res.json({date,slots:[]});
  const catalog=await db.select({id:services.id,durationMin:services.durationMin}).from(services)
    .where(and(eq(services.active,true),eq(services.visible,true),eq(services.bookable,true))).orderBy(asc(services.sortOrder),asc(services.id));
  const map=new Map<string,{time:string;serviceIds:number[];operatorIds:number[]}>();
  for(const svc of catalog){
    const slots=await availability(svc.id,date,svc.durationMin,null,true);
    for(const [time,ids] of Object.entries(slots)){
      const entry=map.get(time)||{time,serviceIds:[],operatorIds:[]};
      entry.serviceIds.push(svc.id);entry.operatorIds.push(...ids);
      map.set(time,entry);
    }
  }
  res.json({date,slots:[...map.values()].map(x=>({...x,serviceIds:[...new Set(x.serviceIds)],operatorIds:[...new Set(x.operatorIds)]})).sort((a,b)=>a.time.localeCompare(b.time))});
}));

/** Invio ospite: non crea account; la transazione collega anagrafica, cane e richiesta. */
r.post("/guest-bookings",guestBookingLimiter,guestPhotoUpload.single("photo"),h(async(req,res)=>{
  let payload:unknown;
  try{payload=JSON.parse(String(req.body?.payload||"{}"));}catch{throw new HttpError(400,"Dati della richiesta non validi.");}
  const input=guestBookingSchema.parse(payload);
  if(req.file&&req.file.size>2*1024*1024) throw new HttpError(413,"La foto deve essere inferiore a 2 MB prima della compressione.");
  let stored:{key:string}|null=null;
  try{
    if(req.file) stored=await storeDogPhoto(req.file.buffer,req.file.mimetype);
    const version=await privacyPolicyVersion();
    const result=await createGuestBooking(input,{
      ip:String(req.ip||"").slice(0,64)||null,userAgent:String(req.get("user-agent")||"").slice(0,255)||null,
      privacyVersion:version,request:req,
    },stored?.key||null,req.file?crypto.createHash("sha256").update(req.file.buffer).digest("hex"):null);
    if(result.duplicate&&stored?.key) await deleteStored(stored.key);
    res.status(result.duplicate?200:201).json({ok:true,id:result.id,duplicate:result.duplicate,trackingUrl:result.trackingUrl,
      message:result.duplicate?"La richiesta risulta già ricevuta. Controlla l’email per gli aggiornamenti.":"Richiesta inviata. È in attesa di approvazione da Dog’s Planet."});
  }catch(e){if(stored?.key) await deleteStored(stored.key);throw e;}
}));

r.get("/guest-requests/:id",h(async(req,res)=>{
  res.set("Cache-Control","no-store");
  const token=z.string().min(32).max(128).parse(req.query.token);
  res.json(await guestRequestStatus(id(req.params.id),token));
}));

r.get("/products", h(async (req, res) => {
  const s = await getSettings();
  if (!s.site.shopEnabled) return res.json({ enabled: false, rows: [] });
  const category = req.query.category ? String(req.query.category) : null;
  const cats = await db.select({ name: productCategories.name }).from(productCategories).where(eq(productCategories.active, true)).orderBy(asc(productCategories.sortOrder), asc(productCategories.name));
  const variantCounts = await db.select({ productId: productVariants.productId, n: sql<number>`count(*)::int`, stock: sql<number>`sum(${productVariants.stock})::int`, minPrice: sql<number>`min(${productVariants.priceCents})::int` })
    .from(productVariants).where(eq(productVariants.active, true)).groupBy(productVariants.productId);
  const rows = await db.select({
    id: products.id, name: products.name, slug: products.slug, category: products.category, description: products.description,
    priceCents: products.priceCents, salePriceCents: products.salePriceCents, imageUrl: products.imageUrl, stock: products.stock, isFood: products.isFood,
  }).from(products).where(and(eq(products.active, true), eq(products.visibleOnline, true), category ? eq(products.category, category) : undefined))
    .orderBy(asc(products.category), asc(products.name)).limit(200);
  res.json({ enabled: true, categories: cats.map((c) => c.name), rows: rows.map((p) => { const v = variantCounts.find((x) => x.productId === p.id); return v ? { ...p, hasVariants: true, stock: v.stock } : p; }) });
}));

r.get("/products/:id", h(async (req, res) => {
  const [p0] = await db.select().from(products).where(and(eq(products.id, id(req.params.id)), eq(products.active, true), eq(products.visibleOnline, true)));
  if (!p0) throw new HttpError(404, "Prodotto non trovato");
  const { costCents, supplierId, ...pub } = p0;
  const variants = await db.select({ id: productVariants.id, name: productVariants.name, priceCents: productVariants.priceCents, stock: productVariants.stock })
    .from(productVariants).where(and(eq(productVariants.productId, p0.id), eq(productVariants.active, true))).orderBy(asc(productVariants.sortOrder));
  res.json({ ...pub, variants });
}));

/** Disiscrizione dalle comunicazioni promozionali (link nelle email) – registrata nello storico consensi. */
r.get("/unsubscribe", h(async (req, res) => {
  const token = String(req.query.token || "");
  res.set("Cache-Control", "no-store");
  const [u] = token.length >= 16 ? await db.select().from(users).where(eq(users.unsubscribeToken, token)) : [];
  if (u && u.consentMarketing) {
    await db.update(users).set({ consentMarketing: false, consentDate: new Date() }).where(eq(users.id, u.id));
    await recordConsent(null, { userId: u.id, kind: "marketing", granted: false, source: "link_disiscrizione", req });
  }
  res.type("html").send(`<!doctype html><html lang="it"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Disiscrizione</title>
<body style="font-family:system-ui,sans-serif;background:#E6F7FF;color:#0B3D91;display:grid;place-items:center;min-height:100vh;margin:0;text-align:center;padding:24px">
<div><img src="/brand/logo.png" alt="Dog's Planet" style="max-width:220px"><h1>${u ? "Disiscrizione completata" : "Link non valido"}</h1>
<p>${u ? "Non riceverai più comunicazioni promozionali. Continuerai a ricevere solo le comunicazioni di servizio (conferme e promemoria)." : "Il link non è valido o è scaduto."}</p>
<p><a href="/account/profilo" style="color:#00B6C8;font-weight:bold">Gestisci le preferenze</a></p></div></body></html>`);
}));

r.get("/promotions", h(async (_req, res) => {
  const today = todayRome();
  res.json(await db.select({ id: promotions.id, title: promotions.title, description: promotions.description, code: promotions.code, endsAt: promotions.endsAt })
    .from(promotions).where(and(eq(promotions.active, true), eq(promotions.showOnSite, true),
      or(isNull(promotions.startsAt), lte(promotions.startsAt, today)), or(isNull(promotions.endsAt), gte(promotions.endsAt, today)))));
}));

const contactLimiter = rateLimit({ windowMs: 60 * 60_000, limit: 5, message: { error: "Hai già inviato diversi messaggi, riprova più tardi" } });
r.post("/contact", contactLimiter, h(async (req, res) => {
  const d = z.object({
    name: z.string().trim().min(2).max(120), email: z.string().trim().email(), phone: z.string().trim().max(40).optional(),
    message: z.string().trim().min(5).max(3000), consent: z.literal(true), website: z.string().max(0).optional(), // honeypot anti-spam
  }).parse(req.body);
  await sendEmail(BUSINESS.email, `Messaggio dal sito – ${d.name}`,
    emailLayout("Nuovo messaggio dal sito", p(`Da: ${d.name} <${d.email}> ${d.phone || ""}`) + p(d.message)), "contact");
  res.json({ ok: true });
}));

export default r;
