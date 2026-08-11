-- ===========================================================================
-- CDPS — Modul Interview: koreksi flag prasyarat 'bersyarat' (keputusan pemilik
-- 2026-08-11, lihat DECISIONS baris teratas).
--
-- APA yang berubah: HANYA blok (d) di interview_daily_tick. Interpretasi lama
-- (jendela [7,60] hari kalender; sinyal "usang" di luar 60 hari) DIBATALKAN.
-- Spec pemilik: jendela normal hari 0–6; flag dipasang hari ke-7 (>= 7 hari
-- kalender sejak dihitung_pada); TIDAK ada batas atas — flag bertahan sampai
-- kasus diselesaikan (prasyarat_status = 'selesai').
--
-- MENGAPA migrasi baru, bukan edit 20260811040000: migrasi itu sudah merged &
-- applied; menyunting migrasi ter-apply adalah jalur drift O38. Fungsi memakai
-- CREATE OR REPLACE, jadi redefinisi bersih di migrasi terpisah adalah jalur benar.
--
-- BLAST RADIUS: nol tabel/mesin/event/prefix (gate 103/19/43/32 tak berubah) —
-- ini murni penggantian badan fungsi. Advisory flag-only, sekali (NOT EXISTS).
--
-- BELUM di sini (langkah 7/8, cross-file): aksi "tandai prasyarat selesai"
-- (resolusi flag = event append, bukan UPDATE — interview_flag frozen), metrik
-- durasi (turunan selesai_at − dihitung_pada, Rule 4), dan eskalasi ke Account
-- lead/SPV saat >= 2 interview per AM punya prasyarat overdue belum selesai
-- (N=2, keputusan pemilik). Eskalasi per-AM re-armable butuh rumah state +
-- bergantung jalur resolusi; dibangun bareng di langkah 7/8, bukan setengah-jadi.
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

    -- (d) Prasyarat 'bersyarat' terlambat: >= 7 hari kalender sejak dihitung_pada.
    -- TIDAK ada batas atas (keputusan pemilik 2026-08-11): flag bertahan sampai
    -- prasyarat selesai. Anchor = dihitung_pada (proxy "prasyarat ditetapkan";
    -- tak ada kolom deadline — "never invent"). Advisory, sekali (NOT EXISTS).
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

    RETURN v_actions;
END;
$$;
