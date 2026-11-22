import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Search } from "lucide-react";
import { Field, Check, MoneyInput, Modal, ErrorBox, Spinner, Empty, Pager, PageTitle, useToast } from "./ui";
import { api, get, del } from "@/lib/api";

export type FieldDef = {
  name: string; label: string;
  type?: "text" | "textarea" | "number" | "money" | "date" | "time" | "select" | "checkbox" | "tags" | "color" | "email";
  options?: (string | { value: string | number; label: string })[];
  required?: boolean; hint?: string; full?: boolean; nullable?: boolean; numeric?: boolean;
};
export type ColumnDef = { key: string; label: string; render?: (row: any) => React.ReactNode };

/** Gestione generica (lista, ricerca, paginazione, crea/modifica/elimina) per le risorse del gestionale. */
export default function ResourceManager({ title, subtitle, endpoint, fields, columns, defaults = {}, searchable, extraQuery = "", canDelete = true, toolbar, transform }: {
  title: string; subtitle?: string; endpoint: string; fields: FieldDef[]; columns: ColumnDef[]; defaults?: Record<string, any>;
  searchable?: boolean; extraQuery?: string; canDelete?: boolean; toolbar?: React.ReactNode; transform?: (d: any) => any;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<any>(null);
  const [err, setErr] = useState<unknown>(null);
  const key = [endpoint, page, q, extraQuery];
  const { data, isLoading } = useQuery<any>({ queryKey: key, queryFn: () => get(`${endpoint}?page=${page}&pageSize=25${q ? `&q=${encodeURIComponent(q)}` : ""}${extraQuery}`) });
  const rows: any[] = Array.isArray(data) ? data : data?.rows || [];

  const save = async () => {
    setErr(null);
    try {
      let body: any = {};
      for (const f of fields) {
        let v = editing[f.name];
        if (f.type === "number") v = v === "" || v == null ? (f.nullable ? null : 0) : Number(v);
        if (f.type === "select" && f.numeric) v = v === "" || v == null ? null : Number(v);
        if ((f.type === "date" || f.type === "time" || f.nullable) && v === "") v = null;
        if (f.type === "tags") v = Array.isArray(v) ? v : String(v || "").split(",").map((x) => x.trim()).filter(Boolean);
        body[f.name] = v;
      }
      if (transform) body = transform(body);
      if (editing.id) await api(`${endpoint}/${editing.id}`, { method: "PATCH", body });
      else await api(endpoint, { method: "POST", body });
      toast("Salvato"); setEditing(null); qc.invalidateQueries({ queryKey: [endpoint] });
    } catch (e) { setErr(e); }
  };
  const remove = async (row: any) => {
    if (!confirm("Eliminare definitivamente questo elemento?")) return;
    try { await del(`${endpoint}/${row.id}`); toast("Eliminato"); qc.invalidateQueries({ queryKey: [endpoint] }); } catch (e: any) { toast(e.message, "err"); }
  };
  const input = (f: FieldDef) => {
    const v = editing?.[f.name];
    const set = (val: any) => setEditing({ ...editing, [f.name]: val });
    switch (f.type) {
      case "textarea": return <textarea className="input min-h-[110px]" required={f.required} value={v ?? ""} onChange={(e) => set(e.target.value)} />;
      case "money": return <MoneyInput value={v} onChange={set} />;
      case "checkbox": return <Check checked={!!v} onChange={set} label="Sì" />;
      case "select": return (
        <select className="input" required={f.required} value={v ?? ""} onChange={(e) => set(e.target.value)}>
          {!f.required && <option value="">—</option>}
          {f.options!.map((o) => typeof o === "string" ? <option key={o} value={o}>{o}</option> : <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      );
      case "tags": return <input className="input" value={Array.isArray(v) ? v.join(", ") : v ?? ""} onChange={(e) => set(e.target.value)} placeholder="valori separati da virgola" />;
      case "color": return <input type="color" className="h-10 w-20 rounded" value={v || "#2E8DE6"} onChange={(e) => set(e.target.value)} />;
      default: return <input className="input" type={f.type || "text"} required={f.required} value={v ?? ""} onChange={(e) => set(e.target.value)} step={f.type === "number" ? "any" : undefined} />;
    }
  };

  return (
    <div>
      <PageTitle title={title} subtitle={subtitle}>
        {toolbar}
        <button className="btn-primary btn-sm" onClick={() => { setErr(null); setEditing({ ...defaults }); }}><Plus size={14} /> Nuovo</button>
      </PageTitle>
      {searchable && (
        <div className="relative mb-3 max-w-sm"><Search size={16} className="absolute left-3 top-2.5 text-slate-400" />
          <input className="input pl-9" placeholder="Cerca…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></div>
      )}
      {isLoading ? <Spinner /> : rows.length === 0 ? <Empty>Nessun elemento.</Empty> : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          <table className="table-dp">
            <thead><tr>{columns.map((c) => <th key={c.key}>{c.label}</th>)}<th className="w-24" /></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50">
                {columns.map((c) => <td key={c.key}>{c.render ? c.render(r) : String(r[c.key] ?? "—")}</td>)}
                <td className="whitespace-nowrap text-right">
                  <button className="btn-ghost btn-sm" onClick={() => { setErr(null); setEditing({ ...r }); }} aria-label="Modifica"><Pencil size={14} /></button>
                  {canDelete && <button className="btn-ghost btn-sm text-red-600" onClick={() => remove(r)} aria-label="Elimina"><Trash2 size={14} /></button>}
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {!Array.isArray(data) && data?.total != null && <Pager page={page} pageSize={25} total={data.total} onPage={setPage} />}
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? `Modifica – ${title}` : `Nuovo – ${title}`} wide={fields.length > 6}>
        {editing && (
          <form onSubmit={(e) => { e.preventDefault(); save(); }} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              {fields.map((f) => <Field key={f.name} label={f.label + (f.required ? " *" : "")} hint={f.hint} className={f.full || f.type === "textarea" ? "sm:col-span-2" : ""}>{input(f)}</Field>)}
            </div>
            <ErrorBox error={err} />
            <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={() => setEditing(null)}>Annulla</button><button className="btn-primary">Salva</button></div>
          </form>
        )}
      </Modal>
    </div>
  );
}
