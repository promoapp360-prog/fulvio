// Calcolo disponibilità agenda multioperatore.
import { and, eq, gte, inArray, lte, lt, gt, isNull, isNotNull, or, ne, sql } from "drizzle-orm";
import { db } from "../db";
import {
  appointments, operatorAbsences, operatorServices, operatorShifts, operators, services, serviceVariants, serviceSupplements, servicePricingRules,
  BLOCKING_STATUSES, guestBookings, type Dog,
} from "../../shared/schema";
import { getSettings } from "./settings";
import { selectServicePricingRule } from "../../shared/service-pricing";
import { addDays, dateToRome, romeToDate, toMin, fromMin, weekdayOf } from "../time";
import { subtractInterval as subtract, shiftWindows, freeSlots, type Interval } from "../logic";

export class SlotError extends Error { status = 409; }

/** Durata e stima da listino. I supplementi non incidono mai senza conferma del salone. */
export async function quote(serviceId: number, dog?: (Pick<Dog, "size" | "coatKnots" | "coatShedding" | "aggressive"> & Partial<Pick<Dog, "species" | "coatType" | "coatLength">>) | null, tx: any = db) {
  const [svc] = await tx.select().from(services).where(eq(services.id, serviceId));
  if (!svc || !svc.active) throw new SlotError("Servizio non disponibile");
  let duration = svc.durationMin;
  let pricingType = svc.pricingType || (svc.priceFrom ? "da" : "fisso");
  let price: number | null = svc.priceCents;
  let priceMax: number | null = svc.priceMaxCents ?? null;
  let priceRuleId: number | null = null;
  let percentageBasisPoints: number | null = null;
  let hasPriceRule = false;
  const supplements: { name: string; priceCents: number; extraMin: number }[] = [];
  if (dog) {
    const rules = await tx.select().from(servicePricingRules).where(and(eq(servicePricingRules.serviceId, serviceId), eq(servicePricingRules.active, true)));
    const rule: any = selectServicePricingRule<any>(rules, dog);
    if (rule) {
      hasPriceRule = true;
      priceRuleId = rule.id ?? null; pricingType = rule.pricingType;
      if (rule.priceCents != null) price = rule.priceCents;
      if (rule.priceMaxCents != null) priceMax = rule.priceMaxCents;
      if (rule.percentageBasisPoints != null) percentageBasisPoints = rule.percentageBasisPoints;
      if (rule.durationMin != null) duration = rule.durationMin;
    }
    if (!hasPriceRule) {
      const [v] = await tx.select().from(serviceVariants).where(and(eq(serviceVariants.serviceId, serviceId), eq(serviceVariants.size, dog.size)));
      if (v) { if (v.durationMin) duration = v.durationMin; if (v.priceCents != null) price = v.priceCents; }
    }
    const sup = await tx.select().from(serviceSupplements)
      .where(and(eq(serviceSupplements.active, true), or(eq(serviceSupplements.serviceId, serviceId), isNull(serviceSupplements.serviceId))));
    for (const s of sup) {
      const applies = (s.condition === "nodi" && dog.coatKnots) || (s.condition === "muta" && dog.coatShedding) || (s.condition === "aggressivo" && dog.aggressive);
      if (applies) {
        // Proposta informativa: nessun costo/minuto viene aggiunto senza conferma esplicita dell'operatore.
        supplements.push({ name: s.name, priceCents: s.priceCents, extraMin: s.extraMin });
      }
    }
  }
  if (pricingType === "orario") {
    const settings = await getSettings();
    price = Math.round((settings.pricing?.hourlyRateCents ?? 5000) * duration / 60);
  }
  const listPriceCents = price;
  const estimatedPriceCents = pricingType === "fascia" || pricingType === "percentuale" || pricingType === "preventivo" ? null : price;
  return {
    service: svc, durationMin: duration, pricingType, priceCents: listPriceCents, priceMaxCents: priceMax,
    estimatedPriceCents, supplements, priceRuleId,
    priceSnapshot: {
      serviceId: svc.id, name: svc.name, category: svc.category, species: svc.species, pricingType,
      priceCents: listPriceCents, priceMaxCents: priceMax, percentageBasisPoints, durationMin: duration, priceRuleId,
      size: dog?.size ?? null, coatType: dog?.coatType ?? null, coatLength: dog?.coatLength ?? null,
      priceFrom: pricingType === "da", supplements: [],
    },
  };
}

/** Operatori attivi abilitati al servizio. */
export async function compatibleOperators(serviceId: number, onlineOnly: boolean, tx: any = db) {
  const rows = await tx.select({ op: operators }).from(operators)
    .innerJoin(operatorServices, eq(operatorServices.operatorId, operators.id))
    .where(and(eq(operatorServices.serviceId, serviceId), eq(operators.active, true), onlineOnly ? eq(operators.bookableOnline, true) : sql`true`))
    .orderBy(operators.sortOrder, operators.id);
  return rows.map((r: any) => r.op);
}

/** Gli operatori devono essere abilitati a ciascuno dei servizi richiesti. */
export async function compatibleOperatorsForServices(serviceIds: number[], onlineOnly = true, tx: any = db) {
  const ids = [...new Set(serviceIds)];
  if (!ids.length) return [];
  const lists = await Promise.all(ids.map((id) => compatibleOperators(id, onlineOnly, tx)));
  const allowed = new Set(lists[0].map((o: any) => o.id));
  for (const list of lists.slice(1)) {
    const current = new Set(list.map((o: any) => o.id));
    for (const id of allowed) if (!current.has(id)) allowed.delete(id);
  }
  return lists[0].filter((o: any) => allowed.has(o.id));
}


/** Finestre lavorative di un operatore in un giorno (turni – pause – assenze – chiusure). */
async function workingIntervals(operatorId: number, day: string, tx: any): Promise<Interval[]> {
  const wd = weekdayOf(day);
  const shifts = await tx.select().from(operatorShifts).where(and(eq(operatorShifts.operatorId, operatorId), eq(operatorShifts.weekday, wd)));
  let intervals: Interval[] = [];
  for (const s of shifts) {
    intervals.push(...shiftWindows(toMin(s.startTime), toMin(s.endTime), s.breakStart ? toMin(s.breakStart) : null, s.breakEnd ? toMin(s.breakEnd) : null));
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

/** Intervalli occupati (in minuti, ora di Roma) per un operatore in un giorno. */
async function busyIntervals(operatorId: number, day: string, bufferMin: number, excludeId: number | undefined, blockPending: boolean, tx: any, excludeGuestId?: number): Promise<Interval[]> {
  const from = romeToDate(day, "00:00"), to = romeToDate(addDays(day, 1), "00:00");
  const statuses = blockPending ? BLOCKING_STATUSES : ["confermata", "attesa_pagamento"];
  const rows = await tx.select().from(appointments).where(and(
    eq(appointments.operatorId, operatorId), inArray(appointments.status, statuses as (typeof appointments.$inferSelect.status)[]),
    lt(appointments.startAt, to), gt(appointments.endAt, from),
    excludeId ? ne(appointments.id, excludeId) : sql`true`,
  ));
  const guestStatuses = blockPending ? ["richiesta", "in_valutazione", "proposta", "confermata"] : ["confermata"];
  const guests = await tx.select({
    status:guestBookings.status,startAt:guestBookings.startAt,endAt:guestBookings.endAt,durationMin:guestBookings.durationMin,
    proposedStartAt:guestBookings.proposedStartAt,proposedOperatorId:guestBookings.proposedOperatorId,
  }).from(guestBookings).where(and(
    inArray(guestBookings.status, guestStatuses),
    or(
      and(sql`${guestBookings.status}<>'proposta'`,eq(guestBookings.operatorId, operatorId),lt(guestBookings.startAt,to),gt(guestBookings.endAt,from)),
      and(eq(guestBookings.status,"proposta"),eq(guestBookings.proposedOperatorId,operatorId),isNotNull(guestBookings.proposedStartAt),
        lt(guestBookings.proposedStartAt,to),sql`${guestBookings.proposedStartAt}+(${guestBookings.durationMin} * interval '1 minute')>${from}`),
    ),
    excludeGuestId ? ne(guestBookings.id, excludeGuestId) : sql`true`,
  ));
  return [...rows, ...guests].map((r: any) => {
    const guestProposal=r.status==="proposta"&&r.proposedStartAt;
    const start=guestProposal?r.proposedStartAt:r.startAt;
    const end=guestProposal?new Date(start.getTime()+r.durationMin*60_000):r.endAt;
    const s = dateToRome(start), e = dateToRome(end);
    const sm = s.day === day ? toMin(s.time) : 0;
    const em = e.day === day ? toMin(e.time) : 24 * 60;
    return [sm - bufferMin, em + bufferMin] as Interval;
  });
}

/** Slot liberi per un operatore in un giorno. */
export async function operatorSlots(operatorId: number, day: string, durationMin: number, opts: { excludeId?: number; excludeGuestId?: number; tx?: any } = {}) {
  const tx = opts.tx || db;
  const s = await getSettings();
  const grid = Math.max(5, s.booking.slotMinutes);
  const work = await workingIntervals(operatorId, day, tx);
  if (!work.length) return [];
  const busy = await busyIntervals(operatorId, day, s.booking.bufferMin, opts.excludeId, s.booking.requestBlocksSlot, tx, opts.excludeGuestId);
  return freeSlots(work, busy, durationMin, grid).map(fromMin);
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
export async function assertSlotFree(tx: any, operatorId: number, start: Date, durationMin: number, excludeId?: number, excludeGuestId?: number) {
  const { day, time } = dateToRome(start);
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${operatorId}::int, ${Number(day.replaceAll("-", "")) % 2147483647}::int)`);
  const slots = await operatorSlots(operatorId, day, durationMin, { excludeId, excludeGuestId, tx });
  // lo slot deve coincidere con l'inizio di una finestra libera (o comunque stare tutto in un intervallo libero)
  if (slots.includes(time)) return;
  const s = await getSettings();
  const work = await workingIntervals(operatorId, day, tx);
  const busy = await busyIntervals(operatorId, day, s.booking.bufferMin, excludeId, s.booking.requestBlocksSlot, tx, excludeGuestId);
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
