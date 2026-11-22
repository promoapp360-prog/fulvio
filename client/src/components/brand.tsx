import { Link } from "wouter";
import { usePublicSettings } from "@/lib/settings";

/** Logo ufficiale Dog's Planet (ricavato dal brand board approvato). Sostituibile dal gestionale (Contenuti → Logo e mascotte). */
export function Logo({ className = "h-12", white = false }: { className?: string; white?: boolean }) {
  const { data: s } = usePublicSettings();
  const custom = white ? s?.brand?.logoWhiteUrl : s?.brand?.logoUrl;
  if (custom) return <img src={custom} alt="Dog's Planet – Pet Grooming" className={`${className} w-auto`} />;
  return white
    ? <img src="/brand/logo-white.png" alt="Dog's Planet – Pet Grooming" className={`${className} w-auto`} />
    : (
      <picture>
        <source srcSet="/brand/logo.webp" type="image/webp" />
        <img src="/brand/logo.png" alt="Dog's Planet – Pet Grooming" className={`${className} w-auto`} width={640} height={454} />
      </picture>
    );
}

export type MascotKind = "welcome" | "toelettatura" | "self-service" | "pensione" | "pet-shop" | "fidelity";
const OVERRIDE_KEY: Record<MascotKind, string> = {
  welcome: "mascotWelcome", toelettatura: "mascotGrooming", "self-service": "mascotSelfService", pensione: "mascotBoarding", "pet-shop": "mascotShop", fidelity: "mascotFidelity",
};

/** Mascotte ufficiale: sempre lo stesso cane, nelle varianti del brand board (sostituibili dal gestionale). */
export function Mascot({ kind, className = "h-32", alt }: { kind: MascotKind; className?: string; alt?: string }) {
  const { data: s } = usePublicSettings();
  const custom = s?.brand?.[OVERRIDE_KEY[kind]];
  if (custom) return <img src={custom} alt={alt ?? "Mascotte Dog's Planet"} loading="lazy" className={`${className} w-auto object-contain`} />;
  return (
    <picture>
      <source srcSet={`/brand/mascotte-${kind}.webp`} type="image/webp" />
      <img src={`/brand/mascotte-${kind}.png`} alt={alt ?? "Mascotte Dog's Planet"} loading="lazy" className={`${className} w-auto object-contain`} />
    </picture>
  );
}

/** Pulsante principale obbligatorio: "Richiedi la prenotazione on Line" con "on Line" in colore diverso. */
export function BookingButton({ className = "", size = "md" }: { className?: string; size?: "md" | "lg" }) {
  return (
    <Link href="/richiedi-prenotazione"
      className={`inline-flex items-center justify-center rounded-full bg-brand-navy font-display font-bold text-white shadow-soft transition hover:-translate-y-0.5 hover:bg-[#09337a] ${size === "lg" ? "px-7 py-4 text-base sm:text-lg" : "px-5 py-2.5 text-sm"} ${className}`}>
      Richiedi la prenotazione&nbsp;<span className="text-[#3fd5e4]">on Line</span>
    </Link>
  );
}
