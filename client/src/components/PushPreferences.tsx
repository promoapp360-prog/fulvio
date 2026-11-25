import { useEffect, useId, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Bell, CheckCircle2 } from "lucide-react";
import { useMe } from "@/lib/auth";
import { usePublicSettings } from "@/lib/settings";
import { deviceInfo } from "@/lib/pwa";
import { disablePush, enablePush, pushStatus } from "@/lib/push";
import { get, post } from "@/lib/api";
import { disableOneSignal, enableOneSignal, oneSignalStatus } from "@/lib/onesignal";

export default function PushPreferences({ compact = false, afterBooking = false }: { compact?: boolean; afterBooking?: boolean }) {
  const { data: me } = useMe();
  const { data: settings } = usePublicSettings();
  const qc = useQueryClient(), consentId = useId();
  const [consent, setConsent] = useState(false), [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(""), [error, setError] = useState("");
  const [dismissed, setDismissed] = useState(false);
  const [permission, setPermission] = useState(() => "Notification" in window ? Notification.permission : "default");
  const info = deviceInfo();
  const { data: browserOneSignal } = useQuery<any>({
    queryKey: ["onesignal-browser-config"], queryFn: () => get("/api/public/onesignal/config"),
    enabled: !!me && info.push, staleTime: 60_000, retry: false,
  });
  const oneSignalEnabled = !!browserOneSignal?.enabled;
  const { data: status, refetch, isLoading, isError } = useQuery({
    queryKey: ["push-device", me?.id, oneSignalEnabled ? "onesignal" : "vapid"],
    queryFn: () => oneSignalEnabled ? oneSignalStatus(me!.id) : pushStatus(), enabled: !!me && info.push,
    refetchOnWindowFocus: true, staleTime: 0, retry: false,
  });
  useEffect(() => {
    const refresh = () => { setPermission("Notification" in window ? Notification.permission : "default"); };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);
  const active = !!status?.configured && !!status.preference && !!status.subscribed && permission === "granted";
  const configured = !!settings?.pushConfigured && (!!settings?.pushPublicKey || oneSignalEnabled);
  const eligible = afterBooking && !!me?.consentMarketing && !me?.pushOfferedAt && configured && info.push && permission === "default";
  const { data: invitation } = useQuery<{ offer: boolean }>({
    queryKey: ["push-first-booking-offer", me?.id], queryFn: () => post("/api/account/push/offer"),
    enabled: eligible, staleTime: Infinity, retry: false, refetchOnWindowFocus: false,
  });
  const change = async (on: boolean) => {
    setBusy(true); setError(""); setMessage("");
    try {
      if (on) {
        if (oneSignalEnabled) await enableOneSignal(me!.id);
        else await enablePush(settings?.pushPublicKey || null);
      } else if (oneSignalEnabled) await disableOneSignal();
      else await disablePush(!!status?.subscribed);
      setPermission("Notification" in window ? Notification.permission : "default");
      setConsent(false);
      await Promise.all([qc.invalidateQueries({ queryKey: ["me"] }), qc.invalidateQueries({ queryKey: ["push-device"] })]);
      setMessage(on ? "Dispositivo registrato. La consegna dipende dal browser, dalla connessione e dalle impostazioni del telefono." : "Preferenza revocata e invii disattivati su tutti i tuoi dispositivi. Il permesso del browser si gestisce dalle sue impostazioni.");
    } catch (e: any) { setError(e.message || "Operazione non riuscita. Riprova."); }
    finally { setPermission("Notification" in window ? Notification.permission : "default"); setBusy(false); }
  };
  if (afterBooking && (!invitation?.offer || dismissed)) return null;
  return (
    <section data-push-preferences className={`rounded-2xl border border-sky-200 bg-[#f3fbff] p-4 sm:p-5 ${compact ? "md:col-span-2" : ""}`} aria-labelledby={consentId + "-title"}>
      <div className="flex items-start gap-3"><Bell size={23} className="mt-0.5 shrink-0 text-brand-turquoise" aria-hidden="true" /><div className="min-w-0">
        <h2 id={consentId + "-title"} className="font-bold">Conferme e promemoria, anche sul telefono</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">Le push sono facoltative e si aggiungono alle comunicazioni nell’area personale. Servono per conferme e promemoria degli appuntamenti; la consegna non è garantita.</p>
        <p className="mt-2 text-xs leading-relaxed text-slate-600">{settings?.emailConfigured ? "Le email restano il canale principale." : "Il canale email resta quello principale previsto; gli invii saranno disponibili dopo la configurazione del salone."}</p>
      </div></div>
      {active ? <p className="mt-4 flex items-center gap-2 text-sm font-semibold text-brand-navy"><CheckCircle2 size={18} />Preferenza attiva e dispositivo registrato.</p> : (
        <div className="mt-4">
          {info.ios && !info.standalone ? <p className="text-sm leading-relaxed text-slate-600">Su iPhone/iPad: <Link href="/installa-app" className="font-semibold text-brand-navy underline">Condividi → Aggiungi alla schermata Home</Link>. Apri poi l’app dalla nuova icona per abilitare le push, se supportate dal sistema.</p>
            : !info.push ? <p className="text-sm leading-relaxed text-slate-600">Questo browser o contesto non supporta le push. Puoi comunque leggere tutte le comunicazioni nell’area personale.</p>
            : !configured ? <p className="text-sm leading-relaxed text-slate-600">Le notifiche push non sono ancora disponibili: il salone deve completarne la configurazione. Non ti verrà richiesto alcun permesso.</p>
            : permission === "denied" ? <p className="text-sm leading-relaxed text-slate-600">Le notifiche sono bloccate nelle impostazioni del browser. Puoi consentirle lì e tornare in questa pagina; non apriremo altre richieste.</p>
            : !afterBooking && permission === "default" ? <p className="text-sm leading-relaxed text-slate-600">Non apriamo richieste di permesso quando entri nell’area personale. L’invito viene presentato una sola volta dopo la prima richiesta, se hai scelto di ricevere comunicazioni ed il dispositivo è compatibile.</p>
            : <><label htmlFor={consentId} className="flex min-h-11 cursor-pointer items-start gap-3 text-sm leading-relaxed text-slate-700"><input id={consentId} type="checkbox" className="mt-1 h-5 w-5 shrink-0 accent-[#0b3d91]" checked={consent} onChange={e => setConsent(e.target.checked)} />{permission === "granted" ? "Riattiva le notifiche su questo dispositivo già autorizzato." : "Acconsento alle notifiche per conferme e promemoria di appuntamento."}</label>
              <button type="button" className="btn-navy mt-3 min-h-11" disabled={!consent || busy || isLoading || isError} onClick={() => change(true)}>{busy ? "Registrazione…" : "Consenti notifiche su questo dispositivo"}</button></>}
        </div>
      )}
      {isError && <p role="alert" className="mt-3 text-sm text-red-700">Non riesco a verificare questo dispositivo. <button className="min-h-11 underline" onClick={() => refetch()}>Riprova</button></p>}
      {(active || me?.commPush) && <button type="button" className="btn-outline mt-4 min-h-11 text-xs" disabled={busy} onClick={() => change(false)}>Disattiva su tutti i miei dispositivi</button>}
      {message && <p role="status" className="mt-3 text-sm leading-relaxed text-brand-navy">{message}</p>}
      {error && <p role="alert" className="mt-3 text-sm leading-relaxed text-red-700">{error}</p>}
      {afterBooking && <button type="button" className="btn-ghost mt-3 min-h-11" onClick={() => setDismissed(true)}>Non ora, non riproporre</button>}
      <Link href="/account/notifiche" className="mt-3 inline-flex min-h-11 items-center text-xs font-semibold text-brand-navy underline">Leggi le comunicazioni nell’area personale</Link>
    </section>
  );
}
