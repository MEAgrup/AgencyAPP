-- CDPS — Module 6C §4(b) / backlog B-11: integritas "satu service ⇒ satu Plan".
--
-- Menutup satu-satunya sisa M6B. Menyelesaikan yang migrasi gate M6C
-- (20260806061000, section 4) sengaja tunda: *"PK service_id membuat 'satu
-- penentuan per service' mustahil dilanggar, dan plan_id tunggal per baris
-- membuat satu service tidak bisa menunjuk dua Plan. Sisa constraint-nya ikut
-- migrasi M6B."* B-10 sudah memasang FK `service_plan_gate.plan_id → plan`; kini
-- "sisa"-nya bisa berdiri di atas FK itu.
--
-- ===========================================================================
-- Apa DUA klausa §4(b), dan kenapa hanya SATU jadi objek DB baru di sini
-- ===========================================================================
-- PRD §10 meminta: (1) "partial unique index guaranteeing a service maps to at
-- most one Plan" + (2) "a check that a service belonging to a Full-Management
-- contract cannot have plan_id pointing at a lingkup='klien' Plan".
--
-- KLAUSA (1) — SUDAH DITEGAKKAN, tanpa objek baru. Peta service→Plan hidup di
--   `service_plan_gate.plan_id`, dan `service_id` adalah PRIMARY KEY tabel itu:
--   satu baris gate per service ⇒ satu nilai `plan_id` ⇒ ≤1 Plan. Sebuah partial
--   unique index `(service_id) WHERE plan_id IS NOT NULL` adalah SUBSET ketat dari
--   keunikan PK — 100% redundan, tak ada jalur tulis yang melewati PK untuk
--   dijaganya. Menambahkannya justru MENENTANG penalaran yang sudah ditulis migrasi
--   gate. Jadi klausa (1) dibiarkan dijaga PK; keputusan mekanisme ini dicatat
--   docs/DECISIONS.md 2026-08-11 (B-11).
--
-- KLAUSA (2) — objek baru migrasi ini. Inilah kebocoran §4(b) yang nyata: sebuah
--   klien boleh memegang kontrak Full-Management DAN membeli service satuan
--   (§4b). Kontrak Full-Management memayungi n service di bawah SATU Strategi
--   (DATA_MODEL "Strategi (Full Store Management)"; contoh: Store Management +
--   GMV Max + Nano KOL = satu Strategi) → SATU Plan `lingkup='kontrak'`. Service
--   di dalamnya menempel ke Plan itu; kalau salah satunya juga masuk Plan Satuan
--   `lingkup='klien'`, service itu ada di DUA Plan — persis bug integritas yang
--   §4 sebut "enforced by a DB constraint, not a convention".
--
-- ===========================================================================
-- Kenapa TRIGGER, bukan CHECK; kenapa "punya Strategi", bukan tier service
-- ===========================================================================
-- "Milik kontrak Full-Management" adalah fakta lintas-tabel: service → contract
-- → apakah contract itu punya Strategi. CHECK tak boleh ber-subquery, jadi
-- penegaknya trigger (pola sama `strategi_leading_indicator`/subset J-3 yang juga
-- lintas-baris).
--
-- Penandanya "kontrak service punya Strategi", BUKAN `services.plan_tier =
-- 'plan_wajib'`. Alasannya: satu kontrak Full-Management bisa memuat service
-- ber-tier `ditentukan_am` (add-on yang dibeli belakangan, §4b "even when
-- purchased separately later"). Tier per-service tidak menangkapnya; keberadaan
-- Strategi pada kontraknya menangkapnya. Strategi (bukan Plan `kontrak`) dipakai
-- sebagai penanda karena ia LEBIH DULU ada (M6A sebelum M6B) — menutup jendela di
-- mana Strategi sudah dibuat tapi Plan kontraknya belum digenerasi.
--
-- Service satuan sejati tidak pernah kena: contract_id-nya NULL atau menunjuk
-- kontrak tanpa Strategi (contoh Sini Store §9, "no full-management contract").
-- Pengecekan ber-scope KONTRAK service, bukan KLIEN — klien yang punya kontrak
-- Full-Management TETAP boleh menaruh service satuan berdiri-sendiri ke Plan
-- Satuan; yang dilarang hanya service yang benar-benar di DALAM kontrak itu.
--
-- Cerminan TS (invariant beku, "the two must not diverge"): predikat yang sama
-- dijaga di packages/domain/src/plangate.ts (decideGate/redecideGate) sebelum
-- openOrJoinPlanSatuanTx dipanggil, dengan pesan BI MSG_FULL_MGMT_PLAN.

-- ---------------------------------------------------------------------------
-- Trigger §4(b) klausa (2)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION check_spg_service_single_plan()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_lingkup    text;
    v_contract   text;
BEGIN
    IF NEW.plan_id IS NULL THEN
        RETURN NEW;
    END IF;

    -- Gate hanya boleh menautkan ke Plan Satuan (lingkup='klien'). Kalau plan_id
    -- menunjuk Plan kontrak, itu sendiri sudah cacat §4(b) — service satuan tidak
    -- pernah masuk Plan Full-Management lewat gate.
    SELECT lingkup INTO v_lingkup FROM plan WHERE id = NEW.plan_id;
    IF v_lingkup IS NULL OR v_lingkup <> 'klien' THEN
        RAISE EXCEPTION
          '[Plan yang ditautkan bukan Plan Satuan klien]';
    END IF;

    -- §4(b): service yang kontraknya punya Strategi (= kontrak Full-Management)
    -- sudah tercakup Plan kontraknya; ia tidak boleh masuk Plan Satuan.
    SELECT contract_id INTO v_contract FROM services WHERE id = NEW.service_id;
    IF v_contract IS NOT NULL
       AND EXISTS (SELECT 1 FROM strategi WHERE contract_id = v_contract) THEN
        RAISE EXCEPTION
          '[layanan dalam kontrak full management tidak masuk Plan Satuan, sudah tercakup Plan kontraknya]';
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION check_spg_service_single_plan() IS
  'M6C §4(b)/B-11 — menjaga satu service tidak masuk dua Plan: gate hanya boleh '
  'menautkan Plan Satuan (lingkup=klien), dan service dalam kontrak '
  'Full-Management (kontraknya punya Strategi) tidak boleh masuk Plan Satuan.';

CREATE TRIGGER trg_spg_service_single_plan
    BEFORE INSERT OR UPDATE OF plan_id ON service_plan_gate
    FOR EACH ROW EXECUTE FUNCTION check_spg_service_single_plan();
