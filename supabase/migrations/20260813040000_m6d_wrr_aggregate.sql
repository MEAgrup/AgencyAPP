-- CDPS — Module 6D (Rekap Hasil Mingguan) — D-03 part A: AUTO AGGREGATION.
--
-- `wrr_aggregate(recap_id)` recomputes a recap's read-only auto figures
-- (`wrr_divisi` RM-B + the `otomatis` `wrr_metrik` RM-C rows) from the execution
-- modules M7/M8/M9/M10 and the M6 Briefs, for that recap's client + ISO-week
-- window. It is the FIRST such aggregator in the codebase (the M6B "B-09 job"
-- was only ever referenced, never built).
--
-- ---------------------------------------------------------------------------
-- HOW "reached status X during this week" is read (the load-bearing decision)
-- ---------------------------------------------------------------------------
-- The execution tables carry NO per-status timestamp columns — status is a
-- single column written ONLY by `sm_transition`, which appends one immutable
-- `audit_log` row per move (house rule #2/#3). So "reached [Approved] this week"
-- is `audit_log` filtered by `entity_type` + `action LIKE 'transition:%->[X]'` +
-- `wib_date(created_at)` inside the recap's WIB Monday–Sunday window. This is the
-- exact pattern M7 Daily Output already uses (`creative.ts` Daily Output read).
-- The two append-only logs are dated directly: `metric_entries` by its reporting
-- period (`period_end` in the week) and `optimization_logs` by `created_at`.
--
-- ---------------------------------------------------------------------------
-- WHY it runs system-side only (no GUC hacks)
-- ---------------------------------------------------------------------------
-- Every write here targets an `otomatis`/production row, which the D-03 belt
-- triggers (`guard_wrr_*_no_manual_auto`) permit ONLY when there is no JWT actor
-- (`jwt_employee_id() IS NULL` — the service-role path). The function is
-- therefore self-enforcing: it succeeds under the D-06 Monday job / service-role
-- (no claims) and is refused for any JWT-identified human — no separate
-- authorization needed. SECURITY DEFINER only so its cross-client READS are not
-- RLS-filtered (it returns void — it never hands the caller any row it read).
--
-- ---------------------------------------------------------------------------
-- Metric coverage vs the RM-C vocabulary (§4 / §9 ownership matrix)
-- ---------------------------------------------------------------------------
--   * gmv_interim = Σ GMV Ads (M8) + Σ GMV Live (M10) + Σ affiliate attributed
--     (M9). Interim, NOT the official GMV (single-source guardrail §3 — the
--     recap never writes M6B PE-1).
--   * ad_spend    = Σ metric_entries.spend for the week.
--   * roas_ads    = Σ GMV Ads ÷ Σ spend; spend = 0 ⇒ NULL (rendered `—`, house #7,
--     never a divide error).
--   * total_view  = Σ M10 session viewers (peak). Ads reports NO impressions/views
--     in the schema, so the "(+ Ads-reported views)" half of RM-C3 has no source;
--     organic video views stay a manual fallback (D-04). Written only when there
--     is live data, else left to manual/`—`.
--   * ctr / cvr   = deliberately NOT auto-written. `metric_entries` stores only
--     the ctr/cvr *percentages* per entry, with no clicks/impressions to weight
--     a cross-campaign consolidation — averaging percentages would invent a
--     number. Spec-compliant: RM-C4/C5 are "Otomatis + manual fallback, isi atau
--     `—`", so they fall to the D-04 manual path / `—`. (Logged: DECISIONS 2026-08-13.)
--   * nilai_minggu_lalu (RM-C8 delta) = the same metric's value from this client's
--     immediately-preceding recap; direction/magnitude are derived at read time.
--
-- Idempotent (house #4: recomputable from the log): re-running converges. Upserts
-- refresh the auto value/breakdown and NEVER touch a `sengketa` note (RM-B6/RM-C)
-- or a `manual` row (D-04) — those are the AM's, not the aggregator's.
--
-- No new table / machine / event / prefix — gates unchanged (112/33/21/44).

-- ===========================================================================
-- Helpers — kept private (REVOKE FROM PUBLIC): they write auto rows, so the belt
-- triggers already refuse a JWT actor, but there is no reason to expose them.
-- ===========================================================================

-- Brief movement (RM-B5) for one division in the window, as the jsonb the
-- `rincian.brief` sub-object expects.
CREATE OR REPLACE FUNCTION wrr__brief_movement(p_client text, p_div text, p_mulai date, p_akhir date)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS
$$
  SELECT jsonb_build_object(
    'submitted', count(*) FILTER (WHERE al.action LIKE 'transition:%->[Submitted]'),
    'approved',  count(*) FILTER (WHERE al.action LIKE 'transition:%->[Approved]'),
    'revision',  count(*) FILTER (WHERE al.action LIKE 'transition:%->[Revision Requested]'),
    'blocked',   count(*) FILTER (WHERE al.action LIKE 'transition:%->[Blocked]')
  )
  FROM audit_log al
  JOIN briefs b   ON b.id  = al.entity_id
  JOIN services sv ON sv.id = b.service_id
  WHERE al.entity_type = 'brief'
    AND sv.client_id = p_client
    AND b.assigned_division = p_div
    AND public.wib_date(al.created_at) BETWEEN p_mulai AND p_akhir
$$;
REVOKE EXECUTE ON FUNCTION wrr__brief_movement(text, text, date, date) FROM PUBLIC;

-- Upsert one `otomatis` metric — refresh value only, never clobber a `manual`
-- row (ON CONFLICT WHERE sumber='otomatis') nor its `sengketa` note.
CREATE OR REPLACE FUNCTION wrr__upsert_metrik(p_recap text, p_metrik text, p_nilai numeric)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS
$$
  INSERT INTO wrr_metrik (recap_id, metrik, sumber, nilai, created_by)
  VALUES (p_recap, p_metrik, 'otomatis', p_nilai, 'SYSTEM')
  ON CONFLICT (recap_id, metrik) DO UPDATE
    SET nilai = EXCLUDED.nilai, updated_at = now()
    WHERE wrr_metrik.sumber = 'otomatis'
$$;
REVOKE EXECUTE ON FUNCTION wrr__upsert_metrik(text, text, numeric) FROM PUBLIC;

-- Upsert one production row — refresh count + breakdown, never touch `sengketa`.
CREATE OR REPLACE FUNCTION wrr__upsert_divisi(p_recap text, p_divisi text, p_jumlah integer, p_rincian jsonb)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS
$$
  INSERT INTO wrr_divisi (recap_id, divisi, jumlah_produksi, rincian, created_by)
  VALUES (p_recap, p_divisi, p_jumlah, p_rincian, 'SYSTEM')
  ON CONFLICT (recap_id, divisi) DO UPDATE
    SET jumlah_produksi = EXCLUDED.jumlah_produksi,
        rincian         = EXCLUDED.rincian,
        updated_at      = now()
$$;
REVOKE EXECUTE ON FUNCTION wrr__upsert_divisi(text, text, integer, jsonb) FROM PUBLIC;

-- ===========================================================================
-- The aggregator.
-- ===========================================================================
CREATE OR REPLACE FUNCTION wrr_aggregate(p_recap_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  w              record;
  v_prev_recap   text;
  -- metrics
  v_gmv_ads      numeric := 0;
  v_spend        numeric := 0;
  v_gmv_live     numeric := 0;
  v_gmv_aff      numeric := 0;
  v_views        numeric := 0;
  v_live_count   integer := 0;
  v_live_hours   numeric := 0;
  -- creative
  v_video        integer := 0;
  v_creative     jsonb   := '{}'::jsonb;
  -- kol
  v_creator      integer := 0;
  v_konten       integer := 0;
  -- ads
  v_campaigns    integer := 0;
  v_optimasi     integer := 0;
BEGIN
  SELECT id, client_id, minggu_mulai, minggu_akhir INTO w
    FROM weekly_result_recap WHERE id = p_recap_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '[rekap mingguan tidak ditemukan]';
  END IF;

  -- ---------------------------------------------------------------------
  -- RM-C consolidated metrics
  -- ---------------------------------------------------------------------
  -- Ads: spend + GMV from metric entries whose reporting period ENDS this week.
  SELECT coalesce(sum(me.spend), 0), coalesce(sum(me.gmv), 0),
         count(DISTINCT me.campaign_id)
    INTO v_spend, v_gmv_ads, v_campaigns
    FROM metric_entries me
    JOIN ad_campaigns ac ON ac.id = me.campaign_id
   WHERE ac.client_id = w.client_id
     AND me.period_end BETWEEN w.minggu_mulai AND w.minggu_akhir;

  -- Optimization actions (append-only log, dated by created_at).
  SELECT count(*) INTO v_optimasi
    FROM optimization_logs ol
    JOIN ad_campaigns ac ON ac.id = ol.campaign_id
   WHERE ac.client_id = w.client_id
     AND wib_date(ol.created_at) BETWEEN w.minggu_mulai AND w.minggu_akhir;

  -- Live (M10): sessions that reached [Completed]/[Reconciled] this week.
  WITH live_sessions AS (
    SELECT DISTINCT lss.id, lss.gmv, lss.viewers_peak, lss.actual_duration_hours
      FROM audit_log al
      JOIN live_stream_sessions lss ON lss.id = al.entity_id
      JOIN briefs b   ON b.id  = lss.brief_id
      JOIN services sv ON sv.id = b.service_id
     WHERE al.entity_type = 'live_stream_session'
       AND (al.action LIKE 'transition:%->[Completed]'
            OR al.action LIKE 'transition:%->[Reconciled]')
       AND sv.client_id = w.client_id
       AND wib_date(al.created_at) BETWEEN w.minggu_mulai AND w.minggu_akhir
  )
  SELECT coalesce(sum(gmv), 0), coalesce(sum(viewers_peak), 0),
         count(*), coalesce(sum(actual_duration_hours), 0)
    INTO v_gmv_live, v_views, v_live_count, v_live_hours
    FROM live_sessions;

  -- KOL affiliate GMV + # creator (bookings [QC Passed] this week).
  WITH qc AS (
    SELECT DISTINCT cb.id, cb.attributed_gmv
      FROM audit_log al
      JOIN creator_bookings cb ON cb.id = al.entity_id
      JOIN briefs b   ON b.id  = cb.brief_id
      JOIN services sv ON sv.id = b.service_id
     WHERE al.entity_type = 'creator_booking'
       AND al.action LIKE 'transition:%->[QC Passed]'
       AND sv.client_id = w.client_id
       AND wib_date(al.created_at) BETWEEN w.minggu_mulai AND w.minggu_akhir
  )
  SELECT count(*), coalesce(sum(attributed_gmv), 0) INTO v_creator, v_gmv_aff FROM qc;

  -- KOL content submitted this week.
  SELECT count(DISTINCT cb.id) INTO v_konten
    FROM audit_log al
    JOIN creator_bookings cb ON cb.id = al.entity_id
    JOIN briefs b   ON b.id  = cb.brief_id
    JOIN services sv ON sv.id = b.service_id
   WHERE al.entity_type = 'creator_booking'
     AND al.action LIKE 'transition:%->[Content Submitted]'
     AND sv.client_id = w.client_id
     AND wib_date(al.created_at) BETWEEN w.minggu_mulai AND w.minggu_akhir;

  -- Creative: assets reaching [Approved] this week, by type. Headline = # video.
  WITH ca AS (
    SELECT a.asset_type
      FROM audit_log al
      JOIN assets a   ON a.id  = al.entity_id
      JOIN briefs b   ON b.id  = a.brief_id
      JOIN services sv ON sv.id = b.service_id
     WHERE al.entity_type = 'asset'
       AND al.action LIKE 'transition:%->[Approved]'
       AND sv.client_id = w.client_id
       AND wib_date(al.created_at) BETWEEN w.minggu_mulai AND w.minggu_akhir
  )
  SELECT count(*) FILTER (WHERE asset_type = 'Video'),
         jsonb_build_object(
           'video',     count(*) FILTER (WHERE asset_type = 'Video'),
           'gambar',    count(*) FILTER (WHERE asset_type = 'Gambar'),
           'desain',    count(*) FILTER (WHERE asset_type = 'Desain'),
           'sku_setup', count(*) FILTER (WHERE asset_type = 'SKU Setup'),
           'copy',      count(*) FILTER (WHERE asset_type = 'Copy'))
    INTO v_video, v_creative
    FROM ca;

  -- ---------------------------------------------------------------------
  -- Write the otomatis metrics (see header for the ownership matrix).
  -- ---------------------------------------------------------------------
  PERFORM wrr__upsert_metrik(p_recap_id, 'gmv_interim', v_gmv_ads + v_gmv_live + v_gmv_aff);
  PERFORM wrr__upsert_metrik(p_recap_id, 'ad_spend',    v_spend);
  PERFORM wrr__upsert_metrik(p_recap_id, 'roas_ads',
                             CASE WHEN v_spend > 0 THEN round(v_gmv_ads / v_spend, 2) ELSE NULL END);
  IF v_live_count > 0 THEN
    PERFORM wrr__upsert_metrik(p_recap_id, 'total_view', v_views);
  END IF;

  -- RM-C8 delta: copy the immediately-preceding recap's per-metric values.
  SELECT id INTO v_prev_recap
    FROM weekly_result_recap
   WHERE client_id = w.client_id AND minggu_akhir < w.minggu_mulai
   ORDER BY minggu_mulai DESC LIMIT 1;
  IF v_prev_recap IS NOT NULL THEN
    UPDATE wrr_metrik m
       SET nilai_minggu_lalu = pm.nilai
      FROM wrr_metrik pm
     WHERE pm.recap_id = v_prev_recap
       AND pm.metrik = m.metrik
       AND m.recap_id = p_recap_id;
  END IF;

  -- ---------------------------------------------------------------------
  -- Write the per-division production rows — one per division that touched the
  -- client this week (has a brief assigned to it on the client's services).
  -- Counts are 0 for a division engaged but idle this week (a real signal).
  -- ---------------------------------------------------------------------
  IF EXISTS (SELECT 1 FROM briefs b JOIN services sv ON sv.id = b.service_id
              WHERE sv.client_id = w.client_id AND b.assigned_division = 'Creative') THEN
    PERFORM wrr__upsert_divisi(p_recap_id, 'Creative', v_video,
      v_creative || jsonb_build_object('brief',
        wrr__brief_movement(w.client_id, 'Creative', w.minggu_mulai, w.minggu_akhir)));
  END IF;

  IF EXISTS (SELECT 1 FROM briefs b JOIN services sv ON sv.id = b.service_id
              WHERE sv.client_id = w.client_id AND b.assigned_division = 'KOL') THEN
    PERFORM wrr__upsert_divisi(p_recap_id, 'KOL', v_creator,
      jsonb_build_object('konten_submitted', v_konten, 'brief',
        wrr__brief_movement(w.client_id, 'KOL', w.minggu_mulai, w.minggu_akhir)));
  END IF;

  IF EXISTS (SELECT 1 FROM briefs b JOIN services sv ON sv.id = b.service_id
              WHERE sv.client_id = w.client_id AND b.assigned_division = 'Live Stream') THEN
    PERFORM wrr__upsert_divisi(p_recap_id, 'Live Stream', v_live_count,
      jsonb_build_object('durasi_jam', v_live_hours, 'brief',
        wrr__brief_movement(w.client_id, 'Live Stream', w.minggu_mulai, w.minggu_akhir)));
  END IF;

  -- Ads: a campaign exists directly on the client (not only via briefs), so the
  -- engagement check is either a brief or a campaign.
  IF EXISTS (SELECT 1 FROM briefs b JOIN services sv ON sv.id = b.service_id
              WHERE sv.client_id = w.client_id AND b.assigned_division = 'Ads')
     OR EXISTS (SELECT 1 FROM ad_campaigns ac WHERE ac.client_id = w.client_id) THEN
    PERFORM wrr__upsert_divisi(p_recap_id, 'Ads', v_campaigns,
      jsonb_build_object('optimasi', v_optimasi, 'brief',
        wrr__brief_movement(w.client_id, 'Ads', w.minggu_mulai, w.minggu_akhir)));
  END IF;
END;
$$;

COMMENT ON FUNCTION wrr_aggregate(text) IS
  'M6D D-03 — recompute a recap''s read-only auto figures (wrr_divisi RM-B + '
  'otomatis wrr_metrik RM-C) from M7/M8/M9/M10 + M6 briefs, by client + ISO-week '
  'window read from audit_log. Idempotent; preserves sengketa + manual rows. '
  'Runs system-side only (belt triggers refuse a JWT actor).';

-- Executable only by the service-role job (D-06) / the migration owner; never
-- by a JWT-identified human (the belt triggers would refuse its writes anyway).
REVOKE EXECUTE ON FUNCTION wrr_aggregate(text) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION wrr_aggregate(text) TO service_role;
  END IF;
END $$;
