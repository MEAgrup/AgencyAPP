-- CDPS — Module 6B / backlog B-01: entitas `PLAN-` (periode Plan) + enam tabel
-- anaknya + mesin status #16.
--
-- Ini adalah KERANGKA, sama peran dengan A-03/A-04 untuk Strategi: yang dibangun
-- di sini adalah BENTUK yang aturan-aturan M6B butuhkan supaya bisa ditegakkan di
-- DB, plus mesin statusnya. Perilaku menempel di atas tabel-tabel ini di tiket
-- lanjutannya, bukan menggantinya.
--
-- ===========================================================================
-- Apa yang ADA di sini, dan apa yang SENGAJA menyusul
-- ===========================================================================
-- ADA (B-01): mesin #16 (state + edge, data — bukan gerbangnya);
--   tabel `plan` + `plan_target`/`plan_row`/`plan_row_week`/`plan_actual`/
--   `plan_review`/`plan_flag`; RLS; penjaga immutability `nilai_strategi`.
--
-- MENYUSUL, di tiketnya masing-masing — supaya B-01 tetap satu PR yang bisa
-- ditinjau dan tidak menulis dua versi satu aturan:
--   * B-02 generasi periode (anniversary-month; day-of-month yang DIMAKSUD
--     disimpan terpisah). Tidak ada jalur `createPlan` di B-01 — Rule 1: periode
--     HANYA lahir saat Strategi disetujui, bukan dibuat manual.
--   * B-03 GERBANG transisi mesin #16 di domain: periode 1 butuh SPV, 2..n
--     auto 00:00 WIB, `Menunggu Persetujuan` hanya untuk `Turun >10%`. Mesinnya
--     (edge) didaftarkan di sini; SIAPA & KAPAN-nya B-03.
--   * B-04 penyesuaian target asimetris (Rule 9) + `defisit_terbawa` (dihitung
--     di level KONTRAK, bukan kolom di sini) — mengisi `arah`/`persen_perubahan`/
--     `status_persetujuan` di `plan_target`.
--   * B-05 trigger Σ kuota mingguan = `plan_row.kuota` (tolak dengan row-ID +
--     delta). Kolom `plan_row_week` ada di sini; TRIGGER-nya B-05.
--   * B-06 realisasi hybrid: metrik `otomatis` UPDATE-blocked untuk role AM di
--     DB + RLS (invariant beku, TS & RLS tidak boleh menyimpang). Kolom
--     `plan_actual` ada; penjaga role-nya B-06.
--   * B-07 penutupan transaksional, B-08 carry-over eksplisit, B-09 scheduled
--     jobs.
--   * B-10 Plan Satuan + mesin #17 (`Aktif ⇄ Dorman`) + kolom `status_dormansi`
--     + B-11 index integritas §4(b). `lingkup` sudah 'kontrak'|'klien' dan
--     `strategi_id` sudah nullable di sini supaya B-10 tak perlu migrasi kolom,
--     TAPI `status_dormansi` TIDAK dibuat di sini: ia sebuah status, dan aturan
--     rumah #2 melarang kolom status tanpa mesin di STATE_MACHINES.md. Mesin #17
--     adalah rancangan B-10 (dorman itu properti RANTAI periode, bukan satu
--     periode) — persis alasan `contracts` menolak mendaftar mesin kosong.
--     Dicatat di docs/DECISIONS.md 2026-08-10.
--   * Enam event notifikasi Plan (§8) — katalog notifikasi adalah invariant
--     beku; amandemennya butuh tanda tangan Hans (PA-8/O55) dan digarap saat
--     event-nya benar-benar diemisikan (B-03…B-09), bukan didaftar kosong.
--
-- ===========================================================================
-- Empat keputusan bentuk, dan kenapa
-- ===========================================================================
-- (1) **`PLAN` = satu PERIODE, bukan satu kontrak** (§8 "PLAN-YYYY-NNNNN
--     (period)"). Kontrak n bulan ⇒ n baris `plan`. `defisit_terbawa` karenanya
--     BUKAN kolom di sini melainkan agregat lintas-periode di level kontrak
--     (B-04) — menaruhnya per baris melahirkan n salinan satu angka.
--
-- (2) **`lingkup` menyatukan dua rasa Plan dalam satu tabel** (M6C §7). Full
--     Management: `lingkup='kontrak'`, `contract_id` + `strategi_id` wajib.
--     Plan Satuan: `lingkup='klien'`, `contract_id` NULL, `strategi_id` NULL
--     (Plan Satuan tak punya Strategi — M6C §7.9). CHECK menegakkan pasangan itu
--     supaya baris hibrida (kontrak tanpa strategi, klien dengan kontrak) tidak
--     bisa disimpan.
--
-- (3) **`nilai_strategi` di `plan_target` immutable** (§8). Ia jangkar PE-5
--     ("variance vs target ASLI") — satu-satunya angka yang tidak bisa diedit
--     pihak yang diukur. Ditegakkan trigger, bukan hanya konvensi: kalau bisa
--     di-UPDATE, seluruh guardrail §3 (AM tidak boleh mengedit ukurannya
--     sendiri) bocor lewat pintu belakang. `nilai_dipakai` boleh berubah — itu
--     memang yang Rule 9 atur.
--
-- (4) **`plan_target`/`plan_actual` ber-metric dari kosakata D-4 yang SAMA**
--     dengan `strategi_target` (ck_strtg_metric). Target Plan ditarik dari D-2/
--     D-4 (§8/Rule 8), jadi kalau kosakatanya beda, "tarik dari Strategi" jadi
--     pemetaan diam-diam yang bisa salah. Set-nya disalin harfiah, bukan
--     direferensikan — CHECK tak boleh ber-subquery.
--
-- ===========================================================================
-- Deviasi yang dicatat (docs/DECISIONS.md 2026-08-10)
-- ===========================================================================
-- * Format ID `PLAN-YYYYMM-NNNN`, bukan `PLAN-YYYY-NNNNN` seperti PRD §8 —
--   CLAUDE.md #1 dan `ident_next` hanya bisa bentuk itu (preseden STRG/CTR).
-- * `status_dormansi` ditunda ke B-10 (lihat di atas).

-- ===========================================================================
-- 1. Prefix `PLAN` — SUDAH terdaftar di registry (20260806060000_entity_prefix_
--    registry.sql, bersama STRG/VND). §8 "Register PLAN in entity_prefix" sudah
--    dipenuhi di sana; mengulanginya di sini melanggar PK-nya. Jadi
--    entity_prefix tetap 31 baris — TIDAK ada perubahan gate prefix.
-- ===========================================================================

-- ===========================================================================
-- 2. Mesin status #16 — `plan`
-- ===========================================================================
-- State = daftar PA-5 (tujuh). `Disetujui`/`Dikembalikan` di §8 BUKAN state —
-- itu cara §8 menuliskan aksi "SPV setuju ⇒ Aktif" / "SPV kembalikan ⇒ Draft"
-- (PA-5 tidak memuat keduanya). Edge auto (`Terjadwal → Aktif`) TIDAK
-- require_lead: aktivasi periode 2..n dijalankan job service-role 00:00 WIB
-- (B-09), bukan seorang lead. `Diajukan → Aktif` / `→ Draft` require_lead
-- (persetujuan periode 1, Rule 3). SIAPA yang boleh menekan tombol mana, dan
-- KAPAN sebuah `Terjadwal` boleh auto vs harus lewat `Menunggu Persetujuan`,
-- adalah gerbang domain B-03 — edge di sini hanya menyatakan transisi MANA yang
-- sah, bukan menggantikan gerbang itu.
INSERT INTO sm_machines (name, initial_state, block_message, auto_computed, flags) VALUES
    ('plan', 'Terjadwal', '[transisi status periode Plan tidak diizinkan]', false, '{}');

INSERT INTO sm_terminal_states (machine, state) VALUES
    ('plan', 'Ditutup'),
    ('plan', 'Ditutup Otomatis');

INSERT INTO sm_edges (machine, from_state, to_state, require_lead) VALUES
    -- Periode 1: laci Draft → ajukan → SPV.
    ('plan', 'Terjadwal',            'Draft',                false),
    ('plan', 'Draft',                'Diajukan',             false),
    ('plan', 'Diajukan',             'Aktif',                true),
    ('plan', 'Diajukan',             'Draft',                true),
    -- Periode 2..n: auto (job), kecuali tertahan Turun >10%.
    ('plan', 'Terjadwal',            'Aktif',                false),
    ('plan', 'Terjadwal',            'Menunggu Persetujuan', false),
    ('plan', 'Menunggu Persetujuan', 'Aktif',                false),
    -- Penutupan: oleh AM, atau paksa oleh sistem.
    ('plan', 'Aktif',                'Ditutup',              false),
    ('plan', 'Aktif',                'Ditutup Otomatis',     false);

-- ===========================================================================
-- 3. `plan` — periode (Section P-A header + lingkup)
-- ===========================================================================
CREATE TABLE plan (
    id             varchar(32)  NOT NULL PRIMARY KEY,

    -- (2): dua rasa Plan, satu tabel.
    lingkup        varchar(16)  NOT NULL,
    contract_id    varchar(32)  NULL,   -- full-mgmt saja
    client_id      varchar(32)  NOT NULL,
    -- PA-2: versi Strategi yang berlaku untuk periode ini. NULL untuk Plan
    -- Satuan (M6C §7.9). Menunjuk BARIS versi (Rule 13), bukan silsilahnya.
    strategi_id    varchar(32)  NULL,

    periode_no     integer      NOT NULL,   -- PA-1 (1..n)
    tanggal_mulai  date         NOT NULL,   -- PA-1
    tanggal_akhir  date         NOT NULL,
    jumlah_minggu  integer      NOT NULL,   -- PA-1

    status         varchar(32)  NOT NULL,   -- mesin #16 (HANYA lewat sm_transition)

    catatan_pembuka text        NULL,       -- PA-7 (W saat submit; NULL-able utk autosave)

    created_at     timestamptz  NOT NULL DEFAULT now(),
    updated_at     timestamptz  NOT NULL DEFAULT now(),
    created_by     varchar(64)  NOT NULL,

    CONSTRAINT fk_plan_client   FOREIGN KEY (client_id)   REFERENCES clients (id),
    -- FK komposit ke contracts(id, client_id): sebuah periode tidak bisa
    -- menggantung di kontrak klien lain (preseden services/strategi O57).
    -- MATCH SIMPLE ⇒ tidak diperiksa saat contract_id NULL (Plan Satuan sah).
    -- ON DELETE CASCADE: sebuah periode tidak bisa hidup tanpa kontrak/versi
    -- Strategi induknya. Di produksi keduanya tak pernah di-DELETE (transisi
    -- status, bukan hapus), jadi cascade ini jaring pengaman + kebersihan test.
    CONSTRAINT fk_plan_contract FOREIGN KEY (contract_id, client_id)
        REFERENCES contracts (id, client_id) ON DELETE CASCADE,
    CONSTRAINT fk_plan_strategi FOREIGN KEY (strategi_id)
        REFERENCES strategi (id) ON DELETE CASCADE,

    CONSTRAINT ck_plan_lingkup CHECK (lingkup IN ('kontrak', 'klien')),
    -- (2): pasangan lingkup ↔ contract/strategi ditegakkan, bukan diandalkan
    -- pada disiplin penulis. Kontrak wajib punya kontrak & strategi; Plan Satuan
    -- tak boleh punya kontrak (strategi-nya dibiarkan NULL oleh M6C §7.9,
    -- dilonggarkan di sini karena B-10 belum menegakkan bentuk lainnya).
    CONSTRAINT ck_plan_lingkup_shape CHECK (
        (lingkup = 'kontrak' AND contract_id IS NOT NULL AND strategi_id IS NOT NULL)
     OR (lingkup = 'klien'   AND contract_id IS NULL)),
    CONSTRAINT ck_plan_periode_no CHECK (periode_no >= 1),
    -- Sebulan kalender selalu 4–6 pekan; PD-4 minggu terakhir menyerap 8–10
    -- hari, bukan menambah pekan stub.
    CONSTRAINT ck_plan_jumlah_minggu CHECK (jumlah_minggu BETWEEN 4 AND 6),
    CONSTRAINT ck_plan_jendela CHECK (tanggal_akhir > tanggal_mulai)
);

-- Nomor periode unik per rantai (kontrak untuk full-mgmt, klien untuk Satuan).
CREATE UNIQUE INDEX uq_plan_periode_kontrak ON plan (contract_id, periode_no)
    WHERE lingkup = 'kontrak';
CREATE UNIQUE INDEX uq_plan_periode_klien   ON plan (client_id, periode_no)
    WHERE lingkup = 'klien';

-- Rule 5: hanya satu periode `Aktif` pada satu waktu — per rantai. Ditegakkan
-- index parsial, bukan kode: dua periode `Aktif` berdampingan adalah keadaan
-- yang seluruh metrik variance-nya jadi ambigu.
CREATE UNIQUE INDEX uq_plan_aktif_kontrak ON plan (contract_id)
    WHERE status = 'Aktif' AND lingkup = 'kontrak';
CREATE UNIQUE INDEX uq_plan_aktif_klien   ON plan (client_id)
    WHERE status = 'Aktif' AND lingkup = 'klien';

CREATE INDEX idx_plan_contract ON plan (contract_id);
CREATE INDEX idx_plan_client   ON plan (client_id);
CREATE INDEX idx_plan_strategi ON plan (strategi_id);

CREATE TRIGGER trg_plan_updated_at BEFORE UPDATE ON plan
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE plan IS
  'M6B — satu PERIODE Plan (PLAN-). n periode = durasi kontrak (§7). lingkup '
  'kontrak (full-mgmt, Strategi-parented) atau klien (Plan Satuan, M6C §7). '
  'Status lewat mesin #16 saja.';
COMMENT ON COLUMN plan.strategi_id IS
  'PA-2 — versi Strategi (BARIS, Rule 13) yang berlaku untuk periode ini. NULL '
  'untuk Plan Satuan (M6C §7.9: tanpa Strategi).';

-- ===========================================================================
-- 4. `plan_target` — Section P-B (per channel per metric)
-- ===========================================================================
CREATE TABLE plan_target (
    plan_id            varchar(32)   NOT NULL,
    channel            varchar(32)   NOT NULL,
    metric             varchar(32)   NOT NULL,

    -- PB-1: ditarik dari Strategi D-2/D-4, IMMUTABLE (3). Jangkar PE-5.
    nilai_strategi     numeric(18,2) NOT NULL,
    -- PB-2: angka yang AM pakai untuk periode ini.
    nilai_dipakai      numeric(18,2) NOT NULL,

    -- PB-3/PB-4/PB-5/PH-3: arah & jejak penyesuaian. DIHITUNG dari
    -- nilai_dipakai vs nilai_strategi (Rule 9) — B-04 yang mengisinya; di sini
    -- default 'tetap'/0 supaya baris hasil generasi B-02 (belum disesuaikan)
    -- valid apa adanya.
    arah               varchar(8)    NOT NULL DEFAULT 'tetap',
    persen_perubahan   numeric(6,2)  NOT NULL DEFAULT 0,
    alasan             text          NULL,   -- PB-4 (W saat turun)
    bukti_file         text          NULL,   -- PB-5 (W saat turun >10%)
    status_persetujuan varchar(24)   NULL,   -- PH-3 (turun >10% → SPV)

    created_at         timestamptz   NOT NULL DEFAULT now(),
    updated_at         timestamptz   NOT NULL DEFAULT now(),
    created_by         varchar(64)   NOT NULL,

    CONSTRAINT pk_plan_target PRIMARY KEY (plan_id, channel, metric),
    CONSTRAINT fk_plan_target_plan FOREIGN KEY (plan_id)
        REFERENCES plan (id) ON DELETE CASCADE,
    -- (4): kosakata metrik D-4, disalin harfiah dari ck_strtg_metric.
    CONSTRAINT ck_plan_target_metric CHECK (metric IN (
        'gmv', 'pengunjung', 'cr', 'aov', 'roas_min', 'acos_maks',
        'sku_winner', 'affiliate_aktif', 'jam_live', 'jumlah_video')),
    CONSTRAINT ck_plan_target_arah CHECK (arah IN ('naik', 'turun', 'tetap')),
    -- §8: alasan WAJIB saat arah turun. Penurunan tanpa alasan persis lubang
    -- §3 (re-baseline diam-diam) yang guardrail ini ada untuk menutup.
    CONSTRAINT ck_plan_target_alasan_turun CHECK (
        arah <> 'turun' OR (alasan IS NOT NULL AND btrim(alasan) <> '')),
    CONSTRAINT ck_plan_target_nonneg CHECK (
        nilai_strategi >= 0 AND nilai_dipakai >= 0),
    -- arah & besarannya tidak boleh saling membantah dengan angkanya. Penegak
    -- akhir ada di B-04 (recompute-from-log); ini jaring pertama.
    CONSTRAINT ck_plan_target_arah_konsisten CHECK (
        (arah = 'tetap' AND nilai_dipakai = nilai_strategi)
     OR (arah = 'naik'  AND nilai_dipakai > nilai_strategi)
     OR (arah = 'turun' AND nilai_dipakai < nilai_strategi))
);

CREATE INDEX idx_plan_target_metric ON plan_target (plan_id, metric);

CREATE TRIGGER trg_plan_target_updated_at BEFORE UPDATE ON plan_target
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- (3) — `nilai_strategi` beku. Bukan hanya konvensi TS: panggilan service-role
-- pun tidak bisa menurunkan jangkar PE-5 diam-diam.
CREATE OR REPLACE FUNCTION guard_plan_target_nilai_strategi()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.nilai_strategi IS DISTINCT FROM OLD.nilai_strategi THEN
        RAISE EXCEPTION '[target dari Strategi tidak dapat diubah — sesuaikan target dipakai, bukan angka aslinya]';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_plan_target_guard_nilai_strategi BEFORE UPDATE ON plan_target
    FOR EACH ROW EXECUTE FUNCTION guard_plan_target_nilai_strategi();

COMMENT ON COLUMN plan_target.nilai_strategi IS
  'PB-1 — target D-2/D-4, IMMUTABLE (trigger). Jangkar PE-5 (variance vs target '
  'asli): satu-satunya angka yang tidak bisa diedit pihak yang diukur.';

-- ===========================================================================
-- 5. `plan_row` — Section P-C (baris rencana kerja, inti Plan)
-- ===========================================================================
CREATE TABLE plan_row (
    id                 bigint       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    plan_id            varchar(32)  NOT NULL,

    channel            varchar(32)  NOT NULL,   -- PC-1
    pilar              varchar(24)  NOT NULL,   -- PC-2

    -- PC-3: turunan dari Strategi (full-mgmt) ATAU service (Plan Satuan) ATAU
    -- ditandai di-luar. `di_luar_strategi` dihitung ke metrik deviasi (Rule 6,
    -- PG-1); `di_luar_service` analognya di Plan Satuan (M6C §7.9).
    strategi_pillar_id bigint       NULL,
    service_id         varchar(32)  NULL,
    di_luar_strategi   boolean      NOT NULL DEFAULT false,
    di_luar_service    boolean      NOT NULL DEFAULT false,
    di_luar_alasan     text         NULL,

    aksi               text         NOT NULL DEFAULT '',   -- PC-4
    sku_sasaran        jsonb        NOT NULL DEFAULT '[]'::jsonb,  -- PC-5
    kuota              numeric(18,2) NOT NULL,               -- PC-6
    satuan             varchar(32)  NOT NULL DEFAULT '',     -- PC-6 unit
    budget             numeric(18,2) NULL,                   -- PC-7 (kondisional)
    divisi_pic         varchar(24)  NOT NULL,   -- PC-8 (tanpa CHECK enum: preseden briefs.assigned_division)
    minggu_sasaran     jsonb        NOT NULL DEFAULT '[]'::jsonb,  -- PC-9
    prioritas          varchar(16)  NOT NULL DEFAULT 'Penting',    -- PC-10
    hasil_diharapkan   text         NOT NULL DEFAULT '',    -- PC-11
    prasyarat          text         NULL,                   -- PC-12

    status_baris       varchar(24)  NOT NULL DEFAULT 'Rencana',    -- PC-14
    status_baris_alasan text        NULL,       -- Sebagian/Tidak Dikerjakan
    visibilitas        varchar(16)  NOT NULL DEFAULT 'Bagikan ke Klien',  -- PC-17

    -- PC-16: keberatan kapasitas divisi (Rule 18) — flag + text. Diisi divisi;
    -- logikanya (siapa boleh, notif AM+SPV) menyusul.
    keberatan_kapasitas boolean     NOT NULL DEFAULT false,
    keberatan_alasan   text         NULL,

    -- Carry-over (Rule 16 / B-08): baris terbawa ditandai + periode asalnya.
    terbawa            boolean      NOT NULL DEFAULT false,
    periode_asal_id    varchar(32)  NULL,

    created_at         timestamptz  NOT NULL DEFAULT now(),
    updated_at         timestamptz  NOT NULL DEFAULT now(),
    created_by         varchar(64)  NOT NULL,

    CONSTRAINT fk_plan_row_plan FOREIGN KEY (plan_id)
        REFERENCES plan (id) ON DELETE CASCADE,
    -- Pilar/service induk: kalau ia lenyap, barisnya ikut (barisnya kehilangan
    -- asal tunggalnya — ck_plan_row_asal_tunggal tak bisa dipenuhi lagi).
    CONSTRAINT fk_plan_row_pillar FOREIGN KEY (strategi_pillar_id)
        REFERENCES strategi_pillar (id) ON DELETE CASCADE,
    CONSTRAINT fk_plan_row_service FOREIGN KEY (service_id)
        REFERENCES services (id) ON DELETE CASCADE,
    -- Periode asal (carry-over) hanya metadata; kalau periode asalnya hilang,
    -- baris terbawa tetap ada, cuma kehilangan penunjuk asalnya.
    CONSTRAINT fk_plan_row_asal    FOREIGN KEY (periode_asal_id)
        REFERENCES plan (id) ON DELETE SET NULL,
    -- Pilar = kosakata pilar Strategi (disalin dari ck_strpil_jenis, tanpa
    -- 'tidak_dikerjakan' yang milik status pilar, bukan baris kerja).
    CONSTRAINT ck_plan_row_pilar CHECK (pilar IN (
        'sku', 'harga', 'iklan', 'konten', 'affiliate', 'live', 'retensi',
        'operasional')),
    CONSTRAINT ck_plan_row_prioritas CHECK (prioritas IN (
        'Wajib', 'Penting', 'Kalau Sempat')),
    CONSTRAINT ck_plan_row_status CHECK (status_baris IN (
        'Rencana', 'Jalan', 'Selesai', 'Sebagian', 'Tidak Dikerjakan')),
    CONSTRAINT ck_plan_row_visibilitas CHECK (visibilitas IN (
        'Bagikan ke Klien', 'Internal Saja')),
    -- PC-3: sebuah baris punya TEPAT SATU asal — pilar Strategi, service, atau
    -- ditandai di-luar dengan alasan. `di_luar_*` dan referensi tak boleh
    -- keduanya menyala; baris tanpa asal apa pun juga ditolak (Rule 6: baris
    -- tanpa induk MUNGKIN, tapi harus DITANDAI, bukan diam).
    CONSTRAINT ck_plan_row_asal_tunggal CHECK (
        (strategi_pillar_id IS NOT NULL)::int
      + (service_id         IS NOT NULL)::int
      + (di_luar_strategi)::int
      + (di_luar_service)::int = 1),
    CONSTRAINT ck_plan_row_di_luar_alasan CHECK (
        (NOT di_luar_strategi AND NOT di_luar_service)
        OR (di_luar_alasan IS NOT NULL AND btrim(di_luar_alasan) <> '')),
    CONSTRAINT ck_plan_row_kuota_nonneg CHECK (kuota >= 0 AND (budget IS NULL OR budget >= 0)),
    CONSTRAINT ck_plan_row_sku_arr    CHECK (jsonb_typeof(sku_sasaran) = 'array'),
    CONSTRAINT ck_plan_row_minggu_arr CHECK (jsonb_typeof(minggu_sasaran) = 'array')
);

CREATE INDEX idx_plan_row_plan     ON plan_row (plan_id);
CREATE INDEX idx_plan_row_pillar   ON plan_row (strategi_pillar_id);
CREATE INDEX idx_plan_row_division ON plan_row (divisi_pic, status_baris);

CREATE TRIGGER trg_plan_row_updated_at BEFORE UPDATE ON plan_row
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE plan_row IS
  'M6B Section P-C — unit kerja. Tabel yang Brief dibuat darinya (briefs.'
  'plan_row_id, jejak empat tingkat §8). Rule 6: setiap baris merujuk pilar '
  'Strategi, atau ditandai Di Luar Strategi/Service.';

-- ===========================================================================
-- 6. `plan_row_week` — Section P-D (distribusi mingguan turunan)
-- ===========================================================================
-- Rule 7 (P1): baris mingguan DITURUNKAN, tidak diketik. Trigger Σ = kuota
-- bulanan adalah B-05 (bukan di sini) — B-05 juga yang mengisi baris ini saat
-- aktivasi. Di sini hanya BENTUKNYA: satu baris per (baris kerja, minggu).
CREATE TABLE plan_row_week (
    id           bigint        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    plan_row_id  bigint        NOT NULL,
    minggu_no    integer       NOT NULL,   -- 1..plan.jumlah_minggu
    kuota        numeric(18,2) NOT NULL,   -- PD-1

    created_at   timestamptz   NOT NULL DEFAULT now(),
    updated_at   timestamptz   NOT NULL DEFAULT now(),
    created_by   varchar(64)   NOT NULL,

    CONSTRAINT fk_plan_row_week_row FOREIGN KEY (plan_row_id)
        REFERENCES plan_row (id) ON DELETE CASCADE,
    CONSTRAINT uq_plan_row_week UNIQUE (plan_row_id, minggu_no),
    CONSTRAINT ck_plan_row_week_minggu CHECK (minggu_no >= 1),
    CONSTRAINT ck_plan_row_week_kuota  CHECK (kuota >= 0)
);

CREATE INDEX idx_plan_row_week_row ON plan_row_week (plan_row_id);

CREATE TRIGGER trg_plan_row_week_updated_at BEFORE UPDATE ON plan_row_week
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ===========================================================================
-- 7. `plan_actual` — Section P-E (realisasi hybrid)
-- ===========================================================================
-- Blokir UPDATE metrik `otomatis` untuk role AM (invariant beku §8) adalah
-- B-06 — butuh peran aktor dari JWT, jadi rumahnya RLS/domain, bukan CHECK.
CREATE TABLE plan_actual (
    plan_id       varchar(32)   NOT NULL,
    channel       varchar(32)   NOT NULL,
    metric        varchar(32)   NOT NULL,

    -- P5: GMV manual (AM), sisanya otomatis dari modul eksekusi.
    sumber        varchar(16)   NOT NULL,
    nilai         numeric(18,2) NOT NULL,
    file_bukti    text          NULL,   -- PE-2 (W saat manual)
    tanggal_ambil date          NULL,   -- PE-2 (W saat manual)
    sengketa      text          NULL,   -- PE-6 Sengketa Angka (metrik otomatis)

    created_at    timestamptz   NOT NULL DEFAULT now(),
    updated_at    timestamptz   NOT NULL DEFAULT now(),
    created_by    varchar(64)   NOT NULL,

    CONSTRAINT pk_plan_actual PRIMARY KEY (plan_id, channel, metric),
    CONSTRAINT fk_plan_actual_plan FOREIGN KEY (plan_id)
        REFERENCES plan (id) ON DELETE CASCADE,
    CONSTRAINT ck_plan_actual_metric CHECK (metric IN (
        'gmv', 'pengunjung', 'cr', 'aov', 'roas_min', 'acos_maks',
        'sku_winner', 'affiliate_aktif', 'jam_live', 'jumlah_video')),
    CONSTRAINT ck_plan_actual_sumber CHECK (sumber IN ('manual', 'otomatis')),
    -- §8: baris manual butuh lampiran + tanggal ambil (Rule 11 — satu angka
    -- yang semua kalkulasi lain bergantung padanya harus bersumber).
    CONSTRAINT ck_plan_actual_manual_bukti CHECK (
        sumber <> 'manual'
        OR (file_bukti IS NOT NULL AND btrim(file_bukti) <> '' AND tanggal_ambil IS NOT NULL)),
    -- Sengketa Angka (PE-6) hanya bermakna atas metrik otomatis — membantah
    -- angka yang AM sendiri ketik tidak masuk akal.
    CONSTRAINT ck_plan_actual_sengketa CHECK (sengketa IS NULL OR sumber = 'otomatis'),
    CONSTRAINT ck_plan_actual_nonneg CHECK (nilai >= 0)
);

CREATE INDEX idx_plan_actual_metric ON plan_actual (plan_id, metric);

CREATE TRIGGER trg_plan_actual_updated_at BEFORE UPDATE ON plan_actual
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ===========================================================================
-- 8. `plan_review` — Section P-F (review penutup, 1:1 per periode)
-- ===========================================================================
CREATE TABLE plan_review (
    plan_id            varchar(32) NOT NULL PRIMARY KEY,

    yang_jalan         text        NULL,   -- PF-1
    yang_tidak_jalan   text        NULL,   -- PF-2
    diagnosa_gap       varchar(24) NULL,   -- PF-3
    diagnosa_gap_bukti text        NULL,
    rekomendasi        text        NULL,   -- PF-6
    perlu_revisi       boolean     NULL,   -- PF-7
    materi_klien       text        NULL,   -- PF-8

    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    created_by         varchar(64) NOT NULL,

    CONSTRAINT fk_plan_review_plan FOREIGN KEY (plan_id)
        REFERENCES plan (id) ON DELETE CASCADE,
    -- PF-3: sebab miss = strategi salah ATAU eksekusi tidak jalan (§7 Alpha:
    -- pembedaan paling berguna yang ada). Kelengkapan (semua W terisi saat
    -- tutup) ditegakkan B-07, bukan NOT NULL — §7 butuh review setengah-jadi
    -- bisa disimpan (autosave) sebelum periode ditutup.
    CONSTRAINT ck_plan_review_diagnosa CHECK (
        diagnosa_gap IS NULL OR diagnosa_gap IN ('strategi_salah', 'eksekusi_tidak_jalan'))
);

CREATE TRIGGER trg_plan_review_updated_at BEFORE UPDATE ON plan_review
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- PF-4 (status asumsi) memutakhirkan `strategi_assumption` yang sudah ada; PF-5
-- (carry-over per baris) hidup di `plan_row.terbawa`. Keduanya BUKAN kolom di
-- sini — menaruh salinannya melahirkan sumber kedua untuk fakta yang sama.

-- ===========================================================================
-- 9. `plan_flag` — Section P-G (deviasi & peringatan, auto read-only)
-- ===========================================================================
-- Aturan rumah #4: field auto. Diisi oleh logika/job (B-04…B-09), bukan
-- diketik. `ack_spv_*` (PG-3) satu-satunya yang di-UPDATE manusia.
CREATE TABLE plan_flag (
    id           bigint       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    plan_id      varchar(32)  NOT NULL,
    plan_row_id  bigint       NULL,   -- flag per-baris (PG-1/3/4/5) vs per-periode (PG-6)

    jenis        varchar(32)  NOT NULL,
    detail       text         NULL,
    ack_spv_oleh varchar(64)  NULL,   -- PG-3
    ack_spv_pada timestamptz  NULL,

    created_at   timestamptz  NOT NULL DEFAULT now(),
    updated_at   timestamptz  NOT NULL DEFAULT now(),
    created_by   varchar(64)  NOT NULL,

    CONSTRAINT fk_plan_flag_plan FOREIGN KEY (plan_id)
        REFERENCES plan (id) ON DELETE CASCADE,
    CONSTRAINT fk_plan_flag_row FOREIGN KEY (plan_row_id)
        REFERENCES plan_row (id) ON DELETE CASCADE,
    CONSTRAINT ck_plan_flag_jenis CHECK (jenis IN (
        'di_luar_strategi', 'lewat_komitmen', 'di_bawah_floor',
        'belum_dieksekusi', 'keberatan_kapasitas', 'penyesuaian_turun')),
    -- Stempel ack (PG-3): siapa & kapan datang berpasangan atau tidak sama sekali.
    CONSTRAINT ck_plan_flag_ack CHECK (
        (ack_spv_oleh IS NULL AND ack_spv_pada IS NULL)
     OR (ack_spv_oleh IS NOT NULL AND ack_spv_pada IS NOT NULL))
);

CREATE INDEX idx_plan_flag_plan ON plan_flag (plan_id, jenis);
CREATE INDEX idx_plan_flag_row  ON plan_flag (plan_row_id);

CREATE TRIGGER trg_plan_flag_updated_at BEFORE UPDATE ON plan_flag
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ===========================================================================
-- 10. RLS — scope baris (§8 Permissions). Scope KOLOM per role (Finance hanya
--     budget + actual periode tutup; divisi hanya baris pilarnya) tetap urusan
--     lapisan domain, sama pola dengan Strategi §7.
-- ===========================================================================
-- Scope periode = scope kliennya, seperti `contracts`: Sales menutup
-- kesepakatan, Finance menagih terminnya, keduanya berhak lihat periodenya.
-- `jwt_owns_client` menutupi kedua lingkup (kontrak & Satuan) sekaligus — Plan
-- Satuan tidak punya contract_id untuk disandari.
REVOKE ALL ON public.plan FROM anon;
REVOKE ALL ON public.plan FROM authenticated;
GRANT SELECT ON public.plan TO authenticated;
ALTER TABLE public.plan ENABLE ROW LEVEL SECURITY;
CREATE POLICY plan_select ON public.plan FOR SELECT TO authenticated
USING (jwt_can_read_all()
       OR created_by = jwt_employee_id()
       OR private.jwt_owns_client(client_id)
       OR (jwt_is_lead() AND jwt_division() = 'Account'));

-- Anak-anak mewarisi scope induknya lewat EXISTS ke `plan` — satu tempat aturan
-- ditulis (preseden jwt_can_read_strategi).
CREATE OR REPLACE FUNCTION private.jwt_can_read_plan(p_plan_id text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS
$$
  SELECT EXISTS (
    SELECT 1 FROM public.plan p
     WHERE p.id = p_plan_id
       AND (public.jwt_can_read_all()
            OR public.jwt_employee_id() = p.created_by
            OR private.jwt_owns_client(p.client_id)
            OR (public.jwt_is_lead() AND public.jwt_division() = 'Account'))
  )
$$;
REVOKE EXECUTE ON FUNCTION private.jwt_can_read_plan(text) FROM anon;

-- plan_target / plan_actual / plan_review / plan_flag: warisan langsung lewat plan_id.
DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'plan_target', 'plan_actual', 'plan_review', 'plan_flag'
    ] LOOP
        EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
        EXECUTE format('REVOKE ALL ON public.%I FROM authenticated', t);
        EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated '
            'USING (private.jwt_can_read_plan(plan_id))', t || '_select', t);
    END LOOP;
END;
$$;

-- plan_row: warisan plan_id + arm lead divisi PIC (§8 "Division lead: rows owned
-- by their division"). Tanpa arm ini seorang lead Creative tidak bisa melihat
-- baris konten yang Brief-nya justru diturunkan dari sana.
REVOKE ALL ON public.plan_row FROM anon;
REVOKE ALL ON public.plan_row FROM authenticated;
GRANT SELECT ON public.plan_row TO authenticated;
ALTER TABLE public.plan_row ENABLE ROW LEVEL SECURITY;
CREATE POLICY plan_row_select ON public.plan_row FOR SELECT TO authenticated
USING (private.jwt_can_read_plan(plan_id)
       OR (jwt_is_lead() AND jwt_division() = divisi_pic));

-- plan_row_week: satu hop lagi lewat plan_row (preseden strategi_baseline_bulan).
REVOKE ALL ON public.plan_row_week FROM anon;
REVOKE ALL ON public.plan_row_week FROM authenticated;
GRANT SELECT ON public.plan_row_week TO authenticated;
ALTER TABLE public.plan_row_week ENABLE ROW LEVEL SECURITY;
CREATE POLICY plan_row_week_select ON public.plan_row_week FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.plan_row r
                WHERE r.id = plan_row_week.plan_row_id
                  AND (private.jwt_can_read_plan(r.plan_id)
                       OR (jwt_is_lead() AND jwt_division() = r.divisi_pic))));
