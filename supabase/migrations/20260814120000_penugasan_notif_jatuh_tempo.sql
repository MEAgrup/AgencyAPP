-- CDPS — Penugasan Internal: NOTIFIKASI JATUH TEMPO + PEMBATALAN (katalog v10).
--
-- Permintaan pemilik 2026-08-14 (lanjutan): *"buatkan event notifikasi tambahan
-- untuk task ini"*. Ini menutup lubang yang sengaja dicatat di migrasi
-- `20260814110000` — keterlambatan sudah TERLIHAT (daftar + rekap + banner) dan
-- TERCATAT (turunan dari jangkar beku), tapi belum pernah MEMBERI TAHU siapa pun.
--
-- ---------------------------------------------------------------------------
-- TIGA EVENT, DAN KENAPA MASING-MASING ADA
-- ---------------------------------------------------------------------------
--   penugasan_mendekati_jatuh_tempo  H-1, ke PIC saja.
--       Sebuah pengingat yang juga dikirim ke atasan berhenti jadi pengingat dan
--       jadi laporan — orangnya belum terlambat apa-apa. Maka `explicit` ke PIC.
--
--   penugasan_jatuh_tempo            Lewat tenggat & belum selesai, ke PIC +
--                                    pemberi tugas + lead divisi tujuan.
--       Di sinilah atasan memang perlu tahu: tenggat sudah lewat. `explicitOrLeads`
--       (PIC & pemberi tugas eksplisit, lead divisi lewat `division`).
--
--   penugasan_dibatalkan             Dibatalkan, ke PIC saja.
--       PIC yang tidak diberi tahu akan terus mengerjakan pekerjaan yang sudah
--       ditarik. Ini satu-satunya dari ketiganya yang diemit dari DOMAIN
--       (`internaltask.cancelTask`), bukan dari job — pemicunya sebuah aksi, bukan
--       lewatnya waktu.
--
-- ---------------------------------------------------------------------------
-- KEPUTUSAN & RANJAU
-- ---------------------------------------------------------------------------
--  * **SEKALI, BUKAN SETIAP HARI.** Dua penanda idempotensi (`pengingat_h1_terkirim`,
--    `jatuh_tempo_terkirim`) — pola `belum_dikonfirmasi_terkirim` (M6D D-06).
--    Tanpa ini job harian akan mengirim notifikasi "terlambat" setiap pagi sampai
--    tugasnya beres, dan kotak masuk yang berisik adalah kotak masuk yang tidak
--    dibaca. Konsekuensi yang diterima: pemberitahuan terlambat hanya SEKALI;
--    eskalasi berulang (kalau nanti diinginkan) butuh keputusan tersendiri.
--  * **Penanda hanya boleh false→true**, ditegakkan di trigger `internal_tasks_beku`
--    yang sama dengan jangkar waktu. Penanda yang bisa di-reset = notifikasi yang
--    bisa dikirim ulang, dan itu mengembalikan persis kebisingan di atas.
--  * **Tugas yang lahir SUDAH lewat tenggat** melompati H-1 dan langsung dapat
--    `penugasan_jatuh_tempo` — benar: tidak ada yang perlu diingatkan tentang
--    besok yang sudah kemarin.
--  * **`[Dibatalkan]` dan `[Selesai]` tidak pernah diingatkan.** Filter status
--    non-terminal ada di kedua cabang; tugas yang sudah ditarik bukan tugas telat.
--  * **Job idempoten & menerima `p_now`** (uji tanpa jam dinding, preseden
--    `wrr_reminder_tick` / `interview_*_tick`). Aktor 'SISTEM'.
--  * **pg_cron DIBUNGKUS** `IF EXISTS pg_available_extensions` — absen di Postgres
--    polos CI, jadi migrasi tetap apply tanpa cron dan fungsinya tetap bisa
--    dipanggil manual/lewat route internal. **07:00 WIB = 00:00 UTC** (`'0 0 * * *'`):
--    pengingat tenggat berguna di AWAL hari kerja, bukan tengah malam saat tak
--    seorang pun membacanya.
--
-- Gate hitung notif_events 54 → 57 di .github/workflows/ci.yml + scripts/
-- db-rebuild.sh dinaikkan bersama migrasi ini (satu commit — menaikkan salah satu
-- saja membuat suite hijau palsu). Nol tabel/mesin/prefix baru (dua KOLOM penanda,
-- bukan tabel) ⇒ gate 114/35/23 TETAP.

-- ===========================================================================
-- 1. Katalog v10 (+3 event).
--    Registrasi lewat SATU baris notif_catalog_versions (event_count: 3).
--    Invariant O55 menghitung SUM(event_count) = COUNT(notif_events) — JANGAN
--    hardcode 57.
-- ===========================================================================
INSERT INTO notif_catalog_versions (version, description, event_count, decision_ref) VALUES
    (10,
     'Penugasan Internal — 3 event jatuh tempo & pembatalan (penugasan_mendekati_jatuh_tempo → PIC; penugasan_jatuh_tempo → PIC + pemberi tugas + lead divisi; penugasan_dibatalkan → PIC)',
     3,
     'docs/DECISIONS.md 2026-08-14 (Penugasan Internal — notifikasi tambahan, permintaan pemilik)');

INSERT INTO notif_events (event_type, description, resolver, catalog_version) VALUES
    ('penugasan_mendekati_jatuh_tempo', 'Penugasan internal jatuh tempo besok (H-1) — ke karyawan yang ditugaskan',        'explicit',        10),
    ('penugasan_jatuh_tempo',           'Penugasan internal lewat jatuh tempo & belum selesai — ke PIC, pemberi tugas, lead divisi', 'explicitOrLeads', 10),
    ('penugasan_dibatalkan',            'Penugasan internal dibatalkan atasan — ke karyawan yang ditugaskan',              'explicit',        10);

-- ===========================================================================
-- 2. Penanda idempotensi. Dua KOLOM, bukan tabel baru ⇒ gate tabel tak berubah.
-- ===========================================================================
ALTER TABLE internal_tasks
    ADD COLUMN pengingat_h1_terkirim boolean NOT NULL DEFAULT false,
    ADD COLUMN jatuh_tempo_terkirim  boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN internal_tasks.pengingat_h1_terkirim IS
  'Penanda idempotensi: true setelah penugasan_mendekati_jatuh_tempo diemit (H-1). '
  'penugasan_reminder_tick hanya mengirim saat false ⇒ rerun harian tak menggandakan.';
COMMENT ON COLUMN internal_tasks.jatuh_tempo_terkirim IS
  'Penanda idempotensi: true setelah penugasan_jatuh_tempo diemit (lewat tenggat, '
  'belum selesai). SEKALI saja — bukan eskalasi harian.';

-- ===========================================================================
-- 3. Trigger beku diperluas: penanda hanya boleh false→true.
--    CREATE OR REPLACE atas fungsi dari 20260814110000 — isi lamanya disalin
--    utuh supaya berkas ini bisa dibaca sendiri; yang BARU hanya dua blok
--    penanda di bawah. Sebuah penanda yang bisa di-reset adalah notifikasi yang
--    bisa dikirim ulang.
-- ===========================================================================
CREATE OR REPLACE FUNCTION internal_tasks_beku()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    IF NEW.id IS DISTINCT FROM OLD.id THEN
        RAISE EXCEPTION 'internal_tasks: id beku';
    END IF;
    IF NEW.assignee_id IS DISTINCT FROM OLD.assignee_id THEN
        RAISE EXCEPTION 'internal_tasks: assignee_id beku — batalkan lalu tugaskan ulang';
    END IF;
    IF NEW.assignee_division IS DISTINCT FROM OLD.assignee_division THEN
        RAISE EXCEPTION 'internal_tasks: assignee_division beku';
    END IF;
    IF NEW.due_date IS DISTINCT FROM OLD.due_date THEN
        RAISE EXCEPTION 'internal_tasks: due_date beku — menggesernya menghapus keterlambatan dari catatan';
    END IF;
    IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
        RAISE EXCEPTION 'internal_tasks: created_by beku';
    END IF;
    IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'internal_tasks: created_at beku';
    END IF;
    IF OLD.dimulai_pada IS NOT NULL AND NEW.dimulai_pada IS DISTINCT FROM OLD.dimulai_pada THEN
        RAISE EXCEPTION 'internal_tasks: dimulai_pada beku — jangkar durasi tidak boleh diubah';
    END IF;
    IF OLD.selesai_pada IS NOT NULL AND NEW.selesai_pada IS DISTINCT FROM OLD.selesai_pada THEN
        RAISE EXCEPTION 'internal_tasks: selesai_pada beku setelah selesai';
    END IF;
    IF OLD.dibatalkan_pada IS NOT NULL AND NEW.dibatalkan_pada IS DISTINCT FROM OLD.dibatalkan_pada THEN
        RAISE EXCEPTION 'internal_tasks: dibatalkan_pada beku setelah dibatalkan';
    END IF;
    IF OLD.status = '[Selesai]' AND NEW.link_hasil IS DISTINCT FROM OLD.link_hasil THEN
        RAISE EXCEPTION 'internal_tasks: link_hasil beku setelah [Selesai]';
    END IF;
    IF OLD.status IN ('[Selesai]', '[Dibatalkan]') AND NEW.status <> OLD.status THEN
        RAISE EXCEPTION 'internal_tasks: % adalah state terminal', OLD.status;
    END IF;
    -- BARU (v10): penanda notifikasi searah. Mengembalikannya ke false akan
    -- membuat job mengirim ulang notifikasi yang sama — persis kebisingan yang
    -- penanda ini ada untuk mencegahnya.
    IF OLD.pengingat_h1_terkirim AND NOT NEW.pengingat_h1_terkirim THEN
        RAISE EXCEPTION 'internal_tasks: pengingat_h1_terkirim searah (tidak bisa di-reset)';
    END IF;
    IF OLD.jatuh_tempo_terkirim AND NOT NEW.jatuh_tempo_terkirim THEN
        RAISE EXCEPTION 'internal_tasks: jatuh_tempo_terkirim searah (tidak bisa di-reset)';
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

-- ===========================================================================
-- 4. penugasan_reminder_tick — job harian.
--
--    Dua cabang, satu lintasan, keduanya idempoten lewat penandanya sendiri.
--    Mengembalikan jsonb {h1, jatuh_tempo} supaya pemanggil (route internal /
--    uji) bisa meng-assert JUMLAHNYA, bukan cuma "tidak error".
-- ===========================================================================
CREATE OR REPLACE FUNCTION penugasan_reminder_tick(p_now timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_today date    := wib_date(p_now);
  v_h1    integer := 0;
  v_late  integer := 0;
  r       record;
BEGIN
  -- (a) H-1 — jatuh tempo BESOK, belum selesai, belum pernah diingatkan.
  FOR r IN
    SELECT id, assignee_id, assignee_division FROM internal_tasks
     WHERE status IN ('[Ditugaskan]', '[Dikerjakan]')
       AND pengingat_h1_terkirim = false
       AND due_date = v_today + 1
  LOOP
    PERFORM notify_emit('penugasan_mendekati_jatuh_tempo', 'internal_task', r.id, 'SISTEM',
                        '/penugasan/' || r.id, r.assignee_division,
                        ARRAY[r.assignee_id], false);
    UPDATE internal_tasks SET pengingat_h1_terkirim = true WHERE id = r.id;
    v_h1 := v_h1 + 1;
  END LOOP;

  -- (b) LEWAT TENGGAT — belum selesai, belum pernah diberitahukan. PIC dan
  --     pemberi tugas eksplisit; lead divisi tujuan ikut lewat `division`
  --     (resolver explicitOrLeads).
  FOR r IN
    SELECT id, assignee_id, assignee_division, created_by FROM internal_tasks
     WHERE status IN ('[Ditugaskan]', '[Dikerjakan]')
       AND jatuh_tempo_terkirim = false
       AND due_date < v_today
  LOOP
    PERFORM notify_emit('penugasan_jatuh_tempo', 'internal_task', r.id, 'SISTEM',
                        '/penugasan/' || r.id, r.assignee_division,
                        ARRAY[r.assignee_id, r.created_by], false);
    UPDATE internal_tasks SET jatuh_tempo_terkirim = true WHERE id = r.id;
    v_late := v_late + 1;
  END LOOP;

  RETURN jsonb_build_object('h1', v_h1, 'jatuh_tempo', v_late);
END;
$$;

COMMENT ON FUNCTION penugasan_reminder_tick(timestamptz) IS
  'Penugasan Internal — job harian: (a) H-1 penugasan_mendekati_jatuh_tempo ke PIC, '
  '(b) lewat tenggat & belum selesai penugasan_jatuh_tempo ke PIC + pemberi tugas + '
  'lead divisi. Idempoten lewat pengingat_h1_terkirim / jatuh_tempo_terkirim.';

-- Eksekusi hanya oleh service-role job / owner migrasi (tulisan auto = sistem).
REVOKE EXECUTE ON FUNCTION penugasan_reminder_tick(timestamptz) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION penugasan_reminder_tick(timestamptz) TO service_role;
  END IF;
END $$;

-- ===========================================================================
-- 5. Jadwal pg_cron (dibungkus guard). 07:00 WIB = 00:00 UTC.
-- ===========================================================================
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
    PERFORM cron.schedule('penugasan_reminder_tick', '0 0 * * *',
                          $job$ SELECT public.penugasan_reminder_tick(now()); $job$);
  END IF;
END;
$cron$;
