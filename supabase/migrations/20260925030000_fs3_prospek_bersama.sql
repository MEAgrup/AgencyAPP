-- ============================================================================
-- FS-3 (Feedback tim Sales 2026-09-08 #3) — PROSPEK BERSAMA.
--
-- KELUHANNYA. "ada prospek didaftarkan leads oleh sales a pada bulan agustus,
-- kemudian menghubungi sales b di bulan september. Buat notifikasi kalau
-- prospek tersebut menghubungi sales untuk sales a, dan sales b melakukan
-- aktifitas contacted, meeting dll. Prospek tersebut otomatis menjadi prospek
-- bersama."
--
-- APA YANG SUDAH JALAN, DAN KENAPA ITU MENGUBAH BENTUK MIGRASI INI.
-- Sebagian besar sudah ada dan sudah benar. Pintu pendaftaran tunggal (dan
-- batch, yang mendelegasikan ke sana) memanggil `decide(CHANNEL_SINGLE_REG,…)`,
-- yang untuk lead yang sedang dipegang sales LAIN mengembalikan outcome
-- **`join`** — bukan `block`. `register()` lalu: mencetak `PRSP-` kedua untuk
-- sales B, menulis audit `dedup_join`, dan MENGIRIM notifikasi
-- `m1.lead.co_pursuit` ke pemilik attempt yang lama. Sales B juga sudah bisa
-- mencatat Contacted/Meeting di attempt-nya sendiri.
--
-- Jadi TIDAK ada endpoint baru, TIDAK ada tombol "jadikan prospek bersama",
-- dan TIDAK ada event notifikasi baru di migrasi ini: menambahkannya berarti
-- membangun pintu KEDUA ke aturan yang sudah punya pintu — persis kelas
-- kesalahan yang dijaga di tempat lain. Gate `notif_events` TETAP 73.
--
-- YANG BENAR-BENAR HILANG ADA DUA.
--
-- (1) Tidak ada penanda bahwa sebuah attempt lahir sebagai prospek bersama.
--     "Dikerjakan berdua" hari ini hanya bisa disimpulkan dari baris audit —
--     dan menurunkan perilaku UANG dari baris audit adalah hal yang rapuh.
--     ⇒ `bersama_dengan_attempt_id`, menunjuk attempt yang SUDAH ada saat
--     attempt ini lahir. Mengikuti preseden `contracts.contract_sebelumnya_id`
--     (20260901040000). "Lead ini dikerjakan bersama" jadi TURUNAN dari
--     keberadaan penunjuk itu — bukan flag kedua yang bisa berbeda dengan
--     kenyataannya.
--
-- (2) Saat salah satu menutup deal, `resolveWin` menutup attempt yang lain
--     sebagai `[Closed - Kalah Kompetisi]`. Untuk kontes lead Pool itu BENAR
--     dan tetap begitu. Untuk prospek bersama itu SALAH: ketokan pemilik
--     (FS-1) adalah kepemilikan menjadi bersama dan komisi dibagi di antara
--     mereka. Sales A yang memegang 50% komisi tapi tercatat "kalah kompetisi"
--     adalah dua pernyataan yang saling meniadakan pada orang yang sama — dan
--     yang salah TIDAK PERNAH melempar galat, ia cuma menurunkan angka
--     contested-win-rate seseorang diam-diam di dashboard Kinerja Sales.
--     ⇒ state terminal baru `[Closed - Prospek Bersama]`.
--
-- Nol tabel, nol prefix, nol event, nol MESIN baru (state ditambahkan ke mesin
-- `prospect_attempt` yang sudah ada) ⇒ gate 147/41/32/73 TETAP.
-- ============================================================================

-- --- (1) Penanda prospek bersama --------------------------------------------
ALTER TABLE prospect_attempts
    ADD COLUMN bersama_dengan_attempt_id varchar(32) NULL;

ALTER TABLE prospect_attempts
    ADD CONSTRAINT fk_prsp_bersama
        FOREIGN KEY (bersama_dengan_attempt_id) REFERENCES prospect_attempts (id),
    -- Sebuah attempt tidak bisa jadi prospek bersama DENGAN DIRINYA SENDIRI.
    -- Murah untuk dipasang, dan tanpanya satu bug penulisan akan membuat
    -- `resolveWin` menutup attempt pemenang sebagai Prospek Bersama.
    ADD CONSTRAINT ck_prsp_bersama_bukan_diri CHECK (
        bersama_dengan_attempt_id IS NULL OR bersama_dengan_attempt_id <> id);

CREATE INDEX idx_prsp_bersama ON prospect_attempts (bersama_dengan_attempt_id)
    WHERE bersama_dengan_attempt_id IS NOT NULL;

COMMENT ON COLUMN prospect_attempts.bersama_dengan_attempt_id IS
  'FS-3: attempt yang sudah ada saat attempt ini lahir lewat outcome `join` (prospek menghubungi sales kedua). NULL untuk attempt tunggal DAN untuk kontes lead Pool — dua hal yang perlakuan win-resolution-nya berbeda.';

-- --- (2) State terminal yang tidak menghukum --------------------------------
-- Edge-nya PERSIS sama dengan yang menuju `[Closed - Kalah Kompetisi]`:
-- diturunkan dari tabel itu sendiri, bukan diketik ulang, supaya keduanya
-- tidak bisa menyimpang kalau nanti ada state hulu baru.
INSERT INTO sm_terminal_states (machine, state) VALUES
    ('prospect_attempt', '[Closed - Prospek Bersama]');

INSERT INTO sm_edges (machine, from_state, to_state, require_lead)
SELECT machine, from_state, '[Closed - Prospek Bersama]', require_lead
  FROM sm_edges
 WHERE machine = 'prospect_attempt'
   AND to_state = '[Closed - Kalah Kompetisi]';
