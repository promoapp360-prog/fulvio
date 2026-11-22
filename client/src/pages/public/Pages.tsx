import { useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Clock, Users } from "lucide-react";
import CmsPage from "@/components/CmsPage";
import { BookingButton, Mascot } from "@/components/brand";
import { ContactCards, MapBox } from "@/components/Contacts";
import { Spinner, Field, Check, ErrorBox, useToast } from "@/components/ui";
import { get, post } from "@/lib/api";
import { usePublicSettings } from "@/lib/settings";
import { useMe } from "@/lib/auth";
import { euro, SIZE_LABELS, SIZES, WEEKDAYS } from "@shared/constants";

export function useServices() {
  return useQuery<any[]>({ queryKey: ["public-services"], queryFn: () => get("/api/public/services") });
}
export function useOperators() {
  return useQuery<any[]>({ queryKey: ["public-operators"], queryFn: () => get("/api/public/operators") });
}

function priceLabel(s: any) {
  const prices = [s.priceCents, ...s.variants.map((v: any) => v.priceCents)].filter((x) => x != null);
  if (!prices.length) return "Prezzo su richiesta";
  const min = Math.min(...prices);
  return `${s.priceFrom || prices.length > 1 ? "da " : ""}${euro(min)}`;
}

export function ServicesList({ compact = false }: { compact?: boolean }) {
  const { data, isLoading } = useServices();
  const { data: ops } = useOperators();
  if (isLoading) return <Spinner />;
  const cats = Array.from(new Set((data || []).map((s) => s.category)));
  return (
    <div className="space-y-10">
      {cats.map((c) => (
        <div key={c}>
          <h2 className="mb-4 text-2xl font-extrabold">{c}</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {data!.filter((s) => s.category === c).map((s) => (
              <article key={s.id} className="card">
                <div className="flex min-w-0 flex-col items-start gap-2 sm:flex-row sm:justify-between sm:gap-3">
                  <h3 className="min-w-0 break-words text-lg font-bold">{s.name}</h3>
                  <span className="shrink-0 rounded-full bg-brand-sky px-3 py-1 text-sm font-bold text-brand-navy">{priceLabel(s)}</span>
                </div>
                {s.description && <p className="mt-2 text-sm text-slate-600">{s.description}</p>}
                {!compact && (
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs font-semibold text-slate-500">
                    <span className="flex items-center gap-1"><Clock size={14} /> circa {s.durationMin} min</span>
                    {ops && s.operatorIds.length > 0 && <span className="flex items-center gap-1"><Users size={14} /> {ops.filter((o) => s.operatorIds.includes(o.id)).map((o) => o.name).join(", ")}</span>}
                  </div>
                )}
                {!compact && s.variants.length > 0 && (
                  <table className="mt-3 w-full text-sm">
                    <tbody>{SIZES.map((sz) => { const v = s.variants.find((x: any) => x.size === sz); return v ? <tr key={sz} className="border-t border-slate-100"><td className="py-1">Taglia {SIZE_LABELS[sz].toLowerCase()}</td><td className="py-1 text-right font-semibold">{v.priceCents != null ? euro(v.priceCents) : "su richiesta"}{v.durationMin ? ` · ${v.durationMin} min` : ""}</td></tr> : null; })}</tbody>
                  </table>
                )}
              </article>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function ServiziPage() {
  return (
    <CmsPage slug="servizi" mascot="toelettatura" fallbackTitle="Servizi e listino">
      <div className="mt-8"><ServicesList /></div>
      <p className="mt-8 rounded-2xl bg-brand-sky p-4 text-sm text-brand-navy">Prezzi e durate sono indicativi: possono variare in base a taglia, condizioni del pelo, presenza di nodi e trattamenti aggiuntivi. <strong>Il prezzo definitivo è confermato da Dog's Planet.</strong></p>
      <div className="mt-8 text-center"><BookingButton size="lg" /></div>
    </CmsPage>
  );
}

export function ToelettaturaPage() {
  const { data: ops } = useOperators();
  return (
    <CmsPage slug="toelettatura" mascot="toelettatura" fallbackTitle="Toelettatura">
      <div className="my-8"><BookingButton size="lg" /></div>
      <h2 className="mb-4 mt-10 text-2xl font-extrabold">Il nostro team</h2>
      <div className="grid gap-4 sm:grid-cols-3">
        {(ops || []).map((o) => (
          <div key={o.id} className="card">
            <div className="flex items-center gap-3"><span className="grid h-12 w-12 place-items-center rounded-full font-display text-lg font-bold text-white" style={{ background: o.color }}>{o.name[0]}</span><h3 className="text-lg font-bold">{o.name}</h3></div>
            {o.bio && <p className="mt-2 text-sm text-slate-600">{o.bio}</p>}
            <p className="mt-3 text-xs font-semibold text-slate-500">{Array.from(new Set(o.shifts.map((s: any) => WEEKDAYS[s.weekday]))).join(", ")}</p>
          </div>
        ))}
      </div>
      <h2 className="mb-4 mt-12 text-2xl font-extrabold">Servizi</h2>
      <ServicesList compact />
    </CmsPage>
  );
}

export function SelfServicePage() {
  const { data: s } = usePublicSettings();
  const { data: faqs } = useQuery<any[]>({ queryKey: ["faqs", "selfservice"], queryFn: () => get("/api/public/faqs?section=selfservice") });
  return (
    <CmsPage slug="self-service" mascot="self-service" fallbackTitle="Lavaggio Self-Service">
      <div className="my-8 grid gap-4 sm:grid-cols-2">
        <div className="card"><p className="label">Giorni</p><p className="text-xl font-bold text-brand-navy">{s?.selfservice?.days}</p></div>
        <div className="card"><p className="label">Orario</p><p className="text-xl font-bold text-brand-navy">{s?.selfservice?.hours}</p></div>
      </div>
      {faqs && faqs.length > 0 && <Faq items={faqs} />}
    </CmsPage>
  );
}

export function Faq({ items }: { items: any[] }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <section className="mt-10 max-w-3xl">
      <h2 className="mb-4 text-2xl font-extrabold">Domande frequenti</h2>
      <div className="divide-y divide-slate-100 rounded-2xl border border-slate-100">
        {items.map((f) => (
          <div key={f.id}>
            <button className="flex w-full items-center justify-between gap-3 p-4 text-left font-bold text-brand-navy" onClick={() => setOpen(open === f.id ? null : f.id)} aria-expanded={open === f.id}>
              {f.question}<ChevronDown size={18} className={`shrink-0 transition ${open === f.id ? "rotate-180" : ""}`} />
            </button>
            {open === f.id && <p className="px-4 pb-4 text-sm text-slate-600">{f.answer}</p>}
          </div>
        ))}
      </div>
    </section>
  );
}

export function PensionePage() {
  const { data: me } = useMe();
  return (
    <CmsPage slug="pensione-casalinga" mascot="pensione" fallbackTitle="Pensione Casalinga">
      <div className="mt-8"><Link href={me ? "/account/pensione" : "/login?next=/account/pensione"} className="btn-primary">Invia una richiesta di pensione</Link></div>
    </CmsPage>
  );
}

export function FidelityPage() {
  const { data: me } = useMe();
  const { data: s } = usePublicSettings();
  return (
    <CmsPage slug="fidelity-card" mascot="fidelity" fallbackTitle="Fidelity Card">
      {s?.loyalty?.enabled && <p className="mt-6 font-bold text-brand-navy">Ogni euro speso vale {s.loyalty.pointsPerEuro} punt{s.loyalty.pointsPerEuro === 1 ? "o" : "i"}.</p>}
      <div className="mt-6"><Link href={me ? "/account/fidelity" : "/registrazione"} className="btn-primary">{me ? "Vedi la tua Fidelity Card" : "Registrati e ricevi la tua card"}</Link></div>
    </CmsPage>
  );
}

export function ContattiPage() {
  const toast = useToast();
  const [f, setF] = useState({ name: "", email: "", phone: "", message: "", consent: false, website: "" });
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null); setBusy(true);
    try { await post("/api/public/contact", f); toast("Messaggio inviato, ti risponderemo al più presto"); setF({ name: "", email: "", phone: "", message: "", consent: false, website: "" }); }
    catch (x) { setErr(x); } finally { setBusy(false); }
  };
  return (
    <CmsPage slug="contatti" fallbackTitle="Contatti">
      <div className="mt-8"><ContactCards /></div>
      <div className="mt-8 grid gap-8 lg:grid-cols-2">
        <MapBox />
        <form onSubmit={submit} className="card space-y-3">
          <h2 className="text-xl font-bold">Scrivici</h2>
          <Field label="Nome"><input className="input" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Email"><input type="email" className="input" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
            <Field label="Telefono"><input className="input" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
          </div>
          <Field label="Messaggio"><textarea className="input min-h-[120px]" required value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} /></Field>
          <input className="hidden" tabIndex={-1} autoComplete="off" value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} aria-hidden />
          <Check checked={f.consent} onChange={(v) => setF({ ...f, consent: v })} label={<>Ho letto la <Link href="/privacy-policy" className="underline">Privacy Policy</Link></>} />
          <ErrorBox error={err} />
          <button className="btn-primary" disabled={busy || !f.consent}>Invia messaggio</button>
        </form>
      </div>
    </CmsPage>
  );
}

export function NotFound() {
  return (
    <div className="container-dp flex flex-col items-center py-20 text-center">
      <Mascot kind="welcome" className="h-40" />
      <h1 className="mt-4 text-3xl font-extrabold">Pagina non trovata</h1>
      <p className="mt-2 text-slate-600">Anche il nostro cane ha perso la pista…</p>
      <Link href="/" className="btn-primary mt-6">Torna alla home</Link>
    </div>
  );
}
