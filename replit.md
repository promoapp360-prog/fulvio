# Dog's Planet – note per Replit

Progetto PromoApp: sito pubblico + PWA + area clienti + gestionale completo per Dog's Planet (Cernusco sul Naviglio).

- Avvio sviluppo: pulsante **Run** (esegue `npm install && npm run dev`, porta 5000).
- Database: PostgreSQL dedicato di Replit tramite `DATABASE_URL`. Le migrazioni in `migrations/*.sql` si applicano da sole all'avvio in sviluppo. In produzione lo schema è gestito dalla pubblicazione Replit, senza DDL all'avvio.
- Pubblicazione: Deploy → Autoscale (build `npm run build`, run `npm start`).
- Tutta la documentazione è nel `README.md`.

## Applicazione Replit importata

- Il codice originale è in `artifacts/dogs-planet/` del progetto Replit, con struttura interna conservata.
- Workflow registrato: `artifacts/dogs-planet: web`; comando `pnpm --filter @workspace/dogs-planet run dev`, porta tramite `PORT`.
- Non ricostruire né ridisegnare l'app durante l'importazione. Poppins è il font richiesto.
- Usare solo database, Secrets e servizi dedicati a Dog's Planet; nessun dato o Admin trasferito dalla precedente chat.
- `ADMIN_INITIAL_PASSWORD` va fornita in modo sicuro, mai da esempi della documentazione. Il primo accesso con username `Admin` richiede il cambio password.
- Non collegare servizi facoltativi né pubblicare senza autorizzazione.
- Repository sorgente: `https://github.com/promoapp360-prog/fulvio.git`, branch `main`. Non usare force push.

## Identità visiva e shop

- La mascotte si chiama **Poppy** in tutta l'app. Non cambiarne muso, pelliccia o identità e non inventare altri cani o loghi.
- Conservare il logo ufficiale blu/turchese e la foto originale. I derivati puliti delle cinque illustrazioni rimuovono solo frammenti esterni della brand board; gli originali non vanno sovrascritti.
- Nome pubblico dello shop: **LaPappadiPoppy**, seguito da **Coming Soon** finché gli acquisti sono disabilitati. Conservare il backend e-commerce e la rotta `/pet-shop`; non abilitare gli acquisti senza richiesta.
- CTA esatta: **Richiedi la prenotazione on Line**, con **on Line** in colore contrastante.
- Il restyling autorizzato riguarda homepage, header e presentazione pubblica correlata: non riscrivere gestionale, autenticazione o dati.
