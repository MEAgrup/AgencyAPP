/**
 * B3 — tes pemeta payload baseline → usulan Section B.
 *
 * Yang dijaga di sini adalah kelas kesalahan yang paling mahal di jalur ini:
 * **absen ≠ nol**. Sebuah kolom yang payload-nya tidak punya HARUS sampai ke
 * Section B sebagai `null` (⇒ tetap manual, tetap menggerbang submit), bukan `0`
 * (⇒ AM mengira sudah terisi dan mengajukan angka karangan).
 */
import { describe, expect, it } from 'vitest';
import { mapPayloadToSectionB, pecahanKePersen } from './section-b';

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
