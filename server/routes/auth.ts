import { Router } from "express";
import rateLimit from "express-rate-limit";
import crypto from "node:crypto";
import { z } from "zod";
import { and, eq, gt, sql, or } from "drizzle-orm";
import { db } from "../db";
import { users, loginLog } from "../../shared/schema";
import { hashPassword, verifyPassword, needsRehash, publicUser, requireAuth, revokeSessions, isStaff, STAFF_SESSION_MS, CUSTOMER_SESSION_MS } from "../auth";
import { audit } from "../services/audit";
import { ensureCard } from "../services/loyalty";
import { sendTemplate } from "../services/email";
import { recordConsent, currentPolicyVersion, registrationPolicyVersion } from "../services/consents";
import { notifyStaff } from "../services/notify";
import { h, HttpError } from "../util";
import multer from "multer";
import { registrationSchema } from "../../shared/customer-booking";
import { dogs, dogPhotos } from "../../shared/schema";
import { storeDogPhoto, deleteStored } from "../services/storage";
import { validateCustomFields } from "./account";

const r = Router();
const limiter = rateLimit({ windowMs: 15 * 60_000, limit: 20, standardHeaders: true, legacyHeaders: false, message: { error: "Troppi tentativi, riprova tra qualche minuto" } });
const MAX_FAILS = 5, LOCK_MIN = 15;
const registrationUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1 } });

const password = z.string().min(8, "almeno 8 caratteri").max(128);
const base = () => process.env.PUBLIC_URL || "";
const token = () => crypto.randomBytes(32).toString("hex");
const sha = (t: string) => crypto.createHash("sha256").update(t).digest("hex");

async function sendVerification(u: { id: number; email: string; firstName: string }) {
  const t = token();
  await db.update(users).set({ emailVerifyToken: sha(t) }).where(eq(users.id, u.id));
  await sendTemplate("verifica_email", u.email, { nome: u.firstName, link: `${base()}/verifica-email?token=${t}` }, { userId: u.id, cta: { label: "Verifica email", url: `${base()}/verifica-email?token=${t}` } });
}

r.post("/register", limiter, registrationUpload.single("photo"), h(async (req, res) => {
  let payload: unknown = req.body;
  if (typeof req.body?.payload === "string") {
    try { payload = JSON.parse(req.body.payload); } catch { throw new HttpError(400, "Dati di registrazione non validi"); }
  }
  const d = registrationSchema.parse(payload);
  if (!req.file) throw new HttpError(400, "Carica la foto del tuo cane per completare la scheda");
  const [exists] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${d.email}`);
  if (exists) throw new HttpError(409, "Esiste già un account con questa email");
  const { password: pw, dog, ...data } = d;
  dog.customFields = await validateCustomFields(dog.customFields);
  const [privacyVersion, termsVersion] = await Promise.all([
    registrationPolicyVersion("privacy-policy"), registrationPolicyVersion("condizioni-del-servizio"),
  ]);
  const stored = await storeDogPhoto(req.file.buffer, req.file.mimetype);
  let user;
  try { user = await db.transaction(async (tx) => {
    const [u] = await tx.insert(users).values({
      ...data, passwordHash: await hashPassword(pw), role: "customer", commPush: false, commEmail: true,
      commWhatsapp: d.consentMarketing, consentDate: new Date(), unsubscribeToken: crypto.randomBytes(24).toString("hex"),
    }).returning();
    const [pet] = await tx.insert(dogs).values({ ...dog, ownerId: u.id }).returning();
    await tx.insert(dogPhotos).values({ dogId: pet.id, storageKey: stored.key });
    await tx.update(dogs).set({ photoUrl: `/api/account/dogs/${pet.id}/photo` }).where(eq(dogs.id, pet.id));
    // Nessun collegamento automatico a contatti non verificati.
    await recordConsent(tx, { userId: u.id, kind: "privacy", granted: true, proof: "presa_visione_informativa_alla_registrazione", source: "registrazione", req, policyVersion: privacyVersion });
    await recordConsent(tx, { userId: u.id, kind: "condizioni", granted: true, proof: "accettazione_condizioni_servizio", source: "registrazione", req, policyVersion: termsVersion });
    await recordConsent(tx, { userId: u.id, kind: "marketing", granted: d.consentMarketing, source: "registrazione", req, policyVersion: await currentPolicyVersion("marketing") });
    await ensureCard(u.id, tx);
    return u;
  }); } catch (error) { await deleteStored(stored.key); throw error; }
  await new Promise<void>((resolve, reject) => req.session.regenerate(error => error ? reject(error) : resolve()));
  req.session.userId = user.id; req.session.sv = user.sessionVersion;
  await audit(req, "register", "user", user.id);
  await notifyStaff("clienti", { title: "Nuovo cliente registrato", body: `${user.firstName} ${user.lastName} si è registrato.`, url: `/admin/clienti/${user.id}` });
  await sendTemplate("registrazione", user.email, { nome: user.firstName }, { userId: user.id, cta: { label: "Vai alla tua area", url: `${base()}/account` } });
  await sendVerification(user);
  res.status(201).json(publicUser(user));
}));

/** Login con email oppure username (es. "Admin"), con blocco dopo tentativi falliti e registro accessi. */
r.post("/login", limiter, h(async (req, res) => {
  const { login, password: pw } = z.object({ login: z.string().trim().min(1).max(255), password: z.string().max(200) })
    .or(z.object({ email: z.string().trim().min(1), password: z.string() }).transform((x) => ({ login: x.email, password: x.password }))).parse(req.body);
  const l = login.toLowerCase();
  const [u] = await db.select().from(users).where(or(sql`lower(${users.email}) = ${l}`, sql`lower(${users.username}) = ${l}`));
  const log = (success: boolean, reason?: string) => db.insert(loginLog).values({ userId: u?.id ?? null, login: login.slice(0, 255), success, reason, ip: String(req.ip || "").slice(0, 64), userAgent: String(req.get("user-agent") || "").slice(0, 255) });
  if (u?.lockedUntil && u.lockedUntil > new Date()) {
    await log(false, "bloccato");
    throw new HttpError(429, `Account temporaneamente bloccato per troppi tentativi. Riprova dopo le ${u.lockedUntil.toLocaleTimeString("it-IT", { timeZone: "Europe/Rome", hour: "2-digit", minute: "2-digit" })}.`);
  }
  if (!u || !u.active || !(await verifyPassword(pw, u.passwordHash))) {
    if (u) {
      const fails = u.failedLogins + 1;
      await db.update(users).set({ failedLogins: fails >= MAX_FAILS ? 0 : fails, lockedUntil: fails >= MAX_FAILS ? new Date(Date.now() + LOCK_MIN * 60_000) : null }).where(eq(users.id, u.id));
    }
    await log(false, !u ? "utente_inesistente" : !u.active ? "disattivato" : "password_errata");
    throw new HttpError(401, "Credenziali non corrette");
  }
  await new Promise<void>((ok, ko) => req.session.regenerate((e) => (e ? ko(e) : ok())));
  req.session.userId = u.id; req.session.sv = u.sessionVersion;
  req.session.cookie.maxAge = isStaff(u) ? STAFF_SESSION_MS : CUSTOMER_SESSION_MS;
  const patch: any = { lastLoginAt: new Date(), failedLogins: 0, lockedUntil: null };
  if (needsRehash(u.passwordHash)) patch.passwordHash = await hashPassword(pw);
  await db.update(users).set(patch).where(eq(users.id, u.id));
  await log(true);
  if (isStaff(u)) await audit(req, "login_staff", "user", u.id);
  res.json(publicUser(u));
}));

r.post("/logout", (req, res) => {
  req.session.destroy(() => { res.clearCookie("dp.sid"); res.json({ ok: true }); });
});

/** Esci da tutti i dispositivi */
r.post("/logout-all", requireAuth, h(async (req, res) => {
  await revokeSessions(req.user!.id);
  await audit(req, "sessions_revoked", "user", req.user!.id);
  res.clearCookie("dp.sid"); res.json({ ok: true });
}));

r.get("/me", (req, res) => { res.set("Cache-Control", "no-store"); res.json(req.user ? publicUser(req.user) : null); });

r.post("/forgot-password", limiter, h(async (req, res) => {
  const { login } = z.object({ login: z.string().trim().toLowerCase().min(2) }).or(z.object({ email: z.string().trim().toLowerCase() }).transform((x) => ({ login: x.email }))).parse(req.body);
  const [u] = await db.select().from(users).where(or(sql`lower(${users.email}) = ${login}`, sql`lower(${users.username}) = ${login}`));
  if (u && u.active) {
    const t = token();
    await db.update(users).set({ resetToken: sha(t), resetExpires: new Date(Date.now() + 3600_000) }).where(eq(users.id, u.id));
    const url = `${base()}/reset-password?token=${t}`;
    await sendTemplate("recupero_password", u.email, { nome: u.firstName, link: url }, { userId: u.id, cta: { label: "Scegli una nuova password", url } });
  }
  res.json({ ok: true }); // risposta identica in ogni caso: non rivela se l'account esiste
}));

r.post("/reset-password", limiter, h(async (req, res) => {
  const { token: t, password: pw } = z.object({ token: z.string().min(20), password }).parse(req.body);
  const [u] = await db.select().from(users).where(and(eq(users.resetToken, sha(t)), gt(users.resetExpires, new Date())));
  if (!u) throw new HttpError(400, "Link scaduto o non valido");
  await db.update(users).set({ passwordHash: await hashPassword(pw), resetToken: null, resetExpires: null, mustChangePassword: false, failedLogins: 0, lockedUntil: null, updatedAt: new Date() }).where(eq(users.id, u.id));
  await revokeSessions(u.id);
  await audit(req, "password_reset", "user", u.id);
  res.json({ ok: true });
}));

r.post("/change-password", requireAuth, h(async (req, res) => {
  const { current, password: pw } = z.object({ current: z.string(), password }).parse(req.body);
  if (!(await verifyPassword(current, req.user!.passwordHash))) throw new HttpError(400, "Password attuale non corretta");
  if (current === pw) throw new HttpError(400, "La nuova password deve essere diversa da quella attuale");
  await db.update(users).set({ passwordHash: await hashPassword(pw), mustChangePassword: false, updatedAt: new Date() }).where(eq(users.id, req.user!.id));
  // chiude le altre sessioni e mantiene questa
  await revokeSessions(req.user!.id);
  const [u] = await db.select().from(users).where(eq(users.id, req.user!.id));
  await new Promise<void>((ok, ko) => req.session.regenerate((e) => (e ? ko(e) : ok())));
  req.session.userId = u.id; req.session.sv = u.sessionVersion;
  await audit(req, "password_change", "user", u.id);
  res.json(publicUser(u));
}));

r.post("/verify-email", limiter, h(async (req, res) => {
  const { token: t } = z.object({ token: z.string().min(20) }).parse(req.body);
  const [u] = await db.update(users).set({ emailVerifiedAt: new Date(), emailVerifyToken: null }).where(eq(users.emailVerifyToken, sha(t))).returning();
  if (!u) throw new HttpError(400, "Link non valido o già utilizzato");
  res.json({ ok: true });
}));

r.post("/resend-verification", requireAuth, limiter, h(async (req, res) => {
  if (req.user!.emailVerifiedAt) return res.json({ ok: true });
  await sendVerification(req.user!);
  res.json({ ok: true });
}));

export default r;
