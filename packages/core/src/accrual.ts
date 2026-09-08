/**
 * Mesin accrual Gelombang D — MENGAPA sebuah rupiah masuk ke bulan tertentu.
 *
 * Modul ini MURNI: ia tidak menyentuh DB, tidak membaca `audit_log`, tidak tahu
 * peran siapa pun. Ia menerima apa yang sudah dibaca dari katalog + riwayat
 * layanan, dan mengembalikan SKEDUL pengakuan pendapatan per BULAN KALENDER.
 * Pemanggilnya (`packages/domain`) yang bertugas mengambil `pengakuan`,
 * `durasi_bulan`, `qty_menambah` dari versi MSL yang di-pin, dan menurunkan
 * riwayat hold dari `audit_log` — pola yang sama dengan
 * `ads.computeAdsManagementEndDate` / `computeTotalHariHold`.
 *
 * Empat ketokan pemilik 2026-09-07 yang mesin ini WAJIB patuhi
 * (`DECISIONS.md`, `handoff/HANDOFF_GELOMBANG_C_20260907.md` §4):
 *
 *   D-1  HANGUS. Layanan yang di-void di tengah periode diakui HANYA untuk
 *        hari yang sudah jalan; sisanya tidak pernah diakui — bukan ditunda,
 *        bukan dipindah ke bulan lain. Yang hangus dilaporkan terpisah supaya
 *        selisihnya bisa dijawab, bukan hilang diam-diam.
 *
 *   D-2  `[On Hold]` MENJEDA pengakuan. Skedulnya BERGESER, tidak dipadatkan:
 *        hari hold mendorong seluruh batas periode sesudahnya ke depan.
 *
 *   D-3  Ada kunci tutup buku PER BULAN, dan bulan tertutup tidak bisa diedit
 *        sama sekali. Mesin ini tidak menyimpan apa pun — tapi bentuk
 *        keluarannya dipilih supaya PATUH pada D-3; lihat "Kenapa irisan
 *        bulanan" di bawah.
 *
 *   D-4  Nilai yang masuk ke sini BRUTO. Mesin ini TIDAK menghitung PPN sama
 *        sekali, tidak menambah dan tidak mengurangi — perlakuan PPN adalah
 *        pilihan eksplisit per transaksi yang hidup di luar mesin ini.
 *
 * ── Kenapa irisan BULANAN, dan kenapa pro-rate hari hanya di irisan yang
 *    kena void ──────────────────────────────────────────────────────────────
 *
 * D-1 menyebut HARI ("hanya untuk hari yang sudah jalan") sementara D-KOM
 * menyebut RATA per periode ("diakui rata sepanjang durasi_bulan"). Keduanya
 * hanya bisa berdiri bersama dengan satu bentuk: pendapatan dibagi rata ke
 * irisan-irisan satu bulan, dan HANYA irisan yang kena void yang di-pro-rate
 * per hari.
 *
 * Alasannya bukan selera, tapi D-3. Kalau seluruh masa layanan di-pro-rate per
 * hari sebagai satu blok, sebuah void di bulan ke-5 akan MENGUBAH angka bulan
 * ke-1 sampai ke-4 — dan bulan-bulan itu mungkin sudah DITUTUP. D-3 bilang
 * bulan tertutup tidak bisa diedit sama sekali. Jadi bentuk yang memaksa
 * penulisan mundur ke bulan tertutup bukan pilihan yang lebih buruk; ia tidak
 * bisa dipakai. Dengan irisan bulanan, void tidak pernah menjangkau ke
 * belakang: irisan sebelum void tetap persis seperti saat ditutup, irisan yang
 * memuat tanggal void dipotong per hari, irisan sesudahnya nol.
 *
 * ── Kenapa hari hold tidak dihitung sebagai "hari yang sudah jalan" ─────────
 *
 * Karena D-2 bilang hold MENJEDA. Hari yang dijeda menurut definisinya bukan
 * hari yang jalan, jadi ia tidak boleh ikut diakui saat void memotong sebuah
 * irisan. Konsekuensi yang menyenangkan: panjang "hari aktif" tiap irisan
 * selalu sama dengan panjang bulan kalendernya sendiri, karena batas irisan
 * sudah digeser sepanjang hold yang jatuh di dalamnya.
 */

import * as money from './money';
import * as tz from './tz';

// ---------------------------------------------------------------------------
// Kosakata
// ---------------------------------------------------------------------------

/**
 * KAPAN pendapatan sebuah layanan diakui — kolom `master_service_versions
 * .pengakuan` (ketokan D-KOM 2026-09-07 opsi a, migrasi
 * `20260922010000_dkom_pengakuan_katalog.sql`).
 *
 * Tiga nilai ini TIDAK bisa diturunkan dari `durasi_bulan`: `Komisi` dan `Jasa
 * Pengajuan Shopee Mall` sama-sama `durasi_bulan = NULL` dengan arti berbeda.
 */
export type Pengakuan = 'per_periode' | 'saat_selesai' | 'bulan_berikutnya';

export const PENGAKUAN_PER_PERIODE: Pengakuan = 'per_periode';
export const PENGAKUAN_SAAT_SELESAI: Pengakuan = 'saat_selesai';
export const PENGAKUAN_BULAN_BERIKUTNYA: Pengakuan = 'bulan_berikutnya';

/** Apa yang ditambah qty yang dibeli klien — `master_service_versions.qty_menambah`. */
export type QtyMenambah = 'durasi' | 'volume';

/**
 * Satu jeda pengakuan (D-2), diturunkan pemanggil dari riwayat transisi
 * `[Active] -> [On Hold] -> [Active]` di `audit_log`.
 *
 * `selesai` null = MASIH ditahan sampai sekarang. Mengikuti pola yang sudah
 * terbukti di `ads.computeTotalHariHold`, hold yang belum selesai TIDAK
 * menggeser apa pun: ia baru mendorong skedul saat layanan benar-benar
 * dilanjutkan, karena sebelum itu tidak ada yang tahu berapa panjangnya.
 * Konsekuensinya disebut jujur: selama layanan masih ditahan, irisan yang
 * sedang berjalan tetap diakui seolah tidak ada jeda, dan angkanya baru
 * dikoreksi saat resume. Itu sebabnya D-2 datang dengan risiko operasional
 * "hold harus diinput saat kejadian, bukan diingat belakangan".
 */
export interface Hold {
  /** YYYY-MM-DD (WIB) — hari pertama yang dijeda. */
  mulai: string;
  /** YYYY-MM-DD (WIB) eksklusif — hari pertama yang jalan lagi; null = masih ditahan. */
  selesai: string | null;
}

/** Apa yang mesin butuhkan tentang SATU layanan yang dibeli klien. */
export interface AccrualInput {
  /**
   * Nilai BRUTO layanan ini (D-4). Mesin tidak pernah menghitung PPN atasnya.
   * Rp 0 sah — mis. layanan bonus — dan menghasilkan skedul berisi nol, bukan
   * skedul kosong: "diakui Rp 0" dan "tidak diakui sama sekali" adalah dua hal
   * berbeda dan tidak boleh berbagi satu bentuk keluaran.
   */
  nilaiBruto: money.Money;
  /** Penanda dari versi MSL yang di-pin layanan ini. */
  pengakuan: Pengakuan;
  /** Durasi satu satuan layanan dalam BULAN; null = tidak punya periode. */
  durasiBulan: number | null;
  /** Berapa unit yang dibeli klien. Bilangan bulat ≥ 1. */
  qty: number;
  /** Apa yang ditambah qty itu. */
  qtyMenambah: QtyMenambah;
  /**
   * YYYY-MM-DD — hari layanan MULAI JALAN (untuk Ads: start campaign; periode
   * riset tidak dihitung — ketokan Q4). Wajib untuk `per_periode`.
   */
  tanggalMulai?: string | null;
  /** YYYY-MM-DD — hari layanan dinyatakan SELESAI. Wajib untuk `saat_selesai`. */
  tanggalSelesai?: string | null;
  /** YYYY-MM — bulan penjualan yang melahirkan komisi. Wajib untuk `bulan_berikutnya`. */
  bulanPenjualan?: string | null;
  /** Riwayat jeda (D-2). Boleh kosong; urutannya tidak harus rapi. */
  holds?: Hold[];
  /** YYYY-MM-DD — hari layanan di-void. Sesudah ini tidak ada yang diakui (D-1). */
  tanggalVoid?: string | null;
}

/** Satu baris skedul: sepotong pendapatan yang jatuh di satu bulan kalender. */
export interface AccrualSlice {
  /** YYYY-MM — bulan kalender tempat baris ini diakui. */
  bulan: string;
  /** Yang benar-benar diakui di baris ini. */
  jumlah: money.Money;
  /** Yang HANGUS di baris ini karena void (D-1) — nol kalau tidak kena void. */
  hangus: money.Money;
  /** YYYY-MM-DD — awal rentang baris ini (inklusif). */
  mulai: string;
  /** YYYY-MM-DD — akhir rentang baris ini (EKSKLUSIF). */
  akhir: string;
  /** Nomor irisan, 1-based. `saat_selesai`/`bulan_berikutnya` selalu 1. */
  urutan: number;
}

/** Total per bulan kalender — bentuk yang dibaca laporan & kunci tutup buku D-3. */
export interface AccrualBulan {
  bulan: string;
  jumlah: money.Money;
}

/** Hasil lengkap untuk satu layanan. */
export interface AccrualSchedule {
  baris: AccrualSlice[];
  perBulan: AccrualBulan[];
  /** Σ `baris[].jumlah`. */
  totalDiakui: money.Money;
  /** Σ `baris[].hangus` — yang tidak pernah diakui karena void (D-1). */
  totalHangus: money.Money;
  /**
   * Kenapa `baris` kosong, dalam Bahasa Indonesia — null kalau tidak kosong.
   *
   * Aturan rumah #4: ketiadaan yang diam tidak bisa dibedakan dari kerusakan.
   * Skedul kosong punya banyak sebab yang SAH (belum selesai, di-void sebelum
   * mulai, belum ada tanggal mulai) dan satu sebab yang BUG. Tanpa kolom ini
   * pemanggil tidak bisa membedakannya, dan halaman yang menampilkannya tidak
   * bisa mengatakan sebabnya.
   */
  alasanKosong: string | null;
}

/** Dilempar saat input tidak punya arti — bukan "kosong", tapi mustahil. */
export class AccrualInputError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'AccrualInputError';
  }
}

// ---------------------------------------------------------------------------
// Pintu masuk
// ---------------------------------------------------------------------------

/**
 * hitungSkedul mengembalikan skedul pengakuan pendapatan satu layanan.
 *
 * Deterministik dan bebas jam: tidak ada `new Date()` di mana pun di modul ini.
 * Semua yang menentukan hasil datang dari `inp`, sehingga skedul yang sama bisa
 * dihitung ulang persis sama kapan pun — syarat aturan rumah #4 (field turunan
 * selalu bisa dihitung ulang dari log) dan syarat D-3 (angka bulan tertutup
 * dibandingkan dengan hasil hitung ulang saat mencari selisih).
 */
export function hitungSkedul(inp: AccrualInput): AccrualSchedule {
  if (inp.nilaiBruto < 0n) {
    throw new AccrualInputError('nilaiBruto tidak boleh negatif');
  }
  switch (inp.pengakuan) {
    case PENGAKUAN_PER_PERIODE:
      return perPeriode(inp);
    case PENGAKUAN_SAAT_SELESAI:
      return saatSelesai(inp);
    case PENGAKUAN_BULAN_BERIKUTNYA:
      return bulanBerikutnya(inp);
    default:
      throw new AccrualInputError(`pengakuan tidak dikenal: ${String(inp.pengakuan)}`);
  }
}

/**
 * totalBulan — berapa bulan sebuah layanan yang dibeli benar-benar berjalan.
 *
 *   qty_menambah = 'durasi'  ⇒  qty × durasi_bulan   (GMV Max beli 3 = 3 bulan)
 *   qty_menambah = 'volume'  ⇒  durasi_bulan          (Nano KOL beli 10 = 10 KOL
 *                                                      dalam periode yang sama)
 *   durasi_bulan = NULL      ⇒  null (tidak punya periode sama sekali)
 *
 * Dipisah jadi fungsi sendiri karena bukan hanya mesin accrual yang butuh
 * jawaban ini — halaman kontrak dan Ads Management Date menanyakan hal yang
 * sama, dan dua salinan aturan ini akan berbeda begitu keduanya ada.
 */
export function totalBulan(durasiBulan: number | null, qty: number, qtyMenambah: QtyMenambah): number | null {
  if (durasiBulan === null) {
    return null;
  }
  if (!Number.isInteger(durasiBulan) || durasiBulan <= 0) {
    throw new AccrualInputError(`durasiBulan harus bilangan bulat positif: ${durasiBulan}`);
  }
  if (!Number.isInteger(qty) || qty <= 0) {
    throw new AccrualInputError(`qty harus bilangan bulat positif: ${qty}`);
  }
  return qtyMenambah === 'durasi' ? qty * durasiBulan : durasiBulan;
}

// ---------------------------------------------------------------------------
// per_periode
// ---------------------------------------------------------------------------

function perPeriode(inp: AccrualInput): AccrualSchedule {
  const mulai = inp.tanggalMulai ?? null;
  if (mulai === null) {
    return kosong('[layanan belum punya tanggal mulai, pengakuan pendapatan belum bisa dijadwalkan]');
  }
  const bulan = totalBulan(inp.durasiBulan, inp.qty, inp.qtyMenambah);
  if (bulan === null) {
    // Dijaga juga oleh `ck_msv_per_periode_butuh_durasi_bulan` di DB. Dua lapis,
    // karena mesin ini juga dipanggil atas versi MSL lama dan atas input yang
    // tidak selalu lewat route MSL.
    throw new AccrualInputError('pengakuan per_periode menuntut durasiBulan; tidak ada yang bisa disebar');
  }

  const holds = normalisasiHolds(inp.holds ?? []);
  const batas = batasIrisan(mulai, bulan, holds);
  const jatah = bagiRata(inp.nilaiBruto, bulan);
  const voidPada = inp.tanggalVoid ?? null;

  if (voidPada !== null && voidPada <= mulai) {
    // Di-void sebelum sehari pun berjalan. D-1: yang belum jalan tidak pernah
    // diakui — jadi SELURUH nilainya hangus, dan itu dikatakan, bukan
    // dikembalikan sebagai skedul kosong tanpa sebab.
    return {
      baris: [],
      perBulan: [],
      totalDiakui: 0n,
      totalHangus: inp.nilaiBruto,
      alasanKosong: '[layanan di-void sebelum berjalan, tidak ada pendapatan yang diakui]',
    };
  }

  const baris: AccrualSlice[] = [];
  for (let k = 0; k < bulan; k++) {
    const irisanMulai = batas[k];
    const irisanAkhir = batas[k + 1];
    const penuh = jatah[k];

    if (voidPada !== null && voidPada <= irisanMulai) {
      // Void jatuh sebelum irisan ini dimulai: nol hari jalan, semuanya hangus.
      //
      // Cabang ini SETARA dengan hasil yang akan diberikan cabang pro-rate di
      // bawah (`hariJalan` negatif ⇒ nol), jadi mencabutnya sendirian tidak
      // memerahkan tes mana pun — sudah dibuktikan dengan mutasi. Ia tetap ada
      // karena ia MENGATAKAN aturan D-1 ("sisanya tidak pernah diakui")
      // langsung, alih-alih menyandarkannya pada aritmetika hari yang kebetulan
      // negatif. Yang menjaganya tetap benar adalah tes yang mencabut KEDUANYA
      // sekaligus, bukan cabang ini sendiri.
      baris.push({ bulan: bulanDari(irisanMulai), jumlah: 0n, hangus: penuh, mulai: irisanMulai, akhir: irisanAkhir, urutan: k + 1 });
      continue;
    }

    if (voidPada !== null && voidPada < irisanAkhir) {
      // Irisan yang KENA void — satu-satunya tempat pro-rate per hari terjadi.
      //
      // Penyebutnya panjang bulan kalender irisan ini TANPA hari hold, bukan
      // (akhir - mulai): `akhir` sudah digeser maju sepanjang hold di dalamnya
      // (D-2), jadi memakainya akan mengencerkan tarif harian oleh hari-hari
      // yang justru dijeda.
      const hariAktifTotal = hariAntara(polos(mulai, k), polos(mulai, k + 1));
      const hariJalan = hariAntara(irisanMulai, voidPada) - hariHoldDalam(holds, irisanMulai, voidPada);
      const diakui = hariAktifTotal <= 0 || hariJalan <= 0
        ? 0n
        // Dibulatkan KE BAWAH dengan sengaja. Sisa di bawah satu sen tidak
        // pernah diakui — itu persis yang D-1 minta ("sisanya tidak pernah
        // diakui"), dan membulatkan ke atas berarti mengakui pendapatan atas
        // hari yang tidak pernah dijalani.
        : (penuh * BigInt(hariJalan)) / BigInt(hariAktifTotal);
      baris.push({
        bulan: bulanDari(irisanMulai), jumlah: diakui, hangus: penuh - diakui,
        mulai: irisanMulai, akhir: irisanAkhir, urutan: k + 1,
      });
      continue;
    }

    baris.push({ bulan: bulanDari(irisanMulai), jumlah: penuh, hangus: 0n, mulai: irisanMulai, akhir: irisanAkhir, urutan: k + 1 });
  }

  return rakit(baris);
}

/**
 * batasIrisan mengembalikan `bulan + 1` tanggal batas, batas[0] = tanggalMulai.
 *
 * Batas ke-k adalah `tanggalMulai + k BULAN KALENDER` (`tz.addMonthsToDate`,
 * jadi mulai 31 Januari + 1 bulan = 28/29 Februari, bukan +30 hari) yang
 * kemudian DIDORONG MAJU sepanjang hari hold yang jatuh sebelum batas itu
 * (D-2). Mendorongnya menggeser batas, yang bisa memasukkan lebih banyak hari
 * hold ke dalam jendela, yang mendorongnya lagi — jadi dicari titik tetapnya.
 * Iterasi selalu berhenti: setiap putaran hanya bisa menemukan hari hold yang
 * belum terhitung, dan jumlah hari hold terbatas.
 *
 * Bentuk ini sengaja sama dengan `ads.computeAdsManagementEndDate`
 * (`mulai + durasi BULAN + hari hold`), sehingga batas terakhir di sini dan
 * `end_date` Ads Management tidak bisa berbeda tanpa salah satunya ketahuan.
 */
function batasIrisan(mulai: string, bulan: number, holds: Hold[]): string[] {
  // Setiap putaran yang belum berhenti mendorong batas MAJU minimal satu hari,
  // dan dorongan totalnya tidak pernah melebihi seluruh hari hold yang ada.
  // Jadi `hariHoldSemua + 1` putaran cukup — bukan angka bulat yang dikarang
  // "kira-kira aman". Kalau toh terlampaui, itu berarti asumsi monotonnya
  // patah; lebih baik meledak daripada mengembalikan batas yang salah diam-diam.
  const batasPutaran = holds.reduce((s, h) => s + hariAntara(h.mulai, h.selesai as string), 0) + 1;
  const out: string[] = [mulai];
  for (let k = 1; k <= bulan; k++) {
    const dasar = tz.addMonthsToDate(mulai, k);
    let batas = dasar;
    let berhenti = false;
    for (let putaran = 0; putaran <= batasPutaran; putaran++) {
      const geser = hariHoldDalam(holds, mulai, batas);
      const berikut = tz.addDaysToDate(dasar, geser);
      if (berikut === batas) {
        berhenti = true;
        break;
      }
      batas = berikut;
    }
    if (!berhenti) {
      throw new AccrualInputError(`batas irisan ke-${k} tidak konvergen; riwayat hold tidak masuk akal`);
    }
    out.push(batas);
  }
  return out;
}

/** polos: batas ke-k SEBELUM digeser hold — panjang "hari aktif" satu irisan. */
function polos(mulai: string, k: number): string {
  return tz.addMonthsToDate(mulai, k);
}

// ---------------------------------------------------------------------------
// saat_selesai
// ---------------------------------------------------------------------------

function saatSelesai(inp: AccrualInput): AccrualSchedule {
  const selesai = inp.tanggalSelesai ?? null;
  const voidPada = inp.tanggalVoid ?? null;

  if (selesai === null) {
    if (voidPada !== null) {
      // Di-void sebelum pernah selesai. Layanan sekali-jadi tidak punya periode
      // untuk di-pro-rate — tidak ada "hari yang sudah jalan" yang bisa dihitung
      // (ketokan Q5: sekali-jadi diakui SEKALIGUS saat selesai, bukan disebar).
      // Jadi tidak ada apa pun yang diakui, dan seluruhnya hangus.
      return {
        baris: [], perBulan: [], totalDiakui: 0n, totalHangus: inp.nilaiBruto,
        alasanKosong: '[layanan di-void sebelum selesai, tidak ada pendapatan yang diakui]',
      };
    }
    return kosong('[layanan belum selesai, pendapatannya diakui saat selesai]');
  }

  if (voidPada !== null && voidPada <= selesai) {
    return {
      baris: [], perBulan: [], totalDiakui: 0n, totalHangus: inp.nilaiBruto,
      alasanKosong: '[layanan di-void sebelum selesai, tidak ada pendapatan yang diakui]',
    };
  }

  // Void SESUDAH selesai tidak membatalkan yang sudah diakui: pekerjaannya sudah
  // selesai dan pendapatannya sudah jatuh tempo di bulan itu. D-1 hanya
  // menghanguskan yang BELUM jalan.
  return rakit([{
    bulan: bulanDari(selesai), jumlah: inp.nilaiBruto, hangus: 0n,
    mulai: selesai, akhir: tz.addDaysToDate(selesai, 1), urutan: 1,
  }]);
}

// ---------------------------------------------------------------------------
// bulan_berikutnya
// ---------------------------------------------------------------------------

function bulanBerikutnya(inp: AccrualInput): AccrualSchedule {
  const jual = inp.bulanPenjualan ?? null;
  if (jual === null) {
    return kosong('[bulan penjualan belum diisi, komisi belum bisa dijadwalkan]');
  }
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(jual)) {
    throw new AccrualInputError(`bulanPenjualan harus YYYY-MM: ${jual}`);
  }
  // Tanggal 1 dipakai sebagai jangkar supaya `addMonthsToDate` tidak pernah
  // meng-clamp: 1 + 1 bulan selalu tanggal 1 di bulan berikutnya, di bulan mana
  // pun. Menjangkar di tanggal 31 akan membuat Januari + 1 bulan jadi Februari
  // dan Februari + 1 bulan jadi Maret — dua penjualan berturut-turut yang
  // pengakuannya bisa mendarat di bulan yang sama.
  const mulai = tz.addMonthsToDate(`${jual}-01`, 1);
  const bulan = bulanDari(mulai);

  const voidPada = inp.tanggalVoid ?? null;
  if (voidPada !== null && voidPada < mulai) {
    // Di-void sebelum bulan pengakuannya tiba. Komisi belum pernah jatuh tempo,
    // jadi tidak ada yang diakui — seluruhnya hangus.
    return {
      baris: [], perBulan: [], totalDiakui: 0n, totalHangus: inp.nilaiBruto,
      alasanKosong: '[komisi di-void sebelum bulan pengakuannya, tidak ada pendapatan yang diakui]',
    };
  }

  return rakit([{
    bulan, jumlah: inp.nilaiBruto, hangus: 0n,
    mulai, akhir: tz.addMonthsToDate(mulai, 1), urutan: 1,
  }]);
}

// ---------------------------------------------------------------------------
// Perkakas
// ---------------------------------------------------------------------------

/**
 * bagiRata membagi `total` ke `n` bagian yang jumlahnya PERSIS `total`.
 *
 * Bukan `money.proRata(total, 1n, BigInt(n))` berkali-kali: pembulatan itu
 * berdiri sendiri per bagian, jadi Rp 10.000.000 dibagi 6 menghasilkan
 * 6 × Rp 1.666.667 = Rp 10.000.002 — dua rupiah yang tidak dibeli siapa pun,
 * muncul di laporan keuangan. Di sini yang dibulatkan adalah KUMULATIFNYA,
 * sehingga bagian terakhir menyerap sisanya dan Σ tidak bisa meleset.
 */
export function bagiRata(total: money.Money, n: number): money.Money[] {
  if (!Number.isInteger(n) || n <= 0) {
    throw new AccrualInputError(`jumlah bagian harus bilangan bulat positif: ${n}`);
  }
  const out: money.Money[] = [];
  const N = BigInt(n);
  let sebelumnya = 0n;
  for (let k = 1n; k <= N; k++) {
    const kumulatif = (total * k) / N;
    out.push(kumulatif - sebelumnya);
    sebelumnya = kumulatif;
  }
  return out;
}

/** normalisasiHolds membuang hold yang belum selesai / terbalik, lalu mengurutkannya. */
function normalisasiHolds(holds: Hold[]): Hold[] {
  return holds
    .filter((h) => h.selesai !== null && h.selesai > h.mulai)
    .slice()
    .sort((a, b) => (a.mulai < b.mulai ? -1 : a.mulai > b.mulai ? 1 : 0));
}

/**
 * hariHoldDalam menghitung hari hold di dalam `[dari, sampai)`, tanpa
 * menghitung hari yang sama dua kali kalau dua hold bertindihan atau bersarang.
 *
 * Tindihan bukan kasus teoretis: dua sumber hold yang berbeda (kampanye ditahan
 * DAN kontrak ditahan) bisa menutupi hari yang sama, dan menjumlahkannya begitu
 * saja akan mendorong skedul dua kali lebih jauh dari kenyataan. `holds` sudah
 * terurut menaik dari `normalisasiHolds`.
 */
function hariHoldDalam(holds: Hold[], dari: string, sampai: string): number {
  if (sampai <= dari) {
    return 0;
  }
  let total = 0;
  let tertutupSampai = dari;
  for (const h of holds) {
    const a = h.mulai > tertutupSampai ? h.mulai : tertutupSampai;
    const b = (h.selesai as string) < sampai ? (h.selesai as string) : sampai;
    if (b > a) {
      total += hariAntara(a, b);
      tertutupSampai = b;
    }
    if (tertutupSampai >= sampai) {
      break;
    }
  }
  return total;
}

/** hariAntara menghitung hari kalender dari `dari` (inklusif) ke `sampai` (eksklusif). */
function hariAntara(dari: string, sampai: string): number {
  const a = Date.parse(`${dari}T00:00:00Z`);
  const b = Date.parse(`${sampai}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) {
    throw new AccrualInputError(`tanggal WIB tidak sah: ${dari} / ${sampai}`);
  }
  return Math.round((b - a) / 86400000);
}

/** bulanDari mengambil YYYY-MM dari sebuah YYYY-MM-DD. */
function bulanDari(ymd: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
    throw new AccrualInputError(`tanggal WIB tidak sah: ${ymd}`);
  }
  return ymd.slice(0, 7);
}

function kosong(alasan: string): AccrualSchedule {
  return { baris: [], perBulan: [], totalDiakui: 0n, totalHangus: 0n, alasanKosong: alasan };
}

/**
 * rakit menjumlahkan baris ke total per bulan.
 *
 * Menjumlahkan, bukan memetakan satu-baris-satu-bulan: DUA irisan bisa jatuh di
 * bulan kalender yang sama. Contohnya nyata, bukan dibuat-buat — layanan yang
 * mulai 31 Januari dengan hold 30 hari sebelum irisan pertama: batas irisan
 * mendarat di 2 Maret dan 30 Maret, keduanya Maret. Kalau baris kedua menimpa
 * yang pertama alih-alih menambahinya, satu bulan penuh pendapatan lenyap tanpa
 * jejak. Kunci tutup buku D-3 membaca `perBulan`, jadi kekeliruan itu akan
 * dibekukan.
 */
function rakit(baris: AccrualSlice[]): AccrualSchedule {
  const per = new Map<string, money.Money>();
  let diakui = 0n;
  let hangus = 0n;
  for (const b of baris) {
    per.set(b.bulan, (per.get(b.bulan) ?? 0n) + b.jumlah);
    diakui += b.jumlah;
    hangus += b.hangus;
  }
  const perBulan = [...per.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([bulan, jumlah]) => ({ bulan, jumlah }));
  return { baris, perBulan, totalDiakui: diakui, totalHangus: hangus, alasanKosong: null };
}
