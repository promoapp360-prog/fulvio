import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { desc, eq, sql, and, ilike, or, asc } from "drizzle-orm";
import { db } from "../../db";
import { auditLog, emailQueue, pushLog, privacyContacts, privacyContactHistory, contactImports, consentPolicies, customerConsents, users, cookieChoices } from "../../../shared/schema";
import { requirePerm, requireAdmin } from "../../auth";
import { audit } from "../../services/audit";
import { retryEmail } from "../../services/email";
import { recordConsent } from "../../services/consents";
import { crud } from "../../crud";
import { exportAll } from "../../backup";
import { parseCsv, truthy, normalizePhone } from "../../logic";
import { h, HttpError, id, paging, toCsv, zOptStr } from "../../util";

const r = Router();
const csvUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

r.get("/audit", requireAdmin, h(async (req, res) => {
  const { pageSize, offset, page } = paging(req);
  const entity = req.query.entity ? String(req.query.entity) : null;
  const rows = await db.select({ l: auditLog, actor: sql<string>`${users.firstName} || ' ' || ${users.lastName}` }).from(auditLog).leftJoin(users, eq(users.id, auditLog.actorId))
    .where(entity ? eq(auditLog.entity, entity) : undefined).orderBy(desc(auditLog.id)).limit(pageSize).offset(offset);
  res.json({ rows: rows.map((x) => ({ ...x.l, actor: x.actor })), page, pageSize });
}));

// ---------- registro email (coda) e push ----------
r.get("/email-log", requirePerm("marketing", "impostazioni"), h(async (req, res) => {
  const { pageSize, offset, page } = paging(req);
  const status = req.query.status ? String(req.query.status) : null;
  const rows = await db.select({ id: emailQueue.id, toEmail: emailQueue.toEmail, subject: emailQueue.subject, template: emailQueue.template, status: emailQueue.status, attempts: emailQueue.attempts,
    lastError: emailQueue.lastError, createdAt: emailQueue.createdAt, sentAt: emailQueue.sentAt, nextAttemptAt: emailQueue.nextAttemptAt })
    .from(emailQueue).where(status ? eq(emailQueue.status, status) : undefined).orderBy(desc(emailQueue.id)).limit(pageSize).offset(offset);
  res.json({ rows, page, pageSize });
}));
r.post("/email-log/:id/retry", requirePerm("marketing", "impostazioni"), h(async (req, res) => {
  await retryEmail(id(req.params.id));
  res.json({ ok: true });
}));
r.get("/push-log", requirePerm("marketing", "impostazioni"), h(async (req, res) => {
  const { pageSize, offset, page } = paging(req);
  const rows = await db.select({ l: pushLog, name: sql<string>`${users.firstName} || ' ' || ${users.lastName}` }).from(pushLog).leftJoin(users, eq(users.id, pushLog.userId)).orderBy(desc(pushLog.id)).limit(pageSize).offset(offset);
  res.json({ rows: rows.map((x) => ({ ...x.l, name: x.name })), page, pageSize });
}));

/** Backup completo in JSON (scaricabile). Per backup su file vedi `npm run db:backup`. */
r.get("/backup", requireAdmin, h(async (req, res) => {
  const data = await exportAll();
  await audit(req, "backup_download", "system", null);
  res.setHeader("Content-Disposition", `attachment; filename="dogs-planet-backup-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json(data);
}));

// ---------- informative e versioni ----------
r.use("/consent-policies", crud({
  table: consentPolicies, entity: "consent_policy", perm: "privacy", order: [{ col: "kind", dir: "asc" }, { col: "publishedAt", dir: "desc" }],
  schema: z.object({ kind: z.enum(["privacy", "marketing", "cookie", "condizioni"]), version: z.string().trim().min(1).max(20), summary: zOptStr(4000), active: z.boolean().default(true) }),
}));

r.get("/consents", requirePerm("privacy"), h(async (req, res) => {
  const { pageSize, offset, page } = paging(req);
  const rows = await db.select({ c: customerConsents, name: sql<string>`${users.firstName} || ' ' || ${users.lastName}`, email: users.email }).from(customerConsents)
    .leftJoin(users, eq(users.id, customerConsents.userId)).orderBy(desc(customerConsents.id)).limit(pageSize).offset(offset);
  res.json({ rows: rows.map((x) => ({ ...x.c, name: x.name, email: x.email })), page, pageSize });
}));

r.get("/cookie-choices",requirePerm("privacy","impostazioni"),h(async(_req,res)=>{
  res.json(await db.select().from(cookieChoices).orderBy(desc(cookieChoices.id)).limit(100));
}));

// ---------- contatti privacy: predisposizione all'importazione (punto 25) ----------
r.get("/privacy-contacts", requirePerm("privacy"), h(async (req, res) => {
  const { pageSize, offset, page } = paging(req);
  const q = String(req.query.q || "").trim();
  const where = and(q ? or(ilike(privacyContacts.email, `%${q}%`), ilike(privacyContacts.lastName, `%${q}%`), ilike(privacyContacts.phone, `%${q}%`)) : undefined,
    req.query.marketingStatus ? eq(privacyContacts.marketingStatus, String(req.query.marketingStatus)) : undefined);
  const [rows, [{ count }], imports] = await Promise.all([
    db.select().from(privacyContacts).where(where).orderBy(desc(privacyContacts.id)).limit(pageSize).offset(offset),
    db.select({ count: sql<number>`count(*)::int` }).from(privacyContacts).where(where),
    db.select().from(contactImports).orderBy(desc(contactImports.id)).limit(20),
  ]);
  res.json({ rows, total: count, page, pageSize, imports });
}));

r.get("/privacy-contacts/:id/history", requirePerm("privacy"), h(async (req, res) => {
  res.json(await db.select().from(privacyContactHistory).where(eq(privacyContactHistory.contactId, id(req.params.id))).orderBy(asc(privacyContactHistory.id)));
}));

/** Aggiornamento manuale degli stati (es. presa visione, revoca) con storico. */
r.patch("/privacy-contacts/:id", requirePerm("privacy"), h(async (req, res) => {
  const cid = id(req.params.id);
  const d = z.object({
    privacyStatus: z.enum(["non_inviata", "inviata", "presa_visione", "accettata", "rifiutata"]).optional(), privacyVersion: zOptStr(20),
    marketingStatus: z.enum(["non_richiesto", "da_verificare", "concesso", "negato", "revocato"]).optional(), consentProof: zOptStr(2000),
  }).parse(req.body);
  if (d.marketingStatus === "concesso" && !d.consentProof) throw new HttpError(400, "Per registrare il consenso marketing indica fonte e prova del consenso");
  const [before] = await db.select().from(privacyContacts).where(eq(privacyContacts.id, cid));
  if (!before) throw new HttpError(404, "Contatto non trovato");
  const patch: any = { ...d, updatedAt: new Date() };
  if (d.privacyStatus === "presa_visione" || d.privacyStatus === "accettata") patch.privacySeenAt = before.privacySeenAt ?? new Date();
  if (d.marketingStatus === "concesso") { patch.marketingConsentAt = new Date(); patch.consentMarketing = true; patch.revokedAt = null; }
  if (d.marketingStatus === "revocato") { patch.revokedAt = new Date(); patch.consentMarketing = false; }
  const [c] = await db.update(privacyContacts).set(patch).where(eq(privacyContacts.id, cid)).returning();
  await db.insert(privacyContactHistory).values({ contactId: cid, actorId: req.user!.id, changes: { before: { privacyStatus: before.privacyStatus, marketingStatus: before.marketingStatus }, after: d } });
  if (d.marketingStatus && d.marketingStatus !== before.marketingStatus && ["concesso", "revocato", "negato"].includes(d.marketingStatus)) {
    await recordConsent(null, { privacyContactId: cid, userId: c.linkedUserId, kind: "marketing", granted: d.marketingStatus === "concesso", source: "contatto_importato", proof: d.consentProof, policyVersion: d.privacyVersion, createdBy: req.user!.id });
    // il consenso si propaga al cliente collegato solo se esplicitamente concesso o revocato
    if (c.linkedUserId) await db.update(users).set({ consentMarketing: d.marketingStatus === "concesso", consentDate: new Date() }).where(eq(users.id, c.linkedUserId));
  }
  await audit(req, "privacy_update", "privacy_contact", cid, d);
  res.json(c);
}));

/**
 * Importazione CSV (predisposizione): validazione, riconoscimento duplicati (email, telefono, id esterno),
 * associazione ai clienti esistenti, registro importazioni e storico. I contatti importati NON sono mai autorizzati
 * al marketing in automatico: un consenso dichiarato nel file resta "da verificare".
 * Colonne: id_esterno, nome, cognome, email, telefono, stato_informativa, versione_informativa, data_presa_visione,
 *          consenso_marketing, data_consenso, fonte, prova_consenso
 */
r.post("/privacy-contacts/import", requirePerm("privacy"), csvUpload.single("file"), h(async (req, res) => {
  if (!req.file) throw new HttpError(400, "Carica un file CSV");
  const rowsCsv = parseCsv(req.file.buffer.toString("utf8"));
  if (rowsCsv.length < 2) throw new HttpError(400, "Il file non contiene righe");
  const head = rowsCsv[0].map((x) => x.trim().toLowerCase().replace(/\s+/g, "_"));
  const col = (...names: string[]) => head.findIndex((x) => names.includes(x));
  const ix = {
    ext: col("id_esterno", "external_id", "id"), first: col("nome", "first_name"), last: col("cognome", "last_name"), email: col("email", "e-mail", "mail"),
    phone: col("telefono", "cellulare", "phone"), pst: col("stato_informativa"), pver: col("versione_informativa"), pseen: col("data_presa_visione"),
    cm: col("consenso_marketing", "marketing"), date: col("data_consenso", "data"), src: col("fonte", "source", "provenienza"), proof: col("prova_consenso", "prova"),
  };
  if (ix.email < 0 && ix.phone < 0) throw new HttpError(400, "Serve almeno una colonna email o telefono");
  const source = String(req.body.source || "").trim().slice(0, 80) || "import_csv";
  const [imp] = await db.insert(contactImports).values({ filename: req.file.originalname.slice(0, 255), source, rowsTotal: rowsCsv.length - 1, createdBy: req.user!.id }).returning();
  const stats = { imported: 0, updated: 0, skipped: 0, linked: 0, duplicates: 0 };
  const errors: { row: number; error: string }[] = [];
  const parseDate = (v: string) => { if (!v) return null; const d = new Date(v.replace(/^(\d{2})\/(\d{2})\/(\d{4})/, "$3-$2-$1")); return isNaN(d.getTime()) ? null : d; };
  const PST = ["non_inviata", "inviata", "presa_visione", "accettata", "rifiutata"];
  for (const [i, r0] of rowsCsv.slice(1).entries()) {
    const n = i + 2;
    const get = (k: number) => (k >= 0 ? (r0[k] || "").trim() : "");
    const email = get(ix.email).toLowerCase() || null;
    const phone = get(ix.phone) || null;
    const ext = get(ix.ext) || null;
    if (!email && !phone) { stats.skipped++; errors.push({ row: n, error: "email e telefono mancanti" }); continue; }
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { stats.skipped++; errors.push({ row: n, error: `email non valida: ${email}` }); continue; }
    if (phone && normalizePhone(phone).length < 6) { stats.skipped++; errors.push({ row: n, error: `telefono non valido: ${phone}` }); continue; }
    const pst = get(ix.pst).toLowerCase().replace(/\s+/g, "_");
    const declaredMkt = truthy(get(ix.cm));
    const values: any = {
      firstName: get(ix.first) || null, lastName: get(ix.last) || null, email, phone, externalId: ext, source: get(ix.src) || source, importId: imp.id,
      privacyStatus: PST.includes(pst) ? pst : "non_inviata", privacyVersion: get(ix.pver) || null, privacySeenAt: parseDate(get(ix.pseen)),
      consentProof: get(ix.proof) || null, consentMarketing: false, marketingStatus: declaredMkt ? "da_verificare" : "non_richiesto",
      consentDate: parseDate(get(ix.date)), updatedAt: new Date(),
    };
    // riconoscimento duplicati: id esterno, email, telefono normalizzato
    const norm = phone ? normalizePhone(phone) : null;
    const [ex] = await db.select().from(privacyContacts).where(or(
      ext ? and(eq(privacyContacts.externalId, ext), eq(privacyContacts.source, values.source)) : sql`false`,
      email ? sql`lower(${privacyContacts.email}) = ${email}` : sql`false`,
      norm ? sql`regexp_replace(coalesce(${privacyContacts.phone}, ''), '\\D', '', 'g') in (${norm}, ${"39" + norm})` : sql`false`,
    )).limit(1);
    const [u] = await db.select({ id: users.id }).from(users).where(and(eq(users.role, "customer"), or(
      email ? sql`lower(${users.email}) = ${email}` : sql`false`,
      norm ? sql`regexp_replace(coalesce(${users.phone}, ''), '\\D', '', 'g') in (${norm}, ${"39" + norm})` : sql`false`))).limit(1);
    if (u) { values.linkedUserId = u.id; stats.linked++; }
    if (ex) {
      stats.duplicates++;
      // un aggiornamento non può mai trasformare in automatico un consenso in "concesso"
      if (["concesso", "revocato", "negato"].includes(ex.marketingStatus)) { delete values.marketingStatus; delete values.consentMarketing; }
      await db.update(privacyContacts).set(values).where(eq(privacyContacts.id, ex.id));
      await db.insert(privacyContactHistory).values({ contactId: ex.id, actorId: req.user!.id, importId: imp.id, changes: { tipo: "aggiornamento_import", valori: values } });
      stats.updated++;
    } else {
      const [c] = await db.insert(privacyContacts).values(values).returning();
      await db.insert(privacyContactHistory).values({ contactId: c.id, actorId: req.user!.id, importId: imp.id, changes: { tipo: "importazione", valori: values } });
      stats.imported++;
    }
  }
  await db.update(contactImports).set({ ...stats, errors: errors.slice(0, 500) }).where(eq(contactImports.id, imp.id));
  await audit(req, "privacy_import", "privacy_contacts", imp.id, { ...stats, file: req.file.originalname });
  res.json({ importId: imp.id, ...stats, errors: errors.slice(0, 50) });
}));

r.get("/privacy-contacts/export.csv", requirePerm("privacy"), h(async (_req, res) => {
  const rows = await db.select().from(privacyContacts).orderBy(desc(privacyContacts.id));
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="contatti-privacy.csv"');
  res.send(toCsv(rows.map((c) => ({
    id: c.id, id_esterno: c.externalId, nome: c.firstName, cognome: c.lastName, email: c.email, telefono: c.phone, provenienza: c.source, data_importazione: c.importedAt,
    stato_informativa: c.privacyStatus, versione_informativa: c.privacyVersion, data_presa_visione: c.privacySeenAt, stato_marketing: c.marketingStatus,
    data_consenso: c.marketingConsentAt, prova_consenso: c.consentProof, data_revoca: c.revokedAt, cliente_collegato: c.linkedUserId,
  }))));
}));

export default r;
