-- ============================================================================
-- Picker KARYAWAN untuk setiap pintu penugasan (M6 §3 penunjukan AM, M6 §5 PIC
-- Brief per divisi, M12 §5.3 PIC Task, M7 §2 PIC Asset, M9 §3 Coordinator).
--
-- MASALAH LAPANGAN (arahan pemilik 2026-08-04): semua pintu itu meminta
-- EMPLOYEE ID diketik dari hafalan — `/account` bahkan memakai `window.prompt`
-- ("Employee ID Account Manager untuk klien X"). Tidak ada seorang pun hafal
-- `EMP-...` rekan satu divisinya, apalagi rekan divisi lain: yang sebenarnya
-- terjadi adalah salah ketik (ditolak server dengan pesan BI yang benar tapi
-- tanpa petunjuk siapa yang valid) atau field-nya dilewati. Ini kelas kerusakan
-- yang sama persis dengan picker campaign (20260804061500): kolom penugasan
-- kosong bukan karena tidak ada yang mengerjakannya, tapi karena tidak ada yang
-- bisa MENEMUKAN orangnya.
--
-- KENAPA BUKAN LEWAT `GET /admin/employees` YANG SUDAH ADA:
-- `admin.canReadAdmin` = Director ∨ OD saja, dan di bawahnya policy
-- `employees_select` (20260723064438) hanya membuka baris SENDIRI untuk seorang
-- karyawan biasa. Seorang SPV/Head Account — yang justru satu-satunya orang
-- yang boleh menunjuk AM (M6 §3 Rule 2) — karena itu membaca SATU baris:
-- dirinya. Dropdown-nya mustahil lewat endpoint yang ada.
--
-- KEPUTUSAN (docs/DECISIONS.md 2026-08-04): tabel `employees` TIDAK dilebarkan;
-- yang dibuka hanya JAWABANNYA lewat SECURITY DEFINER di schema `private` —
-- pola yang sama persis dengan `private.sm_allowed_transitions`
-- (20260803120000) dan `private.campaign_selectable` (20260804061500).
--
-- Mengapa bukan pelebaran `employees_select` (ditolak): itu melebarkan row-scope
-- TABEL untuk semua pembaca, sedangkan yang butuh hanya picker. Fungsi ini
-- mengembalikan JAUH lebih sedikit daripada barisnya: identitas + jabatan +
-- role hasil mapping — TANPA `email`, TANPA `flagged_for_review`, TANPA
-- `synced_at`, TANPA baris nonaktif. Arah dua migrasi hardening terakhir
-- (20260727072443, 20260803120000) adalah MENGECILKAN permukaan `public` yang
-- terekspos PostgREST; `private` tidak terekspos.
--
-- PREDIKATNYA SENGAJA IDENTIK DENGAN VALIDATOR-NYA. Kelima pintu penugasan
-- memakai satu bentuk validasi yang sama (`account.validateAMCandidate`,
-- `task.validatePicForDivision`, `creative.validateCreativeStaff`,
-- `kol.validateKolStaff`, `campaign.validateOwnerCandidate`):
--
--     status_aktif AND rm.division = <divisi tujuan> AND rm.level = 'staff'
--
-- jadi fungsi ini INNER JOIN `role_mappings` (karyawan tanpa mapping tidak
-- pernah bisa ditugaskan — `rm.division` NULL gagal di setiap validator) dan
-- menyaring `status_aktif`. Yang DITAWARKAN karena itu tepat sama dengan yang
-- DITERIMA; kalau salah satu sisi bergeser, `directory.test.ts` merah. Picker
-- yang menawarkan orang yang lalu ditolak server adalah cara paling cepat
-- membuat orang berhenti mempercayai dropdown-nya.
--
-- `level` dikembalikan APA ADANYA (staff maupun lead) dan penyaringannya
-- dilakukan pemanggil: yang menentukan level mana yang sah adalah pintunya
-- (semua pintu penugasan hari ini = 'staff'), bukan direktorinya. `level` di
-- sini dibaca dari `role_mappings`, BUKAN dari klaim JWT — layered role
-- (`employee_layered_roles`) bisa menaikkan staff menjadi lead di klaim, tapi
-- para validator membaca `rm.level`, jadi direktori harus membaca yang sama.
-- ============================================================================

-- Idempoten + mandiri: `private` sudah lahir di 20260727072443, tapi guard ini
-- membuat berkas aman di-apply ulang dan di-rebuild dari nol.
CREATE SCHEMA IF NOT EXISTS private;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

-- Karyawan yang boleh ditugaskan, per divisi CDPS hasil mapping. Urutan dipatok
-- DI DALAM fungsi (bukan diserahkan ke pemanggil) supaya dropdown selalu tampil
-- sama: divisi, lalu level, lalu nama.
--
-- `collate "C"` load-bearing, alasan sama seperti `campaign_selectable`: nama
-- karyawan adalah teks bebas dari impor CSV HRIS. Kolasi glibc mengurutkannya
-- bergantung locale cluster; `C` menyamakan urutan Postgres dengan
-- `Array.prototype.sort` di sisi klien, jadi daftar yang difilter di FE tidak
-- pernah "melompat" relatif ke daftar server.
--
-- STABLE + SECURITY DEFINER: satu SELECT, nol tulis. Tidak ada parameter, jadi
-- tidak ada permukaan injeksi; `search_path` tetap dipatok (pola 20260727072443).
CREATE OR REPLACE FUNCTION private.employee_assignable()
RETURNS TABLE (
  employee_id text,
  nama        text,
  divisi      text,   -- jabatan/divisi HRIS mentah: label, BUKAN scope
  jabatan     text,
  division    text,   -- divisi CDPS hasil role_mappings — INI yang men-scope
  level       text    -- staff | lead, dari role_mappings (bukan klaim JWT)
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS
$$
  SELECT e.employee_id::text, e.nama::text, e.divisi::text, e.jabatan::text,
         rm.division::text, rm.level::text
    FROM public.employees e
    JOIN public.role_mappings rm
      ON rm.divisi = e.divisi AND rm.jabatan = e.jabatan
   WHERE e.status_aktif
   ORDER BY rm.division::text COLLATE "C",
            -- staff lebih dulu: itu level yang setiap pintu penugasan terima.
            (rm.level <> 'staff'),
            e.nama::text COLLATE "C",
            e.employee_id::text COLLATE "C"
$$;

-- Permukaan EXECUTE: `authenticated` WAJIB bisa (itu jalur baca picker-nya, dan
-- gate siapa yang boleh memanggilnya ada di `directory.canReadDirectory`),
-- `service_role` untuk jalur privileged/batch. `public`/`anon` dicabut — belum
-- login tidak punya urusan dengan daftar karyawan.
REVOKE EXECUTE ON FUNCTION private.employee_assignable() FROM public;
REVOKE EXECUTE ON FUNCTION private.employee_assignable() FROM anon;
GRANT EXECUTE ON FUNCTION private.employee_assignable() TO authenticated, service_role;
