-- CDPS — Timeline "Kelola Klien": SLA tiga langkah (keputusan pemilik 2026-08-13).
--
-- Pemilik memberi angkanya (menjawab pertanyaan terbuka RA-1):
--   1. Riset Awal        : 2–3 hari kerja dari klik "Kelola Klien"
--   2. Interview Meeting : 1–2 hari kerja, "harus sudah didapatkan"
--   3. Brand Strategy    : 5–7 hari kerja setelah interview
--
-- Empat jawaban pemilik yang menentukan bentuk migrasi ini (2026-08-13):
--   (a) Langkah 2 dihitung dari **riset awal disubmit** sampai **jadwal terisi**
--       ("didapatkan" = slot meeting berhasil diamankan, belum tentu sudah bertemu).
--   (b) Langkah 3 berlaku untuk **dokumen strategi mana pun** yang dipakai layanan
--       itu (`strategi` STRG- atau `strategy_plans` STR-), berhenti saat **AM
--       mengajukan** — waktu tunggu approval SPV TIDAK dibebankan ke AM.
--   (c) Dua flag SLA lama (`sla_belum_dijadwalkan` >3 hk, `sla_belum_selesai` >7 hk,
--       keduanya dari klik Kelola Klien) **DIGANTI** — satu sumber angka saja.
--   (d) Hari kerja **ikut membuang libur nasional** ⇒ tabel `hari_libur` yang diisi
--       admin. Ia mulai KOSONG: menebak tanggal libur = mengarang fakta bisnis.
--
-- ---------------------------------------------------------------------------
-- KEPUTUSAN YANG DITEGAKKAN DI DB
-- ---------------------------------------------------------------------------
--  * AMBANG = DATA BERVERSI (`kelola_klien_sla_config`), bukan literal di kode —
--    pola `kualifikasi_config`. Menggeser 3 hari jadi 4 = satu baris versi baru,
--    bukan deploy.
--  * JANGKAR DI-STAMP TRIGGER, BUKAN DI TS. `sm_transition` satu-satunya penulis
--    kolom status, jadi trigger di `interview` menangkap SETIAP jalur yang
--    mengamankan meeting / menyelesaikan interview — termasuk jalur yang belum
--    ditulis hari ini. Jangkar yang sudah terisi BEKU.
--  * NOL KOLOM DURASI. Semua "berapa hari kerja" dihitung saat baca oleh
--    `working_days_between` (house rule #4). Backfill diambil dari `audit_log` —
--    riwayat immutable yang memang sudah merekam setiap transisi.
--  * BELUM ADA EVENT NOTIFIKASI BARU. SLA lama pun hanya menulis `interview_flag`
--    (advisory, append-only); tiga SLA baru mengikuti preseden itu. Katalog notif
--    tetap 44 — menambah event butuh baris versi (O55) + tanda tangan pemilik.
--
-- Gate: tabel 105→107 (`hari_libur`, `kelola_klien_sla_config`). Mesin tetap 20,
-- prefix tetap 32, event tetap 44 (ci.yml + db-rebuild.sh dinaikkan di commit yang sama).

-- ===========================================================================
-- 1. hari_libur — kalender libur nasional, DIISI ADMIN. Mulai kosong.
--    Kosong ⇒ perilaku identik dengan "Sen–Jum saja"; itu bukan bug, itu keadaan
--    "belum diisi". Menanam tanggal libur di migrasi berarti mengarang fakta
--    (tanggal SKB berubah tiap tahun dan bukan milik kode ini).
-- ===========================================================================
CREATE TABLE hari_libur (
    tanggal     date         NOT NULL PRIMARY KEY,
    keterangan  varchar(191) NOT NULL,
    created_at  timestamptz  NOT NULL DEFAULT now(),
    created_by  varchar(64)  NOT NULL,
    CONSTRAINT ck_hari_libur_keterangan CHECK (length(btrim(keterangan)) > 0)
);

COMMENT ON TABLE hari_libur IS
  'Kalender libur nasional untuk hitungan hari kerja (SLA Kelola Klien). Diisi Direksi lewat /admin/hari-libur. Kosong = hanya Sabtu/Minggu yang dibuang.';

-- Default-deny total (nol policy), seperti kualifikasi_config / entity_prefix:
-- dibaca hanya lewat route service-role, jadi tabel ini tidak menambah baris ke
-- ledger O48 (rls_checks.sql §42).
REVOKE ALL ON public.hari_libur FROM anon;
REVOKE ALL ON public.hari_libur FROM authenticated;
ALTER TABLE public.hari_libur ENABLE ROW LEVEL SECURITY;

-- ===========================================================================
-- 2. working_days_between — SATU helper hari kerja untuk seluruh sistem.
--    Sen–Jum di interval (d_from, d_to], minus `hari_libur`.
--    STABLE (bukan IMMUTABLE): ia membaca tabel. IMMUTABLE yang membaca tabel
--    adalah bug diam — planner boleh meng-cache hasilnya melewati perubahan data.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.working_days_between(d_from date, d_to date)
RETURNS integer
LANGUAGE sql STABLE
SET search_path = public
AS $$
    SELECT CASE
        WHEN d_from IS NULL OR d_to IS NULL OR d_to <= d_from THEN 0
        ELSE (
            SELECT count(*)::int
              FROM generate_series(d_from + 1, d_to, interval '1 day') AS g(d)
             WHERE extract(isodow FROM g.d) < 6          -- 1..5 = Sen..Jum
               AND NOT EXISTS (SELECT 1 FROM hari_libur h WHERE h.tanggal = g.d::date)
        )
    END
$$;

-- Nama lama dipertahankan sebagai delegasi tipis: ia dipanggil dari badan
-- `interview_daily_tick` versi-versi sebelumnya dan dari tes cron. Sejak sini ia
-- ikut membuang libur nasional — satu definisi hari kerja, bukan dua.
CREATE OR REPLACE FUNCTION public.interview_working_days_between(d_from date, d_to date)
RETURNS integer
LANGUAGE sql STABLE
SET search_path = public
AS $$ SELECT public.working_days_between(d_from, d_to) $$;

-- ===========================================================================
-- 3. kelola_klien_sla_config — ambang berversi. v1 = angka pemilik 2026-08-13.
--    "2–3 hari kerja" dibaca: `target` = tepat waktu, `batas` = toleransi
--    terakhir, LEWAT batas = terlambat.
-- ===========================================================================
CREATE TABLE kelola_klien_sla_config (
    version                       integer     NOT NULL PRIMARY KEY,
    riset_awal_target_hari        integer     NOT NULL,
    riset_awal_batas_hari         integer     NOT NULL,
    meeting_target_hari           integer     NOT NULL,
    meeting_batas_hari            integer     NOT NULL,
    strategi_target_hari          integer     NOT NULL,
    strategi_batas_hari           integer     NOT NULL,
    aktif                         boolean     NOT NULL DEFAULT true,
    created_at                    timestamptz NOT NULL DEFAULT now(),
    created_by                    varchar(64) NOT NULL DEFAULT 'SYSTEM',
    CONSTRAINT ck_sla_versi CHECK (version >= 1),
    CONSTRAINT ck_sla_positif CHECK (
        riset_awal_target_hari > 0 AND meeting_target_hari > 0 AND strategi_target_hari > 0),
    -- Batas tak boleh lebih ketat dari target — kalau tidak, "tepat waktu" jadi
    -- wilayah yang mustahil dicapai dan setiap langkah lahir terlambat.
    CONSTRAINT ck_sla_urutan CHECK (
        riset_awal_batas_hari >= riset_awal_target_hari
    AND meeting_batas_hari    >= meeting_target_hari
    AND strategi_batas_hari   >= strategi_target_hari)
);

INSERT INTO kelola_klien_sla_config
    (version, riset_awal_target_hari, riset_awal_batas_hari,
     meeting_target_hari, meeting_batas_hari, strategi_target_hari, strategi_batas_hari)
VALUES (1, 2, 3, 1, 2, 5, 7);

REVOKE ALL ON public.kelola_klien_sla_config FROM anon;
REVOKE ALL ON public.kelola_klien_sla_config FROM authenticated;
ALTER TABLE public.kelola_klien_sla_config ENABLE ROW LEVEL SECURITY;

-- ===========================================================================
-- 4. Jangkar langkah 2 & 3 di `interview` (langkah 1 sudah punya rumahnya di
--    `interview_riset_awal`).
--
--    `meeting_diamankan_pada` = saat slot meeting DIDAPAT. Diisi oleh yang lebih
--    dulu terjadi antara "jadwal terisi" (status → Terjadwal) dan "interview
--    dimulai" (status → Sedang Berlangsung). Jalur mulai-langsung tanpa jadwal
--    ADA (edge 20260812000000) dan jelas berarti meeting sudah didapat —
--    menghitungnya terlambat karena kolom jadwal kosong akan menghukum jalur yang
--    justru dipakai saat jadwal klien bergeser.
-- ===========================================================================
ALTER TABLE interview
    ADD COLUMN meeting_diamankan_pada timestamptz NULL,
    ADD COLUMN selesai_pada           timestamptz NULL;

COMMENT ON COLUMN interview.meeting_diamankan_pada IS
  'Jangkar akhir langkah 2 (Interview Meeting): saat jadwal terisi ATAU interview dimulai — mana yang lebih dulu. Di-stamp trigger, beku setelah terisi.';
COMMENT ON COLUMN interview.selesai_pada IS
  'Jangkar awal langkah 3 (Brand Strategy): saat interview mencapai Selesai / Selesai Dengan Catatan. Di-stamp trigger, beku setelah terisi.';

CREATE OR REPLACE FUNCTION interview_stamp_timeline()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    -- Jangkar beku: sekali terisi, tidak bisa digeser (juga lewat service-role).
    IF TG_OP = 'UPDATE' THEN
        IF OLD.meeting_diamankan_pada IS NOT NULL
           AND NEW.meeting_diamankan_pada IS DISTINCT FROM OLD.meeting_diamankan_pada THEN
            RAISE EXCEPTION 'interview: meeting_diamankan_pada beku — jangkar SLA tidak boleh diubah';
        END IF;
        IF OLD.selesai_pada IS NOT NULL
           AND NEW.selesai_pada IS DISTINCT FROM OLD.selesai_pada THEN
            RAISE EXCEPTION 'interview: selesai_pada beku — jangkar SLA tidak boleh diubah';
        END IF;
    END IF;

    IF NEW.meeting_diamankan_pada IS NULL
       AND NEW.status IN ('Terjadwal', 'Sedang Berlangsung') THEN
        NEW.meeting_diamankan_pada := now();
    END IF;
    IF NEW.selesai_pada IS NULL
       AND NEW.status IN ('Selesai', 'Selesai Dengan Catatan') THEN
        NEW.selesai_pada := now();
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_interview_stamp_timeline
    BEFORE INSERT OR UPDATE ON interview
    FOR EACH ROW EXECUTE FUNCTION interview_stamp_timeline();

-- Backfill dari audit_log — riwayat immutable yang SUDAH merekam tiap transisi
-- (`sm_transition` menulis 'transition:<from>-><to>'). Ini bukan tebakan: ia
-- membaca kejadian yang tercatat. Interview lama yang tak punya jejaknya
-- dibiarkan NULL (= tidak terukur), bukan dikarang.
UPDATE interview i
   SET meeting_diamankan_pada = a.t
  FROM (SELECT entity_id, min(created_at) AS t
          FROM audit_log
         WHERE entity_type = 'interview'
           AND (action LIKE '%->Terjadwal' OR action LIKE '%->Sedang Berlangsung')
         GROUP BY entity_id) a
 WHERE a.entity_id = i.id AND i.meeting_diamankan_pada IS NULL;

UPDATE interview i
   SET selesai_pada = a.t
  FROM (SELECT entity_id, min(created_at) AS t
          FROM audit_log
         WHERE entity_type = 'interview'
           AND (action LIKE '%->Selesai' OR action LIKE '%->Selesai Dengan Catatan')
         GROUP BY entity_id) a
 WHERE a.entity_id = i.id AND i.selesai_pada IS NULL;

-- ===========================================================================
-- 5. Jangkar "AM mengajukan" untuk STR- (`strategy_plans`).
--    STRG- (`strategi`) sudah punya `diajukan_pada`; STR- belum, jadi bentuknya
--    disamakan supaya langkah 3 membaca SATU nama kolom di kedua dokumen.
-- ===========================================================================
ALTER TABLE strategy_plans ADD COLUMN diajukan_pada timestamptz NULL;

COMMENT ON COLUMN strategy_plans.diajukan_pada IS
  'Saat AM mengajukan Strategy & Plan untuk approval — jangkar akhir langkah 3 Kelola Klien. Di-stamp trigger, beku setelah terisi.';

CREATE OR REPLACE FUNCTION strategy_plans_stamp_diajukan()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND OLD.diajukan_pada IS NOT NULL
       AND NEW.diajukan_pada IS DISTINCT FROM OLD.diajukan_pada THEN
        RAISE EXCEPTION 'strategy_plans: diajukan_pada beku — jangkar SLA tidak boleh diubah';
    END IF;
    IF NEW.diajukan_pada IS NULL AND NEW.status = '[Strategy Submitted for Approval]' THEN
        NEW.diajukan_pada := now();
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_strategy_plans_stamp_diajukan
    BEFORE INSERT OR UPDATE ON strategy_plans
    FOR EACH ROW EXECUTE FUNCTION strategy_plans_stamp_diajukan();

UPDATE strategy_plans s
   SET diajukan_pada = a.t
  FROM (SELECT entity_id, min(created_at) AS t
          FROM audit_log
         WHERE entity_type = 'strategy_plan'
           AND action LIKE '%->[Strategy Submitted for Approval]'
         GROUP BY entity_id) a
 WHERE a.entity_id = s.id AND s.diajukan_pada IS NULL;

-- ===========================================================================
-- 6. Resolusi langkah 3: dokumen strategi mana yang berlaku untuk sebuah ITV,
--    dan kapan ia diajukan. Dua fungsi kecil supaya baik pembacaan (domain)
--    maupun flag harian (cron) memakai definisi yang SAMA — bukan dua SQL mirip
--    yang lambat laun berbeda.
-- ===========================================================================

-- Kapan strategi untuk interview ini diajukan AM (NULL = belum). Mengambil yang
-- paling awal di antara dokumen yang berlaku: `strategi` (STRG-) pada kontrak
-- interview (langsung atau lewat service-nya), dan `strategy_plans` (STR-) pada
-- service interview. Dalam praktiknya hanya satu yang ada — satu service tidak
-- bisa berada di kedua jalur (trigger `trg_spg_service_single_plan`) — tapi
-- LEAST() membuat fungsi ini tetap benar kalau data historis punya keduanya.
CREATE OR REPLACE FUNCTION public.kelola_klien_strategi_diajukan_pada(p_interview_id text)
RETURNS timestamptz
LANGUAGE sql STABLE
SET search_path = public
AS $$
    SELECT least(
        (SELECT min(st.diajukan_pada)
           FROM interview i
           LEFT JOIN services svc ON svc.id = i.service_id
           JOIN strategi st ON st.contract_id = coalesce(i.contract_id, svc.contract_id)
          WHERE i.id = p_interview_id AND st.diajukan_pada IS NOT NULL),
        (SELECT min(sp.diajukan_pada)
           FROM interview i
           JOIN strategy_plans sp ON sp.service_id = i.service_id
          WHERE i.id = p_interview_id AND sp.diajukan_pada IS NOT NULL))
$$;

-- Apakah langkah 3 berlaku untuk interview ini. TIDAK berlaku hanya kalau plan
-- gate service-nya sudah MEMUTUSKAN `tanpa_plan` — itu keputusan bisnis eksplisit
-- bahwa layanan ini tak butuh strategi. Gate yang belum diputus tetap dihitung:
-- alur Kelola Klien memang berakhir di brand strategy, dan "belum diputus" bukan
-- alasan untuk berhenti mengukur (justru itu kasus yang ingin pemilik lihat).
CREATE OR REPLACE FUNCTION public.kelola_klien_strategi_berlaku(p_interview_id text)
RETURNS boolean
LANGUAGE sql STABLE
SET search_path = public
AS $$
    SELECT NOT EXISTS (
        SELECT 1
          FROM interview i
          JOIN service_plan_gate g ON g.service_id = i.service_id
         WHERE i.id = p_interview_id
           AND g.keputusan_am = 'tanpa_plan')
$$;

-- ===========================================================================
-- 7. interview_daily_tick — blok (a), (b), (d), (e) IDENTIK dengan
--    20260811080000. Blok (c) & (c') DICABUT (keputusan pemilik: diganti) dan
--    digantikan (c1)–(c3): satu flag per langkah, sekali per interview, hanya
--    saat langkahnya BELUM selesai dan sudah LEWAT batas.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.interview_daily_tick(p_now timestamptz DEFAULT now())
RETURNS integer
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_today date := wib_date(p_now);
    r record;
    v_actions int := 0;
    v_flagged int;
    v_cfg kelola_klien_sla_config%ROWTYPE;
BEGIN
    SELECT * INTO v_cfg FROM kelola_klien_sla_config
     WHERE aktif = true ORDER BY version DESC LIMIT 1;

    -- (a) Interview terlewat (status Terjadwal, tanggal jadwal sudah lewat, bukan
    -- retroaktif). Diproses maks sekali per hari lewat terakhir_diproses.
    FOR r IN
        SELECT i.id, i.am_pengisi_id, j.overdue_emitted, j.overdue_escalated
          FROM interview i
          JOIN interview_jadwal j ON j.interview_id = i.id
         WHERE i.retroaktif = false
           AND i.status = 'Terjadwal'
           AND j.tanggal_waktu IS NOT NULL
           AND wib_date(j.tanggal_waktu) < v_today
           AND j.terakhir_diproses IS DISTINCT FROM v_today
    LOOP
        IF r.overdue_emitted < 7 THEN
            PERFORM notify_emit('interview_terlewat', 'interview', r.id, 'SYSTEM',
                                '', '', ARRAY[r.am_pengisi_id], false);
            UPDATE interview_jadwal
               SET overdue_emitted = overdue_emitted + 1, terakhir_diproses = v_today
             WHERE interview_id = r.id;
            v_actions := v_actions + 1;
        ELSIF NOT r.overdue_escalated THEN
            PERFORM notify_emit('interview_terlewat', 'interview', r.id, 'SYSTEM',
                                '', 'Account', ARRAY[]::text[], false);
            UPDATE interview_jadwal
               SET overdue_escalated = true, terakhir_diproses = v_today
             WHERE interview_id = r.id;
            v_actions := v_actions + 1;
        END IF;
    END LOOP;

    -- (b) Butuh Data Klien: nudge tiap 3 hari (kalender), maks 5.
    FOR r IN
        SELECT i.id, i.am_pengisi_id
          FROM interview i
          JOIN interview_jadwal j ON j.interview_id = i.id
         WHERE i.retroaktif = false
           AND i.status = 'Butuh Data Klien'
           AND j.butuh_data_nudge < 5
           AND (j.terakhir_diproses IS NULL OR (v_today - j.terakhir_diproses) >= 3)
    LOOP
        PERFORM notify_emit('interview_butuh_data_klien', 'interview', r.id, 'SYSTEM',
                            '', '', ARRAY[r.am_pengisi_id], false);
        UPDATE interview_jadwal
           SET butuh_data_nudge = butuh_data_nudge + 1, terakhir_diproses = v_today
         WHERE interview_id = r.id;
        v_actions := v_actions + 1;
    END LOOP;

    -- (c1) SLA langkah 1 — riset awal belum disubmit melewati batas.
    INSERT INTO interview_flag (interview_id, kode, detail)
    SELECT ra.interview_id, 'sla_riset_awal_terlambat',
           jsonb_build_object('langkah', 1,
                              'hari_kerja', working_days_between(wib_date(ra.dimulai_pada), v_today),
                              'batas', v_cfg.riset_awal_batas_hari)
      FROM interview_riset_awal ra
      JOIN interview i ON i.id = ra.interview_id
     WHERE i.retroaktif = false
       AND ra.retroaktif = false   -- sesi pra-fitur: dicatat, tidak dihakimi
       AND i.status <> 'Dibatalkan'
       AND ra.status = 'Berjalan'
       AND working_days_between(wib_date(ra.dimulai_pada), v_today) > v_cfg.riset_awal_batas_hari
       AND NOT EXISTS (SELECT 1 FROM interview_flag f
                        WHERE f.interview_id = ra.interview_id AND f.kode = 'sla_riset_awal_terlambat');
    GET DIAGNOSTICS v_flagged = ROW_COUNT; v_actions := v_actions + v_flagged;

    -- (c2) SLA langkah 2 — riset awal sudah disubmit tapi meeting belum diamankan.
    INSERT INTO interview_flag (interview_id, kode, detail)
    SELECT i.id, 'sla_meeting_terlambat',
           jsonb_build_object('langkah', 2,
                              'hari_kerja', working_days_between(wib_date(ra.disubmit_pada), v_today),
                              'batas', v_cfg.meeting_batas_hari)
      FROM interview i
      JOIN interview_riset_awal ra ON ra.interview_id = i.id
     WHERE i.retroaktif = false
       AND i.status <> 'Dibatalkan'
       AND ra.disubmit_pada IS NOT NULL
       AND i.meeting_diamankan_pada IS NULL
       AND working_days_between(wib_date(ra.disubmit_pada), v_today) > v_cfg.meeting_batas_hari
       AND NOT EXISTS (SELECT 1 FROM interview_flag f
                        WHERE f.interview_id = i.id AND f.kode = 'sla_meeting_terlambat');
    GET DIAGNOSTICS v_flagged = ROW_COUNT; v_actions := v_actions + v_flagged;

    -- (c3) SLA langkah 3 — interview selesai tapi strategi belum diajukan.
    INSERT INTO interview_flag (interview_id, kode, detail)
    SELECT i.id, 'sla_strategi_terlambat',
           jsonb_build_object('langkah', 3,
                              'hari_kerja', working_days_between(wib_date(i.selesai_pada), v_today),
                              'batas', v_cfg.strategi_batas_hari)
      FROM interview i
     WHERE i.retroaktif = false
       AND i.status <> 'Dibatalkan'
       AND i.selesai_pada IS NOT NULL
       AND kelola_klien_strategi_berlaku(i.id)
       AND kelola_klien_strategi_diajukan_pada(i.id) IS NULL
       AND working_days_between(wib_date(i.selesai_pada), v_today) > v_cfg.strategi_batas_hari
       AND NOT EXISTS (SELECT 1 FROM interview_flag f
                        WHERE f.interview_id = i.id AND f.kode = 'sla_strategi_terlambat');
    GET DIAGNOSTICS v_flagged = ROW_COUNT; v_actions := v_actions + v_flagged;

    -- (d) Prasyarat 'bersyarat' terlambat: >= 7 hari kalender sejak dihitung_pada.
    INSERT INTO interview_flag (interview_id, kode, detail)
    SELECT k.interview_id, 'prasyarat_bersyarat_terlambat',
           jsonb_build_object('hari_sejak_dihitung', (v_today - wib_date(k.dihitung_pada)),
                              'ambang_hari', 7)
      FROM interview_kualifikasi k
      JOIN interview i ON i.id = k.interview_id
     WHERE i.retroaktif = false
       AND k.verdict_kualifikasi = 'bersyarat'
       AND k.prasyarat_status <> 'selesai'
       AND (v_today - wib_date(k.dihitung_pada)) >= 7
       AND NOT EXISTS (SELECT 1 FROM interview_flag f
                        WHERE f.interview_id = k.interview_id AND f.kode = 'prasyarat_bersyarat_terlambat');
    GET DIAGNOSTICS v_flagged = ROW_COUNT; v_actions := v_actions + v_flagged;

    -- (e) Eskalasi "prasyarat menggantung" (N=2). Identik dengan 20260811080000.
    FOR r IN
        WITH cnt AS (
            SELECT i.am_pengisi_id AS am, count(*) AS jumlah
              FROM interview_kualifikasi k
              JOIN interview i ON i.id = k.interview_id
              JOIN interview_flag f ON f.interview_id = k.interview_id
                                   AND f.kode = 'prasyarat_bersyarat_terlambat'
             WHERE i.retroaktif = false
               AND k.verdict_kualifikasi = 'bersyarat'
               AND k.prasyarat_status <> 'selesai'
             GROUP BY i.am_pengisi_id
        )
        SELECT COALESCE(cnt.am, e.am_pengisi_id) AS am,
               COALESCE(cnt.jumlah, 0)::int      AS jumlah,
               COALESCE(e.ter_eskalasi, false)   AS ter_eskalasi
          FROM cnt
          FULL OUTER JOIN interview_prasyarat_eskalasi e ON e.am_pengisi_id = cnt.am
    LOOP
        IF r.jumlah >= 2 AND NOT r.ter_eskalasi THEN
            PERFORM notify_emit('kualifikasi_prasyarat_menggantung', 'employee', r.am, 'SYSTEM',
                                '', 'Account', ARRAY[]::text[], false);
            INSERT INTO interview_prasyarat_eskalasi
                       (am_pengisi_id, ter_eskalasi, jumlah_terakhir, terakhir_eskalasi_pada, updated_at)
                VALUES (r.am, true, r.jumlah, p_now, p_now)
            ON CONFLICT (am_pengisi_id) DO UPDATE SET
                ter_eskalasi = true, jumlah_terakhir = EXCLUDED.jumlah_terakhir,
                terakhir_eskalasi_pada = p_now, updated_at = p_now;
            v_actions := v_actions + 1;
        ELSIF r.jumlah < 2 AND r.ter_eskalasi THEN
            UPDATE interview_prasyarat_eskalasi
               SET ter_eskalasi = false, jumlah_terakhir = r.jumlah, updated_at = p_now
             WHERE am_pengisi_id = r.am;
        END IF;
    END LOOP;

    RETURN v_actions;
END;
$$;
