-- ===========================================================================
-- Divisi `Ops` DINONAKTIFKAN + pilar `operasional` pindah ke `Store Operation`
-- ===========================================================================
--
-- KEPUTUSAN PEMILIK 2026-09-14, menutup `OPS-NONAKTIF` di `docs/DECISIONS.md`.
--
-- KENAPA INI BUKAN SEKADAR MEMBALIK SATU FLAG. Usulan menonaktifkan `Ops`
-- sempat DITAHAN sesi ini justru karena `Ops` bukan divisi menganggur: ia
-- pemilik pilar `operasional` di `packages/core/src/planpillar.ts`
-- (`PILAR_TO_DIVISI`), anggota grup picker "Internal" (`plantask.PIC_GROUPS`),
-- dan anggota `DIVISI_KERJA` di tiga cermin frontend. Mematikannya tanpa
-- memindahkan pilar itu membuat `seedRowFromPillar` terus menyemai baris kerja
-- ke divisi yang tidak muncul di picker mana pun — yatim yang LEBIH sulit
-- dilihat daripada keadaan sebelumnya. Pemilik kini mengetok tujuannya:
-- `Store Operation`. Jadi urutannya dipenuhi lebih dulu di sisi kode
-- (commit yang sama), dan migrasi ini menutupnya di sisi data.
--
-- KONSEKUENSI YANG DISENGAJA: `Store Operation` ber-`punya_kuota_satuan = true`
-- sedangkan `Ops` `false`. Baris yang disemai pilar `operasional` kini mendarat
-- di divisi YANG PUNYA `TASK_CATALOG`, jadi `taskDefaultsFor` memberinya jenis
-- task sungguhan alih-alih jatuh ke `Lainnya` — kemampuan yang justru hilang
-- selama pilar ini menunjuk `Ops`.
--
-- `aktif = false` BUKAN penghapusan baris. `briefs.assigned_division`,
-- `plan_row.divisi_pic` dan `wrr_divisi.divisi` menyimpan LABEL, bukan FK, jadi
-- baris lama ber-`Ops` tetap terbaca. Flag lain sengaja tidak disentuh: kalau
-- `Ops` dihidupkan lagi, ia kembali dengan perilaku yang sama persis.
--
-- DUAL-HOME: `packages/core/src/division.ts` diubah di commit yang sama
-- (`OPS` → `aktif: false`); `packages/db/src/division.registry.test.ts` gagal
-- kalau keduanya menyimpang.
--
-- SISA DATA BER-`Ops` DI LIVE, dan semuanya dibereskan: Brief `BRF-202609-0003`
-- sudah pindah ke `Store Operation` di migrasi 20261016010000, dan satu
-- `plan_row` (pilar `sku`, PIC pilihan AM — bukan hasil semai pilar) dipindah
-- di bawah ini. Sesudah migrasi ini nol baris kerja live yang menunjuk `Ops`.
-- ===========================================================================

DO $$
DECLARE
  v_actor text := '200000002';  -- Nerissa (COO/Director)
  r       record;
BEGIN
  -- 1. Pindahkan baris Plan yang tersisa. Dijaga oleh nilai asalnya ⇒ rerun no-op.
  FOR r IN SELECT id, pilar, divisi_pic FROM plan_row WHERE divisi_pic = 'Ops'
  LOOP
    UPDATE plan_row SET divisi_pic = 'Store Operation' WHERE id = r.id;

    INSERT INTO audit_log (entity_type, entity_id, actor_employee_id, action,
                           before_json, after_json, created_by)
    VALUES ('plan_row', r.id::text, v_actor, 'update',
            jsonb_build_object('divisi_pic', 'Ops', 'pilar', r.pilar),
            jsonb_build_object('divisi_pic', 'Store Operation', 'pilar', r.pilar,
                               'alasan', 'Divisi Ops dinonaktifkan — pilar operasional dan pekerjaan toko pindah ke Store Operation'),
            v_actor);
  END LOOP;

  -- 2. Gerbang: jangan matikan divisi yang masih dipegang baris kerja hidup.
  --    Lebih baik migrasi ini gagal keras daripada meninggalkan baris yatim.
  IF EXISTS (SELECT 1 FROM plan_row WHERE divisi_pic = 'Ops')
     OR EXISTS (SELECT 1 FROM briefs b
                 WHERE b.assigned_division = 'Ops'
                   AND NOT EXISTS (SELECT 1 FROM sm_terminal_states t
                                    WHERE t.machine = 'brief_task' AND t.state = b.status))
  THEN
    RAISE EXCEPTION 'Masih ada baris kerja hidup ber-divisi Ops — pindahkan dulu sebelum menonaktifkannya';
  END IF;
END $$;

-- 3. Matikan divisinya.
UPDATE division_registry SET aktif = false WHERE code = 'OPS';

COMMENT ON TABLE division_registry IS
  'M16 — registry divisi CDPS. Cermin DB dari DIVISIONS di packages/core/src/division.ts; keduanya dijaga identik oleh division.registry.test.ts. `nama` adalah label yang tersimpan di briefs.assigned_division / role_mappings.division / wrr_divisi.divisi. Sejak 2026-09-14 `OPS` nonaktif (nol karyawan sejak lahir); pilar `operasional` dan pekerjaan toko ditangani `STORE_OPS`.';
