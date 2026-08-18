/**
 * Module 6A — the `STRG-` Strategi entity (backlog A-03 + A-04).
 *
 * This is the skeleton the Section A→J form is built on: the record, its child
 * tables, and machine #15. The per-section FIELDS (A-05…A-09) attach to these
 * tables; they do not replace them.
 *
 * ===========================================================================
 * What this module refuses to do, and why
 * ===========================================================================
 *
 * **It does not unlock Brief dispatch yet.** M6A §5.7 says approval unlocks
 * Brief dispatch for the Service, and it will — but the gate that guards Briefs
 * today (`account.guardBriefCreation`) reads the OLD M6 §4 entity
 * (`strategy_plans`, `STR-`), which is what the Service page still writes. Making
 * `STRG` approval drive the Service status now would create two independent ways
 * to open the same gate while the old form is still the only UI, and "two doors,
 * one lock" is exactly the class of defect this codebase keeps paying for. The
 * swap happens with the form (A-05…A-09). Until then a `STRG` record is complete
 * and audited but inert with respect to the Brief gate — stated here rather than
 * discovered later.
 *
 * **It emits no notifications.** The four M6A events (`strategi_diajukan`,
 * `strategi_disetujui`, `strategi_dikembalikan`, `strategi_revisi_disarankan`)
 * belong to the v2 catalog amendment, which is a frozen invariant still waiting
 * on sign-off (M6A RA-1 / M6B PA-8 / M6C GA-8 — DECISIONS O55). Every transition
 * is still recorded in `audit_log` by `sm_transition`; only the ping is missing.
 *
 * **It never writes a status column.** Machine #15 lives in the migration and
 * runs inside `sm_transition` (CLAUDE.md #2).
 *
 * ===========================================================================
 * Two shapes worth knowing before reading the code
 * ===========================================================================
 *
 * 1. **A version is a row, not a counter** (Rule 13). Version n stays `Aktif`
 *    while n+1 sits in `Draft Revisi`; one row cannot hold two statuses. So
 *    `openRevision` INSERTs a new row, copies the children, and only
 *    `approveStrategi` archives the predecessor.
 *
 * 2. **Returning lands where it came from** (Rule 12, "keeps its version
 *    number"). `sm_edges` cannot see whether a `Diajukan` arrived from `Draft`
 *    or `Draft Revisi`, so both edges are registered and this module picks the
 *    target from `versi_no`.
 *
 * Reference: docs/prd/CDPS_Module6A_Strategi.md.
 */

import { ident, interview as iv, money, notification, permission, statemachine, visibility } from '@cdps/core';
import { executors, withTransaction, type Queryable, type Sql, type TransactionSql } from '@cdps/db';
import {
  ACCOUNT_DIVISION,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  type Actor,
} from './account';
import * as contract from './contract';
import { getInterview, listInterviewsByClient, type Answer, type InterviewListRow } from './interview';
import { generatePlanPeriods } from './plan';
import { effectiveGate, type PlanTier } from './plangate_rules';
import { createHash, randomBytes } from 'node:crypto';

// ---------------------------------------------------------------------------
// Vocabulary — mirrors the CHECK constraints in
// supabase/migrations/20260806064000_m6a_strategi.sql.
// ---------------------------------------------------------------------------

export const STRATEGI_DRAFT = 'Draft';
export const STRATEGI_DIAJUKAN = 'Diajukan';
export const STRATEGI_AKTIF = 'Aktif';
export const STRATEGI_DRAFT_REVISI = 'Draft Revisi';
export const STRATEGI_KEDALUWARSA = 'Kedaluwarsa';
export const STRATEGI_DIARSIPKAN = 'Diarsipkan';

/**
 * Statuses of a version that is already history — immutable and still readable
 * (Rule 13). A write against one of these is refused by every endpoint reachable
 * after `Aktif`: `setFieldVisibility` (rewriting what a client already saw) and
 * `setAssumptionStatus` (X-17 — a flip on an archived version would fire
 * `strategi_revisi_disarankan`, a "please revise" about a version that has
 * already been superseded, a message with no correct action for its recipient).
 */
export const VERSI_HISTORIS_STATUS: readonly string[] = [
  STRATEGI_DIARSIPKAN,
  STRATEGI_KEDALUWARSA,
];

/** D1 — the contracted channel scope. */
export const CHANNELS = [
  'Shopee',
  'TikTok Shop',
  'Tokopedia',
  'Lazada',
  'Website',
  'Lainnya',
] as const;
export type Channel = (typeof CHANNELS)[number];

/** B-0.2 — `Belum Aktif` skips the historical baseline (Rule 4). */
export const CHANNEL_STATES = ['Eksisting', 'Belum Aktif'] as const;
export type ChannelState = (typeof CHANNEL_STATES)[number];

/**
 * `sumber_floor` — the floor's APPROVAL PATH (O57 item (b)), not its origin.
 *
 * The pre-O57 pair was `kontrak | input_am`, a quality signal invented because
 * CDPS had no Contract to pull a floor from. The owner decision keeps the floor
 * an AM input and puts a Head approval behind it, so what the column has to
 * record is who has signed off — which is also what makes Rule 7's "read-only"
 * enforceable: read-only AFTER `disetujui_head`, frozen by a DB trigger.
 */
export const FLOOR_INPUT_AM = 'input_am';
export const FLOOR_DISETUJUI_HEAD = 'disetujui_head';
export const FLOOR_SOURCES = [FLOOR_INPUT_AM, FLOOR_DISETUJUI_HEAD] as const;
export type FloorSource = (typeof FLOOR_SOURCES)[number];

/** D-2 / D-4 metrics. `gmv` is the one the floor/stretch rule applies to. */
export const TARGET_METRICS = [
  'gmv',
  'pengunjung',
  'cr',
  'aov',
  'roas_min',
  'acos_maks',
  'sku_winner',
  'affiliate_aktif',
  'jam_live',
  'jumlah_video',
] as const;
export type TargetMetric = (typeof TARGET_METRICS)[number];

/** Section E pillars; `tidak_dikerjakan` is E-11 (Rule 9). */
export const PILLAR_KINDS = [
  'sku',
  'harga',
  'iklan',
  'konten',
  'affiliate',
  'live',
  'retensi',
  'operasional',
  'tidak_dikerjakan',
] as const;
export type PillarKind = (typeof PILLAR_KINDS)[number];

/** Section F commitment rows. */
export const RESOURCE_KINDS = [
  'budget_iklan',
  'konten',
  'kol',
  'live_vendor',
  'divisi',
  'tools',
] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];

export const ASSUMPTION_STATES = ['Berlaku', 'Gugur', 'Terverifikasi'] as const;
export type AssumptionState = (typeof ASSUMPTION_STATES)[number];

/**
 * D-6 — the closed set a weekly leading indicator may be drawn from, and the cap.
 *
 * §4 says only "Multi-enum (maks 5)" — it never writes the list. Rather than coin
 * a vocabulary (house rule: never invent), this IS `TARGET_METRICS`, the metric
 * vocabulary the PRD spells out itself in D-4. Mirrored by
 * `ck_strategi_leading_indicator` via jsonb containment; if either list is ever
 * widened, both move in the same commit. Open question **X-13**.
 */
export const LEADING_INDICATORS = TARGET_METRICS;
export type LeadingIndicator = TargetMetric;
export const LEADING_INDICATOR_MAX = 5;

/** D-5 — the three fixed horizons. Fixed cardinality is why D-5 is columns. */
export const DEFINISI_BERHASIL_HORIZONS = [30, 60, 90] as const;

// ---------------------------------------------------------------------------
// Section E/G/H/I closed sets (A-09b)
// ---------------------------------------------------------------------------

/** E-2 — a channel's role. The three values are written by §4 E-2 itself. */
export const CHANNEL_PRIORITAS = ['engine_utama', 'pendukung', 'maintenance'] as const;
export type ChannelPrioritas = (typeof CHANNEL_PRIORITAS)[number];

/**
 * H-2 — the revision triggers, transcribed from §4 H-2 (which does write its
 * own list, unlike D-6 and I-3).
 *
 * **This is also the J-3 list.** `strategi_version.trigger_revisi` accepted any
 * string until A-09b, because Rule 13's "a trigger from the enumerated list"
 * had no enumerated list to point at. Keeping J-3 open now that H-2 exists would
 * be two lists for one thing — the O48/O51 defect class. Mirrored by
 * `ck_strtrg_kode` and `ck_strver_trigger_set`; widening one moves both.
 */
export const TRIGGER_REVISI_CODES = [
  'pencapaian_di_bawah_target',
  'klien_ubah_lini_produk',
  'stok_kosong',
  'budget_iklan_dipotong',
  'kebijakan_platform_berubah',
  'ganti_pic_klien',
  'lainnya',
] as const;
export type TriggerRevisiCode = (typeof TRIGGER_REVISI_CODES)[number];

/**
 * The two codes §4 writes with an "X" are the two that carry a threshold, and
 * the DB enforces the equivalence in both directions (`ck_strtrg_ambang`): a
 * threshold is required for these and forbidden for the rest, so "stok kosong
 * >30 hari" cannot be stored as "ganti PIC klien >30".
 */
export const TRIGGER_REVISI_BERAMBANG: readonly TriggerRevisiCode[] = [
  'pencapaian_di_bawah_target',
  'stok_kosong',
] as const;

/**
 * I-3 — metrics pulled into the monthly client report.
 *
 * Same situation as D-6/X-13: §4 marks it "Multi-enum" and never writes the
 * list, so this IS `TARGET_METRICS` rather than a coined vocabulary.
 *
 * **X-14 answered 2026-08-08 (owner): the monthly client report is produced by
 * an HTML generator, most of its metrics are not in CDPS yet, and it is
 * scheduled AFTER Strategi and Plan.** So this set is deliberately the subset
 * CDPS can supply today, not the report's full column list — and it is expected
 * to widen when the generator lands.
 *
 * Two boundaries that hold until then:
 * 1. I-3 must NOT be read as "everything the client report contains". It is
 *    what the Strategi commits to feeding it.
 * 2. When I-3 widens, **D-4 and D-6 do not follow.** This is the one legitimate
 *    divergence among the three; the test that pins them together names its own
 *    exit so nobody widens the wrong list to make it pass.
 */
export const LAPORAN_METRICS = TARGET_METRICS;
export type LaporanMetric = TargetMetric;

/**
 * I-2 — the divisions that can receive a Brief.
 *
 * Identical to `briefs.assigned_division` / `ALLOWED_DIVISIONS`, and that is the
 * point: I-2 asks which divisions receive Briefs, so a second list would let a
 * Strategi dispatch to a division that has no Brief board. `Live Stream` is
 * included even though Rule 18 keeps hosting with a vendor — the as-built brief
 * table carries Live Stream briefs (they skip the task machine and end at a
 * vendor tracker), so the dispatch order has to be able to name it.
 */
export const DISPATCH_DIVISIONS = ['Creative', 'Ads', 'KOL', 'Live Stream'] as const;
export type DispatchDivision = (typeof DISPATCH_DIVISIONS)[number];

/** G-1 — §4 says "Repeatable struct (min 2)". One phase is not a calendar. */
export const FASE_MIN = 2;

/**
 * D-7 sends its notification to SPV Account **and Head of Sales** — the second
 * division named anywhere in M6A. Spelled as a constant here rather than inline
 * because `role_mappings.division` is the string it has to match exactly.
 */
export const SALES_DIVISION = 'Sales';

export const RISK_LEVELS = ['rendah', 'sedang', 'tinggi'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

// --- Section A vocabulary (A-05). Every list below mirrors a CHECK in
// supabase/migrations/20260806065000_m6a_section_a.sql. ---

/** A-2 — produsen / brand owner / distributor / reseller. */
export const BUSINESS_MODELS = ['produsen', 'brand_owner', 'distributor', 'reseller'] as const;
export type BusinessModel = (typeof BUSINESS_MODELS)[number];

/** A-4 — price position vs competitors. */
export const PRICE_POSITIONS = ['premium', 'mid', 'budget', 'price_fighter'] as const;
export type PricePosition = (typeof PRICE_POSITIONS)[number];

/** A-6 — ready stock or made per order. */
export const STOCK_CAPACITIES = ['ready_stock', 'produksi_per_order'] as const;
export type StockCapacity = (typeof STOCK_CAPACITIES)[number];

/** A-14 — closed checkbox taxonomy of what the client supplies. */
export const CLIENT_ASSETS = [
  'foto_produk',
  'video',
  'sampel',
  'katalog',
  'budget_iklan',
  'host_live',
] as const;
export type ClientAsset = (typeof CLIENT_ASSETS)[number];

/** A-5 — "3 alasan utama orang beli produk ini". The minimum is the point. */
export const USP_MIN = 3;

// --- A-15 / A-16 access matrix ---

/** A-15 — the five accesses. `gudang_stok` is why `Umum` exists below. */
export const ACCESS_KINDS = [
  'seller_center',
  'ads_manager',
  'affiliate_center',
  'akun_chat',
  'gudang_stok',
] as const;
export type AccessKind = (typeof ACCESS_KINDS)[number];

export const ACCESS_STATES = ['sudah', 'pending', 'ditolak'] as const;
export type AccessState = (typeof ACCESS_STATES)[number];

/**
 * The matrix's channel axis: the contracted channels plus `Umum`.
 *
 * `Umum` is not a channel — it is where an access that belongs to no channel
 * (warehouse/stock) is recorded. Without it that row has to be filed under an
 * invented channel, and the matrix then misstates what is actually blocked.
 */
export const ACCESS_CHANNEL_UMUM = 'Umum';
export const ACCESS_CHANNELS = [...CHANNELS, ACCESS_CHANNEL_UMUM] as const;
export type AccessChannel = (typeof ACCESS_CHANNELS)[number];

// --- Section B vocabulary (A-06) ---

/** B-2.4 — biggest entry point (optional field). */
export const ENTRY_POINTS = ['search', 'feed', 'live', 'keranjang', 'chat'] as const;
export type EntryPoint = (typeof ENTRY_POINTS)[number];

/** B-6.5 — who pays for the sampling/seeding programme. */
export const SAMPLE_PROGRAMS = ['tidak_ada', 'klien', 'mea', 'kreator'] as const;
export type SampleProgram = (typeof SAMPLE_PROGRAMS)[number];

/** B-7.3 — who hosts the live sessions today. */
export const LIVE_HOSTS = ['internal_klien', 'vendor', 'tim_mea', 'belum_ada'] as const;
export type LiveHost = (typeof LIVE_HOSTS)[number];

/** B-7.4 — studio & equipment availability. */
export const STUDIO_STATES = ['tersedia', 'sebagian', 'tidak_ada'] as const;
export type StudioState = (typeof STUDIO_STATES)[number];

/** B-5.3 — campaign types running on the channel. */
export const CAMPAIGN_TYPES = [
  'gmv_max',
  'manual_keyword',
  'auto',
  'live_ads',
  'video_ads',
  'affiliate_ads',
  'lainnya',
] as const;
export type CampaignType = (typeof CAMPAIGN_TYPES)[number];

/** B-8.2 — platform programmes the store joined. */
export const PLATFORM_PROGRAMS = [
  'gratis_ongkir_xtra',
  'cashback',
  'campaign_seasonal',
  'flash_sale',
  'voucher_platform',
  'lainnya',
] as const;
export type PlatformProgram = (typeof PLATFORM_PROGRAMS)[number];

/** B-9.2 — what competitors do better. */
export const COMPETITOR_EDGES = [
  'harga',
  'konten',
  'ulasan',
  'iklan',
  'live',
  'bundling',
] as const;
export type CompetitorEdge = (typeof COMPETITOR_EDGES)[number];

/**
 * B-3.3 / B-9.1 caps.
 *
 * The PRD writes "Top 5 SKU … Repeatable struct (5)" and "Top 3 toko kompetitor
 * … (3)". Read as a MAXIMUM, not an exact count: a store with four active SKUs
 * cannot name five, and a form that refuses to submit until it does teaches the
 * AM to invent rows — which is worse than a shorter honest list. At least one is
 * required (see `checkCompleteness`); more than the cap is refused.
 */
export const TOP_SKU_MAX = 5;
export const KOMPETITOR_MAX = 3;

/**
 * B-1.5 — the band inside which a baseline trend counts as `stabil`.
 *
 * Not arbitrary: M6A §6 calls Alpha Digital's Shopee baseline (Rp 180jt → 165jt →
 * 172jt, a 4,4% spread) **"flat"**, so the PRD's own worked example has to come
 * out `stabil` — which a band narrower than that would not do.
 */
export const TREN_STABIL_BAND_PERSEN = 5;
export const TREN_STATES = ['naik', 'stabil', 'turun'] as const;
export type TrenState = (typeof TREN_STATES)[number];

const MACHINE_STRATEGI = 'strategi';
const ENTITY_STRATEGI = 'strategi';

// --- BI messages. M6A's body is English and specifies no error strings, so
// these follow CLAUDE.md #5 and the M6C precedent. ---

export const MSG_INCOMPLETE = '[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]';
export const MSG_STRATEGI_NOT_FOUND = '[Strategi tidak ditemukan]';
export const MSG_SERVICE_NOT_FOUND = '[layanan tidak ditemukan]';
/** Only the owning AM (or a Director) may author a Strategi (§7 permissions). */
export const MSG_NOT_OWNER_AM =
  '[hanya Account Manager pemilik klien yang dapat mengisi Strategi layanan ini]';
/** Read gate: owning AM, Account lead/SPV, OD/Direksi. */
export const MSG_STRATEGI_FORBIDDEN = '[anda tidak memiliki akses ke Strategi ini]';
/** Approve / return is SPV / Head of Account authority (Rule 12). */
export const MSG_APPROVE_FORBIDDEN =
  '[anda tidak memiliki akses untuk menyetujui atau mengembalikan Strategi]';
/** M6A Rule 1: only a plan-gated Service has a Strategi. */
export const MSG_NOT_PLAN_GATED = '[layanan ini tidak memerlukan Strategi]';
/** Rule 2 + the in-flight partial index. */
export const MSG_STRATEGI_EXISTS = '[Strategi untuk layanan ini sudah ada]';
/** Edits are Draft-only (§7 permissions: AM writes A–I on Draft / Draft Revisi). */
export const MSG_NOT_DRAFT = '[Strategi hanya dapat diubah saat berstatus Draft atau Draft Revisi]';
/** Rule 12 — returning requires a written note. */
export const MSG_REVIEW_NOTES_REQUIRED = '[catatan reviewer wajib diisi saat mengembalikan Strategi]';
/** Rule 13 (a)(b)(c) — a revision must declare trigger, reason and broken assumptions. */
export const MSG_REVISION_INCOMPLETE =
  '[revisi wajib menyebutkan trigger, alasan, dan asumsi yang gugur]';
/** Rule 13 — only an active version can be revised. */
export const MSG_REVISION_NOT_ACTIVE = '[hanya Strategi berstatus Aktif yang dapat direvisi]';
/** Rule 3 — no submit without at least one contracted channel block. */
export const MSG_NO_CHANNEL = '[minimal satu channel wajib diisi sebelum Strategi diajukan]';
/** Rule 5 — an `Eksisting` channel is missing baseline months. */
export const MSG_BASELINE_INCOMPLETE =
  '[baseline bulanan belum lengkap untuk seluruh periode yang dideklarasikan]';
/** D-2 — no GMV stretch target for a contracted channel. */
export const MSG_TARGET_MISSING = '[target GMV per bulan wajib diisi untuk setiap channel]';
/**
 * D-4 — no supporting-metric target at all for a contracted channel (X-15).
 *
 * Says "minimal satu" out loud because that IS the rule: the owner's decision
 * gates the QUESTION, not the full matrix. A message reading "target metrik
 * pendukung wajib diisi" would leave the AM guessing whether nine metrics × n
 * months are expected, and guessing upward is how a required field turns into a
 * column of copied numbers.
 */
export const MSG_TARGET_PENDUKUNG_MISSING =
  '[minimal satu target metrik pendukung wajib diisi untuk setiap channel]';
/** D-8 — at least three assumptions. */
export const MSG_ASSUMPTION_MIN = '[minimal tiga asumsi target wajib diisi]';
/** Rule 8 — every monthly stretch figure carries an assumption. */
export const MSG_TARGET_WITHOUT_ASSUMPTION =
  '[setiap target GMV bulanan wajib terkait minimal satu asumsi]';
/** Rule 9 / E-11 — the out-of-scope record cannot be empty. */
export const MSG_OUT_OF_SCOPE_REQUIRED = '[minimal satu item Yang Tidak Dikerjakan wajib diisi]';
/** H-1 — at least three risks. */
export const MSG_RISK_MIN = '[minimal tiga risiko wajib diisi di risk register]';
/** G-0 / Rule 17 — the Plan cycle start date is required before submit. */
export const MSG_CYCLE_START_REQUIRED = '[tanggal mulai siklus Plan wajib diisi]';
/** Rule 17 — the start date is frozen once Plan period 1 closes. */
export const MSG_CYCLE_LOCKED =
  '[tanggal mulai siklus tidak dapat diubah setelah periode Plan pertama ditutup]';
/** Section B — the channel row does not belong to this Strategi. */
export const MSG_CHANNEL_NOT_FOUND = '[channel tidak ditemukan pada Strategi ini]';
/** D-9 — an assumption points at a target that does not exist. */
export const MSG_ASSUMPTION_TARGET_UNKNOWN =
  '[asumsi merujuk target yang tidak ada di Strategi ini]';
/** D-5 — all three horizons are required before submit. */
export const MSG_DEFINISI_BERHASIL_REQUIRED =
  '[definisi berhasil 30, 60, dan 90 hari wajib diisi]';
/** D-6 — at least one weekly leading indicator must be chosen. */
export const MSG_LEADING_INDICATOR_REQUIRED =
  '[minimal satu leading indicator mingguan wajib dipilih]';
/** D-6 — "maks 5"; more than the cap is refused, not truncated. */
export const MSG_LEADING_INDICATOR_MAX = `[maksimal ${LEADING_INDICATOR_MAX} leading indicator mingguan]`;
/**
 * D-7 — a half-filled challenge cannot be stored (mirrors
 * `ck_strategi_sanggahan_utuh`): "unrealistic compared to what?" must have an
 * answer at post-mortem time.
 */
export const MSG_SANGGAHAN_INCOMPLETE =
  '[sanggahan target wajib menyertakan alasan, angka pembanding, dan target yang realistis]';
/**
 * D-8 — the flip target must be one of the three statuses. Not a state machine:
 * this is a child-row ATTRIBUTE (see the migration comment on the column).
 */
export const MSG_ASSUMPTION_STATUS_INVALID = '[status asumsi tidak dikenal]';
/** D-8 — the code does not name an assumption on this Strategi. */
export const MSG_ASSUMPTION_NOT_FOUND = '[asumsi tidak ditemukan pada Strategi ini]';
/**
 * X-17 (owner decision 2026-08-11) — an assumption's status cannot be flipped on
 * a version whose visibility is already history (`Diarsipkan` / `Kedaluwarsa`),
 * mirroring `MSG_VISIBILITAS_TERKUNCI`. Rule 13: an archived or expired version
 * is immutable and still readable — flipping an assumption to `Gugur` there would
 * fire `strategi_revisi_disarankan` against a version already superseded, a
 * suggestion with no correct action for its recipient.
 */
export const MSG_ASSUMPTION_STATUS_TERKUNCI =
  '[status asumsi tidak dapat diubah pada versi Strategi yang sudah diarsipkan atau kedaluwarsa]';
/**
 * A-11 (§7 D20) — a share link can only be minted once there is an approved
 * active version to pin it to; the link always renders that version.
 */
export const MSG_SHARE_NO_ACTIVE_VERSION =
  '[tautan klien hanya bisa dibuat setelah ada versi Strategi yang aktif]';
/** E-1 — the thesis the whole of Section E hangs off. */
export const MSG_GROWTH_THESIS_REQUIRED = '[growth thesis wajib diisi]';
/** E-13 — the order is stored on the pillars; the reason is not. */
export const MSG_URUTAN_EKSEKUSI_REQUIRED = '[alasan urutan eksekusi pilar wajib diisi]';
/** H-3 — a plan with no fallback is a bet, not a plan. */
export const MSG_SKENARIO_MUNDUR_REQUIRED = '[skenario mundur wajib diisi]';
/** A-05 — a required Section A field is still empty (kode names which one). */
export const MSG_KONTEKS_INCOMPLETE = '[konteks klien & bisnis belum lengkap]';
/** A-5 — "3 alasan utama orang beli produk ini". */
export const MSG_USP_MIN = '[minimal tiga USP produk wajib diisi]';
/** A-15 — every contracted channel needs its access checklist. */
export const MSG_AKSES_MATRIX_REQUIRED =
  '[matriks akses wajib diisi untuk setiap channel kontrak]';
/** A-16 — a blocker without a target date is a complaint, not a work item. */
export const MSG_AKSES_BLOCKER_DATE =
  '[blocker akses wajib menyertakan target tanggal beres]';
/** A-15 — the matrix is a matrix: one row per (channel, akses). */
export const MSG_AKSES_DUPLICATE =
  '[akses yang sama tidak boleh dicatat dua kali untuk satu channel]';
/** A-06 / Rule 5 — a baseline group on an `Eksisting` channel is still blank. */
export const MSG_BASELINE_GROUP_INCOMPLETE = '[data baseline channel belum lengkap]';
/** B-2.3 / §7 — the traffic composition must add up. */
export const MSG_TRAFFIC_MIX_SUM = '[komposisi sumber trafik wajib berjumlah 100%]';
/** B-3.3 — at least one hero-SKU row; E-3 has nothing to promote without it. */
export const MSG_TOP_SKU_REQUIRED = '[minimal satu SKU teratas wajib diisi per channel]';
/** B-9.1 — at least one competitor; C-4 compares against it. */
export const MSG_KOMPETITOR_REQUIRED = '[minimal satu kompetitor wajib diisi per channel]';
/**
 * A-11 / A-14 / B-5.3 / B-8.1 / B-8.2 — the O58 gate. Deliberately NOT the
 * generic "belum lengkap": for these five the list being empty is not itself the
 * problem, so telling the AM "incomplete" points at a field that may be
 * correctly empty. The message has to name the second way to answer, or the
 * checkbox O58 bought is invisible to the person who needs it.
 *
 * Coined here (the PRD does not quote a string for a field it does not define);
 * logged in DECISIONS.md 2026-08-07 alongside the O58 decision, following the
 * MSG_USP_MIN / MSG_TOP_SKU_REQUIRED precedent.
 */
export const MSG_TIDAK_ADA_BELUM_DIJAWAB =
  '[pertanyaan ini wajib dijawab — isi daftarnya atau centang "tidak ada"]';

// ---------------------------------------------------------------------------
// Section C — Diagnosa & Akar Masalah (A-07)
// ---------------------------------------------------------------------------

/** C-1 enum — bottleneck utama per channel. */
export const BOTTLENECK_KINDS = [
  'trafik',
  'konversi',
  'aov',
  'repeat_order',
  'margin',
  'operasional',
  'konten',
  'harga',
  'listing',
] as const;
export type BottleneckKind = (typeof BOTTLENECK_KINDS)[number];

/**
 * C-2 Rule 6 — closed set of valid baseline field-IDs that a diagnosa may
 * cite as evidence. This is the set of all W + A field IDs from Section A
 * (A-1 through A-16) and Section B (B-0.1 through B-9.3).
 *
 * The DB cannot enforce this set with a CHECK (subqueries inside CHECKs are
 * forbidden). Domain validates membership here at save time (not at submit),
 * so an invalid ID is caught when the AM types it rather than at the gate.
 */
export const VALID_BASELINE_FIELD_IDS: ReadonlySet<string> = new Set([
  // Section A
  'A-1',
  'A-2',
  'A-3',
  'A-4',
  'A-5',
  'A-6',
  'A-7',
  'A-8',
  'A-9',
  'A-10',
  'A-11',
  'A-12',
  'A-13',
  'A-14',
  'A-15',
  'A-16',
  // Section B — B-0 (channel identity)
  'B-0.1',
  'B-0.2',
  'B-0.3',
  'B-0.4',
  'B-0.5',
  'B-0.6',
  'B-0.7',
  'B-0.8',
  // B-1 (penjualan)
  'B-1.1',
  'B-1.2',
  'B-1.3',
  'B-1.4',
  'B-1.5',
  // B-2 (trafik & konversi)
  'B-2.1',
  'B-2.2',
  'B-2.3',
  'B-2.4',
  // B-3 (portofolio SKU)
  'B-3.1',
  'B-3.2',
  'B-3.3',
  'B-3.4',
  'B-3.5',
  'B-3.6',
  // B-4 (kesehatan toko)
  'B-4.1',
  'B-4.2',
  'B-4.3',
  'B-4.4',
  'B-4.5',
  // B-5 (iklan)
  'B-5.1',
  'B-5.2',
  'B-5.3',
  'B-5.4',
  'B-5.5',
  // B-6 (affiliate / KOL)
  'B-6.1',
  'B-6.2',
  'B-6.3',
  'B-6.4',
  'B-6.5',
  // B-7 (konten & live)
  'B-7.1',
  'B-7.2',
  'B-7.3',
  'B-7.4',
  // B-8 (promo & program platform)
  'B-8.1',
  'B-8.2',
  'B-8.3',
  // B-9 (kompetitor)
  'B-9.1',
  'B-9.2',
  'B-9.3',
]);

/** Minimum quick wins required at submit (C-5). */
export const QUICK_WIN_MIN = 3;

/** C-2: each diagnosa must cite ≥1 baseline field-ID (Rule 6). */
export const MSG_DIAGNOSA_FIELD_ID_REQUIRED =
  '[setiap diagnosa wajib mencantumkan minimal satu field-ID baseline sebagai bukti]';

/** C-2: the cited field-ID does not exist in VALID_BASELINE_FIELD_IDS. */
export const MSG_DIAGNOSA_INVALID_FIELD_ID =
  '[field-ID baseline tidak valid — gunakan ID yang terdaftar seperti B-2.2 atau A-5]';

/** C-1/C-3: each contracted channel must have a diagnosa row. */
export const MSG_DIAGNOSA_MISSING =
  '[diagnosa wajib diisi untuk setiap channel yang dikontrak]';

/** C-5: at least QUICK_WIN_MIN quick wins across all channels. */
export const MSG_QUICK_WIN_MIN = `[minimal ${QUICK_WIN_MIN} quick win 14 hari wajib diisi]`;

/** C-6: at least one structural risk. */
export const MSG_RISIKO_STRUKTURAL_REQUIRED =
  '[minimal satu risiko struktural wajib diisi]';

/** C-7: at least one client prerequisite. */
export const MSG_PRASYARAT_KLIEN_REQUIRED =
  '[minimal satu prasyarat klien wajib diisi]';

// --- Section E/G/H/I (A-09b) ------------------------------------------------

/** E-2: both halves of the answer — the role AND the reason §4 asks for. */
export const MSG_PRIORITAS_CHANNEL_REQUIRED =
  '[prioritas channel dan alasannya wajib diisi untuk setiap channel]';
export const MSG_PRIORITAS_INVALID = '[prioritas channel tidak dikenal]';

/** E-12. */
export const MSG_KETERGANTUNGAN_REQUIRED =
  '[minimal satu ketergantungan pada klien wajib diisi]';
export const MSG_KETERGANTUNGAN_INCOMPLETE =
  '[ketergantungan klien wajib memuat item, kapan, dan konsekuensi]';

/** G-1. */
export const MSG_FASE_MIN = `[minimal ${FASE_MIN} fase kerja wajib diisi]`;
export const MSG_FASE_INCOMPLETE =
  '[fase kerja wajib memuat nama, rentang tanggal, tujuan, dan kriteria lulus]';
export const MSG_FASE_RENTANG =
  '[tanggal akhir fase tidak boleh lebih awal dari tanggal mulai]';

/** G-2. */
export const MSG_TANGGAL_BESAR_REQUIRED = '[minimal satu tanggal besar wajib diisi]';
export const MSG_TANGGAL_BESAR_INCOMPLETE =
  '[tanggal besar wajib memuat tanggal, nama, dan perannya]';

/** G-3 / G-4. */
export const MSG_REVIEW_KLIEN_REQUIRED =
  '[jadwal review klien wajib memuat frekuensi, format laporan, dan PIC]';
export const MSG_REVIEW_INTERNAL_REQUIRED = '[frekuensi review internal SPV wajib diisi]';

/** H-2. */
export const MSG_TRIGGER_REVISI_REQUIRED = '[minimal satu trigger revisi wajib dipilih]';
export const MSG_TRIGGER_REVISI_INVALID = '[trigger revisi tidak dikenal]';
export const MSG_TRIGGER_AMBANG_REQUIRED = '[trigger ini wajib disertai ambang angka]';
export const MSG_TRIGGER_AMBANG_TERLARANG = '[trigger ini tidak memakai ambang angka]';
export const MSG_TRIGGER_AMBANG_INVALID = '[ambang trigger revisi tidak valid]';
export const MSG_TRIGGER_LAINNYA_CATATAN =
  '[trigger "lainnya" wajib disertai penjelasan]';
export const MSG_TRIGGER_DUPLICATE = '[trigger revisi yang sama dipilih lebih dari sekali]';
/**
 * Rule 13 + §4 J-3 "trigger yang terpicu (dari H-2)": a revision may only cite a
 * trigger this Strategi actually declared. The DB CHECK can only hold the global
 * set — a per-Strategi subset is a cross-row comparison, so it lives here.
 */
export const MSG_TRIGGER_NOT_DECLARED =
  '[trigger revisi ini tidak dideklarasikan di H-2 pada Strategi ini]';

/** I-2 / I-3. */
export const MSG_DISPATCH_REQUIRED = '[minimal satu divisi penerima Brief wajib dipilih]';
export const MSG_DISPATCH_INVALID = '[divisi penerima Brief tidak dikenal]';
export const MSG_DISPATCH_DUPLICATE = '[divisi penerima Brief terdaftar lebih dari sekali]';
export const MSG_DISPATCH_URUTAN_DUPLICATE = '[urutan dispatch tidak boleh sama]';
export const MSG_METRIK_LAPORAN_REQUIRED =
  '[minimal satu metrik laporan klien wajib dipilih]';
export const MSG_METRIK_LAPORAN_INVALID = '[metrik laporan klien tidak dikenal]';

/** A-10 / Rule 16 — the visibility overlay. */
export const MSG_VISIBILITAS_INVALID = '[pilihan visibilitas tidak dikenal]';
export const MSG_FIELD_ID_UNKNOWN = '[field ini tidak ada di formulir Strategi]';
/**
 * Rule 16(a). Named in the message on purpose: an AM who ticked the wrong row
 * needs to know WHICH field refused, and a generic "tidak boleh" sends them
 * looking for a permission problem they do not have.
 */
export const MSG_VISIBILITAS_HARD_INTERNAL =
  '[field ini tidak pernah bisa dibagikan ke klien]';
/**
 * Rule 13 — an archived or expired version is immutable and still readable. Its
 * visibility is part of what a client already saw; changing it would rewrite the
 * answer to "what was shared on the day of the dispute".
 */
export const MSG_VISIBILITAS_TERKUNCI =
  '[visibilitas tidak dapat diubah pada versi yang sudah diarsipkan atau kedaluwarsa]';

const RE_DATE = /^\d{4}-\d{2}-\d{2}$/;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// --- Repeatable structs stored as jsonb.
//
// They are declared as named interfaces rather than `Record<string, unknown>[]`
// on purpose: the response-shape guard follows a key whose type NAMES an
// interface and compares it against the FE side, and an anonymous bag is a shape
// nothing verifies. Money inside these structs is a STRING, like every other
// currency value that crosses the wire in CDPS.

/** A-12 — who may approve, and how to escalate past them. */
export interface StrategiDecisionMaker {
  nama: string;
  jabatan: string;
  berhakApprove: boolean;
  jalurEskalasi: string;
}

/** B-3.3 — top SKU by GMV. */
export interface StrategiTopSku {
  nama: string;
  gmv: string;
  unitTerjual: number;
  hargaJual: string;
  marginPersen: number;
}

/** B-5.4 — keyword/audience that produced orders (optional field). */
export interface StrategiTopKeyword {
  keyword: string;
  jumlahOrder: number;
}

/** B-5.5 — spend with no orders behind it (optional field). */
export interface StrategiKampanyeBoncos {
  nama: string;
  spend: string;
}

/** B-6.4 — top creator by GMV (optional field). */
export interface StrategiTopKreator {
  nama: string;
  gmv: string;
}

/** B-8.1 — an active voucher/promo. */
export interface StrategiVoucher {
  tipe: string;
  nilai: string;
  syarat: string;
}

/** B-9.1 — a competing store on this channel. */
export interface StrategiKompetitor {
  nama: string;
  url: string;
  hargaSebanding: string;
  estimasiPenjualanBulan: string;
}

/**
 * Section A — Konteks Klien & Bisnis (A-05), filled once per Strategi.
 *
 * Every field is `W` in the PRD yet nullable here, and that is deliberate: the
 * record is born `Draft`, §7 asks for autosave every 20s, and §5 step 5 asks the
 * submit button to show a live count of unmet requirements. All three need a
 * half-filled Section A to be storable. Presence is enforced by
 * `checkCompleteness` inside the submit transaction; shape and range are enforced
 * here and by CHECK constraints.
 */
export interface StrategiKonteks {
  namaBrand: string | null;
  kategoriUtama: string | null;
  subKategori: string[];
  modelBisnis: BusinessModel | null;
  /** A-3 — §4.1 default `Internal Saja`. */
  marginKotorPersen: number | null;
  posisiHarga: PricePosition | null;
  usp: string[];
  kapasitasStok: StockCapacity | null;
  leadTimeRestockHari: number | null;
  plafonUnitPerBulan: number | null;
  titikKirimKota: string | null;
  titikKirimDetail: string | null;
  /** A-9 — verbatim from the kickoff, not the AM's paraphrase. */
  ekspektasiKlien: string | null;
  /** A-10 — §4.1 HARD-INTERNAL, never shareable. */
  riwayatAgensi: string | null;
  pantanganKlien: string[];
  /**
   * A-11 (O58) — the AM asserting the client has NO restrictions. An empty
   * `pantanganKlien` with this false means "not answered yet"; with this true it
   * means "asked, and the answer is none". The submit gate reads both.
   */
  pantanganKlienTidakAda: boolean;
  decisionMaker: StrategiDecisionMaker[];
  /** A-13 — §4.1 default `Internal Saja`. */
  slaKlienJam: number | null;
  slaKlienCatatan: string | null;
  asetDariKlien: ClientAsset[];
  /** A-14 (O58) — the AM asserting the client supplies NO assets. */
  asetDariKlienTidakAda: boolean;
  asetCatatan: string | null;
}

/** A-15 + A-16 — one row per (channel, akses); the blocker is a flag on it. */
export interface StrategiAkses {
  id: number;
  channel: AccessChannel;
  akses: AccessKind;
  status: AccessState;
  memblokir: boolean;
  targetTanggalBeres: string | null;
  catatan: string;
}

/** The Strategi header (Section J-1 + the contract window) plus Section A. */
export interface Strategi extends StrategiKonteks {
  id: string;
  contractId: string;
  clientId: string;
  versiNo: number;
  strategiIndukId: string | null;
  versiSebelumnyaId: string | null;
  status: string;
  // The contract window is DERIVED (O57): it is stored once, on `contracts`, and
  // joined in here so callers keep reading it off the Strategi. Writing it means
  // writing the Contract — house rule #4, and the reason M6B's period generator
  // cannot find two different answers for "how many months".
  durasiKontrakBulan: number;
  tanggalMulaiKontrak: string;
  tanggalAkhirKontrak: string;
  tanggalMulaiSiklus: string | null;
  siklusTerkunci: boolean;
  toleransiOverPersen: number;
  diajukanPada: string | null;
  disetujuiPada: string | null;
  disetujuiOleh: string | null;
  catatanReviewer: string | null;
  createdBy: string;
  createdAt: string;

  // --- Section D header fields (A-08). D-1/D-2/D-4 live in `targets`, D-8/D-9
  // in `assumptions`, and D-3 is DERIVED (`komposisiKontribusi`, X-11) — so what
  // lands on the header is exactly the three that are neither a matrix nor a
  // repeatable list. Nullable for the same autosave reason as Section A.
  /** D-5 — definisi berhasil di 30 hari. */
  definisiBerhasil30: string | null;
  /** D-5 — definisi berhasil di 60 hari. */
  definisiBerhasil60: string | null;
  /** D-5 — definisi berhasil di 90 hari. */
  definisiBerhasil90: string | null;
  /** D-6 — leading indicator mingguan, maks `LEADING_INDICATOR_MAX`. */
  leadingIndicator: LeadingIndicator[];
  /**
   * D-7 — Sanggahan Target. §4.1 HARD-INTERNAL, never shareable, and ADVISORY:
   * `sanggahanTargetRealistis` is the AM's opinion and is never read as a floor.
   * The floor is untouchable by design (`ck_strtg_stretch_gmv`).
   */
  sanggahanAlasan: string | null;
  /**
   * Money, so a STRING — integer minor units, exactly like `StrategiTarget.nilaiFloor`
   * and every other rupiah figure on this boundary (frozen invariant). Typing it
   * `number` would put a second representation of the same kind of value in the
   * codebase, which is the drift the money rules exist to prevent.
   */
  sanggahanAngkaPembanding: string | null;
  sanggahanTargetRealistis: string | null;
  sanggahanDiajukanPada: string | null;
  sanggahanDiajukanOleh: string | null;

  // --- Section E/H narrative header fields (A-09a). The rest of E and H are
  // child rows: E-3…E-11 in `strategi_pillar`, H-1 in `strategi_risk`. These four
  // are the paragraphs those rows cannot hold.
  /** E-1 — the thesis every other Section E row descends from. §4.1 shareable. */
  growthThesis: string | null;
  /**
   * E-13 — WHY pillar A precedes pillar B. `strategi_pillar.urutan` stores the
   * order; it never stores the reason. §4.1 shareable.
   */
  urutanEksekusiAlasan: string | null;
  /** H-3 — fallback if the main strategy fails in phase 1. §4.1 shareable. */
  skenarioMundur: string | null;
  /**
   * H-4 — when MEA advises stopping or changing scope.
   * ⚠️ §4.1 **HARD-INTERNAL, never shareable** — never serialise to `/s/{token}`.
   * Optional in §4, so it is deliberately NOT gated at submit.
   */
  kondisiStopScope: string | null;

  // --- Section G/I header fields (A-09b). G-1/G-2 are repeatable structs and
  // live in child tables; these are the ones whose cardinality is fixed at one.
  /**
   * G-3 — review cadence with the client. FREE TEXT, and that is a decision:
   * §4 marks G-3/G-4 `Struct`, not `Enum`, and the PRD never writes a frequency
   * vocabulary anywhere. Inventing `mingguan|bulanan|…` here would be a closed
   * set nobody asked for, enforced by a CHECK that is expensive to undo.
   */
  reviewKlienFrekuensi: string | null;
  /** G-3 — report format used at the client review. */
  reviewKlienFormat: string | null;
  /** G-3 — who runs the review on MEA's side. */
  reviewKlienPic: string | null;
  /** G-4 — internal SPV review cadence. Free text, same reason as G-3. */
  reviewInternalFrekuensi: string | null;
  /**
   * I-3 — metrics pulled into the monthly client report. Closed set = the D-4
   * metric vocabulary (`TARGET_METRICS`), for the same reason D-6 reuses it
   * (X-13): §4 says "Multi-enum" and never writes the list. Open question X-14.
   */
  metrikLaporanKlien: LaporanMetric[];
}

/** Section B-0 — one block per contracted channel (D4). */
export interface StrategiChannel {
  id: number;
  channel: Channel;
  channelLain: string | null;
  statusChannel: ChannelState;
  namaToko: string;
  urlToko: string;
  umurTokoBulan: number | null;
  badge: string | null;
  targetTanggalLive: string | null;
  prasyaratPembukaan: string[];
  sumberData: string | null;
  tanggalAmbilData: string | null;
  lampiran: string | null;
  periodeBaselineBulan: number | null;
  periodeMulai: string | null;
  periodeAkhir: string | null;
  alasanPeriodePendek: string | null;
  catatanPeriodePendek: string | null;

  // --- E-2 (A-09b). Section E, but stored per channel, because that is the
  // grain of the question ("which channel is the engine"). It lives on this row
  // rather than in a child table because `saveChannels` is DELETE-then-INSERT:
  // a separate table keyed by channel would be silently wiped — or silently
  // orphaned — every time the AM saves Section B.
  /** E-2 — engine_utama / pendukung / maintenance. */
  prioritas: ChannelPrioritas | null;
  /** E-2 — the "+ alasan" half of the same question. */
  prioritasAlasan: string | null;

  // --- Section B groups B-2 … B-9 (A-06). One figure per channel, not per
  // month — the monthly ones (B-1, B-5.1/5.2) are rows in `baseline` below.
  // Nullable for the same reason Section A is: see `StrategiKonteks`.

  // B-2 Trafik & Konversi
  pengunjungPerBulan: number | null;
  conversionRatePersen: number | null;
  /** B-2.3 — six columns, so the §7 "sums to 100 ±0,5" CHECK is writable. */
  trafikOrganikPersen: number | null;
  trafikIklanPersen: number | null;
  trafikAffiliatePersen: number | null;
  trafikLivePersen: number | null;
  trafikVideoPersen: number | null;
  trafikLuarPersen: number | null;
  entryPointUtama: EntryPoint | null;
  entryPointCatatan: string | null;

  // B-3 Portofolio SKU
  skuListed: number | null;
  skuAktif: number | null;
  skuPareto80: number | null;
  topSku: StrategiTopSku[];
  skuSlowMoving: number | null;
  skuStokKritis: string[];
  listingLayakPersen: number | null;

  // B-4 Kesehatan Toko & Layanan
  ratingToko: number | null;
  jumlahUlasan: number | null;
  chatResponseRatePersen: number | null;
  chatResponseMenit: number | null;
  pesananTerlambatPersen: number | null;
  poinPenalti: number | null;
  catatanPenalti: string | null;
  temaKeluhan: string[];

  // B-5 Iklan (the per-month figures live in `baseline`)
  tipeKampanye: CampaignType[];
  /** B-5.3 (O58) — the AM asserting this channel runs NO campaigns. */
  tipeKampanyeTidakAda: boolean;
  jumlahKampanyeAktif: number | null;
  topKeyword: StrategiTopKeyword[];
  kampanyeBoncos: StrategiKampanyeBoncos[];

  // B-6 Affiliate / KOL
  affiliateAktif30Hari: number | null;
  gmvAffiliate: string | null;
  gmvAffiliatePersen: number | null;
  komisiOpenPersen: number | null;
  komisiTargetPersen: number | null;
  topKreator: StrategiTopKreator[];
  programSampel: SampleProgram | null;
  programSampelCatatan: string | null;

  // B-7 Konten & Live
  jumlahVideoPerBulan: number | null;
  totalViews: number | null;
  gmvVideo: string | null;
  jamLivePerBulan: number | null;
  gmvLive: string | null;
  /** B-7.2 third figure — computed (house rule #4), `null` at zero live hours. */
  gmvPerJamLive: string | null;
  hostLive: LiveHost | null;
  studioLive: StudioState | null;
  studioCatatan: string | null;

  // B-8 Promo & Program Platform
  voucherAktif: StrategiVoucher[];
  /** B-8.1 (O58) — the AM asserting there are NO running vouchers. */
  voucherAktifTidakAda: boolean;
  programPlatform: PlatformProgram[];
  /** B-8.2 (O58) — the AM asserting the store joined NO platform programmes. */
  programPlatformTidakAda: boolean;
  bebanPromoPersen: number | null;

  // B-9 Kompetitor di Channel Ini
  kompetitor: StrategiKompetitor[];
  kompetitorLebihBaik: CompetitorEdge[];
  kompetitorCatatan: string | null;
  celahKompetitor: string | null;

  /**
   * B-1.5 — trend across the declared baseline window. Auto (`A` in the PRD), so
   * it is derived on read and never stored: a stored trend can go stale against
   * the baseline rows that produced it (house rule #4).
   *
   * `trenPersen` is null when the oldest month's GMV is 0 — division by zero
   * renders `—`, never an error (house rule #7).
   */
  tren: TrenState | null;
  trenPersen: number | null;
}

/** B-1 / B-5 — one row per month of the declared window. */
export interface BaselineMonth {
  monthIndex: number;
  gmv: string;
  jumlahPesanan: number;
  persenBatal: number;
  adSpend: string;
  roas: number;
  acos: number;
  /** B-1.3, auto (GMV/order). Null when there were no orders — rendered `—`. */
  aov: string | null;
}

/** D-1 (floor) + D-2/D-4 (stretch). */
export interface StrategiTarget {
  channel: string;
  monthIndex: number;
  metric: TargetMetric;
  nilaiFloor: string | null;
  nilaiStretch: string;
  /** O57: `kontrak` once a Contract record exists; `input_am` until then. */
  sumberFloor: FloorSource | null;
}

/**
 * D-3 — komposisi kontribusi channel (% dari total GMV).
 *
 * **TURUNAN, tidak pernah disimpan** (X-11, keputusan pemilik 2026-08-07:
 * *"buat target turunan dulu, biarkan nanti saya QC di production"*). PRD M6A
 * menandai D-3 `W` (diketik AM, Σ=100 ±0,5). Jawaban X-04 — *"target GMV dibuat
 * per platform sama dengan baseline"* — membuat komposisi menjadi **akibat**
 * dari D-2, bukan input: kalau setiap channel dijangkarkan ke baseline-nya
 * sendiri, persentasenya sudah ditentukan begitu D-2 terisi. Mengetiknya lagi
 * berarti dua sumber untuk satu angka, dan yang kedua bisa berbohong.
 *
 * ⚠️ **Provisional.** Pemilik akan meninjaunya di QC produksi; kalau ternyata
 * AM memang perlu menyatakan komposisi sebagai NIAT (berbeda dari yang tersirat
 * D-2), bentuknya berubah jadi "diketik + peringatan bila berselisih". Sampai
 * itu diputuskan, jangan tambahkan kolom penyimpan — menambahkannya lebih mudah
 * daripada mencabutnya.
 */
export interface StrategiKomposisi {
  channel: string;
  /** Σ stretch GMV channel ini, seluruh bulan. Rupiah, string desimal. */
  targetGmv: string;
  /**
   * % dari total GMV seluruh channel, 2 desimal. `null` saat totalnya nol —
   * pembagian nol dirender `—`, bukan error (aturan rumah #7).
   */
  persen: number | null;
}

/** D-8 + D-9. */
export interface StrategiAssumption {
  kode: string;
  asumsi: string;
  pemilik: string;
  caraVerifikasi: string;
  status: AssumptionState;
  /** D-9 mapping, as target keys `metric:channel:monthIndex`. */
  targetTerkait: string[];
}

/** Section E. */
export interface StrategiPillar {
  id: number;
  jenis: PillarKind;
  channel: string | null;
  urutan: number;
  sku: string | null;
  peran: string | null;
  aksi: string;
  target: string;
  hargaNormal: string | null;
  hargaPromo: string | null;
  floorPrice: string | null;
  vendorId: string | null;
  slotJam: number | null;
  tarif: string | null;
  targetGmvPerJam: string | null;
  detail: Record<string, unknown>;
}

/** Section F (soft — Rule 10). */
export interface StrategiResource {
  id: number;
  jenis: ResourceKind;
  channel: string | null;
  divisi: string | null;
  nilai: string | null;
  jumlah: number | null;
  satuan: string | null;
  sumberDana: 'klien' | 'paket_mea' | null;
  vendorId: string | null;
  skemaBiaya: string | null;
  catatan: string;
}

/** H-1 risk register. */
export interface StrategiRisk {
  id: number;
  risiko: string;
  dampak: RiskLevel;
  kemungkinan: RiskLevel;
  mitigasi: string;
  pic: string;
  urutan: number;
}

// ---------------------------------------------------------------------------
// Section C (A-07)
// ---------------------------------------------------------------------------

/**
 * C-1/C-2/C-3/C-4 — one diagnosa row per contracted channel.
 * Rule 6: `fieldIds` must have ≥1 entry from VALID_BASELINE_FIELD_IDS.
 */
export interface StrategiDiagnosa {
  id: number;
  channel: string;
  /** C-1 — main bottleneck type for this channel. */
  bottleneck: BottleneckKind;
  /**
   * C-2 — baseline field-ID references that prove the bottleneck diagnosis.
   * Example: ["B-2.2", "B-3.6"]. Min 1, validated against VALID_BASELINE_FIELD_IDS.
   */
  fieldIds: string[];
  /** C-3 — root cause (not symptom). NULLable (autosave); gated at submit. */
  akarMasalah: string | null;
  /** C-4 — most decisive gap vs competitors. NULLable; gated at submit. */
  gapKompetitor: string | null;
}

/** C-5 — quick wins in the first 14 days (min 3 total). */
export interface StrategiQuickWin {
  id: number;
  aksi: string;
  channel: string;
  picDivisi: string;
  dampakDiharapkan: string;
  urutan: number;
}

/** C-6 — structural risks that cannot be eliminated. */
export interface StrategiRisikoStruktural {
  id: number;
  risiko: string;
  urutan: number;
}

/** C-7 — things the client must resolve before execution can proceed. */
export interface StrategiPrasyaratKlien {
  id: number;
  item: string;
  picKlien: string;
  deadline: string | null;
  urutan: number;
}

// ---------------------------------------------------------------------------
// Section E/G/H/I child rows (A-09b)
// ---------------------------------------------------------------------------

/**
 * E-12 — what the client must supply DURING execution, when, and what happens
 * if it is late.
 *
 * Deliberately not merged with C-7 (`StrategiPrasyaratKlien`). C-7 is the gate
 * list before execution starts and has no consequence field because its
 * consequence is that execution does not start; E-12 is the running dependency,
 * and `konsekuensi` is the whole reason it exists separately — it is what gets
 * cited when a target is missed.
 */
export interface StrategiKetergantungan {
  id: number;
  item: string;
  /** Free text, not a date: §4 exemplifies "tiap tgl 1", which is no single day. */
  kapan: string;
  konsekuensi: string;
  urutan: number;
}

/** G-1 — work phases. Min `FASE_MIN`; H-3's "fails in phase 1" depends on these. */
export interface StrategiFase {
  id: number;
  nama: string;
  tanggalMulai: string;
  tanggalAkhir: string;
  tujuan: string;
  kriteriaLulus: string;
  urutan: number;
}

/**
 * G-2 — big dates inside the contract window and each one's role.
 * Read downstream by M6B Rule 7, which re-weights the weekly Plan split toward
 * the weeks containing them.
 */
export interface StrategiTanggalBesar {
  id: number;
  tanggal: string;
  nama: string;
  peran: string;
  urutan: number;
}

/**
 * H-2 — a revision trigger declared for this client.
 * `ambang` is required for exactly `TRIGGER_REVISI_BERAMBANG` and must be null
 * for the rest; its unit is implied by the code (percent, or days).
 */
export interface StrategiTriggerRevisi {
  id: number;
  kode: TriggerRevisiCode;
  ambang: number | null;
  catatan: string | null;
  urutan: number;
}

/** I-2 (division + dispatch order) and I-4 (`catatan`, optional) — one row. */
export interface StrategiDispatch {
  id: number;
  divisi: DispatchDivision;
  urutan: number;
  /** I-4 — what this division most easily misreads. Optional in §4. */
  catatan: string | null;
}

/**
 * A-10 / Rule 16 — one row of the `STRG_FIELD_VISIBILITY` overlay.
 *
 * `tier` and `dapatDiubah` are DERIVED from `packages/core`, never stored: the
 * §4.1 classification is a rule, and a rule copied into rows is a rule that can
 * disagree with itself. What IS stored is the answer (`visibilitas`) and who
 * gave it (`diubahOleh` / `diubahPada`, both null while the row is still the
 * untouched §4.1 seed).
 */
export interface StrategiFieldVisibility {
  fieldId: string;
  visibilitas: visibility.Visibility;
  tier: visibility.VisibilityTier;
  /** Rule 16(a) — false for the hard-internal set, and the UI must not offer a switch. */
  dapatDiubah: boolean;
  diubahOleh: string | null;
  diubahPada: string | null;
}

/** Section J — one row per event, append-only. */
export interface StrategiEvent {
  versiNo: number;
  peristiwa: string;
  aktor: string;
  catatan: string | null;
  triggerRevisi: string[];
  alasanRevisi: string | null;
  asumsiGugur: string[];
  createdAt: string;
}

/** The whole record, as the form loads it. */
export interface StrategiDetail extends Strategi {
  channels: (StrategiChannel & { baseline: BaselineMonth[] })[];
  /** A-15 / A-16 — the access matrix and the blockers flagged inside it. */
  akses: StrategiAkses[];
  /** A-07 — Section C: per-channel diagnosis + quick wins + structural risks + client prereqs. */
  diagnosa: StrategiDiagnosa[];
  quickWins: StrategiQuickWin[];
  risikoStruktural: StrategiRisikoStruktural[];
  prasyaratKlien: StrategiPrasyaratKlien[];
  targets: StrategiTarget[];
  /** D-3 — turunan dari `targets` (metrik `gmv`), tidak pernah disimpan. */
  komposisiKontribusi: StrategiKomposisi[];
  assumptions: StrategiAssumption[];
  pillars: StrategiPillar[];
  resources: StrategiResource[];
  risks: StrategiRisk[];
  /** A-09b — Section E-12 / G-1 / G-2 / H-2 / I-2+I-4. */
  ketergantungan: StrategiKetergantungan[];
  fase: StrategiFase[];
  tanggalBesar: StrategiTanggalBesar[];
  triggerRevisi: StrategiTriggerRevisi[];
  dispatch: StrategiDispatch[];
  /** A-10 — the §4.1 visibility overlay, one row per field ID (Rule 16). */
  visibilitas: StrategiFieldVisibility[];
  riwayat: StrategiEvent[];
}

/** The header fields the AM sets (the contract window + G-0 + F-7). */
export interface StrategiHeaderInput {
  durasiKontrakBulan: number;
  tanggalMulaiKontrak: string;
  tanggalAkhirKontrak: string;
  tanggalMulaiSiklus?: string | null;
  toleransiOverPersen?: number | null;
}

// ---------------------------------------------------------------------------
// Permission (M6A §7)
// ---------------------------------------------------------------------------

/** canWriteStrategi: the owning AM, or a Director. Sections A–I, Draft only. */
export function canWriteStrategi(actor: Actor, ownerAm: string | null): boolean {
  if (actor.role.director) return true;
  return ownerAm !== null && ownerAm === actor.employeeId;
}

/** canApproveStrategi: SPV / Head of Account (Rule 12). Never the author's own. */
export function canApproveStrategi(actor: Actor): boolean {
  return permission.isLead(actor, ACCOUNT_DIVISION);
}

/** canReadStrategi: the write set, plus Account lead and every read-all role. */
export function canReadStrategi(actor: Actor, ownerAm: string | null): boolean {
  return (
    canWriteStrategi(actor, ownerAm) ||
    permission.canReadAll(actor) ||
    permission.isLead(actor, ACCOUNT_DIVISION)
  );
}

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

interface StrategiRow {
  id: string;
  contract_id: string;
  client_id: string;
  versi_no: number;
  strategi_induk_id: string | null;
  versi_sebelumnya_id: string | null;
  status: string;
  durasi_kontrak_bulan: number;
  tanggal_mulai_kontrak: string | Date;
  tanggal_akhir_kontrak: string | Date;
  tanggal_mulai_siklus: string | Date | null;
  siklus_terkunci: boolean;
  toleransi_over_persen: string;
  diajukan_pada: string | Date | null;
  disetujui_pada: string | Date | null;
  disetujui_oleh: string | null;
  catatan_reviewer: string | null;
  created_by: string;
  created_at: string | Date;
  // Section A (A-05). `numeric` arrives as a string from postgres.js.
  nama_brand: string | null;
  kategori_utama: string | null;
  sub_kategori: unknown;
  model_bisnis: string | null;
  margin_kotor_persen: string | null;
  posisi_harga: string | null;
  usp: unknown;
  kapasitas_stok: string | null;
  lead_time_restock_hari: number | null;
  plafon_unit_per_bulan: number | null;
  titik_kirim_kota: string | null;
  titik_kirim_detail: string | null;
  ekspektasi_klien: string | null;
  riwayat_agensi: string | null;
  pantangan_klien: unknown;
  pantangan_klien_tidak_ada: boolean;
  decision_maker: unknown;
  sla_klien_jam: string | null;
  sla_klien_catatan: string | null;
  aset_dari_klien: unknown;
  aset_dari_klien_tidak_ada: boolean;
  aset_catatan: string | null;
  // Section D header (A-08).
  definisi_berhasil_30: string | null;
  definisi_berhasil_60: string | null;
  definisi_berhasil_90: string | null;
  leading_indicator: unknown;
  sanggahan_alasan: string | null;
  sanggahan_angka_pembanding: string | null;
  sanggahan_target_realistis: string | null;
  sanggahan_diajukan_pada: string | Date | null;
  sanggahan_diajukan_oleh: string | null;
  // Section E/H narrative (A-09a).
  growth_thesis: string | null;
  urutan_eksekusi_alasan: string | null;
  skenario_mundur: string | null;
  kondisi_stop_scope: string | null;
  // Section G/I header (A-09b).
  review_klien_frekuensi: string | null;
  review_klien_format: string | null;
  review_klien_pic: string | null;
  review_internal_frekuensi: string | null;
  metrik_laporan_klien: unknown;
}

function dateStr(v: string | Date): string {
  return v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
}

function dateOrNull(v: string | Date | null): string | null {
  return v === null ? null : dateStr(v);
}

function tsOrNull(v: string | Date | null): string | null {
  return v === null ? null : new Date(v).toISOString();
}

function rowToStrategi(r: StrategiRow): Strategi {
  return {
    id: r.id,
    contractId: r.contract_id,
    clientId: r.client_id,
    versiNo: r.versi_no,
    strategiIndukId: r.strategi_induk_id,
    versiSebelumnyaId: r.versi_sebelumnya_id,
    status: r.status,
    durasiKontrakBulan: r.durasi_kontrak_bulan,
    tanggalMulaiKontrak: dateStr(r.tanggal_mulai_kontrak),
    tanggalAkhirKontrak: dateStr(r.tanggal_akhir_kontrak),
    tanggalMulaiSiklus: dateOrNull(r.tanggal_mulai_siklus),
    siklusTerkunci: r.siklus_terkunci,
    toleransiOverPersen: Number(r.toleransi_over_persen),
    diajukanPada: tsOrNull(r.diajukan_pada),
    disetujuiPada: tsOrNull(r.disetujui_pada),
    disetujuiOleh: r.disetujui_oleh,
    catatanReviewer: r.catatan_reviewer,
    createdBy: r.created_by,
    createdAt: new Date(r.created_at).toISOString(),
    // Section A
    namaBrand: r.nama_brand,
    kategoriUtama: r.kategori_utama,
    subKategori: strArray(r.sub_kategori),
    modelBisnis: r.model_bisnis as BusinessModel | null,
    marginKotorPersen: numOrNull(r.margin_kotor_persen),
    posisiHarga: r.posisi_harga as PricePosition | null,
    usp: strArray(r.usp),
    kapasitasStok: r.kapasitas_stok as StockCapacity | null,
    leadTimeRestockHari: r.lead_time_restock_hari,
    plafonUnitPerBulan: r.plafon_unit_per_bulan,
    titikKirimKota: r.titik_kirim_kota,
    titikKirimDetail: r.titik_kirim_detail,
    ekspektasiKlien: r.ekspektasi_klien,
    riwayatAgensi: r.riwayat_agensi,
    pantanganKlien: strArray(r.pantangan_klien),
    pantanganKlienTidakAda: r.pantangan_klien_tidak_ada,
    decisionMaker: decisionMakersOf(r.decision_maker),
    slaKlienJam: numOrNull(r.sla_klien_jam),
    slaKlienCatatan: r.sla_klien_catatan,
    asetDariKlien: strArray(r.aset_dari_klien) as ClientAsset[],
    asetDariKlienTidakAda: r.aset_dari_klien_tidak_ada,
    asetCatatan: r.aset_catatan,
    // Section D (A-08)
    definisiBerhasil30: r.definisi_berhasil_30,
    definisiBerhasil60: r.definisi_berhasil_60,
    definisiBerhasil90: r.definisi_berhasil_90,
    leadingIndicator: strArray(r.leading_indicator) as LeadingIndicator[],
    sanggahanAlasan: r.sanggahan_alasan,
    // Passed through raw, not `numOrNull`: postgres.js hands `numeric` over as a
    // string already, and that string IS the canonical form (same as nilai_floor).
    sanggahanAngkaPembanding: r.sanggahan_angka_pembanding,
    sanggahanTargetRealistis: r.sanggahan_target_realistis,
    sanggahanDiajukanPada: tsOrNull(r.sanggahan_diajukan_pada),
    sanggahanDiajukanOleh: r.sanggahan_diajukan_oleh,
    // Section E/H narrative (A-09a)
    growthThesis: r.growth_thesis,
    urutanEksekusiAlasan: r.urutan_eksekusi_alasan,
    skenarioMundur: r.skenario_mundur,
    kondisiStopScope: r.kondisi_stop_scope,
    // Section G/I header (A-09b)
    reviewKlienFrekuensi: r.review_klien_frekuensi,
    reviewKlienFormat: r.review_klien_format,
    reviewKlienPic: r.review_klien_pic,
    reviewInternalFrekuensi: r.review_internal_frekuensi,
    metrikLaporanKlien: strArray(r.metrik_laporan_klien) as LaporanMetric[],
  };
}

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x)) : [];
}

/** `numeric`/`bigint` reach us as strings; a genuine NULL must stay null. */
function numOrNull(v: string | number | null): number | null {
  return v === null || v === undefined ? null : Number(v);
}

function objArray(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v)
    ? v.filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null)
    : [];
}

function decisionMakersOf(v: unknown): StrategiDecisionMaker[] {
  return objArray(v).map((d) => ({
    nama: String(d.nama ?? ''),
    jabatan: String(d.jabatan ?? ''),
    berhakApprove: d.berhak_approve === true || d.berhakApprove === true,
    jalurEskalasi: String(d.jalur_eskalasi ?? d.jalurEskalasi ?? ''),
  }));
}

function topSkusOf(v: unknown): StrategiTopSku[] {
  return objArray(v).map((s) => ({
    nama: String(s.nama ?? ''),
    gmv: String(s.gmv ?? '0'),
    unitTerjual: Number(s.unit_terjual ?? 0),
    hargaJual: String(s.harga_jual ?? '0'),
    marginPersen: Number(s.margin_persen ?? 0),
  }));
}

function topKeywordsOf(v: unknown): StrategiTopKeyword[] {
  return objArray(v).map((k) => ({
    keyword: String(k.keyword ?? ''),
    jumlahOrder: Number(k.jumlah_order ?? 0),
  }));
}

function boncosOf(v: unknown): StrategiKampanyeBoncos[] {
  return objArray(v).map((k) => ({ nama: String(k.nama ?? ''), spend: String(k.spend ?? '0') }));
}

function kreatorsOf(v: unknown): StrategiTopKreator[] {
  return objArray(v).map((k) => ({ nama: String(k.nama ?? ''), gmv: String(k.gmv ?? '0') }));
}

function vouchersOf(v: unknown): StrategiVoucher[] {
  return objArray(v).map((x) => ({
    tipe: String(x.tipe ?? ''),
    nilai: String(x.nilai ?? ''),
    syarat: String(x.syarat ?? ''),
  }));
}

function kompetitorsOf(v: unknown): StrategiKompetitor[] {
  return objArray(v).map((k) => ({
    nama: String(k.nama ?? ''),
    url: String(k.url ?? ''),
    hargaSebanding: String(k.harga_sebanding ?? '0'),
    estimasiPenjualanBulan: String(k.estimasi_penjualan_bulan ?? '0'),
  }));
}

/**
 * B-1.5 — derive the baseline trend, never store it.
 *
 * Compares the newest month against the oldest in the declared window.
 * `month_index` runs oldest → newest (see the migration comment): the Section D
 * target matrix indexes months forward in time, and a baseline that indexed them
 * backwards would make every cross-section reading a trap.
 */
export function trenBaseline(months: BaselineMonth[]): {
  tren: TrenState | null;
  trenPersen: number | null;
} {
  if (months.length < 2) return { tren: null, trenPersen: null };
  const urut = [...months].sort((a, b) => a.monthIndex - b.monthIndex);
  const awal = Number(urut[0].gmv);
  const akhir = Number(urut[urut.length - 1].gmv);
  if (!(awal > 0)) {
    // House rule #7: division by zero is not an error. A store that started at
    // zero and sold anything since is rising; the magnitude is unanswerable.
    return { tren: akhir > 0 ? 'naik' : 'stabil', trenPersen: null };
  }
  const delta = ((akhir - awal) / awal) * 100;
  const bulat = Math.round(delta * 100) / 100;
  if (Math.abs(bulat) <= TREN_STABIL_BAND_PERSEN) return { tren: 'stabil', trenPersen: bulat };
  return { tren: bulat > 0 ? 'naik' : 'turun', trenPersen: bulat };
}

/**
 * D-3 — derive the channel contribution mix from the D-2 GMV targets (X-11).
 *
 * Summed in **integer cents** through `money.parse`, not in `Number`: a stretch
 * matrix is 12 months × n channels of rupiah values, and float addition over
 * that many terms drifts by enough to make the percentages disagree with the
 * totals shown next to them.
 *
 * Rounding is to 2 decimals per channel, so the column may sum to 99,99 or
 * 100,01. That is correct for a DERIVED display and must not be "fixed" by
 * forcing the last row to absorb the remainder — the PRD's Σ=100 ±0,5 rule was
 * a validation on a TYPED field; here the composition is 100% by construction
 * and only the rendering rounds.
 *
 * Channels are those that actually carry a GMV target. A channel present in
 * Section B but with no D-2 row yet is absent here rather than shown as 0% —
 * "belum diisi" and "diberi nol" are different answers, and M6A §9's anti-vanity
 * guard exists precisely because they get confused.
 */
export function komposisiKontribusi(targets: StrategiTarget[]): StrategiKomposisi[] {
  const perChannel = new Map<string, bigint>();
  for (const t of targets) {
    if (t.metric !== 'gmv') continue;
    perChannel.set(t.channel, (perChannel.get(t.channel) ?? 0n) + money.parse(t.nilaiStretch));
  }
  let total = 0n;
  for (const v of perChannel.values()) total += v;
  return [...perChannel.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([channel, cents]) => ({
      channel,
      targetGmv: money.decimal(cents),
      // House rule #7: nothing divides by zero here — a matrix of zeroes has no
      // composition to report, and `null` is what renders `—`.
      persen: total === 0n ? null : Number((cents * 10000n + total / 2n) / total) / 100,
    }));
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

async function loadServiceContext(
  sql: Queryable,
  serviceId: string,
): Promise<{ clientId: string; status: string; tier: PlanTier; override: boolean | null; ownerAm: string | null; gateDecision: string | null; contractId: string | null }> {
  const rows = await sql<
    {
      client_id: string;
      status: string;
      plan_tier: string;
      requires_strategy_plan_override: boolean | null;
      assigned_am_id: string | null;
      keputusan_am: string | null;
      contract_id: string | null;
    }[]
  >`
    select sv.client_id, sv.status, sv.plan_tier, sv.requires_strategy_plan_override,
           sv.contract_id, c.assigned_am_id, g.keputusan_am
      from services sv
      join clients c on c.id = sv.client_id
      left join service_plan_gate g on g.service_id = sv.id
     where sv.id = ${serviceId}`;
  if (rows.length === 0) {
    throw new NotFoundError(MSG_SERVICE_NOT_FOUND);
  }
  const r = rows[0];
  return {
    clientId: r.client_id,
    status: r.status,
    tier: r.plan_tier as PlanTier,
    override: r.requires_strategy_plan_override,
    ownerAm: r.assigned_am_id,
    gateDecision: r.keputusan_am,
    contractId: r.contract_id,
  };
}

/**
 * loadStrategiRow reads the header with its contract window joined in (O57).
 *
 * `FOR UPDATE OF s` — not a bare `FOR UPDATE`: the lock belongs on the Strategi
 * row being written, and locking `contracts` as well would make two AMs editing
 * two different Strategi under one agreement serialise against each other.
 */
async function loadStrategiRow(sql: Queryable, id: string, forUpdate = false): Promise<Strategi> {
  const rows = forUpdate
    ? await sql<StrategiRow[]>`
        select s.*, ct.durasi_bulan as durasi_kontrak_bulan,
               ct.tanggal_mulai as tanggal_mulai_kontrak,
               ct.tanggal_akhir as tanggal_akhir_kontrak
          from strategi s join contracts ct on ct.id = s.contract_id
         where s.id = ${id} for update of s`
    : await sql<StrategiRow[]>`
        select s.*, ct.durasi_bulan as durasi_kontrak_bulan,
               ct.tanggal_mulai as tanggal_mulai_kontrak,
               ct.tanggal_akhir as tanggal_akhir_kontrak
          from strategi s join contracts ct on ct.id = s.contract_id
         where s.id = ${id}`;
  if (rows.length === 0) {
    throw new NotFoundError(MSG_STRATEGI_NOT_FOUND);
  }
  return rowToStrategi(rows[0]);
}

/** ownerAmOf resolves the AM who owns the client behind a Service. */
async function ownerAmOf(sql: Queryable, serviceId: string): Promise<string | null> {
  const rows = await sql<{ assigned_am_id: string | null }[]>`
    select c.assigned_am_id from services sv join clients c on c.id = sv.client_id
     where sv.id = ${serviceId}`;
  return rows.length === 0 ? null : rows[0].assigned_am_id;
}

/**
 * ownerAmOfContract is the same question asked of an agreement (O57) — the TS
 * mirror of the RLS helper `private.jwt_is_am_of_contract`. Every Strategi write
 * gate goes through this now: the Strategi no longer knows a single Service.
 */
async function ownerAmOfContract(sql: Queryable, contractId: string): Promise<string | null> {
  const rows = await sql<{ assigned_am_id: string | null }[]>`
    select c.assigned_am_id from contracts ct join clients c on c.id = ct.client_id
     where ct.id = ${contractId}`;
  return rows.length === 0 ? null : rows[0].assigned_am_id;
}

/** getStrategi loads the whole record (header + every child). */
export async function getStrategi(sql: Queryable, actor: Actor, id: string): Promise<StrategiDetail> {
  const head = await loadStrategiRow(sql, id);
  const ownerAm = await ownerAmOfContract(sql, head.contractId);
  if (!canReadStrategi(actor, ownerAm)) {
    throw new ForbiddenError(MSG_STRATEGI_FORBIDDEN);
  }
  return loadDetail(sql, head);
}

// ---------------------------------------------------------------------------
// Interview → Strategi prefill (RAB-09)
// ---------------------------------------------------------------------------

/**
 * What the client's completed Interview hands to this Strategi: the verdict-driven
 * handoff and the concrete prefill suggestions, both computed by the ONE core
 * bridge (`iv.resolveStrategiPrefill`) — this domain layer only resolves *which*
 * interview and reads its answers, it never re-derives the mapping or the flags.
 */
export interface StrategiPrefill extends iv.StrategiPrefill {
  /** The interview these suggestions came from, so the UI can link back to it. */
  interviewId: string;
}

/** One stored answer flattened to a display string, or null when unanswered. */
function answerValue(a: Answer): string | null {
  if (a.nilaiEnum != null && a.nilaiEnum !== '') return a.nilaiEnum;
  if (a.nilaiTeks != null && a.nilaiTeks !== '') return a.nilaiTeks;
  if (a.nilaiUang != null && a.nilaiUang !== '') return a.nilaiUang;
  if (a.nilaiAngka != null) return String(a.nilaiAngka);
  if (a.nilaiBool != null) return a.nilaiBool ? 'true' : 'false';
  return null;
}

/**
 * The client's most recent completed + scored interview, or null. Qualification is
 * client-level (interview.service_id is usually null), so both the Blok D handoff
 * (RAB-09) and the Section B baseline flow (RAB-11) resolve the SAME interview this
 * way — one helper so a change to "which interview" can never drift between them.
 * `listInterviewsByClient` is newest-first by created_at, so the first match wins.
 */
async function latestScoredInterview(
  sql: Queryable,
  actor: Actor,
  clientId: string,
): Promise<InterviewListRow | null> {
  const candidates = await listInterviewsByClient(sql, actor, clientId);
  return candidates.find((c) => iv.isInterviewComplete(c.status) && c.verdict != null) ?? null;
}

/**
 * getStrategiPrefill is the production caller RAB-09 was missing for the two pure
 * Blok D functions. It reads the Strategi (same read gate as `getStrategi`),
 * finds the client's most recent completed Interview, and returns the handoff +
 * prefill suggestions. Returns `null` when the client has no scored, completed
 * interview yet — the page then shows nothing, never an error.
 *
 * Suggestions only: nothing is written to Section A/C/E here. The AM accepts each
 * value through the normal Section editors, which is the M6A "usulan → konfirmasi"
 * rule and the reason no interview-provenance column is needed on `strategi`.
 */
export async function getStrategiPrefill(
  sql: Queryable,
  actor: Actor,
  id: string,
): Promise<StrategiPrefill | null> {
  const head = await loadStrategiRow(sql, id);
  const ownerAm = await ownerAmOfContract(sql, head.contractId);
  if (!canReadStrategi(actor, ownerAm)) {
    throw new ForbiddenError(MSG_STRATEGI_FORBIDDEN);
  }

  const chosen = await latestScoredInterview(sql, actor, head.clientId);
  if (!chosen) return null;

  const detail = await getInterview(sql, actor, chosen.id);
  if (!detail.kualifikasi) return null;

  const answers = new Map<string, string>();
  for (const a of detail.answers) {
    const v = answerValue(a);
    if (v != null) answers.set(a.fieldKey, v);
  }
  const prefill = iv.resolveStrategiPrefill(
    detail.kualifikasi.verdictKualifikasi as iv.Verdict,
    answers,
  );
  return { ...prefill, interviewId: chosen.id };
}

// ---------------------------------------------------------------------------
// Riset awal baseline → Section B channel prefill (RAB-11 / RAB-12)
// ---------------------------------------------------------------------------

/**
 * One month of a channel's baseline, proposed from the riset-awal payload's
 * `gmv_baseline.riwayat`. Only `gmv` and `jumlahPesanan` are proposed — those are
 * the two the riwayat carries per month. Ad spend / ROAS / ACOS / cancel-rate are
 * period AGGREGATES in the payload, never per-month, so they are deliberately NOT
 * proposed here: fabricating a per-month figure the export never carried is the
 * "absent ≠ zero" mistake the baseline engine (RAB-02 fix #2) exists to avoid. The
 * AM types those six-per-month figures into the Section B editor, where Rule 5
 * (`saveBaseline`) then requires each one.
 */
export interface BaselineMonthSuggestion {
  monthIndex: number;
  /** e.g. "Agu 2026" — so the AM sees which month each row is. */
  label: string | null;
  /** Rupiah (major, 2dp scale), the same unit `strategi_baseline_bulan.gmv` stores. */
  gmv: string | null;
  jumlahPesanan: number | null;
}

/**
 * RAB-12 — `gmv_mix` is attribution WITHIN the TikTok Shop platform (video/LIVE ×
 * afiliasi/toko + kartu produk), NOT a per-marketplace channel. It rides along the
 * TikTok Shop channel suggestion as a rincian so the AM can read where that
 * platform's GMV comes from; it is never emitted as its own `ChannelBaselineSuggestion`.
 * Mapping a mix category to `strategi_channel` would split one platform's baseline
 * across five phantom channels and double-count its GMV.
 */
export interface GmvMixRincian {
  videoAfiliasi: number | null;
  liveAfiliasi: number | null;
  videoToko: number | null;
  liveToko: number | null;
  kartuProdukDanLain: number | null;
}

/**
 * One channel's Section B baseline, proposed from that platform's riset-awal
 * analysis. Suggestion-only (same contract as RAB-09): nothing is written to
 * `strategi_channel` here — the AM reviews each figure in the Section B editor and
 * `saveChannels`/`saveBaseline` is the write. That is also why there is no
 * `sumber='riset_awal'` provenance column on `strategi_channel`.
 */
export interface ChannelBaselineSuggestion {
  clientPlatformId: number;
  platform: string;
  /** The platform mapped onto the D1 channel taxonomy. */
  channel: Channel;
  channelLain: string | null;
  metodeBaseline: string;
  kondisiToko: string;
  skor: number | null;
  /** Suggested window length (months filled, capped at the 1–6 the DB allows). */
  periodeBaselineBulan: number | null;
  /** 'cukup' (≥3 months) | 'kurang' (<3) | null when there is no analysis engine. */
  cakupanRiwayat: string | null;
  /**
   * RAB-11 DoD surfaced to the UI: when the window is under three months the DB
   * CHECK `ck_strch_alasan_pendek` (and `validateChannel`) REJECT the save unless
   * `alasan_periode_pendek` is filled. The AM sees this before saving, not after a
   * server rejection.
   */
  alasanPeriodePendekWajib: boolean;
  /** Rule 5 provenance, composed from `riset_awal_sumber_berkas` for this platform. */
  sumberData: string | null;
  tanggalAmbilData: string | null;
  lampiran: string | null;
  /** Period-aggregate figures offered at channel level (not per-month — see above). */
  roas: number | null;
  adSpend: string | null;
  aov: string | null;
  baselineBulan: BaselineMonthSuggestion[];
  /** RAB-12 — only for the analysed TikTok Shop store; null for every other channel. */
  gmvMix: GmvMixRincian | null;
}

export interface StrategiBaselinePrefill {
  interviewId: string;
  channels: ChannelBaselineSuggestion[];
}

/** D1 channel taxonomy for a client_platforms platform name. */
function platformToChannel(platform: string): { channel: Channel; channelLain: string | null } {
  const match = CHANNELS.find((c) => c !== 'Lainnya' && c.toLowerCase() === platform.trim().toLowerCase());
  if (match) return { channel: match, channelLain: null };
  return { channel: 'Lainnya', channelLain: platform.trim() };
}

function numOrNullLoose(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * getBaselinePrefill is the RAB-11 flow the backlog §3 calls for: the baseline
 * numbers + provenance the client's riset awal produced, shaped as Section B
 * channel suggestions. This is the path RAB-09 deliberately did NOT prefill — the
 * Section B numerics (`isStrategiBaselineForbidden`) live here instead.
 *
 * One `ChannelBaselineSuggestion` per analysed platform (one `riset_awal_analisa`
 * row). `gmv_mix` never becomes a channel of its own (RAB-12): it rides the TikTok
 * Shop suggestion as `gmvMix`. Returns `null` when the client has no scored
 * interview, or its riset awal produced no analysis rows.
 *
 * Read gate = `getStrategi`. Acceptance is NOT gated here (RAB-13): the baseline
 * becomes authoritative only when the AM saves it into the Draft and the Strategi
 * clears the existing submit → approve gate (machine #15) — there is no second gate.
 */
export async function getBaselinePrefill(
  sql: Queryable,
  actor: Actor,
  id: string,
): Promise<StrategiBaselinePrefill | null> {
  const head = await loadStrategiRow(sql, id);
  const ownerAm = await ownerAmOfContract(sql, head.contractId);
  if (!canReadStrategi(actor, ownerAm)) {
    throw new ForbiddenError(MSG_STRATEGI_FORBIDDEN);
  }

  const chosen = await latestScoredInterview(sql, actor, head.clientId);
  if (!chosen) return null;

  const analisa = await sql<
    {
      client_platform_id: string;
      platform: string;
      metode_baseline: string;
      kondisi_toko: string;
      skor: string | number | null;
      cakupan_riwayat: string | null;
      payload: Record<string, unknown> | null;
    }[]
  >`
    select client_platform_id, platform, metode_baseline, kondisi_toko, skor,
           cakupan_riwayat, payload
      from riset_awal_analisa
     where interview_id = ${chosen.id}
     order by client_platform_id`;
  if (analisa.length === 0) return null;

  // Provenance rows for the whole interview, grouped by platform: the source
  // files the AM uploaded are what legitimately fills Rule 5's sumber/lampiran.
  const berkas = await sql<
    { platform: string; nama_berkas: string; tanggal_ambil: string | Date | null }[]
  >`
    select platform, nama_berkas, tanggal_ambil
      from riset_awal_sumber_berkas
     where interview_id = ${chosen.id}
     order by platform, id`;
  const berkasByPlatform = new Map<string, { nama: string[]; tanggal: string | null }>();
  for (const b of berkas) {
    const key = b.platform;
    const g = berkasByPlatform.get(key) ?? { nama: [], tanggal: null };
    g.nama.push(b.nama_berkas);
    const t = dateOrNull(b.tanggal_ambil);
    if (t !== null && (g.tanggal === null || t > g.tanggal)) g.tanggal = t;
    berkasByPlatform.set(key, g);
  }

  const channels: ChannelBaselineSuggestion[] = analisa.map((a) => {
    const payload = (a.payload ?? {}) as {
      gmv_baseline?: { bulan_terisi?: unknown; cakupan_riwayat?: unknown; riwayat?: unknown[] } | null;
      gmv_mix?: Record<string, unknown> | null;
      toko?: { aov?: unknown } | null;
      iklan?: { belanja?: unknown; roas?: unknown } | null;
    };
    const gb = payload.gmv_baseline ?? null;
    const bulanTerisi = numOrNullLoose(gb?.bulan_terisi);
    const periodeBaselineBulan =
      bulanTerisi !== null && bulanTerisi >= 1 ? Math.min(bulanTerisi, 6) : null;
    // <3 months ⇒ Rule 5a reason required. Read from cakupan_riwayat when present
    // ('kurang'), else from the month count — the two agree by construction.
    const alasanPeriodePendekWajib =
      a.cakupan_riwayat === 'kurang' || (periodeBaselineBulan !== null && periodeBaselineBulan < 3);

    const riwayat = Array.isArray(gb?.riwayat) ? (gb!.riwayat as Record<string, unknown>[]) : [];
    const baselineBulan: BaselineMonthSuggestion[] = riwayat.slice(0, 6).map((h, i) => ({
      monthIndex: i + 1,
      label: (h.label as string | null) ?? null,
      gmv: numOrNullLoose(h.gmv) === null ? null : String(numOrNullLoose(h.gmv)),
      jumlahPesanan: numOrNullLoose(h.order),
    }));

    const mix = payload.gmv_mix ?? null;
    const gmvMix: GmvMixRincian | null =
      a.metode_baseline === 'analisa_penuh' && mix
        ? {
            videoAfiliasi: numOrNullLoose(mix.video_afiliasi),
            liveAfiliasi: numOrNullLoose(mix.live_afiliasi),
            videoToko: numOrNullLoose(mix.video_toko),
            liveToko: numOrNullLoose(mix.live_toko),
            kartuProdukDanLain: numOrNullLoose(mix.kartu_produk_dan_lain),
          }
        : null;

    const prov = berkasByPlatform.get(a.platform) ?? null;
    const aovNum = numOrNullLoose(payload.toko?.aov);
    const adSpendNum = numOrNullLoose(payload.iklan?.belanja);
    const { channel, channelLain } = platformToChannel(a.platform);

    return {
      clientPlatformId: Number(a.client_platform_id),
      platform: a.platform,
      channel,
      channelLain,
      metodeBaseline: a.metode_baseline,
      kondisiToko: a.kondisi_toko,
      skor: numOrNullLoose(a.skor),
      periodeBaselineBulan,
      cakupanRiwayat: a.cakupan_riwayat,
      alasanPeriodePendekWajib,
      sumberData: prov && prov.nama.length > 0 ? prov.nama.join(', ') : null,
      tanggalAmbilData: prov?.tanggal ?? null,
      lampiran: prov && prov.nama.length > 0 ? prov.nama.join(', ') : null,
      roas: numOrNullLoose(payload.iklan?.roas),
      adSpend: adSpendNum === null ? null : String(adSpendNum),
      aov: aovNum === null ? null : String(aovNum),
      baselineBulan,
      gmvMix,
    };
  });

  return { interviewId: chosen.id, channels };
}

async function loadDetail(sql: Queryable, head: Strategi): Promise<StrategiDetail> {
  const id = head.id;

  const channelRows = await sql<
    {
      id: string;
      channel: string;
      channel_lain: string | null;
      status_channel: string;
      nama_toko: string;
      url_toko: string;
      umur_toko_bulan: number | null;
      badge: string | null;
      target_tanggal_live: string | Date | null;
      prasyarat_pembukaan: unknown;
      sumber_data: string | null;
      tanggal_ambil_data: string | Date | null;
      lampiran: string | null;
      periode_baseline_bulan: number | null;
      periode_mulai: string | Date | null;
      periode_akhir: string | Date | null;
      alasan_periode_pendek: string | null;
      prioritas: string | null;
      prioritas_alasan: string | null;
      catatan_periode_pendek: string | null;
      // Section B groups B-2 … B-9 (A-06)
      pengunjung_per_bulan: number | null;
      conversion_rate_persen: string | null;
      trafik_organik_persen: string | null;
      trafik_iklan_persen: string | null;
      trafik_affiliate_persen: string | null;
      trafik_live_persen: string | null;
      trafik_video_persen: string | null;
      trafik_luar_persen: string | null;
      entry_point_utama: string | null;
      entry_point_catatan: string | null;
      sku_listed: number | null;
      sku_aktif: number | null;
      sku_pareto_80: number | null;
      top_sku: unknown;
      sku_slow_moving: number | null;
      sku_stok_kritis: unknown;
      listing_layak_persen: string | null;
      rating_toko: string | null;
      jumlah_ulasan: number | null;
      chat_response_rate_persen: string | null;
      chat_response_menit: number | null;
      pesanan_terlambat_persen: string | null;
      poin_penalti: number | null;
      catatan_penalti: string | null;
      tema_keluhan: unknown;
      tipe_kampanye: unknown;
      tipe_kampanye_tidak_ada: boolean;
      jumlah_kampanye_aktif: number | null;
      top_keyword: unknown;
      kampanye_boncos: unknown;
      affiliate_aktif_30hari: number | null;
      gmv_affiliate: string | null;
      gmv_affiliate_persen: string | null;
      komisi_open_persen: string | null;
      komisi_target_persen: string | null;
      top_kreator: unknown;
      program_sampel: string | null;
      program_sampel_catatan: string | null;
      jumlah_video_per_bulan: number | null;
      total_views: string | null;
      gmv_video: string | null;
      jam_live_per_bulan: string | null;
      gmv_live: string | null;
      gmv_per_jam_live: string | null;
      host_live: string | null;
      studio_live: string | null;
      studio_catatan: string | null;
      voucher_aktif: unknown;
      voucher_aktif_tidak_ada: boolean;
      program_platform: unknown;
      program_platform_tidak_ada: boolean;
      beban_promo_persen: string | null;
      kompetitor: unknown;
      kompetitor_lebih_baik: unknown;
      kompetitor_catatan: string | null;
      celah_kompetitor: string | null;
    }[]
  >`select * from strategi_channel where strategi_id = ${id} order by id asc`;

  const baselineRows = await sql<
    {
      channel_id: string;
      month_index: number;
      gmv: string;
      jumlah_pesanan: number;
      persen_batal: string;
      ad_spend: string;
      roas: string;
      acos: string;
      aov: string | null;
    }[]
  >`
    select b.* from strategi_baseline_bulan b
      join strategi_channel c on c.id = b.channel_id
     where c.strategi_id = ${id}
     order by b.channel_id asc, b.month_index asc`;

  const channels = channelRows.map((c) => {
    const baseline = baselineRows
      .filter((b) => Number(b.channel_id) === Number(c.id))
      .map((b) => ({
        monthIndex: b.month_index,
        gmv: b.gmv,
        jumlahPesanan: b.jumlah_pesanan,
        persenBatal: Number(b.persen_batal),
        adSpend: b.ad_spend,
        roas: Number(b.roas),
        acos: Number(b.acos),
        aov: b.aov,
      }));
    return {
      id: Number(c.id),
      channel: c.channel as Channel,
      channelLain: c.channel_lain,
      statusChannel: c.status_channel as ChannelState,
      namaToko: c.nama_toko,
      urlToko: c.url_toko,
      umurTokoBulan: c.umur_toko_bulan,
      badge: c.badge,
      targetTanggalLive: dateOrNull(c.target_tanggal_live),
      prasyaratPembukaan: strArray(c.prasyarat_pembukaan),
      sumberData: c.sumber_data,
      tanggalAmbilData: dateOrNull(c.tanggal_ambil_data),
      lampiran: c.lampiran,
      periodeBaselineBulan: c.periode_baseline_bulan,
      periodeMulai: dateOrNull(c.periode_mulai),
      periodeAkhir: dateOrNull(c.periode_akhir),
      alasanPeriodePendek: c.alasan_periode_pendek,
      catatanPeriodePendek: c.catatan_periode_pendek,
      prioritas: c.prioritas as ChannelPrioritas | null,
      prioritasAlasan: c.prioritas_alasan,
      // Section B (A-06)
      pengunjungPerBulan: c.pengunjung_per_bulan,
      conversionRatePersen: numOrNull(c.conversion_rate_persen),
      trafikOrganikPersen: numOrNull(c.trafik_organik_persen),
      trafikIklanPersen: numOrNull(c.trafik_iklan_persen),
      trafikAffiliatePersen: numOrNull(c.trafik_affiliate_persen),
      trafikLivePersen: numOrNull(c.trafik_live_persen),
      trafikVideoPersen: numOrNull(c.trafik_video_persen),
      trafikLuarPersen: numOrNull(c.trafik_luar_persen),
      entryPointUtama: c.entry_point_utama as EntryPoint | null,
      entryPointCatatan: c.entry_point_catatan,
      skuListed: c.sku_listed,
      skuAktif: c.sku_aktif,
      skuPareto80: c.sku_pareto_80,
      topSku: topSkusOf(c.top_sku),
      skuSlowMoving: c.sku_slow_moving,
      skuStokKritis: strArray(c.sku_stok_kritis),
      listingLayakPersen: numOrNull(c.listing_layak_persen),
      ratingToko: numOrNull(c.rating_toko),
      jumlahUlasan: c.jumlah_ulasan,
      chatResponseRatePersen: numOrNull(c.chat_response_rate_persen),
      chatResponseMenit: c.chat_response_menit,
      pesananTerlambatPersen: numOrNull(c.pesanan_terlambat_persen),
      poinPenalti: c.poin_penalti,
      catatanPenalti: c.catatan_penalti,
      temaKeluhan: strArray(c.tema_keluhan),
      tipeKampanye: strArray(c.tipe_kampanye) as CampaignType[],
      tipeKampanyeTidakAda: c.tipe_kampanye_tidak_ada,
      jumlahKampanyeAktif: c.jumlah_kampanye_aktif,
      topKeyword: topKeywordsOf(c.top_keyword),
      kampanyeBoncos: boncosOf(c.kampanye_boncos),
      affiliateAktif30Hari: c.affiliate_aktif_30hari,
      gmvAffiliate: c.gmv_affiliate,
      gmvAffiliatePersen: numOrNull(c.gmv_affiliate_persen),
      komisiOpenPersen: numOrNull(c.komisi_open_persen),
      komisiTargetPersen: numOrNull(c.komisi_target_persen),
      topKreator: kreatorsOf(c.top_kreator),
      programSampel: c.program_sampel as SampleProgram | null,
      programSampelCatatan: c.program_sampel_catatan,
      jumlahVideoPerBulan: c.jumlah_video_per_bulan,
      totalViews: numOrNull(c.total_views),
      gmvVideo: c.gmv_video,
      jamLivePerBulan: numOrNull(c.jam_live_per_bulan),
      gmvLive: c.gmv_live,
      gmvPerJamLive: c.gmv_per_jam_live,
      hostLive: c.host_live as LiveHost | null,
      studioLive: c.studio_live as StudioState | null,
      studioCatatan: c.studio_catatan,
      voucherAktif: vouchersOf(c.voucher_aktif),
      voucherAktifTidakAda: c.voucher_aktif_tidak_ada,
      programPlatform: strArray(c.program_platform) as PlatformProgram[],
      programPlatformTidakAda: c.program_platform_tidak_ada,
      bebanPromoPersen: numOrNull(c.beban_promo_persen),
      kompetitor: kompetitorsOf(c.kompetitor),
      kompetitorLebihBaik: strArray(c.kompetitor_lebih_baik) as CompetitorEdge[],
      kompetitorCatatan: c.kompetitor_catatan,
      celahKompetitor: c.celah_kompetitor,
      // B-1.5 — derived, never stored.
      ...trenBaseline(baseline),
      baseline,
    };
  });

  const aksesRows = await sql<
    {
      id: string;
      channel: string;
      akses: string;
      status: string;
      memblokir: boolean;
      target_tanggal_beres: string | Date | null;
      catatan: string;
    }[]
  >`select * from strategi_akses where strategi_id = ${id}
     order by channel asc, akses asc`;

  // Section C (A-07)
  const diagnosaRows = await sql<
    {
      id: string;
      channel: string;
      bottleneck: string;
      field_ids: unknown;
      akar_masalah: string | null;
      gap_kompetitor: string | null;
    }[]
  >`select id, channel, bottleneck, field_ids, akar_masalah, gap_kompetitor
      from strategi_diagnosa where strategi_id = ${id}
     order by channel asc`;

  const quickWinRows = await sql<
    {
      id: string;
      aksi: string;
      channel: string;
      pic_divisi: string;
      dampak_diharapkan: string;
      urutan: number;
    }[]
  >`select id, aksi, channel, pic_divisi, dampak_diharapkan, urutan
      from strategi_quick_win where strategi_id = ${id}
     order by urutan asc, id asc`;

  const risikoStrukturalRows = await sql<
    { id: string; risiko: string; urutan: number }[]
  >`select id, risiko, urutan from strategi_risiko_struktural
     where strategi_id = ${id} order by urutan asc, id asc`;

  const prasyaratRows = await sql<
    {
      id: string;
      item: string;
      pic_klien: string;
      deadline: string | Date | null;
      urutan: number;
    }[]
  >`select id, item, pic_klien, deadline, urutan
      from strategi_prasyarat_klien where strategi_id = ${id}
     order by urutan asc, id asc`;

  const targetRows = await sql<
    {
      channel: string;
      month_index: number;
      metric: string;
      nilai_floor: string | null;
      nilai_stretch: string;
      sumber_floor: string | null;
    }[]
  >`select * from strategi_target where strategi_id = ${id}
     order by metric asc, channel asc, month_index asc`;

  const targets: StrategiTarget[] = targetRows.map((t) => ({
    channel: t.channel,
    monthIndex: t.month_index,
    metric: t.metric as TargetMetric,
    nilaiFloor: t.nilai_floor,
    nilaiStretch: t.nilai_stretch,
    sumberFloor: t.sumber_floor as FloorSource | null,
  }));

  const assumptionRows = await sql<
    {
      kode: string;
      asumsi: string;
      pemilik: string;
      cara_verifikasi: string;
      status: string;
      target_terkait: unknown;
    }[]
  >`select * from strategi_assumption where strategi_id = ${id} order by kode asc`;

  const pillarRows = await sql<
    {
      id: string;
      jenis: string;
      channel: string | null;
      urutan: number;
      sku: string | null;
      peran: string | null;
      aksi: string;
      target: string;
      harga_normal: string | null;
      harga_promo: string | null;
      floor_price: string | null;
      vendor_id: string | null;
      slot_jam: string | null;
      tarif: string | null;
      target_gmv_per_jam: string | null;
      detail: unknown;
    }[]
  >`select * from strategi_pillar where strategi_id = ${id} order by urutan asc, id asc`;

  const resourceRows = await sql<
    {
      id: string;
      jenis: string;
      channel: string | null;
      divisi: string | null;
      nilai: string | null;
      jumlah: string | null;
      satuan: string | null;
      sumber_dana: string | null;
      vendor_id: string | null;
      skema_biaya: string | null;
      catatan: string;
    }[]
  >`select * from strategi_resource where strategi_id = ${id} order by jenis asc, id asc`;

  const riskRows = await sql<
    {
      id: string;
      risiko: string;
      dampak: string;
      kemungkinan: string;
      mitigasi: string;
      pic: string;
      urutan: number;
    }[]
  >`select * from strategi_risk where strategi_id = ${id} order by urutan asc, id asc`;

  // --- A-09b child rows -----------------------------------------------------
  const ketergantunganRows = await sql<
    { id: string; item: string; kapan: string; konsekuensi: string; urutan: number }[]
  >`select * from strategi_ketergantungan_klien where strategi_id = ${id}
     order by urutan asc, id asc`;

  const faseRows = await sql<
    {
      id: string;
      nama: string;
      tanggal_mulai: string | Date;
      tanggal_akhir: string | Date;
      tujuan: string;
      kriteria_lulus: string;
      urutan: number;
    }[]
  >`select * from strategi_fase where strategi_id = ${id} order by urutan asc, id asc`;

  const tanggalBesarRows = await sql<
    { id: string; tanggal: string | Date; nama: string; peran: string; urutan: number }[]
  >`select * from strategi_tanggal_besar where strategi_id = ${id}
     order by tanggal asc, id asc`;

  const triggerRows = await sql<
    { id: string; kode: string; ambang: string | null; catatan: string | null; urutan: number }[]
  >`select * from strategi_trigger_revisi where strategi_id = ${id}
     order by urutan asc, id asc`;

  const dispatchRows = await sql<
    { id: string; divisi: string; urutan: number; catatan: string | null }[]
  >`select * from strategi_dispatch where strategi_id = ${id} order by urutan asc`;

  const visRows = await loadFieldVisibility(sql, id);

  const eventRows = await sql<
    {
      versi_no: number;
      peristiwa: string;
      aktor: string;
      catatan: string | null;
      trigger_revisi: unknown;
      alasan_revisi: string | null;
      asumsi_gugur: unknown;
      created_at: string | Date;
    }[]
  >`select * from strategi_version where strategi_id = ${id} order by id asc`;

  return {
    ...head,
    channels,
    akses: aksesRows.map((a) => ({
      id: Number(a.id),
      channel: a.channel as AccessChannel,
      akses: a.akses as AccessKind,
      status: a.status as AccessState,
      memblokir: a.memblokir,
      targetTanggalBeres: dateOrNull(a.target_tanggal_beres),
      catatan: a.catatan,
    })),
    diagnosa: diagnosaRows.map((d) => ({
      id: Number(d.id),
      channel: d.channel,
      bottleneck: d.bottleneck as BottleneckKind,
      fieldIds: strArray(d.field_ids),
      akarMasalah: d.akar_masalah,
      gapKompetitor: d.gap_kompetitor,
    })),
    quickWins: quickWinRows.map((q) => ({
      id: Number(q.id),
      aksi: q.aksi,
      channel: q.channel,
      picDivisi: q.pic_divisi,
      dampakDiharapkan: q.dampak_diharapkan,
      urutan: q.urutan,
    })),
    risikoStruktural: risikoStrukturalRows.map((r) => ({
      id: Number(r.id),
      risiko: r.risiko,
      urutan: r.urutan,
    })),
    prasyaratKlien: prasyaratRows.map((p) => ({
      id: Number(p.id),
      item: p.item,
      picKlien: p.pic_klien,
      deadline: dateOrNull(p.deadline),
      urutan: p.urutan,
    })),
    targets: targets,
    // D-3 (X-11): derived here rather than in the route, so every reader of the
    // detail — API, tests, a future job — sees the same number from the same
    // place. There is no second definition to drift from.
    komposisiKontribusi: komposisiKontribusi(targets),
    assumptions: assumptionRows.map((a) => ({
      kode: a.kode,
      asumsi: a.asumsi,
      pemilik: a.pemilik,
      caraVerifikasi: a.cara_verifikasi,
      status: a.status as AssumptionState,
      targetTerkait: strArray(a.target_terkait),
    })),
    pillars: pillarRows.map((p) => ({
      id: Number(p.id),
      jenis: p.jenis as PillarKind,
      channel: p.channel,
      urutan: p.urutan,
      sku: p.sku,
      peran: p.peran,
      aksi: p.aksi,
      target: p.target,
      hargaNormal: p.harga_normal,
      hargaPromo: p.harga_promo,
      floorPrice: p.floor_price,
      vendorId: p.vendor_id,
      slotJam: p.slot_jam === null ? null : Number(p.slot_jam),
      tarif: p.tarif,
      targetGmvPerJam: p.target_gmv_per_jam,
      detail: (p.detail ?? {}) as Record<string, unknown>,
    })),
    resources: resourceRows.map((r) => ({
      id: Number(r.id),
      jenis: r.jenis as ResourceKind,
      channel: r.channel,
      divisi: r.divisi,
      nilai: r.nilai,
      jumlah: r.jumlah === null ? null : Number(r.jumlah),
      satuan: r.satuan,
      sumberDana: r.sumber_dana as 'klien' | 'paket_mea' | null,
      vendorId: r.vendor_id,
      skemaBiaya: r.skema_biaya,
      catatan: r.catatan,
    })),
    risks: riskRows.map((r) => ({
      id: Number(r.id),
      risiko: r.risiko,
      dampak: r.dampak as RiskLevel,
      kemungkinan: r.kemungkinan as RiskLevel,
      mitigasi: r.mitigasi,
      pic: r.pic,
      urutan: r.urutan,
    })),
    ketergantungan: ketergantunganRows.map((k) => ({
      id: Number(k.id),
      item: k.item,
      kapan: k.kapan,
      konsekuensi: k.konsekuensi,
      urutan: k.urutan,
    })),
    fase: faseRows.map((f) => ({
      id: Number(f.id),
      nama: f.nama,
      tanggalMulai: dateStr(f.tanggal_mulai),
      tanggalAkhir: dateStr(f.tanggal_akhir),
      tujuan: f.tujuan,
      kriteriaLulus: f.kriteria_lulus,
      urutan: f.urutan,
    })),
    tanggalBesar: tanggalBesarRows.map((t) => ({
      id: Number(t.id),
      tanggal: dateStr(t.tanggal),
      nama: t.nama,
      peran: t.peran,
      urutan: t.urutan,
    })),
    triggerRevisi: triggerRows.map((t) => ({
      id: Number(t.id),
      kode: t.kode as TriggerRevisiCode,
      // `numeric` arrives as a string from postgres.js. A threshold is a
      // COUNT (percent, or days) — not money — so `Number` is the right
      // representation here, unlike every rupiah figure on this boundary.
      ambang: t.ambang === null ? null : Number(t.ambang),
      catatan: t.catatan,
      urutan: t.urutan,
    })),
    dispatch: dispatchRows.map((d) => ({
      id: Number(d.id),
      divisi: d.divisi as DispatchDivision,
      urutan: d.urutan,
      catatan: d.catatan,
    })),
    visibilitas: visRows,
    riwayat: eventRows.map((e) => ({
      versiNo: e.versi_no,
      peristiwa: e.peristiwa,
      aktor: e.aktor,
      catatan: e.catatan,
      triggerRevisi: strArray(e.trigger_revisi),
      alasanRevisi: e.alasan_revisi,
      asumsiGugur: strArray(e.asumsi_gugur),
      createdAt: new Date(e.created_at).toISOString(),
    })),
  };
}

/**
 * listStrategiForService returns every version, newest first.
 *
 * Versions are rows (Rule 13), so "the history" is a list here, not a diff of
 * one row — an archived version stays readable exactly as it was approved.
 */
export async function listStrategiForService(
  sql: Queryable,
  actor: Actor,
  serviceId: string,
): Promise<Strategi[]> {
  const ownerAm = await ownerAmOf(sql, serviceId);
  if (!canReadStrategi(actor, ownerAm)) {
    throw new ForbiddenError(MSG_STRATEGI_FORBIDDEN);
  }
  // O57: the Strategi hangs off the agreement, so the Service is the way IN, not
  // the owner. A Service with no agreement yet has no Strategi by construction —
  // an empty list, not an error.
  const rows = await sql<StrategiRow[]>`
    select s.*, ct.durasi_bulan as durasi_kontrak_bulan,
           ct.tanggal_mulai as tanggal_mulai_kontrak,
           ct.tanggal_akhir as tanggal_akhir_kontrak
      from strategi s
      join contracts ct on ct.id = s.contract_id
      join services sv on sv.contract_id = s.contract_id
     where sv.id = ${serviceId}
     order by s.versi_no desc`;
  return rows.map(rowToStrategi);
}

/** activeStrategi returns the one `Aktif` version, or null. Rule 2 guarantees ≤1. */
export async function activeStrategi(sql: Queryable, serviceId: string): Promise<Strategi | null> {
  const rows = await sql<StrategiRow[]>`
    select s.*, ct.durasi_bulan as durasi_kontrak_bulan,
           ct.tanggal_mulai as tanggal_mulai_kontrak,
           ct.tanggal_akhir as tanggal_akhir_kontrak
      from strategi s
      join contracts ct on ct.id = s.contract_id
      join services sv on sv.contract_id = s.contract_id
     where sv.id = ${serviceId} and s.status = ${STRATEGI_AKTIF}`;
  return rows.length === 0 ? null : rowToStrategi(rows[0]);
}

// ---------------------------------------------------------------------------
// Header validation
// ---------------------------------------------------------------------------

function normalizeHeader(input: StrategiHeaderInput): Required<StrategiHeaderInput> {
  const mulai = (input.tanggalMulaiKontrak ?? '').trim();
  const akhir = (input.tanggalAkhirKontrak ?? '').trim();
  const siklus = (input.tanggalMulaiSiklus ?? '')?.toString().trim() ?? '';
  if (!RE_DATE.test(mulai) || !RE_DATE.test(akhir)) {
    throw new ValidationError(MSG_INCOMPLETE);
  }
  if (akhir <= mulai) {
    throw new ValidationError(MSG_INCOMPLETE);
  }
  const durasi = Number(input.durasiKontrakBulan);
  if (!Number.isInteger(durasi) || durasi < 1 || durasi > 36) {
    throw new ValidationError(MSG_INCOMPLETE);
  }
  if (siklus !== '' && !RE_DATE.test(siklus)) {
    throw new ValidationError(MSG_INCOMPLETE);
  }
  const toleransi = input.toleransiOverPersen ?? 20;
  if (!(toleransi >= 0 && toleransi <= 100)) {
    throw new ValidationError(MSG_INCOMPLETE);
  }
  return {
    durasiKontrakBulan: durasi,
    tanggalMulaiKontrak: mulai,
    tanggalAkhirKontrak: akhir,
    // RA-5 (backlog X-05) DIPUTUS PEMILIK 2026-08-07: G-0 defaults to the
    // contract start date, and the AM overrides it only when the client wants
    // reporting aligned to something else. So a blank G-0 is no longer "belum
    // dijawab" — it is "pakai default", and the stored value is a real date the
    // AM can see rather than a null that B-02 would have to guess around.
    //
    // `mulai` IS the contract start, not a second opinion about it:
    // `ensureContractForService` rejects a window that disagrees with the stored
    // agreement (`MSG_WINDOW_MISMATCH`), so the default cannot drift from
    // `contracts.tanggal_mulai` even when the Service was grouped earlier.
    tanggalMulaiSiklus: siklus === '' ? mulai : siklus,
    toleransiOverPersen: toleransi,
  };
}

// ---------------------------------------------------------------------------
// Writes — header
// ---------------------------------------------------------------------------

/**
 * createStrategi opens version 1 in `Draft` for a plan-gated Service (Rule 1).
 *
 * "Plan-gated" is resolved through the M6C precedence (`effectiveGate`), not by
 * reading a boolean: for the middle tier the effective answer is the AM's
 * recorded G-B decision, and duplicating that precedence here would create the
 * second copy M6C exists to prevent.
 */
export async function createStrategi(
  sql: Sql,
  actor: Actor,
  serviceId: string,
  input: StrategiHeaderInput,
): Promise<Strategi> {
  const head = normalizeHeader(input);
  const now = new Date();

  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const svc = await loadServiceContext(tx, serviceId);
    if (!canWriteStrategi(actor, svc.ownerAm)) {
      throw new ForbiddenError(MSG_NOT_OWNER_AM);
    }
    const eff = effectiveGate({
      tier: svc.tier,
      override: svc.override,
      keputusanAm: (svc.gateDecision as 'butuh_plan' | 'tanpa_plan' | null) ?? null,
    });
    if (!eff.requiresPlan) {
      throw new ConflictError(MSG_NOT_PLAN_GATED);
    }
    // O57: the Strategi hangs off the agreement. A Service that has not been
    // grouped yet gets a 1:1 Contract minted here from the window the AM typed —
    // the same shape the old AM-declared columns produced — so the endpoint keeps
    // working unchanged while the window gains a single owner.
    const contractId = await contract.ensureContractForService(
      tx,
      actor,
      serviceId,
      svc.clientId,
      svc.contractId,
      {
        durasiBulan: head.durasiKontrakBulan,
        tanggalMulai: head.tanggalMulaiKontrak,
        tanggalAkhir: head.tanggalAkhirKontrak,
      },
    );

    // Rule 2 is now per AGREEMENT: a second Service under the same contract must
    // not open a second Strategi — that is the whole point of O57 option (a).
    const existing = await tx<{ id: string }[]>`
      select id from strategi
       where contract_id = ${contractId}
         and status in (${STRATEGI_DRAFT}, ${STRATEGI_DIAJUKAN}, ${STRATEGI_AKTIF}, ${STRATEGI_DRAFT_REVISI})`;
    if (existing.length > 0) {
      throw new ConflictError(MSG_STRATEGI_EXISTS);
    }

    const id = await ident.nextId(ex.ident, 'STRG', now);
    await tx`
      insert into strategi
        (id, contract_id, client_id, versi_no, status, tanggal_mulai_siklus,
         toleransi_over_persen, created_by)
      values
        (${id}, ${contractId}, ${svc.clientId}, 1, ${STRATEGI_DRAFT}, ${head.tanggalMulaiSiklus},
         ${head.toleransiOverPersen}, ${actor.employeeId})`;

    // A-10 / §7 — the overlay is seeded with the §4.1 defaults at creation, so
    // the document carries its own visibility rather than borrowing today's
    // constant every time it is rendered.
    await seedFieldVisibility(tx, id, actor.employeeId);

    await appendEvent(tx, id, 1, 'dibuat', actor.employeeId, null);
    await ex.audit.insertAudit({
      entityType: ENTITY_STRATEGI,
      entityId: id,
      actorEmployeeId: actor.employeeId,
      action: 'create',
      beforeJson: null,
      afterJson: { contract_id: contractId, service_id: serviceId, versi_no: 1, status: STRATEGI_DRAFT },
      createdBy: actor.employeeId,
    });

    return loadStrategiRow(tx, id);
  });
}

/**
 * updateHeader edits the contract window, G-0 and F-7 while the record is a
 * draft. Rule 17 is enforced twice on purpose: the DB trigger is the wall (it
 * also stops a service-role call), this is the BI message.
 */
export async function updateHeader(
  sql: Sql,
  actor: Actor,
  id: string,
  input: StrategiHeaderInput,
): Promise<Strategi> {
  const head = normalizeHeader(input);
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const before = await requireDraftAndWriter(tx, actor, id);
    if (before.siklusTerkunci && head.tanggalMulaiSiklus !== before.tanggalMulaiSiklus) {
      throw new ConflictError(MSG_CYCLE_LOCKED);
    }
    // O57: the window is the AGREEMENT's, so editing it here writes `contracts`
    // — one storage location, still one user action and one transaction. The
    // Contract-side gate (`MSG_WINDOW_LOCKED`) does not fire for this Strategi's
    // own existence; that would make the window uneditable from the moment the
    // draft is created, which is exactly the screen the AM is on.
    const windowChanged =
      head.durasiKontrakBulan !== before.durasiKontrakBulan ||
      head.tanggalMulaiKontrak !== before.tanggalMulaiKontrak ||
      head.tanggalAkhirKontrak !== before.tanggalAkhirKontrak;
    if (windowChanged) {
      await tx`
        update contracts
           set durasi_bulan = ${head.durasiKontrakBulan},
               tanggal_mulai = ${head.tanggalMulaiKontrak},
               tanggal_akhir = ${head.tanggalAkhirKontrak}
         where id = ${before.contractId}`;
    }
    await tx`
      update strategi
         set tanggal_mulai_siklus = ${head.tanggalMulaiSiklus},
             toleransi_over_persen = ${head.toleransiOverPersen}
       where id = ${id}`;
    await ex.audit.insertAudit({
      entityType: ENTITY_STRATEGI,
      entityId: id,
      actorEmployeeId: actor.employeeId,
      action: 'update_header',
      beforeJson: {
        durasi_kontrak_bulan: before.durasiKontrakBulan,
        tanggal_mulai_kontrak: before.tanggalMulaiKontrak,
        tanggal_akhir_kontrak: before.tanggalAkhirKontrak,
        tanggal_mulai_siklus: before.tanggalMulaiSiklus,
      },
      afterJson: {
        durasi_kontrak_bulan: head.durasiKontrakBulan,
        tanggal_mulai_kontrak: head.tanggalMulaiKontrak,
        tanggal_akhir_kontrak: head.tanggalAkhirKontrak,
        tanggal_mulai_siklus: head.tanggalMulaiSiklus,
      },
      createdBy: actor.employeeId,
    });
    return loadStrategiRow(tx, id);
  });
}

// ---------------------------------------------------------------------------
// Writes — Section A (A-05)
// ---------------------------------------------------------------------------

/** Section A input. Everything optional: a partial save is the normal case. */
export interface KonteksInput {
  namaBrand?: string | null;
  kategoriUtama?: string | null;
  subKategori?: string[];
  modelBisnis?: BusinessModel | null;
  marginKotorPersen?: number | null;
  posisiHarga?: PricePosition | null;
  usp?: string[];
  kapasitasStok?: StockCapacity | null;
  leadTimeRestockHari?: number | null;
  plafonUnitPerBulan?: number | null;
  titikKirimKota?: string | null;
  titikKirimDetail?: string | null;
  ekspektasiKlien?: string | null;
  riwayatAgensi?: string | null;
  pantanganKlien?: string[];
  pantanganKlienTidakAda?: boolean;
  decisionMaker?: StrategiDecisionMaker[];
  slaKlienJam?: number | null;
  slaKlienCatatan?: string | null;
  asetDariKlien?: string[];
  asetDariKlienTidakAda?: boolean;
  asetCatatan?: string | null;
}

/**
 * saveKonteks replaces Section A.
 *
 * A replace-in-place UPDATE, not a replace-set: Section A is filled once per
 * Strategi (§4 "Filled once, not per channel"), so it is columns on the parent.
 *
 * What is validated here is SHAPE, not completeness — an enum outside its list,
 * a percentage above 100, a decision-maker row with no name. Presence of the 16
 * required answers is checked by `checkCompleteness` at submit, because §7 asks
 * for autosave every 20s and §5 step 5 asks for a live count of what is still
 * missing; both need a half-filled Section A to be storable.
 */
export async function saveKonteks(
  sql: Sql,
  actor: Actor,
  id: string,
  input: KonteksInput,
): Promise<StrategiDetail> {
  const k = normalizeKonteks(input);
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const before = await requireDraftAndWriter(tx, actor, id);
    await tx`
      update strategi
         set nama_brand = ${k.namaBrand},
             kategori_utama = ${k.kategoriUtama},
             sub_kategori = ${k.subKategori as never},
             model_bisnis = ${k.modelBisnis},
             margin_kotor_persen = ${k.marginKotorPersen},
             posisi_harga = ${k.posisiHarga},
             usp = ${k.usp as never},
             kapasitas_stok = ${k.kapasitasStok},
             lead_time_restock_hari = ${k.leadTimeRestockHari},
             plafon_unit_per_bulan = ${k.plafonUnitPerBulan},
             titik_kirim_kota = ${k.titikKirimKota},
             titik_kirim_detail = ${k.titikKirimDetail},
             ekspektasi_klien = ${k.ekspektasiKlien},
             riwayat_agensi = ${k.riwayatAgensi},
             pantangan_klien = ${k.pantanganKlien as never},
             pantangan_klien_tidak_ada = ${k.pantanganKlienTidakAda},
             decision_maker = ${k.decisionMaker.map(dmToJson) as never},
             sla_klien_jam = ${k.slaKlienJam},
             sla_klien_catatan = ${k.slaKlienCatatan},
             aset_dari_klien = ${k.asetDariKlien as never},
             aset_dari_klien_tidak_ada = ${k.asetDariKlienTidakAda},
             aset_catatan = ${k.asetCatatan}
       where id = ${id}`;
    await ex.audit.insertAudit({
      entityType: ENTITY_STRATEGI,
      entityId: id,
      actorEmployeeId: actor.employeeId,
      action: 'save_konteks',
      beforeJson: {
        nama_brand: before.namaBrand,
        model_bisnis: before.modelBisnis,
        margin_kotor_persen: before.marginKotorPersen,
        posisi_harga: before.posisiHarga,
        usp: before.usp,
      },
      afterJson: {
        nama_brand: k.namaBrand,
        model_bisnis: k.modelBisnis,
        margin_kotor_persen: k.marginKotorPersen,
        posisi_harga: k.posisiHarga,
        usp: k.usp,
      },
      createdBy: actor.employeeId,
    });
    return loadDetail(tx, await loadStrategiRow(tx, id));
  });
}

// --- jsonb serialisers. Keys go out snake_case so the stored document reads the
// way the wire body does; postgres.js receives the OBJECT, never a JSON string
// (a stringified value lands as jsonb of type `string` and fails the array CHECK).

function topSkuToJson(s: StrategiTopSku): Record<string, unknown> {
  return {
    nama: s.nama,
    gmv: s.gmv,
    unit_terjual: s.unitTerjual,
    harga_jual: s.hargaJual,
    margin_persen: s.marginPersen,
  };
}

function keywordToJson(k: StrategiTopKeyword): Record<string, unknown> {
  return { keyword: k.keyword, jumlah_order: k.jumlahOrder };
}

function boncosToJson(k: StrategiKampanyeBoncos): Record<string, unknown> {
  return { nama: k.nama, spend: k.spend };
}

function kreatorToJson(k: StrategiTopKreator): Record<string, unknown> {
  return { nama: k.nama, gmv: k.gmv };
}

function voucherToJson(v: StrategiVoucher): Record<string, unknown> {
  return { tipe: v.tipe, nilai: v.nilai, syarat: v.syarat };
}

function kompetitorToJson(k: StrategiKompetitor): Record<string, unknown> {
  return {
    nama: k.nama,
    url: k.url,
    harga_sebanding: k.hargaSebanding,
    estimasi_penjualan_bulan: k.estimasiPenjualanBulan,
  };
}

function dmToJson(d: StrategiDecisionMaker): Record<string, unknown> {
  return {
    nama: d.nama,
    jabatan: d.jabatan,
    berhak_approve: d.berhakApprove,
    jalur_eskalasi: d.jalurEskalasi,
  };
}

function normalizeKonteks(input: KonteksInput): StrategiKonteks {
  const persen = (v: number | null | undefined, max = 100): number | null => {
    if (v === null || v === undefined) return null;
    const n = Number(v);
    if (Number.isNaN(n) || n < 0 || n > max) throw new ValidationError(MSG_INCOMPLETE);
    return n;
  };
  const nonNeg = (v: number | null | undefined): number | null => {
    if (v === null || v === undefined) return null;
    const n = Number(v);
    if (Number.isNaN(n) || n < 0) throw new ValidationError(MSG_INCOMPLETE);
    return n;
  };
  const inSet = <T extends string>(v: unknown, set: readonly T[]): T | null => {
    const s = nullIfBlank(v as string | null | undefined);
    if (s === null) return null;
    if (!(set as readonly string[]).includes(s)) throw new ValidationError(MSG_INCOMPLETE);
    return s as T;
  };
  // Blank entries are dropped rather than rejected: the form shows an empty row
  // for the next item, and autosave must not fail on it.
  const list = (v: string[] | undefined): string[] =>
    (v ?? []).map((s) => String(s).trim()).filter((s) => s !== '');

  const aset = list(input.asetDariKlien);
  for (const a of aset) {
    if (!(CLIENT_ASSETS as readonly string[]).includes(a)) {
      throw new ValidationError(MSG_INCOMPLETE);
    }
  }
  // O58 — "tidak ada" is an ANSWER, so it cannot coexist with items. The DB
  // CHECKs reject the contradiction too; catching it here means the AM gets the
  // BI message instead of a constraint-violation 500. Resolving it silently (by
  // clearing one side) would be worse: which side the AM meant is exactly the
  // thing we cannot know.
  const pantangan = list(input.pantanganKlien);
  const pantanganTidakAda = input.pantanganKlienTidakAda === true;
  const asetTidakAda = input.asetDariKlienTidakAda === true;
  if ((pantanganTidakAda && pantangan.length > 0) || (asetTidakAda && aset.length > 0)) {
    throw new ValidationError(MSG_INCOMPLETE);
  }
  // A-12: a row without a name and a role names nobody. Fully blank rows are the
  // form's placeholder and are dropped; a half-typed one is a real mistake.
  const dm = (input.decisionMaker ?? [])
    .map((d) => ({
      nama: String(d.nama ?? '').trim(),
      jabatan: String(d.jabatan ?? '').trim(),
      berhakApprove: d.berhakApprove === true,
      jalurEskalasi: String(d.jalurEskalasi ?? '').trim(),
    }))
    .filter((d) => !(d.nama === '' && d.jabatan === '' && d.jalurEskalasi === ''));
  for (const d of dm) {
    if (d.nama === '' || d.jabatan === '') throw new ValidationError(MSG_INCOMPLETE);
  }

  return {
    namaBrand: nullIfBlank(input.namaBrand),
    kategoriUtama: nullIfBlank(input.kategoriUtama),
    subKategori: list(input.subKategori),
    modelBisnis: inSet(input.modelBisnis, BUSINESS_MODELS),
    marginKotorPersen: persen(input.marginKotorPersen),
    posisiHarga: inSet(input.posisiHarga, PRICE_POSITIONS),
    usp: list(input.usp),
    kapasitasStok: inSet(input.kapasitasStok, STOCK_CAPACITIES),
    leadTimeRestockHari: nonNeg(input.leadTimeRestockHari),
    plafonUnitPerBulan: nonNeg(input.plafonUnitPerBulan),
    titikKirimKota: nullIfBlank(input.titikKirimKota),
    titikKirimDetail: nullIfBlank(input.titikKirimDetail),
    ekspektasiKlien: nullIfBlank(input.ekspektasiKlien),
    riwayatAgensi: nullIfBlank(input.riwayatAgensi),
    pantanganKlien: pantangan,
    pantanganKlienTidakAda: pantanganTidakAda,
    decisionMaker: dm,
    slaKlienJam: nonNeg(input.slaKlienJam),
    slaKlienCatatan: nullIfBlank(input.slaKlienCatatan),
    asetDariKlien: aset as ClientAsset[],
    asetDariKlienTidakAda: asetTidakAda,
    asetCatatan: nullIfBlank(input.asetCatatan),
  };
}

// ---------------------------------------------------------------------------
// Writes — A-15 / A-16 access matrix
// ---------------------------------------------------------------------------

/** A-15 row input; `memblokir` + `targetTanggalBeres` are A-16 on the same row. */
export interface AksesInput {
  channel: AccessChannel;
  akses: AccessKind;
  status: AccessState;
  memblokir?: boolean;
  targetTanggalBeres?: string | null;
  catatan?: string;
}

/**
 * saveAkses replaces the A-15 matrix.
 *
 * Two validations that are not shape checks:
 *
 * 1. A channel other than `Umum` must be one of THIS Strategi's contracted
 *    channels. An access row against a channel nobody sells on is a blocker
 *    nobody will ever clear, and §5 step 3 puts these rows on the SPV dashboard.
 * 2. A blocker (A-16) must carry a target date. Without one it is a complaint;
 *    with one it is a work item that can fall due.
 */
export async function saveAkses(
  sql: Sql,
  actor: Actor,
  id: string,
  rows: AksesInput[],
): Promise<StrategiDetail> {
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    await requireDraftAndWriter(tx, actor, id);

    const contracted = new Set(
      (
        await tx<{ channel: string }[]>`
          select channel from strategi_channel where strategi_id = ${id}`
      ).map((c) => c.channel),
    );

    const seen = new Set<string>();
    for (const r of rows) {
      if (
        !(ACCESS_CHANNELS as readonly string[]).includes(r.channel) ||
        !(ACCESS_KINDS as readonly string[]).includes(r.akses) ||
        !(ACCESS_STATES as readonly string[]).includes(r.status)
      ) {
        throw new ValidationError(MSG_INCOMPLETE);
      }
      if (r.channel !== ACCESS_CHANNEL_UMUM && !contracted.has(r.channel)) {
        throw new ValidationError(MSG_CHANNEL_NOT_FOUND);
      }
      const key = `${r.channel}:${r.akses}`;
      if (seen.has(key)) {
        throw new ValidationError(MSG_AKSES_DUPLICATE);
      }
      seen.add(key);
      const memblokir = r.memblokir === true;
      if (memblokir) {
        if (r.status === 'sudah' || !RE_DATE.test((r.targetTanggalBeres ?? '').trim())) {
          throw new ValidationError(MSG_AKSES_BLOCKER_DATE);
        }
      }
      if (
        (r.targetTanggalBeres ?? '').trim() !== '' &&
        !RE_DATE.test((r.targetTanggalBeres ?? '').trim())
      ) {
        throw new ValidationError(MSG_INCOMPLETE);
      }
    }

    await tx`delete from strategi_akses where strategi_id = ${id}`;
    for (const r of rows) {
      await tx`
        insert into strategi_akses
          (strategi_id, channel, akses, status, memblokir, target_tanggal_beres, catatan, created_by)
        values
          (${id}, ${r.channel}, ${r.akses}, ${r.status}, ${r.memblokir === true},
           ${nullIfBlank(r.targetTanggalBeres)}, ${(r.catatan ?? '').trim()}, ${actor.employeeId})`;
    }
    await ex.audit.insertAudit({
      entityType: ENTITY_STRATEGI,
      entityId: id,
      actorEmployeeId: actor.employeeId,
      action: 'save_akses',
      beforeJson: null,
      afterJson: {
        count: rows.length,
        blocker: rows.filter((r) => r.memblokir === true).map((r) => `${r.channel}:${r.akses}`),
      },
      createdBy: actor.employeeId,
    });
    return loadDetail(tx, await loadStrategiRow(tx, id));
  });
}

// ---------------------------------------------------------------------------
// Writes — child sets
// ---------------------------------------------------------------------------
//
// Every child write is a REPLACE-SET inside one transaction: the section is
// saved whole, not row by row. Two reasons. (a) The form saves a section at a
// time, and a partial write would leave, say, four of six baseline months —
// which is precisely the state Rule 5 exists to make impossible. (b) It keeps
// the audit row meaningful: one `save_<section>` entry per user action rather
// than a burst of per-row events nobody can reconstruct a form state from.

/** Section B-0 input. */
export interface ChannelInput {
  channel: Channel;
  channelLain?: string | null;
  statusChannel: ChannelState;
  namaToko: string;
  urlToko: string;
  umurTokoBulan?: number | null;
  badge?: string | null;
  targetTanggalLive?: string | null;
  prasyaratPembukaan?: string[];
  sumberData?: string | null;
  tanggalAmbilData?: string | null;
  lampiran?: string | null;
  periodeBaselineBulan?: number | null;
  periodeMulai?: string | null;
  periodeAkhir?: string | null;
  alasanPeriodePendek?: string | null;
  catatanPeriodePendek?: string | null;

  // E-2 (A-09b). Optional on the wire like every other half-filled-form field;
  // required per channel at submit (`checkCompleteness`).
  prioritas?: ChannelPrioritas | null;
  prioritasAlasan?: string | null;

  // Section B groups B-2 … B-9 (A-06). Optional on the wire, because a long form
  // is saved before it is finished; required at submit for `Eksisting` channels.
  pengunjungPerBulan?: number | null;
  conversionRatePersen?: number | null;
  trafikOrganikPersen?: number | null;
  trafikIklanPersen?: number | null;
  trafikAffiliatePersen?: number | null;
  trafikLivePersen?: number | null;
  trafikVideoPersen?: number | null;
  trafikLuarPersen?: number | null;
  entryPointUtama?: EntryPoint | null;
  entryPointCatatan?: string | null;
  skuListed?: number | null;
  skuAktif?: number | null;
  skuPareto80?: number | null;
  topSku?: StrategiTopSku[];
  skuSlowMoving?: number | null;
  skuStokKritis?: string[];
  listingLayakPersen?: number | null;
  ratingToko?: number | null;
  jumlahUlasan?: number | null;
  chatResponseRatePersen?: number | null;
  chatResponseMenit?: number | null;
  pesananTerlambatPersen?: number | null;
  poinPenalti?: number | null;
  catatanPenalti?: string | null;
  temaKeluhan?: string[];
  tipeKampanye?: string[];
  tipeKampanyeTidakAda?: boolean;
  jumlahKampanyeAktif?: number | null;
  topKeyword?: StrategiTopKeyword[];
  kampanyeBoncos?: StrategiKampanyeBoncos[];
  affiliateAktif30Hari?: number | null;
  gmvAffiliate?: string | null;
  gmvAffiliatePersen?: number | null;
  komisiOpenPersen?: number | null;
  komisiTargetPersen?: number | null;
  topKreator?: StrategiTopKreator[];
  programSampel?: SampleProgram | null;
  programSampelCatatan?: string | null;
  jumlahVideoPerBulan?: number | null;
  totalViews?: number | null;
  gmvVideo?: string | null;
  jamLivePerBulan?: number | null;
  gmvLive?: string | null;
  hostLive?: LiveHost | null;
  studioLive?: StudioState | null;
  studioCatatan?: string | null;
  voucherAktif?: StrategiVoucher[];
  voucherAktifTidakAda?: boolean;
  programPlatform?: string[];
  programPlatformTidakAda?: boolean;
  bebanPromoPersen?: number | null;
  kompetitor?: StrategiKompetitor[];
  kompetitorLebihBaik?: string[];
  kompetitorCatatan?: string | null;
  celahKompetitor?: string | null;
}

// ---------------------------------------------------------------------------
// Section C write path (A-07)
// ---------------------------------------------------------------------------

/**
 * Input for one diagnosa row (C-1..C-4). Channel must be a channel already
 * registered in the Strategi's `strategi_channel` table.
 */
export interface DiagnosaInput {
  channel: string;
  bottleneck: BottleneckKind;
  /** Rule 6: at least one entry from VALID_BASELINE_FIELD_IDS. */
  fieldIds: string[];
  akarMasalah?: string | null;
  gapKompetitor?: string | null;
}

export interface QuickWinInput {
  aksi: string;
  channel: string;
  picDivisi: string;
  dampakDiharapkan: string;
  urutan?: number;
}

export interface RisikoStrukturalInput {
  risiko: string;
  urutan?: number;
}

export interface PrasyaratKlienInput {
  item: string;
  picKlien: string;
  deadline?: string | null;
  urutan?: number;
}

export interface DiagnosaPayload {
  diagnosa: DiagnosaInput[];
  quickWins: QuickWinInput[];
  risikoStruktural: RisikoStrukturalInput[];
  prasyaratKlien: PrasyaratKlienInput[];
}

/**
 * saveDiagnosa replaces Section C (all four sub-sections) atomically.
 *
 * Validation rules enforced here:
 * - Rule 6 (§4): each diagnosa row must cite ≥1 field-ID from
 *   VALID_BASELINE_FIELD_IDS. This is validated at save time (not at submit)
 *   so the AM gets immediate feedback rather than discovering the problem
 *   only when they hit the submit button.
 * - Each diagnosa channel must be a channel registered in this Strategi
 *   (prevents dangling references if a channel is removed).
 * - No duplicate channel in the diagnosa list.
 *
 * All fields other than `bottleneck` + `fieldIds` are NULLable here because
 * §7 requires autosave every 20 s; completeness is checked at submit via
 * `checkCompleteness`.
 */
export async function saveDiagnosa(
  sql: Sql,
  actor: Actor,
  id: string,
  payload: DiagnosaPayload,
): Promise<StrategiDetail> {
  return withTransaction(sql, async (tx) => {
    await requireDraftAndWriter(tx, actor, id);

    // Fetch the contracted channels for this Strategi.
    const channelRows = await tx<{ channel: string }[]>`
      select channel from strategi_channel where strategi_id = ${id}`;
    const validChannels = new Set(channelRows.map((c) => c.channel));

    // Validate diagnosa inputs before any writes.
    const seenDiagnosaChannels = new Set<string>();
    for (const d of payload.diagnosa) {
      if (!validChannels.has(d.channel)) {
        throw new ValidationError(
          `[channel '${d.channel}' tidak terdaftar di Strategi ini]`,
        );
      }
      if (seenDiagnosaChannels.has(d.channel)) {
        throw new ValidationError(
          `[diagnosa untuk channel '${d.channel}' didaftarkan lebih dari sekali]`,
        );
      }
      seenDiagnosaChannels.add(d.channel);

      // Rule 6: at least one valid baseline field-ID.
      if (d.fieldIds.length === 0) {
        throw new ValidationError(MSG_DIAGNOSA_FIELD_ID_REQUIRED);
      }
      for (const fid of d.fieldIds) {
        if (!VALID_BASELINE_FIELD_IDS.has(fid)) {
          throw new ValidationError(MSG_DIAGNOSA_INVALID_FIELD_ID);
        }
      }
    }

    // Replace diagnosa — UPSERT on (strategi_id, channel).
    //
    // `field_ids` is written `to_jsonb(<array>::text[])`, deliberately NOT the
    // interpolate-a-JSON-string-and-cast form. postgres.js binds a parameter
    // that a jsonb column receives AS jsonb, so handing it an already-
    // JSON.stringify'd string makes it encode that string a second time: the
    // column ends up holding the jsonb *string* "[\"A-1\"]" instead of the
    // array ["A-1"], and `ck_strdiag_field_ids_array` (jsonb_typeof = 'array')
    // rejects every row. Passing a real JS array and letting Postgres build the
    // array server-side has no such ambiguity.
    await tx`delete from strategi_diagnosa where strategi_id = ${id}`;
    for (const d of payload.diagnosa) {
      await tx`
        insert into strategi_diagnosa
          (strategi_id, channel, bottleneck, field_ids, akar_masalah, gap_kompetitor, created_by)
        values (
          ${id}, ${d.channel}, ${d.bottleneck},
          to_jsonb(${d.fieldIds}::text[]),
          ${nullIfBlank(d.akarMasalah)},
          ${nullIfBlank(d.gapKompetitor)},
          ${actor.employeeId}
        )`;
    }

    // Replace quick wins.
    await tx`delete from strategi_quick_win where strategi_id = ${id}`;
    for (const [i, q] of payload.quickWins.entries()) {
      await tx`
        insert into strategi_quick_win
          (strategi_id, aksi, channel, pic_divisi, dampak_diharapkan, urutan, created_by)
        values (
          ${id}, ${q.aksi.trim()}, ${q.channel.trim()},
          ${q.picDivisi.trim()}, ${q.dampakDiharapkan.trim()},
          ${q.urutan ?? i}, ${actor.employeeId}
        )`;
    }

    // Replace risiko struktural.
    await tx`delete from strategi_risiko_struktural where strategi_id = ${id}`;
    for (const [i, r] of payload.risikoStruktural.entries()) {
      await tx`
        insert into strategi_risiko_struktural
          (strategi_id, risiko, urutan, created_by)
        values (${id}, ${r.risiko.trim()}, ${r.urutan ?? i}, ${actor.employeeId})`;
    }

    // Replace prasyarat klien.
    await tx`delete from strategi_prasyarat_klien where strategi_id = ${id}`;
    for (const [i, p] of payload.prasyaratKlien.entries()) {
      const dl = nullIfBlank(p.deadline);
      await tx`
        insert into strategi_prasyarat_klien
          (strategi_id, item, pic_klien, deadline, urutan, created_by)
        values (
          ${id}, ${p.item.trim()}, ${p.picKlien.trim()},
          ${dl}::date,
          ${p.urutan ?? i}, ${actor.employeeId}
        )`;
    }

    return loadDetail(tx, await loadStrategiRow(tx, id));
  });
}

/**
 * saveChannels replaces the Section B-0 blocks.
 *
 * Rule 4 and Rule 5/5a are validated here AND enforced by CHECK constraints. The
 * TS side exists to name the failing rule in Bahasa Indonesia; the CHECK exists
 * because a service-role caller never passes through here.
 */
export async function saveChannels(
  sql: Sql,
  actor: Actor,
  id: string,
  channels: ChannelInput[],
): Promise<StrategiDetail> {
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    await requireDraftAndWriter(tx, actor, id);
    for (const c of channels) {
      validateChannel(c);
    }
    // Deleting the channel cascades its baseline months — intentional: a channel
    // that is no longer in scope must not leave orphan numbers that Section C
    // could still cite (Rule 6).
    await tx`delete from strategi_channel where strategi_id = ${id}`;
    for (const c of channels) {
      await tx`
        insert into strategi_channel
          (strategi_id, channel, channel_lain, status_channel, nama_toko, url_toko,
           umur_toko_bulan, badge, target_tanggal_live, prasyarat_pembukaan,
           sumber_data, tanggal_ambil_data, lampiran, periode_baseline_bulan,
           periode_mulai, periode_akhir, alasan_periode_pendek, catatan_periode_pendek,
           prioritas, prioritas_alasan,
           pengunjung_per_bulan, conversion_rate_persen,
           trafik_organik_persen, trafik_iklan_persen, trafik_affiliate_persen,
           trafik_live_persen, trafik_video_persen, trafik_luar_persen,
           entry_point_utama, entry_point_catatan,
           sku_listed, sku_aktif, sku_pareto_80, top_sku, sku_slow_moving,
           sku_stok_kritis, listing_layak_persen,
           rating_toko, jumlah_ulasan, chat_response_rate_persen, chat_response_menit,
           pesanan_terlambat_persen, poin_penalti, catatan_penalti, tema_keluhan,
           tipe_kampanye, tipe_kampanye_tidak_ada,
           jumlah_kampanye_aktif, top_keyword, kampanye_boncos,
           affiliate_aktif_30hari, gmv_affiliate, gmv_affiliate_persen,
           komisi_open_persen, komisi_target_persen, top_kreator,
           program_sampel, program_sampel_catatan,
           jumlah_video_per_bulan, total_views, gmv_video,
           jam_live_per_bulan, gmv_live, host_live, studio_live, studio_catatan,
           voucher_aktif, voucher_aktif_tidak_ada,
           program_platform, program_platform_tidak_ada, beban_promo_persen,
           kompetitor, kompetitor_lebih_baik, kompetitor_catatan, celah_kompetitor,
           created_by)
        values
          (${id}, ${c.channel}, ${nullIfBlank(c.channelLain)}, ${c.statusChannel},
           ${c.namaToko.trim()}, ${c.urlToko.trim()}, ${c.umurTokoBulan ?? null},
           ${nullIfBlank(c.badge)}, ${nullIfBlank(c.targetTanggalLive)},
           ${(c.prasyaratPembukaan ?? []) as never},
           ${nullIfBlank(c.sumberData)}, ${nullIfBlank(c.tanggalAmbilData)},
           ${nullIfBlank(c.lampiran)}, ${c.periodeBaselineBulan ?? null},
           ${nullIfBlank(c.periodeMulai)}, ${nullIfBlank(c.periodeAkhir)},
           ${nullIfBlank(c.alasanPeriodePendek)}, ${nullIfBlank(c.catatanPeriodePendek)},
           ${c.prioritas ?? null}, ${nullIfBlank(c.prioritasAlasan)},
           ${c.pengunjungPerBulan ?? null}, ${c.conversionRatePersen ?? null},
           ${c.trafikOrganikPersen ?? null}, ${c.trafikIklanPersen ?? null},
           ${c.trafikAffiliatePersen ?? null}, ${c.trafikLivePersen ?? null},
           ${c.trafikVideoPersen ?? null}, ${c.trafikLuarPersen ?? null},
           ${nullIfBlank(c.entryPointUtama)}, ${nullIfBlank(c.entryPointCatatan)},
           ${c.skuListed ?? null}, ${c.skuAktif ?? null}, ${c.skuPareto80 ?? null},
           ${(c.topSku ?? []).map(topSkuToJson) as never}, ${c.skuSlowMoving ?? null},
           ${(c.skuStokKritis ?? []) as never}, ${c.listingLayakPersen ?? null},
           ${c.ratingToko ?? null}, ${c.jumlahUlasan ?? null},
           ${c.chatResponseRatePersen ?? null}, ${c.chatResponseMenit ?? null},
           ${c.pesananTerlambatPersen ?? null}, ${c.poinPenalti ?? null},
           ${nullIfBlank(c.catatanPenalti)}, ${(c.temaKeluhan ?? []) as never},
           ${(c.tipeKampanye ?? []) as never}, ${c.tipeKampanyeTidakAda === true},
           ${c.jumlahKampanyeAktif ?? null},
           ${(c.topKeyword ?? []).map(keywordToJson) as never},
           ${(c.kampanyeBoncos ?? []).map(boncosToJson) as never},
           ${c.affiliateAktif30Hari ?? null}, ${c.gmvAffiliate ?? null},
           ${c.gmvAffiliatePersen ?? null}, ${c.komisiOpenPersen ?? null},
           ${c.komisiTargetPersen ?? null},
           ${(c.topKreator ?? []).map(kreatorToJson) as never},
           ${nullIfBlank(c.programSampel)}, ${nullIfBlank(c.programSampelCatatan)},
           ${c.jumlahVideoPerBulan ?? null}, ${c.totalViews ?? null}, ${c.gmvVideo ?? null},
           ${c.jamLivePerBulan ?? null}, ${c.gmvLive ?? null},
           ${nullIfBlank(c.hostLive)}, ${nullIfBlank(c.studioLive)},
           ${nullIfBlank(c.studioCatatan)},
           ${(c.voucherAktif ?? []).map(voucherToJson) as never},
           ${c.voucherAktifTidakAda === true},
           ${(c.programPlatform ?? []) as never}, ${c.programPlatformTidakAda === true},
           ${c.bebanPromoPersen ?? null},
           ${(c.kompetitor ?? []).map(kompetitorToJson) as never},
           ${(c.kompetitorLebihBaik ?? []) as never}, ${nullIfBlank(c.kompetitorCatatan)},
           ${nullIfBlank(c.celahKompetitor)},
           ${actor.employeeId})`;
    }
    await ex.audit.insertAudit({
      entityType: ENTITY_STRATEGI,
      entityId: id,
      actorEmployeeId: actor.employeeId,
      action: 'save_channels',
      beforeJson: null,
      afterJson: { channels: channels.map((c) => c.channel) },
      createdBy: actor.employeeId,
    });
    return loadDetail(tx, await loadStrategiRow(tx, id));
  });
}

function validateChannel(c: ChannelInput): void {
  if (!CHANNELS.includes(c.channel) || !CHANNEL_STATES.includes(c.statusChannel)) {
    throw new ValidationError(MSG_INCOMPLETE);
  }
  if ((c.namaToko ?? '').trim() === '' || (c.urlToko ?? '').trim() === '') {
    throw new ValidationError(MSG_INCOMPLETE);
  }
  if ((c.channel === 'Lainnya') !== ((c.channelLain ?? '').trim() !== '')) {
    throw new ValidationError(MSG_INCOMPLETE);
  }
  // E-2 shape only — an unknown role is refused now, a MISSING one is reported
  // at submit. That split is the same one every Section A/B field uses: §7 wants
  // a half-filled form to be savable, and §5 step 5 wants the gaps counted, not
  // thrown.
  if (c.prioritas !== null && c.prioritas !== undefined && !CHANNEL_PRIORITAS.includes(c.prioritas)) {
    throw new ValidationError(MSG_PRIORITAS_INVALID);
  }
  // Section B shape runs for BOTH channel states: Rule 4 says `Belum Aktif`
  // *skips* the historical baseline, not that a figure supplied anyway may be
  // out of range. Whether those figures are REQUIRED is decided at submit.
  validateChannelBaselineShape(c);
  if (c.statusChannel === 'Belum Aktif') {
    // Rule 4: skipping the historical baseline does not skip the launch plan.
    if (!RE_DATE.test((c.targetTanggalLive ?? '').trim())) {
      throw new ValidationError(MSG_INCOMPLETE);
    }
    return;
  }
  // Rule 5: an existing channel arrives with numbers, a window, and a source.
  const bulan = c.periodeBaselineBulan ?? 0;
  if (!Number.isInteger(bulan) || bulan < 1 || bulan > 6) {
    throw new ValidationError(MSG_INCOMPLETE);
  }
  if (!RE_DATE.test((c.periodeMulai ?? '').trim()) || !RE_DATE.test((c.periodeAkhir ?? '').trim())) {
    throw new ValidationError(MSG_INCOMPLETE);
  }
  if (
    (c.sumberData ?? '').trim() === '' ||
    !RE_DATE.test((c.tanggalAmbilData ?? '').trim()) ||
    (c.lampiran ?? '').trim() === ''
  ) {
    throw new ValidationError(MSG_INCOMPLETE);
  }
  // Rule 5a: a window below three months is allowed, but never silently.
  if (bulan < 3 && (c.alasanPeriodePendek ?? '').trim() === '') {
    throw new ValidationError(MSG_INCOMPLETE);
  }
}

/**
 * Section B (A-06) shape: ranges, closed taxonomies, and the one cross-field
 * rule §7 spells out — the traffic composition adds up to 100 (±0,5).
 *
 * Mirrors the CHECK constraints in `20260806066000_m6a_section_b.sql`. Both
 * exist for the reason the rest of this module gives: the CHECK is the wall (a
 * service-role caller never passes through here), this is the BI message.
 */
function validateChannelBaselineShape(c: ChannelInput): void {
  const pct = (v: number | null | undefined): void => {
    if (v === null || v === undefined) return;
    const n = Number(v);
    if (Number.isNaN(n) || n < 0 || n > 100) throw new ValidationError(MSG_INCOMPLETE);
  };
  const nonNeg = (v: number | null | string | undefined): void => {
    if (v === null || v === undefined || v === '') return;
    const n = Number(v);
    if (Number.isNaN(n) || n < 0) throw new ValidationError(MSG_INCOMPLETE);
  };
  const subset = (vals: string[] | undefined, set: readonly string[]): void => {
    for (const v of vals ?? []) {
      if (!set.includes(v)) throw new ValidationError(MSG_INCOMPLETE);
    }
  };
  const enumOrNull = (v: string | null | undefined, set: readonly string[]): void => {
    const s = (v ?? '').trim();
    if (s !== '' && !set.includes(s)) throw new ValidationError(MSG_INCOMPLETE);
  };

  for (const v of [
    c.conversionRatePersen,
    c.listingLayakPersen,
    c.chatResponseRatePersen,
    c.pesananTerlambatPersen,
    c.gmvAffiliatePersen,
    c.bebanPromoPersen,
    c.komisiOpenPersen,
    c.komisiTargetPersen,
  ]) {
    pct(v);
  }
  for (const v of [
    c.pengunjungPerBulan,
    c.skuListed,
    c.skuAktif,
    c.skuPareto80,
    c.skuSlowMoving,
    c.jumlahUlasan,
    c.chatResponseMenit,
    c.poinPenalti,
    c.jumlahKampanyeAktif,
    c.affiliateAktif30Hari,
    c.jumlahVideoPerBulan,
    c.totalViews,
    c.jamLivePerBulan,
  ]) {
    nonNeg(v);
  }
  nonNeg(c.gmvAffiliate);
  nonNeg(c.gmvVideo);
  nonNeg(c.gmvLive);

  // B-4.1: platform ratings are a 0–5 scale, not a percentage.
  if (c.ratingToko !== null && c.ratingToko !== undefined) {
    const r = Number(c.ratingToko);
    if (Number.isNaN(r) || r < 0 || r > 5) throw new ValidationError(MSG_INCOMPLETE);
  }
  // B-3.1/B-3.2: active cannot exceed listed, and the Pareto count cannot exceed
  // active. A baseline that breaks this is a typo, and Section C will cite it.
  if (
    c.skuListed !== null &&
    c.skuListed !== undefined &&
    c.skuAktif !== null &&
    c.skuAktif !== undefined &&
    Number(c.skuAktif) > Number(c.skuListed)
  ) {
    throw new ValidationError(MSG_INCOMPLETE);
  }
  if (
    c.skuAktif !== null &&
    c.skuAktif !== undefined &&
    c.skuPareto80 !== null &&
    c.skuPareto80 !== undefined &&
    Number(c.skuPareto80) > Number(c.skuAktif)
  ) {
    throw new ValidationError(MSG_INCOMPLETE);
  }

  enumOrNull(c.entryPointUtama, ENTRY_POINTS);
  enumOrNull(c.programSampel, SAMPLE_PROGRAMS);
  enumOrNull(c.hostLive, LIVE_HOSTS);
  enumOrNull(c.studioLive, STUDIO_STATES);
  subset(c.tipeKampanye, CAMPAIGN_TYPES);
  subset(c.programPlatform, PLATFORM_PROGRAMS);
  subset(c.kompetitorLebihBaik, COMPETITOR_EDGES);

  // The parenthetical counts in B-3.3 ("(5)") and B-9.1 ("(3)") are read as
  // maximums — see TOP_SKU_MAX. Over the cap is a form that let the AM keep
  // adding rows; under it is an honest short list.
  if ((c.topSku ?? []).length > TOP_SKU_MAX) throw new ValidationError(MSG_INCOMPLETE);
  if ((c.kompetitor ?? []).length > KOMPETITOR_MAX) throw new ValidationError(MSG_INCOMPLETE);
  for (const s of c.topSku ?? []) {
    if (String(s.nama ?? '').trim() === '') throw new ValidationError(MSG_INCOMPLETE);
    nonNeg(s.unitTerjual);
    nonNeg(s.gmv);
    nonNeg(s.hargaJual);
    pct(s.marginPersen);
  }
  for (const k of c.kompetitor ?? []) {
    if (String(k.nama ?? '').trim() === '') throw new ValidationError(MSG_INCOMPLETE);
    nonNeg(k.hargaSebanding);
    nonNeg(k.estimasiPenjualanBulan);
  }
  for (const v of c.voucherAktif ?? []) {
    if (String(v.tipe ?? '').trim() === '') throw new ValidationError(MSG_INCOMPLETE);
  }

  // B-2.3 / §7: the six shares are all present or all absent, and when present
  // they sum to 100 ±0,5. Five of six filled is a composition that cannot be
  // summed, and letting it through means Section C stands on a partial mix.
  const mix = [
    c.trafikOrganikPersen,
    c.trafikIklanPersen,
    c.trafikAffiliatePersen,
    c.trafikLivePersen,
    c.trafikVideoPersen,
    c.trafikLuarPersen,
  ];
  const terisi = mix.filter((v) => v !== null && v !== undefined);
  if (terisi.length !== 0 && terisi.length !== mix.length) {
    throw new ValidationError(MSG_TRAFFIC_MIX_SUM);
  }
  if (terisi.length === mix.length) {
    const total = terisi.reduce((a, b) => Number(a) + Number(b), 0);
    if (!(total >= 99.5 && total <= 100.5)) {
      throw new ValidationError(MSG_TRAFFIC_MIX_SUM);
    }
  }
}

/**
 * B-1 / B-5 input for one channel.
 *
 * Every figure is nullable HERE and non-nullable in the row that reaches the
 * table, deliberately: Rule 5 draws the line between "blank" and "0", so the
 * wire must be able to say "blank" for the validator to reject it. A type that
 * cannot express blank would have the route coerce it to 0 — which is the exact
 * substitution Rule 5 exists to prevent.
 */
export interface BaselineInput {
  monthIndex: number;
  gmv: string | null;
  jumlahPesanan: number | null;
  persenBatal: number | null;
  adSpend: string | null;
  roas: number | null;
  acos: number | null;
}

/** A validated baseline row — blanks resolved, so the insert cannot smuggle one in. */
interface BaselineRow {
  monthIndex: number;
  gmv: string;
  jumlahPesanan: number;
  persenBatal: number;
  adSpend: string;
  roas: number;
  acos: number;
}

/**
 * saveBaseline replaces the monthly baseline of ONE channel.
 *
 * Rule 5 in one line: every figure is required, `0` is a valid answer, blank is
 * not. `undefined`/`null` therefore fails here rather than becoming a zero the
 * diagnosis in Section C would later cite as fact.
 */
export async function saveBaseline(
  sql: Sql,
  actor: Actor,
  id: string,
  channelId: number,
  months: BaselineInput[],
): Promise<StrategiDetail> {
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    await requireDraftAndWriter(tx, actor, id);
    const owned = await tx<{ id: string; periode_baseline_bulan: number | null }[]>`
      select id, periode_baseline_bulan from strategi_channel
       where id = ${channelId} and strategi_id = ${id}`;
    if (owned.length === 0) {
      throw new NotFoundError(MSG_CHANNEL_NOT_FOUND);
    }
    const rows = months.map(normalizeBaseline);
    await tx`delete from strategi_baseline_bulan where channel_id = ${channelId}`;
    for (const m of rows) {
      await tx`
        insert into strategi_baseline_bulan
          (channel_id, month_index, gmv, jumlah_pesanan, persen_batal, ad_spend, roas, acos, created_by)
        values
          (${channelId}, ${m.monthIndex}, ${m.gmv}, ${m.jumlahPesanan}, ${m.persenBatal},
           ${m.adSpend}, ${m.roas}, ${m.acos}, ${actor.employeeId})`;
    }
    await ex.audit.insertAudit({
      entityType: ENTITY_STRATEGI,
      entityId: id,
      actorEmployeeId: actor.employeeId,
      action: 'save_baseline',
      beforeJson: null,
      afterJson: { channel_id: channelId, months: months.map((m) => m.monthIndex) },
      createdBy: actor.employeeId,
    });
    return loadDetail(tx, await loadStrategiRow(tx, id));
  });
}

function normalizeBaseline(m: BaselineInput): BaselineRow {
  const required: unknown[] = [m.gmv, m.jumlahPesanan, m.persenBatal, m.adSpend, m.roas, m.acos];
  // Rule 5, in one condition: blank fails, `0` passes.
  if (required.some((v) => v === null || v === undefined || v === '')) {
    throw new ValidationError(MSG_INCOMPLETE);
  }
  if (!Number.isInteger(m.monthIndex) || m.monthIndex < 1 || m.monthIndex > 6) {
    throw new ValidationError(MSG_INCOMPLETE);
  }
  const row: BaselineRow = {
    monthIndex: m.monthIndex,
    gmv: String(m.gmv),
    jumlahPesanan: Number(m.jumlahPesanan),
    persenBatal: Number(m.persenBatal),
    adSpend: String(m.adSpend),
    roas: Number(m.roas),
    acos: Number(m.acos),
  };
  if (
    [row.jumlahPesanan, row.persenBatal, row.roas, row.acos, Number(row.gmv), Number(row.adSpend)].some(
      (n) => Number.isNaN(n),
    )
  ) {
    throw new ValidationError(MSG_INCOMPLETE);
  }
  if (Number(row.gmv) < 0 || row.jumlahPesanan < 0 || Number(row.adSpend) < 0 || row.roas < 0) {
    throw new ValidationError(MSG_INCOMPLETE);
  }
  if (row.persenBatal < 0 || row.persenBatal > 100 || row.acos < 0) {
    throw new ValidationError(MSG_INCOMPLETE);
  }
  return row;
}

/** D-1/D-2/D-4 input. */
export interface TargetInput {
  channel: string;
  monthIndex: number;
  metric: TargetMetric;
  nilaiFloor?: string | null;
  nilaiStretch: string;
}

/**
 * saveTargets replaces the target matrix.
 *
 * Rule 7 lives in the CHECK (`stretch >= floor` for GMV), not here — a stretch
 * below the contract floor is not a message to soften, it is a row Postgres
 * refuses.
 *
 * `sumber_floor` is NOT an input (O57 item (b), house rule #4). It records the
 * APPROVAL PATH, and the only way into it is: written `input_am` here, flipped
 * to `disetujui_head` by `approveStrategi`. Letting the caller supply it would
 * hand the AM who types the floor the power to mark it approved — the exact
 * separation D-7 Sanggahan Target depends on.
 *
 * Reachable only while the record is a draft (`requireDraftAndWriter`), so an
 * approved floor can never be rewritten through this door: by then the Strategi
 * is `Aktif` and a change means a new version.
 */
export async function saveTargets(
  sql: Sql,
  actor: Actor,
  id: string,
  targets: TargetInput[],
): Promise<StrategiDetail> {
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    await requireDraftAndWriter(tx, actor, id);
    for (const t of targets) {
      if (!TARGET_METRICS.includes(t.metric)) {
        throw new ValidationError(MSG_INCOMPLETE);
      }
      if (!Number.isInteger(t.monthIndex) || t.monthIndex < 1 || t.monthIndex > 36) {
        throw new ValidationError(MSG_INCOMPLETE);
      }
      if ((t.nilaiStretch ?? '') === '' || Number(t.nilaiStretch) < 0) {
        throw new ValidationError(MSG_INCOMPLETE);
      }
      if (t.metric === 'gmv') {
        if ((t.nilaiFloor ?? null) === null) {
          throw new ValidationError(MSG_INCOMPLETE);
        }
        if (Number(t.nilaiStretch) < Number(t.nilaiFloor)) {
          // Rule 7: the AM raises Sanggahan Target (D-7); they do not lower it.
          throw new ValidationError(MSG_INCOMPLETE);
        }
      }
    }
    await tx`delete from strategi_target where strategi_id = ${id}`;
    for (const t of targets) {
      const floor = t.metric === 'gmv' ? (t.nilaiFloor ?? null) : null;
      await tx`
        insert into strategi_target
          (strategi_id, channel, month_index, metric, nilai_floor, nilai_stretch, sumber_floor, created_by)
        values
          (${id}, ${t.channel}, ${t.monthIndex}, ${t.metric}, ${floor}, ${t.nilaiStretch},
           ${floor === null ? null : FLOOR_INPUT_AM}, ${actor.employeeId})`;
    }
    await ex.audit.insertAudit({
      entityType: ENTITY_STRATEGI,
      entityId: id,
      actorEmployeeId: actor.employeeId,
      action: 'save_targets',
      beforeJson: null,
      afterJson: { count: targets.length },
      createdBy: actor.employeeId,
    });
    return loadDetail(tx, await loadStrategiRow(tx, id));
  });
}

/** D-8 / D-9 input. */
export interface AssumptionInput {
  kode: string;
  asumsi: string;
  pemilik: string;
  caraVerifikasi: string;
  status?: AssumptionState;
  targetTerkait?: string[];
}

/** The key shape used by D-9 mappings: `metric:channel:monthIndex`. */
export function targetKey(metric: string, channel: string, monthIndex: number): string {
  return `${metric}:${channel}:${monthIndex}`;
}

/** saveAssumptions replaces D-8, validating the D-9 mapping against real targets. */
export async function saveAssumptions(
  sql: Sql,
  actor: Actor,
  id: string,
  assumptions: AssumptionInput[],
): Promise<StrategiDetail> {
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    await requireDraftAndWriter(tx, actor, id);

    const known = new Set(
      (
        await tx<{ metric: string; channel: string; month_index: number }[]>`
          select metric, channel, month_index from strategi_target where strategi_id = ${id}`
      ).map((t) => targetKey(t.metric, t.channel, t.month_index)),
    );

    for (const a of assumptions) {
      if (
        (a.kode ?? '').trim() === '' ||
        (a.asumsi ?? '').trim() === '' ||
        (a.pemilik ?? '').trim() === '' ||
        (a.caraVerifikasi ?? '').trim() === ''
      ) {
        throw new ValidationError(MSG_INCOMPLETE);
      }
      if (a.status !== undefined && !ASSUMPTION_STATES.includes(a.status)) {
        throw new ValidationError(MSG_INCOMPLETE);
      }
      // D-9 is a mapping, and a mapping to nothing is decoration. A dangling
      // reference here would make the "which target do we review?" question
      // unanswerable at the exact moment the assumption breaks.
      for (const k of a.targetTerkait ?? []) {
        if (!known.has(k)) {
          throw new ValidationError(MSG_ASSUMPTION_TARGET_UNKNOWN);
        }
      }
    }

    await tx`delete from strategi_assumption where strategi_id = ${id}`;
    for (const a of assumptions) {
      await tx`
        insert into strategi_assumption
          (strategi_id, kode, asumsi, pemilik, cara_verifikasi, status, target_terkait, created_by)
        values
          (${id}, ${a.kode.trim()}, ${a.asumsi.trim()}, ${a.pemilik.trim()},
           ${a.caraVerifikasi.trim()}, ${a.status ?? 'Berlaku'},
           ${(a.targetTerkait ?? []) as never}, ${actor.employeeId})`;
    }
    await ex.audit.insertAudit({
      entityType: ENTITY_STRATEGI,
      entityId: id,
      actorEmployeeId: actor.employeeId,
      action: 'save_assumptions',
      beforeJson: null,
      afterJson: { kode: assumptions.map((a) => a.kode) },
      createdBy: actor.employeeId,
    });
    return loadDetail(tx, await loadStrategiRow(tx, id));
  });
}

/** D-5 + D-6 input — the two header fields of Section D that are AM-typed. */
export interface KpiInput {
  definisiBerhasil30?: string | null;
  definisiBerhasil60?: string | null;
  definisiBerhasil90?: string | null;
  leadingIndicator?: LeadingIndicator[];
}

/**
 * saveKpi writes D-5 and D-6.
 *
 * Partial saves are allowed on purpose (§7 autosave, §5 step 5 live count) — a
 * blank horizon is stored as `null` and reported by `checkCompleteness`, not
 * rejected here. What IS rejected: a value outside the D-6 vocabulary, and more
 * than `LEADING_INDICATOR_MAX` of them. Both are also CHECK constraints, so this
 * layer exists to name the failure in Bahasa Indonesia rather than to be the only
 * thing standing between a bad row and the table.
 *
 * Blank strings are normalised to `null` rather than stored: `''` and "unanswered"
 * must not be two different ways of saying the same thing, or the submit gate has
 * to test for both forever.
 */
export async function saveKpi(
  sql: Sql,
  actor: Actor,
  id: string,
  input: KpiInput,
): Promise<StrategiDetail> {
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    await requireDraftAndWriter(tx, actor, id);

    const indikator = input.leadingIndicator ?? [];
    if (indikator.length > LEADING_INDICATOR_MAX) {
      throw new ValidationError(MSG_LEADING_INDICATOR_MAX);
    }
    for (const k of indikator) {
      if (!LEADING_INDICATORS.includes(k)) {
        throw new ValidationError(MSG_INCOMPLETE);
      }
    }
    // A duplicate would consume one of the five slots without adding a thing
    // watched weekly — the cap is about the AM's attention, not about row count.
    if (new Set(indikator).size !== indikator.length) {
      throw new ValidationError(MSG_INCOMPLETE);
    }

    const teks = (v: string | null | undefined): string | null => {
      const t = (v ?? '').trim();
      return t === '' ? null : t;
    };

    await tx`
      update strategi set
        definisi_berhasil_30 = ${teks(input.definisiBerhasil30)},
        definisi_berhasil_60 = ${teks(input.definisiBerhasil60)},
        definisi_berhasil_90 = ${teks(input.definisiBerhasil90)},
        leading_indicator    = ${indikator as never}
       where id = ${id}`;

    await ex.audit.insertAudit({
      entityType: ENTITY_STRATEGI,
      entityId: id,
      actorEmployeeId: actor.employeeId,
      action: 'save_kpi',
      beforeJson: null,
      afterJson: { leadingIndicator: indikator },
      createdBy: actor.employeeId,
    });
    return loadDetail(tx, await loadStrategiRow(tx, id));
  });
}

/** E-1 / E-13 / H-3 / H-4 input (A-09a) — the narrative header fields. */
export interface NarasiInput {
  growthThesis?: string | null;
  urutanEksekusiAlasan?: string | null;
  skenarioMundur?: string | null;
  kondisiStopScope?: string | null;
}

/**
 * saveNarasi writes the four Section E/H paragraph fields.
 *
 * Partial saves are legal (§7 autosave, §5 step 5 live count), and blank is
 * normalised to `null` for the same reason as `saveKpi`: `''` and "unanswered"
 * must not be two ways of saying the same thing, or every gate downstream has to
 * test for both forever. The DB agrees via `ck_strategi_narasi_ehi_isi`.
 *
 * **H-4 is written here but never gated** — §4 marks it `O`. It is also §4.1
 * hard-internal, so no caller may put it on a client-facing path; the enforcement
 * for that is A-10, and until then this comment is the only thing saying so.
 */
export async function saveNarasi(
  sql: Sql,
  actor: Actor,
  id: string,
  input: NarasiInput,
): Promise<StrategiDetail> {
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    await requireDraftAndWriter(tx, actor, id);

    const teks = (v: string | null | undefined): string | null => {
      const t = (v ?? '').trim();
      return t === '' ? null : t;
    };

    await tx`
      update strategi set
        growth_thesis          = ${teks(input.growthThesis)},
        urutan_eksekusi_alasan = ${teks(input.urutanEksekusiAlasan)},
        skenario_mundur        = ${teks(input.skenarioMundur)},
        kondisi_stop_scope     = ${teks(input.kondisiStopScope)}
       where id = ${id}`;

    await ex.audit.insertAudit({
      entityType: ENTITY_STRATEGI,
      entityId: id,
      actorEmployeeId: actor.employeeId,
      action: 'save_narasi',
      beforeJson: null,
      // The paragraphs themselves are not copied into the audit row: H-4 is
      // hard-internal, and `audit_log` has a different read scope from
      // `strategi`. Which fields were answered is the auditable fact here; the
      // content lives on the record, versioned by `strategi_version`.
      afterJson: {
        terisi: (
          [
            ['E-1', input.growthThesis],
            ['E-13', input.urutanEksekusiAlasan],
            ['H-3', input.skenarioMundur],
            ['H-4', input.kondisiStopScope],
          ] as const
        )
          .filter(([, v]) => (v ?? '').trim() !== '')
          .map(([k]) => k),
      },
      createdBy: actor.employeeId,
    });
    return loadDetail(tx, await loadStrategiRow(tx, id));
  });
}

/** D-7 input. All three parts are mandatory together — see Rule 19. */
export interface SanggahanInput {
  alasan: string;
  angkaPembanding: string;
  targetRealistis: string;
}

/**
 * raiseSanggahan records D-7 and notifies SPV Account + Head of Sales (Rule 19).
 *
 * **It does not touch the floor, and it cannot.** The stretch/floor relation is
 * `ck_strtg_stretch_gmv` on `strategi_target`; nothing here writes that table.
 * That is the whole point of Rule 19 — a challenge is evidence for the
 * post-mortem, not an escape hatch, so the code path that files one has no reach
 * into the numbers it disputes.
 *
 * The notification fires only on the FIRST filing (`null` → filled). Re-editing a
 * challenge while still drafting is a correction, not a new event, and pinging the
 * Head of Sales once per keystroke-save would make the event worthless.
 *
 * Recipients cross two divisions, which is why the event resolves
 * `explicitOrLeads`: SPV Account comes from `division`, and the Sales leads are
 * looked up here and passed explicitly. `leadsOfDivision` can only ever reach one
 * of the two.
 */
export async function raiseSanggahan(
  sql: Sql,
  actor: Actor,
  id: string,
  input: SanggahanInput,
): Promise<StrategiDetail> {
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const head = await requireDraftAndWriter(tx, actor, id);

    const alasan = (input.alasan ?? '').trim();
    const pembanding = (input.angkaPembanding ?? '').trim();
    const realistis = (input.targetRealistis ?? '').trim();
    if (alasan === '' || pembanding === '' || realistis === '') {
      throw new ValidationError(MSG_SANGGAHAN_INCOMPLETE);
    }
    if (Number.isNaN(Number(pembanding)) || Number(pembanding) < 0) {
      throw new ValidationError(MSG_SANGGAHAN_INCOMPLETE);
    }
    if (Number.isNaN(Number(realistis)) || Number(realistis) < 0) {
      throw new ValidationError(MSG_SANGGAHAN_INCOMPLETE);
    }

    const pertamaKali = head.sanggahanAlasan === null;

    await tx`
      update strategi set
        sanggahan_alasan           = ${alasan},
        sanggahan_angka_pembanding = ${pembanding},
        sanggahan_target_realistis = ${realistis},
        sanggahan_diajukan_pada    = now(),
        sanggahan_diajukan_oleh    = ${actor.employeeId}
       where id = ${id}`;

    await ex.audit.insertAudit({
      entityType: ENTITY_STRATEGI,
      entityId: id,
      actorEmployeeId: actor.employeeId,
      action: pertamaKali ? 'raise_sanggahan' : 'edit_sanggahan',
      beforeJson: pertamaKali ? null : { alasan: head.sanggahanAlasan },
      afterJson: { alasan, angkaPembanding: pembanding, targetRealistis: realistis },
      createdBy: actor.employeeId,
    });

    if (pertamaKali) {
      await notification.emit(ex.notify, {
        event: notification.EVENTS.StrategiSanggahanTarget,
        entityType: ENTITY_STRATEGI,
        entityId: id,
        actor: actor.employeeId,
        deepLink: `/account/strategi/${id}`,
        division: ACCOUNT_DIVISION,
        explicitRecipients: await leadsOfDivision(tx, SALES_DIVISION),
      });
    }
    return loadDetail(tx, await loadStrategiRow(tx, id));
  });
}

/**
 * setAssumptionStatus flips one D-8 assumption, firing
 * `strategi_revisi_disarankan` on the way into `Gugur` (§7 field-level notes).
 *
 * **Reachable while the Strategi is `Aktif`, unlike every other Section-D write.**
 * That is the reason it is a separate function rather than a field on
 * `saveAssumptions`: an assumption breaks during EXECUTION — the ads budget lands
 * late in month 3 — which is exactly when the record is `Aktif` and every editing
 * door is shut. Routing this through `requireDraftAndWriter` would make the
 * feature unreachable at the only moment it matters.
 *
 * It is not a state machine and does not go through `sm_transition`: `status` here
 * is a child-row attribute with no ID and no screen of its own, handled like
 * `service_plan_gate.keputusan_am` (the accepted M6C precedent). Every flip still
 * writes `audit_log`.
 *
 * Flipping to `Gugur` does NOT open a revision by itself. Rule 13 says a revision
 * needs a trigger, a reason, and the broken assumptions — a human decision. This
 * emits the suggestion (`strategi_revisi_disarankan`, "disarankan"), which is what
 * the PRD asks for and no more.
 *
 * **Refused once the version is history (X-17, `docs/DECISIONS.md` 2026-08-09).**
 * `Aktif` is open on purpose — an assumption breaks during execution — but
 * `Diarsipkan`/`Kedaluwarsa` are not: a flip there would fire
 * `strategi_revisi_disarankan` about a version already superseded, a "please
 * revise" with no correct action for its recipient. The UI already declines to
 * offer it (`canFlipAsumsi`); this closes the same door for a direct or
 * service-role caller, using the `setFieldVisibility` precedent for the check.
 */
export async function setAssumptionStatus(
  sql: Sql,
  actor: Actor,
  id: string,
  kode: string,
  status: AssumptionState,
): Promise<StrategiDetail> {
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    if (!ASSUMPTION_STATES.includes(status)) {
      throw new ValidationError(MSG_ASSUMPTION_STATUS_INVALID);
    }
    const head = await loadStrategiRow(tx, id, true);
    const ownerAm = await ownerAmOfContract(tx, head.contractId);
    // Read-scope is wrong here (an OD may read everything) and draft-scope is too
    // narrow, so the gate is the WRITE set plus the reviewer: the AM who owns the
    // account or the Account lead who approved it are the two people who can know
    // an assumption stopped holding.
    if (!canWriteStrategi(actor, ownerAm) && !canApproveStrategi(actor)) {
      throw new ForbiddenError(MSG_NOT_OWNER_AM);
    }
    // X-17 (owner decision 2026-08-11) — reject the flip on a version whose
    // visibility is settled history (`Diarsipkan`/`Kedaluwarsa`), same precondition
    // `setFieldVisibility` enforces. The UI already disables the control there
    // (`canFlipAsumsi`); the domain refuses it too so a service-role or direct API
    // caller cannot fire `strategi_revisi_disarankan` on a superseded version.
    if (head.status === STRATEGI_DIARSIPKAN || head.status === STRATEGI_KEDALUWARSA) {
      throw new ConflictError(MSG_ASSUMPTION_STATUS_TERKUNCI);
    }

    const rows = await tx<{ status: string }[]>`
      select status from strategi_assumption
       where strategi_id = ${id} and kode = ${kode} for update`;
    if (rows.length === 0) {
      throw new NotFoundError(MSG_ASSUMPTION_NOT_FOUND);
    }
    const sebelum = rows[0].status;
    if (sebelum === status) {
      // Idempotent: re-asserting the current status is not an error, and must not
      // fire a second notification.
      return loadDetail(tx, head);
    }

    await tx`
      update strategi_assumption set status = ${status}
       where strategi_id = ${id} and kode = ${kode}`;

    await ex.audit.insertAudit({
      entityType: ENTITY_STRATEGI,
      entityId: id,
      actorEmployeeId: actor.employeeId,
      action: 'set_assumption_status',
      beforeJson: { kode, status: sebelum },
      afterJson: { kode, status },
      createdBy: actor.employeeId,
    });

    if (status === 'Gugur') {
      await notification.emit(ex.notify, {
        event: notification.EVENTS.StrategiRevisiDisarankan,
        entityType: ENTITY_STRATEGI,
        entityId: id,
        actor: actor.employeeId,
        deepLink: `/account/strategi/${id}`,
        division: ACCOUNT_DIVISION,
        // "-> AM + SPV": the SPV arm is the Account leads resolved from
        // `division`; the AM has to be explicit because they are not a lead.
        // `notifyActor` stays false, so an AM who flips their own assumption is
        // not told what they just did.
        explicitRecipients: ownerAm === null ? [] : [ownerAm],
      });
    }
    return loadDetail(tx, await loadStrategiRow(tx, id));
  });
}

/**
 * leadsOfDivision resolves the active leads/SPVs of one CDPS division.
 *
 * `notify_emit` already does this for the `division` argument, but it can only do
 * it for ONE division per emission. D-7 needs two, so the second set is resolved
 * here and passed as explicit recipients. The JOIN mirrors `notify_emit`'s
 * candidate CTE exactly — including `status_aktif`, so an employee deactivated in
 * HRIS stops receiving notifications on the next sync.
 */
async function leadsOfDivision(sql: Queryable, division: string): Promise<string[]> {
  const rows = await sql<{ employee_id: string }[]>`
    select e.employee_id from employees e
      join role_mappings rm on rm.divisi = e.divisi and rm.jabatan = e.jabatan
     where rm.division = ${division} and rm.level = 'lead' and e.status_aktif = true`;
  return rows.map((r) => r.employee_id);
}

/** Section E input. */
export interface PillarInput {
  jenis: PillarKind;
  channel?: string | null;
  urutan?: number;
  sku?: string | null;
  peran?: string | null;
  aksi?: string;
  target?: string;
  hargaNormal?: string | null;
  hargaPromo?: string | null;
  floorPrice?: string | null;
  vendorId?: string | null;
  slotJam?: number | null;
  tarif?: string | null;
  targetGmvPerJam?: string | null;
  detail?: Record<string, unknown>;
}

/**
 * savePillars replaces Section E.
 *
 * Two invariants are worth restating because they are easy to lose in a form:
 * a vendor may only hang off a `live` pillar (Rule 18 — live hours never draw
 * internal division capacity), and a floor price only means something attached
 * to a named SKU (E-4 — Brief validation compares against it per SKU).
 */
export async function savePillars(
  sql: Sql,
  actor: Actor,
  id: string,
  pillars: PillarInput[],
): Promise<StrategiDetail> {
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    await requireDraftAndWriter(tx, actor, id);
    for (const p of pillars) {
      if (!PILLAR_KINDS.includes(p.jenis)) {
        throw new ValidationError(MSG_INCOMPLETE);
      }
      if ((p.vendorId ?? null) !== null && p.jenis !== 'live') {
        throw new ValidationError(MSG_INCOMPLETE);
      }
      if ((p.floorPrice ?? null) !== null && (p.jenis !== 'harga' || (p.sku ?? '').trim() === '')) {
        throw new ValidationError(MSG_INCOMPLETE);
      }
      if (
        (p.hargaPromo ?? null) !== null &&
        (p.floorPrice ?? null) !== null &&
        Number(p.hargaPromo) < Number(p.floorPrice)
      ) {
        throw new ValidationError(MSG_INCOMPLETE);
      }
    }
    await tx`delete from strategi_pillar where strategi_id = ${id}`;
    let i = 0;
    for (const p of pillars) {
      await tx`
        insert into strategi_pillar
          (strategi_id, jenis, channel, urutan, sku, peran, aksi, target, harga_normal,
           harga_promo, floor_price, vendor_id, slot_jam, tarif, target_gmv_per_jam,
           detail, created_by)
        values
          (${id}, ${p.jenis}, ${nullIfBlank(p.channel)}, ${p.urutan ?? i}, ${nullIfBlank(p.sku)},
           ${nullIfBlank(p.peran)}, ${(p.aksi ?? '').trim()}, ${(p.target ?? '').trim()},
           ${p.hargaNormal ?? null}, ${p.hargaPromo ?? null}, ${p.floorPrice ?? null},
           ${nullIfBlank(p.vendorId)}, ${p.slotJam ?? null}, ${p.tarif ?? null},
           ${p.targetGmvPerJam ?? null}, ${(p.detail ?? {}) as never},
           ${actor.employeeId})`;
      i += 1;
    }
    await ex.audit.insertAudit({
      entityType: ENTITY_STRATEGI,
      entityId: id,
      actorEmployeeId: actor.employeeId,
      action: 'save_pillars',
      beforeJson: null,
      afterJson: { jenis: pillars.map((p) => p.jenis) },
      createdBy: actor.employeeId,
    });
    return loadDetail(tx, await loadStrategiRow(tx, id));
  });
}

/** Section F input. */
export interface ResourceInput {
  jenis: ResourceKind;
  channel?: string | null;
  divisi?: string | null;
  nilai?: string | null;
  jumlah?: number | null;
  satuan?: string | null;
  sumberDana?: 'klien' | 'paket_mea' | null;
  vendorId?: string | null;
  skemaBiaya?: string | null;
  catatan?: string;
}

/** saveResources replaces Section F (the soft commitment Briefs compare against). */
export async function saveResources(
  sql: Sql,
  actor: Actor,
  id: string,
  resources: ResourceInput[],
): Promise<StrategiDetail> {
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    await requireDraftAndWriter(tx, actor, id);
    for (const r of resources) {
      if (!RESOURCE_KINDS.includes(r.jenis)) {
        throw new ValidationError(MSG_INCOMPLETE);
      }
      if (r.jenis === 'budget_iklan' && ((r.nilai ?? null) === null || (r.sumberDana ?? null) === null)) {
        // F-1 without a funding source is unusable to Finance, who receive
        // `strategi_disetujui` precisely because of this number.
        throw new ValidationError(MSG_INCOMPLETE);
      }
      if (r.jenis === 'divisi' && (r.divisi ?? '').trim() === '') {
        throw new ValidationError(MSG_INCOMPLETE);
      }
      if ((r.vendorId ?? null) !== null && r.jenis !== 'live_vendor') {
        throw new ValidationError(MSG_INCOMPLETE);
      }
    }
    await tx`delete from strategi_resource where strategi_id = ${id}`;
    for (const r of resources) {
      await tx`
        insert into strategi_resource
          (strategi_id, jenis, channel, divisi, nilai, jumlah, satuan, sumber_dana,
           vendor_id, skema_biaya, catatan, created_by)
        values
          (${id}, ${r.jenis}, ${nullIfBlank(r.channel)}, ${nullIfBlank(r.divisi)},
           ${r.nilai ?? null}, ${r.jumlah ?? null}, ${nullIfBlank(r.satuan)},
           ${nullIfBlank(r.sumberDana)}, ${nullIfBlank(r.vendorId)},
           ${nullIfBlank(r.skemaBiaya)}, ${(r.catatan ?? '').trim()}, ${actor.employeeId})`;
    }
    await ex.audit.insertAudit({
      entityType: ENTITY_STRATEGI,
      entityId: id,
      actorEmployeeId: actor.employeeId,
      action: 'save_resources',
      beforeJson: null,
      afterJson: { jenis: resources.map((r) => r.jenis) },
      createdBy: actor.employeeId,
    });
    return loadDetail(tx, await loadStrategiRow(tx, id));
  });
}

/** H-1 input. */
export interface RiskInput {
  risiko: string;
  dampak: RiskLevel;
  kemungkinan: RiskLevel;
  mitigasi: string;
  pic: string;
  urutan?: number;
}

/** saveRisks replaces the H-1 risk register. */
export async function saveRisks(
  sql: Sql,
  actor: Actor,
  id: string,
  risks: RiskInput[],
): Promise<StrategiDetail> {
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    await requireDraftAndWriter(tx, actor, id);
    for (const r of risks) {
      if (!RISK_LEVELS.includes(r.dampak) || !RISK_LEVELS.includes(r.kemungkinan)) {
        throw new ValidationError(MSG_INCOMPLETE);
      }
      if (
        (r.risiko ?? '').trim() === '' ||
        (r.mitigasi ?? '').trim() === '' ||
        (r.pic ?? '').trim() === ''
      ) {
        throw new ValidationError(MSG_INCOMPLETE);
      }
    }
    await tx`delete from strategi_risk where strategi_id = ${id}`;
    let i = 0;
    for (const r of risks) {
      await tx`
        insert into strategi_risk
          (strategi_id, risiko, dampak, kemungkinan, mitigasi, pic, urutan, created_by)
        values
          (${id}, ${r.risiko.trim()}, ${r.dampak}, ${r.kemungkinan}, ${r.mitigasi.trim()},
           ${r.pic.trim()}, ${r.urutan ?? i}, ${actor.employeeId})`;
      i += 1;
    }
    await ex.audit.insertAudit({
      entityType: ENTITY_STRATEGI,
      entityId: id,
      actorEmployeeId: actor.employeeId,
      action: 'save_risks',
      beforeJson: null,
      afterJson: { count: risks.length },
      createdBy: actor.employeeId,
    });
    return loadDetail(tx, await loadStrategiRow(tx, id));
  });
}

// ---------------------------------------------------------------------------
// Section E-12 / G / H-2 / I (A-09b)
// ---------------------------------------------------------------------------

/** E-12 — one client dependency. All three parts are the point (see the type). */
export interface KetergantunganInput {
  item: string;
  kapan: string;
  konsekuensi: string;
  urutan?: number | null;
}

/** G-1 — one work phase. */
export interface FaseInput {
  nama: string;
  tanggalMulai: string;
  tanggalAkhir: string;
  tujuan: string;
  kriteriaLulus: string;
  urutan?: number | null;
}

/** G-2 — one big date. */
export interface TanggalBesarInput {
  tanggal: string;
  nama: string;
  peran: string;
  urutan?: number | null;
}

/**
 * G-1 + G-2 + G-3 + G-4 in one call, because Section G is one screen and one
 * autosave. Splitting it would make the calendar savable in states where the
 * phases exist but the review cadence that reads them does not.
 */
export interface KalenderInput {
  fase: FaseInput[];
  tanggalBesar: TanggalBesarInput[];
  reviewKlienFrekuensi?: string | null;
  reviewKlienFormat?: string | null;
  reviewKlienPic?: string | null;
  reviewInternalFrekuensi?: string | null;
}

/**
 * saveKetergantungan writes E-12.
 *
 * Kept out of `saveKalender` on purpose: E-12 is Section E, and folding it into
 * a Section G call would make the form's "which section is incomplete" answer
 * depend on which route happened to save last.
 */
export async function saveKetergantungan(
  sql: Sql,
  actor: Actor,
  id: string,
  rows: KetergantunganInput[],
): Promise<StrategiDetail> {
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    await requireDraftAndWriter(tx, actor, id);
    for (const k of rows) {
      if (
        (k.item ?? '').trim() === '' ||
        (k.kapan ?? '').trim() === '' ||
        (k.konsekuensi ?? '').trim() === ''
      ) {
        throw new ValidationError(MSG_KETERGANTUNGAN_INCOMPLETE);
      }
    }
    await tx`delete from strategi_ketergantungan_klien where strategi_id = ${id}`;
    let i = 0;
    for (const k of rows) {
      await tx`
        insert into strategi_ketergantungan_klien
          (strategi_id, item, kapan, konsekuensi, urutan, created_by)
        values
          (${id}, ${k.item.trim()}, ${k.kapan.trim()}, ${k.konsekuensi.trim()},
           ${k.urutan ?? i}, ${actor.employeeId})`;
      i += 1;
    }
    await ex.audit.insertAudit({
      entityType: ENTITY_STRATEGI,
      entityId: id,
      actorEmployeeId: actor.employeeId,
      action: 'save_ketergantungan',
      beforeJson: null,
      afterJson: { count: rows.length },
      createdBy: actor.employeeId,
    });
    return loadDetail(tx, await loadStrategiRow(tx, id));
  });
}

/** saveKalender writes G-1, G-2, G-3 and G-4. */
export async function saveKalender(
  sql: Sql,
  actor: Actor,
  id: string,
  input: KalenderInput,
): Promise<StrategiDetail> {
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    await requireDraftAndWriter(tx, actor, id);

    const teks = (v: string | null | undefined): string | null => {
      const t = (v ?? '').trim();
      return t === '' ? null : t;
    };

    const fase = input.fase ?? [];
    for (const f of fase) {
      if (
        (f.nama ?? '').trim() === '' ||
        (f.tujuan ?? '').trim() === '' ||
        (f.kriteriaLulus ?? '').trim() === '' ||
        !RE_DATE.test((f.tanggalMulai ?? '').trim()) ||
        !RE_DATE.test((f.tanggalAkhir ?? '').trim())
      ) {
        throw new ValidationError(MSG_FASE_INCOMPLETE);
      }
      // Checked here as well as by `ck_strfase_rentang` so the AM gets the
      // named reason rather than a constraint violation. The CHECK stays the
      // enforcement; this is the translation.
      if (f.tanggalAkhir.trim() < f.tanggalMulai.trim()) {
        throw new ValidationError(MSG_FASE_RENTANG);
      }
    }

    const besar = input.tanggalBesar ?? [];
    for (const t of besar) {
      if (
        !RE_DATE.test((t.tanggal ?? '').trim()) ||
        (t.nama ?? '').trim() === '' ||
        (t.peran ?? '').trim() === ''
      ) {
        throw new ValidationError(MSG_TANGGAL_BESAR_INCOMPLETE);
      }
    }

    await tx`delete from strategi_fase where strategi_id = ${id}`;
    let i = 0;
    for (const f of fase) {
      await tx`
        insert into strategi_fase
          (strategi_id, nama, tanggal_mulai, tanggal_akhir, tujuan, kriteria_lulus,
           urutan, created_by)
        values
          (${id}, ${f.nama.trim()}, ${f.tanggalMulai.trim()}, ${f.tanggalAkhir.trim()},
           ${f.tujuan.trim()}, ${f.kriteriaLulus.trim()}, ${f.urutan ?? i},
           ${actor.employeeId})`;
      i += 1;
    }

    await tx`delete from strategi_tanggal_besar where strategi_id = ${id}`;
    i = 0;
    for (const t of besar) {
      await tx`
        insert into strategi_tanggal_besar
          (strategi_id, tanggal, nama, peran, urutan, created_by)
        values
          (${id}, ${t.tanggal.trim()}, ${t.nama.trim()}, ${t.peran.trim()},
           ${t.urutan ?? i}, ${actor.employeeId})`;
      i += 1;
    }

    await tx`
      update strategi set
        review_klien_frekuensi    = ${teks(input.reviewKlienFrekuensi)},
        review_klien_format       = ${teks(input.reviewKlienFormat)},
        review_klien_pic          = ${teks(input.reviewKlienPic)},
        review_internal_frekuensi = ${teks(input.reviewInternalFrekuensi)}
       where id = ${id}`;

    await ex.audit.insertAudit({
      entityType: ENTITY_STRATEGI,
      entityId: id,
      actorEmployeeId: actor.employeeId,
      action: 'save_kalender',
      beforeJson: null,
      afterJson: { fase: fase.length, tanggal_besar: besar.length },
      createdBy: actor.employeeId,
    });
    return loadDetail(tx, await loadStrategiRow(tx, id));
  });
}

/** H-2 — one declared revision trigger. */
export interface TriggerRevisiInput {
  kode: TriggerRevisiCode;
  ambang?: number | null;
  catatan?: string | null;
  urutan?: number | null;
}

/**
 * saveTriggerRevisi writes H-2.
 *
 * Every rule below is also a DB CHECK. The duplication is deliberate and is the
 * house pattern (A-08 D-6): the CHECK is the enforcement — it holds against
 * service-role writes and any future caller — and this layer exists to name the
 * failure in Bahasa Indonesia instead of surfacing `ck_strtrg_ambang`.
 */
export async function saveTriggerRevisi(
  sql: Sql,
  actor: Actor,
  id: string,
  rows: TriggerRevisiInput[],
): Promise<StrategiDetail> {
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    await requireDraftAndWriter(tx, actor, id);

    // `lainnya` is excluded from the duplicate check for the same reason
    // `uq_strtrg_kode` is partial: what distinguishes two `lainnya` rows is the
    // note, not the code.
    const seen = new Set<string>();
    for (const t of rows) {
      if (!TRIGGER_REVISI_CODES.includes(t.kode)) {
        throw new ValidationError(MSG_TRIGGER_REVISI_INVALID);
      }
      if (t.kode !== 'lainnya') {
        if (seen.has(t.kode)) throw new ValidationError(MSG_TRIGGER_DUPLICATE);
        seen.add(t.kode);
      }
      const perluAmbang = TRIGGER_REVISI_BERAMBANG.includes(t.kode);
      const ambang = t.ambang ?? null;
      if (perluAmbang && ambang === null) {
        throw new ValidationError(MSG_TRIGGER_AMBANG_REQUIRED);
      }
      if (!perluAmbang && ambang !== null) {
        throw new ValidationError(MSG_TRIGGER_AMBANG_TERLARANG);
      }
      if (ambang !== null) {
        if (!Number.isFinite(ambang) || ambang <= 0) {
          throw new ValidationError(MSG_TRIGGER_AMBANG_INVALID);
        }
        // "<X% target" only means anything up to 100; days have no such ceiling.
        if (t.kode === 'pencapaian_di_bawah_target' && ambang > 100) {
          throw new ValidationError(MSG_TRIGGER_AMBANG_INVALID);
        }
      }
      if (t.kode === 'lainnya' && (t.catatan ?? '').trim() === '') {
        throw new ValidationError(MSG_TRIGGER_LAINNYA_CATATAN);
      }
    }

    await tx`delete from strategi_trigger_revisi where strategi_id = ${id}`;
    let i = 0;
    for (const t of rows) {
      await tx`
        insert into strategi_trigger_revisi
          (strategi_id, kode, ambang, catatan, urutan, created_by)
        values
          (${id}, ${t.kode}, ${t.ambang ?? null}, ${nullIfBlank(t.catatan)},
           ${t.urutan ?? i}, ${actor.employeeId})`;
      i += 1;
    }
    await ex.audit.insertAudit({
      entityType: ENTITY_STRATEGI,
      entityId: id,
      actorEmployeeId: actor.employeeId,
      action: 'save_trigger_revisi',
      beforeJson: null,
      afterJson: { kode: rows.map((t) => t.kode) },
      createdBy: actor.employeeId,
    });
    return loadDetail(tx, await loadStrategiRow(tx, id));
  });
}

/** I-2 + I-4 — a receiving division, its dispatch position, and its note. */
export interface DispatchInput {
  divisi: DispatchDivision;
  urutan?: number | null;
  /** I-4, optional. */
  catatan?: string | null;
}

/** I-2 + I-3 + I-4 — Section I is one screen. */
export interface HandoffInput {
  dispatch: DispatchInput[];
  metrikLaporanKlien?: LaporanMetric[];
}

/** saveHandoff writes I-2, I-3 and I-4. */
export async function saveHandoff(
  sql: Sql,
  actor: Actor,
  id: string,
  input: HandoffInput,
): Promise<StrategiDetail> {
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    await requireDraftAndWriter(tx, actor, id);

    const rows = input.dispatch ?? [];
    const divisiSeen = new Set<string>();
    const urutanSeen = new Set<number>();
    let i = 1;
    const normalised = rows.map((d) => {
      if (!DISPATCH_DIVISIONS.includes(d.divisi)) {
        throw new ValidationError(MSG_DISPATCH_INVALID);
      }
      if (divisiSeen.has(d.divisi)) throw new ValidationError(MSG_DISPATCH_DUPLICATE);
      divisiSeen.add(d.divisi);
      // Position defaults to arrival order. An order with two divisions at
      // position 1 is not an order — `uq_strdisp_urutan` refuses it, and this
      // names the refusal.
      const urutan = d.urutan ?? i;
      if (!Number.isInteger(urutan) || urutan < 1) {
        throw new ValidationError(MSG_DISPATCH_INVALID);
      }
      if (urutanSeen.has(urutan)) throw new ValidationError(MSG_DISPATCH_URUTAN_DUPLICATE);
      urutanSeen.add(urutan);
      i += 1;
      return { divisi: d.divisi, urutan, catatan: nullIfBlank(d.catatan) };
    });

    const metrik = input.metrikLaporanKlien ?? [];
    for (const m of metrik) {
      if (!LAPORAN_METRICS.includes(m)) {
        throw new ValidationError(MSG_METRIK_LAPORAN_INVALID);
      }
    }
    // Duplicates are dropped rather than refused: I-3 is a SET of metrics, and
    // "GMV twice" is the same answer as "GMV", not a different one.
    const metrikUnik = [...new Set(metrik)];

    await tx`delete from strategi_dispatch where strategi_id = ${id}`;
    for (const d of normalised) {
      await tx`
        insert into strategi_dispatch (strategi_id, divisi, urutan, catatan, created_by)
        values (${id}, ${d.divisi}, ${d.urutan}, ${d.catatan}, ${actor.employeeId})`;
    }
    await tx`
      update strategi set metrik_laporan_klien = ${metrikUnik as never}::jsonb
       where id = ${id}`;

    await ex.audit.insertAudit({
      entityType: ENTITY_STRATEGI,
      entityId: id,
      actorEmployeeId: actor.employeeId,
      action: 'save_handoff',
      beforeJson: null,
      afterJson: {
        dispatch: normalised.map((d) => `${d.urutan}:${d.divisi}`),
        metrik_laporan_klien: metrikUnik,
      },
      createdBy: actor.employeeId,
    });
    return loadDetail(tx, await loadStrategiRow(tx, id));
  });
}

// ---------------------------------------------------------------------------
// A-10 — the §4.1 visibility overlay (Rule 16)
// ---------------------------------------------------------------------------

/**
 * Seeds `STRG_FIELD_VISIBILITY` with the §4.1 defaults for one Strategi (§7).
 *
 * Every field on the roster gets a row, so the overlay describes the document as
 * it stood the day it was created rather than as the constant reads today —
 * which matters because `/s/{token}` (A-11) publishes to someone who cannot be
 * asked to re-read it. `ON CONFLICT DO NOTHING` because `copyChildren` seeds a
 * revision from its predecessor first: the carried-over AM decisions win, and
 * this only fills fields that did not exist in the previous version.
 */
async function seedFieldVisibility(
  tx: TransactionSql,
  strategiId: string,
  actorId: string,
): Promise<void> {
  const rows = visibility.STRATEGI_FIELD_ROSTER.map((fieldId) => ({
    strategi_id: strategiId,
    field_id: fieldId,
    // Non-null over the whole roster — `visibility.test.ts` proves it, so the
    // `?? VISIBILITY_INTERNAL` here is a type narrowing, not a silent default.
    visibilitas: visibility.defaultVisibility(fieldId) ?? visibility.VISIBILITY_INTERNAL,
    created_by: actorId,
  }));
  await tx`
    insert into strategi_field_visibility ${tx(rows, 'strategi_id', 'field_id', 'visibilitas', 'created_by')}
    on conflict (strategi_id, field_id) do nothing`;
}

/**
 * Reads the overlay and joins each row to its §4.1 tier.
 *
 * A row whose `field_id` the registry no longer knows is DROPPED, not returned
 * with a guessed tier. `tierOf` answering `null` means "this is not a Strategi
 * field", and the one thing that must never happen is such a row reaching a
 * caller that reads `visibilitas` without re-checking the tier.
 */
async function loadFieldVisibility(
  sql: Queryable,
  strategiId: string,
): Promise<StrategiFieldVisibility[]> {
  const rows = await sql<
    {
      field_id: string;
      visibilitas: string;
      diubah_oleh: string | null;
      diubah_pada: string | Date | null;
    }[]
  >`select field_id, visibilitas, diubah_oleh, diubah_pada
      from strategi_field_visibility
     where strategi_id = ${strategiId}
     order by field_id asc`;

  const out: StrategiFieldVisibility[] = [];
  for (const r of rows) {
    const tier = visibility.tierOf(r.field_id);
    if (tier === null) continue;
    out.push({
      fieldId: r.field_id,
      // Rule 16(a) applied on READ as well as on write. The overlay is a table;
      // a hard-internal row that somehow says `Bagikan ke Klien` — a bad
      // migration, a service-role script — must read back as internal rather
      // than be reported as shareable to whatever renders next.
      visibilitas:
        tier === 'hard_internal'
          ? visibility.VISIBILITY_INTERNAL
          : (r.visibilitas as visibility.Visibility),
      tier,
      dapatDiubah: visibility.canToggleShareable(r.field_id),
      diubahOleh: r.diubah_oleh,
      diubahPada: r.diubah_pada === null ? null : new Date(r.diubah_pada).toISOString(),
    });
  }
  return out;
}

/**
 * setFieldVisibility flips one field's `visibilitas` (Rule 16(b)).
 *
 * **Not Draft-only, and that is deliberate.** Rule 16(c) serves the client view
 * from the approved active version, so a Draft-only toggle would mean the only
 * way to share one more field with a client mid-contract is to open a revision —
 * which Rule 13 makes expensive on purpose (a trigger from H-2, a written
 * reason, a broken assumption) and which bumps the version number over a
 * decision that changed nothing about the strategy. `setAssumptionStatus` is the
 * existing precedent for a non-Draft write on this record.
 *
 * What IS refused is a version whose visibility is already history: `Diarsipkan`
 * and `Kedaluwarsa` (Rule 13 — "immutable, still readable").
 *
 * One field per call, because one toggle is one decision and the audit row has
 * to be able to name it. A batch endpoint would write "12 fields changed" into
 * the log, which answers nothing during the dispute this log exists for.
 */
export async function setFieldVisibility(
  sql: Sql,
  actor: Actor,
  id: string,
  fieldId: string,
  visibilitas: string,
): Promise<StrategiFieldVisibility[]> {
  const field = (fieldId ?? '').trim();
  const value = (visibilitas ?? '').trim();

  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const head = await loadStrategiRow(tx, id, true);
    const ownerAm = await ownerAmOfContract(tx, head.contractId);
    if (!canWriteStrategi(actor, ownerAm)) {
      throw new ForbiddenError(MSG_NOT_OWNER_AM);
    }
    if (VERSI_HISTORIS_STATUS.includes(head.status)) {
      throw new ConflictError(MSG_VISIBILITAS_TERKUNCI);
    }

    const tier = visibility.tierOf(field);
    if (tier === null) {
      throw new ValidationError(MSG_FIELD_ID_UNKNOWN);
    }
    if (!(visibility.VISIBILITIES as readonly string[]).includes(value)) {
      throw new ValidationError(MSG_VISIBILITAS_INVALID);
    }
    // Rule 16(a) covers BOTH directions for a hard-internal field. Accepting
    // `Internal Saja` here would be a no-op that reads, in the audit log, as a
    // visibility decision someone made about A-10 — and the next reader would
    // reasonably conclude the other direction was available too.
    if (tier === 'hard_internal') {
      throw new ForbiddenError(MSG_VISIBILITAS_HARD_INTERNAL);
    }

    const prev = await tx<{ visibilitas: string }[]>`
      select visibilitas from strategi_field_visibility
       where strategi_id = ${id} and field_id = ${field}`;
    const before = prev.length > 0 ? prev[0].visibilitas : visibility.defaultVisibility(field);

    // UPSERT rather than UPDATE: a field added to §4 after this Strategi was
    // created has no seeded row, and refusing to record the AM's answer because
    // of when the record happened to be made is the wrong failure.
    await tx`
      insert into strategi_field_visibility
        (strategi_id, field_id, visibilitas, diubah_oleh, diubah_pada, created_by)
      values (${id}, ${field}, ${value}, ${actor.employeeId}, now(), ${actor.employeeId})
      on conflict (strategi_id, field_id) do update
        set visibilitas = excluded.visibilitas,
            diubah_oleh = excluded.diubah_oleh,
            diubah_pada = excluded.diubah_pada`;

    // Rule 16(b) — "the toggle is audit-logged". before→after by field, which is
    // what answers "who decided the client could see the margin figure".
    await ex.audit.insertAudit({
      entityType: ENTITY_STRATEGI,
      entityId: id,
      actorEmployeeId: actor.employeeId,
      action: 'set_field_visibility',
      beforeJson: { field_id: field, visibilitas: before },
      afterJson: { field_id: field, visibilitas: value },
      createdBy: actor.employeeId,
    });

    return loadFieldVisibility(tx, id);
  });
}

/**
 * The field IDs a client may see for one Strategi, overlay applied.
 *
 * The single door A-11 (`/s/{token}`) will render through, so that the filter
 * §7 requires to run BEFORE serialisation has exactly one implementation. It
 * takes the roster from `packages/core` rather than from the overlay rows: a
 * field with no row must fall back to its §4.1 default, and a field the registry
 * has never heard of must not appear because a row exists for it.
 */
export async function shareableFieldIds(sql: Queryable, id: string): Promise<string[]> {
  const rows = await loadFieldVisibility(sql, id);
  const overlay: Record<string, visibility.Visibility> = {};
  for (const r of rows) overlay[r.fieldId] = r.visibilitas;
  return visibility.shareableFields(visibility.STRATEGI_FIELD_ROSTER, overlay);
}

// ---------------------------------------------------------------------------
// A-11 — client share link `/s/{token}` (§7 D20, RA-3, RA-7)
// ---------------------------------------------------------------------------

/** Status of the current share link, without ever exposing the secret. */
export interface ShareLinkStatus {
  /** `none` = never created; `aktif` = live; `dicabut` = revoked. */
  status: 'none' | 'aktif' | 'dicabut';
  tanggalKedaluwarsa: string | null;
  createdAt: string | null;
  createdBy: string | null;
  dicabutPada: string | null;
}

/** What `createShareToken` returns — the plaintext token, shown exactly once. */
export interface ShareTokenCreated extends ShareLinkStatus {
  /** The 32-byte secret, base64url. Never stored; if lost, regenerate. */
  token: string;
}

/** One shareable datum in the client view, tagged with the §4 field it came from. */
export interface ClientViewField {
  fieldId: string;
  label: string;
  value: string;
}

/** A section of the client view — only sections with at least one shareable field. */
export interface ClientViewSection {
  seksi: string;
  fields: ClientViewField[];
}

/**
 * The client-safe render of a Strategi. **RA-7 / X-06 (owner 2026-08-09): the
 * client link carries the ACTIVE version only — no version history, no diff.**
 * The full versioned record with history stays internal; if a client asks "what
 * changed", the AM explains it in the meeting rather than the system exposing it.
 */
export interface ShareLinkResolved {
  /** `false` for an unknown/revoked/expired token, or a contract with no active
   * version — all rendered as the same neutral "tautan tidak aktif" page (§7). */
  aktif: boolean;
  versiNo?: number;
  disetujuiPada?: string | null;
  sections?: ClientViewSection[];
}

/** SHA-256 hex of the raw token. Only the hash is ever stored or looked up (§7). */
function hashShareToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/** `YYYY-MM-DD` + n days, UTC-anchored so it never drifts by a calendar day. */
function addDaysISO(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The row with status `Aktif` for a contract, or null — the version a link pins to. */
async function activeStrategiOfContract(
  sql: Queryable,
  contractId: string,
): Promise<Strategi | null> {
  const rows = await sql<{ id: string }[]>`
    select id from strategi where contract_id = ${contractId} and status = ${STRATEGI_AKTIF} limit 1`;
  if (rows.length === 0) return null;
  return loadStrategiRow(sql, rows[0].id);
}

/**
 * Projects a full StrategiDetail down to the client-safe view.
 *
 * **Safe by construction:** every block is gated on the field ID it renders being
 * in `shareable`, so a field that is hard-internal or that the AM switched off can
 * never appear — the same guarantee `shareableFields` gives per field, applied at
 * the block level. Adding a block means adding a gate; there is no default that
 * renders an ungated field. History and diff are never projected (RA-7).
 */
function clientView(detail: StrategiDetail, shareable: ReadonlySet<string>): ClientViewSection[] {
  const out: ClientViewSection[] = [];

  // Section B — the channels in scope. B is wholly shareable (§4.1); gate on a
  // representative B field so an AM who hid all of B hides this block too.
  if (shareable.has('B-1.1') && detail.channels.length > 0) {
    out.push({
      seksi: 'Channel',
      fields: detail.channels.map((c) => ({
        fieldId: 'B-1.1',
        label: c.namaToko || c.channel,
        value: c.channelLain ? `${c.channel} (${c.channelLain})` : c.channel,
      })),
    });
  }

  // Section E-1 — the growth thesis the whole strategy hangs off.
  if (shareable.has('E-1') && detail.growthThesis) {
    out.push({ seksi: 'Tesis Pertumbuhan', fields: [{ fieldId: 'E-1', label: 'Tesis', value: detail.growthThesis }] });
  }

  // Section D-2 — the target matrix, the numbers a client came to see.
  if (shareable.has('D-2') && detail.targets.length > 0) {
    out.push({
      seksi: 'Target',
      fields: detail.targets.map((t) => ({
        fieldId: 'D-2',
        label: `${t.metric} · ${t.channel} · Bulan ${t.monthIndex}`,
        value: t.nilaiFloor ? `${t.nilaiFloor} → ${t.nilaiStretch}` : t.nilaiStretch,
      })),
    });
  }

  // Section D-8 — the assumptions, mostly things the client must deliver. §4.1
  // calls this deliberately shareable: it turns "kenapa target gak kejar" into a
  // checklist both sides signed off on.
  if (shareable.has('D-8') && detail.assumptions.length > 0) {
    out.push({
      seksi: 'Asumsi',
      fields: detail.assumptions.map((a) => ({
        fieldId: 'D-8',
        label: a.asumsi,
        value: a.pemilik ? `PIC: ${a.pemilik}` : '',
      })),
    });
  }

  return out;
}

/**
 * createShareToken mints (or rotates) the one active link for a Strategi's
 * contract (§7 D20).
 *
 * The token binds to `contract_id`, not to one version row, so it follows the
 * active version across revisions (see the migration comment). Regenerating
 * revokes the previous active token in the same transaction — §7 "regenerating
 * invalidates the old one immediately". The 32-byte secret is returned exactly
 * once; only its SHA-256 is stored. Default expiry is contract end + 30 days.
 */
export async function createShareToken(
  sql: Sql,
  actor: Actor,
  id: string,
): Promise<ShareTokenCreated> {
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const head = await loadStrategiRow(tx, id, true);
    const ownerAm = await ownerAmOfContract(tx, head.contractId);
    // AM (owner) or Account lead/SPV — §7 "AM or SPV can revoke instantly", and
    // the same two roles mint it.
    if (!canWriteStrategi(actor, ownerAm) && !canApproveStrategi(actor)) {
      throw new ForbiddenError(MSG_NOT_OWNER_AM);
    }
    const active = await activeStrategiOfContract(tx, head.contractId);
    if (active === null) {
      throw new ValidationError(MSG_SHARE_NO_ACTIVE_VERSION);
    }

    await tx`
      update strategi_share_token
         set status = 'Dicabut', dicabut_oleh = ${actor.employeeId}, dicabut_pada = now()
       where contract_id = ${head.contractId} and status = 'Aktif'`;

    const raw = randomBytes(32).toString('base64url');
    const expiry = addDaysISO(active.tanggalAkhirKontrak, 30);
    const rows = await tx<{ tanggal_kedaluwarsa: string; created_at: string }[]>`
      insert into strategi_share_token (contract_id, token_hash, tanggal_kedaluwarsa, created_by)
      values (${head.contractId}, ${hashShareToken(raw)}, ${expiry}, ${actor.employeeId})
      returning tanggal_kedaluwarsa, created_at`;

    await ex.audit.insertAudit({
      entityType: ENTITY_STRATEGI,
      entityId: active.id,
      actorEmployeeId: actor.employeeId,
      action: 'create_share_token',
      beforeJson: null,
      afterJson: { contract_id: head.contractId, tanggal_kedaluwarsa: expiry },
      createdBy: actor.employeeId,
    });

    return {
      token: raw,
      status: 'aktif',
      tanggalKedaluwarsa: rows[0].tanggal_kedaluwarsa,
      createdAt: String(rows[0].created_at),
      createdBy: actor.employeeId,
      dicabutPada: null,
    };
  });
}

/** revokeShareToken kills the active link immediately (§7). Idempotent. */
export async function revokeShareToken(sql: Sql, actor: Actor, id: string): Promise<ShareLinkStatus> {
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const head = await loadStrategiRow(tx, id, true);
    const ownerAm = await ownerAmOfContract(tx, head.contractId);
    if (!canWriteStrategi(actor, ownerAm) && !canApproveStrategi(actor)) {
      throw new ForbiddenError(MSG_NOT_OWNER_AM);
    }
    const rows = await tx<{ id: string }[]>`
      update strategi_share_token
         set status = 'Dicabut', dicabut_oleh = ${actor.employeeId}, dicabut_pada = now()
       where contract_id = ${head.contractId} and status = 'Aktif'
      returning id`;
    if (rows.length > 0) {
      await ex.audit.insertAudit({
        entityType: ENTITY_STRATEGI,
        entityId: id,
        actorEmployeeId: actor.employeeId,
        action: 'revoke_share_token',
        beforeJson: { status: 'Aktif' },
        afterJson: { status: 'Dicabut' },
        createdBy: actor.employeeId,
      });
    }
    return shareLinkStatusOf(tx, head.contractId);
  });
}

/** getShareLinkStatus reports the current link for the internal Strategi page. */
export async function getShareLinkStatus(
  sql: Queryable,
  actor: Actor,
  id: string,
): Promise<ShareLinkStatus> {
  const head = await loadStrategiRow(sql, id);
  const ownerAm = await ownerAmOfContract(sql, head.contractId);
  if (!canReadStrategi(actor, ownerAm)) {
    throw new ForbiddenError(MSG_NOT_OWNER_AM);
  }
  return shareLinkStatusOf(sql, head.contractId);
}

/** The active token if any, else the most recent revoked one, as status only. */
async function shareLinkStatusOf(sql: Queryable, contractId: string): Promise<ShareLinkStatus> {
  const rows = await sql<
    { status: string; tanggal_kedaluwarsa: string | null; created_at: string; created_by: string; dicabut_pada: string | null }[]
  >`
    select status, tanggal_kedaluwarsa, created_at, created_by, dicabut_pada
      from strategi_share_token
     where contract_id = ${contractId}
     order by (status = 'Aktif') desc, created_at desc
     limit 1`;
  if (rows.length === 0) {
    return { status: 'none', tanggalKedaluwarsa: null, createdAt: null, createdBy: null, dicabutPada: null };
  }
  const r = rows[0];
  return {
    status: r.status === 'Aktif' ? 'aktif' : 'dicabut',
    tanggalKedaluwarsa: r.tanggal_kedaluwarsa,
    createdAt: String(r.created_at),
    createdBy: r.created_by,
    dicabutPada: r.dicabut_pada === null ? null : String(r.dicabut_pada),
  };
}

/**
 * resolveShareLink turns a raw `/s/{token}` secret into the client-safe view,
 * and writes the access log (§7). NO actor: the token IS the credential, so this
 * runs on a service-role connection and the safety comes entirely from the filter
 * and the checks here — never from RLS.
 *
 * Returns `{ aktif: false }` — the single neutral outcome — for an unknown,
 * revoked, or expired token, and for a contract with no approved active version
 * (a Draft/Draft Revisi is never reachable, §7). No branch leaks which case it was.
 */
export async function resolveShareLink(
  sql: Sql,
  rawToken: string,
  meta: { ip?: string | null; userAgent?: string | null } = {},
): Promise<ShareLinkResolved> {
  const hash = hashShareToken((rawToken ?? '').trim());
  return withTransaction(sql, async (tx) => {
    const toks = await tx<{ id: string; contract_id: string; status: string; expired: boolean }[]>`
      select id, contract_id, status,
             (tanggal_kedaluwarsa is not null and tanggal_kedaluwarsa < wib_date(now())) as expired
        from strategi_share_token where token_hash = ${hash}`;
    if (toks.length === 0) return { aktif: false };
    const tok = toks[0];
    if (tok.status !== 'Aktif' || tok.expired) return { aktif: false };

    const active = await activeStrategiOfContract(tx, tok.contract_id);
    if (active === null) return { aktif: false };

    const detail = await loadDetail(tx, active);
    const shareable = new Set(await shareableFieldIds(tx, active.id));
    const sections = clientView(detail, shareable);

    await tx`
      insert into strategi_share_access_log (token_id, strategi_id, versi_no, ip, user_agent)
      values (${tok.id}, ${active.id}, ${active.versiNo}, ${meta.ip ?? null}, ${meta.userAgent ?? null})`;

    return {
      aktif: true,
      versiNo: active.versiNo,
      disetujuiPada: active.disetujuiPada,
      sections,
    };
  });
}

// ---------------------------------------------------------------------------
// Submit gate (Rules 3, 5, 8, 9, 17 + D-8 / H-1 minimums)
// ---------------------------------------------------------------------------

/** One unmet requirement, as the form's live counter shows it (§5 step 5). */
export interface Kekurangan {
  kode: string;
  pesan: string;
}

// ---------------------------------------------------------------------------
// J-4 — auto-diff vs the previous version (§4 J-4, "Ringkasan perubahan")
// ---------------------------------------------------------------------------
//
// J-4 is an `Auto` field (Rule 4): derived, never typed, and recomputable from
// the versions themselves — so it is COMPUTED on read here, never stored (no
// migration, no column). It compares a version to the one it revised
// (`versi_sebelumnya_id`); version 1 has no predecessor and returns an empty
// diff (`adaPerbandingan = false`) rather than an error.
//
// Granularity (owner decision 2026-08-11): scalar fields render before→after
// precisely; collections render a summary (added / removed identities + a count
// of modified rows). That is what "Ringkasan perubahan" means — a summary an AM
// reads at a glance, not a full record dump.
//
// ⚠️ RA-7 keeps every diff OFF the client link (`/s/{token}` renders the active
// version only), so J-4 is INTERNAL-only in practice. But §4.1 / X-16 is
// explicit that the diff generator must still be able to filter its own rows per
// field — a shareable J-4 would otherwise render a change to a field that is
// itself hard-internal (D-7, H-4, F-5), leaking it through the back door while
// every per-field check passed. `clientVisibleDiff` is that filter, and
// `strategi.diff.test.ts` proves it drops the hard-internal rows. Each entry
// therefore carries the field ID it belongs to; where a collection spans several
// field IDs of different tiers (resources = F-1…F-5), it is tagged with the
// MOST restrictive member so the client filter errs safe.

/** One changed scalar field: before → after, both already formatted for display. */
export interface StrategiDiffScalar {
  jenis: 'skalar';
  fieldId: string;
  seksi: string;
  label: string;
  sebelum: string | null;
  sesudah: string | null;
}

/** One changed collection: which identities were added/removed, how many modified. */
export interface StrategiDiffKoleksi {
  jenis: 'koleksi';
  fieldId: string;
  seksi: string;
  label: string;
  ditambah: string[];
  dihapus: string[];
  diubah: number;
}

export type StrategiDiffEntry = StrategiDiffScalar | StrategiDiffKoleksi;

export interface StrategiDiff {
  versiNo: number;
  versiSebelumnyaId: string | null;
  versiSebelumnyaNo: number | null;
  /** false for version 1 (no predecessor) — the caller renders "versi pertama". */
  adaPerbandingan: boolean;
  entri: StrategiDiffEntry[];
}

/** Blank/empty → null so "" and absent read the same; numbers/booleans to text. */
function diffScalarValue(v: string | number | boolean | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'boolean') return v ? 'ya' : 'tidak';
  if (typeof v === 'number') return String(v);
  const t = v.trim();
  return t === '' ? null : t;
}

interface ScalarSpec {
  fieldId: string;
  label: string;
  val: (d: StrategiDetail) => string | number | boolean | null;
}

interface KoleksiSpec {
  fieldId: string;
  label: string;
  rows: (d: StrategiDetail) => Record<string, unknown>[];
  /** Stable identity ACROSS versions — never the row `id` (copyChildren re-mints it). */
  key: (r: Record<string, unknown>) => string;
  /** What the AM reads for an added/removed row. */
  describe: (r: Record<string, unknown>) => string;
  /** Canonical content for change detection; defaults to `key` (⇒ never "modified"). */
  content?: (r: Record<string, unknown>) => string;
}

const seksiOf = (fieldId: string): string => fieldId.charAt(0).toUpperCase();

/**
 * Every scalar field a revision can carry, mapped to its §4 field ID. D-7
 * (Sanggahan Target) is deliberately absent: `openRevision` does not carry it
 * (it is a dated act against one version's floor), so a diff would always show
 * it "removed" — noise, not a change the AM made.
 */
const SCALAR_DIFF_SPECS: readonly ScalarSpec[] = [
  { fieldId: 'A-1', label: 'Nama brand', val: (d) => d.namaBrand },
  { fieldId: 'A-1', label: 'Kategori utama', val: (d) => d.kategoriUtama },
  { fieldId: 'A-2', label: 'Model bisnis', val: (d) => d.modelBisnis },
  { fieldId: 'A-3', label: 'Ruang margin (%)', val: (d) => d.marginKotorPersen },
  { fieldId: 'A-4', label: 'Posisi harga', val: (d) => d.posisiHarga },
  { fieldId: 'A-6', label: 'Kapasitas stok', val: (d) => d.kapasitasStok },
  { fieldId: 'A-6', label: 'Lead time restock (hari)', val: (d) => d.leadTimeRestockHari },
  { fieldId: 'A-7', label: 'Plafon unit/bulan', val: (d) => d.plafonUnitPerBulan },
  { fieldId: 'A-8', label: 'Titik kirim (kota)', val: (d) => d.titikKirimKota },
  { fieldId: 'A-8', label: 'Titik kirim (detail)', val: (d) => d.titikKirimDetail },
  { fieldId: 'A-9', label: 'Ekspektasi klien', val: (d) => d.ekspektasiKlien },
  { fieldId: 'A-10', label: 'Riwayat agensi', val: (d) => d.riwayatAgensi },
  { fieldId: 'A-13', label: 'SLA klien (jam)', val: (d) => d.slaKlienJam },
  { fieldId: 'A-13', label: 'SLA klien (catatan)', val: (d) => d.slaKlienCatatan },
  { fieldId: 'A-14', label: 'Aset (catatan)', val: (d) => d.asetCatatan },
  { fieldId: 'D-5', label: 'Definisi berhasil 30 hari', val: (d) => d.definisiBerhasil30 },
  { fieldId: 'D-5', label: 'Definisi berhasil 60 hari', val: (d) => d.definisiBerhasil60 },
  { fieldId: 'D-5', label: 'Definisi berhasil 90 hari', val: (d) => d.definisiBerhasil90 },
  { fieldId: 'E-1', label: 'Growth thesis', val: (d) => d.growthThesis },
  { fieldId: 'E-13', label: 'Urutan eksekusi (alasan)', val: (d) => d.urutanEksekusiAlasan },
  { fieldId: 'H-3', label: 'Skenario mundur', val: (d) => d.skenarioMundur },
  { fieldId: 'H-4', label: 'Kondisi stop / ubah scope', val: (d) => d.kondisiStopScope },
  { fieldId: 'F-7', label: 'Toleransi over-komitmen (%)', val: (d) => d.toleransiOverPersen },
  { fieldId: 'G-0', label: 'Tanggal mulai siklus', val: (d) => d.tanggalMulaiSiklus },
  { fieldId: 'G-3', label: 'Review klien (frekuensi)', val: (d) => d.reviewKlienFrekuensi },
  { fieldId: 'G-3', label: 'Review klien (format)', val: (d) => d.reviewKlienFormat },
  { fieldId: 'G-3', label: 'Review klien (PIC)', val: (d) => d.reviewKlienPic },
  { fieldId: 'G-4', label: 'Review internal (frekuensi)', val: (d) => d.reviewInternalFrekuensi },
];

/** A short-string list treated as a set (usp, pantangan, …): identity IS the string. */
function listSpec(fieldId: string, label: string, get: (d: StrategiDetail) => string[]): KoleksiSpec {
  return {
    fieldId,
    label,
    rows: (d) => get(d).map((s) => ({ v: s })),
    key: (r) => String(r.v),
    describe: (r) => String(r.v),
  };
}

const KOLEKSI_DIFF_SPECS: readonly KoleksiSpec[] = [
  listSpec('A-1', 'Sub-kategori', (d) => d.subKategori),
  listSpec('A-5', 'USP produk', (d) => d.usp),
  listSpec('A-11', 'Pantangan klien', (d) => d.pantanganKlien),
  listSpec('A-14', 'Aset dari klien', (d) => d.asetDariKlien),
  listSpec('D-6', 'Leading indicator', (d) => d.leadingIndicator),
  listSpec('I-3', 'Metrik laporan klien', (d) => d.metrikLaporanKlien),
  {
    fieldId: 'A-12',
    label: 'Decision maker',
    rows: (d) => d.decisionMaker as unknown as Record<string, unknown>[],
    key: (r) => `${String(r.nama)}·${String(r.jabatan)}`,
    describe: (r) => `${String(r.nama)} (${String(r.jabatan)})`,
    content: (r) => `${r.berhakApprove}·${String(r.jalurEskalasi)}`,
  },
  {
    fieldId: 'B-0.1',
    label: 'Channel & baseline (Section B)',
    rows: (d) => d.channels as unknown as Record<string, unknown>[],
    key: (r) => `${String(r.channel)}·${String(r.channelLain ?? '')}`,
    describe: (r) => String(r.channelLain ?? r.channel),
    content: (r) => canonRow(r, ['id']),
  },
  {
    fieldId: 'A-15',
    label: 'Akses & hak per channel',
    rows: (d) => d.akses as unknown as Record<string, unknown>[],
    key: (r) => `${String(r.channel)}·${String(r.akses)}`,
    describe: (r) => `${String(r.channel)} / ${String(r.akses)}`,
    content: (r) => canonRow(r, ['id']),
  },
  {
    fieldId: 'C-1',
    label: 'Diagnosa per channel',
    rows: (d) => d.diagnosa as unknown as Record<string, unknown>[],
    key: (r) => String(r.channel),
    describe: (r) => String(r.channel),
    content: (r) => canonRow(r, ['id']),
  },
  {
    fieldId: 'C-5',
    label: 'Quick win',
    rows: (d) => d.quickWins as unknown as Record<string, unknown>[],
    key: (r) => `${String(r.channel)}·${String(r.aksi)}`,
    describe: (r) => truncate(String(r.aksi)),
    content: (r) => canonRow(r, ['id', 'urutan']),
  },
  {
    fieldId: 'C-6',
    label: 'Risiko struktural',
    rows: (d) => d.risikoStruktural as unknown as Record<string, unknown>[],
    key: (r) => String(r.risiko),
    describe: (r) => truncate(String(r.risiko)),
  },
  {
    fieldId: 'C-7',
    label: 'Prasyarat klien',
    rows: (d) => d.prasyaratKlien as unknown as Record<string, unknown>[],
    key: (r) => String(r.item),
    describe: (r) => truncate(String(r.item)),
    content: (r) => canonRow(r, ['id', 'urutan']),
  },
  {
    fieldId: 'D-2',
    label: 'Target stretch (D-2)',
    rows: (d) => d.targets as unknown as Record<string, unknown>[],
    key: (r) => `${String(r.channel)}·${String(r.metric)}·M${String(r.monthIndex)}`,
    describe: (r) => `${String(r.channel)} ${String(r.metric)} M${String(r.monthIndex)}`,
    content: (r) => `${String(r.nilaiFloor)}·${String(r.nilaiStretch)}`,
  },
  {
    fieldId: 'D-8',
    label: 'Asumsi target (D-8)',
    rows: (d) => d.assumptions as unknown as Record<string, unknown>[],
    key: (r) => String(r.kode),
    describe: (r) => String(r.kode),
    content: (r) => `${String(r.asumsi)}·${String(r.pemilik)}·${String(r.status)}`,
  },
  {
    fieldId: 'E-3',
    label: 'Pilar strategi (Section E)',
    rows: (d) => d.pillars as unknown as Record<string, unknown>[],
    key: (r) => `${String(r.jenis)}·${String(r.channel ?? '')}·${String(r.sku ?? '')}·${String(r.urutan)}`,
    describe: (r) => `${String(r.jenis)}${r.sku ? ` — ${String(r.sku)}` : ''}`,
    content: (r) => canonRow(r, ['id']),
  },
  {
    fieldId: 'F-5',
    label: 'Komitmen resource (Section F)',
    rows: (d) => d.resources as unknown as Record<string, unknown>[],
    key: (r) => `${String(r.jenis)}·${String(r.channel ?? '')}·${String(r.divisi ?? '')}·${String(r.urutan ?? '')}`,
    describe: (r) => `${String(r.jenis)}${r.divisi ? ` — ${String(r.divisi)}` : ''}`,
    content: (r) => canonRow(r, ['id']),
  },
  {
    fieldId: 'H-1',
    label: 'Risk register (H-1)',
    rows: (d) => d.risks as unknown as Record<string, unknown>[],
    key: (r) => String(r.risiko),
    describe: (r) => truncate(String(r.risiko)),
    content: (r) => canonRow(r, ['id', 'urutan']),
  },
  {
    fieldId: 'E-12',
    label: 'Ketergantungan klien (E-12)',
    rows: (d) => d.ketergantungan as unknown as Record<string, unknown>[],
    key: (r) => String(r.item),
    describe: (r) => truncate(String(r.item)),
    content: (r) => canonRow(r, ['id', 'urutan']),
  },
  {
    fieldId: 'G-1',
    label: 'Fase kerja (G-1)',
    rows: (d) => d.fase as unknown as Record<string, unknown>[],
    key: (r) => String(r.nama),
    describe: (r) => String(r.nama),
    content: (r) => canonRow(r, ['id', 'urutan']),
  },
  {
    fieldId: 'G-2',
    label: 'Tanggal besar (G-2)',
    rows: (d) => d.tanggalBesar as unknown as Record<string, unknown>[],
    key: (r) => `${String(r.tanggal)}·${String(r.nama)}`,
    describe: (r) => `${String(r.nama)} (${String(r.tanggal)})`,
    content: (r) => canonRow(r, ['id', 'urutan']),
  },
  {
    fieldId: 'H-2',
    label: 'Trigger revisi (H-2)',
    rows: (d) => d.triggerRevisi as unknown as Record<string, unknown>[],
    key: (r) => String(r.kode),
    describe: (r) => String(r.kode),
    content: (r) => canonRow(r, ['id']),
  },
  {
    fieldId: 'I-2',
    label: 'Dispatch divisi (I-2)',
    rows: (d) => d.dispatch as unknown as Record<string, unknown>[],
    key: (r) => String(r.divisi),
    describe: (r) => String(r.divisi),
    content: (r) => canonRow(r, ['id', 'urutan']),
  },
];

function truncate(s: string, n = 48): string {
  const t = s.trim();
  return t.length <= n ? t : `${t.slice(0, n - 1)}…`;
}

/** Stable JSON of a row with volatile keys dropped, keys sorted — for change detection. */
function canonRow(r: Record<string, unknown>, omit: string[]): string {
  const keys = Object.keys(r)
    .filter((k) => !omit.includes(k))
    .sort();
  return JSON.stringify(keys.map((k) => [k, r[k]]));
}

function diffScalars(prev: StrategiDetail, curr: StrategiDetail): StrategiDiffScalar[] {
  const out: StrategiDiffScalar[] = [];
  for (const s of SCALAR_DIFF_SPECS) {
    const before = diffScalarValue(s.val(prev));
    const after = diffScalarValue(s.val(curr));
    if (before !== after) {
      out.push({ jenis: 'skalar', fieldId: s.fieldId, seksi: seksiOf(s.fieldId), label: s.label, sebelum: before, sesudah: after });
    }
  }
  return out;
}

function diffKoleksi(prev: StrategiDetail, curr: StrategiDetail): StrategiDiffKoleksi[] {
  const out: StrategiDiffKoleksi[] = [];
  for (const spec of KOLEKSI_DIFF_SPECS) {
    const contentOf = spec.content ?? spec.key;
    const p = new Map(spec.rows(prev).map((r) => [spec.key(r), r] as const));
    const c = new Map(spec.rows(curr).map((r) => [spec.key(r), r] as const));
    const ditambah: string[] = [];
    const dihapus: string[] = [];
    let diubah = 0;
    for (const [k, r] of c) {
      if (!p.has(k)) ditambah.push(spec.describe(r));
      else if (contentOf(r) !== contentOf(p.get(k)!)) diubah++;
    }
    for (const [k, r] of p) if (!c.has(k)) dihapus.push(spec.describe(r));
    if (ditambah.length || dihapus.length || diubah) {
      out.push({ jenis: 'koleksi', fieldId: spec.fieldId, seksi: seksiOf(spec.fieldId), label: spec.label, ditambah, dihapus, diubah });
    }
  }
  return out;
}

/**
 * strategiDiff computes J-4 for a version: the summary of what changed vs the
 * version it revised. Read permission is the same gate as `getStrategi`.
 */
export async function strategiDiff(sql: Queryable, actor: Actor, id: string): Promise<StrategiDiff> {
  const head = await loadStrategiRow(sql, id);
  const ownerAm = await ownerAmOfContract(sql, head.contractId);
  if (!canReadStrategi(actor, ownerAm)) {
    throw new ForbiddenError(MSG_STRATEGI_FORBIDDEN);
  }
  if (head.versiSebelumnyaId === null) {
    return { versiNo: head.versiNo, versiSebelumnyaId: null, versiSebelumnyaNo: null, adaPerbandingan: false, entri: [] };
  }
  const prevHead = await loadStrategiRow(sql, head.versiSebelumnyaId);
  const [curr, prev] = await Promise.all([loadDetail(sql, head), loadDetail(sql, prevHead)]);
  const entri: StrategiDiffEntry[] = [...diffScalars(prev, curr), ...diffKoleksi(prev, curr)];
  return {
    versiNo: head.versiNo,
    versiSebelumnyaId: prevHead.id,
    versiSebelumnyaNo: prevHead.versiNo,
    adaPerbandingan: true,
    entri,
  };
}

/**
 * clientVisibleDiff — the §4.1 / X-16 filter applied to J-4's own rows. Keeps
 * only entries whose field ID a client may see under the Strategi's overlay;
 * hard-internal rows (A-10, H-4, F-5, …) are dropped unconditionally. J-4 is not
 * rendered client-side today (RA-7), so this is the guard that keeps it safe IF
 * it ever is — never a hard-internal change leaks through a shareable diff.
 */
export function clientVisibleDiff(
  diff: StrategiDiff,
  overlay: Readonly<Record<string, visibility.Visibility>> = {},
): StrategiDiff {
  return {
    ...diff,
    entri: diff.entri.filter((e) => visibility.shareableFields([e.fieldId], overlay).length > 0),
  };
}

/**
 * checkCompleteness returns everything blocking submit, rather than the first
 * failure.
 *
 * §5 step 5 asks for "a live count of unmet required fields": a gate that stops
 * at the first problem turns a hundred-field form into a hundred round-trips.
 * The rules checked here are the ones the A-03 tables can answer; the per-field
 * Section A/C requirements arrive with A-05…A-09 and extend this list.
 */
export async function checkCompleteness(sql: Queryable, id: string): Promise<Kekurangan[]> {
  const out: Kekurangan[] = [];
  const head = await loadStrategiRow(sql, id);

  // G-0 / Rule 17 — without it there are no Plan period boundaries to generate.
  if (head.tanggalMulaiSiklus === null) {
    out.push({ kode: 'G-0', pesan: MSG_CYCLE_START_REQUIRED });
  }

  // Section A (A-05). Every field is `W`; the kode names which one so the form
  // can jump to it, and the count is what §5 step 5 puts on the submit button.
  for (const [kode, isi] of [
    ['A-1', head.namaBrand !== null && head.kategoriUtama !== null],
    ['A-2', head.modelBisnis !== null],
    ['A-3', head.marginKotorPersen !== null],
    ['A-4', head.posisiHarga !== null],
    ['A-6', head.kapasitasStok !== null && head.leadTimeRestockHari !== null],
    ['A-7', head.plafonUnitPerBulan !== null],
    ['A-8', head.titikKirimKota !== null],
    ['A-9', head.ekspektasiKlien !== null],
    ['A-10', head.riwayatAgensi !== null],
    ['A-12', head.decisionMaker.length > 0],
    ['A-13', head.slaKlienJam !== null],
  ] as const) {
    if (!isi) out.push({ kode, pesan: MSG_KONTEKS_INCOMPLETE });
  }
  // A-5 has a stated minimum, so it gets its own message rather than the generic
  // "Section A incomplete" — "you filled two of three" is a different problem.
  if (head.usp.length < USP_MIN) {
    out.push({ kode: 'A-5', pesan: MSG_USP_MIN });
  }
  // A-11 / A-14 — `W` list fields whose honest answer may be "none". Since O58
  // (owner decision 2026-08-07, option a) CDPS can SAY "none": each carries an
  // explicit `…TidakAda` flag. So the gate is no longer "is the list empty" but
  // "was the question answered at all" — filled list XOR the flag. That is what
  // makes a submitted Strategi with no `pantangan` distinguishable from one
  // where nobody ever asked.
  for (const [kode, terjawab] of [
    ['A-11', head.pantanganKlien.length > 0 || head.pantanganKlienTidakAda],
    ['A-14', head.asetDariKlien.length > 0 || head.asetDariKlienTidakAda],
  ] as const) {
    if (!terjawab) out.push({ kode, pesan: MSG_TIDAK_ADA_BELUM_DIJAWAB });
  }

  const channels = await sql<
    {
      id: string;
      channel: string;
      status_channel: string;
      periode_baseline_bulan: number | null;
      // E-2 (A-09b) — gated for EVERY channel, `Belum Aktif` included: a channel
      // with no history still has a role in the plan, which is exactly what a
      // launch channel needs declared.
      prioritas: string | null;
      prioritas_alasan: string | null;
      pengunjung_per_bulan: number | null;
      conversion_rate_persen: string | null;
      trafik_organik_persen: string | null;
      sku_listed: number | null;
      sku_aktif: number | null;
      sku_pareto_80: number | null;
      top_sku: unknown;
      sku_slow_moving: number | null;
      listing_layak_persen: string | null;
      rating_toko: string | null;
      jumlah_ulasan: number | null;
      chat_response_rate_persen: string | null;
      chat_response_menit: number | null;
      pesanan_terlambat_persen: string | null;
      poin_penalti: number | null;
      jumlah_kampanye_aktif: number | null;
      affiliate_aktif_30hari: number | null;
      gmv_affiliate: string | null;
      gmv_affiliate_persen: string | null;
      komisi_open_persen: string | null;
      komisi_target_persen: string | null;
      program_sampel: string | null;
      jumlah_video_per_bulan: number | null;
      total_views: string | null;
      gmv_video: string | null;
      jam_live_per_bulan: string | null;
      gmv_live: string | null;
      host_live: string | null;
      studio_live: string | null;
      beban_promo_persen: string | null;
      tipe_kampanye: unknown;
      tipe_kampanye_tidak_ada: boolean;
      voucher_aktif: unknown;
      voucher_aktif_tidak_ada: boolean;
      program_platform: unknown;
      program_platform_tidak_ada: boolean;
      kompetitor: unknown;
      kompetitor_lebih_baik: unknown;
      celah_kompetitor: string | null;
    }[]
  >`select * from strategi_channel where strategi_id = ${id} order by id asc`;
  if (channels.length === 0) {
    out.push({ kode: 'B-0', pesan: MSG_NO_CHANNEL });
  }

  // Rule 5: an `Eksisting` channel must carry one baseline row per declared
  // month — a half-filled window is the shape Rule 5 exists to forbid.
  for (const c of channels) {
    if (c.status_channel !== 'Eksisting') continue;
    const want = c.periode_baseline_bulan ?? 0;
    const got = await sql<{ n: number }[]>`
      select count(*)::int as n from strategi_baseline_bulan where channel_id = ${c.id}`;
    if (got[0].n !== want || want === 0) {
      out.push({ kode: `B-1/${c.channel}`, pesan: MSG_BASELINE_INCOMPLETE });
    }
    out.push(...kekuranganSectionB(c));
  }

  // A-15: the checklist is per channel, and §5 step 3 makes its blockers the
  // first thing the SPV dashboard shows — a channel with no row has not been
  // asked the question at all. `Umum` rows do not substitute for a channel's own.
  const aksesRows = await sql<{ channel: string }[]>`
    select distinct channel from strategi_akses where strategi_id = ${id}`;
  const adaAkses = new Set(aksesRows.map((a) => a.channel));
  for (const c of channels) {
    if (!adaAkses.has(c.channel)) {
      out.push({ kode: `A-15/${c.channel}`, pesan: MSG_AKSES_MATRIX_REQUIRED });
    }
  }

  // Both D-2 and D-4 are read off this one query — D-2 is the `gmv` rows, D-4 is
  // everything else. Two queries would let the two gates disagree about what is
  // stored the moment one of them grows a filter the other does not.
  const allTargets = await sql<{ channel: string; month_index: number; metric: string }[]>`
    select channel, month_index, metric from strategi_target where strategi_id = ${id}`;
  const targets = allTargets.filter((t) => t.metric === 'gmv');
  for (const c of channels) {
    if (!targets.some((t) => t.channel === c.channel)) {
      out.push({ kode: `D-2/${c.channel}`, pesan: MSG_TARGET_MISSING });
    }
  }

  // D-4 (X-15, owner decision 2026-08-09) — MINIMAL ONE supporting-metric target
  // per channel, deliberately not the full matrix.
  //
  // §4 marks D-4 `W`, but until this decision nothing checked it, so a Strategi
  // could be submitted AND approved with no supporting metric at all — and then
  // "GMV missed by 30%" had nothing to be tested against, which is the exact
  // failure M6A exists to prevent (§2 problem (c): the post-mortem becomes
  // opinion).
  //
  // Why one and not the matrix: nine metrics × n months × n channels is 108
  // boxes on a six-month two-channel contract, and a required field that costs
  // 108 boxes is filled by copying one number down a column — the vanity-metric
  // shape §9 guards against. The PRD argues the same way about the SAME
  // vocabulary one field earlier: D-6 caps leading indicators at five because
  // "kalau semuanya dipantau, tidak ada yang dipantau".
  //
  // Per CHANNEL, not per Strategi: a second channel with no supporting metric is
  // a channel nobody stated a hypothesis about, and the kode carries the channel
  // so the form can point at it.
  for (const c of channels) {
    if (!allTargets.some((t) => t.channel === c.channel && t.metric !== 'gmv')) {
      out.push({ kode: `D-4/${c.channel}`, pesan: MSG_TARGET_PENDUKUNG_MISSING });
    }
  }

  // D-5 (A-08): all three horizons, `W`. One message for the group rather than
  // three near-identical ones — "definisi berhasil belum lengkap" is the same
  // problem whichever horizon is blank, and the form jumps to D-5 either way.
  if (
    head.definisiBerhasil30 === null ||
    head.definisiBerhasil60 === null ||
    head.definisiBerhasil90 === null
  ) {
    out.push({ kode: 'D-5', pesan: MSG_DEFINISI_BERHASIL_REQUIRED });
  }

  // D-6 (A-08): `W`, so at least one. The cap is enforced at save time and by
  // CHECK, which is why only the floor is checked here — a row over the cap
  // cannot exist to be reported.
  if (head.leadingIndicator.length === 0) {
    out.push({ kode: 'D-6', pesan: MSG_LEADING_INDICATOR_REQUIRED });
  }

  // D-7 is `O` (optional) and deliberately NOT gated: Rule 19 makes a challenge
  // advisory, and requiring one would turn "the floor looks unachievable" from
  // evidence into paperwork every AM fills to pass validation.

  const assumptions = await sql<{ kode: string; target_terkait: unknown }[]>`
    select kode, target_terkait from strategi_assumption where strategi_id = ${id}`;
  if (assumptions.length < 3) {
    out.push({ kode: 'D-8', pesan: MSG_ASSUMPTION_MIN });
  }

  // Rule 8: "Every target carries an assumption." Checked against GMV targets,
  // which are the monthly stretch figures D-2 produces.
  const covered = new Set(assumptions.flatMap((a) => strArray(a.target_terkait)));
  const uncovered = targets.filter((t) => !covered.has(targetKey('gmv', t.channel, t.month_index)));
  if (uncovered.length > 0) {
    out.push({ kode: 'Rule 8', pesan: MSG_TARGET_WITHOUT_ASSUMPTION });
  }

  // Section E/H narrative (A-09a). Three of the four are `W`; H-4 is `O` and is
  // deliberately absent — see `saveNarasi`.
  if (head.growthThesis === null) {
    out.push({ kode: 'E-1', pesan: MSG_GROWTH_THESIS_REQUIRED });
  }
  if (head.urutanEksekusiAlasan === null) {
    out.push({ kode: 'E-13', pesan: MSG_URUTAN_EKSEKUSI_REQUIRED });
  }
  if (head.skenarioMundur === null) {
    out.push({ kode: 'H-3', pesan: MSG_SKENARIO_MUNDUR_REQUIRED });
  }

  // Rule 9 / E-11: the anti-scope-creep record. Empty is a validation error, by
  // design — it is the answer the AM needs three months later.
  const outOfScope = await sql<{ n: number }[]>`
    select count(*)::int as n from strategi_pillar
     where strategi_id = ${id} and jenis = 'tidak_dikerjakan'`;
  if (outOfScope[0].n === 0) {
    out.push({ kode: 'E-11', pesan: MSG_OUT_OF_SCOPE_REQUIRED });
  }

  const risks = await sql<{ n: number }[]>`
    select count(*)::int as n from strategi_risk where strategi_id = ${id}`;
  if (risks[0].n < 3) {
    out.push({ kode: 'H-1', pesan: MSG_RISK_MIN });
  }

  // -----------------------------------------------------------------------
  // Section C (A-07)
  // -----------------------------------------------------------------------
  // C-1..C-4: every contracted channel must have a diagnosa row, and each
  // diagnosa must have an akar_masalah (C-3) and gap_kompetitor (C-4) filled.
  // The Rule 6 field-ID check happens at save time (saveDiagnosa), not here —
  // an invalid field-ID cannot be stored, so if a diagnosa row exists its
  // field_ids are already valid.
  const diagnosaRows = await sql<
    { channel: string; akar_masalah: string | null; gap_kompetitor: string | null }[]
  >`select channel, akar_masalah, gap_kompetitor from strategi_diagnosa
     where strategi_id = ${id}`;
  const adaDiagnosa = new Map(diagnosaRows.map((d) => [d.channel, d]));

  for (const c of channels) {
    const d = adaDiagnosa.get(c.channel);
    if (!d) {
      out.push({ kode: `C-1/${c.channel}`, pesan: MSG_DIAGNOSA_MISSING });
    } else {
      if (!d.akar_masalah || d.akar_masalah.trim() === '') {
        out.push({ kode: `C-3/${c.channel}`, pesan: MSG_KONTEKS_INCOMPLETE });
      }
      if (!d.gap_kompetitor || d.gap_kompetitor.trim() === '') {
        out.push({ kode: `C-4/${c.channel}`, pesan: MSG_KONTEKS_INCOMPLETE });
      }
    }
  }

  // C-5: at least QUICK_WIN_MIN quick wins (PRD says "W (min 3)").
  const qwCount = await sql<{ n: number }[]>`
    select count(*)::int as n from strategi_quick_win where strategi_id = ${id}`;
  if (qwCount[0].n < QUICK_WIN_MIN) {
    out.push({ kode: 'C-5', pesan: MSG_QUICK_WIN_MIN });
  }

  // C-6: at least one structural risk (W).
  const riskStrCount = await sql<{ n: number }[]>`
    select count(*)::int as n from strategi_risiko_struktural where strategi_id = ${id}`;
  if (riskStrCount[0].n === 0) {
    out.push({ kode: 'C-6', pesan: MSG_RISIKO_STRUKTURAL_REQUIRED });
  }

  // C-7: at least one client prerequisite (W).
  const preqCount = await sql<{ n: number }[]>`
    select count(*)::int as n from strategi_prasyarat_klien where strategi_id = ${id}`;
  if (preqCount[0].n === 0) {
    out.push({ kode: 'C-7', pesan: MSG_PRASYARAT_KLIEN_REQUIRED });
  }

  // -----------------------------------------------------------------------
  // Section E-2/E-12, G, H-2, I (A-09b)
  // -----------------------------------------------------------------------

  // E-2 is per channel, and BOTH halves are gated: §4 asks for the role "+
  // alasan", so a channel marked `maintenance` with no reason has answered half
  // the question. Reported per channel so the form can jump to the block.
  for (const c of channels) {
    if (c.prioritas === null || c.prioritas_alasan === null) {
      out.push({ kode: `E-2/${c.channel}`, pesan: MSG_PRIORITAS_CHANNEL_REQUIRED });
    }
  }

  const ketergantunganCount = await sql<{ n: number }[]>`
    select count(*)::int as n from strategi_ketergantungan_klien where strategi_id = ${id}`;
  if (ketergantunganCount[0].n === 0) {
    out.push({ kode: 'E-12', pesan: MSG_KETERGANTUNGAN_REQUIRED });
  }

  // G-1: §4 writes "min 2" explicitly, so this has its own message rather than
  // the generic one — "you entered one of two" is a different problem from
  // "you entered none".
  const faseCount = await sql<{ n: number }[]>`
    select count(*)::int as n from strategi_fase where strategi_id = ${id}`;
  if (faseCount[0].n < FASE_MIN) {
    out.push({ kode: 'G-1', pesan: MSG_FASE_MIN });
  }

  const tanggalBesarCount = await sql<{ n: number }[]>`
    select count(*)::int as n from strategi_tanggal_besar where strategi_id = ${id}`;
  if (tanggalBesarCount[0].n === 0) {
    out.push({ kode: 'G-2', pesan: MSG_TANGGAL_BESAR_REQUIRED });
  }

  // G-3: one message for the group of three. Whichever part is blank, the form
  // jumps to G-3 and the AM is looking at the same three inputs.
  if (
    head.reviewKlienFrekuensi === null ||
    head.reviewKlienFormat === null ||
    head.reviewKlienPic === null
  ) {
    out.push({ kode: 'G-3', pesan: MSG_REVIEW_KLIEN_REQUIRED });
  }
  if (head.reviewInternalFrekuensi === null) {
    out.push({ kode: 'G-4', pesan: MSG_REVIEW_INTERNAL_REQUIRED });
  }

  // H-2 (W). This is also what makes the J-3 subset check in `openRevision`
  // reachable: Rule 13 can only demand a trigger "from H-2" if H-2 is
  // guaranteed non-empty on every approved version.
  const triggerCount = await sql<{ n: number }[]>`
    select count(*)::int as n from strategi_trigger_revisi where strategi_id = ${id}`;
  if (triggerCount[0].n === 0) {
    out.push({ kode: 'H-2', pesan: MSG_TRIGGER_REVISI_REQUIRED });
  }
  // H-4 is `O` and deliberately not gated (A-09a).

  const dispatchCount = await sql<{ n: number }[]>`
    select count(*)::int as n from strategi_dispatch where strategi_id = ${id}`;
  if (dispatchCount[0].n === 0) {
    out.push({ kode: 'I-2', pesan: MSG_DISPATCH_REQUIRED });
  }
  if (head.metrikLaporanKlien.length === 0) {
    out.push({ kode: 'I-3', pesan: MSG_METRIK_LAPORAN_REQUIRED });
  }
  // I-4 is `O`. I-1 and J-4 are derived and can never be "missing".

  return out;
}

/**
 * Section B (A-06) completeness for ONE `Eksisting` channel — Rule 5, per group.
 *
 * Rule 5 draws its line at "blank is not allowed, `0` is", which is why every
 * test below is `!== null` and never truthiness: a store with zero live hours,
 * zero affiliates or zero penalty points has ANSWERED, and a check that treated
 * `0` as missing would refuse the honest answer and reward a guess.
 *
 * `Belum Aktif` channels never reach here (Rule 4 skips the historical baseline).
 *
 * Which `W` list fields are gated is a decision, not an oversight: only those
 * whose emptiness would leave a downstream rule with nothing to read — B-3.3
 * (E-3 picks hero SKUs from it) and B-9.1/B-9.2 (C-4 compares against them).
 * B-5.3 campaign types and B-8.1/B-8.2 vouchers & programmes are NOT gated: a
 * channel legitimately runs no campaigns and joins no programme, and the number
 * beside them (`jumlah_kampanye_aktif`, `beban_promo_persen`) is what proves the
 * question was answered. See DECISIONS O58.
 */
function kekuranganSectionB(c: {
  channel: string;
  pengunjung_per_bulan: number | null;
  conversion_rate_persen: string | null;
  trafik_organik_persen: string | null;
  sku_listed: number | null;
  sku_aktif: number | null;
  sku_pareto_80: number | null;
  top_sku: unknown;
  sku_slow_moving: number | null;
  listing_layak_persen: string | null;
  rating_toko: string | null;
  jumlah_ulasan: number | null;
  chat_response_rate_persen: string | null;
  chat_response_menit: number | null;
  pesanan_terlambat_persen: string | null;
  poin_penalti: number | null;
  jumlah_kampanye_aktif: number | null;
  affiliate_aktif_30hari: number | null;
  gmv_affiliate: string | null;
  gmv_affiliate_persen: string | null;
  komisi_open_persen: string | null;
  komisi_target_persen: string | null;
  program_sampel: string | null;
  jumlah_video_per_bulan: number | null;
  total_views: string | null;
  gmv_video: string | null;
  jam_live_per_bulan: string | null;
  gmv_live: string | null;
  host_live: string | null;
  studio_live: string | null;
  beban_promo_persen: string | null;
  tipe_kampanye: unknown;
  tipe_kampanye_tidak_ada: boolean;
  voucher_aktif: unknown;
  voucher_aktif_tidak_ada: boolean;
  program_platform: unknown;
  program_platform_tidak_ada: boolean;
  kompetitor: unknown;
  kompetitor_lebih_baik: unknown;
  celah_kompetitor: string | null;
}): Kekurangan[] {
  const out: Kekurangan[] = [];
  const ada = (...vals: (number | string | null)[]): boolean => vals.every((v) => v !== null);
  const grup = (kode: string, lengkap: boolean): void => {
    if (!lengkap) out.push({ kode: `${kode}/${c.channel}`, pesan: MSG_BASELINE_GROUP_INCOMPLETE });
  };

  // B-2.3: one column stands for all six — `ck_strch_trafik_total` already makes
  // "five of six" unstorable, so the presence of one proves the presence of all.
  grup('B-2', ada(c.pengunjung_per_bulan, c.conversion_rate_persen, c.trafik_organik_persen));
  grup(
    'B-3',
    ada(c.sku_listed, c.sku_aktif, c.sku_pareto_80, c.sku_slow_moving, c.listing_layak_persen),
  );
  grup(
    'B-4',
    ada(
      c.rating_toko,
      c.jumlah_ulasan,
      c.chat_response_rate_persen,
      c.chat_response_menit,
      c.pesanan_terlambat_persen,
      c.poin_penalti,
    ),
  );
  // B-5 / B-8 keep gating the companion NUMBER: a valid `0` proves the question
  // was reached, and that is a different proof path from the checkbox. O58 adds
  // the list side rather than replacing it — both are cheap, and either one
  // alone leaves a hole.
  grup('B-5', ada(c.jumlah_kampanye_aktif));
  grup(
    'B-6',
    ada(
      c.affiliate_aktif_30hari,
      c.gmv_affiliate,
      c.gmv_affiliate_persen,
      c.komisi_open_persen,
      c.komisi_target_persen,
      c.program_sampel,
    ),
  );
  grup(
    'B-7',
    ada(
      c.jumlah_video_per_bulan,
      c.total_views,
      c.gmv_video,
      c.jam_live_per_bulan,
      c.gmv_live,
      c.host_live,
      c.studio_live,
    ),
  );
  grup('B-8', ada(c.beban_promo_persen));
  grup('B-9', ada(c.celah_kompetitor) && strArray(c.kompetitor_lebih_baik).length > 0);

  // O58 — filled list XOR "tidak ada". Each gets its own code so the AM is sent
  // to the one question that is actually unanswered, not to a whole group.
  for (const [kode, terjawab] of [
    ['B-5.3', strArray(c.tipe_kampanye).length > 0 || c.tipe_kampanye_tidak_ada],
    ['B-8.1', objArray(c.voucher_aktif).length > 0 || c.voucher_aktif_tidak_ada],
    ['B-8.2', strArray(c.program_platform).length > 0 || c.program_platform_tidak_ada],
  ] as const) {
    if (!terjawab) {
      out.push({ kode: `${kode}/${c.channel}`, pesan: MSG_TIDAK_ADA_BELUM_DIJAWAB });
    }
  }

  if (objArray(c.top_sku).length === 0) {
    out.push({ kode: `B-3.3/${c.channel}`, pesan: MSG_TOP_SKU_REQUIRED });
  }
  if (objArray(c.kompetitor).length === 0) {
    out.push({ kode: `B-9.1/${c.channel}`, pesan: MSG_KOMPETITOR_REQUIRED });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Lifecycle (machine #15)
// ---------------------------------------------------------------------------

/**
 * submitStrategi drives `Draft`/`Draft Revisi` → `Diajukan` (§5 step 6).
 *
 * The completeness gate runs INSIDE the transaction, before the transition, so a
 * Strategi cannot reach a reviewer half-filled — and so a concurrent edit cannot
 * slip in between the check and the move.
 */
export async function submitStrategi(sql: Sql, actor: Actor, id: string): Promise<Strategi> {
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const head = await requireDraftAndWriter(tx, actor, id);
    const missing = await checkCompleteness(tx, id);
    if (missing.length > 0) {
      throw new ValidationError(missing[0].pesan);
    }
    const res = await statemachine.transition(ex.sm, {
      machine: MACHINE_STRATEGI,
      entityType: ENTITY_STRATEGI,
      table: 'strategi',
      entityId: id,
      to: STRATEGI_DIAJUKAN,
      actor,
    });
    if (!res.ok) throw transitionError(res);
    await tx`update strategi set diajukan_pada = now() where id = ${id}`;
    await appendEvent(tx, id, head.versiNo, 'diajukan', actor.employeeId, null);
    return loadStrategiRow(tx, id);
  });
}

/**
 * approveStrategi drives `Diajukan` → `Aktif` (Rule 12) and archives the
 * predecessor version in the SAME transaction (Rule 13).
 *
 * The ordering matters: the predecessor is archived only after the new version
 * has actually moved, so a rejected transition never leaves a contract with no
 * active Strategi. `uq_strategi_aktif_per_service` would refuse the pair anyway
 * — the archive step is what makes the sequence legal, not an afterthought.
 *
 * NOTE: this does not touch the parent Service status. See the module header —
 * the Brief gate still reads the old M6 §4 entity until the form swap.
 */
export async function approveStrategi(sql: Sql, actor: Actor, id: string): Promise<Strategi> {
  if (!canApproveStrategi(actor)) {
    throw new ForbiddenError(MSG_APPROVE_FORBIDDEN);
  }
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const head = await loadStrategiRow(tx, id, true);

    // Rule 13: archive the predecessor FIRST when there is one, because the
    // partial unique index allows exactly one `Aktif` row per service and the
    // new version is about to claim it.
    if (head.versiSebelumnyaId !== null) {
      const prev = await loadStrategiRow(tx, head.versiSebelumnyaId, true);
      if (prev.status === STRATEGI_AKTIF) {
        const pres = await statemachine.transition(ex.sm, {
          machine: MACHINE_STRATEGI,
          entityType: ENTITY_STRATEGI,
          table: 'strategi',
          entityId: prev.id,
          to: STRATEGI_DIARSIPKAN,
          actor,
        });
        if (!pres.ok) throw transitionError(pres);
        await appendEvent(tx, prev.id, prev.versiNo, 'diarsipkan', actor.employeeId, null);
      }
    }

    const res = await statemachine.transition(ex.sm, {
      machine: MACHINE_STRATEGI,
      entityType: ENTITY_STRATEGI,
      table: 'strategi',
      entityId: id,
      to: STRATEGI_AKTIF,
      actor,
    });
    if (!res.ok) throw transitionError(res);

    await tx`
      update strategi
         set disetujui_pada = now(), disetujui_oleh = ${actor.employeeId}, catatan_reviewer = null
       where id = ${id}`;
    // O57 item (b) — Rule 7 read as "read-only AFTER Head approval". This is the
    // moment the floor stops being the AM's typed number and becomes the
    // agreement's; from here `trg_strategi_target_guard_floor` refuses to let it
    // move, service role included.
    await tx`
      update strategi_target
         set sumber_floor = ${FLOOR_DISETUJUI_HEAD},
             floor_disetujui_oleh = ${actor.employeeId},
             floor_disetujui_pada = now()
       where strategi_id = ${id} and nilai_floor is not null
         and sumber_floor = ${FLOOR_INPUT_AM}`;
    await appendEvent(tx, id, head.versiNo, 'disetujui', actor.employeeId, null);

    // M6B Rule 1: approval is the ONLY thing that generates Plan periods. Runs in
    // this transaction, so a failed generation rolls the approval back with it.
    // Idempotent by contract, so approving a revision does not mint a second
    // chain — regenerating a revision's `Terjadwal` periods (Rule 17) is a later
    // ticket. `head` already carries the contract window (joined, O57).
    await generatePlanPeriods(tx, actor, {
      id,
      contractId: head.contractId,
      clientId: head.clientId,
      tanggalMulaiSiklus: head.tanggalMulaiSiklus,
      durasiKontrakBulan: head.durasiKontrakBulan,
    });

    return loadStrategiRow(tx, id);
  });
}

/**
 * returnStrategi sends a submitted Strategi back with notes (Rule 12).
 *
 * Version 1 returns to `Draft`; a revision returns to `Draft Revisi`, because
 * Rule 12 says a returned Strategi "keeps its version number" — and landing a
 * revision in `Draft` would make it look like a first draft in every list.
 */
export async function returnStrategi(
  sql: Sql,
  actor: Actor,
  id: string,
  catatan: string,
): Promise<Strategi> {
  const note = (catatan ?? '').trim();
  if (note === '') {
    throw new ValidationError(MSG_REVIEW_NOTES_REQUIRED);
  }
  if (!canApproveStrategi(actor)) {
    throw new ForbiddenError(MSG_APPROVE_FORBIDDEN);
  }
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const head = await loadStrategiRow(tx, id, true);
    const to = head.versiNo === 1 ? STRATEGI_DRAFT : STRATEGI_DRAFT_REVISI;
    const res = await statemachine.transition(ex.sm, {
      machine: MACHINE_STRATEGI,
      entityType: ENTITY_STRATEGI,
      table: 'strategi',
      entityId: id,
      to,
      actor,
    });
    if (!res.ok) throw transitionError(res);
    await tx`update strategi set catatan_reviewer = ${note} where id = ${id}`;
    await appendEvent(tx, id, head.versiNo, 'dikembalikan', actor.employeeId, note);
    return loadStrategiRow(tx, id);
  });
}

/** Rule 13 (a)(b)(c) — what opening a revision must declare. */
export interface RevisionInput {
  /** (a) a trigger from the H-2 list the AM selected for this client. */
  triggerRevisi: string[];
  /** (b) free text. */
  alasanRevisi: string;
  /** (c) which D-8 assumption codes broke. */
  asumsiGugur: string[];
}

/**
 * openRevision creates version n+1 in `Draft Revisi`, copying the active
 * version's content (Rule 13).
 *
 * Version n is NOT touched here — it keeps running as `Aktif` until n+1 is
 * approved. That is the whole point of Rule 13: a contract is never left without
 * an authoritative strategy in the middle of a revision.
 */
export async function openRevision(
  sql: Sql,
  actor: Actor,
  id: string,
  input: RevisionInput,
): Promise<Strategi> {
  const alasan = (input.alasanRevisi ?? '').trim();
  const triggers = (input.triggerRevisi ?? []).map((t) => t.trim()).filter(Boolean);
  const gugur = (input.asumsiGugur ?? []).map((a) => a.trim()).filter(Boolean);
  if (triggers.length === 0 || alasan === '' || gugur.length === 0) {
    throw new ValidationError(MSG_REVISION_INCOMPLETE);
  }
  const now = new Date();

  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const head = await loadStrategiRow(tx, id, true);
    const ownerAm = await ownerAmOfContract(tx, head.contractId);
    if (!canWriteStrategi(actor, ownerAm)) {
      throw new ForbiddenError(MSG_NOT_OWNER_AM);
    }
    if (head.status !== STRATEGI_AKTIF) {
      throw new ConflictError(MSG_REVISION_NOT_ACTIVE);
    }
    const inflight = await tx<{ id: string }[]>`
      select id from strategi
       where contract_id = ${head.contractId}
         and status in (${STRATEGI_DRAFT}, ${STRATEGI_DIAJUKAN}, ${STRATEGI_DRAFT_REVISI})`;
    if (inflight.length > 0) {
      throw new ConflictError(MSG_STRATEGI_EXISTS);
    }

    // Rule 13 + §4 J-3 "trigger yang terpicu (DARI H-2)". `ck_strver_trigger_set`
    // already refuses anything outside the global vocabulary; what it cannot do
    // is refuse a trigger this Strategi never declared, because that is a
    // cross-row comparison and a CHECK may not carry a subquery.
    //
    // Reachable at all only because H-2 is a submit requirement: an approved
    // version always has at least one declared trigger, so this can never be an
    // empty set that blocks every revision. Read off the version BEING revised —
    // the new version inherits the same rows via `copyChildren`, but it does not
    // exist yet.
    const declared = await tx<{ kode: string }[]>`
      select kode from strategi_trigger_revisi where strategi_id = ${head.id}`;
    const declaredSet = new Set(declared.map((d) => d.kode));
    for (const t of triggers) {
      if (!declaredSet.has(t)) {
        throw new ValidationError(MSG_TRIGGER_NOT_DECLARED);
      }
    }

    const newId = await ident.nextId(ex.ident, 'STRG', now);
    const induk = head.strategiIndukId ?? head.id;
    // INSERT … SELECT from the version being revised, overriding only what a new
    // version changes. Section A (A-05) lives on this row, so a VALUES list would
    // have to re-marshal all twenty of its columns — and the day one is added and
    // not appended there, every revision would silently start with a blank
    // Section A while every test on version 1 still passed.
    //
    // A-08 was that day, and it did NOT stay silent: the D-5/D-6 columns landed
    // as submit requirements, so a revision that dropped them failed the gate
    // instead of shipping half-empty. Carried forward here for the same reason
    // Section A is — the AM is revising a strategy, not retyping it.
    //
    // D-7 is deliberately NOT carried. A Sanggahan Target is an ACT, with an
    // actor and a timestamp, aimed at one version's floor; copying it would show
    // the new version as challenged by someone who never challenged it. Version
    // n keeps its own challenge, immutable and still readable.
    await tx`
      insert into strategi
        (id, contract_id, client_id, versi_no, strategi_induk_id, versi_sebelumnya_id, status,
         tanggal_mulai_siklus, siklus_terkunci, toleransi_over_persen, created_by,
         nama_brand, kategori_utama, sub_kategori, model_bisnis, margin_kotor_persen,
         posisi_harga, usp, kapasitas_stok, lead_time_restock_hari, plafon_unit_per_bulan,
         titik_kirim_kota, titik_kirim_detail, ekspektasi_klien, riwayat_agensi,
         pantangan_klien, pantangan_klien_tidak_ada, decision_maker, sla_klien_jam,
         sla_klien_catatan, aset_dari_klien, aset_dari_klien_tidak_ada, aset_catatan,
         definisi_berhasil_30, definisi_berhasil_60, definisi_berhasil_90, leading_indicator,
         growth_thesis, urutan_eksekusi_alasan, skenario_mundur, kondisi_stop_scope,
         review_klien_frekuensi, review_klien_format, review_klien_pic,
         review_internal_frekuensi, metrik_laporan_klien)
      select ${newId}, contract_id, client_id, versi_no + 1, ${induk}, id,
             ${STRATEGI_DRAFT_REVISI}, tanggal_mulai_siklus, siklus_terkunci,
             toleransi_over_persen, ${actor.employeeId},
             nama_brand, kategori_utama, sub_kategori, model_bisnis, margin_kotor_persen,
             posisi_harga, usp, kapasitas_stok, lead_time_restock_hari, plafon_unit_per_bulan,
             titik_kirim_kota, titik_kirim_detail, ekspektasi_klien, riwayat_agensi,
             pantangan_klien, pantangan_klien_tidak_ada, decision_maker, sla_klien_jam,
             sla_klien_catatan, aset_dari_klien, aset_dari_klien_tidak_ada, aset_catatan,
             definisi_berhasil_30, definisi_berhasil_60, definisi_berhasil_90, leading_indicator,
             growth_thesis, urutan_eksekusi_alasan, skenario_mundur, kondisi_stop_scope,
             review_klien_frekuensi, review_klien_format, review_klien_pic,
             review_internal_frekuensi, metrik_laporan_klien
        from strategi where id = ${head.id}`;

    await copyChildren(tx, head.id, newId, actor.employeeId);

    // The J-3 declaration belongs to the NEW version: it is the reason that
    // version exists, and the §9 metric counts revisions, not archives.
    await appendEvent(tx, newId, head.versiNo + 1, 'revisi_dibuka', actor.employeeId, null, {
      triggerRevisi: triggers,
      alasanRevisi: alasan,
      asumsiGugur: gugur,
    });
    await ex.audit.insertAudit({
      entityType: ENTITY_STRATEGI,
      entityId: newId,
      actorEmployeeId: actor.employeeId,
      action: 'open_revision',
      beforeJson: { versi_sebelumnya: head.id, versi_no: head.versiNo },
      afterJson: {
        versi_no: head.versiNo + 1,
        trigger_revisi: triggers,
        alasan_revisi: alasan,
        asumsi_gugur: gugur,
      },
      createdBy: actor.employeeId,
    });

    return loadStrategiRow(tx, newId);
  });
}

/**
 * expireStrategi closes an active Strategi at contract end (Rule 14).
 *
 * Not scheduled here: the daily job that drives this belongs with M6B's
 * scheduled jobs (backlog B-09), which is where the WIB clock already lives.
 * This is the transition itself, callable by the job or by an AM/SPV.
 */
export async function expireStrategi(sql: Sql, actor: Actor, id: string): Promise<Strategi> {
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const head = await loadStrategiRow(tx, id, true);
    const ownerAm = await ownerAmOfContract(tx, head.contractId);
    if (!canWriteStrategi(actor, ownerAm) && !canApproveStrategi(actor)) {
      throw new ForbiddenError(MSG_NOT_OWNER_AM);
    }
    const res = await statemachine.transition(ex.sm, {
      machine: MACHINE_STRATEGI,
      entityType: ENTITY_STRATEGI,
      table: 'strategi',
      entityId: id,
      to: STRATEGI_KEDALUWARSA,
      actor,
    });
    if (!res.ok) throw transitionError(res);
    await appendEvent(tx, id, head.versiNo, 'kedaluwarsa', actor.employeeId, null);
    return loadStrategiRow(tx, id);
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * requireDraftAndWriter is the single gate every content write passes through:
 * the row is locked, the actor must be the owning AM (or a Director), and the
 * status must be one of the two editable ones (§7 permissions).
 */
async function requireDraftAndWriter(
  tx: TransactionSql,
  actor: Actor,
  id: string,
): Promise<Strategi> {
  const head = await loadStrategiRow(tx, id, true);
  const ownerAm = await ownerAmOfContract(tx, head.contractId);
  if (!canWriteStrategi(actor, ownerAm)) {
    throw new ForbiddenError(MSG_NOT_OWNER_AM);
  }
  if (head.status !== STRATEGI_DRAFT && head.status !== STRATEGI_DRAFT_REVISI) {
    throw new ConflictError(MSG_NOT_DRAFT);
  }
  return head;
}

/** appendEvent writes one immutable Section-J row. */
async function appendEvent(
  tx: TransactionSql,
  strategiId: string,
  versiNo: number,
  peristiwa: string,
  aktor: string,
  catatan: string | null,
  revisi?: RevisionInput,
): Promise<void> {
  await tx`
    insert into strategi_version
      (strategi_id, versi_no, peristiwa, aktor, catatan, trigger_revisi, alasan_revisi,
       asumsi_gugur, created_by)
    values
      (${strategiId}, ${versiNo}, ${peristiwa}, ${aktor}, ${catatan},
       ${(revisi?.triggerRevisi ?? []) as never},
       ${revisi?.alasanRevisi ?? null},
       ${(revisi?.asumsiGugur ?? []) as never},
       ${aktor})`;
}

/**
 * copyChildren clones an approved version's content into a fresh revision.
 *
 * Baseline months come along with their channel: a revision revisits the
 * strategy, not the history, and Rule 5a locks the baseline window at approval
 * precisely so later performance is compared against the same yardstick. (A
 * RENEWAL is the opposite case — Rule 14 clears the baseline and re-requires it
 * — and that path is not this function.)
 */
async function copyChildren(
  tx: TransactionSql,
  fromId: string,
  toId: string,
  actorId: string,
): Promise<void> {
  const channels = await tx<{ id: string }[]>`
    insert into strategi_channel
      (strategi_id, channel, channel_lain, status_channel, nama_toko, url_toko,
       umur_toko_bulan, badge, target_tanggal_live, prasyarat_pembukaan, sumber_data,
       tanggal_ambil_data, lampiran, periode_baseline_bulan, periode_mulai, periode_akhir,
       alasan_periode_pendek, catatan_periode_pendek, prioritas, prioritas_alasan,
       pengunjung_per_bulan, conversion_rate_persen, trafik_organik_persen,
       trafik_iklan_persen, trafik_affiliate_persen, trafik_live_persen,
       trafik_video_persen, trafik_luar_persen, entry_point_utama, entry_point_catatan,
       sku_listed, sku_aktif, sku_pareto_80, top_sku, sku_slow_moving, sku_stok_kritis,
       listing_layak_persen, rating_toko, jumlah_ulasan, chat_response_rate_persen,
       chat_response_menit, pesanan_terlambat_persen, poin_penalti, catatan_penalti,
       tema_keluhan, tipe_kampanye, tipe_kampanye_tidak_ada,
       jumlah_kampanye_aktif, top_keyword, kampanye_boncos,
       affiliate_aktif_30hari, gmv_affiliate, gmv_affiliate_persen, komisi_open_persen,
       komisi_target_persen, top_kreator, program_sampel, program_sampel_catatan,
       jumlah_video_per_bulan, total_views, gmv_video, jam_live_per_bulan, gmv_live,
       host_live, studio_live, studio_catatan,
       voucher_aktif, voucher_aktif_tidak_ada,
       program_platform, program_platform_tidak_ada,
       beban_promo_persen, kompetitor, kompetitor_lebih_baik, kompetitor_catatan,
       celah_kompetitor, created_by)
    select ${toId}, channel, channel_lain, status_channel, nama_toko, url_toko,
           umur_toko_bulan, badge, target_tanggal_live, prasyarat_pembukaan, sumber_data,
           tanggal_ambil_data, lampiran, periode_baseline_bulan, periode_mulai, periode_akhir,
           alasan_periode_pendek, catatan_periode_pendek, prioritas, prioritas_alasan,
           pengunjung_per_bulan, conversion_rate_persen, trafik_organik_persen,
           trafik_iklan_persen, trafik_affiliate_persen, trafik_live_persen,
           trafik_video_persen, trafik_luar_persen, entry_point_utama, entry_point_catatan,
           sku_listed, sku_aktif, sku_pareto_80, top_sku, sku_slow_moving, sku_stok_kritis,
           listing_layak_persen, rating_toko, jumlah_ulasan, chat_response_rate_persen,
           chat_response_menit, pesanan_terlambat_persen, poin_penalti, catatan_penalti,
           tema_keluhan, tipe_kampanye, tipe_kampanye_tidak_ada,
           jumlah_kampanye_aktif, top_keyword, kampanye_boncos,
           affiliate_aktif_30hari, gmv_affiliate, gmv_affiliate_persen, komisi_open_persen,
           komisi_target_persen, top_kreator, program_sampel, program_sampel_catatan,
           jumlah_video_per_bulan, total_views, gmv_video, jam_live_per_bulan, gmv_live,
           host_live, studio_live, studio_catatan,
           voucher_aktif, voucher_aktif_tidak_ada,
           program_platform, program_platform_tidak_ada,
           beban_promo_persen, kompetitor, kompetitor_lebih_baik, kompetitor_catatan,
           celah_kompetitor, ${actorId}
      from strategi_channel where strategi_id = ${fromId} order by id asc
    returning id`;

  // A-15/A-16 travel with the revision: access already granted does not have to
  // be requested again, and an unresolved blocker is exactly the thing that must
  // NOT disappear because a new version was opened.
  await tx`
    insert into strategi_akses
      (strategi_id, channel, akses, status, memblokir, target_tanggal_beres, catatan, created_by)
    select ${toId}, channel, akses, status, memblokir, target_tanggal_beres, catatan, ${actorId}
      from strategi_akses where strategi_id = ${fromId}`;

  const oldChannels = await tx<{ id: string }[]>`
    select id from strategi_channel where strategi_id = ${fromId} order by id asc`;
  // The two lists are ordered identically (both by id asc, and the insert above
  // preserves the SELECT order), so position i pairs old→new.
  for (let i = 0; i < oldChannels.length; i += 1) {
    await tx`
      insert into strategi_baseline_bulan
        (channel_id, month_index, gmv, jumlah_pesanan, persen_batal, ad_spend, roas, acos, created_by)
      select ${channels[i].id}, month_index, gmv, jumlah_pesanan, persen_batal, ad_spend, roas, acos, ${actorId}
        from strategi_baseline_bulan where channel_id = ${oldChannels[i].id}`;
  }

  await tx`
    insert into strategi_target
      (strategi_id, channel, month_index, metric, nilai_floor, nilai_stretch, sumber_floor, created_by)
    select ${toId}, channel, month_index, metric, nilai_floor, nilai_stretch,
           case when nilai_floor is null then null else ${FLOOR_INPUT_AM} end, ${actorId}
      from strategi_target where strategi_id = ${fromId}`;

  await tx`
    insert into strategi_assumption
      (strategi_id, kode, asumsi, pemilik, cara_verifikasi, status, target_terkait, created_by)
    select ${toId}, kode, asumsi, pemilik, cara_verifikasi, status, target_terkait, ${actorId}
      from strategi_assumption where strategi_id = ${fromId}`;

  await tx`
    insert into strategi_pillar
      (strategi_id, jenis, channel, urutan, sku, peran, aksi, target, harga_normal,
       harga_promo, floor_price, vendor_id, slot_jam, tarif, target_gmv_per_jam, detail, created_by)
    select ${toId}, jenis, channel, urutan, sku, peran, aksi, target, harga_normal,
           harga_promo, floor_price, vendor_id, slot_jam, tarif, target_gmv_per_jam, detail, ${actorId}
      from strategi_pillar where strategi_id = ${fromId}`;

  await tx`
    insert into strategi_resource
      (strategi_id, jenis, channel, divisi, nilai, jumlah, satuan, sumber_dana, vendor_id,
       skema_biaya, catatan, created_by)
    select ${toId}, jenis, channel, divisi, nilai, jumlah, satuan, sumber_dana, vendor_id,
           skema_biaya, catatan, ${actorId}
      from strategi_resource where strategi_id = ${fromId}`;

  await tx`
    insert into strategi_risk
      (strategi_id, risiko, dampak, kemungkinan, mitigasi, pic, urutan, created_by)
    select ${toId}, risiko, dampak, kemungkinan, mitigasi, pic, urutan, ${actorId}
      from strategi_risk where strategi_id = ${fromId}`;

  // Section C (A-07) — diagnosa and supporting lists travel with the revision
  // for the same reason as A-15/A-16: the AM revisits the strategy, not the
  // client's situation. A revision that inherits a blank Section C would force
  // re-typing content the AM may not want to change.
  await tx`
    insert into strategi_diagnosa
      (strategi_id, channel, bottleneck, field_ids, akar_masalah, gap_kompetitor, created_by)
    select ${toId}, channel, bottleneck, field_ids, akar_masalah, gap_kompetitor, ${actorId}
      from strategi_diagnosa where strategi_id = ${fromId}`;

  await tx`
    insert into strategi_quick_win
      (strategi_id, aksi, channel, pic_divisi, dampak_diharapkan, urutan, created_by)
    select ${toId}, aksi, channel, pic_divisi, dampak_diharapkan, urutan, ${actorId}
      from strategi_quick_win where strategi_id = ${fromId}`;

  await tx`
    insert into strategi_risiko_struktural
      (strategi_id, risiko, urutan, created_by)
    select ${toId}, risiko, urutan, ${actorId}
      from strategi_risiko_struktural where strategi_id = ${fromId}`;

  await tx`
    insert into strategi_prasyarat_klien
      (strategi_id, item, pic_klien, deadline, urutan, created_by)
    select ${toId}, item, pic_klien, deadline, urutan, ${actorId}
      from strategi_prasyarat_klien where strategi_id = ${fromId}`;

  // Section E-12 / G / H-2 / I (A-09b). All five carry, and none of them is a
  // borderline call the way D-7 was: every one is CONTENT the AM would
  // otherwise retype, not an act with an actor and a timestamp.
  //
  // H-2 in particular MUST carry: `openRevision` refuses a J-3 trigger that the
  // version being revised did not declare, so a revision that inherited an
  // empty H-2 would be unable to declare its own reason for existing the next
  // time round.
  await tx`
    insert into strategi_ketergantungan_klien
      (strategi_id, item, kapan, konsekuensi, urutan, created_by)
    select ${toId}, item, kapan, konsekuensi, urutan, ${actorId}
      from strategi_ketergantungan_klien where strategi_id = ${fromId}`;

  await tx`
    insert into strategi_fase
      (strategi_id, nama, tanggal_mulai, tanggal_akhir, tujuan, kriteria_lulus, urutan, created_by)
    select ${toId}, nama, tanggal_mulai, tanggal_akhir, tujuan, kriteria_lulus, urutan, ${actorId}
      from strategi_fase where strategi_id = ${fromId}`;

  await tx`
    insert into strategi_tanggal_besar
      (strategi_id, tanggal, nama, peran, urutan, created_by)
    select ${toId}, tanggal, nama, peran, urutan, ${actorId}
      from strategi_tanggal_besar where strategi_id = ${fromId}`;

  await tx`
    insert into strategi_trigger_revisi
      (strategi_id, kode, ambang, catatan, urutan, created_by)
    select ${toId}, kode, ambang, catatan, urutan, ${actorId}
      from strategi_trigger_revisi where strategi_id = ${fromId}`;

  await tx`
    insert into strategi_dispatch
      (strategi_id, divisi, urutan, catatan, created_by)
    select ${toId}, divisi, urutan, catatan, ${actorId}
      from strategi_dispatch where strategi_id = ${fromId}`;

  // A-10 — the visibility overlay travels with the revision, `diubah_oleh` and
  // `diubah_pada` included. Resetting it to the §4.1 defaults would mean every
  // field the AM chose to share in version n silently goes dark the moment n+1
  // is approved — and Rule 16(c) serves the client from the active version, so
  // the client would watch the document get thinner with no one having decided
  // that. Carrying it forward errs the other way: a field stays shared because
  // someone already decided it should be, which is a decision on the record.
  await tx`
    insert into strategi_field_visibility
      (strategi_id, field_id, visibilitas, diubah_oleh, diubah_pada, created_by)
    select ${toId}, field_id, visibilitas, diubah_oleh, diubah_pada, ${actorId}
      from strategi_field_visibility where strategi_id = ${fromId}`;
  // …and then top up whatever §4 gained since version n was created. `ON
  // CONFLICT DO NOTHING` inside makes this additive only: the rows just copied
  // win over the defaults.
  await seedFieldVisibility(tx, toId, actorId);
}

/** transitionError maps an engine rejection to the shared error taxonomy. */
function transitionError(res: statemachine.TransitionResult & { ok: false }): Error {
  return res.code === 'role_denied'
    ? new ForbiddenError(res.message)
    : new ConflictError(res.message);
}

function nullIfBlank(s: string | null | undefined): string | null {
  const t = (s ?? '').toString().trim();
  return t === '' ? null : t;
}
