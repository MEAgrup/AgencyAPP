/**
 * Tes katalog pilar — penerus `copilot.test.ts` sesudah mesin aturan AM
 * Co-Pilot dicabut (DECISIONS 2026-09-21 "PENSIUN-AMTOOLS").
 *
 * Yang dijaga di sini SENGAJA cuma tiga hal, karena cuma tiga hal itu yang
 * masih punya pemakai: bentuk katalog (label BI + pemetaan jenis/divisi yang
 * editor manual tampilkan), `gabungKatalogDb` (penggabung baris DB ↔ metadata
 * kode), dan invariant bahwa tiap aksi memetakan ke `strategi_pillar.jenis`
 * yang sah. Tes verdict/skor/susunUsulan ikut dicabut bersama fungsinya —
 * menahannya berarti menjaga mesin yang tidak dipanggil siapa pun hijau.
 */
import { describe, expect, it } from 'vitest';
import * as pk from './pilarkatalog';

/** `ck_strpil_jenis` (migrasi `20260806064000_m6a_strategi.sql`). */
const JENIS_SAH = new Set([
  'sku', 'harga', 'iklan', 'konten', 'affiliate', 'live', 'retensi',
  'operasional', 'tidak_dikerjakan',
]);

describe('katalog pilar', () => {
  it('memuat 20 aksi dengan kode unik', () => {
    expect(pk.KATALOG).toHaveLength(20);
    expect(new Set(pk.KATALOG.map((a) => a.kode)).size).toBe(20);
  });

  it('setiap pilar memetakan ke `strategi_pillar.jenis` yang sah', () => {
    for (const aksi of pk.KATALOG) {
      const jenis = pk.PILAR_KE_JENIS[aksi.pilar];
      expect(JENIS_SAH.has(jenis), `${aksi.kode} → ${jenis}`).toBe(true);
    }
  });

  it('setiap aksi punya label BI lengkap — editor manual merendernya apa adanya', () => {
    for (const aksi of pk.KATALOG) {
      expect(aksi.nama.trim(), aksi.kode).not.toBe('');
      expect(aksi.deskripsi.trim(), aksi.kode).not.toBe('');
      expect(aksi.jembatan.trim(), aksi.kode).not.toBe('');
      expect(aksi.unit.trim(), aksi.kode).not.toBe('');
      expect(aksi.divisi.trim(), aksi.kode).not.toBe('');
      expect(aksi.minggu, aksi.kode).toBeGreaterThan(0);
    }
  });

  it('`AKSI_BY_KODE` mengindeks seluruh katalog', () => {
    expect(pk.AKSI_BY_KODE.size).toBe(pk.KATALOG.length);
    expect(pk.AKSI_BY_KODE.get('L1')?.nama).toBe('Mulai / tambah jam live');
  });
});

describe('gabungKatalogDb', () => {
  const baris = (kode: string, platformBerlaku: string[], aktif = true): pk.AksiKatalogDbRow => ({
    kode,
    platformBerlaku,
    kondisi: { tipe: 'ambang', pemicu: [] },
    aktif,
  });

  it('menyaring baris nonaktif', () => {
    const out = pk.gabungKatalogDb([baris('L1', ['tiktok'], false)], 'tiktok');
    expect(out).toEqual([]);
  });

  it('menyaring baris yang platform-nya tidak cocok', () => {
    const out = pk.gabungKatalogDb([baris('L1', ['shopee'])], 'tiktok');
    expect(out).toEqual([]);
  });

  it('melewati kode yang metadatanya belum ada di kode — bukan error', () => {
    const out = pk.gabungKatalogDb([baris('SHP-ROAS', ['shopee']), baris('L1', ['shopee'])], 'shopee');
    expect(out.map((a) => a.kode)).toEqual(['L1']);
  });

  it('mengambil metadata dari kode dan `pemicu` dari DB', () => {
    const pemicu = [{ metrik: 'liveJam', ambang: { benchmark: 'liveJam' }, banding: 'kurang' }] as const;
    const out = pk.gabungKatalogDb(
      [{ kode: 'L1', platformBerlaku: ['tiktok'], kondisi: { tipe: 'ambang', pemicu }, aktif: true }],
      'tiktok',
    );
    expect(out).toHaveLength(1);
    expect(out[0].nama).toBe('Mulai / tambah jam live');
    expect(out[0].divisi).toBe('Live Stream');
    expect(out[0].pemicu).toEqual(pemicu);
  });

  it('`kondisi` non-ambang menghasilkan pemicu kosong', () => {
    const out = pk.gabungKatalogDb(
      [{ kode: 'V3', platformBerlaku: ['tiktok'], kondisi: { tipe: 'kehadiran_bukti', sumber: 'top_video' }, aktif: true }],
      'tiktok',
    );
    expect(out[0].pemicu).toEqual([]);
  });
});
