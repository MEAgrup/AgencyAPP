-- T-3 (RM-3 / RM-C, M8): CTR / CVR / CPC / CPM otomatis di rekap mingguan.
--
-- Sampai kini `metric_entries` hanya menyimpan ctr/cvr sebagai PERSEN per-entry,
-- tanpa clicks/impressions untuk membobot konsolidasi lintas-campaign — jadi
-- `wrr_aggregate` sengaja TIDAK menulis ctr/cvr (rata-rata persen = mengarang
-- angka; DECISIONS 2026-08-13). T-3 menambah hitungan mentah sehingga rasio bisa
-- dihitung ter-blended dari Σ.
--
-- Keputusan pemilik 2026-08-14: CVR = Σconversions ÷ Σclicks; "conversions" datang
-- dari report platform — AM hanya meng-INPUT angkanya (bukan dihitung dari event
-- internal). Maka clicks/impressions/conversions = kolom input opsional; rasio
-- diturunkan di agregasi, `—` (NULL) saat penyebut 0/absen (house rule #7).

-- --- Kolom input mentah (opsional; platform report) ------------------------
ALTER TABLE metric_entries
    ADD COLUMN clicks      bigint NULL,   -- Σ klik iklan periode (platform)
    ADD COLUMN impressions bigint NULL,   -- Σ impresi iklan periode (platform)
    ADD COLUMN conversions bigint NULL;   -- Σ konversi/order periode (platform, untuk CVR)

-- --- Kosakata wrr_metrik: tambah cpc, cpm (ctr, cvr sudah ada) --------------
ALTER TABLE wrr_metrik DROP CONSTRAINT ck_wrr_metrik_key;
ALTER TABLE wrr_metrik ADD CONSTRAINT ck_wrr_metrik_key CHECK (metrik IN (
    'gmv_interim', 'roas_ads', 'total_view', 'ctr', 'cvr', 'cpc', 'cpm', 'ad_spend'));

-- --- wrr_aggregate: isi ctr/cvr/cpc/cpm dari Σ mentah ----------------------
-- Satu-satunya perubahan vs migrasi asal (20260813040000): Σ clicks/impressions/
-- conversions dibaca bersama spend/gmv, lalu 4 rasio di-upsert. NULL saat
-- penyebut 0 (rendered `—`). Sisa fungsi identik.
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
  -- ads raw counts (T-3)
  v_clicks       numeric := 0;
  v_impr         numeric := 0;
  v_conv         numeric := 0;
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

  -- Ads: spend + GMV + raw clicks/impressions/conversions from metric entries
  -- whose reporting period ENDS this week.
  SELECT coalesce(sum(me.spend), 0), coalesce(sum(me.gmv), 0),
         count(DISTINCT me.campaign_id),
         coalesce(sum(me.clicks), 0), coalesce(sum(me.impressions), 0), coalesce(sum(me.conversions), 0)
    INTO v_spend, v_gmv_ads, v_campaigns, v_clicks, v_impr, v_conv
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
  -- T-3: blended ad-performance ratios from Σ raw counts. NULL (→ `—`) when the
  -- denominator is 0/absent — never a divide error (house rule #7).
  PERFORM wrr__upsert_metrik(p_recap_id, 'ctr',
                             CASE WHEN v_impr   > 0 THEN round(v_clicks / v_impr * 100, 2) ELSE NULL END);
  PERFORM wrr__upsert_metrik(p_recap_id, 'cvr',
                             CASE WHEN v_clicks > 0 THEN round(v_conv  / v_clicks * 100, 2) ELSE NULL END);
  PERFORM wrr__upsert_metrik(p_recap_id, 'cpc',
                             CASE WHEN v_clicks > 0 THEN round(v_spend / v_clicks, 2) ELSE NULL END);
  PERFORM wrr__upsert_metrik(p_recap_id, 'cpm',
                             CASE WHEN v_impr   > 0 THEN round(v_spend / v_impr * 1000, 2) ELSE NULL END);
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
