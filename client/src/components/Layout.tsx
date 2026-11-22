import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { Menu, X, Phone, MessageCircle, Mail, MapPin, User, Navigation } from "lucide-react";
import { Logo, BookingButton } from "./brand";
import { useMe, isStaffRole } from "@/lib/auth";
import { useBusiness, usePublicSettings } from "@/lib/settings";
import CookieBanner from "./CookieBanner";
import InstallPrompt from "./InstallPrompt";

const NAV = [
  { href: "/toelettatura", label: "Toelettatura" },
  { href: "/servizi", label: "Servizi e listino" },
  { href: "/self-service", label: "Self-Service" },
  { href: "/pensione-casalinga", label: "Pensione Casalinga" },
  { href: "/fidelity-card", label: "Fidelity Card" },
  { href: "/pet-shop", label: "Pet Shop" },
  { href: "/chi-siamo", label: "Chi siamo" },
  { href: "/contatti", label: "Contatti" },
];

export function PublicLayout({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [loc] = useLocation();
  const { data: me } = useMe();
  const { data: s } = usePublicSettings();
  const B = useBusiness();
  useEffect(() => { setOpen(false); window.scrollTo(0, 0); }, [loc]);
  const announcement = s?.site?.announcement;

  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:p-2">Vai al contenuto</a>
      {announcement && <div className="bg-brand-turquoise px-4 py-2 text-center text-sm font-bold text-white">{announcement}</div>}
      <header className="sticky top-0 z-40 border-b border-sky-100 bg-white/95 backdrop-blur">
        <div className="container-dp flex h-20 items-center justify-between gap-4">
          <Link href="/" aria-label="Dog's Planet – home"><Logo className="h-14 sm:h-16" /></Link>
          <nav className="hidden items-center gap-1 xl:flex" aria-label="Menu principale">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className={`rounded-full px-3 py-2 text-sm font-bold transition hover:bg-brand-sky ${loc === n.href ? "text-brand-turquoise" : "text-brand-navy"}`}>
                {n.label}{n.href === "/pet-shop" && !s?.site?.shopEnabled && <span className="ml-1 text-[10px] font-semibold text-slate-400">(in arrivo)</span>}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <BookingButton className="hidden lg:inline-flex" />
            <Link href={me ? (isStaffRole(me) ? "/admin" : "/account") : "/login"} className="btn-ghost" aria-label={me ? "Area personale" : "Accedi"}>
              <User size={20} /><span className="hidden sm:inline">{me ? (isStaffRole(me) ? "Gestionale" : "Area personale") : "Accedi"}</span>
            </Link>
            <button className="btn-ghost xl:hidden" onClick={() => setOpen(!open)} aria-expanded={open} aria-label="Apri menu">{open ? <X /> : <Menu />}</button>
          </div>
        </div>
        {open && (
          <nav className="border-t border-sky-100 bg-white xl:hidden" aria-label="Menu mobile">
            <div className="container-dp grid gap-1 py-3">
              {NAV.map((n) => <Link key={n.href} href={n.href} className="rounded-xl px-3 py-3 font-bold text-brand-navy hover:bg-brand-sky">{n.label}</Link>)}
              <BookingButton className="mt-2" />
            </div>
          </nav>
        )}
      </header>

      <main id="main" className="flex-1">{children}</main>

      <Footer />
      {/* barra azioni rapide su smartphone */}
      <div className="sticky bottom-0 z-30 grid grid-cols-3 border-t border-sky-100 bg-white text-xs font-bold text-brand-navy md:hidden">
        <a href={`tel:${B.phoneIntl}`} className="flex flex-col items-center gap-0.5 py-2"><Phone size={18} />Chiama</a>
        <a href={`https://wa.me/${B.whatsapp}`} target="_blank" rel="noreferrer" className="flex flex-col items-center gap-0.5 py-2"><MessageCircle size={18} />WhatsApp</a>
        <a href={B.googleMapsUrl} target="_blank" rel="noreferrer" className="flex flex-col items-center gap-0.5 py-2"><Navigation size={18} />Naviga</a>
      </div>
      <CookieBanner />
      <InstallPrompt />
    </div>
  );
}

export function Footer() {
  const { data: s } = usePublicSettings();
  const B = useBusiness();
  return (
    <footer className="bg-brand-navy text-white">
      <div className="container-dp grid gap-8 py-12 md:grid-cols-4">
        <div className="md:col-span-1">
          <Logo white className="h-20" />
          <p className="mt-4 text-sm text-sky-100">Toelettatura professionale per cani a Cernusco sul Naviglio.</p>
        </div>
        <div>
          <h3 className="mb-3 font-display text-sm font-bold uppercase tracking-wider text-[#3fd5e4]">Contatti</h3>
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
            <li><button className="hover:underline" onClick={() => window.dispatchEvent(new Event("dp-cookie-open"))}>Preferenze cookie</button></li>
            {s?.site?.socialInstagram && <li><a href={s.site.socialInstagram} target="_blank" rel="noreferrer" className="hover:underline">Instagram</a></li>}
            {s?.site?.socialFacebook && <li><a href={s.site.socialFacebook} target="_blank" rel="noreferrer" className="hover:underline">Facebook</a></li>}
          </ul>
        </div>
      </div>
      <div className="border-t border-white/10 py-4 text-center text-xs text-sky-200">© {new Date().getFullYear()} Dog's Planet – Pet Grooming · Software PromoApp</div>
    </footer>
  );
}
