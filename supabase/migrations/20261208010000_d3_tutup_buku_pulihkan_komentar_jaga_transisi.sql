-- =============================================================================
-- A2-DRIFT (docs/DECISIONS.md, terbuka sejak 2026-09-08) — back-port migrasi
-- yang sudah hidup di live `CDPS SG` tanpa berkas git yang cocok.
--
-- Live menyimpan `supabase_migrations.schema_migrations` versi
-- `20260908084905`, nama `d3_tutup_buku_pulihkan_komentar_jaga_transisi`,
-- diterapkan lewat `apply_migration` (bukan berkas repo) oleh jalur D-3 yang
-- berjalan paralel. Baris `A2-DRIFT` di `docs/DECISIONS.md` mencatatnya "belum
-- dibaca" saat ditemukan; isinya sekarang sudah dibaca langsung dari live
-- (`execute_sql` atas `schema_migrations.statements`) sebagai bagian dari
-- audit ini — TIDAK diasumsikan dari nama.
--
-- **Temuan setelah membaca**: isi statement live, disalin apa adanya di
-- bawah, ternyata BYTE-IDENTIK dengan badan fungsi yang `main` sudah punya
-- lewat `20260925020000_d3_tutup_buku.sql` (diverifikasi `diff`, bukan
-- diasumsikan) — komentar pembuka migrasi live sendiri ("komentar DI DALAM
-- badan fungsi ikut terpangkas") menjelaskan KENAPA migrasi itu pernah perlu
-- diterapkan, tapi state `main` HARI INI sudah membawa komentar yang sama.
-- Jadi `CREATE OR REPLACE` di bawah adalah no-op fungsional terhadap skema
-- `main` yang berjalan — nol perubahan perilaku, nol perubahan `prosrc`.
--
-- Berkas ini tetap ditambahkan, dengan SLUG yang disamakan persis ke nama
-- live (`d3_tutup_buku_pulihkan_komentar_jaga_transisi`, bukan prefix
-- versinya — `scripts/check-live-drift.sh` mencocokkan PER-SLUG, lucuti satu
-- prefix numerik dari kedua sisi, O65): tanpa berkas bernama persis ini, baris
-- ledger live itu akan TERUS muncul sebagai "EXTRA ON LIVE" tak-cocok di
-- setiap audit drift berikutnya walau isinya sudah tidak berbeda — closure
-- A2-DRIFT butuh RIWAYAT git yang cocok nama, bukan cuma skema yang sudah
-- konvergen. Prefix versi berkas ini SENGAJA tidak disalin dari versi live
-- (`20260908084905`, lebih awal dari `20260925020000`) — dipilih di akhir
-- urutan file (sesudah migrasi terbaru saat ini) supaya, kalau suatu hari
-- `20260925020000` disunting ulang, berkas ini tetap penulis TERAKHIR
-- `jaga_transisi_book_period()` saat `db-rebuild.sh` mengurut ulang per nama
-- berkas — bukan urutan apply sungguhan.
-- =============================================================================
CREATE OR REPLACE FUNCTION jaga_transisi_book_period() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_ditutup_pada    timestamptz;
    v_dibekukan_pada  timestamptz;
BEGIN
    IF OLD.status = '[Terbuka]' AND NEW.status = '[Tertutup]' THEN
        SELECT ditutup_pada INTO v_dibekukan_pada
          FROM book_period_snapshots
         WHERE periode = NEW.periode AND versi = NEW.versi_terakhir;

        IF v_dibekukan_pada IS NULL THEN
            RAISE EXCEPTION '[angka bulan % belum dibekukan, buku tidak bisa ditutup]',
                bulan_indonesia(NEW.periode) USING ERRCODE = 'check_violation';
        END IF;

        -- Bulan yang PERNAH dibuka harus dibekukan LAGI sebelum ditutup lagi.
        -- Tanpa syarat ini, tutup-ulang boleh menunjuk kembali ke angka versi
        -- lama — dan konsekuensi ketiga dari ketokan buka-ulang ("tutup-ulang
        -- membekukan angka BARU, dan selisih antar versi harus bisa
        -- ditampilkan") jadi sekadar kebiasaan lapisan TypeScript. Yang
        -- dibandingkan waktunya, bukan nomor versinya: nomor bisa dinaikkan
        -- tanpa menghitung apa pun, sementara `ditutup_pada` yang lebih baru
        -- dari `dibuka_pada` hanya bisa dihasilkan oleh pembekuan yang benar-
        -- benar terjadi SESUDAH bulan itu dibuka.
        IF NEW.dibuka_pada IS NOT NULL AND v_dibekukan_pada <= NEW.dibuka_pada THEN
            RAISE EXCEPTION '[angka bulan % belum dihitung ulang sejak dibuka, buku tidak bisa ditutup lagi]',
                bulan_indonesia(NEW.periode) USING ERRCODE = 'check_violation';
        END IF;
    END IF;

    IF OLD.status = '[Tertutup]' AND NEW.status = '[Terbuka]' THEN
        IF NEW.dibuka_pada IS NULL OR NEW.dibuka_oleh IS NULL
           OR btrim(coalesce(NEW.alasan_buka, '')) = '' THEN
            RAISE EXCEPTION '[alasan buka-ulang wajib diisi]'
                USING ERRCODE = 'check_violation';
        END IF;

        SELECT ditutup_pada INTO v_ditutup_pada
          FROM book_period_snapshots
         WHERE periode = NEW.periode AND versi = NEW.versi_terakhir;

        IF v_ditutup_pada IS NOT NULL AND NEW.dibuka_pada < v_ditutup_pada THEN
            RAISE EXCEPTION '[alasan buka-ulang ini milik penutupan sebelumnya, isi alasan yang baru]'
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;
