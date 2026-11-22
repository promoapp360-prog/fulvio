import { Router } from "express";
import { z } from "zod";
import { asc, eq, and } from "drizzle-orm";
import { db } from "../../db";
import { services, serviceVariants, serviceSupplements, operators, operatorServices, operatorShifts, operatorAbsences, resources, users } from "../../../shared/schema";
import { requirePerm } from "../../auth";
import { crud } from "../../crud";
import { audit } from "../../services/audit";
import { h, HttpError, id, slugify, zDay, zTime, zOptStr } from "../../util";

const r = Router();

// ---------- servizi e listino ----------
const serviceSchema = z.object({
  name: z.string().trim().min(1).max(120), category: z.string().trim().min(1).max(80), description: zOptStr(4000),
  priceCents: z.number().int().min(0).nullable().optional(), priceFrom: z.boolean().default(true),
  durationMin: z.coerce.number().int().min(5).max(600), bookable: z.boolean().default(true), active: z.boolean().default(true),
  visible: z.boolean().default(true), sortOrder: z.coerce.number().int().default(0),
});

r.get("/services", requirePerm("agenda"), h(async (_req, res) => {
  const [svcs, vars, sups, links] = await Promise.all([
    db.select().from(services).orderBy(asc(services.sortOrder), asc(services.id)),
    db.select().from(serviceVariants), db.select().from(serviceSupplements), db.select().from(operatorServices),
  ]);
  res.json(svcs.map((s) => ({
    ...s, variants: vars.filter((v) => v.serviceId === s.id), supplements: sups.filter((x) => x.serviceId === s.id),
    operatorIds: links.filter((l) => l.serviceId === s.id).map((l) => l.operatorId),
  })));
}));

const variantsSchema = z.array(z.object({
  size: z.enum(["piccola", "media", "grande", "gigante"]),
  priceCents: z.number().int().min(0).nullable(), durationMin: z.number().int().min(5).max(600).nullable(),
})).max(4);

async function saveServiceChildren(tx: any, serviceId: number, body: any) {
  if (body.variants) {
    const vs = variantsSchema.parse(body.variants);
    await tx.delete(serviceVariants).where(eq(serviceVariants.serviceId, serviceId));
    const keep = vs.filter((v) => v.priceCents != null || v.durationMin != null);
    if (keep.length) await tx.insert(serviceVariants).values(keep.map((v) => ({ ...v, serviceId })));
  }
  if (body.operatorIds) {
    const ids = z.array(z.number().int().positive()).parse(body.operatorIds);
    await tx.delete(operatorServices).where(eq(operatorServices.serviceId, serviceId));
    if (ids.length) await tx.insert(operatorServices).values(ids.map((operatorId) => ({ operatorId, serviceId })));
  }
}

r.post("/services", requirePerm("servizi"), h(async (req, res) => {
  const d = serviceSchema.parse(req.body);
  const s = await db.transaction(async (tx) => {
    const [row] = await tx.insert(services).values({ ...d, slug: `${slugify(d.name)}-${Date.now().toString(36)}` }).returning();
    await saveServiceChildren(tx, row.id, req.body);
    return row;
  });
  await audit(req, "create", "service", s.id, d);
  res.status(201).json(s);
}));

r.patch("/services/:id", requirePerm("servizi"), h(async (req, res) => {
  const sid = id(req.params.id);
  const d = serviceSchema.partial().parse(req.body);
  const s = await db.transaction(async (tx) => {
    const [row] = Object.keys(d).length ? await tx.update(services).set(d).where(eq(services.id, sid)).returning() : await tx.select().from(services).where(eq(services.id, sid));
    if (!row) throw new HttpError(404, "Servizio non trovato");
    await saveServiceChildren(tx, sid, req.body);
    return row;
  });
  await audit(req, "update", "service", sid, req.body);
  res.json(s);
}));

r.delete("/services/:id", requirePerm("servizi"), h(async (req, res) => {
  // se il servizio ha appuntamenti lo disattiviamo invece di eliminarlo
  const sid = id(req.params.id);
  try { await db.delete(services).where(eq(services.id, sid)); }
  catch { await db.update(services).set({ active: false, visible: false }).where(eq(services.id, sid)); }
  await audit(req, "delete", "service", sid);
  res.json({ ok: true });
}));

r.use("/supplements", crud({
  table: serviceSupplements, entity: "supplement", perm: "servizi", filters: ["serviceId"],
  schema: z.object({
    serviceId: z.number().int().positive().nullable().optional(), name: z.string().trim().min(1).max(120),
    condition: z.enum(["manuale", "nodi", "muta", "aggressivo", "esigenze"]).default("manuale"),
    priceCents: z.number().int().min(0).default(0), extraMin: z.number().int().min(0).max(240).default(0), active: z.boolean().default(true),
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

r.get("/operators", requirePerm("agenda"), h(async (_req, res) => {
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

r.post("/operators", requirePerm("operatori"), h(async (req, res) => {
  const d = operatorSchema.parse(req.body);
  const o = await db.transaction(async (tx) => {
    const [row] = await tx.insert(operators).values(d).returning();
    await saveOperatorChildren(tx, row.id, req.body);
    return row;
  });
  await audit(req, "create", "operator", o.id, d);
  res.status(201).json(o);
}));

r.patch("/operators/:id", requirePerm("operatori"), h(async (req, res) => {
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
  table: operatorAbsences, entity: "absence", perm: "operatori", filters: ["operatorId", "kind"],
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
  table: resources, entity: "resource", perm: "operatori",
  schema: z.object({ name: z.string().trim().min(1).max(80), kind: z.string().trim().max(30).default("postazione"), active: z.boolean().default(true) }),
}));

export default r;
