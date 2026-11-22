import crypto from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../db";
import { consentPolicies, pages } from "../../shared/schema";
import { HttpError } from "../util";

/** La checkbox attesta presa visione, non è un consenso alla base giuridica contrattuale. */
export async function privacyPolicyVersion() {
  const [version] = await db.select({ version: consentPolicies.version }).from(consentPolicies)
    .where(and(eq(consentPolicies.kind,"privacy"),eq(consentPolicies.active,true))).orderBy(desc(consentPolicies.publishedAt)).limit(1);
  const [page] = await db.select({title:pages.title,body:pages.body}).from(pages)
    .where(and(eq(pages.slug,"privacy-policy"),eq(pages.published,true)));
  if (!page) throw new HttpError(503,"Informativa privacy non disponibile; riprova più tardi.");
  return `${version?.version||"bozza"}:sha256:${crypto.createHash("sha256").update(`${page.title}\n${page.body}`).digest("hex")}`;
}
