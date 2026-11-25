# Gestione prestazioni e Fidelity — Fase 3

## Listino

Il catalogo già esistente rimane l'unica fonte dati per amministrazione, `/servizi`, `/toelettatura` e richieste di prenotazione. Non è stato caricato un secondo listino né sono stati sostituiti prezzi personalizzati. Si possono modificare nome, descrizione, prezzo/“da”, durata base e per taglia, ordine, visibilità ed abilitazione online. Il taglio unghie conserva la regola specifica di 5 minuti.

## Fidelity Card nel gestionale

- Cerca per nome, telefono (anche con prefisso), email o numero tessera.
- **Gestisci → Rettifica motivata**: punti positivi o negativi, sempre con causale. Lo storico resta visibile anche al cliente; non si può scendere sotto zero.
- **Nuovo cliente Self-Service**: bastano nome e telefono. Email ed eventuali punti iniziali sono aggiuntivi. Vengono creati anagrafica CRM e tessera, non credenziali o account, né consensi fittizi.
- Un recapito già presente genera un avviso. Si usa la scheda esistente; solo se si tratta davvero di un'altra persona si conferma una scheda distinta con recapito condiviso. Nessuna fusione automatica.

## Recupero dopo registrazione

Il cliente completa la normale registrazione, poi nella propria **Fidelity Card → Hai già una tessera Self-Service?** inserisce il numero della tessera precedente.

- Email coincidente **verificata**, numero tessera ed azione esplicita: recupero diretto.
- Solo telefono coincidente: richiesta in **Fidelity Card → Associazioni da verificare**. Il salone controlla la titolarità prima di confermare, oppure rifiuta.
- Non è necessario un provider SMS. Un telefono non verificato non autorizza trasferimenti automatici.

Si conservano movimenti originali, punti residui e date di scadenza; il recupero non rinnova i punti e non accredita un secondo bonus di benvenuto. Il vecchio numero tessera continua a essere ricercabile dal salone e rimanda alla tessera principale.

## Scadenze e bonus

- **Impostazioni → Fidelity**: regola generale dei nuovi accumuli, standard 12 mesi; restano disponibili le politiche personalizzate. L'adeguamento iniziale non modifica i lotti già accumulati né sostituisce regole a data fissa o periodo personalizzato.
- **Gestisci → Regola di scadenza personale**: vuoto = regola generale; 0 = nessuna scadenza; 1–120 = mesi dall'accumulo. Vale per i nuovi movimenti. Se un cliente ha già una propria regola, il recupero di un'altra tessera non la sovrascrive.
- **Proroga scadenza**: modifica i lotti esistenti con una causale registrata nello storico.
- **Punti di benvenuto**: quantità impostabile in Impostazioni; 0 disattiva. Il bonus viene assegnato una sola volta alla registrazione, non alla creazione della scheda minima Self-Service.

Queste funzioni non richiedono nuove chiavi, dominio, Stripe o servizi esterni. L'eventuale invio email richiede SMTP dedicato: senza configurazione gli invii restano simulati. Nessuna pubblicazione automatica.

## Collaudo sviluppo

`pnpm --filter @workspace/dogs-planet test`

`NODE_ENV=development pnpm --filter @workspace/dogs-planet exec tsx tests/loyalty-membership.integration.ts --browser`

Il secondo comando usa l'app in esecuzione e Chromium locale, crea esclusivamente dati sintetici e li rimuove al termine. Non modifica prezzi o saldi di clienti esistenti; non abilita invii esterni.
