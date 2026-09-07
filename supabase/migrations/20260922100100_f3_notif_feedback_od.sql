-- ============================================================================
-- F-3 — katalog notifikasi v15, empat event dari "Feedback Final - OD"
-- (2026-09-07).
--
-- SATU bump untuk keempatnya, dan itu bukan penghematan gaya. Dua invariant
-- mengunci katalog ini:
--   * `notification.test.ts`   : COUNT(events()) == Σ eventCount per versi;
--   * `notif_catalog.reals.test.ts` : (event_type, catalog_version, resolver)
--                                     set-equal TS ↔ DB.
-- Dua bump dari dua jalur paralel memecahkan keduanya, dua kali. Preseden yang
-- diikuti apa adanya: v12 (`20260829001000_m16_fondasi.sql`, dua stream M16).
--
-- MENDAFTARKAN EVENT TANPA EMITTER ITU AMAN — gate-nya membandingkan NAMA
-- event, bukan keberadaan pemanggilnya. Emitter dipasang jalur masing-masing:
-- dua event Brief di `recomputeBriefRollup`, dua event KOL di job tick.
--
-- ---------------------------------------------------------------------------
-- EMPAT EVENT, DAN KE SIAPA
-- ---------------------------------------------------------------------------
--   m6.brief.siap_review_am    Brief lolos QC internal divisi dan menunggu
--       review AM — ke AM pemilik klien (resolver 'explicit').
--   m6.brief.selesai           Rollup Brief mencapai selesai — ke AM pemilik
--       klien (resolver 'explicit').
--
--       Kedua event ini menutup ujung yang DIAM, dan itu keluhan Account #3 &
--       #4: katalog v12 memberi tahu AM saat divisi MENERIMA
--       (`m16.brief.diterima_divisi`) atau MENGEMBALIKAN
--       (`m16.brief.dikembalikan`) sebuah Brief — lalu tidak pernah lagi.
--       Divisi bilang "sudah beres"; yang dilihat AM cuma status yang tidak
--       bergerak, tanpa satu pun pesan yang menjelaskan kenapa.
--
--   m9.booking.jatuh_tempo     Booking KOL mendekati (H-1) atau melewati
--       jatuh tempo — ke koordinator KOL + AM pemilik klien (resolver
--       'explicitOrLeads').
--   m9.campaign.mendekati_akhir  Campaign KOL mendekati tanggal akhir — ke
--       koordinator KOL + AM pemilik klien (resolver 'explicitOrLeads').
--
--       Keluhan KOL #1. Worksheet KOL aslinya berputar di sekitar `end date`
--       dan jatuh tempo; CDPS tidak pernah membunyikan keduanya, jadi timnya
--       tetap memakai Google Sheet paralel untuk pekerjaan yang seharusnya
--       sudah dipegang CDPS.
--
-- Gate hitung notif_events 69 → 73 dinaikkan di `.github/workflows/ci.yml` DAN
-- `scripts/db-rebuild.sh` bersama migrasi ini — angka yang sama hidup di DUA
-- berkas, dan menaikkan salah satunya saja berarti lokal hijau CI merah
-- (PR #170). Nol tabel/prefix/mesin baru ⇒ gate 146 tabel / 40 prefix /
-- 31 mesin TETAP. Invariant O55 (Σ event_count = COUNT(notif_events)) tetap
-- dijaga — JANGAN hardcode 73 di TS.
-- ============================================================================

INSERT INTO notif_catalog_versions (version, description, event_count, decision_ref) VALUES
    (15,
     'Feedback OD 2026-09-07 — 4 event: 2 Brief menutup ujung diam ke AM (m6.brief.siap_review_am → AM pemilik klien saat QC internal divisi lolos; m6.brief.selesai → AM pemilik klien saat rollup Brief mencapai selesai) + 2 KOL berbasis waktu (m9.booking.jatuh_tempo → koordinator KOL + AM saat Booking mendekati/lewat jatuh tempo; m9.campaign.mendekati_akhir → koordinator KOL + AM saat campaign mendekati tanggal akhir). Didaftarkan sekaligus dalam SATU bump karena dua jalur paralel mengerjakan emitternya masing-masing; emitter Brief di recomputeBriefRollup, emitter KOL di job tick.',
     4,
     'docs/DECISIONS.md 2026-09-07 (K-1..K-7) + docs/handoff/PARALEL_FEEDBACK_OD_DUA_AKUN.md §1 F-3');

INSERT INTO notif_events (event_type, description, resolver, catalog_version) VALUES
    ('m6.brief.siap_review_am',
     'Brief lolos QC internal divisi dan menunggu review AM — ke AM pemilik klien',
     'explicit',
     15),
    ('m6.brief.selesai',
     'Rollup Brief mencapai selesai — ke AM pemilik klien',
     'explicit',
     15),
    ('m9.booking.jatuh_tempo',
     'Booking KOL mendekati (H-1) atau melewati jatuh tempo — ke koordinator KOL + AM pemilik klien',
     'explicitOrLeads',
     15),
    ('m9.campaign.mendekati_akhir',
     'Campaign KOL mendekati tanggal akhir — ke koordinator KOL + AM pemilik klien',
     'explicitOrLeads',
     15);
