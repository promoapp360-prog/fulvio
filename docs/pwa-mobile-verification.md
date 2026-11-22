# Rifiniture mobile, installazione PWA e notifiche

## Marchio e fotografie

- Il logo originale PNG/WebP era già realmente trasparente: verificato il canale
  alfa. Conservati file, colori, scritte e proporzioni, senza pannelli aggiunti.
- Le cinque illustrazioni ora utilizzano derivati PNG/WebP trasparenti.
  Lo scontorno cambia soltanto l'alfa; i colori visibili sono confrontati nei test
  con quelli degli originali. Conservati anche accessori, bolle, tetto e cuore.
- Nessuna ricostruzione, generazione di cani, modifica del muso o ingrandimento
  dei file. La risoluzione è quella dei sorgenti disponibili, circa 160–220 px.
- Rimossa la cornice bianca dalla fotografia ambientata dell'hero, che conserva
  il viso completo. Il vecchio ritaglio `welcome` non viene più mostrato perché
  incompleto già alla fonte: non si possono ricreare le parti mancanti.
- La nuova fotografia descritta nella conversazione non è disponibile come file.
  Resta quindi quella già presente. Nessun SVG originale del logo disponibile:
  viene usato il PNG trasparente originale, non un vettoriale approssimato.

## Installazione

- Manifest con identità stabile, scope, avvio standalone e icone 192/512 px,
  maskable e Apple ricavate dal simbolo ufficiale su fondo uniforme azzurro.
- Worker registrato nei contesti HTTPS/localhost compatibili, anche in preview.
  I moduli Vite non vengono archiviati; in sviluppo offline si mostra una pagina
  esplicita. In produzione vengono precaricati i bundle iniziali con hash.
- Android/Chromium: il prompt nativo viene invocato soltanto da un click e solo
  se il browser ha fornito `beforeinstallprompt`. Negli altri casi, istruzioni.
- iOS: istruzioni Safari **Condividi → Aggiungi alla schermata Home**, mai un
  falso pulsante di installazione nativa.
- Invito dopo interazione/scorrimento o attesa, senza sovrapporsi al consenso
  cookie; rinvio di 30 giorni, soppressione dopo accettazione/installazione,
  conferma manuale di aggiunta e nessun invito in modalità standalone.
- Safari non espone un rilevamento affidabile delle installazioni già eseguite
  fuori dal contesto Home. Per questo è presente la conferma manuale.
- L'installazione va eseguita aprendo il sito nel browser, fuori dall'iframe.
  Nessuna pubblicazione in produzione è stata eseguita.

## Push: stato reale e configurazione necessaria

Il progetto usa Web Push standard con VAPID; non richiede account Firebase,
OneSignal, credenziali di altri clienti o abbonamenti a servizi push.
Serve però una **coppia VAPID dedicata e stabile**, conservata nei Secrets:
`VAPID_PUBLIC_KEY` e `VAPID_PRIVATE_KEY`.

Per generarla autonomamente nel terminale del progetto:

```sh
pnpm --filter @workspace/dogs-planet exec web-push generate-vapid-keys
```

Trasferire i due valori soltanto nel modulo Secrets, mai nella chat o in Git.
Non riutilizzare coppie di altri clienti e non rigenerarle a ogni avvio.
Dopo il salvataggio riavviare il workflow e verificare `pushConfigured`.

Le due voci Secrets sono state inserite. Dopo il riavvio, tuttavia, sia il server
diretto sia l'anteprima restituiscono ancora `pushConfigured: false`: la
configurazione non è stata riconosciuta come coppia VAPID valida. Le push reali
rimangono quindi disabilitate, senza richieste di permesso o conferme ingannevoli.
Occorre reinserire tramite modulo protetto i soli valori prodotti da un'unica
generazione, senza intestazioni, virgolette o testo aggiuntivo. Nessuna chiave
è stata letta, mostrata o salvata in Git durante la verifica.
Anche SMTP è assente: l'email rimane il canale principale previsto, ma gli invii
reali email non sono configurati. Le comunicazioni in-app restano disponibili.

L'area cliente ora presenta consenso esplicito non preselezionato, richiesta
tecnica soltanto dopo click, stato dispositivo, revoca su tutti i dispositivi e
fallback per browser non compatibili/iPhone non installati. La registrazione
salva atomicamente sottoscrizione, preferenza e prova del consenso nell'audit
esistente. La disattivazione registra la revoca; nessuna migrazione necessaria.
La chiave privata non viene esposta; viene verificata la corrispondenza della
coppia. L'invio resta condizionato da browser, connessione e sistema operativo.

## Verifiche

- TypeScript, compilazione e 27 test automatici superati.
- Homepage intera e servizi a 320, 375, 390, 430, 768, 1024 e 1440 px:
  nessun overflow; controllati menu, immagini e barra contatti.
- Calendario cliente a 320, 375, 430 e 768 px: selezione cane, servizio,
  operatore, scorrimento date e selezione orario con bersagli di almeno 44 px.
- Verifica aggiuntiva a 320 × 568 px: menu scorrevole, invito di installazione
  contenuto nello schermo, conferma persistente di aggiunta e calendario.
- Chromium **non in incognito**: manifest senza errori, zero errori di
  installabilità e fallback offline funzionante.
- Verificati invito iPhone, istruzioni, rinvio persistente e gesto Android.
- Verificati sette scenari push: autorizzazione, rifiuto, errore server,
  configurazione assente, iPhone browser/Home e API non supportate.
- I test dell'area cliente e dei permessi usano risposte browser simulate:
  nessun bypass di autenticazione nell'app, account creato, prenotazione o invio.
  Non è stata eseguita un'installazione fisica su Android/iPhone né un invio
  push reale a un dispositivo. Non si dichiara verificato ciò che manca.
- Endpoint push protetti per utenti anonimi; shop e checkout pubblico ancora
  disabilitati. Nessuna modifica a CRM, dati esistenti o logica gestionale.

Screenshot e risultati: `generated-artifacts/mobile-pwa-review/`, esclusi da Git.
