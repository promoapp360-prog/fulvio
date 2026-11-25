import { addDays, dateToRome, romeToDate } from "./time";

export const REMINDER_HOURS = 24;
const HOUR = 3_600_000;

/** Roma, inclusa l'ora legale. Le 20:00 sono il limite esclusivo. */
export function nextReminderWindow(now: Date): Date {
  const local = dateToRome(now);
  if (local.time < "08:00") return romeToDate(local.day, "08:00");
  if (local.time >= "20:00") return romeToDate(addDays(local.day, 1), "08:00");
  return now;
}

/** Almeno 24 ore prima; fuori fascia si anticipa all'ultimo minuto utile.
 * Se la conferma arriva dopo quell'istante, basta la conferma immediata:
 * non si inventa un promemoria "24 ore prima" già scaduto.
 */
export function reminderDueAt(startAt: Date, confirmedAt: Date): Date | null {
  if (!Number.isFinite(startAt.getTime()) || !Number.isFinite(confirmedAt.getTime())) return null;
  if (startAt.getTime() - confirmedAt.getTime() <= REMINDER_HOURS * HOUR) return null;
  let due = new Date(startAt.getTime() - REMINDER_HOURS * HOUR);
  const local = dateToRome(due);
  if (local.time < "08:00") due = romeToDate(addDays(local.day, -1), "19:59");
  else if (local.time >= "20:00") due = romeToDate(local.day, "19:59");
  return due.getTime() < confirmedAt.getTime() ? null : due;
}

export function reminderKey(id: number, startAt: Date) {
  return `reminder:${id}:${startAt.getTime()}`;
}

/** Controllato nuovamente prima di ogni tentativo SMTP, compresi i reinvii. */
export function obsoleteReminder(
  expectedStart: number | undefined,
  appointment: { startAt: Date; status: string; active: boolean; commEmail: boolean } | undefined,
  now: Date,
): string | null {
  if (!appointment || appointment.status !== "confermata") return "Appuntamento non più confermato";
  if (!appointment.active || !appointment.commEmail) return "Invio email disattivato per il cliente";
  if (appointment.startAt.getTime() <= now.getTime()) return "Appuntamento già iniziato";
  if (expectedStart !== undefined && appointment.startAt.getTime() !== expectedStart) return "Orario modificato: promemoria superato";
  return null;
}
