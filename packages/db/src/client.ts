/**
 * Postgres client for CDPS (Supabase Postgres via the connection pooler).
 *
 * Uses postgres.js. Per SUPABASE_MIGRATION_TECH_APPENDIX §E.2/§E.3 the runtime
 * request path connects through the transaction-mode pooler on port 6543, where
 * prepared statements must be disabled (`prepare: false`) — the pooler does not
 * keep a 1:1 server connection across statements. `DIRECT_URL` (5432, session
 * mode) is for migrations/ops only, never the request path.
 *
 * The atomic core operations (ident_next, sm_transition, notify_emit, audit
 * insert) MUST run inside a single transaction together with the entity write
 * they accompany — use `withTransaction` and build the executors from the
 * transaction handle it passes.
 */

import postgres from 'postgres';

export type Sql = postgres.Sql;
export type TransactionSql = postgres.TransactionSql;

/**
 * A queryable handle: either a top-level client or a transaction handle. The
 * core executors accept this so they can be bound to a transaction (the normal
 * case) or, for read-only helpers, the base client.
 */
export type Queryable = Sql | TransactionSql;

export interface CreateClientOptions {
  /** Extra postgres.js options merged over the CDPS defaults. */
  overrides?: postgres.Options<Record<string, postgres.PostgresType>>;
}

/**
 * createClient builds a postgres.js client configured for the Supabase pooler.
 * Pass the pooler connection string (`DATABASE_URL`, port 6543). `prepare` is
 * forced off for pooler (transaction-mode) safety.
 */
export function createClient(connectionString: string, opts: CreateClientOptions = {}): Sql {
  return postgres(connectionString, {
    prepare: false,
    ...opts.overrides,
  });
}

/**
 * withTransaction runs fn inside a single DB transaction (BEGIN…COMMIT, or
 * ROLLBACK on throw). Build the core executors from the `tx` handle passed to
 * fn so ident/sm_transition/notify/audit all share the entity write's atomicity
 * (a rolled-back entity insert consumes no sequence number and writes no audit).
 */
export async function withTransaction<T>(sql: Sql, fn: (tx: TransactionSql) => Promise<T>): Promise<T> {
  return sql.begin(fn) as Promise<T>;
}

/**
 * The non-privileged DB role the read path assumes. It is not BYPASSRLS and
 * holds only SELECT on the domain tables (migration 20260102000003 §4), so the
 * RLS policies — not the connection — decide which rows come back.
 */
export const READ_ROLE = 'authenticated';

/**
 * withClaims runs `fn` in a transaction where RLS is ENFORCED for the given JWT
 * claim envelope (DECISIONS O37).
 *
 * `claimsJson` is the serialized `{"app_metadata":{…}}` object the policies read
 * through `auth.jwt()`; the caller owns its shape (apps/api builds it from the
 * verified token — see `actorClaims`). Claims are published before the role is
 * dropped, so the session is never non-privileged-but-unidentified while `fn`
 * could run.
 *
 * Both settings are transaction-local, so COMMIT/ROLLBACK restores the
 * privileged role and clears the identity — mandatory on the transaction-mode
 * pooler, where the server connection is handed to another session afterwards.
 */
export async function withClaims<T>(
  sql: Sql,
  claimsJson: string,
  fn: (tx: TransactionSql) => Promise<T>,
): Promise<T> {
  return withTransaction(sql, async (tx) => {
    await tx`SELECT set_config('request.jwt.claims', ${claimsJson}, true)`;
    // Role name is a fixed constant — SET ROLE takes no bind parameters.
    await tx.unsafe(`SET LOCAL ROLE ${READ_ROLE}`);
    return fn(tx);
  });
}
