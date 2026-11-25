import { z } from "zod";

/** Dati comunicati dal titolare. P.IVA non fornita: mai dedurla dal codice fiscale. */
export const LEGAL_DEFAULTS = {
  companyName: "LUCARELLI FULVIO",
  legalForm: "impresa individuale",
  owner: "Fulvio Lucarelli",
  registeredOffice: "Via Firenze 10, Frazione Seggiano, 20096 Pioltello (MI), Italia",
  pec: "fulvio.lucarelli@pec.it",
  rea: "MI - 1915860",
  taxCode: "LCRFLV82E19F205P",
  vatNumber: "",
  providersConfirmed: false,
  transfersConfirmed: false,
  retentionConfirmed: false,
  trackingReviewed: false,
  legalReviewed: false,
  reviewNotes: "",
};
export const COOKIE_SCHEMA_VERSION = "2";
export const legalSettingsSchema=z.object({
  companyName:z.string().trim().min(1).max(160),legalForm:z.string().trim().min(1).max(100),
  owner:z.string().trim().min(1).max(160),registeredOffice:z.string().trim().min(1).max(300),
  pec:z.string().trim().email().max(255),rea:z.string().trim().max(60),taxCode:z.string().trim().max(32),
  vatNumber:z.string().trim().regex(/^(?:\d{11})?$/,"La P.IVA italiana deve contenere 11 cifre, oppure lascia vuoto. Non usare il CF."),
  providersConfirmed:z.boolean(),transfersConfirmed:z.boolean(),retentionConfirmed:z.boolean(),
  trackingReviewed:z.boolean(),legalReviewed:z.boolean(),reviewNotes:z.string().max(6000),
}).partial();
export const LEGAL_CHECKLIST = [
  "Richiedere al titolare la Partita IVA e inserirla prima della pubblicazione finale (DPR 633/1972, art. 35). Il CF non è la P.IVA.",
  "Convalidare i testi con il titolare e un consulente qualificato; questa preparazione non è una certificazione di conformità.",
  "Definire e documentare tempi o criteri concreti di conservazione per richieste, CRM, foto, account, fidelity, log, consensi e documenti fiscali; impostare le procedure di cancellazione.",
  "Verificare ruoli, contratti ex art. 28, accessi Promo App/personale e subfornitori realmente impiegati per Replit, database e App Storage.",
  "Verificare regione effettiva di hosting/database/storage, eventuali accessi e trasferimenti extra-SEE e garanzie applicabili. Non dichiarare che tutti i dati restano nell’UE.",
  "Confermare provider e contratti di email, pagamenti e push prima dell’attivazione; verificare eventuale DPO e recapito dedicato senza inventarli.",
  "Rifare l’inventario cookie/tag sul dominio finale, fuori dall’iframe Replit: controllare anche cookie di instradamento, log e risorse CMS/mappe/video.",
  "Prima di abilitare GA4, GTM o Meta aggiornare inventario, fornitori, durata, basi giuridiche, garanzie e test di consenso/revoca; GTM richiede audit di ogni tag.",
  "Verificare condizioni fidelity/pensione, destinatari ed adempimenti fiscali; #LaPappadiPoppy resta Coming Soon ed il checkout pubblico resta disabilitato.",
] as const;
