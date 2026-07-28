/**
 * Process-wide Postgres client for the API (Supabase transaction-mode pooler).
 *
 * One postgres.js client is shared across route invocations (postgres.js manages
 * its own pool). The request path MUST use the pooler URL (DATABASE_URL, port
 * 6543) — createClient forces prepare:false for pooler safety (see @cdps/db).
 *
 * TWO access modes (DECISIONS O37, opsi (c) — RLS fondasi + gate app-layer):
 *
 *   db()                  — privileged/service role, RLS BYPASSED. Writes only:
 *                           they go through SECURITY DEFINER RPCs (ident_next /
 *                           sm_transition / notify_emit / set_employee_banned)
 *                           which authorize explicitly inside the function.
 *   readAsActor(actor, …) — the READ path. Runs inside a transaction that
 *                           switches to the non-privileged `authenticated` role
 *                           and publishes the caller's CDPS claims, so every RLS
 *                           policy in 20260102000003_rls_baseline.sql actually
 *                           applies. Before O37 the read path used db() and RLS
 *                           never engaged — any authenticated user could read
 *                           across scopes.
 *
 * Why a transaction: `SET LOCAL` is scoped to it and is reset on COMMIT, which
 * is mandatory on the transaction-mode pooler where the underlying server
 * connection is handed to another session afterwards. A plain SET would leak
 * one caller's identity into the next request.
 */
import { createClient, withClaims, type Sql, type TransactionSql } from '@cdps/db';
import type { permission } from '@cdps/core';

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

/**
 * actorClaims rebuilds the JWT claim envelope the RLS policies read, i.e.
 * `auth.jwt() -> 'app_metadata' ->> '<key>'`.
 *
 * The five keys mirror `public.employee_claims()` (migration 20260102000004)
 * and `permission.actorFromClaims` exactly — the Actor was itself parsed from a
 * verified token's app_metadata, so this is a faithful round-trip, not a new
 * source of truth. Booleans are emitted as real JSON booleans because
 * `jwt_is_od()`/`jwt_is_director()` cast the value with `::boolean`.
 *
 * Exported for unit testing (no DB required).
 */
export function actorClaims(actor: permission.Actor): string {
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
 * readAsActor runs `fn` with RLS ENFORCED for `actor` — the read path.
 *
 * The role switch and claim injection live in `@cdps/db` (`withClaims`) so the
 * domain package can exercise reads under the very same mechanism in its
 * integration tests. Writes keep using db() + SECURITY DEFINER RPCs.
 */
export async function readAsActor<T>(
  actor: permission.Actor,
  fn: (sql: TransactionSql) => Promise<T>,
): Promise<T> {
  return withClaims(db(), actorClaims(actor), fn);
}
