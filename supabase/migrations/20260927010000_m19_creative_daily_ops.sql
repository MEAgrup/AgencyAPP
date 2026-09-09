-- ============================================================================
-- M19 — Creative Daily Ops: slot produksi harian (`SLOT-`), studio, dan
-- ketidaktersediaan produksi PIC.
--
-- PRD: `docs/prd/CDPS_Module19_Creative_Daily_Ops.md`. Ketokan pemilik
-- 2026-09-09 (D1 "entitas ringan PROD-SLOT, bukan view", D3 "warn only",
-- D4 "Leader yang input", D5 "dashboard Leader, di luar M14", D8 "konten
-- internal di luar cakupan") — realisasi dari `docs/DECISIONS.md` K-1
-- (2026-09-07), yang menyisihkan "jadwal harian leader" sebagai wave sendiri.
--
-- Sampai hari ini Leader Video menyusun ULANG jadwal produksi dengan tangan
-- setiap hari di Google Sheets (4.154 baris, Jan–Sep 2026). CDPS memodelkan
-- Brief → Asset (M7) tapi tidak punya satu pun tempat untuk hari × studio ×
-- PIC × slot waktu, tidak tahu seorang PIC sedang cuti, dan tidak punya rumah
-- untuk "apakah PIC menyelesaikan yang dijadwalkan HARI INI".
--
-- ## KENAPA GATE NAIK DUA DARI EMPAT
--
--   tabel public   150 → 153   `studios`, `prod_slots`, `pic_unavailability`
--   entity_prefix   41 →  42   `SLOT`
--   sm_machines      33 → 33   TETAP — `PROD-SLOT` sengaja TANPA mesin status
--                              (PRD Rule 1/D1: ia catatan RENCANA, bukan
--                              deliverable). Memberinya lifecycle berarti mesin
--                              paralel kedua di sebelah `brief_task`, dan
--                              eksekusi/review tetap milik Asset (M7/M12).
--   notif_events     73 → 73   TETAP — modul ini nol event. Konflik studio dan
--                              PIC tidak tersedia adalah PERINGATAN INLINE di
--                              layar perencana, bukan notifikasi ke orang lain.
--                              Mendaftarkan event yang tak pernah diemisikan
--                              membuat katalog berbohong (preseden v9
--                              `internal_tasks`, dan M18).
--
-- Angka-angka itu ABSOLUT, bukan delta, dan dinaikkan di `scripts/db-rebuild.sh`
-- DAN `.github/workflows/ci.yml` di commit yang sama dengan berkas ini —
-- menaikkan salah satunya saja memberi suite hijau palsu (repo sudah kena:
-- "CI merah dengan `expected 14 machines` sementara seluruh test suite hijau").
--
-- ## APA YANG SENGAJA TIDAK ADA DI SINI
--
-- **Nol `EXCLUDE USING gist` untuk tumpang-tindih studio.** Jawaban Postgres
-- yang "benar" untuk "jangan sampai dua slot bertumpang di satu studio" adalah
-- exclusion constraint — dan di sini itu justru SALAH, karena ia MEMBLOKIR.
-- D3 mengetok warn-only: Leader menerima tumpang-tindih dengan sadar ("dua
-- shoot berbagi sudut ruangan yang sama"). Pemeriksaannya karena itu query
-- biasa di lapisan domain yang mengembalikan PERINGATAN, dan barisnya tetap
-- tersimpan. Peninjau berikutnya akan menanyakan kenapa constraint-nya tidak
-- ada; jawabannya paragraf ini.
--
-- **Nol kolom persentase / sisa / "selesai hari sama".** Penyelesaian hari-sama
-- (`actual_qty ÷ target_qty`), sisa (`target_qty − actual_qty`), dan slot fill
-- semuanya DITURUNKAN saat baca (aturan rumah #4, PRD §5.5). Pembagian nol
-- dirender '—', bukan error (aturan rumah #7).
--
-- **Nol auto-rollover sisa qty.** Slot yang tercapai 9 dari 15 mempertahankan
-- angka 9/15-nya; Leader membuat slot BARU besok (PRD Flow 7). Menyalin sisa
-- otomatis berarti angka slot pertama bisa disunting sesudah faktanya.
--
-- **Nol kolom `alasan` bebas untuk cuti, nol approval, nol saldo, nol
-- entitlement.** Lihat bagian 4 — batas HRIS.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Prefix registry (M6A §7) — dual-home dengan `PREFIXES` di
--    `packages/core/src/ident.ts`, dijaga `packages/db/src/ident.registry.test.ts`
--    (perbandingan SET-EQUAL, bukan hitungan).
--
--    HANYA `SLOT`. Prefix `SCS` (baris SMO & Content Strategist) SENGAJA TIDAK
--    didaftarkan di sini: bentuknya masih pertanyaan terbuka `M19-SCS-ENGINE`
--    di `docs/DECISIONS.md` §Open (M12 §2 Rule 1 membekukan Task = Asset |
--    Creator Booking | Brief-as-task, sementara barisnya ber-`client_id`
--    nullable). Mendaftarkan prefix untuk entitas yang bentuknya belum diketok
--    berarti registry menjanjikan sesuatu yang belum ada.
-- ---------------------------------------------------------------------------
INSERT INTO entity_prefix (prefix, entity_name, module) VALUES
    ('SLOT', 'Slot produksi harian Creative', 'M19');

-- ---------------------------------------------------------------------------
-- 2. Mesin status: TIDAK ADA. Lihat kepala berkas.
--
--    Nol baris `sm_machines` / `sm_edges` / `sm_terminal_states`, dan nol
--    section di `docs/STATE_MACHINES.md`. Ini keputusan (Rule 1/D1), bukan
--    kelalaian — dicatat di sini supaya sesi berikutnya tidak "melengkapi"-nya.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 3. `studios` — registry ruang produksi. Pola `division_registry`: di-seed DI
--    DALAM migrasi (bukan `supabase/seed.sql`, jadi keempat gerbang seed tidak
--    bergerak), ber-kunci `code`, dan tiap sifat punya kolomnya sendiri.
--
--    `cek_konflik` ada karena `Luar Kantor` BUKAN sebuah ruangan: ia catch-all
--    untuk lokasi di luar kantor, dan dua shoot di dua lokasi luar yang berbeda
--    bukan tumpang-tindih. Sebuah daftar nama tanpa flag ini akan memperingatkan
--    setiap hari untuk sesuatu yang bukan konflik, dan peringatan yang selalu
--    muncul adalah peringatan yang berhenti dibaca.
-- ---------------------------------------------------------------------------
CREATE TABLE studios (
    code        varchar(32)  NOT NULL PRIMARY KEY,
    nama        varchar(191) NOT NULL,
    aktif       boolean      NOT NULL DEFAULT true,
    cek_konflik boolean      NOT NULL DEFAULT true,
    urutan      smallint     NOT NULL,
    created_at  timestamptz  NOT NULL DEFAULT now(),
    created_by  varchar(64)  NOT NULL DEFAULT 'SYSTEM',
    CONSTRAINT ck_studios_nama CHECK (length(btrim(nama)) > 0)
);

INSERT INTO studios (code, nama, aktif, cek_konflik, urutan) VALUES
    ('KASUARI',     'Kasuari',     true, true,  1),
    ('RAJAWALI',    'Rajawali',    true, true,  2),
    ('CEMPAKA',     'Cempaka',     true, true,  3),
    -- Catch-all lokasi luar kantor — conflict check MATI dengan sengaja.
    ('LUAR_KANTOR', 'Luar Kantor', true, false, 4);

COMMENT ON TABLE studios IS
  'M19 §5.1 — registry ruang produksi Creative (dari kolom Tempat pada jadwal '
  'harian Leader Video). Pola division_registry: di-seed di migrasi, ber-kunci '
  'code. Dual-home dengan STUDIOS di packages/core/src/dailyops.ts, dijaga '
  'packages/db/src/dailyops.registry.test.ts.';

COMMENT ON COLUMN studios.cek_konflik IS
  'false ⇒ tumpang-tindih waktu di lokasi ini TIDAK diperingatkan. Dipakai '
  '`Luar Kantor`, yang bukan satu ruangan melainkan catch-all lokasi luar: dua '
  'shoot di dua lokasi luar berbeda bukan konflik, dan memperingatkannya setiap '
  'hari melatih orang mengabaikan peringatan.';

-- ---------------------------------------------------------------------------
-- 4. `pic_unavailability` — KETIDAKTERSEDIAAN PRODUKSI, BUKAN CATATAN CUTI HR.
--
--    ## KENAPA TABEL INI ADA PADAHAL CDPS BUKAN HRIS
--
--    `CLAUDE.md` eksplisit: *"It is NOT an HRIS — MEA's HRIS (employee/
--    attendance/leave) is a separate existing system"*, dan integrasinya
--    read-only `GET /employees` TANPA endpoint cuti. Tabel ini karena itu
--    dibatasi sampai satu pertanyaan saja: **"boleh dijadwalkan hari itu atau
--    tidak?"** — dan batas itu ditegakkan oleh apa yang TIDAK ADA di sini:
--
--      * nol kolom status/approval — tidak ada yang menyetujui apa pun;
--      * nol saldo, nol kuota, nol carry-over, nol sisa hak;
--      * nol kolom "disetujui_oleh", nol lampiran, nol tanggal pengajuan.
--
--    Yang ada hanya: siapa, dari kapan sampai kapan, alasan singkat, dan siapa
--    yang mencatatnya. Itu jadwal, bukan manajemen cuti. Keputusan berbatasnya
--    dicatat di `docs/DECISIONS.md` 2026-09-09.
--
--    Kalau HRIS nanti membuka endpoint cuti, tabel ini menjadi read-through
--    cache dan penulisnya berpindah dari Leader ke sync — tanpa membongkar
--    apa pun, karena tidak ada satu pun kolom di sini yang mengklaim
--    kewenangan HR.
--
--    ## KENAPA IDENTITY, BUKAN PREFIX `PREFIX-YYYYMM-NNNN`
--
--    Tidak ada manusia yang pernah menyebut baris ini lewat ID-nya — ia
--    disebut sebagai "Ramdani, 10 September". Pola sama
--    `master_service_duration_options` / `renewal_proposals` (anak
--    ber-identity), jadi `entity_prefix` TETAP 42.
--
--    ## KENAPA ADA DELETE TAPI TIDAK ADA UPDATE
--
--    Salah catat harus bisa dicabut (Leader menandai orang yang salah), tapi
--    MENYUNTING rentangnya sesudah jadwal dibuat di atasnya akan mengubah arti
--    peringatan yang sudah ditampilkan. Jadi: cabut lalu catat ulang. Nol
--    kolom `updated_at` adalah cara skema mengatakan itu.
-- ---------------------------------------------------------------------------
CREATE TABLE pic_unavailability (
    id              bigint       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    employee_id     varchar(64)  NOT NULL,
    tanggal_mulai   date         NOT NULL,
    tanggal_selesai date         NOT NULL,
    alasan          varchar(32)  NOT NULL,
    catatan         text         NULL,
    dicatat_oleh    varchar(64)  NOT NULL,
    created_at      timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT fk_picunav_employee FOREIGN KEY (employee_id)
        REFERENCES employees (employee_id),
    -- Enum tertutup, dual-home dengan ALASAN_TIDAK_TERSEDIA di
    -- packages/core/src/dailyops.ts (dijaga dailyops.registry.test.ts).
    CONSTRAINT ck_picunav_alasan CHECK (alasan IN ('Cuti', 'Sakit', 'Izin', 'Dinas Luar')),
    CONSTRAINT ck_picunav_rentang CHECK (tanggal_selesai >= tanggal_mulai)
);

CREATE INDEX idx_picunav_employee_rentang
    ON pic_unavailability (employee_id, tanggal_mulai, tanggal_selesai);

COMMENT ON TABLE pic_unavailability IS
  'M19 §5.1 / D4 — ketidaktersediaan PRODUKSI seorang PIC, ditulis Leader/SPV '
  'Creative. BUKAN catatan cuti HR: nol approval, nol saldo, nol entitlement, '
  'nol carry-over (CDPS bukan HRIS — lihat kepala migrasi dan DECISIONS.md '
  '2026-09-09). Satu-satunya tugasnya: memperingatkan saat Leader menjadwalkan '
  'orang yang tidak ada. Ia MEMPERINGATKAN, tidak memblokir (Rule 9).';

COMMENT ON COLUMN pic_unavailability.dicatat_oleh IS
  'Leader/SPV yang mencatat (D4: bukan self-service PIC). Bukan "penyetuju" — '
  'tidak ada yang disetujui di sini.';

-- ---------------------------------------------------------------------------
-- 5. `prod_slots` — RENCANA satu sesi produksi. Prefix `SLOT-YYYYMM-NNNN`,
--    di-mint HANYA sesudah validasi field wajib lolos (aturan rumah #1).
--
--    Ia ber-`client_id`, BUKAN `brief_id` — dan itu inti D1. Jadwal besok
--    disusun HARI INI, sebelum satu pun Asset ada, karena M7-OA-6 sudah
--    mengetok "PIC creates Assets incrementally as work starts, not all
--    pre-created upfront". Sebuah view di atas Asset hanya bisa menampilkan
--    baris yang sudah ada, jadi ia akan memaksa Asset dibuat sehari lebih
--    awal — membatalkan keputusan yang sudah dikunci.
--
--    `actual_qty` NULL berarti "slot belum ditutup", BUKAN nol. Bedanya
--    dipakai dua angka berbeda: slot fill (sudah ditutup atau belum) dan
--    penyelesaian hari-sama (berapa dari target). Men-default-kannya ke 0 akan
--    membuat slot yang belum ditutup terbaca sebagai slot yang gagal total.
-- ---------------------------------------------------------------------------
CREATE TABLE prod_slots (
    id            varchar(32)  NOT NULL PRIMARY KEY,   -- SLOT-YYYYMM-NNNN

    tanggal       date         NOT NULL,
    client_id     varchar(32)  NOT NULL,
    studio_code   varchar(32)  NOT NULL,
    waktu_mulai   time         NOT NULL,
    waktu_selesai time         NOT NULL,
    assigned_pic  varchar(64)  NOT NULL,

    jenis_paket   varchar(191) NULL,                   -- kolom "Jenis Paket" di sheet
    task_type     varchar(32)  NOT NULL,
    target_qty    integer      NOT NULL,
    actual_qty    integer      NULL,                   -- NULL = slot belum ditutup
    notes         text         NULL,

    created_at    timestamptz  NOT NULL DEFAULT now(),
    updated_at    timestamptz  NOT NULL DEFAULT now(),
    created_by    varchar(64)  NOT NULL,

    CONSTRAINT fk_slot_client FOREIGN KEY (client_id) REFERENCES clients (id),
    CONSTRAINT fk_slot_studio FOREIGN KEY (studio_code) REFERENCES studios (code),
    CONSTRAINT fk_slot_pic FOREIGN KEY (assigned_pic) REFERENCES employees (employee_id),
    -- Enum tertutup, dual-home dengan TASK_TYPES di packages/core/src/dailyops.ts.
    CONSTRAINT ck_slot_task_type CHECK (task_type IN
        ('Shoot', 'Edit', 'Script', 'Voice Over', 'Other')),
    CONSTRAINT ck_slot_target_qty CHECK (target_qty > 0),
    CONSTRAINT ck_slot_actual_qty CHECK (actual_qty IS NULL OR actual_qty >= 0),
    -- Pasangan gerbang domain `[jumlah aktual tidak boleh melebihi target]`.
    -- Ditegakkan DUA kali dengan sengaja: pesan BI datang dari domain, tapi
    -- jalur tulis mana pun yang melewatinya tetap ditolak DB.
    CONSTRAINT ck_slot_actual_lte_target CHECK (actual_qty IS NULL OR actual_qty <= target_qty),
    CONSTRAINT ck_slot_rentang_waktu CHECK (waktu_selesai > waktu_mulai)
);

CREATE INDEX idx_slot_tanggal_studio ON prod_slots (tanggal, studio_code);
CREATE INDEX idx_slot_pic_tanggal ON prod_slots (assigned_pic, tanggal);
CREATE INDEX idx_slot_client ON prod_slots (client_id);

CREATE TRIGGER trg_prod_slots_updated_at BEFORE UPDATE ON prod_slots
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE prod_slots IS
  'M19 §5.1 / Rule 1 / D1 — RENCANA satu sesi produksi Creative: hari + studio '
  '+ PIC + klien + slot waktu + target qty. TANPA mesin status dan TANPA SLA '
  'sendiri: eksekusi dan review tetap milik Asset/Task (M7/M12). Ber-client_id '
  'dan BUKAN brief_id supaya jadwal besok bisa disusun hari ini tanpa memaksa '
  'Asset lahir lebih awal (M7-OA-6).';

COMMENT ON COLUMN prod_slots.actual_qty IS
  'Berapa unit BENAR-BENAR selesai di sesi ini, diisi saat slot ditutup. '
  'NULL = belum ditutup, BUKAN nol — slot fill membaca null/not-null, '
  'penyelesaian hari-sama membaca angkanya. Sisa (target − actual) dan '
  'persentasenya TIDAK disimpan (aturan rumah #4).';

COMMENT ON COLUMN prod_slots.studio_code IS
  'Ruang produksi. Tumpang-tindih waktu di studio yang sama MEMPERINGATKAN dan '
  'tetap menyimpan (Rule 8/D3) — sengaja tanpa EXCLUDE constraint; lihat kepala '
  'migrasi. Dikecualikan untuk studio ber-cek_konflik = false.';

-- ---------------------------------------------------------------------------
-- 6. RLS.
--
--    `GRANT SELECT ... TO authenticated` WAJIB dan bukan formalitas: tabel yang
--    lahir SESUDAH `20260723064438_rls_baseline.sql` tidak tersentuh grant-loop
--    di sana, dan tanpa grant `readAsActor` gagal "permission denied" SEBELUM
--    satu policy pun dievaluasi (bug yang dulu kena `client_milestones`).
--
--    Ketiga policy memikul scope baris PRD §5.6: OD/Director baca di mana pun ·
--    PIC baris itu sendiri · pencatatnya · lead divisi Creative se-divisi.
--
--    KENAPA `jwt_division() = 'Creative'` DAN BUKAN
--    `private.jwt_division_owns_client(client_id)`: helper itu true bila salah
--    satu PIC KLIEN (sales_pic_id / assigned_am_id / commission_payment_pic_id
--    / created_by) sedivisi dengan aktor — orang-orang Sales dan Account. Untuk
--    lead Creative ia selalu FALSE, jadi memakainya akan membuat Leader Video
--    tidak melihat jadwalnya sendiri. Baris `prod_slots` memang milik divisi
--    Creative secara konstruksi (`assigned_pic` selalu staff Creative), jadi
--    pemeriksaan divisi langsung adalah yang benar DAN yang paling sempit.
--
--    NOL lengan AM. PRD §5.6 tidak memberi AM akses ke jadwal produksi, dan
--    menambahkannya "karena kelihatannya berguna" adalah menciptakan izin yang
--    tidak pernah diketok siapa pun.
--
--    Ketiga policy `prod_slots`/`pic_unavailability` punya lengan
--    `jwt_is_lead()`/`jwt_division()`, jadi keduanya TIDAK masuk daftar
--    `expected` ledger O48 (`supabase/tests/rls_checks.sql` §43).
--    `studios_select` TIDAK punya lengan itu dan karena itu DITAMBAHKAN ke
--    daftar tersebut, dengan alasannya ditulis di sana dan di DECISIONS.md —
--    bukan supaya tesnya hijau.
--
--    Nol write policy di ketiganya: jalur tulis CDPS berjalan service-role.
-- ---------------------------------------------------------------------------
REVOKE ALL ON public.studios FROM anon;
REVOKE ALL ON public.studios FROM authenticated;
GRANT SELECT ON public.studios TO authenticated;
ALTER TABLE public.studios ENABLE ROW LEVEL SECURITY;

-- Empat nama ruangan. Tidak ada yang lebih sensitif di sini daripada
-- `standard_price` di `master_services` yang sudah terbuka bagi seluruh staff,
-- dan SETIAP orang yang membuka layar jadwal butuh daftarnya untuk merender
-- kolom grid — termasuk pada hari yang nol slot. Cermin
-- `master_service_versions_select` / `master_service_duration_options_select`.
CREATE POLICY studios_select ON public.studios FOR SELECT TO authenticated
USING (true);

REVOKE ALL ON public.prod_slots FROM anon;
REVOKE ALL ON public.prod_slots FROM authenticated;
GRANT SELECT ON public.prod_slots TO authenticated;
ALTER TABLE public.prod_slots ENABLE ROW LEVEL SECURITY;

CREATE POLICY prod_slots_select ON public.prod_slots FOR SELECT TO authenticated
USING (jwt_can_read_all()
       OR jwt_employee_id() = assigned_pic
       OR jwt_employee_id() = created_by
       OR (jwt_is_lead() AND jwt_division() = 'Creative'));

REVOKE ALL ON public.pic_unavailability FROM anon;
REVOKE ALL ON public.pic_unavailability FROM authenticated;
GRANT SELECT ON public.pic_unavailability TO authenticated;
ALTER TABLE public.pic_unavailability ENABLE ROW LEVEL SECURITY;

CREATE POLICY pic_unavailability_select ON public.pic_unavailability FOR SELECT TO authenticated
USING (jwt_can_read_all()
       OR jwt_employee_id() = employee_id
       OR jwt_employee_id() = dicatat_oleh
       OR (jwt_is_lead() AND jwt_division() = 'Creative'));

-- ---------------------------------------------------------------------------
-- 7. Riwayat tidak bisa disunting: `pic_unavailability` nol jalur UPDATE.
--
--    Bukan sekadar "tidak ada kolom updated_at" — sebuah trigger, supaya jalur
--    tulis mana pun (termasuk service-role, termasuk psql) ditolak. Alasannya
--    di bagian 4: menyunting rentang sesudah jadwal disusun di atasnya mengubah
--    arti peringatan yang sudah ditampilkan. Pola `forbid_mutation()` yang
--    sudah menjaga `audit_log`, tapi hanya untuk UPDATE — DELETE tetap boleh,
--    karena salah catat harus bisa dicabut.
-- ---------------------------------------------------------------------------
CREATE TRIGGER pic_unavailability_no_update BEFORE UPDATE ON pic_unavailability
    FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
