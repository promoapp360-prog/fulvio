import { z } from "zod";

export const memberPhone = (v: string | null | undefined) => {
  let n = (v || "").replace(/\D/g, "").replace(/^00/, "");
  if (n.startsWith("39") && n.length > 10) n = n.slice(2);
  return n;
};
export const cardTarget = z.object({ customerId: z.number().int().positive().optional(), cardId: z.number().int().positive().optional() })
  .refine(d => !!d.customerId || !!d.cardId, "Indica il cliente o la tessera");
export const walkInSchema = z.object({
  firstName: z.string().trim().min(1).max(100),
  phone: z.string().trim().min(8).max(40).refine(v => memberPhone(v).length >= 8 && memberPhone(v).length <= 15, "Telefono non valido"),
  email: z.union([z.string().trim().email().max(255), z.literal("")]).optional(),
  points: z.number().int().min(0).max(100_000).default(0),
  reason: z.string().trim().min(3).max(160).default("Self-service"),
  requestKey: z.string().uuid(), separateContact: z.boolean().default(false),
});
