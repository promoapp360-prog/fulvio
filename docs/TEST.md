# Esiti dei test – Dog's Planet

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
