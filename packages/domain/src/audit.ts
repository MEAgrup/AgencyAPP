/**
 * Cross-module audit-trail READ (O41). Ports Go's `audit.List` + the
 * `GET /api/v1/audit` handler — the generic entity-history reader the FE uses for
 * the Creative Asset history panel, lead detail, prospect-attempt detail, and demo
 * tasks. Every one of those panels called an endpoint that did not exist.
 *
 * There is deliberately NO write path here. Audit rows are appended only through
 * `@cdps/core` audit inside the writing transaction, and `audit_log` carries the
 * immutability trigger (house rule #3) — this module cannot mutate history even
 * by accident, because it only ever issues SELECTs.
 *
 * VISIBILITY IS RLS, AND IT IS NARROWER THAN GO. `audit_log_select` grants
 * `jwt_can_read_all() OR actor_employee_id = jwt_employee_id()`, so a staff-level
 * caller sees only the entries THEY authored, while Go's handler applied no filter
 * at all and returned the full trail to any authenticated caller. Reading less is
 * the safe direction, so this port does not touch the policy; the divergence is
 * logged as an open question instead of being decided inside a read model.
 *
 * Reference: archive/backend-go/internal/core/audit/audit.go (List/Filter),
 * archive/backend-go/internal/httpapi/audit_handlers.go.
 */

import type { Queryable } from '@cdps/db';

/** Hard cap on returned rows, matching Go's `Filter{Limit: 500}`. */
export const AUDIT_LIST_LIMIT = 500;

/** One audit entry as the history panels consume it. */
export interface AuditEntry {
  entityType: string;
  entityId: string;
  actorEmployeeId: string;
  action: string;
  beforeJson: unknown | null;
  afterJson: unknown | null;
  createdAt: Date;
}

/** Filter for the trail read; an empty field means "any". */
export interface AuditFilter {
  entityType?: string;
  entityId?: string;
}

/**
 * auditTrail lists audit entries for one entity, newest first, capped at
 * AUDIT_LIST_LIMIT. Both filter fields are optional and independent — Go builds
 * the WHERE incrementally the same way, so `?entity_type=lead` with no id lists
 * that type's recent history.
 *
 * Ordering is `id desc`, not `created_at desc`: several rows written inside one
 * transaction share a timestamp, and only the sequence id orders them
 * deterministically. A created_at sort makes same-transaction history shuffle
 * between requests.
 */
export async function auditTrail(sql: Queryable, filter: AuditFilter = {}): Promise<AuditEntry[]> {
  const entityType = (filter.entityType ?? '').trim();
  const entityId = (filter.entityId ?? '').trim();

  const rows = await sql<
    {
      entity_type: string; entity_id: string; actor_employee_id: string; action: string;
      before_json: unknown | null; after_json: unknown | null; created_at: Date;
    }[]
  >`
    select entity_type, entity_id, actor_employee_id, action, before_json, after_json, created_at
    from audit_log
    where (${entityType === ''} or entity_type = ${entityType})
      and (${entityId === ''} or entity_id = ${entityId})
    order by id desc
    limit ${AUDIT_LIST_LIMIT}`;

  return rows.map((r) => ({
    entityType: r.entity_type,
    entityId: r.entity_id,
    actorEmployeeId: r.actor_employee_id,
    action: r.action,
    beforeJson: r.before_json,
    afterJson: r.after_json,
    createdAt: r.created_at,
  }));
}
