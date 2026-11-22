# Dati legali, informative e consensi

## Stato

**Bozze da convalidare, non certificazione di conformità. Nessuna pubblicazione autorizzata.**

I dati comunicati dal cliente sono separati in `Impostazioni → Contenuti del sito → Dati legali e checklist`
(scheda nell’area Contenuti). La sede legale non è l’indirizzo del negozio.

La Partita IVA **non è stata fornita**: resta vuota, non viene dedotta dal CF e
deve essere richiesta al titolare prima della pubblicazione finale, come richiesto
dal DPR 633/1972 art. 35. Il campo admin accetta solo vuoto o 11 cifre; la validazione
formale non sostituisce la verifica della titolarità.

## Gestione testi e verifiche

- Privacy e Cookie Policy sono pagine CMS, modificabili da **Contenuti → Pagine**.
- Sono presenti avvisi visibili di bozza anche nelle pagine pubbliche.
- L’admin contiene una checklist di conservazione, fornitori/ruoli/DPA, regioni,
  eventuali trasferimenti e garanzie, fornitori email/push/pagamenti, audit del dominio
  finale e condizioni dei servizi. Non sono inventati DPO o tempi di conservazione.
- Le conferme admin sono registrazioni organizzative: non certificano da sole la conformità.
- L’aggiornamento esplicito `server/prepare-legal.ts` conserva il testo precedente
  nell’audit. Non viene eseguito automaticamente: non sovrascrive successive modifiche CMS.
- Le nuove prove di presa visione prenotazioni contengono versione e impronta SHA-256
  del testo. La checkbox è una presa visione; marketing separato, facoltativo e vuoto.

## Inventario tecnico iniziale riscontrato

- `dp.sid`: sessione di prima parte, HttpOnly, SameSite Lax, Secure in produzione.
  30 giorni clienti, 12 ore personale, rolling; nessuna sessione anonima inizializzata
  dal semplice caricamento della homepage.
- localStorage: `dp-cookie-consent`, `dp-installed`, `dp-install-hide`,
  `dp-install-dismissed-until`; `dp-cart` nella rotta shop predisposta.
- sessionStorage: `dp-booking-date`, `dp-booking-time`, solo giorno/ora.
- PWA: service worker e Cache Storage `dp-*`; API, account e admin esclusi dal worker.
- PushManager: sottoscrizione esplicita, non cookie di marketing.
- GA4/GTM/Meta: campi e codice predisposti, **nessun ID configurato al momento
  dell’intervento**. La pagina Cookie Policy mostra lo stato corrente da API.
- Google Maps solo su richiesta e ora subordinata alla categoria contenuti esterni.
  Iframe YouTube/Vimeo CMS analogamente bloccati prima della scelta.
- Poppins ospitato localmente, con licenza SIL: eliminate le richieste Google Fonts.
- L’ambiente Replit e il dominio pubblico possono aggiungere cookie di piattaforma:
  l’inventario definitivo va eseguito fuori dall’iframe sul dominio di produzione.
  Non si dichiarano residenza UE o garanzie di trasferimento non accertate.

## Gestione cookie

- Rifiuta, Personalizza e Accetta tutti hanno dimensioni e stile equivalenti.
- Nessun opzionale viene caricato prima della scelta e dell’audit tag admin.
- GTM non parte con consenso parziale: richiede statistiche **e** marketing.
- I nuovi ID/tag/testi invalidano la vecchia impronta.
- Ricevuta casuale e scelta registrate nel database con data server, versione e
  categorie; il registro non salva IP, user agent o identità dell’account.
- Revoca dal footer, cancellazione dei cookie opzionali di prima parte riconosciuti
  e reload se erano stati eseguiti tag. Gli iframe vengono smontati alla revoca.
- La scelta non è riproposta a ogni visita: viene rivalutata dopo sei mesi oppure
  se cambiano testo/configurazione. Conservazione del registro: da definire e applicare
  con il titolare, non viene inventata una scadenza già approvata.

## Fonti di riferimento

- GDPR, artt. 6, 7, 12–13 e 15–22: https://eur-lex.europa.eu/eli/reg/2016/679/oj
- Garante, Linee guida del 10 giugno 2021:
  https://www.garanteprivacy.it/home/docweb/-/docweb-display/docweb/9677876
- Garante, FAQ cookie: https://www.garanteprivacy.it/faq/cookie

Le fonti aiutano la preparazione; la valutazione concreta resta da convalidare con
il titolare e il consulente.

## Verifiche effettuate nell’anteprima di sviluppo

- Controllo TypeScript, build di produzione e 38 test automatici superati.
- Homepage, Privacy Policy, Cookie Policy e pagina richiesta prenotazione scorse
  a 320, 390, 430, 768 e 1440 px, senza overflow orizzontale.
- Dati fiscali del footer e link PEC verificati; pagine legali raggiungibili,
  contenuto completo visibile e avvisi di bozza presenti.
- Rifiuto cookie mantenuto al reload; opzioni non preselezionate; registro realmente
  scritto nel database. Mappa assente prima della scelta e smontata dopo revoca.
  Nel test la risposta della mappa è stata intercettata per non inviare dati a Google.
- Nessuna chiamata a Google Fonts, GA4/GTM o Meta Pixel durante il percorso verificato.
- Scheda admin legale verificata mobile/desktop con sessione e salvataggio
  **simulati nel browser**, senza creare account o modificare i dati del titolare;
  payload di salvataggio controllato e validazione backend coperta da test.
- UI prenotazione: giorno → ora → ospite, presa visione obbligatoria e marketing
  facoltativo. L’invio browser finale è stato intercettato, non trasmesso come
  richiesta di un cliente reale.
- Integrazione database prenotazioni verificata separatamente con transazione
  **sempre annullata**: richiesta pendente, cliente/cane CRM collegati, foto compressa
  caricata/letta dallo storage e poi rimossa, replay senza duplicati e conflitto slot
  bloccato. Nessun cliente, cane o richiesta di prova lasciato, nessuna email/push inviata.

Limiti: non è un audit del dominio di produzione (non pubblicato), non è una
convalida legale, non è una prova di invio reale di email/push e non è un collaudo
completo delle approvazioni admin tramite sessione reale.
