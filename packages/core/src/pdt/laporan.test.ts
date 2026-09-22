import { describe, expect, it } from 'vitest';
import {
  bangunIklanShopee,
  bangunIklanTiktok,
  bangunKanalShopee,
  bangunKanalTiktok,
  bangunKpiRingkas,
  bangunLaporanAfiliasi,
  bangunLaporanHarian,
  bangunLaporanInsight,
  bangunLaporanKelengkapan,
  bangunLaporanKampanye,
  bangunLaporanKreator,
  bangunLaporanLayanan,
  bangunLaporanLive,
  bangunLaporanProduk,
  bangunLaporanPromo,
  bangunLaporanSesiLive,
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
  type PdtLaporanKampanyeInputBaris,
  type PdtLaporanKpiInput,
  type PdtLaporanKpiRingkas,
  type PdtLaporanKreatorInputBaris,
  type PdtLaporanLiveInput,
  type PdtLaporanProdukInput,
  type PdtLaporanPromoInputBaris,
  type PdtLaporanSesiLiveInputBaris,
  type PdtLaporanTahap,
  type PdtLaporanTahapInput,
  type PdtLaporanVideo,
  type PdtLaporanVideoInput,
} from './laporan';
import { computeSkorShopee, computeSkorTiktok, type PdtSkorInputShopee, type PdtSkorInputTiktok } from './skor';

const INPUT_KOSONG_TIKTOK: PdtSkorInputTiktok = { ads: null, live: null, video: null, kartu: null, affiliate: null, produk: null };
const INPUT_KOSONG_SHOPEE: PdtSkorInputShopee = { ads: null, dibuat: null, produk: null, live: null, kesehatan: null };
const TAHAP_INPUT_KOSONG: PdtLaporanTahapInput = { tahapFokus: null, klik: null, cpaInput: null, affPosting: null, ttamFunnel: null };

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
    expect(bangunKpiRingkas(null)).toEqual({ gmv: null, pesanan: null, pengunjung: null, cvr: null, barangPerPengunjung: null, kedalaman: null });
  });

  it('membulatkan gmv/pesanan/pengunjung, cvr = pesanan/pengunjung dibulatkan 5 desimal', () => {
    const input: PdtLaporanKpiInput = { gmv: 1_234_567.8, pesanan: 40, pengunjung: 2_000, produkDiklik: null };
    expect(bangunKpiRingkas(input)).toEqual({ gmv: 1_234_568, pesanan: 40, pengunjung: 2_000, cvr: 0.02, barangPerPengunjung: null, kedalaman: null });
  });

  it('pengunjung 0 ⇒ cvr null (BUKAN pembagian oleh nol yang mengarang 0/Infinity)', () => {
    const input: PdtLaporanKpiInput = { gmv: 0, pesanan: 0, pengunjung: 0, produkDiklik: null };
    expect(bangunKpiRingkas(input).cvr).toBeNull();
  });
});

describe('kedalaman jelajah (barangPerPengunjung) — metrik NIAT, keputusan pemilik 2026-09-22', () => {
  const kpi = (pengunjung: number, produkDiklik: number | null, pesanan = 0) =>
    bangunKpiRingkas({ gmv: 1_000, pesanan, pengunjung, produkDiklik });

  it('barangPerPengunjung = produk_diklik / pengunjung, dibulatkan 2 desimal', () => {
    // Angka NYATA Fim Motor Juli 2026 pada penyebut yang laporan SUNGGUH pakai:
    // 552.545 klik produk atas 482.408 KUNJUNGAN (Σ 31 baris harian
    // `pdt_fact_shop_daily` basis siap_dikirim) = 1,15.
    expect(kpi(482_408, 552_545).barangPerPengunjung).toBe(1.15);
    // Penyebut unik-bulanan Shopee (361.197, baris ringkasan berkas — TIDAK
    // pernah disimpan sebagai fakta) memberi 1,53 atas klik yang sama. Dua
    // angka berbeda dari satu toko yang sama; ambang dikalibrasi ke yang ATAS.
    expect(kpi(361_197, 552_545).barangPerPengunjung).toBe(1.53);
  });

  it('≥1,5 ⇒ dalam; ≤1,2 ⇒ dangkal; di antaranya ⇒ sedang', () => {
    expect(kpi(100, 150).kedalaman).toBe('dalam');
    expect(kpi(100, 120).kedalaman).toBe('dangkal');
    expect(kpi(100, 130).kedalaman).toBe('sedang');
  });

  it('sebaran enam toko sample Juli 2026 jatuh ke band yang dimaksud', () => {
    // Penyebut = Σ kunjungan harian, sama dengan yang dihitung laporan.
    // Diambil dengan `scripts/pdt-kuadran-cek.ts` atas ekspor asli.
    const toko: readonly [string, number, number, string][] = [
      ['Fim Motor (Shopee)', 482_408, 552_545, 'dangkal'],
      ['Avitaskin', 20_627, 27_208, 'sedang'],
      ['Juragan Acc', 29_020, 39_036, 'sedang'],
      ['Octatrix', 96_235, 150_124, 'dalam'],
      ['Sajira', 1_295_821, 2_069_557, 'dalam'],
      ['Evebag', 15_582, 27_735, 'dalam'],
    ];
    for (const [nama, pengunjung, diklik, band] of toko) {
      expect(`${nama}: ${kpi(pengunjung, diklik).kedalaman}`).toBe(`${nama}: ${band}`);
    }
  });

  it('nol baris produk_diklik terisi ⇒ angka DAN label null — tidak ditebak "sedang"', () => {
    const k = kpi(1_000, null);
    expect(k.barangPerPengunjung).toBeNull();
    expect(k.kedalaman).toBeNull();
  });

  it('pengunjung 0 ⇒ null, bukan Infinity (aturan rumah #7)', () => {
    expect(kpi(0, 50).barangPerPengunjung).toBeNull();
  });

  it('nol baris periode ini ⇒ kedua field null', () => {
    expect(bangunKpiRingkas(null)).toMatchObject({ barangPerPengunjung: null, kedalaman: null });
  });
});

describe('bangunLaporanTiktok (sesi 34 lanjutan)', () => {
  it('merakit schema+platform+identitas+kpi+kanal+skor+benchmarkVersi', () => {
    const skor = computeSkorTiktok(INPUT_KOSONG_TIKTOK, BENCH_KOSONG);
    const hasil = bangunLaporanTiktok({
      clientPlatformId: 42,
      periodeAwalBulan: '2026-07-01',
      generatedAt: '2026-08-01T00:00:00.000Z',
      kpi: { gmv: 10_000_000, pesanan: 100, pengunjung: 5_000, produkDiklik: null },
      harian: null,
      kanal: null,
      iklan: null,
      live: null,
      video: null,
      produk: null,
      afiliasi: null,
      kreator: null,
      sesiLive: null,
      kampanye: null,
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
      kpi: { gmv: 10_000_000, pesanan: 100, pengunjung: 5_000, cvr: 0.02, barangPerPengunjung: null, kedalaman: null },
      harian: null,
      kanal: { gmvTotal: null, items: [], lengkap: true },
      iklan: null,
      live: null,
      video: null,
      produk: null,
      afiliasi: null,
      kreator: null,
      sesiLive: null,
      kampanye: null,
      promo: null,
      layanan: null,
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
          { nama: 'Target CVR Toko', target: '2,30% (kini 2,00%)' },
          { nama: 'Target GPM Video', target: 'Rp. 10.000,00+ per 1.000 views (kini —)' },
        ],
      },
      // M20 R2 — caveat kelengkapan hidup DI SINI, bukan sebagai kalimat di
      // `insight.poin`. Baris `tahap` lahir dari DATANYA (funnel ber-`nilai:
      // null`), bukan dari daftar platform yang ditulis tangan — begitu modul
      // Ads Manager mendarat, baris ini jadi `lengkap` dengan sendirinya.
      kelengkapan: {
        semuaLengkap: false,
        baris: [
          { bagian: 'kanal', lengkap: true, alasan: '', modulHilang: [] },
          {
            bagian: 'tahap',
            lengkap: false,
            alasan: 'Langkah funnel berikut belum dipanen ke fakta, jadi ditandai "—", BUKAN nol aktivitas: Impresi produk, Klik ke halaman produk, Add to Cart. Sumbernya ekspor TikTok Ads Manager, yang belum punya modul PDT.',
            modulHilang: [
              'tt_ads_manager_consideration', 'tt_ads_manager_follows',
              'tt_ads_manager_showcase', 'tt_ads_manager_videoviews',
            ],
          },
        ],
      },
    });
  });

  it('kpi null (nol baris basis net di periode ini) ⇒ bagian kpi seluruhnya null, skor tetap terisi bila ada dimensi lain', () => {
    const skor = computeSkorTiktok(INPUT_KOSONG_TIKTOK, BENCH_KOSONG);
    const hasil = bangunLaporanTiktok({
      clientPlatformId: 1, periodeAwalBulan: '2026-07-01', generatedAt: '2026-08-01T00:00:00.000Z',
      kpi: null, harian: null, kanal: null, iklan: null, live: null, video: null, produk: null, afiliasi: null, kreator: null, sesiLive: null, kampanye: null, tahap: TAHAP_INPUT_KOSONG, skor, benchmarkVersi: 1,
      benchTiktok: BENCH_KOSONG,
    });
    expect(hasil.kpi).toEqual({ gmv: null, pesanan: null, pengunjung: null, cvr: null, barangPerPengunjung: null, kedalaman: null });
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
      kpi: { gmv: 5_000_000, pesanan: 50, pengunjung: 2_500, produkDiklik: null },
      harian: null,
      kanal: null,
      iklan: null,
      live: null,
      video: null,
      produk: null,
      afiliasi: null,
      kreator: null,
      sesiLive: null,
      kampanye: null,
      promo: null,
      layanan: null,
      skor,
    });
    expect(hasil).toEqual({
      schema: 'cdps.pdt.laporan.shopee.v1',
      platform: 'shopee',
      clientPlatformId: 7,
      periodeAwalBulan: '2026-07-01',
      generatedAt: '2026-08-01T00:00:00.000Z',
      kpi: { gmv: 5_000_000, pesanan: 50, pengunjung: 2_500, cvr: 0.02, barangPerPengunjung: null, kedalaman: null },
      harian: null,
      kanal: { gmvTotal: null, items: [], lengkap: false },
      iklan: null,
      live: null,
      video: null,
      produk: null,
      afiliasi: null,
      kreator: null,
      sesiLive: null,
      kampanye: null,
      promo: null,
      layanan: null,
      tahap: null,
      skor,
      insight: {
        ringkasan: 'GMV Rp. 5.000.000,00 dari 50 pesanan. Skor performa belum bisa dihitung — belum ada dimensi yang punya data periode ini.',
        // M20 R2: `poin` kembali murni narasi performa — caveat kelengkapan
        // pindah ke blok `kelengkapan` di bawah.
        poin: ['GMV Rp. 5.000.000,00 dari 50 pesanan (CVR 2,00%).'],
        rekomendasiTinggi: [],
        rekomendasiSedang: [],
        outlook: 'Target GMV bulan depan: Rp. 5.750.000,00–Rp. 6.500.000,00 (+15–30%). Fokus: tindak lanjuti rekomendasi prioritas tinggi di atas.',
        indikator: [
          { nama: 'Target Pengunjung Toko', target: '3.375 (+35% dari 2.500)' },
          { nama: 'Target CR Toko', target: '3,00% (kini 2,00%)' },
        ],
      },
      kelengkapan: {
        semuaLengkap: false,
        baris: [
          {
            bagian: 'kanal',
            lengkap: false,
            alasan: 'Rincian kanal baru memuat Shopee Ads dan Affiliate. Voucher, Chat, Meta Ads, dan Video belum diproses PDT — GMV dari sumber itu TIDAK berarti nol, hanya belum terhitung di sini.',
            modulHilang: ['shopee_voucher', 'shopee_chat', 'meta_ads', 'shopee_video'],
          },
        ],
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
  const KPI_KOSONG: PdtLaporanKpiRingkas = { gmv: null, pesanan: null, pengunjung: null, cvr: null, barangPerPengunjung: null, kedalaman: null };
  const KPI_ISI: PdtLaporanKpiRingkas = { gmv: 10_000_000, pesanan: 100, pengunjung: 5_000, cvr: 0.02, barangPerPengunjung: null, kedalaman: null };

  it('kpi seluruhnya null (nol baris basis net) ⇒ null (whole object, BUKAN objek ber-field null)', () => {
    expect(bangunLaporanTahap(TAHAP_INPUT_KOSONG, KPI_KOSONG, null, null, null)).toBeNull();
  });

  // Tiga metrik Consideration ini DULU hardcode `null` dengan catatan "modul
  // TikTok Ads Manager belum dibangun" — keliru, dan tes ini mengunci
  // koreksinya.
  it('impresi/klik/CTR showcase terisi dari TikTok Ads Manager, bukan hardcode null', () => {
    const input: PdtLaporanTahapInput = { ...TAHAP_INPUT_KOSONG, ttamFunnel: { tayangan: 400_000, klik: 14_000 } };
    const cons = bangunLaporanTahap(input, KPI_ISI, null, null, null)?.blok.find((b) => b.kode === 'consideration');
    const m = (kode: string) => cons?.metrik.find((x) => x.kode === kode)?.nilai;
    expect(m('sc_impresi')).toBe(400_000);
    expect(m('sc_klik')).toBe(14_000);
    expect(m('sc_ctr')).toBeCloseTo(0.035, 5);
  });

  it('nol baris iklan Ads Manager ⇒ ketiganya null (tidak diketahui), BUKAN nol tayangan', () => {
    const cons = bangunLaporanTahap(TAHAP_INPUT_KOSONG, KPI_ISI, null, null, null)?.blok.find((b) => b.kode === 'consideration');
    const m = (kode: string) => cons?.metrik.find((x) => x.kode === kode)?.nilai;
    expect(m('sc_impresi')).toBeNull();
    expect(m('sc_klik')).toBeNull();
    expect(m('sc_ctr')).toBeNull();
  });

  it('CTR showcase null bila tayangan nol — pembagian nol tidak pernah jadi error/Infinity (aturan rumah #7)', () => {
    const input: PdtLaporanTahapInput = { ...TAHAP_INPUT_KOSONG, ttamFunnel: { tayangan: 0, klik: 5 } };
    const cons = bangunLaporanTahap(input, KPI_ISI, null, null, null)?.blok.find((b) => b.kode === 'consideration');
    expect(cons?.metrik.find((x) => x.kode === 'sc_ctr')?.nilai).toBeNull();
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
    const kpiNol: PdtLaporanKpiRingkas = { gmv: 0, pesanan: 0, pengunjung: 0, cvr: null, barangPerPengunjung: null, kedalaman: null };
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
    expect(bangunLaporanProduk(null, 'tiktok')).toBeNull();
  });

  it('array kosong ⇒ null (nol baris pdt_fact_sku_period periode ini)', () => {
    expect(bangunLaporanProduk([], 'tiktok')).toBeNull();
  });

  it('distribusi menghitung jumlah+Σgmv per KEENAM kuadran', () => {
    const input: PdtLaporanProdukInput = [
      { kuadran: 'bintang', namaProduk: 'A', platformProductId: '1', gmv: 100, klik: 50, traffic: 50, impresi: null, cvr: 0.1 },
      { kuadran: 'bintang', namaProduk: 'B', platformProductId: '2', gmv: 200, klik: 60, traffic: 60, impresi: null, cvr: 0.12 },
      { kuadran: 'tidur', namaProduk: 'C', platformProductId: '3', gmv: 10, klik: 2, traffic: 2, impresi: null, cvr: null },
      { kuadran: 'tidak_tayang', namaProduk: 'D', platformProductId: '4', gmv: 0, klik: 0, traffic: 0, impresi: null, cvr: null },
    ];
    const hasil = bangunLaporanProduk(input, 'tiktok');
    expect(hasil?.distribusi?.bintang).toEqual({ jumlah: 2, gmv: 300 });
    expect(hasil?.distribusi?.tidur).toEqual({ jumlah: 1, gmv: 10 });
    expect(hasil?.distribusi?.tidak_tayang).toEqual({ jumlah: 1, gmv: 0 });
    expect(hasil?.distribusi?.hidden_gem).toEqual({ jumlah: 0, gmv: null });
    expect(hasil?.distribusi?.bocor_traffic).toEqual({ jumlah: 0, gmv: null });
    expect(hasil?.distribusi?.evaluasi).toEqual({ jumlah: 0, gmv: null });
  });

  it('distribusi gmv null bila NOL baris kuadran itu punya gmv terisi (tidak diketahui, BUKAN 0)', () => {
    const input: PdtLaporanProdukInput = [
      { kuadran: 'evaluasi', namaProduk: 'A', platformProductId: '1', gmv: null, klik: 5, traffic: 5, impresi: null, cvr: 0.01 },
    ];
    expect(bangunLaporanProduk(input, 'tiktok')?.distribusi?.evaluasi).toEqual({ jumlah: 1, gmv: null });
  });

  it('topAksi HANYA bintang/bocor_traffic/hidden_gem — evaluasi/tidur/tidak_tayang dikeluarkan', () => {
    const input: PdtLaporanProdukInput = [
      { kuadran: 'bintang', namaProduk: 'Bintang', platformProductId: '1', gmv: 500, klik: 100, traffic: 100, impresi: null, cvr: 0.2 },
      { kuadran: 'bocor_traffic', namaProduk: 'Bocor', platformProductId: '2', gmv: 300, klik: 200, traffic: 200, impresi: null, cvr: 0.01 },
      { kuadran: 'hidden_gem', namaProduk: 'Gem', platformProductId: '3', gmv: 400, klik: 20, traffic: 20, impresi: null, cvr: 0.3 },
      { kuadran: 'evaluasi', namaProduk: 'Eval', platformProductId: '4', gmv: 9_000_000, klik: 5, traffic: 5, impresi: null, cvr: 0.02 },
      { kuadran: 'tidur', namaProduk: 'Tidur', platformProductId: '5', gmv: 9_000_000, klik: 2, traffic: 2, impresi: null, cvr: null },
      { kuadran: 'tidak_tayang', namaProduk: 'Nol', platformProductId: '6', gmv: 0, klik: 0, traffic: 0, impresi: null, cvr: null },
    ];
    const hasil = bangunLaporanProduk(input, 'tiktok');
    expect(hasil?.topAksi.map((x) => x.namaProduk)).toEqual(['Bintang', 'Gem', 'Bocor']); // diurutkan GMV desc
  });

  it('topAksi dipotong 12 (sama angka mesin lama), sisanya dibuang', () => {
    const input: PdtLaporanProdukInput = Array.from({ length: 20 }, (_, i) => ({
      kuadran: 'bintang' as const, namaProduk: `SKU-${i}`, platformProductId: String(i), gmv: 1_000 - i, klik: 50, traffic: 50, impresi: null, cvr: 0.1,
    }));
    const hasil = bangunLaporanProduk(input, 'tiktok');
    expect(hasil?.topAksi).toHaveLength(12);
    expect(hasil?.topAksi[0].namaProduk).toBe('SKU-0'); // GMV tertinggi
  });

  it('namaProduk null (baris lama sebelum kolom Nama dipanen) TETAP masuk topAksi', () => {
    const input: PdtLaporanProdukInput = [
      { kuadran: 'bintang', namaProduk: null, platformProductId: 'PRD-1', gmv: 100, klik: 50, traffic: 50, impresi: null, cvr: 0.1 },
    ];
    expect(bangunLaporanProduk(input, 'tiktok')?.topAksi).toEqual([
      { namaProduk: null, platformProductId: 'PRD-1', gmv: 100, klik: 50, cvr: 0.1, kuadran: 'bintang' },
    ]);
  });

  // -------------------------------------------------------------------------
  // Panel "Mode Relatif" — kedua platform, ambang percentile per periode.
  // -------------------------------------------------------------------------
  it('relatif TikTok: dua band, ambang p75 klik/CVR — bukan salinan distribusi benchmark', () => {
    const b = (i: number, klik: number, cvr: number) => ({
      kuadran: null, namaProduk: `S${i}`, platformProductId: String(i), gmv: 100, klik, traffic: klik, impresi: null, cvr,
    });
    // Empat SKU aktif: klik p75 = 325, CVR positif p75 = 0,0325.
    const hasil = bangunLaporanProduk(
      [b(1, 100, 0.01), b(2, 200, 0.02), b(3, 400, 0.03), b(4, 500, 0.04)],
      'tiktok',
    );
    expect(hasil?.distribusi).toBeNull(); // nol baris berkuadran tersimpan
    expect(hasil?.relatif?.ambang.n).toBe(4);
    expect(hasil?.relatif?.ambang.trafficTinggi).toBeCloseTo(425, 10);
    expect(hasil?.relatif?.ambang.crTinggi).toBeCloseTo(0.0325, 10);
    expect(hasil?.relatif?.distribusi.bintang.jumlah).toBe(1); // hanya SKU-4
    expect(hasil?.relatif?.distribusi.evaluasi.jumlah).toBe(3);
    expect(hasil?.relatif?.distribusi.no_data.jumlah).toBe(0); // ember Shopee, nol di TikTok
  });

  it('relatif Shopee: TIGA band — trafik medium naik ke high saat CR-nya high (perilaku yang TikTok tidak punya)', () => {
    const b = (i: number, peng: number, cr: number) => ({
      kuadran: null, namaProduk: `S${i}`, platformProductId: String(i), gmv: 100, klik: null, traffic: peng, impresi: null, cvr: cr,
    });
    // Ambang percentile: pengunjung p25/p75 = 175/475, CR p25/p75 = 0,0175/0,0475.
    // SKU-3 (300 pengunjung, CR 6%) trafiknya MEDIUM tapi CR-nya high ⇒ bintang.
    const hasil = bangunLaporanProduk(
      [b(1, 100, 0.01), b(2, 200, 0.02), b(3, 300, 0.06), b(4, 600, 0.05)],
      'shopee',
    );
    expect(hasil?.relatif?.ambang.n).toBe(4);
    expect(hasil?.relatif?.distribusi.bintang.jumlah).toBe(2); // SKU-3 (promosi medium) + SKU-4
  });

  it('relatif null bila nol baris AKTIF — percentile atas himpunan kosong bukan angka', () => {
    const hasil = bangunLaporanProduk(
      [{ kuadran: 'tidur', namaProduk: 'A', platformProductId: '1', gmv: 1, klik: 2, traffic: 2, impresi: null, cvr: null }],
      'tiktok',
    );
    expect(hasil?.relatif).toBeNull();
  });

  it('relatif Shopee memakai ambang uji 50 pengunjung (bukan 10 klik TikTok) — baris di bawahnya tidak membentuk ambang', () => {
    const b = (i: number, peng: number, cr: number) => ({
      kuadran: null, namaProduk: `S${i}`, platformProductId: String(i), gmv: 100, klik: null, traffic: peng, impresi: null, cvr: cr,
    });
    const input = [b(1, 20, 0.5), b(2, 100, 0.01), b(3, 200, 0.02)];
    expect(bangunLaporanProduk(input, 'shopee')?.relatif?.ambang.n).toBe(2);
    expect(bangunLaporanProduk(input, 'tiktok')?.relatif?.ambang.n).toBe(3);
  });

  it('baris kuadran null (belum sempat diklasifikasi) dikeluarkan dari distribusi+topAksi, bukan dipaksa masuk bucket', () => {
    const input: PdtLaporanProdukInput = [
      { kuadran: null, namaProduk: 'Belum', platformProductId: '1', gmv: 100, klik: 50, traffic: 50, impresi: null, cvr: 0.1 },
      { kuadran: 'bintang', namaProduk: 'Sudah', platformProductId: '2', gmv: 200, klik: 60, traffic: 60, impresi: null, cvr: 0.2 },
    ];
    const hasil = bangunLaporanProduk(input, 'tiktok');
    expect(hasil?.topAksi).toHaveLength(1);
    expect(hasil?.topAksi[0].namaProduk).toBe('Sudah');
    expect(hasil?.distribusi?.bintang.jumlah).toBe(1);
  });
});

describe('bangunLaporanInsight (G2-01 lanjutan — bagian "insight", 2026-09-16, SATU bentuk TikTok+Shopee)', () => {
  const KANAL_KOSONG: PdtLaporanKanal = { gmvTotal: null, items: [], lengkap: true };
  const KPI_KOSONG: PdtLaporanKpiRingkas = { gmv: null, pesanan: null, pengunjung: null, cvr: null, barangPerPengunjung: null, kedalaman: null };

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

  // Kedalaman jelajah dibaca BERSAMA CVR — empat kombinasi menunjuk empat
  // tindakan yang berbeda. Inti keputusan pemilik 2026-09-22.
  const kpiDepth = (barang: number | null, cvr: number | null): PdtLaporanKpiRingkas =>
    bangunKpiRingkas(barang == null ? { gmv: 1_000, pesanan: 0, pengunjung: 1_000, produkDiklik: null }
      : { gmv: 1_000, pesanan: Math.round((cvr ?? 0) * 1_000), pengunjung: 1_000, produkDiklik: Math.round(barang * 1_000) });

  it('jelajah DALAM + CVR rendah ⇒ menunjuk PRODUK/HARGA, dan melarang menambah budget iklan', () => {
    const poin = bangunLaporanInsight(dasar({ kpi: kpiDepth(1.8, 0.005) })).poin;
    const baris = poin.find((x) => x.includes('barang rata-rata'));
    expect(baris).toContain('PRODUK/HARGA');
    expect(baris).toContain('membakar trafik yang sudah benar');
  });

  it('jelajah DALAM + CVR sehat ⇒ dibaca sebagai pola sehat, bukan masalah', () => {
    const baris = bangunLaporanInsight(dasar({ kpi: kpiDepth(1.8, 0.03) })).poin.find((x) => x.includes('barang rata-rata'));
    expect(baris).toContain('jangan diutak-atik');
  });

  it('jelajah DANGKAL + CVR rendah ⇒ menunjuk TARGETING, bukan halaman produk', () => {
    const baris = bangunLaporanInsight(dasar({ kpi: kpiDepth(1.05, 0.005) })).poin.find((x) => x.includes('barang rata-rata'));
    expect(baris).toContain('targeting');
    expect(baris).toContain('bukan halaman produknya');
  });

  it('jelajah DANGKAL + CVR sehat ⇒ menunjuk peluang basket, bukan masalah trafik', () => {
    const baris = bangunLaporanInsight(dasar({ kpi: kpiDepth(1.05, 0.03) })).poin.find((x) => x.includes('barang rata-rata'));
    expect(baris).toContain('nilai keranjang');
  });

  it('barangPerPengunjung null (TikTok) ⇒ NOL kalimat kedalaman, bukan kalimat separuh fakta', () => {
    const poin = bangunLaporanInsight(dasar({ kpi: kpiDepth(null, null) })).poin;
    expect(poin.some((x) => x.includes('barang rata-rata'))).toBe(false);
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

  it('poin merangkum kanal (channel terbesar) dan TIDAK lagi membawa caveat kelengkapan (M20 R2)', () => {
    const hasil = bangunLaporanInsight(dasar({
      kpi: { gmv: 1_000_000, pesanan: 10, pengunjung: 500, cvr: 0.02, barangPerPengunjung: null, kedalaman: null },
      kanal: {
        gmvTotal: 1_000_000, lengkap: false,
        items: [
          { kode: 'live', label: 'LIVE', gmv: 300_000, persen: 0.3 },
          { kode: 'kartu', label: 'Kartu Produk & Shop Tab', gmv: 700_000, persen: 0.7 },
        ],
      },
    }));
    expect(hasil.poin).toContain('Kartu Produk & Shop Tab jadi kanal terbesar: Rp. 700.000,00 (70,0% dari GMV).');
    // M20 R2 — `insight` ikut BEKU ke `pdt_laporan_kiriman.payload`, jadi caveat
    // yang duduk di sini akan terbit ke klien begitu permukaan klien dibangun.
    // Ia pindah ke blok `kelengkapan`, yang mode render `klien` tidak bangun.
    expect(hasil.poin.some((t) => /belum lengkap/i.test(t))).toBe(false);
    expect(hasil.poin.some((t) => t.startsWith('Catatan:'))).toBe(false);
  });

  it('poin merangkum iklan/live/video/afiliasi HANYA saat bagiannya ada (bukan null)', () => {
    const hasil = bangunLaporanInsight(dasar({
      kpi: { gmv: 2_000_000, pesanan: 20, pengunjung: 1_000, cvr: 0.02, barangPerPengunjung: null, kedalaman: null },
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
    const tiktok = bangunLaporanInsight(dasar({ platform: 'tiktok', kpi: { gmv: 1, pesanan: 1, pengunjung: 1, cvr: 1, barangPerPengunjung: null, kedalaman: null }, tahap }));
    expect(tiktok.poin).toContain('Fokus tahap buyer-journey periode ini: Consideration.');

    const shopee = bangunLaporanInsight(dasar({ platform: 'shopee', kpi: { gmv: 1, pesanan: 1, pengunjung: 1, cvr: 1, barangPerPengunjung: null, kedalaman: null }, tahap }));
    expect(shopee.poin.some((p) => p.includes('Fokus tahap'))).toBe(false);
  });

  it('indikator TikTok EMPAT dari benchTiktok (ROAS, GMV/jam LIVE, CVR toko, GPM video) — cermin `leading` mesin lama', () => {
    const skor = { total: 7, label: 'PERLU PERHATIAN' as const, dimensi: [] };
    const tiktok = bangunLaporanInsight(dasar({ kpi: { gmv: 1, pesanan: 1, pengunjung: 1, cvr: 1, barangPerPengunjung: null, kedalaman: null }, benchTiktok: BENCH_KOSONG, skor }));
    expect(tiktok.indikator).toEqual([
      { nama: 'Target Skor Performa', target: '≥8/10 (kini 7,0/10)' },
      { nama: 'Target ROAS Iklan (GMV Max)', target: '≥8x (kini —)' },
      { nama: 'Target GMV/jam LIVE', target: 'Rp. 150.000,00+ (kini —)' },
      { nama: 'Target CVR Toko', target: '100,30% (kini 100,00%)' },
      { nama: 'Target GPM Video', target: 'Rp. 10.000,00+ per 1.000 views (kini —)' },
    ]);
  });

  it('target CVR toko = max(bench.warn, cvr+0,003) — toko YANG SUDAH di atas ambang tetap diberi target naik', () => {
    const skor = { total: 7, label: 'PERLU PERHATIAN' as const, dimensi: [] };
    // cvr 0,002 ADA DI BAWAH cvr_toko.warn (0,008) ⇒ targetnya ambang bench, bukan 0,005.
    const rendah = bangunLaporanInsight(dasar({ kpi: { gmv: 1, pesanan: 1, pengunjung: 1, cvr: 0.002, barangPerPengunjung: null, kedalaman: null }, benchTiktok: BENCH_KOSONG, skor }));
    expect(rendah.indikator.find((i) => i.nama === 'Target CVR Toko')?.target).toBe('0,80% (kini 0,20%)');
    // cvr 0,02 SUDAH di atas ambang ⇒ targetnya cvr+0,003, bukan ambang yang sudah dilewati.
    const tinggi = bangunLaporanInsight(dasar({ kpi: { gmv: 1, pesanan: 1, pengunjung: 1, cvr: 0.02, barangPerPengunjung: null, kedalaman: null }, benchTiktok: BENCH_KOSONG, skor }));
    expect(tinggi.indikator.find((i) => i.nama === 'Target CVR Toko')?.target).toBe('2,30% (kini 2,00%)');
  });

  it('indikator Shopee: pengunjung +35% dan CR +1 poin persen (pengali SAMA mesin lama), nol bench sama sekali', () => {
    const skor = { total: 7, label: 'PERLU PERHATIAN' as const, dimensi: [] };
    const shopee = bangunLaporanInsight(dasar({ platform: 'shopee', kpi: { gmv: 1, pesanan: 1, pengunjung: 2_000, cvr: 0.02, barangPerPengunjung: null, kedalaman: null }, benchTiktok: null, skor }));
    expect(shopee.indikator).toEqual([
      { nama: 'Target Skor Performa', target: '≥8/10 (kini 7,0/10)' },
      { nama: 'Target Pengunjung Toko', target: '2.700 (+35% dari 2.000)' },
      { nama: 'Target CR Toko', target: '3,00% (kini 2,00%)' },
    ]);
  });

  it('Shopee nol iklan ⇒ NOL indikator ROAS — mesin lama mengarang baseline 5x untuk toko yang tidak beriklan', () => {
    const skor = { total: 7, label: 'PERLU PERHATIAN' as const, dimensi: [] };
    const tanpaIklan = bangunLaporanInsight(dasar({ platform: 'shopee', kpi: { gmv: 1, pesanan: 1, pengunjung: 1, cvr: null, barangPerPengunjung: null, kedalaman: null }, benchTiktok: null, skor, iklan: null }));
    expect(tanpaIklan.indikator.some((i) => i.nama === 'Target ROAS Iklan')).toBe(false);

    const berIklan = bangunLaporanInsight(dasar({
      platform: 'shopee', kpi: { gmv: 1, pesanan: 1, pengunjung: 1, cvr: null, barangPerPengunjung: null, kedalaman: null }, benchTiktok: null, skor,
      iklan: { biaya: 1_000_000, gmv: 4_000_000, roas: 4, items: [], lengkap: false },
    }));
    expect(berIklan.indikator.find((i) => i.nama === 'Target ROAS Iklan')?.target).toBe('>6,0x (kini 4,00x)');
  });
});

// ---------------------------------------------------------------------------
// Bagian "harian" (tren GMV per hari) — §2 di KEDUA laporan HTML lama, bagian
// terakhir dari keduanya yang PDT belum punya (feedback pemilik 2026-09-21).
// ---------------------------------------------------------------------------
describe('bangunLaporanHarian', () => {
  const hari = (tanggal: string, gmv: number | null, pesanan: number | null = null, pengunjung: number | null = null) =>
    ({ tanggal, gmv, pesanan, pengunjung });

  it('nol baris ⇒ null (bukan objek kosong yang menggambar grafik hampa)', () => {
    expect(bangunLaporanHarian(null)).toBeNull();
    expect(bangunLaporanHarian([])).toBeNull();
  });

  it('mengurutkan titik menaik per tanggal apa pun urutan masukannya', () => {
    const h = bangunLaporanHarian([hari('2026-07-03', 300), hari('2026-07-01', 100), hari('2026-07-02', 200)]);
    expect(h?.titik.map((t) => t.tanggal)).toEqual(['2026-07-01', '2026-07-02', '2026-07-03']);
  });

  it('hari yang TIDAK ada barisnya tidak diisi nol — `hariTerisi` menyebut cakupan sebenarnya (Rule 12)', () => {
    // Tiga baris di bulan 31 hari: grafiknya memang berlubang, dan itu informasi.
    const h = bangunLaporanHarian([hari('2026-07-01', 100), hari('2026-07-15', 200), hari('2026-07-31', 300)]);
    expect(h?.hariTerisi).toBe(3);
    expect(h?.titik).toHaveLength(3);
    expect(h?.titik.map((t) => t.tanggal)).not.toContain('2026-07-02');
  });

  it('cvr per hari = pesanan ÷ pengunjung hari itu; pengunjung 0/tidak diketahui ⇒ null, bukan galat', () => {
    const h = bangunLaporanHarian([
      hari('2026-07-01', 100, 10, 500),
      hari('2026-07-02', 100, 10, 0),
      hari('2026-07-03', 100, 10, null),
    ]);
    expect(h?.titik[0].cvr).toBe(0.02);
    expect(h?.titik[1].cvr).toBeNull();
    expect(h?.titik[2].cvr).toBeNull();
  });

  it('tertinggi/terendah/rata-rata dihitung HANYA atas hari yang GMV-nya diketahui', () => {
    const h = bangunLaporanHarian([
      hari('2026-07-01', 100), hari('2026-07-02', null), hari('2026-07-03', 500), hari('2026-07-04', 300),
    ]);
    expect(h?.gmvTertinggi?.tanggal).toBe('2026-07-03');
    expect(h?.gmvTerendah?.tanggal).toBe('2026-07-01');
    // (100+500+300)/3 = 300 — hari ber-GMV null TIDAK ikut jadi penyebut.
    expect(h?.gmvRataHarian).toBe(300);
    // ...tapi ia tetap muncul sebagai titik, supaya lubangnya terlihat di grafik.
    expect(h?.hariTerisi).toBe(4);
  });

  it('seluruh GMV null ⇒ tertinggi/terendah/rata-rata null, titik tetap ada', () => {
    const h = bangunLaporanHarian([hari('2026-07-01', null), hari('2026-07-02', null)]);
    expect(h?.gmvTertinggi).toBeNull();
    expect(h?.gmvTerendah).toBeNull();
    expect(h?.gmvRataHarian).toBeNull();
    expect(h?.hariTerisi).toBe(2);
  });

  it('Σ titik[].gmv === kpi.gmv — keduanya membaca baris yang sama dengan basis yang sama', () => {
    const baris = [hari('2026-07-01', 1_000_000, 10, 100), hari('2026-07-02', 2_500_000, 20, 200)];
    const h = bangunLaporanHarian(baris);
    const kpi = bangunKpiRingkas({ gmv: 3_500_000, pesanan: 30, pengunjung: 300, produkDiklik: null });
    expect(h?.titik.reduce((a, t) => a + (t.gmv ?? 0), 0)).toBe(kpi.gmv);
  });
});

// ---------------------------------------------------------------------------
// Bagian-bagian yang melengkapi laporan ke paritas mesin HTML lama (2026-09-21,
// permintaan pemilik "buat semua bagian yg blm ada, supaya hasil akhir sama
// dengan html lama"): promo (§8 Shopee), layanan (§9 Shopee), kreator (Top 10
// Creator), sesiLive (Top 10 Sesi), kampanye (Per Kampanye).
// ---------------------------------------------------------------------------

describe('bangunLaporanPromo (§8 mesin Shopee lama)', () => {
  const diskonSemua: PdtLaporanPromoInputBaris = {
    jenis: 'diskon', tipePromosi: 'Semua',
    penjualanDibuat: 10_000_000, penjualanSiapDikirim: 8_000_000,
    pesananDibuat: 200, pesananSiapDikirim: 160,
    produkDilihat: null, produkDiklik: null,
  };
  const diskonKomponen: PdtLaporanPromoInputBaris = {
    ...diskonSemua, tipePromosi: 'Paket Diskon',
    penjualanDibuat: 6_000_000, penjualanSiapDikirim: 5_000_000, pesananDibuat: 120, pesananSiapDikirim: 100,
  };
  const diskonKombo: PdtLaporanPromoInputBaris = {
    ...diskonSemua, tipePromosi: 'Kombo Hemat',
    penjualanDibuat: 7_000_000, penjualanSiapDikirim: 6_000_000, pesananDibuat: 140, pesananSiapDikirim: 110,
  };

  it('input null / array kosong ⇒ null (whole object)', () => {
    expect(bangunLaporanPromo(null, 100)).toBeNull();
    expect(bangunLaporanPromo([], 100)).toBeNull();
  });

  // Inti bagian ini: baris 'Semua' adalah TOTAL yang sudah di-dedup Shopee,
  // komponen boleh tumpang tindih. Menjumlah komponen = dobel hitung.
  it("baris 'Semua' jadi diskonTotal dan TIDAK ikut diskonPerTipe", () => {
    const h = bangunLaporanPromo([diskonSemua, diskonKomponen, diskonKombo], null);
    expect(h?.diskonTotal).toEqual({
      penjualanDibuat: 10_000_000, penjualanSiapDikirim: 8_000_000, pesananDibuat: 200, pesananSiapDikirim: 160,
    });
    expect(h?.diskonPerTipe.map((t) => t.tipe)).toEqual(['Kombo Hemat', 'Paket Diskon']); // urut penjualan desc
    // Σ komponen (11 jt) > total (8 jt) — justru itulah alasan keduanya dipisah.
    expect(h?.diskonPerTipe.reduce((a, t) => a + (t.penjualanSiapDikirim ?? 0), 0)).toBe(11_000_000);
  });

  it("'semua' dikenali tanpa peduli huruf besar/kecil dan spasi di tepi", () => {
    const h = bangunLaporanPromo([{ ...diskonSemua, tipePromosi: '  SEMUA ' }], null);
    expect(h?.diskonTotal?.penjualanSiapDikirim).toBe(8_000_000);
    expect(h?.diskonPerTipe).toEqual([]);
  });

  it("nol baris 'Semua' ⇒ diskonTotal null — TIDAK dijumlah dari komponen yang tumpang tindih", () => {
    const h = bangunLaporanPromo([diskonKomponen, diskonKombo], 100_000_000);
    expect(h?.diskonTotal).toBeNull();
    expect(h?.kontribusiGmvDiskon).toBeNull();
    expect(h?.diskonPerTipe).toHaveLength(2);
  });

  it('flash sale membawa funnel tampilan + ctr/cvr TURUNAN', () => {
    const h = bangunLaporanPromo([{
      jenis: 'flash_sale', tipePromosi: null,
      penjualanDibuat: 4_000_000, penjualanSiapDikirim: 3_000_000,
      pesananDibuat: 100, pesananSiapDikirim: 75,
      produkDilihat: 10_000, produkDiklik: 500,
    }], null);
    expect(h?.flashSale?.ctr).toBe(0.05);
    expect(h?.flashSale?.cvr).toBe(0.15);
    expect(h?.flashSale?.penjualanSiapDikirim).toBe(3_000_000);
  });

  it('produkDilihat 0 ⇒ ctr null (BUKAN pembagian oleh nol), produkDiklik 0 ⇒ cvr null', () => {
    const h = bangunLaporanPromo([{
      jenis: 'flash_sale', tipePromosi: null,
      penjualanDibuat: null, penjualanSiapDikirim: null, pesananDibuat: null, pesananSiapDikirim: 10,
      produkDilihat: 0, produkDiklik: 0,
    }], null);
    expect(h?.flashSale?.ctr).toBeNull();
    expect(h?.flashSale?.cvr).toBeNull();
  });

  it('kontribusi diskon dan flash sale DIPISAH — satu produk bisa ikut keduanya, menjumlahnya dobel hitung', () => {
    const h = bangunLaporanPromo([diskonSemua, {
      jenis: 'flash_sale', tipePromosi: null,
      penjualanDibuat: null, penjualanSiapDikirim: 2_000_000, pesananDibuat: null, pesananSiapDikirim: null,
      produkDilihat: null, produkDiklik: null,
    }], 40_000_000);
    expect(h?.kontribusiGmvDiskon).toBe(0.2);
    expect(h?.kontribusiGmvFlashSale).toBe(0.05);
  });

  it('gmv toko null/0 ⇒ kedua kontribusi null (aturan rumah #7, bukan Infinity)', () => {
    expect(bangunLaporanPromo([diskonSemua], null)?.kontribusiGmvDiskon).toBeNull();
    expect(bangunLaporanPromo([diskonSemua], 0)?.kontribusiGmvDiskon).toBeNull();
  });
});

describe('bangunLaporanLayanan (§9 mesin Shopee lama)', () => {
  const chat = {
    barisSumber: 1, pengunjung: 5_000, chatMasuk: 400, chatDibalas: 380,
    waktuResponDetik: 1_800, csatPersen: 92.5, totalPesanan: 60, penjualan: 12_000_000,
    tingkatKonversiChatDibalasPersen: 15.8,
  };

  it('null / nol chat DAN nol penalti ⇒ null (whole object)', () => {
    expect(bangunLaporanLayanan(null)).toBeNull();
    expect(bangunLaporanLayanan({ chat: null, penalti: [] })).toBeNull();
  });

  it('responseRate DITURUNKAN chatDibalas ÷ chatMasuk, bukan dibaca kolom konversi', () => {
    const h = bangunLaporanLayanan({ chat, penalti: [] });
    expect(h?.chat?.responseRate).toBe(0.95);
    expect(h?.chat?.konversiChatDibalas).toBe(0.158); // kolom BERBEDA, bukan pengganti
  });

  it('kolom "%" sumber dinormalkan jadi PECAHAN sekali di sini — FE punya satu aturan format', () => {
    const h = bangunLaporanLayanan({ chat, penalti: [] });
    expect(h?.chat?.csat).toBe(0.925);
  });

  it('chatMasuk 0 ⇒ responseRate null (bukan 0/0)', () => {
    const h = bangunLaporanLayanan({ chat: { ...chat, chatMasuk: 0, chatDibalas: 0 }, penalti: [] });
    expect(h?.chat?.responseRate).toBeNull();
  });

  it('penalti diurutkan poin desc dan poinPenaltiTotal = Σ poin', () => {
    const h = bangunLaporanLayanan({
      chat: null,
      penalti: [
        { poin: 1, deskripsi: 'Keterlambatan kirim', durasi: '30 hari' },
        { poin: 3, deskripsi: 'Produk dilarang', durasi: '90 hari' },
        { poin: 2, deskripsi: 'Pesanan tidak terkirim', durasi: '60 hari' },
      ],
    });
    expect(h?.penalti.map((p) => p.poin)).toEqual([3, 2, 1]);
    expect(h?.poinPenaltiTotal).toBe(6);
    expect(h?.chat).toBeNull();
  });

  it('nol penalti ⇒ poinPenaltiTotal null (tidak diketahui), BUKAN 0 yang mengarang "toko bersih"', () => {
    const h = bangunLaporanLayanan({ chat, penalti: [] });
    expect(h?.poinPenaltiTotal).toBeNull();
    expect(h?.penalti).toEqual([]);
  });

  it('baris penalti berpoin 0 ⇒ total 0 — toko SUNGGUH bersih, beda dari nol baris', () => {
    const h = bangunLaporanLayanan({ chat: null, penalti: [{ poin: 0, deskripsi: 'Tidak ada penalti', durasi: '' }] });
    expect(h?.poinPenaltiTotal).toBe(0);
  });
});

describe('bangunLaporanKreator (Top 10 Creator)', () => {
  const kr = (handle: string, gmv: number | null, pesanan: number | null = null): PdtLaporanKreatorInputBaris => ({
    handle, gmv, gmvLive: null, gmvVideo: null, pesanan, jumlahLive: null, jumlahVideo: null,
  });

  it('null / array kosong ⇒ null (whole object)', () => {
    expect(bangunLaporanKreator(null)).toBeNull();
    expect(bangunLaporanKreator([])).toBeNull();
  });

  it('diurutkan GMV desc dan dipotong 10, totalKreator TETAP menyebut jumlah sebenarnya', () => {
    const input = Array.from({ length: 25 }, (_, i) => kr(`kreator-${i}`, 1_000 - i));
    const h = bangunLaporanKreator(input);
    expect(h?.top).toHaveLength(10);
    expect(h?.top[0].handle).toBe('kreator-0');
    expect(h?.totalKreator).toBe(25);
  });

  it('aov DITURUNKAN Σgmv ÷ Σpesanan per kreator; pesanan 0 ⇒ null', () => {
    const h = bangunLaporanKreator([kr('a', 1_000_000, 20), kr('b', 500_000, 0)]);
    expect(h?.top[0].aov).toBe(50_000);
    expect(h?.top[1].aov).toBeNull();
  });

  it('kontribusiTop = Σgmv top ÷ Σgmv SELURUH kreator', () => {
    const input = [kr('a', 600), kr('b', 300), ...Array.from({ length: 12 }, (_, i) => kr(`kecil-${i}`, 25))];
    const h = bangunLaporanKreator(input);
    // 10 teratas = 600 + 300 + 8×25 = 1.100; seluruhnya = 600 + 300 + 12×25 = 1.200
    expect(h?.kontribusiTop).toBeCloseTo(1_100 / 1_200, 5);
  });

  it('nol kreator ber-gmv ⇒ kontribusiTop null (tidak diketahui, bukan 0)', () => {
    const h = bangunLaporanKreator([kr('a', null), kr('b', null)]);
    expect(h?.kontribusiTop).toBeNull();
    expect(h?.top).toHaveLength(2);
  });
});

describe('bangunLaporanSesiLive (Top 10 Sesi)', () => {
  const sesi = (id: string, gmv: number | null, durasiDetik: number | null): PdtLaporanSesiLiveInputBaris => ({
    platformContentId: id, creatorHandle: null, akunToko: true, waktuPosting: null,
    durasiDetik, vv: null, gmv, pengikutBaru: null, klikProduk: null,
  });

  it('null / array kosong ⇒ null (whole object)', () => {
    expect(bangunLaporanSesiLive(null)).toBeNull();
    expect(bangunLaporanSesiLive([])).toBeNull();
  });

  it('gmvPerJam DITURUNKAN dari durasiDetik', () => {
    const h = bangunLaporanSesiLive([sesi('L1', 3_000_000, 7_200)]); // 2 jam
    expect(h?.top[0].gmvPerJam).toBe(1_500_000);
  });

  // Seluruh baris LIVE Shopee: kolom durasi tidak ada di sumbernya.
  it('durasiDetik null (Shopee) ⇒ gmvPerJam null, sesi TETAP tampil', () => {
    const h = bangunLaporanSesiLive([sesi('L1', 3_000_000, null)]);
    expect(h?.top[0].gmvPerJam).toBeNull();
    expect(h?.top[0].gmv).toBe(3_000_000);
  });

  it('durasiDetik 0 ⇒ gmvPerJam null (bukan pembagian oleh nol)', () => {
    expect(bangunLaporanSesiLive([sesi('L1', 1_000, 0)])?.top[0].gmvPerJam).toBeNull();
  });

  it('diurutkan GMV desc, dipotong 10, totalSesi menyebut jumlah sebenarnya', () => {
    const input = Array.from({ length: 14 }, (_, i) => sesi(`L${i}`, 100 - i, 3_600));
    const h = bangunLaporanSesiLive(input);
    expect(h?.top).toHaveLength(10);
    expect(h?.top[0].platformContentId).toBe('L0');
    expect(h?.totalSesi).toBe(14);
  });

  it('akunToko dibawa apa adanya — sesi afiliasi yang menang besar berarti hal lain dari sesi toko', () => {
    const h = bangunLaporanSesiLive([{ ...sesi('L1', 10, 3_600), akunToko: false, creatorHandle: '@mitra' }]);
    expect(h?.top[0].akunToko).toBe(false);
    expect(h?.top[0].creatorHandle).toBe('@mitra');
  });
});

describe('bangunLaporanKampanye (Per Kampanye)', () => {
  const kmp = (id: string, biaya: number, gmv: number | null): PdtLaporanKampanyeInputBaris => ({
    sumber: 'tt_ads_product', kampanyeId: id, biaya, gmv, tayangan: null, klik: null, pesanan: null,
  });

  it('null / array kosong ⇒ null (whole object)', () => {
    expect(bangunLaporanKampanye(null)).toBeNull();
    expect(bangunLaporanKampanye([])).toBeNull();
  });

  it('diurutkan BIAYA desc — yang paling banyak membakar anggaran dibaca lebih dulu', () => {
    const h = bangunLaporanKampanye([kmp('kecil', 100, 9_000_000), kmp('besar', 5_000_000, 100)]);
    expect(h?.top.map((k) => k.kampanyeId)).toEqual(['besar', 'kecil']);
  });

  it('roas DITURUNKAN gmv ÷ biaya (aturan rumah #4), biaya 0 ⇒ null', () => {
    const h = bangunLaporanKampanye([kmp('a', 1_000_000, 4_500_000), kmp('b', 0, 1_000)]);
    expect(h?.top.find((k) => k.kampanyeId === 'a')?.roas).toBe(4.5);
    expect(h?.top.find((k) => k.kampanyeId === 'b')?.roas).toBeNull();
  });

  it('ctr dan cpc turunan; tayangan/klik 0 atau null ⇒ null', () => {
    const h = bangunLaporanKampanye([
      { sumber: 'shopee_ads_cpc', kampanyeId: 'a', biaya: 500_000, gmv: 1_000_000, tayangan: 100_000, klik: 2_000, pesanan: 40 },
      { sumber: 'shopee_ads_cpc', kampanyeId: 'b', biaya: 100, gmv: null, tayangan: 0, klik: 0, pesanan: null },
    ]);
    const a = h?.top.find((k) => k.kampanyeId === 'a');
    expect(a?.ctr).toBe(0.02);
    expect(a?.cpc).toBe(250);
    const b = h?.top.find((k) => k.kampanyeId === 'b');
    expect(b?.ctr).toBeNull();
    expect(b?.cpc).toBeNull();
  });

  it('tanpaHasil menghitung kampanye berbiaya yang GMV-nya ≤ 0 ATAU tidak diketahui', () => {
    const h = bangunLaporanKampanye([
      kmp('untung', 1_000_000, 5_000_000),
      kmp('nol', 300_000, 0),
      kmp('tak-diketahui', 200_000, null),
      kmp('gratis', 0, null), // biaya 0 ⇒ tidak membakar apa pun, bukan "tanpa hasil"
    ]);
    expect(h?.tanpaHasil).toBe(2);
    expect(h?.biayaTanpaHasil).toBe(500_000);
    expect(h?.totalKampanye).toBe(4);
  });

  it('nol kampanye tanpa hasil ⇒ biayaTanpaHasil null, bukan 0', () => {
    const h = bangunLaporanKampanye([kmp('a', 1_000, 9_000)]);
    expect(h?.tanpaHasil).toBe(0);
    expect(h?.biayaTanpaHasil).toBeNull();
  });

  it('dipotong 15, totalKampanye TETAP menyebut jumlah sebenarnya', () => {
    const h = bangunLaporanKampanye(Array.from({ length: 30 }, (_, i) => kmp(`k${i}`, 1_000 - i, 1)));
    expect(h?.top).toHaveLength(15);
    expect(h?.totalKampanye).toBe(30);
  });
});

describe('bangunLaporanProduk — "top" lintas kuadran (Top Produk by GMV, kedua platform)', () => {
  it('top memuat SELURUH produk diurut GMV desc, termasuk kuadran yang dikeluarkan topAksi', () => {
    const input: PdtLaporanProdukInput = [
      { kuadran: 'bintang', namaProduk: 'Bintang', platformProductId: '1', gmv: 500, klik: 100, traffic: 100, impresi: null, cvr: 0.2 },
      { kuadran: 'evaluasi', namaProduk: 'Eval', platformProductId: '2', gmv: 9_000, klik: 5, traffic: 5, impresi: null, cvr: 0.02 },
    ];
    const h = bangunLaporanProduk(input, 'tiktok');
    expect(h?.top.map((x) => x.namaProduk)).toEqual(['Eval', 'Bintang']);
    expect(h?.topAksi.map((x) => x.namaProduk)).toEqual(['Bintang']); // topAksi TIDAK berubah perilakunya
  });

  // Inilah yang membuat bagian "produk" akhirnya terisi sisi Shopee.
  it('SELURUH baris berkuadran null (kasus Shopee) ⇒ distribusi null tapi top TETAP terisi', () => {
    const input: PdtLaporanProdukInput = [
      { kuadran: null, namaProduk: 'S1', platformProductId: '1', gmv: 300, klik: 10, traffic: 10, impresi: null, cvr: 0.05 },
      { kuadran: null, namaProduk: 'S2', platformProductId: '2', gmv: 900, klik: 40, traffic: 40, impresi: null, cvr: 0.03 },
    ];
    const h = bangunLaporanProduk(input, 'tiktok');
    expect(h?.distribusi).toBeNull();
    expect(h?.topAksi).toEqual([]);
    expect(h?.top.map((x) => x.namaProduk)).toEqual(['S2', 'S1']);
    expect(h?.top[0].kuadran).toBeNull();
  });

  it('top dipotong 12, sama angka topAksi/mesin lama', () => {
    const input: PdtLaporanProdukInput = Array.from({ length: 18 }, (_, i) => ({
      kuadran: null, namaProduk: `P-${i}`, platformProductId: String(i), gmv: 1_000 - i, klik: null, traffic: null, impresi: null, cvr: null,
    }));
    expect(bangunLaporanProduk(input, 'tiktok')?.top).toHaveLength(12);
  });
});

describe('bangunLaporanKelengkapan (M20 R2 — caveat sebagai DATA, bukan prosa)', () => {
  const kanalLengkap = { gmvTotal: 1_000_000, items: [], lengkap: true };
  const kanalBolong = { gmvTotal: 1_000_000, items: [], lengkap: false };

  it('semua bagian lengkap ⇒ semuaLengkap true, dan tiap baris NOL kalimat untuk dibaca', () => {
    const hasil = bangunLaporanKelengkapan({ platform: 'tiktok', kanal: kanalLengkap, iklan: null, tahap: null });
    expect(hasil.semuaLengkap).toBe(true);
    expect(hasil.baris).toEqual([{ bagian: 'kanal', lengkap: true, alasan: '', modulHilang: [] }]);
  });

  it('kanal Shopee belum lengkap ⇒ alasan menyebut sumber yang hilang + modulHilang terisi', () => {
    const hasil = bangunLaporanKelengkapan({ platform: 'shopee', kanal: kanalBolong, iklan: null, tahap: null });
    const kanal = hasil.baris.find((b) => b.bagian === 'kanal');
    expect(hasil.semuaLengkap).toBe(false);
    expect(kanal?.lengkap).toBe(false);
    expect(kanal?.modulHilang).toEqual(['shopee_voucher', 'shopee_chat', 'meta_ads', 'shopee_video']);
    // Rule 12 ditegakkan DI DALAM kalimatnya: "belum terhitung" bukan "nol".
    expect(kanal?.alasan).toContain('TIDAK berarti nol');
  });

  it('iklan null (nol baris periode ini) ⇒ NOL baris iklan — bagian yang tidak ada tidak punya kelengkapan', () => {
    const hasil = bangunLaporanKelengkapan({ platform: 'shopee', kanal: kanalLengkap, iklan: null, tahap: null });
    expect(hasil.baris.some((b) => b.bagian === 'iklan')).toBe(false);
  });

  it('status tahap lahir dari DATANYA: funnel penuh ⇒ lengkap, walau modul Ads Manager belum ada', () => {
    const tahapPenuh = {
      fokus: null,
      belanjaTotal: null,
      konversiTotal: { nilai: null, band: null, flag: 'kosong' as const },
      funnel: [
        { kode: 'impresi', label: 'Impresi produk', nilai: 1_000, lolos: null, lolosDari: null, catatan: null },
        { kode: 'klik', label: 'Klik ke halaman produk', nilai: 100, lolos: null, lolosDari: null, catatan: null },
      ],
      blok: [],
    };
    const hasil = bangunLaporanKelengkapan({ platform: 'tiktok', kanal: kanalLengkap, iklan: null, tahap: tahapPenuh as never });
    expect(hasil.baris.find((b) => b.bagian === 'tahap')).toEqual({
      bagian: 'tahap', lengkap: true, alasan: '', modulHilang: [],
    });
  });

  it('tahap ber-langkah null ⇒ alasan MENYEBUT langkah mana yang kosong, bukan kalimat umum', () => {
    const tahapBolong = {
      fokus: null,
      belanjaTotal: null,
      konversiTotal: { nilai: null, band: null, flag: 'kosong' as const },
      funnel: [
        { kode: 'impresi', label: 'Impresi produk', nilai: null, lolos: null, lolosDari: null, catatan: null },
        { kode: 'klik', label: 'Klik ke halaman produk', nilai: 100, lolos: null, lolosDari: null, catatan: null },
        { kode: 'atc', label: 'Add to Cart', nilai: null, lolos: null, lolosDari: null, catatan: null },
      ],
      blok: [],
    };
    const baris = bangunLaporanKelengkapan({ platform: 'tiktok', kanal: kanalLengkap, iklan: null, tahap: tahapBolong as never })
      .baris.find((b) => b.bagian === 'tahap');
    expect(baris?.lengkap).toBe(false);
    expect(baris?.alasan).toContain('Impresi produk, Add to Cart');
    expect(baris?.alasan).not.toContain('Klik ke halaman produk');
    expect(baris?.alasan).toContain('BUKAN nol aktivitas');
    expect(baris?.modulHilang).toHaveLength(4);
  });
});
