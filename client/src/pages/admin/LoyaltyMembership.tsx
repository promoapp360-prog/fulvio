import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Field, Modal, Spinner, Empty, useToast } from "@/components/ui";
import { get, post } from "@/lib/api";

export function WalkInCreator({ onCreated }: { onCreated: (card: any, name: string) => void }) {
  const qc = useQueryClient(), toast = useToast();
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [key, setKey] = useState(""), [conflict, setConflict] = useState(false), [separate, setSeparate] = useState(false);
  const [form, setForm] = useState({ firstName: "", phone: "", email: "", points: "0", reason: "Self-service" });
  const field = (name: keyof typeof form) => ({ value: form[name], onChange: (e: any) => setForm({ ...form, [name]: e.target.value }) });
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); if (busy) return; setBusy(true); setError("");
    try {
      const out = await post("/api/admin/loyalty/self-service", { ...form, points: Number(form.points), requestKey: key, separateContact: separate });
      qc.invalidateQueries({ queryKey: ["loyalty-cards"] }); setOpen(false);
      toast("Cliente e tessera salvati senza creare un account");
      onCreated(out.card, form.firstName);
    } catch (e: any) { setError(e.message); if (e.status === 409) setConflict(true); }
    finally { setBusy(false); }
  };
  return <>
    <button className="btn-primary min-h-11" onClick={() => {
      setKey(crypto.randomUUID()); setForm({ firstName: "", phone: "", email: "", points: "0", reason: "Self-service" });
      setConflict(false); setSeparate(false); setError(""); setOpen(true);
    }}>Nuovo cliente Self-Service</button>
    <Modal open={open} onClose={() => !busy && setOpen(false)} title="Cliente Self-Service">
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-slate-600">Solo anagrafica e tessera: nessuna password, account o adesione marketing automatica.</p>
        <Field label="Nome"><input required maxLength={100} className="input" autoComplete="off" {...field("firstName")} /></Field>
        <Field label="Telefono"><input required type="tel" minLength={8} maxLength={40} className="input" {...field("phone")} /></Field>
        <Field label="Email (se disponibile)"><input type="email" className="input" {...field("email")} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Punti iniziali"><input required type="number" min={0} max={100000} step={1} className="input" {...field("points")} /></Field>
          <Field label="Causale"><input required minLength={3} maxLength={160} className="input" list="walk-in-reasons" {...field("reason")} /></Field>
        </div>
        <datalist id="walk-in-reasons">{["Self-service", "Porta un amico", "Omaggio", "Bonus iscrizione"].map(v => <option key={v}>{v}</option>)}</datalist>
        {conflict && <label className="flex min-h-11 items-start gap-3 text-sm"><input type="checkbox" className="mt-1" checked={separate} onChange={e => setSeparate(e.target.checked)} /><span>Ho controllato: è un'altra persona che condivide il recapito. Crea una scheda distinta, senza unire dati.</span></label>}
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <button disabled={busy || (conflict && !separate)} className="btn-primary min-h-11 w-full">{busy ? "Salvataggio…" : "Crea cliente e tessera"}</button>
      </form>
    </Modal>
  </>;
}

export function MembershipClaims() {
  const qc = useQueryClient(), toast = useToast();
  const { data, isLoading, error } = useQuery<any[]>({ queryKey: ["loyalty-claims"], queryFn: () => get("/api/admin/loyalty/claims"), refetchInterval: 30_000 });
  const [verified, setVerified] = useState<Record<number, boolean>>({}), [busy, setBusy] = useState(false);
  const act = async (cardId: number, action: "approve" | "reject") => {
    if (busy) return; setBusy(true);
    try {
      await post(`/api/admin/loyalty/claims/${cardId}`, { action, ...(action === "approve" ? { verifiedContact: verified[cardId] === true } : {}) });
      qc.invalidateQueries({ queryKey: ["loyalty-claims"] }); qc.invalidateQueries({ queryKey: ["loyalty-cards"] }); qc.invalidateQueries({ queryKey: ["loyalty-card"] });
      toast(action === "approve" ? "Punti e storico associati senza duplicare il bonus" : "Richiesta respinta");
    } catch (e: any) { toast(e.message, "err"); } finally { setBusy(false); }
  };
  if (isLoading) return <Spinner />;
  if (error) return <p role="alert">Non è stato possibile caricare le associazioni. Riprova.</p>;
  if (!data?.length) return <Empty>Nessuna associazione da verificare.</Empty>;
  return <div className="space-y-4">{data.map(c => <section key={c.cardId} className="card min-w-0 space-y-3">
    <h2 className="font-bold">Tessera {c.code}</h2>
    <div className="grid gap-3 text-sm sm:grid-cols-2">
      <div className="min-w-0"><b>Anagrafica Self-Service</b><p>{c.contactName}</p><p>{c.contactPhone}</p><p className="break-all">{c.contactEmail || "Email non presente"}</p></div>
      <div className="min-w-0"><b>Account richiedente</b><p>{c.firstName} {c.lastName}</p><p>{c.phone}</p><p className="break-all">{c.email}</p><p>{c.emailVerifiedAt ? "Email verificata" : "Email non verificata"}</p></div>
    </div>
    <label className="flex min-h-11 items-start gap-3 text-sm"><input type="checkbox" className="mt-1" checked={!!verified[c.cardId]} onChange={e => setVerified({ ...verified, [c.cardId]: e.target.checked })} /><span>Ho verificato che il richiedente è titolare della tessera e del recapito. Nessuna associazione sulla sola somiglianza del nome.</span></label>
    <div className="flex flex-wrap gap-3"><button className="btn-primary min-h-11" disabled={busy || !verified[c.cardId]} onClick={() => act(c.cardId, "approve")}>Conferma associazione</button><button className="btn-outline min-h-11" disabled={busy} onClick={() => act(c.cardId, "reject")}>Rifiuta richiesta</button></div>
  </section>)}</div>;
}

export function CardExpiryRule({ card }: { card: any }) {
  const qc = useQueryClient(), toast = useToast();
  const [value, setValue] = useState(""), [busy, setBusy] = useState(false), [dirty, setDirty] = useState(false);
  useEffect(() => { if (!dirty) setValue(card.expiryMonths == null ? "" : String(card.expiryMonths)); }, [card.id, card.expiryMonths, dirty]);
  const save = async () => {
    if (busy) return; setBusy(true);
    try {
      await post(`/api/admin/loyalty/card/${card.id}/expiry`, { months: value === "" ? null : Number(value) });
      await qc.invalidateQueries({ queryKey: ["loyalty-card"] }); setDirty(false); toast("Regola salvata per i prossimi accumuli");
    } catch (e: any) { toast(e.message, "err"); } finally { setBusy(false); }
  };
  return <section className="rounded-2xl border p-3">
    <h3 className="mb-2 font-bold">Regola di scadenza personale</h3>
    <Field label="Validità dei prossimi accumuli (mesi)">
      <input type="number" min={0} max={120} step={1} className="input" disabled={busy} placeholder="Vuoto = impostazione generale" value={value} onChange={e => { setDirty(true); setValue(e.target.value); }} />
    </Field>
    <p className="my-2 text-xs text-slate-500">Vuoto: segue le Impostazioni Fidelity. 0: nessuna scadenza. Da 1 a 120: mesi dall'accumulo. I punti già presenti mantengono le proprie scadenze; puoi modificarle sotto con una causale.</p>
    <button className="btn-outline btn-sm min-h-11" disabled={busy || (value !== "" && (!Number.isInteger(Number(value)) || Number(value) < 0 || Number(value) > 120))} onClick={save}>Salva regola personale</button>
  </section>;
}
