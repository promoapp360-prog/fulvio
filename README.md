# Dog's Planet – Pet Grooming

Software completo per **Dog's Planet** (Via Leonardo da Vinci 86, Cernusco sul Naviglio – MI), sviluppato da **PromoApp**:
sito pubblico, PWA installabile, area clienti, richieste di prenotazione, agenda multioperatore, CRM, schede cane,
listino dinamico, personale e compensi, incassi, self-service, Fidelity Card, shop con magazzino, pensione casalinga,
email e push, promozioni, statistiche, SEO, utenti e permessi, predisposizione all'importazione dei contatti privacy.

- Guida all'uso del gestionale: [`docs/GUIDA-GESTIONALE.md`](docs/GUIDA-GESTIONALE.md)
- Esiti dei test: [`docs/TEST.md`](docs/TEST.md)
- Dati fiscali, informative in bozza, inventario cookie e checklist pre-pubblicazione: [`docs/legal-readiness.md`](docs/legal-readiness.md).
- Listino e Fidelity, clienti Self-Service, recupero punti e scadenze: [`docs/fidelity-management.md`](docs/fidelity-management.md).

---

## 1. Tecnologie

- **Frontend:** React 18 + TypeScript + Tailwind CSS (Vite), wouter, TanStack Query
- **Backend:** Node.js 20 + Express + TypeScript (`tsx`), API REST
- **Database:** PostgreSQL di Replit, **Drizzle ORM**, migrazioni SQL versionate in `migrations/`
- **Sicurezza:** password **Argon2id**, sessioni su PostgreSQL (cookie httpOnly, scadenza, revoca), rate-limit e blocco dopo tentativi falliti, log accessi, audit log, controllo permessi lato server
- **File:** Replit Object Storage (immagini ottimizzate in WebP); cartella locale solo in sviluppo
- **Esportazioni:** Excel (exceljs) e PDF (pdfkit) con logo
- **Pagamenti on line:** Stripe Checkout (facoltativo, nessun dato di carta salvato)
- **Email:** SMTP configurabile, coda di invio con tentativi e log; **Push:** Web Push (VAPID)

## 2. Struttura

```
client/            Sito, area clienti e gestionale (React)
  public/brand/    Logo e mascotte ufficiali (ricavati dal brand board approvato)
  public/icons/    Icone PWA · public/sw.js service worker · public/offline.html
server/            API Express
  routes/          auth, public, account, admin/* (agenda, crm, catalogo, staff, cassa, shop, contenuti, marketing, statistiche, sistema)
  services/        disponibilità, appuntamenti, pagamenti, email (coda), push, fidelity, shop, consensi, esportazioni, storage
  logic.ts         calcoli puri (slot, quarti d'ora, punti, scadenze, consegne…) coperti dai test
  jobs.ts          job orari leggeri: coda email, promemoria, richiami periodici, scadenza punti
shared/            Schema Drizzle e costanti condivise
migrations/        0001_init.sql, 0002_documento_completo.sql (applicate in automatico all'avvio)
tests/             logic.test.ts (unit) · db/ (vincoli e integrità del database)
docs/              guida al gestionale ed esiti dei test
```

## 3. Messa in funzione su Replit

1. **Create Repl → Import from GitHub** → `https://github.com/promoapp360-prog/fulvio`.
2. Scheda **Database** → crea il **PostgreSQL**: Replit imposta `DATABASE_URL`.
3. Scheda **Secrets** → aggiungi almeno:

| Secret | Valore |
|---|---|
| `SESSION_SECRET` | stringa lunga e casuale |
| `ADMIN_INITIAL_PASSWORD` | password iniziale nuova, dedicata al progetto, da inserire esclusivamente nei Secrets |
| `ADMIN_EMAIL` | dogsplanetcernusco@gmail.com |
| `PUBLIC_URL` | indirizzo pubblico del sito, es. `https://dogsplanet.it` |

4. **Run**. Al primo avvio vengono create tabelle, l'amministratore **username `Admin`**, gli 11 servizi (senza prezzi), gli operatori Enmanuel, Martina e Ilaria con turni e competenze, le pagine del sito, i template email.
5. Vai su `/login`, entra con `Admin` e la password configurata nei Secrets: il sistema **obbliga a scegliere una nuova password**. Dopo il cambio puoi eliminare `ADMIN_INITIAL_PASSWORD` dai Secrets.

> Senza `ADMIN_INITIAL_PASSWORD` non viene creato nessun amministratore: nessuna credenziale predefinita insicura. La password non è salvata in chiaro né nel repository né nel database (solo hash Argon2id).

### Secrets facoltativi

| Secret | A cosa serve | Senza configurazione |
|---|---|---|
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | Invio reale delle email | Le email restano nel registro come "simulate" |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Notifiche push (`npx web-push generate-vapid-keys`) | Push disattivate |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Acconto/saldo on line. Webhook Stripe → `https://TUO-DOMINIO/api/webhooks/stripe` (eventi `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.expired`, `checkout.session.async_payment_failed`) | Solo pagamenti in negozio |
| `REPLIT_OBJECT_BUCKET` | Bucket Object Storage | Bucket predefinito del Repl |

### Pubblicazione

**Deploy → Autoscale** (configurato in `.replit`): build `npm install && npm run build`, avvio `npm start`.
Prima crea un bucket in **Object Storage** (nei deploy il disco non è persistente).
Le email di registrazione, richiesta ricevuta e conferma vengono accodate subito. Il promemoria è previsto **24 ore prima**, soltanto per appuntamenti confermati con sufficiente anticipo. Fuori dalla fascia **08:00–20:00 Europe/Rome** si anticipa all'ultimo minuto utile (19:59); la fascia vale anche per i ritentativi SMTP e segue l'ora legale. Se la conferma arriva troppo tardi per quel preavviso, resta la conferma immediata: non si genera un falso promemoria “24 ore prima”.

Il controllo promemoria avviene ogni minuto soltanto dalle 08:00 alle 20:00 di Roma mentre l'app è attiva; di notte il timer attende direttamente le 08:00 successive, senza interrogare gli appuntamenti. Anche il runner pianificabile salta il lavoro fuori fascia. Richiami e scadenze punti restano orari. Stato e coda sono persistenti, con protezione dai duplicati; appuntamenti annullati, già iniziati o spostati non ricevono vecchi promemoria. Sono rispettate preferenze email e template disattivati dall'admin, le cui personalizzazioni non vengono sovrascritte. Le email transazionali immediate restano indipendenti dalla fascia dei controlli promemoria.

**Limite Autoscale:** il server può fermarsi senza visite, quindi questi timer da soli non garantiscono invii puntuali. Serve una soluzione autorizzata: **Reserved VM** sempre attiva oppure esecuzione pianificata del comando `pnpm --filter @workspace/dogs-planet run jobs:reminders` con ambiente e database di produzione dedicati. Nessuna delle due viene attivata automaticamente; verificare costi e configurazione prima della pubblicazione. La pianificazione deve essere frequente (idealmente ogni minuto) e il runner non deve essere avviato come ulteriore servizio web.

SMTP Aruba: `smtps.aruba.it`, porta `465` SSL/TLS, utente e mittente `info@dogsplanet.it`; password soltanto in `SMTP_PASS` nei Secrets. Impostare `PUBLIC_URL` distintamente per sviluppo e produzione, affinché verifica email e recupero password usino il database corretto.

## 4. Sincronizzazione GitHub ↔ Replit

- Modifiche su GitHub → in Replit **Git → Pull**. Modifiche su Replit → **Git → Commit → Push**.
- Niente force push; evitare di modificare gli stessi file in contemporanea nei due posti.
- Modifiche al database: **aggiungere** un nuovo file `migrations/000N_descrizione.sql` (mai modificare quelli già applicati) e aggiornare `shared/schema.ts`. Le migrazioni si applicano da sole, una volta sola, in sviluppo. Per il PostgreSQL gestito da Replit, la pubblicazione applica le modifiche di schema alla produzione; l'app non esegue DDL all'avvio in produzione.

### Importazione nell'applicazione Replit registrata

In questo progetto il codice originale è in `artifacts/dogs-planet/`, senza riorganizzare `client/`, `server/`, `shared/`, migrazioni o test. Il workflow **artifacts/dogs-planet: web** avvia sia Express sia Vite sulla porta assegnata da Replit e serve sito e API dalla radice dell'anteprima.

Dal progetto Replit usare `pnpm --filter @workspace/dogs-planet run dev` (gestito dal workflow), `run check`, `run build` e `test`. Dalla directory dell'app usare `pnpm run <comando>`. Il nome del pacchetto è stato adattato al workspace, il codice dell'app non è stato ricostruito.

Vite e il relativo plugin React sono aggiornati perché la versione originale era bloccata dal controllo di sicurezza dei pacchetti. Sono stati corretti errori TypeScript nelle API originali; marchio, immagini, pagine e funzionalità sono conservati. Il font è Poppins come richiesto.

Database e Secrets devono appartenere esclusivamente a Dog's Planet. Non importare database, password o account da anteprime di chat o altri clienti. Stripe, SMTP, push e storage esterno richiedono configurazione dedicata e autorizzazione. Nessuna pubblicazione in produzione senza conferma.

## 5. Comandi

```bash
npm run dev        # sviluppo (porta 5000)
npm run build      # build del frontend
npm start          # produzione
npm test           # test della logica (slot, quarti d'ora, punti, scadenze, consegne, CSV, fuso orario…)
npm run test:db    # test del database: TEST_DATABASE_URL=<db vuoto> npm run test:db
npm run db:migrate # applica le migrazioni
npm run db:backup  # backup compresso in ./backups (ultimi 14)
npm run check      # controllo dei tipi TypeScript
```

## 6. Configurazioni e contenuti ancora da fornire

Funzioni complete nel codice ma che richiedono dati o credenziali prima dell'uso in produzione:

- **Listino prezzi** di Fulvio (i servizi sono creati "prezzo su richiesta"; le durate iniziali sono indicative).
- **Istruzioni definitive del self-service**, foto e video (Contenuti → Pagine).
- **SMTP** per l'invio reale delle email; **VAPID** per le push; **Stripe** per i pagamenti on line.
- **Costi e zone di consegna** dello shop (Impostazioni → Shop e consegne): non preimpostati.
- **Valore dei punti** Fidelity e regole di scadenza (Impostazioni → Fidelity): conversione disattivata finché non impostata.
- **Testi legali** (privacy, cookie, condizioni): base da far verificare al consulente.
- **Logo**: in uso il file ufficiale ad alta risoluzione fornito da Dog's Planet (PNG/WebP trasparente, versione bianca, icone PWA). Per stampe di grande formato resta consigliato il file vettoriale (SVG/AI/PDF).
- **Applicativo privacy per la rubrica WhatsApp**: non sviluppato in questa fase come richiesto; il CRM e il database sono predisposti a riceverne i dati (Privacy e consensi → Contatti da importare).

Contabilità gestionale e compensi collaboratori sono conteggi interni: non sostituiscono fatturazione elettronica, cedolini o adempimenti fiscali.
