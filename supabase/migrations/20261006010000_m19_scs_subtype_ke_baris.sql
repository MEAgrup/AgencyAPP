-- =============================================================================
-- M19-SCS-SUBTYPE-GRAIN — `sub_type` PINDAH dari `scs_kategori` ke `scs_tasks`.
--
-- KETOKAN PEMILIK 2026-09-11: opsi (a).
--
-- ## Kenapa ia pindah
--
-- Sumbernya (`docs/prd/CDPS_GapAnalysis_LeaderVideo_CreativeDailyOps.md`, Gap B)
-- menyebut Sub Type sebagai FIELD PADA BARIS, bukan atribut taksonomi:
--
--   "Support VideoGrapher (which VG's shoot this supports) and Sub Type both
--    become **optional** on the merged entity"
--
-- dan tabel worked-example-nya berkolom `Task | Client | Kategori | Sub Type |
-- Support VG | Qty` — satu Sub Type per BARIS.
--
-- Sebagaimana terbangun 2026-09-08, ia justru kolom di `scs_kategori`. Itu
-- MEMBATALKAN alasan penggabungan taksonominya sendiri: `Brief`, `Script`, dan
-- `QC` digabung masing-masing jadi SATU Kategori DENGAN ALASAN *"Sub Type
-- carries the distinction where it matters (Brief Feed / Brief Story)"*. Dengan
-- Sub Type menempel di Kategori, satu baris `Brief` tidak bisa `Brief Feed`
-- sementara baris `Brief` lain `Brief Story` — pembedaan yang justru jadi
-- syarat penggabungan itu mustahil dinyatakan.
--
-- Ini instans KETIGA dari satu pertanyaan bentuk yang sama (mana milik baris,
-- mana milik taksonomi), dan jawabannya konsisten dengan dua yang terdahulu:
-- `mendukung_divisi` (ketokan 2026-09-09) juga diselesaikan sebagai kolom
-- BARIS, bukan flag Kategori.
--
-- ## Kenapa SEKARANG, dan kenapa nol backfill
--
-- `scs_tasks` masih **0 baris** di live (`CDPS SG`, diperiksa 2026-09-11) dan
-- `scs_kategori` masih 4 baris seed. Jadi migrasi ini nol backfill dan nol
-- risiko. Setiap baris pekerjaan yang masuk sesudah ini membuatnya lebih mahal.
--
-- ## Empat nilai seed yang DIBUANG, dan itu perbaikan
--
-- Keempat baris seed membawa `sub_type` `'Content'`/`'Operasional'`. KEDUANYA
-- BUKAN anggota delapan label terkunci di sumber (*Brief Feed, Brief Story,
-- Script Video, Content Plan, Caption, Angle Content, Copy SKU, Copy Banner*) —
-- mereka nilai yang dikarang saat dokumen sumbernya belum terbaca. DROP COLUMN
-- membuangnya, dan itu justru hasil yang diinginkan: taksonomi kehilangan dua
-- label palsu, bukan kehilangan data.
--
-- ## Yang TIDAK dikerjakan di sini
--
-- `M19-SCS-SUPPORT-VG` (field `Support VideoGrapher` yang hilang dari skema)
-- adalah baris terbuka TERSENDIRI dan belum diketok. Ia tidak diikutsertakan:
-- menambah kolom yang belum diketok bentuknya adalah persis kesalahan yang
-- sedang diperbaiki migrasi ini.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Kolom baru di BARIS.
--
--    `varchar(64)` NULL, dan tetap TEKS BEBAS — bukan enum tertutup. Alasannya
--    tidak berubah karena pindah tempat: delapan label itu taksonomi operasional
--    yang masih bergerak, dan mengunci mereka di CHECK berarti satu migrasi per
--    koreksi label. Kalau ia kelak stabil, ia naik jadi enum tertutup + baris
--    `DECISIONS.md` — bukan sebaliknya.
--
--    NULL = tidak relevan untuk baris ini, dan itu kasus SAH, bukan data yang
--    hilang: sumbernya menyebutnya *optional*, "populated for script/guide work,
--    left blank for posting-ops work (Upload & Checklist, Weekly/Monthly Report)".
-- -----------------------------------------------------------------------------
ALTER TABLE scs_tasks ADD COLUMN sub_type varchar(64) NULL;

COMMENT ON COLUMN scs_tasks.sub_type IS
  'Label Sub Type PER BARIS (Gap B: "Sub Type ... optional on the merged '
  'entity"). Ia yang membuat satu baris Brief bisa [Brief Feed] sementara '
  'baris Brief lain [Brief Story] — pembedaan yang jadi SYARAT penggabungan '
  'taksonomi Brief/Script/QC. NULL = tidak relevan (posting-ops), bukan data '
  'hilang. SENGAJA teks bebas, bukan enum tertutup: delapan label worksheet '
  'masih bergerak, dan mengunci mereka di CHECK berarti satu migrasi per '
  'koreksi label.';

-- -----------------------------------------------------------------------------
-- 2. Kolom lama di TAKSONOMI dibuang.
--
--    DROP, bukan "ditinggalkan kosong": kolom yang masih ada tapi tidak dipakai
--    adalah sumber kedua untuk satu fakta — persis opsi (c) yang DITOLAK di
--    `DECISIONS.md`. Satu tempat, atau bukan tempat sama sekali.
-- -----------------------------------------------------------------------------
ALTER TABLE scs_kategori DROP COLUMN sub_type;

COMMENT ON TABLE scs_kategori IS
  'M19 §13 / Gap G — taksonomi Kategori baris SCS. Registry ber-baris yang '
  'dikelola lead Creative: taksonomi adalah DATA, bukan skema. is_standing '
  'adalah sifat KATEGORI (pekerjaan berulang harian, dihitung sebagai volume, '
  'Speed Score N/A), dan standing ⇒ sla_jam WAJIB NULL. Sub Type BUKAN sifat '
  'Kategori — ia kolom scs_tasks.sub_type (M19-SCS-SUBTYPE-GRAIN, 2026-09-11).';

-- -----------------------------------------------------------------------------
-- 3. `sub_type` ikut BEKU sesudah baris meninggalkan `[To Do]`.
--
--    Alasannya bukan "konsistensi": Sub Type adalah field yang dipakai
--    MENGELOMPOKKAN laporan (itu seluruh gunanya — memisahkan Brief Feed dari
--    Brief Story sesudah Kategorinya digabung). Mengubahnya pada baris yang
--    sudah `[Approved]` menulis ulang laporan periode yang sudah dibaca orang,
--    tanpa satu pun baris audit yang menjelaskannya.
--
--    Jalur domain memang sudah menolak SEMUA suntingan sesudah `[To Do]`
--    (`updateScsTask`), jadi pagar ini menutup jalur tulis yang MELEWATI
--    domain — alasan yang sama persis dengan lima field beku lainnya.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION scs_tasks_beku()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    IF NEW.id IS DISTINCT FROM OLD.id THEN
        RAISE EXCEPTION 'scs_tasks: id beku';
    END IF;
    IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
        RAISE EXCEPTION 'scs_tasks: created_by beku';
    END IF;
    IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'scs_tasks: created_at beku';
    END IF;
    IF OLD.status <> '[To Do]' THEN
        IF NEW.tanggal IS DISTINCT FROM OLD.tanggal THEN
            RAISE EXCEPTION 'scs_tasks: tanggal beku sesudah baris mulai dikerjakan';
        END IF;
        IF NEW.kategori_kode IS DISTINCT FROM OLD.kategori_kode THEN
            RAISE EXCEPTION 'scs_tasks: kategori_kode beku sesudah baris mulai dikerjakan — ia membawa SLA yang dipakai menghitung Speed Score';
        END IF;
        IF NEW.sub_type IS DISTINCT FROM OLD.sub_type THEN
            RAISE EXCEPTION 'scs_tasks: sub_type beku sesudah baris mulai dikerjakan — ia mengelompokkan laporan yang sudah dibaca';
        END IF;
        IF NEW.assigned_pic IS DISTINCT FROM OLD.assigned_pic THEN
            RAISE EXCEPTION 'scs_tasks: assigned_pic beku sesudah baris mulai dikerjakan';
        END IF;
        IF NEW.target_qty IS DISTINCT FROM OLD.target_qty THEN
            RAISE EXCEPTION 'scs_tasks: target_qty beku sesudah baris mulai dikerjakan';
        END IF;
        IF NEW.client_id IS DISTINCT FROM OLD.client_id THEN
            RAISE EXCEPTION 'scs_tasks: client_id beku sesudah baris mulai dikerjakan';
        END IF;
    END IF;
    IF OLD.status = '[Approved]' AND NEW.link_hasil IS DISTINCT FROM OLD.link_hasil THEN
        RAISE EXCEPTION 'scs_tasks: link_hasil beku sesudah [Approved]';
    END IF;
    IF OLD.status = '[Approved]' AND NEW.status <> OLD.status THEN
        RAISE EXCEPTION 'scs_tasks: [Approved] adalah state terminal';
    END IF;
    RETURN NEW;
END;
$$;
