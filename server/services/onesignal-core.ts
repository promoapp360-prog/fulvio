export const ONESIGNAL_REMINDER_HOURS = 24;

export const ONESIGNAL_DEFAULTS = {
  enabled: true,
  expectedOrigin: "https://dogs-planet.replit.app",
  quietHoursStart: 8,
  quietHoursEnd: 20,
  automations: {
    requestReceived: { enabled: true, title: "Richiesta ricevuta", body: "Ciao {{nome}}, abbiamo ricevuto la richiesta per {{cane}}. Ti aggiorneremo appena il salone la avrà valutata." },
    appointmentConfirmed: { enabled: true, title: "Appuntamento confermato", body: "Ciao {{nome}}, ti aspettiamo il {{data}} per {{cane}}." },
    paymentRequired: { enabled: true, title: "Completa la prenotazione", body: "Ciao {{nome}}, completa il pagamento per confermare l’appuntamento di {{cane}}." },
    appointmentChanged: { enabled: true, title: "Appuntamento aggiornato", body: "Ciao {{nome}}, il tuo appuntamento è stato aggiornato. Controlla i dettagli nella tua area personale." },
    appointmentCancelled: { enabled: true, title: "Appuntamento annullato", body: "Ciao {{nome}}, l'appuntamento è stato annullato. Per informazioni contatta il salone." },
    reminder: { enabled: true, title: "Poppy ti ricorda l'appuntamento", body: "Ciao {{nome}}, domani {{cane}} ti aspetta a Dog's Planet. A presto!" },
    dogReady: { enabled: true, title: "Poppy ha una bella notizia!", body: "Ciao {{nome}}, {{cane}} è pronto. Ti aspettiamo in salone!" },
    recall: { enabled: false, title: "Poppy ti saluta", body: "Ciao {{nome}}, quando vuoi siamo qui per prenderti cura di {{cane}}." },
    marketing: { enabled: false, title: "Una novità da Dog's Planet", body: "Scopri le novità del salone." },
  },
} as const;

export type OneSignalAutomationKey = keyof typeof ONESIGNAL_DEFAULTS.automations;

export function normalizeOneSignalSettings(input: any) {
  const source = input && typeof input === "object" ? input : {};
  const automations = Object.fromEntries(
    Object.entries(ONESIGNAL_DEFAULTS.automations).map(([key, defaults]) => {
      const value = source.automations?.[key] || {};
      return [key, {
        enabled: typeof value.enabled === "boolean" ? value.enabled : defaults.enabled,
        title: typeof value.title === "string" ? value.title.slice(0, 160) : defaults.title,
        body: typeof value.body === "string" ? value.body.slice(0, 500) : defaults.body,
      }];
    }),
  ) as Record<OneSignalAutomationKey, { enabled: boolean; title: string; body: string }>;
  return {
    enabled: typeof source.enabled === "boolean" ? source.enabled : ONESIGNAL_DEFAULTS.enabled,
    expectedOrigin: typeof source.expectedOrigin === "string" ? source.expectedOrigin.slice(0, 250) : ONESIGNAL_DEFAULTS.expectedOrigin,
    quietHoursStart: Number.isInteger(source.quietHoursStart) ? Math.max(0, Math.min(23, source.quietHoursStart)) : ONESIGNAL_DEFAULTS.quietHoursStart,
    quietHoursEnd: Number.isInteger(source.quietHoursEnd) ? Math.max(1, Math.min(24, source.quietHoursEnd)) : ONESIGNAL_DEFAULTS.quietHoursEnd,
    automations,
  };
}

export function renderOneSignalText(template: string, vars: Record<string, unknown>) {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key: string) => {
    const value = vars[key];
    return value === null || value === undefined ? "" : String(value).slice(0, 300);
  }).replace(/\s{2,}/g, " ").trim();
}

/** Promemoria entro l'intervallo locale Roma; anticipa al giorno precedente alle 19:59 quando necessario. */
export function oneSignalReminderAt(startAt: Date, confirmedAt: Date, hours: number, startHour = 8, endHour = 20) {
  if (!Number.isFinite(startAt.getTime()) || !Number.isFinite(confirmedAt.getTime()) ||
    startAt.getTime() - confirmedAt.getTime() <= hours * 3_600_000) return null;
  let due = new Date(startAt.getTime() - hours * 3_600_000);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(due);
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  const hour = Number(p.hour);
  if (hour < startHour || hour >= endHour) {
    const localDay = `${p.year}-${p.month}-${p.day}`;
    const [year, month, day] = localDay.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day + (hour >= endHour ? 0 : -1), 19, 59));
    const offset = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Rome", timeZoneName: "shortOffset" }).formatToParts(date).find(x => x.type === "timeZoneName")?.value || "GMT+1";
    const match = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(offset);
    const off = match ? (match[1] === "-" ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3] || 0)) : 60;
    due = new Date(date.getTime() - off * 60_000);
  }
  return due.getTime() > confirmedAt.getTime() ? due : null;
}
