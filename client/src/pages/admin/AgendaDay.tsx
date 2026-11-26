import { useLayoutEffect, useRef, useState } from "react";
import { Empty } from "@/components/ui";
import { romeParts, weekdayISO } from "@/lib/format";
import { STATUS_COLORS, STATUS_LABELS } from "@shared/constants";
import { isPendingRequest, layoutAgenda, planningStart, requestColor } from "@shared/agenda-planning";

const minuteOf = (time: string) => { const [h, m] = time.split(":").map(Number); return h * 60 + m; };

export default function AgendaDay({ day, apps, ops, onOpen }: { day: string; apps: any[]; ops: any[]; onOpen: (id: number) => void }) {
  const root = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(480);
  useLayoutEffect(() => {
    const resize = () => setHeight(Math.max(360, Math.min(640, window.innerHeight - (root.current?.getBoundingClientRect().top || 240) - 64)));
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [day, ops.length]);

  const wd = weekdayISO(day);
  const items = apps.map(a => ({ ...a, minute: minuteOf(romeParts(planningStart(a)).time) }));
  const shifts = ops.flatMap(o => o.shifts.filter((s: any) => s.weekday === wd));
  const start = Math.max(0, Math.floor(Math.min(480, ...items.map(a => a.minute), ...shifts.map((s: any) => minuteOf(s.startTime))) / 60) * 60);
  const end = Math.min(1440, Math.ceil(Math.max(1200, ...items.map(a => a.minute + a.durationMin), ...shifts.map((s: any) => minuteOf(s.endTime))) / 60) * 60);
  const scale = height / (end - start);
  const hours = Array.from({ length: (end - start) / 60 + 1 }, (_, i) => start + i * 60);
  const requests = items.filter(a => isPendingRequest(a.status) || !a.operatorId);
  const columns = [
    ...(requests.length ? [{ id: "requests", name: `Da confermare (${requests.length})`, color: requestColor, rows: requests, shifts: [] as any[] }] : []),
    ...ops.map(o => ({ id: String(o.id), name: o.name, color: o.color, rows: items.filter(a => !isPendingRequest(a.status) && a.operatorId === o.id), shifts: o.shifts.filter((s: any) => s.weekday === wd) })),
  ];
  if (!columns.length) return <Empty>Nessun operatore attivo e nessuna richiesta nel giorno selezionato.</Empty>;
  return <div ref={root} className="max-w-full overflow-x-auto overflow-y-hidden rounded-2xl border border-slate-200 bg-white" data-testid="agenda-planning" aria-label="Planning della giornata">
    <div className="flex min-w-max">
      <div className="sticky left-0 z-10 w-14 shrink-0 border-r border-slate-200 bg-white">
        <div className="h-12 border-b px-1 pt-4 text-center text-[11px] font-bold text-slate-500">Ora</div>
        <div className="relative" style={{ height }}>{hours.map((m, i) => <span key={m} className="absolute left-1 text-[11px] font-semibold text-slate-500"
          style={{ top: Math.min(height - 14, Math.max(0, (m - start) * scale - (i ? 7 : 0))) }}>{String(m / 60).padStart(2, "0")}:00</span>)}</div>
      </div>
      {columns.map(column => {
        const { cards, lanes } = layoutAgenda(column.rows, start, end, height);
        const toPx = (time: string) => Math.max(0, Math.min(height, (minuteOf(time) - start) * scale));
        return <div key={column.id} className="min-w-52 flex-1 border-r border-slate-200" style={{ width: Math.max(208, lanes * 170) }}>
          <h3 className={`flex h-12 items-center gap-2 border-b px-3 text-sm font-bold ${column.id === "requests" ? "bg-orange-50 text-orange-900" : "text-brand-navy"}`}>
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: column.color }} />{column.name}
          </h3>
          <div className={`relative ${column.id === "requests" ? "bg-orange-50/30" : "bg-slate-100"}`} style={{ height }}>
            {column.shifts.map((s: any, i: number) => <div key={i} className="absolute inset-x-0 bg-white" style={{ top: toPx(s.startTime), height: Math.max(0, toPx(s.endTime) - toPx(s.startTime)) }} />)}
            {column.shifts.filter((s: any) => s.breakStart && s.breakEnd).map((s: any, i: number) => <div key={`break-${i}`} className="absolute inset-x-0 bg-slate-100 text-center text-[10px] text-slate-500" style={{ top: toPx(s.breakStart), height: Math.max(0, toPx(s.breakEnd) - toPx(s.breakStart)) }}>pausa</div>)}
            {hours.map(m => <div key={m} className="pointer-events-none absolute inset-x-0 border-t border-slate-200/70" style={{ top: (m - start) * scale }} />)}
            {cards.map(a => <button key={a.id} type="button" data-appointment-id={a.id} onClick={() => onOpen(a.id)}
              aria-label={`${romeParts(planningStart(a)).time} ${a.dogName}, ${STATUS_LABELS[a.status]}. Apri per confermare o modificare la data`}
              title={`${a.customerName} · ${a.serviceName} · ${a.durationMin} min${isPendingRequest(a.status) ? " · In attesa di conferma" : ""}`}
              className="absolute overflow-hidden rounded-lg px-2 py-1 text-left text-xs text-white shadow-sm ring-inset focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-navy"
              style={{ top: a.top, height: a.height, left: `calc(${a.lane * 100 / lanes}% + 3px)`, width: `calc(${100 / lanes}% - 6px)`, background: isPendingRequest(a.status) ? requestColor : STATUS_COLORS[a.status] }}>
              <span className="block truncate font-bold">{romeParts(planningStart(a)).time} · {a.dogName}{a.dogAggressive ? " ⚠" : ""}</span>
              <span className="block truncate">{isPendingRequest(a.status) ? (a.status === "proposta" ? "Nuovo orario proposto" : "Richiesta da confermare") : a.serviceName}</span>
              {a.height >= 60 && <span className="block truncate opacity-90">{a.customerName} · {a.durationMin} min</span>}
            </button>)}
          </div>
        </div>;
      })}
    </div>
  </div>;
}
