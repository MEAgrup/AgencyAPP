-- ============================================================================
-- B-4/B-5 — `assets_select` mendapat arm **AM pemilik klien**, **Account lead**,
--           dan **divisi Ads (baca saja)**.
--
-- Ditemukan oleh UAT peramban Jalur B (2026-09-07), bukan oleh test: seluruh
-- suite hijau sementara halamannya 404. Dua cacat, satu penyebab.
--
-- ---------------------------------------------------------------------------
-- CACAT 1 — AM pemilik klien NOL akses baca ke baris `assets`. (PRE-EXISTING.)
--
-- Bunyi policy sebelum migrasi ini (setelah O48 Grup B, `20260807160000`):
--
--     jwt_can_read_all()
--     OR jwt_employee_id() = assigned_pic
--     OR jwt_employee_id() = created_by
--     OR (jwt_is_lead() AND private.jwt_division_owns_brief(brief_id))
--
-- Seorang AM adalah `Account`/`staff`. Ia bukan PIC aset, bukan pembuatnya,
-- bukan lead divisi pelaksana, dan bukan OD/Director — jadi **tidak satu pun
-- arm menyala**. Diverifikasi langsung terhadap DB dengan klaim AM sungguhan:
--
--     AM melihat brief BRF-…-9001 ? 1 baris     ← briefs_select punya arm AM
--     AM melihat aset AST-…-0451  ? 0 baris     ← assets_select TIDAK punya
--
-- Akibatnya, untuk AM biasa:
--   * `GET /assets/{id}` (readAsActor) → **404 `[aset tidak ditemukan]`**;
--   * `GET /briefs/{id}/assets` → **`{"data":[]}`**, jadi panel "Review &
--     Approve Massal" AM kosong walau asetnya ada dan `[Submitted]`.
--
-- Dan AM adalah **satu-satunya** peran yang boleh menyetujui aset
-- (`[In Review]` → `[Approved]`, ketokan K-1). Jalur TULISNYA jalan — ia lewat
-- `db()` service-role di `creative.lockAssetOwner` — jadi yang rusak justru
-- halaman tempat tombolnya berada, bukan tombolnya. Persis pola O48/O52 yang
-- sudah dicatat repo ini: **halaman menjawab 200/404, tidak pernah 403, jadi ia
-- tidak terlihat rusak.**
--
-- Bentuk arm-nya: `private.brief_owner_am(brief_id)` — fungsi SECURITY DEFINER
-- yang lahir justru untuk masalah ini (`20260807150000_o52_brief_owner_am.sql`)
-- dan sudah dipakai `creative.assetSelect` di sisi TS. **Bukan** join
-- `services`→`clients` inline: di dalam policy `assets`, join itu ikut tersaring
-- RLS dan arm-nya mati diam-diam (kelas O46). Alasan yang sama seperti O48 Grup
-- B memilih `jwt_division_owns_brief` daripada `jwt_division_owns_asset`.
--
-- Arm `Account lead` ditambahkan berpasangan karena `creative.canSeeAsset`
-- sudah memberikannya (`permission.canReadDivision(actor, 'Account')` —
-- division-wide, PRD Phase 0 §4 Role Matrix), dan seorang Account lead hari ini
-- kena 404 yang sama.
--
-- ---------------------------------------------------------------------------
-- CACAT 2 — divisi Ads: TS bilang boleh, DB bilang tidak. (BARU, dari B-5.)
--
-- B-5/K-3 melebarkan `creative.canSeeAsset` dengan lengan divisi Ads supaya
-- Advertiser bisa MENEMUKAN aset yang harus ia tautkan ke kampanye. Daftar
-- pickernya sendiri aman tanpa migrasi ini — `listApprovedAssetsForClient`
-- berjalan service-role dengan gerbang `canSeeAsset` dievaluasi lebih dulu di
-- domain (perangkap O52). Tapi picker itu **menautkan ke halaman asetnya**, dan
-- `GET /assets/{id}` lewat `readAsActor`. Tanpa arm di bawah, hasilnya adalah
-- kombinasi terburuk: predikat TS meloloskan, RLS mengosongkan barisnya, dan
-- halaman menjawab **404** — bukan 403 yang bisa dibaca sebagai izin.
--
-- Menutupnya di sini, bukan dengan memindahkan `GET /assets/{id}` ke
-- service-role: satu tabel, satu aturan, ditegakkan DB (CLAUDE.md). Membuat
-- rute itu service-role akan menghapus SELURUH gerbang barisnya demi satu arm.
--
-- ---------------------------------------------------------------------------
-- YANG **TIDAK** BERUBAH
--   * Nol arm TULIS. Ini `FOR SELECT` — Ads tetap tidak bisa menggerakkan
--     status aset (edge-nya dijaga `sm_edges` + `canDriveReviewEdge`), dan
--     `assets_insert/update` tidak disentuh.
--   * Nol tabel/prefix/mesin/event baru ⇒ **nol counter** `db-rebuild.sh`/`ci.yml`.
--   * Ledger invariant `rls_checks.sql` §42 mendaftar policy yang **tanpa** arm
--     lead/divisi. `assets_select` sudah punya arm itu sejak O48 Grup B, jadi ia
--     tidak ada di daftar itu dan migrasi ini tidak menggesernya.
--   * `rls_checks.sql` check 25/§O48 bertumpu pada "lead Creative BISA melihat
--     aset divisinya" — masih benar, arm itu utuh.
-- ============================================================================

DROP POLICY IF EXISTS assets_select ON public.assets;
CREATE POLICY assets_select ON public.assets FOR SELECT TO authenticated
USING (
  public.jwt_can_read_all()
  OR public.jwt_employee_id() = assigned_pic::text
  OR public.jwt_employee_id() = created_by::text
  -- O48 Grup B: lead/SPV melihat seluruh Asset divisinya, lewat divisi Brief
  -- induknya — satu-satunya tempat divisi eksekusi tercatat. TIDAK BERUBAH.
  OR (public.jwt_is_lead() AND private.jwt_division_owns_brief(brief_id::text))
  -- B-4: AM pemilik klien — satu-satunya peran yang boleh menyetujui aset, dan
  -- sampai sekarang satu-satunya yang tidak bisa membacanya.
  OR public.jwt_employee_id() = private.brief_owner_am(brief_id::text)
  -- B-4: Account lead division-wide (cermin `permission.canReadDivision`).
  OR (public.jwt_is_lead() AND public.jwt_division() = 'Account')
  -- B-5/K-3: divisi Ads, BACA SAJA — ia harus menemukan aset [Approved] yang
  -- ditautkan ke kampanye (PRD M8 §4 Rule 2 / §9.1).
  OR (public.jwt_division() = 'Ads' AND public.jwt_employee_id() <> '')
);

COMMENT ON POLICY assets_select ON public.assets IS
  'O48 Grup B (2026-08-07): arm Lead/SPV division-wide lewat divisi Brief induk. '
  'B-4/B-5 (2026-09-07): + arm AM pemilik klien lewat private.brief_owner_am '
  '(AM adalah satu-satunya peran yang boleh approve aset dan satu-satunya yang '
  'tidak bisa membacanya — GET /assets/{id} 404, panel review massal kosong), '
  '+ Account lead division-wide, + divisi Ads baca-saja untuk picker aset K-3. '
  'Nol arm TULIS ditambahkan.';
