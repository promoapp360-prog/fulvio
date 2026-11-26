// Removes only the synthetic account identified by the browser test fixture.
import { readFile, rm } from "node:fs/promises";
import assert from "node:assert/strict";
import { and, eq, inArray, sql, or } from "drizzle-orm";
import { db, pool } from "../server/db";
import { deleteStored } from "../server/services/storage";
import { users, dogs, dogPhotos, customerConsents, loyaltyCards, loyaltyTransactions, emailQueue, emailLog, notifications, auditLog, loginLog } from "../shared/schema";

if (process.env.NODE_ENV !== "development") throw new Error("Solo sviluppo");
const fixturePath = "/home/runner/workspace/.local/registration-browser/result.json";
try {
  const f = JSON.parse(await readFile(fixturePath, "utf8"));
  assert.match(f.email, /^multipet-browser-[a-zA-Z0-9_-]+@example\.invalid$/);
  const [user] = await db.select().from(users).where(and(eq(users.id, f.userId), eq(users.email, f.email)));
  assert.ok(user && user.role === "customer", "Fixture non corrispondente: nessuna cancellazione");
  assert.match(user.lastName, /^[a-zA-Z0-9_-]{6,}$/);
  const pets = await db.select({ id: dogs.id }).from(dogs).where(eq(dogs.ownerId, user.id));
  const photos = pets.length ? await db.select().from(dogPhotos).where(inArray(dogPhotos.dogId, pets.map(p => p.id))) : [];
  await Promise.all(photos.map(photo => deleteStored(photo.storageKey)));
  await db.transaction(async tx => {
    const cards = await tx.select({ id: loyaltyCards.id }).from(loyaltyCards).where(eq(loyaltyCards.customerId, user.id));
    if (cards.length) await tx.delete(loyaltyTransactions).where(inArray(loyaltyTransactions.cardId, cards.map(card => card.id)));
    await tx.delete(loyaltyCards).where(eq(loyaltyCards.customerId, user.id));
    await tx.delete(customerConsents).where(eq(customerConsents.userId, user.id));
    await tx.delete(emailQueue).where(or(eq(emailQueue.userId, user.id), eq(emailQueue.toEmail, user.email), sql`position(${`${user.firstName} ${user.lastName} si è registrato.`} in ${emailQueue.html}) > 0`));
    await tx.delete(emailLog).where(eq(emailLog.toEmail, user.email));
    await tx.delete(notifications).where(or(eq(notifications.userId, user.id), eq(notifications.url, `/admin/clienti/${user.id}`)));
    await tx.delete(auditLog).where(or(eq(auditLog.actorId, user.id), and(eq(auditLog.entity, "user"), eq(auditLog.entityId, String(user.id)))));
    await tx.delete(loginLog).where(eq(loginLog.userId, user.id));
    if (pets.length) {
      await tx.delete(dogPhotos).where(inArray(dogPhotos.dogId, pets.map(p => p.id)));
      await tx.delete(dogs).where(inArray(dogs.id, pets.map(p => p.id)));
    }
    await tx.delete(users).where(eq(users.id, user.id));
  });
  await pool.query(`DELETE FROM session WHERE (sess->>'userId')::int=$1`, [user.id]);
  await rm(fixturePath);
  console.log("PASS account, schede, foto e comunicazioni sintetiche rimossi");
} finally { await pool.end(); }
