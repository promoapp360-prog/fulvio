import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, CheckCircle2, Clock3, Dog, ImagePlus, LockKeyhole, UserRound, X } from "lucide-react";
import { DOG_BREEDS, breedSearch } from "@shared/dog-breeds";
import { PageHero } from "@/components/CmsPage";
import { Spinner, ErrorBox, Field } from "@/components/ui";
import { api, get } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { usePublicSettings } from "@/lib/settings";
import { addDaysISO, todayISO, fmtDay, fmtDateTime } from "@/lib/format";
import { euro } from "@shared/constants";
import { useServices, useOperators } from "./Pages";
import BookingCalendar from "@/components/BookingCalendar";

type Slot={time:string;serviceIds:number[];operatorIds:number[]};
type GuestFormState={
  firstName:string;lastName:string;email:string;phone:string;species:"cane"|"gatto";dogName:string;breed:string;breedOther:string;
  coatType:string;coatLength:string;coatConditions:string[];coatNotes:string;weightKg:string;ageYears:string;ageMonths:string;birthDate:string;
  serviceIds:number[];operatorId:string;notes:string;alternativeAvailability:string;privacy:boolean;marketing:boolean;website:string;
};
const initialForm:GuestFormState={
  firstName:"",lastName:"",email:"",phone:"",species:"cane",dogName:"",breed:"",breedOther:"",
  coatType:"",coatLength:"",coatConditions:[],coatNotes:"",weightKg:"",ageYears:"",ageMonths:"",birthDate:"",
  serviceIds:[],operatorId:"",notes:"",alternativeAvailability:"",privacy:false,marketing:false,website:"",
};
const card=(active:boolean)=>`min-h-[68px] w-full rounded-2xl border-2 p-4 text-left transition ${active?"border-brand-turquoise bg-brand-sky":"border-slate-200 bg-white hover:border-brand-blue"}`;
const makeKey=()=>globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2)}`;

async function compressDogPhoto(file:File):Promise<File>{
  if(!["image/jpeg","image/png","image/webp"].includes(file.type)) throw new Error("Scegli una foto JPG, PNG o WebP.");
  const image=await new Promise<HTMLImageElement>((resolve,reject)=>{
    const url=URL.createObjectURL(file);const img=new Image();
    img.onload=()=>{URL.revokeObjectURL(url);resolve(img);};img.onerror=()=>{URL.revokeObjectURL(url);reject(new Error("Non riesco a leggere questa foto."));};img.src=url;
  });
  const scale=Math.min(1,1600/Math.max(image.naturalWidth,image.naturalHeight));
  const canvas=document.createElement("canvas");canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
  const context=canvas.getContext("2d");if(!context)throw new Error("Compressione immagine non disponibile.");
  context.drawImage(image,0,0,canvas.width,canvas.height);
  for(const quality of [0.78,0.66,0.54,0.44]){
    const blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,"image/webp",quality));
    if(blob&&blob.size<=950_000)return new File([blob],"foto-cane.webp",{type:"image/webp",lastModified:Date.now()});
  }
  throw new Error("La foto resta troppo pesante: scegli uno scatto più leggero.");
}

function CheckLine({checked,onChange,children,required=false}:{checked:boolean;onChange:(v:boolean)=>void;children:React.ReactNode;required?:boolean}){
  return <label className="flex min-h-12 cursor-pointer items-start gap-3 py-2 text-sm leading-relaxed">
    <input type="checkbox" required={required} checked={checked} onChange={e=>onChange(e.target.checked)} className="mt-1 h-5 w-5 shrink-0 accent-[#00B6C8]" /><span className="min-w-0">{children}</span>
  </label>;
}

export default function BookingPage(){
  const {data:me,isLoading}=useMe();
  const {data:settings}=usePublicSettings();
  const {data:services}=useServices();
  const {data:operators}=useOperators();
  const [,navigate]=useLocation();
  const [date,setDate]=useState(()=>new URLSearchParams(window.location.search).get("date")||sessionStorage.getItem("dp-booking-date")||"");
  const [time,setTime]=useState(()=>new URLSearchParams(window.location.search).get("time")||sessionStorage.getItem("dp-booking-time")||"");
  const [mode,setMode]=useState<"guest"|"customer"|null>(null);
  const [dogId,setDogId]=useState<number|null>(null);
  const [form,setForm]=useState<GuestFormState>(initialForm);
  const [breedSearchText,setBreedSearchText]=useState("");
  const [breedOpen,setBreedOpen]=useState(false);
  const [photo,setPhoto]=useState<File|null>(null);
  const [preview,setPreview]=useState("");
  const [photoError,setPhotoError]=useState("");
  const [error,setError]=useState<unknown>(null);
  const [success,setSuccess]=useState<{message:string;trackingUrl?:string}|null>(null);
  const [busy,setBusy]=useState(false);
  const [breedText,setBreedText]=useState("");
  const locationSearch=new URLSearchParams(window.location.search);
  const requestId=locationSearch.get("request"),requestToken=locationSearch.get("token");

  useEffect(()=>{if(date)sessionStorage.setItem("dp-booking-date",date);},[date]);
  useEffect(()=>{if(time)sessionStorage.setItem("dp-booking-time",time);},[time]);
  useEffect(()=>()=>{if(preview)URL.revokeObjectURL(preview);},[preview]);

  const availability=useQuery<{date:string;slots:Slot[]}>({
    queryKey:["guest-slots",date],queryFn:()=>get(`/api/public/guest-slots?date=${date}`),enabled:!!date,staleTime:10_000,
  });
  useEffect(()=>{if(availability.data&&time&&!availability.data.slots.some(s=>s.time===time))setTime("");},[availability.data,time]);
  const tracking=useQuery<any>({
    queryKey:["guest-request-status",requestId,requestToken],
    queryFn:()=>get(`/api/public/guest-requests/${requestId}?token=${encodeURIComponent(requestToken||"")}`),
    enabled:!!requestId&&!!requestToken,retry:false,
  });
  const {data:dogs,isLoading:dogsLoading}=useQuery<any[]>({
    queryKey:["my-dogs"],queryFn:()=>get("/api/account/dogs"),enabled:mode==="customer"&&me?.role==="customer",
  });

  const petSpecies=mode==="customer"?(dogs?.find(d=>d.id===dogId)?.species||"cane"):form.species;
  const availableServices=(services||[]).filter(s=>s.bookable&&s.operatorIds.length>0&&(s.species==="entrambi"||s.species===petSpecies));
  const selectedSlot=availability.data?.slots.find(s=>s.time===time);
  const selectedServices=availableServices.filter(s=>form.serviceIds.includes(s.id));
  const compatibleOperators=useMemo(()=>form.serviceIds.length?(operators||[]).filter(o=>form.serviceIds.every(id=>o.serviceIds.includes(id))):[],[operators,form.serviceIds]);
  const maxDate=addDaysISO(todayISO(),Math.min(settings?.booking?.maxDaysAhead??60,90));
  const trackingRequest=!!requestId&&!!requestToken;
  const accountNext=`/richiedi-prenotazione?date=${encodeURIComponent(date)}&time=${encodeURIComponent(time)}`;

  const update=(key:keyof GuestFormState,value:any)=>setForm(old=>({...old,[key]:value}));
  const toggleService=(id:number)=>{
    setForm(old=>{
      const serviceIds=old.serviceIds.includes(id)?old.serviceIds.filter(x=>x!==id):[...old.serviceIds,id];
      return {...old,serviceIds,operatorId:old.operatorId&&operators?.find(o=>String(o.id)===old.operatorId&&serviceIds.every(s=>o.serviceIds.includes(s)))?old.operatorId:""};
    });
  };
  const choosePhoto=async(file?:File)=>{
    setPhotoError("");
    if(!file){setPhoto(null);setPreview("");return;}
    if(file.size>12*1024*1024){setPhotoError("La foto originale deve essere inferiore a 12 MB.");return;}
    try{const compressed=await compressDogPhoto(file);setPhoto(compressed);setPreview(old=>{if(old)URL.revokeObjectURL(old);return URL.createObjectURL(compressed);});}
    catch(e:any){setPhotoError(e.message||"Non riesco a elaborare la foto.");}
  };

  const submit=async(e:React.FormEvent<HTMLFormElement>)=>{
    e.preventDefault();setError(null);
    if(!date||!time||!selectedSlot){setError(new Error("Scegli un orario disponibile prima di continuare."));return;}
    if(!form.privacy){setError(new Error("Prendi visione dell’informativa privacy per proseguire."));return;}
    setBusy(true);
    const requestKey=makeKey();
    const payload=mode==="guest"?{
      ...form,weightKg:Number(form.weightKg),ageYears:form.ageYears||null,ageMonths:form.ageMonths||null,birthDate:form.birthDate||null,
      serviceIds:form.serviceIds,operatorId:form.operatorId?Number(form.operatorId):null,date,time,requestKey,
    }:{
      dogId,serviceIds:form.serviceIds,operatorId:form.operatorId?Number(form.operatorId):null,date,time,
      notes:form.notes,alternativeAvailability:form.alternativeAvailability,privacy:true,marketing:form.marketing,requestKey,
    };
    const body=new FormData();body.append("payload",JSON.stringify(payload));if(photo)body.append("photo",photo,photo.name);
    try{
      const result=await api(mode==="guest"?"/api/public/guest-bookings":"/api/account/appointments",{method:"POST",form:body});
      setSuccess({message:result.message,trackingUrl:result.trackingUrl});
    }catch(err:any){
      setError(err);
      if(err.status===409&&/(orario|slot|disponibil|occupat)/i.test(String(err.message||""))){
        await availability.refetch();
        setTime("");
      }
    }finally{setBusy(false);}
  };

  if(isLoading)return <Spinner />;
  if(requestId&&requestToken)return <><PageHero title="La tua richiesta" subtitle="Stato della richiesta di prenotazione" mascot="toelettatura"/><div className="container-dp py-8"><div className="card mx-auto max-w-xl">{tracking.isLoading?<Spinner/>:tracking.error?<p role="alert">Link non valido o non più disponibile.</p>:<><CheckCircle2 className="text-green-600" size={42}/><h2 className="mt-3 text-xl font-extrabold">{tracking.data?.status==="richiesta"?"In attesa di approvazione":`Stato: ${tracking.data?.status}`}</h2><p className="mt-2">Data richiesta: {fmtDateTime(tracking.data?.startAt)}</p>{tracking.data?.proposedStartAt&&<p>Orario proposto: {fmtDateTime(tracking.data.proposedStartAt)}</p>}</>}<Link href="/" className="btn-outline mt-5">Torna al sito</Link></div></div></>;
  if(success)return <><PageHero title="Richiesta inviata" subtitle="La richiesta non è ancora una prenotazione confermata." mascot="toelettatura"/><div className="container-dp py-8"><div className="card mx-auto max-w-xl text-center"><CheckCircle2 className="mx-auto text-green-600" size={48}/><h2 className="mt-3 text-2xl font-extrabold">Richiesta ricevuta</h2><p className="mt-2 text-slate-600">{success.message}</p>{success.trackingUrl&&<a href={success.trackingUrl} className="btn-outline mt-4 inline-flex">Segui la richiesta</a>}<p className="mt-4 text-xs text-slate-500">L’appuntamento sarà confermato solo dopo la risposta di Dog’s Planet.</p><Link href="/" className="btn-primary mt-5">Torna al sito</Link></div></div></>;
  if(me&&me.role!=="customer")return <><PageHero title="Richiedi la prenotazione online" subtitle="Sei collegato come personale." mascot="toelettatura"/><div className="container-dp py-8"><p>Per inserire appuntamenti usa il <Link className="font-bold underline" href="/admin/agenda">gestionale</Link>.</p></div></>;

  return <><PageHero title="Richiedi la prenotazione online" subtitle="Scegli un giorno e un orario, poi invia la richiesta. L’appuntamento sarà valido solo dopo l’approvazione del salone." mascot="toelettatura"/>
    <div className="container-dp py-6 sm:py-9">
      <div className="mx-auto max-w-3xl space-y-5">
        <section className="card min-w-0" aria-labelledby="booking-date-heading">
          <h2 id="booking-date-heading" className="mb-4 flex items-center gap-3 text-lg font-bold"><span className={`grid h-8 w-8 place-items-center rounded-full text-sm text-white ${time?"bg-green-600":"bg-brand-navy"}`}>{time?"✓":"1"}</span><CalendarDays size={19} className="text-brand-turquoise"/>Scegli il giorno</h2>
          <BookingCalendar value={date} min={todayISO()} max={maxDate}
            onChange={day=>{setDate(day);setTime("");setMode(null);setError(null);}} />
          {date&&<div className="mt-5">
            <h3 className="mb-3 flex items-center gap-2 font-bold"><Clock3 size={18} className="text-brand-turquoise"/>Scegli un orario libero</h3>
            {availability.isLoading?<Spinner label="Controllo i turni e le disponibilità…"/>:
              availability.error?<ErrorBox error={availability.error}/>:
              !availability.data?.slots.length?<p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">Non ci sono orari prenotabili in questa data. Scegli un altro giorno.</p>:
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">{availability.data.slots.map(slot=><button type="button" key={slot.time} aria-pressed={time===slot.time} data-testid={`booking-time-${slot.time}`} onClick={()=>{setTime(slot.time);setMode(null);setError(null);}} className={`min-h-12 rounded-xl border-2 text-base font-bold ${time===slot.time?"border-brand-turquoise bg-brand-turquoise text-white":"border-slate-200 hover:border-brand-blue"}`}>{slot.time}</button>)}</div>}
            <p className="mt-3 text-xs text-slate-500">Gli orari sono aggiornati sui turni, sui servizi attivi e sugli appuntamenti già presenti. Confermeremo la compatibilità finale dopo aver raccolto i dettagli.</p>
          </div>}
        </section>

        {time&&selectedSlot&&<section className="card min-w-0" aria-labelledby="booking-path-heading">
          <h2 id="booking-path-heading" className="mb-2 flex items-center gap-3 text-lg font-bold"><span className="grid h-8 w-8 place-items-center rounded-full bg-brand-navy text-sm text-white">2</span><UserRound size={19} className="text-brand-turquoise"/>Come vuoi proseguire?</h2>
          <p className="mb-4 text-sm text-slate-600">{fmtDay(date)} alle {time} · scegli se usare il tuo account o continuare senza registrarti.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <button type="button" data-testid="booking-account-path" className={card(mode==="customer")} onClick={()=>{
              if(me?.role==="customer"){setMode("customer");setError(null);}
              else {setMode("customer");sessionStorage.setItem("dp-booking-date",date);sessionStorage.setItem("dp-booking-time",time);}
            }}>
              <span className="font-bold text-brand-navy">Accedi / Registrati</span><span className="mt-1 block text-sm font-normal text-slate-600">Per clienti abituali, con le schede cane e lo storico.</span>
            </button>
            <button type="button" data-testid="booking-guest-path" className={card(mode==="guest")} onClick={()=>{setMode("guest");setError(null);}}>
              <span className="font-bold text-brand-navy">Continua come ospite</span><span className="mt-1 block text-sm font-normal text-slate-600">Invia la richiesta senza creare un account.</span>
            </button>
          </div>
          {!me&&<div className="mt-3 rounded-xl bg-slate-50 p-3 text-sm"><Link href={`/login?next=${encodeURIComponent(accountNext)}`} className="font-bold text-brand-blue underline">Accedi</Link><span className="mx-2">·</span><Link href={`/registrazione?next=${encodeURIComponent(accountNext)}`} className="font-bold text-brand-blue underline">Registrati</Link><p className="mt-1 text-xs text-slate-500">Dopo l’accesso riprenderai dal giorno e dall’ora scelti.</p></div>}
        </section>}

        {mode==="customer"&&me?.role==="customer"&&<section className="card min-w-0">
          <h2 className="mb-4 flex items-center gap-3 text-lg font-bold"><span className="grid h-8 w-8 place-items-center rounded-full bg-brand-navy text-sm text-white">3</span><Dog size={19} className="text-brand-turquoise"/>Il tuo animale e i servizi</h2>
          {dogsLoading?<Spinner/>:!dogs?.length?<div className="rounded-xl bg-brand-sky p-4 text-sm">Non hai ancora una scheda cane. <Link href={`/account/cani?nuovo=1&next=${encodeURIComponent(accountNext)}`} className="font-bold underline">Aggiungila al tuo account</Link> oppure <button type="button" className="font-bold underline" onClick={()=>setMode("guest")}>continua come ospite</button>.</div>:
          <form onSubmit={submit} className="space-y-5">
            <Field label="Cane già registrato">
              <select data-testid="booking-dog" className="input min-h-12 w-full" required value={dogId||""} onChange={e=>{setDogId(Number(e.target.value)||null);update("serviceIds",[]);update("operatorId","");}}>
              <option value="">Scegli l’animale</option>{dogs.map(d=><option key={d.id} value={d.id}>{d.name} · {d.species==="gatto"?"Gatto":"Cane"} · {d.breed||"razza non indicata"} · {d.size}</option>)}
              </select>
            </Field>
            <ServiceOptions services={availableServices} selected={form.serviceIds} onToggle={toggleService}/>
            <OperatorOptions operators={compatibleOperators} selected={form.operatorId} onChange={v=>update("operatorId",v)} allowAny={settings?.booking?.allowAnyOperator!==false}/>
            <Field label="Alternative di giorni o fasce orarie (facoltativo)"><input className="input min-h-12" maxLength={500} value={form.alternativeAvailability} onChange={e=>update("alternativeAvailability",e.target.value)}/></Field>
            <PhotoField photo={photo} preview={preview} error={photoError} onSelect={choosePhoto}/>
            <NotesField value={form.notes} onChange={v=>update("notes",v)}/>
            <PrivacyFields privacy={form.privacy} marketing={form.marketing} setPrivacy={v=>update("privacy",v)} setMarketing={v=>update("marketing",v)}/>
            <p className="rounded-xl bg-brand-sky p-3 text-sm text-brand-navy">La durata è ricalcolata in base alla scheda cane e ai servizi selezionati. Se l’orario non è compatibile, potrai sceglierne un altro senza perdere i dati.</p>
            <ErrorBox error={error}/><button data-testid="booking-submit-account" disabled={busy||!dogId||!form.serviceIds.length||!selectedSlot} className="btn-primary min-h-12 w-full sm:w-auto">{busy?"Invio…":"Invia la richiesta"}</button>
          </form>}
        </section>}

        {mode==="guest"&&<section className="card min-w-0">
          <h2 className="mb-2 flex items-center gap-3 text-lg font-bold"><span className="grid h-8 w-8 place-items-center rounded-full bg-brand-navy text-sm text-white">3</span><Dog size={19} className="text-brand-turquoise"/>Richiesta ospite</h2>
          <p className="mb-5 text-sm text-slate-600">Bastano i dati necessari alla richiesta e le informazioni utili per valutare il servizio. Nessun account viene creato.</p>
          <form onSubmit={submit} className="space-y-5">
            <fieldset className="rounded-2xl border border-slate-200 p-4">
              <legend className="px-1 font-bold text-brand-navy">1. I tuoi recapiti</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Nome *"><input autoComplete="given-name" data-testid="guest-first-name" required maxLength={100} className="input min-h-12" value={form.firstName} onChange={e=>update("firstName",e.target.value)}/></Field>
                <Field label="Cognome *"><input autoComplete="family-name" data-testid="guest-last-name" required maxLength={100} className="input min-h-12" value={form.lastName} onChange={e=>update("lastName",e.target.value)}/></Field>
                <Field label="Email *"><input type="email" autoComplete="email" data-testid="guest-email" required maxLength={255} className="input min-h-12" value={form.email} onChange={e=>update("email",e.target.value)}/></Field>
                <Field label="Telefono *"><input type="tel" autoComplete="tel" data-testid="guest-phone" required minLength={8} maxLength={40} className="input min-h-12" value={form.phone} onChange={e=>update("phone",e.target.value)}/></Field>
              </div>
            </fieldset>
            <fieldset className="rounded-2xl border border-slate-200 p-4">
              <legend className="px-1 font-bold text-brand-navy">2. Il nostro ospite</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Specie *"><select required className="input min-h-12" value={form.species} onChange={e=>{update("species",e.target.value);update("breed","");update("breedOther","");update("serviceIds",[]);update("operatorId","");}}><option value="cane">Cane</option><option value="gatto">Gatto</option></select></Field>
                <Field label={`Nome del ${form.species==="gatto"?"gatto":"cane"} *`}><input required maxLength={80} data-testid="guest-dog-name" className="input min-h-12" value={form.dogName} onChange={e=>update("dogName",e.target.value)}/></Field>
                {form.species==="gatto"?<Field label="Razza del gatto (facoltativa)"><input maxLength={120} className="input min-h-12" value={form.breed} onChange={e=>update("breed",e.target.value)}/></Field>:<Field label="Razza *" hint="Cerca e seleziona una razza; per le altre scegli “Altra razza”.">
                  <div className="relative">
                    <input role="combobox" aria-expanded={breedOpen} aria-controls="dog-breed-options" aria-autocomplete="list" data-testid="guest-breed" required maxLength={120} className="input min-h-12 w-full" placeholder="Cerca una razza…" value={breedOpen?breedText:(form.breed||"")} onFocus={()=>{setBreedText(form.breed);setBreedOpen(true);}} onChange={e=>{setBreedText(e.target.value);setBreedOpen(true);}} onBlur={()=>setTimeout(()=>setBreedOpen(false),150)} />
                    {breedOpen&&<div id="dog-breed-options" role="listbox" className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-xl">
                      {DOG_BREEDS.filter(x=>!breedText||breedSearch(x).includes(breedSearch(breedText))).slice(0,30).map(name=><button type="button" role="option" aria-selected={form.breed===name} key={name} onMouseDown={e=>e.preventDefault()} onClick={()=>{update("breed",name);setBreedText(name);setBreedOpen(false);}} className="min-h-11 w-full rounded-lg px-3 text-left text-sm hover:bg-brand-sky">{name}</button>)}
                      {breedText&&DOG_BREEDS.filter(x=>breedSearch(x).includes(breedSearch(breedText))).length===0&&<p className="p-3 text-sm text-slate-500">Nessuna corrispondenza: seleziona “Altra razza”.</p>}
                    </div>}
                  </div>
                  {form.breed==="Altra razza"&&<input required minLength={2} maxLength={120} aria-label="Specifica la razza" placeholder="Scrivi la razza" className="input mt-2 min-h-12" value={form.breedOther} onChange={e=>update("breedOther",e.target.value)}/>}
                </Field>}
                <Field label="Tipo di pelo *"><select required data-testid="guest-coat-type" className="input min-h-12" value={form.coatType} onChange={e=>update("coatType",e.target.value)}><option value="">Seleziona…</option>{["Liscio","Mosso","Riccio","Altro"].map(x=><option key={x}>{x}</option>)}</select></Field>
                <Field label="Lunghezza del pelo *"><select required data-testid="guest-coat-length" className="input min-h-12" value={form.coatLength} onChange={e=>update("coatLength",e.target.value)}><option value="">Seleziona…</option>{["Corto","Medio","Lungo"].map(x=><option key={x}>{x}</option>)}</select></Field>
                <Field label="Peso approssimativo (kg) *" hint="Indica il peso circa, anche se non preciso."><input type="number" inputMode="decimal" data-testid="guest-weight" required min="0.2" max="150" step="0.1" className="input min-h-12" value={form.weightKg} onChange={e=>update("weightKg",e.target.value)}/></Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Età (anni)"><input type="number" inputMode="numeric" min="0" max="30" className="input min-h-12" value={form.ageYears} onChange={e=>update("ageYears",e.target.value)}/></Field>
                  <Field label="Mesi (0–11)"><input type="number" inputMode="numeric" min="0" max="11" className="input min-h-12" value={form.ageMonths} onChange={e=>update("ageMonths",e.target.value)}/></Field>
                </div>
                <Field label="Data di nascita, se conosciuta"><input type="date" className="input min-h-12" max={todayISO()} value={form.birthDate} onChange={e=>update("birthDate",e.target.value)}/></Field>
              </div>
              <div className="mt-4">
                <p className="mb-1 text-sm font-semibold text-slate-700">Stato del manto * <span className="font-normal text-slate-500">Puoi selezionare più voci.</span></p>
                <div className="grid gap-1 sm:grid-cols-2">{["Ben pettinato","Annodato","In muta/perde pelo","Altro"].map(value=><CheckLine key={value} checked={form.coatConditions.includes(value)} onChange={checked=>update("coatConditions",checked?[...form.coatConditions,value]:form.coatConditions.filter(x=>x!==value))}>{value}</CheckLine>)}</div>
                {form.coatConditions.includes("Altro")&&<Field label="Descrivi lo stato del manto"><input maxLength={1000} className="input min-h-12" value={form.coatNotes} onChange={e=>update("coatNotes",e.target.value)}/></Field>}
              </div>
              <PhotoField photo={photo} preview={preview} error={photoError} onSelect={choosePhoto}/>
            </fieldset>
            <fieldset className="rounded-2xl border border-slate-200 p-4">
              <legend className="px-1 font-bold text-brand-navy">3. Servizio e preferenze</legend>
              <ServiceOptions services={availableServices} selected={form.serviceIds} onToggle={toggleService}/>
              <OperatorOptions operators={compatibleOperators} selected={form.operatorId} onChange={v=>update("operatorId",v)} allowAny={settings?.booking?.allowAnyOperator!==false}/>
              <Field label="Altri giorni o fasce orarie possibili (facoltativo)" hint="Se il primo orario non è compatibile, Fulvio può considerare queste alternative."><input maxLength={500} className="input min-h-12" value={form.alternativeAvailability} onChange={e=>update("alternativeAvailability",e.target.value)} placeholder="Es. lunedì mattina o giovedì dopo le 15"/></Field>
              <NotesField value={form.notes} onChange={v=>update("notes",v)}/>
              <label className="sr-only">Lascia vuoto</label><input tabIndex={-1} autoComplete="off" aria-hidden="true" value={form.website} onChange={e=>update("website",e.target.value)} className="absolute -left-[10000px] h-px w-px"/>
            </fieldset>
            <PrivacyFields privacy={form.privacy} marketing={form.marketing} setPrivacy={v=>update("privacy",v)} setMarketing={v=>update("marketing",v)}/>
            <div className="rounded-xl bg-brand-sky p-4 text-sm text-brand-navy">
              <b>La scelta dell’orario è provvisoria.</b> Verifichiamo nuovamente durata, servizi e disponibilità prima dell’invio. Se qualcosa non è più compatibile, conserveremo i dati per permetterti di scegliere un altro orario.
            </div>
            <ErrorBox error={error}/>
            <button data-testid="booking-submit-guest" disabled={busy||!form.serviceIds.length||!form.coatConditions.length||!selectedSlot} className="btn-primary min-h-12 w-full">{busy?"Invio della richiesta…":"Invia la richiesta di prenotazione"}</button>
            <p className="text-center text-xs text-slate-500">Invii una richiesta, non una prenotazione confermata.</p>
          </form>
        </section>}
        {!time&&date&&availability.data?.slots.length===0&&<div className="flex justify-end"><button className="btn-outline" onClick={()=>{setDate("");setTime("");}}>Scegli un’altra data</button></div>}
        <p className="flex items-start gap-2 rounded-xl bg-slate-50 p-3 text-xs text-slate-500"><LockKeyhole size={16} className="mt-0.5 shrink-0"/>I dati sono usati per gestire e rispondere alla richiesta. Non viene creato un account ospite.</p>
      </div>
    </div>
  </>;
}

function ServiceOptions({services,selected,onToggle}:{services:any[];selected:number[];onToggle:(id:number)=>void}){
  const priceLabel=(s:any)=>{
    if(s.pricingType==="fascia"&&s.priceCents!=null&&s.priceMaxCents!=null)return `${euro(s.priceCents)}–${euro(s.priceMaxCents)}`;
    if(s.pricingType==="orario")return "tariffa oraria";
    if(s.pricingType==="percentuale")return "supplemento percentuale";
    if(s.pricingType==="preventivo")return "da valutare";
    if(s.priceCents!=null)return `${s.pricingType==="da"?"da ":""}${euro(s.priceCents)}`;
    return "prezzo da definire";
  };
  return <fieldset className="mb-4">
    <legend className="mb-2 font-semibold text-slate-700">Servizi richiesti * <span className="font-normal text-slate-500">Seleziona uno o più servizi attivi.</span></legend>
    {!services.length?<p className="rounded-xl bg-amber-50 p-3 text-sm">Nessun servizio risulta prenotabile online al momento.</p>:
      <div className="grid gap-2 sm:grid-cols-2">{services.map(s=><CheckLine key={s.id} checked={selected.includes(s.id)} onChange={()=>onToggle(s.id)}><span className="font-semibold">{s.name}</span><span className="block text-xs text-slate-500">{s.category} · circa {s.durationMin} min · {priceLabel(s)}</span></CheckLine>)}</div>}
  </fieldset>;
}
function OperatorOptions({operators,selected,onChange,allowAny}:{operators:any[];selected:string;onChange:(v:string)=>void;allowAny:boolean}){
  return <Field label="Operatore preferito (facoltativo)">
    <select required={!allowAny} className="input min-h-12 w-full" value={selected} onChange={e=>onChange(e.target.value)}><option value="">{allowAny?"Nessuna preferenza":"Seleziona un operatore"}</option>{operators.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select>
    {!operators.length&&<p className="mt-1 text-xs text-amber-700">Gli operatori saranno verificati dopo la selezione dei servizi.</p>}
    {!allowAny&&operators.length===0&&<p className="text-xs text-amber-700">Seleziona servizi compatibili con almeno un operatore abilitato.</p>}
  </Field>;
}
function NotesField({value,onChange}:{value:string;onChange:(v:string)=>void}){
  return <Field label="Note per il salone (facoltative)"><textarea maxLength={1000} className="input min-h-24 w-full" value={value} onChange={e=>onChange(e.target.value)} placeholder="Indicazioni utili per la richiesta…"/></Field>;
}
function PhotoField({photo,preview,error,onSelect}:{photo:File|null;preview:string;error:string;onSelect:(file?:File)=>void}){
  return <div className="mt-4 rounded-xl border border-dashed border-slate-300 p-3">
    <label className="flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-xl bg-slate-50 px-3 text-sm font-semibold text-brand-navy"><ImagePlus size={18}/>{photo?"Sostituisci la foto":"Aggiungi una foto recente (facoltativa)"}<input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" data-testid="dog-photo" className="sr-only" onChange={e=>onSelect(e.target.files?.[0])}/></label>
    <p className="mt-2 text-xs text-slate-500">Puoi scattarla o sceglierla dalla galleria. Viene compressa e conservata privata nella scheda cane; massimo 1 MB dopo la compressione.</p>
    {preview&&<div className="relative mt-3 flex items-start gap-3"><img src={preview} alt="Anteprima della foto del cane" className="h-24 w-24 rounded-xl object-cover"/><div><p className="text-sm font-semibold">Foto pronta · {(photo!.size/1024).toFixed(0)} KB</p><button type="button" onClick={()=>onSelect()} className="mt-2 inline-flex min-h-11 items-center gap-1 text-sm text-red-700"><X size={15}/> Rimuovi</button></div></div>}
    {error&&<p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
  </div>;
}
function PrivacyFields({privacy,marketing,setPrivacy,setMarketing}:{privacy:boolean;marketing:boolean;setPrivacy:(v:boolean)=>void;setMarketing:(v:boolean)=>void}){
  return <fieldset className="rounded-2xl border border-slate-200 p-4">
    <legend className="px-1 font-bold text-brand-navy">Informativa e preferenze</legend>
    <CheckLine required checked={privacy} onChange={setPrivacy}>Dichiaro di aver preso visione dell'<Link href="/privacy-policy" target="_blank" className="font-bold text-brand-blue underline">informativa privacy</Link></CheckLine>
    <p className="mb-2 pl-8 text-xs text-slate-600">La richiesta è trattata per le misure precontrattuali e il servizio richiesto; la casella documenta la presa visione, non un consenso obbligatorio al trattamento.</p>
    <CheckLine checked={marketing} onChange={setMarketing}>Acconsento facoltativamente a ricevere comunicazioni promozionali. La scelta è separata e non è necessaria per inviare la richiesta.</CheckLine>
  </fieldset>;
}
