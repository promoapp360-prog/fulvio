import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { db } from "../../db";
import { pages, faqs, media } from "../../../shared/schema";
import { requirePerm, requireAdmin } from "../../auth";
import { crud } from "../../crud";
import { storeUpload, deleteStored } from "../../services/storage";
import { getSettings, setSetting, DEFAULT_SETTINGS, type SettingsKey } from "../../services/settings";
import { audit } from "../../services/audit";
import { h, HttpError, id, zOptStr } from "../../util";
import { emailTemplates } from "../../../shared/schema";
import { DEFAULT_TEMPLATES } from "../../services/templates";
import { sendTemplate } from "../../services/email";

const r = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => cb(null, /^(image\/(jpeg|png|webp|gif|svg\+xml)|application\/pdf)$/.test(file.mimetype)),
});

r.use("/pages", crud({
  table: pages, entity: "page", perm: "contenuti", search: ["title", "slug"], order: [{ col: "slug", dir: "asc" }],
  schema: z.object({
    slug: z.string().trim().regex(/^[a-z0-9-]{2,80}$/, "solo lettere minuscole, numeri e trattini"), title: z.string().trim().min(1).max(160),
    subtitle: zOptStr(255), body: z.string().max(100_000).default(""), seoTitle: zOptStr(160), seoDescription: zOptStr(320),
    imageUrl: zOptStr(500), videoUrl: zOptStr(500), published: z.boolean().default(true),
  }),
}));

r.use("/faqs", crud({
  table: faqs, entity: "faq", perm: "contenuti", filters: ["section"], order: [{ col: "section", dir: "asc" }, { col: "sortOrder", dir: "asc" }],
  schema: z.object({
    section: z.string().trim().min(1).max(40), question: z.string().trim().min(3).max(255), answer: z.string().trim().min(1).max(5000),
    sortOrder: z.coerce.number().int().default(0), active: z.boolean().default(true),
  }),
}));

r.get("/media", requirePerm("contenuti"), h(async (_req, res) => {
  res.json(await db.select().from(media).orderBy(desc(media.createdAt)).limit(300));
}));

/** Upload ottimizzato (le immagini vengono ridimensionate e convertite in WebP). */
r.post("/media", requirePerm("contenuti"), upload.single("file"), h(async (req, res) => {
  if (!req.file) throw new HttpError(400, "File mancante o formato non consentito (immagini JPG/PNG/WebP o PDF, max 8 MB)");
  const stored = await storeUpload(req.file.buffer, req.file.mimetype);
  const [m] = await db.insert(media).values({
    storageKey: stored.key, url: stored.url, mime: stored.mime, sizeBytes: stored.size, width: stored.width, height: stored.height,
    alt: String(req.body.alt || "").slice(0, 255) || null, uploadedBy: req.user!.id,
  }).returning();
  await audit(req, "upload", "media", m.id, { key: stored.key, size: stored.size });
  res.status(201).json(m);
}));

r.delete("/media/:id", requirePerm("contenuti"), h(async (req, res) => {
  const [m] = await db.delete(media).where(eq(media.id, id(req.params.id))).returning();
  if (!m) throw new HttpError(404, "File non trovato");
  await deleteStored(m.storageKey);
  await audit(req, "delete", "media", m.id);
  res.json({ ok: true });
}));

// ---------- template email personalizzabili ----------
r.get("/email-templates", requirePerm("impostazioni", "marketing"), h(async (_req, res) => {
  const rows = await db.select().from(emailTemplates);
  res.json(Object.entries(DEFAULT_TEMPLATES).map(([key, d]) => {
    const t = rows.find((x) => x.key === key);
    return { key, name: d.name, subject: t?.subject ?? d.subject, body: t?.body ?? d.body, active: t?.active ?? true, customized: !!t, defaultSubject: d.subject, defaultBody: d.body };
  }));
}));
r.put("/email-templates/:key", requirePerm("impostazioni", "marketing"), h(async (req, res) => {
  const key = req.params.key;
  if (!DEFAULT_TEMPLATES[key]) throw new HttpError(404, "Template inesistente");
  const d = z.object({ subject: z.string().trim().min(1).max(200), body: z.string().trim().min(1).max(10_000), active: z.boolean().default(true) }).parse(req.body);
  await db.insert(emailTemplates).values({ key, name: DEFAULT_TEMPLATES[key].name, ...d })
    .onConflictDoUpdate({ target: emailTemplates.key, set: { ...d, updatedAt: new Date() } });
  await audit(req, "update", "email_template", key, d);
  res.json({ ok: true });
}));
r.delete("/email-templates/:key", requirePerm("impostazioni", "marketing"), h(async (req, res) => {
  await db.delete(emailTemplates).where(eq(emailTemplates.key, req.params.key));
  res.json({ ok: true });
}));
r.post("/email-templates/:key/test", requirePerm("impostazioni", "marketing"), h(async (req, res) => {
  const ok = await sendTemplate(req.params.key, req.user!.email, { nome: req.user!.firstName, cane: "Fido", servizio: "Toelettatura professionale", data: "lunedì 1 dicembre, 10:00", operatore: "Martina", importo: "€ 0,00", ordine: 1, stato: "Esempio", giorni: 30, punti: 0, messaggio: "Messaggio di prova", oggetto: "Email di prova", link: process.env.PUBLIC_URL || "" }, { userId: req.user!.id });
  res.json({ queued: ok, to: req.user!.email });
}));

// ---------- impostazioni ----------
r.get("/settings", h(async (_req, res) => res.json(await getSettings())));

r.put("/settings/:key", h(async (req, res) => {
  const key = req.params.key as SettingsKey;
  if (!(key in DEFAULT_SETTINGS)) throw new HttpError(404, "Sezione impostazioni inesistente");
  // contenuti del sito modificabili da chi gestisce i contenuti, il resto da chi gestisce le impostazioni
  const perm = ["site", "seo", "selfservice", "brand"].includes(key) ? "contenuti" : key === "staff" ? "personale" : key === "loyalty" ? "fidelity" : "impostazioni";
  const u = req.user!;
  if (u.role !== "admin" && !(u.permissions || []).includes(perm)) throw new HttpError(403, "Permesso negato");
  if (key === "payments" && u.role !== "admin") throw new HttpError(403, "Solo l'amministratore modifica i pagamenti");
  const body = z.record(z.unknown()).parse(req.body);
  const allowed = Object.keys((DEFAULT_SETTINGS as any)[key]);
  const clean = Object.fromEntries(Object.entries(body).filter(([k]) => allowed.includes(k)));
  if (key === "booking") {
    const b = z.object({
      slotMinutes: z.number().int().min(5).max(240), bufferMin: z.number().int().min(0).max(120), minNoticeHours: z.number().int().min(0).max(720),
      maxDaysAhead: z.number().int().min(1).max(365), requestBlocksSlot: z.boolean(), allowAnyOperator: z.boolean(),
    }).partial().parse(clean);
    Object.assign(clean, b);
  }
  if (key === "staff") Object.assign(clean, z.object({ roundingStep: z.number().int().min(1).max(60), roundingMode: z.enum(["vicino", "difetto", "eccesso"]), payWeekday: z.number().int().min(0).max(6) }).partial().parse(clean));
  if (key === "loyalty") Object.assign(clean, z.object({
    enabled: z.boolean(), pointsPerEuro: z.number().min(0).max(100), welcomePoints: z.number().int().min(0), birthdayPoints: z.number().int().min(0), earnOnServices: z.boolean(), earnOnProducts: z.boolean(),
    pointValueCents: z.number().int().min(0).max(10_000), minRedeemPoints: z.number().int().min(0), expiryMode: z.enum(["nessuna", "annuale", "fissa", "periodo"]),
    expiryFixedDate: z.string().regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, "formato MM-GG"), expiryDays: z.number().int().min(1).max(3650),
  }).partial().parse(clean));
  if (key === "notifications") Object.assign(clean, z.object({ reminderHours: z.number().int().min(1).max(168), recallEnabled: z.boolean(), recallDefaultDays: z.number().int().min(1).max(365).nullable() }).partial().parse(clean));
  if (key === "cancellation") Object.assign(clean, z.object({ cancelHours: z.number().int().min(0).max(720), rescheduleHours: z.number().int().min(0).max(720), depositPolicy: z.string().max(2000), reasons: z.array(z.string().trim().min(1).max(80)).max(30) }).partial().parse(clean));
  if (key === "shop") Object.assign(clean, z.object({
    pickupEnabled: z.boolean(), pickupInfo: z.string().max(1000), deliveryEnabled: z.boolean(),
    deliveryZones: z.array(z.object({ name: z.string().trim().min(1).max(80), caps: z.array(z.string().trim().regex(/^\d{5}$/, "CAP di 5 cifre")).min(1), costCents: z.number().int().min(0), freeFromCents: z.number().int().min(0).nullable().optional(), eta: z.string().max(80).optional(), active: z.boolean().optional() })).max(50),
  }).partial().parse(clean));
  if (key === "payments") {
    Object.assign(clean, z.object({ defaultMode: z.enum(["nessuno", "acconto", "saldo", "negozio"]), depositPercent: z.number().int().min(1).max(100), onlineEnabled: z.boolean(), customMethods: z.array(z.string().trim().min(1).max(40)).max(20) }).partial().parse(clean));
  }
  const next = await setSetting(key, clean as any);
  await audit(req, "settings_update", "settings", key, clean);
  res.json(next);
}));

export default r;
