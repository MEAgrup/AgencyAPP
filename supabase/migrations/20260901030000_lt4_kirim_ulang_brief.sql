-- CDPS M16 — LT-4 DIPUTUSKAN (pemilik, 2026-08-29: "jalankan rekomendasi B").
-- `Brief Dikembalikan ke AM` berhenti menjadi dead-end: AM yang sudah
-- memperbaiki brief bisa MENGIRIM ULANG Brief YANG SAMA kembali ke
-- `Cek Brief AM`, alih-alih membuat Brief baru untuk pekerjaan yang sama.
--
-- Nol tabel/mesin/prefix/event baru — hanya `sm_edges` + `stage_definition`.
-- Gate TETAP: tabel 128, entity_prefix 36, sm_machines 29, notif_events 65.
--
-- ---------------------------------------------------------------------------
-- 1. EDGE BALIK — empat pipeline, bukan lima
-- ---------------------------------------------------------------------------
-- Live Stream (`stage_live`) TIDAK punya state `Cek Brief AM` sama sekali
-- (LT-5, keputusan disengaja — pipeline-nya mulai di `Terima Sampel`), jadi ia
-- juga tidak punya state `Brief Dikembalikan ke AM` dan tidak ada edge yang
-- bisa ditambahkan untuknya. Empat sisanya dapat edge balik yang identik.
--
-- ---------------------------------------------------------------------------
-- 2. KENAPA `stage_definition` IKUT DITAMBAH (bukan sm_edges saja)
-- ---------------------------------------------------------------------------
-- `advanceStage` (stage.ts) memilih gerbangnya dari `gate_pihak` tahap SAAT
-- INI. Tanpa baris `stage_definition`, `Brief Dikembalikan ke AM` jatuh ke
-- cabang default `canExecuteStage(actor, assigned_division, assigned_pic)` —
-- artinya DIVISI yang bisa mengirim ulang, dan AM (divisi Account) justru
-- TIDAK bisa. Itu kebalikan persis dari alur yang diminta LT-4. Karena itu
-- tahap ini didaftarkan dengan `gate_pihak = 'AM'`: gerbang PERAN (hanya AM
-- pemilik klien atau Director yang menjalankan transisi keluar), semantik yang
-- sama dengan tahap `Approve` AI Optimizer SKU — lihat LT-6.
--
-- `urutan = 99` (bukan disisipkan di antara 1 dan 2): tahap ini CABANG, bukan
-- langkah linear. 99 menjaganya selalu di baris terakhir timeline dan tidak
-- pernah bertabrakan dengan `uq_stage_definition_urutan`, sehingga penomoran
-- tahap normal (1..8) tetap terbaca apa adanya oleh siapa pun. Brief yang tidak
-- pernah dikembalikan mendapat masukPada/keluarPada NULL untuk baris ini
-- (boundariesFor: state tanpa transisi) => hariKerja null, status N/A, nol
-- pengaruh ke `totalHariKerja`.
--
-- `target_hari_kerja = NULL` (N/A, PRD §2 Rule 8 — tidak pernah di-default
-- diam-diam): pemilik belum memberi angka "berapa lama AM boleh memperbaiki
-- brief yang dikembalikan". Untuk Brief yang MEMANG dikembalikan, durasinya
-- tetap TERUKUR dan tetap masuk `totalHariKerja` — konsisten dengan LT-6
-- (`gate_pihak='AM'` adalah gerbang peran, BUKAN pengecualian lead time; hanya
-- `KLIEN` yang dikecualikan, Rule 9). Itu memang inti M16 §6: waktu AM berhenti
-- tersembunyi di dalam skor divisi.
--
-- ---------------------------------------------------------------------------
-- 3. YANG TETAP SEPERTI SEMULA (sengaja)
-- ---------------------------------------------------------------------------
-- * `sm_terminal_states` TIDAK menerima `Brief Dikembalikan ke AM` — alasannya
--   tidak berubah dan justru makin kuat: guard `submitTask` (LT-26) membaca
--   tabel itu untuk memutuskan "tahapan sudah selesai?", dan Brief yang
--   dikembalikan justru BELUM dikerjakan. Menambah edge KELUAR tidak
--   menjadikannya tahap sukses.
-- * `listNextStages` (stage.ts) tetap menyaring `Brief Dikembalikan ke AM`
--   sebagai TUJUAN — edge masuk ke sana tetap milik `reviewBrief` (butuh
--   `alasan_kode`, menulis `brief_review`). Yang disaring tujuan, bukan asal,
--   jadi dari `Brief Dikembalikan ke AM` tombol "Cek Brief AM" muncul otomatis.
-- * `brief_review` tetap APPEND-ONCE (aturan rumah #3): pengembalian pertama
--   adalah catatan permanen, dan kiriman ulang TIDAK menghapusnya. Setelah
--   Brief kembali ke `Cek Brief AM`, divisi menerimanya lewat `advanceStage`
--   ke tahap kerja pertama (edge yang sudah ada, gerbang divisi) — bukan lewat
--   `reviewBrief` kedua, yang tetap 409 seperti sebelumnya.

-- ===========================================================================
-- 1. sm_edges — edge balik `Brief Dikembalikan ke AM` -> `Cek Brief AM`.
--    require_lead = false: gerbangnya AM pemilik (gate_pihak, ditegakkan TS),
--    bukan "lead divisi eksekusi" — flag itu salah semantik untuk AM, persis
--    catatan seed 20260830020000.
-- ===========================================================================
INSERT INTO sm_edges (machine, from_state, to_state, require_lead) VALUES
    ('stage_creative',     'Brief Dikembalikan ke AM', 'Cek Brief AM', false),
    ('stage_kol',          'Brief Dikembalikan ke AM', 'Cek Brief AM', false),
    ('stage_ai_opt_sku',   'Brief Dikembalikan ke AM', 'Cek Brief AM', false),
    ('stage_ai_opt_video', 'Brief Dikembalikan ke AM', 'Cek Brief AM', false);

-- ===========================================================================
-- 2. stage_definition — checkpoint pengembalian, satu per pipeline yang punya.
--    label identik stage_code (konvensi M16, LT-7 belum meminta lain).
-- ===========================================================================
INSERT INTO stage_definition
    (pipeline_code, stage_code, label, urutan, sumber, status_dipetakan, gate_pihak, target_hari_kerja) VALUES
    ('CREATIVE_CONTENT', 'Brief Dikembalikan ke AM', 'Brief Dikembalikan ke AM', 99, 'stage', NULL, 'AM', NULL),
    ('KOL_DEFAULT',      'Brief Dikembalikan ke AM', 'Brief Dikembalikan ke AM', 99, 'stage', NULL, 'AM', NULL),
    ('AI_OPT_SKU',       'Brief Dikembalikan ke AM', 'Brief Dikembalikan ke AM', 99, 'stage', NULL, 'AM', NULL),
    ('AI_OPT_VIDEO',     'Brief Dikembalikan ke AM', 'Brief Dikembalikan ke AM', 99, 'stage', NULL, 'AM', NULL);
