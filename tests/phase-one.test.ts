import test from "node:test";
import assert from "node:assert/strict";
import { PUBLIC_COPY, publicText } from "../shared/public-copy";
import { reviewSettingsSchema, safeSocialUrl } from "../shared/reviews";
import { googleReviewSummary } from "../server/services/reviews";

test("testi pubblici: online, hashtag unico, contatto nuovo ed elisione richiesta", () => {
  assert.equal(publicText("on Line e acquisti LaPappadiPoppy #LaPappadiPoppy dogsplanetcernusco@gmail.com"),
    "online ed acquisti #LaPappadiPoppy #LaPappadiPoppy info@dogsplanet.it");
  assert.equal(publicText(publicText(PUBLIC_COPY.shop)), publicText(PUBLIC_COPY.shop));
  assert.equal(PUBLIC_COPY.steps.length, 3);
  assert.equal(PUBLIC_COPY.steps[0], "Accedi o registrati");
});

test("recensioni: nessun dato inventato, limiti e immagini interne validate", () => {
  const empty = { count: null, rating: null, googleUrl: "", googlePlaceId: "", images: [] };
  assert.equal(reviewSettingsSchema.safeParse(empty).success, true);
  assert.equal(reviewSettingsSchema.safeParse({ ...empty, count: -1 }).success, false);
  assert.equal(reviewSettingsSchema.safeParse({ ...empty, rating: 5.1 }).success, false);
  assert.equal(reviewSettingsSchema.safeParse({ ...empty, images: [{ url: "https://tracking.example/x.png", alt: "" }] }).success, false);
  assert.equal(reviewSettingsSchema.safeParse({ ...empty, images: [{ url: "/files/media/review-test.webp", alt: "Recensione" }] }).success, true);
  assert.equal(safeSocialUrl("javascript:alert(1)"), "");
  assert.equal(safeSocialUrl("https://example.com/profile"), "https://example.com/profile");
  assert.equal(safeSocialUrl("https://user:secret@example.com"), "");
  assert.equal(safeSocialUrl(""), "");
});

test("integrazione futura Google: solo campi riepilogo, chiave lato server, dati verificati", async () => {
  let requested = "";
  const request = (async (url: any, options: any) => {
    requested = String(url);
    assert.equal(options.headers["X-Goog-Api-Key"], "test-key-only");
    assert.equal(options.headers["X-Goog-FieldMask"], "rating,userRatingCount,googleMapsUri");
    return new Response(JSON.stringify({ rating: 4.8, userRatingCount: 12, googleMapsUri: "https://maps.google.com/test" }));
  }) as typeof fetch;
  const summary = await googleReviewSummary("place/id", "test-key-only", request);
  assert.match(requested, /place%2Fid$/);
  assert.deepEqual(summary, { count: 12, rating: 4.8, googleUrl: "https://maps.google.com/test" });
  await assert.rejects(() => googleReviewSummary("id", "test-key-only", (async () => new Response("{}", { status: 403 })) as typeof fetch));
  await assert.rejects(() => googleReviewSummary("id", "test-key-only", (async () => new Response(JSON.stringify({ rating: 9, userRatingCount: -5, googleMapsUri: "javascript:x" }))) as typeof fetch));
});
