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
 * Reference: archive/backend-go/internal/admin/roles.go, archive/backend-go/internal/admin/employees.go,
 * archive/backend-go/internal/httpapi/admin_handlers.go.
 */

import { permission } from '@cdps/core';
import { executors, withTransaction, type Queryable, type Sql } from '@cdps/db';
import {
  linkAuthUsers,
  provisionCredentials,
  syncEmployees,
  type Employee,
  type ImportResult,
} from './employees';

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
/**
 * Go: admin.ErrBadRole, wrapped in brackets by the handler.
 *
 * `lead` joined the set on 2026-07-30 (migrasi `20260730154210_layered_lead_role`),
 * so the message enumerates three roles. Go is retired (CLAUDE.md §Stack), so it
 * is no longer the parity oracle for this string.
 */
export const MSG_BAD_ROLE = "[role harus 'od', 'director', atau 'lead']";
/** House default mandatory-field gate (CLAUDE.md #5). */
export const MSG_INCOMPLETE = '[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]';
/**
 * Employee-mutation (divisi/jabatan) write denied. NEW string — this feature has
 * no Go ancestor (the roster mutation UI was added on the TS stack). Gate is
 * Director OR a Lead of the HR division (see `canManageEmployeeAssignment`).
 */
export const MSG_EMPLOYEE_MUTATION_DENIED =
  '[hanya Director atau Lead HR yang dapat mengubah divisi/jabatan karyawan]';
/** Employee-mutation target does not exist. */
export const MSG_EMPLOYEE_NOT_FOUND = '[karyawan tidak ditemukan]';
/** Manual add-employee write denied (same gate as mutation: Director OR HR Lead). */
export const MSG_EMPLOYEE_ADD_DENIED =
  '[hanya Director atau Lead HR yang dapat menambah karyawan]';
/** Manual add hit an existing employee_id or email (PK / uq_employees_email). */
export const MSG_EMPLOYEE_EXISTS = '[karyawan dengan ID atau email itu sudah terdaftar]';
/**
 * The submitted divisi/jabatan does not match any `role_mappings` row. This is
 * the server-side twin of the UI picker (web-internal builds its mutasi/add
 * forms from `GET /admin/role-mappings`, not free text) — the real gate lives
 * here, per house convention, so a direct API call cannot recreate the O42-style
 * defect of an employee stranded with no resolvable CDPS division/level.
 */
export const MSG_UNMAPPED_POSITION =
  '[divisi/jabatan tidak dikenali, pilih posisi yang sudah dipetakan di Role Mapping]';

/**
 * Resign (permanent access revocation) write denied. Same gate as a mutation —
 * Director OR a Lead of the HR division — so the sentence names the same two
 * roles rather than inventing a third authority.
 */
export const MSG_RESIGN_DENIED =
  '[hanya Director atau Lead HR yang dapat mencabut akses karyawan]';
/**
 * The target already carries `resigned_at`. A second resign is refused rather
 * than treated as idempotent: "already revoked" and "just revoked by me" are
 * different facts, and the audit trail should not gain a second `resign` row
 * that claims a revocation which did not happen.
 */
export const MSG_SUDAH_RESIGN = '[karyawan ini sudah dicabut aksesnya]';
/** Resign requires a reason — it is the only free-text explanation the audit row will ever carry. */
export const MSG_RESIGN_ALASAN_WAJIB = '[alasan resign wajib diisi]';

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

/** Admin-plane target row not found (verbatim BI message). Maps to 404. */
export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdminNotFoundError';
  }
}

/** Duplicate on a uniqueness constraint (employee_id / email). Maps to 409. */
export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdminConflictError';
  }
}

// ---------------------------------------------------------------------------
// Permission predicates (Phase 0 §4; mirror of Go's handler gates)
// ---------------------------------------------------------------------------

/**
 * Director/OD may READ the admin plane. OD is read-only everywhere by design.
 *
 * Plus the Lead of the HR division, and that arm is a bug fix rather than a
 * widening: `canManageEmployeeAssignment` has let an HR Lead mutate an
 * employee since 2026-08-10, but this predicate refused them the LIST — so the
 * only people who could run a mutasi could not find anyone to run it on. The
 * roster page's other source (`GET /auth/admin/credentials`) is no help either:
 * it scopes a Lead to their own mapped division, so an HR Lead saw HR staff
 * only. A write authority that cannot read its own subjects is not a feature.
 *
 * Deliberately NOT extended to passwords: `auth.canManagePasswords` /
 * `adminMayManage` stay as they are, because letting HR reset anyone's password
 * would be privilege escalation by password takeover — the exact thing
 * `adminMayManage` already refuses for every other Lead.
 */
export function canReadAdmin(actor: Actor): boolean {
  return permission.canManageAdmin(actor) || actor.role.od || canManageEmployeeAssignment(actor);
}

/** Only Director may WRITE the admin plane (OD stays read-only). */
export function canWriteAdmin(actor: Actor): boolean {
  return permission.canManageAdmin(actor);
}

/**
 * The CDPS division whose Lead is trusted to run employee mutations (transfers).
 *
 * CDPS has no dedicated "HR" role — the model is Staff/Lead/OD/Director. The
 * owner's decision (DECISIONS 2026-08-10) is that, besides Director, the Lead of
 * the HR division may edit an employee's divisi/jabatan. This is a plain CDPS
 * division string on the RIGHT side of a `role_mappings` row (like `Account`,
 * `Ads`, `Finance`), NOT a raw HRIS divisi. There are ZERO holders until a
 * Director maps some HR jabatan → (division `HR`, level `lead`); the gate is
 * written now so the arm exists the moment that mapping is created.
 */
export const HR_DIVISION = 'HR';

/**
 * canManageEmployeeAssignment gates the divisi/jabatan mutation. Director always;
 * otherwise ONLY a Lead of the HR division.
 *
 * This is deliberately NARROW (not "any division Lead") because divisi+jabatan is
 * the LEFT side of a role mapping: editing it re-derives an employee's CDPS role
 * via `employee_claims()` (and `trg_sync_claims_employee` re-issues their JWT
 * claims). Letting an arbitrary Lead rewrite it would be privilege escalation —
 * they could re-grade themselves onto a Director-mapped jabatan.
 */
export function canManageEmployeeAssignment(actor: Actor): boolean {
  if (actor.role.director) {
    return true;
  }
  return actor.role.level === permission.LevelLead && actor.role.division === HR_DIVISION;
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
  /**
   * When set, access was PERMANENTLY revoked (migration 20260929010000) — the
   * row is kept only so historical attribution keeps resolving. Deliberately
   * separate from `statusAktif`: an HRIS-inactive employee can come back on the
   * next sync, a resigned one never can, and one boolean cannot say both.
   */
  resignedAt: Date | null;
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
      resigned_at: Date | null;
    }[]
  >`
    select employee_id, nama, email, divisi, jabatan, status_aktif, flagged_for_review, synced_at,
           resigned_at
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
    resignedAt: r.resigned_at,
  }));
}

/**
 * updateEmployeeAssignment edits ONE employee's divisi/jabatan (a "mutasi" /
 * transfer) and appends an audit row, in a single transaction. Returns the
 * updated row.
 *
 * Consequences to keep in mind (all handled by existing DB machinery, not here):
 *   - divisi+jabatan is the LEFT side of a `role_mappings` row, so this can
 *     re-derive the employee's CDPS division/level. `trg_sync_claims_employee`
 *     (fires `AFTER UPDATE OF ... divisi, jabatan`) re-issues their `auth.users`
 *     app-metadata, so the new claims take effect on their next token refresh.
 *   - the audit row carries the BEFORE state so a silent transfer is
 *     reconstructible from the log (house rule #3).
 *
 * Gate: Director OR HR-division Lead (`canManageEmployeeAssignment`). Takes the
 * PRIVILEGED client — the write bypasses RLS and the trigger's claim re-sync is
 * service-role only; the gate is enforced HERE, mirroring the role-mapping writes.
 */
export async function updateEmployeeAssignment(
  sql: Sql,
  actor: Actor,
  employeeId: string,
  divisi: string,
  jabatan: string,
): Promise<EmployeeRow> {
  if (!canManageEmployeeAssignment(actor)) {
    throw new ForbiddenError(MSG_EMPLOYEE_MUTATION_DENIED);
  }
  const id = employeeId.trim();
  const d = divisi.trim();
  const j = jabatan.trim();
  if (id === '' || d === '' || j === '') {
    throw new ValidationError(MSG_INCOMPLETE);
  }
  return withTransaction(sql, async (tx) => {
    const before = await tx<{ divisi: string; jabatan: string }[]>`
      select divisi, jabatan from employees where employee_id = ${id} for update`;
    if (before.length === 0) {
      throw new NotFoundError(MSG_EMPLOYEE_NOT_FOUND);
    }
    const mapped = await tx<{ id: string }[]>`
      select id from role_mappings where divisi = ${d} and jabatan = ${j} limit 1`;
    if (mapped.length === 0) {
      throw new ValidationError(MSG_UNMAPPED_POSITION);
    }
    const rows = await tx<
      {
        employee_id: string; nama: string; email: string; divisi: string; jabatan: string;
        status_aktif: boolean; flagged_for_review: boolean; synced_at: Date | null;
        resigned_at: Date | null;
      }[]
    >`
      update employees set divisi = ${d}, jabatan = ${j}
       where employee_id = ${id}
      returning employee_id, nama, email, divisi, jabatan, status_aktif, flagged_for_review, synced_at,
                resigned_at`;
    await executors(tx).audit.insertAudit({
      entityType: 'employee',
      entityId: id,
      actorEmployeeId: actor.employeeId,
      action: 'reassign',
      beforeJson: { divisi: before[0].divisi, jabatan: before[0].jabatan },
      afterJson: { divisi: d, jabatan: j },
      createdBy: actor.employeeId,
    });
    const r = rows[0]!;
    return {
      employeeId: r.employee_id,
      nama: r.nama,
      email: r.email,
      divisi: r.divisi,
      jabatan: r.jabatan,
      statusAktif: r.status_aktif,
      flagged: r.flagged_for_review,
      syncedAt: r.synced_at,
      resignedAt: r.resigned_at,
    };
  });
}

// ---------------------------------------------------------------------------
// Resign — permanent access revocation (owner decision 2026-09-10)
// ---------------------------------------------------------------------------

/**
 * One thing that still points at an employee after they leave. `kind` names the
 * category so the UI can group without re-deriving it, `label` is what a human
 * reads, and `id` is the record to open.
 */
export interface HandoverItem {
  kind: 'klien_sales_pic' | 'klien_am' | 'klien_komisi_pic' | 'brief' | 'penugasan' | 'scs' | 'booking_kol';
  id: string;
  label: string;
}

/**
 * Everything still assigned to `employeeId`, for the confirmation step of a
 * resign.
 *
 * ## Why this REPORTS instead of reassigning
 *
 * The owner asked resign to "sekalian lepas penugasan aktif", and the tempting
 * reading is to null out or auto-move every pointer. That would be wrong for the
 * three client-level ones: `sales_pic_id` and `commission_payment_pic_id` decide
 * who earns commission, and moving them silently is exactly the trap DECISIONS
 * 2026-09-08 (FS-4) already refused — "kepemilikan klien berpindah tiap bulan,
 * diam-diam, ke siapa pun yang kebetulan menekan tombol". M4 already owns that
 * transfer (Sales Lead, logged); resign surfaces the list and sends the operator
 * there rather than inventing a second, unlogged path to the same money.
 *
 * The work-level pointers (Brief PIC, Penugasan, SCS, KOL booking) are not
 * money, but they are still someone's decision: a division lead reassigns based
 * on who has capacity, which this function cannot know. So it reports those too.
 *
 * What resign DOES do automatically is the part that needs no judgement: the
 * person can no longer log in, and `private.employee_assignable()` filters on
 * `status_aktif`, so they immediately disappear from every future picker.
 *
 * Non-terminal is resolved from `sm_terminal_states`, not from a hardcoded list
 * of status strings — the machines already own that vocabulary, and a copy here
 * would drift the first time a state is added.
 */
export async function handoverList(sql: Queryable, employeeId: string): Promise<HandoverItem[]> {
  const id = employeeId.trim();
  if (id === '') {
    return [];
  }
  const rows = await sql<{ kind: string; id: string; label: string }[]>`
    select 'klien_sales_pic' as kind, c.id, c.toko as label
      from clients c where c.sales_pic_id = ${id}
    union all
    select 'klien_am', c.id, c.toko
      from clients c where c.assigned_am_id = ${id}
    union all
    select 'klien_komisi_pic', c.id, c.toko
      from clients c where c.commission_payment_pic_id = ${id}
    union all
    select 'brief', b.id, b.status
      from briefs b
     where b.assigned_pic = ${id}
       and not exists (select 1 from sm_terminal_states t
                        where t.machine = 'brief_task' and t.state = b.status)
    union all
    select 'penugasan', t.id, t.judul
      from internal_tasks t
     where t.assignee_id = ${id}
       and not exists (select 1 from sm_terminal_states s
                        where s.machine = 'internal_task' and s.state = t.status)
    union all
    select 'scs', k.id, k.status
      from scs_tasks k
     where k.assigned_pic = ${id}
       and not exists (select 1 from sm_terminal_states s
                        where s.machine = 'scs_task' and s.state = k.status)
    union all
    select 'booking_kol', bk.id, bk.status
      from creator_bookings bk
     where bk.assigned_coordinator = ${id}
       and not exists (select 1 from sm_terminal_states s
                        where s.machine = 'creator_booking' and s.state = bk.status)
    order by kind, id`;
  return rows.map((r) => ({ kind: r.kind as HandoverItem['kind'], id: r.id, label: r.label ?? '' }));
}

/** What a completed resign reports back: the updated row plus what it left behind. */
export interface ResignResult {
  employee: EmployeeRow;
  handover: HandoverItem[];
}

/**
 * resignEmployee permanently revokes an employee's CDPS access and appends an
 * audit row, in one transaction. Returns the updated row plus the handover list
 * as it stood at revocation time.
 *
 * PERMANENT means: `resigned_at` is set once and there is no path in this module
 * that clears it. The DB carries the same rule (`ck_employees_resign_nonaktif`),
 * and `syncEmployees` refuses to reactivate such a row — so an HRIS sheet that
 * still lists the person as active cannot undo this either. Per the owner's
 * decision there is deliberately NO undo affordance; correcting a mis-click
 * needs a Director and a migration, and the UI says so before asking.
 *
 * The row itself is KEPT (house rule #3): `clients.sales_pic_id`,
 * `client_sales_allocations`, `briefs.assigned_pic` and every `audit_log` row
 * they ever wrote still point here, so deleting it would break historical
 * attribution rather than tidy it.
 *
 * Gate: `canManageEmployeeAssignment` — Director OR HR-division Lead, the SAME
 * predicate as a mutasi. Reused rather than re-derived on purpose: revoking
 * access and moving someone between divisions are the same HR authority, and a
 * second predicate would be a second thing to keep in step. OD is absent from
 * it, which is the point — OD never writes.
 *
 * Takes the PRIVILEGED client: `set_employee_banned()` is service-role only and
 * the write bypasses RLS, mirroring `updateEmployeeAssignment`.
 */
export async function resignEmployee(
  sql: Sql,
  actor: Actor,
  employeeId: string,
  input: { alasan: string },
): Promise<ResignResult> {
  if (!canManageEmployeeAssignment(actor)) {
    throw new ForbiddenError(MSG_RESIGN_DENIED);
  }
  const id = employeeId.trim();
  const alasan = input.alasan.trim();
  if (id === '') {
    throw new ValidationError(MSG_INCOMPLETE);
  }
  // A separate message from the generic one: "you forgot the reason" and "you
  // forgot who" are different mistakes, and the reason is the only free text
  // the audit row will ever carry about why access went away.
  if (alasan === '') {
    throw new ValidationError(MSG_RESIGN_ALASAN_WAJIB);
  }
  return withTransaction(sql, async (tx) => {
    const before = await tx<
      { status_aktif: boolean; resigned_at: Date | null; nama: string; divisi: string; jabatan: string }[]
    >`
      select status_aktif, resigned_at, nama, divisi, jabatan
        from employees where employee_id = ${id} for update`;
    if (before.length === 0) {
      throw new NotFoundError(MSG_EMPLOYEE_NOT_FOUND);
    }
    if (before[0].resigned_at !== null) {
      throw new ConflictError(MSG_SUDAH_RESIGN);
    }

    // Read the handover list BEFORE the update. It is a snapshot of what was
    // still assigned at the moment access was revoked; reading it after would
    // report the same rows but date them wrongly in the audit entry.
    const handover = await handoverList(tx, id);

    const now = new Date();
    const rows = await tx<
      {
        employee_id: string; nama: string; email: string; divisi: string; jabatan: string;
        status_aktif: boolean; flagged_for_review: boolean; synced_at: Date | null;
        resigned_at: Date | null;
      }[]
    >`
      update employees
         set resigned_at = ${now}, resigned_by = ${actor.employeeId}, status_aktif = false
       where employee_id = ${id}
      returning employee_id, nama, email, divisi, jabatan, status_aktif, flagged_for_review,
                synced_at, resigned_at`;

    // Ban in GoTrue so the token stops being issued (no-op on a plain PG).
    await tx`select set_employee_banned(${id}, true)`;
    // And revoke any CDPS-owned session still alive, so an already-issued token
    // does not outlive the revocation until its own expiry.
    await tx`
      update sessions set revoked_at = ${now}
       where employee_id = ${id} and revoked_at is null`;

    await executors(tx).audit.insertAudit({
      entityType: 'employee',
      entityId: id,
      actorEmployeeId: actor.employeeId,
      action: 'resign',
      beforeJson: {
        status_aktif: before[0].status_aktif,
        resigned_at: null,
        divisi: before[0].divisi,
        jabatan: before[0].jabatan,
      },
      afterJson: {
        status_aktif: false,
        resigned_at: now.toISOString(),
        alasan,
        // Counted, not enumerated: the list can be long, and audit rows are
        // read as evidence of a decision, not as a work queue. The queue is the
        // response body the operator just acted on.
        penugasan_tertinggal: handover.length,
      },
      createdBy: actor.employeeId,
    });

    const r = rows[0]!;
    return {
      employee: {
        employeeId: r.employee_id,
        nama: r.nama,
        email: r.email,
        divisi: r.divisi,
        jabatan: r.jabatan,
        statusAktif: r.status_aktif,
        flagged: r.flagged_for_review,
        syncedAt: r.synced_at,
        resignedAt: r.resigned_at,
      },
      handover,
    };
  });
}

/** Input for a manual single-employee add (the "bukan lewat sheets" path). */
export interface NewEmployeeInput {
  employeeId: string;
  nama: string;
  email: string;
  divisi: string;
  jabatan: string;
  /** Defaults to true — a manual add is normally an active hire. */
  statusAktif?: boolean;
  /** Optional initial temp password; blank => module DEFAULT_TEMP_PASSWORD. */
  tempPassword?: string;
}

/**
 * addEmployeeManually creates ONE employee without a CSV/sheet import — the same
 * end state as a one-row import, in a single transaction: upsert `employees`,
 * provision a bcrypt credential (`must_change_password=true`), link the GoTrue
 * user, and append a `create` audit row. So the new hire can log in with a temp
 * password and is forced to change it on first login.
 *
 * `employee_id` is the HRIS-issued NIK — CDPS never invents it (DATA_MODEL), so
 * the caller supplies it. A pre-check turns a PK/`uq_employees_email` clash into
 * a clean BI message instead of a raw constraint violation.
 *
 * Gate: Director OR HR-division Lead (same authority as a transfer — this is HR
 * roster management). Takes the PRIVILEGED client: provisioning + GoTrue link go
 * through service-role-only SQL functions, exactly like the CSV import.
 */
export async function addEmployeeManually(
  sql: Sql,
  actor: Actor,
  input: NewEmployeeInput,
): Promise<ImportResult> {
  if (!canManageEmployeeAssignment(actor)) {
    throw new ForbiddenError(MSG_EMPLOYEE_ADD_DENIED);
  }
  const emp: Employee = {
    employeeId: input.employeeId.trim(),
    nama: input.nama.trim(),
    email: input.email.trim(),
    divisi: input.divisi.trim(),
    jabatan: input.jabatan.trim(),
    statusAktif: input.statusAktif ?? true,
    password: (input.tempPassword ?? '').trim() || undefined,
  };
  if (
    emp.employeeId === '' || emp.nama === '' || emp.email === '' ||
    emp.divisi === '' || emp.jabatan === ''
  ) {
    throw new ValidationError(MSG_INCOMPLETE);
  }
  return withTransaction(sql, async (tx) => {
    // Reject a duplicate up front so "add" never silently overwrites an existing
    // employee (the mutation feature is the path for editing one).
    const clash = await tx<{ employee_id: string }[]>`
      select employee_id from employees
       where employee_id = ${emp.employeeId} or email = ${emp.email}
       limit 1`;
    if (clash.length > 0) {
      throw new ConflictError(MSG_EMPLOYEE_EXISTS);
    }
    const mapped = await tx<{ id: string }[]>`
      select id from role_mappings where divisi = ${emp.divisi} and jabatan = ${emp.jabatan} limit 1`;
    if (mapped.length === 0) {
      throw new ValidationError(MSG_UNMAPPED_POSITION);
    }
    // Reuse the tested import building blocks (NOT full — never touch other rows).
    const sync = await syncEmployees(tx, [emp], actor.employeeId, { full: false });
    const provisioned = await provisionCredentials(tx, [emp], actor.employeeId);
    const linked = await linkAuthUsers(tx);
    await executors(tx).audit.insertAudit({
      entityType: 'employee',
      entityId: emp.employeeId,
      actorEmployeeId: actor.employeeId,
      action: 'create',
      beforeJson: null,
      afterJson: {
        nama: emp.nama, email: emp.email, divisi: emp.divisi,
        jabatan: emp.jabatan, status_aktif: emp.statusAktif,
      },
      createdBy: actor.employeeId,
    });
    return { source: 'manual', sync, provisioned, linked };
  });
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

/**
 * The layered roles this gate accepts.
 *
 * `lead` was added by migrasi `20260730154210_layered_lead_role`: `employee_claims`
 * already lets an enabled layered `lead` win over `role_mappings.level`, and
 * `layered_roles_riil.csv` ships three such rows. Until this set matched, the DB
 * honoured `lead` while the ONLY documented way to write it
 * (`rolemapseed` → `setLayeredRole`) rejected it with `MSG_BAD_ROLE` — so the
 * three live `lead` grants could not be reproduced from the seed at all.
 *
 * Exported so `apps/api/scripts/rolemapseed/csv.test.ts` can assert it equals
 * `VALID_LAYERED_ROLES` there. The CSV parser accepting a role this gate rejects
 * is silent until `--apply` runs against a real deployment, which is exactly how
 * the `lead` gap shipped.
 */
export const LAYERED_ROLES = new Set(['od', 'director', 'lead']);

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

// ---------------------------------------------------------------------------
// hari_libur — the national-holiday calendar behind every "hari kerja" count
// ---------------------------------------------------------------------------
//
// The Kelola Klien SLA is measured in working days, and the owner asked for
// national holidays to be excluded (2026-08-13). Working days are computed by the
// SQL helper `working_days_between`, which reads THIS table — so the calendar is
// operational data an operator maintains, not a list baked into a migration.
// Indonesian holiday dates are set by joint decree and move every year; a hard
// coded list would be a business fact invented by code and silently wrong the
// next January.
//
// The table starts EMPTY, which behaves exactly like weekends-only until someone
// fills it. That is a visible, honest default rather than a wrong one.

export const MSG_HARI_LIBUR_DENIED = '[hanya Director yang dapat mengelola hari libur]';
export const MSG_HARI_LIBUR_TANGGAL = '[tanggal libur tidak valid, gunakan format YYYY-MM-DD]';
export const MSG_HARI_LIBUR_KETERANGAN = '[keterangan hari libur wajib diisi]';
export const MSG_HARI_LIBUR_ADA = '[tanggal itu sudah terdaftar sebagai hari libur]';
export const MSG_HARI_LIBUR_NOT_FOUND = '[hari libur tidak ditemukan]';

export interface HariLibur {
  tanggal: string;
  keterangan: string;
  createdAt: string;
  createdBy: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function rowToHariLibur(r: Record<string, unknown>): HariLibur {
  const t = r.tanggal;
  return {
    // `date` comes back as a JS Date from the driver; the wire wants the civil
    // date, so it is formatted here rather than passed through an ISO instant
    // (which would shift the day for anyone east of UTC).
    tanggal: t instanceof Date ? t.toISOString().slice(0, 10) : String(t),
    keterangan: r.keterangan as string,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    createdBy: r.created_by as string,
  };
}

/** listHariLibur returns the calendar, newest date first. Director/OD read. */
export async function listHariLibur(sql: Queryable, actor: Actor): Promise<HariLibur[]> {
  if (!canReadAdmin(actor)) throw new ForbiddenError(MSG_ADMIN_READ_DENIED);
  const rows = await sql<Record<string, unknown>[]>`
    select tanggal, keterangan, created_at, created_by from hari_libur order by tanggal desc`;
  return rows.map(rowToHariLibur);
}

/**
 * addHariLibur registers one holiday. Director only — the calendar changes what
 * "late" means for every AM, so it sits behind the same gate as the role matrix.
 */
export async function addHariLibur(
  sql: Sql,
  actor: Actor,
  input: { tanggal: string; keterangan: string },
): Promise<HariLibur> {
  if (!canWriteAdmin(actor)) throw new ForbiddenError(MSG_HARI_LIBUR_DENIED);
  const tanggal = (input.tanggal ?? '').trim();
  const keterangan = (input.keterangan ?? '').trim();
  if (!ISO_DATE.test(tanggal) || Number.isNaN(Date.parse(tanggal))) {
    throw new ValidationError(MSG_HARI_LIBUR_TANGGAL);
  }
  if (keterangan === '') throw new ValidationError(MSG_HARI_LIBUR_KETERANGAN);

  return withTransaction(sql, async (tx) => {
    const inserted = await tx<Record<string, unknown>[]>`
      insert into hari_libur (tanggal, keterangan, created_by)
      values (${tanggal}, ${keterangan}, ${actor.employeeId})
      on conflict (tanggal) do nothing
      returning tanggal, keterangan, created_at, created_by`;
    if (inserted.length === 0) throw new ConflictError(MSG_HARI_LIBUR_ADA);
    await executors(tx).audit.insertAudit({
      entityType: 'hari_libur',
      entityId: tanggal,
      actorEmployeeId: actor.employeeId,
      action: 'create',
      beforeJson: null,
      afterJson: { tanggal, keterangan },
      createdBy: actor.employeeId,
    });
    return rowToHariLibur(inserted[0]);
  });
}

/**
 * removeHariLibur deletes one holiday. A DELETE is correct here — this is a
 * config calendar, not history; a mistyped date must be removable, and the audit
 * row records that it was.
 */
export async function removeHariLibur(sql: Sql, actor: Actor, tanggal: string): Promise<void> {
  if (!canWriteAdmin(actor)) throw new ForbiddenError(MSG_HARI_LIBUR_DENIED);
  const t = (tanggal ?? '').trim();
  if (!ISO_DATE.test(t)) throw new ValidationError(MSG_HARI_LIBUR_TANGGAL);

  await withTransaction(sql, async (tx) => {
    const gone = await tx<Record<string, unknown>[]>`
      delete from hari_libur where tanggal = ${t} returning tanggal, keterangan, created_at, created_by`;
    if (gone.length === 0) throw new NotFoundError(MSG_HARI_LIBUR_NOT_FOUND);
    await executors(tx).audit.insertAudit({
      entityType: 'hari_libur',
      entityId: t,
      actorEmployeeId: actor.employeeId,
      action: 'delete',
      beforeJson: { tanggal: t, keterangan: gone[0].keterangan },
      afterJson: null,
      createdBy: actor.employeeId,
    });
  });
}
