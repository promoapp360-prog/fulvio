import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { pool } from "./db";

const TABLES = [
  "users", "dog_custom_fields", "dogs", "services", "service_variants", "service_supplements", "operators", "operator_services", "operator_shifts",
  "operator_absences", "resources", "appointments", "appointment_events", "suppliers", "products", "stock_movements", "orders", "order_items",
  "payments", "work_logs", "selfservice_incomes", "loyalty_cards", "loyalty_transactions", "loyalty_rewards", "boarding_requests", "pages", "faqs",
  "media", "promotions", "campaigns", "privacy_contacts", "settings",
];

/** Esporta tutte le tabelle applicative (esclusi log tecnici e sessioni). */
export async function exportAll() {
  const out: Record<string, unknown> = { exportedAt: new Date().toISOString(), version: 1 };
  for (const t of TABLES) {
    const { rows } = await pool.query(`SELECT * FROM ${t} ORDER BY 1`);
    if (t === "users") rows.forEach((r) => { delete r.password_hash; delete r.reset_token; });
    out[t] = rows;
  }
  return out;
}

// npm run db:backup -> backups/backup-AAAA-MM-GG.json.gz (mantiene gli ultimi 14)
if (process.argv[1] && process.argv[1].endsWith("backup.ts")) {
  (async () => {
    const dir = path.resolve(process.cwd(), "backups");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `backup-${new Date().toISOString().slice(0, 10)}.json.gz`);
    fs.writeFileSync(file, zlib.gzipSync(JSON.stringify(await exportAll())));
    const old = fs.readdirSync(dir).filter((f) => f.startsWith("backup-")).sort().slice(0, -14);
    old.forEach((f) => fs.rmSync(path.join(dir, f)));
    console.log("Backup salvato in", file);
    await pool.end();
  })().catch((e) => { console.error(e); process.exit(1); });
}
