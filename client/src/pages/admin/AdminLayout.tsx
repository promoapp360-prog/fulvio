import { useState } from "react";
import { Link, Route, Switch, useLocation, Redirect } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  LayoutDashboard, CalendarDays, Inbox, Users, Scissors, UserCog, Clock, Wallet, Droplets, Star, Package, Boxes, Truck, ShoppingCart,
  Home, FileText, Megaphone, BarChart3, ShieldCheck, Settings, Menu, X, LogOut, Globe, Dog, CalendarClock, HandCoins, Percent, Search, RefreshCw,
} from "lucide-react";
import { Logo } from "@/components/brand";
import { Spinner, Empty, useToast } from "@/components/ui";
import { get } from "@/lib/api";
import { useMe, useLogout, can, isStaffRole } from "@/lib/auth";
import Dashboard from "./Dashboard";
import Agenda, { Requests } from "./Agenda";
import { Customers, CustomerDetail, DogsPage } from "./Crm";
import { Services, Operators, Availability } from "./Catalog";
import { Worklogs, Settlements, Users as StaffUsers } from "./Staff";
import { Payments, SelfService, Loyalty } from "./Money";
import { Products, Stock, Suppliers, Orders, Boarding } from "./Shop";
import { Content, SeoPage, Promotions, Communications } from "./Content";
import { Stats } from "./Stats";
import { SettingsPage, Privacy } from "./System";

// Menu amministrativo (punto 30): ogni voce visibile solo con il permesso corrispondente
const MENU: { href: string; label: string; icon: any; perm: string[]; group: string }[] = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard, perm: ["agenda_view"], group: "" },
  { href: "/admin/agenda", label: "Agenda", icon: CalendarDays, perm: ["agenda_view"], group: "Appuntamenti" },
  { href: "/admin/richieste", label: "Richieste prenotazioni", icon: Inbox, perm: ["richieste"], group: "Appuntamenti" },
  { href: "/admin/clienti", label: "Clienti", icon: Users, perm: ["clienti"], group: "Clienti" },
  { href: "/admin/cani", label: "Schede animali", icon: Dog, perm: ["clienti"], group: "Clienti" },
  { href: "/admin/servizi", label: "Gestione prestazioni e listino", icon: Scissors, perm: ["servizi", "impostazioni"], group: "Salone" },
  { href: "/admin/operatori", label: "Operatori", icon: UserCog, perm: ["personale"], group: "Salone" },
  { href: "/admin/turni", label: "Turni e disponibilità", icon: CalendarClock, perm: ["personale"], group: "Salone" },
  { href: "/admin/ore", label: "Ore lavorate", icon: Clock, perm: ["personale", "agenda_view"], group: "Personale" },
  { href: "/admin/compensi", label: "Compensi collaboratori", icon: HandCoins, perm: ["personale"], group: "Personale" },
  { href: "/admin/pagamenti", label: "Pagamenti", icon: Wallet, perm: ["incassi", "pagamenti"], group: "Cassa" },
  { href: "/admin/self-service", label: "Incassi self-service", icon: Droplets, perm: ["pagamenti", "incassi"], group: "Cassa" },
  { href: "/admin/fidelity", label: "Fidelity Card", icon: Star, perm: ["fidelity"], group: "Cassa" },
  { href: "/admin/pensione", label: "Pensione casalinga", icon: Home, perm: ["pensione"], group: "Servizi extra" },
  { href: "/admin/prodotti", label: "Prodotti", icon: Package, perm: ["shop"], group: "Shop e magazzino" },
  { href: "/admin/magazzino", label: "Magazzino", icon: Boxes, perm: ["magazzino"], group: "Shop e magazzino" },
  { href: "/admin/fornitori", label: "Fornitori", icon: Truck, perm: ["magazzino"], group: "Shop e magazzino" },
  { href: "/admin/ordini", label: "Ordini", icon: ShoppingCart, perm: ["shop"], group: "Shop e magazzino" },
  { href: "/admin/promozioni", label: "Promozioni", icon: Percent, perm: ["marketing"], group: "Marketing" },
  { href: "/admin/comunicazioni", label: "Comunicazioni", icon: Megaphone, perm: ["marketing"], group: "Marketing" },
  { href: "/admin/statistiche", label: "Statistiche", icon: BarChart3, perm: ["statistiche"], group: "Marketing" },
  { href: "/admin/contenuti", label: "Contenuti sito", icon: Globe, perm: ["contenuti"], group: "Sito" },
  { href: "/admin/seo", label: "SEO", icon: Search, perm: ["contenuti"], group: "Sito" },
  { href: "/admin/privacy", label: "Privacy e consensi", icon: FileText, perm: ["privacy"], group: "Amministrazione" },
  { href: "/admin/utenti", label: "Utenti e permessi", icon: ShieldCheck, perm: ["utenti"], group: "Amministrazione" },
  { href: "/admin/impostazioni", label: "Impostazioni", icon: Settings, perm: ["impostazioni", "fidelity", "personale"], group: "Amministrazione" },
];

function Guard({ perm, children }: { perm: string; children: React.ReactNode }) {
  const { data: me } = useMe();
  const ok = perm === "admin" ? me?.role === "admin" : can(me ?? null, ...perm.split(","));
  return ok ? <>{children}</> : <Empty>Non hai i permessi per questa sezione.</Empty>;
}

export default function AdminArea() {
  const { data: me, isLoading } = useMe();
  const [loc] = useLocation();
  const [open, setOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const qc = useQueryClient();
  const toast = useToast();
  const logout = useLogout();
  const { data: dash } = useQuery<any>({ queryKey: ["dashboard"], queryFn: () => get("/api/admin/dashboard"), enabled: isStaffRole(me ?? null), refetchInterval: 30_000 });
  const refresh = async () => {
    if (refreshing) return;
    if (!navigator.onLine) { toast("Sei offline: connettiti a Internet per aggiornare i dati.", "err"); return; }
    setRefreshing(true);
    try {
      await qc.refetchQueries({ type: "active" }, { throwOnError: true, cancelRefetch: false });
      toast("Dati aggiornati");
    } catch {
      toast("Non è stato possibile aggiornare tutti i dati. Riprova.", "err");
    } finally { setRefreshing(false); }
  };
  if (isLoading) return <Spinner />;
  if (!me) return <Redirect to={`/login?next=${encodeURIComponent(loc)}`} />;
  if (!isStaffRole(me)) return <Redirect to="/account" />;
  const allowed = MENU.filter((m) => can(me, ...m.perm));
  const groups = Array.from(new Set(allowed.map((m) => m.group)));
  const badge = (href: string) => href === "/admin/richieste" ? dash?.counts?.actionable_requests || 0 : href === "/admin/pensione" ? dash?.counts?.boarding : href === "/admin/ordini" ? dash?.counts?.orders : href === "/admin/magazzino" ? dash?.counts?.low_stock : href === "/admin/comunicazioni" ? dash?.counts?.failed_emails : 0;

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
                  <Link key={m.href} href={m.href} onClick={() => setOpen(false)} className={`relative flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold ${active ? "bg-brand-navy text-white" : "text-slate-700 hover:bg-brand-sky"}`}>
                    <m.icon size={16} /> <span className={`flex-1 ${m.href === "/admin/richieste" && b ? "pr-5" : ""}`}>{m.label}</span>{b ? <span className={`badge ${m.href === "/admin/richieste" ? "absolute -right-1 -top-1 min-w-5 rounded-full bg-red-600 px-1.5 text-center text-white shadow-sm motion-safe:animate-pulse" : "bg-amber-400 text-white"}`} aria-label={`${b} ${b === 1 ? "richiesta da lavorare" : "richieste da lavorare"}`}>{b > 99 ? "99+" : b}</span> : null}
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
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-2 border-b border-slate-200 bg-white px-4">
          <button className="lg:hidden" onClick={() => setOpen(true)} aria-label="Apri menu"><Menu /></button>
          <p className="hidden min-w-0 truncate text-sm text-slate-500 sm:block">Gestionale Dog's Planet</p>
          <div className="ml-auto flex shrink-0 items-center gap-3">
            <button type="button" onClick={refresh} disabled={refreshing} aria-busy={refreshing} className="btn-ghost min-h-11 gap-2 px-3 text-sm disabled:cursor-wait disabled:opacity-60" title="Aggiorna i dati della schermata">
              <RefreshCw size={16} aria-hidden="true" className={refreshing ? "motion-safe:animate-spin" : ""} />
              {refreshing ? "Aggiorno…" : "Aggiorna"}
            </button>
            <p className="max-w-24 truncate text-sm font-bold text-brand-navy">{me.firstName}</p>
          </div>
        </header>
        <main className="p-4 sm:p-6">
          <Switch>
            <Route path="/admin"><Guard perm="agenda_view"><Dashboard /></Guard></Route>
            <Route path="/admin/agenda"><Guard perm="agenda_view"><Agenda /></Guard></Route>
            <Route path="/admin/richieste"><Guard perm="richieste"><Requests /></Guard></Route>
            <Route path="/admin/clienti/:id">{(p) => <Guard perm="clienti"><CustomerDetail id={Number(p.id)} /></Guard>}</Route>
            <Route path="/admin/clienti"><Guard perm="clienti"><Customers /></Guard></Route>
            <Route path="/admin/cani"><Guard perm="clienti"><DogsPage /></Guard></Route>
            <Route path="/admin/servizi"><Guard perm="servizi,impostazioni"><Services /></Guard></Route>
            <Route path="/admin/listino"><Guard perm="servizi,impostazioni"><Services /></Guard></Route>
            <Route path="/admin/operatori"><Guard perm="personale"><Operators /></Guard></Route>
            <Route path="/admin/turni"><Guard perm="personale"><Availability /></Guard></Route>
            <Route path="/admin/ore"><Guard perm="personale,agenda_view"><Worklogs /></Guard></Route>
            <Route path="/admin/compensi"><Guard perm="personale"><Settlements /></Guard></Route>
            <Route path="/admin/pagamenti"><Guard perm="incassi,pagamenti"><Payments /></Guard></Route>
            <Route path="/admin/self-service"><Guard perm="pagamenti,incassi"><SelfService /></Guard></Route>
            <Route path="/admin/fidelity"><Guard perm="fidelity"><Loyalty /></Guard></Route>
            <Route path="/admin/pensione"><Guard perm="pensione"><Boarding /></Guard></Route>
            <Route path="/admin/prodotti"><Guard perm="shop"><Products /></Guard></Route>
            <Route path="/admin/magazzino"><Guard perm="magazzino"><Stock /></Guard></Route>
            <Route path="/admin/fornitori"><Guard perm="magazzino"><Suppliers /></Guard></Route>
            <Route path="/admin/ordini"><Guard perm="shop"><Orders /></Guard></Route>
            <Route path="/admin/promozioni"><Guard perm="marketing"><Promotions /></Guard></Route>
            <Route path="/admin/comunicazioni"><Guard perm="marketing"><Communications /></Guard></Route>
            <Route path="/admin/statistiche"><Guard perm="statistiche"><Stats /></Guard></Route>
            <Route path="/admin/contenuti"><Guard perm="contenuti"><Content /></Guard></Route>
            <Route path="/admin/seo"><Guard perm="contenuti"><SeoPage /></Guard></Route>
            <Route path="/admin/privacy"><Guard perm="privacy"><Privacy /></Guard></Route>
            <Route path="/admin/utenti"><Guard perm="utenti"><StaffUsers /></Guard></Route>
            <Route path="/admin/impostazioni"><Guard perm="impostazioni,fidelity,personale"><SettingsPage /></Guard></Route>
            <Route><Empty>Sezione non trovata.</Empty></Route>
          </Switch>
        </main>
      </div>
    </div>
  );
}
