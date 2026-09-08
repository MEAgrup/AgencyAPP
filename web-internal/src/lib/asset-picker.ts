// Aturan sisi-klien picker aset kreatif (`AssetPicker`, B-5 / ketokan K-3).
// Murni — nol fetch, nol import runtime.
//
// Diuji terpisah (`asset-picker.test.ts`) dengan alasan yang PERSIS sama seperti
// `ads-client-picker.ts`: satu aturan di sini load-bearing dan gagalnya senyap —
// opsi bayangan untuk aset yang tidak ada di daftar.
//
// Kampanye yang sudah berjalan bisa memuat `AST-…` yang TIDAK muncul di daftar
// picker: aset itu bisa sudah dipakai lewat jalur lama (kolom teks), sementara
// daftar hari ini disempitkan ke Brief Creative sumber (`source_brief`). Sebuah
// `<select>` yang `value`-nya tidak cocok dengan satu pun `<option>` akan JATUH
// ke opsi pertama tanpa memberi tahu siapa pun — dan di form Creative Swap itu
// berarti menukar aset yang SALAH, dengan aset yang benar masih terpampang di
// baris yang barusan dibaca orangnya.
//
// Dependency-free ON PURPOSE, preseden `ads-client-picker` / `employee-picker` /
// `campaign-picker`: alias `@/` tidak diresolusi vitest, jadi logika yang bisa
// diuji tidak boleh tinggal di modul yang meng-import `lib/api`.

/** Baris aset seminimal yang picker butuhkan (subset `ClientAssetOption`). */
export interface AssetPickerRow {
  id: string;
  brief_id: string;
  brief_title: string;
  asset_type: string;
  sequence_no: number;
}

/**
 * Satu baris dropdown.
 *
 * Yang didahulukan adalah apa yang orangnya kenali: jenis aset + nomor urutnya
 * di dalam Brief ("Product Video #3"), lalu judul Brief-nya, baru ID-nya —
 * nilai yang dicatat server dan yang muncul di jejak audit. Urutan sebaliknya
 * (ID dulu) sama saja dengan kolom teks yang picker ini gantikan: daftar ID yang
 * tidak berarti apa-apa bagi pembacanya.
 */
export function assetLabel(a: AssetPickerRow): string {
  return `${a.asset_type} #${a.sequence_no} — ${a.brief_title} (${a.id})`;
}

/**
 * Perlukah opsi bayangan untuk `value`?
 *
 * `true` hanya kalau ada sesuatu yang dipilih DAN ia tidak ada di daftar.
 * Kosong (`''`) bukan kasus bayangan — itu keadaan "belum memilih" yang sudah
 * punya opsinya sendiri.
 */
export function butuhOpsiBayangan(value: string, assets: readonly AssetPickerRow[]): boolean {
  if (value === '') return false;
  return !assets.some((a) => a.id === value);
}

/**
 * Opsi yang harus dirender, berurutan.
 *
 * Dikembalikan sebagai data (bukan JSX) supaya bisa diuji: yang mudah salah di
 * sini bukan markup-nya, melainkan APAKAH `value` yang sedang aktif punya opsi
 * yang cocok. Elemen `<select>` tidak mengeluh saat tidak cocok — ia diam-diam
 * memilih yang lain.
 */
export function opsiPickerAset(
  value: string,
  assets: readonly AssetPickerRow[],
  opts: { loading: boolean },
): { value: string; label: string }[] {
  const out = [{ value: '', label: opts.loading ? 'Memuat aset…' : '— pilih aset [Approved] —' }];
  if (butuhOpsiBayangan(value, assets)) {
    out.push({ value, label: `${value} (di luar daftar aset yang ditawarkan)` });
  }
  for (const a of assets) out.push({ value: a.id, label: assetLabel(a) });
  return out;
}

/**
 * Teks keadaan-kosong. Dipisah dari komponennya karena KENAPA-nya kosong adalah
 * informasi yang paling dibutuhkan orangnya, dan ketiga sebabnya berbeda jauh:
 * penyempitan ke Brief sumber, klien yang belum punya aset selesai, atau memang
 * belum ada klien yang dipilih. "Belum ada aset" tanpa sebab adalah persis
 * kekosongan senyap yang mengirim orang kembali ke Google Sheet.
 */
export function pesanKosongAset(opts: { adaSourceBrief: boolean; adaKlien: boolean }): string {
  if (!opts.adaKlien) {
    return 'Klien kampanye belum diketahui, jadi daftar asetnya belum bisa diambil.';
  }
  if (opts.adaSourceBrief) {
    return 'Belum ada aset [Approved] pada Brief Creative sumber kampanye ini. Aset baru muncul di sini setelah AM menyetujuinya.';
  }
  return 'Belum ada aset [Approved] untuk klien ini. Aset baru muncul di sini setelah AM menyetujuinya.';
}
