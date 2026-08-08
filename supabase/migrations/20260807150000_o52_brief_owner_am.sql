-- ============================================================================
-- O52 — halaman detail Task/Asset/Booking menjawab 404 untuk DIVISI EKSEKUSINYA
-- SENDIRI.
--
-- Keputusan pemilik 2026-08-07: **pilihan (b)** — pindahkan jalur bacanya ke
-- fungsi `private.*` SECURITY DEFINER yang hanya mengembalikan JAWABANNYA,
-- bukan (a) "tambah arm divisi-eksekusi ke `services_select` + `clients_select`".
--
-- GEJALA: SPV/lead Creative membuka `/assets/AST-…` — Asset yang timnya sendiri
-- kerjakan — dan menerima **404 `[aset tidak ditemukan]`**. Bukan 403. Menurut
-- halaman itu, Asset-nya tidak ada.
--
-- SEBAB: gate domainnya BENAR. `canSeeBrief` (M6 §6/§9.1) justru MENGIZINKAN
-- staff/lead divisi tujuan. Yang membantahnya adalah RLS di tabel yang di-JOIN:
-- read model-nya men-join `services` + `clients` semata-mata untuk mengambil
-- `clients.assigned_am_id` (siapa AM pemiliknya), dan kedua policy itu tidak
-- punya arm divisi eksekusi ⇒ join membuang barisnya. Probe empiris (klaim
-- `{division:'Creative',level:'lead'}` lewat `SET LOCAL ROLE authenticated`):
-- `briefs` **1** baris (policy-nya MEMANG punya arm divisi), `services` **0**,
-- `clients` **0**, join ketiganya **0**.
--
-- Jadi 404-nya bukan kebohongan API — barisnya benar-benar nol setelah RLS.
-- Itulah yang membuat kelas cacat ini mahal: gejalanya "tidak ada", bukan
-- "tidak boleh", sehingga terbaca seperti data yang hilang.
--
-- KENAPA (b) DAN BUKAN (a)
-- ---------------------------------------------------------------------------
-- (a) menukar cacat 404 dengan kebocoran yang tidak diminta siapa pun. Divisi
-- Creative tidak butuh membaca baris `clients` — ia butuh membaca BRIEF-nya.
-- Menambahkan arm divisi-eksekusi ke `clients_select` membuka seluruh record
-- klien (PIC, kota, kontrak, GMV baseline) ke setiap divisi eksekusi, dan itu
-- keputusan visibility yang PRD M4 §6 tidak pernah berikan. Biayanya juga tidak
-- berhenti di sini: setiap tabel klien baru mewarisi keputusan itu.
--
-- (b) memberi persis yang dibutuhkan dan tidak lebih: SATU kolom, `assigned_am_id`,
-- yang sudah dipublikasikan sebagai bagian dari gate domain. Mengikuti pola
-- `sm_allowed_transitions` (20260803123327), `campaign_selectable`,
-- `employee_assignable`.
--
-- CAKUPAN — jalur BACA saja, dan itu disengaja
-- ---------------------------------------------------------------------------
-- Jalur TULIS (`lockBriefOwner`, `lockAssetOwner`, `lockBriefClient`, …) memakai
-- `for update` di dalam `withTransaction` dengan koneksi privileged: RLS tidak
-- berlaku di sana, row lock-nya wajib atas tabel aslinya, dan sebuah fungsi
-- STABLE tidak bisa mengunci baris. Menyentuhnya berarti mengganti kunci dengan
-- pembacaan — kelas bug yang jauh lebih buruk daripada yang diperbaiki di sini.
-- Jadi ia SENGAJA dibiarkan.
--
-- Juga sengaja TIDAK disentuh: `serviceQueue`, `listStrategies`, `getService`.
-- Itu jalur baca Account, dan di sana visibilitas klien memang gate yang
-- dikehendaki — bukan kecelakaan join.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS private;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

-- AM pemilik klien di balik sebuah Service. NULL bila Service/klien tidak ada
-- ATAU klien belum punya AM — pemanggil sudah membedakan keduanya lewat
-- keberadaan baris entitas induknya, jadi fungsi ini tidak perlu (dan tidak
-- boleh) melempar.
CREATE OR REPLACE FUNCTION private.service_owner_am(p_service_id text)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS
$$
  SELECT c.assigned_am_id
    FROM public.services sv
    JOIN public.clients c ON c.id = sv.client_id
   WHERE sv.id = p_service_id
$$;

-- AM pemilik klien di balik sebuah Brief. Didefinisikan lewat fungsi di atas
-- supaya "siapa AM-nya" punya SATU definisi, bukan dua yang bisa menyimpang.
CREATE OR REPLACE FUNCTION private.brief_owner_am(p_brief_id text)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS
$$
  SELECT private.service_owner_am(b.service_id)
    FROM public.briefs b
   WHERE b.id = p_brief_id
$$;

COMMENT ON FUNCTION private.service_owner_am(text) IS
  'O52 — AM pemilik klien di balik satu Service. Menggantikan '
  '`join services join clients` di jalur BACA, yang membuang barisnya untuk '
  'divisi eksekusi dan membuat halaman detail menjawab 404.';
COMMENT ON FUNCTION private.brief_owner_am(text) IS
  'O52 — sama, lewat Brief. Satu definisi "siapa AM-nya", bukan dua.';

REVOKE EXECUTE ON FUNCTION private.service_owner_am(text) FROM public;
REVOKE EXECUTE ON FUNCTION private.service_owner_am(text) FROM anon;
GRANT EXECUTE ON FUNCTION private.service_owner_am(text) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION private.brief_owner_am(text) FROM public;
REVOKE EXECUTE ON FUNCTION private.brief_owner_am(text) FROM anon;
GRANT EXECUTE ON FUNCTION private.brief_owner_am(text) TO authenticated, service_role;
