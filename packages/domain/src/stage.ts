/**
 * Tahapan Produksi Brief (`brief_stage`, M16 §2/§5, STATE_MACHINES §18, LT-22).
 *
 * Mesin tahapan berjalan BERDAMPINGAN dengan mesin `brief_task` (M12) pada
 * baris `briefs` yang sama, di kolom BERBEDA (`production_stage` vs `status`) —
 * aturan rumah #2 tetap utuh, mesin tahapan TIDAK PERNAH menulis `status`.
 *
 * ⚠️ WAJIB `p_entity_type='brief_stage'` di SETIAP panggilan `statemachine.transition`
 * di berkas ini — BUKAN `'brief'`. `computeMetrics` (M12, `task.ts`) memfilter
 * `audit_log` dengan `entity_type='brief'` + `action like 'transition:%'`; menulis
 * transisi tahapan dengan namespace itu akan mencemari turnaround/Speed Score/
 * revision count SETIAP Brief (PRD §5.2, STATE_MACHINES §18).
 *
 * `resolvePipeline`/`insertBrief` (dipanggil dari `account.ts`) adalah SATU-SATUNYA
 * jalur `production_stage`/`stage_pipeline_code` mendapat nilai AWAL — pengisian itu
 * literal (pola yang sama dengan `briefs.status` diisi `[To Do]` saat lahir), bukan
 * lewat `sm_transition` (baris pertama sebuah mesin tidak "ditransisikan ke").
 *
 * Divisi TANPA pipeline (Rule 12, mis. Store Operation) menghasilkan
 * `stage_pipeline_code`/`production_stage` NULL pada Brief — setiap fungsi di sini
 * memperlakukan itu sebagai "tidak ada mesin untuk digerakkan", BUKAN error, kecuali
 * `advanceStage` (menggerakkan sesuatu yang tidak ada jelas invalid).
 */

import { division, notification, permission, statemachine } from '@cdps/core';
import { executors, withTransaction, type Queryable, type Sql } from '@cdps/db';
import { allowedTransitions } from './engine';
import { computeStageLeadTime, type StageDef, type StageLeadTimeSummary } from './leadtime';
import { loadTransitions, transitionsOf } from './transitions';

export type { StageDef, StageLeadTimeSummary } from './leadtime';

export type Actor = permission.Actor;

// ---------------------------------------------------------------------------
// Verbatim BI messages (house rule #5).
// ---------------------------------------------------------------------------

export const MSG_BRIEF_NOT_FOUND = '[brief tidak ditemukan]';
export const MSG_NO_PIPELINE = '[brief ini tidak punya pipeline tahapan]';
export const MSG_EXEC_FORBIDDEN = '[anda tidak memiliki akses untuk menjalankan tahapan ini]';
export const MSG_AM_GATE_FORBIDDEN = '[hanya AM pemilik klien yang dapat memproses tahap ini]';
export const MSG_ALREADY_REVIEWED = '[brief ini sudah pernah direview]';
export const MSG_INVALID_KEPUTUSAN = '[keputusan tidak valid]';
export const MSG_ALASAN_REQUIRED = '[alasan pengembalian wajib diisi]';
export const MSG_ALASAN_INVALID = '[alasan tidak valid untuk divisi ini]';
export const MSG_INVALID_SLA = '[target hari kerja harus lebih dari 0 hari kerja]';
export const MSG_SLA_FORBIDDEN = '[anda tidak memiliki akses untuk mengubah target tahap ini]';
export const MSG_STAGE_CODE_INVALID = '[tahap tidak valid untuk pipeline brief ini]';
export const MSG_VIEW_FORBIDDEN = '[anda tidak memiliki akses ke tahapan brief ini]';

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StageValidationError';
  }
}
export class ForbiddenError extends Error {
  constructor(message = MSG_EXEC_FORBIDDEN) {
    super(message);
    this.name = 'StageForbiddenError';
  }
}
export class NotFoundError extends Error {
  constructor(message = MSG_BRIEF_NOT_FOUND) {
    super(message);
    this.name = 'StageNotFoundError';
  }
}
export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StageConflictError';
  }
}

/** Every checkpoint whose intake gate lives at this literal state (PRD §2 Rule 10). */
export const STAGE_CEK_BRIEF_AM = 'Cek Brief AM';
/** Dead-end returned-to-AM state. Edge-in only — see HANDOFF_M16_AKUN_A.md §1.1 for why it is NOT in `sm_terminal_states`. */
export const STAGE_RETURNED = 'Brief Dikembalikan ke AM';

/** Alasan pengembalian terstruktur per divisi (PRD §4.1/§4.3). Divisi lain → fallback (HANDOFF §1.7). */
const REASON_CODES_BY_DIVISION: Record<string, readonly string[]> = {
  Creative: ['Brief kurang jelas', 'Sampel belum diterima', 'Talent tidak tersedia', 'Properti tidak tersedia', 'Lokasi butuh approval'],
  KOL: ['Brief kurang jelas', 'Data tidak lengkap'],
};
const REASON_FALLBACK: readonly string[] = ['Brief kurang jelas'];

// ---------------------------------------------------------------------------
// Pipeline resolution — data-driven, nol switch per-divisi (Rule 12 / PRD §7).
// ---------------------------------------------------------------------------

export interface Pipeline {
  code: string;
  machineName: string;
  initialState: string;
}

/**
 * resolvePipeline picks the ONE pipeline for (division label, deliverable type),
 * exact deliverable_type match preferred over a NULL "single pipeline" row
 * (AI Optimizer's two rows vs everyone else's one). Divisi tanpa baris
 * `stage_pipeline` (mis. Store Operation) atau divisi tak terdaftar → null,
 * BUKAN error — caller (insertBrief) menyimpan Brief dengan kedua kolom NULL.
 *
 * ⚠️ JOIN `sm_machines` DI SINI SAH HANYA KARENA INI JALUR TULIS. `initialState`
 * memang dibutuhkan (`account.insertBrief` menuliskannya ke
 * `briefs.production_stage`), dan `sm_machines` ada di grup RLS "internal murni"
 * — SELECT dicabut dari `authenticated`, nol policy
 * (`20260723064438_rls_baseline.sql`, invariant `supabase/tests/rls_checks.sql`
 * §9). `insertBrief` berjalan di `withTransaction` (koneksi privileged), jadi
 * join ini tidak pernah bertemu RLS. **Jangan panggil fungsi ini dari jalur baca
 * `readAsActor`** — itu akan 42501 persis seperti `pipelineByCode` pada QA live
 * 2026-09-02 (lihat komentarnya di bawah). Butuh pipeline di jalur baca? Pakai
 * `pipelineByCode`, yang sengaja tidak menyentuh `sm_machines`.
 */
export async function resolvePipeline(tx: Queryable, divisionNama: string, deliverableType: string): Promise<Pipeline | null> {
  const code = division.byNama(divisionNama)?.code;
  if (!code) {
    return null;
  }
  const rows = await tx<{ code: string; machine_name: string; initial_state: string }[]>`
    select sp.code, sp.machine_name, sm.initial_state
      from stage_pipeline sp
      join sm_machines sm on sm.name = sp.machine_name
     where sp.division_code = ${code} and sp.aktif = true
       and (sp.deliverable_type is null or sp.deliverable_type = ${deliverableType})
     order by (sp.deliverable_type is not null) desc
     limit 1`;
  if (rows.length === 0) {
    return null;
  }
  return { code: rows[0].code, machineName: rows[0].machine_name, initialState: rows[0].initial_state };
}

/**
 * Apa yang penelepon `pipelineByCode` sungguh-sungguh pakai: kode pipeline +
 * nama mesinnya. SENGAJA tanpa `initialState` — lihat komentar fungsinya.
 */
type PipelineRef = Pick<Pipeline, 'code' | 'machineName'>;

/**
 * pipelineByCode membaca pipeline dari kodenya — **hanya dari `stage_pipeline`,
 * TANPA join `sm_machines`.**
 *
 * KENAPA TANPA JOIN (QA live 2026-09-02, pelapor Yohan/Director). Fungsi ini dulu
 * menjoin `sm_machines` untuk mengambil `initial_state`. Itu tidak pernah
 * meledak selama penggunanya hanya jalur TULIS (`advanceStage`, `reviewBrief` —
 * keduanya di `withTransaction`, koneksi privileged). LT-60 menambahkan
 * `listNextStages` ke dalam `getStageOverview`, yang berjalan di bawah
 * `readAsActor` (`SET LOCAL ROLE authenticated`) — dan `sm_machines` ada di grup
 * RLS "internal murni" (SELECT dicabut, nol policy). Hasilnya
 * `42501 permission denied for table sm_machines`, yang `mapError` tidak
 * memetakan: `GET /briefs/{id}/stage` menjawab 500 dan panel "Tahapan Produksi"
 * merender "internal server error" telanjang di `/creative/briefs/BRF-…`.
 *
 * Ini KELAS BUG YANG SAMA dengan insiden `sm_edges` 2026-08-03 yang melahirkan
 * `private.sm_allowed_transitions` (lihat `engine.ts`) — dan doc comment
 * `listNextStages` sudah memperingatkan soal `sm_edges` secara eksplisit, tapi
 * join `sm_machines` yang menumpang lewat `pipelineByCode` lolos dari mata.
 *
 * Perbaikannya tidak butuh migrasi maupun fungsi SECURITY DEFINER baru:
 * KETIGA penelepon hanya memakai `machineName`, dan `machine_name` memang
 * kolom `stage_pipeline` — tabel yang `authenticated` BOLEH baca. `initial_state`
 * cuma beban yang tak pernah dipakai di sini. Satu-satunya yang benar-benar
 * butuh `initialState` adalah `resolvePipeline` (jalur tulis `insertBrief`), dan
 * ia mempertahankan join-nya.
 */
async function pipelineByCode(tx: Queryable, code: string): Promise<PipelineRef> {
  const rows = await tx<{ code: string; machine_name: string }[]>`
    select code, machine_name from stage_pipeline where code = ${code}`;
  if (rows.length === 0) {
    throw new ConflictError(MSG_NO_PIPELINE);
  }
  return { code: rows[0].code, machineName: rows[0].machine_name };
}

interface StageDefDbRow {
  stage_code: string;
  label: string;
  urutan: number;
  sumber: 'stage' | 'status_brief';
  status_dipetakan: string | null;
  gate_pihak: string | null;
  target_hari_kerja: number | null;
}

function toStageDef(r: StageDefDbRow): StageDef {
  return {
    stageCode: r.stage_code, label: r.label, urutan: r.urutan, sumber: r.sumber,
    statusDipetakan: r.status_dipetakan, gatePihak: r.gate_pihak, targetHariKerja: r.target_hari_kerja,
  };
}

/** listStageDefs returns every checkpoint of a pipeline, `urutan` ascending. */
export async function listStageDefs(tx: Queryable, pipelineCode: string): Promise<StageDef[]> {
  const rows = await tx<StageDefDbRow[]>`
    select stage_code, label, urutan, sumber, status_dipetakan, gate_pihak, target_hari_kerja
      from stage_definition where pipeline_code = ${pipelineCode} order by urutan asc`;
  return rows.map(toStageDef);
}

async function stageDefByCode(tx: Queryable, pipelineCode: string, stageCode: string): Promise<StageDef | null> {
  const rows = await tx<StageDefDbRow[]>`
    select stage_code, label, urutan, sumber, status_dipetakan, gate_pihak, target_hari_kerja
      from stage_definition where pipeline_code = ${pipelineCode} and stage_code = ${stageCode}`;
  return rows.length === 0 ? null : toStageDef(rows[0]);
}

// ---------------------------------------------------------------------------
// Row lock + gates.
// ---------------------------------------------------------------------------

interface BriefStageRow {
  id: string;
  assignedDivision: string;
  assignedPic: string;
  stagePipelineCode: string | null;
  productionStage: string | null;
  createdAt: Date;
  ownerAm: string;
}

/** lockBriefStage FOR UPDATEs the Brief row and resolves its owning AM (O52 pattern — see account.ts loadBrief). */
async function lockBriefStage(tx: Queryable, briefId: string): Promise<BriefStageRow> {
  const rows = await tx<{
    id: string; assigned_division: string; assigned_pic: string | null;
    stage_pipeline_code: string | null; production_stage: string | null;
    created_at: Date; assigned_am_id: string | null;
  }[]>`
    select b.id, b.assigned_division, b.assigned_pic, b.stage_pipeline_code, b.production_stage,
           b.created_at, private.brief_owner_am(b.id) as assigned_am_id
      from briefs b
     where b.id = ${briefId} for update`;
  if (rows.length === 0) {
    throw new NotFoundError();
  }
  const r = rows[0];
  return {
    id: r.id, assignedDivision: r.assigned_division, assignedPic: r.assigned_pic ?? '',
    stagePipelineCode: r.stage_pipeline_code, productionStage: r.production_stage,
    createdAt: r.created_at, ownerAm: r.assigned_am_id ?? '',
  };
}

/**
 * canExecuteStage mirrors `task.canExecute` (M12 §2 Rule 1) — duplicated rather
 * than imported to avoid a `stage.ts` ↔ `task.ts`/`account.ts` import cycle
 * (`account.insertBrief` calls `stage.resolvePipeline`). Director always;
 * otherwise same division + staff/lead; an assigned PIC restricts to that PIC
 * or the division lead.
 */
function canExecuteStage(actor: Actor, targetDivision: string, assignedPic: string): boolean {
  if (actor.role.director) {
    return true;
  }
  if (actor.role.division !== targetDivision || (actor.role.level !== permission.LevelStaff && actor.role.level !== permission.LevelLead)) {
    return false;
  }
  if (assignedPic !== '') {
    return actor.employeeId === assignedPic || actor.role.level === permission.LevelLead;
  }
  return true;
}

/** canReviewBrief (Cek Brief AM, PRD §2 Rule 10): division staff/lead or Director — PIC is usually not assigned yet at intake. */
function canReviewBrief(actor: Actor, targetDivision: string): boolean {
  if (actor.role.director) {
    return true;
  }
  return actor.role.division === targetDivision && (actor.role.level === permission.LevelStaff || actor.role.level === permission.LevelLead);
}

/** canViewBriefStage mirrors `task.canViewTask` (M6 §6/§9.1): OD/Director, owning AM, or the target division. */
export function canViewBriefStage(actor: Actor, ownerAm: string, targetDivision: string): boolean {
  if (permission.canReadAll(actor)) {
    return true;
  }
  if (actor.employeeId === ownerAm) {
    return true;
  }
  return actor.role.division === targetDivision;
}

function transitionError(res: statemachine.TransitionResult & { ok: false }): Error {
  return res.code === 'role_denied' ? new ForbiddenError(res.message) : new ConflictError(res.message);
}

// ---------------------------------------------------------------------------
// advanceStage — LT-22.
// ---------------------------------------------------------------------------

/**
 * advanceStage drives `production_stage` one edge forward. The CURRENT stage's
 * `gate_pihak` decides who may drive it OUT: `'AM'` restricts to the owning AM
 * (or Director) — a role gate, NOT a lead-time exclusion (HANDOFF_M16_AKUN_A.md
 * §1.3); anything else uses the normal division execute gate. Entering a gated
 * destination (`gate_pihak` AM or KLIEN) fires `TahapButuhAksiAm` to the owning
 * AM (PRD §5.4) — every OTHER advance is silent (7 events would flood the AM
 * once per Brief per stage otherwise).
 */
export async function advanceStage(sql: Sql, actor: Actor, briefId: string, to: string): Promise<statemachine.TransitionResult> {
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const r = await lockBriefStage(tx, briefId);
    if (r.stagePipelineCode === null || r.productionStage === null) {
      throw new ConflictError(MSG_NO_PIPELINE);
    }
    const pipeline = await pipelineByCode(tx, r.stagePipelineCode);
    const currentDef = await stageDefByCode(tx, r.stagePipelineCode, r.productionStage);
    if (currentDef?.gatePihak === 'AM') {
      if (!actor.role.director && actor.employeeId !== r.ownerAm) {
        throw new ForbiddenError(MSG_AM_GATE_FORBIDDEN);
      }
    } else if (!canExecuteStage(actor, r.assignedDivision, r.assignedPic)) {
      throw new ForbiddenError(MSG_EXEC_FORBIDDEN);
    }
    const res = await statemachine.transition(ex.sm, {
      machine: pipeline.machineName, entityType: 'brief_stage', table: 'briefs',
      idColumn: 'id', statusColumn: 'production_stage', entityId: briefId, to, actor,
    });
    if (!res.ok) {
      throw transitionError(res);
    }
    const destDef = await stageDefByCode(tx, pipeline.code, to);
    if (destDef?.gatePihak && r.ownerAm !== '') {
      await notification.emit(ex.notify, {
        event: notification.EVENTS.TahapButuhAksiAm, entityType: 'brief_stage', entityId: briefId,
        actor: actor.employeeId, explicitRecipients: [r.ownerAm],
      });
    }
    return res;
  });
}

// ---------------------------------------------------------------------------
// reviewBrief — Cek Brief AM (LT-22).
// ---------------------------------------------------------------------------

export type Keputusan = 'Diterima' | 'Dikembalikan';

export interface ReviewInput {
  keputusan: Keputusan;
  alasanKode?: string;
  catatan?: string;
}

/**
 * reviewBrief records the division's intake decision (PRD §2 Rule 10) — ALWAYS,
 * regardless of whether the division has a pipeline or whether that pipeline
 * literally has a `'Cek Brief AM'` state (Live Stream does not — HANDOFF
 * §1.2). `brief_review` is append-ONCE: a second call on the same Brief is a
 * conflict, never an update (aturan rumah #3).
 *
 * The stage machine is driven ONLY when the Brief's CURRENT `production_stage`
 * is exactly `'Cek Brief AM'` — the one condition under which this decision
 * corresponds to a real edge in that pipeline's machine.
 */
export async function reviewBrief(sql: Sql, actor: Actor, briefId: string, input: ReviewInput): Promise<void> {
  if (input.keputusan !== 'Diterima' && input.keputusan !== 'Dikembalikan') {
    throw new ValidationError(MSG_INVALID_KEPUTUSAN);
  }
  const alasan = (input.alasanKode ?? '').trim();
  const catatan = (input.catatan ?? '').trim();
  if (input.keputusan === 'Dikembalikan' && alasan === '') {
    throw new ValidationError(MSG_ALASAN_REQUIRED);
  }

  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const r = await lockBriefStage(tx, briefId);
    if (!canReviewBrief(actor, r.assignedDivision)) {
      throw new ForbiddenError(MSG_EXEC_FORBIDDEN);
    }
    const already = await tx<{ n: number }[]>`select 1 as n from brief_review where brief_id = ${briefId}`;
    if (already.length > 0) {
      throw new ConflictError(MSG_ALREADY_REVIEWED);
    }
    if (input.keputusan === 'Dikembalikan') {
      const allowed = REASON_CODES_BY_DIVISION[r.assignedDivision] ?? REASON_FALLBACK;
      if (!allowed.includes(alasan)) {
        throw new ValidationError(MSG_ALASAN_INVALID);
      }
    }
    await tx`
      insert into brief_review (brief_id, keputusan, alasan_kode, catatan, actor_employee_id)
      values (${briefId}, ${input.keputusan}, ${input.keputusan === 'Dikembalikan' ? alasan : null}, ${catatan}, ${actor.employeeId})`;

    if (r.productionStage === STAGE_CEK_BRIEF_AM && r.stagePipelineCode !== null) {
      const pipeline = await pipelineByCode(tx, r.stagePipelineCode);
      const to =
        input.keputusan === 'Diterima' ? await nextStageAfterIntake(tx, pipeline.machineName) : STAGE_RETURNED;
      const res = await statemachine.transition(ex.sm, {
        machine: pipeline.machineName, entityType: 'brief_stage', table: 'briefs',
        idColumn: 'id', statusColumn: 'production_stage', entityId: briefId, to, actor,
      });
      if (!res.ok) {
        throw transitionError(res);
      }
    }

    if (r.ownerAm !== '') {
      await notification.emit(ex.notify, {
        event: input.keputusan === 'Diterima' ? notification.EVENTS.BriefDiterimaDivisi : notification.EVENTS.BriefDikembalikan,
        entityType: 'brief', entityId: briefId, actor: actor.employeeId, explicitRecipients: [r.ownerAm],
      });
    }
  });
}

/** nextStageAfterIntake finds the one 'Cek Brief AM' edge that is NOT the return path. */
async function nextStageAfterIntake(tx: Queryable, machineName: string): Promise<string> {
  const rows = await tx<{ to_state: string }[]>`
    select to_state from sm_edges
     where machine = ${machineName} and from_state = ${STAGE_CEK_BRIEF_AM} and to_state <> ${STAGE_RETURNED}
     limit 1`;
  if (rows.length === 0) {
    throw new ConflictError(MSG_NO_PIPELINE);
  }
  return rows[0].to_state;
}

// ---------------------------------------------------------------------------
// setStageSlaTarget — override per Brief (LT-24, PRD §2 Rule 7).
// ---------------------------------------------------------------------------

/** setStageSlaTarget overrides one stage's target_hari_kerja for one Brief. Gate: isLead(division) — pola `task.setSlaTarget`. */
export async function setStageSlaTarget(sql: Sql, actor: Actor, briefId: string, stageCode: string, days: number): Promise<void> {
  if (!(days > 0)) {
    throw new ValidationError(MSG_INVALID_SLA);
  }
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const r = await lockBriefStage(tx, briefId);
    if (r.stagePipelineCode === null) {
      throw new ConflictError(MSG_NO_PIPELINE);
    }
    if (!permission.isLead(actor, r.assignedDivision)) {
      throw new ForbiddenError(MSG_SLA_FORBIDDEN);
    }
    const def = await stageDefByCode(tx, r.stagePipelineCode, stageCode);
    if (def === null) {
      throw new ValidationError(MSG_STAGE_CODE_INVALID);
    }
    const before = await tx<{ target_hari_kerja: number }[]>`
      select target_hari_kerja from brief_stage_sla where brief_id = ${briefId} and stage_code = ${stageCode}`;
    await tx`
      insert into brief_stage_sla (brief_id, stage_code, target_hari_kerja, set_by)
      values (${briefId}, ${stageCode}, ${days}, ${actor.employeeId})
      on conflict (brief_id, stage_code) do update
        set target_hari_kerja = excluded.target_hari_kerja, set_by = excluded.set_by, created_at = now()`;
    await ex.audit.insertAudit({
      entityType: 'brief', entityId: briefId, actorEmployeeId: actor.employeeId, action: 'stage_sla_target_set',
      beforeJson: { stage_code: stageCode, target_hari_kerja: before[0]?.target_hari_kerja ?? null },
      afterJson: { stage_code: stageCode, target_hari_kerja: days }, createdBy: actor.employeeId,
    });
  });
}

// ---------------------------------------------------------------------------
// Read path — LT-25.
// ---------------------------------------------------------------------------

export interface StageOverview {
  briefId: string;
  stagePipelineCode: string | null;
  productionStage: string | null;
  review: { keputusan: Keputusan; alasanKode: string | null; catatan: string; actorEmployeeId: string; createdAt: Date } | null;
  leadTime: StageLeadTimeSummary;
  nextStages: NextStage[];
}

/**
 * One valid forward edge out of the Brief's CURRENT `production_stage` (LT-60
 * — Live Stream had no FE way to drive `advanceStage` at all; every pipeline
 * benefits from the same read). Sourced from `engine.allowedTransitions`
 * (`private.sm_allowed_transitions`, SECURITY DEFINER) — NEVER a direct
 * `select … from sm_edges`, which 42501s under `readAsActor`'s RLS session
 * exactly like the `GET /attempts/{id}` incident this function's own doc
 * comment describes (QA live 2026-08-03, `20260803123327_rls_sm_edges_read_path.sql`).
 * Also never `stage_definition.urutan` order, which would silently
 * mis-describe any pipeline that ever grows a real branch beyond
 * `Cek Brief AM`.
 *
 * `STAGE_RETURNED` is always excluded: that edge belongs to `reviewBrief`
 * (needs `alasan_kode`, appends `brief_review`) — surfacing it here would
 * let a caller drive the SAME edge through `advanceStage` and skip that
 * bookkeeping entirely. It is only ever a destination out of
 * `STAGE_CEK_BRIEF_AM`, so filtering it out is safe for every other state.
 */
export interface NextStage {
  stageCode: string;
  label: string;
}

async function listNextStages(tx: Queryable, pipelineCode: string, from: string): Promise<NextStage[]> {
  const pipeline = await pipelineByCode(tx, pipelineCode);
  const toStates = (await allowedTransitions(tx, pipeline.machineName, from)).filter((s) => s !== STAGE_RETURNED);
  if (toStates.length === 0) {
    return [];
  }
  const rows = await tx<{ stage_code: string; label: string }[]>`
    select stage_code, label from stage_definition
     where pipeline_code = ${pipelineCode} and stage_code = any(${toStates})`;
  const labelOf = new Map(rows.map((r) => [r.stage_code, r.label]));
  return toStates.map((code) => ({ stageCode: code, label: labelOf.get(code) ?? code }));
}

/** getStageOverview is the GET-route composition: defs + review + full lead-time timeline. */
export async function getStageOverview(sql: Queryable, actor: Actor, briefId: string): Promise<StageOverview> {
  const rows = await sql<{
    id: string; assigned_division: string; stage_pipeline_code: string | null; production_stage: string | null;
    created_at: Date; assigned_am_id: string | null;
  }[]>`
    select b.id, b.assigned_division, b.stage_pipeline_code, b.production_stage, b.created_at,
           private.brief_owner_am(b.id) as assigned_am_id
      from briefs b where b.id = ${briefId}`;
  if (rows.length === 0) {
    throw new NotFoundError();
  }
  const r = rows[0];
  const ownerAm = r.assigned_am_id ?? '';
  if (!canViewBriefStage(actor, ownerAm, r.assigned_division)) {
    throw new ForbiddenError(MSG_VIEW_FORBIDDEN);
  }

  const reviewRows = await sql<{ keputusan: Keputusan; alasan_kode: string | null; catatan: string; actor_employee_id: string; created_at: Date }[]>`
    select keputusan, alasan_kode, catatan, actor_employee_id, created_at from brief_review where brief_id = ${briefId}`;
  const review = reviewRows.length === 0 ? null : {
    keputusan: reviewRows[0].keputusan, alasanKode: reviewRows[0].alasan_kode, catatan: reviewRows[0].catatan,
    actorEmployeeId: reviewRows[0].actor_employee_id, createdAt: reviewRows[0].created_at,
  };

  // Rule 12: divisi tanpa pipeline (stage_pipeline_code null) tetap punya
  // rentang Cek Brief AM (brief_review) — computeStageLeadTime menghitung
  // `intake` TERLEPAS dari `defs`, jadi `stages: []` untuk kasus itu sudah cukup;
  // nol cabang khusus.
  const defs = r.stage_pipeline_code === null ? [] : await listStageDefs(sql, r.stage_pipeline_code);
  const [stageLog, statusLog, overrideRows] = await Promise.all([
    loadTransitions(sql, 'brief_stage', [briefId], 'created_at'),
    loadTransitions(sql, 'brief', [briefId], 'created_at'),
    sql<{ stage_code: string; target_hari_kerja: number }[]>`
      select stage_code, target_hari_kerja from brief_stage_sla where brief_id = ${briefId}`,
  ]);
  const overrides = new Map(overrideRows.map((o) => [o.stage_code, Number(o.target_hari_kerja)]));
  const leadTime = await computeStageLeadTime(
    sql, defs, transitionsOf(stageLog, briefId), transitionsOf(statusLog, briefId), overrides,
    r.created_at, review?.createdAt ?? null,
  );
  const nextStages =
    r.stage_pipeline_code === null || r.production_stage === null
      ? []
      : await listNextStages(sql, r.stage_pipeline_code, r.production_stage);

  return {
    briefId: r.id, stagePipelineCode: r.stage_pipeline_code, productionStage: r.production_stage, review, leadTime,
    nextStages,
  };
}

// ---------------------------------------------------------------------------
// Daily overdue tick — LT-27.
// ---------------------------------------------------------------------------

/** What one `stage_overdue_tick` pass emitted. */
export interface StageOverdueTickResult {
  lewatTarget: number;
}

/**
 * runStageOverdueTick drives the daily "tahap lewat target" sweep. The work
 * itself lives in the SQL function `stage_overdue_tick` (migration
 * 20260830030000) — pg_cron calls it directly on Supabase, so this is the
 * manual/external-cron entry point over the SAME function (pola
 * `internaltask.runReminderTick`). Idempotent via `notifications` (HANDOFF
 * §1.6, nol kolom/tabel penanda baru); `now` is a parameter so tests can pin
 * the WIB day.
 */
export async function runStageOverdueTick(sql: Sql, now?: Date): Promise<StageOverdueTickResult> {
  const rows =
    now === undefined
      ? await sql<{ r: { lewat_target: number } }[]>`select stage_overdue_tick() as r`
      : await sql<{ r: { lewat_target: number } }[]>`select stage_overdue_tick(${now}) as r`;
  return { lewatTarget: rows[0].r.lewat_target };
}
