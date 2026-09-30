-- ============================================================================
-- Improvement Req Account (pemilik, 2026-09-30) — butir 6: Ads "Mulai Iklan"
-- dan "Selesai Iklan". Rujukan: docs/DECISIONS.md 2026-09-30
-- "ADS-PERIODE-IKLAN-AKTUAL".
--
-- Keluhan: "belum tentu kontrak 1 bulan pengerjaannya 1 bulan". Hari ini
-- `ad_campaigns.start_date`/`end_date` adalah tanggal RENCANA yang diketik
-- Advertiser saat kampanye dibuat, dan tombol Luncurkan/Akhiri tidak mencatat
-- tanggal apa pun — tanggal iklan SUNGGUHAN mulai & selesai hanya tersirat di
-- audit_log, tak terbaca di layar mana pun.
--
-- Dua kolom FAKTA (bukan turunan) — tanggal yang dinyatakan Advertiser saat
-- menekan Mulai Iklan / Selesai Iklan (boleh mundur, mis. iklan sudah jalan
-- kemarin tapi baru dicatat hari ini; tidak boleh di masa depan — ditegakkan
-- domain). Keduanya ditulis HANYA oleh `ads.launchCampaign` (sekali, saat
-- pertama kali [Active]) dan `ads.endCampaign` (saat [Ended]), di transaksi yang
-- sama dengan transisinya + baris audit `periode_iklan_dicatat`.
--
-- `iklan_mulai` juga menjadi JANGKAR Ads Management Date (M16 LT-42) bila
-- terisi — keputusan durasi Q4 (2026-09-07): "durasi dihitung dari start
-- campaign". `start_date` rencana tetap jadi cadangan untuk kampanye yang belum
-- pernah diluncurkan.
--
-- Nol tabel / prefix / mesin / event baru ⇒ gate 187/45/36/83 TETAP.
-- ============================================================================

ALTER TABLE ad_campaigns ADD COLUMN iklan_mulai date NULL;
ALTER TABLE ad_campaigns ADD COLUMN iklan_selesai date NULL;
ALTER TABLE ad_campaigns ADD CONSTRAINT ck_ad_campaigns_iklan_urut
    CHECK (iklan_mulai IS NULL OR iklan_selesai IS NULL OR iklan_selesai >= iklan_mulai);
ALTER TABLE ad_campaigns ADD CONSTRAINT ck_ad_campaigns_iklan_selesai_butuh_mulai
    CHECK (iklan_selesai IS NULL OR iklan_mulai IS NOT NULL);

COMMENT ON COLUMN ad_campaigns.iklan_mulai IS
  'ADS-PERIODE-IKLAN-AKTUAL — tanggal iklan SUNGGUHAN mulai (WIB), dicatat saat '
  'Mulai Iklan pertama ([Setting]/[Paused]→[Active]). Beda dari start_date '
  '(rencana). Jangkar Ads Management Date bila terisi.';
COMMENT ON COLUMN ad_campaigns.iklan_selesai IS
  'ADS-PERIODE-IKLAN-AKTUAL — tanggal iklan SUNGGUHAN selesai (WIB), dicatat saat '
  'Selesai Iklan (→[Ended]). Beda dari end_date (rencana).';

-- Backfill dari riwayat transisi yang sudah ada (tanggal kalender WIB). Nol
-- baris audit baru: fakta ini SUDAH tercatat di audit_log, kolom hanya
-- membuatnya terbaca.
UPDATE ad_campaigns c
   SET iklan_mulai = x.d
  FROM (SELECT a.entity_id, min((a.created_at AT TIME ZONE 'Asia/Jakarta')::date) AS d
          FROM audit_log a
         WHERE a.entity_type = 'ad_campaign' AND a.action LIKE 'transition:%->[Active]'
         GROUP BY a.entity_id) x
 WHERE x.entity_id = c.id AND c.iklan_mulai IS NULL;

UPDATE ad_campaigns c
   SET iklan_selesai = greatest(x.d, c.iklan_mulai)
  FROM (SELECT a.entity_id, max((a.created_at AT TIME ZONE 'Asia/Jakarta')::date) AS d
          FROM audit_log a
         WHERE a.entity_type = 'ad_campaign' AND a.action LIKE 'transition:%->[Ended]'
         GROUP BY a.entity_id) x
 WHERE x.entity_id = c.id AND c.iklan_selesai IS NULL AND c.iklan_mulai IS NOT NULL;
