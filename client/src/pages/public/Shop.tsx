import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ShoppingBag, Minus, Plus, Trash2 } from "lucide-react";
import CmsPage from "@/components/CmsPage";
import { Mascot } from "@/components/brand";
import { Spinner, Empty, ErrorBox, Field, Modal, useToast } from "@/components/ui";
import { get, post } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { usePublicSettings } from "@/lib/settings";
import { euro } from "@shared/constants";
import { PUBLIC_COPY } from "@shared/public-copy";

type CartItem = { productId: number; variantId: number | null; qty: number; name: string; priceCents: number };
const KEY = "dp-cart";
const readCart = (): CartItem[] => { try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; } };
const same = (a: CartItem, p: number, v: number | null) => a.productId === p && (a.variantId ?? null) === v;

export default function ShopPage() {
  const { data: s } = usePublicSettings();
  const { data, isLoading } = useQuery<any>({ queryKey: ["products"], queryFn: () => get("/api/public/products") });
  const { data: me } = useMe();
  const toast = useToast();
  const [cart, setCart] = useState<CartItem[]>(readCart);
  const [cat, setCat] = useState<string>("");
  const [detail, setDetail] = useState<any>(null);
  const [checkout, setCheckout] = useState(false);
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(cart)); } catch {} }, [cart]);

  if (isLoading) return <Spinner />;
  if (!data?.enabled) {
    return (
      <CmsPage slug="pet-shop" title="#LaPappadiPoppy" subtitle="Coming Soon" hideBody hideMedia>
        <div className="mx-auto flex max-w-3xl flex-col items-center gap-6 rounded-3xl bg-brand-sky p-6 text-brand-navy sm:flex-row">
          <Mascot kind="pet-shop" className="h-56 shrink-0 sm:h-64" />
          <p className="text-lg font-semibold leading-relaxed">{PUBLIC_COPY.shop}</p>
        </div>
      </CmsPage>
    );
  }
  const products: any[] = data.rows;
  const cats: string[] = data.categories?.length ? data.categories : Array.from(new Set(products.map((p) => p.category)));
  const add = (p: any, v: any | null) => {
    const price = v?.priceCents ?? p.salePriceCents ?? p.priceCents;
    const name = v ? `${p.name} – ${v.name}` : p.name;
    setCart((c) => c.some((x) => same(x, p.id, v?.id ?? null)) ? c.map((x) => (same(x, p.id, v?.id ?? null) ? { ...x, qty: x.qty + 1 } : x)) : [...c, { productId: p.id, variantId: v?.id ?? null, qty: 1, name, priceCents: price }]);
    toast(`${name} aggiunto al carrello`);
  };
  const open = async (p: any) => { if (p.hasVariants) setDetail(await get(`/api/public/products/${p.id}`)); else add(p, null); };

  return (
    <CmsPage slug="pet-shop" mascot="pet-shop" title="#LaPappadiPoppy" subtitle="">
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <button className={`btn-sm ${!cat ? "btn-navy" : "btn-outline"}`} onClick={() => setCat("")}>Tutti</button>
          {cats.map((c) => <button key={c} className={`btn-sm ${cat === c ? "btn-navy" : "btn-outline"}`} onClick={() => setCat(c)}>{c}</button>)}
        </div>
        <button className="btn-primary" onClick={() => setCheckout(true)} disabled={!cart.length}><ShoppingBag size={16} /> Carrello ({cart.reduce((a, x) => a + x.qty, 0)})</button>
      </div>
      {products.length === 0 ? <div className="mt-6"><Empty>Nessun prodotto disponibile al momento.</Empty></div> : (
        <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {products.filter((p) => !cat || p.category === cat).map((p) => (
            <article key={p.id} className="card flex flex-col">
              <div className="mb-3 grid aspect-square place-items-center overflow-hidden rounded-2xl bg-brand-sky">
                {p.imageUrl ? <img src={p.imageUrl} alt={p.name} loading="lazy" className="h-full w-full object-cover" /> : <Mascot kind="pet-shop" className="h-24" />}
              </div>
              <p className="text-xs font-bold uppercase text-slate-400">{p.category}{p.isFood && " · Alimenti"}</p>
              <h3 className="font-bold">{p.name}</h3>
              {p.description && <p className="mt-1 line-clamp-3 text-sm text-slate-600">{p.description}</p>}
              <div className="mt-auto flex items-center justify-between pt-3">
                <span className="font-bold text-brand-navy">{p.salePriceCents != null && <s className="mr-1 text-xs text-slate-400">{euro(p.priceCents)}</s>}{p.hasVariants && "da "}{euro(p.salePriceCents ?? p.priceCents)}</span>
                <button className="btn-primary btn-sm" disabled={p.stock <= 0} onClick={() => open(p)}>{p.stock <= 0 ? "Esaurito" : p.hasVariants ? "Scegli" : "Aggiungi"}</button>
              </div>
            </article>
          ))}
        </div>
      )}
      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail?.name || ""}>
        {detail && <div className="space-y-2">
          {detail.description && <p className="text-sm text-slate-600">{detail.description}</p>}
          {detail.variants.map((v: any) => (
            <div key={v.id} className="flex items-center justify-between rounded-xl border p-2 text-sm">
              <span>{v.name}</span><span className="font-bold">{euro(v.priceCents ?? detail.salePriceCents ?? detail.priceCents)}</span>
              <button className="btn-primary btn-sm" disabled={v.stock <= 0} onClick={() => { add(detail, v); setDetail(null); }}>{v.stock > 0 ? "Aggiungi" : "Esaurito"}</button>
            </div>
          ))}
        </div>}
      </Modal>
      <Modal open={checkout} onClose={() => setCheckout(false)} title="Il tuo carrello">
        <Checkout cart={cart} setCart={setCart} settings={s} me={me} onDone={() => setCheckout(false)} />
      </Modal>
    </CmsPage>
  );
}

function Checkout({ cart, setCart, settings, me, onDone }: { cart: CartItem[]; setCart: (c: CartItem[]) => void; settings: any; me: any; onDone: () => void }) {
  const toast = useToast();
  const [, nav] = useLocation();
  const shop = settings?.shop || {};
  const [delivery, setDelivery] = useState<"ritiro" | "consegna">(shop.pickupEnabled !== false ? "ritiro" : "consegna");
  const [addr, setAddr] = useState({ address: me?.address || "", city: me?.city || "", cap: me?.cap || "" });
  const [promo, setPromo] = useState("");
  const [points, setPoints] = useState(0);
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const subtotal = cart.reduce((a, x) => a + x.qty * x.priceCents, 0);
  const { data: quote } = useQuery<any>({ queryKey: ["dq", addr.cap, subtotal], enabled: delivery === "consegna" && /^\d{5}$/.test(addr.cap) && !!me, queryFn: () => get(`/api/account/delivery-quote?cap=${addr.cap}&subtotal=${subtotal}`) });
  const { data: loyalty } = useQuery<any>({ queryKey: ["acc-loyalty"], queryFn: () => get("/api/account/loyalty"), enabled: !!me && settings?.loyaltyRules?.pointValueCents > 0 });
  const pv = settings?.loyaltyRules?.pointValueCents || 0;
  const pointsValue = Math.min(points * pv, subtotal);
  const submit = async () => {
    setErr(null); setBusy(true);
    try {
      const r = await post("/api/account/orders", { items: cart.map(({ productId, variantId, qty }) => ({ productId, variantId, qty })), delivery, notes: notes || null, promoCode: promo || null, pointsToUse: points, ...(delivery === "consegna" ? addr : {}) });
      setCart([]); onDone();
      if (r.paymentUrl) window.location.href = r.paymentUrl; else { toast("Ordine inviato! Riceverai la conferma via email."); nav("/account/ordini"); }
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  if (!cart.length) return <Empty>Il carrello è vuoto</Empty>;
  return (
    <div className="space-y-3">
      {cart.map((x) => (
        <div key={`${x.productId}-${x.variantId}`} className="flex items-center gap-2 border-b border-slate-100 pb-2">
          <span className="flex-1 text-sm font-semibold">{x.name}</span>
          <button className="btn-ghost btn-sm" onClick={() => setCart(cart.map((c) => same(c, x.productId, x.variantId) ? { ...c, qty: Math.max(1, c.qty - 1) } : c))} aria-label="Meno"><Minus size={14} /></button>
          <span className="w-6 text-center">{x.qty}</span>
          <button className="btn-ghost btn-sm" onClick={() => setCart(cart.map((c) => same(c, x.productId, x.variantId) ? { ...c, qty: c.qty + 1 } : c))} aria-label="Più"><Plus size={14} /></button>
          <span className="w-20 text-right text-sm">{euro(x.qty * x.priceCents)}</span>
          <button className="btn-ghost btn-sm text-red-600" onClick={() => setCart(cart.filter((c) => !same(c, x.productId, x.variantId)))} aria-label="Rimuovi"><Trash2 size={14} /></button>
        </div>
      ))}
      <div className="grid gap-2 sm:grid-cols-2">
        {shop.pickupEnabled !== false && <label className={`cursor-pointer rounded-xl border-2 p-3 text-sm ${delivery === "ritiro" ? "border-brand-turquoise bg-brand-sky" : "border-slate-200"}`}><input type="radio" className="mr-2" checked={delivery === "ritiro"} onChange={() => setDelivery("ritiro")} /><b>Ritiro gratuito in negozio</b><span className="block text-xs text-slate-500">{shop.pickupInfo}</span></label>}
        {shop.deliveryEnabled && <label className={`cursor-pointer rounded-xl border-2 p-3 text-sm ${delivery === "consegna" ? "border-brand-turquoise bg-brand-sky" : "border-slate-200"}`}><input type="radio" className="mr-2" checked={delivery === "consegna"} onChange={() => setDelivery("consegna")} /><b>Consegna a domicilio</b><span className="block text-xs text-slate-500">A pagamento, nelle zone servite</span></label>}
      </div>
      {delivery === "consegna" && (
        <div className="grid gap-2 sm:grid-cols-3">
          <Field label="Indirizzo" className="sm:col-span-3"><input className="input" value={addr.address} onChange={(e) => setAddr({ ...addr, address: e.target.value })} /></Field>
          <Field label="Comune" className="sm:col-span-2"><input className="input" value={addr.city} onChange={(e) => setAddr({ ...addr, city: e.target.value })} /></Field>
          <Field label="CAP"><input className="input" inputMode="numeric" maxLength={5} value={addr.cap} onChange={(e) => setAddr({ ...addr, cap: e.target.value })} /></Field>
          {/^\d{5}$/.test(addr.cap) && <p className="text-sm sm:col-span-3">{quote ? <>Zona {quote.zone}: consegna {quote.costCents ? euro(quote.costCents) : "gratuita"}{quote.eta ? ` · ${quote.eta}` : ""}</> : quote === null ? <span className="text-red-600">CAP non servito dalla consegna</span> : "Calcolo…"}</p>}
        </div>
      )}
      <Field label="Codice promozionale"><input className="input" value={promo} onChange={(e) => setPromo(e.target.value.toUpperCase())} /></Field>
      {pv > 0 && loyalty && loyalty.card.points > 0 && (
        <Field label={`Usa i punti Fidelity (disponibili ${loyalty.card.points}, 1 punto = ${euro(pv)})`}>
          <input type="number" min={0} max={loyalty.card.points} className="input" value={points} onChange={(e) => setPoints(Math.max(0, Math.min(loyalty.card.points, Number(e.target.value) || 0)))} />
        </Field>
      )}
      <Field label="Note"><textarea className="input" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      <div className="rounded-xl bg-slate-50 p-3 text-sm">
        <div className="flex justify-between"><span>Subtotale</span><span>{euro(subtotal)}</span></div>
        {pointsValue > 0 && <div className="flex justify-between"><span>Sconto punti</span><span>−{euro(pointsValue)}</span></div>}
        {delivery === "consegna" && quote && <div className="flex justify-between"><span>Consegna</span><span>{euro(quote.costCents)}</span></div>}
        <p className="mt-1 text-xs text-slate-500">L'eventuale codice promozionale viene applicato alla conferma.</p>
      </div>
      <ErrorBox error={err} />
      {me ? <button className="btn-primary w-full" disabled={busy || (delivery === "consegna" && !quote)} onClick={submit}>Conferma ordine</button> : <Link href="/login?next=/pet-shop" className="btn-primary w-full">Accedi per ordinare</Link>}
    </div>
  );
}
