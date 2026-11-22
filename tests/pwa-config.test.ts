import test from "node:test";
import assert from "node:assert/strict";
import { createECDH } from "node:crypto";
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { validPushEndpoint, validateVapid } from "../server/services/push-config";

test("Push: assenza, coppia incompleta o chiavi invalide non abilitano il servizio", () => {
  for (const config of [{}, { VAPID_PUBLIC_KEY: "partial" }, { VAPID_PUBLIC_KEY: "invalid", VAPID_PRIVATE_KEY: "invalid" }]) {
    assert.deepEqual(validateVapid(config), { configured: false, publicKey: null });
  }
});
test("Push: la chiave privata deve corrispondere esattamente a quella pubblica", () => {
  // Chiavi effimere soltanto di test; non sono configurazione dell'app.
  const a = createECDH("prime256v1"), b = createECDH("prime256v1"); a.generateKeys(); b.generateKeys();
  const valid = { VAPID_PUBLIC_KEY: a.getPublicKey().toString("base64url"), VAPID_PRIVATE_KEY: a.getPrivateKey().toString("base64url") };
  assert.equal(validateVapid(valid).configured, true);
  assert.equal(validateVapid({ ...valid, VAPID_PRIVATE_KEY: b.getPrivateKey().toString("base64url") }).configured, false);
});
test("Push: URL locali, credenziali e provider arbitrari non sono ammessi", () => {
  for (const endpoint of ["http://localhost/push", "https://127.0.0.1/", "https://example.com/", "https://fcm.googleapis.com.evil.test/", "https://user:pass@fcm.googleapis.com/send"]) assert.equal(validPushEndpoint(endpoint), false);
  for (const endpoint of ["https://fcm.googleapis.com/fcm/send/test", "https://updates.push.services.mozilla.com/wpush/test", "https://web.push.apple.com/test", "https://wns2.notify.windows.com/w"]) assert.equal(validPushEndpoint(endpoint), true);
});
test("PWA: manifest coerente, icone reali e area sicura maskable", async () => {
  const root = new URL("../client/public/", import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL("manifest.webmanifest", root), "utf8"));
  assert.equal(manifest.id, "/"); assert.equal(manifest.scope, "/"); assert.equal(manifest.display, "standalone");
  for (const icon of manifest.icons) {
    const image = await sharp(readFileSync(new URL(icon.src.slice(1), root))).metadata();
    assert.equal(`${image.width}x${image.height}`, icon.sizes);
    if (icon.purpose === "maskable") {
      const { data, info } = await sharp(readFileSync(new URL(icon.src.slice(1), root))).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
        const i = (y * info.width + x) * 4;
        if (Math.max(Math.abs(data[i] - 230), Math.abs(data[i + 1] - 247), Math.abs(data[i + 2] - 255)) > 3) {
          assert((x - 255.5) ** 2 + (y - 255.5) ** 2 <= (512 * 0.4) ** 2, "Simbolo fuori dall'area sicura");
        }
      }
    }
  }
});
test("Marchio: logo ufficiale trasparente e Poppy con colori originali", async () => {
  const root = new URL("../client/public/brand/", import.meta.url);
  const logo = await sharp(readFileSync(new URL("logo.png", root))).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(logo.data[3], 0);
  for (const kind of ["toelettatura", "self-service", "pensione", "fidelity", "pet-shop"]) {
    const original = await sharp(readFileSync(new URL(`poppy-${kind}-detail.png`, root))).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const cutout = await sharp(readFileSync(new URL(`poppy-${kind}-transparent.png`, root))).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.equal(cutout.info.width, original.info.width); assert.equal(cutout.info.height, original.info.height);
    let transparent = 0, visible = 0;
    for (let i = 0; i < cutout.data.length; i += 4) {
      if (!cutout.data[i + 3]) { transparent++; continue; }
      visible++;
      assert.deepEqual(cutout.data.subarray(i, i + 3), original.data.subarray(i, i + 3), `Colori modificati: ${kind}`);
    }
    assert(transparent > 100, `Manca trasparenza: ${kind}`); assert(visible > 5000, `Sagoma mancante: ${kind}`);
  }
});
