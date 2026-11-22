import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Download, Clock } from "lucide-react";
import { PageTitle, Spinner, Empty, Modal, Field, Check, MoneyInput, ErrorBox, useToast } from "@/components/ui";
import { get, post, patch } from "@/lib/api";
import { useMe, can } from "@/lib/auth";
import { todayISO, fmtDay, mins } from "@/lib/format";
import { euro, ROLE_LABELS } from "@shared/constants";
import { useAdminOperators } from "./AppointmentDetail";

const monthStart = () => todayISO().slice(0, 8) + "01";

export function Worklogs() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: me } = useMe();
  const manager = me?.role === "admin" || can(me ?? null, "operatori");
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
      <PageTitle title="Ore lavorate e compensi" subtitle="Operatori a partita IVA – compenso orario modificabile per operatore">
        {me?.role === "operator" && <button className="btn-outline btn-sm" onClick={clock}><Clock size={14} /> Timbra</button>}
        <a className="btn-outline btn-sm" href={`/api/admin/worklogs?${qs}&format=csv`}><Download size={14} /> CSV</a>
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
            <div key={s.operatorId} className="card"><p className="font-bold">{s.name}</p><p className="text-sm text-slate-600">{s.days} giornate · {mins(s.minutes)}</p><p className="text-xl font-extrabold text-brand-navy">{euro(s.amountCents)}</p>{s.unpaidCents > 0 && <p className="text-xs text-amber-600">da liquidare {euro(s.unpaidCents)}</p>}</div>
          ))}</div>
          {!data.rows.length ? <Empty>Nessuna registrazione nel periodo.</Empty> : (
            <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
              <table className="table-dp"><thead><tr>{manager && <th />}<th>Data</th><th>Operatore</th><th>Entrata</th><th>Uscita</th><th>Pausa</th><th>Effettivo</th><th>Compenso</th><th>Note</th><th /></tr></thead>
                <tbody>{data.rows.map((w: any) => (
                  <tr key={w.id}>
                    {manager && <td><input type="checkbox" disabled={w.paid} checked={sel.includes(w.id)} onChange={(e) => setSel(e.target.checked ? [...sel, w.id] : sel.filter((x) => x !== w.id))} /></td>}
                    <td>{fmtDay(w.workDate)}</td><td>{w.operatorName}</td><td>{w.clockIn}</td><td>{w.clockOut || <span className="text-amber-600">in corso</span>}</td><td>{w.breakMin}′</td><td>{mins(w.effectiveMin)}</td>
                    <td>{euro(w.amountCents)}{w.paid && <span className="badge ml-1 bg-green-100 text-green-700">pagato</span>}</td>
                    <td className="text-xs">{w.note}{w.corrected && <span className="block text-amber-700">Corretto: {w.correctionNote}</span>}</td>
                    <td><button className="btn-ghost btn-sm" onClick={() => { setErr(null); setEdit({ ...w, correctionNote: "" }); }}><Pencil size={14} /></button></td>
                  </tr>
                ))}</tbody></table>
            </div>
          )}
          {me?.role === "admin" && sel.length > 0 && <button className="btn-navy btn-sm mt-3" onClick={async () => { await post("/api/admin/worklogs/mark-paid", { ids: sel }); setSel([]); qc.invalidateQueries({ queryKey: ["worklogs"] }); toast("Segnate come pagate"); }}>Segna {sel.length} come pagate</button>}
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
  const save = async () => {
    setErr(null);
    const body: any = { firstName: edit.firstName, lastName: edit.lastName, email: edit.email, phone: edit.phone || null, role: edit.role, permissions: edit.permissions, active: edit.active };
    if (edit.password) body.password = edit.password;
    try {
      if (edit.id) await patch(`/api/admin/users/${edit.id}`, body);
      else { const r = await post("/api/admin/users", body); if (r.tempPassword) setTemp(`Password temporanea per ${r.user.email}: ${r.tempPassword}`); }
      toast("Utente salvato"); setEdit(null); qc.invalidateQueries({ queryKey: ["staff-users"] });
    } catch (e) { setErr(e); }
  };
  if (isLoading) return <Spinner />;
  const perms: Record<string, string> = data.permissions;
  return (
    <div>
      <PageTitle title="Utenti e permessi" subtitle="Personale con accesso al gestionale">
        <button className="btn-primary btn-sm" onClick={() => { setErr(null); setEdit({ firstName: "", lastName: "", email: "", phone: "", role: "staff", permissions: ["agenda", "richieste", "clienti"], active: true, password: "" }); }}><Plus size={14} /> Nuovo utente</button>
      </PageTitle>
      {temp && <div className="mb-4 rounded-xl bg-green-50 p-3 text-sm font-semibold text-green-800">{temp} – comunicala in modo riservato e chiedi di cambiarla al primo accesso.</div>}
      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table className="table-dp"><thead><tr><th>Nome</th><th>Email</th><th>Ruolo</th><th>Permessi</th><th>Stato</th><th /></tr></thead>
          <tbody>{data.rows.map((u: any) => (
            <tr key={u.id}><td className="font-bold">{u.firstName} {u.lastName}</td><td>{u.email}</td><td>{ROLE_LABELS[u.role]}</td>
              <td className="text-xs">{u.role === "admin" ? "Tutti" : u.permissions.map((p: string) => perms[p]).join(", ") || "—"}</td><td>{u.active ? "Attivo" : "Disattivo"}</td>
              <td><button className="btn-ghost btn-sm" disabled={u.role === "admin" && me?.role !== "admin"} onClick={() => { setErr(null); setEdit({ ...u, password: "" }); }}><Pencil size={14} /></button></td></tr>
          ))}</tbody></table>
      </div>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? "Modifica utente" : "Nuovo utente"} wide>
        {edit && (
          <form onSubmit={(e) => { e.preventDefault(); save(); }} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Nome"><input className="input" required value={edit.firstName} onChange={(e) => setEdit({ ...edit, firstName: e.target.value })} /></Field>
              <Field label="Cognome"><input className="input" required value={edit.lastName} onChange={(e) => setEdit({ ...edit, lastName: e.target.value })} /></Field>
              <Field label="Email"><input type="email" className="input" required value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></Field>
              <Field label="Telefono"><input className="input" value={edit.phone || ""} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></Field>
              <Field label="Ruolo"><select className="input" value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value })}>
                <option value="staff">Staff</option><option value="operator">Operatore (agenda e ore personali)</option>{me?.role === "admin" && <option value="admin">Amministratore (accesso completo)</option>}</select></Field>
              <Field label={edit.id ? "Nuova password (facoltativa)" : "Password (vuoto = generata)"}><input type="password" minLength={8} className="input" value={edit.password} onChange={(e) => setEdit({ ...edit, password: e.target.value })} /></Field>
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
