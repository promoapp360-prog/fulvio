import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Plus, Search } from "lucide-react";
import { PageTitle, Spinner, Empty, Modal, Field, MoneyInput, ErrorBox, Tabs, useToast } from "@/components/ui";
import ResourceManager from "@/components/ResourceManager";
import { WalkInCreator, MembershipClaims, CardExpiryRule } from "./LoyaltyMembership";
import { get, post } from "@/lib/api";
import { usePublicSettings } from "@/lib/settings";
import { useMe } from "@/lib/auth";
import { todayISO, fmtDateTime, fmtDay } from "@/lib/format";
import { euro, PAYMENT_METHODS, PAYMENT_KINDS, LOYALTY_KINDS } from "@shared/constants";

const monthStart = () => todayISO().slice(0, 8) + "01";

export function Payments() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: me } = useMe();
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(todayISO());
  const [method, setMethod] = useState("");
  const [channel, setChannel] = useState("");
  const [tab, setTab] = useState("movimenti");
  const { data: out } = useQuery<any>({ queryKey: ["outstanding"], queryFn: () => get("/api/admin/outstanding"), enabled: tab === "dacassare" });
  const [adding, setAdding] = useState<any>(null);
  const [err, setErr] = useState<unknown>(null);
  const qs = `from=${from}&to=${to}${method ? `&method=${method}` : ""}${channel ? `&channel=${channel}` : ""}`;
  const { data, isLoading } = useQuery<any>({ queryKey: ["payments", qs], queryFn: () => get(`/api/admin/payments?${qs}`) });
  const { data: custom } = useQuery<any>({ queryKey: ["pay-methods"], queryFn: () => get("/api/admin/payment-methods") });
  const save = async () => {
    setErr(null);
    try {
      await post("/api/admin/payments", { reason: adding.reason || null, kind: adding.kind, method: adding.method, methodLabel: adding.methodLabel || null, amountCents: adding.amountCents, note: adding.note || null, paidDate: adding.paidDate, appointmentId: adding.appointmentId ? Number(adding.appointmentId) : null, orderId: adding.orderId ? Number(adding.orderId) : null });
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
      <PageTitle title="Pagamenti" subtitle="Contabilità gestionale: non sostituisce obblighi fiscali né fatturazione elettronica">
        <a className="btn-outline btn-sm" href={`/api/admin/payments?${qs}&format=xlsx`}><Download size={14} /> Excel</a>
        <a className="btn-outline btn-sm" href={`/api/admin/payments?${qs}&format=pdf`}><Download size={14} /> PDF</a>
        <button className="btn-primary btn-sm" onClick={() => { setErr(null); setAdding({ kind: "totale", method: "contanti", amountCents: null, paidDate: todayISO(), note: "" }); }}><Plus size={14} /> Registra incasso</button>
      </PageTitle>
      <div className="mb-4 flex flex-wrap gap-2">
        <input type="date" className="input w-40" value={from} onChange={(e) => setFrom(e.target.value)} />
        <input type="date" className="input w-40" value={to} onChange={(e) => setTo(e.target.value)} />
        <select className="input w-48" value={method} onChange={(e) => setMethod(e.target.value)}><option value="">Tutti i metodi</option>{Object.entries(PAYMENT_METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select className="input w-44" value={channel} onChange={(e) => setChannel(e.target.value)}><option value="">Tutti gli incassi</option><option value="toelettatura">Toelettatura</option><option value="shop">Shop</option><option value="pensione">Pensione</option><option value="altro">Altro</option></select>
      </div>
      <Tabs value={tab} onChange={setTab} items={[{ value: "movimenti", label: "Movimenti" }, { value: "dacassare", label: "Da incassare" }]} />
      {tab === "dacassare" ? (!out ? <Spinner /> : (
        <div className="space-y-4">
          <div className="card"><p className="label">Totale ancora da incassare</p><p className="text-2xl font-extrabold text-brand-navy">{euro(out.totalCents)}</p></div>
          <div className="overflow-x-auto rounded-2xl border bg-white"><table className="table-dp"><thead><tr><th>Riferimento</th><th>Cliente</th><th>Dettaglio</th><th>Importo</th><th>Pagato</th><th>Residuo</th></tr></thead>
            <tbody>{out.appointments.map((a: any) => <tr key={"a" + a.id}><td>App. #{a.id} · {fmtDateTime(a.start_at)}</td><td>{a.customer}</td><td>{a.dog} – {a.service} ({a.status})</td><td>{euro(a.price)}</td><td>{euro(a.paid)}</td><td className="font-bold">{euro(a.price - a.paid)}</td></tr>)}
              {out.orders.map((o: any) => <tr key={"o" + o.id}><td>Ordine #{o.id} · {fmtDateTime(o.created_at)}</td><td>{o.customer}</td><td>{o.status}</td><td>{euro(o.price)}</td><td>{euro(o.paid)}</td><td className="font-bold">{euro(o.price - o.paid)}</td></tr>)}</tbody></table></div>
        </div>
      )) : isLoading ? <Spinner /> : (
        <>
          <div className="mb-4 flex flex-wrap gap-3">
            <div className="card"><p className="label">Totale incassato</p><p className="text-2xl font-extrabold text-brand-navy">{euro(data.totalCents)}</p></div>
            {Object.entries(data.byMethod).map(([k, v]: any) => <div key={k} className="card"><p className="label">{PAYMENT_METHODS[k]}</p><p className="text-xl font-bold">{euro(v)}</p></div>)}
          </div>
          {!data.rows.length ? <Empty>Nessun movimento nel periodo.</Empty> : (
            <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
              <table className="table-dp"><thead><tr><th>Data</th><th>Cliente</th><th>Causale / riferimento</th><th>Tipo</th><th>Metodo</th><th>Importo</th><th>Stato</th><th /></tr></thead>
                <tbody>{data.rows.map((p: any) => (
                  <tr key={p.id} className={p.status !== "pagato" ? "text-slate-400" : ""}>
                    <td>{fmtDateTime(p.paidAt ?? p.createdAt)}</td><td>{p.customer || "—"}</td><td className="text-xs">{p.reason && <span className="block">{p.reason}</span>}{p.appointmentId ? `App. #${p.appointmentId}` : p.orderId ? `Ordine #${p.orderId}` : ""}</td>
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
              <Field label="Causale" className="sm:col-span-2"><input className="input" value={adding.reason || ""} onChange={(e) => setAdding({ ...adding, reason: e.target.value })} placeholder="Es. saldo toelettatura, vendita al banco…" /></Field>
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
      <div className="flex gap-2"><a className="btn-outline btn-sm" href={`/api/admin/stats?from=${from}&to=${to}&channel=selfservice&format=xlsx`}>Report self-service (Excel)</a></div>
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
  const { data, isLoading, error } = useQuery<any>({ queryKey: ["loyalty-cards", q], queryFn: () => get(`/api/admin/loyalty/cards?q=${encodeURIComponent(q)}`), enabled: tab === "tessere", refetchInterval: 30_000 });
  const [adj, setAdj] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const { data: card, error: cardError } = useQuery<any>({ queryKey: ["loyalty-card", adj?.cardId], queryFn: () => get(`/api/admin/loyalty/card/${adj.cardId}`), enabled: !!adj, refetchInterval: 30_000 });
  const { data: rewards } = useQuery<any>({ queryKey: ["/api/admin/loyalty/rewards", "all"], queryFn: () => get("/api/admin/loyalty/rewards?pageSize=100") });
  const run = async (url: string, body: any, msg: string) => {
    if (saving) return; setSaving(true);
    const openedCard = adj.cardId;
    try { await post(url, { ...body, cardId: openedCard }); toast(msg); qc.invalidateQueries({ queryKey: ["loyalty-cards"] }); qc.invalidateQueries({ queryKey: ["loyalty-card"] }); setAdj((current: any) => current?.cardId === openedCard ? { ...current, points: "", reason: "", redeem: "", rewardId: "", appointmentId: "", newDate: "", extReason: "" } : current); }
    catch (e: any) { toast(e.message, "err"); } finally { setSaving(false); }
  };
  return (
    <div>
      <PageTitle title="Fidelity Card" subtitle="Punti manuali con causale e storico, clienti Self-Service senza account. Bonus e scadenza generale in Impostazioni → Fidelity.">
        <WalkInCreator onCreated={(c, name) => { setTab("tessere"); setAdj({ cardId: c.id, name, points: "", reason: "" }); }} />
      </PageTitle>
      <Tabs value={tab} onChange={setTab} items={[{ value: "tessere", label: "Tessere" }, { value: "premi", label: "Premi" }, { value: "associazioni", label: "Associazioni da verificare" }]} />
      {tab === "associazioni" ? <MembershipClaims /> : tab === "premi" ? (
        <ResourceManager title="Premi e conversioni" endpoint="/api/admin/loyalty/rewards" defaults={{ active: true, pointsCost: 100, rewardType: "premio" }}
          fields={[{ name: "name", label: "Premio", required: true }, { name: "pointsCost", label: "Punti necessari", type: "number", required: true },
            { name: "rewardType", label: "Tipo", type: "select", required: true, options: [{ value: "premio", label: "Premio" }, { value: "sconto_servizi", label: "Sconto sui servizi" }, { value: "sconto_prodotti", label: "Sconto sui prodotti" }, { value: "credito_shop", label: "Credito spendibile nello shop" }] },
            { name: "valueCents", label: "Valore dello sconto/credito", type: "money" }, { name: "description", label: "Descrizione", type: "textarea", nullable: true }, { name: "active", label: "Attivo", type: "checkbox" }]}
          columns={[{ key: "name", label: "Premio" }, { key: "pointsCost", label: "Punti" }, { key: "active", label: "Attivo", render: (r) => (r.active ? "✓" : "—") }]} />
      ) : (
        <>
          <div className="relative mb-3 max-w-sm"><Search size={16} className="absolute left-3 top-2.5 text-slate-400" /><input className="input pl-9" aria-label="Cerca tessera" placeholder="Tessera, nome, telefono o email" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          {error ? <ErrorBox error={error} /> : isLoading ? <Spinner /> : !data?.rows?.length ? <Empty>Nessuna tessera.</Empty> : (
            <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
              <table className="table-dp"><thead><tr><th>Codice</th><th>Cliente</th><th>Punti</th><th /></tr></thead>
                <tbody>{data.rows.map((c: any) => <tr key={c.id}><td className="font-mono">{c.code}</td><td>{c.name}<br /><span className="text-xs text-slate-500">{c.phone}{c.email && <> · {c.email}</>}<br />{c.customerId ? "Cliente registrato" : "Self-Service · senza account"}</span></td><td className="text-lg font-bold">{c.points}</td>
                  <td><button className="btn-outline btn-sm min-h-11" onClick={() => setAdj({ cardId: c.id, customerId: c.customerId ?? undefined, name: c.name, points: "", reason: "" })}>Gestisci</button></td></tr>)}</tbody></table>
            </div>
          )}
        </>
      )}
      <Modal open={!!adj} onClose={() => setAdj(null)} title={`Fidelity – ${adj?.name}`} wide>
        {adj && <fieldset disabled={saving} className="min-w-0 space-y-4 border-0 p-0">
          {cardError && <ErrorBox error={cardError} />}
          {!card && !cardError && <Spinner />}
          {card && <div className="flex flex-wrap gap-4 text-sm"><span className="text-2xl font-extrabold text-brand-navy">{card.card.points} punti</span>
            {card.expiries.map((e: any) => <span key={e.expiresAt} className="badge bg-amber-100 text-amber-800">{e.points} pt scadono il {fmtDay(String(e.expiresAt).slice(0, 10))}</span>)}</div>}
          {card && <CardExpiryRule key={card.card.id} card={card.card} />}
          <div className="rounded-2xl border p-3"><h3 className="mb-2 font-bold">Utilizzo punti</h3>
            <div className="grid gap-2 sm:grid-cols-4">
              <select className="input sm:col-span-2" value={adj.rewardId || ""} onChange={(e) => setAdj({ ...adj, rewardId: e.target.value })}><option value="">Sconto in base al valore del punto</option>{rewards?.rows?.filter((r: any) => r.active).map((r: any) => <option key={r.id} value={r.id}>{r.name} ({r.pointsCost} pt)</option>)}</select>
              {!adj.rewardId && <input type="number" min={1} className="input" placeholder="Punti" value={adj.redeem || ""} onChange={(e) => setAdj({ ...adj, redeem: e.target.value })} />}
              <input className="input" inputMode="numeric" placeholder="N. appuntamento (sconto servizio)" value={adj.appointmentId || ""} onChange={(e) => setAdj({ ...adj, appointmentId: e.target.value })} />
            </div>
            <button className="btn-primary btn-sm mt-2" onClick={() => run("/api/admin/loyalty/redeem", { customerId: adj.customerId, rewardId: adj.rewardId ? Number(adj.rewardId) : undefined, points: adj.redeem ? Number(adj.redeem) : undefined, appointmentId: adj.appointmentId ? Number(adj.appointmentId) : undefined }, "Punti utilizzati")}>Usa punti</button>
            <p className="mt-1 text-xs text-slate-500">Per gli sconti nello shop il cliente usa i punti al checkout; per le vendite al banco si usano dalla schermata Ordini.</p></div>
          <div className="rounded-2xl border p-3"><h3 className="mb-2 font-bold">Rettifica motivata</h3>
            <div className="grid gap-2 sm:grid-cols-3"><input type="number" step={1} className="input" placeholder="+/- punti" value={adj.points} onChange={(e) => setAdj({ ...adj, points: e.target.value })} /><input className="input sm:col-span-2" list="fidelity-reasons" placeholder="Motivo" value={adj.reason} onChange={(e) => setAdj({ ...adj, reason: e.target.value })} /><datalist id="fidelity-reasons">{["Bonus iscrizione", "Self-service", "Porta un amico", "Omaggio"].map(v => <option key={v}>{v}</option>)}</datalist></div>
            <button className="btn-outline btn-sm mt-2" disabled={!adj.points || !adj.reason} onClick={() => run("/api/admin/loyalty/adjust", { customerId: adj.customerId, points: Number(adj.points), reason: adj.reason }, "Rettifica registrata")}>Registra rettifica</button></div>
          <div className="rounded-2xl border p-3"><h3 className="mb-2 font-bold">Proroga scadenza</h3>
            <div className="grid gap-2 sm:grid-cols-3"><input type="date" className="input" value={adj.newDate || ""} onChange={(e) => setAdj({ ...adj, newDate: e.target.value })} /><input className="input sm:col-span-2" placeholder="Motivo" value={adj.extReason || ""} onChange={(e) => setAdj({ ...adj, extReason: e.target.value })} /></div>
            <button className="btn-outline btn-sm mt-2" disabled={!adj.newDate || !adj.extReason} onClick={() => run("/api/admin/loyalty/extend", { customerId: adj.customerId, newDate: adj.newDate, reason: adj.extReason }, "Scadenza prorogata")}>Proroga tutti i punti in scadenza</button></div>
          {card && <table className="table-dp"><tbody>{card.transactions.map((t: any) => <tr key={t.id}><td>{fmtDateTime(t.createdAt)}</td><td><span className="badge mr-1 bg-slate-100">{LOYALTY_KINDS[t.kind]}</span>{t.reason}</td><td className="text-right font-bold">{t.points > 0 ? "+" : ""}{t.points}</td></tr>)}</tbody></table>}
        </fieldset>}
      </Modal>
    </div>
  );
}
