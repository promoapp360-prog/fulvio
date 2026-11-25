import { eq, inArray, or } from "drizzle-orm";
import { db, type DbExecutor } from "../db";
import { notifications, users, type User } from "../../shared/schema";
import { sendTemplate } from "./email";
import { pushToUsers } from "./push";

/**
 * Notifica un utente: notifica in-app sempre, email come canale principale (se attiva nelle preferenze), push in aggiunta.
 * template = chiave del template email personalizzabile; vars = segnaposto.
 */
export async function notifyUser(user: User, msg: { title: string; body: string; url?: string; template?: string; vars?: Record<string, any>; email?: boolean; dedupeKey?: string }, executor: DbExecutor = db) {
  await executor.insert(notifications).values({ userId: user.id, title: msg.title, body: msg.body, url: msg.url });
  if (msg.email !== false && user.commEmail && msg.template) {
    const base = process.env.PUBLIC_URL || "";
    await sendTemplate(msg.template, user.email, { nome: user.firstName, ...(msg.vars || {}) }, { userId: user.id, dedupeKey: msg.dedupeKey, executor, cta: msg.url ? { label: "Apri Dog's Planet", url: base + msg.url } : undefined });
  }
  if (executor === db) await pushUserNotification(user, msg);
}

/** In modalità transazionale invocare soltanto dopo il commit. */
export async function pushUserNotification(user: User, msg: { title: string; body: string; url?: string }) {
  if (user.commPush) await pushToUsers([user.id], { title: msg.title, body: msg.body, url: msg.url });
}

/** Notifica lo staff (admin + utenti con il permesso indicato): in-app e push; email solo agli admin. */
export async function notifyStaff(perm: string, msg: { title: string; body: string; url?: string; emailTo?: string; dedupeKey?: string }) {
  const staff = await db.select().from(users).where(or(eq(users.role, "admin"), inArray(users.role, ["manager", "operator"])));
  const targets = staff.filter((u) => u.active && (u.role === "admin" || (u.permissions || []).includes(perm)));
  if (targets.length) await db.insert(notifications).values(targets.map((u) => ({ userId: u.id, title: msg.title, body: msg.body, url: msg.url })));
  await pushToUsers(targets.map((u) => u.id), msg);
  const base = process.env.PUBLIC_URL || "";
  if (msg.emailTo) {
    await sendTemplate("comunicazione", msg.emailTo, { oggetto: msg.title, messaggio: msg.body }, {
      dedupeKey: msg.dedupeKey, cta: msg.url ? { label: "Apri il gestionale", url: base + msg.url } : undefined,
    });
    return;
  }
  for (const u of targets.filter((t) => t.role === "admin" && t.commEmail)) {
    await sendTemplate("comunicazione", u.email, { oggetto: msg.title, messaggio: msg.body }, { userId: u.id, cta: msg.url ? { label: "Apri il gestionale", url: base + msg.url } : undefined });
  }
}
