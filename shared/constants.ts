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
  email: "dogsplanetcernusco@gmail.com",
  timezone: "Europe/Rome",
};

export const fullAddress = `${BUSINESS.address}, ${BUSINESS.cap} ${BUSINESS.city} (${BUSINESS.province})`;
export const googleMapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(fullAddress + ", Italia")}`;
export const appleMapsUrl = `https://maps.apple.com/?daddr=${encodeURIComponent(fullAddress + ", Italia")}`;
export const mapEmbedUrl = `https://www.google.com/maps?q=${encodeURIComponent(fullAddress + ", Italia")}&output=embed`;

export const PERMISSIONS = {
  agenda: "Agenda",
  richieste: "Richieste di prenotazione",
  clienti: "Clienti e cani",
  servizi: "Servizi e listino",
  operatori: "Operatori e turni",
  ore: "Ore lavorate e compensi",
  pagamenti: "Pagamenti e incassi",
  selfservice: "Self-service",
  fidelity: "Fidelity Card",
  shop: "Shop e ordini",
  magazzino: "Magazzino e fornitori",
  pensione: "Pensione casalinga",
  contenuti: "Contenuti del sito",
  marketing: "Promozioni e comunicazioni",
  statistiche: "Statistiche e report",
  utenti: "Utenti e permessi",
  impostazioni: "Impostazioni",
} as const;
export type Permission = keyof typeof PERMISSIONS;

export const ROLE_LABELS: Record<string, string> = {
  admin: "Amministratore", staff: "Staff", operator: "Operatore", customer: "Cliente",
};

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

export const SIZES = ["piccola", "media", "grande", "gigante"] as const;
export const SIZE_LABELS: Record<string, string> = { piccola: "Piccola", media: "Media", grande: "Grande", gigante: "Gigante" };

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
  richiesta: "Richiesta", confermata: "Confermata", rifiutata: "Rifiutata", in_corso: "In corso", completata: "Completata", annullata: "Annullata",
};

export const WEEKDAYS = ["Domenica", "Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato"];

export const euro = (cents: number | null | undefined) =>
  cents == null ? "—" : (cents / 100).toLocaleString("it-IT", { style: "currency", currency: "EUR" });
