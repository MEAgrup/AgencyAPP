-- G3-02a — tabel fakta baru untuk modul `shopee_chat` ("Performa Chat",
-- sheet "Kriteria Utama"). docs/backlog/PDT_BACKLOG.md G3-02 mencatat gap ini
-- eksplisit: "chatResponseRatePersen/chatResponseMenit belum punya tabel
-- fakta apa pun (modul parser terdeteksi sejak G1-09 sub-2b-ii, tapi nol
-- writer)" — sub-tiket bernomor sendiri (G3-02a), pola SAMA
-- `20261106010000_g2_01_shopee_kesehatan_writer.sql` (modul lain yang juga
-- terdaftar+terdeteksi sejak awal tapi nol penulis fakta sampai tiketnya
-- sendiri).
--
-- Bentuk berkas (satu baris ringkasan "Kriteria Utama" untuk RENTANG PERIODE
-- yang AM pilih saat ekspor, `report/shopee/metrik.ts` `parseChat`'s
-- `rows[iH+1]`) TIDAK punya identitas natural per-baris — pola SAMA
-- `pdt_fact_kesehatan_penalti`/`pdt_fact_ads`: replace-on-recommit (DELETE
-- scope client_platform_id+periode, lalu INSERT ulang), bukan ON CONFLICT.
--
-- `chat_masuk`/`chat_dibalas` disimpan MENTAH (bukan rasio pra-hitung) —
-- konsumen (`packages/domain/src/pdt-prefill.ts`, G3-02a lanjutan) menghitung
-- `chatResponseRatePersen` = Σchat_dibalas/Σchat_masuk×100, pola ratio-of-sums
-- yang sama dipakai seluruh rasio PDT lain (`report/shopee/metrik.ts:832`) —
-- BUKAN dari kolom `Tingkat Konversi (Chat Dibalas)` (disimpan di sini APA
-- ADANYA sebagai `tingkat_konversi_chat_dibalas`, insight/tampilan, BUKAN
-- pengganti response rate — `modules.ts` `shopee_chat` sudah mendokumentasikan
-- dua kolom ini SEMANTIKNYA BEDA, jangan disubstitusi).
-- `waktu_respon_detik` — Shopee mengekspornya dalam DETIK (dikonfirmasi
-- `docs/DECISIONS.md` 2026-09-06 "B-4 Shopee otomatis", jalur payload lama
-- yang sudah memakai kolom sama); konversi ke menit terjadi di pemanggil
-- (pola sama `detikKeMenit`, `packages/core/src/baseline/section-b.ts`),
-- BUKAN disimpan sebagai menit di sini (Rule 4: kolom mentah, turunan
-- dihitung ulang selalu).
CREATE TABLE pdt_fact_layanan_chat (
    id                             bigint        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    client_platform_id             bigint        NOT NULL REFERENCES client_platforms (id),
    periode                        date          NOT NULL, -- awal bulan, pola sama pdt_fact_sku_period/pdt_fact_creator_period
    batch_id                       bigint        NOT NULL REFERENCES pdt_upload_batch (id),
    parser_versi                   integer       NOT NULL,

    pengunjung                     integer       NULL, -- konsumen: belum ada (insight)
    chat_masuk                     integer       NULL, -- konsumen: pdt-prefill.ts Σ (chatResponseRatePersen denominator)
    chat_dibalas                   integer       NULL, -- konsumen: pdt-prefill.ts Σ (chatResponseRatePersen numerator)
    waktu_respon_detik             integer       NULL, -- konsumen: pdt-prefill.ts (chatResponseMenit, detik→menit di pemanggil)
    csat_persen                    numeric(6,2)  NULL, -- konsumen: belum ada (insight)
    total_pesanan                  integer       NULL, -- konsumen: belum ada (insight)
    penjualan                      numeric(15,2) NULL, -- konsumen: belum ada (insight, "Penjualan (IDR)" dari chat)
    tingkat_konversi_chat_dibalas  numeric(6,2)  NULL  -- insight APA ADANYA — BUKAN response rate, lihat catatan di atas
);
CREATE INDEX idx_pdt_flc_client_periode ON pdt_fact_layanan_chat (client_platform_id, periode);
CREATE INDEX idx_pdt_flc_batch ON pdt_fact_layanan_chat (batch_id);

REVOKE ALL ON public.pdt_fact_layanan_chat FROM anon;
REVOKE ALL ON public.pdt_fact_layanan_chat FROM authenticated;
GRANT SELECT ON public.pdt_fact_layanan_chat TO authenticated;
ALTER TABLE public.pdt_fact_layanan_chat ENABLE ROW LEVEL SECURITY;
CREATE POLICY pdt_fact_layanan_chat_sel ON public.pdt_fact_layanan_chat FOR SELECT TO authenticated
  USING (public.jwt_can_read_all()
         OR (public.jwt_is_lead() AND public.jwt_division() = 'Account')
         OR public.jwt_owns_client_platform_am(client_platform_id));

COMMENT ON TABLE pdt_fact_layanan_chat IS
  'G3-02a — satu baris ringkasan per unggahan `shopee_chat` ("Bisnis — Performa Chat", sheet '
  '"Kriteria Utama"), replace-on-recommit per (client_platform_id, periode) (nol identitas '
  'natural per-baris di sumber, sama pola pdt_fact_kesehatan_penalti/pdt_fact_ads). Konsumen: '
  'strategi.ts Section B-4.2 (chatResponseRatePersen/chatResponseMenit) via pdt-prefill.ts.';

-- Gerbang CI — SATU tabel baru (nol prefix/lifecycle/notifikasi baru — fakta murni,
-- sama kelas pdt_fact_kesehatan_penalti):
--   public base tables : 182 → 183
--   entity_prefix      : 45 → 45
--   sm_machines        : 35 → 35
--   notif_events       : 76 → 76
