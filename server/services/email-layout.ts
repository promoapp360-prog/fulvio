import { fileURLToPath } from "node:url";
import { BUSINESS, fullAddress } from "../../shared/constants";

export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
export const p = (text: string) => `<p style="font-size:15px;line-height:24px;margin:0 0 16px">${esc(text)}</p>`;

const publicDir = process.env.NODE_ENV === "production" ? "../../dist/public/" : "../../client/public/";
const assets = [
  { filename: "dogs-planet-logo.png", cid: "dogsplanet-logo@dogsplanet.it", path: fileURLToPath(new URL(`${publicDir}brand/logo.png`, import.meta.url)) },
  { filename: "poppy.png", cid: "poppy@dogsplanet.it", path: fileURLToPath(new URL(`${publicDir}brand/poppy-toelettatura-transparent.png`, import.meta.url)) },
];

/** Immagini originali incorporate nel messaggio: nessuna dipendenza da URL privati dell'anteprima. */
export function inlineEmailAssets(html: string) {
  return assets.filter(asset => html.includes(`cid:${asset.cid}`)).map(asset => ({
    ...asset, contentType: "image/png", contentDisposition: "inline" as const,
  }));
}

/** Layout comune a tutte le comunicazioni, senza cambiare testi personalizzati o logica di invio. */
export function emailLayout(title: string, bodyHtml: string, cta?: { label: string; url: string }, footerExtra = "", browserPreview = false) {
  const base = (process.env.PUBLIC_URL || "").replace(/\/$/, "");
  const logo = browserPreview ? `${base}/brand/logo.png` : "cid:dogsplanet-logo@dogsplanet.it";
  const poppy = browserPreview ? `${base}/brand/poppy-toelettatura-transparent.png` : "cid:poppy@dogsplanet.it";
  return `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>@media only screen and (max-width:480px){.mail-content{padding-left:22px!important;padding-right:22px!important}.mail-title{font-size:23px!important;line-height:30px!important}}</style></head>
<body style="margin:0;padding:0;background:#EAF8FC;font-family:'Poppins',Arial,Helvetica,sans-serif;color:#163350">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${esc(title)} — Un saluto da Poppy e Fulvio.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EAF8FC"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#FFFFFF;border-radius:22px;overflow:hidden;border:1px solid #D5EDF2">
<tr><td class="mail-content" style="padding:22px 32px 14px;background:#FFFFFF;border-bottom:1px solid #D5EDF2">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td width="60%" style="vertical-align:middle;padding-right:12px"><img src="${esc(logo)}" alt="Dog's Planet – Pet Grooming" width="170" style="display:block;width:170px;max-width:100%;height:auto"></td>
<td width="40%" align="right" style="vertical-align:middle"><img src="${esc(poppy)}" alt="Poppy, la mascotte di Dog's Planet, ti manda un saluto!" width="112" style="display:block;width:112px;max-width:100%;height:auto"></td>
</tr></table></td></tr>
<tr><td class="mail-content" style="padding:26px 32px 4px">
<p style="margin:0 0 10px;font-size:11px;line-height:18px;font-weight:bold;letter-spacing:1.5px;color:#087F8C">LA POSTA DI POPPY</p>
<h1 class="mail-title" style="font-size:26px;line-height:34px;color:#0B3D91;margin:0 0 22px">${esc(title)}</h1>
<div style="font-size:15px;line-height:24px">${bodyHtml}</div>
${cta ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0"><tr><td align="center" bgcolor="#0B3D91" style="border-radius:28px;border-bottom:3px solid #00B6C8"><a href="${esc(cta.url)}" style="display:inline-block;color:#FFFFFF;text-decoration:none;padding:15px 24px;font-size:15px;line-height:22px;font-weight:bold">${esc(cta.label)}</a></td></tr></table>` : ""}
</td></tr>
<tr><td class="mail-content" style="padding:12px 32px 26px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="border-top:1px solid #D5EDF2;padding-top:20px">
<p style="font-size:14px;line-height:23px;margin:0;color:#456175">Una zampina di saluto,<br><strong style="font-size:17px;color:#0B3D91">Poppy e Fulvio</strong></p>
</td></tr></table></td></tr>
<tr><td class="mail-content" style="background:#0B3D91;color:#FFFFFF;padding:22px 32px;font-size:12px;line-height:20px">
<strong style="font-size:14px">${esc(BUSINESS.name)}</strong> · Pet Grooming<br>${esc(fullAddress)}<br>
Tel/WhatsApp <a href="tel:+393899082610" style="color:#FFFFFF;text-decoration:underline">${esc(BUSINESS.phone)}</a><br>
<a href="mailto:${esc(BUSINESS.email)}" style="color:#FFFFFF;text-decoration:underline">${esc(BUSINESS.email)}</a>${footerExtra}
</td></tr></table>
<p style="font-size:11px;line-height:18px;color:#54717D;margin:16px 12px 0">Piccoli messaggi, grande cura per il tuo amico a quattro zampe.</p>
</td></tr></table></body></html>`;
}
