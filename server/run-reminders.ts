// Comando per un'esecuzione pianificata autorizzata. Non avvia sito, seed o migrazioni.
import { db, pool } from "./db";
import { sendReminders } from "./jobs";
import { processQueue } from "./services/email";

try {
  const queued = await sendReminders(new Date(), db, false);
  await processQueue();
  console.log(JSON.stringify({ queuedReminders: queued, timeZone: "Europe/Rome" }));
} catch {
  console.error("Esecuzione promemoria non completata: controllare il registro email.");
  process.exitCode = 1;
} finally {
  await pool.end();
}
