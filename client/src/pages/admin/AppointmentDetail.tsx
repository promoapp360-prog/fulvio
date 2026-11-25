import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Phone } from "lucide-react";
import { Modal, Spinner, StatusBadge, Field, MoneyInput, Check, ErrorBox, useToast } from "@/components/ui";
import { get, post, patch } from "@/lib/api";
import { useMe, can } from "@/lib/auth";
import { fmtLong, fmtDateTime, romeParts } from "@/lib/format";
import { euro, PAYMENT_MODES, PAYMENT_METHODS, PAYMENT_KINDS, SIZE_LABELS, STATUS_LABELS } from "@shared/constants";

function priceSnapshotLabel(s: any) {
  if (s.pricingType === "fascia" && s.priceCents != null && s.priceMaxCents != null) return `${euro(s.priceCents)}–${euro(s.priceMaxCents)}`;
  if (s.pricingType === "percentuale" && s.percentageBasisPoints != null) return `+${s.percentageBasisPoints / 100}%`;
  if (s.pricingType === "preventivo") return "da valutare";
  if (s.priceCents != null) return `${s.pricingType === "da" ? "da " : ""}${euro(s.priceCents)}`;
  return "prezzo da definire";
}

export function useAdminOperators() {
  return useQuery<any[]>({ queryKey: ["admin-operators"], queryFn: () => get("/api/admin/operators"), staleTime: 5 * 60_000 });
}

export default function AppointmentDetail({ id, onClose }: { id: number | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: me } = useMe();
  const { data: ops } = useAdminOperators();
  const { data: a, isLoading } = useQuery<any>({ queryKey: ["admin-app", id], queryFn: () => get(`/api/admin/appointments/${id}`), enabled: !!id });
  const [f, setF] = useState<any>({});
  const [pay, setPay] = useState<any>({ kind: "saldo", method: "contanti", amountCents: null, methodLabel: "" });
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const { data: settings } = useQuery<any>({ queryKey: ["admin-settings"], queryFn: () => get("/api/admin/settings"), staleTime: 5 * 60_000 });
  const reasons: string[] = settings?.cancellation?.reasons || [];
  const canAct = can(me ?? null, "richieste"), canEdit = can(me ?? null, "agenda_edit"), canPay = can(me ?? null, "pagamenti");

  useEffect(() => {
    if (!a) return;
    const p = romeParts(a.proposedStartAt || a.startAt);
    setF({ date: p.day, time: p.time, operatorId: a.operatorId, durationMin: a.durationMin, finalPriceCents: a.finalPriceCents ?? a.estimatedPriceCents, paymentMode: a.paymentMode, depositCents: a.depositCents, reason: "", cancelReason: "", treatmentNotes: a.treatmentNotes || "", force: false, adminNotes: a.adminNotes || "" });
    setPay({ kind: a.paidCents > 0 ? "saldo" : "totale", method: "contanti", amountCents: Math.max(0, (a.finalPriceCents ?? a.estimatedPriceCents ?? 0) - a.paidCents) || null, methodLabel: "" });
  }, [a]);

  const refresh = () => { qc.invalidateQueries({ queryKey: ["admin-app", id] }); qc.invalidateQueries({ queryKey: ["agenda"] }); qc.invalidateQueries({ queryKey: ["requests"] }); qc.invalidateQueries({ queryKey: ["dashboard"] }); };
  const run = async (fn: () => Promise<any>, ok: string) => {
    setErr(null); setBusy(true);
    try { await fn(); toast(ok); refresh(); } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const action = (action: string, extra: Record<string, any> = {}) => run(() => post(`/api/admin/appointments/${id}/action`, { action, force: f.force || undefined, reason: f.reason || null, ...extra }), `Azione eseguita: ${action.replace("_", " ")}`);
  const timing = { date: f.date, time: f.time, operatorId: Number(f.operatorId) || null, durationMin: Number(f.durationMin) };

  if (!id) return null;
  return (
    <Modal open={!!id} onClose={onClose} title={a ? `${a.dogName} – ${a.serviceName}` : "Appuntamento"} wide>
      {isLoading || !a ? <Spinner /> : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-lg font-bold text-brand-navy">{fmtLong(a.startAt)} · {a.durationMin} min</p>
              <p className="text-sm text-slate-600">Operatore: <b>{a.operatorName || "Da assegnare alla conferma"}</b></p>
              {(a.coatKnotsToday || a.coatSheddingToday) && <div className="mt-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
                <b>{a.durationNeedsReview ? "Durata da verificare" : "Informazioni del giorno"}</b>: {a.coatKnotsToday ? "nodi presenti" : "senza nodi"}; {a.coatSheddingToday ? "in muta" : "non in muta"}. La durata può essere aggiornata prima della conferma.
              </div>}
              <p className="text-sm text-slate-600">Cliente: <Link href={`/admin/clienti/${a.customerId}`} className="font-bold text-brand-blue underline">{a.customerName}</Link>
                {a.customerPhone && <a href={`tel:${a.customerPhone}`} className="ml-2 inline-flex items-center gap-1 text-brand-blue"><Phone size={12} />{a.customerPhone}</a>}</p>
            </div>
            <div className="text-right"><StatusBadge status={a.status} /><p className="mt-1 text-xs text-slate-500">Pagato: {euro(a.paidCents)}</p></div>
          </div>

          {a.dog && (
            <div className="rounded-2xl bg-slate-50 p-3 text-sm">
              <p><b>{a.dog.name}</b> · {a.dog.breed || "razza n.d."} · taglia {SIZE_LABELS[a.dog.size]?.toLowerCase()}{a.dog.weightKg ? ` · ${a.dog.weightKg} kg` : ""}</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {a.dog.aggressive && <span className="badge bg-red-100 text-red-700"><AlertTriangle size={12} className="mr-1" />Attenzione: {a.dog.aggressiveNotes || "comportamento aggressivo"}</span>}
              </div>
              {[a.dog.jointIssues && `Articolazioni: ${a.dog.jointIssues}`, a.dog.dermatitis && `Dermatiti: ${a.dog.dermatitis}`, a.dog.sensitivities && `Sensibilità: ${a.dog.sensitivities}`, a.dog.coatNotes && `Mantello: ${a.dog.coatNotes}`].filter(Boolean).map((t: any) => <p key={t} className="text-slate-600">{t}</p>)}
              <img src={`/api/admin/appointments/${id}/photo`} alt={`Foto di ${a.dog.name}`} className="mt-3 max-h-52 rounded-xl object-contain" onError={e=>(e.currentTarget.style.display="none")}/>
            </div>
          )}
          {(a.requestedServices?.length>1||a.privacyAcknowledgedAt)&&<div className="rounded-xl border border-slate-200 p-3 text-sm">
            {a.requestedServices?.length>0&&<div><b>Prestazioni e prezzi al momento della richiesta:</b><ul className="mt-1 list-disc pl-5">{a.requestedServices.map((s:any)=><li key={s.id||s.name}>{s.name}{s.priceCents!=null||s.pricingType==="percentuale"||s.pricingType==="preventivo"?` · ${priceSnapshotLabel(s)}`:""} · {s.durationMin} min</li>)}</ul></div>}
            {a.privacyAcknowledgedAt&&<p><b>Presa visione privacy:</b> {fmtDateTime(a.privacyAcknowledgedAt)} · versione {a.privacyVersion||"—"} · prova {a.privacyAcknowledgementProof||"—"}</p>}
            {a.marketingConsent&&<p>Marketing facoltativo: selezionato il {fmtDateTime(a.marketingConsentAt)} · {a.marketingConsentProof}</p>}
          </div>}
          {a.customerNotes && <p className="rounded-xl bg-brand-sky p-3 text-sm"><b>Note del cliente:</b> {a.customerNotes}</p>}
          {a.changeRequest && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-amber-50 p-3 text-sm"><span><b>Richiesta del cliente:</b> {a.changeRequest}</span>
              <button className="btn-outline btn-sm" onClick={() => run(() => patch(`/api/admin/appointments/${id}`, { clearChangeRequest: true }), "Richiesta segnata come gestita")}>Segna come gestita</button></div>
          )}

          {/* parametri comuni alle azioni */}
          <div className="grid gap-3 rounded-2xl border border-slate-200 p-4 sm:grid-cols-3">
            <Field label="Data"><input type="date" className="input" value={f.date || ""} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
            <Field label="Ora"><input type="time" className="input" value={f.time || ""} onChange={(e) => setF({ ...f, time: e.target.value })} /></Field>
            <Field label="Operatore"><select className="input" value={f.operatorId || ""} onChange={(e) => setF({ ...f, operatorId: e.target.value })}>{ops?.filter((o) => o.active).map((o) => <option key={o.id} value={o.id}>{o.name}{!o.serviceIds.includes(a.serviceId) ? " (non abilitato)" : ""}</option>)}</select></Field>
            <Field label="Durata (min)"><input type="number" min={5} step={5} className="input" value={f.durationMin || ""} onChange={(e) => setF({ ...f, durationMin: e.target.value })} /></Field>
            <Field label="Prezzo definitivo"><MoneyInput value={f.finalPriceCents} onChange={(v) => setF({ ...f, finalPriceCents: v })} /></Field>
            <Field label="Pagamento"><select className="input" value={f.paymentMode} onChange={(e) => setF({ ...f, paymentMode: e.target.value })}>{Object.entries(PAYMENT_MODES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
            {f.paymentMode === "acconto" && <Field label="Acconto"><MoneyInput value={f.depositCents} onChange={(v) => setF({ ...f, depositCents: v })} /></Field>}
            <Field label="Motivo / nota per il cliente" className="sm:col-span-2"><input className="input" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
            {me?.role === "admin" && <div className="sm:col-span-3"><Check checked={f.force} onChange={(v) => setF({ ...f, force: v })} label="Autorizza sovrapposizione / orario fuori turno (solo amministratore)" /></div>}
          </div>

          <ErrorBox error={err} />
          {a.cancelReason && <p className="rounded-xl bg-slate-100 p-3 text-sm"><b>{a.status === "assente" ? "Assenza" : "Annullato"}</b>{a.cancelledBy && ` dal ${a.cancelledBy}`}{a.cancelledAt && ` il ${fmtDateTime(a.cancelledAt)}`}: {a.cancelReason}{a.lateCancel && <span className="badge ml-2 bg-amber-100 text-amber-800">oltre il termine</span>}</p>}
          {!canAct && <p className="text-xs text-slate-500">Non hai il permesso di confermare o modificare le richieste.</p>}
          {canAct && <div className="flex flex-wrap gap-2">
            {["richiesta", "in_valutazione", "proposta", "attesa_pagamento"].includes(a.status) && <button disabled={busy} className="btn-primary" onClick={() => action("conferma", { ...timing, finalPriceCents: f.finalPriceCents, paymentMode: f.paymentMode, depositCents: f.depositCents })}>Conferma</button>}
            {a.status === "richiesta" && <button disabled={busy} className="btn-outline" onClick={() => action("valuta")}>Metti in valutazione</button>}
            {["richiesta", "in_valutazione", "proposta", "confermata"].includes(a.status) && <button disabled={busy} className="btn-outline" onClick={() => action("proponi", timing)}>Proponi questo orario</button>}
            {["richiesta", "in_valutazione", "confermata"].includes(a.status) && <button disabled={busy} className="btn-outline" onClick={() => action("richiedi_pagamento", { paymentMode: f.paymentMode === "saldo" ? "saldo" : "acconto", finalPriceCents: f.finalPriceCents, depositCents: f.depositCents })}>Richiedi pagamento online</button>}
            {canEdit && ["confermata", "attesa_pagamento"].includes(a.status) && <button disabled={busy} className="btn-outline" onClick={() => run(() => patch(`/api/admin/appointments/${id}`, { ...timing, finalPriceCents: f.finalPriceCents, adminNotes: f.adminNotes, force: f.force || undefined }), "Appuntamento aggiornato")}>Salva modifiche</button>}
            {["confermata", "attesa_pagamento"].includes(a.status) && <button disabled={busy} className="btn-navy" onClick={() => action("completa", { finalPriceCents: f.finalPriceCents, treatmentNotes: f.treatmentNotes || null })}>Completato</button>}
            {["confermata", "attesa_pagamento"].includes(a.status) && <button disabled={busy} className="btn-outline" onClick={() => confirm("Registrare l'assenza del cliente?") && action("assente", { reason: f.cancelReason || "Cliente non presentato" })}>Cliente assente</button>}
            {["richiesta", "in_valutazione", "proposta"].includes(a.status) && <button disabled={busy} className="btn-danger" onClick={() => confirm("Rifiutare la richiesta?") && action("rifiuta")}>Rifiuta</button>}
          </div>}
          {canAct && ["confermata", "attesa_pagamento", "proposta", "in_valutazione", "richiesta"].includes(a.status) && (
            <div className="flex flex-wrap items-end gap-2 rounded-2xl border border-red-100 bg-red-50/40 p-3">
              <Field label="Motivo annullamento / assenza" className="min-w-[220px] flex-1"><select className="input" value={f.cancelReason} onChange={(e) => setF({ ...f, cancelReason: e.target.value })}><option value="">Seleziona…</option>{reasons.map((r) => <option key={r} value={r}>{r}</option>)}</select></Field>
              <button disabled={busy || !f.cancelReason} className="btn-danger btn-sm" onClick={() => confirm("Annullare l'appuntamento? Il cliente riceverà una comunicazione.") && action("annulla", { reason: f.cancelReason })}>Annulla appuntamento</button>
            </div>
          )}
          {["confermata", "attesa_pagamento", "completata"].includes(a.status) && (
            <div className="rounded-2xl border border-slate-200 p-4">
              <Field label="Note sul trattamento (storico del cane)"><textarea className="input" value={f.treatmentNotes || ""} onChange={(e) => setF({ ...f, treatmentNotes: e.target.value })} placeholder="Es. taglio corto 6 mm, molti nodi sulle zampe posteriori…" /></Field>
              {a.status === "completata" && canEdit && <button className="btn-ghost btn-sm mt-2" onClick={() => run(() => patch(`/api/admin/appointments/${id}`, { treatmentNotes: f.treatmentNotes || null }), "Note salvate")}>Salva note trattamento</button>}
            </div>
          )}

          <div className="rounded-2xl border border-slate-200 p-4">
            <Field label="Note interne"><textarea className="input" value={f.adminNotes || ""} onChange={(e) => setF({ ...f, adminNotes: e.target.value })} /></Field>
            {canEdit && <button className="btn-ghost btn-sm mt-2" onClick={() => run(() => patch(`/api/admin/appointments/${id}`, { adminNotes: f.adminNotes || null }), "Note salvate")}>Salva note</button>}
          </div>

          {canPay &&           <div className="rounded-2xl border border-slate-200 p-4">
            <h3 className="mb-2 font-bold">Pagamenti</h3>
            {a.payments.length > 0 && <table className="table-dp mb-3"><tbody>{a.payments.map((p: any) => <tr key={p.id}><td>{fmtDateTime(p.paidAt ?? p.createdAt)}</td><td>{PAYMENT_KINDS[p.kind]}</td><td>{p.methodLabel || PAYMENT_METHODS[p.method]}</td><td className="font-bold">{euro(p.amountCents)}</td><td>{p.status}</td></tr>)}</tbody></table>}
            <div className="grid gap-2 sm:grid-cols-4">
              <select className="input" value={pay.kind} onChange={(e) => setPay({ ...pay, kind: e.target.value })}>{Object.entries(PAYMENT_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              <select className="input" value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}>{Object.entries(PAYMENT_METHODS).filter(([k]) => k !== "online").map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              <MoneyInput value={pay.amountCents} onChange={(v) => setPay({ ...pay, amountCents: v })} />
              <button className="btn-navy" disabled={busy || !pay.amountCents} onClick={() => run(() => post("/api/admin/payments", { appointmentId: id, kind: pay.kind, method: pay.method, amountCents: pay.amountCents, methodLabel: pay.method === "altro" ? pay.methodLabel || null : null }), "Pagamento registrato")}>Registra incasso</button>
              {pay.method === "altro" && <input className="input sm:col-span-2" placeholder="Specifica metodo" value={pay.methodLabel} onChange={(e) => setPay({ ...pay, methodLabel: e.target.value })} />}
            </div>
          </div>}

          <details className="rounded-2xl border border-slate-200 p-4">
            <summary className="cursor-pointer font-bold">Storico modifiche ({a.events.length})</summary>
            <ul className="mt-2 space-y-1 text-sm">{a.events.map((e: any) => (
              <li key={e.id} className="flex flex-wrap gap-2"><span className="text-slate-400">{fmtDateTime(e.createdAt)}</span><b>{e.action.replaceAll("_", " ")}</b>{e.toStatus && e.toStatus !== e.fromStatus && <span>→ {STATUS_LABELS[e.toStatus]}</span>}<span className="text-slate-500">{e.actor || "sistema/cliente"}</span>{e.data?.reason && <span className="italic">“{e.data.reason}”</span>}</li>
            ))}</ul>
          </details>
        </div>
      )}
    </Modal>
  );
}
