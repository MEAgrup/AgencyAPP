/**
 * RAB-04/RAB-05 — submitBaseline / confirmIsian / getBaseline against a real DB.
 *
 * DoD covered (docs/backlog/RISET_AWAL_BASELINE_BACKLOG.md):
 *  - a multi-platform client yields ONE riset_awal_analisa row per ACTIVE platform;
 *  - TikTok Shop dan Shopee ⇒ ber-skor lewat mesinnya masing-masing (B2), dengan
 *    kolom benchmark yang BERBEDA (riset_awal_benchmark vs report_benchmark_shopee);
 *    Lazada ⇒ manual, belum_dapat_diukur + skor null;
 *  - auto-fill (RAB-05) writes B2-9/B2-9 proposals with the right `sumber`;
 *  - the server re-stamps `generated_at` (never the browser clock);
 *  - a payload whose kondisi_toko disagrees with the score is rejected (#4);
 *  - a second submit for the same platform is a conflict, not an overwrite;
 *  - confirmIsian flips `dikonfirmasi` / corrects the value while nilai_usulan stays frozen;
 *  - permission: a non-owner AM is forbidden.
 *
 * Skipped unless DATABASE_URL is set. Rows namespaced `ZZI-`, removed in afterAll.
 */
import { permission } from '@cdps/core';
import { createClient, type Sql } from '@cdps/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Actor } from './account';
import {
  MSG_AMBIGU,
  MSG_BASELINE_SUDAH_ADA,
  MSG_PLATFORM_INACTIVE,
  confirmIsian,
  getBaseline,
  submitBaseline,
  type SheetFileInput,
} from './riset-awal';

const URL = process.env.DATABASE_URL;
const dDb = describe.skipIf(!URL);
let sql: Sql;
if (URL) sql = createClient(URL);

const OWNER_AM = 'EMP-0001';
const OTHER_AM = 'EMP-0002';
const SALES = 'EMP-0006';
const CLI = 'CLI-ZZI-0001';
const ITV = 'ITV-ZZI-0001';
let tiktokId = 0;
let shopeeId = 0;
let inactiveId = 0;

const actor = (o: { employeeId: string; division?: string; level?: string }): Actor => ({
  employeeId: o.employeeId,
  divisi: o.division ?? '',
  role: permission.makeRole({ division: o.division ?? '', level: o.level ?? '' }),
});
const owner = actor({ employeeId: OWNER_AM, division: 'Account', level: 'staff' });
const stranger = actor({ employeeId: OTHER_AM, division: 'Account', level: 'staff' });

// A minimal but real "Analitik Toko TikTok" export (detects as shop_tt, not
// ambiguous). The engine runs SERVER-SIDE on this — the browser only parsed the
// xlsx into these rows. Mirrors the shape in baseline.test.ts.
const SHOP_TT_HEADER = [
  '', 'GMV', 'GMV dari LIVE kreator', 'Pengunjung', 'Pengembalian dana', 'Pesanan', 'Persentase konversi',
  'AOV', 'Pembeli', 'Produk terjual', 'Pendapatan bruto', 'Tayangan halaman', 'Impresi produk', 'Klik produk',
  'GMV dari LIVE akun tertaut', 'GMV LIVE penjual', 'GMV tidak langsung dari LIVE penjual',
  'GMV dari video afiliasi', 'GMV dari video akun tertaut',
];
const shopTtAoa = (): unknown[][] => {
  const tot = [
    'Total nilai penjualan', 'Rp100.000.000', 'Rp10.000.000', '50.000', 'Rp5.000.000',
    '1.000', '2,00%', 'Rp100.000', '900', '1.200', 'Rp95.000.000', '80.000', '500.000', '20.000',
    'Rp8.000.000', 'Rp0', 'Rp0', 'Rp15.000.000', 'Rp12.000.000',
  ];
  const chg = ['Perubahan (%)', '5,00%', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''];
  const daily = (t: string, g: string, o: string): unknown[] => {
    const r = new Array(19).fill('');
    r[0] = t; r[1] = g; r[5] = o;
    return r;
  };
  return [
    ['Ringkasan Toko 2026-08-01 ~ 2026-08-31'],
    ['Semua', 'Semua', 'Semua'],
    SHOP_TT_HEADER,
    tot, chg,
    daily('01/08/2026', 'Rp3.000.000', '30'),
    daily('02/08/2026', 'Rp4.000.000', '40'),
  ];
};
// ── Shopee (B2) ─────────────────────────────────────────────────────────────
// Satu berkas "Bisnis — Home" saja: gerbang mesin Shopee hanya mewajibkan itu
// (keputusan pemilik 2026-09-06), dan tes ini memang harus membuktikan bahwa
// unggahan seadanya sudah menghasilkan skor.
const SHOPEE_HOME_HEADER = [
  'Periode Waktu', 'Total Penjualan (IDR)', 'Total Pesanan', 'Penjualan per Pesanan', 'Produk Diklik',
  'Total Pengunjung', 'Tingkat Konversi Pesanan', 'Pesanan Dibatalkan', 'Penjualan Dibatalkan',
  'Pesanan Dikembalikan', 'Penjualan Dikembalikan', 'Pembeli', 'Total Pembeli Baru', 'Total Pembeli Saat Ini',
  'Total Potensi Pembeli', 'Tingkat Pembelian Berulang',
];
const shopeeHomeAoa = (): unknown[][] => [
  ['Pesanan Dibuat'],
  SHOPEE_HOME_HEADER,
  ['Total', 'Rp80.000.000', '800', 'Rp100.000', '4.000', '40.000', '2,00%', '40', 'Rp4.000.000', '8', 'Rp800.000', '720', '240', '480', '40', '20,00%'],
  ['01/08/2026', 'Rp2.500.000', '25', 'Rp100.000', '120', '1.500', '1,60%', '1', 'Rp40.000', '0', 'Rp0', '20', '8', '12', '2', '10,00%'],
];
// Nama berkas mentah Seller Centre — lapis deteksi ke-2 (`detectModuleFromRawName`),
// jalur yang AM benar-benar pakai: mereka mengunggah apa adanya, tanpa rename.
const shopeeHomeFile = (): SheetFileInput => ({
  filename: 'ezzy.shopee-shop-stats.20260801-20260831.xlsx',
  aoa: shopeeHomeAoa(), sha256: 'c'.repeat(64), ukuranBytes: 4096, tanggalAmbil: '2026-09-01',
});
const SHOPEE_HIST = [
  { key: '2026-05', label: 'Mei 2026', gmv: '70.000.000', order: '700', flag: 'normal' as const },
  { key: '2026-06', label: 'Jun 2026', gmv: '75.000.000', order: '750', flag: 'normal' as const },
  { key: '2026-07', label: 'Jul 2026', gmv: '80.000.000', order: '800', flag: 'normal' as const },
];

const shopTtFile = (): SheetFileInput => ({
  filename: 'toko.xlsx', aoa: shopTtAoa(), sha256: 'a'.repeat(64), ukuranBytes: 2048, tanggalAmbil: '2026-08-18',
});

// A video export with one unknown creator: detect() flags it ambiguous (own vs
// affiliate) unless the AM confirms the type.
const VIDEO_HEADER = ['Informasi Video', 'Nama Kreator', 'ID Video', 'Waktu', 'GMV dari video (Rp)', 'GPM (Rp)', 'VV', 'Likes', 'CTOR (pesanan SKU)'];
const videoAoa = (): unknown[][] => [
  ['Video 2026-08-01 ~ 2026-08-31'],
  ['Semua', 'Semua', 'Semua'],
  VIDEO_HEADER,
  ['Promo #promo', 'Kreator X', 'v1', '2026/08/05 10:00', 'Rp2.000.000', 'Rp150.000', '20.000', '500', '1,20%'],
];

beforeAll(async () => {
  if (!sql) return;
  await sql`
    insert into clients (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv,
                         sales_pic_id, commission_payment_pic_id, assigned_am_id, created_by)
    values (${CLI}, 'PIC', 'Toko', 'Jakarta', 'https://t.example', 'Fashion', 0, 0,
            ${SALES}, ${SALES}, ${OWNER_AM}, ${OWNER_AM})
    on conflict (id) do nothing`;
  await sql`
    insert into interview (id, client_id, am_pengisi_id, sales_closing_id, status, created_by)
    values (${ITV}, ${CLI}, ${OWNER_AM}, ${SALES}, 'Selesai', ${OWNER_AM})
    on conflict (id) do nothing`;
  // The baseline children FK to interview_riset_awal (the M6A step), not interview.
  await sql`
    insert into interview_riset_awal (interview_id, dimulai_oleh)
    values (${ITV}, ${OWNER_AM})
    on conflict (interview_id) do nothing`;

  const tt = await sql<{ id: number }[]>`
    insert into client_platforms (client_id, platform, store_link, active, created_by)
    values (${CLI}, 'TikTok Shop', 'https://tt.example', true, ${OWNER_AM}) returning id`;
  tiktokId = Number(tt[0].id);
  const sh = await sql<{ id: number }[]>`
    insert into client_platforms (client_id, platform, store_link, active, created_by)
    values (${CLI}, 'Shopee', 'https://sh.example', true, ${OWNER_AM}) returning id`;
  shopeeId = Number(sh[0].id);
  const inact = await sql<{ id: number }[]>`
    insert into client_platforms (client_id, platform, store_link, active, created_by)
    values (${CLI}, 'Lazada', 'https://lz.example', false, ${OWNER_AM}) returning id`;
  inactiveId = Number(inact[0].id);
});

afterAll(async () => {
  if (!sql) return;
  await sql`delete from interview where id like 'ITV-ZZI-%'`;
  await sql`delete from client_platforms where client_id like 'CLI-ZZI-%'`;
  await sql`delete from clients where id like 'CLI-ZZI-%'`;
  await sql.end();
});

// A handful of tests need an ISOLATED platform row (its own submission state,
// untouched by the shared TikTok Shop/Shopee rows above) but must still carry
// the real platform label so the right engine is derived. Since PX-M2a §4b
// (`uq_client_platforms_active_platform`) now forbids two ACTIVE rows for the
// same (client_id, platform) — exactly the "2 klien = 1 toko" invariant this
// index exists to enforce — each such case gets its OWN scratch client
// instead of piling a second active row onto the shared `CLI` fixture.
let scratchSeq = 1;
async function freshInterviewWithPlatform(platform: string): Promise<{ interviewId: string; platformId: number }> {
  scratchSeq += 1;
  const seq = String(scratchSeq).padStart(4, '0');
  const clientId = `CLI-ZZI-${seq}`;
  const interviewId = `ITV-ZZI-${seq}`;
  await sql`
    insert into clients (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv,
                         sales_pic_id, commission_payment_pic_id, assigned_am_id, created_by)
    values (${clientId}, 'PIC', 'Toko', 'Jakarta', 'https://t.example', 'Fashion', 0, 0,
            ${SALES}, ${SALES}, ${OWNER_AM}, ${OWNER_AM})`;
  await sql`
    insert into interview (id, client_id, am_pengisi_id, sales_closing_id, status, created_by)
    values (${interviewId}, ${clientId}, ${OWNER_AM}, ${SALES}, 'Selesai', ${OWNER_AM})`;
  await sql`
    insert into interview_riset_awal (interview_id, dimulai_oleh)
    values (${interviewId}, ${OWNER_AM})`;
  const rows = await sql<{ id: number }[]>`
    insert into client_platforms (client_id, platform, active, created_by)
    values (${clientId}, ${platform}, true, ${OWNER_AM}) returning id`;
  return { interviewId, platformId: Number(rows[0].id) };
}

dDb('submitBaseline — per-platform baseline + auto-fill', () => {
  it('TikTok Shop analisa_penuh: engine runs server-side, scored, isian sumber=analisa', async () => {
    const before = Date.now();
    const view = await submitBaseline(sql, owner, ITV, {
      clientPlatformId: tiktokId,
      analisa: { files: [shopTtFile()], net: true },
    });

    const tt = view.analisa.find((a) => a.clientPlatformId === tiktokId)!;
    expect(tt.metodeBaseline).toBe('analisa_penuh');
    // Server-computed score → a computed store condition (never belum_dapat_diukur).
    expect(typeof tt.skor).toBe('number');
    expect(tt.kondisiToko).not.toBe('belum_dapat_diukur');
    expect(tt.benchmarkVersi).toBe(1);
    expect(tt.parserVersi).toBe('cdps-baseline-v1');

    // Auto-fill (RAB-05): B2-9 from analisa, in minor units (aov ~Rp95rb–100rb → ~9.5jt minor).
    const b29 = view.isian.find((f) => f.fieldKey === 'B2-9')!;
    expect(b29.sumber).toBe('analisa');
    expect(BigInt(b29.nilaiUang!)).toBeGreaterThan(0n);
    expect(b29.dikonfirmasi).toBe(false);

    // Provenance: the uploaded file recorded with its detected type + sha256.
    const berkas = await sql<{ tipe: string | null; sha: string }[]>`
      select tipe_terdeteksi as tipe, sha256 as sha from riset_awal_sumber_berkas
       where interview_id = ${ITV} and sha256 = ${'a'.repeat(64)}`;
    expect(berkas[0]?.tipe).toBe('shop_tt');

    // generated_at is the SERVER clock (the browser never supplies it).
    const row = await sql<{ ga: string }[]>`
      select payload->>'generated_at' as ga from riset_awal_analisa where client_platform_id = ${tiktokId}`;
    expect(Date.parse(row[0].ga)).toBeGreaterThanOrEqual(before);
  });

  it('Shopee analisa_penuh (B2): mesin jalan di server, ber-skor, kondisi_toko terhitung', async () => {
    const view = await submitBaseline(sql, owner, ITV, {
      clientPlatformId: shopeeId,
      analisa: { files: [shopeeHomeFile()], hist: SHOPEE_HIST, periode: 'Agustus 2026' },
    });
    const sh = view.analisa.find((a) => a.clientPlatformId === shopeeId)!;
    expect(sh.metodeBaseline).toBe('analisa_penuh');
    expect(typeof sh.skor).toBe('number');
    expect(sh.kondisiToko).not.toBe('belum_dapat_diukur');
    // Provenance benchmark: kolom SHOPEE yang terisi, kolom TikTok kosong —
    // CHECK ck_analisa_benchmark_xor menegakkannya di DB (migrasi B2).
    expect(sh.benchmarkVersiShopee).toBe(1);
    expect(sh.benchmarkVersi).toBeNull();
    expect(sh.parserVersi).toBe('cdps-baseline-shopee-v1');
    expect(view.analisa).toHaveLength(2); // satu baris per platform aktif

    const row = await sql<{ schema: string; skor: number }[]>`
      select payload->>'schema' as schema, skor from riset_awal_analisa
       where client_platform_id = ${shopeeId}`;
    expect(row[0].schema).toBe('cdps.baseline.shopee.v1');
    // Skala 0–100 (kolom integer + ck_analisa_skor_range), bukan 0–10 mentah.
    expect(Number(row[0].skor)).toBeGreaterThan(10);
    expect(Number(row[0].skor)).toBeLessThanOrEqual(100);

    // Berkas terdeteksi lewat nama mentah Seller Centre, tanpa rename manual.
    const berkas = await sql<{ tipe: string | null }[]>`
      select tipe_terdeteksi as tipe from riset_awal_sumber_berkas
       where interview_id = ${ITV} and sha256 = ${'c'.repeat(64)}`;
    expect(berkas[0]?.tipe).toBe('bisnis_home');
  });


  it('a multi-platform client has exactly one analisa row per ACTIVE platform', async () => {
    const view = await getBaseline(sql, owner, ITV);
    const platformIds = view.analisa.map((a) => a.clientPlatformId).sort();
    expect(platformIds).toEqual([tiktokId, shopeeId].sort());
    expect(platformIds).not.toContain(inactiveId);
  });

  it('platforms slots come from ACTIVE client_platforms with a derived method (RAB-04 UI)', async () => {
    const view = await getBaseline(sql, owner, ITV);
    // Sub-sections the panel renders are the ACTIVE platforms — the inactive Lazada
    // store never gets a slot, so the AM is never asked to baseline a dead store.
    const slotIds = view.platforms.map((p) => p.clientPlatformId).sort();
    expect(slotIds).toEqual([tiktokId, shopeeId].sort());
    expect(slotIds).not.toContain(inactiveId);
    // Metode diturunkan server-side (satu sumber: metodeForPlatform). Sejak B2
    // KEDUANYA bermesin — Shopee tak lagi jatuh ke entri manual.
    expect(view.platforms.find((p) => p.clientPlatformId === tiktokId)?.metode).toBe('analisa_penuh');
    expect(view.platforms.find((p) => p.clientPlatformId === shopeeId)?.metode).toBe('analisa_penuh');
    expect(view.platforms.find((p) => p.clientPlatformId === tiktokId)?.storeLink).toBe('https://tt.example');
  });

  it('Shopee tanpa berkas Bisnis — Home ditolak dengan pesan BI', async () => {
    const { interviewId, platformId } = await freshInterviewWithPlatform('Shopee');
    await expect(
      submitBaseline(sql, owner, interviewId, {
        clientPlatformId: platformId,
        analisa: { files: [{ filename: 'entah.xlsx', aoa: [['a']], sha256: 'd'.repeat(64), ukuranBytes: 10 }] },
      }),
    ).rejects.toThrow('[tipe berkas Shopee tidak dikenali');
  });

  it('TikTok Shop with manualOverride: opts out of the engine, treated as manual (owner QA 2026-08-27)', async () => {
    const { interviewId, platformId: overrideId } = await freshInterviewWithPlatform('TikTok Shop');
    // No files at all — an AM using the shortcut never uploads an export.
    const view = await submitBaseline(sql, owner, interviewId, {
      clientPlatformId: overrideId,
      manual: { gmvBulan: 5_000_000, order: 120, aov: 41_666, skuTotal: 15, belanjaIklan: 500_000, roas: 3.2 },
      manualOverride: true,
    });
    const tt = view.analisa.find((a) => a.clientPlatformId === overrideId)!;
    // Persisted as 'manual' (not 'analisa_penuh') even though the platform name
    // would normally derive the engine — same DB contract as any manual row.
    expect(tt.metodeBaseline).toBe('manual');
    expect(tt.kondisiToko).toBe('belum_dapat_diukur');
    expect(tt.skor).toBeNull();
    // The slot itself still reports the platform's real capability (RAB-04 UI) —
    // manualOverride is a per-submission choice, not a change to what TikTok Shop is.
    expect(view.platforms.find((p) => p.clientPlatformId === overrideId)?.metode).toBe('analisa_penuh');
  });

  it('Lazada manual: belum_dapat_diukur, skor null (jalur tanpa mesin masih ada)', async () => {
    const fresh = await sql<{ id: number }[]>`
      insert into client_platforms (client_id, platform, active, created_by)
      values (${CLI}, 'Lazada', true, ${OWNER_AM}) returning id`;
    const id = Number(fresh[0].id);
    const view = await submitBaseline(sql, owner, ITV, {
      clientPlatformId: id,
      manual: { gmvBulan: 5_000_000, order: 120, aov: 41_666, skuTotal: 15, belanjaIklan: 500_000, roas: 3.2 },
    });
    const lz = view.analisa.find((a) => a.clientPlatformId === id)!;
    expect(lz.metodeBaseline).toBe('manual');
    expect(lz.kondisiToko).toBe('belum_dapat_diukur');
    expect(lz.skor).toBeNull();
    expect(lz.benchmarkVersi).toBeNull();
    expect(lz.benchmarkVersiShopee).toBeNull();
  });

  it('manualOverride is ignored for a platform that is already manual (nothing to opt out of)', async () => {
    const { interviewId, platformId: lazadaId } = await freshInterviewWithPlatform('Lazada');
    const view = await submitBaseline(sql, owner, interviewId, {
      clientPlatformId: lazadaId,
      manual: { gmvBulan: 1_000_000, order: 10, aov: 100_000, skuTotal: 5, belanjaIklan: 0, roas: 0 },
      manualOverride: true,
    });
    expect(view.analisa.find((a) => a.clientPlatformId === lazadaId)?.metodeBaseline).toBe('manual');
  });

  it('an ambiguous own-vs-affiliate file is rejected until the AM confirms its type', async () => {
    const { interviewId, platformId: freshId } = await freshInterviewWithPlatform('TikTok Shop');
    // No linkedAccounts, no override → detect flags the video file ambiguous.
    await expect(
      submitBaseline(sql, owner, interviewId, {
        clientPlatformId: freshId,
        analisa: { files: [{ filename: 'video.xlsx', aoa: videoAoa(), sha256: 'b'.repeat(64), ukuranBytes: 512 }] },
      }),
    ).rejects.toThrow(MSG_AMBIGU);
    // With an explicit type override the same file is accepted.
    const view = await submitBaseline(sql, owner, interviewId, {
      clientPlatformId: freshId,
      analisa: { files: [{ filename: 'video.xlsx', aoa: videoAoa(), sha256: 'b'.repeat(64), ukuranBytes: 512, tipeOverride: 'vid_toko' }] },
    });
    expect(view.analisa.find((a) => a.clientPlatformId === freshId)?.metodeBaseline).toBe('analisa_penuh');
  });

  it('a second submit for the same platform is a conflict, not an overwrite', async () => {
    await expect(
      submitBaseline(sql, owner, ITV, { clientPlatformId: tiktokId, analisa: { files: [shopTtFile()] } }),
    ).rejects.toThrow(MSG_BASELINE_SUDAH_ADA);
  });

  it('an inactive platform is rejected', async () => {
    await expect(
      submitBaseline(sql, owner, ITV, {
        clientPlatformId: inactiveId,
        manual: { gmvBulan: 1, order: 1, aov: 1, skuTotal: 1, belanjaIklan: 1, roas: 1 },
      }),
    ).rejects.toThrow(MSG_PLATFORM_INACTIVE);
  });

  it('a non-owner AM is forbidden', async () => {
    await expect(getBaseline(sql, stranger, ITV)).rejects.toThrow();
  });
});

dDb('confirmIsian — per-number confirmation (keputusan 1)', () => {
  it('flips dikonfirmasi + corrects the value; nilai_usulan stays frozen', async () => {
    const before = await getBaseline(sql, owner, ITV);
    expect(before.semuaTerkonfirmasi).toBe(false);
    const usulanBefore = before.isian.find((f) => f.fieldKey === 'B2-9')!.nilaiUsulan;

    // Konfirmasi SETIAP angka auto-fill supaya gerbang submit terbuka. Selain
    // B2-9/B2-3, baseline Shopee (riwayat 3 bulan) mengusulkan B1-5 dari
    // `runrate_3m × 3` — jadi sumbernya `analisa`, bukan `manual`, sejak B2.
    // target_gmv 0 di seed ini, jadi B6-3 tidak diusulkan.
    const after = await confirmIsian(sql, owner, ITV, [
      { section: 'B2', fieldKey: 'B2-9', nilaiUang: '17500000', dikonfirmasi: true },
      { section: 'B2', fieldKey: 'B2-3', nilaiAngka: 40, dikonfirmasi: true },
      { section: 'B1', fieldKey: 'B1-5', nilaiUang: '1500000000', dikonfirmasi: true },
    ]);
    const b29 = after.isian.find((f) => f.fieldKey === 'B2-9')!;
    expect(b29.dikonfirmasi).toBe(true);
    expect(b29.nilaiUang).toBe('17500000'); // corrected
    expect(b29.nilaiUsulan).toEqual(usulanBefore); // original proposal frozen
    const b15 = after.isian.find((f) => f.fieldKey === 'B1-5')!;
    expect(b15.sumber).toBe('analisa');
    expect(b15.nilaiUang).toBe('1500000000');
    expect(after.semuaTerkonfirmasi).toBe(true);
  });
});
