-- =============================================================================
-- F-01 · `pdt_fact_shop_daily.kanal` — "penanda kanal" R8 (data model §4)
--
-- KENAPA KOLOM INI ADA. M20 R8 membawa modul parser baru
-- `tt_shop_analytics_tokopedia` (kode `tt_` karena didaftarkan `platform:
-- 'tiktok'` — lihat `docs/DECISIONS.md` M20-TOKOPEDIA-SAMPLE: PDT-22 ("Tokopedia
-- tetap manual tanpa mesin parse") disupersede R8 UNTUK CAKUPAN INI SAJA, dan
-- berkas Tokopedia diunggah sebagai BAGIAN dari batch TikTok Shop klien yang
-- sama, bukan `client_platform` terpisah). Akibatnya: baris harian Tokopedia
-- dan baris harian TikTok Shop untuk klien yang SAMA berbagi
-- `client_platform_id` DAN `tanggal` DAN `basis` ('net' — Tokopedia satu-basis
-- sama seperti TikTok, Rule 15/16 tidak membedakan dua-duanya secara sengaja).
-- Tanpa kolom ini, kunci unik lama `(client_platform_id, tanggal, basis)`
-- membuat baris Tokopedia menimpa (ON CONFLICT DO UPDATE) baris TikTok Shop
-- pada tanggal yang sama, dan setiap query `basis = 'net'` yang sudah ada
-- (KPI/kanal/tahap/batal-harian TikTok) diam-diam menjumlah GMV Tokopedia ke
-- dalam angka TikTok Shop — kelas bug yang SAMA persis dengan R9 guardrail
-- (`pdt_fact_ads.tujuan`, migrasi `20261202010000`), sisi tabel yang berbeda.
--
-- Backfill: SELURUH baris `pdt_fact_shop_daily` hari ini basis `'net'` adalah
-- TikTok (nol modul Tokopedia ada sebelum F-01) → `kanal = 'tiktok'`; basis
-- `'dibuat'/'siap_dikirim'/'dibayar'` SELALU Shopee (tiga basis itu tidak
-- pernah dipakai platform lain) → `kanal = 'shopee'`. `NOT NULL` (bukan
-- nullable) dengan alasan sama F-02: setiap baris, dari sumber manapun, PUNYA
-- jawaban kanal — absennya nilai adalah lubang guardrail, bukan
-- ketidaktahuan yang sah.
--
-- Kunci unik lama `(client_platform_id, tanggal, basis)` DIGANTI
-- `(client_platform_id, tanggal, basis, kanal)` — TikTok dan Tokopedia pada
-- klien+tanggal+basis 'net' yang sama sekarang dua baris, bukan satu
-- menimpa yang lain.
--
-- Penegakan query ditulis di `packages/domain/src/pdt.ts` (LIMA titik literal
-- `basis = 'net'` terhadap tabel ini mendapat `and kanal = 'tiktok'`) — dicatat
-- lengkap di `docs/DECISIONS.md` M20-TOKOPEDIA-SAMPLE, bukan hanya di sini.
-- =============================================================================

ALTER TABLE pdt_fact_shop_daily
  ADD COLUMN kanal varchar(16) NULL;

UPDATE pdt_fact_shop_daily SET kanal = 'tiktok' WHERE basis = 'net';
UPDATE pdt_fact_shop_daily SET kanal = 'shopee' WHERE basis IN ('dibuat', 'siap_dikirim', 'dibayar');

ALTER TABLE pdt_fact_shop_daily
  ALTER COLUMN kanal SET NOT NULL,
  ADD CONSTRAINT ck_pdt_fsd_kanal CHECK (kanal IN ('tiktok', 'shopee', 'tokopedia'));

DROP INDEX uq_pdt_fact_shop_daily;
CREATE UNIQUE INDEX uq_pdt_fact_shop_daily ON pdt_fact_shop_daily (client_platform_id, tanggal, basis, kanal);

COMMENT ON COLUMN pdt_fact_shop_daily.kanal IS
  'Penanda kanal R8 (data model §4) — membedakan sumber baris ''net'' yang '
  'sekarang dua kemungkinan: ''tiktok'' (tt_shop_analytics) dan ''tokopedia'' '
  '(tt_shop_analytics_tokopedia, berkas Tokopedia yang menumpang batch TikTok '
  'Shop klien yang sama, PDT-22 disupersede R8 untuk cakupan ini — lihat '
  'docs/DECISIONS.md M20-TOKOPEDIA-SAMPLE). ''shopee'' menutupi ketiga basis '
  'Shopee (nol ambiguitas kanal di sana, kolom ini murni supaya CHECK dan '
  'kunci unik konsisten untuk seluruh tabel). Ditegakkan di '
  'packages/domain/src/pdt.ts (setiap literal `basis = ''net''` terhadap '
  'tabel ini WAJIB `and kanal = ''tiktok''` kecuali memang membaca Tokopedia).';
