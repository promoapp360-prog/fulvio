import { usePage } from "@/lib/settings";
import { Markdown, Spinner } from "./ui";
import { Mascot, type MascotKind } from "./brand";
import ExternalContentGate from "./ExternalContentGate";
import { useQuery } from "@tanstack/react-query";
import { get } from "@/lib/api";
import type { CookieConfig } from "@/lib/cookies";

export function PageHero({ title, subtitle, mascot }: { title: string; subtitle?: string | null; mascot?: MascotKind }) {
  return (
    <section className="bg-gradient-to-b from-brand-sky to-white">
      <div className="container-dp flex items-center justify-between gap-6 py-10 sm:py-14">
        <div className="min-w-0">
          <h1 className="break-words text-3xl font-extrabold sm:text-4xl lg:text-5xl">{title}</h1>
          {subtitle && <p className="mt-3 max-w-2xl text-base leading-relaxed text-slate-600 sm:text-lg">{subtitle}</p>}
        </div>
        {mascot && <Mascot kind={mascot} className="hidden h-32 shrink-0 sm:block md:h-40" />}
      </div>
    </section>
  );
}

/** Pagina con contenuti modificabili dal gestionale (Contenuti del sito). */
export default function CmsPage({ slug, mascot, children, fallbackTitle, title, subtitle }: { slug: string; mascot?: MascotKind; children?: React.ReactNode; fallbackTitle?: string; title?: string; subtitle?: string }) {
  const { data, isLoading } = usePage(slug);
  if (isLoading) return <Spinner />;
  return (
    <>
      <PageHero title={title ?? data?.title ?? fallbackTitle ?? ""} subtitle={subtitle ?? data?.subtitle} mascot={mascot} />
      <div className="container-dp py-10">
        {["privacy-policy","cookie-policy"].includes(slug)&&<aside className="mb-6 max-w-3xl rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-relaxed text-amber-950"><b>Bozza da convalidare.</b> Documento informativo in preparazione, non consulenza legale né attestazione di conformità. Il titolare deve verificare i punti mancanti prima della pubblicazione finale.</aside>}
        {data?.imageUrl && <img src={data.imageUrl} alt={data.title} className="mb-8 h-auto max-h-96 w-full rounded-3xl object-contain" loading="lazy" />}
        {data?.body && <Markdown text={data.body} className="max-w-3xl" />}
        {slug==="cookie-policy"&&<LiveCookieInventory/>}
        {data?.videoUrl && <VideoEmbed url={data.videoUrl} />}
        {children}
      </div>
    </>
  );
}

export function VideoEmbed({ url }: { url: string }) {
  const yt = url.match(/(?:youtu\.be\/|v=|embed\/)([\w-]{11})/);
  const vimeo = url.match(/vimeo\.com\/(\d+)/);
  const src = yt ? `https://www.youtube-nocookie.com/embed/${yt[1]}` : vimeo ? `https://player.vimeo.com/video/${vimeo[1]}` : null;
  if (!src) {
    const video=<video src={url} controls className="my-8 w-full max-w-3xl rounded-3xl" preload="metadata" />;
    return /^https?:\/\//.test(url)&&new URL(url).origin!==location.origin?<ExternalContentGate>{video}</ExternalContentGate>:video;
  }
  return <div className="my-8 w-full max-w-3xl overflow-hidden rounded-3xl"><ExternalContentGate><iframe src={src} title="Video" className="aspect-video w-full" allowFullScreen loading="lazy" /></ExternalContentGate></div>;
}

function LiveCookieInventory(){
  const {data}=useQuery<CookieConfig>({queryKey:["cookie-config"],queryFn:()=>get("/api/public/cookie-config"),staleTime:60_000});
  return <section className="my-6 max-w-3xl rounded-2xl border p-5 text-sm">
    <h2 className="mb-3 text-xl font-bold">Configurazione corrente dei tag</h2>
    {!data?<p>Verifica configurazione in corso; i tag opzionali restano bloccati.</p>:<><ul className="list-disc space-y-2 pl-5">
      <li>Google Analytics 4: {data.providers.ga4?"ID configurato":"non configurato"}</li>
      <li>Google Tag Manager: {data.providers.gtm?"ID configurato":"non configurato"}</li>
      <li>Meta Pixel: {data.providers.meta?"ID configurato":"non configurato"}</li>
      <li>Audit amministratore: {data.reviewed?"confermato; necessario anche il consenso dell’utente":"non confermato; tag bloccati"}</li>
    </ul><p className="mt-3 break-all text-xs text-slate-500">Impronta inventario/informativa: {data.version}</p></>}
    <button className="btn-outline mt-4 min-h-11" onClick={()=>window.dispatchEvent(new Event("dp-cookie-open"))}>Gestisci preferenze cookie</button>
  </section>;
}
