import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { PageTitle, Spinner, Modal, Field, Check, MoneyInput, ErrorBox, Tabs, useToast } from "@/components/ui";
import ResourceManager from "@/components/ResourceManager";
import { get, post, patch, del } from "@/lib/api";
import { useMe, can } from "@/lib/auth";
import { SettingsForm } from "./Content";
import { fmtDay } from "@/lib/format";
import { euro, SIZES, SIZE_LABELS, WEEKDAYS } from "@shared/constants";
import { useAdminOperators } from "./AppointmentDetail";

export function Services() {
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState("servizi");
  const { data, isLoading } = useQuery<any[]>({ queryKey: ["admin-services"], queryFn: () => get("/api/admin/services") });
  const { data: ops } = useAdminOperators();
  const [edit, setEdit] = useState<any>(null);
  const [err, setErr] = useState<unknown>(null);

  const open = (s: any) => { setErr(null); setEdit({
    name: "", category: "Toelettatura", description: "", priceCents: null, priceFrom: true, durationMin: 60, bookable: true, active: true, visible: true, sortOrder: 0, operatorIds: [],
    ...s, variants: SIZES.map((size) => ({ size, priceCents: s.variants?.find((v: any) => v.size === size)?.priceCents ?? null, durationMin: s.variants?.find((v: any) => v.size === size)?.durationMin ?? null })),
  }); };
  const save = async () => {
    setErr(null);
    const { id, slug, createdAt, supplements, ...body } = edit;
    body.durationMin = Number(body.durationMin); body.sortOrder = Number(body.sortOrder);
    body.variants = body.variants.map((v: any) => ({ ...v, durationMin: v.durationMin ? Number(v.durationMin) : null }));
    try { if (id) await patch(`/api/admin/services/${id}`, body); else await post("/api/admin/services", body); toast("Servizio salvato"); setEdit(null); qc.invalidateQueries({ queryKey: ["admin-services"] }); qc.invalidateQueries({ queryKey: ["admin-operators"] }); }
    catch (e) { setErr(e); }
  };
  const cats = Array.from(new Set((data || []).map((s) => s.category)));

  return (
    <div>
      <PageTitle title="Servizi e listino" subtitle="Prezzi, durate, varianti per taglia e operatori abilitati">
        {tab === "servizi" && <button className="btn-primary btn-sm" onClick={() => open({})}><Plus size={14} /> Nuovo servizio</button>}
      </PageTitle>
      <Tabs value={tab} onChange={setTab} items={[{ value: "servizi", label: "Servizi" }, { value: "supplementi", label: "Supplementi" }]} />
      {tab === "supplementi" ? (
        <ResourceManager title="Supplementi" subtitle="Applicati automaticamente in base alla scheda cane (nodi, muta, comportamento) o manualmente" endpoint="/api/admin/supplements"
          defaults={{ condition: "manuale", priceCents: 0, extraMin: 0, active: true }}
          fields={[
            { name: "name", label: "Nome", required: true },
            { name: "serviceId", label: "Servizio", type: "select", numeric: true, options: (data || []).map((s) => ({ value: s.id, label: s.name })), hint: "Vuoto = tutti i servizi" },
            { name: "condition", label: "Si applica se", type: "select", required: true, options: [{ value: "manuale", label: "Manuale (solo dal salone)" }, { value: "nodi", label: "Il cane ha nodi" }, { value: "muta", label: "Il cane è in muta" }, { value: "aggressivo", label: "Comportamento aggressivo" }, { value: "esigenze", label: "Esigenze particolari" }] },
            { name: "priceCents", label: "Prezzo aggiuntivo", type: "money" },
            { name: "extraMin", label: "Minuti aggiuntivi", type: "number" },
            { name: "active", label: "Attivo", type: "checkbox" },
          ]}
          transform={(b) => ({ ...b, priceCents: b.priceCents ?? 0 })}
          columns={[{ key: "name", label: "Supplemento" }, { key: "condition", label: "Condizione" }, { key: "priceCents", label: "Prezzo", render: (r) => euro(r.priceCents) }, { key: "extraMin", label: "+ min" }]}
        />
      ) : isLoading ? <Spinner /> : cats.map((c) => (
        <section key={c} className="mb-6">
          <h2 className="mb-2 text-lg font-bold">{c}</h2>
          <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
            <table className="table-dp"><thead><tr><th>Servizio</th><th>Prezzo</th><th>Durata</th><th>Operatori</th><th>Stato</th><th /></tr></thead>
              <tbody>{data!.filter((s) => s.category === c).map((s) => (
                <tr key={s.id}>
                  <td className="font-bold">{s.name}</td>
                  <td>{s.priceCents != null ? `${s.priceFrom ? "da " : ""}${euro(s.priceCents)}` : <span className="text-amber-600">da impostare</span>}{s.variants.length > 0 && <span className="block text-xs text-slate-500">{s.variants.length} varianti taglia</span>}</td>
                  <td>{s.durationMin} min</td>
                  <td className="text-xs">{ops?.filter((o) => s.operatorIds.includes(o.id)).map((o) => o.name).join(", ") || <span className="text-red-600">nessuno</span>}</td>
                  <td className="text-xs">{s.active ? "Attivo" : "Disattivo"} · {s.visible ? "visibile" : "nascosto"} · {s.bookable ? "prenotabile" : "non prenotabile"}</td>
                  <td className="whitespace-nowrap"><button className="btn-ghost btn-sm" onClick={() => open(s)}><Pencil size={14} /></button>
                    <button className="btn-ghost btn-sm text-red-600" onClick={async () => { if (confirm("Eliminare il servizio? Se ha appuntamenti verrà solo disattivato.")) { await del(`/api/admin/services/${s.id}`); qc.invalidateQueries({ queryKey: ["admin-services"] }); } }}><Trash2 size={14} /></button></td>
                </tr>
              ))}</tbody></table>
          </div>
        </section>
      ))}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? `Modifica ${edit.name}` : "Nuovo servizio"} wide>
        {edit && (
          <form onSubmit={(e) => { e.preventDefault(); save(); }} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Nome *" className="sm:col-span-2"><input className="input" required value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
              <Field label="Categoria *"><input className="input" required list="cats" value={edit.category} onChange={(e) => setEdit({ ...edit, category: e.target.value })} /><datalist id="cats">{cats.map((c) => <option key={c} value={c} />)}</datalist></Field>
              <Field label="Descrizione" className="sm:col-span-3"><textarea className="input" value={edit.description || ""} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></Field>
              <Field label="Prezzo base" hint="Vuoto = su richiesta"><MoneyInput value={edit.priceCents} onChange={(v) => setEdit({ ...edit, priceCents: v })} /></Field>
              <Field label="Durata base (min) *"><input type="number" min={5} step={5} className="input" required value={edit.durationMin} onChange={(e) => setEdit({ ...edit, durationMin: e.target.value })} /></Field>
              <Field label="Ordine"><input type="number" className="input" value={edit.sortOrder} onChange={(e) => setEdit({ ...edit, sortOrder: e.target.value })} /></Field>
            </div>
            <div className="flex flex-wrap gap-4">
              <Check checked={edit.priceFrom} onChange={(v) => setEdit({ ...edit, priceFrom: v })} label='Mostra "da" davanti al prezzo' />
              <Check checked={edit.active} onChange={(v) => setEdit({ ...edit, active: v })} label="Attivo" />
              <Check checked={edit.visible} onChange={(v) => setEdit({ ...edit, visible: v })} label="Visibile sul sito" />
              <Check checked={edit.bookable} onChange={(v) => setEdit({ ...edit, bookable: v })} label="Richiedibile on line" />
              <Check checked={edit.earnsPoints !== false} onChange={(v) => setEdit({ ...edit, earnsPoints: v })} label="Genera punti Fidelity" />
            </div>
            <div>
              <p className="label">Varianti per taglia (vuoto = usa prezzo/durata base)</p>
              <div className="grid gap-2 sm:grid-cols-4">{edit.variants.map((v: any, i: number) => (
                <div key={v.size} className="rounded-xl border border-slate-200 p-2">
                  <p className="mb-1 text-sm font-bold">{SIZE_LABELS[v.size]}</p>
                  <MoneyInput value={v.priceCents} onChange={(c) => { const vs = [...edit.variants]; vs[i] = { ...v, priceCents: c }; setEdit({ ...edit, variants: vs }); }} />
                  <input type="number" className="input mt-1" placeholder="minuti" value={v.durationMin ?? ""} onChange={(e) => { const vs = [...edit.variants]; vs[i] = { ...v, durationMin: e.target.value || null }; setEdit({ ...edit, variants: vs }); }} />
                </div>
              ))}</div>
            </div>
            <div>
              <p className="label">Operatori abilitati</p>
              <div className="flex flex-wrap gap-4">{ops?.map((o) => <Check key={o.id} checked={edit.operatorIds.includes(o.id)} onChange={(on) => setEdit({ ...edit, operatorIds: on ? [...edit.operatorIds, o.id] : edit.operatorIds.filter((x: number) => x !== o.id) })} label={o.name} />)}</div>
            </div>
            <ErrorBox error={err} />
            <button className="btn-primary">Salva servizio</button>
          </form>
        )}
      </Modal>
    </div>
  );
}

export function Operators() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: ops, isLoading } = useAdminOperators();
  const { data: services } = useQuery<any[]>({ queryKey: ["admin-services"], queryFn: () => get("/api/admin/services") });
  const { data: staff } = useQuery<any>({ queryKey: ["staff-users"], queryFn: () => get("/api/admin/users").catch(() => ({ rows: [] })) });
  const [edit, setEdit] = useState<any>(null);
  const [err, setErr] = useState<unknown>(null);

  const open = (o: any) => { setErr(null); setEdit({ name: "", color: "#2E8DE6", bio: "", hourlyRateCents: 1000, vatNumber: "", bookableOnline: true, active: true, sortOrder: 0, userId: null, serviceIds: [], shifts: [], ...o }); };
  const save = async () => {
    setErr(null);
    const { id, createdAt, ...body } = edit;
    body.shifts = body.shifts.map(({ weekday, startTime, endTime, breakStart, breakEnd }: any) => ({ weekday: Number(weekday), startTime, endTime, breakStart: breakStart || null, breakEnd: breakEnd || null }));
    body.sortOrder = Number(body.sortOrder); body.userId = body.userId ? Number(body.userId) : null; body.vatNumber = body.vatNumber || null; body.bio = body.bio || null;
    try { if (id) await patch(`/api/admin/operators/${id}`, body); else await post("/api/admin/operators", body); toast("Operatore salvato"); setEdit(null); qc.invalidateQueries({ queryKey: ["admin-operators"] }); qc.invalidateQueries({ queryKey: ["admin-services"] }); }
    catch (e) { setErr(e); }
  };
  const setShift = (i: number, k: string, v: any) => { const sh = [...edit.shifts]; sh[i] = { ...sh[i], [k]: v }; setEdit({ ...edit, shifts: sh }); };

  return (
    <div>
      <PageTitle title="Operatori" subtitle="Collaboratori, competenze (servizi abilitati), compenso orario e turni settimanali">
        <button className="btn-primary btn-sm" onClick={() => open({})}><Plus size={14} /> Nuovo operatore</button>
      </PageTitle>
      {isLoading ? <Spinner /> : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {ops?.map((o) => (
            <div key={o.id} className={`card ${!o.active ? "opacity-60" : ""}`}>
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-full font-bold text-white" style={{ background: o.color }}>{o.name[0]}</span>
                  <div><h3 className="text-lg font-bold">{o.name}</h3><p className="text-xs text-slate-500">{euro(o.hourlyRateCents)}/ora · {o.bookableOnline ? "prenotabile on line" : "solo dal salone"}</p></div></div>
                <button className="btn-ghost btn-sm" onClick={() => open(o)}><Pencil size={14} /></button>
              </div>
              <ul className="mt-3 space-y-0.5 text-sm">{o.shifts.map((s: any) => <li key={s.id}><b className="inline-block w-24">{WEEKDAYS[s.weekday]}</b>{s.startTime}–{s.endTime}{s.breakStart && <span className="text-xs text-slate-500"> (pausa {s.breakStart}–{s.breakEnd})</span>}</li>)}</ul>
              <p className="mt-3 text-xs text-slate-600">{services?.filter((s) => o.serviceIds.includes(s.id)).map((s) => s.name).join(" · ")}</p>
            </div>
          ))}
        </div>
      )}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? `Modifica ${edit.name}` : "Nuovo operatore"} wide>
        {edit && (
          <form onSubmit={(e) => { e.preventDefault(); save(); }} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Nome *"><input className="input" required value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
              <Field label="Colore agenda"><input type="color" className="h-10 w-20 rounded" value={edit.color} onChange={(e) => setEdit({ ...edit, color: e.target.value })} /></Field>
              <Field label="Compenso orario"><MoneyInput value={edit.hourlyRateCents} onChange={(v) => setEdit({ ...edit, hourlyRateCents: v ?? 0 })} /></Field>
              <Field label="Partita IVA"><input className="input" value={edit.vatNumber || ""} onChange={(e) => setEdit({ ...edit, vatNumber: e.target.value })} /></Field>
              <Field label="Utente collegato" hint="Per timbrature e agenda personale"><select className="input" value={edit.userId || ""} onChange={(e) => setEdit({ ...edit, userId: e.target.value })}><option value="">—</option>{staff?.rows?.map((u: any) => <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>)}</select></Field>
              <Field label="Ordine"><input type="number" className="input" value={edit.sortOrder} onChange={(e) => setEdit({ ...edit, sortOrder: e.target.value })} /></Field>
              <Field label="Presentazione (sito)" className="sm:col-span-3"><textarea className="input" value={edit.bio || ""} onChange={(e) => setEdit({ ...edit, bio: e.target.value })} /></Field>
            </div>
            <div className="flex gap-4"><Check checked={edit.active} onChange={(v) => setEdit({ ...edit, active: v })} label="Attivo" /><Check checked={edit.bookableOnline} onChange={(v) => setEdit({ ...edit, bookableOnline: v })} label="Selezionabile dai clienti" /></div>
            <div>
              <p className="label">Servizi abilitati</p>
              <div className="grid gap-1 sm:grid-cols-3">{services?.map((s) => <Check key={s.id} checked={edit.serviceIds.includes(s.id)} onChange={(on) => setEdit({ ...edit, serviceIds: on ? [...edit.serviceIds, s.id] : edit.serviceIds.filter((x: number) => x !== s.id) })} label={s.name} />)}</div>
            </div>
            <div>
              <p className="label">Turni settimanali</p>
              <div className="space-y-2">{edit.shifts.map((s: any, i: number) => (
                <div key={i} className="grid grid-cols-2 items-end gap-2 sm:grid-cols-6">
                  <select className="input" value={s.weekday} onChange={(e) => setShift(i, "weekday", e.target.value)}>{WEEKDAYS.map((w, j) => <option key={j} value={j}>{w}</option>)}</select>
                  <input type="time" className="input" value={s.startTime} onChange={(e) => setShift(i, "startTime", e.target.value)} aria-label="Inizio" />
                  <input type="time" className="input" value={s.endTime} onChange={(e) => setShift(i, "endTime", e.target.value)} aria-label="Fine" />
                  <input type="time" className="input" value={s.breakStart || ""} onChange={(e) => setShift(i, "breakStart", e.target.value)} aria-label="Inizio pausa" title="Inizio pausa" />
                  <input type="time" className="input" value={s.breakEnd || ""} onChange={(e) => setShift(i, "breakEnd", e.target.value)} aria-label="Fine pausa" title="Fine pausa" />
                  <button type="button" className="btn-ghost btn-sm text-red-600" onClick={() => setEdit({ ...edit, shifts: edit.shifts.filter((_: any, j: number) => j !== i) })}>Rimuovi</button>
                </div>
              ))}</div>
              <p className="mt-1 text-xs text-slate-500">Colonne: giorno · inizio · fine · pausa dalle · pausa alle</p>
              <button type="button" className="btn-outline btn-sm mt-2" onClick={() => setEdit({ ...edit, shifts: [...edit.shifts, { weekday: 1, startTime: "09:00", endTime: "19:00", breakStart: "", breakEnd: "" }] })}><Plus size={14} /> Aggiungi turno</button>
            </div>
            <ErrorBox error={err} />
            <button className="btn-primary">Salva operatore</button>
          </form>
        )}
      </Modal>
    </div>
  );
}

/** Turni e disponibilità: quadro turni, ferie/assenze/chiusure, postazioni e griglia oraria. */
export function Availability() {
  const [tab, setTab] = useState("turni");
  const { data: ops } = useAdminOperators();
  return (
    <div>
      <PageTitle title="Turni e disponibilità" subtitle="Le richieste on line rispettano turni, pause, ferie, chiusure, griglia e intervalli" />
      <Tabs value={tab} onChange={setTab} items={[{ value: "turni", label: "Quadro turni" }, { value: "assenze", label: "Ferie, assenze e chiusure" }, { value: "griglia", label: "Griglia e intervalli" }, { value: "risorse", label: "Postazioni" }]} />
      {tab === "turni" && (
        <div className="overflow-x-auto rounded-2xl border bg-white">
          <table className="table-dp"><thead><tr><th>Operatore</th>{[1, 2, 3, 4, 5, 6, 0].map((d) => <th key={d}>{WEEKDAYS[d]}</th>)}</tr></thead>
            <tbody>{ops?.filter((o) => o.active).map((o) => (
              <tr key={o.id}><td className="font-bold"><span className="mr-1 inline-block h-2.5 w-2.5 rounded-full" style={{ background: o.color }} />{o.name}</td>
                {[1, 2, 3, 4, 5, 6, 0].map((d) => <td key={d} className="text-xs">{o.shifts.filter((s: any) => s.weekday === d).map((s: any) => <div key={s.id}>{s.startTime}–{s.endTime}{s.breakStart && <span className="text-slate-400"> (pausa {s.breakStart}–{s.breakEnd})</span>}</div>)}</td>)}</tr>
            ))}</tbody></table>
          <p className="p-3 text-xs text-slate-500">Per modificare turni, pause e servizi abilitati apri la scheda dell'operatore in <a href="/admin/operatori" className="underline">Operatori</a>.</p>
        </div>
      )}
      {tab === "assenze" && (
        <ResourceManager title="Ferie, assenze e chiusure" subtitle="Senza operatore = chiusura del salone per tutti. Senza orari = giornata intera." endpoint="/api/admin/absences"
          defaults={{ kind: "ferie" }}
          fields={[
            { name: "operatorId", label: "Operatore", type: "select", numeric: true, options: (ops || []).map((o) => ({ value: o.id, label: o.name })), hint: "Vuoto = chiusura salone" },
            { name: "kind", label: "Tipo", type: "select", required: true, options: [{ value: "ferie", label: "Ferie" }, { value: "assenza", label: "Assenza" }, { value: "malattia", label: "Malattia" }, { value: "chiusura", label: "Chiusura" }, { value: "altro", label: "Altro" }] },
            { name: "startDate", label: "Dal", type: "date", required: true }, { name: "endDate", label: "Al", type: "date", required: true },
            { name: "startTime", label: "Dalle ore (facoltativo)", type: "time" }, { name: "endTime", label: "Alle ore (facoltativo)", type: "time" },
            { name: "note", label: "Note", nullable: true, full: true },
          ]}
          columns={[{ key: "operatorId", label: "Chi", render: (r) => ops?.find((o) => o.id === r.operatorId)?.name || <b>Tutto il salone</b> }, { key: "kind", label: "Tipo" }, { key: "startDate", label: "Periodo", render: (r) => `${fmtDay(r.startDate)} → ${fmtDay(r.endDate)}${r.startTime ? ` (${r.startTime}–${r.endTime})` : ""}` }, { key: "note", label: "Note" }]}
        />
      )}
      {tab === "griglia" && <SettingsForm section="booking" title="Griglia oraria e regole delle richieste" fields={[
        { key: "slotMinutes", label: "Griglia oraria (minuti)", type: "number", hint: "15, 30, 45, 60 o qualsiasi intervallo personalizzato" },
        { key: "bufferMin", label: "Intervallo tra appuntamenti (minuti)", type: "number" },
        { key: "minNoticeHours", label: "Preavviso minimo richieste on line (ore)", type: "number" },
        { key: "maxDaysAhead", label: "Giorni richiedibili in anticipo", type: "number" },
        { key: "requestBlocksSlot", label: "Le richieste in attesa occupano lo slot (evita doppie richieste)", type: "checkbox" },
        { key: "allowAnyOperator", label: "Consenti 'Nessuna preferenza' sull'operatore", type: "checkbox" },
      ]} />}
      {tab === "risorse" && (

        <ResourceManager title="Postazioni e risorse" endpoint="/api/admin/resources" defaults={{ kind: "postazione", active: true }}
          fields={[{ name: "name", label: "Nome", required: true }, { name: "kind", label: "Tipo" }, { name: "active", label: "Attiva", type: "checkbox" }]}
          columns={[{ key: "name", label: "Nome" }, { key: "kind", label: "Tipo" }, { key: "active", label: "Attiva", render: (r) => (r.active ? "✓" : "—") }]} />
      )}
    </div>
  );
}

/** Listino: prezzi e durate per taglia di tutti i servizi, modificabili in un'unica tabella. */
export function PriceList() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data } = useQuery<any[]>({ queryKey: ["admin-services"], queryFn: () => get("/api/admin/services") });
  const { data: me } = useMe();
  const editable = can(me ?? null, "impostazioni");
  const [rows, setRows] = useState<Record<number, any>>({});
  const row = (s: any) => rows[s.id] ?? { priceCents: s.priceCents, durationMin: s.durationMin, variants: SIZES.map((size) => ({ size, priceCents: s.variants.find((v: any) => v.size === size)?.priceCents ?? null, durationMin: s.variants.find((v: any) => v.size === size)?.durationMin ?? null })) };
  const set = (s: any, patch: any) => setRows({ ...rows, [s.id]: { ...row(s), ...patch } });
  const save = async (s: any) => {
    const r = row(s);
    try { await patch(`/api/admin/services/${s.id}`, { priceCents: r.priceCents, durationMin: Number(r.durationMin), variants: r.variants.map((v: any) => ({ ...v, durationMin: v.durationMin ? Number(v.durationMin) : null })) });
      const n = { ...rows }; delete n[s.id]; setRows(n); toast(`${s.name}: listino aggiornato`); qc.invalidateQueries({ queryKey: ["admin-services"] }); }
    catch (e: any) { toast(e.message, "err"); }
  };
  return (
    <div>
      <PageTitle title="Listino" subtitle="Prezzo e durata base, varianti per taglia (vuoto = usa la base). Il prezzo definitivo è sempre confermato dal salone." />
      <div className="overflow-x-auto rounded-2xl border bg-white">
        <table className="table-dp"><thead><tr><th>Servizio</th><th>Base</th>{SIZES.map((z) => <th key={z}>{SIZE_LABELS[z]}</th>)}<th /></tr></thead>
          <tbody>{data?.map((s) => { const r = row(s); return (
            <tr key={s.id}>
              <td className="font-bold">{s.name}<span className="block text-xs font-normal text-slate-500">{s.category}</span></td>
              <td className="min-w-[120px]"><MoneyInput value={r.priceCents} disabled={!editable} onChange={(v) => set(s, { priceCents: v })} /><input type="number" disabled={!editable} className="input mt-1" value={r.durationMin} onChange={(e) => set(s, { durationMin: e.target.value })} aria-label="Durata base" /></td>
              {r.variants.map((v: any, i: number) => (
                <td key={v.size} className="min-w-[110px]"><MoneyInput value={v.priceCents} disabled={!editable} onChange={(c) => { const vs = [...r.variants]; vs[i] = { ...v, priceCents: c }; set(s, { variants: vs }); }} />
                  <input type="number" disabled={!editable} className="input mt-1" placeholder="min" value={v.durationMin ?? ""} onChange={(e) => { const vs = [...r.variants]; vs[i] = { ...v, durationMin: e.target.value || null }; set(s, { variants: vs }); }} /></td>
              ))}
              <td>{editable && rows[s.id] && <button className="btn-primary btn-sm" onClick={() => save(s)}>Salva</button>}</td>
            </tr>); })}</tbody></table>
      </div>
      <p className="mt-2 text-xs text-slate-500">Prima riga: prezzo; seconda riga: durata in minuti. I supplementi (nodi, muta, comportamento…) si gestiscono in Servizi → Supplementi.</p>
    </div>
  );
}
