import { Router } from "express";
import { z } from "zod";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { db } from "../../db";
import { loyaltyCards, loyaltyTransactions, privacyContacts, users } from "../../../shared/schema";
import { requirePerm } from "../../auth";
import { audit } from "../../services/audit";
import { upcomingExpiries } from "../../services/loyalty";
import { createWalkIn, mergeMembership, resolveCard, walkInSchema } from "../../services/loyalty-membership";
import { h, HttpError, id } from "../../util";

const r = Router();
const permit = requirePerm("fidelity");
r.post("/loyalty/self-service", permit, h(async (req, res) => {
  const out = await createWalkIn(walkInSchema.parse(req.body), req.user!.id);
  await audit(req, "fidelity_self_service", "privacy_contact", out.contactId, { cardId: out.card.id, duplicate: out.duplicate });
  res.status(out.duplicate ? 200 : 201).json(out);
}));
r.get("/loyalty/card/:cardId", permit, h(async (req, res) => {
  const card = await resolveCard({ cardId: id(req.params.cardId) });
  const [transactions, expiries] = await Promise.all([
    db.select().from(loyaltyTransactions).where(eq(loyaltyTransactions.cardId, card.id)).orderBy(desc(loyaltyTransactions.id)).limit(200),
    upcomingExpiries(card.id),
  ]);
  res.json({ card, transactions, expiries });
}));
r.post("/loyalty/card/:cardId/expiry", permit, h(async (req, res) => {
  const d = z.object({ months: z.number().int().min(0).max(120).nullable() }).parse(req.body);
  const card = await db.transaction(async tx => {
    const resolved = await resolveCard({ cardId: id(req.params.cardId) }, tx);
    const [fresh] = await tx.select().from(loyaltyCards).where(eq(loyaltyCards.id, resolved.id)).for("update");
    if (!fresh.active || fresh.mergedIntoCardId) throw new HttpError(409, "Tessera associata: riapri la scheda principale");
    const [updated] = await tx.update(loyaltyCards).set({ expiryMonths: d.months }).where(eq(loyaltyCards.id, fresh.id)).returning();
    return updated;
  });
  await audit(req, "fidelity_expiry_rule", "loyalty_card", card.id, d);
  res.json(card);
}));
r.get("/loyalty/claims", permit, h(async (_req, res) => {
  const rows = await db.select({
    cardId: loyaltyCards.id, code: loyaltyCards.code, requestedAt: loyaltyCards.claimRequestedAt,
    contactName: privacyContacts.firstName, contactPhone: privacyContacts.phone, contactEmail: privacyContacts.email,
    customerId: users.id, firstName: users.firstName, lastName: users.lastName, phone: users.phone, email: users.email,
    emailVerifiedAt: users.emailVerifiedAt,
  }).from(loyaltyCards).innerJoin(privacyContacts, eq(privacyContacts.id, loyaltyCards.contactId))
    .innerJoin(users, eq(users.id, loyaltyCards.claimRequestedBy))
    .where(and(eq(loyaltyCards.active, true), isNotNull(loyaltyCards.claimRequestedBy))).orderBy(desc(loyaltyCards.claimRequestedAt));
  res.json(rows);
}));
r.post("/loyalty/claims/:cardId", permit, h(async (req, res) => {
  const d = z.discriminatedUnion("action", [
    z.object({ action: z.literal("approve"), verifiedContact: z.literal(true) }),
    z.object({ action: z.literal("reject") }),
  ]).parse(req.body);
  const cardId = id(req.params.cardId);
  const [card] = await db.select().from(loyaltyCards).where(eq(loyaltyCards.id, cardId));
  if (!card?.claimRequestedBy) throw new HttpError(409, "Richiesta già gestita o non presente");
  const out = d.action === "approve"
    ? await mergeMembership(cardId, card.claimRequestedBy, `Titolarità verificata dal salone (operatore ${req.user!.id})`)
    : await db.update(loyaltyCards).set({ claimRequestedBy: null, claimRequestedAt: null }).where(and(eq(loyaltyCards.id, cardId), eq(loyaltyCards.claimRequestedBy, card.claimRequestedBy))).returning({ id: loyaltyCards.id });
  if (Array.isArray(out) && !out.length) throw new HttpError(409, "Richiesta già gestita");
  await audit(req, "fidelity_claim_" + d.action, "loyalty_card", cardId, { customerId: card.claimRequestedBy, verifiedContact: d.action === "approve" });
  res.json(out);
}));
export default r;
