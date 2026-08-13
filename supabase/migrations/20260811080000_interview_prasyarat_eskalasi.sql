-- ===========================================================================
-- CDPS — Modul Interview: eskalasi "prasyarat menggantung" + jalur resolusi
-- (bagian 2 keputusan pemilik 2026-08-11, lihat DECISIONS baris teratas).
--
-- Melengkapi migrasi 20260811070000 (yang menghapus cap 60 hari). Di sini:
--   (1) TABEL STATE `interview_prasyarat_eskalasi` — rumah per-AM untuk eskalasi
--       yang bisa di-RE-ARM. Eskalasi "banyak prasyarat menggantung" adalah
--       properti ANTREAN seorang AM, bukan satu interview — tak ada marker
--       per-AM sebelumnya (persis alasan B-10 memberi rantai Plan tabel sendiri).
--       Ia STATE (mutable), bukan riwayat: tak ada trigger frozen.
--   (2) KATALOG v6 — event `kualifikasi_prasyarat_menggantung` (resolver
--       leadsOfDivision → SPV + Head of Account). Mekanisme O55: baris versi baru
--       (v6, 1 event) ⇒ total notif_events 43→44. Cermin TS di
--       packages/core/src/notification.ts (EVENTS/CATALOG/CATALOG_VERSIONS).
--   (3) CREATE OR REPLACE interview_daily_tick — menambah blok (e): eskalasi
--       ke Account lead/SPV saat >= 2 interview per AM punya prasyarat overdue
--       BELUM selesai (N=2, keputusan pemilik). Sekali per episode; re-arm saat
--       jumlah turun < 2. Blok (a)–(d) identik dengan 20260811070000.
--
-- Gate: tabel 103→104, event 43→44 (ci.yml + db-rebuild.sh dinaikkan di commit
-- yang sama). Mesin/prefix tak berubah (19/32).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- (1) Tabel state per-AM untuk eskalasi re-armable.
-- ---------------------------------------------------------------------------
CREATE TABLE interview_prasyarat_eskalasi (
    am_pengisi_id           varchar(64)  NOT NULL PRIMARY KEY,
    ter_eskalasi            boolean      NOT NULL DEFAULT false,   -- episode terbuka?
    jumlah_terakhir         integer      NOT NULL DEFAULT 0,       -- observasi terakhir
    terakhir_eskalasi_pada  timestamptz  NULL,
    updated_at              timestamptz  NOT NULL DEFAULT now()
);

-- Hygiene grant + RLS default-deny (ditulis HANYA oleh interview_daily_tick yang
-- jalan sebagai owner/service — bypass RLS). Tanpa policy SELECT ⇒ tak masuk
-- ledger O48 (rls_checks §expected), sesuai desain: tabel sistem, bukan data baca.
REVOKE ALL ON public.interview_prasyarat_eskalasi FROM anon;
REVOKE ALL ON public.interview_prasyarat_eskalasi FROM authenticated;
ALTER TABLE public.interview_prasyarat_eskalasi ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- (2) Katalog notifikasi v6 — 1 event (mekanisme O55).
-- ---------------------------------------------------------------------------
INSERT INTO notif_catalog_versions (version, description, event_count, decision_ref) VALUES
    (6,
     'Interview — eskalasi prasyarat menggantung: 1 event (kualifikasi_prasyarat_menggantung, >= 2 per AM)',
     1,
     'docs/DECISIONS.md 2026-08-11 (Interview — bagian 2: resolusi + eskalasi N=2)');

INSERT INTO notif_events (event_type, description, resolver, catalog_version) VALUES
    ('kualifikasi_prasyarat_menggantung',
     '>= 2 prasyarat bersyarat menggantung pada satu AM (belum selesai, lewat hari-7) — eskalasi ke SPV + Head of Account',
     'leadsOfDivision', 6);

-- ---------------------------------------------------------------------------
-- (3) interview_daily_tick — blok (a)–(d) sama dengan 20260811070000; blok (e) baru.
-- ---------------------------------------------------------------------------
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

    -- (e) Eskalasi "prasyarat menggantung" (keputusan pemilik 2026-08-11, N=2):
    -- AM dengan >= 2 interview ber-flag prasyarat_bersyarat_terlambat DAN prasyarat
    -- belum selesai ⇒ eskalasi ke Account lead/SPV, SEKALI per episode. Re-arm saat
    -- jumlah turun < 2 (episode ditutup, diam). FULL OUTER JOIN supaya AM yang
    -- jumlahnya jatuh ke 0 (hilang dari agregat) tetap ter-reconcile lewat baris
    -- state-nya. State ditulis di sini (bukan diandalkan dari route) — idempoten
    -- terhadap p_now sama.
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
            -- Re-arm: episode ditutup, tak ada notifikasi.
            UPDATE interview_prasyarat_eskalasi
               SET ter_eskalasi = false, jumlah_terakhir = r.jumlah, updated_at = p_now
             WHERE am_pengisi_id = r.am;
        END IF;
    END LOOP;

    RETURN v_actions;
END;
$$;
