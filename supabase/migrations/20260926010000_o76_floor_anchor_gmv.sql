-- ============================================================================
-- O76 — floor GMV M6A akhirnya BER-ANCHOR pada angka yang disepakati dengan
-- klien, dan gerbang toleransi ±20% yang sudah ada dipakai ulang.
--
-- Keputusan pemilik 2026-09-08 (`docs/DECISIONS.md`, O76): jalankan opsi (iii) —
-- BUKAN (i) "field GMV baru di closing M0" dan BUKAN (ii) "terima D-7 advisory
-- selamanya".
--
-- ## Apa yang sebenarnya kurang, sesudah diperiksa ke kode
--
-- Baris O76 aslinya (2026-09-07) menyebut `strategi_target.sumber_floor =
-- 'kontrak'` sebagai penunjuk ke sesuatu yang belum ada. Itu sudah tidak akurat:
-- migrasi `20260807120000_o57_contract_entity.sql:270` MENGHAPUS nilai
-- `'kontrak'`, dan kolomnya kini merekam JALUR PERSETUJUAN
-- (`input_am` → `disetujui_head`) dengan tiga penegak yang benar-benar berdiri:
-- `ck_strtg_stretch_gmv` (stretch >= floor), trigger `guard_floor_disetujui`
-- (floor beku sesudah ACC Head, service role sekalipun), dan `sumber_floor` yang
-- bukan input pemanggil.
--
-- Jadi yang kurang BUKAN penegak. Yang kurang: **angkanya tidak tertelusur ke
-- apa pun yang klien setujui.** AM mengetik floor dari nol, lalu Head
-- menyetujui angka yang AM sendiri karang — dan D-7 Sanggahan Target menjadi
-- "AM menyanggah angka AM".
--
-- ## Kenapa TIDAK perlu field baru di closing
--
-- Angkanya sudah dikumpulkan Sales, sejak Wave 1: `clients.target_gmv`
-- (`numeric(15,2) NOT NULL`, `20260722053923_wave1_money_path.sql:105`), diisi
-- pada form Qualified (`qualified_forms.target_gmv`, juga NOT NULL) dan dibawa
-- ke `clients` saat closing (`sales.ts:1637`). NOT NULL berarti **tidak ada satu
-- pun klien tanpa angka ini** — nol backfill, nol field baru, nol perubahan
-- katalog.
--
-- Dan gerbangnya pun sudah ada, terbangun penuh di jalur M6 LAMA
-- (`strategy_plans`, `20260812090000_m6_strategy_kpi_tasks.sql:40`):
-- `client_target_gmv` sebagai snapshot + `gmv_adjustment_status` ∈
-- (`dalam_toleransi`, `menunggu_persetujuan`, `disetujui`) + alasan wajib di luar
-- toleransi ±20% + `gmv_adjustment_approved_by`. Yang baru (M6A) justru yang
-- TIDAK memakainya. Jadi CDPS punya dua mekanisme target GMV: satu ber-anchor,
-- satu tidak.
--
-- Migrasi ini memberi `strategi` empat kolom dengan **nama yang sama persis**
-- seperti kembarannya di `strategy_plans`. Nama yang sama disengaja: siapa pun
-- yang sudah membaca gerbang M6 lama mengenalinya tanpa dijelaskan, dan
-- `account.gmvGate` dipakai ULANG oleh `strategi.saveTargets` alih-alih ditulis
-- kedua kali (dua mesin toleransi yang bisa berbeda adalah dua jawaban yang
-- menunggu untuk bertentangan).
--
-- ## Yang TIDAK diubah, dan sengaja
--
-- `sumber_floor` tetap dua nilai. Ia menjawab "sudah di-ACC Head atau belum",
-- dan itu pertanyaan yang berbeda dari "angkanya dari mana" — yang kini dijawab
-- `client_target_gmv`. Menambah nilai ketiga akan membuat satu kolom menjawab
-- dua pertanyaan, dan trigger `guard_floor_disetujui` membaca kolom itu.
--
-- Aditif: 4 kolom + 3 CHECK. Nol tabel/prefix/mesin/event baru ⇒ gate
-- 146/40/31/76 TETAP.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Kolom
-- ---------------------------------------------------------------------------
--
-- `client_target_gmv` NULLABLE, dan itu bukan kelalaian: baris `strategi` yang
-- sudah ada lahir SEBELUM anchor ini ada, dan menuliskan angka hari ini ke
-- dalamnya berarti mengarang snapshot untuk momen yang sudah lewat. NULL di
-- situ berarti "Strategi ini dibuat sebelum O76" — jujur, dan bisa dibedakan
-- dari nol (aturan rumah #4). `saveTargets` mengisinya pada penyimpanan target
-- berikutnya.

ALTER TABLE strategi
    ADD COLUMN client_target_gmv          numeric(18,2) NULL,
    ADD COLUMN gmv_adjustment_status      varchar(32)   NOT NULL DEFAULT 'dalam_toleransi',
    ADD COLUMN gmv_adjustment_reason      text          NULL,
    ADD COLUMN gmv_adjustment_approved_by varchar(64)   NULL;

COMMENT ON COLUMN strategi.client_target_gmv IS
  'O76 — snapshot `clients.target_gmv` (target yang disepakati Sales dengan klien '
  'di form Qualified) pada saat AM menyimpan matriks target. Anchor floor GMV. '
  'NULL = Strategi lahir sebelum O76, bukan nol.';
COMMENT ON COLUMN strategi.gmv_adjustment_status IS
  'O76 — status gerbang toleransi 20% Σ floor GMV per bulan terhadap '
  '`client_target_gmv`: dalam_toleransi | menunggu_persetujuan | disetujui. '
  'Bentuk + nama menyalin `strategy_plans` (jalur M6 lama) agar satu gerbang, '
  'bukan dua.';
COMMENT ON COLUMN strategi.gmv_adjustment_reason IS
  'O76 — alasan WAJIB saat Σ floor menyimpang > 20% dari anchor.';
COMMENT ON COLUMN strategi.gmv_adjustment_approved_by IS
  'O76 — Head/Director yang menyetujui simpangan itu (diisi saat approveStrategi).';

-- ---------------------------------------------------------------------------
-- 2. Pagar
-- ---------------------------------------------------------------------------
--
-- Ketiganya mencerminkan validasi TS (belt & braces), dan dua di antaranya
-- menyalin `ck_strategy_gmv_adj_*` apa adanya.

ALTER TABLE strategi
    ADD CONSTRAINT ck_strategi_gmv_adj_status
        CHECK (gmv_adjustment_status IN ('dalam_toleransi', 'menunggu_persetujuan', 'disetujui')),
    -- Simpangan tanpa alasan adalah simpangan yang tidak bisa dijawab
    -- belakangan; itu justru yang membuat D-7 kosong.
    ADD CONSTRAINT ck_strategi_gmv_adj_reason
        CHECK (gmv_adjustment_status = 'dalam_toleransi' OR gmv_adjustment_reason IS NOT NULL),
    -- Stempel persetujuan dan statusnya tidak boleh saling membantah — pola
    -- yang sama dengan `ck_strategi_target_floor_approval` (O57).
    ADD CONSTRAINT ck_strategi_gmv_adj_approval
        CHECK (CASE WHEN gmv_adjustment_status = 'disetujui'
                    THEN gmv_adjustment_approved_by IS NOT NULL
                    ELSE gmv_adjustment_approved_by IS NULL
               END);

-- ---------------------------------------------------------------------------
-- 3. Lubang yang harus ditutup BERSAMAAN, bukan nanti
-- ---------------------------------------------------------------------------
--
-- `clients.target_gmv` hari ini boleh diedit SIAPA PUN di divisi Account —
-- `client.canEditAccountRevisable` = `director || division === 'Account'`, tanpa
-- syarat level lead (M4-OA-6). Kalau angka itu jadi anchor floor tanpa
-- perubahan, jalurnya begini: AM mengedit anchor-nya dulu, lalu mengetik floor
-- yang cocok, dan SELURUH rantai penegak tetap hijau. Anchor yang bisa digeser
-- oleh orang yang dibatasinya bukan anchor.
--
-- Gerbangnya dinaikkan di TS (`client.canEditClientTargetGmv` = Director atau
-- Account **lead**) dan bukan di DB, dengan alasan yang eksplisit: `clients`
-- tidak punya satu pun trigger otorisasi per-kolom hari ini, dan jalur tulisnya
-- SATU (`client.updateClient` lewat registry `FIELDS`) — menambah trigger
-- per-kolom pertama di tabel ini akan menjadi mekanisme kedua yang harus
-- dijaga sinkron dengan registry itu. Yang menjaga di DB tetap ada, di sisi
-- yang benar-benar penting: floor yang sudah di-ACC Head **tidak bisa bergerak
-- sama sekali** (`guard_floor_disetujui`), jadi menggeser anchor sesudahnya
-- tidak menggeser floor mana pun — ia hanya membuat snapshot dan anchor hidup
-- berbeda, dan itu KELIHATAN karena snapshot-nya tersimpan di sini.
--
-- Dicatat sebagai penyimpangan dari matriks M4 §4 di `docs/DECISIONS.md` (O76).
