/**
 * Tests for Product Exchange M3-B — volume recompute (Flow A), eligibility
 * evaluation (Flow B, empat lapis), bridge coverage intake (Flow C), konfirmasi
 * kategori, dan reads (Kandidat/Katalog/kreator_kosong).
 *
 * Unit: permission predicates (5-role convention, matching `productexchange.test.ts`).
 * Integration (skipped unless DATABASE_URL is set): everything else — this
 * module reads/writes real tables (`pdt_fact_sku_period`, `pdt_upload_batch`,
 * `px_sku_volume`, `px_sku_eligibility`, `px_coverage_*`) whose behavior
 * (batch status filter, frozen triggers, RLS scoping) is not meaningfully
 * testable as pure functions. Ids namespaced `ZPXM3-`; `afterEach` deletes
 * what it made.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { permission } from '@cdps/core';
import { createClient, type Sql } from '@cdps/db';
import type { Actor } from './account';
import { canKelolaPolicy, canKonfirmasiKategoriSku, canLihatKatalogPx, ContractError, createEligibilityPolicy, ForbiddenError, NotFoundError, ValidationError } from './productexchange';
import { evaluateTick, intakeCoverage, konfirmasiKategori, listKandidat, listKatalog, listKategoriOptions, listKreatorKosong, recomputeDanEvaluasi } from './productexchange-m3';

// ---------------------------------------------------------------------------
// Aktor
// ---------------------------------------------------------------------------
const AM_OWNER = 'EMP-0002'; // divisi Account (seed Alpha Digital)
const am = (id = AM_OWNER): Actor => ({ employeeId: id, role: permission.makeRole({ division: 'Account', level: 'staff' }) });
const otherAm = (): Actor => ({ employeeId: 'EMP-0006', role: permission.makeRole({ division: 'Account', level: 'staff' }) });
const accountLead = (): Actor => ({ employeeId: 'ZPXM3-SPV', role: permission.makeRole({ division: 'Account', level: 'lead' }) });
const director = (): Actor => ({ employeeId: 'EMP-0008', role: permission.makeRole({ division: 'Account', level: 'staff', director: true }) });
const od = (): Actor => ({ employeeId: 'ZPXM3-OD', role: permission.makeRole({ division: 'Account', level: 'staff', od: true }) });
const ads = (): Actor => ({ employeeId: 'EMP-0004', role: permission.makeRole({ division: 'Ads', level: 'staff' }) });

describe('canKonfirmasiKategoriSku — lingkup sama canIsiShopId', () => {
  it('AM pemilik klien sendiri diterima', () => {
    expect(canKonfirmasiKategoriSku(am(), AM_OWNER)).toBe(true);
  });
  it('AM lain (bukan pemilik) ditolak', () => {
    expect(canKonfirmasiKategoriSku(otherAm(), AM_OWNER)).toBe(false);
  });
  it('lead Account diterima untuk klien siapa pun', () => {
    expect(canKonfirmasiKategoriSku(accountLead(), AM_OWNER)).toBe(true);
  });
  it('Director diterima', () => {
    expect(canKonfirmasiKategoriSku(director(), AM_OWNER)).toBe(true);
  });
  it('OD murni ditolak', () => {
    expect(canKonfirmasiKategoriSku(od(), AM_OWNER)).toBe(false);
  });
});

describe('canLihatKatalogPx — Lead Account + Director + OD (§6.1 PRD)', () => {
  it('staff Account biasa ditolak', () => {
    expect(canLihatKatalogPx(am())).toBe(false);
  });
  it('lead Account diterima', () => {
    expect(canLihatKatalogPx(accountLead())).toBe(true);
  });
  it('Director diterima', () => {
    expect(canLihatKatalogPx(director())).toBe(true);
  });
  it('OD murni diterima (matriks Phase 0 §6, OD read-only everywhere)', () => {
    expect(canLihatKatalogPx(od())).toBe(true);
  });
  it('staff divisi lain ditolak', () => {
    expect(canLihatKatalogPx(ads())).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// DB
// ---------------------------------------------------------------------------
const URL = process.env.DATABASE_URL;
const describeDb = describe.skipIf(!URL);
let sql: Sql;
if (URL) sql = createClient(URL);

const RUN = Date.now().toString(36).slice(-6);
let seq = 0;

async function seedClient(): Promise<{ clientId: string; platformId: number }> {
  seq += 1;
  const id = `ZPXM3-CLI-${RUN}-${seq}`;
  await sql`
    insert into clients
      (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv,
       sales_pic_id, commission_payment_pic_id, assigned_am_id, created_by)
    values (${id}, 'Rani', ${'Toko ' + id}, 'Bandung', 'https://shopee.co.id/x',
            'Fashion', 0, 0, 'EMP-0001', 'EMP-0001', ${AM_OWNER}, 'EMP-0001')`;
  const rows = await sql<{ id: string }[]>`
    insert into client_platforms (client_id, platform, active, shop_id, created_by)
    values (${id}, 'TikTok Shop', true, ${'shop-' + id}, 'EMP-0001') returning id`;
  return { clientId: id, platformId: Number(rows[0].id) };
}

async function seedVerifiedBatch(
  clientId: string,
  platformId: number,
  periodeMulai: string,
  periodeSelesai: string,
  status: 'verified' | 'ditolak' = 'verified',
): Promise<number> {
  const rows = await sql<{ id: number }[]>`
    insert into pdt_upload_batch
      (client_id, client_platform_id, platform, periode_mulai, periode_selesai, status,
       alasan_ditolak, parser_versi, retensi_sampai, dibuat_oleh)
    values (${clientId}, ${platformId}, 'tiktok', ${periodeMulai}::date, ${periodeSelesai}::date, ${status},
            ${status === 'ditolak' ? 'fixture' : null}, 1, current_date + 30, 'EMP-0001')
    returning id`;
  return rows[0].id;
}

async function seedFact(
  platformId: number,
  batchId: number,
  platformProductId: string,
  periode: string,
  gmv: number,
  pesanan: number,
  basis: 'dibayar' | 'net' = 'dibayar',
): Promise<void> {
  await sql`
    insert into pdt_fact_sku_period
      (sku_id, client_platform_id, platform_product_id, periode, basis, batch_id, parser_versi, gmv, pesanan)
    values (null, ${platformId}, ${platformProductId}, ${periode}::date, ${basis}, ${batchId}, 1, ${gmv}, ${pesanan})`;
}

async function seedHarga(platformId: number, platformProductId: string, harga: number): Promise<void> {
  await sql`
    insert into pdt_sku_master (client_platform_id, platform_product_id, nama_produk, harga_satuan_terakhir)
    values (${platformId}, ${platformProductId}, ${'Produk ' + platformProductId}, ${harga})`;
}

let snapshotAtOffset = 0;

async function pushCoverage(batchKey: string, level2Category: string, priceSegment: string, status: 'covered' | 'kosong'): Promise<void> {
  snapshotAtOffset += 1;
  await intakeCoverage(
    sql,
    {
      // Offset menaik supaya beberapa push dalam satu tes SELALU terurut
      // (readLatestCoverage memilih snapshot_at TERBESAR) — dua push nyata di
      // produksi berjarak seminggu, jadi ini murni artefak tes cepat.
      snapshot_at: new Date(Date.now() + snapshotAtOffset * 1000).toISOString(),
      source: 'test',
      policy_note: 'test fixture',
      rows: [
        {
          level2_category: level2Category,
          price_segment: priceSegment,
          creator_count: status === 'covered' ? 5 : 0,
          total_slots_available: status === 'covered' ? 10 : 0,
          total_proven_gmv: status === 'covered' ? 100_000_000 : 0,
          status,
        },
      ],
    },
    batchKey,
  );
}

afterEach(async () => {
  if (!sql) return;
  // px_sku_eligibility/px_coverage_snapshot/px_coverage_push adalah append-only
  // (trigger frozen BLOKIR UPDATE *dan* DELETE) — pola sama px_eligibility_policy
  // di bawah: matikan trigger sementara untuk cleanup fixture tes, nyalakan lagi
  // di `finally` supaya kegagalan cleanup tidak pernah meninggalkan tabel bisa
  // ditulis untuk tes berikutnya.
  await sql`alter table px_sku_eligibility disable trigger trg_px_sku_eligibility_frozen`;
  await sql`alter table px_coverage_snapshot disable trigger trg_px_coverage_snapshot_frozen`;
  await sql`alter table px_coverage_push disable trigger trg_px_coverage_push_frozen`;
  try {
    await sql`delete from px_sku_eligibility where client_platform_id in (select id from client_platforms where client_id like 'ZPXM3-CLI-%')`;
    await sql`delete from px_sku_kategori where client_platform_id in (select id from client_platforms where client_id like 'ZPXM3-CLI-%')`;
    await sql`delete from px_sku_volume where client_platform_id in (select id from client_platforms where client_id like 'ZPXM3-CLI-%')`;
    await sql`delete from pdt_fact_sku_period where client_platform_id in (select id from client_platforms where client_id like 'ZPXM3-CLI-%')`;
    await sql`delete from pdt_sku_master where client_platform_id in (select id from client_platforms where client_id like 'ZPXM3-CLI-%')`;
    await sql`delete from pdt_upload_batch where client_id like 'ZPXM3-CLI-%'`;
    await sql`delete from client_platforms where client_id like 'ZPXM3-CLI-%'`;
    await sql`delete from clients where id like 'ZPXM3-CLI-%'`;
    await sql`delete from px_coverage_snapshot where batch_key like 'zpxm3-%'`;
    await sql`delete from px_coverage_push where batch_key like 'zpxm3-%'`;
  } finally {
    await sql`alter table px_sku_eligibility enable trigger trg_px_sku_eligibility_frozen`;
    await sql`alter table px_coverage_snapshot enable trigger trg_px_coverage_snapshot_frozen`;
    await sql`alter table px_coverage_push enable trigger trg_px_coverage_push_frozen`;
  }
  await sql`alter table px_eligibility_policy disable trigger trg_px_eligibility_policy_frozen`;
  try {
    await sql`delete from px_eligibility_policy where versi > 2`;
  } finally {
    await sql`alter table px_eligibility_policy enable trigger trg_px_eligibility_policy_frozen`;
  }
});
afterAll(async () => { if (sql) await sql.end(); });

describeDb('recomputeDanEvaluasi — Flow A (volume) + Flow B (verdict)', () => {
  it('mengagregasi hanya batch verified + basis dibayar; batch ditolak diabaikan', async () => {
    const { clientId, platformId } = await seedClient();
    const batchVerified = await seedVerifiedBatch(clientId, platformId, '2026-07-01', '2026-07-31', 'verified');
    // Batch DITOLAK — kandidat lain SATU periode yang sama, tapi produk BEDA
    // (fakta hidup tidak bisa berbagi (client_platform_id, platform_product_id,
    // periode, basis) antar batch — unique index parsial `uq_pdt_fact_sku_period_produk`
    // menjaga itu; replace-on-recommit-lah yang membuat SATU batch "menang" per
    // periode, bukan dua batch hidup berdampingan untuk produk yang sama).
    const { clientId: clientId2, platformId: platformId2 } = await seedClient();
    const batchDitolak = await seedVerifiedBatch(clientId2, platformId2, '2026-07-01', '2026-07-31', 'ditolak');
    await seedFact(platformId, batchVerified, 'ZPXM3-PRODUK-01', '2026-07-01', 10_000_000, 5, 'dibayar');
    await seedFact(platformId, batchVerified, 'ZPXM3-PRODUK-01', '2026-07-01', 500_000_000, 1, 'net'); // basis lain, diabaikan L2
    await seedFact(platformId2, batchDitolak, 'ZPXM3-PRODUK-01', '2026-07-01', 999_000_000, 999, 'dibayar');

    await recomputeDanEvaluasi(sql, platformId);
    await recomputeDanEvaluasi(sql, platformId2);

    const rows = await sql<{ gmv_30d: string; pesanan_30d: number; batch_ids: number[]; cakupan_hari: number }[]>`
      select gmv_30d::text, pesanan_30d, batch_ids, cakupan_hari from px_sku_volume
       where client_platform_id = ${platformId} and platform_product_id = 'ZPXM3-PRODUK-01'`;
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].gmv_30d)).toBe(10_000_000); // hanya basis dibayar (baris 'net' diabaikan)
    expect(rows[0].pesanan_30d).toBe(5);
    expect(rows[0].batch_ids).toEqual([batchVerified]); // provenans wajib (Rule 7b)
    expect(rows[0].cakupan_hari).toBe(31);

    // Toko dengan HANYA batch ditolak (nol batch verified) ⇒ nol baris volume sama sekali.
    const rowsDitolak = await sql<{ n: number }[]>`
      select count(*)::int as n from px_sku_volume where client_platform_id = ${platformId2}`;
    expect(rowsDitolak[0].n).toBe(0);
  });

  it('jendela parsial (1-30 Juli, tidak tertutup penuh) ⇒ data_tidak_lengkap, TANPA ekstrapolasi', async () => {
    const { clientId, platformId } = await seedClient();
    const batch = await seedVerifiedBatch(clientId, platformId, '2026-07-01', '2026-07-30'); // hilang 31
    await seedFact(platformId, batch, 'ZPXM3-PRODUK-02', '2026-07-01', 999_999_999, 1);

    const hasil = await recomputeDanEvaluasi(sql, platformId);
    expect(hasil.perVerdict.data_tidak_lengkap).toBe(1);

    const [row] = await sql<{ verdict: string }[]>`
      select verdict from px_sku_eligibility where client_platform_id = ${platformId} and platform_product_id = 'ZPXM3-PRODUK-02'`;
    expect(row.verdict).toBe('data_tidak_lengkap');
  });

  it('urutan lapis: gagal L2 (volume_kurang) tidak pernah membawa level2_category/price_segment', async () => {
    const { clientId, platformId } = await seedClient();
    const batch = await seedVerifiedBatch(clientId, platformId, '2026-07-01', '2026-07-31');
    await seedFact(platformId, batch, 'ZPXM3-AVITASKIN', '2026-07-01', 10_945_407, 10); // PRD §5 Avitaskin — di bawah ambang
    await seedHarga(platformId, 'ZPXM3-AVITASKIN', 50_000);
    // AM TIDAK mengonfirmasi kategori sama sekali — Rule 1: L3 tidak pernah diminta untuk SKU yang gagal L2.

    await recomputeDanEvaluasi(sql, platformId);
    const [row] = await sql<{ verdict: string; lapis_gagal: number; level2_category: string | null; price_segment: string | null }[]>`
      select verdict, lapis_gagal, level2_category, price_segment from px_sku_eligibility
       where client_platform_id = ${platformId} and platform_product_id = 'ZPXM3-AVITASKIN'`;
    expect(row.verdict).toBe('volume_kurang');
    expect(row.lapis_gagal).toBe(2);
    expect(row.level2_category).toBeNull();
    expect(row.price_segment).toBeNull();
  });

  it('retensi pdt_upload_batch diperpanjang saat SKU lolos, dan TIDAK PERNAH diperpendek (PX-M3-08)', async () => {
    const { clientId, platformId } = await seedClient();
    const batch = await seedVerifiedBatch(clientId, platformId, '2026-07-01', '2026-07-31');
    await sql`update pdt_upload_batch set retensi_sampai = current_date + 400 where id = ${batch}`; // sudah LEBIH JAUH dari +90
    await seedFact(platformId, batch, 'ZPXM3-SEPATU', '2026-07-01', 340_000_000, 50); // PRD §5 Sepatu Wanita
    await seedHarga(platformId, 'ZPXM3-SEPATU', 185_000);
    await sql`insert into px_sku_kategori (client_platform_id, platform_product_id, level2_category, dikonfirmasi_oleh)
               values (${platformId}, 'ZPXM3-SEPATU', 'Sepatu Wanita', ${AM_OWNER})`;
    await pushCoverage('zpxm3-batch-sepatu', 'Sepatu Wanita', 'mid', 'covered');

    await recomputeDanEvaluasi(sql, platformId);
    const [row1] = await sql<{ verdict: string }[]>`
      select verdict from px_sku_eligibility where client_platform_id = ${platformId} and platform_product_id = 'ZPXM3-SEPATU'
       order by dihitung_pada desc limit 1`;
    expect(row1.verdict).toBe('lolos');

    // retensi TIDAK diperpendek — sudah +400 hari, jauh lebih jauh dari +90.
    const after1 = await sql<{ retensi_sampai: Date }[]>`select retensi_sampai from pdt_upload_batch where id = ${batch}`;
    const days1 = Math.round((after1[0].retensi_sampai.getTime() - Date.now()) / 86_400_000);
    expect(days1).toBeGreaterThanOrEqual(399);

    // toko lain dengan retensi masih default (30 hari, lebih dekat) — evaluasi memperpanjang ke +90.
    const { clientId: clientId2, platformId: platformId2 } = await seedClient();
    const batch2 = await seedVerifiedBatch(clientId2, platformId2, '2026-07-01', '2026-07-31');
    await seedFact(platformId2, batch2, 'ZPXM3-SEPATU2', '2026-07-01', 340_000_000, 50);
    await seedHarga(platformId2, 'ZPXM3-SEPATU2', 185_000);
    await sql`insert into px_sku_kategori (client_platform_id, platform_product_id, level2_category, dikonfirmasi_oleh)
               values (${platformId2}, 'ZPXM3-SEPATU2', 'Sepatu Wanita', ${AM_OWNER})`;
    await recomputeDanEvaluasi(sql, platformId2);
    const after2 = await sql<{ retensi_sampai: Date }[]>`select retensi_sampai from pdt_upload_batch where id = ${batch2}`;
    const days2 = Math.round((after2[0].retensi_sampai.getTime() - Date.now()) / 86_400_000);
    expect(days2).toBeGreaterThanOrEqual(89);
    expect(days2).toBeLessThan(95);
    const [alasan] = await sql<{ retensi_alasan: string | null }[]>`select retensi_alasan from pdt_upload_batch where id = ${batch2}`;
    expect(alasan.retensi_alasan).toBe('katalog_px');
  });
});

describeDb('konfirmasiKategori — D-24, Rule 9-11', () => {
  it('kandidat berhenti di kategori_belum_dikonfirmasi sampai AM memilih dari opsi snapshot', async () => {
    const { clientId, platformId } = await seedClient();
    const batch = await seedVerifiedBatch(clientId, platformId, '2026-07-01', '2026-07-31');
    await seedFact(platformId, batch, 'ZPXM3-TAS', '2026-07-01', 260_000_000, 30); // PRD §5 Tas Wanita
    await seedHarga(platformId, 'ZPXM3-TAS', 300_000);
    await pushCoverage('zpxm3-batch-tas-kosong', 'Tas Wanita', 'mid', 'kosong'); // beri opsi dropdown, meski nol kreator

    await recomputeDanEvaluasi(sql, platformId);
    const kandidatSebelum = await listKandidat(sql, am());
    expect(kandidatSebelum.find((k) => k.platformProductId === 'ZPXM3-TAS')?.verdict).toBe('kategori_belum_dikonfirmasi');

    const opsi = await listKategoriOptions(sql);
    expect(opsi).toContain('Tas Wanita');

    const hasil = await konfirmasiKategori(sql, am(), platformId, 'ZPXM3-TAS', 'Tas Wanita');
    expect(hasil.verdict).toBe('kreator_kosong'); // snapshot kosong ⇒ L4 gagal, TAPI kategori sudah tercatat
    expect(hasil.lapisGagal).toBe(4);
    expect(hasil.priceSegment).toBe('mid');
  });

  it('kategori di luar opsi snapshot terbaru ditolak (ValidationError)', async () => {
    const { platformId } = await seedClient();
    await expect(konfirmasiKategori(sql, am(), platformId, 'ZPXM3-X', 'Kategori Yang Tidak Ada')).rejects.toThrow(ValidationError);
  });

  it('AM yang bukan pemilik ditolak (ForbiddenError)', async () => {
    const { platformId } = await seedClient();
    await pushCoverage('zpxm3-batch-forbid', 'Sepatu Wanita', 'mid', 'covered');
    await expect(konfirmasiKategori(sql, otherAm(), platformId, 'ZPXM3-Y', 'Sepatu Wanita')).rejects.toThrow(ForbiddenError);
  });
});

describeDb('intakeCoverage — Flow C, kontrak bridge (PX-M3-04)', () => {
  it('idempoten: kunci berulang ⇒ hasil ASLI, nol baris baru', async () => {
    const key = `zpxm3-idem-${RUN}`;
    const first = await pushCoverageAndReturn(key, 'Sepatu Wanita', 'mid', 'covered');
    expect(first.duplicate).toBe(false);
    expect(first.rowsReceived).toBe(1);

    const second = await pushCoverageAndReturn(key, 'Sepatu Wanita', 'mid', 'covered');
    expect(second.duplicate).toBe(true);
    expect(second.batchKey).toBe(first.batchKey);
    expect(second.rowsReceived).toBe(1);

    const rows = await sql<{ n: number }[]>`select count(*)::int as n from px_coverage_snapshot where batch_key = ${key}`;
    expect(rows[0].n).toBe(1); // nol baris baru
  });

  it('kolom asing di top-level ⇒ ContractError (422)', async () => {
    await expect(
      intakeCoverage(sql, { snapshot_at: new Date().toISOString(), source: 'x', rows: [], extra_field: 'nope' }, `zpxm3-asing-${RUN}`),
    ).rejects.toThrow(ContractError);
  });

  it('kolom asing di baris (termasuk creator_id, K-2) ⇒ ContractError (422)', async () => {
    await expect(
      intakeCoverage(
        sql,
        {
          snapshot_at: new Date().toISOString(),
          source: 'x',
          rows: [
            { level2_category: 'A', price_segment: 'mid', creator_count: 1, total_slots_available: 1, total_proven_gmv: 0, status: 'covered', creator_id: 'CR-1' },
          ],
        },
        `zpxm3-creatorid-${RUN}`,
      ),
    ).rejects.toThrow(ContractError);
  });

  it('rows kosong atau > 5.000 baris ⇒ ContractError (422)', async () => {
    await expect(intakeCoverage(sql, { snapshot_at: new Date().toISOString(), source: 'x', rows: [] }, `zpxm3-kosong-${RUN}`)).rejects.toThrow(ContractError);
    const banyak = Array.from({ length: 5001 }, (_, i) => ({
      level2_category: `Kategori-${i}`, price_segment: 'mid', creator_count: 1, total_slots_available: 1, total_proven_gmv: 0, status: 'covered' as const,
    }));
    await expect(
      intakeCoverage(sql, { snapshot_at: new Date().toISOString(), source: 'x', rows: banyak }, `zpxm3-banyak-${RUN}`),
    ).rejects.toThrow(ContractError);
  });

  it('status di luar covered/kosong ⇒ ContractError (422)', async () => {
    await expect(
      intakeCoverage(
        sql,
        { snapshot_at: new Date().toISOString(), source: 'x', rows: [{ level2_category: 'A', price_segment: 'mid', creator_count: 1, total_slots_available: 1, total_proven_gmv: 0, status: 'aktif' }] },
        `zpxm3-status-${RUN}`,
      ),
    ).rejects.toThrow(ContractError);
  });

  it('fixture bersama docs/fixtures/px_coverage_v1.json lolos parser', async () => {
    const raw = JSON.parse(readFileSync(path.join(__dirname, '../../../docs/fixtures/px_coverage_v1.json'), 'utf8'));
    const hasil = await intakeCoverage(sql, raw, `zpxm3-fixture-${RUN}`);
    expect(hasil.duplicate).toBe(false);
    expect(hasil.rowsReceived).toBe(raw.rows.length);
  });

  it('snapshot baru membalik kreator_kosong → lolos TANPA campur tangan AM (Flow C langkah 7)', async () => {
    const { clientId, platformId } = await seedClient();
    const batch = await seedVerifiedBatch(clientId, platformId, '2026-07-01', '2026-07-31');
    await seedFact(platformId, batch, 'ZPXM3-FLIP', '2026-07-01', 260_000_000, 30);
    await seedHarga(platformId, 'ZPXM3-FLIP', 300_000);
    await pushCoverage('zpxm3-flip-1', 'Kategori Flip', 'mid', 'kosong');
    await sql`insert into px_sku_kategori (client_platform_id, platform_product_id, level2_category, dikonfirmasi_oleh)
               values (${platformId}, 'ZPXM3-FLIP', 'Kategori Flip', ${AM_OWNER})`;
    await recomputeDanEvaluasi(sql, platformId);
    const [before] = await sql<{ verdict: string }[]>`
      select verdict from px_sku_eligibility where client_platform_id = ${platformId} and platform_product_id = 'ZPXM3-FLIP'
       order by dihitung_pada desc limit 1`;
    expect(before.verdict).toBe('kreator_kosong');

    await pushCoverage('zpxm3-flip-2', 'Kategori Flip', 'mid', 'covered'); // MCN push baru — intakeCoverage memicu reevaluateAfterCoverage sendiri

    const [after] = await sql<{ verdict: string }[]>`
      select verdict from px_sku_eligibility where client_platform_id = ${platformId} and platform_product_id = 'ZPXM3-FLIP'
       order by dihitung_pada desc limit 1`;
    expect(after.verdict).toBe('lolos');
  });
});

async function pushCoverageAndReturn(batchKey: string, level2Category: string, priceSegment: string, status: 'covered' | 'kosong') {
  return intakeCoverage(
    sql,
    {
      snapshot_at: new Date().toISOString(),
      source: 'test',
      rows: [{ level2_category: level2Category, price_segment: priceSegment, creator_count: 1, total_slots_available: 1, total_proven_gmv: 0, status }],
    },
    batchKey,
  );
}

describeDb('createEligibilityPolicy → evaluateTick penuh (Rule 8) — verdict lama utuh (frozen)', () => {
  it('versi baru melahirkan baris verdict baru; baris versi lama tidak berubah', async () => {
    const { clientId, platformId } = await seedClient();
    const batch = await seedVerifiedBatch(clientId, platformId, '2026-07-01', '2026-07-31');
    await seedFact(platformId, batch, 'ZPXM3-POLICY', '2026-07-01', 250_000_000, 10);
    await seedHarga(platformId, 'ZPXM3-POLICY', 50_000);

    await evaluateTick(sql, platformId);
    const [v2Row] = await sql<{ verdict: string; versi_policy: number }[]>`
      select verdict, versi_policy from px_sku_eligibility
       where client_platform_id = ${platformId} and platform_product_id = 'ZPXM3-POLICY' order by dihitung_pada desc limit 1`;
    expect(v2Row.versi_policy).toBe(2);
    expect(v2Row.verdict).toBe('kategori_belum_dikonfirmasi'); // lolos L2 (250jt ≥ 200jt), nol kategori dikonfirmasi

    const versiBaru = await createEligibilityPolicy(sql, director(), {
      catatan: 'tes ambang lebih tinggi',
      nilai: {
        sales_threshold_idr: 500_000_000, // dinaikkan — produk yang tadinya lolos sekarang gagal L2
        threshold_basis: 'per_sku',
        threshold_window_days: 30,
        commission_floor_pct: null,
        require_stock_in: true,
        platforms: ['tiktok', 'shopee'],
        price_segment_bands: [{ segment: 'low', max_idr: 100_000 }, { segment: 'mid', max_idr: 500_000 }, { segment: 'high', max_idr: null }],
      },
    });
    expect(versiBaru.versi).toBeGreaterThanOrEqual(3);

    // baris versi LAMA (versi 2) tetap ada, tidak berubah (append-only + trigger frozen).
    const oldRows = await sql<{ verdict: string }[]>`
      select verdict from px_sku_eligibility where client_platform_id = ${platformId} and platform_product_id = 'ZPXM3-POLICY' and versi_policy = 2`;
    expect(oldRows).toHaveLength(1);

    // baris versi BARU muncul, verdict volume_kurang (ambang naik).
    const newRows = await sql<{ verdict: string }[]>`
      select verdict from px_sku_eligibility where client_platform_id = ${platformId} and platform_product_id = 'ZPXM3-POLICY' and versi_policy = ${versiBaru.versi}`;
    expect(newRows[0]?.verdict).toBe('volume_kurang');

    // trigger frozen — UPDATE/DELETE pada baris manapun ditolak.
    await expect(sql`update px_sku_eligibility set verdict = 'lolos' where versi_policy = 2`).rejects.toThrow();
  });
});

describeDb('listKandidat/listKatalog/listKreatorKosong — scoping izin', () => {
  it('listKandidat: AM pemilik melihat, AM lain nol, Lead Account/Director semua', async () => {
    const { clientId, platformId } = await seedClient();
    const batch = await seedVerifiedBatch(clientId, platformId, '2026-07-01', '2026-07-31');
    await seedFact(platformId, batch, 'ZPXM3-SCOPE', '2026-07-01', 250_000_000, 10);
    await seedHarga(platformId, 'ZPXM3-SCOPE', 50_000);
    await evaluateTick(sql, platformId);

    const ownRows = await listKandidat(sql, am());
    expect(ownRows.some((r) => r.platformProductId === 'ZPXM3-SCOPE')).toBe(true);

    const otherRows = await listKandidat(sql, otherAm());
    expect(otherRows.some((r) => r.platformProductId === 'ZPXM3-SCOPE')).toBe(false);

    const leadRows = await listKandidat(sql, accountLead());
    expect(leadRows.some((r) => r.platformProductId === 'ZPXM3-SCOPE')).toBe(true);

    const directorRows = await listKandidat(sql, director());
    expect(directorRows.some((r) => r.platformProductId === 'ZPXM3-SCOPE')).toBe(true);
  });

  it('listKatalog/listKreatorKosong: ditolak untuk staff biasa, diterima untuk Lead Account/Director/OD', async () => {
    await expect(listKatalog(sql, am())).rejects.toThrow(ForbiddenError);
    await expect(listKreatorKosong(sql, am())).rejects.toThrow(ForbiddenError);
    await expect(listKatalog(sql, accountLead())).resolves.toBeDefined();
    await expect(listKreatorKosong(sql, director())).resolves.toBeDefined();
    await expect(listKatalog(sql, od())).resolves.toBeDefined();
  });

  it('listKatalog menampilkan banner basi saat snapshot terbaru > 10 hari', async () => {
    const hasil = await listKatalog(sql, director());
    expect(hasil.snapshot).toHaveProperty('basi');
  });
});
