/**
 * M6D — Rekap Hasil Mingguan (Weekly Result Recap). Machine #18 gate layer.
 *
 * This file is the D-02 slice: the transition wrapper + the WHO gates for
 * machine #18 (`weekly_result_recap`), following the `plan.ts` pattern where the
 * engine (`sm_transition`) owns edge legality + the `require_lead` gate, and the
 * DOMAIN owns the finer "which person may press which button" gate.
 *
 * Deliberately narrow. The recap READS (own-clients / SPV all), the auto
 * aggregation, the manual fallbacks, the narrative validation at close, the
 * force-close job and the reopen-with-reason write path all land in later
 * tickets (D-03/D-05/D-06/D-09). What is frozen here is the shape of the machine
 * and who is allowed to drive it:
 *
 *   Terjadwal → Terbuka           system (Monday job, D-06)         — service-role
 *   Terbuka   → Ditutup           the owning AM/CRO (Rule 8)        — canCloseRecap
 *   Terbuka   → Ditutup Otomatis  system force-close (D-06)         — service-role
 *   Ditutup Otomatis → Terbuka    Head of Account reopen (RM-5)     — canReopenRecap
 *
 * See `docs/STATE_MACHINES.md` §15 and migration 20260813020000_m6d_wrr_machine.sql.
 */
import { permission, statemachine } from '@cdps/core';
import { executors, type TransactionSql } from '@cdps/db';
import { ACCOUNT_DIVISION, ConflictError, ForbiddenError, NotFoundError, type Actor } from './account';

// ---------------------------------------------------------------------------
// BI messages (CLAUDE.md #5)
// ---------------------------------------------------------------------------

/** The recap id does not resolve. */
export const MSG_RECAP_NOT_FOUND = '[rekap mingguan tidak ditemukan]';
/** Actor may not drive this recap transition. */
export const MSG_RECAP_FORBIDDEN = '[anda tidak memiliki akses untuk melakukan transisi ini]';

// ---------------------------------------------------------------------------
// Machine #18 (see migration 20260813020000). Status moves ONLY through
// `sm_transition` — never a raw UPDATE.
// ---------------------------------------------------------------------------

/** Machine name + audit entity_type for `sm_transition`. */
export const MACHINE_RECAP = 'weekly_result_recap';
const ENTITY_RECAP = 'weekly_result_recap';

/** Machine #18 states. */
export const WRR_TERJADWAL = 'Terjadwal';
export const WRR_TERBUKA = 'Terbuka';
export const WRR_DITUTUP = 'Ditutup';
export const WRR_DITUTUP_OTOMATIS = 'Ditutup Otomatis';

/** The single terminal state (Ditutup Otomatis is quasi-terminal — Head reopen). */
export const WRR_TERMINAL: readonly string[] = [WRR_DITUTUP];

// ---------------------------------------------------------------------------
// Permission — the domain "who may press the button" gates. The engine already
// refuses a non-(Director/Lead) on the reopen edge (require_lead); these narrow
// it further, exactly the way plan.ts narrows period-1 approval to Account.
// ---------------------------------------------------------------------------

/**
 * canCloseRecap: `Terbuka → Ditutup`. The client's assigned AM/CRO confirms the
 * week (Rule 8); an Account lead/Head may override, and a Director may always.
 * (Mirror of `canWritePlan` — `isLead(_, 'Account')` already covers Director.)
 */
export function canCloseRecap(actor: Actor, ownerAm: string | null): boolean {
  if (permission.isLead(actor, ACCOUNT_DIVISION)) return true;
  return ownerAm !== null && ownerAm === actor.employeeId;
}

/**
 * canReopenRecap: `Ditutup Otomatis → Terbuka`. RM-5 (owner 2026-08-13) —
 * ONLY the Head of Account (the AM's superior), or a Director. Deliberately NOT
 * the owning AM: reopening is the supervisor giving the AM a second chance, and
 * the AM must not be able to erase their own force-close. `isLead(_, 'Account')`
 * is exactly "Account lead/Head OR Director", and a plain owning-AM (staff level)
 * fails it — which is the intended exclusion.
 */
export function canReopenRecap(actor: Actor): boolean {
  return permission.isLead(actor, ACCOUNT_DIVISION);
}

/**
 * canWriteRecap: the write-scope predicate for a recap's AM-writable fields
 * (RM-A6, the RM-C manual fallbacks, the RM-D narrative, and the `Sengketa
 * Angka` note on an auto figure). The owning AM/CRO, or an Account lead/Head
 * (Director covered by `isLead`); OD is read-only (Role Matrix §9). This is the
 * exact TS twin of the RLS helper `private.jwt_can_write_recap` — the D-03
 * frozen invariant is that the two must not diverge (asserted in
 * `recap.reals.test.ts`), mirroring `canWritePlan` ≡ `jwt_can_write_plan` (M6B
 * B-06). It scopes WHO may write; the column-level rule that an `otomatis` row's
 * value is immutable (only its `sengketa` may move) is the DB trigger's half —
 * RLS `WITH CHECK` cannot compare OLD to NEW.
 */
export function canWriteRecap(actor: Actor, ownerAm: string | null): boolean {
  if (permission.isLead(actor, ACCOUNT_DIVISION)) return true;
  return ownerAm !== null && ownerAm === actor.employeeId;
}

// ---------------------------------------------------------------------------
// Transition wrapper
// ---------------------------------------------------------------------------

/** transitionError maps an engine rejection to the shared error taxonomy. */
function transitionError(res: statemachine.TransitionResult & { ok: false }): Error {
  if (res.code === 'not_found') return new NotFoundError(MSG_RECAP_NOT_FOUND);
  if (res.code === 'role_denied') return new ForbiddenError(res.message);
  // 'blocked' (illegal edge, incl. the machine's BI block message) and the rest
  // are conflicts on the current state.
  return new ConflictError(res.message);
}

/**
 * transitionRecap is the single wrapper every recap status move goes through —
 * the `plan.ts` transition pattern applied to machine #18. It forces the move
 * through `sm_transition` (row lock + edge check + `require_lead` gate + the
 * immutable audit row, one transaction) and maps a rejection onto the domain
 * error taxonomy. The person-level gates (`canCloseRecap` / `canReopenRecap`)
 * live in the named operations that call it (D-06/D-09); this is the low-level
 * path they share.
 *
 * Runs inside the caller's transaction so any sibling write (the reopen reason,
 * the close timestamp) commits or rolls back with the move.
 */
export async function transitionRecap(
  tx: TransactionSql,
  actor: Actor,
  recapId: string,
  to: string,
): Promise<void> {
  const ex = executors(tx);
  const res = await statemachine.transition(ex.sm, {
    machine: MACHINE_RECAP,
    entityType: ENTITY_RECAP,
    table: 'weekly_result_recap',
    entityId: recapId,
    to,
    actor,
  });
  if (!res.ok) throw transitionError(res);
}
