-- ============================================================================
-- D-3 — KUNCI TUTUP BUKU PER BULAN, angka yang DIBEKUKAN, dan jurnal koreksi.
--
-- Diketok pemilik 2026-09-07 (Yohan/Director + Finance), tiga tuntutan yang
-- ditulis apa adanya di `DECISIONS.md`:
--
--   1. satu peran berwenang MENUTUP satu bulan buku;
--   2. bulan yang sudah tertutup **tidak bisa diedit sama sekali** — koreksi
--      HANYA lewat jurnal koreksi di bulan BERJALAN, yang ikut masuk audit log;
--   3. mesin laporan membaca bulan tertutup dari **angka yang dibekukan**,
--      bukan menghitung ulang dari data mentah.
--
-- KENAPA (3) BUKAN OPSIONAL, DAN KENAPA IA YANG MENENTUKAN BENTUK TABEL DI SINI.
-- Jadwal accrual diturunkan dari data yang MASIH BERGERAK: riwayat hold di
-- `audit_log`, versi MSL yang dipin, tanggal void. Satu hold yang diinput
-- terlambat — dan handoff D-2 sendiri menyebut itu risiko operasional utama —
-- akan mengubah angka Maret berbulan-bulan sesudah Maret ditutup, tanpa satu
-- pun jejak bahwa laporan yang pernah dicetak berbeda dari laporan yang sama
-- hari ini. Membekukan angkanya di titik tutup membuat laporan Maret **satu
-- kalimat yang tidak berubah**, dan memindahkan setiap perbaikan ke tempat yang
-- kelihatan: satu baris `jurnal_koreksi` di bulan berjalan, ber-`alasan`, dengan
-- barisnya sendiri di audit log.
--
-- ⚠️ TIDAK ADA JALAN BUKA KEMBALI, DAN ITU DISENGAJA. Mesin `periode_buku`
-- sengaja tidak punya edge `Ditutup -> Terbuka`, dan trigger di §4 menolak
-- SETIAP `UPDATE`/`DELETE` atas baris yang sudah tertutup — termasuk dari
-- `psql` dan service-role. Sebuah "buka kembali sebentar" adalah persis
-- mekanisme yang membuat tuntutan (2) berhenti berarti apa pun: begitu ia ada,
-- ia akan dipakai, dan tidak ada yang bisa tahu lagi apakah angka bulan lampau
-- pernah berubah. Bandingkan `plan` (M6B), yang tutupnya SENGAJA tidak mengunci
-- (X-07) — di sana koreksi pasca-tutup diterima sebagai amandemen. Buku
-- keuangan bukan periode Plan; perbedaan itu diketok pemilik, bukan disamakan
-- demi keseragaman.
--
-- Aditif ⇒ boleh mendahului deploy kode (aturan urutan rilis
-- `HANDOFF_GELOMBANG_D_20260907.md` §7): nol kolom yang di-rename/dihapus, nol
-- tabel lama yang disentuh.
-- ============================================================================

-- --- 1. Registri prefix -----------------------------------------------------
INSERT INTO entity_prefix (prefix, entity_name, module) VALUES
    ('PBK', 'Periode Buku (tutup buku bulanan)', 'Gelombang D (D-3)'),
    ('JRK', 'Jurnal Koreksi (koreksi bulan tertutup)', 'Gelombang D (D-3)');

-- --- 2. Mesin status: periode_buku ------------------------------------------
--
-- SATU edge. `Terbuka -> Ditutup`, `require_lead = true`, dan `Ditutup`
-- terminal. Sesempit itu memang seluruh isinya — dan ia tetap didaftarkan
-- sebagai mesin alih-alih sebuah `UPDATE ... SET status` karena yang dibeli
-- pendaftaran ini bukan tabel transisinya, melainkan tiga hal yang
-- `sm_transition` berikan dalam satu transaksi: row lock (dua orang menutup
-- bulan yang sama bersamaan tidak bisa saling menimpa), gerbang peran di DB
-- (bukan hanya di TS — aturan rumah #2), dan satu baris audit immutable yang
-- menyebut siapa menutupnya.
--
-- `require_lead` di engine bersifat AGNOSTIK DIVISI (lead mana pun, atau
-- Director). Gerbang divisinya — Finance — ditegakkan lapisan domain, pola yang
-- sama dengan `client.canVoidService` yang lebih ketat daripada engine-nya.
INSERT INTO sm_machines (name, initial_state, auto_computed, flags) VALUES
    ('periode_buku', 'Terbuka', false, '{}');
INSERT INTO sm_terminal_states (machine, state) VALUES
    ('periode_buku', 'Ditutup');
INSERT INTO sm_edges (machine, from_state, to_state, require_lead) VALUES
    ('periode_buku', 'Terbuka', 'Ditutup', true);

-- --- 3. Tabel ----------------------------------------------------------------

-- Satu baris per BULAN KALENDER. `bulan` UNIQUE bukan hiasan: ia satu-satunya
-- hal yang membuat "buku ditutup sekali per bulan" benar di tingkat baris.
-- Id-nya tetap `PBK-YYYYMM-NNNN` (aturan rumah #1) dan dicetak dengan stempel
-- waktu HARI PERTAMA `bulan` itu, bukan `now()`, supaya periode di dalam id
-- selalu sama dengan bulan yang diwakilinya — `PBK-202603-0001` adalah buku
-- Maret, walau ia ditutup di bulan April.
CREATE TABLE periode_buku (
    id              varchar(32)  NOT NULL PRIMARY KEY,       -- PBK-YYYYMM-NNNN
    bulan           varchar(7)   NOT NULL UNIQUE,            -- 'YYYY-MM'
    status          varchar(16)  NOT NULL DEFAULT 'Terbuka', -- Terbuka | Ditutup
    ditutup_pada    timestamptz  NULL,
    ditutup_oleh    varchar(64)  NULL,
    created_at      timestamptz  NOT NULL DEFAULT now(),
    created_by      varchar(64)  NOT NULL,
    CONSTRAINT ck_pbk_bulan CHECK (bulan ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
    -- Tertutup TANPA jejak siapa/kapan adalah keadaan yang tidak boleh ada:
    -- seluruh guna kunci ini adalah bisa menjawab "siapa menutup Maret".
    --
    -- SATU ARAH, dan itu disengaja. Kebalikannya (stempel ada ⇒ status harus
    -- `Ditutup`) akan bertabrakan dengan `guard_periode_buku_tertutup`: trigger
    -- itu menolak setiap UPDATE atas baris yang sudah `Ditutup`, jadi stempelnya
    -- WAJIB ditulis lebih dulu, satu pernyataan sebelum transisinya — dan pada
    -- pernyataan itu status-nya masih `Terbuka`. Keduanya dalam satu transaksi,
    -- jadi tidak ada pembaca yang pernah melihat keadaan setengah jalan itu.
    CONSTRAINT ck_pbk_tutup_lengkap CHECK (
        status <> 'Ditutup' OR (ditutup_pada IS NOT NULL AND ditutup_oleh IS NOT NULL)
    )
);

-- ANGKA YANG DIBEKUKAN (tuntutan 3). Satu baris per (bulan, layanan), berisi
-- berapa yang diakui layanan itu DI BULAN ITU — plus cukup provenance untuk
-- menjelaskan angkanya tanpa menghitung ulang apa pun (aturan rumah #4).
--
-- Ia append-only lewat trigger di §4: sebuah angka beku yang bisa di-UPDATE
-- bukan angka beku, ia sekadar angka yang belum diubah.
CREATE TABLE periode_buku_baris (
    id                bigint        NOT NULL GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    bulan             varchar(7)    NOT NULL,
    service_id        varchar(32)   NOT NULL,
    client_id         varchar(32)   NOT NULL,
    -- Yang diakui di bulan ini. Bisa 0.00 untuk layanan yang periodenya jalan
    -- tapi bulan itu seluruhnya kena hold — dan 0 di sini BUKAN ketiadaan
    -- baris: yang pertama berarti "diperiksa, hasilnya nol", yang kedua berarti
    -- "layanan ini tidak ada di bulan itu".
    nilai_diakui      numeric(15,2) NOT NULL,
    -- Nilai BRUTO baris layanan (D-4: nol hitungan PPN di jalur ini).
    nilai_bruto       numeric(15,2) NOT NULL,
    pengakuan         varchar(20)   NOT NULL,
    master_version_no integer       NOT NULL,
    created_at        timestamptz   NOT NULL DEFAULT now(),
    created_by        varchar(64)   NOT NULL,
    CONSTRAINT fk_pbb_bulan   FOREIGN KEY (bulan)      REFERENCES periode_buku (bulan),
    CONSTRAINT fk_pbb_service FOREIGN KEY (service_id) REFERENCES services (id),
    CONSTRAINT fk_pbb_client  FOREIGN KEY (client_id)  REFERENCES clients (id),
    CONSTRAINT uq_pbb UNIQUE (bulan, service_id)
);
CREATE INDEX idx_pbb_bulan ON periode_buku_baris (bulan);

-- JURNAL KOREKSI (tuntutan 2) — satu-satunya jalan memperbaiki bulan tertutup.
--
-- `nilai` BERTANDA: koreksi turun adalah angka negatif, bukan kolom kedua
-- bernama `arah`. Satu kolom bertanda tidak bisa berselisih dengan dirinya
-- sendiri, sedangkan nilai+arah bisa — dan penjumlahannya jadi bergantung pada
-- pembacanya ingat mengalikan atau tidak.
--
-- `bulan` adalah bulan BERJALAN tempat koreksi diakui; `bulan_dikoreksi` adalah
-- bulan tertutup yang diperbaiki. Keduanya disimpan karena laporan butuh
-- KEDUANYA: yang pertama menjawab "berapa pendapatan bulan ini", yang kedua
-- menjawab "kenapa angka Maret di laporan hari ini beda dari yang dicetak
-- Maret". Menyimpan hanya salah satunya membuat pertanyaan yang lain tidak
-- terjawab lagi selamanya.
CREATE TABLE jurnal_koreksi (
    id              varchar(32)   NOT NULL PRIMARY KEY,      -- JRK-YYYYMM-NNNN
    bulan           varchar(7)    NOT NULL,
    bulan_dikoreksi varchar(7)    NOT NULL,
    client_id       varchar(32)   NULL,
    service_id      varchar(32)   NULL,
    nilai           numeric(15,2) NOT NULL,
    alasan          varchar(500)  NOT NULL,
    created_at      timestamptz   NOT NULL DEFAULT now(),
    created_by      varchar(64)   NOT NULL,
    CONSTRAINT fk_jrk_bulan   FOREIGN KEY (bulan)      REFERENCES periode_buku (bulan),
    CONSTRAINT fk_jrk_client  FOREIGN KEY (client_id)  REFERENCES clients (id),
    CONSTRAINT fk_jrk_service FOREIGN KEY (service_id) REFERENCES services (id),
    CONSTRAINT ck_jrk_bulan CHECK (bulan ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
    CONSTRAINT ck_jrk_bulan_dikoreksi CHECK (bulan_dikoreksi ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
    -- 'YYYY-MM' urut leksikografis = urut kronologis, jadi perbandingan string
    -- ini benar-benar berarti "bulan lampau dikoreksi di bulan sesudahnya".
    -- Koreksi yang mendarat di bulan yang SAMA dengan yang dikoreksi bukan
    -- koreksi — bulan itu belum tertutup, angkanya masih dihitung ulang.
    CONSTRAINT ck_jrk_arah CHECK (bulan_dikoreksi < bulan),
    -- Koreksi nol tidak mengoreksi apa pun; kalau yang dimaksud adalah catatan,
    -- tempatnya `audit_log`, bukan jurnal keuangan.
    CONSTRAINT ck_jrk_nilai CHECK (nilai <> 0),
    CONSTRAINT ck_jrk_alasan CHECK (btrim(alasan) <> ''),
    -- Sebuah koreksi yang menunjuk layanan wajib menunjuk kliennya juga:
    -- tanpa itu, laporan per klien akan diam-diam kehilangan koreksinya.
    CONSTRAINT ck_jrk_service_butuh_client CHECK (service_id IS NULL OR client_id IS NOT NULL)
);
CREATE INDEX idx_jrk_bulan ON jurnal_koreksi (bulan);
CREATE INDEX idx_jrk_dikoreksi ON jurnal_koreksi (bulan_dikoreksi);

-- --- 4. Kekekalan ------------------------------------------------------------
--
-- Angka beku dan jurnal koreksi keduanya append-only (aturan rumah #3), pola
-- yang sama dengan `audit_log` dan `client_reports`.
CREATE TRIGGER periode_buku_baris_no_update BEFORE UPDATE ON periode_buku_baris
    FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER periode_buku_baris_no_delete BEFORE DELETE ON periode_buku_baris
    FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER jurnal_koreksi_no_update BEFORE UPDATE ON jurnal_koreksi
    FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER jurnal_koreksi_no_delete BEFORE DELETE ON jurnal_koreksi
    FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Baris `periode_buku` yang SUDAH tertutup tidak bisa diubah oleh siapa pun,
-- lewat jalur apa pun. Mesin status sudah tidak punya edge keluar dari
-- `Ditutup`, tapi mesin status hanya menjaga jalur yang lewat dirinya — dan
-- `psql`, service-role, serta skrip masa depan tidak lewat sana (CLAUDE.md:
-- "penegakan aturan ada di DB, bukan cuma di TS").
--
-- Pesannya sengaja menyebut OBATNYA, bukan hanya penolakannya: orang yang
-- menabraknya sedang mencoba memperbaiki sebuah angka, dan yang ia butuh tahu
-- adalah ke mana perbaikan itu harus ditulis.
CREATE OR REPLACE FUNCTION guard_periode_buku_tertutup() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    IF OLD.status = 'Ditutup' THEN
        RAISE EXCEPTION '[bulan buku % sudah ditutup dan tidak dapat diubah — koreksi hanya lewat jurnal koreksi di bulan berjalan]', OLD.bulan;
    END IF;
    RETURN NEW;
END;
$$;

-- BEFORE UPDATE **DAN** BEFORE DELETE dengan fungsi yang sama: menghapus baris
-- periodenya adalah cara termurah membatalkan penutupan, dan FK dari
-- `periode_buku_baris` tidak menghalanginya untuk bulan yang nol barisnya.
CREATE TRIGGER trg_periode_buku_tertutup BEFORE UPDATE ON periode_buku
    FOR EACH ROW EXECUTE FUNCTION guard_periode_buku_tertutup();
CREATE TRIGGER trg_periode_buku_tertutup_del BEFORE DELETE ON periode_buku
    FOR EACH ROW EXECUTE FUNCTION guard_periode_buku_tertutup();

-- --- 5. RLS ------------------------------------------------------------------
--
-- Scope bacanya cermin gerbang domain `accrual.canBacaAccrual` (= `finance
-- .canReadFinanceQueue`): Finance segala level, OD/Director. Sengaja TIDAK
-- membuka ke AM pemilik klien atau Sales — pengakuan pendapatan adalah worklist
-- Finance, bukan laporan umum; halaman klien punya angkanya sendiri.
-- Penulisan lewat service-role + gerbang TS; RLS kunci kedua.
REVOKE ALL ON public.periode_buku FROM anon;
REVOKE ALL ON public.periode_buku FROM authenticated;
GRANT SELECT ON public.periode_buku TO authenticated;
ALTER TABLE public.periode_buku ENABLE ROW LEVEL SECURITY;
CREATE POLICY periode_buku_select ON public.periode_buku FOR SELECT TO authenticated
USING (jwt_can_read_all() OR jwt_division() = 'Finance');

REVOKE ALL ON public.periode_buku_baris FROM anon;
REVOKE ALL ON public.periode_buku_baris FROM authenticated;
GRANT SELECT ON public.periode_buku_baris TO authenticated;
ALTER TABLE public.periode_buku_baris ENABLE ROW LEVEL SECURITY;
CREATE POLICY periode_buku_baris_select ON public.periode_buku_baris FOR SELECT TO authenticated
USING (jwt_can_read_all() OR jwt_division() = 'Finance');

REVOKE ALL ON public.jurnal_koreksi FROM anon;
REVOKE ALL ON public.jurnal_koreksi FROM authenticated;
GRANT SELECT ON public.jurnal_koreksi TO authenticated;
ALTER TABLE public.jurnal_koreksi ENABLE ROW LEVEL SECURITY;
CREATE POLICY jurnal_koreksi_select ON public.jurnal_koreksi FOR SELECT TO authenticated
USING (jwt_can_read_all() OR jwt_division() = 'Finance');

COMMENT ON TABLE periode_buku IS
  'D-3 (Gelombang D): satu baris per BULAN buku. Mesin #32 periode_buku, satu edge Terbuka->Ditutup, TANPA jalan buka kembali. Bulan tertutup dikunci trigger guard_periode_buku_tertutup terhadap SETIAP UPDATE/DELETE.';
COMMENT ON TABLE periode_buku_baris IS
  'D-3: angka pengakuan yang DIBEKUKAN saat bulan ditutup, satu baris per (bulan, layanan). Append-only. Mesin laporan membaca bulan tertutup dari sini, TIDAK menghitung ulang dari audit_log.';
COMMENT ON TABLE jurnal_koreksi IS
  'D-3: satu-satunya jalan memperbaiki bulan yang sudah tertutup — baris di bulan BERJALAN, nilai BERTANDA, alasan wajib. Append-only.';
