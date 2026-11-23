import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { Menu, X, Phone, MessageCircle, Mail, MapPin, User, CalendarDays } from "lucide-react";
import { Logo, BookingButton } from "./brand";
import { useMe, isStaffRole } from "@/lib/auth";
import { useBusiness, usePublicSettings } from "@/lib/settings";
import CookieBanner from "./CookieBanner";
import { LEGAL_DEFAULTS } from "@shared/legal";
import InstallPrompt from "./InstallPrompt";

const NAV = [
  { href: "/toelettatura", label: "Toelettatura" },
  { href: "/servizi", label: "Servizi e listino" },
  { href: "/self-service", label: "Self-Service" },
  { href: "/pensione-casalinga", label: "Pensione Casalinga" },
  { href: "/fidelity-card", label: "Fidelity Card" },
  { href: "/pet-shop", label: "LaPappadiPoppy" },
  { href: "/chi-siamo", label: "Chi siamo" },
  { href: "/contatti", label: "Contatti" },
];

export function PublicLayout({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const [loc] = useLocation();
  const { data: me } = useMe();
  const { data: s } = usePublicSettings();
  const B = useBusiness();
  useEffect(() => { setOpen(false); window.scrollTo(0, 0); }, [loc]);
  useEffect(() => {
    if (!open) return;
    const close = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); menuButton.current?.focus(); } };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);
  const announcement = s?.site?.announcement;

  return (
    <div className="public-site flex min-h-screen flex-col pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:p-2">Vai al contenuto</a>
      {announcement && <div className="bg-brand-turquoise px-4 py-2 text-center text-sm font-bold text-white">{announcement}</div>}
      <header className="sticky top-0 z-40 border-b border-sky-100 bg-[#f4fbff]/95 backdrop-blur">
        <div className="container-dp flex h-[4.5rem] items-center justify-between gap-4 md:h-20">
          <div className="flex shrink-0 items-center gap-6">
            <Link href="/" aria-label="Dog's Planet – home"><Logo className="h-12 md:h-14" /></Link>
            <p className="hidden border-l border-sky-100 pl-6 text-sm leading-relaxed text-slate-500 lg:block">Toelettatura e cura del tuo cane<br /><span className="text-xs">Cernusco sul Naviglio</span></p>
          </div>
          <div className="flex shrink-0 items-center gap-1 sm:gap-3">
            <BookingButton className="hidden whitespace-nowrap md:inline-flex" />
            <Link href={me ? (isStaffRole(me) ? "/admin" : "/account") : "/login"} className="btn-ghost min-h-11 px-3" aria-label={me ? "Area personale" : "Accedi"}>
              <User size={20} /><span className="hidden sm:inline">{me ? (isStaffRole(me) ? "Gestionale" : "Area personale") : "Accedi"}</span>
            </Link>
            <button ref={menuButton} className="btn-ghost min-h-11 px-3 xl:hidden" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls="mobile-navigation" aria-label={open ? "Chiudi menu" : "Apri menu"}>{open ? <X /> : <Menu />}</button>
          </div>
        </div>
        <nav className="hidden border-t border-sky-100 xl:block" aria-label="Menu principale">
          <div className="container-dp flex items-center justify-between gap-1 py-1">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} aria-current={loc === n.href ? "page" : undefined} className={`flex min-h-12 flex-col justify-center whitespace-nowrap rounded-xl px-3 py-2 text-[13px] font-semibold leading-snug transition hover:bg-brand-sky ${loc === n.href ? "bg-brand-sky text-brand-navy" : "text-brand-navy"}`}>
                {n.label}{n.href === "/pet-shop" && !s?.site?.shopEnabled && <span className="mt-0.5 text-[10px] font-medium tracking-wide text-slate-500">Coming Soon</span>}
              </Link>
            ))}
          </div>
        </nav>
        {open && (
          <nav id="mobile-navigation" className="max-h-[calc(100dvh-8.5rem-env(safe-area-inset-bottom))] overflow-y-auto border-t border-sky-100 bg-white md:max-h-[calc(100dvh-5rem)] xl:hidden" aria-label="Menu mobile">
            <div className="container-dp grid gap-1 py-3">
              {NAV.map((n) => <Link key={n.href} href={n.href} onClick={() => setOpen(false)} aria-current={loc === n.href ? "page" : undefined} className={`rounded-xl px-3 py-3 font-semibold text-brand-navy hover:bg-brand-sky ${loc === n.href ? "bg-brand-sky" : ""}`}>{n.label}{n.href === "/pet-shop" && !s?.site?.shopEnabled && <span className="mt-0.5 block text-xs font-normal text-slate-500">Coming Soon</span>}</Link>)}
              <BookingButton className="mt-2" />
            </div>
          </nav>
        )}
      </header>

      <main id="main" className="flex-1">{children}</main>

      <Footer />
      {/* barra azioni rapide su smartphone */}
      <nav data-mobile-actions className="fixed inset-x-0 bottom-0 z-40 grid h-[calc(4rem+env(safe-area-inset-bottom))] grid-cols-3 gap-1 border-t border-sky-100 bg-white px-1 pb-[env(safe-area-inset-bottom)] text-[11px] font-semibold shadow-[0_-4px_18px_#0b3d9108] md:hidden" aria-label="Contatti rapidi e prenotazione">
        <a href={`tel:${B.phoneIntl}`} className="flex h-14 flex-col items-center justify-center gap-1 rounded-xl bg-[#e8f1fb] text-brand-navy" aria-label="Chiama Dog's Planet"><Phone size={19} aria-hidden="true" />Chiama</a>
        <a href={`https://wa.me/${B.whatsapp}`} target="_blank" rel="noreferrer" className="flex h-14 flex-col items-center justify-center gap-1 rounded-xl bg-[#168447] text-white" aria-label="Contatta Dog's Planet su WhatsApp"><MessageCircle size={19} aria-hidden="true" />WhatsApp</a>
        <Link href="/richiedi-prenotazione" className="flex h-14 flex-col items-center justify-center gap-0.5 rounded-xl bg-brand-navy px-1 text-center leading-tight text-white" aria-label="Richiedi la prenotazione online"><CalendarDays size={18} className="text-brand-turquoise" aria-hidden="true" /><span>Richiedi la prenotazione</span><span className="text-brand-turquoise">online</span></Link>
      </nav>
      <CookieBanner />
      <InstallPrompt />
    </div>
  );
}

export function Footer() {
  const { data: s } = usePublicSettings();
  const B = useBusiness();
  const legal={...LEGAL_DEFAULTS,...s?.legal};
  return (
    <footer className="bg-brand-navy text-white">
      <div className="container-dp grid grid-cols-2 gap-x-6 gap-y-8 py-10 lg:grid-cols-4">
        <div className="col-span-2 flex items-center gap-5 lg:col-span-1 lg:block">
          <Logo white className="h-14 shrink-0 lg:h-16" />
          <p className="max-w-xs text-xs leading-relaxed text-sky-100 lg:mt-4">Toelettatura professionale per cani a Cernusco sul Naviglio.</p>
        </div>
        <div className="col-span-2 sm:col-span-1">
          <h3 className="mb-3 font-display text-sm font-bold uppercase tracking-wider text-[#3fd5e4]">Negozio e contatti clienti</h3>
          <ul className="space-y-2 text-sm">
            <li><a className="flex items-center gap-2 hover:underline" href={`tel:${B.phoneIntl}`}><Phone size={16} /> {B.phone}</a></li>
            <li><a className="flex items-center gap-2 hover:underline" href={`https://wa.me/${B.whatsapp}`} target="_blank" rel="noreferrer"><MessageCircle size={16} /> WhatsApp</a></li>
            <li><a className="flex items-center gap-2 break-all hover:underline" href={`mailto:${B.email}`}><Mail size={16} /> {B.email}</a></li>
            <li className="flex items-start gap-2"><MapPin size={16} className="mt-0.5 shrink-0" /> {B.fullAddress}</li>
          </ul>
        </div>
        <div>
          <h3 className="mb-3 font-display text-sm font-bold uppercase tracking-wider text-[#3fd5e4]">Orari</h3>
          <p className="text-sm"><strong>Toelettatura</strong><br />{s?.business?.groomingHours || "Su appuntamento"}</p>
          <p className="mt-3 text-sm"><strong>Self-Service</strong><br />{s?.selfservice?.days || "Tutti i giorni, 365 giorni all'anno"}<br />{s?.selfservice?.hours || "08:00–22:00"}</p>
          <div className="mt-3 flex gap-3 text-sm">
            <a href={B.googleMapsUrl} target="_blank" rel="noreferrer" className="underline">Google Maps</a>
            <a href={B.appleMapsUrl} target="_blank" rel="noreferrer" className="underline">Apple Maps</a>
          </div>
        </div>
        <div>
          <h3 className="mb-3 font-display text-sm font-bold uppercase tracking-wider text-[#3fd5e4]">Informazioni</h3>
          <ul className="space-y-2 text-sm">
            <li><Link href="/privacy-policy" className="hover:underline">Privacy Policy</Link></li>
            <li><Link href="/cookie-policy" className="hover:underline">Cookie Policy</Link></li>
            <li><Link href="/condizioni-del-servizio" className="hover:underline">Condizioni del servizio</Link></li>
            <li><Link href="/installa-app" className="hover:underline">Installa l'app sul telefono</Link></li>
            <li><Link href="/admin" className="inline-flex min-h-11 items-center hover:underline">Admin</Link></li>
            <li><button className="min-h-11 text-left hover:underline" onClick={() => window.dispatchEvent(new Event("dp-cookie-open"))}>Gestisci preferenze cookie</button></li>
            {s?.site?.socialInstagram && <li><a href={s.site.socialInstagram} target="_blank" rel="noreferrer" className="hover:underline">Instagram</a></li>}
            {s?.site?.socialFacebook && <li><a href={s.site.socialFacebook} target="_blank" rel="noreferrer" className="hover:underline">Facebook</a></li>}
          </ul>
        </div>
      </div>
      <div className="border-t border-white/15">
        <div data-legal-footer className="container-dp py-5 text-xs leading-6 text-sky-100">
          <p><strong className="text-white">{legal.companyName}</strong> · {legal.legalForm} · Titolare {legal.owner}</p>
          <p><strong>Sede legale:</strong> {legal.registeredOffice}</p>
          <p className="break-words">REA {legal.rea} · CF e n. iscrizione Registro Imprese {legal.taxCode}{legal.vatNumber&&<> · P.IVA {legal.vatNumber}</>}</p>
          <p>PEC: <a className="break-all underline" href={`mailto:${legal.pec}`}>{legal.pec}</a></p>
          {!legal.vatNumber&&<p className="mt-1 text-amber-200">Informazioni legali in preparazione: Partita IVA da acquisire dal titolare prima della pubblicazione finale.</p>}
          <p className="mt-2 text-sky-200">© {new Date().getFullYear()} Dog's Planet – Pet Grooming · Realizzato da Promo App</p>
        </div>
      </div>
    </footer>
  );
}
