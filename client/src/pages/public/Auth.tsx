import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { Logo } from "@/components/brand";
import { Field, Check, ErrorBox, useToast } from "@/components/ui";
import { post } from "@/lib/api";

function nextUrl(fallback: string) {
  const n = new URLSearchParams(window.location.search).get("next");
  return n && n.startsWith("/") && !n.startsWith("//") ? n : fallback;
}

function AuthCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-gradient-to-b from-brand-sky to-white py-12">
      <div className="mx-auto w-full max-w-md px-4">
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
  const [f, setF] = useState({ email: "", password: "" });
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      const u = await post("/api/auth/login", f);
      qc.setQueryData(["me"], u);
      nav(nextUrl(u.role === "customer" ? "/account" : "/admin"));
    } catch (x) { setErr(x); } finally { setBusy(false); }
  };
  return (
    <AuthCard title="Accedi">
      <form onSubmit={submit} className="space-y-3">
        <Field label="Email"><input type="email" autoComplete="email" className="input" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Password"><input type="password" autoComplete="current-password" className="input" required value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
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
  const [f, setF] = useState({ firstName: "", lastName: "", email: "", phone: "", password: "", address: "", city: "", province: "", cap: "", birthDate: "", consentPrivacy: false, consentMarketing: false });
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      const u = await post("/api/auth/register", { ...f, birthDate: f.birthDate || null });
      qc.setQueryData(["me"], u);
      toast("Benvenuto in Dog's Planet! Ora registra il tuo cane.");
      nav(nextUrl("/account/cani?nuovo=1"));
    } catch (x) { setErr(x); } finally { setBusy(false); }
  };
  return (
    <AuthCard title="Crea il tuo account">
      <form onSubmit={submit} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nome *"><input className="input" required autoComplete="given-name" value={f.firstName} onChange={set("firstName")} /></Field>
          <Field label="Cognome *"><input className="input" required autoComplete="family-name" value={f.lastName} onChange={set("lastName")} /></Field>
        </div>
        <Field label="Email *"><input type="email" className="input" required autoComplete="email" value={f.email} onChange={set("email")} /></Field>
        <Field label="Telefono *"><input type="tel" className="input" required autoComplete="tel" value={f.phone} onChange={set("phone")} /></Field>
        <Field label="Password *" hint="Almeno 8 caratteri"><input type="password" className="input" required minLength={8} autoComplete="new-password" value={f.password} onChange={set("password")} /></Field>
        <details className="rounded-xl bg-slate-50 p-3 text-sm">
          <summary className="cursor-pointer font-bold text-brand-navy">Dati facoltativi (indirizzo, compleanno)</summary>
          <div className="mt-3 space-y-3">
            <Field label="Indirizzo"><input className="input" autoComplete="street-address" value={f.address} onChange={set("address")} /></Field>
            <div className="grid grid-cols-3 gap-2">
              <Field label="Comune" className="col-span-3 sm:col-span-1"><input className="input" value={f.city} onChange={set("city")} /></Field>
              <Field label="Prov."><input className="input" maxLength={4} value={f.province} onChange={set("province")} /></Field>
              <Field label="CAP"><input className="input" maxLength={10} value={f.cap} onChange={set("cap")} /></Field>
            </div>
            <Field label="Data di nascita" hint="Per ricevere le promozioni di compleanno"><input type="date" className="input" value={f.birthDate} onChange={set("birthDate")} /></Field>
          </div>
        </details>
        <Check checked={f.consentPrivacy} onChange={(v) => setF({ ...f, consentPrivacy: v })} label={<>Ho letto e accetto la <Link href="/privacy-policy" className="underline">Privacy Policy</Link> e le <Link href="/condizioni-del-servizio" className="underline">Condizioni del servizio</Link> *</>} />
        <Check checked={f.consentMarketing} onChange={(v) => setF({ ...f, consentMarketing: v })} label="Desidero ricevere promozioni e novità da Dog's Planet (facoltativo)" />
        <ErrorBox error={err} />
        <button className="btn-primary w-full" disabled={busy || !f.consentPrivacy}>Registrati</button>
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
        <form onSubmit={async (e) => { e.preventDefault(); try { await post("/api/auth/forgot-password", { email }); setSent(true); } catch (x) { setErr(x); } }} className="space-y-3">
          <Field label="Email"><input type="email" className="input" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
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
