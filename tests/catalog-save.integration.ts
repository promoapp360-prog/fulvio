// Exercises the live API with its own disposable admin, category and services.
// Never changes real prices, categories, operator links or appointments.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db, pool } from "../server/db";
import { hashPassword } from "../server/auth";
import { SIZES } from "../shared/constants";
import { users, services, serviceCategories, serviceVariants, servicePricingRules, serviceSupplements, operatorServices, appointments, auditLog, loginLog } from "../shared/schema";

if (process.env.NODE_ENV !== "development") throw new Error("Solo sviluppo");
const run = crypto.randomUUID().slice(0, 10);
const ids: number[] = [];
let actorId = 0, categoryId = 0, cookie = "";
const fingerprint = async () => {
  const tables = [services, serviceCategories, serviceVariants, servicePricingRules, serviceSupplements, operatorServices, appointments] as const;
  const rows = await Promise.all(tables.map(table => db.select().from(table as any)));
  return crypto.createHash("sha256").update(JSON.stringify(rows.map(records => records.map(record => JSON.stringify(record)).sort()))).digest("hex");
};
const before = await fingerprint();
async function call(path: string, method = "GET", body?: unknown) {
  const response = await fetch(`http://localhost:80/api/${path}`, { method,
    headers: { Cookie: cookie, "x-requested-with": "fetch", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, data: await response.json() };
}
try {
  const password = crypto.randomBytes(24).toString("base64url");
  const email = `catalog-${run}@example.invalid`;
  const [actor] = await db.insert(users).values({ email, passwordHash: await hashPassword(password), role: "admin", firstName: "Test listino", lastName: run, commEmail: false, commPush: false }).returning();
  actorId = actor.id;
  const login = await fetch("http://localhost:80/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json", "x-requested-with": "fetch" }, body: JSON.stringify({ login: email, password }) });
  assert.equal(login.status, 200);
  cookie = login.headers.getSetCookie().find(value => value.startsWith("dp.sid="))!.split(";")[0];
  const category = await call("admin/service-categories", "POST", { name: `Test catalogo ${run}`, active: true, visible: true });
  assert.equal(category.status, 201); categoryId = category.data.id;
  const base = { name: `Test prestazione ${run}`, category: category.data.name, priceCents: 1000, durationMin: 60, pricingType: "da", active: true, visible: true, bookable: true,
    variants: SIZES.map(size => ({ size, priceCents: null, durationMin: null })), operatorIds: [], pricingRules: [] };
  const created = await call("admin/services", "POST", base);
  if (created.data.id) ids.push(created.data.id);
  if (process.argv.includes("--reproduce")) {
    console.log("Riproduzione payload identico al form esistente:", JSON.stringify({ status: created.status, error: created.data.error, issues: created.data.issues }));
    assert.equal(created.status, 400);
    assert.ok(created.data.issues.some((issue: any) => issue.path[0] === "0" || issue.path.includes("size") || issue.code === "too_big"));
  } else {
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const sid = created.data.id;
    const full = async () => (await call("admin/services")).data.find((service: any) => service.id === sid);
    const first = await full();
    assert.equal(first.variants.length, 0, "Vuoto = eredita la base, non crea varianti inutili");
    const changed = { ...base, name: `${base.name} aggiornato`, description: "Descrizione sintetica", priceCents: 1250, durationMin: 75,
      variants: SIZES.map((size, index) => ({ size, priceCents: index === 0 ? 1550 : index === 2 ? 4550 : null, durationMin: index === 0 ? 30 : index === 2 ? 90 : null })),
      pricingRules: [{ size: "gigante", coatType: "riccio", coatLength: "lungo", pricingType: "fascia", priceCents: 8000, priceMaxCents: 9000, durationMin: 120, active: true, sortOrder: 0 }] };
    const update = await call(`admin/services/${sid}`, "PATCH", changed);
    assert.equal(update.status, 200, JSON.stringify(update.data));
    const reloaded = await full();
    assert.equal(reloaded.name, changed.name); assert.equal(reloaded.priceCents, 1250); assert.equal(reloaded.durationMin, 75);
    assert.deepEqual(reloaded.variants.map((v: any) => [v.size, v.priceCents, v.durationMin]).sort(), [["mini", 1550, 30], ["media", 4550, 90]].sort());
    assert.equal(reloaded.pricingRules.length, 1);
    const ruleId = reloaded.pricingRules[0].id;
    const allSizes = SIZES.map((size, index) => ({ size, priceCents: 1000 + index * 500, durationMin: 30 + index * 5 }));
    const allSizesSave = await call(`admin/services/${sid}`, "PATCH", { variants: allSizes });
    assert.equal(allSizesSave.status, 200);
    const allSizesReloaded = (await full()).variants;
    assert.equal(allSizesReloaded.length, 5);
    assert.deepEqual(allSizesReloaded.map(({ size, priceCents, durationMin }: any) => ({ size, priceCents, durationMin })), allSizes);
    const variantsOnly = await call(`admin/services/${sid}`, "PATCH", { variants: SIZES.map(size => ({ size, priceCents: size === "mini" ? 1650 : null, durationMin: null })) });
    assert.equal(variantsOnly.status, 200);
    const afterVariant = await full();
    assert.equal(afterVariant.pricingRules[0].id, ruleId, "Il listino rapido non cancella le regole prezzo non inviate");
    assert.equal(afterVariant.description, changed.description);
    const publicService = (await call("public/services?view=catalog")).data.find((s: any) => s.id === sid);
    assert.equal(publicService.priceCents, 1250);
    assert.equal(publicService.variants.find((v: any) => v.size === "mini").priceCents, 1650);
    assert.ok((await call("public/services")).data.some((s: any) => s.id === sid && s.bookable), "La stessa fonte alimenta le prestazioni prenotabili");
    const stable = JSON.stringify(await full());
    for (const body of [
      { variants: [{ size: "media", priceCents: -1, durationMin: 30 }] },
      { variants: [{ size: "media", priceCents: 100, durationMin: 0 }] },
      { variants: [{ size: "sconosciuta", priceCents: 100, durationMin: 30 }] },
      { variants: [{ size: "media", priceCents: 100, durationMin: 30 }, { size: "media", priceCents: 200, durationMin: 60 }] },
      { priceCents: 9999, variants: [{ size: "media", priceCents: 100, durationMin: 700 }] },
    ]) {
      const invalid = await call(`admin/services/${sid}`, "PATCH", body);
      assert.equal(invalid.status, 400, JSON.stringify(invalid));
      assert.equal(JSON.stringify(await full()), stable, "Nessuna modifica parziale su input non valido");
    }
    await call(`admin/services/${sid}`, "PATCH", { bookable: false });
    assert.equal((await call("public/services")).data.find((s: any) => s.id === sid).bookable, false);
    await call(`admin/services/${sid}`, "DELETE");
    assert.ok(!(await call("public/services?view=catalog")).data.some((s: any) => s.id === sid));
    console.log("PASS creazione/modifica: 5 taglie inclusa Mini, varianti, prezzi, regole e durate persistenti; pubblico/prenotazioni condivisi; input errati senza salvataggi parziali");
  }
} finally {
  await db.transaction(async tx => {
    if (ids.length) {
      await tx.delete(serviceVariants).where(inArray(serviceVariants.serviceId, ids));
      await tx.delete(servicePricingRules).where(inArray(servicePricingRules.serviceId, ids));
      await tx.delete(services).where(inArray(services.id, ids));
    }
    if (categoryId) await tx.delete(serviceCategories).where(eq(serviceCategories.id, categoryId));
    if (actorId) {
      await tx.delete(auditLog).where(eq(auditLog.actorId, actorId));
      await tx.delete(loginLog).where(eq(loginLog.userId, actorId));
      await tx.delete(users).where(eq(users.id, actorId));
    }
  });
  if (actorId) await pool.query(`DELETE FROM session WHERE (sess->>'userId')::int=$1`, [actorId]);
  assert.equal(await fingerprint(), before, "Catalogo reale e appuntamenti esistenti invariati");
  await pool.end();
}
