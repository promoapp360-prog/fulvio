import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { pages } from "../../shared/schema";
import { COOKIE_SCHEMA_VERSION } from "../../shared/legal";
import { getSettings } from "./settings";

/** Il cambio di testo, ID o audit invalida la vecchia scelta, senza profilare il browser. */
export async function cookieConfiguration(){
  const s=await getSettings();
  const [page]=await db.select({body:pages.body}).from(pages).where(and(eq(pages.slug,"cookie-policy"),eq(pages.published,true)));
  const reviewed=s.legal.trackingReviewed===true;
  const providers={
    ga4:!!s.seo.gaMeasurementId,
    gtm:!!s.seo.gtmId,
    meta:!!s.seo.metaPixelId,
  };
  return {
    version:crypto.createHash("sha256").update(JSON.stringify({schema:COOKIE_SCHEMA_VERSION,body:page?.body||"",seo:s.seo,reviewed})).digest("hex"),
    providers,
    reviewed,
    analytics:reviewed&&(providers.ga4||providers.gtm),
    marketing:reviewed&&(providers.meta||providers.gtm),
    externalContent:true,
  };
}
