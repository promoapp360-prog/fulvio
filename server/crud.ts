import { Router } from "express";
import { and, asc, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { z } from "zod";
import { db } from "./db";
import { requirePerm } from "./auth";
import { audit } from "./services/audit";
import { h, id, paging, HttpError } from "./util";
import type { Permission } from "../shared/constants";

type Opts = {
  table: PgTable & Record<string, any>;
  entity: string;
  perm: Permission;
  schema: z.ZodObject<any>;
  search?: string[];
  order?: { col: string; dir?: "asc" | "desc" }[];
  filters?: string[]; // colonne filtrabili via query string (?col=valore)
  beforeSave?: (data: any, existing?: any) => any | Promise<any>;
  afterSave?: (row: any, req: any) => Promise<void>;
};

/** Router CRUD generico con validazione, paginazione, ricerca, filtri e audit. */
export function crud(o: Opts) {
  const r = Router();
  const t = o.table as any;
  r.use(requirePerm(o.perm));

  r.get("/", h(async (req, res) => {
    const { page, pageSize, offset } = paging(req);
    const conds: SQL[] = [];
    const q = String(req.query.q || "").trim();
    if (q && o.search?.length) conds.push(or(...o.search.map((c) => ilike(t[c], `%${q}%`)))!);
    for (const f of o.filters || []) {
      const v = req.query[f];
      if (v === undefined || v === "") continue;
      conds.push(eq(t[f], v === "true" ? true : v === "false" ? false : (/^\d+$/.test(String(v)) && f.endsWith("Id") ? Number(v) : String(v))));
    }
    const where = conds.length ? and(...conds) : undefined;
    const orderBy = (o.order || [{ col: "id", dir: "desc" }]).map((x) => (x.dir === "asc" ? asc(t[x.col]) : desc(t[x.col])));
    const [rows, [{ count }]] = await Promise.all([
      db.select().from(t).where(where).orderBy(...orderBy).limit(pageSize).offset(offset),
      db.select({ count: sql<number>`count(*)::int` }).from(t).where(where),
    ]);
    res.json({ rows, total: count, page, pageSize });
  }));

  r.get("/:id", h(async (req, res) => {
    const [row] = await db.select().from(t).where(eq(t.id, id(req.params.id)));
    if (!row) throw new HttpError(404, "Non trovato");
    res.json(row);
  }));

  r.post("/", h(async (req, res) => {
    let data = o.schema.parse(req.body);
    if (o.beforeSave) data = await o.beforeSave(data);
    const [row] = await db.insert(t).values(data).returning();
    await audit(req, "create", o.entity, row.id, data);
    if (o.afterSave) await o.afterSave(row, req);
    res.status(201).json(row);
  }));

  r.patch("/:id", h(async (req, res) => {
    const rid = id(req.params.id);
    const [existing] = await db.select().from(t).where(eq(t.id, rid));
    if (!existing) throw new HttpError(404, "Non trovato");
    let data = o.schema.partial().parse(req.body);
    if (o.beforeSave) data = await o.beforeSave(data, existing);
    if ("updatedAt" in t) (data as any).updatedAt = new Date();
    const [row] = await db.update(t).set(data).where(eq(t.id, rid)).returning();
    await audit(req, "update", o.entity, rid, data);
    if (o.afterSave) await o.afterSave(row, req);
    res.json(row);
  }));

  r.delete("/:id", h(async (req, res) => {
    const rid = id(req.params.id);
    const [row] = await db.delete(t).where(eq(t.id, rid)).returning();
    if (!row) throw new HttpError(404, "Non trovato");
    await audit(req, "delete", o.entity, rid, {});
    res.json({ ok: true });
  }));

  return r;
}
