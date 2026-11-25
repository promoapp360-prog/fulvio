import { eq, inArray, sql } from "drizzle-orm";
import { db, type DbExecutor } from "../db";
import { appointments, dogs, operators, services, users } from "../../shared/schema";
import { fmtRome } from "../time";
import { notifyUser, pushUserNotification } from "./notify";

/** Un'unica conferma per transizione, anche dopo accettazione proposta o pagamento. */
export async function notifyAppointmentConfirmed(id: number, executor: DbExecutor = db) {
  const [row] = await executor.select({
    a: appointments, customer: users, dog: dogs.name, service: services.name,
    operator: operators.name,
    eventId: sql<number | null>`(select max(e.id) from appointment_events e where e.appointment_id = "appointments"."id" and e.to_status = 'confermata' and e.from_status is distinct from 'confermata')`,
  }).from(appointments).innerJoin(users, eq(users.id, appointments.customerId))
    .innerJoin(dogs, eq(dogs.id, appointments.dogId)).innerJoin(services, eq(services.id, appointments.serviceId))
    .leftJoin(operators, eq(operators.id, appointments.operatorId)).where(eq(appointments.id, id));
  if (!row || row.a.status !== "confermata" || !row.customer.active) return;
  let service = row.service;
  if (row.a.requestedServiceIds?.length > 1) {
    const catalog = await executor.select({ id: services.id, name: services.name }).from(services).where(inArray(services.id, row.a.requestedServiceIds));
    service = row.a.requestedServiceIds.map(id => catalog.find(s => s.id === id)?.name).filter(Boolean).join(", ");
  }
  const when = fmtRome(row.a.startAt);
  await notifyUser(row.customer, {
    title: "Appuntamento confermato", body: `${row.dog}: ${service}, ${when}.`,
    template: "appuntamento_confermato", url: "/account/appuntamenti",
    vars: { cane: row.dog, servizio: service, data: when, operatore: row.operator ?? "" },
    dedupeKey: `appointment-confirmed:${id}:${row.eventId ?? row.a.startAt.getTime()}`,
  }, executor);
}

/** Push post-commit per le conferme pagamento avviate dentro una transazione. */
export async function pushAppointmentConfirmed(id: number) {
  const [row] = await db.select({
    a: appointments, customer: users, dog: dogs.name, service: services.name,
    eventId: sql<number | null>`(select max(e.id) from appointment_events e where e.appointment_id = "appointments"."id" and e.to_status = 'confermata' and e.from_status is distinct from 'confermata')`,
  }).from(appointments).innerJoin(users, eq(users.id, appointments.customerId))
    .innerJoin(dogs, eq(dogs.id, appointments.dogId)).innerJoin(services, eq(services.id, appointments.serviceId))
    .where(eq(appointments.id, id));
  if (!row || row.a.status !== "confermata" || !row.customer.active) return;
  let service = row.service;
  if (row.a.requestedServiceIds?.length > 1) {
    const catalog = await db.select({ id: services.id, name: services.name }).from(services).where(inArray(services.id, row.a.requestedServiceIds));
    service = row.a.requestedServiceIds.map(serviceId => catalog.find(x => x.id === serviceId)?.name).filter(Boolean).join(", ");
  }
  const when = fmtRome(row.a.startAt);
  await pushUserNotification(row.customer, {
    title: "Appuntamento confermato", body: `${row.dog}: ${service}, ${when}.`,
    template: "appuntamento_confermato", url: "/account/appuntamenti",
    vars: { cane: row.dog, servizio: service, data: when },
    dedupeKey: `appointment-confirmed:${id}:${row.eventId ?? row.a.startAt.getTime()}`,
  });
}
