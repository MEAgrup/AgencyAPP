/**
 * M18 — gerbang dual-home Store Operation: `storeops` (TS) ≡ skema DB.
 *
 * KENAPA ADA. `request_type` dan `jenis_gambar` adalah enum tertutup yang hidup
 * di dua tempat: CHECK constraint pada `store_ops_skus` dan konstanta di
 * `packages/core/src/storeops.ts`. Sebuah registry yang tidak dipaksa identik
 * hanyalah komentar — dan divergensinya punya bentuk yang sangat khusus di sini:
 * kalau TS punya nilai yang DB tolak, form-nya lolos validasi lalu gagal di
 * INSERT dengan pesan constraint mentah (bukan bahasa pengguna); kalau DB punya
 * nilai yang TS tidak tahu, baris lama tiba-tiba tidak bisa dirender.
 *
 * Pola dan alasan lokasinya sama dengan `ident.registry.test.ts` (PREFIXES ↔
 * entity_prefix) dan `division.registry.test.ts` (DIVISIONS ↔
 * division_registry): berkas ini butuh KEDUA belahan — konstanta TS (core) dan
 * koneksi Postgres (db) — dan `core` sengaja tidak punya dependency `postgres`.
 *
 * Perbandingannya SET-EQUAL, bukan hitungan: dua kesalahan yang saling menutupi
 * memberi hitungan yang cocok (blind spot yang sudah dicatat
 * `notif_catalog.reals.test.ts`).
 *
 * Di-skip tanpa `DATABASE_URL`.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { storeops } from '@cdps/core';
import { createClient, type Sql } from './client';

const URL = process.env.DATABASE_URL;
const describeDb = describe.skipIf(!URL);

let sql: Sql | undefined;
function db(): Sql {
  sql ??= createClient(URL as string);
  return sql;
}

afterAll(async () => {
  await sql?.end();
});

/**
 * Nilai-nilai literal di dalam sebuah CHECK constraint `col IN ('a', 'b', …)`.
 * Dibaca dari `pg_get_constraintdef` — teks yang DIHASILKAN katalog, bukan teks
 * migrasi, jadi ia ikut menangkap constraint yang di-ALTER belakangan.
 */
async function nilaiCheck(nama: string): Promise<string[]> {
  const rows = await db()<{ def: string }[]>`
    select pg_get_constraintdef(c.oid) as def
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
     where t.relname = 'store_ops_skus' and c.conname = ${nama}`;
  expect(rows.length, `constraint ${nama} tidak ditemukan`).toBe(1);
  return [...rows[0].def.matchAll(/'((?:[^']|'')*)'/g)]
    .map((m) => m[1].replace(/''/g, "'"))
    .sort();
}

describe('M18 kosakata — invariant TS', () => {
  it('tidak ada nilai ganda di ketiga enum', () => {
    for (const daftar of [storeops.REQUEST_TYPES, storeops.JENIS_GAMBAR, storeops.SKU_STATES]) {
      expect(new Set(daftar).size).toBe(daftar.length);
    }
  });

  it('setiap state dieja dengan kurung siku (aturan rumah #2/#5)', () => {
    for (const s of storeops.SKU_STATES) expect(s).toMatch(/^\[.+\]$/);
  });

  it('produksiSelesai() benar di kelima state — [Terupload] sudah selesai, [Dievaluasi] juga', () => {
    // K-6: menahan rollup sampai [Dievaluasi] berarti menahan Brief ~30 hari
    // setelah pekerjaannya betul-betul selesai. Kalau seseorang "merapikan"
    // SKU_PRODUKSI_SELESAI jadi hanya [Dievaluasi], baris inilah yang merah.
    expect(storeops.produksiSelesai('[Menunggu Eksekusi]')).toBe(false);
    expect(storeops.produksiSelesai('[Dikerjakan]')).toBe(false);
    expect(storeops.produksiSelesai('[Gagal Upload]')).toBe(false);
    expect(storeops.produksiSelesai('[Terupload]')).toBe(true);
    expect(storeops.produksiSelesai('[Dievaluasi]')).toBe(true);
  });

  it('predikat menolak nilai yang tidak terdaftar', () => {
    expect(storeops.isRequestType('Shopee New')).toBe(true);
    expect(storeops.isRequestType('Lazada New')).toBe(false);
    expect(storeops.isJenisGambar('Cover Only')).toBe(true);
    expect(storeops.isJenisGambar('Cover')).toBe(false);
    expect(storeops.isSkuState('[Terupload]')).toBe(true);
    expect(storeops.isSkuState('Terupload')).toBe(false);
  });
});

describeDb('M18 kosakata — TS ≡ CHECK constraint', () => {
  it('REQUEST_TYPES ≡ ck_sku_request_type', async () => {
    expect(await nilaiCheck('ck_sku_request_type')).toEqual([...storeops.REQUEST_TYPES].sort());
  });

  it('JENIS_GAMBAR ≡ ck_sku_jenis_gambar', async () => {
    expect(await nilaiCheck('ck_sku_jenis_gambar')).toEqual([...storeops.JENIS_GAMBAR].sort());
  });

  it('DB menolak request_type yang tidak terdaftar (constraint-nya nyata, bukan dokumentasi)', async () => {
    await expect(
      db()`
        insert into store_ops_skus (id, brief_id, nama_produk, request_type, jenis_gambar,
                                    total_req_picture, created_by)
        values ('SKU-ZREG-0001', 'BRF-TIDAK-ADA', 'x', 'Lazada New', 'Cover Only', 1, 'ZZ-REG')`,
    ).rejects.toThrow();
  });
});

describeDb('M18 mesin #32 — SKU_STATES ≡ sm_machines/sm_edges', () => {
  it('state awal TS = initial_state di sm_machines', async () => {
    const rows = await db()<{ initial_state: string }[]>`
      select initial_state from sm_machines where name = 'store_ops_sku'`;
    expect(rows).toEqual([{ initial_state: storeops.SKU_INITIAL_STATE }]);
  });

  it('state terminal TS = sm_terminal_states', async () => {
    const rows = await db()<{ state: string }[]>`
      select state from sm_terminal_states where machine = 'store_ops_sku' order by state`;
    expect(rows.map((r) => r.state)).toEqual([storeops.SKU_TERMINAL_STATE]);
  });

  it('himpunan state di sm_edges tidak punya satu pun nama di luar SKU_STATES', async () => {
    // Arah yang penting: sebuah edge ke state yang salah eja akan diterima DB
    // (kolomnya text) dan baru terlihat sebagai transisi yang "tidak diizinkan"
    // saat dipakai orang. Di sini ia gagal di CI.
    const rows = await db()<{ s: string }[]>`
      select from_state as s from sm_edges where machine = 'store_ops_sku'
      union
      select to_state   as s from sm_edges where machine = 'store_ops_sku'`;
    const diDb = rows.map((r) => r.s).sort();
    expect(diDb).toEqual([...storeops.SKU_STATES].sort());
  });

  it('[Terupload] BUKAN terminal — K-6 memisahkan angka dampak dari "selesai"', async () => {
    // Kalau seseorang menjadikan [Terupload] terminal, langkah evaluasi hilang
    // dari mesin dan CTR/CVR tidak punya tempat lagi. Kalau sebaliknya
    // [Dievaluasi] dijadikan syarat selesai produksi, leadtime produksi ternoda
    // ~30 hari tunggu pasar. Dua-duanya merah di sini.
    const keluar = await db()<{ to_state: string }[]>`
      select to_state from sm_edges
       where machine = 'store_ops_sku' and from_state = '[Terupload]'`;
    expect(keluar.map((r) => r.to_state)).toEqual(['[Dievaluasi]']);
  });
});
