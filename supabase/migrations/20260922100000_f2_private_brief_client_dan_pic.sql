-- ============================================================================
-- F-2 — antrean Brief divisi menyebut BRAND dan PIC, bukan `SVC-…` telanjang.
--
-- Feedback OD 2026-09-07, keluhan Creative #3: leader membuka antrean divisinya
-- dan tidak bisa tahu Brief ini milik klien yang mana — kolomnya `service_id`.
-- Yang dia butuh: nama toko klien, dan nama PIC yang dipegangi Asset-nya.
--
-- KENAPA FUNGSI, BUKAN JOIN
-- ---------------------------------------------------------------------------
-- `account.listDivisionQueue` dibaca lewat `readAsActor` — RLS MENYALA — dan
-- pembacanya justru divisi eksekusi (Creative/Ads/KOL). Menambah
-- `join services join clients` di situ mengulang persis O52
-- (`20260807150000_o52_brief_owner_am.sql`): probe hari ini, sebagai
-- `authenticated` dengan klaim `{division:'Creative',level:'lead'}`,
-- `services_select` = `jwt_can_read_all() OR created_by = … OR
-- private.jwt_owns_client(…) OR (lead AND Account)` ⇒ NOL baris untuk divisi
-- eksekusi, dan `clients_select` juga tidak punya lengannya (lengan yang ada:
-- Finance, Account lead, Sales lead, dan Ads yang memang punya Brief Ads).
-- Join-nya bukan bikin kolomnya null — ia membuang SELURUH barisnya, jadi
-- antrean divisi akan tampak kosong, bukan salah. "Tidak ada", bukan
-- "tidak boleh": kelas cacat yang paling mahal dicari.
--
-- Keputusan O52 sudah diketok pemilik 2026-08-07 sebagai **opsi (b)** — beri
-- jawabannya lewat fungsi `private.*` SECURITY DEFINER, JANGAN lebarkan
-- `services_select`/`clients_select` ke divisi eksekusi. Migrasi ini tunduk
-- pada ketokan itu dan tidak membuka satu policy pun.
--
-- `employees` sama masalahnya dan sudah punya pintunya:
-- `employees_select` = `jwt_can_read_all() OR self OR created_by`, jadi seorang
-- leader TIDAK boleh membaca baris `employees` anggotanya lewat RLS — tapi
-- `private.employee_display_name` (SECURITY DEFINER) sudah ada dan sudah
-- dipakai untuk keperluan yang sama. Ia DIPAKAI ULANG di sini; tidak ada
-- fungsi nama-karyawan kedua yang dibuat.
--
-- Nol tabel, nol prefix, nol mesin, nol event ⇒ gate 146/40/31/69 TETAP.
-- ============================================================================

-- Klien di balik sebuah Service. Sengaja dipisah dari `service_owner_am`: yang
-- itu menjawab "siapa AM-nya", yang ini "klien mana" — dua pertanyaan berbeda
-- atas join yang sama, dan menumpangkannya jadi satu fungsi multi-kolom akan
-- jadi cara ketiga membaca hal yang sama.
CREATE OR REPLACE FUNCTION private.service_client_id(p_service_id text)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS
$$
  SELECT sv.client_id
    FROM public.services sv
   WHERE sv.id = p_service_id
$$;

-- Klien di balik sebuah Brief. Diturunkan dari fungsi di atas supaya "klien
-- mana" punya SATU definisi, pola sama `brief_owner_am` → `service_owner_am`.
CREATE OR REPLACE FUNCTION private.brief_client_id(p_brief_id text)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS
$$
  SELECT private.service_client_id(b.service_id)
    FROM public.briefs b
   WHERE b.id = p_brief_id
$$;

-- Nama toko satu klien. NULL bila klien tidak ada — pemanggil membedakannya
-- lewat keberadaan baris induknya, jadi fungsi ini tidak melempar (aturan yang
-- sama dipegang `service_owner_am`).
CREATE OR REPLACE FUNCTION private.client_toko(p_client_id text)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS
$$
  SELECT c.toko
    FROM public.clients c
   WHERE c.id = p_client_id
$$;

-- Nama toko di balik sebuah Brief — satu pemanggilan untuk read model, tetap
-- satu definisi karena ia hanya merangkai dua fungsi di atas.
CREATE OR REPLACE FUNCTION private.brief_client_toko(p_brief_id text)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS
$$ SELECT private.client_toko(private.brief_client_id(p_brief_id)) $$;

COMMENT ON FUNCTION private.service_client_id(text) IS
  'O52/F-2 — klien di balik satu Service, tanpa membuka `services_select` ke '
  'divisi eksekusi.';
COMMENT ON FUNCTION private.brief_client_id(text) IS
  'O52/F-2 — sama, lewat Brief. Satu definisi "klien mana", bukan dua.';
COMMENT ON FUNCTION private.client_toko(text) IS
  'O52/F-2 — nama toko satu klien. Menggantikan `join clients` di jalur baca '
  'divisi eksekusi, yang membuang barisnya (bukan mengosongkan kolomnya).';
COMMENT ON FUNCTION private.brief_client_toko(text) IS
  'O52/F-2 — nama toko di balik satu Brief; rangkaian dua fungsi di atas.';

REVOKE EXECUTE ON FUNCTION private.service_client_id(text) FROM public;
REVOKE EXECUTE ON FUNCTION private.service_client_id(text) FROM anon;
GRANT  EXECUTE ON FUNCTION private.service_client_id(text) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION private.brief_client_id(text) FROM public;
REVOKE EXECUTE ON FUNCTION private.brief_client_id(text) FROM anon;
GRANT  EXECUTE ON FUNCTION private.brief_client_id(text) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION private.client_toko(text) FROM public;
REVOKE EXECUTE ON FUNCTION private.client_toko(text) FROM anon;
GRANT  EXECUTE ON FUNCTION private.client_toko(text) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION private.brief_client_toko(text) FROM public;
REVOKE EXECUTE ON FUNCTION private.brief_client_toko(text) FROM anon;
GRANT  EXECUTE ON FUNCTION private.brief_client_toko(text) TO authenticated, service_role;
