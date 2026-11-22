import test from "node:test";
import assert from "node:assert/strict";
import { LEGAL_DEFAULTS,legalSettingsSchema } from "../shared/legal";
import { PRIVACY_DRAFT,COOKIE_DRAFT } from "../server/services/legal-documents";
import { readCookieChoice,COOKIE_KEY } from "../client/src/lib/cookies";

test("dati fiscali: sede legale distinta dal negozio, P.IVA non inventata",()=>{
  assert.equal(LEGAL_DEFAULTS.companyName,"LUCARELLI FULVIO");
  assert.equal(LEGAL_DEFAULTS.vatNumber,"");
  assert.match(LEGAL_DEFAULTS.registeredOffice,/Pioltello/);
  assert.doesNotMatch(LEGAL_DEFAULTS.registeredOffice,/Leonardo da Vinci/);
  assert.equal(LEGAL_DEFAULTS.trackingReviewed,false);
});
test("informative marcate bozze, finalità contrattuale distinta da marketing e presa visione",()=>{
  assert.match(PRIVACY_DRAFT,/BOZZA DA CONVALIDARE/);
  assert.match(COOKIE_DRAFT,/BOZZA DA CONVALIDARE/);
  assert.match(PRIVACY_DRAFT,/art\. 6\.1\.b/);
  assert.match(PRIVACY_DRAFT,/non è un consenso obbligatorio/);
  assert.match(PRIVACY_DRAFT,/conservazione/i);
  assert.match(COOKIE_DRAFT,/non configurati/);
});
test("il campo P.IVA admin ammette vuoto ma rifiuta il codice fiscale e flag non booleani",()=>{
  assert.equal(legalSettingsSchema.safeParse({vatNumber:""}).success,true);
  assert.equal(legalSettingsSchema.safeParse({vatNumber:LEGAL_DEFAULTS.taxCode}).success,false);
  assert.equal(legalSettingsSchema.safeParse({vatNumber:"12345"}).success,false);
  assert.equal(legalSettingsSchema.safeParse({trackingReviewed:"false"}).success,false);
});
test("vecchie scelte cookie senza versione non autorizzano tag o iframe",()=>{
  const store=new Map<string,string>();
  Object.defineProperty(globalThis,"localStorage",{configurable:true,value:{getItem:(k:string)=>store.get(k)||null}});
  store.set(COOKIE_KEY,JSON.stringify({necessary:true,analytics:true,marketing:true,date:new Date().toISOString()}));
  assert.equal(readCookieChoice(),null);
});
test("scelte cookie scadute non vengono riutilizzate, quelle valide conservano il rifiuto",()=>{
  const choice={necessary:true,analytics:false,marketing:false,externalContent:false,version:"a".repeat(64),receiptId:"0b4eea7b-d489-4aa6-b803-1397cd8688d4",date:new Date().toISOString()};
  let stored=JSON.stringify(choice);
  Object.defineProperty(globalThis,"localStorage",{configurable:true,value:{getItem:()=>stored}});
  assert.equal(readCookieChoice()?.analytics,false);
  stored=JSON.stringify({...choice,date:"2020-01-01T00:00:00Z"});
  assert.equal(readCookieChoice(),null);
});
