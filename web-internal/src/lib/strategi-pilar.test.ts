/**
 * Kontrak simpan pilar Section E.
 *
 * `mergePilar` adalah satu-satunya yang berdiri antara editor pilar dan
 * `PUT /strategi/{id}/pillars`, yang **mengganti seluruh daftar**. Kalau ia
 * salah, gejalanya bukan galat melainkan baris yang lenyap diam-diam — E-11
 * (out of scope), pilar harga ber-floor-price, pilar yang AM simpan minggu
 * lalu. Karena itu tes ini memaku keduanya: apa yang ditahan dan apa yang
 * diganti.
 */
import { describe, expect, it } from 'vitest';
import { blankPilar, mergePilar, type PilarBody } from './strategi-pilar';
import type { StrategiPillar } from './strategi';

const tersimpan = (over: Partial<StrategiPillar>): StrategiPillar => ({
  id: 1,
  jenis: 'konten',
  channel: 'TikTok Shop',
  urutan: 1,
  sku: null,
  peran: null,
  aksi: 'V1 Hook baru',
  target: 'jembatan Median VV',
  harga_normal: null,
  harga_promo: null,
  floor_price: null,
  vendor_id: null,
  slot_jam: null,
  tarif: null,
  target_gmv_per_jam: null,
  detail: {},
  ...over,
});

const baru = (over: Partial<PilarBody>): PilarBody => ({ ...blankPilar('konten', 1), ...over });

describe('blankPilar', () => {
  it('`peran` null — enum peran SKU tertutup, label pilar tinggal di detail', () => {
    expect(blankPilar('konten', 1).peran).toBeNull();
  });

  it('semua kolom opsional null, bukan undefined — kunci hilang lebih berbahaya (O43)', () => {
    const p = blankPilar('harga', 2);
    for (const k of ['channel', 'sku', 'peran', 'harga_normal', 'harga_promo', 'floor_price',
      'vendor_id', 'slot_jam', 'tarif', 'target_gmv_per_jam'] as const) {
      expect(p[k], k).toBeNull();
    }
    expect(p.jenis).toBe('harga');
    expect(p.urutan).toBe(2);
  });
});

describe('mergePilar', () => {
  it('menahan baris lama yang tidak ditabrak — termasuk E-11 out of scope', () => {
    const out = mergePilar(
      [
        tersimpan({ id: 1, jenis: 'tidak_dikerjakan', aksi: 'Tanpa reshoot foto' }),
        tersimpan({ id: 2, jenis: 'harga', aksi: 'Kunci floor', sku: 'SERUM-30', floor_price: '79000.00' }),
      ],
      [baru({ jenis: 'live', channel: 'TikTok Shop', aksi: 'L1 Mulai / tambah jam live' })],
    );
    expect(out.map((p) => p.aksi)).toEqual([
      'Tanpa reshoot foto',
      'Kunci floor',
      'L1 Mulai / tambah jam live',
    ]);
    // Kolom pilar harga ikut terbawa utuh — floor price adalah guardrail Brief
    // Rule 11; menghilangkannya diam-diam melonggarkan validasi harga.
    expect(out[1].floor_price).toBe('79000.00');
    expect(out[1].sku).toBe('SERUM-30');
  });

  it('mengganti di tempat saat (jenis, channel, aksi) sama — bukan menggandakan', () => {
    const out = mergePilar(
      [tersimpan({ id: 1, aksi: 'V1 Hook baru', target: 'target lama' })],
      [baru({ jenis: 'konten', channel: 'TikTok Shop', aksi: 'V1 Hook baru', target: 'target baru' })],
    );
    expect(out).toHaveLength(1);
    expect(out[0].target).toBe('target baru');
  });

  it('aksi yang sama di channel BERBEDA adalah dua baris, bukan satu', () => {
    const out = mergePilar(
      [tersimpan({ id: 1, channel: 'TikTok Shop', aksi: 'V1 Hook baru' })],
      [baru({ jenis: 'konten', channel: 'Shopee', aksi: 'V1 Hook baru' })],
    );
    expect(out).toHaveLength(2);
    expect(out.map((p) => p.channel)).toEqual(['TikTok Shop', 'Shopee']);
  });

  it('`urutan` dinomori ulang berurutan dari 1 — E-13 membacanya', () => {
    const out = mergePilar(
      [tersimpan({ id: 1, urutan: 7 }), tersimpan({ id: 2, urutan: 9, aksi: 'V2 Kuota' })],
      [baru({ jenis: 'live', aksi: 'L1', urutan: 99 })],
    );
    expect(out.map((p) => p.urutan)).toEqual([1, 2, 3]);
  });

  it('daftar baru kosong tidak menghapus apa pun — simpan tanpa pilihan itu no-op', () => {
    const lama = [tersimpan({ id: 1 }), tersimpan({ id: 2, aksi: 'V2 Kuota' })];
    expect(mergePilar(lama, [])).toHaveLength(2);
  });
});
