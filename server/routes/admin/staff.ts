import { Router } from "express";
import crypto from "node:crypto";
import { z } from "zod";
import { and, asc, desc, eq, gte, lte, sql, inArray, isNull } from "drizzle-orm";
import { db } from "../../db";
import { workLogs, operators, users } from "../../../shared/schema";
import { requirePerm, requireAdmin, hashPassword, publicUser, hasPerm } from "../../auth";
import { audit } from "../../services/audit";
import { h, HttpError, id, zDay, zTime, zOptStr, toCsv } from "../../util";
import { toMin, dateToRome } from "../../time";
import { PERMISSIONS } from "../../../shared/constants";

const r = Router();

function compute(clockIn: string, clockOut: string | null | undefined, breakMin: number, rate: number) {
  if (!clockOut) return { effectiveMin: 0, amountCents: 0 };
  const eff = toMin(clockOut) - toMin(clockIn) - breakMin;
  if (eff < 0) throw new HttpError(400, "L'uscita deve essere successiva all'entrata (al netto delle pause)");
  return { effectiveMin: eff, amountCents: Math.round((eff * rate) / 60) };
}

async function myOperator(userId: number) {
  const [op] = await db.select().from(operators).where(eq(operators.userId, userId));
  return op;
}

// ---------- ore lavorate ----------
r.get("/worklogs", requirePerm("ore"), h(async (req, res) => {
  const q = z.object({ from: zDay, to: zDay, operatorId: z.coerce.number().int().optional() }).parse(req.query);
  let opFilter = q.operatorId;
  if (!hasPerm(req.user, "operatori") && req.user!.role !== "admin" && req.user!.role !== "staff") opFilter = (await myOperator(req.user!.id))?.id ?? -1;
  const rows = await db.select({ w: workLogs, operatorName: operators.name }).from(workLogs).innerJoin(operators, eq(operators.id, workLogs.operatorId))
    .where(and(gte(workLogs.workDate, q.from), lte(workLogs.workDate, q.to), opFilter ? eq(workLogs.operatorId, opFilter) : undefined))
    .orderBy(desc(workLogs.workDate), asc(operators.name));
  const list = rows.map((x) => ({ ...x.w, operatorName: x.operatorName }));
  if (req.query.format === "csv") {
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="ore-${q.from}-${q.to}.csv"`);
    return res.send(toCsv(list.map((w) => ({ operatore: w.operatorName, data: w.workDate, entrata: w.clockIn, uscita: w.clockOut, pausa_min: w.breakMin, minuti: w.effectiveMin, ore: (w.effectiveMin / 60).toFixed(2), tariffa: (w.hourlyRateCents / 100).toFixed(2), compenso: (w.amountCents / 100).toFixed(2), pagato: w.paid ? "sì" : "no", note: w.note, correzione: w.correctionNote }))));
  }
  const summary: Record<number, { operatorId: number; name: string; minutes: number; amountCents: number; unpaidCents: number; days: number }> = {};
  for (const w of list) {
    const s = (summary[w.operatorId] ||= { operatorId: w.operatorId, name: w.operatorName, minutes: 0, amountCents: 0, unpaidCents: 0, days: 0 });
    s.minutes += w.effectiveMin; s.amountCents += w.amountCents; s.days++; if (!w.paid) s.unpaidCents += w.amountCents;
  }
  res.json({ rows: list, summary: Object.values(summary) });
}));

const logSchema = z.object({
  operatorId: z.number().int().positive(), workDate: zDay, clockIn: zTime, clockOut: zTime.nullable().optional(),
  breakMin: z.number().int().min(0).max(600).default(0), note: zOptStr(1000), hourlyRateCents: z.number().int().min(0).optional(),
});

r.post("/worklogs", requirePerm("ore"), h(async (req, res) => {
  const d = logSchema.parse(req.body);
  const isManager = req.user!.role === "admin" || hasPerm(req.user, "operatori");
  if (!isManager) {
    const me = await myOperator(req.user!.id);
    if (!me || me.id !== d.operatorId) throw new HttpError(403, "Puoi registrare solo le tue ore");
  }
  const [op] = await db.select().from(operators).where(eq(operators.id, d.operatorId));
  if (!op) throw new HttpError(404, "Operatore non trovato");
  const rate = isManager && d.hourlyRateCents != null ? d.hourlyRateCents : op.hourlyRateCents;
  const [w] = await db.insert(workLogs).values({ ...d, hourlyRateCents: rate, ...compute(d.clockIn, d.clockOut, d.breakMin, rate) }).returning();
  await audit(req, "create", "worklog", w.id, d);
  res.status(201).json(w);
}));

/** Correzioni: solo amministratore (o chi gestisce gli operatori), sempre con motivazione tracciata. */
r.patch("/worklogs/:id", requirePerm("ore"), h(async (req, res) => {
  const wid = id(req.params.id);
  const isManager = req.user!.role === "admin" || hasPerm(req.user, "operatori");
  const [w0] = await db.select().from(workLogs).where(eq(workLogs.id, wid));
  if (!w0) throw new HttpError(404, "Registrazione non trovata");
  const d = logSchema.partial().extend({ correctionNote: zOptStr(1000), paid: z.boolean().optional() }).parse(req.body);
  if (!isManager) {
    const me = await myOperator(req.user!.id);
    // l'operatore può solo completare l'uscita della propria giornata, non correggere
    if (!me || me.id !== w0.operatorId || w0.clockOut || Object.keys(d).some((k) => !["clockOut", "breakMin", "note"].includes(k))) throw new HttpError(403, "Correzione riservata all'amministratore");
  } else if ((d.clockIn || d.clockOut !== undefined || d.breakMin !== undefined || d.hourlyRateCents !== undefined) && w0.clockOut && !d.correctionNote) {
    throw new HttpError(400, "Indica il motivo della correzione");
  }
  const merged = { ...w0, ...d };
  const patch: any = { ...d, ...compute(merged.clockIn, merged.clockOut, merged.breakMin, merged.hourlyRateCents) };
  if (isManager && w0.clockOut && d.correctionNote) Object.assign(patch, { corrected: true, correctedBy: req.user!.id });
  const [w] = await db.update(workLogs).set(patch).where(eq(workLogs.id, wid)).returning();
  await audit(req, "update", "worklog", wid, { before: w0, after: d });
  res.json(w);
}));

r.delete("/worklogs/:id", requireAdmin, h(async (req, res) => {
  await db.delete(workLogs).where(eq(workLogs.id, id(req.params.id)));
  await audit(req, "delete", "worklog", req.params.id);
  res.json({ ok: true });
}));

/** Timbratura rapida dell'operatore collegato (entrata/uscita adesso). */
r.post("/worklogs/clock", requirePerm("ore"), h(async (req, res) => {
  const me = await myOperator(req.user!.id);
  if (!me) throw new HttpError(400, "Il tuo utente non è collegato a un operatore");
  const now = dateToRome(new Date());
  const [open] = await db.select().from(workLogs).where(and(eq(workLogs.operatorId, me.id), eq(workLogs.workDate, now.day), isNull(workLogs.clockOut)));
  if (open) {
    const breakMin = z.object({ breakMin: z.number().int().min(0).max(600).optional() }).parse(req.body).breakMin ?? open.breakMin;
    const [w] = await db.update(workLogs).set({ clockOut: now.time, breakMin, ...compute(open.clockIn, now.time, breakMin, open.hourlyRateCents) }).where(eq(workLogs.id, open.id)).returning();
    return res.json({ action: "uscita", log: w });
  }
  const [w] = await db.insert(workLogs).values({ operatorId: me.id, workDate: now.day, clockIn: now.time, hourlyRateCents: me.hourlyRateCents }).returning();
  res.json({ action: "entrata", log: w });
}));

r.post("/worklogs/mark-paid", requireAdmin, h(async (req, res) => {
  const { ids } = z.object({ ids: z.array(z.number().int().positive()).min(1).max(500) }).parse(req.body);
  await db.update(workLogs).set({ paid: true }).where(inArray(workLogs.id, ids));
  await audit(req, "mark_paid", "worklog", null, { ids });
  res.json({ ok: true });
}));

// ---------- utenti interni e permessi ----------
r.get("/users", requirePerm("utenti"), h(async (_req, res) => {
  const rows = await db.select().from(users).where(inArray(users.role, ["admin", "staff", "operator"])).orderBy(asc(users.role), asc(users.lastName));
  res.json({ rows: rows.map(publicUser), permissions: PERMISSIONS });
}));

const staffSchema = z.object({
  email: z.string().trim().toLowerCase().email(), firstName: z.string().trim().min(1).max(100), lastName: z.string().trim().min(1).max(100),
  phone: zOptStr(40), role: z.enum(["admin", "staff", "operator"]),
  permissions: z.array(z.enum(Object.keys(PERMISSIONS) as [string, ...string[]])).default([]), active: z.boolean().default(true),
  password: z.string().min(8).max(128).optional(),
});

r.post("/users", requirePerm("utenti"), h(async (req, res) => {
  const d = staffSchema.parse(req.body);
  if (d.role === "admin" && req.user!.role !== "admin") throw new HttpError(403, "Solo un amministratore può creare altri amministratori");
  const [exists] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${d.email}`);
  if (exists) throw new HttpError(409, "Email già in uso");
  const pw = d.password || crypto.randomBytes(6).toString("base64url");
  const { password, ...data } = d;
  const [u] = await db.insert(users).values({ ...data, passwordHash: await hashPassword(pw), consentPrivacy: true, consentDate: new Date() }).returning();
  await audit(req, "create", "staff_user", u.id, { role: d.role, permissions: d.permissions });
  res.status(201).json({ user: publicUser(u), tempPassword: password ? undefined : pw });
}));

r.patch("/users/:id", requirePerm("utenti"), h(async (req, res) => {
  const uid = id(req.params.id);
  const d = staffSchema.partial().parse(req.body);
  const [target] = await db.select().from(users).where(eq(users.id, uid));
  if (!target) throw new HttpError(404, "Utente non trovato");
  if ((target.role === "admin" || d.role === "admin") && req.user!.role !== "admin") throw new HttpError(403, "Solo un amministratore può modificare un amministratore");
  if (uid === req.user!.id && (d.role && d.role !== "admin" || d.active === false)) throw new HttpError(400, "Non puoi declassare o disattivare te stesso");
  const { password, ...data } = d;
  const patch: any = { ...data, updatedAt: new Date() };
  if (password) patch.passwordHash = await hashPassword(password);
  const [u] = await db.update(users).set(patch).where(eq(users.id, uid)).returning();
  await audit(req, "update", "staff_user", uid, { ...data, passwordChanged: !!password });
  res.json(publicUser(u));
}));

export default r;
