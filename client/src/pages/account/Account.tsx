import { useEffect, useState } from "react";
import { Link, Route, Switch, useLocation, Redirect } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Dog, Star, Home, ShoppingBag, CreditCard, Bell, UserCog, LogOut, Plus, Pencil, Trash2 } from "lucide-react";
import { Mascot, BookingButton } from "@/components/brand";
import DogForm, { ageOf } from "@/components/DogForm";
import { Spinner, Empty, ErrorBox, Field, Check, Modal, StatusBadge, useToast } from "@/components/ui";
import { get, post, patch, del } from "@/lib/api";
import { useMe, useLogout } from "@/lib/auth";
import { usePublicSettings } from "@/lib/settings";
import { fmtLong, fmtDate, fmtDay, fmtDateTime, todayISO } from "@/lib/format";
import { enablePush, pushSupported } from "@/lib/push";
import { euro, SIZE_LABELS, PAYMENT_METHODS, PAYMENT_KINDS, ORDER_STATUS, BOARDING_STATUS, STATUS_COLORS } from "@shared/constants";

const NAV = [
  { href: "/account", label: "Panoramica", icon: Home },
  { href: "/account/appuntamenti", label: "Appuntamenti", icon: CalendarDays },
  { href: "/account/cani", label: "I miei cani", icon: Dog },
  { href: "/account/fidelity", label: "Fidelity Card", icon: Star },
  { href: "/account/pensione", label: "Pensione", icon: Home },
  { href: "/account/ordini", label: "Ordini", icon: ShoppingBag },
  { href: "/account/pagamenti", label: "Pagamenti", icon: CreditCard },
  { href: "/account/notifiche", label: "Notifiche", icon: Bell },
  { href: "/account/profilo", label: "Profilo e privacy", icon: UserCog },
];

export default function AccountArea() {
  const { data: me, isLoading } = useMe();
  const [loc] = useLocation();
  const logout = useLogout();
  if (isLoading) return <Spinner />;
  if (!me) return <Redirect to={`/login?next=${encodeURIComponent(loc)}`} />;
  if (me.role !== "customer") return <Redirect to="/admin" />;
  return (
    <div className="container-dp py-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div><p className="text-sm text-slate-500">Area personale</p><h1 className="text-2xl font-extrabold">Ciao {me.firstName}!</h1></div>
        <BookingButton />
      </div>
      <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
        <nav className="-mx-4 flex gap-1 overflow-x-auto px-4 lg:mx-0 lg:flex-col lg:px-0" aria-label="Area personale">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={`flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-sm font-bold ${loc === n.href ? "bg-brand-navy text-white" : "text-brand-navy hover:bg-brand-sky"}`}><n.icon size={16} />{n.label}</Link>
          ))}
          <button onClick={logout} className="flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-sm font-bold text-slate-500 hover:bg-slate-100"><LogOut size={16} /> Esci</button>
        </nav>
        <div className="min-w-0">
          <Switch>
            <Route path="/account" component={Overview} />
            <Route path="/account/appuntamenti" component={Appointments} />
            <Route path="/account/cani" component={Dogs} />
            <Route path="/account/fidelity" component={Loyalty} />
            <Route path="/account/pensione" component={Boarding} />
            <Route path="/account/ordini" component={Orders} />
            <Route path="/account/pagamenti" component={Payments} />
            <Route path="/account/notifiche" component={Notifications} />
            <Route path="/account/profilo" component={Profile} />
          </Switch>
        </div>
      </div>
    </div>
  );
}

function Overview() {
  const { data, isLoading } = useQuery<any>({ queryKey: ["acc-summary"], queryFn: () => get("/api/account/summary") });
  if (isLoading) return <Spinner />;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="card md:col-span-2">
        <h2 className="mb-2 font-bold">Prossimo appuntamento</h2>
        {data?.next ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><p className="text-lg font-bold text-brand-navy">{fmtLong(data.next.startAt)}</p><p className="text-sm text-slate-600">{data.next.dogName} · {data.next.serviceName}</p></div>
            <StatusBadge status={data.next.status} />
          </div>
        ) : <p className="text-sm text-slate-500">Nessun appuntamento in programma.</p>}
      </div>
      <Link href="/account/fidelity" className="card flex items-center gap-4 transition hover:-translate-y-0.5">
        <Mascot kind="fidelity" className="h-20" />
        <div><p className="label">Fidelity Card</p><p className="text-3xl font-extrabold text-brand-navy">{data?.points ?? 0} <span className="text-base">punti</span></p></div>
      </Link>
      <Link href="/account/notifiche" className="card flex items-center gap-4 transition hover:-translate-y-0.5">
        <Bell className="text-brand-turquoise" size={36} />
        <div><p className="label">Notifiche</p><p className="text-3xl font-extrabold text-brand-navy">{data?.unread ?? 0} <span className="text-base">da leggere</span></p></div>
      </Link>
    </div>
  );
}

function Appointments() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isLoading } = useQuery<any[]>({ queryKey: ["acc-apps"], queryFn: () => get("/api/account/appointments") });
  const [changeFor, setChangeFor] = useState<any>(null);
  const [msg, setMsg] = useState({ kind: "modifica", message: "" });
  const [err, setErr] = useState<unknown>(null);
  const params = new URLSearchParams(window.location.search);
  useEffect(() => { if (params.get("pagamento") === "ok") toast("Pagamento completato: la conferma arriverà a breve"); }, []); // eslint-disable-line

  const act = async (id: number, action: string) => {
    try { await post(`/api/account/appointments/${id}/action`, { action }); qc.invalidateQueries({ queryKey: ["acc-apps"] }); toast("Fatto"); } catch (e: any) { toast(e.message, "err"); }
  };
  const pay = async (id: number) => { try { const r = await post(`/api/account/appointments/${id}/pay`); window.location.href = r.url; } catch (e: any) { toast(e.message, "err"); } };
  const sendChange = async () => {
    setErr(null);
    try { await post(`/api/account/appointments/${changeFor.id}/change-request`, msg); setChangeFor(null); toast("Richiesta inviata al salone"); qc.invalidateQueries({ queryKey: ["acc-apps"] }); } catch (e) { setErr(e); }
  };
  if (isLoading) return <Spinner />;
  if (!data?.length) return <Empty>Non hai ancora appuntamenti. <Link href="/richiedi-prenotazione" className="font-bold underline">Richiedi la prenotazione on Line</Link></Empty>;
  const now = Date.now();
  const upcoming = data.filter((a) => new Date(a.startAt).getTime() >= now && !["annullata", "rifiutata"].includes(a.status));
  const past = data.filter((a) => !upcoming.includes(a));
  const Card = ({ a }: { a: any }) => (
    <div className="card" style={{ borderLeft: `6px solid ${STATUS_COLORS[a.status]}` }}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-bold text-brand-navy">{fmtLong(a.startAt)}</p>
          <p className="text-sm text-slate-600">{a.dogName} · {a.serviceName}{a.operatorName ? ` · con ${a.operatorName}` : ""}</p>
        </div>
        <StatusBadge status={a.status} />
      </div>
      {a.status === "proposta" && a.proposedStartAt && (
        <div className="mt-3 rounded-xl bg-pink-50 p-3 text-sm">
          Dog's Planet ti propone: <b>{fmtLong(a.proposedStartAt)}</b>
          <div className="mt-2 flex gap-2"><button className="btn-primary btn-sm" onClick={() => act(a.id, "accetta_proposta")}>Accetta</button><button className="btn-outline btn-sm" onClick={() => act(a.id, "rifiuta_proposta")}>Rifiuta</button></div>
        </div>
      )}
      {a.status === "attesa_pagamento" && (
        <div className="mt-3 rounded-xl bg-sky-50 p-3 text-sm">
          Pagamento richiesto: <b>{a.paymentMode === "saldo" ? euro(a.finalPriceCents ?? a.estimatedPriceCents) : euro(a.depositCents)}</b> ({a.paymentMode === "saldo" ? "saldo" : "acconto"}){a.paidCents > 0 && <> · già versati {euro(a.paidCents)}</>}
          <div className="mt-2"><button className="btn-primary btn-sm" onClick={() => pay(a.id)}>Paga on line</button></div>
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-500">
        {(a.finalPriceCents ?? a.estimatedPriceCents) != null && <span>Prezzo {a.finalPriceCents != null ? "" : "indicativo "}{euro(a.finalPriceCents ?? a.estimatedPriceCents)}</span>}
        {a.changeRequest && <span className="badge bg-amber-100 text-amber-800">Richiesta inviata: {a.changeRequest}</span>}
      </div>
      {upcoming.includes(a) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {["richiesta", "in_valutazione"].includes(a.status) && <button className="btn-outline btn-sm" onClick={() => confirm("Ritirare la richiesta?") && act(a.id, "annulla")}>Ritira richiesta</button>}
          {["confermata", "attesa_pagamento", "proposta"].includes(a.status) && <button className="btn-outline btn-sm" onClick={() => { setChangeFor(a); setMsg({ kind: "modifica", message: "" }); }}>Chiedi modifica o cancellazione</button>}
        </div>
      )}
    </div>
  );
  return (
    <div className="space-y-6">
      <section><h2 className="mb-3 text-xl font-bold">In programma</h2>{upcoming.length ? <div className="space-y-3">{upcoming.map((a) => <Card key={a.id} a={a} />)}</div> : <Empty>Nessun appuntamento in programma.</Empty>}</section>
      <section><h2 className="mb-3 text-xl font-bold">Storico trattamenti</h2>
        <div className="overflow-x-auto"><table className="table-dp"><thead><tr><th>Data</th><th>Cane</th><th>Servizio</th><th>Operatore</th><th>Stato</th></tr></thead>
          <tbody>{past.map((a) => <tr key={a.id}><td>{fmtDateTime(a.startAt)}</td><td>{a.dogName}</td><td>{a.serviceName}</td><td>{a.operatorName || "—"}</td><td><StatusBadge status={a.status} /></td></tr>)}</tbody></table></div>
      </section>
      <Modal open={!!changeFor} onClose={() => setChangeFor(null)} title="Richiesta al salone">
        <div className="space-y-3">
          <Field label="Tipo"><select className="input" value={msg.kind} onChange={(e) => setMsg({ ...msg, kind: e.target.value })}><option value="modifica">Modifica</option><option value="cancellazione">Cancellazione</option></select></Field>
          <Field label="Messaggio"><textarea className="input" value={msg.message} onChange={(e) => setMsg({ ...msg, message: e.target.value })} placeholder="Es. posso spostare a giovedì pomeriggio?" /></Field>
          <ErrorBox error={err} />
          <button className="btn-primary" onClick={sendChange}>Invia</button>
        </div>
      </Modal>
    </div>
  );
}

function Dogs() {
  const qc = useQueryClient();
  const toast = useToast();
  const [, nav] = useLocation();
  const params = new URLSearchParams(window.location.search);
  const { data, isLoading } = useQuery<any[]>({ queryKey: ["my-dogs"], queryFn: () => get("/api/account/dogs") });
  const [editing, setEditing] = useState<any>(params.get("nuovo") ? {} : null);
  const save = async (d: any) => {
    if (editing?.id) await patch(`/api/account/dogs/${editing.id}`, d); else await post("/api/account/dogs", d);
    qc.invalidateQueries({ queryKey: ["my-dogs"] }); setEditing(null); toast("Scheda salvata");
    const next = params.get("next"); if (next && next.startsWith("/")) nav(next);
  };
  if (isLoading) return <Spinner />;
  return (
    <div>
      <div className="mb-4 flex items-center justify-between"><h2 className="text-xl font-bold">I miei cani</h2><button className="btn-primary btn-sm" onClick={() => setEditing({})}><Plus size={14} /> Aggiungi</button></div>
      {!data?.length ? <Empty>Registra il tuo primo cane per poter richiedere gli appuntamenti.</Empty> : (
        <div className="grid gap-4 sm:grid-cols-2">
          {data.map((d) => (
            <div key={d.id} className="card">
              <div className="flex items-start justify-between">
                <div><h3 className="text-lg font-bold">{d.name}</h3><p className="text-sm text-slate-600">{d.breed || "Razza non indicata"} · taglia {SIZE_LABELS[d.size].toLowerCase()}{d.weightKg ? ` · ${d.weightKg} kg` : ""}</p>{d.birthDate && <p className="text-xs text-slate-500">{ageOf(d.birthDate)}</p>}</div>
                <div className="flex gap-1">
                  <button className="btn-ghost btn-sm" onClick={() => setEditing(d)} aria-label="Modifica"><Pencil size={14} /></button>
                  <button className="btn-ghost btn-sm text-red-600" aria-label="Rimuovi" onClick={async () => { if (confirm(`Rimuovere ${d.name}?`)) { await del(`/api/account/dogs/${d.id}`); qc.invalidateQueries({ queryKey: ["my-dogs"] }); } }}><Trash2 size={14} /></button>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-1">{d.coatKnots && <span className="badge bg-amber-100 text-amber-800">Nodi</span>}{d.coatShedding && <span className="badge bg-amber-100 text-amber-800">Muta</span>}{d.aggressive && <span className="badge bg-red-100 text-red-700">Attenzione</span>}</div>
            </div>
          ))}
        </div>
      )}
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? `Scheda di ${editing.name}` : "Nuovo cane"} wide>
        {editing && <DogForm initial={editing.id ? editing : undefined} onSubmit={save} onCancel={() => setEditing(null)} />}
      </Modal>
    </div>
  );
}

function Loyalty() {
  const { data, isLoading } = useQuery<any>({ queryKey: ["acc-loyalty"], queryFn: () => get("/api/account/loyalty") });
  if (isLoading) return <Spinner />;
  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-navy via-brand-blue to-brand-turquoise p-6 text-white shadow-soft">
        <img src="/brand/logo-white.png" alt="" className="h-14 w-auto" />
        <p className="mt-6 text-sm uppercase tracking-widest text-sky-100">Fidelity Card</p>
        <p className="text-4xl font-extrabold">{data.card.points} punti</p>
        <p className="mt-4 font-mono text-lg tracking-widest">{data.card.code.replace(/(.{2})(.{4})(.{4})/, "$1 $2 $3")}</p>
        <Mascot kind="fidelity" className="absolute -bottom-2 right-2 h-32 opacity-95" />
      </div>
      <p className="text-sm text-slate-600">Mostra il codice in negozio per accumulare o usare i punti.</p>
      {data.rewards.length > 0 && (
        <section><h2 className="mb-3 text-xl font-bold">Premi disponibili</h2>
          <div className="grid gap-3 sm:grid-cols-2">{data.rewards.map((r: any) => (
            <div key={r.id} className="card flex items-center justify-between"><div><p className="font-bold">{r.name}</p><p className="text-xs text-slate-500">{r.description}</p></div><span className={`badge ${data.card.points >= r.pointsCost ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"}`}>{r.pointsCost} pt</span></div>
          ))}</div>
        </section>
      )}
      <section><h2 className="mb-3 text-xl font-bold">Movimenti</h2>
        {data.transactions.length ? <table className="table-dp"><tbody>{data.transactions.map((t: any) => <tr key={t.id}><td>{fmtDate(t.createdAt)}</td><td>{t.reason}</td><td className={`text-right font-bold ${t.points > 0 ? "text-green-700" : "text-red-600"}`}>{t.points > 0 ? "+" : ""}{t.points}</td></tr>)}</tbody></table> : <Empty>Nessun movimento.</Empty>}
      </section>
    </div>
  );
}

function Boarding() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: s } = usePublicSettings();
  const { data: dogs } = useQuery<any[]>({ queryKey: ["my-dogs"], queryFn: () => get("/api/account/dogs") });
  const { data, isLoading } = useQuery<any[]>({ queryKey: ["acc-boarding"], queryFn: () => get("/api/account/boarding") });
  const [f, setF] = useState({ dogId: 0, startDate: "", endDate: "", customerNotes: "" });
  const [err, setErr] = useState<unknown>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null);
    try { await post("/api/account/boarding", { ...f, dogId: Number(f.dogId), customerNotes: f.customerNotes || null }); toast("Richiesta inviata. Ti ricontatteremo per la conferma."); setF({ dogId: 0, startDate: "", endDate: "", customerNotes: "" }); qc.invalidateQueries({ queryKey: ["acc-boarding"] }); }
    catch (x) { setErr(x); }
  };
  if (isLoading) return <Spinner />;
  return (
    <div className="space-y-6">
      {s?.site?.boardingEnabled !== false && (
        <form onSubmit={submit} className="card space-y-3">
          <div className="flex items-center gap-3"><Mascot kind="pensione" className="h-16" /><h2 className="text-xl font-bold">Richiedi la pensione casalinga</h2></div>
          <p className="text-sm text-slate-600">{s?.boarding?.info}</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Cane"><select className="input" required value={f.dogId} onChange={(e) => setF({ ...f, dogId: Number(e.target.value) })}><option value={0} disabled>Seleziona</option>{dogs?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
            <Field label="Dal"><input type="date" className="input" required min={todayISO()} value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></Field>
            <Field label="Al"><input type="date" className="input" required min={f.startDate || todayISO()} value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} /></Field>
          </div>
          <Field label="Note (abitudini, alimentazione, farmaci…)"><textarea className="input" value={f.customerNotes} onChange={(e) => setF({ ...f, customerNotes: e.target.value })} /></Field>
          <ErrorBox error={err} />
          <button className="btn-primary" disabled={!f.dogId}>Invia richiesta</button>
        </form>
      )}
      <section><h2 className="mb-3 text-xl font-bold">Le tue richieste</h2>
        {data?.length ? <div className="space-y-2">{data.map(({ b, dogName }) => (
          <div key={b.id} className="card flex flex-wrap items-center justify-between gap-2">
            <div><p className="font-bold">{dogName}: {fmtDay(b.startDate)} → {fmtDay(b.endDate)}</p>{b.priceCents != null && <p className="text-sm">Prezzo {euro(b.priceCents)}</p>}</div>
            <div className="flex items-center gap-2"><StatusBadge status={b.status} labels={BOARDING_STATUS} colors={{ richiesta: "#F59E0B", confermata: "#00B6C8", rifiutata: "#EF4444", in_corso: "#2E8DE6", completata: "#16A34A", annullata: "#9CA3AF" }} />
              {["richiesta", "confermata"].includes(b.status) && <button className="btn-ghost btn-sm" onClick={async () => { if (confirm("Annullare la richiesta?")) { await post(`/api/account/boarding/${b.id}/cancel`); qc.invalidateQueries({ queryKey: ["acc-boarding"] }); } }}>Annulla</button>}</div>
          </div>
        ))}</div> : <Empty>Nessuna richiesta.</Empty>}
      </section>
    </div>
  );
}

function Orders() {
  const { data, isLoading } = useQuery<any[]>({ queryKey: ["acc-orders"], queryFn: () => get("/api/account/orders") });
  if (isLoading) return <Spinner />;
  if (!data?.length) return <Empty>Nessun ordine. <Link href="/pet-shop" className="font-bold underline">Vai al Pet Shop</Link></Empty>;
  return (
    <div className="space-y-3">{data.map((o) => (
      <div key={o.id} className="card">
        <div className="flex justify-between"><p className="font-bold">Ordine #{o.id} · {fmtDate(o.createdAt)}</p><span className="badge bg-brand-sky text-brand-navy">{ORDER_STATUS[o.status]}</span></div>
        <ul className="mt-2 text-sm text-slate-600">{o.items.map((i: any) => <li key={i.id}>{i.qty} × {i.name} – {euro(i.unitPriceCents * i.qty)}</li>)}</ul>
        <p className="mt-2 text-right font-bold">Totale {euro(o.totalCents)}</p>
      </div>
    ))}</div>
  );
}

function Payments() {
  const { data, isLoading } = useQuery<any[]>({ queryKey: ["acc-payments"], queryFn: () => get("/api/account/payments") });
  if (isLoading) return <Spinner />;
  if (!data?.length) return <Empty>Nessun pagamento registrato.</Empty>;
  return (
    <div className="overflow-x-auto"><table className="table-dp"><thead><tr><th>Data</th><th>Tipo</th><th>Metodo</th><th>Importo</th><th>Stato</th></tr></thead>
      <tbody>{data.map((p) => <tr key={p.id}><td>{fmtDate(p.paidAt ?? p.createdAt)}</td><td>{PAYMENT_KINDS[p.kind]}</td><td>{p.methodLabel || PAYMENT_METHODS[p.method]}</td><td className="font-bold">{p.kind === "rimborso" ? "−" : ""}{euro(p.amountCents)}</td><td>{p.status}</td></tr>)}</tbody></table></div>
  );
}

function Notifications() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<any[]>({ queryKey: ["acc-notifications"], queryFn: () => get("/api/account/notifications") });
  useEffect(() => { post("/api/account/notifications/read").then(() => qc.invalidateQueries({ queryKey: ["acc-summary"] })).catch(() => {}); }, [qc]);
  if (isLoading) return <Spinner />;
  if (!data?.length) return <Empty>Nessuna notifica.</Empty>;
  return <div className="space-y-2">{data.map((n) => (
    <Link key={n.id} href={n.url || "#"} className={`card block ${!n.readAt ? "border-brand-turquoise" : ""}`}><p className="font-bold">{n.title}</p><p className="text-sm text-slate-600">{n.body}</p><p className="mt-1 text-xs text-slate-400">{fmtDateTime(n.createdAt)}</p></Link>
  ))}</div>;
}

function Profile() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: me } = useMe();
  const [f, setF] = useState<any>(() => ({ ...me }));
  const [pw, setPw] = useState({ current: "", password: "" });
  const [err, setErr] = useState<unknown>(null);
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null);
    try {
      const fields = ["firstName", "lastName", "phone", "address", "city", "province", "cap", "country", "birthDate", "commEmail", "commPush", "commWhatsapp", "consentMarketing"];
      const body = Object.fromEntries(fields.map((k) => [k, f[k] === "" ? null : f[k]]));
      const u = await patch("/api/account/profile", body); qc.setQueryData(["me"], u); toast("Profilo aggiornato");
    } catch (x) { setErr(x); }
  };
  return (
    <div className="space-y-6">
      <form onSubmit={save} className="card space-y-3">
        <h2 className="text-xl font-bold">I tuoi dati</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nome"><input className="input" value={f.firstName || ""} onChange={set("firstName")} /></Field>
          <Field label="Cognome"><input className="input" value={f.lastName || ""} onChange={set("lastName")} /></Field>
          <Field label="Email"><input className="input bg-slate-50" value={f.email} disabled /></Field>
          <Field label="Telefono"><input className="input" value={f.phone || ""} onChange={set("phone")} /></Field>
          <Field label="Indirizzo"><input className="input" value={f.address || ""} onChange={set("address")} /></Field>
          <Field label="Comune"><input className="input" value={f.city || ""} onChange={set("city")} /></Field>
          <Field label="Provincia"><input className="input" value={f.province || ""} onChange={set("province")} /></Field>
          <Field label="CAP"><input className="input" value={f.cap || ""} onChange={set("cap")} /></Field>
          <Field label="Paese"><input className="input" value={f.country || ""} onChange={set("country")} /></Field>
          <Field label="Data di nascita"><input type="date" className="input" value={f.birthDate || ""} onChange={set("birthDate")} /></Field>
        </div>
        <h3 className="pt-2 font-bold">Comunicazioni e privacy</h3>
        <Check checked={!!f.commEmail} onChange={(v) => setF({ ...f, commEmail: v })} label="Ricevi conferme e promemoria via email" />
        <Check checked={!!f.commPush} onChange={(v) => setF({ ...f, commPush: v })} label="Ricevi notifiche push sul dispositivo" />
        <Check checked={!!f.commWhatsapp} onChange={(v) => setF({ ...f, commWhatsapp: v })} label="Possiamo contattarti su WhatsApp" />
        <Check checked={!!f.consentMarketing} onChange={(v) => setF({ ...f, consentMarketing: v })} label="Acconsento a ricevere promozioni e novità (marketing)" />
        <ErrorBox error={err} />
        <button className="btn-primary">Salva</button>
      </form>
      <div className="card space-y-3">
        <h2 className="text-xl font-bold">Notifiche su questo dispositivo</h2>
        {pushSupported() ? <button className="btn-outline" onClick={async () => { try { await enablePush(); toast("Notifiche attivate"); } catch (e: any) { toast(e.message, "err"); } }}>Attiva notifiche push</button> : <p className="text-sm text-slate-500">Su iPhone installa prima l'app (Condividi → Aggiungi a Home) per ricevere le notifiche.</p>}
      </div>
      <form className="card space-y-3" onSubmit={async (e) => { e.preventDefault(); try { await post("/api/auth/change-password", pw); toast("Password aggiornata"); setPw({ current: "", password: "" }); } catch (x: any) { toast(x.message, "err"); } }}>
        <h2 className="text-xl font-bold">Cambia password</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Password attuale"><input type="password" className="input" required value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></Field>
          <Field label="Nuova password"><input type="password" minLength={8} className="input" required value={pw.password} onChange={(e) => setPw({ ...pw, password: e.target.value })} /></Field>
        </div>
        <button className="btn-outline">Aggiorna password</button>
      </form>
      <div className="card"><h2 className="text-xl font-bold">I tuoi dati personali</h2><p className="mt-1 text-sm text-slate-600">Scarica una copia di tutti i dati che conserviamo su di te. Per la cancellazione dell'account scrivi a dogsplanetcernusco@gmail.com.</p><a href="/api/account/export" className="btn-outline mt-3">Scarica i miei dati</a></div>
    </div>
  );
}
