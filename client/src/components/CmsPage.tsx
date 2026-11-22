import { usePage } from "@/lib/settings";
import { Markdown, Spinner } from "./ui";
import { Mascot, type MascotKind } from "./brand";

export function PageHero({ title, subtitle, mascot }: { title: string; subtitle?: string | null; mascot?: MascotKind }) {
  return (
    <section className="bg-gradient-to-b from-brand-sky to-white">
      <div className="container-dp flex items-center justify-between gap-6 py-10 sm:py-14">
        <div>
          <h1 className="text-3xl font-extrabold sm:text-5xl">{title}</h1>
          {subtitle && <p className="mt-3 max-w-2xl text-lg text-slate-600">{subtitle}</p>}
        </div>
        {mascot && <Mascot kind={mascot} className="hidden h-36 sm:block md:h-44" />}
      </div>
    </section>
  );
}

/** Pagina con contenuti modificabili dal gestionale (Contenuti del sito). */
export default function CmsPage({ slug, mascot, children, fallbackTitle }: { slug: string; mascot?: MascotKind; children?: React.ReactNode; fallbackTitle?: string }) {
  const { data, isLoading } = usePage(slug);
  if (isLoading) return <Spinner />;
  return (
    <>
      <PageHero title={data?.title || fallbackTitle || ""} subtitle={data?.subtitle} mascot={mascot} />
      <div className="container-dp py-10">
        {data?.imageUrl && <img src={data.imageUrl} alt={data.title} className="mb-8 max-h-96 w-full rounded-3xl object-cover" loading="lazy" />}
        {data?.body && <Markdown text={data.body} className="max-w-3xl" />}
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
  if (!src) return <video src={url} controls className="my-8 w-full max-w-3xl rounded-3xl" preload="metadata" />;
  return <div className="my-8 aspect-video w-full max-w-3xl overflow-hidden rounded-3xl"><iframe src={src} title="Video" className="h-full w-full" allowFullScreen loading="lazy" /></div>;
}
