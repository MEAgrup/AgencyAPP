-- ============================================================================
-- PERBAIKAN O46 — kedua helper `private.jwt_*_division*` membandingkan kosakata
-- yang SALAH, sehingga arm "Lead/SPV = division-wide" **tidak pernah menyala**.
--
-- Ditemukan 2026-07-30 oleh probe terhadap live `CDPS SG` (bukan oleh test —
-- lihat §"kenapa test lokal hijau" di bawah, itu bagian terpenting entri ini).
--
-- ----------------------------------------------------------------------------
-- CACATNYA
--
-- `20260730091540` menulis:
--
--     WHERE e.divisi = public.jwt_division()
--
-- Tapi `employees.divisi` menyimpan **departemen HRIS** dan `jwt_division()`
-- mengembalikan **divisi CDPS**. Keduanya kosakata berbeda yang dijembatani
-- `role_mappings`. Bukti dari live:
--
--     employee_id   employees.divisi   klaim division   cocok
--     2101180004    SALES              Sales            false
--     2305100275    ACCOUNT            Account          false
--     2412230480    CREATIVE           Creative         false
--
-- Jadi `EXISTS(...)` selalu **false** ⇒ kedua arm mati. Arahnya aman (lebih
-- sempit ⇒ nol kebocoran), tapi fiturnya **tidak berfungsi**: lead tetap tidak
-- melihat data divisinya, persis keadaan yang O46 seharusnya perbaiki.
--
-- ----------------------------------------------------------------------------
-- PERBAIKANNYA: pakai fungsi KANONIK, jangan menurunkan ulang
--
-- `public.employee_claims(employee_id)` adalah fungsi yang **mengisi klaim JWT**
-- (dipanggil `sync_employee_claims` lewat trigger). Ia menurunkan `division`
-- lewat `LEFT JOIN role_mappings rm ON rm.divisi = e.divisi AND rm.jabatan =
-- e.jabatan`. Dengan memakainya, kedua sisi perbandingan berasal dari **satu
-- sumber yang sama**, jadi mereka tidak bisa menyimpang lagi *by construction* —
-- itu poin desainnya, bukan kerapian. Menurunkan ulang lewat `role_mappings`
-- secara manual akan mengulang kesalahan yang sama dalam bentuk lain.
--
-- Ditambahkan juga guard `jwt_division() <> ''`: Director/OD punya `division`
-- **string kosong** di klaimnya, dan tanpa guard ini `'' = ''` akan mencocokkan
-- setiap karyawan yang divisinya juga tak ter-mapping. Mereka sudah lewat
-- `jwt_can_read_all()` sehingga arm ini tak pernah dievaluasi untuk mereka, tapi
-- helper yang benar hanya karena pemanggilnya kebetulan menjaganya bukan helper
-- yang benar.
--
-- ----------------------------------------------------------------------------
-- KENAPA TEST LOKAL HIJAU PADAHAL PRODUKSI MATI — pelajaran yang harus dibawa
--
-- `rls_checks.sql` check 18–23 menyisipkan fixture karyawan dengan
-- `divisi = 'Sales'` — yaitu **divisi CDPS**, bukan bentuk HRIS `'SALES'`.
-- Fixture itu meng-encode asumsi penulisnya, jadi ia mencocokkan `jwt_division()`
-- secara kebetulan dan seluruh 6 check lolos. Test-nya bahkan divalidasi dengan
-- mutasi, dan mutasinya merah — tapi mutasi hanya membuktikan test menjaga
-- **perilaku yang ia asumsikan**, bukan bahwa asumsinya cocok dengan produksi.
--
-- Fixture di check 18–23 karena itu diperbaiki bersama migrasi ini: karyawan
-- disisipkan dengan bentuk **HRIS** (`divisi='SALES', jabatan='SALES JASA'`) plus
-- baris `role_mappings` yang memetakannya ke `Sales`, sehingga test menjalankan
-- jalur resolusi yang sama dengan produksi. Tanpa itu, perbaikan ini pun tidak
-- akan pernah terbukti.
--
-- **Aturan yang lahir dari ini: fixture yang meng-encode asumsi penulis tentang
-- bentuk data produksi bukan bukti.** Kalau sebuah predikat bergantung pada
-- bentuk data riil, fixture-nya wajib memakai bentuk riil itu.
--
-- SIFAT PERUBAHAN: `CREATE OR REPLACE FUNCTION` ×2. Nol perubahan policy, nol
-- tabel, nol kolom, nol event. Arahnya tetap **memperluas baca** — sebelum ini
-- arm-nya mati, jadi tak ada akses yang dicabut oleh migrasi ini.
-- ============================================================================

CREATE OR REPLACE FUNCTION private.jwt_same_division(p_employee_id text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT public.jwt_division() <> ''
     AND public.employee_claims(p_employee_id)->>'division' = public.jwt_division()
$$;

COMMENT ON FUNCTION private.jwt_same_division(text) IS
  'O46 (diperbaiki 2026-07-30): true bila DIVISI CDPS karyawan p_employee_id sama dengan divisi CDPS aktor JWT. Divisi diresolusi lewat public.employee_claims() — fungsi yang sama yang mengisi klaim JWT — supaya kedua sisi tidak bisa menyimpang. Fail-closed pada divisi kosong (Director/OD).';

CREATE OR REPLACE FUNCTION private.jwt_division_owns_client(p_client_id text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT public.jwt_division() <> ''
     AND EXISTS (
    SELECT 1
    FROM public.clients c
    CROSS JOIN LATERAL (VALUES (c.sales_pic_id), (c.assigned_am_id),
                               (c.commission_payment_pic_id), (c.created_by)) AS pic(employee_id)
    WHERE c.id = p_client_id
      AND pic.employee_id IS NOT NULL
      AND public.employee_claims(pic.employee_id)->>'division' = public.jwt_division()
  )
$$;

COMMENT ON FUNCTION private.jwt_division_owns_client(text) IS
  'O46 (diperbaiki 2026-07-30): true bila salah satu dari empat PIC klien ber-DIVISI CDPS sama dengan aktor JWT. Empat kolom PIC-nya sengaja identik dengan private.jwt_owns_client. Divisi diresolusi lewat public.employee_claims(), bukan employees.divisi mentah (itu departemen HRIS).';
