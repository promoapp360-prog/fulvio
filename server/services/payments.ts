// Pagamenti online tramite Stripe Checkout (API REST, nessun dato carta salvato da Dog's Planet).
import crypto from "node:crypto";

const STRIPE = "https://api.stripe.com/v1";
export const stripeEnabled = () => !!process.env.STRIPE_SECRET_KEY;

function form(obj: Record<string, string | number>) {
  return Object.entries(obj).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join("&");
}

export async function createCheckout(opts: { amountCents: number; description: string; email: string; successUrl: string; cancelUrl: string; metadata: Record<string, string> }) {
  if (!stripeEnabled()) throw new Error("Pagamenti online non configurati");
  const body: Record<string, string | number> = {
    mode: "payment",
    "line_items[0][quantity]": 1,
    "line_items[0][price_data][currency]": "eur",
    "line_items[0][price_data][unit_amount]": opts.amountCents,
    "line_items[0][price_data][product_data][name]": opts.description.slice(0, 250),
    customer_email: opts.email,
    success_url: opts.successUrl,
    cancel_url: opts.cancelUrl,
    locale: "it",
  };
  for (const [k, v] of Object.entries(opts.metadata)) { body[`metadata[${k}]`] = v; body[`payment_intent_data[metadata][${k}]`] = v; }
  const r = await fetch(`${STRIPE}/checkout/sessions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: form(body),
  });
  const j: any = await r.json();
  if (!r.ok) throw new Error(j?.error?.message || "Errore creazione pagamento");
  return { id: j.id as string, url: j.url as string };
}

export async function retrieveCheckout(id: string) {
  const r = await fetch(`${STRIPE}/checkout/sessions/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` } });
  if (!r.ok) throw new Error("Sessione di pagamento non trovata");
  return r.json() as Promise<any>;
}

/** Verifica la firma del webhook Stripe (header Stripe-Signature) sul body grezzo. */
export function verifyStripeSignature(raw: Buffer, header: string | undefined, toleranceSec = 300) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !header) return false;
  const items = Object.fromEntries(header.split(",").map((kv) => kv.split("=") as [string, string]));
  const t = Number(items.t);
  const sigs = header.split(",").filter((s) => s.startsWith("v1=")).map((s) => s.slice(3));
  if (!t || !sigs.length || Math.abs(Date.now() / 1000 - t) > toleranceSec) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${t}.${raw.toString("utf8")}`).digest("hex");
  return sigs.some((s) => s.length === expected.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
}
