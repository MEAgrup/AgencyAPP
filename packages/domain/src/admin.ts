/**
 * Admin plane: employee directory, HRIS→CDPS role mappings, layered OD/Director
 * roles. Ported from Go's `internal/admin/roles.go` + `ListEmployees`
 * (`internal/admin/employees.go`).
 *
 * Why this module exists at all (DECISIONS **O44**): `web-internal` already
 * ships the two admin pages that drive this plane — `admin/employees` and
 * `admin/role-mappings`, both linked in the sidebar for `director || od` — but
 * their six endpoints were never ported, so both pages were dead in production.
 * That, not an undecided policy, is why changing anyone's role required raw SQL
 * against prod (**O42**).
 *
 * `role_mappings` is the permission root: `employee_claims()`
 * (`20260723071013_supabase_auth.sql` §2) derives `division`/`level` from
 * `role_mappings(divisi, jabatan)`, and a trigger re-syncs `auth.users`
 * app-metadata on every change. So a write here re-issues claims for everyone
 * holding that divisi+jabatan — the blast radius is the mapping, not one person.
 *
 * ## Read path: deliberately NOT `readAsActor` for two of the three tables
 *
 * `role_mappings` and `employee_layered_roles` are in the "pure internal" group
 * of `20260723064438_rls_baseline.sql` §5: RLS on, **no policy** (default-deny),
 * and `SELECT` revoked from `authenticated`. They are reachable only by
 * SECURITY DEFINER functions and `service_role` — by design, because they carry
 * the authorization rules themselves. Reading them through `readAsActor` would
 * therefore return nothing at all, so these two reads run on the privileged
 * client with the gate enforced HERE, in the app layer, mirroring Go's
 * handlers. `employees` is different — it has `employees_select` allowing
 * Director/OD to read everything — so its read goes through RLS as usual and
 * this module does not re-filter rows.
 *
 * House rules honored: exact BI `[...]` messages (ported byte-for-byte from the
 * Go handlers, no new strings); every write appends an audit row; reads are
 * gated per Phase 0 §4 (Director writes; Director/OD read).
 *
 * Reference: backend/internal/admin/roles.go, backend/internal/admin/employees.go,
 * backend/internal/httpapi/admin_handlers.go.
 */

import { permission } from '@cdps/core';
import { executors, withTransaction, type Queryable, type Sql } from '@cdps/db';

/** Authenticated employee + resolved role. */
export type Actor = permission.Actor;

// ---------------------------------------------------------------------------
// Exact BI messages — ported verbatim from the Go handlers. Do NOT reword.
// ---------------------------------------------------------------------------

/** Read denied (Go: handleListEmployees / handleListRoleMappings / handleListLayeredRoles). */
export const MSG_ADMIN_READ_DENIED = '[anda tidak memiliki akses ke data ini]';
/** Role-mapping write denied (Go: handleCreateRoleMapping / handleDeleteRoleMapping). */
export const MSG_ROLE_MAPPING_DENIED = '[hanya Director yang dapat mengelola role mapping]';
/** Layered-role write denied (Go: handleSetLayeredRole). */
export const MSG_LAYERED_ROLE_DENIED = '[hanya Director yang dapat mengelola layered role]';
/** Go: admin.ErrBadLevel, wrapped in brackets by the handler. */
export const MSG_BAD_LEVEL = "[level harus 'staff' atau 'lead']";
/** Go: admin.ErrBadRole, wrapped in brackets by the handler. */
export const MSG_BAD_ROLE = "[role harus 'od' atau 'director']";
/** House default mandatory-field gate (CLAUDE.md #5). */
export const MSG_INCOMPLETE = '[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Actor may not perform this admin action (carries the verbatim BI message). */
export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdminForbiddenError';
  }
}

/** Mandatory-field or enum-domain violation (verbatim BI message). */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdminValidationError';
  }
}

// ---------------------------------------------------------------------------
// Permission predicates (Phase 0 §4; mirror of Go's handler gates)
// ---------------------------------------------------------------------------

/** Director/OD may READ the admin plane. OD is read-only everywhere by design. */
export function canReadAdmin(actor: Actor): boolean {
  return permission.canManageAdmin(actor) || actor.role.od;
}

/** Only Director may WRITE the admin plane (OD stays read-only). */
export function canWriteAdmin(actor: Actor): boolean {
  return permission.canManageAdmin(actor);
}

// ---------------------------------------------------------------------------
// Employee directory
// ---------------------------------------------------------------------------

/**
 * One row of the admin employee directory. `divisi`/`jabatan` are the RAW HRIS
 * strings — they are the LEFT side of a role mapping, not a CDPS division, so
 * never use them for scoping.
 */
export interface EmployeeRow {
  employeeId: string;
  nama: string;
  email: string;
  divisi: string;
  jabatan: string;
  statusAktif: boolean;
  flagged: boolean;
  syncedAt: Date | null;
}

/**
 * listEmployees returns the directory, ordered as Go's ListEmployees does.
 * Row visibility is RLS's job (`employees_select`) — pass a `readAsActor`
 * transaction, not the privileged client, so a non-Director cannot read the
 * whole directory by calling this.
 */
export async function listEmployees(sql: Queryable): Promise<EmployeeRow[]> {
  const rows = await sql<
    {
      employee_id: string; nama: string; email: string; divisi: string; jabatan: string;
      status_aktif: boolean; flagged_for_review: boolean; synced_at: Date | null;
    }[]
  >`
    select employee_id, nama, email, divisi, jabatan, status_aktif, flagged_for_review, synced_at
      from employees
     order by divisi, nama`;
  return rows.map((r) => ({
    employeeId: r.employee_id,
    nama: r.nama,
    email: r.email,
    divisi: r.divisi,
    jabatan: r.jabatan,
    statusAktif: r.status_aktif,
    flagged: r.flagged_for_review,
    syncedAt: r.synced_at,
  }));
}

// ---------------------------------------------------------------------------
// Role mappings (HRIS divisi+jabatan → CDPS division+level)
// ---------------------------------------------------------------------------

/**
 * A mapping rule. `id` is a string because the column is `bigint GENERATED
 * ALWAYS AS IDENTITY` and postgres.js hands int8 back as a string — which is
 * also what web-internal's `RoleMapping.id: string` expects (the C03-F2 class
 * of bug: a raw bigint through the wire breaks the page).
 */
export interface RoleMapping {
  id: string;
  divisi: string;
  jabatan: string;
  division: string;
  level: string;
  createdAt: Date;
}

/** Input for an upsert. Trimmed and validated before anything is written. */
export interface RoleMappingInput {
  divisi: string;
  jabatan: string;
  division: string;
  level: string;
}

/**
 * listRoleMappings returns every mapping rule, ordered as Go does.
 *
 * Takes the PRIVILEGED client on purpose: `role_mappings` is default-deny with
 * `SELECT` revoked from `authenticated` (rls_baseline §5), so RLS cannot scope
 * this read — the caller MUST have checked `canReadAdmin` first. The route does.
 */
export async function listRoleMappings(sql: Queryable): Promise<RoleMapping[]> {
  const rows = await sql<
    { id: string; divisi: string; jabatan: string; division: string; level: string; created_at: Date }[]
  >`
    select id, divisi, jabatan, division, level, created_at
      from role_mappings
     order by divisi, jabatan`;
  return rows.map((r) => ({
    id: String(r.id),
    divisi: r.divisi,
    jabatan: r.jabatan,
    division: r.division,
    level: r.level,
    createdAt: r.created_at,
  }));
}

/**
 * upsertRoleMapping inserts or updates one rule and appends an audit row, in a
 * single transaction. Keyed on `(divisi, jabatan)` — the table's
 * `uq_role_mapping` — so re-submitting the same pair edits it instead of
 * duplicating, exactly like Go's `ON DUPLICATE KEY UPDATE`.
 *
 * The audit row carries the BEFORE state when the pair already existed, so a
 * silent re-grade (`staff`→`lead`) is reconstructible from the log (house #3).
 * Returns the row id.
 */
export async function upsertRoleMapping(sql: Sql, actor: Actor, input: RoleMappingInput): Promise<string> {
  if (!canWriteAdmin(actor)) {
    throw new ForbiddenError(MSG_ROLE_MAPPING_DENIED);
  }
  const divisi = input.divisi.trim();
  const jabatan = input.jabatan.trim();
  const division = input.division.trim();
  const level = input.level.trim();
  // Mandatory-field gate BEFORE the enum check, so an empty form reports the
  // house default rather than complaining about `level` (mirror of Go, where
  // decodeJSON's emptiness check precedes UpsertRoleMapping's level check).
  if (divisi === '' || jabatan === '' || division === '') {
    throw new ValidationError(MSG_INCOMPLETE);
  }
  if (level !== permission.LevelStaff && level !== permission.LevelLead) {
    throw new ValidationError(MSG_BAD_LEVEL);
  }
  return withTransaction(sql, async (tx) => {
    const before = await tx<{ division: string; level: string }[]>`
      select division, level from role_mappings
       where divisi = ${divisi} and jabatan = ${jabatan}
       for update`;
    const rows = await tx<{ id: string }[]>`
      insert into role_mappings (divisi, jabatan, division, level, created_by)
      values (${divisi}, ${jabatan}, ${division}, ${level}, ${actor.employeeId})
      on conflict (divisi, jabatan)
        do update set division = excluded.division, level = excluded.level
      returning id`;
    const id = String(rows[0]!.id);
    await executors(tx).audit.insertAudit({
      entityType: 'role_mapping',
      entityId: `${divisi}/${jabatan}`,
      actorEmployeeId: actor.employeeId,
      action: 'upsert',
      beforeJson: before[0] ? { division: before[0].division, level: before[0].level } : null,
      afterJson: { division, level },
      createdBy: actor.employeeId,
    });
    return id;
  });
}

/**
 * deleteRoleMapping removes a rule by id (+ audit). Deleting a mapping REVOKES
 * the derived division/level for everyone holding that divisi+jabatan, so the
 * before-state is captured into the audit row first — otherwise the log could
 * not answer "what did this rule grant?" afterwards.
 */
export async function deleteRoleMapping(sql: Sql, actor: Actor, id: string): Promise<void> {
  if (!canWriteAdmin(actor)) {
    throw new ForbiddenError(MSG_ROLE_MAPPING_DENIED);
  }
  await withTransaction(sql, async (tx) => {
    const before = await tx<
      { divisi: string; jabatan: string; division: string; level: string }[]
    >`select divisi, jabatan, division, level from role_mappings where id = ${id} for update`;
    await tx`delete from role_mappings where id = ${id}`;
    await executors(tx).audit.insertAudit({
      entityType: 'role_mapping',
      entityId: before[0] ? `${before[0].divisi}/${before[0].jabatan}` : id,
      actorEmployeeId: actor.employeeId,
      action: 'delete',
      beforeJson: before[0]
        ? { division: before[0].division, level: before[0].level }
        : null,
      afterJson: null,
      createdBy: actor.employeeId,
    });
  });
}

// ---------------------------------------------------------------------------
// Layered OD/Director roles
// ---------------------------------------------------------------------------

/** An OD/Director role layered on top of a normal employee account. */
export interface LayeredRole {
  id: string;
  employeeId: string;
  role: string;
  enabled: boolean;
  createdAt: Date;
}

/** The only two layered roles (Go: admin.ErrBadRole guards this set). */
const LAYERED_ROLES = new Set(['od', 'director']);

/**
 * listLayeredRoles returns every layered-role assignment, ordered as Go does.
 * Privileged read for the same reason as `listRoleMappings` — the table is
 * default-deny (rls_baseline §5). Caller MUST have checked `canReadAdmin`.
 */
export async function listLayeredRoles(sql: Queryable): Promise<LayeredRole[]> {
  const rows = await sql<
    { id: string; employee_id: string; role: string; enabled: boolean; created_at: Date }[]
  >`
    select id, employee_id, role, enabled, created_at
      from employee_layered_roles
     order by employee_id, role`;
  return rows.map((r) => ({
    id: String(r.id),
    employeeId: r.employee_id,
    role: r.role,
    enabled: r.enabled,
    createdAt: r.created_at,
  }));
}

/**
 * setLayeredRole enables/disables a layered OD/Director role for one employee
 * (+ audit), keyed on `uq_layered_role (employee_id, role)`.
 *
 * NOTE this grants the two most powerful roles in CDPS, so it is Director-only
 * and always audited with its before-state. Absence of a mapping is meaningful
 * elsewhere (`employee_claims()` treats an unmapped employee as pure OD/
 * Director), which is why this DISABLES rather than deletes.
 */
export async function setLayeredRole(
  sql: Sql,
  actor: Actor,
  employeeId: string,
  role: string,
  enabled: boolean,
): Promise<void> {
  if (!canWriteAdmin(actor)) {
    throw new ForbiddenError(MSG_LAYERED_ROLE_DENIED);
  }
  const emp = employeeId.trim();
  const r = role.trim();
  if (emp === '' || r === '') {
    throw new ValidationError(MSG_INCOMPLETE);
  }
  if (!LAYERED_ROLES.has(r)) {
    throw new ValidationError(MSG_BAD_ROLE);
  }
  await withTransaction(sql, async (tx) => {
    const before = await tx<{ enabled: boolean }[]>`
      select enabled from employee_layered_roles
       where employee_id = ${emp} and role = ${r}
       for update`;
    await tx`
      insert into employee_layered_roles (employee_id, role, enabled, created_by)
      values (${emp}, ${r}, ${enabled}, ${actor.employeeId})
      on conflict (employee_id, role) do update set enabled = excluded.enabled`;
    await executors(tx).audit.insertAudit({
      entityType: 'layered_role',
      entityId: emp,
      actorEmployeeId: actor.employeeId,
      action: 'set',
      beforeJson: before[0] ? { role: r, enabled: before[0].enabled } : null,
      afterJson: { role: r, enabled },
      createdBy: actor.employeeId,
    });
  });
}
