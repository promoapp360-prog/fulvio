// Dati iniziali: eseguito all'avvio, inserisce solo ciò che manca (idempotente).
import crypto from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db, pool } from "./db";
import { users, services, operators, operatorServices, operatorShifts, pages, faqs } from "../shared/schema";
import { hashPassword } from "./auth";
import { slugify } from "./util";
import { COOKIE_DRAFT, PRIVACY_DRAFT } from "./services/legal-documents";

const SERVICES: { name: string; category: string; durationMin: number; description: string }[] = [
  { name: "Lavaggio professionale", category: "Lavaggio", durationMin: 60, description: "Bagno con prodotti professionali specifici per il tipo di mantello, asciugatura e spazzolatura." },
  { name: "Toelettatura professionale", category: "Toelettatura", durationMin: 120, description: "Trattamento completo: bagno, asciugatura, taglio e rifinitura secondo la razza e le tue preferenze." },
  { name: "Tosatura", category: "Toelettatura", durationMin: 90, description: "Tosatura a macchinetta con l'altezza più adatta al mantello e alla stagione." },
  { name: "Taglio a forbice", category: "Toelettatura", durationMin: 120, description: "Modellatura del pelo eseguita interamente a forbice per un risultato naturale e preciso." },
  { name: "Rifiniture", category: "Toelettatura", durationMin: 30, description: "Ritocchi di muso, zampe e zone intime tra una toelettatura e l'altra." },
  { name: "Stripping naturale", category: "Trattamenti del mantello", durationMin: 120, description: "Rimozione manuale del pelo morto per le razze a pelo duro, nel rispetto della struttura del mantello." },
  { name: "Snodatura", category: "Trattamenti del mantello", durationMin: 60, description: "Rimozione delicata di nodi e feltri. La durata dipende dalle condizioni del pelo." },
  { name: "Rimozione della muta", category: "Trattamenti del mantello", durationMin: 60, description: "Trattamento specifico per eliminare il sottopelo in eccesso durante la muta." },
  { name: "Taglio unghie", category: "Servizi rapidi", durationMin: 15, description: "Taglio e limatura delle unghie in sicurezza." },
  { name: "Rasatura sotto i piedi", category: "Servizi rapidi", durationMin: 15, description: "Rasatura del pelo tra i cuscinetti per igiene e migliore aderenza." },
  { name: "Trattamenti aggiuntivi", category: "Trattamenti aggiuntivi", durationMin: 30, description: "Trattamenti specifici da abbinare ai servizi: chiedi al salone quelli più adatti al tuo cane." },
];

// competenze indicate da Dog's Planet
const OPERATORS = [
  { name: "Enmanuel", color: "#0B3D91", services: SERVICES.map((s) => s.name).filter((n) => n !== "Stripping naturale"),
    shifts: [1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startTime: "08:45", endTime: "19:00" })) },
  { name: "Martina", color: "#00B6C8", services: ["Lavaggio professionale", "Stripping naturale", "Snodatura", "Rimozione della muta", "Rasatura sotto i piedi"],
    shifts: [
      { weekday: 1, startTime: "09:00", endTime: "19:00" }, { weekday: 2, startTime: "10:00", endTime: "19:00" }, { weekday: 3, startTime: "09:00", endTime: "19:00" },
      { weekday: 4, startTime: "10:00", endTime: "19:00" }, { weekday: 5, startTime: "09:00", endTime: "19:00" }, { weekday: 6, startTime: "09:00", endTime: "19:00" },
    ] },
  { name: "Ilaria", color: "#2E8DE6", services: ["Lavaggio professionale", "Snodatura", "Rimozione della muta"],
    shifts: [{ weekday: 6, startTime: "09:00", endTime: "13:00" }] },
];

const PAGES: { slug: string; title: string; subtitle?: string; body: string; seoDescription?: string }[] = [
  { slug: "home", title: "Benvenuto!", subtitle: "Toelettatura professionale a Cernusco sul Naviglio", body: "Da Dog's Planet il tuo cane è al centro di tutto: lo accogliamo con calma, lo trattiamo con prodotti professionali e te lo restituiamo pulito, profumato e felice.", seoDescription: "Dog's Planet: toelettatura professionale per cani a Cernusco sul Naviglio (MI). Lavaggio self-service 365 giorni, pensione casalinga e Fidelity Card." },
  { slug: "chi-siamo", title: "Chi siamo", subtitle: "Il pianeta dove i cani sono di casa", body: "Dog's Planet è il salone di toelettatura di Cernusco sul Naviglio dedicato al benessere del tuo cane.\n\nIl nostro team lavora su appuntamento per dedicare a ogni cane il tempo che merita, rispettando il suo carattere, la sua razza e le sue esigenze.\n\n## Il nostro metodo\n\n- Ascoltiamo te e osserviamo il tuo cane prima di iniziare\n- Usiamo prodotti professionali scelti per ogni tipo di mantello\n- Ti consigliamo come mantenere il pelo in ordine tra un appuntamento e l'altro" },
  { slug: "toelettatura", title: "Toelettatura", subtitle: "Cura professionale, su misura per il tuo cane", body: "La toelettatura è il cuore di Dog's Planet. Ogni trattamento parte da una valutazione del mantello: nodi, muta, sensibilità della pelle ed eventuali esigenze particolari.\n\n## Come funziona\n\n1. Registrati e crea la scheda del tuo cane\n2. Scegli servizio, operatore, giorno e orario\n3. Invia la richiesta: Dog's Planet la verifica e ti conferma l'appuntamento\n\nIl prezzo definitivo viene confermato dal salone in base a taglia e condizioni del pelo." },
  { slug: "servizi", title: "Servizi e listino", subtitle: "Prezzi e durate indicativi, confermati dal salone", body: "Il prezzo può variare in base a taglia, condizioni del pelo, presenza di nodi e trattamenti aggiuntivi. Il prezzo definitivo viene sempre confermato da Dog's Planet." },
  { slug: "richiedi-prenotazione", title: "Richiedi la prenotazione on Line", subtitle: "Scegli servizio, operatore e orario: ti confermiamo noi", body: "La richiesta non è una prenotazione automatica: Dog's Planet la verifica e ti invia la conferma via email e notifica." },
  { slug: "self-service", title: "Lavaggio Self-Service", subtitle: "Tutti i giorni, 365 giorni all'anno, dalle 08:00 alle 22:00", body: "Lava il tuo cane in autonomia, quando vuoi, nelle nostre postazioni attrezzate con vasca, acqua calda, phon professionale e diversi tipi di shampoo.\n\n## Come ottenere la tessera\n\nLe tessere ricaricabili si acquistano al distributore automatico presente in negozio.\n\n## Come usare il lavaggio\n\nLe istruzioni dettagliate saranno pubblicate a breve.\n\n## Gli shampoo\n\nSono disponibili diversi tipi di shampoo per le diverse esigenze del mantello." },
  { slug: "pensione-casalinga", title: "Pensione Casalinga", subtitle: "Un ambiente familiare quando non puoi portarlo con te", body: "Su richiesta e con disponibilità limitata, Dog's Planet offre un servizio di pensione casalinga.\n\nInvia la tua richiesta dall'area personale indicando le date: ti ricontatteremo per confermare disponibilità e condizioni." },
  { slug: "fidelity-card", title: "Fidelity Card", subtitle: "Più ti prendi cura del tuo cane, più vieni premiato", body: "Registrandoti ricevi automaticamente la tua Fidelity Card digitale. Accumuli punti con i servizi e gli acquisti e li consulti in ogni momento dall'area personale." },
  { slug: "pet-shop", title: "Pet Shop", subtitle: "In arrivo", body: "Stiamo preparando il nostro shop online con prodotti selezionati per il benessere del tuo cane. Nel frattempo trovi i nostri prodotti direttamente in negozio." },
  { slug: "contatti", title: "Contatti", subtitle: "Vieni a trovarci a Cernusco sul Naviglio", body: "Per informazioni chiamaci o scrivici su WhatsApp. Per gli appuntamenti usa la richiesta di prenotazione on line." },
  { slug: "installa-app", title: "Installa l'app Dog's Planet", subtitle: "Gratis, senza passare dagli store", body: "## Su Android (Chrome)\n\n1. Apri il sito di Dog's Planet con Chrome\n2. Tocca il menu ⋮ in alto a destra\n3. Scegli **Installa app** (o **Aggiungi a schermata Home**)\n\n## Su iPhone (Safari)\n\n1. Apri il sito con **Safari**\n2. Tocca il pulsante **Condividi** (il quadrato con la freccia)\n3. Scegli **Aggiungi alla schermata Home** e conferma\n4. Apri l'app dall'icona sulla Home\n\n## Notifiche\n\nPer ricevere promemoria e conferme anche come notifiche, accedi alla tua area personale, vai in **Profilo e privacy** e tocca **Attiva notifiche push**. Su iPhone le notifiche funzionano solo dopo aver aggiunto l'app alla schermata Home (iOS 16.4 o successivo) e aver autorizzato le notifiche.\n\nLe email restano comunque il canale principale per conferme e promemoria." },
  { slug: "privacy-policy", title: "Privacy Policy", body: "## Titolare del trattamento\n\nDog's Planet – Via Leonardo da Vinci 86, Cernusco sul Naviglio (MI) – dogsplanetcernusco@gmail.com\n\n## Dati trattati e finalità\n\nTrattiamo i dati che ci fornisci (anagrafica, contatti, dati dei tuoi animali, appuntamenti, acquisti e pagamenti) per gestire il tuo account, le richieste di prenotazione, i servizi, gli adempimenti contabili e, solo con il tuo consenso, l'invio di comunicazioni promozionali.\n\n## Base giuridica\n\nEsecuzione del contratto e di misure precontrattuali, obblighi di legge e, per il marketing, il consenso, revocabile in qualsiasi momento dall'area personale.\n\n## Conservazione\n\nI dati sono conservati per il tempo necessario alle finalità indicate e agli obblighi di legge.\n\n## Diritti\n\nPuoi chiedere accesso, rettifica, cancellazione, limitazione, portabilità e opporti al trattamento scrivendo all'email indicata. Puoi scaricare i tuoi dati dall'area personale.\n\n*Testo base da completare e verificare con il proprio consulente privacy.*" },
  { slug: "cookie-policy", title: "Cookie Policy", body: "Questo sito utilizza cookie tecnici necessari al funzionamento (ad esempio per mantenere l'accesso all'area personale).\n\nCookie di statistica o marketing vengono attivati solo dopo il tuo consenso, che puoi modificare in qualsiasi momento dal link \"Preferenze cookie\" in fondo alla pagina.\n\n*Testo base da completare e verificare con il proprio consulente privacy.*" },
  { slug: "condizioni-del-servizio", title: "Condizioni del servizio", body: "## Richieste di prenotazione\n\nLe richieste inviate on line non costituiscono prenotazione: l'appuntamento è valido solo dopo la conferma di Dog's Planet.\n\n## Prezzi\n\nI prezzi indicati sono indicativi e possono variare in base a taglia, condizioni del pelo e trattamenti aggiuntivi. Il prezzo definitivo è confermato dal salone.\n\n## Modifiche e cancellazioni\n\nPer modificare o annullare un appuntamento confermato invia una richiesta dall'area personale o contatta il salone con il maggior preavviso possibile.\n\n*Testo base da completare con le condizioni definitive di Dog's Planet.*" },
];

const SELF_FAQ = [
  { question: "Quando posso usare il lavaggio self-service?", answer: "Tutti i giorni, 365 giorni all'anno, dalle 08:00 alle 22:00." },
  { question: "Devo prenotare?", answer: "No, il self-service non si prenota: vieni quando vuoi negli orari di apertura." },
  { question: "Come pago?", answer: "Con la tessera ricaricabile che acquisti al distributore automatico in negozio." },
];

export async function seedIfEmpty() {
  // amministratore iniziale (punto 28): username "Admin", password temporanea SOLO da Secrets (ADMIN_INITIAL_PASSWORD),
  // cambio obbligatorio al primo accesso. Senza la variabile NON viene creato alcun account con credenziali predefinite.
  const [{ n: admins }] = (await pool.query("SELECT count(*)::int AS n FROM users WHERE role = 'admin'")).rows;
  if (admins === 0) {
    const pw = process.env.ADMIN_INITIAL_PASSWORD;
    if (!pw) {
      console.warn("[seed] Nessun amministratore: imposta ADMIN_INITIAL_PASSWORD nei Secrets di Replit e riavvia per crearlo.");
    } else {
      const email = (process.env.ADMIN_EMAIL || "dogsplanetcernusco@gmail.com").toLowerCase();
      await db.insert(users).values({
        email, username: "Admin", passwordHash: await hashPassword(pw), role: "admin", firstName: "Fulvio", lastName: "Dog's Planet",
        mustChangePassword: true, consentPrivacy: true, consentDate: new Date(), emailVerifiedAt: new Date(),
      }).onConflictDoNothing();
      console.log(`[seed] Amministratore creato: username "Admin" (${email}). Al primo accesso verrà chiesto di cambiare la password; poi puoi rimuovere ADMIN_INITIAL_PASSWORD dai Secrets.`);
    }
  }

  // versioni iniziali delle informative (modificabili in Privacy e consensi)
  await pool.query(`INSERT INTO consent_policies (kind, version, summary) VALUES
    ('privacy','1.0','Informativa privacy iniziale'), ('marketing','1.0','Consenso comunicazioni promozionali'),
    ('cookie','1.0','Cookie policy iniziale'), ('condizioni','1.0','Condizioni del servizio iniziali') ON CONFLICT DO NOTHING`);

  const [{ n: svcCount }] = (await pool.query("SELECT count(*)::int AS n FROM services")).rows;
  if (svcCount === 0) {
    await db.transaction(async (tx) => {
      const ids: Record<string, number> = {};
      for (const [i, s] of SERVICES.entries()) {
        const [row] = await tx.insert(services).values({ ...s, slug: slugify(s.name), priceCents: null, priceFrom: true, sortOrder: i + 1 }).returning();
        ids[s.name] = row.id;
      }
      for (const [i, o] of OPERATORS.entries()) {
        const [op] = await tx.insert(operators).values({ name: o.name, color: o.color, hourlyRateCents: 1000, sortOrder: i + 1 }).returning();
        await tx.insert(operatorShifts).values(o.shifts.map((s) => ({ ...s, operatorId: op.id })));
        await tx.insert(operatorServices).values(o.services.map((n) => ({ operatorId: op.id, serviceId: ids[n] })));
      }
    });
    console.log("[seed] Servizi e operatori iniziali creati (prezzi da impostare nel gestionale)");
  }

  for (const pg of PAGES) await db.insert(pages).values({
    ...pg,...(pg.slug==="privacy-policy"?{body:PRIVACY_DRAFT,subtitle:"Bozza da convalidare con il titolare"}:pg.slug==="cookie-policy"?{body:COOKIE_DRAFT,subtitle:"Bozza da convalidare con il titolare"}:{}),
  }).onConflictDoNothing({ target: pages.slug });

  const [{ n: faqCount }] = (await pool.query("SELECT count(*)::int AS n FROM faqs")).rows;
  if (faqCount === 0) await db.insert(faqs).values(SELF_FAQ.map((f, i) => ({ ...f, section: "selfservice", sortOrder: i })));
}

if (process.argv[1] && process.argv[1].endsWith("seed.ts")) {
  (async () => { const { runMigrations } = await import("./migrate"); await runMigrations(); await seedIfEmpty(); await pool.end(); })()
    .catch((e) => { console.error(e); process.exit(1); });
}
