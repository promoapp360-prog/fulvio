import { Router } from "express";
import { z } from "zod";
import { and, eq, sql, lt, isNotNull, gte, inArray } from "drizzle-orm";
import { db } from "../../db";
import { promotions, campaigns, users, appointments, loyaltyCards } from "../../../shared/schema";
import { requirePerm } from "../../auth";
import { crud } from "../../crud";
import { audit } from "../../services/audit";
import { sendEmail, emailLayout, p } from "../../services/email";
import { pushToUsers } from "../../services/push";
import { h, HttpError, id, zOptStr, zOptDay } from "../../util";
import { todayRome } from "../../time";

const r = Router();

r.use("/promotions", crud({
  table: promotions, entity: "promotion", perm: "marketing", search: ["title", "code"],
  schema: z.object({
    title: z.string().trim().min(1).max(160), description: zOptStr(4000),
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{3,40}$/, "codice non valido").nullable().optional().or(z.literal("").transform(() => null)),
    discountType: z.enum(["percent", "amount", "points"]), discountValue: z.number().int().min(0),
    appliesTo: z.enum(["tutto", "servizi", "shop"]).default("tutto"), audience: z.enum(["tutti", "compleanno", "inattivi", "fidelity"]).default("tutti"),
    startsAt: zOptDay, endsAt: zOptDay, showOnSite: z.boolean().default(false), active: z.boolean().default(true),
  }),
}));

r.use("/campaigns", crud({
  table: campaigns, entity: "campaign", perm: "marketing", search: ["title", "subject"],
  schema: z.object({
    title: z.string().trim().min(1).max(160), subject: z.string().trim().min(1).max(200), body: z.string().trim().min(1).max(20_000),
    channel: z.enum(["email", "push", "entrambi"]).default("email"), audience: z.enum(["marketing", "tutti", "compleanno", "inattivi", "fidelity"]).default("marketing"),
    promotionId: z.number().int().positive().nullable().optional(),
  }),
}));

/**
 * Destinatari. Le comunicazioni promozionali vanno SOLO a chi ha dato il consenso marketing;
 * "tutti" (comunicazioni di servizio) include i clienti attivi con preferenza email/push attiva.
 */
async function audienceUsers(audience: string) {
  const base = and(eq(users.role, "customer"), eq(users.active, true));
  const mkt = audience === "tutti" ? base : and(base, eq(users.consentMarketing, true));
  switch (audience) {
    case "compleanno": {
      const mm = todayRome().slice(5, 7);
      return db.select().from(users).where(and(mkt, isNotNull(users.birthDate), sql`to_char(${users.birthDate}, 'MM') = ${mm}`));
    }
    case "inattivi": {
      const limit = new Date(Date.now() - 1000 * 3600 * 24 * 90);
      return db.select().from(users).where(and(mkt, sql`not exists (select 1 from appointments a where a.customer_id = ${users.id} and a.start_at >= ${limit})`));
    }
    case "fidelity":
      return db.select().from(users).where(and(mkt, sql`exists (select 1 from loyalty_cards c where c.customer_id = ${users.id} and c.points > 0)`));
    default:
      return db.select().from(users).where(mkt);
  }
}

r.get("/campaigns/:id/preview", requirePerm("marketing"), h(async (req, res) => {
  const [c] = await db.select().from(campaigns).where(eq(campaigns.id, id(req.params.id)));
  if (!c) throw new HttpError(404, "Campagna non trovata");
  const list = await audienceUsers(c.audience);
  res.json({ recipients: list.length, html: emailLayout(c.subject, c.body.split(/\n{2,}/).map((x) => p(x)).join("")) });
}));

r.post("/campaigns/:id/send", requirePerm("marketing"), h(async (req, res) => {
  const cid = id(req.params.id);
  // stato aggiornato in modo atomico: impossibile inviare due volte la stessa campagna
  const [c] = await db.update(campaigns).set({ status: "inviata", sentAt: new Date() }).where(and(eq(campaigns.id, cid), eq(campaigns.status, "bozza"))).returning();
  if (!c) throw new HttpError(400, "Campagna già inviata o inesistente");
  const list = await audienceUsers(c.audience);
  const html = emailLayout(c.subject, c.body.split(/\n{2,}/).map((x) => p(x)).join(""), { label: "Visita Dog's Planet", url: (process.env.PUBLIC_URL || "") + "/" });
  let sent = 0;
  if (c.channel !== "push") {
    for (const u of list.filter((x) => x.commEmail)) { if (await sendEmail(u.email, c.subject, html, `campaign_${c.id}`)) sent++; }
  }
  if (c.channel !== "email") sent += await pushToUsers(list.filter((x) => x.commPush).map((x) => x.id), { title: c.subject, body: c.body.slice(0, 140), url: "/" });
  await db.update(campaigns).set({ sentCount: sent }).where(eq(campaigns.id, cid));
  await audit(req, "campaign_send", "campaign", cid, { recipients: list.length, sent });
  res.json({ recipients: list.length, sent });
}));

export default r;
