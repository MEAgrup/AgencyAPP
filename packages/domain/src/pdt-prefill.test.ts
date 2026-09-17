/**
 * G3-01 — pembaca fakta bersama per `client_platform_id` + periode.
 *
 * DB nyata (di-skip tanpa `DATABASE_URL`, pola sama `pdt.test.ts`). Baris
 * fixture ditulis LANGSUNG ke tabel fakta (bukan lewat `commitUploadBatch`) —
 * modul ini murni pembaca, jalur tulis sudah diuji tuntas di `pdt.test.ts`.
 * Prefix `ZPDTPF-` (client) / `ZZPDTPF-` (created_by) supaya `afterEach` di
 * sini tidak bentrok dengan fixture `pdt.test.ts`.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type Sql } from '@cdps/db';
import {
  bacaFaktaAds,
  bacaFaktaContent,
  bacaFaktaCreatorPeriode,
  bacaFaktaKesehatanPenalti,
  bacaFaktaShopDaily,
  bacaFaktaSkuPeriode,
} from './pdt-prefill';

const URL = process.env.DATABASE_URL;
const describeDb = describe.skipIf(!URL);

let sql: Sql;
if (URL) sql = createClient(URL);

let seq = 0;
const nextClientId = (): string => `CLI-ZPDTPF-${Date.now() % 100000}-${seq++}`;
const OWNER_AM = 'ZPDTPF-AM';

beforeAll(async () => {
  if (!sql) return;
  await sql`
    insert into employees (employee_id, nama, email, divisi, jabatan, status_aktif, created_by)
    values (${OWNER_AM}, 'AM Uji Prefill', 'zpdtpf-am@mea.co.id', 'Account', 'Account Manager', true, 'SYSTEM')
    on conflict (employee_id) do nothing`;
});

afterAll(async () => {
  if (!sql) return;
  await sql`delete from employees where employee_id = ${OWNER_AM}`;
  await sql.end();
});

afterEach(async () => {
  if (!sql) return;
  await sql`delete from pdt_fact_ads where client_platform_id in (select id from client_platforms where created_by = 'ZZPDTPF-TEST')`;
  await sql`delete from pdt_fact_content where client_platform_id in (select id from client_platforms where created_by = 'ZZPDTPF-TEST')`;
  await sql`delete from pdt_fact_creator_period where client_platform_id in (select id from client_platforms where created_by = 'ZZPDTPF-TEST')`;
  // `pdt_fact_sku_period.client_platform_id` didenormalisasi langsung sejak migrasi 20261025010000 —
  // filter lewat kolom itu, BUKAN sku_id/pdt_sku_master join (baris level-produk-induk sku_id NULL
  // tidak akan tertangkap join itu, persis alasan kolom ini ditambahkan).
  await sql`delete from pdt_fact_sku_period where client_platform_id in (select id from client_platforms where created_by = 'ZZPDTPF-TEST')`;
  await sql`delete from pdt_sku_master where client_platform_id in (select id from client_platforms where created_by = 'ZZPDTPF-TEST')`;
  await sql`delete from pdt_fact_shop_daily where client_platform_id in (select id from client_platforms where created_by = 'ZZPDTPF-TEST')`;
  await sql`delete from pdt_fact_kesehatan_penalti where client_platform_id in (select id from client_platforms where created_by = 'ZZPDTPF-TEST')`;
  await sql`delete from pdt_upload_batch where client_id like 'CLI-ZPDTPF-%'`;
  await sql`delete from client_platforms where created_by = 'ZZPDTPF-TEST'`;
  await sql`delete from clients where created_by = 'ZZPDTPF-TEST'`;
});

async function insertClient(id: string): Promise<void> {
  await sql`
    insert into clients (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv,
      total_sales, sales_pic_id, commission_payment_pic_id, released_to_account_at, assigned_am_id, created_by)
    values (${id}, 'PIC', ${id}, 'Bandung', 'link', 'Fashion', '10000000.00', '20000000.00', '0.00',
      'ZZ-BUDI', 'ZZ-BUDI', now(), ${OWNER_AM}, 'ZZPDTPF-TEST')`;
}

// `client_platforms.platform` (Title Case, `ck_client_platforms_platform`) BEDA kosakata dari
// `pdt_upload_batch.platform` (lowercase, `ck_pdt_upload_batch_platform`) — pola sama `pdt.test.ts`.
async function insertClientPlatform(clientId: string, platformTitleCase: string): Promise<number> {
  const rows = await sql<{ id: number }[]>`
    insert into client_platforms (client_id, platform, active, created_by)
    values (${clientId}, ${platformTitleCase}, true, 'ZZPDTPF-TEST')
    returning id`;
  return rows[0].id;
}

async function insertBatch(clientId: string, clientPlatformId: number, platform: string, parserVersi = 1): Promise<number> {
  const rows = await sql<{ id: number }[]>`
    insert into pdt_upload_batch (client_id, client_platform_id, platform, periode_mulai, periode_selesai,
      status, parser_versi, retensi_sampai, dibuat_oleh)
    values (${clientId}, ${clientPlatformId}, ${platform}, '2026-08-01', '2026-08-31',
      'verified', ${parserVersi}, '2099-01-01', ${OWNER_AM})
    returning id`;
  return rows[0].id;
}

const PERIODE = '2026-08-01';

describeDb('bacaFaktaShopDaily (G3-01) — agregasi bulanan + sumberBatch', () => {
  it('menjumlahkan gmv/pesanan lintas hari, null-aware untuk kolom opsional, satu basis SAJA', async () => {
    const clientId = nextClientId();
    await insertClient(clientId);
    const cpId = await insertClientPlatform(clientId, 'Shopee');
    const batchId = await insertBatch(clientId, cpId, 'shopee');

    await sql`
      insert into pdt_fact_shop_daily (client_platform_id, tanggal, basis, batch_id, parser_versi, gmv, pesanan, pengunjung, refund)
      values (${cpId}, '2026-08-01', 'dibuat', ${batchId}, 1, '1000000.00', 10, 500, '50000.00'),
             (${cpId}, '2026-08-02', 'dibuat', ${batchId}, 1, '2000000.00', 20, null, '0.00'),
             (${cpId}, '2026-08-01', 'siap_dikirim', ${batchId}, 1, '900000.00', 9, 400, '0.00')`;

    const hasil = await bacaFaktaShopDaily(sql, cpId, PERIODE, 'dibuat');
    expect(hasil).not.toBeNull();
    expect(hasil!.hari).toBe(2);
    expect(hasil!.gmv).toBe(3000000);
    expect(hasil!.pesanan).toBe(30);
    // pengunjung NULL di satu baris (count(pengunjung)=1, bukan 0) ⇒ tetap terisi, hanya baris itu diabaikan sum-nya.
    expect(hasil!.pengunjung).toBe(500);
    expect(hasil!.refund).toBe(50000);
    expect(hasil!.sumberBatch).toEqual([{ batchId, parserVersi: 1 }]);

    const basisLain = await bacaFaktaShopDaily(sql, cpId, PERIODE, 'net');
    expect(basisLain).toBeNull();
  });

  it('produkTerjual/pembeli null KESELURUHAN (nol baris ada nilainya) ⇒ null, bukan 0', async () => {
    const clientId = nextClientId();
    await insertClient(clientId);
    const cpId = await insertClientPlatform(clientId, 'TikTok Shop');
    const batchId = await insertBatch(clientId, cpId, 'tiktok');

    await sql`
      insert into pdt_fact_shop_daily (client_platform_id, tanggal, basis, batch_id, parser_versi, gmv, pesanan)
      values (${cpId}, '2026-08-05', 'net', ${batchId}, 1, '500000.00', 5)`;

    const hasil = await bacaFaktaShopDaily(sql, cpId, PERIODE, 'net');
    expect(hasil).not.toBeNull();
    expect(hasil!.produkTerjual).toBeNull();
    expect(hasil!.pembeli).toBeNull();
    expect(hasil!.gmv).toBe(500000);
  });

  it('nol baris ⇒ null (bukan agregat nol)', async () => {
    const clientId = nextClientId();
    await insertClient(clientId);
    const cpId = await insertClientPlatform(clientId, 'TikTok Shop');
    expect(await bacaFaktaShopDaily(sql, cpId, PERIODE, 'net')).toBeNull();
  });
});

describeDb('bacaFaktaSkuPeriode (G3-01) — daftar per-SKU, batchId per baris', () => {
  it('mengembalikan kuadran + provenance apa adanya, disaring basis', async () => {
    const clientId = nextClientId();
    await insertClient(clientId);
    const cpId = await insertClientPlatform(clientId, 'TikTok Shop');
    const batchId = await insertBatch(clientId, cpId, 'tiktok');

    const [{ id: skuId }] = await sql<{ id: number }[]>`
      insert into pdt_sku_master (client_platform_id, platform_product_id) values (${cpId}, 'SKU-1') returning id`;

    // `client_platform_id`/`basis` di pdt_fact_sku_period didenormalisasi LANGSUNG di tabel ini
    // sejak G1-09-2BII-ADS-CPC-SKU (migrasi 20261025010000) — bukan diturunkan lewat join
    // pdt_sku_master (baris level-produk-induk, sku_id NULL, tidak akan punya jalur join itu).
    await sql`
      insert into pdt_fact_sku_period (sku_id, client_platform_id, periode, basis, batch_id, parser_versi, gmv, kuadran)
      values (${skuId}, ${cpId}, ${PERIODE}::date, 'net', ${batchId}, 2, '750000.00', 'bintang'),
             (${skuId}, ${cpId}, ${PERIODE}::date, 'dibuat', ${batchId}, 2, '999999.00', 'hidden_gem')`;

    // Baris level-produk-induk (sku_id NULL, identitas platform_product_id) — pola tt_product_analytics.
    await sql`
      insert into pdt_fact_sku_period (sku_id, client_platform_id, platform_product_id, nama_produk, periode, basis, batch_id, parser_versi, gmv, kuadran)
      values (null, ${cpId}, 'PROD-1', 'Produk Induk 1', ${PERIODE}::date, 'net', ${batchId}, 2, '250000.00', 'kuda_beban')`;

    const hasil = await bacaFaktaSkuPeriode(sql, cpId, PERIODE, 'net');
    expect(hasil).toHaveLength(2);
    expect(hasil).toContainEqual(
      expect.objectContaining({ skuId, platformProductId: null, gmv: 750000, kuadran: 'bintang', batchId, parserVersi: 2 }),
    );
    expect(hasil).toContainEqual(
      expect.objectContaining({
        skuId: null,
        platformProductId: 'PROD-1',
        namaProduk: 'Produk Induk 1',
        gmv: 250000,
        kuadran: 'kuda_beban',
        batchId,
      }),
    );
  });
});

describeDb('bacaFaktaContent (G3-01) — daftar per-konten, filter jenis + isAkunToko', () => {
  it('memisahkan video vs live, menyaring is_akun_toko bila diminta', async () => {
    const clientId = nextClientId();
    await insertClient(clientId);
    const cpId = await insertClientPlatform(clientId, 'TikTok Shop');
    const batchId = await insertBatch(clientId, cpId, 'tiktok');

    await sql`
      insert into pdt_fact_content (client_platform_id, platform_content_id, batch_id, parser_versi, periode, jenis, is_akun_toko, vv, gmv)
      values (${cpId}, 'VID-1', ${batchId}, 1, ${PERIODE}::date, 'video', true, 1000, '100000.00'),
             (${cpId}, 'VID-2', ${batchId}, 1, ${PERIODE}::date, 'video', false, 2000, '200000.00'),
             (${cpId}, 'LIVE-1', ${batchId}, 1, ${PERIODE}::date, 'live', true, 3000, '300000.00')`;

    const semuaVideo = await bacaFaktaContent(sql, cpId, PERIODE, 'video');
    expect(semuaVideo).toHaveLength(2);

    const videoToko = await bacaFaktaContent(sql, cpId, PERIODE, 'video', true);
    expect(videoToko).toHaveLength(1);
    expect(videoToko[0]).toMatchObject({ platformContentId: 'VID-1', gmv: 100000, batchId });

    const live = await bacaFaktaContent(sql, cpId, PERIODE, 'live');
    expect(live).toHaveLength(1);
    expect(live[0].platformContentId).toBe('LIVE-1');
  });
});

describeDb('bacaFaktaCreatorPeriode (G3-01)', () => {
  it('mengembalikan satu baris per kreator dengan provenance', async () => {
    const clientId = nextClientId();
    await insertClient(clientId);
    const cpId = await insertClientPlatform(clientId, 'Shopee');
    const batchId = await insertBatch(clientId, cpId, 'shopee');

    await sql`
      insert into pdt_fact_creator_period (client_platform_id, creator_handle, periode, batch_id, parser_versi, gmv, sampel_terkirim)
      values (${cpId}, '@kreator1', ${PERIODE}::date, ${batchId}, 1, '400000.00', 10)`;

    const hasil = await bacaFaktaCreatorPeriode(sql, cpId, PERIODE);
    expect(hasil).toEqual([
      expect.objectContaining({ creatorHandle: '@kreator1', gmv: 400000, sampelTerkirim: 10, batchId, parserVersi: 1 }),
    ]);
  });
});

describeDb('bacaFaktaAds (G3-01) — filter sumber opsional', () => {
  it('tanpa filter mengembalikan semua sumber, dengan filter hanya yang cocok', async () => {
    const clientId = nextClientId();
    await insertClient(clientId);
    const cpId = await insertClientPlatform(clientId, 'Shopee');
    const batchId = await insertBatch(clientId, cpId, 'shopee');

    await sql`
      insert into pdt_fact_ads (client_platform_id, sumber, kampanye_id, periode, batch_id, parser_versi, biaya, roas)
      values (${cpId}, 'shopee_ads_cpc', 'KAMP-1', ${PERIODE}::date, ${batchId}, 1, '50000.00', '2.500'),
             (${cpId}, 'shopee_ads_search', 'KAMP-2', ${PERIODE}::date, ${batchId}, 1, '30000.00', '1.800')`;

    const semua = await bacaFaktaAds(sql, cpId, PERIODE);
    expect(semua).toHaveLength(2);

    const cpcSaja = await bacaFaktaAds(sql, cpId, PERIODE, ['shopee_ads_cpc']);
    expect(cpcSaja).toHaveLength(1);
    expect(cpcSaja[0]).toMatchObject({ sumber: 'shopee_ads_cpc', biaya: 50000, roas: 2.5, batchId });
  });
});

describeDb('bacaFaktaKesehatanPenalti (G3-01)', () => {
  it('mengembalikan seluruh baris penalti aktif periode, urut poin desc', async () => {
    const clientId = nextClientId();
    await insertClient(clientId);
    const cpId = await insertClientPlatform(clientId, 'Shopee');
    const batchId = await insertBatch(clientId, cpId, 'shopee');

    await sql`
      insert into pdt_fact_kesehatan_penalti (client_platform_id, periode, batch_id, parser_versi, poin, deskripsi, durasi)
      values (${cpId}, ${PERIODE}::date, ${batchId}, 1, '5.00', 'Respons chat lambat', '30 hari'),
             (${cpId}, ${PERIODE}::date, ${batchId}, 1, '10.00', 'Pembatalan tinggi', '7 hari')`;

    const hasil = await bacaFaktaKesehatanPenalti(sql, cpId, PERIODE);
    expect(hasil.map((r) => r.poin)).toEqual([10, 5]);
    expect(hasil[0]).toMatchObject({ deskripsi: 'Pembatalan tinggi', durasi: '7 hari', batchId, parserVersi: 1 });
  });
});
