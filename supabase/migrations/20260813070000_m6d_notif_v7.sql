-- CDPS — Module 6D (Rekap Hasil Mingguan) — D-07: KATALOG NOTIFIKASI v7 (+4 event).
--
-- ---------------------------------------------------------------------------
-- KENAPA v7 = 48, BUKAN "v3 = 31" (premis SESI1 basi — PRD §10.1-C)
-- ---------------------------------------------------------------------------
-- Draf M6D SESI1 mengira katalog masih "v2 = 28 → +3 = v3 = 31". Itu USANG:
-- sejak O55 (20260807010000) katalog BERVERSI dan sudah tumbuh lewat v2..v6.
-- Katalog live di packages/core/src/notification.ts kini v6 = 44 event
-- (v1=17, v2=14, v3=2, v4=1, v5=9, v6=1). M6D karenanya mendaftar SATU versi
-- baru v7 — dengan RM-8 kini wajib, +4 event → v7 = 48 (3 event rekap + 1
-- catatan divisi wajib). Owner menandatangani v7=48 pada 2026-08-13 ("Iya ini
-- benar.", DECISIONS.md), mencabut gerbang sign-off M6B PA-8. Registrasi lewat
-- SATU baris notif_catalog_versions (event_count: 4) — invariant O55 menghitung
-- SUM(event_count) = COUNT(notif_events), JANGAN hardcode literal 48.
--
-- ---------------------------------------------------------------------------
-- ISI v7 — 4 event M6D (verbatim tabel §9 / §10.1-C PRD)
-- ---------------------------------------------------------------------------
--   45 rekap_mingguan_terbuka          Rekap dibuka (job Senin)        -> AM/CRO pemilik klien
--   46 rekap_mingguan_belum_dikonfirmasi Belum dikonfirmasi N=2 hari kerja setelah minggu tutup -> AM/CRO + SPV
--   47 rekap_sengketa_angka            AM ajukan Sengketa Angka atas angka otomatis -> SPV
--   48 catatan_divisi_belum_diisi      Divisi berutang catatan wajib (RM-8) belum isi saat tutup -> lead divisi + AM
--
-- Penamaan polos (tanpa `mN.`) mengikuti aturan v2 `strategi_*` / v5
-- `interview_*`: PRD menuliskan identifier-nya sendiri (§9/§10.1-C), jadi tak
-- dikarang ulang. Resolver diturunkan dari kolom "Recipients" (aturan O55):
--   satu penerima eksplisit           -> explicit          (#45: AM saja)
--   hanya lead/SPV sebuah divisi      -> leadsOfDivision   (#47: SPV Account saja)
--   penerima eksplisit DAN lead/SPV   -> explicitOrLeads   (#46: AM+SPV; #48: AM+lead divisi)
--
-- Emisi event-nya (bukan katalog, itu di sini) dipasang di jalur pemicunya:
--   * rekap_mingguan_terbuka + rekap_mingguan_belum_dikonfirmasi + catatan_divisi_belum_diisi
--     (dari force-close) = job D-06 (20260813080000).
--   * rekap_sengketa_angka + catatan_divisi_belum_diisi (dari AM close) = domain D-09.
-- Katalog HARUS mendahului emisi: notify_emit menolak event yang tak terdaftar.
--
-- ⚠️ Gate hitung notif_events 44 → 48 di DUA berkas — .github/workflows/ci.yml
-- + scripts/db-rebuild.sh — dinaikkan bersama migrasi ini (satu commit).
-- Migrasi lewat supabase/migrations/** + apply_migration — JANGAN `psql -f`
-- (O38). DB lokal rebuild HANYA lewat scripts/db-rebuild.sh.

INSERT INTO notif_catalog_versions (version, description, event_count, decision_ref) VALUES
    (7,
     'M6D Rekap Hasil Mingguan — 4 event (rekap_mingguan_terbuka, rekap_mingguan_belum_dikonfirmasi, rekap_sengketa_angka, catatan_divisi_belum_diisi wajib RM-8)',
     4,
     'docs/DECISIONS.md 2026-08-13 (RM-6 sign-off v7=48; RM-8 catatan divisi wajib)');

INSERT INTO notif_events (event_type, description, resolver, catalog_version) VALUES
    ('rekap_mingguan_terbuka',           'Rekap hasil mingguan dibuka (job Senin 00:00 WIB) — ke AM/CRO pemilik klien',                       'explicit',        7),
    ('rekap_mingguan_belum_dikonfirmasi','Rekap belum dikonfirmasi N=2 hari kerja setelah minggu tutup — ke AM/CRO + SPV',                    'explicitOrLeads', 7),
    ('rekap_sengketa_angka',             'AM mengajukan Sengketa Angka atas angka otomatis (RM-B6/RM-C) — ke SPV',                            'leadsOfDivision', 7),
    ('catatan_divisi_belum_diisi',       'Divisi berutang catatan mingguan wajib (RM-8) belum mengisi saat rekap tutup — ke lead divisi + AM','explicitOrLeads', 7);
