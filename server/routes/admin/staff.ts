import { Router } from "express";
import crypto from "node:crypto";
import { z } from "zod";
import { and, asc, desc, eq, ne, gte, lte, sql, inArray, isNull } from "drizzle-orm";
import { db } from "../../db";
import { workLogs, operators, users, staffSettlements, loginLog } from "../../../shared/schema";
import { requirePerm, requireAdmin, hashPassword, publicUser, hasPerm, revokeSessions } from "../../auth";
import { audit } from "../../services/audit";
import { getSettings } from "../../services/settings";
import { sendXlsx, sendPdf, type Column, type Sheet } from "../../services/exporter";
import { h, HttpError, id, zDay, zTime, zOptStr, paging } from "../../util";
import { dateToRome, addDays } from "../../time";
import { roundMinutes, workAmountCents, rawWorkedMinutes, settlementWeek } from "../../logic";
import { PERMISSIONS, euro } from "../../../shared/constants";
import { settlementOutstanding, settlementTotals } from "../../../shared/staff-settlements";

const r = Router();

/** Minuti effettivi arrotondati al quarto d'ora (impostazioni) e compenso. */
async function compute(clockIn: string, clockOut: string | null | undefined, breakMin: number, rate: number) {
  const s = await getSettings();
  let raw: number;
  try { raw = rawWorkedMinutes(clockIn, clockOut, breakMin); } catch (e) { throw new HttpError(400, (e as Error).message); }
  const eff = roundMinutes(raw, s.staff.roundingStep, s.staff.roundingMode);
  return { rawMin: raw, effectiveMin: eff, amountCents: workAmountCents(eff, rate) };
}

async function myOperator(userId: number) {
  const [op] = await db.select().from(operators).where(eq(operators.userId, userId));
  return op;
}
const isManager = (u: any) => u.role === "admin" || hasPerm(u, "personale");

// ---------- ore lavorate (presenza, distinta dalle ore prenotate per i clienti) ----------
r.get("/worklogs", h(async (req, res) => {
  const q = z.object({ from: zDay, to: zDay, operatorId: z.coerce.number().int().optional(), format: z.enum(["xlsx", "pdf"]).optional() }).parse(req.query);
  let opFilter = q.operatorId;
  if (!isManager(req.user)) {
    const me = await myOperator(req.user!.id);
    if (!me) throw new HttpError(403, "Permesso negato");
    opFilter = me.id;
  }
  const rows = await db.select({ w: workLogs, operatorName: operators.name }).from(workLogs).innerJoin(operators, eq(operators.id, workLogs.operatorId))
    .where(and(gte(workLogs.workDate, q.from), lte(workLogs.workDate, q.to), opFilter ? eq(workLogs.operatorId, opFilter) : undefined))
    .orderBy(desc(workLogs.workDate), asc(operators.name));
  const list = rows.map((x) => ({ ...x.w, operatorName: x.operatorName }));
  if (q.format) {
    const cols: Column[] = [{ key: "operatorName", label: "Operatore", width: 14 }, { key: "workDate", label: "Data", width: 11 }, { key: "clockIn", label: "Entrata", width: 8 }, { key: "clockOut", label: "Uscita", width: 8 },
      { key: "breakMin", label: "Pausa (min)", width: 9 }, { key: "rawMin", label: "Minuti reali", width: 9 }, { key: "effectiveMin", label: "Minuti conteggiati", width: 11 }, { key: "hourlyRateCents", label: "Tariffa", money: true, width: 9 },
      { key: "amountCents", label: "Compenso", money: true, width: 10 }, { key: "note", label: "Note", width: 20 }];
    const sheet = { name: "Ore lavorate", columns: cols, rows: list, totals: { operatorName: "Totale", effectiveMin: list.reduce((a, w) => a + w.effectiveMin, 0), amountCents: list.reduce((a, w) => a + w.amountCents, 0) } };
    return q.format === "xlsx" ? sendXlsx(res, `ore-${q.from}-${q.to}`, [sheet]) : sendPdf(res, `ore-${q.from}-${q.to}`, "Ore lavorate", `Dal ${q.from} al ${q.to}`, [sheet], "Calcolo gestionale interno: non sostituisce cedolini o adempimenti fiscali e del lavoro.");
  }
  const summary: Record<number, any> = {};
  for (const w of list) {
    const s = (summary[w.operatorId] ||= { operatorId: w.operatorId, name: w.operatorName, minutes: 0, amountCents: 0, unsettledCents: 0, days: 0 });
    s.minutes += w.effectiveMin; s.amountCents += w.amountCents; s.days++; if (!w.settlementId) s.unsettledCents += w.amountCents;
  }
  res.json({ rows: list, summary: Object.values(summary) });
}));

const logSchema = z.object({
  operatorId: z.number().int().positive(), workDate: zDay, clockIn: zTime, clockOut: zTime.nullable().optional(),
  breakMin: z.number().int().min(0).max(600).default(0), note: zOptStr(1000), hourlyRateCents: z.number().int().min(0).optional(),
});

r.post("/worklogs", h(async (req, res) => {
  const d = logSchema.parse(req.body);
  const manager = isManager(req.user);
  if (!manager) {
    const me = await myOperator(req.user!.id);
    if (!me || me.id !== d.operatorId) throw new HttpError(403, "Puoi registrare solo le tue ore");
  }
  const [op] = await db.select().from(operators).where(eq(operators.id, d.operatorId));
  if (!op) throw new HttpError(404, "Operatore non trovato");
  const rate = manager && d.hourlyRateCents != null ? d.hourlyRateCents : op.hourlyRateCents;
  const [w] = await db.insert(workLogs).values({ ...d, hourlyRateCents: rate, ...(await compute(d.clockIn, d.clockOut, d.breakMin, rate)) }).returning();
  await audit(req, "create", "worklog", w.id, d);
  res.status(201).json(w);
}));

/** Correzioni autorizzate: solo amministratore / gestione personale, con motivazione tracciata. Le giornate già liquidate non si modificano. */
r.patch("/worklogs/:id", h(async (req, res) => {
  const wid = id(req.params.id);
  const manager = isManager(req.user);
  const [w0] = await db.select().from(workLogs).where(eq(workLogs.id, wid));
  if (!w0) throw new HttpError(404, "Registrazione non trovata");
  if (w0.settlementId) throw new HttpError(400, "Giornata già inclusa in una liquidazione: usa una rettifica sulla liquidazione");
  const d = logSchema.partial().extend({ correctionNote: zOptStr(1000) }).parse(req.body);
  if (!manager) {
    const me = await myOperator(req.user!.id);
    if (!me || me.id !== w0.operatorId || w0.clockOut || Object.keys(d).some((k) => !["clockOut", "breakMin", "note"].includes(k))) throw new HttpError(403, "Correzione riservata all'amministratore");
  } else if ((d.clockIn || d.clockOut !== undefined || d.breakMin !== undefined || d.hourlyRateCents !== undefined) && w0.clockOut && !d.correctionNote) {
    throw new HttpError(400, "Indica il motivo della correzione");
  }
  const merged = { ...w0, ...d };
  const patch: any = { ...d, ...(await compute(merged.clockIn, merged.clockOut, merged.breakMin, merged.hourlyRateCents)) };
  if (manager && w0.clockOut && d.correctionNote) Object.assign(patch, { corrected: true, correctedBy: req.user!.id });
  const [w] = await db.update(workLogs).set(patch).where(eq(workLogs.id, wid)).returning();
  await audit(req, "update", "worklog", wid, { before: w0, after: d });
  res.json(w);
}));

r.delete("/worklogs/:id", requireAdmin, h(async (req, res) => {
  const [w] = await db.delete(workLogs).where(and(eq(workLogs.id, id(req.params.id)), isNull(workLogs.settlementId))).returning();
  if (!w) throw new HttpError(400, "Registrazione inesistente o già liquidata");
  await audit(req, "delete", "worklog", req.params.id, w as any);
  res.json({ ok: true });
}));

/** Timbratura rapida dell'operatore collegato (entrata/uscita adesso). */
r.post("/worklogs/clock", h(async (req, res) => {
  const me = await myOperator(req.user!.id);
  if (!me) throw new HttpError(400, "Il tuo utente non è collegato a un operatore");
  const now = dateToRome(new Date());
  const [open] = await db.select().from(workLogs).where(and(eq(workLogs.operatorId, me.id), eq(workLogs.workDate, now.day), isNull(workLogs.clockOut)));
  if (open) {
    const breakMin = z.object({ breakMin: z.number().int().min(0).max(600).optional() }).parse(req.body).breakMin ?? open.breakMin;
    const [w] = await db.update(workLogs).set({ clockOut: now.time, breakMin, ...(await compute(open.clockIn, now.time, breakMin, open.hourlyRateCents)) }).where(eq(workLogs.id, open.id)).returning();
    return res.json({ action: "uscita", log: w });
  }
  const [w] = await db.insert(workLogs).values({ operatorId: me.id, workDate: now.day, clockIn: now.time, hourlyRateCents: me.hourlyRateCents }).returning();
  res.json({ action: "entrata", log: w });
}));

// ---------- liquidazione settimanale (pagamento del sabato) ----------
/** Anteprima della settimana che termina nel giorno di paga: dettaglio giornaliero, totali e liquidazioni già create. */
r.get("/settlements/preview", requirePerm("personale"), h(async (req, res) => {
  const s = await getSettings();
  const day = z.object({ day: zDay }).parse(req.query).day;
  const wk = settlementWeek(day, s.staff.payWeekday);
  const [logs, existing, ops] = await Promise.all([
    db.select().from(workLogs).where(and(gte(workLogs.workDate, wk.start), lte(workLogs.workDate, wk.end))).orderBy(asc(workLogs.workDate)),
    db.select().from(staffSettlements).where(and(eq(staffSettlements.weekStart, wk.start), ne(staffSettlements.status, "annullata"))),
    db.select().from(operators).orderBy(asc(operators.sortOrder)),
  ]);
  const out = ops.map((o) => {
    const mine = logs.filter((l) => l.operatorId === o.id);
    const st = existing.find((e) => e.operatorId === o.id) || null;
    return {
      operatorId: o.id, name: o.name, hourlyRateCents: o.hourlyRateCents, days: mine,
      minutes: mine.reduce((a, l) => a + l.effectiveMin, 0), grossCents: mine.reduce((a, l) => a + l.amountCents, 0),
      open: mine.filter((l) => !l.clockOut).length, settlement: st,
    };
  }).filter((x) => x.days.length || x.settlement);
  res.json({ week: wk, operators: out });
}));

r.post("/settlements", requirePerm("personale"), h(async (req, res) => {
  const d = z.object({
    operatorId: z.number().int().positive(), day: zDay,
    adjustmentsCents: z.number().int().min(-10_000_000).max(10_000_000).default(0), adjustmentNote: zOptStr(1000), note: zOptStr(1000),
  }).parse(req.body);
  if (d.adjustmentsCents !== 0 && !d.adjustmentNote) throw new HttpError(400, "Indica il motivo della rettifica");
  const s = await getSettings();
  const wk = settlementWeek(d.day, s.staff.payWeekday);
  const st = await db.transaction(async (tx) => {
    const logs = await tx.select().from(workLogs).where(and(eq(workLogs.operatorId, d.operatorId), gte(workLogs.workDate, wk.start), lte(workLogs.workDate, wk.end))).for("update");
    if (!logs.length) throw new HttpError(400, "Non ci sono giornate lavorate da liquidare nella settimana selezionata");
    if (logs.some((l) => !l.clockOut)) throw new HttpError(400, "Ci sono giornate senza ora di uscita: completale prima di liquidare");
    if (logs.some((l) => l.settlementId)) throw new HttpError(409, "Settimana già liquidata per questo operatore");
    const minutes = logs.reduce((a, l) => a + l.effectiveMin, 0), gross = logs.reduce((a, l) => a + l.amountCents, 0);
    const [row] = await tx.insert(staffSettlements).values({
      operatorId: d.operatorId, weekStart: wk.start, weekEnd: wk.end, minutes, grossCents: gross, adjustmentsCents: d.adjustmentsCents,
      adjustmentNote: d.adjustmentNote, totalCents: gross + d.adjustmentsCents, note: d.note, createdBy: req.user!.id,
    }).returning();
    if (logs.length) await tx.update(workLogs).set({ settlementId: row.id }).where(inArray(workLogs.id, logs.map((l) => l.id)));
    await audit(req, "create", "settlement", row.id, { ...d, workLogIds: logs.map(l => l.id) }, tx);
    return row;
  });
  res.status(201).json(st);
}));

r.patch("/settlements/:id", requirePerm("personale"), h(async (req, res) => {
  const sid = id(req.params.id);
  const d = z.object({
    status: z.enum(["da_pagare", "pagato"]).optional(), paidAt: zDay.nullable().optional(), paidMethod: zOptStr(30),
    adjustmentsCents: z.number().int().optional(), adjustmentNote: zOptStr(1000), note: zOptStr(1000),
  }).parse(req.body);
  const s1 = await db.transaction(async tx => {
    const [s0] = await tx.select().from(staffSettlements).where(eq(staffSettlements.id, sid)).for("update");
    if (!s0) throw new HttpError(404, "Liquidazione non trovata");
    if (s0.status === "annullata") throw new HttpError(409, "Liquidazione annullata: crea una nuova liquidazione dalle giornate riaperte");
    if (s0.status === "pagato" && d.adjustmentsCents !== undefined) throw new HttpError(400, "Liquidazione già pagata: annulla prima il pagamento per rettificarla");
    if (d.adjustmentsCents !== undefined && d.adjustmentsCents !== 0 && !(d.adjustmentNote ?? s0.adjustmentNote)) throw new HttpError(400, "Indica il motivo della rettifica");
    const patch: any = { ...d };
    if (d.adjustmentsCents !== undefined) patch.totalCents = s0.grossCents + d.adjustmentsCents;
    if (d.status === "pagato" && !d.paidAt) patch.paidAt = dateToRome(new Date()).day;
    if (d.status === "da_pagare") { patch.paidAt = null; patch.paidMethod = null; }
    const [updated] = await tx.update(staffSettlements).set(patch).where(eq(staffSettlements.id, sid)).returning();
    await tx.update(workLogs).set({ paid: updated.status === "pagato" }).where(eq(workLogs.settlementId, sid));
    await audit(req, "update", "settlement", sid, { before: s0, after: updated, operation: s0.status === "pagato" && updated.status === "da_pagare" ? "annulla_pagamento" : "aggiorna" }, tx);
    return updated;
  });
  res.json(s1);
}));

/** Logical cancellation: retain the record, release days, preserve audit atomically. */
r.delete("/settlements/:id", requirePerm("personale"), h(async (req, res) => {
  const sid = id(req.params.id);
  await db.transaction(async (tx) => {
    const [s0] = await tx.select().from(staffSettlements).where(eq(staffSettlements.id, sid)).for("update");
    if (!s0) throw new HttpError(404, "Liquidazione non trovata");
    if (s0.status === "annullata") return; // A repeated click must not affect a newer settlement.
    if (s0.status === "pagato") throw new HttpError(400, "Liquidazione già pagata: annulla prima il pagamento, poi annulla la liquidazione");
    const logs = await tx.select().from(workLogs).where(eq(workLogs.settlementId, sid)).for("update");
    await tx.update(workLogs).set({ settlementId: null, paid: false }).where(eq(workLogs.settlementId, sid));
    await tx.update(staffSettlements).set({ status: "annullata", paidAt: null, paidMethod: null }).where(eq(staffSettlements.id, sid));
    await audit(req, "delete", "settlement", sid, { operation: "annulla_liquidazione", before: s0, workLogs: logs }, tx);
  });
  res.json({ ok: true });
}));

/** Storico liquidazioni con esportazione PDF/Excel. */
r.get("/settlements", requirePerm("personale"), h(async (req, res) => {
  const q = z.object({ from: zDay, to: zDay, operatorId: z.coerce.number().int().optional(), format: z.enum(["xlsx", "pdf"]).optional(), id: z.coerce.number().int().optional() }).parse(req.query);
  const rows = await db.select({ s: staffSettlements, name: operators.name }).from(staffSettlements).innerJoin(operators, eq(operators.id, staffSettlements.operatorId))
    .where(and(q.id ? eq(staffSettlements.id, q.id) : and(gte(staffSettlements.weekEnd, q.from), lte(staffSettlements.weekStart, q.to)), q.operatorId ? eq(staffSettlements.operatorId, q.operatorId) : undefined))
    .orderBy(desc(staffSettlements.weekStart), asc(operators.name), desc(staffSettlements.id));
  const list = rows.map((x) => ({ ...x.s, operatorName: x.name, hours: (x.s.minutes / 60).toFixed(2).replace(".", ","), period: `${x.s.weekStart} → ${x.s.weekEnd}`, outstandingCents: settlementOutstanding(x.s), stato: x.s.status === "annullata" ? "Annullata" : x.s.status === "pagato" ? `Pagato ${x.s.paidAt ?? ""}` : "Da pagare" }));
  const totals = settlementTotals(list);
  if (q.format) {
    const sheets: Sheet[] = [{
      name: "Liquidazioni", columns: [{ key: "operatorName", label: "Operatore", width: 14 }, { key: "period", label: "Settimana", width: 20 }, { key: "hours", label: "Ore", width: 7 },
        { key: "grossCents", label: "Maturato", money: true, width: 10 }, { key: "adjustmentsCents", label: "Rettifiche", money: true, width: 10 }, { key: "adjustmentNote", label: "Motivo rettifica", width: 18 },
        { key: "totalCents", label: "Importo", money: true, width: 10 }, { key: "outstandingCents", label: "Residuo", money: true, width: 10 }, { key: "stato", label: "Stato", width: 14 }, { key: "paidMethod", label: "Metodo", width: 10 }] as Column[],
      rows: list, totals: { operatorName: "Totale attive", grossCents: totals.grossCents, adjustmentsCents: totals.adjustmentsCents, totalCents: totals.totalCents, outstandingCents: totals.outstandingCents },
    }];
    // dettaglio giornaliero per ciascuna liquidazione
    const ids = list.filter(s => s.status !== "annullata").map((s) => s.id);
    const days = ids.length ? await db.select({ w: workLogs, name: operators.name }).from(workLogs).innerJoin(operators, eq(operators.id, workLogs.operatorId)).where(inArray(workLogs.settlementId, ids)).orderBy(asc(operators.name), asc(workLogs.workDate)) : [];
    sheets.push({ name: "Dettaglio giornaliero", columns: [{ key: "name", label: "Operatore", width: 14 }, { key: "workDate", label: "Data", width: 11 }, { key: "clockIn", label: "Entrata", width: 8 }, { key: "clockOut", label: "Uscita", width: 8 }, { key: "breakMin", label: "Pausa", width: 7 }, { key: "effectiveMin", label: "Minuti", width: 8 }, { key: "amountCents", label: "Importo", money: true, width: 10 }, { key: "note", label: "Note", width: 20 }],
      rows: days.map((x) => ({ ...x.w, name: x.name })) });
    const title = `liquidazioni-${q.from}-${q.to}`;
    return q.format === "xlsx" ? sendXlsx(res, title, sheets) : sendPdf(res, title, "Liquidazioni collaboratori", `Periodo ${q.from} – ${q.to}`, sheets, "Liquidazioni annullate escluse dai totali. Calcolo gestionale interno: non sostituisce cedolini, fatture o adempimenti fiscali e del lavoro.");
  }
  res.json(list);
}));

// ---------- utenti interni e permessi ----------
r.get("/users", requirePerm("utenti", "personale"), h(async (_req, res) => {
  const rows = await db.select().from(users).where(inArray(users.role, ["admin", "manager", "operator"])).orderBy(asc(users.role), asc(users.lastName));
  res.json({ rows: rows.map(publicUser), permissions: PERMISSIONS });
}));

const staffSchema = z.object({
  email: z.string().trim().toLowerCase().email(), username: z.string().trim().regex(/^[A-Za-z0-9._-]{3,60}$/, "3-60 caratteri: lettere, numeri, . _ -").nullable().optional().or(z.literal("").transform(() => null)),
  firstName: z.string().trim().min(1).max(100), lastName: z.string().trim().min(1).max(100),
  phone: zOptStr(40), role: z.enum(["admin", "manager", "operator"]),
  permissions: z.array(z.enum(Object.keys(PERMISSIONS) as [string, ...string[]])).default([]), active: z.boolean().default(true),
});

const tempPassword = () => crypto.randomBytes(6).toString("base64url") + "7a";

/** Creazione utente con credenziali temporanee e cambio password obbligatorio al primo accesso. */
r.post("/users", requirePerm("utenti"), h(async (req, res) => {
  const d = staffSchema.parse(req.body);
  if (d.role === "admin" && req.user!.role !== "admin") throw new HttpError(403, "Solo un amministratore può creare altri amministratori");
  const [exists] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${d.email} OR (${d.username ?? null}::text IS NOT NULL AND lower(${users.username}) = lower(${d.username ?? ""}))`);
  if (exists) throw new HttpError(409, "Email o username già in uso");
  const pw = tempPassword();
  const [u] = await db.insert(users).values({ ...d, passwordHash: await hashPassword(pw), mustChangePassword: true, consentPrivacy: true, consentDate: new Date(), emailVerifiedAt: new Date() }).returning();
  await audit(req, "create", "staff_user", u.id, { role: d.role, permissions: d.permissions });
  res.status(201).json({ user: publicUser(u), tempPassword: pw });
}));

r.patch("/users/:id", requirePerm("utenti"), h(async (req, res) => {
  const uid = id(req.params.id);
  const d = staffSchema.partial().parse(req.body);
  const [target] = await db.select().from(users).where(eq(users.id, uid));
  if (!target || target.role === "customer") throw new HttpError(404, "Utente non trovato");
  if ((target.role === "admin" || d.role === "admin") && req.user!.role !== "admin") throw new HttpError(403, "Solo un amministratore può modificare un amministratore");
  if (uid === req.user!.id && ((d.role && d.role !== "admin") || d.active === false)) throw new HttpError(400, "Non puoi declassare o disattivare te stesso");
  const [u] = await db.update(users).set({ ...d, updatedAt: new Date() }).where(eq(users.id, uid)).returning();
  if (d.active === false || (d.role && d.role !== target.role)) await revokeSessions(uid);
  await audit(req, "update", "staff_user", uid, d);
  res.json(publicUser(u));
}));

/** Reimposta l'accesso: nuova password temporanea, cambio obbligatorio, sessioni revocate. */
r.post("/users/:id/reset-access", requirePerm("utenti"), h(async (req, res) => {
  const uid = id(req.params.id);
  const [target] = await db.select().from(users).where(eq(users.id, uid));
  if (!target || target.role === "customer") throw new HttpError(404, "Utente non trovato");
  if (target.role === "admin" && req.user!.role !== "admin") throw new HttpError(403, "Permesso negato");
  const pw = tempPassword();
  await db.update(users).set({ passwordHash: await hashPassword(pw), mustChangePassword: true, failedLogins: 0, lockedUntil: null }).where(eq(users.id, uid));
  await revokeSessions(uid);
  await audit(req, "reset_access", "staff_user", uid);
  res.json({ tempPassword: pw });
}));

/** Richiede il cambio password al prossimo accesso / revoca le sessioni. */
r.post("/users/:id/require-password-change", requirePerm("utenti"), h(async (req, res) => {
  const uid = id(req.params.id);
  await db.update(users).set({ mustChangePassword: true }).where(and(eq(users.id, uid), sql`${users.role} <> 'customer'`));
  await revokeSessions(uid);
  await audit(req, "require_password_change", "staff_user", uid);
  res.json({ ok: true });
}));
r.post("/users/:id/revoke-sessions", requirePerm("utenti"), h(async (req, res) => {
  await revokeSessions(id(req.params.id));
  await audit(req, "sessions_revoked", "user", req.params.id);
  res.json({ ok: true });
}));

/** Registro accessi (login riusciti e falliti). */
r.get("/login-log", requireAdmin, h(async (req, res) => {
  const { pageSize, offset, page } = paging(req);
  const rows = await db.select({ l: loginLog, name: sql<string>`${users.firstName} || ' ' || ${users.lastName}`, role: users.role }).from(loginLog).leftJoin(users, eq(users.id, loginLog.userId))
    .orderBy(desc(loginLog.id)).limit(pageSize).offset(offset);
  res.json({ rows: rows.map((x) => ({ ...x.l, name: x.name, role: x.role })), page, pageSize });
}));

export default r;
