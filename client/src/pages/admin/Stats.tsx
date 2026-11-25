import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { PageTitle, Spinner, Field, Empty } from "@/components/ui";
import { get } from "@/lib/api";
import { todayISO, addDaysISO, weekdayISO, mins, fmtDay } from "@/lib/format";
import { euro, STATUS_LABELS, STATUS_COLORS, PAYMENT_METHODS } from "@shared/constants";
import { useAdminOperators } from "./AppointmentDetail";

function Bars({ data, color = "#2E8DE6", fmt = euro }: { data: { label: string; value: number }[]; color?: string; fmt?: (n: number) => string }) {
  const max = Math.max(1, ...data.map((d) => Math.abs(d.value)));
  if (!data.length) return <p className="text-sm text-slate-500">Nessun dato registrato nel periodo.</p>;
  return (
    <div className="space-y-1.5">{data.map((d) => (
      <div key={d.label} className="flex items-center gap-2 text-sm">
        <span className="w-32 shrink-0 truncate text-slate-600" title={d.label}>{d.label}</span>
        <div className="h-5 flex-1 rounded bg-slate-100"><div className="h-5 rounded" style={{ width: `${(Math.abs(d.value) / max) * 100}%`, background: color }} /></div>
        <span className="w-24 shrink-0 text-right font-semibold">{fmt(d.value)}</span>
      </div>
    ))}</div>
  );
}

const Kpi = ({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) => (
  <div className="card"><p className="label">{label}</p><p className="text-2xl font-extrabold text-brand-navy">{value}</p>{hint && <p className="text-xs text-slate-500">{hint}</p>}</div>
);

export function Stats() {
  const today = todayISO();
  const [from, setFrom] = useState(today.slice(0, 8) + "01");
  const [to, setTo] = useState(today);
  const [f, setF] = useState({ serviceId: "", operatorId: "", method: "", category: "", channel: "" });
  const { data: ops } = useAdminOperators();
  const { data: services } = useQuery<any[]>({ queryKey: ["admin-services"], queryFn: () => get("/api/admin/services").catch(() => []) });
  const { data: cats } = useQuery<any>({ queryKey: ["categories-all"], queryFn: () => get("/api/admin/categories?pageSize=100").catch(() => ({ rows: [] })) });
  const qs = `from=${from}&to=${to}` + Object.entries(f).filter(([, v]) => v).map(([k, v]) => `&${k}=${encodeURIComponent(v)}`).join("");
  const { data, isLoading, error } = useQuery<any>({ queryKey: ["stats", qs], queryFn: () => get(`/api/admin/stats?${qs}`) });
  const weekStart = addDaysISO(today, -((weekdayISO(today) + 6) % 7));
  const presets = [
    { label: "Oggi", f: today, t: today }, { label: "Settimana", f: weekStart, t: today }, { label: "Mese", f: today.slice(0, 8) + "01", t: today },
    { label: "Anno", f: today.slice(0, 4) + "-01-01", t: today }, { label: "Ultimi 30 gg", f: addDaysISO(today, -30), t: today },
  ];
  return (
    <div>
      <PageTitle title="Statistiche e report" subtitle="Dati calcolati solo dalle operazioni realmente registrate">
        <a className="btn-outline btn-sm" href={`/api/admin/stats?${qs}&format=xlsx`}><Download size={14} /> Excel</a>
        <a className="btn-outline btn-sm" href={`/api/admin/stats?${qs}&format=pdf`}><Download size={14} /> PDF</a>
      </PageTitle>
      <div className="card mb-5 space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Dal"><input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="Al"><input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          {presets.map((p) => <button key={p.label} className={`btn-sm ${from === p.f && to === p.t ? "btn-navy" : "btn-outline"}`} onClick={() => { setFrom(p.f); setTo(p.t); }}>{p.label}</button>)}
        </div>
        <div className="grid gap-2 sm:grid-cols-5">
          <select className="input" value={f.serviceId} onChange={(e) => setF({ ...f, serviceId: e.target.value })} aria-label="Servizio"><option value="">Tutti i servizi</option>{services?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          <select className="input" value={f.operatorId} onChange={(e) => setF({ ...f, operatorId: e.target.value })} aria-label="Operatore"><option value="">Tutti gli operatori</option>{ops?.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
          <select className="input" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })} aria-label="Pagamento"><option value="">Tutti i pagamenti</option>{Object.entries(PAYMENT_METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <select className="input" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} aria-label="Categoria"><option value="">Tutte le categorie</option>{cats?.rows?.map((c: any) => <option key={c.id} value={c.name}>{c.name}</option>)}</select>
          <select className="input" value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })} aria-label="Canale"><option value="">Tutti i canali</option><option value="toelettatura">Toelettatura</option><option value="selfservice">Self-service</option><option value="shop_online">Shop online</option><option value="shop_negozio">Vendite in negozio</option><option value="pensione">Pensione</option></select>
        </div>
      </div>
      {error ? <Empty>{(error as Error).message}</Empty> : isLoading || !data ? <Spinner /> : (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Kpi label="Toelettatura" value={euro(data.revenue.grooming)} hint={`di cui acconti ${euro(data.revenue.deposits)}`} />
            <Kpi label="Self-service" value={euro(data.selfservice.total)} hint={`${data.selfservice.n} registrazioni`} />
            <Kpi label="Shop" value={euro(data.revenue.shop)} />
            <Kpi label="Pensione" value={euro(data.revenue.boarding)} />
            <Kpi label="Rimborsi" value={euro(data.revenue.refunds)} />
          </div>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Kpi label="Da confermare" value={data.kpi.pending} /><Kpi label="Confermati" value={data.kpi.confirmed} /><Kpi label="Completati" value={data.kpi.completed} />
            <Kpi label="Annullati" value={data.kpi.cancelled} /><Kpi label="Assenze" value={data.kpi.noShows} /><Kpi label="Rifiutati" value={data.kpi.rejected} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Kpi label="Clienti nuovi" value={data.newCustomers} /><Kpi label="Clienti abituali" value={data.regularCustomers} hint="≥4 visite negli ultimi 12 mesi" />
            <Kpi label="Punti assegnati" value={data.points.assigned} /><Kpi label="Punti utilizzati" value={data.points.used} /><Kpi label="Punti scaduti" value={data.points.expired} />
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            <div className="card"><h2 className="mb-3 font-bold">Incassi giornalieri</h2><Bars data={data.daily.map((d: any) => ({ label: fmtDay(d.day), value: d.cents }))} /></div>
            <div className="card"><h2 className="mb-3 font-bold">Incassi mensili (12 mesi, escluso self-service)</h2><Bars data={data.monthly.map((m: any) => ({ label: m.month, value: m.payments }))} /></div>
            <div className="card"><h2 className="mb-3 font-bold">Incassi per servizio</h2><Bars color="#0B3D91" data={data.topServices.map((s: any) => ({ label: `${s.name} (${s.n})`, value: s.revenue }))} /></div>
            <div className="card"><h2 className="mb-3 font-bold">Self-service mensile</h2><Bars color="#00B6C8" data={data.selfserviceMonthly.map((m: any) => ({ label: m.month, value: m.cents }))} /></div>
            <div className="card"><h2 className="mb-3 font-bold">Per operatore</h2>
              <table className="table-dp"><thead><tr><th>Operatore</th><th>App.</th><th>Tempo in agenda</th><th>Incassi</th></tr></thead>
                <tbody>{data.byOperator.map((o: any) => <tr key={o.id}><td><span className="mr-1 inline-block h-2.5 w-2.5 rounded-full" style={{ background: o.color }} />{o.name}</td><td>{o.n}</td><td>{mins(o.booked_minutes)}</td><td className="font-bold">{euro(o.revenue)}</td></tr>)}</tbody></table></div>
            <div className="card"><h2 className="mb-3 font-bold">Ore lavorate e compensi collaboratori</h2>
              <table className="table-dp"><tbody>{data.hours.map((h: any) => <tr key={h.name}><td>{h.name}</td><td>{mins(h.minutes)}</td><td className="text-right font-bold">{euro(h.cost)}</td></tr>)}</tbody></table>
              <p className="mt-2 text-xs text-slate-500">Presenze registrate, distinte dalle ore prenotate dai clienti.</p></div>
            <div className="card"><h2 className="mb-3 font-bold">Prodotti più venduti</h2>
              {data.topProducts.length ? <table className="table-dp"><tbody>{data.topProducts.map((p: any) => <tr key={p.name}><td>{p.name}</td><td>{p.qty} pz</td><td className="text-right">{euro(p.cents)}</td></tr>)}</tbody></table> : <p className="text-sm text-slate-500">Nessuna vendita nel periodo.</p>}
              <div className="mt-3 flex flex-wrap gap-2 text-sm">{data.shopSales.map((s: any) => <span key={s.channel} className="badge bg-brand-sky text-brand-navy">{s.channel === "online" ? "online" : "In negozio"}: {s.n} ordini · {euro(s.cents)}</span>)}</div></div>
            <div className="card"><h2 className="mb-3 font-bold">Metodi di pagamento</h2><Bars data={data.methods.map((m: any) => ({ label: PAYMENT_METHODS[m.method] || m.method, value: m.cents }))} />
              <h3 className="mb-2 mt-4 font-bold">Appuntamenti per stato</h3>
              <div className="flex flex-wrap gap-2">{data.appointmentsByStatus.map((s: any) => <span key={s.status} className="badge text-sm" style={{ background: STATUS_COLORS[s.status] + "22", color: STATUS_COLORS[s.status] }}>{STATUS_LABELS[s.status]}: {s.n}</span>)}</div></div>
          </div>
        </div>
      )}
    </div>
  );
}
