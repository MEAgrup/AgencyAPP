/**
 * @cdps/core copilot — mesin aturan AM Co-Pilot, dipindah ke server (B4).
 *
 * ## Kenapa modul ini ada
 *
 * `web-internal/public/tools/am-copilot.html` **bukan** AI: ia mesin aturan
 * deterministik (katalog 4 pilar × 20 aksi, `verdict()` berambang tetap, `skor()`
 * run-rate vs floor, `saranD5()`). Nol LLM, nol API key, nol endpoint. Karena itu
 * logikanya bisa dijalankan di server — persis preseden
 * `docs/plan/PLAN_KONSOLIDASI_ALAT_ADVERTISER.md` (SKU Screener, report engine,
 * Ads Scanner: keempatnya sudah diport penuh).
 *
 * Yang diperbaiki dengan memindahkannya: hari ini AM harus mengekspor JSON dari
 * halaman Strategi, membukanya di tool, mencentang aksi, lalu menempelkan JSON
 * hasilnya kembali ke Section C/D/E — tiga salin-tempel manual untuk data yang
 * server sudah punya (handoff Gelombang B §4.2). Section E akibatnya kosong di
 * hampir semua Strategi (`DECISIONS.md` 2026-09-02), dan baris Plan ikut mati.
 *
 * ## Batas modul ini
 *
 * Murni: tidak menyentuh DB, tidak tahu aktor, tidak memformat HTML. Masukannya
 * payload baseline (schema apa pun — dibaca lewat jalur kunci bersama, sama
 * seperti `baseline/section-b.ts`) dan keluarannya USULAN. Yang menyimpannya
 * tetap `saveStrategiPillars` setelah AM mencentang: modul ini tidak pernah
 * menjadi keputusan, hanya draft.
 *
 * ## Ambang
 *
 * Nol ambang baru. Setiap pemicu aksi membandingkan satu metrik payload dengan
 * satu kunci `benchmark_dipakai` yang engine baseline sudah pakai untuk menilai
 * toko itu — jadi "kenapa aksi ini diusulkan" selalu bisa dijawab dengan angka
 * yang sudah tercatat di payload, dan mengubah benchmark tidak menulis ulang
 * usulan lama (pola `KualifikasiConfig`, `interview.ts`). Dua ambang yang BUKAN
 * dari benchmark adalah aturan MEA yang tool sendiri kunci (`ATURAN_TERKUNCI`),
 * dan keduanya dikutip apa adanya.
 */

import { dec, nil, num, pct, rp } from './baseline/angka';

// ===========================================================================
// Katalog aksi — 4 pilar × 20 aksi (tool `KATALOG`, baris 290-317)
// ===========================================================================

/** Empat pilar katalog. Bukan `strategi_pillar.jenis` — pemetaannya di `JENIS`. */
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
  pemicu: Pemicu[];
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

/** Pilar katalog → `strategi_pillar.jenis` (PILLAR_KINDS). */
export const PILAR_KE_JENIS: Readonly<Record<PilarKode, string>> = {
  VIDEO: 'konten',
  LIVE: 'live',
  AFFILIATE: 'affiliate',
  ADS: 'iklan',
};

/** Pilar katalog → pilar skor baseline (`skor.pilar`), untuk mengurutkan. */
const PILAR_KE_SKOR: Readonly<Record<PilarKode, string>> = {
  VIDEO: 'video',
  LIVE: 'live',
  AFFILIATE: 'aff',
  ADS: 'prod',
};

/**
 * Aturan MEA yang tool sendiri kunci (tool `ATURAN_TERKUNCI`). Ditawarkan
 * BERDAMPINGAN dengan hitungan ±%, bukan menggantikannya — keduanya sah: satu
 * relatif ke toko, satu standar MEA.
 */
export const ATURAN_TERKUNCI: Readonly<Record<string, { nilai: number; label: string }>> = {
  D1: { nilai: 15, label: 'Aturan K2 — % spend kreatif 0 order maksimum 15%' },
  A3: { nilai: 30, label: 'Ambang risiko struktural — porsi GMV kreator #1 maksimum 30%' },
};

// ===========================================================================
// Ambang bernama — verdict + skor (tool baris 657-693)
// ===========================================================================

/**
 * Ambang penilaian, sebagai DATA. Pola `KualifikasiConfig` (`interview.ts`):
 * mengkalibrasi ulang tidak boleh menulis ulang penilaian lama, jadi pemanggil
 * yang menyimpan hasil juga menyimpan config yang dipakainya.
 */
export interface CopilotConfig {
  /** Eksekusi < ini × rencana ⇒ TIDAK DIKERJAKAN (kegagalan eksekusi, bukan taktik). */
  eksekusiMinimalRasio: number;
  /** Aksi belum dinilai sebelum berjalan sekian minggu. */
  mingguSebelumDinilai: number;
  /** Gerakan ≥ ini % ke arah benar tapi belum sampai target ⇒ BERHASIL SEBAGIAN. */
  gerakBerhasilSebagianPersen: number;
  /** Gerakan < ini % ⇒ GAGAL (jembatan tidak bergerak). */
  gerakGagalPersen: number;
  /** Run-rate ≥ ini % dari floor ⇒ AMAN. */
  runRateAmanPersen: number;
  /** Run-rate ≥ ini % dari floor ⇒ TIPIS; di bawahnya MELESET. */
  runRateTipisPersen: number;
}

export const COPILOT_CONFIG_V1: CopilotConfig = {
  eksekusiMinimalRasio: 0.5,
  mingguSebelumDinilai: 2,
  gerakBerhasilSebagianPersen: 15,
  gerakGagalPersen: 5,
  runRateAmanPersen: 95,
  runRateTipisPersen: 75,
};

/** Ambisi target (%) diskalakan ke lama aksi terlihat hasilnya (tool `skalaAmbisi`). */
export function skalaAmbisi(minggu: number): number {
  if (minggu <= 2) return 15;
  if (minggu <= 3) return 25;
  if (minggu <= 4) return 30;
  return 40;
}

/** Pembulatan tampilan target (tool `bulat`) — angka bulat yang enak dibaca AM. */
export function bulat(v: number | null | undefined): number | null {
  if (nil(v)) return null;
  const n = v as number;
  const a = Math.abs(n);
  if (a >= 1e6) return Math.round(n / 1e5) * 1e5;
  if (a >= 1e5) return Math.round(n / 1e4) * 1e4;
  if (a >= 1e4) return Math.round(n / 1e3) * 1e3;
  if (a >= 1e3) return Math.round(n / 50) * 50;
  if (a >= 100) return Math.round(n / 10) * 10;
  if (a >= 10) return Math.round(n);
  return Math.round(n * 10) / 10;
}

// ===========================================================================
// verdict — penilaian satu aksi berjalan (tool `verdict`, baris 657-679)
// ===========================================================================

export type VerdictAksi =
  | 'TIDAK DIKERJAKAN'
  | 'JALAN'
  | 'BELUM CUKUP DATA'
  | 'BERHASIL'
  | 'BERHASIL SEBAGIAN'
  | 'GAGAL';

export interface VerdictInput {
  /** Minggu berjalan sejak aksi dimulai. */
  mingguJalan: number;
  /** Berapa yang DIRENCANAKAN dikerjakan (mis. 12 video). */
  rencana: number | null;
  /** Berapa yang BENAR dikerjakan. */
  realisasi: number | null;
  /** Angka jembatan sebelum aksi. */
  sebelum: number | null;
  /** Angka jembatan sekarang. */
  sekarang: number | null;
  /** Target jembatan; null = belum ditetapkan. */
  target: number | null;
  arah: ArahJembatan;
}

export interface VerdictHasil {
  verdict: VerdictAksi;
  /** Alasan BI dari angka asli — template tetap, jadi identik saat dihitung ulang. */
  alasan: string;
}

/**
 * Penilaian satu aksi. Urutan cabangnya SENGAJA seperti di tool, dan cabang
 * pertama adalah yang paling penting di seluruh alat ini: memisahkan
 * **TIDAK DIKERJAKAN** (kegagalan eksekusi) dari **GAGAL** (taktiknya salah).
 * Menukar urutannya membuat aksi yang tak pernah dijalankan dilaporkan sebagai
 * taktik yang terbukti gagal — dan itu menghapus satu-satunya sinyal yang
 * membedakan masalah tim dari masalah strategi.
 */
export function verdict(v: VerdictInput, cfg: CopilotConfig = COPILOT_CONFIG_V1): VerdictHasil {
  const rencana = v.rencana ?? 0;
  const real = v.realisasi ?? 0;
  const rasio = rencana > 0 ? real / rencana : real > 0 ? 1 : 0;
  if (rencana > 0 && rasio < cfg.eksekusiMinimalRasio) {
    return {
      verdict: 'TIDAK DIKERJAKAN',
      alasan: `eksekusi ${Math.round(rasio * 100)}% dari rencana (${num(real)}/${num(rencana)}) — taktiknya belum diuji, ini kegagalan eksekusi`,
    };
  }
  if (v.mingguJalan < cfg.mingguSebelumDinilai) {
    return {
      verdict: 'JALAN',
      alasan: `baru ${v.mingguJalan} minggu berjalan · dinilai setelah ${cfg.mingguSebelumDinilai} minggu`,
    };
  }
  const b = v.sebelum;
  const s = v.sekarang;
  if (b == null || s == null) {
    return { verdict: 'BELUM CUKUP DATA', alasan: 'angka jembatan belum lengkap' };
  }
  const naik = v.arah === 'naik';
  const lulus = v.target != null ? (naik ? s >= v.target : s <= v.target) : null;
  const gerak = naik ? s - b : b - s;
  const gerakPersen = b ? Math.abs((gerak / b) * 100) : 0;
  if (lulus === true) {
    return {
      verdict: 'BERHASIL',
      alasan: `jembatan melewati target (${dec(b, 1)} → ${dec(s, 1)})`,
    };
  }
  if (gerak > 0 && gerakPersen >= cfg.gerakBerhasilSebagianPersen) {
    return {
      verdict: 'BERHASIL SEBAGIAN',
      alasan: `bergerak ${pct(gerakPersen / 100)} ke arah benar tapi belum sampai target`,
    };
  }
  if (gerak <= 0 || gerakPersen < cfg.gerakGagalPersen) {
    return {
      verdict: 'GAGAL',
      alasan: `jembatan tidak bergerak dalam ${v.mingguJalan} minggu (${dec(b, 1)} → ${dec(s, 1)}) — arketipe kemungkinan salah`,
    };
  }
  return { verdict: 'BELUM CUKUP DATA', alasan: `gerakan ${pct(gerakPersen / 100)} belum meyakinkan` };
}

// ===========================================================================
// skor — run-rate GMV vs floor kontrak (tool `skor`, baris 681-693)
// ===========================================================================

export type StatusRunRate = 'AMAN' | 'TIPIS' | 'MELESET' | 'BELUM DAPAT DINILAI';

export interface SkorInput {
  /** GMV yang sudah terkumpul di bulan berjalan. */
  gmvBulanBerjalan: number | null;
  /** Floor kontrak untuk bulan itu. */
  floor: number | null;
  /** Tanggal potong data, `YYYY-MM-DD` (WIB — dihitung pemanggil, bukan jam klien). */
  tanggalData: string | null;
}

export interface SkorHasil {
  /** Proyeksi GMV sebulan penuh dari kecepatan sekarang; null tanpa tanggal. */
  runRate: number | null;
  /** Run-rate sebagai % dari floor; null saat floor 0/absen (pembagi nol). */
  persenFloor: number | null;
  status: StatusRunRate;
  hariBerjalan: number;
  hariDalamBulan: number;
}

/**
 * Run-rate vs floor. Pembagi nol (`floor` 0 atau absen, atau tanggal belum ada)
 * menghasilkan `null` dan status `BELUM DAPAT DINILAI` — bukan 0% MELESET, yang
 * akan menaikkan tier klien karena datanya belum ada (aturan rumah #7).
 */
export function skor(i: SkorInput, cfg: CopilotConfig = COPILOT_CONFIG_V1): SkorHasil {
  const t = i.tanggalData ? new Date(`${i.tanggalData}T00:00:00Z`) : null;
  const valid = t !== null && !Number.isNaN(t.getTime());
  const hariDalamBulan = valid
    ? new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate()
    : 30;
  const hariBerjalan = valid ? t.getUTCDate() : 0;
  const gmv = i.gmvBulanBerjalan;
  const runRate = hariBerjalan > 0 && gmv != null ? (gmv / hariBerjalan) * hariDalamBulan : null;
  const persenFloor =
    runRate != null && i.floor != null && i.floor > 0 ? (runRate / i.floor) * 100 : null;
  const status: StatusRunRate =
    persenFloor == null
      ? 'BELUM DAPAT DINILAI'
      : persenFloor >= cfg.runRateAmanPersen
        ? 'AMAN'
        : persenFloor >= cfg.runRateTipisPersen
          ? 'TIPIS'
          : 'MELESET';
  return { runRate, persenFloor, status, hariBerjalan, hariDalamBulan };
}

// ===========================================================================
// Angle video terbukti — peringkat dari `video.top_video[]`
// ===========================================================================

export interface AngleVideo {
  judul: string;
  akun: string | null;
  gmv: number | null;
  /** GMV per 1.000 views — jangkar peringkat. */
  gpm: number | null;
  vv: number | null;
  /** Finish rate, pecahan 0..1. */
  tuntas: number | null;
  /** CTR, pecahan 0..1. */
  ctr: number | null;
  /** Satu baris BI dari angka asli — template tetap ⇒ byte-identik saat dihitung ulang. */
  ringkas: string;
}

/** Maksimal angle yang dibawa ke satu pilar konten. */
export const ANGLE_MAKS = 5;

/**
 * Peringkat angle video yang SUDAH perform, untuk dibawa ke brief Creative
 * (pemilik, 2026-09-06: *"berguna untuk mencari angle video yg sudah perform.
 * ini dibutuhkan untuk lanjutan brief ke creative"*).
 *
 * Jangkar `gpm` (GMV per 1.000 views): itu satu-satunya angka yang mengukur
 * "video ini menjual", bukan "video ini ditonton". `tuntas` (finish rate) dan
 * `ctr` jadi penguat, bukan jangkar — video yang ditonton habis tapi tidak
 * menjual bukan angle, ia hiburan. Video tanpa `gpm` dibuang: tanpa jangkar
 * tidak ada dasar memeringkat, dan menaruhnya di urutan nol adalah mengarang.
 *
 * Seri diputus `gmv` desc lalu `judul` asc, jadi urutannya total dan stabil —
 * dua kali hitung dari payload yang sama menghasilkan daftar yang identik.
 */
export function peringkatAngleVideo(topVideo: unknown, maks: number = ANGLE_MAKS): AngleVideo[] {
  if (!Array.isArray(topVideo)) return [];
  const rows = topVideo
    .filter((v): v is Record<string, unknown> => typeof v === 'object' && v !== null)
    .map((v) => ({
      judul: typeof v.judul === 'string' ? v.judul.trim() : '',
      akun: typeof v.akun === 'string' && v.akun.trim() !== '' ? v.akun.trim() : null,
      gmv: angka(v.gmv),
      gpm: angka(v.gpm),
      vv: angka(v.vv),
      tuntas: angka(v.tuntas),
      ctr: angka(v.ctr),
    }))
    .filter((v) => v.judul !== '' && v.gpm != null);

  rows.sort((a, b) => {
    const nb = nilaiAngle(b);
    const na = nilaiAngle(a);
    if (nb !== na) return nb - na;
    const gb = b.gmv ?? 0;
    const ga = a.gmv ?? 0;
    if (gb !== ga) return gb - ga;
    return a.judul.localeCompare(b.judul, 'id');
  });

  return rows.slice(0, Math.max(0, maks)).map((v) => ({
    ...v,
    ringkas:
      `${v.judul} — GPM ${rp(v.gpm)} · tuntas ${pct(v.tuntas)} · CTR ${pct(v.ctr)} · ` +
      `GMV ${rp(v.gmv)} · ${num(v.vv)} views${v.akun ? ` (akun ${v.akun})` : ''}`,
  }));
}

/** Jangkar × penguat. Penguat absen = 1 (tidak menghukum data yang tak ada). */
function nilaiAngle(v: { gpm: number | null; tuntas: number | null; ctr: number | null }): number {
  return (v.gpm ?? 0) * (1 + (v.tuntas ?? 0)) * (1 + (v.ctr ?? 0));
}

function angka(v: unknown): number | null {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ===========================================================================
// saranD5 — horizon 30/60/90 (tool `saranD5`, baris 832-847)
// ===========================================================================

export interface SaranD5Input {
  /** Aksi yang dipilih, sebagai kode katalog. */
  kodeAksi: readonly string[];
  channel: string;
  floor: number | null;
  stretch: number | null;
}

export interface SaranD5 {
  h30: string;
  h60: string;
  h90: string;
}

/** Tiga kalimat horizon D-5, disusun dari jembatan aksi terpilih. */
export function saranD5(i: SaranD5Input): SaranD5 {
  const katalog = i.kodeAksi.map((k) => AKSI_BY_KODE.get(k)).filter((a): a is AksiKatalog => !!a);
  const jembatan = [...new Set(katalog.map((a) => a.jembatan))].slice(0, 3);
  const qw = katalog.filter((a) => a.quickWin).map((a) => a.nama);
  return {
    h30:
      (qw.length ? `Quick win jalan: ${qw.join(', ')}. ` : '') +
      (jembatan.length
        ? `Jembatan aksi mulai bergerak: ${jembatan.join(', ')}.`
        : 'Aksi pilar bulan pertama sudah berjalan, baseline stabil.'),
    h60:
      (jembatan.length
        ? `Tren jembatan (${jembatan.join(', ')}) naik konsisten ≥ 4 minggu berturut`
        : 'Aksi pilar menunjukkan hasil awal') +
      `; GMV ${i.channel} mendekati floor ${i.floor != null ? rp(i.floor) : 'kontrak'}.`,
    h90:
      `GMV ${i.channel} mencapai stretch ${i.stretch != null ? rp(i.stretch) : 'target D-2'}` +
      '; leading indicator (D-6) stabil di jalur target.',
  };
}

// ===========================================================================
// Usulan pilar — Section E disusun dari payload baseline, di server
// ===========================================================================

function obj(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** Pecahan payload → persen, supaya satuannya sama dengan benchmark. */
function ke100(v: unknown): number | null {
  const n = angka(v);
  return n === null ? null : n * 100;
}

/**
 * Satu pembaca per metrik. Semuanya membaca jalur kunci BERSAMA antar schema
 * payload (aturan B2 §6.5 #1), jadi tidak ada cabang per platform di sini:
 * kunci yang sebuah platform tak punya jadi `null`, dan metrik `null` berarti
 * pemicunya tidak menyala — bukan menyala dengan nilai 0.
 */
export function bacaMetrik(payload: unknown): Readonly<Record<MetrikKunci, number | null>> {
  const p = obj(payload);
  const toko = obj(p?.toko);
  const produk = obj(p?.produk);
  const iklan = obj(p?.iklan);
  const afiliasi = obj(p?.afiliasi);
  const video = obj(p?.video);
  const live = obj(p?.live);
  const vT = obj(video?.toko);
  const vA = obj(video?.afiliasi);
  const lT = obj(live?.toko);
  const kreatorTotal = angka(afiliasi?.kreator_total);
  const kreatorPosting = angka(afiliasi?.kreator_posting);
  return {
    crToko: ke100(toko?.konversi),
    videoPostToko: angka(vT?.diposting_periode) ?? angka(vT?.aktif),
    videoSalesToko: ke100(vT?.rate),
    videoSalesAff: ke100(vA?.rate),
    gpmToko: angka(vT?.gpm_median),
    liveSesi: angka(lT?.sesi),
    liveJam: angka(lT?.jam),
    liveGmvJam: angka(lT?.gmv_per_jam),
    liveCtor: ke100(lT?.ctor_median),
    krSales: ke100(afiliasi?.rate_dari_posting),
    krKonsen: ke100(afiliasi?.top5_share),
    kreatorBelumPosting:
      kreatorTotal === null || kreatorPosting === null ? null : kreatorTotal - kreatorPosting,
    sampelTerkirim: angka(afiliasi?.sampel_terkirim),
    skuSales: ke100(produk?.rate),
    roas: angka(iklan?.roas),
    adsDep: ke100(iklan?.setara_persen_gmv),
  };
}

/** Nilai ambang sebuah pemicu, dibaca dari `benchmark_dipakai` payload. */
function nilaiAmbang(
  pemicu: Pemicu,
  bench: Record<string, unknown> | null,
): { nilai: number; nama: string } | null {
  if ('nilai' in pemicu.ambang) return pemicu.ambang;
  const v = angka(bench?.[pemicu.ambang.benchmark]);
  return v === null ? null : { nilai: v, nama: `benchmark ${pemicu.ambang.benchmark}` };
}

function menyala(nilai: number, ambang: number, banding: Pemicu['banding']): boolean {
  switch (banding) {
    case 'kurang':
      return nilai < ambang;
    case 'lebih':
      return nilai > ambang;
    case 'minimal':
      return nilai >= ambang;
    case 'samaDengan':
      return nilai === ambang;
  }
}

/** Satuan tampilan sebuah jembatan, supaya angka Rp tidak dicetak polos. */
function fmtNilai(v: number | null, unit: string): string {
  if (v === null) return '—';
  if (unit === 'Rp') return rp(v);
  if (unit === '%') return `${dec(v, 1)}%`;
  if (unit === 'x') return `${dec(v, 2)}×`;
  return `${dec(v, Math.abs(v) < 10 ? 1 : 0)} ${unit}`;
}

export interface UsulanAksi {
  kode: string;
  pilar: PilarKode;
  divisi: string;
  /** `strategi_pillar.jenis`. */
  jenis: string;
  nama: string;
  deskripsi: string;
  jembatan: string;
  unit: string;
  arah: ArahJembatan;
  mingguTerlihat: number;
  fieldIdBukti: string;
  quickWin: boolean;
  /** Angka jembatan sekarang dari payload; null ⇒ AM isi sekali di Plan. */
  nilaiSekarang: number | null;
  /** Target hitungan (±% diskalakan ke lama aksi). */
  targetHitung: number | null;
  /** Standar MEA yang mengunci aksi ini, bila ada — ditawarkan berdampingan. */
  aturanTerkunci: { nilai: number; label: string; sudahTerlampaui: boolean } | null;
  /** Kenapa aksi ini diusulkan, dari angka asli — template tetap. */
  alasan: string;
  /** Ringkasan siap simpan ke `strategi_pillar.target`. */
  target: string;
  /** Hanya V3: angle video yang sudah terbukti menjual. */
  angle: AngleVideo[];
  /** Kalimat jujur saat sebuah bagian tidak bisa disusun. */
  catatan: string | null;
}

export interface UsulanPilar {
  urutan: number;
  pilar: PilarKode;
  /** Label pengelompokan — masuk `detail`, BUKAN `peran` (`ck_strpil_peran`). */
  label: string;
  jenis: string;
  divisi: string;
  /** Skor pilar dari baseline (0..100), dasar urutannya. Null = tak terukur. */
  skorBaseline: number | null;
  aksi: UsulanAksi[];
}

export interface UsulanCopilot {
  schema: string | null;
  periodeReferensi: string | null;
  benchmarkVersi: number | null;
  /** false = payload lama / manual: nol usulan, dan halaman harus mengatakannya. */
  payloadTerbaca: boolean;
  pilar: UsulanPilar[];
  /** Kalimat BI tentang apa yang TIDAK bisa diusulkan dan kenapa. */
  catatan: string[];
}

/** Skema payload usulan — dicatat di `detail` tiap baris pilar. */
export const COPILOT_SCHEMA = 'cdps.copilot.usulan.v1';

/**
 * Susun usulan pilar Section E dari satu payload baseline.
 *
 * Deterministik dan tanpa AI: sebuah aksi diusulkan HANYA saat pemicunya menyala,
 * dan setiap pemicu adalah perbandingan satu metrik payload dengan satu ambang
 * `benchmark_dipakai` yang engine baseline sudah pakai untuk menilai toko itu.
 * Konsekuensinya yang disengaja: payload tanpa benchmark (atau tanpa metriknya)
 * menghasilkan usulan yang LEBIH SEDIKIT, tidak pernah usulan yang ditebak.
 *
 * Urutan pilar = skor baseline pilar itu, terlemah dulu — pilar yang paling
 * rusak dikerjakan lebih dulu. Pilar tanpa skor jatuh ke belakang: "tak terukur"
 * bukan alasan mendahulukan.
 *
 * Ini USULAN. Tidak ada baris yang tersimpan sebelum AM mencentangnya dan
 * `saveStrategiPillars` menulisnya.
 */
export function susunUsulan(payload: unknown): UsulanCopilot {
  const p = obj(payload);
  const bench = obj(p?.benchmark_dipakai);
  const metrik = bacaMetrik(payload);
  const skorPilar = obj(obj(p?.skor)?.pilar);
  const video = obj(p?.video);
  const angle = peringkatAngleVideo(video?.top_video);
  const terbaca = [obj(p?.toko), obj(p?.produk), obj(p?.iklan), obj(p?.afiliasi), video, obj(p?.live)].some(
    (x) => x !== null,
  );
  const catatan: string[] = [];

  if (!terbaca) {
    catatan.push(
      'Payload baseline klien ini tidak memuat blok analisa (baseline manual atau versi lama), ' +
        'jadi tidak ada aksi yang bisa diusulkan otomatis. Susun Section E manual, atau jalankan ' +
        'ulang Riset Awal dengan export platform.',
    );
  }
  if (terbaca && bench === null) {
    catatan.push(
      'Payload tidak mencatat benchmark yang dipakai, jadi aksi yang ambangnya dari benchmark ' +
        'tidak diusulkan. Ini bukan berarti tokonya sehat — hanya berarti pembandingnya tidak ada.',
    );
  }

  const perPilar = new Map<PilarKode, UsulanAksi[]>();
  for (const kat of KATALOG) {
    const nyala = evaluasiPemicu(kat, metrik, bench, angle);
    if (!nyala.menyala) continue;
    perPilar.set(kat.pilar, [...(perPilar.get(kat.pilar) ?? []), bangunAksi(kat, metrik, angle, nyala.alasan)]);
  }

  if (terbaca && angle.length === 0) {
    // Pemilik meminta angle video ikut sampai ke brief Creative. Kalau payload
    // tidak membawanya, pilar konten tetap disusun — TANPA blok angle — dan
    // halaman mengatakannya, bukan diam-diam mengirim brief tanpa angle.
    catatan.push(
      'Payload tidak membawa daftar video teratas (`video.top_video`), jadi pilar konten disusun ' +
        'tanpa blok angle video. Angle-nya diisi Creative dari Papan Video Factory.',
    );
  }

  const pilar: UsulanPilar[] = [...perPilar.entries()]
    .map(([kode, aksi]) => ({
      kode,
      aksi,
      skorBaseline: angka(skorPilar?.[PILAR_KE_SKOR[kode]]),
    }))
    .sort((a, b) => {
      // Terlemah dulu. Skor absen = tak terukur ⇒ ke belakang, karena
      // "tidak tahu" bukan alasan mendahulukan sebuah pilar.
      const sa = a.skorBaseline ?? Number.POSITIVE_INFINITY;
      const sb = b.skorBaseline ?? Number.POSITIVE_INFINITY;
      if (sa !== sb) return sa - sb;
      return a.kode.localeCompare(b.kode);
    })
    .map((x, i) => ({
      urutan: i + 1,
      pilar: x.kode,
      label: `Pilar ${i + 1} — ${x.kode}`,
      jenis: PILAR_KE_JENIS[x.kode],
      divisi: x.aksi[0].divisi,
      skorBaseline: x.skorBaseline,
      aksi: x.aksi,
    }));

  return {
    schema: typeof p?.schema === 'string' ? p.schema : null,
    periodeReferensi:
      typeof obj(p?.klien)?.periode_referensi === 'string'
        ? (obj(p?.klien)!.periode_referensi as string)
        : null,
    benchmarkVersi: angka(p?.benchmark_versi),
    payloadTerbaca: terbaca,
    pilar,
    catatan,
  };
}

function evaluasiPemicu(
  kat: AksiKatalog,
  metrik: Readonly<Record<MetrikKunci, number | null>>,
  bench: Record<string, unknown> | null,
  angle: readonly AngleVideo[],
): { menyala: boolean; alasan: string } {
  // V3 adalah satu-satunya aksi yang dipicu oleh ADANYA bukti, bukan oleh sebuah
  // ambang: kalau ada video yang sudah menjual, angle-nya layak direplikasi.
  if (kat.kode === 'V3') {
    return angle.length > 0
      ? {
          menyala: true,
          alasan: `${angle.length} video sudah terbukti menjual di periode baseline — angle-nya bisa direplikasi, jangan mulai dari nol`,
        }
      : { menyala: false, alasan: '' };
  }
  if (kat.pemicu.length === 0) return { menyala: false, alasan: '' };

  const potongan: string[] = [];
  for (const pm of kat.pemicu) {
    const nilai = metrik[pm.metrik];
    if (nilai === null) return { menyala: false, alasan: '' };
    const amb = nilaiAmbang(pm, bench);
    if (amb === null) return { menyala: false, alasan: '' };
    if (!menyala(nilai, amb.nilai, pm.banding)) return { menyala: false, alasan: '' };
    potongan.push(`${pm.metrik} ${dec(nilai, 2)} ${KATA_BANDING[pm.banding]} ${dec(amb.nilai, 2)} (${amb.nama})`);
  }
  return { menyala: true, alasan: potongan.join(' dan ') };
}

const KATA_BANDING: Readonly<Record<Pemicu['banding'], string>> = {
  kurang: 'di bawah',
  lebih: 'di atas',
  minimal: 'sudah mencapai',
  samaDengan: 'sama dengan',
};

function bangunAksi(
  kat: AksiKatalog,
  metrik: Readonly<Record<MetrikKunci, number | null>>,
  angle: readonly AngleVideo[],
  alasan: string,
): UsulanAksi {
  const sekarang = kat.sumberNilai ? metrik[kat.sumberNilai] : null;
  const amb = skalaAmbisi(kat.minggu);
  const targetHitung =
    sekarang === null
      ? null
      : bulat(kat.arah === 'naik' ? sekarang * (1 + amb / 100) : sekarang * (1 - amb / 100));
  const kunci = ATURAN_TERKUNCI[kat.kode] ?? null;
  const aturanTerkunci =
    kunci === null
      ? null
      : {
          ...kunci,
          // Kalau angka sekarang sudah melewati standar MEA, standar itu jadi
          // target yang MUNDUR — dilaporkan sebagai sudah terlampaui, tidak
          // ditawarkan sebagai pilihan.
          sudahTerlampaui:
            sekarang !== null &&
            (kat.arah === 'naik' ? sekarang >= kunci.nilai : sekarang <= kunci.nilai),
        };

  const target =
    targetHitung === null
      ? `jembatan ${kat.jembatan} (${kat.unit}, harus ${kat.arah}) — angka sekarang belum ada di payload, isi sekali sebelum periode berjalan`
      : `jembatan ${kat.jembatan}: ${fmtNilai(sekarang, kat.unit)} → ${fmtNilai(targetHitung, kat.unit)} dalam ${kat.minggu} minggu`;

  const isAngle = kat.kode === 'V3';
  return {
    kode: kat.kode,
    pilar: kat.pilar,
    divisi: kat.divisi,
    jenis: PILAR_KE_JENIS[kat.pilar],
    nama: kat.nama,
    deskripsi: kat.deskripsi,
    jembatan: kat.jembatan,
    unit: kat.unit,
    arah: kat.arah,
    mingguTerlihat: kat.minggu,
    fieldIdBukti: kat.fieldIdBukti,
    quickWin: kat.quickWin,
    nilaiSekarang: sekarang,
    targetHitung,
    aturanTerkunci,
    alasan,
    target,
    angle: isAngle ? [...angle] : [],
    catatan:
      isAngle && angle.length === 0
        ? 'Payload tidak membawa video teratas — aksi ini disusun tanpa blok angle.'
        : null,
  };
}
