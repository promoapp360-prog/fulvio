import { z } from "zod";

const today = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Rome" }).format(new Date());
export const calendarDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Indica una data valida")
  .refine(value => { const d = new Date(value + "T12:00:00Z"); return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value; }, "Data non valida");
const birthDay = calendarDay.refine(value => value <= today() && value >= "1900-01-01", "La data di nascita non può essere futura");
const text = (max = 1000) => z.string().trim().min(1, "Campo obbligatorio").max(max);
const optionalText = (max = 1000) => z.string().trim().max(max).nullish().transform(value => value ?? "");
export const customerDogSchema = z.object({
  name: text(80), species: z.enum(["cane", "gatto"]),
  breed: text(120), size: z.enum(["mini", "piccola", "media", "grande", "gigante"]),
  weightKg: z.coerce.number().min(0.2).max(150).transform(String),
  birthDate: birthDay,
  coatType: z.enum(["liscio", "mosso", "riccio", "duro", "altro"]),
  coatLength: z.enum(["corto", "medio", "lungo"]),
  food: z.object({ notes: optionalText(2000) }).passthrough().nullish().transform(value => value ?? { notes: "" }),
  jointIssues: optionalText(), dermatitis: optionalText(), intolerances: optionalText(), sensitivities: optionalText(),
  aggressive: z.boolean().default(false), aggressiveNotes: optionalText(),
  otherNeeds: optionalText(), otherPets: optionalText(),
  customFields: z.record(z.unknown()).default({}),
});
export const registrationSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(255), password: z.string().min(8, "Almeno 8 caratteri").max(128),
  firstName: text(100), lastName: text(100),
  phone: text(40).refine(value => value.replace(/\D/g, "").length >= 8, "Telefono non valido"),
  city: text(120), province: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "Indica la provincia con due lettere"),
  cap: z.string().trim().regex(/^\d{5}$/, "Indica un CAP di 5 cifre"), birthDate: birthDay,
  consentPrivacy: z.literal(true, { errorMap: () => ({ message: "Prendi visione della privacy ed accetta le condizioni" }) }),
  consentMarketing: z.boolean().default(false),
  dog: customerDogSchema,
});
export const appointmentRequestSchema = z.object({
  dogId: z.number().int().positive(), serviceIds: z.array(z.number().int().positive()).min(1).max(10),
  date: calendarDay, time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  coatSheddingToday: z.boolean(), coatKnotsToday: z.boolean(),
  notes: z.string().trim().max(2000).default(""), alternativeAvailability: z.string().trim().max(500).default(""),
  requestKey: z.string().uuid(),
  boarding: z.object({ startDate: calendarDay, endDate: calendarDay, needs: z.string().trim().max(2000).default("") })
    .refine(value => value.endDate >= value.startDate && value.startDate >= today(), "Controlla le date della pensione").optional(),
});
export type BookingService = { id: number; name: string; slug: string; active?: boolean; bookable?: boolean; visible?: boolean };
export const isStripping = (service: BookingService) => /stripping/i.test(service.slug + " " + service.name);
export const isNailTrim = (service: BookingService) => service.slug === "taglio-unghie";
const isBath = (service: BookingService) => /^(?:fnt-2025-bagno-pelo-|lavaggio-professionale$)/.test(service.slug);
export function bookingServiceIds(ids: number[], catalog: BookingService[], coatLength?: string | null) {
  const result = [...new Set(ids)];
  if (!catalog.some(service => result.includes(service.id) && isStripping(service))) return result;
  if (catalog.some(service => result.includes(service.id) && isBath(service))) return result;
  const suffix = coatLength === "lungo" ? "lungo" : coatLength === "medio" ? "medio" : "raso";
  const enabled = catalog.filter(service => service.active !== false && service.bookable !== false && service.visible !== false);
  const bath = enabled.find(service => service.slug === `fnt-2025-bagno-pelo-${suffix}`) ||
    enabled.find(service => service.slug === "lavaggio-professionale");
  if (!bath) throw new Error("Lo stripping richiede anche un bagno attivo e prenotabile. Contatta il salone.");
  return [...result, bath.id];
}
