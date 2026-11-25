import crypto from "node:crypto";
import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { loyaltyCards, loyaltyTransactions, privacyContacts, users } from "../../shared/schema";
import { db } from "../db";
import { HttpError } from "../util";
import { adjust, ensureCard } from "./loyalty";
import { memberPhone, walkInSchema } from "../../shared/loyalty-membership";
export { cardTarget, walkInSchema, memberPhone } from "../../shared/loyalty-membership";
export const memberPhoneSql = (column: any) => sql`regexp_replace(regexp_replace(regexp_replace(coalesce(${column}, ''), '[^0-9]', '', 'g'), '^00', ''), '^39(?=[0-9]{9,}$)', '')`;

/** Legacy customer-based callers and new walk-in cards share the very same ledger. */
export async function resolveCard(d: { customerId?: number; cardId?: number }, tx: any = db): Promise<any> {
  if (!d.cardId) {
    const [u] = await tx.select({ id: users.id }).from(users).where(and(eq(users.id, d.customerId!), eq(users.role, "customer")));
    if (!u) throw new HttpError(404, "Cliente non trovato");
    return ensureCard(u.id, tx);
  }
  let [c] = await tx.select().from(loyaltyCards).where(eq(loyaltyCards.id, d.cardId));
  if (c?.mergedIntoCardId) [c] = await tx.select().from(loyaltyCards).where(eq(loyaltyCards.id, c.mergedIntoCardId));
  if (!c || !c.active || (d.customerId && c.customerId !== d.customerId)) throw new HttpError(404, "Tessera non disponibile");
  return c;
}

export async function createWalkIn(d: z.infer<typeof walkInSchema>, actorId: number) {
  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`walk-in:${d.requestKey}`}))`);
    const externalId = `fidelity:${d.requestKey}`;
    const [old] = await tx.select().from(privacyContacts).where(and(eq(privacyContacts.externalId, externalId), eq(privacyContacts.source, "Self-Service")));
    if (old) {
      if (old.firstName !== d.firstName || memberPhone(old.phone) !== memberPhone(d.phone) || (old.email || "").toLowerCase() !== (d.email || "").toLowerCase()) throw new HttpError(409, "Questa richiesta è già stata salvata con dati diversi. Chiudi e riapri il modulo per un nuovo cliente.");
      const [card] = await tx.select().from(loyaltyCards).where(eq(loyaltyCards.contactId, old.id));
      if (!card) throw new HttpError(409, "Anagrafica presente senza tessera: controlla la scheda prima di proseguire");
      return { card, contactId: old.id, duplicate: true };
    }
    // A shared phone is a conflict for staff to resolve, never permission to merge.
    const phone = memberPhone(d.phone);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`walk-in-phone:${phone}`}))`);
    const [contactMatch] = await tx.select({ id: privacyContacts.id }).from(privacyContacts).where(or(
      sql`${memberPhoneSql(privacyContacts.phone)} = ${phone}`,
      d.email ? sql`lower(${privacyContacts.email}) = ${d.email.toLowerCase()}` : undefined,
    )).limit(1);
    const [userMatch] = await tx.select({ id: users.id }).from(users).where(or(
      sql`${memberPhoneSql(users.phone)} = ${phone}`,
      d.email ? sql`lower(${users.email}) = ${d.email.toLowerCase()}` : undefined,
    )).limit(1);
    if ((contactMatch || userMatch) && !d.separateContact) throw new HttpError(409, "Recapito già presente. Cerca la scheda esistente; crea una scheda distinta solo se si tratta di un'altra persona.");
    const [contact] = await tx.insert(privacyContacts).values({
      firstName: d.firstName, phone: d.phone, email: d.email?.toLowerCase() || null,
      source: "Self-Service", externalId, consentPrivacy: false, consentMarketing: false,
    }).returning();
    const [card] = await tx.insert(loyaltyCards).values({ contactId: contact.id, code: "DP" + crypto.randomInt(10_000_000, 99_999_999) }).returning();
    if (d.points) await adjust(card.id, d.points, d.reason, actorId, tx);
    return { card: { ...card, points: d.points }, contactId: contact.id, duplicate: false };
  });
}

/** Explicit claim only. Phone-only matches wait for staff verification; no automatic account merge. */
export async function requestMembership(code: string, userId: number) {
  const result = await db.transaction(async tx => {
    const [u] = await tx.select().from(users).where(and(eq(users.id, userId), eq(users.role, "customer")));
    const [s] = await tx.select().from(loyaltyCards).where(and(eq(loyaltyCards.code, code), eq(loyaltyCards.active, true))).for("update");
    if (!u || !s?.contactId || s.customerId || s.mergedIntoCardId) return null;
    const [contact] = await tx.select().from(privacyContacts).where(eq(privacyContacts.id, s.contactId));
    if (!contact || (contact.linkedUserId && contact.linkedUserId !== userId)) return null;
    const verifiedEmail = !!u.emailVerifiedAt && !!contact.email && contact.email.toLowerCase() === u.email.toLowerCase();
    const phoneMatch = !!memberPhone(u.phone) && memberPhone(u.phone) === memberPhone(contact.phone);
    if (!verifiedEmail && !phoneMatch) return null;
    if (s.claimRequestedBy && s.claimRequestedBy !== userId) return null;
    await tx.update(loyaltyCards).set({ claimRequestedBy: userId, claimRequestedAt: new Date() }).where(eq(loyaltyCards.id, s.id));
    return { cardId: s.id, verifiedEmail };
  });
  if (result?.verifiedEmail) return mergeMembership(result.cardId, userId, "Email verificata ed azione esplicita del cliente");
  // Same response even for unmatched codes: no information about another customer's balance.
  return { linked: false, message: "Richiesta ricevuta. Se tessera e recapiti corrispondono, il salone verificherà la titolarità prima dell'associazione." };
}

export async function mergeMembership(sourceId: number, userId: number, proof: string) {
  return db.transaction(async tx => {
    const destination = await ensureCard(userId, tx); // welcome bonus is registration-only
    const cards = await tx.select().from(loyaltyCards).where(inArray(loyaltyCards.id, [sourceId, destination.id])).orderBy(asc(loyaltyCards.id)).for("update");
    const source = cards.find(c => c.id === sourceId), target = cards.find(c => c.id === destination.id);
    if (source?.mergedIntoCardId === destination.id) return { linked: true, message: "Tessera già associata." };
    if (!source?.active || !target?.active || !source.contactId || source.customerId || source.mergedIntoCardId || source.claimRequestedBy !== userId) throw new HttpError(409, "Associazione non disponibile o già gestita");
    const [contact] = await tx.select().from(privacyContacts).where(eq(privacyContacts.id, source.contactId)).for("update");
    if (contact.linkedUserId && contact.linkedUserId !== userId) throw new HttpError(409, "Contatto già associato ad un altro cliente");
    // Move the original ledger, never recreate accruals or renew their expiry.
    await tx.update(loyaltyTransactions).set({ cardId: target.id }).where(eq(loyaltyTransactions.cardId, source.id));
    await tx.update(loyaltyCards).set({
      points: sql`${loyaltyCards.points} + ${source.points}`,
      ...(target.expiryMonths == null && source.expiryMonths != null ? { expiryMonths: source.expiryMonths } : {}),
    }).where(eq(loyaltyCards.id, target.id));
    await tx.update(loyaltyCards).set({ points: 0, active: false, mergedIntoCardId: target.id, claimRequestedBy: null, claimRequestedAt: null }).where(eq(loyaltyCards.id, source.id));
    await tx.update(privacyContacts).set({ linkedUserId: userId, updatedAt: new Date() }).where(eq(privacyContacts.id, contact.id));
    await tx.insert(loyaltyTransactions).values({ cardId: target.id, points: 0, kind: "rettifica", reason: `Associazione ${source.code}: ${proof}`.slice(0, 160), createdBy: userId });
    return { linked: true, message: "Tessera associata: punti e storico sono ora nella tua Fidelity Card." };
  });
}
