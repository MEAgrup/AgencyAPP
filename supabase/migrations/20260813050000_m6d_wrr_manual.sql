-- CDPS — Module 6D (Rekap Hasil Mingguan) — D-04: JALUR MANUAL + `—` + TEKS.
--
-- D-01 stood up `wrr_metrik`'s manual columns (`sumber`/`file_bukti`/
-- `tanggal_ambil`) structurally and D-03 opened the write path (an AM may INSERT a
-- `manual` fallback on a recap they own, RLS `WITH CHECK sumber='manual'`), but
-- both DELIBERATELY deferred the conditional evidence CHECK to here — exactly as
-- M6B B-06 opened `plan_actual`'s write path while B-01 owned its manual-bukti
-- CHECK. D-04 closes that gap and completes the RM-C fallback trio.
--
-- ---------------------------------------------------------------------------
-- What lands here (§4 / §9 · RM-C3/C4/C5/C7/C9 · RM-4/RM-7/RM-11)
-- ---------------------------------------------------------------------------
--   1. RM-C7 — the conditional evidence CHECK on `wrr_metrik`: a `manual` figure
--      MUST carry `file_bukti` (non-blank) + `tanggal_ambil`. Byte-for-byte the
--      same shape as `ck_plan_actual_manual_bukti` (M6B): one hand-typed number
--      that other reads lean on must be sourced. `otomatis` / `tidak_tersedia`
--      rows are exempt (their `file_bukti` is legitimately NULL).
--   2. The `—` path — RM-C3/C4/C5 are "W (isi atau `—`)": a required field the AM
--      satisfies by EITHER entering a sourced manual number OR affirmatively
--      marking it not-available (`sumber='tidak_tersedia'`, `nilai` NULL → renders
--      `—`, house #7). D-03's RLS `WITH CHECK` only admitted `manual`; the AM
--      could not persist the `—` half. D-04 widens the INSERT braces from
--      `sumber = 'manual'` to `sumber <> 'otomatis'` so both fallback outcomes are
--      writable. The auto-block invariant is UNCHANGED — `otomatis` is still
--      refused in the braces (RLS) AND the belt (`guard_wrr_metrik_no_manual_auto`
--      trigger already rejects a JWT actor's `otomatis` insert), the two walls the
--      D-03 frozen invariant demands. (Logged: DECISIONS 2026-08-13.)
--   3. RM-C9 — the text-only "Catatan Metrik Tambahan" column on `wrr_catatan`.
--      Owner 2026-08-13 (RM-4/RM-7/RM-11): CPL, impressions, CPC/CPM and organic
--      video views are NOT modelled — but the AM gets a free-text notepad to jot
--      them so a figure from a platform dashboard is not lost. It is explicitly
--      NOT a metric: never in a delta, a rollup, a chart or a score, and the
--      system never parses a number out of it (RM-4/RM-7/RM-11 / §10.1-B).
--
-- ---------------------------------------------------------------------------
-- What is NOT here (still downstream — do not duplicate)
-- ---------------------------------------------------------------------------
--   * NO new auto pipeline for CTR / CVR / organic view / CPL (R3): the metric
--     column stays `—` until the source is modelled in the owning module (M8/M7).
--     RM-C9 is a notepad, not a back door to type fake metrics.
--   * The close-time "W (isi atau `—`)" ENFORCEMENT — that every required RM-C
--     metric has a row (manual or `tidak_tersedia`) before a recap closes — is
--     RM-D narrative validation, D-05. D-04 only makes both outcomes WRITABLE.
--   * The AM write path for `wrr_catatan` (RM-A6 / RM-D / RM-C9 through the domain
--     + route + wire) is D-09. This ticket adds the column structurally; its
--     authenticated write policy is not opened here (still SELECT-only from D-01).
--
-- No new table / machine / event / prefix — the shape already exists (D-01), so
-- every structural gate (112 tables · 33 prefix · 21 machines · 44 events) is
-- unchanged. Migrasi lewat supabase/migrations/** + apply_migration — JANGAN
-- `psql -f` (O38). DB lokal rebuild HANYA lewat scripts/db-rebuild.sh.

-- ===========================================================================
-- 1. RM-C7 — conditional evidence CHECK (mirror of ck_plan_actual_manual_bukti).
--    A `manual` figure needs a source attachment + capture date; `otomatis` and
--    `tidak_tersedia` rows are exempt (file_bukti legitimately NULL). Deferred
--    from D-01 (structural columns) / D-03 (open write path) to here by design.
-- ===========================================================================
ALTER TABLE wrr_metrik ADD CONSTRAINT ck_wrr_metrik_manual_bukti CHECK (
    sumber <> 'manual'
    OR (file_bukti IS NOT NULL AND btrim(file_bukti) <> '' AND tanggal_ambil IS NOT NULL));

COMMENT ON CONSTRAINT ck_wrr_metrik_manual_bukti ON wrr_metrik IS
  'M6D RM-C7 — a manual fallback figure must carry file_bukti (non-blank) + '
  'tanggal_ambil. Same shape as M6B ck_plan_actual_manual_bukti. otomatis / '
  'tidak_tersedia rows are exempt (their file_bukti is legitimately NULL).';

-- ===========================================================================
-- 2. RM-C3/C4/C5 `—` path — widen the INSERT braces so the AM can persist the
--    "atau `—`" outcome (`tidak_tersedia`), not only the "isi" one (`manual`).
--    `otomatis` stays refused here (braces) AND in the belt trigger — the D-03
--    auto-block invariant is untouched. UPDATE policy already spans any in-scope
--    sumber (the trigger owns the column-level otomatis-immutability), so the
--    manual↔tidak_tersedia flip an AM makes on the same row needs no change here.
-- ===========================================================================
ALTER POLICY wrr_metrik_insert ON public.wrr_metrik
    WITH CHECK (private.jwt_can_write_recap(recap_id) AND sumber <> 'otomatis');

-- ===========================================================================
-- 3. RM-C9 — text-only "Catatan Metrik Tambahan" on wrr_catatan (RM-4/RM-7/
--    RM-11). Free prose for unmodelled figures (CPL / impressions / CPC / CPM /
--    organic views). NOT a metric: never parsed, never in delta/rollup/score.
--    Additive nullable column — its authenticated write path is D-09.
-- ===========================================================================
ALTER TABLE wrr_catatan ADD COLUMN catatan_metrik_tambahan text NULL;

COMMENT ON COLUMN wrr_catatan.catatan_metrik_tambahan IS
  'M6D RM-C9 (RM-4/RM-7/RM-11) — text-only notepad for unmodelled figures '
  '(CPL/impressions/CPC/CPM/organic views). NOT a metric: never parsed as a '
  'number, never enters a delta/rollup/chart/score. Stops being here if a '
  'figure is later modelled in the owning module (M8/M7). §10.1-B.';
