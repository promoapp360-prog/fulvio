import test from "node:test";
import assert from "node:assert/strict";
import { guestBookingSchema, sizeFromWeight } from "../shared/guest-booking";
import { DOG_BREEDS } from "../shared/dog-breeds";

const validRequest=()=>({
  firstName:"Ada",lastName:"Rossi",email:"ada@example.test",phone:"+39 333 1234567",
  dogName:"Poppy",breed:"Meticcio",breedOther:"",coatType:"Mosso",coatLength:"Medio",
  coatConditions:["Ben pettinato"],coatNotes:"",weightKg:12.5,ageYears:"",ageMonths:"",birthDate:"",
  serviceIds:[1],operatorId:null,date:"2027-06-15",time:"10:30",notes:"",
  alternativeAvailability:"",privacy:true,marketing:false,website:"",requestKey:"cc46b01d-80f7-49b2-b1c3-f6ca731c2d61",
});

test("guest request accepts an explicit privacy acknowledgment without marketing",()=>{
  const parsed=guestBookingSchema.parse(validRequest());
  assert.equal(parsed.privacy,true);
  assert.equal(parsed.marketing,false);
  assert.equal(parsed.ageYears,null);
  assert.equal(parsed.ageMonths,null);
});

test("guest request cannot be submitted without privacy acknowledgment",()=>{
  const result=guestBookingSchema.safeParse({...validRequest(),privacy:false});
  assert.equal(result.success,false);
});

test("marketing is optional and never defaults to consent",()=>{
  const request=validRequest() as Record<string,unknown>;
  delete request.marketing;
  assert.equal(guestBookingSchema.parse(request).marketing,false);
});

test("breed selection is constrained to the local searchable list and supports free-text other",()=>{
  assert.ok(DOG_BREEDS.includes("Meticcio"));
  assert.ok(DOG_BREEDS.includes("Altra razza"));
  assert.equal(guestBookingSchema.safeParse({...validRequest(),breed:"Razza inventata"}).success,false);
  assert.equal(guestBookingSchema.safeParse({...validRequest(),breed:"Altra razza",breedOther:""}).success,false);
  assert.equal(guestBookingSchema.parse({...validRequest(),breed:"Altra razza",breedOther:"Lagotto"}).breedOther,"Lagotto");
});

test("multiple coat conditions and multiple services are accepted",()=>{
  const parsed=guestBookingSchema.parse({...validRequest(),coatConditions:["Annodato","In muta/perde pelo"],serviceIds:[1,2]});
  assert.equal(parsed.coatConditions.length,2);
  assert.equal(parsed.serviceIds.length,2);
});

test("weight estimates a service size without modifying the dog profile",()=>{
  assert.equal(sizeFromWeight(3),"mini");
  assert.equal(sizeFromWeight(5),"mini");
  assert.equal(sizeFromWeight(8),"piccola");
  assert.equal(sizeFromWeight(20),"media");
  assert.equal(sizeFromWeight(35),"grande");
  assert.equal(sizeFromWeight(60),"gigante");
});
