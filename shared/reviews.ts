import { z } from "zod";

export const webUrl = z.union([z.literal(""), z.string().trim().url().refine(value => {
  const url = new URL(value);
  return url.protocol === "https:" && !url.username && !url.password;
}, "Usa un URL HTTPS senza credenziali")]);

export const reviewSettingsSchema = z.object({
  count: z.number().int().min(0).max(10_000_000).nullable(),
  rating: z.number().min(0).max(5).nullable(),
  googleUrl: webUrl,
  googlePlaceId: z.string().trim().max(255),
  images: z.array(z.object({
    url: z.string().max(500).regex(/^\/(?:files|brand)\/[a-zA-Z0-9/_-]+\.(?:webp|png|jpe?g)$/i, "Usa un’immagine caricata nella libreria"),
    alt: z.string().trim().max(240),
  }).strict()).max(24),
}).strict();

export function safeSocialUrl(value: unknown) {
  return typeof value === "string" && webUrl.safeParse(value).success ? value : "";
}
