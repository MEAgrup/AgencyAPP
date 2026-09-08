/**
 * Bentuk `Brief` — SATU deklarasi untuk seluruh front-end internal.
 *
 * ## Kenapa berkas ini ada
 *
 * Sampai 2026-09-08 bentuk yang sama ini hidup EMPAT kali: `account.ts`,
 * `tasks.ts`, `creative.ts`, `kol.ts` — keempatnya disuapi wire yang **sama**
 * (`BriefWire`, `apps/api/src/lib/wire.ts`), tapi hanya `account.ts` yang diikat
 * `apps/api/src/lib/shape-parity.test.ts`.
 *
 * Itu bukan duplikasi yang rapi, itu **kelas cacat yang aktif**, dan bentuknya
 * begini: sebuah field baru ditambahkan di wire dan di `account.ts`, parity
 * hijau, CI hijau — lalu halaman Creative atau KOL yang membaca bentuknya
 * sendiri melihat `undefined`. Tidak ada satu pun tes yang bisa merah, karena
 * tidak ada satu pun tes yang tahu tiga bentuk lainnya ada.
 *
 * Sudah terjadi: A-req-1/2/3 (jendela campaign, sumber aset, jumlah anak)
 * mendarat di `account.ts` + `tasks.ts` dan **tidak pernah sampai** ke
 * `creative.ts`/`kol.ts`. `stage_pipeline_code`/`production_stage` bahkan hanya
 * ada di `account.ts` — tiga dari empat bentuk tidak mengenalnya.
 *
 * Jadi rumahnya dipindahkan ke sini, dan keempat berkas lama **me-re-export**
 * dari sini. Nol perubahan bagi pemanggil: `import { type Brief } from
 * '@/lib/kol'` tetap sah dan tetap menunjuk tipe yang sama.
 *
 * ## Kenapa berkas SENDIRI, bukan "semua impor dari account.ts"
 *
 * `account.ts` adalah modul data layer yang gemuk (BriefInput, Service, Plan
 * gate, puluhan fungsi `api.*`). Membuat `creative.ts`/`kol.ts`/`tasks.ts`
 * bergantung padanya hanya demi satu `interface` menautkan tiga modul divisi ke
 * modul Account — dan itu tautan yang tidak punya alasan selain sejarah. Berkas
 * daun tanpa impor apa pun tidak bisa melahirkan siklus.
 *
 * ## Aturan
 *
 * **Jangan pernah mendeklarasikan `interface Brief` kedua di `src/lib/`.**
 * `shape-parity.test.ts` sekarang menegakkannya: ia menghitung deklarasi `Brief`
 * di seluruh pohon lib FE dan merah kalau lebih dari satu. Field baru cukup
 * ditambahkan DI SINI, sekali, dan keempat konsumen ikut.
 *
 * Bentuk di bawah adalah bentuk `account.ts` apa adanya — ia yang selama ini
 * di-anchor ke `BriefWire`, jadi ia yang paling lengkap dan paling terbukti.
 * Menyatukan ke bentuk yang lebih sempit akan MENGHAPUS field dari halaman yang
 * hari ini merendernya.
 */

/** Satu Brief, persis seperti yang dikirim `BriefWire` (snake_case, wire). */
export interface Brief {
  id: string;
  service_id: string;
  strategy_id?: string;
  assigned_division: string;
  assigned_pic?: string;
  deliverable_type: string;
  quantity_target: number;
  due_date: string; // YYYY-MM-DD
  priority: string;
  recurring: boolean;
  recurring_frequency?: string;
  recurring_count?: number;
  recurring_end_date?: string;
  instructions?: string;
  reference_attachments?: string;
  title: string;
  status: string;
  revision_count: number; // only accurate on GetBrief (detail)
  revision_flagged: boolean; // only accurate on GetBrief (detail)
  created_by: string;
  created_at: string; // RFC3339
  // M16 — null untuk divisi tanpa pipeline tahapan (mis. Store Operation).
  stage_pipeline_code: string | null;
  production_stage: string | null;
  /**
   * Feedback OD 2026-09-07 Creative #3 (F-1/F-2, dirender B-2) — identitas klien
   * + nama PIC, ada di SETIAP baca Brief. NON-opsional: server mengirim `''`
   * eksplisit kalau belum ada PIC, jadi halaman merender `—`, bukan `undefined`.
   * Kueri yang mengisinya lewat `private.*` (perangkap O52) — jangan menambah
   * join `services`/`clients` di FE maupun di kueri baru.
   */
  client_id: string;
  client_nama: string;
  assigned_pic_nama: string;
  /**
   * A-req-1 (KOL #1) — jendela campaign + budget sebagai KOLOM, bukan teks di
   * `instructions`. `''`/`null` = belum diisi (eksplisit, bukan kunci hilang).
   */
  tanggal_mulai: string;
  tanggal_akhir: string;
  budget: string | null;
  /** A-req-2 (K-3) — Brief Creative sumber aset Brief Ads ini; null = tidak ditunjuk. */
  source_creative_brief_id: string | null;
  /**
   * A-req-3 — jumlah unit kerja anak (Asset / Campaign / Booking / Sesi Live /
   * baris SKU). Ada di SETIAP baris antrean divisi, jadi leader bisa membedakan
   * Brief yang sudah dipecah dari yang belum tanpa membuka satu-satu. `0` untuk
   * divisi tanpa tabel anak — dan `0` justru baris yang paling perlu dilihat.
   */
  jumlah_anak: number;
}
