import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock } from "lucide-react";
import { get, put } from "@/lib/api";
import { can, useMe } from "@/lib/auth";
import { fmtDateTime } from "@/lib/format";
import { treatmentDurationInput } from "@shared/treatment-duration";
import { ErrorBox, Field, Spinner, useToast } from "@/components/ui";

type DurationData = {
  actualDurationMin: number | null;
  history: { id: number; startAt: string; actualDurationMin: number }[];
};

export default function TreatmentDuration({ kind, bookingId }: { kind: "appointment" | "guest"; bookingId: number }) {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const path = `/api/admin/treatment-duration/${kind}/${bookingId}`;
  const queryKey = ["treatment-duration", kind, bookingId];
  const { data, isLoading, error } = useQuery<DurationData>({
    queryKey, queryFn: () => get(path), refetchInterval: 30_000,
  });
  const [value, setValue] = useState("");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);
  const canEdit = can(me ?? null, "agenda_edit", "richieste");
  useEffect(() => { setValue(""); setDirty(false); setSaveError(null); }, [kind, bookingId]);
  useEffect(() => {
    if (data && !dirty) setValue(data.actualDurationMin == null ? "" : String(data.actualDurationMin));
  }, [data, dirty]);

  async function save() {
    setSaveError(null);
    const parsed = treatmentDurationInput.safeParse({ actualDurationMin: value.trim() === "" ? null : Number(value) });
    if (!parsed.success) { setSaveError(new Error("Inserisci un numero intero da 1 a 600 minuti, oppure lascia vuoto per rimuoverlo.")); return; }
    setBusy(true);
    try {
      await put(path, parsed.data);
      setDirty(false);
      await qc.invalidateQueries({ queryKey: ["treatment-duration"] });
      // Aggiorna gli eventi senza ricaricare i campi non salvati del dettaglio aperto.
      await qc.invalidateQueries({ queryKey: [kind === "guest" ? "admin-guest-booking" : "admin-app", bookingId], refetchType: "none" });
      toast("Durata trattamento salvata");
    } catch (e) { setSaveError(e); } finally { setBusy(false); }
  }

  return <section className="rounded-2xl border border-sky-200 bg-brand-sky/40 p-4" aria-label="Durata trattamento">
    <h3 className="mb-2 flex items-center gap-2 font-bold text-brand-navy"><Clock size={18} aria-hidden="true" />Durata trattamento</h3>
    <p className="mb-3 text-sm text-slate-600">Memorizza il tempo effettivamente impiegato per questo animale e queste prestazioni. Non modifica lo slot in agenda.</p>
    {isLoading ? <Spinner /> : error ? <ErrorBox error={error} /> : data && <>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Tempo impiegato (minuti)" className="min-w-0 flex-1">
          <input type="number" min={1} max={600} step={1} inputMode="numeric"
            className="input min-h-11" placeholder="Es. 75" value={value} disabled={!canEdit || busy}
            onChange={e => { setValue(e.target.value); setDirty(true); }} />
        </Field>
        {canEdit && <button type="button" className="btn-navy min-h-11" disabled={busy || !dirty} onClick={save}>{busy ? "Salvataggio…" : "Salva durata"}</button>}
      </div>
      <ErrorBox error={saveError} />
      <div className="mt-3 border-t border-sky-200 pt-3 text-sm">
        {data.history.length ? <>
          <p className="font-bold text-brand-navy">Ultimo trattamento analogo: {data.history[0].actualDurationMin} minuti</p>
          <p className="text-xs text-slate-600">Stesso cliente, animale e prestazioni · {fmtDateTime(data.history[0].startAt)}</p>
          {data.history.length > 1 && <details className="mt-2"><summary className="min-h-11 cursor-pointer py-2 font-semibold">Altri tempi precedenti</summary>
            <ul className="space-y-1">{data.history.slice(1).map(row => <li key={row.id}>{fmtDateTime(row.startAt)} · <b>{row.actualDurationMin} min</b></li>)}</ul>
          </details>}
        </> : <p className="text-slate-600">Nessuna durata precedente registrata per questo animale e queste prestazioni.</p>}
      </div>
    </>}
  </section>;
}
