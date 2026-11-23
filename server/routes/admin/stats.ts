import { Router } from "express";
import { z } from "zod";
import { sql, type SQL } from "drizzle-orm";
import { db } from "../../db";
import { requirePerm } from "../../auth";
import { sendXlsx, sendPdf, type Sheet } from "../../services/exporter";
import { h, zDay } from "../../util";
import { romeToDate, addDays, todayRome } from "../../time";
import { STATUS_LABELS, PAYMENT_METHODS } from "../../../shared/constants";

const r = Router();
const rows = async (q: SQL) => (await db.execute(q)).rows as any[];

const filters = z.object({
  from: zDay, to: zDay,
  serviceId: z.coerce.number().int().optional(), operatorId: z.coerce.number().int().optional(),
  method: z.string().max(30).optional(), category: z.string().max(80).optional(),
  channel: z.enum(["toelettatura", "selfservice", "shop_online", "shop_negozio", "pensione"]).optional(),
  format: z.enum(["xlsx", "pdf"]).optional(),
});

/** Report con dati derivati esclusivamente dalle operazioni registrate (punto 27). */
async function buildStats(q: z.infer<typeof filters>) {
  const from = romeToDate(q.from, "00:00"), to = romeToDate(addDays(q.to, 1), "00:00");
  const pWhen = sql`p.status = 'pagato' and coalesce(p.paid_at, p.created_at) >= ${from} and coalesce(p.paid_at, p.created_at) < ${to}`;
  const signed = sql`case when p.kind = 'rimborso' then -p.amount_cents else p.amount_cents end`;
  const pFilters: SQL[] = [];
  if (q.method) pFilters.push(sql`p.method = ${q.method}`);
  if (q.serviceId) pFilters.push(sql`exists (select 1 from appointments a where a.id = p.appointment_id and a.service_id = ${q.serviceId})`);
  if (q.operatorId) pFilters.push(sql`exists (select 1 from appointments a where a.id = p.appointment_id and a.operator_id = ${q.operatorId})`);
  if (q.category) pFilters.push(sql`exists (select 1 from order_items oi join products pr on pr.id = oi.product_id where oi.order_id = p.order_id and pr.category = ${q.category})`);
  if (q.channel === "toelettatura") pFilters.push(sql`p.appointment_id is not null`);
  if (q.channel === "shop_online") pFilters.push(sql`exists (select 1 from orders o where o.id = p.order_id and o.channel = 'online')`);
  if (q.channel === "shop_negozio") pFilters.push(sql`exists (select 1 from orders o where o.id = p.order_id and o.channel = 'negozio')`);
  if (q.channel === "pensione") pFilters.push(sql`p.boarding_id is not null`);
  if (q.channel === "selfservice") pFilters.push(sql`false`);
  const pf = pFilters.length ? sql.join([sql``, ...pFilters], sql` and `) : sql``;
  const aF: SQL[] = [];
  if (q.serviceId) aF.push(sql`a.service_id = ${q.serviceId}`);
  if (q.operatorId) aF.push(sql`a.operator_id = ${q.operatorId}`);
  const af = aF.length ? sql.join([sql``, ...aF], sql` and `) : sql``;
  const ssOn = !q.channel || q.channel === "selfservice";
  const ssF = q.method ? sql` and method = ${q.method}` : sql``;

  const [revenue, ss, byStatus, byOperator, byService, daily, monthly, methods, newCustomers, regulars, hours, points, topProducts, shopSales, ssMonthly] = await Promise.all([
    rows(sql`select
        coalesce(sum(${signed}) filter (where p.appointment_id is not null), 0)::int as grooming,
        coalesce(sum(${signed}) filter (where p.order_id is not null), 0)::int as shop,
        coalesce(sum(${signed}) filter (where p.boarding_id is not null), 0)::int as boarding,
        coalesce(sum(${signed}) filter (where p.appointment_id is null and p.order_id is null and p.boarding_id is null), 0)::int as other,
        coalesce(sum(p.amount_cents) filter (where p.kind = 'acconto'), 0)::int as deposits,
        coalesce(sum(p.amount_cents) filter (where p.kind = 'rimborso'), 0)::int as refunds
      from payments p where ${pWhen}${pf}`),
    ssOn ? rows(sql`select coalesce(sum(amount_cents),0)::int as total, count(*)::int as n from selfservice_incomes where income_date between ${q.from} and ${q.to}${ssF}`) : [{ total: 0, n: 0 }],
    rows(sql`select status, count(*)::int as n from appointments a where a.start_at >= ${from} and a.start_at < ${to}${af} group by status`),
    rows(sql`select o.id, o.name, o.color,
        count(a.*) filter (where a.status in ('confermata','completata','attesa_pagamento'))::int as n,
        coalesce(sum(a.duration_min) filter (where a.status in ('confermata','completata','attesa_pagamento')),0)::int as booked_minutes,
        coalesce((select sum(case when p.kind='rimborso' then -p.amount_cents else p.amount_cents end) from payments p join appointments a2 on a2.id = p.appointment_id
           where a2.operator_id = o.id and ${pWhen}${pf}),0)::int as revenue
      from operators o left join appointments a on a.operator_id = o.id and a.start_at >= ${from} and a.start_at < ${to}${af}
      where ${q.operatorId ? sql`o.id = ${q.operatorId}` : sql`true`} group by o.id order by revenue desc`),
    rows(sql`select s.name, count(distinct a.id)::int as n,
        coalesce(sum(case when p.kind='rimborso' then -p.amount_cents else p.amount_cents end) filter (where ${pWhen}),0)::int as revenue
      from appointments a join services s on s.id = a.service_id left join payments p on p.appointment_id = a.id
      where a.start_at >= ${from} and a.start_at < ${to} and a.status in ('confermata','completata')${af} group by s.name order by revenue desc, n desc limit 15`),
    rows(sql`select to_char(coalesce(p.paid_at, p.created_at) at time zone 'Europe/Rome', 'YYYY-MM-DD') as day, coalesce(sum(${signed}),0)::int as cents
      from payments p where ${pWhen}${pf} group by 1 order by 1`),
    rows(sql`select to_char(date_trunc('month', coalesce(p.paid_at, p.created_at) at time zone 'Europe/Rome'), 'YYYY-MM') as month, coalesce(sum(${signed}),0)::int as payments
      from payments p where p.status = 'pagato' and coalesce(p.paid_at, p.created_at) >= ${romeToDate(addDays(todayRome(), -365), "00:00")}${pf} group by 1 order by 1`),
    rows(sql`select p.method, coalesce(sum(${signed}),0)::int as cents from payments p where ${pWhen}${pf} group by p.method`),
    rows(sql`select count(*)::int as n from users where role = 'customer' and created_at >= ${from} and created_at < ${to}`),
    rows(sql`select count(*)::int as n from (select customer_id from appointments where status = 'completata' and start_at >= ${romeToDate(addDays(q.to, -365), "00:00")} and start_at < ${to} group by customer_id having count(*) >= 4) x`),
    rows(sql`select o.name, coalesce(sum(w.effective_min),0)::int as minutes, coalesce(sum(w.amount_cents),0)::int as cost
      from operators o left join work_logs w on w.operator_id = o.id and w.work_date between ${q.from} and ${q.to}
      where ${q.operatorId ? sql`o.id = ${q.operatorId}` : sql`true`} group by o.id order by o.name`),
    rows(sql`select coalesce(sum(points) filter (where kind in ('accumulo') or (kind = 'rettifica' and points > 0)),0)::int as assigned,
        coalesce(-sum(points) filter (where kind = 'utilizzo'),0)::int as used, coalesce(-sum(points) filter (where kind = 'scadenza'),0)::int as expired,
        coalesce(-sum(points) filter (where kind = 'storno' and points < 0),0)::int as reversed
      from loyalty_transactions where created_at >= ${from} and created_at < ${to}`),
    rows(sql`select oi.name, sum(oi.qty)::int as qty, sum(oi.qty * oi.unit_price_cents)::int as cents
      from order_items oi join orders o on o.id = oi.order_id left join products pr on pr.id = oi.product_id
      where o.status not in ('annullato','in_attesa') and o.created_at >= ${from} and o.created_at < ${to}
        ${q.category ? sql`and pr.category = ${q.category}` : sql``}
        ${q.channel === "shop_online" ? sql`and o.channel = 'online'` : q.channel === "shop_negozio" ? sql`and o.channel = 'negozio'` : sql``}
      group by oi.name order by qty desc limit 10`),
    rows(sql`select o.channel, count(*)::int as n, coalesce(sum(o.total_cents),0)::int as cents from orders o
      where o.status not in ('annullato','in_attesa') and o.created_at >= ${from} and o.created_at < ${to} group by o.channel`),
    ssOn ? rows(sql`select to_char(date_trunc('month', income_date), 'YYYY-MM') as month, sum(amount_cents)::int as cents
      from selfservice_incomes where income_date >= ${addDays(todayRome(), -365)}${ssF} group by 1 order by 1`) : [],
  ]);
  const st = Object.fromEntries(byStatus.map((s: any) => [s.status, s.n]));
  return {
    revenue: revenue[0], selfservice: ss[0], appointmentsByStatus: byStatus,
    kpi: { pending: (st.richiesta || 0) + (st.in_valutazione || 0), confirmed: st.confermata || 0, completed: st.completata || 0, cancelled: st.annullata || 0, noShows: st.assente || 0, rejected: st.rifiutata || 0 },
    byOperator, topServices: byService, daily, monthly, methods, newCustomers: newCustomers[0]?.n ?? 0, regularCustomers: regulars[0]?.n ?? 0,
    hours, points: points[0], topProducts, shopSales, selfserviceMonthly: ssMonthly,
  };
}

r.get("/stats", requirePerm("statistiche"), h(async (req, res) => {
  const q = filters.parse(req.query);
  const d = await buildStats(q);
  if (!q.format) return res.json(d);
  const sheets: Sheet[] = [
    { name: "Riepilogo", columns: [{ key: "voce", label: "Voce", width: 30 }, { key: "valore", label: "Valore", width: 16 }, { key: "euro", label: "Importo", money: true, width: 14 }], rows: [
      { voce: "Incassi toelettatura", euro: d.revenue.grooming }, { voce: "Incassi self-service", euro: d.selfservice.total }, { voce: "Incassi shop", euro: d.revenue.shop },
      { voce: "Incassi pensione", euro: d.revenue.boarding }, { voce: "Altri incassi", euro: d.revenue.other }, { voce: "di cui acconti", euro: d.revenue.deposits }, { voce: "Rimborsi", euro: d.revenue.refunds },
      { voce: "Appuntamenti completati", valore: d.kpi.completed }, { voce: "Appuntamenti confermati", valore: d.kpi.confirmed }, { voce: "Richieste da confermare", valore: d.kpi.pending },
      { voce: "Annullati", valore: d.kpi.cancelled }, { voce: "Assenze", valore: d.kpi.noShows }, { voce: "Clienti nuovi", valore: d.newCustomers }, { voce: "Clienti abituali (≥4 visite in 12 mesi)", valore: d.regularCustomers },
      { voce: "Punti assegnati", valore: d.points.assigned }, { voce: "Punti utilizzati", valore: d.points.used }, { voce: "Punti scaduti", valore: d.points.expired },
    ] },
    { name: "Per operatore", columns: [{ key: "name", label: "Operatore", width: 16 }, { key: "n", label: "Appuntamenti", width: 12 }, { key: "booked_minutes", label: "Minuti prenotati", width: 14 }, { key: "revenue", label: "Incassi", money: true, width: 14 }], rows: d.byOperator },
    { name: "Per servizio", columns: [{ key: "name", label: "Servizio", width: 26 }, { key: "n", label: "Appuntamenti", width: 12 }, { key: "revenue", label: "Incassi", money: true, width: 14 }], rows: d.topServices },
    { name: "Incassi giornalieri", columns: [{ key: "day", label: "Giorno", width: 14 }, { key: "cents", label: "Incasso", money: true, width: 14 }], rows: d.daily },
    { name: "Metodi di pagamento", columns: [{ key: "metodo", label: "Metodo", width: 20 }, { key: "cents", label: "Importo", money: true, width: 14 }], rows: d.methods.map((m: any) => ({ ...m, metodo: PAYMENT_METHODS[m.method] || m.method })) },
    { name: "Prodotti più venduti", columns: [{ key: "name", label: "Prodotto", width: 28 }, { key: "qty", label: "Quantità", width: 10 }, { key: "cents", label: "Venduto", money: true, width: 14 }], rows: d.topProducts },
    { name: "Ore e compensi", columns: [{ key: "name", label: "Operatore", width: 16 }, { key: "ore", label: "Ore", width: 10 }, { key: "cost", label: "Compensi", money: true, width: 14 }], rows: d.hours.map((x: any) => ({ ...x, ore: (x.minutes / 60).toFixed(2).replace(".", ",") })) },
    { name: "Stati appuntamenti", columns: [{ key: "stato", label: "Stato", width: 22 }, { key: "n", label: "Numero", width: 10 }], rows: d.appointmentsByStatus.map((s: any) => ({ stato: STATUS_LABELS[s.status], n: s.n })) },
  ];
  const fn = `report-${q.from}-${q.to}`;
  return q.format === "xlsx" ? sendXlsx(res, fn, sheets) : sendPdf(res, fn, "Report Dog's Planet", `Periodo ${q.from} – ${q.to}`, sheets);
}));

/** Dati rapidi per la dashboard del gestionale */
r.get("/dashboard", h(async (_req, res) => {
  const today = todayRome();
  const from = romeToDate(today, "00:00"), to = romeToDate(addDays(today, 1), "00:00");
  const monthFrom = romeToDate(today.slice(0, 8) + "01", "00:00");
  const [[counts], todayApps] = await Promise.all([
    rows(sql`select
      (select count(*) from appointments where status in ('richiesta','in_valutazione'))::int as pending,
      (select count(*) from appointments where change_request is not null and status not in ('annullata','rifiutata','completata'))::int as changes,
      (select count(*) from guest_bookings where status in ('richiesta','in_valutazione','proposta'))::int as pending_guest,
      ((select count(*) from appointments where status in ('richiesta','in_valutazione') or (change_request is not null and status not in ('richiesta','in_valutazione','annullata','rifiutata','completata')))
        + (select count(*) from guest_bookings where status in ('richiesta','in_valutazione','proposta')))::int as actionable_requests,
      (select count(*) from appointments where status = 'attesa_pagamento')::int as awaiting_payment,
      (select count(*) from appointments where start_at >= ${from} and start_at < ${to} and status in ('confermata','attesa_pagamento','completata'))::int as today_apps,
      (select count(*) from appointments where start_at >= ${monthFrom} and status = 'annullata')::int as month_cancelled,
      (select count(*) from appointments where start_at >= ${monthFrom} and status = 'assente')::int as month_noshow,
      (select count(*) from boarding_requests where status = 'richiesta')::int as boarding,
      (select count(*) from orders where status in ('in_attesa','pagato'))::int as orders,
      (select count(*) from products where active and stock <= min_stock)::int + (select count(*) from product_variants where active and stock <= min_stock)::int as low_stock,
      (select count(*) from users where role = 'customer')::int as customers,
      (select count(*) from email_queue where status = 'fallita')::int as failed_emails,
      (select coalesce(sum(case when kind='rimborso' then -amount_cents else amount_cents end),0) from payments where status='pagato' and coalesce(paid_at, created_at) >= ${from} and coalesce(paid_at, created_at) < ${to})::int as today_cents,
      (select coalesce(sum(case when kind='rimborso' then -amount_cents else amount_cents end),0) from payments where status='pagato' and coalesce(paid_at, created_at) >= ${monthFrom})::int as month_cents,
      (select coalesce(sum(amount_cents),0) from selfservice_incomes where income_date = ${today})::int as today_selfservice`),
    rows(sql`select a.id, a.start_at, a.end_at, a.status, s.name as service, d.name as dog, o.name as operator, o.color
      from appointments a join services s on s.id = a.service_id join dogs d on d.id = a.dog_id left join operators o on o.id = a.operator_id
      where a.start_at >= ${from} and a.start_at < ${to} and a.status in ('confermata','attesa_pagamento','completata','richiesta','in_valutazione') order by a.start_at`),
  ]);
  res.json({ counts, today: todayApps });
}));

export default r;
