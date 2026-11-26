import { Router } from "express";
import { z } from "zod";
import { asc, eq, and } from "drizzle-orm";
import { db } from "../../db";
import { services, serviceVariants, serviceSupplements, servicePricingRules, serviceCategories, operators, operatorServices, operatorShifts, operatorAbsences, resources, users } from "../../../shared/schema";
import { requirePerm } from "../../auth";
import { crud } from "../../crud";
import { audit } from "../../services/audit";
import { h, HttpError, id, slugify, zDay, zTime, zOptStr } from "../../util";
import { isValidPriceRange } from "../../../shared/service-pricing";
import { SIZES, SIZE_LABELS } from "../../../shared/constants";

const r = Router();

// ---------- servizi e listino ----------
const serviceSchema = z.object({
  name: z.string().trim().min(1).max(120), category: z.string().trim().min(1).max(80), description: zOptStr(4000),
  priceCents: z.number().int().min(0).nullable().optional(), priceFrom: z.boolean().default(true),
  pricingType: z.enum(["fisso", "da", "fascia", "orario", "percentuale", "preventivo"]).default("da"),
  priceMaxCents: z.number().int().min(0).nullable().optional(),
  species: z.enum(["cane", "gatto", "entrambi"]).default("cane"),
  imageUrl: zOptStr(1000),
  durationMin: z.coerce.number().int().min(5).max(600), bookable: z.boolean().default(true), active: z.boolean().default(true),
  visible: z.boolean().default(true), sortOrder: z.coerce.number().int().default(0), earnsPoints: z.boolean().default(true),
});
function validateServicePrice(data: { pricingType?: string; priceCents?: number | null; priceMaxCents?: number | null }) {
  if (data.pricingType === "fascia" && (data.priceMaxCents == null || !isValidPriceRange(data.priceCents, data.priceMaxCents))) {
    throw new HttpError(400, "Per una fascia di prezzo indica un minimo e un massimo coerenti.");
  }
  if (!isValidPriceRange(data.priceCents, data.priceMaxCents)) {
    throw new HttpError(400, "Il prezzo massimo deve essere uguale o superiore al minimo.");
  }
}

r.get("/services", requirePerm("servizi", "agenda_view"), h(async (_req, res) => {
  const [svcs, vars, sups, links, rules] = await Promise.all([
    db.select().from(services).orderBy(asc(services.sortOrder), asc(services.id)),
    db.select().from(serviceVariants), db.select().from(serviceSupplements), db.select().from(operatorServices),
    db.select().from(servicePricingRules).orderBy(asc(servicePricingRules.sortOrder), asc(servicePricingRules.id)),
  ]);
  res.json(svcs.map((s) => ({
    ...s, variants: vars.filter((v) => v.serviceId === s.id), supplements: sups.filter((x) => x.serviceId === s.id),
    pricingRules: rules.filter((x) => x.serviceId === s.id),
    operatorIds: links.filter((l) => l.serviceId === s.id).map((l) => l.operatorId),
  })));
}));

const pricingRuleSchema = z.object({
  size: z.enum(["mini", "piccola", "media", "grande", "gigante"]).nullable().optional(),
  coatType: z.string().trim().max(40).nullable().optional(),
  coatLength: z.enum(["corto", "medio", "lungo"]).nullable().optional(),
  pricingType: z.enum(["fisso", "da", "fascia", "orario", "percentuale", "preventivo"]),
  priceCents: z.number().int().min(0).nullable().optional(),
  priceMaxCents: z.number().int().min(0).nullable().optional(),
  percentageBasisPoints: z.number().int().min(0).max(100000).nullable().optional(),
  durationMin: z.number().int().min(5).max(600).nullable().optional(),
  active: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
});
const pricingRulesSchema = z.array(pricingRuleSchema).max(100).superRefine((rules, ctx) => {
  rules.forEach((rule, index) => {
    if (rule.pricingType === "fascia" && (rule.priceMaxCents == null || !isValidPriceRange(rule.priceCents, rule.priceMaxCents))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index], message: "La fascia deve avere un minimo e un massimo coerenti." });
    }
    if (rule.pricingType === "percentuale" && (rule.percentageBasisPoints == null || rule.percentageBasisPoints <= 0)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index, "percentageBasisPoints"], message: "Indica una percentuale maggiore di zero." });
    }
  });
});

const variantsSchema = z.array(z.object({
  size: z.enum(SIZES, { errorMap: () => ({ message: "Taglia non valida: scegli Mini, Piccola, Media, Grande o Gigante." }) }),
  priceCents: z.number({ invalid_type_error: "Indica un prezzo valido." }).int("Il prezzo deve essere espresso in centesimi interi.").min(0, "Il prezzo non può essere negativo.").nullable(),
  durationMin: z.number({ invalid_type_error: "Indica una durata valida in minuti." }).int("La durata deve essere un numero intero di minuti.").min(5, "La durata deve essere di almeno 5 minuti.").max(600, "La durata non può superare 600 minuti.").nullable(),
})).max(SIZES.length, `Puoi inserire al massimo ${SIZES.length} varianti: una per ciascuna taglia.`).superRefine((variants, ctx) => {
  const seen = new Set<string>();
  variants.forEach((variant, index) => {
    if (seen.has(variant.size)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index, "size"], message: `La taglia ${SIZE_LABELS[variant.size]} è già presente: modifica la variante esistente.` });
    seen.add(variant.size);
  });
});

async function saveServiceChildren(tx: any, serviceId: number, body: any) {
  if (body.variants) {
    const vs = variantsSchema.parse(body.variants);
    await tx.delete(serviceVariants).where(eq(serviceVariants.serviceId, serviceId));
    const keep = vs.filter((v) => v.priceCents != null || v.durationMin != null);
    if (keep.length) await tx.insert(serviceVariants).values(keep.map((v) => ({ ...v, serviceId })));
  }
  if (body.pricingRules) {
    const rules = pricingRulesSchema.parse(body.pricingRules);
    await tx.delete(servicePricingRules).where(eq(servicePricingRules.serviceId, serviceId));
    if (rules.length) await tx.insert(servicePricingRules).values(rules.map((rule) => ({ ...rule, serviceId })));
  }
  if (body.operatorIds) {
    const ids = z.array(z.number().int().positive()).parse(body.operatorIds);
    await tx.delete(operatorServices).where(eq(operatorServices.serviceId, serviceId));
    if (ids.length) await tx.insert(operatorServices).values(ids.map((operatorId) => ({ operatorId, serviceId })));
  }
}

// Categorie archiviate, non eliminate: i servizi e le richieste storiche restano consultabili.
r.get("/service-categories", requirePerm("servizi", "impostazioni"), h(async (_req, res) => {
  res.json(await db.select().from(serviceCategories).orderBy(asc(serviceCategories.sortOrder), asc(serviceCategories.id)));
}));
r.post("/service-categories", requirePerm("impostazioni"), h(async (req, res) => {
  const d = z.object({ name: z.string().trim().min(1).max(80), sortOrder: z.coerce.number().int().default(0), active: z.boolean().default(true), visible: z.boolean().default(true) }).parse(req.body);
  const [row] = await db.insert(serviceCategories).values(d).returning();
  await audit(req, "create", "service_category", row.id, d);
  res.status(201).json(row);
}));
r.patch("/service-categories/:id", requirePerm("impostazioni"), h(async (req, res) => {
  const categoryId = id(req.params.id);
  const d = z.object({ name: z.string().trim().min(1).max(80), sortOrder: z.coerce.number().int(), active: z.boolean(), visible: z.boolean() }).partial().parse(req.body);
  const row = await db.transaction(async (tx) => {
    const [old] = await tx.select().from(serviceCategories).where(eq(serviceCategories.id, categoryId));
    if (!old) throw new HttpError(404, "Categoria non trovata");
    const [updated] = await tx.update(serviceCategories).set({
      ...d,
      ...(d.active === false ? { archivedAt: new Date() } : d.active === true ? { archivedAt: null } : {}),
    }).where(eq(serviceCategories.id, categoryId)).returning();
    if (d.name && d.name !== old.name) await tx.update(services).set({ category: d.name }).where(eq(services.category, old.name));
    return updated;
  });
  await audit(req, "update", "service_category", categoryId, d);
  res.json(row);
}));
r.delete("/service-categories/:id", requirePerm("impostazioni"), h(async (req, res) => {
  const categoryId = id(req.params.id);
  const [row] = await db.update(serviceCategories).set({ active: false, visible: false, archivedAt: new Date() })
    .where(eq(serviceCategories.id, categoryId)).returning();
  if (!row) throw new HttpError(404, "Categoria non trovata");
  await audit(req, "archive", "service_category", categoryId);
  res.json({ ok: true });
}));

r.post("/services", requirePerm("impostazioni"), h(async (req, res) => {
  const d = serviceSchema.parse(req.body);
  validateServicePrice(d);
  const s = await db.transaction(async (tx) => {
    const [row] = await tx.insert(services).values({ ...d, slug: `${slugify(d.name)}-${Date.now().toString(36)}` }).returning();
    await saveServiceChildren(tx, row.id, req.body);
    return row;
  });
  await audit(req, "create", "service", s.id, d);
  res.status(201).json(s);
}));

r.patch("/services/:id", requirePerm("impostazioni"), h(async (req, res) => {
  const sid = id(req.params.id);
  const d = serviceSchema.partial().parse(req.body);
  const s = await db.transaction(async (tx) => {
    const [old] = await tx.select().from(services).where(eq(services.id, sid));
    if (!old) throw new HttpError(404, "Servizio non trovato");
    validateServicePrice({ ...old, ...d });
    const [row] = Object.keys(d).length ? await tx.update(services).set(d).where(eq(services.id, sid)).returning() : [old];
    await saveServiceChildren(tx, sid, req.body);
    return row;
  });
  await audit(req, "update", "service", sid, req.body);
  res.json(s);
}));

r.delete("/services/:id", requirePerm("impostazioni"), h(async (req, res) => {
  // Archivia sempre: appuntamenti e richieste conservano il riferimento storico.
  const sid = id(req.params.id);
  const [row] = await db.update(services).set({ active: false, visible: false, bookable: false }).where(eq(services.id, sid)).returning();
  if (!row) throw new HttpError(404, "Servizio non trovato");
  await audit(req, "archive", "service", sid);
  res.json({ ok: true });
}));

r.use("/supplements", crud({
  table: serviceSupplements, entity: "supplement", perm: "impostazioni", filters: ["serviceId"],
  beforeSave: (data, existing) => {
    const merged = { ...existing, ...data };
    if (merged.pricingType === "percentuale" && (!merged.percentageBasisPoints || merged.percentageBasisPoints <= 0)) {
      throw new HttpError(400, "Indica una percentuale maggiore di zero.");
    }
    return { ...data, requiresConfirmation: true };
  },
  schema: z.object({
    serviceId: z.number().int().positive().nullable().optional(), name: z.string().trim().min(1).max(120),
    condition: z.enum(["manuale", "nodi", "muta", "aggressivo", "esigenze"]).default("manuale"),
    conditionLabel: zOptStr(80), description: zOptStr(1000),
    priceCents: z.number().int().min(0).default(0),
    pricingType: z.enum(["fisso", "percentuale", "preventivo"]).default("fisso"),
    percentageBasisPoints: z.number().int().min(0).max(100000).nullable().optional(),
    requiresConfirmation: z.boolean().default(true),
    extraMin: z.number().int().min(0).max(240).default(0), active: z.boolean().default(true),
  }),
}));

// ---------- operatori, turni, assenze ----------
const operatorSchema = z.object({
  name: z.string().trim().min(1).max(80), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#2E8DE6"), bio: zOptStr(2000),
  hourlyRateCents: z.number().int().min(0).max(100_000).default(1000), vatNumber: zOptStr(20),
  bookableOnline: z.boolean().default(true), active: z.boolean().default(true), sortOrder: z.coerce.number().int().default(0),
  userId: z.number().int().positive().nullable().optional(),
});
const shiftsSchema = z.array(z.object({
  weekday: z.number().int().min(0).max(6), startTime: zTime, endTime: zTime,
  breakStart: zTime.nullable().optional(), breakEnd: zTime.nullable().optional(),
}).refine((s) => s.startTime < s.endTime, "l'orario di fine deve seguire l'inizio")
  .refine((s) => (!s.breakStart && !s.breakEnd) || (s.breakStart && s.breakEnd && s.breakStart < s.breakEnd), "pausa non valida")).max(30);

r.get("/operators", requirePerm("agenda_view", "personale", "servizi"), h(async (_req, res) => {
  const [ops, links, shifts] = await Promise.all([
    db.select().from(operators).orderBy(asc(operators.sortOrder), asc(operators.id)),
    db.select().from(operatorServices), db.select().from(operatorShifts).orderBy(asc(operatorShifts.weekday), asc(operatorShifts.startTime)),
  ]);
  res.json(ops.map((o) => ({ ...o, serviceIds: links.filter((l) => l.operatorId === o.id).map((l) => l.serviceId), shifts: shifts.filter((s) => s.operatorId === o.id) })));
}));

async function saveOperatorChildren(tx: any, opId: number, body: any) {
  if (body.shifts) {
    const sh = shiftsSchema.parse(body.shifts);
    await tx.delete(operatorShifts).where(eq(operatorShifts.operatorId, opId));
    if (sh.length) await tx.insert(operatorShifts).values(sh.map((s) => ({ ...s, operatorId: opId, breakStart: s.breakStart || null, breakEnd: s.breakEnd || null })));
  }
  if (body.serviceIds) {
    const ids = z.array(z.number().int().positive()).parse(body.serviceIds);
    await tx.delete(operatorServices).where(eq(operatorServices.operatorId, opId));
    if (ids.length) await tx.insert(operatorServices).values(ids.map((serviceId) => ({ operatorId: opId, serviceId })));
  }
}

r.post("/operators", requirePerm("personale"), h(async (req, res) => {
  const d = operatorSchema.parse(req.body);
  const o = await db.transaction(async (tx) => {
    const [row] = await tx.insert(operators).values(d).returning();
    await saveOperatorChildren(tx, row.id, req.body);
    return row;
  });
  await audit(req, "create", "operator", o.id, d);
  res.status(201).json(o);
}));

r.patch("/operators/:id", requirePerm("personale"), h(async (req, res) => {
  const oid = id(req.params.id);
  const d = operatorSchema.partial().parse(req.body);
  const o = await db.transaction(async (tx) => {
    const [row] = Object.keys(d).length ? await tx.update(operators).set(d).where(eq(operators.id, oid)).returning() : await tx.select().from(operators).where(eq(operators.id, oid));
    if (!row) throw new HttpError(404, "Operatore non trovato");
    await saveOperatorChildren(tx, oid, req.body);
    return row;
  });
  await audit(req, "update", "operator", oid, req.body);
  res.json(o);
}));

r.use("/absences", crud({
  table: operatorAbsences, entity: "absence", perm: "personale", filters: ["operatorId", "kind"],
  order: [{ col: "startDate", dir: "desc" }],
  schema: z.object({
    operatorId: z.number().int().positive().nullable().optional(),
    kind: z.enum(["ferie", "assenza", "chiusura", "malattia", "altro"]), startDate: zDay, endDate: zDay,
    startTime: zTime.nullable().optional().or(z.literal("").transform(() => null)), endTime: zTime.nullable().optional().or(z.literal("").transform(() => null)),
    note: zOptStr(1000),
  }),
  beforeSave: (d, ex) => {
    const s = d.startDate ?? ex?.startDate, e = d.endDate ?? ex?.endDate;
    if (s && e && e < s) throw new HttpError(400, "La data di fine deve seguire quella di inizio");
    return d;
  },
}));

r.use("/resources", crud({
  table: resources, entity: "resource", perm: "personale",
  schema: z.object({ name: z.string().trim().min(1).max(80), kind: z.string().trim().max(30).default("postazione"), active: z.boolean().default(true) }),
}));

export default r;
