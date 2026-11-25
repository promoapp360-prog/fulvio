import express, { Router } from "express";
import { and, eq } from "drizzle-orm";
import { db } from "./db";
import { payments, appointments, orders, users } from "../shared/schema";
import { verifyStripeSignature } from "./services/payments";
import { logEvent, paidTotal } from "./services/appointments";
import { notifyAppointmentConfirmed, pushAppointmentConfirmed } from "./services/appointment-mail";
import { scheduleOneSignalReminder } from "./services/onesignal";
import { kickQueue } from "./services/email";
import { commitStock } from "./services/shop";
import { notifyUser, notifyStaff } from "./services/notify";

const r = Router();

/** Webhook Stripe: unica fonte di verità per l'esito dei pagamenti online. Idempotente. */
r.post("/stripe", express.raw({ type: "application/json", limit: "1mb" }), async (req, res) => {
  if (!verifyStripeSignature(req.body as Buffer, req.get("stripe-signature"))) return res.status(400).send("firma non valida");
  const event = JSON.parse((req.body as Buffer).toString("utf8"));
  try {
    if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
      const s = event.data.object;
      if (s.payment_status !== "paid") return res.json({ received: true });
      await handlePaid(s.id, s.amount_total, s.metadata || {});
    }
    if (event.type === "checkout.session.expired" || event.type === "checkout.session.async_payment_failed") {
      await db.update(payments).set({ status: event.type.endsWith("expired") ? "annullato" : "fallito" })
        .where(and(eq(payments.provider, "stripe"), eq(payments.providerRef, event.data.object.id), eq(payments.status, "in_attesa")));
    }
    res.json({ received: true });
  } catch (e) {
    console.error("[stripe webhook]", e);
    res.status(500).json({ error: "errore" });
  }
});

async function handlePaid(sessionId: string, amountTotal: number, meta: Record<string, string>) {
  let confirmedAppointmentId: number | null = null;
  const result = await db.transaction(async (tx) => {
    // aggiorna solo se ancora "in_attesa": evita il doppio conteggio in caso di webhook ripetuti
    const [p] = await tx.update(payments).set({ status: "pagato", paidAt: new Date(), amountCents: amountTotal })
      .where(and(eq(payments.provider, "stripe"), eq(payments.providerRef, sessionId), eq(payments.status, "in_attesa"))).returning();
    if (!p) return null;
    if (p.appointmentId) {
      await logEvent(tx, p.appointmentId, null, "pagamento_online", null, null, { amountCents: amountTotal, sessionId });
      const [a] = await tx.select().from(appointments).where(eq(appointments.id, p.appointmentId));
      const due = a.paymentMode === "saldo" ? (a.finalPriceCents ?? a.estimatedPriceCents ?? 0) : (a.depositCents ?? 0);
      if (a.status === "attesa_pagamento" && (await paidTotal(a.id, tx)) >= due) {
        await tx.update(appointments).set({ status: "confermata", updatedAt: new Date() }).where(eq(appointments.id, a.id));
        await logEvent(tx, a.id, null, "conferma_pagamento", "attesa_pagamento", "confermata");
        await notifyAppointmentConfirmed(a.id, tx);
        confirmedAppointmentId = a.id;
      }
    }
    if (p.orderId) {
      await tx.update(orders).set({ status: "pagato", updatedAt: new Date() }).where(and(eq(orders.id, p.orderId), eq(orders.status, "in_attesa")));
      await commitStock(tx, p.orderId, null);
    }
    return p;
  });
  if (!result) return;
  kickQueue();
  if (confirmedAppointmentId) await pushAppointmentConfirmed(confirmedAppointmentId);
  if (result.appointmentId) await scheduleOneSignalReminder(result.appointmentId);
  const [u] = result.customerId ? await db.select().from(users).where(eq(users.id, result.customerId)) : [];
  if (u) await notifyUser(u, { title: "Pagamento ricevuto", body: `Abbiamo ricevuto ${(amountTotal / 100).toFixed(2)} €. Grazie!`, url: result.orderId ? "/account/ordini" : "/account/appuntamenti" });
  await notifyStaff("pagamenti", { title: "Pagamento online ricevuto", body: `${(amountTotal / 100).toFixed(2)} € ${result.orderId ? "ordine #" + result.orderId : "appuntamento #" + result.appointmentId}`, url: "/admin/pagamenti" });
}

export default r;
