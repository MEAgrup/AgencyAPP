/**
 * Module 6C — Penentuan Kebutuhan Plan (Service Satuan).
 *
 * Decides whether an assigned Service is Plan-gated or goes straight to Brief,
 * records the AM's call, and makes divergence from the system recommendation a
 * measured number rather than a mystery (M6C §1).
 *
 * The shape of this module follows the PRD's own reasoning about incentives, so
 * it is worth stating once here rather than re-deriving it at each function:
 *
 *   - "Tidak butuh Plan" is less work, and nothing checks it. Given a free
 *     binary, the system converges on "no Plan" for everything. So the choice is
 *     kept with the AM (they are the only one who saw the deal) but BOUNDED: the
 *     catalog locks the two extremes (`plan_wajib` / `tanpa_plan`), the system
 *     computes a recommendation from the deal's own attributes, and going against
 *     it is allowed, recorded, and visible (Rule 4, S3).
 *   - The two override DIRECTIONS are tracked separately (Rule 5). `tolak_plan`
 *     (system said yes, AM said no) is the accountability risk; `tambah_plan` is
 *     a threshold-tuning signal. Collapsing them into one "override rate" would
 *     hide the only one that matters.
 *   - Triggers are STORED, never recomputed (§10). A later threshold change must
 *     not rewrite a past decision — otherwise the audit trail describes a
 *     judgement nobody actually made.
 *
 * NOT implemented here, and why:
 *   - **Opening the Plan Satuan** (Rule 6, "the first service determined to need
 *     a Plan opens it"). The `PLAN` table is Module 6B and does not exist yet, so
 *     `plan_id` stays null and the determination is recorded without the Plan
 *     behind it. The gate is honest about this: `planSatuanStatus` reports
 *     `belum_tersedia` rather than pretending a Plan was opened.
 *   - **The three notification events** (`gate_override_dicatat`,
 *     `plan_sekarang_disarankan`, `gate_deeskalasi_diminta`). The notification
 *     catalog is a frozen invariant and the v2 amendment (28 events) is still
 *     waiting on sign-off — M6A RA-1 / M6B PA-8 / M6C GA-8 are all open. The
 *     override is still RECORDED (audit_log + `kesesuaian`); SPV simply is not
 *     pinged yet. Emitting an unregistered event would break the invariant test.
 *
 * Reference: docs/prd/CDPS_Module6C_Plan_Gate_Satuan.md.
 */

import { permission } from '@cdps/core';
import { executors, withTransaction, type Queryable, type Sql } from '@cdps/db';
import {
  ACCOUNT_DIVISION,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  type Actor,
} from './account';
import {
  DECISION_BUTUH_PLAN,
  DECISION_TANPA_PLAN,
  FIT_SESUAI,
  FIT_TOLAK_PLAN,
  TIER_DITENTUKAN_AM,
  TIER_PLAN_WAJIB,
  MSG_DEESCALATION_FORBIDDEN,
  MSG_DIVISION_REQUIRED,
  MSG_ESCALATION_REASON_REQUIRED,
  MSG_GATE_EXISTS,
  MSG_GATE_FORBIDDEN,
  MSG_GATE_MISSING,
  MSG_INCOMPLETE,
  MSG_MONITORING_REQUIRED,
  MSG_REASON_REQUIRED,
  MSG_SAME_DECISION,
  MSG_SERVICE_NOT_FOUND,
  MSG_SUMMARY_REQUIRED,
  MSG_TIER_LOCKED,
  dedupeDivisions,
  effectiveGate,
  fitOf,
  recommend,
  type GateAttributes,
  type GateConfig,
  type GateDecision,
  type GateFit,
  type PlanTier,
  type Recommendation,
  type TargetKind,
  type Trigger,
} from './plangate_rules';

// One entry point for consumers: the pure rules are re-exported so callers do
// not need to know the file split exists.
export * from './plangate_rules';

// ---------------------------------------------------------------------------
// Permission (M6C §10). AM read/write G-A…G-B for own clients; SPV/Head Account
// read all + approve de-escalation; division lead reads the decision for
// services they execute; Direksi read all. Nobody edits `tier_katalog` here —
// that is the Master Service List admin door (packages/domain/src/msl.ts).
// ---------------------------------------------------------------------------

/** canDecideGate: the owning AM, the Account lead/SPV, or a Director. */
export function canDecideGate(actor: Actor, ownerAm: string | null): boolean {
  if (actor.role.director) return true;
  if (permission.isLead(actor, ACCOUNT_DIVISION)) return true;
  return ownerAm !== null && ownerAm === actor.employeeId;
}

/** canApproveDeescalation: Rule 12 — SPV/Head Account authority, not the AM's. */
export function canApproveDeescalation(actor: Actor): boolean {
  return actor.role.director || permission.isLead(actor, ACCOUNT_DIVISION);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * GB-8: the four fields the no-Plan path must still leave behind.
 *
 * The domain speaks camelCase; the jsonb column stores snake_case, converted by
 * `summaryToDb` / `summaryFromDb` below. Keeping the stored keys snake_case
 * matters because this object crosses the wire, and the wire body is snake_case
 * everywhere in CDPS — a camelCase key inside a jsonb payload would slip past
 * the boundary rule that `wire.ts` exists to enforce.
 */
export interface AssignmentSummary {
  deliverable: string;
  deadline: string;
  divisiPic: string;
  hasilDiharapkan: string;
}

interface AssignmentSummaryDb {
  deliverable: string;
  deadline: string;
  divisi_pic: string;
  hasil_diharapkan: string;
}

function summaryToDb(s: AssignmentSummary | null): AssignmentSummaryDb | null {
  return s === null
    ? null
    : {
        deliverable: s.deliverable.trim(),
        deadline: s.deadline.trim(),
        divisi_pic: s.divisiPic.trim(),
        hasil_diharapkan: s.hasilDiharapkan.trim(),
      };
}

function summaryFromDb(v: unknown): AssignmentSummary | null {
  if (v === null || typeof v !== 'object') return null;
  const r = v as Partial<AssignmentSummaryDb>;
  return {
    deliverable: r.deliverable ?? '',
    deadline: r.deadline ?? '',
    divisiPic: r.divisi_pic ?? '',
    hasilDiharapkan: r.hasil_diharapkan ?? '',
  };
}

/** A recorded determination (`service_plan_gate`). */
export interface Gate {
  serviceId: string;
  tierKatalog: PlanTier;
  divisiTerlibat: string[];
  deliverable: string;
  kuotaPerPeriode: number | null;
  durasiBulan: number | null;
  berulang: boolean;
  nilaiPerBulan: string | null;
  targetJenis: TargetKind | null;
  targetNilai: string | null;
  sequenceDependency: boolean;
  laporanPeriodik: boolean;
  floorPrice: unknown | null;
  pemicuKeras: Trigger[];
  pemicuLunak: Trigger[];
  configVersionNo: number;
  rekomendasi: GateDecision;
  keputusanAm: GateDecision;
  kesesuaian: GateFit;
  alasan: string | null;
  pemantauanAlternatif: string | null;
  tanggalTinjauUlang: string;
  /** GB-8, four fields. Typed rather than left `unknown`: the wire shape guard
   *  follows nested references on both sides, and an untyped jsonb column here
   *  would silently exempt the whole block from that comparison. */
  ringkasanPenugasan: AssignmentSummary | null;
  planId: string | null;
  decidedBy: string;
  decidedAt: string;
}

interface GateRow {
  service_id: string;
  tier_katalog: string;
  divisi_terlibat: string;
  deliverable: string;
  kuota_per_periode: number | null;
  durasi_bulan: string | null;
  berulang: boolean;
  nilai_per_bulan: string | null;
  target_angka_jenis: string | null;
  target_angka_nilai: string | null;
  sequence_dependency: boolean;
  laporan_periodik: boolean;
  floor_price: unknown | null;
  pemicu_keras: Trigger[];
  pemicu_lunak: Trigger[];
  config_version_no: number;
  rekomendasi: string;
  keputusan_am: string;
  kesesuaian: string;
  alasan: string | null;
  pemantauan_alternatif: string | null;
  tanggal_tinjau_ulang: string | Date;
  ringkasan_penugasan: unknown | null;
  plan_id: string | null;
  decided_by: string;
  decided_at: string | Date;
}

function rowToGate(r: GateRow): Gate {
  return {
    serviceId: r.service_id,
    tierKatalog: r.tier_katalog as PlanTier,
    divisiTerlibat: splitDivisions(r.divisi_terlibat),
    deliverable: r.deliverable,
    kuotaPerPeriode: r.kuota_per_periode,
    durasiBulan: r.durasi_bulan === null ? null : Number(r.durasi_bulan),
    berulang: r.berulang,
    nilaiPerBulan: r.nilai_per_bulan,
    targetJenis: r.target_angka_jenis === null ? null : (r.target_angka_jenis as TargetKind),
    targetNilai: r.target_angka_nilai,
    sequenceDependency: r.sequence_dependency,
    laporanPeriodik: r.laporan_periodik,
    floorPrice: r.floor_price,
    pemicuKeras: r.pemicu_keras,
    pemicuLunak: r.pemicu_lunak,
    configVersionNo: r.config_version_no,
    rekomendasi: r.rekomendasi as GateDecision,
    keputusanAm: r.keputusan_am as GateDecision,
    kesesuaian: r.kesesuaian as GateFit,
    alasan: r.alasan,
    pemantauanAlternatif: r.pemantauan_alternatif,
    tanggalTinjauUlang: dateStr(r.tanggal_tinjau_ulang),
    ringkasanPenugasan: summaryFromDb(r.ringkasan_penugasan),
    planId: r.plan_id,
    decidedBy: r.decided_by,
    decidedAt: new Date(r.decided_at).toISOString(),
  };
}

/** activeConfig reads the threshold set in force (highest effective version). */
export async function activeConfig(sql: Queryable, on: string): Promise<GateConfig> {
  const rows = await sql<
    {
      version_no: number;
      kuota_threshold: number;
      nilai_threshold: string;
      durasi_threshold_bulan: string;
      notif_join_threshold: string;
    }[]
  >`
    select version_no, kuota_threshold, nilai_threshold, durasi_threshold_bulan, notif_join_threshold
      from plan_gate_config where effective_from <= ${on}
     order by effective_from desc, version_no desc limit 1`;
  if (rows.length === 0) {
    // The seed migration inserts version 1 with effective_from 2020-01-01, so
    // this can only happen if that row was deleted — a broken install, not a
    // business case. Fail loudly instead of inventing thresholds.
    throw new ConflictError('[konfigurasi ambang penentuan Plan tidak ditemukan]');
  }
  const r = rows[0];
  return {
    versionNo: r.version_no,
    kuotaThreshold: r.kuota_threshold,
    nilaiThreshold: r.nilai_threshold,
    durasiThresholdBulan: Number(r.durasi_threshold_bulan),
    notifJoinThreshold: r.notif_join_threshold,
  };
}

/** The G-A context the form opens with, plus the live recommendation (GB-1/GB-2). */
export interface GateContext {
  serviceId: string;
  serviceName: string;
  clientId: string;
  toko: string | null;
  tierKatalog: PlanTier;
  /** GA-2: contract-side facts we can read without asking the AM. */
  standardPrice: string;
  frequency: string | null;
  unit: string | null;
  minQty: number | null;
  category: string | null;
  /** GA-7: Plan Satuan status. `belum_tersedia` until Module 6B lands. */
  planSatuanStatus: 'belum_tersedia';
  /** GA-8: does the client hold an active full-management contract? (§4b) */
  adaKontrakFullManagement: boolean;
  config: GateConfig;
  /** The determination already on record, if any. */
  gate: Gate | null;
  /** Effective gate after precedence (override → decision → tier). */
  requiresPlan: boolean;
  perluPenentuan: boolean;
}

async function loadService(
  sql: Queryable,
  serviceId: string,
): Promise<{
  clientId: string;
  name: string;
  toko: string | null;
  status: string;
  tier: PlanTier;
  override: boolean | null;
  ownerAm: string | null;
  standardPrice: string;
  frequency: string | null;
  unit: string | null;
  minQty: number | null;
  category: string | null;
}> {
  const rows = await sql<
    {
      client_id: string;
      name: string;
      toko: string | null;
      status: string;
      plan_tier: string;
      requires_strategy_plan_override: boolean | null;
      assigned_am_id: string | null;
      standard_price: string;
      frequency: string | null;
      unit: string | null;
      min_qty: number | null;
      category: string | null;
    }[]
  >`
    select sv.client_id, sv.name, c.toko, sv.status, sv.plan_tier,
           sv.requires_strategy_plan_override, c.assigned_am_id, sv.standard_price,
           msv.frequency, msv.unit, msv.min_qty, msv.category
      from services sv
      join clients c on c.id = sv.client_id
      left join master_service_versions msv
             on msv.service_id = sv.master_service_id
            and msv.version_no = sv.master_version_no
     where sv.id = ${serviceId}`;
  if (rows.length === 0) {
    throw new NotFoundError(MSG_SERVICE_NOT_FOUND);
  }
  const r = rows[0];
  return {
    clientId: r.client_id,
    name: r.name,
    toko: r.toko,
    status: r.status,
    tier: r.plan_tier as PlanTier,
    override: r.requires_strategy_plan_override,
    ownerAm: r.assigned_am_id,
    standardPrice: r.standard_price,
    frequency: r.frequency,
    unit: r.unit,
    minQty: r.min_qty,
    category: r.category,
  };
}

async function loadGate(sql: Queryable, serviceId: string): Promise<Gate | null> {
  const rows = await sql<GateRow[]>`select * from service_plan_gate where service_id = ${serviceId}`;
  return rows.length === 0 ? null : rowToGate(rows[0]);
}

/**
 * gateContext assembles Section G-A for one Service and returns the recorded
 * determination if there is one. Read permission mirrors `canDecideGate` plus
 * the execution-division read arm in §10 — a division lead should be able to see
 * WHY there is or is not a Plan for work they are executing.
 */
export async function gateContext(sql: Sql, actor: Actor, serviceId: string): Promise<GateContext> {
  const svc = await loadService(sql, serviceId);
  if (!(canDecideGate(actor, svc.ownerAm) || permission.canReadAll(actor) || permission.canWrite(actor))) {
    throw new ForbiddenError(MSG_GATE_FORBIDDEN);
  }
  const gate = await loadGate(sql, serviceId);
  const cfg = await activeConfig(sql, todayWib());
  const eff = effectiveGate({
    tier: svc.tier,
    override: svc.override,
    keputusanAm: gate?.keputusanAm ?? null,
  });

  // §4(b): a service inside a Full-Management contract never enters the Plan
  // Satuan. We cannot enforce the partial unique index until the PLAN table
  // exists, so surface the fact the AM needs (GA-8) and let the M6B migration
  // add the constraint.
  const fm = await sql<{ n: number }[]>`
    select count(*)::int as n from services
     where client_id = ${svc.clientId} and plan_tier = ${TIER_PLAN_WAJIB}
       and status <> '[Voided]'`;

  return {
    serviceId,
    serviceName: svc.name,
    clientId: svc.clientId,
    toko: svc.toko,
    tierKatalog: svc.tier,
    standardPrice: svc.standardPrice,
    frequency: svc.frequency,
    unit: svc.unit,
    minQty: svc.minQty,
    category: svc.category,
    planSatuanStatus: 'belum_tersedia',
    adaKontrakFullManagement: fm[0].n > 0,
    config: cfg,
    gate,
    requiresPlan: eff.requiresPlan,
    perluPenentuan: eff.perluPenentuan,
  };
}

/** previewRecommendation runs Rule 3 against attributes without writing anything. */
export async function previewRecommendation(
  sql: Sql,
  actor: Actor,
  serviceId: string,
  attrs: GateAttributes,
): Promise<Recommendation> {
  const svc = await loadService(sql, serviceId);
  if (!canDecideGate(actor, svc.ownerAm)) {
    throw new ForbiddenError(MSG_GATE_FORBIDDEN);
  }
  const cfg = await activeConfig(sql, todayWib());
  return recommend(normalizeAttrs(attrs), cfg);
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/** The G-B submission. */
export interface GateDecisionInput extends GateAttributes {
  deliverable: string;
  targetNilai?: string | null;
  floorPrice?: unknown | null;
  keputusanAm: GateDecision;
  alasan?: string | null;
  pemantauanAlternatif?: string | null;
  tanggalTinjauUlang: string;
  ringkasanPenugasan?: AssignmentSummary | null;
}

function normalizeAttrs(a: GateAttributes): GateAttributes {
  return {
    ...a,
    divisiTerlibat: dedupeDivisions(a.divisiTerlibat),
    nilaiPerBulan: a.nilaiPerBulan === null ? null : a.nilaiPerBulan.trim(),
  };
}

/**
 * validateDecision enforces the conditional-required matrix (GB-5/GB-6/GB-8)
 * BEFORE anything is written, so the BI message names the missing field rather
 * than surfacing a Postgres CHECK violation. The DB constraints stay as the
 * belt-and-braces half — the TS predicate and the DB check must not diverge
 * (frozen invariant), which is exactly why both exist.
 */
export function validateDecision(input: GateDecisionInput, rekomendasi: GateDecision): GateFit {
  if (input.divisiTerlibat.length === 0) {
    throw new ValidationError(MSG_DIVISION_REQUIRED);
  }
  if (!input.deliverable.trim()) {
    throw new ValidationError(MSG_INCOMPLETE);
  }
  if (!input.tanggalTinjauUlang.trim()) {
    throw new ValidationError(MSG_INCOMPLETE);
  }
  if ((input.targetJenis === null) !== (input.targetNilai == null)) {
    // GA-5 pairs: a KPI kind without a figure (or the reverse) would make the
    // hard trigger fire on an empty target.
    throw new ValidationError(MSG_INCOMPLETE);
  }

  const fit = fitOf(rekomendasi, input.keputusanAm);
  if (fit !== FIT_SESUAI && !(input.alasan ?? '').trim()) {
    throw new ValidationError(MSG_REASON_REQUIRED);
  }
  if (fit === FIT_TOLAK_PLAN && !(input.pemantauanAlternatif ?? '').trim()) {
    throw new ValidationError(MSG_MONITORING_REQUIRED);
  }
  if (input.keputusanAm === DECISION_TANPA_PLAN && !isCompleteSummary(input.ringkasanPenugasan)) {
    throw new ValidationError(MSG_SUMMARY_REQUIRED);
  }
  return fit;
}

/**
 * isCompleteSummary — GB-8 is four fields and all four are load-bearing: a
 * summary missing its deadline or PIC does not make the work findable, which is
 * the only reason the no-Plan path is asked for one.
 */
function isCompleteSummary(s: AssignmentSummary | null | undefined): boolean {
  return !!(
    s &&
    s.deliverable?.trim() &&
    s.deadline?.trim() &&
    s.divisiPic?.trim() &&
    s.hasilDiharapkan?.trim()
  );
}

/**
 * decideGate records the G-B determination for a `ditentukan_am` Service.
 *
 * Rule 4 is the load-bearing part: this NEVER blocks and is never held for
 * approval. A pending approval on this gate would stall delivery for a service
 * that may be two weeks long — so the AM's answer is written, Brief creation
 * unlocks immediately, and the divergence is what gets reported.
 */
export async function decideGate(
  sql: Sql,
  actor: Actor,
  serviceId: string,
  input: GateDecisionInput,
): Promise<Gate> {
  const now = new Date();
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const svc = await loadService(tx, serviceId);
    if (!canDecideGate(actor, svc.ownerAm)) {
      throw new ForbiddenError(MSG_GATE_FORBIDDEN);
    }
    // Rule 1: the two locked tiers have no form. Offering one would invite an
    // AM to "decide" something the catalog already settled.
    if (svc.tier !== TIER_DITENTUKAN_AM) {
      throw new ConflictError(MSG_TIER_LOCKED);
    }
    if (await loadGate(tx, serviceId)) {
      throw new ConflictError(MSG_GATE_EXISTS);
    }

    const cfg = await activeConfig(tx, todayWib());
    const attrs = normalizeAttrs(input);
    const rec = recommend(attrs, cfg);
    const fit = validateDecision({ ...input, ...attrs }, rec.rekomendasi);

    await tx`
      insert into service_plan_gate
        (service_id, tier_katalog, divisi_terlibat, deliverable, kuota_per_periode,
         durasi_bulan, berulang, nilai_per_bulan, target_angka_jenis, target_angka_nilai,
         sequence_dependency, laporan_periodik, floor_price, pemicu_keras, pemicu_lunak,
         config_version_no, rekomendasi, keputusan_am, kesesuaian, alasan,
         pemantauan_alternatif, tanggal_tinjau_ulang, ringkasan_penugasan,
         decided_by, created_by)
      values
        (${serviceId}, ${svc.tier}, ${attrs.divisiTerlibat.join(', ')}, ${input.deliverable.trim()},
         ${attrs.kuotaPerPeriode}, ${attrs.durasiBulan}, ${attrs.berulang}, ${attrs.nilaiPerBulan},
         ${attrs.targetJenis}, ${input.targetNilai ?? null}, ${attrs.sequenceDependency},
         ${attrs.laporanPeriodik}, ${(input.floorPrice ?? null) as never},
         ${rec.pemicuKeras as never}, ${rec.pemicuLunak as never},
         ${cfg.versionNo}, ${rec.rekomendasi}, ${input.keputusanAm}, ${fit},
         ${nullIfBlank(input.alasan)}, ${nullIfBlank(input.pemantauanAlternatif)},
         ${input.tanggalTinjauUlang}, ${summaryToDb(input.ringkasanPenugasan ?? null) as never},
         ${actor.employeeId}, ${actor.employeeId})`;

    // Rule 13: every determination writes to the immutable audit log. The
    // recommendation is recorded alongside the decision — without it, a later
    // reader cannot tell whether the AM agreed or overruled.
    await ex.audit.insertAudit({
      entityType: 'service_plan_gate',
      entityId: serviceId,
      actorEmployeeId: actor.employeeId,
      action: 'decide',
      beforeJson: null,
      afterJson: {
        tier: svc.tier,
        rekomendasi: rec.rekomendasi,
        keputusan_am: input.keputusanAm,
        kesesuaian: fit,
        pemicu_keras: rec.pemicuKeras.map((t) => t.kode),
        pemicu_lunak: rec.pemicuLunak.map((t) => t.kode),
        config_version_no: cfg.versionNo,
        alasan: nullIfBlank(input.alasan),
      },
      createdBy: actor.employeeId,
    });

    const saved = await loadGate(tx, serviceId);
    if (!saved) throw new ConflictError(MSG_GATE_MISSING);
    void now;
    return saved;
  });
}

/**
 * redecideGate handles Rules 11 and 12 — the two directions a recorded decision
 * can later change, which are deliberately NOT symmetric:
 *
 *   - **Escalation** (`tanpa_plan` → `butuh_plan`): always available, to the AM,
 *     on their own initiative or a division's. Forward-only — rows are created
 *     from the escalation date onward and past work is not backfilled, which is
 *     why nothing here rewrites history.
 *   - **De-escalation** (`butuh_plan` → `tanpa_plan`): SPV/Head Account only.
 *     This is the action that erases an accountability record, so it is the one
 *     direction that needs a gate (Rule 12).
 */
export async function redecideGate(
  sql: Sql,
  actor: Actor,
  serviceId: string,
  keputusan: GateDecision,
  alasan: string,
  ringkasanPenugasan?: AssignmentSummary | null,
): Promise<Gate> {
  const reason = alasan.trim();
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const svc = await loadService(tx, serviceId);
    const existing = await loadGate(tx, serviceId);
    if (!existing) {
      throw new ConflictError(MSG_GATE_MISSING);
    }
    if (existing.keputusanAm === keputusan) {
      throw new ConflictError(MSG_SAME_DECISION);
    }
    if (!reason) {
      throw new ValidationError(MSG_ESCALATION_REASON_REQUIRED);
    }

    const deescalating = keputusan === DECISION_TANPA_PLAN;
    if (deescalating) {
      if (!canApproveDeescalation(actor)) {
        throw new ForbiddenError(MSG_DEESCALATION_FORBIDDEN);
      }
    } else if (!canDecideGate(actor, svc.ownerAm)) {
      throw new ForbiddenError(MSG_GATE_FORBIDDEN);
    }

    // Turning a Plan off puts the service on the no-Plan path, and GB-8 is what
    // keeps that work visible on the AM's workload view (M6C §11 GA-3). So a
    // de-escalation needs the same four-field summary a first-pass `Tanpa Plan`
    // decision does — carried over if the row already had one.
    const ringkasan = deescalating
      ? (ringkasanPenugasan ?? existing.ringkasanPenugasan)
      : existing.ringkasanPenugasan;
    if (deescalating && !isCompleteSummary(ringkasan)) {
      throw new ValidationError(MSG_SUMMARY_REQUIRED);
    }

    // `kesesuaian` is re-derived against the ORIGINAL recommendation: the stored
    // triggers are never recomputed (§10), so an escalation that ends up
    // agreeing with the original recommendation correctly reads `sesuai` again.
    const fit = fitOf(existing.rekomendasi, keputusan);
    // A de-escalation always diverges from a `butuh_plan` recommendation, so
    // GB-6's alternative-monitoring answer is required for it too — the reason
    // field alone would let "turn the Plan off" pass with one line.
    const pemantauan =
      fit === FIT_TOLAK_PLAN ? (existing.pemantauanAlternatif ?? reason) : existing.pemantauanAlternatif;

    await tx`
      update service_plan_gate
         set keputusan_am = ${keputusan}, kesesuaian = ${fit},
             alasan = ${fit === FIT_SESUAI ? existing.alasan : reason},
             pemantauan_alternatif = ${pemantauan},
             ringkasan_penugasan = ${summaryToDb(ringkasan ?? null) as never},
             decided_by = ${actor.employeeId}, decided_at = now()
       where service_id = ${serviceId}`;

    await ex.audit.insertAudit({
      entityType: 'service_plan_gate',
      entityId: serviceId,
      actorEmployeeId: actor.employeeId,
      action: deescalating ? 'deescalate' : 'escalate',
      beforeJson: { keputusan_am: existing.keputusanAm, kesesuaian: existing.kesesuaian },
      afterJson: { keputusan_am: keputusan, kesesuaian: fit, alasan: reason },
      createdBy: actor.employeeId,
    });

    const saved = await loadGate(tx, serviceId);
    if (!saved) throw new ConflictError(MSG_GATE_MISSING);
    return saved;
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function splitDivisions(csv: string): string[] {
  return csv
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function nullIfBlank(s: string | null | undefined): string | null {
  const t = (s ?? '').trim();
  return t === '' ? null : t;
}

function dateStr(v: string | Date): string {
  return v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
}

/** todayWib is the WIB calendar date, the single offset source (WIB_OFFSET_HOURS=7). */
function todayWib(): string {
  return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}
