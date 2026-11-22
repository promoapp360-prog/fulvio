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

type CartItem = { productId: number; qty: number; name: string; priceCents: number };
const KEY = "dp-cart";
const readCart = (): CartItem[] => { try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; } };

export default function ShopPage() {
  const { data: s } = usePublicSettings();
  const { data, isLoading } = useQuery<any>({ queryKey: ["products"], queryFn: () => get("/api/public/products") });
  const { data: me } = useMe();
  const [, nav] = useLocation();
  const toast = useToast();
  const [cart, setCart] = useState<CartItem[]>(readCart);
  const [cat, setCat] = useState<string>("");
  const [checkout, setCheckout] = useState(false);
  const [notes, setNotes] = useState("");
  const [promo, setPromo] = useState("");
  const [err, setErr] = useState<unknown>(null);
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(cart)); } catch {} }, [cart]);

  if (isLoading) return <Spinner />;
  if (!data?.enabled) {
    return (
      <CmsPage slug="pet-shop" mascot="pet-shop" fallbackTitle="Pet Shop">
        <div className="mt-10 flex items-center gap-4 rounded-3xl bg-brand-sky p-6"><Mascot kind="pet-shop" className="h-24" /><p className="text-lg font-bold text-brand-navy">Lo shop on line è in arrivo. Torna a trovarci presto!</p></div>
      </CmsPage>
    );
  }
  const products: any[] = data.rows;
  const cats = Array.from(new Set(products.map((p) => p.category)));
  const add = (p: any) => {
    setCart((c) => { const ex = c.find((x) => x.productId === p.id); const price = p.salePriceCents ?? p.priceCents;
      if (ex) return c.map((x) => (x.productId === p.id ? { ...x, qty: Math.min(x.qty + 1, p.stock) } : x));
      return [...c, { productId: p.id, qty: 1, name: p.name, priceCents: price }]; });
    toast(`${p.name} aggiunto al carrello`);
  };
  const total = cart.reduce((a, x) => a + x.qty * x.priceCents, 0);
  const submit = async () => {
    setErr(null);
    try {
      const r = await post("/api/account/orders", { items: cart.map(({ productId, qty }) => ({ productId, qty })), delivery: "ritiro", notes: notes || null, promoCode: promo || null });
      setCart([]); setCheckout(false);
      if (r.paymentUrl) window.location.href = r.paymentUrl; else { toast("Ordine inviato! Ti avviseremo quando sarà pronto."); nav("/account/ordini"); }
    } catch (e) { setErr(e); }
  };

  return (
    <CmsPage slug="pet-shop" mascot="pet-shop" fallbackTitle="Pet Shop">
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
              <p className="text-xs font-bold uppercase text-slate-400">{p.category}</p>
              <h3 className="font-bold">{p.name}</h3>
              {p.description && <p className="mt-1 line-clamp-3 text-sm text-slate-600">{p.description}</p>}
              <div className="mt-auto flex items-center justify-between pt-3">
                <span className="font-bold text-brand-navy">{p.salePriceCents != null && <s className="mr-1 text-xs text-slate-400">{euro(p.priceCents)}</s>}{euro(p.salePriceCents ?? p.priceCents)}</span>
                <button className="btn-primary btn-sm" disabled={p.stock <= 0} onClick={() => add(p)}>{p.stock > 0 ? "Aggiungi" : "Esaurito"}</button>
              </div>
            </article>
          ))}
        </div>
      )}
      <Modal open={checkout} onClose={() => setCheckout(false)} title="Il tuo carrello">
        {cart.length === 0 ? <Empty>Il carrello è vuoto</Empty> : (
          <div className="space-y-3">
            {cart.map((x) => (
              <div key={x.productId} className="flex items-center gap-2 border-b border-slate-100 pb-2">
                <span className="flex-1 text-sm font-semibold">{x.name}</span>
                <button className="btn-ghost btn-sm" onClick={() => setCart(cart.map((c) => c.productId === x.productId ? { ...c, qty: Math.max(1, c.qty - 1) } : c))} aria-label="Meno"><Minus size={14} /></button>
                <span className="w-6 text-center">{x.qty}</span>
                <button className="btn-ghost btn-sm" onClick={() => setCart(cart.map((c) => c.productId === x.productId ? { ...c, qty: c.qty + 1 } : c))} aria-label="Più"><Plus size={14} /></button>
                <span className="w-20 text-right text-sm">{euro(x.qty * x.priceCents)}</span>
                <button className="btn-ghost btn-sm text-red-600" onClick={() => setCart(cart.filter((c) => c.productId !== x.productId))} aria-label="Rimuovi"><Trash2 size={14} /></button>
              </div>
            ))}
            <p className="text-right text-lg font-bold">Totale {euro(total)}</p>
            <p className="text-sm text-slate-600">{s?.shop?.pickupOnly ? "Ritiro in negozio." : ""}</p>
            <Field label="Codice promozionale"><input className="input" value={promo} onChange={(e) => setPromo(e.target.value.toUpperCase())} /></Field>
            <Field label="Note"><textarea className="input" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
            <ErrorBox error={err} />
            {me ? <button className="btn-primary w-full" onClick={submit}>Conferma ordine</button> : <Link href="/login?next=/pet-shop" className="btn-primary w-full">Accedi per ordinare</Link>}
          </div>
        )}
      </Modal>
    </CmsPage>
  );
}
