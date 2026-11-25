import { PUBLIC_COPY } from "@shared/public-copy";

export default function BookingSteps() {
  return <ol className="my-6 grid gap-5">
    {PUBLIC_COPY.steps.map((title, index) => <li key={title} className="flex items-center gap-3">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-sky text-sm font-bold text-brand-navy">{index + 1}</span>
      <strong className="text-base font-bold leading-relaxed text-brand-navy sm:text-lg">{title}</strong>
    </li>)}
  </ol>;
}

export function QuietHours() {
  return <section className="mt-5 rounded-2xl border border-sky-200 bg-white p-5 text-brand-navy">
    <h3 className="text-lg font-bold">Gli orari più tranquilli</h3>
    <dl className="mt-3 grid gap-2 text-sm leading-relaxed">
      <div><dt className="font-semibold">Dal lunedì al sabato</dt><dd>18:00–22:00</dd></div>
      <div><dt className="font-semibold">Domenica e festivi</dt><dd>08:00–22:00</dd></div>
    </dl>
  </section>;
}
