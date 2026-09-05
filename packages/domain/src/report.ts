/**
 * Mesin Laporan Klien (C1 bagian 2) — buat/baca laporan performa mingguan/bulanan
 * per toko, dan (inilah gap C1 yang sesungguhnya) **penulis tunggal**
 * `clients.total_sales`.
 *
 * Skema + mesin murni sudah ada (C1 bagian 1): `packages/core/src/report/**` dan
 * migrasi `20260819000000_client_report_engine.sql`. Yang HILANG adalah pemanggil:
 * `clients.total_sales` — sinyal GMV yang dibaca Health Score (M13 §6.2 #5) —
 * tidak ditulis oleh apa pun. Modul ini menutup itu.
 *
 * Polanya ditiru dari `riset-awal.ts` (`submitBaseline`): browser mem-parse xlsx
 * ke `{filename, aoa, sha256, ukuranBytes}`; **server** yang `readSheet` →
 * `detect`/`detectTtam` → `runReport` → simpan. Mesin skor, deteksi, dan setiap
 * ambang hidup di `@cdps/core` — web-internal tak punya `@cdps/core`, dan salinan
 * kedua aturan skor di browser adalah drift yang dilarang keputusan 4.
 *
 * Aturan rumah yang ditegakkan:
 *  - **Immutable history** (#3): `client_reports` append-only (frozen trigger);
 *    insert-nya sendiri IS jejaknya. Revisi = baris baru setelah yang lama dicabut,
 *    dan UNIQUE(toko × tipe × rentang) mengubah unggah-ulang jadi `ConflictError`.
 *  - **Derived read-only + recomputable** (#4): skor/GMV lahir dari payload mesin
 *    yang membawa `benchmark_versi` + `engine_versi`. Server me-restamp
 *    `generated_at` dengan jamnya sendiri, bukan jam browser.
 *  - **`total_sales` disetarakan ke 30 hari** (keputusan 3): laporan bulanan lewat
 *    apa adanya, mingguan diskalakan — laporan mingguan & bulanan menulis SATUAN
 *    yang sama. Menulis GMV mingguan mentah ke `total_sales` menjatuhkannya ~4x
 *    dan mencrater Health Score klien tanpa sebab performa.
 *  - **Ambigu toko-vs-afiliasi**: `detect()` menandai; server menolak dengan
 *    `MSG_AMBIGU` dan minta AM konfirmasi tipe (`tipeOverride`), tak menebak diam2.
 *  - **null eksplisit, bukan omitempty**: setiap kolom opsional ditulis `null`.
 */
import { baseline, money, permission, report, reportShopee, statemachine } from '@cdps/core';
import { executors, withTransaction, type Queryable, type Sql, type TransactionSql } from '@cdps/db';
import {
  ACCOUNT_DIVISION,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  type Actor,
} from './account';
import { findOverlappingShopeeAdsCampaigns, insertMetricEntryFromReportEngine } from './ads';
import { MSG_AMBIGU, MSG_PLATFORM_INACTIVE, MSG_PLATFORM_NOT_FOUND } from './riset-awal';

// ---------------------------------------------------------------------------
// Messages (BI, house rule #5)
// ---------------------------------------------------------------------------
export const MSG_FORBIDDEN = '[Anda tidak berhak mengakses laporan klien ini]';
export const MSG_CLIENT_NOT_FOUND = '[klien tidak ditemukan]';
export const MSG_REPORT_NOT_FOUND = '[laporan tidak ditemukan]';
export const MSG_NO_FILES = '[unggah minimal satu berkas export untuk membuat laporan]';
export const MSG_TIPE_PERIODE = '[pilih tipe periode: mingguan atau bulanan]';
export const MSG_TOKO_WAJIB = '[berkas Analitik Toko TikTok wajib ada untuk membuat laporan]';
export const MSG_PERIODE_TAK_TERBACA = '[rentang tanggal tidak terbaca dari berkas — isi periode mulai & akhir]';
export const MSG_SUDAH_ADA = '[laporan untuk toko & periode ini sudah ada]';
export const MSG_BENCHMARK_KOSONG = '[benchmark laporan belum dikonfigurasi]';
export const MSG_INSIGHT_NOT_FOUND = '[insight laporan tidak ditemukan]';
export const MSG_SUDAH_TERBIT = '[laporan sudah diterbitkan — cabut dulu sebelum menerbitkan ulang]';
export const MSG_BELUM_TERBIT = '[laporan belum diterbitkan]';
export const MSG_ALASAN_CABUT_WAJIB = '[alasan pencabutan wajib diisi]';
export const MSG_TAK_ADA_PERUBAHAN = '[tidak ada revisi insight baru untuk diterbitkan]';
// SH-06 — createReportShopee (below).
export const MSG_BISNIS_HOME_WAJIB = '[berkas Bisnis — Home wajib ada untuk membuat laporan Shopee]';
export const MSG_PERIODE_LABEL_WAJIB = '[label periode laporan wajib diisi]';
export const MSG_TAHAP_FOKUS_TAK_DIKENAL =
  '[tahap fokus tidak dikenal — pilih Awareness, Consideration, atau Conversion]';
/** Re-exported so a route can answer a malformed platform id with the SAME
 *  message the domain throws for a missing one — one string, one meaning. */
export { MSG_PLATFORM_NOT_FOUND } from './riset-awal';

// ---------------------------------------------------------------------------
// Publication machine (migrasi 20260908010000, STATE_MACHINES §21)
// ---------------------------------------------------------------------------
const MACHINE_REPORT = 'client_report';
/** audit_log entity_type for the publication row (the report row itself uses 'client_report'). */
const ENTITY_REPORT = 'client_report';
const TABLE_PUBLIKASI = 'client_report_publikasi';

export const STATUS_DRAF = '[Draf]';
export const STATUS_TERBIT = '[Terbit]';
export const STATUS_DICABUT = '[Dicabut]';

/** `sumber` of an insight revision: revisi 0 is the engine's, every later one a human's. */
export const INSIGHT_SUMBER_MESIN = 'mesin';
export const INSIGHT_SUMBER_MANUAL = 'manual';

/** The value type postgres.js `sql.json` accepts (jsonb serializer) — see riset-awal.ts. */
type JsonParam = Parameters<TransactionSql['json']>[0];

// ---------------------------------------------------------------------------
// Permissions (§2.1: tulis = AM pemilik + lead Account + Director; baca = + OD)
// ---------------------------------------------------------------------------
/** Write scope: the owning AM, an Account lead, or a Director. */
export function canWriteReport(actor: Actor, ownerAm: string | null): boolean {
  if (permission.isLead(actor, ACCOUNT_DIVISION)) return true; // Director carries lead everywhere
  return ownerAm !== null && ownerAm === actor.employeeId;
}

/** Read scope: write scope, plus OD (read-everywhere). */
export function canReadReport(actor: Actor, ownerAm: string | null): boolean {
  if (permission.canReadAll(actor)) return true; // OD + Director
  if (permission.isLead(actor, ACCOUNT_DIVISION)) return true;
  return ownerAm !== null && ownerAm === actor.employeeId;
}

// ---------------------------------------------------------------------------
// Input / read-model shapes
// ---------------------------------------------------------------------------
/** One export file, parsed to array-of-arrays IN THE BROWSER; the server scores. */
export interface ReportSheetFileInput {
  filename: string;
  /** `XLSX.utils.sheet_to_json(ws, { header: 1 })` output. */
  aoa: unknown[][];
  sha256: string;
  ukuranBytes: number;
  /** AM's explicit file type when detection is ambiguous (toko vs afiliasi). */
  tipeOverride?: string | null;
}

export interface CreateReportInput {
  clientPlatformId: number;
  periodeTipe: report.PeriodeTipe;
  files: ReportSheetFileInput[];
  /** 'net' GMV (MEA standard) vs 'gross'. */
  net?: boolean;
  /** The client's own linked TikTok handles, excluded from the creator pool. */
  linkedAccounts?: string[];
  /** Fallback period, used ONLY when the export carries no readable date range. */
  periodeMulai?: string | null;
  periodeAkhir?: string | null;
}

/**
 * SH-06 — Shopee has no machine-readable date range in its exports at all (see
 * `@cdps/core` `report/shopee/run.ts` header): unlike `CreateReportInput`,
 * `periodeMulai`/`periodeAkhir` are NOT an occasional fallback here — they are
 * the ONLY source, every time.
 */
export interface CreateReportShopeeInput {
  clientPlatformId: number;
  periodeTipe: report.PeriodeTipe;
  files: ReportSheetFileInput[];
  /** Free-text period label for the payload (tool `periodName`, e.g. "Juni 2026") — display only. */
  periode: string;
  periodeMulai: string;
  periodeAkhir: string;
  /**
   * SH-06 — Ad Campaign ids the AM excludes from the auto Metric-Entry
   * even-split (see `attributeShopeeAdsMetricEntries`). Confirmed with the
   * owner (Yohan, `AskUserQuestion` 2026-09-03): when N campaigns overlap the
   * report's period, the report's OWN combined ads spend/omzet — it cannot be
   * split by campaign from the file itself — is divided EVENLY across them so
   * the sum recomputes back to the true total; excluding a campaign here
   * removes it from that split (its own number, if any, stays manual).
   */
  excludeCampaignIds?: string[];
}

export interface ReportSummary {
  id: number;
  clientId: string;
  clientPlatformId: number;
  platform: string;
  periodeTipe: string;
  periodeMulai: string;
  periodeAkhir: string;
  hariPeriode: number;
  rentangDariBerkas: boolean;
  skor: number | null;
  skorLabel: string | null;
  gmvNet: number;
  gmvKotor: number;
  gmvRunrateBulanan: number;
  /** Set for `cdps.report.tiktok.v1` rows; null for Shopee rows (see `benchmarkVersiShopee`). */
  benchmarkVersi: number | null;
  /** Set for `cdps.report.shopee.v1` rows only — `report_benchmark_shopee.versi` used to score this report. */
  benchmarkVersiShopee: number | null;
  engineVersi: string;
  /** Which report engine wrote this row — `cdps.report.tiktok.v1` (default) or `cdps.report.shopee.v1`. Selects the renderer in `renderReport`. */
  payloadSchema: string;
  createdAt: string;
  createdBy: string;
}

export interface ReportBerkas {
  id: number;
  namaBerkas: string;
  sha256: string;
  ukuranBytes: number;
  tipeTerdeteksi: string | null;
  tipeOverride: string | null;
  jumlahBaris: number | null;
  periode: unknown;
}

export interface ReportDetail extends ReportSummary {
  payload: unknown;
  kelengkapanFile: unknown;
  berkas: ReportBerkas[];
  /** Publication state — always present; a report is born `[Draf]`. */
  publikasi: ReportPublikasi;
}

/** One stored revision of the report's narrative (`client_report_insight`). */
export interface ReportInsightRevisi {
  revisi: number;
  sumber: string;
  insight: report.PayloadInsight;
  catatanRevisi: string | null;
  createdAt: string;
  createdBy: string;
}

/** The publication row: what the client can see, and which revision they see. */
export interface ReportPublikasi {
  status: string;
  /** The PINNED revision — what a `klien`-mode render uses. Null while not published. */
  insightRevisi: number | null;
  diterbitkanPada: string | null;
  diterbitkanOleh: string | null;
  dicabutPada: string | null;
  dicabutOleh: string | null;
  alasanCabut: string | null;
}

/**
 * The insight editing surface: what the engine wrote, what the AM last wrote,
 * and what the client is currently reading. Three numbers, because they are
 * genuinely three different things and collapsing any two of them is how an
 * unpublished draft ends up in front of a client.
 */
export interface ReportInsightBundle {
  reportId: number;
  publikasi: ReportPublikasi;
  /** Highest revision on file — what `internal` preview renders. */
  terbaru: ReportInsightRevisi;
  /** Revisi 0, the engine snapshot — the target of "kembalikan ke insight mesin". */
  mesin: ReportInsightRevisi;
  /** The revision pinned for the client, or null when nothing is published. */
  terpaku: ReportInsightRevisi | null;
  /** True when the AM has unpublished edits (terbaru.revisi > publikasi.insightRevisi). */
  adaPerubahanBelumTerbit: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
/** Server clock (WIB display governed by `tz`; storage ISO/UTC). Never the browser. */
function serverGeneratedAt(): string {
  return new Date().toISOString();
}

/** Round to 2 decimals — the numeric(15,2) precision of the GMV columns. */
function round2(v: number): number {
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0;
}

function numOf(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function isoTs(v: unknown): string {
  return v instanceof Date ? v.toISOString() : String(v);
}

function dateStr(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

/** True for a Postgres unique-violation (SQLSTATE 23505). */
function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === '23505';
}

async function ownerAmOfClient(sql: Queryable, clientId: string): Promise<string | null> {
  const rows = await sql<{ assigned_am_id: string | null }[]>`
    select assigned_am_id from clients where id = ${clientId}`;
  if (rows.length === 0) throw new NotFoundError(MSG_CLIENT_NOT_FOUND);
  return rows[0].assigned_am_id;
}

// ---------------------------------------------------------------------------
// createReport — detect → score → store, then write clients.total_sales
// ---------------------------------------------------------------------------
export async function createReport(sql: Sql, actor: Actor, clientId: string, input: CreateReportInput): Promise<ReportDetail> {
  return withTransaction(sql, async (tx) => {
    if (input.periodeTipe !== 'mingguan' && input.periodeTipe !== 'bulanan') {
      throw new ValidationError(MSG_TIPE_PERIODE);
    }

    // Client identity for the payload is server-owned (from CDPS), never supplied
    // by the browser. The owner AM is the write-scope anchor.
    const cli = await tx<{ nama_pic: string | null; toko: string | null; kategori: string | null; assigned_am_id: string | null }[]>`
      select nama_pic, toko, kategori, assigned_am_id from clients where id = ${clientId}`;
    if (cli.length === 0) throw new NotFoundError(MSG_CLIENT_NOT_FOUND);
    const c = cli[0];
    if (!canWriteReport(actor, c.assigned_am_id)) throw new ForbiddenError(MSG_FORBIDDEN);

    // The platform must be an ACTIVE store of THIS client (report anchored to the
    // toko, not the client — keputusan 4). A stale/foreign id is rejected.
    if (!input.clientPlatformId) throw new ValidationError(MSG_PLATFORM_NOT_FOUND);
    const plat = await tx<{ platform: string; active: boolean; client_id: string; store_link: string | null; tahap_fokus: string | null }[]>`
      select platform, active, client_id, store_link, tahap_fokus from client_platforms
       where id = ${input.clientPlatformId} for update`;
    if (plat.length === 0 || plat[0].client_id !== clientId) throw new NotFoundError(MSG_PLATFORM_NOT_FOUND);
    if (!plat[0].active) throw new ValidationError(MSG_PLATFORM_INACTIVE);
    const platform = plat[0].platform;

    if (!input.files || input.files.length === 0) throw new ValidationError(MSG_NO_FILES);

    // Detect each parsed sheet SERVER-SIDE. Ads Manager files are their own 4
    // signatures (detectTtam); everything else is one of the 12 baseline
    // signatures. An ambiguous own-vs-affiliate file needs the AM's explicit
    // type (tipeOverride) — the engine never guesses silently.
    const slots: report.ReportSlots = {};
    const ambigu: string[] = [];
    const berkasMeta: { file: ReportSheetFileInput; type: string | null; rows: number; rentang: report.Rentang | null }[] = [];
    for (const f of input.files) {
      const sheet = baseline.readSheet(f.aoa as baseline.Aoa, f.filename);
      if (!sheet) {
        berkasMeta.push({ file: f, type: null, rows: 0, rentang: null });
        continue;
      }
      sheet.periode = baseline.periodeOf(sheet.meta);
      let type: string | null;
      if (f.tipeOverride) {
        type = f.tipeOverride;
      } else {
        const ttam = report.detectTtam(sheet);
        if (ttam) {
          type = ttam;
        } else {
          const d = baseline.detect(sheet, { linkedAccounts: input.linkedAccounts });
          if (d.type && d.ambiguous) ambigu.push(f.filename);
          type = d.type;
        }
      }
      if (type) {
        sheet.type = type as baseline.FileType;
        slots[type as report.ReportFileType] = sheet;
      }
      berkasMeta.push({ file: f, type, rows: sheet.rows.length, rentang: report.rentangOf(sheet.meta) });
    }
    if (ambigu.length > 0) throw new ValidationError(`${MSG_AMBIGU} ${ambigu.join(', ')}`);

    // The store analytics export is mandatory: every headline number derives from
    // it (the engine throws the same message; we validate first so it is a 400).
    if (!slots.shop_tt) throw new ValidationError(MSG_TOKO_WAJIB);

    // Resolve the reporting period. The export's own date range wins; when no
    // range is readable the AM-supplied fallback is used and rentang_dari_berkas
    // records that it was NOT from the file. The run-rate (the unit total_sales
    // reads) is computed from THIS effective length, not a nominal guess.
    const { rentang: fileRentang, dariBerkas } = report.resolveRentang(slots, input.periodeTipe);
    let periodeMulai: string;
    let periodeAkhir: string;
    let hari: number;
    let rentangDariBerkas: boolean;
    if (dariBerkas) {
      periodeMulai = fileRentang.mulai;
      periodeAkhir = fileRentang.akhir;
      hari = fileRentang.hari;
      rentangDariBerkas = true;
    } else {
      const pm = (input.periodeMulai ?? '').trim();
      const pa = (input.periodeAkhir ?? '').trim();
      const h = pm && pa ? report.hariAntara(pm, pa) : 0;
      if (!pm || !pa || h <= 0) throw new ValidationError(MSG_PERIODE_TAK_TERBACA);
      periodeMulai = pm;
      periodeAkhir = pa;
      hari = h;
      rentangDariBerkas = false;
    }

    // The active, versioned benchmark. Read only through the service role while
    // scoring (report_benchmark is default-deny) — every stored report records
    // the version it used so it can be recomputed (#4).
    const bm = await tx<{ versi: number; nilai: report.ReportBench }[]>`
      select versi, nilai from report_benchmark where aktif = true order by versi desc limit 1`;
    if (bm.length === 0) throw new ValidationError(MSG_BENCHMARK_KOSONG);
    const bench = bm[0].nilai;
    const benchmarkVersi = bm[0].versi;

    const generatedAt = serverGeneratedAt();
    const result = report.runReport(slots, {
      periodeTipe: input.periodeTipe,
      bench,
      benchmarkVersi,
      net: input.net ?? true,
      klien: {
        nama: c.nama_pic,
        toko: c.toko,
        platform,
        kategori: c.kategori,
        account_manager: c.assigned_am_id,
        store_link: plat[0].store_link ?? null,
      },
      generatedAt, // server clock, never the browser's
      akunSendiri: input.linkedAccounts,
      // R3 — the shop's CURRENT focus stage, read here and stamped into the
      // frozen payload. Deliberately not an input field: the AM sets it on the
      // store record (one place answers "where is this shop now"), and the row
      // is locked `for update` above, so the value that reaches the payload is
      // the one in force at generation time and cannot drift mid-transaction.
      // Moving the shop to the next stage next month leaves this report saying
      // exactly what it said the day it was issued.
      tahapFokus: report.isTahapKey(plat[0].tahap_fokus) ? plat[0].tahap_fokus : null,
    });

    const gmvNet = round2(result.M.kpi.gmv);
    const gmvKotor = round2(result.M.kpi.gmvKotor);
    const runrate = round2(report.gmvRunRateBulanan(result.M.kpi.gmv, input.periodeTipe, hari));

    // House invariant (DECISIONS 2026-08-20 — "buang raw, simpan hasil"): the raw
    // upload rows (`input.files[].aoa`) are TRANSIENT — read once to run the engine,
    // then dropped. We persist ONLY the derived `payload` + per-file provenance
    // metadata (name/sha256/size/rows, never the bytes), so no analysis upload ever
    // accumulates storage. Same rule as Riset Awal baseline (RAB-04).
    // INSERT the report. A duplicate (toko × tipe × rentang) is a conflict, never
    // a silent overwrite (the row is immutable — revision = a new row).
    let reportId: number;
    try {
      const ins = await tx<{ id: number }[]>`
        insert into client_reports
          (client_id, client_platform_id, platform, periode_tipe, periode_mulai, periode_akhir,
           hari_periode, rentang_dari_berkas, payload, skor, skor_label, gmv_net, gmv_kotor,
           gmv_runrate_bulanan, benchmark_versi, engine_versi, kelengkapan_file, created_by)
        values
          (${clientId}, ${input.clientPlatformId}, ${platform}, ${input.periodeTipe},
           ${periodeMulai}, ${periodeAkhir}, ${hari}, ${rentangDariBerkas},
           ${tx.json(result.payload as unknown as JsonParam)}, ${result.skor.total}, ${result.skor.label},
           ${gmvNet}, ${gmvKotor}, ${runrate}, ${benchmarkVersi}, ${report.ENGINE_VERSI},
           ${tx.json((result.payload.kelengkapan_file ?? null) as JsonParam)}, ${actor.employeeId})
        returning id`;
      reportId = ins[0].id;
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictError(MSG_SUDAH_ADA);
      throw e;
    }

    for (const b of berkasMeta) {
      await tx`
        insert into client_report_berkas
          (report_id, nama_berkas, sha256, ukuran_bytes, tipe_terdeteksi, tipe_override,
           jumlah_baris, periode, created_by)
        values
          (${reportId}, ${b.file.filename}, ${b.file.sha256}, ${b.file.ukuranBytes},
           ${b.type ?? null}, ${b.file.tipeOverride ?? null}, ${b.rows},
           ${b.rentang == null ? null : tx.json({ mulai: b.rentang.mulai, akhir: b.rentang.akhir } as JsonParam)},
           ${actor.employeeId})`;
    }

    // The narrative is split out of the (frozen) payload the moment the report
    // is born: revisi 0 = the engine snapshot, publikasi = `[Draf]`. Same
    // transaction, because a report without either row is a report the editor
    // and the portal both fail to open — and `client_reports` is immutable, so
    // there is no "fill it in later" path.
    await tx`
      insert into client_report_insight
        (report_id, revisi, sumber, ringkasan, poin, rekomendasi_tinggi,
         rekomendasi_sedang, outlook, indikator, tahap_narasi, created_by)
      values
        (${reportId}, 0, ${INSIGHT_SUMBER_MESIN}, ${result.payload.insight.ringkasan},
         ${tx.json(result.payload.insight.poin as unknown as JsonParam)},
         ${tx.json(result.payload.insight.rekomendasi_tinggi as unknown as JsonParam)},
         ${tx.json(result.payload.insight.rekomendasi_sedang as unknown as JsonParam)},
         ${result.payload.insight.outlook},
         ${tx.json(result.payload.insight.indikator as unknown as JsonParam)},
         ${tx.json(result.payload.insight.tahap_narasi as unknown as JsonParam)},
         ${actor.employeeId})`;
    await tx`
      insert into client_report_publikasi (report_id, status, created_by)
      values (${reportId}, ${STATUS_DRAF}, ${actor.employeeId})`;

    // THE GAP C1 CLOSES HERE: clients.total_sales = Σ latest run-rate per active
    // platform (not just the report that just arrived) + an audit row.
    await recomputeTotalSales(tx, actor, clientId, reportId, runrate);

    return getReportById(tx, reportId);
  });
}

/**
 * Recompute `clients.total_sales` from the LATEST report per active platform.
 *
 * `gmv_runrate_bulanan` is already normalised to 30 days, so a weekly and a
 * monthly upload contribute the same unit. Latest = most recent `periode_akhir`
 * (then highest id) per platform — a fresh weekly upload supersedes last week's
 * for that store without touching the other stores' contributions.
 */
async function recomputeTotalSales(tx: TransactionSql, actor: Actor, clientId: string, reportId: number, runrate: number): Promise<void> {
  const before = await tx<{ total_sales: string }[]>`
    select total_sales from clients where id = ${clientId}`;
  const prev = before[0]?.total_sales ?? '0';
  const agg = await tx<{ total: string }[]>`
    select coalesce(sum(rr), 0)::numeric(15,2) as total from (
      select distinct on (cr.client_platform_id) cr.gmv_runrate_bulanan as rr
        from client_reports cr
        join client_platforms cp on cp.id = cr.client_platform_id
       where cr.client_id = ${clientId} and cp.active = true
       order by cr.client_platform_id, cr.periode_akhir desc, cr.id desc
    ) t`;
  const total = agg[0].total;
  await tx`update clients set total_sales = ${total} where id = ${clientId}`;
  const ex = executors(tx);
  await ex.audit.insertAudit({
    entityType: 'client',
    entityId: clientId,
    actorEmployeeId: actor.employeeId,
    action: 'total_sales_recomputed',
    beforeJson: { total_sales: prev },
    afterJson: { total_sales: total, from_report_id: reportId, gmv_runrate_bulanan: runrate, source: 'client_report' },
    createdBy: actor.employeeId,
  });
}

// ---------------------------------------------------------------------------
// createReportShopee — SH-06: same shape as createReport (TikTok), scored by
// `@cdps/core` reportShopee instead. Two real divergences, both because the
// Shopee tool the engine was ported from works differently, not because this
// module chose to: (1) NO date-range detection at all (periodeMulai/Akhir are
// mandatory inputs, never resolved from a file); (2) after the report is
// stored, an auto Metric Entry (MTR-, `entry_method='File Export'`) is
// attributed to the client's overlapping active Shopee Ads campaign(s) — see
// `attributeShopeeAdsMetricEntries`. Undocumented on the TikTok side because
// M8 Ads campaigns in this codebase are not (yet) platform-matched to a
// TikTok report the same way; SH-06 was scoped to Shopee only.
// ---------------------------------------------------------------------------
export async function createReportShopee(sql: Sql, actor: Actor, clientId: string, input: CreateReportShopeeInput): Promise<ReportDetail> {
  return withTransaction(sql, async (tx) => {
    if (input.periodeTipe !== 'mingguan' && input.periodeTipe !== 'bulanan') {
      throw new ValidationError(MSG_TIPE_PERIODE);
    }

    const cli = await tx<{ nama_pic: string | null; toko: string | null; kategori: string | null; assigned_am_id: string | null }[]>`
      select nama_pic, toko, kategori, assigned_am_id from clients where id = ${clientId}`;
    if (cli.length === 0) throw new NotFoundError(MSG_CLIENT_NOT_FOUND);
    const c = cli[0];
    if (!canWriteReport(actor, c.assigned_am_id)) throw new ForbiddenError(MSG_FORBIDDEN);

    if (!input.clientPlatformId) throw new ValidationError(MSG_PLATFORM_NOT_FOUND);
    const plat = await tx<{ platform: string; active: boolean; client_id: string; store_link: string | null }[]>`
      select platform, active, client_id, store_link from client_platforms
       where id = ${input.clientPlatformId} for update`;
    if (plat.length === 0 || plat[0].client_id !== clientId) throw new NotFoundError(MSG_PLATFORM_NOT_FOUND);
    if (!plat[0].active) throw new ValidationError(MSG_PLATFORM_INACTIVE);
    const platform = plat[0].platform;

    if (!input.files || input.files.length === 0) throw new ValidationError(MSG_NO_FILES);

    // Shopee has NO file-derived range (unlike TikTok's resolveRentang) — the
    // AM's dates are the only source, always. hariAntara/gmvRunRateBulanan are
    // the exact same platform-agnostic date-math TikTok's createReport uses.
    const periodeMulai = (input.periodeMulai ?? '').trim();
    const periodeAkhir = (input.periodeAkhir ?? '').trim();
    const hari = periodeMulai && periodeAkhir ? report.hariAntara(periodeMulai, periodeAkhir) : 0;
    if (!periodeMulai || !periodeAkhir || hari <= 0) throw new ValidationError(MSG_PERIODE_TAK_TERBACA);
    const periode = (input.periode ?? '').trim();
    if (!periode) throw new ValidationError(MSG_PERIODE_LABEL_WAJIB);

    // Detect each file: the team's manual filename convention first, content
    // signature as fallback (reportShopee.detectModule) — see that module's
    // header for why Shopee cannot go content-first the way TikTok's baseline
    // does (ads_toko/ads_produk/ads_banner share one identical column layout).
    const slots: reportShopee.ShopeeSlots = {};
    const berkasMeta: { file: ReportSheetFileInput; type: string | null; rows: number }[] = [];
    const validModules = new Set<string>(reportShopee.ALL_SHOPEE_MODULES);
    for (const f of input.files) {
      const aoa = f.aoa as unknown[][];
      let type: string | null = null;
      if (f.tipeOverride && validModules.has(f.tipeOverride)) {
        type = f.tipeOverride;
      } else {
        const d = reportShopee.detectModule(f.filename, aoa);
        type = d ? d.module : null;
      }
      if (type) slots[type as reportShopee.ShopeeModule] = aoa;
      berkasMeta.push({ file: f, type, rows: aoa.length });
    }
    // Same pre-check the engine itself would throw (verbatim BI message), done
    // here so it lands as a 400 (ValidationError), not an unmapped Error.
    if (!slots.bisnis_home) throw new ValidationError(MSG_BISNIS_HOME_WAJIB);

    const bm = await tx<{ versi: number; nilai: reportShopee.ShopeeBench }[]>`
      select versi, nilai from report_benchmark_shopee where aktif = true order by versi desc limit 1`;
    if (bm.length === 0) throw new ValidationError(MSG_BENCHMARK_KOSONG);
    const bench = bm[0].nilai;
    const benchmarkVersiShopee = bm[0].versi;

    const generatedAt = serverGeneratedAt();
    const result = reportShopee.runShopeeReport(slots, {
      bench,
      benchmarkVersi: benchmarkVersiShopee,
      klien: {
        nama: c.nama_pic, toko: c.toko, platform, kategori: c.kategori,
        account_manager: c.assigned_am_id, store_link: plat[0].store_link ?? null,
      },
      generatedAt,
      periode,
    });

    // SHP-1 (owner decision 2026-09-03, after the Fim Motor UAT). The Bisnis —
    // Home export carries the same table per order status, and the engine now
    // reads all three (`reportShopee.parseBisnisHome`):
    //
    //   gmv_kotor = Pesanan DIBUAT  — the headline Seller Centre shows;
    //   gmv_net   = Pesanan DIBAYAR — money that actually arrived.
    //
    // This matters beyond the report: `gmv_runrate_bulanan` derives from
    // `gmvNet`, and `recomputeTotalSales` reads that column into
    // `clients.total_sales`, which Health Score M13 reads in turn. So the owner
    // choosing "bersih = dibayar" moves the client's health score onto paid
    // money — deliberately, and only for reports created from here on (the
    // table is frozen; old rows are never rewritten).
    //
    // For the Fim Motor export the two differ by Rp 295.710.122 (18,2%): the
    // gross figure included Rp 359.295.534 of cancelled orders.
    //
    // FALLBACK, stated rather than silent: an export with no Pesanan Dibayar
    // section (older exports, and the engine's own two-section fixtures) leaves
    // `kpi.dibayar` null. Net then falls back to the gross figure — the only
    // number that exists — and `payload.periode.gmv_bersih_sumber` records
    // `tidak_tersedia` so both the renderer and any later reader can tell this
    // row's "net" apart from a genuinely paid-based one.
    const gmvKotor = round2(result.payload.kpi.gmv ?? 0);
    const gmvNet = round2(result.payload.kpi.dibayar?.gmv ?? result.payload.kpi.gmv ?? 0);
    const runrate = round2(report.gmvRunRateBulanan(gmvNet, input.periodeTipe, hari));

    // Same house invariant as createReport (TikTok) — raw upload rows are
    // transient, only the derived payload + per-file provenance persist.
    let reportId: number;
    try {
      const ins = await tx<{ id: number }[]>`
        insert into client_reports
          (client_id, client_platform_id, platform, periode_tipe, periode_mulai, periode_akhir,
           hari_periode, rentang_dari_berkas, payload, skor, skor_label, gmv_net, gmv_kotor,
           gmv_runrate_bulanan, payload_schema, benchmark_versi_shopee, engine_versi, kelengkapan_file, created_by)
        values
          (${clientId}, ${input.clientPlatformId}, ${platform}, ${input.periodeTipe},
           ${periodeMulai}, ${periodeAkhir}, ${hari}, false,
           ${tx.json(result.payload as unknown as JsonParam)}, ${result.skor.total}, ${result.skor.label},
           ${gmvNet}, ${gmvKotor}, ${runrate}, 'cdps.report.shopee.v1', ${benchmarkVersiShopee},
           ${reportShopee.ENGINE_VERSI}, ${tx.json((result.payload.kelengkapan_file ?? null) as JsonParam)}, ${actor.employeeId})
        returning id`;
      reportId = ins[0].id;
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictError(MSG_SUDAH_ADA);
      throw e;
    }

    for (const b of berkasMeta) {
      await tx`
        insert into client_report_berkas
          (report_id, nama_berkas, sha256, ukuran_bytes, tipe_terdeteksi, tipe_override,
           jumlah_baris, periode, created_by)
        values
          (${reportId}, ${b.file.filename}, ${b.file.sha256}, ${b.file.ukuranBytes},
           ${b.type ?? null}, ${b.file.tipeOverride ?? null}, ${b.rows}, null, ${actor.employeeId})`;
    }

    await tx`
      insert into client_report_insight
        (report_id, revisi, sumber, ringkasan, poin, rekomendasi_tinggi,
         rekomendasi_sedang, outlook, indikator, tahap_narasi, created_by)
      values
        (${reportId}, 0, ${INSIGHT_SUMBER_MESIN}, ${result.payload.insight.ringkasan},
         ${tx.json(result.payload.insight.poin as unknown as JsonParam)},
         ${tx.json(result.payload.insight.rekomendasi_tinggi as unknown as JsonParam)},
         ${tx.json(result.payload.insight.rekomendasi_sedang as unknown as JsonParam)},
         ${result.payload.insight.outlook},
         ${tx.json(result.payload.insight.indikator as unknown as JsonParam)},
         ${tx.json(result.payload.insight.tahap_narasi as unknown as JsonParam)},
         ${actor.employeeId})`;
    await tx`
      insert into client_report_publikasi (report_id, status, created_by)
      values (${reportId}, ${STATUS_DRAF}, ${actor.employeeId})`;

    await recomputeTotalSales(tx, actor, clientId, reportId, runrate);

    // SH-06: the report's own combined Ads numbers become an auto Metric Entry
    // — the "no manual upload" path for M6D RM-C. See function doc for the
    // even-split mechanism (confirmed with the owner).
    await attributeShopeeAdsMetricEntries(
      tx, actor, clientId, reportId, periodeMulai, periodeAkhir,
      result.payload.kesehatan.ads, input.excludeCampaignIds ?? [],
    );

    return getReportById(tx, reportId);
  });
}

/**
 * attributeShopeeAdsMetricEntries — SH-06's "no manual upload" path for M6D
 * RM-C1/C2/C6 (GMV Eksekusi / ROAS / Ad Spend — all `otomatis`, all read from
 * `metric_entries`). A Shopee report gives ONE combined ads spend/omzet figure
 * (`M.health.ads`, already Σ across ads_toko+ads_produk+ads_banner+ads_live —
 * the file itself cannot say which of the client's several `Shopee Ads`
 * campaigns each rupiah belongs to).
 *
 * Mechanism confirmed with the owner (Yohan, `AskUserQuestion` 2026-09-03,
 * worked through with a concrete two-campaign example before confirming):
 *  - Find every ACTIVE `Shopee Ads` campaign of this client whose
 *    [start_date, end_date] overlaps the report's period, MINUS
 *    `excludeCampaignIds` (the AM's override — "campaign ini dikerjakan
 *    sendiri sama klien", entered manually instead).
 *  - Zero matches → nothing to attach to. No MTR- is created; the report
 *    itself still saves normally and the AM can still log a Metric Entry by
 *    hand exactly as today (this function only ever ADDS a row, never blocks
 *    the report).
 *  - N ≥ 1 matches → the total is divided EVENLY (floor, minor units) across
 *    all N, so Σ across campaigns reconstructs the report's true total
 *    exactly — the split is what's approximate, never the sum. One `MTR-`
 *    per matched campaign, `entry_method='File Export'`.
 *  - `omzet` is `null`, not `0`, when ads ran with no attributable sales at
 *    all (rule 1, `metrik.ts` header) — but `metric_entries.gmv` is NOT NULL,
 *    so a null omzet here is written as Rp0 (a genuine zero once it reaches a
 *    money column — the "no data at all" distinction lives in the payload,
 *    not in this derived row).
 *  - No ads data in the report at all (`ads` is null, i.e. none of
 *    ads_toko/produk/banner/live were uploaded) → nothing to attribute,
 *    silently skipped — same as zero matches.
 *
 * Deliberately scoped to spend/gmv only for this pass — RM-C4/C5 (CTR/CVR)
 * stay "Otomatis + manual fallback" per the PRD either way, so leaving them
 * unpopulated here does not regress the fallback contract.
 */
async function attributeShopeeAdsMetricEntries(
  tx: TransactionSql, actor: Actor, clientId: string, reportId: number,
  periodeMulai: string, periodeAkhir: string,
  ads: { spend: number | null; omzet: number | null } | null,
  excludeCampaignIds: string[],
): Promise<void> {
  const spendVal = ads?.spend ?? 0;
  const omzetVal = ads?.omzet ?? 0;
  if (!ads || !(spendVal > 0 || omzetVal > 0)) return;

  const candidates = await findOverlappingShopeeAdsCampaigns(tx, clientId, periodeMulai, periodeAkhir);
  const excluded = new Set(excludeCampaignIds);
  const targets = candidates.filter((c) => !excluded.has(c.id));
  if (targets.length === 0) return;

  const n = BigInt(targets.length);
  const spendTotal = money.parse(spendVal.toFixed(2));
  const gmvTotal = money.parse(omzetVal.toFixed(2));
  const spendShare = money.decimal(spendTotal / n);
  const gmvShare = money.decimal(gmvTotal / n);

  for (const target of targets) {
    await insertMetricEntryFromReportEngine(
      tx, actor.employeeId, target.id,
      { periodStart: periodeMulai, periodEnd: periodeAkhir, spend: spendShare, gmv: gmvShare },
      {
        source: 'shopee_report', report_id: reportId,
        split_of: targets.length, split_campaign_ids: targets.map((t) => t.id),
      },
    );
  }
}

// ---------------------------------------------------------------------------
// Reads — scope-gated (cross-scope service-role read + in-app gate, pola O52)
// ---------------------------------------------------------------------------
function rowToSummary(r: Record<string, unknown>): ReportSummary {
  return {
    id: Number(r.id),
    clientId: r.client_id as string,
    clientPlatformId: Number(r.client_platform_id),
    platform: r.platform as string,
    periodeTipe: r.periode_tipe as string,
    periodeMulai: dateStr(r.periode_mulai),
    periodeAkhir: dateStr(r.periode_akhir),
    hariPeriode: numOf(r.hari_periode),
    rentangDariBerkas: Boolean(r.rentang_dari_berkas),
    skor: numOrNull(r.skor),
    skorLabel: (r.skor_label as string | null) ?? null,
    gmvNet: numOf(r.gmv_net),
    gmvKotor: numOf(r.gmv_kotor),
    gmvRunrateBulanan: numOf(r.gmv_runrate_bulanan),
    // Exactly one of these is non-null per row (ck_report_benchmark_by_schema,
    // migrasi 20260909010000) — numOrNull, NOT numOf, so a Shopee row's null
    // benchmark_versi (TikTok column) never silently reads as 0.
    benchmarkVersi: numOrNull(r.benchmark_versi),
    benchmarkVersiShopee: numOrNull(r.benchmark_versi_shopee),
    engineVersi: r.engine_versi as string,
    payloadSchema: r.payload_schema as string,
    createdAt: isoTs(r.created_at),
    createdBy: r.created_by as string,
  };
}

/** listReports — a client's report chain, newest period first, scope-gated. */
export async function listReports(sql: Queryable, actor: Actor, clientId: string): Promise<ReportSummary[]> {
  const ownerAm = await ownerAmOfClient(sql, clientId);
  if (!canReadReport(actor, ownerAm)) throw new ForbiddenError(MSG_FORBIDDEN);
  const rows = await sql<Record<string, unknown>[]>`
    select id, client_id, client_platform_id, platform, periode_tipe, periode_mulai, periode_akhir,
           hari_periode, rentang_dari_berkas, skor, skor_label, gmv_net, gmv_kotor,
           gmv_runrate_bulanan, benchmark_versi, benchmark_versi_shopee, engine_versi, payload_schema, created_at, created_by
      from client_reports
     where client_id = ${clientId}
     order by periode_akhir desc, id desc`;
  return rows.map(rowToSummary);
}

/** getReport — one full report bundle (payload + provenance), scope-gated. */
export async function getReport(sql: Queryable, actor: Actor, reportId: number): Promise<ReportDetail> {
  const head = await sql<{ client_id: string }[]>`
    select client_id from client_reports where id = ${reportId}`;
  if (head.length === 0) throw new NotFoundError(MSG_REPORT_NOT_FOUND);
  const ownerAm = await ownerAmOfClient(sql, head[0].client_id);
  if (!canReadReport(actor, ownerAm)) throw new ForbiddenError(MSG_FORBIDDEN);
  return getReportById(sql, reportId);
}

/** Internal read — no gate (callers gate first). Returns the full bundle. */
async function getReportById(sql: Queryable, reportId: number): Promise<ReportDetail> {
  const rows = await sql<Record<string, unknown>[]>`
    select id, client_id, client_platform_id, platform, periode_tipe, periode_mulai, periode_akhir,
           hari_periode, rentang_dari_berkas, skor, skor_label, gmv_net, gmv_kotor,
           gmv_runrate_bulanan, benchmark_versi, benchmark_versi_shopee, engine_versi, payload_schema, created_at, created_by,
           payload, kelengkapan_file
      from client_reports where id = ${reportId}`;
  if (rows.length === 0) throw new NotFoundError(MSG_REPORT_NOT_FOUND);
  const berkasRows = await sql<Record<string, unknown>[]>`
    select id, nama_berkas, sha256, ukuran_bytes, tipe_terdeteksi, tipe_override,
           jumlah_baris, periode
      from client_report_berkas where report_id = ${reportId} order by id`;
  return {
    ...rowToSummary(rows[0]),
    payload: rows[0].payload ?? null,
    kelengkapanFile: rows[0].kelengkapan_file ?? null,
    publikasi: await publikasiOf(sql, reportId),
    berkas: berkasRows.map((b) => ({
      id: Number(b.id),
      namaBerkas: b.nama_berkas as string,
      sha256: b.sha256 as string,
      ukuranBytes: numOf(b.ukuran_bytes),
      tipeTerdeteksi: (b.tipe_terdeteksi as string | null) ?? null,
      tipeOverride: (b.tipe_override as string | null) ?? null,
      jumlahBaris: numOrNull(b.jumlah_baris),
      periode: b.periode ?? null,
    })),
  };
}

/**
 * renderReport — the report as standalone HTML, scope-gated. `internal` mode
 * adds the audit blocks MEA keeps to itself; `klien` omits them (never hides
 * them with CSS — the renderer simply does not build the string).
 *
 * Dispatches by `payload_schema` (Gelombang 2, SH-05): `cdps.report.shopee.v1`
 * renders with the Shopee engine (`@cdps/core` `reportShopee`), everything
 * else (including rows that predate the column, defaulted to
 * `cdps.report.tiktok.v1`) renders with the original TikTok engine. Both
 * engines share the exact `insight` shape (`PayloadInsight`), so
 * `insightForMode`/`publikasi` need no schema-awareness at all.
 */
export async function renderReport(sql: Queryable, actor: Actor, reportId: number, mode: report.RenderMode): Promise<string> {
  const d = await getReport(sql, actor, reportId);
  // `internal` previews the LATEST revision (what pressing "Terbitkan" would
  // send); `klien` renders the PINNED one (what the client is reading right
  // now). A null means this report predates the revision tables, so the frozen
  // payload's own engine text stands — the text that report was built with.
  const insight = await insightForMode(sql, reportId, mode, d.publikasi);
  if (d.payloadSchema === 'cdps.report.shopee.v1') {
    return reportShopee.renderReportHtml(d.payload as reportShopee.ShopeeReportPayload, mode, insight ?? undefined);
  }
  return report.renderReportHtml(d.payload as report.ReportPayload, mode, insight ?? undefined);
}

/**
 * renderReportForDownload — the same document, plus the filename it should be
 * saved as.
 *
 * The name is built HERE, from the stored report, for one reason: the `-INTERNAL`
 * suffix is the only thing distinguishing the two files once they are sitting in
 * a downloads folder next to each other, and an AM about to attach one to a
 * client email must be able to tell them apart at a glance. A caller-supplied
 * name could omit it; this one cannot.
 *
 * Reuses the schema dispatch above rather than duplicating it — a Shopee report
 * downloaded through this path must be the Shopee render, not a TikTok one with
 * a Shopee name.
 */
export async function renderReportForDownload(
  sql: Queryable, actor: Actor, reportId: number, mode: report.RenderMode,
): Promise<{ html: string; namaBerkas: string }> {
  const [html, d] = await Promise.all([
    renderReport(sql, actor, reportId, mode),
    getReport(sql, actor, reportId),
  ]);
  const toko = (d.payload as { klien?: { toko?: string | null; nama?: string | null } } | null)?.klien;
  const nama = (toko?.toko || toko?.nama || 'klien').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '');
  const periode = d.periodeMulai || `${d.hariPeriode}hari`;
  return {
    html,
    namaBerkas: `Laporan-${nama}-${periode}${mode === 'internal' ? '-INTERNAL' : ''}.html`,
  };
}

// ===========================================================================
// Insight yang bisa disunting + gerbang publikasi (migrasi 20260908010000)
// ===========================================================================
//
// Pembagian kerjanya satu baris: ANGKA laporan immutable, NARASINYA tidak.
//
// Yang membuat ini tidak sekadar "kolom teks yang bisa diedit":
//
//  * Revisi append-only. Satu baris per suntingan, revisi 0 selalu snapshot
//    mesin. Yang dibaca klien bukan yang terbaru melainkan yang DIPAKU di
//    `client_report_publikasi.insight_revisi` — jadi menyimpan draf aman
//    walaupun laporannya sudah tayang, dan `Terbitkan pembaruan` yang
//    memindahkan paku. Tanpa paku, setiap tekan "Simpan" langsung jadi
//    pengumuman.
//
//  * Pratinjau internal membaca revisi TERBARU; render klien membaca yang
//    TERPAKU. Dua kebenaran yang memang beda, bukan satu yang dikompromikan.
//
//  * Status hanya lewat `sm_transition`. Tidak ada `update ... set status` di
//    berkas ini — kalau ada, gerbang peran + baris audit + row lock hilang
//    sekaligus.

/** Read the publication row. Absent = a report created before this cluster shipped. */
async function publikasiOf(sql: Queryable, reportId: number): Promise<ReportPublikasi> {
  const rows = await sql<Record<string, unknown>[]>`
    select status, insight_revisi, diterbitkan_pada, diterbitkan_oleh,
           dicabut_pada, dicabut_oleh, alasan_cabut
      from client_report_publikasi where report_id = ${reportId}`;
  if (rows.length === 0) {
    // Defensive, not a fallback with opinions: a report whose publication row is
    // missing reads as an UNPUBLISHED draft, never as published. The failure mode
    // of a missing row must be "the client sees nothing", not "the client sees
    // everything".
    return {
      status: STATUS_DRAF, insightRevisi: null, diterbitkanPada: null, diterbitkanOleh: null,
      dicabutPada: null, dicabutOleh: null, alasanCabut: null,
    };
  }
  const r = rows[0];
  return {
    status: r.status as string,
    insightRevisi: numOrNull(r.insight_revisi),
    diterbitkanPada: r.diterbitkan_pada == null ? null : isoTs(r.diterbitkan_pada),
    diterbitkanOleh: (r.diterbitkan_oleh as string | null) ?? null,
    dicabutPada: r.dicabut_pada == null ? null : isoTs(r.dicabut_pada),
    dicabutOleh: (r.dicabut_oleh as string | null) ?? null,
    alasanCabut: (r.alasan_cabut as string | null) ?? null,
  };
}

function rowToInsightRevisi(r: Record<string, unknown>): ReportInsightRevisi {
  return {
    revisi: numOf(r.revisi),
    sumber: r.sumber as string,
    insight: {
      ringkasan: r.ringkasan as string,
      poin: (r.poin ?? []) as string[],
      rekomendasi_tinggi: (r.rekomendasi_tinggi ?? []) as report.PayloadInsight['rekomendasi_tinggi'],
      rekomendasi_sedang: (r.rekomendasi_sedang ?? []) as report.PayloadInsight['rekomendasi_sedang'],
      outlook: r.outlook as string,
      indikator: (r.indikator ?? []) as report.PayloadInsight['indikator'],
      // `?? []` is not defensive padding: revisions written before R3 predate the
      // column, and `DEFAULT '[]'` only fills rows inserted after it. An older
      // revision genuinely HAS no stage prose, and `[]` is that fact.
      tahap_narasi: (r.tahap_narasi ?? []) as report.PayloadInsight['tahap_narasi'],
    },
    catatanRevisi: (r.catatan_revisi as string | null) ?? null,
    createdAt: isoTs(r.created_at),
    createdBy: r.created_by as string,
  };
}

const INSIGHT_COLS = `revisi, sumber, ringkasan, poin, rekomendasi_tinggi,
  rekomendasi_sedang, outlook, indikator, tahap_narasi, catatan_revisi, created_at, created_by`;

/** Every stored revision of one report, oldest first (revisi 0 leads). */
async function revisiOf(sql: Queryable, reportId: number): Promise<ReportInsightRevisi[]> {
  const rows = await sql<Record<string, unknown>[]>`
    select ${sql.unsafe(INSIGHT_COLS)}
      from client_report_insight where report_id = ${reportId} order by revisi`;
  return rows.map(rowToInsightRevisi);
}

/**
 * Resolve the insight a given render mode must use.
 *
 *  - `klien`    → the PINNED revision. If nothing is pinned there is nothing a
 *    client may read, so the caller must have refused before reaching here;
 *    falling back to "latest" would publish an unpublished draft.
 *  - `internal` → the LATEST revision, so the AM previews exactly what pressing
 *    "Terbitkan" would send.
 *
 * Returns null only when the report predates this cluster and has no revision
 * rows at all; the caller then falls back to `payload.insight` — the engine text
 * that report was actually built with.
 */
async function insightForMode(
  sql: Queryable, reportId: number, mode: report.RenderMode, pub: ReportPublikasi,
): Promise<report.PayloadInsight | null> {
  const target = mode === 'klien' ? pub.insightRevisi : null;
  const rows = target == null
    ? await sql<Record<string, unknown>[]>`
        select ${sql.unsafe(INSIGHT_COLS)} from client_report_insight
         where report_id = ${reportId} order by revisi desc limit 1`
    : await sql<Record<string, unknown>[]>`
        select ${sql.unsafe(INSIGHT_COLS)} from client_report_insight
         where report_id = ${reportId} and revisi = ${target}`;
  if (rows.length === 0) return null;
  return rowToInsightRevisi(rows[0]).insight;
}

/** getReportInsight — the editing surface: engine text, latest edit, pinned revision. */
export async function getReportInsight(sql: Queryable, actor: Actor, reportId: number): Promise<ReportInsightBundle> {
  const head = await sql<{ client_id: string }[]>`
    select client_id from client_reports where id = ${reportId}`;
  if (head.length === 0) throw new NotFoundError(MSG_REPORT_NOT_FOUND);
  const ownerAm = await ownerAmOfClient(sql, head[0].client_id);
  if (!canReadReport(actor, ownerAm)) throw new ForbiddenError(MSG_FORBIDDEN);

  const [pub, revisi] = await Promise.all([publikasiOf(sql, reportId), revisiOf(sql, reportId)]);
  if (revisi.length === 0) throw new NotFoundError(MSG_INSIGHT_NOT_FOUND);
  const terbaru = revisi[revisi.length - 1];
  const mesin = revisi[0];
  const terpaku = pub.insightRevisi == null
    ? null
    : revisi.find((r) => r.revisi === pub.insightRevisi) ?? null;
  return {
    reportId,
    publikasi: pub,
    terbaru,
    mesin,
    terpaku,
    adaPerubahanBelumTerbit: pub.insightRevisi != null && terbaru.revisi > pub.insightRevisi,
  };
}

/** Gate + load for every WRITE below: one place, so no verb forgets the check. */
async function requireWritableReport(tx: TransactionSql, actor: Actor, reportId: number): Promise<{ clientId: string; pub: ReportPublikasi }> {
  const head = await tx<{ client_id: string }[]>`
    select client_id from client_reports where id = ${reportId} for update`;
  if (head.length === 0) throw new NotFoundError(MSG_REPORT_NOT_FOUND);
  const ownerAm = await ownerAmOfClient(tx, head[0].client_id);
  if (!canWriteReport(actor, ownerAm)) throw new ForbiddenError(MSG_FORBIDDEN);
  return { clientId: head[0].client_id, pub: await publikasiOf(tx, reportId) };
}

/** Append one revision. `sumber` decides the revisi number: mesin ⇒ 0 is taken, so always manual here. */
async function appendRevisi(
  tx: TransactionSql, actor: Actor, reportId: number,
  insight: report.PayloadInsight, catatan: string | null,
): Promise<number> {
  const maxRow = await tx<{ maks: number | null }[]>`
    select max(revisi) as maks from client_report_insight where report_id = ${reportId}`;
  // No revision rows at all means the report predates this cluster: seed the
  // engine snapshot from the frozen payload first, so revisi 0 keeps its meaning
  // ("what the machine said") for old reports too and "kembalikan ke insight
  // mesin" works on them.
  if (maxRow[0].maks == null) {
    const pay = await tx<{ payload: { insight?: report.PayloadInsight } }[]>`
      select payload from client_reports where id = ${reportId}`;
    const eng = pay[0]?.payload?.insight;
    if (eng) await insertRevisi(tx, actor, reportId, 0, INSIGHT_SUMBER_MESIN, eng, 'snapshot mesin (disisipkan saat suntingan pertama)');
  }
  const revisi = maxRow[0].maks == null ? 1 : (maxRow[0].maks as number) + 1;
  await insertRevisi(tx, actor, reportId, revisi, INSIGHT_SUMBER_MANUAL, insight, catatan);
  return revisi;
}

async function insertRevisi(
  tx: TransactionSql, actor: Actor, reportId: number, revisi: number, sumber: string,
  insight: report.PayloadInsight, catatan: string | null,
): Promise<void> {
  await tx`
    insert into client_report_insight
      (report_id, revisi, sumber, ringkasan, poin, rekomendasi_tinggi,
       rekomendasi_sedang, outlook, indikator, tahap_narasi, catatan_revisi, created_by)
    values
      (${reportId}, ${revisi}, ${sumber}, ${insight.ringkasan},
       ${tx.json(insight.poin as unknown as JsonParam)},
       ${tx.json(insight.rekomendasi_tinggi as unknown as JsonParam)},
       ${tx.json(insight.rekomendasi_sedang as unknown as JsonParam)},
       ${insight.outlook},
       ${tx.json(insight.indikator as unknown as JsonParam)},
       ${tx.json(insight.tahap_narasi as unknown as JsonParam)},
       ${catatan == null || catatan.trim() === '' ? null : catatan.trim()}, ${actor.employeeId})`;
  const ex = executors(tx);
  await ex.audit.insertAudit({
    entityType: ENTITY_REPORT,
    entityId: String(reportId),
    actorEmployeeId: actor.employeeId,
    action: 'insight_revisi',
    beforeJson: null,
    // The text itself lives in the (append-only) revision row; the audit row
    // records WHICH revision appeared and by whom, so the two never disagree
    // and the log stays readable.
    afterJson: { revisi, sumber, catatan_revisi: catatan ?? null },
    createdBy: actor.employeeId,
  });
}

/**
 * saveReportInsight — append the AM's edited narrative as a new revision.
 *
 * Deliberately does NOT change what the client sees, even on a published
 * report: publishing is a separate, explicit act (`publishReport` /
 * `republishReport`). Saving must be safe enough to do mid-thought.
 */
export async function saveReportInsight(
  sql: Sql, actor: Actor, reportId: number, draft: report.InsightDraft, catatan?: string | null,
): Promise<ReportInsightBundle> {
  // Validate BEFORE opening the transaction: a rejected draft must not consume a
  // revision number, and `normalizeInsightDraft` throws the BI `[...]` message.
  const insight = report.normalizeInsightDraft(draft);
  return withTransaction(sql, async (tx) => {
    await requireWritableReport(tx, actor, reportId);
    await appendRevisi(tx, actor, reportId, insight, catatan ?? null);
    return getReportInsight(tx, actor, reportId);
  });
}

/**
 * resetReportInsight — bring back the engine's own narrative as a NEW revision.
 *
 * Copies revisi 0 rather than re-running the engine: the benchmark version may
 * have moved on since, and "kembalikan ke insight mesin" must mean the text this
 * report was built with, not a text some later calibration would produce.
 */
export async function resetReportInsight(sql: Sql, actor: Actor, reportId: number): Promise<ReportInsightBundle> {
  return withTransaction(sql, async (tx) => {
    await requireWritableReport(tx, actor, reportId);
    // `INSIGHT_COLS`, not a third hand-written column list. A field that exists
    // in the table but not in THIS list silently vanishes on reset — the AM
    // presses "kembalikan ke insight mesin" and loses the one part the copy
    // forgot, with nothing to indicate it happened.
    const rows = await tx<Record<string, unknown>[]>`
      select ${tx.unsafe(INSIGHT_COLS)}
        from client_report_insight where report_id = ${reportId} and revisi = 0`;
    if (rows.length === 0) throw new NotFoundError(MSG_INSIGHT_NOT_FOUND);
    const mesin = rowToInsightRevisi(rows[0]).insight;
    await appendRevisi(tx, actor, reportId, mesin, 'dikembalikan ke insight mesin');
    return getReportInsight(tx, actor, reportId);
  });
}

/** Move the publication row through the machine. Status is NEVER written directly. */
async function pubTransition(tx: TransactionSql, actor: Actor, reportId: number, to: string): Promise<void> {
  const res = await statemachine.transition(executors(tx).sm, {
    machine: MACHINE_REPORT,
    entityType: ENTITY_REPORT,
    table: TABLE_PUBLIKASI,
    idColumn: 'report_id',
    entityId: String(reportId),
    to,
    actor,
  });
  // Same mapping as every other module (account.ts / ads.ts `transitionError`):
  // role_denied is a 403, anything else the engine refuses is a 409, and the
  // engine's own BI `[...]` message is passed through verbatim.
  if (!res.ok) {
    throw res.code === 'role_denied' ? new ForbiddenError(res.message) : new ConflictError(res.message);
  }
}

/**
 * publishReport — `[Draf]`/`[Dicabut]` → `[Terbit]`, pinning the latest revision.
 *
 * The pin is what makes publication meaningful: from here the client reads THIS
 * revision and nothing later, until someone republishes.
 */
export async function publishReport(sql: Sql, actor: Actor, reportId: number): Promise<ReportPublikasi> {
  return withTransaction(sql, async (tx) => {
    const { pub } = await requireWritableReport(tx, actor, reportId);
    if (pub.status === STATUS_TERBIT) throw new ConflictError(MSG_SUDAH_TERBIT);
    const maks = await tx<{ maks: number | null }[]>`
      select max(revisi) as maks from client_report_insight where report_id = ${reportId}`;
    if (maks[0].maks == null) throw new NotFoundError(MSG_INSIGHT_NOT_FOUND);
    const revisi = maks[0].maks as number;

    // Order is dictated by the row's CHECKs, and each step is only legal in one
    // place: leave `[Dicabut]` FIRST (clearing the revocation stamps while still
    // `[Dicabut]` would violate ck_crp_cabut_lengkap), then write the pin and
    // stamps while `[Draf]` (no CHECK applies), then enter `[Terbit]` (whose
    // CHECK now finds the pin already present). A failure at any point rolls the
    // whole transaction back, so a published row without a pinned revision is
    // not reachable.
    if (pub.status === STATUS_DICABUT) await pubTransition(tx, actor, reportId, STATUS_DRAF);
    await tx`
      update client_report_publikasi
         set insight_revisi = ${revisi}, diterbitkan_pada = now(), diterbitkan_oleh = ${actor.employeeId},
             dicabut_pada = null, dicabut_oleh = null, alasan_cabut = null
       where report_id = ${reportId}`;
    await pubTransition(tx, actor, reportId, STATUS_TERBIT);
    return publikasiOf(tx, reportId);
  });
}

/**
 * republishReport — move the pin on an already-published report to the newest
 * revision. Not a machine edge: the status does not change, only WHICH text the
 * client reads, so modelling it as a self-loop would add an edge that means
 * nothing and hide the real event from the audit log.
 */
export async function republishReport(sql: Sql, actor: Actor, reportId: number): Promise<ReportPublikasi> {
  return withTransaction(sql, async (tx) => {
    const { pub } = await requireWritableReport(tx, actor, reportId);
    if (pub.status !== STATUS_TERBIT) throw new ConflictError(MSG_BELUM_TERBIT);
    const maks = await tx<{ maks: number | null }[]>`
      select max(revisi) as maks from client_report_insight where report_id = ${reportId}`;
    const revisi = maks[0].maks;
    if (revisi == null) throw new NotFoundError(MSG_INSIGHT_NOT_FOUND);
    if (pub.insightRevisi != null && revisi <= pub.insightRevisi) {
      throw new ConflictError(MSG_TAK_ADA_PERUBAHAN);
    }
    await tx`
      update client_report_publikasi
         set insight_revisi = ${revisi}, diterbitkan_pada = now(), diterbitkan_oleh = ${actor.employeeId}
       where report_id = ${reportId}`;
    const ex = executors(tx);
    await ex.audit.insertAudit({
      entityType: ENTITY_REPORT,
      entityId: String(reportId),
      actorEmployeeId: actor.employeeId,
      action: 'insight_dipaku',
      beforeJson: { insight_revisi: pub.insightRevisi },
      afterJson: { insight_revisi: revisi },
      createdBy: actor.employeeId,
    });
    return publikasiOf(tx, reportId);
  });
}

/**
 * revokeReport — `[Terbit]` → `[Dicabut]`.
 *
 * The pin is deliberately KEPT: after a revocation the most useful fact on the
 * row is which revision the client had already read, and readability is governed
 * by `status`, which every client read path gates on. The reason is mandatory
 * because a client asking "where did my report go" deserves an answer that
 * exists somewhere.
 *
 * Stamp first, transition second — while the row is still `[Terbit]` the pin is
 * present, so its CHECK holds; once it turns `[Dicabut]` the reason is already
 * there for the other CHECK.
 */
export async function revokeReport(sql: Sql, actor: Actor, reportId: number, alasan: string): Promise<ReportPublikasi> {
  const reason = (alasan ?? '').trim();
  if (reason === '') throw new ValidationError(MSG_ALASAN_CABUT_WAJIB);
  return withTransaction(sql, async (tx) => {
    const { pub } = await requireWritableReport(tx, actor, reportId);
    if (pub.status !== STATUS_TERBIT) throw new ConflictError(MSG_BELUM_TERBIT);
    await tx`
      update client_report_publikasi
         set dicabut_pada = now(), dicabut_oleh = ${actor.employeeId}, alasan_cabut = ${reason}
       where report_id = ${reportId}`;
    await pubTransition(tx, actor, reportId, STATUS_DICABUT);
    return publikasiOf(tx, reportId);
  });
}

/**
 * One active `Shopee Ads` campaign the report's ads figure would be split
 * across (SH-06). `budget` is the house-formatted string (rule #7), not a
 * number — the form only displays it, and every other money field crossing
 * this boundary is already a formatted string.
 */
export interface ShopeeAdsCampaignOption {
  id: string;
  objective: string;
  tipeIklan: string;
  startDate: string;
  endDate: string;
  budget: string;
}

/**
 * The active `Shopee Ads` campaigns whose dates overlap a period — i.e. exactly
 * the set `attributeShopeeAdsMetricEntries` would split this report's combined
 * ads spend/omzet across (SH-06).
 *
 * A read for the upload form's "exclude campaign" list, and deliberately the
 * SAME predicate the split itself uses (`findOverlappingShopeeAdsCampaigns`,
 * `ads.ts`): the AM must not be offered a list assembled by a second copy of
 * "which campaigns overlap", because a copy can disagree with the split it is
 * supposed to describe. This function only adds the DISPLAY columns on top of
 * the ids that predicate returns.
 *
 * Read scope, not write scope: `canReadReport`, same as `listReports` — seeing
 * which campaigns a report would touch is a read, and an OD must be able to
 * check it without being able to create the report.
 */
/**
 * R3 — set (or clear) the buyer-journey stage a store is chasing.
 *
 * ## Why this is not part of `updatePlatform`
 *
 * `client.updatePlatform` is gated on `canEditProfile`: Account LEAD, OD or
 * Director. That is the right gate for the store's identity — its link, when MEA
 * took it on, whether it is still on the list. The focus stage is not identity,
 * it is a REPORTING judgement, and the person who makes it is the AM who writes
 * the report. Routing it through the profile gate would leave the owning AM
 * unable to set the one field the report asks them for, and would push a monthly
 * decision onto a lead who is not in the conversation.
 *
 * So it uses `canWriteReport` — the same scope that already decides who may
 * generate, edit and publish this client's reports. One decision, one gate.
 *
 * ## Why an inactive store is still allowed
 *
 * Deliberately no `active` check, unlike `createReport`. A store can be
 * deactivated mid-month with a report for that month still to write, and the
 * stage is read at generation time. Refusing here would block a correction to a
 * period that has already happened.
 *
 * Audited before→after: this value ends up stamped on every future report, so
 * "who moved this shop to Conversion, and when" has to be answerable.
 */
export async function setTahapFokus(
  sql: Sql, actor: Actor, clientId: string, platformId: number, tahap: string | null,
): Promise<report.TahapKey | null> {
  const bersih = (tahap ?? '').trim();
  // Empty string and null both mean "not set" — a <select> submits the empty
  // option as '', and refusing that would make the field one-way.
  const nilai: report.TahapKey | null = bersih === '' ? null : (bersih as report.TahapKey);
  if (nilai !== null && !report.isTahapKey(nilai)) {
    throw new ValidationError(MSG_TAHAP_FOKUS_TAK_DIKENAL);
  }

  return withTransaction(sql, async (tx) => {
    // Throws MSG_CLIENT_NOT_FOUND itself when the client does not exist.
    const ownerAm = await ownerAmOfClient(tx, clientId);
    if (!canWriteReport(actor, ownerAm)) throw new ForbiddenError(MSG_FORBIDDEN);

    const rows = await tx<{ tahap_fokus: string | null }[]>`
      select tahap_fokus from client_platforms
       where id = ${platformId} and client_id = ${clientId} for update`;
    if (rows.length === 0) throw new NotFoundError(MSG_PLATFORM_NOT_FOUND);
    const sebelum = rows[0].tahap_fokus;

    await tx`update client_platforms set tahap_fokus = ${nilai} where id = ${platformId}`;
    const ex = executors(tx);
    await ex.audit.insertAudit({
      entityType: 'client', entityId: clientId, actorEmployeeId: actor.employeeId,
      action: 'tahap_fokus_diubah',
      beforeJson: { platform_id: platformId, tahap_fokus: sebelum },
      afterJson: { platform_id: platformId, tahap_fokus: nilai },
      createdBy: actor.employeeId,
    });
    return nilai;
  });
}

export async function listShopeeAdsCampaignsForPeriod(
  sql: Queryable, actor: Actor, clientId: string, periodeMulai: string, periodeAkhir: string,
): Promise<ShopeeAdsCampaignOption[]> {
  const ownerAm = await ownerAmOfClient(sql, clientId);
  if (!canReadReport(actor, ownerAm)) throw new ForbiddenError(MSG_FORBIDDEN);
  const mulai = (periodeMulai ?? '').trim();
  const akhir = (periodeAkhir ?? '').trim();
  if (!mulai || !akhir || report.hariAntara(mulai, akhir) <= 0) {
    throw new ValidationError(MSG_PERIODE_TAK_TERBACA);
  }
  const overlapping = await findOverlappingShopeeAdsCampaigns(sql, clientId, mulai, akhir);
  if (overlapping.length === 0) return [];
  const ids = overlapping.map((c) => c.id);
  const rows = await sql<Record<string, unknown>[]>`
    select id, objective, tipe_iklan, start_date, end_date, budget
      from ad_campaigns
     where id = any(${ids})
     order by id`;
  return rows.map((r) => ({
    id: r.id as string,
    objective: r.objective as string,
    tipeIklan: r.tipe_iklan as string,
    startDate: dateStr(r.start_date),
    endDate: dateStr(r.end_date),
    budget: money.format(money.parse(String(r.budget))),
  }));
}
