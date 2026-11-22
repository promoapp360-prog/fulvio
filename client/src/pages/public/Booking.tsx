import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Dog, Scissors, User, CalendarDays, Clock } from "lucide-react";
import { PageHero } from "@/components/CmsPage";
import { Mascot } from "@/components/brand";
import { Spinner, ErrorBox, Empty, Field } from "@/components/ui";
import { get, post } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { usePublicSettings } from "@/lib/settings";
import { addDaysISO, todayISO, weekdayISO, fmtDay } from "@/lib/format";
import { euro, SIZE_LABELS, WEEKDAYS } from "@shared/constants";
import { useServices, useOperators } from "./Pages";

const Step = ({ n, title, icon: Icon, children, done }: { n: number; title: string; icon: any; children: React.ReactNode; done?: boolean }) => (
  <section className="card min-w-0">
    <h2 className="mb-4 flex items-center gap-3 text-lg font-bold">
      <span className={`grid h-8 w-8 place-items-center rounded-full text-sm text-white ${done ? "bg-green-600" : "bg-brand-navy"}`}>{done ? "✓" : n}</span>
      <Icon size={18} className="text-brand-turquoise" /> {title}
    </h2>
    {children}
  </section>
);

const choice = (active: boolean) => `rounded-2xl border-2 px-4 py-3 text-left text-sm font-bold transition ${active ? "border-brand-turquoise bg-brand-sky text-brand-navy" : "border-slate-200 hover:border-brand-blue"}`;

export default function BookingPage() {
  const { data: me, isLoading } = useMe();
  if (isLoading) return <Spinner />;
  return (
    <>
      <PageHero title="Richiedi la prenotazione on Line" subtitle="Scegli servizio, operatore e orario: Dog's Planet verificherà la richiesta e ti invierà la conferma." mascot="toelettatura" />
      <div className="container-dp py-10">
        {!me ? (
          <div className="card mx-auto max-w-xl text-center">
            <Mascot kind="welcome" className="mx-auto h-28" />
            <h2 className="mt-3 text-xl font-bold">Accedi per inviare la richiesta</h2>
            <p className="mt-2 text-sm text-slate-600">Serve un account per collegare la richiesta alla scheda del tuo cane. Bastano un minuto e la registrazione è gratuita (riceverai anche la Fidelity Card!).</p>
            <div className="mt-5 flex justify-center gap-3">
              <Link href="/login?next=/richiedi-prenotazione" className="btn-outline">Accedi</Link>
              <Link href="/registrazione?next=/richiedi-prenotazione" className="btn-primary">Registrati</Link>
            </div>
          </div>
        ) : me.role !== "customer" ? (
          <Empty>Sei collegato come personale: inserisci gli appuntamenti dal <Link href="/admin/agenda" className="font-bold underline">gestionale</Link>.</Empty>
        ) : <Wizard />}
      </div>
    </>
  );
}

function Wizard() {
  const { data: settings } = usePublicSettings();
  const { data: dogs, isLoading: ld } = useQuery<any[]>({ queryKey: ["my-dogs"], queryFn: () => get("/api/account/dogs") });
  const { data: services } = useServices();
  const { data: operators } = useOperators();
  const [dogId, setDogId] = useState<number | null>(null);
  const [serviceId, setServiceId] = useState<number | null>(null);
  const [operatorId, setOperatorId] = useState<number | null | "any">(null);
  const [date, setDate] = useState<string | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState<unknown>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const service = services?.find((s) => s.id === serviceId);
  const compatible = useMemo(() => (operators || []).filter((o) => service?.operatorIds.includes(o.id)), [operators, service]);
  const opParam = operatorId && operatorId !== "any" ? operatorId : null;
  const days = useMemo(() => {
    const max = Math.min(settings?.booking?.maxDaysAhead ?? 60, 90);
    const list: string[] = [];
    const ops = opParam ? compatible.filter((o) => o.id === opParam) : compatible;
    const workdays = new Set(ops.flatMap((o) => o.shifts.map((s: any) => s.weekday)));
    for (let i = 0; i <= max; i++) { const d = addDaysISO(todayISO(), i); if (workdays.has(weekdayISO(d))) list.push(d); }
    return list;
  }, [settings, compatible, opParam]);

  const avail = useQuery<any>({
    queryKey: ["availability", serviceId, opParam, dogId, date],
    enabled: !!(serviceId && dogId && date && operatorId),
    queryFn: () => get(`/api/public/availability?serviceId=${serviceId}&date=${date}&dogId=${dogId}${opParam ? `&operatorId=${opParam}` : ""}`),
    staleTime: 15_000,
  });

  const reset = (level: number) => { if (level <= 1) setServiceId(null); if (level <= 2) setOperatorId(null); if (level <= 3) setDate(null); setTime(null); };

  const submit = async () => {
    setErr(null); setBusy(true);
    try {
      const r = await post("/api/account/appointments", { dogId, serviceId, operatorId: opParam, date, time, notes: notes || null });
      setSent(r.message);
    } catch (e) { setErr(e); avail.refetch(); } finally { setBusy(false); }
  };

  if (ld) return <Spinner />;
  if (sent) {
    return (
      <div className="card mx-auto max-w-xl text-center">
        <CheckCircle2 className="mx-auto text-green-600" size={48} />
        <h2 className="mt-3 text-2xl font-extrabold">Richiesta inviata. Attendi la conferma di Dog's Planet.</h2>
        <p className="mt-2 text-slate-600">Riceverai una notifica appena la richiesta sarà valutata. Puoi seguirne lo stato dalla tua area personale.</p>
        <Link href="/account/appuntamenti" className="btn-primary mt-5">I miei appuntamenti</Link>
      </div>
    );
  }
  if (!dogs?.length) {
    return (
      <div className="card mx-auto max-w-xl text-center">
        <Mascot kind="welcome" className="mx-auto h-24" />
        <p className="mt-3 font-bold">Prima registra il tuo cane: ci serve per proporti durata e prezzo corretti.</p>
        <Link href="/account/cani?nuovo=1&next=/richiedi-prenotazione" className="btn-primary mt-4">Aggiungi il tuo cane</Link>
      </div>
    );
  }

  const slots: Record<string, number[]> = avail.data?.slots || {};
  return (
    <div className="mx-auto grid min-w-0 max-w-4xl gap-5">
      <Step n={1} title="Seleziona il cane" icon={Dog} done={!!dogId}>
        <div className="flex flex-wrap gap-2">
          {dogs.map((d) => <button key={d.id} className={choice(dogId === d.id)} onClick={() => { setDogId(d.id); reset(3); }}>{d.name}<span className="block text-xs font-semibold text-slate-500">{d.breed || "—"} · taglia {SIZE_LABELS[d.size]?.toLowerCase()}</span></button>)}
          <Link href="/account/cani?nuovo=1&next=/richiedi-prenotazione" className="rounded-2xl border-2 border-dashed border-slate-300 px-4 py-3 text-sm font-bold text-slate-500">+ Altro cane</Link>
        </div>
      </Step>

      {dogId && (
        <Step n={2} title="Scegli il servizio" icon={Scissors} done={!!serviceId}>
          <div className="grid gap-2 sm:grid-cols-2">
            {(services || []).filter((s) => s.bookable && s.operatorIds.length).map((s) => (
              <button key={s.id} className={choice(serviceId === s.id)} onClick={() => { setServiceId(s.id); reset(2); }}>
                {s.name}<span className="block text-xs font-semibold text-slate-500">{s.category} · circa {s.durationMin} min</span>
              </button>
            ))}
          </div>
        </Step>
      )}

      {service && (
        <Step n={3} title="Scegli l'operatore" icon={User} done={!!operatorId}>
          <div className="flex flex-wrap gap-2">
            {settings?.booking?.allowAnyOperator !== false && compatible.length > 1 && <button className={choice(operatorId === "any")} onClick={() => { setOperatorId("any"); reset(3); }}>Nessuna preferenza<span className="block text-xs font-semibold text-slate-500">il primo disponibile</span></button>}
            {compatible.map((o) => (
              <button key={o.id} className={choice(operatorId === o.id)} onClick={() => { setOperatorId(o.id); reset(3); }}>
                <span className="mr-2 inline-block h-3 w-3 rounded-full" style={{ background: o.color }} />{o.name}
                <span className="block text-xs font-semibold text-slate-500">{Array.from(new Set(o.shifts.map((s: any) => WEEKDAYS[s.weekday].slice(0, 3)))).join(" · ")}</span>
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-500">Sono mostrati solo gli operatori abilitati a questo servizio.</p>
        </Step>
      )}

      {operatorId && (
        <Step n={4} title="Data e orario" icon={CalendarDays} done={!!time}>
          <p className="mb-3 text-xs leading-relaxed text-slate-500">Scorri le date disponibili, poi scegli un orario. La richiesta sarà valutata dal salone.</p>
          <div aria-label="Date disponibili" className="flex min-w-0 max-w-full gap-2 overflow-x-auto overscroll-x-contain pb-3">
            {days.map((d) => {
              const wd = WEEKDAYS[weekdayISO(d)].slice(0, 3);
              return (
                <button key={d} aria-pressed={date === d} aria-label={`Scegli ${d}`} onClick={() => { setDate(d); setTime(null); }} className={`flex min-h-[76px] min-w-[68px] shrink-0 flex-col items-center justify-center rounded-2xl border-2 px-2 py-2 text-xs font-bold ${date === d ? "border-brand-turquoise bg-brand-sky text-brand-navy" : "border-slate-200"}`}>
                  <span className="uppercase text-slate-500">{wd}</span><span className="text-lg">{d.slice(8)}</span><span className="text-slate-500">{d.slice(5, 7)}</span>
                </button>
              );
            })}
          </div>
          {date && (
            <div className="mt-4">
              {avail.isLoading ? <Spinner label="Verifico le disponibilità…" /> : Object.keys(slots).length === 0 ? (
                <Empty>Nessun orario libero il {fmtDay(date)}. Prova un altro giorno{opParam ? " o un altro operatore" : ""}.</Empty>
              ) : (
                <>
                  <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
                    {Object.keys(slots).map((t) => <button key={t} aria-pressed={time === t} onClick={() => setTime(t)} className={`min-h-11 rounded-xl border-2 py-2 text-sm font-bold ${time === t ? "border-brand-turquoise bg-brand-turquoise text-white" : "border-slate-200 hover:border-brand-blue"}`}>{t}</button>)}
                  </div>
                  <p className="mt-3 flex items-center gap-2 text-sm text-slate-600"><Clock size={14} /> Durata stimata {avail.data.durationMin} min
                    {avail.data.estimatedPriceCents != null && <> · prezzo indicativo {euro(avail.data.estimatedPriceCents)}</>}</p>
                  {avail.data.supplements?.length > 0 && <p className="text-xs text-slate-500">Include: {avail.data.supplements.map((s: any) => s.name).join(", ")}</p>}
                </>
              )}
            </div>
          )}
        </Step>
      )}

      {time && (
        <section className="card">
          <h2 className="mb-3 text-lg font-bold">Riepilogo</h2>
          <ul className="mb-4 space-y-1 text-sm">
            <li><b>Cane:</b> {dogs.find((d) => d.id === dogId)?.name}</li>
            <li><b>Servizio:</b> {service?.name}</li>
            <li><b>Operatore:</b> {operatorId === "any" ? "Nessuna preferenza" : compatible.find((o) => o.id === operatorId)?.name}</li>
            <li><b>Quando:</b> {fmtDay(date)} alle {time}</li>
          </ul>
          <Field label="Note per il salone (facoltative)"><textarea className="input" maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Es. il cane è un po' timoroso, preferenze sul taglio…" /></Field>
          <p className="mt-3 rounded-xl bg-brand-sky p-3 text-xs text-brand-navy">Questa è una <b>richiesta</b>: l'appuntamento sarà valido solo dopo la conferma di Dog's Planet. Il prezzo definitivo viene confermato dal salone.</p>
          <ErrorBox error={err} />
          <button className="btn-primary mt-4 w-full sm:w-auto" disabled={busy} onClick={submit}>Invia la richiesta</button>
        </section>
      )}
    </div>
  );
}
