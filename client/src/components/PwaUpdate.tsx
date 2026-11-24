import { useEffect, useState } from "react";
import { RefreshCw, X } from "lucide-react";
import { registerPwa } from "@/lib/pwa";
import { watchPwaUpdates } from "@/lib/pwa-updates";

export default function PwaUpdate() {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    let disposed = false;
    let stop: (() => void) | undefined;
    registerPwa().then(registration => {
      if (!disposed) stop = watchPwaUpdates(registration, () => setAvailable(true));
    }).catch(() => { /* Browser senza supporto PWA: l'app rimane utilizzabile. */ });
    return () => { disposed = true; stop?.(); };
  }, []);
  if (!available) return null;
  return <aside role="status" aria-live="polite" aria-label="Aggiornamento dell’app"
    className="fixed inset-x-3 top-3 z-[80] mx-auto max-w-md rounded-2xl border border-sky-100 bg-white p-4 text-brand-navy shadow-xl">
    <div className="flex items-start gap-3">
      <RefreshCw className="mt-1 shrink-0 text-brand-turquoise" size={22} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="font-bold">Dog’s Planet si è aggiornata</p>
        <p className="mt-1 text-sm leading-relaxed text-slate-600">La nuova versione è pronta. Salva o completa prima le operazioni in corso, poi ricarica l’app.</p>
      </div>
      <button type="button" aria-label="Chiudi avviso di aggiornamento" onClick={() => setAvailable(false)}
        className="grid h-11 w-11 shrink-0 place-items-center rounded-xl hover:bg-brand-sky"><X size={20} /></button>
    </div>
    <div className="mt-3 flex flex-wrap gap-2">
      <button type="button" onClick={() => window.location.reload()} className="btn-primary min-h-11 flex-1">Ricarica la nuova versione</button>
      <button type="button" onClick={() => setAvailable(false)} className="min-h-11 rounded-xl px-4 text-sm font-semibold hover:bg-brand-sky">Più tardi</button>
    </div>
  </aside>;
}
