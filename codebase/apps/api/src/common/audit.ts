import type { Trx } from "../db/db.service";

export interface AuditEntry {
  orgId?: string | null;
  actorUserId: string;
  action: string;
  targetType?: string;
  targetId?: string;
  /** Never put secrets or unnecessary personal data here. */
  meta?: Record<string, unknown>;
}

/** Writes inside the caller's transaction: if the audit row cannot be written, the action does not happen. */
export async function writeAudit(trx: Trx, e: AuditEntry): Promise<void> {
  await trx
    .insertInto("audit_event")
    .values({
      org_id: e.orgId ?? null,
      actor_user_id: e.actorUserId,
      action: e.action,
      target_type: e.targetType ?? null,
      target_id: e.targetId ?? null,
      meta: JSON.stringify(e.meta ?? {}),
    })
    .execute();
}
