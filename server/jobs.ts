// Job leggeri con un solo controllo orario: promemoria, richiami periodici, scadenza punti. Nessun polling continuo.
import { and, eq, gt, isNull, lte, inArray, sql } from "drizzle-orm";
import { db } from "./db";
import { appointments, users, services, dogs, operators } from "../shared/schema";
import { notifyUser } from "./services/notify";
import { getSettings } from "./services/settings";
import { expirePoints } from "./services/loyalty";
import { startEmailQueue } from "./services/email";
import { dateToRome, fmtRome } from "./time";

let running = false;

/** Promemoria N ore prima (default 24) per gli appuntamenti confermati; reminder_sent_at evita i duplicati. */
async function sendReminders() {
  const s = await getSettings();
  const until = new Date(Date.now() + s.notifications.reminderHours * 3600_000);
  const list = await db.select({ a: appointments, u: users, s: services.name, d: dogs.name, o: operators.name }).from(appointments)
    .innerJoin(users, eq(users.id, appointments.customerId)).innerJoin(services, eq(services.id, appointments.serviceId)).innerJoin(dogs, eq(dogs.id, appointments.dogId))
    .leftJoin(operators, eq(operators.id, appointments.operatorId))
    .where(and(gt(appointments.startAt, new Date()), lte(appointments.startAt, until), inArray(appointments.status, ["confermata", "attesa_pagamento"]), isNull(appointments.reminderSentAt)))
    .limit(200);
  for (const x of list) {
    const [claimed] = await db.update(appointments).set({ reminderSentAt: new Date() }).where(and(eq(appointments.id, x.a.id), isNull(appointments.reminderSentAt))).returning({ id: appointments.id });
    if (!claimed) continue;
    await notifyUser(x.u, {
      title: "Promemoria appuntamento", body: `${x.d}: ${x.s} ${fmtRome(x.a.startAt)}. Ti aspettiamo da Dog's Planet!`, url: "/account/appuntamenti",
      template: "promemoria", vars: { cane: x.d, servizio: x.s, data: fmtRome(x.a.startAt), operatore: x.o ?? "" }, dedupeKey: `reminder:${x.a.id}`,
    });
  }
}

/** Richiami periodici: invito a richiedere un nuovo appuntamento. Non crea mai prenotazioni. Una volta al giorno (10-11). */
async function sendRecalls() {
  const s = await getSettings();
  if (!s.notifications.recallEnabled) return;
  const hour = Number(dateToRome(new Date()).time.slice(0, 2));
  if (hour !== 10) return;
  const rows = (await db.execute(sql`
    select d.id as dog_id, d.name as dog, d.owner_id, coalesce(d.recall_days, ${s.notifications.recallDefaultDays ?? null}::int) as days, last.start_at as last_visit
    from dogs d
    join lateral (select a.start_at from appointments a where a.dog_id = d.id and a.status = 'completata' order by a.start_at desc limit 1) last on true
    join users u on u.id = d.owner_id and u.active and u.comm_recall
    where not d.archived and coalesce(d.recall_days, ${s.notifications.recallDefaultDays ?? null}::int) is not null
      and last.start_at + make_interval(days => coalesce(d.recall_days, ${s.notifications.recallDefaultDays ?? null}::int)) <= now()
      and (d.last_recall_at is null or d.last_recall_at < last.start_at)
      and not exists (select 1 from appointments f where f.dog_id = d.id and f.start_at > now() and f.status in ('richiesta','in_valutazione','proposta','confermata','attesa_pagamento'))
    limit 200`)).rows as any[];
  for (const r of rows) {
    const [claimed] = await db.update(dogs).set({ lastRecallAt: new Date() }).where(and(eq(dogs.id, r.dog_id), sql`(${dogs.lastRecallAt} is null or ${dogs.lastRecallAt} < ${r.last_visit})`)).returning({ id: dogs.id });
    if (!claimed) continue;
    const [u] = await db.select().from(users).where(eq(users.id, r.owner_id));
    if (!u) continue;
    await notifyUser(u, {
      title: `È ora di coccolare ${r.dog}!`, body: `Sono passati ${r.days} giorni dall'ultimo trattamento. Richiedi un nuovo appuntamento quando vuoi.`,
      url: "/richiedi-prenotazione", template: "richiamo", vars: { cane: r.dog, giorni: r.days }, dedupeKey: `recall:${r.dog_id}:${new Date(r.last_visit).toISOString().slice(0, 10)}`,
    });
  }
}

async function tick() {
  if (running) return; running = true;
  try {
    await sendReminders();
    await sendRecalls();
    await expirePoints();
  } catch (e) {
    console.error("[jobs]", (e as Error).message);
  } finally { running = false; }
}

export function startJobs() {
  startEmailQueue().catch((e) => console.error("[email]", e.message));
  if (process.env.DISABLE_JOBS === "1") return;
  setTimeout(tick, 60_000).unref();
  setInterval(tick, 60 * 60_000).unref();
}
