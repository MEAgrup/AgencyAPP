/**
 * @cdps/core pilarkatalog — katalog aksi pilar Section E (E-3…E-10).
 *
 * ## Apa modul ini SEKARANG, dan apa yang sudah bukan
 *
 * Berkas ini dulu bernama `copilot.ts` dan memuat **mesin aturan AM Co-Pilot**
 * yang diport dari `web-internal/public/tools/am-copilot.html` (B4): `verdict()`
 * berambang tetap, `skor()` run-rate vs floor, `saranD5()`, `bacaMetrik()`, dan
 * `susunUsulan()` yang menyalakan aksi dari payload baseline.
 *
 * **Semua itu dicabut** bersama pensiunnya AM Co-Pilot & AM Baseline
 * (`docs/DECISIONS.md` 2026-09-21 "PENSIUN-AMTOOLS"). Yang tersisa — dan satu-
 * satunya alasan berkas ini masih ada — adalah **katalognya**: 20 aksi dalam 4
 * pilar, berikut label BI-nya. Katalog itu bukan milik Co-Pilot; ia daftar
 * pilihan pilar MEA, dan sekarang dipakai langsung oleh **editor pilar manual**
 * di Section E lewat `GET /api/v1/strategi/katalog-pilar`.
 *
 * Kenapa dipertahankan alih-alih ikut dibuang: pensiun yang dilakukan adalah
 * mencabut mesin yang MENEBAK aksi dari angka baseline, bukan menghapus daftar
 * aksinya. Daftar itu tetap benar tanpa satu pun angka baseline — itulah yang
 * membuat editor manual mungkin tanpa Riset Awal.
 *
 * ## Batas modul ini
 *
 * Murni: tidak menyentuh DB, tidak tahu aktor, tidak memformat HTML. Pembacaan
 * baris `pdt_usulan_katalog` dikerjakan pemanggil (`pdt.listAksiKatalogAktif`);
 * modul ini hanya menggabungkannya dengan metadata kode lewat `gabungKatalogDb`.
 *
 * ## `pemicu` — data, bukan mesin
 *
 * Tiap aksi masih membawa `pemicu`: perbandingan satu metrik toko dengan satu
 * kunci benchmark. Sejak pensiun **tidak ada kode yang mengevaluasinya** — ia
 * turun pangkat dari syarat-otomatis jadi **keterangan**: editor manual
 * menampilkannya sebagai "relevan saat …" supaya AM tahu kapan sebuah aksi
 * biasanya dipakai, lalu AM sendiri yang memutuskan. Kolom `kondisi` di
 * `pdt_usulan_katalog` tetap menjadi rumahnya supaya syarat itu bisa
 * dimutakhirkan tanpa deploy.
 */

// ===========================================================================
// Katalog aksi — 4 pilar × 20 aksi (asal: tool `am-copilot.html`, kini pensiun)
// ===========================================================================

/** Empat pilar katalog. Bukan `strategi_pillar.jenis` — pemetaannya di `PILAR_KE_JENIS`. */
export type PilarKode = 'VIDEO' | 'LIVE' | 'AFFILIATE' | 'ADS';

/** Arah jembatan: `naik` = harus naik untuk berhasil, `turun` = harus turun. */
export type ArahJembatan = 'naik' | 'turun';

/**
 * Metrik payload yang jadi pemicu. Setiap kunci punya SATU pembaca
 * (`bacaMetrik`), dalam satuan yang sama dengan benchmark pembandingnya —
 * persen dibaca sebagai persen (5,37), bukan pecahan.
 */
export type MetrikKunci =
  | 'crToko'
  | 'videoPostToko'
  | 'videoSalesToko'
  | 'videoSalesAff'
  | 'gpmToko'
  | 'liveSesi'
  | 'liveJam'
  | 'liveGmvJam'
  | 'liveCtor'
  | 'krSales'
  | 'krKonsen'
  | 'kreatorBelumPosting'
  | 'sampelTerkirim'
  | 'skuSales'
  | 'roas'
  | 'adsDep';

/** Kunci benchmark yang dipakai sebagai ambang (subset `BenchKey`). */
export type AmbangBenchmark =
  | 'cr'
  | 'vidPostToko'
  | 'vidSalesToko'
  | 'vidSalesAff'
  | 'gpmToko'
  | 'liveSesi'
  | 'liveJam'
  | 'liveGmvJam'
  | 'liveCtor'
  | 'krSales'
  | 'krKonsen'
  | 'skuSales'
  | 'roas'
  | 'adsDep';

/** Ambang yang BUKAN benchmark — hanya dipakai untuk perbandingan "> 0". */
export const AMBANG_NOL = 0;

export interface Pemicu {
  metrik: MetrikKunci;
  /** Ambang: kunci benchmark, atau angka tetap bernama. */
  ambang: { benchmark: AmbangBenchmark } | { nilai: number; nama: string };
  /** `kurang` = menyala saat nilai < ambang; `lebih` = > ; `minimal` = >= ; `samaDengan` = ===. */
  banding: 'kurang' | 'lebih' | 'minimal' | 'samaDengan';
}

export interface AksiKatalog {
  kode: string;
  pilar: PilarKode;
  divisi: string;
  nama: string;
  deskripsi: string;
  /** Metrik jembatan — apa yang harus bergerak agar aksi ini disebut berhasil. */
  jembatan: string;
  unit: string;
  arah: ArahJembatan;
  /** Berapa minggu sebelum hasilnya wajar dinilai. */
  minggu: number;
  /** Field Section B yang jadi buktinya. */
  fieldIdBukti: string;
  quickWin: boolean;
  /**
   * Semua pemicu harus menyala (AND). Daftar kosong = aksi ini tidak pernah
   * diusulkan otomatis; ia hanya bisa dipilih AM sendiri di tool.
   */
  pemicu: readonly Pemicu[];
  /** Metrik yang jadi "angka sekarang" jembatan, bila payload punya. */
  sumberNilai: MetrikKunci | null;
}

const B = (benchmark: AmbangBenchmark, banding: Pemicu['banding'], metrik: MetrikKunci): Pemicu => ({
  metrik,
  ambang: { benchmark },
  banding,
});

/**
 * Katalog aksi. Teks `nama` / `deskripsi` / `jembatan` = string pemilik apa
 * adanya (aturan rumah #5: jangan mengarang atau mengubah label BI).
 */
export const KATALOG: readonly AksiKatalog[] = [
  // ── VIDEO → Creative ─────────────────────────────────────────────────────
  {
    kode: 'V1', pilar: 'VIDEO', divisi: 'Creative',
    nama: 'Hook baru / 3 hook baku',
    deskripsi: 'Pola pembukaan diseragamkan dari video ber-order',
    jembatan: 'Median VV video toko', unit: 'VV', arah: 'naik', minggu: 3,
    fieldIdBukti: 'B-7.1', quickWin: false,
    pemicu: [B('vidSalesToko', 'kurang', 'videoSalesToko')],
    sumberNilai: 'videoSalesToko',
  },
  {
    kode: 'V2', pilar: 'VIDEO', divisi: 'Creative',
    nama: 'Naikkan kuota video',
    deskripsi: 'Menambah jumlah produksi per minggu',
    jembatan: 'Video bertayangan / bulan', unit: 'video', arah: 'naik', minggu: 4,
    fieldIdBukti: 'B-7.1', quickWin: false,
    pemicu: [B('vidPostToko', 'kurang', 'videoPostToko')],
    sumberNilai: 'videoPostToko',
  },
  {
    kode: 'V3', pilar: 'VIDEO', divisi: 'Creative',
    nama: 'Replika video menjual',
    deskripsi: 'Brief dari Papan Video Factory, angle terbukti',
    jembatan: 'Hit rate video baru', unit: '%', arah: 'naik', minggu: 3,
    fieldIdBukti: 'B-7.1', quickWin: false,
    // Dipicu oleh ADANYA angle terbukti di payload, bukan oleh sebuah ambang —
    // lihat `peringkatAngleVideo`. Pemicunya diperiksa terpisah.
    pemicu: [],
    sumberNilai: 'videoSalesToko',
  },
  {
    kode: 'V4', pilar: 'VIDEO', divisi: 'Creative',
    nama: 'Audit / perbaikan akun official',
    deskripsi: 'Jam posting, kategori, riwayat teguran',
    jembatan: 'Median VV akun toko', unit: 'VV', arah: 'naik', minggu: 4,
    fieldIdBukti: 'B-2.2', quickWin: false,
    pemicu: [B('gpmToko', 'kurang', 'gpmToko')],
    sumberNilai: 'gpmToko',
  },
  {
    kode: 'V5', pilar: 'VIDEO', divisi: 'Creative',
    nama: 'Perbaikan listing hero SKU',
    deskripsi: 'Foto utama, deskripsi, varian',
    jembatan: 'CTOR hero SKU', unit: '%', arah: 'naik', minggu: 2,
    fieldIdBukti: 'B-3.6', quickWin: true,
    pemicu: [B('cr', 'kurang', 'crToko')],
    sumberNilai: 'crToko',
  },
  {
    kode: 'V6', pilar: 'VIDEO', divisi: 'Creative',
    nama: 'Pindah kuota ke SKU margin besar',
    deskripsi: 'Konten dialihkan ke SKU lain',
    jembatan: 'Porsi GMV SKU sasaran', unit: '%', arah: 'naik', minggu: 4,
    fieldIdBukti: 'B-3.3', quickWin: false,
    pemicu: [B('skuSales', 'kurang', 'skuSales')],
    sumberNilai: 'skuSales',
  },
  // ── LIVE → Live Stream ───────────────────────────────────────────────────
  {
    kode: 'L1', pilar: 'LIVE', divisi: 'Live Stream',
    nama: 'Mulai / tambah jam live',
    deskripsi: 'Menaikkan frekuensi atau durasi sesi',
    jembatan: 'Jam live / minggu', unit: 'jam', arah: 'naik', minggu: 4,
    fieldIdBukti: 'B-7.2', quickWin: false,
    pemicu: [B('liveJam', 'kurang', 'liveJam')],
    sumberNilai: 'liveJam',
  },
  {
    kode: 'L2', pilar: 'LIVE', divisi: 'Live Stream',
    nama: 'Ganti / latih host',
    deskripsi: 'Host baru atau pelatihan host lama',
    jembatan: 'GMV per jam live', unit: 'Rp', arah: 'naik', minggu: 4,
    fieldIdBukti: 'B-7.4', quickWin: false,
    pemicu: [B('liveGmvJam', 'kurang', 'liveGmvJam')],
    sumberNilai: 'liveGmvJam',
  },
  {
    kode: 'L3', pilar: 'LIVE', divisi: 'Live Stream',
    nama: 'Rombak rundown & urutan produk',
    deskripsi: 'Urutan SKU, blok waktu, pinning',
    jembatan: 'GMV per jam live', unit: 'Rp', arah: 'naik', minggu: 3,
    fieldIdBukti: 'B-7.4', quickWin: true,
    pemicu: [B('liveCtor', 'kurang', 'liveCtor')],
    sumberNilai: 'liveCtor',
  },
  {
    kode: 'L4', pilar: 'LIVE', divisi: 'Live Stream',
    nama: 'Flash deal terjadwal',
    deskripsi: 'Penawaran waktu terbatas di sesi live',
    jembatan: 'GMV live / minggu', unit: 'Rp', arah: 'naik', minggu: 2,
    fieldIdBukti: 'B-7.2', quickWin: true,
    pemicu: [B('liveSesi', 'kurang', 'liveSesi')],
    sumberNilai: 'liveSesi',
  },
  // ── AFFILIATE → KOL ──────────────────────────────────────────────────────
  {
    kode: 'A1', pilar: 'AFFILIATE', divisi: 'KOL',
    nama: 'Naikkan komisi terbuka',
    deskripsi: 'Komisi hero SKU dinaikkan',
    jembatan: 'Kreator posting / minggu', unit: 'kreator', arah: 'naik', minggu: 3,
    fieldIdBukti: 'B-6.3', quickWin: false,
    pemicu: [B('krSales', 'kurang', 'krSales')],
    sumberNilai: 'krSales',
  },
  {
    kode: 'A2', pilar: 'AFFILIATE', divisi: 'KOL',
    nama: 'Aktivasi kreator terdaftar',
    deskripsi: 'Hubungi yang sudah join tapi belum posting',
    jembatan: 'Kreator posting / minggu', unit: 'kreator', arah: 'naik', minggu: 3,
    fieldIdBukti: 'B-6.1', quickWin: true,
    pemicu: [{ metrik: 'kreatorBelumPosting', ambang: { nilai: AMBANG_NOL, nama: 'ada kreator terdaftar yang belum posting' }, banding: 'lebih' }],
    sumberNilai: 'kreatorBelumPosting',
  },
  {
    kode: 'A3', pilar: 'AFFILIATE', divisi: 'KOL',
    nama: 'Rekrut lapis kedua (MCN/MEAGO)',
    deskripsi: 'Menurunkan ketergantungan kreator utama',
    jembatan: 'Porsi GMV kreator terbesar', unit: '%', arah: 'turun', minggu: 6,
    fieldIdBukti: 'B-6.4', quickWin: false,
    pemicu: [B('krKonsen', 'lebih', 'krKonsen')],
    sumberNilai: 'krKonsen',
  },
  {
    kode: 'A4', pilar: 'AFFILIATE', divisi: 'KOL',
    nama: 'Program sampel / seeding',
    deskripsi: 'Pengiriman produk ke kreator',
    jembatan: 'Kreator posting / minggu', unit: 'kreator', arah: 'naik', minggu: 4,
    fieldIdBukti: 'B-6.5', quickWin: false,
    pemicu: [{ metrik: 'sampelTerkirim', ambang: { nilai: AMBANG_NOL, nama: 'belum ada sampel terkirim' }, banding: 'samaDengan' }],
    sumberNilai: 'krSales',
  },
  {
    kode: 'A5', pilar: 'AFFILIATE', divisi: 'KOL',
    nama: 'Campaign terarah ke kreator tertentu',
    deskripsi: 'Brief & target khusus kreator terpilih',
    jembatan: 'GMV affiliate', unit: 'Rp', arah: 'naik', minggu: 3,
    fieldIdBukti: 'B-6.2', quickWin: false,
    pemicu: [B('vidSalesAff', 'kurang', 'videoSalesAff')],
    sumberNilai: 'videoSalesAff',
  },
  // ── ADS → Ads ────────────────────────────────────────────────────────────
  {
    kode: 'D1', pilar: 'ADS', divisi: 'Ads',
    nama: 'Seleksi kreatif pakai CTR klik produk',
    deskripsi: 'Aturan terkunci K2 — bukan hook/hold',
    jembatan: '% spend kreatif 0 order', unit: '%', arah: 'turun', minggu: 2,
    fieldIdBukti: 'B-5.5', quickWin: true,
    pemicu: [B('roas', 'kurang', 'roas')],
    sumberNilai: null,
  },
  {
    kode: 'D2', pilar: 'ADS', divisi: 'Ads',
    nama: 'Aturan mati: 2× CPA tanpa order',
    deskripsi: 'Penghentian kampanye rugi terjadwal',
    jembatan: 'Rp spend terbuang / minggu', unit: 'Rp', arah: 'turun', minggu: 2,
    fieldIdBukti: 'B-5.5', quickWin: true,
    pemicu: [B('roas', 'kurang', 'roas')],
    sumberNilai: null,
  },
  {
    kode: 'D3', pilar: 'ADS', divisi: 'Ads',
    nama: 'Rombak struktur kampanye',
    deskripsi: 'Pecah/gabung grup iklan, ganti target',
    jembatan: 'ROAS blended', unit: 'x', arah: 'naik', minggu: 3,
    fieldIdBukti: 'B-5.4', quickWin: false,
    pemicu: [B('roas', 'kurang', 'roas')],
    sumberNilai: 'roas',
  },
  {
    kode: 'D4', pilar: 'ADS', divisi: 'Ads',
    nama: 'Ubah budget harian',
    deskripsi: 'Naik atau turun budget',
    jembatan: 'ROAS blended', unit: 'x', arah: 'naik', minggu: 3,
    fieldIdBukti: 'B-5.1', quickWin: false,
    pemicu: [B('adsDep', 'lebih', 'adsDep')],
    sumberNilai: 'roas',
  },
  {
    kode: 'D5', pilar: 'ADS', divisi: 'Ads',
    nama: 'GMV Max dinyalakan / dimatikan',
    deskripsi: 'Perubahan mode kampanye',
    jembatan: 'ROAS blended', unit: 'x', arah: 'naik', minggu: 3,
    fieldIdBukti: 'B-5.4', quickWin: false,
    // Satu-satunya aksi yang dipicu keadaan BAIK: ROAS sudah di atas benchmark
    // DAN ketergantungan iklan masih di bawah batas ⇒ ada ruang menaikkan mode.
    pemicu: [B('roas', 'minimal', 'roas'), B('adsDep', 'kurang', 'adsDep')],
    sumberNilai: 'roas',
  },
];

export const AKSI_BY_KODE: ReadonlyMap<string, AksiKatalog> = new Map(
  KATALOG.map((a) => [a.kode, a]),
);

// ===========================================================================
// G4-01 — katalog aksi pindah kode → DB (`pdt_usulan_katalog`, migrasi
// `20261109010000`). `KATALOG`/`AKSI_BY_KODE` di atas TETAP sumber metadata
// TAMPILAN (nama/deskripsi/jembatan/arah/minggu/fieldIdBukti/quickWin/pilar/
// divisi) — Rule 5 aturan rumah ("jangan mengarang/mengubah label BI") lebih
// selaras label yang di-review lewat PR daripada admin UI bebas ketik; skema
// `pdt_usulan_katalog` sendiri (PRD §6.3) TIDAK punya kolom nama/deskripsi,
// sinyal yang sama. Yang PINDAH ke DB (Rule 26/29/32): `platform_berlaku`,
// `kondisi` (syarat pemicu), `aktif`. `gabungKatalogDb` di bawah menggabungkan
// baris DB dengan metadata kode, menghasilkan `AksiKatalog[]` yang disajikan
// editor pilar manual — pemanggil (domain `pdt.listAksiKatalogAktif`) membaca DB;
// modul ini TETAP murni (nol DB, sesuai docblock kepala berkas).
// ===========================================================================

/** Bentuk `pdt_usulan_katalog.kondisi` (CHECK mewajibkan objek, bukan array telanjang). */
export type KondisiKatalogDb =
  | { tipe: 'ambang'; pemicu: readonly Pemicu[] }
  /** HANYA kode 'V3'. Sejak pensiun Co-Pilot tak ada yang mengevaluasinya; isi di sini murni dokumentasi niat. */
  | { tipe: 'kehadiran_bukti'; sumber: string };

/** Satu baris `pdt_usulan_katalog` sebagaimana dibaca `pdt.listAksiKatalogAktif` (bentuk domain, bukan tipe DB mentah). */
export interface AksiKatalogDbRow {
  kode: string;
  platformBerlaku: readonly string[];
  kondisi: KondisiKatalogDb;
  aktif: boolean;
}

/**
 * gabungKatalogDb — untuk SATU `platform` ('tiktok'/'shopee'/'meta', vokab
 * `pdt.PdtPlatform`), saring baris DB `aktif` + `platformBerlaku` mencakup
 * platform itu, lalu gabungkan dengan metadata kode (`AKSI_BY_KODE`) —
 * `pemicu` DITIMPA dari `kondisi` DB (admin bisa mengubah syarat tanpa
 * deploy, Rule 26), field lain (nama/deskripsi/jembatan/arah/minggu/dst.)
 * TETAP dari kode. Baris DB ber-`kode` yang metadatanya belum ada di kode
 * (mis. G4-03 menambah aksi baru sebelum PR metadatanya di-merge) DILEWATI,
 * bukan error — konsisten Rule 46-style error path (satu baris gagal tidak
 * menjatuhkan seluruh katalog).
 */
export function gabungKatalogDb(rows: readonly AksiKatalogDbRow[], platform: string): AksiKatalog[] {
  const hasil: AksiKatalog[] = [];
  for (const row of rows) {
    if (!row.aktif) continue;
    if (!row.platformBerlaku.includes(platform)) continue;
    const meta = AKSI_BY_KODE.get(row.kode);
    if (!meta) continue;
    const pemicu = row.kondisi.tipe === 'ambang' ? row.kondisi.pemicu : [];
    hasil.push({ ...meta, pemicu });
  }
  return hasil;
}

/** Pilar katalog → `strategi_pillar.jenis` (PILLAR_KINDS). */
export const PILAR_KE_JENIS: Readonly<Record<PilarKode, string>> = {
  VIDEO: 'konten',
  LIVE: 'live',
  AFFILIATE: 'affiliate',
  ADS: 'iklan',
};
