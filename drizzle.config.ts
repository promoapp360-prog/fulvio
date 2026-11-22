import { defineConfig } from "drizzle-kit";
// Le migrazioni ufficiali sono i file SQL versionati in /migrations, applicati da server/migrate.ts.
// drizzle-kit è disponibile solo per ispezione (npx drizzle-kit studio).
export default defineConfig({
  dialect: "postgresql",
  schema: "./shared/schema.ts",
  dbCredentials: { url: process.env.DATABASE_URL! },
});
