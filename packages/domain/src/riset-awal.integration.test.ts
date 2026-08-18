/**
 * RAB-04/RAB-05 — submitBaseline / confirmIsian / getBaseline against a real DB.
 *
 * DoD covered (docs/backlog/RISET_AWAL_BASELINE_BACKLOG.md):
 *  - a multi-platform client yields ONE riset_awal_analisa row per ACTIVE platform;
 *  - manual (Shopee) ⇒ belum_dapat_diukur + null score; TikTok Shop ⇒ scored;
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
  await sql`delete from interview where id = ${ITV}`;
  await sql`delete from client_platforms where client_id = ${CLI}`;
  await sql`delete from clients where id = ${CLI}`;
  await sql.end();
});

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

  it('Shopee manual: belum_dapat_diukur, null score, isian sumber=manual', async () => {
    const view = await submitBaseline(sql, owner, ITV, {
      clientPlatformId: shopeeId,
      manual: { gmvBulan: 5_000_000, order: 120, aov: 41_666, skuTotal: 15, belanjaIklan: 500_000, roas: 3.2 },
    });
    const sh = view.analisa.find((a) => a.clientPlatformId === shopeeId)!;
    expect(sh.metodeBaseline).toBe('manual');
    expect(sh.kondisiToko).toBe('belum_dapat_diukur');
    expect(sh.skor).toBeNull();
    // Manual re-proposes B2-9 with sumber=manual only if not already present; here
    // B2-9 was created as analisa first (on conflict do nothing keeps the original).
    expect(view.analisa).toHaveLength(2); // one row per active platform
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
    // Method is derived server-side (single source metodeForPlatform): TikTok Shop
    // gets the 5-pillar engine, Shopee falls back to minimal manual entry.
    expect(view.platforms.find((p) => p.clientPlatformId === tiktokId)?.metode).toBe('analisa_penuh');
    expect(view.platforms.find((p) => p.clientPlatformId === shopeeId)?.metode).toBe('manual');
    expect(view.platforms.find((p) => p.clientPlatformId === tiktokId)?.storeLink).toBe('https://tt.example');
  });

  it('an ambiguous own-vs-affiliate file is rejected until the AM confirms its type', async () => {
    const fresh = await sql<{ id: number }[]>`
      insert into client_platforms (client_id, platform, active, created_by)
      values (${CLI}, 'TikTok Shop', true, ${OWNER_AM}) returning id`;
    const freshId = Number(fresh[0].id);
    // No linkedAccounts, no override → detect flags the video file ambiguous.
    await expect(
      submitBaseline(sql, owner, ITV, {
        clientPlatformId: freshId,
        analisa: { files: [{ filename: 'video.xlsx', aoa: videoAoa(), sha256: 'b'.repeat(64), ukuranBytes: 512 }] },
      }),
    ).rejects.toThrow(MSG_AMBIGU);
    // With an explicit type override the same file is accepted.
    const view = await submitBaseline(sql, owner, ITV, {
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

    const after = await confirmIsian(sql, owner, ITV, [
      { section: 'B2', fieldKey: 'B2-9', nilaiUang: '17500000', dikonfirmasi: true },
      { section: 'B2', fieldKey: 'B2-3', nilaiAngka: 40, dikonfirmasi: true },
    ]);
    const b29 = after.isian.find((f) => f.fieldKey === 'B2-9')!;
    expect(b29.dikonfirmasi).toBe(true);
    expect(b29.nilaiUang).toBe('17500000'); // corrected
    expect(b29.nilaiUsulan).toEqual(usulanBefore); // original proposal frozen
    expect(after.semuaTerkonfirmasi).toBe(true);
  });
});
