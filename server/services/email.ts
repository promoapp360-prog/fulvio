import nodemailer from "nodemailer";
import { and, asc, eq, inArray, lte, sql, lt, min } from "drizzle-orm";
import { db } from "../db";
import { emailQueue, emailTemplates } from "../../shared/schema";
import { BUSINESS, fullAddress } from "../../shared/constants";
import { DEFAULT_TEMPLATES } from "./templates";
import { renderTemplate } from "../logic";

let transporter: nodemailer.Transporter | null = null;
const smtpConfigured = () => !!process.env.SMTP_HOST;
function getTransporter() {
  if (!smtpConfigured()) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587), secure: Number(process.env.SMTP_PORT) === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
  }
  return transporter;
}

export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
export const p = (text: string) => `<p style="font-size:15px;line-height:22px;margin:0 0 12px">${esc(text)}</p>`;
const paragraphs = (text: string) => text.split(/\n{2,}/).map((x) => x.trim()).filter(Boolean).map((x) => `<p style="font-size:15px;line-height:22px;margin:0 0 12px">${esc(x).replace(/\n/g, "<br>")}</p>`).join("");

/** Layout email con logo ufficiale e colori del brand. */
export function emailLayout(title: string, bodyHtml: string, cta?: { label: string; url: string }, footerExtra = "") {
  const base = process.env.PUBLIC_URL || "";
  return `<!doctype html><html lang="it"><body style="margin:0;background:#E6F7FF;font-family:Arial,Helvetica,sans-serif;color:#0A2350">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:16px;overflow:hidden">
<tr><td align="center" style="padding:24px 24px 8px"><img src="${base}/brand/logo.png" alt="Dog's Planet – Pet Grooming" width="200" style="display:block;max-width:200px;height:auto"></td></tr>
<tr><td style="padding:8px 32px 16px"><h1 style="font-size:22px;color:#0B3D91;margin:12px 0">${esc(title)}</h1>${bodyHtml}
${cta ? `<p style="text-align:center;margin:28px 0"><a href="${cta.url}" style="background:#00B6C8;color:#fff;text-decoration:none;padding:12px 24px;border-radius:999px;font-weight:bold">${esc(cta.label)}</a></p>` : ""}
</td></tr>
<tr><td style="background:#0B3D91;color:#fff;padding:18px 32px;font-size:12px;line-height:18px">
<strong>${BUSINESS.name}</strong> – Pet Grooming<br>${esc(fullAddress)}<br>Tel/WhatsApp ${BUSINESS.phone} · ${BUSINESS.email}${footerExtra}</td></tr>
</table></td></tr></table></body></html>`;
}

export async function getTemplate(key: string) {
  const [t] = await db.select().from(emailTemplates).where(eq(emailTemplates.key, key));
  if (t) return t;
  const d = DEFAULT_TEMPLATES[key];
  return d ? { key, ...d, active: true } : null;
}

/** Invia (accoda) una email da template personalizzabile. I valori vengono sanificati. */
export async function sendTemplate(key: string, to: string, vars: Record<string, string | number | null | undefined>, opts: { userId?: number | null; cta?: { label: string; url: string }; dedupeKey?: string; footer?: string } = {}) {
  const t = await getTemplate(key);
  if (!t || !t.active) return false;
  const subject = renderTemplate(t.subject, vars).slice(0, 250);
  const html = emailLayout(subject, paragraphs(renderTemplate(t.body, vars)), opts.cta, opts.footer);
  return enqueueEmail({ to, subject, html, template: key, userId: opts.userId, dedupeKey: opts.dedupeKey });
}

/** Retrocompatibilità: invio diretto di HTML già composto (accodato). */
export async function sendEmail(to: string, subject: string, html: string, template?: string) {
  return enqueueEmail({ to, subject, html, template });
}

export async function enqueueEmail(m: { to: string; subject: string; html: string; template?: string; userId?: number | null; dedupeKey?: string }) {
  const rows = await db.insert(emailQueue).values({ toEmail: m.to, subject: m.subject, html: m.html, template: m.template, userId: m.userId ?? null, dedupeKey: m.dedupeKey ?? null })
    .onConflictDoNothing().returning({ id: emailQueue.id });
  if (!rows.length) return false; // già accodata (deduplica)
  kickQueue();
  return true;
}

// ---------- elaborazione coda: nessun polling continuo, solo timer quando servono reinvii ----------
const MAX_ATTEMPTS = 5;
let running = false, again = false;
let timer: NodeJS.Timeout | null = null;

export function kickQueue() {
  if (running) { again = true; return; }
  running = true;
  processQueue().catch((e) => console.error("[email] coda:", e.message)).finally(() => {
    running = false;
    if (again) { again = false; kickQueue(); } else scheduleNext().catch(() => {});
  });
}

async function processQueue() {
  for (let round = 0; round < 10; round++) {
    const batch = await db.update(emailQueue).set({ status: "in_invio" })
      .where(inArray(emailQueue.id, sql`(SELECT id FROM email_queue WHERE status IN ('in_coda','errore') AND next_attempt_at <= now() ORDER BY id LIMIT 20 FOR UPDATE SKIP LOCKED)`))
      .returning();
    if (!batch.length) return;
    const t = getTransporter();
    for (const m of batch) {
      if (!t) { await db.update(emailQueue).set({ status: "simulata", lastError: "SMTP non configurato", attempts: m.attempts + 1 }).where(eq(emailQueue.id, m.id)); continue; }
      try {
        const info = await t.sendMail({ from: process.env.MAIL_FROM || `${BUSINESS.name} <${BUSINESS.email}>`, to: m.toEmail, subject: m.subject, html: m.html });
        const rejected = (info.rejected || []).length > 0;
        await db.update(emailQueue).set({ status: rejected ? "fallita" : "inviata", sentAt: new Date(), attempts: m.attempts + 1, providerId: String(info.messageId || "").slice(0, 255), lastError: rejected ? "Destinatario rifiutato dal server" : null }).where(eq(emailQueue.id, m.id));
      } catch (e) {
        const attempts = m.attempts + 1;
        const delayMin = Math.min(240, 2 ** attempts); // 2, 4, 8, 16 minuti...
        await db.update(emailQueue).set({
          status: attempts >= MAX_ATTEMPTS ? "fallita" : "errore", attempts, lastError: (e as Error).message.slice(0, 500),
          nextAttemptAt: new Date(Date.now() + delayMin * 60_000),
        }).where(eq(emailQueue.id, m.id));
      }
    }
  }
}

async function scheduleNext() {
  if (timer) { clearTimeout(timer); timer = null; }
  const [r] = await db.select({ next: min(emailQueue.nextAttemptAt) }).from(emailQueue).where(inArray(emailQueue.status, ["in_coda", "errore"]));
  if (!r?.next) return;
  const wait = Math.max(5_000, new Date(r.next).getTime() - Date.now());
  timer = setTimeout(kickQueue, Math.min(wait, 2 ** 31 - 1));
  timer.unref();
}

/** All'avvio: rimette in coda gli invii interrotti e riprende la coda. */
export async function startEmailQueue() {
  await db.update(emailQueue).set({ status: "errore" }).where(and(eq(emailQueue.status, "in_invio"), lt(emailQueue.createdAt, new Date(Date.now() - 10 * 60_000))));
  kickQueue();
}

/** Reinvio manuale di una email fallita (dal registro). */
export async function retryEmail(id: number) {
  await db.update(emailQueue).set({ status: "in_coda", nextAttemptAt: new Date(), attempts: 0 }).where(and(eq(emailQueue.id, id), inArray(emailQueue.status, ["fallita", "errore", "simulata"])));
  kickQueue();
}
