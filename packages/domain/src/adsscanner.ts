/**
 * TikTok Ads Scanner domain layer (Gelombang 4, AS-01..AS-04) — the storage
 * pipeline the pure engine has been waiting for. Math lives in
 * `packages/core/src/adsscanner/tiktok/` (`@cdps/core` `adsscanner.tiktok`,
 * payload `cdps.adsscanner.tiktok.v1`, landed under O67 with ZERO
 * migration/domain/route); this module parses uploaded exports SERVER-SIDE
 * (browser only converts xlsx→AoA and hashes — the RAB-04 pattern shared with
 * `report.ts`/`skuscreener.ts`), calls that engine, and writes the ONE
 * Gelombang 4 table `adsscanner_run` (migration `20260910010000`).
 *
 * ## Kenapa satu tabel, dan kenapa bukan `client_reports`
 *
 * O69 (RESOLVED 2026-09-03, `docs/DECISIONS.md`): the tool's multi-client
 * portfolio — `localStorage` `state.clients` in the original HTML — becomes a
 * NEW CDPS table mirroring `screening_run`, not a mapping onto
 * `clients`/`client_reports`. The migration's header carries the three
 * standing reasons; the one that matters to a reader of THIS file: an Ads
 * Scanner run says which SKUs to scale, which to kill, and how to move
 * budget between them. That is internal bidding strategy. `client_reports`
 * rows have a Client Portal surface (`client_report_publikasi` +
 * `GET /client-portal/reports/{id}/html`), so putting scans there would put
 * one publication gate between an advertiser's working notes and the client
 * reading them. There is deliberately NO portal path to `adsscanner_run`.
 *
 * ## Bentuk yang ditegakkan di sini
 *
 * House rules honoured: IDs minted only AFTER validation passes (rule 1 —
 * `identNext('ASR')` is the last thing before the INSERT, never before
 * parsing); every derived field (skor, bucket, gate, realokasi, medians,
 * ROI/CPA/CTR/CTOR) is computed by the engine and stored as a real value,
 * recomputable from `payload` + the recorded `benchmark_versi` (rule 4); the
 * whole row is frozen — a changed input is a NEW scan, never an edited old
 * one, enforced by DB trigger as the second wall and by this module being
 * INSERT-only as the first (rule 3); BI `[...]` messages (rule 5); write
 * scope mirrors M8 Ads (`ads.canManageCampaign` — Ads staff/lead or
 * Director), read scope mirrors the migration's OWN RLS predicate exactly
 * (`canReadAll` OR the row's creator OR one of `clients`' PIC columns OR an
 * Ads-division lead) — see `canReadAdsScan` (rule 6).
 *
 * ## Dua gerbang validasi yang SENGAJA menolak, bukan mendegradasi diam-diam
 *
 *  1. **Kategori tak dikenali ditolak.** `adsscanner.tiktok.benchOf` returns
 *     an all-null benchmark row for an unknown category, and `skor.ts`
 *     correctly excludes unmeasurable components — so an unknown category
 *     still produces a plausible-looking score, just one silently missing its
 *     ROI and GPM components. That is the worst outcome available (a number
 *     that looks comparable but isn't), so a category absent from the active
 *     benchmark is a 400, not a quiet re-normalisation.
 *  2. **Slot `analitik` wajib.** The SKU universe is built exclusively from
 *     Analitik Produk (`metrik.ts:buildSkuBase`); without it every ads row
 *     becomes "orphan spend" and the scan reports zero SKUs while returning
 *     201. Same shape of pre-check as `report.ts`'s `MSG_BISNIS_HOME_WAJIB`.
 */
import { adsscanner as engine, permission } from '@cdps/core';
import { executors, withTransaction, type Queryable, type Sql, type TransactionSql } from '@cdps/db';
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
  type Actor,
} from './account';
import { ADS_DIVISION, canManageCampaign } from './ads';

/** Engine types, re-aliased locally so signatures below read without the `engine.tiktok.` prefix everywhere. */
type EngineInput = engine.tiktok.AdsScannerInput;
type EngineCfg = engine.tiktok.AdsScannerConfig;
type EnginePayload = engine.tiktok.AdsScannerPayload;
type EngineBench = engine.tiktok.AdsScannerBench;
type Aoa = unknown[][];
/** Same local alias report.ts uses — `postgres`' json() param type is not re-exported by `@cdps/db`. */
type JsonParam = Parameters<TransactionSql['json']>[0];

// ---------------------------------------------------------------------------
// Messages (BI, house rule #5)
// ---------------------------------------------------------------------------
export const MSG_FORBIDDEN = '[Anda tidak berhak mengakses data Ads Scanner ini]';
export const MSG_CLIENT_NOT_FOUND = '[klien tidak ditemukan]';
export const MSG_RUN_NOT_FOUND = '[scan Ads Scanner tidak ditemukan]';
export const MSG_NO_FILES = '[unggah minimal satu berkas ekspor TikTok Shop]';
export const MSG_ANALITIK_WAJIB = '[ekspor Analitik Produk wajib diunggah — daftar SKU dibangun dari berkas itu]';
export const MSG_BENCHMARK_KOSONG = '[benchmark kategori Ads Scanner belum dikonfigurasi]';
export const MSG_KATEGORI_WAJIB = '[pilih kategori Level-3 TikTok Shop]';
export const MSG_KATEGORI_TIDAK_DIKENALI = '[kategori tidak dikenali — pilih dari daftar kategori Level-3 TikTok Shop]';
export const MSG_MODE_TIDAK_VALID = '[mode scan tidak valid]';
export const MSG_RINGKASAN_DATA = '[berkas ini ekspor "Ringkasan data", bukan per-SKU — unduh ulang ekspor per-SKU]';
export const MSG_TIDAK_DIKENALI = '[berkas tidak dikenali sebagai ekspor Analitik Produk, Ads Produk, Video, atau Ads Live]';
export const MSG_MINGGU_TIDAK_VALID = '[tanggal minggu data tidak valid]';

// ---------------------------------------------------------------------------
// Authorization — mirrors the migration's own RLS predicate (see file header).
// ---------------------------------------------------------------------------
/** Write scope: Ads staff/lead or Director — reuses M8's gate, same actors as SKU Screener's writes. */
export function canWriteAdsScan(actor: Actor): boolean {
  return canManageCampaign(actor);
}

/** Read scope: OD/Director, the row's own creator, one of the client's PIC columns (`jwt_owns_client`), or an Ads-division lead. */
export function canReadAdsScan(actor: Actor, createdBy: string | null, clientOwners: ReadonlySet<string>): boolean {
  if (permission.canReadAll(actor)) return true;
  if (createdBy !== null && actor.employeeId === createdBy) return true;
  if (clientOwners.has(actor.employeeId)) return true;
  return permission.isLead(actor, ADS_DIVISION);
}

/** True when the actor may read ANY row for this client regardless of who created it (decides whether a list query needs a `created_by` filter). */
function hasBroadReadAccess(actor: Actor, clientOwners: ReadonlySet<string>): boolean {
  return permission.canReadAll(actor) || clientOwners.has(actor.employeeId) || permission.isLead(actor, ADS_DIVISION);
}

/** True when the actor reads across ALL clients (portfolio query) — the client-independent half of the RLS predicate. */
function hasCrossClientRead(actor: Actor): boolean {
  return permission.canReadAll(actor) || permission.isLead(actor, ADS_DIVISION);
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
// Small local helpers (module-local, same pattern as report.ts/skuscreener.ts)
// ---------------------------------------------------------------------------
function isoTs(v: unknown): string {
  return v instanceof Date ? v.toISOString() : String(v);
}
function dateStrOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}
function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
/** Server clock (WIB via the deployment's TZ, same helper shape as report.ts) — never a browser `new Date()`. */
function serverGeneratedAt(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// runAdsScan — one weekly scan of one client
// ---------------------------------------------------------------------------
export interface AdsScanFileInput {
  namaBerkas: string;
  sha256: string;
  ukuranBytes: number;
  /** Browser-parsed array-of-arrays; the server detects which of the 4 slots it is. */
  aoa: Aoa;
  /** AM override for detection (the tool's own affordance for a misfiled export). */
  tipeOverride?: string | null;
  /** AM override for a `video` sheet's kind — `classifyVideoKind` can be ambiguous and the tool lets the AM swap it. */
  videoKindOverride?: 'kreator' | 'toko' | null;
}

/** The AM-tunable subset of `AdsScannerConfig`; anything omitted falls back to `DEFAULT_ADS_SCANNER_CFG`. */
export interface AdsScanConfigInput {
  gateScale?: number;
  gateConsider?: number;
  gateYellow?: number;
  testBudgetDaily?: number;
  scaleStepPct?: number;
  minAov?: number;
  blacklist?: string[];
  usdRate?: number;
  winnerPctl?: number;
}

export interface RunAdsScanInput {
  clientId: string;
  /** TikTok Shop Level-3 category — selects the benchmark row. Must exist in the active benchmark. */
  kategori: string;
  mode?: 'weekly' | 'newclient';
  /** AM-entered ISO date "somewhere in the data week"; the engine Monday-aligns it. Pure data entry, not a clock read. */
  mingguMulai?: string | null;
  cfg?: AdsScanConfigInput;
  files: AdsScanFileInput[];
}

export interface AdsScanRunSummary {
  id: string;
  clientId: string;
  kategori: string;
  mode: 'weekly' | 'newclient';
  mingguMulai: string | null;
  benchmarkVersi: number;
  createdAt: string;
  createdBy: string;
}

export interface AdsScanRunDetail extends AdsScanRunSummary {
  payloadSchema: string;
  konfigurasi: unknown;
  payload: unknown;
  sumberBerkas: unknown;
}

/** One row of the cross-client portfolio: the client's LATEST scan plus enough identity to render a row. */
export interface AdsScanPortfolioRow extends AdsScanRunSummary {
  clientToko: string | null;
  clientNamaPic: string | null;
  /** Account-level verdict of that latest scan (`payload.vonis.label`) — read from the frozen payload, not recomputed. */
  vonis: string | null;
  totalGmv: number | null;
  totalSpend: number | null;
  /** null when the scan had zero ad spend — house rule #7 (no basis, not 0). */
  blendedRoi: number | null;
  poolRealokasi: number | null;
  skuTotal: number | null;
}

function rowToSummary(r: Record<string, unknown>): AdsScanRunSummary {
  return {
    id: r.id as string,
    clientId: r.client_id as string,
    kategori: r.kategori as string,
    mode: r.mode as 'weekly' | 'newclient',
    mingguMulai: dateStrOrNull(r.minggu_mulai),
    benchmarkVersi: Number(r.benchmark_versi),
    createdAt: isoTs(r.created_at),
    createdBy: r.created_by as string,
  };
}

function rowToDetail(r: Record<string, unknown>): AdsScanRunDetail {
  return {
    ...rowToSummary(r),
    payloadSchema: r.payload_schema as string,
    konfigurasi: r.konfigurasi ?? null,
    payload: r.payload ?? null,
    sumberBerkas: r.sumber_berkas ?? null,
  };
}

/** What the server decided about one uploaded file, echoed back so the UI can show "this landed in slot X" (and let the AM correct it). */
export interface BerkasProvenance {
  namaBerkas: string;
  sha256: string;
  ukuranBytes: number;
  /** The detected slot, or null when nothing recognised it. */
  peran: string | null;
  /** Only for `video` files. */
  videoKind?: 'kreator' | 'toko';
  /** True when the video kind came from the fallback creator-count heuristic — the UI should offer a swap, exactly like the tool. */
  videoKindAmbiguous?: boolean;
  baris: number;
}

interface DetectedFiles {
  input: EngineInput;
  berkas: BerkasProvenance[];
}

/**
 * Detect every uploaded file into the engine's 4 slots.
 *
 * `video` is the one slot that legitimately takes MORE than one file (the
 * shop's own uploads and the affiliate creators' are separate exports with an
 * identical column signature), so it accumulates; the other three take the
 * last one detected. A `Ringkasan data` export is rejected by name here
 * rather than silently parsed into zero rows — the tool has the same guard
 * (`detectAoa` → `wrong_summary`) and it is the single most common wrong
 * download.
 */
function detectFiles(files: readonly AdsScanFileInput[]): DetectedFiles {
  const t = engine.tiktok;
  const slots: EngineInput = { analitik: [], ads: [], adslive: [], videos: [] };
  const berkas: BerkasProvenance[] = [];
  const validTypes = new Set(t.FILE_SIGS.map((s) => s.key));

  for (const f of files) {
    const aoa = f.aoa ?? [];
    let type: string | null = null;
    let headerRow = 0;

    if (f.tipeOverride && validTypes.has(f.tipeOverride as 'analitik')) {
      type = f.tipeOverride;
      headerRow = t.FILE_SIGS.find((s) => s.key === type)?.headerRow ?? 0;
    } else {
      const d = t.detectAoa(aoa);
      // Sebut NAMA berkasnya. UAT Avitaskin (2026-09-04): AM menyeret satu folder
      // export (12 berkas) dan seluruh scan ditolak oleh satu berkas
      // "Shop Analytics" tanpa petunjuk yang mana — sama seperti `MSG_AMBIGU`
      // di mesin laporan, pesan ini menempelkan nama berkasnya di belakang
      // string BI-nya (string `[...]`-nya sendiri tidak berubah).
      if (d && d.type === 'wrong_summary') throw new ValidationError(`${MSG_RINGKASAN_DATA} ${f.namaBerkas}`);
      if (d) {
        type = d.type;
        headerRow = d.headerRow;
      }
    }

    if (type === null) {
      berkas.push({ namaBerkas: f.namaBerkas, sha256: f.sha256, ukuranBytes: Number(f.ukuranBytes), peran: null, baris: 0 });
      continue;
    }

    const rows = t.rowsToObjects(aoa, headerRow);
    const prov: BerkasProvenance = {
      namaBerkas: f.namaBerkas, sha256: f.sha256, ukuranBytes: Number(f.ukuranBytes), peran: type, baris: rows.length,
    };

    if (type === 'video') {
      const auto = t.classifyVideoKind(rows, f.namaBerkas);
      const kind = f.videoKindOverride ?? auto.kind;
      // Ambiguity is a property of the AUTO guess only — an explicit AM
      // override is by definition unambiguous, so the UI stops offering a swap
      // once they have chosen.
      prov.videoKind = kind;
      prov.videoKindAmbiguous = f.videoKindOverride ? false : auto.ambiguous;
      slots.videos.push({ rows, kind });
    } else if (type === 'analitik') {
      slots.analitik = rows;
    } else if (type === 'ads') {
      slots.ads = rows;
    } else if (type === 'adslive') {
      slots.adslive = rows;
    }
    berkas.push(prov);
  }

  return { input: slots, berkas };
}

export async function runAdsScan(sql: Sql, actor: Actor, input: RunAdsScanInput): Promise<AdsScanRunDetail> {
  const now = new Date();
  return withTransaction(sql, async (tx) => {
    if (!canWriteAdsScan(actor)) throw new ForbiddenError(MSG_FORBIDDEN);
    // The write gate is division-based (canWriteAdsScan), not client
    // ownership — this call is only here to 404 an unknown client before any
    // parsing work happens.
    await clientOwnerIds(tx, input.clientId);

    const kategori = (input.kategori ?? '').trim();
    if (!kategori) throw new ValidationError(MSG_KATEGORI_WAJIB);

    const mode = input.mode ?? 'weekly';
    if (mode !== 'weekly' && mode !== 'newclient') throw new ValidationError(MSG_MODE_TIDAK_VALID);

    if (!input.files || input.files.length === 0) throw new ValidationError(MSG_NO_FILES);

    // An AM-entered date that is not a date at all would otherwise sail
    // through as a null `minggu_mulai` (weekStartMonday returns null for
    // garbage) — a silently period-less scan. Reject it instead; omitting the
    // field entirely is still allowed.
    const mingguInput = input.mingguMulai ?? null;
    if (mingguInput !== null && engine.tiktok.weekStartMonday(mingguInput) === null) {
      throw new ValidationError(MSG_MINGGU_TIDAK_VALID);
    }

    const bm = await tx<{ versi: number; nilai: EngineBench }[]>`
      select versi, nilai from adsscanner_benchmark where aktif = true order by versi desc limit 1`;
    if (bm.length === 0) throw new ValidationError(MSG_BENCHMARK_KOSONG);
    const bench = bm[0].nilai;
    const benchmarkVersi = bm[0].versi;

    // Gate #1 from the file header: an unknown category scores against an
    // all-null benchmark row, which `skor.ts` correctly renormalises around —
    // producing a score that LOOKS comparable to other clients' but silently
    // has no ROI and no GPM component. Reject rather than degrade.
    if (!Object.prototype.hasOwnProperty.call(bench, kategori)) {
      throw new ValidationError(MSG_KATEGORI_TIDAK_DIKENALI);
    }

    const detected = detectFiles(input.files);
    if (detected.berkas.every((b) => b.peran === null)) throw new ValidationError(MSG_TIDAK_DIKENALI);
    // Gate #2: without Analitik Produk there is no SKU universe at all.
    if (detected.input.analitik.length === 0) throw new ValidationError(MSG_ANALITIK_WAJIB);

    const c = await tx<{ nama_pic: string | null; assigned_am_id: string | null }[]>`
      select nama_pic, assigned_am_id from clients where id = ${input.clientId}`;

    const cfg = {
      ...engine.tiktok.DEFAULT_ADS_SCANNER_CFG,
      ...Object.fromEntries(Object.entries(input.cfg ?? {}).filter(([, v]) => v !== undefined && v !== null)),
      category: kategori,
      mode,
    } as EngineCfg;

    const result = engine.tiktok.runAdsScanner(detected.input, {
      cfg,
      bench,
      benchmarkVersi,
      klien: {
        nama: c[0]?.nama_pic ?? null,
        // The advertiser who RAN the scan — the tool's `state.advertiser`.
        // Deliberately the actor, not the client's assigned AM: this is an Ads
        // division artefact, and who ran it is the accountable name.
        account_manager: actor.employeeId,
      },
      generatedAt: serverGeneratedAt(), // server clock, never the browser's
      periode: { weekStart: mingguInput },
    });

    // Monday-aligned by the engine (`payload.klien.minggu_mulai`) — stored
    // pre-aligned so the portfolio index groups scans of the same data week
    // even when two AMs typed different days of it.
    const mingguMulai = result.payload.klien.minggu_mulai;

    const ex = executors(tx);
    const id = await ex.ident.identNext('ASR', now);
    await tx`
      insert into adsscanner_run
        (id, client_id, kategori, mode, minggu_mulai, konfigurasi, benchmark_versi, payload_schema, payload, sumber_berkas, created_by)
      values
        (${id}, ${input.clientId}, ${kategori}, ${mode}, ${mingguMulai}, ${tx.json(cfg as unknown as JsonParam)}, ${benchmarkVersi},
         ${engine.tiktok.ADSSCANNER_PAYLOAD_SCHEMA}, ${tx.json(result.payload as unknown as JsonParam)},
         ${tx.json(detected.berkas.map((b) => ({
           nama_berkas: b.namaBerkas, sha256: b.sha256, ukuran_bytes: b.ukuranBytes, peran: b.peran,
           ...(b.videoKind ? { video_kind: b.videoKind, video_kind_ambigu: b.videoKindAmbiguous ?? false } : {}),
           baris: b.baris,
         })))},
         ${actor.employeeId})`;

    await ex.audit.insertAudit({
      entityType: 'adsscanner_run',
      entityId: id,
      actorEmployeeId: actor.employeeId,
      action: 'adsscanner_run_created',
      beforeJson: null,
      afterJson: {
        client_id: input.clientId,
        kategori,
        mode,
        minggu_mulai: mingguMulai,
        benchmark_versi: benchmarkVersi,
        n_sku: result.sku.length,
        vonis: result.payload.vonis.label,
        pool_realokasi: result.payload.realokasi.pool,
      },
      createdBy: actor.employeeId,
    });

    return getAdsScanRunById(tx, id);
  });
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------
async function getAdsScanRunById(sql: Queryable, id: string): Promise<AdsScanRunDetail> {
  const rows = await sql<Record<string, unknown>[]>`select * from adsscanner_run where id = ${id}`;
  if (rows.length === 0) throw new NotFoundError(MSG_RUN_NOT_FOUND);
  return rowToDetail(rows[0]);
}

export async function getAdsScanRun(sql: Queryable, actor: Actor, id: string): Promise<AdsScanRunDetail> {
  const rows = await sql<Record<string, unknown>[]>`select * from adsscanner_run where id = ${id}`;
  if (rows.length === 0) throw new NotFoundError(MSG_RUN_NOT_FOUND);
  const r = rows[0];
  const owners = await clientOwnerIds(sql, r.client_id as string);
  if (!canReadAdsScan(actor, r.created_by as string, owners)) throw new ForbiddenError(MSG_FORBIDDEN);
  return rowToDetail(r);
}

export async function listAdsScanRuns(sql: Queryable, actor: Actor, clientId: string): Promise<AdsScanRunSummary[]> {
  const owners = await clientOwnerIds(sql, clientId);
  const broad = hasBroadReadAccess(actor, owners);
  const rows = await sql<Record<string, unknown>[]>`
    select id, client_id, kategori, mode, minggu_mulai, benchmark_versi, created_at, created_by
      from adsscanner_run
     where client_id = ${clientId}
       and (${broad} or created_by = ${actor.employeeId})
     order by created_at desc`;
  return rows.map(rowToSummary);
}

/**
 * The cross-client portfolio — the read pattern that JUSTIFIED a table of its
 * own (O69): one advertiser holds many shops, and the question they ask on a
 * Monday is "which of my clients needs attention this week", not "show me one
 * client's history".
 *
 * `distinct on (client_id) … order by client_id, created_at desc` = the LATEST
 * scan per client. Row scope repeats the RLS predicate in SQL rather than in
 * TS because the client-ownership half of it lives in `clients` columns —
 * filtering in TS would mean fetching every client's rows first and dropping
 * most, which is exactly the shape of leak that gets noticed only once
 * someone's portfolio is big.
 *
 * Rollups come from the FROZEN payload, never recomputed here: house rule #4
 * cuts both ways — a derived number must be recomputable, and must not be
 * derived a SECOND time by a different code path that could drift.
 */
export async function adsScanPortfolio(sql: Queryable, actor: Actor): Promise<AdsScanPortfolioRow[]> {
  const all = hasCrossClientRead(actor);
  const eid = actor.employeeId;
  const rows = await sql<Record<string, unknown>[]>`
    select distinct on (r.client_id)
           r.id, r.client_id, r.kategori, r.mode, r.minggu_mulai, r.benchmark_versi,
           r.created_at, r.created_by,
           c.toko, c.nama_pic,
           r.payload -> 'vonis' ->> 'label'              as vonis,
           r.payload -> 'ringkasan' ->> 'totalGmv'       as total_gmv,
           r.payload -> 'ringkasan' ->> 'totalSpend'     as total_spend,
           r.payload -> 'ringkasan' ->> 'blendedRoi'     as blended_roi,
           r.payload -> 'ringkasan' ->> 'skuTotal'       as sku_total,
           r.payload -> 'realokasi' ->> 'pool'           as pool_realokasi
      from adsscanner_run r
      join clients c on c.id = r.client_id
     where (${all}
            or r.created_by = ${eid}
            or c.sales_pic_id = ${eid}
            or c.assigned_am_id = ${eid}
            or c.commission_payment_pic_id = ${eid}
            or c.created_by = ${eid})
     order by r.client_id, r.created_at desc`;
  return rows.map((r) => ({
    ...rowToSummary(r),
    clientToko: (r.toko as string | null) ?? null,
    clientNamaPic: (r.nama_pic as string | null) ?? null,
    vonis: (r.vonis as string | null) ?? null,
    totalGmv: numOrNull(r.total_gmv),
    totalSpend: numOrNull(r.total_spend),
    blendedRoi: numOrNull(r.blended_roi),
    poolRealokasi: numOrNull(r.pool_realokasi),
    skuTotal: numOrNull(r.sku_total),
  }));
}

/**
 * Render one stored scan to standalone HTML via the engine's own renderer.
 *
 * Reads the FROZEN payload and hands it to `renderReportHtml` — it does not
 * re-run the engine, so the HTML always shows the numbers as scored, against
 * the benchmark version recorded on the row (house rule #4: recomputable, and
 * reproducible).
 */
export async function renderAdsScanHtml(sql: Queryable, actor: Actor, id: string): Promise<string> {
  const d = await getAdsScanRun(sql, actor, id);
  return engine.tiktok.renderReportHtml(d.payload as EnginePayload);
}

/** The category list a picker should offer — the keys of the ACTIVE benchmark row, not the compiled-in constant (they can differ once a v2 is calibrated). */
export async function adsScanCategories(sql: Queryable): Promise<string[]> {
  const bm = await sql<{ nilai: Record<string, unknown> }[]>`
    select nilai from adsscanner_benchmark where aktif = true order by versi desc limit 1`;
  if (bm.length === 0) throw new ValidationError(MSG_BENCHMARK_KOSONG);
  return Object.keys(bm[0].nilai).sort();
}
