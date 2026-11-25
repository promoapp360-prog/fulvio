// Collaudo DB reale, integralmente in rollback: nessuna email esce verso SMTP.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, like } from "drizzle-orm";
import { db, pool } from "../server/db";
import { appointments, appointmentEvents, dogs, emailQueue, emailTemplates, notifications, services, users } from "../shared/schema";
import { romeToDate } from "../server/time";
import { sendReminders } from "../server/jobs";
import { notifyAppointmentConfirmed } from "../server/services/appointment-mail";
import { notifyUser } from "../server/services/notify";
import { sendTemplate } from "../server/services/email";
import { obsoleteReminder, reminderKey } from "../server/reminder-timing";

if (process.env.NODE_ENV !== "development") throw new Error("Collaudo consentito solo in sviluppo");
const run = randomUUID(), address = `email-test-${run}@example.invalid`;
const rollback = new Error("ROLLBACK intenzionale");
const now = romeToDate("2030-01-10", "10:00"), start = romeToDate("2030-01-11", "10:00");
try {
  await db.transaction(async tx => {
    const [service] = await tx.select().from(services).limit(1);
    assert.ok(service, "Serve almeno una prestazione esistente");
    const [customer] = await tx.insert(users).values({
      email: address, passwordHash: "!nessun-accesso-di-collaudo",
      firstName: "Collaudo email", lastName: run, commPush: false, commEmail: true,
    }).returning();
    const reminders = (date: Date) => sendReminders(date, tx, false, customer.id);
    const [dog] = await tx.insert(dogs).values({ ownerId: customer.id, name: `Collaudo-${run.slice(0, 8)}` }).returning();
    async function appointment(startAt: Date, status: "confermata" | "richiesta" | "attesa_pagamento", confirmedAt: Date) {
      const [a] = await tx.insert(appointments).values({
        customerId: customer.id, dogId: dog.id, serviceId: service.id,
        startAt, endAt: new Date(startAt.getTime() + 3600_000), durationMin: 60, status,
      }).returning();
      await tx.insert(appointmentEvents).values({
        appointmentId: a.id, action: "conferma_collaudo", fromStatus: "richiesta",
        toStatus: status, createdAt: confirmedAt,
      });
      return a;
    }
    const a = await appointment(start, "confermata", romeToDate("2030-01-08", "10:00"));
    const short = await appointment(romeToDate("2030-01-10", "16:00"), "confermata", romeToDate("2030-01-10", "09:00"));
    await appointment(start, "richiesta", romeToDate("2030-01-08", "10:00"));
    await appointment(start, "attesa_pagamento", romeToDate("2030-01-08", "10:00"));
    const anticipated = await appointment(romeToDate("2030-01-12", "07:30"), "confermata", romeToDate("2030-01-08", "10:00"));

    // La personalizzazione admin resta la fonte effettiva, senza scrivere valori permanenti.
    await tx.insert(emailTemplates).values({
      key: "appuntamento_confermato", name: "Conferma", subject: "Titolo personalizzato {{cane}}",
      body: "Testo admin {{servizio}} {{data}}", active: true,
    }).onConflictDoUpdate({ target: emailTemplates.key, set: {
      subject: "Titolo personalizzato {{cane}}", body: "Testo admin {{servizio}} {{data}}", active: true,
    } });
    await notifyAppointmentConfirmed(a.id, tx);
    await notifyAppointmentConfirmed(a.id, tx);
    let confirmations = await tx.select().from(emailQueue).where(and(eq(emailQueue.userId, customer.id), eq(emailQueue.template, "appuntamento_confermato")));
    assert.equal(confirmations.length, 1);
    assert.equal(confirmations[0].subject, `Titolo personalizzato ${dog.name}`);
    assert.ok(confirmations[0].html.includes("Testo admin"));
    console.log("PASS conferma reale su DB, personalizzazione admin e deduplica email");

    for (const key of ["registrazione", "richiesta_ricevuta"]) {
      const options = { userId: customer.id, dedupeKey: `${key}:${run}`, executor: tx };
      assert.equal(await sendTemplate(key, address, { nome: customer.firstName, cane: dog.name, servizio: service.name, data: "11 gennaio, 10:00" }, options), true);
      assert.equal(await sendTemplate(key, address, { nome: customer.firstName }, options), false);
    }
    console.log("PASS registrazione e richiesta ricevuta accodate una sola volta");
    // Un semplice salvataggio note non deve azzerare il preavviso già maturato.
    await tx.insert(appointmentEvents).values({
      appointmentId: a.id, action: "modifica", fromStatus: "confermata", toStatus: "confermata",
      data: { date: "2030-01-11", time: "10:00", startTimeChanged: false }, createdAt: now,
    });

    assert.equal(await reminders(romeToDate("2030-01-10", "07:59")), 0);
    assert.equal(await reminders(now), 1);
    assert.equal(await reminders(now), 0);
    const [reminder] = await tx.select().from(emailQueue).where(eq(emailQueue.dedupeKey, reminderKey(a.id, a.startAt)));
    assert.equal(reminder.status, "in_coda");
    assert.equal(reminder.attempts, 0);
    const [shortAfter] = await tx.select().from(appointments).where(eq(appointments.id, short.id));
    assert.equal(shortAfter.reminderSentAt, null);
    assert.equal(await reminders(romeToDate("2030-01-10", "19:59")), 1);
    assert.equal(await reminders(romeToDate("2030-01-10", "20:00")), 0);
    const [earlyMessage] = await tx.select().from(emailQueue).where(eq(emailQueue.dedupeKey, reminderKey(anticipated.id, anticipated.startAt)));
    assert.ok(earlyMessage);
    console.log("PASS promemoria 24 ore, anticipo serale, fascia Roma, nessun doppione o richiesta non confermata");

    // Un'interruzione annulla insieme flag, notifica ed email.
    const failed = new Error("Interruzione simulata");
    const before = await tx.select().from(notifications).where(eq(notifications.userId, customer.id));
    await assert.rejects(tx.transaction(async inner => {
      await inner.update(appointments).set({ reminderSentAt: now }).where(eq(appointments.id, short.id));
      await notifyUser(customer, { title: "Rollback", body: "Rollback", template: "promemoria",
        dedupeKey: `rollback:${run}`, vars: { cane: dog.name, servizio: service.name, data: "Test" } }, inner);
      throw failed;
    }), error => error === failed);
    assert.equal((await tx.select().from(emailQueue).where(eq(emailQueue.dedupeKey, `rollback:${run}`))).length, 0);
    assert.equal((await tx.select().from(notifications).where(eq(notifications.userId, customer.id))).length, before.length);
    assert.equal((await tx.select().from(appointments).where(eq(appointments.id, short.id)))[0].reminderSentAt, null);
    console.log("PASS rollback atomico senza perdere il promemoria");

    const moved = romeToDate("2030-01-14", "10:00");
    await tx.update(appointments).set({ startAt: moved, endAt: new Date(moved.getTime() + 3600_000), reminderSentAt: null }).where(eq(appointments.id, a.id));
    await tx.insert(appointmentEvents).values({ appointmentId: a.id, action: "modifica", fromStatus: "confermata", toStatus: "confermata", data: { date: "2030-01-14", startTimeChanged: true }, createdAt: now });
    assert.equal(await reminders(romeToDate("2030-01-13", "10:00")), 1);
    assert.ok(obsoleteReminder(start.getTime(), { startAt: moved, status: "confermata", active: true, commEmail: true }, now));
    assert.equal((await tx.select().from(emailQueue).where(like(emailQueue.dedupeKey, `reminder:${a.id}:%`))).length, 2);
    console.log("PASS nuovo promemoria dopo spostamento; vecchio orario riconosciuto come superato");
    throw rollback;
  }).catch(error => { if (error !== rollback) throw error; });
  assert.equal((await db.select().from(users).where(eq(users.email, address))).length, 0);
  console.log("PASS tutti i dati di collaudo rimossi dal rollback, zero invii SMTP");
} finally {
  await pool.end();
}
