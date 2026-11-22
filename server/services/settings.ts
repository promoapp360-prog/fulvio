import { db } from "../db";
import { settings } from "../../shared/schema";
import { sql } from "drizzle-orm";
import { BUSINESS } from "../../shared/constants";

export const DEFAULT_SETTINGS = {
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
  loyalty: { enabled: true, pointsPerEuro: 1, welcomePoints: 10, birthdayPoints: 20 },
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
    heroTitle: "Benvenuto da Dog's Planet!",
    heroText: "Toelettatura professionale a Cernusco sul Naviglio: cura, esperienza e tanto amore per il tuo cane.",
    announcement: "",
    shopEnabled: false,
    boardingEnabled: true,
    socialFacebook: "",
    socialInstagram: "",
  },
  seo: {
    defaultTitle: "Dog's Planet – Toelettatura cani a Cernusco sul Naviglio",
    defaultDescription: "Toelettatura professionale, lavaggio self-service 365 giorni, pensione casalinga e Fidelity Card a Cernusco sul Naviglio (MI).",
    gaMeasurementId: "",
    gtmId: "",
    metaPixelId: "",
  },
  shop: { pickupOnly: true, shippingCents: 0, freeShippingFromCents: 0 },
  boarding: { dailyPriceCents: null as number | null, info: "Su richiesta, con disponibilità limitata." },
};
export type Settings = typeof DEFAULT_SETTINGS;
export type SettingsKey = keyof Settings;

let cache: Settings | null = null;

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
    selfservice: s.selfservice,
    site: s.site,
    seo: s.seo,
    booking: { slotMinutes: s.booking.slotMinutes, maxDaysAhead: s.booking.maxDaysAhead, allowAnyOperator: s.booking.allowAnyOperator },
    loyalty: { enabled: s.loyalty.enabled, pointsPerEuro: s.loyalty.pointsPerEuro },
    shop: s.shop,
    boarding: s.boarding,
    pushPublicKey: process.env.VAPID_PUBLIC_KEY || null,
    onlinePayments: !!process.env.STRIPE_SECRET_KEY && s.payments.onlineEnabled,
  };
}
