// Progres "n dari N" sebuah Brief, dan alasan kenapa ia belum bergerak.
// Murni — nol fetch, nol import runtime.
//
// KENAPA BERKAS INI ADA.
//
// Roll-up Brief (`task.rollupTarget`, `kol.rollupTarget`) memakai
// `allExist = created >= quantity_target`. Aset/Booking sengaja dibuat
// BERTAHAP, jadi sebuah Brief "12 video" yang punya 3 Aset — dan ketiganya
// SELESAI — tetap `[In Progress]` selamanya, dan tidak satu pun halaman
// mengatakan kenapa. Divisi bilang "sudah beres", AM melihat status yang tidak
// berubah, dan keduanya benar.
//
// Yang dibangun di sini BUKAN perubahan semantik roll-up-nya (itu keputusan
// yang belum diketok, dan mengubahnya diam-diam akan menggeser setiap metrik
// turunan yang bergantung padanya). Yang dibangun adalah **membuat progresnya
// terlihat**: aturan kerja "ketiadaan yang diam tidak bisa dibedakan dari
// kerusakan" — halaman wajib mengatakan kenapa ia belum bergerak.
//
// Dipisah dari komponennya supaya bisa diuji tanpa merender apa pun, dan supaya
// SATU aturan melayani ketiga layar (antrean divisi, Brief divisi, Brief AM) —
// tiga salinan angka yang sama pasti akan berbeda di satu tempat.

/** Progres pembuatan unit sebuah Brief. */
export interface BriefProgress {
  /** Unit yang sudah dibuat (Aset / Booking). */
  created: number;
  /** Quantity/Target Brief. */
  target: number;
  /** `false` ⇒ roll-up TIDAK akan menutup Brief, berapa pun yang selesai. */
  lengkap: boolean;
  /** Sisa unit yang belum dibuat; 0 kalau sudah lengkap. */
  sisa: number;
}

/**
 * hitungProgres menormalkan angka apa pun yang datang dari wire.
 *
 * `target` non-positif (0, negatif, NaN dari `Number(undefined)`) diperlakukan
 * sebagai "target tidak diketahui" dan `lengkap` jadi `true` — jangan sampai
 * Brief tanpa target yang jelas ditandai "belum lengkap" selamanya oleh
 * pembagian yang tidak pernah bisa selesai (aturan rumah #7 semangatnya sama).
 */
export function hitungProgres(created: number, target: number): BriefProgress {
  const c = Number.isFinite(created) && created > 0 ? Math.floor(created) : 0;
  const t = Number.isFinite(target) && target > 0 ? Math.floor(target) : 0;
  if (t === 0) {
    return { created: c, target: 0, lengkap: true, sisa: 0 };
  }
  return { created: c, target: t, lengkap: c >= t, sisa: Math.max(0, t - c) };
}

/**
 * labelProgres — teks pendek untuk kolom tabel/antrean: `"3 dari 12 dibuat"`.
 * Target tak diketahui ⇒ hanya jumlahnya, tanpa mengarang penyebut.
 */
export function labelProgres(p: BriefProgress, satuan = 'dibuat'): string {
  if (p.target === 0) {
    return `${p.created} ${satuan}`;
  }
  return `${p.created} dari ${p.target} ${satuan}`;
}

/**
 * pesanRollupTertahan — kalimat yang menjelaskan KENAPA status Brief belum
 * bergerak, atau `null` kalau tidak ada yang perlu dijelaskan.
 *
 * Dikembalikan `null` (bukan string kosong) supaya pemanggil tidak bisa
 * merender kotak peringatan kosong secara tidak sengaja.
 */
export function pesanRollupTertahan(p: BriefProgress, satuan = 'unit'): string | null {
  if (p.lengkap) {
    return null;
  }
  return (
    `Status Brief tidak akan tertutup sebelum SELURUH ${p.target} ${satuan} dibuat — ` +
    `${p.sisa} lagi belum ada. Menyelesaikan yang ${p.created} ini saja tidak menggerakkan statusnya.`
  );
}
