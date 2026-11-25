import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { Link } from "wouter";
import { usePublicSettings } from "@/lib/settings";
import { get, post } from "@/lib/api";
import { COOKIE_KEY, readCookieChoice, removeOptionalCookies, type CookieConfig, type CookieConsent } from "@/lib/cookies";
import { ErrorBox } from "./ui";

/** Solo ID configurati, audit confermato e categorie autorizzate; mai GTM con consenso parziale. */
function loadTrackers(c:CookieConsent,config:CookieConfig,seo:any){
  if(!seo||!config.reviewed||c.version!==config.version)return;
  const w=window as any;
  const add=(src:string)=>{if(document.querySelector(`script[src="${src}"]`))return;const node=document.createElement("script");node.async=true;node.src=src;node.dataset.dpOptional="true";document.head.appendChild(node);w.__dpOptionalLoaded=true;};
  if(c.analytics&&config.analytics&&/^G-[A-Z0-9]+$/i.test(seo.gaMeasurementId||"")&&!w.__dpGaLoaded){
    w.dataLayer=w.dataLayer||[];w.gtag=function(){w.dataLayer.push(arguments);};
    w.gtag("consent","default",{analytics_storage:"denied",ad_storage:"denied",ad_user_data:"denied",ad_personalization:"denied"});
    w.gtag("consent","update",{analytics_storage:"granted"});
    add(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(seo.gaMeasurementId)}`);
    w.gtag("js",new Date());w.gtag("config",seo.gaMeasurementId,{allow_google_signals:false,allow_ad_personalization_signals:false});w.__dpGaLoaded=true;
  }
  if(c.analytics&&c.marketing&&config.providers.gtm&&/^GTM-[A-Z0-9]+$/i.test(seo.gtmId||"")&&!w.__dpGtmLoaded){
    w.dataLayer=w.dataLayer||[];w.dataLayer.push({"gtm.start":Date.now(),event:"gtm.js"});
    add(`https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(seo.gtmId)}`);w.__dpGtmLoaded=true;
  }
  if(c.marketing&&config.marketing&&/^\d+$/.test(seo.metaPixelId||"")&&!w.fbq){
    const n:any=w.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments);};
    n.queue=[];n.loaded=true;n.version="2.0";w._fbq=n;
    add("https://connect.facebook.net/en_US/fbevents.js");w.fbq("init",seo.metaPixelId);w.fbq("track","PageView");
  }
}
export default function CookieBanner(){
  const {data:settings}=usePublicSettings();
  const {data:config,refetch}=useQuery<CookieConfig>({queryKey:["cookie-config"],queryFn:()=>get("/api/public/cookie-config"),staleTime:60_000});
  const [consent,setConsent]=useState<CookieConsent|null>(readCookieChoice);
  const [open,setOpen]=useState(!readCookieChoice()),[customize,setCustomize]=useState(false);
  useEffect(() => { window.dispatchEvent(new Event("dp:cookie-visibility")); }, [open]);
  const [prefs,setPrefs]=useState({analytics:false,marketing:false,externalContent:false});
  const [busy,setBusy]=useState(false),[error,setError]=useState<unknown>(null);
  useEffect(()=>{
    const show=()=>{const current=readCookieChoice();setPrefs({analytics:current?.analytics||false,marketing:current?.marketing||false,externalContent:current?.externalContent||false});setOpen(true);setError(null);void refetch();};
    window.addEventListener("dp-cookie-open",show);return()=>window.removeEventListener("dp-cookie-open",show);
  },[refetch]);
  useEffect(()=>{
    const sync=(event:StorageEvent)=>{
      if(event.key!==COOKIE_KEY)return;
      const next=readCookieChoice();
      if((window as any).__dpOptionalLoaded&&(!next||!next.analytics||!next.marketing)){removeOptionalCookies();window.location.reload();return;}
      setConsent(next);if(!next)setOpen(true);
    };
    window.addEventListener("storage",sync);return()=>window.removeEventListener("storage",sync);
  },[]);
  useEffect(()=>{
    if(!config)return;
    if(consent?.version!==config.version){
      setOpen(true);
      window.dispatchEvent(new Event("dp:cookie-invalid"));
      if((window as any).__dpOptionalLoaded){removeOptionalCookies();window.location.reload();}
      return;
    }
    loadTrackers(consent,config,settings?.seo);
  },[consent,config,settings]);
  const save=async(action:"accept"|"reject"|"customize")=>{
    if(!config||busy)return;setBusy(true);setError(null);
    const choices=action==="reject"?{analytics:false,marketing:false,externalContent:false}:action==="accept"?{analytics:config.analytics,marketing:config.marketing,externalContent:true}:prefs;
    try{
      const previous=consent;
      const result=await post("/api/public/cookie-choices",{...choices,action,version:config.version,receiptId:consent?.receiptId||crypto.randomUUID()}) as CookieConsent;
      localStorage.setItem(COOKIE_KEY,JSON.stringify(result));
      setConsent(result);setOpen(false);setCustomize(false);
      window.dispatchEvent(new Event("dp:cookie-consent"));
      const revoked=previous&&((previous.analytics&&!result.analytics)||(previous.marketing&&!result.marketing));
      if(revoked){removeOptionalCookies();if((window as any).__dpOptionalLoaded){(window as any).gtag?.("consent","update",{analytics_storage:"denied",ad_storage:"denied",ad_user_data:"denied",ad_personalization:"denied"});(window as any).fbq?.("consent","revoke");window.location.reload();}}
    }catch(e){setError(e);void refetch();}finally{setBusy(false);}
  };
  if(!open)return null;
  return <section data-cookie-banner className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-[60] p-3 md:bottom-0 sm:p-4" role="dialog" aria-modal="false" aria-labelledby="cookie-title">
    <div className="relative mx-auto max-h-[calc(100dvh-6rem)] max-w-3xl overflow-y-auto rounded-2xl border border-sky-100 bg-white p-4 shadow-2xl sm:p-5">
      <button type="button" disabled={busy||!config} aria-label="Chiudi mantenendo solo i tecnici" className="absolute right-1 top-1 grid h-11 w-11 place-items-center rounded-xl hover:bg-slate-100" onClick={()=>save("reject")}><X size={18}/></button>
      <h2 id="cookie-title" className="pr-9 text-base font-bold">La tua scelta sulla privacy</h2>
      <p className="mt-2 text-xs leading-relaxed text-slate-700 sm:text-sm">Le funzioni tecniche sono necessarie. Statistiche e marketing, se configurati e verificati, restano spenti senza la tua scelta. Puoi autorizzare separatamente mappe e video esterni. <Link href="/cookie-policy" className="font-bold text-brand-blue underline">Cookie Policy</Link></p>
      {config&&!config.analytics&&!config.marketing&&<p className="mt-2 text-xs text-slate-600">Nessun tag statistico o pubblicitario è attualmente abilitato dall’app.</p>}
      {customize&&<div className="mt-3 space-y-1 border-y py-2 text-sm">
        <p className="py-2 text-slate-600">Tecnici · sempre necessari, nessun consenso richiesto</p>
        {([{key:"analytics",label:"Statistiche",available:config?.analytics},{key:"marketing",label:"Marketing e pubblicità",available:config?.marketing},{key:"externalContent",label:"Contenuti esterni (mappe e video)",available:true}] as const).map(x=><label key={x.key} className="flex min-h-11 items-center gap-3"><input className="h-5 w-5 shrink-0" type="checkbox" disabled={!x.available} checked={!!x.available&&prefs[x.key]} onChange={e=>setPrefs({...prefs,[x.key]:e.target.checked})}/><span>{x.label}{!x.available&&<span className="block text-xs text-slate-500">Non attivo / non autorizzato dall’amministratore</span>}</span></label>)}
      </div>}
      <ErrorBox error={error}/>
      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <button disabled={busy||!config} className="btn-outline min-h-11" onClick={()=>save("reject")}>Rifiuta</button>
        <button disabled={busy||!config} className="btn-outline min-h-11" onClick={()=>customize?save("customize"):setCustomize(true)}>{customize?"Salva preferenze":"Personalizza"}</button>
        <button disabled={busy||!config} className="btn-outline min-h-11" onClick={()=>save("accept")}>Accetta tutti</button>
      </div>
      <p className="mt-2 text-xs text-slate-500">Puoi cambiare o revocare la scelta dal footer. Nessun consenso deriva dallo scorrimento.</p>
    </div>
  </section>;
}
