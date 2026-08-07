-- CDPS — O57 / backlog B-00: entitas `CTR-` CONTRACT, dan Strategi pindah dari
-- `service_id` ke `contract_id`.
--
-- Keputusan pemilik 2026-08-07 (docs/DECISIONS.md), pilihan (a)
-- ---------------------------------------------------------------------------
-- "Kontrak" di CDPS = **kumpulan Service satu klien dalam satu kesepakatan**.
-- Klien yang membeli Store Management + GMV Max + Nano KOL dalam satu
-- kesepakatan 12 bulan mendapat SATU Strategi, bukan tiga. Dengan itu M6A
-- terbaca apa adanya: Rule 2 ("exactly one active Strategi per Contract"),
-- D-1 ("Auto from Contract") dan §7 ("n baris PLAN = contract months").
--
-- Sampai migrasi ini, `strategi` diikat ke `services` dan jendela kontraknya
-- (durasi + tanggal mulai/akhir) dideklarasi AM di baris Strategi itu sendiri —
-- mitigasi yang dicatat sebagai utang O57 sejak 20260806064000.
--
-- Kenapa jendela kontrak PINDAH, tidak disalin
-- ---------------------------------------------------------------------------
-- Rancangan §6 handoff SESI5 memberi `contracts` tiga kolom `durasi_bulan` /
-- `tanggal_mulai` / `tanggal_akhir` tanpa menyebut nasib tiga kolom senama di
-- `strategi`. Membiarkan keduanya hidup berarti **dua sumber untuk satu fakta
-- bisnis yang sama**: M6B B-02 mengambil "n periode = n bulan kontrak", dan
-- kalau kedua angka itu berselisih, generator periode harus memilih salah satu
-- diam-diam. Karena itu ketiganya DIHAPUS dari `strategi` dan hanya hidup di
-- `contracts`. Yang TETAP di `strategi` adalah yang memang milik satu versi
-- Strategi, bukan milik kesepakatannya: `tanggal_mulai_siklus` + `siklus_terkunci`
-- (G-0/Rule 17) dan `toleransi_over_persen` (F-7/D16). Dicatat di DECISIONS
-- 2026-08-07 sebagai penajaman rancangan §6, bukan deviasi dari keputusan (a).
--
-- Konsistensi klien ditegakkan FK KOMPOSIT, bukan trigger
-- ---------------------------------------------------------------------------
-- `strategi.client_id` dan `services.client_id` tetap ada (dipakai indeks &
-- pembacaan panas). Supaya keduanya tidak bisa menyimpang dari kliennya
-- kontrak, `contracts` mendapat UNIQUE (id, client_id) dan kedua tabel menunjuk
-- balik lewat FK (contract_id, client_id). Satu deklarasi, nol trigger, dan
-- "Strategi klien A menggantung di kontrak klien B" jadi mustahil disimpan.
-- Pada `services` kolomnya nullable: FK MATCH SIMPLE tidak diperiksa saat
-- `contract_id` NULL, jadi Service tanpa kesepakatan payung tetap sah.
--
-- Rule 7 / butir (b) keputusan — `sumber_floor` berhenti jadi sinyal kualitas
-- ---------------------------------------------------------------------------
-- Floor GMV bulanan TETAP input AM, dengan persetujuan Head. Jadi
-- `strategi_target.sumber_floor` tidak lagi membedakan `kontrak` vs `input_am`
-- (pembedaan yang lahir justru karena entitas Contract belum ada) melainkan
-- mencatat **jalur persetujuannya**: `input_am` → `disetujui_head`. Rule 7
-- "floor read-only" dibaca sebagai read-only SETELAH disetujui Head, dan itu
-- ditegakkan trigger di sini — bukan hanya di TS. D-7 Sanggahan Target tetap
-- punya penegak karena yang menyetujui bukan yang mengetik.

-- ===========================================================================
-- 1. Prefix `CTR` (M6A §7 — registry adalah yang memutuskan, bukan kebiasaan)
-- ===========================================================================
INSERT INTO entity_prefix (prefix, entity_name, module) VALUES
    ('CTR', 'Contract (kesepakatan klien)', 'M6A/M6B');

-- ===========================================================================
-- 2. `contracts`
-- ===========================================================================
-- Sengaja TANPA mesin status. Sebuah kontrak di CDPS belum punya siklus hidup
-- yang diminta PRD mana pun — yang punya status adalah Strategi (#15) dan Plan
-- (#16). Mendaftarkan mesin kosong sekarang berarti menebak nama state, dan
-- aturan rumah #2 melarang status yang tidak ada di STATE_MACHINES.md.
CREATE TABLE contracts (
    id             varchar(32)  NOT NULL PRIMARY KEY,
    client_id      varchar(32)  NOT NULL,

    durasi_bulan   integer      NOT NULL,
    tanggal_mulai  date         NOT NULL,
    tanggal_akhir  date         NOT NULL,

    catatan        text         NULL,

    created_at     timestamptz  NOT NULL DEFAULT now(),
    updated_at     timestamptz  NOT NULL DEFAULT now(),
    created_by     varchar(64)  NOT NULL,

    CONSTRAINT fk_contracts_client FOREIGN KEY (client_id) REFERENCES clients (id),
    -- Target FK komposit dari `services` dan `strategi` (lihat kepala berkas).
    CONSTRAINT uq_contracts_id_client UNIQUE (id, client_id),
    -- D2 menyebut 3/6/12 bulan sebagai MENU, bukan aturan validasi — yang
    -- ditegakkan sama seperti sebelumnya di `strategi`: durasi masuk akal dan
    -- jendelanya konsisten dengan durasinya.
    CONSTRAINT ck_contracts_durasi CHECK (durasi_bulan BETWEEN 1 AND 36),
    CONSTRAINT ck_contracts_jendela CHECK (tanggal_akhir > tanggal_mulai)
);

CREATE INDEX idx_contracts_client ON contracts (client_id);

CREATE TRIGGER trg_contracts_updated_at BEFORE UPDATE ON contracts
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE contracts IS
  'O57 — kesepakatan satu klien yang memayungi n Service. Satu Strategi Aktif '
  'per Contract (M6A Rule 2); n periode Plan = durasi_bulan (M6B §7).';
COMMENT ON COLUMN contracts.durasi_bulan IS
  'Sumber TUNGGAL durasi kontrak. Kolom senama di `strategi` dihapus migrasi '
  'ini justru supaya generator periode M6B tidak punya dua angka untuk dipilih.';

-- ===========================================================================
-- 3. `services.contract_id` — nullable (Service tanpa payung tetap sah)
-- ===========================================================================
ALTER TABLE services ADD COLUMN contract_id varchar(32) NULL;
ALTER TABLE services ADD CONSTRAINT fk_services_contract
    FOREIGN KEY (contract_id, client_id) REFERENCES contracts (id, client_id);
CREATE INDEX idx_services_contract ON services (contract_id);

COMMENT ON COLUMN services.contract_id IS
  'O57 — kesepakatan payung. NULL = Service berdiri sendiri (sah). FK komposit '
  'dengan client_id: sebuah Service tidak bisa menggantung di kontrak klien lain.';

-- ===========================================================================
-- 4. `strategi.contract_id` + backfill 1:1 dari service-nya
-- ===========================================================================
ALTER TABLE strategi ADD COLUMN contract_id varchar(32) NULL;

-- Backfill. Di live nol baris (belum ada Strategi produksi), tapi DB lokal dan
-- CI membangun ulang dari nol lewat seluruh rantai migrasi, jadi ini tetap
-- harus benar: satu kontrak per Service yang punya Strategi (1:1 — kelompok
-- multi-service baru bisa dibentuk oleh AM setelah migrasi ini), jendelanya
-- diambil dari versi TERBARU karena `openRevision` menyalin jendela apa adanya
-- sehingga semua versi seharusnya sama; `DISTINCT ON` membuat "seharusnya"
-- menjadi deterministik kalau ternyata tidak.
-- ID lewat `ident_next` supaya `id_sequences` ikut maju: nomor hasil backfill
-- tidak akan pernah ditabrak `CTR-` berikutnya yang dibuat aplikasi.
-- Ditulis sebagai loop, bukan CTE ber-RETURNING: memasangkan baris kontrak
-- kembali ke service-nya lewat (client, jendela) akan salah pasang begitu dua
-- Service milik klien yang sama punya jendela identik — justru kasus yang
-- paling mungkin terjadi.
DO $$
DECLARE r record; v_id text;
BEGIN
    FOR r IN
        SELECT DISTINCT ON (s.service_id)
               s.service_id, s.client_id, s.durasi_kontrak_bulan,
               s.tanggal_mulai_kontrak, s.tanggal_akhir_kontrak, s.created_by
          FROM strategi s
         ORDER BY s.service_id, s.versi_no DESC
    LOOP
        v_id := ident_next('CTR', now());
        INSERT INTO contracts (id, client_id, durasi_bulan, tanggal_mulai,
                               tanggal_akhir, catatan, created_by)
        VALUES (v_id, r.client_id, r.durasi_kontrak_bulan, r.tanggal_mulai_kontrak,
                r.tanggal_akhir_kontrak,
                'Dibuat otomatis migrasi O57 dari jendela kontrak yang dideklarasi AM di Strategi.',
                r.created_by);
        UPDATE services SET contract_id = v_id WHERE id = r.service_id;
    END LOOP;
END;
$$;

UPDATE strategi s
   SET contract_id = sv.contract_id
  FROM services sv
 WHERE sv.id = s.service_id;

-- Sabuk pengaman: kalau satu baris pun gagal dipetakan, migrasi berhenti di
-- sini, bukan di `SET NOT NULL` dengan pesan yang tidak menyebut sebabnya.
DO $$
DECLARE v_yatim integer;
BEGIN
    SELECT count(*) INTO v_yatim FROM strategi WHERE contract_id IS NULL;
    IF v_yatim > 0 THEN
        RAISE EXCEPTION 'O57 backfill: % baris strategi tidak mendapat contract_id', v_yatim;
    END IF;
END;
$$;

ALTER TABLE strategi ALTER COLUMN contract_id SET NOT NULL;
ALTER TABLE strategi ADD CONSTRAINT fk_strategi_contract
    FOREIGN KEY (contract_id, client_id) REFERENCES contracts (id, client_id);

-- Rule 2 pindah dari per-Service ke per-Contract. Ketiga indeks ikut, dan ini
-- justru inti O57: dua Service dalam SATU kesepakatan sekarang berbagi satu
-- slot "Aktif" — sebelumnya masing-masing punya slotnya sendiri.
DROP INDEX uq_strategi_aktif_per_service;
DROP INDEX uq_strategi_inflight_per_service;
DROP INDEX uq_strategi_versi;

CREATE UNIQUE INDEX uq_strategi_aktif_per_contract ON strategi (contract_id)
    WHERE status = 'Aktif';
CREATE UNIQUE INDEX uq_strategi_inflight_per_contract ON strategi (contract_id)
    WHERE status IN ('Draft', 'Diajukan', 'Draft Revisi');
CREATE UNIQUE INDEX uq_strategi_versi ON strategi (contract_id, versi_no);

-- Jendela kontrak: sekarang hanya di `contracts`. `ck_strategi_jendela` dan
-- `ck_strategi_durasi` ikut hilang bersama kolomnya — padanannya sudah berdiri
-- di `contracts` (§2).
ALTER TABLE strategi DROP CONSTRAINT ck_strategi_durasi;
ALTER TABLE strategi DROP CONSTRAINT ck_strategi_jendela;
ALTER TABLE strategi DROP COLUMN durasi_kontrak_bulan;
ALTER TABLE strategi DROP COLUMN tanggal_mulai_kontrak;
ALTER TABLE strategi DROP COLUMN tanggal_akhir_kontrak;

-- `service_id` dihapus: satu Strategi memayungi n Service lewat kontrak, jadi
-- menyimpan satu service_id akan salah begitu kesepakatan berisi dua layanan.
-- Jalur Service → Strategi tetap ada dan tetap satu hop: services.contract_id.
-- Policy-nya dibongkar lebih dulu: `strategi_select` menyebut `service_id`, dan
-- Postgres menolak DROP COLUMN selama sebuah policy masih bergantung padanya.
-- Dibangun ulang di §5 dengan predikat berbasis kontrak.
DROP POLICY strategi_select ON public.strategi;
ALTER TABLE strategi DROP CONSTRAINT fk_strategi_service;
ALTER TABLE strategi DROP COLUMN service_id;

COMMENT ON COLUMN strategi.contract_id IS
  'O57 — Strategi menggantung di kesepakatan, bukan di satu Service. Rule 2 '
  'dijaga uq_strategi_aktif_per_contract.';

-- ===========================================================================
-- 5. RLS — dua tempat saja (tabel anak mewarisi lewat EXISTS)
-- ===========================================================================
REVOKE ALL ON public.contracts FROM anon;
REVOKE ALL ON public.contracts FROM authenticated;
GRANT SELECT ON public.contracts TO authenticated;
ALTER TABLE public.contracts ENABLE ROW LEVEL SECURITY;

-- Scope kontrak = scope kliennya. `private.jwt_owns_client` dipakai di sini —
-- BUKAN padanan sempit ala `jwt_is_am_of_service` — karena kontrak adalah
-- dokumen kesepakatan: Sales yang menutupnya dan Finance yang menagih terminnya
-- memang perlu melihat durasi & jendelanya. Yang tetap sempit adalah Strategi
-- di atasnya (§7 M6A), dan itu dijaga policy `strategi_select` sendiri.
CREATE POLICY contracts_select ON public.contracts FOR SELECT TO authenticated
USING (jwt_can_read_all()
       OR created_by = jwt_employee_id()
       OR private.jwt_owns_client(client_id)
       OR (jwt_is_lead() AND jwt_division() = 'Account'));

-- Padanan `jwt_is_am_of_service` berbasis kontrak. Predikatnya identik — AM
-- pemilik klien — hanya titik masuknya yang berubah dari Service ke Contract.
CREATE OR REPLACE FUNCTION private.jwt_is_am_of_contract(p_contract_id text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS
$$
  SELECT EXISTS (
    SELECT 1 FROM public.contracts ct JOIN public.clients c ON c.id = ct.client_id
    WHERE ct.id = p_contract_id
      AND c.assigned_am_id = public.jwt_employee_id()
  )
$$;
REVOKE EXECUTE ON FUNCTION private.jwt_is_am_of_contract(text) FROM anon;

-- (di-DROP di §4 sebelum kolomnya dibuang)
CREATE POLICY strategi_select ON public.strategi FOR SELECT TO authenticated
USING (jwt_can_read_all()
       OR jwt_employee_id() IN (created_by, disetujui_oleh)
       OR private.jwt_is_am_of_contract(contract_id)
       OR (jwt_is_lead() AND jwt_division() = 'Account'));

CREATE OR REPLACE FUNCTION private.jwt_can_read_strategi(p_strategi_id text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS
$$
  SELECT EXISTS (
    SELECT 1 FROM public.strategi s
     WHERE s.id = p_strategi_id
       AND (public.jwt_can_read_all()
            OR public.jwt_employee_id() IN (s.created_by, s.disetujui_oleh)
            OR private.jwt_is_am_of_contract(s.contract_id)
            OR (public.jwt_is_lead() AND public.jwt_division() = 'Account'))
  )
$$;

-- ===========================================================================
-- 6. Rule 7 / butir (b) — `sumber_floor` = jalur persetujuan
-- ===========================================================================
ALTER TABLE strategi_target ADD COLUMN floor_disetujui_oleh varchar(64) NULL;
ALTER TABLE strategi_target ADD COLUMN floor_disetujui_pada timestamptz NULL;

-- `kontrak` selalu berupa klaim yang tidak bisa ditopang siapa pun: entitas
-- Contract baru lahir di migrasi ini, jadi tidak ada satu pun baris yang
-- floor-nya benar-benar DITARIK dari kontrak. Dipetakan ke `input_am`
-- (belum disetujui) — bukan `disetujui_head`, karena menaikkan baris lama
-- menjadi "sudah disetujui" akan mengarang persetujuan yang tidak pernah ada.
ALTER TABLE strategi_target DROP CONSTRAINT ck_strategi_target_floor_source;
UPDATE strategi_target SET sumber_floor = 'input_am' WHERE sumber_floor = 'kontrak';

ALTER TABLE strategi_target ADD CONSTRAINT ck_strategi_target_floor_source CHECK (
    (nilai_floor IS NULL AND sumber_floor IS NULL)
 OR (nilai_floor IS NOT NULL AND sumber_floor IN ('input_am', 'disetujui_head')));

-- Stempel persetujuan dan nilai `sumber_floor` tidak boleh saling membantah.
ALTER TABLE strategi_target ADD CONSTRAINT ck_strategi_target_floor_approval CHECK (
    CASE WHEN sumber_floor = 'disetujui_head'
         THEN floor_disetujui_oleh IS NOT NULL AND floor_disetujui_pada IS NOT NULL
         ELSE floor_disetujui_oleh IS NULL     AND floor_disetujui_pada IS NULL
    END);

-- Rule 7 sebagai DINDING, bukan janji. Setelah Head menyetujui, angka floor
-- beku dan persetujuannya tidak bisa dicabut diam-diam dengan UPDATE mentah —
-- termasuk oleh service role. Menurunkan floor tanpa jejak persis yang membuat
-- D-7 Sanggahan Target kehilangan artinya.
CREATE OR REPLACE FUNCTION guard_floor_disetujui()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD.sumber_floor = 'disetujui_head' THEN
        IF NEW.nilai_floor IS DISTINCT FROM OLD.nilai_floor THEN
            RAISE EXCEPTION '[target floor tidak dapat diubah setelah disetujui Head Account]';
        END IF;
        IF NEW.sumber_floor IS DISTINCT FROM OLD.sumber_floor THEN
            RAISE EXCEPTION '[target floor tidak dapat diubah setelah disetujui Head Account]';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_strategi_target_guard_floor BEFORE UPDATE ON strategi_target
    FOR EACH ROW EXECUTE FUNCTION guard_floor_disetujui();

COMMENT ON COLUMN strategi_target.sumber_floor IS
  'O57 butir (b) — JALUR PERSETUJUAN, bukan asal angka: input_am (diketik AM, '
  'masih boleh berubah) → disetujui_head (beku, Rule 7). Nilai lama `kontrak` '
  'dihapus: tidak pernah ada kontrak untuk menariknya.';
