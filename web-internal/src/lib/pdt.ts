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
