-- CDPS — Modul Interview: pengingat / SLA / eskalasi (langkah 5).
--
-- ---------------------------------------------------------------------------
-- APA INI, DAN KENAPA LOGIKANYA DI FUNGSI SQL MURNI (BUKAN DI pg_cron LANGSUNG)
-- ---------------------------------------------------------------------------
-- Pengingat interview (H-1 & H-hari), nudge "Butuh Data Klien", penanda
-- interview terlewat + eskalasi SPV, dan flag SLA — semuanya adalah pekerjaan
-- terjadwal harian. Yang dijadwalkan pg_cron hanyalah PEMICU; seluruh aturan
-- hidup di dua fungsi SQL murni (`interview_reminder_tick`, `interview_daily_tick`)
-- yang menerima "sekarang" sebagai argumen. Alasannya dua:
--
--   1. **pg_cron tidak ada di mana-mana.** Ia tersedia di Supabase, tidak di
--      kontainer Postgres polos yang dipakai CI job `db-and-migrations` maupun
--      sandbox lokal. Kalau `cron.schedule` dipanggil tanpa syarat, migrasi GAGAL
--      apply di sana dan seluruh gate merah. Maka penjadwalan dibungkus guard
--      `pg_available_extensions` (lihat bagian akhir) — logika tetap ter-apply
--      dan teruji di mana pun, hanya PEMICU-nya yang absen tanpa pg_cron.
--   2. **Idempoten & re-run-safe wajib diuji tanpa menunggu jam dinding.** Karena
--      "sekarang" adalah parameter, tes bisa memutar hari maju dan membuktikan
--      pengingat MENGGANTI (tidak menumpuk), overdue berhenti di 7 lalu eskalasi
--      sekali, dan pemanggilan ulang di hari yang sama = nol aksi.
--
-- ---------------------------------------------------------------------------
-- OFFSET WIB DI SATU TEMPAT; HARI KERJA SATU HELPER
-- ---------------------------------------------------------------------------
-- Konversi ke tanggal kalender WIB memakai `wib_date()` yang sudah ada
-- (pg_foundation — fixed-offset +7 jam, tanpa DST, DECISIONS O20) — TIDAK ada
-- offset kedua yang ditulis ulang di sini. Cron di-set dalam UTC: H-hari 07:00
-- WIB = 00:00 UTC, H-1 08:00 WIB = 01:00 UTC. Hari kerja dihitung oleh SATU
-- helper (`interview_working_days_between`) — Sabtu/Minggu saja; libur nasional
-- BELUM ditangani (gotcha handoff §9), diserahkan ke iterasi berikutnya.
--
-- Idempotensi ditumpangkan pada kolom penanda di `interview_jadwal`
-- (`pengingat_h1_pada`, `pengingat_hday_pada`, `overdue_emitted`,
-- `overdue_escalated`, `butuh_data_nudge`, `terakhir_diproses`) yang dibuat oleh
-- migrasi 20260811030000. "Ganti IA-3 = reset" ditegakkan trigger, bukan
-- diharapkan dari route handler.
--
-- Nol tabel / mesin / event / prefix baru — gate 103/19/43/32 tak berubah.

-- ===========================================================================
-- 1. Helper hari kerja — SATU-satunya. Menghitung hari kerja (Sen–Jum) dalam
--    interval (d_from, d_to]. Libur nasional belum ditangani.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.interview_working_days_between(d_from date, d_to date)
RETURNS integer
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$
    SELECT CASE
        WHEN d_to <= d_from THEN 0
        ELSE (
            SELECT count(*)::int
              FROM generate_series(d_from + 1, d_to, interval '1 day') AS g(d)
             WHERE extract(isodow FROM g.d) < 6   -- 1..5 = Sen..Jum; 6=Sab, 7=Min
        )
    END
$$;

-- ===========================================================================
-- 2. interview_reminder_tick — pengingat interview (event interview_pengingat).
--    p_kind = 'h_day' (H-hari 07:00 WIB) atau 'h_1' (H-1 08:00 WIB). Penerima:
--    AM pengisi (explicit). Idempoten: kolom tanggal menyimpan HARI pengingat
--    dikirim, jadi pemanggilan ulang hari yang sama tidak menduplikasi.
--    Mengembalikan jumlah pengingat yang dikirim.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.interview_reminder_tick(p_kind text, p_now timestamptz DEFAULT now())
RETURNS integer
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_today date := wib_date(p_now);
    v_target date;           -- tanggal jadwal (WIB) yang dicari
    r record;
    v_sent int := 0;
BEGIN
    IF p_kind NOT IN ('h_day', 'h_1') THEN
        RAISE EXCEPTION 'interview_reminder_tick: p_kind tak dikenal %', p_kind;
    END IF;
    v_target := CASE WHEN p_kind = 'h_1' THEN v_today + 1 ELSE v_today END;

    FOR r IN
        SELECT i.id, i.am_pengisi_id
          FROM interview i
          JOIN interview_jadwal j ON j.interview_id = i.id
         WHERE i.status = 'Terjadwal'
           AND j.tanggal_waktu IS NOT NULL
           AND wib_date(j.tanggal_waktu) = v_target
           AND (CASE WHEN p_kind = 'h_1'
                     THEN j.pengingat_h1_pada IS DISTINCT FROM v_today
                     ELSE j.pengingat_hday_pada IS DISTINCT FROM v_today END)
    LOOP
        PERFORM notify_emit('interview_pengingat', 'interview', r.id, 'SYSTEM',
                            '', '', ARRAY[r.am_pengisi_id], false);
        IF p_kind = 'h_1' THEN
            UPDATE interview_jadwal SET pengingat_h1_pada = v_today WHERE interview_id = r.id;
        ELSE
            UPDATE interview_jadwal SET pengingat_hday_pada = v_today WHERE interview_id = r.id;
        END IF;
        v_sent := v_sent + 1;
    END LOOP;
    RETURN v_sent;
END;
$$;

-- ===========================================================================
-- 3. interview_daily_tick — semua pekerjaan harian:
--    (a) interview terlewat: nudge AM harian maks 7, lalu eskalasi SPV sekali
--        (event interview_terlewat; SPV via resolver explicitOrLeads divisi Account).
--    (b) Butuh Data Klien: nudge AM tiap 3 hari maks 5 (event interview_butuh_data_klien).
--    (c) flag SLA: >3 hari kerja belum dijadwalkan / >7 hari kerja belum selesai
--        (retroaktif dikecualikan; flag sekali via NOT EXISTS).
--    (d) prasyarat 'bersyarat' terlambat dalam jendela 60 hari (flag sekali).
--    Re-run-safe: (a)/(b) dipagari `terakhir_diproses`/spacing; (c)/(d) idempoten
--    lewat NOT EXISTS. Mengembalikan jumlah aksi (emit + flag).
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
BEGIN
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
            -- Eskalasi ke SPV divisi Account (leads) — explicitOrLeads.
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

    -- (c) SLA: >3 hari kerja belum dijadwalkan. Sekali (NOT EXISTS).
    INSERT INTO interview_flag (interview_id, kode, detail)
    SELECT i.id, 'sla_belum_dijadwalkan',
           jsonb_build_object('hari_kerja', interview_working_days_between(wib_date(i.created_at), v_today),
                              'batas', 3)
      FROM interview i
     WHERE i.retroaktif = false
       AND i.status = 'Belum Dijadwalkan'
       AND interview_working_days_between(wib_date(i.created_at), v_today) > 3
       AND NOT EXISTS (SELECT 1 FROM interview_flag f
                        WHERE f.interview_id = i.id AND f.kode = 'sla_belum_dijadwalkan');
    GET DIAGNOSTICS v_flagged = ROW_COUNT; v_actions := v_actions + v_flagged;

    -- (c') SLA: >7 hari kerja belum selesai (belum terminal). Sekali.
    INSERT INTO interview_flag (interview_id, kode, detail)
    SELECT i.id, 'sla_belum_selesai',
           jsonb_build_object('hari_kerja', interview_working_days_between(wib_date(i.created_at), v_today),
                              'batas', 7)
      FROM interview i
     WHERE i.retroaktif = false
       AND i.status NOT IN ('Selesai', 'Selesai Dengan Catatan', 'Dibatalkan')
       AND interview_working_days_between(wib_date(i.created_at), v_today) > 7
       AND NOT EXISTS (SELECT 1 FROM interview_flag f
                        WHERE f.interview_id = i.id AND f.kode = 'sla_belum_selesai');
    GET DIAGNOSTICS v_flagged = ROW_COUNT; v_actions := v_actions + v_flagged;

    -- (d) Prasyarat 'bersyarat' terlambat, dalam jendela 60 hari sejak dihitung.
    -- Advisory flag sekali. Interpretasi jendela/ambang dicatat di DECISIONS
    -- 2026-08-11 (Interview — cron): terlambat = >= 7 hari kalender sejak
    -- dihitung_pada & masih <= 60 hari (di luar itu sinyal sudah usang).
    INSERT INTO interview_flag (interview_id, kode, detail)
    SELECT k.interview_id, 'prasyarat_bersyarat_terlambat',
           jsonb_build_object('hari_sejak_dihitung', (v_today - wib_date(k.dihitung_pada)),
                              'jendela_hari', 60)
      FROM interview_kualifikasi k
      JOIN interview i ON i.id = k.interview_id
     WHERE i.retroaktif = false
       AND k.verdict_kualifikasi = 'bersyarat'
       AND k.prasyarat_status <> 'selesai'
       AND (v_today - wib_date(k.dihitung_pada)) BETWEEN 7 AND 60
       AND NOT EXISTS (SELECT 1 FROM interview_flag f
                        WHERE f.interview_id = k.interview_id AND f.kode = 'prasyarat_bersyarat_terlambat');
    GET DIAGNOSTICS v_flagged = ROW_COUNT; v_actions := v_actions + v_flagged;

    RETURN v_actions;
END;
$$;

-- ===========================================================================
-- 4. Reset pengingat saat jadwal (IA-3) berubah — "reminder MENGGANTI, tidak
--    menumpuk". Ditegakkan trigger, bukan diandalkan dari route handler. Hanya
--    kolom yang terikat JADWAL yang direset; `butuh_data_nudge` terikat status
--    Butuh Data Klien (bukan tanggal), jadi tidak ikut.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.interview_jadwal_reset_pengingat()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    IF NEW.tanggal_waktu IS DISTINCT FROM OLD.tanggal_waktu THEN
        NEW.pengingat_h1_pada   := NULL;
        NEW.pengingat_hday_pada := NULL;
        NEW.overdue_emitted     := 0;
        NEW.overdue_escalated   := false;
        NEW.terakhir_diproses   := NULL;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_jadwal_reset_pengingat
    BEFORE UPDATE ON public.interview_jadwal
    FOR EACH ROW EXECUTE FUNCTION public.interview_jadwal_reset_pengingat();

-- ===========================================================================
-- 5. Penjadwalan pg_cron — DIBUNGKUS GUARD. Hanya berjalan di DB yang punya
--    pg_cron (Supabase); di Postgres polos (CI/lokal) blok ini dilewati utuh,
--    fungsi-fungsi di atas tetap ter-apply & teruji. cron di-set UTC; nama job
--    tetap ⇒ re-schedule idempoten.
-- ===========================================================================
DO $cron$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
        CREATE EXTENSION IF NOT EXISTS pg_cron;
        -- H-hari 07:00 WIB = 00:00 UTC.
        PERFORM cron.schedule('interview_reminder_hday', '0 0 * * *',
                              $job$ SELECT public.interview_reminder_tick('h_day', now()); $job$);
        -- H-1 08:00 WIB = 01:00 UTC.
        PERFORM cron.schedule('interview_reminder_h1', '0 1 * * *',
                              $job$ SELECT public.interview_reminder_tick('h_1', now()); $job$);
        -- Pekerjaan harian 09:00 WIB = 02:00 UTC (setelah pengingat).
        PERFORM cron.schedule('interview_daily_tick', '0 2 * * *',
                              $job$ SELECT public.interview_daily_tick(now()); $job$);
    END IF;
END;
$cron$;
