/**
 * MEA SKU Screener domain layer (Gelombang 3, SC-08) — the pipeline the
 * schema-only migration `20260908050000_gelombang3_sku_screener.sql` was
 * waiting for. Pure math (R01-R16) lives in `packages/core/src/skuscreener/`
 * (`@cdps/core` `skuscreener`); this module parses uploaded exports
 * SERVER-SIDE (browser only converts xlsx→AoA and hashes, same RAB-04
 * pattern as `riset-awal.ts`/`report.ts`), calls that engine, and writes the
 * four Gelombang 3 tables:
 *
 *  - **Modul A** (`runScreening`) — routing/CPC-max per SKU (R01-R06),
 *    `screening_run` row with `jenis='screening'`.
 *  - **Modul B** (`runCompare`) — before/after comparison (R09-R11),
 *    `screening_run` row with `jenis='perbandingan'`.
 *  - **Modul C** (`logDecision`) — the pre-campaign per-SKU decision ladder
 *    (R13-R16), `ads_decision_log` — APPEND-ONLY, including the
 *    `review_7_hari` follow-up row (O68, RESOLVED 2026-09-03: a new row,
 *    never an edit of the original — see `docs/DECISIONS.md`).
 *  - **Modul D** (`createTrackerRow` / `recordTrackerAfter`) —
 *    `optimization_tracker`, the ONE table here that IS mutated in place
 *    (before_* at creation, after_* / verdict filled in ≥14 days later).
 *
 * House rules honoured: IDs minted only after validation (rule 1); every
 * computed field (medians, routes, CPC max, deltas, verdicts,
 * `status_vs_target`, `roas_result`) is written as a real stored value, never
 * a formula, and is fully recomputable from `payload`/the export it was
 * built from (rule 4); Modul C append-only, Modul A/B run rows frozen (no
 * "edit a run" — a changed input is a NEW run) — DB triggers are the second
 * wall, this module's own INSERT-only shape is the first (rule 3); BI
 * `[...]` messages (rule 5); write scope mirrors M8 Ads
 * (`ads.canManageCampaign` — Ads staff/lead or Director), read scope mirrors
 * this migration's own RLS predicate exactly (`canReadAll` OR the row's own
 * creator OR one of `clients`' PIC columns OR an Ads-division lead) — see
 * `clientOwnerIds`/`canReadSku` below (rule 6).
 */
import { bi, permission, skuscreener } from '@cdps/core';
import { executors, withTransaction, type Queryable, type Sql, type TransactionSql } from '@cdps/db';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  type Actor,
} from './account';
import { ADS_DIVISION, canManageCampaign } from './ads';

// ---------------------------------------------------------------------------
// Messages (BI, house rule #5)
// ---------------------------------------------------------------------------
export const MSG_FORBIDDEN = '[Anda tidak berhak mengakses data SKU Screener ini]';
export const MSG_CLIENT_NOT_FOUND = '[klien tidak ditemukan]';
export const MSG_NO_FILES = '[unggah minimal satu berkas ekspor Performa Produk]';
export const MSG_NO_MATCH = '[tidak ada SKU yang cocok — file dari toko berbeda?]';
export const MSG_SCREENING_NOT_FOUND = '[screening run tidak ditemukan]';
export const MSG_DECISION_NOT_FOUND = '[baris decision log tidak ditemukan]';
export const MSG_TRACKER_NOT_FOUND = '[baris tracker optimasi tidak ditemukan]';
export const MSG_TRACKER_EXISTS = '[SKU ini sudah punya baris tracker pada screening run ini]';
export const MSG_REVIEW_NEEDS_TARGET = '[follow-up 7 hari wajib menunjuk ke keputusan yang di-review]';
export const MSG_NON_REVIEW_NO_TARGET = '[hanya follow-up 7 hari yang boleh menunjuk ke keputusan lain]';
export const MSG_REVIEW_TARGET_NOT_FOUND = '[keputusan yang di-review tidak ditemukan]';
export const MSG_REVIEW_TARGET_WRONG_CLIENT = '[keputusan yang di-review bukan milik klien ini]';
export const MSG_REVIEW_TARGET_IS_REVIEW = '[keputusan yang di-review tidak boleh berupa follow-up 7 hari lainnya]';
export const MSG_INVALID_PLATFORM = '[platform tidak valid]';
export const MSG_INVALID_OBJECT_TYPE = '[jenis objek tidak valid]';
export const MSG_INVALID_MOMEN = '[momen keputusan tidak valid]';
export const MSG_INVALID_SOP_STAGE = '[tahap SOP tidak valid]';
export const MSG_INVALID_DECISION = '[keputusan tidak valid]';
export const MSG_INVALID_METRIC_KEY = '[metrik kunci tidak valid]';
export const MSG_INVALID_VERDICT = '[verdict tidak valid]';
export const MSG_INVALID_INITIAL_ROUTE = '[rute awal tidak valid]';

// ---------------------------------------------------------------------------
// Authorization — mirrors this migration's own RLS predicate (see file header).
// ---------------------------------------------------------------------------
/** Write scope: Ads staff/lead or Director — same actors the PRD's "Advertiser"/"Lead Advertiser" map to (reuses M8's gate). */
export function canWriteSku(actor: Actor): boolean {
  return canManageCampaign(actor);
}

/** Read scope: OD/Director, the row's own creator, one of the client's PIC columns (`jwt_owns_client`), or an Ads-division lead. */
export function canReadSku(actor: Actor, createdBy: string | null, clientOwners: ReadonlySet<string>): boolean {
  if (permission.canReadAll(actor)) return true;
  if (createdBy !== null && actor.employeeId === createdBy) return true;
  if (clientOwners.has(actor.employeeId)) return true;
  return permission.isLead(actor, ADS_DIVISION);
}

/** True when the actor may read ANY row for this client regardless of who created it (used to decide whether a list query needs a created_by filter). */
function hasBroadReadAccess(actor: Actor, clientOwners: ReadonlySet<string>): boolean {
  return permission.canReadAll(actor) || clientOwners.has(actor.employeeId) || permission.isLead(actor, ADS_DIVISION);
}

/** Mirrors `jwt_owns_client`: the client's sales PIC, assigned AM, commission PIC, or creator. */
async function clientOwnerIds(sql: Queryable, clientId: string): Promise<Set<string>> {
  const rows = await sql<{ sales_pic_id: string | null; assigned_am_id: string | null; commission_payment_pic_id: string | null; created_by: string }[]>`
    select sales_pic_id, assigned_am_id, commission_payment_pic_id, created_by from clients where id = ${clientId}`;
  if (rows.length === 0) throw new NotFoundError(MSG_CLIENT_NOT_FOUND);
  const r = rows[0];
  return new Set([r.sales_pic_id, r.assigned_am_id, r.commission_payment_pic_id, r.created_by].filter((x): x is string => !!x));
}

// ---------------------------------------------------------------------------
// Small local helpers (same pattern as report.ts — module-local, not shared).
// ---------------------------------------------------------------------------
function isoTs(v: unknown): string {
  return v instanceof Date ? v.toISOString() : String(v);
}
function dateStr(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}
function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function numOf(v: unknown): number {
  return numOrNull(v) ?? 0;
}
/** JSON.stringify-friendly: a JS `NaN`/`Infinity` (house "no basis" sentinel throughout `@cdps/core` skuscreener) becomes explicit `null`, never silently dropped or coerced to 0 (rule 7 / rule "null eksplisit"). */
function finiteOrNull(n: number): number | null {
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// Modul A — runScreening (routing/CPC-max, R01-R06)
// ---------------------------------------------------------------------------
export interface ScreeningBerkasInput {
  namaBerkas: string;
  sha256: string;
  ukuranBytes: number;
  peran: 'performa_produk' | 'iklan_cpc';
}

export interface RunScreeningInput {
  clientId: string;
  /** "Bisnis Saya → Performa Produk" export, browser-parsed to named sheets (A2). */
  sheets: skuscreener.NamedSheet[];
  /** Optional "Laporan Iklan Produk/CPC" export, browser-parsed to CSV rows (A1). */
  adsCsvRows?: readonly (readonly unknown[])[] | null;
  targetRoas: number;
  cpcPasarKategori?: number | null;
  /** CR iklan ÷ CR organik. PRD default 1.0 (A09). */
  faktorCrIklan?: number;
  berkas: ScreeningBerkasInput[];
}

interface SkuClassified extends skuscreener.SkuRecord, skuscreener.ClassifySkuResult {}

export interface ScreeningRunSummary {
  id: string;
  clientId: string;
  jenis: 'screening' | 'perbandingan';
  createdAt: string;
  createdBy: string;
}

export interface ScreeningRunDetail extends ScreeningRunSummary {
  targetRoas: number | null;
  cpcPasarKategori: number | null;
  faktorCrIklan: number | null;
  minKlikSesudah: number | null;
  payload: unknown;
  sumberBerkas: unknown;
}

function rowToScreeningSummary(r: Record<string, unknown>): ScreeningRunSummary {
  return {
    id: r.id as string,
    clientId: r.client_id as string,
    jenis: r.jenis as 'screening' | 'perbandingan',
    createdAt: isoTs(r.created_at),
    createdBy: r.created_by as string,
  };
}
function rowToScreeningDetail(r: Record<string, unknown>): ScreeningRunDetail {
  return {
    ...rowToScreeningSummary(r),
    targetRoas: numOrNull(r.target_roas),
    cpcPasarKategori: numOrNull(r.cpc_pasar_kategori),
    faktorCrIklan: numOrNull(r.faktor_cr_iklan),
    minKlikSesudah: numOrNull(r.min_klik_sesudah),
    payload: r.payload ?? null,
    sumberBerkas: r.sumber_berkas ?? null,
  };
}

/** Every R05 route/R06 override label, for the payload's route-count summary. */
const RINGKASAN_LABELS = [
  'SCALE', 'KANDIDAT IKLAN', 'OPTIMASI GAMBAR/JUDUL', 'OPTIMASI DESKRIPSI/HARGA', 'PARKIR',
  skuscreener.LABEL_TAHAN_CPC_RENDAH, skuscreener.LABEL_ANTI_RULE,
] as const;

function toParseError(e: unknown): ValidationError {
  if (e instanceof skuscreener.SkuScreenerParseError) return new ValidationError(`[${e.message}]`);
  throw e;
}

export async function runScreening(sql: Sql, actor: Actor, input: RunScreeningInput): Promise<ScreeningRunDetail> {
  const now = new Date();
  return withTransaction(sql, async (tx) => {
    if (!canWriteSku(actor)) throw new ForbiddenError(MSG_FORBIDDEN);
    // Write gate is division-based (canWriteSku), not client-ownership — this
    // call is only here to 404 an unknown client before any parsing work.
    await clientOwnerIds(tx, input.clientId);

    const rv = skuscreener.validateTargetRoas(input.targetRoas);
    if (!rv.ok) throw new ValidationError(rv.message);
    if (!input.sheets || input.sheets.length === 0) throw new ValidationError(MSG_NO_FILES);

    let skus: skuscreener.SkuRecord[];
    try {
      skus = skuscreener.readPerformaProduk(input.sheets);
    } catch (e) {
      throw toParseError(e);
    }

    let cpcAktual: number | null = null;
    if (input.adsCsvRows && input.adsCsvRows.length > 0) {
      try {
        cpcAktual = skuscreener.readAdsCpc(input.adsCsvRows);
      } catch (e) {
        throw toParseError(e);
      }
    }

    const medCtr = skuscreener.medianCtr(skus.map((s) => ({ views: s.views, ctr: s.ctr })));
    const medCr = skuscreener.medianCr(skus.map((s) => ({ clicks: s.clicks, cr: s.cr })));
    const medViews = skuscreener.medianViews(skus);
    const medians: skuscreener.RouteMedians = { ctr: medCtr.effectiveMedian, cr: medCr.effectiveMedian, views: medViews };

    const faktorCrIklan = input.faktorCrIklan ?? 1.0;
    const cpcPasar = input.cpcPasarKategori ?? null;

    const classified: SkuClassified[] = skus.map((s) => ({
      ...s,
      ...skuscreener.classifySku(
        { ctr: s.ctr, cr: s.cr, views: s.views, aov: s.aov },
        medians,
        { faktorCrIklan, targetRoas: rv.value, cpcPasar },
      ),
    }));

    const ringkasan: Record<string, number> = Object.fromEntries(RINGKASAN_LABELS.map((l) => [l, 0]));
    for (const s of classified) ringkasan[s.label] = (ringkasan[s.label] ?? 0) + 1;

    // Sorted by CPC Maksimum descending (Flow A5), NaN (no basis) sorts last.
    const sortedSkus = [...classified].sort((a, b) => {
      const av = Number.isFinite(a.cpcMax) ? a.cpcMax : -Infinity;
      const bv = Number.isFinite(b.cpcMax) ? b.cpcMax : -Infinity;
      return bv - av;
    });

    const payload = {
      schema: 'cdps.skuscreener.screening.v1' as const,
      medians: {
        ctr: medians.ctr, cr: medians.cr, views: medians.views,
        ctrRaw: medCtr.rawMedian, crRaw: medCr.rawMedian,
        ctrThreshold: medCtr.threshold, crThreshold: medCr.threshold,
        ctrSampleSize: medCtr.sampleSize, crSampleSize: medCr.sampleSize,
        ctrReachedFloor: medCtr.reachedAbsoluteFloor, crReachedFloor: medCr.reachedAbsoluteFloor,
      },
      cpcAktual,
      targetRoas: rv.value,
      faktorCrIklan,
      cpcPasarKategori: cpcPasar,
      ringkasan,
      skus: sortedSkus.map((s) => ({
        kode: s.kode, produk: s.produk, gmv: s.gmv, orders: s.orders, views: s.views, clicks: s.clicks,
        ctr: finiteOrNull(s.ctr), cr: finiteOrNull(s.cr), aov: finiteOrNull(s.aov),
        baseRoute: s.baseRoute, label: s.label, isAntiRule: s.isAntiRule, isTahanCpcRendah: s.isTahanCpcRendah,
        cpcMax: finiteOrNull(s.cpcMax),
        marketCpcRatio: s.marketCpc.ratio, marketCpcVerdict: s.marketCpc.verdict,
      })),
    };

    const ex = executors(tx);
    const id = await ex.ident.identNext('SCR', now);
    await tx`
      insert into screening_run
        (id, client_id, jenis, target_roas, cpc_pasar_kategori, faktor_cr_iklan, payload, sumber_berkas, created_by)
      values
        (${id}, ${input.clientId}, 'screening', ${rv.value}, ${cpcPasar}, ${faktorCrIklan},
         ${tx.json(payload)}, ${tx.json(input.berkas.map((b) => ({ nama_berkas: b.namaBerkas, sha256: b.sha256, ukuran_bytes: b.ukuranBytes, peran: b.peran })))},
         ${actor.employeeId})`;
    await ex.audit.insertAudit({
      entityType: 'screening_run', entityId: id, actorEmployeeId: actor.employeeId, action: 'screening_run_created',
      beforeJson: null, afterJson: { client_id: input.clientId, jenis: 'screening', n_sku: skus.length, ringkasan },
      createdBy: actor.employeeId,
    });
    return getScreeningRunById(tx, id);
  });
}

// ---------------------------------------------------------------------------
// Modul B — runCompare (before/after, R09-R11)
// ---------------------------------------------------------------------------
export interface RunCompareInput {
  clientId: string;
  sheetsBefore: skuscreener.NamedSheet[];
  sheetsAfter: skuscreener.NamedSheet[];
  minKlikSesudah?: number;
  berkas: ScreeningBerkasInput[]; // peran: 'sebelum' | 'sesudah'
}

export async function runCompare(sql: Sql, actor: Actor, input: RunCompareInput): Promise<ScreeningRunDetail> {
  const now = new Date();
  return withTransaction(sql, async (tx) => {
    if (!canWriteSku(actor)) throw new ForbiddenError(MSG_FORBIDDEN);
    await clientOwnerIds(tx, input.clientId); // 404s an unknown client

    if (!input.sheetsBefore?.length || !input.sheetsAfter?.length) throw new ValidationError(MSG_NO_FILES);
    const minKlik = input.minKlikSesudah ?? 20;

    let before: skuscreener.SkuRecord[];
    let after: skuscreener.SkuRecord[];
    try {
      before = skuscreener.readPerformaProduk(input.sheetsBefore);
      after = skuscreener.readPerformaProduk(input.sheetsAfter);
    } catch (e) {
      throw toParseError(e);
    }

    const pairs = skuscreener.matchSkus(before, after);
    if (pairs.length === 0) throw new ValidationError(MSG_NO_MATCH);

    const results = pairs.map((p) => {
      const cmp = skuscreener.compareBeforeAfter(
        { views: p.before.views, clicks: p.before.clicks, ctr: p.before.ctr, cr: p.before.cr, orders: p.before.orders, gmv: p.before.gmv },
        { views: p.after.views, clicks: p.after.clicks, ctr: p.after.ctr, cr: p.after.cr, orders: p.after.orders, gmv: p.after.gmv },
        minKlik,
      );
      return { key: p.key, kode: p.after.kode, produk: p.after.produk, before: p.before, after: p.after, ...cmp };
    });

    const ringkasan = { MEMBAIK: 0, 'TIDAK BERUBAH': 0, MEMBURUK: 0, 'BELUM CUKUP DATA': 0 } as Record<skuscreener.CompareVerdict, number>;
    for (const r of results) ringkasan[r.verdict]++;

    // Sorted by delta CR descending (Flow B3), NaN sorts last.
    const sorted = [...results].sort((a, b) => {
      const av = Number.isFinite(a.deltaCrPct) ? a.deltaCrPct : -Infinity;
      const bv = Number.isFinite(b.deltaCrPct) ? b.deltaCrPct : -Infinity;
      return bv - av;
    });

    const payload = {
      schema: 'cdps.skuscreener.perbandingan.v1' as const,
      minKlikSesudah: minKlik,
      ringkasan,
      pairs: sorted.map((r) => ({
        kode: r.kode, produk: r.produk,
        before: { views: r.before.views, clicks: r.before.clicks, ctr: finiteOrNull(r.before.ctr), cr: finiteOrNull(r.before.cr), orders: r.before.orders, gmv: r.before.gmv },
        after: { views: r.after.views, clicks: r.after.clicks, ctr: finiteOrNull(r.after.ctr), cr: finiteOrNull(r.after.cr), orders: r.after.orders, gmv: r.after.gmv },
        deltaCtrPct: finiteOrNull(r.deltaCtrPct), deltaCrPct: finiteOrNull(r.deltaCrPct),
        deltaViewsPct: finiteOrNull(r.deltaViewsPct), deltaGmvPct: finiteOrNull(r.deltaGmvPct),
        verdict: r.verdict,
        // Flow B4: a MEMBAIK row carries the recommendation text.
        rekomendasi: r.verdict === 'MEMBAIK' ? 'Direkomendasikan: naikkan budget +30%' : null,
      })),
    };

    const ex = executors(tx);
    const id = await ex.ident.identNext('SCR', now);
    await tx`
      insert into screening_run
        (id, client_id, jenis, min_klik_sesudah, payload, sumber_berkas, created_by)
      values
        (${id}, ${input.clientId}, 'perbandingan', ${minKlik},
         ${tx.json(payload)}, ${tx.json(input.berkas.map((b) => ({ nama_berkas: b.namaBerkas, sha256: b.sha256, ukuran_bytes: b.ukuranBytes, peran: b.peran })))},
         ${actor.employeeId})`;
    await ex.audit.insertAudit({
      entityType: 'screening_run', entityId: id, actorEmployeeId: actor.employeeId, action: 'screening_run_created',
      beforeJson: null, afterJson: { client_id: input.clientId, jenis: 'perbandingan', n_pairs: pairs.length, ringkasan },
      createdBy: actor.employeeId,
    });
    return getScreeningRunById(tx, id);
  });
}

// ---------------------------------------------------------------------------
// Modul C — logDecision (ads_decision_log, R13-R16, APPEND-ONLY)
// ---------------------------------------------------------------------------
const VALID_PLATFORMS = new Set(['Shopee', 'TikTok', 'Meta', 'Google']);
const VALID_OBJECT_TYPES = new Set(['SKU', 'Kampanye', 'Kreator', 'Konten']);
const VALID_MOMEN = new Set(['masuk_iklan', 'mulai_test', 'scale_turun_kill', 'jeda_restart', 'review_7_hari']);
const VALID_SOP_STAGE = new Set(['1-Screening SKU', '2-Setup Test', '3-Evaluasi', '4-Scale', '5-Kill']);
const VALID_DECISION = new Set([
  'Loloskan ke iklan', 'Tolak', 'Mulai test', 'Naikkan budget', 'Turunkan budget',
  'Ubah target ROAS', 'Ganti kreatif', 'Pause', 'Biarkan', 'Eskalasi ke lead',
]);
const VALID_METRIC_KEY = new Set(['ROAS', 'ACOS', 'CTR', 'CR', 'GMV', 'Biaya per konversi', 'Pesanan', 'Views']);
const VALID_VERDICT = new Set(['Berhasil', 'Gagal', 'Belum cukup data']);

export type StatusVsTarget = 'SESUAI' | 'DI BAWAH TARGET' | 'DI ATAS TARGET';

/**
 * C2: "Hitung kolom Status vs Target otomatis ... berdasarkan arah metrik."
 * The PRD gives no tolerance band for this specific column (distinct from
 * R15's ROAS-only zone ladder, a separate advisory concept) — implemented
 * here as the plain literal comparison of the two numbers, which is the only
 * reading that needs no invented threshold: `SESUAI` on exact equality,
 * `DI ATAS`/`DI BAWAH TARGET` otherwise. Flagged here (not silently decided)
 * per the same class of judgment call as `compare.ts`'s `MSG_DUA_JENIS_PERUBAHAN`.
 */
export function statusVsTarget(value: number, target: number): StatusVsTarget {
  if (value === target) return 'SESUAI';
  return value > target ? 'DI ATAS TARGET' : 'DI BAWAH TARGET';
}

/** R14: premature = NONE of (≥50 klik, ≥3 konversi, ≥3 hari jalan) met. */
export function isPremature(klik: number, konversi: number, hariJalan: number): boolean {
  return !(klik >= 50 || konversi >= 3 || hariJalan >= 3);
}

export interface LogDecisionInput {
  clientId: string;
  screeningId?: string | null;
  /** Employee id of the advertiser this decision belongs to — defaults to the actor logging it. */
  advertiserId?: string | null;
  platform: string;
  objectType: string;
  objectName: string;
  momen: string;
  sopStage: string;
  decision: string;
  metricKey: string;
  metricValue: number;
  metricTarget: number;
  spend7d?: number | null;
  gmv7d?: number | null;
  verdict?: string | null;
  /** Only for `momen='review_7_hari'` — the ADL- row this follow-up completes. */
  reviewsDecisionId?: string | null;
  /** R14 support data (klik/konversi/hari berjalan) — used ONLY to compute `premature`; not persisted as separate columns (schema stores the flag, not the raw counts). Omit for a fresh `masuk_iklan` decision with no run history yet — premature then defaults to false. */
  dataPendukung?: { klik: number; konversi: number; hariJalan: number } | null;
  notes?: string | null;
}

export interface DecisionLogEntry {
  id: string;
  clientId: string;
  screeningId: string | null;
  advertiserId: string;
  platform: string;
  objectType: string;
  objectName: string;
  momen: string;
  sopStage: string;
  decision: string;
  metricKey: string;
  metricValue: number;
  metricTarget: number;
  statusVsTarget: StatusVsTarget;
  spend7d: number | null;
  gmv7d: number | null;
  roasResult: number | null;
  verdict: string | null;
  reviewsDecisionId: string | null;
  premature: boolean;
  notes: string | null;
  createdAt: string;
  createdBy: string;
}

function rowToDecision(r: Record<string, unknown>): DecisionLogEntry {
  return {
    id: r.id as string,
    clientId: r.client_id as string,
    screeningId: (r.screening_id as string | null) ?? null,
    advertiserId: r.advertiser_id as string,
    platform: r.platform as string,
    objectType: r.object_type as string,
    objectName: r.object_name as string,
    momen: r.momen as string,
    sopStage: r.sop_stage as string,
    decision: r.decision as string,
    metricKey: r.metric_key as string,
    metricValue: numOf(r.metric_value),
    metricTarget: numOf(r.metric_target),
    statusVsTarget: r.status_vs_target as StatusVsTarget,
    spend7d: numOrNull(r.spend_7d),
    gmv7d: numOrNull(r.gmv_7d),
    roasResult: numOrNull(r.roas_result),
    verdict: (r.verdict as string | null) ?? null,
    reviewsDecisionId: (r.reviews_decision_id as string | null) ?? null,
    premature: Boolean(r.premature),
    notes: (r.notes as string | null) ?? null,
    createdAt: isoTs(r.created_at),
    createdBy: r.created_by as string,
  };
}

export async function logDecision(sql: Sql, actor: Actor, input: LogDecisionInput): Promise<DecisionLogEntry> {
  const now = new Date();
  return withTransaction(sql, async (tx) => {
    if (!canWriteSku(actor)) throw new ForbiddenError(MSG_FORBIDDEN);
    await clientOwnerIds(tx, input.clientId); // 404s an unknown client

    const objectName = (input.objectName ?? '').trim();
    if (objectName === '' || !Number.isFinite(input.metricValue) || !Number.isFinite(input.metricTarget)) {
      throw new ValidationError(bi.INCOMPLETE_DATA);
    }
    if (!VALID_PLATFORMS.has(input.platform)) throw new ValidationError(MSG_INVALID_PLATFORM);
    if (!VALID_OBJECT_TYPES.has(input.objectType)) throw new ValidationError(MSG_INVALID_OBJECT_TYPE);
    if (!VALID_MOMEN.has(input.momen)) throw new ValidationError(MSG_INVALID_MOMEN);
    if (!VALID_SOP_STAGE.has(input.sopStage)) throw new ValidationError(MSG_INVALID_SOP_STAGE);
    if (!VALID_DECISION.has(input.decision)) throw new ValidationError(MSG_INVALID_DECISION);
    if (!VALID_METRIC_KEY.has(input.metricKey)) throw new ValidationError(MSG_INVALID_METRIC_KEY);
    if (input.verdict != null && !VALID_VERDICT.has(input.verdict)) throw new ValidationError(MSG_INVALID_VERDICT);

    // ck_adl_review_shape: (momen='review_7_hari') === (reviews_decision_id IS NOT NULL).
    const isReview = input.momen === 'review_7_hari';
    if (isReview && !input.reviewsDecisionId) throw new ValidationError(MSG_REVIEW_NEEDS_TARGET);
    if (!isReview && input.reviewsDecisionId) throw new ValidationError(MSG_NON_REVIEW_NO_TARGET);
    if (isReview && input.reviewsDecisionId) {
      const target = await tx<{ client_id: string; momen: string }[]>`
        select client_id, momen from ads_decision_log where id = ${input.reviewsDecisionId}`;
      if (target.length === 0) throw new NotFoundError(MSG_REVIEW_TARGET_NOT_FOUND);
      if (target[0].client_id !== input.clientId) throw new ValidationError(MSG_REVIEW_TARGET_WRONG_CLIENT);
      if (target[0].momen === 'review_7_hari') throw new ValidationError(MSG_REVIEW_TARGET_IS_REVIEW);
    }

    const premature = input.dataPendukung
      ? isPremature(input.dataPendukung.klik, input.dataPendukung.konversi, input.dataPendukung.hariJalan)
      : false;

    const status = statusVsTarget(input.metricValue, input.metricTarget);
    const spend = input.spend7d ?? null;
    const gmv = input.gmv7d ?? null;
    // House rule #7: no basis (spend absent/0) → null, never 0 or Infinity.
    const roasResult = spend != null && spend > 0 && gmv != null ? gmv / spend : null;

    const advertiserId = (input.advertiserId ?? '').trim() || actor.employeeId;
    const ex = executors(tx);
    const id = await ex.ident.identNext('ADL', now);
    await tx`
      insert into ads_decision_log
        (id, client_id, screening_id, advertiser_id, platform, object_type, object_name, momen, sop_stage,
         decision, metric_key, metric_value, metric_target, status_vs_target, spend_7d, gmv_7d, roas_result,
         verdict, reviews_decision_id, premature, notes, created_by)
      values
        (${id}, ${input.clientId}, ${input.screeningId ?? null}, ${advertiserId}, ${input.platform}, ${input.objectType},
         ${objectName}, ${input.momen}, ${input.sopStage}, ${input.decision}, ${input.metricKey},
         ${input.metricValue}, ${input.metricTarget}, ${status}, ${spend}, ${gmv}, ${roasResult},
         ${input.verdict ?? null}, ${input.reviewsDecisionId ?? null}, ${premature},
         ${(input.notes ?? '').trim() || null}, ${actor.employeeId})`;
    await ex.audit.insertAudit({
      entityType: 'ads_decision_log', entityId: id, actorEmployeeId: actor.employeeId, action: 'decision_logged',
      beforeJson: null,
      afterJson: { client_id: input.clientId, momen: input.momen, decision: input.decision, status_vs_target: status, premature },
      createdBy: actor.employeeId,
    });
    const row = await tx<Record<string, unknown>[]>`select * from ads_decision_log where id = ${id}`;
    return rowToDecision(row[0]);
  });
}

// ---------------------------------------------------------------------------
// Modul D — optimization_tracker (mutable: before at creation, after ≥14d later)
// ---------------------------------------------------------------------------
const VALID_INITIAL_ROUTE = new Set(['SCALE', 'KANDIDAT IKLAN', 'OPTIMASI GAMBAR/JUDUL', 'OPTIMASI DESKRIPSI/HARGA', 'PARKIR']);

export interface TrackerMetrics {
  views: number;
  clicks: number;
  ctr: number;
  cr: number;
  orders: number;
}

export interface CreateTrackerInput {
  screeningId: string;
  clientId: string;
  productCode?: string | null;
  productName: string;
  changeDate: string; // YYYY-MM-DD
  initialRoute: string;
  changeType: skuscreener.ChangeType;
  before: TrackerMetrics;
  notes?: string | null;
}

export interface TrackerRow {
  screeningId: string;
  productCode: string;
  productName: string;
  clientId: string;
  changeDate: string;
  initialRoute: string;
  changeType: string;
  metricEvaluated: 'CTR' | 'CR';
  before: TrackerMetrics;
  after: TrackerMetrics | null;
  deltaCtrPct: number | null;
  deltaCrPct: number | null;
  deltaMetricPct: number | null;
  verdict: string;
  budgetDecision: string | null;
  notes: string | null;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
}

function rowToTracker(r: Record<string, unknown>): TrackerRow {
  const hasAfter = r.after_views != null;
  return {
    screeningId: r.screening_id as string,
    productCode: r.product_code as string,
    productName: r.product_name as string,
    clientId: r.client_id as string,
    changeDate: dateStr(r.change_date),
    initialRoute: r.initial_route as string,
    changeType: r.change_type as string,
    metricEvaluated: r.metric_evaluated as 'CTR' | 'CR',
    before: {
      views: numOf(r.before_views), clicks: numOf(r.before_clicks),
      ctr: numOf(r.before_ctr), cr: numOf(r.before_cr), orders: numOf(r.before_orders),
    },
    after: hasAfter ? {
      views: numOf(r.after_views), clicks: numOf(r.after_clicks),
      ctr: numOf(r.after_ctr), cr: numOf(r.after_cr), orders: numOf(r.after_orders),
    } : null,
    deltaCtrPct: numOrNull(r.delta_ctr_pct),
    deltaCrPct: numOrNull(r.delta_cr_pct),
    deltaMetricPct: numOrNull(r.delta_metric_pct),
    verdict: r.verdict as string,
    budgetDecision: (r.budget_decision as string | null) ?? null,
    notes: (r.notes as string | null) ?? null,
    createdAt: isoTs(r.created_at),
    createdBy: r.created_by as string,
    updatedAt: isoTs(r.updated_at),
  };
}

/** D1/D2 — create a tracker row from Modul A's OPTIMASI-route output, `before_*` only. */
export async function createTrackerRow(sql: Sql, actor: Actor, input: CreateTrackerInput): Promise<TrackerRow> {
  return withTransaction(sql, async (tx) => {
    if (!canWriteSku(actor)) throw new ForbiddenError(MSG_FORBIDDEN);
    await clientOwnerIds(tx, input.clientId); // 404s an unknown client
    if (!VALID_INITIAL_ROUTE.has(input.initialRoute)) throw new ValidationError(MSG_INVALID_INITIAL_ROUTE);
    if (!skuscreener.CHANGE_TYPES.includes(input.changeType)) throw new ValidationError(bi.INCOMPLETE_DATA);

    const scr = await tx<{ id: string }[]>`select id from screening_run where id = ${input.screeningId}`;
    if (scr.length === 0) throw new NotFoundError(MSG_SCREENING_NOT_FOUND);

    const productName = (input.productName ?? '').trim();
    if (productName === '') throw new ValidationError(bi.INCOMPLETE_DATA);
    // R09 resolved key — the same value Modul B's own matching would compute,
    // so a tracker row and a Modul B match always agree on identity.
    const productCode = skuscreener.skuKey(input.productCode ?? '', productName);
    const metricEvaluated = skuscreener.metricEvaluatedFor(input.changeType);

    try {
      await tx`
        insert into optimization_tracker
          (screening_id, product_code, product_name, client_id, change_date, initial_route, change_type,
           metric_evaluated, before_views, before_clicks, before_ctr, before_cr, before_orders,
           notes, created_by)
        values
          (${input.screeningId}, ${productCode}, ${productName}, ${input.clientId}, ${input.changeDate},
           ${input.initialRoute}, ${input.changeType}, ${metricEvaluated},
           ${input.before.views}, ${input.before.clicks}, ${input.before.ctr}, ${input.before.cr}, ${input.before.orders},
           ${(input.notes ?? '').trim() || null}, ${actor.employeeId})`;
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictError(MSG_TRACKER_EXISTS);
      throw e;
    }
    const row = await tx<Record<string, unknown>[]>`
      select * from optimization_tracker where screening_id = ${input.screeningId} and product_code = ${productCode}`;
    return rowToTracker(row[0]);
  });
}

export interface RecordTrackerAfterInput {
  screeningId: string;
  productCode: string;
  after: TrackerMetrics;
  minKlikSesudah?: number;
  budgetDecision?: string | null;
}

/** D3/D4 — fill `after_*`, compute delta/verdict via `evaluateOptimization` (R12). The only mutable write in this module. */
export async function recordTrackerAfter(sql: Sql, actor: Actor, input: RecordTrackerAfterInput): Promise<TrackerRow> {
  return withTransaction(sql, async (tx) => {
    if (!canWriteSku(actor)) throw new ForbiddenError(MSG_FORBIDDEN);
    const rows = await tx<Record<string, unknown>[]>`
      select * from optimization_tracker where screening_id = ${input.screeningId} and product_code = ${input.productCode} for update`;
    if (rows.length === 0) throw new NotFoundError(MSG_TRACKER_NOT_FOUND);
    const r = rows[0];

    const before: skuscreener.OptimizationMetrics = {
      views: numOf(r.before_views), clicks: numOf(r.before_clicks),
      ctr: numOf(r.before_ctr), cr: numOf(r.before_cr), orders: numOf(r.before_orders),
    };
    const changeType = r.change_type as skuscreener.ChangeType;
    const evalResult = skuscreener.evaluateOptimization(changeType, before, input.after, input.minKlikSesudah ?? 20);
    const deltaCtr = skuscreener.relDeltaPct(before.ctr, input.after.ctr);
    const deltaCr = skuscreener.relDeltaPct(before.cr, input.after.cr);

    await tx`
      update optimization_tracker
         set after_views = ${input.after.views}, after_clicks = ${input.after.clicks},
             after_ctr = ${input.after.ctr}, after_cr = ${input.after.cr}, after_orders = ${input.after.orders},
             delta_ctr_pct = ${finiteOrNull(deltaCtr)}, delta_cr_pct = ${finiteOrNull(deltaCr)},
             delta_metric_pct = ${finiteOrNull(evalResult.deltaMetricPct)}, verdict = ${evalResult.verdict},
             budget_decision = ${input.budgetDecision ?? null}
       where screening_id = ${input.screeningId} and product_code = ${input.productCode}`;
    const ex = executors(tx);
    await ex.audit.insertAudit({
      entityType: 'optimization_tracker', entityId: `${input.screeningId}:${input.productCode}`,
      actorEmployeeId: actor.employeeId, action: 'tracker_after_recorded',
      beforeJson: { after_recorded: false },
      afterJson: { verdict: evalResult.verdict, metric_evaluated: evalResult.metricEvaluated, delta_metric_pct: finiteOrNull(evalResult.deltaMetricPct) },
      createdBy: actor.employeeId,
    });
    const updated = await tx<Record<string, unknown>[]>`
      select * from optimization_tracker where screening_id = ${input.screeningId} and product_code = ${input.productCode}`;
    return rowToTracker(updated[0]);
  });
}

// ---------------------------------------------------------------------------
// Reads — scope-gated (mirrors this migration's own RLS SELECT policy).
// ---------------------------------------------------------------------------
function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === '23505';
}

async function getScreeningRunById(sql: Queryable, id: string): Promise<ScreeningRunDetail> {
  const rows = await sql<Record<string, unknown>[]>`select * from screening_run where id = ${id}`;
  if (rows.length === 0) throw new NotFoundError(MSG_SCREENING_NOT_FOUND);
  return rowToScreeningDetail(rows[0]);
}

export async function getScreeningRun(sql: Queryable, actor: Actor, id: string): Promise<ScreeningRunDetail> {
  const rows = await sql<Record<string, unknown>[]>`select * from screening_run where id = ${id}`;
  if (rows.length === 0) throw new NotFoundError(MSG_SCREENING_NOT_FOUND);
  const r = rows[0];
  const owners = await clientOwnerIds(sql, r.client_id as string);
  if (!canReadSku(actor, r.created_by as string, owners)) throw new ForbiddenError(MSG_FORBIDDEN);
  return rowToScreeningDetail(r);
}

export async function listScreeningRuns(sql: Queryable, actor: Actor, clientId: string, jenis?: 'screening' | 'perbandingan'): Promise<ScreeningRunSummary[]> {
  const owners = await clientOwnerIds(sql, clientId);
  const broad = hasBroadReadAccess(actor, owners);
  const rows = await sql<Record<string, unknown>[]>`
    select id, client_id, jenis, created_at, created_by from screening_run
     where client_id = ${clientId}
       and (${broad} or created_by = ${actor.employeeId})
       and (${jenis ?? null}::text is null or jenis = ${jenis ?? null})
     order by created_at desc`;
  return rows.map(rowToScreeningSummary);
}

export async function listDecisions(sql: Queryable, actor: Actor, clientId: string): Promise<DecisionLogEntry[]> {
  const owners = await clientOwnerIds(sql, clientId);
  const broad = hasBroadReadAccess(actor, owners);
  const rows = await sql<Record<string, unknown>[]>`
    select * from ads_decision_log
     where client_id = ${clientId}
       and (${broad} or created_by = ${actor.employeeId} or advertiser_id = ${actor.employeeId})
     order by created_at desc`;
  return rows.map(rowToDecision);
}

export async function listTrackerRows(sql: Queryable, actor: Actor, screeningId: string): Promise<TrackerRow[]> {
  const head = await sql<{ client_id: string }[]>`select client_id from screening_run where id = ${screeningId}`;
  if (head.length === 0) throw new NotFoundError(MSG_SCREENING_NOT_FOUND);
  const owners = await clientOwnerIds(sql, head[0].client_id);
  const broad = hasBroadReadAccess(actor, owners);
  const rows = await sql<Record<string, unknown>[]>`
    select * from optimization_tracker
     where screening_id = ${screeningId}
       and (${broad} or created_by = ${actor.employeeId})
     order by change_date desc, product_code`;
  return rows.map(rowToTracker);
}
