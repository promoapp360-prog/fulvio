import { eq, inArray, or } from "drizzle-orm";
import { db } from "../db";
import { notifications, users, type User } from "../../shared/schema";
import { sendEmail, emailLayout, p } from "./email";
import { pushToUsers } from "./push";

/** Notifica un utente: in-app sempre, push ed email secondo le sue preferenze. */
export async function notifyUser(user: User, msg: { title: string; body: string; url?: string; email?: boolean; template?: string }) {
  await db.insert(notifications).values({ userId: user.id, title: msg.title, body: msg.body, url: msg.url });
  if (user.commPush) await pushToUsers([user.id], { title: msg.title, body: msg.body, url: msg.url });
  if (msg.email !== false && user.commEmail) {
    const base = process.env.PUBLIC_URL || "";
    await sendEmail(user.email, msg.title, emailLayout(msg.title, p(msg.body), msg.url ? { label: "Apri Dog's Planet", url: base + msg.url } : undefined), msg.template);
  }
}

/** Notifica lo staff amministrativo (admin + staff con permesso indicato). */
export async function notifyStaff(perm: string, msg: { title: string; body: string; url?: string }) {
  const staff = await db.select().from(users).where(or(eq(users.role, "admin"), inArray(users.role, ["staff"])));
  const targets = staff.filter((u) => u.active && (u.role === "admin" || (u.permissions || []).includes(perm)));
  if (!targets.length) return;
  await db.insert(notifications).values(targets.map((u) => ({ userId: u.id, title: msg.title, body: msg.body, url: msg.url })));
  await pushToUsers(targets.map((u) => u.id), msg);
  const base = process.env.PUBLIC_URL || "";
  for (const u of targets.filter((t) => t.role === "admin" && t.commEmail)) {
    await sendEmail(u.email, msg.title, emailLayout(msg.title, p(msg.body), msg.url ? { label: "Apri il gestionale", url: base + msg.url } : undefined), "staff");
  }
}
