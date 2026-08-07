-- CDPS — Module 6A, tiket **A-06: Section B per channel** (grup B-2 … B-9).
--
-- B-0 (identitas channel + jendela baseline) dan B-1/B-5 bulanan sudah mendarat
-- di A-03: yang bulanan hidup sebagai BARIS di `strategi_baseline_bulan`, karena
-- jendelanya variabel 1–6 bulan (D11). Yang ditambahkan di sini adalah grup yang
-- **satu angka per channel**, bukan per bulan — jadi ia kolom di
-- `strategi_channel`, satu baris per channel kontrak (D4).
--
-- ===========================================================================
-- Empat keputusan bentuk, dan kenapa
-- ===========================================================================
--
-- (1) **Komposisi sumber trafik (B-2.3) sebagai ENAM KOLOM, bukan satu jsonb.**
--     §7 mewajibkan *"DB check that the block sums to 100 (±0.5 tolerance)"*.
--     Dengan jsonb, kunci yang HILANG membuat `(t->>'organik')::numeric` menjadi
--     NULL, seluruh ekspresi NULL, dan CHECK yang bernilai NULL **lolos** — jadi
--     gate-nya akan diam persis pada input yang cacat. Taksonomi B-2.3 tertutup
--     (organik/iklan/affiliate/live/video/luar platform), jadi kolom tetap adalah
--     bentuk yang benar dan CHECK-nya bisa ditulis apa adanya.
--
-- (2) **`gmv_per_jam_live` GENERATED, tidak diketik.** B-7.2 menuliskannya
--     sebagai "Number × 3", tapi angka ketiga adalah hasil bagi dua yang
--     pertama, dan aturan rumah #4 menyatakan field terhitung **read-only,
--     selalu bisa dihitung ulang**. Angka ketiga yang bisa diketik adalah angka
--     yang bisa membantah dua angka di atasnya, dan tidak ada cara memilih mana
--     yang benar setelahnya. Bagi-nol → NULL (aturan rumah #7, dirender `—`),
--     sama seperti `aov` di A-03.
--
-- (3) **Kolomnya NULLable; kelengkapan Rule 5 ditegakkan gerbang submit.**
--     Rule 5 ("blank tidak boleh, `0` boleh") ditegakkan `NOT NULL` untuk baris
--     baseline bulanan karena baris itu di-INSERT utuh. Grup B-2…B-9 diisi
--     berangsur di satu form panjang yang ber-autosave (§7 Non-functional), jadi
--     kehadirannya diperiksa `checkCompleteness` di dalam transaksi submit —
--     per channel, per grup, dan HANYA untuk channel `Eksisting` (Rule 4
--     membebaskan channel `Belum Aktif` dari baseline historis).
--     Yang tetap ditegakkan DB di sini: rentang (persen 0–100, rating 0–5,
--     jumlah tak negatif) dan taksonomi multi-enum. Nilai yang ADA wajib sah.
--
-- (4) **Multi-enum tertutup dijaga containment jsonb (`<@`).** B-5.3, B-8.2 dan
--     B-9.2 adalah checkbox bertaksonomi tetap; `<@` menolak nilai di luar
--     daftar tanpa subquery (CHECK Postgres tidak boleh mengandung subquery).
--     Struct berulang (B-3.3 top SKU, B-9.1 kompetitor, dst.) hanya dijaga
--     `jsonb_typeof = 'array'` di DB — bentuk elemennya divalidasi domain, dan
--     jumlah minimalnya di gerbang submit.
--
-- B-1.5 (tren naik/stabil/turun + besaran %) TIDAK punya kolom: ia bertanda **A**
-- (auto) di PRD dan diturunkan dari baris `strategi_baseline_bulan` saat dibaca.
-- Menyimpannya berarti angka yang bisa basi terhadap baseline yang melahirkannya.

ALTER TABLE strategi_channel
    -- ---------------------------------------------------------------- B-2
    ADD COLUMN pengunjung_per_bulan      integer      NULL,   -- B-2.1
    ADD COLUMN conversion_rate_persen    numeric(6,2) NULL,   -- B-2.2
    -- B-2.3 — enam kolom, lihat keputusan (1).
    ADD COLUMN trafik_organik_persen     numeric(6,2) NULL,
    ADD COLUMN trafik_iklan_persen       numeric(6,2) NULL,
    ADD COLUMN trafik_affiliate_persen   numeric(6,2) NULL,
    ADD COLUMN trafik_live_persen        numeric(6,2) NULL,
    ADD COLUMN trafik_video_persen       numeric(6,2) NULL,
    ADD COLUMN trafik_luar_persen        numeric(6,2) NULL,
    ADD COLUMN entry_point_utama         varchar(16)  NULL,   -- B-2.4 (opsional)
    ADD COLUMN entry_point_catatan       text         NULL,
    -- ---------------------------------------------------------------- B-3
    ADD COLUMN sku_listed                integer      NULL,   -- B-3.1
    ADD COLUMN sku_aktif                 integer      NULL,
    ADD COLUMN sku_pareto_80             integer      NULL,   -- B-3.2
    ADD COLUMN top_sku                   jsonb        NOT NULL DEFAULT '[]'::jsonb, -- B-3.3
    ADD COLUMN sku_slow_moving           integer      NULL,   -- B-3.4
    ADD COLUMN sku_stok_kritis           jsonb        NOT NULL DEFAULT '[]'::jsonb, -- B-3.5 (opsional)
    ADD COLUMN listing_layak_persen      numeric(6,2) NULL,   -- B-3.6
    -- ---------------------------------------------------------------- B-4
    ADD COLUMN rating_toko               numeric(3,2) NULL,   -- B-4.1
    ADD COLUMN jumlah_ulasan             integer      NULL,
    ADD COLUMN chat_response_rate_persen numeric(6,2) NULL,   -- B-4.2
    ADD COLUMN chat_response_menit       integer      NULL,
    ADD COLUMN pesanan_terlambat_persen  numeric(6,2) NULL,   -- B-4.3
    ADD COLUMN poin_penalti              integer      NULL,   -- B-4.4
    ADD COLUMN catatan_penalti           text         NULL,
    ADD COLUMN tema_keluhan              jsonb        NOT NULL DEFAULT '[]'::jsonb, -- B-4.5 (opsional)
    -- ---------------------------------------------------------------- B-5
    -- (B-5.1/B-5.2 per bulan ada di strategi_baseline_bulan — A-03.)
    ADD COLUMN tipe_kampanye             jsonb        NOT NULL DEFAULT '[]'::jsonb, -- B-5.3
    ADD COLUMN jumlah_kampanye_aktif     integer      NULL,
    ADD COLUMN top_keyword               jsonb        NOT NULL DEFAULT '[]'::jsonb, -- B-5.4 (opsional)
    ADD COLUMN kampanye_boncos           jsonb        NOT NULL DEFAULT '[]'::jsonb, -- B-5.5 (opsional)
    -- ---------------------------------------------------------------- B-6
    ADD COLUMN affiliate_aktif_30hari    integer      NULL,   -- B-6.1
    ADD COLUMN gmv_affiliate             numeric(18,2) NULL,  -- B-6.2
    ADD COLUMN gmv_affiliate_persen      numeric(6,2) NULL,
    ADD COLUMN komisi_open_persen        numeric(6,2) NULL,   -- B-6.3
    ADD COLUMN komisi_target_persen      numeric(6,2) NULL,
    ADD COLUMN top_kreator               jsonb        NOT NULL DEFAULT '[]'::jsonb, -- B-6.4 (opsional)
    ADD COLUMN program_sampel            varchar(16)  NULL,   -- B-6.5
    ADD COLUMN program_sampel_catatan    text         NULL,
    -- ---------------------------------------------------------------- B-7
    ADD COLUMN jumlah_video_per_bulan    integer      NULL,   -- B-7.1
    ADD COLUMN total_views               bigint       NULL,
    ADD COLUMN gmv_video                 numeric(18,2) NULL,
    ADD COLUMN jam_live_per_bulan        numeric(8,2) NULL,   -- B-7.2
    ADD COLUMN gmv_live                  numeric(18,2) NULL,
    ADD COLUMN host_live                 varchar(16)  NULL,   -- B-7.3
    ADD COLUMN studio_live               varchar(16)  NULL,   -- B-7.4
    ADD COLUMN studio_catatan            text         NULL,
    -- ---------------------------------------------------------------- B-8
    ADD COLUMN voucher_aktif             jsonb        NOT NULL DEFAULT '[]'::jsonb, -- B-8.1
    ADD COLUMN program_platform          jsonb        NOT NULL DEFAULT '[]'::jsonb, -- B-8.2
    ADD COLUMN beban_promo_persen        numeric(6,2) NULL,   -- B-8.3
    -- ---------------------------------------------------------------- B-9
    ADD COLUMN kompetitor                jsonb        NOT NULL DEFAULT '[]'::jsonb, -- B-9.1
    ADD COLUMN kompetitor_lebih_baik     jsonb        NOT NULL DEFAULT '[]'::jsonb, -- B-9.2
    ADD COLUMN kompetitor_catatan        text         NULL,
    ADD COLUMN celah_kompetitor          text         NULL;   -- B-9.3

-- B-7.2 ketiga: terhitung, tidak diketik (aturan rumah #4). NULL saat nol jam
-- live — bagi-nol tidak pernah error, ia dirender `—` (aturan rumah #7).
ALTER TABLE strategi_channel
    ADD COLUMN gmv_per_jam_live numeric(18,2) GENERATED ALWAYS AS (
        CASE WHEN jam_live_per_bulan > 0 THEN gmv_live / jam_live_per_bulan END) STORED;

ALTER TABLE strategi_channel
    -- Persen: 0–100. Nilai di luar itu merambat ke Section C sebagai "bukti".
    ADD CONSTRAINT ck_strch_persen_range CHECK (
        (conversion_rate_persen    IS NULL OR (conversion_rate_persen    BETWEEN 0 AND 100))
    AND (listing_layak_persen      IS NULL OR (listing_layak_persen      BETWEEN 0 AND 100))
    AND (chat_response_rate_persen IS NULL OR (chat_response_rate_persen BETWEEN 0 AND 100))
    AND (pesanan_terlambat_persen  IS NULL OR (pesanan_terlambat_persen  BETWEEN 0 AND 100))
    AND (gmv_affiliate_persen      IS NULL OR (gmv_affiliate_persen      BETWEEN 0 AND 100))
    AND (beban_promo_persen        IS NULL OR (beban_promo_persen        BETWEEN 0 AND 100))
    AND (komisi_open_persen        IS NULL OR (komisi_open_persen        BETWEEN 0 AND 100))
    AND (komisi_target_persen      IS NULL OR (komisi_target_persen      BETWEEN 0 AND 100))
    AND (trafik_organik_persen     IS NULL OR (trafik_organik_persen     BETWEEN 0 AND 100))
    AND (trafik_iklan_persen       IS NULL OR (trafik_iklan_persen       BETWEEN 0 AND 100))
    AND (trafik_affiliate_persen   IS NULL OR (trafik_affiliate_persen   BETWEEN 0 AND 100))
    AND (trafik_live_persen        IS NULL OR (trafik_live_persen        BETWEEN 0 AND 100))
    AND (trafik_video_persen       IS NULL OR (trafik_video_persen       BETWEEN 0 AND 100))
    AND (trafik_luar_persen        IS NULL OR (trafik_luar_persen        BETWEEN 0 AND 100))),
    -- §7: komposisi trafik berjumlah 100 (±0,5). Ditegakkan "semua kosong ATAU
    -- semua terisi dan berjumlah 100" — lima dari enam terisi adalah keadaan
    -- yang tidak bisa dijumlahkan, dan diam-diam melewatkannya berarti Section C
    -- boleh berdiri di atas komposisi yang tidak pernah utuh.
    ADD CONSTRAINT ck_strch_trafik_total CHECK (
        (trafik_organik_persen IS NULL AND trafik_iklan_persen IS NULL
         AND trafik_affiliate_persen IS NULL AND trafik_live_persen IS NULL
         AND trafik_video_persen IS NULL AND trafik_luar_persen IS NULL)
     OR (trafik_organik_persen IS NOT NULL AND trafik_iklan_persen IS NOT NULL
         AND trafik_affiliate_persen IS NOT NULL AND trafik_live_persen IS NOT NULL
         AND trafik_video_persen IS NOT NULL AND trafik_luar_persen IS NOT NULL
         AND (trafik_organik_persen + trafik_iklan_persen + trafik_affiliate_persen
              + trafik_live_persen + trafik_video_persen + trafik_luar_persen)
             BETWEEN 99.5 AND 100.5)),
    -- Jumlah/uang: tak negatif. `0` tetap sah — itu justru jawaban Rule 5.
    ADD CONSTRAINT ck_strch_jumlah_nonneg CHECK (
        (pengunjung_per_bulan   IS NULL OR pengunjung_per_bulan   >= 0)
    AND (sku_listed             IS NULL OR sku_listed             >= 0)
    AND (sku_aktif              IS NULL OR sku_aktif              >= 0)
    AND (sku_pareto_80          IS NULL OR sku_pareto_80          >= 0)
    AND (sku_slow_moving        IS NULL OR sku_slow_moving        >= 0)
    AND (jumlah_ulasan          IS NULL OR jumlah_ulasan          >= 0)
    AND (chat_response_menit    IS NULL OR chat_response_menit    >= 0)
    AND (poin_penalti           IS NULL OR poin_penalti           >= 0)
    AND (jumlah_kampanye_aktif  IS NULL OR jumlah_kampanye_aktif  >= 0)
    AND (affiliate_aktif_30hari IS NULL OR affiliate_aktif_30hari >= 0)
    AND (gmv_affiliate          IS NULL OR gmv_affiliate          >= 0)
    AND (jumlah_video_per_bulan IS NULL OR jumlah_video_per_bulan >= 0)
    AND (total_views            IS NULL OR total_views            >= 0)
    AND (gmv_video              IS NULL OR gmv_video              >= 0)
    AND (jam_live_per_bulan     IS NULL OR jam_live_per_bulan     >= 0)
    AND (gmv_live               IS NULL OR gmv_live               >= 0)),
    -- B-3.1/B-3.2: SKU aktif tidak bisa melebihi SKU listed, dan SKU Pareto
    -- tidak bisa melebihi yang aktif. Baseline yang melanggar ini adalah salah
    -- ketik, dan Section C akan mengutipnya sebagai temuan.
    ADD CONSTRAINT ck_strch_sku_konsisten CHECK (
        (sku_listed IS NULL OR sku_aktif IS NULL OR sku_aktif <= sku_listed)
    AND (sku_aktif  IS NULL OR sku_pareto_80 IS NULL OR sku_pareto_80 <= sku_aktif)),
    -- B-4.1: rating platform berskala 0–5.
    ADD CONSTRAINT ck_strch_rating CHECK (
        rating_toko IS NULL OR (rating_toko BETWEEN 0 AND 5)),
    ADD CONSTRAINT ck_strch_entry_point CHECK (
        entry_point_utama IS NULL
     OR entry_point_utama IN ('search', 'feed', 'live', 'keranjang', 'chat')),
    ADD CONSTRAINT ck_strch_program_sampel CHECK (
        program_sampel IS NULL
     OR program_sampel IN ('tidak_ada', 'klien', 'mea', 'kreator')),
    ADD CONSTRAINT ck_strch_host_live CHECK (
        host_live IS NULL
     OR host_live IN ('internal_klien', 'vendor', 'tim_mea', 'belum_ada')),
    ADD CONSTRAINT ck_strch_studio_live CHECK (
        studio_live IS NULL
     OR studio_live IN ('tersedia', 'sebagian', 'tidak_ada')),
    ADD CONSTRAINT ck_strch_array_kolom CHECK (
        jsonb_typeof(top_sku)               = 'array'
    AND jsonb_typeof(sku_stok_kritis)       = 'array'
    AND jsonb_typeof(tema_keluhan)          = 'array'
    AND jsonb_typeof(tipe_kampanye)         = 'array'
    AND jsonb_typeof(top_keyword)           = 'array'
    AND jsonb_typeof(kampanye_boncos)       = 'array'
    AND jsonb_typeof(top_kreator)           = 'array'
    AND jsonb_typeof(voucher_aktif)         = 'array'
    AND jsonb_typeof(program_platform)      = 'array'
    AND jsonb_typeof(kompetitor)            = 'array'
    AND jsonb_typeof(kompetitor_lebih_baik) = 'array'),
    -- Taksonomi tertutup B-5.3 / B-8.2 / B-9.2 (containment, bukan subquery).
    ADD CONSTRAINT ck_strch_tipe_kampanye CHECK (
        tipe_kampanye <@ '["gmv_max","manual_keyword","auto","live_ads","video_ads","affiliate_ads","lainnya"]'::jsonb),
    ADD CONSTRAINT ck_strch_program_platform CHECK (
        program_platform <@ '["gratis_ongkir_xtra","cashback","campaign_seasonal","flash_sale","voucher_platform","lainnya"]'::jsonb),
    ADD CONSTRAINT ck_strch_kompetitor_unggul CHECK (
        kompetitor_lebih_baik <@ '["harga","konten","ulasan","iklan","live","bundling"]'::jsonb);

COMMENT ON COLUMN strategi_channel.gmv_per_jam_live IS
  'M6A B-7.2 ketiga — terhitung (gmv_live / jam_live_per_bulan), aturan rumah #4. '
  'NULL saat nol jam live: bagi-nol dirender `—`, bukan error (aturan rumah #7).';
-- Arah `month_index` DINYATAKAN di sini, karena B-1.5 (tren, auto) tidak bisa
-- dihitung tanpanya dan A-03 belum menyebutkannya: **1 = bulan TERTUA** dalam
-- jendela B-0.7 (= `periode_mulai`), n = bulan terbaru (= `periode_akhir`).
-- Alasannya bukan selera: matriks target Section D mengindeks bulan MAJU
-- (M1…Mn ke depan), dan baseline yang mengindeks mundur akan membuat setiap
-- pembacaan lintas-seksi menjadi jebakan.
COMMENT ON COLUMN strategi_baseline_bulan.month_index IS
  'M6A B-1/B-5 — 1 = bulan TERTUA dalam jendela B-0.7 (periode_mulai), n = '
  'terbaru (periode_akhir); searah dengan indeks bulan target Section D. Baris, '
  'bukan kolom m1/m2/m3 tetap (D11). Tren B-1.5 diturunkan dari urutan ini.';

COMMENT ON COLUMN strategi_channel.trafik_organik_persen IS
  'M6A B-2.3 — satu dari enam kolom komposisi trafik. Kolom, bukan jsonb: CHECK '
  'jumlah=100±0,5 (§7) akan LOLOS diam-diam kalau sebuah kunci jsonb hilang.';
