# Dog's Planet – Pet Grooming

Software completo per **Dog's Planet** (Via Leonardo da Vinci 86, Cernusco sul Naviglio – MI), sviluppato da **PromoApp**.

Un'unica applicazione che comprende:

| Area | Cosa contiene |
|---|---|
| **Sito pubblico** | Home, Chi siamo, Toelettatura, Servizi e listino, Richiedi la prenotazione on Line, Self-Service, Pensione Casalinga, Fidelity Card, Pet Shop (in arrivo), Contatti con Google/Apple Maps, Privacy, Cookie, Condizioni. Tutti i testi sono modificabili dal gestionale. |
| **PWA** | Installabile su smartphone (Android e iPhone), funziona offline per le pagine già visitate, notifiche push. |
| **Area clienti** | Registrazione/login, più cani per cliente con scheda completa, richieste di prenotazione, proposte di modifica, richieste di modifica/cancellazione, storico trattamenti, Fidelity Card digitale, pensione, ordini, pagamenti, notifiche, preferenze privacy, download dei propri dati. |
| **Gestionale** | Dashboard, agenda multioperatore (giorno/settimana/mese, per operatore), richieste da confermare, CRM clienti e cani, campi personalizzati della scheda cane, servizi e listino dinamico (varianti per taglia, supplementi automatici), operatori/turni/pause/ferie/chiusure, ore lavorate e compensi, pagamenti e incassi, self-service, Fidelity, pensione, prodotti, ordini, magazzino, fornitori, contenuti del sito, promozioni e campagne email/push, statistiche, utenti e permessi, importazione contatti privacy, backup e registro operazioni. |

---

## 1. Tecnologie

- **Frontend:** React 18 + TypeScript + Tailwind CSS (Vite), wouter, TanStack Query
- **Backend:** Node.js 20 + Express + TypeScript (eseguito con `tsx`)
- **Database:** PostgreSQL di Replit, **Drizzle ORM**, migrazioni SQL versionate in `migrations/`
- **Autenticazione:** sessioni sicure su PostgreSQL (cookie httpOnly, password bcrypt, rate-limit sui login)
- **File:** Replit Object Storage (immagini ottimizzate in WebP), fallback su cartella locale in sviluppo
- **Pagamenti on line:** Stripe Checkout (facoltativo, nessun dato di carta salvato)
- **Email:** SMTP qualsiasi (es. Gmail con password per le app); **Push:** Web Push con chiavi VAPID

## 2. Struttura

```
client/            Sito, area clienti e gestionale (React)
  public/brand/    Logo e mascotte ufficiali (ricavati dal brand board approvato)
  public/icons/    Icone PWA
  public/sw.js     Service worker
server/            API Express
  routes/          auth, public, account, admin/*
  services/        disponibilità agenda, appuntamenti, pagamenti, email, push, fidelity, storage…
  migrate.ts       applicazione migrazioni
  seed.ts          dati iniziali (servizi, operatori, pagine)
shared/            Schema Drizzle e costanti condivise
migrations/        Migrazioni SQL versionate (fonte di verità del database)
```

## 3. Messa in funzione su Replit

1. Su Replit: **Create Repl → Import from GitHub** → `https://github.com/promoapp360-prog/fulvio`.
2. Apri la scheda **Database** e crea il database **PostgreSQL**: Replit imposta da solo `DATABASE_URL`.
3. Apri **Secrets** e aggiungi almeno:
   - `SESSION_SECRET` → una stringa lunga e casuale
   - `ADMIN_EMAIL` → email dell'amministratore (es. dogsplanetcernusco@gmail.com)
   - `ADMIN_PASSWORD` → password iniziale dell'amministratore (cambiala dopo il primo accesso)
   - `PUBLIC_URL` → l'indirizzo pubblico del sito (es. `https://dogsplanet.it`), usato nei link delle email
4. Premi **Run**. Al primo avvio vengono create le tabelle, l'amministratore, gli 11 servizi, gli operatori Enmanuel, Martina e Ilaria con turni e competenze, le pagine del sito e le FAQ del self-service.
5. Accedi da `/login` con le credenziali dell'amministratore: si apre il gestionale (`/admin`).

### Secrets facoltativi

| Secret | A cosa serve |
|---|---|
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | Invio reale delle email (senza, le email vengono solo registrate come "simulate" nel registro) |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Notifiche push. Generale una volta con `npx web-push generate-vapid-keys` nella Shell di Replit |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Pagamenti on line (acconto/saldo). Webhook da configurare su Stripe verso `https://TUO-DOMINIO/api/webhooks/stripe` con gli eventi `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.expired`, `checkout.session.async_payment_failed`. Poi attivali in *Impostazioni → Pagamenti* |
| `REPLIT_OBJECT_BUCKET` | ID del bucket Object Storage, se non si usa quello predefinito del Repl |

### Pubblicazione

**Deploy → Autoscale** (configurato in `.replit`): build `npm install && npm run build`, avvio `npm start`.
Prima della pubblicazione crea un bucket in **Object Storage**: nei deploy il disco non è persistente, quindi le immagini caricate devono stare lì.

> I promemoria del giorno prima partono da un controllo orario interno. Con Autoscale il controllo gira solo quando l'app è attiva; per promemoria sempre puntuali usare un deploy **Reserved VM**.

## 4. Sincronizzazione GitHub ↔ Replit

- Modifiche fatte su GitHub: in Replit apri **Git** → **Pull**.
- Modifiche fatte su Replit: **Git** → commit → **Push**.
- Evitare di modificare gli stessi file in contemporanea nei due posti; non usare mai il force push.
- Le modifiche al database vanno fatte **aggiungendo** un nuovo file `migrations/000N_descrizione.sql` (mai modificando quelli già applicati) e aggiornando `shared/schema.ts`. All'avvio vengono applicate in automatico, una sola volta.

## 5. Logica principale

### Richiesta di prenotazione (non automatica)
1. Il cliente sceglie cane → servizio → operatore compatibile (o "nessuna preferenza") → giorno → orario libero → note → **Invia**.
2. Messaggio: *"Richiesta inviata. Attendi la conferma di Dog's Planet."*
3. Dal gestionale: **Conferma**, **Rifiuta**, **Proponi un nuovo orario**, cambia operatore/durata/prezzo, **Richiedi pagamento**.
4. Stati: Richiesta ricevuta · In valutazione · Proposta di modifica · Confermata · In attesa pagamento · Completata · Annullata · Rifiutata · Cliente assente.

Garanzie tecniche: le disponibilità tengono conto di turni, pause, ferie, chiusure, durata per taglia e supplementi (nodi, muta…), intervallo tra appuntamenti e preavviso minimo. Due richieste contemporanee sullo stesso slot vengono serializzate con un lock sul database: la seconda riceve "slot appena occupato". Solo l'amministratore può autorizzare sovrapposizioni o orari fuori turno. Ogni passaggio è tracciato nello storico dell'appuntamento.

### Pagamenti
Modalità configurabile (nessun anticipo, acconto on line, saldo on line, in negozio) attivabile **dopo** la conferma. In negozio: contanti, POS, Satispay, bonifico istantaneo, bonifico ordinario, altri metodi personalizzati; acconti, saldi, parziali, rimborsi. Lo stesso pagamento non può essere contato due volte (vincolo univoco sul riferimento del provider, webhook idempotente, blocco dei doppi inserimenti manuali ravvicinati). Le registrazioni errate si annullano con motivazione, non si cancellano.

### Personale
Compenso iniziale 10 €/ora, modificabile per operatore e per singola giornata. Ore con entrata, uscita, pause, minuti effettivi, note; correzioni solo dall'amministratore con motivo obbligatorio; esportazione CSV; giornate segnabili come liquidate. Gli operatori collegati a un utente possono timbrare dal gestionale.

### Self-service
Pagina informativa (orari 08:00–22:00 tutti i giorni, istruzioni, shampoo, foto/video, FAQ – tutto modificabile). Incassi registrati manualmente per data, box, importo, metodo, categoria e note; nelle statistiche restano separati dalla toelettatura. Nessuna prenotazione dei box, nessuna integrazione con i distributori.

### Ruoli e permessi
- **Amministratore**: accesso completo.
- **Staff**: solo le sezioni abilitate (agenda, richieste, clienti, servizi, operatori, ore, pagamenti, self-service, fidelity, shop, magazzino, pensione, contenuti, marketing, statistiche, utenti, impostazioni).
- **Operatore**: la propria agenda e le proprie ore (più eventuali permessi aggiuntivi).
- **Cliente**: solo la propria area personale.

## 6. Contenuti da completare con Fulvio

- **Prezzi del listino**: i servizi sono creati senza prezzo ("prezzo su richiesta"), come richiesto. Le durate iniziali sono indicative e vanno verificate in *Servizi e listino*.
- **Istruzioni definitive del self-service**, foto e video (in *Contenuti sito*).
- **Testi legali** (privacy, cookie, condizioni): sono una base da far verificare al consulente.
- **Logo vettoriale originale**: il logo usato è ricavato fedelmente dal brand board fornito (PNG/WebP con sfondo trasparente). Per stampe di grande formato serve il file originale (SVG/AI/PDF).

## 7. Consumi e prestazioni

Pool di connessioni ridotto, paginazione su tutte le liste, cache breve sui contenuti pubblici, immagini ridimensionate e convertite in WebP all'upload, nessun polling continuo (aggiornamento agenda ogni 2 minuti solo a pagina aperta), un solo controllo orario per i promemoria, nessun servizio esterno a pagamento attivo senza configurazione esplicita.

## 8. Comandi utili

```bash
npm run dev        # sviluppo (porta 5000)
npm run build      # build del frontend
npm start          # produzione
npm run db:migrate # applica le migrazioni
npm run db:seed    # dati iniziali (idempotente)
npm run db:backup  # backup compresso in ./backups (ultimi 14)
npm run check      # controllo dei tipi TypeScript
```
