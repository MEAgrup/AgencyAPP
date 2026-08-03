/**
 * Transition-engine INTROSPECTION — the read side of the state machine.
 *
 * Ports Go's `statemachine.Machine.AllowedFrom`. In Go the edge table is loaded
 * into memory at boot, so a handler can ask a Machine what moves are legal from
 * a status. Here the edge table lives in `sm_edges` (migration
 * 20260723055732_statemachine.sql) and is the same table `sm_transition` itself
 * validates against — so this reader and the enforcement path can never drift
 * apart into "the button exists but the move is blocked".
 *
 * Read-only by construction, exactly like `audit`: there is no write path in this
 * module, so it cannot mutate machine configuration even by accident. Configuring
 * a machine is a migration, never a runtime call.
 */

import { type Queryable } from '@cdps/db';

/**
 * allowedTransitions returns the states reachable in one step from `from` on
 * `machine`, sorted. Returns [] for an unknown machine or a terminal state —
 * never null, because the client iterates the array to decide which action
 * buttons to render at all.
 *
 * WHY A FUNCTION AND NOT `select … from sm_edges` (QA live 2026-08-03). This read
 * used to query the table directly, which worked only as long as reads ran on a
 * privileged connection. O37 moved every read onto `readAsActor`
 * (`SET LOCAL ROLE authenticated`), and `sm_edges` is in the RLS baseline's
 * "pure internal" group — SELECT revoked, no policy, an invariant codified in
 * `supabase/tests/rls_checks.sql` §9. The direct query therefore raised
 * `42501 permission denied for table sm_edges`, which `mapError` does not map:
 * `GET /attempts/{id}` answered 500 and the attempt-detail page rendered a bare
 * "internal server error". `private.sm_allowed_transitions`
 * (20260803120000_rls_sm_edges_read_path.sql) is SECURITY DEFINER, so the table
 * stays closed to `authenticated` while this read path gets exactly the answer it
 * publishes as `allowed_transitions` — and nothing else about the machine.
 *
 * The `collate "C"` ordering moved INTO that function, so the byte order stays a
 * property of the engine rather than of the caller. It is load-bearing, not
 * decoration: Go sorted these with `sort.Strings` (byte order), and CDPS statuses
 * are bracketed — `[Closed - Kalah Kompetisi]` vs `Qualified`. A glibc locale like
 * `en_US.utf8` deprioritizes punctuation and puts the bracketed status FIRST,
 * while `C` (and Go, and JS) put it LAST. Unpinned, the button order in the
 * response would depend on the locale the database cluster happened to be
 * initialized with — CI's Postgres 17 (`en_US.utf8`) and a local Postgres really
 * do disagree, which is how this was found.
 *
 * NOTE this answers "is the EDGE legal", not "may THIS actor take it": the
 * `require_lead` gate is enforced by `sm_transition` at write time. Go's
 * AllowedFrom has the same scope, and the client still gets a role-denied
 * message with the exact BI text if a staff user pushes a lead-only button.
 */
export async function allowedTransitions(
  sql: Queryable,
  machine: string,
  from: string,
): Promise<string[]> {
  const rows = await sql<{ states: string[] }[]>`
    select private.sm_allowed_transitions(${machine}, ${from}) as states`;
  return rows[0]?.states ?? [];
}
