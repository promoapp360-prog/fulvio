import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Search, Download, Pencil, Phone, MessageCircle, Mail, ArrowLeft, Dog, AlertTriangle } from "lucide-react";
import { PageTitle, Spinner, Empty, Pager, Modal, Field, Check, ErrorBox, Tabs, StatusBadge, MoneyInput, useToast } from "@/components/ui";
import DogForm, { ageOf } from "@/components/DogForm";
import ResourceManager from "@/components/ResourceManager";
import { get, post, patch } from "@/lib/api";
import { useMe, can } from "@/lib/auth";
import { fmtDate, fmtDateTime, fmtDay } from "@/lib/format";
import { euro, SIZE_LABELS, SIZES, PAYMENT_KINDS, PAYMENT_METHODS, ORDER_STATUS, BOARDING_STATUS, LOYALTY_KINDS } from "@shared/constants";

const emptyCustomer = { firstName: "", lastName: "", email: "", phone: "", address: "", city: "", province: "", cap: "", country: "Italia", birthDate: "", notes: "", consentPrivacy: true, consentMarketing: false, commEmail: true, commWhatsapp: false, active: true, sendInvite: false, consentProof: "" };

function CustomerForm({ initial, onDone }: { initial: any; onDone: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState<any>({ ...emptyCustomer, ...initial });
  const [err, setErr] = useState<unknown>(null);
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null);
    const keys = Object.keys(emptyCustomer).filter((k) => initial.id ? k !== "sendInvite" : true);
    const body = Object.fromEntries(keys.map((k) => [k, f[k] === "" ? null : f[k]]));
    try {
      if (initial.id) await patch(`/api/admin/customers/${initial.id}`, body); else await post("/api/admin/customers", body);
      toast("Cliente salvato"); qc.invalidateQueries({ queryKey: ["customers"] }); qc.invalidateQueries({ queryKey: ["customer"] }); onDone();
    } catch (x) { setErr(x); }
  };
  return (
    <form onSubmit={save} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nome *"><input className="input" required value={f.firstName} onChange={set("firstName")} /></Field>
        <Field label="Cognome *"><input className="input" required value={f.lastName} onChange={set("lastName")} /></Field>
        <Field label="Email *"><input type="email" className="input" required value={f.email} onChange={set("email")} /></Field>
        <Field label="Telefono"><input className="input" value={f.phone || ""} onChange={set("phone")} /></Field>
        <Field label="Indirizzo"><input className="input" value={f.address || ""} onChange={set("address")} /></Field>
        <Field label="Comune"><input className="input" value={f.city || ""} onChange={set("city")} /></Field>
        <Field label="Provincia"><input className="input" value={f.province || ""} onChange={set("province")} /></Field>
        <Field label="CAP"><input className="input" value={f.cap || ""} onChange={set("cap")} /></Field>
        <Field label="Paese"><input className="input" value={f.country || ""} onChange={set("country")} /></Field>
        <Field label="Data di nascita"><input type="date" className="input" value={f.birthDate || ""} onChange={set("birthDate")} /></Field>
        <Field label="Note" className="sm:col-span-2"><textarea className="input" value={f.notes || ""} onChange={set("notes")} /></Field>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Check checked={f.consentPrivacy} onChange={(v) => setF({ ...f, consentPrivacy: v })} label="Informativa privacy accettata" />
        <Check checked={f.consentMarketing} onChange={(v) => setF({ ...f, consentMarketing: v })} label="Consenso marketing" />
        <Check checked={f.commEmail} onChange={(v) => setF({ ...f, commEmail: v })} label="Comunicazioni via email" />
        <Check checked={f.commWhatsapp} onChange={(v) => setF({ ...f, commWhatsapp: v })} label="Contattabile su WhatsApp" />
        <Check checked={f.active} onChange={(v) => setF({ ...f, active: v })} label="Account attivo" />
        {!initial.id && <Check checked={f.sendInvite} onChange={(v) => setF({ ...f, sendInvite: v })} label="Invia email di benvenuto con accesso" />}
      </div>
      {f.consentMarketing && !initial.consentMarketing && <Field label="Prova del consenso marketing *" hint="Es. modulo cartaceo firmato il 12/03/2026 – il consenso non va mai preselezionato"><input className="input" value={f.consentProof} onChange={(e) => setF({ ...f, consentProof: e.target.value })} /></Field>}
      <ErrorBox error={err} />
      <button className="btn-primary">Salva</button>
    </form>
  );
}

export function Customers() {
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const [tab, setTab] = useState("elenco");
  const [flt, setFlt] = useState<Record<string, string>>({});
  const [guestDetail,setGuestDetail]=useState<number|null>(null);
  const qs = Object.entries(flt).filter(([, v]) => v).map(([k, v]) => `&${k}=${encodeURIComponent(v)}`).join("");
  const { data, isLoading } = useQuery<any>({ queryKey: ["customers", page, q, qs], queryFn: () => get(`/api/admin/customers?page=${page}&q=${encodeURIComponent(q)}${qs}`) });
  const { data: dups } = useQuery<any[]>({ queryKey: ["dups"], queryFn: () => get("/api/admin/customers/duplicates"), enabled: tab === "duplicati" });
  const { data: svc } = useQuery<any[]>({ queryKey: ["admin-services"], queryFn: () => get("/api/admin/services").catch(() => []) });
  const {data:guestData,isLoading:guestLoading}=useQuery<any>({queryKey:["guest-customers",q],queryFn:()=>get(`/api/admin/guest-customers?q=${encodeURIComponent(q)}`),enabled:tab==="ospiti"});
  if(guestDetail)return <GuestCustomerDetail id={guestDetail} onBack={()=>setGuestDetail(null)}/>;
  return (
    <div>
      <PageTitle title="Clienti e cani" subtitle={data ? `${data.total} clienti` : undefined}>
        <a href="/api/admin/customers/export.csv" className="btn-outline btn-sm"><Download size={14} /> Esporta CSV</a>
        <button className="btn-primary btn-sm" onClick={() => setCreating(true)}><Plus size={14} /> Nuovo cliente</button>
      </PageTitle>
      <Tabs value={tab} onChange={setTab} items={[{ value: "elenco", label: "Clienti registrati" }, { value:"ospiti",label:"Archivio storico ospiti" }, { value: "duplicati", label: "Possibili duplicati" }]} />
      {tab==="ospiti"?<div>
        <p className="mb-3 rounded-xl bg-slate-50 p-3 text-sm text-slate-600">Archivio delle anagrafiche precedenti alla chiusura del percorso ospite. Non permette nuove richieste o approvazioni: per prenotare è obbligatorio registrarsi.</p>
        <div className="relative mb-3 w-full max-w-md"><Search size={16} className="absolute left-3 top-2.5 text-slate-400"/><input className="input pl-9" placeholder="Cerca nome, recapito o cane ospite" value={q} onChange={e=>setQ(e.target.value)}/></div>
        {guestLoading?<Spinner/>:!guestData?.rows?.length?<Empty>Nessuna anagrafica ospite presente.</Empty>:<div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white"><table className="table-dp"><thead><tr><th>Cliente ospite</th><th>Recapiti</th><th>Cani</th><th>Richieste</th><th>Verifica</th><th>Collegamento</th></tr></thead><tbody>{guestData.rows.map((c:any)=><tr key={c.id} data-testid={`crm-guest-${c.id}`} className="cursor-pointer hover:bg-brand-sky" onClick={()=>setGuestDetail(c.id)}>
          <td className="font-bold">{c.lastName} {c.firstName}<span className="badge ml-1 bg-amber-100 text-amber-800">Ospite</span></td><td>{c.email}<br/>{c.phone}</td><td>{c.dogs||"—"}</td><td>{c.requests} · ultimo {c.lastRequest?fmtDate(c.lastRequest):"—"}</td>
          <td>{c.needsManualReview?<span title={c.reviewReason} className="badge bg-red-100 text-red-700"><AlertTriangle size={12} className="mr-1 inline"/>Da verificare</span>:<span className="badge bg-green-100 text-green-800">Nessun conflitto noto</span>}</td>
          <td>{c.linkedUserId?"Account collegato":c.emailVerifiedAt?"Email verificata":"Non verificato"}</td>
        </tr>)}</tbody></table></div>}
      </div>:tab === "duplicati" ? (!dups ? <Spinner /> : !dups.length ? <Empty>Nessun possibile duplicato trovato.</Empty> : (
        <div className="space-y-3">{dups.map((g) => (
          <div key={g.key} className="card"><p className="mb-2 text-sm font-bold text-amber-700">{g.reason}</p>
            <ul className="text-sm">{g.customers.map((c: any) => <li key={c.id}><Link href={`/admin/clienti/${c.id}`} className="font-bold text-brand-blue underline">{c.lastName} {c.firstName}</Link> · {c.email} · {c.phone || "—"} · dal {fmtDate(c.createdAt)}</li>)}</ul></div>
        ))}<p className="text-xs text-slate-500">Verifica i dati e, se si tratta della stessa persona, disattiva l'anagrafica non più usata dopo aver spostato i cani.</p></div>
      )) : <>
      <div className="mb-3 flex flex-wrap gap-2">
        <div className="relative w-full max-w-md"><Search size={16} className="absolute left-3 top-2.5 text-slate-400" /><input className="input pl-9" placeholder="Nome, telefono, email o nome del cane" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></div>
        <select className="input w-40" value={flt.marketing || ""} onChange={(e) => { setFlt({ ...flt, marketing: e.target.value }); setPage(1); }}><option value="">Marketing: tutti</option><option value="si">Con consenso</option><option value="no">Senza consenso</option></select>
        <select className="input w-36" value={flt.size || ""} onChange={(e) => { setFlt({ ...flt, size: e.target.value }); setPage(1); }}><option value="">Taglia cane</option>{SIZES.map((z) => <option key={z} value={z}>{SIZE_LABELS[z]}</option>)}</select>
        <select className="input w-48" value={flt.serviceId || ""} onChange={(e) => { setFlt({ ...flt, serviceId: e.target.value }); setPage(1); }}><option value="">Servizio effettuato</option>{svc?.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
        <input className="input w-36" type="number" min={1} placeholder="Inattivi da gg" value={flt.inactiveDays || ""} onChange={(e) => { setFlt({ ...flt, inactiveDays: e.target.value }); setPage(1); }} />
        <input className="input w-36" type="number" min={1} placeholder="Min. visite/anno" value={flt.minVisits || ""} onChange={(e) => { setFlt({ ...flt, minVisits: e.target.value }); setPage(1); }} />
        <input className="input w-36" placeholder="Comune" value={flt.city || ""} onChange={(e) => { setFlt({ ...flt, city: e.target.value }); setPage(1); }} />
      </div>
      {isLoading ? <Spinner /> : !data?.rows?.length ? <Empty>Nessun cliente trovato.</Empty> : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          <table className="table-dp"><thead><tr><th>Cliente</th><th>Contatti</th><th>Cani</th><th>Ultima visita</th><th>Marketing</th></tr></thead>
            <tbody>{data.rows.map((c: any) => (
              <tr key={c.id} className="hover:bg-brand-sky">
                <td><Link href={`/admin/clienti/${c.id}`} className="font-bold text-brand-navy underline">{c.lastName} {c.firstName}</Link>{!c.active && <span className="badge ml-1 bg-slate-200">disattivo</span>}</td>
                <td className="text-xs">{c.phone}<br />{c.email}</td><td>{c.dogs || "—"}</td><td>{c.lastVisit ? fmtDate(c.lastVisit) : "—"}</td><td>{c.consentMarketing ? "✓" : "—"}</td>
              </tr>
            ))}</tbody></table>
        </div>
      )}
      {data && <Pager page={page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
      </>}
      <Modal open={creating} onClose={() => setCreating(false)} title="Nuovo cliente" wide><CustomerForm initial={{}} onDone={() => setCreating(false)} /></Modal>
    </div>
  );
}

function GuestCustomerDetail({id:guestId,onBack}:{id:number;onBack:()=>void}){
  const {data,isLoading}=useQuery<any>({queryKey:["guest-customer",guestId],queryFn:()=>get(`/api/admin/guest-customers/${guestId}`)});
  if(isLoading||!data)return <Spinner/>;
  const c=data.customer;
  return <div>
    <button className="btn-outline btn-sm mb-3" onClick={onBack}><ArrowLeft size={14}/> Torna alle anagrafiche ospiti</button>
    <PageTitle title={`${c.firstName} ${c.lastName}`} subtitle="Archivio storico ospite · percorso disattivato · nessun account creato">
      <a href={`mailto:${c.email}`} className="btn-outline btn-sm"><Mail size={14}/> Email</a>{c.phone&&<a href={`tel:${c.phone}`} className="btn-outline btn-sm"><Phone size={14}/> Chiama</a>}
    </PageTitle>
    <div className="mb-4 grid gap-3 text-sm sm:grid-cols-3">
      <div className="card"><p className="label">Contatti</p>{c.email}<br/>{c.phone}<p className="mt-2 text-xs text-slate-500">Fonte: {c.source}</p></div>
      <div className="card"><p className="label">Presa visione informativa</p>{fmtDateTime(c.privacyAcknowledgedAt)}<br/>Versione: {c.privacyVersion||"—"}<br/>Prova: {c.privacyProof||"—"}</div>
      <div className="card"><p className="label">Marketing facoltativo</p>{c.marketingConsent?"Selezionato separatamente":"Non selezionato"}{c.needsManualReview&&<p className="mt-2 rounded-lg bg-red-50 p-2 text-red-800"><b>Verifica manuale:</b> {c.reviewReason}</p>}{c.linkedUserId&&<p className="mt-1">Account associato dopo verifica</p>}</div>
    </div>
    <section className="mb-5"><h2 className="mb-2 flex items-center gap-2 text-lg font-bold"><Dog size={18}/>Schede cane ospite</h2>{!data.dogs?.length?<Empty>Nessuna scheda cane.</Empty>:<div className="grid gap-3 md:grid-cols-2">{data.dogs.map((d:any)=><div className="card" key={d.id}>
      <h3 className="font-bold">{d.name} · {d.breed}</h3><p className="text-sm">Taglia stimata {d.size} · circa {d.weightKg} kg · {d.ageYears??"—"} anni {d.ageMonths||0} mesi</p><p className="text-sm">Pelo {d.coatType}, {d.coatLength.toLowerCase()} · {(d.coatConditions||[]).join(", ")}</p>{d.coatNotes&&<p className="text-sm">Note manto: {d.coatNotes}</p>}<img src={`/api/admin/guest-dogs/${d.id}/photo`} alt={`Foto di ${d.name}`} className="mt-2 max-h-56 rounded-xl object-contain" onError={e=>(e.currentTarget.style.display="none")}/>
    </div>)}</div>}</section>
    <section><h2 className="mb-2 text-lg font-bold">Richieste collegate</h2>{!data.requests?.length?<Empty>Nessuna richiesta.</Empty>:<div className="overflow-x-auto rounded-2xl border bg-white"><table className="table-dp"><thead><tr><th>Data</th><th>Cane</th><th>Servizio</th><th>Stato</th><th>Privacy</th></tr></thead><tbody>{data.requests.map((r:any)=><tr key={r.id}><td>{fmtDateTime(r.startAt)}</td><td>{r.dogName}</td><td>{r.serviceName}{(r.requestedServiceIds||[]).length>1&&" + altri servizi"}</td><td><StatusBadge status={r.status}/></td><td className="text-xs">{r.privacyVersion||"—"}<br/>{r.privacyAcknowledgedAt?fmtDateTime(r.privacyAcknowledgedAt):"—"}</td></tr>)}</tbody></table></div>}</section>
  </div>;
}

export function CustomerDetail({ id }: { id: number }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isLoading } = useQuery<any>({ queryKey: ["customer", id], queryFn: () => get(`/api/admin/customers/${id}`) });
  const [tab, setTab] = useState("cani");
  const [edit, setEdit] = useState(false);
  const [dog, setDog] = useState<any>(null);
  const [pts, setPts] = useState({ points: "", reason: "" });
  if (isLoading || !data) return <Spinner />;
  const c = data.customer;
  const saveDog = async (d: any) => {
    if (dog?.id) await patch(`/api/admin/dogs/${dog.id}`, d); else await post(`/api/admin/customers/${id}/dogs`, d);
    toast("Scheda salvata"); setDog(null); qc.invalidateQueries({ queryKey: ["customer", id] });
  };
  const adjust = async () => {
    try { await post("/api/admin/loyalty/adjust", { customerId: id, points: Number(pts.points), reason: pts.reason }); toast("Punti aggiornati"); setPts({ points: "", reason: "" }); qc.invalidateQueries({ queryKey: ["customer", id] }); }
    catch (e: any) { toast(e.message, "err"); }
  };
  const wa = c.phone ? `https://wa.me/${c.phone.replace(/\D/g, "").replace(/^(?!39)/, "39")}` : null;
  return (
    <div>
      <PageTitle title={`${c.firstName} ${c.lastName}`} subtitle={`Cliente dal ${fmtDate(c.createdAt)} · Fidelity ${data.loyalty.card.code} · ${data.loyalty.card.points} punti`}>
        {c.phone && <a href={`tel:${c.phone}`} className="btn-outline btn-sm"><Phone size={14} /> Chiama</a>}
        {wa && <a href={wa} target="_blank" rel="noreferrer" className="btn-outline btn-sm"><MessageCircle size={14} /> WhatsApp</a>}
        <a href={`mailto:${c.email}`} className="btn-outline btn-sm"><Mail size={14} /> Email</a>
        <button className="btn-primary btn-sm" onClick={() => setEdit(true)}><Pencil size={14} /> Modifica</button>
      </PageTitle>
      <div className="mb-4 grid gap-3 text-sm sm:grid-cols-3">
        <div className="card"><p className="label">Contatti</p>{c.email}<br />{c.phone || "—"}</div>
        <div className="card"><p className="label">Indirizzo</p>{[c.address, c.cap, c.city, c.province].filter(Boolean).join(", ") || "—"}</div>
        <div className="card"><p className="label">Privacy</p>Privacy {c.consentPrivacy ? "✓" : "✗"} · Marketing {c.consentMarketing ? "✓" : "✗"}{c.birthDate && <><br />Nato/a il {fmtDay(c.birthDate)}</>}</div>
      </div>
      <div className="mb-4 grid gap-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
        {[["Visite", data.kpi.visits], ["Ultima visita", data.kpi.lastVisit ? fmtDate(data.kpi.lastVisit) : "—"], ["Frequenza", data.kpi.frequencyDays ? `ogni ${data.kpi.frequencyDays} gg` : "—"],
          ["Spesa servizi", euro(data.kpi.spentServicesCents)], ["Spesa shop", euro(data.kpi.spentShopCents)], ["Annullati / assenze", `${data.kpi.cancellations} / ${data.kpi.noShows}`]].map(([l, v]) => (
          <div key={l as string} className="card py-3"><p className="label">{l}</p><p className="font-bold text-brand-navy">{v}</p></div>))}
      </div>
      {data.upcoming.length > 0 && <div className="mb-4 rounded-xl bg-brand-sky p-3 text-sm"><b>Prossimi appuntamenti:</b> {data.upcoming.map((a: any) => `${fmtDateTime(a.startAt)} – ${a.serviceName}`).join(" · ")}</div>}
      {c.notes && <p className="mb-4 rounded-xl bg-amber-50 p-3 text-sm"><b>Note interne:</b> {c.notes}</p>}
      <Tabs value={tab} onChange={setTab} items={[{ value: "cani", label: `Cani (${data.dogs.length})` }, { value: "app", label: `Appuntamenti (${data.appointments.length})` }, { value: "pag", label: "Pagamenti" }, { value: "fid", label: "Fidelity" }, { value: "altro", label: "Pensione e ordini" }, { value: "com", label: "Comunicazioni" }, { value: "priv", label: "Privacy" }]} />
      {tab === "cani" && (
        <div>
          <button className="btn-primary btn-sm mb-3" onClick={() => setDog({})}><Plus size={14} /> Aggiungi cane</button>
          <div className="grid gap-3 md:grid-cols-2">{data.dogs.map((d: any) => (
            <div key={d.id} className={`card ${d.archived ? "opacity-60" : ""}`}>
              {d.photoUrl && <img src={`/api/admin/dogs/${d.id}/photo`} alt={`Foto di ${d.name}`} className="mb-3 h-28 w-28 rounded-xl object-contain" />}
              <div className="flex justify-between"><div><h3 className="text-lg font-bold">{d.name}{d.archived && " (archiviato)"}</h3><p className="text-sm text-slate-600">{d.breed || "—"} · {SIZE_LABELS[d.size]} {d.weightKg ? `· ${d.weightKg} kg` : ""} {d.birthDate ? `· ${ageOf(d.birthDate)}` : ""}</p></div>
                <button className="btn-ghost btn-sm" onClick={() => setDog(d)}><Pencil size={14} /></button></div>
              <div className="mt-2 flex flex-wrap gap-1">{d.recallDays && <span className="badge bg-sky-100 text-sky-800">Richiamo ogni {d.recallDays} gg</span>}{d.aggressive && <span className="badge bg-red-100 text-red-700">Aggressivo</span>}</div>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 text-xs text-slate-600">
                {[["Pelo", d.coatType], ["Ultimo bagno", d.lastBath && fmtDay(d.lastBath)], ["Articolazioni", d.jointIssues], ["Dermatiti", d.dermatitis], ["Intolleranze", d.intolerances], ["Sensibilità", d.sensitivities], ["Altri animali", d.otherPets], ["Note", d.notes]].filter(([, v]) => v).map(([k, v]) => <div key={k as string}><dt className="font-bold">{k}</dt><dd>{v}</dd></div>)}
                {Object.entries(d.customFields || {}).map(([k, v]) => <div key={k}><dt className="font-bold">{k}</dt><dd>{String(v)}</dd></div>)}
              </dl>
            </div>
          ))}</div>
        </div>
      )}
      {tab === "app" && (
        <div className="overflow-x-auto rounded-2xl border bg-white"><table className="table-dp"><thead><tr><th>Data</th><th>Servizio</th><th>Operatore</th><th>Prezzo</th><th>Stato</th></tr></thead>
          <tbody>{data.appointments.map((a: any) => <tr key={a.id}><td>{fmtDateTime(a.startAt)}</td><td>{a.serviceName}</td><td>{a.operatorName || "—"}</td><td>{euro(a.finalPriceCents ?? a.estimatedPriceCents)}</td><td><StatusBadge status={a.status} /></td></tr>)}</tbody></table></div>
      )}
      {tab === "pag" && (
        <div className="overflow-x-auto rounded-2xl border bg-white"><table className="table-dp"><thead><tr><th>Data</th><th>Tipo</th><th>Metodo</th><th>Importo</th><th>Stato</th></tr></thead>
          <tbody>{data.payments.map((p: any) => <tr key={p.id}><td>{fmtDate(p.paidAt ?? p.createdAt)}</td><td>{PAYMENT_KINDS[p.kind]}</td><td>{p.methodLabel || PAYMENT_METHODS[p.method]}</td><td>{euro(p.amountCents)}</td><td>{p.status}</td></tr>)}</tbody></table></div>
      )}
      {tab === "fid" && (
        <div className="space-y-3">
          <div className="card flex flex-wrap items-end gap-2">
            <Field label="Punti (+/-)"><input type="number" className="input w-32" value={pts.points} onChange={(e) => setPts({ ...pts, points: e.target.value })} /></Field>
            <Field label="Motivo" className="flex-1"><input className="input" value={pts.reason} onChange={(e) => setPts({ ...pts, reason: e.target.value })} placeholder="Es. premio riscattato, bonus compleanno" /></Field>
            <button className="btn-primary" disabled={!pts.points || !pts.reason} onClick={adjust}>Applica</button>
          </div>
          {data.loyalty.expiries.length > 0 && <p className="text-sm">Scadenze: {data.loyalty.expiries.map((e: any) => `${e.points} pt il ${fmtDate(e.expiresAt)}`).join(" · ")}</p>}
          <table className="table-dp rounded-2xl bg-white"><tbody>{data.loyalty.transactions.map((t: any) => <tr key={t.id}><td>{fmtDate(t.createdAt)}</td><td><span className="badge mr-1 bg-slate-100">{LOYALTY_KINDS[t.kind]}</span>{t.reason}</td><td className="text-right font-bold">{t.points > 0 ? "+" : ""}{t.points}</td></tr>)}</tbody></table>
          <p className="text-xs text-slate-500">Utilizzi, premi, proroghe e sconti sui servizi: sezione <Link href="/admin/fidelity" className="underline">Fidelity Card</Link>.</p>
        </div>
      )}
      {tab === "com" && (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="card"><h3 className="mb-2 font-bold">Email</h3>{data.communications.emails.length ? <ul className="space-y-1 text-sm">{data.communications.emails.map((e: any) => <li key={e.id}>{fmtDateTime(e.createdAt)} · {e.subject} <span className="text-xs text-slate-500">({e.status})</span></li>)}</ul> : <p className="text-sm text-slate-500">Nessuna</p>}</div>
          <div className="card"><h3 className="mb-2 font-bold">Notifiche</h3>{data.communications.notifications.length ? <ul className="space-y-1 text-sm">{data.communications.notifications.map((n: any) => <li key={n.id}>{fmtDateTime(n.createdAt)} · {n.title}</li>)}</ul> : <p className="text-sm text-slate-500">Nessuna</p>}</div>
        </div>
      )}
      {tab === "priv" && (
        <div className="card"><h3 className="mb-2 font-bold">Storico autorizzazioni</h3>
          {data.consents.length ? <table className="table-dp"><thead><tr><th>Data</th><th>Tipo</th><th>Esito</th><th>Fonte</th><th>Versione</th><th>Prova</th></tr></thead>
            <tbody>{data.consents.map((x: any) => <tr key={x.id}><td>{fmtDateTime(x.createdAt)}</td><td>{x.kind}</td><td>{x.granted ? "Concesso" : "Negato / revocato"}</td><td>{x.source}</td><td>{x.policyVersion || "—"}</td><td className="text-xs">{x.proof || "—"}</td></tr>)}</tbody></table> : <p className="text-sm text-slate-500">Nessuna registrazione.</p>}</div>
      )}
      {tab === "altro" && (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="card"><h3 className="mb-2 font-bold">Pensione</h3>{data.boarding.length ? data.boarding.map((b: any) => <p key={b.id} className="text-sm">{fmtDay(b.startDate)} → {fmtDay(b.endDate)} · {BOARDING_STATUS[b.status]}</p>) : <p className="text-sm text-slate-500">Nessuna</p>}</div>
          <div className="card"><h3 className="mb-2 font-bold">Ordini</h3>{data.orders.length ? data.orders.map((o: any) => <p key={o.id} className="text-sm">#{o.id} · {fmtDate(o.createdAt)} · {euro(o.totalCents)} · {ORDER_STATUS[o.status]}</p>) : <p className="text-sm text-slate-500">Nessuno</p>}</div>
        </div>
      )}
      <Modal open={edit} onClose={() => setEdit(false)} title="Modifica cliente" wide><CustomerForm initial={c} onDone={() => setEdit(false)} /></Modal>
      <Modal open={!!dog} onClose={() => setDog(null)} title={dog?.id ? `Scheda di ${dog.name}` : "Nuovo cane"} wide>
        {dog && <DogForm initial={dog.id ? dog : undefined} onSubmit={saveDog} onCancel={() => setDog(null)} adminExtras />}
        {dog?.id && <button className="btn-ghost btn-sm mt-2 text-slate-500" onClick={() => saveDog({ archived: !dog.archived })}>{dog.archived ? "Ripristina" : "Archivia"} scheda</button>}
      </Modal>
    </div>
  );
}

function DogFields() {
  return (
    <ResourceManager title="Campi personalizzati scheda cane" subtitle="Aggiungi informazioni alla scheda cane senza modificare il codice" endpoint="/api/admin/dog-fields"
      defaults={{ fieldType: "text", section: "altro", options: [], required: false, active: true, sortOrder: 0 }}
      fields={[
        { name: "label", label: "Etichetta", required: true },
        { name: "fieldKey", label: "Codice interno", required: true, hint: "minuscole, numeri e _ (es. microchip)" },
        { name: "fieldType", label: "Tipo", type: "select", required: true, options: [{ value: "text", label: "Testo" }, { value: "number", label: "Numero" }, { value: "date", label: "Data" }, { value: "select", label: "Selezione" }, { value: "checkbox", label: "Casella sì/no" }] },
        { name: "section", label: "Sezione", type: "select", required: true, options: [{ value: "principali", label: "Dati principali" }, { value: "pelo", label: "Stato del pelo" }, { value: "benessere", label: "Benessere" }, { value: "alimentazione", label: "Alimentazione" }, { value: "altro", label: "Altre informazioni" }] },
        { name: "options", label: "Opzioni (solo per Selezione)", type: "tags", full: true },
        { name: "sortOrder", label: "Ordine", type: "number" },
        { name: "required", label: "Obbligatorio", type: "checkbox" },
        { name: "active", label: "Attivo", type: "checkbox" },
      ]}
      columns={[{ key: "label", label: "Campo" }, { key: "fieldType", label: "Tipo" }, { key: "section", label: "Sezione" }, { key: "active", label: "Attivo", render: (r) => (r.active ? "✓" : "—") }]}
    />
  );
}

/** Schede cani: ricerca dei cani e storico dei trattamenti con filtri ed esportazione (punto 15). */
export function DogsPage() {
  const [tab, setTab] = useState("cani");
  const [q, setQ] = useState("");
  const { data: me } = useMe();
  const { data: dogs, isLoading } = useQuery<any[]>({ queryKey: ["dog-search", q], queryFn: () => get(`/api/admin/dogs?q=${encodeURIComponent(q)}`) });
  const [f, setF] = useState<Record<string, string>>({});
  const { data: svc } = useQuery<any[]>({ queryKey: ["admin-services"], queryFn: () => get("/api/admin/services").catch(() => []) });
  const { data: ops } = useQuery<any[]>({ queryKey: ["admin-operators"], queryFn: () => get("/api/admin/operators").catch(() => []) });
  const qs = Object.entries(f).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
  const { data: tr, isLoading: lt } = useQuery<any[]>({ queryKey: ["treatments", qs], queryFn: () => get(`/api/admin/treatments?${qs}`), enabled: tab === "storico" });
  return (
    <div>
      <PageTitle title="Schede cani" subtitle="Anagrafiche dei cani e storico dei trattamenti" />
      <Tabs value={tab} onChange={setTab} items={[{ value: "cani", label: "Cani" }, { value: "storico", label: "Storico trattamenti" }, ...(can(me ?? null, "impostazioni") ? [{ value: "campi", label: "Campi personalizzati" }] : [])]} />
      {tab === "campi" && <DogFields />}
      {tab === "cani" && <>
        <div className="relative mb-3 max-w-md"><Search size={16} className="absolute left-3 top-2.5 text-slate-400" /><input className="input pl-9" placeholder="Nome o razza" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        {isLoading ? <Spinner /> : !dogs?.length ? <Empty>Nessun cane trovato.</Empty> : (
          <div className="overflow-x-auto rounded-2xl border bg-white"><table className="table-dp"><thead><tr><th>Cane</th><th>Razza</th><th>Taglia</th><th>Proprietario</th><th>Note</th><th /></tr></thead>
            <tbody>{dogs.map((d) => <tr key={d.id}><td className="font-bold">{d.name}{d.aggressive && " ⚠"}</td><td>{d.breed || "—"}</td><td>{SIZE_LABELS[d.size]}</td><td><Link href={`/admin/clienti/${d.ownerId}`} className="text-brand-blue underline">{d.owner}</Link></td>
              <td className="text-xs">{d.recallDays ? `richiamo ${d.recallDays} gg` : "—"}</td>
              <td><button className="btn-outline btn-sm" onClick={() => { setF({ dogId: String(d.id) }); setTab("storico"); }}>Storico</button></td></tr>)}</tbody></table></div>
        )}
      </>}
      {tab === "storico" && <>
        <div className="mb-3 flex flex-wrap gap-2">
          <input className="input w-48" placeholder="Cane, cliente o note" value={f.q || ""} onChange={(e) => setF({ ...f, q: e.target.value, dogId: "" })} />
          <select className="input w-48" value={f.serviceId || ""} onChange={(e) => setF({ ...f, serviceId: e.target.value })}><option value="">Tutti i servizi</option>{svc?.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
          <select className="input w-40" value={f.operatorId || ""} onChange={(e) => setF({ ...f, operatorId: e.target.value })}><option value="">Tutti gli operatori</option>{ops?.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
          <input type="date" className="input w-40" value={f.from || ""} onChange={(e) => setF({ ...f, from: e.target.value })} aria-label="Dal" />
          <input type="date" className="input w-40" value={f.to || ""} onChange={(e) => setF({ ...f, to: e.target.value })} aria-label="Al" />
          {f.dogId && <button className="btn-ghost btn-sm" onClick={() => setF({ ...f, dogId: "" })}>Rimuovi filtro cane</button>}
          <a className="btn-outline btn-sm" href={`/api/admin/treatments?${qs}&format=xlsx`}><Download size={14} /> Excel</a>
          <a className="btn-outline btn-sm" href={`/api/admin/treatments?${qs}&format=pdf`}><Download size={14} /> PDF</a>
        </div>
        {lt ? <Spinner /> : !tr?.length ? <Empty>Nessun trattamento trovato.</Empty> : (
          <div className="overflow-x-auto rounded-2xl border bg-white"><table className="table-dp"><thead><tr><th>Data</th><th>Cane</th><th>Cliente</th><th>Servizio</th><th>Operatore</th><th>Durata</th><th>Prezzo</th><th>Pagamento</th><th>Note</th></tr></thead>
            <tbody>{tr.map((t) => <tr key={t.id}><td className="whitespace-nowrap">{fmtDateTime(t.startAt)}</td><td>{t.dogName}</td><td>{t.customerName}</td><td>{t.serviceName}</td><td>{t.operatorName || "—"}</td><td>{t.durationMin}′</td>
              <td>{euro(t.finalPriceCents ?? t.estimatedPriceCents)}</td><td>{euro(t.paidCents)}{t.payMethods && <span className="block text-xs text-slate-500">{t.payMethods}</span>}</td><td className="max-w-xs text-xs">{t.treatmentNotes || ""}</td></tr>)}</tbody></table></div>
        )}
      </>}
    </div>
  );
}
