/**
 * Aggiornamento esplicito delle sole due pagine legali richiesto dal titolare.
 * Non viene eseguito all'avvio: successive modifiche CMS non vengono sovrascritte.
 */
import { eq } from "drizzle-orm";
import { db,pool } from "./db";
import { auditLog,pages,settings } from "../shared/schema";
import { LEGAL_DEFAULTS } from "../shared/legal";
import { COOKIE_DRAFT,PRIVACY_DRAFT } from "./services/legal-documents";

async function prepare(){
  await db.transaction(async tx=>{
    for(const entry of [
      {slug:"privacy-policy",title:"Privacy Policy",body:PRIVACY_DRAFT},
      {slug:"cookie-policy",title:"Cookie Policy",body:COOKIE_DRAFT},
    ]){
      const [before]=await tx.select().from(pages).where(eq(pages.slug,entry.slug));
      const changes={...entry,subtitle:"Bozza da convalidare con il titolare",published:true,updatedAt:new Date()};
      await tx.insert(pages).values(changes).onConflictDoUpdate({target:pages.slug,set:changes});
      if(before?.body!==entry.body)await tx.insert(auditLog).values({
        action:"legal_draft_prepared",entity:"page",entityId:String(before?.id||entry.slug),
        data:{previousBody:before?.body||null,status:"bozza_da_convalidare",reason:"Dati reali forniti dal titolare; verifiche ancora da completare"},
      });
    }
    const [existing]=await tx.select().from(settings).where(eq(settings.key,"legal"));
    await tx.insert(settings).values({key:"legal",value:{...LEGAL_DEFAULTS,...(existing?.value as object||{})}})
      .onConflictDoNothing({target:settings.key});
  });
  console.log("Aggiornate solo Privacy Policy e Cookie Policy come bozze; dati legali predisposti. Nessuna pubblicazione.");
}
prepare().then(()=>pool.end()).catch(async e=>{console.error(e);await pool.end();process.exitCode=1;});
