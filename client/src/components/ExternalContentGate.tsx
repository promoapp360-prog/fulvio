import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { get } from "@/lib/api";
import { readCookieChoice, type CookieConfig } from "@/lib/cookies";

/** Nessun iframe o media di terzi viene montato prima della scelta valida. */
export default function ExternalContentGate({children}:{children:React.ReactNode}){
  const {data:config}=useQuery<CookieConfig>({queryKey:["cookie-config"],queryFn:()=>get("/api/public/cookie-config"),staleTime:60_000});
  const [choice,setChoice]=useState(readCookieChoice);
  useEffect(()=>{
    const refresh=()=>setChoice(readCookieChoice()),clear=()=>setChoice(null);
    window.addEventListener("dp:cookie-consent",refresh);window.addEventListener("storage",refresh);window.addEventListener("dp:cookie-invalid",clear);
    return()=>{window.removeEventListener("dp:cookie-consent",refresh);window.removeEventListener("storage",refresh);window.removeEventListener("dp:cookie-invalid",clear);};
  },[]);
  if(choice?.externalContent&&choice.version===config?.version)return <>{children}</>;
  return <div className="flex min-h-40 flex-col items-center justify-center gap-3 rounded-2xl border bg-slate-50 p-5 text-center text-sm">
    <p>Contenuto esterno bloccato. Per caricarlo puoi autorizzare mappe e video nelle preferenze cookie; il fornitore riceverà dati tecnici come l’indirizzo IP.</p>
    <button type="button" className="btn-outline min-h-11" onClick={()=>window.dispatchEvent(new Event("dp-cookie-open"))}>Gestisci preferenze cookie</button>
  </div>;
}
