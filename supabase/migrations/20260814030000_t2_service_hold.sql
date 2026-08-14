-- T-2 (RM-2): Hold Service.
--
-- Keputusan pemilik: AM bisa menahan (hold) sebuah Service; approval Head of
-- Account (SPV/Account Lead). Klien yang SEMUA service-nya On Hold berhenti
-- dibuka rekap mingguan (D-06) — tapi TETAP muncul di Client Health report
-- dengan keterangan status hold (keputusan pemilik 2026-08-14; berbeda dari
-- rekomendasi SESI1 yang menyarankan skip snapshot).
--
-- Mesin: satu state baru `[On Hold]` (non-terminal) + dua edge (STATE_MACHINES
-- §6). Gerbang SIAPA ada di domain (client.ts::holdService/resumeService),
-- pola Void Service M4-OA-5 (require_lead di mesin + gate Account-Lead di kode).
-- Alasan wajib saat hold (dicek domain). Tidak ada cascade paksa ke Brief/
-- Asset/Campaign anak: hold hanya menyetop kewajiban rekap, tak memaksa
-- transisi anak (hindari efek samping merusak).

-- --- Mesin service: state [On Hold] + dua edge -----------------------------
INSERT INTO sm_edges (machine, from_state, to_state, require_lead) VALUES
    ('service', '[In Execution]', '[On Hold]',      true),  -- hold: butuh Head of Account
    ('service', '[On Hold]',      '[In Execution]', true);  -- resume: gate serupa

-- --- D-06: klien all-hold tidak dibuka rekap mingguan -----------------------
-- Satu-satunya perubahan vs migrasi asal (20260813080000): filter "klien aktif"
-- kini juga mengecualikan '[On Hold]'. Klien yang punya ≥1 service NOT IN
-- ('Done', voided, '[On Hold]') tetap aktif; yang semua service-nya On Hold
-- (atau terminal) tak lagi memicu rekap. Denominator disiplin AM (D-14, saat
-- diimplementasi) otomatis ikut karena memakai definisi aktif yang sama.
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
  -- RM-2: klien yang SEMUA service-nya '[On Hold]' (atau terminal) tak dibuka.
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
                    AND s.status NOT IN ('Done', '[Cancelled — Service Voided]', '[On Hold]'))
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
