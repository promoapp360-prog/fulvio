import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { Logo } from "@/components/brand";
import { Field, Check, ErrorBox, useToast } from "@/components/ui";
import { post } from "@/lib/api";
import { api } from "@/lib/api";
import { Eye, EyeOff } from "lucide-react";
import CustomerDogFields, { DogPhotoInput, newCustomerDog } from "@/components/CustomerDogFields";

function nextUrl(fallback: string) {
  const n = new URLSearchParams(window.location.search).get("next");
  return n && /^\/(?![\/\\])/.test(n) ? n : fallback;
}

function PasswordInput({ value, onChange, registration = false }: { value: string; onChange: (value: string) => void; registration?: boolean }) {
  const [visible, setVisible] = useState(false);
  return <div className="relative">
    <input type={visible ? "text" : "password"} autoComplete={registration ? "new-password" : "current-password"} required minLength={registration ? 8 : undefined} maxLength={128} className="input min-h-12 pr-14" value={value} onChange={e => onChange(e.target.value)} />
    <button type="button" className="absolute right-0 top-0 grid h-12 w-12 place-items-center text-brand-navy" aria-label={visible ? "Nascondi password" : "Mostra password"} aria-pressed={visible} onClick={() => setVisible(!visible)}>{visible ? <EyeOff size={20} /> : <Eye size={20} />}</button>
  </div>;
}

function AuthCard({ title, children, wide = false }: { title: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="bg-gradient-to-b from-brand-sky to-white py-12">
      <div className={`mx-auto w-full px-4 ${wide ? "max-w-3xl" : "max-w-md"}`}>
        <div className="card">
          <div className="mb-4 flex justify-center"><Logo className="h-20" /></div>
          <h1 className="mb-5 text-center text-2xl font-extrabold">{title}</h1>
          {children}
        </div>
      </div>
    </div>
  );
}

export function LoginPage() {
  const qc = useQueryClient();
  const [, nav] = useLocation();
  const [f, setF] = useState({ login: "", password: "" });
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      const u = await post("/api/auth/login", f);
      qc.clear();
      qc.setQueryData(["me"], u);
      if (u.mustChangePassword) return nav("/cambia-password");
      nav(nextUrl(u.role === "customer" ? "/account" : "/admin"));
    } catch (x) { setErr(x); } finally { setBusy(false); }
  };
  return (
    <AuthCard title="Accedi">
      <form onSubmit={submit} className="space-y-3">
        <Field label="Email o username"><input autoComplete="username" autoCapitalize="none" className="input" required value={f.login} onChange={(e) => setF({ ...f, login: e.target.value })} /></Field>
        <Field label="Password"><PasswordInput value={f.password} onChange={password => setF({ ...f, password })} /></Field>
        <ErrorBox error={err} />
        <button className="btn-primary w-full" disabled={busy}>Accedi</button>
      </form>
      <div className="mt-4 flex justify-between text-sm">
        <Link href="/password-dimenticata" className="font-semibold text-brand-blue">Password dimenticata?</Link>
        <Link href={`/registrazione${window.location.search}`} className="font-semibold text-brand-blue">Crea un account</Link>
      </div>
    </AuthCard>
  );
}

export function RegisterPage() {
  const qc = useQueryClient();
  const [, nav] = useLocation();
  const toast = useToast();
  const [f, setF] = useState({ firstName: "", lastName: "", email: "", phone: "", password: "", city: "", province: "", cap: "", birthDate: "", consentPrivacy: false, consentMarketing: false });
  const [dog, setDog] = useState<any>(newCustomerDog);
  const [photo, setPhoto] = useState<File | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      if (!photo) throw new Error("Carica la foto del cane per completare la scheda.");
      const form = new FormData(); form.append("payload", JSON.stringify({ ...f, dog })); form.append("photo", photo);
      const u = await api("/api/auth/register", { method: "POST", form });
      qc.clear();
      qc.setQueryData(["me"], u);
      try { sessionStorage.setItem("dp-install-eligible", "1"); } catch { /* memoria temporanea non disponibile */ }
      window.dispatchEvent(new Event("dp:install-eligible"));
      toast("Benvenuto in Dog's Planet! Account e scheda cane creati.");
      nav(nextUrl("/account"));
    } catch (x) { setErr(x); } finally { setBusy(false); }
  };
  return (
    <AuthCard title="Diventa cliente" wide>
      <p className="mb-5 text-sm leading-relaxed text-slate-600">Compila i tuoi dati e la scheda del tuo animale una sola volta. I campi indicati con * sono obbligatori.</p>
      <form onSubmit={submit} className="space-y-5">
        <h2 className="text-lg font-bold">I tuoi dati</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nome *"><input className="input" required autoComplete="given-name" value={f.firstName} onChange={set("firstName")} /></Field>
          <Field label="Cognome *"><input className="input" required autoComplete="family-name" value={f.lastName} onChange={set("lastName")} /></Field>
        </div>
        <Field label="Email *"><input type="email" className="input" required autoComplete="email" value={f.email} onChange={set("email")} /></Field>
        <Field label="Telefono / WhatsApp *"><input type="tel" className="input min-h-12" required minLength={8} autoComplete="tel" value={f.phone} onChange={set("phone")} /></Field>
        <Field label="Password *" hint="Scegli la tua password: almeno 8 caratteri."><PasswordInput registration value={f.password} onChange={password => setF({ ...f, password })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Comune *" className="col-span-2"><input required maxLength={120} autoComplete="address-level2" className="input min-h-12" value={f.city} onChange={set("city")} /></Field>
          <Field label="Provincia *"><input required minLength={2} maxLength={2} pattern="[A-Za-z]{2}" autoComplete="address-level1" className="input min-h-12 uppercase" value={f.province} onChange={set("province")} /></Field>
          <Field label="CAP *"><input required inputMode="numeric" pattern="[0-9]{5}" maxLength={5} autoComplete="postal-code" className="input min-h-12" value={f.cap} onChange={set("cap")} /></Field>
        </div>
        <Field label="La tua data di nascita *"><input required type="date" autoComplete="bday" max={new Date().toLocaleDateString("sv-SE")} className="input min-h-12" value={f.birthDate} onChange={set("birthDate")} /></Field>
        <CustomerDogFields value={dog} onChange={setDog} />
        <DogPhotoInput file={photo} onChange={setPhoto} />
        <fieldset className="rounded-xl border border-sky-200 p-4">
          <legend className="px-1 font-bold">Privacy e preferenze</legend>
          <label className="flex min-h-12 cursor-pointer items-start gap-3 py-2 text-sm leading-relaxed"><input required type="checkbox" className="mt-1 h-5 w-5 shrink-0 accent-brand-navy" checked={f.consentPrivacy} onChange={e => setF({ ...f, consentPrivacy: e.target.checked })} /><span>Ho letto l'<Link href="/privacy-policy" target="_blank" className="font-semibold underline">informativa privacy</Link> ed accetto le <Link href="/condizioni-del-servizio" target="_blank" className="font-semibold underline">condizioni del servizio</Link> *</span></label>
          <label className="mt-3 flex min-h-12 cursor-pointer items-start gap-3 rounded-xl bg-brand-sky p-3 text-sm leading-relaxed"><input type="checkbox" className="mt-1 h-5 w-5 shrink-0 accent-brand-navy" checked={f.consentMarketing} onChange={e => setF({ ...f, consentMarketing: e.target.checked })} /><span>Acconsento a ricevere comunicazioni promozionali ed offerte via email, WhatsApp e notifiche.<strong className="mt-1 block">Scelta facoltativa, non necessaria per registrarti. Le email di servizio su account e appuntamenti sono indipendenti dal marketing.</strong></span></label>
          <p className="mt-3 text-xs leading-relaxed text-slate-600">Le comunicazioni necessarie al servizio, come conferme e promemoria dell'appuntamento, restano distinte dal marketing. Le push richiedono anche un'autorizzazione del browser dopo un tuo click.</p>
        </fieldset>
        <ErrorBox error={err} />
        <button className="btn-primary min-h-12 w-full" disabled={busy || !f.consentPrivacy || !photo}>{busy ? "Registrazione…" : "Completa la registrazione"}</button>
      </form>
      <p className="mt-4 text-center text-sm">Hai già un account? <Link href={`/login${window.location.search}`} className="font-semibold text-brand-blue">Accedi</Link></p>
    </AuthCard>
  );
}

export function ForgotPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  return (
    <AuthCard title="Password dimenticata">
      {sent ? <p className="text-center text-sm">Se l'indirizzo è registrato riceverai un'email con il link per scegliere una nuova password.</p> : (
        <form onSubmit={async (e) => { e.preventDefault(); try { await post("/api/auth/forgot-password", { login: email }); setSent(true); } catch (x) { setErr(x); } }} className="space-y-3">
          <Field label="Email o username"><input className="input" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <ErrorBox error={err} />
          <button className="btn-primary w-full">Invia link</button>
        </form>
      )}
    </AuthCard>
  );
}

export function ResetPage() {
  const [, nav] = useLocation();
  const token = new URLSearchParams(window.location.search).get("token") || "";
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<unknown>(null);
  const toast = useToast();
  return (
    <AuthCard title="Nuova password">
      <form onSubmit={async (e) => { e.preventDefault(); try { await post("/api/auth/reset-password", { token, password: pw }); toast("Password aggiornata, ora puoi accedere"); nav("/login"); } catch (x) { setErr(x); } }} className="space-y-3">
        <Field label="Nuova password" hint="Almeno 8 caratteri"><input type="password" minLength={8} className="input" required value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
        <ErrorBox error={err} />
        <button className="btn-primary w-full">Salva</button>
      </form>
    </AuthCard>
  );
}

/** Cambio obbligatorio della password temporanea (primo accesso admin e collaboratori). */
export function ForceChangePasswordPage() {
  const qc = useQueryClient();
  const [, nav] = useLocation();
  const [f, setF] = useState({ current: "", password: "", confirm: "" });
  const [err, setErr] = useState<unknown>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null);
    if (f.password !== f.confirm) return setErr(new Error("Le due password non coincidono"));
    try { const u = await post("/api/auth/change-password", { current: f.current, password: f.password }); qc.setQueryData(["me"], u); nav(u.role === "customer" ? "/account" : "/admin"); }
    catch (x) { setErr(x); }
  };
  return (
    <AuthCard title="Imposta una nuova password">
      <p className="mb-4 text-center text-sm text-slate-600">Stai usando una password temporanea. Per sicurezza scegline una nuova prima di continuare.</p>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Password temporanea"><input type="password" autoComplete="current-password" className="input" required value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} /></Field>
        <Field label="Nuova password" hint="Almeno 8 caratteri"><input type="password" minLength={8} autoComplete="new-password" className="input" required value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
        <Field label="Ripeti la nuova password"><input type="password" minLength={8} autoComplete="new-password" className="input" required value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} /></Field>
        <ErrorBox error={err} />
        <button className="btn-primary w-full">Salva e continua</button>
      </form>
    </AuthCard>
  );
}

export function VerifyEmailPage() {
  const token = new URLSearchParams(window.location.search).get("token") || "";
  const [state, setState] = useState<"wait" | "ok" | "err">("wait");
  const [msg, setMsg] = useState("");
  useEffect(() => { post("/api/auth/verify-email", { token }).then(() => setState("ok")).catch((e) => { setState("err"); setMsg(e.message); }); }, [token]);
  return (
    <AuthCard title="Verifica email">
      <p className="text-center text-sm">{state === "wait" ? "Verifica in corso…" : state === "ok" ? "Indirizzo email verificato, grazie!" : msg}</p>
      <div className="mt-4 text-center"><Link href="/account" className="btn-primary">Vai alla tua area</Link></div>
    </AuthCard>
  );
}
