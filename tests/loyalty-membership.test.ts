import test from "node:test";
import assert from "node:assert/strict";
import { addCalendarMonths, pointsExpiry } from "../server/logic";
import { memberPhone, cardTarget, walkInSchema } from "../shared/loyalty-membership";

test("Fidelity: default annuale = 12 mesi, senza perdere l'ora", () => {
  assert.equal(pointsExpiry(new Date("2026-11-25T09:35:00Z"), { mode: "annuale" })?.toISOString(), "2027-11-25T09:35:00.000Z");
});
test("Fidelity: fine mese e anno bisestile", () => {
  assert.equal(addCalendarMonths(new Date("2024-02-29T12:00:00Z"), 12).toISOString(), "2025-02-28T12:00:00.000Z");
  assert.equal(addCalendarMonths(new Date("2026-01-31T12:00:00Z"), 1).toISOString(), "2026-02-28T12:00:00.000Z");
});
test("Fidelity: le altre politiche rimangono disponibili", () => {
  assert.equal(pointsExpiry(new Date(), { mode: "nessuna" }), null);
  assert.equal(pointsExpiry(new Date("2026-01-01T00:00:00Z"), { mode: "periodo", days: 30 })?.toISOString(), "2026-01-31T00:00:00.000Z");
});
test("Self-Service: nome e telefono bastano, nessun account o consenso inventato", () => {
  const d = walkInSchema.parse({ firstName: "Prova", phone: "3331234567", requestKey: "00000000-0000-4000-8000-000000000001" });
  assert.equal(d.points, 0); assert.equal(d.separateContact, false); assert.equal(d.email, undefined);
});
test("Self-Service: rifiuta telefoni e movimenti iniziali non validi", () => {
  const d = { firstName: "Prova", phone: "abcdefghij", requestKey: "00000000-0000-4000-8000-000000000001" };
  assert.equal(walkInSchema.safeParse(d).success, false);
  for (const points of [-1, 0.5, 100001]) assert.equal(walkInSchema.safeParse({ ...d, phone: "3331234567", points }).success, false);
});
test("Self-Service: normalizza formati equivalenti senza unire persone", () => {
  assert.equal(memberPhone("+39 333 1234567"), memberPhone("0039 3331234567"));
  assert.equal(memberPhone("3331234567"), memberPhone("+39 333 1234567"));
  assert.equal(memberPhone("+39 02 12345678"), "0212345678");
});
test("Fidelity: gli endpoint accettano il cliente storico oppure la tessera", () => {
  assert.equal(cardTarget.safeParse({}).success, false);
  assert.equal(cardTarget.safeParse({ cardId: -1 }).success, false);
  assert.equal(cardTarget.safeParse({ cardId: 2 }).success, true);
  assert.equal(cardTarget.safeParse({ customerId: 1 }).success, true);
});
