import { useEffect, useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Camera, ImagePlus } from "lucide-react";
import { Field, ErrorBox } from "./ui";
import { get } from "@/lib/api";
import { DOG_BREEDS, breedSearch } from "@shared/dog-breeds";
import { SIZES, SIZE_LABELS } from "@shared/constants";
import { todayISO } from "@/lib/format";

export const newCustomerDog = () => ({
  name: "", species: "cane", breed: "", size: "media", weightKg: "", birthDate: "",
  coatType: "", coatLength: "", food: { notes: "" }, jointIssues: "", dermatitis: "",
  intolerances: "", sensitivities: "", aggressive: false, aggressiveNotes: "", otherNeeds: "", otherPets: "",
  customFields: {},
});

async function compressedPhoto(file: File) {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("Scegli una foto JPG, PNG o WebP.");
  if (file.size > 12 * 1024 * 1024) throw new Error("La foto originale deve essere inferiore a 12 MB.");
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d"); if (!ctx) throw new Error("Impossibile elaborare la foto.");
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.8, 0.65, 0.5, 0.35]) {
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/webp", quality));
      if (blob && blob.size <= 950_000) return new File([blob], "foto-cane.webp", { type: "image/webp" });
    }
    throw new Error("La foto è ancora troppo grande: scegli uno scatto più leggero.");
  } finally { bitmap.close(); }
}

export function DogPhotoInput({ file, existingUrl, onChange, onProcessingChange }: { file: File | null; existingUrl?: string; onChange: (file: File) => void; onProcessingChange?: (busy: boolean) => void }) {
  const [preview, setPreview] = useState(""), [error, setError] = useState<unknown>(null), [busy, setBusy] = useState(false);
  useEffect(() => { if (!file) { setPreview(""); return; } const url = URL.createObjectURL(file); setPreview(url); return () => URL.revokeObjectURL(url); }, [file]);
  const choose = async (candidate?: File) => {
    if (!candidate) return;
    setBusy(true); onProcessingChange?.(true); setError(null);
    try { onChange(await compressedPhoto(candidate)); } catch (e) { setError(e); } finally { setBusy(false); onProcessingChange?.(false); }
  };
  return <fieldset className="rounded-xl border border-sky-200 p-4">
    <legend className="px-1 text-sm font-bold">Foto del tuo animale (facoltativa)</legend>
    <p className="mb-3 text-sm text-slate-600">Puoi aggiungerla ora o in seguito nella scheda e riutilizzarla per le richieste. Foto privata, compressa automaticamente sotto 1 MB.</p>
    {(preview || existingUrl) && <img src={preview || existingUrl} alt="Foto del tuo animale" className="mb-3 h-36 w-36 rounded-xl object-contain" />}
    <div className="flex flex-wrap gap-2">
      <label className="btn-outline min-h-11 cursor-pointer"><ImagePlus size={17} />{busy ? "Elaborazione…" : file || existingUrl ? "Sostituisci foto" : "Scegli dalla galleria"}<input disabled={busy} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={e => void choose(e.target.files?.[0])} /></label>
      <label className="btn-outline min-h-11 cursor-pointer"><Camera size={17} />Scatta una foto<input disabled={busy} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="sr-only" onChange={e => void choose(e.target.files?.[0])} /></label>
    </div>
    {file && <p className="mt-2 text-xs text-slate-600">Foto pronta: {Math.round(file.size / 1024)} KB</p>}
    <ErrorBox error={error} />
  </fieldset>;
}

export default function CustomerDogFields({ value: d, onChange }: { value: any; onChange: (value: any) => void }) {
  const [search, setSearch] = useState(""), [open, setOpen] = useState(false), [other, setOther] = useState(false);
  const listId = useId();
  const { data: fields } = useQuery<any[]>({ queryKey: ["customer-dog-fields"], queryFn: () => get("/api/public/dog-fields") });
  const set = (key: string, value: unknown) => onChange({ ...d, [key]: value });
  const input = (key: string, label: string) => <Field label={label}>
    <input maxLength={1000} className="input min-h-12" value={d[key] || ""} onChange={e => set(key, e.target.value)} />
  </Field>;
  return <div className="space-y-5">
    <fieldset className="grid gap-3 rounded-2xl border p-4 sm:grid-cols-2">
      <legend className="px-1 font-bold text-brand-navy">Il nostro ospite</legend>
      <Field label="Nome *"><input required maxLength={80} className="input min-h-12" value={d.name || ""} onChange={e => set("name", e.target.value)} /></Field>
      <Field label="Specie *"><select required className="input min-h-12" value={d.species || "cane"} onChange={e => onChange({ ...d, species: e.target.value, breed: "" })}><option value="cane">Cane</option><option value="gatto">Gatto</option></select></Field>
      <Field label="Razza *" hint="Cerca una razza, scegli Meticcio oppure Altra razza.">
        {d.species === "gatto" ? <input required className="input min-h-12" value={d.breed || ""} onChange={e => set("breed", e.target.value)} /> : <div className="relative">
          <input required role="combobox" aria-controls={listId} aria-expanded={open} aria-autocomplete="list" className="input min-h-12" value={open ? search : other ? "Altra razza" : d.breed || ""} placeholder="Cerca la razza…" onFocus={() => { setSearch(""); setOpen(true); }} onBlur={e => { if (!document.getElementById(listId)?.contains(e.relatedTarget)) setTimeout(() => setOpen(false), 160); }} onChange={e => { setSearch(e.target.value); setOpen(true); }} onKeyDown={e => { if (e.key === "Escape") setOpen(false); if (open && e.key === "ArrowDown") { e.preventDefault(); document.getElementById(listId)?.querySelector<HTMLButtonElement>("button")?.focus(); } if (open && e.key === "Enter") e.preventDefault(); }} />
          {open && <div id={listId} role="listbox" onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false); }} className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-xl border bg-white p-1 shadow-lg">
            {Array.from(new Set([...DOG_BREEDS.filter(name => breedSearch(name).includes(breedSearch(search))).slice(0, 25), "Meticcio", "Altra razza"])).map(name => <button key={name} type="button" role="option" aria-selected={!other && d.breed === name} className="min-h-11 w-full rounded-lg px-3 text-left text-sm hover:bg-brand-sky" onMouseDown={e => e.preventDefault()} onClick={() => { setOther(name === "Altra razza"); set("breed", name === "Altra razza" ? "" : name); setOpen(false); }}>{name}</button>)}
          </div>}
          {other && <input aria-label="Specifica la razza" required maxLength={120} className="input mt-2 min-h-12" value={d.breed || ""} onChange={e => set("breed", e.target.value)} placeholder="Specifica la razza" />}
        </div>}
      </Field>
      <Field label="Taglia *"><select required className="input min-h-12" value={d.size || "media"} onChange={e => set("size", e.target.value)}>{SIZES.map(size => <option key={size} value={size}>{SIZE_LABELS[size]}</option>)}</select></Field>
      <Field label="Peso circa (kg) *"><input required type="number" inputMode="decimal" min="0.2" max="150" step="0.1" className="input min-h-12" value={d.weightKg || ""} onChange={e => set("weightKg", e.target.value)} /></Field>
      <Field label="Data di nascita *"><input required type="date" max={todayISO()} className="input min-h-12" value={d.birthDate || ""} onChange={e => set("birthDate", e.target.value)} /></Field>
      <Field label="Tipo di pelo *"><select required className="input min-h-12" value={d.coatType || ""} onChange={e => set("coatType", e.target.value)}><option value="">Seleziona…</option>{["liscio", "mosso", "riccio", "duro", "altro"].map(type => <option key={type} value={type}>{type[0].toUpperCase() + type.slice(1)}</option>)}</select></Field>
      <Field label="Lunghezza del pelo *"><select required className="input min-h-12" value={d.coatLength || ""} onChange={e => set("coatLength", e.target.value)}><option value="">Seleziona…</option>{["corto", "medio", "lungo"].map(length => <option key={length} value={length}>{length[0].toUpperCase() + length.slice(1)}</option>)}</select></Field>
    </fieldset>
    <fieldset className="grid gap-3 rounded-2xl border p-4 sm:grid-cols-2">
      <legend className="px-1 font-bold text-brand-navy">Parlaci del Benessere del tuo Animale</legend>
      <p className="text-sm text-slate-600 sm:col-span-2">Queste informazioni sono facoltative. Condividi solo ciò che desideri farci sapere per prenderci cura del tuo animale.</p>
      {input("jointIssues", "Problematiche articolari")}{input("dermatitis", "Dermatiti")}
      {input("intolerances", "Intolleranze")}{input("sensitivities", "Sensibilità")}
      <Field label="Può mordere o mostrare aggressività?"><select className="input min-h-12" value={d.aggressive ? "si" : "no"} onChange={e => set("aggressive", e.target.value === "si")}><option value="no">No</option><option value="si">Sì</option></select></Field>
      {d.aggressive && input("aggressiveNotes", "Dettagli comportamento")}
      {input("otherNeeds", "Altre esigenze")}{input("otherPets", "Altri animali in famiglia")}
      <Field label="Alimentazione abituale" className="sm:col-span-2" hint="Se vuoi, indica tipo di alimentazione, eventuali marchi ed esigenze."><textarea maxLength={2000} className="input min-h-24" value={d.food?.notes || ""} onChange={e => set("food", { ...d.food, notes: e.target.value })} /></Field>
    </fieldset>
    {!!fields?.length && <fieldset className="grid gap-3 rounded-2xl border p-4 sm:grid-cols-2"><legend className="px-1 font-bold">Informazioni richieste dal salone</legend>
      {fields.map(field => <Field key={field.fieldKey} label={field.label + (field.required ? " *" : "")}>
        {field.fieldType === "select" ? <select required={field.required} className="input min-h-12" value={d.customFields?.[field.fieldKey] || ""} onChange={e => set("customFields", { ...d.customFields, [field.fieldKey]: e.target.value })}><option value="">Seleziona…</option>{field.options.map((option: string) => <option key={option}>{option}</option>)}</select>
          : field.fieldType === "checkbox" ? <select required={field.required} className="input min-h-12" value={d.customFields?.[field.fieldKey] === undefined ? "" : d.customFields[field.fieldKey] ? "si" : "no"} onChange={e => set("customFields", { ...d.customFields, [field.fieldKey]: e.target.value === "si" })}><option value="">Seleziona…</option><option value="no">No</option><option value="si">Sì</option></select>
            : <input required={field.required} type={["number", "date"].includes(field.fieldType) ? field.fieldType : "text"} className="input min-h-12" value={d.customFields?.[field.fieldKey] ?? ""} onChange={e => set("customFields", { ...d.customFields, [field.fieldKey]: e.target.value })} />}
      </Field>)}
    </fieldset>}
  </div>;
}
