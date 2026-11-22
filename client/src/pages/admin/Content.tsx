import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Upload, Copy, Trash2, Send, Eye, RotateCcw, Users } from "lucide-react";
import { PageTitle, Spinner, Empty, Field, Check, Tabs, Modal, ErrorBox, Pager, useToast } from "@/components/ui";
import ResourceManager from "@/components/ResourceManager";
import LegalChecklist from "@/components/LegalChecklist";
import { api, get, put, del, post } from "@/lib/api";
import { fmtDateTime, fmtDay } from "@/lib/format";
import { SIZES, SIZE_LABELS } from "@shared/constants";

export function UploadButton({ label = "Carica immagine", onUploaded }: { label?: string; onUploaded?: (url: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const pick = async (file: File) => {
    setBusy(true);
    try {
      const fd = new FormData(); fd.append("file", file); fd.append("alt", file.name);
      const m = await api("/api/admin/media", { form: fd });
      if (onUploaded) { onUploaded(m.url); toast("Immagine caricata"); }
      else { try { await navigator.clipboard.writeText(m.url); toast(`Caricata: indirizzo copiato (${m.url})`); } catch { toast(`Caricata: ${m.url}`); } }
      qc.invalidateQueries({ queryKey: ["media"] });
    } catch (e: any) { toast(e.message, "err"); } finally { setBusy(false); if (ref.current) ref.current.value = ""; }
  };
  return (
    <>
      <input ref={ref} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden" onChange={(e) => e.target.files?.[0] && pick(e.target.files[0])} />
      <button type="button" className="btn-outline btn-sm" disabled={busy} onClick={() => ref.current?.click()}><Upload size={14} /> {busy ? "Caricamento…" : label}</button>
    </>
  );
}

function MediaLibrary() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isLoading } = useQuery<any[]>({ queryKey: ["media"], queryFn: () => get("/api/admin/media") });
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3"><UploadButton /><p className="text-xs text-slate-500">Le immagini vengono ridimensionate (max 1600 px) e convertite in WebP. Per i video usa un link YouTube/Vimeo nelle pagine.</p></div>
      {isLoading ? <Spinner /> : !data?.length ? <Empty>Nessun file caricato.</Empty> : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">{data.map((m) => (
          <div key={m.id} className="overflow-hidden rounded-xl border bg-white">
            {m.mime.startsWith("image/") ? <img src={m.url} alt={m.alt || ""} loading="lazy" className="aspect-square w-full object-cover" /> : <div className="grid aspect-square place-items-center text-sm font-bold">PDF</div>}
            <div className="flex justify-between p-1">
              <button className="btn-ghost btn-sm" title="Copia indirizzo" onClick={() => { navigator.clipboard?.writeText(m.url); toast("Indirizzo copiato"); }}><Copy size={14} /></button>
              <button className="btn-ghost btn-sm text-red-600" title="Elimina" onClick={async () => { if (confirm("Eliminare il file?")) { await del(`/api/admin/media/${m.id}`); qc.invalidateQueries({ queryKey: ["media"] }); } }}><Trash2 size={14} /></button>
            </div>
          </div>
        ))}</div>
      )}
    </div>
  );
}

type SField = { key: string; label: string; type?: "text" | "textarea" | "checkbox" | "number" | "list" | "image" | "select"; hint?: string; options?: { value: string | number; label: string }[] };

/** Form generico per una sezione di impostazioni salvata nel database. */
export function SettingsForm({ section, fields, title, intro }: { section: string; title: string; fields: SField[]; intro?: React.ReactNode }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isLoading } = useQuery<any>({ queryKey: ["admin-settings"], queryFn: () => get("/api/admin/settings").catch(() => null) });
  const [f, setF] = useState<any>(null);
  const [err, setErr] = useState<unknown>(null);
  const cur = f ?? data?.[section];
  if (isLoading) return <Spinner />;
  if (!cur) return <Empty>Impostazioni non disponibili con i tuoi permessi.</Empty>;
  const save = async () => {
    setErr(null);
    try {
      const body: any = {};
      for (const x of fields) {
        const v = cur[x.key];
        body[x.key] = x.type === "number" ? (v === "" || v == null ? null : Number(v))
          : x.type === "select" && typeof x.options?.[0]?.value === "number" ? Number(v)
          : x.type === "list" ? (Array.isArray(v) ? v : String(v || "").split(",").map((s) => s.trim()).filter(Boolean)) : v;
      }
      await put(`/api/admin/settings/${section}`, body); toast("Impostazioni salvate"); setF(null);
      qc.invalidateQueries({ queryKey: ["admin-settings"] }); qc.invalidateQueries({ queryKey: ["public-settings"] });
    } catch (e) { setErr(e); }
  };
  return (
    <div className="card space-y-3">
      <h2 className="text-lg font-bold">{title}</h2>
      {intro && <div className="text-sm text-slate-600">{intro}</div>}
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((x) => x.type === "checkbox" ? <div key={x.key} className="pt-5"><Check checked={!!cur[x.key]} onChange={(v) => setF({ ...cur, [x.key]: v })} label={x.label} /></div> : (
          <Field key={x.key} label={x.label} hint={x.hint} className={x.type === "textarea" ? "sm:col-span-2" : ""}>
            {x.type === "textarea" ? <textarea className="input" value={cur[x.key] ?? ""} onChange={(e) => setF({ ...cur, [x.key]: e.target.value })} />
              : x.type === "select" ? <select className="input" value={cur[x.key] ?? ""} onChange={(e) => setF({ ...cur, [x.key]: e.target.value })}>{x.options!.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
              : x.type === "image" ? (
                <div className="flex items-center gap-2">
                  {cur[x.key] ? <img src={cur[x.key]} alt="" className="h-12 w-12 rounded-lg border object-contain" /> : <span className="grid h-12 w-12 place-items-center rounded-lg border text-[10px] text-slate-400">originale</span>}
                  <UploadButton label="Sostituisci" onUploaded={(url) => setF({ ...cur, [x.key]: url })} />
                  {cur[x.key] && <button type="button" className="btn-ghost btn-sm" onClick={() => setF({ ...cur, [x.key]: "" })}>Ripristina</button>}
                </div>
              )
              : <input className="input" type={x.type === "number" ? "number" : "text"} value={x.type === "list" && Array.isArray(cur[x.key]) ? cur[x.key].join(", ") : cur[x.key] ?? ""} onChange={(e) => setF({ ...cur, [x.key]: e.target.value })} />}
          </Field>
        ))}
      </div>
      <ErrorBox error={err} />
      <div className="flex gap-2"><button className="btn-primary" onClick={save} disabled={!f}>Salva</button>{f && <button className="btn-ghost" onClick={() => setF(null)}>Annulla modifiche</button>}</div>
    </div>
  );
}

export function Content() {
  const [tab, setTab] = useState("pagine");
  return (
    <div>
      <PageTitle title="Contenuti del sito" subtitle="Testi, pagine, banner, logo, mascotte, immagini, orari e contatti – modificabili senza toccare il codice" />
      <Tabs value={tab} onChange={setTab} items={[{ value: "pagine", label: "Pagine" }, { value:"legale",label:"Dati legali e checklist" }, { value: "home", label: "Home e banner" }, { value: "brand", label: "Logo e mascotte" }, { value: "contatti", label: "Contatti e orari" }, { value: "self", label: "Self-service" }, { value: "faq", label: "FAQ" }, { value: "media", label: "Immagini e file" }]} />
      {tab==="legale"&&<div className="space-y-4">
        <SettingsForm key="legal" section="legal" title="Dati legali del titolare — non sono i contatti del negozio" intro={<p className="text-amber-900"><b>Partita IVA mancante:</b> richiederla al titolare prima della pubblicazione finale (DPR 633/1972, art. 35). Non usare il CF come P.IVA. I documenti restano bozze da convalidare.</p>} fields={[
          {key:"companyName",label:"Denominazione legale"},{key:"legalForm",label:"Forma giuridica"},{key:"owner",label:"Titolare"},
          {key:"registeredOffice",label:"Sede legale completa"},{key:"pec",label:"Domicilio digitale / PEC"},
          {key:"rea",label:"REA"},{key:"taxCode",label:"Codice fiscale e n. iscrizione Registro Imprese"},
          {key:"vatNumber",label:"Partita IVA",hint:"Non fornita. Solo 11 cifre, da confermare con il titolare; vuoto = non mostrata."},
          {key:"providersConfirmed",label:"Fornitori effettivi, ruoli e contratti verificati",type:"checkbox"},
          {key:"transfersConfirmed",label:"Regioni e trasferimenti extra-SEE verificati",type:"checkbox"},
          {key:"retentionConfirmed",label:"Conservazione e procedure di cancellazione definite",type:"checkbox"},
          {key:"legalReviewed",label:"Testi esaminati con titolare e consulente",type:"checkbox"},
          {key:"trackingReviewed",label:"Audit tag e relative informative completati — consente i tag solo dopo consenso utente",type:"checkbox"},
          {key:"reviewNotes",label:"Note sulle verifiche e punti aperti",type:"textarea"},
        ]}/>
        <LegalChecklist/>
      </div>}
      {tab === "pagine" && (
        <ResourceManager title="Pagine" endpoint="/api/admin/pages" searchable canDelete={false} defaults={{ published: true, body: "" }}
          fields={[
            { name: "title", label: "Titolo", required: true }, { name: "slug", label: "Indirizzo (slug)", required: true, hint: "Non modificare per le pagine di sistema" },
            { name: "subtitle", label: "Sottotitolo", nullable: true, full: true },
            { name: "body", label: "Testo", type: "textarea", hint: "Formattazione: ## Titolo · - elenco · **grassetto** · [link](https://…)" },
            { name: "imageUrl", label: "Immagine (URL)", nullable: true }, { name: "videoUrl", label: "Video (link YouTube/Vimeo)", nullable: true },
            { name: "seoTitle", label: "Meta title", nullable: true }, { name: "seoDescription", label: "Meta description", nullable: true },
            { name: "published", label: "Pubblicata", type: "checkbox" },
          ]}
          toolbar={<UploadButton />}
          columns={[{ key: "title", label: "Pagina" }, { key: "slug", label: "Indirizzo", render: (r) => <code className="text-xs">/{r.slug === "home" ? "" : r.slug}</code> }, { key: "published", label: "Pubblicata", render: (r) => (r.published ? "✓" : "—") }]}
        />
      )}
      {tab === "home" && <div className="space-y-4">
        <SettingsForm section="site" title="Home page e sito" fields={[
          { key: "heroTitle", label: "Titolo principale" }, { key: "announcement", label: "Avviso in cima al sito (vuoto = nascosto)" },
          { key: "heroText", label: "Testo di presentazione", type: "textarea" },
          { key: "socialInstagram", label: "Link Instagram" }, { key: "socialFacebook", label: "Link Facebook" },
          { key: "shopEnabled", label: "Shop on line attivo (se disattivo il sito mostra “Pet Shop – In arrivo”)", type: "checkbox" }, { key: "boardingEnabled", label: "Richieste pensione attive", type: "checkbox" },
        ]} />
        <SettingsForm section="brand" title="Banner promozionale in home" fields={[
          { key: "bannerActive", label: "Banner attivo", type: "checkbox" }, { key: "bannerText", label: "Testo del banner" },
          { key: "bannerUrl", label: "Link del banner (es. /servizi)" }, { key: "bannerImageUrl", label: "Immagine del banner", type: "image" },
          { key: "heroImageUrl", label: "Foto principale della home", type: "image", hint: "Vuoto = foto della mascotte del brand board" },
        ]} />
      </div>}
      {tab === "brand" && <SettingsForm section="brand" title="Logo e mascotte" intro={<>Il logo ufficiale e la mascotte sono già integrati (ricavati dal brand board approvato). Sostituiscili solo con i file originali di Dog's Planet: <b>non usare loghi o cani diversi</b>, per mantenere un'identità uniforme.</>} fields={[
        { key: "logoUrl", label: "Logo (su sfondo chiaro)", type: "image" }, { key: "logoWhiteUrl", label: "Logo bianco (footer)", type: "image" },
        { key: "mascotWelcome", label: "Mascotte – Benvenuto", type: "image" }, { key: "mascotGrooming", label: "Mascotte – Toelettatura", type: "image" },
        { key: "mascotSelfService", label: "Mascotte – Self-Service", type: "image" }, { key: "mascotBoarding", label: "Mascotte – Pensione", type: "image" },
        { key: "mascotShop", label: "Mascotte – Pet Shop", type: "image" }, { key: "mascotFidelity", label: "Mascotte – Fidelity Card", type: "image" },
      ]} />}
      {tab === "contatti" && <SettingsForm section="business" title="Contatti e orari mostrati sul sito" fields={[
        { key: "name", label: "Nome attività" }, { key: "referent", label: "Referente" }, { key: "phone", label: "Telefono" }, { key: "whatsapp", label: "WhatsApp (formato 39…)" },
        { key: "email", label: "Email" }, { key: "address", label: "Indirizzo" }, { key: "cap", label: "CAP" }, { key: "city", label: "Comune" },
        { key: "groomingHours", label: "Orari toelettatura (testo sul sito)" },
      ]} />}
      {tab === "self" && <SettingsForm section="selfservice" title="Self-service" intro="Descrizione, istruzioni, tessera e shampoo si modificano nella pagina “Lavaggio Self-Service” (scheda Pagine); foto e video dalla stessa pagina. Le domande frequenti dalla scheda FAQ." fields={[
        { key: "days", label: "Giorni" }, { key: "hours", label: "Orario" },
        { key: "stations", label: "Postazioni / box", type: "list", hint: "Separate da virgola" }, { key: "categories", label: "Categorie incassi", type: "list", hint: "Separate da virgola" },
      ]} />}
      {tab === "faq" && (
        <ResourceManager title="Domande frequenti" endpoint="/api/admin/faqs" defaults={{ section: "selfservice", sortOrder: 0, active: true }}
          fields={[{ name: "section", label: "Sezione", type: "select", required: true, options: [{ value: "selfservice", label: "Self-service" }, { value: "generale", label: "Generale" }] }, { name: "sortOrder", label: "Ordine", type: "number" }, { name: "question", label: "Domanda", required: true, full: true }, { name: "answer", label: "Risposta", type: "textarea", required: true }, { name: "active", label: "Attiva", type: "checkbox" }]}
          columns={[{ key: "section", label: "Sezione" }, { key: "question", label: "Domanda" }, { key: "active", label: "Attiva", render: (r) => (r.active ? "✓" : "—") }]} />
      )}
      {tab === "media" && <MediaLibrary />}
    </div>
  );
}

export function SeoPage() {
  return (
    <div className="space-y-4">
      <PageTitle title="SEO e tracciamenti" subtitle="I tracciamenti di statistica e marketing si attivano solo dopo il consenso cookie del visitatore" />
      <SettingsForm section="seo" title="Impostazioni SEO" fields={[
        { key: "defaultTitle", label: "Meta title predefinito" }, { key: "searchConsoleVerification", label: "Google Search Console (codice di verifica meta)" },
        { key: "defaultDescription", label: "Meta description predefinita", type: "textarea" },
        { key: "gaMeasurementId", label: "Google Analytics 4 (G-XXXX)" }, { key: "gtmId", label: "Google Tag Manager (GTM-XXXX)" }, { key: "metaPixelId", label: "Meta Pixel ID" },
      ]} />
      <div className="card text-sm text-slate-700">
        <h2 className="mb-2 text-lg font-bold">Già attivi</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Sitemap: <a className="text-brand-blue underline" href="/sitemap.xml" target="_blank" rel="noreferrer">/sitemap.xml</a> (da inviare in Search Console) · Robots: <a className="text-brand-blue underline" href="/robots.txt" target="_blank" rel="noreferrer">/robots.txt</a></li>
          <li>Meta title, description, canonical e Open Graph per ogni pagina (modificabili da Contenuti → Pagine).</li>
          <li>Dati strutturati dell'attività (indirizzo, telefono, email). Nessuna recensione o valutazione inventata.</li>
          <li>URL leggibili, area clienti e gestionale esclusi dall'indicizzazione.</li>
        </ul>
      </div>
    </div>
  );
}

export function Promotions() {
  return (
    <div>
      <PageTitle title="Promozioni e codici sconto" subtitle="Servizi, prodotti, compleanno e punti Fidelity extra" />
      <ResourceManager title="Promozioni" endpoint="/api/admin/promotions" searchable defaults={{ discountType: "percent", discountValue: 10, appliesTo: "tutto", audience: "tutti", active: true, showOnSite: false }}
        fields={[
          { name: "title", label: "Titolo", required: true }, { name: "code", label: "Codice sconto (facoltativo)", nullable: true, hint: "Utilizzabile al checkout dello shop" },
          { name: "discountType", label: "Tipo", type: "select", required: true, options: [{ value: "percent", label: "Sconto %" }, { value: "amount", label: "Sconto in centesimi" }, { value: "points", label: "Punti Fidelity extra" }] },
          { name: "discountValue", label: "Valore", type: "number", hint: "% · centesimi (500 = 5 €) · punti" },
          { name: "appliesTo", label: "Valida per", type: "select", required: true, options: [{ value: "tutto", label: "Servizi e prodotti" }, { value: "servizi", label: "Solo servizi" }, { value: "shop", label: "Solo prodotti" }] },
          { name: "audience", label: "Destinatari", type: "select", required: true, options: [{ value: "tutti", label: "Tutti" }, { value: "compleanno", label: "Offerta di compleanno" }, { value: "inattivi", label: "Clienti inattivi" }, { value: "fidelity", label: "Titolari Fidelity" }] },
          { name: "startsAt", label: "Dal", type: "date" }, { name: "endsAt", label: "Al", type: "date" },
          { name: "description", label: "Descrizione", type: "textarea", nullable: true },
          { name: "showOnSite", label: "Mostra in home page", type: "checkbox" }, { name: "active", label: "Attiva", type: "checkbox" },
        ]}
        columns={[{ key: "title", label: "Promozione" }, { key: "code", label: "Codice" }, { key: "discountValue", label: "Valore", render: (r) => `${r.discountValue}${r.discountType === "percent" ? "%" : r.discountType === "points" ? " pt" : " cent."}` }, { key: "appliesTo", label: "Per" }, { key: "endsAt", label: "Scade", render: (r) => fmtDay(r.endsAt) }, { key: "active", label: "Attiva", render: (r) => (r.active ? "✓" : "—") }]}
      />
    </div>
  );
}

const emptyFilters = { regulars: false, minVisits: "", inactiveDays: "", serviceId: "", dogSize: "", dogBreed: "", coatKnots: false, birthdayMonth: false, city: "" };
const cleanFilters = (f: any) => {
  const out: any = {};
  for (const [k, v] of Object.entries(f)) if (v !== "" && v !== false && v != null) out[k] = ["minVisits", "inactiveDays", "serviceId"].includes(k) ? Number(v) : v;
  return out;
};

function Campaigns() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isLoading } = useQuery<any>({ queryKey: ["/api/admin/campaigns"], queryFn: () => get("/api/admin/campaigns?pageSize=50") });
  const { data: promos } = useQuery<any>({ queryKey: ["promos-all"], queryFn: () => get("/api/admin/promotions?pageSize=100") });
  const { data: services } = useQuery<any[]>({ queryKey: ["admin-services"], queryFn: () => get("/api/admin/services").catch(() => []) });
  const [edit, setEdit] = useState<any>(null);
  const [count, setCount] = useState<any>(null);
  const [preview, setPreview] = useState<any>(null);
  const [err, setErr] = useState<unknown>(null);

  const open = (c: any) => { setErr(null); setCount(null); setEdit({ title: "", subject: "", body: "", channel: "email", audience: "marketing", promotionId: "", ...c, filters: { ...emptyFilters, ...(c.filters || {}) } }); };
  const estimate = async () => { try { setCount(await post("/api/admin/segment-preview", { audience: edit.audience, filters: cleanFilters(edit.filters) })); } catch (e: any) { toast(e.message, "err"); } };
  const save = async () => {
    setErr(null);
    const body = { title: edit.title, subject: edit.subject, body: edit.body, channel: edit.channel, audience: edit.audience, promotionId: edit.promotionId ? Number(edit.promotionId) : null, filters: cleanFilters(edit.filters) };
    try { if (edit.id) await api(`/api/admin/campaigns/${edit.id}`, { method: "PATCH", body }); else await post("/api/admin/campaigns", body); toast("Campagna salvata"); setEdit(null); qc.invalidateQueries({ queryKey: ["/api/admin/campaigns"] }); }
    catch (e) { setErr(e); }
  };
  const send = async (c: any) => {
    const p = await get(`/api/admin/campaigns/${c.id}/preview`);
    if (!confirm(`Inviare "${c.subject}" a ${p.recipients} destinatari? L'invio non è annullabile.`)) return;
    try { const r = await post(`/api/admin/campaigns/${c.id}/send`); toast(`Messi in coda ${r.sent} invii su ${r.recipients} destinatari`); qc.invalidateQueries({ queryKey: ["/api/admin/campaigns"] }); } catch (e: any) { toast(e.message, "err"); }
  };
  const setFl = (k: string, v: any) => { setCount(null); setEdit({ ...edit, filters: { ...edit.filters, [k]: v } }); };

  return (
    <div>
      <div className="mb-3 flex items-center justify-between"><p className="text-sm text-slate-600">Le campagne promozionali raggiungono solo chi ha un consenso marketing valido; ogni email contiene il link di disiscrizione. Nessun invio WhatsApp automatico.</p>
        <button className="btn-primary btn-sm" onClick={() => open({})}>Nuova campagna</button></div>
      {isLoading ? <Spinner /> : !data?.rows?.length ? <Empty>Nessuna campagna.</Empty> : (
        <div className="overflow-x-auto rounded-2xl border bg-white"><table className="table-dp"><thead><tr><th>Campagna</th><th>Canale</th><th>Destinatari</th><th>Stato</th><th /></tr></thead>
          <tbody>{data.rows.map((c: any) => (
            <tr key={c.id}><td className="font-bold">{c.title}<span className="block text-xs font-normal text-slate-500">{c.subject}</span></td><td>{c.channel}</td>
              <td className="text-xs">{c.audience === "servizio" ? "Comunicazione di servizio" : "Consenso marketing"}{Object.keys(c.filters || {}).length > 0 && ` · ${Object.keys(c.filters).length} filtri`}</td>
              <td>{c.status === "inviata" ? `Inviata ${fmtDateTime(c.sentAt)} (${c.sentCount})` : "Bozza"}</td>
              <td className="whitespace-nowrap text-right">{c.status === "bozza" && <>
                <button className="btn-ghost btn-sm" onClick={() => open(c)}>Modifica</button>
                <button className="btn-ghost btn-sm" onClick={async () => setPreview(await get(`/api/admin/campaigns/${c.id}/preview`))}><Eye size={14} /></button>
                <button className="btn-primary btn-sm" onClick={() => send(c)}><Send size={14} /> Invia</button></>}</td></tr>
          ))}</tbody></table></div>
      )}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? "Modifica campagna" : "Nuova campagna"} wide>
        {edit && <form onSubmit={(e) => { e.preventDefault(); save(); }} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nome interno *"><input className="input" required value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} /></Field>
            <Field label="Oggetto / titolo notifica *"><input className="input" required value={edit.subject} onChange={(e) => setEdit({ ...edit, subject: e.target.value })} /></Field>
            <Field label="Canale"><select className="input" value={edit.channel} onChange={(e) => setEdit({ ...edit, channel: e.target.value })}><option value="email">Email</option><option value="push">Notifica push</option><option value="entrambi">Email + push</option></select></Field>
            <Field label="Tipo"><select className="input" value={edit.audience} onChange={(e) => { setCount(null); setEdit({ ...edit, audience: e.target.value }); }}><option value="marketing">Promozionale (solo con consenso marketing)</option><option value="servizio">Comunicazione di servizio (senza promozioni)</option></select></Field>
            <Field label="Promozione collegata"><select className="input" value={edit.promotionId || ""} onChange={(e) => setEdit({ ...edit, promotionId: e.target.value })}><option value="">—</option>{promos?.rows?.map((p: any) => <option key={p.id} value={p.id}>{p.title}</option>)}</select></Field>
            <Field label="Testo * (paragrafi separati da una riga vuota)" className="sm:col-span-2"><textarea className="input min-h-[140px]" required value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} /></Field>
          </div>
          <fieldset className="rounded-2xl border border-slate-200 p-4">
            <legend className="px-2 font-display text-sm font-bold text-brand-navy">Segmentazione clienti</legend>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="flex flex-col gap-2 pt-1"><Check checked={edit.filters.regulars} onChange={(v) => setFl("regulars", v)} label="Clienti abituali (≥4 visite in 12 mesi)" /><Check checked={edit.filters.birthdayMonth} onChange={(v) => setFl("birthdayMonth", v)} label="Compleanno questo mese" /><Check checked={edit.filters.coatKnots} onChange={(v) => setFl("coatKnots", v)} label="Cane con nodi" /></div>
              <Field label="Visite minime (12 mesi)"><input type="number" min={1} className="input" value={edit.filters.minVisits} onChange={(e) => setFl("minVisits", e.target.value)} /></Field>
              <Field label="Inattivi da (giorni)"><input type="number" min={1} className="input" value={edit.filters.inactiveDays} onChange={(e) => setFl("inactiveDays", e.target.value)} /></Field>
              <Field label="Hanno fatto il servizio"><select className="input" value={edit.filters.serviceId} onChange={(e) => setFl("serviceId", e.target.value)}><option value="">Qualsiasi</option>{services?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
              <Field label="Taglia del cane"><select className="input" value={edit.filters.dogSize} onChange={(e) => setFl("dogSize", e.target.value)}><option value="">Qualsiasi</option>{SIZES.map((s) => <option key={s} value={s}>{SIZE_LABELS[s]}</option>)}</select></Field>
              <Field label="Razza contiene"><input className="input" value={edit.filters.dogBreed} onChange={(e) => setFl("dogBreed", e.target.value)} /></Field>
              <Field label="Comune contiene"><input className="input" value={edit.filters.city} onChange={(e) => setFl("city", e.target.value)} /></Field>
            </div>
            <div className="mt-3 flex items-center gap-3"><button type="button" className="btn-outline btn-sm" onClick={estimate}><Users size={14} /> Calcola destinatari</button>
              {count && <span className="text-sm"><b>{count.recipients}</b> destinatari{count.sample?.length > 0 && <span className="text-slate-500"> (es. {count.sample.slice(0, 3).join(", ")}…)</span>}</span>}</div>
          </fieldset>
          <ErrorBox error={err} />
          <button className="btn-primary">Salva bozza</button>
        </form>}
      </Modal>
      <Modal open={!!preview} onClose={() => setPreview(null)} title={`Anteprima – ${preview?.recipients ?? 0} destinatari`} wide>
        {preview && <iframe title="Anteprima email" srcDoc={preview.html} className="h-[60vh] w-full rounded-xl border" sandbox="" />}
      </Modal>
    </div>
  );
}

function Templates() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isLoading } = useQuery<any[]>({ queryKey: ["email-templates"], queryFn: () => get("/api/admin/email-templates") });
  const [edit, setEdit] = useState<any>(null);
  const [err, setErr] = useState<unknown>(null);
  if (isLoading) return <Spinner />;
  const save = async () => {
    setErr(null);
    try { await put(`/api/admin/email-templates/${edit.key}`, { subject: edit.subject, body: edit.body, active: edit.active }); toast("Template salvato"); setEdit(null); qc.invalidateQueries({ queryKey: ["email-templates"] }); }
    catch (e) { setErr(e); }
  };
  return (
    <div>
      <p className="mb-3 text-sm text-slate-600">Segnaposto disponibili: <code>{"{{nome}} {{cane}} {{servizio}} {{data}} {{operatore}} {{importo}} {{ordine}} {{stato}} {{giorni}} {{punti}} {{messaggio}} {{link}}"}</code>. Il logo e i contatti vengono aggiunti automaticamente.</p>
      <div className="overflow-x-auto rounded-2xl border bg-white"><table className="table-dp"><thead><tr><th>Email automatica</th><th>Oggetto</th><th>Stato</th><th /></tr></thead>
        <tbody>{data?.map((t) => <tr key={t.key}><td className="font-bold">{t.name}</td><td className="text-sm">{t.subject}</td><td className="text-xs">{t.active ? "Attiva" : "Disattivata"}{t.customized && " · personalizzata"}</td>
          <td className="whitespace-nowrap text-right"><button className="btn-ghost btn-sm" onClick={() => { setErr(null); setEdit({ ...t }); }}>Modifica</button>
            <button className="btn-ghost btn-sm" title="Invia una prova al tuo indirizzo" onClick={async () => { try { const r = await post(`/api/admin/email-templates/${t.key}/test`); toast(`Prova messa in coda verso ${r.to}`); } catch (e: any) { toast(e.message, "err"); } }}><Send size={14} /></button>
            {t.customized && <button className="btn-ghost btn-sm" title="Ripristina il testo predefinito" onClick={async () => { if (confirm("Ripristinare il testo predefinito?")) { await del(`/api/admin/email-templates/${t.key}`); qc.invalidateQueries({ queryKey: ["email-templates"] }); } }}><RotateCcw size={14} /></button>}</td></tr>)}</tbody></table></div>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.name || ""} wide>
        {edit && <div className="space-y-3">
          <Field label="Oggetto"><input className="input" value={edit.subject} onChange={(e) => setEdit({ ...edit, subject: e.target.value })} /></Field>
          <Field label="Testo (paragrafi separati da una riga vuota)"><textarea className="input min-h-[200px]" value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} /></Field>
          <Check checked={edit.active} onChange={(v) => setEdit({ ...edit, active: v })} label="Invio attivo" />
          <ErrorBox error={err} />
          <div className="flex gap-2"><button className="btn-primary" onClick={save}>Salva</button><button className="btn-ghost" onClick={() => setEdit({ ...edit, subject: edit.defaultSubject, body: edit.defaultBody })}>Carica testo predefinito</button></div>
        </div>}
      </Modal>
    </div>
  );
}

function EmailLog() {
  const qc = useQueryClient();
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const { data, isLoading } = useQuery<any>({ queryKey: ["email-log", page, status], queryFn: () => get(`/api/admin/email-log?page=${page}&pageSize=50${status ? `&status=${status}` : ""}`) });
  return (
    <div>
      <select className="input mb-3 w-56" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="">Tutti gli stati</option>{["in_coda", "in_invio", "inviata", "errore", "fallita", "simulata"].map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}</select>
      {isLoading ? <Spinner /> : !data?.rows?.length ? <Empty>Nessuna email.</Empty> : (
        <div className="overflow-x-auto rounded-2xl border bg-white"><table className="table-dp"><thead><tr><th>Data</th><th>Destinatario</th><th>Oggetto</th><th>Esito</th><th>Tentativi</th><th /></tr></thead>
          <tbody>{data.rows.map((e: any) => <tr key={e.id}><td className="whitespace-nowrap">{fmtDateTime(e.createdAt)}</td><td>{e.toEmail}</td><td>{e.subject}</td>
            <td>{e.status}{e.sentAt && <span className="block text-xs text-slate-500">{fmtDateTime(e.sentAt)}</span>}{e.lastError && <span className="block text-xs text-red-600">{e.lastError}</span>}</td><td>{e.attempts}</td>
            <td>{["fallita", "errore"].includes(e.status) && <button className="btn-ghost btn-sm" onClick={async () => { await post(`/api/admin/email-log/${e.id}/retry`); toast("Rimessa in coda"); qc.invalidateQueries({ queryKey: ["email-log"] }); }}><RotateCcw size={14} /> Riprova</button>}</td></tr>)}</tbody></table>
          {data.rows.some((e: any) => e.status === "simulata") && <p className="p-3 text-xs text-amber-700">Le email “simulate” non sono partite: configura SMTP nei Secrets di Replit per inviarle davvero.</p>}
        </div>
      )}
      <Pager page={page} pageSize={50} onPage={setPage} />
    </div>
  );
}

function PushLog() {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useQuery<any>({ queryKey: ["push-log", page], queryFn: () => get(`/api/admin/push-log?page=${page}&pageSize=50`) });
  if (isLoading) return <Spinner />;
  return (
    <div>
      {!data?.rows?.length ? <Empty>Nessuna notifica push inviata.</Empty> : (
        <div className="overflow-x-auto rounded-2xl border bg-white"><table className="table-dp"><thead><tr><th>Data</th><th>Cliente</th><th>Titolo</th><th>Esito</th></tr></thead>
          <tbody>{data.rows.map((l: any) => <tr key={l.id}><td>{fmtDateTime(l.createdAt)}</td><td>{l.name || "—"}</td><td>{l.title}</td><td>{l.status === "rimossa" ? "sottoscrizione scaduta, rimossa" : l.status}{l.error && <span className="block text-xs text-red-600">{l.error}</span>}</td></tr>)}</tbody></table></div>
      )}
      <Pager page={page} pageSize={50} onPage={setPage} />
    </div>
  );
}

export function Communications() {
  const [tab, setTab] = useState("campagne");
  return (
    <div>
      <PageTitle title="Comunicazioni" subtitle="Email automatiche, campagne, promemoria, richiami periodici e notifiche push" />
      <Tabs value={tab} onChange={setTab} items={[{ value: "campagne", label: "Campagne" }, { value: "template", label: "Email automatiche" }, { value: "promemoria", label: "Promemoria e richiami" }, { value: "log", label: "Registro email" }, { value: "push", label: "Registro push" }]} />
      {tab === "campagne" && <Campaigns />}
      {tab === "template" && <Templates />}
      {tab === "promemoria" && <SettingsForm section="notifications" title="Promemoria e richiami periodici" intro="Il promemoria parte una sola volta per ogni appuntamento confermato (email + push). Il richiamo periodico invita il cliente a richiedere un nuovo appuntamento secondo la frequenza impostata nella scheda del cane: non crea mai prenotazioni e rispetta le preferenze di comunicazione." fields={[
        { key: "reminderHours", label: "Promemoria: ore prima dell'appuntamento", type: "number", hint: "Predefinito 24" },
        { key: "recallDefaultDays", label: "Frequenza di richiamo predefinita (giorni)", type: "number", hint: "Vuoto = solo per i cani con frequenza impostata" },
        { key: "recallEnabled", label: "Richiami periodici attivi", type: "checkbox" },
      ]} />}
      {tab === "log" && <EmailLog />}
      {tab === "push" && <PushLog />}
    </div>
  );
}
