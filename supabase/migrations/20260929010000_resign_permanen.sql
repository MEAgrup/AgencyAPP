-- ===========================================================================
-- Resign permanen — `employees.resigned_at` / `resigned_by`
-- ===========================================================================
--
-- KENAPA INI ADA. Permintaan pemilik: "ada menu untuk team hr / od untuk
-- mutasi, hapus akses ( resign ) ini permanent."
--
-- Mutasi sudah ada sejak `admin.updateEmployeeAssignment` (DECISIONS
-- 2026-08-10). Yang belum ada adalah pencabutan akses, dan bentuknya SUDAH
-- diketok pemilik: **cabut akses, baris tetap** (tanpa jalur undo di UI),
-- sekalian menyodorkan daftar serah-terima.
--
-- ── Kenapa BUKAN `DELETE FROM employees` ───────────────────────────────────
--
-- Baris karyawan dirujuk `clients.sales_pic_id`, `clients.assigned_am_id`,
-- `clients.commission_payment_pic_id`, `client_sales_allocations`,
-- `briefs.assigned_pic`, dan setiap baris `audit_log.actor_employee_id` yang
-- pernah ia tulis. Rumah aturan #3 melarang jalur hapus atas riwayat, dan
-- `sessions` memegang FK sungguhan ke tabel ini. "Permanen" karena itu
-- berbentuk STATUS TERMINAL yang tidak bisa dibatalkan, bukan penghapusan
-- baris.
--
-- ── Kenapa kolom TERSENDIRI, bukan cukup `status_aktif = false` ────────────
--
-- Ini bagian yang paling penting, dan ia bukan kehati-hatian teoretis:
-- `syncEmployees` (`packages/domain/src/employees.ts`) meng-upsert
-- `status_aktif = excluded.status_aktif`, lalu cabang
-- `else if (priorActive === false)` memanggil `set_employee_banned(id, false)`
-- dan mengaudit `hris_sync:reactivated`. Artinya SATU impor CSV yang masih
-- menyebut orang itu aktif akan MEMBATALKAN resign permanen — diam-diam,
-- tanpa galat, dan orangnya bisa login lagi.
--
-- `resigned_at` adalah penanda yang sinkron WAJIB hormati. Ia sengaja bukan
-- turunan `status_aktif`: "non-aktif menurut HRIS" (bisa berbalik) dan
-- "sudah resign" (tidak bisa) adalah dua fakta berbeda, dan menyatukannya ke
-- satu boolean adalah persis cara kehilangan yang kedua.
--
-- ── Kenapa nullable, dan kenapa tanpa DEFAULT ──────────────────────────────
--
-- NULL berarti satu hal yang tepat: "belum pernah resign". Tidak ada baris
-- lama yang perlu ditebak, jadi tidak ada backfill sama sekali.
--
-- Gate berhitung TIDAK bergerak: ini kolom, bukan tabel (155/43/34/73).
-- ===========================================================================

ALTER TABLE employees
    ADD COLUMN resigned_at timestamptz NULL,
    ADD COLUMN resigned_by varchar(64) NULL;

-- Keduanya terisi bersama atau tidak sama sekali — separuh terisi berarti
-- "sudah resign tapi tidak diketahui oleh siapa", yang tidak boleh bisa
-- ditulis oleh jalur mana pun, termasuk SQL mentah.
ALTER TABLE employees
    ADD CONSTRAINT ck_employees_resign_lengkap CHECK (
        (resigned_at IS NULL AND resigned_by IS NULL)
     OR (resigned_at IS NOT NULL AND resigned_by IS NOT NULL));

-- Orang yang sudah resign TIDAK BOLEH aktif. Ditegakkan di DB, bukan hanya di
-- `resignEmployee`: sinkron HRIS menulis `status_aktif` lewat jalurnya sendiri,
-- dan penjaga TS di satu pintu tidak mengikat pintu yang lain.
ALTER TABLE employees
    ADD CONSTRAINT ck_employees_resign_nonaktif CHECK (
        resigned_at IS NULL OR status_aktif = false);

CREATE INDEX idx_employees_resigned ON employees (resigned_at)
    WHERE resigned_at IS NOT NULL;

COMMENT ON COLUMN employees.resigned_at IS
  'Resign PERMANEN (ketokan pemilik 2026-09-10). NULL = belum pernah resign. '
  'Sekali terisi ia tidak pernah dikosongkan: tidak ada jalur undo di UI, dan '
  '`syncEmployees` WAJIB mempertahankan status_aktif=false untuk baris ini '
  'alih-alih mengaktifkannya kembali. Baris karyawan sengaja DIPERTAHANKAN '
  '(rumah aturan #3) supaya atribusi riwayat tetap terbaca.';
COMMENT ON COLUMN employees.resigned_by IS
  'Aktor yang mengeksekusi resign (Director atau Lead divisi HR — gerbang '
  '`admin.canManageEmployeeAssignment`, gerbang yang sama dengan mutasi).';

-- ===========================================================================
-- Jebakan kedua: resign menghapus sales dari Kinerja Sales
-- ===========================================================================
--
-- `salesperf.loadRoster` membaca `private.employee_assignable()`, yang
-- memfilter `WHERE e.status_aktif` (`20260805030000_employee_picker.sql`).
-- Itu BENAR untuk picker penugasan — orang yang sudah keluar tidak boleh bisa
-- dipilih lagi. Tapi Kinerja Sales memakai fungsi yang sama sebagai ROSTER,
-- dan konsekuensinya: mem-resign seorang sales membuat barisnya — beserta
-- SELURUH omzet dan komisi historisnya — lenyap dari dashboard, diam-diam,
-- tanpa galat. Angka bulan lalu berubah karena keputusan HR hari ini.
--
-- Fungsi BARU, bukan parameter pada yang lama. Menambah argumen
-- `include_inactive` ke `employee_assignable()` berarti setiap pemanggil
-- (setiap dropdown penugasan di sistem) tiba-tiba punya cara untuk memilih
-- orang non-aktif, dan satu default yang salah di satu call-site cukup untuk
-- menugaskan pekerjaan ke orang yang sudah keluar. Dua fungsi dengan dua nama
-- yang jujur lebih aman daripada satu fungsi dengan satu flag.
--
-- Tanpa `ORDER BY`: pemanggilnya (`loadRoster`) memetakan hasilnya ke Map dan
-- tidak pernah menampilkan urutan ini, jadi mengunci kolasi di sini hanya akan
-- menyalin alasan yang tidak berlaku. Picker tetap punya urutannya sendiri.
CREATE OR REPLACE FUNCTION private.employee_roster()
RETURNS TABLE (
  employee_id text,
  nama        text,
  divisi      text,   -- HRIS mentah: label, BUKAN scope
  jabatan     text,
  division    text,   -- divisi CDPS hasil role_mappings
  level       text,   -- staff | lead
  status_aktif boolean,
  resigned_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS
$$
  SELECT e.employee_id::text, e.nama::text, e.divisi::text, e.jabatan::text,
         rm.division::text, rm.level::text, e.status_aktif, e.resigned_at
    FROM public.employees e
    JOIN public.role_mappings rm
      ON rm.divisi = e.divisi AND rm.jabatan = e.jabatan
$$;

COMMENT ON FUNCTION private.employee_roster() IS
  'Roster HISTORIS: setiap karyawan ber-posisi terpetakan, aktif MAUPUN tidak. '
  'Dipakai laporan yang harus tetap memuat orang yang sudah keluar (Kinerja '
  'Sales, Laporan Penjualan). BUKAN untuk picker penugasan — itu tetap '
  'private.employee_assignable(), yang memfilter status_aktif.';

-- Permukaan EXECUTE sama seperti `employee_assignable()`: `authenticated`
-- memanggilnya lewat jalur baca yang gate-nya sudah ada di domain
-- (`salesperf.scopeFor`), `service_role` untuk jalur privileged.
REVOKE EXECUTE ON FUNCTION private.employee_roster() FROM public;
REVOKE EXECUTE ON FUNCTION private.employee_roster() FROM anon;
GRANT EXECUTE ON FUNCTION private.employee_roster() TO authenticated, service_role;

-- ===========================================================================
-- Jebakan ketiga: Lead HR boleh MENULIS mutasi tapi tidak boleh MEMBACA roster
-- ===========================================================================
--
-- Ini bukan konsekuensi resign; ia sudah ada sejak lengan HR dibuat
-- (DECISIONS 2026-08-10) dan resign hanya membuatnya tidak bisa diabaikan
-- lagi. Keadaan sebelum migrasi ini:
--
--   * `admin.canManageEmployeeAssignment` MENGIZINKAN Lead HR memutasi;
--   * `admin.canReadAdmin` MENOLAK-nya membaca daftar karyawan;
--   * `employees_select` (rls_baseline §5) berbunyi
--     `jwt_can_read_all() OR employee_id = jwt_employee_id() OR created_by =
--     jwt_employee_id()` — jadi bahkan kalau gerbang route dibuka, Lead HR
--     hanya membaca BARIS DIRINYA SENDIRI;
--   * sumber tabel di halaman Karyawan, `GET /auth/admin/credentials`,
--     mempersempit seorang Lead ke divisi terpetakannya sendiri — jadi Lead HR
--     melihat staff HR saja.
--
-- Hasilnya: satu-satunya peran yang lengan mutasi itu dibuat untuk melayani
-- tidak pernah bisa menemukan orang yang mau ia mutasi. Otoritas menulis yang
-- tidak bisa membaca subjeknya bukan fitur.
--
-- Lengan ini SENGAJA seluruh tabel, bukan per-divisi seperti lengan Sales/
-- Account: HR memang mengelola roster SEMUA divisi — itu definisi pekerjaannya,
-- bukan pelebaran yang kebetulan berguna. Arahnya tetap read-only; nol write
-- policy ditambahkan, dan penulisan tetap lewat jalur privileged yang gerbangnya
-- ada di domain.
--
-- Yang TIDAK dilebarkan, dinyatakan eksplisit supaya tidak terbaca sebagai
-- kelalaian: `auth.canManagePasswords` / `adminMayManage` tidak disentuh. HR
-- membaca roster, HR TIDAK me-reset password siapa pun di luar divisinya —
-- karena itu eskalasi hak lewat pengambilalihan password, persis yang
-- `adminMayManage` sudah tolak untuk setiap Lead lain.
DROP POLICY IF EXISTS employees_select ON public.employees;
CREATE POLICY employees_select ON public.employees FOR SELECT TO authenticated
USING (jwt_can_read_all()
       OR employee_id = jwt_employee_id()
       OR created_by = jwt_employee_id()
       OR (jwt_is_lead() AND jwt_division() = 'HR'));

COMMENT ON POLICY employees_select ON public.employees IS
  'Baseline (rls_baseline §5) + lengan Lead HR (2026-09-10): HR mengelola roster '
  'SEMUA divisi, jadi lengannya seluruh tabel dan bukan per-divisi. Cermin '
  'admin.canReadAdmin / admin.canManageEmployeeAssignment. Read-only — nol write '
  'policy; mutasi & resign tetap lewat jalur privileged ber-gerbang domain.';
