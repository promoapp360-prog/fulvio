import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { post } from "@/lib/api";

export default function LoyaltyClaim({ pending = [] }: { pending?: { code: string }[] }) {
  const qc = useQueryClient(), [code, setCode] = useState(""), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  return <section className="card space-y-3">
    <h2 className="font-bold">Hai già una tessera Self-Service?</h2>
    <p className="text-sm text-slate-600">Dopo la registrazione puoi recuperare i tuoi punti. Usa gli stessi recapiti: con email verificata l'associazione è diretta; per il telefono il salone verifica prima la titolarità. Non creiamo doppioni né uniamo schede in automatico.</p>
    {pending.map(p => <p key={p.code} className="text-sm text-brand-blue">Tessera {p.code}: verifica del salone in attesa.</p>)}
    <form className="flex flex-col gap-3 sm:flex-row" onSubmit={async e => {
      e.preventDefault(); if (busy) return; setBusy(true); setMessage("");
      try { const out = await post("/api/account/loyalty/claim", { code: code.replace(/\s/g, "").toUpperCase() }); setMessage(out.message); qc.invalidateQueries({ queryKey: ["acc-loyalty"] }); }
      catch (e: any) { setMessage(e.message); } finally { setBusy(false); }
    }}>
      <label className="min-w-0 flex-1 text-sm">Numero tessera<input required maxLength={20} autoComplete="off" className="input mt-1 uppercase" placeholder="DP12345678" value={code} onChange={e => setCode(e.target.value)} /></label>
      <button disabled={busy} className="btn-primary min-h-11 sm:self-end">{busy ? "Verifica…" : "Associa la tessera"}</button>
    </form>
    {message && <p role="status" className="text-sm">{message}</p>}
  </section>;
}
