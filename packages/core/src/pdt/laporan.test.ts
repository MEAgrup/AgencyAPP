import { describe, expect, it } from 'vitest';
import {
  bangunKanalShopee,
  bangunKanalTiktok,
  bangunKpiRingkas,
  bangunLaporanShopee,
  bangunLaporanTiktok,
  type PdtLaporanKanalInputShopee,
  type PdtLaporanKanalInputTiktok,
  type PdtLaporanKpiInput,
} from './laporan';
import { computeSkorShopee, computeSkorTiktok, type PdtSkorInputShopee, type PdtSkorInputTiktok } from './skor';

const INPUT_KOSONG_TIKTOK: PdtSkorInputTiktok = { ads: null, live: null, video: null, kartu: null, affiliate: null, produk: null };
const INPUT_KOSONG_SHOPEE: PdtSkorInputShopee = { ads: null, dibuat: null, produk: null, live: null, kesehatan: null };

const BENCH_KOSONG = {
  roi_gmvmax: { good: 8, warn: 4 },
  cpa_ratio: { good: 0.1, warn: 0.2 },
  gmv_per_jam_live: { good: 300000, warn: 150000 },
  sesi_live: { good: 20, warn: 12 },
  gpm_video: { good: 30000, warn: 10000 },
  pct_video_sales: { good: 0.05, warn: 0.02 },
  cvr_toko: { good: 0.015, warn: 0.008 },
  pct_kreator_produktif: { good: 0.2, warn: 0.1 },
};

describe('bangunKpiRingkas (sesi 34 lanjutan — G2-01 lanjutan, payload laporan v1)', () => {
  it('input null (nol baris basis terkait) ⇒ seluruh field null, BUKAN 0', () => {
    expect(bangunKpiRingkas(null)).toEqual({ gmv: null, pesanan: null, pengunjung: null, cvr: null });
  });

  it('membulatkan gmv/pesanan/pengunjung, cvr = pesanan/pengunjung dibulatkan 5 desimal', () => {
    const input: PdtLaporanKpiInput = { gmv: 1_234_567.8, pesanan: 40, pengunjung: 2_000 };
    expect(bangunKpiRingkas(input)).toEqual({ gmv: 1_234_568, pesanan: 40, pengunjung: 2_000, cvr: 0.02 });
  });

  it('pengunjung 0 ⇒ cvr null (BUKAN pembagian oleh nol yang mengarang 0/Infinity)', () => {
    const input: PdtLaporanKpiInput = { gmv: 0, pesanan: 0, pengunjung: 0 };
    expect(bangunKpiRingkas(input).cvr).toBeNull();
  });
});

describe('bangunLaporanTiktok (sesi 34 lanjutan)', () => {
  it('merakit schema+platform+identitas+kpi+kanal+skor+benchmarkVersi', () => {
    const skor = computeSkorTiktok(INPUT_KOSONG_TIKTOK, BENCH_KOSONG);
    const hasil = bangunLaporanTiktok({
      clientPlatformId: 42,
      periodeAwalBulan: '2026-07-01',
      generatedAt: '2026-08-01T00:00:00.000Z',
      kpi: { gmv: 10_000_000, pesanan: 100, pengunjung: 5_000 },
      kanal: null,
      skor,
      benchmarkVersi: 1,
    });
    expect(hasil).toEqual({
      schema: 'cdps.pdt.laporan.tiktok.v1',
      platform: 'tiktok',
      clientPlatformId: 42,
      periodeAwalBulan: '2026-07-01',
      generatedAt: '2026-08-01T00:00:00.000Z',
      kpi: { gmv: 10_000_000, pesanan: 100, pengunjung: 5_000, cvr: 0.02 },
      kanal: { gmvTotal: null, items: [], lengkap: true },
      skor,
      benchmarkVersi: 1,
    });
  });

  it('kpi null (nol baris basis net di periode ini) ⇒ bagian kpi seluruhnya null, skor tetap terisi bila ada dimensi lain', () => {
    const skor = computeSkorTiktok(INPUT_KOSONG_TIKTOK, BENCH_KOSONG);
    const hasil = bangunLaporanTiktok({
      clientPlatformId: 1, periodeAwalBulan: '2026-07-01', generatedAt: '2026-08-01T00:00:00.000Z',
      kpi: null, kanal: null, skor, benchmarkVersi: 1,
    });
    expect(hasil.kpi).toEqual({ gmv: null, pesanan: null, pengunjung: null, cvr: null });
  });
});

describe('bangunLaporanShopee (sesi 34 lanjutan)', () => {
  it('merakit schema+platform+identitas+kpi+kanal+skor — TANPA field benchmarkVersi sama sekali (asimetri asli)', () => {
    const skor = computeSkorShopee(INPUT_KOSONG_SHOPEE);
    const hasil = bangunLaporanShopee({
      clientPlatformId: 7,
      periodeAwalBulan: '2026-07-01',
      generatedAt: '2026-08-01T00:00:00.000Z',
      kpi: { gmv: 5_000_000, pesanan: 50, pengunjung: 2_500 },
      kanal: null,
      skor,
    });
    expect(hasil).toEqual({
      schema: 'cdps.pdt.laporan.shopee.v1',
      platform: 'shopee',
      clientPlatformId: 7,
      periodeAwalBulan: '2026-07-01',
      generatedAt: '2026-08-01T00:00:00.000Z',
      kpi: { gmv: 5_000_000, pesanan: 50, pengunjung: 2_500, cvr: 0.02 },
      kanal: { gmvTotal: null, items: [], lengkap: false },
      skor,
    });
    expect('benchmarkVersi' in hasil).toBe(false);
  });
});

describe('bangunKanalTiktok (G2-01 lanjutan — bagian "kanal", 2026-09-16)', () => {
  it('input null (nol baris basis net) ⇒ gmvTotal/items kosong, lengkap tetap true', () => {
    expect(bangunKanalTiktok(null)).toEqual({ gmvTotal: null, items: [], lengkap: true });
  });

  it('live+video diketahui ⇒ kartu = sisa (gmvTotal − live − video), persen terhadap gmvTotal', () => {
    const input: PdtLaporanKanalInputTiktok = { gmvTotal: 10_000_000, live: 4_000_000, video: 3_500_000 };
    expect(bangunKanalTiktok(input)).toEqual({
      gmvTotal: 10_000_000,
      items: [
        { kode: 'live', label: 'LIVE', gmv: 4_000_000, persen: 0.4 },
        { kode: 'video', label: 'Video', gmv: 3_500_000, persen: 0.35 },
        { kode: 'kartu', label: 'Kartu Produk / Shop Tab', gmv: 2_500_000, persen: 0.25 },
      ],
      lengkap: true,
    });
  });

  it('video null (nol baris pdt_fact_content jenis video) ⇒ kartu ikut null (BUKAN dihitung dari live saja)', () => {
    const input: PdtLaporanKanalInputTiktok = { gmvTotal: 10_000_000, live: 4_000_000, video: null };
    const hasil = bangunKanalTiktok(input);
    expect(hasil.items.find((i) => i.kode === 'video')).toEqual({ kode: 'video', label: 'Video', gmv: null, persen: null });
    expect(hasil.items.find((i) => i.kode === 'kartu')).toEqual({ kode: 'kartu', label: 'Kartu Produk / Shop Tab', gmv: null, persen: null });
    // live TETAP terisi meski video tidak diketahui — masing-masing item independen.
    expect(hasil.items.find((i) => i.kode === 'live')).toEqual({ kode: 'live', label: 'LIVE', gmv: 4_000_000, persen: 0.4 });
  });

  it('gmvTotal 0 ⇒ persen null (bukan pembagian oleh nol)', () => {
    const input: PdtLaporanKanalInputTiktok = { gmvTotal: 0, live: 0, video: 0 };
    const hasil = bangunKanalTiktok(input);
    expect(hasil.items.every((i) => i.persen === null)).toBe(true);
  });
});

describe('bangunKanalShopee (G2-01 lanjutan — bagian "kanal", SELALU lengkap:false)', () => {
  it('input null (nol baris basis dibuat) ⇒ gmvTotal/items kosong, lengkap tetap false', () => {
    expect(bangunKanalShopee(null)).toEqual({ gmvTotal: null, items: [], lengkap: false });
  });

  it('shopeeAds+affiliate diketahui ⇒ dua item, persen terhadap gmvTotal basis dibuat, lengkap:false', () => {
    const input: PdtLaporanKanalInputShopee = { gmvTotal: 8_000_000, shopeeAds: 1_600_000, affiliate: 800_000 };
    expect(bangunKanalShopee(input)).toEqual({
      gmvTotal: 8_000_000,
      items: [
        { kode: 'shopee_ads', label: 'Shopee Ads', gmv: 1_600_000, persen: 0.2 },
        { kode: 'affiliate', label: 'Affiliate', gmv: 800_000, persen: 0.1 },
      ],
      lengkap: false,
    });
  });

  it('affiliate null (nol baris pdt_fact_creator_period) ⇒ item affiliate null, shopeeAds tetap terisi', () => {
    const input: PdtLaporanKanalInputShopee = { gmvTotal: 8_000_000, shopeeAds: 1_600_000, affiliate: null };
    const hasil = bangunKanalShopee(input);
    expect(hasil.items.find((i) => i.kode === 'affiliate')).toEqual({ kode: 'affiliate', label: 'Affiliate', gmv: null, persen: null });
    expect(hasil.items.find((i) => i.kode === 'shopee_ads')).toEqual({ kode: 'shopee_ads', label: 'Shopee Ads', gmv: 1_600_000, persen: 0.2 });
  });
});
