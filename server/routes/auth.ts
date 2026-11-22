import { Router } from "express";
import rateLimit from "express-rate-limit";
import crypto from "node:crypto";
import { z } from "zod";
import { and, eq, gt, sql } from "drizzle-orm";
import { db } from "../db";
import { users, privacyContacts } from "../../shared/schema";
import { hashPassword, verifyPassword, publicUser, requireAuth } from "../auth";
import { audit } from "../services/audit";
import { ensureCard } from "../services/loyalty";
import { sendEmail, emailLayout, p } from "../services/email";
import { notifyStaff } from "../services/notify";
import { h, HttpError, zOptStr, zOptDay } from "../util";

const r = Router();
const limiter = rateLimit({ windowMs: 15 * 60_000, limit: 20, standardHeaders: true, legacyHeaders: false, message: { error: "Troppi tentativi, riprova tra qualche minuto" } });

const password = z.string().min(8, "almeno 8 caratteri").max(128);

const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email("email non valida").max(255),
  password,
  firstName: z.string().trim().min(1, "obbligatorio").max(100),
  lastName: z.string().trim().min(1, "obbligatorio").max(100),
  phone: z.string().trim().min(6, "telefono obbligatorio").max(40),
  address: zOptStr(), city: zOptStr(120), province: zOptStr(10), cap: zOptStr(10), country: zOptStr(80),
  birthDate: zOptDay,
  consentPrivacy: z.literal(true, { errorMap: () => ({ message: "accettazione dell'informativa privacy obbligatoria" }) }),
  consentMarketing: z.boolean().default(false),
});

r.post("/register", limiter, h(async (req, res) => {
  const d = registerSchema.parse(req.body);
  const [exists] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${d.email}`);
  if (exists) throw new HttpError(409, "Esiste già un account con questa email");
  const user = await db.transaction(async (tx) => {
    const [u] = await tx.insert(users).values({
      ...d, email: d.email, passwordHash: await hashPassword(d.password), role: "customer", consentDate: new Date(),
    }).returning();
    // collega l'eventuale contatto privacy importato in precedenza
    await tx.update(privacyContacts).set({ linkedUserId: u.id }).where(sql`lower(${privacyContacts.email}) = ${d.email}`);
    await ensureCard(u.id, tx);
    return u;
  });
  req.session.userId = user.id;
  await audit(req, "register", "user", user.id);
  await notifyStaff("clienti", { title: "Nuovo cliente registrato", body: `${user.firstName} ${user.lastName} si è registrato.`, url: `/admin/clienti/${user.id}` });
  const base = process.env.PUBLIC_URL || "";
  sendEmail(user.email, "Benvenuto in Dog's Planet!", emailLayout("Benvenuto!", p(`Ciao ${user.firstName}, il tuo account è attivo. Ora puoi registrare i tuoi cani e richiedere la prenotazione on line.`), { label: "Vai alla tua area", url: `${base}/account` }), "welcome");
  res.status(201).json(publicUser(user));
}));

r.post("/login", limiter, h(async (req, res) => {
  const { email, password: pw } = z.object({ email: z.string().trim().toLowerCase(), password: z.string() }).parse(req.body);
  const [u] = await db.select().from(users).where(sql`lower(${users.email}) = ${email}`);
  if (!u || !u.active || !(await verifyPassword(pw, u.passwordHash))) {
    await audit(req, "login_failed", "user", u?.id ?? null, { email });
    throw new HttpError(401, "Email o password non corretti");
  }
  await new Promise<void>((ok, ko) => req.session.regenerate((e) => (e ? ko(e) : ok())));
  req.session.userId = u.id;
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, u.id));
  res.json(publicUser(u));
}));

r.post("/logout", (req, res) => {
  req.session.destroy(() => { res.clearCookie("dp.sid"); res.json({ ok: true }); });
});

r.get("/me", (req, res) => { res.json(req.user ? publicUser(req.user) : null); });

r.post("/forgot-password", limiter, h(async (req, res) => {
  const { email } = z.object({ email: z.string().trim().toLowerCase().email() }).parse(req.body);
  const [u] = await db.select().from(users).where(sql`lower(${users.email}) = ${email}`);
  if (u && u.active) {
    const token = crypto.randomBytes(32).toString("hex");
    const hash = crypto.createHash("sha256").update(token).digest("hex");
    await db.update(users).set({ resetToken: hash, resetExpires: new Date(Date.now() + 3600_000) }).where(eq(users.id, u.id));
    const url = `${process.env.PUBLIC_URL || ""}/reset-password?token=${token}`;
    await sendEmail(u.email, "Reimposta la password", emailLayout("Reimposta la password", p("Hai richiesto di reimpostare la password. Il link è valido per 60 minuti."), { label: "Scegli una nuova password", url }), "reset");
  }
  res.json({ ok: true }); // risposta identica in ogni caso: non rivela se l'email esiste
}));

r.post("/reset-password", limiter, h(async (req, res) => {
  const { token, password: pw } = z.object({ token: z.string().min(20), password }).parse(req.body);
  const hash = crypto.createHash("sha256").update(token).digest("hex");
  const [u] = await db.select().from(users).where(and(eq(users.resetToken, hash), gt(users.resetExpires, new Date())));
  if (!u) throw new HttpError(400, "Link scaduto o non valido");
  await db.update(users).set({ passwordHash: await hashPassword(pw), resetToken: null, resetExpires: null, updatedAt: new Date() }).where(eq(users.id, u.id));
  await audit(req, "password_reset", "user", u.id);
  res.json({ ok: true });
}));

r.post("/change-password", requireAuth, h(async (req, res) => {
  const { current, password: pw } = z.object({ current: z.string(), password }).parse(req.body);
  if (!(await verifyPassword(current, req.user!.passwordHash))) throw new HttpError(400, "Password attuale non corretta");
  await db.update(users).set({ passwordHash: await hashPassword(pw), updatedAt: new Date() }).where(eq(users.id, req.user!.id));
  await audit(req, "password_change", "user", req.user!.id);
  res.json({ ok: true });
}));

export default r;
