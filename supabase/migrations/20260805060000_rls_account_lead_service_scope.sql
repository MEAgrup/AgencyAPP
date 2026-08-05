-- ============================================================================
-- Jalur ONBOARDING layanan (M6 §3 Rule 4 → §4 → §5) mati di bawah RLS untuk
-- SPV/Head Account, dan setengah mati untuk AM yang mewarisi klien.
--
-- Kembar ketiga dari `20260804073744` (arm Finance) dan `20260805030100` (arm
-- Account pada `clients`) — ditemukan dengan cara yang sama: menjalankan alur
-- pemilik (2 klien di-assign ke AM, service `[Awaiting Onboarding]`) lewat
-- pembacaan ber-klaim sungguhan. Gejalanya sama: **kosong tanpa error**.
--
-- MEKANISMENYA. `20260805030100` membuka `clients` untuk Account lead, tapi
-- BERHENTI di situ. Anak-anak klien itu tidak ikut:
--
--   * `services_select` (baseline 20260723064438) hanya punya arm oversight,
--     `created_by`, dan `private.jwt_owns_client()` — kepemilikan PERORANGAN.
--     Seorang Account lead karena itu melihat NOL service. Padahal
--     `account.listServiceBriefs` (§5) dan gate `canReadDivision(Account)`
--     memang memberi lead hak baca: gate app-layer bilang boleh, RLS bilang
--     tidak ada barisnya, dan yang menang adalah yang tidak kelihatan.
--   * `strategy_plans_select` hanya `approved_by`/`created_by`. Konsekuensinya
--     paling mahal: Strategy & Plan yang BARU diajukan AM belum punya
--     `approved_by` (itu justru yang mau diisi), jadi inbox
--     "Menunggu Persetujuan" milik SPV **selalu kosong**. §4 Rule 4 (SPV
--     approve/minta revisi) tidak bisa dijalankan lewat UI sama sekali, dan
--     tanpa `[Strategy Approved]` Service plan-gated tidak akan pernah boleh
--     dibuatkan Brief (§5 Rule 5). Satu policy menghentikan seluruh rantai.
--     Arm `service`-nya juga perlu: AM yang MEWARISI klien lewat reassignment
--     (§3 Rule 3) bukan `created_by` Strategy yang sudah ada, jadi ia tidak
--     bisa membaca Plan atas layanannya sendiri.
--   * `briefs_select` hanya `assigned_pic`/`created_by`/lead divisi TUJUAN.
--     `account.listDivisionQueue` sengaja mengizinkan Account lead memantau
--     dispatch (keputusan Nerissa 2026-07-12, dikutip di `web-internal/src/lib/nav.ts`)
--     — di bawah RLS pemantauan itu mengembalikan nol baris.
--
-- Bukti empiris (PG16 lokal, 50 migrasi + seed, 2 klien released & di-assign ke
-- AM `EMP-0002`, satu Strategy `[Strategy Submitted for Approval]`), lewat
-- `set_config('request.jwt.claims',…) + SET LOCAL ROLE authenticated` — mekanisme
-- yang persis dipakai `readAsActor` (O37):
--
--     Account lead  : clients 2 | services 0 | strategy_plans 0   <-- rantai mati
--     AM (EMP-0002) : clients 2 | services 2 | strategy_plans 1   (kontrol)
--     Director      : clients 2 | services 2 | strategy_plans 1   (kontrol)
--
-- KENAPA ARM-NYA `jwt_is_lead() AND jwt_division() = 'Account'`: alasan yang
-- sama seperti `20260805030100` — pola Role Matrix (CLAUDE.md #6 / Fase 0 §4)
-- "Staff = data sendiri; Lead/SPV = seluruh divisi", dan gate domain yang
-- dilayaninya memang selebar itu (`permission.canReadDivision(actor,'Account')`
-- pada `listStrategies` / `listServiceBriefs` / `listDivisionQueue` /
-- `serviceQueue`). Membukanya untuk SEMUA Account staff akan melampaui gate
-- app-layer-nya sendiri tanpa satu pembaca pun membutuhkannya — AM staff sudah
-- terlayani arm kepemilikan (`private.jwt_owns_client` / `jwt_owns_service`).
--
-- Sifat perubahan: hanya MEMPERLUAS SELECT + satu helper baca baru. Tidak ada
-- policy tulis yang disentuh: ketiga tabel tetap default-deny untuk write, semua
-- tulis lewat RPC SECURITY DEFINER (`sm_transition`) atau service role.
-- ============================================================================

-- Helper: aktor adalah AM PEMILIK klien di atas Service ini.
--
-- Sengaja BUKAN `private.jwt_owns_client()`: helper itu juga memuat
-- `sales_pic_id` dan `commission_payment_pic_id`, yang akan membuka Strategy &
-- Plan serta Brief kepada Sales/Finance — lebih lebar daripada gate domain yang
-- dilayaninya (`account.listServiceBriefs` / `getStrategy` menerima **owning AM**
-- ∨ `canReadDivision(Account)`, bukan PIC uang). RLS tidak boleh lebih lebar dari
-- gate app-layer-nya; kalau lebih lebar, ia berhenti menjadi dinding kedua.
--
-- Tinggal di `private` mengikuti hardening 20260727072443 (advisor 0029): tidak
-- ada permukaan /rest/v1/rpc baru.
CREATE OR REPLACE FUNCTION private.jwt_is_am_of_service(p_service_id text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS
$$
  SELECT EXISTS (
    SELECT 1 FROM public.services sv JOIN public.clients c ON c.id = sv.client_id
    WHERE sv.id = p_service_id
      AND c.assigned_am_id = public.jwt_employee_id()
  )
$$;
REVOKE EXECUTE ON FUNCTION private.jwt_is_am_of_service(text) FROM anon;

-- services: + arm lead Account (divisi penuh).
DROP POLICY IF EXISTS services_select ON public.services;
CREATE POLICY services_select ON public.services FOR SELECT TO authenticated
USING (jwt_can_read_all()
       OR created_by = jwt_employee_id()
       OR private.jwt_owns_client(client_id)
       OR (jwt_is_lead() AND jwt_division() = 'Account'));

-- strategy_plans: + arm lead Account, + arm kepemilikan lewat Service induk.
DROP POLICY IF EXISTS strategy_plans_select ON public.strategy_plans;
CREATE POLICY strategy_plans_select ON public.strategy_plans FOR SELECT TO authenticated
USING (jwt_can_read_all()
       OR jwt_employee_id() IN (approved_by, created_by)
       OR private.jwt_is_am_of_service(service_id)
       OR (jwt_is_lead() AND jwt_division() = 'Account'));

-- briefs: + arm AM pemilik (klien warisan) + arm lead Account (pemantauan dispatch §6).
DROP POLICY IF EXISTS briefs_select ON public.briefs;
CREATE POLICY briefs_select ON public.briefs FOR SELECT TO authenticated
USING (jwt_can_read_all()
       OR jwt_employee_id() IN (assigned_pic, created_by)
       OR (jwt_is_lead() AND assigned_division = jwt_division())
       OR private.jwt_is_am_of_service(service_id)
       OR (jwt_is_lead() AND jwt_division() = 'Account'));
