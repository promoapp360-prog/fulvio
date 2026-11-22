import { Router } from "express";
import { z } from "zod";
import { and, asc, desc, eq, sql, lte, inArray, or, ilike } from "drizzle-orm";
import { db } from "../../db";
import { products, productVariants, productCategories, suppliers, stockMovements, orders, orderItems, users, boardingRequests, boardingEvents, dogs, payments } from "../../../shared/schema";
import { requirePerm } from "../../auth";
import { crud } from "../../crud";
import { audit } from "../../services/audit";
import { notifyUser } from "../../services/notify";
import { priceItems, promoDiscount, setOrderStatus, commitStock } from "../../services/shop";
import { awardForAmount, ensureCard, redeem } from "../../services/loyalty";
import { getSettings } from "../../services/settings";
import { sendXlsx, sendPdf } from "../../services/exporter";
import { h, HttpError, id, slugify, zOptStr, zDay, toCsv } from "../../util";
import { ORDER_STATUS, BOARDING_STATUS } from "../../../shared/constants";

const r = Router();

// ---------- categorie e prodotti ----------
r.use("/categories", crud({
  table: productCategories, entity: "product_category", perm: "shop", order: [{ col: "sortOrder", dir: "asc" }, { col: "name", dir: "asc" }],
  schema: z.object({ name: z.string().trim().min(1).max(80), sortOrder: z.coerce.number().int().default(0), active: z.boolean().default(true) }),
  beforeSave: (d) => (d.name ? { ...d, slug: slugify(d.name) } : d),
}));

r.use("/products", crud({
  table: products, entity: "product", perm: "shop", search: ["name", "sku", "barcode", "category"], filters: ["category", "supplierId", "active", "isFood"],
  order: [{ col: "name", dir: "asc" }],
  schema: z.object({
    name: z.string().trim().min(1).max(160), category: z.string().trim().min(1).max(80), description: zOptStr(5000),
    priceCents: z.number().int().min(0), salePriceCents: z.number().int().min(0).nullable().optional(), costCents: z.number().int().min(0).nullable().optional(),
    vatRate: z.coerce.number().min(0).max(30).transform(String).default("22"), sku: zOptStr(60), barcode: zOptStr(60),
    minStock: z.number().int().min(0).default(0), supplierId: z.number().int().positive().nullable().optional(), imageUrl: zOptStr(500),
    isFood: z.boolean().default(false), privateLabel: z.boolean().default(false), earnsPoints: z.boolean().default(true),
    visibleOnline: z.boolean().default(true), active: z.boolean().default(true),
  }),
  beforeSave: async (d, ex) => {
    if (d.category) await db.insert(productCategories).values({ name: d.category, slug: slugify(d.category) }).onConflictDoNothing();
    return ex ? d : { ...d, slug: `${slugify(d.name)}-${Date.now().toString(36)}` };
  },
}));

// varianti (taglia, gusto, formato…) con giacenza propria
r.get("/products/:id/variants", requirePerm("shop", "magazzino"), h(async (req, res) => {
  res.json(await db.select().from(productVariants).where(eq(productVariants.productId, id(req.params.id))).orderBy(asc(productVariants.sortOrder), asc(productVariants.id)));
}));
const variantSchema = z.object({ name: z.string().trim().min(1).max(120), sku: zOptStr(60), priceCents: z.number().int().min(0).nullable().optional(), minStock: z.number().int().min(0).default(0), active: z.boolean().default(true), sortOrder: z.coerce.number().int().default(0) });
r.post("/products/:id/variants", requirePerm("shop"), h(async (req, res) => {
  const [v] = await db.insert(productVariants).values({ ...variantSchema.parse(req.body), productId: id(req.params.id) }).returning();
  await audit(req, "create", "product_variant", v.id);
  res.status(201).json(v);
}));
r.patch("/variants/:id", requirePerm("shop"), h(async (req, res) => {
  const [v] = await db.update(productVariants).set(variantSchema.partial().parse(req.body)).where(eq(productVariants.id, id(req.params.id))).returning();
  if (!v) throw new HttpError(404, "Variante non trovata");
  res.json(v);
}));

// ---------- magazzino ----------
r.post("/stock", requirePerm("magazzino"), h(async (req, res) => {
  const d = z.object({
    productId: z.number().int().positive(), variantId: z.number().int().positive().nullable().optional(), qty: z.number().int().refine((n) => n !== 0),
    kind: z.enum(["carico", "scarico", "reso", "rettifica", "inventario"]), reference: zOptStr(120), note: zOptStr(1000),
  }).parse(req.body);
  const p = await db.transaction(async (tx) => {
    const target = d.variantId ? productVariants : products;
    const [cur] = d.variantId ? await tx.select().from(productVariants).where(and(eq(productVariants.id, d.variantId), eq(productVariants.productId, d.productId))).for("update")
      : await tx.select().from(products).where(eq(products.id, d.productId)).for("update");
    if (!cur) throw new HttpError(404, "Prodotto o variante non trovati");
    // "inventario" = conteggio fisico: qty è la giacenza reale, il movimento registra la differenza
    const qty = d.kind === "inventario" ? d.qty - cur.stock : d.kind === "scarico" ? -Math.abs(d.qty) : d.kind === "carico" || d.kind === "reso" ? Math.abs(d.qty) : d.qty;
    if (cur.stock + qty < 0) throw new HttpError(400, "La giacenza non può diventare negativa");
    const [row] = await tx.update(target as any).set({ stock: sql`stock + ${qty}` }).where(eq((target as any).id, cur.id)).returning();
    await tx.insert(stockMovements).values({ productId: d.productId, variantId: d.variantId ?? null, qty, kind: d.kind, reference: d.reference, note: d.note, createdBy: req.user!.id });
    return row;
  });
  await audit(req, "stock_" + d.kind, "product", d.productId, d);
  res.json(p);
}));

r.get("/stock/movements", requirePerm("magazzino"), h(async (req, res) => {
  const pid = req.query.productId ? id(req.query.productId) : null;
  res.json(await db.select({ m: stockMovements, product: products.name, variant: productVariants.name }).from(stockMovements).innerJoin(products, eq(products.id, stockMovements.productId))
    .leftJoin(productVariants, eq(productVariants.id, stockMovements.variantId))
    .where(pid ? eq(stockMovements.productId, pid) : undefined).orderBy(desc(stockMovements.createdAt)).limit(300)
    .then((rows) => rows.map((x) => ({ ...x.m, product: x.variant ? `${x.product} – ${x.variant}` : x.product }))));
}));

r.get("/stock/low", requirePerm("magazzino", "shop"), h(async (_req, res) => {
  const [prods, vars] = await Promise.all([
    db.select().from(products).where(and(eq(products.active, true), lte(products.stock, products.minStock))).orderBy(asc(products.stock)),
    db.select({ v: productVariants, product: products.name }).from(productVariants).innerJoin(products, eq(products.id, productVariants.productId))
      .where(and(eq(productVariants.active, true), lte(productVariants.stock, productVariants.minStock))),
  ]);
  // i prodotti con varianti si valutano sulle varianti
  const withVariants = new Set(vars.map((x) => x.v.productId));
  res.json([...prods.filter((p) => !withVariants.has(p.id)).map((p) => ({ id: p.id, name: p.name, stock: p.stock, minStock: p.minStock })),
    ...vars.map((x) => ({ id: x.v.productId, variantId: x.v.id, name: `${x.product} – ${x.v.name}`, stock: x.v.stock, minStock: x.v.minStock }))]);
}));

/** Inventario completo (CSV, Excel o PDF). */
r.get("/stock/inventory", requirePerm("magazzino"), h(async (req, res) => {
  const rows = (await db.execute(sql`select p.name as prodotto, coalesce(v.name, '') as variante, coalesce(v.sku, p.sku) as sku, p.category as categoria,
      coalesce(v.stock, p.stock) as giacenza, coalesce(v.min_stock, p.min_stock) as scorta_minima, coalesce(v.price_cents, p.sale_price_cents, p.price_cents) as prezzo,
      p.cost_cents as costo, coalesce(v.stock, p.stock) * coalesce(p.cost_cents, 0) as valore
    from products p left join product_variants v on v.product_id = p.id and v.active where p.active order by p.category, p.name, v.sort_order`)).rows as any[];
  const fmt = String(req.query.format || "csv");
  const sheet = { name: "Inventario", columns: [{ key: "prodotto", label: "Prodotto", width: 20 }, { key: "variante", label: "Variante", width: 12 }, { key: "sku", label: "SKU", width: 10 }, { key: "categoria", label: "Categoria", width: 12 },
    { key: "giacenza", label: "Giacenza", width: 8 }, { key: "scorta_minima", label: "Scorta min.", width: 8 }, { key: "prezzo", label: "Prezzo", money: true, width: 9 }, { key: "costo", label: "Costo", money: true, width: 9 }, { key: "valore", label: "Valore a costo", money: true, width: 11 }],
    rows, totals: { prodotto: "Totale", giacenza: rows.reduce((a, r) => a + Number(r.giacenza), 0), valore: rows.reduce((a, r) => a + Number(r.valore), 0) } } as any;
  if (fmt === "xlsx") return sendXlsx(res, "inventario", [sheet]);
  if (fmt === "pdf") return sendPdf(res, "inventario", "Inventario magazzino", new Date().toLocaleDateString("it-IT"), [sheet]);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="inventario.csv"');
  res.send(toCsv(rows.map((x) => ({ ...x, prezzo: (Number(x.prezzo) / 100).toFixed(2), costo: x.costo == null ? "" : (Number(x.costo) / 100).toFixed(2), valore: (Number(x.valore) / 100).toFixed(2) }))));
}));
r.get("/stock/export.csv", requirePerm("magazzino"), (req, res) => res.redirect("/api/admin/stock/inventory?format=csv"));

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
  const channel = req.query.channel ? String(req.query.channel) : null;
  const os = await db.select({ o: orders, customer: sql<string>`coalesce(${users.firstName} || ' ' || ${users.lastName}, 'Cliente al banco')`, email: users.email, phone: users.phone })
    .from(orders).leftJoin(users, eq(users.id, orders.customerId)).where(and(status ? eq(orders.status, status) : undefined, channel ? eq(orders.channel, channel) : undefined))
    .orderBy(desc(orders.createdAt)).limit(300);
  const ids = os.map((x) => x.o.id);
  const [items, pays] = ids.length ? await Promise.all([
    db.select().from(orderItems).where(inArray(orderItems.orderId, ids)),
    db.select().from(payments).where(and(inArray(payments.orderId, ids), eq(payments.status, "pagato"))),
  ]) : [[], []];
  res.json(os.map((x) => ({
    ...x.o, customer: x.customer, email: x.email, phone: x.phone, items: items.filter((i) => i.orderId === x.o.id),
    paidCents: pays.filter((p) => p.orderId === x.o.id).reduce((a, p) => a + (p.kind === "rimborso" ? -p.amountCents : p.amountCents), 0),
  })));
}));

r.patch("/orders/:id", requirePerm("shop"), h(async (req, res) => {
  const oid = id(req.params.id);
  const d = z.object({ status: z.enum(Object.keys(ORDER_STATUS) as [string, ...string[]]), notes: zOptStr(2000) }).parse(req.body);
  const o = await setOrderStatus(oid, d.status, req.user!.id, d.notes);
  await audit(req, "order_status", "order", oid, d);
  res.json(o);
}));

/** Vendita registrata in negozio: scarica il magazzino, registra l'incasso e accredita i punti al cliente (se indicato). */
r.post("/orders/counter-sale", requirePerm("shop", "pagamenti"), h(async (req, res) => {
  const d = z.object({
    customerId: z.number().int().positive().nullable().optional(),
    items: z.array(z.object({ productId: z.number().int().positive(), variantId: z.number().int().positive().nullable().optional(), qty: z.number().int().min(1).max(500) })).min(1).max(100),
    method: z.enum(["contanti", "pos", "satispay", "bonifico_istantaneo", "bonifico", "altro"]), methodLabel: zOptStr(60),
    promoCode: zOptStr(40), pointsToUse: z.number().int().min(0).default(0), notes: zOptStr(1000),
  }).parse(req.body);
  const s = await getSettings();
  const order = await db.transaction(async (tx) => {
    const { lines, subtotal, pointsBase } = await priceItems(tx, d.items, { onlineOnly: false });
    const discount = await promoDiscount(tx, d.promoCode, subtotal);
    let pointsDiscount = 0;
    if (d.pointsToUse > 0) {
      if (!d.customerId) throw new HttpError(400, "Per usare i punti seleziona il cliente");
      if (!s.loyalty.pointValueCents) throw new HttpError(400, "Imposta il valore del punto in Impostazioni → Fidelity");
      pointsDiscount = Math.min(d.pointsToUse * s.loyalty.pointValueCents, subtotal - discount);
    }
    const total = subtotal - discount - pointsDiscount;
    const [o] = await tx.insert(orders).values({
      customerId: d.customerId ?? null, channel: "negozio", status: "completato", subtotalCents: subtotal, discountCents: discount, totalCents: total,
      promoCode: d.promoCode, delivery: "ritiro", notes: d.notes, pointsUsed: d.pointsToUse, pointsDiscountCents: pointsDiscount,
    }).returning();
    await tx.insert(orderItems).values(lines.map((l) => ({ ...l, orderId: o.id })));
    await commitStock(tx, o.id, req.user!.id, "vendita_negozio");
    if (d.pointsToUse > 0) {
      const card = await ensureCard(d.customerId!, tx);
      await redeem(card.id, d.pointsToUse, `Sconto punti – vendita #${o.id}`, { orderId: o.id, valueCents: pointsDiscount, createdBy: req.user!.id }, tx);
    }
    if (total > 0) await tx.insert(payments).values({ orderId: o.id, customerId: d.customerId ?? null, kind: "totale", method: d.method, methodLabel: d.methodLabel, amountCents: total, status: "pagato", paidAt: new Date(), reason: `Vendita al banco #${o.id}`, createdBy: req.user!.id });
    if (d.customerId) await awardForAmount(d.customerId, Math.max(0, Math.min(pointsBase, total)), `Acquisto in negozio #${o.id}`, { orderId: o.id, createdBy: req.user!.id, target: "shop" }, tx);
    return o;
  });
  await audit(req, "counter_sale", "order", order.id, d);
  res.status(201).json(order);
}));

// ---------- pensione casalinga ----------
r.get("/boarding", requirePerm("pensione"), h(async (req, res) => {
  const status = req.query.status ? String(req.query.status) : null;
  const rows = await db.select({ b: boardingRequests, dogName: dogs.name, dogSize: dogs.size, customer: sql<string>`${users.firstName} || ' ' || ${users.lastName}`, phone: users.phone })
    .from(boardingRequests).innerJoin(dogs, eq(dogs.id, boardingRequests.dogId)).innerJoin(users, eq(users.id, boardingRequests.customerId))
    .where(status ? eq(boardingRequests.status, status) : undefined).orderBy(desc(boardingRequests.startDate)).limit(300);
  const ids = rows.map((x) => x.b.id);
  const events = ids.length ? await db.select().from(boardingEvents).where(inArray(boardingEvents.boardingId, ids)).orderBy(asc(boardingEvents.id)) : [];
  res.json(rows.map((x) => ({ ...x.b, dogName: x.dogName, dogSize: x.dogSize, customer: x.customer, phone: x.phone, events: events.filter((e) => e.boardingId === x.b.id) })));
}));

/** Azioni del salone: accettare, rifiutare, chiedere informazioni, proporre nuove date. Mai conferme automatiche. */
r.post("/boarding/:id/action", requirePerm("pensione"), h(async (req, res) => {
  const bid = id(req.params.id);
  const d = z.object({
    action: z.enum(["accetta", "rifiuta", "chiedi_info", "proponi_date", "in_corso", "completa", "annulla"]),
    message: zOptStr(2000), priceCents: z.number().int().min(0).nullable().optional(), startDate: zDay.optional(), endDate: zDay.optional(),
  }).parse(req.body);
  const map: Record<string, string> = { accetta: "confermata", rifiuta: "rifiutata", chiedi_info: "info_richieste", proponi_date: "proposta", in_corso: "in_corso", completa: "completata", annulla: "annullata" };
  const b = await db.transaction(async (tx) => {
    const [b0] = await tx.select().from(boardingRequests).where(eq(boardingRequests.id, bid)).for("update");
    if (!b0) throw new HttpError(404, "Richiesta non trovata");
    if (["rifiutata", "annullata", "completata"].includes(b0.status)) throw new HttpError(400, "Richiesta già chiusa");
    const patch: any = { status: map[d.action], updatedAt: new Date(), lastMessage: d.message ?? null };
    if (d.priceCents !== undefined) patch.priceCents = d.priceCents;
    if (d.action === "chiedi_info" && !d.message) throw new HttpError(400, "Scrivi le informazioni da chiedere al cliente");
    if (d.action === "proponi_date") {
      if (!d.startDate || !d.endDate || d.endDate < d.startDate) throw new HttpError(400, "Indica le nuove date proposte");
      Object.assign(patch, { proposedStart: d.startDate, proposedEnd: d.endDate });
    }
    const [b1] = await tx.update(boardingRequests).set(patch).where(eq(boardingRequests.id, bid)).returning();
    await tx.insert(boardingEvents).values({ boardingId: bid, actorId: req.user!.id, action: d.action, message: d.message, data: { priceCents: d.priceCents, startDate: d.startDate, endDate: d.endDate } });
    return b1;
  });
  const [c] = await db.select().from(users).where(eq(users.id, b.customerId));
  const [dog] = await db.select().from(dogs).where(eq(dogs.id, b.dogId));
  if (c) await notifyUser(c, {
    title: `Pensione casalinga: ${BOARDING_STATUS[b.status]}`, body: d.message || `Soggiorno dal ${b.startDate} al ${b.endDate}.`, url: "/account/pensione",
    template: "pensione_aggiornamento", vars: { cane: dog?.name, stato: BOARDING_STATUS[b.status], date: d.action === "proponi_date" ? `nuove date proposte: ${b.proposedStart} → ${b.proposedEnd}` : `${b.startDate} → ${b.endDate}`, messaggio: d.message ?? "" },
  });
  await audit(req, "boarding_" + d.action, "boarding", bid, d);
  res.json(b);
}));

r.patch("/boarding/:id", requirePerm("pensione"), h(async (req, res) => {
  const bid = id(req.params.id);
  const d = z.object({ priceCents: z.number().int().min(0).nullable().optional(), adminNotes: zOptStr(4000) }).parse(req.body);
  const [b] = await db.update(boardingRequests).set({ ...d, updatedAt: new Date() }).where(eq(boardingRequests.id, bid)).returning();
  if (!b) throw new HttpError(404, "Richiesta non trovata");
  await audit(req, "update", "boarding", bid, d);
  res.json(b);
}));

export default r;
