import type { Request } from "express";
import { db, type DbExecutor } from "../db";
import { auditLog } from "../../shared/schema";

/** Best-effort by default; with a transaction, failure must roll back the operation too. */
export async function audit(req: Request | null, action: string, entity: string, entityId?: string | number | null, data: Record<string, unknown> = {}, executor: DbExecutor = db) {
  try {
    await executor.insert(auditLog).values({
      actorId: req?.user?.id ?? null,
      action, entity,
      entityId: entityId == null ? null : String(entityId),
      data,
      ip: req ? String(req.ip || "").slice(0, 64) : null,
    });
  } catch (e) {
    if (executor !== db) throw e;
    console.error("[audit]", (e as Error).message);
  }
}
