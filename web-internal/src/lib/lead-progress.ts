/**
 * Lead → prospect-attempt progression, as the lead detail page needs it.
 *
 * A lead record carries no lifecycle action of its own. Everything a
 * salesperson DOES — menandai Contacted, mengisi Qualified Lead Form (data
 * toko), negosiasi, closing — happens on a PROSPECT ATTEMPT (M0 §4–§6), which
 * lives at `/sales/{attemptId}`. Landing on `/leads/{id}` therefore used to be
 * a dead end: the attempts were listed as bare IDs and nothing said "this is
 * where the process continues".
 *
 * This module is the pure decision behind that panel: given a lead's record
 * status, its attempt contest, and who is looking, it answers *which* attempt
 * to point at, *what* the next step there is called, and whether a claim would
 * spawn a fresh attempt instead.
 *
 * **Nothing here is authoritative.** Every gate belongs to the server:
 * `canWriteAttempt` (packages/domain/src/sales.ts §9.1 matrix), `decideClaim`
 * (packages/domain/src/leads.ts, M1 §6) and the edge table behind
 * `sm_transition`. These predicates only choose which affordance to draw so the
 * user is not sent into a call that can only be refused; a refusal is still
 * rendered verbatim from the server. Framework-free so it is unit-testable per
 * role, exactly like `nav.ts`.
 */
import type { LeadAttemptRow } from './leads';
import type { Role } from './types';

/** Canonical Sales division name on the /me contract (fe_m0m1_contract.md). */
const SALES_DIVISION = 'Sales';

/**
 * Attempt statuses with no outgoing edge in `sm_edges` (machine
 * `prospect_attempt`). An attempt in one of these is done — it is no longer
 * "sedang diproses" and it no longer blocks a re-claim.
 */
export const TERMINAL_ATTEMPT_STATUSES = [
  'Not Qualified',
  'Closed-Success',
  'Closed-Lost',
  '[Closed - Kalah Kompetisi]',
] as const;

export function isTerminalAttempt(status: string): boolean {
  return (TERMINAL_ATTEMPT_STATUSES as readonly string[]).includes(status);
}

/**
 * What the attempt page actually offers at each status — the labels mirror the
 * buttons/forms rendered by `app/(shell)/sales/[id]/page.tsx`, so the promise
 * made here is the thing the user finds on arrival. Statuses absent from the
 * map (the terminal ones) have no next step.
 */
export const ATTEMPT_NEXT_STEP: Record<string, string> = {
  'New Lead': 'Tandai Contacted',
  Contacted: 'Isi Qualified Lead Form (data toko)',
  Qualified: 'Ajukan negosiasi',
  'Negotiation - Pending Approval': 'Menunggu keputusan Superior',
  'Negotiation - Revision Required': 'Terima counter atau resubmit proposal',
  'Negotiation - Rejected': 'Resubmit proposal atau tandai Closed-Lost',
  'Negotiation - Approved': 'Isi Closing Form',
  'Negotiation - Auto Approved': 'Isi Closing Form',
};

/** Next-step label for an attempt status, or null when it is terminal. */
export function nextStepLabel(status: string): string | null {
  return ATTEMPT_NEXT_STEP[status] ?? null;
}

/**
 * Record statuses a Pool claim may target — mirrors `decideClaim`: `[Pool]` is
 * claimed directly, `[Rejected]` / `[Not Qualified]` are re-claimed by
 * reopening to `[Pool]` first (M1 §6 rule 7). Anything else (notably `active`,
 * a scouted-exclusive record) is blocked server-side, so no button is drawn.
 */
export const CLAIMABLE_RECORD_STATUSES = ['[Pool]', '[Rejected]', '[Not Qualified]'] as const;

export interface LeadProgress {
  /** The attempt the panel points at (the actor's own first), or null. */
  attempt: LeadAttemptRow | null;
  /** Next step on that attempt; null when terminal or when there is none. */
  nextStep: string | null;
  /** True when the actor is the attempt's owner (its own pursuit). */
  isMine: boolean;
  /** True when the actor may drive that attempt — mirrors `canWriteAttempt`. */
  canAct: boolean;
  /** True when POST /leads/{id}/claim would spawn a new attempt for the actor. */
  canClaim: boolean;
}

export interface LeadProgressInput {
  recordStatus: string;
  attempts: LeadAttemptRow[];
  employeeId: string | null;
  role: Role | null;
}

/**
 * canDriveAttempt mirrors `sales.canWriteAttempt` (M0 §9.1): Director
 * everywhere; Sales Lead division-wide; Sales staff on their own attempt only;
 * anyone else never. OD is layered — a pure OD (od && !director) is read-only,
 * so it is stripped before the matrix is applied.
 */
function canDriveAttempt(role: Role | null, employeeId: string | null, ownerId: string): boolean {
  if (!role) return false;
  if (role.od && !role.director) return false;
  if (role.director) return true;
  if (role.division !== SALES_DIVISION) return false;
  if (role.level === 'lead') return true;
  return role.level === 'staff' && employeeId !== null && employeeId === ownerId;
}

/**
 * leadProgress picks the attempt to continue and the affordances around it.
 *
 * The actor's OWN open attempt wins the pointer even when an older competing
 * one exists: on a pool lead several salespeople hold parallel attempts by
 * design (M1-OA-1), and sending someone to a colleague's attempt would be a
 * detour into a call the server refuses. With no own attempt, the oldest open
 * one is offered — a Sales Lead or Director legitimately acts on it, and a
 * staff member at least sees who is holding the lead.
 */
export function leadProgress(input: LeadProgressInput): LeadProgress {
  const { recordStatus, attempts, employeeId, role } = input;
  const open = attempts.filter((a) => !isTerminalAttempt(a.status));
  const mine = employeeId === null ? undefined : open.find((a) => a.owner_employee_id === employeeId);
  const attempt = mine ?? open[0] ?? null;

  const odOnly = Boolean(role?.od) && !role?.director;
  const salesSide = Boolean(role && (role.division === SALES_DIVISION || role.director));
  // No double-claim: an actor already holding an open attempt is blocked by
  // decideClaim (MSG_ALREADY_OWN_ATTEMPT), so the claim door is theirs only
  // when they hold none on this lead.
  const canClaim =
    salesSide &&
    !odOnly &&
    mine === undefined &&
    (CLAIMABLE_RECORD_STATUSES as readonly string[]).includes(recordStatus);

  return {
    attempt,
    nextStep: attempt ? nextStepLabel(attempt.status) : null,
    isMine: attempt !== null && mine !== undefined,
    canAct: attempt !== null && canDriveAttempt(role, employeeId, attempt.owner_employee_id),
    canClaim,
  };
}
