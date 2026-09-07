/**
 * Mesin accrual — KAPAN dan BERAPA pendapatan sebuah layanan yang sudah dibeli
 * diakui, per BULAN KALENDER (Gelombang D).
 *
 * APA MODUL INI ADALAH. Satu fungsi murni. Ia menerima gambaran satu layanan
 * terbeli — nilai brutonya, penanda `pengakuan` dari katalog, tanggal mulai
 * jalannya, riwayat hold, dan tanggal void kalau ada — dan menjawab: bulan mana
 * mengakui berapa, berapa yang HANGUS, dan berapa yang BELUM bisa diakui. Ia
 * tidak menyentuh DB, tidak tahu tentang aktor atau izin, dan tidak menyimpan
 * apa pun: seluruh jadwalnya bisa dihitung ulang dari masukan yang sama, kapan
 * pun (aturan rumah #4).
 *
 * LIMA KETOKAN PEMILIK YANG DIWUJUDKANNYA (2026-09-07, Nerissa/COO):
 *
 *   D-1  HANGUS. Layanan yang di-void di tengah periode diakui HANYA untuk hari
 *        yang sudah jalan. Sisanya tidak pernah diakui — dan penting: ia juga
 *        tidak menggantung sebagai "belum". Uang yang hangus punya embernya
 *        sendiri, karena "hilang" dan "belum datang" adalah dua kalimat berbeda
 *        di rapat penutupan buku.
 *   D-2  `[On Hold]` MENJEDA pengakuan. Hari hold mengakui nol DAN menggeser
 *        garis finish sepanjang hold itu, jadi jumlah hari yang diakui selalu
 *        tetap — yang bergeser adalah BULAN tempat hari-hari itu jatuh.
 *   D-3  Buku ditutup PER BULAN. Karena itu satuan keluaran modul ini adalah
 *        bulan kalender (`YYYY-MM`), bukan "periode ke-n": angka yang dibekukan
 *        harus punya bulan, dan satu bulan tidak boleh punya dua baris.
 *   D-4  Nilai yang masuk ke sini BRUTO. Mesin ini TIDAK menghitung PPN, tidak
 *        mengurangi apa pun, dan tidak punya pendapat soal pajak — pilihan PPN
 *        adalah penanda per transaksi yang dibaca di lapisan lain.
 *   D-KOM Tiga nilai `pengakuan` di katalog memutuskan bentuk jadwalnya.
 *
 * SATU ATURAN UNTUK VOID, DIPAKAI KETIGA PENGAKUAN. `tanggalVoid` adalah hari
 * PERTAMA yang tidak diakui. Sesuatu diakui kalau titik pengakuannya jatuh
 * SEBELUM tanggal itu — hari ke-11 tidak diakui saat void 11 Januari; layanan
 * sekali-jadi tidak diakui saat void pada hari selesainya; komisi tidak diakui
 * saat void pada tanggal 1 bulan pengakuannya. Satu aturan, tiga cabang, nol
 * kekecualian yang harus diingat.
 *
 * KENAPA PRO-RATA PER HARI DAN BUKAN "SATU PERIODE = SATU BULAN". Sebuah
 * layanan 1 bulan yang mulai 15 Maret berjalan sampai 15 April; separuh
 * pendapatannya milik Maret dan separuh milik April. Menaruh seluruhnya di
 * bulan MULAI-nya akan melaporkan pendapatan April di Maret — dan begitu D-3
 * menutup Maret, angka itu tidak bisa diperbaiki lagi kecuali lewat jurnal
 * koreksi. Pro-rata harian juga membuat D-1 jatuh sendiri alih-alih jadi cabang
 * khusus: "hari yang sudah jalan" adalah satuan yang sama yang dipakai
 * sehari-hari, bukan satuan kedua yang hanya hidup saat ada void.
 *
 * ⚠️ BACAAN "rata sepanjang durasi_bulan" YANG DIPILIH DI SINI. Ketokan D-KOM
 * menulis `per_periode` = "diakui rata sepanjang `durasi_bulan`" tanpa menyebut
 * granularitasnya, dan D-1 menuntut ketelitian HARI. Modul ini membacanya
 * sebagai rata PER HARI, dengan alasan di paragraf sebelumnya. Bacaan
 * alternatifnya — 1/n penuh di setiap bulan mulai periode — dicatat sebagai
 * pertanyaan terbuka di `docs/DECISIONS.md` (D-ACC-1) supaya pemilik bisa
 * membalikkannya; kalau dibalik, yang berubah HANYA `jadwalPerPeriode` di
 * berkas ini, bukan pemanggilnya.
 *
 * PEMBULATAN. Setiap bulan dibulatkan ke rupiah penuh (`money.proRata`,
 * setengah ke atas), tapi yang dibulatkan adalah KUMULATIF-nya, bukan tiap
 * bulan sendiri-sendiri, dan titik kumulatif terakhir dipaku persis ke nilai
 * bruto. Akibatnya Σ baris SELALU sama dengan yang diakui — sen dan sisa
 * pembagian jatuh di bulan terakhir, tempat akuntan memang mencarinya, bukan
 * menguap beberapa rupiah per layanan per klien selamanya.
 */

import * as money from './money';
import * as tz from './tz';

/**
 * Masukan mesin ini tidak masuk akal — bukan sebuah kegagalan validasi yang
 * boleh ditampilkan ke pengguna, tapi kombinasi yang TIDAK BISA dieksekusi
 * (`per_periode` tanpa durasi, hold yang selesainya mendahului mulainya, qty
 * nol). Ia meledak alih-alih mengarang jadwal, karena jadwal karangan di
 * laporan keuangan tidak kelihatan salah.
 *
 * Pesannya Inggris dan tanpa `[...]`: ini bukan pesan validasi rumah (aturan
 * rumah #5), ini invariant programmer — jalur pengguna sudah dijaga lebih dulu
 * oleh CHECK di DB dan gerbang `msl.normalizeInput`.
 */
export class AccrualInputError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'AccrualInputError';
  }
}

// ---------------------------------------------------------------------------
// Kosakata
// ---------------------------------------------------------------------------

/**
 * KAPAN pendapatan sebuah layanan diakui — penanda `pengakuan` di
 * `master_service_versions` (ketokan D-KOM, opsi a).
 *
 * Ketiganya persis kosakata yang ditegakkan `ck_msv_pengakuan`. Kalau daftar di
 * sini dan CHECK di sana berbeda, salah satunya akan diam-diam meloloskan nilai
 * yang satunya tolak — jadi tes modul ini mengadu urutan dan isinya.
 */
export type Pengakuan = 'per_periode' | 'saat_selesai' | 'bulan_berikutnya';

export const PENGAKUAN_PER_PERIODE: Pengakuan = 'per_periode';
export const PENGAKUAN_SAAT_SELESAI: Pengakuan = 'saat_selesai';
export const PENGAKUAN_BULAN_BERIKUTNYA: Pengakuan = 'bulan_berikutnya';

/** Ketiga nilai, urut sebagaimana ditulis ketokan D-KOM. */
export const PENGAKUAN_SEMUA: readonly Pengakuan[] = [
  PENGAKUAN_PER_PERIODE,
  PENGAKUAN_SAAT_SELESAI,
  PENGAKUAN_BULAN_BERIKUTNYA,
];

/**
 * Kalimat Bahasa Indonesia per nilai, dipakai form MSL dan halaman laporan apa
 * adanya. Ada di sini, bukan di JSX, supaya admin katalog dan mesin accrual
 * tidak pernah menjelaskan penanda yang sama dengan dua kalimat berbeda.
 */
export const PENGAKUAN_KALIMAT: Readonly<Record<Pengakuan, string>> = {
  per_periode: 'diakui rata sepanjang durasi jasa (mis. GMV Max, Store Management)',
  saat_selesai: 'diakui penuh saat pekerjaannya selesai — layanan sekali jadi (mis. Jasa Pengajuan Shopee Mall, Nano KOL)',
  bulan_berikutnya: 'diakui satu bulan sesudah penjualannya, karena angkanya baru diketahui bulan depan (Komisi)',
};

/** Apa yang ditambah qty yang dibeli klien — kosakata `qty_menambah` (Q3). */
export type QtyMenambah = 'durasi' | 'volume';

/**
 * Kenapa sebuah layanan tidak punya satu baris jadwal pun. Dipisah menjadi dua
 * keluarga yang SENGAJA tidak boleh tertukar:
 *
 *   `belum_*` / `hold_*`  belum diketahui — uangnya masih akan datang;
 *   `void_*`              sudah diputus — uangnya HANGUS dan tidak akan datang.
 *
 * Keduanya tampak sama di halaman yang hanya menulis "belum ada data", dan
 * itulah kenapa masing-masing membawa kodenya sendiri: yang pertama
 * ditindaklanjuti dengan mengisi tanggal, yang kedua dengan menutup buku
 * (aturan kerja #4 — ketiadaan yang diam tidak bisa dibedakan dari kerusakan).
 */
export type AlasanKosong =
  | 'belum_mulai_jalan'
  | 'belum_selesai'
  | 'belum_ada_penjualan'
  | 'hold_sejak_awal'
  | 'void_sebelum_mulai'
  | 'void_sebelum_selesai'
  | 'void_sebelum_diakui';

/** Semua alasan, untuk tes kelengkapan kalimat + iterasi di UI. */
export const ALASAN_SEMUA: readonly AlasanKosong[] = [
  'belum_mulai_jalan',
  'belum_selesai',
  'belum_ada_penjualan',
  'hold_sejak_awal',
  'void_sebelum_mulai',
  'void_sebelum_selesai',
  'void_sebelum_diakui',
];

/** Kalimat Bahasa Indonesia per alasan, dipakai halaman apa adanya. */
export const ALASAN_KALIMAT: Readonly<Record<AlasanKosong, string>> = {
  belum_mulai_jalan: 'layanan ini belum punya tanggal mulai jalan, jadi periodenya belum bisa dihitung',
  belum_selesai: 'layanan sekali-jadi ini belum selesai, dan pendapatannya diakui penuh saat selesai',
  belum_ada_penjualan: 'belum ada penjualan yang melahirkannya, jadi bulan pengakuannya belum ada',
  hold_sejak_awal: 'layanan ini sudah di-hold sejak hari pertamanya, jadi belum ada satu hari pun yang berjalan',
  void_sebelum_mulai: 'layanan ini di-void sebelum satu hari pun berjalan, jadi seluruh nilainya hangus',
  void_sebelum_selesai: 'layanan ini di-void sebelum selesai, dan layanan sekali-jadi tidak punya hari untuk dipro-rata, jadi seluruh nilainya hangus',
  void_sebelum_diakui: 'layanan ini di-void sebelum bulan pengakuannya tiba, jadi seluruh nilainya hangus',
};

/**
 * belumDiketahui memisahkan "uangnya masih akan datang" dari "uangnya hangus".
 * Satu fungsi, bukan dua daftar yang harus diingat pemanggil — dan bukan
 * `alasan.startsWith('belum')`, yang akan salah untuk `hold_sejak_awal`.
 */
export function belumDiketahui(alasan: AlasanKosong): boolean {
  return alasan === 'belum_mulai_jalan'
    || alasan === 'belum_selesai'
    || alasan === 'belum_ada_penjualan'
    || alasan === 'hold_sejak_awal';
}

// ---------------------------------------------------------------------------
// Bentuk masukan & keluaran
// ---------------------------------------------------------------------------

/**
 * Satu jendela hold, HALF-OPEN: `[mulai, selesai)`. `selesai === null` berarti
 * hold-nya MASIH BERJALAN.
 *
 * Riwayat ini diturunkan pemanggil dari `audit_log` — pola yang sama yang sudah
 * dipakai `ads.computeTotalHariHold` untuk transisi `[Active]->[Paused]->
 * [Active]`. Mesin ini tidak tahu dari mana asalnya, dan itu disengaja: satu
 * hari nanti hold bisa datang dari mesin status yang lain.
 */
export interface Hold {
  mulai: string;
  selesai: string | null;
}

/** Satu layanan yang sudah dibeli klien, seringkas yang penjadwalan butuhkan. */
export interface LayananTerbeli {
  /**
   * Nilai BRUTO (D-4) dalam minor unit `money.Money`. Mesin ini tidak
   * menghitung PPN dan tidak mengurangi apa pun — pilihan PPN adalah penanda
   * per transaksi yang dibaca di lapisan lain.
   */
  nilaiBruto: money.Money;
  pengakuan: Pengakuan;
  /**
   * Hari PERTAMA layanan jalan (`YYYY-MM-DD`, WIB). Untuk Ads: start campaign —
   * periode riset tidak dihitung (ketokan Q4). Wajib untuk `per_periode`; tidak
   * dipakai dua pengakuan lainnya.
   */
  tanggalMulai?: string | null;
  /**
   * Durasi TOTAL dalam bulan kalender, qty SUDAH dikalikan — pakai
   * `durasiTotalBulan` supaya formulanya tidak diulang di pemanggil. Wajib untuk
   * `per_periode`.
   */
  durasiBulanTotal?: number | null;
  /** Riwayat hold; urutan tidak penting, tumpang-tindih & bersarang diterima. */
  holds?: readonly Hold[];
  /** Hari PERTAMA yang tidak diakui (D-1). `null` = tidak di-void. */
  tanggalVoid?: string | null;
  /** Hari layanan sekali-jadi dinyatakan selesai — wajib untuk `saat_selesai`. */
  tanggalSelesai?: string | null;
  /** Tanggal penjualan yang melahirkannya — wajib untuk `bulan_berikutnya`. */
  tanggalPenjualan?: string | null;
}

/** Satu bulan kalender dan berapa yang diakui di dalamnya. */
export interface BarisJadwal {
  /** `YYYY-MM` — satuan yang D-3 kunci. */
  bulan: string;
  nilai: money.Money;
}

/** Periode jalan yang benar-benar terjadi — hanya ada untuk `per_periode`. */
export interface PeriodeJalan {
  mulai: string;
  /**
   * Hari pertama SESUDAH periode berjalan. `null` hanya saat jadwalnya
   * terpotong hold yang masih berjalan: tanggal itu belum bisa diketahui siapa
   * pun, dan menebaknya berarti menaruh angka karangan di laporan.
   */
  akhirEksklusif: string | null;
  /** Hari yang HARUS dijalani supaya nilainya diakui penuh — penyebut pro-rata. */
  hariTotal: number;
  /** Hari yang BENAR-BENAR sudah dijalani (< hariTotal saat void/hold berjalan). */
  hariAktif: number;
  /** Hari hold yang dilewati (gabungan; hold bersarang tidak dihitung dua kali). */
  hariHold: number;
}

/** Jadwal pengakuan satu layanan terbeli. */
export interface Jadwal {
  /** Satu baris per bulan kalender, urut naik, tidak pernah berulang. */
  baris: readonly BarisJadwal[];
  /** Σ `baris` — yang sudah/akan diakui menurut jadwal ini. */
  diakui: money.Money;
  /** Yang TIDAK akan pernah diakui karena void (D-1). */
  hangus: money.Money;
  /** Yang belum bisa dijadwalkan — bukan hangus, hanya belum diketahui. */
  belumDiakui: money.Money;
  /**
   * Invariant yang dijaga tes: `nilaiBruto = diakui + hangus + belumDiakui`,
   * untuk SETIAP bentuk masukan, tanpa kecuali.
   */
  alasanKosong: AlasanKosong | null;
  /**
   * `true` saat jadwalnya berhenti di sebuah hold yang MASIH berjalan. D-2
   * menuntut skedul dihitung ulang saat hold selesai; sampai itu terjadi, sisa
   * bulannya belum bisa diketahui, dan halaman wajib mengatakannya alih-alih
   * menampilkan jadwal yang terlihat lengkap.
   */
  terpotongHold: boolean;
  /** Periode jalan, `null` untuk pengakuan yang tidak punya periode. */
  periode: PeriodeJalan | null;
}

// ---------------------------------------------------------------------------
// durasiTotalBulan — formula §3 handoff, hidup sebagai kode
// ---------------------------------------------------------------------------

/**
 * durasiTotalBulan menerapkan ketokan Q3: apa yang ditambah qty yang dibeli.
 *
 *   qty_menambah = 'durasi'  ⇒  durasi total = qty × durasi_bulan
 *   qty_menambah = 'volume'  ⇒  durasi total = durasi_bulan (qty tidak mengubahnya)
 *   durasi_bulan = null      ⇒  null — tidak punya periode sama sekali
 *
 * `Nano KOL` beli 10 adalah 10 KOL dalam SATU pekerjaan, bukan kontrak 10 bulan;
 * `GMV MAX MEA PRO` (6 bulan, `durasi`) beli 2 adalah 12 bulan. Formulanya
 * hidup di sini, satu kali, karena setiap pemanggil yang menuliskannya sendiri
 * adalah satu tempat lagi yang bisa memukul rata "qty = bulan" — dan itu
 * menyebar pendapatan Nano KOL ke sepuluh bulan yang tidak pernah ada.
 */
export function durasiTotalBulan(
  durasiBulan: number | null,
  qtyMenambah: QtyMenambah,
  qty: number,
): number | null {
  if (!Number.isInteger(qty) || qty <= 0) {
    throw new AccrualInputError(`qty must be a whole positive number: ${qty}`);
  }
  if (qtyMenambah === 'durasi') {
    if (durasiBulan === null) {
      throw new AccrualInputError('qty_menambah=durasi requires a durasi_bulan — qty would multiply nothing');
    }
    return durasiBulan * qty;
  }
  return durasiBulan;
}

// ---------------------------------------------------------------------------
// jadwalkan
// ---------------------------------------------------------------------------

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * jadwalkan menghitung jadwal pengakuan satu layanan terbeli. Murni,
 * deterministik, dan tidak mengubah masukannya.
 */
export function jadwalkan(inp: LayananTerbeli): Jadwal {
  if (!PENGAKUAN_SEMUA.includes(inp.pengakuan)) {
    throw new AccrualInputError(`unknown pengakuan: ${JSON.stringify(inp.pengakuan)}`);
  }
  if (inp.nilaiBruto < 0n) {
    throw new AccrualInputError('nilaiBruto must not be negative');
  }
  const mulai = tanggal(inp.tanggalMulai, 'tanggalMulai');
  const selesai = tanggal(inp.tanggalSelesai, 'tanggalSelesai');
  const penjualan = tanggal(inp.tanggalPenjualan, 'tanggalPenjualan');
  const voidPada = tanggal(inp.tanggalVoid, 'tanggalVoid');

  switch (inp.pengakuan) {
    case 'saat_selesai':
      return jadwalSekaliJadi(inp.nilaiBruto, selesai, voidPada);
    case 'bulan_berikutnya':
      return jadwalBulanBerikutnya(inp.nilaiBruto, penjualan, voidPada);
    default:
      return jadwalPerPeriode(inp.nilaiBruto, mulai, inp.durasiBulanTotal, inp.holds, voidPada);
  }
}

/**
 * `saat_selesai` — diakui PENUH di bulan kalender saat pekerjaannya selesai.
 *
 * Durasi dan hold sengaja tidak dibaca: layanan sekali-jadi tidak punya periode,
 * jadi tidak ada apa pun untuk dijeda atau dipro-rata. Void sebelum selesai
 * karena itu menghanguskan SELURUHNYA, bukan separuh — hak akuinya baru lahir
 * di hari selesai, dan hari itu tidak pernah datang.
 */
function jadwalSekaliJadi(
  nilaiBruto: money.Money,
  selesai: string | null,
  voidPada: string | null,
): Jadwal {
  if (selesai !== null && (voidPada === null || selesai < voidPada)) {
    return {
      baris: [{ bulan: selesai.slice(0, 7), nilai: nilaiBruto }],
      diakui: nilaiBruto, hangus: 0n, belumDiakui: 0n,
      alasanKosong: null, terpotongHold: false, periode: null,
    };
  }
  if (voidPada !== null) {
    return kosong(nilaiBruto, 'void_sebelum_selesai', 'hangus');
  }
  return kosong(nilaiBruto, 'belum_selesai', 'belum');
}

/**
 * `bulan_berikutnya` — diakui PENUH satu bulan kalender sesudah bulan
 * penjualannya (Komisi). Nilainya diinput Sales per transaksi; yang dihitung di
 * sini hanya bulannya.
 *
 * Titik pengakuannya adalah tanggal 1 bulan itu, jadi aturan void yang sama
 * berlaku: diakui kalau tanggal 1 itu jatuh SEBELUM tanggal void.
 */
function jadwalBulanBerikutnya(
  nilaiBruto: money.Money,
  penjualan: string | null,
  voidPada: string | null,
): Jadwal {
  if (penjualan === null) {
    return voidPada !== null
      ? kosong(nilaiBruto, 'void_sebelum_diakui', 'hangus')
      : kosong(nilaiBruto, 'belum_ada_penjualan', 'belum');
  }
  const titik = tz.addMonthsToDate(`${penjualan.slice(0, 7)}-01`, 1);
  if (voidPada !== null && titik >= voidPada) {
    return kosong(nilaiBruto, 'void_sebelum_diakui', 'hangus');
  }
  return {
    baris: [{ bulan: titik.slice(0, 7), nilai: nilaiBruto }],
    diakui: nilaiBruto, hangus: 0n, belumDiakui: 0n,
    alasanKosong: null, terpotongHold: false, periode: null,
  };
}

/**
 * `per_periode` — nilai bruto disebar rata PER HARI sepanjang periode, lalu
 * dijumlah per bulan kalender.
 *
 * Bentuknya: periode `[mulai, mulai + n BULAN)` menentukan BERAPA HARI yang
 * harus dijalani (`hariTotal`, penyebut pro-rata dan satu-satunya angka yang
 * tidak pernah bergeser). Hari hold tidak menghitung, jadi garis finish mundur
 * sepanjang hold — jumlah hari yang diakui tetap, bulan tempatnya jatuh yang
 * berubah (D-2). Void menghentikan penjalanan di hari itu (D-1).
 *
 * Batas periodenya kalender-aware lewat `tz.addMonthsToDate`: mulai 31 Januari
 * + 1 bulan adalah 28 Februari, bukan 2 Maret. Selisih beberapa hari per periode
 * berhenti jadi detail pembulatan begitu D-3 mengunci buku PER BULAN.
 */
function jadwalPerPeriode(
  nilaiBruto: money.Money,
  mulai: string | null,
  durasiBulanTotal: number | null | undefined,
  holdsMasuk: readonly Hold[] | undefined,
  voidPada: string | null,
): Jadwal {
  // Durasi diperiksa DULU, sebelum tanggal mulai: `per_periode` tanpa durasi
  // adalah masukan yang tidak bisa dieksekusi (dan ditolak DB oleh
  // `ck_msv_pengakuan_periode_butuh_durasi_bulan`), sedangkan tanpa tanggal
  // mulai ia sekadar belum bisa dijadwalkan — galat vs keadaan.
  if (durasiBulanTotal === null || durasiBulanTotal === undefined) {
    throw new AccrualInputError('pengakuan=per_periode requires durasiBulanTotal — "rata sepanjang durasi" has nothing to divide');
  }
  if (!Number.isInteger(durasiBulanTotal) || durasiBulanTotal <= 0) {
    throw new AccrualInputError(`durasiBulanTotal must be a whole positive number of months: ${durasiBulanTotal}`);
  }
  const holds = holdTerurut(holdsMasuk);
  if (mulai === null) {
    return voidPada !== null
      ? kosong(nilaiBruto, 'void_sebelum_mulai', 'hangus')
      : kosong(nilaiBruto, 'belum_mulai_jalan', 'belum');
  }

  const hariTotal = tz.daysBetweenDate(mulai, tz.addMonthsToDate(mulai, durasiBulanTotal));
  const perBulan = new Map<string, number>();
  let sisaAktif = hariTotal;
  let hariHold = 0;
  let kursor = mulai;
  let terpotongHold = false;

  while (sisaAktif > 0) {
    if (voidPada !== null && kursor >= voidPada) {
      break;
    }
    const hold = holdBerikut(holds, kursor);
    if (hold !== null && hold.mulai <= kursor) {
      // Di DALAM hold: lewati, dan catat hari hold-nya. Hold yang masih
      // berjalan memotong jadwal di sini — tanggal selesainya belum diketahui
      // siapa pun, jadi bulan-bulan sisanya juga belum.
      if (hold.selesai === null) {
        terpotongHold = true;
        break;
      }
      const batas = voidPada !== null && voidPada < hold.selesai ? voidPada : hold.selesai;
      hariHold += tz.daysBetweenDate(kursor, batas);
      kursor = hold.selesai;
      continue;
    }
    // Sebuah rentang AKTIF sampai hold berikutnya (atau sampai sisa habis).
    let ambil = hold === null ? sisaAktif : Math.min(sisaAktif, tz.daysBetweenDate(kursor, hold.mulai));
    if (voidPada !== null) {
      ambil = Math.min(ambil, tz.daysBetweenDate(kursor, voidPada));
    }
    tambahPerBulan(perBulan, kursor, ambil);
    kursor = tz.addDaysToDate(kursor, ambil);
    sisaAktif -= ambil;
  }

  const hariAktif = hariTotal - sisaAktif;
  const diVoid = sisaAktif > 0 && !terpotongHold;
  const periode: PeriodeJalan = {
    mulai,
    // Selesai penuh ⇒ kursor adalah hari pertama sesudahnya. Di-void ⇒ tanggal
    // void, hari pertama yang tidak diakui. Terpotong hold ⇒ belum diketahui.
    akhirEksklusif: terpotongHold ? null : diVoid ? voidPada : kursor,
    hariTotal, hariAktif, hariHold,
  };

  const baris: BarisJadwal[] = [];
  let kumulatifHari = 0;
  let kumulatifNilai = 0n;
  for (const [bulan, hari] of perBulan) {
    kumulatifHari += hari;
    const sampai = nilaiKumulatif(nilaiBruto, kumulatifHari, hariTotal);
    baris.push({ bulan, nilai: sampai - kumulatifNilai });
    kumulatifNilai = sampai;
  }
  const diakui = kumulatifNilai;
  const sisa = nilaiBruto - diakui;

  return {
    baris,
    diakui,
    hangus: diVoid ? sisa : 0n,
    belumDiakui: diVoid ? 0n : sisa,
    // Nol baris hanya bisa lahir dari dua sebab, dan keduanya sudah diputuskan
    // di atas: void yang jatuh pada/sebelum hari mulai, atau hold yang sudah
    // berjalan sejak hari mulai. Periode terpendek pun 28 hari, jadi tidak ada
    // cabang ketiga yang bisa menghasilkan jadwal kosong — dan kalau void dan
    // hold sama-sama ada di hari pertama, void yang memutuskan (uangnya hangus,
    // bukan menunggu).
    alasanKosong: baris.length === 0 ? (diVoid ? 'void_sebelum_mulai' : 'hold_sejak_awal') : null,
    terpotongHold,
    periode,
  };
}

/**
 * nilaiKumulatif mengembalikan berapa yang diakui sesudah `hari` hari aktif.
 *
 * Yang dibulatkan adalah KUMULATIFNYA, dan tiap bulan lahir sebagai SELISIH dua
 * titik kumulatif — bukan tiap bulan dibulatkan sendiri lalu dijumlah, yang
 * membuat Σ meleset dan melesetnya menetap di buku. Titik terakhir
 * (`hari === hariTotal`) dipaku persis ke nilai bruto, jadi sisa pembagian dan
 * sen jatuh di bulan TERAKHIR — cara pembagian termin yang sama yang dipakai
 * akuntan, dan satu-satunya cara Σ bisa sama persis untuk nilai yang tidak habis
 * dibagi jumlah harinya.
 */
function nilaiKumulatif(nilaiBruto: money.Money, hari: number, hariTotal: number): money.Money {
  if (hari >= hariTotal) {
    return nilaiBruto;
  }
  return money.proRata(nilaiBruto, BigInt(hari), BigInt(hariTotal));
}

/** tambahPerBulan membagi `hari` hari sejak `dari` ke bulan-bulan kalendernya. */
function tambahPerBulan(perBulan: Map<string, number>, dari: string, hari: number): void {
  let d = dari;
  let sisa = hari;
  while (sisa > 0) {
    const bulan = d.slice(0, 7);
    const awalBulanBerikut = tz.addMonthsToDate(`${bulan}-01`, 1);
    const n = Math.min(sisa, tz.daysBetweenDate(d, awalBulanBerikut));
    perBulan.set(bulan, (perBulan.get(bulan) ?? 0) + n);
    d = tz.addDaysToDate(d, n);
    sisa -= n;
  }
}

/**
 * holdTerurut memvalidasi jendela hold lalu mengurutnya menaik menurut `mulai`.
 *
 * URUTANNYA WAJIB, dan itu satu-satunya hal yang fungsi ini lakukan selain
 * memeriksa bentuk: `holdBerikut` mengambil hold PERTAMA yang belum lewat, jadi
 * daftar yang tidak urut membuatnya melewatkan hold yang datang lebih dulu dan
 * menghitung hari hold sebagai hari aktif. Tesnya ada — membalik urutan masukan
 * tidak boleh mengubah hasil.
 *
 * TIDAK ADA PENGGABUNGAN INTERVAL DI SINI, dan itu disengaja. Sifat "hold
 * bersarang / tumpang-tindih dihitung sebagai GABUNGAN hari, bukan penjumlahan"
 * lahir dari penjalanannya sendiri: saat kursor berada di dalam sebuah hold ia
 * melompat ke `selesai` hold itu, lalu bertanya lagi — jadi hari yang di-hold
 * dua kali tetap satu hari, tanpa satu baris kode pun yang khusus untuk itu.
 * Versi pertama modul ini MENGGABUNG interval lebih dulu; mutasi sengaja yang
 * mencabut penggabungan itu tidak bisa membuat satu tes pun merah (aturan kerja
 * #2), yang membuktikan ia salinan kedua dari aturan yang sama — dan salinan
 * kedua dari aturan bisnis adalah hal yang paling dihindari repo ini. Yang
 * menjaganya sekarang adalah tes hold bersarang, tumpang-tindih separuh, dan
 * berulang di `accrual.test.ts`.
 *
 * Salinan, bukan urut di tempat: pemanggil yang menyimpan array-nya untuk
 * keperluan lain tidak boleh menemukannya berubah tanpa sebab yang kelihatan.
 */
function holdTerurut(holds: readonly Hold[] | undefined): Hold[] {
  if (holds === undefined || holds.length === 0) {
    return [];
  }
  return holds
    .map((h) => {
      const mulai = tanggal(h.mulai, 'hold.mulai');
      const selesai = tanggal(h.selesai, 'hold.selesai');
      if (mulai === null) {
        throw new AccrualInputError('hold.mulai is required');
      }
      if (selesai !== null && selesai < mulai) {
        throw new AccrualInputError(`hold ends before it starts: ${mulai} -> ${selesai}`);
      }
      return { mulai, selesai };
    })
    .sort((a, b) => (a.mulai === b.mulai ? 0 : a.mulai < b.mulai ? -1 : 1));
}

/** holdBerikut: hold pertama yang belum lewat pada `kursor` (menutupinya, atau sesudahnya). */
function holdBerikut(holds: readonly Hold[], kursor: string): Hold | null {
  for (const h of holds) {
    if (h.selesai === null || h.selesai > kursor) {
      return h;
    }
  }
  return null;
}

/** Jadwal tanpa satu baris pun, dengan seluruh nilainya di ember yang tepat. */
function kosong(
  nilaiBruto: money.Money,
  alasan: AlasanKosong,
  ember: 'hangus' | 'belum',
): Jadwal {
  return {
    baris: [],
    diakui: 0n,
    hangus: ember === 'hangus' ? nilaiBruto : 0n,
    belumDiakui: ember === 'belum' ? nilaiBruto : 0n,
    alasanKosong: alasan,
    terpotongHold: false,
    periode: null,
  };
}

/** tanggal menormalkan `undefined`/`null` ke null dan menolak yang bukan YYYY-MM-DD. */
function tanggal(v: string | null | undefined, nama: string): string | null {
  if (v === undefined || v === null || v === '') {
    return null;
  }
  if (!YMD.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) {
    throw new AccrualInputError(`${nama} must be YYYY-MM-DD: ${JSON.stringify(v)}`);
  }
  return v;
}
