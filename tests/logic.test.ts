// Test della logica di calcolo. Esecuzione: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  freeSlots, shiftWindows, subtractInterval, roundMinutes, workAmountCents, rawWorkedMinutes, settlementWeek, pointsExpiry, pointsFor,
  consumeLots, pointsToReverse, withinDeadline, deliveryQuote, normalizePhone, averageGapDays, parseCsv, renderTemplate,
} from "../server/logic";
import { romeToDate, dateToRome, addDays, weekdayOf } from "../server/time";

const m = (h: number, mi = 0) => h * 60 + mi;

test("6/7 – disponibilità: slot dentro il turno e senza sovrapposizioni", () => {
  const work = shiftWindows(m(8, 45), m(19));
  const busy: [number, number][] = [[m(10), m(11)]];
  const slots = freeSlots(work, busy, 60, 30);
  assert.equal(slots[0], m(8, 45));
  assert.ok(!slots.includes(m(9, 15)), "09:15-10:15 si sovrappone a 10-11");
  assert.ok(!slots.includes(m(10, 15)));
  assert.ok(slots.includes(m(11, 15)));
  assert.equal(slots.at(-1), m(17, 45), "ultimo slot che finisce entro le 19:00");
});

test("6 – pausa e assenza parziale riducono le finestre", () => {
  const w = shiftWindows(m(9), m(19), m(13), m(14));
  assert.deepEqual(w, [[m(9), m(13)], [m(14), m(19)]]);
  assert.deepEqual(subtractInterval(w, [m(16), m(17)]), [[m(9), m(13)], [m(14), m(16)], [m(17), m(19)]]);
  // Ilaria: sabato 09-13, servizio da 60' con griglia 15'
  assert.equal(freeSlots([[m(9), m(13)]], [], 60, 15).length, 13);
});

test("22/23 – ore lavorate al quarto d'ora e compensi (esempi del documento)", () => {
  const rate = 1000; // 10 €/h
  assert.equal(workAmountCents(60, rate), 1000);
  assert.equal(workAmountCents(30, rate), 500);
  assert.equal(workAmountCents(15, rate), 250);
  assert.equal(workAmountCents(7 * 60 + 45, rate), 7750);
  assert.equal(roundMinutes(52, 15, "vicino"), 45);
  assert.equal(roundMinutes(53, 15, "vicino"), 60);
  assert.equal(roundMinutes(59, 15, "difetto"), 45);
  assert.equal(roundMinutes(46, 15, "eccesso"), 60);
  const raw = rawWorkedMinutes("08:45", "17:30", 60); // 7h45
  assert.equal(raw, 465);
  assert.equal(workAmountCents(roundMinutes(raw), rate), 7750);
  assert.throws(() => rawWorkedMinutes("10:00", "09:00", 0));
});

test("24 – settimana di liquidazione che termina il sabato", () => {
  assert.deepEqual(settlementWeek("2026-11-18"), { start: "2026-11-15", end: "2026-11-21" }); // mercoledì
  assert.deepEqual(settlementWeek("2026-11-21"), { start: "2026-11-15", end: "2026-11-21" }); // sabato stesso
  assert.deepEqual(settlementWeek("2026-11-22"), { start: "2026-11-22", end: "2026-11-28" }); // domenica
});

test("14 – accumulo punti", () => {
  assert.equal(pointsFor(4550, 1), 45);
  assert.equal(pointsFor(4550, 1, 1), 91);
  assert.equal(pointsFor(1000, 0.5), 5);
  assert.equal(pointsFor(0, 1), 0);
});

test("16 – scadenza punti: annuale, fissa 31/12, periodo", () => {
  const d = new Date("2026-03-10T10:00:00Z");
  assert.equal(pointsExpiry(d, { mode: "annuale" })!.toISOString().slice(0, 10), "2027-03-10");
  assert.equal(pointsExpiry(d, { mode: "fissa", fixedDate: "12-31" })!.toISOString().slice(0, 10), "2026-12-31");
  assert.equal(pointsExpiry(new Date("2026-12-31T23:30:00Z"), { mode: "fissa", fixedDate: "12-31" })!.toISOString().slice(0, 10), "2027-12-31");
  assert.equal(pointsExpiry(d, { mode: "periodo", days: 180 })!.toISOString().slice(0, 10), "2026-09-06");
  assert.equal(pointsExpiry(d, { mode: "nessuna" }), null);
});

test("15 – utilizzo punti FIFO (prima i lotti in scadenza)", () => {
  const lots = [
    { id: 1, remaining: 30, expiresAt: new Date("2027-06-01"), createdAt: new Date("2026-06-01") },
    { id: 2, remaining: 50, expiresAt: new Date("2026-12-31"), createdAt: new Date("2026-07-01") },
    { id: 3, remaining: 20, expiresAt: null, createdAt: new Date("2026-01-01") },
  ];
  assert.deepEqual(consumeLots(lots, 60), [{ id: 2, take: 50 }, { id: 1, take: 10 }]);
  assert.throws(() => consumeLots(lots, 101), /insufficienti/);
});

test("17 – storno punti dopo rimborso", () => {
  assert.equal(pointsToReverse(50, 0, 2500, 5000), 25);
  assert.equal(pointsToReverse(50, 25, 5000, 5000), 25, "non si storna più di quanto accreditato");
  assert.equal(pointsToReverse(50, 50, 100, 5000), 0);
});

test("23 – termine per cancellare", () => {
  const now = new Date("2026-11-22T10:00:00Z");
  assert.equal(withinDeadline(new Date("2026-11-23T10:00:00Z"), 24, now), true);
  assert.equal(withinDeadline(new Date("2026-11-23T09:59:00Z"), 24, now), false);
});

test("17 – consegna: zona per CAP, soglia di gratuità", () => {
  const zones = [{ name: "Cernusco", caps: ["20063"], costCents: 300, freeFromCents: 4000, eta: "24h" }, { name: "Spenta", caps: ["20090"], costCents: 1, active: false }];
  assert.deepEqual(deliveryQuote(zones, "20063", 2000), { zone: "Cernusco", costCents: 300, eta: "24h" });
  assert.equal(deliveryQuote(zones, "20063", 4000)!.costCents, 0);
  assert.equal(deliveryQuote(zones, "20090", 100), null);
  assert.equal(deliveryQuote(zones, "00100", 100), null);
});

test("CRM – normalizzazione telefono e frequenza", () => {
  assert.equal(normalizePhone("+39 389 908 2610"), "3899082610");
  assert.equal(normalizePhone("0039-3899082610"), "3899082610");
  assert.equal(normalizePhone("389.9082610"), "3899082610");
  assert.equal(averageGapDays([new Date("2026-01-01"), new Date("2026-01-31"), new Date("2026-03-02")]), 30);
});

test("25 – CSV con separatore ; e campi tra virgolette", () => {
  const rows = parseCsv('﻿nome;email;note\r\nMario;m@x.it;"ciao; ""amico"""\n\nLuca;l@x.it;');
  assert.deepEqual(rows, [["nome", "email", "note"], ["Mario", "m@x.it", 'ciao; "amico"'], ["Luca", "l@x.it", ""]]);
  assert.deepEqual(parseCsv("a,b\n1,2"), [["a", "b"], ["1", "2"]]);
});

test("19 – template email", () => {
  assert.equal(renderTemplate("Ciao {{nome}}, {{ data }}{{mancante}}", { nome: "Ada", data: "lunedì" }), "Ciao Ada, lunedì");
});

test("fuso orario Europe/Rome (ora legale/solare)", () => {
  assert.equal(romeToDate("2026-07-01", "09:00").toISOString(), "2026-07-01T07:00:00.000Z");
  assert.equal(romeToDate("2026-12-01", "09:00").toISOString(), "2026-12-01T08:00:00.000Z");
  assert.deepEqual(dateToRome(new Date("2026-10-25T08:30:00Z")), { day: "2026-10-25", time: "09:30", weekday: 0 });
  assert.equal(addDays("2026-02-28", 1), "2026-03-01");
  assert.equal(weekdayOf("2026-11-21"), 6);
});
