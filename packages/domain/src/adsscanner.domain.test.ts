/**
 * Gelombang 4 (TikTok Ads Scanner) domain layer — `runAdsScan` and its reads
 * over `adsscanner_run` / `adsscanner_benchmark` (migration `20260910010000`).
 *
 * What this file is actually FOR (the engine's own math is already covered by
 * `packages/core/src/adsscanner/tiktok/adsscanner.test.ts` — 30 cases — and is
 * deliberately not re-tested here):
 *
 *  - **server-side detection into the 4 slots**, including the two gates that
 *    reject rather than degrade silently (unknown category, missing Analitik
 *    Produk) and the `Ringkasan data` wrong-export guard;
 *  - **immutability** — no UPDATE and no DELETE path exists on a stored scan
 *    (house rule #3; the DB trigger is the wall, this proves it stands);
 *  - **permissions per role**, including the layered OD/Director pair and the
 *    Ads-division lead, mirroring the migration's own RLS predicate;
 *  - **recompute-from-payload** — a stored scan re-scored from its own
 *    recorded `benchmark_versi` reproduces the same score/bucket (house rule
 *    #4), which is the whole reason the benchmark is a versioned table;
 *  - the **portfolio** query's row scope, which is the read pattern that
 *    justified a table of its own (O69).
 *
 * Fixture column strings are duplicated from the engine test verbatim, per the
 * house convention `report.shopee.domain.test.ts` follows — the domain layer
 * keeps its own copy so it never depends on `@cdps/core`'s test file.
 *
 * Skipped unless DATABASE_URL is set. Rows namespaced `ZZAS-` — distinct from
 * `ZZR-` (report.domain), `ZZRS-` (report.shopee.domain) and `ZZ-` (ads),
 * which all share one real Postgres DB and must never LIKE-collide on cleanup.
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { adsscanner as engine, permission } from '@cdps/core';
import { createClient, type Sql } from '@cdps/db';
import { ForbiddenError, NotFoundError, ValidationError, type Actor } from './account';
import {
  adsScanCategories,
  adsScanPortfolio,
  canReadAdsScan,
  canWriteAdsScan,
  getAdsScanRun,
  listAdsScanRuns,
  MSG_ANALITIK_WAJIB,
  MSG_FORBIDDEN,
  MSG_KATEGORI_TIDAK_DIKENALI,
  MSG_KATEGORI_WAJIB,
  MSG_MINGGU_TIDAK_VALID,
  MSG_NO_FILES,
  MSG_RINGKASAN_DATA,
  MSG_RUN_NOT_FOUND,
  MSG_TIDAK_DIKENALI,
  renderAdsScanHtml,
  runAdsScan,
  type AdsScanFileInput,
} from './adsscanner';

// ---------------------------------------------------------------------------
// Export fixtures — verbatim header strings from the engine's own test.
// The header ROW INDEX matters as much as the strings (FILE_SIGS pins each
// export to a fixed row): analitik row 3, ads row 0, video row 2, adslive 0.
// ---------------------------------------------------------------------------
const ANALITIK_HEADER = ['Nama', 'ID Produk', 'GMV', 'Status daftar produk', 'GMV dari kreator', 'GMV dari video penjual', 'GMV dari LIVE penjual', 'Pesanan SKU', 'AOV (pesanan SKU)', 'CTR', 'CTOR (pesanan SKU)', 'Persentase tambahkan ke keranjang', 'Impresi produk', 'Klik produk'];
const ADS_HEADER = ['Nama kampanye', 'ID produk', 'Biaya', 'Pendapatan kotor', 'Pesanan SKU', 'ID video', 'Akun TikTok', 'Judul video', 'Jenis materi iklan', 'Jenis otorisasi', 'Tingkat klik iklan produk', 'Rasio konversi iklan', 'ROI'];
const VIDEO_HEADER = ['Nama Kreator', 'ID Video', 'Produk', 'VV', 'GMV dari video (Rp)', 'GPM (Rp)', 'Informasi Video', 'Waktu', 'Rasio klik tayang (Video)', 'Persentase Video yang Ditonton Hingga Selesai', 'ID Kreator'];
const ADSLIVE_HEADER = ['Nama LIVE', 'Nama kampanye', 'Biaya'];

const PID = '1729643540462601638';

/** Analitik Produk: header at row 3, two SKUs (one healthy, one no-traffic → null CTR/CTOR). */
const analitikAoa = (): unknown[][] => [
  [], [], [],
  ANALITIK_HEADER,
  ['Produk A', PID, 'Rp10.000.000', 'Aktif', 'Rp6.000.000', 'Rp2.000.000', 'Rp2.000.000', '100', 'Rp100.000', '5%', '10%', '3%', '20000', '1000'],
  ['Produk B', '1888888888888888888', 'Rp500.000', 'Aktif', 'Rp0', 'Rp500.000', 'Rp0', '5', 'Rp100.000', '', '', '0%', '0', '0'],
];
const adsAoa = (): unknown[][] => [
  ADS_HEADER,
  ['Kampanye A', PID, 'Rp1.000.000', 'Rp5.000.000', '50', 'v1', 'akun1', 'Judul', 'Video', 'Resmi', '4%', '2%', '5'],
];
const videoAoa = (): unknown[][] => [
  [], [],
  VIDEO_HEADER,
  ['C1', '123456789012', `Produk A (${PID})`, '50000', 'Rp3.000.000', 'Rp60.000', 'review jujur produk ini bikin kaget', '2026-09-01', '4%', '35%', 'k1'],
  ['C2', '123456789013', `Produk A (${PID})`, '30000', 'Rp1.000.000', 'Rp33.000', 'sebelum vs sesudah pakai ini', '2026-09-02', '3%', '30%', 'k2'],
];
const adsliveAoa = (): unknown[][] => [
  ADSLIVE_HEADER,
  ['LIVE A', 'Kampanye A', 'Rp50.000'],
];

const SHA = 'c'.repeat(64);
const file = (nama: string, aoa: unknown[][], extra: Partial<AdsScanFileInput> = {}): AdsScanFileInput =>
  ({ namaBerkas: nama, sha256: SHA, ukuranBytes: 1024, aoa, ...extra });

const analitikFile = () => file('analitik-produk.xlsx', analitikAoa());
const adsFile = () => file('ads-produk.xlsx', adsAoa());
const videoKreatorFile = () => file('video-affiliate-kreator.xlsx', videoAoa());
const videoTokoFile = () => file('video-bisnis-toko.xlsx', videoAoa());
const adsliveFile = () => file('ads-live.xlsx', adsliveAoa());

// The category MUST exist in the seeded benchmark v1 — that is gate #1.
const KATEGORI = 'Fashion Accessories';

// ---------------------------------------------------------------------------
// DB integration
// ---------------------------------------------------------------------------
const URL = process.env.DATABASE_URL;
const describeDb = describe.skipIf(!URL);
let sql: Sql;
if (URL) sql = createClient(URL);

const RUN = Date.now().toString(36).slice(-6);
let seq = 0;
const uid = (p: string): string => `${p}-ZZAS-${RUN}-${seq++}`;

const AM = 'ZZAS-AM';
// OD and Director are FLAGS on the role, not division levels (permission.makeRole)
// — the layered-role shape CLAUDE.md rule #6 describes.
const actorAdvertiser: Actor = { employeeId: 'ZZAS-ADV', divisi: 'Ads', role: permission.makeRole({ division: 'Ads', level: 'staff' }) };
const actorAdvertiser2: Actor = { employeeId: 'ZZAS-ADV2', divisi: 'Ads', role: permission.makeRole({ division: 'Ads', level: 'staff' }) };
const actorAdsLead: Actor = { employeeId: 'ZZAS-ADSLEAD', divisi: 'Ads', role: permission.makeRole({ division: 'Ads', level: 'lead' }) };
const actorAm: Actor = { employeeId: AM, divisi: 'Account', role: permission.makeRole({ division: 'Account', level: 'staff' }) };
const actorCreative: Actor = { employeeId: 'ZZAS-CRE', divisi: 'Creative', role: permission.makeRole({ division: 'Creative', level: 'staff' }) };
const actorDirector: Actor = { employeeId: 'ZZAS-DIR', divisi: 'Management', role: permission.makeRole({ director: true }) };
const actorOd: Actor = { employeeId: 'ZZAS-OD', divisi: 'Management', role: permission.makeRole({ od: true }) };

async function seedClient(amId = AM): Promise<string> {
  const client = uid('CLI');
  await sql`
    insert into clients
      (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv, total_sales,
       sales_pic_id, commission_payment_pic_id, assigned_am_id, released_to_account_at, created_by)
    values (${client}, 'Rani', 'Toko Sperantia', 'Bandung', 'https://tiktok.com/@sperantia',
            'Fashion', 0, 0, 0, 'ZZAS-SALES', 'ZZAS-SALES', ${amId}, now(), ${AM})`;
  return client;
}

const scanInput = (clientId: string, files = [analitikFile()], extra = {}) =>
  ({ clientId, kategori: KATEGORI, mingguMulai: '2026-09-03', files, ...extra });

afterEach(async () => {
  if (!sql) return;
  // adsscanner_run is frozen against DELETE too (that is the point) — the
  // trigger has to be lifted to clean up, exactly as report.shopee.domain does
  // for client_report_insight. Re-enabled in `finally` so a failing assertion
  // never leaves the table mutable for the next file in the run.
  await sql`alter table adsscanner_run disable trigger trg_adsscanner_run_no_delete`;
  try {
    await sql`delete from adsscanner_run where client_id like 'CLI-ZZAS-%'`;
  } finally {
    await sql`alter table adsscanner_run enable trigger trg_adsscanner_run_no_delete`;
  }
  await sql`delete from clients where id like 'CLI-ZZAS-%'`;
});
afterAll(async () => { if (sql) await sql.end(); });

// ══════════════════════════════════════════════════════════════════════════
// Pure permission predicates (no DB) — the gates, stated once.
// ══════════════════════════════════════════════════════════════════════════
describe('adsscanner — permission predicates', () => {
  const owners = new Set<string>(['ZZAS-AM']);
  const noOwners = new Set<string>();

  it('write scope is Ads staff/lead or Director, and nobody else', () => {
    expect(canWriteAdsScan(actorAdvertiser)).toBe(true);
    expect(canWriteAdsScan(actorAdsLead)).toBe(true);
    expect(canWriteAdsScan(actorDirector)).toBe(true);
    expect(canWriteAdsScan(actorCreative)).toBe(false);
    expect(canWriteAdsScan(actorAm)).toBe(false);
  });

  it('OD is read-only — it may READ a scan it does not own but may not WRITE one', () => {
    expect(canWriteAdsScan(actorOd)).toBe(false);
    expect(canReadAdsScan(actorOd, 'someone-else', noOwners)).toBe(true);
  });

  it('read scope: creator, client PIC, or Ads lead — a Creative staffer gets nothing', () => {
    expect(canReadAdsScan(actorAdvertiser, actorAdvertiser.employeeId, noOwners)).toBe(true);
    expect(canReadAdsScan(actorAm, 'someone-else', owners)).toBe(true);
    expect(canReadAdsScan(actorAdsLead, 'someone-else', noOwners)).toBe(true);
    expect(canReadAdsScan(actorCreative, 'someone-else', noOwners)).toBe(false);
    // An Ads STAFFER who neither created the row nor holds the client is out —
    // "staff = own data only" (CLAUDE.md rule #6) is not softened by division.
    expect(canReadAdsScan(actorAdvertiser2, actorAdvertiser.employeeId, noOwners)).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════
describeDb('runAdsScan — validation gates (BI messages, exact)', () => {
  it('rejects a non-Ads, non-Director actor before any parsing', async () => {
    const client = await seedClient();
    await expect(runAdsScan(sql, actorCreative, scanInput(client))).rejects.toThrow(ForbiddenError);
    await expect(runAdsScan(sql, actorCreative, scanInput(client))).rejects.toThrow(MSG_FORBIDDEN);
  });

  it('404s an unknown client', async () => {
    await expect(runAdsScan(sql, actorAdvertiser, scanInput('CLI-ZZAS-nope'))).rejects.toThrow(NotFoundError);
  });

  it('requires a category', async () => {
    const client = await seedClient();
    await expect(runAdsScan(sql, actorAdvertiser, { ...scanInput(client), kategori: '  ' }))
      .rejects.toThrow(MSG_KATEGORI_WAJIB);
  });

  it('REJECTS an unknown category instead of scoring against an all-null benchmark', async () => {
    const client = await seedClient();
    await expect(runAdsScan(sql, actorAdvertiser, { ...scanInput(client), kategori: 'Kategori Karangan' }))
      .rejects.toThrow(MSG_KATEGORI_TIDAK_DIKENALI);
  });

  it('requires at least one file', async () => {
    const client = await seedClient();
    await expect(runAdsScan(sql, actorAdvertiser, scanInput(client, [])))
      .rejects.toThrow(MSG_NO_FILES);
  });

  it('requires the Analitik Produk slot — the SKU universe comes from nowhere else', async () => {
    const client = await seedClient();
    await expect(runAdsScan(sql, actorAdvertiser, scanInput(client, [adsFile()])))
      .rejects.toThrow(MSG_ANALITIK_WAJIB);
  });

  it('rejects a "Ringkasan data" export by name rather than parsing it into zero rows', async () => {
    const client = await seedClient();
    const wrong = file('ringkasan.xlsx', [['Ringkasan data'], [], [], []]);
    await expect(runAdsScan(sql, actorAdvertiser, scanInput(client, [analitikFile(), wrong])))
      .rejects.toThrow(MSG_RINGKASAN_DATA);
  });

  it('menyebut NAMA berkas yang salah — satu unggahan bisa berisi belasan berkas (UAT 2026-09-04)', async () => {
    const client = await seedClient();
    const wrong = file('Shop Analytics_Key metrics.xlsx', [['Ringkasan data'], [], [], []]);
    await expect(runAdsScan(sql, actorAdvertiser, scanInput(client, [analitikFile(), wrong])))
      .rejects.toThrow('Shop Analytics_Key metrics.xlsx');
  });

  it('rejects an upload where NOTHING was recognised', async () => {
    const client = await seedClient();
    const junk = file('acak.xlsx', [['kolom', 'ngawur'], ['a', 'b']]);
    await expect(runAdsScan(sql, actorAdvertiser, scanInput(client, [junk])))
      .rejects.toThrow(MSG_TIDAK_DIKENALI);
  });

  it('rejects an unparseable week date instead of storing a period-less scan', async () => {
    const client = await seedClient();
    await expect(runAdsScan(sql, actorAdvertiser, { ...scanInput(client), mingguMulai: 'bukan-tanggal' }))
      .rejects.toThrow(MSG_MINGGU_TIDAK_VALID);
  });

  it('accepts an omitted week date (the field is optional, only garbage is rejected)', async () => {
    const client = await seedClient();
    const d = await runAdsScan(sql, actorAdvertiser, { ...scanInput(client), mingguMulai: null });
    expect(d.mingguMulai).toBeNull();
  });

  it('mints NO id when validation fails (house rule #1)', async () => {
    const client = await seedClient();
    const before = await sql<{ n: string }[]>`select count(*) as n from adsscanner_run`;
    await expect(runAdsScan(sql, actorAdvertiser, scanInput(client, [adsFile()]))).rejects.toThrow(ValidationError);
    const after = await sql<{ n: string }[]>`select count(*) as n from adsscanner_run`;
    expect(after[0].n).toBe(before[0].n);
  });
});

// ══════════════════════════════════════════════════════════════════════════
describeDb('runAdsScan — the happy path stores what it computed', () => {
  it('stores an ASR- row with the payload schema, benchmark version, and Monday-aligned week', async () => {
    const client = await seedClient();
    const d = await runAdsScan(sql, actorAdvertiser, scanInput(client, [analitikFile(), adsFile(), videoKreatorFile(), adsliveFile()]));

    expect(d.id).toMatch(/^ASR-\d{6}-\d{4}$/);
    expect(d.payloadSchema).toBe('cdps.adsscanner.tiktok.v1');
    expect(d.kategori).toBe(KATEGORI);
    expect(d.mode).toBe('weekly');
    expect(d.benchmarkVersi).toBe(1);
    expect(d.createdBy).toBe(actorAdvertiser.employeeId);
    // 2026-09-03 is a Thursday; the stored week key is its Monday.
    expect(d.mingguMulai).toBe('2026-08-31');

    const p = d.payload as engine.tiktok.AdsScannerPayload;
    expect(p.schema).toBe('cdps.adsscanner.tiktok.v1');
    expect(p.klien.kategori).toBe(KATEGORI);
    expect(p.benchmark_versi).toBe(1);
    expect(p.kelengkapan_file).toEqual({ analitik: true, ads: true, video: true, adslive: true });
    expect(p.sku).toHaveLength(2);
    // The accountable name is the advertiser who RAN it, not the client's AM.
    expect(p.klien.account_manager).toBe(actorAdvertiser.employeeId);
  });

  it('detects each of the 4 slots server-side and records the provenance it decided', async () => {
    const client = await seedClient();
    const d = await runAdsScan(sql, actorAdvertiser, scanInput(client, [analitikFile(), adsFile(), videoKreatorFile(), videoTokoFile(), adsliveFile()]));
    const berkas = d.sumberBerkas as { nama_berkas: string; peran: string | null; video_kind?: string; video_kind_ambigu?: boolean; sha256: string }[];

    expect(berkas.map((b) => b.peran)).toEqual(['analitik', 'ads', 'video', 'video', 'adslive']);
    expect(berkas.every((b) => b.sha256 === SHA)).toBe(true);
    // Filename decided both video kinds, so neither is ambiguous.
    expect(berkas[2].video_kind).toBe('kreator');
    expect(berkas[3].video_kind).toBe('toko');
    expect(berkas[2].video_kind_ambigu).toBe(false);
  });

  it('an AM override wins over filename detection AND clears the ambiguity flag', async () => {
    const client = await seedClient();
    // A filename with NO signal → the creator-count heuristic → ambiguous.
    const vague = file('export-2026-09.xlsx', videoAoa());
    const auto = await runAdsScan(sql, actorAdvertiser, scanInput(client, [analitikFile(), vague]));
    const autoBerkas = (auto.sumberBerkas as { video_kind_ambigu?: boolean }[])[1];
    expect(autoBerkas.video_kind_ambigu).toBe(true);

    const overridden = await runAdsScan(sql, actorAdvertiser, scanInput(client, [analitikFile(), file('export-2026-09.xlsx', videoAoa(), { videoKindOverride: 'toko' })]));
    const ovBerkas = (overridden.sumberBerkas as { video_kind?: string; video_kind_ambigu?: boolean }[])[1];
    expect(ovBerkas.video_kind).toBe('toko');
    expect(ovBerkas.video_kind_ambigu).toBe(false);
  });

  it('a tipeOverride re-slots a misdetected file', async () => {
    const client = await seedClient();
    // An adslive export force-read as `ads` — the AM's stated intent wins,
    // same layering as the Shopee engine's three detection layers.
    const d = await runAdsScan(sql, actorAdvertiser, scanInput(client, [analitikFile(), file('x.xlsx', adsliveAoa(), { tipeOverride: 'ads' })]));
    const berkas = d.sumberBerkas as { peran: string | null }[];
    expect(berkas[1].peran).toBe('ads');
  });

  it('stores the merged config, not just the overrides the AM sent', async () => {
    const client = await seedClient();
    const d = await runAdsScan(sql, actorAdvertiser, scanInput(client, [analitikFile()], { cfg: { testBudgetDaily: 350000, blacklist: [PID.slice(0, 15)] } }));
    const cfg = d.konfigurasi as engine.tiktok.AdsScannerConfig;
    expect(cfg.testBudgetDaily).toBe(350000);
    expect(cfg.blacklist).toEqual([PID.slice(0, 15)]);
    expect(cfg.category).toBe(KATEGORI);
    // Untouched defaults survive the merge.
    expect(cfg.gateScale).toBe(engine.tiktok.DEFAULT_ADS_SCANNER_CFG.gateScale);
    expect(cfg.usdRate).toBe(engine.tiktok.DEFAULT_ADS_SCANNER_CFG.usdRate);
  });

  it('mode=newclient is accepted and reaches the engine (audit readiness labels)', async () => {
    const client = await seedClient();
    const d = await runAdsScan(sql, actorAdvertiser, scanInput(client, [analitikFile(), adsFile()], { mode: 'newclient' }));
    expect(d.mode).toBe('newclient');
    expect((d.konfigurasi as engine.tiktok.AdsScannerConfig).mode).toBe('newclient');
  });

  it('writes exactly one audit row naming the scan (house rule #3)', async () => {
    const client = await seedClient();
    const d = await runAdsScan(sql, actorAdvertiser, scanInput(client));
    const rows = await sql<{ action: string; entity_id: string; entity_type: string }[]>`
      select action, entity_id, entity_type from audit_log where entity_id = ${d.id}`;
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe('adsscanner_run_created');
    expect(rows[0].entity_type).toBe('adsscanner_run');
  });

  it('a Director may run a scan (layered role, not just Ads division)', async () => {
    const client = await seedClient();
    const d = await runAdsScan(sql, actorDirector, scanInput(client));
    expect(d.createdBy).toBe(actorDirector.employeeId);
  });
});

// ══════════════════════════════════════════════════════════════════════════
describeDb('adsscanner_run — immutability (house rule #3)', () => {
  it('refuses every UPDATE to a stored scan, payload and metadata alike', async () => {
    const client = await seedClient();
    const d = await runAdsScan(sql, actorAdvertiser, scanInput(client));
    await expect(sql`update adsscanner_run set payload = '{}'::jsonb where id = ${d.id}`).rejects.toThrow();
    await expect(sql`update adsscanner_run set kategori = 'Health' where id = ${d.id}`).rejects.toThrow();
    await expect(sql`update adsscanner_run set created_by = 'ZZAS-OTHER' where id = ${d.id}`).rejects.toThrow();
  });

  it('refuses DELETE — a scan is history, not a draft', async () => {
    const client = await seedClient();
    const d = await runAdsScan(sql, actorAdvertiser, scanInput(client));
    await expect(sql`delete from adsscanner_run where id = ${d.id}`).rejects.toThrow();
  });

  it('a re-scan of changed input is a NEW row, leaving the old one untouched', async () => {
    const client = await seedClient();
    const first = await runAdsScan(sql, actorAdvertiser, scanInput(client, [analitikFile()]));
    const second = await runAdsScan(sql, actorAdvertiser, scanInput(client, [analitikFile(), adsFile()]));
    expect(second.id).not.toBe(first.id);
    const reread = await getAdsScanRun(sql, actorAdvertiser, first.id);
    expect((reread.payload as engine.tiktok.AdsScannerPayload).kelengkapan_file.ads).toBe(false);
    expect((second.payload as engine.tiktok.AdsScannerPayload).kelengkapan_file.ads).toBe(true);
  });

  it('the benchmark table is append-only too — no UPDATE, no DELETE', async () => {
    await expect(sql`update adsscanner_benchmark set aktif = false where versi = 1`).rejects.toThrow();
    await expect(sql`delete from adsscanner_benchmark where versi = 1`).rejects.toThrow();
  });
});

// ══════════════════════════════════════════════════════════════════════════
describeDb('recompute-from-payload (house rule #4)', () => {
  it('re-scoring a stored scan against its OWN recorded benchmark version reproduces the score and bucket', async () => {
    const client = await seedClient();
    const stored = await runAdsScan(sql, actorAdvertiser, scanInput(client, [analitikFile(), adsFile(), videoKreatorFile()]));
    const p = stored.payload as engine.tiktok.AdsScannerPayload;

    // Fetch the benchmark by the version the ROW recorded — not "the active
    // one", which is the entire point of storing the version.
    const bm = await sql<{ nilai: engine.tiktok.AdsScannerBench }[]>`
      select nilai from adsscanner_benchmark where versi = ${stored.benchmarkVersi}`;

    // Rebuild the engine input the same way the domain layer did, then re-run.
    const t = engine.tiktok;
    const analitikRows = t.rowsToObjects(analitikAoa(), 3);
    const adsRows = t.rowsToObjects(adsAoa(), 0);
    const videoRows = t.rowsToObjects(videoAoa(), 2);
    const again = t.runAdsScanner(
      { analitik: analitikRows, ads: adsRows, adslive: [], videos: [{ rows: videoRows, kind: 'kreator' }] },
      {
        cfg: stored.konfigurasi as engine.tiktok.AdsScannerConfig,
        bench: bm[0].nilai,
        benchmarkVersi: stored.benchmarkVersi,
        klien: p.klien,
        generatedAt: p.generated_at,
        periode: { weekStart: stored.mingguMulai },
      },
    );

    expect(again.payload.sku.map((s) => s.skor)).toEqual(p.sku.map((s) => s.skor));
    expect(again.payload.sku.map((s) => s.bucket)).toEqual(p.sku.map((s) => s.bucket));
    expect(again.payload.sku.map((s) => s.gate)).toEqual(p.sku.map((s) => s.gate));
    expect(again.payload.realokasi.pool).toBe(p.realokasi.pool);
    expect(again.payload.vonis.label).toBe(p.vonis.label);
    expect(again.payload.ringkasan.blendedRoi).toBe(p.ringkasan.blendedRoi);
  });

  it('a SKU with no traffic keeps NULL metrics through storage — never a misleading 0 (house rule #7)', async () => {
    const client = await seedClient();
    const d = await runAdsScan(sql, actorAdvertiser, scanInput(client, [analitikFile()]));
    const p = d.payload as engine.tiktok.AdsScannerPayload;
    const b = p.sku.find((s) => s.nama === 'Produk B');
    expect(b).toBeDefined();
    // Zero impressions and zero clicks — "no basis", stored as JSON null.
    expect(b?.ctr).toBeNull();
    expect(b?.ctor).toBeNull();
    // No ad spend at all ⇒ no ROI to report, for the account as a whole.
    expect(p.ringkasan.blendedRoi).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════════
describeDb('reads — per-role row scope mirroring the RLS predicate', () => {
  it('the creator, the client AM, the Ads lead, OD and Director can all read; a Creative staffer and another Ads staffer cannot', async () => {
    const client = await seedClient();
    const d = await runAdsScan(sql, actorAdvertiser, scanInput(client));

    for (const a of [actorAdvertiser, actorAm, actorAdsLead, actorOd, actorDirector]) {
      const got = await getAdsScanRun(sql, a, d.id);
      expect(got.id).toBe(d.id);
    }
    await expect(getAdsScanRun(sql, actorCreative, d.id)).rejects.toThrow(ForbiddenError);
    await expect(getAdsScanRun(sql, actorAdvertiser2, d.id)).rejects.toThrow(MSG_FORBIDDEN);
  });

  it('404s an unknown scan id with the BI message', async () => {
    await expect(getAdsScanRun(sql, actorDirector, 'ASR-202609-9999')).rejects.toThrow(MSG_RUN_NOT_FOUND);
  });

  it('listAdsScanRuns narrows an Ads staffer to their OWN runs but not the Ads lead', async () => {
    const client = await seedClient();
    await runAdsScan(sql, actorAdvertiser, scanInput(client));
    await runAdsScan(sql, actorAdvertiser2, scanInput(client));

    const mine = await listAdsScanRuns(sql, actorAdvertiser, client);
    expect(mine).toHaveLength(1);
    expect(mine[0].createdBy).toBe(actorAdvertiser.employeeId);

    const lead = await listAdsScanRuns(sql, actorAdsLead, client);
    expect(lead).toHaveLength(2);
    const am = await listAdsScanRuns(sql, actorAm, client);
    expect(am).toHaveLength(2);
    const creative = await listAdsScanRuns(sql, actorCreative, client);
    expect(creative).toHaveLength(0);
  });

  it('lists newest first', async () => {
    const client = await seedClient();
    const a = await runAdsScan(sql, actorAdvertiser, scanInput(client));
    const b = await runAdsScan(sql, actorAdvertiser, scanInput(client));
    const rows = await listAdsScanRuns(sql, actorAdvertiser, client);
    expect(rows.map((r) => r.id)).toEqual([b.id, a.id]);
  });
});

// ══════════════════════════════════════════════════════════════════════════
describeDb('adsScanPortfolio — the cross-client read that justified its own table (O69)', () => {
  it('returns the LATEST scan per client, with rollups read from the frozen payload', async () => {
    const c1 = await seedClient();
    const c2 = await seedClient();
    await runAdsScan(sql, actorAdvertiser, scanInput(c1, [analitikFile()]));
    const latest1 = await runAdsScan(sql, actorAdvertiser, scanInput(c1, [analitikFile(), adsFile()]));
    const only2 = await runAdsScan(sql, actorAdvertiser, scanInput(c2, [analitikFile()]));

    const rows = await adsScanPortfolio(sql, actorAdsLead);
    const mine = rows.filter((r) => r.clientId === c1 || r.clientId === c2);
    expect(mine).toHaveLength(2);
    expect(mine.find((r) => r.clientId === c1)?.id).toBe(latest1.id);
    expect(mine.find((r) => r.clientId === c2)?.id).toBe(only2.id);

    const r1 = mine.find((r) => r.clientId === c1)!;
    expect(r1.clientToko).toBe('Toko Sperantia');
    expect(r1.vonis).not.toBeNull();
    expect(r1.skuTotal).toBe(2);
    expect(r1.totalSpend).toBeCloseTo(1_000_000, 0);

    // c2's only scan had no ads file ⇒ zero spend ⇒ blendedRoi has no basis.
    expect(mine.find((r) => r.clientId === c2)?.blendedRoi).toBeNull();
  });

  it('scopes rows: an Ads staffer sees only their own scans, the AM sees their clients, Creative sees none', async () => {
    const client = await seedClient();
    await runAdsScan(sql, actorAdvertiser, scanInput(client));

    const own = (await adsScanPortfolio(sql, actorAdvertiser)).filter((r) => r.clientId === client);
    expect(own).toHaveLength(1);
    const other = (await adsScanPortfolio(sql, actorAdvertiser2)).filter((r) => r.clientId === client);
    expect(other).toHaveLength(0);
    const am = (await adsScanPortfolio(sql, actorAm)).filter((r) => r.clientId === client);
    expect(am).toHaveLength(1);
    const creative = (await adsScanPortfolio(sql, actorCreative)).filter((r) => r.clientId === client);
    expect(creative).toHaveLength(0);
    const dir = (await adsScanPortfolio(sql, actorDirector)).filter((r) => r.clientId === client);
    expect(dir).toHaveLength(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════
describeDb('renderAdsScanHtml + adsScanCategories', () => {
  it('renders the STORED payload (no re-run) and gates on read permission', async () => {
    const client = await seedClient();
    const d = await runAdsScan(sql, actorAdvertiser, scanInput(client, [analitikFile(), adsFile(), videoKreatorFile()]));
    const html = await renderAdsScanHtml(sql, actorAdvertiser, d.id);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('Produk A');
    await expect(renderAdsScanHtml(sql, actorCreative, d.id)).rejects.toThrow(ForbiddenError);
  });

  it('offers the ACTIVE benchmark row\'s categories, sorted — 34 of them at v1', async () => {
    const cats = await adsScanCategories(sql);
    expect(cats).toHaveLength(34);
    expect(cats).toContain(KATEGORI);
    expect([...cats].sort()).toEqual(cats);
    // The DB seed and the compiled-in constant must not have drifted apart.
    expect(cats).toEqual([...engine.tiktok.ALL_ADSSCANNER_CATEGORIES]);
  });
});
