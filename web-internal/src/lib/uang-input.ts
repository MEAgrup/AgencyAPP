/**
 * Pengetikan angka rupiah di form admin, dan penjaga tombol Enter.
 *
 * Lahir dari QA pemilik 2026-09-17 pada Master Service List: "ketika memasukan
 * harga dan tertekan enter. muncul warning data tidak lengkap. angka harga
 * harus diketikan melalui panah ^ atau yg bawah. ini tidak jadi masalah kalau
 * hitungan bulan tapi kalau di angka 1 juta lebih akan sangat bermasalah".
 *
 * Dua cacat yang berbeda bertemu di satu kotak:
 *
 * 1. **Enter mengirim form.** HTML mengirim form begitu Enter ditekan di dalam
 *    sebuah `<input>` selama form itu punya satu tombol submit — perilaku
 *    bawaan, bukan kode kami. Jadi Enter setelah mengetik harga bukan
 *    "selesai mengisi kolom", melainkan "Simpan", dan form yang baru terisi
 *    separuh dijawab pesan gerbang wajib. `enterHarusDitahan` yang menutupnya:
 *    Enter di dalam sebuah field TIDAK PERNAH menyimpan; hanya tombol Simpan
 *    yang menyimpan.
 *
 * 2. **`<input type="number">` memusuhi angka besar.** Ia tidak memisah ribuan,
 *    jadi 21000000 dan 2100000 terlihat nyaris sama di layar; roda mouse
 *    mengubah nilainya diam-diam ketika kursor kebetulan ada di atasnya; dan
 *    panah spinner-nya adalah satu-satunya afordans yang terlihat, yang
 *    masuk akal untuk "6 bulan" dan tidak masuk akal sama sekali untuk
 *    "Rp 21.000.000". Karena itu kolom UANG menjadi kotak teks
 *    (`inputMode="numeric"`) yang memisah ribuan sambil diketik.
 *
 * Konvensi angkanya konvensi Indonesia, sama dengan `money.ts` (aturan rumah
 * #7): **titik memisahkan ribuan, koma memisahkan desimal**. Nilai yang datang
 * dari server berbentuk DECIMAL ("8000000.00"), jadi pemisah yang diikuti
 * TEPAT satu atau dua digit di ujung dibaca sebagai desimal — itulah yang
 * membuat "8000000.00" dari DB dan "8.000.000,00" yang diketik orang
 * bertemu di nilai yang sama. Titik yang diikuti tiga digit ("1.500") selalu
 * pemisah ribuan. Satu-satunya yang kabur adalah "1.50" (terbaca Rp 1,50),
 * dan katalog MEA tidak memuat harga di bawah seribu rupiah.
 *
 * Semuanya ada DI SINI, bukan di dalam halaman, karena komponen halaman tidak
 * diuji unit di repo ini — dan aturan "titik ribuan / koma desimal" adalah
 * aturan yang harus punya tes, bukan aturan yang harus diingat.
 */

/** Hasil pembacaan satu string uang: digit rupiah + pecahan (null = tak ada). */
interface Terbaca {
  /** Digit bagian rupiah, tanpa pemisah dan tanpa nol di depan. */
  digit: string;
  /** Digit pecahan, '' bila koma baru saja diketik dan angkanya belum. */
  pecahan: string | null;
}

const PEMISAH = /[.,]/;

/**
 * baca memecah apa pun yang diketik menjadi rupiah + pecahan.
 *
 * Huruf dan simbol lain DIBUANG, bukan dipertahankan: kotak ini hanya bisa
 * berisi angka, dan menyisakan "abc" hanya menunda pesan penolakan sampai
 * server. Kosong tetap kosong — '' adalah "belum diisi", dan ia TIDAK BOLEH
 * menjadi 0 (harga nol adalah pernyataan lain).
 */
function baca(masuk: string): Terbaca {
  const s = (masuk ?? '').trim();
  if (s === '') return { digit: '', pecahan: null };

  let batas = -1;
  for (let i = s.length - 1; i >= 0; i--) {
    if (PEMISAH.test(s[i])) {
      batas = i;
      break;
    }
  }

  let sumberRupiah = s;
  let pecahan: string | null = null;
  if (batas >= 0) {
    const ekor = s.slice(batas + 1);
    if (/^\d{1,2}$/.test(ekor)) {
      // Pemisah desimal: "8000000.00", "1.500.000,50".
      sumberRupiah = s.slice(0, batas);
      pecahan = ekor;
    } else if (ekor === '' && s[batas] === ',') {
      // Koma baru diketik, angkanya belum — jangan telan komanya, kalau
      // ditelan orang tidak akan pernah bisa mengetik desimal sama sekali.
      sumberRupiah = s.slice(0, batas);
      pecahan = '';
    }
  }

  const digit = sumberRupiah.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  return { digit, pecahan };
}

/** kelompok memisah ribuan dengan titik, sama seperti `formatIDR`. */
function kelompok(digit: string): string {
  return digit.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/**
 * formatUangInput mengubah apa pun yang ada di kotak menjadi bentuk tampil:
 * "8000000" → "8.000.000", "8000000.00" → "8.000.000,00".
 *
 * Dipanggil pada SETIAP ketukan, jadi ia harus idempoten — hasilnya diumpankan
 * kembali ke dirinya sendiri pada ketukan berikutnya.
 */
export function formatUangInput(masuk: string): string {
  const { digit, pecahan } = baca(masuk);
  if (digit === '' && (pecahan === null || pecahan === '')) return '';
  const rupiah = kelompok(digit === '' ? '0' : digit);
  return pecahan === null ? rupiah : `${rupiah},${pecahan}`;
}

/**
 * normalisasiUang mengubah bentuk tampil menjadi bentuk kawat DECIMAL:
 * "8.000.000" → "8000000", "1.500.000,50" → "1500000.50".
 *
 * Kosong tetap kosong — gerbang wajib di server yang berhak mengatakan
 * "[Harga Standar wajib diisi]", bukan form ini yang diam-diam mengirim 0.
 */
export function normalisasiUang(tampil: string): string {
  const { digit, pecahan } = baca(tampil);
  if (digit === '' && (pecahan === null || pecahan === '')) return '';
  const rupiah = digit === '' ? '0' : digit;
  return pecahan === null || pecahan === '' ? rupiah : `${rupiah}.${pecahan}`;
}

/** Berapa digit yang ada di sepotong teks — satuan posisi karet. */
export function jumlahDigit(teks: string): number {
  return (teks.match(/\d/g) ?? []).length;
}

/**
 * posisiKaretUang mengembalikan karet ke tempat yang SAMA setelah pemisah
 * ribuan disisipkan ulang.
 *
 * Diukur dalam digit, bukan dalam karakter: menyisipkan sebuah titik menggeser
 * setiap indeks karakter di belakangnya, dan tanpa ini karet melompat ke ujung
 * pada setiap ketukan — yang berarti menyunting di tengah angka menjadi
 * mustahil. Itu akan menjadi cacat BARU, bukan perbaikan.
 */
export function posisiKaretUang(tampil: string, digitSebelumnya: number): number {
  if (digitSebelumnya <= 0) return 0;
  let terlihat = 0;
  for (let i = 0; i < tampil.length; i++) {
    if (tampil[i] >= '0' && tampil[i] <= '9') {
      terlihat++;
      if (terlihat === digitSebelumnya) return i + 1;
    }
  }
  return tampil.length;
}

/** Sepotong KeyboardEvent yang dibutuhkan penjaga Enter — tanpa DOM, supaya bisa diuji. */
export interface KetukanTombol {
  key: string;
  /** `tagName` elemen yang sedang fokus: 'INPUT', 'TEXTAREA', 'BUTTON', 'SELECT'. */
  tagName: string;
  /** `type` elemen, hanya berarti untuk INPUT. */
  type?: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}

/**
 * enterHarusDitahan menjawab satu pertanyaan: haruskah Enter ini DIBATALKAN
 * supaya form tidak terkirim?
 *
 * Ya, bila Enter ditekan di dalam sebuah field. Tidak, bila fokusnya ada di
 * tombol (di situ Enter berarti "klik tombol itu", dan tombol Simpan memang
 * untuk menyimpan), di `<textarea>` (Enter berarti baris baru), atau bila ada
 * tombol pengubah ditekan bersamaan (Ctrl+Enter adalah idiom "kirim" yang
 * disengaja, bukan kecelakaan mengetik).
 *
 * `<select>` juga dilewatkan: Enter di dropdown yang terbuka adalah "pilih
 * yang ini", dan browser tidak meneruskannya ke form.
 */
export function enterHarusDitahan(ketukan: KetukanTombol): boolean {
  if (ketukan.key !== 'Enter') return false;
  if (ketukan.shiftKey || ketukan.ctrlKey || ketukan.metaKey || ketukan.altKey) return false;
  if ((ketukan.tagName ?? '').toUpperCase() !== 'INPUT') return false;
  const jenis = (ketukan.type ?? 'text').toLowerCase();
  return jenis !== 'submit' && jenis !== 'button' && jenis !== 'reset' && jenis !== 'image';
}
