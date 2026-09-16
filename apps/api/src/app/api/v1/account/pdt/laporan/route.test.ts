/**
 * GET /api/v1/account/pdt/laporan (G2-01 lanjutan, Flow B langkah 1) — route
 * wiring: auth, query params (`client_platform_id`/`periode`),
 * `pdt.bacaLaporanPdt` (gerbang `canKirimLaporan` + pemilihan platform),
 * wire snake_case (`pdtLaporanTiktokToWire`/`pdtLaporanShopeeToWire`).
 * Cakupan agregasi per-baris ada di `packages/domain/src/pdt.test.ts`
 * (`rakitLaporanTiktok`/`rakitLaporanShopee` langsung) — di sini cukup bukti
 * route SUNGGUHAN menyambungkan seluruhnya, pola sama `batches/route.test.ts`.
 */
import { createHmac } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { pdt as pdtCore } from '@cdps/core';
import { createClient, type Sql } from '@cdps/db';
import { GET } from './route';

const SECRET = 'test-jwt-secret-pdt-laporan';
const prevSecret = process.env.SUPABASE_JWT_SECRET;

interface Claims { employeeId: string; division: string; level: string; od: boolean; director: boolean }

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString('base64url');
}

function sign(c: Claims): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({
    app_metadata: { employee_id: c.employeeId, division: c.division, level: c.level, od: c.od, director: c.director },
    exp: Math.floor(Date.now() / 1000) + 3600,
  }));
  const sig = createHmac('sha256', SECRET).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

function req(token: string, qs: Record<string, string>): Request {
  const url = new URL('http://localhost/api/v1/account/pdt/laporan');
  for (const [k, v] of Object.entries(qs)) url.searchParams.set(k, v);
  return new Request(url, { headers: { authorization: `Bearer ${token}` } });
}

beforeAll(() => {
  process.env.SUPABASE_JWT_SECRET = SECRET;
});
afterAll(() => {
  if (prevSecret === undefined) delete process.env.SUPABASE_JWT_SECRET;
  else process.env.SUPABASE_JWT_SECRET = prevSecret;
});

const owner = sign({ employeeId: 'ZZ-PDTLAP-AM', division: 'Account', level: 'staff', od: false, director: false });
const otherAm = sign({ employeeId: 'ZZ-PDTLAP-LAIN', division: 'Account', level: 'staff', od: false, director: false });

describe('GET /pdt/laporan — gagal sebelum DB tersentuh', () => {
  it('client_platform_id hilang ⇒ 400', async () => {
    const res = await GET(req(owner, { periode: '2026-07-01' }));
    expect(res.status).toBe(400);
  });

  it('periode hilang ⇒ 400', async () => {
    const res = await GET(req(owner, { client_platform_id: '1' }));
    expect(res.status).toBe(400);
  });

  it('client_platform_id bukan integer positif ⇒ 400', async () => {
    const res = await GET(req(owner, { client_platform_id: '-1', periode: '2026-07-01' }));
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Integrasi Postgres nyata (di-skip tanpa DATABASE_URL) — pola fixture sama
// `batches/route.test.ts`, prefix 'ZZ-PDTLAP-'/'CLI-PDTLAP-'.
// ---------------------------------------------------------------------------
const DB_URL = process.env.DATABASE_URL;
const describeDb = describe.skipIf(!DB_URL);
let sql: Sql;
if (DB_URL) sql = createClient(DB_URL);

let seq = 0;
const nextClientId = (): string => `CLI-PDTLAP-${Date.now() % 100000}-${seq++}`;

async function insertClient(id: string, assignedAm: string | null): Promise<void> {
  await sql`
    insert into clients (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv,
      total_sales, sales_pic_id, commission_payment_pic_id, released_to_account_at, assigned_am_id, created_by)
    values (${id}, 'PIC', ${id}, 'Bandung', 'link', 'Fashion', '10000000.00', '20000000.00', '0.00',
      'ZZ-BUDI', 'ZZ-BUDI', now(), ${assignedAm}, 'ZZ-TEST')`;
}

async function insertClientPlatform(clientId: string, platform: string): Promise<number> {
  const rows = await sql<{ id: string }[]>`
    insert into client_platforms (client_id, platform, active, created_by)
    values (${clientId}, ${platform}, true, 'ZZ-TEST') returning id`;
  return Number(rows[0].id);
}

beforeAll(async () => {
  if (!sql) return;
  await sql`
    insert into employees (employee_id, nama, email, divisi, jabatan, status_aktif, created_by)
    values ('ZZ-PDTLAP-AM', 'AM Uji Laporan', 'zz-pdtlap-am@mea.co.id', 'Account', 'Account Manager', true, 'SYSTEM')
    on conflict (employee_id) do nothing`;
});
afterAll(async () => {
  if (!sql) return;
  await sql`delete from employees where employee_id = 'ZZ-PDTLAP-AM'`;
  await sql.end();
});
afterEach(async () => {
  if (!sql) return;
  await sql`delete from pdt_fact_shop_daily where client_platform_id in (select id from client_platforms where client_id like 'CLI-PDTLAP-%')`;
  await sql`delete from pdt_fact_content where client_platform_id in (select id from client_platforms where client_id like 'CLI-PDTLAP-%')`;
  await sql`delete from pdt_fact_ads where client_platform_id in (select id from client_platforms where client_id like 'CLI-PDTLAP-%')`;
  await sql`delete from pdt_fact_creator_period where client_platform_id in (select id from client_platforms where client_id like 'CLI-PDTLAP-%')`;
  await sql`delete from pdt_upload_batch where client_id like 'CLI-PDTLAP-%'`;
  await sql`delete from client_platforms where client_id like 'CLI-PDTLAP-%'`;
  await sql`delete from clients where id like 'CLI-PDTLAP-%'`;
});

describeDb('GET /pdt/laporan — real DB', () => {
  it('404 pada client_platform_id yang tidak ada', async () => {
    const res = await GET(req(owner, { client_platform_id: '999999999', periode: '2026-07-01' }));
    expect(res.status).toBe(404);
  });

  it('403 untuk AM yang bukan pemilik klien', async () => {
    const clientId = nextClientId();
    await insertClient(clientId, 'ZZ-PDTLAP-AM');
    const cpId = await insertClientPlatform(clientId, 'Shopee');
    const res = await GET(req(otherAm, { client_platform_id: String(cpId), periode: '2026-07-01' }));
    expect(res.status).toBe(403);
  });

  it('periode tidak valid ⇒ 400 BI (dari rakitLaporanTiktok/Shopee, bukan 500 mentah)', async () => {
    const clientId = nextClientId();
    await insertClient(clientId, 'ZZ-PDTLAP-AM');
    const cpId = await insertClientPlatform(clientId, 'TikTok Shop');
    const res = await GET(req(owner, { client_platform_id: String(cpId), periode: '2026-07-15' }));
    expect(res.status).toBe(400);
  });

  it('200 TikTok: KPI basis net (GMV−refund) + skor + benchmark_versi, wire snake_case', async () => {
    const clientId = nextClientId();
    await insertClient(clientId, 'ZZ-PDTLAP-AM');
    const cpId = await insertClientPlatform(clientId, 'TikTok Shop');
    const [{ id: batchId }] = await sql<{ id: number }[]>`
      insert into pdt_upload_batch
        (client_id, client_platform_id, platform, periode_mulai, periode_selesai, status, parser_versi, retensi_sampai, dibuat_oleh)
      values (${clientId}, ${cpId}, 'tiktok', '2026-07-01'::date, '2026-07-31'::date, 'verified', ${pdtCore.PDT_PARSER_VERSI}, '2027-07-31'::date, 'ZZ-PDTLAP-AM')
      returning id`;
    await sql`
      insert into pdt_fact_shop_daily (client_platform_id, tanggal, basis, batch_id, parser_versi, gmv, refund, pesanan, pengunjung)
      values (${cpId}, '2026-07-05'::date, 'net', ${batchId}, ${pdtCore.PDT_PARSER_VERSI}, 1_000_000, 50_000, 40, 2_000)`;
    await sql`
      insert into pdt_fact_content (client_platform_id, platform_content_id, periode, batch_id, parser_versi, jenis, is_akun_toko, gmv, vv, durasi_detik)
      values (${cpId}, 'live-1', '2026-07-01'::date, ${batchId}, ${pdtCore.PDT_PARSER_VERSI}, 'live', true, 400_000, 1_000, 7_200)`;
    await sql`
      insert into pdt_fact_content (client_platform_id, platform_content_id, periode, batch_id, parser_versi, jenis, is_akun_toko, gmv, vv, likes, dibagikan, klik_produk)
      values (${cpId}, 'video-1', '2026-07-01'::date, ${batchId}, ${pdtCore.PDT_PARSER_VERSI}, 'video', true, 300_000, 5_000, 200, 10, 40)`;
    await sql`
      insert into pdt_fact_ads (client_platform_id, sumber, kampanye_id, periode, batch_id, parser_versi, biaya, gmv)
      values (${cpId}, 'tt_ads_product', 'CAM-1', '2026-07-01'::date, ${batchId}, ${pdtCore.PDT_PARSER_VERSI}, 100_000, 400_000)`;
    await sql`
      insert into pdt_fact_creator_period
        (client_platform_id, creator_handle, periode, batch_id, parser_versi, gmv, pesanan_teratribusi, jumlah_live, jumlah_video)
      values (${cpId}, 'creator-1', '2026-07-01'::date, ${batchId}, ${pdtCore.PDT_PARSER_VERSI}, 200_000, 5, 2, 3)`;

    const res = await GET(req(owner, { client_platform_id: String(cpId), periode: '2026-07-01' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.schema).toBe('cdps.pdt.laporan.tiktok.v1');
    expect(body.platform).toBe('tiktok');
    expect(body.client_platform_id).toBe(cpId);
    expect(body.periode_awal_bulan).toBe('2026-07-01');
    expect(body.kpi).toEqual({ gmv: 950_000, pesanan: 40, pengunjung: 2_000, cvr: 0.02 });
    expect(body.benchmark_versi).toBe(1);
    expect(body.skor).toHaveProperty('total');
    expect(body.skor).toHaveProperty('dimensi');
    expect(body.kanal).toEqual({ gmv_total: 1_000_000, items: expect.any(Array), lengkap: true });
    // TikTok durasi_detik terisi ⇒ jam/gmv_per_jam keduanya terhitung (beda Shopee di bawah).
    expect(body.live).toEqual({ sesi: 1, gmv: 400_000, vv: 1_000, jam: 2, gmv_per_sesi: 400_000, gmv_per_jam: 200_000 });
    // TikTok punya penulis fakta tt_video ⇒ video terhitung penuh.
    expect(body.video).toEqual({
      total: 1, gmv: 300_000, vv: 5_000, likes: 200, dibagikan: 10, klik_produk: 40,
      gmv_per_video: 300_000, vv_per_video: 5_000,
    });
    // TikTok iklan SELALU lengkap:true — hanya tt_ads_product terisi, tt_ads_live jadi item null.
    expect(body.iklan).toEqual({
      biaya: 100_000, gmv: 400_000, roas: 4,
      items: [
        { kode: 'tt_ads_product', label: 'Iklan Produk', biaya: 100_000, gmv: 400_000, roas: 4 },
        { kode: 'tt_ads_live', label: 'Iklan Live', biaya: null, gmv: null, roas: null },
      ],
      lengkap: true,
    });
    // TikTok afiliasi — satu kreator, jumlah_live/jumlah_video terisi (tt_transaction_creator menulisnya).
    expect(body.afiliasi).toEqual({
      total_kreator: 1, produktif: 1, gmv: 200_000, pesanan: 5, aov: 40_000, jumlah_live: 2, jumlah_video: 3,
    });
    // TikTok tahap — tahap_fokus belum diset ⇒ fokus null. Impresi/ATC SELALU null dengan catatan
    // (ttam belum dibangun); klik funnel null (produk_diklik tidak diisi fixture); reuse langsung
    // gmv/roi/aff_total/aff_produktif/konten dari kpi/iklan/afiliasi/video yang sudah dibangun di atas.
    expect(body.tahap.fokus).toBeNull();
    const funnelByKode = Object.fromEntries(body.tahap.funnel.map((f: { kode: string }) => [f.kode, f]));
    expect(funnelByKode.impresi).toEqual({ kode: 'impresi', label: 'Impresi produk', nilai: null, lolos: null, lolos_dari: null, catatan: 'kolom impresi toko belum ada di skema PDT saat ini' });
    expect(funnelByKode.klik.nilai).toBeNull();
    expect(funnelByKode.atc.catatan).toBe('hanya terbaca dari export Ads Manager Showcase — belum dibangun');
    expect(funnelByKode.pengunjung.nilai).toBe(2_000);
    expect(funnelByKode.pesanan.nilai).toBe(40);
    const blokByKode = Object.fromEntries(body.tahap.blok.map((b: { kode: string }) => [b.kode, b]));
    const metrikByKode = (blok: string): Record<string, unknown> =>
      Object.fromEntries(blokByKode[blok].metrik.map((m: { kode: string; nilai: unknown }) => [m.kode, m.nilai]));
    expect(metrikByKode('conversion').gmv).toBe(950_000);
    expect(metrikByKode('conversion').roi).toBe(4);
    expect(metrikByKode('conversion').cpa).toBeNull();
    expect(metrikByKode('conversion').aff_produktif).toBe(1);
    expect(metrikByKode('consideration').aff_total).toBe(1);
    expect(metrikByKode('consideration').aff_posting).toBe(1);
    expect(metrikByKode('awareness').konten_n).toBe(1);
    expect(metrikByKode('awareness').konten_vv).toBe(5_000);
    expect(blokByKode.conversion.belanja).toBe(100_000);
    // "insight" — nol query baru, dirangkai dari kpi/iklan/live/video/afiliasi di atas + skor.dimensi.
    expect(body.insight.ringkasan).toContain('GMV Rp. 950.000,00 dari 40 pesanan');
    expect(body.insight.poin).toContain('GMV Rp. 950.000,00 dari 40 pesanan (CVR 2,00%).');
    expect(body.insight.poin).toContain('Iklan: belanja Rp. 100.000,00 → GMV Rp. 400.000,00 (ROAS 4,00x).');
    expect(body.insight.poin).toContain('LIVE: 1 sesi/2,0 jam → Rp. 400.000,00 (Rp. 200.000,00/jam).');
    expect(body.insight.poin).toContain('Video: 1 video → Rp. 300.000,00 dari 5.000 views (Rp. 300.000,00/video).');
    expect(body.insight.poin).toContain('Afiliasi: 1 dari 1 kreator produktif, GMV Rp. 200.000,00.');
    expect(Array.isArray(body.insight.rekomendasi_tinggi)).toBe(true);
    expect(Array.isArray(body.insight.rekomendasi_sedang)).toBe(true);
    const roasIndikator = body.insight.indikator.find((i: { nama: string }) => i.nama === 'Target ROAS Iklan (GMV Max)');
    expect(roasIndikator?.target).toContain('kini 4,00x');
  });

  it('200 Shopee: KPI basis siap_dikirim TANPA net-refund, benchmark_versi null (kunci TETAP ada)', async () => {
    const clientId = nextClientId();
    await insertClient(clientId, 'ZZ-PDTLAP-AM');
    const cpId = await insertClientPlatform(clientId, 'Shopee');
    const [{ id: batchId }] = await sql<{ id: number }[]>`
      insert into pdt_upload_batch
        (client_id, client_platform_id, platform, periode_mulai, periode_selesai, status, parser_versi, retensi_sampai, dibuat_oleh)
      values (${clientId}, ${cpId}, 'shopee', '2026-07-01'::date, '2026-07-31'::date, 'verified', ${pdtCore.PDT_PARSER_VERSI}, '2027-07-31'::date, 'ZZ-PDTLAP-AM')
      returning id`;
    await sql`
      insert into pdt_fact_shop_daily (client_platform_id, tanggal, basis, batch_id, parser_versi, gmv, refund, pesanan, pengunjung)
      values (${cpId}, '2026-07-05'::date, 'siap_dikirim', ${batchId}, ${pdtCore.PDT_PARSER_VERSI}, 800_000, 50_000, 20, 1_000)`;
    await sql`
      insert into pdt_fact_content (client_platform_id, platform_content_id, periode, batch_id, parser_versi, jenis, is_akun_toko, gmv, vv)
      values (${cpId}, 'live-1', '2026-07-01'::date, ${batchId}, ${pdtCore.PDT_PARSER_VERSI}, 'live', true, 400_000, 1_000)`;
    await sql`
      insert into pdt_fact_ads (client_platform_id, sumber, kampanye_id, periode, batch_id, parser_versi, biaya, gmv)
      values (${cpId}, 'shopee_ads_cpc', 'kmp-1', '2026-07-01'::date, ${batchId}, ${pdtCore.PDT_PARSER_VERSI}, 100_000, 300_000)`;
    await sql`
      insert into pdt_fact_creator_period (client_platform_id, creator_handle, periode, batch_id, parser_versi, gmv, pesanan_teratribusi)
      values (${cpId}, 'creator-shp', '2026-07-01'::date, ${batchId}, ${pdtCore.PDT_PARSER_VERSI}, 150_000, 3)`;

    const res = await GET(req(owner, { client_platform_id: String(cpId), periode: '2026-07-01' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.schema).toBe('cdps.pdt.laporan.shopee.v1');
    expect(body.platform).toBe('shopee');
    expect(body.kpi).toEqual({ gmv: 800_000, pesanan: 20, pengunjung: 1_000, cvr: 0.02 });
    expect('benchmark_versi' in body).toBe(true);
    expect(body.benchmark_versi).toBeNull();
    // Kanal Shopee SELALU lengkap:false (dua dari enam sumber legacy) — nol baris basis 'dibuat'
    // di fixture ini, jadi gmv_total kanal null (BEDA dari kpi.gmv basis 'siap_dikirim' di atas).
    expect(body.kanal).toEqual({ gmv_total: null, items: [], lengkap: false });
    // Shopee durasi_detik kosong permanen di sumbernya ⇒ jam/gmv_per_jam null, sisanya tetap terhitung.
    expect(body.live).toEqual({ sesi: 1, gmv: 400_000, vv: 1_000, jam: null, gmv_per_sesi: 400_000, gmv_per_jam: null });
    // Shopee video SELALU null (shopee_video nol penulis fakta — tidak ada baris untuk dihitung).
    expect(body.video).toBeNull();
    // Shopee iklan SELALU lengkap:false (ads_banner legacy tidak pernah punya modul PDT) — hanya cpc terisi.
    expect(body.iklan).toEqual({
      biaya: 100_000, gmv: 300_000, roas: 3,
      items: [
        { kode: 'shopee_ads_cpc', label: 'Iklan Toko (CPC)', biaya: 100_000, gmv: 300_000, roas: 3 },
        { kode: 'shopee_ads_search', label: 'Iklan Pencarian', biaya: null, gmv: null, roas: null },
        { kode: 'shopee_ads_live', label: 'Iklan Live', biaya: null, gmv: null, roas: null },
      ],
      lengkap: false,
    });
    // Shopee afiliasi — jumlah_live/jumlah_video SELALU null (shopee_ams_afiliasi tidak pernah menulisnya).
    expect(body.afiliasi).toEqual({
      total_kreator: 1, produktif: 1, gmv: 150_000, pesanan: 3, aov: 50_000, jumlah_live: null, jumlah_video: null,
    });
    // Shopee tahap SELALU null — mesin lama Shopee tidak punya konsep buyer-journey sama sekali.
    expect(body.tahap).toBeNull();
    // "insight" Shopee — kanal DAN iklan belum lengkap ⇒ dua catatan; nol indikator ber-benchTiktok (asimetri asli).
    expect(body.insight.ringkasan).toContain('GMV Rp. 800.000,00 dari 20 pesanan');
    expect(body.insight.poin).toContain('Catatan: rincian kanal belum lengkap — sebagian sumber GMV belum punya penulis fakta PDT.');
    expect(body.insight.poin).toContain('Iklan: belanja Rp. 100.000,00 → GMV Rp. 300.000,00 (ROAS 3,00x).');
    expect(body.insight.poin).toContain('Catatan: rincian iklan belum lengkap — sebagian sumber iklan legacy belum punya modul PDT.');
    expect(body.insight.poin).toContain('LIVE: 1 sesi → Rp. 400.000,00.');
    expect(body.insight.poin).toContain('Afiliasi: 1 dari 1 kreator produktif, GMV Rp. 150.000,00.');
    expect(body.insight.indikator.some((i: { nama: string }) => i.nama === 'Target ROAS Iklan (GMV Max)')).toBe(false);
  });
});
