import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { X, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { STATUS_COLORS, STATUS_LABELS } from "@shared/constants";
import { centsToInput, inputToCents } from "@/lib/format";

// ---------- toast ----------
type Toast = { id: number; text: string; kind: "ok" | "err" };
const ToastCtx = createContext<(text: string, kind?: "ok" | "err") => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [list, setList] = useState<Toast[]>([]);
  const push = useCallback((text: string, kind: "ok" | "err" = "ok") => {
    const id = Date.now() + Math.random();
    setList((l) => [...l, { id, text, kind }]);
    setTimeout(() => setList((l) => l.filter((t) => t.id !== id)), 4500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed inset-x-0 bottom-4 z-[100] flex flex-col items-center gap-2 px-4" aria-live="polite">
        {list.map((t) => (
          <div key={t.id} className={`flex max-w-md items-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold text-white shadow-lg ${t.kind === "ok" ? "bg-brand-navy" : "bg-red-600"}`}>
            {t.kind === "ok" ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />} {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

// ---------- campi ----------
export function Field({ label, children, hint, className = "" }: { label: string; children: React.ReactNode; hint?: string; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export function MoneyInput({ value, onChange, placeholder = "0,00", ...rest }: { value: number | null | undefined; onChange: (c: number | null) => void; placeholder?: string } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  const [txt, setTxt] = useState(centsToInput(value));
  useEffect(() => { if (inputToCents(txt) !== (value ?? null)) setTxt(centsToInput(value)); }, [value]); // eslint-disable-line
  return (
    <div className="relative">
      <input {...rest} inputMode="decimal" className="input pr-8" value={txt} placeholder={placeholder}
        onChange={(e) => { setTxt(e.target.value); onChange(inputToCents(e.target.value)); }} />
      <span className="pointer-events-none absolute right-3 top-2 text-sm text-slate-400">€</span>
    </div>
  );
}

export function Check({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: React.ReactNode }) {
  return (
    <label className="flex cursor-pointer items-start gap-2 text-sm">
      <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-turquoise focus:ring-brand-turquoise" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

// ---------- varie ----------
export const Spinner = ({ label = "Caricamento…" }: { label?: string }) => (
  <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500"><Loader2 className="animate-spin" size={18} /> {label}</div>
);

export const Empty = ({ children }: { children: React.ReactNode }) => (
  <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">{children}</div>
);

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  return <div className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700">{(error as Error).message}</div>;
}

export function StatusBadge({ status, labels = STATUS_LABELS, colors = STATUS_COLORS }: { status: string; labels?: Record<string, string>; colors?: Record<string, string> }) {
  const c = colors[status] || "#64748b";
  return <span className="badge" style={{ background: c + "22", color: c }}>{labels[status] || status}</span>;
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", k); document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", k); document.body.style.overflow = ""; };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-0 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title} className={`max-h-[92vh] w-full overflow-y-auto rounded-t-3xl bg-white p-5 shadow-xl sm:rounded-3xl ${wide ? "sm:max-w-4xl" : "sm:max-w-xl"}`}>
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="text-lg font-bold">{title}</h2>
          <button className="btn-ghost btn-sm" onClick={onClose} aria-label="Chiudi"><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { value: T; label: string }[] }) {
  return (
    <div className="mb-4 flex flex-wrap gap-1 rounded-2xl bg-slate-100 p-1">
      {items.map((i) => (
        <button key={i.value} onClick={() => onChange(i.value)}
          className={`rounded-xl px-3 py-1.5 text-sm font-bold transition ${value === i.value ? "bg-white text-brand-navy shadow" : "text-slate-500 hover:text-brand-navy"}`}>{i.label}</button>
      ))}
    </div>
  );
}

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total?: number; onPage: (p: number) => void }) {
  const pages = total != null ? Math.max(1, Math.ceil(total / pageSize)) : undefined;
  return (
    <div className="mt-3 flex items-center justify-end gap-2 text-sm">
      <button className="btn-ghost btn-sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>‹ Prec.</button>
      <span>Pagina {page}{pages ? ` di ${pages}` : ""}</span>
      <button className="btn-ghost btn-sm" disabled={pages != null && page >= pages} onClick={() => onPage(page + 1)}>Succ. ›</button>
    </div>
  );
}

export function PageTitle({ title, children, subtitle }: { title: string; subtitle?: string; children?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div><h1 className="text-2xl font-extrabold">{title}</h1>{subtitle && <p className="text-sm text-slate-500">{subtitle}</p>}</div>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

// ---------- markdown minimale (titoli, elenchi, grassetto, corsivo, link) ----------
function inline(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g;
  let last = 0; let m: RegExpExecArray | null; let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith("**")) out.push(<strong key={k++}>{t.slice(2, -2)}</strong>);
    else if (t.startsWith("[")) {
      const [, label, href] = t.match(/\[([^\]]+)\]\(([^)]+)\)/)!;
      const safe = /^(https?:|mailto:|tel:|\/)/.test(href) ? href : "#";
      out.push(<a key={k++} href={safe} target={safe.startsWith("http") ? "_blank" : undefined} rel="noreferrer">{label}</a>);
    } else out.push(<em key={k++}>{t.slice(1, -1)}</em>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text, className = "" }: { text: string; className?: string }) {
  const blocks = (text || "").replace(/\r/g, "").split(/\n{2,}/);
  return (
    <div className={`prose-dp ${className}`}>
      {blocks.map((b, i) => {
        const lines = b.split("\n").filter(Boolean);
        if (!lines.length) return null;
        if (lines[0].startsWith("### ")) return <h3 key={i}>{inline(lines[0].slice(4))}</h3>;
        if (lines[0].startsWith("## ")) return <h2 key={i}>{inline(lines[0].slice(3))}</h2>;
        if (lines.every((l) => /^[-*] /.test(l))) return <ul key={i}>{lines.map((l, j) => <li key={j}>{inline(l.slice(2))}</li>)}</ul>;
        if (lines.every((l) => /^\d+\. /.test(l))) return <ol key={i}>{lines.map((l, j) => <li key={j}>{inline(l.replace(/^\d+\. /, ""))}</li>)}</ol>;
        return <p key={i}>{lines.map((l, j) => <React.Fragment key={j}>{j > 0 && <br />}{inline(l)}</React.Fragment>)}</p>;
      })}
    </div>
  );
}
