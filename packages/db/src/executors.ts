/**
 * Concrete implementations of the @cdps/core executor interfaces, backed by the
 * Postgres functions from the migrations (ident_next, sm_transition, notify_emit)
 * and the append-only audit_log insert.
 *
 * Build these from a transaction handle (see client.withTransaction) so every
 * core operation shares the entity write's atomicity — the whole point of moving
 * the atomic parts into SQL (SUPABASE_MIGRATION_TECH_APPENDIX §B.1/§B.2/§B.6).
 */

import type { audit, ident, notification, statemachine } from '@cdps/core';
import type { Queryable } from './client.js';

/** ident_next(prefix, at) — atomic gap-free ID allocation. */
export function identExecutor(sql: Queryable): ident.IdentExecutor {
  return {
    async identNext(prefix: string, at: Date): Promise<string> {
      const rows = await sql<{ id: string }[]>`select ident_next(${prefix}, ${at}) as id`;
      return rows[0].id;
    },
  };
}

/** sm_transition(...) — the only path that writes a status column. */
export function smExecutor(sql: Queryable): statemachine.SmExecutor {
  return {
    async smTransition(args: statemachine.SmTransitionArgs): Promise<statemachine.TransitionResult> {
      const rows = await sql<{ r: statemachine.TransitionResult }[]>`
        select sm_transition(
          ${args.machine}, ${args.entityType}, ${args.table}, ${args.idCol}, ${args.statusCol},
          ${args.entityId}, ${args.to}, ${args.actorEmployeeId}, ${args.roleDirector}, ${args.roleLead}
        ) as r`;
      return rows[0].r;
    },
  };
}

/** Append-only insert into audit_log (immutability enforced by triggers). */
export function auditExecutor(sql: Queryable): audit.AuditExecutor {
  return {
    async insertAudit(row: audit.AuditRow): Promise<void> {
      await sql`
        insert into audit_log
          (entity_type, entity_id, actor_employee_id, action, before_json, after_json, created_by)
        values (
          ${row.entityType}, ${row.entityId}, ${row.actorEmployeeId}, ${row.action},
          ${row.beforeJson as never}, ${row.afterJson as never}, ${row.createdBy}
        )`;
    },
  };
}

/** notify_emit(...) — recipient resolution + per-recipient notification insert. */
export function notifyExecutor(sql: Queryable): notification.NotifyExecutor {
  return {
    async notifyEmit(
      args: notification.NotifyEmitArgs,
    ): Promise<{ ok: true; notified: string[] }> {
      const rows = await sql<{ r: { ok: true; notified: string[] } }[]>`
        select notify_emit(
          ${args.event}, ${args.entityType}, ${args.entityId}, ${args.actor},
          ${args.deepLink}, ${args.division}, ${args.explicit}::text[], ${args.notifyActor}
        ) as r`;
      return rows[0].r;
    },
  };
}

/** All core executors bound to one transaction handle. */
export interface Executors {
  ident: ident.IdentExecutor;
  sm: statemachine.SmExecutor;
  audit: audit.AuditExecutor;
  notify: notification.NotifyExecutor;
}

/** executors builds every core executor from a single (transaction) handle. */
export function executors(sql: Queryable): Executors {
  return {
    ident: identExecutor(sql),
    sm: smExecutor(sql),
    audit: auditExecutor(sql),
    notify: notifyExecutor(sql),
  };
}
