-- CDPS — Amandemen katalog notifikasi ke v5 (Interview / "Kelola Klien" tab 1).
--
-- ---------------------------------------------------------------------------
-- KENAPA v5, BUKAN "v2 / 37 event"
-- ---------------------------------------------------------------------------
-- Spesifikasi Interview ditulis terhadap baseline lama ("base 15 + 4 + 6 + 3 +
-- 9 = 37, satu migrasi, satu version row = 2"). Baseline itu sudah usang: sejak
-- O55 (20260807010000) katalog BERVERSI, dan amandemen 6A/6B/6C (v2), M5-OA-7
-- (v3) dan A-08 (v4) SUDAH di-apply. Melipat 9 event Interview ke "v2" mustahil
-- — migrasi v2 sudah beku (tidak boleh mengedit migrasi yang sudah di-apply) —
-- dan menambah event tanpa baris versi melanggar invariant O55. Jalur yang benar
-- di repo ini adalah persis mekanisme yang O55 buat: SATU baris versi baru (v5)
-- dengan jumlah event yang ia perkenalkan. Total katalog: 34 + 9 = 43.
--
-- Tidak ada tes `== 15` yang perlu diubah: O55 sudah menggantinya dengan
-- invariant registry (SUM(event_count) = COUNT(notif_events)). Menambah v5 di
-- sini + baris versi = amandemen yang terlihat, bukan penyentuhan invariant beku.
--
-- ---------------------------------------------------------------------------
-- ISI v5 — 9 event (verbatim dari tabel notifikasi spesifikasi Interview)
-- ---------------------------------------------------------------------------
-- Semua ADVISORY. `kualifikasi_tidak_siap` INFORMASIONAL — verdict tidak pernah
-- memblok apa pun (keputusan v5 modul Interview: verdict advisory non-blocking).
-- Penamaan polos (tanpa `mN.`) mengikuti aturan v2 `strategi_*`: spesifikasi
-- menuliskan identifier-nya sendiri, jadi tidak dikarang ulang.
--
-- Resolver diturunkan dari kolom "Recipients":
--   satu penerima eksplisit           -> explicit
--   hanya lead/SPV sebuah divisi      -> leadsOfDivision
--   penerima eksplisit DAN lead/SPV   -> explicitOrLeads

INSERT INTO notif_catalog_versions (version, description, event_count, decision_ref) VALUES
    (5,
     'Interview / Kelola Klien tab 1 — 9 event; semua advisory (kualifikasi_tidak_siap informasional, verdict tidak memblok)',
     9,
     'docs/DECISIONS.md 2026-08-11 (Interview — verdict advisory non-blocking)');

INSERT INTO notif_events (event_type, description, resolver, catalog_version) VALUES
    ('interview_dijadwalkan',              'Jadwal interview diset/diubah (IA-3) — ke AM + SPV',                                  'explicitOrLeads', 5),
    ('interview_pengingat',                'Pengingat interview H-1 08:00 & H-hari 07:00 WIB — ke AM',                            'explicit',        5),
    ('interview_terlewat',                 'Interview terlewat (harian, maks 7) lalu eskalasi SPV — ke AM, lalu SPV',             'explicitOrLeads', 5),
    ('interview_butuh_data_klien',         'Status Butuh Data Klien — nudge tiap 3 hari (maks 5) — ke AM',                        'explicit',        5),
    ('interview_diajukan_dengan_kekosongan','Blok B diajukan dengan kekosongan (I11) — permintaan persetujuan ke SPV',            'leadsOfDivision', 5),
    ('interview_selesai',                  'Interview Selesai / Selesai Dengan Catatan — ke AM + SPV + Head of Account',          'explicitOrLeads', 5),
    ('kualifikasi_tidak_siap',             'Verdict tidak_siap (informasional, tidak memblok apa pun) — ke SPV + Head of Account','leadsOfDivision', 5),
    ('kualifikasi_turun',                  'Re-interview menurunkan verdict pada kontrak berjalan — ke SPV + Head of Account',    'leadsOfDivision', 5),
    ('interview_versi_baru',               'Versi re-interview disetujui dengan perubahan field ter-mapping — ke AM + SPV',       'explicitOrLeads', 5);
