import { Router } from "express";
import { and, desc, eq, isNotNull, lt, ne, notInArray, sql } from "drizzle-orm";
import { db } from "../../db";
import { appointments, guestBookings, guestBookingEvents } from "../../../shared/schema";
import { treatmentDurationInput, treatmentServiceIds } from "../../../shared/treatment-duration";
import { requirePerm } from "../../auth";
import { logEvent } from "../../services/appointments";
import { audit } from "../../services/audit";
import { h, HttpError, id } from "../../util";

const r = Router();
function tableFor(kind: string) {
  if (kind === "appointment") return appointments;
  if (kind === "guest") return guestBookings;
  throw new HttpError(400, "Tipo appuntamento non valido");
}

r.get("/treatment-duration/:kind/:id", requirePerm("agenda_view", "richieste", "clienti"), h(async (req, res) => {
  const table = tableFor(req.params.kind);
  const bookingId = id(req.params.id);
  const registered = req.params.kind === "appointment";
  const customerColumn = registered ? appointments.customerId : guestBookings.guestCustomerId;
  const dogColumn = registered ? appointments.dogId : guestBookings.guestDogId;
  const [booking] = await db.select({
    ownerId: customerColumn, dogId: dogColumn, serviceId: table.serviceId,
    requestedServiceIds: table.requestedServiceIds, startAt: table.startAt, actualDurationMin: table.actualDurationMin,
  }).from(table).where(eq(table.id, bookingId));
  if (!booking) throw new HttpError(404, "Appuntamento non trovato");
  const { ownerId, dogId } = booking;
  // Solo collegamenti espliciti: mai confronti per nome, email o telefono.
  const ids = treatmentServiceIds(booking);
  const effectiveIds = sql`CASE WHEN jsonb_array_length(${table.requestedServiceIds}) > 0
    THEN ${table.requestedServiceIds} ELSE jsonb_build_array(${table.serviceId}) END`;
  const history = ownerId && dogId ? await db.select({
    id: table.id, startAt: table.startAt, actualDurationMin: table.actualDurationMin,
  }).from(table).where(and(
    eq(customerColumn, ownerId), eq(dogColumn, dogId), ne(table.id, bookingId),
    lt(table.startAt, booking.startAt), isNotNull(table.actualDurationMin),
    notInArray(table.status, ["annullata", "rifiutata", "assente"]),
    sql`${effectiveIds} @> ${JSON.stringify(ids)}::jsonb AND ${effectiveIds} <@ ${JSON.stringify(ids)}::jsonb`,
  )).orderBy(desc(table.startAt), desc(table.id)).limit(5) : [];
  res.json({ actualDurationMin: booking.actualDurationMin, history });
}));

r.put("/treatment-duration/:kind/:id", requirePerm("agenda_edit", "richieste"), h(async (req, res) => {
  const table = tableFor(req.params.kind);
  const bookingId = id(req.params.id);
  const data = treatmentDurationInput.parse(req.body);
  const result = await db.transaction(async tx => {
    const [booking] = await tx.select().from(table).where(eq(table.id, bookingId)).for("update");
    if (!booking) throw new HttpError(404, "Appuntamento non trovato");
    const [updated] = await tx.update(table).set({ actualDurationMin: data.actualDurationMin, updatedAt: new Date() })
      .where(eq(table.id, bookingId)).returning({ actualDurationMin: table.actualDurationMin });
    const event = { before: booking.actualDurationMin, actualDurationMin: data.actualDurationMin };
    if (req.params.kind === "appointment") {
      await logEvent(tx, bookingId, req.user!.id, "durata_trattamento", booking.status, booking.status, event);
    } else {
      await tx.insert(guestBookingEvents).values({ bookingId, actorId: req.user!.id, action: "durata_trattamento", data: event });
    }
    return updated;
  });
  await audit(req, "treatment_duration_update", req.params.kind === "guest" ? "guest_booking" : "appointment", bookingId, data);
  res.json(result);
}));

export default r;
