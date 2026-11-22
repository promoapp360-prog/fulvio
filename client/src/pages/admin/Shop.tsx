import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Plus } from "lucide-react";
import { PageTitle, Spinner, Empty, Field, ErrorBox, Tabs, Modal, MoneyInput, useToast } from "@/components/ui";
import ResourceManager from "@/components/ResourceManager";
import { get, post, patch } from "@/lib/api";
import { fmtDateTime, fmtDay, fmtDate } from "@/lib/format";
import { euro, ORDER_STATUS, BOARDING_STATUS, SIZE_LABELS, PAYMENT_METHODS } from "@shared/constants";
import { UploadButton } from "./Content";

export function Products() {
  const [tab, setTab] = useState("prodotti");
  const [variantsOf, setVariantsOf] = useState<any>(null);
  const { data: sup } = useQuery<any>({ queryKey: ["suppliers-all"], queryFn: () => get("/api/admin/suppliers?pageSize=100").catch(() => ({ rows: [] })) });
  const { data: cats } = useQuery<any>({ queryKey: ["/api/admin/categories", "all"], queryFn: () => get("/api/admin/categories?pageSize=100") });
  const { data: ps } = useQuery<any>({ queryKey: ["public-settings"], queryFn: () => get("/api/public/settings") });
  return (
    <div>
      {!ps?.site?.shopEnabled && <p className="mb-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Lo shop on line è ancora <b>"In arrivo"</b> sul sito pubblico. Puoi preparare il catalogo e attivarlo da Contenuti sito → Home e sito.</p>}
      <Tabs value={tab} onChange={setTab} items={[{ value: "prodotti", label: "Prodotti" }, { value: "categorie", label: "Categorie" }]} />
      {tab === "categorie" ? (
        <ResourceManager title="Categorie" endpoint="/api/admin/categories" defaults={{ sortOrder: 0, active: true }}
          fields={[{ name: "name", label: "Nome", required: true }, { name: "sortOrder", label: "Ordine", type: "number" }, { name: "active", label: "Attiva", type: "checkbox" }]}
          columns={[{ key: "name", label: "Categoria" }, { key: "sortOrder", label: "Ordine" }, { key: "active", label: "Attiva", render: (r) => (r.active ? "✓" : "—") }]} />
      ) : (
        <ResourceManager title="Prodotti" subtitle="Catalogo condiviso da shop, magazzino, statistiche e Fidelity (alimenti e Private Label già predisposti)" endpoint="/api/admin/products" searchable
          toolbar={<UploadButton label="Carica foto prodotto" />}
          defaults={{ category: cats?.rows?.[0]?.name || "Accessori", priceCents: 0, vatRate: 22, minStock: 0, isFood: false, privateLabel: false, earnsPoints: true, visibleOnline: true, active: true }}
          fields={[
            { name: "name", label: "Nome", required: true }, { name: "category", label: "Categoria", type: cats?.rows?.length ? "select" : "text", required: true, options: (cats?.rows || []).map((c: any) => c.name) },
            { name: "priceCents", label: "Prezzo di vendita", type: "money", required: true }, { name: "salePriceCents", label: "Prezzo scontato", type: "money" },
            { name: "costCents", label: "Costo d'acquisto", type: "money" }, { name: "vatRate", label: "IVA %", type: "number" },
            { name: "sku", label: "Codice (SKU)", nullable: true }, { name: "barcode", label: "Codice a barre", nullable: true },
            { name: "minStock", label: "Scorta minima", type: "number" },
            { name: "supplierId", label: "Fornitore", type: "select", numeric: true, options: (sup?.rows || []).map((x: any) => ({ value: x.id, label: x.name })) },
            { name: "imageUrl", label: "URL immagine", nullable: true, full: true, hint: "Carica la foto con il pulsante in alto e incolla qui l'indirizzo" },
            { name: "description", label: "Descrizione", type: "textarea", nullable: true },
            { name: "isFood", label: "Alimento", type: "checkbox" }, { name: "privateLabel", label: "Private Label", type: "checkbox" }, { name: "earnsPoints", label: "Genera punti Fidelity", type: "checkbox" },
            { name: "visibleOnline", label: "Visibile nello shop", type: "checkbox" }, { name: "active", label: "Attivo", type: "checkbox" },
          ]}
          transform={(b) => ({ ...b, priceCents: b.priceCents ?? 0 })}
          columns={[
            { key: "name", label: "Prodotto", render: (r) => <><b>{r.name}</b><span className="block text-xs text-slate-500">{r.category}{r.sku ? ` · ${r.sku}` : ""}{r.isFood ? " · alimento" : ""}{r.privateLabel ? " · Private Label" : ""}</span></> },
            { key: "priceCents", label: "Prezzo", render: (r) => euro(r.salePriceCents ?? r.priceCents) },
            { key: "stock", label: "Giacenza", render: (r) => <span className={r.stock <= r.minStock ? "font-bold text-red-600" : ""}>{r.stock}</span> },
            { key: "visibleOnline", label: "Online", render: (r) => (r.visibleOnline && r.active ? "✓" : "—") },
            { key: "variants", label: "Varianti", render: (r) => <button className="btn-ghost btn-sm" onClick={() => setVariantsOf(r)}>Gestisci</button> },
          ]}
        />
      )}
      {variantsOf && <VariantsModal product={variantsOf} onClose={() => setVariantsOf(null)} />}
    </div>
  );
}

function VariantsModal({ product, onClose }: { product: any; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { data } = useQuery<any[]>({ queryKey: ["variants", product.id], queryFn: () => get(`/api/admin/products/${product.id}/variants`) });
  const [f, setF] = useState<any>({ name: "", sku: "", priceCents: null, minStock: 0 });
  const add = async () => { try { await post(`/api/admin/products/${product.id}/variants`, { ...f, sku: f.sku || null }); setF({ name: "", sku: "", priceCents: null, minStock: 0 }); qc.invalidateQueries({ queryKey: ["variants", product.id] }); } catch (e: any) { toast(e.message, "err"); } };
  const toggle = async (v: any) => { await patch(`/api/admin/variants/${v.id}`, { active: !v.active }); qc.invalidateQueries({ queryKey: ["variants", product.id] }); };
  return (
    <Modal open onClose={onClose} title={`Varianti – ${product.name}`} wide>
      <p className="mb-3 text-sm text-slate-600">Es. formati, taglie o gusti. Ogni variante ha prezzo (vuoto = prezzo del prodotto) e giacenza propri; le quantità si caricano dal Magazzino.</p>
      <table className="table-dp mb-4"><thead><tr><th>Variante</th><th>SKU</th><th>Prezzo</th><th>Giacenza</th><th>Attiva</th></tr></thead>
        <tbody>{data?.map((v) => <tr key={v.id}><td>{v.name}</td><td>{v.sku}</td><td>{v.priceCents != null ? euro(v.priceCents) : "—"}</td><td>{v.stock}</td><td><button className="btn-ghost btn-sm" onClick={() => toggle(v)}>{v.active ? "✓ disattiva" : "attiva"}</button></td></tr>)}</tbody></table>
      <div className="grid gap-2 sm:grid-cols-5 sm:items-end">
        <Field label="Nome" className="sm:col-span-2"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="SKU"><input className="input" value={f.sku} onChange={(e) => setF({ ...f, sku: e.target.value })} /></Field>
        <Field label="Prezzo"><MoneyInput value={f.priceCents} onChange={(v) => setF({ ...f, priceCents: v })} /></Field>
        <button className="btn-primary" disabled={!f.name} onClick={add}>Aggiungi</button>
      </div>
    </Modal>
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
  const [f, setF] = useState<any>({ productId: null, variantId: null, productName: "", qty: "", kind: "carico", reference: "", note: "" });
  const { data: vars } = useQuery<any[]>({ queryKey: ["variants", f.productId], queryFn: () => get(`/api/admin/products/${f.productId}/variants`), enabled: !!f.productId });
  const [err, setErr] = useState<unknown>(null);
  const submit = async () => {
    setErr(null);
    try { await post("/api/admin/stock", { productId: f.productId, variantId: f.variantId ? Number(f.variantId) : null, qty: Number(f.qty), kind: f.kind, reference: f.reference || null, note: f.note || null }); toast("Movimento registrato"); setF({ productId: null, variantId: null, productName: "", qty: "", kind: "carico", reference: "", note: "" }); setQ(""); qc.invalidateQueries({ queryKey: ["stock-moves"] }); qc.invalidateQueries({ queryKey: ["stock-low"] }); qc.invalidateQueries({ queryKey: ["/api/admin/products"] }); }
    catch (e) { setErr(e); }
  };
  return (
    <div>
      <PageTitle title="Magazzino" subtitle="Carichi, scarichi, rettifiche, inventario e scorte minime. Le vendite on line e al banco scaricano in automatico.">
        <a href="/api/admin/stock/inventory?format=xlsx" className="btn-outline btn-sm"><Download size={14} /> Inventario Excel</a>
        <a href="/api/admin/stock/inventory?format=pdf" className="btn-outline btn-sm"><Download size={14} /> PDF</a>
      </PageTitle>
      <div className="card mb-5">
        <h2 className="mb-3 font-bold">Nuovo movimento</h2>
        <div className="grid gap-3 sm:grid-cols-5">
          <Field label="Prodotto" className="sm:col-span-2">
            {f.productId ? <p className="py-2 text-sm font-bold">{f.productName} <button className="ml-2 text-brand-blue underline" onClick={() => setF({ ...f, productId: null })}>cambia</button></p> : <>
              <input className="input" placeholder="Cerca nome o codice" value={q} onChange={(e) => setQ(e.target.value)} />
              {prods?.rows?.length > 0 && <div className="mt-1 max-h-40 overflow-y-auto rounded-xl border">{prods.rows.map((p: any) => <button key={p.id} className="block w-full px-3 py-1.5 text-left text-sm hover:bg-brand-sky" onClick={() => setF({ ...f, productId: p.id, productName: p.name })}>{p.name} <span className="text-xs text-slate-500">(giacenza {p.stock})</span></button>)}</div>}</>}
          </Field>
          <Field label="Tipo"><select className="input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="carico">Carico</option><option value="scarico">Scarico</option><option value="reso">Reso</option><option value="rettifica">Rettifica (+/-)</option><option value="inventario">Inventario (giacenza contata)</option></select></Field>
          {vars && vars.length > 0 && <Field label="Variante"><select className="input" value={f.variantId || ""} onChange={(e) => setF({ ...f, variantId: e.target.value })}><option value="">—</option>{vars.map((v) => <option key={v.id} value={v.id}>{v.name} (giac. {v.stock})</option>)}</select></Field>}
          <Field label={f.kind === "inventario" ? "Giacenza reale" : "Quantità"}><input type="number" className="input" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} /></Field>
          <Field label="Riferimento (DDT, fattura…)"><input className="input" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
        </div>
        <ErrorBox error={err} />
        <button className="btn-primary mt-3" disabled={!f.productId || !f.qty} onClick={submit}>Registra</button>
      </div>
      <Tabs value={tab} onChange={setTab} items={[{ value: "movimenti", label: "Ultimi movimenti" }, { value: "scorte", label: `Sotto scorta (${low?.length ?? 0})` }]} />
      {tab === "scorte" ? (!low?.length ? <Empty>Nessun prodotto sotto la scorta minima.</Empty> : (
        <table className="table-dp rounded-2xl bg-white"><thead><tr><th>Prodotto</th><th>Giacenza</th><th>Scorta minima</th></tr></thead><tbody>{low.map((p: any) => <tr key={`${p.id}-${p.variantId || 0}`}><td>{p.name}</td><td className="font-bold text-red-600">{p.stock}</td><td>{p.minStock}</td></tr>)}</tbody></table>
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
  const setSt = async (id: number, s: string) => {
    if (s === "annullato" && !confirm("Annullare l'ordine? La merce torna a magazzino e i punti vengono stornati/restituiti. Eventuali rimborsi si registrano in Pagamenti.")) return;
    try { await patch(`/api/admin/orders/${id}`, { status: s }); toast("Stato aggiornato"); qc.invalidateQueries({ queryKey: ["admin-orders"] }); } catch (e: any) { toast(e.message, "err"); }
  };
  const [counter, setCounter] = useState(false);
  return (
    <div>
      <PageTitle title="Ordini" subtitle="Ordini on line e vendite in negozio. Il magazzino si scarica quando l'ordine è pagato o preso in carico.">
        <button className="btn-primary btn-sm" onClick={() => setCounter(true)}><Plus size={14} /> Vendita in negozio</button>
      </PageTitle>
      {counter && <CounterSale onClose={() => setCounter(false)} />}
      <select className="input mb-4 w-56" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Tutti</option>{Object.entries(ORDER_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      {isLoading ? <Spinner /> : !data?.length ? <Empty>Nessun ordine.</Empty> : (
        <div className="space-y-3">{data.map((o) => (
          <div key={o.id} className="card">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><p className="font-bold">{o.channel === "negozio" ? "Vendita in negozio" : "Ordine on line"} #{o.id} · {fmtDateTime(o.createdAt)}</p><p className="text-sm text-slate-600">{o.customer}{o.phone ? ` · ${o.phone}` : ""}{o.email ? ` · ${o.email}` : ""}</p></div>
              <select className="input w-48" value={o.status} onChange={(e) => setSt(o.id, e.target.value)}>{Object.entries(ORDER_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            </div>
            <ul className="mt-2 text-sm">{o.items.map((i: any) => <li key={i.id}>{i.qty} × {i.name} – {euro(i.unitPriceCents * i.qty)}</li>)}</ul>
            <p className="mt-1 text-sm">{o.delivery === "ritiro" ? "Ritiro in negozio" : `Consegna: ${o.deliveryAddress}, ${o.deliveryCap} ${o.deliveryCity} (${o.deliveryZone}${o.deliveryEta ? `, ${o.deliveryEta}` : ""}) – ${euro(o.deliveryCents)}`}{o.promoCode && ` · codice ${o.promoCode} (−${euro(o.discountCents)})`}{o.pointsUsed > 0 && ` · ${o.pointsUsed} punti (−${euro(o.pointsDiscountCents)})`}{o.notes && ` · ${o.notes}`}</p>
            <p className="text-right text-lg font-bold">{euro(o.totalCents)} <span className={`text-sm ${o.paidCents >= o.totalCents ? "text-green-700" : "text-amber-600"}`}>{o.paidCents >= o.totalCents ? "pagato" : `pagato ${euro(o.paidCents)}`}</span></p>
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
  const act = async (action: string) => {
    setErr(null);
    try {
      await post(`/api/admin/boarding/${edit.id}/action`, { action, message: edit.message || null, priceCents: edit.priceCents, startDate: edit.newStart || undefined, endDate: edit.newEnd || undefined });
      toast("Richiesta aggiornata e cliente avvisato"); setEdit(null); qc.invalidateQueries({ queryKey: ["admin-boarding"] }); qc.invalidateQueries({ queryKey: ["dashboard"] });
    } catch (e) { setErr(e); }
  };
  const saveNotes = async () => { try { await patch(`/api/admin/boarding/${edit.id}`, { adminNotes: edit.adminNotes || null, priceCents: edit.priceCents }); toast("Salvato"); qc.invalidateQueries({ queryKey: ["admin-boarding"] }); } catch (e) { setErr(e); } };
  const open = !!edit && !["rifiutata", "annullata", "completata"].includes(edit.status);
  return (
    <div>
      <PageTitle title="Pensione casalinga" subtitle="Le richieste non vengono mai confermate in automatico" />
      <select className="input mb-4 w-56" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Tutte</option>{Object.entries(BOARDING_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      {isLoading ? <Spinner /> : !data?.length ? <Empty>Nessuna richiesta.</Empty> : (
        <div className="overflow-x-auto rounded-2xl border bg-white"><table className="table-dp"><thead><tr><th>Periodo</th><th>Cane</th><th>Cliente</th><th>Prezzo</th><th>Stato</th><th /></tr></thead>
          <tbody>{data.map((b) => <tr key={b.id}><td className="font-bold">{fmtDay(b.startDate)} → {fmtDay(b.endDate)}</td><td>{b.dogName} ({SIZE_LABELS[b.dogSize]})</td><td>{b.customer}<br /><span className="text-xs">{b.phone}</span></td><td>{euro(b.priceCents)}</td><td>{BOARDING_STATUS[b.status]}</td>
            <td><button className="btn-outline btn-sm" onClick={() => { setErr(null); setEdit({ ...b, message: "" }); }}>Gestisci</button></td></tr>)}</tbody></table></div>
      )}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={`Pensione – ${edit?.dogName ?? ""}`} wide>
        {edit && <div className="space-y-3">
          <p className="text-sm"><b>{fmtDay(edit.startDate)} → {fmtDay(edit.endDate)}</b> · {BOARDING_STATUS[edit.status]} · ricevuta il {fmtDate(edit.createdAt)}</p>
          {edit.needs && <p className="rounded-xl bg-brand-sky p-3 text-sm"><b>Esigenze:</b> {edit.needs}</p>}
          {edit.customerNotes && <p className="rounded-xl bg-slate-50 p-3 text-sm whitespace-pre-line"><b>Note cliente:</b> {edit.customerNotes}</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Prezzo"><MoneyInput value={edit.priceCents} onChange={(v) => setEdit({ ...edit, priceCents: v })} /></Field>
            <Field label="Note interne"><input className="input" value={edit.adminNotes || ""} onChange={(e) => setEdit({ ...edit, adminNotes: e.target.value })} /></Field>
          </div>
          <button className="btn-ghost btn-sm" onClick={saveNotes}>Salva prezzo e note</button>
          {open && <>
            <Field label="Messaggio al cliente (obbligatorio per chiedere informazioni)"><textarea className="input" value={edit.message} onChange={(e) => setEdit({ ...edit, message: e.target.value })} /></Field>
            <div className="grid gap-2 sm:grid-cols-3 sm:items-end">
              <Field label="Nuove date: dal"><input type="date" className="input" value={edit.newStart || ""} onChange={(e) => setEdit({ ...edit, newStart: e.target.value })} /></Field>
              <Field label="al"><input type="date" className="input" value={edit.newEnd || ""} onChange={(e) => setEdit({ ...edit, newEnd: e.target.value })} /></Field>
              <button className="btn-outline" disabled={!edit.newStart || !edit.newEnd} onClick={() => act("proponi_date")}>Proponi nuove date</button>
            </div>
            <ErrorBox error={err} />
            <div className="flex flex-wrap gap-2">
              {["richiesta", "info_richieste", "proposta"].includes(edit.status) && <button className="btn-primary" onClick={() => act("accetta")}>Accetta</button>}
              {["richiesta", "info_richieste", "proposta"].includes(edit.status) && <button className="btn-outline" onClick={() => act("chiedi_info")}>Chiedi informazioni</button>}
              {["richiesta", "info_richieste", "proposta"].includes(edit.status) && <button className="btn-danger" onClick={() => confirm("Rifiutare la richiesta?") && act("rifiuta")}>Rifiuta</button>}
              {edit.status === "confermata" && <button className="btn-navy" onClick={() => act("in_corso")}>Soggiorno iniziato</button>}
              {edit.status === "in_corso" && <button className="btn-navy" onClick={() => act("completa")}>Soggiorno concluso</button>}
              {["confermata", "in_corso"].includes(edit.status) && <button className="btn-ghost text-red-600" onClick={() => confirm("Annullare?") && act("annulla")}>Annulla</button>}
            </div>
          </>}
          <details className="rounded-xl border p-3"><summary className="cursor-pointer font-bold">Storico ({edit.events?.length || 0})</summary>
            <ul className="mt-2 space-y-1 text-sm">{edit.events?.map((e: any) => <li key={e.id}><span className="text-slate-400">{fmtDateTime(e.createdAt)}</span> <b>{e.action.replaceAll("_", " ")}</b>{e.message && ` – ${e.message}`}</li>)}</ul></details>
        </div>}
      </Modal>
    </div>
  );
}

/** Vendita al banco: scarico magazzino, incasso, punti al cliente. */
function CounterSale({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [cq, setCq] = useState("");
  const { data: prods } = useQuery<any>({ queryKey: ["cs-prod", q], queryFn: () => get(`/api/admin/products?q=${encodeURIComponent(q)}&pageSize=15&active=true`), enabled: q.length >= 2 });
  const { data: custs } = useQuery<any>({ queryKey: ["cs-cust", cq], queryFn: () => get(`/api/admin/customers?q=${encodeURIComponent(cq)}&pageSize=8`).catch(() => ({ rows: [] })), enabled: cq.length >= 2 });
  const [cust, setCust] = useState<any>(null);
  const [lines, setLines] = useState<any[]>([]);
  const [pick, setPick] = useState<any>(null);
  const { data: vars } = useQuery<any[]>({ queryKey: ["variants", pick?.id], queryFn: () => get(`/api/admin/products/${pick.id}/variants`), enabled: !!pick });
  const [method, setMethod] = useState("contanti");
  const [promo, setPromo] = useState("");
  const [points, setPoints] = useState(0);
  const [err, setErr] = useState<unknown>(null);
  const addLine = (p: any, v: any | null) => { setLines([...lines, { productId: p.id, variantId: v?.id ?? null, name: v ? `${p.name} – ${v.name}` : p.name, qty: 1, unit: v?.priceCents ?? p.salePriceCents ?? p.priceCents }]); setPick(null); setQ(""); };
  const total = lines.reduce((a, l) => a + l.qty * l.unit, 0);
  const submit = async () => {
    setErr(null);
    try { const o = await post("/api/admin/orders/counter-sale", { customerId: cust?.id ?? null, items: lines.map((l) => ({ productId: l.productId, variantId: l.variantId, qty: l.qty })), method, promoCode: promo || null, pointsToUse: points });
      toast(`Vendita #${o.id} registrata`); qc.invalidateQueries({ queryKey: ["admin-orders"] }); onClose(); }
    catch (e) { setErr(e); }
  };
  return (
    <Modal open onClose={onClose} title="Vendita in negozio" wide>
      <div className="space-y-3">
        <Field label="Cliente (facoltativo, per i punti Fidelity)">
          {cust ? <p className="py-2 text-sm font-bold">{cust.firstName} {cust.lastName} <button className="ml-2 text-brand-blue underline" onClick={() => setCust(null)}>cambia</button></p> : <>
            <input className="input" placeholder="Cerca cliente" value={cq} onChange={(e) => setCq(e.target.value)} />
            {custs?.rows?.map((c: any) => <button key={c.id} className="block w-full px-3 py-1 text-left text-sm hover:bg-brand-sky" onClick={() => setCust(c)}>{c.lastName} {c.firstName} · {c.phone}</button>)}</>}
        </Field>
        <Field label="Aggiungi prodotto">
          <input className="input" placeholder="Nome, codice o codice a barre" value={q} onChange={(e) => setQ(e.target.value)} />
          {!pick && prods?.rows?.map((p: any) => <button key={p.id} className="block w-full px-3 py-1 text-left text-sm hover:bg-brand-sky" onClick={() => setPick(p)}>{p.name} · {euro(p.salePriceCents ?? p.priceCents)} · giac. {p.stock}</button>)}
          {pick && (vars?.length ? <div className="mt-1 space-y-1">{vars.filter((v) => v.active).map((v) => <button key={v.id} className="block w-full rounded-lg border px-3 py-1 text-left text-sm" onClick={() => addLine(pick, v)}>{pick.name} – {v.name} (giac. {v.stock})</button>)}</div>
            : vars && <button className="btn-outline btn-sm mt-1" onClick={() => addLine(pick, null)}>Aggiungi {pick.name}</button>)}
        </Field>
        {lines.length > 0 && <table className="table-dp"><tbody>{lines.map((l, i) => <tr key={i}><td>{l.name}</td><td><input type="number" min={1} className="input w-20" value={l.qty} onChange={(e) => setLines(lines.map((x, j) => j === i ? { ...x, qty: Math.max(1, Number(e.target.value) || 1) } : x))} /></td><td>{euro(l.qty * l.unit)}</td><td><button className="text-red-600" onClick={() => setLines(lines.filter((_, j) => j !== i))}>✕</button></td></tr>)}</tbody></table>}
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Metodo di pagamento"><select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>{Object.entries(PAYMENT_METHODS).filter(([k]) => k !== "online").map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="Codice sconto"><input className="input" value={promo} onChange={(e) => setPromo(e.target.value.toUpperCase())} /></Field>
          {cust && <Field label="Punti da usare"><input type="number" min={0} className="input" value={points} onChange={(e) => setPoints(Math.max(0, Number(e.target.value) || 0))} /></Field>}
        </div>
        <p className="text-right text-lg font-bold">Totale prima di sconti {euro(total)}</p>
        <ErrorBox error={err} />
        <button className="btn-primary" disabled={!lines.length} onClick={submit}>Registra vendita e incasso</button>
      </div>
    </Modal>
  );
}
