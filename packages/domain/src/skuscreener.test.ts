/**
 * SC-08 — MEA SKU Screener domain layer tests (skuscreener.ts).
 *
 * Deliberately does NOT re-derive the core math's expected numbers by hand
 * (medians/routes/CPC-max/verdicts are already covered by `@cdps/core`'s own
 * 59 skuscreener tests) — instead it calls the SAME pure functions
 * independently to build the "expected" value, so what's actually under test
 * is the DOMAIN WIRING (parse → engine → payload → persistence →
 * permission), not a second copy of R01-R16.
 *
 * Skipped unless DATABASE_URL is set. Rows namespaced `ZZSK-`.
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { permission, skuscreener as core } from '@cdps/core';
import { createClient, type Sql } from '@cdps/db';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from './account';
import {
  createTrackerRow,
  getScreeningRun,
  isPremature,
  listDecisions,
  listScreeningRuns,
  listTrackerRows,
  logDecision,
  MSG_NO_MATCH,
  MSG_NON_REVIEW_NO_TARGET,
  MSG_REVIEW_NEEDS_TARGET,
  MSG_REVIEW_TARGET_IS_REVIEW,
  MSG_REVIEW_TARGET_WRONG_CLIENT,
  MSG_TRACKER_EXISTS,
  recordTrackerAfter,
  runCompare,
  runScreening,
  statusVsTarget,
} from './skuscreener';

// ---------------------------------------------------------------------------
// Pure unit tests (no DB)
// ---------------------------------------------------------------------------
describe('statusVsTarget (C2)', () => {
  it('literal comparison: SESUAI on equality, DI ATAS/DI BAWAH otherwise', () => {
    expect(statusVsTarget(4, 4)).toBe('SESUAI');
    expect(statusVsTarget(5, 4)).toBe('DI ATAS TARGET');
    expect(statusVsTarget(3, 4)).toBe('DI BAWAH TARGET');
  });
});

describe('isPremature (R14)', () => {
  it('premature when NONE of the three thresholds are met', () => {
    expect(isPremature(10, 1, 1)).toBe(true);
  });
  it('not premature once ANY one threshold is met', () => {
    expect(isPremature(50, 0, 0)).toBe(false); // klik
    expect(isPremature(0, 3, 0)).toBe(false); // konversi
    expect(isPremature(0, 0, 3)).toBe(false); // hari jalan
  });
});

// ---------------------------------------------------------------------------
// Export fixtures — same HEADER/sheet() shape as
// packages/core/src/skuscreener/skuscreener.test.ts.
// ---------------------------------------------------------------------------
const HEADER = [
  'Kode Variasi', 'Produk', 'Kode Produk', 'Total Penjualan',
  'Jumlah Produk Dilihat', 'Produk Diklik', 'Persentase Klik',
  'Tingkat Konversi Pesanan', 'Pesanan Dibuat',
];
const sheet = (rows: unknown[][], name = 'Performa Produk'): core.NamedSheet => ({ name, aoa: [HEADER, ...rows] });

// 6 parent SKUs, all Views ≥ 200 and Clicks ≥ 20 so R04's threshold never
// needs to reduce below its starting point (200/20) — keeps the "expected"
// computation (via the same core functions) simple to read.
const SIX_SKUS = () => sheet([
  ['-', 'Produk Bintang', 'SKU-A', '5.000.000', '1000', '80', '8,00', '5,00', '40'], // ctr 8, cr 5 → SCALE
  ['-', 'Produk Kandidat', 'SKU-B', '1.600.000', '500', '35', '7,00', '4,00', '20'], // ctr 7, cr 4 → KANDIDAT IKLAN (views<median)
  ['-', 'Produk GambarBuruk', 'SKU-C', '300.000', '900', '20', '2,22', '3,00', '6'], // ctr low, views high → OPTIMASI GAMBAR/JUDUL
  ['-', 'Produk HargaMahal', 'SKU-D', '400.000', '300', '25', '8,33', '0,50', '2'], // ctr high, cr low → OPTIMASI DESKRIPSI/HARGA
  ['-', 'Produk Parkir', 'SKU-E', '100.000', '250', '20', '8,00', '0,80', '2'],
  ['-', 'Produk Parkir2', 'SKU-F', '150.000', '220', '22', '10,00', '0,90', '2'],
]);

const SHA = 'c'.repeat(64);
const berkas = (peran: 'performa_produk' | 'iklan_cpc' | 'sebelum' | 'sesudah') =>
  [{ namaBerkas: 'file.xlsx', sha256: SHA, ukuranBytes: 2048, peran: peran as never }];

// ---------------------------------------------------------------------------
// DB integration
// ---------------------------------------------------------------------------
const URL = process.env.DATABASE_URL;
const describeDb = describe.skipIf(!URL);
let sql: Sql;
if (URL) sql = createClient(URL);

const OWNER = 'ZZSK-AM';
const RUN = Date.now().toString(36).slice(-6);
let seq = 0;
const uid = (p: string): string => `${p}-ZZSK-${RUN}-${seq++}`;

const adsStaff = (id = 'ZZSK-ADV') => ({ employeeId: id, role: permission.makeRole({ division: 'Ads', level: 'staff' }) });
const adsLead = () => ({ employeeId: 'ZZSK-ADSLEAD', role: permission.makeRole({ division: 'Ads', level: 'lead' }) });
const accountAm = () => ({ employeeId: OWNER, role: permission.makeRole({ division: 'Account', level: 'staff' }) });
const strayAds = () => ({ employeeId: 'ZZSK-STRAY', role: permission.makeRole({ division: 'Ads', level: 'staff' }) });
const od = () => ({ employeeId: 'ZZSK-OD', role: permission.makeRole({ division: 'Account', level: 'staff', od: true }) });
const director = () => ({ employeeId: 'ZZSK-DIR', role: permission.makeRole({ division: 'Account', level: 'staff', director: true }) });

async function seedClient(): Promise<string> {
  const client = uid('CLI');
  await sql`
    insert into clients
      (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv, total_sales,
       sales_pic_id, commission_payment_pic_id, assigned_am_id, released_to_account_at, created_by)
    values (${client}, 'Rani', 'Toko Sperantia', 'Bandung', 'https://shopee.co.id/sperantia',
            'Fashion', 0, 0, 0, 'ZZSK-SALES', 'ZZSK-SALES', ${OWNER}, now(), ${OWNER})`;
  return client;
}

afterEach(async () => {
  if (!sql) return;
  await sql`delete from optimization_tracker where client_id like 'CLI-ZZSK-%'`;
  // ads_decision_log/screening_run are append-only (forbid_mutation blocks
  // both UPDATE and DELETE — that immutability is itself asserted by tests
  // below) — step around the guard as the owning superuser for fixture
  // teardown, same pattern as report.domain.test.ts's client_report_insight.
  await sql`alter table ads_decision_log disable trigger trg_adl_no_delete`;
  await sql`alter table screening_run disable trigger trg_screening_run_no_delete`;
  try {
    await sql`delete from ads_decision_log where client_id like 'CLI-ZZSK-%'`;
    await sql`delete from screening_run where client_id like 'CLI-ZZSK-%'`;
  } finally {
    await sql`alter table ads_decision_log enable trigger trg_adl_no_delete`;
    await sql`alter table screening_run enable trigger trg_screening_run_no_delete`;
  }
  await sql`delete from clients where id like 'CLI-ZZSK-%'`;
});
afterAll(async () => { if (sql) await sql.end(); });

describeDb('runScreening (Modul A)', () => {
  it('parses, routes, and persists a screening run — payload matches the core engine directly', async () => {
    const client = await seedClient();
    const skus = core.readPerformaProduk([SIX_SKUS()]);
    const medCtr = core.medianCtr(skus.map((s) => ({ views: s.views, ctr: s.ctr })));
    const medCr = core.medianCr(skus.map((s) => ({ clicks: s.clicks, cr: s.cr })));
    const medViews = core.medianViews(skus);
    const expectedRoutes = skus.map((s) => core.classifySku(
      { ctr: s.ctr, cr: s.cr, views: s.views, aov: s.aov },
      { ctr: medCtr.effectiveMedian, cr: medCr.effectiveMedian, views: medViews },
      { faktorCrIklan: 1.0, targetRoas: 4, cpcPasar: null },
    ).label);

    const d = await runScreening(sql, adsStaff(), {
      clientId: client, sheets: [SIX_SKUS()], targetRoas: 4, berkas: berkas('performa_produk'),
    });
    expect(d.jenis).toBe('screening');
    expect(d.targetRoas).toBe(4);
    const payload = d.payload as { skus: { kode: string; label: string }[]; medians: { ctr: number; cr: number; views: number } };
    expect(payload.medians.ctr).toBeCloseTo(medCtr.effectiveMedian, 5);
    expect(payload.medians.cr).toBeCloseTo(medCr.effectiveMedian, 5);
    expect(payload.skus).toHaveLength(6);
    const gotByKode = new Map(payload.skus.map((s) => [s.kode, s.label]));
    for (const [i, s] of skus.entries()) expect(gotByKode.get(s.kode)).toBe(expectedRoutes[i]);
  });

  it('rejects target ROAS ≤ 0', async () => {
    const client = await seedClient();
    await expect(runScreening(sql, adsStaff(), {
      clientId: client, sheets: [SIX_SKUS()], targetRoas: 0, berkas: berkas('performa_produk'),
    })).rejects.toThrow(ValidationError);
  });

  it('wraps a core parse error as a bracketed BI ValidationError', async () => {
    const client = await seedClient();
    const badSheet: core.NamedSheet = { name: 'Kosong', aoa: [] };
    await expect(runScreening(sql, adsStaff(), {
      clientId: client, sheets: [badSheet], targetRoas: 4, berkas: berkas('performa_produk'),
    })).rejects.toThrow(/^\[.*\]$/);
  });

  it('an Account AM (not Ads division) cannot run a screening', async () => {
    const client = await seedClient();
    await expect(runScreening(sql, accountAm(), {
      clientId: client, sheets: [SIX_SKUS()], targetRoas: 4, berkas: berkas('performa_produk'),
    })).rejects.toThrow(ForbiddenError);
  });

  it('OD (read-only everywhere) cannot run a screening', async () => {
    const client = await seedClient();
    await expect(runScreening(sql, od(), {
      clientId: client, sheets: [SIX_SKUS()], targetRoas: 4, berkas: berkas('performa_produk'),
    })).rejects.toThrow(ForbiddenError);
  });

  it('the stored run is immutable — direct UPDATE is rejected', async () => {
    const client = await seedClient();
    const d = await runScreening(sql, adsStaff(), {
      clientId: client, sheets: [SIX_SKUS()], targetRoas: 4, berkas: berkas('performa_produk'),
    });
    await expect(sql`update screening_run set target_roas = 99 where id = ${d.id}`).rejects.toThrow();
  });
});

describeDb('runCompare (Modul B)', () => {
  const before = () => sheet([
    ['-', 'Sneakers Outdoor', 'SKU-X', '1.000.000', '3120', '58', '1,86', '0,00', '0'],
  ]);
  const after = () => sheet([
    ['-', 'Sneakers Outdoor', 'SKU-X', '1.200.000', '3844', '96', '2,50', '0,00', '0'],
  ]);

  it('matches by Kode Produk and stores the comparison verdict (PRD §4.2 Sneakers Outdoor Trail)', async () => {
    const client = await seedClient();
    const d = await runCompare(sql, adsStaff(), {
      clientId: client, sheetsBefore: [before()], sheetsAfter: [after()], berkas: berkas('sebelum'),
    });
    expect(d.jenis).toBe('perbandingan');
    const payload = d.payload as { pairs: { kode: string; verdict: string; deltaCtrPct: number }[] };
    expect(payload.pairs).toHaveLength(1);
    expect(payload.pairs[0].kode).toBe('SKU-X');
    expect(payload.pairs[0].verdict).toBe('MEMBAIK'); // CTR +34.4% ≥ 20%
    expect(payload.pairs[0].deltaCtrPct).toBeCloseTo(34.4, 0);
  });

  it('no matching SKUs → MSG_NO_MATCH', async () => {
    const client = await seedClient();
    const otherSheet = sheet([['-', 'Produk Lain', 'SKU-Z', '500.000', '400', '20', '5,00', '2,00', '8']]);
    await expect(runCompare(sql, adsStaff(), {
      clientId: client, sheetsBefore: [before()], sheetsAfter: [otherSheet], berkas: berkas('sebelum'),
    })).rejects.toThrow(MSG_NO_MATCH);
  });
});

describeDb('logDecision (Modul C, append-only)', () => {
  const validInput = (clientId: string) => ({
    clientId, platform: 'Shopee', objectType: 'SKU', objectName: 'Sneakers Corduroy Slip On',
    momen: 'masuk_iklan', sopStage: '1-Screening SKU', decision: 'Loloskan ke iklan',
    metricKey: 'ROAS', metricValue: 4.5, metricTarget: 4,
  });

  it('computes status_vs_target and roas_result, defaults advertiserId to the actor', async () => {
    const client = await seedClient();
    const d = await logDecision(sql, adsStaff('ZZSK-ADV1'), {
      ...validInput(client), spend7d: 1_000_000, gmv7d: 4_000_000,
    });
    expect(d.statusVsTarget).toBe('DI ATAS TARGET');
    expect(d.roasResult).toBeCloseTo(4, 5);
    expect(d.advertiserId).toBe('ZZSK-ADV1');
    expect(d.premature).toBe(false); // no dataPendukung supplied → fresh decision, not premature
  });

  it('roas_result is null (never 0/Infinity) when spend_7d is absent', async () => {
    const client = await seedClient();
    const d = await logDecision(sql, adsStaff(), validInput(client));
    expect(d.roasResult).toBeNull();
  });

  it('R14: premature flag from dataPendukung', async () => {
    const client = await seedClient();
    const d = await logDecision(sql, adsStaff(), {
      ...validInput(client), dataPendukung: { klik: 10, konversi: 1, hariJalan: 1 },
    });
    expect(d.premature).toBe(true);
  });

  it('a review row (momen=review_7_hari) requires reviewsDecisionId, and vice versa', async () => {
    const client = await seedClient();
    await expect(logDecision(sql, adsStaff(), { ...validInput(client), momen: 'review_7_hari' }))
      .rejects.toThrow(MSG_REVIEW_NEEDS_TARGET);
    const original = await logDecision(sql, adsStaff(), validInput(client));
    await expect(logDecision(sql, adsStaff(), { ...validInput(client), reviewsDecisionId: original.id }))
      .rejects.toThrow(MSG_NON_REVIEW_NO_TARGET);
  });

  it('a review row must target an existing decision of the SAME client, and not another review', async () => {
    const client = await seedClient();
    const otherClient = await seedClient();
    const original = await logDecision(sql, adsStaff(), validInput(client));
    await expect(logDecision(sql, adsStaff(), {
      ...validInput(client), momen: 'review_7_hari', reviewsDecisionId: 'ADL-999999-9999',
    })).rejects.toThrow(NotFoundError);
    await expect(logDecision(sql, adsStaff(), {
      ...validInput(otherClient), momen: 'review_7_hari', reviewsDecisionId: original.id,
    })).rejects.toThrow(MSG_REVIEW_TARGET_WRONG_CLIENT);
    const review = await logDecision(sql, adsStaff(), {
      ...validInput(client), momen: 'review_7_hari', reviewsDecisionId: original.id,
      verdict: 'Berhasil', gmv7d: 5_000_000, spend7d: 1_000_000,
    });
    expect(review.reviewsDecisionId).toBe(original.id);
    await expect(logDecision(sql, adsStaff(), {
      ...validInput(client), momen: 'review_7_hari', reviewsDecisionId: review.id,
    })).rejects.toThrow(MSG_REVIEW_TARGET_IS_REVIEW);
  });

  it('append-only — direct UPDATE and DELETE are both rejected', async () => {
    const client = await seedClient();
    const d = await logDecision(sql, adsStaff(), validInput(client));
    await expect(sql`update ads_decision_log set verdict = 'Gagal' where id = ${d.id}`).rejects.toThrow();
    await expect(sql`delete from ads_decision_log where id = ${d.id}`).rejects.toThrow();
  });

  it('permission: Ads staff/lead/Director write, Account AM and OD do not', async () => {
    const client = await seedClient();
    await expect(logDecision(sql, accountAm(), validInput(client))).rejects.toThrow(ForbiddenError);
    await expect(logDecision(sql, od(), validInput(client))).rejects.toThrow(ForbiddenError);
    await expect(logDecision(sql, adsLead(), validInput(client))).resolves.toBeTruthy();
    await expect(logDecision(sql, director(), validInput(client))).resolves.toBeTruthy();
  });
});

describeDb('Modul D — optimization tracker', () => {
  const before = { views: 3120, clicks: 58, ctr: 1.86, cr: 0, orders: 0 };
  const after20 = { views: 3844, clicks: 96, ctr: 2.5, cr: 0, orders: 0 };

  async function screeningFor(client: string): Promise<string> {
    const d = await runScreening(sql, adsStaff(), {
      clientId: client, sheets: [SIX_SKUS()], targetRoas: 4, berkas: berkas('performa_produk'),
    });
    return d.id;
  }

  it('creates a tracker row, resolves product_code via R09 skuKey, then records after + verdict', async () => {
    const client = await seedClient();
    const screeningId = await screeningFor(client);
    const created = await createTrackerRow(sql, adsStaff(), {
      screeningId, clientId: client, productCode: 'SKU-X', productName: 'Sneakers Outdoor Trail',
      changeDate: '2026-07-01', initialRoute: 'OPTIMASI GAMBAR/JUDUL', changeType: 'Gambar utama', before,
    });
    expect(created.productCode).toBe('SKU-X');
    expect(created.metricEvaluated).toBe('CTR'); // 'Gambar utama' → CTR (R12)
    expect(created.verdict).toBe('BELUM CUKUP DATA'); // no after yet

    const after = await recordTrackerAfter(sql, adsStaff(), { screeningId, productCode: 'SKU-X', after: after20 });
    expect(after.verdict).toBe('BERHASIL'); // CTR +34.4% ≥ 20%
    expect(after.deltaMetricPct).toBeCloseTo(34.4, 0);
    expect(after.after?.views).toBe(3844);
  });

  it('a duplicate (screening_id, product_code) is a ConflictError', async () => {
    const client = await seedClient();
    const screeningId = await screeningFor(client);
    await createTrackerRow(sql, adsStaff(), {
      screeningId, clientId: client, productName: 'Produk Tanpa Kode',
      changeDate: '2026-07-01', initialRoute: 'PARKIR', changeType: 'Harga', before,
    });
    await expect(createTrackerRow(sql, adsStaff(), {
      screeningId, clientId: client, productName: 'Produk Tanpa Kode',
      changeDate: '2026-07-02', initialRoute: 'PARKIR', changeType: 'Deskripsi', before,
    })).rejects.toThrow(MSG_TRACKER_EXISTS);
  });

  it('recordTrackerAfter on an unknown row is a NotFoundError', async () => {
    await expect(recordTrackerAfter(sql, adsStaff(), {
      screeningId: 'SCR-999999-9999', productCode: 'X', after: after20,
    })).rejects.toThrow(NotFoundError);
  });

  it('fewer than minKlikSesudah clicks after → BELUM CUKUP DATA, never a fabricated verdict', async () => {
    const client = await seedClient();
    const screeningId = await screeningFor(client);
    await createTrackerRow(sql, adsStaff(), {
      screeningId, clientId: client, productCode: 'SKU-X', productName: 'Sneakers Outdoor Trail',
      changeDate: '2026-07-01', initialRoute: 'OPTIMASI GAMBAR/JUDUL', changeType: 'Gambar utama', before,
    });
    const after = await recordTrackerAfter(sql, adsStaff(), {
      screeningId, productCode: 'SKU-X', after: { ...after20, clicks: 5 },
    });
    expect(after.verdict).toBe('BELUM CUKUP DATA');
  });
});

describeDb('reads — scope-gated (mirrors the RLS SELECT predicate)', () => {
  it('the creator, an Ads lead, and OD/Director all read; an unrelated Ads staff does not', async () => {
    const client = await seedClient();
    const creator = adsStaff('ZZSK-CREATOR');
    const run = await runScreening(sql, creator, {
      clientId: client, sheets: [SIX_SKUS()], targetRoas: 4, berkas: berkas('performa_produk'),
    });
    await expect(getScreeningRun(sql, creator, run.id)).resolves.toBeTruthy();
    await expect(getScreeningRun(sql, adsLead(), run.id)).resolves.toBeTruthy();
    await expect(getScreeningRun(sql, od(), run.id)).resolves.toBeTruthy();
    await expect(getScreeningRun(sql, director(), run.id)).resolves.toBeTruthy();
    await expect(getScreeningRun(sql, strayAds(), run.id)).rejects.toThrow(ForbiddenError);

    const list = await listScreeningRuns(sql, adsLead(), client);
    expect(list.map((r) => r.id)).toContain(run.id);
    const strayList = await listScreeningRuns(sql, strayAds(), client);
    expect(strayList.map((r) => r.id)).not.toContain(run.id);
  });

  it('listDecisions is scope-gated the same way, including the advertiser named on the row', async () => {
    const client = await seedClient();
    const advertiser = adsStaff('ZZSK-NAMEDADV');
    await logDecision(sql, adsStaff('ZZSK-LOGGER'), {
      clientId: client, advertiserId: advertiser.employeeId, platform: 'Shopee', objectType: 'SKU',
      objectName: 'SKU X', momen: 'masuk_iklan', sopStage: '1-Screening SKU', decision: 'Loloskan ke iklan',
      metricKey: 'ROAS', metricValue: 4, metricTarget: 4,
    });
    const named = await listDecisions(sql, advertiser, client);
    expect(named).toHaveLength(1);
    const stray = await listDecisions(sql, strayAds(), client);
    expect(stray).toHaveLength(0);
  });

  it('listTrackerRows is scope-gated by the parent screening run\'s client', async () => {
    const client = await seedClient();
    const creator = adsStaff('ZZSK-TRKCREATOR');
    const run = await runScreening(sql, creator, {
      clientId: client, sheets: [SIX_SKUS()], targetRoas: 4, berkas: berkas('performa_produk'),
    });
    await createTrackerRow(sql, creator, {
      screeningId: run.id, clientId: client, productCode: 'SKU-A', productName: 'Produk Bintang',
      changeDate: '2026-07-01', initialRoute: 'SCALE', changeType: 'Harga',
      before: { views: 1000, clicks: 80, ctr: 8, cr: 5, orders: 40 },
    });
    await expect(listTrackerRows(sql, creator, run.id)).resolves.toHaveLength(1);
    await expect(listTrackerRows(sql, strayAds(), run.id)).resolves.toHaveLength(0);
    await expect(listTrackerRows(sql, adsLead(), run.id)).resolves.toHaveLength(1);
  });
});
