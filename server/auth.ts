import type { Request, Response, NextFunction, Express } from "express";
import session from "express-session";
import connectPg from "connect-pg-simple";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, pool } from "./db";
import { users, type User } from "../shared/schema";
import type { Permission } from "../shared/constants";

declare module "express-session" {
  interface SessionData { userId?: number }
}
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express { interface Request { user?: User } }
}

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
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 1000 * 60 * 60 * 24 * 30,
    },
  }));

  // carica l'utente della sessione (1 query per richiesta API autenticata)
  app.use(async (req, _res, next) => {
    if (!req.session.userId || !req.path.startsWith("/api")) return next();
    try {
      const [u] = await db.select().from(users).where(eq(users.id, req.session.userId));
      if (u && u.active) req.user = u; else req.session.userId = undefined;
    } catch (e) { return next(e); }
    next();
  });
}

export const hashPassword = (pw: string) => bcrypt.hash(pw, 12);
export const verifyPassword = (pw: string, hash: string) => bcrypt.compare(pw, hash);

export function publicUser(u: User) {
  const { passwordHash, resetToken, resetExpires, ...rest } = u;
  return rest;
}

export const isStaff = (u?: User) => !!u && (u.role === "admin" || u.role === "staff" || u.role === "operator");

export function hasPerm(u: User | undefined, perm: Permission) {
  if (!u) return false;
  if (u.role === "admin") return true;
  if (u.role === "operator" && (perm === "agenda" || perm === "ore")) return true;
  if (u.role === "staff" || u.role === "operator") return (u.permissions || []).includes(perm);
  return false;
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: "Accesso richiesto" });
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.user?.role !== "admin") return res.status(403).json({ error: "Solo l'amministratore può eseguire questa operazione" });
  next();
}

export function requirePerm(perm: Permission) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: "Accesso richiesto" });
    if (!hasPerm(req.user, perm)) return res.status(403).json({ error: "Permesso negato" });
    next();
  };
}
