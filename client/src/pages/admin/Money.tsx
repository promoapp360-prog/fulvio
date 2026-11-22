import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Plus, Search } from "lucide-react";
import { PageTitle, Spinner, Empty, Modal, Field, MoneyInput, ErrorBox, Tabs, useToast } from "@/components/ui";
import ResourceManager from "@/components/ResourceManager";
import { get, post } from "@/lib/api";
import { usePublicSettings } from "@/lib/settings";
import { useMe } from "@/lib/auth";
import { todayISO, fmtDateTime, fmtDay } from "@/lib/format";
import { euro, PAYMENT_METHODS, PAYMENT_KINDS } from "@shared/constants";

const monthStart = () => todayISO().slice(0, 8) + "01";

export function Payments() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: me } = useMe();
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(todayISO());
  const [method, setMethod] = useState("");
  const [adding, setAdding] = useState<any>(null);
  const [err, setErr] = useState<unknown>(null);
  const qs = `from=${from}&to=${to}${method ? `&method=${method}` : ""}`;
  const { data, isLoading } = useQuery<any>({ queryKey: ["payments", qs], queryFn: () => get(`/api/admin/payments?${qs}`) });
  const { data: custom } = useQuery<any>({ queryKey: ["pay-methods"], queryFn: () => get("/api/admin/payment-methods") });
  const save = async () => {
    setErr(null);
    try {
      await post("/api/admin/payments", { kind: adding.kind, method: adding.method, methodLabel: adding.methodLabel || null, amountCents: adding.amountCents, note: adding.note || null, paidDate: adding.paidDate, appointmentId: adding.appointmentId ? Number(adding.appointmentId) : null, orderId: adding.orderId ? Number(adding.orderId) : null });
      toast("Incasso registrato"); setAdding(null); qc.invalidateQueries({ queryKey: ["payments"] });
    } catch (e) { setErr(e); }
  };
  const voidIt = async (id: number) => {
    const reason = prompt("Motivo dell'annullamento della registrazione:");
    if (!reason) return;
    try { await post(`/api/admin/payments/${id}/void`, { reason }); qc.invalidateQueries({ queryKey: ["payments"] }); } catch (e: any) { toast(e.message, "err"); }
  };
  return (
    <div>
      <PageTitle title="Pagamenti e incassi" subtitle="Toelettatura, shop e altri incassi (il self-service ha una sezione dedicata)">
        <a className="btn-outline btn-sm" href={`/api/admin/payments?${qs}&format=csv`}><Download size={14} /> CSV</a>
        <button className="btn-primary btn-sm" onClick={() => { setErr(null); setAdding({ kind: "totale", method: "contanti", amountCents: null, paidDate: todayISO(), note: "" }); }}><Plus size={14} /> Registra incasso</button>
      </PageTitle>
      <div className="mb-4 flex flex-wrap gap-2">
        <input type="date" className="input w-40" value={from} onChange={(e) => setFrom(e.target.value)} />
        <input type="date" className="input w-40" value={to} onChange={(e) => setTo(e.target.value)} />
        <select className="input w-48" value={method} onChange={(e) => setMethod(e.target.value)}><option value="">Tutti i metodi</option>{Object.entries(PAYMENT_METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      </div>
      {isLoading ? <Spinner /> : (
        <>
          <div className="mb-4 flex flex-wrap gap-3">
            <div className="card"><p className="label">Totale incassato</p><p className="text-2xl font-extrabold text-brand-navy">{euro(data.totalCents)}</p></div>
            {Object.entries(data.byMethod).map(([k, v]: any) => <div key={k} className="card"><p className="label">{PAYMENT_METHODS[k]}</p><p className="text-xl font-bold">{euro(v)}</p></div>)}
          </div>
          {!data.rows.length ? <Empty>Nessun movimento nel periodo.</Empty> : (
            <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
              <table className="table-dp"><thead><tr><th>Data</th><th>Cliente</th><th>Riferimento</th><th>Tipo</th><th>Metodo</th><th>Importo</th><th>Stato</th><th /></tr></thead>
                <tbody>{data.rows.map((p: any) => (
                  <tr key={p.id} className={p.status !== "pagato" ? "text-slate-400" : ""}>
                    <td>{fmtDateTime(p.paidAt ?? p.createdAt)}</td><td>{p.customer || "—"}</td><td className="text-xs">{p.appointmentId ? `App. #${p.appointmentId}` : p.orderId ? `Ordine #${p.orderId}` : "—"}</td>
                    <td>{PAYMENT_KINDS[p.kind]}</td><td>{p.methodLabel || PAYMENT_METHODS[p.method]}</td><td className="font-bold">{p.kind === "rimborso" ? "−" : ""}{euro(p.amountCents)}</td><td>{p.status}</td>
                    <td>{me?.role === "admin" && p.status === "pagato" && <button className="btn-ghost btn-sm text-red-600" onClick={() => voidIt(p.id)}>Annulla</button>}</td>
                  </tr>
                ))}</tbody></table>
            </div>
          )}
        </>
      )}
      <Modal open={!!adding} onClose={() => setAdding(null)} title="Registra incasso in negozio">
        {adding && (
          <form onSubmit={(e) => { e.preventDefault(); save(); }} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Tipo"><select className="input" value={adding.kind} onChange={(e) => setAdding({ ...adding, kind: e.target.value })}>{Object.entries(PAYMENT_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
              <Field label="Metodo"><select className="input" value={adding.method} onChange={(e) => setAdding({ ...adding, method: e.target.value })}>{Object.entries(PAYMENT_METHODS).filter(([k]) => k !== "online").map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
              {adding.method === "altro" && <Field label="Specifica metodo"><input className="input" list="custom-methods" value={adding.methodLabel || ""} onChange={(e) => setAdding({ ...adding, methodLabel: e.target.value })} /><datalist id="custom-methods">{custom?.custom?.map((m: string) => <option key={m} value={m} />)}</datalist></Field>}
              <Field label="Importo"><MoneyInput value={adding.amountCents} onChange={(v) => setAdding({ ...adding, amountCents: v })} /></Field>
              <Field label="Data"><input type="date" className="input" value={adding.paidDate} onChange={(e) => setAdding({ ...adding, paidDate: e.target.value })} /></Field>
              <Field label="N. appuntamento (facoltativo)"><input className="input" inputMode="numeric" value={adding.appointmentId || ""} onChange={(e) => setAdding({ ...adding, appointmentId: e.target.value })} /></Field>
              <Field label="N. ordine (facoltativo)"><input className="input" inputMode="numeric" value={adding.orderId || ""} onChange={(e) => setAdding({ ...adding, orderId: e.target.value })} /></Field>
              <Field label="Note" className="sm:col-span-2"><input className="input" value={adding.note} onChange={(e) => setAdding({ ...adding, note: e.target.value })} /></Field>
            </div>
            <ErrorBox error={err} />
            <button className="btn-primary" disabled={!adding.amountCents}>Registra</button>
          </form>
        )}
      </Modal>
    </div>
  );
}

export function SelfService() {
  const { data: s } = usePublicSettings();
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(todayISO());
  const { data: sum } = useQuery<any>({ queryKey: ["/api/admin/selfservice", "summary", from, to], queryFn: () => get(`/api/admin/selfservice-summary?from=${from}&to=${to}`) });
  const stations: string[] = s?.selfservice?.stations || [];
  const categories: string[] = s?.selfservice?.categories || [];
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Dal"><input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="Al"><input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <div className="card py-3"><p className="label">Totale self-service</p><p className="text-2xl font-extrabold text-brand-navy">{euro(sum?.totalCents ?? 0)}</p></div>
        {sum?.byStation?.map((b: any) => <div key={b.station} className="card py-3"><p className="label">{b.station}</p><p className="text-lg font-bold">{euro(b.cents)}</p></div>)}
      </div>
      <ResourceManager title="Incassi self-service" subtitle="Registrazione manuale (i distributori non sono collegati). Separati dagli incassi della toelettatura." endpoint="/api/admin/selfservice"
        defaults={{ incomeDate: todayISO(), station: stations[0] || "Box 1", method: "contanti", amountCents: null, category: categories[0] || "", note: "" }}
        fields={[
          { name: "incomeDate", label: "Data", type: "date", required: true },
          { name: "station", label: "Postazione / box", type: stations.length ? "select" : "text", required: true, options: stations },
          { name: "amountCents", label: "Importo", type: "money", required: true },
          { name: "method", label: "Metodo", type: "select", required: true, options: Object.entries(PAYMENT_METHODS).filter(([k]) => k !== "online").map(([value, label]) => ({ value, label })) },
          { name: "category", label: "Categoria", type: categories.length ? "select" : "text", options: categories, nullable: true },
          { name: "note", label: "Note", nullable: true, full: true },
        ]}
        columns={[{ key: "incomeDate", label: "Data", render: (r) => fmtDay(r.incomeDate) }, { key: "station", label: "Postazione" }, { key: "amountCents", label: "Importo", render: (r) => <b>{euro(r.amountCents)}</b> }, { key: "method", label: "Metodo", render: (r) => PAYMENT_METHODS[r.method] }, { key: "category", label: "Categoria" }, { key: "note", label: "Note" }]}
      />
    </div>
  );
}

export function Loyalty() {
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState("tessere");
  const [q, setQ] = useState("");
  const { data, isLoading } = useQuery<any>({ queryKey: ["loyalty-cards", q], queryFn: () => get(`/api/admin/loyalty/cards?q=${encodeURIComponent(q)}`), enabled: tab === "tessere" });
  const [adj, setAdj] = useState<any>(null);
  const apply = async () => {
    try { await post("/api/admin/loyalty/adjust", { customerId: adj.customerId, points: Number(adj.points), reason: adj.reason }); toast("Punti aggiornati"); setAdj(null); qc.invalidateQueries({ queryKey: ["loyalty-cards"] }); }
    catch (e: any) { toast(e.message, "err"); }
  };
  return (
    <div>
      <PageTitle title="Fidelity Card" subtitle="I punti si accreditano automaticamente a servizio completato e ordine concluso (regole in Impostazioni)" />
      <Tabs value={tab} onChange={setTab} items={[{ value: "tessere", label: "Tessere" }, { value: "premi", label: "Premi" }]} />
      {tab === "premi" ? (
        <ResourceManager title="Premi" endpoint="/api/admin/loyalty/rewards" defaults={{ active: true, pointsCost: 100 }}
          fields={[{ name: "name", label: "Premio", required: true }, { name: "pointsCost", label: "Punti necessari", type: "number", required: true }, { name: "description", label: "Descrizione", type: "textarea", nullable: true }, { name: "active", label: "Attivo", type: "checkbox" }]}
          columns={[{ key: "name", label: "Premio" }, { key: "pointsCost", label: "Punti" }, { key: "active", label: "Attivo", render: (r) => (r.active ? "✓" : "—") }]} />
      ) : (
        <>
          <div className="relative mb-3 max-w-sm"><Search size={16} className="absolute left-3 top-2.5 text-slate-400" /><input className="input pl-9" placeholder="Codice, nome o email" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          {isLoading ? <Spinner /> : !data?.rows?.length ? <Empty>Nessuna tessera.</Empty> : (
            <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
              <table className="table-dp"><thead><tr><th>Codice</th><th>Cliente</th><th>Punti</th><th /></tr></thead>
                <tbody>{data.rows.map((c: any) => <tr key={c.id}><td className="font-mono">{c.code}</td><td>{c.name}<br /><span className="text-xs text-slate-500">{c.email}</span></td><td className="text-lg font-bold">{c.points}</td>
                  <td><button className="btn-outline btn-sm" onClick={() => setAdj({ customerId: c.customerId, name: c.name, points: "", reason: "" })}>Aggiungi / scala punti</button></td></tr>)}</tbody></table>
            </div>
          )}
        </>
      )}
      <Modal open={!!adj} onClose={() => setAdj(null)} title={`Punti – ${adj?.name}`}>
        {adj && <div className="space-y-3">
          <Field label="Punti (usa il segno meno per scalare)"><input type="number" className="input" value={adj.points} onChange={(e) => setAdj({ ...adj, points: e.target.value })} /></Field>
          <Field label="Motivo"><input className="input" value={adj.reason} onChange={(e) => setAdj({ ...adj, reason: e.target.value })} /></Field>
          <button className="btn-primary" disabled={!adj.points || !adj.reason} onClick={apply}>Applica</button>
        </div>}
      </Modal>
    </div>
  );
}
