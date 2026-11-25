export const BUSINESS = {
  name: "Dog's Planet",
  tagline: "Pet Grooming",
  referent: "Fulvio",
  address: "Via Leonardo da Vinci 86",
  city: "Cernusco sul Naviglio",
  province: "MI",
  cap: "20063",
  country: "Italia",
  phone: "389 9082610",
  phoneIntl: "+393899082610",
  whatsapp: "393899082610",
  email: "info@dogsplanet.it",
  timezone: "Europe/Rome",
};

export const fullAddress = `${BUSINESS.address}, ${BUSINESS.cap} ${BUSINESS.city} (${BUSINESS.province})`;
export const googleMapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(fullAddress + ", Italia")}`;
export const appleMapsUrl = `https://maps.apple.com/?daddr=${encodeURIComponent(fullAddress + ", Italia")}`;
export const mapEmbedUrl = `https://www.google.com/maps?q=${encodeURIComponent(fullAddress + ", Italia")}&output=embed`;

// Permessi configurabili (punto 29) – verificati sempre dal backend
export const PERMISSIONS = {
  agenda_view: "Visualizzare agenda",
  agenda_edit: "Modificare agenda",
  richieste: "Confermare richieste",
  clienti: "Consultare clienti",
  clienti_edit: "Modificare clienti",
  cani_edit: "Modificare schede cane",
  servizi: "Consultare servizi",
  pagamenti: "Registrare pagamenti",
  incassi: "Visualizzare incassi",
  magazzino: "Gestire magazzino",
  statistiche: "Visualizzare statistiche",
  personale: "Gestire personale",
  impostazioni: "Accedere alle impostazioni",
  shop: "Gestire prodotti e ordini",
  pensione: "Gestire pensione casalinga",
  fidelity: "Gestire Fidelity Card",
  marketing: "Promozioni e comunicazioni",
  contenuti: "Contenuti sito e SEO",
  privacy: "Privacy e consensi",
  utenti: "Utenti e permessi",
} as const;
export type Permission = keyof typeof PERMISSIONS;

export const ROLE_LABELS: Record<string, string> = {
  admin: "Admin", manager: "Responsabile", operator: "Operatore", customer: "Cliente",
};
/** Permessi predefiniti dell'operatore: agenda e ore personali. */
export const OPERATOR_DEFAULT_PERMS = ["agenda_view"];

export const STATUS_LABELS: Record<string, string> = {
  richiesta: "Richiesta ricevuta",
  in_valutazione: "In valutazione",
  proposta: "Proposta di modifica",
  confermata: "Confermata",
  attesa_pagamento: "In attesa pagamento",
  completata: "Completata",
  annullata: "Annullata",
  rifiutata: "Rifiutata",
  assente: "Cliente assente",
};

export const STATUS_COLORS: Record<string, string> = {
  richiesta: "#F59E0B",
  in_valutazione: "#8B5CF6",
  proposta: "#EC4899",
  confermata: "#00B6C8",
  attesa_pagamento: "#2E8DE6",
  completata: "#16A34A",
  annullata: "#9CA3AF",
  rifiutata: "#EF4444",
  assente: "#7C2D12",
};

export const SIZES = ["mini", "piccola", "media", "grande", "gigante"] as const;
export const SIZE_LABELS: Record<string, string> = { mini: "Mini", piccola: "Piccola", media: "Media", grande: "Grande", gigante: "Gigante" };

export const PAYMENT_METHODS: Record<string, string> = {
  contanti: "Contanti",
  pos: "POS",
  satispay: "Satispay",
  bonifico_istantaneo: "Bonifico istantaneo",
  bonifico: "Bonifico ordinario",
  online: "Online",
  altro: "Altro",
};

export const PAYMENT_KINDS: Record<string, string> = {
  acconto: "Acconto", saldo: "Saldo", totale: "Totale", parziale: "Parziale", rimborso: "Rimborso",
};

export const PAYMENT_MODES: Record<string, string> = {
  nessuno: "Nessun pagamento anticipato",
  acconto: "Acconto online",
  saldo: "Saldo online completo",
  negozio: "Pagamento in negozio",
};

export const ORDER_STATUS: Record<string, string> = {
  in_attesa: "In attesa", pagato: "Pagato", in_preparazione: "In preparazione", pronto: "Pronto al ritiro",
  spedito: "Spedito", completato: "Completato", annullato: "Annullato",
};

export const BOARDING_STATUS: Record<string, string> = {
  richiesta: "Richiesta", info_richieste: "Informazioni richieste", proposta: "Nuove date proposte", confermata: "Confermata", rifiutata: "Rifiutata", in_corso: "In corso", completata: "Completata", annullata: "Annullata",
};

export const WEEKDAYS = ["Domenica", "Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato"];

export const euro = (cents: number | null | undefined) =>
  cents == null ? "—" : (cents / 100).toLocaleString("it-IT", { style: "currency", currency: "EUR" });

export const LOYALTY_KINDS: Record<string, string> = {
  accumulo: "Accumulo", utilizzo: "Utilizzo", scadenza: "Scadenza", proroga: "Proroga", rettifica: "Rettifica", storno: "Storno",
};

export const EMAIL_TEMPLATE_KEYS: Record<string, string> = {
  registrazione: "Registrazione",
  verifica_email: "Verifica email",
  recupero_password: "Recupero password",
  richiesta_ricevuta: "Richiesta appuntamento ricevuta",
  appuntamento_confermato: "Conferma appuntamento",
  appuntamento_pagamento: "Pagamento richiesto",
  appuntamento_proposta: "Proposta nuovo orario",
  appuntamento_modificato: "Modifica appuntamento",
  appuntamento_annullato: "Cancellazione appuntamento",
  appuntamento_rifiutato: "Richiesta non accettata",
  appuntamento_completato: "Trattamento completato",
  promemoria: "Promemoria appuntamento",
  richiamo: "Richiamo periodico",
  ordine_confermato: "Conferma ordine",
  ordine_stato: "Modifica stato ordine",
  pensione_aggiornamento: "Aggiornamento pensione",
  comunicazione: "Comunicazione amministrativa",
};
