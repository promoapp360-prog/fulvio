import assert from "node:assert/strict";
import { test } from "node:test";
import { treatmentDurationInput, treatmentServiceIds } from "../shared/treatment-duration";

test("durata effettiva: interi da 1 a 600 oppure rimozione esplicita", () => {
  for (const value of [1, 75, 600, null]) assert.ok(treatmentDurationInput.safeParse({ actualDurationMin: value }).success);
  for (const value of [0, -1, 601, 4.5, "75", undefined, NaN, Infinity]) {
    assert.equal(treatmentDurationInput.safeParse({ actualDurationMin: value }).success, false);
  }
  assert.equal(treatmentDurationInput.safeParse({ actualDurationMin: 75, durationMin: 100 }).success, false);
});

test("identità trattamento: insieme servizi normalizzato, compatibile con appuntamenti singoli preesistenti", () => {
  assert.deepEqual(treatmentServiceIds({ serviceId: 9 }), [9]);
  assert.deepEqual(treatmentServiceIds({ serviceId: 9, requestedServiceIds: [] }), [9]);
  assert.deepEqual(treatmentServiceIds({ serviceId: 9, requestedServiceIds: [9, 2, 9] }), [2, 9]);
});
