-- ===========================================================================
-- Master Service List — arsip yang benar-benar mengarsip, dan hapus yang
-- menolak meninggalkan pointer menggantung
-- ===========================================================================
--
-- KENAPA INI ADA. Permintaan pemilik 2026-09-10: *"Fitur untuk menghapus
-- Master Service List yang salah."*
--
-- Tapi menelusuri permintaan itu membuka sesuatu yang lebih besar, dan yang
-- lebih dulu harus ditutup:
--
-- ── Bug laten: `active` hari ini KOSMETIK ──────────────────────────────────
--
-- `master_service_versions.active` sudah ada sejak `init.sql` dan sudah punya
-- checkbox + badge "Nonaktif" di layar MSL. Tapi TIDAK ADA satu pun pembaca
-- yang menghormatinya: `msl.effectiveAt` dan `msl.listEffectiveAt` sama-sama
-- hanya memfilter `effective_from <= date`. Artinya **layanan yang sudah
-- ditandai Nonaktif masih bisa dijual hari ini** — Sales Head menandainya,
-- badge-nya berubah, dan tidak ada apa pun yang berubah pada perilaku.
--
-- Itu kelas kegagalan yang paling mahal: penjaga yang TERLIHAT ada. Seseorang
-- menonaktifkan layanan yang salah harga, percaya ia sudah ditarik, dan deal
-- berikutnya tetap ditutup dengan harga itu.
--
-- Perbaikannya ada di TS (`msl.sellableAt` / `listSellableAt` — pembaca BARU,
-- bukan flag pada yang lama; alasan yang sama dengan `employee_roster()` vs
-- `employee_assignable()` pada 2026-09-10). Migrasi ini menyumbang komentar
-- kolomnya, penjaga hapusnya, dan — lihat §1 — alasan kenapa ia justru TIDAK
-- menambah indeks.
--
-- ── Kenapa HAPUS butuh penjaga di DB, bukan cuma di TS ─────────────────────
--
-- `master_service_id` **tidak punya FOREIGN KEY di mana pun**. Keempat tabel
-- yang menyimpannya — `services`, `qualified_form_services`,
-- `negotiation_proposal_lines`, `renewal_proposal_lines` — mendeklarasikannya
-- `varchar(32)` biasa. Konsekuensinya persis: `DELETE FROM master_services`
-- **tidak akan ditolak Postgres**, tidak memberi galat, dan hanya meninggalkan
-- pointer menggantung di baris uang yang sudah ditutup. Sebuah Service di
-- Client Record akan menunjuk katalog yang tidak ada lagi, dan `loadApprovedLines`
-- akan mengisi namanya dengan `''`.
--
-- Menambahkan empat FK sungguhan BUKAN jalan keluarnya di sini: keempat kolom
-- itu adalah SNAPSHOT (id katalog pada saat deal ditutup), dan sebuah FK akan
-- mengubah artinya menjadi "referensi hidup" — yang justru bertabrakan dengan
-- rumah aturan #3, karena ia lalu memaksa `ON DELETE` punya jawaban untuk
-- riwayat yang tidak boleh berubah.
--
-- Jadi penjaganya ditulis sebagai trigger BEFORE DELETE: hapus DIIZINKAN hanya
-- untuk katalog yang **belum pernah dipakai apa pun**. Yang pernah dipakai
-- tidak bisa dihapus sama sekali — ia diarsipkan. Itu juga yang membuat fitur
-- ini kompatibel dengan rumah aturan #3 alih-alih menabraknya: baris yang
-- pernah melahirkan uang tidak punya jalur hapus, dan yang tidak pernah
-- melahirkan apa pun tidak punya riwayat untuk dilindungi.
--
-- Gate berhitung TIDAK bergerak: nol tabel, nol prefix, nol mesin, nol event.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1) `active` berhenti kosmetik — dan CATATAN kenapa tidak ada indeks baru
-- ---------------------------------------------------------------------------
--
-- Godaan pertama adalah menambahkan indeks parsial `WHERE active` dan menulis
-- pembaca "boleh dijual" sebagai `... WHERE active ORDER BY effective_from
-- DESC LIMIT 1`. **Itu bug, bukan optimasi**, dan bentuknya halus:
--
-- Misalkan v1 aktif (Rp 10jt), lalu v2 lahir menonaktifkan layanan itu. Sebuah
-- kueri ber-`WHERE active` tidak menemukan v2, jadi ia jatuh ke **v1 — dan
-- menjual layanan itu pada harga lama**. Mengarsipkan sesuatu akan diam-diam
-- MENGHIDUPKAN kembali versi sebelumnya. Penjaganya berubah jadi mesin waktu.
--
-- Karena itu semantik yang benar adalah: ambil baris yang PERSIS SAMA dengan
-- yang `effectiveAt` ambil (versi terbaru yang `effective_from <= date`), lalu
-- TOLAK kalau baris itu nonaktif. "Nonaktif" adalah fakta tentang versi yang
-- berlaku, bukan filter untuk mencari versi lain.
--
-- Konsekuensinya `idx_service_effective (service_id, effective_from)` yang
-- sudah ada tetap indeks yang tepat, dan migrasi ini **sengaja tidak menambah
-- indeks apa pun**. Kolomnya hanya mendapat komentar, supaya pembaca berikutnya
-- tidak mengulangi godaan yang sama.
COMMENT ON COLUMN master_service_versions.active IS
  'Boleh DIJUAL atau tidak. Sebelum 2026-09-10 kolom ini KOSMETIK: ada checkbox & '
  'badge "Nonaktif" di layar MSL tapi nol pembaca yang menghormatinya, sehingga '
  'layanan yang sudah ditandai nonaktif tetap terjual pada harga itu. Sekarang '
  '`msl.sellableAt`/`listSellableAt` menegakkannya di jalur JUAL, sementara '
  '`effectiveAt`/`listVersions` sengaja TETAP mengabaikannya — pengayaan deal yang '
  'sudah disetujui tidak boleh gagal pada hari seseorang merapikan katalog. '
  'JANGAN menulis pembacanya sebagai `WHERE active ... LIMIT 1`: itu akan jatuh ke '
  'versi AKTIF sebelumnya dan menjual pada harga lama. Ambil versi yang berlaku, '
  'lalu tolak bila ia nonaktif.';

-- ---------------------------------------------------------------------------
-- 2) Penjaga hapus — hitung pemakaian di keempat tabel snapshot
-- ---------------------------------------------------------------------------
--
-- Dipakai DUA kali dan itu memang tujuannya: trigger di bawah memanggilnya
-- sebagai penegak, dan `msl.serviceRefs` memanggilnya untuk MENJELASKAN
-- penolakan kepada orangnya ("dipakai 3 Service, 1 Qualified Form"). Satu
-- definisi, dua pembaca — kalau tabel snapshot kelima lahir kelak, ia
-- ditambahkan di SINI dan kedua pembaca ikut benar.
CREATE OR REPLACE FUNCTION private.master_service_refs(p_service_id text)
RETURNS TABLE (
  services            bigint,
  qualified_forms     bigint,
  negotiation_lines   bigint,
  renewal_lines       bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS
$$
  SELECT (SELECT count(*) FROM public.services                  WHERE master_service_id = p_service_id),
         (SELECT count(*) FROM public.qualified_form_services    WHERE master_service_id = p_service_id),
         (SELECT count(*) FROM public.negotiation_proposal_lines WHERE master_service_id = p_service_id),
         (SELECT count(*) FROM public.renewal_proposal_lines     WHERE master_service_id = p_service_id)
$$;

COMMENT ON FUNCTION private.master_service_refs(text) IS
  'Berapa kali satu id katalog muncul di keempat tabel SNAPSHOT yang menyimpannya '
  'tanpa FK (services, qualified_form_services, negotiation_proposal_lines, '
  'renewal_proposal_lines). Nol di keempatnya = katalog itu belum pernah dipakai '
  'apa pun dan boleh dihapus. Dipakai trigger trg_master_services_hapus_terjaga '
  'DAN msl.serviceRefs — satu definisi supaya penegak dan penjelasnya tidak '
  'pernah berbeda pendapat.';

REVOKE EXECUTE ON FUNCTION private.master_service_refs(text) FROM public;
REVOKE EXECUTE ON FUNCTION private.master_service_refs(text) FROM anon;
GRANT EXECUTE ON FUNCTION private.master_service_refs(text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3) Trigger BEFORE DELETE — penegaknya
-- ---------------------------------------------------------------------------
--
-- Kenapa trigger dan bukan cuma pemeriksaan di `msl.deleteService`: route MSL
-- bukan satu-satunya penulis DB ini. Seeder, migrasi, dan setiap sesi `psql`
-- operator memegang jalur yang tidak lewat TS sama sekali, dan penjaga yang
-- hanya ada di satu pintu bukan penjaga. Pemeriksaan TS TETAP ada — ia yang
-- memberi pesan BI ber-angka; trigger ini yang memastikan pesan itu tidak bisa
-- dilewati.
--
-- Pesannya menyebut ANGKA per tabel, bukan cuma "masih dipakai": seorang Sales
-- Head yang ditolak butuh tahu di mana ia dipakai untuk memutuskan apakah
-- arsip sudah cukup.
CREATE OR REPLACE FUNCTION public.guard_master_service_hapus()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE r record;
BEGIN
    SELECT * INTO r FROM private.master_service_refs(OLD.id);
    IF r.services + r.qualified_forms + r.negotiation_lines + r.renewal_lines > 0 THEN
        RAISE EXCEPTION
          '[layanan ini sudah dipakai (% Service, % Qualified Form, % baris proposal, % baris perpanjangan) — tidak bisa dihapus, arsipkan saja]',
          r.services, r.qualified_forms, r.negotiation_lines, r.renewal_lines
          USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.guard_master_service_hapus() FROM public;
REVOKE EXECUTE ON FUNCTION public.guard_master_service_hapus() FROM anon;
REVOKE EXECUTE ON FUNCTION public.guard_master_service_hapus() FROM authenticated;

DROP TRIGGER IF EXISTS trg_master_services_hapus_terjaga ON public.master_services;
CREATE TRIGGER trg_master_services_hapus_terjaga
    BEFORE DELETE ON public.master_services
    FOR EACH ROW EXECUTE FUNCTION public.guard_master_service_hapus();

COMMENT ON FUNCTION public.guard_master_service_hapus() IS
  'Menolak DELETE atas master_services yang id-nya masih muncul di salah satu dari '
  'empat tabel snapshot. Ia ada karena `master_service_id` TIDAK punya FK di mana '
  'pun, jadi tanpa trigger ini Postgres menerima hapusnya tanpa galat dan hanya '
  'meninggalkan pointer menggantung di baris uang yang sudah ditutup. Sengaja BUKAN '
  'empat FK: keempat kolom itu snapshot, dan FK akan mengubah artinya jadi referensi '
  'hidup.';
