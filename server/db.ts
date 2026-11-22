import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../shared/schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL mancante: crea il database PostgreSQL di Replit (scheda Database) oppure impostalo nei Secrets.");
}

const needsSsl = /sslmode=require|neon\.tech|replit/.test(process.env.DATABASE_URL) && !/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL);

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.DB_POOL_MAX || 5), // pool piccolo: contiene i consumi su Replit
  idleTimeoutMillis: 30_000,
  ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
});

pool.on("error", (err) => console.error("[db] errore pool:", err.message));

export const db = drizzle(pool, { schema });
export type DB = typeof db;
export { schema };
