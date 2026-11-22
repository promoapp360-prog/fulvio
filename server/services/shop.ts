// Shop integrato (punto 17): prezzi, varianti, magazzino, punti e stati ordine.
import { and, eq, inArray, sql } from "drizzle-orm";
import { products, productVariants, orders, orderItems, stockMovements, promotions, users } from "../../shared/schema";
import { HttpError } from "../util";
import { todayRome } from "../time";
import { awardForAmount, reverseFor, refundRedemption } from "./loyalty";
import { notifyUser } from "./notify";
import { ORDER_STATUS, euro } from "../../shared/constants";
import { db } from "../db";

export type ItemInput = { productId: number; variantId?: number | null; qty: number };

/** Calcola righe e subtotale verificando disponibilità di prodotti e varianti. */
export async function priceItems(tx: any, items: ItemInput[], opts: { onlineOnly: boolean }) {
  const prods = await tx.select().from(products).where(inArray(products.id, items.map((i) => i.productId)));
  const varIds = items.map((i) => i.variantId).filter(Boolean) as number[];
  const vars = varIds.length ? await tx.select().from(productVariants).where(inArray(productVariants.id, varIds)) : [];
  let subtotal = 0, pointsBase = 0;
  const lines = items.map((i) => {
    const p = prods.find((x: any) => x.id === i.productId);
    if (!p || !p.active || (opts.onlineOnly && !p.visibleOnline)) throw new HttpError(400, "Prodotto non disponibile");
    const v = i.variantId ? vars.find((x: any) => x.id === i.variantId && x.productId === p.id && x.active) : null;
    if (i.variantId && !v) throw new HttpError(400, `Variante non disponibile per ${p.name}`);
    const stock = v ? v.stock : p.stock;
    if (stock < i.qty) throw new HttpError(409, `Disponibilità insufficiente per ${p.name}${v ? ` (${v.name})` : ""}`);
    const unit = v?.priceCents ?? p.salePriceCents ?? p.priceCents;
    subtotal += unit * i.qty;
    if (p.earnsPoints) pointsBase += unit * i.qty;
    return { productId: p.id, variantId: v?.id ?? null, name: v ? `${p.name} – ${v.name}` : p.name, qty: i.qty, unitPriceCents: unit };
  });
  return { lines, subtotal, pointsBase };
}

/** Valida un codice sconto per lo shop e restituisce lo sconto in centesimi. */
export async function promoDiscount(tx: any, code: string | null | undefined, subtotal: number) {
  if (!code) return 0;
  const today = todayRome();
  const [promo] = await tx.select().from(promotions).where(and(sql`upper(${promotions.code}) = upper(${code})`, eq(promotions.active, true)));
  if (!promo || (promo.startsAt && promo.startsAt > today) || (promo.endsAt && promo.endsAt < today) || promo.appliesTo === "servizi" || promo.discountType === "points") {
    throw new HttpError(400, "Codice promozionale non valido");
  }
  return promo.discountType === "percent" ? Math.round((subtotal * promo.discountValue) / 100) : Math.min(subtotal, promo.discountValue);
}

/** Scarica il magazzino una sola volta per ordine. */
export async function commitStock(tx: any, orderId: number, actorId: number | null, kind: "vendita" | "vendita_negozio" = "vendita") {
  const [o] = await tx.select().from(orders).where(eq(orders.id, orderId)).for("update");
  if (!o || o.stockCommitted) return;
  const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, orderId));
  for (const it of items) {
    if (!it.productId) continue;
    if (it.variantId) {
      const [v] = await tx.update(productVariants).set({ stock: sql`${productVariants.stock} - ${it.qty}` }).where(eq(productVariants.id, it.variantId)).returning();
      if (v && v.stock < 0) throw new HttpError(409, `Disponibilità insufficiente per ${it.name}`);
    } else {
      const [p] = await tx.update(products).set({ stock: sql`${products.stock} - ${it.qty}`, updatedAt: new Date() }).where(eq(products.id, it.productId)).returning();
      if (p && p.stock < 0) throw new HttpError(409, `Disponibilità insufficiente per ${it.name}`);
    }
    await tx.insert(stockMovements).values({ productId: it.productId, variantId: it.variantId, qty: -it.qty, kind, reference: `ordine #${orderId}`, createdBy: actorId });
  }
  await tx.update(orders).set({ stockCommitted: true }).where(eq(orders.id, orderId));
}

/** Rientro a magazzino per ordine annullato/reso. */
export async function restock(tx: any, orderId: number, actorId: number | null) {
  const [o] = await tx.select().from(orders).where(eq(orders.id, orderId)).for("update");
  if (!o || !o.stockCommitted) return;
  const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, orderId));
  for (const it of items) {
    if (!it.productId) continue;
    if (it.variantId) await tx.update(productVariants).set({ stock: sql`${productVariants.stock} + ${it.qty}` }).where(eq(productVariants.id, it.variantId));
    else await tx.update(products).set({ stock: sql`${products.stock} + ${it.qty}` }).where(eq(products.id, it.productId));
    await tx.insert(stockMovements).values({ productId: it.productId, variantId: it.variantId, qty: it.qty, kind: "reso", reference: `annullo ordine #${orderId}`, createdBy: actorId });
  }
  await tx.update(orders).set({ stockCommitted: false }).where(eq(orders.id, orderId));
}

const STOCK_STATES = ["pagato", "in_preparazione", "pronto", "spedito", "completato"];

/** Cambio di stato con effetti su magazzino, punti e notifiche al cliente. */
export async function setOrderStatus(orderId: number, status: string, actorId: number | null, notes?: string | null) {
  const o = await db.transaction(async (tx) => {
    const [o0] = await tx.select().from(orders).where(eq(orders.id, orderId)).for("update");
    if (!o0) throw new HttpError(404, "Ordine non trovato");
    if (o0.status === "annullato") throw new HttpError(400, "Ordine già annullato");
    const [o1] = await tx.update(orders).set({ status, ...(notes !== undefined ? { notes } : {}), ...(status === "annullato" ? { cancelledAt: new Date() } : {}), updatedAt: new Date() }).where(eq(orders.id, orderId)).returning();
    if (STOCK_STATES.includes(status)) await commitStock(tx, orderId, actorId, o1.channel === "negozio" ? "vendita_negozio" : "vendita");
    if (status === "completato" && o1.customerId) {
      const items = await tx.select({ total: sql<number>`sum(${orderItems.qty} * ${orderItems.unitPriceCents})::int` }).from(orderItems)
        .innerJoin(products, eq(products.id, orderItems.productId)).where(and(eq(orderItems.orderId, orderId), eq(products.earnsPoints, true)));
      const base = Math.max(0, Math.min(items[0]?.total ?? 0, o1.totalCents - o1.deliveryCents));
      await awardForAmount(o1.customerId, base, `Ordine shop #${orderId}`, { orderId, createdBy: actorId, target: "shop" }, tx);
    }
    if (status === "annullato") {
      await restock(tx, orderId, actorId);
      await reverseFor({ orderId }, 1, 1, `Storno per annullamento ordine #${orderId}`, actorId, tx);
      await refundRedemption(orderId, `Punti restituiti per annullamento ordine #${orderId}`, actorId, tx);
    }
    return o1;
  });
  if (o.customerId && o.channel === "online") {
    const [c] = await db.select().from(users).where(eq(users.id, o.customerId));
    if (c) await notifyUser(c, {
      title: `Ordine #${orderId}: ${ORDER_STATUS[status]}`, body: status === "pronto" ? "Il tuo ordine è pronto per il ritiro in negozio." : `Stato aggiornato: ${ORDER_STATUS[status]}.`,
      url: "/account/ordini", template: "ordine_stato", vars: { ordine: orderId, stato: ORDER_STATUS[status], importo: euro(o.totalCents) },
    });
  }
  return o;
}
