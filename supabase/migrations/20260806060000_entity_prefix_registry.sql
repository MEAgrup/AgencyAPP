-- CDPS — Module 6A §7: registry prefix entitas (`entity_prefix`) + pendaftaran
-- STRG / PLAN / VND.
--
-- M6A §7 menyebut ini sebagai "dev action BEFORE coding": backfill registry dari
-- migrasi yang sudah ada, BARU sesudah itu masukkan `STRG` dan `PLAN`. Alasannya
-- bukan formalitas — ruang prefix tiga huruf adalah tempat tabrakan hidup
-- (`SVC`, `CPL`, `BRF`, `CLT`…), dan satu-satunya cara menjamin tidak tabrakan
-- adalah PK, bukan kedisiplinan penulis migrasi.
--
-- Dua mekanisme yang diminta PRD:
--   1) tabel ini (PK `prefix` ⇒ duplikat mustahil);
--   2) tes CI yang memindai call site pembuat ID dan gagal kalau ada prefix yang
--      tidak terdaftar / dua entitas jatuh ke prefix yang sama
--      (`packages/core/src/ident.registry.test.ts`).
--
-- Hasil backfill — TIGA temuan, sebab itulah tes CI-nya dibutuhkan:
--   * `DEMO` dipakai `packages/domain/src/demo.ts` lewat `ex.ident.identNext('DEMO', …)`
--     (string mentah, bukan wrapper bertipe `nextId`), jadi ia MEMBUAT ID tanpa
--     pernah lewat `isRegisteredPrefix`. Registry TS malah mencatat `DBR`
--     ("Demo Block Request") yang tidak pernah dipakai satu call site pun.
--   * `ACT` (prospect activity, `activity.ts:210`) dan `LDR` (lead delete
--     request, `leads.ts:1455`) sama: ada di `docs/DATA_MODEL.md` §1, dipakai di
--     produksi, TIDAK ada di `PREFIXES`.
--   Ketiganya didaftarkan di sini sebagai keadaan as-built, dan call site-nya
--   dipindah ke wrapper bertipe pada commit yang sama.
--
-- `STRG` / `PLAN` / `VND` semuanya BEBAS (yang terpakai adalah `STR`, entitas
-- Strategy & Plan M6 §4 yang lama) ⇒ fallback `STGY` / `PPRD` di M6A §7 TIDAK
-- dipakai. Registry-lah yang memutuskan, dan registry mengatakan tiga-tiganya
-- kosong.
--
-- FORMAT ID — deviasi terhadap M6A/6B/6C, dicatat di `docs/DECISIONS.md`
-- 2026-08-06: PRD menulis `STRG-YYYY-NNNNN` / `PLAN-YYYY-NNNNN` /
-- `VND-YYYY-NNNNN` (tahun 4 digit + urutan 5 digit), sedangkan CLAUDE.md #1
-- menyatakan `PREFIX-YYYYMM-NNNN` sebagai konvensi rumah non-negotiable dan
-- `ident_next` hanya bisa memproduksi bentuk itu. Memakai bentuk PRD berarti
-- mem-fork mesin ident untuk tiga entitas — jadi konvensi rumah yang dipakai
-- dan divergensinya dicatat, bukan disembunyikan.

CREATE TABLE entity_prefix (
    prefix      varchar(16)  NOT NULL PRIMARY KEY,
    entity_name text         NOT NULL,
    module      varchar(32)  NOT NULL,
    added_at    timestamptz  NOT NULL DEFAULT now()
);

COMMENT ON TABLE entity_prefix IS
  'M6A §7 — registry prefix ID entitas. PK menjamin tidak ada dua entitas '
  'memakai prefix yang sama. Harus tetap sinkron dengan PREFIXES di '
  'packages/core/src/ident.ts (dijaga packages/core/src/ident.registry.test.ts).';

-- Backfill: keadaan as-built per 2026-08-06 — 23 prefix dari PREFIXES
-- (packages/core/src/ident.ts) + 3 yang dipakai call site tapi belum terdaftar.
INSERT INTO entity_prefix (prefix, entity_name, module) VALUES
    ('LEAD', 'Lead record',                        'M1'),
    ('PRSP', 'Prospect attempt',                   'M0/M1'),
    ('ACT',  'Prospect activity',                  'M0/M1'),
    ('LDR',  'Lead delete request',                'M1'),
    ('NEG',  'Negotiation proposal',               'M0'),
    ('CMP',  'Campaign (acquisition)',             'M3'),
    ('CLI',  'Client',                             'M0→M4'),
    ('TRX',  'Transaction',                        'M0→M5'),
    ('INST', 'Installment',                        'M5'),
    ('SVC',  'Service',                            'M0→M6'),
    ('STR',  'Strategy & Plan (M6 §4, lama)',      'M6'),
    ('BRF',  'Brief',                              'M6'),
    ('AST',  'Asset (Creative)',                   'M7'),
    ('ADC',  'Ad Campaign (client-facing)',        'M8'),
    ('MTR',  'Metric Entry',                       'M8'),
    ('OPT',  'Optimization Log',                   'M8'),
    ('BKG',  'Creator Booking',                    'M9'),
    ('CPR',  'Creator Payment Request',            'M9→M5'),
    ('LSS',  'Live Stream Session',                'M10'),
    ('DEP',  'Dependency',                         'M11'),
    ('CPL',  'Complaint',                          'M6'),
    ('CHR',  'Client Health Report Snapshot',      'M13'),
    ('PERF', 'Performance Score',                  'M14'),
    ('MSV',  'Master Service List version',        'Admin'),
    ('DBR',  'Demo Block Request',                 'demo'),
    ('DEMO', 'Demo task',                          'demo');

-- Baru SESUDAH backfill: prefix M6A/6B/6C.
INSERT INTO entity_prefix (prefix, entity_name, module) VALUES
    ('STRG', 'Strategi (Full Store Management)',   'M6A'),
    ('PLAN', 'Plan period',                        'M6B'),
    ('VND',  'Vendor',                             'M6A');

-- ---------------------------------------------------------------------------
-- RLS — tabel dibuat SETELAH 20260723064438_rls_baseline, jadi loop grant di
-- sana tidak menyentuhnya. Ini tabel konfigurasi internal murni sekelas
-- `sm_machines` / `notif_events`: RLS aktif, TANPA policy (default-deny),
-- authenticated tidak diberi SELECT. Diakses hanya oleh fungsi SECURITY
-- DEFINER (owner postgres, BYPASSRLS) & service_role — tidak ada layar UI yang
-- membacanya, dan `ident_next` sudah SECURITY DEFINER.
-- ---------------------------------------------------------------------------
REVOKE ALL ON public.entity_prefix FROM anon;
REVOKE ALL ON public.entity_prefix FROM authenticated;
ALTER TABLE public.entity_prefix ENABLE ROW LEVEL SECURITY;
