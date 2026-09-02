/**
 * Aturan draft baris P-C yang menyangkut **jenis task ↔ satuan ↔ Rupiah**,
 * dipisah dari `/account/plan/{id}/page.tsx` supaya bisa diuji.
 *
 * Mengikuti preseden `plan-row-suggest.ts` di sebelah: halaman Plan menyimpan
 * JSX-nya, adapter murni pindah ke `lib/` dan dapat tes. Tanpa itu, tiga aturan
 * di bawah hanya hidup di dalam `onChange` sebuah `<select>` — tempat yang tidak
 * bisa diuji tanpa harness DOM yang paket ini tidak punya.
 *
 * Ketiganya menutup satu permintaan pemilik (2026-09-02): task ke divisi
 * operasional diberikan "dengan detail task sesuai satuannya". Katalognya
 * `@/lib/plantask` (cermin `packages/core/src/plantask.ts`).
 */
import { JENIS_LAINNYA, findJenis, jenisFor } from './plantask';

/** Bagian draft yang ditentukan oleh jenis task: kuncinya + satuan turunannya. */
export interface TaskDraftFields {
  jenis_task: string;
  satuan: string;
}

/**
 * Draft yang mengikuti PILIHAN DIVISI: deliverable pertama divisi itu, beserta
 * satuannya. Divisi tanpa katalog (Account/Ops) jatuh ke jalur teks bebas.
 *
 * Dipakai `blankRow` DAN handler ganti-divisi, satu fungsi untuk keduanya —
 * kalau berbeda, baris baru dan baris yang divisinya diganti akan punya default
 * yang tidak sama, dan tak ada yang menyadarinya sampai laporan aneh.
 */
export function taskDefaultsFor(divisi: string): TaskDraftFields {
  const first = jenisFor(divisi)[0];
  return first
    ? { jenis_task: first.jenis, satuan: first.satuan }
    : { jenis_task: JENIS_LAINNYA, satuan: '' };
}

/**
 * Draft yang mengikuti PILIHAN JENIS. Satuan katalog MENIMPA apa pun yang ada
 * (unit mengikuti deliverable, bukan sebaliknya); `JENIS_LAINNYA` mengosongkan
 * satuan supaya AM mengisinya sendiri alih-alih mewarisi satuan jenis lama —
 * yang akan membuat `jenisBySatuan` memulihkan jenis yang sudah dibatalkan.
 */
export function jenisDefaults(divisi: string, jenis: string): TaskDraftFields {
  const found = findJenis(divisi, jenis);
  return { jenis_task: jenis, satuan: found ? found.satuan : '' };
}

/** Apakah jenis yang dipilih adalah nilai Rupiah (Ads spent), bukan hitungan? */
export function isMoneyJenis(divisi: string, jenis: string): boolean {
  return findJenis(divisi, jenis)?.money === true;
}

/**
 * PC-6 kuota + PC-7 budget dari input form.
 *
 * Untuk jenis `money` (Ads spent) satu angka yang AM ketik adalah KEDUANYA:
 * PC-7 secara harfiah "Rp yang dialokasikan ke baris ini", dan untuk baris
 * ads-spend itu angka yang sama. Mencatatnya sama adalah kebenaran, bukan
 * akal-akalan — sekaligus mencegah dua salinan satu angka saling menyimpang.
 * Kuota TIDAK dibiarkan 0 pada baris money: `brief-inherit.ts` melewati baris
 * berkuota nol (`kuota_nol`), jadi menaruh Rupiah hanya di budget akan membuat
 * setiap baris Ads tak bisa dibrief.
 */
export function kuotaBudget(
  divisi: string,
  jenis: string,
  kuotaInput: string,
  budgetInput: string,
): { kuota: number; budget: number | null } {
  const kuota = kuotaInput.trim() ? Number(kuotaInput) : 0;
  if (isMoneyJenis(divisi, jenis)) return { kuota, budget: kuota };
  return { kuota, budget: budgetInput.trim() ? Number(budgetInput) : null };
}
