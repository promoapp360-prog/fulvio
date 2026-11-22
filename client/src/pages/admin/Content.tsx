import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Upload, Copy, Trash2, Send, Eye } from "lucide-react";
import { PageTitle, Spinner, Empty, Field, Check, Tabs, Modal, ErrorBox, useToast } from "@/components/ui";
import ResourceManager from "@/components/ResourceManager";
import { api, get, put, del, post } from "@/lib/api";
import { fmtDateTime, fmtDay } from "@/lib/format";

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
      try { await navigator.clipboard.writeText(m.url); toast(`Caricata: indirizzo copiato (${m.url})`); } catch { toast(`Caricata: ${m.url}`); }
      onUploaded?.(m.url); qc.invalidateQueries({ queryKey: ["media"] });
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
      <div className="mb-4 flex items-center gap-3"><UploadButton /><p className="text-xs text-slate-500">Le immagini vengono ridimensionate (max 1600 px) e convertite in WebP automaticamente. Per i video usa un link YouTube/Vimeo nelle pagine.</p></div>
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

/** Form generico per una sezione di impostazioni. */
export function SettingsForm({ section, fields, title }: { section: string; title: string; fields: { key: string; label: string; type?: "text" | "textarea" | "checkbox" | "number" | "list"; hint?: string }[] }) {
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
      for (const x of fields) body[x.key] = x.type === "number" ? Number(cur[x.key]) : x.type === "list" ? (Array.isArray(cur[x.key]) ? cur[x.key] : String(cur[x.key] || "").split(",").map((s) => s.trim()).filter(Boolean)) : cur[x.key];
      await put(`/api/admin/settings/${section}`, body); toast("Impostazioni salvate"); setF(null);
      qc.invalidateQueries({ queryKey: ["admin-settings"] }); qc.invalidateQueries({ queryKey: ["public-settings"] });
    } catch (e) { setErr(e); }
  };
  return (
    <div className="card space-y-3">
      <h2 className="text-lg font-bold">{title}</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((x) => x.type === "checkbox" ? <div key={x.key} className="pt-5"><Check checked={!!cur[x.key]} onChange={(v) => setF({ ...cur, [x.key]: v })} label={x.label} /></div> : (
          <Field key={x.key} label={x.label} hint={x.hint} className={x.type === "textarea" ? "sm:col-span-2" : ""}>
            {x.type === "textarea" ? <textarea className="input" value={cur[x.key] ?? ""} onChange={(e) => setF({ ...cur, [x.key]: e.target.value })} />
              : <input className="input" type={x.type === "number" ? "number" : "text"} value={x.type === "list" && Array.isArray(cur[x.key]) ? cur[x.key].join(", ") : cur[x.key] ?? ""} onChange={(e) => setF({ ...cur, [x.key]: e.target.value })} />}
          </Field>
        ))}
      </div>
      <ErrorBox error={err} />
      <button className="btn-primary" onClick={save}>Salva</button>
    </div>
  );
}

export function Content() {
  const [tab, setTab] = useState("pagine");
  return (
    <div>
      <PageTitle title="Contenuti del sito" subtitle="Testi, pagine, FAQ, immagini e SEO – modificabili senza toccare il codice" />
      <Tabs value={tab} onChange={setTab} items={[{ value: "pagine", label: "Pagine" }, { value: "home", label: "Home e sito" }, { value: "self", label: "Self-service" }, { value: "faq", label: "FAQ" }, { value: "media", label: "Immagini e file" }, { value: "seo", label: "SEO e tracciamenti" }]} />
      {tab === "pagine" && (
        <ResourceManager title="Pagine" endpoint="/api/admin/pages" searchable canDelete={false} defaults={{ published: true, body: "" }}
          fields={[
            { name: "title", label: "Titolo", required: true }, { name: "slug", label: "Indirizzo (slug)", required: true, hint: "Non modificare per le pagine di sistema" },
            { name: "subtitle", label: "Sottotitolo", nullable: true, full: true },
            { name: "body", label: "Testo", type: "textarea", hint: "Formattazione: ## Titolo · - elenco · **grassetto** · [link](https://…)" },
            { name: "imageUrl", label: "Immagine (URL)", nullable: true }, { name: "videoUrl", label: "Video (link YouTube/Vimeo)", nullable: true },
            { name: "seoTitle", label: "Titolo SEO", nullable: true }, { name: "seoDescription", label: "Descrizione SEO", nullable: true },
            { name: "published", label: "Pubblicata", type: "checkbox" },
          ]}
          toolbar={<UploadButton />}
          columns={[{ key: "title", label: "Pagina" }, { key: "slug", label: "Indirizzo", render: (r) => <code className="text-xs">/{r.slug === "home" ? "" : r.slug}</code> }, { key: "published", label: "Pubblicata", render: (r) => (r.published ? "✓" : "—") }]}
        />
      )}
      {tab === "home" && <SettingsForm section="site" title="Home page e sito" fields={[
        { key: "heroTitle", label: "Titolo principale" }, { key: "announcement", label: "Avviso in cima al sito (vuoto = nascosto)" },
        { key: "heroText", label: "Testo di presentazione", type: "textarea" },
        { key: "socialInstagram", label: "Link Instagram" }, { key: "socialFacebook", label: "Link Facebook" },
        { key: "shopEnabled", label: "Shop on line attivo", type: "checkbox" }, { key: "boardingEnabled", label: "Richieste pensione attive", type: "checkbox" },
      ]} />}
      {tab === "self" && <SettingsForm section="selfservice" title="Self-service" fields={[
        { key: "days", label: "Giorni" }, { key: "hours", label: "Orario" },
        { key: "stations", label: "Postazioni / box", type: "list", hint: "Separate da virgola" }, { key: "categories", label: "Categorie incassi", type: "list", hint: "Separate da virgola" },
      ]} />}
      {tab === "faq" && (
        <ResourceManager title="Domande frequenti" endpoint="/api/admin/faqs" defaults={{ section: "selfservice", sortOrder: 0, active: true }}
          fields={[{ name: "section", label: "Sezione", type: "select", required: true, options: [{ value: "selfservice", label: "Self-service" }, { value: "generale", label: "Generale" }] }, { name: "sortOrder", label: "Ordine", type: "number" }, { name: "question", label: "Domanda", required: true, full: true }, { name: "answer", label: "Risposta", type: "textarea", required: true }, { name: "active", label: "Attiva", type: "checkbox" }]}
          columns={[{ key: "section", label: "Sezione" }, { key: "question", label: "Domanda" }, { key: "active", label: "Attiva", render: (r) => (r.active ? "✓" : "—") }]} />
      )}
      {tab === "media" && <MediaLibrary />}
      {tab === "seo" && <SettingsForm section="seo" title="SEO e tracciamenti (attivati solo dopo il consenso cookie)" fields={[
        { key: "defaultTitle", label: "Titolo predefinito" }, { key: "defaultDescription", label: "Descrizione predefinita", type: "textarea" },
        { key: "gaMeasurementId", label: "Google Analytics 4 (G-XXXX)" }, { key: "gtmId", label: "Google Tag Manager (GTM-XXXX)" }, { key: "metaPixelId", label: "Meta Pixel ID" },
      ]} />}
    </div>
  );
}

export function Marketing() {
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState("promo");
  const [preview, setPreview] = useState<any>(null);
  const { data: promos } = useQuery<any>({ queryKey: ["promos-all"], queryFn: () => get("/api/admin/promotions?pageSize=100") });
  const send = async (c: any) => {
    const p = await get(`/api/admin/campaigns/${c.id}/preview`);
    if (!confirm(`Inviare "${c.subject}" a ${p.recipients} destinatari? L'invio non è annullabile.`)) return;
    try { const r = await post(`/api/admin/campaigns/${c.id}/send`); toast(`Inviata: ${r.sent} messaggi su ${r.recipients} destinatari`); qc.invalidateQueries({ queryKey: ["/api/admin/campaigns"] }); } catch (e: any) { toast(e.message, "err"); }
  };
  return (
    <div>
      <PageTitle title="Promozioni e comunicazioni" subtitle="Le comunicazioni promozionali vengono inviate solo a chi ha dato il consenso marketing" />
      <Tabs value={tab} onChange={setTab} items={[{ value: "promo", label: "Promozioni" }, { value: "camp", label: "Campagne email / push" }, { value: "log", label: "Registro email" }]} />
      {tab === "promo" && (
        <ResourceManager title="Promozioni" endpoint="/api/admin/promotions" searchable defaults={{ discountType: "percent", discountValue: 10, appliesTo: "tutto", audience: "tutti", active: true, showOnSite: false }}
          fields={[
            { name: "title", label: "Titolo", required: true }, { name: "code", label: "Codice (facoltativo)", nullable: true, hint: "Usabile nello shop" },
            { name: "discountType", label: "Tipo sconto", type: "select", required: true, options: [{ value: "percent", label: "Percentuale %" }, { value: "amount", label: "Importo in centesimi" }, { value: "points", label: "Punti Fidelity extra" }] },
            { name: "discountValue", label: "Valore", type: "number", hint: "% / centesimi (es. 500 = 5 €) / punti" },
            { name: "appliesTo", label: "Valida per", type: "select", required: true, options: [{ value: "tutto", label: "Tutto" }, { value: "servizi", label: "Servizi" }, { value: "shop", label: "Shop" }] },
            { name: "audience", label: "Destinatari", type: "select", required: true, options: [{ value: "tutti", label: "Tutti" }, { value: "compleanno", label: "Compleanno del mese" }, { value: "inattivi", label: "Clienti inattivi (90 gg)" }, { value: "fidelity", label: "Titolari Fidelity" }] },
            { name: "startsAt", label: "Dal", type: "date" }, { name: "endsAt", label: "Al", type: "date" },
            { name: "description", label: "Descrizione", type: "textarea", nullable: true },
            { name: "showOnSite", label: "Mostra in home page", type: "checkbox" }, { name: "active", label: "Attiva", type: "checkbox" },
          ]}
          columns={[{ key: "title", label: "Promozione" }, { key: "code", label: "Codice" }, { key: "discountValue", label: "Sconto", render: (r) => `${r.discountValue}${r.discountType === "percent" ? "%" : r.discountType === "points" ? " pt" : " cent."}` }, { key: "endsAt", label: "Scade", render: (r) => fmtDay(r.endsAt) }, { key: "active", label: "Attiva", render: (r) => (r.active ? "✓" : "—") }]}
        />
      )}
      {tab === "camp" && (
        <ResourceManager title="Campagne" endpoint="/api/admin/campaigns" defaults={{ channel: "email", audience: "marketing" }}
          fields={[
            { name: "title", label: "Nome interno", required: true }, { name: "subject", label: "Oggetto / titolo notifica", required: true },
            { name: "channel", label: "Canale", type: "select", required: true, options: [{ value: "email", label: "Email" }, { value: "push", label: "Notifica push" }, { value: "entrambi", label: "Email + push" }] },
            { name: "audience", label: "Destinatari", type: "select", required: true, options: [{ value: "marketing", label: "Tutti i clienti con consenso marketing" }, { value: "compleanno", label: "Compleanno questo mese" }, { value: "inattivi", label: "Inattivi da 90 giorni" }, { value: "fidelity", label: "Con punti Fidelity" }, { value: "tutti", label: "Comunicazione di servizio (tutti i clienti)" }] },
            { name: "promotionId", label: "Promozione collegata", type: "select", numeric: true, options: (promos?.rows || []).map((p: any) => ({ value: p.id, label: p.title })) },
            { name: "body", label: "Testo (paragrafi separati da una riga vuota)", type: "textarea", required: true },
          ]}
          columns={[
            { key: "title", label: "Campagna" }, { key: "channel", label: "Canale" }, { key: "audience", label: "Destinatari" },
            { key: "status", label: "Stato", render: (r) => r.status === "inviata" ? `Inviata ${fmtDateTime(r.sentAt)} (${r.sentCount})` : (
              <span className="flex gap-1"><button className="btn-ghost btn-sm" onClick={async () => setPreview(await get(`/api/admin/campaigns/${r.id}/preview`))}><Eye size={14} /></button><button className="btn-primary btn-sm" onClick={() => send(r)}><Send size={14} /> Invia</button></span>) },
          ]}
        />
      )}
      {tab === "log" && <EmailLog />}
      <Modal open={!!preview} onClose={() => setPreview(null)} title={`Anteprima – ${preview?.recipients ?? 0} destinatari`} wide>
        {preview && <iframe title="Anteprima email" srcDoc={preview.html} className="h-[60vh] w-full rounded-xl border" sandbox="" />}
      </Modal>
    </div>
  );
}

function EmailLog() {
  const { data, isLoading } = useQuery<any>({ queryKey: ["email-log"], queryFn: () => get("/api/admin/email-log?pageSize=100") });
  if (isLoading) return <Spinner />;
  return (
    <div className="overflow-x-auto rounded-2xl border bg-white"><table className="table-dp"><thead><tr><th>Data</th><th>Destinatario</th><th>Oggetto</th><th>Esito</th></tr></thead>
      <tbody>{data.rows.map((e: any) => <tr key={e.id}><td>{fmtDateTime(e.createdAt)}</td><td>{e.toEmail}</td><td>{e.subject}</td><td>{e.status}{e.error && <span className="block text-xs text-red-600">{e.error}</span>}</td></tr>)}</tbody></table>
      {data.rows.some((e: any) => e.status === "simulata") && <p className="p-3 text-xs text-amber-700">Alcune email risultano “simulate”: configura i parametri SMTP nei Secrets di Replit per inviarle davvero.</p>}
    </div>
  );
}

