// Dati iniziali: eseguito all'avvio, inserisce solo ciò che manca (idempotente).
import crypto from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db, pool } from "./db";
import { users, services, serviceCategories, servicePricingRules, serviceSupplements, operators, operatorServices, operatorShifts, pages, faqs, settings } from "../shared/schema";
import { hashPassword } from "./auth";
import { slugify } from "./util";
import { COOKIE_DRAFT, PRIVACY_DRAFT } from "./services/legal-documents";
import { applyPhaseOneContent } from "./services/phase-one-content";
import { applyBookingContent } from "./services/booking-content";

const LEGACY_BOOKING_INSTRUCTIONS = "1. Registrati e crea la scheda del tuo cane\n2. Scegli servizio, operatore, giorno e orario\n3. Invia la richiesta: Dog's Planet la verifica e ti conferma l'appuntamento";
const BOOKING_INSTRUCTIONS = "1. Scegli sul calendario il giorno che preferisci.\n2. Seleziona un orario tra quelli disponibili.\n3. Accedi / Registrati oppure continua come ospite: compila i dati del proprietario e dell’animale, scegli i servizi e invia la richiesta. Registrarsi non è obbligatorio.\n4. Attendi l’approvazione di Fulvio: verifica la richiesta e conferma l’appuntamento oppure propone una variazione.\n\nL’invio è una richiesta, non una prenotazione confermata. La compatibilità dell’orario viene ricontrollata in base ai servizi e alle caratteristiche dell’animale prima dell’invio.";

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

const REFERENCE_CATEGORIES = [
  "Bagno pelo raso", "Bagno pelo medio", "Bagno pelo lungo", "Stripping senza bagno",
  "Bagno e tosatura con rifinitura a forbice", "Bagno e taglio interamente a forbice",
  "Toelettatura gatti", "Trattamenti aggiuntivi",
];
const REFERENCE_CATALOG: any[] = [
  { slug: "fnt-2025-bagno-pelo-raso", name: "Bagno cani — pelo raso", category: "Bagno pelo raso", species: "cane", type: "da", rules: [["piccola",2500],["media",3500],["grande",5000],["gigante",6000]] },
  { slug: "fnt-2025-bagno-pelo-medio", name: "Bagno cani — pelo medio", category: "Bagno pelo medio", species: "cane", type: "da", rules: [["piccola",3500],["media",5000],["grande",6000],["gigante",7000]] },
  { slug: "fnt-2025-bagno-pelo-lungo", name: "Bagno cani — pelo lungo", category: "Bagno pelo lungo", species: "cane", type: "da", rules: [["piccola",4000],["media",6000],["grande",8000],["gigante",10000]] },
  { slug: "fnt-2025-stripping", name: "Stripping senza bagno", category: "Stripping senza bagno", species: "cane", type: "da", rules: [["mini",6000],["piccola",7500],["media",9000],["grande",13000],["gigante",15000]] },
  { slug: "fnt-2025-bagno-tosatura-forbice", name: "Bagno e tosatura con rifinitura a forbice", category: "Bagno e tosatura con rifinitura a forbice", species: "cane", type: "da", rules: [["piccola",5500],["media",7000],["grande",9000],["gigante",12000]] },
  { slug: "fnt-2025-bagno-taglio-forbice", name: "Bagno e taglio interamente a forbice", category: "Bagno e taglio interamente a forbice", species: "cane", type: "da", rules: [["piccola",7000],["media",10000],["grande",13000],["gigante",16000]] },
  { slug: "fnt-2025-gatto-bagno", name: "Bagno gatto", category: "Toelettatura gatti", species: "gatto", type: "da", price: 5500 },
  { slug: "fnt-2025-gatto-tosatura", name: "Tosatura gatto", category: "Toelettatura gatti", species: "gatto", type: "da", price: 5500 },
  { slug: "fnt-2025-gatto-bagno-tosatura", name: "Bagno e tosatura gatto", category: "Toelettatura gatti", species: "gatto", type: "da", price: 8000 },
  ...["Taglio unghie","Rasatura igienica e interdigitali","Sistemazione testa","Sistemazione zampe"].map((name,i)=>({ slug:`fnt-2025-extra-${i+1}`,name,category:"Trattamenti aggiuntivi",species:"entrambi",type:"da",price:500 })),
  { slug: "fnt-2025-shampoo-speciale", name: "Shampoo curativo e/o antiparassitario", category: "Trattamenti aggiuntivi", species: "entrambi", type: "fascia", price: 500, max: 1000 },
  { slug: "fnt-2025-preparazione-esposizione", name: "Preparazione per esposizione", category: "Trattamenti aggiuntivi", species: "entrambi", type: "orario", price: 5000 },
] as const;
const LEGACY_REFERENCE_DESCRIPTION = "Prezzo di riferimento F.N.T. 2025. Durata e operatori devono essere configurati dall’amministratore prima di abilitare le richieste online.";
const PUBLIC_CATALOG_SEED_KEY = "service_catalog_public_v2";
const PUBLIC_CATALOG_CATEGORIES = REFERENCE_CATEGORIES;
const LEGACY_CATALOG_CATEGORIES = [
  "Bagno cani", "Servizi per gatti", "Trattamenti e servizi aggiuntivi", "Lavaggio",
  "Toelettatura", "Trattamenti del mantello", "Servizi rapidi",
];
function importedRules(entry: any, serviceId: number) {
  return Array.isArray(entry.rules) ? (entry.rules as Array<[string, number]>).map(([size, price], i) => ({
    serviceId, size, pricingType: entry.type, priceCents: price, active: true, sortOrder: i,
  })) : entry.type === "percentuale" ? [{
    serviceId, pricingType: entry.type, percentageBasisPoints: entry.percent, active: true, sortOrder: 0,
  }] : [];
}

/** Importa i riferimenti mancanti e applica una sola volta la tariffazione iniziale al catalogo esistente. */
async function seedReferenceCatalog() {
  const existingCategories = await db.select({ category: services.category }).from(services);
  const categories = [...new Set([...REFERENCE_CATEGORIES, ...existingCategories.map(x => x.category)])];
  for (const [sortOrder, name] of categories.entries()) {
    await db.insert(serviceCategories).values({ name, sortOrder }).onConflictDoNothing();
  }
  for (const [sortOrder, entry] of REFERENCE_CATALOG.entries()) {
    const [existing] = await db.select().from(services).where(eq(services.slug, entry.slug)).limit(1);
    if (existing) {
      if (existing.slug === entry.slug && existing.description === LEGACY_REFERENCE_DESCRIPTION) {
        await db.update(services).set({ description: null }).where(eq(services.id, existing.id));
      }
      const [{ n: auditCount }] = (await pool.query("SELECT count(*)::int AS n FROM audit_log WHERE entity = 'service' AND entity_id = $1", [String(existing.id)])).rows;
      const [{ n: operatorCount }] = (await pool.query("SELECT count(*)::int AS n FROM operator_services WHERE service_id = $1", [existing.id])).rows;
      const [{ n: ruleCount }] = (await pool.query("SELECT count(*)::int AS n FROM service_pricing_rules WHERE service_id = $1", [existing.id])).rows;
      // Ripara soltanto la prima importazione fatta da questo seeder, identificata dal testo
      // temporaneo e priva di audit, competenze o prezzi personalizzati.
      if (existing.slug === entry.slug && existing.description === LEGACY_REFERENCE_DESCRIPTION && !auditCount && !operatorCount) {
        const basePrice = "price" in entry ? entry.price : "rules" in entry ? Math.min(...entry.rules.map((rule: [string, number]) => rule[1])) : null;
        await db.update(services).set({
          priceCents: existing.priceCents == null ? basePrice : existing.priceCents,
          priceMaxCents: existing.priceMaxCents ?? ("max" in entry ? entry.max : null),
        visible: true, bookable: false, description: null,
        }).where(eq(services.id, existing.id));
        if (!ruleCount) {
          const rules = importedRules(entry, existing.id);
          if (rules.length) await db.insert(servicePricingRules).values(rules as any);
        }
      }
      continue;
    }
    const [sameName] = await db.select({ id: services.id }).from(services).where(sql`lower(${services.name}) = lower(${entry.name})`).limit(1);
    if (sameName) continue;
    const [service] = await db.insert(services).values({
      slug: entry.slug, name: entry.name, category: entry.category, species: entry.species,
      priceCents: "price" in entry ? entry.price : "rules" in entry ? Math.min(...entry.rules.map((rule) => rule[1])) : null,
      priceMaxCents: "max" in entry ? entry.max : null,
      pricingType: entry.type, priceFrom: entry.type === "da", durationMin: 60,
      description: null,
      bookable: false, active: true, visible: true, sortOrder: 100 + sortOrder,
    }).returning();
    const rules = importedRules(entry, service.id);
    if (rules.length) await db.insert(servicePricingRules).values(rules as any);
  }
  const [oldSpaService] = await db.select().from(services).where(eq(services.slug, "fnt-2025-spa")).limit(1);
  if (oldSpaService?.description === LEGACY_REFERENCE_DESCRIPTION) {
    const [{ n: auditCount }] = (await pool.query("SELECT count(*)::int AS n FROM audit_log WHERE entity = 'service' AND entity_id = $1", [String(oldSpaService.id)])).rows;
    const [{ n: operatorCount }] = (await pool.query("SELECT count(*)::int AS n FROM operator_services WHERE service_id = $1", [oldSpaService.id])).rows;
    if (!auditCount && !operatorCount) await db.update(services).set({ active: false, visible: false, bookable: false, description: null }).where(eq(services.id, oldSpaService.id));
  }
  const [spa] = await db.select({ id: serviceSupplements.id }).from(serviceSupplements)
    .where(sql`${serviceSupplements.serviceId} IS NULL AND lower(${serviceSupplements.name}) IN ('spa','trattamento spa')`).limit(1);
  if (!spa) await db.insert(serviceSupplements).values({
    serviceId: null, name: "SPA", condition: "manuale", pricingType: "percentuale",
    percentageBasisPoints: 5000, priceCents: 0, extraMin: 0, requiresConfirmation: true, active: true,
  });

  const [seedMarker] = await db.select().from(settings).where(eq(settings.key, PUBLIC_CATALOG_SEED_KEY)).limit(1);
  if (!seedMarker) {
    for (const [sortOrder, name] of PUBLIC_CATALOG_CATEGORIES.entries()) {
      const [category] = await db.select().from(serviceCategories).where(eq(serviceCategories.name, name)).limit(1);
      if (!category) continue;
      const [{ n: auditCount }] = (await pool.query(
        "SELECT count(*)::int AS n FROM audit_log WHERE entity = 'service_category' AND entity_id = $1",
        [String(category.id)],
      )).rows;
      if (!auditCount) await db.update(serviceCategories).set({
        sortOrder, active: true, visible: true, archivedAt: null,
      }).where(eq(serviceCategories.id, category.id));
    }

    for (const entry of REFERENCE_CATALOG) {
      const [service] = await db.select().from(services).where(eq(services.slug, entry.slug)).limit(1);
      if (!service) continue;
      const [{ n: auditCount }] = (await pool.query(
        "SELECT count(*)::int AS n FROM audit_log WHERE entity = 'service' AND entity_id = $1",
        [String(service.id)],
      )).rows;
      const [{ n: operatorCount }] = (await pool.query(
        "SELECT count(*)::int AS n FROM operator_services WHERE service_id = $1",
        [service.id],
      )).rows;
      if (auditCount || operatorCount) continue;
      const basePrice = "price" in entry ? entry.price : "rules" in entry ? Math.min(...entry.rules.map((rule: [string, number]) => rule[1])) : null;
      await db.update(services).set({
        name: entry.name, category: entry.category, active: true, visible: true,
        priceCents: service.priceCents ?? basePrice,
        priceMaxCents: service.priceMaxCents ?? ("max" in entry ? entry.max : null),
        pricingType: entry.type, priceFrom: entry.type === "da",
      }).where(eq(services.id, service.id));
    }

    // Sposta i prezzi delle tre voci già presenti senza toccarne operatori, durata o storico.
    const migrations: { referenceSlug: string; targetSlug: string; category: string; targetName?: string; type: string }[] = [
      { referenceSlug: "fnt-2025-stripping", targetSlug: "stripping-naturale", category: "Stripping senza bagno", targetName: "Stripping senza bagno", type: "da" },
      { referenceSlug: "fnt-2025-extra-1", targetSlug: "taglio-unghie", category: "Trattamenti aggiuntivi", type: "da" },
      { referenceSlug: "fnt-2025-extra-2", targetSlug: "rasatura-sotto-i-piedi", category: "Trattamenti aggiuntivi", targetName: "Rasature igieniche e interdigitali", type: "da" },
    ];
    for (const migration of migrations) {
      const [target] = await db.select().from(services).where(eq(services.slug, migration.targetSlug)).limit(1);
      const [source] = await db.select().from(services).where(eq(services.slug, migration.referenceSlug)).limit(1);
      if (!target) continue;
      const [{ n: targetAudit }] = (await pool.query(
        "SELECT count(*)::int AS n FROM audit_log WHERE entity = 'service' AND entity_id = $1",
        [String(target.id)],
      )).rows;
      if (targetAudit) continue;
      const [{ n: targetRules }] = (await pool.query(
        "SELECT count(*)::int AS n FROM service_pricing_rules WHERE service_id = $1",
        [target.id],
      )).rows;
      const [{ n: targetVariants }] = (await pool.query(
        "SELECT count(*)::int AS n FROM service_variants WHERE service_id = $1",
        [target.id],
      )).rows;
      const [{ n: targetAppointments }] = (await pool.query(
        "SELECT ((SELECT count(*) FROM appointments WHERE service_id = $1) + (SELECT count(*) FROM guest_bookings WHERE service_id = $1))::int AS n",
        [target.id],
      )).rows;
      const reference = REFERENCE_CATALOG.find((entry) => entry.slug === migration.referenceSlug);
      const basePrice = reference ? ("price" in reference ? reference.price : "rules" in reference ? Math.min(...reference.rules.map((rule: [string, number]) => rule[1])) : null) : null;
      const canMovePricing = !targetRules && !targetVariants && target.priceCents == null && !targetAppointments;
      if (canMovePricing) {
        if (source && migration.referenceSlug === "fnt-2025-stripping") {
          const sourceRules = await db.select().from(servicePricingRules).where(eq(servicePricingRules.serviceId, source.id));
          if (sourceRules.length) {
            await db.insert(servicePricingRules).values(sourceRules.map(({ id: _id, ...rule }) => ({ ...rule, serviceId: target.id })) as any);
          }
        }
        await db.update(services).set({
          ...(migration.targetName ? { name: migration.targetName } : {}),
          category: migration.category,
          priceCents: basePrice,
          pricingType: migration.type,
          priceFrom: true,
        }).where(eq(services.id, target.id));
      }
      if (migration.targetName && !targetAppointments) {
        await db.update(services).set({ name: migration.targetName }).where(eq(services.id, target.id));
      }

      if (source) {
        const [{ n: sourceAudit }] = (await pool.query(
          "SELECT count(*)::int AS n FROM audit_log WHERE entity = 'service' AND entity_id = $1",
          [String(source.id)],
        )).rows;
        const [{ n: sourceOperators }] = (await pool.query(
          "SELECT count(*)::int AS n FROM operator_services WHERE service_id = $1",
          [source.id],
        )).rows;
        const [{ n: sourceAppointments }] = (await pool.query(
          "SELECT ((SELECT count(*) FROM appointments WHERE service_id = $1) + (SELECT count(*) FROM guest_bookings WHERE service_id = $1))::int AS n",
          [source.id],
        )).rows;
        const alreadyIntegrated = target.priceCents != null || targetRules > 0 || targetVariants > 0;
        if ((canMovePricing || alreadyIntegrated) && !sourceAudit && !sourceOperators && !sourceAppointments) {
          await db.update(services).set({ active: false, visible: false, bookable: false }).where(eq(services.id, source.id));
        }
      }
    }

    for (const name of LEGACY_CATALOG_CATEGORIES) {
      const [category] = await db.select().from(serviceCategories).where(eq(serviceCategories.name, name)).limit(1);
      if (!category) continue;
      const [{ n: auditCount }] = (await pool.query(
        "SELECT count(*)::int AS n FROM audit_log WHERE entity = 'service_category' AND entity_id = $1",
        [String(category.id)],
      )).rows;
      if (!auditCount) await db.update(serviceCategories).set({ visible: false }).where(eq(serviceCategories.id, category.id));
    }
    await db.insert(settings).values({ key: PUBLIC_CATALOG_SEED_KEY, value: "1" }).onConflictDoNothing();
  }
}

const PAGES: { slug: string; title: string; subtitle?: string; body: string; seoDescription?: string }[] = [
  { slug: "home", title: "Benvenuto!", subtitle: "Toelettatura professionale a Cernusco sul Naviglio", body: "Da Dog's Planet il tuo cane è al centro di tutto: lo accogliamo con calma, lo trattiamo con prodotti professionali e te lo restituiamo pulito, profumato e felice.", seoDescription: "Dog's Planet: toelettatura professionale per cani a Cernusco sul Naviglio (MI). Lavaggio self-service 365 giorni, pensione casalinga e Fidelity Card." },
  { slug: "chi-siamo", title: "Chi siamo", subtitle: "Il pianeta dove i cani sono di casa", body: "Dog's Planet è il salone di toelettatura di Cernusco sul Naviglio dedicato al benessere del tuo cane.\n\nIl nostro team lavora su appuntamento per dedicare a ogni cane il tempo che merita, rispettando il suo carattere, la sua razza e le sue esigenze.\n\n## Il nostro metodo\n\n- Ascoltiamo te e osserviamo il tuo cane prima di iniziare\n- Usiamo prodotti professionali scelti per ogni tipo di mantello\n- Ti consigliamo come mantenere il pelo in ordine tra un appuntamento e l'altro" },
  { slug: "toelettatura", title: "Toelettatura", subtitle: "Cura professionale, su misura per il tuo cane", body: "La toelettatura è il cuore di Dog's Planet. Ogni trattamento parte da una valutazione del mantello: nodi, muta, sensibilità della pelle ed eventuali esigenze particolari.\n\n## Come funziona\n\n1. Registrati e crea la scheda del tuo cane\n2. Scegli servizio, operatore, giorno e orario\n3. Invia la richiesta: Dog's Planet la verifica e ti conferma l'appuntamento\n\nIl prezzo definitivo viene confermato dal salone in base a taglia e condizioni del pelo." },
  { slug: "servizi", title: "Servizi e listino", subtitle: "Prestazioni e prezzi di partenza", body: "I prezzi sono indicativi e possono variare in base a taglia, condizioni del pelo, presenza di nodi e trattamenti aggiuntivi. Il prezzo definitivo è confermato dal salone." },
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
    const email = (process.env.ADMIN_EMAIL || "info@dogsplanet.it").toLowerCase();
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
  await seedReferenceCatalog();

  for (const pg of PAGES) await db.insert(pages).values({
    ...pg,
    ...(pg.slug==="toelettatura"?{body:pg.body.replace(LEGACY_BOOKING_INSTRUCTIONS,BOOKING_INSTRUCTIONS)}:{}),
    ...(pg.slug==="privacy-policy"?{body:PRIVACY_DRAFT,subtitle:"Bozza da convalidare con il titolare"}:pg.slug==="cookie-policy"?{body:COOKIE_DRAFT,subtitle:"Bozza da convalidare con il titolare"}:{}),
  }).onConflictDoNothing({ target: pages.slug });
  // Aggiorna solo il vecchio paragrafo standard, conservando eventuali testi personalizzati.
  const [groomingPage] = await db.select().from(pages).where(eq(pages.slug, "toelettatura")).limit(1);
  if (groomingPage?.body?.includes(LEGACY_BOOKING_INSTRUCTIONS)) {
    await db.update(pages).set({
      body: groomingPage.body.replace(LEGACY_BOOKING_INSTRUCTIONS, BOOKING_INSTRUCTIONS),
      updatedAt: new Date(),
    }).where(and(eq(pages.id, groomingPage.id), eq(pages.body, groomingPage.body)));
  }
  const [legacyServicesPage] = await db.select().from(pages).where(eq(pages.slug, "servizi")).limit(1);
  if (legacyServicesPage?.title === "I nostri servizi" &&
      legacyServicesPage.subtitle === "Cura professionale per cani e gatti" &&
      legacyServicesPage.body === "Il trattamento e il prezzo vengono definiti dal salone in base a taglia, mantello e condizioni del pelo. Ogni richiesta è verificata prima della conferma dell'appuntamento.") {
    await db.update(pages).set({
      title: "Servizi e listino", subtitle: "Prestazioni e prezzi di partenza",
      body: "I prezzi sono indicativi e possono variare in base a taglia, condizioni del pelo, presenza di nodi e trattamenti aggiuntivi. Il prezzo definitivo è confermato dal salone.",
    }).where(eq(pages.id, legacyServicesPage.id));
  }

  const [{ n: faqCount }] = (await pool.query("SELECT count(*)::int AS n FROM faqs")).rows;
  if (faqCount === 0) await db.insert(faqs).values(SELF_FAQ.map((f, i) => ({ ...f, section: "selfservice", sortOrder: i })));
  await applyPhaseOneContent();
  await applyBookingContent();
}

if (process.argv[1] && process.argv[1].endsWith("seed.ts")) {
  (async () => { const { runMigrations } = await import("./migrate"); await runMigrations(); await seedIfEmpty(); await pool.end(); })()
    .catch((e) => { console.error(e); process.exit(1); });
}
