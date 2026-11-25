import { Router } from "express";
import { z } from "zod";
import { and, eq, sql, lt, isNotNull, gte, inArray } from "drizzle-orm";
import { db } from "../../db";
import { promotions, campaigns, users, appointments, loyaltyCards } from "../../../shared/schema";
import { requirePerm } from "../../auth";
import { crud } from "../../crud";
import { audit } from "../../services/audit";
import { enqueueEmail, emailLayout, p } from "../../services/email";
import { pushToUsers } from "../../services/push";
import { sendOneSignalCampaign } from "../../services/onesignal";
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

const filtersSchema = z.object({
  regulars: z.boolean().optional(),          // clienti abituali: almeno N visite negli ultimi 12 mesi
  minVisits: z.coerce.number().int().min(1).optional(),
  maxVisits: z.coerce.number().int().min(0).optional(),
  inactiveDays: z.coerce.number().int().min(1).optional(),
  serviceId: z.coerce.number().int().positive().optional(),
  dogSize: z.enum(["piccola", "media", "grande", "gigante"]).optional(),
  dogBreed: z.string().max(80).optional(),
  coatKnots: z.boolean().optional(),
  birthdayMonth: z.boolean().optional(),
  city: z.string().max(80).optional(),
}).partial();

r.use("/campaigns", crud({
  table: campaigns, entity: "campaign", perm: "marketing", search: ["title", "subject"],
  schema: z.object({
    title: z.string().trim().min(1).max(160), subject: z.string().trim().min(1).max(200), body: z.string().trim().min(1).max(20_000),
    channel: z.enum(["email", "push", "entrambi"]).default("email"), audience: z.enum(["marketing", "servizio"]).default("marketing"),
    promotionId: z.number().int().positive().nullable().optional(), filters: filtersSchema.default({}),
  }),
}));

/**
 * Destinatari segmentati. Le comunicazioni promozionali vanno SOLO a chi ha un consenso marketing valido (non revocato);
 * "servizio" = comunicazioni amministrative a tutti i clienti attivi (senza contenuti promozionali).
 */
async function audienceUsers(audience: string, filters: z.infer<typeof filtersSchema>) {
  const conds: any[] = [eq(users.role, "customer"), eq(users.active, true)];
  if (audience !== "servizio") conds.push(eq(users.consentMarketing, true));
  const f = filters || {};
  const visits = sql`(select count(*) from appointments a where a.customer_id = ${users.id} and a.status = 'completata' and a.start_at >= now() - interval '12 months')`;
  if (f.regulars) conds.push(sql`${visits} >= ${f.minVisits ?? 4}`);
  else if (f.minVisits) conds.push(sql`${visits} >= ${f.minVisits}`);
  if (f.maxVisits != null) conds.push(sql`${visits} <= ${f.maxVisits}`);
  if (f.inactiveDays) conds.push(sql`not exists (select 1 from appointments a where a.customer_id = ${users.id} and a.start_at >= now() - make_interval(days => ${f.inactiveDays}) and a.status in ('completata','confermata'))`);
  if (f.serviceId) conds.push(sql`exists (select 1 from appointments a where a.customer_id = ${users.id} and a.status = 'completata' and a.service_id = ${f.serviceId})`);
  if (f.dogSize) conds.push(sql`exists (select 1 from dogs d where d.owner_id = ${users.id} and not d.archived and d.size = ${f.dogSize})`);
  if (f.dogBreed) conds.push(sql`exists (select 1 from dogs d where d.owner_id = ${users.id} and not d.archived and d.breed ilike ${"%" + f.dogBreed + "%"})`);
  if (f.coatKnots) conds.push(sql`exists (select 1 from dogs d where d.owner_id = ${users.id} and not d.archived and d.coat_knots)`);
  if (f.birthdayMonth) conds.push(sql`${users.birthDate} is not null and to_char(${users.birthDate}, 'MM') = ${todayRome().slice(5, 7)}`);
  if (f.city) conds.push(sql`${users.city} ilike ${"%" + f.city + "%"}`);
  return db.select().from(users).where(and(...conds));
}

const unsubFooter = (token: string | null) => {
  const base = process.env.PUBLIC_URL || "";
  return token ? `<br><br><a href="${base}/api/public/unsubscribe?token=${token}" style="color:#bfe9ff">Non vuoi più ricevere promozioni? Disiscriviti</a>` : "";
};

r.post("/segment-preview", requirePerm("marketing"), h(async (req, res) => {
  const d = z.object({ audience: z.enum(["marketing", "servizio"]).default("marketing"), filters: filtersSchema.default({}) }).parse(req.body);
  const list = await audienceUsers(d.audience, d.filters);
  res.json({ recipients: list.length, sample: list.slice(0, 10).map((u) => `${u.firstName} ${u.lastName}`) });
}));

r.get("/campaigns/:id/preview", requirePerm("marketing"), h(async (req, res) => {
  const [c] = await db.select().from(campaigns).where(eq(campaigns.id, id(req.params.id)));
  if (!c) throw new HttpError(404, "Campagna non trovata");
  const list = await audienceUsers(c.audience, c.filters as any);
  res.json({ recipients: list.length, html: emailLayout(c.subject, c.body.split(/\n{2,}/).map((x) => p(x)).join(""), undefined, c.audience !== "servizio" ? unsubFooter("ANTEPRIMA") : "", true) });
}));

r.post("/campaigns/:id/send", requirePerm("marketing"), h(async (req, res) => {
  const cid = id(req.params.id);
  // stato aggiornato in modo atomico: impossibile inviare due volte la stessa campagna
  const [c] = await db.update(campaigns).set({ status: "inviata", sentAt: new Date() }).where(and(eq(campaigns.id, cid), eq(campaigns.status, "bozza"))).returning();
  if (!c) throw new HttpError(400, "Campagna già inviata o inesistente");
  const list = await audienceUsers(c.audience, c.filters as any);
  const body = c.body.split(/\n{2,}/).map((x) => p(x)).join("");
  const base = process.env.PUBLIC_URL || "";
  let queued = 0;
  if (c.channel !== "push") {
    for (const u of list.filter((x) => x.commEmail || c.audience === "servizio")) {
      const html = emailLayout(c.subject, body, { label: "Visita Dog's Planet", url: base + "/" }, c.audience !== "servizio" ? unsubFooter(u.unsubscribeToken) : "");
      if (await enqueueEmail({ to: u.email, subject: c.subject, html, template: `campaign_${c.id}`, userId: u.id, dedupeKey: `campaign:${c.id}:${u.id}` })) queued++;
    }
  }
  let pushed = 0;
  if (c.channel !== "email") {
    const targets = list.filter((x) => x.commPush).map((x) => x.id);
    pushed = await pushToUsers(targets, { title: c.subject, body: c.body.slice(0, 140), url: "/" });
    pushed += await sendOneSignalCampaign(targets, c.subject, c.body.slice(0, 500), c.id);
  }
  await db.update(campaigns).set({ sentCount: queued + pushed }).where(eq(campaigns.id, cid));
  await audit(req, "campaign_send", "campaign", cid, { recipients: list.length, queued, pushed });
  res.json({ recipients: list.length, sent: queued + pushed });
}));

export default r;
