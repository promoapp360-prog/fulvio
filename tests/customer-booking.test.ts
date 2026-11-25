import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { appointmentRequestSchema, bookingServiceIds, customerDogSchema, registrationSchema, calendarDay, isStripping } from "../shared/customer-booking";

const dog = { name: "Prova", species: "cane", breed: "Meticcio", size: "media", weightKg: "12.5", birthDate: "2021-03-15",
  coatType: "mosso", coatLength: "medio", food: { notes: "Secco abituale" }, jointIssues: "Nessuna", dermatitis: "Nessuna",
  intolerances: "Non note", sensitivities: "Nessuna", aggressive: false, otherNeeds: "Nessuna", otherPets: "Nessuno" };
const owner = { firstName: "Prova", lastName: "Verifica", email: "test@example.test", phone: "3330000000", password: "ProvaSicura123!",
  city: "Cernusco", province: "mi", cap: "20063", birthDate: "1990-01-01", consentPrivacy: true, consentMarketing: false, dog };
test("Registrazione completa senza marketing; niente indirizzo obbligatorio", () => {
  const result = registrationSchema.parse(owner);
  assert.equal(result.consentMarketing, false); assert.equal(result.province, "MI");
  assert.equal("address" in result, false);
});
for (const field of ["firstName", "lastName", "email", "phone", "city", "province", "cap", "birthDate", "password"]) {
  test(`Registrazione: ${field} obbligatorio`, () => assert.equal(registrationSchema.safeParse({ ...owner, [field]: "" }).success, false));
}
test("La privacy è obbligatoria alla registrazione, mai preselezionata dal server", () => {
  assert.equal(registrationSchema.safeParse({ ...owner, consentPrivacy: false }).success, false);
  const { consentPrivacy, ...missing } = owner;
  assert.equal(registrationSchema.safeParse(missing).success, false);
});
test("Password corta e date impossibili rifiutate", () => {
  assert.equal(registrationSchema.safeParse({ ...owner, password: "1234567" }).success, false);
  assert.equal(calendarDay.safeParse("2026-02-31").success, false);
  assert.equal(customerDogSchema.safeParse({ ...dog, birthDate: "2999-01-01" }).success, false);
});
for (const field of ["birthDate", "coatType", "coatLength", "breed"]) {
  test(`Scheda animale: ${field} obbligatorio`, () => assert.equal(customerDogSchema.safeParse({ ...dog, [field]: "" }).success, false));
}
test("Alimentazione obbligatoria e stato manto escluso dalla scheda cliente", () => {
  assert.equal(customerDogSchema.safeParse({ ...dog, food: {} }).success, false);
  const parsed = customerDogSchema.parse({ ...dog, coatKnots: true, coatShedding: true });
  assert.equal("coatKnots" in parsed, false); assert.equal("coatShedding" in parsed, false);
});
const catalog = [
  { id: 1, name: "Lavaggio", slug: "lavaggio-professionale", active: true, bookable: true, visible: true },
  { id: 2, name: "Stripping senza bagno", slug: "stripping-naturale" },
  { id: 3, name: "Bagno medio non online", slug: "fnt-2025-bagno-pelo-medio", bookable: false },
];
test("Stripping aggiunge un solo bagno realmente prenotabile, mai voci listino disabilitate", () => {
  assert.deepEqual(bookingServiceIds([2], catalog, "medio"), [2, 1]);
  assert.deepEqual(bookingServiceIds([2, 1, 1], catalog, "medio"), [2, 1]);
  assert.deepEqual([...catalog].sort((a, b) => Number(isStripping(a)) - Number(isStripping(b))).at(-1)?.id, 2);
  assert.throws(() => bookingServiceIds([2], catalog.filter(s => s.id !== 1)), /bagno attivo/);
});
test("Richiesta autenticata: nessun consenso ripetuto o operatore scelto; muta e nodi del giorno obbligatori", () => {
  const request = { dogId: 1, serviceIds: [1], date: "2026-12-01", time: "10:00", coatSheddingToday: false,
    coatKnotsToday: true, requestKey: "cc46b01d-80f7-49b2-b1c3-f6ca731c2d61" };
  const parsed = appointmentRequestSchema.parse(request);
  assert.equal("privacy" in parsed, false); assert.equal("marketing" in parsed, false); assert.equal("operatorId" in parsed, false);
  const { coatKnotsToday, ...missing } = request;
  assert.equal(appointmentRequestSchema.safeParse(missing).success, false);
  assert.equal(appointmentRequestSchema.safeParse({ ...request, time: "27:00" }).success, false);
});
test("PWA: invito solo dopo registrazione/richiesta; push solo dopo prima richiesta e scelta marketing", () => {
  const install = fs.readFileSync(new URL("../client/src/components/InstallPrompt.tsx", import.meta.url), "utf8");
  const push = fs.readFileSync(new URL("../client/src/components/PushPreferences.tsx", import.meta.url), "utf8");
  assert.match(install, /dp-install-eligible/); assert.doesNotMatch(install, /window\.scrollY|12000/);
  assert.match(install, /data-cookie-banner/); assert.match(push, /afterBooking && !!me\?\.consentMarketing/);
  assert.match(push, /permission === "default"/); assert.match(push, /push\/offer/);
});
test("I collegamenti di accesso e ritorno usano le rotte originali del progetto", () => {
  const booking = fs.readFileSync(new URL("../client/src/pages/public/Booking.tsx", import.meta.url), "utf8");
  const app = fs.readFileSync(new URL("../client/src/App.tsx", import.meta.url), "utf8");
  for (const route of ["/login", "/registrazione", "/richiedi-prenotazione"]) assert.ok(app.includes(`path="${route}"`));
  assert.match(booking, /\/login\?next=%2Frichiedi-prenotazione/);
  assert.match(booking, /\/registrazione\?next=%2Frichiedi-prenotazione/);
  assert.doesNotMatch(booking, /\/registrati|\/accedi|%2Fprenota/);
});
