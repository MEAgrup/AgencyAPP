-- CDPS M16 — FONDASI lead-time per tahapan divisi (keputusan pemilik 2026-08-28).
--
-- Migrasi ini adalah "Tahap F" dari rencana eksekusi paralel
-- (docs/handoff/PARALEL_M16_DUA_AKUN.md). Isinya SEMATA choke point global:
-- berkas/tabel tunggal yang invariant-nya pecah kalau dua stream paralel
-- menyentuhnya. Tabel tahapan (Akun A) dan tabel Permintaan (Akun B) TIDAK ada
-- di sini — masing-masing membawa migrasinya sendiri di rentang timestamp
-- terpisah (A: 20260830*, B: 20260831*).
--
-- ---------------------------------------------------------------------------
-- KENAPA REGISTRY DIVISI
-- ---------------------------------------------------------------------------
-- Daftar `['Creative','Ads','KOL','Live Stream']` ditulis ulang di SEMBILAN
-- tempat (account.ALLOWED_DIVISIONS + BRIEF_ASSIGNABLE_DIVISIONS,
-- strategi.DISPATCH_DIVISIONS, recap.ts, plan.ts, board.ts, performance.ts, dan
-- dua salinan di web-internal). Pemilik meminta divisi baru bisa ditambahkan,
-- lalu menambahkan DUA dalam sesi yang sama (AI Optimizer, Store Operation) —
-- bukti bahwa duplikasi itu beban nyata, bukan kekhawatiran teoretis.
--
-- `nama` MEMAKAI LABEL LAMA APA ADANYA (`'Live Stream'`, bukan `'LIVE'`).
-- `briefs.assigned_division`, `role_mappings.division`, dan `wrr_divisi.divisi`
-- menyimpan string label itu ⇒ NOL migrasi data pada tiga tabel produksi. Kode
-- pendek hanya kunci registry, tidak pernah ditulis ke baris kerja.
--
-- TIGA FLAG, BUKAN SATU. Ketiga daftar lama tidak identik dan perbedaannya
-- disengaja: komentar `ALLOWED_DIVISIONS` di account.ts menyatakan memperlebar
-- himpunan itu akan MENG-CRASH comparator `normalizeTasks`
-- (`TASK_CATALOG[a.divisi].findIndex(...)` atas `undefined`). Karena itu
-- `punya_kuota_satuan` dipisah dari `brief_assignable` dan `dispatch_target` —
-- Store Operation sengaja `false` sampai `TASK_CATALOG` punya barisnya.
--
-- DUAL-HOME seperti registry prefix: tabel ini + `DIVISIONS` di
-- packages/core/src/division.ts, dijaga `division.registry.test.ts`.
--
-- ---------------------------------------------------------------------------
-- GATE (KEEP IN STEP dengan .github/workflows/ci.yml job `db-and-migrations`)
-- ---------------------------------------------------------------------------
--   tabel public  : 122 → 123 (+ division_registry)
--   entity_prefix :  35 →  36 (+ REQ, M16 §5.5)
--   sm_machines   :  23 TETAP (mesin tahapan milik Akun A, mesin REQ milik B)
--   notif_events  :  58 →  65 (+ 7 event katalog v12, satu bump untuk KEDUA stream)

-- ===========================================================================
-- 1. division_registry — divisi sebagai DATA
-- ===========================================================================
CREATE TABLE division_registry (
    code                varchar(32)  NOT NULL PRIMARY KEY,
    nama                varchar(64)  NOT NULL UNIQUE,
    aktif               boolean      NOT NULL DEFAULT true,
    brief_assignable    boolean      NOT NULL DEFAULT false,
    dispatch_target     boolean      NOT NULL DEFAULT false,
    punya_kuota_satuan  boolean      NOT NULL DEFAULT false,
    vendor_managed      boolean      NOT NULL DEFAULT false,
    urutan              integer      NOT NULL,
    created_at          timestamptz  NOT NULL DEFAULT now(),
    created_by          varchar(64)  NOT NULL DEFAULT 'SYSTEM',
    CONSTRAINT ck_division_nama   CHECK (length(btrim(nama)) > 0),
    CONSTRAINT ck_division_urutan CHECK (urutan > 0),
    -- Divisi tujuan dispatch Strategi wajib juga bisa menerima Brief — kalau
    -- tidak, AM bisa memilih divisi di STRG I-2 yang lalu menolak Brief-nya.
    CONSTRAINT ck_division_dispatch_implies_assignable
        CHECK (NOT dispatch_target OR brief_assignable)
);

COMMENT ON TABLE division_registry IS
  'M16 — registry divisi CDPS. Cermin DB dari DIVISIONS di packages/core/src/division.ts; keduanya dijaga identik oleh division.registry.test.ts. `nama` adalah label yang tersimpan di briefs.assigned_division / role_mappings.division / wrr_divisi.divisi.';
COMMENT ON COLUMN division_registry.punya_kuota_satuan IS
  'Punya entri account.TASK_CATALOG. WAJIB false kalau TASK_CATALOG belum punya barisnya — comparator normalizeTasks akan crash atas undefined.';
COMMENT ON COLUMN division_registry.vendor_managed IS
  'Dikerjakan vendor luar, bukan staff internal (Live Stream). Tahapannya adalah pelaporan progres vendor dan tidak menyentuh mesin LSS-.';

-- Default-deny total (nol policy), pola `entity_prefix` / `kualifikasi_config`:
-- dibaca hanya lewat route service-role, jadi tidak menambah baris ke ledger O48.
REVOKE ALL ON public.division_registry FROM anon;
REVOKE ALL ON public.division_registry FROM authenticated;
ALTER TABLE public.division_registry ENABLE ROW LEVEL SECURITY;

-- Enam baris pertama = divisi yang sudah ada sejak Wave 2. Flag-nya disalin
-- PERSIS dari perilaku sebelum M16 supaya penggantian sembilan literal itu
-- nol-perilaku. Dua terakhir baru (M16/M17).
INSERT INTO division_registry
    (code, nama, aktif, brief_assignable, dispatch_target, punya_kuota_satuan, vendor_managed, urutan) VALUES
    ('CREATIVE',  'Creative',        true, true, true,  true,  false, 1),
    ('ADS',       'Ads',             true, true, true,  true,  false, 2),
    ('KOL',       'KOL',             true, true, true,  true,  false, 3),
    ('LIVE',      'Live Stream',     true, true, true,  true,  true,  4),
    -- Account/Ops: divisi PIC baris Plan (M6B PC-8) yang mengerjakan pekerjaan
    -- internalnya sendiri. Brief ke sana dibaca lewat antrian /tasks generik,
    -- bukan board divisi (keputusan pemilik 2026-08-27) ⇒ bukan dispatch target
    -- Strategi dan tanpa kuota satuan.
    ('ACCOUNT',   'Account',         true, true, false, false, false, 5),
    ('OPS',       'Ops',             true, true, false, false, false, 6),
    -- M17 — optimasi SKU klien + AI video. `punya_kuota_satuan` true hanya sah
    -- karena TASK_CATALOG mendapat barisnya di commit yang sama.
    ('AI_OPT',    'AI Optimizer',    true, true, true,  true,  false, 7),
    -- M16 — daftar pekerjaan menyusul (DECISIONS.md LT-2). Sengaja TANPA kuota
    -- satuan: TASK_CATALOG belum punya barisnya. Brief tetap bisa didispatch
    -- dan Cek Brief AM tetap terukur — itulah gunanya flag dipisah.
    ('STORE_OPS', 'Store Operation', true, true, true,  false, false, 8);

-- ===========================================================================
-- 2. Prefix REQ — Permintaan terkait klien (M16 §5.5)
--    Didaftarkan di fondasi supaya dua stream tidak sama-sama menyentuh
--    registry prefix (ident.registry.test.ts memindai setiap call site dan
--    menuntut prefix terdaftar di DUA tempat).
-- ===========================================================================
INSERT INTO entity_prefix (prefix, entity_name, module) VALUES
    ('REQ', 'Permintaan (client-linked request)', 'M16')
ON CONFLICT (prefix) DO NOTHING;

-- ===========================================================================
-- 3. Katalog notifikasi v12 — SATU bump untuk SELURUH event kedua stream.
--    notification.test.ts meng-assert events() == Σ eventCount per versi, dan
--    notif_catalog.reals.test.ts meng-assert TS CATALOG ≡ notif_events
--    set-equal pada (event_type, catalog_version, resolver). Dua bump terpisah
--    memecahkan keduanya dua kali — karena itu event Akun A DAN Akun B
--    didaftarkan sekaligus di sini. Emitter dipasang stream masing-masing;
--    mendaftarkan event tanpa emitter AMAN, gate-nya membandingkan nama.
--    Description/resolver WAJIB sama persis dengan CATALOG di
--    packages/core/src/notification.ts.
-- ===========================================================================
INSERT INTO notif_catalog_versions (version, description, event_count, decision_ref) VALUES
    (12,
     'M16 Lead Time + M17 — 7 event: 3 Brief (dispatched → lead divisi tujuan, menutup lubang "dispatch tanpa notifikasi"; diterima_divisi / dikembalikan → AM pemilik), 2 tahapan (butuh_aksi_am HANYA untuk tahap ber-gate; lewat_target → PIC + lead + AM), 2 Permintaan REQ- (diajukan, jatuh_tempo). Didaftarkan sekaligus dalam SATU bump karena dua stream paralel mengerjakan emitternya masing-masing.',
     7,
     'docs/DECISIONS.md 2026-08-28 (M16) + docs/handoff/PARALEL_M16_DUA_AKUN.md F-4');

INSERT INTO notif_events (event_type, description, resolver, catalog_version) VALUES
    ('m16.brief.dispatched',        'Brief didispatch AM ke divisi — ke lead divisi tujuan',                          'leadsOfDivision', 12),
    ('m16.brief.diterima_divisi',   'Divisi menerima & memproses Brief (Cek Brief AM) — ke AM pemilik klien',         'explicit',        12),
    ('m16.brief.dikembalikan',      'Brief dikembalikan ke AM oleh divisi + alasan terstruktur — ke AM pemilik klien', 'explicit',        12),
    ('m16.tahap.butuh_aksi_am',     'Tahapan mencapai gate yang menunggu AM/klien — ke AM pemilik klien',              'explicit',        12),
    ('m16.tahap.lewat_target',      'Tahapan melewati target hari kerjanya — ke PIC + lead divisi + AM pemilik',       'explicitOrLeads', 12),
    ('m16.permintaan.diajukan',     'Permintaan (REQ-) diajukan divisi — ke tujuan (AM / Finance)',                    'explicitOrLeads', 12),
    ('m16.permintaan.jatuh_tempo',  'Permintaan (REQ-) lewat jatuh tempo 1 hari kerja — ke pengaju + tujuan + lead divisi', 'explicitOrLeads', 12);
