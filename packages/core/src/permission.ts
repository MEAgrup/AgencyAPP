/**
 * CDPS role model and the global permission matrix from PERMISSIONS.md.
 *
 * Ported 1:1 from backend/internal/core/permission/permission.go.
 *
 * Universal pattern:
 *   - Staff        = own data only
 *   - Lead/SPV     = division-wide (own division)
 *   - OD           = read-only everywhere + manages OKR (NEVER writes)
 *   - Director     = full view + manage employees / role mappings / layered roles
 *
 * OD and Director are layered roles on top of a normal employee account.
 *
 * These are pure predicates (no DB access). Per SUPABASE_MIGRATION_TECH_APPENDIX
 * §B.4 they are evaluated from the resolved JWT `app_metadata` claim in the API
 * route handler for UX/early validation, and re-implemented identically in
 * RLS (SQL) as the real enforcement layer — the two sides must never diverge.
 */

/** Division seniority level from role_mappings. */
export const LevelStaff = 'staff';
export const LevelLead = 'lead';

/** Resolved CDPS role for an authenticated employee. */
export interface Role {
  division: string; // CDPS division from role mapping (may be "" if unmapped)
  level: string; // staff | lead
  od: boolean; // layered read-only-everywhere role
  director: boolean; // layered full-access role
}

/**
 * Authenticated employee plus resolved role, threaded through the engine and
 * handlers.
 */
export interface Actor {
  employeeId: string;
  nama?: string;
  email?: string;
  divisi?: string; // raw HRIS division
  jabatan?: string; // raw HRIS jabatan
  role: Role;
}

/** Convenience constructor filling optional fields. */
export function makeRole(partial: Partial<Role>): Role {
  return {
    division: partial.division ?? '',
    level: partial.level ?? '',
    od: partial.od ?? false,
    director: partial.director ?? false,
  };
}

/**
 * isLead reports whether the actor acts with lead/SPV authority in division.
 * Directors carry lead authority everywhere. OD does NOT (read-only).
 */
export function isLead(a: Actor, division: string): boolean {
  if (a.role.director) {
    return true;
  }
  return a.role.level === LevelLead && a.role.division === division;
}

/**
 * canWrite reports whether the actor may perform write actions at all.
 * OD is read-only; a pure-OD account (no division write scope) cannot write.
 * Directors can always write. Staff/Lead write within their scope.
 */
export function canWrite(a: Actor): boolean {
  if (a.role.director) {
    return true;
  }
  // A layered OD with an underlying division account still writes from the
  // division scope; only actions attempted "as OD" are read-only. Here we
  // simply require some division scope to exist.
  return a.role.division !== '';
}

/**
 * canManageAdmin reports whether the actor may manage employees, role mappings
 * and layered roles. Director only.
 */
export function canManageAdmin(a: Actor): boolean {
  return a.role.director;
}

/** canReadDivision reports read access to a division's data. */
export function canReadDivision(a: Actor, division: string): boolean {
  if (a.role.director || a.role.od) {
    return true;
  }
  if (a.role.level === LevelLead && a.role.division === division) {
    return true;
  }
  return false;
}

/** canReadAll reports cross-division read access (OD / Director). */
export function canReadAll(a: Actor): boolean {
  return a.role.director || a.role.od;
}

/**
 * The `app_metadata` claim shape injected into the JWT by the GoTrue
 * `custom_access_token_hook` (see migration 20260102000004 §2 `employee_claims`).
 * These five keys are the ONLY authorization inputs the API trusts — they are
 * produced fresh, server-side, from `employees`/`role_mappings`/
 * `employee_layered_roles` on every token issue.
 */
export interface AppMetadataClaims {
  employee_id: string;
  division?: string;
  level?: string;
  od?: boolean;
  director?: boolean;
}

/**
 * actorFromClaims rebuilds an Actor from the JWT `app_metadata` claim. It is the
 * API-side twin of Go's `auth.ResolveActor` and the SQL `employee_claims`
 * function: the same five fields, mapped identically. All three MUST stay in
 * lock-step (see HANDOFF_FASE1_SESI4 §7) — this is the only one exercised at
 * request time, so it is deliberately a pure, unit-tested function.
 *
 * It throws when `employee_id` is absent/empty: a token with no resolved CDPS
 * employee is unauthenticated for our purposes (the hook injects nothing, so
 * every RLS predicate already denies — the handler must reject up front too).
 * Unknown role strings map to empty scope (never elevated), mirroring the SQL
 * `coalesce(..., '')` and Go's `NullString` handling.
 */
export function actorFromClaims(claims: unknown): Actor {
  const m = (claims ?? {}) as Record<string, unknown>;
  const employeeId = typeof m.employee_id === 'string' ? m.employee_id : '';
  if (employeeId === '') {
    throw new Error('permission: app_metadata.employee_id missing — unresolved CDPS actor');
  }
  const division = typeof m.division === 'string' ? m.division : '';
  const rawLevel = typeof m.level === 'string' ? m.level : '';
  // Only the two known levels carry authority; anything else is empty scope.
  const level = rawLevel === LevelLead || rawLevel === LevelStaff ? rawLevel : '';
  return {
    employeeId,
    role: {
      division,
      level,
      od: m.od === true,
      director: m.director === true,
    },
  };
}
