-- G1-04 · Bucket `pdt-raw` (Pusat Data Toko) — infrastruktur storage PERTAMA
-- di repo ini (P-09 terkonfirmasi, docs/DECISIONS.md 2026-09-12: nol bucket,
-- nol supabase/functions/, nol createSignedUrl sebelum migrasi ini).
-- Lihat docs/prd/CDPS_PDT_Pusat_Data_Toko.md Rule 38-44 dan
-- docs/backlog/PDT_BACKLOG.md G1-04.
--
-- Cakupan: bucket privat + RLS `storage.objects` SAJA. Pagar isi paket
-- (Rule 41-42: ukuran/entri/rasio/zip-slip/enkripsi/ekstensi) sudah
-- ditegakkan di kode SEBELUM upload sampai ke sini
-- (`packages/core/src/pdt/zip-pagar.ts` + `apps/api/src/lib/pdt-zip.ts`) —
-- migrasi ini tidak menduplikasi pagar itu di SQL, hanya `file_size_limit`
-- level-bucket sebagai lapis kedua yang murah (Rule 42 sudah menolak > 50MB
-- lebih dulu di kode, sebelum satu byte pun sampai ke storage).
--
-- ⚠️ SATU-SATUNYA migrasi di repo ini yang menyentuh skema `storage` (bukan
-- `public`). `storage.buckets`/`storage.objects`/`storage.foldername()`
-- disediakan PLATFORM Supabase di proyek live (`CDPS SG`,
-- `egddxfcnrtecheiykhlf`) — bukan lahir dari migrasi kita. Tapi
-- `scripts/db-rebuild.sh` membangun ulang Postgres BARU dari nol (bukan stack
-- Supabase penuh via Docker), jadi skema `storage` TIDAK ADA di sana.
--
-- Blok pertama di bawah menstub bentuknya SUPAYA REBUILD LOKAL TIDAK GAGAL —
-- kolom & definisi `foldername()` dicocokkan PERSIS ke live (diverifikasi
-- lewat `information_schema.columns`/`pg_proc` sebelum menulis migrasi ini).
-- **PENTING (dipelajari lewat percobaan apply ke live):** `CREATE TABLE/SCHEMA
-- IF NOT EXISTS` di Postgres TETAP memeriksa privilese CREATE pada skema
-- target SEBELUM mengecek apakah objeknya sudah ada — jadi menjalankannya
-- begitu saja terhadap live gagal `permission denied for schema storage`
-- (peran migrasi kita bukan pemilik skema `storage`, itu milik peran internal
-- Supabase) WALAUPUN objeknya sudah ada dan seharusnya di-skip. Karena itu
-- setiap CREATE distubkan di sini dijaga oleh CEK KEBERADAAN SENDIRI (query
-- `pg_namespace`/`pg_class`, bukan bergantung ke IF NOT EXISTS bawaan) di
-- dalam blok DO — di live, cek itu selalu bernilai "sudah ada" dan EXECUTE-nya
-- TIDAK PERNAH dijalankan sama sekali, jadi permission dari peran migrasi
-- tidak pernah diuji. Di lokal (skema benar-benar kosong), cek itu bernilai
-- "belum ada" dan EXECUTE berjalan sebagai superuser lokal (`postgres`), yang
-- memang pemilik skema barunya sendiri.
DO $outer$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'storage') THEN
    EXECUTE 'CREATE SCHEMA storage';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'storage' AND c.relname = 'buckets'
  ) THEN
    EXECUTE $sql$
      CREATE TABLE storage.buckets (
          id                 text PRIMARY KEY,
          name               text NOT NULL,
          owner              uuid NULL,
          created_at         timestamptz DEFAULT now(),
          updated_at         timestamptz DEFAULT now(),
          public             boolean DEFAULT false,
          avif_autodetection boolean DEFAULT false,
          file_size_limit    bigint NULL,
          allowed_mime_types text[] NULL,
          owner_id           text NULL
      )
    $sql$;
  END IF;

  -- objects dicek TERPISAH dari buckets: kalau kelak buckets sudah ada tapi
  -- objects belum (tidak terjadi di live, tapi jaga tetap benar per-tabel).
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'storage' AND c.relname = 'objects'
  ) THEN
    EXECUTE $sql$
      CREATE TABLE storage.objects (
          id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          bucket_id        text NULL REFERENCES storage.buckets (id),
          name             text NULL,
          owner            uuid NULL,
          created_at       timestamptz DEFAULT now(),
          updated_at       timestamptz DEFAULT now(),
          last_accessed_at timestamptz DEFAULT now(),
          metadata         jsonb NULL,
          owner_id         text NULL
      )
    $sql$;
    -- Hanya dijalankan bersama PEMBUATAN tabel stub lokal itu sendiri (jadi
    -- tidak pernah dicoba lagi di live, tempat kita bukan pemiliknya) —
    -- RLS+grant di live sudah disediakan platform (diverifikasi: relrowsecurity
    -- = true untuk buckets & objects, nol policy, sebelum migrasi ini ditulis).
    EXECUTE 'ALTER TABLE storage.buckets ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY';
    -- Aditif & setara grant default Supabase (RLS di atas adalah gerbang
    -- sesungguhnya) — SENGAJA hanya SELECT, nol INSERT/UPDATE/DELETE untuk
    -- authenticated: tulis objek hanya lewat service_role (bypass RLS+grant),
    -- setelah pagar Rule 41-42 lolos di kode.
    EXECUTE 'GRANT USAGE ON SCHEMA storage TO authenticated, anon';
    EXECUTE 'GRANT SELECT ON storage.buckets TO authenticated, anon';
    EXECUTE 'GRANT SELECT ON storage.objects TO authenticated, anon';
  END IF;

  -- `storage.foldername` — SAMA POLANYA: cek keberadaan sendiri, EXECUTE hanya
  -- bila belum ada. TIDAK PERNAH `CREATE OR REPLACE` — migrasi ini tidak
  -- boleh menimpa implementasi platform yang sudah berjalan di live dengan
  -- salinan yang bisa basi.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'foldername' AND pronamespace = 'storage'::regnamespace
  ) THEN
    EXECUTE $sql$
      CREATE FUNCTION storage.foldername(name text)
      RETURNS text[] LANGUAGE plpgsql IMMUTABLE AS $body$
      DECLARE
          _parts text[];
      BEGIN
          SELECT string_to_array(name, '/') INTO _parts;
          RETURN _parts[1 : array_length(_parts,1) - 1];
      END
      $body$;
    $sql$;
  END IF;
END
$outer$;

-- ===========================================================================
-- Dari sini: efek SUNGGUHAN di live (bucket + policy). Blok di atas hanya
-- prasyarat supaya baris di bawah bisa dijalankan di kedua tempat — di live
-- ia tidak menjalankan satu EXECUTE pun (semua cek di atas "sudah ada"),
-- di lokal ia baru saja menstub tabelnya.
-- ===========================================================================

-- Path objek (Rule 44): {client_id}/{client_platform_id}/{periode_selesai}/{batch_id}.zip
-- — `(storage.foldername(name))[1]` = client_id, dipakai policy di bawah
-- lewat helper `jwt_owns_client_am` yang SUDAH ADA (20260811030000), bukan
-- helper baru.
--
-- Upload/hapus objek HANYA lewat server (service_role, melewati RLS) SETELAH
-- pagar lolos (Flow A langkah 6 PRD) — karena itu TIDAK ADA policy
-- INSERT/UPDATE/DELETE untuk `authenticated` di sini secara sengaja. Baca
-- langsung lewat signed URL (Rule 44, ≤ 15 menit) juga tidak melalui RLS ini
-- (Storage API memvalidasi token signed-nya sendiri) — policy SELECT di sini
-- murni lapis kedua (bila kelak ada jalur baca API langsung dengan JWT
-- pengguna, bukan signed URL), pola sama dengan seluruh tabel PDT G1-01.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('pdt-raw', 'pdt-raw', false, 50 * 1024 * 1024, ARRAY['application/zip', 'application/x-zip-compressed'])
ON CONFLICT (id) DO NOTHING;

CREATE POLICY pdt_raw_objects_select ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'pdt-raw'
    AND (
      public.jwt_can_read_all()
      OR (public.jwt_is_lead() AND public.jwt_division() = 'Account')
      OR public.jwt_owns_client_am((storage.foldername(name))[1])
    )
  );

COMMENT ON POLICY pdt_raw_objects_select ON storage.objects IS
  'G1-04 — bucket pdt-raw SAJA (bucket_id terkunci di USING). Ownership dari '
  'segmen path pertama (client_id), cermin pdt_upload_batch_sel. Nol policy '
  'INSERT/UPDATE/DELETE untuk authenticated dengan sengaja — tulis/hapus '
  'objek hanya lewat service_role (server, setelah pagar Rule 41-42 lolos).';
