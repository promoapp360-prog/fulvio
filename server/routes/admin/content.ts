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

// ---------- impostazioni ----------
r.get("/settings", h(async (_req, res) => res.json(await getSettings())));

r.put("/settings/:key", h(async (req, res) => {
  const key = req.params.key as SettingsKey;
  if (!(key in DEFAULT_SETTINGS)) throw new HttpError(404, "Sezione impostazioni inesistente");
  // contenuti del sito modificabili da chi gestisce i contenuti, il resto da chi gestisce le impostazioni
  const perm = key === "site" || key === "seo" || key === "selfservice" ? "contenuti" : "impostazioni";
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
  if (key === "payments") {
    Object.assign(clean, z.object({ defaultMode: z.enum(["nessuno", "acconto", "saldo", "negozio"]), depositPercent: z.number().int().min(1).max(100), onlineEnabled: z.boolean(), customMethods: z.array(z.string().trim().min(1).max(40)).max(20) }).partial().parse(clean));
  }
  const next = await setSetting(key, clean as any);
  await audit(req, "settings_update", "settings", key, clean);
  res.json(next);
}));

export default r;
