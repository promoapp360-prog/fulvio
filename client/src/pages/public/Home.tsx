import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Scissors, Clock, Heart, Star, Sparkles, ShieldCheck } from "lucide-react";
import { Logo, Mascot, BookingButton, type MascotKind } from "@/components/brand";
import { ContactCards, MapBox } from "@/components/Contacts";
import { usePublicSettings, usePage } from "@/lib/settings";
import { get } from "@/lib/api";
import { fmtDay } from "@/lib/format";

const SERVICES: { kind: MascotKind; title: string; text: string; href: string; soon?: boolean }[] = [
  { kind: "toelettatura", title: "Toelettatura", text: "Bagno, taglio, stripping e trattamenti su misura, eseguiti da operatori esperti.", href: "/toelettatura" },
  { kind: "self-service", title: "Self-Service", text: "Lava il tuo cane in autonomia, tutti i giorni dalle 08:00 alle 22:00.", href: "/self-service" },
  { kind: "pensione", title: "Pensione Casalinga", text: "Un ambiente familiare quando non puoi portarlo con te. Su richiesta.", href: "/pensione-casalinga" },
  { kind: "fidelity", title: "Fidelity Card", text: "Accumula punti con servizi e acquisti e ricevi vantaggi esclusivi.", href: "/fidelity-card" },
  { kind: "pet-shop", title: "Pet Shop", text: "Prodotti selezionati per il benessere del tuo cane.", href: "/pet-shop", soon: true },
];

export default function Home() {
  const { data: s } = usePublicSettings();
  const { data: home } = usePage("home");
  const { data: promos } = useQuery<any[]>({ queryKey: ["promos"], queryFn: () => get("/api/public/promotions") });
  const shopOn = !!s?.site?.shopEnabled;

  return (
    <>
      {/* HERO */}
      <section className="relative overflow-hidden bg-brand-sky">
        <div className="container-dp grid items-center gap-8 py-10 md:grid-cols-2 md:py-16">
          <div className="order-2 md:order-1">
            <Mascot kind="welcome" className="mb-2 h-28 sm:h-32" alt="La mascotte di Dog's Planet ti dà il benvenuto" />
            <h1 className="text-4xl font-extrabold leading-tight sm:text-5xl">{s?.site?.heroTitle || "Benvenuto da Dog's Planet!"}</h1>
            <p className="mt-4 max-w-xl text-lg text-slate-700">{s?.site?.heroText || home?.body}</p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <BookingButton size="lg" />
              <Link href="/servizi" className="btn-outline">Servizi e listino</Link>
            </div>
            <ul className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm font-semibold text-brand-navy">
              <li className="flex items-center gap-1.5"><ShieldCheck size={16} className="text-brand-turquoise" /> Operatori professionisti</li>
              <li className="flex items-center gap-1.5"><Clock size={16} className="text-brand-turquoise" /> Self-service 365 giorni</li>
              <li className="flex items-center gap-1.5"><Star size={16} className="text-brand-turquoise" /> Fidelity Card</li>
            </ul>
          </div>
          <div className="relative order-1 md:order-2">
            {s?.brand?.heroImageUrl ? <img src={s.brand.heroImageUrl} alt="Dog's Planet" className="aspect-[4/3] w-full rounded-[2.5rem] object-cover shadow-soft" /> : (
              <picture>
                <source srcSet="/brand/hero.webp" type="image/webp" />
                <img src="/brand/hero.jpg" alt="La mascotte di Dog's Planet sul prato" className="aspect-[4/3] w-full rounded-[2.5rem] object-cover shadow-soft" width={720} height={590} />
              </picture>
            )}
            <div className="absolute -bottom-6 left-1/2 w-[78%] -translate-x-1/2 rounded-3xl bg-white/95 p-4 shadow-soft backdrop-blur sm:left-auto sm:right-4 sm:w-64 sm:translate-x-0">
              <Logo className="mx-auto h-16" />
            </div>
          </div>
        </div>
        <svg viewBox="0 0 1440 60" className="block w-full text-white" preserveAspectRatio="none" aria-hidden><path fill="currentColor" d="M0 40c240-40 480-40 720 0s480 40 720 0v20H0z" /></svg>
      </section>

      {s?.brand?.bannerActive && s.brand.bannerText && (
        <section className="container-dp pt-6">
          <a href={s.brand.bannerUrl || "#"} className="flex flex-col items-center gap-3 overflow-hidden rounded-3xl bg-brand-navy text-white sm:flex-row">
            {s.brand.bannerImageUrl && <img src={s.brand.bannerImageUrl} alt="" className="h-32 w-full object-cover sm:w-64" />}
            <p className="p-5 text-lg font-bold">{s.brand.bannerText}</p>
          </a>
        </section>
      )}
      {promos && promos.length > 0 && (
        <section className="container-dp pt-6">
          {promos.map((p) => (
            <div key={p.id} className="mb-3 flex flex-wrap items-center gap-3 rounded-2xl bg-gradient-to-r from-brand-turquoise to-brand-blue p-4 text-white">
              <Sparkles /><strong>{p.title}</strong><span className="text-sm opacity-90">{p.description}</span>
              {p.code && <span className="badge bg-white/20">Codice {p.code}</span>}{p.endsAt && <span className="text-xs opacity-80">fino al {fmtDay(p.endsAt)}</span>}
            </div>
          ))}
        </section>
      )}

      {/* SERVIZI */}
      <section className="container-dp py-14">
        <h2 className="text-center text-3xl font-extrabold">I nostri servizi</h2>
        <p className="mx-auto mt-2 max-w-2xl text-center text-slate-600">Tutto quello che serve al tuo cane, in un unico pianeta.</p>
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-5">
          {SERVICES.map((x) => (
            <Link key={x.kind} href={x.href} className={`card group flex flex-col items-center text-center transition hover:-translate-y-1 ${x.kind === "toelettatura" ? "ring-2 ring-brand-turquoise lg:col-span-1" : ""} ${x.soon && !shopOn ? "opacity-80" : ""}`}>
              <div className="grid h-36 w-full place-items-center rounded-2xl bg-brand-sky"><Mascot kind={x.kind} className="h-32 transition group-hover:scale-105" /></div>
              <h3 className="mt-4 text-lg font-bold">{x.title}{x.soon && !shopOn && <span className="block text-xs font-semibold text-slate-500">(In arrivo)</span>}</h3>
              <p className="mt-1 text-sm text-slate-600">{x.text}</p>
            </Link>
          ))}
        </div>
      </section>

      {/* TOELETTATURA – funzione principale */}
      <section className="bg-brand-navy text-white">
        <div className="container-dp grid items-center gap-10 py-14 md:grid-cols-2">
          <div>
            <span className="badge bg-white/10 text-[#3fd5e4]">Il cuore di Dog's Planet</span>
            <h2 className="mt-3 text-3xl font-extrabold text-white sm:text-4xl">Toelettatura professionale</h2>
            <p className="mt-4 text-sky-100">Lavaggio, toelettatura completa, tosatura, taglio a forbice, stripping naturale, snodatura, rimozione della muta e servizi rapidi. Scegli il servizio e l'operatore che preferisci: ti confermiamo noi l'appuntamento.</p>
            <ol className="mt-6 space-y-3">
              {["Registrati e crea la scheda del tuo cane", "Scegli servizio, operatore, giorno e orario", "Invia la richiesta e attendi la conferma di Dog's Planet"].map((t, i) => (
                <li key={i} className="flex items-center gap-3"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-turquoise font-bold">{i + 1}</span>{t}</li>
              ))}
            </ol>
            <div className="mt-8"><Link href="/richiedi-prenotazione" className="inline-flex items-center rounded-full bg-white px-7 py-4 font-display text-base font-bold text-brand-navy shadow-soft hover:bg-brand-sky">Richiedi la prenotazione&nbsp;<span className="text-brand-turquoise">on Line</span></Link></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            {[{ i: Scissors, t: "Taglio e styling" }, { i: Sparkles, t: "Prodotti professionali" }, { i: Heart, t: "Cura e pazienza" }, { i: ShieldCheck, t: "Schede cane dettagliate" }].map((f) => (
              <div key={f.t} className="rounded-3xl bg-white/5 p-5 text-center"><f.i className="mx-auto text-[#3fd5e4]" size={30} /><p className="mt-2 font-bold">{f.t}</p></div>
            ))}
            <div className="col-span-2 flex justify-center"><Mascot kind="toelettatura" className="h-40" /></div>
          </div>
        </div>
      </section>

      {/* SELF-SERVICE */}
      <section className="container-dp grid items-center gap-8 py-14 md:grid-cols-[auto_1fr]">
        <div className="grid place-items-center rounded-[2rem] bg-brand-sky p-6"><Mascot kind="self-service" className="h-44" /></div>
        <div>
          <h2 className="text-3xl font-extrabold">Lavaggio Self-Service</h2>
          <p className="mt-2 text-xl font-bold text-brand-turquoise">{s?.selfservice?.days || "Tutti i giorni, 365 giorni all'anno"}, {s?.selfservice?.hours || "08:00–22:00"}</p>
          <p className="mt-3 text-slate-600">Postazioni attrezzate e diversi tipi di shampoo. Paghi con la tessera ricaricabile che trovi al distributore automatico in negozio. Nessuna prenotazione: vieni quando vuoi.</p>
          <Link href="/self-service" className="btn-outline mt-5">Come funziona</Link>
        </div>
      </section>

      {/* PENSIONE + FIDELITY */}
      <section className="bg-brand-sky">
        <div className="container-dp grid gap-6 py-14 md:grid-cols-2">
          <div className="card flex items-center gap-5">
            <Mascot kind="pensione" className="h-28 shrink-0" />
            <div><h2 className="text-2xl font-extrabold">Pensione Casalinga</h2><p className="mt-1 text-sm text-slate-600">Su richiesta e con disponibilità limitata, in un ambiente familiare.</p><Link href="/pensione-casalinga" className="mt-3 inline-block font-bold text-brand-blue">Scopri di più →</Link></div>
          </div>
          <div className="card flex items-center gap-5">
            <Mascot kind="fidelity" className="h-28 shrink-0" />
            <div><h2 className="text-2xl font-extrabold">Fidelity Card</h2><p className="mt-1 text-sm text-slate-600">La ricevi gratis registrandoti: punti a ogni servizio e acquisto.</p><Link href="/registrazione" className="mt-3 inline-block font-bold text-brand-blue">Registrati →</Link></div>
          </div>
        </div>
      </section>

      {/* PET SHOP (visibilità secondaria) */}
      <section className="container-dp py-12">
        <div className="flex flex-col items-center gap-5 rounded-[2rem] border border-sky-100 p-6 text-center sm:flex-row sm:text-left">
          <Mascot kind="pet-shop" className="h-28" />
          <div className="flex-1"><h2 className="text-2xl font-extrabold">Pet Shop {!shopOn && <span className="text-base font-semibold text-slate-500">(In arrivo)</span>}</h2>
            <p className="mt-1 text-slate-600">{shopOn ? "Scopri i prodotti selezionati per il tuo cane." : "Presto potrai acquistare on line i prodotti selezionati da Dog's Planet. Intanto li trovi in negozio."}</p></div>
          <Link href="/pet-shop" className="btn-outline">{shopOn ? "Vai allo shop" : "Scopri"}</Link>
        </div>
      </section>

      {/* SALONE + CONTATTI */}
      <section className="container-dp pb-16">
        <h2 className="text-3xl font-extrabold">Il salone</h2>
        <p className="mt-2 max-w-3xl text-slate-600">Ci trovi in Via Leonardo da Vinci 86 a Cernusco sul Naviglio. Chiamaci o scrivici su WhatsApp per qualsiasi informazione; per gli appuntamenti usa la richiesta on line.</p>
        <div className="mt-6"><ContactCards /></div>
        <div className="mt-6"><MapBox /></div>
      </section>
    </>
  );
}
