-- ============================================================================
-- PDT G3-02 (G3-REFERENCE-PERIODE opsi (B), docs/DECISIONS.md 2026-09-17
-- "G3-REFERENCE-PERIODE DIKETOK") — periode PDT yang diikat Section B3
-- (refund rate, pengunjung/bulan, conversion rate, poin penalti, dan
-- G3-03..G3-06 setelahnya) DIDEKLARASIKAN AM SENDIRI, cermin
-- `periode_baseline_bulan` (B-0.7) — BUKAN otomatis "batch verified terbaru"
-- (opsi A ditolak) dan BUKAN "periode skor interview" (opsi C ditolak): AM
-- yang mendeklarasikan jendela mundur dari bulan lampau harus mendapat data
-- BULAN ITU, bukan data PDT paling baru hari ini.
--
-- Nullable, tanpa FK ke `pdt_upload_batch` — pola sama `periode_baseline_bulan`/
-- `periode_mulai`/`periode_akhir` di tabel yang sama (partial-save Section B,
-- `20260822020000_b0_partial_save.sql`: shape-only di save, requiredness/
-- cross-field di submit gate `checkCompleteness`). CHECK lintas tabel ke
-- `pdt_upload_batch.status='verified'` tidak bisa dinyatakan di Postgres;
-- penegakannya di jalur baca (`getBaselinePrefill`, `packages/domain/src/
-- strategi.ts`) — periode yang tidak cocok batch verified mana pun membuat
-- pembaca `pdt_fact_*` mengembalikan `null` per field, jatuh ke payload Riset
-- Awal lama (strangler coexistence, pola sama G3-07) — TIDAK PERNAH angka yang
-- diam-diam salah, karena null selalu berarti manual, tidak pernah nol.
-- ============================================================================
ALTER TABLE strategi_channel
  ADD COLUMN periode_referensi_pdt date NULL;

-- Awal bulan saja (sama grain `pdt_upload_batch.periode_mulai`/
-- `pdt_fact_shop_daily.tanggal` teragregasi bulanan) — TS (`validateChannel`)
-- memberi pesan BI; CHECK ini dinding terakhir.
ALTER TABLE strategi_channel
  ADD CONSTRAINT ck_strch_periode_referensi_pdt_awal_bulan
  CHECK (periode_referensi_pdt IS NULL
         OR periode_referensi_pdt = date_trunc('month', periode_referensi_pdt)::date);

COMMENT ON COLUMN strategi_channel.periode_referensi_pdt IS
  'G3-REFERENCE-PERIODE opsi (B), docs/DECISIONS.md 2026-09-17: periode PDT (awal bulan) yang AM deklarasikan sendiri sebagai acuan Section B3 (refund rate, pengunjung/bulan, conversion rate, poin penalti, dan G3-03..G3-06) begitu sumbernya pdt_fact_*. NULL = belum dideklarasikan, jatuh ke payload Riset Awal lama (strangler coexistence, pola sama G3-07).';
