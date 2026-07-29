-- ============================================================================
-- Fase 1 langkah 2 — Integrasi Supabase Auth (GoTrue).
--
-- Ref: docs/SUPABASE_MIGRATION_TECH_APPENDIX.md §C, PERMISSIONS.md,
--      backend/internal/auth/actor.go (ResolveActor), docs/DECISIONS.md
--      2026-07-22 (OQ-3: import bcrypt LANGSUNG; OQ-4: sumber karyawan = CSV).
--
-- Yang dibangun:
--   1. Kolom link `public.employees.auth_user_id` (↔ auth.users.id) +
--      `must_change_password` (gate pasca-login, tak ada padanan GoTrue).
--   2. `public.employee_claims(employee_id)` — resolver klaim app_metadata
--      (employee_id/division/level/od/director), MIRROR ResolveActor Go.
--   3. `public.custom_access_token_hook(event)` — Access Token Hook GoTrue yang
--      menyuntik klaim itu ke `app_metadata` JWT setiap token diterbitkan/refresh
--      (§C.3). INI yang dibaca oleh policy RLS `auth.jwt()->'app_metadata'`.
--   4. `sync_employee_claims(employee_id)` + trigger — jaga `raw_app_meta_data`
--      di auth.users tetap konsisten saat role_mapping/layered_role/status berubah.
--   5. `import_employee_credentials()` — import bcrypt hash existing LANGSUNG ke
--      auth.users (+ auth.identities email), OQ-3. Idempoten, service-role only.
--   6. `set_employee_banned(employee_id, banned)` — deaktivasi ⇒ ban GoTrue (§C.3).
--
-- PORTABILITAS: semua akses ke schema `auth` (auth.users / auth.identities) lewat
-- SQL DINAMIS (EXECUTE) + guard `to_regclass('auth.users')`, sehingga migrasi
-- ini VALID & bisa di-apply di stack polos (CI Postgres 17 tanpa GoTrue) — fungsi
-- yang menyentuh auth.* menjadi no-op runtime di sana. Hanya `custom_access_token_
-- hook` & `employee_claims` yang statik (mereka hanya baca tabel `public`).
--
-- GATE MANUSIA (di luar migrasi ini — lihat handoff): (a) aktifkan hook di
-- Dashboard Auth > Hooks (atau config.toml) memilih `custom_access_token_hook`;
-- (b) jalankan `import_employee_credentials()` atas data karyawan riil setelah
-- verifikasi versi GoTrue project; (c) smoke-test login SEMUA role di staging
-- (DECISIONS O36 — gate sebelum Fase 1 ditandai selesai).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Portabilitas: role `supabase_auth_admin` (pemilik eksekusi hook di GoTrue)
--    ada di Supabase; buat shim bila absen (CI/lokal). Role lain + schema auth +
--    auth.jwt() sudah dibuat migrasi RLS (20260723064438) yang jalan lebih dulu.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_auth_admin') THEN
    CREATE ROLE supabase_auth_admin NOLOGIN;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. Kolom profil untuk link identitas GoTrue.
-- ---------------------------------------------------------------------------
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS auth_user_id uuid;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS employees_auth_user_id_key
  ON public.employees(auth_user_id) WHERE auth_user_id IS NOT NULL;

-- FK ke auth.users hanya bila tabelnya ada (Supabase) — di stack polos dilewati.
DO $$
BEGIN
  IF to_regclass('auth.users') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employees_auth_user_id_fkey') THEN
    EXECUTE 'ALTER TABLE public.employees
             ADD CONSTRAINT employees_auth_user_id_fkey
             FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE SET NULL';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Resolver klaim — MIRROR backend/internal/auth/actor.go ResolveActor:
--    division/level dari role_mappings(divisi,jabatan); od/director dari
--    employee_layered_roles(enabled). Absennya mapping = string kosong (pure
--    Director), persis perilaku Go. SECURITY DEFINER: dipanggil dari hook/sync/
--    import (rantai definer = pemilik postgres) — TAK di-expose sebagai RPC.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.employee_claims(p_employee_id text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS
$$
  SELECT jsonb_build_object(
    'employee_id', e.employee_id,
    'division',    coalesce(rm.division, ''),
    'level',       coalesce(rm.level, ''),
    'od',          coalesce((SELECT bool_or(l.enabled) FROM public.employee_layered_roles l
                             WHERE l.employee_id = e.employee_id AND l.role = 'od'), false),
    'director',    coalesce((SELECT bool_or(l.enabled) FROM public.employee_layered_roles l
                             WHERE l.employee_id = e.employee_id AND l.role = 'director'), false)
  )
  FROM public.employees e
  LEFT JOIN public.role_mappings rm ON rm.divisi = e.divisi AND rm.jabatan = e.jabatan
  WHERE e.employee_id = p_employee_id;
$$;
-- Bukan RPC publik: hanya dipanggil dari fungsi definer (owner postgres).
REVOKE EXECUTE ON FUNCTION public.employee_claims(text) FROM public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Custom Access Token Hook (GoTrue) — menyuntik klaim ke app_metadata JWT.
--    Kontrak: menerima `event jsonb` (punya `user_id`, `claims`), kembalikan
--    event dengan `claims` termodifikasi. Employee di-resolve dari
--    app_metadata.employee_id (di-set saat provisioning) ATAU dari
--    employees.auth_user_id. SECURITY DEFINER supaya bisa baca tabel `public`
--    yang terkunci RLS; hanya `supabase_auth_admin` yang boleh meng-EXECUTE.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS
$$
DECLARE
  claims jsonb;
  meta jsonb;
  v_employee_id text;
BEGIN
  claims := coalesce(event -> 'claims', '{}'::jsonb);
  meta   := coalesce(claims -> 'app_metadata', '{}'::jsonb);

  v_employee_id := meta ->> 'employee_id';
  IF v_employee_id IS NULL THEN
    SELECT e.employee_id INTO v_employee_id
    FROM public.employees e
    WHERE e.auth_user_id = (event ->> 'user_id')::uuid;
  END IF;

  IF v_employee_id IS NOT NULL THEN
    -- Merge klaim CDPS di ATAS app_metadata bawaan (provider/providers terjaga).
    meta   := meta || public.employee_claims(v_employee_id);
    claims := jsonb_set(claims, '{app_metadata}', meta);
    event  := jsonb_set(event, '{claims}', claims);
  END IF;

  RETURN event;
END;
$$;

-- Hanya GoTrue (supabase_auth_admin) yang memanggil hook; cabut dari lainnya.
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) FROM public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Sinkronisasi klaim tersimpan (raw_app_meta_data) — supaya perubahan
--    role_mapping/layered_role/status ter-refleksi ke app_metadata tersimpan
--    (hook tetap sumber-fresh; ini menjaga konsistensi pembaca out-of-band /
--    admin API). No-op bila karyawan belum ter-provision (auth_user_id NULL)
--    atau di stack tanpa auth.users — jadi aman saat seed di CI.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_employee_claims(p_employee_id text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS
$$
DECLARE
  v_uid uuid;
BEGIN
  IF to_regclass('auth.users') IS NULL THEN
    RETURN; -- stack tanpa GoTrue (CI/lokal)
  END IF;
  SELECT auth_user_id INTO v_uid FROM public.employees WHERE employee_id = p_employee_id;
  IF v_uid IS NULL THEN
    RETURN; -- belum ter-provision
  END IF;
  EXECUTE 'UPDATE auth.users
             SET raw_app_meta_data = coalesce(raw_app_meta_data, ''{}''::jsonb) || $1
           WHERE id = $2'
    USING public.employee_claims(p_employee_id), v_uid;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.sync_employee_claims(text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_employee_claims(text) TO service_role;

-- Trigger dispatchers (SECURITY DEFINER via sync). Menyentuh karyawan terkait.
CREATE OR REPLACE FUNCTION public._sync_claims_on_employee()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS
$$
BEGIN
  PERFORM public.sync_employee_claims(NEW.employee_id);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public._sync_claims_on_layered()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS
$$
BEGIN
  PERFORM public.sync_employee_claims(coalesce(NEW.employee_id, OLD.employee_id));
  RETURN coalesce(NEW, OLD);
END;
$$;

-- role_mappings berubah ⇒ semua karyawan divisi+jabatan itu perlu re-sync.
CREATE OR REPLACE FUNCTION public._sync_claims_on_mapping()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS
$$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT employee_id FROM public.employees
    WHERE (divisi, jabatan) IN (
      (coalesce(NEW.divisi, OLD.divisi), coalesce(NEW.jabatan, OLD.jabatan))
    )
  LOOP
    PERFORM public.sync_employee_claims(r.employee_id);
  END LOOP;
  RETURN coalesce(NEW, OLD);
END;
$$;

-- Trigger function dipanggil oleh mekanisme trigger (bukan butuh EXECUTE dari
-- role DML) — cabut EXECUTE dari anon/authenticated/public supaya tak ter-expose
-- sebagai RPC PostgREST (advisor 0028/0029). Trigger tetap jalan.
REVOKE EXECUTE ON FUNCTION public._sync_claims_on_employee() FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._sync_claims_on_layered() FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._sync_claims_on_mapping() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS trg_sync_claims_employee ON public.employees;
CREATE TRIGGER trg_sync_claims_employee
  AFTER UPDATE OF status_aktif, divisi, jabatan ON public.employees
  FOR EACH ROW EXECUTE FUNCTION public._sync_claims_on_employee();

DROP TRIGGER IF EXISTS trg_sync_claims_layered ON public.employee_layered_roles;
CREATE TRIGGER trg_sync_claims_layered
  AFTER INSERT OR UPDATE OR DELETE ON public.employee_layered_roles
  FOR EACH ROW EXECUTE FUNCTION public._sync_claims_on_layered();

DROP TRIGGER IF EXISTS trg_sync_claims_mapping ON public.role_mappings;
CREATE TRIGGER trg_sync_claims_mapping
  AFTER INSERT OR UPDATE OR DELETE ON public.role_mappings
  FOR EACH ROW EXECUTE FUNCTION public._sync_claims_on_mapping();

-- ---------------------------------------------------------------------------
-- 5. Import bcrypt LANGSUNG ke GoTrue (OQ-3). Untuk tiap baris
--    `employee_credentials` yang karyawannya AKTIF & belum ter-provision:
--    buat auth.users (encrypted_password = hash bcrypt existing) + auth.identities
--    (provider 'email', wajib untuk login password di GoTrue modern), link
--    employees.auth_user_id, salin must_change_password, tulis app_metadata.
--    Idempoten (skip yang sudah punya auth_user_id / email sudah ada di auth.users).
--    SERVICE-ROLE ONLY; menyentuh auth.* lewat SQL dinamis (portable).
--
--    ⚠ VERSI GoTrue: kolom auth.users/auth.identities bisa berbeda antar versi.
--    Verifikasi terhadap project SEBELUM dipakai atas data riil (DECISIONS O36).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.import_employee_credentials()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS
$$
DECLARE
  r record;
  v_uid uuid;
  n integer := 0;
BEGIN
  IF to_regclass('auth.users') IS NULL THEN
    RAISE EXCEPTION 'auth.users tidak ada — import hanya di stack Supabase/GoTrue';
  END IF;

  FOR r IN
    SELECT c.employee_id, c.password_hash, c.must_change_password,
           e.email
    FROM public.employee_credentials c
    JOIN public.employees e ON e.employee_id = c.employee_id
    WHERE e.status_aktif
      AND e.auth_user_id IS NULL
      AND e.email IS NOT NULL
  LOOP
    v_uid := gen_random_uuid();

    EXECUTE $q$
      INSERT INTO auth.users
        (instance_id, id, aud, role, email, encrypted_password,
         email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
         created_at, updated_at)
      VALUES
        ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated',
         $2, $3, now(),
         jsonb_build_object('provider','email','providers', jsonb_build_array('email'))
           || $4,
         '{}'::jsonb, now(), now())
      ON CONFLICT (id) DO NOTHING
    $q$
    USING v_uid, r.email, r.password_hash,
          public.employee_claims(r.employee_id);

    -- Identity email (login password). provider_id = user id (konvensi GoTrue).
    EXECUTE $q$
      INSERT INTO auth.identities
        (provider_id, user_id, identity_data, provider, last_sign_in_at,
         created_at, updated_at)
      VALUES
        ($1::text, $1, jsonb_build_object('sub', $1::text, 'email', $2),
         'email', now(), now(), now())
      ON CONFLICT DO NOTHING
    $q$
    USING v_uid, r.email;

    UPDATE public.employees
       SET auth_user_id = v_uid,
           must_change_password = coalesce(r.must_change_password, false)
     WHERE employee_id = r.employee_id;

    n := n + 1;
  END LOOP;

  RETURN n;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.import_employee_credentials() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.import_employee_credentials() TO service_role;

-- ---------------------------------------------------------------------------
-- 6. Deaktivasi HRIS ⇒ ban GoTrue (§C.3). banned_until = 'infinity' memblok
--    login/refresh walau password benar; NULL = un-ban (reaktivasi). Juga set
--    employees.status_aktif agar sumber kebenaran konsisten. Service-role only.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_employee_banned(p_employee_id text, p_banned boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS
$$
DECLARE v_uid uuid;
BEGIN
  UPDATE public.employees SET status_aktif = NOT p_banned WHERE employee_id = p_employee_id;
  IF to_regclass('auth.users') IS NULL THEN
    RETURN;
  END IF;
  SELECT auth_user_id INTO v_uid FROM public.employees WHERE employee_id = p_employee_id;
  IF v_uid IS NULL THEN
    RETURN;
  END IF;
  EXECUTE 'UPDATE auth.users SET banned_until = $1 WHERE id = $2'
    USING (CASE WHEN p_banned THEN 'infinity'::timestamptz ELSE NULL END), v_uid;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.set_employee_banned(text, boolean) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_employee_banned(text, boolean) TO service_role;
