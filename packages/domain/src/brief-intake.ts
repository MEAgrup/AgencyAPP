/**
 * Siklus intake Brief — BRIEF-KEMBALI-SIKLUS (Improvement Req Account,
 * pemilik 2026-09-30; `docs/DECISIONS.md` 2026-09-30).
 *
 * Modul ini MENYUSUN tiga modul yang sudah ada tanpa mengubah kontraknya:
 *   - `stage`   — keputusan intake (`brief_review`) + mesin tahapan,
 *   - `account` — isi Brief (`applyBriefRevisi`) + efek Service,
 *   - mesin `brief_task` (lewat `statemachine.transition`, aturan rumah #2).
 *
 * Ia berdiri sendiri karena `account` meng-import `stage`, dan `task` meng-import
 * `account` — menaruh penyusunan ini di salah satunya akan menjadi siklus import.
 *
 * Tiga perilaku:
 *   1. `reviewIntake`   — keputusan divisi. "Diterima" ⇒ Brief `[To Do]` ikut
 *                          pindah ke `[In Progress]` di transaksi yang sama
 *                          (butir 3: "sudah diterima KOL, di AM masih To Do").
 *   2. `kirimUlangBrief` — AM merevisi isi Brief yang dikembalikan lalu
 *                          mengirimnya ulang (butir 1). Membuka putaran intake
 *                          baru; divisi menilai ulang lewat `reviewIntake`.
 *   3. Status HOLD (butir 2) adalah `intakeState = 'dikembalikan'` — turunan,
 *      dibaca lewat `private.brief_intake_state`; guard eksekusinya di `task.ts`.
 */

import { notification, permission, statemachine } from '@cdps/core';
import { executors, withTransaction, type Queryable, type Sql, type TransactionSql } from '@cdps/db';
import * as account from './account';
import * as stage from './stage';

export type Actor = permission.Actor;

// Verbatim BI messages (aturan rumah #5).
export const MSG_BRIEF_NOT_FOUND = '[brief tidak ditemukan]';
export const MSG_KIRIM_ULANG_FORBIDDEN = '[hanya AM pemilik klien yang dapat merevisi brief ini]';
export const MSG_BRIEF_TIDAK_DIKEMBALIKAN = '[brief ini tidak sedang dikembalikan ke AM]';
export const MSG_CATATAN_REVISI_WAJIB = '[catatan revisi wajib diisi]';

const MACHINE_BRIEF_TASK = 'brief_task';

type JsonParam = Parameters<TransactionSql['json']>[0];

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BriefIntakeValidationError';
  }
}
export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BriefIntakeForbiddenError';
  }
}
export class NotFoundError extends Error {
  constructor(message = MSG_BRIEF_NOT_FOUND) {
    super(message);
    this.name = 'BriefIntakeNotFoundError';
  }
}
export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BriefIntakeConflictError';
  }
}

// ---------------------------------------------------------------------------
// 1. reviewIntake — keputusan Cek Brief AM + auto-start.
// ---------------------------------------------------------------------------

/**
 * reviewIntake = `stage.reviewBriefTx` + (bila "Diterima" dan Brief masih
 * `[To Do]`) edge `[To Do] → [In Progress]` di transaksi yang SAMA, lalu efek
 * Service `[Briefed] → [In Execution]` (`account.onBriefLeavesToDo`, M6 §5 Flow 3).
 *
 * Kenapa otomatis: menerima brief adalah pernyataan divisi bahwa pekerjaannya
 * dimulai. Tanpa ini AM melihat `[To Do]` untuk brief yang di sisi divisi sudah
 * diterima (butir 3), dan turnaround M12 mulai terlambat sebanyak jeda antara
 * "Terima" dan klik "Mulai" yang terpisah.
 *
 * Brief di luar `[To Do]` tidak disentuh: Brief Live (`[Dispatched to Vendor]`,
 * di luar mesin §7) dan Brief yang divisinya sudah menekan Mulai lebih dulu.
 * Rollup Creative/KOL/Store Ops tetap aman — rollup maju-saja, jadi Brief yang
 * sudah `[In Progress]` dengan anak semuanya `[To Do]` adalah nol langkah.
 */
export async function reviewIntake(sql: Sql, actor: Actor, briefId: string, input: stage.ReviewInput): Promise<void> {
  await withTransaction(sql, async (tx) => {
    await stage.reviewBriefTx(tx, actor, briefId, input);
    if (input.keputusan !== 'Diterima') {
      return;
    }
    const rows = await tx<{ status: string; service_id: string }[]>`
      select status, service_id from briefs where id = ${briefId} for update`;
    if (rows.length === 0 || rows[0].status !== account.BRIEF_STATUS_TODO) {
      return;
    }
    const ex = executors(tx);
    const res = await statemachine.transition(ex.sm, {
      machine: MACHINE_BRIEF_TASK, entityType: 'brief', table: 'briefs', entityId: briefId,
      to: '[In Progress]', actor,
    });
    if (!res.ok) {
      throw res.code === 'role_denied' ? new ForbiddenError(res.message) : new ConflictError(res.message);
    }
    await account.onBriefLeavesToDo(tx, actor, rows[0].service_id);
  });
}

// ---------------------------------------------------------------------------
// 2. kirimUlangBrief — AM merevisi & mengirim ulang.
// ---------------------------------------------------------------------------

export interface KirimUlangInput {
  /** Apa yang diperbaiki — wajib; divisi harus tahu apa yang berubah. */
  catatan: string;
  /** Field yang diubah; kosong = kirim ulang tanpa ubah isi (mis. sampel sudah dikirim). */
  perubahan?: account.BriefRevisi;
}

export interface KirimUlangResult {
  briefId: string;
  /** Putaran pengembalian yang dijawab kiriman ini. */
  putaran: number;
  /** Field yang benar-benar berubah (kunci kolom snake_case). */
  perubahan: account.BriefRevisiDiff;
}

/** canKirimUlang — AM pemilik klien atau Director (gerbang peran `gate_pihak='AM'`, LT-6). */
export function canKirimUlang(actor: Actor, ownerAm: string): boolean {
  return actor.role.director || (ownerAm !== '' && actor.employeeId === ownerAm);
}

/**
 * kirimUlangBrief: gerbang AM pemilik/Director → Brief harus `dikembalikan` →
 * terapkan revisi isi → catat `brief_kirim_ulang` (putaran = putaran
 * pengembalian terakhir) + satu baris audit `brief_dikirim_ulang` → bila
 * ber-pipeline, tahapan `Brief Dikembalikan ke AM → Cek Brief AM` lewat
 * `sm_transition` → notifikasi divisi (penolak putaran itu + PIC).
 *
 * Audit ditulis dengan `entity_type='brief'` dan action NON-transisi, jadi
 * `computeMetrics` (filter `transition:%`) tidak membacanya.
 */
export async function kirimUlangBrief(sql: Sql, actor: Actor, briefId: string, input: KirimUlangInput): Promise<KirimUlangResult> {
  const catatan = (input.catatan ?? '').trim();
  if (catatan === '') {
    throw new ValidationError(MSG_CATATAN_REVISI_WAJIB);
  }
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const rows = await tx<{
      id: string; stage_pipeline_code: string | null; production_stage: string | null;
      assigned_pic: string | null; owner_am: string | null;
    }[]>`
      select b.id, b.stage_pipeline_code, b.production_stage, b.assigned_pic,
             private.brief_owner_am(b.id) as owner_am
        from briefs b where b.id = ${briefId} for update`;
    if (rows.length === 0) {
      throw new NotFoundError();
    }
    const b = rows[0];
    if (!canKirimUlang(actor, b.owner_am ?? '')) {
      throw new ForbiddenError(MSG_KIRIM_ULANG_FORBIDDEN);
    }
    const state = await tx<{ s: string | null }[]>`select private.brief_intake_state(${briefId}) as s`;
    if (state[0].s !== 'dikembalikan') {
      throw new ConflictError(MSG_BRIEF_TIDAK_DIKEMBALIKAN);
    }
    const last = await tx<{ putaran: number; actor_employee_id: string }[]>`
      select putaran, actor_employee_id from brief_review
       where brief_id = ${briefId} order by putaran desc limit 1`;
    const putaran = Number(last[0].putaran);

    const diff = await account.applyBriefRevisi(tx, briefId, input.perubahan ?? {});

    await tx`
      insert into brief_kirim_ulang (brief_id, putaran, catatan, perubahan, actor_employee_id)
      values (${briefId}, ${putaran}, ${catatan}, ${tx.json(diff as unknown as JsonParam)}, ${actor.employeeId})`;
    await ex.audit.insertAudit({
      entityType: 'brief', entityId: briefId, actorEmployeeId: actor.employeeId, action: 'brief_dikirim_ulang',
      beforeJson: Object.fromEntries(Object.entries(diff).map(([k, v]) => [k, v.before])),
      afterJson: { putaran, catatan, ...Object.fromEntries(Object.entries(diff).map(([k, v]) => [k, v.after])) },
      createdBy: actor.employeeId,
    });

    if (b.stage_pipeline_code !== null && b.production_stage === stage.STAGE_RETURNED) {
      const pipe = await tx<{ machine_name: string }[]>`
        select machine_name from stage_pipeline where code = ${b.stage_pipeline_code}`;
      if (pipe.length > 0) {
        const res = await statemachine.transition(ex.sm, {
          machine: pipe[0].machine_name, entityType: 'brief_stage', table: 'briefs',
          idColumn: 'id', statusColumn: 'production_stage', entityId: briefId, to: stage.STAGE_CEK_BRIEF_AM, actor,
        });
        if (!res.ok) {
          throw res.code === 'role_denied' ? new ForbiddenError(res.message) : new ConflictError(res.message);
        }
      }
    }

    const recipients = [...new Set([last[0].actor_employee_id, b.assigned_pic ?? ''])]
      .filter((e) => e !== '' && e !== actor.employeeId);
    if (recipients.length > 0) {
      await notification.emit(ex.notify, {
        event: notification.EVENTS.BriefDikirimUlang, entityType: 'brief', entityId: briefId,
        actor: actor.employeeId, explicitRecipients: recipients,
      });
    }
    return { briefId, putaran, perubahan: diff };
  });
}

// ---------------------------------------------------------------------------
// 3. Baca status intake (dipakai guard & tes).
// ---------------------------------------------------------------------------

/** intakeStateOf membaca status intake turunan satu Brief (null = Brief tak dikenal). */
export async function intakeStateOf(sql: Queryable, briefId: string): Promise<account.BriefIntakeState | null> {
  const rows = await sql<{ s: string | null }[]>`select private.brief_intake_state(${briefId}) as s`;
  const s = rows[0]?.s ?? null;
  return s === 'menunggu' || s === 'diterima' || s === 'dikembalikan' ? s : null;
}
