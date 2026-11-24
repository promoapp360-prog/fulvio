// Controllo esplicito e in sola lettura del database di sviluppo dell'app.
// Non applica migrazioni, non legge credenziali di produzione e non modifica dati.
import { pool } from "./db";
import { expectedColumns, findMissingColumns } from "./services/schema-check";

async function check() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const expected = expectedColumns();
    const { rows } = await client.query<{ table_name: string; column_name: string }>(
      "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'",
    );
    const missing = findMissingColumns(expected, rows);
    await client.query("ROLLBACK");
    if (missing.length) {
      console.error(`Schema non allineato: mancano ${missing.length} colonne richieste dall'app.`);
      for (const column of missing) console.error(`- ${column.table_name}.${column.column_name}`);
      process.exitCode = 1;
    } else {
      console.info(`Schema verificato: ${new Set(expected.map(column => column.table_name)).size} tabelle, ${expected.length} colonne presenti.`);
    }
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    client.release();
  }
}

check().catch(error => {
  console.error("Controllo schema fallito:", error.message);
  process.exitCode = 1;
}).finally(() => pool.end());
