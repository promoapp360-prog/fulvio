# Controllo della configurazione di pubblicazione

## Perimetro

Dog’s Planet usa un unico servizio pubblico: `artifacts/dogs-planet`, servizio `web`.
Il servizio originale Express serve sito, API e gestionale. Nessuna modifica
grafica o funzionale è necessaria per escludere il backend del template.

Nel progetto Replit che ospita questo repository:

- `artifacts/api-server/.replit-artifact/artifact.toml` non contiene più
  `[services.production]`; rimane solo la configurazione di sviluppo.
- Anche Canvas/mockup-sandbox è solo sviluppo.
- Dog’s Planet conserva i comandi di produzione `build` e `start` già configurati.
- La modifica al template appartiene alla configurazione del workspace Replit:
  non va importato il template nel repository originale `fulvio` per salvarla.

## Esito dell’indagine

Al momento del controllo, il servizio di pubblicazione ha restituito:

- nessuna pubblicazione attiva o build riuscita;
- cronologia build non disponibile;
- nessun log di deployment disponibile;
- database di produzione non ancora esistente.

Questo non permette di identificare con certezza il motivo dell’interruzione
segnalata. L’API del template era erroneamente inclusa tra i servizi di produzione:
la configurazione è stata corretta, ma non si presenta questa anomalia come
causa dimostrata dai log.

## Database e Secrets

Nel database dedicato di **sviluppo** risultano applicate tutte le migrazioni
da `0001_init.sql` a `0006_cookie_choices.sql`, presenti in `migrations/`.

Il progetto conserva la gestione schema di Replit Publish. Non è impostato
`REPLIT_DATABASE_MIGRATIONS=app`: non convertire il progetto e non aggiungere
migrazioni SQL ai comandi di build o all’avvio in produzione.

Quando il titolare autorizzerà la pubblicazione, la procedura Replit creerà il
database di produzione e gestirà il confronto/applicazione dello schema di
sviluppo. Eventuali avvisi di rinomina o perdita dati devono essere esaminati
prima di confermare. Non selezionare una sovrascrittura dei dati senza
un’autorizzazione specifica.

`SESSION_SECRET` e `ADMIN_INITIAL_PASSWORD` risultano disponibili per l’ambiente
di produzione tramite il controllo di sola esistenza. Nessun valore è stato letto
o riportato. Non usare password di esempio.

Il controllo dello schema effettivo di produzione potrà essere completato solo
quando il database sarà stato creato dalla pubblicazione autorizzata. Nessuna
pubblicazione è stata avviata durante questa correzione.
