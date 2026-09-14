-- ===========================================================================
-- Pindahkan satu Brief yatim dari divisi `Ops` ke `Store Operation`
-- ===========================================================================
--
-- KONTEKS (perapihan role mapping, keputusan pemilik 2026-09-14).
-- `BRF-202609-0003` (deliverable `sku`, dibuat 2026-09-02) duduk di `[To Do]`
-- tanpa PIC selama dua belas hari. Sebabnya struktural, bukan kelalaian:
-- divisi `Ops` punya NOL baris `role_mappings` dan NOL karyawan sejak lahir,
-- jadi tidak ada satu pun orang yang bisa dipilih sebagai PIC-nya. Pemilik
-- mengonfirmasi Brief ini artefak testing dan boleh dihapus ATAU dipindah.
--
-- DIPINDAH, BUKAN DIHAPUS: rumah tangga #3 tidak menyediakan jalur DELETE bagi
-- baris berjejak audit, dan `sku` memang pekerjaan toko — `Store Operation`
-- (M18) yang akan diisi tiga orang pada perapihan ini adalah rumah yang benar.
--
-- `Ops` SENGAJA TIDAK DINONAKTIFKAN di migrasi ini, walau rencana awal begitu.
-- Pemeriksaan kode menunjukkan `Ops` BUKAN divisi menganggur: ia pemilik pilar
-- `operasional` di `packages/core/src/planpillar.ts` (`PILAR_TO_DIVISI`), ada
-- di grup picker "Internal" `plantask.PIC_GROUPS`, dan live `CDPS SG` memuat
-- satu `plan_row` ber-`divisi_pic = 'Ops'`. Mematikannya menuntut pilar
-- `operasional` dipindahkan ke divisi lain — keputusan tingkat PRD M6B yang
-- belum diketok, dan CLAUDE.md melarang menebaknya. Dikembalikan ke pemilik.
-- ===========================================================================

DO $$
DECLARE
  v_actor text := '200000002';  -- Nerissa (COO/Director)
BEGIN
  -- Dijaga oleh divisi asalnya: rerun dan DB baru sama-sama no-op.
  IF EXISTS (SELECT 1 FROM briefs
              WHERE id = 'BRF-202609-0003' AND assigned_division = 'Ops') THEN
    UPDATE briefs SET assigned_division = 'Store Operation'
     WHERE id = 'BRF-202609-0003';

    INSERT INTO audit_log (entity_type, entity_id, actor_employee_id, action,
                           before_json, after_json, created_by)
    VALUES ('brief', 'BRF-202609-0003', v_actor, 'update',
            jsonb_build_object('assigned_division', 'Ops'),
            jsonb_build_object('assigned_division', 'Store Operation',
                               'alasan', 'Divisi Ops nol karyawan sejak lahir — pekerjaan SKU dipindah ke Store Operation'),
            v_actor);
  END IF;
END $$;
