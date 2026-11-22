// Logica di calcolo pura (senza database): usata dai servizi e verificata dai test in /tests.

// ---------- intervalli e slot agenda ----------
export type Interval = [number, number]; // minuti dalla mezzanotte

export function subtractInterval(list: Interval[], cut: Interval): Interval[] {
  const out: Interval[] = [];
  for (const [a, b] of list) {
    if (cut[1] <= a || cut[0] >= b) { out.push([a, b]); continue; }
    if (cut[0] > a) out.push([a, cut[0]]);
    if (cut[1] < b) out.push([cut[1], b]);
  }
  return out;
}

/** Turno con pausa facoltativa -> finestre lavorative. */
export function shiftWindows(start: number, end: number, breakStart?: number | null, breakEnd?: number | null): Interval[] {
  if (breakStart == null || breakEnd == null) return [[start, end]];
  return subtractInterval([[start, end]], [breakStart, breakEnd]);
}

/** Slot liberi: inizi a passo di griglia dentro le finestre, senza sovrapposizioni con gli impegni. */
export function freeSlots(work: Interval[], busy: Interval[], durationMin: number, gridMin: number): number[] {
  const out: number[] = [];
  for (const [a, b] of work) {
    for (let t = a; t + durationMin <= b; t += gridMin) {
      if (busy.some(([x, y]) => t < y && t + durationMin > x)) continue;
      out.push(t);
    }
  }
  return out;
}

export const overlaps = (a: Interval, b: Interval) => a[0] < b[1] && b[0] < a[1];

// ---------- ore lavorate (punto 14) ----------
export type Rounding = "vicino" | "difetto" | "eccesso";

/** Arrotonda i minuti al quarto d'ora (o al passo indicato). */
export function roundMinutes(raw: number, step = 15, mode: Rounding = "vicino") {
  if (raw <= 0) return 0;
  const q = raw / step;
  const n = mode === "difetto" ? Math.floor(q) : mode === "eccesso" ? Math.ceil(q) : Math.round(q);
  return n * step;
}

/** Compenso in centesimi: minuti * tariffa oraria / 60, arrotondato al centesimo. */
export const workAmountCents = (minutes: number, hourlyRateCents: number) => Math.round((minutes * hourlyRateCents) / 60);

export function toMinutes(hhmm: string) { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; }

/** Minuti effettivi grezzi (entrata/uscita/pausa). Supporta solo turni nello stesso giorno. */
export function rawWorkedMinutes(clockIn: string, clockOut: string | null | undefined, breakMin: number) {
  if (!clockOut) return 0;
  const m = toMinutes(clockOut) - toMinutes(clockIn) - breakMin;
  if (m < 0) throw new Error("L'uscita deve essere successiva all'entrata (al netto delle pause)");
  return m;
}

/** Settimana di liquidazione che termina nel giorno di paga (default sabato = 6) e contiene il giorno dato. */
export function settlementWeek(day: string, payWeekday = 6) {
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const diff = (payWeekday - date.getUTCDay() + 7) % 7;
  const end = new Date(date.getTime() + diff * 86400_000);
  const start = new Date(end.getTime() - 6 * 86400_000);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

// ---------- fidelity (punto 16) ----------
export type ExpiryRule = { mode: "nessuna" | "annuale" | "fissa" | "periodo"; fixedDate?: string; days?: number };

/** Scadenza dei punti accumulati in una certa data. fixedDate = "MM-DD" (es. "12-31"). */
export function pointsExpiry(accruedAt: Date, rule: ExpiryRule): Date | null {
  switch (rule.mode) {
    case "annuale": { const d = new Date(accruedAt); d.setUTCFullYear(d.getUTCFullYear() + 1); return d; }
    case "periodo": return new Date(accruedAt.getTime() + Math.max(1, rule.days || 365) * 86400_000);
    case "fissa": {
      const [mm, dd] = (rule.fixedDate || "12-31").split("-").map(Number);
      let y = accruedAt.getUTCFullYear();
      let d = new Date(Date.UTC(y, mm - 1, dd, 22, 59, 59)); // fine giornata ora italiana (circa)
      if (d.getTime() <= accruedAt.getTime()) { y++; d = new Date(Date.UTC(y, mm - 1, dd, 22, 59, 59)); }
      return d;
    }
    default: return null;
  }
}

/** Punti maturati per un importo. pointsPerEuro e bonusPerEuro possono essere decimali. */
export function pointsFor(amountCents: number, pointsPerEuro: number, bonusPerEuro = 0) {
  if (amountCents <= 0) return 0;
  return Math.floor((amountCents / 100) * (pointsPerEuro + bonusPerEuro) + 1e-9);
}

export type Lot = { id: number; remaining: number; expiresAt: Date | null; createdAt: Date };

/** Consumo FIFO dei lotti di punti: prima quelli in scadenza prima. */
export function consumeLots(lots: Lot[], points: number) {
  const sorted = [...lots].filter((l) => l.remaining > 0).sort((a, b) =>
    (a.expiresAt?.getTime() ?? Infinity) - (b.expiresAt?.getTime() ?? Infinity) || a.createdAt.getTime() - b.createdAt.getTime());
  const allocations: { id: number; take: number }[] = [];
  let left = points;
  for (const l of sorted) {
    if (left <= 0) break;
    const take = Math.min(l.remaining, left);
    allocations.push({ id: l.id, take }); left -= take;
  }
  if (left > 0) throw new Error("Punti insufficienti");
  return allocations;
}

/** Punti da stornare per un rimborso parziale, in proporzione e senza superare quanto rimasto stornabile. */
export function pointsToReverse(earned: number, alreadyReversed: number, refundCents: number, paidCents: number) {
  if (earned <= 0 || refundCents <= 0) return 0;
  const proportional = paidCents > 0 ? Math.ceil((earned * Math.min(refundCents, paidCents)) / paidCents) : earned;
  return Math.max(0, Math.min(proportional, earned - alreadyReversed));
}

// ---------- cancellazioni (punto 23) ----------
export function hoursUntil(start: Date, now = new Date()) { return (start.getTime() - now.getTime()) / 3600_000; }
export const withinDeadline = (start: Date, hours: number, now = new Date()) => hoursUntil(start, now) >= hours;

// ---------- shop: consegne (punto 17) ----------
export type DeliveryZone = { name: string; caps: string[]; costCents: number; freeFromCents?: number | null; eta?: string; active?: boolean };

export function deliveryQuote(zones: DeliveryZone[], cap: string, subtotalCents: number) {
  const z = zones.find((x) => x.active !== false && x.caps.map((c) => c.trim()).includes(cap.trim()));
  if (!z) return null;
  const free = z.freeFromCents != null && z.freeFromCents > 0 && subtotalCents >= z.freeFromCents;
  return { zone: z.name, costCents: free ? 0 : z.costCents, eta: z.eta || null };
}

// ---------- CRM ----------
export const normalizePhone = (p?: string | null) => {
  const d = (p || "").replace(/\D/g, "");
  return d.startsWith("0039") ? d.slice(4) : d.startsWith("39") && d.length > 10 ? d.slice(2) : d;
};

/** Frequenza media (giorni) tra visite ordinate. */
export function averageGapDays(dates: Date[]) {
  if (dates.length < 2) return null;
  const s = [...dates].sort((a, b) => a.getTime() - b.getTime());
  let tot = 0; for (let i = 1; i < s.length; i++) tot += s[i].getTime() - s[i - 1].getTime();
  return Math.round(tot / (s.length - 1) / 86400_000);
}

// ---------- CSV ----------
export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^﻿/, "");
  const first = clean.split(/\r?\n/)[0] || "";
  const sep = (first.match(/;/g) || []).length >= (first.match(/,/g) || []).length ? ";" : ",";
  const out: string[][] = []; let row: string[] = []; let cur = ""; let q = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (q) { if (c === '"' && clean[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; continue; }
    if (c === '"') q = true;
    else if (c === sep) { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && clean[i + 1] === "\n") i++;
      row.push(cur); cur = ""; if (row.some((x) => x.trim())) out.push(row); row = [];
    } else cur += c;
  }
  row.push(cur); if (row.some((x) => x.trim())) out.push(row);
  return out;
}

export const truthy = (v?: string) => /^(1|si|sì|s|yes|y|true|x|vero)$/i.test((v || "").trim());

/** Sostituisce {{segnaposto}} nei template email (valori già sanificati dal chiamante). */
export function renderTemplate(tpl: string, vars: Record<string, string | number | null | undefined>) {
  return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => (vars[k] == null ? "" : String(vars[k])));
}
