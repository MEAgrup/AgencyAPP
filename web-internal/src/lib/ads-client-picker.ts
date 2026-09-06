// Aturan sisi-klien picker klien Ads (`AdsClientPicker`, SCR-UI-1). Murni —
// nol fetch, nol import runtime.
//
// Diuji terpisah (`ads-client-picker.test.ts`) karena satu aturan di sini
// LOAD-BEARING dan gagalnya senyap: opsi bayangan untuk klien di luar daftar.
//
// Tautan `?client=…` — dipakai tombol "scan baru" di tab Portofolio dan
// disebut di teks bantuan kedua halaman — bisa membawa ID yang TIDAK ada di
// daftar picker, karena scope-nya "punya brief Ads" dan klien itu bisa belum
// punya satu pun. Sebuah `<select>` yang `value`-nya tidak cocok dengan satu
// pun `<option>` akan JATUH ke opsi pertama tanpa memberi tahu siapa pun:
// halamannya lalu menampilkan scan klien yang SALAH, dengan ID yang benar
// masih terpampang di tautan yang tadi diklik. Menjalankan scan-nya sendiri
// tetap jalan: `POST /clients/{id}/adsscanner/scan` memakai `db()` service-role,
// bukan `readAsActor`, jadi ia tidak pernah lewat `clients_select`.
//
// Dependency-free ON PURPOSE, preseden `employee-picker` / `campaign-picker`:
// alias `@/` tidak diresolusi vitest, jadi logika yang bisa diuji tidak boleh
// tinggal di modul yang meng-import `lib/api`.

/** Baris klien seminimal yang picker butuhkan. */
export interface AdsClientRow {
  id: string;
  toko: string;
}

/** Satu baris dropdown: nama toko dulu (yang orang ingat), lalu ID-nya —
 *  nilai yang dicatat server dan yang muncul di jejak audit. */
export function adsClientLabel(c: AdsClientRow): string {
  return `${c.toko} (${c.id})`;
}

/**
 * Perlukah opsi bayangan untuk `value`?
 *
 * `true` hanya kalau ada sesuatu yang dipilih DAN ia tidak ada di daftar.
 * Kosong (`''`) bukan kasus bayangan — itu keadaan "belum memilih" yang sudah
 * punya opsinya sendiri.
 */
export function butuhOpsiBayangan(value: string, clients: readonly AdsClientRow[]): boolean {
  if (value === '') return false;
  return !clients.some((c) => c.id === value);
}

/**
 * Opsi yang harus dirender, berurutan.
 *
 * Dikembalikan sebagai data (bukan JSX) supaya bisa diuji: yang mudah salah di
 * sini bukan markup-nya, melainkan APAKAH `value` yang sedang aktif punya opsi
 * yang cocok. Elemen `<select>` tidak mengeluh saat tidak cocok — ia diam-diam
 * memilih yang lain.
 */
export function opsiPicker(
  value: string,
  clients: readonly AdsClientRow[],
  opts: { loading: boolean },
): { value: string; label: string }[] {
  const out = [{ value: '', label: opts.loading ? 'Memuat klien…' : '— pilih klien —' }];
  if (butuhOpsiBayangan(value, clients)) {
    out.push({ value, label: `${value} (di luar daftar klien Ads)` });
  }
  for (const c of clients) out.push({ value: c.id, label: adsClientLabel(c) });
  return out;
}
