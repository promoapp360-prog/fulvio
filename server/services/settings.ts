import { pushConfiguration } from "./push-config";
import { ONESIGNAL_DEFAULTS } from "./onesignal-core";
import { db } from "../db";
import { settings } from "../../shared/schema";
import { sql } from "drizzle-orm";
import { BUSINESS } from "../../shared/constants";
import { LEGAL_DEFAULTS } from "../../shared/legal";
import { PUBLIC_COPY } from "../../shared/public-copy";

export const DEFAULT_SETTINGS = {
  pricing: {
    hourlyRateCents: 5000,
  },
  booking: {
    slotMinutes: 30,          // griglia: 15, 30, 45, 60 o personalizzata
    bufferMin: 0,             // intervallo tra appuntamenti
    minNoticeHours: 12,       // preavviso minimo richieste online
    maxDaysAhead: 60,         // finestra prenotabile
    requestBlocksSlot: true,  // le richieste in attesa occupano lo slot
    allowAnyOperator: true,   // il cliente può scegliere "Nessuna preferenza"
  },
  payments: {
    defaultMode: "negozio",   // nessuno | acconto | saldo | negozio
    depositPercent: 30,
    onlineEnabled: false,     // si attiva solo con STRIPE_SECRET_KEY impostata
    customMethods: [] as string[],
  },
  loyalty: {
    enabled: true,
    pointsPerEuro: 1,              // rapporto euro/punti
    welcomePoints: 0,
    birthdayPoints: 0,
    earnOnServices: true,          // i singoli servizi/prodotti possono essere esclusi dalle loro schede
    earnOnProducts: true,
    pointValueCents: 0,            // valore di 1 punto per sconti/credito shop (0 = conversione disattivata finché non impostata)
    minRedeemPoints: 0,
    expiryMode: "annuale" as "nessuna" | "annuale" | "fissa" | "periodo",
    expiryFixedDate: "12-31",      // per scadenza fissa (MM-GG)
    expiryDays: 365,               // per scadenza dopo un periodo
  },
  staff: { roundingStep: 15, roundingMode: "vicino" as "vicino" | "difetto" | "eccesso", payWeekday: 6 },
  notifications: { reminderHours: 24, recallEnabled: true, recallDefaultDays: null as number | null },
  onesignal: structuredClone(ONESIGNAL_DEFAULTS),
  cancellation: {
    cancelHours: 24,               // il cliente può annullare da solo fino a N ore prima
    rescheduleHours: 24,           // termine per chiedere uno spostamento
    depositPolicy: "In caso di cancellazione oltre il termine l'acconto può essere trattenuto.",
    reasons: ["Richiesta del cliente", "Cliente non disponibile", "Malattia del cane", "Indisponibilità operatore", "Chiusura straordinaria", "Altro"],
  },
  brand: {
    logoUrl: "", logoWhiteUrl: "", heroImageUrl: "",
    mascotWelcome: "", mascotGrooming: "", mascotSelfService: "", mascotBoarding: "", mascotShop: "", mascotFidelity: "",
    bannerText: "", bannerUrl: "", bannerImageUrl: "", bannerActive: false,
  },
  legal: { ...LEGAL_DEFAULTS },
  business: {
    ...BUSINESS,
    groomingHours: "Lunedì–Sabato 08:45–19:00 (su appuntamento)",
    mapsQuery: "",
  },
  selfservice: {
    days: "Tutti i giorni, 365 giorni all'anno",
    hours: "08:00–22:00",
    stations: ["Box 1", "Box 2"],
    categories: ["Lavaggio", "Asciugatura", "Ricarica tessera"],
  },
  site: {
    heroTitle: PUBLIC_COPY.heroTitle,
    heroText: PUBLIC_COPY.heroText,
    announcement: "",
    shopEnabled: false,
    boardingEnabled: true,
    socialFacebook: "",
    socialInstagram: "",
    socialYoutube: "",
    socialTiktok: "",
  },
  reviews: {
    count: null as number | null,
    rating: null as number | null,
    googleUrl: "",
    googlePlaceId: "",
    images: [] as { url: string; alt: string }[],
  },
  seo: {
    defaultTitle: "Dog's Planet – Toelettatura cani a Cernusco sul Naviglio",
    defaultDescription: "Toelettatura professionale, lavaggio self-service 365 giorni, pensione casalinga e Fidelity Card a Cernusco sul Naviglio (MI).",
    gaMeasurementId: "",
    gtmId: "",
    metaPixelId: "",
    searchConsoleVerification: "",
  },
  shop: {
    pickupEnabled: true,
    pickupInfo: "Ritiro gratuito in negozio negli orari di apertura.",
    deliveryEnabled: false,
    // zone servite: { name, caps: ["20063"], costCents, freeFromCents, eta, active }
    deliveryZones: [] as { name: string; caps: string[]; costCents: number; freeFromCents?: number | null; eta?: string; active?: boolean }[],
  },
  boarding: { dailyPriceCents: null as number | null, info: "Su richiesta, con disponibilità limitata." },
};
export type Settings = typeof DEFAULT_SETTINGS;
export type SettingsKey = keyof Settings;

let cache: Settings | null = null;
export function clearSettingsCache() { cache = null; }

export async function getSettings(): Promise<Settings> {
  if (cache) return cache;
  const rows = await db.select().from(settings);
  const merged: any = structuredClone(DEFAULT_SETTINGS);
  for (const r of rows) {
    if (r.key in merged && typeof r.value === "object" && r.value) merged[r.key] = { ...merged[r.key], ...(r.value as object) };
  }
  cache = merged;
  return merged;
}

export async function setSetting<K extends SettingsKey>(key: K, value: Partial<Settings[K]>) {
  const current = (await getSettings())[key];
  const next = { ...current, ...value };
  await db.insert(settings).values({ key, value: next })
    .onConflictDoUpdate({ target: settings.key, set: { value: next, updatedAt: sql`now()` } });
  cache = null;
  return next;
}

/** Sottoinsieme sicuro da esporre al sito pubblico */
export async function publicSettings() {
  const s = await getSettings();
  return {
    business: s.business,
    pricing: { hourlyRateCents: s.pricing.hourlyRateCents },
    selfservice: s.selfservice,
    site: s.site,
    seo: s.seo,
    booking: { slotMinutes: s.booking.slotMinutes, maxDaysAhead: s.booking.maxDaysAhead, allowAnyOperator: s.booking.allowAnyOperator },
    loyalty: { enabled: s.loyalty.enabled, pointsPerEuro: s.loyalty.pointsPerEuro },
    shop: s.shop,
    brand: s.brand,
    legal: {
      companyName:s.legal.companyName,legalForm:s.legal.legalForm,owner:s.legal.owner,
      registeredOffice:s.legal.registeredOffice,pec:s.legal.pec,rea:s.legal.rea,taxCode:s.legal.taxCode,
      vatNumber:s.legal.vatNumber,trackingReviewed:s.legal.trackingReviewed,
    },
    cancellation: { cancelHours: s.cancellation.cancelHours, rescheduleHours: s.cancellation.rescheduleHours, depositPolicy: s.cancellation.depositPolicy },
    loyaltyRules: { pointValueCents: s.loyalty.pointValueCents, minRedeemPoints: s.loyalty.minRedeemPoints, expiryMode: s.loyalty.expiryMode },
    boarding: s.boarding,
    pushConfigured: pushConfiguration.configured || (!!process.env.ONESIGNAL_APP_ID && !!process.env.ONESIGNAL_APP_API_KEY && s.onesignal.enabled),
    pushPublicKey: pushConfiguration.publicKey,
    oneSignalEnabled: !!process.env.ONESIGNAL_APP_ID && !!process.env.ONESIGNAL_APP_API_KEY && s.onesignal.enabled,
    emailConfigured: !!process.env.SMTP_HOST,
    onlinePayments: !!process.env.STRIPE_SECRET_KEY && s.payments.onlineEnabled,
  };
}
