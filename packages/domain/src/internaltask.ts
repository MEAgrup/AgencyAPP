// Penugasan Internal (`TSK-`) — tugas yang atasan berikan ke anggota timnya.
//
// ---------------------------------------------------------------------------
// KENAPA MODUL SENDIRI, BUKAN M12
// ---------------------------------------------------------------------------
// PRD M12 §2 Rule 1 membekukan "Task" = Asset (M7) | Creator Booking (M9) |
// Brief-as-task (M8) — ketiganya WAJIB turunan rantai Klien → Service → Brief
// (M6 §5). Tidak ada jalan menugaskan pekerjaan yang bukan pekerjaan klien.
// Modul ini menambah entitas kedua yang berdiri sendiri; `task.ts` (M12) tidak
// disentuh sama sekali, jadi tidak ada dua definisi Speed Score / turnaround.
//
// ---------------------------------------------------------------------------
// SEMUA ANGKA KETERLAMBATAN DITURUNKAN, TIDAK ADA YANG DISIMPAN
// ---------------------------------------------------------------------------
// Tidak ada kolom `terlambat` / `pernah_terlambat` / `hari_telat` di tabel.
// Ketiganya diturunkan dari `due_date` + `selesai_pada` + `status` (house rule
// #4), dan ketiga jangkar itu dibekukan trigger DB. Itulah yang membuat pilihan
// pemilik "flag permanen, tetap bisa diselesaikan" benar-benar permanen: yang
// dibandingkan dua tanggal beku, bukan sebuah flag yang bisa ditulis ulang.
//
// Semua tanggal dibandingkan dalam kalender WIB (`core/tz`), bukan UTC — tugas
// yang diselesaikan 06:00 WIB tanggal jatuh tempo adalah TEPAT WAKTU, padahal
// instant UTC-nya masih hari sebelumnya.

import { bi, ident, notification, permission, statemachine, tz } from '@cdps/core';
import { executors, withTransaction, type Queryable, type Sql } from '@cdps/db';

export type Actor = permission.Actor;

const TSK_PREFIX = 'TSK';

/** Machine `internal_task` (seeded in 20260814110000_penugasan_internal.sql). */
export const MACHINE = 'internal_task';
const ENTITY_TYPE = 'internal_task';
const TABLE = 'internal_tasks';

export const STATUS_DITUGASKAN = '[Ditugaskan]';
export const STATUS_DIKERJAKAN = '[Dikerjakan]';
export const STATUS_SELESAI = '[Selesai]';
export const STATUS_DIBATALKAN = '[Dibatalkan]';

/** Every status, in lifecycle order — the client-side filter reads this. */
export const STATUSES = [
  STATUS_DITUGASKAN,
  STATUS_DIKERJAKAN,
  STATUS_SELESAI,
  STATUS_DIBATALKAN,
] as const;

/** The two terminal states: a task in one of these is finished, never reopened. */
const TERMINAL = new Set<string>([STATUS_SELESAI, STATUS_DIBATALKAN]);

// Exact BI messages. INCOMPLETE_DATA / TRANSITION_* are the house defaults
// (CLAUDE.md #5); the three specific ones below name the field that is wrong,
// because "[data tidak lengkap]" on a five-field form tells the user nothing.
export const MSG_ASSIGNEE_INVALID =
  '[karyawan yang ditugaskan tidak valid — harus karyawan aktif di divisi anda]';
export const MSG_LINK_HASIL_WAJIB =
  '[link hasil kerja wajib diisi untuk menandai tugas selesai]';
export const MSG_BUKAN_PIC = '[hanya karyawan yang ditugaskan yang bisa mengerjakan tugas ini]';
export const MSG_ALASAN_WAJIB = '[alasan pembatalan wajib diisi]';

const RE_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * isRealDate: the shape is right AND the day actually exists in that month.
 *
 * The shape check alone is not enough, and `Date.parse` is worse than useless
 * here: it ACCEPTS "2026-02-31" by rolling over to 2026-03-03, and postgres.js
 * hands that rolled-over value to the `date` column rather than erroring (a
 * literal `'2026-02-31'::date` in psql is rejected, the parameterised path is
 * not). The result would be a due date nobody typed — silently deciding whether
 * someone is late. So the parsed components are compared back to the input.
 */
function isRealDate(s: string): boolean {
  if (!RE_DATE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

// --- Errors (mapped to HTTP status in apps/api/src/lib/http.ts) ---

export class ValidationError extends Error {
  constructor(message = bi.INCOMPLETE_DATA) {
    super(message);
    this.name = 'InternalTaskValidationError';
  }
}
export class ForbiddenError extends Error {
  constructor(message = bi.TRANSITION_ROLE_DENIED) {
    super(message);
    this.name = 'InternalTaskForbiddenError';
  }
}
export class NotFoundError extends Error {
  constructor(message = 'penugasan tidak ditemukan') {
    super(message);
    this.name = 'InternalTaskNotFoundError';
  }
}
export class ConflictError extends Error {
  constructor(message = bi.TRANSITION_NOT_ALLOWED) {
    super(message);
    this.name = 'InternalTaskConflictError';
  }
}

// ---------------------------------------------------------------------------
// Permission gates — Fase 0 §4 Role Matrix, mirrored 1:1 by internal_tasks_select.
// ---------------------------------------------------------------------------

/**
 * canAssign: who may hand out work at all.
 *
 * Director → anyone. Lead/SPV → their own division. Staff → nobody.
 *
 * **OD assigns nothing.** The Role Matrix is unambiguous that OD is read-only
 * everywhere (`permission.canWrite` refuses a pure-OD account), so an OD who is
 * ALSO a division lead assigns through that underlying division scope, never
 * "as OD". This is the one place the owner's answer ("Director/OD: ke siapa
 * saja") reads wider than the matrix — resolved toward the matrix and logged in
 * DECISIONS 2026-08-14, because widening write access for OD is a change to the
 * global permission model, not a detail of this module.
 */
export function canAssign(actor: Actor): boolean {
  if (actor.role.director) return true;
  return actor.role.level === permission.LevelLead && actor.role.division !== '';
}

/** canAssignToDivision: a lead hands out work inside their own division only. */
export function canAssignToDivision(actor: Actor, division: string): boolean {
  if (actor.role.director) return true;
  return canAssign(actor) && actor.role.division === division;
}

/**
 * canView: read scope for ONE task row. Mirrors `internal_tasks_select` exactly
 * — RLS is the enforcement, this is the early gate that produces the right BI
 * message instead of a confusing empty result.
 */
export function canView(actor: Actor, t: { assigneeId: string; assigneeDivision: string; createdBy: string }): boolean {
  if (actor.role.director || actor.role.od) return true;
  if (actor.role.level === permission.LevelLead && actor.role.division === t.assigneeDivision) return true;
  return actor.employeeId === t.assigneeId || actor.employeeId === t.createdBy;
}

/** canWork: only the assigned PIC starts/finishes their own task. */
export function canWork(actor: Actor, t: { assigneeId: string }): boolean {
  return actor.employeeId === t.assigneeId;
}

/**
 * canCancel: the assigner, or a lead of the assignee's division, or Director.
 * Deliberately NOT the PIC: a PIC who can cancel their own task can erase their
 * own lateness — the same failure mode M12 §5.3a locks `[Blocked]` against.
 */
export function canCancel(actor: Actor, t: { assigneeDivision: string; createdBy: string }): boolean {
  if (actor.role.director) return true;
  if (actor.role.od) return false;
  if (actor.employeeId === t.createdBy) return true;
  return actor.role.level === permission.LevelLead && actor.role.division === t.assigneeDivision;
}

// ---------------------------------------------------------------------------
// Read model
// ---------------------------------------------------------------------------

export interface InternalTask {
  id: string;
  judul: string;
  deskripsi: string;
  assigneeId: string;
  assigneeDivision: string;
  dueDate: string; // YYYY-MM-DD (WIB calendar date)
  lampiranLink: string;
  linkHasil: string;
  status: string;
  dimulaiPada: Date | null;
  selesaiPada: Date | null;
  dibatalkanPada: Date | null;
  alasanPembatalan: string;
  createdAt: Date;
  createdBy: string;

  // --- Derived, never stored (house rule #4) ---
  /** Not yet finished and past its due date, as of the read. */
  terlambatBerjalan: boolean;
  /** Finished, but after its due date. The permanent record of lateness. */
  selesaiTerlambat: boolean;
  /**
   * Whole WIB days late: `selesai_pada − due_date` once finished, `today −
   * due_date` while still running. 0 when on time or not yet due.
   */
  hariTerlambat: number;
}

interface Row {
  id: string;
  judul: string;
  deskripsi: string;
  assignee_id: string;
  assignee_division: string;
  due_date: string | Date;
  lampiran_link: string;
  link_hasil: string;
  status: string;
  dimulai_pada: Date | null;
  selesai_pada: Date | null;
  dibatalkan_pada: Date | null;
  alasan_pembatalan: string;
  created_at: Date;
  created_by: string;
}

/** `date` columns arrive as a string from postgres.js but as a Date under some drivers. */
function dateStr(v: string | Date): string {
  return typeof v === 'string' ? v.slice(0, 10) : tz.dateString(v);
}

/**
 * daysLate returns whole WIB calendar days past `dueDate` at instant `at`,
 * floored at 0. Both sides are reduced to WIB midnight, so a task due
 * 2026-08-20 finished at 23:59 WIB on 2026-08-20 is 0 days late, not 1.
 */
function daysLate(dueDate: string, at: Date): number {
  // `${dueDate}T00:00:00+07:00` is WIB midnight of the due date as an instant.
  const due = new Date(`${dueDate}T00:00:00+07:00`);
  if (Number.isNaN(due.getTime())) return 0;
  const d = tz.daysBetween(due, at);
  return d > 0 ? d : 0;
}

/**
 * toTask maps a row and computes the three lateness facts against `now`. `now`
 * is a parameter rather than `new Date()` so tests pin it and so every row in
 * one list is judged against the SAME instant (a list computed across a
 * midnight boundary would otherwise disagree with itself).
 */
function toTask(r: Row, now: Date): InternalTask {
  const dueDate = dateStr(r.due_date);
  const finished = TERMINAL.has(r.status);
  const selesai = r.status === STATUS_SELESAI && r.selesai_pada !== null;

  const selesaiTerlambat = selesai && daysLate(dueDate, r.selesai_pada as Date) > 0;
  // [Dibatalkan] is never "late": the work was withdrawn, not missed. Counting it
  // would let a cancelled task damage a PIC who was told to stop.
  const terlambatBerjalan = !finished && daysLate(dueDate, now) > 0;

  let hariTerlambat = 0;
  if (selesaiTerlambat) hariTerlambat = daysLate(dueDate, r.selesai_pada as Date);
  else if (terlambatBerjalan) hariTerlambat = daysLate(dueDate, now);

  return {
    id: r.id,
    judul: r.judul,
    deskripsi: r.deskripsi,
    assigneeId: r.assignee_id,
    assigneeDivision: r.assignee_division,
    dueDate,
    lampiranLink: r.lampiran_link,
    linkHasil: r.link_hasil,
    status: r.status,
    dimulaiPada: r.dimulai_pada,
    selesaiPada: r.selesai_pada,
    dibatalkanPada: r.dibatalkan_pada,
    alasanPembatalan: r.alasan_pembatalan,
    createdAt: r.created_at,
    createdBy: r.created_by,
    terlambatBerjalan,
    selesaiTerlambat,
    hariTerlambat,
  };
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export interface CreateInput {
  judul: string;
  deskripsi?: string;
  assigneeId: string;
  dueDate: string; // YYYY-MM-DD
  lampiranLink?: string;
}

/**
 * assigneeDivision validates the target is an ACTIVE employee with a resolved
 * role mapping, and returns the division to freeze onto the row.
 *
 * The predicate is deliberately the same shape as `task.validatePicForDivision`
 * and `directory.listAssignableEmployees`: what the employee picker OFFERS must
 * be exactly what this ACCEPTS. A picker wider than its validator resurrects the
 * "can't find them, skip the field" bug (DECISIONS 2026-08-04).
 *
 * One deliberate difference: a Director may assign to a lead as well as to
 * staff (a Director tasking a Head is the ordinary case), while a division lead
 * may only assign to `staff` of their own division — a peer lead is not theirs
 * to task.
 */
async function resolveAssignee(tx: Queryable, actor: Actor, assigneeId: string): Promise<string> {
  const rows = await tx<{ status_aktif: number | boolean; division: string | null; level: string | null }[]>`
    select e.status_aktif, rm.division, rm.level
      from employees e
      left join role_mappings rm on rm.divisi = e.divisi and rm.jabatan = e.jabatan
     where e.employee_id = ${assigneeId}`;
  if (rows.length === 0) throw new ValidationError(MSG_ASSIGNEE_INVALID);

  const r = rows[0];
  const active = r.status_aktif === true || r.status_aktif === 1;
  const division = r.division ?? '';
  const level = r.level ?? '';
  if (!active || division === '' || level === '') throw new ValidationError(MSG_ASSIGNEE_INVALID);

  if (actor.role.director) return division;
  // A lead: own division, staff level only.
  if (division !== actor.role.division || level !== permission.LevelStaff) {
    throw new ValidationError(MSG_ASSIGNEE_INVALID);
  }
  return division;
}

/**
 * createTask hands one task to one employee. Director, or a division Lead/SPV
 * for their own staff. `judul`, `assigneeId` and a valid `dueDate` are
 * mandatory — the ID is minted only after that gate passes (house rule #1).
 * Audited, and the assignee is notified (they otherwise never learn of it).
 */
export async function createTask(sql: Sql, actor: Actor, input: CreateInput, now = new Date()): Promise<InternalTask> {
  if (!canAssign(actor)) throw new ForbiddenError();

  const judul = (input.judul ?? '').trim();
  const assigneeId = (input.assigneeId ?? '').trim();
  const dueDate = (input.dueDate ?? '').trim();
  if (judul === '' || assigneeId === '' || !isRealDate(dueDate)) {
    throw new ValidationError();
  }
  const deskripsi = (input.deskripsi ?? '').trim();
  const lampiranLink = (input.lampiranLink ?? '').trim();

  return withTransaction(sql, async (tx) => {
    const division = await resolveAssignee(tx, actor, assigneeId);
    if (!canAssignToDivision(actor, division)) throw new ForbiddenError();

    const ex = executors(tx);
    const id = await ex.ident.identNext(TSK_PREFIX, now);
    await tx`
      insert into internal_tasks
        (id, judul, deskripsi, assignee_id, assignee_division, due_date, lampiran_link, status, created_by)
      values
        (${id}, ${judul}, ${deskripsi}, ${assigneeId}, ${division}, ${dueDate}, ${lampiranLink},
         ${STATUS_DITUGASKAN}, ${actor.employeeId})`;

    await ex.audit.insertAudit({
      entityType: ENTITY_TYPE, entityId: id, actorEmployeeId: actor.employeeId, action: 'penugasan_dibuat',
      beforeJson: null,
      afterJson: {
        judul, assignee_id: assigneeId, assignee_division: division,
        due_date: dueDate, status: STATUS_DITUGASKAN,
      },
      createdBy: actor.employeeId,
    });

    await notification.emit(ex.notify, {
      event: notification.EVENTS.PenugasanDitugaskan,
      entityType: ENTITY_TYPE, entityId: id, actor: actor.employeeId,
      division, explicitRecipients: [assigneeId],
    });

    const rows = await tx<Row[]>`select id, judul, deskripsi, assignee_id, assignee_division, due_date,
           lampiran_link, link_hasil, status, dimulai_pada, selesai_pada,
           dibatalkan_pada, alasan_pembatalan, created_at, created_by
      from internal_tasks where id = ${id}`;
    return toTask(rows[0], now);
  });
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export interface ListFilter {
  /** Restrict to one PIC. A staff actor is pinned to themselves regardless. */
  assignee?: string;
  /** Restrict to one division (leads are pinned to their own regardless). */
  division?: string;
  status?: string;
  /** Only rows that are late — running-late or finished-late. */
  hanyaTerlambat?: boolean;
}

/**
 * listTasks returns the tasks the actor may see, newest due date first.
 *
 * Row scope is applied in SQL (not after the fetch) so a staff member never
 * pages through their whole division to find three rows. It mirrors
 * `internal_tasks_select`; RLS remains the real lock underneath.
 */
export async function listTasks(
  sql: Queryable,
  actor: Actor,
  filter: ListFilter = {},
  now = new Date(),
): Promise<InternalTask[]> {
  const readAll = actor.role.director || actor.role.od;
  const isLead = actor.role.level === permission.LevelLead && actor.role.division !== '';

  // Scope predicate, then the optional filters. `${sql}` fragments compose.
  const scope = readAll
    ? sql`true`
    : isLead
      ? sql`(assignee_division = ${actor.role.division}
             or assignee_id = ${actor.employeeId} or created_by = ${actor.employeeId})`
      : sql`(assignee_id = ${actor.employeeId} or created_by = ${actor.employeeId})`;

  const assignee = (filter.assignee ?? '').trim();
  const division = (filter.division ?? '').trim();
  const status = (filter.status ?? '').trim();

  const rows = await sql<Row[]>`
    select id, judul, deskripsi, assignee_id, assignee_division, due_date,
           lampiran_link, link_hasil, status, dimulai_pada, selesai_pada,
           dibatalkan_pada, alasan_pembatalan, created_at, created_by
      from internal_tasks
     where ${scope}
       and ${assignee === '' ? sql`true` : sql`assignee_id = ${assignee}`}
       and ${division === '' ? sql`true` : sql`assignee_division = ${division}`}
       and ${status === '' ? sql`true` : sql`status = ${status}`}
     order by due_date desc, id desc`;

  const tasks = rows.map((r) => toTask(r, now));
  return filter.hanyaTerlambat ? tasks.filter((t) => t.terlambatBerjalan || t.selesaiTerlambat) : tasks;
}

/** getTask reads one task, gated by canView (404 vs 403 kept distinct). */
export async function getTask(sql: Queryable, actor: Actor, id: string, now = new Date()): Promise<InternalTask> {
  const rows = await sql<Row[]>`select id, judul, deskripsi, assignee_id, assignee_division, due_date,
           lampiran_link, link_hasil, status, dimulai_pada, selesai_pada,
           dibatalkan_pada, alasan_pembatalan, created_at, created_by
      from internal_tasks where id = ${id}`;
  if (rows.length === 0) throw new NotFoundError();
  const t = toTask(rows[0], now);
  if (!canView(actor, t)) throw new ForbiddenError();
  return t;
}

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

/** Locks the row and returns it mapped, or throws NotFound. */
async function lockTask(tx: Queryable, id: string, now: Date): Promise<InternalTask> {
  const rows = await tx<Row[]>`select id, judul, deskripsi, assignee_id, assignee_division, due_date,
           lampiran_link, link_hasil, status, dimulai_pada, selesai_pada,
           dibatalkan_pada, alasan_pembatalan, created_at, created_by
      from internal_tasks where id = ${id} for update`;
  if (rows.length === 0) throw new NotFoundError();
  return toTask(rows[0], now);
}

/** Maps an engine rejection onto the right error class (403 vs 409). */
function fromEngine(res: statemachine.TransitionResult): never {
  if (res.ok) throw new ConflictError();
  throw res.code === 'role_denied' ? new ForbiddenError(res.message) : new ConflictError(res.message);
}

/**
 * startTask moves [Ditugaskan] → [Dikerjakan] and freezes `dimulai_pada`. Only
 * the assigned PIC — a lead marking someone else's task "started" would forge
 * the anchor the duration is measured from.
 */
export async function startTask(sql: Sql, actor: Actor, id: string, now = new Date()): Promise<InternalTask> {
  return withTransaction(sql, async (tx) => {
    const t = await lockTask(tx, id, now);
    if (!canView(actor, t)) throw new ForbiddenError();
    if (!canWork(actor, t)) throw new ForbiddenError(MSG_BUKAN_PIC);

    // Anchor first, then transition — same transaction, so the CHECK sees both
    // (the `alasan_pembatalan` / `disubmit_pada` ordering used by interview).
    await tx`update internal_tasks set dimulai_pada = ${now} where id = ${id} and dimulai_pada is null`;
    const ex = executors(tx);
    const res = await statemachine.transition(ex.sm, {
      machine: MACHINE, entityType: ENTITY_TYPE, table: TABLE, entityId: id, to: STATUS_DIKERJAKAN, actor,
    });
    if (!res.ok) fromEngine(res);
    return { ...t, status: STATUS_DIKERJAKAN, dimulaiPada: t.dimulaiPada ?? now };
  });
}

/**
 * completeTask moves [Dikerjakan] → [Selesai]. The PIC must supply the
 * deliverable link — this is the "kolom yang diisi (bisa berupa link drive)"
 * the owner asked for, and it is mandatory for the same reason M7 makes
 * `output_link` mandatory on Asset submit: "done" with nothing attached is a
 * claim, not a deliverable.
 *
 * Lateness is NOT written here. `selesai_pada` is frozen and the comparison
 * against `due_date` happens at read time, so the record cannot be edited later.
 */
export async function completeTask(
  sql: Sql, actor: Actor, id: string, linkHasil: string, now = new Date(),
): Promise<InternalTask> {
  const link = (linkHasil ?? '').trim();
  if (link === '') throw new ValidationError(MSG_LINK_HASIL_WAJIB);

  return withTransaction(sql, async (tx) => {
    const t = await lockTask(tx, id, now);
    if (!canView(actor, t)) throw new ForbiddenError();
    if (!canWork(actor, t)) throw new ForbiddenError(MSG_BUKAN_PIC);

    await tx`
      update internal_tasks
         set link_hasil = ${link},
             selesai_pada = coalesce(selesai_pada, ${now})
       where id = ${id}`;
    const ex = executors(tx);
    const res = await statemachine.transition(ex.sm, {
      machine: MACHINE, entityType: ENTITY_TYPE, table: TABLE, entityId: id, to: STATUS_SELESAI, actor,
    });
    if (!res.ok) fromEngine(res);

    // The assigner asked for this work; they are the one who needs to know it
    // landed (and to open the link).
    await notification.emit(ex.notify, {
      event: notification.EVENTS.PenugasanSelesai,
      entityType: ENTITY_TYPE, entityId: id, actor: actor.employeeId,
      division: t.assigneeDivision, explicitRecipients: [t.createdBy],
    });

    // Re-read: the derived lateness must be computed from the anchor the DB
    // actually holds, not from the value we hoped we wrote.
    const rows = await tx<Row[]>`select id, judul, deskripsi, assignee_id, assignee_division, due_date,
           lampiran_link, link_hasil, status, dimulai_pada, selesai_pada,
           dibatalkan_pada, alasan_pembatalan, created_at, created_by
      from internal_tasks where id = ${id}`;
    return toTask(rows[0], now);
  });
}

/**
 * cancelTask withdraws a task ([Ditugaskan] | [Dikerjakan] → [Dibatalkan]) with
 * a mandatory reason. Assigner / division lead / Director — never the PIC.
 * A cancelled task counts as neither on-time nor late in the discipline rollup.
 */
export async function cancelTask(
  sql: Sql, actor: Actor, id: string, alasan: string, now = new Date(),
): Promise<InternalTask> {
  const why = (alasan ?? '').trim();
  if (why === '') throw new ValidationError(MSG_ALASAN_WAJIB);

  return withTransaction(sql, async (tx) => {
    const t = await lockTask(tx, id, now);
    if (!canView(actor, t)) throw new ForbiddenError();
    if (!canCancel(actor, t)) throw new ForbiddenError();

    await tx`
      update internal_tasks
         set alasan_pembatalan = ${why},
             dibatalkan_pada = coalesce(dibatalkan_pada, ${now})
       where id = ${id}`;
    const ex = executors(tx);
    const res = await statemachine.transition(ex.sm, {
      machine: MACHINE, entityType: ENTITY_TYPE, table: TABLE, entityId: id, to: STATUS_DIBATALKAN, actor,
    });
    if (!res.ok) fromEngine(res);

    await ex.audit.insertAudit({
      entityType: ENTITY_TYPE, entityId: id, actorEmployeeId: actor.employeeId, action: 'penugasan_dibatalkan',
      beforeJson: { status: t.status },
      afterJson: { status: STATUS_DIBATALKAN, alasan: why }, createdBy: actor.employeeId,
    });

    // The PIC has to be told, or they keep working on something that was
    // withdrawn. Emitted from the domain rather than the daily job because the
    // trigger here is an action, not the passing of time.
    await notification.emit(ex.notify, {
      event: notification.EVENTS.PenugasanDibatalkan,
      entityType: ENTITY_TYPE, entityId: id, actor: actor.employeeId,
      division: t.assigneeDivision, explicitRecipients: [t.assigneeId],
    });

    const rows = await tx<Row[]>`select id, judul, deskripsi, assignee_id, assignee_division, due_date,
           lampiran_link, link_hasil, status, dimulai_pada, selesai_pada,
           dibatalkan_pada, alasan_pembatalan, created_at, created_by
      from internal_tasks where id = ${id}`;
    return toTask(rows[0], now);
  });
}

// ---------------------------------------------------------------------------
// Daily reminder job
// ---------------------------------------------------------------------------

/** What one `penugasan_reminder_tick` pass emitted. */
export interface ReminderTickResult {
  /** H-1 reminders sent (due tomorrow, not finished). */
  h1: number;
  /** Past-due notices sent (due date passed, not finished). */
  jatuhTempo: number;
}

/**
 * runReminderTick drives the daily due-date sweep.
 *
 * The work itself lives in the SQL function `penugasan_reminder_tick` (migration
 * 20260814120000), NOT here — deliberately, and for the same reason the recap
 * job does: pg_cron calls the SQL directly on Supabase, so a second copy of the
 * selection rule in TypeScript would be a rule that can disagree with the one
 * that actually runs in production. This is the manual/external-cron entry
 * point over the identical function.
 *
 * Idempotent: each task is notified at most once per branch, guarded by the
 * `pengingat_h1_terkirim` / `jatuh_tempo_terkirim` marker columns, so calling it
 * twice in a day is a no-op the second time. `now` is a parameter so tests can
 * pin the WIB day without touching the wall clock.
 */
export async function runReminderTick(sql: Sql, now?: Date): Promise<ReminderTickResult> {
  const rows = now === undefined
    ? await sql<{ r: { h1: number; jatuh_tempo: number } }[]>`select penugasan_reminder_tick() as r`
    : await sql<{ r: { h1: number; jatuh_tempo: number } }[]>`select penugasan_reminder_tick(${now}) as r`;
  return { h1: rows[0].r.h1, jatuhTempo: rows[0].r.jatuh_tempo };
}

// ---------------------------------------------------------------------------
// Discipline rollup — the "menghitung performa team" the owner asked for.
//
// This is a REPORT, not an M14 score. The owner chose "catat + dashboard
// terpisah": M14's KPI weights were signed off 2026-08-13 (RM-9a) and each role
// profile sums to exactly 100, so folding a component in here would re-cut
// weights nobody has data to justify yet. `PERF-` is untouched.
// ---------------------------------------------------------------------------

export interface DisciplineRow {
  assigneeId: string;
  assigneeDivision: string;
  total: number;
  selesaiTepatWaktu: number;
  selesaiTerlambat: number;
  /** Not finished, past due. */
  terlambatBerjalan: number;
  /** Not finished, not yet past due. */
  berjalan: number;
  dibatalkan: number;
  /**
   * Selesai tepat waktu ÷ (tepat waktu + terlambat), 0–100. `null` when the
   * denominator is zero — nobody with no closed task has a 0% discipline rate.
   */
  ketepatanPct: number | null;
  /** Pre-formatted for display: "87.5%" or "—" (house rule #7). */
  ketepatanDisplay: string;
  /** Sum of days late across finished-late tasks — how late, not just how often. */
  totalHariTerlambat: number;
}

/**
 * disciplineSummary rolls the actor's visible tasks up per PIC.
 *
 * Derived entirely from `listTasks`, so the report can never disagree with the
 * list it summarises, and both are recomputable from the frozen anchors.
 * Cancelled tasks are excluded from the ketepatan denominator (the work was
 * withdrawn, not missed) but still reported, so a division cancelling everything
 * is visible rather than invisible.
 */
export async function disciplineSummary(
  sql: Queryable,
  actor: Actor,
  filter: ListFilter = {},
  now = new Date(),
): Promise<DisciplineRow[]> {
  const tasks = await listTasks(sql, actor, { ...filter, hanyaTerlambat: false }, now);

  const byPic = new Map<string, DisciplineRow>();
  for (const t of tasks) {
    let row = byPic.get(t.assigneeId);
    if (!row) {
      row = {
        assigneeId: t.assigneeId, assigneeDivision: t.assigneeDivision, total: 0,
        selesaiTepatWaktu: 0, selesaiTerlambat: 0, terlambatBerjalan: 0, berjalan: 0,
        dibatalkan: 0, ketepatanPct: null, ketepatanDisplay: '—', totalHariTerlambat: 0,
      };
      byPic.set(t.assigneeId, row);
    }
    row.total += 1;
    if (t.status === STATUS_SELESAI) {
      if (t.selesaiTerlambat) {
        row.selesaiTerlambat += 1;
        row.totalHariTerlambat += t.hariTerlambat;
      } else {
        row.selesaiTepatWaktu += 1;
      }
    } else if (t.status === STATUS_DIBATALKAN) {
      row.dibatalkan += 1;
    } else if (t.terlambatBerjalan) {
      row.terlambatBerjalan += 1;
    } else {
      row.berjalan += 1;
    }
  }

  for (const row of byPic.values()) {
    const closed = row.selesaiTepatWaktu + row.selesaiTerlambat;
    if (closed > 0) {
      row.ketepatanPct = (row.selesaiTepatWaktu / closed) * 100;
      row.ketepatanDisplay = `${row.ketepatanPct.toFixed(2)}%`;
    }
  }

  // Worst discipline first — the point of the report is the exceptions.
  return [...byPic.values()].sort((a, b) => {
    const ap = a.ketepatanPct ?? 101; // no closed task sorts last, not first
    const bp = b.ketepatanPct ?? 101;
    if (ap !== bp) return ap - bp;
    return a.assigneeId.localeCompare(b.assigneeId);
  });
}
