import assert from "node:assert/strict";
import { test } from "node:test";
import { isPendingRequest, layoutAgenda, planningStart, requestColor } from "../shared/agenda-planning";

test("planning: richieste arancioni e proposta mostrata una volta nel nuovo orario", () => {
  for (const status of ["richiesta", "in_valutazione", "proposta"]) assert.ok(isPendingRequest(status));
  assert.equal(isPendingRequest("confermata"), false);
  assert.equal(requestColor, "#ea580c");
  const row = { startAt: "2026-11-26T09:00:00Z", proposedStartAt: "2026-11-27T10:00:00Z", status: "proposta" };
  assert.equal(planningStart(row), row.proposedStartAt);
  assert.equal(planningStart({ ...row, status: "richiesta" }), row.startAt);
  assert.equal(planningStart({ ...row, proposedStartAt: null }), row.startAt);
});

test("planning compatto: appuntamenti contemporanei hanno corsie separate e target di almeno 44px", () => {
  const { cards, lanes } = layoutAgenda([
    { id: 1, minute: 600, durationMin: 60 }, { id: 2, minute: 600, durationMin: 30 },
    { id: 3, minute: 615, durationMin: 5 }, { id: 4, minute: 900, durationMin: 60 },
  ], 480, 1200, 420);
  assert.equal(lanes, 3);
  assert.equal(new Set(cards.map(a => a.id)).size, 4);
  assert.equal(cards.find(a => a.id === 4)?.lane, 0);
  assert.ok(cards.every(a => a.height >= 44 && a.top >= 0 && a.top + a.height <= 420));
  for (const first of cards) for (const second of cards) {
    if (first.id >= second.id || first.lane !== second.lane) continue;
    assert.ok(first.top + first.height <= second.top || second.top + second.height <= first.top);
  }
});

test("planning: i trattamenti all’ultimo orario restano cliccabili dentro la griglia", () => {
  const { cards } = layoutAgenda([{ id: 9, minute: 1195, durationMin: 5 }], 480, 1200, 360);
  assert.equal(cards[0].height, 44);
  assert.equal(cards[0].top + cards[0].height, 360);
});
