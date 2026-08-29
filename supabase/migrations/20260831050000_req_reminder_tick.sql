-- CDPS M16 §5.5 — LT-50 lanjutan: `permintaan_reminder_tick`, job harian untuk
-- event `m16.permintaan.jatuh_tempo` (katalog v12, sudah didaftarkan fondasi F
-- di `20260829001000_m16_fondasi.sql` — TIDAK didaftarkan ulang di sini). Pola
-- PERSIS `penugasan_reminder_tick` (`20260814120000`), satu cabang saja (REQ-
-- tidak punya pengingat H-1 — spec §5.5 hanya menyebut satu event tick,
-- `permintaan_jatuh_tempo`; tidak ada padanan `penugasan_mendekati_jatuh_tempo`
-- di PRD M16 §5.4 untuk Permintaan).
--
-- Idempoten lewat `jatuh_tempo_terkirim` (kolom pada `permintaan`, ditambahkan
-- migrasi sebelumnya) — SEKALI saja, bukan setiap hari, pola sama dengan TSK-.
-- notify_emit `explicitOrLeads`: penerima eksplisit `diajukan_oleh` +
-- `tujuan_employee_id` (kalau ada) DAN lead divisi tujuan lewat kolom division.

CREATE OR REPLACE FUNCTION permintaan_reminder_tick(p_now timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_today date    := wib_date(p_now);
  v_late  integer := 0;
  r       record;
BEGIN
  FOR r IN
    SELECT id, diajukan_oleh, tujuan_divisi, tujuan_employee_id
      FROM permintaan
     WHERE status IN ('[Diajukan]', '[Diproses]')
       AND jatuh_tempo_terkirim = false
       AND due_date < v_today
  LOOP
    PERFORM notify_emit('m16.permintaan.jatuh_tempo', 'permintaan', r.id, 'SISTEM',
                        '/permintaan/' || r.id, r.tujuan_divisi,
                        ARRAY[r.diajukan_oleh, coalesce(r.tujuan_employee_id, r.diajukan_oleh)], false);
    UPDATE permintaan SET jatuh_tempo_terkirim = true WHERE id = r.id;
    v_late := v_late + 1;
  END LOOP;

  RETURN jsonb_build_object('jatuh_tempo', v_late);
END;
$$;

COMMENT ON FUNCTION permintaan_reminder_tick(timestamptz) IS
  'M16 §5.5 — job harian: Permintaan lewat jatuh tempo (1 hari kerja) & belum selesai/diproses ⇒ m16.permintaan.jatuh_tempo ke pengaju + tujuan (eksplisit) + lead divisi tujuan (explicitOrLeads). Idempoten lewat jatuh_tempo_terkirim.';

REVOKE EXECUTE ON FUNCTION permintaan_reminder_tick(timestamptz) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION permintaan_reminder_tick(timestamptz) TO service_role;
  END IF;
END $$;

-- 07:00 WIB = 00:00 UTC, sama dengan penugasan_reminder_tick — pengingat
-- berguna di awal hari kerja. Dibungkus guard pg_cron (absen di Postgres polos
-- CI); fungsi tetap bisa dipanggil manual/lewat route internal tanpa cron.
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
    PERFORM cron.schedule('permintaan_reminder_tick', '0 0 * * *',
                          $job$ SELECT public.permintaan_reminder_tick(now()); $job$);
  END IF;
END;
$cron$;
