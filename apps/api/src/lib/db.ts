/**
 * Process-wide Postgres client for the API (Supabase transaction-mode pooler).
 *
 * One postgres.js client is shared across route invocations (postgres.js manages
 * its own pool). The request path MUST use the pooler URL (DATABASE_URL, port
 * 6543) — createClient forces prepare:false for pooler safety (see @cdps/db).
 *
 * Two read/write disciplines (O37 — see docs/O37_RLS_DECISION_BRIEF.md):
 *
 *  - **Writes** go through this connection as the privileged/service role and are
 *    performed via SECURITY DEFINER RPCs (ident_next / sm_transition /
 *    notify_emit / set_employee_banned / …). RLS does not gate writes.
 *  - **User-facing reads** MUST use `readAs(actor, …)`, which drops the
 *    transaction to the `authenticated` role and injects the actor's JWT claims,
 *    so the exact same RLS policies that ship in
 *    20260102000003_rls_baseline.sql enforce per-role row scope. A route that
 *    reads on the bare `db()` connection bypasses RLS (service_role is BYPASSRLS).
 *  - **System / cross-scope reads** (finance-wide dashboards, batch scans) that
 *    are intentionally not row-owner-scoped use `readAsSystem(…)` — the same
 *    service-role connection, but named so the intent is explicit and greppable.
 *    Callers of readAsSystem are responsible for their own role gate.
 */
import { permission } from '@cdps/core';
import { createClient, type Sql, type TransactionSql } from '@cdps/db';

type Actor = permission.Actor;

let client: Sql | undefined;

/** db returns the shared client, creating it on first use. */
export function db(): Sql {
  if (!client) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error('DATABASE_URL is not set');
    }
    client = createClient(url);
  }
  return client;
}

/** Serializes an Actor to the `app_metadata` claims shape the RLS helpers read
 *  (jwt_employee_id / jwt_division / jwt_is_lead / jwt_is_od / jwt_is_director).
 *  Identical shape to supabase/tests/rls_checks.sql — the parity source. */
export function actorClaims(actor: Actor): string {
  return JSON.stringify({
    app_metadata: {
      employee_id: actor.employeeId,
      division: actor.role.division,
      level: actor.role.level,
      od: actor.role.od,
      director: actor.role.director,
    },
  });
}

/**
 * readAs runs `fn` inside a transaction as the `authenticated` role with the
 * actor's claims injected into `request.jwt.claims`, so RLS enforces row scope
 * exactly as it will under Supabase Auth. Use for every user-facing read. The
 * `set local` settings are scoped to the transaction and reset on commit.
 */
export async function readAs<T>(actor: Actor, fn: (tx: TransactionSql) => Promise<T>): Promise<T> {
  const claims = actorClaims(actor);
  return db().begin(async (tx) => {
    // set_config(..., true) = local to this transaction; role drop applies to the
    // remaining statements. Order: claims first, then drop out of the privileged
    // role (once authenticated, we can no longer widen scope).
    await tx`select set_config('request.jwt.claims', ${claims}, true)`;
    await tx`set local role authenticated`;
    return fn(tx);
  }) as Promise<T>;
}

/**
 * readAsSystem runs `fn` on the privileged service-role connection (RLS bypassed)
 * — for intentionally cross-scope reads (finance-wide dashboards, batch scans).
 * The caller MUST enforce its own role gate; this path performs no scoping.
 */
export async function readAsSystem<T>(fn: (sql: Sql) => Promise<T>): Promise<T> {
  return fn(db());
}
