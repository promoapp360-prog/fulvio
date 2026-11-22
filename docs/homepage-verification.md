# Revisione completa della homepage

## Ambito

Revisione della presentazione pubblica: homepage, header/footer, barra contatti,
presentazione dei contatti e posizione dei pannelli cookie/installazione.
Nessuna modifica a server, schema, migrazioni, autenticazione, dati, CRM o pagamenti.
Nessun servizio esterno collegato e nessuna pubblicazione in produzione.

Le immagini originali del marchio e di Poppy sono conservate. Le card utilizzano
derivati locali ravvicinati delle illustrazioni esistenti: nessuna generazione AI,
nessun ingrandimento del file e nessuna ricostruzione del cane.
La foto hero mantiene intatti bordo superiore e lati; viene esclusa solo la
sottile fascia inferiore che conteneva un residuo della brand board.

La nuova foto descritta negli allegati della conversazione non era disponibile
come file nel progetto durante questa revisione: resta in uso la foto esistente.

## Controlli eseguiti

- TypeScript: `pnpm --filter @workspace/dogs-planet run check`.
- Compilazione: `pnpm --filter @workspace/dogs-planet run build`.
- Test: `pnpm --filter @workspace/dogs-planet test` — 19 superati, inclusi
  cinque controlli della cache PWA.
- Chromium: scorrimento dall'inizio al footer a 320, 390, 768, 1024, 1280
  e 1440 px; controllati overflow, caricamento immagini, proporzioni della foto,
  menu desktop/mobile, chiusura con Escape e al cambio pagina.
- Controllati i collegamenti ai servizi, shop, contatti, registrazione, login,
  richiesta prenotazione e ingresso anonimo alle aree account/admin.
- Pulsante di prenotazione e nome dello shop conservati; shop pubblicamente
  disabilitato, elenco prodotti non esposto e ordini pubblici bloccati.
- Barra rapida fissata in basso sui telefoni con spazio riservato, area sicura
  e pulsanti da 64 px; banner cookie posizionato sopra la barra.
- Worker PWA verificato anche in Chromium: eliminata una vecchia cache di prova
  Dog's Planet, preservata una cache estranea e conservato il consenso cookie.
  Le immagini senza hash cercano aggiornamenti dalla rete e restano disponibili
  da cache quando offline. I bundle con hash mantengono la cache efficiente.

Gli screenshot e i risultati dettagliati della verifica Replit sono in
`generated-artifacts/homepage-review/`, esclusi da Git e dalla pubblicazione.

## Limiti della verifica

Non sono stati eseguiti flussi autenticati cliente/admin, inserite prenotazioni,
effettuati pagamenti né inviate comunicazioni. Le protezioni sono state provate
da utente anonimo; l'interfaccia dopo il login non è stata verificata.
Nessuna migrazione è stata necessaria per queste modifiche grafiche.
