import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Upload, Search, Plus, Trash2, History } from "lucide-react";
import { PageTitle, Spinner, Empty, Tabs, Pager, Field, Check, ErrorBox, MoneyInput, Modal, useToast } from "@/components/ui";
import ResourceManager from "@/components/ResourceManager";
import { api, get, put, patch } from "@/lib/api";
import { useMe, can } from "@/lib/auth";
import { fmtDateTime, fmtDate } from "@/lib/format";
import { euro, PAYMENT_MODES, WEEKDAYS } from "@shared/constants";
import { SettingsForm } from "./Content";

function useSettings() {
  return useQuery<any>({ queryKey: ["admin-settings"], queryFn: () => get("/api/admin/settings") });
}

function PaymentsSettings() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: me } = useMe();
  const { data } = useSettings();
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
      <p className="text-sm text-slate-600">Il pagamento si attiva solo <b>dopo</b> la conferma della richiesta. I dati delle carte non vengono mai salvati: il pagamento online avviene sulla pagina sicura del provider (Stripe), configurabile con le chiavi nei Secrets di Replit. Finché le chiavi non sono impostate i pagamenti online restano disattivati.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Modalità predefinita"><select className="input" disabled={me?.role !== "admin"} value={cur.defaultMode} onChange={(e) => setF({ ...cur, defaultMode: e.target.value })}>{Object.entries(PAYMENT_MODES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Acconto predefinito (%)"><input type="number" className="input" value={cur.depositPercent} onChange={(e) => setF({ ...cur, depositPercent: e.target.value })} /></Field>
        <Field label="Altri metodi di pagamento personalizzati" hint="Separati da virgola, es. Buono regalo"><input className="input" value={Array.isArray(cur.customMethods) ? cur.customMethods.join(", ") : cur.customMethods} onChange={(e) => setF({ ...cur, customMethods: e.target.value })} /></Field>
        <div className="pt-5"><Check checked={!!cur.onlineEnabled} onChange={(v) => setF({ ...cur, onlineEnabled: v })} label="Abilita pagamenti online (richiede STRIPE_SECRET_KEY)" /></div>
      </div>
      <ErrorBox error={err} />
      {me?.role === "admin" ? <button className="btn-primary" onClick={save}>Salva</button> : <p className="text-xs text-slate-500">Solo l'amministratore modifica i pagamenti.</p>}
    </div>
  );
}

/** Consegna a domicilio: zone servite per CAP, costi, soglie, tempi; ritiro in negozio. */
function ShopSettings() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data } = useSettings();
  const [f, setF] = useState<any>(null);
  const [err, setErr] = useState<unknown>(null);
  const cur = f ?? data?.shop;
  if (!cur) return <Spinner />;
  const zones: any[] = cur.deliveryZones || [];
  const setZone = (i: number, k: string, v: any) => { const z = [...zones]; z[i] = { ...z[i], [k]: v }; setF({ ...cur, deliveryZones: z }); };
  const save = async () => {
    setErr(null);
    try {
      await put("/api/admin/settings/shop", {
        pickupEnabled: !!cur.pickupEnabled, pickupInfo: cur.pickupInfo || "", deliveryEnabled: !!cur.deliveryEnabled,
        deliveryZones: zones.map((z) => ({ name: z.name, caps: (Array.isArray(z.caps) ? z.caps : String(z.caps || "").split(",")).map((c: string) => c.trim()).filter(Boolean), costCents: z.costCents ?? 0, freeFromCents: z.freeFromCents ?? null, eta: z.eta || "", active: z.active !== false })),
      });
      toast("Impostazioni shop salvate"); setF(null); qc.invalidateQueries({ queryKey: ["admin-settings"] }); qc.invalidateQueries({ queryKey: ["public-settings"] });
    } catch (e) { setErr(e); }
  };
  return (
    <div className="card space-y-4">
      <h2 className="text-lg font-bold">Ritiro e consegna</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-2"><Check checked={!!cur.pickupEnabled} onChange={(v) => setF({ ...cur, pickupEnabled: v })} label="Ritiro gratuito in negozio" /><Check checked={!!cur.deliveryEnabled} onChange={(v) => setF({ ...cur, deliveryEnabled: v })} label="Consegna a domicilio a pagamento" /></div>
        <Field label="Modalità di ritiro (testo per il cliente)"><textarea className="input" value={cur.pickupInfo || ""} onChange={(e) => setF({ ...cur, pickupInfo: e.target.value })} /></Field>
      </div>
      <div>
        <p className="label">Zone servite</p>
        {zones.length === 0 && <p className="text-sm text-slate-500">Nessuna zona: la consegna non sarà selezionabile.</p>}
        <div className="space-y-2">{zones.map((z, i) => (
          <div key={i} className="grid items-end gap-2 rounded-xl border p-2 sm:grid-cols-6">
            <Field label="Zona"><input className="input" value={z.name || ""} onChange={(e) => setZone(i, "name", e.target.value)} /></Field>
            <Field label="CAP (separati da virgola)" className="sm:col-span-2"><input className="input" value={Array.isArray(z.caps) ? z.caps.join(", ") : z.caps || ""} onChange={(e) => setZone(i, "caps", e.target.value)} /></Field>
            <Field label="Costo"><MoneyInput value={z.costCents} onChange={(v) => setZone(i, "costCents", v)} /></Field>
            <Field label="Gratis da"><MoneyInput value={z.freeFromCents} onChange={(v) => setZone(i, "freeFromCents", v)} /></Field>
            <Field label="Tempi indicativi"><input className="input" value={z.eta || ""} onChange={(e) => setZone(i, "eta", e.target.value)} placeholder="es. 1-2 giorni" /></Field>
            <div className="flex items-center gap-3 sm:col-span-6"><Check checked={z.active !== false} onChange={(v) => setZone(i, "active", v)} label="Attiva" />
              <button type="button" className="btn-ghost btn-sm text-red-600" onClick={() => setF({ ...cur, deliveryZones: zones.filter((_, j) => j !== i) })}><Trash2 size={14} /> Rimuovi</button></div>
          </div>
        ))}</div>
        <button type="button" className="btn-outline btn-sm mt-2" onClick={() => setF({ ...cur, deliveryZones: [...zones, { name: "Cernusco sul Naviglio", caps: ["20063"], costCents: null, freeFromCents: null, eta: "", active: true }] })}><Plus size={14} /> Aggiungi zona</button>
        <p className="mt-1 text-xs text-slate-500">I costi di consegna non sono preimpostati: inseriscili prima di attivare la consegna.</p>
      </div>
      <ErrorBox error={err} />
      <button className="btn-primary" onClick={save} disabled={!f}>Salva</button>
    </div>
  );
}

function LoginLog() {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useQuery<any>({ queryKey: ["login-log-sys", page], queryFn: () => get(`/api/admin/login-log?page=${page}&pageSize=50`) });
  if (isLoading) return <Spinner />;
  return (
    <div>
      <div className="overflow-x-auto rounded-2xl border bg-white"><table className="table-dp"><thead><tr><th>Data</th><th>Accesso</th><th>Esito</th><th>IP</th></tr></thead>
        <tbody>{(data?.rows || []).map((l: any) => <tr key={l.id}><td>{fmtDateTime(l.createdAt)}</td><td>{l.login}</td><td className={l.success ? "text-green-700" : "text-red-600"}>{l.success ? "riuscito" : `fallito${l.reason ? ` (${l.reason})` : ""}`}</td><td className="text-xs">{l.ip}</td></tr>)}</tbody></table></div>
      <Pager page={page} pageSize={50} onPage={setPage} />
    </div>
  );
}

function AuditLog() {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useQuery<any>({ queryKey: ["audit", page], queryFn: () => get(`/api/admin/audit?page=${page}&pageSize=50`) });
  if (isLoading) return <Spinner />;
  return (
    <div>
      <div className="overflow-x-auto rounded-2xl border bg-white"><table className="table-dp"><thead><tr><th>Data</th><th>Utente</th><th>Operazione</th><th>Elemento</th><th>Dettagli</th></tr></thead>
        <tbody>{data.rows.map((l: any) => <tr key={l.id}><td className="whitespace-nowrap">{fmtDateTime(l.createdAt)}</td><td>{l.actor || "—"}</td><td>{l.action}</td><td>{l.entity} {l.entityId && `#${l.entityId}`}</td><td className="max-w-md truncate text-xs text-slate-500" title={JSON.stringify(l.data)}>{JSON.stringify(l.data)}</td></tr>)}</tbody></table></div>
      <Pager page={page} pageSize={50} onPage={setPage} />
    </div>
  );
}

function Backup() {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="card"><h2 className="font-bold">Backup completo</h2><p className="mt-1 text-sm text-slate-600">Scarica tutti i dati in JSON (clienti, cani, appuntamenti, pagamenti, magazzino, consensi…). Password e token non vengono esportati. Per i backup periodici su file vedi il README (<code>npm run db:backup</code>).</p><a href="/api/admin/backup" className="btn-primary mt-3"><Download size={14} /> Scarica backup</a></div>
      <div className="card"><h2 className="font-bold">Esportazioni</h2><div className="mt-2 flex flex-col gap-2 text-sm">
        <a className="text-brand-blue underline" href="/api/admin/customers/export.csv">Clienti (CSV)</a>
        <a className="text-brand-blue underline" href="/api/admin/stock/export.csv">Inventario magazzino (CSV)</a>
        <a className="text-brand-blue underline" href="/api/admin/privacy-contacts/export.csv">Contatti privacy (CSV)</a>
        <span className="text-slate-500">Report, incassi, ore e liquidazioni: dalle rispettive sezioni in Excel o PDF.</span></div></div>
    </div>
  );
}

export function SettingsPage() {
  const { data: me } = useMe();
  const isAdmin = me?.role === "admin";
  const tabs = [
    can(me ?? null, "impostazioni") && { value: "pagamenti", label: "Pagamenti" },
    can(me ?? null, "impostazioni") && { value: "cancellazioni", label: "Cancellazioni e assenze" },
    can(me ?? null, "fidelity") && { value: "fidelity", label: "Fidelity" },
    can(me ?? null, "personale") && { value: "personale", label: "Ore e liquidazioni" },
    can(me ?? null, "impostazioni") && { value: "shop", label: "Shop e consegne" },
    can(me ?? null, "impostazioni") && { value: "pensione", label: "Pensione" },
    isAdmin && { value: "accessi", label: "Accessi" },
    isAdmin && { value: "log", label: "Registro operazioni" },
    isAdmin && { value: "backup", label: "Backup" },
  ].filter(Boolean) as { value: string; label: string }[];
  const [tab, setTab] = useState(tabs[0]?.value || "pagamenti");
  return (
    <div>
      <PageTitle title="Impostazioni" subtitle="Griglia oraria e regole delle richieste sono in “Turni e disponibilità”" />
      <Tabs value={tab} onChange={setTab} items={tabs} />
      {tab === "pagamenti" && <PaymentsSettings />}
      {tab === "cancellazioni" && <SettingsForm section="cancellation" title="Cancellazioni, spostamenti e assenze" intro="Il cliente può annullare da solo fino al termine indicato; oltre, invia una richiesta al salone. Gli annullamenti oltre il termine vengono segnalati come tardivi; assenze e motivi restano nello storico dell'appuntamento." fields={[
        { key: "cancelHours", label: "Termine per cancellare (ore prima)", type: "number" }, { key: "rescheduleHours", label: "Termine per spostare (ore prima)", type: "number" },
        { key: "depositPolicy", label: "Condizioni sugli acconti (mostrate al cliente)", type: "textarea" },
        { key: "reasons", label: "Motivi di annullamento", type: "list", hint: "Separati da virgola" },
      ]} />}
      {tab === "fidelity" && <SettingsForm section="loyalty" title="Regole Fidelity Card" intro="I punti si accreditano a servizio completato e a ordine concluso; ogni servizio e prodotto può essere escluso dalla sua scheda. In caso di rimborso o annullamento i punti collegati vengono stornati automaticamente." fields={[
        { key: "enabled", label: "Programma attivo", type: "checkbox" }, { key: "pointsPerEuro", label: "Punti per ogni euro", type: "number" },
        { key: "earnOnServices", label: "I servizi generano punti", type: "checkbox" }, { key: "earnOnProducts", label: "I prodotti generano punti", type: "checkbox" },
        { key: "welcomePoints", label: "Punti di benvenuto", type: "number", hint: "Alla registrazione, una sola volta. 0 = bonus disattivato. Non viene assegnato creando una scheda Self-Service." }, { key: "birthdayPoints", label: "Punti di compleanno", type: "number" },
        { key: "pointValueCents", label: "Valore di 1 punto (centesimi)", type: "number", hint: "Usato per sconti e credito shop. 0 = conversione disattivata" },
        { key: "minRedeemPoints", label: "Punti minimi per l'utilizzo", type: "number" },
        { key: "expiryMode", label: "Scadenza dei punti", type: "select", options: [{ value: "nessuna", label: "Nessuna scadenza" }, { value: "annuale", label: "Annuale (12 mesi dall'accumulo)" }, { value: "fissa", label: "Data fissa ogni anno" }, { value: "periodo", label: "Dopo N giorni dall'accumulo" }] },
        { key: "expiryFixedDate", label: "Data fissa (MM-GG)", hint: "es. 12-31 per il 31 dicembre" }, { key: "expiryDays", label: "Giorni di validità (scadenza dopo un periodo)", type: "number" },
      ]} />}
      {tab === "personale" && <SettingsForm section="staff" title="Ore lavorate e liquidazione" intro="Le ore effettive sono arrotondate al passo indicato (minimo 15 minuti, come da accordi) e moltiplicate per la tariffa dell'operatore. Conteggi gestionali: non sostituiscono cedolini o adempimenti fiscali." fields={[
        { key: "roundingStep", label: "Precisione (minuti)", type: "number" },
        { key: "roundingMode", label: "Arrotondamento", type: "select", options: [{ value: "vicino", label: "Al quarto d'ora più vicino" }, { value: "difetto", label: "Per difetto" }, { value: "eccesso", label: "Per eccesso" }] },
        { key: "payWeekday", label: "Giorno di liquidazione", type: "select", options: WEEKDAYS.map((w, i) => ({ value: i, label: w })) },
      ]} />}
      {tab === "shop" && <ShopSettings />}
      {tab === "pensione" && <SettingsForm section="boarding" title="Pensione casalinga" fields={[{ key: "info", label: "Informazioni mostrate al cliente", type: "textarea" }]} />}
      {tab === "accessi" && <LoginLog />}
      {tab === "log" && <AuditLog />}
      {tab === "backup" && <Backup />}
    </div>
  );
}

const PRIVACY_STATUS: Record<string, string> = { non_inviata: "Non inviata", inviata: "Inviata", presa_visione: "Presa visione", accettata: "Accettata", rifiutata: "Rifiutata" };
const MKT_STATUS: Record<string, string> = { non_richiesto: "Non richiesto", da_verificare: "Da verificare", concesso: "Concesso", negato: "Negato", revocato: "Revocato" };

function Contacts() {
  const qc = useQueryClient();
  const toast = useToast();
  const ref = useRef<HTMLInputElement>(null);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [mkt, setMkt] = useState("");
  const [edit, setEdit] = useState<any>(null);
  const [hist, setHist] = useState<any[] | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [source, setSource] = useState("");
  const { data, isLoading } = useQuery<any>({ queryKey: ["privacy", page, q, mkt], queryFn: () => get(`/api/admin/privacy-contacts?page=${page}&q=${encodeURIComponent(q)}${mkt ? `&marketingStatus=${mkt}` : ""}`) });
  const upload = async (file: File) => {
    if (!confirm("Importare il file? In questa fase non vanno importati contatti reali senza informativa: usa solo file di prova o dati già raccolti con l'applicativo privacy.")) { if (ref.current) ref.current.value = ""; return; }
    const fd = new FormData(); fd.append("file", file); fd.append("source", source || "import_csv");
    try { const r = await api("/api/admin/privacy-contacts/import", { form: fd }); toast(`Nuovi ${r.imported}, aggiornati ${r.updated}, collegati a clienti ${r.linked}, scartati ${r.skipped}`); qc.invalidateQueries({ queryKey: ["privacy"] }); }
    catch (e: any) { toast(e.message, "err"); } finally { if (ref.current) ref.current.value = ""; }
  };
  const save = async () => {
    setErr(null);
    try { await patch(`/api/admin/privacy-contacts/${edit.id}`, { privacyStatus: edit.privacyStatus, privacyVersion: edit.privacyVersion || null, marketingStatus: edit.marketingStatus, consentProof: edit.consentProof || null }); toast("Contatto aggiornato"); setEdit(null); qc.invalidateQueries({ queryKey: ["privacy"] }); }
    catch (e) { setErr(e); }
  };
  return (
    <div>
      <div className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
        <b>Predisposizione.</b> Questa sezione è pronta a ricevere i contatti raccolti in futuro dall'applicativo privacy di PromoApp (rubrica WhatsApp Business). I contatti importati <b>non sono mai autorizzati al marketing in automatico</b>: un consenso dichiarato nel file resta “da verificare” finché non viene registrata la prova.
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative max-w-xs flex-1"><Search size={16} className="absolute left-3 top-2.5 text-slate-400" /><input className="input pl-9" placeholder="Cerca nome, email, telefono" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></div>
        <select className="input w-48" value={mkt} onChange={(e) => { setMkt(e.target.value); setPage(1); }}><option value="">Tutti i consensi</option>{Object.entries(MKT_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <a href="/api/admin/privacy-contacts/export.csv" className="btn-outline btn-sm"><Download size={14} /> Esporta</a>
        <input className="input w-44" placeholder="Provenienza (es. whatsapp)" value={source} onChange={(e) => setSource(e.target.value)} />
        <input ref={ref} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        <button className="btn-outline btn-sm" onClick={() => ref.current?.click()}><Upload size={14} /> Importa CSV</button>
      </div>
      <p className="mb-3 text-xs text-slate-500">Colonne riconosciute: <code>id_esterno; nome; cognome; email; telefono; stato_informativa; versione_informativa; data_presa_visione; consenso_marketing; data_consenso; fonte; prova_consenso</code>. Duplicati riconosciuti per id esterno, email e telefono.</p>
      {isLoading ? <Spinner /> : !data?.rows?.length ? <Empty>Nessun contatto importato.</Empty> : (
        <div className="overflow-x-auto rounded-2xl border bg-white"><table className="table-dp"><thead><tr><th>Nome</th><th>Contatti</th><th>Provenienza</th><th>Informativa</th><th>Marketing</th><th>Cliente</th><th /></tr></thead>
          <tbody>{data.rows.map((c: any) => <tr key={c.id}><td>{c.firstName} {c.lastName}{c.externalId && <span className="block text-xs text-slate-400">id {c.externalId}</span>}</td><td className="text-xs">{c.email}<br />{c.phone}</td><td className="text-xs">{c.source}<br />{fmtDate(c.importedAt)}</td>
            <td className="text-xs">{PRIVACY_STATUS[c.privacyStatus]}{c.privacyVersion && ` v${c.privacyVersion}`}{c.privacySeenAt && <span className="block">{fmtDate(c.privacySeenAt)}</span>}</td>
            <td className="text-xs">{MKT_STATUS[c.marketingStatus]}{c.revokedAt && <span className="block text-red-600">revocato {fmtDate(c.revokedAt)}</span>}</td><td>{c.linkedUserId ? "✓" : "—"}</td>
            <td className="whitespace-nowrap"><button className="btn-ghost btn-sm" onClick={() => { setErr(null); setEdit({ ...c }); }}>Gestisci</button><button className="btn-ghost btn-sm" title="Storico" onClick={async () => setHist(await get(`/api/admin/privacy-contacts/${c.id}/history`))}><History size={14} /></button></td></tr>)}</tbody></table></div>
      )}
      {data && <Pager page={page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
      {data?.imports?.length > 0 && <div className="mt-6"><h3 className="mb-2 font-bold">Registro importazioni</h3>
        <table className="table-dp rounded-2xl bg-white"><thead><tr><th>Data</th><th>File</th><th>Righe</th><th>Nuovi</th><th>Aggiornati</th><th>Duplicati</th><th>Scartati</th></tr></thead>
          <tbody>{data.imports.map((i: any) => <tr key={i.id}><td>{fmtDateTime(i.createdAt)}</td><td>{i.filename}<span className="block text-xs text-slate-400">{i.source}</span></td><td>{i.rowsTotal}</td><td>{i.imported}</td><td>{i.updated}</td><td>{i.duplicates}</td><td title={JSON.stringify(i.errors)}>{i.skipped}</td></tr>)}</tbody></table></div>}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={`Consensi – ${edit?.firstName || ""} ${edit?.lastName || ""}`}>
        {edit && <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Stato informativa"><select className="input" value={edit.privacyStatus} onChange={(e) => setEdit({ ...edit, privacyStatus: e.target.value })}>{Object.entries(PRIVACY_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
            <Field label="Versione informativa"><input className="input" value={edit.privacyVersion || ""} onChange={(e) => setEdit({ ...edit, privacyVersion: e.target.value })} /></Field>
            <Field label="Consenso marketing"><select className="input" value={edit.marketingStatus} onChange={(e) => setEdit({ ...edit, marketingStatus: e.target.value })}>{Object.entries(MKT_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
            <Field label="Fonte e prova del consenso" hint="Obbligatoria per registrare un consenso concesso"><input className="input" value={edit.consentProof || ""} onChange={(e) => setEdit({ ...edit, consentProof: e.target.value })} /></Field>
          </div>
          <ErrorBox error={err} />
          <button className="btn-primary" onClick={save}>Salva (con storico)</button>
        </div>}
      </Modal>
      <Modal open={!!hist} onClose={() => setHist(null)} title="Storico modifiche">
        {hist && (hist.length ? <ul className="space-y-2 text-sm">{hist.map((h) => <li key={h.id} className="rounded-xl bg-slate-50 p-2"><b>{fmtDateTime(h.createdAt)}</b><pre className="mt-1 whitespace-pre-wrap text-xs text-slate-600">{JSON.stringify(h.changes, null, 1)}</pre></li>)}</ul> : <Empty>Nessuna modifica.</Empty>)}
      </Modal>
    </div>
  );
}

function ConsentHistory() {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useQuery<any>({ queryKey: ["consents", page], queryFn: () => get(`/api/admin/consents?page=${page}&pageSize=50`) });
  if (isLoading) return <Spinner />;
  return (
    <div>
      {!data?.rows?.length ? <Empty>Nessuna autorizzazione registrata.</Empty> : (
        <div className="overflow-x-auto rounded-2xl border bg-white"><table className="table-dp"><thead><tr><th>Data</th><th>Cliente</th><th>Tipo</th><th>Esito</th><th>Versione</th><th>Fonte</th></tr></thead>
          <tbody>{data.rows.map((c: any) => <tr key={c.id}><td className="whitespace-nowrap">{fmtDateTime(c.createdAt)}</td><td>{c.name || (c.privacyContactId ? `contatto #${c.privacyContactId}` : "—")}<span className="block text-xs text-slate-400">{c.email}</span></td><td>{c.kind}</td>
            <td className={c.granted ? "text-green-700" : "text-red-600"}>{c.granted ? "concesso" : "negato / revocato"}</td><td>{c.policyVersion || "—"}</td><td className="text-xs">{c.source}{c.proof && <span className="block text-slate-500">{c.proof}</span>}</td></tr>)}</tbody></table></div>
      )}
      <Pager page={page} pageSize={50} onPage={setPage} />
    </div>
  );
}

export function Privacy() {
  const [tab, setTab] = useState("storico");
  return (
    <div>
      <PageTitle title="Privacy e consensi" subtitle="Storico delle autorizzazioni, versioni delle informative e predisposizione all'importazione dei contatti" />
      <Tabs value={tab} onChange={setTab} items={[{ value: "storico", label: "Storico autorizzazioni" }, { value: "informative", label: "Versioni informative" }, { value: "contatti", label: "Contatti da importare" }]} />
      {tab === "storico" && <ConsentHistory />}
      {tab === "informative" && (
        <ResourceManager title="Versioni delle informative" subtitle="Ogni consenso registra la versione dell'informativa in vigore. Il testo pubblico si modifica da Contenuti → Pagine." endpoint="/api/admin/consent-policies" canDelete={false}
          defaults={{ kind: "privacy", active: true }}
          fields={[
            { name: "kind", label: "Tipo", type: "select", required: true, options: [{ value: "privacy", label: "Informativa privacy" }, { value: "marketing", label: "Consenso marketing" }, { value: "cookie", label: "Cookie policy" }, { value: "condizioni", label: "Condizioni del servizio" }] },
            { name: "version", label: "Versione", required: true, hint: "es. 1.0 – 2026-11" }, { name: "summary", label: "Note / riepilogo modifiche", type: "textarea", nullable: true }, { name: "active", label: "In vigore", type: "checkbox" },
          ]}
          columns={[{ key: "kind", label: "Tipo" }, { key: "version", label: "Versione" }, { key: "publishedAt", label: "Pubblicata", render: (r) => fmtDate(r.publishedAt) }, { key: "active", label: "In vigore", render: (r) => (r.active ? "✓" : "—") }]}
        />
      )}
      {tab === "contatti" && <Contacts />}
    </div>
  );
}

