-- ===========================================================================
-- PLAN-TIER-REPIN · Backfill — Service yang belum mulai ikut tier katalog
-- yang berlaku hari ini
-- ===========================================================================
--
-- ⚠️ JANGAN DITERAPKAN KE PRODUKSI (`CDPS SG`) TANPA INSTRUKSI EKSPLISIT
-- PEMILIK. Aturan re-pin-nya disetujui Yohan 2026-10-20 (DECISIONS.md
-- PLAN-TIER-REPIN), tetapi PENERAPAN LIVE adalah langkah terpisah: ukur dulu
-- dampaknya dengan query read-only di deskripsi PR, lalu tunggu "terapkan".
--
-- ## Cacat yang ditambal (feedback B1–B3, 2026-10-19)
--
-- Service mematok tier dari versi MSL saat closing (M6 §2). Mengubah tier di
-- admin MSL membuat versi baru, tapi Service yang sudah terjual tidak pernah
-- di-re-pin — satu-satunya re-pin adalah migrasi 20260806062000 (sekali, saat
-- tier lahir). Akibatnya Service yang katalognya sudah dikoreksi ke Direct
-- tetap meminta "Buat Strategi", dan CRO mem-Void Service sebagai cara "ganti
-- flow" (SVC-202609-0007, SVC-202608-0012, SVC-202609-0008).
--
-- `msl.updateService` kini me-re-pin pada saat edit. Migrasi ini menambal baris
-- yang tertinggal SEBELUM kode itu ada: pembandingnya versi katalog yang
-- BERLAKU hari ini (WIB), bukan versi terbaru — versi bertanggal depan belum
-- berlaku dan tidak boleh menggerakkan apa pun.
--
-- ## Cakupan — predikatnya SAMA dengan `msl.repinUnstartedServices`
--
-- Hanya Service yang belum disentuh siapa pun:
--   * status `[Awaiting Onboarding]`;
--   * tanpa override M6-OA-1 (`requires_strategy_plan_override IS NULL`);
--   * tanpa penentuan G-B (`service_plan_gate`);
--   * tanpa STR- (`strategy_plans`) dan tanpa STRG- (`strategi`, status apa
--     pun, termasuk Draft) di kontraknya.
-- Lewat titik itu, jalurnya adalah keputusan yang sudah diambil — pin ada
-- justru untuk melindunginya.
--
-- Yang berubah HANYA `plan_tier` + `requires_strategy_plan`. `master_version_no`
-- dan harga tetap versi saat terjual. Kolom status tidak disentuh, jadi tidak
-- ada transisi (`sm_transition` tidak relevan). Satu baris `audit_log`
-- `plan_tier_repin` per Service dengan aktor `SISTEM` (pola 20260922100400).
--
-- Idempoten: predikat `sv.plan_tier <> versi berlaku` — jalan kedua menemukan
-- nol baris. Aditif, nol penghapusan.
-- ===========================================================================

DO $$
DECLARE
    v_moved integer;
BEGIN
    WITH berlaku AS (
        SELECT DISTINCT ON (msv.service_id)
               msv.service_id, msv.version_no, msv.plan_tier, msv.requires_strategy_plan
          FROM master_service_versions msv
         WHERE msv.effective_from <= (now() AT TIME ZONE 'Asia/Jakarta')::date
         ORDER BY msv.service_id, msv.effective_from DESC, msv.version_no DESC
    ),
    target AS (
        SELECT sv.id,
               sv.plan_tier              AS old_tier,
               sv.requires_strategy_plan AS old_requires,
               b.plan_tier               AS new_tier,
               b.requires_strategy_plan  AS new_requires,
               b.version_no
          FROM services sv
          JOIN berlaku b ON b.service_id = sv.master_service_id
         WHERE sv.status = '[Awaiting Onboarding]'
           AND sv.requires_strategy_plan_override IS NULL
           AND sv.plan_tier <> b.plan_tier
           AND NOT EXISTS (SELECT 1 FROM service_plan_gate g WHERE g.service_id = sv.id)
           AND NOT EXISTS (SELECT 1 FROM strategy_plans sp WHERE sp.service_id = sv.id)
           AND NOT EXISTS (SELECT 1 FROM strategi s WHERE s.contract_id = sv.contract_id)
           FOR UPDATE OF sv
    ),
    moved AS (
        UPDATE services sv
           SET plan_tier = t.new_tier,
               requires_strategy_plan = t.new_requires
          FROM target t
         WHERE sv.id = t.id
        RETURNING t.*
    )
    INSERT INTO audit_log (entity_type, entity_id, actor_employee_id, action,
                           before_json, after_json, created_by)
    SELECT 'service', m.id, 'SISTEM', 'plan_tier_repin',
           jsonb_build_object('plan_tier', m.old_tier,
                              'requires_strategy_plan', m.old_requires),
           jsonb_build_object('plan_tier', m.new_tier,
                              'requires_strategy_plan', m.new_requires,
                              'master_service_version', m.version_no),
           'SISTEM'
      FROM moved m;

    GET DIAGNOSTICS v_moved = ROW_COUNT;
    RAISE NOTICE 'plan_tier_repin_backfill: % Service di-re-pin', v_moved;
END $$;
