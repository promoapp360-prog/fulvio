import type { Request } from "express";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../db";
import { customerConsents, consentPolicies } from "../../shared/schema";

/** Versione attiva dell'informativa per tipo (privacy, marketing, cookie, condizioni). */
export async function currentPolicyVersion(kind: string) {
  const [p] = await db.select().from(consentPolicies).where(and(eq(consentPolicies.kind, kind), eq(consentPolicies.active, true))).orderBy(desc(consentPolicies.publishedAt)).limit(1);
  return p?.version ?? null;
}

/** Registra una concessione o revoca nello storico delle autorizzazioni (mai sovrascritto). */
export async function recordConsent(tx: any, c: {
  userId?: number | null; privacyContactId?: number | null; kind: "privacy" | "marketing" | "cookie" | "condizioni" | "richiami";
  granted: boolean; source: string; proof?: string | null; policyVersion?: string | null; req?: Request | null; createdBy?: number | null;
}) {
  await (tx || db).insert(customerConsents).values({
    userId: c.userId ?? null, privacyContactId: c.privacyContactId ?? null, kind: c.kind, granted: c.granted, source: c.source,
    proof: c.proof ?? null, policyVersion: c.policyVersion ?? null, createdBy: c.createdBy ?? null,
    ip: c.req ? String(c.req.ip || "").slice(0, 64) : null, userAgent: c.req ? String(c.req.get("user-agent") || "").slice(0, 255) : null,
  });
}
