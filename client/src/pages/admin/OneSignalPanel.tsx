import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, BellRing, CheckCircle2, ExternalLink, Save, Send } from "lucide-react";
import { ErrorBox, Field, Spinner, useToast } from "@/components/ui";
import { get, post, put } from "@/lib/api";

const AUTOMATIONS = [
  ["requestReceived", "Richiesta ricevuta"],
  ["appointmentConfirmed", "Appuntamento confermato"],
  ["paymentRequired", "Pagamento richiesto"],
  ["appointmentChanged", "Appuntamento modificato o proposto"],
  ["appointmentCancelled", "Appuntamento annullato o rifiutato"],
  ["reminder", "Promemoria appuntamento"],
  ["dogReady", "Cane pronto"],
  ["recall", "Richiamo periodico"],
  ["marketing", "Promozioni (solo con consenso)"],
] as const;

export default function OneSignalPanel() {
  const qc = useQueryClient(), toast = useToast();
  const { data, isLoading, error } = useQuery<any>({ queryKey: ["admin-onesignal"], queryFn: () => get("/api/admin/onesignal"), staleTime: 15_000 });
  const [form, setForm] = useState<any>(null), [busy, setBusy] = useState(false), [testError, setTestError] = useState<unknown>(null);
  const [recipientSearch, setRecipientSearch] = useState(""), [recipientId, setRecipientId] = useState<number | null>(null);
  const [manualTitle, setManualTitle] = useState("Una novità da Dog's Planet"), [manualBody, setManualBody] = useState("");
  const { data: recipients = [] } = useQuery<any[]>({
    queryKey: ["admin-onesignal-recipients", recipientSearch],
    queryFn: () => get(`/api/admin/onesignal/customers?q=${encodeURIComponent(recipientSearch)}`),
    enabled: recipientSearch.trim().length >= 2, staleTime: 10_000,
  });
  useEffect(() => { if (data?.settings) setForm(structuredClone(data.settings)); }, [data?.settings]);
  const update = (key: string, value: any) => setForm((current: any) => ({ ...current, [key]: value }));
  const save = async () => {
    if (!form) return;
    setBusy(true);
    try {
      await put("/api/admin/settings/onesignal", form);
      await qc.invalidateQueries({ queryKey: ["admin-onesignal"] });
      await qc.invalidateQueries({ queryKey: ["public-settings"] });
      toast("Impostazioni OneSignal salvate");
    } catch (e) { toast((e as Error).message, "err"); } finally { setBusy(false); }
  };
  const sendTest = async () => {
    if (!confirm("Inviare una notifica push di prova al dispositivo OneSignal associato al tuo account Admin?")) return;
    setBusy(true); setTestError(null);
    try { const r = await post("/api/admin/onesignal/test"); toast(r.accepted ? "Test accettato da OneSignal" : r.status === "nessun_dispositivo" ? "Nessun dispositivo OneSignal attivo per questo account" : "Invio non riuscito: controlla il registro OneSignal"); await qc.invalidateQueries({ queryKey: ["admin-onesignal"] }); }
    catch (e) { setTestError(e); } finally { setBusy(false); }
  };
  const sendManual = async () => {
    const customer = recipients.find(x => x.id === recipientId);
    if (!customer || !confirm(`Inviare una promozione OneSignal a ${customer.firstName} ${customer.lastName}?`)) return;
    setBusy(true); setTestError(null);
    try {
      const result = await post("/api/admin/onesignal/send", { userId: recipientId, title: manualTitle, body: manualBody });
      toast(result.accepted ? "Messaggio accettato da OneSignal" : result.status === "nessun_dispositivo" ? "OneSignal non ha trovato un dispositivo attivo" : "Invio non riuscito: controlla il registro OneSignal");
      setRecipientId(null); setManualBody(""); await qc.invalidateQueries({ queryKey: ["admin-onesignal"] });
    } catch (e) { setTestError(e); } finally { setBusy(false); }
  };
  if (isLoading) return <Spinner />;
  if (!form) return <ErrorBox error={error || new Error("Impostazioni OneSignal non disponibili.")} />;
  const originMatches = data?.app?.webOrigin === form.expectedOrigin && data?.app?.safariOrigin === form.expectedOrigin;
  const counts = Object.fromEntries((data?.counts || []).map((x: any) => [x.status, x.count]));
  return <div className="space-y-5">
    <section className="rounded-2xl border bg-white p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><h2 className="flex items-center gap-2 font-display text-lg font-bold text-brand-navy"><BellRing size={20} /> OneSignal – Dog&apos;s Planet</h2>
          <p className="mt-1 text-sm text-slate-600">Credenziali server dedicate. La chiave API non viene mostrata né restituita al browser.</p></div>
        <a className="btn-outline btn-sm" href="https://dashboard.onesignal.com/" target="_blank" rel="noreferrer">Apri OneSignal <ExternalLink size={14} /></a>
      </div>
      {error && <ErrorBox error={error} />}
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl bg-slate-50 p-3 text-sm"><b>App</b><p>{data?.app?.name || "Non verificata"}</p><p className="break-all text-xs text-slate-500">{data?.app?.appId || "—"}</p></div>
        <div className="rounded-xl bg-slate-50 p-3 text-sm"><b>Origini Web e Safari</b><p className="break-all">Web: {data?.app?.webOrigin || "Non disponibile"}</p><p className="break-all">Safari: {data?.app?.safariOrigin || "Non disponibile"}</p></div>
        <div className="rounded-xl bg-slate-50 p-3 text-sm"><b>Dispositivi associati</b><p className="text-xl font-bold text-brand-navy">{data?.activeDevices ?? 0}</p></div>
      </div>
      {!originMatches && <div role="alert" className="mt-4 flex gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
        <AlertTriangle className="mt-0.5 shrink-0" size={18} /><p>Le origini Web/Safari in OneSignal non coincidono con quella di Dog&apos;s Planet ({form.expectedOrigin}). Aggiorna entrambe le origini nella configurazione dell’app. Le notifiche restano disattivate finché non coincidono.</p>
      </div>}
      {originMatches && data?.app?.reachable && <p className="mt-4 flex items-center gap-2 text-sm text-emerald-700"><CheckCircle2 size={17} /> App ID, chiave API e origine Web verificati.</p>}
      <Field label="Dominio pubblico Dog’s Planet">
        <input className="input" type="url" value={form.expectedOrigin} onChange={e => update("expectedOrigin", e.target.value)} />
        <span className="text-xs text-slate-500">Deve essere l’origine HTTPS pubblicata, senza percorsi o slash finale.</span>
      </Field>
      <label className="mt-4 flex min-h-12 items-center gap-3 rounded-xl border p-3 font-semibold">
        <input type="checkbox" className="h-5 w-5 accent-[#0b3d91]" checked={form.enabled} onChange={e => update("enabled", e.target.checked)} disabled={!originMatches || !data?.app?.reachable} />
        Attiva OneSignal per i dispositivi che hanno dato il permesso
      </label>
      <div className="mt-4 flex flex-wrap gap-3">
        <button className="btn-primary min-h-11" disabled={busy || !originMatches || !data?.app?.reachable} onClick={save}><Save size={16} /> Salva impostazioni</button>
        <button className="btn-outline min-h-11" disabled={busy || !form.enabled} onClick={sendTest}><Send size={16} /> Prova sul mio dispositivo</button>
      </div>
      <ErrorBox error={testError} />
    </section>

    <section className="rounded-2xl border bg-white p-4 sm:p-6">
      <h3 className="font-display text-lg font-bold text-brand-navy">Invio promozione singola</h3>
      <p className="mb-4 mt-1 text-sm text-slate-600">Il destinatario deve avere push attive e consenso marketing. Per inviare a gruppi autorizzati usa la scheda Campagne.</p>
      <Field label="Cerca un cliente autorizzato">
        <input className="input" minLength={2} value={recipientSearch} onChange={e => { setRecipientSearch(e.target.value); setRecipientId(null); }} placeholder="Nome, cognome o email" />
      </Field>
      {!!recipients.length && <div className="mt-2 max-h-48 overflow-auto rounded-xl border">{recipients.map((customer: any) =>
        <button key={customer.id} type="button" className={`flex min-h-12 w-full items-center justify-between border-b px-3 text-left text-sm last:border-0 ${recipientId === customer.id ? "bg-brand-sky" : "hover:bg-slate-50"}`} onClick={() => setRecipientId(customer.id)}>
          <span>{customer.firstName} {customer.lastName}</span><span className="text-xs text-slate-500">{customer.email}</span>
        </button>)}</div>}
      {recipientSearch.length >= 2 && !recipients.length && <p className="mt-2 text-sm text-slate-500">Nessun cliente con push attive e consenso marketing trovato.</p>}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="Titolo"><input className="input" maxLength={160} value={manualTitle} onChange={e => setManualTitle(e.target.value)} /></Field>
        <Field label="Messaggio"><textarea className="input min-h-20" maxLength={500} value={manualBody} onChange={e => setManualBody(e.target.value)} /></Field>
      </div>
      <button className="btn-outline mt-3 min-h-11" disabled={busy || !recipientId || !manualBody.trim() || !form.enabled || !form.automations.marketing.enabled || !originMatches} onClick={sendManual}><Send size={16} /> Invia promozione al cliente</button>
      <ErrorBox error={testError} />
    </section>

    <section className="rounded-2xl border bg-white p-4 sm:p-6">
      <h3 className="font-display text-lg font-bold text-brand-navy">Automazioni e messaggi</h3>
      <p className="mb-4 mt-1 text-sm text-slate-600">Le modifiche valgono per le prossime notifiche. Le promozioni richiedono anche il consenso marketing del cliente.</p>
      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <Field label="Inizio fascia promemoria (ora Roma)"><input className="input" type="number" min="0" max="23" value={form.quietHoursStart} onChange={e => update("quietHoursStart", Number(e.target.value))} /></Field>
        <Field label="Fine fascia promemoria (ora Roma)"><input className="input" type="number" min="1" max="24" value={form.quietHoursEnd} onChange={e => update("quietHoursEnd", Number(e.target.value))} /></Field>
      </div>
      <p className="mb-4 text-xs text-slate-500">L’orario dei promemoria usa la fascia selezionata; l’anticipo in ore si gestisce nella scheda “Promemoria e richiami”, condivisa con il canale email.</p>
      <div className="space-y-3">{AUTOMATIONS.map(([key, label]) => <fieldset key={key} className="rounded-xl border p-3 sm:p-4">
        <legend className="px-2 font-semibold text-brand-navy">{label}</legend>
        <label className="mb-3 flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5 accent-[#0b3d91]" checked={form.automations[key].enabled} onChange={e => update("automations", { ...form.automations, [key]: { ...form.automations[key], enabled: e.target.checked } })} /> Automazione attiva</label>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Titolo"><input className="input" maxLength={160} value={form.automations[key].title} onChange={e => update("automations", { ...form.automations, [key]: { ...form.automations[key], title: e.target.value } })} /></Field>
          <Field label="Testo"><textarea className="input min-h-20" maxLength={500} value={form.automations[key].body} onChange={e => update("automations", { ...form.automations, [key]: { ...form.automations[key], body: e.target.value } })} /></Field>
        </div>
        <p className="mt-2 text-xs text-slate-500">Segnaposto disponibili: {"{{nome}}"}, {"{{cane}}"}, {"{{servizio}}"}, {"{{data}}"}</p>
      </fieldset>)}</div>
      <button className="btn-primary mt-4 min-h-11" disabled={busy} onClick={save}><Save size={16} /> Salva automazioni</button>
    </section>

    <section className="rounded-2xl border bg-white p-4 sm:p-6">
      <h3 className="font-display text-lg font-bold text-brand-navy">Attività recente</h3>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[["Accettate", counts.accettata || 0], ["Programmate", counts.programmata || 0], ["Errori", counts.errore || 0], ["Ultimi 30 giorni", (data?.counts || []).reduce((n: number, x: any) => n + Number(x.count), 0)]].map(([label, value]: any) =>
          <div key={label} className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-600">{label}</p><p className="text-xl font-bold text-brand-navy">{value}</p></div>)}
      </div>
      <p className="my-3 text-xs text-slate-500">“Accettata” significa che OneSignal ha preso in carico il messaggio; non prova la consegna al dispositivo.</p>
      <div className="overflow-x-auto"><table className="table-dp"><thead><tr><th>Data</th><th>Automazione</th><th>Messaggio</th><th>Stato</th><th>Invio previsto</th></tr></thead><tbody>
        {!data?.messages?.length ? <tr><td colSpan={5}>Nessun messaggio OneSignal registrato.</td></tr> : data.messages.map((m: any) => <tr key={m.id}><td className="whitespace-nowrap">{new Date(m.createdAt).toLocaleString("it-IT")}</td><td>{m.automationKey}</td><td>{m.title}</td><td>{m.status}</td><td>{m.scheduledAt ? new Date(m.scheduledAt).toLocaleString("it-IT") : "—"}</td></tr>)}
      </tbody></table></div>
    </section>
  </div>;
}
