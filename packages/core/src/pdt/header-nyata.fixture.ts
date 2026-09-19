/**
 * Korpus BARIS HEADER dari ekspor platform NYATA — 12 klien, periode Juli 2026.
 *
 * Sumber: tiga ZIP pemilik (sesi 43) — "Sample shopee 5 client" (Eighty eight,
 * Healthy, Nubutik, Pawlovin, Umar Media), "Sample tiktok 5 client" (Avitaskin,
 * Evebag, Juragan Acc, Octatrix, Sajira), dan "Sample nama asli" (Shopee - Fim
 * Motor, Tiktok - Avitaskin — dua klien yang nama BERKASNYA belum diganti tim).
 * Ini menjawab `PDT_BACKLOG.md` §7 butir 4 ("kumpulkan sample ≥2 klien lain per
 * platform supaya tanda tangan kolom tidak overfit ke 2 klien").
 *
 * **Isinya NAMA KOLOM saja — nol baris data.** Tidak ada GMV, nama produk, nama
 * kreator, ID toko, atau angka klien mana pun di berkas ini; `klien` hanya
 * mencatat set mana yang menghasilkan varian header itu, supaya kegagalan tes
 * bisa ditelusuri ke sample asalnya tanpa menyimpan datanya.
 *
 * **Kenapa ini ada.** Sebelum sesi 43, LIMA modul punya kolom wajib yang ejaannya
 * tidak pernah cocok ke berkas nyata mana pun (`tt_product_analytics` AOV/CTOR,
 * `shopee_parent_sku` 'repeat order', `shopee_ads_live` 'Omzet',
 * `shopee_kesehatan` 'Poin Penalti'/'Deskripsi', `meta_ads` 'CTR Unik …').
 * Dua yang pertama `wajib: true`, jadi berkasnya selalu `gagal` ⇒ keluar dari
 * `terparse` ⇒ pasangan rekonsiliasi Rule 13-14 tidak pernah lengkap ⇒ **nol batch
 * yang pernah bisa mencapai `verified`, di KEDUA platform.** Bug itu lolos
 * berkali-kali karena setiap fixture tes ditulis dari whitelist yang sama yang
 * sedang diuji. Korpus ini memutus lingkaran itu: fixture-nya berasal dari
 * BERKAS, bukan dari kode.
 *
 * Menambah sample baru: regenerasi, jangan ketik tangan. Varian header disimpan
 * TERPISAH (bukan digabung) ketika dua klien berbeda ejaannya — `meta_ads`
 * punya tiga entri justru karena 'CTR Unik (…)' dan 'CTR (…)' sama-sama nyata di
 * periode yang sama, dan itulah yang membuktikan kolom itu butuh ALIAS (Rule 9),
 * bukan kanonik yang diganti.
 */
export interface PdtHeaderNyata {
  /** Baris header PERSIS seperti di berkas (urutan dan ejaan asli, termasuk spasi ekor bila ada). */
  header: readonly string[];
  /** Set sample yang menghasilkan varian ini — untuk menelusuri kegagalan, bukan data. */
  klien: readonly string[];
}

/** Modul → varian baris header yang benar-benar ditemui di berkas nyata. */
export const HEADER_NYATA: Readonly<Record<string, readonly PdtHeaderNyata[]>> = {
  meta_ads: [
    {
      klien: ["Eighty eight", "Healthy"],
      header: [
        "Minggu", "Nama kampanye", "Nama iklan", "Jumlah yang dibelanjakan (IDR)",
        "Nilai Konversi Pembelian Khusus untuk Item Bersama", "ROAS pembelian khusus untuk item bersama",
        "Pembelian dengan item bersama", "Frekuensi", "Impresi", "Klik tautan",
        "CTR Unik (rasio klik tayang tautan)", "Tampilan konten dengan item bersama",
        "CPM (Biaya Per 1.000 Tayangan)", "CPC (biaya per klik tautan)",
        "Penambahan ke Keranjang Belanja dengan Item Bersama",
        "Nilai konversi penambahan ke keranjang di aplikasi khusus item bersama", "Awal pelaporan",
        "Akhir pelaporan",
      ],
    },
    {
      klien: ["Nubutik", "Pawlovin", "Umar Media"],
      header: [
        "Minggu", "Nama kampanye", "Nama iklan", "Jumlah yang dibelanjakan (IDR)",
        "Nilai Konversi Pembelian Khusus untuk Item Bersama", "ROAS pembelian khusus untuk item bersama",
        "Pembelian dengan item bersama", "Frekuensi", "Impresi", "Klik tautan", "CTR (rasio klik tayang tautan)",
        "Tampilan konten dengan item bersama", "CPM (Biaya Per 1.000 Tayangan)", "CPC (biaya per klik tautan)",
        "Penambahan ke Keranjang Belanja dengan Item Bersama",
        "Nilai Konversi Penambahan ke Keranjang Belanja Khusus untuk Item Bersama", "Awal pelaporan",
        "Akhir pelaporan",
      ],
    },
    {
      klien: ["Shopee - Fim Motor"],
      header: [
        "Minggu", "Nama kampanye", "Nama iklan", "Jumlah yang dibelanjakan (IDR)",
        "Nilai Konversi Pembelian Khusus untuk Item Bersama", "ROAS pembelian khusus untuk item bersama",
        "Pembelian dengan item bersama", "Frekuensi", "Impresi", "Klik tautan",
        "CTR Unik (rasio klik tayang tautan)", "Tampilan konten dengan item bersama",
        "CPM (Biaya Per 1.000 Tayangan)", "CPC (biaya per klik tautan)",
        "Penambahan ke Keranjang Belanja dengan Item Bersama",
        "Nilai Konversi Penambahan ke Keranjang Belanja Khusus untuk Item Bersama", "Awal pelaporan",
        "Akhir pelaporan",
      ],
    },
  ],
  shopee_ads_cpc: [
    {
      klien: ["Eighty eight", "Healthy", "Nubutik", "Pawlovin", "Shopee - Fim Motor", "Umar Media"],
      header: [
        "Urutan", "Nama Iklan", "Status", "Jenis Iklan", "Kode Produk", "Tampilan Iklan", "Mode Bidding",
        "Penempatan Iklan", "Tanggal Mulai", "Tanggal Selesai", "Dilihat", "Jumlah Klik", "Persentase Klik",
        "Add to Cart", "Add to Cart Rate", "Konversi", "Konversi Langsung", "Tingkat konversi",
        "Tingkat Konversi Langsung", "Biaya per Konversi", "Biaya per Konversi Langsung", "Produk Terjual",
        "Terjual Langsung", "Omzet Penjualan", "Penjualan Langsung (GMV Langsung)", "Biaya", "Efektifitas Iklan",
        "Efektivitas Langsung", "Persentase Biaya Iklan terhadap Penjualan dari Iklan (ACOS)",
        "Persentase Biaya Iklan terhadap Penjualan dari Iklan Langsung (ACOS Langsung)", "Jumlah Produk Dilihat",
        "Jumlah Klik Produk", "Persentase Klik Produk", "Voucher Amount", "Vouchered Sales",
      ],
    },
  ],
  shopee_ads_live: [
    {
      klien: ["Eighty eight", "Healthy", "Nubutik", "Pawlovin", "Shopee - Fim Motor", "Umar Media"],
      header: [
        "Urutan", "Nama Iklan", "ID Iklan", "Status", "Tujuan", "Tanggal Mulai", "Tanggal Selesai",
        "Waktu Mulai Harian", "Waktu Berakhir Harian", "Modal", "Penonton", "Pesanan", "Tingkat konversi",
        "Omzet Penjualan", "Biaya", "Efektifitas Iklan",
      ],
    },
  ],
  shopee_ads_search: [
    {
      klien: ["Eighty eight", "Healthy", "Nubutik", "Pawlovin", "Shopee - Fim Motor", "Umar Media"],
      header: [
        "Urutan", "Nama Iklan", "Status", "Tampilan Iklan", "Mode Bidding", "Kata Pencarian", "Tanggal Mulai",
        "Tanggal Selesai", "SOV", "Dilihat", "Jumlah Klik", "Persentase Klik", "Konversi", "Konversi Langsung",
        "Tingkat konversi", "Tingkat Konversi Langsung", "Biaya per Konversi", "Biaya per Konversi Langsung",
        "Produk Terjual", "Terjual Langsung", "Omzet Penjualan", "Penjualan Langsung (GMV Langsung)", "Biaya",
        "Efektifitas Iklan", "Efektivitas Langsung", "Persentase Biaya Iklan terhadap Penjualan dari Iklan (ACOS)",
        "Persentase Biaya Iklan terhadap Penjualan dari Iklan Langsung (ACOS Langsung)", "Jumlah Produk Dilihat",
        "Jumlah Klik Produk", "Persentase Klik Produk",
      ],
    },
  ],
  shopee_ams_afiliasi: [
    {
      klien: ["Eighty eight", "Healthy", "Nubutik", "Pawlovin", "Shopee - Fim Motor", "Umar Media"],
      header: [
        "ID Affiliates", "Nama Affiliate", "Username Affiliate", "Omzet Penjualan(Rp)", "Produk Terjual", "Pesanan",
        "Clicks", "Estimasi Komisi(Rp)", "ROI", "Total Pembeli", "Pembeli Baru",
      ],
    },
  ],
  shopee_ams_produk: [
    {
      klien: ["Eighty eight", "Healthy", "Nubutik", "Shopee - Fim Motor", "Umar Media"],
      header: [
        "Kode Item", "Nama Item", "Harga(Rp)", "Omzet Penjualan(Rp)", "Produk Terjual", "Pesanan", "Clicks",
        "Estimasi Komisi(Rp)", "ROI", "Total Pembeli", "Pembeli Baru",
      ],
    },
  ],
  shopee_chat: [
    {
      klien: ["Eighty eight", "Healthy", "Nubutik", "Pawlovin", "Shopee - Fim Motor", "Umar Media"],
      header: [
        "Periode Waktu", "Pengunjung", "Jumlah Chat", "Pengunjung Bertanya", "Pertanyaan Diajukan", "Chat Dibalas",
        "Chat Belum Dibalas", "Waktu Respon Rata-rata", "CSAT %", "Waktu Respon Chat Pertama Kali",
        "Tingkat Konversi (Jumlah Chat yang Direspon)", "Total Pembeli", "Total Pesanan", "Produk",
        "Penjualan (IDR)", "Tingkat Konversi (Chat Dibalas)",
      ],
    },
  ],
  shopee_chat_broadcast: [
    {
      klien: ["Eighty eight", "Healthy", "Nubutik", "Pawlovin", "Shopee - Fim Motor", "Umar Media"],
      header: [
        "Periode Data", "Total Penerima", "Penerima yang Membaca", "Penerima yang Mengklik",
        "Penerima yang Memblokir", "Pesanan", "Penjualan (IDR)", "Total Pembeli", "Persentase Chat Dibaca",
        "Persentase Chat Diklik", "Tingkat Konversi (Chat Dibalas)",
      ],
    },
  ],
  shopee_diskon: [
    {
      klien: ["Eighty eight", "Healthy", "Nubutik", "Pawlovin", "Shopee - Fim Motor", "Umar Media"],
      header: [
        "Tanggal", "Tipe Promosi", "Penjualan (Pesanan Dibuat) (IDR)", "Penjualan (Pesanan Siap Dikirim) (IDR)",
        "Pesanan (Pesanan Dibuat)", "Pesanan (Pesanan Siap Dikirim)", "Produk Terjual (Pesanan Dibuat)",
        "Produk Terjual (Pesanan Siap Dikirim)", "Pembeli (Pesanan Dibuat)", "Pembeli (Pesanan Siap Dikirim)",
        "Penjualan per Pembeli (Pesanan Dibuat) (IDR)", "Penjualan per Pembeli (Pesanan Siap Dikirim) (IDR)",
        "Jumlah Pesanan Paket Diskon (Pesanan Dibuat)", "Jumlah Pesanan Paket Diskon (Pesanan Siap Dikirim)",
        "Penjualan Produk Utama (Pesanan Dibuat) (IDR)", "Penjualan Produk Utama (Pesanan Siap Dikirim) (IDR)",
        "Penjualan Produk Tambahan (Pesanan Dibuat) (IDR)",
        "Penjualan Produk Tambahan (Pesanan Siap Dikirim) (IDR)", "Produk Utama Terjual (Pesanan Dibuat)",
        "Produk Utama Terjual (Pesanan Siap Dikirim)", "Produk Tambahan Terjual (Pesanan Dibuat)",
        "Produk Tambahan Terjual (Pesanan Siap Dikirim)",
        "Penjualan Produk Utama per Pembeli (Pesanan Dibuat) (IDR)",
        "Penjualan Produk Utama per Pembeli (Pesanan Siap Dikirim) (IDR)",
        "Penjualan Produk Tambahan (Pesanan Dibuat) (IDR)",
        "Penjualan Produk Tambahan (Pesanan Siap Dikirim) (IDR)",
      ],
    },
  ],
  shopee_flash_sale: [
    {
      klien: ["Eighty eight", "Healthy", "Nubutik", "Pawlovin", "Shopee - Fim Motor", "Umar Media"],
      header: [
        "Periode Waktu", "Penjualan (Pesanan Dibuat)(Rp)", "Penjualan (Pesanan Siap Dikirim)(Rp)",
        "Pesanan (Pesanan Dibuat)", "Pesanan (Pesanan Siap Dikirim)", "Pembeli (Pesanan Dibuat)",
        "Pembeli (Pesanan Siap Dikirim)", "Persentase Klik", "Jumlah Produk Dilihat", "Produk Diklik",
        "Penjualan per Pembeli (Pesanan Dibuat)(Rp)", "Penjualan per Pembeli (Pesanan Siap Dikirim)(Rp)",
      ],
    },
  ],
  shopee_kesehatan: [
    {
      klien: ["Eighty eight", "Healthy", "Nubutik", "Pawlovin", "Umar Media"],
      header: [
        "Poin Pinalti", "Pinalti Berjalan", "Durasi",
      ],
    },
  ],
  shopee_live: [
    {
      klien: ["Eighty eight", "Healthy", "Nubutik", "Pawlovin", "Shopee - Fim Motor", "Umar Media"],
      header: [
        "Informasi Streaming", "Waktu Mulai", "Pengunjung", "Penonton Terbanyak", "Rata-rata Durasi Menonton",
        "Pesanan (COD Dibuat + non-COD Dibayar)", "Penjualan (Pesanan Siap Dikirim)(Rp)",
      ],
    },
  ],
  shopee_parent_sku: [
    {
      klien: ["Eighty eight", "Healthy", "Nubutik", "Pawlovin", "Shopee - Fim Motor", "Umar Media"],
      header: [
        "Kode Produk", "Produk", "Status Produk Saat Ini", "Kode Variasi", "Nama Variasi",
        "Status Variasi Saat Ini", "Kode Variasi", "SKU Induk", "Total Penjualan (Pesanan Dibuat) (IDR)",
        "Penjualan (Pesanan Siap Dikirim) (IDR)", "Jumlah Produk Dilihat", "Produk Diklik", "Persentase Klik",
        "Tingkat Konversi Pesanan (Pesanan Dibuat)", "Tingkat Konversi Pesanan (Pesanan Siap Dikirim)",
        "Pesanan Dibuat", "Pesanan Siap Dikirim", "Produk (Pesanan Dibuat)", "Produk (Pesanan Siap Dikirim)",
        "Total Pembeli (Pesanan Dibuat)", "Total Pembeli (Pesanan Siap Dikirim)",
        "Tingkat Konversi (Pesanan yang Dibuat)", "Tingkat Konversi (Pesanan Siap Dikirim)",
        "Penjualan per Pesanan (Pesanan Dibuat) (IDR)", "Penjualan per Pesanan (Pesanan Siap Dikirim) (IDR)",
        "Produk Unik Dilihat", "Produk Unik Diklik", "Pengunjung Produk (Kunjungan)", "Halaman Produk Dilihat",
        "Pengunjung Melihat Tanpa Membeli", "Tingkat Pengunjung Melihat Tanpa Membeli", "Klik Pencarian", "Suka",
        "Pengunjung Produk (Menambahkan Produk ke Keranjang)", "Dimasukkan ke Keranjang (Produk)",
        "Tingkat Konversi Produk Dimasukkan ke Keranjang", "Tingkat Pesanan Berulang (Pesanan Dibuat)",
        "% Pembelian Ulang (Pesanan Siap Dikirim)", "Rata-rata hari Pesanan Berulang (Pesanan Dibuat)",
        "Rata-rata Hari Pembelian Terulang (Pesanan Siap Dikirim)",
      ],
    },
  ],
  shopee_shop_stats: [
    {
      klien: ["Eighty eight", "Healthy", "Nubutik", "Pawlovin", "Shopee - Fim Motor", "Umar Media"],
      header: [
        "Tanggal", "Total Penjualan (IDR)", "Total Pesanan", "Penjualan per Pesanan", "Produk Diklik",
        "Total Pengunjung", "Tingkat Konversi Pesanan", "Pesanan Dibatalkan", "Penjualan Dibatalkan",
        "Pesanan Dikembalikan", "Penjualan Dikembalikan", "Pembeli", "Total Pembeli Baru", "Total Pembeli Saat Ini",
        "Total Potensi Pembeli", "Tingkat Pembelian Berulang",
      ],
    },
  ],
  shopee_voucher: [
    {
      klien: ["Eighty eight", "Healthy", "Nubutik", "Shopee - Fim Motor", "Umar Media"],
      header: [
        "Periode Waktu", "Penjualan (Pesanan Dibuat) (IDR)", "Penjualan (Pesanan Siap Dikirim) (IDR)", "Klaim",
        "Pesanan (Pesanan Dibuat)", "Pesanan (Pesanan Siap Dikirim)", "Tingkat Penggunaan (Pesanan Dibuat)",
        "Tingkat Penggunaan (Pesanan Siap Dikirim)", "Pembeli (Pesanan Dibuat)", "Pembeli (Pesanan Siap Dikirim)",
        "Total Biaya (Pesanan Dibuat) (IDR)", "Total Biaya (Pesanan Siap Dikirim) (IDR)",
      ],
    },
  ],
  tt_ads_live: [
    {
      klien: ["Avitaskin", "Evebag", "Juragan Acc", "Octatrix", "Sajira", "Tiktok - Avitaskin"],
      header: [
        "Nama LIVE", "Waktu peluncuran", "Status", "Nama kampanye", "ID Campaign", "Biaya", "Biaya Bersih",
        "Pesanan SKU", "Pesanan SKU (Toko saat ini)", "Biaya per pesanan (Toko saat ini)", "Pendapatan kotor",
        "Penghasilan bruto (Toko saat ini)", "ROI (Toko saat ini)", "Tayangan LIVE", "Biaya per tayangan LIVE",
        "Tayangan LIVE 10 detik", "Biaya per tayangan LIVE 10 detik", "Pengikut saat LIVE", "Mata uang",
      ],
    },
  ],
  tt_ads_product: [
    {
      klien: ["Avitaskin", "Evebag", "Juragan Acc", "Octatrix", "Sajira", "Tiktok - Avitaskin"],
      header: [
        "Nama kampanye", "ID Campaign", "ID produk", "Jenis materi iklan", "Judul video", "ID video", "Akun TikTok",
        "Waktu posting", "Status", "Status sekunder penjelajahan", "Jenis otorisasi", "Biaya", "Pesanan SKU",
        "Biaya per pesanan", "Pendapatan kotor", "Impresi iklan produk", "Jumlah klik iklan produk",
        "Tingkat klik iklan produk", "Rasio konversi iklan", "Rasio tayang video iklan 2 detik",
        "Rasio tayang video iklan 6 detik", "Rasio tayang video iklan 25%", "Rasio tayang video iklan 50%",
        "Rasio tayang video iklan 75%", "Rasio tayang video iklan 100%", "Mata uang",
      ],
    },
  ],
  tt_live: [
    {
      klien: ["Avitaskin", "Evebag", "Juragan Acc", "Octatrix", "Sajira", "Tiktok - Avitaskin"],
      header: [
        "ID Kreator", "Kreator", "Nama panggilan", "Waktu Live", "Durasi", "GMV dari LIVE (Rp)", "GMV LIVE (Rp)",
        "GMV tidak langsung dari LIVE (Rp)", "Produk yang ditambahkan", "Produk Terjual", "Pemesanan",
        "Pesanan Dibayar", "Produk yang terjual melalui LIVE", "Produk yang terjual dari LIVE",
        "Produk yang terjual dari LIVE secara tidak langsung", "Pembeli unik", "Harga Rata-Rata (Rp)", "CTOR",
        "Penonton", "Live Stream Dilihat", "Durasi menonton rata-rata (Siaran LIVE)", "Komentar", "Live Dibagikan",
        "Suka pada LIVE", "Pengikut baru (Video kreator)", "Produk Dilihat", "Klik Produk", "CTR",
      ],
    },
  ],
  tt_orders: [
    {
      klien: ["Tiktok - Avitaskin"],
      header: [
        "Order ID", "Order Status", "Order Substatus", "Cancelation/Return Type", "Normal or Pre-order", "SKU ID",
        "Seller SKU", "Product Name", "Variation", "Quantity", "Sku Quantity of return", "SKU Unit Original Price",
        "SKU Subtotal Before Discount", "SKU Platform Discount", "SKU Seller Discount",
        "SKU Subtotal After Discount", "Shipping Fee After Discount", "Original Shipping Fee",
        "Shipping Fee Seller Discount", "Shipping Fee Platform Discount", "Distance Shipping Fee", "Distance Fee",
        "Order Refund Amount", "Payment platform discount", "Buyer Service Fee", "Handling Fee",
        "Shipping Insurance", "Item Insurance", "Order Amount", "Created Time", "Paid Time", "RTS Time",
        "Shipped Time", "Delivered Time", "Cancelled Time", "Cancel By", "Cancel Reason", "Fulfillment Type",
        "Warehouse Name", "Tracking ID", "Delivery Option", "Shipping Provider Name", "Buyer Message",
        "Buyer Username", "Recipient", "Phone #", "Zipcode", "Country", "Province", "Regency and City", "Districts",
        "Villages", "Detail Address", "Additional address information", "Payment Method", "Weight(kg)",
        "Product Category", "Package ID", "Purchase Channel", "Seller Note", "Checked Status", "Checked Marked by",
        "Tokopedia Invoice Number", "Order Channel", "Creator Handle",
      ],
    },
  ],
  tt_product_analytics: [
    {
      klien: ["Avitaskin", "Evebag", "Juragan Acc", "Octatrix", "Tiktok - Avitaskin"],
      header: [
        "Nama", "ID Produk", "Rentang GMV", "Status daftar produk", "GMV", "GMV dari LIVE penjual",
        "GMV LIVE penjual", "GMV tidak langsung dari LIVE penjual", "GMV dari video penjual", "GMV video penjual",
        "GMV tidak langsung dari video penjual", "GMV dari kreator", "GMV dari LIVE kreator", "GMV LIVE afiliasi",
        "GMV tidak langsung dari LIVE kreator", "GMV dari video afiliasi", "GMV video Afiliasi",
        "GMV tidak langsung dari video kreator", "GMV kartu produk penjual", "Pesanan", "Pesanan SKU",
        "Produk terjual", "Est. pembeli", "AOV (pesanan SKU)", "Impresi produk", "Klik produk", "CTR",
        "Jumlah tambahkan ke keranjang", "Persentase tambahkan ke keranjang", "CTOR (pesanan SKU)",
        "Impresi produk unik", "Klik unik", "CTR unik", "Pembeli yang menambahkan ke keranjang",
        "Persentase ATC unik", "CTOR unik (pesanan SKU)", "GMV dengan pajak", "Pajak",
        "GMV (dengan subsidi dari TikTok)", "Shipping fees", "Pengembalian dana",
        "Produk yang dikembalikan dananya", "Pembeli yang dikembalikan dananya", "Impresi produk tab Toko",
        "Klik produk tab Toko", "Klik produk tab Toko unik", "Est. pembeli tab Toko", "CTR tab Toko",
        "CTOR tab Toko (SKU)", "GMV tab Toko", "Produk terjual dari tab Toko", "Perolehan GMV", "GMV",
        "GMV tidak langsung", "Pesanan teratribusi", "Pesanan SKU teratribusi", "Pesanan SKU",
        "Pesanan SKU tidak langsung", "Produk terjual dengan atribusi", "Produk terjual",
        "Produk yang terjual secara tidak langsung", "Est. pembeli", "AOV (pesanan SKU teratribusi)",
        "Jumlah LIVE baru", "Impresi produk", "Klik produk", "CTR", "Jumlah tambahkan ke keranjang",
        "Persentase tambahkan ke keranjang", "CTOR (pesanan SKU)", "Impresi produk unik", "Klik unik", "CTR unik",
        "Pembeli yang menambahkan ke keranjang", "Persentase ATC unik", "CTOR unik (pesanan SKU)", "Perolehan GMV",
        "GMV", "GMV tidak langsung", "Pesanan teratribusi", "Pesanan SKU teratribusi", "Pesanan SKU",
        "Pesanan SKU tidak langsung", "Produk terjual dengan atribusi", "Produk terjual",
        "Produk yang terjual secara tidak langsung", "Est. pembeli", "AOV (pesanan SKU teratribusi)",
        "Jumlah video baru", "Impresi produk", "Klik produk", "CTR", "Jumlah tambahkan ke keranjang",
        "Persentase tambahkan ke keranjang", "CTOR (pesanan SKU)", "Impresi produk unik", "Klik unik", "CTR unik",
        "Pembeli yang menambahkan ke keranjang", "Persentase ATC unik", "CTOR unik (pesanan SKU)", "Perolehan GMV",
        "GMV dari LIVE", "GMV LIVE afiliasi", "GMV tidak langsung dari LIVE kreator", "GMV dari video",
        "GMV video Afiliasi", "GMV tidak langsung dari video kreator", "Pesanan teratribusi",
        "Pesanan SKU teratribusi", "Produk terjual dengan atribusi", "Est. pembeli",
        "AOV (pesanan SKU teratribusi)", "Rata-rata kreator yang memosting konten harian", "Jumlah LIVE baru",
        "Jumlah video baru", "Impresi produk", "Klik produk", "CTR", "Jumlah tambahkan ke keranjang",
        "Persentase tambahkan ke keranjang", "CTOR (pesanan SKU)", "Impresi produk unik", "Klik unik", "CTR unik",
        "Pembeli yang menambahkan ke keranjang", "Persentase ATC unik", "CTOR unik (pesanan SKU)",
        "Impresi produk (LIVE)", "Klik produk (LIVE)", "CTR (LIVE)", "Jumlah tambahkan ke keranjang (LIVE)",
        "Tambahkan ke keranjang (LIVE)", "CTOR (pesanan SKU) (LIVE)", "Impresi produk unik (LIVE)",
        "Klik unik (LIVE)", "CTR unik (LIVE)", "Pengguna ATC (LIVE)", "Persentase ATC unik (LIVE)",
        "CTOR unik (SKU) (LIVE)", "Impresi produk (video)", "Klik produk (video)", "CTR (video)",
        "Jumlah tambahkan ke keranjang (video)", "Tambahkan ke keranjang (video)", "CTOR (pesanan SKU) (video)",
        "Impresi produk unik (video)", "Klik unik (video)", "CTR unik (video)", "Pengguna ATC (video)",
        "Persentase ATC unik (video)", "CTOR unik (SKU) (video)", "Perolehan GMV", "GMV", "GMV tidak langsung",
        "Pesanan teratribusi", "Pesanan SKU teratribusi", "Pesanan SKU", "Pesanan SKU tidak langsung",
        "Produk terjual dengan atribusi", "Produk terjual", "Produk yang terjual secara tidak langsung",
        "Est. pembeli", "AOV (pesanan SKU teratribusi)", "Impresi produk", "Klik produk", "CTR",
        "Jumlah tambahkan ke keranjang", "Persentase tambahkan ke keranjang", "CTOR (pesanan SKU)",
        "Impresi produk unik", "Klik unik", "CTR unik", "Pembeli yang menambahkan ke keranjang",
        "Persentase ATC unik", "CTOR unik (pesanan SKU)",
      ],
    },
    {
      klien: ["Sajira"],
      header: [
        "Nama", "ID Produk", "Rentang GMV", "Status daftar produk", "GMV", "GMV dari LIVE penjual",
        "GMV LIVE penjual", "GMV tidak langsung dari LIVE penjual", "GMV dari video penjual", "GMV video penjual",
        "GMV tidak langsung dari video penjual", "GMV dari kreator", "GMV dari LIVE kreator", "GMV LIVE afiliasi",
        "GMV tidak langsung dari LIVE kreator", "GMV dari video afiliasi", "GMV video Afiliasi",
        "GMV tidak langsung dari video kreator", "GMV kartu produk penjual", "Pesanan", "Pesanan SKU",
        "Produk terjual", "Est. pembeli", "AOV (pesanan SKU)", "Impresi produk", "Klik produk", "CTR",
        "Jumlah tambahkan ke keranjang", "Persentase tambahkan ke keranjang", "CTOR (pesanan SKU)",
        "Impresi produk unik", "Klik unik", "CTR unik", "Pembeli yang menambahkan ke keranjang",
        "Persentase ATC unik", "CTOR unik (pesanan SKU)", "GMV dengan pajak", "Pajak",
        "GMV (dengan subsidi dari TikTok)", "Shipping fees", "Pengembalian dana",
        "Produk yang dikembalikan dananya", "Pembeli yang dikembalikan dananya", "Impresi produk tab Toko",
        "Klik produk tab Toko", "Klik produk tab Toko unik", "Est. pembeli tab Toko", "CTR tab Toko",
        "CTOR tab Toko (SKU)", "GMV tab Toko", "Produk terjual dari tab Toko", "Perolehan GMV", "GMV",
        "GMV tidak langsung", "Pesanan teratribusi", "Pesanan SKU teratribusi", "Pesanan SKU",
        "Pesanan SKU tidak langsung", "Produk terjual dengan atribusi", "Produk terjual",
        "Produk yang terjual secara tidak langsung", "Est. pembeli", "AOV (pesanan SKU teratribusi)",
        "Jumlah LIVE baru", "Impresi produk", "Klik produk", "CTR", "Jumlah tambahkan ke keranjang",
        "Persentase tambahkan ke keranjang", "CTOR (pesanan SKU)", "Impresi produk unik", "Klik unik", "CTR unik",
        "Pembeli yang menambahkan ke keranjang", "Persentase ATC unik", "CTOR unik (pesanan SKU)", "Perolehan GMV",
        "GMV", "GMV tidak langsung", "Pesanan teratribusi", "Pesanan SKU teratribusi", "Pesanan SKU",
        "Pesanan SKU tidak langsung", "Produk terjual dengan atribusi", "Produk terjual",
        "Produk yang terjual secara tidak langsung", "Est. pembeli", "AOV (pesanan SKU teratribusi)",
        "Jumlah video baru", "Impresi produk", "Klik produk", "CTR", "Jumlah tambahkan ke keranjang",
        "Persentase tambahkan ke keranjang", "CTOR (pesanan SKU)", "Impresi produk unik", "Klik unik", "CTR unik",
        "Pembeli yang menambahkan ke keranjang", "Persentase ATC unik", "CTOR unik (pesanan SKU)", "Perolehan GMV",
        "GMV dari LIVE", "GMV LIVE afiliasi", "GMV tidak langsung dari LIVE kreator", "GMV dari video",
        "GMV video Afiliasi", "GMV tidak langsung dari video kreator", "Pesanan teratribusi",
        "Pesanan SKU teratribusi", "Produk terjual dengan atribusi", "Est. pembeli",
        "AOV (pesanan SKU teratribusi)", "promoting_creators_metric_name_short_ui", "Jumlah LIVE baru",
        "Jumlah video baru", "Impresi produk", "Klik produk", "CTR", "Jumlah tambahkan ke keranjang",
        "Persentase tambahkan ke keranjang", "CTOR (pesanan SKU)", "Impresi produk unik", "Klik unik", "CTR unik",
        "Pembeli yang menambahkan ke keranjang", "Persentase ATC unik", "CTOR unik (pesanan SKU)",
        "Impresi produk (LIVE)", "Klik produk (LIVE)", "CTR (LIVE)", "Jumlah tambahkan ke keranjang (LIVE)",
        "Tambahkan ke keranjang (LIVE)", "CTOR (pesanan SKU) (LIVE)", "Impresi produk unik (LIVE)",
        "Klik unik (LIVE)", "CTR unik (LIVE)", "Pengguna ATC (LIVE)", "Persentase ATC unik (LIVE)",
        "CTOR unik (SKU) (LIVE)", "Impresi produk (video)", "Klik produk (video)", "CTR (video)",
        "Jumlah tambahkan ke keranjang (video)", "Tambahkan ke keranjang (video)", "CTOR (pesanan SKU) (video)",
        "Impresi produk unik (video)", "Klik unik (video)", "CTR unik (video)", "Pengguna ATC (video)",
        "Persentase ATC unik (video)", "CTOR unik (SKU) (video)", "Perolehan GMV", "GMV", "GMV tidak langsung",
        "Pesanan teratribusi", "Pesanan SKU teratribusi", "Pesanan SKU", "Pesanan SKU tidak langsung",
        "Produk terjual dengan atribusi", "Produk terjual", "Produk yang terjual secara tidak langsung",
        "Est. pembeli", "AOV (pesanan SKU teratribusi)", "Impresi produk", "Klik produk", "CTR",
        "Jumlah tambahkan ke keranjang", "Persentase tambahkan ke keranjang", "CTOR (pesanan SKU)",
        "Impresi produk unik", "Klik unik", "CTR unik", "Pembeli yang menambahkan ke keranjang",
        "Persentase ATC unik", "CTOR unik (pesanan SKU)",
      ],
    },
  ],
  tt_shop_analytics: [
    {
      klien: ["Avitaskin", "Evebag", "Juragan Acc", "Octatrix", "Sajira"],
      header: [
        "", "GMV", "Pesanan", "Pembeli", "Produk terjual", "Produk yang dikembalikan dananya", "Pesanan SKU",
        "Pendapatan bruto", "Tayangan halaman", "Pengunjung", "Persentase konversi", "Impresi produk",
        "Impresi produk unik", "Klik produk", "Klik unik", "AOV", "GMV dari LIVE kreator", "GMV LIVE kreator",
        "GMV tidak langsung dari LIVE kreator", "GMV dari LIVE akun tertaut", "GMV LIVE penjual",
        "GMV tidak langsung dari LIVE penjual", "GMV dari video afiliasi", "GMV video kreator",
        "GMV tidak langsung dari video kreator", "GMV dari video akun tertaut", "GMV video penjual",
        "GMV tidak langsung dari video penjual",
      ],
    },
    {
      klien: ["Tiktok - Avitaskin"],
      header: [
        "", "GMV", "Pesanan", "Pembeli", "Produk terjual", "Pengembalian dana", "Pesanan SKU", "Pendapatan bruto",
        "Tayangan halaman", "Pengunjung", "Persentase konversi", "Impresi produk", "Impresi produk unik",
        "Klik produk", "Klik unik", "AOV", "GMV dari LIVE kreator", "GMV LIVE kreator",
        "GMV tidak langsung dari LIVE kreator", "GMV dari LIVE akun tertaut", "GMV LIVE penjual",
        "GMV tidak langsung dari LIVE penjual", "GMV dari video afiliasi", "GMV video kreator",
        "GMV tidak langsung dari video kreator", "GMV dari video akun tertaut", "GMV video penjual",
        "GMV tidak langsung dari video penjual",
      ],
    },
  ],
  tt_transaction_creator: [
    {
      klien: ["Avitaskin", "Evebag", "Juragan Acc", "Octatrix", "Sajira", "Tiktok - Avitaskin"],
      header: [
        "Creator name", "GMV dari kreator", "GMV dari LIVE kreator", "GMV dari video afiliasi", "Pengembalian dana",
        "Pesanan teratribusi", "Produk yang terjual dari kreator", "Produk yang dikembalikan dananya", "AOV",
        "GMV dari kartu produk afiliasi", "CTOR", "Siaran LIVE", "Video", "Jumlah konten sampel", "Sampel terkirim",
        "Produk yang ditambahkan ke showcase", "CTR", "Impresi produk", "Tayangan video", "Pembeli",
        "Produk terjual", "Perkiraan komisi",
      ],
    },
  ],
  tt_transaction_product: [
    {
      klien: ["Avitaskin", "Evebag", "Juragan Acc", "Octatrix", "Sajira", "Tiktok - Avitaskin"],
      header: [
        "Product name", "Product ID", "Product category", "GMV dari kreator", "Produk yang terjual dari kreator",
        "Pengembalian dana", "Produk yang dikembalikan dananya", "Pesanan teratribusi", "CTOR", "Video",
        "Siaran LIVE", "Jumlah konten sampel", "Sampel terkirim", "Video dengan penjualan",
        "Siaran LIVE dengan penjualan", "CTR", "Impresi produk", "Klik produk", "Kreator yang memosting konten",
        "Kreator dengan penjualan", "Pembeli", "Perkiraan komisi",
      ],
    },
  ],
  tt_video: [
    {
      klien: ["Avitaskin", "Evebag", "Juragan Acc", "Octatrix", "Sajira", "Tiktok - Avitaskin"],
      header: [
        "Nama Kreator", "ID Kreator", "Informasi Video", "ID Video", "Waktu", "Produk", "VV", "Likes", "Komentar",
        "Dibagikan", "Pengikut baru", "Klik Video ke LIVE", "Produk Dilihat", "Klik Produk", "Pembeli unik",
        "Pesanan SKU teratribusi", "Pesanan SKU dari video", "Pesanan SKU tidak langsung dari video",
        "Produk yang terjual melalui video", "Produk yang terjual dari video",
        "Produk yang terjual dari video secara tidak langsung", "GMV dari video (Rp)", "GMV video (Rp)",
        "GMV tidak langsung dari video (Rp)", "GPM (Rp)", "Rasio klik tayang (Video)", "Rasio Video ke LIVE",
        "Persentase Video yang Ditonton Hingga Selesai", "CTOR (pesanan SKU)", "Diagnosis",
      ],
    },
  ],
};
