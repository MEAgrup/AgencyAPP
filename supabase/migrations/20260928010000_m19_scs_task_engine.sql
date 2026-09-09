-- ============================================================================
-- M19 separuh kedua — `SMO & Content Strategist`: baris pekerjaan `SCS-`,
-- taksonomi Kategori, dan mesin #34 `scs_task`.
--
-- PRD: `docs/prd/CDPS_Module19_Creative_Daily_Ops.md` §12/§13. Menutup Gap
-- B/G/I dari `CDPS_GapAnalysis_LeaderVideo_CreativeDailyOps.md` yang ditahan
-- pada 2026-09-09 menunggu satu ketokan.
--
-- ## KETOKAN YANG MEMBUKA BERKAS INI — `M19-SCS-ENGINE`, opsi (b)
--
-- Pertanyaan terbukanya satu kalimat: baris SCS memakai mesin `brief_task`
-- yang sudah ada (jadi ia Task M12 keempat), atau mesin SENDIRI #34 seperti
-- Penugasan Internal? **Pemilik memilih (b) — mesin sendiri** (2026-09-09).
--
-- Yang memaksa pertanyaan itu ada: baris `all client: Brief` di sheet TIDAK
-- punya klien, sementara **M12 §2 Rule 1 MEMBEKUKAN** Task = Asset | Creator
-- Booking | Brief-as-task, ketiganya wajib turunan Klien → Service → Brief.
-- Memasukkan baris SCS ke M12 karena itu menuntut `client_id` WAJIB — dan
-- `PREFIXES.REQ` (`packages/core/src/ident.ts`) sudah mencatat kenapa jalan itu
-- ditolak sebelumnya: melonggarkan `client_id` "akan membongkar gerbang
-- pembayaran M4/M5". Presedennya juga sudah memilih arah ini secara eksplisit,
-- `packages/domain/src/internaltask.ts:4-10`:
--
--   "KENAPA MODUL SENDIRI, BUKAN M12 — PRD M12 §2 Rule 1 membekukan Task = …
--    `task.ts` (M12) tidak disentuh sama sekali, jadi tidak ada dua definisi
--    Speed Score / turnaround."
--
-- ## BAGAIMANA DUA PERNYATAAN PRD YANG BERTENTANGAN JADI SAMA-SAMA BENAR
--
-- Draft PRD Rule 5 bilang baris SCS "masuk penuh ke Task Execution Engine" dan
-- "reuse the engine config, do not write a variant", sementara §5.4-nya memesan
-- mesin #34. Keduanya benar SEKALIGUS bila mesin #34 adalah **salinan verbatim
-- konfigurasi `brief_task`** di bawah namanya sendiri: state yang SAMA, edge
-- yang SAMA, gerbang `require_lead` yang SAMA. Yang berbeda hanya NAMA mesin,
-- karena `sm_transition` mengunci mesin ke pasangan entityType/table dan gerbang
-- roles-nya per-mesin.
--
-- Konsekuensi yang justru jadi alasan utama pilihan ini: `task.computeMetrics()`
-- (sudah `export`ed dan PURE) membaca nama state `[In Progress]`/`[Approved]`/
-- `[Revision Requested]`/`[Blocked]`/`[Submitted]`/`[In Review]` dari
-- `audit_log`. Kosakata yang identik ⇒ modul SCS MEMANGGIL rumus Speed Score
-- yang sudah ada alih-alih menulis ulang. Kalau seseorang kelak "merapikan"
-- nama state di sini, Speed Score seluruh baris SCS diam-diam jadi null —
-- dijaga `scs.registry.test.ts` yang membandingkan HIMPUNAN state kedua mesin.
--
-- ## KENAPA GATE NAIK TIGA DARI EMPAT
--
--   tabel public   153 → 155   `scs_kategori`, `scs_tasks`
--   entity_prefix   42 →  43   `SCS`
--   sm_machines      33 →  34   mesin #34 `scs_task` (STATE_MACHINES.md §34)
--   notif_events     73 →  73   TETAP — nol event, lihat bagian 6.
--
-- Angka ABSOLUT, bukan delta, dan dinaikkan di `scripts/db-rebuild.sh` DAN
-- `.github/workflows/ci.yml` di commit yang sama dengan berkas ini.
--
-- ## APA YANG SENGAJA TIDAK ADA DI SINI
--
-- **Nol edge pembatalan.** `brief_task` punya `[Cancelled — Service Voided]`;
-- baris SCS tidak punya Service, jadi state itu tak punya arti di sini dan
-- menyalinnya berarti menjanjikan sebab yang tidak pernah terjadi. Nama state
-- pembatalan BARU juga tidak dikarang — ia butuh ketokan pemilik lebih dulu,
-- persis sikap yang diambil mesin #21 `internal_task` terhadap edge "buka
-- kembali" yang juga tidak ada. Salah catat hari ini dicabut lewat DELETE
-- selama baris masih `[To Do]` (bagian 7).
--
-- **Nol kolom jangkar waktu** (`dimulai_pada`/`disubmit_pada`/`disetujui_pada`).
-- Turnaround, Speed Score, dan jumlah revisi SEMUANYA diturunkan dari
-- `audit_log` lewat `computeMetrics` (aturan rumah #3/#4) — persis seperti Asset
-- dan Brief-as-task. Menambah kolom jangkar di sini akan melahirkan jangkar
-- KEDUA yang bisa menyimpang dari log.
--
-- **Nol 24 baris Kategori di seed.** Taksonomi itu DATA, bukan skema: ia hidup
-- di `scs_kategori` yang dikelola lead Creative lewat layar admin. Yang di-seed
-- hanya empat Kategori yang benar-benar TERBUKTI di sumber (`Script`,
-- `Upload & Checklist`, `Brief` dari sheet; `Koordinasi` dari ketokan Gap H-1),
-- karena mengarang 21 nama sisanya berarti menaruh tebakan di dalam migrasi —
-- tempat yang paling mahal untuk salah. Lihat `docs/DECISIONS.md` 2026-09-09
-- (`M19-SCS-KATEGORI-DATA`).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Prefix registry (M6A §7) — dual-home dengan `PREFIXES` di
--    `packages/core/src/ident.ts`, dipaksa identik oleh `ident.registry.test.ts`.
--
--    Sengaja BUKAN `TSK-` (Penugasan Internal): itu tugas yang ATASAN berikan,
--    nol klien, nol Kategori, nol qty. Dan sengaja BUKAN `AST-`/`BRF-`: baris
--    SCS bukan turunan Brief dan bukan deliverable Asset.
-- ---------------------------------------------------------------------------
INSERT INTO entity_prefix (prefix, entity_name, module) VALUES
    ('SCS', 'Baris pekerjaan SMO & Content Strategist', 'M19');

-- ---------------------------------------------------------------------------
-- 2. Mesin #34 `scs_task` — SALINAN VERBATIM konfigurasi `brief_task`.
--
--    Setiap baris di bawah ini punya kembarannya di
--    `20260723055732_statemachine.sql` (dan edge lead-QC di
--    `20260922200000_b4_gerbang_lead_creative.sql`). Itu bukan duplikasi yang
--    lupa di-refactor: `sm_machines` adalah DATA, dan dua entitas berbeda yang
--    berbagi satu baris mesin berarti gerbang role salah satunya tidak bisa
--    digeser tanpa menggeser yang lain.
--
--    [To Do] → [In Progress] → [Submitted] → [In Review] → [Approved]  (terminal)
--    [Submitted]           → [Revision Requested]   require_lead  (QC lead, B4)
--    [In Review]           → [Revision Requested]
--    [Revision Requested]  → [In Progress]
--    [In Progress]        ↔ [Blocked]               require_lead (dua arah)
-- ---------------------------------------------------------------------------
INSERT INTO sm_machines (name, initial_state, auto_computed, flags) VALUES
    ('scs_task', '[To Do]', false, '{}');

INSERT INTO sm_terminal_states (machine, state) VALUES
    ('scs_task', '[Approved]');

INSERT INTO sm_edges (machine, from_state, to_state, require_lead) VALUES
    ('scs_task', '[To Do]',              '[In Progress]',        false),
    ('scs_task', '[In Progress]',        '[Submitted]',          false),
    ('scs_task', '[Submitted]',          '[In Review]',          false),
    ('scs_task', '[Submitted]',          '[Revision Requested]', true),
    ('scs_task', '[In Review]',          '[Approved]',           false),
    ('scs_task', '[In Review]',          '[Revision Requested]', false),
    ('scs_task', '[Revision Requested]', '[In Progress]',        false),
    ('scs_task', '[In Progress]',        '[Blocked]',            true),
    ('scs_task', '[Blocked]',            '[In Progress]',        true);

-- ---------------------------------------------------------------------------
-- 3. `scs_kategori` — taksonomi Kategori. Registry ber-baris, pola
--    `division_registry`/`studios`: tiap sifat punya kolomnya sendiri.
--
--    `is_standing` adalah sifat KATEGORI, bukan sifat baris (Gap G). Sebuah
--    Kategori standing adalah pekerjaan yang berulang tiap hari dan bukan
--    deliverable yang diseri: ia dihitung sebagai VOLUME, tidak masuk seri
--    deliverable, dan Speed Score-nya "N/A".
--
--    Itu sebabnya `ck_kategori_standing_tanpa_sla` ada: standing ⇒ `sla_jam`
--    WAJIB NULL. `computeMetrics(evs, null)` mengembalikan Speed Score "N/A"
--    (bukan 0, bukan galat) — jadi aturan "standing tidak di-SLA-kan" ditegakkan
--    oleh SKEMA, bukan oleh kesopanan pemakai layar admin.
--
--    `sub_type` sengaja TEKS BEBAS, bukan CHECK constraint. Delapan Sub Type di
--    worksheet Leader adalah label operasional yang masih bergerak; mengunci
--    delapan nama di constraint berarti satu migrasi untuk setiap koreksi
--    taksonomi. Kalau ia kelak stabil, ia naik jadi enum tertutup + baris
--    `DECISIONS.md` — bukan sebaliknya.
-- ---------------------------------------------------------------------------
CREATE TABLE scs_kategori (
    kode        varchar(48)  NOT NULL PRIMARY KEY,
    nama        varchar(191) NOT NULL UNIQUE,
    sub_type    varchar(64)  NULL,
    is_standing boolean      NOT NULL DEFAULT false,
    -- SLA Target dalam JAM, satuan yang sama dengan `briefs.sla_target_hours`
    -- supaya `computeMetrics` menerimanya tanpa konversi. NULL = tidak di-SLA-kan.
    sla_jam     integer      NULL,
    aktif       boolean      NOT NULL DEFAULT true,
    urutan      integer      NOT NULL,
    created_at  timestamptz  NOT NULL DEFAULT now(),
    created_by  varchar(64)  NOT NULL DEFAULT 'SYSTEM',
    updated_at  timestamptz  NOT NULL DEFAULT now(),

    CONSTRAINT ck_kategori_nama   CHECK (length(btrim(nama)) > 0),
    CONSTRAINT ck_kategori_urutan CHECK (urutan > 0),
    CONSTRAINT ck_kategori_sla    CHECK (sla_jam IS NULL OR sla_jam > 0),
    CONSTRAINT ck_kategori_standing_tanpa_sla
        CHECK (NOT is_standing OR sla_jam IS NULL)
);

CREATE TRIGGER trg_scs_kategori_updated_at BEFORE UPDATE ON scs_kategori
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Empat Kategori yang TERBUKTI di sumber. Sisanya diisi lead Creative lewat
-- layar admin — lihat kepala berkas, "Nol 24 baris Kategori di seed".
--
--   Script             — deliverable naskah Content Strategist, di-SLA-kan.
--   Upload & Checklist — baris HARIAN di sheet ("sagata: qty 1" tiap hari) ⇒
--                        standing ⇒ nol SLA ⇒ Speed Score N/A.
--   Brief              — `is_standing = false`, dan itu KETOKAN, bukan default:
--                        ketokan pemilik 2026-09-09 berbunyi "brief SMO
--                        sebetulnya membantu team lain menyelesaikan task dari
--                        AM". Jadi baris Brief SMO bukan pekerjaan yang berulang
--                        tanpa tujuan (yang akan membuatnya standing) melainkan
--                        DUKUNGAN kepada divisi lain — dan yang membedakannya
--                        dari Brief milik Strategist adalah kolom
--                        `mendukung_divisi` pada barisnya, bukan flag pada
--                        Kategorinya. Menandainya standing akan membuat
--                        deliverable Brief Strategist yang sungguhan HILANG dari
--                        seri deliverable.
--   Koordinasi         — ketokan Gap H-1 (jurnal koordinasi Content Creator):
--                        "jalan rekomendasi" ⇒ ia satu KATEGORI di sini, BUKAN
--                        entitas ketiga. Isinya baris bebas seperti "koordinasi
--                        dengan Rani soal properti shoot"; tidak di-review
--                        siapa pun ⇒ standing ⇒ nol SLA.
INSERT INTO scs_kategori (kode, nama, sub_type, is_standing, sla_jam, urutan) VALUES
    ('SCRIPT',           'Script',             'Content',      false, 24,   1),
    ('BRIEF',            'Brief',              'Content',      false, 24,   2),
    ('UPLOAD_CHECKLIST', 'Upload & Checklist', 'Operasional',  true,  NULL, 3),
    ('KOORDINASI',       'Koordinasi',         'Operasional',  true,  NULL, 4);

COMMENT ON TABLE scs_kategori IS
  'M19 §13 / Gap G — taksonomi Kategori baris SCS. Registry ber-baris yang '
  'dikelola lead Creative: taksonomi adalah DATA, bukan skema. is_standing '
  'adalah sifat KATEGORI (pekerjaan berulang harian, dihitung sebagai volume, '
  'Speed Score N/A), dan standing ⇒ sla_jam WAJIB NULL.';

COMMENT ON COLUMN scs_kategori.sub_type IS
  'Label Sub Type dari worksheet Leader. SENGAJA teks bebas, bukan enum '
  'tertutup: delapan label itu masih bergerak, dan mengunci mereka di CHECK '
  'berarti satu migrasi per koreksi taksonomi.';

COMMENT ON COLUMN scs_kategori.is_standing IS
  'Kategori standing = pekerjaan berulang harian, BUKAN deliverable yang '
  'diseri. Menandai sebuah deliverable nyata sebagai standing membuatnya '
  'HILANG SEPENUHNYA dari seri deliverable — kesalahan yang lebih buruk '
  'daripada sebaliknya, karena itu default-nya false.';

-- ---------------------------------------------------------------------------
-- 4. `scs_tasks` — satu baris pekerjaan `SCS-YYYYMM-NNNN`, di-mint HANYA
--    sesudah validasi field wajib lolos (aturan rumah #1).
--
--    ## `client_id` NULLABLE, DAN ITU SELURUH ALASAN MODUL INI ADA
--
--    Baris `all client: Brief` di sheet tidak punya klien. Ia bukan cacat data:
--    SMO memang mencatat pekerjaan yang berlaku lintas klien. Tiga jalan untuk
--    memaksanya masuk M12 semuanya lebih mahal daripada tabel ini (klien palsu
--    "ALL CLIENT" yang ikut ke setiap health score dan setiap rekap; `client_id`
--    diwajibkan sehingga barisnya kembali dicatat di luar CDPS; atau amandemen
--    M12 §2 Rule 1 yang memaksa peninjauan setiap modul yang bergantung pada
--    invarian "setiap Task punya klien yang membayar").
--
--    KONSEKUENSINYA YANG HARUS DIINGAT: baris ber-`client_id` NULL TIDAK boleh
--    ikut ke angka mana pun yang per-klien (health score M13, rekap klien M6D,
--    laporan Client Portal M15). Yang menjaganya adalah `client_id IS NOT NULL`
--    pada setiap query per-klien — dan tabel ini nol view, jadi tidak ada
--    jalan tersembunyi ke sana.
--
--    ## `mendukung_divisi` — jawaban ketokan 2026-09-09
--
--    "brief SMO sebetulnya membantu team lain menyelesaikan task dari AM":
--    sebuah baris SCS bisa berupa DUKUNGAN kepada divisi lain, bukan
--    deliverable milik SCS sendiri. Kolom ini yang merekamnya, dan ia yang
--    membedakan Brief SMO dari Brief Strategist tanpa memecah Kategorinya.
--
--    Ia ber-FK ke `division_registry`, BUKAN ke `briefs`. Menaut ke Brief akan
--    memberi baris ini induk Brief — dan itu akan menuntut barisnya di
--    `HALAMAN_BRIEF` (`web-internal/src/lib/stage-panel-coverage.test.ts`) plus
--    membangunkan seluruh rantai gerbang Service/pembayaran yang justru
--    dihindari `client_id` nullable di atas.
-- ---------------------------------------------------------------------------
CREATE TABLE scs_tasks (
    id               varchar(32)  NOT NULL PRIMARY KEY,   -- SCS-YYYYMM-NNNN

    tanggal          date         NOT NULL,               -- hari kerja baris ini
    kategori_kode    varchar(48)  NOT NULL,
    judul            text         NOT NULL,

    client_id        varchar(32)  NULL,                   -- NULL = baris "all client"
    mendukung_divisi varchar(32)  NULL,                   -- dukungan ke divisi lain

    assigned_pic     varchar(64)  NOT NULL,
    target_qty       integer      NOT NULL,

    status           varchar(32)  NOT NULL DEFAULT '[To Do]',
    link_hasil       text         NOT NULL DEFAULT '',
    catatan          text         NOT NULL DEFAULT '',

    created_at       timestamptz  NOT NULL DEFAULT now(),
    created_by       varchar(64)  NOT NULL,
    updated_at       timestamptz  NOT NULL DEFAULT now(),

    CONSTRAINT fk_scs_kategori FOREIGN KEY (kategori_kode)
        REFERENCES scs_kategori (kode),
    CONSTRAINT fk_scs_client   FOREIGN KEY (client_id)   REFERENCES clients (id),
    CONSTRAINT fk_scs_divisi   FOREIGN KEY (mendukung_divisi)
        REFERENCES division_registry (code),
    CONSTRAINT fk_scs_pic      FOREIGN KEY (assigned_pic) REFERENCES employees (employee_id),
    CONSTRAINT fk_scs_creator  FOREIGN KEY (created_by)   REFERENCES employees (employee_id),

    CONSTRAINT ck_scs_judul      CHECK (length(btrim(judul)) > 0),
    CONSTRAINT ck_scs_target_qty CHECK (target_qty > 0),
    -- Pasangan gerbang domain `[link hasil kerja wajib diisi untuk submit]`.
    -- Ditegakkan DUA kali dengan sengaja: pesan BI datang dari domain, tapi
    -- jalur tulis mana pun yang melewatinya tetap ditolak DB. Cermin
    -- `ck_internal_tasks_selesai`, dan cermin M7 yang mewajibkan `output_link`
    -- pada `[Submitted]`.
    --
    -- Daftarnya POSITIF (state yang MENUNTUT link), bukan negatif (state yang
    -- dikecualikan), dan itu bukan gaya: versi negatif `status IN ('[To Do]',
    -- '[In Progress]')` melewatkan `[Blocked]` — sebuah state KERJA yang
    -- dicapai dari `[In Progress]` justru SEBELUM ada hasil apa pun, sehingga
    -- setiap `blockScsTask` gagal dengan galat constraint mentah. Ditemukan
    -- dengan MENJALANKAN tesnya, bukan dengan membaca ulang.
    CONSTRAINT ck_scs_submit_butuh_link CHECK (
        status NOT IN ('[Submitted]', '[In Review]', '[Approved]', '[Revision Requested]')
        OR btrim(link_hasil) <> '')
);

CREATE INDEX idx_scs_pic_tanggal   ON scs_tasks (assigned_pic, tanggal);
CREATE INDEX idx_scs_tanggal_status ON scs_tasks (tanggal, status);
CREATE INDEX idx_scs_kategori      ON scs_tasks (kategori_kode, tanggal);
-- Partial: baris "all client" (client_id NULL) tidak punya tempat di sini, dan
-- indeks partial-nya yang membuat query per-klien murah TANPA memuat mereka.
CREATE INDEX idx_scs_client        ON scs_tasks (client_id) WHERE client_id IS NOT NULL;
CREATE INDEX idx_scs_creator       ON scs_tasks (created_by);

CREATE TRIGGER trg_scs_tasks_updated_at BEFORE UPDATE ON scs_tasks
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE scs_tasks IS
  'M19 §13 / Gap B — satu baris pekerjaan SMO & Content Strategist. Mesin #34 '
  'scs_task, kosakata state IDENTIK brief_task supaya task.computeMetrics() '
  'dipakai ulang (nol definisi kedua Speed Score). client_id NULLABLE: baris '
  '"all client" di sheet tidak punya klien, dan M12 §2 Rule 1 membekukan Task '
  'sebagai turunan Klien→Service→Brief — itulah kenapa ini entitas sendiri.';

COMMENT ON COLUMN scs_tasks.client_id IS
  'NULL = baris lintas-klien ("all client" di sheet). Baris ber-NULL TIDAK '
  'boleh ikut ke angka per-klien mana pun (M13 health score, rekap M6D, '
  'Client Portal M15): setiap query per-klien wajib memfilter client_id IS NOT '
  'NULL.';

COMMENT ON COLUMN scs_tasks.mendukung_divisi IS
  'Divisi yang baris ini BANTU selesaikan pekerjaannya (ketokan pemilik '
  '2026-09-09: "brief SMO sebetulnya membantu team lain menyelesaikan task '
  'dari AM"). Ber-FK ke division_registry dan BUKAN ke briefs: induk Brief akan '
  'membangunkan seluruh rantai gerbang Service/pembayaran yang justru dihindari '
  'client_id nullable.';

COMMENT ON COLUMN scs_tasks.status IS
  'Ditulis EKSKLUSIF oleh sm_transition (mesin scs_task, #34). Nol kolom '
  'jangkar waktu di tabel ini: turnaround, Speed Score, dan jumlah revisi '
  'diturunkan dari audit_log lewat task.computeMetrics() — aturan rumah #3/#4.';

-- ---------------------------------------------------------------------------
-- 5. RLS.
--
--    `GRANT SELECT ... TO authenticated` WAJIB dan bukan formalitas: tabel yang
--    lahir SESUDAH `20260723064438_rls_baseline.sql` tidak tersentuh grant-loop
--    di sana, dan tanpa grant `readAsActor` (O37) gagal "permission denied"
--    SEBELUM satu policy pun dievaluasi.
--
--    `scs_tasks_select` memikul scope baris yang sama dengan `prod_slots`:
--    OD/Director di mana pun · PIC baris itu · pencatatnya · lead divisi
--    Creative. Peran `SMO & Content Strategist` duduk DI BAWAH divisi Creative
--    (ketokan 2026-09-09), jadi lengan `jwt_division() = 'Creative'` sudah
--    mencakupnya — nol baris `division_registry` baru, nol level klaim baru.
--
--    SENGAJA BUKAN `private.jwt_division_owns_client(client_id)`: helper itu
--    true bila salah satu PIC KLIEN sedivisi dengan aktor (orang Sales dan
--    Account), jadi untuk lead Creative ia SELALU false. Dan di sini ia lebih
--    buruk lagi — baris "all client" ber-`client_id` NULL akan membuatnya NULL,
--    sehingga baris yang paling penting bagi SMO justru tak terlihat siapa pun.
--
--    NOL lengan `mendukung_divisi`. Menambahkannya berarti lead divisi lain
--    boleh membaca baris kerja Creative "karena dibantu" — sebuah izin yang
--    tidak pernah diketok siapa pun. Yang dibutuhkan divisi lain adalah
--    pekerjaannya SENDIRI, dan itu sudah mereka lihat.
--
--    `scs_kategori_select` TIDAK punya lengan lead/divisi dan karena itu masuk
--    ledger O48 (`supabase/tests/rls_checks.sql`) dengan alasan tertulis:
--    isinya nama-nama Kategori, dan setiap pembuka layar antrean butuh
--    daftarnya untuk merender filter — termasuk pada hari nol baris. Cermin
--    `studios_select` dan `master_service_duration_options_select`.
--
--    Nol write policy di keduanya: jalur tulis CDPS berjalan service-role.
-- ---------------------------------------------------------------------------
REVOKE ALL ON public.scs_kategori FROM anon;
REVOKE ALL ON public.scs_kategori FROM authenticated;
GRANT SELECT ON public.scs_kategori TO authenticated;
ALTER TABLE public.scs_kategori ENABLE ROW LEVEL SECURITY;

CREATE POLICY scs_kategori_select ON public.scs_kategori FOR SELECT TO authenticated
USING (true);

REVOKE ALL ON public.scs_tasks FROM anon;
REVOKE ALL ON public.scs_tasks FROM authenticated;
GRANT SELECT ON public.scs_tasks TO authenticated;
ALTER TABLE public.scs_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY scs_tasks_select ON public.scs_tasks FOR SELECT TO authenticated
USING (jwt_can_read_all()
       OR jwt_employee_id() = assigned_pic
       OR jwt_employee_id() = created_by
       OR (jwt_is_lead() AND jwt_division() = 'Creative'));

-- ---------------------------------------------------------------------------
-- 6. Notifikasi: NOL event baru, dan itu keputusan.
--
--    Preseden v9 (`internal_tasks`) dan M18: sebuah event didaftarkan BERSAMA
--    emitternya, karena mendaftarkan event yang tak pernah diemisikan membuat
--    katalog berbohong (invariant O55 menghitung
--    SUM(event_count) = COUNT(notif_events), jadi baris katalog kosong pun
--    bukan pilihan).
--
--    Antrean SCS adalah LAYAR yang dibuka lead Creative dan PIC-nya setiap
--    hari — sama seperti antrean M7. Kalau kelak diminta "beri tahu saya saat
--    ada yang minta revisi", event-nya lahir bersama job/emitter-nya di migrasi
--    tersendiri, bukan didaftarkan lebih awal di sini.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 7. Riwayat tidak bisa disunting.
--
--    `scs_tasks_beku()` mengunci apa yang membuat angka turunan bisa dipercaya:
--    identitas baris, tanggalnya, Kategorinya, PIC-nya, target qty-nya, dan
--    pencatatnya SEMUANYA beku sesudah baris meninggalkan `[To Do]`.
--
--    Kenapa `[To Do]` yang jadi garisnya, bukan "beku sejak lahir": baris SCS
--    diketik cepat di awal hari dan salah ketik nyata (Kategori keliru, PIC
--    keliru) harus bisa diperbaiki SEBELUM ada satu pun jejak pengerjaan.
--    Sesudah `[In Progress]`, log-nya sudah punya jangkar `[In Progress]` — dan
--    memindahkan Kategori sesudah itu memindahkan SLA yang dipakai menghitung
--    Speed Score baris yang sedang dinilai. Persis mode gagal yang dicegah
--    `internal_tasks: due_date beku`.
--
--    `link_hasil` beku sesudah `[Approved]`: mengganti bukti sesudah disetujui
--    adalah mengedit riwayat.
--
--    DELETE tetap boleh — tapi hanya pada `[To Do]` (lihat trigger kedua),
--    karena itulah pengganti edge pembatalan yang sengaja tidak ada.
-- ---------------------------------------------------------------------------
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

CREATE TRIGGER trg_scs_tasks_beku
    BEFORE UPDATE ON scs_tasks
    FOR EACH ROW EXECUTE FUNCTION scs_tasks_beku();

-- Pengganti edge pembatalan yang sengaja tidak ada: baris yang belum disentuh
-- boleh dicabut, baris yang sudah punya jejak pengerjaan TIDAK. Tanpa trigger
-- ini, "hapus lalu catat ulang" jadi cara termudah menghapus keterlambatan dan
-- revisi dari catatan performa seseorang.
CREATE OR REPLACE FUNCTION scs_tasks_hapus_hanya_todo()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    IF OLD.status <> '[To Do]' THEN
        RAISE EXCEPTION 'scs_tasks: hanya baris [To Do] boleh dihapus — baris % sudah %', OLD.id, OLD.status;
    END IF;
    RETURN OLD;
END;
$$;

CREATE TRIGGER trg_scs_tasks_hapus_hanya_todo
    BEFORE DELETE ON scs_tasks
    FOR EACH ROW EXECUTE FUNCTION scs_tasks_hapus_hanya_todo();

-- `scs_kategori` tidak boleh kehilangan baris yang sudah dipakai: FK
-- `fk_scs_kategori` sudah menjaganya (nol ON DELETE CASCADE, nol SET NULL).
-- Menonaktifkan Kategori dilakukan lewat `aktif = false`, bukan DELETE —
-- baris historis yang menunjuknya harus tetap bisa dibaca.
