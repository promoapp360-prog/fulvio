import { useState } from "react";
import ExternalContentGate from "./ExternalContentGate";
import { Phone, MessageCircle, Mail, MapPin, Navigation } from "lucide-react";
import { useBusiness } from "@/lib/settings";

export function ContactCards({ stacked = false }: { stacked?: boolean }) {
  const B = useBusiness();
  const items = [
    { icon: Phone, label: "Telefono", value: B.phone, href: `tel:${B.phoneIntl}` },
    { icon: MessageCircle, label: "WhatsApp", value: B.phone, href: `https://wa.me/${B.whatsapp}` },
    { icon: Mail, label: "Email", value: B.email, href: `mailto:${B.email}` },
  ];
  return (
    <div className={`grid gap-3 ${stacked ? "" : "sm:grid-cols-3"}`}>
      {items.map((i) => (
        <a key={i.label} href={i.href} target={i.href.startsWith("http") ? "_blank" : undefined} rel="noreferrer" className="card flex min-w-0 items-center gap-3 transition hover:-translate-y-0.5">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-brand-sky text-brand-turquoise"><i.icon size={20} /></span>
          <span className="min-w-0"><span className="block text-xs font-bold uppercase text-slate-500">{i.label}</span><span className={`block text-brand-navy ${stacked ? "break-words text-sm font-semibold leading-relaxed [overflow-wrap:anywhere]" : "truncate font-bold"}`}>{i.value}</span></span>
        </a>
      ))}
    </div>
  );
}

/** Mappa caricata solo su richiesta (niente cookie di terze parti prima del click). */
export function MapBox({ compact = false }: { compact?: boolean }) {
  const B = useBusiness();
  const [show, setShow] = useState(false);
  return (
    <div className="overflow-hidden rounded-3xl border border-sky-100 bg-brand-sky shadow-soft">
      {show ? (
        <ExternalContentGate><iframe title="Mappa Dog's Planet" src={B.mapEmbedUrl} className={`${compact ? "h-64" : "h-80"} w-full`} loading="lazy" referrerPolicy="no-referrer" /></ExternalContentGate>
      ) : (
        <div className={`flex ${compact ? "min-h-56" : "h-80"} flex-col items-center justify-center gap-3 p-6 text-center`}>
          <MapPin className="text-brand-turquoise" size={40} />
          <p className="font-bold text-brand-navy">{B.fullAddress}</p>
          <button className="btn-outline btn-sm" onClick={() => setShow(true)}>Mostra la mappa (Google Maps)</button>
        </div>
      )}
      <div className="flex flex-wrap gap-2 border-t border-sky-100 bg-white p-4">
        <a className="btn-primary btn-sm" href={B.googleMapsUrl} target="_blank" rel="noreferrer"><Navigation size={14} /> Naviga con Google Maps</a>
        <a className="btn-outline btn-sm" href={B.appleMapsUrl} target="_blank" rel="noreferrer"><Navigation size={14} /> Apple Maps</a>
      </div>
    </div>
  );
}
