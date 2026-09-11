-- ============================================================================
-- Bridge MSDPS → CDPS, Fase 1 — inbox `ORD-` + gate penerimaan Head Account.
--
-- Konteks: MEAGO! (MSDPS, `MEAgrup/MEAGO_MSDPS`, proyek Supabase TERPISAH)
-- menutup deal dengan merchant POI tapi TIDAK punya staff Account/Ads/
-- Creative/Store Operation sendiri — semuanya duduk di MEA Agency dan bekerja
-- di CDPS. MSDPS M6–M10 (execution engine keduanya) sudah lengkap dan
-- ber-nol penghuni. Opsi A (dikunci pemilik 2026-09-10, lihat
-- `docs/DECISIONS.md`): MSDPS mendorong *work order* ke inbox ini; manusia
-- CDPS menerimanya; CDPS menjalankan eksekusi. Fase 1 = SATU ARAH, TANPA
-- callback. `docs/BRIDGE_MSDPS_CONTRACT.md` (migrasi yang sama) adalah
-- kontrak payload-nya — MSDPS dibangun terhadap berkas itu, bukan sebaliknya.
--
-- Bridge BUKAN modul PRD. Otoritasnya `docs/DECISIONS.md` 2026-09-10, yang
-- MENGGANTIKAN entri 2026-07-12 yang menaruh TikTok GO di luar cakupan CDPS —
-- preseden `TSK-` Penugasan Internal ("di luar 18 PRD", `DATA_MODEL.md:44`).
--
-- ## GARIS KEPEMILIKAN (satu aturan yang menurunkan semua yang lain)
--
--   MSDPS memiliki merchant, deal, uang, dan eksekusi creator/POI.
--   CDPS memiliki eksekusi divisi agency dan orang yang mengerjakannya.
--   Tidak ada yang menulis baris milik yang lain. Selamanya.
--
-- ## EMPAT AMANDEMEN TERHADAP RENCANA ASLI (BRIDGING_MSDPS_CDPS_v1.0.md)
--
-- Ditemukan saat mengecek rencana terhadap kode berjalan (bukan terhadap
-- asumsi), sebelum satu baris SQL pun ditulis:
--
-- 1. **D5: BUKAN "BD MEAGO sync sebagai employee tanpa login".** `employees.
--    email` adalah `NOT NULL` + `UNIQUE` (satu-satunya baris kosong boleh
--    ada), dan `provisionCredentials` memberi kredensial ke SETIAP employee
--    aktif — menandai non-aktif berarti mem-ban mereka di GoTrue sekaligus.
--    Amandemen (opsi b, dikonfirmasi): SATU employee layanan "MEAGO Bridge"
--    (satu email nyata tim, prasyarat non-kode — lihat Bagian V rencana).
--    "Siapa yang bawa klien ini" tidak hilang: identitas BD MEAGO tetap
--    terekam di `external_orders.payload` (imutabel) dan
--    `client_external_billing.diverifikasi_oleh_external` — ia hanya tidak
--    duduk di `sales_pic_id`.
-- 2. **§4.3: PENANDA EKSKLUSI HARUS HIDUP DI BARIS LAYANAN, BUKAN HANYA
--    KLIEN.** `commissionAchievement`/`commissionAchievementBatch`
--    (`finance.ts`) menjumlahkan komisi atas SEMUA layanan milik KLIEN, bukan
--    per transaksi — dan §6.1 rencana asli MEMANG menginginkan opsi
--    "tempelkan ke `CLI-` yang sudah ada". Satu klien CDPS lama yang menerima
--    satu layanan MEAGO akan menaikkan komisi salesnya tanpa transaksi di
--    belakangnya kalau penandanya cuma di `clients`. ⇒ `services.sumber`
--    DITAMBAHKAN di samping `clients.sumber`, bukan menggantikannya.
-- 3. **A7 dipindah dari Fase 3 ke Fase 1 (PR yang sama).** `book_period_
--    snapshots` dan `client_health_snapshots` IMMUTABLE — bulan buku yang
--    tertutup dengan angka MEAGO di dalamnya salah SELAMANYA, dan satu-
--    satunya perbaikan sah adalah jurnal koreksi di bulan berjalan. Sesuatu
--    yang menulis catatan immutable tidak boleh berjalan di bawah model yang
--    sudah diketahui akan berubah. Lihat migrasi anti-drift yang menyertai
--    berkas ini di PR yang sama (`tutupbuku.ts`, `finance.ts`, `health.ts`).
-- 4. **D10 dibaca ulang jadi "lead Account + Director", bukan "Head Account
--    saja".** Gerbang terhalus yang ADA hari ini adalah `isLead(actor,
--    'Account')`, yang meloloskan setiap Director dan setiap lead Account
--    (termasuk `LEADER CUSTOMER RELATIONS OFFICER`, yang memetakan ke
--    Account/lead). Tier "Head" terpisah butuh `role_mappings` di luar
--    `staff|lead` — pemicu wave K-1 yang SENGAJA ditunda pemilik 2026-09-07.
--    D10 tidak dilebarkan, hanya dinyatakan dengan jujur memakai gerbang yang
--    benar-benar ada.
--
-- Ketiga amandemen di atas (D5, §4.3, D10) beserta 16 keputusan terkunci
-- dicatat di `docs/DECISIONS.md` 2026-09-10, PR yang sama dengan migrasi ini.
--
-- ## APA YANG SENGAJA TIDAK ADA DI SINI
--
-- **Nol `TRX-` untuk order MEAGO.** `clients.transaction_id` dan
-- `payment_intent` tetap NULL untuk klien `sumber='meago'`. Transaksi bayangan
-- akan masuk antrean verifikasi M5, dashboard reminder, mesin accrual, dan
-- Kinerja Sales — empat angka salah demi satu FK yang nyaman.
--
-- **Nol seed `external_service_map`.** Paket MEAGO belum ada di Master
-- Service List (prasyarat non-kode, dikerjakan Sales Head + Head Account).
-- Menebak pemetaan berarti memasukkan pekerjaan tak berharga ke jalur
-- accrual — persis yang dicegah pesan `[layanan MEAGO belum dipetakan ke
-- Master Service List]`.
--
-- **Edge `[Dibatalkan Sumber]` terdaftar tapi TAK TERJANGKAU rute mana pun.**
-- Itu jalur Fase 2 (callback). Mendaftarkannya sekarang menghindari migrasi
-- kedua nanti untuk satu baris `sm_edges`; tidak mengarang pemanggilnya
-- sekarang menghindari menjanjikan perilaku yang tidak ada.
--
-- **Nol `apply_ppn`/posting cross-charge.** `client_external_billing.
-- nilai_cross_charge` CAPTURES angka intra-grup (D16); POSTING-nya (jurnal,
-- invoice) adalah Fase 3, dan `apply_ppn` intra-grup adalah pertanyaan
-- Finance, bukan keputusan teknik.
--
-- ## KENAPA GATE NAIK EMPAT DARI EMPAT
--
--   tabel public    156 → 160   `external_orders`, `client_external_ref`,
--                                `client_external_billing`, `external_service_map`
--   entity_prefix    43 →  44   `ORD`
--   sm_machines      34 →  35   mesin #35 `external_order`
--   notif_events     73 →  74   `bridge.order.masuk` (v16, SATU event — lihat
--                                bagian 6)
--
-- Angka ABSOLUT, dinaikkan di `scripts/db-rebuild.sh` DAN
-- `.github/workflows/ci.yml` pada commit yang SAMA dengan berkas ini.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Prefix registry — dual-home dengan `PREFIXES` di
--    `packages/core/src/ident.ts`, dipaksa identik oleh `ident.registry.test.ts`.
-- ---------------------------------------------------------------------------
INSERT INTO entity_prefix (prefix, entity_name, module) VALUES
    ('ORD', 'External work order (bridge MSDPS→CDPS)', 'Bridge');

-- ---------------------------------------------------------------------------
-- 2. Mesin #35 `external_order`.
--
--    [Masuk] → [Diterima] | [Ditolak]   (keduanya terminal)
--    [Masuk] → [Dibatalkan Sumber]      (registered, UNREACHABLE di Fase 1 —
--                                         milik callback Fase 2, lihat header)
--
--    Gerbang `[Masuk]` → `[Diterima]`/`[Ditolak]`: `require_lead=true` +
--    `require_division='Account'` ⇒ Director ATAU lead Account (amandemen
--    D10 di header — bukan "Head Account", karena tier itu belum ada di
--    model peran). `sm_transition` sendiri MENOLAK tanpa actor (`no_actor`),
--    jadi jalur ini structural: tidak ada penerimaan order tanpa manusia.
-- ---------------------------------------------------------------------------
INSERT INTO sm_machines (name, initial_state, block_message, auto_computed, flags) VALUES
    ('external_order', '[Masuk]', '[transisi order tidak diizinkan]', false, '{}');

INSERT INTO sm_terminal_states (machine, state) VALUES
    ('external_order', '[Diterima]'),
    ('external_order', '[Ditolak]');

INSERT INTO sm_edges (machine, from_state, to_state, require_lead, require_division) VALUES
    ('external_order', '[Masuk]', '[Diterima]', true, 'Account'),
    ('external_order', '[Masuk]', '[Ditolak]',  true, 'Account'),
    -- Fase 2 (callback). Registered now so the Fase 2 migration adds a caller,
    -- not a schema change. Nol `require_lead`: siapa yang boleh memicu
    -- pembatalan dari SUMBER belum diketok, dan itu keputusan Fase 2.
    ('external_order', '[Masuk]', '[Dibatalkan Sumber]', false, NULL);

-- ---------------------------------------------------------------------------
-- 3. `clients.sumber` — asal klien. Zero backfill: setiap baris lama membaca
--    'sales'. Kolom ini SATU dari DUA penanda eksklusi (lihat amandemen §4.3
--    di header) — ia menggerakkan eksklusi yang genuinely per-KLIEN (M13
--    health score GMV component, D6), tapi BUKAN komisi (per-LAYANAN, lihat
--    bagian 4).
-- ---------------------------------------------------------------------------
ALTER TABLE clients
    ADD COLUMN sumber varchar(32) NOT NULL DEFAULT 'sales';

ALTER TABLE clients
    ADD CONSTRAINT ck_clients_sumber CHECK (sumber IN ('sales', 'meago'));

COMMENT ON COLUMN clients.sumber IS
  'Asal klien: ''sales'' (jalur Lead→Prospect→Closing CDPS sendiri) atau '
  '''meago'' (dibridge dari MSDPS, ORD- yang diterima). Klien ber-sumber '
  '''meago'' TIDAK PERNAH punya client_sales_allocations dan TIDAK PERNAH '
  'punya TRX- CDPS (bridge.accept tidak menulis keduanya) — invariant yang '
  'dijaga tes, bukan hanya konvensi. Menggerakkan eksklusi M13 GMV component '
  '(D6). TIDAK menggerakkan eksklusi komisi — itu tugas services.sumber, '
  'karena komisi dijumlahkan per LAYANAN dan satu klien lama boleh punya '
  'layanan dari dua sumber (lihat services.sumber).';

-- ---------------------------------------------------------------------------
-- 4. `services.sumber` — amandemen §4.3. Rencana asli (BRIDGING_MSDPS_CDPS_
--    v1.0.md §4.3) menganggap `clients.sumber` saja menggerakkan SETIAP
--    eksklusi. Itu keliru untuk kasus "tempel ke CLI- yang sudah ada"
--    (§6.1 dokumen yang sama secara eksplisit MENGINGINKAN langkah itu):
--    `commissionAchievement`/`commissionAchievementBatch` (finance.ts)
--    menjumlahkan Σ atas SEMUA layanan milik satu client_id, bukan per
--    transaksi. Kalau eksklusinya cuma di `clients`, klien CDPS lama yang
--    menerima satu layanan MEAGO akan menaikkan komisi salesnya — tanpa
--    transaksi baru di belakangnya. Baris LAYANAN, bukan hanya baris KLIEN,
--    harus bisa menjawab "apakah ini dari MEAGO".
--
--    Nol backfill. Zero flag ketiga di mana pun — DUA kolom `sumber`
--    (clients + services) adalah yang dibutuhkan dan yang cukup; jangan
--    menambah yang ketiga.
-- ---------------------------------------------------------------------------
ALTER TABLE services
    ADD COLUMN sumber varchar(32) NOT NULL DEFAULT 'sales';

ALTER TABLE services
    ADD CONSTRAINT ck_services_sumber CHECK (sumber IN ('sales', 'meago'));

COMMENT ON COLUMN services.sumber IS
  'Amandemen §4.3 terhadap BRIDGING_MSDPS_CDPS_v1.0.md — komisi dijumlahkan '
  'PER LAYANAN (finance.dealServices), bukan per klien, dan satu klien lama '
  'boleh menerima layanan dari dua sumber sekaligus (klien CDPS asli yang '
  'juga menerima satu SVC- MEAGO lewat bridge.accept tempel-ke-klien-lama). '
  'services.sumber=''meago'' dikecualikan dari dealServices (finance.ts) dan '
  'dari hitungAngkaPeriode (tutupbuku.ts) — lihat migrasi anti-drift yang '
  'menyertai berkas ini di packages/domain. clients.sumber TIDAK CUKUP untuk '
  'kedua eksklusi itu.';

-- ---------------------------------------------------------------------------
-- 5. `client_external_ref` — satu POI MSDPS ⇒ paling banyak satu `CLI-` CDPS.
--    UNIQUE (sumber, external_id) menangkap race double-accept di level DB,
--    bukan cek-dulu-insert di TS (`bridge.accept` mengandalkan ini).
--    `external_id` = `brand_deals.shop_id` MSDPS bila ada, selain itu
--    `merchants.id` MSDPS — keduanya string opaque dari sistem lain, jadi
--    TIDAK ber-FK ke apa pun di CDPS.
-- ---------------------------------------------------------------------------
CREATE TABLE client_external_ref (
    id          bigint       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    client_id   varchar(32)  NOT NULL REFERENCES clients (id),
    sumber      varchar(32)  NOT NULL,
    external_id varchar(128) NOT NULL,
    created_by  varchar(64)  NOT NULL REFERENCES employees (employee_id),
    created_at  timestamptz  NOT NULL DEFAULT now(),

    CONSTRAINT ck_client_external_ref_sumber CHECK (sumber IN ('meago')),
    CONSTRAINT uq_client_external_ref UNIQUE (sumber, external_id)
);

CREATE INDEX idx_client_external_ref_client ON client_external_ref (client_id);

COMMENT ON TABLE client_external_ref IS
  'Bridge Fase 1 — memetakan SATU identitas eksternal MSDPS ke PALING BANYAK '
  'SATU CLI- CDPS. UNIQUE (sumber, external_id) adalah pertahanan utama '
  'terhadap race dua accept bersamaan pada external_id yang sama: bridge.ts '
  'meng-INSERT langsung dan membiarkan constraint menolak duplikat, tidak '
  'pernah cek-dulu-insert.';

-- ---------------------------------------------------------------------------
-- 6. `client_external_billing` — atestasi APPEND-ONLY: "MSDPS Finance sudah
--    memverifikasi pembayaran pertama deal ini". BUKAN baris pembayaran —
--    ini catatan bahwa SISTEM LAIN sudah memverifikasi satu, dan tidak
--    pernah dibaca M5. Trigger menolak UPDATE *dan* DELETE, pola
--    `client_pitch_consents_frozen` (20260916010000) — TAPI dengan
--    `SET search_path = public` yang lupa dipasang pada trigger itu.
--    Ditutup di sini, tidak diperbaiki retroaktif di sana (di luar cakupan
--    tiket bridge).
--
--    `bentuk_kerjasama` CHECK = 'Berbayar' SAJA: kolomnya ada supaya
--    CONSTRAINT itu sendiri MENYATAKAN aturan D4 ("CDPS hanya mengerjakan
--    deal berbayar"), bukan menyembunyikannya di balik validasi TS yang bisa
--    diam-diam dilonggarkan.
--
--    `diverifikasi_pada NOT NULL` — disalin dari `transactions.
--    released_to_account_at` MSDPS (D13: gerbang bayar-dulu ada di SUMBER).
--    `bridge.accept` MENOLAK payload tanpa field ini, untuk actor mana pun
--    termasuk Director (lihat packages/domain/src/bridge.ts).
-- ---------------------------------------------------------------------------
CREATE TABLE client_external_billing (
    id                          bigint        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    client_id                   varchar(32)   NOT NULL REFERENCES clients (id),
    sumber                      varchar(32)   NOT NULL,
    external_deal_code          varchar(64)   NOT NULL,
    external_trx_ref            varchar(64)   NOT NULL,
    bentuk_kerjasama            varchar(32)   NOT NULL,
    nilai                       numeric(15,2) NULL,
    nilai_cross_charge          numeric(15,2) NULL,
    diverifikasi_pada           timestamptz   NOT NULL,
    diverifikasi_oleh_external  varchar(128)  NULL,
    dilaporkan_oleh             varchar(64)   NOT NULL REFERENCES employees (employee_id),
    created_at                  timestamptz   NOT NULL DEFAULT now(),

    CONSTRAINT ck_ceb_sumber CHECK (sumber IN ('meago')),
    CONSTRAINT ck_ceb_bentuk_kerjasama CHECK (bentuk_kerjasama = 'Berbayar'),
    CONSTRAINT ck_ceb_nilai CHECK (nilai IS NULL OR nilai >= 0),
    CONSTRAINT ck_ceb_cross_charge CHECK (nilai_cross_charge IS NULL OR nilai_cross_charge >= 0)
);

CREATE INDEX idx_ceb_client ON client_external_billing (client_id);

CREATE OR REPLACE FUNCTION client_external_billing_frozen()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    RAISE EXCEPTION 'client_external_billing: atestasi append-only (aturan rumah #3) — ia catatan verifikasi SISTEM LAIN, bukan baris yang pernah butuh koreksi in-place';
END;
$$;

CREATE TRIGGER trg_client_external_billing_frozen
    BEFORE UPDATE OR DELETE ON client_external_billing
    FOR EACH ROW EXECUTE FUNCTION client_external_billing_frozen();

COMMENT ON TABLE client_external_billing IS
  'Bridge Fase 1 — atestasi append-only bahwa MSDPS Finance sudah '
  'memverifikasi pembayaran pertama deal ini (D4+D13). BUKAN baris '
  'pembayaran CDPS dan TIDAK PERNAH dibaca M5 (nol TRX- untuk order MEAGO — '
  'lihat header migrasi). nilai_cross_charge DITANGKAP di sini (D16) tapi '
  'DI-POSTING (jurnal/invoice) di Fase 3 — bukan tugas tabel ini.';

COMMENT ON COLUMN client_external_billing.diverifikasi_pada IS
  'Disalin dari transactions.released_to_account_at MSDPS. NOT NULL: tidak '
  'ada lagi jalur "belum terverifikasi" sejak D13 memindahkan gerbang bayar '
  'ke SUMBER. bridge.accept menolak payload tanpa nilai ini untuk actor '
  'mana pun, termasuk Director.';

-- ---------------------------------------------------------------------------
-- 7. `external_orders` — inbox. Satu baris per order yang didorong MSDPS.
--
--    `payload` IMMUTABLE via trigger (UPDATE ditolak — pola `client_reports.
--    payload`) + CHECK menolak `{}`/null/array: "tanpa baris bridge" dan
--    "pengiriman gagal" tidak boleh berbagi satu bentuk.
--
--    `payload_versi` SENGAJA TANPA CHECK terkunci ke `1` — validasi versi
--    yang diketahui/tidak dikenal adalah keputusan DOMAIN (bridge.intake),
--    supaya v2 kelak adalah baris kode baru, bukan migrasi yang mencabut
--    constraint. Fase 1 menolak apa pun selain 1 di packages/domain/src/
--    bridge.ts, dengan pesan BI eksplisit — bukan tebakan.
--
--    Nol jalur DELETE — riwayat inbox adalah riwayat (aturan rumah #3).
-- ---------------------------------------------------------------------------
CREATE TABLE external_orders (
    id                  varchar(32)  NOT NULL PRIMARY KEY, -- ORD-YYYYMM-NNNN
    sumber              varchar(32)  NOT NULL,
    external_deal_code  varchar(64)  NOT NULL,
    payload             jsonb        NOT NULL,
    payload_versi       integer      NOT NULL,
    idempotency_key     varchar(128) NOT NULL UNIQUE,
    diterima_pada       timestamptz  NOT NULL DEFAULT now(),
    status              varchar(48)  NOT NULL DEFAULT '[Masuk]',
    client_id           varchar(32)  NULL REFERENCES clients (id),
    ditolak_alasan      text         NULL,
    diputus_oleh        varchar(64)  NULL REFERENCES employees (employee_id),
    diputus_pada        timestamptz  NULL,

    CONSTRAINT ck_extorders_sumber CHECK (sumber IN ('meago')),
    CONSTRAINT ck_extorders_payload_shape
        CHECK (jsonb_typeof(payload) = 'object' AND payload <> '{}'::jsonb),
    CONSTRAINT ck_extorders_payload_versi CHECK (payload_versi >= 1),
    -- Terminal state yang alasannya hilang adalah baris yang pembacanya
    -- harus menebak.
    CONSTRAINT ck_extorders_ditolak
        CHECK (status <> '[Ditolak]' OR ditolak_alasan IS NOT NULL),
    CONSTRAINT ck_extorders_diterima
        CHECK (status <> '[Diterima]' OR client_id IS NOT NULL)
);

CREATE INDEX idx_extorders_status ON external_orders (status, diterima_pada);
CREATE INDEX idx_extorders_client ON external_orders (client_id) WHERE client_id IS NOT NULL;

CREATE OR REPLACE FUNCTION external_orders_payload_frozen()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    IF NEW.payload IS DISTINCT FROM OLD.payload THEN
        RAISE EXCEPTION 'external_orders: payload immutable (aturan rumah #3) — revisi payload = order revision baru (payload_versi+1, Fase 2), bukan UPDATE baris lama';
    END IF;
    IF NEW.payload_versi IS DISTINCT FROM OLD.payload_versi THEN
        RAISE EXCEPTION 'external_orders: payload_versi beku bersama payload';
    END IF;
    IF NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key THEN
        RAISE EXCEPTION 'external_orders: idempotency_key beku';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_external_orders_payload_frozen
    BEFORE UPDATE ON external_orders
    FOR EACH ROW EXECUTE FUNCTION external_orders_payload_frozen();

COMMENT ON TABLE external_orders IS
  'Bridge Fase 1 — inbox order dari MSDPS. Mesin #35 external_order. payload '
  'IMMUTABLE (trigger) dan bentuknya dikunci docs/BRIDGE_MSDPS_CONTRACT.md '
  'v1. Nol DELETE — riwayat inbox adalah riwayat. status ditulis EKSKLUSIF '
  'oleh sm_transition; tidak ada UPDATE mentah yang menyentuhnya.';

COMMENT ON COLUMN external_orders.payload_versi IS
  'Versi kontrak payload (docs/BRIDGE_MSDPS_CONTRACT.md). Fase 1 menerima '
  'HANYA versi 1 — ditegakkan di packages/domain/src/bridge.ts (intake), '
  'bukan CHECK, supaya versi baru adalah kode baru bukan migrasi yang '
  'mencabut constraint.';

COMMENT ON COLUMN external_orders.idempotency_key IS
  '<DEAL code MSDPS>:<payload_versi>. UNIQUE membuat re-POST (retry outbox '
  'MSDPS setelah timeout ambigu) aman: kunci yang sudah ada mengembalikan '
  'ord_code asli, nol baris baru, nol notifikasi kedua (bridge.intake).';

-- ---------------------------------------------------------------------------
-- 8. `external_service_map` — pemetaan admin `external_service_type` MSDPS →
--    `master_service_id` CDPS. Pola `role_mappings`: editable tanpa deploy.
--
--    LAHIR KOSONG. Paket MEAGO belum ada di Master Service List (prasyarat
--    non-kode §0.2/Bagian V rencana, pemilik Sales Head + Head Account).
--    Menyeed tebakan berarti memasukkan pekerjaan tak berharga ke jalur
--    accrual — persis yang dicegah `bridge.accept` dengan
--    `[layanan MEAGO belum dipetakan ke Master Service List]`.
--
--    `aktif boolean` (preseden `employee_layered_roles.enabled`) + partial
--    unique index `(sumber, external_service_type) WHERE aktif` (preseden
--    `idx_contracts_sebelumnya`) — keduanya penyimpangan disengaja dari
--    `role_mappings`, yang tidak punya salah satunya.
-- ---------------------------------------------------------------------------
CREATE TABLE external_service_map (
    id                     bigint       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    sumber                 varchar(32)  NOT NULL,
    external_service_type  varchar(64)  NOT NULL,
    master_service_id      varchar(32)  NOT NULL REFERENCES master_services (id),
    aktif                  boolean      NOT NULL DEFAULT true,
    created_by             varchar(64)  NOT NULL REFERENCES employees (employee_id),
    created_at             timestamptz  NOT NULL DEFAULT now(),

    CONSTRAINT ck_extsvcmap_sumber CHECK (sumber IN ('meago'))
);

CREATE UNIQUE INDEX uq_extsvcmap_aktif
    ON external_service_map (sumber, external_service_type) WHERE aktif;

COMMENT ON TABLE external_service_map IS
  'Bridge Fase 1 — pemetaan admin external_service_type (MSDPS deal_bridge_'
  'lines.jenis) → master_service_id (CDPS MSL). LAHIR KOSONG: paket MEAGO '
  'belum ada di MSL (prasyarat non-kode). bridge.accept menolak SELURUH '
  'transaksi (atomik) bila satu baris bridge tak terpetakan — nol accept '
  'separuh-jadi.';

-- ---------------------------------------------------------------------------
-- 9. RLS — urutan REVOKE anon → REVOKE authenticated → GRANT SELECT TO
--    authenticated → ENABLE RLS → policy (pola 20260928010000:307-322). GRANT
--    itu wajib: `authenticated` ditolak Postgres SEBELUM satu policy pun
--    dievaluasi tanpa itu (jebakan yang sempat menggigit `internal_tasks` dan
--    `store_ops_skus`).
-- ---------------------------------------------------------------------------

-- external_orders: baca = lead Account | Director | OD (read-only) | AM
-- pemilik klien SESUDAH diterima. Tulis (accept/reject/intake) lewat route +
-- domain (service-role), nol policy INSERT/UPDATE untuk `authenticated`.
REVOKE ALL ON public.external_orders FROM anon;
REVOKE ALL ON public.external_orders FROM authenticated;
GRANT SELECT ON public.external_orders TO authenticated;
ALTER TABLE public.external_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY external_orders_select ON public.external_orders FOR SELECT TO authenticated
USING (public.jwt_can_read_all()
       OR (public.jwt_is_lead() AND public.jwt_division() = 'Account')
       OR (client_id IS NOT NULL AND private.jwt_owns_client(client_id)));

-- client_external_ref / client_external_billing: scope cermin
-- `report.canWriteReport` (AM pemilik | lead Account | Director) + OD baca.
REVOKE ALL ON public.client_external_ref FROM anon;
REVOKE ALL ON public.client_external_ref FROM authenticated;
GRANT SELECT ON public.client_external_ref TO authenticated;
ALTER TABLE public.client_external_ref ENABLE ROW LEVEL SECURITY;

CREATE POLICY client_external_ref_select ON public.client_external_ref FOR SELECT TO authenticated
USING (public.jwt_can_read_all()
       OR (public.jwt_is_lead() AND public.jwt_division() = 'Account')
       OR private.jwt_owns_client(client_id));

REVOKE ALL ON public.client_external_billing FROM anon;
REVOKE ALL ON public.client_external_billing FROM authenticated;
GRANT SELECT ON public.client_external_billing TO authenticated;
ALTER TABLE public.client_external_billing ENABLE ROW LEVEL SECURITY;

CREATE POLICY client_external_billing_select ON public.client_external_billing FOR SELECT TO authenticated
USING (public.jwt_can_read_all()
       OR (public.jwt_is_lead() AND public.jwt_division() = 'Account')
       OR private.jwt_owns_client(client_id));

-- external_service_map: katalog murni, USING (true) — pola
-- `master_services_select`/`studios_select`. Masuk ledger O48
-- (supabase/tests/rls_checks.sql §42) DENGAN SENGAJA, dicatat di
-- docs/DECISIONS.md 2026-09-10: isinya nama tipe layanan + ID MSL, tidak
-- lebih sensitif daripada `standard_price` yang sudah terbuka bagi seluruh
-- staff, dan layar accept butuh daftarnya untuk memvalidasi baris bridge —
-- termasuk pada hari nol baris (tabel ini LAHIR KOSONG). Tulis = admin/
-- Director lewat route + domain, nol policy tulis di sini.
REVOKE ALL ON public.external_service_map FROM anon;
REVOKE ALL ON public.external_service_map FROM authenticated;
GRANT SELECT ON public.external_service_map TO authenticated;
ALTER TABLE public.external_service_map ENABLE ROW LEVEL SECURITY;

CREATE POLICY external_service_map_select ON public.external_service_map FOR SELECT TO authenticated
USING (true);

-- ---------------------------------------------------------------------------
-- 10. Notifikasi — katalog v16, SATU event baru.
--
--     `bridge.order.masuk` → lead Account (resolver 'leadsOfDivision',
--     Director sudah tercakup jwt_can_read_all di sisi baca — resolver ini
--     hanya menentukan SIAPA DIBERI TAHU, bukan siapa boleh membaca).
--     Emitter: packages/domain/src/bridge.ts `intake()`.
--
--     SATU event, bukan tiga. `[Ditolak]` nol audiens CDPS di Fase 1 (nol
--     callback ke MSDPS — itu Fase 2), dan `[Diterima]` adalah aksi actor
--     sendiri (dia tidak perlu diberi tahu tentang aksinya sendiri) —
--     preseden `internal_tasks`/M18: event didaftarkan bersama emitternya,
--     dan mendaftarkan event yang tak pernah diemisikan membuat katalog
--     berbohong (invariant O55: Σ event_count = COUNT(notif_events)).
-- ---------------------------------------------------------------------------
INSERT INTO notif_catalog_versions (version, description, event_count, decision_ref) VALUES
    (16,
     'Bridge MSDPS→CDPS Fase 1 — 1 event: bridge.order.masuk (order [Masuk] '
     'baru dari MSDPS) → lead Account. Satu event, bukan tiga: [Ditolak] nol '
     'audiens CDPS di Fase 1 (nol callback), [Diterima] adalah aksi actor '
     'sendiri.',
     1,
     'docs/DECISIONS.md 2026-09-10 (Bridge MSDPS→CDPS Fase 1)');

INSERT INTO notif_events (event_type, description, resolver, catalog_version) VALUES
    ('bridge.order.masuk',
     'Order baru [Masuk] dari MSDPS — ke lead Account',
     'leadsOfDivision',
     16);
