import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { desc, eq, sql, and, ilike, or } from "drizzle-orm";
import { db } from "../../db";
import { auditLog, emailLog, privacyContacts, users } from "../../../shared/schema";
import { requirePerm, requireAdmin } from "../../auth";
import { audit } from "../../services/audit";
import { exportAll } from "../../backup";
import { h, HttpError, paging, toCsv } from "../../util";

const r = Router();
const csvUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

r.get("/audit", requireAdmin, h(async (req, res) => {
  const { pageSize, offset, page } = paging(req);
  const entity = req.query.entity ? String(req.query.entity) : null;
  const rows = await db.select({ l: auditLog, actor: sql<string>`${users.firstName} || ' ' || ${users.lastName}` }).from(auditLog).leftJoin(users, eq(users.id, auditLog.actorId))
    .where(entity ? eq(auditLog.entity, entity) : undefined).orderBy(desc(auditLog.id)).limit(pageSize).offset(offset);
  res.json({ rows: rows.map((x) => ({ ...x.l, actor: x.actor })), page, pageSize });
}));

r.get("/email-log", requirePerm("marketing"), h(async (req, res) => {
  const { pageSize, offset, page } = paging(req);
  res.json({ rows: await db.select().from(emailLog).orderBy(desc(emailLog.id)).limit(pageSize).offset(offset), page, pageSize });
}));

/** Backup completo in JSON (scaricabile). Per backup automatici vedi `npm run db:backup`. */
r.get("/backup", requireAdmin, h(async (req, res) => {
  const data = await exportAll();
  await audit(req, "backup_download", "system", null);
  res.setHeader("Content-Disposition", `attachment; filename="dogs-planet-backup-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json(data);
}));

// ---------- contatti privacy (predisposizione importazione) ----------
r.get("/privacy-contacts", requirePerm("utenti"), h(async (req, res) => {
  const { pageSize, offset, page } = paging(req);
  const q = String(req.query.q || "").trim();
  const where = q ? or(ilike(privacyContacts.email, `%${q}%`), ilike(privacyContacts.lastName, `%${q}%`), ilike(privacyContacts.phone, `%${q}%`)) : undefined;
  const [rows, [{ count }]] = await Promise.all([
    db.select().from(privacyContacts).where(where).orderBy(desc(privacyContacts.id)).limit(pageSize).offset(offset),
    db.select({ count: sql<number>`count(*)::int` }).from(privacyContacts).where(where),
  ]);
  res.json({ rows, total: count, page, pageSize });
}));

function parseCsv(text: string) {
  const clean = text.replace(/^﻿/, "");
  const sep = (clean.split("\n")[0].match(/;/g) || []).length >= (clean.split("\n")[0].match(/,/g) || []).length ? ";" : ",";
  const out: string[][] = []; let row: string[] = []; let cur = ""; let q = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (q) { if (c === '"' && clean[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; continue; }
    if (c === '"') q = true; else if (c === sep) { row.push(cur); cur = ""; } else if (c === "\n" || c === "\r") {
      if (c === "\r" && clean[i + 1] === "\n") i++;
      row.push(cur); cur = ""; if (row.some((x) => x.trim())) out.push(row); row = [];
    } else cur += c;
  }
  row.push(cur); if (row.some((x) => x.trim())) out.push(row);
  return out;
}

const truthy = (v?: string) => /^(1|si|sì|s|yes|y|true|x|vero)$/i.test((v || "").trim());

/**
 * Importa contatti privacy da CSV. Intestazioni riconosciute (qualsiasi ordine):
 * nome, cognome, email, telefono, consenso_privacy, consenso_marketing, data_consenso, fonte
 */
r.post("/privacy-contacts/import", requirePerm("utenti"), csvUpload.single("file"), h(async (req, res) => {
  if (!req.file) throw new HttpError(400, "Carica un file CSV");
  const rowsCsv = parseCsv(req.file.buffer.toString("utf8"));
  if (rowsCsv.length < 2) throw new HttpError(400, "Il file non contiene righe");
  const head = rowsCsv[0].map((x) => x.trim().toLowerCase().replace(/\s+/g, "_"));
  const col = (...names: string[]) => head.findIndex((x) => names.includes(x));
  const ix = {
    first: col("nome", "first_name"), last: col("cognome", "last_name"), email: col("email", "e-mail", "mail"), phone: col("telefono", "cellulare", "phone"),
    cp: col("consenso_privacy", "privacy"), cm: col("consenso_marketing", "marketing"), date: col("data_consenso", "data"), src: col("fonte", "source"),
  };
  if (ix.email < 0 && ix.phone < 0) throw new HttpError(400, "Serve almeno una colonna email o telefono");
  let imported = 0, skipped = 0, linked = 0;
  for (const r0 of rowsCsv.slice(1)) {
    const get = (i: number) => (i >= 0 ? (r0[i] || "").trim() : "");
    const email = get(ix.email).toLowerCase() || null;
    const phone = get(ix.phone) || null;
    if (!email && !phone) { skipped++; continue; }
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { skipped++; continue; }
    const d = get(ix.date); const dt = d ? new Date(d.replace(/^(\d{2})\/(\d{2})\/(\d{4})$/, "$3-$2-$1")) : null;
    const [u] = email ? await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${email}`) : [];
    const values = {
      firstName: get(ix.first) || null, lastName: get(ix.last) || null, email, phone,
      consentPrivacy: truthy(get(ix.cp)), consentMarketing: truthy(get(ix.cm)), consentDate: dt && !isNaN(dt.getTime()) ? dt : null,
      source: get(ix.src) || req.file.originalname.slice(0, 80), linkedUserId: u?.id ?? null,
    };
    if (email) {
      const [ex] = await db.select({ id: privacyContacts.id }).from(privacyContacts).where(sql`lower(${privacyContacts.email}) = ${email}`);
      if (ex) await db.update(privacyContacts).set(values).where(eq(privacyContacts.id, ex.id));
      else await db.insert(privacyContacts).values(values);
    } else await db.insert(privacyContacts).values(values);
    imported++; if (u) linked++;
  }
  await audit(req, "privacy_import", "privacy_contacts", null, { imported, skipped, linked, file: req.file.originalname });
  res.json({ imported, skipped, linked });
}));

r.get("/privacy-contacts/export.csv", requirePerm("utenti"), h(async (_req, res) => {
  const rows = await db.select().from(privacyContacts).orderBy(desc(privacyContacts.id));
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="contatti-privacy.csv"');
  res.send(toCsv(rows.map((c) => ({ nome: c.firstName, cognome: c.lastName, email: c.email, telefono: c.phone, consenso_privacy: c.consentPrivacy, consenso_marketing: c.consentMarketing, data_consenso: c.consentDate, fonte: c.source, cliente_collegato: c.linkedUserId }))));
}));

export default r;
