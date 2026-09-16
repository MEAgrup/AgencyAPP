import { describe, expect, it } from 'vitest';
import {
  bangunIklanShopee,
  bangunIklanTiktok,
  bangunKanalShopee,
  bangunKanalTiktok,
  bangunKpiRingkas,
  bangunLaporanAfiliasi,
  bangunLaporanInsight,
  bangunLaporanLive,
  bangunLaporanProduk,
  bangunLaporanShopee,
  bangunLaporanTahap,
  bangunLaporanTiktok,
  bangunLaporanVideo,
  type PdtLaporanAfiliasi,
  type PdtLaporanAfiliasiInput,
  type PdtLaporanIklan,
  type PdtLaporanIklanInputShopee,
  type PdtLaporanIklanInputTiktok,
  type PdtLaporanInsightInput,
  type PdtLaporanKanal,
  type PdtLaporanKanalInputShopee,
  type PdtLaporanKanalInputTiktok,
  type PdtLaporanKpiInput,
  type PdtLaporanKpiRingkas,
  type PdtLaporanLiveInput,
  type PdtLaporanProdukInput,
  type PdtLaporanTahap,
  type PdtLaporanTahapInput,
  type PdtLaporanVideo,
  type PdtLaporanVideoInput,
} from './laporan';
import { computeSkorShopee, computeSkorTiktok, type PdtSkorInputShopee, type PdtSkorInputTiktok } from './skor';

const INPUT_KOSONG_TIKTOK: PdtSkorInputTiktok = { ads: null, live: null, video: null, kartu: null, affiliate: null, produk: null };
const INPUT_KOSONG_SHOPEE: PdtSkorInputShopee = { ads: null, dibuat: null, produk: null, live: null, kesehatan: null };
const TAHAP_INPUT_KOSONG: PdtLaporanTahapInput = { tahapFokus: null, klik: null, cpaInput: null, affPosting: null };

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
      iklan: null,
      live: null,
      video: null,
      produk: null,
      afiliasi: null,
      tahap: TAHAP_INPUT_KOSONG,
      skor,
      benchmarkVersi: 1,
      benchTiktok: BENCH_KOSONG,
    });
    expect(hasil).toEqual({
      schema: 'cdps.pdt.laporan.tiktok.v1',
      platform: 'tiktok',
      clientPlatformId: 42,
      periodeAwalBulan: '2026-07-01',
      generatedAt: '2026-08-01T00:00:00.000Z',
      kpi: { gmv: 10_000_000, pesanan: 100, pengunjung: 5_000, cvr: 0.02 },
      kanal: { gmvTotal: null, items: [], lengkap: true },
      iklan: null,
      live: null,
      video: null,
      produk: null,
      afiliasi: null,
      tahap: {
        fokus: null,
        funnel: [
          { kode: 'impresi', label: 'Impresi produk', nilai: null, lolos: null, lolosDari: null, catatan: 'kolom impresi toko belum ada di skema PDT saat ini' },
          { kode: 'klik', label: 'Klik ke halaman produk', nilai: null, lolos: null, lolosDari: null, catatan: 'tidak ada di export Analitik Toko periode ini' },
          { kode: 'pengunjung', label: 'Pengunjung toko', nilai: 5_000, lolos: null, lolosDari: null, catatan: null },
          { kode: 'atc', label: 'Add to Cart', nilai: null, lolos: null, lolosDari: null, catatan: 'hanya terbaca dari export Ads Manager Showcase — belum dibangun' },
          { kode: 'pesanan', label: 'Pesanan', nilai: 100, lolos: 0.02, lolosDari: 'Pengunjung toko', catatan: null },
        ],
        konversiTotal: { nilai: 0.02 },
        belanjaTotal: null,
        blok: [
          {
            kode: 'awareness', label: 'Awareness', fokus: false, belanja: null, belanjaPersen: null,
            metrik: [
              { kode: 'vv_impresi', label: 'Impresi iklan awareness', nilai: null, satuan: 'angka' },
              { kode: 'vv_views', label: 'Video views (iklan)', nilai: null, satuan: 'angka' },
              { kode: 'vv_cpm', label: 'CPM', nilai: null, satuan: 'rupiah' },
              { kode: 'vv_per1k', label: 'Biaya per 1.000 views', nilai: null, satuan: 'rupiah' },
              { kode: 'fol_follows', label: 'Follower dari campaign', nilai: null, satuan: 'angka' },
              { kode: 'fol_cost', label: 'Biaya per follower', nilai: null, satuan: 'rupiah' },
              { kode: 'konten_n', label: 'Konten diproduksi & tayang', nilai: null, satuan: 'angka' },
              { kode: 'konten_vv', label: 'Total views konten', nilai: null, satuan: 'angka' },
              { kode: 'konten_follower', label: 'Follower baru dari konten', nilai: null, satuan: 'angka' },
            ],
          },
          {
            kode: 'consideration', label: 'Consideration', fokus: false, belanja: null, belanjaPersen: null,
            metrik: [
              { kode: 'sc_impresi', label: 'Impresi iklan showcase', nilai: null, satuan: 'angka' },
              { kode: 'sc_klik', label: 'Klik ke halaman produk (iklan)', nilai: null, satuan: 'angka' },
              { kode: 'sc_ctr', label: 'CTR showcase', nilai: null, satuan: 'persen' },
              { kode: 'sc_atc', label: 'Add to cart (iklan showcase)', nilai: null, satuan: 'angka' },
              { kode: 'sc_cost_atc', label: 'Biaya per add to cart', nilai: null, satuan: 'rupiah' },
              { kode: 'toko_impresi', label: 'Impresi produk (toko)', nilai: null, satuan: 'angka' },
              { kode: 'toko_klik', label: 'Klik produk (toko)', nilai: null, satuan: 'angka' },
              { kode: 'aff_total', label: 'Kreator afiliasi terdaftar', nilai: null, satuan: 'angka' },
              { kode: 'aff_posting', label: 'Kreator memposting konten', nilai: null, satuan: 'angka' },
            ],
          },
          {
            kode: 'conversion', label: 'Conversion', fokus: false, belanja: null, belanjaPersen: null,
            metrik: [
              { kode: 'gmv', label: 'GMV', nilai: 10_000_000, satuan: 'rupiah' },
              { kode: 'pesanan', label: 'Pesanan', nilai: 100, satuan: 'angka' },
              { kode: 'cvr', label: 'Conversion rate toko', nilai: 0.02, satuan: 'persen' },
              { kode: 'aov', label: 'Nilai rata-rata per pesanan', nilai: 100_000, satuan: 'rupiah' },
              { kode: 'roi', label: 'ROI iklan konversi (GMV Max)', nilai: null, satuan: 'kali' },
              { kode: 'cpa', label: 'Biaya per pesanan (GMV Max)', nilai: null, satuan: 'rupiah' },
              { kode: 'aff_produktif', label: 'Kreator menghasilkan penjualan', nilai: null, satuan: 'angka' },
              { kode: 'tp_gmv', label: 'GMV ShopTokopedia', nilai: null, satuan: 'rupiah' },
            ],
          },
        ],
      },
      skor,
      benchmarkVersi: 1,
      insight: {
        ringkasan: 'GMV Rp. 10.000.000,00 dari 100 pesanan. Skor performa belum bisa dihitung — belum ada dimensi yang punya data periode ini.',
        poin: ['GMV Rp. 10.000.000,00 dari 100 pesanan (CVR 2,00%).'],
        rekomendasiTinggi: [],
        rekomendasiSedang: [],
        outlook: 'Target GMV bulan depan: Rp. 11.500.000,00–Rp. 13.000.000,00 (+15–30%). Fokus: tindak lanjuti rekomendasi prioritas tinggi di atas.',
        indikator: [
          { nama: 'Target ROAS Iklan (GMV Max)', target: '≥8x (kini —)' },
          { nama: 'Target GMV/jam LIVE', target: 'Rp. 150.000,00+ (kini —)' },
        ],
      },
    });
  });

  it('kpi null (nol baris basis net di periode ini) ⇒ bagian kpi seluruhnya null, skor tetap terisi bila ada dimensi lain', () => {
    const skor = computeSkorTiktok(INPUT_KOSONG_TIKTOK, BENCH_KOSONG);
    const hasil = bangunLaporanTiktok({
      clientPlatformId: 1, periodeAwalBulan: '2026-07-01', generatedAt: '2026-08-01T00:00:00.000Z',
      kpi: null, kanal: null, iklan: null, live: null, video: null, produk: null, afiliasi: null, tahap: TAHAP_INPUT_KOSONG, skor, benchmarkVersi: 1,
      benchTiktok: BENCH_KOSONG,
    });
    expect(hasil.kpi).toEqual({ gmv: null, pesanan: null, pengunjung: null, cvr: null });
    // kpi seluruhnya null ⇒ tahap ikut null (whole object) — nol apa pun untuk direproyeksikan.
    expect(hasil.tahap).toBeNull();
    // insight TIDAK PERNAH null — ringkasan/outlook selalu punya sesuatu untuk dikatakan.
    expect(hasil.insight.ringkasan).toBe('Belum ada data GMV untuk periode ini.');
    expect(hasil.insight.outlook).toBe('Target GMV bulan depan belum bisa ditentukan — GMV periode ini tidak diketahui.');
    expect(hasil.insight.poin).toEqual([]);
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
      iklan: null,
      live: null,
      video: null,
      afiliasi: null,
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
      iklan: null,
      live: null,
      video: null,
      produk: null,
      afiliasi: null,
      tahap: null,
      skor,
      insight: {
        ringkasan: 'GMV Rp. 5.000.000,00 dari 50 pesanan. Skor performa belum bisa dihitung — belum ada dimensi yang punya data periode ini.',
        poin: [
          'GMV Rp. 5.000.000,00 dari 50 pesanan (CVR 2,00%).',
          'Catatan: rincian kanal belum lengkap — sebagian sumber GMV belum punya penulis fakta PDT.',
        ],
        rekomendasiTinggi: [],
        rekomendasiSedang: [],
        outlook: 'Target GMV bulan depan: Rp. 5.750.000,00–Rp. 6.500.000,00 (+15–30%). Fokus: tindak lanjuti rekomendasi prioritas tinggi di atas.',
        indikator: [],
      },
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

describe('bangunIklanTiktok (2026-09-16, SELALU lengkap:true — dua sumber, keduanya sudah punya penulis fakta)', () => {
  it('input null ⇒ null (whole object, BUKAN objek items kosong)', () => {
    expect(bangunIklanTiktok(null)).toBeNull();
  });

  it('kedua sumber null ⇒ null (nol baris iklan sama sekali di periode ini)', () => {
    expect(bangunIklanTiktok({ product: null, live: null })).toBeNull();
  });

  it('kedua sumber terisi ⇒ total dijumlah, roas TOTAL diturunkan Σgmv÷Σbiaya', () => {
    const input: PdtLaporanIklanInputTiktok = {
      product: { biaya: 100_000, gmv: 400_000 },
      live: { biaya: 200_000, gmv: 1_000_000 },
    };
    expect(bangunIklanTiktok(input)).toEqual({
      biaya: 300_000,
      gmv: 1_400_000,
      roas: 4.67, // 1_400_000 / 300_000, dibulatkan 2 desimal
      items: [
        { kode: 'tt_ads_product', label: 'Iklan Produk', biaya: 100_000, gmv: 400_000, roas: 4 },
        { kode: 'tt_ads_live', label: 'Iklan Live', biaya: 200_000, gmv: 1_000_000, roas: 5 },
      ],
      lengkap: true,
    });
  });

  it('hanya satu sumber terisi ⇒ sumber lain jadi item null, total tetap terhitung dari sumber yang ada', () => {
    const input: PdtLaporanIklanInputTiktok = { product: { biaya: 100_000, gmv: 400_000 }, live: null };
    const hasil = bangunIklanTiktok(input);
    expect(hasil?.items.find((i) => i.kode === 'tt_ads_live')).toEqual({ kode: 'tt_ads_live', label: 'Iklan Live', biaya: null, gmv: null, roas: null });
    expect(hasil?.biaya).toBe(100_000);
    expect(hasil?.gmv).toBe(400_000);
    expect(hasil?.roas).toBe(4);
  });

  it('gmv null pada satu sumber (tidak diketahui) ⇒ total gmv dijumlah dari sumber yang DIKETAHUI saja (cermin bacaLive/bacaVideo: null hanya bila SELURUH sumber gmv tidak diketahui)', () => {
    const input: PdtLaporanIklanInputTiktok = {
      product: { biaya: 100_000, gmv: null },
      live: { biaya: 200_000, gmv: 1_000_000 },
    };
    const hasil = bangunIklanTiktok(input);
    expect(hasil?.gmv).toBe(1_000_000);
    expect(hasil?.roas).toBe(3.33); // 1_000_000 / 300_000
    expect(hasil?.biaya).toBe(300_000);
    expect(hasil?.items.find((i) => i.kode === 'tt_ads_product')?.gmv).toBeNull(); // per-item tetap null, bukan 0
  });

  it('KEDUA sumber gmv tidak diketahui ⇒ total gmv null (BUKAN 0)', () => {
    const input: PdtLaporanIklanInputTiktok = {
      product: { biaya: 100_000, gmv: null },
      live: { biaya: 200_000, gmv: null },
    };
    const hasil = bangunIklanTiktok(input);
    expect(hasil?.gmv).toBeNull();
    expect(hasil?.roas).toBeNull();
    expect(hasil?.biaya).toBe(300_000);
  });

  it('biaya total 0 (kedua sumber ada tapi biaya 0) ⇒ roas null (bukan pembagian oleh nol)', () => {
    const input: PdtLaporanIklanInputTiktok = { product: { biaya: 0, gmv: 0 }, live: { biaya: 0, gmv: 0 } };
    expect(bangunIklanTiktok(input)?.roas).toBeNull();
  });
});

describe('bangunIklanShopee (2026-09-16, SELALU lengkap:false — ads_banner legacy tidak pernah punya modul PDT)', () => {
  it('input null ⇒ null (whole object)', () => {
    expect(bangunIklanShopee(null)).toBeNull();
  });

  it('ketiga sumber null ⇒ null', () => {
    expect(bangunIklanShopee({ cpc: null, search: null, live: null })).toBeNull();
  });

  it('ketiga sumber terisi ⇒ tiga item, total dijumlah, lengkap:false', () => {
    const input: PdtLaporanIklanInputShopee = {
      cpc: { biaya: 100_000, gmv: 300_000 },
      search: { biaya: 50_000, gmv: 100_000 },
      live: { biaya: 200_000, gmv: 1_000_000 },
    };
    const hasil = bangunIklanShopee(input);
    expect(hasil?.lengkap).toBe(false);
    expect(hasil?.biaya).toBe(350_000);
    expect(hasil?.gmv).toBe(1_400_000);
    expect(hasil?.items.map((i) => i.kode)).toEqual(['shopee_ads_cpc', 'shopee_ads_search', 'shopee_ads_live']);
    expect(hasil?.items.find((i) => i.kode === 'shopee_ads_search')).toEqual({ kode: 'shopee_ads_search', label: 'Iklan Pencarian', biaya: 50_000, gmv: 100_000, roas: 2 });
  });

  it('hanya cpc terisi ⇒ search/live jadi item null, total dari cpc saja', () => {
    const input: PdtLaporanIklanInputShopee = { cpc: { biaya: 100_000, gmv: 300_000 }, search: null, live: null };
    const hasil = bangunIklanShopee(input);
    expect(hasil?.items.find((i) => i.kode === 'shopee_ads_search')).toEqual({ kode: 'shopee_ads_search', label: 'Iklan Pencarian', biaya: null, gmv: null, roas: null });
    expect(hasil?.biaya).toBe(100_000);
    expect(hasil?.roas).toBe(3);
  });
});

describe('bangunLaporanAfiliasi (G2-01 lanjutan — bagian "afiliasi" ringkasan, 2026-09-16, SATU bentuk TikTok+Shopee)', () => {
  it('input null ⇒ null (whole object, BUKAN objek ber-field null)', () => {
    expect(bangunLaporanAfiliasi(null)).toBeNull();
  });

  it('totalKreator 0 ⇒ null (nol baris kreator sama sekali di periode ini)', () => {
    const input: PdtLaporanAfiliasiInput = { totalKreator: 0, produktif: 0, gmv: null, pesanan: null, jumlahLive: null, jumlahVideo: null };
    expect(bangunLaporanAfiliasi(input)).toBeNull();
  });

  it('TikTok — gmv/pesanan/jumlahLive/jumlahVideo semua terisi, aov diturunkan Σgmv÷Σpesanan', () => {
    const input: PdtLaporanAfiliasiInput = { totalKreator: 5, produktif: 3, gmv: 1_000_000, pesanan: 25, jumlahLive: 8, jumlahVideo: 12 };
    expect(bangunLaporanAfiliasi(input)).toEqual({
      totalKreator: 5, produktif: 3, gmv: 1_000_000, pesanan: 25, aov: 40_000, jumlahLive: 8, jumlahVideo: 12,
    });
  });

  it('Shopee — jumlahLive/jumlahVideo tidak pernah diisi penulis fakta ⇒ null, aov tetap diturunkan dari gmv/pesanan', () => {
    const input: PdtLaporanAfiliasiInput = { totalKreator: 2, produktif: 1, gmv: 150_000, pesanan: 3, jumlahLive: null, jumlahVideo: null };
    expect(bangunLaporanAfiliasi(input)).toEqual({
      totalKreator: 2, produktif: 1, gmv: 150_000, pesanan: 3, aov: 50_000, jumlahLive: null, jumlahVideo: null,
    });
  });

  it('pesanan 0 ⇒ aov null (bukan pembagian oleh nol)', () => {
    const input: PdtLaporanAfiliasiInput = { totalKreator: 1, produktif: 0, gmv: 0, pesanan: 0, jumlahLive: null, jumlahVideo: null };
    expect(bangunLaporanAfiliasi(input)?.aov).toBeNull();
  });

  it('gmv null (nol baris berkolom gmv) ⇒ aov null, gmv tetap null (bukan 0 yang mengarang)', () => {
    const input: PdtLaporanAfiliasiInput = { totalKreator: 1, produktif: 0, gmv: null, pesanan: 3, jumlahLive: null, jumlahVideo: null };
    const hasil = bangunLaporanAfiliasi(input);
    expect(hasil?.gmv).toBeNull();
    expect(hasil?.aov).toBeNull();
    expect(hasil?.pesanan).toBe(3);
  });
});

describe('bangunLaporanTahap (G2-01 lanjutan — bagian "tahap", 2026-09-16, TikTok-only)', () => {
  const KPI_KOSONG: PdtLaporanKpiRingkas = { gmv: null, pesanan: null, pengunjung: null, cvr: null };
  const KPI_ISI: PdtLaporanKpiRingkas = { gmv: 10_000_000, pesanan: 100, pengunjung: 5_000, cvr: 0.02 };

  it('kpi seluruhnya null (nol baris basis net) ⇒ null (whole object, BUKAN objek ber-field null)', () => {
    expect(bangunLaporanTahap(TAHAP_INPUT_KOSONG, KPI_KOSONG, null, null, null)).toBeNull();
  });

  it('tahapFokus tidak valid (kolom rusak/di luar tiga nilai) ⇒ fokus null, ketiga blok fokus:false', () => {
    const input: PdtLaporanTahapInput = { ...TAHAP_INPUT_KOSONG, tahapFokus: 'bukan-tahap' };
    const hasil = bangunLaporanTahap(input, KPI_ISI, null, null, null);
    expect(hasil?.fokus).toBeNull();
    expect(hasil?.blok.every((b) => !b.fokus)).toBe(true);
  });

  it('tahapFokus valid ⇒ blok yang cocok fokus:true, sisanya false', () => {
    const input: PdtLaporanTahapInput = { ...TAHAP_INPUT_KOSONG, tahapFokus: 'consideration' };
    const hasil = bangunLaporanTahap(input, KPI_ISI, null, null, null);
    expect(hasil?.fokus).toBe('consideration');
    expect(hasil?.blok.find((b) => b.kode === 'consideration')?.fokus).toBe(true);
    expect(hasil?.blok.find((b) => b.kode === 'awareness')?.fokus).toBe(false);
    expect(hasil?.blok.find((b) => b.kode === 'conversion')?.fokus).toBe(false);
  });

  it('funnel: rung tanpa nilai (impresi/atc) tidak pernah jadi pembanding lolos — lolos dihitung terhadap rung terakhir yang PUNYA nilai', () => {
    const input: PdtLaporanTahapInput = { ...TAHAP_INPUT_KOSONG, klik: 2_500 };
    const hasil = bangunLaporanTahap(input, KPI_ISI, null, null, null);
    const klik = hasil?.funnel.find((f) => f.kode === 'klik');
    const pengunjung = hasil?.funnel.find((f) => f.kode === 'pengunjung');
    const pesanan = hasil?.funnel.find((f) => f.kode === 'pesanan');
    // klik (2.500) adalah rung PERTAMA berisi nilai ⇒ lolosDari null (nol pembanding sebelumnya).
    expect(klik).toEqual({ kode: 'klik', label: 'Klik ke halaman produk', nilai: 2_500, lolos: null, lolosDari: null, catatan: null });
    // pengunjung (5.000) dibanding klik (2.500) — TERBALIK dari urutan tampil, tapi itu memang lolos > 1 (funnel corong tidak selalu menyempit di sini karena klik toko ≠ definisi klik funnel iklan).
    expect(pengunjung?.lolos).toBe(2);
    expect(pengunjung?.lolosDari).toBe('Klik ke halaman produk');
    // pesanan (100) dibanding pengunjung (5.000) — atc di antaranya null, dilewati sebagai pembanding.
    expect(pesanan?.lolos).toBe(0.02);
    expect(pesanan?.lolosDari).toBe('Pengunjung toko');
  });

  it('impresi/atc SELALU null dengan catatan eksplisit (kolom genuinely tidak ada / butuh ads_manager)', () => {
    const hasil = bangunLaporanTahap(TAHAP_INPUT_KOSONG, KPI_ISI, null, null, null);
    const impresi = hasil?.funnel.find((f) => f.kode === 'impresi');
    const atc = hasil?.funnel.find((f) => f.kode === 'atc');
    expect(impresi).toEqual({ kode: 'impresi', label: 'Impresi produk', nilai: null, lolos: null, lolosDari: null, catatan: 'kolom impresi toko belum ada di skema PDT saat ini' });
    expect(atc).toEqual({ kode: 'atc', label: 'Add to Cart', nilai: null, lolos: null, lolosDari: null, catatan: 'hanya terbaca dari export Ads Manager Showcase — belum dibangun' });
  });

  it('aov diturunkan Σgmv÷Σpesanan (bukan kolom mentah), null saat pesanan 0', () => {
    const hasilIsi = bangunLaporanTahap(TAHAP_INPUT_KOSONG, KPI_ISI, null, null, null);
    expect(hasilIsi?.blok.find((b) => b.kode === 'conversion')?.metrik.find((m) => m.kode === 'aov')?.nilai).toBe(100_000);
    const kpiNol: PdtLaporanKpiRingkas = { gmv: 0, pesanan: 0, pengunjung: 0, cvr: null };
    const hasilNol = bangunLaporanTahap(TAHAP_INPUT_KOSONG, kpiNol, null, null, null);
    expect(hasilNol?.blok.find((b) => b.kode === 'conversion')?.metrik.find((m) => m.kode === 'aov')?.nilai).toBeNull();
  });

  it('cpa diturunkan Σbiaya÷Σpesanan_sku dari cpaInput, null saat pesanan_sku null/0', () => {
    const hasil = bangunLaporanTahap({ ...TAHAP_INPUT_KOSONG, cpaInput: { biaya: 300_000, pesanan: 15 } }, KPI_ISI, null, null, null);
    expect(hasil?.blok.find((b) => b.kode === 'conversion')?.metrik.find((m) => m.kode === 'cpa')?.nilai).toBe(20_000);
    const hasilPesananNull = bangunLaporanTahap({ ...TAHAP_INPUT_KOSONG, cpaInput: { biaya: 300_000, pesanan: null } }, KPI_ISI, null, null, null);
    expect(hasilPesananNull?.blok.find((b) => b.kode === 'conversion')?.metrik.find((m) => m.kode === 'cpa')?.nilai).toBeNull();
  });

  it('roi/aff_total/aff_produktif/konten_n/konten_vv reuse LANGSUNG dari iklan/afiliasi/video yang sudah dibangun (nol query ulang)', () => {
    const iklan: PdtLaporanIklan = { biaya: 300_000, gmv: 1_500_000, roas: 5, items: [], lengkap: true };
    const afiliasi: PdtLaporanAfiliasi = { totalKreator: 10, produktif: 4, gmv: 500_000, pesanan: 12, aov: 41_667, jumlahLive: 2, jumlahVideo: 6 };
    const video: PdtLaporanVideo = { total: 20, gmv: 400_000, vv: 50_000, likes: 1_000, dibagikan: 100, klikProduk: 200, gmvPerVideo: 20_000, vvPerVideo: 2_500 };
    const hasil = bangunLaporanTahap(TAHAP_INPUT_KOSONG, KPI_ISI, iklan, afiliasi, video);
    const conv = hasil?.blok.find((b) => b.kode === 'conversion')?.metrik ?? [];
    const cons = hasil?.blok.find((b) => b.kode === 'consideration')?.metrik ?? [];
    const aware = hasil?.blok.find((b) => b.kode === 'awareness')?.metrik ?? [];
    expect(conv.find((m) => m.kode === 'roi')?.nilai).toBe(5);
    expect(conv.find((m) => m.kode === 'aff_produktif')?.nilai).toBe(4);
    expect(cons.find((m) => m.kode === 'aff_total')?.nilai).toBe(10);
    expect(aware.find((m) => m.kode === 'konten_n')?.nilai).toBe(20);
    expect(aware.find((m) => m.kode === 'konten_vv')?.nilai).toBe(50_000);
    // belanja conversion = iklan.biaya (spend GMV Max) — awareness/consideration selalu null (ttam belum dibangun).
    expect(hasil?.blok.find((b) => b.kode === 'conversion')?.belanja).toBe(300_000);
    expect(hasil?.blok.find((b) => b.kode === 'conversion')?.belanjaPersen).toBe(1);
    expect(hasil?.belanjaTotal).toBe(300_000);
    expect(hasil?.blok.find((b) => b.kode === 'awareness')?.belanja).toBeNull();
  });

  it('konten_follower/awareness sc_*/tp_gmv SELALU null (pengikut_baru tidak pernah diisi writer, ttam/Tokopedia di luar cakupan)', () => {
    const hasil = bangunLaporanTahap(TAHAP_INPUT_KOSONG, KPI_ISI, null, null, null);
    const aware = hasil?.blok.find((b) => b.kode === 'awareness')?.metrik ?? [];
    const conv = hasil?.blok.find((b) => b.kode === 'conversion')?.metrik ?? [];
    expect(aware.find((m) => m.kode === 'konten_follower')?.nilai).toBeNull();
    expect(conv.find((m) => m.kode === 'tp_gmv')?.nilai).toBeNull();
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

describe('bangunLaporanProduk (G2-01-KUADRAN-SKU lanjutan — bagian "produk", TikTok-only, benchmark saja)', () => {
  it('input null ⇒ null (whole object)', () => {
    expect(bangunLaporanProduk(null)).toBeNull();
  });

  it('array kosong ⇒ null (nol baris pdt_fact_sku_period periode ini)', () => {
    expect(bangunLaporanProduk([])).toBeNull();
  });

  it('distribusi menghitung jumlah+Σgmv per KEENAM kuadran', () => {
    const input: PdtLaporanProdukInput = [
      { kuadran: 'bintang', namaProduk: 'A', platformProductId: '1', gmv: 100, klik: 50, cvr: 0.1 },
      { kuadran: 'bintang', namaProduk: 'B', platformProductId: '2', gmv: 200, klik: 60, cvr: 0.12 },
      { kuadran: 'tidur', namaProduk: 'C', platformProductId: '3', gmv: 10, klik: 2, cvr: null },
      { kuadran: 'tidak_tayang', namaProduk: 'D', platformProductId: '4', gmv: 0, klik: 0, cvr: null },
    ];
    const hasil = bangunLaporanProduk(input);
    expect(hasil?.distribusi.bintang).toEqual({ jumlah: 2, gmv: 300 });
    expect(hasil?.distribusi.tidur).toEqual({ jumlah: 1, gmv: 10 });
    expect(hasil?.distribusi.tidak_tayang).toEqual({ jumlah: 1, gmv: 0 });
    expect(hasil?.distribusi.hidden_gem).toEqual({ jumlah: 0, gmv: null });
    expect(hasil?.distribusi.bocor_traffic).toEqual({ jumlah: 0, gmv: null });
    expect(hasil?.distribusi.evaluasi).toEqual({ jumlah: 0, gmv: null });
  });

  it('distribusi gmv null bila NOL baris kuadran itu punya gmv terisi (tidak diketahui, BUKAN 0)', () => {
    const input: PdtLaporanProdukInput = [
      { kuadran: 'evaluasi', namaProduk: 'A', platformProductId: '1', gmv: null, klik: 5, cvr: 0.01 },
    ];
    expect(bangunLaporanProduk(input)?.distribusi.evaluasi).toEqual({ jumlah: 1, gmv: null });
  });

  it('topAksi HANYA bintang/bocor_traffic/hidden_gem — evaluasi/tidur/tidak_tayang dikeluarkan', () => {
    const input: PdtLaporanProdukInput = [
      { kuadran: 'bintang', namaProduk: 'Bintang', platformProductId: '1', gmv: 500, klik: 100, cvr: 0.2 },
      { kuadran: 'bocor_traffic', namaProduk: 'Bocor', platformProductId: '2', gmv: 300, klik: 200, cvr: 0.01 },
      { kuadran: 'hidden_gem', namaProduk: 'Gem', platformProductId: '3', gmv: 400, klik: 20, cvr: 0.3 },
      { kuadran: 'evaluasi', namaProduk: 'Eval', platformProductId: '4', gmv: 9_000_000, klik: 5, cvr: 0.02 },
      { kuadran: 'tidur', namaProduk: 'Tidur', platformProductId: '5', gmv: 9_000_000, klik: 2, cvr: null },
      { kuadran: 'tidak_tayang', namaProduk: 'Nol', platformProductId: '6', gmv: 0, klik: 0, cvr: null },
    ];
    const hasil = bangunLaporanProduk(input);
    expect(hasil?.topAksi.map((x) => x.namaProduk)).toEqual(['Bintang', 'Gem', 'Bocor']); // diurutkan GMV desc
  });

  it('topAksi dipotong 12 (sama angka mesin lama), sisanya dibuang', () => {
    const input: PdtLaporanProdukInput = Array.from({ length: 20 }, (_, i) => ({
      kuadran: 'bintang' as const, namaProduk: `SKU-${i}`, platformProductId: String(i), gmv: 1_000 - i, klik: 50, cvr: 0.1,
    }));
    const hasil = bangunLaporanProduk(input);
    expect(hasil?.topAksi).toHaveLength(12);
    expect(hasil?.topAksi[0].namaProduk).toBe('SKU-0'); // GMV tertinggi
  });

  it('namaProduk null (baris lama sebelum kolom Nama dipanen) TETAP masuk topAksi', () => {
    const input: PdtLaporanProdukInput = [
      { kuadran: 'bintang', namaProduk: null, platformProductId: 'PRD-1', gmv: 100, klik: 50, cvr: 0.1 },
    ];
    expect(bangunLaporanProduk(input)?.topAksi).toEqual([
      { namaProduk: null, platformProductId: 'PRD-1', gmv: 100, klik: 50, cvr: 0.1, kuadran: 'bintang' },
    ]);
  });

  it('baris kuadran null (belum sempat diklasifikasi) dikeluarkan dari distribusi+topAksi, bukan dipaksa masuk bucket', () => {
    const input: PdtLaporanProdukInput = [
      { kuadran: null, namaProduk: 'Belum', platformProductId: '1', gmv: 100, klik: 50, cvr: 0.1 },
      { kuadran: 'bintang', namaProduk: 'Sudah', platformProductId: '2', gmv: 200, klik: 60, cvr: 0.2 },
    ];
    const hasil = bangunLaporanProduk(input);
    expect(hasil?.topAksi).toHaveLength(1);
    expect(hasil?.topAksi[0].namaProduk).toBe('Sudah');
    expect(hasil?.distribusi.bintang.jumlah).toBe(1);
  });
});

describe('bangunLaporanInsight (G2-01 lanjutan — bagian "insight", 2026-09-16, SATU bentuk TikTok+Shopee)', () => {
  const KANAL_KOSONG: PdtLaporanKanal = { gmvTotal: null, items: [], lengkap: true };
  const KPI_KOSONG: PdtLaporanKpiRingkas = { gmv: null, pesanan: null, pengunjung: null, cvr: null };

  const dasar = (over: Partial<PdtLaporanInsightInput> = {}): PdtLaporanInsightInput => ({
    platform: 'tiktok',
    kpi: KPI_KOSONG,
    kanal: KANAL_KOSONG,
    iklan: null,
    live: null,
    video: null,
    afiliasi: null,
    tahap: null,
    skor: { total: null, label: null, dimensi: [] },
    benchTiktok: null,
    ...over,
  });

  it('kpi.gmv null ⇒ ringkasan/outlook bilang belum ada data, poin kosong (BUKAN null — insight selalu punya sesuatu untuk dikatakan)', () => {
    const hasil = bangunLaporanInsight(dasar());
    expect(hasil.ringkasan).toBe('Belum ada data GMV untuk periode ini.');
    expect(hasil.outlook).toBe('Target GMV bulan depan belum bisa ditentukan — GMV periode ini tidak diketahui.');
    expect(hasil.poin).toEqual([]);
  });

  it('dimensi skor nilai < SKOR_PERHATIAN_MIN (6) ⇒ rekomendasi TINGGI', () => {
    const hasil = bangunLaporanInsight(dasar({
      skor: { total: 4, label: 'KRITIS', dimensi: [{ kode: 'live', label: 'LIVE Streaming', bobotDasar: 0.22, nilai: 3, disertakan: true, bobotEfektif: 0.22, labelTampil: '' }] },
    }));
    expect(hasil.rekomendasiTinggi).toHaveLength(1);
    expect(hasil.rekomendasiTinggi[0].judul).toBe('Benahi dimensi "LIVE Streaming"');
    expect(hasil.rekomendasiSedang).toEqual([]);
  });

  it('dimensi skor nilai antara SKOR_PERHATIAN_MIN dan SKOR_SEHAT_MIN (8) ⇒ rekomendasi SEDANG', () => {
    const hasil = bangunLaporanInsight(dasar({
      skor: { total: 7, label: 'PERLU PERHATIAN', dimensi: [{ kode: 'video', label: 'Video / Konten', bobotDasar: 0.18, nilai: 7, disertakan: true, bobotEfektif: 0.18, labelTampil: '' }] },
    }));
    expect(hasil.rekomendasiSedang).toHaveLength(1);
    expect(hasil.rekomendasiTinggi).toEqual([]);
  });

  it('dimensi nilai >= SKOR_SEHAT_MIN ATAU disertakan:false ⇒ nol rekomendasi untuk dimensi itu', () => {
    const hasil = bangunLaporanInsight(dasar({
      skor: {
        total: 9, label: 'SEHAT',
        dimensi: [
          { kode: 'gmvmax', label: 'GMV Max Ads', bobotDasar: 0.22, nilai: 9, disertakan: true, bobotEfektif: 0.22, labelTampil: '' },
          { kode: 'live', label: 'LIVE Streaming', bobotDasar: 0.22, nilai: null, disertakan: false, bobotEfektif: 0, labelTampil: 'data tidak tersedia' },
        ],
      },
    }));
    expect(hasil.rekomendasiTinggi).toEqual([]);
    expect(hasil.rekomendasiSedang).toEqual([]);
  });

  it('poin merangkum kanal (channel terbesar) + catatan kalau kanal belum lengkap', () => {
    const hasil = bangunLaporanInsight(dasar({
      kpi: { gmv: 1_000_000, pesanan: 10, pengunjung: 500, cvr: 0.02 },
      kanal: {
        gmvTotal: 1_000_000, lengkap: false,
        items: [
          { kode: 'live', label: 'LIVE', gmv: 300_000, persen: 0.3 },
          { kode: 'kartu', label: 'Kartu Produk & Shop Tab', gmv: 700_000, persen: 0.7 },
        ],
      },
    }));
    expect(hasil.poin).toContain('Kartu Produk & Shop Tab jadi kanal terbesar: Rp. 700.000,00 (70,0% dari GMV).');
    expect(hasil.poin).toContain('Catatan: rincian kanal belum lengkap — sebagian sumber GMV belum punya penulis fakta PDT.');
  });

  it('poin merangkum iklan/live/video/afiliasi HANYA saat bagiannya ada (bukan null)', () => {
    const hasil = bangunLaporanInsight(dasar({
      kpi: { gmv: 2_000_000, pesanan: 20, pengunjung: 1_000, cvr: 0.02 },
      iklan: { biaya: 500_000, gmv: 2_000_000, roas: 4, items: [], lengkap: true },
      live: { sesi: 5, gmv: 1_000_000, vv: 10_000, jam: 10, gmvPerSesi: 200_000, gmvPerJam: 100_000 },
      video: { total: 8, gmv: 400_000, vv: 20_000, likes: 100, dibagikan: 10, klikProduk: 50, gmvPerVideo: 50_000, vvPerVideo: 2_500 },
      afiliasi: { totalKreator: 10, produktif: 4, gmv: 300_000, pesanan: 3, aov: 100_000, jumlahLive: 1, jumlahVideo: 2 },
    }));
    expect(hasil.poin).toContain('Iklan: belanja Rp. 500.000,00 → GMV Rp. 2.000.000,00 (ROAS 4,00x).');
    expect(hasil.poin).toContain('LIVE: 5 sesi/10,0 jam → Rp. 1.000.000,00 (Rp. 100.000,00/jam).');
    expect(hasil.poin).toContain('Video: 8 video → Rp. 400.000,00 dari 20.000 views (Rp. 50.000,00/video).');
    expect(hasil.poin).toContain('Afiliasi: 4 dari 10 kreator produktif, GMV Rp. 300.000,00.');
  });

  it('tahap.fokus hanya dirangkum untuk platform tiktok (Shopee selalu tahap:null, tapi guard platform tetap eksplisit)', () => {
    const tahap: PdtLaporanTahap = { fokus: 'consideration', funnel: [], konversiTotal: { nilai: null }, belanjaTotal: null, blok: [] };
    const tiktok = bangunLaporanInsight(dasar({ platform: 'tiktok', kpi: { gmv: 1, pesanan: 1, pengunjung: 1, cvr: 1 }, tahap }));
    expect(tiktok.poin).toContain('Fokus tahap buyer-journey periode ini: Consideration.');

    const shopee = bangunLaporanInsight(dasar({ platform: 'shopee', kpi: { gmv: 1, pesanan: 1, pengunjung: 1, cvr: 1 }, tahap }));
    expect(shopee.poin.some((p) => p.includes('Fokus tahap'))).toBe(false);
  });

  it('indikator TikTok memakai benchTiktok (ROAS + GMV/jam LIVE); Shopee nol bench ⇒ hanya skor total', () => {
    const skor = { total: 7, label: 'PERLU PERHATIAN' as const, dimensi: [] };
    const tiktok = bangunLaporanInsight(dasar({ kpi: { gmv: 1, pesanan: 1, pengunjung: 1, cvr: 1 }, benchTiktok: BENCH_KOSONG, skor }));
    expect(tiktok.indikator).toEqual([
      { nama: 'Target Skor Performa', target: '≥8/10 (kini 7,0/10)' },
      { nama: 'Target ROAS Iklan (GMV Max)', target: '≥8x (kini —)' },
      { nama: 'Target GMV/jam LIVE', target: 'Rp. 150.000,00+ (kini —)' },
    ]);

    const shopee = bangunLaporanInsight(dasar({ platform: 'shopee', kpi: { gmv: 1, pesanan: 1, pengunjung: 1, cvr: 1 }, benchTiktok: null, skor }));
    expect(shopee.indikator).toEqual([{ nama: 'Target Skor Performa', target: '≥8/10 (kini 7,0/10)' }]);
  });
});
