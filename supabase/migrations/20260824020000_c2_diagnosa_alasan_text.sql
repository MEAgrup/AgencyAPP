-- CDPS — M6A Section C, C-2: field-ID baseline citation → free-text alasan.
--
-- ## Kenapa (owner QA 2026-08-24, DECISIONS.md, STRG-202608-0001 lanjutan)
-- C-2 dulu mewajibkan AM mengetik minimal satu field-ID baseline ("B-2.2
-- B-3.6") dari daftar tertutup 50+ ID (`VALID_BASELINE_FIELD_IDS`,
-- `packages/domain/src/strategi.ts`) tanpa ada UI pencarian/lookup untuk
-- daftar itu di form. Ini menyulitkan AM mencari kode yang benar, bukan
-- memberi bukti yang berguna. PRD (`docs/prd/CDPS_Module6A_Strategi.md`
-- Rule 6, C-2) diamandemen: C-2 sekarang cukup uraian bebas (alasan/bukti
-- kenapa bottleneck ini yang dipilih).
--
-- ## Yang diubah
--   strategi_diagnosa.field_ids (jsonb array, NOT NULL DEFAULT '[]') →
--   strategi_diagnosa.alasan    (text, NOT NULL, non-empty enforced by CHECK;
--                                 the closed-set membership check lived in
--                                 domain only, so there is nothing to port).
--   ck_strdiag_field_ids_array  dropped, replaced by ck_strdiag_alasan_notempty.
--
-- Existing rows: field_ids values (if any) are folded into a readable string
-- so no diagnosa data is silently dropped by the rename.

ALTER TABLE strategi_diagnosa ADD COLUMN alasan text;

UPDATE strategi_diagnosa
   SET alasan = CASE
       WHEN jsonb_array_length(field_ids) > 0
           THEN (SELECT string_agg(elem, ' ') FROM jsonb_array_elements_text(field_ids) AS elem)
       ELSE '(alasan belum diisi — dimigrasikan dari field-ID baseline kosong)'
   END;

ALTER TABLE strategi_diagnosa ALTER COLUMN alasan SET NOT NULL;

ALTER TABLE strategi_diagnosa DROP CONSTRAINT IF EXISTS ck_strdiag_field_ids_array;
ALTER TABLE strategi_diagnosa ADD CONSTRAINT ck_strdiag_alasan_notempty
    CHECK (btrim(alasan) <> '');

ALTER TABLE strategi_diagnosa DROP COLUMN field_ids;

COMMENT ON TABLE strategi_diagnosa IS
  'A-07 — Section C per channel: C-1 bottleneck, C-2 alasan/bukti bottleneck '
  '(Rule 6 requires non-empty free text, owner QA 2026-08-24 DECISIONS — '
  'superseded the earlier baseline field-ID citation requirement), '
  'C-3 root cause, C-4 competitor gap.';

COMMENT ON COLUMN strategi_diagnosa.alasan IS
  'Rule 6: free-text reason/evidence for why this bottleneck was chosen. '
  'NOT NULL, non-empty (ck_strdiag_alasan_notempty). Previously field_ids '
  '(jsonb array of baseline field-ID strings) — dropped 2026-08-24, see '
  'DECISIONS.md.';
