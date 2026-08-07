/**
 * Module 6C — the PURE half: vocabulary, the recommendation engine (Rule 3), and
 * the effective-gate resolution the rest of Module 6 obeys.
 *
 * Split out from `plangate.ts` for one structural reason: `account.ts`
 * (guardBriefCreation, the Service read) must consult `effectiveGate`, while
 * `plangate.ts` needs `account.ts`'s error classes so the API error mapping in
 * apps/api/src/lib/http.ts keeps working unchanged. Putting the predicate here
 * breaks that cycle instead of duplicating the rule in two places — and a rule
 * about "is this service Plan-gated" that exists twice is exactly the bug class
 * this module was written to prevent.
 *
 * Everything here is pure: no SQL, no actor, no clock. That is what makes the
 * trigger table unit-testable against the PRD's own worked examples (§9).
 *
 * Reference: docs/prd/CDPS_Module6C_Plan_Gate_Satuan.md §5 Rule 3, §10.
 */

import { money } from '@cdps/core';

// ---------------------------------------------------------------------------
// Vocabulary (M6C S4 / §6). Labels stay Bahasa Indonesia; the stored values are
// the snake_case enum members the DB CHECK constraints accept.
// ---------------------------------------------------------------------------

/** Catalog tier: locked on. Full Store Management, retainer paket lengkap. */
export const TIER_PLAN_WAJIB = 'plan_wajib';
/** Catalog tier: the middle — the AM decides via the G-B form. */
export const TIER_DITENTUKAN_AM = 'ditentukan_am';
/** Catalog tier: locked off — but escalatable later (Rule 11). */
export const TIER_TANPA_PLAN = 'tanpa_plan';

export type PlanTier =
  | typeof TIER_PLAN_WAJIB
  | typeof TIER_DITENTUKAN_AM
  | typeof TIER_TANPA_PLAN;

export const DECISION_BUTUH_PLAN = 'butuh_plan';
export const DECISION_TANPA_PLAN = 'tanpa_plan';
export type GateDecision = typeof DECISION_BUTUH_PLAN | typeof DECISION_TANPA_PLAN;

export const FIT_SESUAI = 'sesuai';
export const FIT_TOLAK_PLAN = 'tolak_plan';
export const FIT_TAMBAH_PLAN = 'tambah_plan';
export type GateFit = typeof FIT_SESUAI | typeof FIT_TOLAK_PLAN | typeof FIT_TAMBAH_PLAN;

/** GA-5 numeric KPI kinds. A deliverable count is NOT one of these (§4a). */
export type TargetKind = 'gmv' | 'roas' | 'growth';

// ---------------------------------------------------------------------------
// Verbatim BI messages. Same convention as account.ts: exact strings in [...],
// one per rejection reason (CLAUDE.md #5).
// ---------------------------------------------------------------------------

/** Default house message for a form submitted with required fields missing. */
export const MSG_INCOMPLETE = '[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]';
/** Service does not exist, or the actor may not see it. */
export const MSG_SERVICE_NOT_FOUND = '[layanan tidak ditemukan]';
/** Only the owning AM, the Account lead/SPV, or a Director may run the gate. */
export const MSG_GATE_FORBIDDEN =
  '[anda tidak memiliki akses untuk menentukan kebutuhan Plan layanan ini]';
/** Rule 1: the two locked tiers have no form — the catalog already decided. */
export const MSG_TIER_LOCKED =
  '[tier katalog layanan ini sudah menentukan kebutuhan Plan, tidak ada penentuan manual]';
/** A determination already exists (PK service_id) — this is an escalation now. */
export const MSG_GATE_EXISTS = '[penentuan kebutuhan Plan untuk layanan ini sudah ada]';
/** Re-deciding requires a prior determination. */
export const MSG_GATE_MISSING = '[layanan ini belum memiliki penentuan kebutuhan Plan]';
/** GB-5: diverging from the recommendation requires a written reason. */
export const MSG_REASON_REQUIRED =
  '[alasan wajib diisi karena keputusan berbeda dari rekomendasi sistem]';
/** GB-6: declining a recommended Plan requires an alternative monitoring method. */
export const MSG_MONITORING_REQUIRED =
  '[cara pemantauan alternatif wajib diisi jika Plan yang direkomendasikan ditolak]';
/** GB-8: the no-Plan path still needs its four-field assignment summary. */
export const MSG_SUMMARY_REQUIRED =
  '[ringkasan penugasan wajib diisi untuk jalur tanpa Plan]';
/** Rule 12: turning a Plan off mid-service is the one direction that needs SPV. */
export const MSG_DEESCALATION_FORBIDDEN =
  '[hanya SPV/Head Account yang dapat mematikan Plan pada layanan yang sedang jalan]';
/** Re-deciding to the same value is a no-op, not an escalation. */
export const MSG_SAME_DECISION = '[keputusan sama dengan yang sekarang]';
/** Rule 11: escalation is forward-only; a reason names what changed. */
export const MSG_ESCALATION_REASON_REQUIRED = '[alasan eskalasi wajib diisi]';
/** Rule 1: `ditentukan_am` blocks Brief creation until the form is answered. */
export const MSG_DETERMINATION_REQUIRED =
  '[penentuan kebutuhan Plan wajib diselesaikan sebelum Brief dapat dibuat]';
/** GA-3: at least one executing division must be confirmed. */
export const MSG_DIVISION_REQUIRED = '[divisi terlibat wajib dipilih minimal satu]';

// ---------------------------------------------------------------------------
// The recommendation engine (Rule 3) — pure, so it is unit-testable without a
// database and cannot silently depend on request context.
// ---------------------------------------------------------------------------

/** Threshold set in force for one determination (`plan_gate_config`). */
export interface GateConfig {
  versionNo: number;
  kuotaThreshold: number;
  /** Rupiah-decimal string, e.g. '15000000.00'. Compared via money.parse. */
  nilaiThreshold: string;
  durasiThresholdBulan: number;
  notifJoinThreshold: string;
}

/** The deal attributes the recommendation reads (G-A). */
export interface GateAttributes {
  /** GA-2: service duration in months. Null = unknown, treated as not > threshold. */
  durasiBulan: number | null;
  /** GA-2: recurring / retainer scheme. */
  berulang: boolean;
  /** GA-3: divisions that execute this service. */
  divisiTerlibat: string[];
  /** GA-5: numeric performance KPI, if the contract carries one. */
  targetJenis: TargetKind | null;
  /** GA-4: deliverable quota per period. */
  kuotaPerPeriode: number | null;
  /** Service value per month, rupiah-decimal string. */
  nilaiPerBulan: string | null;
  /** Work items have sequence dependencies (B cannot start before A). */
  sequenceDependency: boolean;
  /** Client is owed a periodic report or has an SLA. */
  laporanPeriodik: boolean;
}

/** One trigger that fired, with the value that fired it (§10: stored, not recomputed). */
export interface Trigger {
  kode: string;
  label: string;
  dasar: string;
}

/** The computed recommendation plus the evidence behind it (GB-1/GB-2). */
export interface Recommendation {
  pemicuKeras: Trigger[];
  pemicuLunak: Trigger[];
  rekomendasi: GateDecision;
  ringkasan: string;
}

/**
 * recommend applies Rule 3: any ONE hard trigger recommends a Plan; failing
 * that, TWO OR MORE soft triggers do; otherwise no Plan.
 *
 * Every fired trigger carries `dasar` — the actual number that fired it — because
 * GB-1 shows the AM "daftar hard & soft trigger yang menyala + dasar angkanya".
 * A recommendation the AM cannot audit is a black box, and §12 measures how often
 * they overrule it.
 */
export function recommend(attrs: GateAttributes, cfg: GateConfig): Recommendation {
  const keras: Trigger[] = [];
  const lunak: Trigger[] = [];

  // Hard 1 — duration beyond the threshold, or a recurring/retainer scheme.
  if (attrs.berulang) {
    keras.push({
      kode: 'durasi_atau_berulang',
      label: 'Skema berulang / retainer',
      dasar: 'service berulang (retainer)',
    });
  } else if (attrs.durasiBulan !== null && attrs.durasiBulan > cfg.durasiThresholdBulan) {
    keras.push({
      kode: 'durasi_atau_berulang',
      label: 'Durasi service lebih dari ambang',
      dasar: `durasi ${attrs.durasiBulan} bulan > ambang ${cfg.durasiThresholdBulan} bulan`,
    });
  }

  // Hard 2 — execution spans more than one division.
  const divisi = dedupeDivisions(attrs.divisiTerlibat);
  if (divisi.length > 1) {
    keras.push({
      kode: 'lintas_divisi',
      label: 'Eksekusi lintas divisi',
      dasar: `${divisi.length} divisi: ${divisi.join(', ')}`,
    });
  }

  // Hard 3 — a numeric performance target, not merely a deliverable count.
  if (attrs.targetJenis !== null) {
    keras.push({
      kode: 'target_numerik',
      label: 'Kontrak membawa target angka',
      dasar: `target ${attrs.targetJenis.toUpperCase()}`,
    });
  }

  // Soft 1 — deliverable quota above the per-division threshold.
  if (attrs.kuotaPerPeriode !== null && attrs.kuotaPerPeriode > cfg.kuotaThreshold) {
    lunak.push({
      kode: 'kuota_besar',
      label: 'Kuota deliverable di atas ambang',
      dasar: `${attrs.kuotaPerPeriode} item/bulan > ambang ${cfg.kuotaThreshold}`,
    });
  }

  // Soft 2 — service value at or above the threshold. "At or above" per Rule 3
  // ("service value AT or above the threshold"), so this is >=, not >, unlike
  // the quota trigger above ("quota ABOVE the threshold"). The asymmetry is the
  // PRD's, and it is load-bearing at exactly Rp 15jt.
  if (attrs.nilaiPerBulan !== null) {
    const nilai = money.parse(attrs.nilaiPerBulan);
    const ambang = money.parse(cfg.nilaiThreshold);
    if (nilai >= ambang) {
      lunak.push({
        kode: 'nilai_besar',
        label: 'Nilai service di atas/sama dengan ambang',
        dasar: `${money.format(nilai)} >= ambang ${money.format(ambang)}`,
      });
    }
  }

  // Soft 3 — sequence dependencies between work items.
  if (attrs.sequenceDependency) {
    lunak.push({
      kode: 'urutan_kerja',
      label: 'Ada ketergantungan urutan kerja',
      dasar: 'item kerja berurutan (B tidak bisa mulai sebelum A)',
    });
  }

  // Soft 4 — the client is owed a periodic report or has an SLA.
  if (attrs.laporanPeriodik) {
    lunak.push({
      kode: 'laporan_atau_sla',
      label: 'Klien punya laporan periodik / SLA',
      dasar: 'laporan periodik atau SLA disepakati',
    });
  }

  const rekomendasi: GateDecision =
    keras.length >= 1 || lunak.length >= 2 ? DECISION_BUTUH_PLAN : DECISION_TANPA_PLAN;

  return { pemicuKeras: keras, pemicuLunak: lunak, rekomendasi, ringkasan: summarize(keras, lunak, rekomendasi) };
}

function summarize(keras: Trigger[], lunak: Trigger[], rekomendasi: GateDecision): string {
  if (rekomendasi === DECISION_TANPA_PLAN) {
    return `Nol pemicu keras dan ${lunak.length} pemicu lunak (butuh 2) — Plan tidak direkomendasikan.`;
  }
  if (keras.length >= 1) {
    return `${keras.length} pemicu keras menyala (${keras.map((t) => t.label).join('; ')}) — satu saja sudah cukup merekomendasikan Plan.`;
  }
  return `${lunak.length} pemicu lunak menyala (${lunak.map((t) => t.label).join('; ')}) — dua atau lebih merekomendasikan Plan.`;
}

/** fitOf derives GB-4 from (recommendation, decision). Mirrors ck_spg_kesesuaian_derived. */
export function fitOf(rekomendasi: GateDecision, keputusan: GateDecision): GateFit {
  if (rekomendasi === keputusan) return FIT_SESUAI;
  return rekomendasi === DECISION_BUTUH_PLAN ? FIT_TOLAK_PLAN : FIT_TAMBAH_PLAN;
}

/**
 * effectiveGate resolves what the rest of M6 must obey, in precedence order:
 *
 *   1. the M6-OA-1 per-engagement override, when set — an explicit, logged,
 *      SPV/AM decision that predates M6C and is still live in production;
 *   2. the recorded G-B decision, when there is one — this is what makes
 *      escalation (Rule 11) work on a `tanpa_plan` service;
 *   3. the catalog tier.
 *
 * `perluPenentuan` is separate on purpose: a `ditentukan_am` service with no
 * decision yet is not "Direct", it is UNANSWERED, and Rule 1 blocks Brief
 * creation until the form is filled. Collapsing the two would silently let the
 * middle tier default to no-Plan — the exact failure §1 is written against.
 *
 * This function is the TS half of a frozen invariant: it must agree with
 * `ck_msv_tier_matches_flag` / `ck_services_tier_matches_flag` in
 * supabase/migrations/20260806061000_m6c_plan_gate.sql.
 */
export function effectiveGate(input: {
  tier: PlanTier;
  override: boolean | null;
  keputusanAm: GateDecision | null;
}): { requiresPlan: boolean; perluPenentuan: boolean } {
  if (input.override !== null) {
    return { requiresPlan: input.override, perluPenentuan: false };
  }
  if (input.keputusanAm !== null) {
    return { requiresPlan: input.keputusanAm === DECISION_BUTUH_PLAN, perluPenentuan: false };
  }
  if (input.tier === TIER_PLAN_WAJIB) {
    return { requiresPlan: true, perluPenentuan: false };
  }
  return { requiresPlan: false, perluPenentuan: input.tier === TIER_DITENTUKAN_AM };
}


/**
 * dedupeDivisions trims, drops blanks, and removes duplicates while preserving
 * order. Hard trigger 2 counts DISTINCT divisions, so ['Ads','Ads'] must not
 * read as "spans more than one division" — that would fire the strongest trigger
 * in the table on a typo.
 */
export function dedupeDivisions(xs: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of xs) {
    const t = x.trim();
    if (t && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}
