import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Admin operativo: nessuna lista, dettaglio o azione per richieste ospite", () => {
  const agenda = source("client/src/pages/admin/Agenda.tsx");
  assert.doesNotMatch(agenda, /guest-requests|GuestBookingDetail|guest-bookings|guestId|confirmedGuests/);
  assert.match(agenda, /Solo clienti registrati/);
  assert.match(agenda, /AppointmentDetail/);
});

test("prenotazione: neanche i vecchi link con token saltano l’accesso", () => {
  const booking = source("client/src/pages/public/Booking.tsx");
  assert.doesNotMatch(booking, /guest-request-status|guest-requests|params\.get\("token"\)/);
  assert.match(booking, /if \(!me\)/);
  assert.match(booking, /Sono già cliente – Accedi/);
  assert.match(booking, /Diventa cliente – Registrati/);
});

test("ogni fase del modulo appuntamento riporta l’utente in cima", () => {
  const booking = source("client/src/pages/public/Booking.tsx");
  assert.match(booking, /window\.scrollTo\(\{ top: 0, left: 0, behavior: "instant" \}\);\s*\}, \[step\]\)/);
});

test("contatori operativi escludono le richieste storiche ospite", () => {
  const stats = source("server/routes/admin/stats.ts");
  assert.match(stats, /0::int as pending_guest/);
  assert.doesNotMatch(stats, /from guest_bookings/);
  assert.match(stats, /as actionable_requests/);
});

test("lo storico CRM resta esplicitamente un archivio, non un percorso di prenotazione", () => {
  assert.match(source("client/src/pages/admin/Crm.tsx"), /Archivio storico ospiti/);
  assert.match(source("client/src/pages/admin/Crm.tsx"), /Non permette nuove richieste o approvazioni/);
});

test("le richieste ospite non approvate non riservano più capacità; gli impegni già confermati restano protetti", () => {
  assert.match(source("server/services/availability.ts"), /const guestStatuses = \["confermata"\]/);
});
