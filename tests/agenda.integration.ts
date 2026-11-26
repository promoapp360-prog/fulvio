// Development-only integration test. Never changes existing clients, prices, operators or appointments.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { eq, inArray } from "drizzle-orm";
import { db, pool } from "../server/db";
import { hashPassword } from "../server/auth";
import { romeToDate } from "../server/time";
import { users, dogs, services, operators, operatorServices, operatorShifts, appointments, appointmentEvents, notifications, auditLog, loginLog } from "../shared/schema";

if (process.env.NODE_ENV !== "development") throw new Error("Solo sviluppo");
const fixturePath = "/home/runner/workspace/.local/agenda-browser-fixture.json";
type Fixture = { userIds: number[]; dogId: number; serviceIds: number[]; opIds: number[]; appIds: number[]; email: string; password: string; day: string; nextDay: string; requestId: number };
async function cleanup(f: Fixture) {
  await db.transaction(async tx => {
    if (f.appIds.length) {
      await tx.delete(appointmentEvents).where(inArray(appointmentEvents.appointmentId, f.appIds));
      await tx.delete(appointments).where(inArray(appointments.id, f.appIds));
    }
    if (f.dogId) await tx.delete(dogs).where(eq(dogs.id, f.dogId));
    if (f.opIds.length) {
      await tx.delete(operatorServices).where(inArray(operatorServices.operatorId, f.opIds));
      await tx.delete(operatorShifts).where(inArray(operatorShifts.operatorId, f.opIds));
      await tx.delete(operators).where(inArray(operators.id, f.opIds));
    }
    if (f.serviceIds.length) await tx.delete(services).where(inArray(services.id, f.serviceIds));
    if (f.userIds.length) {
      await tx.delete(notifications).where(inArray(notifications.userId, f.userIds));
      await tx.delete(auditLog).where(inArray(auditLog.actorId, f.userIds));
      await tx.delete(loginLog).where(inArray(loginLog.userId, f.userIds));
      await tx.delete(users).where(inArray(users.id, f.userIds));
    }
  });
  for (const userId of f.userIds) await pool.query(`DELETE FROM session WHERE (sess->>'userId')::int=$1`, [userId]);
}
if (process.argv.includes("--cleanup-browser")) {
  const f = JSON.parse(await readFile(fixturePath, "utf8"));
  try { await cleanup(f); await rm(fixturePath); console.log("PASS dati sintetici e sessioni rimossi"); } finally { await pool.end(); }
} else {
  const run = crypto.randomUUID().slice(0, 10);
  const f: Fixture = { userIds: [], dogId: 0, serviceIds: [], opIds: [], appIds: [], email: `agenda-${run}-admin@example.test`, password: crypto.randomBytes(24).toString("base64url"), day: "2097-01-07", nextDay: "2097-01-08", requestId: 0 };
  let keep = false;
  let admin = "", customer = "", readonly = "";
  async function call(path: string, method = "GET", body?: unknown, cookie = admin) {
    const response = await fetch(`http://localhost:80/api/${path}`, { method,
      headers: { Cookie: cookie, "x-requested-with": "fetch", ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, data: await response.json() };
  }
  async function login(email: string) {
    const response = await fetch("http://localhost:80/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json", "x-requested-with": "fetch" }, body: JSON.stringify({ login: email, password: f.password }) });
    assert.equal(response.status, 200);
    return response.headers.getSetCookie().find(v => v.startsWith("dp.sid="))!.split(";")[0];
  }
  async function insertRequest(day = f.day, time = "10:00", durationMin = 60, status: "richiesta" | "confermata" = "richiesta") {
    const startAt = romeToDate(day, time);
    const [row] = await db.insert(appointments).values({
      customerId: f.userIds[1], dogId: f.dogId, serviceId: f.serviceIds[0], requestedServiceIds: f.serviceIds,
      operatorId: status === "confermata" ? f.opIds[0] : null,
      reservedOperatorId: status === "richiesta" ? f.opIds[0] : null,
      startAt, endAt: new Date(startAt.getTime() + durationMin * 60_000), durationMin, status, paymentMode: "negozio",
    }).returning();
    f.appIds.push(row.id); return row;
  }
  try {
    const passwordHash = await hashPassword(f.password);
    for (const role of ["admin", "customer", "operator"] as const) {
      const [u] = await db.insert(users).values({ email: `agenda-${run}-${role}@example.test`, passwordHash, role, firstName: "Test agenda", lastName: run, commEmail: false, commPush: false, permissions: role === "operator" ? ["agenda_view"] : [] }).returning();
      f.userIds.push(u.id);
    }
    const [dog] = await db.insert(dogs).values({ ownerId: f.userIds[1], name: `Poppy test ${run}`, size: "media" }).returning();
    f.dogId = dog.id;
    for (let i = 0; i < 2; i++) {
      const [s] = await db.insert(services).values({ name: `Test agenda ${run}-${i}`, slug: `agenda-${run}-${i}`, category: "Test", visible: false, bookable: false, durationMin: 30 }).returning();
      f.serviceIds.push(s.id);
    }
    for (let i = 0; i < 2; i++) {
      const [op] = await db.insert(operators).values({ name: `Test agenda ${run}-${i}`, bookableOnline: false }).returning();
      f.opIds.push(op.id);
      await db.insert(operatorServices).values((i ? f.serviceIds.slice(0, 1) : f.serviceIds).map(serviceId => ({ operatorId: op.id, serviceId })));
      await db.insert(operatorShifts).values(Array.from({ length: 7 }, (_, weekday) => ({ operatorId: op.id, weekday, startTime: "08:00", endTime: "20:00" })));
    }
    admin = await login(f.email); customer = await login(`agenda-${run}-customer@example.test`); readonly = await login(`agenda-${run}-operator@example.test`);
    const request = await insertRequest(); f.requestId = request.id;
    const endpoint = `admin/appointments/${request.id}`;
    const list = (day: string) => `admin/appointments?from=${day}&to=${day}`;
    const initial = await call(`${list(f.day)}&operatorId=${f.opIds[0]}`);
    assert.equal(initial.status, 200);
    assert.equal(initial.data.filter((a: any) => a.id === request.id).length, 1, "Riserva visibile anche nel filtro operatore");
    assert.equal((await call(endpoint)).data.operatorId, null);
    assert.equal((await call(endpoint, "PATCH", { date: f.nextDay, time: "10:00", operatorId: f.opIds[0] }, readonly)).status, 403);
    assert.equal((await call(`${endpoint}/action`, "POST", { action: "conferma", operatorId: f.opIds[0] }, customer)).status, 403);
    const move = { date: f.nextDay, time: "10:00", operatorId: f.opIds[0], durationMin: 60, expectedUpdatedAt: request.updatedAt.toISOString() };
    assert.equal((await call(endpoint, "PATCH", { ...move, operatorId: f.opIds[1] })).status, 400, "Tutte le competenze sono obbligatorie");
    assert.equal((await call(endpoint, "PATCH", { ...move, time: "07:00" })).status, 409, "Fuori turno rifiutato");
    await insertRequest(f.nextDay, "12:00", 60, "confermata");
    assert.equal((await call(endpoint, "PATCH", { ...move, time: "12:00" })).status, 409, "Conflitto rifiutato");
    const moved = await call(endpoint, "PATCH", move);
    assert.equal(moved.status, 200, JSON.stringify(moved.data));
    assert.equal(moved.data.status, "richiesta");
    assert.equal(moved.data.operatorId, null);
    assert.equal(moved.data.reservedOperatorId, f.opIds[0]);
    assert.equal((await call(list(f.day))).data.some((a: any) => a.id === request.id), false);
    assert.equal((await call(list(f.nextDay))).data.filter((a: any) => a.id === request.id).length, 1);
    assert.equal((await call(endpoint, "PATCH", move)).status, 409, "Vecchia versione rifiutata");
    const available = await call(`admin/slots?operatorId=${f.opIds[0]}&date=${f.nextDay}&durationMin=60&excludeId=${request.id}`);
    assert.ok(available.data[f.opIds[0]].includes("10:00"), "Escluso solo l’appuntamento corrente");
    assert.ok(!available.data[f.opIds[0]].includes("12:00"), "Il conflitto resta bloccato");
    const confirmed = await call(`${endpoint}/action`, "POST", { action: "conferma", date: f.nextDay, time: "10:00", operatorId: f.opIds[0], paymentMode: "negozio", expectedUpdatedAt: moved.data.updatedAt });
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.data));
    assert.equal(confirmed.data.status, "confermata");
    assert.equal(confirmed.data.operatorId, f.opIds[0]); assert.equal(confirmed.data.reservedOperatorId, null);
    assert.equal((await call(endpoint, "PATCH", { ...move, expectedUpdatedAt: moved.data.updatedAt })).status, 409);
    const second = await insertRequest(f.day, "14:00");
    f.requestId = second.id;
    assert.equal((await call(`admin/appointments/${second.id}/action`, "POST", { action: "proponi", date: f.nextDay, time: "16:00", operatorId: f.opIds[0] })).status, 200);
    assert.equal((await call(list(f.day))).data.some((a: any) => a.id === second.id), false, "Vecchio giorno della proposta non duplicato");
    assert.equal((await call(`${list(f.nextDay)}&operatorId=${f.opIds[0]}`)).data.filter((a: any) => a.id === second.id).length, 1);
    const detail = await call(`admin/appointments/${second.id}`);
    assert.equal(detail.data.status, "proposta", "Proposta non confermata automaticamente");
    // A separate pending request is left only when explicitly preparing a browser verification.
    const browserRequest = await insertRequest(f.day, "10:00");
    f.requestId = browserRequest.id;
    console.log("PASS agenda: filtro riserve, spostamento senza conferma, competenze multiple, turni, conflitti, permessi, versioni obsolete, conferma e proposta senza duplicati");
    if (process.argv.includes("--keep-for-browser")) {
      await mkdir("/home/runner/workspace/.local", { recursive: true });
      await writeFile(fixturePath, JSON.stringify(f), { mode: 0o600 });
      keep = true;
      console.log("Fixture sintetica per browser pronta (credenziali non stampate)");
    }
  } finally {
    if (!keep) await cleanup(f);
    await pool.end();
  }
}
