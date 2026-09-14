// PDT (Pusat Data Toko), G1-09 — pratinjau deteksi batch (Flow A langkah 2-5,
// SEBELUM disimpan). Mirrors apps/api's `pdtPreviewBatchToWire` exactly
// (snake_case, keys identical); registered in shape-parity.test.ts.
//
// Halaman upload (tabel hasil deteksi + dropdown override AM + commit) BELUM
// dibangun — ini kontrak datanya lebih dulu, sub-langkah UI menyusul di sesi
// berikutnya (`docs/handoff/HANDOFF_PDT_SESI9.md` §3 G1-09).

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
