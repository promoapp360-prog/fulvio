import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { PageTitle, Tabs, Spinner, Modal, Field, MoneyInput, Check, ErrorBox, Empty, StatusBadge, useToast } from "@/components/ui";
import { get, post } from "@/lib/api";
import { useMe, can } from "@/lib/auth";
import { todayISO, addDaysISO, weekdayISO, romeParts, fmtDay, fmtDateTime } from "@/lib/format";
import { STATUS_COLORS, STATUS_LABELS, WEEKDAYS } from "@shared/constants";
import AppointmentDetail, { useAdminOperators } from "./AppointmentDetail";

type View = "giorno" | "settimana" | "mese";
const START_H = 8, END_H = 20, PX_PER_MIN = 1.3;

function rangeFor(view: View, day: string) {
  if (view === "giorno") return { from: day, to: day };
  if (view === "settimana") { const wd = (weekdayISO(day) + 6) % 7; const from = addDaysISO(day, -wd); return { from, to: addDaysISO(from, 6) }; }
  const from = day.slice(0, 8) + "01"; const [y, m] = day.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate(); return { from, to: `${day.slice(0, 8)}${String(last).padStart(2, "0")}` };
}

export default function Agenda() {
  const { data: me } = useMe();
  const [view, setView] = useState<View>("giorno");
  const [day, setDay] = useState(todayISO());
  const [opFilter, setOpFilter] = useState<string>("");
  const [open, setOpen] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const { data: ops } = useAdminOperators();
  const r = rangeFor(view, day);
  const { data, isLoading } = useQuery<any[]>({ queryKey: ["agenda", r.from, r.to, opFilter], queryFn: () => get(`/api/admin/appointments?from=${r.from}&to=${r.to}${opFilter ? `&operatorId=${opFilter}` : ""}`), refetchInterval: 120_000 });
  const step = view === "giorno" ? 1 : view === "settimana" ? 7 : 30;
  const move = (n: number) => setDay(view === "mese" ? (() => { const [y, m] = day.split("-").map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return d.toISOString().slice(0, 10); })() : addDaysISO(day, n * step));
  const visibleOps = (ops || []).filter((o) => o.active && (!opFilter || String(o.id) === opFilter));

  return (
    <div>
      <PageTitle title="Agenda" subtitle={view === "giorno" ? `${WEEKDAYS[weekdayISO(day)]} ${fmtDay(day)}` : `${fmtDay(r.from)} – ${fmtDay(r.to)}`}>
        {can(me ?? null, "richieste") && <button className="btn-primary btn-sm" onClick={() => setCreating(true)}><Plus size={14} /> Nuovo appuntamento</button>}
      </PageTitle>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Tabs value={view} onChange={setView} items={[{ value: "giorno", label: "Giorno" }, { value: "settimana", label: "Settimana" }, { value: "mese", label: "Mese" }]} />
        <div className="mb-4 flex items-center gap-1">
          <button className="btn-ghost btn-sm" onClick={() => move(-1)} aria-label="Precedente"><ChevronLeft size={16} /></button>
          <button className="btn-outline btn-sm" onClick={() => setDay(todayISO())}>Oggi</button>
          <button className="btn-ghost btn-sm" onClick={() => move(1)} aria-label="Successivo"><ChevronRight size={16} /></button>
          <input type="date" className="input ml-2 w-40" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} />
          <select className="input ml-2 w-44" value={opFilter} onChange={(e) => setOpFilter(e.target.value)} aria-label="Operatore">
            <option value="">Tutti gli operatori</option>{ops?.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </div>
      </div>
      <div className="mb-3 flex flex-wrap gap-3 text-xs">{Object.entries(STATUS_LABELS).filter(([k]) => !["annullata", "rifiutata"].includes(k)).map(([k, v]) => <span key={k} className="flex items-center gap-1"><span className="h-3 w-3 rounded" style={{ background: STATUS_COLORS[k] }} />{v}</span>)}</div>
      {isLoading ? <Spinner /> : view === "giorno" ? <DayView day={day} apps={data || []} ops={visibleOps} onOpen={setOpen} />
        : view === "settimana" ? <WeekView from={r.from} apps={data || []} onOpen={setOpen} onDay={(d) => { setDay(d); setView("giorno"); }} />
        : <MonthView from={r.from} to={r.to} apps={data || []} onDay={(d) => { setDay(d); setView("giorno"); }} />}
      <AppointmentDetail id={open} onClose={() => setOpen(null)} />
      {creating && <NewAppointment day={day} onClose={() => setCreating(false)} />}
    </div>
  );
}

function DayView({ day, apps, ops, onOpen }: { day: string; apps: any[]; ops: any[]; onOpen: (id: number) => void }) {
  const wd = weekdayISO(day);
  const hours = Array.from({ length: END_H - START_H + 1 }, (_, i) => START_H + i);
  const height = (END_H - START_H) * 60 * PX_PER_MIN;
  const top = (d: string) => { const { time } = romeParts(d); const [h, m] = time.split(":").map(Number); return ((h - START_H) * 60 + m) * PX_PER_MIN; };
  if (!ops.length) return <Empty>Nessun operatore attivo.</Empty>;
  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
      <div className="flex min-w-max">
        <div className="w-14 shrink-0 border-r border-slate-100 pt-10">
          <div className="relative" style={{ height }}>{hours.map((h) => <div key={h} className="absolute -translate-y-2 pl-2 text-xs text-slate-400" style={{ top: (h - START_H) * 60 * PX_PER_MIN }}>{h}:00</div>)}</div>
        </div>
        {ops.map((o) => {
          const shifts = o.shifts.filter((s: any) => s.weekday === wd);
          const mine = apps.filter((a) => a.operatorId === o.id);
          const toPx = (t: string) => { const [h, m] = t.split(":").map(Number); return ((h - START_H) * 60 + m) * PX_PER_MIN; };
          return (
            <div key={o.id} className="w-56 shrink-0 border-r border-slate-100">
              <div className="sticky top-0 flex h-10 items-center gap-2 border-b border-slate-100 px-2 text-sm font-bold"><span className="h-3 w-3 rounded-full" style={{ background: o.color }} />{o.name}</div>
              <div className="relative bg-slate-50" style={{ height }}>
                {shifts.map((s: any, i: number) => <div key={i} className="absolute inset-x-0 bg-white" style={{ top: toPx(s.startTime), height: toPx(s.endTime) - toPx(s.startTime) }} />)}
                {shifts.filter((s: any) => s.breakStart && s.breakEnd).map((s: any, i: number) => <div key={"b" + i} className="absolute inset-x-0 bg-slate-100 text-center text-[10px] text-slate-400" style={{ top: toPx(s.breakStart), height: toPx(s.breakEnd) - toPx(s.breakStart) }}>pausa</div>)}
                {hours.map((h) => <div key={h} className="absolute inset-x-0 border-t border-slate-100" style={{ top: (h - START_H) * 60 * PX_PER_MIN }} />)}
                {mine.map((a) => (
                  <button key={a.id} onClick={() => onOpen(a.id)} className="absolute inset-x-1 overflow-hidden rounded-lg p-1.5 text-left text-xs text-white shadow"
                    style={{ top: top(a.startAt), height: Math.max(22, a.durationMin * PX_PER_MIN - 2), background: STATUS_COLORS[a.status] }}>
                    <b>{romeParts(a.startAt).time}</b> {a.dogName}{a.dogAggressive ? " ⚠" : ""}<br /><span className="opacity-90">{a.serviceName} · {a.customerName}</span>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      {apps.filter((a) => !a.operatorId).length > 0 && <div className="border-t p-3 text-sm">Senza operatore: {apps.filter((a) => !a.operatorId).map((a) => <button key={a.id} className="mr-2 underline" onClick={() => onOpen(a.id)}>{a.dogName}</button>)}</div>}
    </div>
  );
}

function WeekView({ from, apps, onOpen, onDay }: { from: string; apps: any[]; onOpen: (id: number) => void; onDay: (d: string) => void }) {
  const days = Array.from({ length: 7 }, (_, i) => addDaysISO(from, i));
  return (
    <div className="grid gap-2 md:grid-cols-7">
      {days.map((d) => {
        const list = apps.filter((a) => romeParts(a.startAt).day === d);
        return (
          <div key={d} className={`min-h-[160px] rounded-2xl border bg-white p-2 ${d === todayISO() ? "border-brand-turquoise" : "border-slate-200"}`}>
            <button className="mb-2 w-full text-left text-sm font-bold text-brand-navy" onClick={() => onDay(d)}>{WEEKDAYS[weekdayISO(d)].slice(0, 3)} {d.slice(8)}/{d.slice(5, 7)} <span className="text-xs font-normal text-slate-400">({list.length})</span></button>
            <div className="space-y-1">{list.map((a) => (
              <button key={a.id} onClick={() => onOpen(a.id)} className="block w-full rounded-lg px-2 py-1 text-left text-xs" style={{ background: STATUS_COLORS[a.status] + "22", borderLeft: `3px solid ${a.operatorColor || STATUS_COLORS[a.status]}` }}>
                <b>{romeParts(a.startAt).time}</b> {a.dogName}<br /><span className="text-slate-500">{a.operatorName} · {a.serviceName}</span>
              </button>
            ))}</div>
          </div>
        );
      })}
    </div>
  );
}

function MonthView({ from, to, apps, onDay }: { from: string; to: string; apps: any[]; onDay: (d: string) => void }) {
  const lead = (weekdayISO(from) + 6) % 7;
  const days: (string | null)[] = [...Array(lead).fill(null)];
  for (let d = from; d <= to; d = addDaysISO(d, 1)) days.push(d);
  return (
    <div className="grid grid-cols-7 gap-1">
      {["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"].map((w) => <div key={w} className="p-1 text-center text-xs font-bold text-slate-500">{w}</div>)}
      {days.map((d, i) => {
        if (!d) return <div key={"e" + i} />;
        const list = apps.filter((a) => romeParts(a.startAt).day === d);
        const pending = list.filter((a) => ["richiesta", "in_valutazione"].includes(a.status)).length;
        return (
          <button key={d} onClick={() => onDay(d)} className={`min-h-[80px] rounded-xl border bg-white p-1.5 text-left text-xs ${d === todayISO() ? "border-brand-turquoise" : "border-slate-200"}`}>
            <b className="text-brand-navy">{Number(d.slice(8))}</b>
            {list.length > 0 && <p className="mt-1 font-semibold">{list.length} app.</p>}
            {pending > 0 && <p className="text-amber-600">{pending} da confermare</p>}
          </button>
        );
      })}
    </div>
  );
}

/** Inserimento manuale dal salone (telefono, WhatsApp, banco). */
export function NewAppointment({ day, onClose }: { day: string; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: me } = useMe();
  const { data: ops } = useAdminOperators();
  const { data: services } = useQuery<any[]>({ queryKey: ["admin-services"], queryFn: () => get("/api/admin/services") });
  const [q, setQ] = useState("");
  const { data: customers } = useQuery<any>({ queryKey: ["cust-search", q], queryFn: () => get(`/api/admin/customers?q=${encodeURIComponent(q)}&pageSize=10`), enabled: q.length >= 2 });
  const [cust, setCust] = useState<any>(null);
  const { data: dogs } = useQuery<any[]>({ queryKey: ["cust-dogs", cust?.id], queryFn: () => get(`/api/admin/dogs?ownerId=${cust.id}`), enabled: !!cust });
  const [f, setF] = useState<any>({ dogId: "", serviceId: "", operatorId: "", date: day, time: "", durationMin: "", finalPriceCents: null, adminNotes: "", force: false, notify: true });
  const [err, setErr] = useState<unknown>(null);
  const service = services?.find((s) => String(s.id) === String(f.serviceId));
  const dur = Number(f.durationMin) || service?.durationMin || 60;
  const slots = useQuery<any>({ queryKey: ["slots", f.operatorId, f.date, dur], enabled: !!(f.operatorId && f.date), queryFn: () => get(`/api/admin/slots?operatorId=${f.operatorId}&date=${f.date}&durationMin=${dur}`) });
  const compatibleOps = useMemo(() => (ops || []).filter((o) => o.active && (!service || o.serviceIds.includes(service.id))), [ops, service]);

  const submit = async () => {
    setErr(null);
    try {
      await post("/api/admin/appointments", { customerId: cust.id, dogId: Number(f.dogId), serviceId: Number(f.serviceId), operatorId: Number(f.operatorId), date: f.date, time: f.time, durationMin: f.durationMin ? Number(f.durationMin) : undefined, finalPriceCents: f.finalPriceCents, adminNotes: f.adminNotes || null, force: f.force || undefined, notify: f.notify });
      toast("Appuntamento inserito"); qc.invalidateQueries({ queryKey: ["agenda"] }); onClose();
    } catch (e) { setErr(e); }
  };
  return (
    <Modal open onClose={onClose} title="Nuovo appuntamento" wide>
      <div className="space-y-4">
        {!cust ? (
          <Field label="Cerca cliente (nome, telefono, email, nome del cane)">
            <input className="input" autoFocus value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="mt-2 space-y-1">{customers?.rows?.map((c: any) => <button key={c.id} className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-brand-sky" onClick={() => setCust(c)}><b>{c.lastName} {c.firstName}</b> · {c.phone} · {c.dogs || "nessun cane"}</button>)}</div>
            <p className="mt-2 text-xs text-slate-500">Cliente nuovo? Crealo prima in <a className="underline" href="/admin/clienti">Clienti</a>.</p>
          </Field>
        ) : (
          <>
            <p className="text-sm">Cliente: <b>{cust.firstName} {cust.lastName}</b> <button className="ml-2 text-brand-blue underline" onClick={() => setCust(null)}>cambia</button></p>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Cane"><select className="input" value={f.dogId} onChange={(e) => setF({ ...f, dogId: e.target.value })}><option value="">—</option>{dogs?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
              <Field label="Servizio"><select className="input" value={f.serviceId} onChange={(e) => setF({ ...f, serviceId: e.target.value, operatorId: "" })}><option value="">—</option>{services?.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
              <Field label="Operatore"><select className="input" value={f.operatorId} onChange={(e) => setF({ ...f, operatorId: e.target.value, time: "" })}><option value="">—</option>{compatibleOps.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></Field>
              <Field label="Data"><input type="date" className="input" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value, time: "" })} /></Field>
              <Field label="Ora"><input type="time" className="input" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} /></Field>
              <Field label="Durata (min)" hint={`Predefinita: ${service?.durationMin ?? "—"} min (varia con taglia/supplementi)`}><input type="number" className="input" value={f.durationMin} onChange={(e) => setF({ ...f, durationMin: e.target.value })} /></Field>
              <Field label="Prezzo"><MoneyInput value={f.finalPriceCents} onChange={(v) => setF({ ...f, finalPriceCents: v })} /></Field>
              <Field label="Note interne" className="sm:col-span-2"><input className="input" value={f.adminNotes} onChange={(e) => setF({ ...f, adminNotes: e.target.value })} /></Field>
            </div>
            {f.operatorId && f.date && (
              <div><p className="label">Orari liberi</p>
                <div className="flex flex-wrap gap-1">{(slots.data?.[f.operatorId] || []).map((t: string) => <button key={t} onClick={() => setF({ ...f, time: t })} className={`rounded-lg border px-2 py-1 text-xs font-bold ${f.time === t ? "border-brand-turquoise bg-brand-turquoise text-white" : "border-slate-200"}`}>{t}</button>)}
                  {slots.data && !(slots.data[f.operatorId] || []).length && <span className="text-sm text-slate-500">Nessuno slot libero in turno.</span>}</div>
              </div>
            )}
            <Check checked={f.notify} onChange={(v) => setF({ ...f, notify: v })} label="Invia conferma al cliente" />
            {me?.role === "admin" && <Check checked={f.force} onChange={(v) => setF({ ...f, force: v })} label="Autorizza sovrapposizione / fuori turno" />}
            <ErrorBox error={err} />
            <button className="btn-primary" disabled={!f.dogId || !f.serviceId || !f.operatorId || !f.time} onClick={submit}>Inserisci appuntamento</button>
          </>
        )}
      </div>
    </Modal>
  );
}

export function Requests() {
  const params = new URLSearchParams(window.location.search);
  const [status, setStatus] = useState("aperte");
  const [open, setOpen] = useState<number | null>(params.get("id") ? Number(params.get("id")) : null);
  const { data, isLoading } = useQuery<any[]>({ queryKey: ["requests", status], queryFn: () => get(`/api/admin/requests?status=${status}`), refetchInterval: 120_000 });
  return (
    <div>
      <PageTitle title="Richieste di prenotazione" subtitle="Nessuna richiesta diventa definitiva senza la tua conferma" />
      <Tabs value={status} onChange={setStatus} items={[{ value: "aperte", label: "Da gestire" }, { value: "confermata", label: "Confermate" }, { value: "rifiutata", label: "Rifiutate" }, { value: "annullata", label: "Annullate" }]} />
      {isLoading ? <Spinner /> : !data?.length ? <Empty>Nessuna richiesta.</Empty> : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          <table className="table-dp"><thead><tr><th>Quando</th><th>Cliente</th><th>Cane</th><th>Servizio</th><th>Operatore</th><th>Stato</th><th>Ricevuta</th></tr></thead>
            <tbody>{data.map((a) => (
              <tr key={a.id} className="cursor-pointer hover:bg-brand-sky" onClick={() => setOpen(a.id)}>
                <td className="font-bold">{fmtDateTime(a.startAt)}</td><td>{a.customerName}</td><td>{a.dogName}{a.dogAggressive ? " ⚠" : ""}</td><td>{a.serviceName}</td><td>{a.operatorName || "—"}</td>
                <td><StatusBadge status={a.status} />{a.changeRequest && <span className="badge ml-1 bg-amber-100 text-amber-800">richiesta cliente</span>}</td><td className="text-xs text-slate-500">{fmtDateTime(a.createdAt)}</td>
              </tr>
            ))}</tbody></table>
        </div>
      )}
      <AppointmentDetail id={open} onClose={() => setOpen(null)} />
    </div>
  );
}
