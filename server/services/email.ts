import nodemailer from "nodemailer";
import { db } from "../db";
import { emailLog } from "../../shared/schema";
import { BUSINESS, fullAddress } from "../../shared/constants";

let transporter: nodemailer.Transporter | null = null;
function getTransporter() {
  if (!process.env.SMTP_HOST) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
  }
  return transporter;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

/** Layout email con logo ufficiale e colori del brand. */
export function emailLayout(title: string, bodyHtml: string, cta?: { label: string; url: string }) {
  const base = process.env.PUBLIC_URL || "";
  return `<!doctype html><html lang="it"><body style="margin:0;background:#E6F7FF;font-family:Arial,Helvetica,sans-serif;color:#0A2350">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:16px;overflow:hidden">
<tr><td align="center" style="padding:24px 24px 8px"><img src="${base}/brand/logo.png" alt="Dog's Planet – Pet Grooming" width="200" style="display:block;max-width:200px;height:auto"></td></tr>
<tr><td style="padding:8px 32px 0"><h1 style="font-size:22px;color:#0B3D91;margin:12px 0">${esc(title)}</h1>${bodyHtml}
${cta ? `<p style="text-align:center;margin:28px 0"><a href="${cta.url}" style="background:#00B6C8;color:#fff;text-decoration:none;padding:12px 24px;border-radius:999px;font-weight:bold">${esc(cta.label)}</a></p>` : ""}
</td></tr>
<tr><td style="background:#0B3D91;color:#fff;padding:18px 32px;font-size:12px;line-height:18px;margin-top:24px">
<strong>${BUSINESS.name}</strong> – Pet Grooming<br>${esc(fullAddress)}<br>Tel/WhatsApp ${BUSINESS.phone} · ${BUSINESS.email}</td></tr>
</table></td></tr></table></body></html>`;
}

export const p = (text: string) => `<p style="font-size:15px;line-height:22px;margin:0 0 12px">${esc(text)}</p>`;

export async function sendEmail(to: string, subject: string, html: string, template?: string) {
  const t = getTransporter();
  if (!t) {
    await db.insert(emailLog).values({ toEmail: to, subject, template, status: "simulata", error: "SMTP non configurato" }).catch(() => {});
    return false;
  }
  try {
    await t.sendMail({ from: process.env.MAIL_FROM || `${BUSINESS.name} <${BUSINESS.email}>`, to, subject, html });
    await db.insert(emailLog).values({ toEmail: to, subject, template, status: "inviata" }).catch(() => {});
    return true;
  } catch (e) {
    await db.insert(emailLog).values({ toEmail: to, subject, template, status: "errore", error: (e as Error).message.slice(0, 500) }).catch(() => {});
    return false;
  }
}
