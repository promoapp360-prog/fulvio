import assert from "node:assert/strict";
import test from "node:test";
import { dateToRome, romeToDate } from "../server/time";
import { nextReminderWindow, nextReminderCheckAt, obsoleteReminder, reminderDueAt, reminderKey } from "../server/reminder-timing";
import { DEFAULT_TEMPLATES } from "../server/services/templates";
import { renderTemplate } from "../server/logic";

const at = romeToDate;
const early = at("2026-12-01", "09:00");
const local = (date: Date | null) => date ? { day: dateToRome(date).day, time: dateToRome(date).time } : null;

test("controlli sospesi fino alle 08:00, ogni minuto solo nella fascia di Roma", () => {
  assert.deepEqual(local(nextReminderCheckAt(at("2026-12-03", "07:59"))), { day: "2026-12-03", time: "08:00" });
  assert.deepEqual(local(nextReminderCheckAt(at("2026-12-03", "10:00"))), { day: "2026-12-03", time: "10:01" });
  assert.deepEqual(local(nextReminderCheckAt(at("2026-12-03", "19:59"))), { day: "2026-12-04", time: "08:00" });
  assert.deepEqual(local(nextReminderCheckAt(at("2026-12-03", "20:00"), 1000)), { day: "2026-12-04", time: "08:00" });
  assert.deepEqual(local(nextReminderCheckAt(at("2027-03-27", "23:00"))), { day: "2027-03-28", time: "08:00" });
  assert.deepEqual(local(nextReminderCheckAt(at("2027-10-30", "23:00"))), { day: "2027-10-31", time: "08:00" });
});

test("promemoria a 24 ore, mai per conferme entro o esattamente a 24 ore", () => {
  const start = at("2026-12-03", "15:30");
  assert.deepEqual(local(reminderDueAt(start, early)), { day: "2026-12-02", time: "15:30" });
  assert.equal(reminderDueAt(start, new Date(start.getTime() - 24 * 3600_000)), null);
  assert.equal(reminderDueAt(start, new Date(start.getTime() - 23 * 3600_000)), null);
  assert.ok(reminderDueAt(start, new Date(start.getTime() - 24 * 3600_000 - 1)));
  assert.equal(reminderDueAt(new Date("invalid"), early), null);
});

test("fuori fascia si anticipa entro le 20, senza tagliare il preavviso a meno di 24 ore", () => {
  for (const [time, expectedDay, expectedTime] of [
    ["07:30", "2026-12-01", "19:59"],
    ["08:00", "2026-12-02", "08:00"],
    ["19:59", "2026-12-02", "19:59"],
    ["20:00", "2026-12-02", "19:59"],
    ["22:30", "2026-12-02", "19:59"],
  ]) {
    const start = at("2026-12-03", time);
    const due = reminderDueAt(start, at("2026-11-29", "10:00"));
    assert.deepEqual(local(due), { day: expectedDay, time: expectedTime });
    assert.ok(start.getTime() - due!.getTime() >= 24 * 3600_000);
  }
  assert.equal(reminderDueAt(at("2026-12-03", "07:00"), at("2026-12-02", "06:00")), null);
});

test("fascia di invio Roma: inverno, estate, confini e rinvii notturni", () => {
  for (const day of ["2026-12-03", "2027-07-03"]) {
    for (const [time, expectedDay, expectedTime] of [
      ["07:59", day, "08:00"], ["08:00", day, "08:00"],
      ["19:59", day, "19:59"],
      ["20:00", day.slice(0, -2) + "04", "08:00"],
      ["23:59", day.slice(0, -2) + "04", "08:00"],
    ]) assert.deepEqual(local(nextReminderWindow(at(day, time))), { day: expectedDay, time: expectedTime });
  }
});

test("24 ore effettive attraverso i cambi di ora legale, non l'ora del server", () => {
  for (const day of ["2027-03-28", "2027-10-31"]) {
    const start = at(day, "10:30");
    const due = reminderDueAt(start, at("2027-01-01", "10:00"))!;
    assert.equal(start.getTime() - due.getTime(), 24 * 3600_000);
  }
  assert.deepEqual(local(reminderDueAt(at("2027-03-28", "08:30"), at("2027-03-20", "10:00"))),
    { day: "2027-03-26", time: "19:59" });
});

test("prima di SMTP si scartano vecchi orari, cancellazioni, scadenze e preferenze disattivate", () => {
  const now = at("2026-12-03", "10:00"), startAt = at("2026-12-04", "10:00");
  const a = { startAt, status: "confermata", active: true, commEmail: true };
  assert.equal(obsoleteReminder(startAt.getTime(), a, now), null);
  assert.ok(obsoleteReminder(startAt.getTime() - 60_000, a, now));
  for (const status of ["annullata", "richiesta", "attesa_pagamento", "completata", "proposta"])
    assert.ok(obsoleteReminder(startAt.getTime(), { ...a, status }, now));
  assert.ok(obsoleteReminder(startAt.getTime(), { ...a, active: false }, now));
  assert.ok(obsoleteReminder(startAt.getTime(), { ...a, commEmail: false }, now));
  assert.ok(obsoleteReminder(startAt.getTime(), a, startAt));
  assert.ok(obsoleteReminder(startAt.getTime(), undefined, now));
  assert.notEqual(reminderKey(1, now), reminderKey(1, startAt));
});

test("quattro email complete: nessun segnaposto residuo e richiesta non spacciata per conferma", () => {
  const vars = { nome: "Cliente", cane: "Poppy", servizio: "Lavaggio", data: "giovedì 3 dicembre, 15:30", operatore: "Operatore" };
  for (const key of ["registrazione", "richiesta_ricevuta", "appuntamento_confermato", "promemoria"]) {
    const t = DEFAULT_TEMPLATES[key];
    assert.ok(t.subject && t.body);
    assert.ok(!renderTemplate(t.body, vars).includes("{{"));
  }
  assert.match(DEFAULT_TEMPLATES.richiesta_ricevuta.body, /NON l'appuntamento/);
  assert.match(DEFAULT_TEMPLATES.registrazione.body, /verificare/);
  assert.match(DEFAULT_TEMPLATES.appuntamento_confermato.body, /confermato/);
  assert.match(DEFAULT_TEMPLATES.promemoria.body, /Via Leonardo da Vinci 86/);
});
