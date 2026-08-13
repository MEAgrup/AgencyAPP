-- CDPS — Module 6D (Rekap Hasil Mingguan) — D-08: ROLLUP KE PLAN (RM-E, read-only).
--
-- `wrr_plan_rollup(p_plan_id)` mengonsolidasi rekap `Ditutup`/`Ditutup Otomatis`
-- yang tertaut ke satu periode Plan (M6B) menjadi bukti mingguan-ke-mingguan +
-- kumulatif. Section RM-E · §4 Rule 6 · §6 flow 4 · backlog D-08.
--
-- ---------------------------------------------------------------------------
-- KENAPA READ-ONLY, BUKAN MENULIS plan_actual PE-3 (keputusan struktural)
-- ---------------------------------------------------------------------------
-- Section RM-E berlabel EKSPLISIT "(auto, **read-only**)" (PRD §5). Rule 6:
-- rekap "supply PE-3/PE-8 — **they are the weekly evidence behind the monthly
-- numbers**" (bukti, bukan penulis angka resmi). RM-E2: "% produksi tercapai …
-- **indikatif — angka resmi tetap di penutupan periode**". Jadi rollup = permukaan
-- BACA, bukan tulisan ke `plan_actual`. Tiga alasan mengunci ini:
--
--   1. **GMV single-source (§3 guardrail).** Rekap TAK PERNAH menulis M6B PE-1
--      (GMV manual). `gmv_interim` di sini berlabel *interim* — Σ eksekusi
--      (Ads+Live+affiliate), read-only — TAK PERNAH masuk `plan_actual.gmv`.
--   2. **Mismatch dimensi (tak terjembatani tanpa mengarang atribusi).**
--      `plan_actual` ber-PK `(plan_id, channel, metric)` dan `channel` = PLATFORM
--      (Shopee, TikTok Shop — cek plan_target). Rekap KLIEN-level, lintas-DIVISI,
--      terkonsolidasi (# video seluruh platform, bukan per-platform). Menulis
--      `plan_actual` per-channel dari rekap konsolidasi butuh atribusi platform
--      yang rekap TAK MODELKAN → akan MENGARANG angka (langgar house #4) atau
--      merusak PE-4 variance per-channel. PE-3 auto per-channel tetap tanggung
--      jawab job per-channel modul pemilik (M7/M8 — "B-09" yang belum dibangun);
--      rekap memasok BUKTI terkonsolidasi di layer baca, itulah RM-E.
--   3. **PE-8 memang turunan, tak disimpan.** PE-8 ("% baris Selesai / % kuota /
--      % budget") dihitung dari `plan_row` saat baca — bukan sesuatu yang rekap
--      tulis. Rekap menyuplai sisi bukti eksekusi, bukan angka PE-8.
--
-- Konsumen: read domain D-09 (`getPlanRekapRollup`, digerbang canReadPlan) untuk
-- RM-E pada detail rekap + bukti pada detail Plan. Klien `Tanpa Plan` (plan_id
-- NULL) → rekap berdiri sendiri (RM-E3), tak ada periode yang menampung — ditandai
-- di detail rekap (D-09), bukan di sini.
--
-- Nol tabel/mesin/prefix/event baru → gate 112/33/21/48 TETAP. Migrasi lewat
-- supabase/migrations/** + apply_migration — JANGAN `psql -f` (O38). DB lokal
-- rebuild HANYA lewat scripts/db-rebuild.sh.

CREATE OR REPLACE FUNCTION wrr_plan_rollup(p_plan_id text)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  WITH recaps AS (
    SELECT w.id, w.iso_year, w.iso_week, w.minggu_mulai, w.minggu_akhir
      FROM weekly_result_recap w
     WHERE w.plan_id = p_plan_id
       AND w.status IN ('Ditutup', 'Ditutup Otomatis')
  ),
  per_week AS (
    SELECT r.id AS recap_id, r.iso_week, r.minggu_mulai, r.minggu_akhir,
      -- Produksi per divisi (RM-B headline counts).
      coalesce((SELECT d.jumlah_produksi FROM wrr_divisi d
                 WHERE d.recap_id = r.id AND d.divisi = 'Creative'), 0)     AS video,
      coalesce((SELECT d.jumlah_produksi FROM wrr_divisi d
                 WHERE d.recap_id = r.id AND d.divisi = 'KOL'), 0)          AS creator,
      coalesce((SELECT d.jumlah_produksi FROM wrr_divisi d
                 WHERE d.recap_id = r.id AND d.divisi = 'Live Stream'), 0)  AS live,
      coalesce((SELECT (d.rincian -> 'durasi_jam')::text::numeric FROM wrr_divisi d
                 WHERE d.recap_id = r.id AND d.divisi = 'Live Stream'), 0)  AS jam_live,
      -- Metrik konsolidasi (RM-C). gmv_interim = INTERIM (bukan GMV resmi PE-1).
      (SELECT m.nilai FROM wrr_metrik m WHERE m.recap_id = r.id AND m.metrik = 'gmv_interim') AS gmv_interim,
      (SELECT m.nilai FROM wrr_metrik m WHERE m.recap_id = r.id AND m.metrik = 'ad_spend')    AS ad_spend,
      (SELECT m.nilai FROM wrr_metrik m WHERE m.recap_id = r.id AND m.metrik = 'roas_ads')    AS roas_ads
    FROM recaps r
  )
  SELECT jsonb_build_object(
    'plan_id',      p_plan_id,
    'rekap_count',  (SELECT count(*) FROM per_week),
    -- RM-E1 kumulatif: akumulasi produksi & metrik periode berjalan.
    'kumulatif', jsonb_build_object(
      'video',       coalesce(sum(video), 0),
      'creator',     coalesce(sum(creator), 0),
      'live',        coalesce(sum(live), 0),
      'jam_live',    coalesce(sum(jam_live), 0),
      'gmv_interim', coalesce(sum(gmv_interim), 0),
      'ad_spend',    coalesce(sum(ad_spend), 0)),
    -- ROAS tak dijumlahkan (rasio) — ambil minggu terakhir (indikatif).
    'roas_terakhir', (SELECT pw.roas_ads FROM per_week pw ORDER BY pw.minggu_mulai DESC LIMIT 1),
    -- RM-E1 per-minggu: kontribusi tiap rekap Ditutup dalam periode.
    'minggu', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'recap_id', pw.recap_id, 'iso_week', pw.iso_week,
        'video', pw.video, 'creator', pw.creator, 'live', pw.live, 'jam_live', pw.jam_live,
        'gmv_interim', pw.gmv_interim, 'ad_spend', pw.ad_spend, 'roas_ads', pw.roas_ads)
        ORDER BY pw.minggu_mulai)
      FROM per_week pw), '[]'::jsonb)
  )
  FROM per_week;
$$;

COMMENT ON FUNCTION wrr_plan_rollup(text) IS
  'M6D RM-E / Rule 6 (D-08) — rollup READ-ONLY: konsolidasi rekap Ditutup/Ditutup '
  'Otomatis tertaut ke satu periode Plan jadi bukti mingguan + kumulatif '
  '(RM-E1). TAK menulis plan_actual: rekap konsolidasi klien-level vs plan_actual '
  'per-platform-channel (mismatch) + GMV single-source (gmv_interim interim, tak '
  'pernah tulis PE-1) + PE-8 turunan dari plan_row. Angka indikatif; resmi tetap '
  'di penutupan periode.';

-- Read-only, digerbang di layer domain (canReadPlan). REVOKE dari anon; buka ke
-- authenticated (konsumen read D-09) + service_role.
REVOKE EXECUTE ON FUNCTION wrr_plan_rollup(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION wrr_plan_rollup(text) TO authenticated;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION wrr_plan_rollup(text) TO service_role;
  END IF;
END $$;
