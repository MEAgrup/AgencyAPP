import { describe, expect, it } from 'vitest';
import {
  bangunKpiRingkas,
  bangunLaporanShopee,
  bangunLaporanTiktok,
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
  it('merakit schema+platform+identitas+kpi+skor+benchmarkVersi', () => {
    const skor = computeSkorTiktok(INPUT_KOSONG_TIKTOK, BENCH_KOSONG);
    const hasil = bangunLaporanTiktok({
      clientPlatformId: 42,
      periodeAwalBulan: '2026-07-01',
      generatedAt: '2026-08-01T00:00:00.000Z',
      kpi: { gmv: 10_000_000, pesanan: 100, pengunjung: 5_000 },
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
      skor,
      benchmarkVersi: 1,
    });
  });

  it('kpi null (nol baris basis net di periode ini) ⇒ bagian kpi seluruhnya null, skor tetap terisi bila ada dimensi lain', () => {
    const skor = computeSkorTiktok(INPUT_KOSONG_TIKTOK, BENCH_KOSONG);
    const hasil = bangunLaporanTiktok({
      clientPlatformId: 1, periodeAwalBulan: '2026-07-01', generatedAt: '2026-08-01T00:00:00.000Z',
      kpi: null, skor, benchmarkVersi: 1,
    });
    expect(hasil.kpi).toEqual({ gmv: null, pesanan: null, pengunjung: null, cvr: null });
  });
});

describe('bangunLaporanShopee (sesi 34 lanjutan)', () => {
  it('merakit schema+platform+identitas+kpi+skor — TANPA field benchmarkVersi sama sekali (asimetri asli)', () => {
    const skor = computeSkorShopee(INPUT_KOSONG_SHOPEE);
    const hasil = bangunLaporanShopee({
      clientPlatformId: 7,
      periodeAwalBulan: '2026-07-01',
      generatedAt: '2026-08-01T00:00:00.000Z',
      kpi: { gmv: 5_000_000, pesanan: 50, pengunjung: 2_500 },
      skor,
    });
    expect(hasil).toEqual({
      schema: 'cdps.pdt.laporan.shopee.v1',
      platform: 'shopee',
      clientPlatformId: 7,
      periodeAwalBulan: '2026-07-01',
      generatedAt: '2026-08-01T00:00:00.000Z',
      kpi: { gmv: 5_000_000, pesanan: 50, pengunjung: 2_500, cvr: 0.02 },
      skor,
    });
    expect('benchmarkVersi' in hasil).toBe(false);
  });
});
