// PDT (Pusat Data Toko), G1-09 — pratinjau deteksi batch (Flow A langkah 2-5,
// SEBELUM disimpan). Mirrors apps/api's `pdtPreviewBatchToWire` exactly
// (snake_case, keys identical); registered in shape-parity.test.ts.
//
// Halaman upload (tabel hasil deteksi + dropdown override AM + commit) BELUM
// dibangun — ini kontrak datanya lebih dulu, sub-langkah UI menyusul di sesi
// berikutnya (`docs/handoff/HANDOFF_PDT_SESI9.md` §3 G1-09).

import { api } from '@/lib/api';

export interface PdtPreviewBerkas {
  nama: string;
  modul_kode: string | null;
  modul_nama: string | null;
  ambiguous: boolean;
  matches: string[];
  baris_header: number | null;
  kolom_dipanen: number;
  kolom_baru: string[];
  status: string; // 'ok' | 'perlu_pilih_modul' | 'gagal' | 'ditolak_pagar'
  pesan: string | null;
  sha256: string | null;
  bytes: number | null;
}

export interface PdtPreviewIdentitas {
  status: string; // 'cocok' | 'usulkan_ikat' | 'tolak' | 'tidak_dapat_divalidasi'
  usulan: string | null;
  pesan: string | null;
}

export interface PdtPreviewPeriode {
  status: string; // 'ok' | 'tolak'
  mulai: string | null;
  selesai: string | null;
  pesan: string | null;
}

export interface PdtModuleOption {
  kode: string;
  nama_tampilan: string;
}

export interface PdtPreviewBatch {
  client_platform_id: number;
  platform: string;
  berkas: PdtPreviewBerkas[];
  identitas: PdtPreviewIdentitas;
  periode: PdtPreviewPeriode | null;
  module_options: PdtModuleOption[];
}

// G1-09-BODY-BESAR — siapkan unggah (POST /account/pdt/batches/upload-url),
// mendahului langkah 2: browser meng-PUT ZIP LANGSUNG ke `upload_url` (bukan
// lewat route CDPS — limit keras platform 4,5 MB, Rule 42 ≤ 50 MB), lalu
// memanggil POST .../preview dengan `storage_path` yang sama.
export interface PdtUploadUrl {
  client_platform_id: number;
  storage_path: string;
  upload_url: string;
}

// G1-09 sub-langkah 2a+2b-i — commit (POST /account/pdt/batches). Beda dari
// pratinjau: baris pdt_upload_batch/pdt_file sungguhan sudah tertulis saat
// respons ini dibentuk, dan rekonsiliasi Shopee (Rule 13-16) sudah bisa
// menghasilkan `status: 'verified'`/'ditolak' (basis Siap Dikirim, GMV saja
// — lihat docs/DECISIONS.md G1-07-PERSKU-PESANAN). TikTok + baris fakta
// tertipe masih sub-langkah 2b-ii. Belum ada halaman yang memanggilnya —
// sama seperti PdtPreviewBatch, kontrak datanya lebih dulu.
export interface PdtCommitBerkas extends PdtPreviewBerkas {
  deteksi_oleh: string; // 'tanda_tangan' | 'override_am'
}

export interface PdtCommitBatch {
  batch_id: number;
  client_platform_id: number;
  platform: string;
  status: string; // 'parsing' | 'identitas_belum_terikat' | 'verified' | 'ditolak'
  alasan_ditolak: string | null;
  reconcile_delta_pct: number | null;
  periode_mulai: string;
  periode_selesai: string;
  berkas: PdtCommitBerkas[];
  identitas: PdtPreviewIdentitas;
}

// G2-01 lanjutan — payload "laporan" v1 (GET /account/pdt/laporan, PDT-21
// Rule 21, Flow B langkah 1). Bentuk SAMA untuk TikTok/Shopee (`platform`
// diskriminator); `benchmark_versi` SELALU ada sebagai kunci (aturan rumah
// #4/O43) — `null` untuk Shopee (nol benchmark, asimetri asli mesin
// produksi). v1 SENGAJA sempit: KPI ringkas + skor saja — belum ada halaman
// yang memanggilnya, sama seperti PdtPreviewBatch/PdtCommitBatch, kontrak
// datanya lebih dulu.
export interface PdtLaporanKpi {
  gmv: number | null;
  pesanan: number | null;
  pengunjung: number | null;
  cvr: number | null;
}

export interface PdtLaporanDimensi {
  kode: string;
  label: string;
  bobot_dasar: number;
  nilai: number | null;
  disertakan: boolean;
  bobot_efektif: number;
  label_tampil: string;
}

export interface PdtLaporanSkor {
  total: number | null;
  label: string | null;
  dimensi: PdtLaporanDimensi[];
}

// G2-01 lanjutan — bagian "kanal" (sumber GMV), 2026-09-16. TikTok penuh
// (Live/Video/Kartu Produk & Shop Tab); Shopee SELALU `lengkap: false`
// (shopee_ads + affiliate saja — voucher/chat/meta_cpas/shopee_video belum
// ada penulis fakta PDT). `lengkap: false` berarti ADA sumber kanal legacy
// yang belum tercakup di sini — bukan "GMV kanal itu memang nol".
export interface PdtLaporanKanalItem {
  kode: string;
  label: string;
  gmv: number | null;
  persen: number | null;
}

export interface PdtLaporanKanal {
  gmv_total: number | null;
  items: PdtLaporanKanalItem[];
  lengkap: boolean;
}

// G2-01 lanjutan — bagian "live" (Live Streaming), 2026-09-16. SATU bentuk
// untuk TikTok+Shopee (nol asimetri platform) — `null` (whole object) berarti
// nol sesi live sama sekali di periode ini, BUKAN `sesi: 0`. `jam`/
// `gmv_per_jam` SELALU `null` untuk Shopee (kolom sumbernya kosong permanen
// di penulis `shopee_live`; TikTok `tt_live` mengisinya).
export interface PdtLaporanLive {
  sesi: number;
  gmv: number | null;
  vv: number | null;
  jam: number | null;
  gmv_per_sesi: number | null;
  gmv_per_jam: number | null;
}

// G2-01 lanjutan — bagian "video" (Video/Konten), 2026-09-16, TikTok-only.
// `null` (whole object) SELALU untuk Shopee hari ini (`shopee_video` nol
// penulis fakta — belum didukung, BUKAN "nol video bulan ini"), dan untuk
// TikTok tanpa video sama sekali di periode ini.
export interface PdtLaporanVideo {
  total: number;
  gmv: number | null;
  vv: number | null;
  likes: number | null;
  dibagikan: number | null;
  klik_produk: number | null;
  gmv_per_video: number | null;
  vv_per_video: number | null;
}

// G2-01 lanjutan — bagian "iklan", 2026-09-16. KEDUA platform dibangun
// sekaligus (beda dari "video" TikTok-only) — TAPI TETAP tidak simetris:
// TikTok SELALU `lengkap: true` (tt_ads_product+tt_ads_live, dua sumber
// asli, keduanya sudah punya penulis fakta sejak PR #413); Shopee SELALU
// `lengkap: false` PERMANEN (`ads_banner` legacy tidak pernah punya modul
// PDT sama sekali — beda root cause dari "kanal", sama akibatnya). `null`
// (whole object) berarti nol baris iklan seluruh sumber platform ini di
// periode ini, BUKAN objek kosong ber-`items: []`.
export interface PdtLaporanIklanItem {
  kode: string;
  label: string;
  biaya: number | null;
  gmv: number | null;
  roas: number | null;
}

export interface PdtLaporanIklan {
  biaya: number | null;
  gmv: number | null;
  roas: number | null;
  items: PdtLaporanIklanItem[];
  lengkap: boolean;
}

// G2-01 lanjutan — bagian "afiliasi" ringkasan, 2026-09-16. KEDUA platform,
// SATU bentuk (beda dari "kanal"/"iklan" — nol `lengkap` flag, pola sama
// "live"/"video"): `jumlah_live`/`jumlah_video` SELALU `null` untuk Shopee
// (`shopee_ams_afiliasi` tidak pernah menulis kolom itu). RINGKASAN saja —
// BUKAN daftar per-kreator (mesin lama membawa `refund`/`komisi`/`roiKomisi`
// per kreator, `pdt_fact_creator_period` tidak pernah punya kolom itu).
// `null` (whole object) berarti nol baris kreator sama sekali di periode ini.
export interface PdtLaporanAfiliasi {
  total_kreator: number;
  produktif: number;
  gmv: number | null;
  pesanan: number | null;
  aov: number | null;
  jumlah_live: number | null;
  jumlah_video: number | null;
}

export interface PdtLaporan {
  schema: string;
  platform: string;
  client_platform_id: number;
  periode_awal_bulan: string;
  generated_at: string;
  kpi: PdtLaporanKpi;
  kanal: PdtLaporanKanal;
  iklan: PdtLaporanIklan | null;
  live: PdtLaporanLive | null;
  video: PdtLaporanVideo | null;
  afiliasi: PdtLaporanAfiliasi | null;
  skor: PdtLaporanSkor;
  benchmark_versi: number | null;
}

/**
 * GET /account/pdt/laporan — Flow B langkah 1. `periode` wajib `YYYY-MM-01`
 * (hari pertama bulan); halaman pemanggil mengonversi dari
 * `<input type="month">` ("YYYY-MM") sebelum memanggil ini.
 */
export function getPdtLaporan(clientPlatformId: number, periode: string): Promise<PdtLaporan> {
  const search = new URLSearchParams({ client_platform_id: String(clientPlatformId), periode });
  return api.get<PdtLaporan>(`/account/pdt/laporan?${search.toString()}`);
}

// G2-01 — "Kirim ke klien" (POST /account/pdt/laporan/kirim, Flow B langkah
// 4, Rule 22). Kirim kedua untuk toko+periode yang sama BUKAN error — itu
// kirim-ulang/revisi (Flow B langkah 5, Rule 23): `menggantikan_kiriman_id`
// menunjuk kiriman sebelumnya, nol upload ulang berkas diminta.
export interface PdtLaporanKiriman {
  id: number;
  client_platform_id: number;
  periode_mulai: string;
  periode_selesai: string;
  parser_versi: number;
  benchmark_versi: number | null;
  dikirim_pada: string;
  dikirim_oleh: string;
  menggantikan_kiriman_id: number | null;
  laporan: PdtLaporan;
}

export function kirimLaporanPdt(clientPlatformId: number, periode: string): Promise<PdtLaporanKiriman> {
  return api.post<PdtLaporanKiriman>('/account/pdt/laporan/kirim', { client_platform_id: clientPlatformId, periode });
}

// G2-01 — riwayat kiriman (GET /account/pdt/laporan/kiriman, Flow B langkah
// 5). Bentuk sama PdtLaporanKiriman MINUS `laporan` (snapshot beku sengaja
// tidak diikutkan daftar — daftar ini untuk "kapan/oleh siapa/revisi dari
// yang mana", bukan isi persisnya).
export interface PdtKirimanRingkas {
  id: number;
  client_platform_id: number;
  periode_mulai: string;
  periode_selesai: string;
  parser_versi: number;
  benchmark_versi: number | null;
  dikirim_pada: string;
  dikirim_oleh: string;
  menggantikan_kiriman_id: number | null;
}

export async function riwayatKirimanPdt(clientPlatformId: number): Promise<PdtKirimanRingkas[]> {
  const res = await api.get<{ data: PdtKirimanRingkas[] }>(
    `/account/pdt/laporan/kiriman?client_platform_id=${clientPlatformId}`,
  );
  return res.data;
}
