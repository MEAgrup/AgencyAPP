/**
 * Assignable-employee directory — the read path behind every "who does this?"
 * dropdown (M6 §3 AM assignment, M6 §5 Brief PIC per division, M12 §5.3 Task
 * PIC, M7 §2 Asset PIC, M9 §3 Booking Coordinator).
 *
 * Why this module exists (owner request 2026-08-04): all five doors asked for an
 * EMPLOYEE ID typed from memory — `/account` literally through a
 * `window.prompt("Employee ID Account Manager untuk klien X")`. Nobody memorises
 * `EMP-…` for their own division, let alone another's, so the field was either
 * mistyped (server rejects with the right BI message but no hint who IS valid) or
 * skipped. Same defect class as the campaign picker: the assignment column ends
 * up empty not because nobody is doing the work, but because nobody can FIND the
 * person.
 *
 * ## Why a separate module rather than a filter on `admin.listEmployees`
 *
 * `admin.canReadAdmin` is Director ∨ OD — correct for the admin roster (it
 * carries email + `flagged_for_review` + `synced_at` + inactive rows), and wrong
 * for a picker: the SPV/Head Account who is the ONLY role allowed to appoint an
 * AM (M6 §3 Rule 2) is neither. The two answer different questions with
 * different scopes and different projections, so they are different reads —
 * exactly the `listCampaigns` vs `listSelectableCampaigns` split (M1 §9.3).
 *
 * ## The projection mirrors the VALIDATORS, deliberately
 *
 * Every assignment door validates its candidate with the same shape
 * (`account.validateAMCandidate`, `task.validatePicForDivision`,
 * `creative.validateCreativeStaff`, `kol.validateKolStaff`,
 * `campaign.validateOwnerCandidate`):
 *
 *     status_aktif AND rm.division = <target division> AND rm.level = 'staff'
 *
 * so `private.employee_assignable()` (migration 20260804170000) INNER JOINs
 * `role_mappings` and filters `status_aktif`, and this module filters by
 * division/level on top. What is OFFERED is therefore exactly what is ACCEPTED.
 * A picker that lists someone the server then rejects is the fastest way to make
 * people stop trusting the dropdown, so `directory.test.ts` pins the two sides
 * to each other.
 *
 * `level` comes from `role_mappings`, NOT from the JWT claim: a layered role
 * (`employee_layered_roles`) can promote a staff member to `lead` in their
 * claims, but the validators read `rm.level`, so the directory must read the
 * same column or the picker and the server would disagree about one person.
 *
 * ## Read path
 *
 * `private.employee_assignable()` is SECURITY DEFINER, so this read runs under
 * `readAsActor` like every other read (O37) while `employees_select` stays
 * own-row for a normal employee and `role_mappings` stays default-deny. The row
 * scope is not widened; only the ANSWER is exposed, and the gate is
 * `canReadDirectory` below.
 *
 * ZERO new BI strings: the deny message is `admin.MSG_ADMIN_READ_DENIED`
 * verbatim (house rule #5 — do not invent labels).
 */

import { permission } from '@cdps/core';
import type { Queryable } from '@cdps/db';
import { MSG_ADMIN_READ_DENIED } from './admin';

/** Authenticated employee + resolved role. */
export type Actor = permission.Actor;

/** Read denied — reused verbatim from the admin plane, no new string. */
export const MSG_DIRECTORY_DENIED = MSG_ADMIN_READ_DENIED;

/** The actor's role may not read the directory (verbatim BI, → 403). */
export class ForbiddenError extends Error {
  constructor(message = MSG_DIRECTORY_DENIED) {
    super(message);
    this.name = 'DirectoryForbiddenError';
  }
}

/**
 * One assignable employee. Identity + the label fields that let a human pick the
 * right person (`divisi`/`jabatan` are the RAW HRIS strings — a LABEL, never a
 * scope) + the resolved CDPS `division`/`level` that the assignment endpoints
 * actually validate against.
 *
 * Deliberately NARROWER than `admin.EmployeeRow`: no `email`, no `flagged`, no
 * `syncedAt`, and inactive employees are absent entirely — none of it is needed
 * to choose a PIC, and a picker is a much wider audience than the admin roster.
 */
export interface AssignableEmployee {
  employeeId: string;
  nama: string;
  divisi: string;
  jabatan: string;
  division: string;
  level: string;
}

/** Optional narrowing: the door's target division and the level it accepts. */
export interface DirectoryFilter {
  /** CDPS division (e.g. 'Account', 'Creative'). '' / undefined = every division. */
  division?: string;
  /** 'staff' | 'lead'. '' / undefined = every level. */
  level?: string;
}

/**
 * canReadDirectory: who may enumerate assignable employees.
 *
 * Any actor with a division scope, plus OD/Director. That is broader than one
 * division on purpose and narrower than "everyone" in the way that matters:
 *
 *  - it must cover an ACCOUNT actor asking for CREATIVE staff — dispatching a
 *    Brief to another division is the AM's job (M6 §5), so a same-division-only
 *    gate would break the very door this exists for;
 *  - OD/Director are read-everywhere by the role matrix (Phase 0 §4);
 *  - an unmapped employee (`division === ''`, no layered role) has no scope at
 *    all and gets nothing — fail-closed, mirroring `permission.canWrite`.
 *
 * The payload is names + jabatan + resolved role of ACTIVE employees, i.e. an
 * internal phone book minus the phone: no email, no money, no personal data, and
 * nothing that is not already on screen (the AM workload table, audit trails and
 * board cards all render employee ids and names today).
 */
export function canReadDirectory(actor: Actor): boolean {
  return permission.canWrite(actor) || permission.canReadAll(actor);
}

/** Raw row shape from `private.employee_assignable()`. */
interface AssignableRow {
  employee_id: string;
  nama: string;
  divisi: string;
  jabatan: string;
  division: string;
  level: string;
}

/**
 * listAssignableEmployees returns the ACTIVE, role-mapped employees a caller may
 * offer in an assignment picker, optionally narrowed to one division/level.
 *
 * Ordering is fixed inside the SQL function (division → staff first → nama), so
 * the dropdown never reshuffles between requests.
 *
 * The filter is applied HERE rather than as a function parameter: the SQL
 * function stays parameterless (no injection surface, one plan, and identical to
 * the `campaign_selectable` precedent), and the directory is small — one HRIS
 * import's worth of employees, already fetched in full by the admin roster.
 */
export async function listAssignableEmployees(
  sql: Queryable,
  actor: Actor,
  filter: DirectoryFilter = {},
): Promise<AssignableEmployee[]> {
  if (!canReadDirectory(actor)) {
    throw new ForbiddenError();
  }
  const division = (filter.division ?? '').trim();
  const level = (filter.level ?? '').trim();
  const rows = await sql<AssignableRow[]>`
    select employee_id, nama, divisi, jabatan, division, level
      from private.employee_assignable()`;
  return rows
    .filter((r) => (division === '' || r.division === division) && (level === '' || r.level === level))
    .map((r) => ({
      employeeId: r.employee_id,
      nama: r.nama,
      divisi: r.divisi,
      jabatan: r.jabatan,
      division: r.division,
      level: r.level,
    }));
}
