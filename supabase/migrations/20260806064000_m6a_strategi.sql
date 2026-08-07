-- CDPS — Module 6A: entitas `STRG-` Strategi + tabel anaknya + mesin status #15.
--
-- Ini adalah kerangka (backlog A-03 + A-04). Pengisian field per Section
-- (A-05…A-09) menempel di atas tabel-tabel ini, bukan menggantinya. Yang
-- dibangun di sini adalah BENTUK yang aturan-aturan M6A butuhkan supaya bisa
-- ditegakkan di DB, bukan hanya di TS.
--
-- ===========================================================================
-- Enam keputusan bentuk, dan kenapa
-- ===========================================================================
--
-- (1) **Baseline bulanan sebagai BARIS, bukan kolom `m1/m2/m3`** (§7 + D11).
--     Jendela baseline dideklarasi AM per channel, 1–6 bulan (B-0.7/Rule 5a).
--     Kolom tetap memaksa jendela tetap; baris ber-`(channel_id, month_index)`
--     tidak. Kolom `m4/m5/m6` yang NULL untuk 90% kontrak juga akan membuat
--     "blank tidak boleh, 0 boleh" (Rule 5) mustahil ditegakkan NOT NULL.
--
-- (2) **Versi adalah BARIS TERSENDIRI, bukan `versi_no` yang naik di tempat**
--     (Rule 13). "Version n stays Aktif until n+1 is approved. The active
--     version never disappears mid-revision." Dua status harus hidup bersamaan
--     — `Aktif` (versi n) dan `Draft Revisi` (versi n+1) — dan satu baris tidak
--     bisa memegang dua status. Konsekuensinya: index unik parsial per status,
--     bukan unik per service.
--
--     Catatan divergensi INTERNAL PRD: §7 menuliskan mesinnya sebagai
--     `Aktif → Draft Revisi`, yang hanya benar kalau revisi memakai baris yang
--     sama — dan itu bertentangan dengan Rule 13 di dokumen yang sama. Rule 13
--     yang menang (ia eksplisit dan memberi alasannya), jadi edge
--     `Aktif → Draft Revisi` TIDAK didaftarkan; `Aktif → Diarsipkan` yang
--     dipakai saat versi berikutnya disetujui. Dicatat di `docs/DECISIONS.md`
--     2026-08-06 — bukan dipilih diam-diam.
--
-- (3) **`strategi_version` append-only, bukan kolom yang di-UPDATE.** Satu
--     versi bisa melewati beberapa ronde review (`Dikembalikan` → `Draft` →
--     `Diajukan` lagi, Rule 12 "keeps its version number"), jadi satu baris per
--     versi akan menimpa ronde sebelumnya. `forbid_mutation()` mengunci
--     UPDATE/DELETE (aturan rumah #3).
--
--     Kenapa tabel ini ADA padahal M6C menolak `riwayat jsonb[]` dengan alasan
--     "riwayat hidup di audit_log": yang disimpan di sini bukan riwayat
--     turunan, melainkan DATA FORM J-3 (trigger dari H-2, alasan revisi, asumsi
--     D-8 mana yang gugur). Metrik §9 "% revisions with a declared trigger +
--     broken assumption" harus bisa di-query dan divalidasi; blob jsonb di
--     audit_log tidak bisa keduanya.
--
-- (4) **Floor & stretch duduk di baris target yang sama** (§7 "Stretch >= floor
--     enforced at DB check level for the GMV metric"). Menyimpannya di dua
--     tabel berbeda membuat CHECK itu mustahil ditulis, dan Rule 7 (floor
--     read-only, sanggahan tidak menurunkan floor) kehilangan penegaknya.
--
-- (5) **`vendor_id` hanya boleh di baris pilar `live` dan resource
--     `live_vendor`** (Rule 18). Live Stream mode vendor: ia tidak pernah
--     menarik kapasitas divisi internal (F-5). CHECK-nya membuat "beban divisi"
--     tidak bisa tercemar jam vendor lewat kesalahan input.
--
-- (6) **Status HANYA lewat `sm_transition`** (aturan rumah #2, mesin #15 di
--     bawah). Tidak ada satu pun jalur UPDATE status di kode TS.
--
-- ===========================================================================
-- Yang TIDAK dibangun di sini, dan kenapa
-- ===========================================================================
-- * **Field Section A / C / G-1..G-4 / I** — itu A-05…A-09 di
--   `docs/backlog/M6ABC_BACKLOG.md`. Yang ada di sini hanya kolom yang dipakai
--   invariant struktural (jendela kontrak, G-0, toleransi F-7).
-- * **`STRG_FIELD_VISIBILITY` (Rule 16 / A-10) dan tautan klien `/s/{token}`
--   (D20 / A-11).** Keduanya butuh daftar hard-internal sebagai konstanta
--   `packages/core` yang ditolak di predikat TS DAN CHECK DB. Membuat tabelnya
--   sekarang tanpa daftar itu berarti overlay visibilitas yang tidak menolak
--   apa pun — lebih berbahaya daripada tidak ada, karena terlihat seperti
--   penjagaan.
-- * **Empat event notifikasi M6A** (`strategi_diajukan`, `strategi_disetujui`,
--   `strategi_dikembalikan`, `strategi_revisi_disarankan`). Katalog notifikasi
--   adalah invariant BEKU; amandemen v2 (28 event) masih menunggu tanda tangan
--   Hans — M6A RA-1 / M6B PA-8 / M6C GA-8. Transisinya TETAP tercatat penuh di
--   `audit_log` lewat `sm_transition`; yang belum jalan hanya pemberitahuannya.
-- * **FK `plan_id`** dari `service_plan_gate` (utang M6C) — menyusul di migrasi
--   M6B bersama tabel `PLAN`.
--
-- ===========================================================================
-- Deviasi yang sudah dicatat (docs/DECISIONS.md 2026-08-06)
-- ===========================================================================
-- * Format ID `STRG-YYYYMM-NNNN`, bukan `STRG-YYYY-NNNNN` seperti PRD §7 —
--   CLAUDE.md #1 dan `ident_next` hanya bisa bentuk itu.
-- * **Tidak ada entitas CONTRACT di CDPS.** M6A mengikat Strategi ke Contract
--   (Rule 2, D-1 "Auto from Contract", n periode = n bulan kontrak). Yang ada
--   as-built hanyalah `services` (dipin ke versi MSL) dan `transactions` (uang).
--   Jadi Strategi diikat ke `service_id` — persis titik yang sudah digerbangi
--   M6C — dan durasi/jendela kontrak dideklarasi AM, mengikuti preseden yang
--   sudah diterima di `service_plan_gate.durasi_bulan` (M6C GA-2). Akibatnya
--   Rule 7 ("floor read-only, ditarik dari Contract") belum punya sumber
--   otoritatif: lihat `ck_strategi_target_floor_source` dan pertanyaan terbuka
--   **O57**.

-- ===========================================================================
-- 1. Parent — `strategi`
-- ===========================================================================
CREATE TABLE strategi (
    id                   varchar(32)   NOT NULL PRIMARY KEY,
    service_id           varchar(32)   NOT NULL,
    client_id            varchar(32)   NOT NULL,

    -- Rantai versi (Rule 13). `strategi_induk_id` menunjuk versi 1 (akar
    -- silsilah) supaya seluruh rantai bisa dibaca satu query; `versi_sebelumnya_id`
    -- menunjuk versi n-1 supaya diff J-4 punya pasangan yang pasti.
    versi_no             integer       NOT NULL DEFAULT 1,
    strategi_induk_id    varchar(32)   NULL,
    versi_sebelumnya_id  varchar(32)   NULL,

    status               varchar(32)   NOT NULL,

    -- Jendela kontrak. AM-declared (lihat deviasi CONTRACT di kepala berkas).
    durasi_kontrak_bulan integer       NOT NULL,
    tanggal_mulai_kontrak date         NOT NULL,
    tanggal_akhir_kontrak date         NOT NULL,

    -- G-0 / Rule 17: diset sekali, tidak bisa diubah setelah periode Plan
    -- pertama tutup. `siklus_terkunci` di-set M6B saat periode 1 `Ditutup`.
    tanggal_mulai_siklus date          NULL,
    siklus_terkunci      boolean       NOT NULL DEFAULT false,

    -- F-7 / D16: batas toleransi over-komitmen sebelum eskalasi SPV. Default 20%
    -- adalah keputusan terkunci, bukan tebakan.
    toleransi_over_persen numeric(5,2) NOT NULL DEFAULT 20,

    -- J-1 / J-2. Jejak lengkapnya di `strategi_version` + `audit_log`; ini
    -- hanya denormalisasi baca-cepat untuk header form.
    diajukan_pada        timestamptz   NULL,
    disetujui_pada       timestamptz   NULL,
    disetujui_oleh       varchar(64)   NULL,
    catatan_reviewer     text          NULL,

    created_at           timestamptz   NOT NULL DEFAULT now(),
    updated_at           timestamptz   NOT NULL DEFAULT now(),
    created_by           varchar(64)   NOT NULL,

    CONSTRAINT fk_strategi_service  FOREIGN KEY (service_id) REFERENCES services (id),
    CONSTRAINT fk_strategi_client   FOREIGN KEY (client_id)  REFERENCES clients (id),
    CONSTRAINT fk_strategi_induk    FOREIGN KEY (strategi_induk_id)   REFERENCES strategi (id),
    CONSTRAINT fk_strategi_prev     FOREIGN KEY (versi_sebelumnya_id) REFERENCES strategi (id),

    CONSTRAINT ck_strategi_versi CHECK (versi_no >= 1),
    -- Versi 1 tidak punya induk; versi >1 wajib punya. Tanpa ini sebuah revisi
    -- bisa lepas dari silsilahnya dan terlihat seperti Strategi baru.
    CONSTRAINT ck_strategi_lineage CHECK (
        (versi_no = 1 AND strategi_induk_id IS NULL AND versi_sebelumnya_id IS NULL)
     OR (versi_no > 1 AND strategi_induk_id IS NOT NULL AND versi_sebelumnya_id IS NOT NULL)),
    -- D2 menyebut kontrak 3/6/12 bulan sebagai MENU, bukan aturan validasi —
    -- dan tanpa entitas Contract tidak ada yang bisa menegakkan menu itu. Yang
    -- ditegakkan: durasi masuk akal, dan jendelanya konsisten dengan durasinya.
    CONSTRAINT ck_strategi_durasi CHECK (durasi_kontrak_bulan BETWEEN 1 AND 36),
    CONSTRAINT ck_strategi_jendela CHECK (tanggal_akhir_kontrak > tanggal_mulai_kontrak),
    CONSTRAINT ck_strategi_toleransi CHECK (toleransi_over_persen >= 0 AND toleransi_over_persen <= 100),
    -- Rule 17: siklus tidak bisa terkunci sebelum tanggalnya ada.
    CONSTRAINT ck_strategi_siklus CHECK (NOT siklus_terkunci OR tanggal_mulai_siklus IS NOT NULL)
);

-- Rule 2 — "exactly one active Strategi per Contract". Index parsial, bukan
-- UNIQUE(service_id): versi lama yang `Diarsipkan` dan revisi yang sedang
-- `Draft Revisi` harus boleh hidup berdampingan dengan yang `Aktif`.
CREATE UNIQUE INDEX uq_strategi_aktif_per_service ON strategi (service_id)
    WHERE status = 'Aktif';
-- Satu revisi berjalan pada satu waktu. Dua `Draft Revisi` paralel untuk service
-- yang sama berarti dua orang menulis versi n+1 dan salah satunya akan hilang.
CREATE UNIQUE INDEX uq_strategi_inflight_per_service ON strategi (service_id)
    WHERE status IN ('Draft', 'Diajukan', 'Draft Revisi');
CREATE UNIQUE INDEX uq_strategi_versi ON strategi (service_id, versi_no);
CREATE INDEX idx_strategi_client ON strategi (client_id);
CREATE INDEX idx_strategi_status ON strategi (status);

CREATE TRIGGER trg_strategi_updated_at BEFORE UPDATE ON strategi
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Rule 17 ditegakkan di DB, bukan hanya di TS: begitu periode Plan pertama
-- tutup, `tanggal_mulai_siklus` beku. Kalau ia bisa bergeser belakangan, setiap
-- batas periode Plan yang sudah berjalan ikut bergeser dan riwayat realisasi
-- membandingkan rentang yang berbeda-beda.
CREATE OR REPLACE FUNCTION guard_siklus_terkunci()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD.siklus_terkunci
       AND NEW.tanggal_mulai_siklus IS DISTINCT FROM OLD.tanggal_mulai_siklus THEN
        RAISE EXCEPTION '[tanggal mulai siklus tidak dapat diubah setelah periode Plan pertama ditutup]';
    END IF;
    -- Kunci sekali jalan: `siklus_terkunci` tidak pernah kembali ke false.
    IF OLD.siklus_terkunci AND NOT NEW.siklus_terkunci THEN
        RAISE EXCEPTION '[tanggal mulai siklus tidak dapat diubah setelah periode Plan pertama ditutup]';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_strategi_guard_siklus BEFORE UPDATE ON strategi
    FOR EACH ROW EXECUTE FUNCTION guard_siklus_terkunci();

COMMENT ON TABLE strategi IS
  'M6A — Strategi (Full Store Management). Satu versi = satu baris (Rule 13); '
  'yang Aktif dijaga index parsial uq_strategi_aktif_per_service (Rule 2). '
  'Status hanya lewat sm_transition, mesin #15.';
COMMENT ON COLUMN strategi.service_id IS
  'CDPS tidak punya entitas CONTRACT; Strategi diikat ke Service yang '
  'plan-gated (titik yang sama yang digerbangi M6C). Lihat DECISIONS O57.';

-- ===========================================================================
-- 2. Mesin status #15 — `strategi`
-- ===========================================================================
INSERT INTO sm_machines (name, initial_state, block_message, auto_computed, flags) VALUES
    ('strategi', 'Draft', '[transisi status Strategi tidak diizinkan]', false, '{}');

INSERT INTO sm_terminal_states (machine, state) VALUES
    ('strategi', 'Kedaluwarsa'),
    ('strategi', 'Diarsipkan');

-- `Diajukan → Draft` DAN `Diajukan → Draft Revisi` keduanya terdaftar: sebuah
-- pengembalian (Rule 12) harus mendarat di laci asalnya, dan `sm_edges` tidak
-- bisa melihat dari mana sebuah `Diajukan` datang. Domain yang memilih tujuan
-- berdasarkan `versi_no` (1 ⇒ Draft, >1 ⇒ Draft Revisi) — bukan menebak.
INSERT INTO sm_edges (machine, from_state, to_state, require_lead) VALUES
    ('strategi', 'Draft',        'Diajukan',    false),
    ('strategi', 'Draft Revisi', 'Diajukan',    false),
    ('strategi', 'Diajukan',     'Aktif',       true),
    ('strategi', 'Diajukan',     'Draft',       true),
    ('strategi', 'Diajukan',     'Draft Revisi', true),
    ('strategi', 'Aktif',        'Kedaluwarsa', false),
    ('strategi', 'Aktif',        'Diarsipkan',  false),
    -- Revisi yang dibatalkan sebelum diajukan tidak boleh mengunci
    -- uq_strategi_inflight_per_service selamanya.
    ('strategi', 'Draft Revisi', 'Diarsipkan',  false),
    ('strategi', 'Draft',        'Diarsipkan',  true);

-- ===========================================================================
-- 3. `strategi_channel` — Section B-0 (identitas channel + jendela baseline)
-- ===========================================================================
CREATE TABLE strategi_channel (
    id                     bigint       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    strategi_id            varchar(32)  NOT NULL,
    channel                varchar(32)  NOT NULL,   -- B-0.1 (D1)
    channel_lain           varchar(64)  NULL,
    status_channel         varchar(16)  NOT NULL,   -- B-0.2
    nama_toko              varchar(191) NOT NULL,   -- B-0.3
    url_toko               text         NOT NULL,
    umur_toko_bulan        integer      NULL,       -- B-0.4
    badge                  varchar(64)  NULL,

    -- B-0.5, wajib untuk channel `Belum Aktif` (Rule 4).
    target_tanggal_live    date         NULL,
    prasyarat_pembukaan    jsonb        NOT NULL DEFAULT '[]'::jsonb,

    -- B-0.6 — Rule 5: angka baseline WAJIB bersumber (lampiran + tanggal ambil).
    sumber_data            text         NULL,
    tanggal_ambil_data     date         NULL,
    lampiran               text         NULL,

    -- B-0.7 / Rule 5a — jendela dideklarasi AM, 1–6 bulan, default 3.
    periode_baseline_bulan integer      NULL,
    periode_mulai          date         NULL,
    periode_akhir          date         NULL,
    -- B-0.8 — jendela <3 bulan wajib beralasan.
    alasan_periode_pendek  varchar(48)  NULL,
    catatan_periode_pendek text         NULL,

    created_at             timestamptz  NOT NULL DEFAULT now(),
    updated_at             timestamptz  NOT NULL DEFAULT now(),
    created_by             varchar(64)  NOT NULL,

    CONSTRAINT fk_strch_strategi FOREIGN KEY (strategi_id) REFERENCES strategi (id) ON DELETE CASCADE,
    CONSTRAINT ck_strch_channel CHECK (
        channel IN ('Shopee', 'TikTok Shop', 'Tokopedia', 'Lazada', 'Website', 'Lainnya')),
    CONSTRAINT ck_strch_channel_lain CHECK (
        (channel = 'Lainnya') = (channel_lain IS NOT NULL AND btrim(channel_lain) <> '')),
    CONSTRAINT ck_strch_status CHECK (status_channel IN ('Eksisting', 'Belum Aktif')),
    CONSTRAINT ck_strch_toko CHECK (btrim(nama_toko) <> '' AND btrim(url_toko) <> ''),
    -- Rule 4: `Belum Aktif` melewati baseline historis TAPI tetap wajib rencana
    -- pembukaan. Tanpa tanggal live, channel itu tidak pernah masuk kalender G.
    CONSTRAINT ck_strch_belum_aktif CHECK (
        status_channel <> 'Belum Aktif' OR target_tanggal_live IS NOT NULL),
    -- Rule 5 + 5a: channel `Eksisting` wajib bawa jendela DAN sumbernya.
    -- Angka tanpa sumber adalah klaim, dan seluruh Section C berdiri di atasnya.
    CONSTRAINT ck_strch_eksisting CHECK (
        status_channel <> 'Eksisting'
     OR (periode_baseline_bulan IS NOT NULL
         AND periode_mulai IS NOT NULL AND periode_akhir IS NOT NULL
         AND sumber_data IS NOT NULL AND btrim(sumber_data) <> ''
         AND tanggal_ambil_data IS NOT NULL
         AND lampiran IS NOT NULL AND btrim(lampiran) <> '')),
    CONSTRAINT ck_strch_periode_range CHECK (
        periode_baseline_bulan IS NULL OR periode_baseline_bulan BETWEEN 1 AND 6),
    CONSTRAINT ck_strch_periode_tanggal CHECK (
        periode_mulai IS NULL OR periode_akhir IS NULL OR periode_akhir >= periode_mulai),
    -- Rule 5a: <3 bulan wajib alasan tertulis. Ini CHECK, bukan validasi TS
    -- saja, karena jendela pendek adalah cara termurah membuat baseline
    -- terlihat bagus.
    CONSTRAINT ck_strch_alasan_pendek CHECK (
        periode_baseline_bulan IS NULL OR periode_baseline_bulan >= 3
     OR (alasan_periode_pendek IS NOT NULL AND btrim(alasan_periode_pendek) <> '')),
    CONSTRAINT ck_strch_prasyarat_array CHECK (jsonb_typeof(prasyarat_pembukaan) = 'array')
);

-- D4: satu sub-blok per channel kontrak. Dua blok Shopee dalam satu Strategi
-- berarti dua baseline yang saling bertentangan.
CREATE UNIQUE INDEX uq_strch_channel ON strategi_channel
    (strategi_id, channel, coalesce(lower(btrim(channel_lain)), ''));

CREATE TRIGGER trg_strategi_channel_updated_at BEFORE UPDATE ON strategi_channel
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ===========================================================================
-- 4. `strategi_baseline_bulan` — B-1 & B-5 per bulan jendela baseline
-- ===========================================================================
-- Rule 5 hidup di sini: kolom angka NOT NULL TANPA default. `0` sah, blank
-- tidak — dan tanpa default, "blank" secara harfiah tidak bisa disimpan.
-- Sengaja TIDAK ada boolean `tidak_tersedia` per grup (§7): kalau datanya
-- benar-benar tidak ada, channel-nya ditandai `Belum Aktif`.
CREATE TABLE strategi_baseline_bulan (
    id             bigint        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    channel_id     bigint        NOT NULL,
    month_index    integer       NOT NULL,

    gmv            numeric(18,2) NOT NULL,   -- B-1.1
    jumlah_pesanan integer       NOT NULL,   -- B-1.2
    persen_batal   numeric(6,2)  NOT NULL,   -- B-1.4
    ad_spend       numeric(18,2) NOT NULL,   -- B-5.1
    roas           numeric(10,2) NOT NULL,   -- B-5.2
    acos           numeric(6,2)  NOT NULL,   -- B-5.2

    -- B-1.3 AOV = auto (GMV/order). Aturan rumah #4: field terhitung tidak
    -- pernah diketik. Aturan rumah #7: pembagian nol tidak error — ia NULL di
    -- sini dan dirender `—` di layar.
    aov            numeric(18,2) GENERATED ALWAYS AS (
                       CASE WHEN jumlah_pesanan > 0
                            THEN gmv / jumlah_pesanan END) STORED,

    created_at     timestamptz   NOT NULL DEFAULT now(),
    updated_at     timestamptz   NOT NULL DEFAULT now(),
    created_by     varchar(64)   NOT NULL,

    CONSTRAINT fk_strbl_channel FOREIGN KEY (channel_id)
        REFERENCES strategi_channel (id) ON DELETE CASCADE,
    CONSTRAINT uq_strbl_bulan UNIQUE (channel_id, month_index),
    CONSTRAINT ck_strbl_month CHECK (month_index BETWEEN 1 AND 6),
    CONSTRAINT ck_strbl_nonneg CHECK (
        gmv >= 0 AND jumlah_pesanan >= 0 AND ad_spend >= 0 AND roas >= 0),
    CONSTRAINT ck_strbl_persen CHECK (
        persen_batal >= 0 AND persen_batal <= 100 AND acos >= 0)
);

CREATE TRIGGER trg_strategi_baseline_updated_at BEFORE UPDATE ON strategi_baseline_bulan
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON COLUMN strategi_baseline_bulan.month_index IS
  'M-1..M-n dalam jendela B-0.7 (1–6, D11). Baris, bukan kolom m1/m2/m3 tetap.';

-- ===========================================================================
-- 5. `strategi_target` — D-1 (floor) + D-2/D-4 (stretch)
-- ===========================================================================
CREATE TABLE strategi_target (
    strategi_id   varchar(32)   NOT NULL,
    channel       varchar(32)   NOT NULL,
    month_index   integer       NOT NULL,
    metric        varchar(32)   NOT NULL,
    nilai_floor   numeric(18,2) NULL,     -- D-1, read-only (Rule 7)
    nilai_stretch numeric(18,2) NOT NULL, -- D-2 / D-4
    sumber_floor  varchar(16)   NULL,     -- lihat catatan O57 di bawah
    created_at    timestamptz   NOT NULL DEFAULT now(),
    updated_at    timestamptz   NOT NULL DEFAULT now(),
    created_by    varchar(64)   NOT NULL,

    CONSTRAINT pk_strategi_target PRIMARY KEY (strategi_id, channel, month_index, metric),
    CONSTRAINT fk_strtg_strategi FOREIGN KEY (strategi_id) REFERENCES strategi (id) ON DELETE CASCADE,
    CONSTRAINT ck_strtg_month CHECK (month_index BETWEEN 1 AND 36),
    CONSTRAINT ck_strtg_metric CHECK (metric IN (
        'gmv', 'pengunjung', 'cr', 'aov', 'roas_min', 'acos_maks',
        'sku_winner', 'affiliate_aktif', 'jam_live', 'jumlah_video')),
    -- §7 + Rule 7: stretch >= floor ditegakkan di level CHECK DB untuk metrik
    -- GMV. Ini penegak Rule 7 yang sesungguhnya — Sanggahan Target (D-7) boleh
    -- berargumen, tapi tidak boleh menurunkan angkanya.
    CONSTRAINT ck_strtg_stretch_gmv CHECK (
        metric <> 'gmv' OR (nilai_floor IS NOT NULL AND nilai_stretch >= nilai_floor)),
    -- Floor hanya bermakna untuk GMV (satu-satunya yang datang dari kontrak).
    CONSTRAINT ck_strtg_floor_gmv_only CHECK (metric = 'gmv' OR nilai_floor IS NULL),
    -- O57: tanpa entitas CONTRACT, asal floor harus DINYATAKAN, bukan
    -- diasumsikan. `kontrak` = ditarik dari record kontrak saat entitas itu ada;
    -- `input_am` = diketik AM dan karenanya BUKAN read-only sungguhan — laporan
    -- yang memakai floor wajib bisa membedakan keduanya.
    CONSTRAINT ck_strategi_target_floor_source CHECK (
        (nilai_floor IS NULL AND sumber_floor IS NULL)
     OR (nilai_floor IS NOT NULL AND sumber_floor IN ('kontrak', 'input_am'))),
    CONSTRAINT ck_strtg_nonneg CHECK (nilai_stretch >= 0 AND (nilai_floor IS NULL OR nilai_floor >= 0))
);

CREATE INDEX idx_strtg_metric ON strategi_target (strategi_id, metric);

CREATE TRIGGER trg_strategi_target_updated_at BEFORE UPDATE ON strategi_target
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ===========================================================================
-- 6. `strategi_assumption` — D-8 + D-9
-- ===========================================================================
CREATE TABLE strategi_assumption (
    id              bigint       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    strategi_id     varchar(32)  NOT NULL,
    -- Pegangan stabil untuk pemetaan D-9 dan untuk `asumsi_gugur` di J-3.
    -- Angka baris (id) tidak dipakai karena ia tidak ikut saat versi disalin ke
    -- revisi berikutnya.
    kode            varchar(16)  NOT NULL,
    asumsi          text         NOT NULL,
    pemilik         varchar(191) NOT NULL,  -- D-8: siapa yang harus memenuhinya
    cara_verifikasi text         NOT NULL,
    status          varchar(16)  NOT NULL DEFAULT 'Berlaku',
    -- D-9: target mana yang otomatis ditinjau kalau asumsi ini gugur. Array
    -- kunci target ("gmv:Shopee:3"), divalidasi di domain saat submit.
    target_terkait  jsonb        NOT NULL DEFAULT '[]'::jsonb,
    created_at      timestamptz  NOT NULL DEFAULT now(),
    updated_at      timestamptz  NOT NULL DEFAULT now(),
    created_by      varchar(64)  NOT NULL,

    CONSTRAINT fk_strasm_strategi FOREIGN KEY (strategi_id) REFERENCES strategi (id) ON DELETE CASCADE,
    CONSTRAINT uq_strasm_kode UNIQUE (strategi_id, kode),
    CONSTRAINT ck_strasm_status CHECK (status IN ('Berlaku', 'Gugur', 'Terverifikasi')),
    CONSTRAINT ck_strasm_isi CHECK (
        btrim(asumsi) <> '' AND btrim(pemilik) <> '' AND btrim(cara_verifikasi) <> ''),
    CONSTRAINT ck_strasm_target_array CHECK (jsonb_typeof(target_terkait) = 'array')
);

CREATE TRIGGER trg_strategi_assumption_updated_at BEFORE UPDATE ON strategi_assumption
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- `status` di sini adalah ATRIBUT baris anak, bukan siklus hidup entitas
-- ber-ID: ia tidak punya prefix, tidak punya ID rumah, dan tidak pernah
-- ditransisikan sendiri di layar. Perlakuannya sama dengan
-- `service_plan_gate.keputusan_am` (preseden M6C yang sudah diterima) — bukan
-- mesin `sm_transition`, tapi setiap perubahannya menulis `audit_log` lewat
-- domain. Jalur flip ke `Gugur` (dan event `strategi_revisi_disarankan` yang
-- menyertainya, masih terblokir O55) adalah tiket A-08.
COMMENT ON COLUMN strategi_assumption.status IS
  'M6A §7 — Berlaku/Gugur/Terverifikasi. Flip ke Gugur memicu '
  'strategi_revisi_disarankan (terblokir O55, katalog notifikasi v2).';

-- ===========================================================================
-- 7. `strategi_pillar` — Section E (arah eksekusi per pilar)
-- ===========================================================================
CREATE TABLE strategi_pillar (
    id                 bigint        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    strategi_id        varchar(32)   NOT NULL,
    jenis              varchar(24)   NOT NULL,
    channel            varchar(32)   NULL,        -- null = lintas channel
    urutan             integer       NOT NULL DEFAULT 0,  -- E-13 urutan eksekusi

    -- E-3: peran SKU. `sku` juga kunci floor price E-4.
    sku                varchar(191)  NULL,
    peran              varchar(24)   NULL,
    aksi               text          NOT NULL DEFAULT '',
    target             text          NOT NULL DEFAULT '',

    -- E-4: harga & guardrail margin. `floor_price` dibaca validasi Brief
    -- (Rule 11 `Di Bawah Floor`).
    harga_normal       numeric(15,2) NULL,
    harga_promo        numeric(15,2) NULL,
    floor_price        numeric(15,2) NULL,

    -- E-8 (D15/Rule 18): live = mode vendor.
    vendor_id          varchar(32)   NULL,
    slot_jam           numeric(8,2)  NULL,
    tarif              numeric(15,2) NULL,
    target_gmv_per_jam numeric(18,2) NULL,

    -- Sisa field per pilar (E-5 fase/ACOS, E-6 pilar konten, E-7 tier kreator)
    -- menyusul di A-09; `detail` menampung yang belum berkolom sendiri supaya
    -- bentuk barisnya tidak berubah tiap tiket.
    detail             jsonb         NOT NULL DEFAULT '{}'::jsonb,

    created_at         timestamptz   NOT NULL DEFAULT now(),
    updated_at         timestamptz   NOT NULL DEFAULT now(),
    created_by         varchar(64)   NOT NULL,

    CONSTRAINT fk_strpil_strategi FOREIGN KEY (strategi_id) REFERENCES strategi (id) ON DELETE CASCADE,
    CONSTRAINT fk_strpil_vendor   FOREIGN KEY (vendor_id)   REFERENCES vendors (id),
    CONSTRAINT ck_strpil_jenis CHECK (jenis IN (
        'sku', 'harga', 'iklan', 'konten', 'affiliate', 'live', 'retensi',
        'operasional', 'tidak_dikerjakan')),
    CONSTRAINT ck_strpil_peran CHECK (peran IS NULL OR peran IN (
        'hero', 'pendamping', 'bundling', 'baru', 'dimatikan')),
    -- Rule 18: vendor hanya milik pilar `live`. Ini yang menjaga jam vendor
    -- tidak pernah tercampur ke beban divisi internal (F-5).
    CONSTRAINT ck_strpil_vendor_live CHECK (vendor_id IS NULL OR jenis = 'live'),
    CONSTRAINT ck_strpil_live_fields CHECK (
        jenis = 'live' OR (slot_jam IS NULL AND target_gmv_per_jam IS NULL)),
    -- E-4: floor price adalah guardrail PER hero SKU — floor tanpa SKU tidak
    -- bisa dibandingkan oleh validasi Brief mana pun.
    CONSTRAINT ck_strpil_floor_sku CHECK (
        floor_price IS NULL OR (jenis = 'harga' AND sku IS NOT NULL AND btrim(sku) <> '')),
    -- Rule 11 pada level Strategi sendiri: sebuah Strategi tidak boleh
    -- mengusulkan harga promo di bawah floor-nya sendiri.
    CONSTRAINT ck_strpil_promo_floor CHECK (
        harga_promo IS NULL OR floor_price IS NULL OR harga_promo >= floor_price),
    CONSTRAINT ck_strpil_harga_nonneg CHECK (
        (harga_normal IS NULL OR harga_normal >= 0)
    AND (harga_promo  IS NULL OR harga_promo  >= 0)
    AND (floor_price  IS NULL OR floor_price  >= 0)),
    CONSTRAINT ck_strpil_detail_obj CHECK (jsonb_typeof(detail) = 'object')
);

CREATE INDEX idx_strpil_strategi ON strategi_pillar (strategi_id, jenis);
CREATE INDEX idx_strpil_vendor ON strategi_pillar (vendor_id) WHERE vendor_id IS NOT NULL;

CREATE TRIGGER trg_strategi_pillar_updated_at BEFORE UPDATE ON strategi_pillar
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON COLUMN strategi_pillar.floor_price IS
  'M6A E-4 / Rule 11 — guardrail margin per hero SKU. Dibaca validasi Brief; '
  'Brief di bawah angka ini ditandai Di Bawah Floor + butuh ack SPV.';

-- ===========================================================================
-- 8. `strategi_resource` — Section F (komitmen resource, SOFT — Rule 10)
-- ===========================================================================
CREATE TABLE strategi_resource (
    id           bigint        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    strategi_id  varchar(32)   NOT NULL,
    jenis        varchar(24)   NOT NULL,
    channel      varchar(32)   NULL,
    divisi       varchar(48)   NULL,        -- F-5
    nilai        numeric(18,2) NULL,        -- Rp (F-1, sampel F-3)
    jumlah       numeric(12,2) NULL,        -- kuantitas (F-2/F-3/F-4)
    satuan       varchar(24)   NULL,
    sumber_dana  varchar(16)   NULL,        -- F-1
    vendor_id    varchar(32)   NULL,        -- F-4
    skema_biaya  varchar(16)   NULL,        -- F-4
    catatan      text          NOT NULL DEFAULT '',
    created_at   timestamptz   NOT NULL DEFAULT now(),
    updated_at   timestamptz   NOT NULL DEFAULT now(),
    created_by   varchar(64)   NOT NULL,

    CONSTRAINT fk_strres_strategi FOREIGN KEY (strategi_id) REFERENCES strategi (id) ON DELETE CASCADE,
    CONSTRAINT fk_strres_vendor   FOREIGN KEY (vendor_id)   REFERENCES vendors (id),
    CONSTRAINT ck_strres_jenis CHECK (jenis IN (
        'budget_iklan', 'konten', 'kol', 'live_vendor', 'divisi', 'tools')),
    CONSTRAINT ck_strres_sumber CHECK (
        sumber_dana IS NULL OR sumber_dana IN ('klien', 'paket_mea')),
    -- F-1 tanpa sumber dana tidak bisa dipakai Finance (penerima notifikasi
    -- `strategi_disetujui` justru karena angka ini).
    CONSTRAINT ck_strres_budget_sumber CHECK (
        jenis <> 'budget_iklan' OR (nilai IS NOT NULL AND sumber_dana IS NOT NULL)),
    -- Rule 18 lagi, sisi resource: jam live milik vendor, baris `divisi` tidak
    -- pernah membawa vendor.
    CONSTRAINT ck_strres_vendor_only_live CHECK (vendor_id IS NULL OR jenis = 'live_vendor'),
    CONSTRAINT ck_strres_divisi CHECK (jenis <> 'divisi' OR (divisi IS NOT NULL AND btrim(divisi) <> '')),
    CONSTRAINT ck_strres_skema CHECK (
        skema_biaya IS NULL OR skema_biaya IN ('per_jam', 'per_sesi', 'bagi_hasil', 'retainer')),
    CONSTRAINT ck_strres_nonneg CHECK (
        (nilai IS NULL OR nilai >= 0) AND (jumlah IS NULL OR jumlah >= 0))
);

CREATE INDEX idx_strres_strategi ON strategi_resource (strategi_id, jenis);

CREATE TRIGGER trg_strategi_resource_updated_at BEFORE UPDATE ON strategi_resource
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ===========================================================================
-- 9. `strategi_risk` — H-1 risk register
-- ===========================================================================
CREATE TABLE strategi_risk (
    id          bigint       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    strategi_id varchar(32)  NOT NULL,
    risiko      text         NOT NULL,
    dampak      varchar(16)  NOT NULL,
    kemungkinan varchar(16)  NOT NULL,
    mitigasi    text         NOT NULL,
    pic         varchar(191) NOT NULL,
    urutan      integer      NOT NULL DEFAULT 0,
    created_at  timestamptz  NOT NULL DEFAULT now(),
    updated_at  timestamptz  NOT NULL DEFAULT now(),
    created_by  varchar(64)  NOT NULL,

    CONSTRAINT fk_strrisk_strategi FOREIGN KEY (strategi_id) REFERENCES strategi (id) ON DELETE CASCADE,
    CONSTRAINT ck_strrisk_dampak CHECK (dampak IN ('rendah', 'sedang', 'tinggi')),
    CONSTRAINT ck_strrisk_kemungkinan CHECK (kemungkinan IN ('rendah', 'sedang', 'tinggi')),
    CONSTRAINT ck_strrisk_isi CHECK (
        btrim(risiko) <> '' AND btrim(mitigasi) <> '' AND btrim(pic) <> '')
);

CREATE INDEX idx_strrisk_strategi ON strategi_risk (strategi_id);

CREATE TRIGGER trg_strategi_risk_updated_at BEFORE UPDATE ON strategi_risk
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ===========================================================================
-- 10. `strategi_version` — Section J, APPEND-ONLY
-- ===========================================================================
-- Satu baris per PERISTIWA, bukan per versi: versi yang sama bisa diajukan,
-- dikembalikan, lalu diajukan lagi (Rule 12 "keeps its version number"), dan
-- satu baris per versi akan menimpa ronde sebelumnya — persis riwayat yang
-- dipakai metrik "return rate per AM" (§9).
CREATE TABLE strategi_version (
    id             bigint       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    strategi_id    varchar(32)  NOT NULL,
    versi_no       integer      NOT NULL,
    peristiwa      varchar(24)  NOT NULL,
    aktor          varchar(64)  NOT NULL,
    catatan        text         NULL,          -- J-2 catatan reviewer
    -- J-3: wajib saat membuka revisi (Rule 13 a/b/c).
    trigger_revisi jsonb        NOT NULL DEFAULT '[]'::jsonb,
    alasan_revisi  text         NULL,
    asumsi_gugur   jsonb        NOT NULL DEFAULT '[]'::jsonb,
    created_at     timestamptz  NOT NULL DEFAULT now(),
    created_by     varchar(64)  NOT NULL,

    CONSTRAINT fk_strver_strategi FOREIGN KEY (strategi_id) REFERENCES strategi (id) ON DELETE CASCADE,
    CONSTRAINT ck_strver_peristiwa CHECK (peristiwa IN (
        'dibuat', 'diajukan', 'disetujui', 'dikembalikan', 'revisi_dibuka',
        'kedaluwarsa', 'diarsipkan')),
    CONSTRAINT ck_strver_array CHECK (
        jsonb_typeof(trigger_revisi) = 'array' AND jsonb_typeof(asumsi_gugur) = 'array'),
    -- Rule 13: membuka revisi wajib membawa trigger (dari H-2) + alasan +
    -- asumsi mana yang gugur. Metrik §9 "% revisions with a declared trigger +
    -- broken assumption" target 100% — jadi ini CHECK, bukan imbauan.
    CONSTRAINT ck_strver_revisi_lengkap CHECK (
        peristiwa <> 'revisi_dibuka'
     OR (jsonb_array_length(trigger_revisi) > 0
         AND alasan_revisi IS NOT NULL AND btrim(alasan_revisi) <> ''
         AND jsonb_array_length(asumsi_gugur) > 0)),
    -- Rule 12: pengembalian wajib bercatatan tertulis.
    CONSTRAINT ck_strver_dikembalikan CHECK (
        peristiwa <> 'dikembalikan' OR (catatan IS NOT NULL AND btrim(catatan) <> ''))
);

CREATE INDEX idx_strver_strategi ON strategi_version (strategi_id, versi_no);

-- Aturan rumah #3: tidak ada jalur UPDATE/DELETE untuk baris riwayat.
CREATE TRIGGER trg_strategi_version_no_update BEFORE UPDATE ON strategi_version
    FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER trg_strategi_version_no_delete BEFORE DELETE ON strategi_version
    FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

COMMENT ON TABLE strategi_version IS
  'M6A Section J — append-only. Data FORM J-3 (trigger H-2, alasan revisi, '
  'asumsi D-8 yang gugur), bukan duplikat audit_log: metrik §9 harus bisa '
  'mem-query dan CHECK harus bisa memvalidasinya.';

-- ===========================================================================
-- 11. RLS — semua tabel dibuat SETELAH 20260723064438_rls_baseline, jadi loop
--     grant di sana tidak menyentuhnya.
-- ===========================================================================
-- Peta izin M6A §7: AM pemilik baca/tulis milik kliennya; SPV/Head Account baca
-- semua + approve; divisi eksekusi baca E/F/G/I-4 untuk pilar mereka; Finance
-- baca F-1; Direksi baca semua.
--
-- Yang bisa ditegakkan sebagai ROW-scope di sini adalah dua arm pertama plus
-- baca-semua. Pembatasan PER SECTION (divisi eksekusi hanya E/F/G/I-4, Finance
-- hanya F-1) adalah scope KOLOM/tabel, bukan baris: `strategi_resource` (F) dan
-- `strategi_pillar` (E) memang terbuka untuk lead divisi karena itulah bagian
-- yang §7 berikan kepada mereka, sementara parent `strategi` — yang memuat
-- Section A/C/D dan catatan reviewer — tidak.
--
-- Overlay visibilitas klien (Rule 16) BUKAN pekerjaan RLS ini: klien tidak
-- pernah punya sesi `authenticated` di realm internal. Ia dilayani tautan
-- ber-token /s/{token} (A-11) dengan filter diterapkan SEBELUM serialisasi.
REVOKE ALL ON public.strategi FROM anon;
REVOKE ALL ON public.strategi FROM authenticated;
GRANT SELECT ON public.strategi TO authenticated;
ALTER TABLE public.strategi ENABLE ROW LEVEL SECURITY;
CREATE POLICY strategi_select ON public.strategi FOR SELECT TO authenticated
USING (jwt_can_read_all()
       OR jwt_employee_id() IN (created_by, disetujui_oleh)
       OR private.jwt_is_am_of_service(service_id)
       OR (jwt_is_lead() AND jwt_division() = 'Account'));

-- Anak-anak mewarisi scope induknya lewat EXISTS ke `strategi`. Menyalin
-- predikat induk ke tiap anak akan melahirkan lima salinan yang bisa menyimpang;
-- EXISTS membuat induk tetap satu-satunya tempat aturannya ditulis.
CREATE OR REPLACE FUNCTION private.jwt_can_read_strategi(p_strategi_id text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS
$$
  SELECT EXISTS (
    SELECT 1 FROM public.strategi s
     WHERE s.id = p_strategi_id
       AND (public.jwt_can_read_all()
            OR public.jwt_employee_id() IN (s.created_by, s.disetujui_oleh)
            OR private.jwt_is_am_of_service(s.service_id)
            OR (public.jwt_is_lead() AND public.jwt_division() = 'Account'))
  )
$$;
REVOKE EXECUTE ON FUNCTION private.jwt_can_read_strategi(text) FROM anon;

DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'strategi_channel', 'strategi_target', 'strategi_assumption',
        'strategi_risk', 'strategi_version'
    ] LOOP
        EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
        EXECUTE format('REVOKE ALL ON public.%I FROM authenticated', t);
        EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated '
            'USING (private.jwt_can_read_strategi(strategi_id))', t || '_select', t);
    END LOOP;
END;
$$;

-- Baseline bulanan menggantung di channel, bukan langsung di Strategi.
REVOKE ALL ON public.strategi_baseline_bulan FROM anon;
REVOKE ALL ON public.strategi_baseline_bulan FROM authenticated;
GRANT SELECT ON public.strategi_baseline_bulan TO authenticated;
ALTER TABLE public.strategi_baseline_bulan ENABLE ROW LEVEL SECURITY;
CREATE POLICY strategi_baseline_bulan_select ON public.strategi_baseline_bulan
FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.strategi_channel c
                WHERE c.id = strategi_baseline_bulan.channel_id
                  AND private.jwt_can_read_strategi(c.strategi_id)));

-- E dan F: tambah arm lead divisi eksekusi (§7 "read-only: E, F, G, I-4 for
-- their own pillar"). Tanpa arm ini seorang lead Creative tidak bisa melihat
-- pilar konten yang Brief-nya justru diturunkan dari sana.
REVOKE ALL ON public.strategi_pillar FROM anon;
REVOKE ALL ON public.strategi_pillar FROM authenticated;
GRANT SELECT ON public.strategi_pillar TO authenticated;
ALTER TABLE public.strategi_pillar ENABLE ROW LEVEL SECURITY;
CREATE POLICY strategi_pillar_select ON public.strategi_pillar FOR SELECT TO authenticated
USING (private.jwt_can_read_strategi(strategi_id) OR jwt_is_lead());

REVOKE ALL ON public.strategi_resource FROM anon;
REVOKE ALL ON public.strategi_resource FROM authenticated;
GRANT SELECT ON public.strategi_resource TO authenticated;
ALTER TABLE public.strategi_resource ENABLE ROW LEVEL SECURITY;
CREATE POLICY strategi_resource_select ON public.strategi_resource FOR SELECT TO authenticated
USING (private.jwt_can_read_strategi(strategi_id) OR jwt_is_lead());
