/**
 * Lead Time per Tahapan Divisi (M16 §5.3/§6, LT-23). Ported spirit of M12's
 * `computeMetrics`: PURE-ish fold over two independently-namespaced transition
 * logs, nol kolom durasi baru (aturan rumah #3/#4) — setiap angka di sini
 * recomputable dari `audit_log` + `brief_review`.
 *
 * DUA LOG, BUKAN SATU (PRD §2 Rule 3 / §5.2, STATE_MACHINES §18):
 *   - `stageEvents`  — `audit_log` entity_type='brief_stage' (checkpoint
 *     sumber='stage', mesin `stage_pipeline.machine_name`).
 *   - `statusEvents` — `audit_log` entity_type='brief' (checkpoint
 *     sumber='status_brief': QC Account Service = [In Review], Revisi =
 *     [Revision Requested] — TIDAK PERNAH tercampur dengan stageEvents,
 *     itulah alasan namespace terpisah ada sama sekali).
 *
 * SATUAN HARI KERJA lewat `working_days_between` yang SUDAH ADA
 * (`20260813000000_kelola_klien_sla.sql`) — TIDAK diimplementasi ulang di TS
 * (instruksi LT-23 eksplisit); kalender libur hidup di tabel `hari_libur`,
 * bukan di kode, jadi menduplikasi aritmetikanya di TS pasti drift.
 *
 * KOSAKATA STATUS dipinjam APA ADANYA dari timeline Kelola Klien
 * (`@cdps/core` `interview.SLA_STATUS` / `statusSla`, PRD §5.3 "memakai yang
 * sudah dipakai timeline Kelola Klien") — bukan helper baru. `statusSla`
 * menerima DUA ambang (`targetHari`/`batasHari`); `stage_definition` cuma
 * punya SATU (`target_hari_kerja`), jadi di sini `batasHari := targetHari`
 * (nol jendela toleransi terpisah — `mendekati_batas` karena itu tidak pernah
 * muncul untuk tahapan M16 hari ini). PRD tidak memberi angka toleransi kedua
 * untuk stage_definition; kalau nanti dibutuhkan, itu SATU kolom tambahan +
 * migrasi, bukan perubahan bentuk fungsi ini. Dicatat sebagai pertanyaan
 * terbuka di HANDOFF_M16_AKUN_A.md §1.
 */

import { interview } from '@cdps/core';
import type { Queryable } from '@cdps/db';
import type { Transition } from './task';

/** One row of `stage_definition`, already resolved for a specific Brief's pipeline. */
export interface StageDef {
  stageCode: string;
  label: string;
  urutan: number;
  sumber: 'stage' | 'status_brief';
  statusDipetakan: string | null;
  /** NULL | 'AM' | 'KLIEN'. Only 'KLIEN' excludes the checkpoint from lead time (Rule 9). */
  gatePihak: string | null;
  targetHariKerja: number | null;
}

/** One computed checkpoint in a Brief's lead-time timeline (PRD §5.3). */
export interface StageLeadTimeRow {
  stageCode: string;
  label: string;
  urutan: number;
  sumber: 'stage' | 'status_brief';
  gatePihak: string | null;
  masukPada: Date | null;
  keluarPada: Date | null;
  /** null = belum dimulai. Terhitung sampai `now` kalau masih aktif (keluarPada null). */
  hariKerja: number | null;
  targetHariKerja: number | null;
  status: interview.SlaStatus;
}

/** The full per-Brief lead-time timeline (PRD §5.3: "per tahap … plus totalHariKerja dan tahapAktif"). */
export interface StageLeadTimeSummary {
  stages: StageLeadTimeRow[];
  /** Sum of hariKerja over every NON-gate_pihak='KLIEN' checkpoint (Rule 9). null = nothing counted yet. */
  totalHariKerja: number | null;
  /** stage_code of whichever checkpoint currently has masukPada set + keluarPada null. null = pipeline finished or never started. */
  tahapAktif: string | null;
  /** PRD §3 row 2 ("AM kirim → divisi merespons"): briefs.created_at → brief_review.created_at (or `now` if not yet reviewed). Independent of the pipeline — populated even for divisions without one (Rule 12) or whose pipeline's first checkpoint is not literally 'Cek Brief AM' (Live Stream, see HANDOFF §1.2). May duplicate `stages[0]` when the pipeline DOES start at 'Cek Brief AM'; that is expected, not a bug. */
  intake: { masukPada: Date; keluarPada: Date | null; hariKerja: number };
}

/**
 * boundariesFor resolves masukPada/keluarPada for every def, PURE (no DB): a
 * 'stage' def's boundary comes from the first matching entry in `stageEvents`
 * (index 0 = the pipeline's initial_state, which never has a transition row of
 * its own — masukPada = briefCreatedAt); a 'status_brief' def's boundary comes
 * the same way from `statusEvents`. A def never reached (e.g. the Brief bounced
 * to 'Brief Dikembalikan ke AM' before reaching it) gets null/null.
 */
function boundariesFor(
  defs: readonly StageDef[],
  stageEvents: readonly Transition[],
  statusEvents: readonly Transition[],
  briefCreatedAt: Date,
): { def: StageDef; masukPada: Date | null; keluarPada: Date | null }[] {
  const sorted = [...defs].sort((a, b) => a.urutan - b.urutan);
  return sorted.map((def, idx) => {
    if (def.sumber === 'stage') {
      if (idx === 0) {
        return { def, masukPada: briefCreatedAt, keluarPada: stageEvents.length > 0 ? stageEvents[0].at : null };
      }
      const i = stageEvents.findIndex((e) => e.to === def.stageCode);
      if (i < 0) {
        return { def, masukPada: null, keluarPada: null };
      }
      return { def, masukPada: stageEvents[i].at, keluarPada: i + 1 < stageEvents.length ? stageEvents[i + 1].at : null };
    }
    const i = statusEvents.findIndex((e) => e.to === def.statusDipetakan);
    if (i < 0) {
      return { def, masukPada: null, keluarPada: null };
    }
    return { def, masukPada: statusEvents[i].at, keluarPada: i + 1 < statusEvents.length ? statusEvents[i + 1].at : null };
  });
}

/** workingDays calls the SQL `working_days_between` (Sen–Jum minus `hari_libur`) for one (from, to] pair. */
async function workingDays(q: Queryable, from: Date, to: Date): Promise<number> {
  const rows = await q<{ n: number }[]>`select working_days_between(${wibDateStr(from)}::date, ${wibDateStr(to)}::date) as n`;
  return Number(rows[0].n);
}

/** wibDateStr mirrors the SQL `wib_date()` — WIB (UTC+7) calendar date of an instant, as 'YYYY-MM-DD'. */
function wibDateStr(t: Date): string {
  return new Date(t.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
}

/**
 * computeStageLeadTime folds a Brief's two transition logs into the full
 * per-tahap timeline (PRD §5.3). Not a hot aggregate path (one Brief detail
 * view at a time, ≤8 checkpoints) — each checkpoint's working-day count is one
 * small round trip; batching was judged not worth the complexity here (see
 * HANDOFF_M16_AKUN_A.md).
 */
export async function computeStageLeadTime(
  q: Queryable,
  defs: readonly StageDef[],
  stageEvents: readonly Transition[],
  statusEvents: readonly Transition[],
  overrides: ReadonlyMap<string, number>,
  briefCreatedAt: Date,
  reviewedAt: Date | null,
  now: Date = new Date(),
): Promise<StageLeadTimeSummary> {
  const boundaries = boundariesFor(defs, stageEvents, statusEvents, briefCreatedAt);

  const rows: StageLeadTimeRow[] = [];
  let total = 0;
  let anyCounted = false;
  let tahapAktif: string | null = null;
  let latestMasuk = -Infinity;

  for (const b of boundaries) {
    const { def, masukPada, keluarPada } = b;
    const target = overrides.get(def.stageCode) ?? def.targetHariKerja ?? null;
    let hariKerja: number | null = null;
    if (masukPada !== null) {
      hariKerja = await workingDays(q, masukPada, keluarPada ?? now);
      if (keluarPada === null && masukPada.getTime() > latestMasuk) {
        tahapAktif = def.stageCode;
        latestMasuk = masukPada.getTime();
      }
    }
    // Rule 9: gate KLIEN dicatat tapi DIKELUARKAN dari lead time divisi.
    // Target NULL ⇒ tidak bisa dihakimi sama sekali (Rule 8, N/A).
    const status: interview.SlaStatus =
      def.gatePihak === 'KLIEN' || target === null
        ? interview.SLA_STATUS.TidakBerlaku
        : interview.statusSla(hariKerja, { targetHari: target, batasHari: target });
    if (def.gatePihak !== 'KLIEN' && hariKerja !== null) {
      total += hariKerja;
      anyCounted = true;
    }
    rows.push({
      stageCode: def.stageCode, label: def.label, urutan: def.urutan, sumber: def.sumber,
      gatePihak: def.gatePihak, masukPada, keluarPada, hariKerja, targetHariKerja: target, status,
    });
  }

  const intakeEnd = reviewedAt ?? now;
  const intakeHariKerja = await workingDays(q, briefCreatedAt, intakeEnd);

  return {
    stages: rows,
    totalHariKerja: anyCounted ? total : null,
    tahapAktif,
    intake: { masukPada: briefCreatedAt, keluarPada: reviewedAt, hariKerja: intakeHariKerja },
  };
}
