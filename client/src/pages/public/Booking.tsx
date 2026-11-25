import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, LockKeyhole, UserRound } from "lucide-react";
import { PageHero } from "@/components/CmsPage";
import { Spinner, ErrorBox, Field } from "@/components/ui";
import { get, post } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { usePublicSettings } from "@/lib/settings";
import { addDaysISO, todayISO, fmtDay, fmtDateTime } from "@/lib/format";
import { euro } from "@shared/constants";
import { bookingServiceIds, customerDogSchema, isStripping } from "@shared/customer-booking";
import { useServices } from "./Pages";
import BookingCalendar from "@/components/BookingCalendar";
import PushPreferences from "@/components/PushPreferences";

type Draft = {
  dogId: number; serviceIds: number[]; date: string; time: string; shedding: string; knots: string;
  notes: string; alternativeAvailability: string; boarding: boolean; startDate: string; endDate: string; needs: string;
  requestKey: string;
};
const fresh = (): Draft => ({ dogId: 0, serviceIds: [], date: "", time: "", shedding: "", knots: "", notes: "",
  alternativeAvailability: "", boarding: false, startDate: "", endDate: "", needs: "", requestKey: crypto.randomUUID() });
const title = "Richiedi la prenotazione online";
const successText = "Richiesta inviata! L'appuntamento è confermato solo dopo la risposta del salone.";

export default function BookingPage() {
  const { data: me, isLoading } = useMe();
  const params = new URLSearchParams(window.location.search), requestId = params.get("request"), token = params.get("token");
  const tracking = useQuery<any>({ queryKey: ["guest-request-status", requestId, token],
    queryFn: () => get(`/api/public/guest-requests/${requestId}?token=${encodeURIComponent(token || "")}`),
    enabled: !!requestId && !!token, retry: false });
  if (requestId && token) return <><PageHero title="La tua richiesta" subtitle="Stato della richiesta già inviata" mascot="toelettatura" /><div className="container-dp py-8"><div className="card mx-auto max-w-xl">{tracking.isLoading ? <Spinner /> : tracking.error ? <p role="alert">Link non valido o non più disponibile.</p> : <><h2 className="font-bold">Richiesta #{requestId}: {tracking.data?.status}</h2><p className="mt-3">{tracking.data?.serviceName} · {fmtDateTime(tracking.data?.startAt)}</p><p className="mt-3 text-sm">Per informazioni o variazioni contatta il salone.</p></>}</div></div></>;
  if (isLoading) return <Spinner />;
  if (!me) return <><PageHero title={title} subtitle="Accedi o crea il tuo account per richiedere un appuntamento." mascot="toelettatura" />
    <div className="container-dp py-8"><div className="mx-auto grid max-w-3xl gap-4 sm:grid-cols-2">
      <Link href="/login?next=%2Frichiedi-prenotazione" className="card flex min-h-36 flex-col items-center justify-center gap-3 text-center transition hover:border-brand-blue"><LockKeyhole size={30} className="text-brand-navy" /><strong className="text-lg">Sono già cliente – Accedi</strong><span className="text-sm text-slate-600">Ritrovi i tuoi animali e le tue richieste.</span></Link>
      <Link href="/registrazione?next=%2Frichiedi-prenotazione" className="card flex min-h-36 flex-col items-center justify-center gap-3 border-brand-turquoise bg-brand-sky text-center transition hover:border-brand-blue"><UserRound size={30} className="text-brand-navy" /><strong className="text-lg">Diventa cliente – Registrati</strong><span className="text-sm text-slate-600">Compili la scheda una sola volta.</span></Link>
      <p className="sm:col-span-2 text-sm leading-relaxed text-slate-600">Hai bisogno di aiuto? Chiama o scrivici su WhatsApp: il salone ti aiuta nella registrazione.</p>
    </div></div></>;
  if (me.role !== "customer") return <><PageHero title={title} subtitle="Sei collegato come personale." mascot="toelettatura" /><div className="container-dp py-8">Per inserire appuntamenti usa il <Link className="font-bold underline" href="/admin/agenda">gestionale</Link>.</div></>;
  return <RegisteredBooking key={me.id} me={me} />;
}

function RegisteredBooking({ me }: { me: any }) {
  const qc = useQueryClient();
  const { data: settings } = usePublicSettings();
  const { data: services, error: catalogError } = useServices();
  const { data: dogs, isLoading: dogsLoading, error: dogsError } = useQuery<any[]>({ queryKey: ["my-dogs"], queryFn: () => get("/api/account/dogs") });
  const storageKey = `dp-booking-draft:${me.id}`;
  const [d, setD] = useState<Draft>(() => {
    const empty = fresh();
    try { const saved = JSON.parse(sessionStorage.getItem(storageKey) || "null"); return saved?.requestKey && Array.isArray(saved.serviceIds) ? { ...empty, ...saved } : empty; } catch { return empty; }
  });
  const [step, setStep] = useState(1), [busy, setBusy] = useState(false), [error, setError] = useState<unknown>(null);
  const [success, setSuccess] = useState<{ firstRequest: boolean } | null>(null);
  const update = <K extends keyof Draft>(key: K, value: Draft[K]) => setD(old => ({ ...old, [key]: value }));
  useEffect(() => { if (!success) try { sessionStorage.setItem(storageKey, JSON.stringify(d)); } catch { /* Il form rimane comunque in memoria. */ } }, [d, storageKey, success]);
  useEffect(() => { if (!d.dogId && dogs?.length === 1) update("dogId", dogs[0].id); }, [dogs, d.dogId]);
  const dog = dogs?.find(pet => pet.id === d.dogId);
  const dogComplete = !!dog && customerDogSchema.safeParse(dog).success;
  const catalog = useMemo(() => (services || []).filter(service => service.active && service.bookable && service.visible && (!dog || !service.species || service.species === "entrambi" || service.species === dog.species))
    .sort((a, b) => Number(isStripping(a)) - Number(isStripping(b))), [services, dog]);
  const selected = catalog.filter(service => d.serviceIds.includes(service.id));
  const serviceKey = [...d.serviceIds].sort((a, b) => a - b).join(",");
  const availability = useQuery<{ slots: string[]; durationMin: number; estimatedPriceCents: number; serviceIds: number[] }>({
    queryKey: ["booking-availability", d.dogId, serviceKey, d.date],
    queryFn: () => get(`/api/account/booking-availability?dogId=${d.dogId}&serviceIds=${serviceKey}&date=${d.date}`),
    enabled: dogComplete && !!serviceKey && !!d.date && !success, staleTime: 0, retry: false,
  });
  const validServices = selected.length > 0 && selected.length === d.serviceIds.length;
  const chooseService = (id: number) => {
    try {
      const ids = d.serviceIds.includes(id) ? d.serviceIds.filter(value => value !== id) : [...d.serviceIds, id];
      setD(old => ({ ...old, serviceIds: bookingServiceIds(ids, catalog, dog?.coatLength), time: "" }));
      setError(null);
    } catch (e) { setError(e); }
  };
  const bathLocked = (id: number) => {
    if (!selected.some(isStripping) || !d.serviceIds.includes(id)) return false;
    try { return bookingServiceIds(d.serviceIds.filter(value => value !== id), catalog, dog?.coatLength).includes(id); } catch { return false; }
  };
  const send = async () => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      // Il server ricontrolla lo slot nella transazione. Inviare la stessa chiave
      // permette inoltre di recuperare una risposta persa senza creare doppioni.
      const result = await post("/api/account/appointments", {
        dogId: d.dogId, serviceIds: d.serviceIds, date: d.date, time: d.time,
        coatSheddingToday: d.shedding === "si", coatKnotsToday: d.knots === "si", notes: d.notes,
        alternativeAvailability: d.alternativeAvailability, requestKey: d.requestKey,
        ...(d.boarding ? { boarding: { startDate: d.startDate, endDate: d.endDate, needs: d.needs } } : {}),
      });
      setSuccess(result);
      try { sessionStorage.removeItem(storageKey); sessionStorage.setItem("dp-install-eligible", "1"); } catch { /* nessuna ripetizione automatica */ }
      window.dispatchEvent(new Event("dp:install-eligible"));
      qc.invalidateQueries({ queryKey: ["acc-summary"] }); qc.invalidateQueries({ queryKey: ["my-appointments"] });
    } catch (e: any) {
      if (e.status === 409) { setStep(2); update("time", ""); }
      setError(e);
    } finally { setBusy(false); }
  };
  if (success) return <><PageHero title="Richiesta inviata" subtitle="Attendi la risposta del salone." mascot="toelettatura" />
    <div className="container-dp py-8"><div className="mx-auto max-w-2xl space-y-5">
      <div className="card text-center"><CheckCircle2 size={48} className="mx-auto text-green-600" /><h2 className="mt-4 text-xl font-extrabold">{successText}</h2>
        <p className="mt-4 text-sm leading-relaxed text-slate-600">{settings?.emailConfigured ? "Riceverai la presa in carico via email. Puoi seguire gli aggiornamenti anche nella tua area personale." : "La richiesta è salvata e visibile al salone. Il canale email non è ancora configurato: controlla gli aggiornamenti nella tua area personale."}</p>
        <Link href="/account/appuntamenti" className="btn-primary mt-5 min-h-12">Le mie richieste</Link>
      </div>{success.firstRequest && <PushPreferences afterBooking />}
    </div></div></>;
  return <><PageHero title={title} subtitle="Scegli il servizio, poi il giorno e l'orario. Il salone conferma ogni richiesta." mascot="toelettatura" />
    <div className="container-dp py-6 sm:py-8"><div className="mx-auto max-w-3xl space-y-5">
      <ol aria-label="Passaggi della richiesta" className="grid grid-cols-4 gap-1 text-center text-xs sm:gap-3 sm:text-sm">
        {["Servizi", "Giorno ed ora", "Info del giorno", "Riepilogo"].map((label, i) => <li key={label} aria-current={step === i + 1 ? "step" : undefined} className={`rounded-xl px-1 py-3 ${step === i + 1 ? "bg-brand-navy font-bold text-white" : "bg-slate-100 text-slate-600"}`}><span className="block font-bold">{i + 1}</span>{label}</li>)}
      </ol>
      <ErrorBox error={error || dogsError || catalogError} />
      {step === 1 && <section className="card space-y-5"><h2 className="text-xl font-bold">1. Quali servizi desideri?</h2>
        {dogsLoading ? <Spinner /> : !dogs?.length ? <p>Prima completa la scheda del tuo animale. <Link href="/account/cani?nuovo=1&next=%2Frichiedi-prenotazione" className="font-bold underline">Aggiungi la scheda</Link></p> : <>
          <Field label="Il tuo animale"><select className="input min-h-12" value={d.dogId || ""} onChange={e => setD(old => ({ ...old, dogId: Number(e.target.value), serviceIds: [], time: "", shedding: "", knots: "" }))}><option value="">Seleziona…</option>{dogs.map(pet => <option key={pet.id} value={pet.id}>{pet.name}</option>)}</select></Field>
          {dog && !dogComplete && <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">Completa i dati principali obbligatori di {dog.name} una sola volta. Benessere e foto sono facoltativi. <Link href={`/account/cani?modifica=${dog.id}&next=%2Frichiedi-prenotazione`} className="font-bold underline">Completa la scheda</Link></p>}
          {dogComplete && <div className="grid gap-2 sm:grid-cols-2">{catalog.map(service => <label key={service.id} className={`flex min-h-16 cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm ${d.serviceIds.includes(service.id) ? "border-brand-blue bg-brand-sky" : "border-slate-200"}`}><input type="checkbox" className="mt-1 h-5 w-5 shrink-0 accent-brand-navy" checked={d.serviceIds.includes(service.id)} disabled={bathLocked(service.id)} onChange={() => chooseService(service.id)} /><span><b>{service.name}</b>{bathLocked(service.id) && <small className="mt-1 block">Incluso obbligatoriamente con lo stripping</small>}{isStripping(service) && <small className="mt-1 block">Aggiunge automaticamente il bagno.</small>}</span></label>)}</div>}
          {settings?.site?.boardingEnabled && dogComplete && <label className="flex min-h-12 items-center gap-3 rounded-xl border p-3 text-sm"><input type="checkbox" className="h-5 w-5 shrink-0 accent-brand-navy" checked={d.boarding} onChange={e => update("boarding", e.target.checked)} />Desidero anche richiedere la pensione casalinga</label>}
          <button type="button" className="btn-primary min-h-12 w-full" disabled={!dogComplete || !validServices} onClick={() => { setError(null); setStep(2); }}>Scegli giorno ed orario</button>
        </>}
      </section>}
      {step === 2 && <section className="card space-y-5"><h2 className="text-xl font-bold">2. Scegli giorno ed ora</h2>
        <p className="text-sm text-slate-600">Gli orari tengono conto dei servizi scelti, della taglia, dei turni e delle competenze effettive. L'operatore sarà assegnato dal salone.</p>
        <BookingCalendar value={d.date} min={todayISO()} max={addDaysISO(todayISO(), settings?.booking?.maxDaysAhead || 60)} onChange={date => setD(old => ({ ...old, date, time: "" }))} />
        {!!d.date && <div><h3 className="mb-3 font-bold">Orari disponibili · {fmtDay(d.date)}</h3>{availability.isFetching ? <Spinner /> : availability.error ? <ErrorBox error={availability.error} /> : !availability.data?.slots.length ? <p className="rounded-xl bg-slate-50 p-4 text-sm">Non ci sono orari compatibili in questo giorno. Scegli un'altra data.</p> : <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">{availability.data.slots.map(time => <button type="button" key={time} aria-pressed={d.time === time} className={`min-h-12 rounded-xl border font-bold ${d.time === time ? "bg-brand-navy text-white" : "border-sky-200 text-brand-navy hover:bg-brand-sky"}`} onClick={() => update("time", time)}>{time}</button>)}</div>}</div>}
        <div className="flex gap-3"><button className="btn-outline min-h-12" onClick={() => setStep(1)}>Indietro</button><button className="btn-primary min-h-12 flex-1" disabled={!d.time || availability.isFetching || !availability.data?.slots.includes(d.time)} onClick={() => { setError(null); setStep(3); }}>Continua</button></div>
      </section>}
      {step === 3 && <form className="card space-y-4" onSubmit={e => { e.preventDefault(); setError(null); setStep(4); }}>
        <h2 className="text-xl font-bold">3. Come sta {dog?.name} oggi?</h2>
        <p className="text-sm text-slate-600">Queste informazioni riguardano questo appuntamento, non la scheda permanente.</p>
        <div className="grid gap-4 sm:grid-cols-2">{([["shedding", "È in muta?"], ["knots", "Ci sono nodi?"]] as const).map(([key, label]) => <Field key={key} label={label + " *"}><select required className="input min-h-12" value={d[key]} onChange={e => update(key, e.target.value)}><option value="">Seleziona…</option><option value="no">No</option><option value="si">Sì</option></select></Field>)}</div>
        {(d.knots === "si" || d.shedding === "si") && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">La durata è da verificare: il salone potrà adeguarla prima di confermare.</p>}
        <Field label="Note per il salone"><textarea className="input min-h-24" maxLength={2000} value={d.notes} onChange={e => update("notes", e.target.value)} placeholder="Esigenze del giorno o un'eventuale preferenza per l'operatore…" /></Field>
        <Field label="Disponibilità alternative (facoltativo)"><textarea className="input" maxLength={500} value={d.alternativeAvailability} onChange={e => update("alternativeAvailability", e.target.value)} placeholder="Altri giorni o fasce orarie, se quello scelto non fosse più disponibile." /></Field>
        {d.boarding && <fieldset className="space-y-3 rounded-xl border p-4"><legend className="px-1 font-bold">Richiesta pensione casalinga</legend><p className="text-sm text-slate-600">Il soggiorno è una richiesta separata da approvare, non una disponibilità confermata.</p><div className="grid gap-3 sm:grid-cols-2"><Field label="Soggiorno dal *"><input required type="date" min={todayISO()} className="input min-h-12" value={d.startDate} onChange={e => update("startDate", e.target.value)} /></Field><Field label="Al *"><input required type="date" min={d.startDate || todayISO()} className="input min-h-12" value={d.endDate} onChange={e => update("endDate", e.target.value)} /></Field></div><Field label="Esigenze per il soggiorno"><textarea className="input" maxLength={2000} value={d.needs} onChange={e => update("needs", e.target.value)} /></Field></fieldset>}
        <div className="flex gap-3"><button type="button" className="btn-outline min-h-12" onClick={() => setStep(2)}>Indietro</button><button className="btn-primary min-h-12 flex-1">Vai al riepilogo</button></div>
      </form>}
      {step === 4 && <section className="card space-y-4"><h2 className="text-xl font-bold">4. Riepilogo della richiesta</h2>
        <dl className="grid min-w-0 gap-3 break-words text-sm"><div><dt className="text-slate-500">Cliente ed animale</dt><dd className="font-semibold">{me.firstName} {me.lastName} · {dog?.name}</dd></div>
          <div><dt className="text-slate-500">Servizi richiesti</dt><dd className="font-semibold">{selected.map(service => service.name).join(", ")}</dd></div>
          <div><dt className="text-slate-500">Quando</dt><dd className="font-semibold">{fmtDay(d.date)} alle {d.time}</dd></div>
          <div><dt className="text-slate-500">Durata indicativa</dt><dd>{availability.data?.durationMin} minuti{(d.knots === "si" || d.shedding === "si") && " · da verificare dal salone"}</dd></div>
          <div><dt className="text-slate-500">Prezzo indicativo</dt><dd>{(availability.data?.estimatedPriceCents || 0) > 0 ? `${euro(availability.data!.estimatedPriceCents)} · soggetto alla conferma del salone` : "Preventivo da definire con il salone"}{d.boarding && " (pensione esclusa)"}</dd></div>
          <div><dt className="text-slate-500">Informazioni del giorno</dt><dd>Muta: {d.shedding === "si" ? "sì" : "no"} · Nodi: {d.knots === "si" ? "sì" : "no"}</dd></div>
          {d.notes && <div><dt className="text-slate-500">Note</dt><dd className="whitespace-pre-wrap break-words">{d.notes}</dd></div>}
          {d.alternativeAvailability && <div><dt className="text-slate-500">Alternative</dt><dd className="whitespace-pre-wrap break-words">{d.alternativeAvailability}</dd></div>}
          {d.boarding && <div><dt className="text-slate-500">Richiesta pensione</dt><dd>Dal {fmtDay(d.startDate)} al {fmtDay(d.endDate)} · da approvare</dd></div>}
        </dl>
        <p className="rounded-xl bg-brand-sky p-4 text-sm font-semibold">Stai inviando una richiesta, non una prenotazione già confermata. Attendi la risposta del salone.</p>
        <div className="flex gap-3"><button type="button" disabled={busy} className="btn-outline min-h-12" onClick={() => setStep(3)}>Indietro</button><button type="button" className="btn-primary min-h-12 flex-1" disabled={busy || !validServices || !d.time || !d.knots || !d.shedding} onClick={() => void send()}>{busy ? "Invio…" : "Invia richiesta"}</button></div>
      </section>}
    </div></div>
  </>;
}
