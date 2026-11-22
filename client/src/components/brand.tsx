import { Link } from "wouter";
import { usePublicSettings } from "@/lib/settings";

/** Logo ufficiale Dog's Planet (ricavato dal brand board approvato). Sostituibile dal gestionale (Contenuti → Logo e mascotte). */
export function Logo({ className = "h-12", white = false }: { className?: string; white?: boolean }) {
  const { data: s } = usePublicSettings();
  const custom = white ? s?.brand?.logoWhiteUrl : s?.brand?.logoUrl;
  if (custom) return <img src={custom} alt="Dog's Planet – Pet Grooming" className={`${className} block max-w-full bg-transparent object-contain w-auto`} />;
  return white
    ? <img src="/brand/logo-white.png" alt="Dog's Planet – Pet Grooming" className={`${className} block w-auto bg-transparent object-contain`} />
    : (
      <picture className="inline-flex shrink-0 bg-transparent">
        <source srcSet="/brand/logo.webp" type="image/webp" />
        <img src="/brand/logo.png" alt="Dog's Planet – Pet Grooming" className={`${className} block w-auto bg-transparent object-contain`} width={640} height={454} />
      </picture>
    );
}

export type MascotKind = "welcome" | "toelettatura" | "self-service" | "pensione" | "pet-shop" | "fidelity";
const OVERRIDE_KEY: Record<MascotKind, string> = {
  welcome: "mascotWelcome", toelettatura: "mascotGrooming", "self-service": "mascotSelfService", pensione: "mascotBoarding", "pet-shop": "mascotShop", fidelity: "mascotFidelity",
};

/** Poppy, mascotte ufficiale: stesso cane e accessori originali, senza frammenti della brand board. */
export function Mascot({ kind, className = "h-32", alt }: { kind: MascotKind; className?: string; alt?: string; detail?: boolean }) {
  const { data: s } = usePublicSettings();
  const custom = s?.brand?.[OVERRIDE_KEY[kind]];
  if (custom) return <img src={custom} alt={alt ?? "Poppy, la mascotte di Dog's Planet"} loading="lazy" className={`${className} max-w-full w-auto object-contain`} />;
  // Il vecchio welcome è un ritaglio incompleto della brand board: non è
  // recuperabile senza inventare parti del cane. Non mostrarlo come decorazione.
  if (kind === "welcome") return null;
  const asset = `poppy-${kind}-transparent`;
  return (
    <picture className="contents">
      <source srcSet={`/brand/${asset}.webp`} type="image/webp" />
      <img src={`/brand/${asset}.png`} alt={alt ?? "Poppy, la mascotte di Dog's Planet"} loading="lazy" className={`${className} max-w-full w-auto object-contain`} />
    </picture>
  );
}

/** Pulsante principale obbligatorio: "Richiedi la prenotazione on Line" con "on Line" in colore diverso. */
export function BookingButton({ className = "", size = "md" }: { className?: string; size?: "md" | "lg" }) {
  return (
    <Link href="/richiedi-prenotazione"
      className={`inline-flex items-center justify-center rounded-full bg-brand-navy font-display font-bold text-white shadow-soft transition hover:-translate-y-0.5 hover:bg-[#09337a] ${size === "lg" ? "px-6 py-4 text-sm sm:text-base" : "px-5 py-2.5 text-sm"} ${className}`}>
      <span>Richiedi la prenotazione <span className="whitespace-nowrap text-[#3fd5e4]">on Line</span></span>
    </Link>
  );
}
