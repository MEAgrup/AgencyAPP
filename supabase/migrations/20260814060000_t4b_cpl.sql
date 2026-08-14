-- T-4b (RM-7 / RM-C, M6D): CPL (Cost Per Lead) blended di rekap mingguan.
--
-- Keputusan pemilik 2026-08-14: *"cpl blended"*. Atribusi blended = semua spend
-- iklan klien ÷ semua "lead" klien pada periode. SUMBER LEAD: leads M1 adalah
-- pipeline akuisisi KLIEN milik agency (lead→sales→klien), tak tertaut ke
-- performa iklan klien per-minggu — jadi TIDAK dipakai di sini. "Lead" yang
-- relevan di level rekap performa klien = **conversions** dari report platform
-- (kolom `metric_entries.conversions`, T-3). Maka:
--
--   CPL = Σspend ÷ Σconversions   (Rp per lead), `—` (NULL) saat Σconversions 0.
--
-- Konsisten dengan CVR (T-3, memakai conversions yang sama). Dicatat DECISIONS
-- 2026-08-14. Hanya perluasan kosakata + satu baris upsert di wrr_aggregate.

ALTER TABLE wrr_metrik DROP CONSTRAINT ck_wrr_metrik_key;
ALTER TABLE wrr_metrik ADD CONSTRAINT ck_wrr_metrik_key CHECK (metrik IN (
    'gmv_interim', 'roas_ads', 'total_view', 'view_organik',
    'ctr', 'cvr', 'cpc', 'cpm', 'cpl', 'ad_spend'));

CREATE OR REPLACE FUNCTION wrr_aggregate(p_recap_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  w              record;
  v_prev_recap   text;
  v_gmv_ads      numeric := 0;
  v_spend        numeric := 0;
  v_gmv_live     numeric := 0;
  v_gmv_aff      numeric := 0;
  v_views        numeric := 0;
  v_live_count   integer := 0;
  v_live_hours   numeric := 0;
  v_clicks       numeric := 0;
  v_impr         numeric := 0;
  v_conv         numeric := 0;
  v_video        integer := 0;
  v_creative     jsonb   := '{}'::jsonb;
  v_creator      integer := 0;
  v_konten       integer := 0;
  v_campaigns    integer := 0;
  v_optimasi     integer := 0;
BEGIN
  SELECT id, client_id, minggu_mulai, minggu_akhir INTO w
    FROM weekly_result_recap WHERE id = p_recap_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '[rekap mingguan tidak ditemukan]';
  END IF;

  SELECT coalesce(sum(me.spend), 0), coalesce(sum(me.gmv), 0),
         count(DISTINCT me.campaign_id),
         coalesce(sum(me.clicks), 0), coalesce(sum(me.impressions), 0), coalesce(sum(me.conversions), 0)
    INTO v_spend, v_gmv_ads, v_campaigns, v_clicks, v_impr, v_conv
    FROM metric_entries me
    JOIN ad_campaigns ac ON ac.id = me.campaign_id
   WHERE ac.client_id = w.client_id
     AND me.period_end BETWEEN w.minggu_mulai AND w.minggu_akhir;

  SELECT count(*) INTO v_optimasi
    FROM optimization_logs ol
    JOIN ad_campaigns ac ON ac.id = ol.campaign_id
   WHERE ac.client_id = w.client_id
     AND wib_date(ol.created_at) BETWEEN w.minggu_mulai AND w.minggu_akhir;

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

  SELECT count(DISTINCT cb.id) INTO v_konten
    FROM audit_log al
    JOIN creator_bookings cb ON cb.id = al.entity_id
    JOIN briefs b   ON b.id  = cb.brief_id
    JOIN services sv ON sv.id = b.service_id
   WHERE al.entity_type = 'creator_booking'
     AND al.action LIKE 'transition:%->[Content Submitted]'
     AND sv.client_id = w.client_id
     AND wib_date(al.created_at) BETWEEN w.minggu_mulai AND w.minggu_akhir;

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

  PERFORM wrr__upsert_metrik(p_recap_id, 'gmv_interim', v_gmv_ads + v_gmv_live + v_gmv_aff);
  PERFORM wrr__upsert_metrik(p_recap_id, 'ad_spend',    v_spend);
  PERFORM wrr__upsert_metrik(p_recap_id, 'roas_ads',
                             CASE WHEN v_spend > 0 THEN round(v_gmv_ads / v_spend, 2) ELSE NULL END);
  PERFORM wrr__upsert_metrik(p_recap_id, 'ctr',
                             CASE WHEN v_impr   > 0 THEN round(v_clicks / v_impr * 100, 2) ELSE NULL END);
  PERFORM wrr__upsert_metrik(p_recap_id, 'cvr',
                             CASE WHEN v_clicks > 0 THEN round(v_conv  / v_clicks * 100, 2) ELSE NULL END);
  PERFORM wrr__upsert_metrik(p_recap_id, 'cpc',
                             CASE WHEN v_clicks > 0 THEN round(v_spend / v_clicks, 2) ELSE NULL END);
  PERFORM wrr__upsert_metrik(p_recap_id, 'cpm',
                             CASE WHEN v_impr   > 0 THEN round(v_spend / v_impr * 1000, 2) ELSE NULL END);
  -- T-4b: CPL blended = Σspend ÷ Σconversions (lead = conversions platform).
  PERFORM wrr__upsert_metrik(p_recap_id, 'cpl',
                             CASE WHEN v_conv   > 0 THEN round(v_spend / v_conv, 2) ELSE NULL END);
  IF v_live_count > 0 THEN
    PERFORM wrr__upsert_metrik(p_recap_id, 'total_view', v_views);
  END IF;

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

  IF EXISTS (SELECT 1 FROM briefs b JOIN services sv ON sv.id = b.service_id
              WHERE sv.client_id = w.client_id AND b.assigned_division = 'Ads')
     OR EXISTS (SELECT 1 FROM ad_campaigns ac WHERE ac.client_id = w.client_id) THEN
    PERFORM wrr__upsert_divisi(p_recap_id, 'Ads', v_campaigns,
      jsonb_build_object('optimasi', v_optimasi, 'brief',
        wrr__brief_movement(w.client_id, 'Ads', w.minggu_mulai, w.minggu_akhir)));
  END IF;
END;
$$;
