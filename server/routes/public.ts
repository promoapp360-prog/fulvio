import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { and, asc, eq, gte, isNull, lte, or } from "drizzle-orm";
import { db } from "../db";
import {
  pages, faqs, services, serviceVariants, serviceSupplements, operators, operatorServices, operatorShifts, products, promotions, dogs,
} from "../../shared/schema";
import { publicSettings } from "../services/settings";
import { availability, quote } from "../services/availability";
import { sendEmail, emailLayout, p } from "../services/email";
import { getSettings } from "../services/settings";
import { h, HttpError, id, zDay } from "../util";
import { todayRome } from "../time";
import { BUSINESS } from "../../shared/constants";

const r = Router();

// cache HTTP breve per i contenuti pubblici: riduce le query ripetute
r.use((req, res, next) => { if (req.method === "GET") res.set("Cache-Control", "public, max-age=60"); next(); });

r.get("/settings", h(async (_req, res) => res.json(await publicSettings())));

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

r.get("/products", h(async (req, res) => {
  const s = await getSettings();
  if (!s.site.shopEnabled) return res.json({ enabled: false, rows: [] });
  const category = req.query.category ? String(req.query.category) : null;
  const rows = await db.select({
    id: products.id, name: products.name, slug: products.slug, category: products.category, description: products.description,
    priceCents: products.priceCents, salePriceCents: products.salePriceCents, imageUrl: products.imageUrl, stock: products.stock, isFood: products.isFood,
  }).from(products).where(and(eq(products.active, true), eq(products.visibleOnline, true), category ? eq(products.category, category) : undefined))
    .orderBy(asc(products.category), asc(products.name)).limit(200);
  res.json({ enabled: true, rows });
}));

r.get("/products/:id", h(async (req, res) => {
  const [p0] = await db.select().from(products).where(and(eq(products.id, id(req.params.id)), eq(products.active, true), eq(products.visibleOnline, true)));
  if (!p0) throw new HttpError(404, "Prodotto non trovato");
  const { costCents, supplierId, ...pub } = p0;
  res.json(pub);
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
