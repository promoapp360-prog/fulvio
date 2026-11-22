import { useQuery } from "@tanstack/react-query";
import { get } from "./api";

export function usePublicSettings() {
  return useQuery<any>({ queryKey: ["public-settings"], queryFn: () => get("/api/public/settings"), staleTime: 10 * 60_000 });
}
export function usePage(slug: string) {
  return useQuery<any>({ queryKey: ["page", slug], queryFn: () => get(`/api/public/pages/${slug}`), staleTime: 10 * 60_000, retry: false });
}
