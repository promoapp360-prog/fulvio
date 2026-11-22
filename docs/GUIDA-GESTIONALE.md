# Guida al gestionale Dog's Planet

Accesso: **`/login`** con il proprio username o email. Il menu mostra solo le sezioni autorizzate.

## Primo accesso dell'amministratore
Username `Admin`, password temporanea impostata nei Secrets (`ADMIN_INITIAL_PASSWORD`). Al primo accesso il sistema chiede una nuova password personale.

## Lavoro quotidiano
- **Dashboard** – appuntamenti di oggi, richieste da confermare, incassi del giorno e del mese, pensione, ordini, scorte basse, email non consegnate.
- **Agenda** – vista giorno (colonne per operatore), settimana, mese, filtrabile per operatore; i colori indicano lo stato. "Nuovo appuntamento" per le prenotazioni prese al telefono o in negozio. Sovrapposizioni e orari fuori turno solo con autorizzazione dell'amministratore.
- **Richieste prenotazioni** – ogni richiesta on line resta in attesa finché non la gestisci: *Conferma*, *Proponi questo orario*, *Rifiuta*, cambia operatore/durata/prezzo, *Richiedi pagamento on line*. Annullamenti e assenze richiedono un motivo e restano nello storico ("Annullamenti e assenze").
- **Completato** – a fine servizio indica prezzo definitivo e note del trattamento: compaiono nello storico del cane e i punti Fidelity vengono accreditati.

## Clienti e cani
- **Clienti** – ricerca per nome, telefono, email o nome del cane; scheda con cani, appuntamenti passati e futuri, acquisti, spesa complessiva, punti, ultima visita, frequenza, note interne, comunicazioni, stato privacy e consenso marketing; segnalazione dei possibili duplicati.
- **Schede cani** – dati principali, pelo, benessere, altri animali, alimentazione, frequenza di richiamo e storico trattamenti filtrabile ed esportabile.
- **Campi personalizzati** – aggiungi nuovi campi alla scheda cane (testo, numero, data, selezione, casella) senza modificare il codice.

## Salone
- **Servizi / Listino** – prezzi, durate, varianti per taglia, supplementi automatici (nodi, muta…), operatori abilitati, visibilità sul sito, punti sì/no.
- **Operatori / Turni e disponibilità** – giorni, turni, pause, ferie, chiusure, postazioni, griglia oraria (15/30/45/60 minuti o personalizzata), intervallo tra appuntamenti.
- **Ore lavorate** – entrata, uscita, pause; minuti effettivi arrotondati al quarto d'ora e compenso calcolato in automatico (tariffa per operatore, iniziale 10 €/ora). Correzioni solo con motivazione.
- **Compensi collaboratori** – liquidazione settimanale (sabato): dettaglio giornaliero, totale, rettifiche, importo da pagare, stato e data di pagamento, storico, PDF ed Excel.

## Cassa
- **Pagamenti** – incassi in negozio (contanti, POS, Satispay, bonifici, altro) e on line; acconti, saldi, parziali, rimborsi; importi ancora da incassare; annullamento motivato delle registrazioni errate; export.
- **Incassi self-service** – data, box, importo, metodo, categoria, note (separati dalla toelettatura nelle statistiche).
- **Fidelity Card** – saldo, movimenti e scadenze di ogni cliente; utilizzo punti come sconto o premio; proroga e rettifica motivate. Regole in *Impostazioni → Fidelity*.

## Shop, magazzino, pensione
- **Prodotti** (categorie, varianti, foto), **Ordini** (on line e vendite al banco), **Magazzino** (carichi, scarichi, rettifiche, inventario, scorte basse), **Fornitori**.
- Lo shop si attiva da *Contenuti → Home e banner → Shop on line attivo*; finché è spento il sito mostra "Pet Shop – In arrivo".
- **Pensione casalinga** – accetta, rifiuta, chiedi informazioni o proponi nuove date; nulla viene confermato in automatico.

## Sito e comunicazioni
- **Contenuti sito** – pagine, banner, home, logo e mascotte (solo file originali), contatti e orari, self-service, FAQ, immagini.
- **SEO** – meta title/description, Search Console, GA4, Tag Manager, Meta Pixel (attivi solo dopo il consenso cookie).
- **Promozioni** – codici sconto, promozioni servizi/prodotti, compleanno, punti extra.
- **Comunicazioni** – campagne con segmentazione (abituali, inattivi, servizi, frequenza, caratteristiche del cane) solo verso chi ha il consenso marketing; email automatiche modificabili; promemoria (24 ore prima, modificabile) e richiami periodici; registri email e push.

## Amministrazione
- **Statistiche** – filtri per periodo, servizio, operatore, pagamento, categoria, canale; esportazione Excel e PDF.
- **Privacy e consensi** – storico autorizzazioni, versioni delle informative, contatti predisposti per l'importazione futura (mai autorizzati al marketing in automatico).
- **Utenti e permessi** – crea utenti (Admin, Operatore, Responsabile personalizzabile), credenziali temporanee, obbligo di cambio password, reset accesso, revoca sessioni, attivazione/disattivazione, permessi singoli.
- **Impostazioni** – pagamenti, cancellazioni e assenze, Fidelity, ore e liquidazioni, shop e consegne, pensione, registro accessi, registro operazioni, backup.
