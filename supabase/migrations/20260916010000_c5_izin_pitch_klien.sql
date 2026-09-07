-- ===========================================================================
-- C-5 — RUMAH untuk status izin "angka klien ini boleh dipakai di materi pitch".
--
-- KENAPA TABEL, BUKAN KOLOM DI `clients`. Keputusan pemilik 2026-09-07 (Yohan,
-- Director) atas gerbang C-5: **tabel izin tersendiri, AM pemilik klien yang
-- mencentang, Director bisa mencabut kapan saja**. Sebuah kolom boolean di
-- `clients` tidak bisa menyimpan dua hal yang keputusan itu sebut sendiri:
--
--   * **masa berlaku** — izin yang diberikan klien untuk satu musim pitch
--     bukan izin selamanya; dan
--   * **rujukan dokumen** — email/PKS/percakapan mana yang jadi buktinya.
--
-- Dan ia tidak bisa menyimpan yang ketiga, yang justru paling penting saat ada
-- yang mempersoalkan sebuah materi pitch: **riwayat**. Kolom boolean yang
-- di-`UPDATE` dari true ke false menghapus fakta bahwa izinnya pernah ada,
-- kapan, dan atas dasar apa.
--
-- BENTUKNYA LEDGER APPEND-ONLY, sama seperti seluruh riwayat CDPS (aturan
-- rumah #3): satu baris per PERISTIWA (`beri` / `cabut`), tak pernah di-UPDATE
-- dan tak pernah di-DELETE. Status hari ini adalah TURUNAN — baris terakhir per
-- klien, plus pemeriksaan `berlaku_sampai` terhadap tanggal hari ini — bukan
-- sesuatu yang disimpan dan bisa jadi basi. Itu membuatnya patuh aturan rumah #4
-- (nilai turunan selalu bisa dihitung ulang dari log) tanpa kolom cache apa pun.
--
-- APA YANG DIGERBANGI TABEL INI. C-3 (2026-09-07) memutuskan angka klien boleh
-- dipakai di materi pitch HANYA untuk klien yang izinnya sudah ada, dan C-1
-- membuka halaman Showcase ke divisi Sales. Dua keputusan itu bertemu di sini:
-- daftar Showcase yang Sales lihat hanya boleh memuat klien yang baris terakhir
-- di tabel ini `beri` dan masih berlaku. Jadi tabel ini bukan pelengkap
-- Showcase — ia **gerbang teknisnya**, dan tanpa ia terisi Showcase yang Sales
-- lihat kosong secara sah.
--
-- NOL PREFIX ID BARU. Sama seperti `client_reports`: baris ini anak `clients`,
-- ber-PK identity, tidak pernah disebut manusia lewat ID-nya sendiri, jadi ia
-- tidak masuk registry `PREFIX-YYYYMM-NNNN` (aturan rumah #1).
-- ===========================================================================

CREATE TABLE client_pitch_consents (
    id              bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    client_id       varchar(32) NOT NULL,

    -- Peristiwanya, bukan keadaannya. `beri` = klien mengizinkan angkanya
    -- dipakai; `cabut` = izin itu ditarik (oleh Director, atau oleh AM pemilik
    -- saat kliennya minta).
    aksi            varchar(8)  NOT NULL,

    -- NULL = izin tanpa batas waktu. Terisi = izin berhenti berlaku SESUDAH
    -- tanggal ini, tanpa perlu ada yang mencabutnya — supaya izin yang
    -- kedaluwarsa tidak diam-diam tetap menampilkan klien di materi pitch.
    berlaku_sampai  date        NULL,

    -- Rujukan bukti: nomor PKS, subjek email, tanggal percakapan. Teks bebas
    -- dan sengaja begitu — bentuk buktinya berbeda-beda per klien, dan
    -- memaksakan satu bentuk berarti AM menulis yang tidak benar supaya lolos.
    dokumen_catatan text        NULL,

    -- Kenapa dicabut. Opsional: mencabut izin tidak boleh terhalang oleh
    -- kolom wajib — yang penting pencabutannya tercatat, bukan prosanya.
    alasan          text        NULL,

    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      varchar(64) NOT NULL,

    CONSTRAINT fk_pitch_consent_client FOREIGN KEY (client_id) REFERENCES clients (id),

    CONSTRAINT ck_pitch_consent_aksi CHECK (aksi IN ('beri', 'cabut')),

    -- Setiap peristiwa hanya membawa kolom yang berarti untuknya. Sebuah baris
    -- `cabut` ber-`berlaku_sampai` adalah kalimat yang tidak punya makna, dan
    -- pembaca hilir harus menebak apakah ia mencabut atau memperpanjang.
    CONSTRAINT ck_pitch_consent_bentuk CHECK (
        (aksi = 'beri'  AND alasan IS NULL)
     OR (aksi = 'cabut' AND berlaku_sampai IS NULL AND dokumen_catatan IS NULL)
    )
);

-- Baris terakhir per klien adalah status hari ini ⇒ itulah bentuk kueri yang
-- SETIAP pembaca pakai (`distinct on (client_id) … order by client_id, id desc`).
CREATE INDEX idx_pitch_consent_client ON client_pitch_consents (client_id, id DESC);

COMMENT ON TABLE client_pitch_consents IS
  'Ledger append-only izin pemakaian angka klien di materi pitch (gerbang C-3/C-5, keputusan pemilik 2026-09-07). Satu baris per peristiwa beri/cabut. Status hari ini = baris terakhir per client_id yang aksi=beri DAN (berlaku_sampai IS NULL OR berlaku_sampai >= current_date) — turunan, tidak pernah disimpan.';
COMMENT ON COLUMN client_pitch_consents.berlaku_sampai IS
  'NULL = tanpa batas waktu. Terisi = izin berhenti berlaku sesudah tanggal ini tanpa perlu dicabut manual.';

-- ---------------------------------------------------------------------------
-- Immutability (aturan rumah #3). Riwayat izin adalah SATU-SATUNYA catatan atas
-- dasar apa sebuah angka klien pernah masuk materi pitch. Kalau ia bisa
-- di-UPDATE, "izinnya ada kok" menjadi klaim yang tak bisa diperiksa siapa pun.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION client_pitch_consents_frozen()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'client_pitch_consents: riwayat izin immutable (aturan rumah #3) — mencabut izin = INSERT baris aksi=cabut, bukan mengubah baris lama';
END $$;

CREATE TRIGGER trg_client_pitch_consents_frozen BEFORE UPDATE OR DELETE ON client_pitch_consents
    FOR EACH ROW EXECUTE FUNCTION client_pitch_consents_frozen();

-- ---------------------------------------------------------------------------
-- RLS — Account-scope, arm lead/divisi DI-INLINE (rls_checks §42 / O48), cermin
-- persis `client_reports_sel`: siapa yang boleh melihat laporan klien boleh
-- melihat status izinnya.
--
-- Divisi Sales SENGAJA TIDAK ada di policy ini. Akses Sales (C-1) hanya ke
-- halaman Showcase, dan jalur bacanya `db()` + gerbang domain — pola yang sama
-- dengan `baseline-prefill`/`copilot`. Menaruh Sales di policy ini akan
-- memberi mereka daftar izin per klien, yang bukan yang C-1 buka.
--
-- Tulis lewat service-role dengan izin ditegakkan di domain
-- (packages/domain/src/showcase.ts).
-- ---------------------------------------------------------------------------
REVOKE ALL ON public.client_pitch_consents FROM anon;
REVOKE ALL ON public.client_pitch_consents FROM authenticated;

ALTER TABLE public.client_pitch_consents ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.client_pitch_consents TO authenticated;

CREATE POLICY client_pitch_consents_sel ON public.client_pitch_consents FOR SELECT TO authenticated
    USING (public.jwt_can_read_all()
           OR (public.jwt_is_lead() AND public.jwt_division() = 'Account')
           OR public.jwt_owns_client_am(client_id));
