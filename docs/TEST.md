# Esiti dei test – Dog's Planet

## Aggiornamento delle PWA aperte e installate — 24/11/2026

- Ogni build genera una versione distinta del service worker, anche se cambia
  soltanto il codice dell'interfaccia.
- Il client verifica aggiornamenti all'avvio, quando torna visibile, al ritorno
  della connessione e ogni cinque minuti mentre è visibile e online.
- Quando cambia il worker di controllo, un avviso propone di ricaricare oppure
  rimandare. Nessun ricaricamento automatico dei moduli compilati.
- Cinque nuovi test verificano rilevamento, prima installazione senza falso
  avviso, controlli periodici, gestione offline e rimozione dei listener.
  Suite complessiva: 50 test superati; TypeScript e build superati.
- Verificata la versione generata nel worker di produzione compilato.
- Nessuna installazione fisica o passaggio fra due release su dispositivo reale
  eseguito. Le vecchie finestre prive del nuovo codice di rilevamento possono
  richiedere una prima riapertura/ricarica dopo la pubblicazione.
- Nessuna pubblicazione eseguita: le installazioni esistenti ricevono la release
  solo dopo il passaggio in produzione autorizzato.

## Ripristino schema di sviluppo — 24/11/2026

- Confrontate 57 tabelle e 685 colonne richieste dallo schema ORM: mancavano
  `dogs.species`, `guest_dogs.species` e `guest_bookings.estimated_price_cents`,
  pur risultando già registrata la migrazione che le introduceva.
- Applicata solo in sviluppo la migrazione additiva
  `0009_restore_missing_booking_columns.sql`. Nessuna riesecuzione delle
  migrazioni precedenti e nessuna modifica ai prezzi del catalogo.
- Confronto prima/dopo di conteggi e impronte dei dati preesistenti nelle tabelle
  utenti, animali, clienti ospiti, animali ospiti, richieste ospiti e appuntamenti:
  invariati, escludendo dal confronto i nuovi campi.
- `pnpm --filter @workspace/dogs-planet run db:check`: tutte le colonne presenti.
  Il comando controlla lo schema effettivo in sola lettura, non solo il registro.
- Query ORM sulle 57 tabelle e join di richieste ospiti/schede animali eseguiti
  senza errori. Le tre query mirate sono state provate con risultati vuoti:
  il controllo verifica compatibilità SQL, non prestazioni con dati reali.
- Controllo TypeScript, build e suite di 45 test superati.
- Nessun test browser autenticato eseguito; nessuna pubblicazione o modifica
  al database di produzione. La correzione live richiede il successivo passaggio
  di pubblicazione autorizzato, con revisione del diff dello schema.

## Restyling mirato homepage — 22/11/2026

- TypeScript e compilazione: superati. Suite di logica originale: 14/14 superati.
- Verifica browser a **390, 768, 1024, 1280 e 1440 px**: nessuno scorrimento orizzontale, cinque card e una sola foto nell'hero. Controllate visivamente homepage desktop/mobile e card.
- Header: voci desktop senza tagli o sovrapposizioni; hamburger su tablet/mobile, apertura e chiusura con Escape, chiusura dopo navigazione.
- Rotte aperte nel browser: `/toelettatura`, `/servizi`, `/self-service`, `/pensione-casalinga`, `/fidelity-card`, `/pet-shop`, `/chi-siamo`, `/contatti`, `/richiedi-prenotazione`, `/login`, `/registrazione`, `/account`, `/admin`. Documenti caricati senza errori JavaScript; gli ultimi due mantengono il controllo di accesso, non è un collaudo dei flussi autenticati.
- Pagina shop: titolo LaPappadiPoppy, sottotitolo Coming Soon, nessun carrello o pulsante d'ordine. API pubblica prodotti con `enabled: false` e lista vuota.
- API admin anonima: HTTP 401. Richiesta ordine senza origine: HTTP 403 dal controllo CSRF originale.
- Nessuna migrazione o modifica di dati; nessun intervento a prenotazioni, CRM, autenticazione o pagamenti. Nessuna immagine AI generata: foto e logo originali preservati, illustrazioni ripulite geometricamente in derivati separati.

## Importazione nell'applicazione Replit — 22/11/2026

Ambiente reale Replit, Node.js 24, PostgreSQL dedicato al progetto. Le limitazioni descritte nel resoconto storico qui sotto non valgono per questa verifica.

| Verifica eseguita | Esito |
|---|---|
| `pnpm --filter @workspace/dogs-planet run check` | Superato, nessun errore TypeScript |
| `pnpm --filter @workspace/dogs-planet run build` | Superato |
| `pnpm --filter @workspace/dogs-planet test` | 14/14 superati |
| Entrambe le migrazioni SQL originali su DB vuoto + `tests/db/checks.sql` | Superati in un'unica transazione, interamente annullata prima dell'inizializzazione reale |
| Applicazione effettiva migrazioni | `0001_init.sql` e `0002_documento_completo.sql` registrate |
| Avvio workflow registrato | Server avviato e anteprima visibile |
| Browser homepage | Sito originale, logo e immagini caricati; nessun errore console rilevato |
| `/login`, `/account`, `/admin` | Documento client servito correttamente; non equivale a verifica delle schermate autenticate |
| API health, impostazioni e servizi pubblici | HTTP 200; health `ok: true` |
| API statistiche admin senza sessione | HTTP 401 |
| Manifest PWA e service worker | HTTP 200 |
| Dati iniziali | Un Admin con cambio password obbligatorio, 11 servizi, 3 operatori; zero cani e appuntamenti |

Non sono stati eseguiti tutti i flussi autenticati della checklist, acquisti reali, invio SMTP/push o installazione PWA su dispositivi fisici. Nessun servizio esterno è stato collegato e non è stata eseguita alcuna pubblicazione in produzione.

---

## Resoconto storico fornito dal repository

Data esecuzione: 22/11/2026 · ambiente di sviluppo PromoApp (Linux, Node.js 22, PostgreSQL 16).

> Limite dell'ambiente: in questo ambiente non è possibile scaricare i pacchetti npm, quindi **l'applicazione non è stata avviata** (server e interfaccia non sono stati provati nel browser). I test end-to-end vanno eseguiti su Replit dopo `npm install` con la checklist in fondo. Nessun test è dichiarato superato se non è stato eseguito.

## Test automatici eseguiti

| Suite | Comando | Esito |
|---|---|---|
| Logica di calcolo (14 test) | `npm test` | **14/14 superati** |
| Migrazioni su database vuoto + vincoli di integrità (9 controlli) | `npm run test:db` | **superati** |
| Controllo sintassi di tutti i file TS/TSX | esbuild | **superato** |
| Risoluzione di import/export (server e client) | esbuild bundle | **superato** |

### Dettaglio test logica (`tests/logic.test.ts`)
Disponibilità con turni e senza sovrapposizioni · pause e assenze parziali · ore lavorate al quarto d'ora e compensi (60' = 10 €, 30' = 5 €, 15' = 2,50 €, 7 h 45' = 77,50 €) · settimana di liquidazione che termina il sabato · accumulo punti · scadenza punti (annuale, fissa 31/12, dopo un periodo) · utilizzo punti FIFO · storno punti dopo rimborso · termine per cancellare · consegna per CAP e soglia di gratuità · normalizzazione telefono e frequenza clienti · CSV con `;` e virgolette · template email · fuso orario Europe/Rome con ora legale/solare.

### Dettaglio test database (`tests/db/checks.sql`)
Username unico senza distinzione maiuscole · ruoli ammessi · orari appuntamento coerenti · stesso pagamento del provider non registrabile due volte · accredito punti unico per appuntamento · liquidazione unica per operatore e settimana · contatti importati non autorizzati al marketing per impostazione predefinita · ogni consenso collegato a un soggetto · deduplica email dei contatti.

## Mappa dei 35 test richiesti (punto 36)

| # | Test | Stato |
|---|---|---|
| 6, 7 | Disponibilità orarie, nessuna sovrapposizione | Automatico ✔ (logica) + vincolo/lock DB |
| 12 | Pagamento non duplicato | Automatico ✔ (DB) |
| 14, 15, 16, 17 | Punti: accumulo, utilizzo, scadenza, correzione dopo rimborso | Automatico ✔ (logica + DB) |
| 22, 23, 24 | Ore lavorate, quarti d'ora, liquidazione del sabato | Automatico ✔ (logica + DB) |
| 26 | Registrazione consensi | Automatico ✔ (DB) |
| 1–5, 8–11, 13, 18–21, 25, 27–35 | Flussi completi su app avviata | **Da eseguire su Replit** con la checklist seguente |

## Checklist da eseguire su Replit (dopo il primo avvio)

1. Registrazione cliente e login · 2. Verifica email · 3. Due cani per lo stesso cliente
4. Richiesta appuntamento → messaggio "Richiesta inviata. Attendi la conferma di Dog's Planet."
5. Martina non deve comparire per "Tosatura"; Enmanuel non per "Stripping naturale"; Ilaria solo il sabato 09–13
6. Due richieste sullo stesso orario/operatore: la seconda deve essere rifiutata
7. Gestionale: conferma, proposta di nuovo orario (accettata dal cliente), rifiuto
8. Richiesta pagamento dopo la conferma (con Stripe in modalità test) e registrazione incasso in negozio
9. Completamento → storico trattamento del cane e punti accreditati; rimborso → punti stornati
10. Prodotto con variante, shop attivato, acquisto, scarico magazzino; shop disattivato → "Pet Shop – In arrivo"
11. Incasso self-service visibile nelle statistiche separato dalla toelettatura
12. Ore di un operatore (es. 08:45–16:30) → 7 h 45' = 77,50 €; liquidazione del sabato segnata come pagata; export PDF/Excel
13. Utente "Responsabile" con soli permessi agenda: le altre voci di menu non compaiono e le API rispondono 403
14. Email (con SMTP) e push (con VAPID) su Android e su iPhone con app aggiunta alla Home
15. Richiesta pensione → proposta nuove date → accettazione
16. Modifica servizi, turni e testi del sito dal gestionale; logo e mascotte visibili in header, home, footer, login, gestionale, email, PDF
