import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Upload, Search } from "lucide-react";
import { PageTitle, Spinner, Empty, Tabs, Pager, Field, Check, ErrorBox, useToast } from "@/components/ui";
import { api, get, put } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { fmtDateTime, fmtDate } from "@/lib/format";
import { PAYMENT_MODES } from "@shared/constants";
import { SettingsForm } from "./Content";

function PaymentsSettings() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: me } = useMe();
  const { data } = useQuery<any>({ queryKey: ["admin-settings"], queryFn: () => get("/api/admin/settings") });
  const [f, setF] = useState<any>(null);
  const [err, setErr] = useState<unknown>(null);
  const cur = f ?? data?.payments;
  if (!cur) return <Spinner />;
  const save = async () => {
    setErr(null);
    try { await put("/api/admin/settings/payments", { defaultMode: cur.defaultMode, depositPercent: Number(cur.depositPercent), onlineEnabled: !!cur.onlineEnabled, customMethods: Array.isArray(cur.customMethods) ? cur.customMethods : String(cur.customMethods || "").split(",").map((s) => s.trim()).filter(Boolean) }); toast("Salvato"); setF(null); qc.invalidateQueries({ queryKey: ["admin-settings"] }); }
    catch (e) { setErr(e); }
  };
  return (
    <div className="card space-y-3">
      <h2 className="text-lg font-bold">Pagamenti appuntamenti</h2>
      <p className="text-sm text-slate-600">Il pagamento si attiva solo <b>dopo</b> la conferma della richiesta. I dati delle carte non vengono mai salvati: il pagamento on line avviene sulla pagina sicura del provider (Stripe), configurabile con le chiavi nei Secrets di Replit.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Modalità predefinita"><select className="input" disabled={me?.role !== "admin"} value={cur.defaultMode} onChange={(e) => setF({ ...cur, defaultMode: e.target.value })}>{Object.entries(PAYMENT_MODES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Acconto predefinito (%)"><input type="number" className="input" value={cur.depositPercent} onChange={(e) => setF({ ...cur, depositPercent: e.target.value })} /></Field>
        <Field label="Altri metodi di pagamento personalizzati" hint="Separati da virgola, es. Buono regalo, PayPal"><input className="input" value={Array.isArray(cur.customMethods) ? cur.customMethods.join(", ") : cur.customMethods} onChange={(e) => setF({ ...cur, customMethods: e.target.value })} /></Field>
        <div className="pt-5"><Check checked={!!cur.onlineEnabled} onChange={(v) => setF({ ...cur, onlineEnabled: v })} label="Abilita pagamenti on line (richiede STRIPE_SECRET_KEY)" /></div>
      </div>
      <ErrorBox error={err} />
      {me?.role === "admin" && <button className="btn-primary" onClick={save}>Salva</button>}
    </div>
  );
}

export function SettingsPage() {
  const [tab, setTab] = useState("agenda");
  return (
    <div>
      <PageTitle title="Impostazioni" />
      <Tabs value={tab} onChange={setTab} items={[{ value: "agenda", label: "Agenda e richieste" }, { value: "pagamenti", label: "Pagamenti" }, { value: "fidelity", label: "Fidelity" }, { value: "attivita", label: "Dati attività" }, { value: "shop", label: "Shop e pensione" }]} />
      {tab === "agenda" && <SettingsForm section="booking" title="Agenda e richieste di prenotazione" fields={[
        { key: "slotMinutes", label: "Griglia oraria (minuti)", type: "number", hint: "15, 30, 45, 60 o qualsiasi valore" },
        { key: "bufferMin", label: "Intervallo tra appuntamenti (minuti)", type: "number" },
        { key: "minNoticeHours", label: "Preavviso minimo richieste on line (ore)", type: "number" },
        { key: "maxDaysAhead", label: "Giorni prenotabili in anticipo", type: "number" },
        { key: "requestBlocksSlot", label: "Le richieste in attesa occupano lo slot (evita doppie richieste)", type: "checkbox" },
        { key: "allowAnyOperator", label: "Consenti 'Nessuna preferenza' sull'operatore", type: "checkbox" },
      ]} />}
      {tab === "pagamenti" && <PaymentsSettings />}
      {tab === "fidelity" && <SettingsForm section="loyalty" title="Fidelity Card" fields={[
        { key: "enabled", label: "Programma attivo", type: "checkbox" }, { key: "pointsPerEuro", label: "Punti per ogni euro", type: "number" },
        { key: "welcomePoints", label: "Punti di benvenuto", type: "number" }, { key: "birthdayPoints", label: "Punti compleanno (da assegnare con le campagne)", type: "number" },
      ]} />}
      {tab === "attivita" && <SettingsForm section="business" title="Dati dell'attività" fields={[
        { key: "name", label: "Nome" }, { key: "referent", label: "Referente" }, { key: "phone", label: "Telefono" }, { key: "email", label: "Email" },
        { key: "address", label: "Indirizzo" }, { key: "city", label: "Comune" }, { key: "groomingHours", label: "Orari toelettatura (testo sul sito)" },
      ]} />}
      {tab === "shop" && <div className="space-y-4">
        <SettingsForm section="shop" title="Shop" fields={[{ key: "pickupOnly", label: "Solo ritiro in negozio", type: "checkbox" }, { key: "shippingCents", label: "Costo consegna (centesimi)", type: "number" }, { key: "freeShippingFromCents", label: "Consegna gratuita da (centesimi)", type: "number" }]} />
        <SettingsForm section="boarding" title="Pensione casalinga" fields={[{ key: "info", label: "Informazioni mostrate al cliente", type: "textarea" }]} />
      </div>}
    </div>
  );
}

export function Privacy() {
  const qc = useQueryClient();
  const toast = useToast();
  const ref = useRef<HTMLInputElement>(null);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const { data, isLoading } = useQuery<any>({ queryKey: ["privacy", page, q], queryFn: () => get(`/api/admin/privacy-contacts?page=${page}&q=${encodeURIComponent(q)}`) });
  const upload = async (file: File) => {
    const fd = new FormData(); fd.append("file", file);
    try { const r = await api("/api/admin/privacy-contacts/import", { form: fd }); toast(`Importati ${r.imported} contatti (${r.linked} collegati a clienti, ${r.skipped} scartati)`); qc.invalidateQueries({ queryKey: ["privacy"] }); }
    catch (e: any) { toast(e.message, "err"); } finally { if (ref.current) ref.current.value = ""; }
  };
  return (
    <div>
      <PageTitle title="Contatti privacy" subtitle="Importazione dei consensi raccolti in precedenza (CSV)">
        <a href="/api/admin/privacy-contacts/export.csv" className="btn-outline btn-sm"><Download size={14} /> Esporta</a>
        <input ref={ref} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        <button className="btn-primary btn-sm" onClick={() => ref.current?.click()}><Upload size={14} /> Importa CSV</button>
      </PageTitle>
      <p className="mb-4 rounded-xl bg-brand-sky p-3 text-sm">Colonne riconosciute: <code>nome; cognome; email; telefono; consenso_privacy; consenso_marketing; data_consenso; fonte</code>. Separatore “;” o “,”. I contatti con la stessa email vengono aggiornati e collegati automaticamente al cliente registrato.</p>
      <div className="relative mb-3 max-w-sm"><Search size={16} className="absolute left-3 top-2.5 text-slate-400" /><input className="input pl-9" placeholder="Cerca" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></div>
      {isLoading ? <Spinner /> : !data?.rows?.length ? <Empty>Nessun contatto importato.</Empty> : (
        <div className="overflow-x-auto rounded-2xl border bg-white"><table className="table-dp"><thead><tr><th>Nome</th><th>Email</th><th>Telefono</th><th>Privacy</th><th>Marketing</th><th>Data consenso</th><th>Cliente</th></tr></thead>
          <tbody>{data.rows.map((c: any) => <tr key={c.id}><td>{c.firstName} {c.lastName}</td><td>{c.email}</td><td>{c.phone}</td><td>{c.consentPrivacy ? "✓" : "—"}</td><td>{c.consentMarketing ? "✓" : "—"}</td><td>{fmtDate(c.consentDate)}</td><td>{c.linkedUserId ? "✓" : "—"}</td></tr>)}</tbody></table></div>
      )}
      {data && <Pager page={page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
    </div>
  );
}

export function System() {
  const [tab, setTab] = useState("backup");
  const [page, setPage] = useState(1);
  const { data, isLoading } = useQuery<any>({ queryKey: ["audit", page], queryFn: () => get(`/api/admin/audit?page=${page}&pageSize=50`), enabled: tab === "log" });
  return (
    <div>
      <PageTitle title="Backup e registro operazioni" />
      <Tabs value={tab} onChange={setTab} items={[{ value: "backup", label: "Backup ed esportazioni" }, { value: "log", label: "Registro operazioni" }]} />
      {tab === "backup" ? (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="card"><h2 className="font-bold">Backup completo</h2><p className="mt-1 text-sm text-slate-600">Scarica tutti i dati (clienti, cani, appuntamenti, pagamenti, magazzino…) in formato JSON. Le password non vengono esportate.</p><a href="/api/admin/backup" className="btn-primary mt-3"><Download size={14} /> Scarica backup</a></div>
          <div className="card"><h2 className="font-bold">Esportazioni CSV</h2><div className="mt-2 flex flex-col gap-2 text-sm">
            <a className="text-brand-blue underline" href="/api/admin/customers/export.csv">Clienti</a>
            <a className="text-brand-blue underline" href="/api/admin/stock/export.csv">Inventario magazzino</a>
            <a className="text-brand-blue underline" href="/api/admin/privacy-contacts/export.csv">Contatti privacy</a>
            <span className="text-slate-500">Incassi e ore: dalle rispettive sezioni, scegliendo il periodo.</span></div></div>
        </div>
      ) : isLoading ? <Spinner /> : (
        <>
          <div className="overflow-x-auto rounded-2xl border bg-white"><table className="table-dp"><thead><tr><th>Data</th><th>Utente</th><th>Operazione</th><th>Elemento</th><th>Dettagli</th></tr></thead>
            <tbody>{data.rows.map((l: any) => <tr key={l.id}><td className="whitespace-nowrap">{fmtDateTime(l.createdAt)}</td><td>{l.actor || "—"}</td><td>{l.action}</td><td>{l.entity} {l.entityId && `#${l.entityId}`}</td><td className="max-w-md truncate text-xs text-slate-500">{JSON.stringify(l.data)}</td></tr>)}</tbody></table></div>
          <Pager page={page} pageSize={50} onPage={setPage} />
        </>
      )}
    </div>
  );
}
