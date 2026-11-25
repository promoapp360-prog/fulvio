// Esegue i veri endpoint in sviluppo. Crea e rimuove esclusivamente dati sintetici propri.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db, pool } from "../server/db";
import { hashPassword } from "../server/auth";
import {
  users, dogs, appointments, appointmentEvents, services, operators,
  guestCustomers, guestDogs, guestBookings, guestBookingEvents, auditLog, loginLog,
} from "../shared/schema";

if (process.env.NODE_ENV !== "development") throw new Error("Collaudo consentito solo in sviluppo");
const run = crypto.randomUUID();
const password = crypto.randomBytes(24).toString("base64url");
const userIds: number[] = [], dogIds: number[] = [], appIds: number[] = [], guestIds: number[] = [];
let guestCustomerId = 0, guestDogId = 0, cookie = "", customerCookie = "";
async function call(path: string, body?: unknown, session = cookie) {
  const response = await fetch(`http://localhost:80/api/${path}`, {
    method: body === undefined ? "GET" : "PUT",
    headers: { "x-requested-with": "fetch", ...(session ? { Cookie: session } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, data: await response.json() };
}
async function login(email: string) {
  const response = await fetch("http://localhost:80/api/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json", "x-requested-with": "fetch" },
    body: JSON.stringify({ login: email, password }),
  });
  assert.equal(response.status, 200);
  const session = response.headers.getSetCookie().find(v => v.startsWith("dp.sid="))?.split(";")[0];
  assert.ok(session);
  return session;
}

try {
  const catalog = await db.select({ id: services.id }).from(services).limit(2);
  const [operator] = await db.select({ id: operators.id }).from(operators).limit(1);
  assert.ok(catalog.length === 2 && operator, "Servono due servizi e un operatore già configurati");
  const passwordHash = await hashPassword(password);
  for (const role of ["admin", "customer", "customer"]) {
    const [user] = await db.insert(users).values({
      email: `duration-${run}-${userIds.length}@example.test`, passwordHash,
      firstName: "Collaudo durata", lastName: run, role, commEmail: false, commPush: false,
    }).returning();
    userIds.push(user.id);
  }
  cookie = await login(`duration-${run}-0@example.test`);
  customerCookie = await login(`duration-${run}-1@example.test`);
  for (const ownerId of [userIds[1], userIds[1], userIds[2]]) {
    const [dog] = await db.insert(dogs).values({ ownerId, name: `Durata-${run}`, size: "media" }).returning();
    dogIds.push(dog.id);
  }
  async function appointment(dogId: number, customerId: number, day: string, requestedServiceIds: number[], actualDurationMin: number | null = null) {
    const startAt = new Date(`${day}T10:00:00Z`);
    const [row] = await db.insert(appointments).values({
      customerId, dogId, serviceId: catalog[0].id, requestedServiceIds, startAt,
      endAt: new Date(startAt.getTime() + 60 * 60_000), durationMin: 60, status: "completata", actualDurationMin,
    }).returning();
    appIds.push(row.id); return row;
  }
  const previous = await appointment(dogIds[0], userIds[1], "2020-01-01", [catalog[1].id, catalog[0].id]);
  const current = await appointment(dogIds[0], userIds[1], "2021-01-01", [catalog[0].id, catalog[1].id]);
  const path = (id: number) => `admin/treatment-duration/appointment/${id}`;
  assert.equal((await call(path(previous.id), undefined, "")).status, 401);
  assert.equal((await call(path(previous.id), { actualDurationMin: 75 }, customerCookie)).status, 403);
  for (const invalid of [0, 601, 7.5, "75"]) assert.equal((await call(path(previous.id), { actualDurationMin: invalid })).status, 400);
  assert.equal((await call(path(previous.id), { actualDurationMin: 75 })).status, 200);
  assert.equal((await call(path(previous.id))).data.actualDurationMin, 75);
  const [saved] = await db.select().from(appointments).where(eq(appointments.id, previous.id));
  assert.equal(saved.durationMin, 60);
  assert.equal(saved.endAt.getTime(), previous.endAt.getTime());
  assert.equal(saved.status, previous.status);
  // Non mescolare animali, clienti, prestazioni o appuntamenti successivi.
  await appointment(dogIds[1], userIds[1], "2020-06-01", current.requestedServiceIds, 25);
  await appointment(dogIds[2], userIds[2], "2020-06-01", current.requestedServiceIds, 30);
  await appointment(dogIds[0], userIds[1], "2020-06-01", [], 35);
  await appointment(dogIds[0], userIds[1], "2022-01-01", current.requestedServiceIds, 40);
  const history = (await call(path(current.id))).data.history;
  assert.deepEqual(history.map((row: any) => row.id), [previous.id]);
  assert.equal(history[0].actualDurationMin, 75);
  assert.equal((await db.select().from(appointmentEvents).where(eq(appointmentEvents.appointmentId, previous.id)))[0].action, "durata_trattamento");
  assert.equal((await call(path(previous.id), { actualDurationMin: null })).status, 200);
  assert.deepEqual((await call(path(current.id))).data.history, []);
  assert.equal((await call("admin/treatment-duration/invalid/1")).status, 400);
  console.log("PASS registrati: persistenza, storico, isolamento, permessi, validazione, rimozione e agenda invariata");

  const [gc] = await db.insert(guestCustomers).values({
    firstName: "Collaudo", lastName: run, email: `duration-${run}@example.test`, emailNormalized: `duration-${run}@example.test`,
    phone: "3330000000", phoneNormalized: "3330000000", privacyAcknowledgedAt: new Date(), privacyProof: "collaudo",
  }).returning();
  guestCustomerId = gc.id;
  const [gd] = await db.insert(guestDogs).values({
    guestCustomerId: gc.id, name: `Durata-${run}`, breed: "Meticcio", coatType: "liscio", coatLength: "corto",
  }).returning();
  guestDogId = gd.id;
  for (const day of ["2020-01-01", "2021-01-01"]) {
    const startAt = new Date(`${day}T10:00:00Z`);
    const [row] = await db.insert(guestBookings).values({
      firstName: gc.firstName, lastName: gc.lastName, email: gc.email, phone: gc.phone, breed: "Meticcio",
      guestCustomerId: gc.id, guestDogId: gd.id, serviceId: catalog[0].id, operatorId: operator.id,
      startAt, endAt: new Date(startAt.getTime() + 60 * 60_000), durationMin: 60,
      status: "confermata", tokenSeed: crypto.randomBytes(24).toString("hex"),
      requestKey: crypto.randomUUID(), payloadHash: crypto.randomBytes(24).toString("hex"), dedupeKey: crypto.randomUUID(),
    }).returning();
    guestIds.push(row.id);
  }
  const gp = `admin/treatment-duration/guest/${guestIds[0]}`;
  assert.equal((await call(gp, { actualDurationMin: 90 })).status, 200);
  assert.equal((await call(gp)).data.actualDurationMin, 90);
  assert.equal((await call(`admin/treatment-duration/guest/${guestIds[1]}`)).data.history[0].actualDurationMin, 90);
  const [guest] = await db.select().from(guestBookings).where(eq(guestBookings.id, guestIds[0]));
  assert.equal(guest.durationMin, 60);
  assert.equal(guest.status, "confermata");
  console.log("PASS ospiti esistenti: salvataggio e recupero storico senza account e senza cambiare lo slot");
} finally {
  await db.transaction(async tx => {
    if (appIds.length) {
      await tx.delete(appointmentEvents).where(inArray(appointmentEvents.appointmentId, appIds));
      await tx.delete(appointments).where(inArray(appointments.id, appIds));
    }
    if (guestIds.length) {
      await tx.delete(guestBookingEvents).where(inArray(guestBookingEvents.bookingId, guestIds));
      await tx.delete(guestBookings).where(inArray(guestBookings.id, guestIds));
    }
    if (guestDogId) await tx.delete(guestDogs).where(eq(guestDogs.id, guestDogId));
    if (guestCustomerId) await tx.delete(guestCustomers).where(eq(guestCustomers.id, guestCustomerId));
    if (dogIds.length) await tx.delete(dogs).where(inArray(dogs.id, dogIds));
    if (userIds.length) {
      await tx.delete(auditLog).where(inArray(auditLog.actorId, userIds));
      await tx.delete(loginLog).where(inArray(loginLog.userId, userIds));
      await tx.delete(users).where(inArray(users.id, userIds));
    }
  });
  for (const userId of userIds) await pool.query(`DELETE FROM session WHERE (sess->>'userId')::int = $1`, [userId]);
  await pool.end();
}
