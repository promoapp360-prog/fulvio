// Real development endpoints; isolated synthetic records, no changes to existing customers/prices/settings.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import sharp from "sharp";
import { eq, inArray, or, sql } from "drizzle-orm";
import { db, pool } from "../server/db";
import { users, privacyContacts, loyaltyCards, loyaltyTransactions, dogPhotos, dogs, services } from "../shared/schema";
import { hashPassword } from "../server/auth";
import { getSettings } from "../server/services/settings";
import { ensureCard } from "../server/services/loyalty";
import { deleteStored } from "../server/services/storage";
import { addCalendarMonths } from "../server/logic";

if (process.env.NODE_ENV !== "development") throw new Error("Solo sviluppo");
const run = crypto.randomUUID(), tag = `Fidelity-${run}`, password = crypto.randomBytes(24).toString("base64url");
const phone = "000" + crypto.randomInt(1000000, 9999999), email = `fidelity-${run}@example.test`;
let customer = "", admin = "", serviceId = 0, categoryId = 0, customerId = 0;
async function call(path: string, body?: any, cookie = admin, method = body === undefined ? "GET" : "POST") {
  const res = await fetch("http://127.0.0.1:18633" + path, { method, headers: { "x-requested-with": "fetch", ...(cookie ? { cookie } : {}), ...(body && !(body instanceof FormData) ? { "content-type": "application/json" } : {}) }, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json(), cookie: res.headers.getSetCookie().map(c => c.split(";")[0]).join("; ") || cookie };
}
const pass = (s: string) => console.log("PASS " + s);
try {
  const config = await call("/api/public/settings", undefined, "");
  assert.equal(config.data.emailConfigured, false, "Questo collaudo non invia email esterne");
  const [a] = await db.insert(users).values({ email: `fidelity-admin-${run}@example.test`, passwordHash: await hashPassword(password), firstName: tag, lastName: "Admin sintetico", role: "admin", active: true, mustChangePassword: false, commEmail: false, commPush: false }).returning();
  admin = (await call("/api/auth/login", { email: a.email, password }, "")).cookie;
  const initialSettings = (await call("/api/admin/settings")).data.loyalty;
  assert.equal((await call("/api/admin/settings/loyalty", { welcomePoints: initialSettings.welcomePoints }, admin, "PUT")).status, 200);
  assert.equal((await call("/api/admin/settings/loyalty", { welcomePoints: -1 }, admin, "PUT")).status, 400);
  assert.equal((await call("/api/admin/loyalty/cards", undefined, "")).status, 401);
  const minimal = { firstName: tag, phone, points: 100, reason: "Self-service", requestKey: crypto.randomUUID() };
  const created = await call("/api/admin/loyalty/self-service", minimal);
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const source = created.data.card, cid = created.data.contactId;
  assert.equal(source.customerId, null); assert.equal(source.points, 100);
  const [contact] = await db.select().from(privacyContacts).where(eq(privacyContacts.id, cid));
  assert.equal(contact.email, null); assert.equal(contact.linkedUserId, null);
  assert.equal(contact.consentPrivacy, false); assert.equal(contact.consentMarketing, false);
  const repeated = await call("/api/admin/loyalty/self-service", minimal);
  assert.equal(repeated.data.card.id, source.id); assert.equal(repeated.data.duplicate, true);
  assert.equal((await call("/api/admin/loyalty/self-service", { ...minimal, requestKey: crypto.randomUUID() })).status, 409);
  const searched = await call(`/api/admin/loyalty/cards?q=${phone.slice(3)}`);
  assert.ok(searched.data.rows.some((c: any) => c.id === source.id && c.phone === phone));
  pass("cliente minimo e tessera senza account o consensi fittizi; ricerca telefono; retry senza doppioni");

  assert.equal((await call("/api/admin/loyalty/adjust", { cardId: source.id, points: -20, reason: "Omaggio" })).status, 200);
  assert.equal((await call("/api/admin/loyalty/adjust", { cardId: source.id, points: 1, reason: "" })).status, 400);
  assert.equal((await call("/api/admin/loyalty/adjust", { cardId: source.id, points: -1000, reason: "Non consentito" })).status, 400);
  assert.equal((await call(`/api/admin/loyalty/card/${source.id}/expiry`, { months: 6 })).status, 200);
  await call("/api/admin/loyalty/adjust", { cardId: source.id, points: 10, reason: "Porta un amico" });
  let detail = (await call(`/api/admin/loyalty/card/${source.id}`)).data;
  assert.equal(detail.card.points, 90);
  const six = detail.transactions.find((t: any) => t.points === 10);
  assert.ok(Math.abs(+new Date(six.expiresAt) - +addCalendarMonths(new Date(), 6)) < 10000);
  assert.equal((await call(`/api/admin/loyalty/card/${source.id}/expiry`, { months: 121 })).status, 400);
  await call(`/api/admin/loyalty/card/${source.id}/expiry`, { months: 0 });
  await call("/api/admin/loyalty/adjust", { cardId: source.id, points: 1, reason: "Omaggio senza scadenza" });
  assert.equal((await call(`/api/admin/loyalty/card/${source.id}`)).data.transactions.find((t: any) => t.points === 1).expiresAt, null);
  assert.equal((await call("/api/admin/loyalty/extend", { cardId: source.id, newDate: "2028-12-31", reason: "Proroga personale" })).status, 200);
  detail = (await call(`/api/admin/loyalty/card/${source.id}`)).data;
  const lotExpiries = new Map(detail.transactions.map((t: any) => [t.id, t.expiresAt]));
  pass("rettifiche positive/negative con storico, saldo mai negativo, scadenza personale e proroga reali");

  const payload = { firstName: tag, lastName: "Sintetico", email, password, phone, city: "Cernusco sul Naviglio", province: "MI", cap: "20063", birthDate: "1990-01-01", consentPrivacy: true, consentMarketing: false,
    dog: { name: "Prova", species: "cane", breed: "Meticcio", size: "media", weightKg: "12", birthDate: "2020-01-01", coatType: "liscio", coatLength: "corto", food: { notes: "Prova" }, jointIssues: "Nessuna", dermatitis: "Nessuna", intolerances: "Nessuna", sensitivities: "Nessuna", aggressive: false, otherNeeds: "Nessuna", otherPets: "Nessuno" } };
  const form = new FormData(); form.append("payload", JSON.stringify(payload));
  form.append("photo", new Blob([await sharp({ create: { width: 100, height: 100, channels: 3, background: "#188eb5" } }).webp().toBuffer()], { type: "image/webp" }), "prova.webp");
  const registered = await call("/api/auth/register", form, "");
  assert.equal(registered.status, 201, JSON.stringify(registered.data)); customer = registered.cookie; customerId = registered.data.id;
  assert.equal((await db.select().from(privacyContacts).where(eq(privacyContacts.id, cid)))[0].linkedUserId, null);
  let wallet = (await call("/api/account/loyalty", undefined, customer)).data;
  const bonus = initialSettings.enabled ? initialSettings.welcomePoints : 0;
  assert.equal(wallet.card.points, bonus);
  assert.equal((await call("/api/admin/loyalty/adjust", { cardId: source.id, points: 10, reason: "Vietato" }, customer)).status, 403);
  assert.equal((await call("/api/account/loyalty/claim", { code: source.code }, customer)).data.linked, false);
  assert.equal((await call("/api/account/loyalty", undefined, customer)).data.card.points, bonus);
  const pending = (await call("/api/admin/loyalty/claims")).data;
  assert.ok(pending.some((c: any) => c.cardId === source.id && c.customerId === customerId));
  assert.equal((await call(`/api/admin/loyalty/claims/${source.id}`, { action: "approve" })).status, 400);
  assert.equal((await call(`/api/admin/loyalty/claims/${source.id}`, { action: "approve", verifiedContact: true })).status, 200);
  wallet = (await call("/api/account/loyalty", undefined, customer)).data;
  assert.equal(wallet.card.points, bonus + 91);
  assert.ok(wallet.transactions.some((t: any) => t.reason === "Self-service"));
  for (const t of wallet.transactions) if (lotExpiries.has(t.id)) assert.equal(t.expiresAt, lotExpiries.get(t.id));
  assert.equal((await call(`/api/admin/loyalty/claims/${source.id}`, { action: "approve", verifiedContact: true })).status, 409);
  assert.equal((await call(`/api/admin/loyalty/cards?q=${source.code}`)).data.rows[0].id, wallet.card.id);
  assert.equal((await call("/api/account/loyalty", undefined, customer)).data.card.points, bonus + 91);
  pass("nessun recupero automatico per telefono; verifica admin obbligatoria, trasferimento una sola volta, scadenze e storico conservati");

  const verified = await call("/api/admin/loyalty/self-service", { firstName: tag + "-email", phone: "001" + phone.slice(3), email, points: 7, reason: "Self-service", requestKey: crypto.randomUUID(), separateContact: true });
  await db.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, customerId)); // solo il recapito sintetico del collaudo
  assert.equal((await call("/api/account/loyalty/claim", { code: verified.data.card.code }, customer)).data.linked, true);
  assert.equal((await call("/api/account/loyalty", undefined, customer)).data.card.points, bonus + 98);
  pass("email verificata + tessera + azione esplicita: recupero diretto, nessun bisogno di SMS o servizio esterno");

  // Test positive/disabled welcome bonuses only in this process's settings cache, not the running app's configuration.
  const local = await getSettings(), saved = { ...local.loyalty };
  try {
    local.loyalty.enabled = true; local.loyalty.welcomePoints = 17;
    const [u] = await db.insert(users).values({ email: `fidelity-bonus-${run}@example.test`, passwordHash: await hashPassword(password), firstName: tag, lastName: "Bonus" }).returning();
    await db.transaction(async tx => { await ensureCard(u.id, tx, true); await ensureCard(u.id, tx, true); });
    const [c] = await db.select().from(loyaltyCards).where(eq(loyaltyCards.customerId, u.id));
    assert.equal(c.points, 17);
    assert.equal((await db.select().from(loyaltyTransactions).where(eq(loyaltyTransactions.cardId, c.id))).length, 1);
    local.loyalty.welcomePoints = 0;
    const [z] = await db.insert(users).values({ email: `fidelity-zero-${run}@example.test`, passwordHash: await hashPassword(password), firstName: tag, lastName: "Zero" }).returning();
    assert.equal((await ensureCard(z.id, db, true)).points, 0);
  } finally { Object.assign(local.loyalty, saved); }
  pass("bonus positivo assegnato una sola volta; zero disattiva; nessuna modifica alla configurazione reale del salone");

  const category = await call("/api/admin/service-categories", { name: tag, sortOrder: 9999, active: true, visible: true });
  assert.equal(category.status, 201, JSON.stringify(category.data)); categoryId = category.data.id;
  const svc = await call("/api/admin/services", { name: tag, category: tag, durationMin: 40, priceCents: 2500, priceFrom: true, active: true, visible: true, bookable: true, variants: [{ size: "media", priceCents: 3500, durationMin: 60 }] });
  assert.equal(svc.status, 201, JSON.stringify(svc.data)); serviceId = svc.data.id;
  assert.equal((await call(`/api/admin/services/${serviceId}`, { priceCents: 2600, description: "Prova condivisa", durationMin: 45, sortOrder: 999, variants: [{ size: "media", priceCents: 3600, durationMin: 65 }] }, admin, "PATCH")).status, 200);
  const publicService = (await call("/api/public/services?view=catalog", undefined, "")).data.find((s: any) => s.id === serviceId);
  assert.equal(publicService.priceCents, 2600); assert.equal(publicService.variants[0].durationMin, 65);
  assert.ok((await call("/api/public/services", undefined, "")).data.some((s: any) => s.id === serviceId));
  await call(`/api/admin/services/${serviceId}`, { active: false }, admin, "PATCH");
  assert.ok(!(await call("/api/public/services?view=catalog", undefined, "")).data.some((s: any) => s.id === serviceId));
  pass("listino admin → catalogo pubblico condiviso e prenotazioni; varianti/taglie/durata, disattivazione; prezzi esistenti intatti");
  if (process.argv.includes("--browser")) {
    const uiPhone = "002" + phone.slice(3);
    const { verifyFidelityUI } = await import("./fidelity-browser");
    await verifyFidelityUI({ admin, customer, name: tag, phone: uiPhone, startingPoints: bonus + 98,
      beforeClaim: async () => { await db.update(users).set({ phone: uiPhone }).where(eq(users.id, customerId)); } });
  }
} finally {
  const synthetic = await db.select({ id: users.id }).from(users).where(sql`${users.email} like ${`%${run}@example.test`}`);
  const contacts = await db.select({ id: privacyContacts.id }).from(privacyContacts).where(sql`${privacyContacts.firstName} like ${tag + "%"}`);
  const ids = `{${synthetic.map(u => u.id).join(",")}}`, cids = `{${contacts.map(c => c.id).join(",")}}`;
  const photos = await db.select({ key: dogPhotos.storageKey }).from(dogPhotos).innerJoin(dogs, eq(dogs.id, dogPhotos.dogId)).where(sql`${dogs.ownerId} = any(${ids}::int[])`);
  await db.transaction(async tx => {
    await tx.execute(sql`DELETE FROM dog_photos WHERE dog_id IN (SELECT id FROM dogs WHERE owner_id = ANY(${ids}::int[]))`);
    await tx.execute(sql`DELETE FROM dogs WHERE owner_id = ANY(${ids}::int[])`);
    await tx.execute(sql`DELETE FROM loyalty_transactions WHERE card_id IN (SELECT id FROM loyalty_cards WHERE customer_id = ANY(${ids}::int[]) OR contact_id = ANY(${cids}::int[]))`);
    await tx.execute(sql`UPDATE loyalty_cards SET merged_into_card_id = NULL WHERE customer_id = ANY(${ids}::int[]) OR contact_id = ANY(${cids}::int[])`);
    await tx.execute(sql`DELETE FROM loyalty_cards WHERE customer_id = ANY(${ids}::int[]) OR contact_id = ANY(${cids}::int[])`);
    await tx.execute(sql`DELETE FROM privacy_contacts WHERE id = ANY(${cids}::int[])`);
    for (const table of ["customer_consents", "notifications", "email_queue"]) await tx.execute(sql.raw(`DELETE FROM ${table} WHERE user_id = ANY('${ids}'::int[])`));
    await tx.execute(sql`DELETE FROM audit_log WHERE actor_id = ANY(${ids}::int[])`);
    await tx.execute(sql`DELETE FROM session WHERE (sess->>'userId')::int = ANY(${ids}::int[])`);
    if (synthetic.length) await tx.delete(users).where(inArray(users.id, synthetic.map(u => u.id)));
    if (serviceId) {
      await tx.execute(sql`DELETE FROM service_variants WHERE service_id = ${serviceId}`);
      await tx.delete(services).where(eq(services.id, serviceId));
    }
    if (categoryId) await tx.execute(sql`DELETE FROM service_categories WHERE id = ${categoryId}`);
  });
  for (const p of photos) await deleteStored(p.key);
  await pool.end();
  console.log("CLEANUP rimossi esclusivamente clienti, tessere, foto e servizio sintetici del collaudo");
}
