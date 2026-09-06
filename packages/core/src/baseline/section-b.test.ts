/**
 * B3 — tes pemeta payload baseline → usulan Section B.
 *
 * Yang dijaga di sini adalah kelas kesalahan yang paling mahal di jalur ini:
 * **absen ≠ nol**. Sebuah kolom yang payload-nya tidak punya HARUS sampai ke
 * Section B sebagai `null` (⇒ tetap manual, tetap menggerbang submit), bukan `0`
 * (⇒ AM mengira sudah terisi dan mengajukan angka karangan).
 */
import { describe, expect, it } from 'vitest';
import { REPORT_BENCH_SHOPEE_V1 } from '../report/shopee/bench';
import { BENCH_V1 } from './benchmark';
import { mapPayloadToSectionB, pecahanKePersen } from './section-b';
import { runShopeeBaseline, type ShopeeFileInput } from './shopee/run';
import type { Aoa, HistRow } from './types';

/** Payload minimal ber-bentuk `cdps.baseline.tiktok.v1` (hanya kunci yang dibaca). */
const PAYLOAD = {
  schema: 'cdps.baseline.tiktok.v1',
  klien: { periode_referensi: 'Agu 2026' },
  toko: { gmv: 1_000_000, refund_rate: 0.0412, pengunjung: 52_000, konversi: 0.0537 },
  gmv_mix: {
    video_afiliasi: 300_000,
    live_afiliasi: 100_000,
    video_toko: 200_000,
    live_toko: 100_000,
    kartu_produk_dan_lain: 300_000,
  },
  produk: {
    sku_total: 120,
    sku_ada_penjualan: 44,
    top_sku: [
      { nama: 'Serum A', gmv: 250_000, klik: 3_400, ctor: 0.081 },
      { nama: 'Toner B', gmv: 120_000, klik: 1_900, ctor: 0.052 },
    ],
  },
  iklan: { belanja: 90_000, roas: 3.2, setara_persen_gmv: 0.2881 },
  afiliasi: {
    kreator_posting: 37,
    gmv: 400_000,
    sampel_terkirim: 60,
    top_kreator: [{ nama: 'kreator.satu', gmv: 180_000 }],
  },
  video: {
    toko: { aktif: 40, diposting_periode: 31, vv: 900_000, gmv: 200_000 },
    afiliasi: { aktif: 88, vv: 2_100_000, gmv: 300_000 },
  },
  live: { toko: { jam: 62.5, gmv: 100_000 }, afiliasi: { jam: 20, gmv: 100_000 } },
};

describe('mapPayloadToSectionB — payload lengkap', () => {
  const s = mapPayloadToSectionB(PAYLOAD);

  it('mengenali schema dan periodenya', () => {
    expect(s.schema).toBe('cdps.baseline.tiktok.v1');
    expect(s.adaIsi).toBe(true);
    expect(s.periodeReferensi).toBe('Agu 2026');
  });

  it('B-2: pengunjung apa adanya, CR & % batal dari pecahan ke persen', () => {
    expect(s.pengunjungPerBulan).toBe(52_000);
    expect(s.conversionRatePersen).toBe(5.37);
    expect(s.refundRatePersen).toBe(4.12);
  });

  it('B-2.3: video/LIVE/luar dari gmv_mix, iklan dari setara_persen_gmv', () => {
    // penyebut = Σ kelima bucket = 1.000.000
    expect(s.trafikVideoPersen).toBe(50); // (200k + 300k) / 1jt
    expect(s.trafikLivePersen).toBe(20); // (100k + 100k) / 1jt
    expect(s.trafikLuarPersen).toBe(30);
    expect(s.trafikIklanPersen).toBe(28.81);
  });

  it('B-2.3: organik dan affiliate TIDAK PERNAH dihitung sebagai residu', () => {
    // Organik sebagai sisa = angka karangan (DECISIONS 2026-08-22: share platform
    // boleh tumpang tindih dan boleh >100%). Affiliate sudah ikut di video & LIVE.
    expect(s.trafikOrganikPersen).toBeNull();
    expect(s.trafikAffiliatePersen).toBeNull();
  });

  it('B-3: SKU terdaftar/aktif + top SKU (nama, GMV string, klik, CTOR persen)', () => {
    expect(s.skuListed).toBe(120);
    expect(s.skuAktif).toBe(44);
    expect(s.topSku).toEqual([
      { nama: 'Serum A', gmv: '250000', klik: 3_400, ctorPersen: 8.1 },
      { nama: 'Toner B', gmv: '120000', klik: 1_900, ctorPersen: 5.2 },
    ]);
  });

  it('B-6: kreator posting, GMV affiliate + share-nya terhadap GMV toko', () => {
    expect(s.affiliateAktif30Hari).toBe(37);
    expect(s.gmvAffiliate).toBe('400000');
    expect(s.gmvAffiliatePersen).toBe(40);
    expect(s.topKreator).toEqual([{ nama: 'kreator.satu', gmv: '180000' }]);
    expect(s.sampelTerkirim).toBe(60);
  });

  it('B-7.1 menjumlah video toko + afiliasi; B-7.2 hanya LIVE toko', () => {
    expect(s.jumlahVideoPerBulan).toBe(31 + 88);
    expect(s.totalViews).toBe(900_000 + 2_100_000);
    expect(s.gmvVideo).toBe('500000');
    // Jam & GMV live afiliasi TIDAK dijumlah: bukan kapasitas yang tim MEA
    // jadwalkan, dan menjumlahkannya membuat turunan "GMV per jam" salah.
    expect(s.jamLivePerBulan).toBe(62.5);
    expect(s.gmvLive).toBe('100000');
  });
});

describe('mapPayloadToSectionB — absen ≠ nol', () => {
  it('kunci B1 yang belum ada di payload jadi null, bukan 0', () => {
    const s = mapPayloadToSectionB(PAYLOAD);
    // B1 (paralel) yang menambahkan keempatnya ke `buildPayload`. Sampai itu
    // mendarat mereka absen — dan absen berarti manual.
    expect(s.skuPareto80).toBeNull();
    expect(s.skuSlowMoving).toBeNull();
    expect(s.jumlahKampanyeAktif).toBeNull();
    expect(s.tipeKampanye).toEqual([]);
  });

  it('membaca kunci B1 begitu payload membawanya — tanpa perubahan pemeta', () => {
    const s = mapPayloadToSectionB({
      ...PAYLOAD,
      produk: { ...PAYLOAD.produk, sku_pareto_80: 9, sku_slow_moving: 76 },
      iklan: { ...PAYLOAD.iklan, jumlah_kampanye: 12, tipe_materi: ['video_ads', 'gmv_max', 'video_ads'] },
    });
    expect(s.skuPareto80).toBe(9);
    expect(s.skuSlowMoving).toBe(76);
    expect(s.jumlahKampanyeAktif).toBe(12);
    expect(s.tipeKampanye).toEqual(['video_ads', 'gmv_max']);
  });

  it('payload kosong / bukan objek: semua null, adaIsi false', () => {
    for (const kosong of [null, undefined, 42, 'x', [], {}]) {
      const s = mapPayloadToSectionB(kosong);
      expect(s.adaIsi).toBe(false);
      expect(s.pengunjungPerBulan).toBeNull();
      expect(s.conversionRatePersen).toBeNull();
      expect(s.skuListed).toBeNull();
      expect(s.gmvAffiliate).toBeNull();
      expect(s.jamLivePerBulan).toBeNull();
      expect(s.topSku).toEqual([]);
      expect(s.topKreator).toEqual([]);
    }
  });

  it('nilai null di dalam blok yang ada tetap null (bukan 0)', () => {
    const s = mapPayloadToSectionB({ toko: { pengunjung: null, konversi: null }, produk: null });
    expect(s.adaIsi).toBe(true);
    expect(s.pengunjungPerBulan).toBeNull();
    expect(s.conversionRatePersen).toBeNull();
    expect(s.skuListed).toBeNull();
  });

  it('gmv_mix nol total ⇒ share null, bukan 0% (pembagi nol, aturan rumah #7)', () => {
    const s = mapPayloadToSectionB({
      gmv_mix: { video_afiliasi: 0, live_afiliasi: 0, video_toko: 0, live_toko: 0, kartu_produk_dan_lain: 0 },
    });
    expect(s.trafikVideoPersen).toBeNull();
    expect(s.trafikLivePersen).toBeNull();
    expect(s.trafikLuarPersen).toBeNull();
  });

  it('GMV toko nol ⇒ % GMV affiliate null, bukan 0%', () => {
    const s = mapPayloadToSectionB({ toko: { gmv: 0 }, afiliasi: { gmv: 400_000 } });
    expect(s.gmvAffiliate).toBe('400000');
    expect(s.gmvAffiliatePersen).toBeNull();
  });

  it('gmv_mix hanya sebagian terisi: yang ada dihitung, yang absen ikut penyebut sebagai 0', () => {
    // Bucket yang absen memang berarti "tidak ada GMV dari sana" DI DALAM mix —
    // berbeda dari blok mix yang seluruhnya absen (di atas), yang berarti "tidak
    // terbaca" dan menghasilkan null.
    const s = mapPayloadToSectionB({ gmv_mix: { video_toko: 750_000, kartu_produk_dan_lain: 250_000 } });
    expect(s.trafikVideoPersen).toBe(75);
    expect(s.trafikLuarPersen).toBe(25);
    expect(s.trafikLivePersen).toBeNull();
  });

  it('baris top SKU / top kreator tanpa nama dibuang, bukan diteruskan kosong', () => {
    const s = mapPayloadToSectionB({
      produk: { top_sku: [{ nama: '  ', gmv: 1 }, { nama: 'Ada', gmv: 2 }, 'bukan objek'] },
      afiliasi: { top_kreator: [{ gmv: 3 }, { nama: 'K', gmv: 4 }] },
    });
    expect(s.topSku).toEqual([{ nama: 'Ada', gmv: '2', klik: null, ctorPersen: null }]);
    expect(s.topKreator).toEqual([{ nama: 'K', gmv: '4' }]);
  });

  it('tipe_materi bukan array / berisi sampah ⇒ dibuang, bukan teks bebas', () => {
    expect(mapPayloadToSectionB({ iklan: { tipe_materi: 'video_ads' } }).tipeKampanye).toEqual([]);
    expect(mapPayloadToSectionB({ iklan: { tipe_materi: [1, null, ' live_ads '] } }).tipeKampanye).toEqual([
      'live_ads',
    ]);
  });

  it('video: `diposting_periode` menang atas `aktif` di sisi toko', () => {
    expect(mapPayloadToSectionB({ video: { toko: { aktif: 40, diposting_periode: 31 } } }).jumlahVideoPerBulan).toBe(31);
    expect(mapPayloadToSectionB({ video: { toko: { aktif: 40 } } }).jumlahVideoPerBulan).toBe(40);
  });
});

describe('pecahanKePersen', () => {
  it('membulatkan ke 2 desimal — presisi kolom numeric(6,2)', () => {
    expect(pecahanKePersen(0.053749)).toBe(5.37);
    expect(pecahanKePersen(0)).toBe(0);
  });
  it('null / kosong / NaN tetap null', () => {
    for (const v of [null, undefined, '', 'x', NaN, true]) expect(pecahanKePersen(v)).toBeNull();
  });
});

describe('determinisme (aturan rumah #4)', () => {
  it('dua kali hitung dari payload yang sama ⇒ hasil identik', () => {
    expect(mapPayloadToSectionB(PAYLOAD)).toEqual(mapPayloadToSectionB(PAYLOAD));
  });
});


// ---------------------------------------------------------------------------
// Bentuk Shopee — kunci yang BERBEDA nama / berbeda susunan dari TikTok
// ---------------------------------------------------------------------------

describe('mapPayloadToSectionB — bentuk payload Shopee', () => {
  it('B-1.4 dibaca dari `batal_retur_rate` (nama Shopee) maupun `refund_rate` (nama TikTok)', () => {
    expect(mapPayloadToSectionB({ toko: { batal_retur_rate: 0.06 } }).refundRatePersen).toBe(6);
    expect(mapPayloadToSectionB({ toko: { refund_rate: 0.0412 } }).refundRatePersen).toBe(4.12);
    // Nama TikTok menang bila keduanya ada — satu platform tidak pernah punya dua.
    expect(
      mapPayloadToSectionB({ toko: { refund_rate: 0.01, batal_retur_rate: 0.09 } }).refundRatePersen,
    ).toBe(1);
  });

  it('blok video DATAR (Shopee) mengisi views + GMV; jumlah video tetap manual', () => {
    // Shopee mengekspor performa video agregat, bukan daftar video — jadi tidak
    // ada "berapa video tayang bulan ini" untuk dibaca, dan mengarangnya salah.
    const s = mapPayloadToSectionB({
      video: { ada_aktivitas: true, gmv: 12_000_000, pesanan: 140, ditonton: 850_000, penonton: 300_000, ctr: 0.02, completion: 0.31 },
    });
    expect(s.totalViews).toBe(850_000);
    expect(s.gmvVideo).toBe('12000000');
    expect(s.jumlahVideoPerBulan).toBeNull();
  });

  it('bentuk toko/afiliasi (TikTok) tidak ikut terbaca sebagai datar', () => {
    const s = mapPayloadToSectionB({
      video: { toko: { aktif: 40, vv: 900_000, gmv: 200_000 }, afiliasi: { aktif: 88, vv: 2_100_000, gmv: 300_000 }, ditonton: 999 },
      });
    // `ditonton` di level atas DIABAIKAN saat sub-blok toko/afiliasi ada.
    expect(s.totalViews).toBe(3_000_000);
    expect(s.gmvVideo).toBe('500000');
  });

  it('B-4: chat response rate, waktu respon (detik→menit) dan poin penalti', () => {
    const s = mapPayloadToSectionB({
      layanan: { response_rate: 0.95, waktu_respon_detik: 750 },
      kesehatan_toko: { poin_total: 3 },
    });
    expect(s.chatResponseRatePersen).toBe(95);
    expect(s.chatResponseMenit).toBe(13); // 750 dtk / 60 = 12,5 → 13
    expect(s.poinPenalti).toBe(3);
    expect(s.adaIsi).toBe(true);
  });

  it('B-4 TikTok tetap null seluruhnya — payload-nya memang tidak punya bloknya', () => {
    const s = mapPayloadToSectionB(PAYLOAD);
    expect(s.chatResponseRatePersen).toBeNull();
    expect(s.chatResponseMenit).toBeNull();
    expect(s.poinPenalti).toBeNull();
  });

  it('poin penalti 0 adalah TEMUAN (toko bersih), bukan absen', () => {
    const s = mapPayloadToSectionB({ kesehatan_toko: { poin_total: 0 } });
    expect(s.poinPenalti).toBe(0);
  });

  it('waktu respon di bawah 30 detik membulat ke 0 menit — resolusi kolomnya memang menit', () => {
    expect(mapPayloadToSectionB({ layanan: { waktu_respon_detik: 20 } }).chatResponseMenit).toBe(0);
    expect(mapPayloadToSectionB({ layanan: { waktu_respon_detik: null } }).chatResponseMenit).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Jahitan lintas-mesin — pemeta ini vs keluaran ASLI engine baseline Shopee
// ---------------------------------------------------------------------------

/**
 * Tes ini sengaja menjalankan `runShopeeBaseline` yang sebenarnya, bukan payload
 * karangan, karena satu-satunya cara B3 rusak diam-diam adalah B2 mengganti nama
 * kunci: pemeta akan mengembalikan `null` untuk semuanya, Section B akan minta
 * diisi manual, dan **tidak satu pun tes unit di kedua sisi akan memerah**.
 * Fixture-nya bentuk export Shopee asli (header apa adanya), sama seperti
 * `shopee-baseline.test.ts`.
 */
const HOME_HEADER = [
  'Periode Waktu', 'Total Penjualan (IDR)', 'Total Pesanan', 'Penjualan per Pesanan', 'Produk Diklik',
  'Total Pengunjung', 'Tingkat Konversi Pesanan', 'Pesanan Dibatalkan', 'Penjualan Dibatalkan',
  'Pesanan Dikembalikan', 'Penjualan Dikembalikan', 'Pembeli', 'Total Pembeli Baru', 'Total Pembeli Saat Ini',
  'Total Potensi Pembeli', 'Tingkat Pembelian Berulang',
];
const homeAoa = (): Aoa => [
  ['Pesanan Dibuat'],
  HOME_HEADER,
  ['Total', 'Rp100.000.000', '1.000', 'Rp100.000', '5.000', '50.000', '2,00%', '50', 'Rp5.000.000', '10', 'Rp1.000.000', '900', '300', '600', '50', '20,00%'],
];
const produkAoa = (): Aoa => [
  ['Kode Produk', 'Produk', 'Nama Variasi', 'Status Produk Saat Ini', 'Jumlah Produk Dilihat', 'Produk Diklik',
    'Pengunjung Produk (Kunjungan)', 'Pesanan Dibuat', 'Total Penjualan (Pesanan Dibuat) (IDR)',
    'Total Pembeli (Pesanan Dibuat)', 'Tingkat Konversi (Pesanan yang Dibuat)', 'Pesanan Siap Dikirim',
    'Penjualan (Pesanan Siap Dikirim) (IDR)', 'Tingkat Konversi (Pesanan Siap Dikirim)'],
  ['SKU-A', 'Produk Bintang', '-', 'Aktif', '5000', '900', '1000', '300', 'Rp80.000.000', '290', '30,00%', '280', 'Rp84.000.000', '28,00%'],
  ['SKU-D', 'Produk Tidur', '-', 'Aktif', '10', '2', '20', '0', 'Rp0', '0', '-', '0', 'Rp0', '-'],
];
const chatAoa = (): Aoa => [
  ['Periode Waktu', 'Pengunjung', 'Jumlah Chat', 'Pengunjung Bertanya', 'Pertanyaan Diajukan', 'Chat Dibalas', 'Chat Belum Dibalas', 'Waktu Respon Rata-rata', 'CSAT %', 'Persentase Chat Dibalas', 'Total Pembeli', 'Total Pesanan', 'Penjualan (IDR)', 'Tingkat Konversi (Chat Dibalas)'],
  ['01-31 Agu', '5000', '800', '700', '750', '760', '40', '00:12:30', '90,00%', '95,00%', '150', '160', 'Rp16.000.000', '20,00%'],
];
const kesehatanAoa = (): Aoa => [
  ['Poin Penalti', 'Deskripsi', 'Durasi'],
  ['1', 'Pelanggaran larangan produk', '7 hari'],
];
const HIST_SHOPEE: HistRow[] = [
  { key: '2026-06', label: 'Jun 2026', gmv: '90.000.000', order: '900', flag: 'normal' },
  { key: '2026-07', label: 'Jul 2026', gmv: '95.000.000', order: '950', flag: 'normal' },
  { key: '2026-08', label: 'Agu 2026', gmv: '100.000.000', order: '1.000', flag: 'normal' },
];
const f = (module: string, aoa: Aoa): ShopeeFileInput => ({
  filename: `[${module.split('|')[0]}]-${module.split('|')[1]} && Agu 2026 && EzzyConnect && 2026-09-01.xlsx`,
  aoa,
});

describe('jahitan B2→B3 — pemeta membaca keluaran ASLI engine baseline Shopee', () => {
  const { payload } = runShopeeBaseline(
    [f('bisnis|home', homeAoa()), f('bisnis|produk', produkAoa()), f('layanan|chat', chatAoa()), f('bisnis|kesehatan', kesehatanAoa())],
    HIST_SHOPEE,
    {
      bench: REPORT_BENCH_SHOPEE_V1,
      benchmarkVersi: 1,
      benchRiwayat: BENCH_V1,
      klien: { nama: 'PT Ezzy', toko: 'EzzyConnect', store_link: 'https://shopee.co.id/ezzy', kategori: 'Fashion', umur_toko_bulan: 18, account_manager: 'EMP-002' },
      generatedAt: '2026-09-06T03:00:00.000Z',
      periode: 'Agustus 2026',
    },
  );
  const s = mapPayloadToSectionB(payload);

  it('mengenali payload Shopee sebagai terbaca', () => {
    expect(payload.schema).toBe('cdps.baseline.shopee.v1');
    expect(s.schema).toBe('cdps.baseline.shopee.v1');
    expect(s.adaIsi).toBe(true);
    expect(s.periodeReferensi).toBe('Agustus 2026');
  });

  it('B-2 pengunjung + CR sampai ke Section B', () => {
    expect(s.pengunjungPerBulan).toBe(50_000);
    expect(s.conversionRatePersen).toBe(2);
  });

  it('B-1.4 % batal terbaca dari nama kunci Shopee', () => {
    // (5.000.000 batal + 1.000.000 retur) / 100.000.000 = 6%
    expect(s.refundRatePersen).toBe(6);
  });

  it('B-3 SKU terdaftar/aktif + Pareto + slow moving terbaca', () => {
    expect(s.skuListed).toBe(2);
    expect(s.skuAktif).toBe(1);
    expect(s.skuPareto80).toBe(1);
    expect(s.skuSlowMoving).toBe(1);
    expect(s.topSku[0].nama).toBe('Produk Bintang');
  });

  it('B-4 Shopee terisi otomatis — keputusan pemilik 2026-09-06', () => {
    expect(s.chatResponseRatePersen).toBe(95);
    expect(s.chatResponseMenit).toBe(13); // 00:12:30 → 750 dtk → 13 menit
    expect(s.poinPenalti).toBe(1);
  });

  it('yang Shopee memang tak punya tetap null — bukan nol', () => {
    // `kreator_posting` sengaja absen dari payload Shopee (hanya 10 kreator
    // teratas yang diekspor, jadi "berapa kreator menghasilkan penjualan" tidak
    // bisa dihitung tanpa menebak) — lihat catatan di metrik-baseline.ts.
    expect(s.affiliateAktif30Hari).toBeNull();
    // Shopee Live hanya mengekspor "ada aktivitas", bukan jam/GMV.
    expect(s.jamLivePerBulan).toBeNull();
    expect(s.gmvLive).toBeNull();
    // B-2.3: gmv_mix Shopee memakai taksonomi kanal yang BERBEDA dan saling
    // tumpang tindih (shopee_ads / affiliate / voucher / chat / meta_cpas /
    // shopee_video), bukan lima bucket TikTok. Pemetaannya butuh ketokan
    // pemilik, jadi B-2.3 Shopee sengaja tetap manual — lihat DECISIONS.
    expect(s.trafikVideoPersen).toBeNull();
    expect(s.trafikLivePersen).toBeNull();
    expect(s.trafikLuarPersen).toBeNull();
  });
});
