export { euro } from "@shared/constants";

const TZ = "Europe/Rome";
export const fmtDate = (d?: string | Date | null) => (d ? new Date(d).toLocaleDateString("it-IT", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" }) : "—");
export const fmtDay = (iso?: string | null) => (iso ? iso.split("-").reverse().join("/") : "—");
export const fmtTime = (d: string | Date) => new Date(d).toLocaleTimeString("it-IT", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
export const fmtDateTime = (d?: string | Date | null) => (d ? new Date(d).toLocaleString("it-IT", { timeZone: TZ, weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
export const fmtLong = (d: string | Date) => new Date(d).toLocaleString("it-IT", { timeZone: TZ, weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

/** Data odierna (Roma) in formato AAAA-MM-GG */
export function todayISO() {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return p;
}
export function addDaysISO(day: string, n: number) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
export const weekdayISO = (day: string) => { const [y, m, d] = day.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };
/** Data/ora ISO -> { day, time } in ora di Roma */
export function romeParts(d: string | Date) {
  const s = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(d));
  const [day, time] = s.split(", ");
  return { day, time };
}
export const centsToInput = (c?: number | null) => (c == null ? "" : (c / 100).toFixed(2).replace(".", ","));
export const inputToCents = (v: string) => { const t = v.replace(/\./g, "").replace(",", ".").trim(); if (!t) return null; const n = Math.round(parseFloat(t) * 100); return isNaN(n) ? null : n; };
export const mins = (m: number) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
