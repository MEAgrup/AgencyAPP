/**
 * PDT (Pusat Data Toko) — retensi berjenjang paket ZIP (G1-09 sub-langkah 2,
 * PRD §3.8 Rule 45, `pdt_upload_batch.retensi_sampai`/`retensi_alasan`).
 *
 * Fungsi murni saja — nol I/O, nol jam sistem dibaca di sini (`dariTanggal`
 * SELALU disuntik pemanggil, Rule 37: "tanggal_tarik_data selalu dari jam
 * server, tidak pernah dari jam browser" — prinsip yang sama berlaku untuk
 * setiap perhitungan tanggal PDT, bukan cuma field bernama itu).
 *
 * Rule 45 hanya mendaftar DUA baris yang lahir langsung dari hasil commit
 * (`default` +120 hari untuk batch `verified`, `ditolak` +30 hari) — tiga
 * baris lain di tabel (`laporan_terkirim`/`katalog_px`/`legal_hold`) adalah
 * PERPANJANGAN yang terjadi belakangan (laporan dikirim, SKU masuk katalog
 * PX, Director menyalakan legal hold), bukan bagian dari commit awal — itu
 * milik G1-10 (job purge, yang "menghitung ulang perpanjangan retensi lebih
 * dulu" tiap hari) dan `pdt.canKelolaBenchmark`-setara untuk legal_hold,
 * bukan fungsi ini. `identitas_belum_terikat` (Rule 4 — batch pertama diterima
 * menunggu konfirmasi AM, BUKAN ditolak) memakai baris `default` yang sama:
 * ia bukan penolakan, datanya utuh, dan tidak ada baris terpisah untuknya di
 * Rule 45.
 */

export type PdtRetensiBasis = 'default' | 'ditolak';

export interface PdtRetensiHasil {
  /** "YYYY-MM-DD" — `pdt_upload_batch.retensi_sampai` (kolom `date`). */
  sampai: string;
  alasan: PdtRetensiBasis;
}

const HARI_DEFAULT = 120;
const HARI_DITOLAK = 30;

function tambahHari(dari: Date, hari: number): string {
  const d = new Date(Date.UTC(dari.getUTCFullYear(), dari.getUTCMonth(), dari.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + hari);
  return d.toISOString().slice(0, 10);
}

/**
 * Rule 45 — retensi AWAL saat batch dibuat (perpanjangan berikutnya milik
 * G1-10, bukan fungsi ini). `basis`:
 *  - `'default'` — batch `verified` ATAU `identitas_belum_terikat` (Rule 4:
 *    diterima, bukan ditolak) ⇒ +120 hari.
 *  - `'ditolak'` — batch `ditolak` (identitas/periode/rekonsiliasi gagal,
 *    ATAU kegagalan infra memindahkan paket ke path final) ⇒ +30 hari,
 *    "hanya untuk diagnosa parse".
 */
export function hitungRetensiSampai(basis: PdtRetensiBasis, dariTanggal: Date): PdtRetensiHasil {
  const hari = basis === 'ditolak' ? HARI_DITOLAK : HARI_DEFAULT;
  return { sampai: tambahHari(dariTanggal, hari), alasan: basis };
}
