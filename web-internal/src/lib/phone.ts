/**
 * Nomor telepon → alamat WhatsApp. Feedback tim Sales 2026-09-08 #1:
 * "dari data kontak yg ada buat tombol supaya bisa lsg kirim whatsapp ke no
 * tersebut dari wa web team sales", dengan contoh
 * `https://api.whatsapp.com/send?phone=6282121333386&text=halo`.
 *
 * KENAPA BUKAN MEMAKAI ULANG `leads.normalizePhone` (packages/domain).
 * Fungsi itu adalah KUNCI DEDUP: ia sengaja membuang kode negara supaya
 * `0812…`, `+62812…` dan `62812…` menghasilkan satu kunci yang sama, dan
 * kuncinya harus stabil selamanya karena seluruh riwayat lead ditulis atas
 * dasar itu. Yang di sini adalah ALAMAT — ia justru WAJIB memakai kode negara.
 * Menyatukan keduanya berarti perubahan tampilan bisa memindahkan kunci dedup,
 * dan lead yang sudah terdaftar berhenti terbaca duplikat.
 *
 * Murni, framework-free, ter-unit-test — cetakan `lib/money.ts` / `lib/url.ts`.
 */

/** Nomor Indonesia yang masuk akal: 9–15 digit sesudah dinormalkan (E.164). */
const MIN_DIGITS = 9;
const MAX_DIGITS = 15;

/**
 * Sapaan bawaan. Satu tempat, bukan string yang tersebar di tiap halaman —
 * kalau tim Sales mau mengubah bunyinya, yang diubah satu baris.
 */
export const WA_SAPAAN_DEFAULT = 'Halo';

/** Sapaan yang menyebut nama lead bila namanya diketahui. */
export function waSapaan(nama?: string | null): string {
  const n = (nama ?? '').trim();
  return n === '' ? WA_SAPAAN_DEFAULT : `${WA_SAPAAN_DEFAULT} ${n}`;
}

/**
 * `0812…` / `+62 812…` / `62-812…` / `812…` → `62812…`.
 *
 * Mengembalikan `null` — BUKAN string kosong dan bukan nomor tebakan — kalau
 * hasilnya tidak masuk akal. Pemanggilnya memakai itu untuk TIDAK merender
 * tombol sama sekali: tautan WhatsApp yang salah nomor lebih buruk daripada
 * tidak ada tombol, karena orang mengiranya sudah terkirim ke lead yang benar.
 */
export function toWaNumber(raw: string | null | undefined): string | null {
  const digits = (raw ?? '').replace(/\D/g, '');
  if (digits === '') return null;

  let national: string;
  if (digits.startsWith('62')) {
    national = digits.slice(2);
  } else if (digits.startsWith('0')) {
    national = digits.replace(/^0+/, '');
  } else {
    national = digits;
  }
  if (national === '') return null;

  const e164 = `62${national}`;
  if (e164.length < MIN_DIGITS || e164.length > MAX_DIGITS) return null;
  return e164;
}

/**
 * Tautan `api.whatsapp.com/send` — bentuk yang diminta tim Sales, dan bentuk
 * yang membuka WhatsApp Web di peramban desktop mereka. `null` kalau nomornya
 * tidak sah.
 */
export function waLink(raw: string | null | undefined, text: string = WA_SAPAAN_DEFAULT): string | null {
  const nomor = toWaNumber(raw);
  if (nomor === null) return null;
  return `https://api.whatsapp.com/send?phone=${nomor}&text=${encodeURIComponent(text)}`;
}
