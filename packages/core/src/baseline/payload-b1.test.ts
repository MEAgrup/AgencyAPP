/**
 * B1 — turunan payload baseline TikTok (B-3.2, B-3.4, B-5.3).
 *
 * Diuji pada tingkat helper, bukan lewat `runBaseline`, karena yang perlu
 * dipaku adalah PERILAKU BATASnya: Pareto tepat di 80%, `byCamp` kosong yang
 * harus `null` bukan `0`, dan label materi tak dikenal yang harus dibuang
 * bukan diteruskan. Ketiganya butuh input yang dirancang, bukan fixture export
 * lengkap.
 */
import { describe, expect, it } from 'vitest';
import { jumlahKampanye, skuPareto80, skuSlowMoving, tipeMateriIklan } from './payload';

const rows = (...gmv: number[]): { rows: { gmv: number }[] } => ({ rows: gmv.map((g) => ({ gmv: g })) });

describe('B-3.2 — skuPareto80', () => {
  it('menghitung SKU pertama yang menutup 80% Σ GMV', () => {
    // Σ = 100. 50 → 50%, +30 → 80% (tepat), jadi 2 SKU.
    expect(skuPareto80(rows(50, 30, 10, 10))).toBe(2);
  });

  it('TEPAT di batas 80% ikut dihitung, bukan dilewati', () => {
    // Σ = 10. Ambang 8. SKU ke-4 membuat kumulatif = 8 PERSIS.
    expect(skuPareto80(rows(2, 2, 2, 2, 1, 1))).toBe(4);
  });

  it('satu SKU sudah melewati 80% ⇒ 1', () => {
    expect(skuPareto80(rows(900, 50, 50))).toBe(1);
  });

  it('tahan galat float — Σ pecahan yang seharusnya menyentuh ambang persis', () => {
    // 0.1+0.2 = 0.30000000000000004 di IEEE-754; tanpa toleransi, SKU ke-2
    // tidak akan pernah "menyentuh" 80% dan hasilnya melar ke 3.
    expect(skuPareto80(rows(0.2, 0.1, 0.05, 0.025))).toBe(2);
  });

  it('Σ GMV nol ⇒ null, BUKAN 0 (absen ≠ nol)', () => {
    expect(skuPareto80(rows(0, 0, 0))).toBeNull();
    expect(skuPareto80(rows())).toBeNull();
  });

  it('SKU tanpa penjualan tidak ikut menggeser ambang', () => {
    expect(skuPareto80(rows(50, 30, 10, 10))).toBe(skuPareto80(rows(50, 30, 10, 10, 0, 0, 0, 0, 0)));
  });
});

describe('B-3.4 — skuSlowMoving', () => {
  it('menghitung SKU terdaftar tanpa penjualan', () => {
    expect(skuSlowMoving(rows(50, 0, 30, 0, 0))).toBe(3);
  });

  it('GMV negatif (retur melebihi penjualan) tetap terhitung slow-moving', () => {
    expect(skuSlowMoving(rows(50, -10))).toBe(1);
  });

  it('katalog terunggah tapi nihil baris ⇒ 0 yang jujur, bukan null', () => {
    expect(skuSlowMoving(rows())).toBe(0);
  });
});

describe('B-5.3 — jumlahKampanye', () => {
  it('menghitung kampanye berbeda', () => {
    expect(jumlahKampanye({ 'Kampanye A': 1, 'Kampanye B': 1 })).toBe(2);
  });

  it('byCamp KOSONG ⇒ null, BUKAN 0 (hanya berkas Ads LIVE yang diunggah)', () => {
    expect(jumlahKampanye({})).toBeNull();
  });
});

describe('B-5.3 — tipeMateriIklan', () => {
  it('memetakan label export ke key form', () => {
    expect(tipeMateriIklan({ Video: 1 })).toEqual(['video_ads']);
  });

  it('label tak dikenal DIBUANG, bukan diteruskan sebagai teks bebas', () => {
    expect(tipeMateriIklan({ Lainnya: 1, 'Format Baru 2027': 1 })).toBeNull();
    expect(tipeMateriIklan({ Video: 1, Lainnya: 1 })).toEqual(['video_ads']);
  });

  it('byMat kosong ⇒ null, bukan [] ("iklan jalan tanpa materi apa pun")', () => {
    expect(tipeMateriIklan({})).toBeNull();
  });

  it('urutan STABIL mengikuti registry, bukan urutan kemunculan di berkas', () => {
    const a = tipeMateriIklan({ Video: 1, 'GMV Max': 1, LIVE: 1 });
    const b = tipeMateriIklan({ LIVE: 1, Video: 1, 'GMV Max': 1 });
    expect(a).toEqual(['gmv_max', 'live_ads', 'video_ads']);
    expect(b).toEqual(a);
  });

  it('dua label berbeda yang memetakan ke key sama tidak menggandakan', () => {
    expect(tipeMateriIklan({ Video: 1, 'Video Shopping Ads': 1 })).toEqual(['video_ads']);
  });

  it('GMV Max diperiksa SEBELUM live/video — label gabungan tidak salah slot', () => {
    // "LIVE GMV Max" mengandung kedua kata; registry-nya berurutan supaya
    // materi GMV Max tidak terbaca sebagai iklan LIVE biasa.
    expect(tipeMateriIklan({ 'LIVE GMV Max': 1 })).toEqual(['gmv_max']);
  });
});
