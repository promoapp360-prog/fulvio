import { and, desc, eq, gt, inArray, lte, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { db } from "../db";
import { appointments, dogs, oneSignalDevices, oneSignalMessages, users, type User } from "../../shared/schema";
import { getSettings } from "./settings";
import { normalizeOneSignalSettings, oneSignalReminderAt, renderOneSignalText, type OneSignalAutomationKey } from "./onesignal-core";
import { fmtRome } from "../time";

const APP_ID = () => process.env.ONESIGNAL_APP_ID?.trim() || "";
const API_KEY = () => process.env.ONESIGNAL_APP_API_KEY?.trim() || "";
const API = "https://api.onesignal.com";
type OneSignalAppInfo = {
  configured: boolean; reachable: boolean; appId: string | null; name: string | null;
  webOrigin: string | null; safariOrigin: string | null; safariWebId: string | null; error: string | null;
};
let appConfigCache: { expiresAt: number; value: OneSignalAppInfo } | null = null;

export function oneSignalCredentialsConfigured() {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(APP_ID()) && API_KEY().length > 20;
}

async function request(path: string, init: RequestInit = {}) {
  if (!oneSignalCredentialsConfigured()) throw new Error("Credenziali OneSignal non configurate");
  const response = await fetch(`${API}${path}`, {
    ...init,
    signal: init.signal || AbortSignal.timeout(12_000),
    headers: {
      Authorization: `Key ${API_KEY()}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  return response;
}

async function safeBody(response: Response) {
  try {
    const json: any = await response.json();
    return {
      id: typeof json.id === "string" ? json.id : null,
      name: typeof json.name === "string" ? json.name : null,
      chromeOrigin: typeof json.chrome_web_origin === "string" ? json.chrome_web_origin : null,
      safariOrigin: typeof json.safari_site_origin === "string" ? json.safari_site_origin : null,
      safariWebId: typeof json.safari_push_id === "string" ? json.safari_push_id : null,
      error: (Array.isArray(json.errors) ? json.errors[0] : json.error?.message) || null,
      body: json,
    };
  } catch {
    return { id: null, name: null, chromeOrigin: null, safariOrigin: null, safariWebId: null, error: "Risposta OneSignal non valida", body: {} };
  }
}

export async function inspectOneSignalApp(): Promise<OneSignalAppInfo> {
  if (appConfigCache && appConfigCache.expiresAt > Date.now()) return appConfigCache.value;
  if (!oneSignalCredentialsConfigured()) return { configured: false, reachable: false, appId: null, name: null, webOrigin: null, safariOrigin: null, safariWebId: null, error: "Secrets mancanti o non validi" };
  try {
    const response = await request(`/apps/${encodeURIComponent(APP_ID())}`);
    const result = await safeBody(response);
    const value = {
      configured: response.ok && result.id === APP_ID(),
      reachable: response.ok,
      appId: result.id,
      name: result.name,
      webOrigin: result.chromeOrigin,
      safariOrigin: result.safariOrigin,
      safariWebId: result.safariWebId,
      error: response.ok ? null : String(result.error || `OneSignal HTTP ${response.status}`).slice(0, 250),
    };
    appConfigCache = { value, expiresAt: Date.now() + 5 * 60_000 };
    return value;
  } catch (error) {
    const value = { configured: false, reachable: false, appId: null, name: null, webOrigin: null, safariOrigin: null, safariWebId: null, error: String((error as Error).message || "Errore OneSignal").slice(0, 250) };
    appConfigCache = { value, expiresAt: Date.now() + 30_000 };
    return value;
  }
}

export async function getOneSignalBrowserConfig(requestOrigin?: string) {
  const s = normalizeOneSignalSettings((await getSettings()).onesignal);
  const app = await inspectOneSignalApp();
  if (!app.configured) return { configured: false, enabled: false, expectedOrigin: s.expectedOrigin };
  const enabled = s.enabled && app.webOrigin === s.expectedOrigin && app.safariOrigin === s.expectedOrigin &&
    (!requestOrigin || new URL(requestOrigin).origin === s.expectedOrigin);
  return { configured: true, enabled, expectedOrigin: s.expectedOrigin, appId: APP_ID(), safariWebId: app.safariWebId };
}

async function makePayload(userId: number, title: string, body: string, url?: string, sendAfter?: Date, idempotencyKey?: string) {
  const baseUrl = normalizeOneSignalSettings((await getSettings()).onesignal).expectedOrigin;
  const target = url ? new URL(url, baseUrl) : new URL("/", baseUrl);
  if (target.origin !== new URL(baseUrl).origin) throw new Error("Link not autorizzato per la notifica");
  const payload: Record<string, any> = {
    app_id: APP_ID(),
    include_aliases: { external_id: [String(userId)] },
    target_channel: "push",
    headings: { it: title.slice(0, 160) },
    contents: { it: body.slice(0, 500) },
    url: target.toString(),
    idempotency_key: idempotencyKey,
  };
  if (sendAfter) payload.send_after = sendAfter.toISOString();
  return payload;
}

function deterministicKey(input: string) {
  const bytes = Buffer.from(createHash("sha256").update(input).digest().subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function deliver(userId: number, automationKey: string, title: string, body: string, options: {
  appointmentId?: number; url?: string; sendAfter?: Date; idempotencyKey?: string;
}) {
  let providerMessageId: string | null = null;
  try {
    const response = await request("/notifications", { method: "POST", body: JSON.stringify(await makePayload(userId, title, body, options.url, options.sendAfter, options.idempotencyKey)) });
    const result = await safeBody(response);
    providerMessageId = result.id;
    if (!response.ok) throw new Error(String(result.error || `OneSignal HTTP ${response.status}`).slice(0, 250));
    const status = result.id ? (options.sendAfter ? "programmata" : "accettata") : "nessun_dispositivo";
    await db.insert(oneSignalMessages).values({
      providerMessageId, userId, appointmentId: options.appointmentId ?? null, automationKey,
      title: title.slice(0, 160), body: body.slice(0, 500), status,
      scheduledAt: options.sendAfter ?? null,
    });
    return { accepted: !!result.id, id: result.id, status };
  } catch (error) {
    await db.insert(oneSignalMessages).values({
      providerMessageId, userId, appointmentId: options.appointmentId ?? null, automationKey,
      title: title.slice(0, 160), body: body.slice(0, 500), status: "errore",
      scheduledAt: options.sendAfter ?? null, error: String((error as Error).message || "Errore OneSignal").slice(0, 500),
    }).catch(() => {});
    return { accepted: false, id: null, status: "errore" };
  }
}

export async function sendOneSignalAutomation(userId: number, key: OneSignalAutomationKey, vars: Record<string, unknown> = {}, options: { appointmentId?: number; url?: string; dedupeKey?: string } = {}) {
  const settings = normalizeOneSignalSettings((await getSettings()).onesignal);
  if (!settings.enabled || !oneSignalCredentialsConfigured()) return false;
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user?.active || !user.commPush || (key === "marketing" && !user.consentMarketing)) return false;
  const [device] = await db.select({ id: oneSignalDevices.id }).from(oneSignalDevices)
    .where(and(eq(oneSignalDevices.userId, userId), eq(oneSignalDevices.active, true))).limit(1);
  if (!device) return false;
  const message = settings.automations[key];
  if (!message.enabled) return false;
  const data = { nome: user.firstName, ...vars };
  const title = renderOneSignalText(message.title, data);
  const body = renderOneSignalText(message.body, data);
  if (!title || !body) return false;
  const payloadKey = options.dedupeKey || `${key}:${userId}:${Date.now()}`;
  return (await deliver(userId, key, title, body, { ...options, idempotencyKey: deterministicKey(payloadKey) })).accepted;
}

export async function sendOneSignalTest(user: User) {
  const settings = normalizeOneSignalSettings((await getSettings()).onesignal);
  if (!settings.enabled) throw new Error("OneSignal è disattivato nel gestionale.");
  const [device] = await db.select({ id: oneSignalDevices.id }).from(oneSignalDevices)
    .where(and(eq(oneSignalDevices.userId, user.id), eq(oneSignalDevices.active, true))).limit(1);
  if (!device) throw new Error("Attiva prima le notifiche OneSignal sul tuo account Admin.");
  return deliver(user.id, "test", "Prova notifiche Dog's Planet", "Ciao! Poppy ti manda una zampina di prova.", {
    url: "/account", idempotencyKey: deterministicKey(`test:${user.id}:${Date.now()}`),
  });
}

export async function sendOneSignalManualMarketing(userId: number, title: string, body: string) {
  const settings = normalizeOneSignalSettings((await getSettings()).onesignal);
  if (!settings.enabled || !settings.automations.marketing.enabled || !oneSignalCredentialsConfigured()) throw new Error("Le promozioni OneSignal non sono attive.");
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user?.active || !user.commPush || !user.consentMarketing) throw new Error("Il cliente non risulta autorizzato alle comunicazioni promozionali push.");
  const [device] = await db.select({ id: oneSignalDevices.id }).from(oneSignalDevices)
    .where(and(eq(oneSignalDevices.userId, userId), eq(oneSignalDevices.active, true))).limit(1);
  if (!device) throw new Error("Il cliente non ha un dispositivo OneSignal attivo.");
  return deliver(userId, "marketing", title, body, {
    url: "/", idempotencyKey: deterministicKey(`manual-marketing:${userId}:${Date.now()}:${title}`),
  });
}

export async function scheduleOneSignalReminder(appointmentId: number, now = new Date()) {
  const allSettings = await getSettings();
  const settings = normalizeOneSignalSettings(allSettings.onesignal);
  const pending = await db.select().from(oneSignalMessages).where(and(eq(oneSignalMessages.appointmentId, appointmentId), eq(oneSignalMessages.automationKey, "reminder"), eq(oneSignalMessages.status, "programmata")));
  for (const item of pending) if (!(await cancelOneSignalMessage(item.id, item.providerMessageId))) return false;

  const [row] = await db.select({ appointment: appointments, customer: users, dogName: dogs.name })
    .from(appointments).innerJoin(users, eq(users.id, appointments.customerId)).innerJoin(dogs, eq(dogs.id, appointments.dogId))
    .where(eq(appointments.id, appointmentId)).limit(1);
  if (!row || row.appointment.status !== "confermata" || !settings.enabled || !settings.automations.reminder.enabled ||
    !oneSignalCredentialsConfigured() || !row.customer.commPush || !row.customer.active) return false;
  const [device] = await db.select({ id: oneSignalDevices.id }).from(oneSignalDevices)
    .where(and(eq(oneSignalDevices.userId, row.customer.id), eq(oneSignalDevices.active, true))).limit(1);
  if (!device) return false;
  const sendAt = oneSignalReminderAt(row.appointment.startAt, now, allSettings.notifications.reminderHours, settings.quietHoursStart, settings.quietHoursEnd);
  if (!sendAt || sendAt.getTime() > now.getTime() + 30 * 86_400_000) return false;
  const title = renderOneSignalText(settings.automations.reminder.title, { nome: row.customer.firstName, cane: row.dogName });
  const body = renderOneSignalText(settings.automations.reminder.body, { nome: row.customer.firstName, cane: row.dogName, data: fmtRome(row.appointment.startAt) });
  return (await deliver(row.customer.id, "reminder", title, body, {
    appointmentId, url: "/account/appuntamenti", sendAfter: sendAt,
    idempotencyKey: deterministicKey(`reminder:${appointmentId}:${row.appointment.startAt.getTime()}:${sendAt.getTime()}`),
  })).accepted;
}

export async function scheduleUpcomingOneSignalReminders(now = new Date()) {
  const allSettings = await getSettings();
  const settings = normalizeOneSignalSettings(allSettings.onesignal);
  if (!settings.enabled || !settings.automations.reminder.enabled || !oneSignalCredentialsConfigured()) return 0;
  const reminderWindow = new Date(now.getTime() + Math.max(0, allSettings.notifications.reminderHours - 1) * 60 * 60_000);
  const horizon = new Date(now.getTime() + 30 * 86_400_000);
  const rows = await db.selectDistinct({ id: appointments.id }).from(appointments)
    .innerJoin(users, eq(users.id, appointments.customerId))
    .innerJoin(oneSignalDevices, eq(oneSignalDevices.userId, users.id))
    .where(and(
      eq(appointments.status, "confermata"), eq(users.active, true), eq(users.commPush, true), eq(oneSignalDevices.active, true),
      gt(appointments.startAt, reminderWindow), lte(appointments.startAt, horizon),
      sql`not exists (select 1 from onesignal_messages m where m.appointment_id = ${appointments.id} and m.automation_key = 'reminder' and m.status = 'programmata')`,
    )).limit(500);
  let scheduled = 0;
  for (const row of rows) if (await scheduleOneSignalReminder(row.id, now)) scheduled++;
  return scheduled;
}

export async function refreshOneSignalSchedules(now = new Date()) {
  const pending = await db.selectDistinct({ appointmentId: oneSignalMessages.appointmentId }).from(oneSignalMessages)
    .where(and(eq(oneSignalMessages.automationKey, "reminder"), eq(oneSignalMessages.status, "programmata")));
  let refreshed = 0;
  for (const row of pending) if (row.appointmentId && await scheduleOneSignalReminder(row.appointmentId, now)) refreshed++;
  const added = await scheduleUpcomingOneSignalReminders(now);
  return { refreshed, added, considered: pending.length };
}

async function cancelOneSignalMessage(logId: number, providerMessageId: string | null) {
  if (!providerMessageId || !oneSignalCredentialsConfigured()) {
    await db.update(oneSignalMessages).set({
      status: "errore", error: !providerMessageId ? "ID messaggio OneSignal assente" : "Credenziali OneSignal non disponibili per annullare il promemoria",
      updatedAt: new Date(),
    }).where(eq(oneSignalMessages.id, logId));
    return false;
  }
  try {
    const response = await request(`/notifications/${encodeURIComponent(providerMessageId)}?app_id=${encodeURIComponent(APP_ID())}`, { method: "DELETE" });
    if (!response.ok) {
      const result = await safeBody(response);
      await db.update(oneSignalMessages).set({
        status: "errore", error: String(result.error || `OneSignal HTTP ${response.status}`).slice(0, 500), updatedAt: new Date(),
      }).where(eq(oneSignalMessages.id, logId));
      return false;
    }
    await db.update(oneSignalMessages).set({ status: "annullata", updatedAt: new Date() }).where(eq(oneSignalMessages.id, logId));
    return true;
  } catch { return false; }
}

export async function cancelOneSignalAppointmentReminder(appointmentId: number) {
  const pending = await db.select().from(oneSignalMessages).where(and(eq(oneSignalMessages.appointmentId, appointmentId), eq(oneSignalMessages.automationKey, "reminder"), eq(oneSignalMessages.status, "programmata")));
  let canceled = 0;
  for (const item of pending) if (await cancelOneSignalMessage(item.id, item.providerMessageId)) canceled++;
  return canceled;
}

export async function disableOneSignalUser(userId: number) {
  const scheduled = await db.select().from(oneSignalMessages).where(and(eq(oneSignalMessages.userId, userId), eq(oneSignalMessages.status, "programmata")));
  for (const item of scheduled) await cancelOneSignalMessage(item.id, item.providerMessageId);
}

export async function sendOneSignalCampaign(userIds: number[], title: string, body: string, campaignId?: number) {
  const settings = normalizeOneSignalSettings((await getSettings()).onesignal);
  if (!settings.enabled || !settings.automations.marketing.enabled || !oneSignalCredentialsConfigured()) return 0;
  const rows = await db.select({ id: users.id }).from(users).innerJoin(oneSignalDevices, eq(users.id, oneSignalDevices.userId))
    .where(and(inArray(users.id, userIds), eq(users.active, true), eq(users.commPush, true), eq(users.consentMarketing, true), eq(oneSignalDevices.active, true)));
  const unique = [...new Set(rows.map(row => row.id))].slice(0, 20_000);
  if (!unique.length) return 0;
  const payload = {
    app_id: APP_ID(), include_aliases: { external_id: unique.map(String) }, target_channel: "push",
    headings: { it: title.slice(0, 160) }, contents: { it: body.slice(0, 500) },
    url: new URL("/", settings.expectedOrigin).toString(),
    idempotency_key: deterministicKey(campaignId ? `campaign:${campaignId}` : `campaign:${unique.join(",")}:${title}:${body}`),
  };
  try {
    const response = await request("/notifications", { method: "POST", body: JSON.stringify(payload) });
    const result = await safeBody(response);
    if (!response.ok) throw new Error(String(result.error || `OneSignal HTTP ${response.status}`).slice(0, 250));
    await db.insert(oneSignalMessages).values({
      providerMessageId: result.id, automationKey: "marketing", title: title.slice(0, 160), body: body.slice(0, 500),
      status: result.id ? "accettata" : "nessun_dispositivo",
    });
    const recipients = Number(result.body.recipients);
    return result.id ? (Number.isFinite(recipients) ? recipients : unique.length) : 0;
  } catch (error) {
    await db.insert(oneSignalMessages).values({
      automationKey: "marketing", title: title.slice(0, 160), body: body.slice(0, 500), status: "errore",
      error: String((error as Error).message || "Errore OneSignal").slice(0, 500),
    }).catch(() => {});
    return 0;
  }
}
