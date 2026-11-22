import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Inbox, CalendarDays, Wallet, Droplets, Home, ShoppingCart, Boxes, Users, Clock } from "lucide-react";
import { PageTitle, Spinner, Empty, StatusBadge, useToast } from "@/components/ui";
import { get, post } from "@/lib/api";
import { useMe, can } from "@/lib/auth";
import { fmtTime } from "@/lib/format";
import { euro } from "@shared/constants";

export default function Dashboard() {
  const { data: me } = useMe();
  const toast = useToast();
  const { data, isLoading } = useQuery<any>({ queryKey: ["dashboard"], queryFn: () => get("/api/admin/dashboard") });
  if (isLoading) return <Spinner />;
  const c = data?.counts || {};
  const tiles = [
    { label: "Richieste da gestire", value: c.pending, href: "/admin/richieste", icon: Inbox, perm: "richieste", hot: c.pending > 0 },
    { label: "Modifiche richieste", value: c.changes, href: "/admin/richieste", icon: Inbox, perm: "richieste", hot: c.changes > 0 },
    { label: "In attesa di pagamento", value: c.awaiting_payment, href: "/admin/richieste", icon: Wallet, perm: "richieste" },
    { label: "Incassi di oggi", value: euro(c.today_cents), href: "/admin/pagamenti", icon: Wallet, perm: "pagamenti" },
    { label: "Self-service oggi", value: euro(c.today_selfservice), href: "/admin/self-service", icon: Droplets, perm: "selfservice" },
    { label: "Richieste pensione", value: c.boarding, href: "/admin/pensione", icon: Home, perm: "pensione", hot: c.boarding > 0 },
    { label: "Ordini da evadere", value: c.orders, href: "/admin/ordini", icon: ShoppingCart, perm: "shop" },
    { label: "Prodotti sotto scorta", value: c.low_stock, href: "/admin/magazzino", icon: Boxes, perm: "magazzino", hot: c.low_stock > 0 },
    { label: "Clienti", value: c.customers, href: "/admin/clienti", icon: Users, perm: "clienti" },
  ].filter((t) => can(me ?? null, t.perm));
  return (
    <div>
      <PageTitle title={`Buongiorno ${me?.firstName}!`} subtitle="Situazione di oggi">
        {me?.role === "operator" && <button className="btn-primary btn-sm" onClick={async () => { try { const r = await post("/api/admin/worklogs/clock"); toast(r.action === "entrata" ? `Entrata registrata alle ${r.log.clockIn}` : `Uscita registrata alle ${r.log.clockOut}`); } catch (e: any) { toast(e.message, "err"); } }}><Clock size={14} /> Timbra entrata/uscita</button>}
      </PageTitle>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {tiles.map((t) => (
          <Link key={t.label} href={t.href} className={`card flex items-center gap-3 transition hover:-translate-y-0.5 ${t.hot ? "ring-2 ring-amber-400" : ""}`}>
            <t.icon className="text-brand-turquoise" /><div><p className="text-xs font-bold uppercase text-slate-500">{t.label}</p><p className="text-2xl font-extrabold text-brand-navy">{t.value ?? 0}</p></div>
          </Link>
        ))}
      </div>
      <h2 className="mb-3 mt-8 flex items-center gap-2 text-xl font-bold"><CalendarDays size={20} /> Appuntamenti di oggi</h2>
      {!data?.today?.length ? <Empty>Nessun appuntamento oggi.</Empty> : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          <table className="table-dp"><thead><tr><th>Ora</th><th>Operatore</th><th>Cane</th><th>Servizio</th><th>Stato</th></tr></thead>
            <tbody>{data.today.map((a: any) => <tr key={a.id}><td className="font-bold">{fmtTime(a.start_at)}–{fmtTime(a.end_at)}</td><td><span className="mr-1 inline-block h-2.5 w-2.5 rounded-full" style={{ background: a.color }} />{a.operator}</td><td>{a.dog}</td><td>{a.service}</td><td><StatusBadge status={a.status} /></td></tr>)}</tbody></table>
        </div>
      )}
    </div>
  );
}
