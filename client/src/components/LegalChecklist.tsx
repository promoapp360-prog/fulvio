import { useQuery } from "@tanstack/react-query";
import { get } from "@/lib/api";
import { LEGAL_CHECKLIST } from "@shared/legal";
import { fmtDateTime } from "@/lib/format";

export default function LegalChecklist(){
  const {data,error}=useQuery<any[]>({queryKey:["cookie-choices"],queryFn:()=>get("/api/admin/cookie-choices")});
  return <div className="space-y-4">
    <section className="card">
      <h2 className="mb-3 text-xl font-bold">Checklist prima della pubblicazione finale</h2>
      <p className="mb-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-950">Non pubblicare come definitiva una policy incompleta. Queste verifiche richiedono conferma del titolare e, per gli aspetti legali, di un consulente qualificato.</p>
      <ol className="list-decimal space-y-3 pl-5 text-sm">{LEGAL_CHECKLIST.map(item=><li key={item}>{item}</li>)}</ol>
      <h3 className="mb-2 mt-5 font-bold">Come aggiornare i documenti</h3>
      <p className="text-sm">In <b>Contenuti del sito → Pagine</b>, modifica le pagine <code>privacy-policy</code> e <code>cookie-policy</code>, lasciando invariati gli indirizzi. Mantieni l’avviso di bozza finché i fatti mancanti non sono convalidati. In <b>Privacy e consensi</b> puoi gestire le versioni delle informative. La prova di presa visione delle nuove richieste include l’impronta del testo: una modifica non cambia retroattivamente lo storico.</p>
      <p className="mt-3 text-sm">I dati fiscali qui sopra sono separati dai <b>contatti e indirizzo del negozio</b>. Se li cambi, aggiorna anche il testo dei documenti per mantenerli coerenti.</p>
    </section>
    <section className="card">
      <h2 className="mb-2 text-xl font-bold">Registro scelte cookie</h2>
      <p className="mb-3 text-sm text-slate-600">Ultime 100 scelte, anche di rifiuto o revoca. Identificativo casuale, senza IP, user agent o collegamento all’account. Definire e applicare la conservazione nella checklist.</p>
      {error?<p className="text-sm">Registro non disponibile con i tuoi permessi.</p>:!data?<p>Caricamento…</p>:!data.length?<p className="text-sm">Nessuna scelta registrata.</p>:<div className="overflow-x-auto"><table className="table-dp"><thead><tr><th>Data server</th><th>Scelta</th><th>Statistiche</th><th>Marketing</th><th>Contenuti esterni</th><th>Ricevuta / versione</th></tr></thead><tbody>{data.map(row=><tr key={row.id}><td>{fmtDateTime(row.createdAt)}</td><td>{row.action}</td><td>{row.analytics?"Sì":"No"}</td><td>{row.marketing?"Sì":"No"}</td><td>{row.externalContent?"Sì":"No"}</td><td className="max-w-56 break-all text-xs">{row.receiptId}<br/>{row.version}</td></tr>)}</tbody></table></div>}
    </section>
  </div>;
}
