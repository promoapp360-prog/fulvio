// Fidelity Card completa (punto 16): accumulo con regole, utilizzo FIFO, scadenze, proroghe, rettifiche e storni.
import crypto from "node:crypto";
import { and, asc, eq, gt, isNotNull, lte, sql, inArray } from "drizzle-orm";
import { db } from "../db";
import { loyaltyCards, loyaltyTransactions, promotions } from "../../shared/schema";
import { getSettings } from "./settings";
import { addCalendarMonths, pointsExpiry, pointsFor, consumeLots, pointsToReverse } from "../logic";
import { HttpError } from "../util";
import { todayRome } from "../time";

type Ref = { appointmentId?: number | null; orderId?: number | null; paymentId?: number | null; createdBy?: number | null };

export async function ensureCard(customerId: number, tx: any = db, grantWelcome = false) {
  const [existing] = await tx.select().from(loyaltyCards).where(eq(loyaltyCards.customerId, customerId));
  if (existing) return existing;
  const code = "DP" + crypto.randomInt(10_000_000, 99_999_999).toString();
  const [card] = await tx.insert(loyaltyCards).values({ customerId, code }).onConflictDoNothing().returning();
  if (!card) { const [c] = await tx.select().from(loyaltyCards).where(eq(loyaltyCards.customerId, customerId)); return c; }
  const s = await getSettings();
  if (grantWelcome && s.loyalty.enabled && s.loyalty.welcomePoints > 0) await accrue(card.id, s.loyalty.welcomePoints, "Benvenuto in Dog's Planet", {}, tx);
  return card;
}

async function lockCard(tx: any, cardId: number) {
  const [c] = await tx.select().from(loyaltyCards).where(eq(loyaltyCards.id, cardId)).for("update");
  if (!c) throw new HttpError(404, "Tessera non trovata");
  return c;
}
const bump = (tx: any, cardId: number, delta: number) => tx.update(loyaltyCards).set({ points: sql`${loyaltyCards.points} + ${delta}` }).where(eq(loyaltyCards.id, cardId));

async function cardExpiry(cardId: number, tx: any) {
  const [card] = await tx.select().from(loyaltyCards).where(eq(loyaltyCards.id, cardId));
  if (!card || !card.active || card.mergedIntoCardId) throw new HttpError(400, "Tessera non attiva");
  if (card.expiryMonths != null) return card.expiryMonths === 0 ? null : addCalendarMonths(new Date(), card.expiryMonths);
  const s = await getSettings();
  return pointsExpiry(new Date(), { mode: s.loyalty.expiryMode, fixedDate: s.loyalty.expiryFixedDate, days: s.loyalty.expiryDays });
}

/** Accumulo: crea un lotto con scadenza secondo le regole. Idempotente per appuntamento/ordine (indice unico). */
export async function accrue(cardId: number, points: number, reason: string, ref: Ref = {}, tx: any = db, expiresAt?: Date | null) {
  if (points <= 0) return false;
  const exp = expiresAt !== undefined ? expiresAt : await cardExpiry(cardId, tx);
  const ins = await tx.insert(loyaltyTransactions).values({ cardId, points, remaining: points, kind: "accumulo", reason, expiresAt: exp, ...ref }).onConflictDoNothing().returning();
  if (!ins.length) return false;
  await bump(tx, cardId, points);
  return true;
}

/** Punti extra per promozioni attive di tipo "punti" (valore = punti extra per euro). */
async function bonusPerEuro(target: "servizi" | "shop", tx: any) {
  const today = todayRome();
  const rows = await tx.select().from(promotions).where(and(eq(promotions.active, true), eq(promotions.discountType, "points"),
    sql`(${promotions.appliesTo} = 'tutto' OR ${promotions.appliesTo} = ${target})`,
    sql`(${promotions.startsAt} IS NULL OR ${promotions.startsAt} <= ${today})`, sql`(${promotions.endsAt} IS NULL OR ${promotions.endsAt} >= ${today})`));
  return rows.reduce((a: number, p: any) => a + p.discountValue, 0);
}

/** Accredito per un importo pagato (servizio o ordine), secondo le regole e le promozioni a punti. */
export async function awardForAmount(customerId: number, amountCents: number, reason: string, ref: Ref & { target?: "servizi" | "shop" }, tx: any = db) {
  const s = await getSettings();
  if (!s.loyalty.enabled || amountCents <= 0) return 0;
  if (ref.target === "servizi" && !s.loyalty.earnOnServices) return 0;
  if (ref.target === "shop" && !s.loyalty.earnOnProducts) return 0;
  const card = await ensureCard(customerId, tx);
  const pts = pointsFor(amountCents, s.loyalty.pointsPerEuro, await bonusPerEuro(ref.target || "servizi", tx));
  const { target, ...r } = ref;
  return (await accrue(card.id, pts, reason, r, tx)) ? pts : 0;
}

/** Utilizzo punti (sconto servizi/prodotti, credito shop, premio): consuma i lotti in scadenza per primi. */
export async function redeem(cardId: number, points: number, reason: string, ref: Ref & { valueCents?: number | null } = {}, tx: any = db) {
  if (points <= 0) throw new HttpError(400, "Numero di punti non valido");
  const card = await lockCard(tx, cardId);
  if (!card.active || card.mergedIntoCardId) throw new HttpError(400, "Tessera non attiva");
  if (card.points < points) throw new HttpError(400, `Punti insufficienti (disponibili ${card.points})`);
  const lots = await tx.select().from(loyaltyTransactions).where(and(eq(loyaltyTransactions.cardId, cardId), gt(loyaltyTransactions.remaining, 0)));
  let alloc;
  try { alloc = consumeLots(lots.map((l: any) => ({ id: l.id, remaining: l.remaining, expiresAt: l.expiresAt, createdAt: l.createdAt })), points); }
  catch { throw new HttpError(400, "Punti non disponibili (verifica eventuali punti scaduti o rettifiche)"); }
  for (const a of alloc) await tx.update(loyaltyTransactions).set({ remaining: sql`${loyaltyTransactions.remaining} - ${a.take}` }).where(eq(loyaltyTransactions.id, a.id));
  const { valueCents, ...r } = ref;
  const [t] = await tx.insert(loyaltyTransactions).values({ cardId, points: -points, kind: "utilizzo", reason, valueCents: valueCents ?? null, ...r }).returning();
  await bump(tx, cardId, -points);
  return t;
}

/** Rettifica manuale motivata (+/-). In negativo consuma i lotti come un utilizzo. */
export async function adjust(cardId: number, points: number, reason: string, createdBy: number, tx: any = db) {
  if (!reason || reason.trim().length < 3) throw new HttpError(400, "Indica il motivo della rettifica");
  const current = await lockCard(tx, cardId);
  if (!current.active || current.mergedIntoCardId) throw new HttpError(400, "Tessera non attiva");
  if (points > 0) {
    const exp = await cardExpiry(cardId, tx);
    await tx.insert(loyaltyTransactions).values({ cardId, points, remaining: points, kind: "rettifica", reason, expiresAt: exp, createdBy });
    await bump(tx, cardId, points);
  } else {
    const t = await redeem(cardId, -points, reason, { createdBy }, tx);
    await tx.update(loyaltyTransactions).set({ kind: "rettifica" }).where(eq(loyaltyTransactions.id, t.id));
  }
}

/**
 * Storno dei punti accreditati per un appuntamento o ordine rimborsato/annullato.
 * refundCents/paidCents permettono lo storno proporzionale di un rimborso parziale.
 */
export async function reverseFor(ref: { appointmentId?: number; orderId?: number }, refundCents: number, paidCents: number, reason: string, createdBy: number | null, tx: any = db) {
  const col = ref.appointmentId ? loyaltyTransactions.appointmentId : loyaltyTransactions.orderId;
  const id = ref.appointmentId ?? ref.orderId!;
  const [earned] = await tx.select().from(loyaltyTransactions).where(and(eq(col, id), eq(loyaltyTransactions.kind, "accumulo")));
  if (!earned) return 0;
  const [{ rev }] = await tx.select({ rev: sql<number>`coalesce(-sum(${loyaltyTransactions.points}), 0)::int` }).from(loyaltyTransactions)
    .where(and(eq(col, id), eq(loyaltyTransactions.kind, "storno"), sql`${loyaltyTransactions.points} < 0`));
  const pts = pointsToReverse(earned.points, rev, refundCents, paidCents);
  if (!pts) return 0;
  const card = await lockCard(tx, earned.cardId);
  const take = Math.min(pts, card.points); // non si va mai sotto zero: i punti già spesi restano spesi
  if (take <= 0) return 0;
  // toglie prima dal lotto originario, poi dagli altri
  const fromOrig = Math.min(take, earned.remaining);
  if (fromOrig > 0) await tx.update(loyaltyTransactions).set({ remaining: sql`${loyaltyTransactions.remaining} - ${fromOrig}` }).where(eq(loyaltyTransactions.id, earned.id));
  if (take > fromOrig) {
    const lots = await tx.select().from(loyaltyTransactions).where(and(eq(loyaltyTransactions.cardId, card.id), gt(loyaltyTransactions.remaining, 0)));
    for (const a of consumeLots(lots.map((l: any) => ({ id: l.id, remaining: l.remaining, expiresAt: l.expiresAt, createdAt: l.createdAt })), take - fromOrig)) {
      await tx.update(loyaltyTransactions).set({ remaining: sql`${loyaltyTransactions.remaining} - ${a.take}` }).where(eq(loyaltyTransactions.id, a.id));
    }
  }
  await tx.insert(loyaltyTransactions).values({ cardId: card.id, points: -take, kind: "storno", reason, relatedTxId: earned.id, createdBy, ...(ref.appointmentId ? { appointmentId: id } : { orderId: id }) });
  await bump(tx, card.id, -take);
  return take;
}

/** Restituisce i punti usati su un ordine annullato (storno positivo dell'utilizzo). */
export async function refundRedemption(orderId: number, reason: string, createdBy: number | null, tx: any = db) {
  const used = await tx.select().from(loyaltyTransactions).where(and(eq(loyaltyTransactions.orderId, orderId), eq(loyaltyTransactions.kind, "utilizzo")));
  let total = 0;
  for (const u of used) {
    const [done] = await tx.select().from(loyaltyTransactions).where(and(eq(loyaltyTransactions.relatedTxId, u.id), eq(loyaltyTransactions.kind, "storno")));
    if (done) continue;
    const pts = -u.points;
    await tx.insert(loyaltyTransactions).values({ cardId: u.cardId, points: pts, remaining: pts, kind: "storno", reason, relatedTxId: u.id, orderId, createdBy, expiresAt: null });
    await bump(tx, u.cardId, pts);
    total += pts;
  }
  return total;
}

/** Proroga manuale: sposta la scadenza dei lotti ancora disponibili (di una tessera o di un lotto). */
export async function extendExpiry(cardId: number, newDate: Date, reason: string, createdBy: number, lotId?: number) {
  return db.transaction(async (tx) => {
    const card = await lockCard(tx, cardId);
    if (!card.active || card.mergedIntoCardId) throw new HttpError(409, "Tessera associata: riapri la scheda principale");
    const where = and(eq(loyaltyTransactions.cardId, cardId), gt(loyaltyTransactions.remaining, 0), isNotNull(loyaltyTransactions.expiresAt), lotId ? eq(loyaltyTransactions.id, lotId) : undefined);
    const lots = await tx.update(loyaltyTransactions).set({ expiresAt: newDate }).where(where).returning({ id: loyaltyTransactions.id });
    await tx.insert(loyaltyTransactions).values({ cardId, points: 0, kind: "proroga", reason: `${reason} (nuova scadenza ${newDate.toISOString().slice(0, 10)})`, createdBy });
    return lots.length;
  });
}

/** Job: scadenza dei lotti con data superata. Idempotente (remaining azzerato nella stessa transazione). */
export async function expirePoints() {
  const due = await db.select().from(loyaltyTransactions).where(and(gt(loyaltyTransactions.remaining, 0), isNotNull(loyaltyTransactions.expiresAt), lte(loyaltyTransactions.expiresAt, new Date()))).limit(500);
  let n = 0;
  for (const lot of due) {
    await db.transaction(async (tx) => {
      const card = await lockCard(tx, lot.cardId);
      const [fresh] = await tx.select().from(loyaltyTransactions).where(eq(loyaltyTransactions.id, lot.id));
      if (fresh?.cardId !== card.id) return; // a concurrent verified claim moved the lot; retry on next job
      if (!fresh || fresh.remaining <= 0 || !fresh.expiresAt || fresh.expiresAt > new Date()) return;
      const pts = Math.min(fresh.remaining, card.points);
      await tx.update(loyaltyTransactions).set({ remaining: 0 }).where(eq(loyaltyTransactions.id, lot.id));
      if (pts > 0) {
        await tx.insert(loyaltyTransactions).values({ cardId: card.id, points: -pts, kind: "scadenza", reason: "Punti scaduti", relatedTxId: lot.id });
        await bump(tx, card.id, -pts);
        n += pts;
      }
    });
  }
  return n;
}

/** Prossime scadenze per il cliente. */
export async function upcomingExpiries(cardId: number) {
  return db.select({ expiresAt: loyaltyTransactions.expiresAt, points: sql<number>`sum(${loyaltyTransactions.remaining})::int` }).from(loyaltyTransactions)
    .where(and(eq(loyaltyTransactions.cardId, cardId), gt(loyaltyTransactions.remaining, 0), isNotNull(loyaltyTransactions.expiresAt)))
    .groupBy(loyaltyTransactions.expiresAt).orderBy(asc(loyaltyTransactions.expiresAt)).limit(10);
}
