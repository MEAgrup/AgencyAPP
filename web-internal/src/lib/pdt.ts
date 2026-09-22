// PDT (Pusat Data Toko), G1-09 — pratinjau deteksi batch (Flow A langkah 2-5,
// SEBELUM disimpan). Mirrors apps/api's `pdtPreviewBatchToWire` exactly
// (snake_case, keys identical); registered in shape-parity.test.ts.
//
// Halaman upload (`/account/pdt/upload`, G1-09 sub-langkah 3): tabel hasil
// deteksi + dropdown override AM + commit + riwayat batch/status paket.

import { api } from '@/lib/api';
import { getClient, type Platform } from '@/lib/clients';

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
// tertipe sudah sub-langkah 2b-ii (lihat G1-09-2BII-* di `PDT_BACKLOG.md`).
export interface PdtCommitBerkas extends PdtPreviewBerkas {
  deteksi_oleh: string; // 'tanda_tangan' | 'override_am'
}

export interface PdtCommitBatch {
  batch_id: number;
  client_platform_id: number;
  platform: string;
  status: string; // 'parsing' | 'identitas_belum_terikat' | 'verified' | 'ditolak' | 'digantikan'
  alasan_ditolak: string | null;
  reconcile_delta_pct: number | null;
  periode_mulai: string;
  periode_selesai: string;
  berkas: PdtCommitBerkas[];
  identitas: PdtPreviewIdentitas;
  // G1-12 (Rule 36) — batch verified LAMA yang baru saja digantikan oleh commit ini
  // (supersede otomatis, bukan pilihan AM — lihat docblock commitUploadBatch), null bila bukan supersede.
  menggantikan_batch_id: number | null;
}

// G1-09 sub-langkah 3 — halaman upload. Tiga panggilan berurutan (Flow A
// langkah 2-6): `siapkanUploadBatchPdt` (signed upload URL) → browser PUT
// langsung ke `upload_url` (BUKAN lewat `api`, lihat halaman) → `previewBatchPdt`
// (tabel deteksi, nol tulis DB) → AM menyunting override bila perlu →
// `commitBatchPdt` (storage_path SAMA, pipeline dijalankan ULANG server —
// lihat docblock route `POST /account/pdt/batches`).
export function siapkanUploadBatchPdt(clientPlatformId: number): Promise<PdtUploadUrl> {
  return api.post<PdtUploadUrl>('/account/pdt/batches/upload-url', { client_platform_id: clientPlatformId });
}

export function previewBatchPdt(clientPlatformId: number, storagePath: string): Promise<PdtPreviewBatch> {
  return api.post<PdtPreviewBatch>('/account/pdt/batches/preview', {
    client_platform_id: clientPlatformId,
    storage_path: storagePath,
  });
}

export interface PdtCommitOverrideInput {
  nama: string;
  modul_kode: string;
}

export function commitBatchPdt(
  clientPlatformId: number,
  storagePath: string,
  overrides: PdtCommitOverrideInput[],
): Promise<PdtCommitBatch> {
  return api.post<PdtCommitBatch>('/account/pdt/batches', {
    client_platform_id: clientPlatformId,
    storage_path: storagePath,
    overrides,
  });
}

// G1-09-KONFIRMASI-IDENTITAS — Rule 2 (Shopee)/Rule 4 (TikTok), konfirmasi
// SEKALI usulan identitas batch `identitas_belum_terikat` (POST
// /account/pdt/batches/konfirmasi-identitas). `status_setelah_reparse`
// `null` berarti reparse langsung belum/tidak jalan (paket sudah dipurge,
// atau gagal) — identitas TETAP terikat, batch menunggu tick reparse harian
// atau unggah ulang.
export interface PdtKonfirmasiIdentitas {
  batch_id: number;
  client_platform_id: number;
  platform: string;
  nilai_diikat: string;
  status_setelah_reparse: string | null;
}

export function konfirmasiIdentitasBatchPdt(batchId: number): Promise<PdtKonfirmasiIdentitas> {
  return api.post<PdtKonfirmasiIdentitas>('/account/pdt/batches/konfirmasi-identitas', { batch_id: batchId });
}

// G1-09 sub-langkah 3, bullet 4 — riwayat batch toko ini (GET
// /account/pdt/batches), TERMASUK batch `ditolak`/`digantikan` (Rule 10:
// diagnosis tanpa upload ulang). `paket_status` turunan server dari
// legal_hold/raw_dihapus_pada/retensi_sampai — halaman tidak menghitung ulang.
export interface PdtBatchRingkas {
  id: number;
  client_platform_id: number;
  platform: string;
  status: string; // 'parsing' | 'identitas_belum_terikat' | 'verified' | 'ditolak' | 'digantikan'
  alasan_ditolak: string | null;
  reconcile_delta_pct: number | null;
  periode_mulai: string;
  periode_selesai: string;
  dibuat_pada: string;
  dibuat_oleh: string;
  paket_status: string; // 'tersedia' | 'kedaluwarsa' | 'legal_hold'
  retensi_sampai: string | null;
  // G1-12 (Rule 36) — batch LAMA yang baris ini gantikan, null bila baris ini bukan hasil supersede.
  menggantikan_batch_id: number | null;
}

export async function riwayatBatchPdt(clientPlatformId: number): Promise<PdtBatchRingkas[]> {
  const res = await api.get<{ data: PdtBatchRingkas[] }>(
    `/account/pdt/batches?client_platform_id=${clientPlatformId}`,
  );
  return res.data;
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
  /** Berapa BARANG yang dibuka dalam satu KUNJUNGAN, rata-rata (penyebutnya kunjungan harian, bukan pengunjung unik sebulan). Terisi di kedua platform; `null` = "tidak diketahui", bukan nol. */
  barang_per_pengunjung: number | null;
  /** `'dalam' | 'sedang' | 'dangkal'`, atau `null` bila angkanya `null`. */
  kedalaman: string | null;
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

// Bagian "harian" (tren GMV per hari), 2026-09-21 — §2 di KEDUA laporan HTML
// lama dan satu-satunya bagian keduanya yang PDT belum punya sama sekali.
// `null` (whole object) = nol baris `pdt_fact_shop_daily` di periode ini.
// `titik` HANYA memuat hari yang benar-benar ada barisnya: hari yang absen
// TIDAK diisi nol (Rule 12 — "berkas tidak memuat hari itu" bukan "toko tidak
// jualan hari itu"), jadi grafik garisnya boleh berlubang dan `hari_terisi`
// menyebut cakupan sebenarnya. Σ `titik[].gmv` SELALU = `kpi.gmv`: keduanya
// membaca baris yang sama dengan basis yang sama.
export interface PdtLaporanHarianTitik {
  tanggal: string;
  gmv: number | null;
  pesanan: number | null;
  pengunjung: number | null;
  cvr: number | null;
}

export interface PdtLaporanHarian {
  titik: PdtLaporanHarianTitik[];
  hari_terisi: number;
  gmv_tertinggi: PdtLaporanHarianTitik | null;
  gmv_terendah: PdtLaporanHarianTitik | null;
  gmv_rata_harian: number | null;
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

// G2-01-KUADRAN-SKU lanjutan — bagian "produk" (Portfolio Produk/kuadran),
// TikTok-ONLY (`null` whole object untuk Shopee SELALU — methodology kuadran
// beda total dari TikTok, belum ada modul PDT sumber data, sama gap "tahap").
// Mode BENCHMARK SAJA (bukan "Mode Relatif" mesin lama). `distribusi` —
// jumlah SKU + Σgmv per kuadran (kunci: bintang/hidden_gem/bocor_traffic/
// evaluasi/tidur/tidak_tayang). `top_aksi` — HANYA tiga kuadran actionable
// (bintang/bocor_traffic/hidden_gem), diurutkan GMV desc, dipotong 12.
export interface PdtLaporanProdukItem {
  nama_produk: string | null;
  platform_product_id: string | null;
  gmv: number | null;
  klik: number | null;
  cvr: number | null;
  kuadran: string;
}

export interface PdtLaporanProdukDistribusi {
  jumlah: number;
  gmv: number | null;
}

/** Satu baris "Top Produk by GMV" — LINTAS kuadran. `kuadran` `null` = belum/tidak terklasifikasi (SELURUH baris Shopee). */
export interface PdtLaporanProdukTopItem {
  /** Sumbu-X kuadran: klik (TikTok) / kunjungan halaman produk (Shopee). */
  traffic: number | null;
  /** Tayangan kartu produk di feed/pencarian — tahap funnel DI ATAS `traffic`. */
  impresi: number | null;
  /** `klik ÷ impresi`. */
  ctr: number | null;
  nama_produk: string | null;
  platform_product_id: string | null;
  gmv: number | null;
  klik: number | null;
  cvr: number | null;
  kuadran: string | null;
}

/** Ambang kuadran mode relatif — percentile p25/p75 katalog periode ini. */
export interface PdtLaporanProdukAmbang {
  traffic_rendah: number | null;
  traffic_tinggi: number | null;
  cr_rendah: number | null;
  cr_tinggi: number | null;
  n: number;
}

/** Panel kedua — kuadran yang sama dihitung ulang dengan ambang percentile katalog, bukan benchmark/absolut. `null` bila nol produk aktif periode ini. */
export interface PdtLaporanProdukRelatif {
  distribusi: Record<string, PdtLaporanProdukDistribusi>;
  ambang: PdtLaporanProdukAmbang;
}

export interface PdtLaporanProduk {
  /** Mode TERSIMPAN: benchmark (TikTok) / absolut (Shopee). `null` = nol produk periode ini pernah diklasifikasi, BUKAN "semua produk tidak tayang". */
  distribusi: Record<string, PdtLaporanProdukDistribusi> | null;
  top_aksi: PdtLaporanProdukItem[];
  top: PdtLaporanProdukTopItem[];
  relatif: PdtLaporanProdukRelatif | null;
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

// G2-01 lanjutan — bagian "tahap" (buyer-journey Awareness→Consideration→
// Conversion), 2026-09-16. TikTok-ONLY — `null` (whole object) untuk Shopee
// SELALU (mesin lama Shopee tidak punya konsep buyer-journey sama sekali,
// bukan gap data seperti "video"), dan untuk TikTok saat nol baris
// `pdt_fact_shop_daily` basis `net` periode ini. Banyak `metrik[].nilai`/
// `funnel[].nilai` `null` PERMANEN sampai modul TikTok Ads Manager dibangun
// (scope terpisah, belum ada) — itu jujur terhadap data yang ada, bukan bug.
export type PdtTahapKey = 'awareness' | 'consideration' | 'conversion';
export type PdtTahapSatuan = 'rupiah' | 'angka' | 'persen' | 'kali';

export interface PdtLaporanFunnelLangkah {
  kode: string;
  label: string;
  nilai: number | null;
  lolos: number | null;
  lolos_dari: string | null;
  catatan: string | null;
}

export interface PdtLaporanTahapMetrik {
  kode: string;
  label: string;
  nilai: number | null;
  satuan: PdtTahapSatuan;
}

export interface PdtLaporanTahapBlok {
  kode: PdtTahapKey;
  label: string;
  fokus: boolean;
  belanja: number | null;
  belanja_persen: number | null;
  metrik: PdtLaporanTahapMetrik[];
}

export interface PdtLaporanTahap {
  fokus: PdtTahapKey | null;
  funnel: PdtLaporanFunnelLangkah[];
  konversi_total: { nilai: number | null };
  belanja_total: number | null;
  blok: PdtLaporanTahapBlok[];
}

// G2-01 lanjutan — bagian "insight" (narasi + rekomendasi), 2026-09-16, KEDUA
// platform SATU bentuk. Tidak pernah `null` (beda `iklan`/`live`/`video`/
// `afiliasi`/`tahap`) — `ringkasan`/`outlook` selalu punya sesuatu untuk
// dikatakan bahkan saat `kpi` seluruhnya `null`. Rekomendasi v1 GENERIK per
// dimensi skor (`skor.dimensi` ber-nilai rendah), BUKAN porting penuh aturan
// per-metrik mesin lama (lihat docblock `pdt.PdtLaporanInsight`, `@cdps/core`,
// untuk kenapa). AM TIDAK menyunting field ini di halaman ini — penyuntingan
// (tiket terpisah) terjadi di layar pratinjau sebelum tombol "Kirim ke
// Klien" ditekan, PDT-21 tetap utuh (nol state machine draft/publikasi baru).
export interface PdtLaporanRekomendasi {
  judul: string;
  target: string;
  dampak: string;
  timeline: string;
}

export interface PdtLaporanInsight {
  ringkasan: string;
  poin: string[];
  rekomendasi_tinggi: PdtLaporanRekomendasi[];
  rekomendasi_sedang: PdtLaporanRekomendasi[];
  outlook: string;
  indikator: { nama: string; target: string }[];
}

export interface PdtLaporanKreatorItem {
  handle: string;
  gmv: number | null;
  gmv_live: number | null;
  gmv_video: number | null;
  pesanan: number | null;
  aov: number | null;
  jumlah_live: number | null;
  jumlah_video: number | null;
}

/** Daftar per-kreator di balik ringkasan `afiliasi` — "Top 10 Creator" mesin lama. */
export interface PdtLaporanKreator {
  top: PdtLaporanKreatorItem[];
  total_kreator: number;
  kontribusi_top: number | null;
}

export interface PdtLaporanSesiLiveItem {
  platform_content_id: string;
  creator_handle: string | null;
  akun_toko: boolean;
  waktu_posting: string | null;
  durasi_detik: number | null;
  vv: number | null;
  gmv: number | null;
  gmv_per_jam: number | null;
  pengikut_baru: number | null;
  klik_produk: number | null;
}

/** Daftar per-sesi di balik ringkasan `live` — "Top 10 Sesi" mesin lama. */
export interface PdtLaporanSesiLive {
  top: PdtLaporanSesiLiveItem[];
  total_sesi: number;
  kontribusi_top: number | null;
}

export interface PdtLaporanKampanyeItem {
  sumber: string;
  kampanye_id: string;
  biaya: number;
  gmv: number | null;
  roas: number | null;
  tayangan: number | null;
  klik: number | null;
  pesanan: number | null;
  ctr: number | null;
  cpc: number | null;
}

/** Daftar per-kampanye di balik ringkasan `iklan` — "Per Kampanye" mesin lama. */
export interface PdtLaporanKampanye {
  top: PdtLaporanKampanyeItem[];
  total_kampanye: number;
  tanpa_hasil: number;
  biaya_tanpa_hasil: number | null;
}

export interface PdtLaporanPromoAngka {
  penjualan_dibuat: number | null;
  penjualan_siap_dikirim: number | null;
  pesanan_dibuat: number | null;
  pesanan_siap_dikirim: number | null;
}

export interface PdtLaporanPromoTipe extends PdtLaporanPromoAngka {
  tipe: string;
}

export interface PdtLaporanPromoFlashSale extends PdtLaporanPromoAngka {
  produk_dilihat: number | null;
  produk_diklik: number | null;
  ctr: number | null;
  cvr: number | null;
}

/** §8 mesin Shopee lama. `diskon_per_tipe` KOMPONEN yang boleh tumpang tindih — jangan dijumlah; `diskon_total` sudah menjawabnya. */
export interface PdtLaporanPromo {
  diskon_total: PdtLaporanPromoAngka | null;
  diskon_per_tipe: PdtLaporanPromoTipe[];
  flash_sale: PdtLaporanPromoFlashSale | null;
  kontribusi_gmv_diskon: number | null;
  kontribusi_gmv_flash_sale: number | null;
}

/** Seluruh rasio PECAHAN (0..1) — sudah dinormalkan di server. */
export interface PdtLaporanLayananChat {
  baris_sumber: number;
  pengunjung: number | null;
  chat_masuk: number | null;
  chat_dibalas: number | null;
  response_rate: number | null;
  waktu_respon_detik: number | null;
  csat: number | null;
  total_pesanan: number | null;
  penjualan: number | null;
  konversi_chat_dibalas: number | null;
}

export interface PdtLaporanPenalti {
  poin: number;
  deskripsi: string;
  durasi: string;
}

/** §9 mesin Shopee lama. Cancel rate/retur TIDAK ada — nol kolom sumbernya di fakta PDT. */
export interface PdtLaporanLayanan {
  chat: PdtLaporanLayananChat | null;
  poin_penalti_total: number | null;
  penalti: PdtLaporanPenalti[];
}

export interface PdtLaporan {
  schema: string;
  platform: string;
  client_platform_id: number;
  periode_awal_bulan: string;
  generated_at: string;
  kpi: PdtLaporanKpi;
  harian: PdtLaporanHarian | null;
  kanal: PdtLaporanKanal;
  iklan: PdtLaporanIklan | null;
  live: PdtLaporanLive | null;
  video: PdtLaporanVideo | null;
  produk: PdtLaporanProduk | null;
  afiliasi: PdtLaporanAfiliasi | null;
  kreator: PdtLaporanKreator | null;
  sesi_live: PdtLaporanSesiLive | null;
  kampanye: PdtLaporanKampanye | null;
  /** `null` untuk TikTok SELALU. */
  promo: PdtLaporanPromo | null;
  /** `null` untuk TikTok SELALU. */
  layanan: PdtLaporanLayanan | null;
  tahap: PdtLaporanTahap | null;
  skor: PdtLaporanSkor;
  benchmark_versi: number | null;
  insight: PdtLaporanInsight;
  /** M20 R2 — catatan kelengkapan data, untuk mata AM. Mode render `klien` tidak membangunnya. */
  kelengkapan: PdtLaporanKelengkapan;
}

/**
 * M20 R2 — kelengkapan sebagai DATA, bukan kalimat.
 *
 * Sebelum ini teks banner ditulis tangan di JSX halaman laporan, dan kalimat
 * yang sama juga didorong mesin ke `insight.poin` — dua bentuk satu makna, dan
 * yang lewat `insight` ikut beku ke payload kiriman, jadi ia akan terbit ke
 * klien begitu permukaan klien dibangun. Sekarang satu sumber, dan sumber itu
 * bisa dibaca mesin.
 */
export interface PdtLaporanKelengkapanBaris {
  bagian: string;
  lengkap: boolean;
  alasan: string;
  modul_hilang: string[];
}

export interface PdtLaporanKelengkapan {
  semua_lengkap: boolean;
  baris: PdtLaporanKelengkapanBaris[];
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

// G2-01-INSIGHT-EDIT — draf sunting AM (layar pratinjau, sebelum "Kirim ke
// Klien"). Field OPSIONAL/longgar — validasi + pesan BI `[...]` sepenuhnya
// tugas server (`pdt.normalizePdtInsightDraft`, @cdps/core); FE mengirim apa
// adanya, termasuk baris kosong (server yang membuang/menolak).
export interface PdtInsightDraft {
  ringkasan?: string;
  poin?: string[];
  rekomendasi_tinggi?: PdtLaporanRekomendasi[];
  rekomendasi_sedang?: PdtLaporanRekomendasi[];
  outlook?: string;
  indikator?: { nama: string; target: string }[];
}

export function kirimLaporanPdt(clientPlatformId: number, periode: string, insight?: PdtInsightDraft): Promise<PdtLaporanKiriman> {
  return api.post<PdtLaporanKiriman>('/account/pdt/laporan/kirim', { client_platform_id: clientPlatformId, periode, insight });
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

/** M20 B-03/B-04 — mirror `reportHtmlUrl` (`lib/report.ts`, M14). `<a href>`
 *  langsung (bukan `api.get`) supaya "Unduh" memicu Save As browser lewat
 *  Content-Disposition, bukan JSON fetch. */
export type PdtLaporanRenderMode = 'klien' | 'internal';

export function pdtLaporanHtmlUrl(kirimanId: number, mode: PdtLaporanRenderMode, download = false): string {
  return `/api/v1/account/pdt/laporan/kiriman/${kirimanId}/html?mode=${mode}${download ? '&download=1' : ''}`;
}

// ---------------------------------------------------------------------------
// M20 Gelombang C — revisi insight + publikasi (C-04 editor). `PdtLaporanInsightRow`
// membawa TUJUH bidang (enam narasi sama `PdtLaporanInsight` di atas + `tahap_narasi`
// baru) plus metadata revisi — beda dari `PdtLaporanInsight` yang tertanam di dalam
// `PdtLaporan` (payload beku, nol metadata revisi, nol `tahap_narasi`).
// ---------------------------------------------------------------------------

export interface PdtLaporanInsightRow {
  kiriman_id: number;
  revisi: number;
  sumber: 'mesin' | 'am';
  ringkasan: string;
  poin: string[];
  rekomendasi_tinggi: PdtLaporanRekomendasi[];
  rekomendasi_sedang: PdtLaporanRekomendasi[];
  outlook: string;
  indikator: { nama: string; target: string }[];
  tahap_narasi: string | null;
  ditulis_oleh: string;
  ditulis_pada: string;
}

export interface PdtLaporanPublikasi {
  kiriman_id: number;
  status: '[Draf]' | '[Terbit]' | '[Dicabut]';
  insight_revisi: number;
  diterbitkan_pada: string | null;
  diterbitkan_oleh: string | null;
  alasan_cabut: string | null;
}

export interface PdtInsightState {
  kiriman_id: number;
  terbaru: PdtLaporanInsightRow;
  publikasi: PdtLaporanPublikasi;
}

/** Body PUT .../insight — pola sama `PdtInsightDraft` (draf pra-kirim) + `tahap_narasi` baru. */
export interface PdtInsightEditDraft {
  ringkasan?: string;
  poin?: string[];
  rekomendasi_tinggi?: PdtLaporanRekomendasi[];
  rekomendasi_sedang?: PdtLaporanRekomendasi[];
  outlook?: string;
  indikator?: { nama: string; target: string }[];
  tahap_narasi?: string;
}

export function bacaInsightKiriman(kirimanId: number): Promise<PdtInsightState> {
  return api.get<PdtInsightState>(`/account/pdt/laporan/kiriman/${kirimanId}/insight`);
}

export function simpanInsightKiriman(kirimanId: number, draft: PdtInsightEditDraft): Promise<PdtLaporanInsightRow> {
  return api.put<PdtLaporanInsightRow>(`/account/pdt/laporan/kiriman/${kirimanId}/insight`, draft);
}

export function resetInsightKiriman(kirimanId: number): Promise<PdtLaporanInsightRow> {
  return api.post<PdtLaporanInsightRow>(`/account/pdt/laporan/kiriman/${kirimanId}/insight/reset`, {});
}

export function terbitkanKiriman(kirimanId: number): Promise<PdtLaporanPublikasi> {
  return api.post<PdtLaporanPublikasi>(`/account/pdt/laporan/kiriman/${kirimanId}/terbitkan`, {});
}

export function terbitkanUlangKiriman(kirimanId: number): Promise<PdtLaporanPublikasi> {
  return api.post<PdtLaporanPublikasi>(`/account/pdt/laporan/kiriman/${kirimanId}/terbitkan-ulang`, {});
}

export function cabutKiriman(kirimanId: number, alasan: string): Promise<PdtLaporanPublikasi> {
  return api.post<PdtLaporanPublikasi>(`/account/pdt/laporan/kiriman/${kirimanId}/cabut`, { alasan });
}

// G2-02 — admin kalibrasi `pdt_benchmark` (GET/POST /account/pdt/benchmark,
// Director-only, `pdt.canKelolaBenchmark`). Preseden HURUF PER HURUF
// `PxEligibilityPolicy`/`listEligibilityPolicy`/`createEligibilityPolicy`
// (`web-internal/src/lib/px.ts`) — append-only, `aktif` tidak pernah dibalik.
export interface PdtBenchBand {
  good: number;
  warn: number;
}

export interface PdtBenchmarkVersi {
  platform: string;
  versi: number;
  nilai: Record<string, PdtBenchBand>;
  aktif: boolean;
  catatan: string | null;
  dibuat_pada: string;
  dibuat_oleh: string;
}

export function listBenchmarkVersi(platform = 'tiktok'): Promise<{ data: PdtBenchmarkVersi[] }> {
  return api.get<{ data: PdtBenchmarkVersi[] }>(`/account/pdt/benchmark?platform=${platform}`);
}

export interface TambahVersiBenchmarkInput {
  platform?: string;
  nilai: Record<string, PdtBenchBand>;
  catatan: string;
  aktif?: boolean;
}

export function tambahVersiBenchmark(input: TambahVersiBenchmarkInput): Promise<PdtBenchmarkVersi> {
  return api.post<PdtBenchmarkVersi>('/account/pdt/benchmark', input);
}

/**
 * Platform toko yang didukung PDT (PDT-22) — cermin `platformKeVokabPdt`
 * (`@cdps/core` `pdt/types.ts`). Satu-satunya salinan daftar ini di FE: sebelum
 * G1-09-PLATFORM-DARI-DETAIL ia digandakan sebagai `const` lokal di halaman
 * upload DAN halaman laporan, yang berarti menambah platform PDT menuntut dua
 * suntingan yang mudah terlewat satu.
 */
export const PDT_PLATFORMS: ReadonlySet<string> = new Set(['Shopee', 'TikTok Shop']);

/**
 * Daftar toko ber-platform PDT milik satu klien, dibaca dari **detail klien**
 * (`GET /clients/{id}`) — BUKAN dari baris roster `GET /clients`.
 *
 * Ini perbaikan bug kelas O43 (`CLAUDE.md`: "Kunci yang HILANG lebih berbahaya
 * daripada null"). `ClientListRowWire` adalah proyeksi yang SENGAJA sempit dan
 * tidak pernah memuat `platforms` — melebarkannya berarti N+1 atas
 * platforms/allocations/services untuk daftar yang tidak membacanya (lihat
 * docblock `ClientListRowWire` di `apps/api/src/lib/wire.ts`). Tapi tipe FE
 * `Client` menyatakan `platforms: Platform[]` WAJIB, jadi
 * `selectedClient.platforms.filter(...)` lolos typecheck, lalu melempar
 * `Cannot read properties of undefined (reading 'filter')` di browser: halaman
 * mati total ("This page couldn't load") setiap kali AM memilih klien —
 * route-nya sendiri tetap menjawab 200, persis gejala O43.
 *
 * Karena itu platform HARUS diambil dari detail, satu klien sekali pilih.
 */
export async function listPlatformPdtKlien(clientId: string): Promise<Platform[]> {
  const { client } = await getClient(clientId);
  return (client.platforms ?? []).filter((p) => p.active && PDT_PLATFORMS.has(p.platform));
}
