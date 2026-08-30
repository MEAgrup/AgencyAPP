/**
 * Permintaan (`REQ-`) — M16 §5.5 / STATE_MACHINES §19. Divisi request that is
 * TERKAIT KLIEN, deliberately separate from `internaltask.ts` (`TSK-`, Penugasan
 * Internal): `internal_tasks` sengaja tanpa `client_id`/`service_id` because
 * loosening it "akan membongkar gerbang pembayaran M4/M5" (§17 STATE_MACHINES).
 * A Top-up Saldo request is obviously client-linked (the client's ad balance),
 * so it cannot ride on that table. It is also NOT a Task M12 (= Asset | Creator
 * Booking | Brief-as-task) — it is not a deliverable an AM reviews.
 *
 * Machine `[Diajukan] -> [Diproses] -> [Selesai]` / `[Diajukan]|[Diproses] ->
 * [Ditolak]`, three `jenis`: `Top-up Saldo` (Ads -> Finance, LT-11), `Contract
 * Creator` (KOL -> AM), `Creator Payment Approval` (KOL -> Finance, connects
 * to the EXISTING `CPR-` M9 machine via `cprId` — this module never replaces
 * it).
 *
 * House rules honored: REQ id minted only after validation passes; due_date
 * frozen by a DB trigger; lateness is derived AT READ TIME from
 * `due_date`+`selesai_pada`+`status` (WIB) — zero stored duration columns,
 * mirroring `internaltask.ts`'s `daysLate`/`toTask` pattern exactly.
 */

import { bi, notification, permission, statemachine, tz } from '@cdps/core';
import { executors, withTransaction, type Queryable, type Sql } from '@cdps/db';

/** Authenticated employee + resolved role. */
export type Actor = permission.Actor;

const MACHINE = 'permintaan';
const TABLE = 'permintaan';
const ENTITY_TYPE = 'permintaan';

// Statuses — mesin `permintaan` (STATE_MACHINES §19).
export const STATUS_DIAJUKAN = '[Diajukan]';
export const STATUS_DIPROSES = '[Diproses]';
export const STATUS_SELESAI = '[Selesai]';
export const STATUS_DITOLAK = '[Ditolak]';

// Jenis (M16 §5.5).
export const JENIS_TOPUP_SALDO = 'Top-up Saldo';
export const JENIS_CONTRACT_CREATOR = 'Contract Creator';
export const JENIS_CREATOR_PAYMENT_APPROVAL = 'Creator Payment Approval';
export const VALID_JENIS = new Set([JENIS_TOPUP_SALDO, JENIS_CONTRACT_CREATOR, JENIS_CREATOR_PAYMENT_APPROVAL]);

// Divisions this module names directly (local literals, mirrors ads.ts's own
// ADS_DIVISION/ACCOUNT_DIVISION — this module deliberately does not import
// ads.ts/kol.ts to avoid a cross-domain cycle).
const DIVISION_ADS = 'Ads';
const DIVISION_KOL = 'KOL';
const DIVISION_ACCOUNT = 'Account';
const DIVISION_FINANCE = 'Finance';

// --- Verbatim BI messages ---

export const MSG_NOT_FOUND = '[permintaan tidak ditemukan]';
export const MSG_VIEW_FORBIDDEN = '[anda tidak memiliki akses ke permintaan ini]';
export const MSG_CREATE_FORBIDDEN = '[anda tidak memiliki akses untuk mengajukan permintaan ini]';
export const MSG_PROCESS_FORBIDDEN = '[anda tidak memiliki akses untuk memproses permintaan ini]';
export const MSG_INVALID_JENIS = '[jenis permintaan tidak valid]';
export const MSG_PARENT_REQUIRED = '[permintaan wajib terkait Brief atau Service]';
export const MSG_BRIEF_NOT_FOUND = '[brief tidak ditemukan]';
export const MSG_SERVICE_NOT_FOUND = '[layanan tidak ditemukan]';
export const MSG_CPA_REQUIRES_CPR = '[Creator Payment Approval wajib menyambung Creator Payment Request yang sudah ada]';
export const MSG_CPR_NOT_FOUND = '[creator payment request tidak ditemukan]';
export const MSG_REJECT_REASON_REQUIRED = '[alasan penolakan wajib diisi]';

// --- Errors (req-scoped; mapped in apps/api http.ts) ---

/** Bad/missing input. */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReqValidationError';
  }
}
/** The actor's role may not perform the requested read/action. */
export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReqForbiddenError';
  }
}
/** The referenced permintaan/brief/service/CPR does not exist. */
export class NotFoundError extends Error {
  constructor(message = MSG_NOT_FOUND) {
    super(message);
    this.name = 'ReqNotFoundError';
  }
}
/** A lifecycle conflict (illegal transition, wrong jenis pairing, etc). */
export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReqConflictError';
  }
}

/** transitionError maps a rejected engine transition (403 role / 409 else). */
function transitionError(res: statemachine.TransitionResult & { ok: false }): Error {
  return res.code === 'role_denied' ? new ForbiddenError(res.message) : new ConflictError(res.message);
}

// --- Authorization ---

function creatingDivisionFor(jenis: string): string {
  return jenis === JENIS_TOPUP_SALDO ? DIVISION_ADS : DIVISION_KOL;
}

/** canCreate — the jenis's owning division (Ads for Top-up Saldo, KOL for the other two) or Director. */
export function canCreate(actor: Actor, jenis: string): boolean {
  if (actor.role.director) {
    return true;
  }
  return actor.role.division === creatingDivisionFor(jenis);
}

/**
 * canView mirrors the RLS policy `permintaan_select`: read-all (OD/Director),
 * a lead of either the submitting or the destination division, or one of the
 * two named parties.
 */
export function canView(
  actor: Actor,
  diajukanDivisi: string,
  tujuanDivisi: string,
  diajukanOleh: string,
  tujuanEmployeeId: string | null,
): boolean {
  if (actor.role.director || actor.role.od) {
    return true;
  }
  if (permission.isLead(actor, diajukanDivisi) || permission.isLead(actor, tujuanDivisi)) {
    return true;
  }
  return actor.employeeId === diajukanOleh || (tujuanEmployeeId !== null && actor.employeeId === tujuanEmployeeId);
}

/**
 * canProcess — who may drive `[Diajukan]->[Diproses]->[Selesai]` or reject.
 * The explicitly-named tujuan employee (e.g. the client's own AM) always may,
 * even at staff level; otherwise anyone in the destination division (Ads staff
 * submits to a specific AM, but Creator Payment Approval's destination is
 * Finance as a WHOLE division with no single named employee — restricting
 * that to "lead only" would leave ordinary Finance staff unable to act on
 * their own team's queue); Director always may.
 */
export function canProcess(actor: Actor, tujuanDivisi: string, tujuanEmployeeId: string | null): boolean {
  if (actor.role.director) {
    return true;
  }
  if (tujuanEmployeeId !== null && actor.employeeId === tujuanEmployeeId) {
    return true;
  }
  return actor.role.division === tujuanDivisi;
}

// --- Types ---

/** Create fields for a new Permintaan. Parent is Brief XOR Service — at least one required. */
export interface PermintaanInput {
  jenis: string;
  judul: string;
  deskripsi?: string;
  briefId?: string;
  serviceId?: string;
  /** Required (and ONLY valid) when jenis === 'Creator Payment Approval'. */
  cprId?: string;
  /** Override the resolved AM target (Contract Creator only — the sole jenis that routes to a named AM). */
  tujuanEmployeeId?: string;
}

/** One Permintaan (REQ-), with keterlambatan DERIVED at read time (never stored). */
export interface Permintaan {
  id: string;
  jenis: string;
  judul: string;
  deskripsi: string;
  briefId: string | null;
  serviceId: string | null;
  clientId: string;
  cprId: string | null;
  diajukanOleh: string;
  diajukanDivisi: string;
  tujuanDivisi: string;
  tujuanEmployeeId: string | null;
  dueDate: string;
  status: string;
  diprosesPada: Date | null;
  selesaiPada: Date | null;
  ditolakPada: Date | null;
  alasanDitolak: string;
  catatanProses: string;
  /** Still open ([Diajukan]/[Diproses]) and past due_date, as of read time. */
  terlambatBerjalan: boolean;
  /** Reached [Selesai] after due_date. */
  selesaiTerlambat: boolean;
  /** Calendar days past due_date — 0 unless one of the two flags above is true. */
  hariTerlambat: number;
  createdBy: string;
  createdAt: Date;
}

interface PermintaanRow {
  id: string;
  jenis: string;
  judul: string;
  deskripsi: string;
  brief_id: string | null;
  service_id: string | null;
  client_id: string;
  cpr_id: string | null;
  diajukan_oleh: string;
  diajukan_divisi: string;
  tujuan_divisi: string;
  tujuan_employee_id: string | null;
  due_date: string | Date;
  status: string;
  diproses_pada: Date | null;
  selesai_pada: Date | null;
  ditolak_pada: Date | null;
  alasan_ditolak: string;
  catatan_proses: string;
  created_by: string;
  created_at: Date;
}


function dateStr(d: string | Date): string {
  return d instanceof Date ? d.toISOString().slice(0, 10) : String(d);
}

/**
 * daysLate — plain calendar days between two YYYY-MM-DD strings (a < b
 * assumed; 0 otherwise). Mirrors `internaltask.ts`'s lateness math: the
 * DEADLINE itself is computed in hari kerja (`add_working_days`), but "how
 * many days has this been sitting late" is a plain calendar count, same as
 * Penugasan Internal.
 */
function daysBetween(a: string, b: string): number {
  const da = new Date(`${a}T00:00:00Z`).getTime();
  const db = new Date(`${b}T00:00:00Z`).getTime();
  return Math.max(0, Math.round((db - da) / 86400000));
}

/**
 * toPermintaan derives keterlambatan from due_date + selesai_pada + status at
 * READ time (house rule #3/#4) — zero stored duration/lateness columns.
 * `[Ditolak]` is NEVER counted late: the work was withdrawn, not missed —
 * exact precedent as TSK- §17 ("Dibatalkan tidak pernah dihitung terlambat").
 */
function toPermintaan(r: PermintaanRow, now: Date): Permintaan {
  const dueDate = dateStr(r.due_date);
  const today = tz.dateString(now);
  let terlambatBerjalan = false;
  let selesaiTerlambat = false;
  let hariTerlambat = 0;
  if (r.status === STATUS_SELESAI && r.selesai_pada !== null) {
    const selesaiDate = tz.dateString(r.selesai_pada);
    if (selesaiDate > dueDate) {
      selesaiTerlambat = true;
      hariTerlambat = daysBetween(dueDate, selesaiDate);
    }
  } else if (r.status === STATUS_DIAJUKAN || r.status === STATUS_DIPROSES) {
    if (today > dueDate) {
      terlambatBerjalan = true;
      hariTerlambat = daysBetween(dueDate, today);
    }
  }
  return {
    id: r.id, jenis: r.jenis, judul: r.judul, deskripsi: r.deskripsi,
    briefId: r.brief_id, serviceId: r.service_id, clientId: r.client_id, cprId: r.cpr_id,
    diajukanOleh: r.diajukan_oleh, diajukanDivisi: r.diajukan_divisi,
    tujuanDivisi: r.tujuan_divisi, tujuanEmployeeId: r.tujuan_employee_id,
    dueDate, status: r.status,
    diprosesPada: r.diproses_pada, selesaiPada: r.selesai_pada, ditolakPada: r.ditolak_pada,
    alasanDitolak: r.alasan_ditolak, catatanProses: r.catatan_proses,
    terlambatBerjalan, selesaiTerlambat, hariTerlambat,
    createdBy: r.created_by, createdAt: r.created_at,
  };
}

// --- Parent resolution ---

interface ParentInfo {
  clientId: string;
  assignedAmId: string | null;
  resolvedBriefId: string | null;
  resolvedServiceId: string | null;
}

async function resolveParent(tx: Queryable, briefId: string | undefined, serviceId: string | undefined): Promise<ParentInfo> {
  const brief = (briefId ?? '').trim();
  const service = (serviceId ?? '').trim();
  if (brief !== '') {
    const rows = await tx<{ client_id: string; assigned_am_id: string | null; service_id: string }[]>`
      select sv.client_id, cl.assigned_am_id, b.service_id
        from briefs b
        join services sv on sv.id = b.service_id
        join clients cl on cl.id = sv.client_id
       where b.id = ${brief}`;
    if (rows.length === 0) {
      throw new NotFoundError(MSG_BRIEF_NOT_FOUND);
    }
    return {
      clientId: rows[0].client_id, assignedAmId: rows[0].assigned_am_id,
      resolvedBriefId: brief, resolvedServiceId: rows[0].service_id,
    };
  }
  if (service !== '') {
    const rows = await tx<{ client_id: string; assigned_am_id: string | null }[]>`
      select sv.client_id, cl.assigned_am_id
        from services sv join clients cl on cl.id = sv.client_id
       where sv.id = ${service}`;
    if (rows.length === 0) {
      throw new NotFoundError(MSG_SERVICE_NOT_FOUND);
    }
    return {
      clientId: rows[0].client_id, assignedAmId: rows[0].assigned_am_id,
      resolvedBriefId: null, resolvedServiceId: service,
    };
  }
  throw new ValidationError(MSG_PARENT_REQUIRED);
}

/**
 * resolveTujuan (LT-11, pemilik 2026-08-29): Top-up Saldo dan Creator Payment
 * Approval keduanya rute ke Finance (division, no named employee — sama
 * seperti CPA sudah lakukan). Contract Creator SATU-SATUNYA jenis yang
 * dirute ke AM pemilik klien (override manual tetap hanya berlaku untuknya).
 */
function resolveTujuan(
  jenis: string,
  assignedAmId: string | null,
  overrideEmployeeId: string | undefined,
): { tujuanDivisi: string; tujuanEmployeeId: string | null } {
  if (jenis === JENIS_CREATOR_PAYMENT_APPROVAL || jenis === JENIS_TOPUP_SALDO) {
    return { tujuanDivisi: DIVISION_FINANCE, tujuanEmployeeId: null };
  }
  const override = (overrideEmployeeId ?? '').trim();
  return { tujuanDivisi: DIVISION_ACCOUNT, tujuanEmployeeId: override !== '' ? override : (assignedAmId ?? null) };
}

// --- Create ---

/**
 * createPermintaan mints a REQ- id ONLY after every mandatory field passes
 * (house rule #1), resolves client_id from the Brief/Service parent, resolves
 * the tujuan (AM for Contract Creator, Finance division for Top-up Saldo and
 * Creator Payment Approval — LT-11), computes `due_date` = created_at + 1 HARI KERJA
 * via the DB helper `add_working_days` (never reimplemented in TS — mirrors
 * `working_days_between`'s own house-rule precedent), and emits
 * `m16.permintaan.diajukan`.
 */
export async function createPermintaan(sql: Sql, actor: Actor, input: PermintaanInput, now: Date = new Date()): Promise<Permintaan> {
  const jenis = (input.jenis ?? '').trim();
  const judul = (input.judul ?? '').trim();
  const deskripsi = (input.deskripsi ?? '').trim();
  if (jenis === '' || judul === '') {
    throw new ValidationError(bi.INCOMPLETE_DATA);
  }
  if (!VALID_JENIS.has(jenis)) {
    throw new ValidationError(MSG_INVALID_JENIS);
  }
  if (!canCreate(actor, jenis)) {
    throw new ForbiddenError(MSG_CREATE_FORBIDDEN);
  }
  const cprId = (input.cprId ?? '').trim();
  const isCpa = jenis === JENIS_CREATOR_PAYMENT_APPROVAL;
  if (isCpa !== (cprId !== '')) {
    throw new ValidationError(MSG_CPA_REQUIRES_CPR);
  }

  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const parent = await resolveParent(tx, input.briefId, input.serviceId);

    if (cprId !== '') {
      const cprRows = await tx<{ n: string }[]>`select count(*) as n from creator_payment_requests where id = ${cprId}`;
      if (Number(cprRows[0].n) === 0) {
        throw new NotFoundError(MSG_CPR_NOT_FOUND);
      }
    }

    const { tujuanDivisi, tujuanEmployeeId } = resolveTujuan(jenis, parent.assignedAmId, input.tujuanEmployeeId);

    const dueRows = await tx<{ due: string }[]>`select add_working_days(wib_date(${now}::timestamptz), 1) as due`;
    const dueDate = dueRows[0].due;

    const id = await ex.ident.identNext('REQ', now);
    await tx`
      insert into permintaan
        (id, jenis, judul, deskripsi, brief_id, service_id, client_id, cpr_id,
         diajukan_oleh, diajukan_divisi, tujuan_divisi, tujuan_employee_id, due_date, created_by)
      values
        (${id}, ${jenis}, ${judul}, ${deskripsi}, ${parent.resolvedBriefId}, ${parent.resolvedServiceId},
         ${parent.clientId}, ${cprId === '' ? null : cprId},
         ${actor.employeeId}, ${actor.role.division}, ${tujuanDivisi}, ${tujuanEmployeeId}, ${dueDate}, ${actor.employeeId})`;

    await ex.audit.insertAudit({
      entityType: ENTITY_TYPE, entityId: id, actorEmployeeId: actor.employeeId, action: 'create',
      beforeJson: null,
      afterJson: { status: STATUS_DIAJUKAN, jenis, client_id: parent.clientId, due_date: dueDate, tujuan_divisi: tujuanDivisi },
      createdBy: actor.employeeId,
    });

    await notification.emit(ex.notify, {
      event: notification.EVENTS.PermintaanDiajukan,
      entityType: ENTITY_TYPE, entityId: id, actor: actor.employeeId,
      division: tujuanDivisi,
      explicitRecipients: tujuanEmployeeId !== null ? [tujuanEmployeeId] : [],
    });

    return toPermintaan({
      id, jenis, judul, deskripsi, brief_id: parent.resolvedBriefId, service_id: parent.resolvedServiceId,
      client_id: parent.clientId, cpr_id: cprId === '' ? null : cprId,
      diajukan_oleh: actor.employeeId, diajukan_divisi: actor.role.division,
      tujuan_divisi: tujuanDivisi, tujuan_employee_id: tujuanEmployeeId,
      due_date: dueDate, status: STATUS_DIAJUKAN,
      diproses_pada: null, selesai_pada: null, ditolak_pada: null, alasan_ditolak: '', catatan_proses: '',
      created_by: actor.employeeId, created_at: now,
    }, now);
  });
}

// --- Lifecycle ---

async function lockPermintaan(tx: Queryable, id: string): Promise<PermintaanRow> {
  const rows = await tx<PermintaanRow[]>`select id, jenis, judul, deskripsi, brief_id, service_id, client_id, cpr_id,
           diajukan_oleh, diajukan_divisi, tujuan_divisi, tujuan_employee_id, due_date, status,
           diproses_pada, selesai_pada, ditolak_pada, alasan_ditolak, catatan_proses, created_by, created_at
    from permintaan where id = ${id} for update`;
  if (rows.length === 0) {
    throw new NotFoundError(MSG_NOT_FOUND);
  }
  return rows[0];
}

/** processPermintaan drives `[Diajukan]` → `[Diproses]`. Returns the updated row. */
export function processPermintaan(sql: Sql, actor: Actor, id: string, now: Date = new Date()): Promise<Permintaan> {
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const row = await lockPermintaan(tx, id);
    if (!canProcess(actor, row.tujuan_divisi, row.tujuan_employee_id)) {
      throw new ForbiddenError(MSG_PROCESS_FORBIDDEN);
    }
    // Guarded by `is null`: re-attempting an already-[Diproses] row must fail
    // as a clean ConflictError from the illegal edge below, not a raw freeze-
    // trigger exception from re-stamping an anchor that is already set.
    await tx`update permintaan set diproses_pada = now() where id = ${id} and diproses_pada is null`;
    const res = await statemachine.transition(ex.sm, {
      machine: MACHINE, entityType: ENTITY_TYPE, table: TABLE, entityId: id, to: STATUS_DIPROSES, actor,
    });
    if (!res.ok) throw transitionError(res);
    return toPermintaan(await lockPermintaan(tx, id), now);
  });
}

/**
 * completePermintaan drives `[Diproses]` → `[Selesai]`. `catatan` is optional
 * context, not a gate. Returns the updated row.
 */
export function completePermintaan(sql: Sql, actor: Actor, id: string, catatan?: string, now: Date = new Date()): Promise<Permintaan> {
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const row = await lockPermintaan(tx, id);
    if (!canProcess(actor, row.tujuan_divisi, row.tujuan_employee_id)) {
      throw new ForbiddenError(MSG_PROCESS_FORBIDDEN);
    }
    const note = (catatan ?? '').trim();
    await tx`update permintaan set selesai_pada = now(), catatan_proses = ${note} where id = ${id} and selesai_pada is null`;
    const res = await statemachine.transition(ex.sm, {
      machine: MACHINE, entityType: ENTITY_TYPE, table: TABLE, entityId: id, to: STATUS_SELESAI, actor,
    });
    if (!res.ok) throw transitionError(res);
    return toPermintaan(await lockPermintaan(tx, id), now);
  });
}

/** rejectPermintaan drives `[Diajukan]`|`[Diproses]` → `[Ditolak]`. Reason mandatory. Returns the updated row. */
export function rejectPermintaan(sql: Sql, actor: Actor, id: string, alasan: string, now: Date = new Date()): Promise<Permintaan> {
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const row = await lockPermintaan(tx, id);
    const reason = (alasan ?? '').trim();
    if (reason === '') {
      throw new ValidationError(MSG_REJECT_REASON_REQUIRED);
    }
    if (!canProcess(actor, row.tujuan_divisi, row.tujuan_employee_id)) {
      throw new ForbiddenError(MSG_PROCESS_FORBIDDEN);
    }
    await tx`update permintaan set ditolak_pada = now(), alasan_ditolak = ${reason} where id = ${id} and ditolak_pada is null`;
    const res = await statemachine.transition(ex.sm, {
      machine: MACHINE, entityType: ENTITY_TYPE, table: TABLE, entityId: id, to: STATUS_DITOLAK, actor,
    });
    if (!res.ok) throw transitionError(res);
    return toPermintaan(await lockPermintaan(tx, id), now);
  });
}

// --- Reads ---

/** getPermintaan returns one Permintaan with keterlambatan derived, view-gated. */
export async function getPermintaan(sql: Queryable, actor: Actor, id: string, now: Date = new Date()): Promise<Permintaan> {
  const rows = await sql<PermintaanRow[]>`select id, jenis, judul, deskripsi, brief_id, service_id, client_id, cpr_id,
           diajukan_oleh, diajukan_divisi, tujuan_divisi, tujuan_employee_id, due_date, status,
           diproses_pada, selesai_pada, ditolak_pada, alasan_ditolak, catatan_proses, created_by, created_at
    from permintaan where id = ${id}`;
  if (rows.length === 0) {
    throw new NotFoundError(MSG_NOT_FOUND);
  }
  const r = rows[0];
  if (!canView(actor, r.diajukan_divisi, r.tujuan_divisi, r.diajukan_oleh, r.tujuan_employee_id)) {
    throw new ForbiddenError(MSG_VIEW_FORBIDDEN);
  }
  return toPermintaan(r, now);
}

/** listPermintaanForClient — every Permintaan tied to one client (view-gated per row). */
export async function listPermintaanForClient(sql: Queryable, actor: Actor, clientId: string, now: Date = new Date()): Promise<Permintaan[]> {
  const rows = await sql<PermintaanRow[]>`
    select id, jenis, judul, deskripsi, brief_id, service_id, client_id, cpr_id,
           diajukan_oleh, diajukan_divisi, tujuan_divisi, tujuan_employee_id, due_date, status,
           diproses_pada, selesai_pada, ditolak_pada, alasan_ditolak, catatan_proses, created_by, created_at
    from permintaan where client_id = ${clientId} order by created_at desc`;
  return rows
    .filter((r) => canView(actor, r.diajukan_divisi, r.tujuan_divisi, r.diajukan_oleh, r.tujuan_employee_id))
    .map((r) => toPermintaan(r, now));
}

/** listPermintaanQueue — the antrian for one destination division (Account/Finance leads + Director). */
export async function listPermintaanQueue(sql: Queryable, actor: Actor, tujuanDivisi: string, now: Date = new Date()): Promise<Permintaan[]> {
  if (!actor.role.director && !permission.isLead(actor, tujuanDivisi) && actor.role.division !== tujuanDivisi) {
    throw new ForbiddenError(MSG_VIEW_FORBIDDEN);
  }
  const rows = await sql<PermintaanRow[]>`
    select id, jenis, judul, deskripsi, brief_id, service_id, client_id, cpr_id,
           diajukan_oleh, diajukan_divisi, tujuan_divisi, tujuan_employee_id, due_date, status,
           diproses_pada, selesai_pada, ditolak_pada, alasan_ditolak, catatan_proses, created_by, created_at
    from permintaan
     where tujuan_divisi = ${tujuanDivisi} and status in (${STATUS_DIAJUKAN}, ${STATUS_DIPROSES})
     order by due_date asc, created_at asc`;
  return rows.map((r) => toPermintaan(r, now));
}
