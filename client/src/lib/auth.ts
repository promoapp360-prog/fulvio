import { useQuery, useQueryClient } from "@tanstack/react-query";
import { get, post } from "./api";
import { logoutOneSignal } from "./onesignal";

export type Me = {
  id: number; email: string; username?: string | null; role: "admin" | "manager" | "operator" | "customer"; permissions: string[]; mustChangePassword?: boolean; emailVerifiedAt?: string | null;
  firstName: string; lastName: string; phone: string | null; [k: string]: any;
} | null;

export function useMe() {
  return useQuery<Me>({ queryKey: ["me"], queryFn: () => get("/api/auth/me"), staleTime: 5 * 60_000 });
}

export const isStaffRole = (me: Me) => !!me && me.role !== "customer";
/** Stessa logica del backend (che resta l'unico controllo vincolante). Accetta più permessi alternativi. */
export function can(me: Me, ...perms: string[]) {
  if (!me) return false;
  if (me.role === "admin") return true;
  if (me.role === "customer") return false;
  return perms.some((p) => (me.role === "operator" && p === "agenda_view") || (me.permissions || []).includes(p));
}

export function useLogout() {
  const qc = useQueryClient();
  return async () => { await logoutOneSignal(); await post("/api/auth/logout"); qc.clear(); window.location.href = "/"; };
}
