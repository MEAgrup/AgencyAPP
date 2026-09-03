/**
 * SH-06 — `createReportShopee` + the auto Metric Entry (MTR-) attribution it
 * writes for M6D RM-C (`attributeShopeeAdsMetricEntries` in `report.ts`).
 *
 * Fixtures mirror `packages/core/src/report/shopee/shopee.test.ts`'s
 * `bisnisHomeAoa`/`adsToko` (exact column strings the parsers key on), passed
 * through the FULL domain path — filename-convention detection, DB insert,
 * and (the actual point of this file) Ad-Campaign matching + even-split.
 *
 * Skipped unless DATABASE_URL is set. Rows namespaced `ZZRS-` (distinct from
 * `report.domain.test.ts`'s `ZZR-` and `ads.test.ts`'s `ZZ-` — three domain
 * test files share one real Postgres DB and must never LIKE-collide on cleanup).
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { permission } from '@cdps/core';
import { createClient, type Sql } from '@cdps/db';
import { createCampaign, type CampaignInput } from './ads';
import { ConflictError, ForbiddenError, ValidationError } from './account';
import {
  createReportShopee,
  MSG_BISNIS_HOME_WAJIB,
  MSG_PERIODE_LABEL_WAJIB,
  MSG_PERIODE_TAK_TERBACA,
  MSG_SUDAH_ADA,
} from './report';

// ---------------------------------------------------------------------------
// Export fixtures — verbatim column strings from
// packages/core/src/report/shopee/shopee.test.ts (bisnisHomeAoa / adsToko),
// duplicated here per house convention (report.domain.test.ts does the same
// for TikTok's shopTtAoa — the domain layer keeps its own fixture copy so it
// never depends on @cdps/core's test file).
// ---------------------------------------------------------------------------
const HOME_HEADER = [
  'Periode Waktu', 'Total Penjualan (IDR)', 'Total Pesanan', 'Penjualan per Pesanan', 'Produk Diklik',
  'Total Pengunjung', 'Tingkat Konversi Pesanan', 'Pesanan Dibatalkan', 'Penjualan Dibatalkan',
  'Pesanan Dikembalikan', 'Penjualan Dikembalikan', 'Pembeli', 'Total Pembeli Baru', 'Total Pembeli Saat Ini',
  'Total Potensi Pembeli', 'Tingkat Pembelian Berulang',
];
const bisnisHomeAoa = (): unknown[][] => [
  ['Pesanan Dibuat'],
  HOME_HEADER,
  ['Total', 'Rp100.000.000', '1.000', 'Rp100.000', '5.000', '50.000', '2,00%', '50', 'Rp5.000.000', '10', 'Rp1.000.000', '900', '300', '600', '50', '20,00%'],
  ['01/08/2026', 'Rp3.000.000', '30', 'Rp100.000', '150', '2.000', '1,50%', '2', 'Rp50.000', '0', 'Rp0', '25', '10', '15', '2', '10,00%'],
];

/** omzet 40.000.000, biaya 5.000.000 — the numbers every split test below works from. */
const adsToko = (): unknown[][] => [
  ['Nama Iklan', 'Status', 'Dilihat', 'Jumlah Klik', 'Persentase Klik', 'Omzet Penjualan', 'Biaya', 'Pesanan', 'Produk Terjual', 'Efektifitas Iklan', 'Biaya Iklan Terhadap Omzet (ACOS) (%)'],
  ['Kampanye A', 'Berjalan', '50000', '2000', '4.00%', '40000000', '5000000', '80', '85', '8.00', '12.50%'],
];

const SHA = 'b'.repeat(64);
const homeFile = () => ({ filename: '[bisnis]-Home && Agustus 2026 && ZZRS && 2026-09-01.xlsx', aoa: bisnisHomeAoa(), sha256: SHA, ukuranBytes: 2048 });
const adsFile = () => ({ filename: '[ads]-Toko && Agustus 2026 && ZZRS && 2026-09-01.xlsx', aoa: adsToko(), sha256: SHA, ukuranBytes: 1024 });

// ---------------------------------------------------------------------------
// DB integration
// ---------------------------------------------------------------------------
const URL = process.env.DATABASE_URL;
const describeDb = describe.skipIf(!URL);
let sql: Sql;
if (URL) sql = createClient(URL);

const OWNER = 'ZZRS-AM';
const RUN = Date.now().toString(36).slice(-6);
let seq = 0;
const uid = (p: string): string => `${p}-ZZRS-${RUN}-${seq++}`;

const actorAm = { employeeId: OWNER, role: permission.makeRole({ division: 'Account', level: 'staff' }) };
const actorAds = { employeeId: 'ZZRS-ADV', role: permission.makeRole({ division: 'Ads', level: 'staff' }) };

async function seedClient(): Promise<string> {
  const client = uid('CLI');
  await sql`
    insert into clients
      (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv, total_sales,
       sales_pic_id, commission_payment_pic_id, assigned_am_id, released_to_account_at, created_by)
    values (${client}, 'Rani', 'Toko Sperantia', 'Bandung', 'https://shopee.co.id/sperantia',
            'Fashion', 0, 0, 0, 'ZZRS-SALES', 'ZZRS-SALES', ${OWNER}, now(), ${OWNER})`;
  return client;
}
async function seedPlatform(client: string): Promise<number> {
  const rows = await sql<{ id: number }[]>`
    insert into client_platforms (client_id, platform, store_link, active, created_by)
    values (${client}, 'Shopee', 'https://shopee.co.id/sperantia', true, ${OWNER}) returning id`;
  return Number(rows[0].id);
}
async function seedService(client: string): Promise<string> {
  const svc = uid('SVC');
  await sql`
    insert into services (id, client_id, master_service_id, master_version_no, name,
      standard_price, commission_rule, status, requires_strategy_plan, created_by)
    values (${svc}, ${client}, 'MSV-X', 1, 'Svc', '10000000.00', 'rule', '[In Execution]', false, ${OWNER})`;
  return svc;
}
async function seedAdsBrief(client: string): Promise<string> {
  const svc = await seedService(client);
  const brief = uid('BRF');
  await sql`
    insert into briefs (id, service_id, title, status, assigned_division, deliverable_type,
      quantity_target, priority, recurring, created_by)
    values (${brief}, ${svc}, 'Brief Ads', '[In Progress]', 'Ads', 'Campaign', 1, 'High', false, ${OWNER})`;
  return brief;
}
/** A `[Active]` Shopee Ads campaign of `client`, overlapping [start,end]. Status is force-set (raw SQL) — this file tests report attribution, not the ADC lifecycle. */
async function activeShopeeAdsCampaign(client: string, start: string, end: string): Promise<string> {
  const brief = await seedAdsBrief(client);
  const input: CampaignInput = {
    platform: 'Shopee Ads', objective: 'Sales', budget: '8000000', startDate: start, endDate: end,
    targetKpi: 'ROAS ≥ 4x', tipeIklan: 'GMV Max Product',
  };
  const c = await createCampaign(sql, actorAds, brief, input);
  await sql`update ad_campaigns set status = '[Active]' where id = ${c.id}`;
  return c.id;
}
async function metricEntriesOf(campaignId: string): Promise<{ spend: string; gmv: string; entry_method: string }[]> {
  return sql<{ spend: string; gmv: string; entry_method: string }[]>`
    select spend, gmv, entry_method from metric_entries where campaign_id = ${campaignId} order by id`;
}

afterEach(async () => {
  if (!sql) return;
  await sql`delete from metric_entry_assets where metric_entry_id in (select id from metric_entries where entered_by like 'ZZRS-%')`;
  await sql`delete from metric_entries where entered_by like 'ZZRS-%'`;
  await sql`delete from ad_campaigns where created_by like 'ZZRS-%'`;
  await sql`delete from briefs where created_by like 'ZZRS-%'`;
  await sql`delete from services where created_by like 'ZZRS-%'`;
  await sql`alter table client_report_insight disable trigger trg_cri_no_delete`;
  try {
    await sql`delete from client_report_insight where report_id in (
      select id from client_reports where client_id like 'CLI-ZZRS-%')`;
    await sql`delete from client_reports where client_id like 'CLI-ZZRS-%'`; // berkas + publikasi CASCADE
  } finally {
    await sql`alter table client_report_insight enable trigger trg_cri_no_delete`;
  }
  await sql`delete from client_platforms where client_id like 'CLI-ZZRS-%'`;
  await sql`delete from clients where id like 'CLI-ZZRS-%'`;
});
afterAll(async () => { if (sql) await sql.end(); });

const bulanInput = (pid: number, files = [homeFile(), adsFile()], excludeCampaignIds?: string[]) => ({
  clientPlatformId: pid, periodeTipe: 'bulanan' as const, files,
  periode: 'Agustus 2026', periodeMulai: '2026-08-01', periodeAkhir: '2026-08-31', excludeCampaignIds,
});

describeDb('createReportShopee — score, store, payload_schema', () => {
  it('stores a cdps.report.shopee.v1 row with benchmark_versi_shopee set and benchmark_versi null', async () => {
    const client = await seedClient();
    const pid = await seedPlatform(client);
    const d = await createReportShopee(sql, actorAm, client, bulanInput(pid, [homeFile()]));
    expect(d.skor).not.toBeNull();
    expect(d.gmvNet).toBeCloseTo(100_000_000, 0);
    expect(d.periodeMulai).toBe('2026-08-01');
    expect(d.periodeAkhir).toBe('2026-08-31');
    expect(d.rentangDariBerkas).toBe(false); // Shopee never resolves a range from the file
    expect(d.benchmarkVersi).toBeNull();
    expect(d.benchmarkVersiShopee).not.toBeNull();
    const row = await sql<{ payload_schema: string }[]>`select payload_schema from client_reports where id = ${d.id}`;
    expect(row[0].payload_schema).toBe('cdps.report.shopee.v1');
  });

  it('rejects a missing Bisnis — Home file with the exact BI message', async () => {
    const client = await seedClient();
    const pid = await seedPlatform(client);
    await expect(createReportShopee(sql, actorAm, client, bulanInput(pid, [adsFile()])))
      .rejects.toThrow(MSG_BISNIS_HOME_WAJIB);
  });

  it('requires periodeMulai/periodeAkhir — Shopee has no file-derived range to fall back on', async () => {
    const client = await seedClient();
    const pid = await seedPlatform(client);
    await expect(createReportShopee(sql, actorAm, client, { ...bulanInput(pid, [homeFile()]), periodeMulai: '' }))
      .rejects.toThrow(MSG_PERIODE_TAK_TERBACA);
  });

  it('requires a non-empty periode label', async () => {
    const client = await seedClient();
    const pid = await seedPlatform(client);
    await expect(createReportShopee(sql, actorAm, client, { ...bulanInput(pid, [homeFile()]), periode: '  ' }))
      .rejects.toThrow(MSG_PERIODE_LABEL_WAJIB);
  });

  it('re-uploading the same toko × tipe × range is a ConflictError', async () => {
    const client = await seedClient();
    const pid = await seedPlatform(client);
    await createReportShopee(sql, actorAm, client, bulanInput(pid, [homeFile()]));
    await expect(createReportShopee(sql, actorAm, client, bulanInput(pid, [homeFile()])))
      .rejects.toThrow(ConflictError);
    await expect(createReportShopee(sql, actorAm, client, bulanInput(pid, [homeFile()])))
      .rejects.toThrow(MSG_SUDAH_ADA);
  });

  it('refuses a report for a client the actor does not own', async () => {
    const client = await seedClient();
    const pid = await seedPlatform(client);
    const stray = { employeeId: 'ZZRS-OTHER', role: permission.makeRole({ division: 'Account', level: 'staff' }) };
    await expect(createReportShopee(sql, stray, client, bulanInput(pid, [homeFile()])))
      .rejects.toThrow(ForbiddenError);
  });
});

describeDb('SH-06 — auto Metric Entry (MTR-) from the report\'s combined Ads numbers', () => {
  it('no ads file uploaded → no Metric Entry, report still saves', async () => {
    const client = await seedClient();
    const pid = await seedPlatform(client);
    const campaign = await activeShopeeAdsCampaign(client, '2026-08-01', '2026-08-31');
    const d = await createReportShopee(sql, actorAm, client, bulanInput(pid, [homeFile()]));
    expect(d.id).toBeGreaterThan(0);
    expect(await metricEntriesOf(campaign)).toHaveLength(0);
  });

  it('zero overlapping active campaigns → no Metric Entry (never blocks the report)', async () => {
    const client = await seedClient();
    const pid = await seedPlatform(client);
    // Campaign exists but its period does NOT overlap the report's.
    const campaign = await activeShopeeAdsCampaign(client, '2026-01-01', '2026-01-31');
    const d = await createReportShopee(sql, actorAm, client, bulanInput(pid));
    expect(d.id).toBeGreaterThan(0);
    expect(await metricEntriesOf(campaign)).toHaveLength(0);
  });

  it('exactly ONE overlapping active campaign → auto MTR- gets the FULL total, entry_method=File Export', async () => {
    const client = await seedClient();
    const pid = await seedPlatform(client);
    const campaign = await activeShopeeAdsCampaign(client, '2026-08-01', '2026-08-31');
    await createReportShopee(sql, actorAm, client, bulanInput(pid));
    const entries = await metricEntriesOf(campaign);
    expect(entries).toHaveLength(1);
    expect(Number(entries[0].spend)).toBeCloseTo(5_000_000, 2);
    expect(Number(entries[0].gmv)).toBeCloseTo(40_000_000, 2);
    expect(entries[0].entry_method).toBe('File Export');
  });

  it('a [Paused] campaign overlapping the period is NOT a candidate', async () => {
    const client = await seedClient();
    const pid = await seedPlatform(client);
    const campaign = await activeShopeeAdsCampaign(client, '2026-08-01', '2026-08-31');
    await sql`update ad_campaigns set status = '[Paused]' where id = ${campaign}`;
    await createReportShopee(sql, actorAm, client, bulanInput(pid));
    expect(await metricEntriesOf(campaign)).toHaveLength(0);
  });

  it('TWO overlapping active campaigns → split EVENLY, Σ reconstructs the true total', async () => {
    const client = await seedClient();
    const pid = await seedPlatform(client);
    const a = await activeShopeeAdsCampaign(client, '2026-08-01', '2026-08-31');
    const b = await activeShopeeAdsCampaign(client, '2026-08-15', '2026-09-15'); // partial overlap still counts
    await createReportShopee(sql, actorAm, client, bulanInput(pid));
    const [ea] = await metricEntriesOf(a);
    const [eb] = await metricEntriesOf(b);
    expect(Number(ea.spend)).toBeCloseTo(2_500_000, 2);
    expect(Number(eb.spend)).toBeCloseTo(2_500_000, 2);
    expect(Number(ea.gmv)).toBeCloseTo(20_000_000, 2);
    expect(Number(eb.gmv)).toBeCloseTo(20_000_000, 2);
    expect(Number(ea.spend) + Number(eb.spend)).toBeCloseTo(5_000_000, 2);
    expect(Number(ea.gmv) + Number(eb.gmv)).toBeCloseTo(40_000_000, 2);
  });

  it('THREE-way split floors the remainder rather than inventing a fraction — Σ is at most a few minor units under the true total', async () => {
    const client = await seedClient();
    const pid = await seedPlatform(client);
    const ids = await Promise.all([
      activeShopeeAdsCampaign(client, '2026-08-01', '2026-08-31'),
      activeShopeeAdsCampaign(client, '2026-08-01', '2026-08-31'),
      activeShopeeAdsCampaign(client, '2026-08-01', '2026-08-31'),
    ]);
    await createReportShopee(sql, actorAm, client, bulanInput(pid));
    let sumSpend = 0, sumGmv = 0;
    for (const id of ids) {
      const [e] = await metricEntriesOf(id);
      sumSpend += Number(e.spend);
      sumGmv += Number(e.gmv);
    }
    // 5.000.000 / 3 and 40.000.000 / 3 do not divide evenly — floor at the
    // minor-unit level, never over-allocate. Off by at most a few cents.
    expect(sumSpend).toBeLessThanOrEqual(5_000_000);
    expect(sumSpend).toBeGreaterThan(5_000_000 - 1);
    expect(sumGmv).toBeLessThanOrEqual(40_000_000);
    expect(sumGmv).toBeGreaterThan(40_000_000 - 1);
  });

  it('AM excludes one campaign → the excluded one gets nothing, the rest gets the FULL total (not re-split)', async () => {
    const client = await seedClient();
    const pid = await seedPlatform(client);
    const keep = await activeShopeeAdsCampaign(client, '2026-08-01', '2026-08-31');
    const excluded = await activeShopeeAdsCampaign(client, '2026-08-01', '2026-08-31');
    await createReportShopee(sql, actorAm, client, bulanInput(pid, undefined, [excluded]));
    expect(await metricEntriesOf(excluded)).toHaveLength(0);
    const [e] = await metricEntriesOf(keep);
    expect(Number(e.spend)).toBeCloseTo(5_000_000, 2);
    expect(Number(e.gmv)).toBeCloseTo(40_000_000, 2);
  });

  it('AM excludes ALL overlapping campaigns → no Metric Entry at all', async () => {
    const client = await seedClient();
    const pid = await seedPlatform(client);
    const a = await activeShopeeAdsCampaign(client, '2026-08-01', '2026-08-31');
    const b = await activeShopeeAdsCampaign(client, '2026-08-01', '2026-08-31');
    await createReportShopee(sql, actorAm, client, bulanInput(pid, undefined, [a, b]));
    expect(await metricEntriesOf(a)).toHaveLength(0);
    expect(await metricEntriesOf(b)).toHaveLength(0);
  });

  it('the auto entry is written even though the report-creating actor is Account division, not Ads (engine write, not an Ads-division action)', async () => {
    const client = await seedClient();
    const pid = await seedPlatform(client);
    const campaign = await activeShopeeAdsCampaign(client, '2026-08-01', '2026-08-31');
    // actorAm is Account/staff — canManageCampaign(actorAm) would be false were
    // this gated the same way as a manual logMetricEntry call.
    await createReportShopee(sql, actorAm, client, bulanInput(pid));
    expect(await metricEntriesOf(campaign)).toHaveLength(1);
  });
});
