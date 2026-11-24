import assert from "node:assert/strict";
import test from "node:test";
import { expectedColumns, findMissingColumns } from "../server/services/schema-check";

test("schema: rileva colonne mancanti anche se il registro migrazioni è completo", () => {
  const expected = [
    { table_name: "users", column_name: "id" },
    { table_name: "dogs", column_name: "species" },
    { table_name: "guest_dogs", column_name: "species" },
    { table_name: "guest_bookings", column_name: "estimated_price_cents" },
  ];
  const missing = new Set(["dogs.species", "guest_dogs.species", "guest_bookings.estimated_price_cents"]);
  const actual = expected.filter(column => !missing.has(`${column.table_name}.${column.column_name}`));
  assert.deepEqual(
    findMissingColumns(expected, actual).map(column => `${column.table_name}.${column.column_name}`).sort(),
    [...missing].sort(),
  );
});

test("schema: accetta lo schema completo e non elimina colonne extra", () => {
  const expected = expectedColumns();
  assert.ok(expected.length > 0);
  assert.deepEqual(findMissingColumns(expected, [...expected, { table_name: "legacy", column_name: "retained" }]), []);
});
