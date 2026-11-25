import assert from "node:assert/strict";
import test from "node:test";
import { normalizeOneSignalSettings, oneSignalReminderAt, renderOneSignalText } from "../server/services/onesignal-core";

test("OneSignal usa il dominio Replit e lascia il marketing spento per impostazione iniziale", () => {
  const defaults = normalizeOneSignalSettings({});
  assert.equal(defaults.enabled, true);
  assert.equal(defaults.expectedOrigin, "https://dogs-planet.replit.app");
  assert.equal(defaults.automations.marketing.enabled, false);
  assert.equal(defaults.automations.reminder.enabled, true);
});

test("il testo sostituisce solo i segnaposto noti senza esporre oggetti", () => {
  assert.equal(renderOneSignalText("Ciao {{nome}}, {{cane}} è pronto", { nome: "Ada", cane: "Poppy", altro: "non usato" }), "Ciao Ada, Poppy è pronto");
  assert.equal(renderOneSignalText("Ciao {{nome}}", { nome: null }), "Ciao");
});

test("programma il promemoria entro la fascia di Roma, anticipando se cade fuori orario", () => {
  const daytime = oneSignalReminderAt(new Date("2026-11-27T10:00:00Z"), new Date("2026-11-25T10:00:00Z"), 24);
  assert.equal(daytime?.toISOString(), "2026-11-26T10:00:00.000Z");
  const early = oneSignalReminderAt(new Date("2026-11-27T05:00:00Z"), new Date("2026-11-25T00:00:00Z"), 24);
  assert.equal(early?.toISOString(), "2026-11-25T18:59:00.000Z");
  const late = oneSignalReminderAt(new Date("2026-11-27T22:00:00Z"), new Date("2026-11-25T00:00:00Z"), 24);
  assert.equal(late?.toISOString(), "2026-11-26T18:59:00.000Z");
});

test("non invia un promemoria scaduto o con meno del tempo impostato", () => {
  assert.equal(oneSignalReminderAt(new Date("2026-11-26T12:00:00Z"), new Date("2026-11-25T12:00:00Z"), 24), null);
  assert.equal(oneSignalReminderAt(new Date("2026-11-27T12:00:00Z"), new Date("2026-11-26T13:00:00Z"), 24), null);
});

test("fasce orarie Admin e testi personalizzati sono normalizzati e limitati", () => {
  const config = normalizeOneSignalSettings({ enabled: true, quietHoursStart: 6, quietHoursEnd: 22, automations: {
    appointmentConfirmed: { enabled: false, title: "A".repeat(200), body: "B".repeat(700) },
  } });
  assert.equal(config.enabled, true);
  assert.equal(config.quietHoursStart, 6);
  assert.equal(config.quietHoursEnd, 22);
  assert.equal(config.automations.appointmentConfirmed.enabled, false);
  assert.equal(config.automations.appointmentConfirmed.title.length, 160);
  assert.equal(config.automations.appointmentConfirmed.body.length, 500);
});
