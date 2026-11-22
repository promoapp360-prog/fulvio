import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Search, Download, Pencil, Phone, MessageCircle, Mail } from "lucide-react";
import { PageTitle, Spinner, Empty, Pager, Modal, Field, Check, ErrorBox, Tabs, StatusBadge, MoneyInput, useToast } from "@/components/ui";
import DogForm, { ageOf } from "@/components/DogForm";
import ResourceManager from "@/components/ResourceManager";
import { get, post, patch } from "@/lib/api";
import { fmtDate, fmtDateTime, fmtDay } from "@/lib/format";
import { euro, SIZE_LABELS, PAYMENT_KINDS, PAYMENT_METHODS, ORDER_STATUS, BOARDING_STATUS } from "@shared/constants";

const emptyCustomer = { firstName: "", lastName: "", email: "", phone: "", address: "", city: "", province: "", cap: "", country: "Italia", birthDate: "", notes: "", consentPrivacy: true, consentMarketing: false, commEmail: true, commWhatsapp: false, active: true, sendInvite: false };

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
      <ErrorBox error={err} />
      <button className="btn-primary">Salva</button>
    </form>
  );
}

export function Customers() {
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const { data, isLoading } = useQuery<any>({ queryKey: ["customers", page, q], queryFn: () => get(`/api/admin/customers?page=${page}&q=${encodeURIComponent(q)}`) });
  return (
    <div>
      <PageTitle title="Clienti e cani" subtitle={data ? `${data.total} clienti` : undefined}>
        <a href="/api/admin/customers/export.csv" className="btn-outline btn-sm"><Download size={14} /> Esporta CSV</a>
        <button className="btn-primary btn-sm" onClick={() => setCreating(true)}><Plus size={14} /> Nuovo cliente</button>
      </PageTitle>
      <div className="relative mb-3 max-w-md"><Search size={16} className="absolute left-3 top-2.5 text-slate-400" /><input className="input pl-9" placeholder="Nome, telefono, email o nome del cane" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></div>
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
      <Modal open={creating} onClose={() => setCreating(false)} title="Nuovo cliente" wide><CustomerForm initial={{}} onDone={() => setCreating(false)} /></Modal>
    </div>
  );
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
      {c.notes && <p className="mb-4 rounded-xl bg-amber-50 p-3 text-sm">{c.notes}</p>}
      <Tabs value={tab} onChange={setTab} items={[{ value: "cani", label: `Cani (${data.dogs.length})` }, { value: "app", label: `Appuntamenti (${data.appointments.length})` }, { value: "pag", label: "Pagamenti" }, { value: "fid", label: "Fidelity" }, { value: "altro", label: "Pensione e ordini" }]} />
      {tab === "cani" && (
        <div>
          <button className="btn-primary btn-sm mb-3" onClick={() => setDog({})}><Plus size={14} /> Aggiungi cane</button>
          <div className="grid gap-3 md:grid-cols-2">{data.dogs.map((d: any) => (
            <div key={d.id} className={`card ${d.archived ? "opacity-60" : ""}`}>
              <div className="flex justify-between"><div><h3 className="text-lg font-bold">{d.name}{d.archived && " (archiviato)"}</h3><p className="text-sm text-slate-600">{d.breed || "—"} · {SIZE_LABELS[d.size]} {d.weightKg ? `· ${d.weightKg} kg` : ""} {d.birthDate ? `· ${ageOf(d.birthDate)}` : ""}</p></div>
                <button className="btn-ghost btn-sm" onClick={() => setDog(d)}><Pencil size={14} /></button></div>
              <div className="mt-2 flex flex-wrap gap-1">{d.coatKnots && <span className="badge bg-amber-100 text-amber-800">Nodi</span>}{d.coatShedding && <span className="badge bg-amber-100 text-amber-800">Muta</span>}{d.aggressive && <span className="badge bg-red-100 text-red-700">Aggressivo</span>}</div>
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
          <table className="table-dp rounded-2xl bg-white"><tbody>{data.loyalty.transactions.map((t: any) => <tr key={t.id}><td>{fmtDate(t.createdAt)}</td><td>{t.reason}</td><td className="text-right font-bold">{t.points > 0 ? "+" : ""}{t.points}</td></tr>)}</tbody></table>
        </div>
      )}
      {tab === "altro" && (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="card"><h3 className="mb-2 font-bold">Pensione</h3>{data.boarding.length ? data.boarding.map((b: any) => <p key={b.id} className="text-sm">{fmtDay(b.startDate)} → {fmtDay(b.endDate)} · {BOARDING_STATUS[b.status]}</p>) : <p className="text-sm text-slate-500">Nessuna</p>}</div>
          <div className="card"><h3 className="mb-2 font-bold">Ordini</h3>{data.orders.length ? data.orders.map((o: any) => <p key={o.id} className="text-sm">#{o.id} · {fmtDate(o.createdAt)} · {euro(o.totalCents)} · {ORDER_STATUS[o.status]}</p>) : <p className="text-sm text-slate-500">Nessuno</p>}</div>
        </div>
      )}
      <Modal open={edit} onClose={() => setEdit(false)} title="Modifica cliente" wide><CustomerForm initial={c} onDone={() => setEdit(false)} /></Modal>
      <Modal open={!!dog} onClose={() => setDog(null)} title={dog?.id ? `Scheda di ${dog.name}` : "Nuovo cane"} wide>
        {dog && <DogForm initial={dog.id ? dog : undefined} onSubmit={saveDog} onCancel={() => setDog(null)} fieldsUrl="/api/admin/dog-fields?pageSize=100" />}
        {dog?.id && <button className="btn-ghost btn-sm mt-2 text-slate-500" onClick={() => saveDog({ archived: !dog.archived })}>{dog.archived ? "Ripristina" : "Archivia"} scheda</button>}
      </Modal>
    </div>
  );
}

export function DogFields() {
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
