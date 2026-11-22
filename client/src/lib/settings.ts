import { useQuery } from "@tanstack/react-query";
import { get } from "./api";

export function usePublicSettings() {
  return useQuery<any>({ queryKey: ["public-settings"], queryFn: () => get("/api/public/settings"), staleTime: 10 * 60_000 });
}
export function usePage(slug: string) {
  return useQuery<any>({ queryKey: ["page", slug], queryFn: () => get(`/api/public/pages/${slug}`), staleTime: 10 * 60_000, retry: false });
}

import { BUSINESS } from "@shared/constants";
/** Dati di contatto modificabili dal gestionale (Impostazioni → Dati attività), con i valori iniziali come riserva. */
export function useBusiness() {
  const { data: s } = usePublicSettings();
  const b = { ...BUSINESS, ...(s?.business || {}) };
  const digits = String(b.phone || "").replace(/\D/g, "");
  const intl = digits.startsWith("39") ? `+${digits}` : `+39${digits}`;
  const full = `${b.address}, ${b.cap} ${b.city} (${b.province})`;
  return {
    ...b, phoneIntl: intl, whatsapp: intl.slice(1), fullAddress: full,
    googleMapsUrl: `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(full + ", Italia")}`,
    appleMapsUrl: `https://maps.apple.com/?daddr=${encodeURIComponent(full + ", Italia")}`,
    mapEmbedUrl: `https://www.google.com/maps?q=${encodeURIComponent(full + ", Italia")}&output=embed`,
  };
}
