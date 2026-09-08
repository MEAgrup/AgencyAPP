-- ============================================================================
-- FS-4 (Feedback tim Sales 2026-09-08 #4) — jenis ketiga `bayar_komisi` pada
-- `renewal_requests`.
--
-- KELUHANNYA. "Bagian klien perpanjangan — buat 1 jenis baru selain
-- perpanjangan & cross sales, yaitu: bayar komisi. Pilihan jasa hanya 1 yaitu
-- komisi. Dimana angka nilainya isi sendiri."
--
-- KENAPA HANYA `ck_rnw_jenis` YANG DISENTUH, DAN BUKAN `ck_contracts_jenis`.
-- Ketokan pemilik (FS-3, 2026-09-08): bayar komisi adalah TAGIHAN, bukan
-- kesepakatan baru — ia melahirkan `SVC-` + `TRX-` saja, TANPA `CTR-` dan
-- TANPA menyentuh `client_sales_allocations`.
--
-- Itu bukan preferensi bentuk. `executeRenewal` hari ini MENGGANTI SELURUH
-- alokasi komisi klien setiap eksekusi (KS-2, keputusan pemilik 2026-08-29) dan
-- memindahkan `clients.sales_pic_id`. Komisi ditagih SETIAP BULAN — memakai
-- jalur yang sama apa adanya berarti kepemilikan klien berpindah tiap bulan,
-- diam-diam, ke siapa pun yang kebetulan menekan tombol tagih.
--
-- Karena nol `CTR-` dicetak, `contracts.jenis` tidak pernah menerima nilai
-- keempat: `ck_contracts_jenis` TIDAK disentuh, dan `salesperf.ts:591-593`
-- (yang mencocokkan string literal `baru`/`perpanjangan`/`cross_sell` dan akan
-- diam-diam melewatkan nilai yang tak dikenalnya) juga tidak perlu diubah.
-- Menambah nilai HANYA di sini karena itu bukan setengah pekerjaan — itu
-- seluruh pekerjaannya.
--
-- Layanan yang boleh dipakai TIDAK dikunci ke nama "Komisi": gerbangnya di
-- `renewal.ts` menuntut `master_service_versions.pengakuan = 'bulan_berikutnya'`
-- (D-KOM). Nama layanan bisa disunting Sales Head lewat form MSL kapan saja;
-- penanda `pengakuan` dijaga CHECK `ck_msv_pengakuan` dan justru LAHIR untuk
-- membedakan Komisi dari layanan sekali-jadi.
--
-- Nol tabel, nol kolom, nol prefix, nol mesin, nol event ⇒ gate 147/41/32/73
-- TETAP. Aditif (memperlebar CHECK), aman mendahului deploy kode: nilai baru
-- baru bisa DITULIS setelah kodenya ada.
-- ============================================================================

ALTER TABLE renewal_requests DROP CONSTRAINT ck_rnw_jenis;
ALTER TABLE renewal_requests ADD CONSTRAINT ck_rnw_jenis
    CHECK (jenis IN ('perpanjangan', 'cross_sell', 'bayar_komisi'));

COMMENT ON COLUMN renewal_requests.jenis IS
  'R-03: perpanjangan | cross_sell | bayar_komisi (FS-4). Hanya dua yang pertama mencetak CTR-; bayar_komisi murni tagihan (SVC- + TRX-), lihat renewal.executeRenewal.';
