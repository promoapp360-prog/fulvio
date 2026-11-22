import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";

/** Invito a installare la PWA (Android/Chrome) e istruzioni per iPhone. */
export default function InstallPrompt() {
  const [evt, setEvt] = useState<any>(null);
  const [ios, setIos] = useState(false);
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem("dp-install-hide") === "1"; } catch { return false; } });

  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as any).standalone;
    if (standalone) return;
    const h = (e: Event) => { e.preventDefault(); setEvt(e); };
    window.addEventListener("beforeinstallprompt", h);
    if (/iphone|ipad|ipod/i.test(navigator.userAgent) && /safari/i.test(navigator.userAgent)) setIos(true);
    return () => window.removeEventListener("beforeinstallprompt", h);
  }, []);

  if (hidden || (!evt && !ios)) return null;
  const close = () => { setHidden(true); try { localStorage.setItem("dp-install-hide", "1"); } catch {} };
  return (
    <div className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] right-3 z-50 max-w-xs rounded-2xl border border-sky-100 bg-white p-4 shadow-2xl md:bottom-4">
      <button className="absolute right-2 top-2 text-slate-400" onClick={close} aria-label="Chiudi"><X size={16} /></button>
      <div className="flex items-center gap-3">
        <img src="/icons/icon-192.png" alt="" className="h-10 w-10 rounded-xl" />
        <div className="text-sm"><strong className="text-brand-navy">Installa l'app Dog's Planet</strong><br />
          {evt ? "Prenotazioni e Fidelity sempre a portata di mano." : <>Tocca <b>Condividi</b> e poi <b>Aggiungi a Home</b>.</>}</div>
      </div>
      {evt && <button className="btn-primary btn-sm mt-3 w-full" onClick={async () => { evt.prompt(); await evt.userChoice; close(); }}><Download size={14} /> Installa</button>}
    </div>
  );
}
