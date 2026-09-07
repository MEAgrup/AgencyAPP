-- Gelombang D fondasi — durasi layanan berpindah satuan dari HARI ke BULAN, dan
-- katalog mulai menyatakan apa yang ditambah oleh qty yang dibeli klien.
--
-- Diketok pemilik 2026-09-07 (Nerissa, COO), tujuh pertanyaan sekaligus:
--
--   Q1  satuan durasi = BULAN (opsi b), bukan "1 bulan ≈ 30 hari".
--   Q2  sembilan layanan yang `unit`-nya 3/6/12 memang paket 3/6/12 BULAN —
--       "klien beli langsung 3 bulan, 6 bulan dst". Tim Sales menuliskan angka
--       bulan itu ke kolom `unit` karena tidak ada kolom durasi; itu diakui
--       pemilik sebagai salah tempat, dan diperbaiki ke format baru di sini.
--   Q3  qty yang dibeli TIDAK selalu berarti bulan: untuk `Nano KOL` qty adalah
--       jumlah KOL, untuk `SKU Design` jumlah SKU. Karena itu katalog menyimpan
--       penanda per layanan, dan defaultnya yang AMAN (`volume`).
--   Q4  durasi dihitung dari START CAMPAIGN — periode riset tidak dihitung.
--   Q5  layanan sekali-jadi diakui SEKALIGUS saat selesai ⇒ durasinya NULL,
--       bukan 1 bulan.
--   Q6  layanan ber-"JAM" (150 JAM, 16/30/60 Jam Night) = jam kerja DALAM
--       1 bulan, karena live streaming tidak tiap hari ⇒ durasi 1 bulan.
--   Q7  durasi kontrak = layanan terpanjang; tiap layanan tetap punya
--       periodenya sendiri untuk accrual.
--
-- Kenapa RENAME dan bukan menambah kolom bulan di samping kolom hari: dua kolom
-- berarti dua jawaban untuk satu pertanyaan ("berapa lama jasa ini berjalan"),
-- dan begitu keduanya ada, keduanya akan berbeda. Satu kolom, satu satuan.
--
-- Deviasi PRD yang DISENGAJA (M16 LT-42 menulis `durasi_jasa` dalam hari
-- kalender): end_date Ads kini `start + durasi_bulan bulan + additional_days +
-- total_hari_hold`. Bulan-nya kalender-aware (31 Jan + 1 bulan = 28/29 Feb),
-- hari tambahan dan hold tetap HARI. Alasannya di `DECISIONS.md` 2026-09-07.

-- ---------------------------------------------------------------------------
-- 1. durasi_jasa (hari) -> durasi_bulan (bulan)
-- ---------------------------------------------------------------------------

ALTER TABLE master_service_versions
    DROP CONSTRAINT ck_msv_durasi_jasa_positive;

ALTER TABLE master_service_versions
    RENAME COLUMN durasi_jasa TO durasi_bulan;

-- Konversi nilai yang sudah ada. Hanya DUA baris di seluruh tabel yang terisi
-- (AI Video dan Optimasi SKU, keduanya 30 hari, disemai 20260831070000), dan 30
-- hari di sana memang berarti "satu bulan langganan". Ditulis sebagai aturan
-- umum (kelipatan 30 -> jumlah bulan) supaya tidak ada baris yang lolos
-- terbaca "30 BULAN" seandainya ada baris lain yang belum terlihat; sisanya
-- (bukan kelipatan 30) dibulatkan ke atas ke bulan penuh, karena membiarkannya
-- terbaca sebagai bulan akan melebih-lebihkan durasi ~30x.
UPDATE master_service_versions
   SET durasi_bulan = GREATEST(1, CEIL(durasi_bulan::numeric / 30))::integer
 WHERE durasi_bulan IS NOT NULL;

ALTER TABLE master_service_versions
    ADD CONSTRAINT ck_msv_durasi_bulan_positive
    CHECK (durasi_bulan IS NULL OR durasi_bulan > 0);

COMMENT ON COLUMN master_service_versions.durasi_bulan IS
  'Durasi jasa dalam BULAN KALENDER, dihitung dari tanggal layanan MULAI JALAN (start campaign untuk Ads — periode riset tidak dihitung, ketokan Q4 2026-09-07). NULL = layanan sekali-jadi: tidak punya periode, pendapatannya diakui sekaligus saat selesai (Q5), BUKAN disebar 1 bulan. Ditetapkan Admin (Sales Head/SPV/Director) via createService/updateService — versi baru, bukan mutasi.';

-- ---------------------------------------------------------------------------
-- 2. qty_menambah — apa yang bertambah kalau klien beli lebih dari satu
-- ---------------------------------------------------------------------------
--
-- Tanpa kolom ini, satu-satunya cara memakai qty adalah memukul rata "qty =
-- bulan", dan itu salah untuk lebih dari separuh katalog: `Nano KOL` beli 10
-- adalah 10 KOL dalam satu campaign, bukan kontrak 10 bulan. Kalau dipukul
-- rata, mesin accrual menyebar pendapatannya 10 bulan — angka karangan di
-- laporan keuangan, bukan sekadar tampilan yang keliru.
--
-- Default `volume` dipilih karena itu sisi yang AMAN: salah menandai layanan
-- durasi sebagai volume membuat durasinya terlalu pendek (kelihatan cepat, dan
-- ketahuan), sedangkan sebaliknya menyebar pendapatan bertahun-tahun (tidak
-- kelihatan, dan diam-diam salah selama bertahun-tahun).

ALTER TABLE master_service_versions
    ADD COLUMN qty_menambah varchar(10) NOT NULL DEFAULT 'volume';

ALTER TABLE master_service_versions
    ADD CONSTRAINT ck_msv_qty_menambah CHECK (qty_menambah IN ('durasi', 'volume'));

-- `qty_menambah = 'durasi'` berarti durasi total = qty x durasi_bulan. Kalau
-- durasi_bulan NULL, tidak ada yang bisa dikali — kombinasi itu bukan "belum
-- diisi", ia tidak punya arti sama sekali, jadi DB yang menolaknya.
ALTER TABLE master_service_versions
    ADD CONSTRAINT ck_msv_qty_durasi_butuh_durasi_bulan
    CHECK (qty_menambah <> 'durasi' OR durasi_bulan IS NOT NULL);

COMMENT ON COLUMN master_service_versions.qty_menambah IS
  'Apa yang ditambah qty yang dibeli klien (ketokan Q3 2026-09-07). ''durasi'' = qty adalah JUMLAH PERIODE, durasi total = qty x durasi_bulan (mis. GMV Max beli 3 = 3 bulan). ''volume'' = qty adalah jumlah keluaran dalam periode yang sama (mis. Nano KOL beli 10 = 10 KOL, durasi tidak berubah). Default ''volume'' — sisi yang aman.';
