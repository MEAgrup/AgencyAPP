import { describe, expect, it } from 'vitest';
import {
  bangunKanalShopee,
  bangunKanalTiktok,
  bangunKpiRingkas,
  bangunLaporanLive,
  bangunLaporanShopee,
  bangunLaporanTiktok,
  bangunLaporanVideo,
  type PdtLaporanKanalInputShopee,
  type PdtLaporanKanalInputTiktok,
  type PdtLaporanKpiInput,
  type PdtLaporanLiveInput,
  type PdtLaporanVideoInput,
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
      live: null,
      video: null,
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
      live: null,
      video: null,
      skor,
      benchmarkVersi: 1,
    });
  });

  it('kpi null (nol baris basis net di periode ini) ⇒ bagian kpi seluruhnya null, skor tetap terisi bila ada dimensi lain', () => {
    const skor = computeSkorTiktok(INPUT_KOSONG_TIKTOK, BENCH_KOSONG);
    const hasil = bangunLaporanTiktok({
      clientPlatformId: 1, periodeAwalBulan: '2026-07-01', generatedAt: '2026-08-01T00:00:00.000Z',
      kpi: null, kanal: null, live: null, video: null, skor, benchmarkVersi: 1,
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
      live: null,
      video: null,
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
      live: null,
      video: null,
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

describe('bangunLaporanLive (G2-01 lanjutan — bagian "live", 2026-09-16, SATU bentuk TikTok+Shopee)', () => {
  it('input null ⇒ null (whole object, BUKAN objek ber-field null)', () => {
    expect(bangunLaporanLive(null)).toBeNull();
  });

  it('sesi 0 ⇒ null (nol sesi live sama sekali di periode ini, cermin dimensi skor LIVE Rule 12)', () => {
    const input: PdtLaporanLiveInput = { sesi: 0, gmv: 0, vv: 0, jam: 0 };
    expect(bangunLaporanLive(input)).toBeNull();
  });

  it('TikTok: jam terisi (durasi_detik) ⇒ gmvPerSesi + gmvPerJam keduanya terhitung', () => {
    const input: PdtLaporanLiveInput = { sesi: 4, gmv: 4_000_000, vv: 10_000, jam: 8 };
    expect(bangunLaporanLive(input)).toEqual({
      sesi: 4, gmv: 4_000_000, vv: 10_000, jam: 8, gmvPerSesi: 1_000_000, gmvPerJam: 500_000,
    });
  });

  it('Shopee: jam null (durasi_detik kosong permanen di sumbernya) ⇒ gmvPerJam null, gmvPerSesi TETAP terhitung', () => {
    const input: PdtLaporanLiveInput = { sesi: 4, gmv: 4_000_000, vv: 10_000, jam: null };
    expect(bangunLaporanLive(input)).toEqual({
      sesi: 4, gmv: 4_000_000, vv: 10_000, jam: null, gmvPerSesi: 1_000_000, gmvPerJam: null,
    });
  });

  it('gmv null (nol baris dengan gmv terisi) ⇒ gmvPerSesi/gmvPerJam ikut null', () => {
    const input: PdtLaporanLiveInput = { sesi: 4, gmv: null, vv: 10_000, jam: 8 };
    const hasil = bangunLaporanLive(input);
    expect(hasil?.gmvPerSesi).toBeNull();
    expect(hasil?.gmvPerJam).toBeNull();
    expect(hasil?.vv).toBe(10_000); // vv tetap terisi independen dari gmv.
  });

  it('jam dibulatkan 2 desimal', () => {
    const input: PdtLaporanLiveInput = { sesi: 3, gmv: 1_000_000, vv: 100, jam: 7.12345 };
    expect(bangunLaporanLive(input)?.jam).toBe(7.12);
  });
});

describe('bangunLaporanVideo (G2-01 lanjutan — bagian "video", 2026-09-16, TikTok-only)', () => {
  it('input null ⇒ null (whole object, BUKAN objek ber-field null)', () => {
    expect(bangunLaporanVideo(null)).toBeNull();
  });

  it('total 0 ⇒ null (nol baris video sama sekali di periode ini — TikTok tanpa upload video, ATAU Shopee yang memang nol penulis fakta)', () => {
    const input: PdtLaporanVideoInput = { total: 0, gmv: 0, vv: 0, likes: 0, dibagikan: 0, klikProduk: 0 };
    expect(bangunLaporanVideo(input)).toBeNull();
  });

  it('seluruh kolom terisi ⇒ gmvPerVideo + vvPerVideo keduanya terhitung', () => {
    const input: PdtLaporanVideoInput = { total: 10, gmv: 5_000_000, vv: 100_000, likes: 4_000, dibagikan: 200, klikProduk: 800 };
    expect(bangunLaporanVideo(input)).toEqual({
      total: 10, gmv: 5_000_000, vv: 100_000, likes: 4_000, dibagikan: 200, klikProduk: 800,
      gmvPerVideo: 500_000, vvPerVideo: 10_000,
    });
  });

  it('gmv null (nol baris dengan gmv terisi) ⇒ gmvPerVideo ikut null, vvPerVideo TETAP terhitung independen', () => {
    const input: PdtLaporanVideoInput = { total: 5, gmv: null, vv: 50_000, likes: null, dibagikan: null, klikProduk: null };
    const hasil = bangunLaporanVideo(input);
    expect(hasil?.gmvPerVideo).toBeNull();
    expect(hasil?.vvPerVideo).toBe(10_000);
    expect(hasil?.likes).toBeNull();
    expect(hasil?.dibagikan).toBeNull();
    expect(hasil?.klikProduk).toBeNull();
  });

  it('vv null (nol baris dengan vv terisi) ⇒ vvPerVideo null, gmvPerVideo TETAP terhitung independen', () => {
    const input: PdtLaporanVideoInput = { total: 5, gmv: 2_500_000, vv: null, likes: 1_000, dibagikan: 50, klikProduk: 300 };
    const hasil = bangunLaporanVideo(input);
    expect(hasil?.vvPerVideo).toBeNull();
    expect(hasil?.gmvPerVideo).toBe(500_000);
  });
});
