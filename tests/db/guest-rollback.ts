/**
 * Verifica integrazione sul DB del progetto, sempre rollback.
 * Non invia email/push e non lascia richieste, anagrafiche, cani o foto di prova.
 * Eseguire esplicitamente: pnpm exec tsx tests/db/guest-rollback.ts
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import sharp from "sharp";
import { eq,sql } from "drizzle-orm";
import { db,pool } from "../../server/db";
import { createGuestBooking } from "../../server/services/guest-bookings";
import { availability,assertSlotFree,SlotError } from "../../server/services/availability";
import { storeDogPhoto,readStored,deleteStored } from "../../server/services/storage";
import { privacyPolicyVersion } from "../../server/services/privacy-policy";
import { guestBookingSchema } from "../../shared/guest-booking";
import { addDays,todayRome } from "../../server/time";
import { services,guestBookings,guestCustomers,guestDogs,dogPhotos,appointmentPhotos,appointments,dogs,cookieChoices } from "../../shared/schema";

const rollback=new Error("TEST_ROLLBACK_ONLY");
const originalTransaction=db.transaction.bind(db);
let photoKey:string|null=null;
try{
  for(const table of [appointments,dogs,guestBookings,guestCustomers,guestDogs,dogPhotos,appointmentPhotos,cookieChoices])await db.select().from(table as any).limit(0);
  const [svc]=await db.select().from(services).where(eq(services.bookable,true));
  assert(svc);
  let day=addDays(todayRome(),1),time="",opId=0;
  for(let n=0;n<7;n++){
    const slots=await availability(svc.id,day,svc.durationMin);
    const entry=Object.entries(slots)[0];
    if(entry){time=entry[0];opId=entry[1][0];break;}
    day=addDays(day,1);
  }
  assert(time&&opId);
  const photo=await storeDogPhoto(await sharp({create:{width:120,height:120,channels:3,background:"#ccddee"}}).jpeg().toBuffer(),"image/jpeg");
  photoKey=photo.key;
  assert(photo.size<=1_000_000);assert((await readStored(photo.key))?.length===photo.size);
  const input=guestBookingSchema.parse({
    firstName:"Verifica",lastName:"Automatica",email:`check-${crypto.randomUUID()}@example.invalid`,phone:"3331234567",
    dogName:"Verifica tecnica",breed:"Meticcio",coatType:"Mosso",coatLength:"Medio",coatConditions:["Ben pettinato"],
    weightKg:12,ageYears:3,ageMonths:0,serviceIds:[svc.id],operatorId:opId,date:day,time,
    privacy:true,marketing:false,requestKey:crypto.randomUUID(),
  });
  let checked=false;
  (db as any).transaction=async(fn:any)=>originalTransaction(async tx=>{
    const result=await fn(tx),row=result.row;
    assert(row.guestCustomerId&&row.guestDogId);
    assert.equal(row.status,"richiesta");assert.equal(row.marketingConsent,false);
    assert(row.privacyAcknowledgedAt);assert(row.privacyProof);
    const [customer]=await tx.select().from(guestCustomers).where(eq(guestCustomers.id,row.guestCustomerId));
    const [dog]=await tx.select().from(guestDogs).where(eq(guestDogs.id,row.guestDogId));
    assert.equal(customer.email,input.email);assert.equal(customer.linkedUserId,null);
    assert.equal(dog.guestCustomerId,customer.id);assert.equal(dog.breed,"Meticcio");
    const [savedPhoto]=await tx.select().from(appointmentPhotos).where(eq(appointmentPhotos.guestBookingId,row.id));
    assert.equal(savedPhoto.storageKey,photo.key);
    const replay=await fn(tx);
    assert.equal(replay.duplicate,true);assert.equal(replay.row.id,row.id);
    const counts=await tx.execute(sql`SELECT count(*)::int AS n FROM guest_bookings WHERE request_key=${input.requestKey}`);
    assert.equal((counts.rows[0] as any).n,1);
    await assert.rejects(assertSlotFree(tx,opId,row.startAt,row.durationMin),SlotError);
    checked=true;
    throw rollback;
  });
  await assert.rejects(createGuestBooking(input,{privacyVersion:await privacyPolicyVersion(),ip:null,userAgent:null,request:{} as any},photo.key,"synthetic-test-photo"),e=>e===rollback);
  assert(checked);
  const rows=await db.select().from(guestBookings).where(eq(guestBookings.requestKey,input.requestKey));
  assert.equal(rows.length,0);
  console.log("OK: schema completo, foto privata persistente <1MB, richiesta pendente, privacy e CRM/cane collegati, replay senza duplicati, conflitto slot bloccato. Rollback verificato; nessuna comunicazione inviata.");
}finally{
  (db as any).transaction=originalTransaction;
  if(photoKey)await deleteStored(photoKey);
  await pool.end();
}
