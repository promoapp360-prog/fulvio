import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { PageTitle, Spinner, Empty, Field, ErrorBox, Tabs, Modal, MoneyInput, useToast } from "@/components/ui";
import ResourceManager from "@/components/ResourceManager";
import { get, post, patch } from "@/lib/api";
import { fmtDateTime, fmtDay, fmtDate } from "@/lib/format";
import { euro, ORDER_STATUS, BOARDING_STATUS, SIZE_LABELS } from "@shared/constants";
import { UploadButton } from "./Content";

export function Products() {
  const { data: sup } = useQuery<any>({ queryKey: ["suppliers-all"], queryFn: () => get("/api/admin/suppliers?pageSize=100").catch(() => ({ rows: [] })) });
  return (
    <ResourceManager title="Prodotti" subtitle="Catalogo per lo shop e il magazzino (gli alimenti sono già predisposti)" endpoint="/api/admin/products" searchable
      toolbar={<UploadButton label="Carica foto prodotto" />}
      defaults={{ category: "Accessori", priceCents: 0, vatRate: 22, minStock: 0, isFood: false, visibleOnline: true, active: true }}
      fields={[
        { name: "name", label: "Nome", required: true }, { name: "category", label: "Categoria", required: true },
        { name: "priceCents", label: "Prezzo di vendita", type: "money", required: true }, { name: "salePriceCents", label: "Prezzo scontato", type: "money" },
        { name: "costCents", label: "Costo d'acquisto", type: "money" }, { name: "vatRate", label: "IVA %", type: "number" },
        { name: "sku", label: "Codice (SKU)", nullable: true }, { name: "barcode", label: "Codice a barre", nullable: true },
        { name: "minStock", label: "Scorta minima", type: "number" },
        { name: "supplierId", label: "Fornitore", type: "select", numeric: true, options: (sup?.rows || []).map((s: any) => ({ value: s.id, label: s.name })) },
        { name: "imageUrl", label: "URL immagine", nullable: true, full: true, hint: "Carica la foto con il pulsante in alto e incolla qui l'indirizzo" },
        { name: "description", label: "Descrizione", type: "textarea", nullable: true },
        { name: "isFood", label: "Alimento", type: "checkbox" }, { name: "visibleOnline", label: "Visibile nello shop", type: "checkbox" }, { name: "active", label: "Attivo", type: "checkbox" },
      ]}
      transform={(b) => ({ ...b, priceCents: b.priceCents ?? 0 })}
      columns={[
        { key: "name", label: "Prodotto", render: (r) => <><b>{r.name}</b><span className="block text-xs text-slate-500">{r.category}{r.sku ? ` · ${r.sku}` : ""}</span></> },
        { key: "priceCents", label: "Prezzo", render: (r) => euro(r.salePriceCents ?? r.priceCents) },
        { key: "stock", label: "Giacenza", render: (r) => <span className={r.stock <= r.minStock ? "font-bold text-red-600" : ""}>{r.stock}</span> },
        { key: "visibleOnline", label: "Online", render: (r) => (r.visibleOnline && r.active ? "✓" : "—") },
      ]}
    />
  );
}

export function Stock() {
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState("movimenti");
  const { data: low } = useQuery<any[]>({ queryKey: ["stock-low"], queryFn: () => get("/api/admin/stock/low") });
  const { data: moves, isLoading } = useQuery<any[]>({ queryKey: ["stock-moves"], queryFn: () => get("/api/admin/stock/movements") });
  const [q, setQ] = useState("");
  const { data: prods } = useQuery<any>({ queryKey: ["stock-prod-search", q], queryFn: () => get(`/api/admin/products?q=${encodeURIComponent(q)}&pageSize=20`).catch(() => ({ rows: [] })), enabled: q.length >= 2 });
  const [f, setF] = useState<any>({ productId: null, productName: "", qty: "", kind: "carico", reference: "", note: "" });
  const [err, setErr] = useState<unknown>(null);
  const submit = async () => {
    setErr(null);
    try { await post("/api/admin/stock", { productId: f.productId, qty: Number(f.qty), kind: f.kind, reference: f.reference || null, note: f.note || null }); toast("Movimento registrato"); setF({ productId: null, productName: "", qty: "", kind: "carico", reference: "", note: "" }); setQ(""); qc.invalidateQueries({ queryKey: ["stock-moves"] }); qc.invalidateQueries({ queryKey: ["stock-low"] }); qc.invalidateQueries({ queryKey: ["/api/admin/products"] }); }
    catch (e) { setErr(e); }
  };
  return (
    <div>
      <PageTitle title="Magazzino" subtitle="Carichi, scarichi, rettifiche e scorte minime"><a href="/api/admin/stock/export.csv" className="btn-outline btn-sm"><Download size={14} /> Inventario CSV</a></PageTitle>
      <div className="card mb-5">
        <h2 className="mb-3 font-bold">Nuovo movimento</h2>
        <div className="grid gap-3 sm:grid-cols-5">
          <Field label="Prodotto" className="sm:col-span-2">
            {f.productId ? <p className="py-2 text-sm font-bold">{f.productName} <button className="ml-2 text-brand-blue underline" onClick={() => setF({ ...f, productId: null })}>cambia</button></p> : <>
              <input className="input" placeholder="Cerca nome o codice" value={q} onChange={(e) => setQ(e.target.value)} />
              {prods?.rows?.length > 0 && <div className="mt-1 max-h-40 overflow-y-auto rounded-xl border">{prods.rows.map((p: any) => <button key={p.id} className="block w-full px-3 py-1.5 text-left text-sm hover:bg-brand-sky" onClick={() => setF({ ...f, productId: p.id, productName: p.name })}>{p.name} <span className="text-xs text-slate-500">(giacenza {p.stock})</span></button>)}</div>}</>}
          </Field>
          <Field label="Tipo"><select className="input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="carico">Carico</option><option value="scarico">Scarico</option><option value="reso">Reso</option><option value="rettifica">Rettifica (+/-)</option></select></Field>
          <Field label="Quantità"><input type="number" className="input" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} /></Field>
          <Field label="Riferimento (DDT, fattura…)"><input className="input" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
        </div>
        <ErrorBox error={err} />
        <button className="btn-primary mt-3" disabled={!f.productId || !f.qty} onClick={submit}>Registra</button>
      </div>
      <Tabs value={tab} onChange={setTab} items={[{ value: "movimenti", label: "Ultimi movimenti" }, { value: "scorte", label: `Sotto scorta (${low?.length ?? 0})` }]} />
      {tab === "scorte" ? (!low?.length ? <Empty>Nessun prodotto sotto la scorta minima.</Empty> : (
        <table className="table-dp rounded-2xl bg-white"><thead><tr><th>Prodotto</th><th>Giacenza</th><th>Scorta minima</th></tr></thead><tbody>{low.map((p) => <tr key={p.id}><td>{p.name}</td><td className="font-bold text-red-600">{p.stock}</td><td>{p.minStock}</td></tr>)}</tbody></table>
      )) : isLoading ? <Spinner /> : !moves?.length ? <Empty>Nessun movimento.</Empty> : (
        <div className="overflow-x-auto rounded-2xl border bg-white"><table className="table-dp"><thead><tr><th>Data</th><th>Prodotto</th><th>Tipo</th><th>Qtà</th><th>Riferimento</th></tr></thead>
          <tbody>{moves.map((m) => <tr key={m.id}><td>{fmtDateTime(m.createdAt)}</td><td>{m.product}</td><td>{m.kind}</td><td className={m.qty < 0 ? "text-red-600" : "text-green-700"}>{m.qty > 0 ? "+" : ""}{m.qty}</td><td>{m.reference}</td></tr>)}</tbody></table></div>
      )}
    </div>
  );
}

export function Suppliers() {
  return (
    <ResourceManager title="Fornitori" endpoint="/api/admin/suppliers" searchable defaults={{ active: true }}
      fields={[
        { name: "name", label: "Ragione sociale", required: true }, { name: "contact", label: "Referente", nullable: true }, { name: "email", label: "Email", type: "email", nullable: true },
        { name: "phone", label: "Telefono", nullable: true }, { name: "vatNumber", label: "Partita IVA", nullable: true }, { name: "address", label: "Indirizzo", nullable: true },
        { name: "notes", label: "Note", type: "textarea", nullable: true }, { name: "active", label: "Attivo", type: "checkbox" },
      ]}
      columns={[{ key: "name", label: "Fornitore" }, { key: "contact", label: "Referente" }, { key: "phone", label: "Telefono" }, { key: "email", label: "Email" }]}
    />
  );
}

export function Orders() {
  const qc = useQueryClient();
  const toast = useToast();
  const [status, setStatus] = useState("");
  const { data, isLoading } = useQuery<any[]>({ queryKey: ["admin-orders", status], queryFn: () => get(`/api/admin/orders${status ? `?status=${status}` : ""}`) });
  const setSt = async (id: number, s: string) => { try { await patch(`/api/admin/orders/${id}`, { status: s }); toast("Stato aggiornato"); qc.invalidateQueries({ queryKey: ["admin-orders"] }); } catch (e: any) { toast(e.message, "err"); } };
  return (
    <div>
      <PageTitle title="Ordini shop" subtitle="Il magazzino viene scaricato automaticamente quando l'ordine è pagato o preso in carico" />
      <select className="input mb-4 w-56" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Tutti</option>{Object.entries(ORDER_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      {isLoading ? <Spinner /> : !data?.length ? <Empty>Nessun ordine.</Empty> : (
        <div className="space-y-3">{data.map((o) => (
          <div key={o.id} className="card">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><p className="font-bold">Ordine #{o.id} · {fmtDateTime(o.createdAt)}</p><p className="text-sm text-slate-600">{o.customer} · {o.phone} · {o.email}</p></div>
              <select className="input w-48" value={o.status} onChange={(e) => setSt(o.id, e.target.value)}>{Object.entries(ORDER_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            </div>
            <ul className="mt-2 text-sm">{o.items.map((i: any) => <li key={i.id}>{i.qty} × {i.name} – {euro(i.unitPriceCents * i.qty)}</li>)}</ul>
            <p className="mt-1 text-sm">{o.delivery === "ritiro" ? "Ritiro in negozio" : "Consegna"}{o.promoCode && ` · codice ${o.promoCode} (−${euro(o.discountCents)})`}{o.notes && ` · ${o.notes}`}</p>
            <p className="text-right text-lg font-bold">{euro(o.totalCents)}</p>
          </div>
        ))}</div>
      )}
    </div>
  );
}

export function Boarding() {
  const qc = useQueryClient();
  const toast = useToast();
  const [status, setStatus] = useState("");
  const { data, isLoading } = useQuery<any[]>({ queryKey: ["admin-boarding", status], queryFn: () => get(`/api/admin/boarding${status ? `?status=${status}` : ""}`) });
  const [edit, setEdit] = useState<any>(null);
  const [err, setErr] = useState<unknown>(null);
  const save = async () => {
    setErr(null);
    try { await patch(`/api/admin/boarding/${edit.id}`, { status: edit.status, priceCents: edit.priceCents, adminNotes: edit.adminNotes || null, startDate: edit.startDate, endDate: edit.endDate }); toast("Richiesta aggiornata"); setEdit(null); qc.invalidateQueries({ queryKey: ["admin-boarding"] }); qc.invalidateQueries({ queryKey: ["dashboard"] }); }
    catch (e) { setErr(e); }
  };
  return (
    <div>
      <PageTitle title="Pensione casalinga" subtitle="Richieste dei clienti, da confermare manualmente" />
      <select className="input mb-4 w-56" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Tutte</option>{Object.entries(BOARDING_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      {isLoading ? <Spinner /> : !data?.length ? <Empty>Nessuna richiesta.</Empty> : (
        <div className="overflow-x-auto rounded-2xl border bg-white"><table className="table-dp"><thead><tr><th>Periodo</th><th>Cane</th><th>Cliente</th><th>Prezzo</th><th>Stato</th><th /></tr></thead>
          <tbody>{data.map((b) => <tr key={b.id}><td className="font-bold">{fmtDay(b.startDate)} → {fmtDay(b.endDate)}</td><td>{b.dogName} ({SIZE_LABELS[b.dogSize]})</td><td>{b.customer}<br /><span className="text-xs">{b.phone}</span></td><td>{euro(b.priceCents)}</td><td>{BOARDING_STATUS[b.status]}</td>
            <td><button className="btn-outline btn-sm" onClick={() => { setErr(null); setEdit({ ...b }); }}>Gestisci</button></td></tr>)}</tbody></table></div>
      )}
      <Modal open={!!edit} onClose={() => setEdit(null)} title="Richiesta pensione">
        {edit && <div className="space-y-3">
          {edit.customerNotes && <p className="rounded-xl bg-brand-sky p-3 text-sm"><b>Note cliente:</b> {edit.customerNotes}</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Dal"><input type="date" className="input" value={edit.startDate} onChange={(e) => setEdit({ ...edit, startDate: e.target.value })} /></Field>
            <Field label="Al"><input type="date" className="input" value={edit.endDate} onChange={(e) => setEdit({ ...edit, endDate: e.target.value })} /></Field>
            <Field label="Stato"><select className="input" value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })}>{Object.entries(BOARDING_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
            <Field label="Prezzo"><MoneyInput value={edit.priceCents} onChange={(v) => setEdit({ ...edit, priceCents: v })} /></Field>
            <Field label="Note interne" className="sm:col-span-2"><textarea className="input" value={edit.adminNotes || ""} onChange={(e) => setEdit({ ...edit, adminNotes: e.target.value })} /></Field>
          </div>
          <p className="text-xs text-slate-500">Ricevuta il {fmtDate(edit.createdAt)}. Il cliente riceve una notifica alla conferma o al rifiuto.</p>
          <ErrorBox error={err} />
          <button className="btn-primary" onClick={save}>Salva</button>
        </div>}
      </Modal>
    </div>
  );
}
