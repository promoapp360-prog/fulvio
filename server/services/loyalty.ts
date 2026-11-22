import crypto from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { loyaltyCards, loyaltyTransactions } from "../../shared/schema";
import { getSettings } from "./settings";

export async function ensureCard(customerId: number, tx: any = db) {
  const [existing] = await tx.select().from(loyaltyCards).where(eq(loyaltyCards.customerId, customerId));
  if (existing) return existing;
  const code = "DP" + crypto.randomInt(10_000_000, 99_999_999).toString();
  const [card] = await tx.insert(loyaltyCards).values({ customerId, code }).onConflictDoNothing().returning();
  if (!card) { const [c] = await tx.select().from(loyaltyCards).where(eq(loyaltyCards.customerId, customerId)); return c; }
  const s = await getSettings();
  if (s.loyalty.enabled && s.loyalty.welcomePoints > 0) await addPoints(card.id, s.loyalty.welcomePoints, "Benvenuto in Dog's Planet", {}, tx);
  return card;
}

/** Aggiunge/toglie punti in modo atomico. Gli indici unici impediscono il doppio accredito per lo stesso appuntamento/ordine. */
export async function addPoints(cardId: number, points: number, reason: string, ref: { appointmentId?: number; orderId?: number; createdBy?: number } = {}, tx: any = db) {
  if (!points) return false;
  const inserted = await tx.insert(loyaltyTransactions).values({ cardId, points, reason, ...ref }).onConflictDoNothing().returning();
  if (!inserted.length) return false;
  await tx.update(loyaltyCards).set({ points: sql`${loyaltyCards.points} + ${points}` }).where(eq(loyaltyCards.id, cardId));
  return true;
}

export async function awardForAmount(customerId: number, amountCents: number, reason: string, ref: { appointmentId?: number; orderId?: number; createdBy?: number }, tx: any = db) {
  const s = await getSettings();
  if (!s.loyalty.enabled || amountCents <= 0) return;
  const card = await ensureCard(customerId, tx);
  const pts = Math.floor((amountCents / 100) * s.loyalty.pointsPerEuro);
  if (pts > 0) await addPoints(card.id, pts, reason, ref, tx);
}
