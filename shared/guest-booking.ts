import { z } from "zod";
import { DOG_BREEDS } from "./dog-breeds";

const dogBreed = z.string().refine(v => (DOG_BREEDS as readonly string[]).includes(v), "Seleziona una razza oppure Altra razza");
const personFields = {
  firstName: z.string().trim().min(1, "Inserisci il nome").max(100),
  lastName: z.string().trim().min(1, "Inserisci il cognome").max(100),
  email: z.string().trim().toLowerCase().email("Inserisci un’email valida").max(255),
  phone: z.string().trim().max(40).refine(v => /^[+\d\s().-]+$/.test(v) && v.replace(/\D/g,"").length >= 8 && v.replace(/\D/g,"").length <= 15, "Inserisci un telefono valido"),
};
export const guestContactSchema = z.object(personFields);
export const guestDogSchema = z.object({
  dogName: z.string().trim().min(1, "Inserisci il nome del cane").max(80),
  breed: dogBreed, breedOther: z.string().trim().max(120).default(""),
  coatType: z.enum(["Liscio","Mosso","Riccio","Altro"]),
  coatLength: z.enum(["Corto","Medio","Lungo"]),
  coatConditions: z.array(z.enum(["Ben pettinato","Annodato","In muta/perde pelo","Altro"])).min(1,"Indica lo stato del manto").max(4),
  coatNotes: z.string().trim().max(1000).default(""),
  weightKg: z.coerce.number().min(0.2,"Inserisci un peso ragionevole").max(150,"Il peso massimo è 150 kg"),
  ageYears: z.preprocess(v=>v===""||v===null||v===undefined?null:v,z.coerce.number().int().min(0).max(30).nullable()).default(null),
  ageMonths: z.preprocess(v=>v===""||v===null||v===undefined?null:v,z.coerce.number().int().min(0).max(11).nullable()).default(null),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().or(z.literal("").transform(()=>null)).default(null),
});
export const guestDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => {
  const d = new Date(v+"T12:00:00Z"); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0,10) === v;
}, "Data non valida");
export const guestTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const guestBookingSchema = z.object({
  ...personFields,
  ...guestDogSchema.shape,
  serviceIds: z.array(z.number().int().positive()).min(1,"Seleziona almeno un servizio").max(10),
  operatorId: z.number().int().positive().nullable(),
  date: guestDay, time: guestTime,
  notes: z.string().trim().max(1000).default(""),
  alternativeAvailability: z.string().trim().max(500).default(""),
  privacy: z.literal(true,{errorMap:()=>({message:"Prendi visione dell’informativa privacy prima di inviare"})}),
  marketing: z.boolean().default(false),
  website: z.string().max(0,"Invio non valido").default(""),
  requestKey: z.string().uuid(),
}).refine(v=>v.breed!=="Altra razza"||v.breedOther.length>=2,{path:["breedOther"],message:"Indica la razza del cane"});
export type GuestBookingInput = z.infer<typeof guestBookingSchema>;
export const GUEST_ACTIVE = ["richiesta","in_valutazione","proposta","confermata"] as const;

/** Taglia solo indicativa per applicare le fasce del listino esistente dal peso dichiarato. */
export function sizeFromWeight(weightKg:number):"piccola"|"media"|"grande"|"gigante" {
  return weightKg <= 10 ? "piccola" : weightKg <= 25 ? "media" : weightKg <= 45 ? "grande" : "gigante";
}
