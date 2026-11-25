import nodemailer from "nodemailer";
import { and, asc, eq, inArray, lte, sql, lt, min } from "drizzle-orm";
import { db, type DbExecutor } from "../db";
import { appointments, users, emailQueue, emailTemplates } from "../../shared/schema";
import { BUSINESS } from "../../shared/constants";
import { DEFAULT_TEMPLATES } from "./templates";
import { renderTemplate } from "../logic";
import { nextReminderWindow, obsoleteReminder } from "../reminder-timing";
import { esc, emailLayout, inlineEmailAssets } from "./email-layout";
export { esc, p, emailLayout } from "./email-layout";

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

const paragraphs = (text: string) => text.split(/\n{2,}/).map((x) => x.trim()).filter(Boolean).map((x) => `<p style="font-size:15px;line-height:24px;margin:0 0 16px">${esc(x).replace(/\n/g, "<br>")}</p>`).join("");

export async function getTemplate(key: string, executor: DbExecutor = db) {
  const [t] = await executor.select().from(emailTemplates).where(eq(emailTemplates.key, key));
  if (t) return t;
  const d = DEFAULT_TEMPLATES[key];
  return d ? { key, ...d, active: true } : null;
}

/** Invia (accoda) una email da template personalizzabile. I valori vengono sanificati. */
export async function sendTemplate(key: string, to: string, vars: Record<string, string | number | null | undefined>, opts: { userId?: number | null; cta?: { label: string; url: string }; dedupeKey?: string; footer?: string; executor?: DbExecutor } = {}) {
  const t = await getTemplate(key, opts.executor);
  if (!t || !t.active) return false;
  const subject = renderTemplate(t.subject, vars).slice(0, 250);
  const html = emailLayout(subject, paragraphs(renderTemplate(t.body, vars)), opts.cta, opts.footer);
  return enqueueEmail({ to, subject, html, template: key, userId: opts.userId, dedupeKey: opts.dedupeKey }, opts.executor);
}

/** Retrocompatibilità: invio diretto di HTML già composto (accodato). */
export async function sendEmail(to: string, subject: string, html: string, template?: string) {
  return enqueueEmail({ to, subject, html, template });
}

export async function enqueueEmail(m: { to: string; subject: string; html: string; template?: string; userId?: number | null; dedupeKey?: string }, executor: DbExecutor = db) {
  const rows = await executor.insert(emailQueue).values({ toEmail: m.to, subject: m.subject, html: m.html, template: m.template, userId: m.userId ?? null, dedupeKey: m.dedupeKey ?? null })
    .onConflictDoNothing().returning({ id: emailQueue.id });
  if (!rows.length) return false; // già accodata (deduplica)
  // Dentro una transazione il chiamante avvia il worker soltanto dopo il commit.
  if (executor === db) kickQueue();
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

export async function processQueue() {
  for (let round = 0; round < 10; round++) {
    const batch = await db.update(emailQueue).set({ status: "in_invio" })
      .where(inArray(emailQueue.id, sql`(SELECT id FROM email_queue WHERE status IN ('in_coda','errore') AND next_attempt_at <= now() ORDER BY id LIMIT 20 FOR UPDATE SKIP LOCKED)`))
      .returning();
    if (!batch.length) return;
    const t = getTransporter();
    for (const m of batch) {
      try {
        if (m.template === "promemoria") {
          const now = new Date();
          const match = /^reminder:(\d+)(?::(\d+))?$/.exec(m.dedupeKey || "");
          if (match) {
            const [current] = await db.select({ startAt: appointments.startAt, status: appointments.status, active: users.active, commEmail: users.commEmail })
              .from(appointments).innerJoin(users, eq(users.id, appointments.customerId)).where(eq(appointments.id, Number(match[1])));
            const reason = obsoleteReminder(match[2] ? Number(match[2]) : undefined, current, now);
            if (reason) {
              await db.update(emailQueue).set({ status: "fallita", lastError: reason }).where(eq(emailQueue.id, m.id));
              continue;
            }
          }
          const next = nextReminderWindow(now);
          if (next.getTime() > now.getTime()) {
            await db.update(emailQueue).set({ status: "in_coda", nextAttemptAt: next, lastError: "Rinviata alla fascia 08:00–20:00 Europe/Rome" }).where(eq(emailQueue.id, m.id));
            continue;
          }
        }
        if (!t) { await db.update(emailQueue).set({ status: "simulata", lastError: "SMTP non configurato", attempts: m.attempts + 1 }).where(eq(emailQueue.id, m.id)); continue; }
        const info = await t.sendMail({ from: process.env.MAIL_FROM || `${BUSINESS.name} <${BUSINESS.email}>`, to: m.toEmail, subject: m.subject, html: m.html, attachments: inlineEmailAssets(m.html) });
        const rejected = (info.rejected || []).length > 0;
        await db.update(emailQueue).set({ status: rejected ? "fallita" : "inviata", sentAt: new Date(), attempts: m.attempts + 1, providerId: String(info.messageId || "").slice(0, 255), lastError: rejected ? "Destinatario rifiutato dal server" : null }).where(eq(emailQueue.id, m.id));
      } catch (e) {
        const attempts = m.attempts + 1;
        const delayMin = Math.min(240, 2 ** attempts); // 2, 4, 8, 16 minuti...
        await db.update(emailQueue).set({
          status: attempts >= MAX_ATTEMPTS ? "fallita" : "errore", attempts, lastError: (e as Error).message.slice(0, 500),
          nextAttemptAt: m.template === "promemoria" ? nextReminderWindow(new Date(Date.now() + delayMin * 60_000)) : new Date(Date.now() + delayMin * 60_000),
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
