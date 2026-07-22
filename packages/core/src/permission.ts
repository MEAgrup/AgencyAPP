// CDPS role model + global permission matrix (PERMISSIONS.md / Phase 0 §4).
//
// Ported 1:1 from backend/internal/core/permission/permission.go
// (SUPABASE_MIGRATION_TECH_APPENDIX §B.4). These are PURE predicates — no DB
// access. Role resolution (employees JOIN role_mappings + employee_layered_roles)
// happens once at session creation and is written as a Supabase Auth custom claim
// (`app_metadata`, §C); these predicates then evaluate against that resolved role
// with no per-request DB round-trip, exactly as the Go `Actor` is resolved once
// per request.
//
// IMPORTANT (§B.4): the RLS policies (§D) evaluate the SAME predicates
// independently at the Postgres level from the JWT claim. TypeScript is the
// early/UX gate; RLS is the real enforcement. Both derive from PERMISSIONS.md and
// must never diverge — a contract test (pgTAP + vitest) runs the same matrix on
// both sides (§G).
//
// Universal pattern:
//   - Staff        = own data only
//   - Lead/SPV     = division-wide (own division)
//   - OD           = read-only everywhere + manages OKR (NEVER writes)
//   - Director     = full view + manage employees / role mappings / layered roles
//
// OD and Director are layered roles on top of a normal employee account.

/** Division seniority level from role_mappings. */
export const LevelStaff = "staff";
export const LevelLead = "lead";
export type Level = typeof LevelStaff | typeof LevelLead | "";

/** Role is the resolved CDPS role for an authenticated employee. */
export interface Role {
  division: string; // CDPS division from role mapping (may be "" if unmapped)
  level: Level; // staff | lead
  od: boolean; // layered read-only-everywhere role
  director: boolean; // layered full-access role
}

/**
 * Actor is an authenticated employee plus resolved role, threaded through the
 * engine and handlers.
 */
export interface Actor {
  employeeId: string;
  nama?: string;
  email?: string;
  divisi?: string; // raw HRIS division
  jabatan?: string; // raw HRIS jabatan
  role: Role;
}

/** newRole builds a Role with defaults, so callers can pass partials. */
export function newRole(partial: Partial<Role> = {}): Role {
  return {
    division: partial.division ?? "",
    level: partial.level ?? "",
    od: partial.od ?? false,
    director: partial.director ?? false,
  };
}

/**
 * isLead reports whether the actor acts with lead/SPV authority in `division`.
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
  // division scope; only actions attempted "as OD" are read-only. Here we simply
  // require some division scope to exist.
  return a.role.division !== "";
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
