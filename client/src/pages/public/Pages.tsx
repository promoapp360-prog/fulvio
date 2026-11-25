import { useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import CmsPage from "@/components/CmsPage";
import { BookingButton, Mascot } from "@/components/brand";
import { ContactCards, MapBox } from "@/components/Contacts";
import { Spinner, Field, Check, ErrorBox, useToast } from "@/components/ui";
import { get, post } from "@/lib/api";
import { usePublicSettings } from "@/lib/settings";
import { useMe } from "@/lib/auth";
import { euro } from "@shared/constants";
import BookingSteps, { QuietHours } from "@/components/BookingSteps";

export function useServices(catalog = false) {
  return useQuery<any[]>({
    queryKey: ["public-services", catalog ? "catalog" : "all"],
    queryFn: () => get(`/api/public/services${catalog ? "?view=catalog" : ""}`),
  });
}
export function useOperators() {
  return useQuery<any[]>({ queryKey: ["public-operators"], queryFn: () => get("/api/public/operators") });
}

const SIZE_NAMES: Record<string, string> = { mini: "mini", piccola: "piccola", media: "media", grande: "grande", gigante: "gigante" };
const COAT_LENGTH_NAMES: Record<string, string> = { corto: "corto", medio: "medio", lungo: "lungo" };

function priceLabel(s: any, hourlyRateCents?: number) {
  if (s.pricingType === "percentuale") return `+${(s.percentageBasisPoints || 0) / 100}%`;
  if (s.pricingType === "orario") return `${euro(hourlyRateCents ?? s.priceCents ?? 0)}/ora`;
  if (s.pricingType === "fascia" && s.priceCents != null && s.priceMaxCents != null) {
    return `da ${euro(s.priceCents)}–${euro(s.priceMaxCents)}`;
  }
  const rules = (s.pricingRules || []).filter((rule: any) => rule.active !== false);
  const prices = [s.priceCents, ...rules.map((rule: any) => rule.priceCents), ...(s.variants || []).map((v: any) => v.priceCents)].filter((x) => x != null);
  if (!prices.length) return "Prezzo su richiesta";
  const min = Math.min(...prices);
  return `${s.priceFrom || rules.some((rule: any) => rule.pricingType === "da") || prices.length > 1 ? "da " : ""}${euro(min)}`;
}

function tariffLabel(row: any, service: any, hourlyRateCents?: number) {
  const pricingType = row.pricingType || service.pricingType;
  if (pricingType === "percentuale") return `+${(row.percentageBasisPoints || 0) / 100}%`;
  if (pricingType === "orario") return `${euro(hourlyRateCents ?? row.priceCents ?? service.priceCents ?? 0)}/ora`;
  if (pricingType === "preventivo") return "da valutare";
  if (pricingType === "fascia" && row.priceCents != null && row.priceMaxCents != null) {
    return `da ${euro(row.priceCents)}–${euro(row.priceMaxCents)}`;
  }
  if (row.priceCents == null) return "Prezzo su richiesta";
  return `${pricingType === "da" || service.priceFrom ? "da " : ""}${euro(row.priceCents)}`;
}

function tariffRows(service: any) {
  const rules = (service.pricingRules || []).filter((rule: any) => rule.active !== false);
  if (rules.length) return rules.map((rule: any) => ({
    key: `rule-${rule.id ?? `${rule.size || ""}-${rule.coatLength || ""}-${rule.coatType || ""}`}`,
    label: [
      rule.size ? `Taglia ${SIZE_NAMES[rule.size] || rule.size}` : "",
      rule.coatLength ? `Pelo ${COAT_LENGTH_NAMES[rule.coatLength] || rule.coatLength}` : "",
      rule.coatType || "",
    ].filter(Boolean).join(" · ") || "Prezzo base",
    amount: rule,
  }));
  return (service.variants || []).filter((variant: any) => variant.priceCents != null).map((variant: any) => ({
    key: `variant-${variant.size}`,
    label: `Taglia ${SIZE_NAMES[variant.size] || variant.size}`,
    amount: variant,
  }));
}

export function ServicesList({ compact = false }: { compact?: boolean }) {
  const { data, isLoading } = useServices(true);
  const { data: settings } = usePublicSettings();
  if (isLoading) return <Spinner />;
  const cats = Array.from(new Set((data || []).map((s) => s.category)));
  const hourlyRateCents = settings?.pricing?.hourlyRateCents;
  const globalSupplements = Array.from(new Map((data || []).flatMap((service) => service.supplements || [])
    .filter((supplement: any) => supplement.serviceId == null)
    .map((supplement: any) => [supplement.id, supplement])).values());
  return (
    <div className="space-y-10">
      {cats.map((c) => (
        <div key={c}>
          <h2 className="mb-4 text-2xl font-extrabold">{c}</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {data!.filter((s) => s.category === c).map((s) => (
              <article key={s.id} className="card">
                <div className="flex min-w-0 flex-col items-start gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                  <h3 className="min-w-0 break-words text-lg font-bold">{s.name}</h3>
                  <span className="shrink-0 rounded-full bg-brand-sky px-3 py-1 text-sm font-bold text-brand-navy">{priceLabel(s, s.hourlyRateCents ?? hourlyRateCents)}</span>
                </div>
                {s.description && <p className="mt-2 text-sm text-slate-600">{s.description}</p>}
                {!compact && tariffRows(s).length > 0 && (
                  <dl className="mt-3 divide-y divide-slate-100 text-sm">
                    {tariffRows(s).map((row: any) => (
                      <div key={row.key} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-slate-100 py-2 first:border-t-0">
                        <dt>{row.label}</dt>
                        <dd className="font-semibold text-brand-navy">{tariffLabel(row.amount, s, s.hourlyRateCents ?? hourlyRateCents)}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </article>
            ))}
            {!compact && c === "Trattamenti aggiuntivi" && globalSupplements.map((supplement: any) => (
              <article key={`supplement-${supplement.id}`} className="card">
                <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <h3 className="text-lg font-bold">{supplement.name}</h3>
                  <span className="rounded-full bg-brand-sky px-3 py-1 text-sm font-bold text-brand-navy">
                    {supplement.pricingType === "percentuale" ? `+${(supplement.percentageBasisPoints || 0) / 100}%` : supplement.priceCents != null ? euro(supplement.priceCents) : "Su richiesta"}
                  </span>
                </div>
                <p className="mt-2 text-sm text-slate-600">Supplemento sul prezzo della prestazione, da confermare con il salone.</p>
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
      <h2 className="mt-6 text-2xl font-bold">La tua richiesta, in 3 passi</h2>
      <BookingSteps />
      <div className="mt-8"><ServicesList /></div>
      <p className="mt-8 rounded-2xl bg-brand-sky p-4 text-sm text-brand-navy">I prezzi sono indicativi: possono variare in base a taglia, condizioni del pelo, presenza di nodi e trattamenti aggiuntivi. <strong>Il prezzo definitivo è confermato da Dog's Planet.</strong></p>
      <div className="mt-8 text-center"><BookingButton size="lg" /></div>
    </CmsPage>
  );
}

export function ToelettaturaPage() {
  return (
    <CmsPage slug="toelettatura" mascot="toelettatura" fallbackTitle="Toelettatura">
      <h2 className="mt-6 text-2xl font-bold">La tua richiesta, in 3 passi</h2>
      <BookingSteps />
      <div className="my-8"><BookingButton size="lg" /></div>
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
      <QuietHours />
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
