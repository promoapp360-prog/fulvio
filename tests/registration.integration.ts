// Synthetic development records only. Calls the same persistence function as
// POST /register, without sending test emails or notifications to real staff.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import type { Request } from "express";
import sharp from "sharp";
import { eq, inArray, like } from "drizzle-orm";
import { db, pool } from "../server/db";
import { createCustomerRegistration } from "../server/routes/auth";
import { readStored, deleteStored } from "../server/services/storage";
import { users, dogs, dogPhotos, customerConsents, loyaltyCards, loyaltyTransactions, loginLog } from "../shared/schema";

if (process.env.NODE_ENV !== "development") throw new Error("Solo sviluppo");
const run = crypto.randomUUID().slice(0, 10);
const prefix = `multipet-${run}`;
const req = { ip: "127.0.0.1", get: () => "Dog's Planet synthetic registration test" } as unknown as Request;
const userIds: number[] = [];
const paths: string[] = [];
const dog = { name: `Poppy test ${run}`, species: "cane", breed: "Meticcio", size: "media", weightKg: "12.5", birthDate: "2021-03-15", coatType: "mosso", coatLength: "medio" };
const owner = { firstName: "Test iscrizione", lastName: run, email: `${prefix}@example.invalid`, phone: "3330000000", password: crypto.randomBytes(24).toString("base64url"),
  city: "Cernusco", province: "MI", cap: "20063", birthDate: "1990-01-01", consentPrivacy: true, consentMarketing: false };
const pixel = (color: string) => sharp({ create: { width: 32, height: 32, channels: 3, background: color } }).png().toBuffer();
const file = (fieldname: string, buffer: Buffer) => ({ fieldname, buffer, mimetype: "image/png", size: buffer.length, originalname: "test.png" } as Express.Multer.File);
try {
  const blue = await pixel("#0000ff"), red = await pixel("#ff0000");
  const invalidEmail = `${prefix}-invalid@example.invalid`;
  await assert.rejects(() => createCustomerRegistration({ ...owner, email: invalidEmail, dogs: [dog, { ...dog, name: "" }] }, [], req));
  assert.equal((await db.select().from(users).where(eq(users.email, invalidEmail))).length, 0);
  const photoEmail = `${prefix}-badphoto@example.invalid`;
  await assert.rejects(() => createCustomerRegistration({ ...owner, email: photoEmail, dogs: [dog, { ...dog, name: "Secondo" }] }, [file("photo_0", blue), file("photo_1", Buffer.from("not a photo"))], req));
  assert.equal((await db.select().from(users).where(eq(users.email, photoEmail))).length, 0, "Nessun account dopo errore sulla seconda foto");
  await assert.rejects(() => createCustomerRegistration({ ...owner, dogs: [dog] }, [file("photo_1", blue)], req), /corrisponde/);
  await assert.rejects(() => createCustomerRegistration({ ...owner, dog }, [file("photo", blue), file("photo_0", red)], req), /sola foto/);
  // Simulate a failure halfway through this process's transaction only: no
  // schema changes/triggers and no effect on the running app or other users.
  const rollbackEmail = `${prefix}-rollback@example.invalid`;
  const originalTransaction = db.transaction;
  const rollbackPhotoKeys: string[] = [];
  try {
    (db as any).transaction = (callback: any) => originalTransaction.call(db, async (tx: any) => {
      const insert = tx.insert.bind(tx); let petInserts = 0;
      tx.insert = (table: any) => {
        if (table === dogs && ++petInserts === 2) throw new Error("synthetic second-pet database failure");
        const builder = insert(table);
        if (table === dogPhotos) {
          const values = builder.values.bind(builder);
          builder.values = (record: any) => { rollbackPhotoKeys.push(record.storageKey); return values(record); };
        }
        return builder;
      };
      return callback(tx);
    });
    await assert.rejects(() => createCustomerRegistration({ ...owner, email: rollbackEmail, dogs: [dog, dog] }, [file("photo_0", blue), file("photo_1", red)], req), /synthetic second-pet/);
  } finally { db.transaction = originalTransaction; }
  assert.equal((await db.select().from(users).where(eq(users.email, rollbackEmail))).length, 0, "Rollback anche dell’account se la seconda scheda fallisce");
  assert.equal((await db.select().from(dogs).where(eq(dogs.name, dog.name))).length, 0, "Rollback della prima scheda");
  assert.equal(rollbackPhotoKeys.length, 1);
  assert.equal(await readStored(rollbackPhotoKeys[0]), null, "Foto già caricata rimossa anche dopo il rollback DB");
  const user = await createCustomerRegistration({ ...owner, dogs: [dog, { ...dog, name: `Luna test ${run}`, breed: "Golden Retriever", weightKg: 25 }] }, [file("photo_1", red), file("photo_0", blue)], req);
  userIds.push(user.id);
  const pets = await db.select().from(dogs).where(eq(dogs.ownerId, user.id)).orderBy(dogs.id);
  assert.equal(pets.length, 2);
  assert.deepEqual(pets.map(p => [p.name, p.ownerId, p.breed]), [[dog.name, user.id, "Meticcio"], [`Luna test ${run}`, user.id, "Golden Retriever"]]);
  assert.ok(pets.every(p => p.photoUrl === `/api/account/dogs/${p.id}/photo`));
  for (const [index, pet] of pets.entries()) {
    const [photo] = await db.select().from(dogPhotos).where(eq(dogPhotos.dogId, pet.id));
    paths.push(photo.storageKey);
    const data = await readStored(photo.storageKey);
    assert.ok(data && data.length < 1_000_000);
    const { data: raw } = await sharp(data).raw().toBuffer({ resolveWithObject: true });
    assert.ok(index === 0 ? raw[2] > raw[0] + 100 : raw[0] > raw[2] + 100, "La foto è associata alla propria scheda, non all’ordine dei file");
  }
  const consents = await db.select().from(customerConsents).where(eq(customerConsents.userId, user.id));
  assert.equal(consents.filter(c => c.kind === "privacy" && c.granted).length, 1);
  assert.equal(consents.find(c => c.kind === "marketing")?.granted, false);
  assert.equal((await db.select().from(loyaltyCards).where(eq(loyaltyCards.customerId, user.id))).length, 1, "Una sola tessera per account");
  await assert.rejects(() => createCustomerRegistration({ ...owner, dogs: [dog, dog] }, [], req), /Esiste già un account/);
  assert.equal((await db.select().from(dogs).where(eq(dogs.ownerId, user.id))).length, 2, "Retry non duplica le schede");
  const legacy = await createCustomerRegistration({ ...owner, email: `${prefix}-legacy@example.invalid`, dog }, [], req);
  userIds.push(legacy.id);
  assert.equal((await db.select().from(dogs).where(eq(dogs.ownerId, legacy.id))).length, 1, "Vecchio form singolo ancora supportato");
  const login = async (email: string) => {
    const response = await fetch("http://localhost:80/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json", "x-requested-with": "fetch" }, body: JSON.stringify({ login: email, password: owner.password }) });
    assert.equal(response.status, 200);
    return response.headers.getSetCookie().find(value => value.startsWith("dp.sid="))!.split(";")[0];
  };
  const [firstCookie, otherCookie] = await Promise.all([login(owner.email), login(legacy.email)]);
  const myPets = await fetch("http://localhost:80/api/account/dogs", { headers: { Cookie: firstCookie } });
  assert.deepEqual((await myPets.json()).map((pet: any) => pet.id).sort(), pets.map(p => p.id).sort());
  const photoUrl = `http://localhost:80${pets[0].photoUrl}`;
  const authorized = await fetch(photoUrl, { headers: { Cookie: firstCookie } });
  assert.equal(authorized.status, 200); assert.match(authorized.headers.get("content-type") || "", /image\/webp/);
  assert.equal((await fetch(photoUrl, { headers: { Cookie: otherCookie } })).status, 404);
  assert.equal((await fetch(photoUrl)).status, 401);
  assert.equal((await fetch(`http://localhost:80/files/${paths[0]}`)).status, 404, "Foto non esposta dal percorso pubblico");
  const concurrentEmail = `${prefix}-parallel@example.invalid`;
  const concurrent = await Promise.allSettled(Array.from({ length: 2 }, () => createCustomerRegistration({ ...owner, email: concurrentEmail, dogs: [dog, dog] }, [], req)));
  const winners = concurrent.filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof createCustomerRegistration>>> => result.status === "fulfilled");
  assert.equal(winners.length, 1);
  userIds.push(winners[0].value.id);
  assert.equal((await db.select().from(dogs).where(eq(dogs.ownerId, winners[0].value.id))).length, 2);
  assert.equal(concurrent.filter(result => result.status === "rejected").length, 1);
  console.log("PASS registrazione: più animali atomici, privacy singola, marketing facoltativo, foto private distinte <1MB, errori senza account parziali e invii concorrenti senza duplicati");
  if (process.argv.includes("--prepare-browser")) {
    await mkdir("/home/runner/workspace/.local/registration-browser", { recursive: true });
    await writeFile("/home/runner/workspace/.local/registration-browser/blue.png", blue);
    await writeFile("/home/runner/workspace/.local/registration-browser/red.png", red);
  }
} finally {
  // Include a successfully committed record even if a later assertion failed.
  const all = await db.select({ id: users.id }).from(users).where(like(users.email, `${prefix}%`));
  const ids = all.map(u => u.id);
  if (ids.length) {
    const pets = await db.select({ id: dogs.id }).from(dogs).where(inArray(dogs.ownerId, ids));
    const photos = pets.length ? await db.select().from(dogPhotos).where(inArray(dogPhotos.dogId, pets.map(p => p.id))) : [];
    await Promise.all(photos.map(p => deleteStored(p.storageKey)));
    await db.transaction(async tx => {
      if (pets.length) {
        await tx.delete(dogPhotos).where(inArray(dogPhotos.dogId, pets.map(p => p.id)));
        await tx.delete(dogs).where(inArray(dogs.id, pets.map(p => p.id)));
      }
      const cards = await tx.select({ id: loyaltyCards.id }).from(loyaltyCards).where(inArray(loyaltyCards.customerId, ids));
      if (cards.length) await tx.delete(loyaltyTransactions).where(inArray(loyaltyTransactions.cardId, cards.map(c => c.id)));
      await tx.delete(loyaltyCards).where(inArray(loyaltyCards.customerId, ids));
      await tx.delete(customerConsents).where(inArray(customerConsents.userId, ids));
      await tx.delete(loginLog).where(inArray(loginLog.userId, ids));
      await tx.delete(users).where(inArray(users.id, ids));
    });
    for (const id of ids) await pool.query(`DELETE FROM session WHERE (sess->>'userId')::int=$1`, [id]);
  }
  await pool.end();
}
