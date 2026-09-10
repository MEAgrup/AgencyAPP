/**
 * Master Service List administration + read (S0-09), ported to the Supabase
 * stack from Go's `internal/admin/master_service.go`.
 *
 * The MSL is Sales-owned (DECISIONS OD-2): a logical `master_services` row with
 * an append-only chain of immutable `master_service_versions`. Every edit is a
 * NEW version — nothing is mutated in place — so a Qualified/Closing snapshot
 * that pinned an older version stays reproducible forever (CLAUDE.md #3/#4).
 *
 * This module owns the canonical MSL READ (`effectiveAt` / `listEffectiveAt` +
 * `ServiceView`) that `sales.ts` consumes for pricing, and the write path
 * (`createService` / `updateService`) gated to Sales Head/SPV + Director. Kept
 * as a sibling of `sales` (not importing it) so the pricing calculator and the
 * catalog admin never form an import cycle — mirroring the Go package split.
 *
 * House rules honored here:
 *   - MSV id minted ONLY after the mandatory-field gate passes.
 *   - Immutable versions (INSERT-only); every create/version appends to audit.
 *   - Exact BI `[...]`: the house default gate + the edit-denied message.
 *
 * Reference: archive/backend-go/internal/admin/master_service.go.
 */

import { accrual, money, permission, tz } from '@cdps/core';
import { executors, withTransaction, type Queryable, type Sql } from '@cdps/db';
// `plangate_rules` is pure (its only import is @cdps/core), so taking the tier
// vocabulary from it cannot form a cycle — unlike `sales`, which this module
// deliberately never imports.
import {
  TIER_DITENTUKAN_AM,
  TIER_PLAN_WAJIB,
  TIER_TANPA_PLAN,
  type PlanTier,
} from './plangate_rules';
// Same reasoning for the commission grammar: `commission_rule` is pure (its only
// import is @cdps/core), so the catalog admin can enforce the rule the pricing
// calculator will later read WITHOUT importing `sales` (DECISIONS O73).
import { parseCommissionRule } from './commission_rule';

/** Authenticated employee + resolved role. */
export type Actor = permission.Actor;

/** The CDPS division that owns the Master Service List (DECISIONS OD-2). */
export const SALES_DIVISION = 'Sales';

/** Exact BI message for an unauthorized MSL edit. */
export const MSG_MASTER_SERVICE_DENIED = '[anda tidak memiliki akses untuk mengubah master service list]';

/**
 * Exact BI message for trying to SELL an archived service.
 *
 * It names the service so the refusal is actionable: a Qualified Form with six
 * lines that answers only "layanan tidak aktif" sends the closer hunting.
 */
export const MSG_MASTER_SERVICE_ARCHIVED_PREFIX = '[layanan ';
export const MSG_MASTER_SERVICE_ARCHIVED_SUFFIX = ' sudah tidak aktif dan tidak bisa dijual lagi]';

/** Exact BI message for deleting a service that some snapshot already points at. */
export const MSG_MASTER_SERVICE_IN_USE_SUFFIX = ' — tidak bisa dihapus, arsipkan saja]';

// Pricing modes / frequencies (local literals — this module never imports
// `sales` so the two never form a cycle; the sets mirror the calculator).
const PRICING_FLAT = 'flat';
const PRICING_MIN_FLOOR = 'min_floor';
const PRICING_BATCH_CEILING = 'batch_ceiling';
const PRICING_PASSTHROUGH = 'passthrough';
const PRICING_MODES = new Set([PRICING_FLAT, PRICING_MIN_FLOOR, PRICING_BATCH_CEILING, PRICING_PASSTHROUGH]);
const FREQUENCIES = new Set(['Monthly', 'One-time', 'Campaign']);

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Mandatory-field gate failure (house default BI message). */
export class IncompleteError extends Error {
  constructor() {
    super('[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]');
    this.name = 'MslIncompleteError';
  }
}

/** Actor may not edit the Master Service List (carries the verbatim BI message). */
export class ForbiddenError extends Error {
  constructor() {
    super(MSG_MASTER_SERVICE_DENIED);
    this.name = 'MslForbiddenError';
  }
}

/** No MSL version applies (unknown service, or none effective at the date). */
export class ServiceNotFoundError extends Error {
  constructor(serviceId: string) {
    super(`master service not found: ${serviceId}`);
    this.name = 'ServiceNotFoundError';
  }
}

/**
 * The version effective at the date exists but is ARCHIVED, so it may not be
 * sold. Deliberately a DIFFERENT error from `ServiceNotFoundError`: "the
 * catalog has no such service" and "the catalog withdrew this service" call for
 * different fixes by the person reading it, and collapsing them into one 404
 * would make a withdrawal look like a data bug.
 */
export class ServiceArchivedError extends Error {
  constructor(public readonly serviceName: string) {
    super(`${MSG_MASTER_SERVICE_ARCHIVED_PREFIX}${serviceName}${MSG_MASTER_SERVICE_ARCHIVED_SUFFIX}`);
    this.name = 'ServiceArchivedError';
  }
}

/**
 * Delete refused because a snapshot still points at this catalog id. Carries the
 * per-table counts, because a Sales Head who is refused needs to know WHERE it
 * is used to decide whether archiving is the answer.
 */
export class ServiceInUseError extends Error {
  constructor(public readonly refs: ServiceRefs) {
    super(
      `[layanan ini sudah dipakai (${refs.services} Service, ${refs.qualifiedForms} Qualified Form, ` +
      `${refs.negotiationLines} baris proposal, ${refs.renewalLines} baris perpanjangan)` +
      MSG_MASTER_SERVICE_IN_USE_SUFFIX,
    );
    this.name = 'ServiceInUseError';
  }
}

// ---------------------------------------------------------------------------
// Read model
// ---------------------------------------------------------------------------

/** The effective view of one service at a date (id = service id). */
/**
 * FS-6 — satu pilihan tenor pada satu versi layanan.
 *
 * `harga` adalah harga PAKET UTUH untuk tenor itu, bukan harga per bulan:
 * itulah yang membuat diskon paket bisa dinyatakan sama sekali
 * (`Jasa Iklan Traffic Marketplace Basic` 3 bln Rp 10,2jt vs 12 bln Rp 36jt,
 * bukan 12 × harga sebulan). `qty_menambah` yang linear tidak bisa
 * mengungkapkan itu — lihat header migrasi 20260925040000.
 */
export interface DurasiOption {
  durasiBulan: number;
  harga: string;
}

export interface ServiceView {
  id: string;
  name: string;
  standardPrice: string;
  commissionRule: string;
  category: string;
  unit: string;
  minQty: string;
  pricingMode: string;
  applyPPN: boolean;
  frequency: string;
  priceNote: string;
  description: string;
  active: boolean;
  requiresStrategyPlan: boolean;
  /**
   * Catalog tier (M6C S4 / §3). This is the field the Sales Head actually sets;
   * `requiresStrategyPlan` is the legacy boolean kept in lockstep with it by
   * `reconcileTier` (and, at the DB layer, by the `normalize_plan_tier` trigger).
   *
   * O54 (DECISIONS 2026-08-07): tier is settable per catalog entry HERE, not in
   * a migration — MEA's services are created dynamically per client need, so a
   * new service that needs a Plan must not have to wait for an engineering
   * release.
   */
  planTier: PlanTier;
  /**
   * Durasi jasa dalam BULAN KALENDER, dihitung dari tanggal layanan MULAI
   * JALAN (untuk Ads: start campaign — periode riset tidak dihitung). Dipakai
   * Ads Management Date (`ads.ts computeAdsManagementEndDate`) dan, nanti,
   * mesin accrual Gelombang D.
   *
   * `null` BUKAN "belum diisi": ia berarti layanan ini **sekali jadi** dan
   * tidak punya periode sama sekali, jadi pendapatannya diakui SEKALIGUS saat
   * selesai, bukan disebar satu bulan (ketokan Q5 2026-09-07).
   */
  durasiBulan: number | null;
  /**
   * Apa yang bertambah kalau klien membeli lebih dari satu (ketokan Q3):
   * `'durasi'` ⇒ durasi total = qty × durasiBulan (GMV Max beli 3 = 3 bulan);
   * `'volume'` ⇒ qty adalah jumlah keluaran dalam periode yang sama (Nano KOL
   * beli 10 = 10 KOL, durasinya tidak berubah).
   */
  qtyMenambah: QtyMenambah;
  /**
   * KAPAN pendapatan layanan ini diakui mesin accrual Gelombang D (ketokan
   * D-KOM 2026-09-07 opsi a):
   *   `'per_periode'`      disebar rata sepanjang `durasiBulan`;
   *   `'saat_selesai'`     diakui PENUH saat status layanan selesai;
   *   `'bulan_berikutnya'` diakui satu bulan SESUDAH penjualan yang
   *                        melahirkannya, karena angkanya baru diketahui bulan
   *                        depan (`Komisi`).
   *
   * TIDAK bisa diturunkan dari `durasiBulan`: `Komisi` dan `Jasa Pengajuan
   * Shopee Mall` sama-sama `durasiBulan = null` dengan arti yang berbeda. Itu
   * satu nilai kosong yang membawa dua arti — persis kelas cacat yang aturan
   * rumah #4 ada untuk mencegah.
   */
  pengakuan: Pengakuan;
  /**
   * FS-6: pilihan tenor untuk layanan ini, terurut dari yang TERPENDEK.
   * Array kosong = layanan tenor tunggal (perilaku sebelum FS-6, dan bentuk
   * dari 100% katalog hari ini).
   *
   * Bila tidak kosong, opsi PERTAMA selalu sama dengan `standardPrice` +
   * `durasiBulan` di atas — invarian yang ditegakkan trigger DB
   * `trg_msdo_terpendek`, bukan hanya di sini. Itulah yang membuat setiap
   * pembaca lama (`sales.deriveDuration`, `ads.computeAdsManagementEndDate`,
   * mesin accrual) terus membaca angka yang sah tanpa tahu soal opsi.
   */
  durasiOptions: DurasiOption[];
  versionNo: number;
  effectiveFrom: string;
}

interface VersionRow {
  service_id: string;
  name: string;
  standard_price: string;
  commission_rule: string;
  category: string | null;
  unit: string | null;
  min_qty: string | null;
  pricing_mode: string;
  apply_ppn: boolean;
  frequency: string | null;
  price_note: string | null;
  description: string | null;
  active: boolean;
  requires_strategy_plan: boolean;
  plan_tier: string;
  durasi_bulan: number | null;
  qty_menambah: string;
  pengakuan: string;
  durasi_options: { durasi_bulan: number; harga: string }[] | null;
  version_no: number;
  effective_from: Date | string;
}

function toView(r: VersionRow): ServiceView {
  return {
    id: r.service_id, name: r.name, standardPrice: r.standard_price, commissionRule: r.commission_rule,
    category: r.category ?? '', unit: r.unit ?? '', minQty: r.min_qty ?? '', pricingMode: r.pricing_mode,
    applyPPN: r.apply_ppn, frequency: r.frequency ?? '', priceNote: r.price_note ?? '',
    description: r.description ?? '', active: r.active, requiresStrategyPlan: r.requires_strategy_plan,
    planTier: r.plan_tier as PlanTier,
    durasiBulan: r.durasi_bulan,
    qtyMenambah: r.qty_menambah as QtyMenambah,
    pengakuan: r.pengakuan as Pengakuan,
    durasiOptions: (r.durasi_options ?? []).map((o) => ({
      durasiBulan: Number(o.durasi_bulan),
      harga: o.harga,
    })),
    versionNo: r.version_no,
    effectiveFrom: r.effective_from instanceof Date
      ? r.effective_from.toISOString().slice(0, 10)
      : String(r.effective_from),
  };
}

const VERSION_COLUMNS = `service_id, name, standard_price, commission_rule, category, unit, min_qty,
  pricing_mode, apply_ppn, frequency, price_note, description, active, requires_strategy_plan,
  plan_tier, durasi_bulan, qty_menambah, pengakuan, version_no, effective_from`;

/**
 * effectiveAt returns the MSL version effective on `date` (YYYY-MM-DD, WIB) for a
 * service — the latest version with effective_from ≤ date. Throws
 * ServiceNotFoundError when none applies.
 */
export async function effectiveAt(sql: Queryable, serviceId: string, date: string): Promise<ServiceView> {
  const rows = await sql<VersionRow[]>`
    select service_id, name, standard_price, commission_rule, category, unit, min_qty,
           pricing_mode, apply_ppn, frequency, price_note, description, active,
           requires_strategy_plan, plan_tier, durasi_bulan, qty_menambah, pengakuan, version_no, effective_from,
           coalesce((
             select json_agg(json_build_object('durasi_bulan', o.durasi_bulan, 'harga', o.harga::text)
                             order by o.durasi_bulan)
               from master_service_duration_options o
              where o.version_id = master_service_versions.id
           ), '[]'::json) as durasi_options
    from master_service_versions
    where service_id = ${serviceId} and effective_from <= ${date}
    order by effective_from desc, version_no desc limit 1`;
  if (rows.length === 0) {
    throw new ServiceNotFoundError(serviceId);
  }
  return toView(rows[0]);
}

/**
 * listEffectiveAt returns every service's version effective at `date`
 * (YYYY-MM-DD, WIB), newest-effective per service. Services with no version yet
 * effective at the date are omitted.
 */
export async function listEffectiveAt(sql: Queryable, date: string): Promise<ServiceView[]> {
  const rows = await sql<VersionRow[]>`
    select distinct on (service_id)
           service_id, name, standard_price, commission_rule, category, unit, min_qty,
           pricing_mode, apply_ppn, frequency, price_note, description, active,
           requires_strategy_plan, plan_tier, durasi_bulan, qty_menambah, pengakuan, version_no, effective_from,
           coalesce((
             select json_agg(json_build_object('durasi_bulan', o.durasi_bulan, 'harga', o.harga::text)
                             order by o.durasi_bulan)
               from master_service_duration_options o
              where o.version_id = master_service_versions.id
           ), '[]'::json) as durasi_options
    from master_service_versions
    where effective_from <= ${date}
    order by service_id, effective_from desc, version_no desc`;
  return rows.map(toView);
}

/**
 * sellableAt returns the MSL version effective on `date` for a service and
 * REFUSES it when that version is archived (`active = false`).
 *
 * ## Why a second reader instead of a flag on `effectiveAt`
 *
 * Same reasoning that split `private.employee_roster()` from
 * `employee_assignable()` (DECISIONS 2026-09-10): two callers want two
 * different questions answered, and a boolean parameter makes the WRONG answer
 * reachable by forgetting an argument. Here the two questions are:
 *
 *   - *"what does the catalog say about this service"* — `effectiveAt`. Used to
 *     ENRICH things that were already agreed (`sales.close` naming a Service,
 *     `renewal.executeRenewal` filling `plan_tier`). These must keep working
 *     forever, because an approved deal cannot be allowed to fail on the day
 *     someone tidies the catalog. That is not a new rule — `renewal.ts` already
 *     refuses to gate commission billing on catalog labels for exactly this
 *     reason.
 *   - *"may I sell this service today"* — `sellableAt`. Used by every path that
 *     creates a NEW agreement.
 *
 * ## Why this is `effectiveAt` + a check, and NOT `where active`
 *
 * This is the trap, and it is quiet. Suppose v1 is active at Rp 10jt and v2
 * archives the service. A query written `where active order by effective_from
 * desc limit 1` does not see v2, so it happily returns **v1 — and sells at the
 * old price**. Archiving something would silently resurrect the version before
 * it. So `active` is a fact ABOUT the version in force, never a filter for
 * finding a different one. The migration comment on the column says the same,
 * because this is the kind of "fix" a later reader reintroduces.
 */
export async function sellableAt(sql: Queryable, serviceId: string, date: string): Promise<ServiceView> {
  const view = await effectiveAt(sql, serviceId, date);
  if (!view.active) {
    throw new ServiceArchivedError(view.name);
  }
  return view;
}

/**
 * listSellableAt returns every service that MAY BE SOLD at `date` — i.e.
 * `listEffectiveAt` minus the ones whose effective version is archived.
 *
 * Filtered AFTER the per-service pick, for the reason spelled out on
 * `sellableAt`: filtering inside would surface an older active version instead
 * of dropping the service.
 */
export async function listSellableAt(sql: Queryable, date: string): Promise<ServiceView[]> {
  const all = await listEffectiveAt(sql, date);
  return all.filter((v) => v.active);
}

/** listVersions returns the full immutable version chain for one service. */
export async function listVersions(sql: Queryable, serviceId: string): Promise<ServiceView[]> {
  const rows = await sql<VersionRow[]>`
    select service_id, name, standard_price, commission_rule, category, unit, min_qty,
           pricing_mode, apply_ppn, frequency, price_note, description, active,
           requires_strategy_plan, plan_tier, durasi_bulan, qty_menambah, pengakuan, version_no, effective_from,
           coalesce((
             select json_agg(json_build_object('durasi_bulan', o.durasi_bulan, 'harga', o.harga::text)
                             order by o.durasi_bulan)
               from master_service_duration_options o
              where o.version_id = master_service_versions.id
           ), '[]'::json) as durasi_options
    from master_service_versions
    where service_id = ${serviceId}
    order by version_no desc`;
  return rows.map(toView);
}

// ---------------------------------------------------------------------------
// Write path (Sales Head/SPV + Director only)
// ---------------------------------------------------------------------------

/**
 * canEditMasterServices reports whether the actor may add/edit master services.
 * Restricted to Sales division level=lead (Sales Head/SPV); Director is full; a
 * plain salesperson (Sales staff) is denied (edit rights sit one level above the
 * closer so commission math stays non-fudgeable — CLAUDE.md #6 / DECISIONS OD-2).
 */
export function canEditMasterServices(a: Actor): boolean {
  if (a.role.director) {
    return true;
  }
  return a.role.division === SALES_DIVISION && a.role.level === permission.LevelLead;
}

/** Create/update fields for one master-service version. */
export interface ServiceInput {
  name: string;
  standardPrice: string;
  commissionRule: string;
  category?: string;
  unit?: string;
  minQty?: string;
  pricingMode?: string;
  applyPPN?: boolean;
  frequency?: string;
  priceNote?: string;
  description?: string;
  active?: boolean;
  requiresStrategyPlan?: boolean;
  /**
   * Catalog tier (O54). Optional so every pre-M6C caller (seeder, fixtures,
   * older clients that only know the boolean) keeps working unchanged —
   * `reconcileTier` derives it from `requiresStrategyPlan` when absent.
   */
  planTier?: PlanTier;
  /**
   * FS-6 — pilihan tenor (1/3/6/12 bulan dengan harga berbeda). Boleh kosong /
   * dihilangkan: layanan tenor tunggal tetap bekerja persis seperti sebelumnya.
   *
   * Bila diisi, opsi TERPENDEK wajib sama dengan `standardPrice` +
   * `durasiBulan` — ditolak di sini DAN oleh trigger DB `trg_msdo_terpendek`,
   * dua lapis karena route MSL bukan satu-satunya penulis tabel ini.
   */
  durasiOptions?: DurasiOption[] | null;
  /**
   * Durasi jasa dalam HARI KALENDER (M16 LT-42 / M17 §5.4). Optional/undefined
   * = tidak berlaku untuk layanan ini (disimpan NULL) — kebanyakan layanan
   * lama tidak mendeklarasikan ini.
   *
   * `null` berarti hal yang SAMA dengan undefined, dan itu disengaja: pemanggil
   * yang membangun payload dari sebuah form (MSL admin) selalu punya kuncinya,
   * dan memaksanya MENGHILANGKAN kunci saat kosong adalah persis kelas cacat
   * yang aturan rumah "kunci hilang lebih berbahaya daripada null" lahir untuk
   * mencegah. Jadi kedua bentuk kekosongan diterima; yang ditolak hanya nilai
   * yang bukan durasi (0, negatif, pecahan).
   */
  durasiBulan?: number | null;
  /**
   * Default `'volume'` bila tidak diberikan — sisi yang AMAN. Salah menandai
   * layanan berdurasi sebagai `volume` membuat durasinya terlalu pendek, dan
   * itu ketahuan cepat; sebaliknya menyebar pendapatan bertahun-tahun, dan itu
   * tidak kelihatan.
   */
  qtyMenambah?: QtyMenambah;
  /**
   * KAPAN pendapatan layanan ini diakui (ketokan D-KOM 2026-09-07 opsi a).
   *
   * Boleh dihilangkan HANYA kalau `durasiBulan` kosong — layanan tanpa periode
   * berarti `'saat_selesai'`, dan itu satu-satunya arti yang tersisa untuknya
   * (`'per_periode'` mustahil tanpa periode, `'bulan_berikutnya'` adalah kasus
   * `Komisi` yang wajib disebut terang-terangan).
   *
   * Kalau `durasiBulan` TERISI, ia WAJIB disebut. Layanan berdurasi bisa sah
   * `'per_periode'` maupun `'saat_selesai'` (proyek 3 bulan yang dibayar penuh
   * saat rampung), dan menebak salah satunya diam-diam menempatkan pendapatan
   * di bulan yang salah selama berbulan-bulan tanpa ada yang melihatnya. Hari
   * ini 42 dari 42 layanan berdurasi memang `'per_periode'` — tapi itu keadaan
   * data, bukan aturan, dan menjadikannya default berarti menurunkan
   * `pengakuan` dari `durasiBulan` lagi, hal yang persis dilarang D-KOM.
   */
  pengakuan?: Pengakuan;
  effectiveFrom: string; // YYYY-MM-DD
}

/** The three catalog tiers, as an input-validation set. */
const PLAN_TIERS = new Set<string>([TIER_PLAN_WAJIB, TIER_DITENTUKAN_AM, TIER_TANPA_PLAN]);

/** What a purchased qty multiplies — periods sold, or outputs within one period. */
export type QtyMenambah = 'durasi' | 'volume';
export const QTY_MENAMBAH_DURASI: QtyMenambah = 'durasi';
export const QTY_MENAMBAH_VOLUME: QtyMenambah = 'volume';
const QTY_MENAMBAH = new Set<string>([QTY_MENAMBAH_DURASI, QTY_MENAMBAH_VOLUME]);

/**
 * KAPAN pendapatan sebuah layanan diakui — kosakata bersama dengan
 * `@cdps/core` `accrual.Pengakuan` dan CHECK `ck_msv_pengakuan` di DB.
 */
export type Pengakuan = accrual.Pengakuan;
export const PENGAKUAN_PER_PERIODE: Pengakuan = accrual.PENGAKUAN_PER_PERIODE;
export const PENGAKUAN_SAAT_SELESAI: Pengakuan = accrual.PENGAKUAN_SAAT_SELESAI;
export const PENGAKUAN_BULAN_BERIKUTNYA: Pengakuan = accrual.PENGAKUAN_BULAN_BERIKUTNYA;
const PENGAKUAN = new Set<string>([PENGAKUAN_PER_PERIODE, PENGAKUAN_SAAT_SELESAI, PENGAKUAN_BULAN_BERIKUTNYA]);

/**
 * reconcileTier keeps `plan_tier` and the legacy `requires_strategy_plan`
 * boolean in agreement, and is a LINE-FOR-LINE mirror of the DB trigger
 * `normalize_plan_tier` (migration 20260806061000). The migration calls that
 * agreement a frozen invariant: "predikat TS dan DB tidak boleh menyimpang".
 *
 * The branch order matters and is not arbitrary — it decides which column wins
 * when the two disagree, by asking which one the caller actually spoke through:
 *
 *   - tier `ditentukan_am`      ⇒ boolean false. The effective gate for this
 *                                 tier comes from `service_plan_gate`, never
 *                                 from the catalog.
 *   - tier `plan_wajib`         ⇒ boolean true. An M6C-era caller spoke via tier.
 *   - tier left at the default  ⇒ a pre-M6C caller spoke via the boolean, so a
 *     and boolean true            true boolean promotes the tier to `plan_wajib`.
 *
 * Keep this identical to the trigger. If they ever diverge, the row is still
 * rejected by `ck_msv_tier_matches_flag` — but the error surfaces at INSERT
 * time as a constraint violation instead of as a validation message, which is
 * a much worse place to find out.
 */
export function reconcileTier(
  planTier: PlanTier | undefined,
  requiresStrategyPlan: boolean,
): { planTier: PlanTier; requiresStrategyPlan: boolean } {
  let tier: PlanTier = planTier ?? TIER_TANPA_PLAN;
  let requires = requiresStrategyPlan;
  if (tier === TIER_DITENTUKAN_AM) {
    requires = false;
  } else if (tier === TIER_PLAN_WAJIB) {
    requires = true;
  } else if (requires) {
    tier = TIER_PLAN_WAJIB;
  }
  return { planTier: tier, requiresStrategyPlan: requires };
}

/** A normalized (validated) input ready to persist. */
interface NormalizedInput extends Required<Omit<ServiceInput, 'category' | 'unit' | 'minQty' | 'frequency' | 'priceNote' | 'description' | 'durasiBulan' | 'durasiOptions'>> {
  category: string;
  unit: string;
  minQty: string;
  frequency: string;
  priceNote: string;
  description: string;
  /** null = tidak berlaku untuk layanan ini (disimpan SQL NULL). */
  durasiBulan: number | null;
  pengakuan: Pengakuan;
  /** Terurut dari tenor TERPENDEK; kosong = layanan tenor tunggal. */
  durasiOptions: DurasiOption[];
}

/**
 * normalizeInput validates the MSL v2 calculator fields, applying the flat
 * default and normalizing passthrough's unit price to "0". Invalid input throws
 * IncompleteError (the house default — no new strings invented), EXCEPT for a
 * malformed `commission_rule`, which throws BadCommissionRuleError so the Sales
 * Head is told what shape to type instead of "lengkapi pertanyaan wajib" for a
 * field they did fill in (DECISIONS O73).
 */
function normalizeInput(inp: ServiceInput): NormalizedInput {
  const name = (inp.name ?? '').trim();
  const commissionRule = (inp.commissionRule ?? '').trim();
  const effectiveFrom = (inp.effectiveFrom ?? '').trim();
  if (name === '' || commissionRule === '' || effectiveFrom === '') {
    throw new IncompleteError();
  }
  // Grammar gate (DECISIONS O14/O73). Before O73 this module accepted ANY
  // non-empty string, and 56 of the 96 catalog versions in `CDPS SG` were saved
  // with rules the calculator cannot read ("0", free prose). The cost landed on
  // the wrong person: the row saved fine here, then the Qualified Lead Form
  // refused every one of those services in front of a salesperson. Reject at the
  // keyboard of the one who can actually fix it.
  parseCommissionRule(commissionRule);
  const pricingMode = (inp.pricingMode ?? '') === '' ? PRICING_FLAT : (inp.pricingMode as string);
  if (!PRICING_MODES.has(pricingMode)) {
    throw new IncompleteError();
  }
  const frequency = inp.frequency ?? '';
  if (frequency !== '' && !FREQUENCIES.has(frequency)) {
    throw new IncompleteError();
  }
  // An unknown tier is rejected rather than silently coerced: the whole point of
  // O54 is that the Sales Head chooses this value, and a typo that quietly
  // became `tanpa_plan` would take the Strategi path off the table without
  // anyone being told.
  if (inp.planTier !== undefined && !PLAN_TIERS.has(inp.planTier)) {
    throw new IncompleteError();
  }
  const tier = reconcileTier(inp.planTier, inp.requiresStrategyPlan ?? false);

  let standardPrice = inp.standardPrice ?? '';
  if (pricingMode === PRICING_PASSTHROUGH) {
    // Unit price is ignored for passthrough; normalize "" / "0" to "0".
    if (standardPrice.trim() === '') {
      standardPrice = '0';
    }
    let p: money.Money;
    try {
      p = money.parse(standardPrice);
    } catch {
      throw new IncompleteError();
    }
    if (p < 0n) {
      throw new IncompleteError();
    }
  } else {
    let p: money.Money;
    try {
      p = money.parse(standardPrice);
    } catch {
      throw new IncompleteError();
    }
    if (p <= 0n) {
      throw new IncompleteError();
    }
  }

  let minQty = inp.minQty ?? '';
  if (pricingMode === PRICING_MIN_FLOOR || pricingMode === PRICING_BATCH_CEILING) {
    const norm = wholePositive(minQty);
    if (norm === null) {
      throw new IncompleteError();
    }
    minQty = norm;
  }

  // durasi_bulan: undefined/null = layanan sekali jadi, tidak punya periode.
  // Kalau diberikan, wajib bilangan bulat positif BULAN — bukan 0/negatif/
  // pecahan, yang tidak berarti sebagai durasi.
  let durasiBulan: number | null = null;
  if (inp.durasiBulan !== undefined && inp.durasiBulan !== null) {
    if (!Number.isInteger(inp.durasiBulan) || inp.durasiBulan <= 0) {
      throw new IncompleteError();
    }
    durasiBulan = inp.durasiBulan;
  }

  // qty_menambah: default ke sisi yang aman. `durasi` tanpa `durasiBulan` tidak
  // punya arti — qty mengalikan durasi, dan tidak ada yang bisa dikali — jadi
  // ditolak di sini DAN oleh CHECK di DB (`ck_msv_qty_durasi_butuh_durasi_bulan`).
  // Dua lapis karena route bukan satu-satunya penulis tabel ini.
  const qtyMenambah = inp.qtyMenambah ?? QTY_MENAMBAH_VOLUME;
  if (!QTY_MENAMBAH.has(qtyMenambah)) {
    throw new IncompleteError();
  }
  if (qtyMenambah === QTY_MENAMBAH_DURASI && durasiBulan === null) {
    throw new IncompleteError();
  }

  // pengakuan (D-KOM). Tanpa `durasiBulan` hanya ada satu arti yang tersisa,
  // jadi boleh dihilangkan; DENGAN `durasiBulan` ia wajib disebut, karena dua
  // arti sama-sama mungkin dan tidak ada sisi yang aman untuk ditebak.
  // `per_periode` tanpa periode ditolak di sini DAN oleh
  // `ck_msv_per_periode_butuh_durasi_bulan` di DB — dua lapis, karena route MSL
  // bukan satu-satunya penulis tabel ini.
  let pengakuan: Pengakuan;
  if (inp.pengakuan === undefined || inp.pengakuan === null) {
    if (durasiBulan !== null) {
      throw new IncompleteError();
    }
    pengakuan = PENGAKUAN_SAAT_SELESAI;
  } else {
    if (!PENGAKUAN.has(inp.pengakuan)) {
      throw new IncompleteError();
    }
    pengakuan = inp.pengakuan;
  }
  if (pengakuan === PENGAKUAN_PER_PERIODE && durasiBulan === null) {
    throw new IncompleteError();
  }

  // --- FS-6: pilihan tenor ---------------------------------------------------
  // Diurutkan DI SINI, bukan diserahkan ke pemanggil: invarian "opsi terpendek
  // = harga & durasi versinya" hanya bisa diperiksa kalau urutannya pasti, dan
  // form yang mengirim 6/3/12 bukan input yang salah — cuma tidak terurut.
  const durasiOptions: DurasiOption[] = [...(inp.durasiOptions ?? [])]
    .map((o) => ({ durasiBulan: Number(o.durasiBulan), harga: (o.harga ?? '').trim() }))
    .sort((a, b) => a.durasiBulan - b.durasiBulan);

  if (durasiOptions.length > 0) {
    const seen = new Set<number>();
    for (const o of durasiOptions) {
      if (!Number.isInteger(o.durasiBulan) || o.durasiBulan <= 0) {
        throw new IncompleteError();
      }
      if (seen.has(o.durasiBulan)) {
        throw new IncompleteError();  // dua harga untuk satu tenor
      }
      seen.add(o.durasiBulan);
      let harga: money.Money;
      try {
        harga = money.parse(o.harga);
      } catch {
        throw new IncompleteError();
      }
      if (harga < 0n) {
        throw new IncompleteError();
      }
      o.harga = money.decimal(harga);
    }
    // Invarian yang menjaga SELURUH pembaca lama tetap benar. Ditolak di sini
    // supaya Sales Head melihat pesan BI di form, bukan galat trigger mentah —
    // tapi trigger DB-nya tetap ada, karena route ini bukan satu-satunya pintu.
    const terpendek = durasiOptions[0];
    // Dibandingkan sebagai UANG, bukan sebagai teks: `standardPrice` di sini
    // masih apa adanya seperti diketik ('10200000'), sementara `harga` opsi
    // sudah dinormalkan ('10200000.00'). Perbandingan string akan menolak dua
    // angka yang sama persis — dan menolaknya dengan pesan "data tidak
    // lengkap", yang tidak menunjuk ke apa pun yang bisa diperbaiki.
    if (durasiBulan !== terpendek.durasiBulan
        || money.parse(standardPrice) !== money.parse(terpendek.harga)) {
      throw new IncompleteError();
    }
  }

  return {
    name, standardPrice, commissionRule, effectiveFrom, pricingMode,
    category: inp.category ?? '', unit: inp.unit ?? '', minQty, frequency,
    priceNote: inp.priceNote ?? '', description: inp.description ?? '',
    applyPPN: inp.applyPPN ?? false, requiresStrategyPlan: tier.requiresStrategyPlan,
    planTier: tier.planTier,
    durasiBulan,
    qtyMenambah,
    pengakuan,
    durasiOptions,
    active: inp.active ?? false,
  };
}

/**
 * wholePositive validates that s is a whole positive integer (DECIMAL string),
 * returning it normalized to a DECIMAL(15,2) string, or null when invalid.
 */
function wholePositive(s: string): string | null {
  let m: money.Money;
  try {
    m = money.parse(s);
  } catch {
    return null;
  }
  if (m <= 0n || m % 100n !== 0n) {
    return null;
  }
  return money.decimal(m);
}

async function insertVersion(
  tx: Queryable,
  serviceId: string,
  versionNo: number,
  inp: NormalizedInput,
  actorId: string,
): Promise<void> {
  const rows = await tx<{ id: string }[]>`
    insert into master_service_versions
      (service_id, version_no, name, standard_price, commission_rule, category, unit,
       min_qty, pricing_mode, apply_ppn, frequency, price_note, description,
       active, requires_strategy_plan, plan_tier, durasi_bulan, qty_menambah, pengakuan, effective_from, created_by)
    values
      (${serviceId}, ${versionNo}, ${inp.name}, ${inp.standardPrice}, ${inp.commissionRule},
       ${nullText(inp.category)}, ${nullText(inp.unit)}, ${nullText(inp.minQty)}, ${inp.pricingMode},
       ${inp.applyPPN}, ${nullText(inp.frequency)}, ${nullText(inp.priceNote)}, ${nullText(inp.description)},
       ${inp.active}, ${inp.requiresStrategyPlan}, ${inp.planTier}, ${inp.durasiBulan}, ${inp.qtyMenambah},
       ${inp.pengakuan}, ${inp.effectiveFrom}, ${actorId})
    returning id`;
  // FS-6: baris opsi ditulis dalam transaksi yang SAMA. Trigger-nya DEFERRABLE
  // INITIALLY DEFERRED justru untuk urutan ini — baris versi wajib ada lebih
  // dulu (FK), jadi pemeriksaan yang tidak ditunda akan menolak penulisan yang
  // sah hanya karena urutannya.
  const versionId = rows[0].id;
  for (const o of inp.durasiOptions) {
    await tx`
      insert into master_service_duration_options (version_id, durasi_bulan, harga, created_by)
      values (${versionId}, ${o.durasiBulan}, ${o.harga}, ${actorId})`;
  }
}

/**
 * createService creates a new master service with version 1 — mints the MSV id
 * ONLY after validation passes, inserts master_services + version 1 + audit, all
 * in one transaction. Sales Head/SPV or Director only.
 */
export async function createService(sql: Sql, actor: Actor, inp: ServiceInput, now: Date = new Date()): Promise<string> {
  if (!canEditMasterServices(actor)) {
    throw new ForbiddenError();
  }
  const norm = normalizeInput(inp);
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const id = await ex.ident.identNext('MSV', now);
    await tx`insert into master_services (id, created_by) values (${id}, ${actor.employeeId})`;
    await insertVersion(tx, id, 1, norm, actor.employeeId);
    await ex.audit.insertAudit({
      entityType: 'master_service', entityId: id, actorEmployeeId: actor.employeeId,
      action: 'create', beforeJson: null,
      afterJson: { version_no: 1, name: norm.name, standard_price: norm.standardPrice, pricing_mode: norm.pricingMode },
      createdBy: actor.employeeId,
    });
    return id;
  });
}

/**
 * updateService appends a new immutable version to an existing service (+ audit).
 * Every change is a new version; nothing is mutated in place. Throws
 * ServiceNotFoundError when the service id has no versions yet.
 */
export async function updateService(sql: Sql, actor: Actor, serviceId: string, inp: ServiceInput): Promise<number> {
  if (!canEditMasterServices(actor)) {
    throw new ForbiddenError();
  }
  const norm = normalizeInput(inp);
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const rows = await tx<{ max: number | null }[]>`
      select max(version_no) as max from master_service_versions where service_id = ${serviceId}`;
    const max = rows[0]?.max;
    if (max === null || max === undefined) {
      throw new ServiceNotFoundError(serviceId);
    }
    const next = Number(max) + 1;
    await insertVersion(tx, serviceId, next, norm, actor.employeeId);
    await ex.audit.insertAudit({
      entityType: 'master_service', entityId: serviceId, actorEmployeeId: actor.employeeId,
      action: 'new_version', beforeJson: null,
      afterJson: { version_no: next, name: norm.name, standard_price: norm.standardPrice, pricing_mode: norm.pricingMode },
      createdBy: actor.employeeId,
    });
    return next;
  });
}

// ---------------------------------------------------------------------------
// Arsip / pulihkan / hapus (permintaan pemilik 2026-09-10)
// ---------------------------------------------------------------------------

/** How many snapshots point at one catalog id, per table. */
export interface ServiceRefs {
  services: number;
  qualifiedForms: number;
  negotiationLines: number;
  renewalLines: number;
  /** true when all four are zero — i.e. this catalog row was never used. */
  unused: boolean;
}

/**
 * serviceRefs counts how many snapshots point at one catalog id.
 *
 * Reads `private.master_service_refs()` rather than four counts written here:
 * the trigger that ENFORCES the delete rule reads the same function, so the
 * refusal a person sees and the refusal the database applies can never disagree
 * — and a fifth snapshot table added later lands in one place.
 */
export async function serviceRefs(sql: Queryable, serviceId: string): Promise<ServiceRefs> {
  const rows = await sql<
    { services: string; qualified_forms: string; negotiation_lines: string; renewal_lines: string }[]
  >`select * from private.master_service_refs(${serviceId})`;
  const r = rows[0];
  const refs = {
    services: Number(r?.services ?? 0),
    qualifiedForms: Number(r?.qualified_forms ?? 0),
    negotiationLines: Number(r?.negotiation_lines ?? 0),
    renewalLines: Number(r?.renewal_lines ?? 0),
  };
  return {
    ...refs,
    unused: refs.services + refs.qualifiedForms + refs.negotiationLines + refs.renewalLines === 0,
  };
}

/**
 * setActive archives (`active = false`) or restores (`true`) a service by
 * appending a new version that is a VERBATIM copy of the one in force, with
 * only that one flag flipped.
 *
 * ## Why not `updateService({ active: false })`
 *
 * Because `updateService` is FULL REPLACE, and `DECISIONS.md` 2026-09-07 already
 * records the damage that caused: every "Ubah" that does not resend
 * `durasi_jasa` silently ERASES it. Archiving is a one-flag operation; routing
 * it through a full-replace writer means the caller must reconstruct all twenty
 * fields correctly or quietly lose the ones it forgot — and the caller here is a
 * button, which knows none of them.
 *
 * ## Why the copy is done in SQL, not through ServiceInput
 *
 * A round trip through `toView` → `ServiceInput` → `normalizeInput` would run
 * every value through coercion built for HUMAN input (empty-string-to-NULL,
 * price re-parsing, tier reconciliation). For a copy, any transformation at all
 * is a defect. `insert … select` lets Postgres carry each column across
 * untouched, so the only fields that can differ are the four this function
 * means to change.
 *
 * The column list here is the one risk: a column added to
 * `master_service_versions` later would not be copied. `msl.test.ts` guards
 * exactly that — it compares the copy against its source column-by-column from
 * `information_schema`, so the day someone adds a column and forgets this
 * list, that test goes red instead of a service quietly losing a field.
 */
export async function setActive(
  sql: Sql,
  actor: Actor,
  serviceId: string,
  active: boolean,
  now: Date = new Date(),
): Promise<number> {
  if (!canEditMasterServices(actor)) {
    throw new ForbiddenError();
  }
  const today = tz.dateString(now);
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    // Lock the chain so two concurrent archive clicks cannot both compute the
    // same `version_no` (uq_service_version would reject the loser, but with a
    // constraint name instead of a message anyone can act on).
    const cur = await tx<{ id: string; version_no: number; active: boolean; name: string }[]>`
      select id, version_no, active, name
        from master_service_versions
       where service_id = ${serviceId}
       order by effective_from desc, version_no desc
       limit 1
         for update`;
    if (cur.length === 0) {
      throw new ServiceNotFoundError(serviceId);
    }
    const latest = cur[0];
    // Already in the requested state: return the current version rather than
    // appending a version that records no change. An append-only chain full of
    // no-op versions makes the real edits unfindable, and `effective_from`
    // would move for nothing.
    if (latest.active === active) {
      return Number(latest.version_no);
    }
    const next = Number(latest.version_no) + 1;
    const inserted = await tx<{ id: string }[]>`
      insert into master_service_versions
        (service_id, name, standard_price, commission_rule, category, unit, min_qty,
         pricing_mode, apply_ppn, frequency, price_note, description, active,
         requires_strategy_plan, plan_tier, durasi_bulan, qty_menambah, pengakuan,
         version_no, effective_from, created_by)
      select service_id, name, standard_price, commission_rule, category, unit, min_qty,
             pricing_mode, apply_ppn, frequency, price_note, description, ${active},
             requires_strategy_plan, plan_tier, durasi_bulan, qty_menambah, pengakuan,
             ${next}, ${today}, ${actor.employeeId}
        from master_service_versions
       where id = ${latest.id}
      returning id`;
    // FS-6 tenor options belong to the version, so a copy that skipped them
    // would archive a multi-tenor service into a single-price one — and
    // restoring it later would bring back the wrong catalog.
    await tx`
      insert into master_service_duration_options (version_id, durasi_bulan, harga, created_by)
      select ${inserted[0].id}, durasi_bulan, harga, ${actor.employeeId}
        from master_service_duration_options
       where version_id = ${latest.id}`;
    await ex.audit.insertAudit({
      entityType: 'master_service', entityId: serviceId, actorEmployeeId: actor.employeeId,
      action: active ? 'restore' : 'archive',
      beforeJson: { version_no: Number(latest.version_no), active: latest.active },
      afterJson: { version_no: next, active, name: latest.name, effective_from: today },
      createdBy: actor.employeeId,
    });
    return next;
  });
}

/**
 * deleteService removes a master service and its whole version chain — but ONLY
 * when nothing has ever pointed at it.
 *
 * Permintaan pemilik 2026-09-10: *"Fitur untuk menghapus Master Service List
 * yang salah."* The "yang salah" is load-bearing: what the owner wants gone is
 * a mistyped catalog row, not a service the agency actually sold.
 *
 * ## Why this does not violate house rule #3 (immutable history)
 *
 * Rule #3 protects the record of what HAPPENED. A catalog row that no Service,
 * Qualified Form, proposal line or renewal line has ever referenced never took
 * part in anything: there is no money derived from it and no history to lose.
 * The moment one snapshot does point at it, delete stops being available at all
 * and archiving is the only path — which is precisely the boundary
 * `private.master_service_refs()` draws. The `delete` audit row itself is never
 * removed, so the fact that this row existed and was removed stays readable.
 *
 * ## Why the check is here AND in the database
 *
 * The TS check exists to produce a BI message carrying the counts. The trigger
 * `trg_master_services_hapus_terjaga` exists because this route is not the only
 * writer — the seeder, migrations and any operator `psql` session bypass TS
 * entirely, and `master_service_id` has no foreign key anywhere, so without the
 * trigger Postgres would accept the delete silently and leave dangling pointers
 * inside closed money rows. Neither layer is redundant: one explains, the other
 * enforces.
 *
 * Versions are deleted explicitly rather than by `ON DELETE CASCADE`, and
 * `fk_msv_service` deliberately still has no cascade: that missing cascade is a
 * second guard, making a stray `DELETE FROM master_services` fail on the
 * foreign key for any service that has ever had a version.
 */
export async function deleteService(sql: Sql, actor: Actor, serviceId: string): Promise<ServiceRefs> {
  if (!canEditMasterServices(actor)) {
    throw new ForbiddenError();
  }
  return withTransaction(sql, async (tx) => {
    const ex = executors(tx);
    const chain = await tx<{ version_no: number; name: string }[]>`
      select version_no, name from master_service_versions
       where service_id = ${serviceId} order by version_no desc for update`;
    if (chain.length === 0) {
      throw new ServiceNotFoundError(serviceId);
    }
    const refs = await serviceRefs(tx, serviceId);
    if (!refs.unused) {
      throw new ServiceInUseError(refs);
    }
    // The audit row is written BEFORE the rows disappear, so `before_json` can
    // still describe what was removed. It survives the delete — audit_log has
    // no delete path (house rule #3) — so "this catalog row existed and was
    // removed by whom, when, and how many versions it had" stays answerable.
    await ex.audit.insertAudit({
      entityType: 'master_service', entityId: serviceId, actorEmployeeId: actor.employeeId,
      action: 'delete',
      beforeJson: { versions: chain.length, name: chain[0].name, latest_version_no: Number(chain[0].version_no) },
      afterJson: null,
      createdBy: actor.employeeId,
    });
    // Duration options cascade from the version rows (fk_msdo_version
    // ON DELETE CASCADE), so they need no statement of their own.
    await tx`delete from master_service_versions where service_id = ${serviceId}`;
    await tx`delete from master_services where id = ${serviceId}`;
    return refs;
  });
}

/** nullText stores empty optional strings as SQL NULL. */
function nullText(s: string): string | null {
  return s.trim() === '' ? null : s;
}
