/**
 * PDT (Pusat Data Toko) — registry modul parser, G1-02.
 *
 * Cermin `pdt_parser_modul` (migrasi
 * `supabase/migrations/20261012010000_g1_02_seed_pdt_parser_modul.sql`) —
 * pola yang sama dengan `../adsscanner/tiktok/bench.ts` mencerminkan
 * `adsscanner_benchmark`: satu sumber TS yang dites, migrasi menyalin
 * nilainya literal. Menyatukan EMPAT registry lama:
 *  - `../baseline/detect.ts` (12 tipe Seller Center TikTok)
 *  - `../report/detect.ts` (4 tipe TikTok Ads Manager — TIDAK dipakai di sini;
 *    PDT §7 tidak mendaftarkan modul Ads Manager terpisah, lihat catatan di
 *    bawah)
 *  - `../report/shopee/detect.ts` (17 tanda tangan Shopee)
 *  - `../adsscanner/tiktok/detect.ts` (4 tanda tangan Ads Scanner)
 * plus tiga modul baru yang PRD §7 sebut belum py registry (`shopee_video`
 * header 2 lapis, `shopee_chat_broadcast`, `meta_ads`).
 *
 * Sumber kolom per modul, per prioritas (dicatat per baris di bawah):
 *  1. `docs/backlog/PDT_KOLOM_DIPANEN.md` — whitelist `kolom_dipanen` MENGIKAT
 *     (menang atas literal §7 PRD bila berbeda, sesuai preambulnya sendiri).
 *  2. `docs/prd/CDPS_PDT_Pusat_Data_Toko.md` §7 — nama modul, berkas sample,
 *     baris header (Rule 7), dan literal Title-Case yang PDT_KOLOM_DIPANEN
 *     tidak sebutkan.
 *  3. Registry lama (`detect.ts` yang disebut di atas) dan fixture teruji di
 *     `report/shopee/shopee.test.ts` — dipakai HANYA untuk `tandaTanganKolom`
 *     (deteksi), tidak pernah untuk mengarang `kolomDipanen` (whitelist
 *     panen) yang tidak disebut PDT_KOLOM_DIPANEN/PRD.
 *
 * ⛔ JANGAN ubah string nama kolom pada `tandaTanganKolom` — itu (bersama
 * pemindaian isi, bukan nama berkas — Rule 6) satu-satunya cara berkas
 * dikenali.
 *
 * Modul dengan sinyal isi BELUM terverifikasi (dicatat `docs/DECISIONS.md`
 * 2026-09-13 G1-02, bukan ditebak):
 *  - `shopee_diskon` / `shopee_flash_sale` — UAT Fim Motor (SHP-3) membuktikan
 *    pasangan ini hanya terselesaikan lewat NAMA BERKAS MENTAH
 *    (`discount_`/`flash_sale`), yang Rule 6 PDT larang. Tak ada kolom
 *    pembeda yang terverifikasi di sample atau di kode manapun di repo ini.
 *  - `shopee_video` — PDT_KOLOM_DIPANEN §2.7 dan PRD §7.2 sama-sama menulis
 *    "11 dari 54 kolom" secara ABSTRAK; tak satu pun dari 54 nama kolom
 *    tertulis literal di dokumen atau kode manapun di repo ini (fixture
 *    `bisnisVideoAoa` di `report/shopee/shopee.test.ts` memodelkan berkas
 *    LAIN — ekspor "[bisnis]-Video" konvensi tim yang lebih sederhana, bukan
 *    `video-overview-v3` mentah 54-kolom 2-lapis header).
 * Keduanya memakai `UNVERIFIED_SIGNATURE` — lihat `types.ts`. Baris seed-nya
 * tetap ada (DoD G1-02: "setiap modul di PRD §7 punya baris"), tapi
 * deteksinya sengaja TIDAK PERNAH menang secara otomatis — AM memilih modul
 * lewat dropdown (Rule G1-09) sampai sample asli membuka pembedanya.
 */
import type { PdtKolomAliasDef, PdtModuleDef, PdtSignature } from './types';

/**
 * Sentinel: sebuah `must` yang mustahil cocok ke isi berkas nyata mana pun.
 * Dipakai HANYA untuk dua modul di atas — lihat komentar file.
 */
export const UNVERIFIED_SIGNATURE: PdtSignature = {
  must: ['__pdt_g1_02_belum_ada_sinyal_isi_terverifikasi__'],
};

export const PDT_MODULES: readonly PdtModuleDef[] = [
  // ===========================================================================
  // TikTok (PRD §7.1 / PDT_KOLOM_DIPANEN §1) — 9 modul
  // ===========================================================================
  {
    kode: 'tt_orders',
    platform: 'tiktok',
    namaTampilan: 'TikTok — Semua Pesanan',
    // PDT_KOLOM_DIPANEN §1.1 — tak ada registry lama untuk berkas ini (P-01
    // rekonsiliasi belum dipindah dari alat lama); kombinasi 4 kolom identitas
    // pesanan yang tak dipakai modul TikTok lain mana pun.
    tandaTanganKolom: { must: ['Order ID', 'SKU ID', 'Order Status', 'Paid Time'] },
    barisHeaderHint: 1,
    kolomDipanen: [
      'Order ID', 'SKU ID', 'Seller SKU', 'Product Name', 'Variation', 'Quantity',
      'SKU Unit Original Price', 'SKU Subtotal After Discount', 'Order Status', 'Paid Time',
      'Product Category', 'Creator Handle',
    ],
    wajib: true,
  },
  {
    kode: 'tt_product_analytics',
    platform: 'tiktok',
    namaTampilan: 'TikTok — Analitik Produk',
    // Sama persis `baseline/detect.ts` TYPES.prod_tt.
    tandaTanganKolom: { must: ['ID Produk', 'GMV dari kreator', 'Klik produk'] },
    barisHeaderHint: 4, // Rule 7: "product_list baris 4"
    kolomDipanen: [
      'ID Produk', 'GMV', 'GMV dari kreator', 'GMV dari video penjual', 'GMV dari LIVE penjual',
      'Pesanan SKU', 'AOV', 'CTR', 'CTOR', 'Impresi produk', 'Status daftar produk',
      'Nama', 'Klik produk',
    ],
    wajib: true,
  },
  {
    kode: 'tt_transaction_product',
    platform: 'tiktok',
    namaTampilan: 'TikTok — Transaction Analysis (Produk)',
    // Tak ada registry lama; kombinasi baru dari PDT_KOLOM_DIPANEN §1.3 —
    // 'Sampel terkirim' tidak muncul di modul TikTok lain mana pun.
    tandaTanganKolom: { must: ['Product ID', 'Product category', 'Sampel terkirim'] },
    barisHeaderHint: 1,
    kolomDipanen: ['Product ID', 'Product category', 'GMV dari kreator', 'CTOR', 'Video', 'Siaran LIVE', 'Sampel terkirim'],
    wajib: true,
  },
  {
    kode: 'tt_transaction_creator',
    platform: 'tiktok',
    namaTampilan: 'TikTok — Transaction Analysis (Kreator)',
    // Sama persis `baseline/detect.ts` TYPES.aff_kr.
    tandaTanganKolom: { must: ['Creator name', 'GMV dari kreator'] },
    barisHeaderHint: 1,
    kolomDipanen: [
      'Creator name', 'GMV dari kreator', 'AOV', 'CTOR', 'Pesanan teratribusi', 'Tayangan video',
      'Video', 'Siaran LIVE', 'Perkiraan komisi',
    ],
    wajib: true,
  },
  {
    kode: 'tt_video',
    platform: 'tiktok',
    namaTampilan: 'TikTok — Video Performance List',
    // Sama persis `baseline/detect.ts` TYPES.vid_toko/vid_aff (toko vs afiliasi
    // diputuskan di lapisan lain — `client_platforms.akun_konten_toko` — bukan di sini).
    tandaTanganKolom: { must: ['Informasi Video', 'GPM (Rp)'] },
    barisHeaderHint: 3, // Rule 7
    kolomDipanen: [
      'ID Kreator', 'ID Video', 'Waktu', 'Produk', 'VV', 'Likes', 'Dibagikan', 'Klik Produk', 'Nama Kreator',
      'Informasi Video', 'GPM (Rp)', 'GMV dari video (Rp)',
    ],
    wajib: true,
  },
  {
    kode: 'tt_live',
    platform: 'tiktok',
    namaTampilan: 'TikTok — Live Analysis',
    // Sama persis `baseline/detect.ts` TYPES.live_toko/live_aff.
    tandaTanganKolom: { must: ['GMV dari LIVE (Rp)', 'Waktu Live'] },
    barisHeaderHint: 3, // Rule 7
    kolomDipanen: ['ID Kreator', 'Waktu Live', 'Durasi', 'GMV dari LIVE (Rp)', 'Produk Terjual', 'Penonton', 'CTOR', 'Kreator'],
    wajib: true,
  },
  {
    kode: 'tt_shop_analytics',
    platform: 'tiktok',
    namaTampilan: 'TikTok — Shop Analytics (Key Metrics)',
    // Diturunkan dari `baseline/detect.ts` TYPES.shop_tt, DIPERSEMPIT dengan
    // sengaja: sig aslinya `mustNot: ['ID Produk', 'ID']` — negasi kedua
    // ('ID' polos) ada untuk menolak file Tokopedia (`shop_tp`/`prod_tp`),
    // yang tidak pernah masuk daftar modul PDT (Tokopedia bukan platform PDT).
    // Di bawah pencocok tanda-tangan-di-mana-pun-dalam-sheet (`detect.ts`),
    // needle pendek 'ID' akan cocok ke substring "id" di dalam kata biasa
    // (mis. "video") dan menolak modul ini sendiri secara keliru — jadi hanya
    // separuh negasi yang relevan untuk TikTok yang diikutkan. Dicatat
    // `docs/DECISIONS.md` 2026-09-13 G1-02.
    tandaTanganKolom: { must: ['GMV', 'GMV dari LIVE kreator', 'Pengunjung'], mustNot: ['ID Produk'] },
    barisHeaderHint: 1,
    kolomDipanen: [
      'GMV', 'Pesanan', 'Pembeli', 'Pesanan SKU', 'Pengunjung', 'Persentase konversi', 'Pendapatan bruto',
      'Pengembalian dana', 'GMV dari LIVE kreator', 'GMV dari LIVE akun tertaut', 'GMV dari video afiliasi',
      'GMV dari video akun tertaut',
    ],
    wajib: true,
  },
  {
    kode: 'tt_ads_product',
    platform: 'tiktok',
    namaTampilan: 'TikTok Ads Manager — Product Campaigns',
    // Sama persis `adsscanner/tiktok/detect.ts` FILE_SIGS.ads.
    tandaTanganKolom: { must: ['Nama kampanye', 'ID produk', 'Biaya'] },
    barisHeaderHint: 1, // adsscanner headerRow 0 (0-based) => baris 1
    kolomDipanen: ['ID Campaign', 'ID produk', 'ID video', 'Akun TikTok', 'Biaya', 'Pesanan SKU', 'Biaya per pesanan', 'Pendapatan kotor'],
    wajib: false, // opsional — sisi ads, bukan sisi rekonsiliasi GMV toko
  },
  {
    kode: 'tt_ads_live',
    platform: 'tiktok',
    namaTampilan: 'TikTok Ads Manager — Live Campaigns',
    // Sama persis `adsscanner/tiktok/detect.ts` FILE_SIGS.adslive.
    tandaTanganKolom: { must: ['Nama LIVE', 'Nama kampanye', 'Biaya'] },
    barisHeaderHint: 1, // adsscanner headerRow 0
    kolomDipanen: ['Nama LIVE', 'ID Campaign', 'Biaya', 'Pesanan SKU', 'ROI', 'Pendapatan kotor'],
    wajib: false,
  },

  // ===========================================================================
  // Shopee (PRD §7.2 / PDT_KOLOM_DIPANEN §2) — 15 modul
  // ===========================================================================
  {
    kode: 'shopee_shop_stats',
    platform: 'shopee',
    namaTampilan: 'Shopee — Bisnis Saya (Home, 12 sheet)',
    // Sama persis `report/shopee/detect.ts` CONTENT_SIGNATURES.bisnis_home.
    // Baris penanda seksi ('Pesanan Dibuat') + header sebenarnya cocok lewat
    // pemindaian-semua-baris (Rule 7), bukan indeks tetap.
    tandaTanganKolom: { must: ['Pesanan Dibuat', 'Total Pengunjung'] },
    barisHeaderHint: 2, // baris 1 = penanda seksi, baris 2 = header metrik (report/shopee/shopee.test.ts bisnisHomeAoa)
    // 14-15 metrik per basis (PDT_KOLOM_DIPANEN §2.1: "3 basis × 14 metrik" —
    // literal di bawah diverifikasi lewat report/shopee/metrik.ts + shopee.test.ts
    // HOME_HEADER, dites terhadap angka Fim Motor UAT persis). "Asal kunjungan"/
    // "asal penjualan" (dua sheet lain di workbook 12-sheet) TIDAK dimasukkan —
    // nama kolom literalnya belum terverifikasi di dokumen/kode manapun di repo
    // ini; dicatat sebagai gap terbuka di docs/DECISIONS.md, bukan ditebak.
    kolomDipanen: [
      'Total Penjualan (IDR)', 'Total Pesanan', 'Penjualan per Pesanan', 'Produk Diklik', 'Total Pengunjung',
      'Tingkat Konversi Pesanan', 'Pesanan Dibatalkan', 'Penjualan Dibatalkan', 'Pesanan Dikembalikan',
      'Penjualan Dikembalikan', 'Pembeli', 'Total Pembeli Baru', 'Total Pembeli Saat Ini',
      'Total Potensi Pembeli', 'Tingkat Pembelian Berulang',
    ],
    wajib: true,
  },
  {
    kode: 'shopee_parent_sku',
    platform: 'shopee',
    namaTampilan: 'Shopee — Parent SKU Detail',
    tandaTanganKolom: { must: ['Kode Produk', 'Kode Variasi', 'SKU Induk'] },
    barisHeaderHint: 1,
    kolomDipanen: [
      'Kode Produk', 'Kode Variasi', 'SKU Induk',
      'Total Penjualan (Pesanan Dibuat) (IDR)', 'Penjualan (Pesanan Siap Dikirim) (IDR)',
      'Jumlah Produk Dilihat', 'Produk Diklik', 'Tingkat Konversi (Pesanan yang Dibuat)',
      'repeat order', 'Pengunjung Produk (Kunjungan)',
    ],
    wajib: true,
  },
  {
    kode: 'shopee_ads_cpc',
    platform: 'shopee',
    namaTampilan: 'Shopee Ads — Iklan Keseluruhan (CPC)',
    tandaTanganKolom: { must: ['Kode Produk', 'Dilihat', 'Biaya'] },
    barisHeaderHint: 8, // PRD §7.2 + PDT_KOLOM_DIPANEN §2.3: "header baris 8"; DIKONFIRMASI baris 8 persis lewat sample asli Fim Motor sesi 19.
    // `ID Toko`/`Periode` DIHAPUS dari daftar ini sesi 19 (docs/DECISIONS.md
    // 2026-09-14 modul KEENAM) — keduanya PREAMBLE (baris 1-6, divalidasi
    // `ekstrakPreambleShopee`/Rule 2), BUKAN kolom baris header. Menaruhnya di
    // sini membuat `validasiKolomWajib` (yang memeriksa SELURUH kolomDipanen
    // terhadap SATU baris header saja) SELALU gagal untuk berkas ASLI apa pun
    // — bug laten sejak G1-02, tidak pernah tertangkap karena fixture tes
    // sebelum sesi ini menaruh 'ID Toko'/'Periode' sebagai SEL header buatan
    // (tidak merefleksikan bentuk berkas asli). `shopee_ads_live`/
    // `shopee_ads_search` tidak pernah membuat kesalahan yang sama — preseden
    // yang benar, bukan modul ini. Kolom ACOS DIKOREKSI ke ejaan PERSIS sample
    // asli (`Persentase Biaya Iklan terhadap Penjualan dari Iklan (ACOS)`) —
    // ejaan lama (`Biaya Iklan Terhadap Omzet (ACOS) (%)`) adalah TEBAKAN
    // (PDT_KOLOM_DIPANEN.md §2.3 sendiri menulis "mis." di depannya) yang
    // TIDAK PERNAH cocok dengan berkas nyata mana pun.
    kolomDipanen: [
      'Kode Produk', 'Dilihat', 'Jumlah Klik', 'Konversi', 'Biaya',
      'nama iklan', 'omzet penjualan', 'Efektifitas Iklan', 'Persentase Biaya Iklan terhadap Penjualan dari Iklan (ACOS)',
    ],
    wajib: false,
  },
  {
    kode: 'shopee_ads_search',
    platform: 'shopee',
    namaTampilan: 'Shopee Ads — Search Ads',
    // 'Kata Pencarian' terverifikasi (PRD §7.2, Title Case) — meski isinya
    // (bucket 3) DITAHAN dari kolomDipanen (PDT_KOLOM_DIPANEN §2.4, ketokan
    // Q-6 menunggu Anty), kolomnya sendiri boleh dipakai untuk DETEKSI.
    tandaTanganKolom: { must: ['Kata Pencarian'] },
    barisHeaderHint: 8, // PRD §7.2: "header baris 8"
    // PDT_KOLOM_DIPANEN §2.4 menulis "klik, konversi" huruf kecil (gaya
    // parafrase, bukan kutipan literal) — casing pastinya BELUM terverifikasi
    // ke sample asli. Disimpan apa adanya (huruf kecil) supaya ketidakpastian
    // ini tidak tersembunyi di balik Title Case yang menyesatkan; G1-05 wajib
    // verifikasi ulang sebelum panen sungguhan.
    kolomDipanen: ['klik', 'konversi'],
    wajib: false,
  },
  {
    kode: 'shopee_ads_live',
    platform: 'shopee',
    namaTampilan: 'Shopee Ads — Live',
    // Sama persis `report/shopee/detect.ts` CONTENT_SIGNATURES.ads_live.
    tandaTanganKolom: { must: ['Nama Iklan', 'Penonton'] },
    barisHeaderHint: 7, // PRD §7.2 + PDT_KOLOM_DIPANEN §2.5: "header baris 7"
    kolomDipanen: ['ID Iklan', 'Penonton', 'Pesanan', 'Omzet', 'Biaya', 'Efektifitas Iklan'],
    wajib: false,
  },
  {
    kode: 'shopee_live',
    platform: 'shopee',
    namaTampilan: 'Shopee — Live Streaming',
    tandaTanganKolom: { must: ['Informasi Streaming', 'Waktu Mulai'] },
    barisHeaderHint: 1,
    kolomDipanen: ['Informasi Streaming', 'Waktu Mulai', 'Pengunjung', 'Penjualan'],
    wajib: true, // menutup dimensi Live Shopee yang hari ini struktural maks 5/10 (PRD §7.2)
  },
  {
    kode: 'shopee_video',
    platform: 'shopee',
    namaTampilan: 'Shopee — Video Overview',
    // BELUM TERVERIFIKASI — lihat catatan panjang di kepala berkas ini dan
    // docs/DECISIONS.md 2026-09-13 G1-02. Baris tetap di-seed (DoD), deteksi
    // sengaja tidak pernah menang sampai sample asli tersedia.
    tandaTanganKolom: UNVERIFIED_SIGNATURE,
    barisHeaderHint: 1, // header 2 lapis (Rule 7) — readSheet sudah menangani kolom duplikat lewat sufiks nama#j
    kolomDipanen: [],
    wajib: true, // menutup dimensi Video Shopee (PRD §7.2) — belum bisa dipanen otomatis sampai gap ini tertutup
  },
  {
    kode: 'shopee_voucher',
    platform: 'shopee',
    namaTampilan: 'Shopee — Voucher Toko',
    // Sama persis cabang OR kedua `report/shopee/detect.ts`
    // CONTENT_SIGNATURES.promo_voucher (cabang 'nama voucher' tidak dipakai di
    // sini karena PDT_KOLOM_DIPANEN §2.8 tidak menyebut kolom itu literal).
    tandaTanganKolom: { must: ['Periode Waktu', 'Klaim'] },
    barisHeaderHint: 1,
    kolomDipanen: [
      'Periode Waktu', 'Klaim', 'Pesanan (Pesanan Dibuat)', 'Penjualan (Pesanan Dibuat) (IDR)',
      'Tingkat Penggunaan (Pesanan Dibuat)', 'Pembeli (Pesanan Dibuat)', 'Total Biaya (Pesanan Dibuat) (IDR)',
    ],
    wajib: false,
  },
  {
    kode: 'shopee_diskon',
    platform: 'shopee',
    namaTampilan: 'Shopee — Diskon Toko',
    // BELUM TERVERIFIKASI — UAT Fim Motor (SHP-3, docs/handoff/UAT_SHOPEE_FIM_MOTOR_20260903.md
    // §7.1) menyelesaikan pasangan diskon/flash-sale lewat NAMA BERKAS MENTAH
    // ('discount_'/'flash_sale'), yang Rule 6 PDT larang. PDT_KOLOM_DIPANEN §2.8
    // menyamakan strukturnya dengan shopee_voucher ("penjualan 2 basis, klaim,
    // tingkat penggunaan, biaya promo") TANPA kolom pembeda ('Nama Voucher'
    // adalah satu-satunya jangkar unik voucher, dan modul ini tidak punya
    // padanannya). Dicatat docs/DECISIONS.md 2026-09-13 sebagai pertanyaan
    // terbuka, bukan ditebak.
    tandaTanganKolom: UNVERIFIED_SIGNATURE,
    barisHeaderHint: 1,
    kolomDipanen: [],
    wajib: false,
  },
  {
    kode: 'shopee_flash_sale',
    platform: 'shopee',
    namaTampilan: 'Shopee — Flash Sale Toko',
    // BELUM TERVERIFIKASI — lihat catatan `shopee_diskon` di atas (pasangan
    // yang sama, gap yang sama).
    tandaTanganKolom: UNVERIFIED_SIGNATURE,
    barisHeaderHint: 1,
    kolomDipanen: [],
    wajib: false,
  },
  {
    kode: 'shopee_chat',
    platform: 'shopee',
    namaTampilan: 'Shopee — Performa Chat',
    // Sama persis `report/shopee/detect.ts` CONTENT_SIGNATURES.layanan_chat
    // (tiga cabang OR — 'grafik kriteria' sendirian, atau 'periode waktu'+CSAT,
    // atau 'periode waktu'+'jumlah chat').
    tandaTanganKolom: {
      anyOf: [
        { must: ['Grafik Kriteria'] },
        { must: ['Periode Waktu', 'CSAT'] },
        { must: ['Periode Waktu', 'Jumlah Chat'] },
      ],
    },
    barisHeaderHint: 1,
    kolomDipanen: [
      'Periode Waktu', 'Pengunjung', 'Jumlah Chat', 'Chat Dibalas', 'Waktu Respon Rata-rata', 'CSAT %',
      'Persentase Chat Dibalas', 'Total Pesanan', 'Penjualan (IDR)', 'Tingkat Konversi (Chat Dibalas)',
    ],
    wajib: false,
  },
  {
    kode: 'shopee_chat_broadcast',
    platform: 'shopee',
    namaTampilan: 'Shopee — Chat Broadcast',
    // PRD §7.3 (baris shopee_chat_broadcast §7.2 sebenarnya) menulis
    // "penerima, dibaca, diklik, pesanan" huruf kecil — parafrase, bukan
    // kutipan literal (pola sama dengan shopee_ads_search di atas). Casing
    // Title Case di bawah adalah TEBAKAN KONVENSI (nama Shopee lain memakai
    // Title Case), BUKAN dikutip dari sample — ditandai di `kolomDipanen`
    // dengan casing yang sama seperti prosa PRD untuk kejujuran, dan sinyal
    // deteksi memakai gabungan yang paling mustahil bentrok dengan modul lain.
    tandaTanganKolom: { must: ['penerima', 'dibaca', 'diklik'] },
    barisHeaderHint: 1,
    kolomDipanen: ['penerima', 'dibaca', 'diklik', 'pesanan'],
    wajib: false,
  },
  {
    kode: 'shopee_ams_produk',
    platform: 'shopee',
    namaTampilan: 'Shopee AMS — Performa Produk (Afiliasi)',
    // Dikoreksi sesi 20 (docs/DECISIONS.md 2026-09-14) terhadap sample EKSPOR ASLI
    // (Fim Motor, `ProductPerformance_*.csv`) — ejaan lama ('Nama Produk'/'Omzet'/
    // 'Komisi') TIDAK PERNAH cocok berkas nyata: header sungguhan ber-'Nama Item'
    // (bukan 'Nama Produk' — deteksi lama gagal total, bukan cuma kolomDipanen).
    // 'Kode Item' (satu-satunya identitas modul ini yang tidak dimiliki
    // `shopee_ams_afiliasi`) dipakai sebagai penanda `must`, `mustNot 'ID
    // Affiliates'` menjaga dua modul tetap terpisah (bukan cermin
    // `report/shopee/detect.ts` lagi — signature lama itu sendiri tidak pernah
    // diverifikasi ke sample asli).
    tandaTanganKolom: { must: ['Kode Item', 'Omzet'], mustNot: ['ID Affiliates'] },
    barisHeaderHint: 1,
    kolomDipanen: ['Kode Item', 'Nama Item', 'Omzet Penjualan(Rp)', 'Produk Terjual', 'Pesanan', 'Estimasi Komisi(Rp)', 'ROI'],
    wajib: false,
  },
  {
    kode: 'shopee_ams_afiliasi',
    platform: 'shopee',
    namaTampilan: 'Shopee AMS — Performa Afiliasi (Kreator)',
    // Tanda tangan (substring, `detect.ts` `containsSomewhere`) TIDAK berubah —
    // 'Omzet'/'Username' tetap cocok sebagai SUBSTRING dari 'Omzet Penjualan(Rp)'/
    // 'Username Affiliate' sungguhan, jadi deteksi modul ini SUDAH benar sejak
    // awal. `kolomDipanen` DIKOREKSI sesi 20 (docs/DECISIONS.md 2026-09-14) —
    // `validasiKolomWajib` (exact PER SEL, beda dari deteksi) memakai ejaan lama
    // ('Username'/'Omzet'/'Komisi') yang TIDAK PERNAH cocok berkas nyata
    // (`AMSAffiliatePerformance_*.csv`: 'Username Affiliate'/'Omzet
    // Penjualan(Rp)'/'Estimasi Komisi(Rp)') — bug laten sejak G1-02, modul ini
    // SELALU `parse_status='gagal'` untuk berkas asli walau modul KELIMA (sesi
    // 17) sudah menulis `pdt_fact_creator_period` dari sini; fixture tes lama
    // memalsukan header persis kelas yang sama dengan `shopee_ads_cpc`.
    tandaTanganKolom: { must: ['Omzet'], anyOf: [{ must: ['Username'] }, { must: ['Kreator'] }, { must: ['Creator'] }] },
    barisHeaderHint: 1,
    kolomDipanen: ['ID Affiliates', 'Username Affiliate', 'Omzet Penjualan(Rp)', 'Produk Terjual', 'Pesanan', 'Estimasi Komisi(Rp)', 'ROI'],
    wajib: false,
  },
  {
    kode: 'shopee_kesehatan',
    platform: 'shopee',
    namaTampilan: 'Shopee — Kesehatan Toko',
    // Sama persis `report/shopee/detect.ts` CONTENT_SIGNATURES.bisnis_kesehatan
    // ('Poin Pinalti' varian salah eja yang memang muncul di export nyata).
    tandaTanganKolom: { anyOf: [{ must: ['Poin Pinalti'] }, { must: ['Poin Penalti'] }] },
    barisHeaderHint: 1, // seluruh sheet hanya 3 kolom (PRD §7.2)
    kolomDipanen: ['Poin Penalti', 'Deskripsi', 'Durasi'],
    wajib: true, // modul baru sesi 2 — tidak ada di PRD v1.1, dimensi Kesehatan Toko 0,12
  },

  // ===========================================================================
  // Lintas platform (PRD §7.3) — 1 modul
  // ===========================================================================
  {
    kode: 'meta_ads',
    platform: 'meta',
    namaTampilan: 'Meta Ads — Laporan Kampanye',
    // Sama persis `report/shopee/detect.ts` CONTENT_SIGNATURES.meta.
    tandaTanganKolom: { must: ['Minggu', 'Dibelanjakan'] },
    barisHeaderHint: 1,
    kolomDipanen: [
      'Nama kampanye', 'Nama iklan', 'Jumlah yang dibelanjakan', 'Nilai Konversi Pembelian', 'ROAS',
      'Impresi', 'Klik tautan', 'CTR', 'CPM', 'CPC', 'Minggu',
    ],
    wajib: false, // opsional (PDT-22) — tidak masuk rekonsiliasi GMV toko
  },
];

/**
 * Alias nama kolom → kolom kanonik (`pdt_kolom_alias`, Rule 9, append-only).
 * `versiPertama` selalu 1 di seed pertama ini.
 */
export const PDT_KOLOM_ALIAS: readonly PdtKolomAliasDef[] = [
  // PDT_KOLOM_DIPANEN.md §1.7 — tt_shop_analytics: dua ejaan lama untuk kolom
  // sesi-2 yang sama.
  { modulKode: 'tt_shop_analytics', kolomKanonik: 'GMV dari LIVE akun tertaut', alias: 'GMV LIVE penjual' },
  { modulKode: 'tt_shop_analytics', kolomKanonik: 'GMV dari LIVE akun tertaut', alias: 'GMV tidak langsung dari LIVE penjual' },
  // PDT_KOLOM_DIPANEN.md §1.6 — tt_live: 'Kreator' kadang muncul sebagai
  // 'Nama panggilan'.
  { modulKode: 'tt_live', kolomKanonik: 'Kreator', alias: 'Nama panggilan' },
  // PDT_KOLOM_DIPANEN.md §5 — alias SKU Screener (skuscreener/parse.ts:165-173)
  // → kolom kanonik shopee_parent_sku. 'Persentase Klik' SENGAJA tidak masuk
  // (§5 baris ketiga: ejaan kanoniknya di export 40-kolom belum terverifikasi
  // — sample asli tak ada di repo, sama dengan catatan A-3 handoff. Menulisnya
  // di sini akan mengarang alias yang belum ada dasarnya).
  { modulKode: 'shopee_parent_sku', kolomKanonik: 'Total Penjualan (Pesanan Dibuat) (IDR)', alias: 'Total Penjualan' },
  { modulKode: 'shopee_parent_sku', kolomKanonik: 'Tingkat Konversi (Pesanan yang Dibuat)', alias: 'Tingkat Konversi Pesanan' },
];
