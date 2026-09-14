import { describe, expect, it } from 'vitest';
import { PDT_MODULES } from './modules';
import {
  LABEL_DIMENSI_TIDAK_TERSEDIA,
  cariKolomWajib,
  renormalisasiDimensi,
  totalSkorDimensi,
  turunkanParseStatus,
  validasiKolomWajib,
  type PdtDimensiSkor,
} from './parsestatus';

const kolomDipanenModul = (kode: string): readonly string[] => PDT_MODULES.find((m) => m.kode === kode)!.kolomDipanen;

describe('cariKolomWajib (Rule 9)', () => {
  const header = ['Kode Produk', 'GMV dari kreator', 'CTOR'];

  it('exact match', () => {
    expect(cariKolomWajib(header, 'GMV dari kreator')).toEqual({ ditemukan: true, idx: 1, lewatAlias: false });
  });

  it('lewat alias bila nama kanonik tidak ada tapi aliasnya ada', () => {
    expect(cariKolomWajib(header, 'GMV Kreator', ['GMV dari kreator'])).toEqual({ ditemukan: true, idx: 1, lewatAlias: true });
  });

  it('tidak ditemukan — kanonik maupun alias', () => {
    expect(cariKolomWajib(header, 'Kolom Hantu', ['Alias Hantu'])).toEqual({ ditemukan: false, idx: -1, lewatAlias: false });
  });
});

describe('validasiKolomWajib (Rule 9)', () => {
  const header = ['Kode Produk', 'GMV dari kreator'];

  it('kosong bila semua kolom wajib ada', () => {
    expect(validasiKolomWajib(header, ['Kode Produk', 'GMV dari kreator'])).toEqual([]);
  });

  it('menyebut NAMA kolom yang dicari untuk tiap kolom wajib yang hilang', () => {
    const gagal = validasiKolomWajib(header, ['Kode Produk', 'ID Video', 'ID Kreator']);
    expect(gagal).toEqual([
      { kolom: 'ID Video', pesan: "[kolom wajib 'ID Video' tidak ditemukan di berkas]" },
      { kolom: 'ID Kreator', pesan: "[kolom wajib 'ID Kreator' tidak ditemukan di berkas]" },
    ]);
  });

  it('alias menyelamatkan kolom dari dianggap hilang', () => {
    const gagal = validasiKolomWajib(header, ['GMV Kreator'], { 'GMV Kreator': ['GMV dari kreator'] });
    expect(gagal).toEqual([]);
  });
});

describe('validasiKolomWajib × PDT_MODULES.kolomDipanen — header PERSIS sample asli Fim Motor (bug laten sesi lanjutan pasca-sesi 20)', () => {
  // Header baris tunggal diambil langsung dari berkas ekspor Shopee asli
  // (Fim Motor, diunggah pemilik) — bukan fixture yang ditulis untuk cocok
  // dengan tebakan kolomDipanen (kelas kesalahan yang menyembunyikan bug
  // `shopee_ads_cpc`/AMS sampai sesi 19/20).

  it('shopee_ads_search — header baris 8, Search-Ads-Overall-Data-*.csv', () => {
    const header = [
      'Urutan', 'Nama Iklan', 'Status', 'Tampilan Iklan', 'Mode Bidding', 'Kata Pencarian', 'Tanggal Mulai',
      'Tanggal Selesai', 'SOV', 'Dilihat', 'Jumlah Klik', 'Persentase Klik', 'Konversi', 'Konversi Langsung',
      'Tingkat konversi', 'Tingkat Konversi Langsung', 'Biaya per Konversi', 'Biaya per Konversi Langsung',
      'Produk Terjual', 'Terjual Langsung', 'Omzet Penjualan', 'Penjualan Langsung (GMV Langsung)', 'Biaya',
      'Efektifitas Iklan', 'Efektivitas Langsung',
      'Persentase Biaya Iklan terhadap Penjualan dari Iklan (ACOS)',
      'Persentase Biaya Iklan terhadap Penjualan dari Iklan Langsung (ACOS Langsung)',
      'Jumlah Produk Dilihat', 'Jumlah Klik Produk', 'Persentase Klik Produk',
    ];
    expect(validasiKolomWajib(header, kolomDipanenModul('shopee_ads_search'))).toEqual([]);
  });

  it('shopee_live — sheet "Daftar Streaming", live_streaming_*.xlsx', () => {
    const header = [
      'Informasi Streaming', 'Waktu Mulai', 'Pengunjung', 'Penonton Terbanyak', 'Rata-rata Durasi Menonton',
      'Pesanan (COD Dibuat + non-COD Dibayar)', 'Penjualan (Pesanan Siap Dikirim)(Rp)',
    ];
    expect(validasiKolomWajib(header, kolomDipanenModul('shopee_live'))).toEqual([]);
  });

  it('shopee_chat — sheet "Kriteria Utama", chat_*.xlsx', () => {
    const header = [
      'Periode Waktu', 'Pengunjung', 'Jumlah Chat', 'Pengunjung Bertanya', 'Pertanyaan Diajukan', 'Chat Dibalas',
      'Chat Belum Dibalas', 'Waktu Respon Rata-rata', 'CSAT %', 'Waktu Respon Chat Pertama Kali',
      'Tingkat Konversi (Jumlah Chat yang Direspon)', 'Total Pembeli', 'Total Pesanan', 'Produk', 'Penjualan (IDR)',
      'Tingkat Konversi (Chat Dibalas)',
    ];
    expect(validasiKolomWajib(header, kolomDipanenModul('shopee_chat'))).toEqual([]);
  });

  it('shopee_chat_broadcast — Chat_Broadcast_overview_*.xlsx (sheet pertama)', () => {
    const header = [
      'Periode Data', 'Total Penerima', 'Penerima yang Membaca', 'Penerima yang Mengklik',
      'Penerima yang Memblokir', 'Pesanan', 'Penjualan (IDR)', 'Total Pembeli', 'Persentase Chat Dibaca',
      'Persentase Chat Diklik', 'Tingkat Konversi (Chat Dibalas)',
    ];
    expect(validasiKolomWajib(header, kolomDipanenModul('shopee_chat_broadcast'))).toEqual([]);
  });

  it('meta_ads — sheet "Raw Data Report", Laporan-tanpa-judul-*.xlsx', () => {
    const header = [
      'Minggu', 'Nama kampanye', 'Nama iklan', 'Jumlah yang dibelanjakan (IDR)',
      'Nilai Konversi Pembelian Khusus untuk Item Bersama', 'ROAS pembelian khusus untuk item bersama',
      'Pembelian dengan item bersama', 'Frekuensi', 'Impresi', 'Klik tautan',
      'CTR Unik (rasio klik tayang tautan)', 'Tampilan konten dengan item bersama',
      'CPM (Biaya Per 1.000 Tayangan)', 'CPC (biaya per klik tautan)',
      'Penambahan ke Keranjang Belanja dengan Item Bersama',
      'Nilai Konversi Penambahan ke Keranjang Belanja Khusus untuk Item Bersama',
      'Awal pelaporan', 'Akhir pelaporan',
    ];
    expect(validasiKolomWajib(header, kolomDipanenModul('meta_ads'))).toEqual([]);
  });
});

describe('turunkanParseStatus (Rule 10)', () => {
  it('ok bila dekode sukses dan semua kolom wajib ada', () => {
    expect(turunkanParseStatus({ decodeGagal: null, kolomWajibGagal: [] })).toEqual({ status: 'ok', error: null });
  });

  it('gagal (dekode) — pesan dari kegagalan dekode, BUKAN "berkas tidak diunggah"', () => {
    const hasil = turunkanParseStatus({ decodeGagal: 'berkas rusak: bukan ZIP/xlsx/csv yang valid', kolomWajibGagal: [] });
    expect(hasil.status).toBe('gagal');
    expect(hasil.error).not.toContain('tidak diunggah');
    expect(hasil.error).toBe('berkas rusak: bukan ZIP/xlsx/csv yang valid');
  });

  it('gagal (kolom wajib hilang) — pesan menyebut nama kolom, BUKAN "berkas tidak diunggah"', () => {
    const hasil = turunkanParseStatus({
      decodeGagal: null,
      kolomWajibGagal: [{ kolom: 'ID Kreator', pesan: "[kolom wajib 'ID Kreator' tidak ditemukan di berkas]" }],
    });
    expect(hasil.status).toBe('gagal');
    expect(hasil.error).not.toContain('tidak diunggah');
    expect(hasil.error).toContain('ID Kreator');
  });

  it('dekode gagal menang atas kolom wajib gagal bila keduanya terjadi (dekode lebih dulu secara logis)', () => {
    const hasil = turunkanParseStatus({
      decodeGagal: 'gagal dekode',
      kolomWajibGagal: [{ kolom: 'X', pesan: 'pesan X' }],
    });
    expect(hasil.error).toBe('gagal dekode');
  });
});

describe('renormalisasiDimensi + totalSkorDimensi (Rule 12) — reproduksi bug "netral 5/10"', () => {
  /**
   * Skenario PERSIS yang Rule 12 sebut: enam dimensi Shopee (bobot
   * report/shopee/skor.ts: .22/.22/.18/.14/.12/.12), lima di antaranya
   * bernilai 9 (toko performa bagus), SATU (ROAS & Channel, bobot 22%)
   * TIDAK ADA berkas iklannya. Mesin LAMA (`report/shopee/skor.ts` scoreRoas)
   * memberi neutral 5 dan MENARIK total dari 9 ke ((9*0,78)+(5*0,22)) = 8,12
   * — persis pola yang PRD sebut "kelengkapan berkas menurunkan skor". Mesin
   * BARU (fungsi ini) mengeluarkan dimensi itu dari pembobotan sepenuhnya —
   * total TETAP 9, tidak ditarik oleh ketiadaan berkas.
   */
  const enamDimensi: readonly PdtDimensiSkor[] = [
    { kode: 'roas_channel', label: 'ROAS & Channel', bobotDasar: 0.22, nilai: null }, // berkas iklan tidak ada
    { kode: 'traffic_quality', label: 'Traffic Quality', bobotDasar: 0.22, nilai: 9 },
    { kode: 'conversion_retention', label: 'Conversion & Retention', bobotDasar: 0.18, nilai: 9 },
    { kode: 'product_performance', label: 'Product Performance', bobotDasar: 0.14, nilai: 9 },
    { kode: 'live_streaming', label: 'Live Streaming', bobotDasar: 0.12, nilai: 9 },
    { kode: 'kesehatan_toko', label: 'Kesehatan Toko', bobotDasar: 0.12, nilai: 9 },
  ];

  it('dimensi null DIKELUARKAN — disertakan=false, bobotEfektif=0, label "data tidak tersedia"', () => {
    const hasil = renormalisasiDimensi(enamDimensi);
    const roas = hasil.find((d) => d.kode === 'roas_channel')!;
    expect(roas.disertakan).toBe(false);
    expect(roas.bobotEfektif).toBe(0);
    expect(roas.labelTampil).toBe(LABEL_DIMENSI_TIDAK_TERSEDIA);
    expect(roas.nilai).toBeNull(); // BUKAN 5 — tidak pernah diisi neutral
  });

  it('bobot dimensi yang TERSEDIA dinormalisasi ulang supaya Σ = 1', () => {
    const hasil = renormalisasiDimensi(enamDimensi);
    const sisaBobot = hasil.filter((d) => d.disertakan).reduce((s, d) => s + d.bobotEfektif, 0);
    expect(Math.round(sisaBobot * 1000) / 1000).toBe(1);
  });

  it('total skor TETAP 9 — dimensi absen TIDAK menurunkan skor (DoD G1-08)', () => {
    const hasil = renormalisasiDimensi(enamDimensi);
    expect(totalSkorDimensi(hasil)).toBe(9);
  });

  it('pembanding: seluruh dimensi bernilai 9 (nol absen) ⇒ total tetap 9 (baseline sanity)', () => {
    const semuaAda = enamDimensi.map((d) => (d.kode === 'roas_channel' ? { ...d, nilai: 9 } : d));
    expect(totalSkorDimensi(renormalisasiDimensi(semuaAda))).toBe(9);
  });

  it('seluruh dimensi absen ⇒ total null (aturan rumah #7 — bukan 0)', () => {
    const semuaAbsen = enamDimensi.map((d) => ({ ...d, nilai: null }));
    expect(totalSkorDimensi(renormalisasiDimensi(semuaAbsen))).toBeNull();
  });

  it('dua dimensi absen dengan bobot BERBEDA tetap menormalisasi proporsional', () => {
    const dimensi: readonly PdtDimensiSkor[] = [
      { kode: 'a', label: 'A', bobotDasar: 0.5, nilai: 10 },
      { kode: 'b', label: 'B', bobotDasar: 0.3, nilai: null },
      { kode: 'c', label: 'C', bobotDasar: 0.2, nilai: 4 },
    ];
    // Tersisa: a(0.5) + c(0.2) = 0.7 → a efektif 5/7, c efektif 2/7
    // total = 10*(5/7) + 4*(2/7) = 50/7 + 8/7 = 58/7 = 8.2857...
    const hasil = renormalisasiDimensi(dimensi);
    expect(totalSkorDimensi(hasil)).toBe(8.29);
  });
});
