// Esegue i veri endpoint dell'app in sviluppo. Crea e rimuove solo dati sintetici propri.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import sharp from "sharp";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, pool } from "../server/db";
import { users, dogs, dogPhotos, appointments, customerConsents, boardingRequests, emailQueue } from "../shared/schema";
import { hashPassword } from "../server/auth";
import { deleteStored } from "../server/services/storage";
import { todayRome, addDays } from "../server/time";

if (process.env.NODE_ENV !== "development") throw new Error("Collaudo consentito solo in sviluppo");
const base = "http://127.0.0.1:18633";
const cleanupRun = process.argv.find(value => value.startsWith("--cleanup="))?.slice("--cleanup=".length);
if (cleanupRun && !/^[a-f0-9-]{36}$/.test(cleanupRun)) throw new Error("Identificativo collaudo non valido");
const run = cleanupRun || crypto.randomUUID(), email = `collaudo-${run}@example.test`, password = crypto.randomBytes(24).toString("base64url");
const adminEmail = `collaudo-admin-${run}@example.test`;
const owner = { firstName: `Collaudo-${run}`, lastName: "Sintetico", email, password, phone: "3330000000",
  city: "Cernusco sul Naviglio", province: "MI", cap: "20063", birthDate: "1990-01-01",
  consentPrivacy: true, consentMarketing: false,
  dog: { name: `Prova-${run}`, species: "cane", breed: "Meticcio", size: "media", weightKg: "12",
    birthDate: "2020-01-01", coatType: "liscio", coatLength: "corto", food: { notes: "Alimentazione di prova" },
    jointIssues: "Nessuna", dermatitis: "Nessuna", intolerances: "Nessuna", sensitivities: "Nessuna",
    aggressive: false, otherNeeds: "Nessuna", otherPets: "Nessuno" } };
let customerId = 0, adminId = 0, cookie = "", adminCookie = "";
const photos = new Set<string>();
async function call(path: string, body?: unknown, session = cookie, method = body === undefined ? "GET" : "POST") {
  const response = await fetch(base + path, { method,
    headers: { "x-requested-with": "fetch", ...(session ? { Cookie: session } : {}), ...(body !== undefined && !(body instanceof FormData) ? { "Content-Type": "application/json" } : {}) },
    body: body instanceof FormData ? body : body !== undefined ? JSON.stringify(body) : undefined });
  const nextCookie = response.headers.getSetCookie().find(value => value.startsWith("dp.sid="))?.split(";")[0];
  const data = response.headers.get("content-type")?.includes("application/json") ? await response.json() : await response.arrayBuffer();
  return { status: response.status, data, cookie: nextCookie || session, headers: response.headers };
}
const log = (text: string) => console.log(`PASS ${text}`);
try {
  if (!cleanupRun) {
  const config = await call("/api/public/settings");
  assert.equal(config.status, 200);
  console.log(`CONFIG emailConfigured=${config.data.emailConfigured} pushConfigured=${config.data.pushConfigured}`);
  assert.equal((await call("/api/public/guest-bookings", {}, "")).status, 410);
  assert.equal((await call("/api/account/appointments", {}, "")).status, 401);
  log("richieste anonime bloccate, storico non cancellato");
  assert.equal((await call("/api/auth/register", { ...owner, consentPrivacy: false }, "")).status, 400);
  assert.equal((await db.select().from(users).where(eq(users.email, email))).length, 0);
  log("registrazione senza presa visione rifiutata senza creare anagrafica");
  const invalid = new FormData(); invalid.append("payload", JSON.stringify(owner)); invalid.append("photo", new Blob(["not-an-image"], { type: "image/jpeg" }), "falso.jpg");
  assert.equal((await call("/api/auth/register", invalid, "")).status, 400);
  const image = await sharp({ create: { width: 160, height: 160, channels: 3, background: "#1d7eac" } }).webp().toBuffer();
  const form = new FormData(); form.append("payload", JSON.stringify(owner)); form.append("photo", new Blob([image], { type: "image/webp" }), "foto-collaudo.webp");
  const registered = await call("/api/auth/register", form, "");
  assert.equal(registered.status, 201, JSON.stringify(registered.data));
  cookie = registered.cookie; customerId = registered.data.id;
  assert.equal(registered.data.consentMarketing, false); assert.equal(registered.data.commPush, false);
  assert.equal(registered.data.commEmail, true);
  assert.equal((await call("/api/auth/me")).data.id, customerId);
  const receipts = await db.select().from(customerConsents).where(eq(customerConsents.userId, customerId));
  const privacy = receipts.find(receipt => receipt.kind === "privacy");
  assert.ok(privacy?.createdAt && privacy.policyVersion?.startsWith("doc-") && privacy.proof);
  assert.ok(receipts.some(receipt => receipt.kind === "condizioni" && receipt.granted));
  assert.ok(receipts.some(receipt => receipt.kind === "marketing" && !receipt.granted));
  log("registrazione reale con sessione, scheda, privacy versionata e marketing facoltativo");
  const pets = await call("/api/account/dogs"); assert.equal(pets.data.length, 1);
  const pet = pets.data[0];
  const [privatePhoto] = await db.select().from(dogPhotos).where(eq(dogPhotos.dogId, pet.id));
  photos.add(privatePhoto.storageKey);
  const photo = await call(`/api/account/dogs/${pet.id}/photo`);
  assert.equal(photo.status, 200); assert.equal(photo.headers.get("content-type"), "image/webp");
  assert.ok(photo.data.byteLength < 1_000_000); assert.equal((await call(`/api/account/dogs/${pet.id}/photo`, undefined, "")).status, 401);
  await db.update(dogs).set({ photoUrl: null }).where(eq(dogs.id, pet.id)); // formato storico: foto privata già presente
  const reused = await call("/api/account/dogs");
  assert.equal(reused.data[0].hasPhoto, true);
  assert.equal(reused.data[0].photoUrl, `/api/account/dogs/${pet.id}/photo`);
  assert.equal((await call(`/api/account/dogs/${pet.id}`, { name: pet.name }, cookie, "PATCH")).status, 200);
  assert.equal((await db.select().from(dogPhotos).where(eq(dogPhotos.dogId, pet.id)))[0].storageKey, privatePhoto.storageKey);
  log("foto compressa persistente e protetta da accessi anonimi");
  const services = (await call("/api/public/services")).data;
  const bath = services.find((service: any) => service.slug === "lavaggio-professionale" && service.active && service.bookable && service.visible);
  assert.ok(bath, "Lavaggio non abilitato: verificare il catalogo reale senza creare disponibilità fittizie.");
  let date = "", time = "";
  for (let offset = 1; offset <= 14; offset++) {
    const day = addDays(todayRome(), offset);
    const available = await call(`/api/account/booking-availability?dogId=${pet.id}&serviceIds=${bath.id}&date=${day}`);
    assert.equal(available.status, 200, JSON.stringify(available.data));
    assert.ok(!("operators" in available.data));
    if (available.data.slots.length) { date = day; time = available.data.slots[0]; break; }
  }
  assert.ok(time, "Nessuno slot reale nei prossimi 14 giorni: turni non alterati.");
  log("disponibilità trovata su turni e competenze reali, senza scelta operatore");
  const request = { dogId: pet.id, serviceIds: [bath.id], date, time, coatKnotsToday: true, coatSheddingToday: false,
    notes: `Collaudo sintetico ${run}: lavaggio e pensione`, alternativeAvailability: "Altro giorno da concordare",
    requestKey: crypto.randomUUID(), boarding: { startDate: addDays(date, 1), endDate: addDays(date, 2), needs: "Prova" } };
  const saved = await call("/api/account/appointments", request);
  assert.equal(saved.status, 201, JSON.stringify(saved.data)); assert.equal(saved.data.firstRequest, true);
  const replay = await call("/api/account/appointments", request);
  assert.equal(replay.status, 200); assert.equal(replay.data.id, saved.data.id); assert.equal(replay.data.duplicate, true);
  const [app] = await db.select().from(appointments).where(eq(appointments.id, saved.data.id));
  assert.equal(app.status, "richiesta"); assert.equal(app.operatorId, null); assert.ok(app.reservedOperatorId);
  assert.equal(app.durationNeedsReview, true); assert.equal(app.privacyAcknowledgedAt?.toISOString(), privacy!.createdAt.toISOString());
  assert.equal((await db.select().from(boardingRequests).where(eq(boardingRequests.customerId, customerId))).length, 1);
  assert.equal((await db.select().from(customerConsents).where(eq(customerConsents.userId, customerId))).length, receipts.length);
  assert.equal((await call("/api/account/appointments", { ...request, requestKey: crypto.randomUUID() })).status, 409);
  assert.equal((await call("/api/account/push/offer", {})).data.offer, false);
  log("lavaggio + pensione salvati una volta; stato richiesta, privacy non ripetuta, muta/nodi del giorno");
  const [admin] = await db.insert(users).values({ email: adminEmail, passwordHash: await hashPassword(password),
    role: "admin", firstName: `Admin-${run}`, lastName: "Collaudo", commEmail: false, commPush: false }).returning();
  adminId = admin.id;
  const logged = await call("/api/auth/login", { email: adminEmail, password }, "");
  assert.equal(logged.status, 200); adminCookie = logged.cookie;
  const queue = await call("/api/admin/requests?status=aperte", undefined, adminCookie);
  assert.equal(queue.status, 200); assert.ok(queue.data.some((item: any) => item.id === app.id));
  const agenda = await call(`/api/admin/appointments?from=${date}&to=${date}`, undefined, adminCookie);
  assert.equal(agenda.status, 200); assert.ok(agenda.data.some((item: any) => item.id === app.id));
  const detail = await call(`/api/admin/appointments/${app.id}`, undefined, adminCookie);
  assert.equal(detail.status, 200); assert.equal(detail.data.coatKnotsToday, true); assert.equal(detail.data.durationNeedsReview, true);
  assert.equal((await call(`/api/admin/dogs/${pet.id}/photo`, undefined, adminCookie)).status, 200);
  assert.equal((await call(`/api/admin/appointments/${app.id}/photo`, undefined, adminCookie)).status, 200);
  log("richiesta presente in admin ed agenda, collegata a cliente/cane e foto consultabili");
  const customerMail = await db.select().from(emailQueue).where(eq(emailQueue.dedupeKey, `booking-received:${app.id}`));
  const salonMail = await db.select().from(emailQueue).where(eq(emailQueue.dedupeKey, `booking-staff:${app.id}`));
  assert.equal(customerMail.length, 1); assert.equal(salonMail.length, 1);
  assert.equal(customerMail[0].toEmail, email); assert.equal(salonMail[0].toEmail, "info@dogsplanet.it");
  assert.match(customerMail[0].html, /pensione/);
  console.log(`EMAIL cliente=${customerMail[0].status}; salone=${salonMail[0].status}; consegnaReale=${config.data.emailConfigured ? "da verificare" : "NON disponibile: SMTP assente"}`);
  assert.equal((await call("/api/account/profile", { consentMarketing: true }, cookie, "PATCH")).status, 200);
  assert.equal((await call("/api/account/push/offer", {})).data.offer, true);
  assert.equal((await call("/api/account/push/offer", {})).data.offer, false);
  log("invito push rifiutato senza marketing e concesso una sola volta dopo adesione esplicita");
  assert.equal((await call(`/api/admin/appointments/${app.id}/action`, { action: "conferma", operatorId: 2147483647 }, adminCookie)).status, 400);
  let confirmed = await call(`/api/admin/appointments/${app.id}/action`, { action: "conferma", operatorId: app.reservedOperatorId, durationMin: app.durationMin + 5 }, adminCookie);
  if (confirmed.status === 409) confirmed = await call(`/api/admin/appointments/${app.id}/action`, { action: "conferma", operatorId: app.reservedOperatorId, durationMin: app.durationMin }, adminCookie);
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.data));
  const [approved] = await db.select().from(appointments).where(eq(appointments.id, app.id));
  assert.ok(["confermata", "attesa_pagamento"].includes(approved.status)); assert.equal(approved.operatorId, app.reservedOperatorId);
  assert.equal(approved.reservedOperatorId, null); assert.equal(approved.durationNeedsReview, false);
  log("solo admin conferma, verifica competenze ed assegna operatore/durata");
  }
} finally {
  const synthetic = await db.select({ id: users.id }).from(users).where(inArray(users.email, [email, adminEmail]));
  const userIds = synthetic.map(user => user.id);
  const ids = `{${userIds.join(",")}}`; // parametro PG array, non interpolazione Drizzle di una lista di record
  if (userIds.length) {
    for (const row of await db.select({ key: dogPhotos.storageKey }).from(dogPhotos).innerJoin(dogs, eq(dogs.id, dogPhotos.dogId)).where(inArray(dogs.ownerId, userIds))) photos.add(row.key);
    await db.transaction(async tx => {
      await tx.execute(sql`DELETE FROM appointment_photos WHERE appointment_id IN (SELECT id FROM appointments WHERE customer_id = ANY(${ids}::int[]))`);
      await tx.execute(sql`DELETE FROM appointment_events WHERE appointment_id IN (SELECT id FROM appointments WHERE customer_id = ANY(${ids}::int[]))`);
      await tx.execute(sql`DELETE FROM payments WHERE customer_id = ANY(${ids}::int[])`);
      await tx.execute(sql`DELETE FROM boarding_events WHERE boarding_id IN (SELECT id FROM boarding_requests WHERE customer_id = ANY(${ids}::int[]))`);
      await tx.execute(sql`DELETE FROM boarding_requests WHERE customer_id = ANY(${ids}::int[])`);
      await tx.execute(sql`DELETE FROM appointments WHERE customer_id = ANY(${ids}::int[])`);
      await tx.execute(sql`DELETE FROM dog_photos WHERE dog_id IN (SELECT id FROM dogs WHERE owner_id = ANY(${ids}::int[]))`);
      await tx.execute(sql`DELETE FROM dogs WHERE owner_id = ANY(${ids}::int[])`);
      await tx.execute(sql`DELETE FROM loyalty_transactions WHERE card_id IN (SELECT id FROM loyalty_cards WHERE customer_id = ANY(${ids}::int[]))`);
      await tx.execute(sql`DELETE FROM loyalty_cards WHERE customer_id = ANY(${ids}::int[])`);
      await tx.execute(sql`DELETE FROM customer_consents WHERE user_id = ANY(${ids}::int[]) OR created_by = ANY(${ids}::int[])`);
      await tx.execute(sql`DELETE FROM notifications WHERE user_id = ANY(${ids}::int[]) OR body LIKE ${"%" + run + "%"}`);
      await tx.execute(sql`DELETE FROM email_queue WHERE user_id = ANY(${ids}::int[]) OR html LIKE ${"%" + run + "%"}`);
      await tx.execute(sql`DELETE FROM audit_log WHERE actor_id = ANY(${ids}::int[])`);
      await tx.execute(sql`DELETE FROM session WHERE (sess->>'userId')::int = ANY(${ids}::int[])`);
      await tx.delete(users).where(inArray(users.id, userIds));
    });
  }
  for (const key of photos) await deleteStored(key);
  await pool.end();
  console.log("CLEANUP rimossi solo account, richieste e foto sintetici del collaudo");
}
