-- ============================================================================
-- Picker Campaign untuk pintu registrasi lead (M0 §3 / M1 §4, field Origin
-- Campaign M1 §9.3).
--
-- MASALAH LAPANGAN (arahan pemilik 2026-08-04): di `/sales` field "Campaign ID"
-- adalah kotak teks bebas — sales harus MENGHAFAL `CMP-YYYYMM-NNNN`. Yang
-- sebenarnya terjadi: field itu dilewati, `leads.origin_campaign_id` kosong,
-- dan rollup M2/M3 (Lead-by-Dashboard, CPL, ROAS) menghitung nol untuk campaign
-- yang benar-benar menghasilkan lead. Perbaikannya di UI adalah DROPDOWN, dan
-- dropdown butuh satu jalur baca: "campaign apa yang boleh dipilih".
--
-- KENAPA BUKAN LEWAT `GET /marketing/campaigns` YANG SUDAH ADA:
-- `campaign.listCampaigns` menolak aktor non-Marketing (M3 §5), dan di bawahnya
-- policy `campaigns_select` (20260723064438) hanya membuka baris milik/ciptaan
-- aktor atau oversight (`jwt_can_read_all()`). Seorang Sales staff karena itu
-- membaca NOL campaign — benar untuk workspace Marketing, mustahil untuk picker.
--
-- KEPUTUSAN (docs/DECISIONS.md 2026-08-04): tabelnya TIDAK dilebarkan; yang
-- dibuka hanya JAWABANNYA, lewat SECURITY DEFINER di schema `private` — pola
-- yang sama persis dengan `private.sm_allowed_transitions` (20260803120000).
--
-- Mengapa bukan `... OR status = 'Active'` pada `campaigns_select` (ditolak):
--   1. Itu melebarkan row-scope TABEL untuk semua pembaca, sedangkan yang butuh
--      hanya satu picker. Owner-scope M3 §5 tetap invarian yang ingin dijaga.
--   2. Fungsi ini mengembalikan JAUH lebih sedikit daripada barisnya: lima kolom
--      identitas (id, nama, channel, status, tanggal mulai) — tanpa
--      `owner_employee_id`, tanpa `created_by`, tanpa `end_date`. Budget tetap
--      di `marketing_performance_records` yang tidak disentuh sama sekali.
--   3. Arah dua migrasi hardening terakhir (20260727072443, 20260803120000)
--      adalah MENGECILKAN permukaan `public` yang terekspos PostgREST; `private`
--      tidak terekspos.
--
-- CAKUPAN STATUS = {Active, Paused} (keputusan pemilik 2026-08-04). 'Active'
-- adalah permintaan aslinya ("semua campaign yang sudah aktif"); 'Paused' ikut
-- karena lead yang masuk telat masih harus bisa diatribusikan ke campaign yang
-- sementara dihentikan — dan status dikembalikan APA ADANYA supaya UI bisa
-- menandainya, bukan menyamarkannya. Draft TIDAK ikut: pintu import Marketing
-- meng-auto-activate Draft (leads.ts resolveCampaignForIntake), dan registrasi
-- Sales sengaja TIDAK punya efek samping lifecycle itu. Closed/Archived tidak
-- ikut: campaign yang sudah tutup tidak menerima lead baru.
--
-- Yang TIDAK berubah: `campaigns_select` apa adanya, tulis status tetap
-- eksklusif lewat `sm_transition`, dan `GET /marketing/campaigns` tetap
-- owner-scoped. Perbaikan ini seluas kebutuhan picker-nya, tidak lebih.
-- ============================================================================

-- Idempoten + mandiri: `private` sudah lahir di 20260727072443, tapi guard ini
-- membuat berkas aman di-apply ulang dan di-rebuild dari nol.
CREATE SCHEMA IF NOT EXISTS private;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

-- Campaign yang boleh dipilih di pintu intake lead. Urutan dipatok DI DALAM
-- fungsi (bukan diserahkan ke pemanggil) supaya dropdown selalu tampil sama:
-- Active dulu, lalu nama.
--
-- `collate "C"` load-bearing, alasan sama seperti `sm_allowed_transitions`:
-- nama campaign adalah teks bebas dari Marketing (bisa diawali angka, tanda
-- kurung, emoji). Kolasi glibc mengurutkannya bergantung locale cluster; `C`
-- menyamakan urutan Postgres dengan `Array.prototype.sort` di sisi klien, jadi
-- daftar yang difilter di FE tidak pernah "melompat" relatif ke daftar server.
--
-- STABLE + SECURITY DEFINER: satu SELECT, nol tulis. Tidak ada parameter, jadi
-- tidak ada permukaan injeksi; `search_path` tetap dipatok (pola 20260727072443).
CREATE OR REPLACE FUNCTION private.campaign_selectable()
RETURNS TABLE (id text, name text, channel text, status text, start_date date)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS
$$
  SELECT c.id::text, c.name::text, c.channel::text, c.status::text, c.start_date
    FROM public.campaigns c
   WHERE c.status IN ('Active', 'Paused')
   ORDER BY (c.status = 'Active') DESC, c.name::text COLLATE "C", c.id::text COLLATE "C"
$$;

-- Permukaan EXECUTE: `authenticated` WAJIB bisa (itu jalur baca picker-nya),
-- `service_role` untuk jalur privileged/batch. `public`/`anon` dicabut — belum
-- login tidak punya urusan dengan daftar campaign.
REVOKE EXECUTE ON FUNCTION private.campaign_selectable() FROM public;
REVOKE EXECUTE ON FUNCTION private.campaign_selectable() FROM anon;
GRANT EXECUTE ON FUNCTION private.campaign_selectable() TO authenticated, service_role;
