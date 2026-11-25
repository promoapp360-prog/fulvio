// Comando per un'esecuzione pianificata autorizzata. Non avvia sito, seed o migrazioni.
import { db, pool } from "./db";
import { sendReminders } from "./jobs";
import { processQueue } from "./services/email";
import { nextReminderWindow } from "./reminder-timing";

try {
  const now = new Date();
  const next = nextReminderWindow(now);
  if (next.getTime() > now.getTime()) {
    console.log(JSON.stringify({ skipped: true, reason: "Fuori fascia 08:00–20:00 Europe/Rome", nextCheckAt: next.toISOString() }));
  } else {
    const queued = await sendReminders(now, db, false);
    await processQueue();
    console.log(JSON.stringify({ queuedReminders: queued, timeZone: "Europe/Rome" }));
  }
} catch {
  console.error("Esecuzione promemoria non completata: controllare il registro email.");
  process.exitCode = 1;
} finally {
  await pool.end();
}
