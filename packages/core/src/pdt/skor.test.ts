import { describe, expect, it } from 'vitest';
import { computeSkorTiktok, labelSkorPdt, scale, type PdtBenchmarkTiktok, type PdtSkorInputTiktok } from './skor';

const BENCH: PdtBenchmarkTiktok = {
  roi_gmvmax: { good: 8, warn: 4 },
  cpa_ratio: { good: 0.1, warn: 0.2 },
  gmv_per_jam_live: { good: 300000, warn: 150000 },
  sesi_live: { good: 20, warn: 12 },
  gpm_video: { good: 30000, warn: 10000 },
  pct_video_sales: { good: 0.05, warn: 0.02 },
  cvr_toko: { good: 0.015, warn: 0.008 },
  pct_kreator_produktif: { good: 0.2, warn: 0.1 },
};

const INPUT_KOSONG: PdtSkorInputTiktok = { ads: null, live: null, video: null, kartu: null, affiliate: null, produk: null };

describe('scale (G2-01)', () => {
  it('null/undefined ⇒ null (BUKAN 5 — beda dari mesin lama report/skor.ts)', () => {
    expect(scale(null, 0, 10)).toBeNull();
    expect(scale(undefined, 0, 10)).toBeNull();
  });
  it('NaN/Infinity ⇒ null', () => {
    expect(scale(NaN, 0, 10)).toBeNull();
    expect(scale(Infinity, 0, 10)).toBeNull();
  });
  it('nilai di dalam rentang dipetakan linear ke 0..10', () => {
    expect(scale(5, 0, 10)).toBe(5);
    expect(scale(2.5, 0, 10)).toBe(2.5);
  });
  it('nilai di luar rentang diklem ke 0/10', () => {
    expect(scale(-5, 0, 10)).toBe(0);
    expect(scale(15, 0, 10)).toBe(10);
  });
  it('hi === lo ⇒ null (pembagi nol dihindari, bukan Infinity/NaN)', () => {
    expect(scale(5, 5, 5)).toBeNull();
  });
});

describe('labelSkorPdt', () => {
  it('>= 8 ⇒ SEHAT, >= 6 ⇒ PERLU PERHATIAN, di bawahnya ⇒ KRITIS', () => {
    expect(labelSkorPdt(8)).toBe('SEHAT');
    expect(labelSkorPdt(9.5)).toBe('SEHAT');
    expect(labelSkorPdt(6)).toBe('PERLU PERHATIAN');
    expect(labelSkorPdt(7.9)).toBe('PERLU PERHATIAN');
    expect(labelSkorPdt(5.9)).toBe('KRITIS');
    expect(labelSkorPdt(0)).toBe('KRITIS');
  });
});

describe('computeSkorTiktok — seluruh dimensi absen', () => {
  it('total null, label null, keenam dimensi disertakan=false', () => {
    const hasil = computeSkorTiktok(INPUT_KOSONG, BENCH);
    expect(hasil.total).toBeNull();
    expect(hasil.label).toBeNull();
    expect(hasil.dimensi).toHaveLength(6);
    expect(hasil.dimensi.every((d) => !d.disertakan)).toBe(true);
    expect(hasil.dimensi.every((d) => d.labelTampil === 'data tidak tersedia')).toBe(true);
  });

  it('bobot dasar keenam dimensi berjumlah 1 (0,22+0,22+0,18+0,14+0,12+0,12)', () => {
    const hasil = computeSkorTiktok(INPUT_KOSONG, BENCH);
    const total = hasil.dimensi.reduce((s, d) => s + d.bobotDasar, 0);
    expect(total).toBeCloseTo(1, 6);
  });
});

describe('computeSkorTiktok — dimensi GMV Max Ads', () => {
  it('biaya=0 ⇒ dimensi null (nol iklan di periode ini)', () => {
    const hasil = computeSkorTiktok({ ...INPUT_KOSONG, ads: { biaya: 0, gmv: 0, pesanan: 0, burnSpend: 0, biayaProduk: 0 } }, BENCH);
    expect(hasil.dimensi.find((d) => d.kode === 'gmvmax')?.nilai).toBeNull();
  });

  it('formula ROI 0,6 + CPA-ratio 0,25 + burn 0,15 dihitung persis (nol burn)', () => {
    const hasil = computeSkorTiktok(
      { ...INPUT_KOSONG, ads: { biaya: 1_000_000, gmv: 8_000_000, pesanan: 100, burnSpend: 0, biayaProduk: 1_000_000 } },
      BENCH,
    );
    // roi = 8 (== bench.good) -> sRoi = scale(8, 0, 12) = 6.7
    // cpa = 10_000, aov = 80_000, cpaRatio = 0.125 -> sCpa = scale(0.4-0.125=0.275, 0, 0.4) = 6.9
    // burn = 0 -> sBurn = scale(1, 0, 1) = 10
    const nilai = hasil.dimensi.find((d) => d.kode === 'gmvmax')?.nilai;
    expect(nilai).toBeCloseTo(6.7 * 0.6 + 6.9 * 0.25 + 10 * 0.15, 6);
  });

  it('pesanan=0 (cpaRatio tak terhitung) ⇒ sub-suku itu dikecualikan, ROI+burn tetap dipakai (bukan seluruh dimensi jadi null)', () => {
    const hasil = computeSkorTiktok(
      { ...INPUT_KOSONG, ads: { biaya: 1_000_000, gmv: 8_000_000, pesanan: 0, burnSpend: 0, biayaProduk: 1_000_000 } },
      BENCH,
    );
    // cpa/aov keduanya null (div by zero pesanan) -> sCpa null -> dikecualikan, sisa ROI(0.6)+burn(0.15) dinormalisasi ke 0.6/0.75 + 0.15/0.75
    const nilai = hasil.dimensi.find((d) => d.kode === 'gmvmax')?.nilai;
    const sRoi = 6.7, sBurn = 10;
    const expected = (sRoi * 0.6 + sBurn * 0.15) / (0.6 + 0.15);
    expect(nilai).toBeCloseTo(expected, 6);
  });

  it('burnSpend = seluruh biayaProduk (100% bakar tanpa hasil) ⇒ sBurn = 0', () => {
    const hasil = computeSkorTiktok(
      { ...INPUT_KOSONG, ads: { biaya: 1_000_000, gmv: 8_000_000, pesanan: 100, burnSpend: 1_000_000, biayaProduk: 1_000_000 } },
      BENCH,
    );
    const nilai = hasil.dimensi.find((d) => d.kode === 'gmvmax')?.nilai as number;
    // sBurn = scale(1-1=0, 0, 1) = 0 -> menyeret rata-rata turun dibanding tes burn=0 di atas
    const withoutBurn = 6.7 * 0.6 + 6.9 * 0.25 + 10 * 0.15;
    expect(nilai).toBeLessThan(withoutBurn);
  });
});

describe('computeSkorTiktok — dimensi LIVE Streaming', () => {
  it('sesi=0 ⇒ dimensi null', () => {
    const hasil = computeSkorTiktok({ ...INPUT_KOSONG, live: { gmv: 0, jamTotal: 0, sesi: 0, sesiNol: 0 } }, BENCH);
    expect(hasil.dimensi.find((d) => d.kode === 'live')?.nilai).toBeNull();
  });

  it('sesi tanpa penjualan (sesiNol > 0) menurunkan skor dibanding seluruh sesi laku', () => {
    const bagus = computeSkorTiktok({ ...INPUT_KOSONG, live: { gmv: 3_000_000, jamTotal: 10, sesi: 10, sesiNol: 0 } }, BENCH);
    const jelek = computeSkorTiktok({ ...INPUT_KOSONG, live: { gmv: 3_000_000, jamTotal: 10, sesi: 10, sesiNol: 8 } }, BENCH);
    const nilaiBagus = bagus.dimensi.find((d) => d.kode === 'live')?.nilai as number;
    const nilaiJelek = jelek.dimensi.find((d) => d.kode === 'live')?.nilai as number;
    expect(nilaiBagus).toBeGreaterThan(nilaiJelek);
  });
});

describe('computeSkorTiktok — dimensi Video / Konten', () => {
  it('total=0 ⇒ dimensi null', () => {
    const hasil = computeSkorTiktok({ ...INPUT_KOSONG, video: { total: 0, adaPenjualan: 0, gmv: 0, vv: 0 } }, BENCH);
    expect(hasil.dimensi.find((d) => d.kode === 'video')?.nilai).toBeNull();
  });

  it('vv=0 (tak terhitung GPM) ⇒ sub-suku GPM dikecualikan, salesRate tetap dipakai', () => {
    const hasil = computeSkorTiktok({ ...INPUT_KOSONG, video: { total: 10, adaPenjualan: 5, gmv: 0, vv: 0 } }, BENCH);
    const nilai = hasil.dimensi.find((d) => d.kode === 'video')?.nilai;
    // salesRate = 0.5 -> scale(0.5, 0, 0.075) diklem ke 10 (jauh di atas bench.good*1.5=0.075)
    expect(nilai).toBeCloseTo(10, 6);
  });
});

describe('computeSkorTiktok — dimensi Kartu Produk & Shop Tab', () => {
  it('gmvTotal=0 ⇒ dimensi null', () => {
    const hasil = computeSkorTiktok({ ...INPUT_KOSONG, kartu: { gmvKartu: 0, gmvTotal: 0, cvr: 0 } }, BENCH);
    expect(hasil.dimensi.find((d) => d.kode === 'kartu')?.nilai).toBeNull();
  });

  it('share tinggi + CVR tinggi ⇒ skor tinggi', () => {
    const hasil = computeSkorTiktok({ ...INPUT_KOSONG, kartu: { gmvKartu: 4_000_000, gmvTotal: 10_000_000, cvr: 0.0225 } }, BENCH);
    // share = 0.4 -> scale(0.4,0,0.4) = 10; cvr scale(0.0225, 0, 0.0225) = 10
    const nilai = hasil.dimensi.find((d) => d.kode === 'kartu')?.nilai;
    expect(nilai).toBeCloseTo(10, 6);
  });
});

describe('computeSkorTiktok — dimensi Affiliate / Kreator', () => {
  it('total=0 ⇒ dimensi null', () => {
    const hasil = computeSkorTiktok({ ...INPUT_KOSONG, affiliate: { produktif: 0, total: 0, gmv: 0, gmvKotorToko: 0 } }, BENCH);
    expect(hasil.dimensi.find((d) => d.kode === 'affiliate')?.nilai).toBeNull();
  });

  it('gmvKotorToko=0 (share tak terhitung) ⇒ sub-suku share dikecualikan, %produktif tetap dipakai', () => {
    const hasil = computeSkorTiktok({ ...INPUT_KOSONG, affiliate: { produktif: 10, total: 20, gmv: 500_000, gmvKotorToko: 0 } }, BENCH);
    const nilai = hasil.dimensi.find((d) => d.kode === 'affiliate')?.nilai;
    // pp = 0.5 -> scale(0.5, 0, 0.3) diklem ke 10 (bench.good*1.5=0.3)
    expect(nilai).toBeCloseTo(10, 6);
  });
});

describe('computeSkorTiktok — dimensi Portfolio Produk', () => {
  it('kuadran absen (produk: null) ⇒ dimensi null', () => {
    const hasil = computeSkorTiktok(INPUT_KOSONG, BENCH);
    expect(hasil.dimensi.find((d) => d.kode === 'produk')?.nilai).toBeNull();
  });

  it('kuadran ADA tapi nol produk aktif ⇒ 3 (bukan null — beda dari kuadran absen sama sekali)', () => {
    const hasil = computeSkorTiktok({ ...INPUT_KOSONG, produk: { gmvBintangHiddenGem: 0, gmvBocorTraffic: 0, gmvAktifTotal: 0 } }, BENCH);
    expect(hasil.dimensi.find((d) => d.kode === 'produk')?.nilai).toBe(3);
  });

  it('100% GMV dari bintang+hidden_gem, nol bocor traffic ⇒ skor maksimal (3 + 1*7 - 0*3 = 10)', () => {
    const hasil = computeSkorTiktok({ ...INPUT_KOSONG, produk: { gmvBintangHiddenGem: 1_000_000, gmvBocorTraffic: 0, gmvAktifTotal: 1_000_000 } }, BENCH);
    expect(hasil.dimensi.find((d) => d.kode === 'produk')?.nilai).toBe(10);
  });

  it('100% GMV dari bocor traffic, nol bintang/hidden_gem ⇒ skor rendah (3 + 0*7 - 1*3 = 0, diklem)', () => {
    const hasil = computeSkorTiktok({ ...INPUT_KOSONG, produk: { gmvBintangHiddenGem: 0, gmvBocorTraffic: 1_000_000, gmvAktifTotal: 1_000_000 } }, BENCH);
    expect(hasil.dimensi.find((d) => d.kode === 'produk')?.nilai).toBe(0);
  });
});

describe('computeSkorTiktok — Rule 12: renormalisasi lintas dimensi (reproduksi bug mesin lama, kali ini TERTUTUP)', () => {
  it('satu dimensi absen (ads) ⇒ bobotnya TIDAK jatuh ke total sebagai netral, lima dimensi lain dinormalisasi ulang', () => {
    const kelimaDimensiSempurna: PdtSkorInputTiktok = {
      ads: null, // absen — dulu akan diberi 5/10 dan tetap menggigit bobot 22%
      live: { gmv: 6_000_000, jamTotal: 20, sesi: 30, sesiNol: 0 }, // gph=300rb=good -> tinggi
      video: { total: 20, adaPenjualan: 15, gmv: 300_000, vv: 4_000_000 }, // salesRate=0.75 tinggi, gpm tinggi
      kartu: { gmvKartu: 4_000_000, gmvTotal: 10_000_000, cvr: 0.0225 }, // skor 10 (tes di atas)
      affiliate: { produktif: 18, total: 20, gmv: 3_000_000, gmvKotorToko: 10_000_000 }, // pp=0.9 tinggi
      produk: { gmvBintangHiddenGem: 1_000_000, gmvBocorTraffic: 0, gmvAktifTotal: 1_000_000 }, // skor 10
    };
    const hasil = computeSkorTiktok(kelimaDimensiSempurna, BENCH);
    const gmvmax = hasil.dimensi.find((d) => d.kode === 'gmvmax');
    expect(gmvmax?.disertakan).toBe(false);
    expect(gmvmax?.bobotEfektif).toBe(0);
    // Σ bobotEfektif dimensi yang tersedia = 1 (renormalisasi penuh, bukan sisa 0,78)
    const sisaBobot = hasil.dimensi.filter((d) => d.disertakan).reduce((s, d) => s + d.bobotEfektif, 0);
    expect(sisaBobot).toBeCloseTo(1, 6);
    // Total TIDAK diseret turun oleh dimensi absen — dengan lima dimensi lain semuanya tinggi, total harus SEHAT
    expect(hasil.total).not.toBeNull();
    expect(hasil.label).toBe('SEHAT');
  });
});
