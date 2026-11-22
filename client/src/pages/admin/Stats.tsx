import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageTitle, Spinner, Field } from "@/components/ui";
import { get } from "@/lib/api";
import { todayISO, addDaysISO, mins } from "@/lib/format";
import { euro, STATUS_LABELS, STATUS_COLORS, PAYMENT_METHODS } from "@shared/constants";

function Bars({ data, color = "#2E8DE6", fmt = euro }: { data: { label: string; value: number }[]; color?: string; fmt?: (n: number) => string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  if (!data.length) return <p className="text-sm text-slate-500">Nessun dato.</p>;
  return (
    <div className="space-y-1.5">{data.map((d) => (
      <div key={d.label} className="flex items-center gap-2 text-sm">
        <span className="w-28 shrink-0 truncate text-slate-600">{d.label}</span>
        <div className="h-5 flex-1 rounded bg-slate-100"><div className="h-5 rounded" style={{ width: `${(d.value / max) * 100}%`, background: color }} /></div>
        <span className="w-24 shrink-0 text-right font-semibold">{fmt(d.value)}</span>
      </div>
    ))}</div>
  );
}

export function Stats() {
  const [from, setFrom] = useState(todayISO().slice(0, 8) + "01");
  const [to, setTo] = useState(todayISO());
  const { data, isLoading } = useQuery<any>({ queryKey: ["stats", from, to], queryFn: () => get(`/api/admin/stats?from=${from}&to=${to}`) });
  const presets = [
    { label: "Questo mese", f: todayISO().slice(0, 8) + "01", t: todayISO() },
    { label: "Ultimi 30 gg", f: addDaysISO(todayISO(), -30), t: todayISO() },
    { label: "Anno in corso", f: todayISO().slice(0, 4) + "-01-01", t: todayISO() },
  ];
  return (
    <div>
      <PageTitle title="Statistiche e report" />
      <div className="mb-5 flex flex-wrap items-end gap-2">
        <Field label="Dal"><input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="Al"><input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        {presets.map((p) => <button key={p.label} className="btn-outline btn-sm" onClick={() => { setFrom(p.f); setTo(p.t); }}>{p.label}</button>)}
      </div>
      {isLoading || !data ? <Spinner /> : (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {[["Toelettatura", data.revenue.grooming], ["Self-service", data.selfservice.total], ["Shop", data.revenue.shop], ["Pensione", data.revenue.boarding], ["Altri incassi", data.revenue.other]].map(([l, v]) => (
              <div key={l as string} className="card"><p className="label">{l}</p><p className="text-2xl font-extrabold text-brand-navy">{euro(v as number)}</p></div>
            ))}
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            <div className="card"><h2 className="mb-3 font-bold">Incassi mensili (ultimi 12 mesi, escluso self-service)</h2><Bars data={data.monthly.map((m: any) => ({ label: m.month, value: m.payments }))} /></div>
            <div className="card"><h2 className="mb-3 font-bold">Self-service mensile</h2><Bars color="#00B6C8" data={data.selfserviceMonthly.map((m: any) => ({ label: m.month, value: m.cents }))} /></div>
            <div className="card"><h2 className="mb-3 font-bold">Appuntamenti per stato</h2><div className="flex flex-wrap gap-2">{data.appointmentsByStatus.map((s: any) => <span key={s.status} className="badge text-sm" style={{ background: STATUS_COLORS[s.status] + "22", color: STATUS_COLORS[s.status] }}>{STATUS_LABELS[s.status]}: {s.n}</span>)}</div>
              <p className="mt-3 text-sm">Nuovi clienti nel periodo: <b>{data.newCustomers}</b></p></div>
            <div className="card"><h2 className="mb-3 font-bold">Servizi più richiesti</h2><Bars color="#0B3D91" fmt={(n) => String(n)} data={data.topServices.map((s: any) => ({ label: s.name, value: s.n }))} /></div>
            <div className="card"><h2 className="mb-3 font-bold">Per operatore</h2>
              <table className="table-dp"><thead><tr><th>Operatore</th><th>App.</th><th>Tempo agenda</th><th>Valore completati</th></tr></thead>
                <tbody>{data.byOperator.map((o: any) => <tr key={o.name}><td><span className="mr-1 inline-block h-2.5 w-2.5 rounded-full" style={{ background: o.color }} />{o.name}</td><td>{o.n}</td><td>{mins(o.minutes)}</td><td>{euro(o.value)}</td></tr>)}</tbody></table></div>
            <div className="card"><h2 className="mb-3 font-bold">Ore lavorate e compensi</h2>
              <table className="table-dp"><tbody>{data.hours.map((h: any) => <tr key={h.name}><td>{h.name}</td><td>{mins(h.minutes)}</td><td className="text-right font-bold">{euro(h.cost)}</td></tr>)}</tbody></table>
              <h3 className="mb-2 mt-4 font-bold">Metodi di pagamento</h3><Bars data={data.methods.map((m: any) => ({ label: PAYMENT_METHODS[m.method] || m.method, value: m.cents }))} /></div>
          </div>
        </div>
      )}
    </div>
  );
}
