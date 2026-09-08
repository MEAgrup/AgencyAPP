-- ============================================================================
-- M18 (Wave 3 butir 8) — Store Operation MASUK kuota satuan.
--
-- ## KENAPA INI BARU BISA SEKARANG, DAN KENAPA HARUS SATU COMMIT
--
-- `punyaKuotaSatuan` adalah flag yang paling mudah dinyalakan dan paling mahal
-- kalau dinyalakan sendirian. Ia menarik tiga hal sekaligus:
--
--   1. `account.ALLOWED_DIVISIONS` — divisi muncul di multi-select "Divisions
--      Involved" Strategi dan di kuota task satuan. TANPA entri
--      `TASK_CATALOG`, comparator `normalizeTasks` jatuh di `undefined`
--      (peringatan `packages/core/src/division.ts`).
--   2. `recap.DIVISIONS` — divisi jadi nama sah untuk catatan divisi pada Rekap
--      Hasil Mingguan… tapi CHECK constraint `wrr_divisi`/`wrr_catatan_divisi`
--      masih hardcode lima nama dan akan MENOLAK barisnya di level DB.
--   3. `wrr_aggregate` — kalau divisi diakui tapi fungsi agregatnya tidak punya
--      cabangnya, rekap mingguan melaporkan produksi **0** untuk divisi yang
--      bekerja. Angka nol yang salah lebih buruk daripada tidak ada angka: ia
--      terbaca sebagai "tim ini tidak menghasilkan apa-apa minggu ini".
--
-- Sampai M18, (3) memang tidak bisa dijawab — tidak ada tabel yang bisa
-- dihitung. Sekarang ada: `store_ops_skus`. Jadi ketiganya dipasang bersama,
-- di commit yang sama dengan `TASK_CATALOG` dan pembalikan flag TS-nya.
--
-- ## APA YANG DIHITUNG SEBAGAI "PRODUKSI" STORE OPERATION
--
-- Jumlah baris SKU yang mencapai `[Terupload]` minggu itu — ketokan K-6
-- ("SKU selesai saat gambar ter-upload"), diturunkan dari `audit_log` seperti
-- setiap angka produksi divisi lain di fungsi ini. `[Dievaluasi]` dilaporkan
-- TERPISAH di `rincian`, bukan dijumlahkan ke headline: ia peristiwa ~30 hari
-- kemudian, dan menjumlahkannya akan membuat satu SKU terhitung dua kali di dua
-- minggu berbeda.
--
-- Nol tabel, nol prefix, nol mesin, nol event ⇒ gate 147/41/32/73 TETAP.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. CHECK constraint dua tabel WRR — lima nama jadi enam.
--    Pola sama `20260831060000_ai_optimizer_wrr_aggregate.sql` saat AI Optimizer
--    masuk. `strategi_dispatch` sudah menerima 'Store Operation' sejak migrasi
--    itu (ia dispatch target sejak M16), jadi tidak disentuh di sini.
-- ---------------------------------------------------------------------------
ALTER TABLE wrr_divisi DROP CONSTRAINT ck_wrr_divisi_nama;
ALTER TABLE wrr_divisi ADD CONSTRAINT ck_wrr_divisi_nama CHECK (divisi IN (
    'Creative', 'Ads', 'KOL', 'Live Stream', 'AI Optimizer', 'Store Operation'));

ALTER TABLE wrr_catatan_divisi DROP CONSTRAINT ck_wrr_catatan_divisi_nama;
ALTER TABLE wrr_catatan_divisi ADD CONSTRAINT ck_wrr_catatan_divisi_nama CHECK (divisi IN (
    'Creative', 'Ads', 'KOL', 'Live Stream', 'AI Optimizer', 'Store Operation'));

-- ---------------------------------------------------------------------------
-- 2. `division_registry` — sisi DB dari flag yang dibalik di
--    `packages/core/src/division.ts`. Keduanya WAJIB berubah bersama:
--    `packages/db/src/division.registry.test.ts` membandingkan set-equal atas
--    SELURUH flag, jadi membalik satu sisi saja langsung merah.
-- ---------------------------------------------------------------------------
UPDATE division_registry SET punya_kuota_satuan = true WHERE code = 'STORE_OPS';

-- ---------------------------------------------------------------------------
-- 3. `wrr_aggregate` — redefinisi KELIMA.
--
--    Postgres tidak punya "tempel section": `CREATE OR REPLACE FUNCTION` selalu
--    mengganti seluruh isi, jadi migrasi ini menyalin ulang definisi hidup
--    terakhir (`20260831060000`) PERSIS, ditambah satu blok Store Operation.
--    Menyalin ulang memang tidak elegan; mengedit migrasi lama jauh lebih buruk
--    (migrasi immutable, aturan rumah).
-- ---------------------------------------------------------------------------
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
  v_ai_video     integer := 0;
  v_optimasi_sku integer := 0;
  -- BARU (M18) — Store Operation.
  v_sku_upload   integer := 0;
  v_sku_evaluasi integer := 0;
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
           'copy',      count(*) FILTER (WHERE asset_type = 'Copy')),
         count(*) FILTER (WHERE asset_type = 'AI Video'),
         count(*) FILTER (WHERE asset_type = 'Optimasi SKU')
    INTO v_video, v_creative, v_ai_video, v_optimasi_sku
    FROM ca;

  -- BARU (M18): produksi Store Operation minggu ini = baris SKU yang mencapai
  -- [Terupload] (K-6). DISTINCT karena sebuah baris bisa gagal upload lalu
  -- berhasil, dan dua percobaan pada minggu yang sama tetap SATU SKU tayang.
  -- [Dievaluasi] dihitung terpisah: peristiwanya ~30 hari kemudian, dan
  -- menjumlahkannya ke headline membuat satu SKU terhitung di dua minggu.
  SELECT count(DISTINCT s.id) FILTER (WHERE al.action LIKE 'transition:%->[Terupload]'),
         count(DISTINCT s.id) FILTER (WHERE al.action LIKE 'transition:%->[Dievaluasi]')
    INTO v_sku_upload, v_sku_evaluasi
    FROM audit_log al
    JOIN store_ops_skus s ON s.id = al.entity_id
    JOIN briefs b    ON b.id  = s.brief_id
    JOIN services sv ON sv.id = b.service_id
   WHERE al.entity_type = 'store_ops_sku'
     AND sv.client_id = w.client_id
     AND wib_date(al.created_at) BETWEEN w.minggu_mulai AND w.minggu_akhir;

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

  IF EXISTS (SELECT 1 FROM briefs b JOIN services sv ON sv.id = b.service_id
              WHERE sv.client_id = w.client_id AND b.assigned_division = 'AI Optimizer') THEN
    PERFORM wrr__upsert_divisi(p_recap_id, 'AI Optimizer', v_ai_video + v_optimasi_sku,
      jsonb_build_object('sku_dioptimasi', v_optimasi_sku, 'ai_video_selesai', v_ai_video, 'brief',
        wrr__brief_movement(w.client_id, 'AI Optimizer', w.minggu_mulai, w.minggu_akhir)));
  END IF;

  -- BARU (M18): Store Operation. Gerbang `IF EXISTS` sama seperti divisi lain —
  -- barisnya hanya ditulis kalau divisi ini memang terlibat pada klien ini.
  IF EXISTS (SELECT 1 FROM briefs b JOIN services sv ON sv.id = b.service_id
              WHERE sv.client_id = w.client_id AND b.assigned_division = 'Store Operation') THEN
    PERFORM wrr__upsert_divisi(p_recap_id, 'Store Operation', v_sku_upload,
      jsonb_build_object('sku_terupload', v_sku_upload, 'sku_dievaluasi', v_sku_evaluasi, 'brief',
        wrr__brief_movement(w.client_id, 'Store Operation', w.minggu_mulai, w.minggu_akhir)));
  END IF;
END;
$$;
