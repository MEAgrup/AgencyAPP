-- CDPS — Module 6D (Rekap Hasil Mingguan) — D-06: JOB TERJADWAL (Senin 00:00 WIB).
--
-- Dua fungsi SQL idempoten + jadwal pg_cron (dibungkus guard). PRD §6 flow 1/3 ·
-- §9 "Scheduled jobs" (a)(b)(c) · backlog D-06 · handoff SESI6 §2.
--
--   (a) wrr_monday_job(p_now)  — Senin 00:00 WIB:
--       * BUKA rekap per klien AKTIF minggu ISO berjalan (Terjadwal→Terbuka via
--         sm_transition aktor 'SISTEM'), tautkan ke periode Plan 'Aktif' bila ada
--         (else Tanpa Plan / plan_id NULL), lalu PANGGIL wrr_aggregate(recap_id)
--         dan emit rekap_mingguan_terbuka ke AM pemilik.
--       * FORCE-CLOSE rekap minggu LALU yang masih 'Terbuka' setelah N=2 hari
--         kerja (working_days_between) → Terbuka→Ditutup Otomatis + set
--         pernah_ditutup_otomatis=true (permanen, RM-5). Saat force-close: emit
--         catatan_divisi_belum_diisi untuk tiap divisi yang berutang catatan
--         wajib (RM-8) tapi belum mengisi (job (c) "saat tutup").
--   (b) wrr_reminder_tick(p_now) — harian: rekap masih 'Terbuka' yang sudah lewat
--       N=2 hari kerja sejak minggu tutup → emit rekap_mingguan_belum_dikonfirmasi
--       (AM + SPV). Idempoten lewat penanda belum_dikonfirmasi_terkirim.
--
-- ---------------------------------------------------------------------------
-- KEPUTUSAN & RANJAU
-- ---------------------------------------------------------------------------
--  * **"Klien aktif" (RM-2) — bagian hold/paused TAK PUNYA kolom hari ini.**
--    Owner (2026-08-13) mendefinisikan aktif = ≥1 service non-terminal, KECUALI
--    klien yang semua service-nya hold/paused. Tapi mesin `service` TIDAK punya
--    state hold/paused (state: [Awaiting Onboarding]/[Strategy Approved]/[Briefed]/
--    [In Execution]/Done/[Cancelled — Service Voided]), dan tak ada konsep
--    payment-hold pada clients/services di skema saat ini. Jadi filter yang BISA
--    ditegakkan = "≥1 service NOT IN ('Done','[Cancelled — Service Voided]')".
--    Pengecualian hold/paused = NO-OP hari ini (tak ada state untuk difilter);
--    ia menyala otomatis begitu state hold/paused ditambahkan ke mesin service.
--    Dicatat: DECISIONS.md 2026-08-13. (Bukan penyimpangan diam — di-flag.)
--  * **sm_transition butuh aktor non-kosong** — 'SISTEM' dipakai (preseden plan
--    sweep `PLAN_JOB_ACTOR_ID='SISTEM'`). "Aktor NULL" di handoff = jwt_employee_id()
--    NULL (jalur service-role) yang membuat belt-trigger D-03 melewatkan tulisan
--    auto — BUKAN argumen NULL ke sm_transition. Fungsi ini SECURITY DEFINER
--    (owner=migration owner) → jwt_employee_id() NULL saat cron/uji, jadi
--    wrr_aggregate lolos belt.
--  * **Force-close TIDAK kena gerbang narasi** (guard_wrr_narasi_saat_tutup hanya
--    Terbuka→Ditutup). pernah_ditutup_otomatis di-set SETELAH transisi (guard
--    permanen mengizinkan false→true). Ambang = working_days_between > 2 (grace
--    2 hari kerja HABIS). Karena job jalan Senin, rekap yang berakhir Minggu lalu
--    (wdb=1) selamat Senin ini, di-force-close Senin BERIKUTNYA (wdb≈6) —
--    persis contoh PRD §10.1-A (tutup minggu 3 di Senin 8 Sep). Reminder (b)
--    menutup celah Sel–Min.
--  * **Idempoten:** buka pakai NOT EXISTS (tak bakar nomor ident_next untuk baris
--    yang sudah ada) + transisi hanya baris 'Terjadwal'; force-close hanya
--    'Terbuka'; reminder hanya belum_dikonfirmasi_terkirim=false. Terima p_now
--    (uji tanpa jam dinding, preseden interview_*_tick).
--  * **pg_cron DIBUNGKUS** IF EXISTS pg_available_extensions — absen di Postgres
--    polos CI, jadi migrasi tetap apply tanpa cron; logika = fungsi SQL yang bisa
--    dipanggil manual (uji) + dijadwalkan bila cron ada. Senin 00:00 WIB =
--    Minggu 17:00 UTC → '0 17 * * 0'.
--
-- Nol tabel/mesin/prefix/event baru (katalog v7 sudah di D-07, 20260813070000) →
-- gate 112/33/21/48 TETAP (satu KOLOM penanda ditambah, bukan tabel). Migrasi
-- lewat supabase/migrations/** + apply_migration — JANGAN `psql -f` (O38). DB
-- lokal rebuild HANYA lewat scripts/db-rebuild.sh.

-- ===========================================================================
-- 0. Penanda idempotensi reminder (RM belum_dikonfirmasi). Bukan tabel baru →
--    gate tabel tak berubah. Di-set true saat reminder terkirim; job hanya
--    mengirim saat false, jadi rerun harian tak menggandakan notifikasi.
-- ===========================================================================
ALTER TABLE weekly_result_recap
    ADD COLUMN belum_dikonfirmasi_terkirim boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN weekly_result_recap.belum_dikonfirmasi_terkirim IS
  'M6D D-06 (job b) — penanda idempotensi: true setelah rekap_mingguan_belum_'
  'dikonfirmasi diemit (N=2 hari kerja lewat, masih Terbuka). wrr_reminder_tick '
  'hanya mengirim saat false ⇒ rerun harian tak menggandakan notifikasi.';

-- ===========================================================================
-- 1. wrr_monday_job — buka minggu berjalan + force-close minggu lalu.
-- ===========================================================================
CREATE OR REPLACE FUNCTION wrr_monday_job(p_now timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_today    date    := wib_date(p_now);
  v_dow      integer := extract(isodow FROM wib_date(p_now))::int;  -- 1=Sen..7=Min
  v_monday   date;
  v_sunday   date;
  v_iso_year integer;
  v_iso_week integer;
  v_opened   integer := 0;
  v_forced   integer := 0;
  v_am       text;
  v_div      text;
  r          record;
  res        jsonb;
BEGIN
  v_monday   := v_today - (v_dow - 1);          -- Senin minggu ISO berjalan (WIB)
  v_sunday   := v_monday + 6;                    -- Minggu
  v_iso_year := extract(isoyear FROM v_monday)::int;
  v_iso_week := extract(week    FROM v_monday)::int;

  -- -----------------------------------------------------------------------
  -- FORCE-CLOSE lebih dulu (rekap minggu LALU masih Terbuka lewat grace 2 hk).
  -- -----------------------------------------------------------------------
  FOR r IN
    SELECT w.id, w.client_id
      FROM weekly_result_recap w
     WHERE w.status = 'Terbuka'
       AND w.minggu_akhir < v_monday
       AND working_days_between(w.minggu_akhir, v_today) > 2
  LOOP
    res := sm_transition('weekly_result_recap','weekly_result_recap','weekly_result_recap',
                         'id','status', r.id, 'Ditutup Otomatis', 'SISTEM', false, false);
    IF NOT (res ->> 'ok')::boolean THEN
      RAISE WARNING 'wrr_monday_job: force-close % gagal: %', r.id, res;
      CONTINUE;
    END IF;
    -- Tanda non-performa AM permanen + jejak penutupan (RM-5/RM-F).
    UPDATE weekly_result_recap
       SET pernah_ditutup_otomatis = true, ditutup_pada = p_now, ditutup_oleh = 'SISTEM'
     WHERE id = r.id;

    -- Job (c): saat tutup, divisi yang berutang catatan wajib (RM-8) tapi belum
    -- mengisi → catatan_divisi_belum_diisi (lead divisi + AM). "Berutang" =
    -- punya baris produksi (menyentuh klien) tanpa baris catatan divisi.
    SELECT assigned_am_id INTO v_am FROM clients WHERE id = r.client_id;
    FOR v_div IN
      SELECT d.divisi FROM wrr_divisi d
       WHERE d.recap_id = r.id
         AND NOT EXISTS (SELECT 1 FROM wrr_catatan_divisi cd
                          WHERE cd.recap_id = r.id AND cd.divisi = d.divisi)
    LOOP
      PERFORM notify_emit('catatan_divisi_belum_diisi', 'weekly_result_recap', r.id, 'SISTEM',
                          '/account/rekap/' || r.id, v_div,
                          CASE WHEN v_am IS NULL THEN ARRAY[]::text[] ELSE ARRAY[v_am] END, false);
    END LOOP;
    v_forced := v_forced + 1;
  END LOOP;

  -- -----------------------------------------------------------------------
  -- BUKA rekap minggu berjalan per klien aktif (idempoten: NOT EXISTS).
  -- plan_id = periode Plan 'Aktif' yang mencakup minggu ini (else NULL).
  -- -----------------------------------------------------------------------
  INSERT INTO weekly_result_recap
    (id, client_id, plan_id, iso_year, iso_week, minggu_mulai, minggu_akhir, created_by)
  SELECT ident_next('WRR', p_now), c.id,
         (SELECT p.id FROM plan p
           WHERE p.client_id = c.id AND p.status = 'Aktif'
             AND p.tanggal_mulai <= v_sunday AND p.tanggal_akhir >= v_monday
           ORDER BY p.tanggal_mulai DESC LIMIT 1),
         v_iso_year, v_iso_week, v_monday, v_sunday, 'SISTEM'
    FROM clients c
   WHERE EXISTS (SELECT 1 FROM services s
                  WHERE s.client_id = c.id
                    AND s.status NOT IN ('Done', '[Cancelled — Service Voided]'))
     AND NOT EXISTS (SELECT 1 FROM weekly_result_recap w
                      WHERE w.client_id = c.id
                        AND w.iso_year = v_iso_year AND w.iso_week = v_iso_week);

  -- Transisi Terjadwal→Terbuka + agregasi awal + notif buka, per rekap baru.
  FOR r IN
    SELECT w.id, w.client_id FROM weekly_result_recap w
     WHERE w.iso_year = v_iso_year AND w.iso_week = v_iso_week AND w.status = 'Terjadwal'
  LOOP
    res := sm_transition('weekly_result_recap','weekly_result_recap','weekly_result_recap',
                         'id','status', r.id, 'Terbuka', 'SISTEM', false, false);
    IF NOT (res ->> 'ok')::boolean THEN
      RAISE WARNING 'wrr_monday_job: buka % gagal: %', r.id, res;
      CONTINUE;
    END IF;
    PERFORM wrr_aggregate(r.id);
    SELECT assigned_am_id INTO v_am FROM clients WHERE id = r.client_id;
    PERFORM notify_emit('rekap_mingguan_terbuka', 'weekly_result_recap', r.id, 'SISTEM',
                        '/account/rekap/' || r.id, 'Account',
                        CASE WHEN v_am IS NULL THEN ARRAY[]::text[] ELSE ARRAY[v_am] END, false);
    v_opened := v_opened + 1;
  END LOOP;

  RETURN jsonb_build_object('iso_year', v_iso_year, 'iso_week', v_iso_week,
                            'dibuka', v_opened, 'ditutup_otomatis', v_forced);
END;
$$;

COMMENT ON FUNCTION wrr_monday_job(timestamptz) IS
  'M6D D-06 (a) — job Senin 00:00 WIB: buka rekap per klien aktif minggu ISO '
  'berjalan (Terjadwal→Terbuka, tautkan Plan Aktif, agregasi, notif buka) + '
  'force-close rekap minggu lalu masih Terbuka lewat N=2 hari kerja '
  '(→Ditutup Otomatis, pernah_ditutup_otomatis=true, notif catatan divisi '
  'belum diisi). Idempoten; sistem-only (belt D-03 menolak aktor JWT).';

-- ===========================================================================
-- 2. wrr_reminder_tick — harian: reminder belum dikonfirmasi (N=2 hari kerja).
-- ===========================================================================
CREATE OR REPLACE FUNCTION wrr_reminder_tick(p_now timestamptz DEFAULT now())
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_today    date := wib_date(p_now);
  v_reminded integer := 0;
  v_am       text;
  r          record;
BEGIN
  FOR r IN
    SELECT w.id, w.client_id FROM weekly_result_recap w
     WHERE w.status = 'Terbuka'
       AND w.belum_dikonfirmasi_terkirim = false
       AND working_days_between(w.minggu_akhir, v_today) >= 2
  LOOP
    SELECT assigned_am_id INTO v_am FROM clients WHERE id = r.client_id;
    PERFORM notify_emit('rekap_mingguan_belum_dikonfirmasi', 'weekly_result_recap', r.id, 'SISTEM',
                        '/account/rekap/' || r.id, 'Account',
                        CASE WHEN v_am IS NULL THEN ARRAY[]::text[] ELSE ARRAY[v_am] END, false);
    UPDATE weekly_result_recap SET belum_dikonfirmasi_terkirim = true WHERE id = r.id;
    v_reminded := v_reminded + 1;
  END LOOP;
  RETURN v_reminded;
END;
$$;

COMMENT ON FUNCTION wrr_reminder_tick(timestamptz) IS
  'M6D D-06 (b) — reminder harian: rekap masih Terbuka lewat N=2 hari kerja '
  'sejak minggu tutup → rekap_mingguan_belum_dikonfirmasi (AM + SPV). Idempoten '
  'lewat penanda belum_dikonfirmasi_terkirim.';

-- Eksekusi hanya oleh service-role job / owner migrasi (tulisan auto = sistem).
REVOKE EXECUTE ON FUNCTION wrr_monday_job(timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION wrr_reminder_tick(timestamptz) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION wrr_monday_job(timestamptz)   TO service_role;
    GRANT EXECUTE ON FUNCTION wrr_reminder_tick(timestamptz) TO service_role;
  END IF;
END $$;

-- ===========================================================================
-- 3. Jadwal pg_cron (dibungkus guard; absen di Postgres polos CI). Senin 00:00
--    WIB = Minggu 17:00 UTC. Reminder harian 01:00 WIB = 18:00 UTC (hari sebelum).
-- ===========================================================================
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
    PERFORM cron.schedule('wrr_monday_job',   '0 17 * * 0',
                          $job$ SELECT public.wrr_monday_job(now()); $job$);
    PERFORM cron.schedule('wrr_reminder_tick', '0 18 * * *',
                          $job$ SELECT public.wrr_reminder_tick(now()); $job$);
  END IF;
END;
$cron$;
