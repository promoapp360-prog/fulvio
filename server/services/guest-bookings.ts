import crypto from "node:crypto";
import { and, eq, or, sql } from "drizzle-orm";
import { db } from "../db";
import {
  guestBookings, guestBookingEvents, guestCustomers, guestDogs, dogPhotos, appointmentPhotos, users, services, operators,
} from "../../shared/schema";
import { assertSlotFree } from "./availability";
import { quoteServices } from "./appointments";
import { getSettings } from "./settings";
import { sizeFromWeight, type GuestBookingInput } from "../../shared/guest-booking";
import { normalizePhone } from "../logic";
import { romeToDate, fmtRome, todayRome } from "../time";
import { emailLayout, p, sendEmail } from "./email";
import { notifyStaff } from "./notify";
import { HttpError, id } from "../util";
import type { Request } from "express";

type Meta = { ip: string | null; userAgent: string | null; privacyVersion: string; request: Request };
const cleanName=(v:string)=>v.normalize("NFD").replace(/[\u0300-\u036f]/g,"").trim().toLocaleLowerCase("it-IT").replace(/\s+/g," ");
const hmac=(v:string)=>crypto.createHmac("sha256",process.env.SESSION_SECRET||"").update(v).digest("hex");

export async function createGuestBooking(input: GuestBookingInput, meta: Meta, photoKey: string | null, photoHash: string | null) {
  if (!process.env.SESSION_SECRET) throw new HttpError(503,"Servizio richieste temporaneamente non disponibile.");
  if (input.date < todayRome()) throw new HttpError(400,"La data selezionata è nel passato.");
  const start=romeToDate(input.date,input.time), settings=await getSettings();
  if (start.getTime() < Date.now()+settings.booking.minNoticeHours*3_600_000) throw new HttpError(409,"L'orario è troppo vicino: seleziona un altro slot.");
  if (input.date > (await import("../time")).addDays(todayRome(),settings.booking.maxDaysAhead)) throw new HttpError(400,"La data è oltre il periodo prenotabile.");
  const weight=Number(input.weightKg);
  const dogForQuote={
    size:sizeFromWeight(weight),coatKnots:input.coatConditions.includes("Annodato"),
    coatShedding:input.coatConditions.includes("In muta/perde pelo"),aggressive:false,
  };
  const quote=await quoteServices(input.serviceIds,dogForQuote);
  const ops=input.operatorId?quote.operators.filter(o=>o.id===input.operatorId):quote.operators;
  if(!ops.length) throw new HttpError(409,"L’operatore scelto non è abilitato a tutti i servizi; scegline un altro.");
  const phoneNorm=normalizePhone(input.phone);
  if(phoneNorm.length<8) throw new HttpError(400,"Inserisci un numero di telefono valido.");
  if(!input.operatorId&&!settings.booking.allowAnyOperator)throw new HttpError(400,"Seleziona un operatore per questa richiesta.");
  const breed=input.breed==="Altra razza"?input.breedOther.trim():input.breed;
  const payloadHash=crypto.createHash("sha256").update(JSON.stringify({...input,breed,photoHash})).digest("hex");
  const emailNormalized=input.email.trim().toLowerCase();
  const phoneNormalized=phoneNorm;
  const names=[cleanName(input.firstName),cleanName(input.lastName)];
  const dedupeKey=hmac([emailNormalized,phoneNormalized,names[0],names[1],cleanName(input.dogName),input.date,input.time,[...input.serviceIds].sort((a,b)=>a-b).join(",")].join("|"));
  const token=crypto.randomBytes(32).toString("hex");
  let lastConflict:Error|null=null;
  for(const op of ops){
    try{
      const booking=await db.transaction(async tx=>{
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`guest:${emailNormalized}:${phoneNormalized}:${names.join(":")}`}))`);
        const [replay]=await tx.select().from(guestBookings).where(eq(guestBookings.requestKey,input.requestKey)).limit(1);
        if(replay){
          if(replay.payloadHash!==payloadHash) throw new HttpError(409,"Questa richiesta è già stata inviata. Seleziona nuovamente un orario per crearne una nuova.");
          return {row:replay,duplicate:true};
        }
        const [duplicate]=await tx.select({id:guestBookings.id}).from(guestBookings).where(and(eq(guestBookings.dedupeKey,dedupeKey),sql`${guestBookings.status} in ('richiesta','in_valutazione','proposta','confermata')`)).limit(1);
        if(duplicate) throw new HttpError(409,"Hai già inviato una richiesta per questo cane e orario. Attendi la risposta del salone.");

        const digitPhone=sql`regexp_replace(coalesce(${users.phone},''), '\\D','','g')`;
        const conflicts=await tx.select({id:users.id}).from(users).where(and(eq(users.role,"customer"),or(
          sql`lower(${users.email})=${emailNormalized}`,sql`${digitPhone}=${phoneNormalized}`,
          sql`${digitPhone}=${"39"+phoneNormalized}`,sql`${digitPhone}=${"0039"+phoneNormalized}`,
        )));
        const existing=await tx.select().from(guestCustomers).where(or(eq(guestCustomers.emailNormalized,emailNormalized),eq(guestCustomers.phoneNormalized,phoneNormalized)));
        const exact=existing.filter(c=>c.emailNormalized===emailNormalized&&c.phoneNormalized===phoneNormalized&&cleanName(c.firstName)===names[0]&&cleanName(c.lastName)===names[1]);
        let customer=exact.length===1?exact[0]:null;
        const reason=conflicts.length?"Recapito presente in un’anagrafica registrata: verifica manuale richiesta."
          :existing.length?"Email o telefono coincide con una scheda ospite non corrispondente: verifica manuale richiesta."
          :exact.length>1?"Più schede ospite corrispondono: verifica manuale richiesta.":null;
        if(!customer){
          [customer]=await tx.insert(guestCustomers).values({
            firstName:input.firstName,lastName:input.lastName,email:input.email, emailNormalized,phone:input.phone,phoneNormalized,
            source:"Richiesta prenotazione ospite",privacyAcknowledgedAt:new Date(),privacyVersion:meta.privacyVersion,
            privacyProof:"presa_visione_informativa_privacy",privacyIp:meta.ip,privacyUserAgent:meta.userAgent,
            marketingConsent:input.marketing,marketingConsentAt:input.marketing?new Date():null,
            marketingProof:input.marketing?"consenso_marketing_esplicito":null,
            needsManualReview:!!reason,reviewReason:reason,
          }).returning();
        }else{
          await tx.update(guestCustomers).set({
            privacyAcknowledgedAt:new Date(),privacyVersion:meta.privacyVersion,privacyProof:"presa_visione_informativa_privacy",
            privacyIp:meta.ip,privacyUserAgent:meta.userAgent,
            ...(input.marketing?{marketingConsent:true,marketingConsentAt:new Date(),marketingProof:"consenso_marketing_esplicito"}:{}),
            ...(reason?{needsManualReview:true,reviewReason:reason}:{}),updatedAt:new Date(),
          }).where(eq(guestCustomers.id,customer.id));
        }

        const exactDogs=await tx.select().from(guestDogs).where(and(eq(guestDogs.guestCustomerId,customer.id),eq(guestDogs.name,input.dogName),eq(guestDogs.breed,breed)));
        let dog=exactDogs.length===1?exactDogs[0]:null;
        const dogData={
          guestCustomerId:customer.id,name:input.dogName,breed,size:dogForQuote.size,weightKg:String(weight),
          ageYears:input.ageYears===null?null:Number(input.ageYears),ageMonths:input.ageMonths===null?null:Number(input.ageMonths),
          birthDate:input.birthDate||null,coatType:input.coatType,coatLength:input.coatLength,
          coatConditions:input.coatConditions,coatNotes:input.coatNotes||null,photoKey:photoKey??dog?.photoKey??null,updatedAt:new Date(),
        };
        if(dog){
          [dog]=await tx.update(guestDogs).set(dogData).where(eq(guestDogs.id,dog.id)).returning();
        }else{
          [dog]=await tx.insert(guestDogs).values(dogData).returning();
        }
        if(photoKey){
          await tx.insert(dogPhotos).values({guestDogId:dog.id,storageKey:photoKey})
            .onConflictDoUpdate({target:dogPhotos.guestDogId,set:{storageKey:photoKey,createdAt:new Date()}});
        }
        await assertSlotFree(tx,op.id,start,quote.durationMin);
        const [row]=await tx.insert(guestBookings).values({
          firstName:input.firstName,lastName:input.lastName,email:input.email,phone:input.phone,dogName:input.dogName,breed,
          serviceId:quote.serviceIds[0],requestedServiceIds:quote.serviceIds,operatorId:op.id,
          startAt:start,endAt:new Date(start.getTime()+quote.durationMin*60_000),durationMin:quote.durationMin,
          status:"richiesta",notes:input.notes||null,alternativeAvailability:input.alternativeAvailability||null,
          privacyAcknowledgedAt:new Date(),privacyVersion:meta.privacyVersion,privacyProof:"presa_visione_informativa_privacy",
          privacyIp:meta.ip,privacyUserAgent:meta.userAgent,marketingConsent:input.marketing,
          marketingConsentAt:input.marketing?new Date():null,marketingProof:input.marketing?"consenso_marketing_esplicito":null,
          guestCustomerId:customer.id,guestDogId:dog.id,tokenSeed:crypto.createHash("sha256").update(token).digest("hex"),
          requestKey:input.requestKey,payloadHash,dedupeKey,
        }).returning();
        await tx.insert(guestBookingEvents).values({bookingId:row.id,action:"richiesta_ospite_creata",data:{
          serviceIds:quote.serviceIds,durationMin:quote.durationMin,privacyVersion:meta.privacyVersion,
          privacyProof:"presa_visione_informativa_privacy",marketingConsent:input.marketing,manualReview:!!reason,
          ...(input.marketing?{marketingProof:"consenso_marketing_esplicito"}:{}),
        }});
        if(photoKey) await tx.insert(appointmentPhotos).values({guestBookingId:row.id,storageKey:photoKey});
        return {row,duplicate:false,customerId:customer.id,dogId:dog.id,manualReview:!!reason};
      });
      if("duplicate" in booking&&booking.duplicate) return {id:booking.row.id,duplicate:true,trackingUrl:null};
      const {row}=booking;
      const namesOfServices=quote.services.map(s=>s.name).join(", ");
      const trackingUrl=`${process.env.PUBLIC_URL||""}/richiedi-prenotazione?request=${row.id}&token=${token}`;
      const subject="Richiesta ricevuta – Dog’s Planet";
      await sendEmail(input.email,subject,emailLayout(subject,
        p(`Ciao ${input.firstName}, abbiamo ricevuto la tua richiesta per ${input.dogName} (${namesOfServices}) il ${fmtRome(row.startAt)}.`)+
        p("La richiesta è in attesa di approvazione. L'appuntamento non è confermato finché Dog’s Planet non ti invia una risposta.")+
        p(`Numero richiesta: ${row.id}.`),{label:"Segui la richiesta",url:trackingUrl}),"guest_booking_received")
        .catch(()=>console.error("[guest-booking] Richiesta salvata; errore nella coda comunicazioni cliente."));
      await notifyStaff("richieste",{title:"Nuova richiesta di prenotazione ospite",body:`${input.firstName} ${input.lastName} · ${input.dogName} · ${namesOfServices} · ${fmtRome(row.startAt)}`,url:`/admin/richieste?guestId=${row.id}`})
        .catch(()=>console.error("[guest-booking] Richiesta salvata; errore nella notifica staff."));
      return {id:row.id,duplicate:false,trackingUrl};
    }catch(e){
      if(e instanceof HttpError) throw e;
      if((e as any)?.code==="23505") throw new HttpError(409,"Richiesta già ricevuta oppure slot appena occupato. Verifica gli orari e riprova.");
      if((e as any)?.status===409||e instanceof Error&&e.name==="SlotError"){lastConflict=e instanceof Error?e:new Error("Slot non disponibile");continue;}
      throw e;
    }
  }
  throw lastConflict||new HttpError(409,"L’orario selezionato non è più disponibile per tutti i servizi e le caratteristiche del cane. Scegli un altro orario.");
}

export async function guestRequestStatus(requestId:number,token:string){
  const [row]=await db.select({
    id:guestBookings.id,status:guestBookings.status,startAt:guestBookings.startAt,durationMin:guestBookings.durationMin,
    proposedStartAt:guestBookings.proposedStartAt,createdAt:guestBookings.createdAt,serviceId:guestBookings.serviceId,
  }).from(guestBookings).where(eq(guestBookings.id,requestId));
  if(!row) throw new HttpError(404,"Richiesta non trovata.");
  const [secret]=await db.select({tokenSeed:guestBookings.tokenSeed}).from(guestBookings).where(eq(guestBookings.id,requestId));
  const expected=Buffer.from(secret.tokenSeed,"hex"),actual=Buffer.from(crypto.createHash("sha256").update(token).digest("hex"),"hex");
  if(expected.length!==actual.length||!crypto.timingSafeEqual(expected,actual)) throw new HttpError(404,"Richiesta non trovata.");
  return row;
}

export async function actOnGuestBooking(requestIdRaw:string, actorId:number, input:{action:"conferma"|"rifiuta"|"proponi";date?:string;time?:string;operatorId?:number|null;reason?:string|null}) {
  const requestId=id(requestIdRaw);
  const [row]=await db.select().from(guestBookings).where(eq(guestBookings.id,requestId));
  if(!row) throw new HttpError(404,"Richiesta non trovata.");
  if(!["richiesta","in_valutazione","proposta"].includes(row.status)) throw new HttpError(400,"La richiesta non è più modificabile.");
  const start=input.date&&input.time?romeToDate(input.date,input.time):row.proposedStartAt||row.startAt;
  if(input.action==="proponi"&&(!input.date||!input.time)) throw new HttpError(400,"Indica la data e l’ora da proporre.");
  const [dog]=row.guestDogId?await db.select().from(guestDogs).where(eq(guestDogs.id,row.guestDogId)):[];
  const doglike={size:(dog?.size||"media") as any,coatKnots:dog?.coatConditions.includes("Annodato")||false,coatShedding:dog?.coatConditions.includes("In muta/perde pelo")||false,aggressive:false};
  const serviceIds=row.requestedServiceIds?.length?row.requestedServiceIds:[row.serviceId];
  const quote=await quoteServices(serviceIds,doglike);
  const operatorId=input.operatorId??row.proposedOperatorId??row.operatorId;
  if(!quote.operators.some(o=>o.id===operatorId)) throw new HttpError(400,"Operatore non abilitato a tutti i servizi.");
  if(input.action!=="rifiuta"||start.getTime()!==row.startAt.getTime()){
    await db.transaction(async tx=>{
      await assertSlotFree(tx,operatorId,start,quote.durationMin,undefined,row.id);
      const patch:Record<string,unknown>={
        status:input.action==="rifiuta"?"rifiutata":input.action==="proponi"?"proposta":"confermata",
        updatedAt:new Date(),
        ...(input.action==="proponi"?{proposedStartAt:start,proposedOperatorId:operatorId}:{proposedStartAt:null,proposedOperatorId:null}),
        ...(input.action==="conferma"?{startAt:start,operatorId,endAt:new Date(start.getTime()+quote.durationMin*60_000),durationMin:quote.durationMin}:{}),
        adminMessage:input.reason||null,
      };
      await tx.update(guestBookings).set(patch as any).where(eq(guestBookings.id,row.id));
      await tx.insert(guestBookingEvents).values({bookingId:row.id,actorId,action:`ospite_${input.action}`,data:{reason:input.reason||null,startAt:start.toISOString(),operatorId}});
    });
  }else{
    await db.transaction(async tx=>{
      await tx.update(guestBookings).set({status:"rifiutata",adminMessage:input.reason||null,proposedStartAt:null,proposedOperatorId:null,updatedAt:new Date()}).where(eq(guestBookings.id,row.id));
      await tx.insert(guestBookingEvents).values({bookingId:row.id,actorId,action:"ospite_rifiuta",data:{reason:input.reason||null}});
    });
  }
  const [updated]=await db.select().from(guestBookings).where(eq(guestBookings.id,row.id));
  const when=fmtRome(updated.proposedStartAt||updated.startAt);
  const subject=input.action==="conferma"?"Richiesta approvata – Dog’s Planet":input.action==="rifiuta"?"Aggiornamento sulla tua richiesta – Dog’s Planet":"Dog’s Planet ti propone un nuovo orario";
  const body=input.action==="conferma"?`La tua richiesta è stata approvata per ${when}.`
    :input.action==="rifiuta"?`Non possiamo accogliere la richiesta.${input.reason?` ${input.reason}`:""}`
    :`Ti proponiamo ${when}.${input.reason?` ${input.reason}`:""}`;
  await sendEmail(row.email,subject,emailLayout(subject,p(`Ciao ${row.firstName}, ${body}`)+p("Questa comunicazione riguarda la tua richiesta di prenotazione.")),"guest_booking_update");
  return {id:row.id,status:updated.status};
}
