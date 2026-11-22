import { Router } from "express";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { requirePerm } from "../../auth";
import { h, zDay } from "../../util";
import { romeToDate, addDays, todayRome } from "../../time";

const r = Router();

const rows = async (q: any) => (await db.execute(q)).rows as any[];

r.get("/stats", requirePerm("statistiche"), h(async (req, res) => {
  const q = z.object({ from: zDay, to: zDay }).parse(req.query);
  const from = romeToDate(q.from, "00:00"), to = romeToDate(addDays(q.to, 1), "00:00");
  const paid = sql`p.status = 'pagato' and coalesce(p.paid_at, p.created_at) >= ${from} and coalesce(p.paid_at, p.created_at) < ${to}`;
  const signed = sql`case when p.kind = 'rimborso' then -p.amount_cents else p.amount_cents end`;
  const [revenue, selfservice, appsByStatus, byOperator, byService, newCustomers, monthly, hours, methods] = await Promise.all([
    rows(sql`select
        coalesce(sum(${signed}) filter (where p.appointment_id is not null), 0)::int as grooming,
        coalesce(sum(${signed}) filter (where p.order_id is not null), 0)::int as shop,
        coalesce(sum(${signed}) filter (where p.boarding_id is not null), 0)::int as boarding,
        coalesce(sum(${signed}) filter (where p.appointment_id is null and p.order_id is null and p.boarding_id is null), 0)::int as other
      from payments p where ${paid}`),
    rows(sql`select coalesce(sum(amount_cents),0)::int as total, count(*)::int as n from selfservice_incomes where income_date between ${q.from} and ${q.to}`),
    rows(sql`select status, count(*)::int as n from appointments where start_at >= ${from} and start_at < ${to} group by status`),
    rows(sql`select o.name, o.color, count(a.*)::int as n, coalesce(sum(a.duration_min),0)::int as minutes,
        coalesce(sum(coalesce(a.final_price_cents, a.estimated_price_cents)) filter (where a.status = 'completata'),0)::int as value
      from operators o left join appointments a on a.operator_id = o.id and a.start_at >= ${from} and a.start_at < ${to} and a.status in ('confermata','completata','attesa_pagamento')
      group by o.id order by n desc`),
    rows(sql`select s.name, count(*)::int as n from appointments a join services s on s.id = a.service_id
      where a.start_at >= ${from} and a.start_at < ${to} and a.status in ('confermata','completata') group by s.name order by n desc limit 10`),
    rows(sql`select count(*)::int as n from users where role = 'customer' and created_at >= ${from} and created_at < ${to}`),
    rows(sql`select to_char(date_trunc('month', coalesce(p.paid_at, p.created_at) at time zone 'Europe/Rome'), 'YYYY-MM') as month,
        coalesce(sum(${signed}),0)::int as payments
      from payments p where p.status = 'pagato' and coalesce(p.paid_at, p.created_at) >= ${romeToDate(addDays(todayRome(), -365), "00:00")}
      group by 1 order by 1`),
    rows(sql`select o.name, coalesce(sum(w.effective_min),0)::int as minutes, coalesce(sum(w.amount_cents),0)::int as cost
      from operators o left join work_logs w on w.operator_id = o.id and w.work_date between ${q.from} and ${q.to} group by o.id order by o.name`),
    rows(sql`select p.method, coalesce(sum(${signed}),0)::int as cents from payments p where ${paid} group by p.method`),
  ]);
  const ssMonthly = await rows(sql`select to_char(date_trunc('month', income_date), 'YYYY-MM') as month, sum(amount_cents)::int as cents
    from selfservice_incomes where income_date >= ${addDays(todayRome(), -365)} group by 1 order by 1`);
  res.json({
    revenue: revenue[0], selfservice: selfservice[0], appointmentsByStatus: appsByStatus, byOperator, topServices: byService,
    newCustomers: newCustomers[0]?.n ?? 0, monthly, selfserviceMonthly: ssMonthly, hours, methods,
  });
}));

/** Dati rapidi per la dashboard del gestionale */
r.get("/dashboard", h(async (req, res) => {
  const today = todayRome();
  const from = romeToDate(today, "00:00"), to = romeToDate(addDays(today, 1), "00:00");
  const [[counts], todayApps] = await Promise.all([
    rows(sql`select
      (select count(*) from appointments where status in ('richiesta','in_valutazione'))::int as pending,
      (select count(*) from appointments where change_request is not null and status not in ('annullata','rifiutata','completata'))::int as changes,
      (select count(*) from appointments where status = 'attesa_pagamento')::int as awaiting_payment,
      (select count(*) from boarding_requests where status = 'richiesta')::int as boarding,
      (select count(*) from orders where status in ('in_attesa','pagato'))::int as orders,
      (select count(*) from products where active and stock <= min_stock)::int as low_stock,
      (select count(*) from users where role = 'customer')::int as customers,
      (select coalesce(sum(case when kind='rimborso' then -amount_cents else amount_cents end),0) from payments where status='pagato' and coalesce(paid_at, created_at) >= ${from} and coalesce(paid_at, created_at) < ${to})::int as today_cents,
      (select coalesce(sum(amount_cents),0) from selfservice_incomes where income_date = ${today})::int as today_selfservice`),
    rows(sql`select a.id, a.start_at, a.end_at, a.status, s.name as service, d.name as dog, o.name as operator, o.color
      from appointments a join services s on s.id = a.service_id join dogs d on d.id = a.dog_id left join operators o on o.id = a.operator_id
      where a.start_at >= ${from} and a.start_at < ${to} and a.status in ('confermata','attesa_pagamento','completata','richiesta','in_valutazione') order by a.start_at`),
  ]);
  res.json({ counts, today: todayApps });
}));

export default r;
