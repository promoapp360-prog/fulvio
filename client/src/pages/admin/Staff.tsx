import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Download, Clock, KeyRound, RefreshCw, LogOut } from "lucide-react";
import { PageTitle, Spinner, Empty, Modal, Field, Check, MoneyInput, ErrorBox, Tabs, Pager, StatusBadge, useToast } from "@/components/ui";
import { get, post, patch, del } from "@/lib/api";
import { useMe, can } from "@/lib/auth";
import { todayISO, fmtDay, mins, fmtDateTime, addDaysISO } from "@/lib/format";
import { euro, ROLE_LABELS } from "@shared/constants";
import { useAdminOperators } from "./AppointmentDetail";
import { settlementOutstanding, settlementTotals } from "@shared/staff-settlements";

const monthStart = () => todayISO().slice(0, 8) + "01";

export function Worklogs() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: me } = useMe();
  const manager = me?.role === "admin" || can(me ?? null, "personale");
  const { data: ops } = useAdminOperators();
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(todayISO());
  const [op, setOp] = useState("");
  const [edit, setEdit] = useState<any>(null);
  const [err, setErr] = useState<unknown>(null);
  const [sel, setSel] = useState<number[]>([]);
  const qs = `from=${from}&to=${to}${op ? `&operatorId=${op}` : ""}`;
  const { data, isLoading } = useQuery<any>({ queryKey: ["worklogs", qs], queryFn: () => get(`/api/admin/worklogs?${qs}`) });

  const save = async () => {
    setErr(null);
    const body: any = { operatorId: Number(edit.operatorId), workDate: edit.workDate, clockIn: edit.clockIn, clockOut: edit.clockOut || null, breakMin: Number(edit.breakMin || 0), note: edit.note || null };
    if (manager && edit.hourlyRateCents != null) body.hourlyRateCents = edit.hourlyRateCents;
    if (edit.id && edit.correctionNote) body.correctionNote = edit.correctionNote;
    try { if (edit.id) await patch(`/api/admin/worklogs/${edit.id}`, body); else await post("/api/admin/worklogs", body); toast("Registrazione salvata"); setEdit(null); qc.invalidateQueries({ queryKey: ["worklogs"] }); }
    catch (e) { setErr(e); }
  };
  const clock = async () => { try { const r = await post("/api/admin/worklogs/clock"); toast(`${r.action === "entrata" ? "Entrata" : "Uscita"} registrata`); qc.invalidateQueries({ queryKey: ["worklogs"] }); } catch (e: any) { toast(e.message, "err"); } };

  return (
    <div>
      <PageTitle title="Ore lavorate" subtitle="Presenze dei collaboratori (distinte dalle ore prenotate dai clienti), conteggiate al quarto d'ora">
        {me?.role === "operator" && <button className="btn-outline btn-sm" onClick={clock}><Clock size={14} /> Timbra</button>}
        <a className="btn-outline btn-sm" href={`/api/admin/worklogs?${qs}&format=xlsx`}><Download size={14} /> Excel</a>
        <a className="btn-outline btn-sm" href={`/api/admin/worklogs?${qs}&format=pdf`}><Download size={14} /> PDF</a>
        <button className="btn-primary btn-sm" onClick={() => { setErr(null); setEdit({ operatorId: op || ops?.[0]?.id, workDate: todayISO(), clockIn: "09:00", clockOut: "", breakMin: 0, note: "" }); }}><Plus size={14} /> Registra ore</button>
      </PageTitle>
      <div className="mb-4 flex flex-wrap gap-2">
        <input type="date" className="input w-40" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Dal" />
        <input type="date" className="input w-40" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Al" />
        {manager && <select className="input w-48" value={op} onChange={(e) => setOp(e.target.value)}><option value="">Tutti gli operatori</option>{ops?.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>}
      </div>
      {isLoading ? <Spinner /> : (
        <>
          <div className="mb-5 grid gap-3 sm:grid-cols-3">{data.summary.map((s: any) => (
            <div key={s.operatorId} className="card"><p className="font-bold">{s.name}</p><p className="text-sm text-slate-600">{s.days} giornate · {mins(s.minutes)}</p><p className="text-xl font-extrabold text-brand-navy">{euro(s.amountCents)}</p>{s.unsettledCents > 0 && <p className="text-xs text-amber-600">non ancora liquidato {euro(s.unsettledCents)}</p>}</div>
          ))}</div>
          {!data.rows.length ? <Empty>Nessuna registrazione nel periodo.</Empty> : (
            <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
              <table className="table-dp"><thead><tr><th>Data</th><th>Operatore</th><th>Entrata</th><th>Uscita</th><th>Pausa</th><th>Effettivo</th><th>Compenso</th><th>Note</th><th /></tr></thead>
                <tbody>{data.rows.map((w: any) => (
                  <tr key={w.id}>

                    <td>{fmtDay(w.workDate)}</td><td>{w.operatorName}</td><td>{w.clockIn}</td><td>{w.clockOut || <span className="text-amber-600">in corso</span>}</td><td>{w.breakMin}′</td><td>{mins(w.effectiveMin)}{w.rawMin !== w.effectiveMin && w.clockOut && <span className="block text-[10px] text-slate-400">reali {mins(w.rawMin)}</span>}</td>
                    <td>{euro(w.amountCents)}{w.paid ? <span className="badge ml-1 bg-green-100 text-green-700">pagato</span> : w.settlementId ? <span className="badge ml-1 bg-sky-100 text-sky-700">liquidato</span> : null}</td>
                    <td className="text-xs">{w.note}{w.corrected && <span className="block text-amber-700">Corretto: {w.correctionNote}</span>}</td>
                    <td>{!w.settlementId && <button className="btn-ghost btn-sm" onClick={() => { setErr(null); setEdit({ ...w, correctionNote: "" }); }}><Pencil size={14} /></button>}</td>
                  </tr>
                ))}</tbody></table>
            </div>
          )}
          <p className="mt-3 text-xs text-slate-500">Il pagamento si gestisce in <a href="/admin/compensi" className="underline">Compensi collaboratori</a> (liquidazione settimanale del sabato).</p>
        </>
      )}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? "Modifica registrazione" : "Registra ore"}>
        {edit && (
          <form onSubmit={(e) => { e.preventDefault(); save(); }} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Operatore"><select className="input" disabled={!!edit.id} value={edit.operatorId || ""} onChange={(e) => setEdit({ ...edit, operatorId: e.target.value })}>{ops?.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></Field>
              <Field label="Data"><input type="date" className="input" value={edit.workDate} onChange={(e) => setEdit({ ...edit, workDate: e.target.value })} /></Field>
              <Field label="Entrata"><input type="time" className="input" required value={edit.clockIn} onChange={(e) => setEdit({ ...edit, clockIn: e.target.value })} /></Field>
              <Field label="Uscita"><input type="time" className="input" value={edit.clockOut || ""} onChange={(e) => setEdit({ ...edit, clockOut: e.target.value })} /></Field>
              <Field label="Pause (minuti)"><input type="number" min={0} className="input" value={edit.breakMin} onChange={(e) => setEdit({ ...edit, breakMin: e.target.value })} /></Field>
              {manager && <Field label="Tariffa oraria" hint="Vuoto = tariffa dell'operatore"><MoneyInput value={edit.hourlyRateCents} onChange={(v) => setEdit({ ...edit, hourlyRateCents: v })} /></Field>}
              <Field label="Note" className="sm:col-span-2"><input className="input" value={edit.note || ""} onChange={(e) => setEdit({ ...edit, note: e.target.value })} /></Field>
              {edit.id && manager && <Field label="Motivo della correzione" className="sm:col-span-2" hint="Obbligatorio per modificare una giornata chiusa"><input className="input" value={edit.correctionNote} onChange={(e) => setEdit({ ...edit, correctionNote: e.target.value })} /></Field>}
            </div>
            <ErrorBox error={err} />
            <button className="btn-primary">Salva</button>
          </form>
        )}
      </Modal>
    </div>
  );
}

export function Users() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: me } = useMe();
  const { data, isLoading } = useQuery<any>({ queryKey: ["staff-users"], queryFn: () => get("/api/admin/users") });
  const [edit, setEdit] = useState<any>(null);
  const [err, setErr] = useState<unknown>(null);
  const [temp, setTemp] = useState<string | null>(null);
  const [tab, setTab] = useState("utenti");
  const save = async () => {
    setErr(null);
    const body: any = { firstName: edit.firstName, lastName: edit.lastName, email: edit.email, username: edit.username || null, phone: edit.phone || null, role: edit.role, permissions: edit.permissions, active: edit.active };
    try {
      if (edit.id) await patch(`/api/admin/users/${edit.id}`, body);
      else { const r = await post("/api/admin/users", body); setTemp(`Credenziali temporanee per ${r.user.username || r.user.email}: ${r.tempPassword} (cambio obbligatorio al primo accesso)`); }
      toast("Utente salvato"); setEdit(null); qc.invalidateQueries({ queryKey: ["staff-users"] });
    } catch (e) { setErr(e); }
  };
  if (isLoading) return <Spinner />;
  const perms: Record<string, string> = data.permissions;
  return (
    <div>
      <PageTitle title="Utenti e permessi" subtitle="Personale con accesso al gestionale">
        <button className="btn-primary btn-sm" onClick={() => { setErr(null); setEdit({ firstName: "", lastName: "", email: "", username: "", phone: "", role: "operator", permissions: ["agenda_view"], active: true }); }}><Plus size={14} /> Nuovo utente</button>
      </PageTitle>
      <Tabs value={tab} onChange={setTab} items={[{ value: "utenti", label: "Utenti" }, ...(me?.role === "admin" ? [{ value: "accessi", label: "Registro accessi" }] : [])]} />
      {tab === "accessi" ? <LoginLog /> : <>
      {temp && <div className="mb-4 rounded-xl bg-green-50 p-3 text-sm font-semibold text-green-800">{temp} – comunicala in modo riservato.</div>}
      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table className="table-dp"><thead><tr><th>Nome</th><th>Email</th><th>Ruolo</th><th>Permessi</th><th>Stato</th><th /></tr></thead>
          <tbody>{data.rows.map((u: any) => (
            <tr key={u.id}><td className="font-bold">{u.firstName} {u.lastName}{u.mustChangePassword && <span className="badge ml-1 bg-amber-100 text-amber-800">password temporanea</span>}</td><td>{u.email}{u.username && <span className="block text-xs text-slate-500">username: {u.username}</span>}</td><td>{ROLE_LABELS[u.role]}</td>
              <td className="text-xs">{u.role === "admin" ? "Tutti" : u.permissions.map((p: string) => perms[p]).join(", ") || "—"}</td><td>{u.active ? "Attivo" : "Disattivo"}</td>
              <td className="whitespace-nowrap"><button className="btn-ghost btn-sm" disabled={u.role === "admin" && me?.role !== "admin"} onClick={() => { setErr(null); setEdit({ ...u }); }}><Pencil size={14} /></button>
                {u.id !== me?.id && !(u.role === "admin" && me?.role !== "admin") && <>
                  <button className="btn-ghost btn-sm" title="Reimposta accesso" onClick={async () => { if (confirm(`Generare una nuova password temporanea per ${u.firstName}?`)) { const r = await post(`/api/admin/users/${u.id}/reset-access`); setTemp(`Nuova password temporanea per ${u.username || u.email}: ${r.tempPassword}`); } }}><KeyRound size={14} /></button>
                  <button className="btn-ghost btn-sm" title="Richiedi cambio password" onClick={async () => { await post(`/api/admin/users/${u.id}/require-password-change`); toast("Al prossimo accesso dovrà cambiare la password"); }}><RefreshCw size={14} /></button>
                  <button className="btn-ghost btn-sm" title="Chiudi tutte le sessioni" onClick={async () => { await post(`/api/admin/users/${u.id}/revoke-sessions`); toast("Sessioni revocate"); }}><LogOut size={14} /></button>
                </>}</td></tr>
          ))}</tbody></table>
      </div>
      </>}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? "Modifica utente" : "Nuovo utente"} wide>
        {edit && (
          <form onSubmit={(e) => { e.preventDefault(); save(); }} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Nome"><input className="input" required value={edit.firstName} onChange={(e) => setEdit({ ...edit, firstName: e.target.value })} /></Field>
              <Field label="Cognome"><input className="input" required value={edit.lastName} onChange={(e) => setEdit({ ...edit, lastName: e.target.value })} /></Field>
              <Field label="Email"><input type="email" className="input" required value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></Field>
              <Field label="Telefono"><input className="input" value={edit.phone || ""} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></Field>
              <Field label="Username (facoltativo)" hint="Per accedere senza email"><input className="input" autoCapitalize="none" value={edit.username || ""} onChange={(e) => setEdit({ ...edit, username: e.target.value })} /></Field>
              <Field label="Ruolo"><select className="input" value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value })}>
                <option value="operator">Operatore (agenda e ore personali)</option><option value="manager">Responsabile (permessi personalizzabili)</option>{me?.role === "admin" && <option value="admin">Admin (accesso completo)</option>}</select></Field>
            </div>
            {edit.role !== "admin" && (
              <div><p className="label">Permessi</p>
                <div className="grid gap-1 sm:grid-cols-3">{Object.entries(perms).map(([k, v]) => <Check key={k} checked={edit.permissions.includes(k)} onChange={(on) => setEdit({ ...edit, permissions: on ? [...edit.permissions, k] : edit.permissions.filter((x: string) => x !== k) })} label={v} />)}</div>
              </div>
            )}
            <Check checked={edit.active} onChange={(v) => setEdit({ ...edit, active: v })} label="Utente attivo" />
            <ErrorBox error={err} />
            <button className="btn-primary">Salva</button>
          </form>
        )}
      </Modal>
    </div>
  );
}

function LoginLog() {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useQuery<any>({ queryKey: ["login-log", page], queryFn: () => get(`/api/admin/login-log?page=${page}&pageSize=50`) });
  if (isLoading) return <Spinner />;
  return (
    <div>
      <div className="overflow-x-auto rounded-2xl border bg-white"><table className="table-dp"><thead><tr><th>Data</th><th>Accesso</th><th>Utente</th><th>Esito</th><th>IP</th></tr></thead>
        <tbody>{data.rows.map((l: any) => <tr key={l.id}><td className="whitespace-nowrap">{fmtDateTime(l.createdAt)}</td><td>{l.login}</td><td>{l.name || "—"}{l.role && <span className="text-xs text-slate-500"> ({ROLE_LABELS[l.role]})</span>}</td>
          <td>{l.success ? <span className="text-green-700">riuscito</span> : <span className="text-red-600">fallito{l.reason ? ` (${l.reason.replace("_", " ")})` : ""}</span>}</td><td className="text-xs">{l.ip}</td></tr>)}</tbody></table></div>
      <Pager page={page} pageSize={50} onPage={setPage} />
    </div>
  );
}

/** Compensi collaboratori: liquidazione settimanale (pagamento del sabato), rettifiche, stato e storico, esportazioni. */
export function Settlements() {
  const qc = useQueryClient();
  const toast = useToast();
  const [day, setDay] = useState(todayISO());
  const [adj, setAdj] = useState<Record<number, { cents: number | null; note: string }>>({});
  const [from, setFrom] = useState(addDaysISO(todayISO(), -90));
  const [to, setTo] = useState(todayISO());
  const [busy, setBusy] = useState<string | null>(null);
  const { data, isLoading, error: previewError } = useQuery<any>({ queryKey: ["settle-preview", day], queryFn: () => get(`/api/admin/settlements/preview?day=${day}`) });
  const { data: hist, error: historyError } = useQuery<any[]>({ queryKey: ["settlements", from, to], queryFn: () => get(`/api/admin/settlements?from=${from}&to=${to}`) });
  const totals = settlementTotals(hist || []);
  const refresh = () => { qc.invalidateQueries({ queryKey: ["settle-preview"] }); qc.invalidateQueries({ queryKey: ["settlements"] }); qc.invalidateQueries({ queryKey: ["worklogs"] }); };
  const create = async (o: any) => {
    if (busy) return;
    setBusy(`create-${o.operatorId}`);
    const a = adj[o.operatorId] || { cents: 0, note: "" };
    try { await post("/api/admin/settlements", { operatorId: o.operatorId, day, adjustmentsCents: a.cents || 0, adjustmentNote: a.note || null }); toast(`Liquidazione di ${o.name} creata`); refresh(); } catch (e: any) { toast(e.message, "err"); refresh(); }
    finally { setBusy(null); }
  };
  const setStatus = async (st: any, status: string) => {
    if (busy) return;
    if (status === "da_pagare" && !confirm(`Annullare la registrazione del pagamento di ${euro(st.totalCents)}? La liquidazione resterà da pagare e le ore resteranno collegate. Non verrà eseguito alcun rimborso o bonifico.`)) return;
    const paidMethod = status === "pagato" ? prompt(`Conferma la registrazione del pagamento di ${euro(st.totalCents)}. Metodo (es. contanti, bonifico):`, "contanti") : null;
    if (status === "pagato" && paidMethod === null) return;
    setBusy(`status-${st.id}`);
    try { await patch(`/api/admin/settlements/${st.id}`, { status, paidMethod }); toast(status === "pagato" ? "Segnata come pagata" : "Pagamento annullato: liquidazione ancora da pagare"); refresh(); } catch (e: any) { toast(e.message, "err"); refresh(); }
    finally { setBusy(null); }
  };
  const cancelSettlement = async (st: any) => {
    if (busy || !confirm(`Annullare la liquidazione di ${euro(st.totalCents)}? Le ore lavorate non verranno eliminate: le giornate torneranno modificabili e liquidabili. La liquidazione resterà nello storico come annullata.`)) return;
    setBusy(`cancel-${st.id}`);
    try { await del(`/api/admin/settlements/${st.id}`); toast("Liquidazione annullata: giornate nuovamente liquidabili"); refresh(); }
    catch (e: any) { toast(e.message, "err"); refresh(); }
    finally { setBusy(null); }
  };
  const actions = (st: any) => st.status === "annullata" ? <span className="text-xs text-slate-500">Conservata nello storico</span> : <div className="flex flex-wrap gap-2">
    {st.status === "pagato"
      ? <button className="btn-ghost btn-sm min-h-11 text-amber-800" disabled={!!busy} onClick={() => setStatus(st, "da_pagare")}>Annulla pagamento</button>
      : <button className="btn-primary btn-sm min-h-11" disabled={!!busy} onClick={() => setStatus(st, "pagato")}>Segna come pagato</button>}
    <button className="btn-ghost btn-sm min-h-11 text-red-700" disabled={!!busy || st.status === "pagato"} title={st.status === "pagato" ? "Annulla prima il pagamento" : "Riapre le giornate senza eliminarle"} onClick={() => cancelSettlement(st)}>Annulla liquidazione</button>
  </div>;
  return (
    <div>
      <PageTitle title="Compensi collaboratori" subtitle="Liquidazione settimanale con pagamento il sabato. Calcolo gestionale: non sostituisce cedolini o adempimenti fiscali." />
      <p className="mb-4 text-sm text-slate-600"><strong>Annulla pagamento</strong> riporta l’importo a “Da pagare”. <strong>Annulla liquidazione</strong> riapre le giornate e conserva lo storico; se è pagata, annulla prima il pagamento. Le azioni sono disponibili anche nello storico e non eseguono movimenti bancari.</p>
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <Field label="Settimana che contiene il giorno"><input type="date" className="input" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} /></Field>
        <button className="btn-outline btn-sm" onClick={() => setDay(addDaysISO(day, -7))}>‹ Settimana prec.</button>
        <button className="btn-outline btn-sm" onClick={() => setDay(addDaysISO(day, 7))}>Settimana succ. ›</button>
      </div>
      {isLoading ? <Spinner /> : previewError ? <ErrorBox error={previewError} /> : data && (
        <>
          <p className="mb-3 font-bold text-brand-navy">Settimana dal {fmtDay(data.week.start)} al {fmtDay(data.week.end)} (pagamento: {fmtDay(data.week.end)})</p>
          {!data.operators.length ? <Empty>Nessuna ora registrata in questa settimana.</Empty> : (
            <div className="grid gap-4 lg:grid-cols-2">
              {data.operators.map((o: any) => (
                <div key={o.operatorId} className="card" data-testid={`settlement-operator-${o.operatorId}`}>
                  <div className="flex items-start justify-between"><div><h3 className="text-lg font-bold">{o.name}</h3><p className="text-sm text-slate-600">{mins(o.minutes)} · maturato {euro(o.grossCents)}</p></div>
                    {o.settlement && <StatusBadge status={o.settlement.status} labels={{ da_pagare: "Da pagare", pagato: "Pagato" }} colors={{ da_pagare: "#F59E0B", pagato: "#16A34A" }} />}</div>
                  <table className="mt-2 w-full text-xs"><tbody>{o.days.map((d: any) => <tr key={d.id} className="border-t border-slate-100"><td className="py-1">{fmtDay(d.workDate)}</td><td>{d.clockIn}–{d.clockOut || "?"}</td><td>pausa {d.breakMin}′</td><td>{mins(d.effectiveMin)}</td><td className="text-right">{euro(d.amountCents)}</td></tr>)}</tbody></table>
                  {o.settlement ? (
                    <div className="mt-3 rounded-xl bg-slate-50 p-3 text-sm">
                      <p>Maturato {euro(o.settlement.grossCents)}{o.settlement.adjustmentsCents ? <> · rettifiche {euro(o.settlement.adjustmentsCents)} ({o.settlement.adjustmentNote})</> : null}</p>
                      <p className="font-semibold">Importo liquidazione {euro(o.settlement.totalCents)}</p>
                      <p className="text-lg font-extrabold text-brand-navy">Residuo da pagare {euro(settlementOutstanding(o.settlement))}</p>
                      {o.settlement.status === "pagato" ? <p className="text-green-700">Pagato il {fmtDay(o.settlement.paidAt)} {o.settlement.paidMethod && `(${o.settlement.paidMethod})`}</p> : null}
                      <div className="mt-2 flex flex-wrap gap-2">
                        {actions(o.settlement)}
                        <a className="btn-outline btn-sm" href={`/api/admin/settlements?from=${data.week.start}&to=${data.week.end}&id=${o.settlement.id}&format=pdf`}><Download size={14} /> PDF</a>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-3 grid gap-2 sm:grid-cols-[140px_1fr_auto] sm:items-end">
                      <Field label="Rettifica (+/-)"><MoneyInput value={adj[o.operatorId]?.cents ?? null} onChange={(v) => setAdj({ ...adj, [o.operatorId]: { note: adj[o.operatorId]?.note || "", cents: v } })} /></Field>
                      <Field label="Motivo rettifica"><input className="input" value={adj[o.operatorId]?.note || ""} onChange={(e) => setAdj({ ...adj, [o.operatorId]: { cents: adj[o.operatorId]?.cents ?? null, note: e.target.value } })} /></Field>
                      <button className="btn-navy btn-sm" disabled={o.open > 0 || !!busy} title={o.open ? "Ci sono giornate senza uscita" : ""} onClick={() => create(o)}>{busy === `create-${o.operatorId}` ? "Creazione…" : "Crea liquidazione"}</button>
                    </div>
                  )}
                  <p className="mt-1 text-[11px] text-slate-400">Per una rettifica negativa inserisci l'importo e poi correggi il segno nel campo (es. −5,00 → scrivi "-5").</p>
                </div>
              ))}
            </div>
          )}
        </>
      )}
      <h2 className="mb-3 mt-8 text-xl font-bold">Storico liquidazioni</h2>
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <input type="date" className="input w-40" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Dal" />
        <input type="date" className="input w-40" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Al" />
        <a className="btn-outline btn-sm" href={`/api/admin/settlements?from=${from}&to=${to}&format=xlsx`}><Download size={14} /> Excel</a>
        <a className="btn-outline btn-sm" href={`/api/admin/settlements?from=${from}&to=${to}&format=pdf`}><Download size={14} /> PDF</a>
      </div>
      <ErrorBox error={historyError} />
      {hist?.length ? <div className="mb-3 grid gap-3 sm:grid-cols-3">
        <div className="card"><p className="text-sm">Importi attivi nel periodo</p><strong>{euro(totals.totalCents)}</strong></div>
        <div className="card"><p className="text-sm">Già pagati</p><strong className="text-green-700">{euro(totals.paidCents)}</strong></div>
        <div className="card"><p className="text-sm">Residuo da pagare</p><strong className="text-amber-800">{euro(totals.outstandingCents)}</strong></div>
      </div> : null}
      {!hist?.length ? <Empty>Nessuna liquidazione nel periodo.</Empty> : (
        <div className="overflow-x-auto rounded-2xl border bg-white"><table className="table-dp"><thead><tr><th>Operatore</th><th>Settimana</th><th>Ore</th><th>Maturato</th><th>Rettifiche</th><th>Importo</th><th>Residuo</th><th>Stato</th><th>Azioni</th></tr></thead>
          <tbody>{hist.map((x) => <tr key={x.id} data-testid={`settlement-history-${x.id}`} className={x.status === "annullata" ? "bg-slate-50 text-slate-500" : ""}><td>{x.operatorName}</td><td>{fmtDay(x.weekStart)} → {fmtDay(x.weekEnd)}</td><td>{x.hours}</td><td>{euro(x.grossCents)}</td><td>{euro(x.adjustmentsCents)}</td><td className="font-bold">{euro(x.totalCents)}</td><td>{euro(settlementOutstanding(x))}</td><td>{x.stato}</td><td className="min-w-[180px]">{actions(x)}</td></tr>)}</tbody></table></div>
      )}
      <p className="mt-2 text-xs text-slate-500">Le liquidazioni annullate restano consultabili con gli importi originali, ma sono escluse dai totali e dal residuo da pagare.</p>
    </div>
  );
}
