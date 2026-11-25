// Prova locale dei veri handler e della persistenza, senza accedere ai Secrets.
// L'identità è simulata solo in questo server effimero di test su loopback.
import assert from "node:assert/strict";
import express from "express";
import { eq } from "drizzle-orm";
import { db, pool } from "../server/db";
import { settings, users } from "../shared/schema";
import contentRoutes from "../server/routes/admin/content";
import { publicReviews } from "../server/services/reviews";
import { clearSettingsCache } from "../server/services/settings";
import { errorHandler } from "../server/util";

if (process.env.NODE_ENV !== "development") throw new Error("Test consentito solo in sviluppo");
const [admin] = await db.select({ id: users.id }).from(users).where(eq(users.role, "admin")).limit(1);
assert.ok(admin, "Admin di sviluppo non trovato");
const [original] = await db.select().from(settings).where(eq(settings.key, "reviews"));
const counts = async () => (await pool.query(`SELECT
  (SELECT count(*) FROM users)::int AS users,
  (SELECT count(*) FROM dogs)::int AS dogs,
  (SELECT count(*) FROM appointments)::int AS appointments,
  (SELECT count(*) FROM guest_bookings)::int AS guests`)).rows[0];
const before = await counts();
const app = express();
app.use(express.json());
app.use((req: any, _res, next) => { req.user = { id: admin.id, role: "admin", permissions: [] }; next(); });
app.use("/admin", contentRoutes);
app.get("/public/reviews", async (_req, res, next) => { try { res.json(await publicReviews()); } catch (error) { next(error); } });
app.use(errorHandler);
const server = app.listen(0, "127.0.0.1");
await new Promise<void>(resolve => server.once("listening", resolve));
const port = (server.address() as { port: number }).port;
const send = (url: string, body: unknown) => fetch(`http://127.0.0.1:${port}${url}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
try {
  const saved = await send("/admin/settings/reviews", { count: 7, rating: 4.7, googlePlaceId: "", googleUrl: "https://maps.google.com/", images: [] });
  assert.equal(saved.status, 200, await saved.text());
  const visible = await (await fetch(`http://127.0.0.1:${port}/public/reviews`)).json();
  assert.equal(visible.count, 7);
  assert.equal(visible.rating, 4.7);
  assert.equal(visible.source, "manual");
  assert.equal((await send("/admin/settings/reviews", { rating: 7 })).status, 400);
  assert.equal((await send("/admin/settings/site", { socialYoutube: "javascript:alert(1)" })).status, 400);
  assert.deepEqual(await counts(), before);
  console.log("OK: salvataggio admin reale, lettura pubblica, validazione, anagrafiche e prenotazioni invariate.");
} finally {
  if (original) await db.update(settings).set({ value: original.value, updatedAt: original.updatedAt }).where(eq(settings.key, "reviews"));
  else await db.delete(settings).where(eq(settings.key, "reviews"));
  clearSettingsCache();
  await new Promise<void>(resolve => server.close(() => resolve()));
  await pool.end();
  console.log("Valori recensioni di prova rimossi; configurazione iniziale ripristinata.");
}
