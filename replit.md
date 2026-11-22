# Dog's Planet – note per Replit

Progetto PromoApp: sito pubblico + PWA + area clienti + gestionale completo per Dog's Planet (Cernusco sul Naviglio).

- Avvio sviluppo: pulsante **Run** (esegue `npm install && npm run dev`, porta 5000).
- Database: PostgreSQL di Replit tramite `DATABASE_URL` (Secrets). Le migrazioni in `migrations/*.sql` si applicano da sole all'avvio.
- Pubblicazione: Deploy → Autoscale (build `npm run build`, run `npm start`).
- Tutta la documentazione è nel `README.md`.
