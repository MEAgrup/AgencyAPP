/**
 * Process-wide Postgres client for the API (Supabase transaction-mode pooler).
 *
 * One postgres.js client is shared across route invocations (postgres.js manages
 * its own pool). The request path MUST use the pooler URL (DATABASE_URL, port
 * 6543) — createClient forces prepare:false for pooler safety (see @cdps/db).
 *
 * Writes go through this connection as a privileged/service role: RLS is the
 * read safety net, while writes are performed via SECURITY DEFINER RPCs
 * (ident_next / sm_transition / notify_emit / set_employee_banned / …). See
 * HANDOFF_FASE1_SESI4 §6.4.
 */
import { createClient, type Sql } from '@cdps/db';

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
