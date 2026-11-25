import test from "node:test";
import assert from "node:assert/strict";
import { isValidPriceRange, selectServicePricingRule } from "../shared/service-pricing";

test("regole prezzo: sceglie la combinazione più specifica per taglia e mantello", () => {
  const rules = [
    { id: 1, size: null, coatType: null, coatLength: null, priceCents: 2000 },
    { id: 2, size: "media", coatType: null, coatLength: null, priceCents: 3500 },
    { id: 3, size: "media", coatType: "riccio", coatLength: "lungo", priceCents: 5000 },
  ];
  const selected = selectServicePricingRule(rules, { size: "media", coatType: "Riccio", coatLength: "lungo" });
  assert.equal(selected?.id, 3);
  assert.equal(selectServicePricingRule(rules, { size: "media", coatType: "liscio", coatLength: "corto" })?.id, 2);
  assert.equal(selectServicePricingRule(rules, { size: "gigante", coatType: "liscio" })?.id, 1);
});

test("regole prezzo: non abbina caratteristiche mancanti e ignora regole disattivate", () => {
  const rules = [
    { id: 1, size: "media", coatType: "riccio", coatLength: null, active: true },
    { id: 2, size: "media", coatType: null, coatLength: null, active: false },
  ];
  assert.equal(selectServicePricingRule(rules, { size: "media" }), null);
});

test("fasce prezzo: accetta valori validi e rifiuta massimo senza minimo o invertito", () => {
  assert.equal(isValidPriceRange(500, 1000), true);
  assert.equal(isValidPriceRange(1000, 500), false);
  assert.equal(isValidPriceRange(null, 1000), false);
  assert.equal(isValidPriceRange(500, null), true);
});
