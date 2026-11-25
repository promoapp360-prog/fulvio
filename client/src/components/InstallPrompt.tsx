import { useEffect, useState } from "react";
import { Download, Share, X } from "lucide-react";
import { deviceInfo } from "@/lib/pwa";

interface InstallEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}
const read = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* Navigazione privata: rispetta comunque lo stato della sessione. */ } };

export default function InstallPrompt() {
  const [event, setEvent] = useState<InstallEvent | null>(null);
  const [ready, setReady] = useState(false);
  const [instructions, setInstructions] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState(() => read("dp-install-hide") === "1" || read("dp-installed") === "1" || Number(read("dp-install-dismissed-until")) > Date.now());
  const info = deviceInfo();
  useEffect(() => {
    const offer = (e: Event) => { e.preventDefault(); setEvent(e as InstallEvent); };
    const installed = () => { write("dp-installed", "1"); setHidden(true); setEvent(null); };
    const reveal = () => {
      let eligible = false;
      try { eligible = sessionStorage.getItem("dp-install-eligible") === "1"; } catch { /* nessun invito automatico */ }
      setReady(eligible && !!read("dp-cookie-consent") && !document.querySelector("[data-cookie-banner]"));
    };
    const cookieVisibility = () => { requestAnimationFrame(reveal); };
    window.addEventListener("beforeinstallprompt", offer);
    window.addEventListener("appinstalled", installed);
    window.addEventListener("dp:install-eligible", reveal);
    window.addEventListener("dp:cookie-visibility", cookieVisibility);
    window.addEventListener("dp:cookie-consent", reveal);
    reveal();
    return () => {
      window.removeEventListener("beforeinstallprompt", offer); window.removeEventListener("appinstalled", installed);
      window.removeEventListener("dp:install-eligible", reveal); window.removeEventListener("dp:cookie-visibility", cookieVisibility); window.removeEventListener("dp:cookie-consent", reveal);
    };
  }, []);
  if (hidden || info.standalone || !ready || !info.secure || (!event && !info.ios && !info.android)) return null;
  const dismiss = () => { write("dp-install-dismissed-until", String(Date.now() + 30 * 86400_000)); setHidden(true); };
  const install = async () => {
    if (!event || busy) return;
    setBusy(true); setError("");
    try {
      await event.prompt(); // Deve rimanere direttamente nel gesto dell’utente.
      const choice = await event.userChoice;
      if (choice.outcome === "accepted") { write("dp-installed", "1"); setHidden(true); }
      else dismiss();
      setEvent(null);
    } catch { setEvent(null); setInstructions(true); setError("Il browser non ha aperto l’installazione. Puoi usare il suo menu."); }
    finally { setBusy(false); }
  };
  return (
    <aside data-install-prompt aria-label="Installa Dog’s Planet" className="fixed inset-x-3 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-50 mx-auto max-h-[calc(100dvh-7rem-env(safe-area-inset-bottom))] max-w-sm overflow-y-auto rounded-2xl border border-sky-200 bg-[#f4fbff] p-4 shadow-xl md:left-auto md:bottom-5 md:mx-0">
      <button type="button" aria-label="Rimanda l’installazione" onClick={dismiss} className="absolute right-1 top-1 grid h-11 w-11 place-items-center rounded-full text-brand-navy hover:bg-sky-100"><X size={18} /></button>
      <div className="flex items-center gap-3 pr-8"><img src="/icons/icon-192.png" alt="" width={44} height={44} className="h-11 w-11 shrink-0 rounded-xl" /><div><h2 className="text-sm font-bold">Dog’s Planet, sempre con te</h2><p className="mt-1 text-xs leading-relaxed text-slate-600">Prenotazioni e Fidelity dalla schermata Home.</p></div></div>
      {info.embedded && <p className="mt-3 text-xs leading-relaxed text-slate-600">Per installare, apri il sito nel browser del telefono, fuori dall’anteprima incorporata.</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {event && !info.ios && !info.embedded
          ? <button type="button" disabled={busy} className="btn-navy min-h-11 text-xs" onClick={install}><Download size={16} />{busy ? "Apertura…" : "Installa Dog’s Planet"}</button>
          : <button type="button" className="btn-outline min-h-11 text-xs" aria-expanded={instructions} onClick={() => setInstructions(!instructions)}>{info.ios ? <Share size={16} /> : <Download size={16} />}Come aggiungerla alla Home</button>}
        <button type="button" className="btn-ghost min-h-11 text-xs" onClick={dismiss}>Non ora</button>
      </div>
      {instructions && <ol className="mt-3 list-inside list-decimal space-y-2 border-t border-sky-200 pt-3 text-xs leading-relaxed text-slate-700">
        {info.ios ? <><li>Apri il sito in <strong>Safari</strong>.</li><li>Tocca <strong>Condividi</strong>, poi <strong>Aggiungi alla schermata Home</strong>.</li><li>Conferma con <strong>Aggiungi</strong> e apri Dog’s Planet dalla nuova icona.</li></> : <><li>Apri il sito nel browser del telefono.</li><li>Dal menu <strong>⋮</strong>, scegli <strong>Installa app</strong> o <strong>Aggiungi alla schermata Home</strong>, se disponibile.</li><li>Conferma l’installazione proposta dal browser.</li></>}
      </ol>}
      {instructions && <button type="button" className="btn-ghost mt-2 min-h-11 text-xs underline" onClick={() => { write("dp-installed", "1"); setHidden(true); }}>Ho già aggiunto l’app alla Home</button>}
      {error && <p role="status" className="mt-3 text-xs leading-relaxed text-slate-600">{error}</p>}
    </aside>
  );
}
