import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Scissors, Clock, Heart, Star, Sparkles, ShieldCheck, House, ShoppingBag, CreditCard, ArrowUpRight, Check } from "lucide-react";
import { Mascot, BookingButton, type MascotKind } from "@/components/brand";
import { ContactCards, MapBox } from "@/components/Contacts";
import { usePublicSettings, usePage } from "@/lib/settings";
import { get } from "@/lib/api";
import { fmtDay } from "@/lib/format";
import "./Home.css";

const SERVICES: { kind: MascotKind; title: string; text: string; href: string }[] = [
  { kind: "toelettatura", title: "Toelettatura", text: "Bagno, taglio e trattamenti su misura, con cura e pazienza.", href: "/toelettatura" },
  { kind: "self-service", title: "Self-Service", text: "Il lavaggio in autonomia, ogni giorno dell’anno.", href: "/self-service" },
  { kind: "pensione", title: "Pensione Casalinga", text: "Un ambiente familiare quando non puoi portarlo con te.", href: "/pensione-casalinga" },
  { kind: "fidelity", title: "Fidelity Card", text: "Punti e vantaggi dedicati a te e al tuo cane.", href: "/fidelity-card" },
];
const STEPS = [
  { title: "Raccontaci del tuo cane", text: "Registrati e crea la sua scheda." },
  { title: "Scegli il tuo appuntamento", text: "Indica servizio, operatore, giorno e orario." },
  { title: "Attendi la nostra conferma", text: "La richiesta arriva al team di Dog’s Planet." },
];

export default function Home() {
  const { data: s } = usePublicSettings();
  const { data: home } = usePage("home");
  const { data: promos } = useQuery<any[]>({ queryKey: ["promos"], queryFn: () => get("/api/public/promotions") });
  const shopOn = !!s?.site?.shopEnabled;

  return (
    <div className="home-page">
      <section data-home-section="hero" className="home-hero" aria-labelledby="home-title">
        <div className="container-dp home-hero-layout">
          <div className="home-hero-copy">
            <p className="home-eyebrow">Toelettatura · Cernusco sul Naviglio</p>
            <h1 id="home-title">{s?.site?.heroTitle || "Benvenuto da Dog's Planet!"}</h1>
            <p className="home-intro">{s?.site?.heroText || home?.body}</p>
          </div>
          <figure className="home-hero-photo">
            {s?.brand?.heroImageUrl ? (
              <img src={s.brand.heroImageUrl} alt="Poppy, la mascotte di Dog's Planet" className="home-original-photo" />
            ) : (
              <picture className="home-photo-window">
                <source srcSet="/brand/hero.webp" type="image/webp" />
                <img src="/brand/hero.jpg" alt="Poppy, la mascotte di Dog's Planet, sul prato" className="home-original-photo" width={680} height={590} />
              </picture>
            )}
            <figcaption>Poppy, la nostra mascotte. La cura, ogni giorno.</figcaption>
          </figure>
          <div className="home-hero-actions">
            <BookingButton size="lg" className="home-booking" />
            <Link href="/servizi" className="home-text-link">Esplora servizi e listino <ArrowUpRight size={17} aria-hidden="true" /></Link>
            <ul className="home-hero-trust" aria-label="Le nostre attenzioni">
              <li><ShieldCheck size={17} aria-hidden="true" /> Operatori professionisti</li>
              <li><Heart size={17} aria-hidden="true" /> Cura su misura</li>
              <li><Star size={17} aria-hidden="true" /> Fidelity Card</li>
            </ul>
          </div>
        </div>
      </section>

      {s?.brand?.bannerActive && s.brand.bannerText && (
        <section className="container-dp pt-6" aria-label="Novità">
          <a href={s.brand.bannerUrl || "#"} className="flex flex-col items-center gap-3 overflow-hidden rounded-3xl bg-brand-navy text-white sm:flex-row">
            {s.brand.bannerImageUrl && <img src={s.brand.bannerImageUrl} alt="" className="max-h-40 w-full object-contain sm:w-64" />}
            <p className="p-5 text-lg font-bold">{s.brand.bannerText}</p>
          </a>
        </section>
      )}
      {promos && promos.length > 0 && (
        <section className="container-dp pt-6" aria-label="Promozioni">
          {promos.map((p) => (
            <div key={p.id} className="mb-3 flex flex-wrap items-center gap-3 rounded-2xl bg-brand-navy p-4 text-white">
              <Sparkles size={20} className="text-[#3fd5e4]" aria-hidden="true" />
              <strong>{p.title}</strong><span className="text-sm opacity-90">{p.description}</span>
              {p.code && <span className="badge bg-white/20">Codice {p.code}</span>}
              {p.endsAt && <span className="text-xs opacity-80">fino al {fmtDay(p.endsAt)}</span>}
            </div>
          ))}
        </section>
      )}

      <section data-home-section="services" className="home-services-section home-section" aria-labelledby="services-title">
        <div className="container-dp">
        <div className="home-section-heading">
          <div><p className="home-eyebrow">Un unico posto, tante attenzioni</p><h2 id="services-title">I nostri servizi</h2></div>
          <p>Dal primo bagnetto alla cura di ogni giorno. Trova quello che fa per voi.</p>
        </div>
        <div className="home-services-grid">
          {SERVICES.map((x) => (
            <Link key={x.kind} href={x.href} className={`home-service-card service-card ${x.kind === "toelettatura" ? "home-service-featured" : ""}`}>
              <div className="home-service-visual"><Mascot kind={x.kind} detail className="home-poppy-art" alt={`Poppy — ${x.title}`} /></div>
              <div className="home-service-copy">
                <h3>{x.title}</h3>
                <p>{x.text}</p>
                <span className="home-card-link" aria-hidden="true">Scopri di più <ArrowUpRight size={15} /></span>
              </div>
            </Link>
          ))}
        </div>
        </div>
      </section>

      <section data-home-section="grooming" className="home-grooming" aria-labelledby="grooming-title">
        <div className="container-dp home-section home-two-columns">
          <div>
            <p className="home-eyebrow">Il cuore di Dog’s Planet</p>
            <h2 id="grooming-title">Toelettatura professionale.<br /><span>Attenzioni tutte per lui.</span></h2>
            <p className="home-body">Lavaggio, taglio a forbice, tosatura, stripping e trattamenti specifici. Ci prendiamo cura del tuo cane rispettando le sue esigenze, con prodotti professionali e operatori esperti.</p>
            <ul className="home-grooming-benefits">
              {[{ icon: Scissors, text: "Taglio e styling" }, { icon: Sparkles, text: "Prodotti professionali" }, { icon: Heart, text: "Cura e pazienza" }, { icon: ShieldCheck, text: "Scheda cane dedicata" }].map(({ icon: Icon, text }) => (
                <li key={text}><Icon size={20} aria-hidden="true" /><span>{text}</span></li>
              ))}
            </ul>
          </div>
          <div className="home-process">
            <h3>La tua richiesta, in 3 passi</h3>
            <ol>
              {STEPS.map((step, i) => (
                <li key={step.title}><span className="home-step-number">{i + 1}</span><div><strong>{step.title}</strong><p>{step.text}</p></div></li>
              ))}
            </ol>
            <BookingButton className="w-full" />
            <p className="home-process-note">L’appuntamento è confermato solo dopo la risposta del team.</p>
          </div>
        </div>
      </section>

      <section data-home-section="self-service" className="home-self-service" aria-labelledby="self-title">
        <div className="container-dp home-section home-two-columns">
          <div>
            <p className="home-eyebrow">Il suo bagnetto, ai tuoi orari</p>
            <h2 id="self-title">Lavaggio Self-Service</h2>
            <p className="home-body">Postazioni attrezzate e diversi tipi di shampoo per lavare il tuo cane in autonomia. Tutto il necessario è qui: a prenderti cura di lui ci pensi tu.</p>
            <ul className="home-check-list">
              <li><Check size={18} aria-hidden="true" /> Nessuna prenotazione</li>
              <li><Check size={18} aria-hidden="true" /> Tessera ricaricabile disponibile in negozio</li>
            </ul>
            <Link href="/self-service" className="btn-outline mt-6">Scopri come funziona <ArrowUpRight size={16} aria-hidden="true" /></Link>
          </div>
          <aside className="home-hours-panel" aria-label="Orari Self-Service">
            <div className="home-hours-label"><Clock size={23} aria-hidden="true" /><span>Spazio al tuo tempo</span></div>
            <p className="home-hours-time">{s?.selfservice?.hours || "08:00–22:00"}</p>
            <p className="home-hours-days">{s?.selfservice?.days || "Tutti i giorni, 365 giorni all’anno"}</p>
            <div className="home-hours-bottom"><CreditCard size={20} aria-hidden="true" /><p>Entri, ricarichi la tessera<br />e il bagnetto può iniziare.</p></div>
          </aside>
        </div>
      </section>

      <section data-home-section="extras" className="container-dp home-section" aria-label="Altre attenzioni per il tuo cane">
        <div className="home-secondary-grid">
          <article className="home-secondary-card">
            <span className="home-icon-badge"><House size={25} aria-hidden="true" /></span>
            <div><h2>Pensione Casalinga</h2><p>Un ambiente familiare quando non puoi portarlo con te. Su richiesta, con disponibilità limitata.</p><Link href="/pensione-casalinga" className="home-text-link">Scopri la pensione <ArrowUpRight size={16} aria-hidden="true" /></Link></div>
          </article>
          <article className="home-secondary-card">
            <span className="home-icon-badge"><Star size={25} aria-hidden="true" /></span>
            <div><h2>Fidelity Card</h2><p>La ricevi gratis registrandoti. Accumula punti con servizi e acquisti e scopri i vantaggi riservati a te.</p><Link href="/registrazione" className="home-text-link">Registrati gratuitamente <ArrowUpRight size={16} aria-hidden="true" /></Link></div>
          </article>
        </div>
      </section>

      <section data-home-section="shop" className="container-dp home-shop-section" aria-labelledby="shop-title">
        <div className="home-shop-banner">
          <span className="home-icon-badge"><ShoppingBag size={27} aria-hidden="true" /></span>
          <div className="home-shop-copy"><h2 id="shop-title">LaPappadiPoppy</h2>{!shopOn && <p className="home-coming-soon">Coming Soon</p>}<p>{shopOn ? "Scopri i prodotti selezionati per il tuo cane." : "Stiamo preparando una selezione speciale per il suo benessere. Nel frattempo trovi i nostri prodotti in negozio."}</p></div>
          <Link href="/pet-shop" className="btn-outline">{shopOn ? "Vai allo shop" : "Scopri di più"}<ArrowUpRight size={16} aria-hidden="true" /></Link>
        </div>
      </section>

      <section data-home-section="contacts" className="container-dp home-section" aria-labelledby="salon-title">
        <div className="home-section-heading">
          <div><p className="home-eyebrow">Vieni a conoscerci</p><h2 id="salon-title">Il salone</h2></div>
          <p>Via Leonardo da Vinci 86, Cernusco sul Naviglio. Per gli appuntamenti usa la richiesta online; per informazioni chiamaci o scrivici.</p>
        </div>
        <div className="home-contact-grid"><ContactCards stacked /><MapBox compact /></div>
      </section>
    </div>
  );
}
