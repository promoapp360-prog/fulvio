import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Field, Check, ErrorBox } from "./ui";
import { get } from "@/lib/api";
import { SIZES, SIZE_LABELS } from "@shared/constants";

export const emptyDog = {
  name: "", breed: "", size: "media", weightKg: "", birthDate: "", notes: "",
  coatKnots: false, coatShedding: false, lastBath: "", coatType: "", coatNotes: "",
  jointIssues: "", dermatitis: "", intolerances: "", sensitivities: "", aggressive: false, aggressiveNotes: "", otherNeeds: "", otherPets: "",
  food: {} as Record<string, any>, customFields: {} as Record<string, any>,
};

export function ageOf(birth?: string | null) {
  if (!birth) return null;
  const b = new Date(birth); const n = new Date();
  let y = n.getFullYear() - b.getFullYear(); let m = n.getMonth() - b.getMonth();
  if (n.getDate() < b.getDate()) m--;
  if (m < 0) { y--; m += 12; }
  return y > 0 ? `${y} ann${y === 1 ? "o" : "i"}${m ? ` e ${m} mes${m === 1 ? "e" : "i"}` : ""}` : `${m} mes${m === 1 ? "e" : "i"}`;
}

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <fieldset className="rounded-2xl border border-slate-200 p-4"><legend className="px-2 font-display text-sm font-bold text-brand-navy">{title}</legend><div className="grid gap-3 sm:grid-cols-2">{children}</div></fieldset>
);

/** Scheda cane completa, con i campi personalizzati definiti dall'amministratore. */
export default function DogForm({ initial, onSubmit, onCancel, fieldsUrl = "/api/account/dog-fields" }: {
  initial?: any; onSubmit: (d: any) => Promise<void>; onCancel?: () => void; fieldsUrl?: string;
}) {
  const [d, setD] = useState<any>(() => ({ ...emptyDog, ...(initial || {}), weightKg: initial?.weightKg ?? "", food: { ...(initial?.food || {}) }, customFields: { ...(initial?.customFields || {}) } }));
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const { data: fields } = useQuery<any[]>({ queryKey: ["dog-fields", fieldsUrl], queryFn: () => get(fieldsUrl).then((r: any) => (Array.isArray(r) ? r : r.rows).filter((f: any) => f.active)) });

  const set = (k: string) => (e: any) => setD({ ...d, [k]: e?.target ? e.target.value : e });
  const setFood = (k: string, v: any) => setD({ ...d, food: { ...d.food, [k]: v } });
  const setCustom = (k: string, v: any) => setD({ ...d, customFields: { ...d.customFields, [k]: v } });

  const custom = (section: string) => (fields || []).filter((f) => f.section === section).map((f) => (
    <Field key={f.id} label={f.label + (f.required ? " *" : "")}>
      {f.fieldType === "checkbox" ? <Check checked={!!d.customFields[f.fieldKey]} onChange={(v) => setCustom(f.fieldKey, v)} label="Sì" />
        : f.fieldType === "select" ? <select className="input" value={d.customFields[f.fieldKey] ?? ""} onChange={(e) => setCustom(f.fieldKey, e.target.value)}><option value="">—</option>{f.options.map((o: string) => <option key={o}>{o}</option>)}</select>
        : <input className="input" type={f.fieldType === "number" ? "number" : f.fieldType === "date" ? "date" : "text"} value={d.customFields[f.fieldKey] ?? ""} onChange={(e) => setCustom(f.fieldKey, e.target.value)} />}
    </Field>
  ));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null); setBusy(true);
    try {
      const nul = (v: any) => (v === "" ? null : v);
      await onSubmit({
        ...d, breed: nul(d.breed), weightKg: d.weightKg === "" ? null : Number(String(d.weightKg).replace(",", ".")), birthDate: nul(d.birthDate), lastBath: nul(d.lastBath),
        id: undefined, ownerId: undefined, createdAt: undefined, updatedAt: undefined, archived: undefined, owner: undefined,
      });
    } catch (x) { setErr(x); } finally { setBusy(false); }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <Section title="Dati principali">
        <Field label="Nome *"><input className="input" required value={d.name} onChange={set("name")} /></Field>
        <Field label="Razza"><input className="input" value={d.breed || ""} onChange={set("breed")} /></Field>
        <Field label="Taglia *"><select className="input" value={d.size} onChange={set("size")}>{SIZES.map((s) => <option key={s} value={s}>{SIZE_LABELS[s]}</option>)}</select></Field>
        <Field label="Peso (kg)"><input className="input" inputMode="decimal" value={d.weightKg ?? ""} onChange={set("weightKg")} /></Field>
        <Field label="Data di nascita" hint={ageOf(d.birthDate) ? `Età: ${ageOf(d.birthDate)}` : undefined}><input type="date" className="input" value={d.birthDate || ""} onChange={set("birthDate")} /></Field>
        <Field label="Note"><input className="input" value={d.notes || ""} onChange={set("notes")} /></Field>
        {custom("principali")}
      </Section>
      <Section title="Stato del pelo">
        <div className="flex flex-col gap-2 pt-5"><Check checked={d.coatKnots} onChange={set("coatKnots")} label="Presenza di nodi" /><Check checked={d.coatShedding} onChange={set("coatShedding")} label="In muta" /></div>
        <Field label="Ultimo bagno"><input type="date" className="input" value={d.lastBath || ""} onChange={set("lastBath")} /></Field>
        <Field label="Tipo di pelo"><input className="input" placeholder="Es. lungo, riccio, duro…" value={d.coatType || ""} onChange={set("coatType")} /></Field>
        <Field label="Note sul mantello"><input className="input" value={d.coatNotes || ""} onChange={set("coatNotes")} /></Field>
        {custom("pelo")}
      </Section>
      <Section title="Benessere">
        <Field label="Problematiche articolari"><input className="input" value={d.jointIssues || ""} onChange={set("jointIssues")} /></Field>
        <Field label="Dermatiti"><input className="input" value={d.dermatitis || ""} onChange={set("dermatitis")} /></Field>
        <Field label="Intolleranze"><input className="input" value={d.intolerances || ""} onChange={set("intolerances")} /></Field>
        <Field label="Sensibilità"><input className="input" value={d.sensitivities || ""} onChange={set("sensitivities")} /></Field>
        <div className="pt-5"><Check checked={d.aggressive} onChange={set("aggressive")} label="Possibili comportamenti aggressivi / morde" /></div>
        {d.aggressive && <Field label="Dettagli comportamento"><input className="input" value={d.aggressiveNotes || ""} onChange={set("aggressiveNotes")} /></Field>}
        <Field label="Altre esigenze"><input className="input" value={d.otherNeeds || ""} onChange={set("otherNeeds")} /></Field>
        <Field label="Altri animali in famiglia"><input className="input" placeholder="Es. un gatto, un altro cane…" value={d.otherPets || ""} onChange={set("otherPets")} /></Field>
        {custom("benessere")}
      </Section>
      <details className="rounded-2xl border border-slate-200 p-4">
        <summary className="cursor-pointer font-display text-sm font-bold text-brand-navy">Alimentazione (facoltativo)</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-2"><Check checked={!!d.food.dry} onChange={(v) => setFood("dry", v)} label="Cibo secco" /><Check checked={!!d.food.wet} onChange={(v) => setFood("wet", v)} label="Cibo umido" /></div>
          <Field label="Gusti preferiti"><input className="input" value={d.food.flavors || ""} onChange={(e) => setFood("flavors", e.target.value)} /></Field>
          <Field label="Marchi"><input className="input" value={d.food.brands || ""} onChange={(e) => setFood("brands", e.target.value)} /></Field>
          <Field label="Esigenze alimentari"><input className="input" value={d.food.needs || ""} onChange={(e) => setFood("needs", e.target.value)} /></Field>
          <Field label="Diete particolari"><input className="input" value={d.food.diets || ""} onChange={(e) => setFood("diets", e.target.value)} /></Field>
          <Field label="Note"><input className="input" value={d.food.notes || ""} onChange={(e) => setFood("notes", e.target.value)} /></Field>
          {custom("alimentazione")}
        </div>
      </details>
      {(fields || []).some((f) => f.section === "altro") && <Section title="Altre informazioni">{custom("altro")}</Section>}
      <ErrorBox error={err} />
      <div className="flex justify-end gap-2">
        {onCancel && <button type="button" className="btn-ghost" onClick={onCancel}>Annulla</button>}
        <button className="btn-primary" disabled={busy}>Salva scheda</button>
      </div>
    </form>
  );
}
