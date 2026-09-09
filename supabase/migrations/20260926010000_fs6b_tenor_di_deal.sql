-- ============================================================================
-- FS-6b (Feedback tim Sales 2026-09-08 #6, PARUH KEDUA) — tenor yang dipilih
-- klien ikut sampai ke deal.
--
-- APA YANG SUDAH ADA. `20260925040000_fs6_msl_opsi_durasi` memberi katalog sisi
-- KATALOG-nya: satu versi layanan boleh menyatakan 1/3/6/12 bulan dengan harga
-- berbeda (`master_service_duration_options`), dengan invarian "opsi TERPENDEK
-- = `standard_price` + `durasi_bulan` versinya" supaya setiap pembaca lama
-- terus membaca angka yang sah.
--
-- APA YANG BELUM. Invarian itu punya konsekuensi yang tidak enak dibaca tapi
-- benar: selama tidak ada yang MENYIMPAN tenor pilihan klien, setiap pembaca
-- lama membaca paket TERPENDEK — selamanya. Konkretnya, sebelum berkas ini:
--
--   * `sales.deriveDuration` (MAX durasi atas baris yang di-closing) mengambil
--     `master_service_versions.durasi_bulan`, yaitu opsi terpendek. Deal 12
--     bulan mencetak `contracts.durasi_bulan = 3`.
--   * `tutupbuku.hitungAngkaPeriode` menyebar pendapatan sepanjang
--     `v.durasi_bulan` yang sama. Paket 12 bulan seharga Rp 36jt diakui rata
--     dalam 3 bulan — Rp 12jt/bulan, bukan Rp 3jt/bulan. Sembilan bulan
--     sesudahnya nol.
--
-- Keduanya salah TANPA melempar galat apa pun. Itulah kenapa berkas ini bagian
-- dari jalur uang dan bukan pekerjaan tampilan.
--
-- ---------------------------------------------------------------------------
-- BENTUKNYA: SATU KOLOM SNAPSHOT, NULLABLE, DI EMPAT TABEL
-- ---------------------------------------------------------------------------
-- `qualified_form_services` → `negotiation_proposal_lines` →
-- `renewal_proposal_lines` → `services`: rantai yang sama yang sudah dilalui
-- `standard_price`/`commission_rule`, dan untuk alasan yang sama — sebuah deal
-- harus tetap terbaca persis seperti saat disepakati walau katalognya
-- di-versi-ulang sesudahnya (aturan rumah #3/#4).
--
-- NULL BUKAN "belum diisi". Ia berarti TEPAT satu hal: "pakai durasi versi
-- yang di-pin baris ini" — yaitu perilaku hari ini. Itu yang membuat berkas
-- ini NOL BACKFILL: setiap baris lama sudah membawa arti yang benar, dan tidak
-- ada satu pun tebakan yang perlu dibuat tentang deal yang sudah berjalan.
-- (Bandingkan `services.qty` di 20260925040000_d3_services_qty: di sana NULL
-- juga sengaja dibiarkan, dengan alasan yang sama.)
--
-- ---------------------------------------------------------------------------
-- KENAPA BATASNYA `> 0` DAN BUKAN `BETWEEN 1 AND 36`
-- ---------------------------------------------------------------------------
-- Godaannya jelas: `contracts.durasi_bulan` dibatasi 1..36
-- (`ck_contracts_durasi`, 20260807120000), jadi kenapa tidak sekalian di sini?
--
-- Karena kolom SNAPSHOT tidak boleh menolak nilai yang KATALOGNYA terima.
-- `ck_msdo_durasi` hanya menuntut `durasi_bulan > 0`. Kalau seorang Sales Head
-- memasukkan opsi 48 bulan, batas 36 di sini akan mematikan closing-nya dengan
-- pelanggaran constraint mentah — persis kelas cacat yang aturan rumah #5 ada
-- untuk mencegah. Batas 36 tetap ditegakkan, tapi di tempat yang benar:
-- `sales.resolveClosingWindow` sudah memeriksanya lebih dulu dan menjawab
-- dengan pesan `[...]` rumah, dan `ck_contracts_durasi` menjadi jaring kedua.
--
-- Nol tabel baru, nol prefix, nol mesin, nol event — gate `db-rebuild.sh` dan
-- `ci.yml` TIDAK berubah (tetap 150 tabel / 41 prefix / 33 mesin / 73 event).
-- ============================================================================

ALTER TABLE qualified_form_services ADD COLUMN durasi_bulan integer NULL;
ALTER TABLE qualified_form_services ADD CONSTRAINT ck_qfs_durasi_positif
    CHECK (durasi_bulan IS NULL OR durasi_bulan > 0);
COMMENT ON COLUMN qualified_form_services.durasi_bulan IS
  'FS-6b: tenor yang DIPILIH klien untuk baris ini, dalam bulan. NULL = pakai '
  'durasi versi MSL yang di-pin (master_version_no) — perilaku sebelum FS-6b '
  'dan arti yang benar bagi setiap baris lama. Non-NULL wajib cocok dengan '
  'salah satu master_service_duration_options versi itu; yang menegakkannya '
  'sales.lineFromView, karena di situlah harga paketnya ikut diambil.';

ALTER TABLE negotiation_proposal_lines ADD COLUMN durasi_bulan integer NULL;
ALTER TABLE negotiation_proposal_lines ADD CONSTRAINT ck_negline_durasi_positif
    CHECK (durasi_bulan IS NULL OR durasi_bulan > 0);
COMMENT ON COLUMN negotiation_proposal_lines.durasi_bulan IS
  'FS-6b: tenor baris penawaran ini, dalam bulan. NULL = pakai durasi versi '
  'MSL. Baris CUSTOM (harga nego) boleh membawanya juga — tenor dan harga '
  'adalah dua kesepakatan terpisah, dan sebuah nego atas paket 12 bulan tetap '
  'paket 12 bulan.';

ALTER TABLE renewal_proposal_lines ADD COLUMN durasi_bulan integer NULL;
ALTER TABLE renewal_proposal_lines ADD CONSTRAINT ck_rnwline_durasi_positif
    CHECK (durasi_bulan IS NULL OR durasi_bulan > 0);
COMMENT ON COLUMN renewal_proposal_lines.durasi_bulan IS
  'FS-6b: tenor baris perpanjangan/cross-sell ini, dalam bulan. NULL = pakai '
  'durasi versi MSL. Bentuknya sengaja identik dengan '
  'negotiation_proposal_lines.durasi_bulan — satu aturan tenor, bukan dua.';

ALTER TABLE services ADD COLUMN durasi_bulan integer NULL;
ALTER TABLE services ADD CONSTRAINT ck_services_durasi_positif
    CHECK (durasi_bulan IS NULL OR durasi_bulan > 0);
COMMENT ON COLUMN services.durasi_bulan IS
  'FS-6b: tenor yang benar-benar dijual untuk layanan ini, dalam bulan. NULL = '
  'pakai master_service_versions.durasi_bulan dari versi yang di-pin. INI yang '
  'dibaca mesin accrual (tutupbuku.hitungAngkaPeriode) lebih dulu: tanpanya, '
  'paket 12 bulan disebar sepanjang durasi opsi TERPENDEK karena itulah yang '
  'ditulis versi induknya (invarian trg_msdo_terpendek, 20260925040000).';
