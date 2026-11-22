import { Router } from "express";
import { z } from "zod";
import { and, asc, desc, eq, sql, lte, inArray } from "drizzle-orm";
import { db } from "../../db";
import { products, suppliers, stockMovements, orders, orderItems, users, boardingRequests, dogs } from "../../../shared/schema";
import { requirePerm } from "../../auth";
import { crud } from "../../crud";
import { audit } from "../../services/audit";
import { notifyUser } from "../../services/notify";
import { awardForAmount } from "../../services/loyalty";
import { h, HttpError, id, slugify, zOptStr, zDay, toCsv } from "../../util";
import { ORDER_STATUS, BOARDING_STATUS } from "../../../shared/constants";

const r = Router();

// ---------- prodotti ----------
r.use("/products", crud({
  table: products, entity: "product", perm: "shop", search: ["name", "sku", "barcode", "category"], filters: ["category", "supplierId", "active", "isFood"],
  order: [{ col: "name", dir: "asc" }],
  schema: z.object({
    name: z.string().trim().min(1).max(160), category: z.string().trim().min(1).max(80), description: zOptStr(5000),
    priceCents: z.number().int().min(0), salePriceCents: z.number().int().min(0).nullable().optional(), costCents: z.number().int().min(0).nullable().optional(),
    vatRate: z.coerce.number().min(0).max(30).transform(String).default("22"), sku: zOptStr(60), barcode: zOptStr(60),
    minStock: z.number().int().min(0).default(0), supplierId: z.number().int().positive().nullable().optional(), imageUrl: zOptStr(500),
    isFood: z.boolean().default(false), visibleOnline: z.boolean().default(true), active: z.boolean().default(true),
  }),
  beforeSave: (d, ex) => (ex ? d : { ...d, slug: `${slugify(d.name)}-${Date.now().toString(36)}` }),
}));

// ---------- magazzino ----------
r.post("/stock", requirePerm("magazzino"), h(async (req, res) => {
  const d = z.object({
    productId: z.number().int().positive(), qty: z.number().int().refine((n) => n !== 0),
    kind: z.enum(["carico", "scarico", "reso", "rettifica"]), reference: zOptStr(120), note: zOptStr(1000),
  }).parse(req.body);
  const qty = d.kind === "scarico" ? -Math.abs(d.qty) : d.kind === "carico" || d.kind === "reso" ? Math.abs(d.qty) : d.qty;
  const p = await db.transaction(async (tx) => {
    const [row] = await tx.update(products).set({ stock: sql`${products.stock} + ${qty}`, updatedAt: new Date() }).where(eq(products.id, d.productId)).returning();
    if (!row) throw new HttpError(404, "Prodotto non trovato");
    if (row.stock < 0) throw new HttpError(400, "La giacenza non può diventare negativa");
    await tx.insert(stockMovements).values({ ...d, qty, createdBy: req.user!.id });
    return row;
  });
  await audit(req, "stock_" + d.kind, "product", d.productId, { qty });
  res.json(p);
}));

r.get("/stock/movements", requirePerm("magazzino"), h(async (req, res) => {
  const pid = req.query.productId ? id(req.query.productId) : null;
  res.json(await db.select({ m: stockMovements, product: products.name }).from(stockMovements).innerJoin(products, eq(products.id, stockMovements.productId))
    .where(pid ? eq(stockMovements.productId, pid) : undefined).orderBy(desc(stockMovements.createdAt)).limit(300)
    .then((rows) => rows.map((x) => ({ ...x.m, product: x.product }))));
}));

r.get("/stock/low", requirePerm("magazzino"), h(async (_req, res) => {
  res.json(await db.select().from(products).where(and(eq(products.active, true), lte(products.stock, products.minStock))).orderBy(asc(products.stock)));
}));

r.get("/stock/export.csv", requirePerm("magazzino"), h(async (_req, res) => {
  const rows = await db.select({ prodotto: products.name, sku: products.sku, categoria: products.category, giacenza: products.stock, scorta_minima: products.minStock, prezzo: products.priceCents, costo: products.costCents }).from(products).orderBy(asc(products.name));
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="magazzino.csv"');
  res.send(toCsv(rows.map((x) => ({ ...x, prezzo: (x.prezzo / 100).toFixed(2), costo: x.costo == null ? "" : (x.costo / 100).toFixed(2) }))));
}));

r.use("/suppliers", crud({
  table: suppliers, entity: "supplier", perm: "magazzino", search: ["name", "contact", "email"], order: [{ col: "name", dir: "asc" }],
  schema: z.object({
    name: z.string().trim().min(1).max(160), contact: zOptStr(120), email: zOptStr(255), phone: zOptStr(40),
    vatNumber: zOptStr(20), address: zOptStr(255), notes: zOptStr(4000), active: z.boolean().default(true),
  }),
}));

// ---------- ordini ----------
r.get("/orders", requirePerm("shop"), h(async (req, res) => {
  const status = req.query.status ? String(req.query.status) : null;
  const os = await db.select({ o: orders, customer: sql<string>`${users.firstName} || ' ' || ${users.lastName}`, email: users.email, phone: users.phone })
    .from(orders).innerJoin(users, eq(users.id, orders.customerId)).where(status ? eq(orders.status, status) : undefined).orderBy(desc(orders.createdAt)).limit(300);
  const items = os.length ? await db.select().from(orderItems).where(inArray(orderItems.orderId, os.map((x) => x.o.id))) : [];
  res.json(os.map((x) => ({ ...x.o, customer: x.customer, email: x.email, phone: x.phone, items: items.filter((i) => i.orderId === x.o.id) })));
}));

/** Scarica il magazzino una sola volta per ordine (al pagamento o alla presa in carico). */
export async function commitOrderStock(tx: any, orderId: number, actorId: number | null) {
  const ref = `ordine #${orderId}`;
  const [done] = await tx.select({ id: stockMovements.id }).from(stockMovements).where(and(eq(stockMovements.reference, ref), eq(stockMovements.kind, "vendita"))).limit(1);
  if (done) return;
  const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, orderId));
  for (const it of items) {
    if (!it.productId) continue;
    await tx.update(products).set({ stock: sql`${products.stock} - ${it.qty}` }).where(eq(products.id, it.productId));
    await tx.insert(stockMovements).values({ productId: it.productId, qty: -it.qty, kind: "vendita", reference: ref, createdBy: actorId });
  }
}

r.patch("/orders/:id", requirePerm("shop"), h(async (req, res) => {
  const oid = id(req.params.id);
  const d = z.object({ status: z.enum(Object.keys(ORDER_STATUS) as [string, ...string[]]), notes: zOptStr(2000) }).parse(req.body);
  const o = await db.transaction(async (tx) => {
    const [o0] = await tx.select().from(orders).where(eq(orders.id, oid)).for("update");
    if (!o0) throw new HttpError(404, "Ordine non trovato");
    const [o1] = await tx.update(orders).set({ status: d.status, ...(d.notes !== undefined ? { notes: d.notes } : {}), updatedAt: new Date() }).where(eq(orders.id, oid)).returning();
    if (["pagato", "in_preparazione", "pronto", "spedito", "completato"].includes(d.status)) await commitOrderStock(tx, oid, req.user!.id);
    if (d.status === "completato") await awardForAmount(o1.customerId, o1.totalCents, `Ordine shop #${oid}`, { orderId: oid, createdBy: req.user!.id }, tx);
    return o1;
  });
  const [c] = await db.select().from(users).where(eq(users.id, o.customerId));
  if (c && ["pronto", "spedito", "annullato"].includes(d.status)) await notifyUser(c, { title: `Ordine #${oid}: ${ORDER_STATUS[d.status]}`, body: d.status === "pronto" ? "Il tuo ordine è pronto per il ritiro in negozio." : `Stato aggiornato: ${ORDER_STATUS[d.status]}.`, url: "/account/ordini" });
  await audit(req, "order_status", "order", oid, d);
  res.json(o);
}));

// ---------- pensione casalinga ----------
r.get("/boarding", requirePerm("pensione"), h(async (req, res) => {
  const status = req.query.status ? String(req.query.status) : null;
  res.json(await db.select({ b: boardingRequests, dogName: dogs.name, dogSize: dogs.size, customer: sql<string>`${users.firstName} || ' ' || ${users.lastName}`, phone: users.phone })
    .from(boardingRequests).innerJoin(dogs, eq(dogs.id, boardingRequests.dogId)).innerJoin(users, eq(users.id, boardingRequests.customerId))
    .where(status ? eq(boardingRequests.status, status) : undefined).orderBy(desc(boardingRequests.startDate)).limit(300)
    .then((rows) => rows.map((x) => ({ ...x.b, dogName: x.dogName, dogSize: x.dogSize, customer: x.customer, phone: x.phone }))));
}));

r.patch("/boarding/:id", requirePerm("pensione"), h(async (req, res) => {
  const bid = id(req.params.id);
  const d = z.object({
    status: z.enum(Object.keys(BOARDING_STATUS) as [string, ...string[]]).optional(), priceCents: z.number().int().min(0).nullable().optional(),
    adminNotes: zOptStr(4000), startDate: zDay.optional(), endDate: zDay.optional(),
  }).parse(req.body);
  const [b0] = await db.select().from(boardingRequests).where(eq(boardingRequests.id, bid));
  if (!b0) throw new HttpError(404, "Richiesta non trovata");
  const [b] = await db.update(boardingRequests).set({ ...d, updatedAt: new Date() }).where(eq(boardingRequests.id, bid)).returning();
  if (b.endDate < b.startDate) throw new HttpError(400, "Date non valide");
  if (d.status && d.status !== b0.status && ["confermata", "rifiutata"].includes(d.status)) {
    const [c] = await db.select().from(users).where(eq(users.id, b.customerId));
    if (c) await notifyUser(c, { title: `Pensione casalinga: ${BOARDING_STATUS[d.status]}`, body: `Soggiorno dal ${b.startDate} al ${b.endDate}.`, url: "/account/pensione" });
  }
  await audit(req, "update", "boarding", bid, d);
  res.json(b);
}));

export default r;
