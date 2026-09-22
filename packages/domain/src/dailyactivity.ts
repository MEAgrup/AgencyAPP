/**
 * Daily activity log (DACT-) — F-6, feedback lapangan 2026-09-14 (Account):
 * riwayat aktivitas harian karyawan — meeting klien/internal, training,
 * webinar, input data — dengan waktu dan bukti pelaksanaan, nyambung ke M14
 * Team Performance.
 *
 * DEVIASI PRD — tidak ada modul PRD yang mendefinisikan entitas ini. Pemilik
 * menjawab lewat `AskUserQuestion` (2026-09-14): ini KELUARAN KERJA, bukan
 * absensi — CDPS bukan HRIS (CLAUDE.md), jadi jam masuk/pulang tetap milik
 * HRIS. Dicatat di `docs/DECISIONS.md`.
 *
 * Bentuknya meniru `activity.ts` (`prospect_activities`, O 2026-08-06):
 *   - LOG, bukan lifecycle — nol status, mencatat aktivitas bukan transisi.
 *   - APPEND-ONLY — `daily_activities` menolak UPDATE/DELETE (trigger). Salah
 *     catat diperbaiki dengan mencatat lagi, bukan mengedit.
 *   - Row-scope adalah RLS's (`daily_activities_select`, migrasi
 *     20261021010000): staff hanya miliknya, Lead/SPV se-divisi (lewat
 *     `divisi` yang didenormalisasi saat mencatat), OD/Director penuh. Modul
 *     ini tidak menduplikasi predikat itu — `list` hanya membaca lewat
 *     `readAsActor` dan mempercayai RLS.
 *
 * F-6b (interview lapangan 2026-09-22, via Handa Anthy) — "koreksi berantai".
 * Staff butuh mengoreksi entri yang salah input atau reschedule; meng-UPDATE
 * baris lama TETAP bukan pilihan (trigger + house rule #3 tidak berubah).
 * `log()` sekarang menerima `koreksiDari` opsional: mengisinya meng-INSERT
 * baris BARU yang menunjuk ke baris lama (migrasi 20261129010000), bukan
 * mengubahnya. Aturannya (ditegakkan di sini, DB `for update` mengunci baris
 * predecessor supaya dua koreksi yang lomba tidak lolos berdua):
 *   1. predecessor harus ada dan MILIK actor sendiri (koreksi, seperti
 *      mencatat, selalu punya-sendiri — tidak ada "koreksi milik orang lain").
 *   2. predecessor belum pernah dikoreksi (rantai, bukan pohon — koreksi
 *      kedua harus menunjuk ke koreksi PERTAMA, bukan balik ke baris asli).
 * Baris yang sudah dikoreksi tidak dihapus/disembunyikan dari log — `list`
 * mengembalikan `dikoreksiOleh` (computed, house rule #4) supaya FE tahu baris
 * mana yang masih "berlaku".
 */

import { bi, ident, permission } from '@cdps/core';
import { executors, withTransaction, type Queryable, type Sql } from '@cdps/db';

export type Actor = permission.Actor;

/**
 * The CLOSED activity taxonomy (feedback lapangan 2026-09-14, permintaan
 * Account). Mirrored by the `ck_dact_type` CHECK constraint in migration
 * 20261021010000 — the DB is the authority. Adding a type means a migration
 * AND a DECISIONS entry, exactly like `activity.ACTIVITY_TYPES`.
 */
export const ACTIVITY_TYPES: readonly string[] = [
  'Meeting Klien',
  'Meeting Internal',
  'Training',
  'Webinar',
  'Input Data',
  'Lainnya',
];

/** Mandatory-field gate failure (carries the exact global BI message). */
export class IncompleteError extends Error {
  constructor() {
    super(bi.INCOMPLETE_DATA);
    this.name = 'DailyActivityIncompleteError';
  }
}

/** F-6b: `koreksiDari` does not exist, or is not the actor's own row. */
export class NotFoundError extends Error {
  constructor() {
    super('[aktivitas yang ingin dikoreksi tidak ditemukan]');
    this.name = 'DailyActivityNotFoundError';
  }
}

/** F-6b: `koreksiDari` already has a correction — a chain, not a tree. */
export class ConflictError extends Error {
  constructor() {
    super('[aktivitas ini sudah pernah dikoreksi, koreksi versi terbarunya]');
    this.name = 'DailyActivityConflictError';
  }
}

/** One logged daily activity. */
export interface DailyActivity {
  id: string;
  employeeId: string;
  employeeNama: string;
  divisi: string;
  activityType: string;
  activityDate: string;
  jamMulai: string;
  jamSelesai: string | null;
  keterangan: string;
  buktiPelaksanaan: string | null;
  createdAt: Date;
  /** F-6b: id of the row this one corrects, or null for an original entry. */
  koreksiDari: string | null;
  /** F-6b: id of the row that corrects this one, or null if still current. */
  dikoreksiOleh: string | null;
}

/** Fields an employee supplies when logging one activity. */
export interface LogInput {
  activityType: string;
  /** YYYY-MM-DD. */
  activityDate: string;
  /** HH:MM. */
  jamMulai: string;
  /** HH:MM, optional. */
  jamSelesai?: string;
  keterangan: string;
  buktiPelaksanaan?: string;
  /** F-6b: id of the actor's own, not-yet-corrected row this entry replaces. */
  koreksiDari?: string;
}

/** isKnownType reports whether `t` is in the closed taxonomy. */
export function isKnownType(t: string): boolean {
  return ACTIVITY_TYPES.includes((t ?? '').trim());
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const YYYYMMDD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * log records one activity for the actor themselves (there is no "log on
 * behalf of someone else" — every write is `employee_id = actor.employeeId`,
 * matching the RLS own-row arm). `divisi` is stamped from the actor's OWN
 * resolved CDPS role division at the moment of writing (same pattern as
 * `internal_tasks.assignee_division`) so the Lead/SPV RLS arm can filter
 * without joining `employees` (whose `divisi` column is the raw HRIS one,
 * not the CDPS division — see migration header).
 */
export async function log(
  sql: Sql,
  actor: Actor,
  input: LogInput,
  now: Date = new Date(),
): Promise<DailyActivity> {
  const activityType = (input.activityType ?? '').trim();
  const activityDate = (input.activityDate ?? '').trim();
  const jamMulai = (input.jamMulai ?? '').trim();
  const jamSelesai = (input.jamSelesai ?? '').trim();
  const keterangan = (input.keterangan ?? '').trim();
  const buktiPelaksanaan = (input.buktiPelaksanaan ?? '').trim();
  const koreksiDari = (input.koreksiDari ?? '').trim();

  if (
    activityType === '' || !isKnownType(activityType) ||
    !YYYYMMDD.test(activityDate) ||
    !HHMM.test(jamMulai) ||
    (jamSelesai !== '' && !HHMM.test(jamSelesai)) ||
    keterangan === ''
  ) {
    throw new IncompleteError();
  }
  if (jamSelesai !== '' && jamSelesai < jamMulai) {
    throw new IncompleteError();
  }

  const divisi = actor.role.division;

  return withTransaction(sql, async (tx) => {
    if (koreksiDari !== '') {
      // `for update` locks the predecessor row for the rest of this
      // transaction — two concurrent corrections of the same row cannot both
      // see it as "not yet corrected" (the partial unique index on
      // `koreksi_dari` is the last-resort backstop if they somehow did).
      const pred = await tx<{ employee_id: string; sudah_dikoreksi: boolean }[]>`
        select p.employee_id, exists(
          select 1 from daily_activities c where c.koreksi_dari = p.id
        ) as sudah_dikoreksi
        from daily_activities p
        where p.id = ${koreksiDari}
        for update`;
      if (pred.length === 0 || pred[0].employee_id !== actor.employeeId) {
        throw new NotFoundError();
      }
      if (pred[0].sudah_dikoreksi) {
        throw new ConflictError();
      }
    }

    const ex = executors(tx);
    const id = await ident.nextId(ex.ident, 'DACT', now);
    await tx`
      insert into daily_activities
        (id, employee_id, divisi, activity_type, activity_date, jam_mulai, jam_selesai,
         keterangan, bukti_pelaksanaan, created_by, koreksi_dari)
      values
        (${id}, ${actor.employeeId}, ${divisi}, ${activityType}, ${activityDate}, ${jamMulai},
         ${jamSelesai === '' ? null : jamSelesai}, ${keterangan},
         ${buktiPelaksanaan === '' ? null : buktiPelaksanaan}, ${actor.employeeId},
         ${koreksiDari === '' ? null : koreksiDari})`;

    const nameRows = await tx<{ nama: string }[]>`
      select nama from employees where employee_id = ${actor.employeeId}`;
    return {
      id, employeeId: actor.employeeId,
      employeeNama: nameRows.length > 0 ? nameRows[0].nama : actor.employeeId,
      divisi, activityType, activityDate, jamMulai,
      jamSelesai: jamSelesai === '' ? null : jamSelesai,
      keterangan, buktiPelaksanaan: buktiPelaksanaan === '' ? null : buktiPelaksanaan,
      createdAt: now,
      koreksiDari: koreksiDari === '' ? null : koreksiDari,
      dikoreksiOleh: null,
    };
  });
}

interface DailyActivityRow {
  id: string; employee_id: string; employee_nama: string; divisi: string;
  activity_type: string; activity_date: string; jam_mulai: string; jam_selesai: string | null;
  keterangan: string; bukti_pelaksanaan: string | null; created_at: Date;
  koreksi_dari: string | null; dikoreksi_oleh: string | null;
}

function toDailyActivity(r: DailyActivityRow): DailyActivity {
  return {
    id: r.id, employeeId: r.employee_id, employeeNama: r.employee_nama, divisi: r.divisi,
    activityType: r.activity_type, activityDate: r.activity_date, jamMulai: r.jam_mulai,
    jamSelesai: r.jam_selesai, keterangan: r.keterangan, buktiPelaksanaan: r.bukti_pelaksanaan,
    createdAt: r.created_at, koreksiDari: r.koreksi_dari, dikoreksiOleh: r.dikoreksi_oleh,
  };
}

/** Optional narrowing for `list` — an empty filter reads everything RLS allows. */
export interface ListFilter {
  employeeId?: string;
  from?: string;
  to?: string;
}

/**
 * list returns activities newest-first. Row scope is RLS's
 * (`daily_activities_select`) — an actor who may not see a row simply never
 * receives it; this function does not re-implement that predicate. Call
 * through `readAsActor` (apps/api/src/lib/db.ts), same as every other
 * RLS-gated read in this codebase.
 */
export async function list(sql: Queryable, filter: ListFilter = {}): Promise<DailyActivity[]> {
  const employeeId = (filter.employeeId ?? '').trim();
  // `from`/`to` go in as `date | null`, never `''` — an empty string bound
  // against a `::date` cast is what made postgres.js try to serialize "" as a
  // date and throw `Invalid time value` before the query ever reached the DB.
  const fromDate = (filter.from ?? '').trim() || null;
  const toDate = (filter.to ?? '').trim() || null;
  const rows = await sql<DailyActivityRow[]>`
    select a.id, a.employee_id, private.employee_display_name(a.employee_id) as employee_nama,
           a.divisi, a.activity_type, a.activity_date, a.jam_mulai, a.jam_selesai,
           a.keterangan, a.bukti_pelaksanaan, a.created_at, a.koreksi_dari,
           (select c.id from daily_activities c where c.koreksi_dari = a.id) as dikoreksi_oleh
    from daily_activities a
    where (${employeeId} = '' or a.employee_id = ${employeeId})
      and (${fromDate}::date is null or a.activity_date >= ${fromDate}::date)
      and (${toDate}::date is null or a.activity_date <= ${toDate}::date)
    order by a.activity_date desc, a.jam_mulai desc, a.id desc`;
  return rows.map(toDailyActivity);
}
