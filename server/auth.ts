import type { Request, Response, NextFunction, Express } from "express";
import session from "express-session";
import connectPg from "connect-pg-simple";
import { hash as argonHash, verify as argonVerify } from "@node-rs/argon2";
import bcrypt from "bcryptjs";
import { eq, sql } from "drizzle-orm";
import { db, pool } from "./db";
import { users, type User } from "../shared/schema";
import { OPERATOR_DEFAULT_PERMS, type Permission } from "../shared/constants";

declare module "express-session" {
  interface SessionData { userId?: number; sv?: number }
}
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express { interface Request { user?: User } }
}

export const STAFF_SESSION_MS = 1000 * 60 * 60 * 12;      // personale: 12 ore di inattività
export const CUSTOMER_SESSION_MS = 1000 * 60 * 60 * 24 * 30; // clienti: 30 giorni

export function setupSession(app: Express) {
  const PgStore = connectPg(session);
  if (!process.env.SESSION_SECRET && process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET mancante: impostalo nei Secrets di Replit.");
  }
  app.set("trust proxy", 1);
  app.use(session({
    store: new PgStore({ pool, tableName: "session", createTableIfMissing: false, pruneSessionInterval: 60 * 60 }),
    name: "dp.sid",
    secret: process.env.SESSION_SECRET || "dev-secret-non-usare-in-produzione",
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: CUSTOMER_SESSION_MS },
  }));

  // carica l'utente della sessione; le sessioni revocate (session_version cambiata) vengono chiuse
  app.use(async (req, _res, next) => {
    if (!req.session.userId || !req.path.startsWith("/api")) return next();
    try {
      const [u] = await db.select().from(users).where(eq(users.id, req.session.userId));
      if (u && u.active && (req.session.sv ?? 1) === u.sessionVersion) req.user = u;
      else { req.session.userId = undefined; req.session.sv = undefined; }
    } catch (e) { return next(e); }
    next();
  });

  // cambio password obbligatorio: finché non avviene, sono consentite solo le API di autenticazione
  app.use("/api", (req, res, next) => {
    if (req.user?.mustChangePassword && !req.path.startsWith("/auth/") && !req.path.startsWith("/public/")) {
      return res.status(403).json({ error: "Devi cambiare la password temporanea prima di continuare", code: "MUST_CHANGE_PASSWORD" });
    }
    next();
  });
}

/** Hash Argon2id (parametri OWASP). */
export const hashPassword = (pw: string) => argonHash(pw, { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 });

/** Verifica Argon2id; accetta anche eventuali hash bcrypt precedenti (che vengono poi aggiornati). */
export async function verifyPassword(pw: string, stored: string) {
  if (stored.startsWith("$2")) return bcrypt.compare(pw, stored);
  try { return await argonVerify(stored, pw); } catch { return false; }
}
export const needsRehash = (stored: string) => !stored.startsWith("$argon2id$");

export function publicUser(u: User) {
  const { passwordHash, resetToken, resetExpires, emailVerifyToken, unsubscribeToken, failedLogins, lockedUntil, sessionVersion, ...rest } = u;
  return rest;
}

export const isStaff = (u?: User) => !!u && (u.role === "admin" || u.role === "manager" || u.role === "operator");

export function hasPerm(u: User | undefined, perm: Permission) {
  if (!u) return false;
  if (u.role === "admin") return true;
  if (u.role === "operator" && OPERATOR_DEFAULT_PERMS.includes(perm)) return true;
  if (u.role === "manager" || u.role === "operator") return (u.permissions || []).includes(perm);
  return false;
}
export const hasAny = (u: User | undefined, ...perms: Permission[]) => perms.some((p) => hasPerm(u, p));

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: "Accesso richiesto" });
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.user?.role !== "admin") return res.status(403).json({ error: "Solo l'amministratore può eseguire questa operazione" });
  next();
}

/** Richiede almeno uno dei permessi indicati. */
export function requirePerm(...perms: Permission[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: "Accesso richiesto" });
    if (!hasAny(req.user, ...perms)) return res.status(403).json({ error: "Permesso negato" });
    next();
  };
}

/** Revoca tutte le sessioni di un utente (cambio password, disattivazione, "esci da tutti i dispositivi"). */
export async function revokeSessions(userId: number) {
  await db.update(users).set({ sessionVersion: sql`${users.sessionVersion} + 1` }).where(eq(users.id, userId));
  await pool.query(`DELETE FROM "session" WHERE (sess->>'userId')::int = $1`, [userId]);
}

/** Protezione CSRF: per le richieste che modificano dati l'origine deve essere il sito stesso. */
export function csrfGuard(req: Request, res: Response, next: NextFunction) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method) || req.originalUrl.startsWith("/api/webhooks")) return next();
  const origin = req.get("origin") || req.get("referer");
  if (!origin) return req.get("x-requested-with") === "fetch" ? next() : res.status(403).json({ error: "Richiesta non valida (origine mancante)" });
  try {
    const o = new URL(origin);
    const allowed = new Set([req.get("host"), process.env.PUBLIC_URL ? new URL(process.env.PUBLIC_URL).host : null].filter(Boolean));
    if (allowed.has(o.host)) return next();
  } catch { /* origine non valida */ }
  return res.status(403).json({ error: "Richiesta non valida (origine non consentita)" });
}
