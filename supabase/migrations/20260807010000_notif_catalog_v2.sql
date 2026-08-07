-- CDPS — Amandemen katalog notifikasi ke v2 (O55, DECISIONS.md 2026-08-07).
--
-- ---------------------------------------------------------------------------
-- APA YANG DIPUTUSKAN, DAN KENAPA BENTUKNYA BEGINI
-- ---------------------------------------------------------------------------
-- Katalog notifikasi adalah invariant BEKU. Sampai hari ini "beku" ditegakkan
-- dengan satu literal: tes meng-assert `events().length == 15` (kemudian 17,
-- setelah dua deviasi lead-delete). Literal itu punya dua sifat buruk:
--
--   * ia tidak bisa membedakan "seseorang menambah event yang sudah disetujui"
--     dari "seseorang menambah event diam-diam" — keduanya cuma mengubah angka;
--   * setiap penambahan yang sah memaksa menyentuh invariant, dan sebuah
--     invariant yang rutin disentuh berhenti menjadi invariant.
--
-- O55 pilihan (a): katalog jadi BERVERSI. Angkanya pindah dari kode tes ke
-- BARIS TERDAFTAR di `notif_catalog_versions` — satu baris per versi, dengan
-- jumlah event yang versi itu bawa. Tes berhenti meng-assert literal dan mulai
-- meng-assert "jumlah event yang ADA == jumlah yang TERDAFTAR". Menambah event
-- tanpa mendaftarkannya tetap MERAH; menambah event bersama pendaftarannya
-- adalah amandemen yang terlihat di diff sebagai satu baris versi.
--
-- 15 event v1 tidak disentuh sama sekali — dan itu ditegakkan trigger di bawah,
-- bukan dijanjikan komentar.
--
-- ---------------------------------------------------------------------------
-- ISI v2 — 14 event
-- ---------------------------------------------------------------------------
-- 13 dari M6A/6B/6C (M6A §7 D12 · M6B §9 · M6C §10 — ketiganya menunjuk SATU
-- migrasi, "one migration, not three"), + 1 dari O53:
--
--   4 Strategi : strategi_diajukan · strategi_disetujui · strategi_dikembalikan
--                strategi_revisi_disarankan
--   6 Plan     : plan_periode_aktif · plan_target_diturunkan
--                plan_baris_belum_dieksekusi · plan_keberatan_kapasitas
--                plan_realisasi_belum_lengkap · plan_periode_ditutup
--   3 Gate     : gate_override_dicatat · plan_sekarang_disarankan
--                gate_deeskalasi_diminta
--   1 Account  : m6.client.assigned  (O53 — M6 §3 Flow 3 "System notifies the
--                AM" tidak punya event; keputusan O55 adalah mekanisme yang
--                O53 tunggu)
--
-- ⚠️ PENAMAAN. 13 event M6A/6B/6C ditulis PERSIS seperti di PRD-nya
-- (`strategi_diajukan`, bukan `m6a.strategi.diajukan`), meskipun 17 event v1
-- memakai konvensi bertitik `mN.entitas.aksi`. Aturan rumah: PRD menang, dan
-- mengarang ulang identifier yang PRD tulis eksplisit adalah persis "rename"
-- yang dilarang. `m6.client.assigned` memakai konvensi bertitik karena O53-lah
-- yang menuliskan namanya begitu, bukan PRD.
--
-- ---------------------------------------------------------------------------
-- PENGHITUNGAN — kenapa 31, bukan 28
-- ---------------------------------------------------------------------------
-- Ketiga PRD menghitung "base 15 + 4 + 6 + 3 = 28". Base sebenarnya di CDPS
-- adalah 17: 15 beku + 2 deviasi `m1.lead.delete_*` yang tercatat (DECISIONS
-- 2026-07-29) dan sudah live sejak 20260729162101. Jadi v2 = 17 + 14 = 31.
-- Selisih itu bukan penyimpangan dari PRD — PRD ditulis sebelum deviasi
-- lead-delete ada. Registry di bawah mencatat kedua angka supaya pembaca
-- berikutnya tidak menyimpulkan ada 3 event yang hilang.

-- ---------------------------------------------------------------------------
-- 1. Registry versi katalog
-- ---------------------------------------------------------------------------
CREATE TABLE notif_catalog_versions (
    version        smallint    NOT NULL PRIMARY KEY,
    description    text        NOT NULL,
    -- Jumlah event yang versi INI perkenalkan (bukan kumulatif). Inilah angka
    -- yang menggantikan literal di tes.
    event_count    integer     NOT NULL,
    decision_ref   text        NOT NULL,
    adopted_at     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_notif_catalog_version_positive CHECK (version >= 1),
    CONSTRAINT ck_notif_catalog_count_positive   CHECK (event_count >= 0)
);

COMMENT ON TABLE notif_catalog_versions IS
    'Amandemen katalog notifikasi, satu baris per versi (O55). event_count = jumlah event yang versi itu perkenalkan; invariant menuntut SUM(event_count) = COUNT(notif_events).';

INSERT INTO notif_catalog_versions (version, description, event_count, decision_ref) VALUES
    (1, 'Fase 0 v2 §9 — 15 event beku + 2 deviasi lead-delete tercatat (DECISIONS 2026-07-29)', 17,
        'docs/DECISIONS.md 2026-07-29 (lead delete) + Phase 0 v2 §9'),
    (2, 'M6A §7 D12 + M6B §9 + M6C §10 — 4 Strategi, 6 Plan, 3 Gate; + m6.client.assigned (O53)', 14,
        'docs/DECISIONS.md 2026-08-07 (O55 pilihan a; menutup O53)');

-- ---------------------------------------------------------------------------
-- 2. Kolom versi di katalog itu sendiri
-- ---------------------------------------------------------------------------
-- DEFAULT 1 bukan kenyamanan: ia menyatakan bahwa 17 baris yang sudah ada
-- memang v1, tanpa satu pun UPDATE atas baris beku.
ALTER TABLE notif_events
    ADD COLUMN catalog_version smallint NOT NULL DEFAULT 1
        REFERENCES notif_catalog_versions(version);

COMMENT ON COLUMN notif_events.catalog_version IS
    'Versi katalog yang memperkenalkan event ini. Baris v1 tidak bisa diubah/dihapus (trigger trg_notif_events_v1_frozen).';

-- ---------------------------------------------------------------------------
-- 3. 14 event v2
-- ---------------------------------------------------------------------------
-- Resolver diturunkan dari kolom "Recipients" di tabel PRD masing-masing:
--   satu penerima eksplisit           -> explicit
--   hanya lead/SPV sebuah divisi      -> leadsOfDivision
--   penerima eksplisit DAN lead/SPV   -> explicitOrLeads
INSERT INTO notif_events (event_type, description, resolver, catalog_version) VALUES
    -- 4 Strategi (M6A §7 D12)
    ('strategi_diajukan',            'Strategi diajukan AM (v1 atau revisi) — ke SPV/Head of Account', 'leadsOfDivision', 2),
    ('strategi_disetujui',           'Strategi disetujui reviewer — ke AM, lead divisi eksekusi, Finance', 'explicitOrLeads', 2),
    ('strategi_dikembalikan',        'Strategi dikembalikan reviewer dengan catatan — ke AM', 'explicit', 2),
    ('strategi_revisi_disarankan',   'Pemicu H-2 menyala atau asumsi D-8 flip ke Gugur — ke AM + SPV', 'explicitOrLeads', 2),
    -- 6 Plan (M6B §9)
    ('plan_periode_aktif',           'Periode Plan aktif (manual atau otomatis) — ke AM + lead divisi yang punya baris', 'explicitOrLeads', 2),
    ('plan_target_diturunkan',       'Penyesuaian target ke bawah — ke SPV (>10% = permintaan persetujuan)', 'leadsOfDivision', 2),
    ('plan_baris_belum_dieksekusi',  'Baris tanpa Brief di tengah periode — ke AM + SPV', 'explicitOrLeads', 2),
    ('plan_keberatan_kapasitas',     'Divisi mengajukan keberatan kapasitas — ke AM + SPV', 'explicitOrLeads', 2),
    ('plan_realisasi_belum_lengkap', 'GMV manual belum diisi 5 hari setelah tutup — ke AM + SPV', 'explicitOrLeads', 2),
    ('plan_periode_ditutup',         'Periode ditutup (termasuk auto-close, dengan flag) — ke AM, SPV, Finance', 'explicitOrLeads', 2),
    -- 3 Gate (M6C §10)
    ('gate_override_dicatat',        'Keputusan AM menyimpang dari rekomendasi gerbang — ke SPV', 'leadsOfDivision', 2),
    ('plan_sekarang_disarankan',     'Pemicu keras muncul pada service tanpa Plan — ke AM + SPV', 'explicitOrLeads', 2),
    ('gate_deeskalasi_diminta',      'AM minta mematikan Plan di tengah service — ke SPV (butuh persetujuan)', 'leadsOfDivision', 2),
    -- 1 Account (O53 — M6 §3 Flow 3)
    ('m6.client.assigned',           'Klien di-assign ke AM — ke AM bersangkutan', 'explicit', 2);

-- ---------------------------------------------------------------------------
-- 4. Baris v1 dibekukan secara STRUKTURAL
-- ---------------------------------------------------------------------------
-- "15 event lama tak disentuh" adalah bagian dari keputusan O55, jadi ia harus
-- ditegakkan, bukan diminta baik-baik. Tanpa trigger ini, sebuah `UPDATE
-- notif_events SET resolver = …` pada baris v1 lolos diam-diam dan mengubah
-- SIAPA yang diberi tahu untuk 15 event yang sudah berjalan — perubahan yang
-- tidak muncul di hitungan mana pun, karena jumlah barisnya tidak berubah.
CREATE OR REPLACE FUNCTION notif_events_v1_frozen()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.catalog_version = 1 THEN
            RAISE EXCEPTION 'notif_events: katalog v1 beku — event % tidak bisa dihapus', OLD.event_type;
        END IF;
        RETURN OLD;
    END IF;
    IF OLD.catalog_version = 1 THEN
        RAISE EXCEPTION 'notif_events: katalog v1 beku — event % tidak bisa diubah', OLD.event_type;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notif_events_v1_frozen
    BEFORE UPDATE OR DELETE ON notif_events
    FOR EACH ROW EXECUTE FUNCTION notif_events_v1_frozen();

-- ---------------------------------------------------------------------------
-- 5. RLS — persis perlakuan `notif_events`
-- ---------------------------------------------------------------------------
-- `notif_events` di-REVOKE penuh dari `authenticated` (rls_baseline baris 180):
-- katalog tidak pernah dibaca klien langsung, hanya oleh `notify_emit` yang
-- SECURITY DEFINER. Registry versi mengikuti perlakuan yang sama — kalau tidak,
-- ia menjadi satu-satunya tabel katalog yang bisa diintip lewat PostgREST.
REVOKE ALL ON public.notif_catalog_versions FROM anon;
REVOKE ALL ON public.notif_catalog_versions FROM authenticated;

ALTER TABLE public.notif_catalog_versions ENABLE ROW LEVEL SECURITY;
-- Nol policy: dengan RLS menyala dan tanpa policy, tidak ada baris yang terlihat
-- bagi peran ber-RLS mana pun. Amandemen katalog hanya lewat migrasi (berjalan
-- sebagai owner, melewati RLS) — dan itu memang gerbangnya.
