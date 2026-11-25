import { z } from "zod";

export const treatmentDurationInput = z.object({
  actualDurationMin: z.number().int().min(1, "Inserisci almeno 1 minuto").max(600, "Il massimo è 600 minuti").nullable(),
}).strict();

export function treatmentServiceIds(booking: { serviceId: number; requestedServiceIds?: number[] | null }) {
  return [...new Set(booking.requestedServiceIds?.length ? booking.requestedServiceIds : [booking.serviceId])].sort((a, b) => a - b);
}
