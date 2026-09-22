import { describe, expect, it } from 'vitest';
import {
  ambangRelatifKuadran,
  crKuadranShopee,
  klasifikasikanKuadranRelatifTiktok,
  klasifikasikanKuadranSkuShopee,
  klasifikasikanKuadranSkuTiktok,
  KLIK_MIN_UJI,
  PDT_KUADRAN_SHOPEE,
  percentileKuadran,
  type PdtBenchmarkKuadranTiktok,
} from './kuadran';

const BENCH: PdtBenchmarkKuadranTiktok = {
  quad_klik: { good: 150, warn: 25 },
  quad_cvr: { good: 0.015, warn: 0.005 },
};

describe('klasifikasikanKuadranSkuTiktok', () => {
  it('klik tinggi + cvr tinggi ⇒ bintang', () => {
    const hasil = klasifikasikanKuadranSkuTiktok([{ id: 1, klik: 200, ctor: 0.02, pesananSku: null }], BENCH);
    expect(hasil).toEqual([{ id: 1, kuadran: 'bintang' }]);
  });

  it('klik rendah (tapi ≥ ambang uji) + cvr tinggi ⇒ hidden_gem', () => {
    const hasil = klasifikasikanKuadranSkuTiktok([{ id: 1, klik: 50, ctor: 0.02, pesananSku: null }], BENCH);
    expect(hasil).toEqual([{ id: 1, kuadran: 'hidden_gem' }]);
  });

  it('klik tinggi + cvr rendah ⇒ bocor_traffic', () => {
    const hasil = klasifikasikanKuadranSkuTiktok([{ id: 1, klik: 200, ctor: 0.005, pesananSku: null }], BENCH);
    expect(hasil).toEqual([{ id: 1, kuadran: 'bocor_traffic' }]);
  });

  it('klik rendah + cvr rendah (tapi lolos ambang uji) ⇒ evaluasi', () => {
    const hasil = klasifikasikanKuadranSkuTiktok([{ id: 1, klik: 50, ctor: 0.005, pesananSku: null }], BENCH);
    expect(hasil).toEqual([{ id: 1, kuadran: 'evaluasi' }]);
  });

  it(`klik di bawah KLIK_MIN_UJI (${KLIK_MIN_UJI}) ⇒ tidur, walau cvr tinggi`, () => {
    const hasil = klasifikasikanKuadranSkuTiktok([{ id: 1, klik: KLIK_MIN_UJI - 1, ctor: 0.9, pesananSku: null }], BENCH);
    expect(hasil).toEqual([{ id: 1, kuadran: 'tidur' }]);
  });

  it('klik nol ⇒ tidak_tayang (BUKAN tidur — beda alasan: nol tayang vs sample kecil)', () => {
    const hasil = klasifikasikanKuadranSkuTiktok([{ id: 1, klik: 0, ctor: null, pesananSku: null }], BENCH);
    expect(hasil).toEqual([{ id: 1, kuadran: 'tidak_tayang' }]);
  });

  it('klik null diperlakukan sama dengan nol ⇒ tidak_tayang', () => {
    const hasil = klasifikasikanKuadranSkuTiktok([{ id: 1, klik: null, ctor: 0.9, pesananSku: null }], BENCH);
    expect(hasil).toEqual([{ id: 1, kuadran: 'tidak_tayang' }]);
  });

  it('klik lolos ambang tapi cvr TIDAK terbaca (ctor null DAN pesananSku null) ⇒ tidur', () => {
    const hasil = klasifikasikanKuadranSkuTiktok([{ id: 1, klik: 200, ctor: null, pesananSku: null }], BENCH);
    expect(hasil).toEqual([{ id: 1, kuadran: 'tidur' }]);
  });

  it('ctor null ⇒ fallback pesananSku/klik (cermin kuadranProduk mesin lama)', () => {
    // 20 pesanan / 200 klik = 0.10 ≥ quad_cvr.good (0.015) ⇒ cvr tinggi
    const hasil = klasifikasikanKuadranSkuTiktok([{ id: 1, klik: 200, ctor: null, pesananSku: 20 }], BENCH);
    expect(hasil).toEqual([{ id: 1, kuadran: 'bintang' }]);
  });

  it('ctor TERISI menang atas pesananSku (bukan dijumlah/dirata-rata)', () => {
    // pesananSku/klik akan tinggi (20/200=0.1), tapi ctor eksplisit rendah (0.001) ⇒ cvr TIDAK tinggi;
    // klik tinggi (200≥150) tapi cvr rendah ⇒ bocor_traffic, BUKAN bintang (yang akan terjadi bila
    // pesananSku/klik dipakai alih-alih ctor eksplisit).
    const hasil = klasifikasikanKuadranSkuTiktok([{ id: 1, klik: 200, ctor: 0.001, pesananSku: 20 }], BENCH);
    expect(hasil).toEqual([{ id: 1, kuadran: 'bocor_traffic' }]);
  });

  it('ambang PERSIS good (>=, bukan >) ⇒ tinggi', () => {
    const hasil = klasifikasikanKuadranSkuTiktok([{ id: 1, klik: 150, ctor: 0.015, pesananSku: null }], BENCH);
    expect(hasil).toEqual([{ id: 1, kuadran: 'bintang' }]);
  });

  it('beberapa baris sekaligus, satu bench dipakai untuk semua — urutan output = urutan input', () => {
    const hasil = klasifikasikanKuadranSkuTiktok(
      [
        { id: 1, klik: 200, ctor: 0.02, pesananSku: null },
        { id: 2, klik: 0, ctor: null, pesananSku: null },
        { id: 3, klik: 5, ctor: 0.9, pesananSku: null },
      ],
      BENCH,
    );
    expect(hasil).toEqual([
      { id: 1, kuadran: 'bintang' },
      { id: 2, kuadran: 'tidak_tayang' },
      { id: 3, kuadran: 'tidur' },
    ]);
  });
});

// ---------------------------------------------------------------------------
// SHOPEE
// ---------------------------------------------------------------------------
const K = PDT_KUADRAN_SHOPEE;
/** Baris ringkas: pengunjung + CR yang diinginkan diubah jadi `pesananDibuat`. */
const sh = (id: number, pengunjung: number | null, cr: number | null) => ({
  id, pengunjung, pesananDibuat: cr == null || pengunjung == null ? null : Math.round(cr * pengunjung),
});

describe('klasifikasikanKuadranSkuShopee (mode absolut)', () => {
  it('pengunjung tinggi + CR tinggi ⇒ bintang', () => {
    expect(klasifikasikanKuadranSkuShopee([sh(1, 1000, 0.06)])).toEqual([{ id: 1, kuadran: 'bintang' }]);
  });

  it('pengunjung rendah + CR tinggi ⇒ hidden_gem', () => {
    expect(klasifikasikanKuadranSkuShopee([sh(1, 120, 0.06)])).toEqual([{ id: 1, kuadran: 'hidden_gem' }]);
  });

  it('pengunjung tinggi + CR rendah ⇒ bocor_traffic', () => {
    expect(klasifikasikanKuadranSkuShopee([sh(1, 1000, 0.01)])).toEqual([{ id: 1, kuadran: 'bocor_traffic' }]);
  });

  it('pengunjung rendah + CR rendah ⇒ evaluasi', () => {
    expect(klasifikasikanKuadranSkuShopee([sh(1, 120, 0.01)])).toEqual([{ id: 1, kuadran: 'evaluasi' }]);
  });

  it(`pengunjung di bawah ambang uji (${K.pengunjungMinUji}) ⇒ tidur, walau CR tinggi`, () => {
    expect(klasifikasikanKuadranSkuShopee([sh(1, K.pengunjungMinUji - 1, 0.5)])).toEqual([{ id: 1, kuadran: 'tidur' }]);
  });

  it('pengunjung nol/null ⇒ tidak_tayang', () => {
    expect(klasifikasikanKuadranSkuShopee([sh(1, 0, null), sh(2, null, null)]))
      .toEqual([{ id: 1, kuadran: 'tidak_tayang' }, { id: 2, kuadran: 'tidak_tayang' }]);
  });

  it('pengunjung ada tapi pesanan tak terpanen ⇒ no_data — ember milik Shopee saja, dan ia diperiksa SEBELUM tidur', () => {
    expect(klasifikasikanKuadranSkuShopee([{ id: 1, pengunjung: 10, pesananDibuat: null }]))
      .toEqual([{ id: 1, kuadran: 'no_data' }]);
  });

  // Band `medium` — inti perbedaan algoritma Shopee terhadap TikTok.
  it('trafik medium (di antara 150 dan 500) DIPROMOSIKAN ke high saat CR-nya high', () => {
    // 300 pengunjung: medium. CR 6% ≥ 4% ⇒ trafik dibaca high ⇒ bintang, bukan hidden_gem.
    expect(klasifikasikanKuadranSkuShopee([sh(1, 300, 0.06)])).toEqual([{ id: 1, kuadran: 'bintang' }]);
  });

  it('trafik medium TURUN ke low saat CR-nya tidak high', () => {
    expect(klasifikasikanKuadranSkuShopee([sh(1, 300, 0.03)])).toEqual([{ id: 1, kuadran: 'evaluasi' }]);
  });

  it('CR medium (di antara 2% dan 4%) DIPROMOSIKAN ke high saat trafiknya high', () => {
    // CR 3% medium + 1000 pengunjung ≥ 500 ⇒ CR dibaca high ⇒ bintang, bukan bocor_traffic.
    expect(klasifikasikanKuadranSkuShopee([sh(1, 1000, 0.03)])).toEqual([{ id: 1, kuadran: 'bintang' }]);
  });

  it('ambang boleh dioper (mode relatif) — fungsi yang sama, hanya keempat ambangnya ditukar', () => {
    const ambang = { trafficRendah: 10, trafficTinggi: 100, crRendah: 0.001, crTinggi: 0.005, n: 4 };
    // 120 pengunjung / CR 1% : di mode ABSOLUT ini evaluasi, di ambang ini bintang.
    expect(klasifikasikanKuadranSkuShopee([sh(1, 120, 0.01)])).toEqual([{ id: 1, kuadran: 'evaluasi' }]);
    expect(klasifikasikanKuadranSkuShopee([sh(1, 120, 0.01)], ambang)).toEqual([{ id: 1, kuadran: 'bintang' }]);
  });

  it('crKuadranShopee: pesanan ÷ pengunjung, null bila salah satu sisi tak diketahui (Rule 12, bukan 0)', () => {
    expect(crKuadranShopee({ id: 1, pengunjung: 200, pesananDibuat: 10 })).toBeCloseTo(0.05, 10);
    expect(crKuadranShopee({ id: 1, pengunjung: 0, pesananDibuat: 10 })).toBeNull();
    expect(crKuadranShopee({ id: 1, pengunjung: null, pesananDibuat: 10 })).toBeNull();
    expect(crKuadranShopee({ id: 1, pengunjung: 200, pesananDibuat: null })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Mode relatif
// ---------------------------------------------------------------------------
describe('ambangRelatifKuadran', () => {
  it('p25/p75 atas baris AKTIF saja — baris di bawah ambang uji tidak ikut membentuk ambang', () => {
    const baris = [
      { id: 1, traffic: 5, cr: 0.9 }, // di bawah minUji 10 — dibuang
      { id: 2, traffic: 10, cr: 0.01 },
      { id: 3, traffic: 20, cr: 0.02 },
      { id: 4, traffic: 30, cr: 0.03 },
      { id: 5, traffic: 40, cr: 0.04 },
    ];
    const a = ambangRelatifKuadran(baris, 10, false);
    expect(a.n).toBe(4);
    expect(a.trafficRendah).toBeCloseTo(17.5, 10);
    expect(a.trafficTinggi).toBeCloseTo(32.5, 10);
  });

  it('crPositifSaja=true (TikTok) membuang CVR nol — katalog ekor-panjang kalau tidak membuat p75 runtuh ke 0', () => {
    const baris = [
      { id: 1, traffic: 100, cr: 0 }, { id: 2, traffic: 100, cr: 0 }, { id: 3, traffic: 100, cr: 0 },
      { id: 4, traffic: 100, cr: 0 }, { id: 5, traffic: 100, cr: 0.02 },
    ];
    expect(ambangRelatifKuadran(baris, 10, true).crTinggi).toBeCloseTo(0.02, 10);
    expect(ambangRelatifKuadran(baris, 10, false).crTinggi).toBeCloseTo(0, 10);
  });

  it('nol baris aktif ⇒ seluruh ambang null, n 0 (bukan lemparan error)', () => {
    expect(ambangRelatifKuadran([{ id: 1, traffic: 1, cr: null }], 10, false))
      .toEqual({ trafficRendah: null, trafficTinggi: null, crRendah: null, crTinggi: null, n: 0 });
  });

  it('percentileKuadran: daftar kosong null, satu elemen = elemen itu', () => {
    expect(percentileKuadran([], 0.5)).toBeNull();
    expect(percentileKuadran([7], 0.25)).toBe(7);
  });
});

describe('klasifikasikanKuadranRelatifTiktok', () => {
  const ambang = { trafficRendah: 20, trafficTinggi: 100, crRendah: 0.01, crTinggi: 0.03, n: 4 };

  it('dua-band: hanya ambang TINGGI yang memutuskan', () => {
    expect(klasifikasikanKuadranRelatifTiktok([
      { id: 1, traffic: 200, cr: 0.05 }, { id: 2, traffic: 50, cr: 0.05 },
      { id: 3, traffic: 200, cr: 0.01 }, { id: 4, traffic: 50, cr: 0.01 },
    ], KLIK_MIN_UJI, ambang)).toEqual([
      { id: 1, kuadran: 'bintang' }, { id: 2, kuadran: 'hidden_gem' },
      { id: 3, kuadran: 'bocor_traffic' }, { id: 4, kuadran: 'evaluasi' },
    ]);
  });

  it('nol trafik ⇒ tidak_tayang; trafik di bawah ambang uji atau cr null ⇒ tidur', () => {
    expect(klasifikasikanKuadranRelatifTiktok([
      { id: 1, traffic: 0, cr: 0.5 }, { id: 2, traffic: 3, cr: 0.5 }, { id: 3, traffic: 500, cr: null },
    ], KLIK_MIN_UJI, ambang)).toEqual([
      { id: 1, kuadran: 'tidak_tayang' }, { id: 2, kuadran: 'tidur' }, { id: 3, kuadran: 'tidur' },
    ]);
  });

  it('ambang null (nol baris aktif) jatuh ke 0 — cermin `TH || 0` mesin lama, bukan error', () => {
    const kosong = { trafficRendah: null, trafficTinggi: null, crRendah: null, crTinggi: null, n: 0 };
    expect(klasifikasikanKuadranRelatifTiktok([{ id: 1, traffic: 50, cr: 0.01 }], KLIK_MIN_UJI, kosong))
      .toEqual([{ id: 1, kuadran: 'bintang' }]);
  });
});
