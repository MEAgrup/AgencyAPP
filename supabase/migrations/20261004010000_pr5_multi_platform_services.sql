-- ===========================================================================
-- PR-5: layanan multi-platform — platform jadi bagian identitas baris
-- ===========================================================================
--
-- ── Ketokan (DECISIONS.md 2026-09-10, "KETOKAN PR-5") ─────────────────────
--
-- Permintaan pemilik verbatim: "kalau ada klien yg membeli produk sama untuk
-- 2 platform, saat ini tidak bisa. padahal seharusnya bisa dan harga menjadi
-- 2x. ini artinya ada 2 service berbeda, ada 2 link toko yg berbeda. sama
-- juga ketika input komisi, bisa ada 2 platform yg memberikan 2 komisi
-- berbeda." Ini MEMBALIK SEBAGIAN ketokan Nerissa 2026-08-07 ("jasa yang sama
-- dua kali dalam satu set kini DITOLAK … quantity-lah field untuk 'dua unit
-- jasa ini', bukan baris kedua") — aturan barunya:
--   (a) `qty`   = lebih banyak unit layanan yang SAMA, di TOKO yang sama;
--   (b) baris KEDUA hanya sah kalau platform/toko-nya BERBEDA, dan tiap baris
--       membawa `store_link`-nya (dan `commission_rule`-nya — kolom itu SUDAH
--       per-baris sejak awal) SENDIRI;
--   (c) `uq_qfs` TIDAK DICABUT — kuncinya DIPERLEBAR dari
--       `(attempt_id, master_service_id)` menjadi
--       `(attempt_id, master_service_id, platform)`.
--
-- ── Kenapa `negotiation_proposal_lines` ikut kena, bukan cuma `uq_qfs` ────
--
-- `loadApprovedLines` (packages/domain/src/sales.ts) menyambung tiap baris
-- proposal ke snapshot Qualified dengan
-- `qfs.attempt_id = np.attempt_id AND qfs.master_service_id = npl.master_service_id`.
-- Melebarkan `uq_qfs` SAJA membuat DUA baris `qualified_form_services` sah
-- untuk satu `master_service_id` (platform berbeda) — dan kunci join yang
-- masih sempit itu akan MELIPATGANDAKAN hasilnya: 2 baris `qfs` × N baris
-- `npl` yang cocok. Karena itu `negotiation_proposal_lines` butuh kolom
-- `platform`-nya SENDIRI juga, dan join di `loadApprovedLines` (serta padanan
-- baca-sajanya di `getAttempt`) diperlebar bersamaan mengikutinya —
-- persis urutan yang dicatat di ketokan: kunci join duluan, baru `uq_qfs`.
-- Nol perubahan pada `renewal_proposal_lines`: ketokan ini TIDAK menyebut
-- renewal, dan melebarkannya di sana bukan cakupan yang diminta.
--
-- ── Kenapa ini juga melunasi utang 2026-08-27 ─────────────────────────────
--
-- `close()` dulu memecah `qualified_forms.platform` (string koma-gabungan
-- checklist FE) jadi satu baris `client_platforms` per platform, tapi SEMUA
-- baris itu mendapat `qf.store_link` yang SAMA (dicatat eksplisit sebagai
-- "BELUM, di luar cakupan" 2026-08-27). Sekarang setiap baris
-- `qualified_form_services` boleh membawa `store_link`-nya sendiri, jadi
-- `close()` bisa memberi tiap `client_platforms` link yang benar-benar
-- miliknya — bukan cakupan baru, melunasi utang yang sudah tercatat.
--
-- ── Backfill ───────────────────────────────────────────────────────────────
--
-- Data lama (SEBELUM migrasi ini) dijamin nol duplikat oleh `uq_qfs` yang
-- lama (dua kolom), jadi setiap `qualified_form_services` yang sudah ada
-- adalah SATU-SATUNYA baris untuk `master_service_id`-nya di attempt itu —
-- mem-back-fill `platform`-nya dari `qualified_forms.platform` (token
-- PERTAMA sebelum koma, sama seperti FE `qPlatforms.join(', ')` menuliskannya
-- dan `close()` selalu membacanya) TIDAK bisa salah tafsir dengan baris lain.
-- `store_link` lama diwarisi dari `qualified_forms.store_link` verbatim —
-- itu memang link yang SEDANG dipakai setiap platform hari ini.
--
-- `negotiation_proposal_lines.platform` di-backfill dua tahap: (1) baris yang
-- PERSIS cocok ke satu `qualified_form_services` (via `master_service_id`,
-- join yang SAMA seperti sebelum migrasi ini — jaminan 1:1 yang sama berlaku)
-- mewarisi platform baris itu; (2) baris ADDED-during-negotiation yang tidak
-- pernah punya snapshot Qualified (Edit Service / layanan tambahan) jatuh ke
-- platform PERTAMA form-nya — bacaan yang sama seperti `writeProposal` akan
-- pakai untuk baris baru tanpa `platform` eksplisit.
--
-- Gate TIDAK bergerak: nol tabel, nol prefix, nol mesin, nol event — hanya
-- kolom pada dua tabel yang sudah ada.
-- ===========================================================================

-- 1) qualified_form_services: kolom baru, lalu backfill, lalu NOT NULL.
ALTER TABLE qualified_form_services ADD COLUMN platform varchar(64);
ALTER TABLE qualified_form_services ADD COLUMN store_link varchar(255);

UPDATE qualified_form_services qfs
SET platform = trim(split_part(qf.platform, ',', 1)),
    store_link = qf.store_link
FROM qualified_forms qf
WHERE qf.attempt_id = qfs.attempt_id
  AND qfs.platform IS NULL;

ALTER TABLE qualified_form_services ALTER COLUMN platform SET NOT NULL;

-- 2) `uq_qfs` diperlebar — TIDAK dicabut tanpa pengganti (lihat catatan di atas
--    untuk kenapa urutan ini WAJIB sesudah langkah 1, bukan sebelum).
ALTER TABLE qualified_form_services DROP CONSTRAINT uq_qfs;
ALTER TABLE qualified_form_services
  ADD CONSTRAINT uq_qfs UNIQUE (attempt_id, master_service_id, platform);

-- 3) negotiation_proposal_lines: kolom baru + backfill dua tahap + NOT NULL.
ALTER TABLE negotiation_proposal_lines ADD COLUMN platform varchar(64);

UPDATE negotiation_proposal_lines npl
SET platform = qfs.platform
FROM negotiation_proposals np, qualified_form_services qfs
WHERE np.id = npl.proposal_id
  AND qfs.attempt_id = np.attempt_id
  AND qfs.master_service_id = npl.master_service_id
  AND npl.platform IS NULL;

UPDATE negotiation_proposal_lines npl
SET platform = sub.primary_platform
FROM (
  SELECT np.id AS proposal_id, trim(split_part(qf.platform, ',', 1)) AS primary_platform
  FROM negotiation_proposals np
  JOIN qualified_forms qf ON qf.attempt_id = np.attempt_id
) sub
WHERE npl.proposal_id = sub.proposal_id
  AND npl.platform IS NULL;

ALTER TABLE negotiation_proposal_lines ALTER COLUMN platform SET NOT NULL;
