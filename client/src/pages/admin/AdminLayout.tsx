import { useState } from "react";
import { Link, Route, Switch, useLocation, Redirect } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard, CalendarDays, Inbox, Users, Scissors, UserCog, Clock, Wallet, Droplets, Star, Package, Boxes, Truck, ShoppingCart,
  Home, FileText, Megaphone, BarChart3, ShieldCheck, Settings, Menu, X, LogOut, Globe, Database,
} from "lucide-react";
import { Logo } from "@/components/brand";
import { Spinner, Empty } from "@/components/ui";
import { get } from "@/lib/api";
import { useMe, useLogout, can, isStaffRole } from "@/lib/auth";
import Dashboard from "./Dashboard";
import Agenda, { Requests } from "./Agenda";
import { Customers, CustomerDetail, DogFields } from "./Crm";
import { Services, Operators } from "./Catalog";
import { Worklogs, Users as StaffUsers } from "./Staff";
import { Payments, SelfService, Loyalty } from "./Money";
import { Products, Stock, Suppliers, Orders, Boarding } from "./Shop";
import { Content, Marketing } from "./Content";
import { Stats } from "./Stats";
import { SettingsPage, Privacy, System } from "./System";

const MENU: { href: string; label: string; icon: any; perm: string; group: string }[] = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard, perm: "agenda", group: "" },
  { href: "/admin/agenda", label: "Agenda", icon: CalendarDays, perm: "agenda", group: "Appuntamenti" },
  { href: "/admin/richieste", label: "Richieste", icon: Inbox, perm: "richieste", group: "Appuntamenti" },
  { href: "/admin/clienti", label: "Clienti e cani", icon: Users, perm: "clienti", group: "CRM" },
  { href: "/admin/campi-cane", label: "Campi scheda cane", icon: FileText, perm: "clienti", group: "CRM" },
  { href: "/admin/servizi", label: "Servizi e listino", icon: Scissors, perm: "servizi", group: "Salone" },
  { href: "/admin/operatori", label: "Operatori e turni", icon: UserCog, perm: "operatori", group: "Salone" },
  { href: "/admin/ore", label: "Ore e compensi", icon: Clock, perm: "ore", group: "Salone" },
  { href: "/admin/pagamenti", label: "Pagamenti e incassi", icon: Wallet, perm: "pagamenti", group: "Cassa" },
  { href: "/admin/self-service", label: "Self-service", icon: Droplets, perm: "selfservice", group: "Cassa" },
  { href: "/admin/fidelity", label: "Fidelity Card", icon: Star, perm: "fidelity", group: "Cassa" },
  { href: "/admin/pensione", label: "Pensione casalinga", icon: Home, perm: "pensione", group: "Servizi extra" },
  { href: "/admin/prodotti", label: "Prodotti", icon: Package, perm: "shop", group: "Shop e magazzino" },
  { href: "/admin/ordini", label: "Ordini shop", icon: ShoppingCart, perm: "shop", group: "Shop e magazzino" },
  { href: "/admin/magazzino", label: "Magazzino", icon: Boxes, perm: "magazzino", group: "Shop e magazzino" },
  { href: "/admin/fornitori", label: "Fornitori", icon: Truck, perm: "magazzino", group: "Shop e magazzino" },
  { href: "/admin/contenuti", label: "Contenuti sito", icon: Globe, perm: "contenuti", group: "Sito e marketing" },
  { href: "/admin/marketing", label: "Promozioni e comunicazioni", icon: Megaphone, perm: "marketing", group: "Sito e marketing" },
  { href: "/admin/statistiche", label: "Statistiche", icon: BarChart3, perm: "statistiche", group: "Amministrazione" },
  { href: "/admin/utenti", label: "Utenti e permessi", icon: ShieldCheck, perm: "utenti", group: "Amministrazione" },
  { href: "/admin/privacy", label: "Contatti privacy", icon: FileText, perm: "utenti", group: "Amministrazione" },
  { href: "/admin/impostazioni", label: "Impostazioni", icon: Settings, perm: "impostazioni", group: "Amministrazione" },
  { href: "/admin/sistema", label: "Backup e log", icon: Database, perm: "admin", group: "Amministrazione" },
];

function Guard({ perm, children }: { perm: string; children: React.ReactNode }) {
  const { data: me } = useMe();
  const ok = perm === "admin" ? me?.role === "admin" : can(me ?? null, perm);
  return ok ? <>{children}</> : <Empty>Non hai i permessi per questa sezione.</Empty>;
}

export default function AdminArea() {
  const { data: me, isLoading } = useMe();
  const [loc] = useLocation();
  const [open, setOpen] = useState(false);
  const logout = useLogout();
  const { data: dash } = useQuery<any>({ queryKey: ["dashboard"], queryFn: () => get("/api/admin/dashboard"), enabled: isStaffRole(me ?? null), refetchInterval: 180_000 });
  if (isLoading) return <Spinner />;
  if (!me) return <Redirect to={`/login?next=${encodeURIComponent(loc)}`} />;
  if (!isStaffRole(me)) return <Redirect to="/account" />;
  const allowed = MENU.filter((m) => (m.perm === "admin" ? me.role === "admin" : can(me, m.perm)));
  const groups = Array.from(new Set(allowed.map((m) => m.group)));
  const badge = (href: string) => href === "/admin/richieste" ? (dash?.counts?.pending || 0) + (dash?.counts?.changes || 0) : href === "/admin/pensione" ? dash?.counts?.boarding : href === "/admin/ordini" ? dash?.counts?.orders : href === "/admin/magazzino" ? dash?.counts?.low_stock : 0;

  return (
    <div className="flex min-h-screen bg-slate-50">
      <aside className={`fixed inset-y-0 left-0 z-40 w-64 transform overflow-y-auto border-r border-slate-200 bg-white transition lg:static lg:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="flex items-center justify-between p-4"><Link href="/admin"><Logo className="h-14" /></Link><button className="lg:hidden" onClick={() => setOpen(false)} aria-label="Chiudi menu"><X /></button></div>
        <nav className="px-3 pb-6" aria-label="Gestionale">
          {groups.map((g) => (
            <div key={g} className="mb-3">
              {g && <p className="px-3 pb-1 pt-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">{g}</p>}
              {allowed.filter((m) => m.group === g).map((m) => {
                const active = m.href === "/admin" ? loc === "/admin" : loc.startsWith(m.href);
                const b = badge(m.href);
                return (
                  <Link key={m.href} href={m.href} onClick={() => setOpen(false)} className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold ${active ? "bg-brand-navy text-white" : "text-slate-700 hover:bg-brand-sky"}`}>
                    <m.icon size={16} /> <span className="flex-1">{m.label}</span>{b ? <span className="badge bg-amber-400 text-white">{b}</span> : null}
                  </Link>
                );
              })}
            </div>
          ))}
          <div className="mt-4 border-t pt-3">
            <Link href="/" className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-brand-sky"><Globe size={16} /> Vai al sito</Link>
            <button onClick={logout} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-brand-sky"><LogOut size={16} /> Esci</button>
          </div>
        </nav>
      </aside>
      {open && <div className="fixed inset-0 z-30 bg-black/30 lg:hidden" onClick={() => setOpen(false)} />}
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-slate-200 bg-white px-4">
          <button className="lg:hidden" onClick={() => setOpen(true)} aria-label="Apri menu"><Menu /></button>
          <p className="text-sm text-slate-500">Gestionale Dog's Planet</p>
          <p className="text-sm font-bold text-brand-navy">{me.firstName}</p>
        </header>
        <main className="p-4 sm:p-6">
          <Switch>
            <Route path="/admin"><Guard perm="agenda"><Dashboard /></Guard></Route>
            <Route path="/admin/agenda"><Guard perm="agenda"><Agenda /></Guard></Route>
            <Route path="/admin/richieste"><Guard perm="richieste"><Requests /></Guard></Route>
            <Route path="/admin/clienti/:id">{(p) => can(me, "clienti") ? <CustomerDetail id={Number(p.id)} /> : <Empty>Permesso negato</Empty>}</Route>
            <Route path="/admin/clienti"><Guard perm="clienti"><Customers /></Guard></Route>
            <Route path="/admin/campi-cane"><Guard perm="clienti"><DogFields /></Guard></Route>
            <Route path="/admin/servizi"><Guard perm="servizi"><Services /></Guard></Route>
            <Route path="/admin/operatori"><Guard perm="operatori"><Operators /></Guard></Route>
            <Route path="/admin/ore"><Guard perm="ore"><Worklogs /></Guard></Route>
            <Route path="/admin/pagamenti"><Guard perm="pagamenti"><Payments /></Guard></Route>
            <Route path="/admin/self-service"><Guard perm="selfservice"><SelfService /></Guard></Route>
            <Route path="/admin/fidelity"><Guard perm="fidelity"><Loyalty /></Guard></Route>
            <Route path="/admin/pensione"><Guard perm="pensione"><Boarding /></Guard></Route>
            <Route path="/admin/prodotti"><Guard perm="shop"><Products /></Guard></Route>
            <Route path="/admin/ordini"><Guard perm="shop"><Orders /></Guard></Route>
            <Route path="/admin/magazzino"><Guard perm="magazzino"><Stock /></Guard></Route>
            <Route path="/admin/fornitori"><Guard perm="magazzino"><Suppliers /></Guard></Route>
            <Route path="/admin/contenuti"><Guard perm="contenuti"><Content /></Guard></Route>
            <Route path="/admin/marketing"><Guard perm="marketing"><Marketing /></Guard></Route>
            <Route path="/admin/statistiche"><Guard perm="statistiche"><Stats /></Guard></Route>
            <Route path="/admin/utenti"><Guard perm="utenti"><StaffUsers /></Guard></Route>
            <Route path="/admin/privacy"><Guard perm="utenti"><Privacy /></Guard></Route>
            <Route path="/admin/impostazioni"><Guard perm="impostazioni"><SettingsPage /></Guard></Route>
            <Route path="/admin/sistema"><Guard perm="admin"><System /></Guard></Route>
            <Route><Empty>Sezione non trovata.</Empty></Route>
          </Switch>
        </main>
      </div>
    </div>
  );
}
