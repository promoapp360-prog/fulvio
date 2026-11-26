// Synthetic development-only accounting fixtures; never alters existing payments.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import ExcelJS from "exceljs";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { eq, inArray } from "drizzle-orm";
import { db, pool } from "../server/db";
import { hashPassword } from "../server/auth";
import { settlementWeek } from "../server/logic";
import { settlementTotals } from "../shared/staff-settlements";
import { users, operators, workLogs, staffSettlements, auditLog, loginLog } from "../shared/schema";

if (process.env.NODE_ENV !== "development") throw new Error("Solo sviluppo");
const fixturePath = "/home/runner/workspace/.local/staff-browser-fixture.json";
type Fixture = { userIds: number[]; opId: number; workIds: number[]; settlementId: number; email: string; password: string; day: string; week: { start: string; end: string }; baselineDigest?: string };
async function accountingDigest() {
  const records = await Promise.all([workLogs, staffSettlements].map(table => db.select().from(table as any)));
  return crypto.createHash("sha256").update(JSON.stringify(records.map(rows => rows.map(row => JSON.stringify(row)).sort()))).digest("hex");
}
async function cleanup(f: Fixture) {
  await db.transaction(async tx => {
    if (f.workIds.length) await tx.delete(workLogs).where(inArray(workLogs.id, f.workIds));
    if (f.opId) {
      await tx.delete(staffSettlements).where(eq(staffSettlements.operatorId, f.opId));
      await tx.delete(operators).where(eq(operators.id, f.opId));
    }
    if (f.userIds.length) {
      await tx.delete(auditLog).where(inArray(auditLog.actorId, f.userIds));
      await tx.delete(loginLog).where(inArray(loginLog.userId, f.userIds));
      await tx.delete(users).where(inArray(users.id, f.userIds));
    }
  });
  for (const userId of f.userIds) await pool.query(`DELETE FROM session WHERE (sess->>'userId')::int=$1`, [userId]);
}
if (process.argv.includes("--cleanup-browser")) {
  const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
  assert.match(fixture.email, /^accounting-[a-f0-9-]+-admin@example\.invalid$/);
  const [actor] = await db.select().from(users).where(eq(users.id, fixture.userIds[0]));
  const [operator] = await db.select().from(operators).where(eq(operators.id, fixture.opId));
  assert.equal(actor?.email, fixture.email);
  assert.equal(operator?.name, `Test compensi ${actor.lastName}`);
  try {
    await cleanup(fixture);
    if (fixture.baselineDigest) assert.equal(await accountingDigest(), fixture.baselineDigest, "Contabilità reale invariata dopo il browser test");
    await rm(fixturePath); console.log("PASS soli dati contabili sintetici e sessioni rimossi; contabilità reale invariata");
  }
  finally { await pool.end(); }
} else if (process.argv.includes("--exports-browser")) {
  const fixture: Fixture = JSON.parse(await readFile(fixturePath, "utf8"));
  try {
    const login = await fetch("http://localhost:80/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json", "x-requested-with": "fetch" }, body: JSON.stringify({ login: fixture.email, password: fixture.password }) });
    assert.equal(login.status, 200);
    const cookie = login.headers.getSetCookie().find(value => value.startsWith("dp.sid="))!.split(";")[0];
    const url = `http://localhost:80/api/admin/settlements?from=${fixture.week.start}&to=${fixture.week.end}&operatorId=${fixture.opId}`;
    const excel = await fetch(`${url}&format=xlsx`, { headers: { Cookie: cookie } });
    assert.equal(excel.status, 200);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(await excel.arrayBuffer()) as any);
    const sheet = workbook.worksheets[0];
    let total = 0, outstanding = 0, cancelled = 0;
    for (let row = 2; row < sheet.rowCount; row++) {
      if (sheet.getCell(row, 9).value === "Annullata") {
        cancelled++; assert.equal(sheet.getCell(row, 8).value, 0);
      } else {
        total += Number(sheet.getCell(row, 7).value);
        outstanding += Number(sheet.getCell(row, 8).value);
      }
    }
    assert.ok(cancelled > 0);
    assert.equal(sheet.getCell(sheet.rowCount, 7).value, total);
    assert.equal(sheet.getCell(sheet.rowCount, 8).value, outstanding);
    const pdf = await fetch(`${url}&format=pdf`, { headers: { Cookie: cookie } });
    assert.equal(pdf.status, 200); assert.match(pdf.headers.get("content-type") || "", /application\/pdf/);
    assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 4).toString(), "%PDF");
    console.log("PASS Excel: annullate visibili ma escluse da totali/residui; PDF generato correttamente");
  } finally { await pool.end(); }
} else {
  const run = crypto.randomUUID().slice(0, 10);
  const f: Fixture = { userIds: [], opId: 0, workIds: [], settlementId: 0, email: `accounting-${run}-admin@example.invalid`,
    password: crypto.randomBytes(24).toString("base64url"), day: "2097-01-07", week: settlementWeek("2097-01-07") };
  let cookie = "", noPerm = "", keep = false;
  const before = await accountingDigest();
  f.baselineDigest = before;
  async function call(path: string, method = "GET", body?: unknown, auth = cookie) {
    const response = await fetch(`http://localhost:80/api/admin/${path}`, { method, headers: { Cookie: auth, "x-requested-with": "fetch", ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, data: await response.json() };
  }
  const history = async () => (await call(`settlements?from=${f.week.start}&to=${f.week.end}&operatorId=${f.opId}`)).data as any[];
  const days = async () => (await call(`worklogs?from=${f.week.start}&to=${f.week.end}&operatorId=${f.opId}`)).data;
  const preview = async () => (await call(`settlements/preview?day=${f.day}`)).data.operators.find((op: any) => op.operatorId === f.opId);
  const create = () => call("settlements", "POST", { operatorId: f.opId, day: f.day });
  try {
    const passwordHash = await hashPassword(f.password);
    for (const role of ["admin", "operator"] as const) {
      const email = `accounting-${run}-${role}@example.invalid`;
      const [actor] = await db.insert(users).values({ email, passwordHash, role, firstName: "Test contabilità", lastName: run, commEmail: false, commPush: false }).returning();
      f.userIds.push(actor.id);
      const response = await fetch("http://localhost:80/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json", "x-requested-with": "fetch" }, body: JSON.stringify({ login: email, password: f.password }) });
      assert.equal(response.status, 200);
      const session = response.headers.getSetCookie().find(value => value.startsWith("dp.sid="))!.split(";")[0];
      if (role === "admin") cookie = session; else noPerm = session;
    }
    const [op] = await db.insert(operators).values({ name: `Test compensi ${run}`, hourlyRateCents: 1200, bookableOnline: false }).returning();
    f.opId = op.id;
    for (const [workDate, clockOut] of [[f.day, "11:00"], ["2097-01-08", "10:00"]]) {
      const work = await call("worklogs", "POST", { operatorId: f.opId, workDate, clockIn: "09:00", clockOut, breakMin: 0 });
      assert.equal(work.status, 201); f.workIds.push(work.data.id);
    }
    const created = await create();
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const sid = created.data.id;
    assert.equal(created.data.totalCents, 3600);
    const paid = await call(`settlements/${sid}`, "PATCH", { status: "pagato", paidMethod: "contanti" });
    assert.equal(paid.status, 200); assert.ok((await days()).rows.every((d: any) => d.paid && d.settlementId === sid));
    assert.equal((await call(`settlements/${sid}`, "DELETE")).status, 400, "Prima annullare il pagamento");
    assert.equal((await call(`settlements/${sid}`, "PATCH", { status: "da_pagare" }, noPerm)).status, 403);
    assert.equal((await call(`settlements/${sid}`, "DELETE", undefined, noPerm)).status, 403);
    const annulPayment = await call(`settlements/${sid}`, "PATCH", { status: "da_pagare", paidMethod: null });
    assert.equal(annulPayment.status, 200); assert.equal(annulPayment.data.paidAt, null); assert.equal(annulPayment.data.paidMethod, null);
    const unpaid = await days();
    assert.ok(unpaid.rows.every((row: any) => !row.paid && row.settlementId === sid));
    assert.equal(unpaid.summary[0].unsettledCents, 0, "Pagamento annullato, ma liquidazione ancora attiva");
    assert.equal((await history()).find(row => row.id === sid).outstandingCents, 3600);
    assert.equal((await call(`settlements/${sid}`, "DELETE")).status, 200);
    const unlinked = await days();
    assert.ok(unlinked.rows.every((row: any) => !row.paid && row.settlementId === null));
    assert.equal(unlinked.summary[0].minutes, 180); assert.equal(unlinked.summary[0].unsettledCents, 3600);
    assert.equal((await history()).find(row => row.id === sid).status, "annullata");
    assert.equal((await preview()).settlement, null);
    const recreated = await create(); assert.equal(recreated.status, 201);
    const nextId = recreated.data.id;
    assert.equal((await create()).status, 409, "Nessuna doppia liquidazione");
    assert.equal((await call(`settlements/${sid}`, "PATCH", { status: "pagato" })).status, 409, "Non riattiva una liquidazione annullata");
    assert.equal((await call(`settlements/${sid}`, "DELETE")).status, 200, "Annullamento ripetuto innocuo");
    assert.ok((await days()).rows.every((row: any) => row.settlementId === nextId));
    assert.deepEqual(settlementTotals(await history()), { grossCents: 3600, adjustmentsCents: 0, totalCents: 3600, paidCents: 0, outstandingCents: 3600 });
    const race = await Promise.all([call(`settlements/${nextId}`, "PATCH", { status: "pagato", paidMethod: "test" }), call(`settlements/${nextId}`, "DELETE")]);
    assert.ok(race.some(result => result.status === 200));
    const current = (await history()).find(row => row.id === nextId);
    const currentDays = (await days()).rows;
    assert.ok(currentDays.every((row: any) => current.status === "pagato" ? row.paid && row.settlementId === nextId : !row.paid && row.settlementId === null), "Stati atomici anche con pagamento e annullamento concorrenti");
    if (current.status === "pagato") {
      await call(`settlements/${nextId}`, "PATCH", { status: "da_pagare" });
      await call(`settlements/${nextId}`, "DELETE");
    }
    assert.equal(settlementTotals(await history()).totalCents, 0);
    const events = await db.select().from(auditLog).where(eq(auditLog.actorId, f.userIds[0]));
    assert.ok(events.some(event => event.entity === "settlement" && event.data.operation === "annulla_pagamento"));
    assert.ok(events.some(event => event.entity === "settlement" && event.data.operation === "annulla_liquidazione" && (event.data.workLogs as any[])?.length === 2));
    const duplicates = await Promise.all([create(), create()]);
    assert.equal(duplicates.filter(result => result.status === 201).length, 1, "Due creazioni concorrenti: un solo successo");
    f.settlementId = duplicates.find(result => result.status === 201)!.data.id;
    assert.equal((await history()).filter(row => row.status !== "annullata").length, 1);
    if (process.argv.includes("--keep-for-browser")) {
      assert.equal((await call(`settlements/${f.settlementId}`, "PATCH", { status: "pagato", paidMethod: "test sintetico" })).status, 200);
      await mkdir("/home/runner/workspace/.local", { recursive: true });
      await writeFile(fixturePath, JSON.stringify(f));
      keep = true;
    }
    console.log("PASS annullamenti distinti, permessi, giorni riaperti senza perdita ore, storico, totali e audit; pagamenti/annullamenti atomici e nessuna doppia liquidazione");
  } finally {
    if (!keep) {
      await cleanup(f);
      assert.equal(await accountingDigest(), before, "Contabilità reale invariata");
    }
    await pool.end();
  }
}
