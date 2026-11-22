import type { Request } from "express";
import { db } from "../db";
import { auditLog } from "../../shared/schema";

/** Registra un'operazione rilevante. Non blocca mai la richiesta in caso di errore. */
export async function audit(req: Request | null, action: string, entity: string, entityId?: string | number | null, data: Record<string, unknown> = {}) {
  try {
    await db.insert(auditLog).values({
      actorId: req?.user?.id ?? null,
      action, entity,
      entityId: entityId == null ? null : String(entityId),
      data,
      ip: req ? String(req.ip || "").slice(0, 64) : null,
    });
  } catch (e) {
    console.error("[audit]", (e as Error).message);
  }
}
