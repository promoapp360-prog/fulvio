import assert from "node:assert/strict";
import test from "node:test";
import { calendarDays, shiftCalendarMonth } from "../client/src/components/BookingCalendar";

test("calendario: settimana da lunedì, griglia completa e giorni senza duplicati", () => {
  const grid = calendarDays("2026-11-01");
  assert.deepEqual(grid.slice(0, 6), Array(6).fill(null));
  assert.equal(grid[6], "2026-11-01");
  assert.equal(grid.length % 7, 0);
  const days = grid.filter(Boolean);
  assert.equal(days.length, 30);
  assert.equal(new Set(days).size, days.length);
});

test("calendario: febbraio bisestile e cambio anno senza slittamenti di fuso", () => {
  assert.equal(calendarDays("2028-02-01").filter(Boolean).length, 29);
  assert.equal(calendarDays("2027-02-01").filter(Boolean).length, 28);
  assert.equal(shiftCalendarMonth("2026-12-01", 1), "2027-01-01");
  assert.equal(shiftCalendarMonth("2027-01-01", -1), "2026-12-01");
  assert.equal(calendarDays("2027-02-01")[0], "2027-02-01");
});
