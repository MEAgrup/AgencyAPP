-- ===========================================================================
-- D-3 (prasyarat) — `services.qty`: berapa unit yang benar-benar dibeli
-- ===========================================================================
--
-- KENAPA INI ADA. Mesin accrual butuh tahu berapa BULAN sebuah layanan
-- berjalan. Untuk versi katalog ber-`qty_menambah = 'durasi'`, jawabannya
-- `qty × durasi_bulan` (beli 6 GMV MAX 6-bulan = 36 bulan). Tapi `services`
-- TIDAK PERNAH menyimpan qty: closing Sales menuliskan SUBTOTAL baris ke
-- `standard_price` dan membuang penggandanya.
--
-- Akibatnya, tanpa kolom ini, D-3 tidak punya cara jujur untuk menghitung
-- angka bulan mana pun bagi mayoritas layanan.
--
-- ── Kenapa qty TIDAK diturunkan dari harga ─────────────────────────────────
--
-- Godaan yang jelas: `qty = standard_price / harga_katalog`. Diuji ke data
-- live sebelum ditulis (aturan kerja #12), dan data itu menolaknya:
--
--   * satu layanan berharga nego 6.000.000 atas katalog 7.500.000 ⇒ rasio 0,8.
--     qty sebenarnya 1. Rasio bilang "0,8", yang bukan qty apa pun.
--   * dua layanan "GMV Max" ber-katalog Rp 0 (harga terbuka) ⇒ pembagian nol.
--
-- Dan yang paling berbahaya bukan dua kasus itu, melainkan yang TIDAK
-- kelihatan: pembelian 3 unit dengan diskon sepertiga menghasilkan rasio
-- TEPAT 2,0 — bilangan bulat yang lolos setiap penyaringan dan salah. Rumus
-- yang gagalnya diam-diam lebih buruk daripada tidak punya rumus.
--
-- ── Kenapa NULLABLE, dan kenapa TIDAK ber-DEFAULT 1 ────────────────────────
--
-- `DEFAULT 1` akan mengisi setiap baris lama dengan sebuah TEBAKAN yang
-- kemudian tidak bisa dibedakan dari fakta. Aturan rumah #4: ketiadaan yang
-- diam tidak bisa dibedakan dari kerusakan. NULL di sini berarti satu hal yang
-- tepat — "tidak pernah dicatat" — dan mesin accrual WAJIB menolak menghitung
-- layanan `durasi` ber-qty NULL alih-alih menganggapnya 1.
--
-- Baris baru mengisinya dari Form Qualified; jalur closing & renewal yang
-- menulis tanpa qty adalah bug, bukan keadaan normal.
-- ===========================================================================

ALTER TABLE services ADD COLUMN qty numeric(15,2) NULL;

ALTER TABLE services ADD CONSTRAINT ck_services_qty_positif
    CHECK (qty IS NULL OR qty > 0);

COMMENT ON COLUMN services.qty IS
  'Berapa unit layanan ini dibeli. NULL = tidak pernah dicatat (baris lahir '
  'sebelum 20260924040000) — BUKAN 1. Mesin accrual menolak menghitung '
  'layanan qty_menambah=''durasi'' yang qty-nya NULL, karena menebak 1 di situ '
  'memendekkan masa layanan tanpa ada yang tahu.';

-- ---------------------------------------------------------------------------
-- Backfill — HANYA yang bisa dibuktikan, sisanya sengaja dibiarkan NULL
-- ---------------------------------------------------------------------------
--
-- Sumbernya `qualified_form_services.quantity`, baris Form Qualified yang
-- MELAHIRKAN layanan ini, dijangkau lewat `clients.winning_attempt_id`.
--
-- TIGA pagar, dan ketiganya perlu:
--
--   1. `q.subtotal = s.standard_price` — membuktikan baris form itu memang
--      baris yang jadi layanan ini, bukan baris lain yang kebetulan menyebut
--      layanan yang sama. Tanpa ini, harga nego yang berubah antara form dan
--      closing akan diam-diam membawa qty dari baris yang salah.
--   2. Tepat SATU baris form yang cocok (`count(*) = 1` di sub-kueri) — layanan
--      yang formnya ambigu tidak diisi sama sekali.
--   3. `q.quantity > 0` — nol bukan qty, itu baris rusak.
--
-- Layanan yang gagal salah satu pagar tetap NULL, dan itu HASIL YANG BENAR:
-- ia akan muncul sebagai "tidak terhitung" di snapshot D-3, dengan sebabnya,
-- alih-alih menyumbang angka karangan ke laporan keuangan.
WITH cocok AS (
    SELECT s.id AS service_id, min(q.quantity) AS qty
      FROM services s
      JOIN clients c ON c.id = s.client_id
      JOIN qualified_form_services q
        ON q.attempt_id = c.winning_attempt_id
       AND q.master_service_id = s.master_service_id
     WHERE c.winning_attempt_id IS NOT NULL
       AND q.subtotal = s.standard_price
       AND q.quantity > 0
     GROUP BY s.id
    HAVING count(*) = 1
)
UPDATE services s
   SET qty = k.qty
  FROM cocok k
 WHERE s.id = k.service_id;

-- Jejak audit: yang DIISI dan yang SENGAJA dilewati, dua-duanya tercatat.
-- Baris "dilewati" bukan basa-basi — ia yang menjawab "kenapa layanan ini
-- tidak punya angka" enam bulan lagi, tanpa harus menebak ulang.
INSERT INTO audit_log (entity_type, entity_id, actor_employee_id, action, before_json, after_json, created_by)
SELECT 'service', s.id, 'SYSTEM',
       CASE WHEN s.qty IS NULL THEN 'qty_dilewati_d3' ELSE 'qty_diisi_d3' END,
       jsonb_build_object('qty', NULL),
       jsonb_build_object('qty', s.qty,
                          'sebab', CASE WHEN s.qty IS NULL
                                        THEN 'baris Form Qualified tidak ditemukan, tidak tunggal, atau subtotalnya berbeda dari harga layanan'
                                        ELSE 'diambil dari qualified_form_services.quantity' END),
       'SYSTEM'
  FROM services s;
