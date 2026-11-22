// Calcolo disponibilità agenda multioperatore.
import { and, eq, gte, inArray, lte, lt, gt, isNull, or, ne, sql } from "drizzle-orm";
import { db } from "../db";
import {
  appointments, operatorAbsences, operatorServices, operatorShifts, operators, services, serviceVariants, serviceSupplements,
  BLOCKING_STATUSES, type Dog,
} from "../../shared/schema";
import { getSettings } from "./settings";
import { addDays, dateToRome, romeToDate, toMin, fromMin, weekdayOf } from "../time";

export class SlotError extends Error { status = 409; }

/** Durata e prezzo stimato di un servizio per un cane (varianti per taglia + supplementi automatici). */
export async function quote(serviceId: number, dog?: Pick<Dog, "size" | "coatKnots" | "coatShedding" | "aggressive"> | null, tx: any = db) {
  const [svc] = await tx.select().from(services).where(eq(services.id, serviceId));
  if (!svc || !svc.active) throw new SlotError("Servizio non disponibile");
  let duration = svc.durationMin; let price: number | null = svc.priceCents;
  const supplements: { name: string; priceCents: number; extraMin: number }[] = [];
  if (dog) {
    const [v] = await tx.select().from(serviceVariants).where(and(eq(serviceVariants.serviceId, serviceId), eq(serviceVariants.size, dog.size)));
    if (v) { if (v.durationMin) duration = v.durationMin; if (v.priceCents != null) price = v.priceCents; }
    const sup = await tx.select().from(serviceSupplements)
      .where(and(eq(serviceSupplements.active, true), or(eq(serviceSupplements.serviceId, serviceId), isNull(serviceSupplements.serviceId))));
    for (const s of sup) {
      const applies = (s.condition === "nodi" && dog.coatKnots) || (s.condition === "muta" && dog.coatShedding) || (s.condition === "aggressivo" && dog.aggressive);
      if (applies) {
        supplements.push({ name: s.name, priceCents: s.priceCents, extraMin: s.extraMin });
        duration += s.extraMin; if (price != null) price += s.priceCents;
      }
    }
  }
  return { service: svc, durationMin: duration, estimatedPriceCents: price, supplements };
}

/** Operatori attivi abilitati al servizio. */
export async function compatibleOperators(serviceId: number, onlineOnly: boolean, tx: any = db) {
  const rows = await tx.select({ op: operators }).from(operators)
    .innerJoin(operatorServices, eq(operatorServices.operatorId, operators.id))
    .where(and(eq(operatorServices.serviceId, serviceId), eq(operators.active, true), onlineOnly ? eq(operators.bookableOnline, true) : sql`true`))
    .orderBy(operators.sortOrder, operators.id);
  return rows.map((r: any) => r.op);
}

type Interval = [number, number]; // minuti dalla mezzanotte

/** Finestre lavorative di un operatore in un giorno (turni – pause – assenze – chiusure). */
async function workingIntervals(operatorId: number, day: string, tx: any): Promise<Interval[]> {
  const wd = weekdayOf(day);
  const shifts = await tx.select().from(operatorShifts).where(and(eq(operatorShifts.operatorId, operatorId), eq(operatorShifts.weekday, wd)));
  let intervals: Interval[] = [];
  for (const s of shifts) {
    const a = toMin(s.startTime), b = toMin(s.endTime);
    if (s.breakStart && s.breakEnd) {
      const bs = toMin(s.breakStart), be = toMin(s.breakEnd);
      if (bs > a) intervals.push([a, Math.min(bs, b)]);
      if (be < b) intervals.push([Math.max(be, a), b]);
    } else intervals.push([a, b]);
  }
  const absences = await tx.select().from(operatorAbsences).where(and(
    lte(operatorAbsences.startDate, day), gte(operatorAbsences.endDate, day),
    or(eq(operatorAbsences.operatorId, operatorId), isNull(operatorAbsences.operatorId)),
  ));
  for (const ab of absences) {
    if (!ab.startTime || !ab.endTime) return [];
    intervals = subtract(intervals, [toMin(ab.startTime), toMin(ab.endTime)]);
  }
  return intervals;
}

function subtract(list: Interval[], cut: Interval): Interval[] {
  const out: Interval[] = [];
  for (const [a, b] of list) {
    if (cut[1] <= a || cut[0] >= b) { out.push([a, b]); continue; }
    if (cut[0] > a) out.push([a, cut[0]]);
    if (cut[1] < b) out.push([cut[1], b]);
  }
  return out;
}

/** Intervalli occupati (in minuti, ora di Roma) per un operatore in un giorno. */
async function busyIntervals(operatorId: number, day: string, bufferMin: number, excludeId: number | undefined, blockPending: boolean, tx: any): Promise<Interval[]> {
  const from = romeToDate(day, "00:00"), to = romeToDate(addDays(day, 1), "00:00");
  const statuses = blockPending ? BLOCKING_STATUSES : ["confermata", "attesa_pagamento"];
  const rows = await tx.select().from(appointments).where(and(
    eq(appointments.operatorId, operatorId), inArray(appointments.status, statuses as string[]),
    lt(appointments.startAt, to), gt(appointments.endAt, from),
    excludeId ? ne(appointments.id, excludeId) : sql`true`,
  ));
  return rows.map((r: any) => {
    const s = dateToRome(r.startAt), e = dateToRome(r.endAt);
    const sm = s.day === day ? toMin(s.time) : 0;
    const em = e.day === day ? toMin(e.time) : 24 * 60;
    return [sm - bufferMin, em + bufferMin] as Interval;
  });
}

/** Slot liberi per un operatore in un giorno. */
export async function operatorSlots(operatorId: number, day: string, durationMin: number, opts: { excludeId?: number; tx?: any } = {}) {
  const tx = opts.tx || db;
  const s = await getSettings();
  const grid = Math.max(5, s.booking.slotMinutes);
  const work = await workingIntervals(operatorId, day, tx);
  if (!work.length) return [];
  const busy = await busyIntervals(operatorId, day, s.booking.bufferMin, opts.excludeId, s.booking.requestBlocksSlot, tx);
  const slots: string[] = [];
  for (const [a, b] of work) {
    for (let t = a; t + durationMin <= b; t += grid) {
      if (busy.some(([x, y]) => t < y && t + durationMin > x)) continue;
      slots.push(fromMin(t));
    }
  }
  return slots;
}

/** Disponibilità pubblica: { "09:00": [operatorIds...] } con preavviso minimo e finestra massima. */
export async function availability(serviceId: number, day: string, durationMin: number, operatorId?: number | null, onlineOnly = true) {
  const s = await getSettings();
  const ops = (await compatibleOperators(serviceId, onlineOnly)).filter((o: any) => !operatorId || o.id === operatorId);
  const earliest = Date.now() + s.booking.minNoticeHours * 3600_000;
  const latestDay = addDays(dateToRome(new Date()).day, s.booking.maxDaysAhead);
  if (day > latestDay) return {};
  const map: Record<string, number[]> = {};
  for (const op of ops) {
    for (const t of await operatorSlots(op.id, day, durationMin)) {
      if (onlineOnly && romeToDate(day, t).getTime() < earliest) continue;
      (map[t] ||= []).push(op.id);
    }
  }
  return Object.fromEntries(Object.entries(map).sort(([a], [b]) => a.localeCompare(b)));
}

/**
 * Verifica (dentro una transazione con lock) che lo slot sia ancora libero e compatibile con i turni.
 * Il lock advisory per operatore+giorno serializza le richieste contemporanee sullo stesso slot.
 */
export async function assertSlotFree(tx: any, operatorId: number, start: Date, durationMin: number, excludeId?: number) {
  const { day, time } = dateToRome(start);
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${operatorId}::int, ${Number(day.replaceAll("-", "")) % 2147483647}::int)`);
  const slots = await operatorSlots(operatorId, day, durationMin, { excludeId, tx });
  // lo slot deve coincidere con l'inizio di una finestra libera (o comunque stare tutto in un intervallo libero)
  if (slots.includes(time)) return;
  const s = await getSettings();
  const work = await workingIntervals(operatorId, day, tx);
  const busy = await busyIntervals(operatorId, day, s.booking.bufferMin, excludeId, s.booking.requestBlocksSlot, tx);
  const t = toMin(time);
  const inShift = work.some(([a, b]) => t >= a && t + durationMin <= b);
  const overlaps = busy.some(([x, y]) => t < y && t + durationMin > x);
  if (!inShift) throw new SlotError("L'orario non rientra nel turno dell'operatore");
  if (overlaps) throw new SlotError("Lo slot è appena stato occupato: scegli un altro orario");
}

export async function operatorCanDo(operatorId: number, serviceId: number, tx: any = db) {
  const [r] = await tx.select().from(operatorServices).where(and(eq(operatorServices.operatorId, operatorId), eq(operatorServices.serviceId, serviceId)));
  return !!r;
}
