import { useQuery, useQueryClient } from "@tanstack/react-query";
import { get, post } from "./api";

export type Me = {
  id: number; email: string; role: "admin" | "staff" | "operator" | "customer"; permissions: string[];
  firstName: string; lastName: string; phone: string | null; [k: string]: any;
} | null;

export function useMe() {
  return useQuery<Me>({ queryKey: ["me"], queryFn: () => get("/api/auth/me"), staleTime: 5 * 60_000 });
}

export const isStaffRole = (me: Me) => !!me && me.role !== "customer";
export function can(me: Me, perm: string) {
  if (!me) return false;
  if (me.role === "admin") return true;
  if (me.role === "operator" && (perm === "agenda" || perm === "ore")) return true;
  return me.role !== "customer" && (me.permissions || []).includes(perm);
}

export function useLogout() {
  const qc = useQueryClient();
  return async () => { await post("/api/auth/logout"); qc.clear(); window.location.href = "/"; };
}
