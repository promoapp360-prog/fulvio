// Job leggeri: un controllo all'ora per i promemoria del giorno dopo (nessun polling continuo).
import { and, eq, gte, lt, isNull, inArray } from "drizzle-orm";
import { db } from "./db";
import { appointments, users, services, dogs } from "../shared/schema";
import { notifyUser } from "./services/notify";
import { romeToDate, addDays, todayRome, dateToRome } from "./time";

let running = false;

async function sendReminders() {
  if (running) return; running = true;
  try {
    const now = dateToRome(new Date());
    if (Number(now.time.slice(0, 2)) < 9 || Number(now.time.slice(0, 2)) > 20) return; // solo in orario civile
    const tomorrow = addDays(todayRome(), 1);
    const from = romeToDate(tomorrow, "00:00"), to = romeToDate(addDays(tomorrow, 1), "00:00");
    const list = await db.select({ a: appointments, u: users, s: services.name, d: dogs.name }).from(appointments)
      .innerJoin(users, eq(users.id, appointments.customerId)).innerJoin(services, eq(services.id, appointments.serviceId)).innerJoin(dogs, eq(dogs.id, appointments.dogId))
      .where(and(gte(appointments.startAt, from), lt(appointments.startAt, to), inArray(appointments.status, ["confermata", "attesa_pagamento"]), isNull(appointments.reminderSentAt)))
      .limit(100);
    for (const x of list) {
      const [claimed] = await db.update(appointments).set({ reminderSentAt: new Date() }).where(and(eq(appointments.id, x.a.id), isNull(appointments.reminderSentAt))).returning({ id: appointments.id });
      if (!claimed) continue;
      await notifyUser(x.u, { title: "Promemoria appuntamento di domani", body: `${x.d}: ${x.s} alle ${dateToRome(x.a.startAt).time}. Ti aspettiamo da Dog's Planet!`, url: "/account/appuntamenti", template: "reminder" });
    }
  } catch (e) {
    console.error("[jobs] promemoria:", (e as Error).message);
  } finally { running = false; }
}

export function startJobs() {
  if (process.env.DISABLE_JOBS === "1") return;
  setTimeout(sendReminders, 60_000);
  setInterval(sendReminders, 60 * 60_000).unref();
}
