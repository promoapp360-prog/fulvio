import { Router } from "express";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { oneSignalDevices, oneSignalMessages, users } from "../../../shared/schema";
import { requireAdmin } from "../../auth";
import { h, HttpError } from "../../util";
import { getSettings } from "../../services/settings";
import { inspectOneSignalApp, sendOneSignalManualMarketing, sendOneSignalTest } from "../../services/onesignal";

const r = Router();
r.use(requireAdmin);

r.get("/onesignal", h(async (_req, res) => {
  const [app, settings, [{ devices }], messages, counts] = await Promise.all([
    inspectOneSignalApp(), getSettings(),
    db.select({ devices: sql<number>`count(*)::int` }).from(oneSignalDevices).where(eq(oneSignalDevices.active, true)),
    db.select().from(oneSignalMessages).orderBy(desc(oneSignalMessages.createdAt)).limit(50),
    db.select({ status: oneSignalMessages.status, count: sql<number>`count(*)::int` }).from(oneSignalMessages)
      .where(sql`${oneSignalMessages.createdAt} > now() - interval '30 days'`).groupBy(oneSignalMessages.status),
  ]);
  res.json({ app, settings: settings.onesignal, activeDevices: devices, messages, counts });
}));

r.post("/onesignal/test", h(async (req, res) => {
  try {
    const result = await sendOneSignalTest(req.user!);
    res.json(result);
  } catch (error) {
    throw new HttpError(400, String((error as Error).message || "Invio di prova non riuscito").slice(0, 300));
  }
}));

r.get("/onesignal/customers", h(async (req, res) => {
  const q = String(req.query.q || "").trim().slice(0, 100);
  if (q.length < 2) return res.json([]);
  const pattern = `%${q}%`;
  const rows = await db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName, email: users.email })
    .from(users).innerJoin(oneSignalDevices, eq(users.id, oneSignalDevices.userId))
    .where(and(eq(users.active, true), eq(users.commPush, true), eq(users.consentMarketing, true), eq(oneSignalDevices.active, true),
      or(ilike(users.firstName, pattern), ilike(users.lastName, pattern), ilike(users.email, pattern))))
    .limit(20);
  res.json(rows);
}));

r.post("/onesignal/send", h(async (req, res) => {
  const d = z.object({
    userId: z.number().int().positive(),
    title: z.string().trim().min(1).max(160),
    body: z.string().trim().min(1).max(500),
  }).parse(req.body);
  try {
    const result = await sendOneSignalManualMarketing(d.userId, d.title, d.body);
    res.json(result);
  } catch (error) {
    throw new HttpError(400, String((error as Error).message || "Invio non riuscito").slice(0, 300));
  }
}));

export default r;
