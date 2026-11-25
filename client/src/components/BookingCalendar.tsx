import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

function monthStart(day: string) {
  return `${day.slice(0, 7)}-01`;
}

export function shiftCalendarMonth(month: string, offset: number) {
  const [year, number] = month.split("-").map(Number);
  return new Date(Date.UTC(year, number - 1 + offset, 1)).toISOString().slice(0, 10);
}

export function calendarDays(month: string): (string | null)[] {
  const [year, number] = month.split("-").map(Number);
  const first = new Date(Date.UTC(year, number - 1, 1));
  const padding = (first.getUTCDay() + 6) % 7;
  const count = new Date(Date.UTC(year, number, 0)).getUTCDate();
  const days: (string | null)[] = Array(padding).fill(null);
  for (let day = 1; day <= count; day++) {
    days.push(`${month.slice(0, 7)}-${String(day).padStart(2, "0")}`);
  }
  while (days.length % 7) days.push(null);
  return days;
}

const fullDate = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("it-IT", {
  timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric",
});

/** Selettore pubblico: gli orari reali restano verificati dall'API dopo la scelta del giorno. */
export default function BookingCalendar({ value, min, max, onChange }: {
  value: string; min: string; max: string; onChange: (day: string) => void;
}) {
  const [month, setMonth] = useState(() => monthStart(value >= min && value <= max ? value : min));
  const visibleMonth = month < monthStart(min) ? monthStart(min) : month > monthStart(max) ? monthStart(max) : month;
  const label = new Date(`${visibleMonth}T12:00:00Z`).toLocaleDateString("it-IT", {
    timeZone: "UTC", month: "long", year: "numeric",
  });
  return <div data-testid="booking-date" className="mx-auto w-full max-w-lg">
    <div className="mb-4 flex items-center justify-between gap-2">
      <button type="button" aria-label="Mese precedente" disabled={visibleMonth <= monthStart(min)}
        onClick={() => setMonth(shiftCalendarMonth(visibleMonth, -1))}
        className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-sky-100 text-brand-navy hover:bg-brand-sky focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-blue disabled:cursor-not-allowed disabled:opacity-30">
        <ChevronLeft size={21} />
      </button>
      <p aria-live="polite" aria-atomic="true" className="text-center text-lg font-bold capitalize text-brand-navy">{label}</p>
      <button type="button" aria-label="Mese successivo" disabled={visibleMonth >= monthStart(max)}
        onClick={() => setMonth(shiftCalendarMonth(visibleMonth, 1))}
        className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-sky-100 text-brand-navy hover:bg-brand-sky focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-blue disabled:cursor-not-allowed disabled:opacity-30">
        <ChevronRight size={21} />
      </button>
    </div>
    <div role="group" aria-label={`Scegli il giorno: ${label}`}>
      <div className="mb-2 grid grid-cols-7 text-center text-xs font-semibold text-slate-500" aria-hidden="true">
        {["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"].map(day => <span key={day}>{day}</span>)}
      </div>
      <div className="grid grid-cols-7 gap-x-0.5 gap-y-1 sm:gap-2">
        {calendarDays(visibleMonth).map((day, index) => {
          if (!day) return <span key={`empty-${index}`} aria-hidden="true" />;
          const disabled = day < min || day > max;
          const selected = day === value;
          return <button key={day} type="button" disabled={disabled} aria-label={fullDate(day)}
            aria-pressed={selected} aria-current={day === min ? "date" : undefined}
            data-testid={`booking-day-${day}`} onClick={() => onChange(day)}
            className={`relative flex min-h-11 min-w-0 items-center justify-center rounded-xl text-base font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue sm:min-h-12 ${
              selected ? "bg-brand-navy text-white shadow-sm" : disabled ? "cursor-not-allowed text-slate-300" : day === min ? "bg-brand-sky text-brand-navy ring-1 ring-inset ring-brand-turquoise hover:bg-sky-100" : "text-brand-navy hover:bg-brand-sky"
            }`}>{Number(day.slice(-2))}</button>;
        })}
      </div>
    </div>
    <p className="mt-4 text-xs leading-relaxed text-slate-500">Scegli un giorno per controllare gli orari disponibili. I giorni in grigio sono fuori dal periodo prenotabile.</p>
    <p aria-live="polite" className="mt-3 rounded-xl bg-brand-sky px-3 py-3 text-sm font-semibold text-brand-navy">
      {value >= min && value <= max ? `Giorno scelto: ${fullDate(value)}` : "Tocca il giorno che preferisci"}
    </p>
  </div>;
}
