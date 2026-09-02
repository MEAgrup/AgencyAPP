-- Owner request (2026-09-02, docs/DECISIONS.md): the Section P-C "Baris rencana
-- kerja" form had no field for the AM to attach the Brief's actual content —
-- free-form instructions, or a link (e.g. Google Drive) — before clicking
-- "Berikan Brief". Not a PC-numbered field in CDPS_Module6B_Plan.md; added as
-- an explicit owner deviation, same pattern as SKU Sasaran/Budget riding the
-- Brief `instructions` trace (DECISIONS 2026-08-26).
--
-- Nullable, no default: empty means the AM did not attach anything, same as
-- `prasyarat`/`di_luar_alasan` right above it.
ALTER TABLE plan_row ADD COLUMN instruksi_brief text NULL;

COMMENT ON COLUMN plan_row.instruksi_brief IS
  'Owner-added 2026-09-02 (not a PC-numbered PRD field): free-form brief instructions or a link (e.g. Google Drive) the AM attaches to this row. Carried into the inherited Brief (RAB-16, brief-inherit.ts planRowToBriefInput) — a URL-looking value also lands on briefs.reference_attachments; always appended as text to briefs.instructions.';
