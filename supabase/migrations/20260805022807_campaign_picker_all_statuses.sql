-- ============================================================================
-- Picker campaign: SELURUH status + funnel lead turunannya.
--
-- Lanjutan langsung `20260805022245`, atas arahan pemilik 2026-08-04 (sesi yang
-- sama, sesudah picker versi pertama dipakai): *"Sales perlu bisa membaca semua
-- campaign milik marketing supaya bisa mengisi jumlah lead asli, qualified &
-- not qualified"* — dan: *"tabel pilihan dari sales inilah yang menentukan
-- performa marketing. Kalau sales tidak mengetahui maka performa marketing
-- tidak akan terisi."*
--
-- ITU DIAGNOSIS YANG BENAR TENTANG MEKANISMENYA. Setiap angka performa campaign
-- di M2 berakar pada SATU tindakan Sales: memilih campaign saat registrasi lead
-- (`leads.origin_campaign_id`). Lead-by-Dashboard menghitung baris itu;
-- Lead-Real-by-Sales menghitung yang di antaranya mencapai Qualified;
-- Lead-Quality Rate & Cost-per-Real-Lead adalah rasio keduanya. Campaign yang
-- TIDAK ADA di dropdown karena itu bukan cuma "tidak terpilih" — ia permanen
-- bernilai nol, dan nol itu tidak bisa dibedakan dari campaign yang benar-benar
-- gagal. Membatasi dropdown ke {Active, Paused} membuat setiap lead dari
-- campaign Draft/Closed/Archived tidak bisa diatribusikan sama sekali.
--
-- DUA PERUBAHAN.
--
-- 1. CAKUPAN: dari {Active, Paused} menjadi SEMUA status. Urutannya dipatok di
--    sini supaya dropdown selalu sama: yang bisa menghasilkan lead SEKARANG
--    dulu (Active, Paused), lalu yang sudah berjalan dan masih mungkin
--    menghasilkan lead telat (Closed, Archived), lalu yang belum jalan (Draft —
--    jarang jadi jawaban yang benar, jadi paling akhir). `status` tetap
--    dikembalikan APA ADANYA supaya UI menandainya, bukan menyamarkannya.
--
--    Ini deviasi tercatat dari M3 §5 rule 5 (import hanya saat `{Active}`) untuk
--    pintu REGISTRASI SALES — dan registrasi bukan import: ia tidak pernah
--    meng-auto-activate campaign (bandingkan `resolveCampaignForIntake`), jadi
--    memilih campaign Draft di sini TIDAK menjalankannya. Pintu import Marketing
--    tidak disentuh sama sekali.
--
-- 2. FUNNEL: tiga hitungan turunan per campaign, supaya Sales MELIHAT akibat
--    pilihannya. Definisinya BUKAN definisi baru — persis milik M2 §4 / M1 §8:
--      * lead_by_dashboard  = COUNT lead dengan Origin Campaign ini (M2 §4 r1).
--      * lead_real_by_sales = COUNT DISTINCT lead yang punya attempt MENCAPAI
--        Qualified, dibaca dari baris audit immutable (M2 §4 r2 / M1-OA-2).
--      * lead_not_qualified = COUNT DISTINCT lead yang punya attempt mencapai
--        Not Qualified — cermin dari yang di atas, dan angka "18 ditandai Not
--        Qualified" pada contoh M1 §8. BUKAN "junk" M1 §8 r6 (yang mensyaratkan
--        SEMUA attempt berakhir Not Qualified) dan bukan `junk_breakdown` M2 §4
--        r9 (yang menghitung ALASAN per attempt); keduanya metrik lain dengan
--        nama lain, dan tidak diserobot di sini.
--    Rasio Lead-Quality Rate TIDAK dihitung di sini — ia murni presentasi dari
--    dua angka di atas (M2 §4 r3, `—` saat pembagi nol), dan menaruh rumusnya di
--    dua tempat adalah cara paling rapi untuk membuatnya berbeda-beda.
--
--    Predikat SQL di bawah sengaja identik dengan `campaign.campaignRollup` /
--    `marketing.computeMetrics`; `campaign.test.ts` menegakkan paritasnya, jadi
--    dua implementasi itu tidak bisa menyimpang diam-diam.
--
-- YANG TIDAK BERUBAH: `campaigns_select` tetap owner-scoped (Sales tetap membaca
-- NOL baris dari tabelnya — hanya jawaban fungsi ini yang dibuka), proyeksinya
-- tetap tanpa `owner_employee_id`/`end_date`/budget, dan seluruh uang M2
-- (budget, CPL, CPRL, ROAS) tetap tertutup di `marketing_performance_records`.
-- Gate aplikasi `campaign.canPickCampaign` (kedua pintu intake + OD/Director)
-- juga tidak berubah.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS private;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

-- Ditulis ulang (bukan fungsi baru): pemanggilnya satu — `campaign.listSelectableCampaigns`
-- — dan namanya masih tepat. Tanda tangan berubah, jadi versi lama DIBUANG dulu:
-- CREATE OR REPLACE tidak boleh mengubah daftar OUT parameter.
DROP FUNCTION IF EXISTS private.campaign_selectable();

CREATE FUNCTION private.campaign_selectable()
RETURNS TABLE (
  id                 text,
  name               text,
  channel            text,
  status             text,
  start_date         date,
  lead_by_dashboard  bigint,
  lead_real_by_sales bigint,
  lead_not_qualified bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS
$$
  WITH funnel AS (
    SELECT l.origin_campaign_id AS campaign_id,
           count(*) AS generated,
           count(*) FILTER (WHERE EXISTS (
             SELECT 1
               FROM public.prospect_attempts pa
               JOIN public.audit_log al
                 ON al.entity_type = 'prospect_attempt'
                AND al.entity_id = pa.id
                AND al.action = 'transition:Contacted->Qualified'
              WHERE pa.lead_id = l.id)) AS real_leads,
           count(*) FILTER (WHERE EXISTS (
             SELECT 1
               FROM public.prospect_attempts pa
               JOIN public.audit_log al
                 ON al.entity_type = 'prospect_attempt'
                AND al.entity_id = pa.id
                AND al.action = 'transition:Contacted->Not Qualified'
              WHERE pa.lead_id = l.id)) AS not_qualified
      FROM public.leads l
     WHERE l.origin_campaign_id IS NOT NULL
     GROUP BY l.origin_campaign_id
  )
  SELECT c.id::text, c.name::text, c.channel::text, c.status::text, c.start_date,
         coalesce(f.generated, 0)    AS lead_by_dashboard,
         coalesce(f.real_leads, 0)   AS lead_real_by_sales,
         coalesce(f.not_qualified, 0) AS lead_not_qualified
    FROM public.campaigns c
    LEFT JOIN funnel f ON f.campaign_id = c.id
   ORDER BY CASE c.status
              WHEN 'Active'   THEN 0   -- bisa menghasilkan lead sekarang
              WHEN 'Paused'   THEN 1
              WHEN 'Closed'   THEN 2   -- sudah berjalan; lead telat masih mungkin
              WHEN 'Archived' THEN 3
              WHEN 'Draft'    THEN 4   -- belum jalan; jarang jawaban yang benar
              ELSE 5                   -- status tak dikenal tetap muncul, paling akhir
            END,
            -- `collate "C"` load-bearing: nama campaign teks bebas dari Marketing
            -- (bisa diawali angka/tanda kurung). Kolasi glibc mengurutkannya
            -- bergantung locale cluster; `C` menyamakannya dengan sort sisi klien.
            c.name::text COLLATE "C",
            c.id::text COLLATE "C"
$$;

REVOKE EXECUTE ON FUNCTION private.campaign_selectable() FROM public;
REVOKE EXECUTE ON FUNCTION private.campaign_selectable() FROM anon;
GRANT EXECUTE ON FUNCTION private.campaign_selectable() TO authenticated, service_role;
