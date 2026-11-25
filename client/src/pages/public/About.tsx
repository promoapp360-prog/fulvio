import { useQuery } from "@tanstack/react-query";
import { Star, Instagram, Facebook, Youtube, Music2 } from "lucide-react";
import CmsPage from "@/components/CmsPage";
import { get } from "@/lib/api";
import { useBusiness, usePublicSettings } from "@/lib/settings";
import { safeSocialUrl } from "@shared/reviews";

export default function AboutPage() {
  const { data: settings } = usePublicSettings();
  const business = useBusiness();
  const { data } = useQuery<any>({ queryKey: ["public-reviews"], queryFn: () => get("/api/public/reviews"), staleTime: 60_000 });
  const socials = [
    { key: "socialYoutube", label: "YouTube", icon: Youtube },
    { key: "socialInstagram", label: "Instagram", icon: Instagram },
    { key: "socialFacebook", label: "Facebook", icon: Facebook },
    { key: "socialTiktok", label: "TikTok", icon: Music2 },
  ].map(item => ({ ...item, url: safeSocialUrl(settings?.site?.[item.key]) })).filter(item => item.url);
  const hasSummary = Number.isInteger(data?.count) && data.count > 0 && typeof data.rating === "number" && data.rating > 0;
  const googleUrl = safeSocialUrl(data?.googleUrl);
  return <CmsPage slug="chi-siamo" fallbackTitle="Chi siamo">
    <section className="mt-10 rounded-3xl bg-brand-sky p-5 sm:p-8" aria-labelledby="reviews-heading">
      <h2 id="reviews-heading" className="text-2xl font-bold">Le recensioni dei nostri clienti</h2>
      {hasSummary && <div className="mt-5">
        <div className="flex items-center gap-2 text-amber-600"><Star fill="currentColor" aria-hidden="true" /><strong className="text-xl">{data.rating.toLocaleString("it-IT", { maximumFractionDigits: 1 })}/5</strong></div>
        <p className="mt-2 font-semibold">{data.count.toLocaleString("it-IT")} recensioni su Google</p>
      </div>}
      {googleUrl ? <a href={googleUrl} target="_blank" rel="noreferrer" className="btn-outline mt-5 min-h-11">Leggi le recensioni su Google</a>
        : <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent("Dog's Planet " + business.fullAddress)}`} target="_blank" rel="noreferrer" className="btn-outline mt-5 min-h-11">Cerca Dog's Planet su Google Maps</a>}
      {data?.source === "manual-fallback" && <p className="mt-3 text-xs text-slate-600">Dati inseriti dal salone; aggiornamento automatico temporaneamente non disponibile.</p>}
      {!!data?.images?.length && <div className="mt-6 grid items-start gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {data.images.map((image: { url: string; alt: string }, index: number) => <a key={image.url} href={image.url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-xl bg-white p-2 focus-visible:ring-2 focus-visible:ring-brand-blue">
          <img src={image.url} alt={image.alt || `Recensione cliente ${index + 1}`} loading="lazy" className="h-auto w-full object-contain" />
          <span className="flex min-h-11 items-center px-2 text-xs font-semibold">Apri recensione {index + 1}</span>
        </a>)}
      </div>}
    </section>
    {socials.length > 0 && <section className="mt-8" aria-label="I nostri social">
      <h2 className="mb-4 text-xl font-bold">Seguici sui social</h2>
      <div className="flex flex-wrap gap-3">{socials.map(({ label, url, icon: Icon }) => <a key={label} href={url} target="_blank" rel="noreferrer" className="inline-flex min-h-11 min-w-11 items-center gap-2 rounded-xl border border-sky-200 px-4 py-3 font-semibold text-brand-navy hover:bg-brand-sky" aria-label={`Dog's Planet su ${label}`}><Icon size={21} aria-hidden="true" />{label}</a>)}</div>
    </section>}
  </CmsPage>;
}
