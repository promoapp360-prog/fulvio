import { useEffect, useState } from "react";
import { Link } from "wouter";
import { usePublicSettings } from "@/lib/settings";

type Consent = { necessary: true; analytics: boolean; marketing: boolean; date: string };
const KEY = "dp-cookie-consent";

function read(): Consent | null { try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch { return null; } }

/** Carica i tracciamenti SOLO dopo il consenso esplicito. */
function loadTrackers(c: Consent, seo: any) {
  if (!seo) return;
  const add = (src: string) => { if (document.querySelector(`script[src="${src}"]`)) return; const s = document.createElement("script"); s.async = true; s.src = src; document.head.appendChild(s); };
  const w = window as any;
  if (c.analytics && seo.gaMeasurementId) {
    add(`https://www.googletagmanager.com/gtag/js?id=${seo.gaMeasurementId}`);
    w.dataLayer = w.dataLayer || []; w.gtag = function () { w.dataLayer.push(arguments); };
    w.gtag("js", new Date()); w.gtag("config", seo.gaMeasurementId, { anonymize_ip: true });
  }
  if ((c.analytics || c.marketing) && seo.gtmId) {
    w.dataLayer = w.dataLayer || []; w.dataLayer.push({ "gtm.start": Date.now(), event: "gtm.js" });
    add(`https://www.googletagmanager.com/gtm.js?id=${seo.gtmId}`);
  }
  if (c.marketing && seo.metaPixelId && !w.fbq) {
    const n: any = (w.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); });
    n.queue = []; n.loaded = true; n.version = "2.0"; w._fbq = n;
    add("https://connect.facebook.net/en_US/fbevents.js");
    w.fbq("init", seo.metaPixelId); w.fbq("track", "PageView");
  }
}

export default function CookieBanner() {
  const { data: s } = usePublicSettings();
  const [consent, setConsent] = useState<Consent | null>(read);
  const [open, setOpen] = useState(!read());
  const [prefs, setPrefs] = useState({ analytics: false, marketing: false });

  useEffect(() => { const o = () => setOpen(true); window.addEventListener("dp-cookie-open", o); return () => window.removeEventListener("dp-cookie-open", o); }, []);
  useEffect(() => { if (consent && s) loadTrackers(consent, s.seo); }, [consent, s]);

  const save = (analytics: boolean, marketing: boolean) => {
    const c: Consent = { necessary: true, analytics, marketing, date: new Date().toISOString() };
    try { localStorage.setItem(KEY, JSON.stringify(c)); } catch {}
    setConsent(c); setOpen(false);
  };
  if (!open) return null;
  return (
    <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-[60] p-3 md:bottom-0 sm:p-4" role="dialog" aria-label="Preferenze cookie">
      <div className="mx-auto max-w-3xl rounded-2xl border border-sky-100 bg-white p-4 shadow-2xl sm:p-5">
        <p className="text-xs leading-relaxed text-slate-700 sm:text-sm">Usiamo cookie tecnici necessari al funzionamento del sito. Con il tuo consenso useremo anche cookie di statistica e marketing. <Link href="/cookie-policy" className="font-bold text-brand-blue underline">Cookie Policy</Link></p>
        <div className="mt-3 flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2 text-slate-500"><input type="checkbox" checked disabled /> Necessari</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={prefs.analytics} onChange={(e) => setPrefs({ ...prefs, analytics: e.target.checked })} /> Statistiche</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={prefs.marketing} onChange={(e) => setPrefs({ ...prefs, marketing: e.target.checked })} /> Marketing</label>
        </div>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button className="btn-outline btn-sm min-h-11" onClick={() => save(false, false)}>Rifiuta</button>
          <button className="btn-outline btn-sm min-h-11" onClick={() => save(prefs.analytics, prefs.marketing)}>Salva preferenze</button>
          <button className="btn-primary btn-sm min-h-11" onClick={() => save(true, true)}>Accetta tutti</button>
        </div>
      </div>
    </div>
  );
}
