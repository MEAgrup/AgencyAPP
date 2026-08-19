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
import { baseline, permission, report } from '@cdps/core';
import { executors, withTransaction, type Queryable, type Sql, type TransactionSql } from '@cdps/db';
import {
  ACCOUNT_DIVISION,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  type Actor,
} from './account';
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
  benchmarkVersi: number;
  engineVersi: string;
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
    const plat = await tx<{ platform: string; active: boolean; client_id: string; store_link: string | null }[]>`
      select platform, active, client_id, store_link from client_platforms
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
    });

    const gmvNet = round2(result.M.kpi.gmv);
    const gmvKotor = round2(result.M.kpi.gmvKotor);
    const runrate = round2(report.gmvRunRateBulanan(result.M.kpi.gmv, input.periodeTipe, hari));

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
    benchmarkVersi: numOf(r.benchmark_versi),
    engineVersi: r.engine_versi as string,
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
           gmv_runrate_bulanan, benchmark_versi, engine_versi, created_at, created_by
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
           gmv_runrate_bulanan, benchmark_versi, engine_versi, created_at, created_by,
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
 */
export async function renderReport(sql: Queryable, actor: Actor, reportId: number, mode: report.RenderMode): Promise<string> {
  const d = await getReport(sql, actor, reportId);
  return report.renderReportHtml(d.payload as report.ReportPayload, mode);
}
