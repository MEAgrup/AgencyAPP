-- CDPS M16 §5.5 — LT-50: entitas `Permintaan` (`REQ-`), STATE_MACHINES §19.
--
-- Permintaan divisi yang TERKAIT KLIEN — dipisahkan sengaja dari `internal_tasks`
-- (`TSK-`, Penugasan Internal §17), yang SENGAJA tanpa `client_id`/`service_id`
-- (melonggarkannya "akan membongkar gerbang pembayaran M4/M5"). Permintaan
-- Top-up Saldo jelas terkait klien (saldo iklan klien), jadi ia tidak boleh
-- menumpang di `internal_tasks`. Ia juga BUKAN "Task" M12 (= Asset | Creator
-- Booking | Brief-as-task) karena bukan deliverable yang di-review AM.
--
-- Pola tabel/trigger/RLS meniru `internal_tasks` (`20260814110000`) SEDEKAT
-- MUNGKIN — satu-satunya perbedaan struktural adalah kolom `client_id`/
-- `tujuan_divisi`/`tujuan_employee_id`/`cpr_id` yang memang tidak ada padanannya
-- di TSK-.
--
-- Tiga `jenis` (M16 §5.5): `Top-up Saldo` (Ads -> AM), `Contract Creator` (KOL
-- -> AM — spec tidak menulis tujuan eksplisit untuk jenis ini; AM dipilih
-- sebagai default paling dekat dengan "Top-up Saldo", DICATAT sebagai keputusan
-- implementasi untuk diverifikasi pemilik saat merge, lihat
-- HANDOFF_M16_AKUN_B.md), `Creator Payment Approval` (KOL -> Finance,
-- MENYAMBUNG `CPR-` M9 yang sudah ada lewat `cpr_id` — REQ TIDAK MENGGANTIKAN
-- mesin CPR-, murni lapisan permintaan/tracking di atasnya).
--
-- Deadline SATU HARI KERJA (bukan 24 jam, bukan 1 hari kalendar — keputusan
-- pemilik dicatat DECISIONS.md 2026-08-28), dihitung MAJU dari `created_at` lewat
-- helper baru `add_working_days` (companion terbalik `working_days_between`
-- yang sudah ada — itu menghitung MUNDUR/SELISIH, bukan MAJU; keduanya
-- berbagi definisi hari kerja yang sama, Sen-Jum minus `hari_libur`).
--
-- Keterlambatan BUKAN status, BUKAN kolom — diturunkan saat baca dari
-- `due_date` + `selesai_pada` + `status` (WIB), pola persis §17. `due_date`
-- dibekukan trigger karena menggesernya adalah cara termudah menghapus
-- keterlambatan dari catatan performa (alasan yang sama persis dengan TSK-).
--
-- Prefix `REQ` SUDAH terdaftar di `entity_prefix` sejak fondasi F
-- (`20260829001000_m16_fondasi.sql`) — TIDAK didaftarkan ulang di sini.
--
-- Gate hitung: tabel 123->124 (+`permintaan`), sm_machines 23->24 (+`permintaan`),
-- entity_prefix TETAP 36 (REQ sudah didaftarkan F), notif_events TETAP 65
-- (event `m16.permintaan.*` sudah didaftarkan F v12) — dinaikkan bersama
-- migrasi ini di `scripts/db-rebuild.sh` + `.github/workflows/ci.yml`.

-- ===========================================================================
-- 1. add_working_days — helper MAJU, companion `working_days_between` (MUNDUR)
--    yang sudah ada (`20260813000000_kelola_klien_sla.sql`). Satu definisi hari
--    kerja untuk KEDUA arah: Sen-Jum minus `hari_libur`. STABLE (bukan
--    IMMUTABLE) karena membaca tabel `hari_libur` — pola yang sama persis.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.add_working_days(d_from date, n integer)
RETURNS date
LANGUAGE plpgsql STABLE
SET search_path = public
AS $$
DECLARE
  d         date    := d_from;
  remaining integer := n;
BEGIN
  IF n <= 0 THEN
    RETURN d_from;
  END IF;
  WHILE remaining > 0 LOOP
    d := d + 1;
    IF extract(isodow FROM d) < 6 AND NOT EXISTS (SELECT 1 FROM hari_libur WHERE tanggal = d) THEN
      remaining := remaining - 1;
    END IF;
  END LOOP;
  RETURN d;
END;
$$;

COMMENT ON FUNCTION public.add_working_days(date, integer) IS
  'M16 LT-50 — tanggal jatuh tempo MAJU n hari kerja dari d_from (Sen-Jum minus hari_libur). Companion working_days_between (yang menghitung MUNDUR/selisih), definisi hari kerja sama.';

-- ===========================================================================
-- 2. Mesin `permintaan` (STATE_MACHINES §19). sm_machines 23 -> 24.
-- ===========================================================================
INSERT INTO sm_machines (name, initial_state, block_message, auto_computed, flags) VALUES
    ('permintaan', '[Diajukan]', '[transisi status permintaan tidak diizinkan]', false, '{}');

INSERT INTO sm_terminal_states (machine, state) VALUES
    ('permintaan', '[Selesai]'),
    ('permintaan', '[Ditolak]');

INSERT INTO sm_edges (machine, from_state, to_state, require_lead) VALUES
    ('permintaan', '[Diajukan]', '[Diproses]', false),
    ('permintaan', '[Diproses]', '[Selesai]',  false),
    ('permintaan', '[Diajukan]', '[Ditolak]',  false),
    ('permintaan', '[Diproses]', '[Ditolak]',  false);

-- ===========================================================================
-- 3. Tabel `permintaan`. tabel 123 -> 124.
-- ===========================================================================
CREATE TABLE permintaan (
    id                   varchar(32)  NOT NULL PRIMARY KEY,   -- REQ-YYYYMM-NNNN

    jenis                varchar(32)  NOT NULL,
    judul                text         NOT NULL,
    deskripsi            text         NOT NULL DEFAULT '',

    -- Parent Brief/Service (DATA_MODEL.md) — minimal salah satu. client_id
    -- diturunkan dari salah satunya saat create dan DISIMPAN (pola ad_campaigns
    -- client_id: "inherited via Brief->Service->Client", bukan dihitung ulang
    -- tiap baca).
    brief_id             varchar(32)  NULL,
    service_id           varchar(32)  NULL,
    client_id            varchar(32)  NOT NULL,

    -- Creator Payment Approval MENYAMBUNG CPR- (M9) yang sudah ada — REQ tidak
    -- pernah menggantikan mesin CPR-, murni lapisan permintaan di atasnya.
    cpr_id               varchar(32)  NULL,

    -- Pengaju. Divisi dibekukan di baris, pola sama dengan
    -- internal_tasks.assignee_division.
    diajukan_oleh        varchar(64)  NOT NULL,
    diajukan_divisi      varchar(32)  NOT NULL,

    -- Tujuan. `tujuan_divisi` SELALU terisi (dipakai gate lead + RLS);
    -- `tujuan_employee_id` adalah AM spesifik saat tujuannya seorang, bukan
    -- divisi (Top-up Saldo/Contract Creator -> AM pemilik klien). Creator
    -- Payment Approval -> tujuan_divisi='Finance', tujuan_employee_id NULL
    -- (lead mana pun di Finance yang memproses).
    tujuan_divisi        varchar(32)  NOT NULL,
    tujuan_employee_id   varchar(64)  NULL,

    due_date             date         NOT NULL,

    status               varchar(24)  NOT NULL DEFAULT '[Diajukan]',

    -- Jangkar beku. NULL = belum terjadi. Nol kolom durasi/keterlambatan —
    -- semuanya diturunkan dari due_date + jangkar + status saat baca.
    diproses_pada        timestamptz  NULL,
    selesai_pada         timestamptz  NULL,
    ditolak_pada         timestamptz  NULL,
    alasan_ditolak       text         NOT NULL DEFAULT '',
    catatan_proses       text         NOT NULL DEFAULT '',

    -- Penanda idempotensi notifikasi jatuh tempo (pola TSK- v10) — kolom, bukan
    -- tabel, jadi gate tabel tidak ikut naik untuk ini.
    jatuh_tempo_terkirim boolean      NOT NULL DEFAULT false,

    created_at           timestamptz  NOT NULL DEFAULT now(),
    created_by           varchar(64)  NOT NULL,
    updated_at           timestamptz  NOT NULL DEFAULT now(),

    CONSTRAINT fk_permintaan_brief    FOREIGN KEY (brief_id)   REFERENCES briefs (id),
    CONSTRAINT fk_permintaan_service  FOREIGN KEY (service_id) REFERENCES services (id),
    CONSTRAINT fk_permintaan_client   FOREIGN KEY (client_id)  REFERENCES clients (id),
    CONSTRAINT fk_permintaan_cpr      FOREIGN KEY (cpr_id)     REFERENCES creator_payment_requests (id),
    CONSTRAINT fk_permintaan_pengaju  FOREIGN KEY (diajukan_oleh)      REFERENCES employees (employee_id),
    CONSTRAINT fk_permintaan_tujuan   FOREIGN KEY (tujuan_employee_id) REFERENCES employees (employee_id),

    CONSTRAINT ck_permintaan_jenis CHECK (jenis IN (
        'Top-up Saldo', 'Contract Creator', 'Creator Payment Approval')),
    -- Parent Brief/Service (§5.5) — minimal salah satu wajib ada, supaya
    -- client_id di atas selalu punya asal yang bisa diaudit.
    CONSTRAINT ck_permintaan_parent CHECK (brief_id IS NOT NULL OR service_id IS NOT NULL),
    -- Creator Payment Approval WAJIB menyambung CPR-; jenis lain WAJIB tidak
    -- (mencegah cpr_id nyasar terpasang pada Top-up Saldo/Contract Creator).
    CONSTRAINT ck_permintaan_cpr CHECK ((jenis = 'Creator Payment Approval') = (cpr_id IS NOT NULL)),
    CONSTRAINT ck_permintaan_tujuan_divisi CHECK (btrim(tujuan_divisi) <> ''),
    CONSTRAINT ck_permintaan_selesai CHECK (status <> '[Selesai]' OR selesai_pada IS NOT NULL),
    CONSTRAINT ck_permintaan_ditolak CHECK (
        status <> '[Ditolak]' OR (ditolak_pada IS NOT NULL AND btrim(alasan_ditolak) <> ''))
);

CREATE INDEX idx_permintaan_client        ON permintaan (client_id);
CREATE INDEX idx_permintaan_tujuan        ON permintaan (tujuan_divisi, status);
CREATE INDEX idx_permintaan_due_status    ON permintaan (status, due_date) WHERE status IN ('[Diajukan]', '[Diproses]');
CREATE INDEX idx_permintaan_diajukan_oleh ON permintaan (diajukan_oleh);

COMMENT ON TABLE permintaan IS
  'M16 §5.5 (REQ-YYYYMM-NNNN) — permintaan divisi TERKAIT KLIEN: Top-up Saldo (Ads->AM), Contract Creator (KOL->AM), Creator Payment Approval (KOL->Finance, menyambung CPR- M9). Mesin [Diajukan]->[Diproses]->[Selesai]|[Ditolak] (STATE_MACHINES §19). BUKAN internal_tasks (TSK- sengaja tanpa client_id) dan BUKAN Task M12.';
COMMENT ON COLUMN permintaan.due_date IS
  'Jatuh tempo = created_at + 1 HARI KERJA (add_working_days), dibekukan trigger trg_permintaan_beku. Keterlambatan diturunkan saat baca, tidak disimpan.';

-- ===========================================================================
-- 4. Trigger beku — pola trg_internal_tasks_jangkar PERSIS, ditambah kolom
--    khusus REQ- (client_id/jenis/cpr_id/tujuan_*).
-- ===========================================================================
CREATE OR REPLACE FUNCTION permintaan_beku()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    IF NEW.id IS DISTINCT FROM OLD.id THEN
        RAISE EXCEPTION 'permintaan: id beku';
    END IF;
    IF NEW.jenis IS DISTINCT FROM OLD.jenis THEN
        RAISE EXCEPTION 'permintaan: jenis beku';
    END IF;
    IF NEW.client_id IS DISTINCT FROM OLD.client_id THEN
        RAISE EXCEPTION 'permintaan: client_id beku';
    END IF;
    IF NEW.cpr_id IS DISTINCT FROM OLD.cpr_id THEN
        RAISE EXCEPTION 'permintaan: cpr_id beku';
    END IF;
    IF NEW.diajukan_oleh IS DISTINCT FROM OLD.diajukan_oleh THEN
        RAISE EXCEPTION 'permintaan: diajukan_oleh beku';
    END IF;
    IF NEW.diajukan_divisi IS DISTINCT FROM OLD.diajukan_divisi THEN
        RAISE EXCEPTION 'permintaan: diajukan_divisi beku';
    END IF;
    IF NEW.due_date IS DISTINCT FROM OLD.due_date THEN
        RAISE EXCEPTION 'permintaan: due_date beku — menggesernya menghapus keterlambatan dari catatan';
    END IF;
    IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
        RAISE EXCEPTION 'permintaan: created_by beku';
    END IF;
    IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'permintaan: created_at beku';
    END IF;
    IF OLD.diproses_pada IS NOT NULL AND NEW.diproses_pada IS DISTINCT FROM OLD.diproses_pada THEN
        RAISE EXCEPTION 'permintaan: diproses_pada beku — jangkar durasi tidak boleh diubah';
    END IF;
    IF OLD.selesai_pada IS NOT NULL AND NEW.selesai_pada IS DISTINCT FROM OLD.selesai_pada THEN
        RAISE EXCEPTION 'permintaan: selesai_pada beku setelah selesai';
    END IF;
    IF OLD.ditolak_pada IS NOT NULL AND NEW.ditolak_pada IS DISTINCT FROM OLD.ditolak_pada THEN
        RAISE EXCEPTION 'permintaan: ditolak_pada beku setelah ditolak';
    END IF;
    IF OLD.status IN ('[Selesai]', '[Ditolak]') AND NEW.status <> OLD.status THEN
        RAISE EXCEPTION 'permintaan: % adalah state terminal', OLD.status;
    END IF;
    -- Penanda notifikasi searah (pola TSK- v10) — false->true saja.
    IF OLD.jatuh_tempo_terkirim AND NOT NEW.jatuh_tempo_terkirim THEN
        RAISE EXCEPTION 'permintaan: jatuh_tempo_terkirim searah (tidak bisa di-reset)';
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_permintaan_beku BEFORE UPDATE ON permintaan
    FOR EACH ROW EXECUTE FUNCTION permintaan_beku();

-- ===========================================================================
-- 5. RLS — pola 3-arm internal_tasks_select PERSIS (read-all / lead divisi
--    terkait / pihak yang namanya ada di baris). GRANT WAJIB — tanpanya setiap
--    baca ditolak sebelum policy sempat dievaluasi (O37).
-- ===========================================================================
ALTER TABLE permintaan ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.permintaan TO authenticated;

CREATE POLICY permintaan_select ON public.permintaan FOR SELECT TO authenticated USING (
    jwt_can_read_all()
    OR (jwt_is_lead() AND jwt_division() IN (diajukan_divisi, tujuan_divisi))
    OR jwt_employee_id() IN (diajukan_oleh, coalesce(tujuan_employee_id, ''))
);
