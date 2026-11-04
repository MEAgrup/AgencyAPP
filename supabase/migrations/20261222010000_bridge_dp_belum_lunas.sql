-- =============================================================================
-- BRIDGE-DP (opsi b) — klien MEAGO yang order-nya diteruskan saat baru DP
-- ditandai "belum lunas" untuk follow-up Finance.
--
-- Keputusan: docs/decisions/2026-11-04-bridge-dp-accept-opsi-b.md (pemilik,
-- 2026-11-04), menjawab open/bridge-kebijakan-accept-order-dp.md. Konteks:
-- MSDPS 0377 meneruskan order begitu pembayaran PERTAMA terverifikasi — DP pun
-- cukup — dan menempelkan ringkasannya di `lines[].catatan` payload v1
-- (kontrak tidak berubah).
--
-- 1. Dua kolom NULLABLE di `client_external_billing`, diisi SEKALI oleh
--    `bridge.accept` dari hasil parse catatan (`bridge.ringkasanPembayaranOrder`):
--      persen_terbayar_saat_diteruskan   — persen seperti dicetak MSDPS
--                                          (dibulatkan ke bawah, 1 desimal)
--      nominal_terbayar_saat_diteruskan  — rupiah yang sudah terverifikasi
--    NULL = order tanpa info pembayaran (sebelum 2026-11-04). Kurang dari 100
--    = "belum lunas saat diteruskan". Tabel tetap append-only
--    (`trg_client_external_billing_frozen` tidak disentuh): ini SNAPSHOT,
--    sama seperti atestasinya. MSDPS Fase 1 tidak mengirim update pelunasan,
--    jadi CDPS tidak pernah mengubah angka ini — konfirmasi pelunasan berada
--    di luar tabel ini.
--
-- 2. `client_external_billing_select` diperluas: divisi Finance (staff
--    maupun lead) membaca seluruh baris — merekalah yang mem-follow-up.
--    Preseden persis O41 (20260729032805): Finance semua level adalah pemilik
--    antreannya sendiri, dan arm lead-saja memberi staff daftar KOSONG tanpa
--    error. `clients_select` sudah memuat `jwt_division() = 'Finance'`, jadi
--    nama toko di daftar follow-up ikut terbaca. Tulis tetap nol policy
--    (hanya `bridge.accept` lewat service role).
-- =============================================================================

ALTER TABLE public.client_external_billing
    ADD COLUMN persen_terbayar_saat_diteruskan  numeric(4,1)  NULL,
    ADD COLUMN nominal_terbayar_saat_diteruskan numeric(15,2) NULL;

ALTER TABLE public.client_external_billing
    ADD CONSTRAINT ck_ceb_persen_terbayar CHECK (
        persen_terbayar_saat_diteruskan IS NULL
        OR (persen_terbayar_saat_diteruskan >= 0 AND persen_terbayar_saat_diteruskan <= 100)),
    ADD CONSTRAINT ck_ceb_nominal_terbayar CHECK (
        nominal_terbayar_saat_diteruskan IS NULL OR nominal_terbayar_saat_diteruskan >= 0);

COMMENT ON COLUMN public.client_external_billing.persen_terbayar_saat_diteruskan IS
  'BRIDGE-DP (2026-11-04): persen pembayaran klien yang sudah diverifikasi MSDPS '
  'SAAT order diteruskan, di-parse dari lines[].catatan payload (MSDPS 0377). '
  'NULL = order tanpa info (sebelum 0377). < 100 = belum lunas, follow-up Finance. '
  'Snapshot — tidak pernah diperbarui (Fase 1 tanpa callback pelunasan).';

COMMENT ON COLUMN public.client_external_billing.nominal_terbayar_saat_diteruskan IS
  'BRIDGE-DP (2026-11-04): rupiah yang sudah diverifikasi MSDPS saat order '
  'diteruskan. Pasangan persen_terbayar_saat_diteruskan; total kontrak = nilai.';

CREATE INDEX idx_ceb_belum_lunas ON public.client_external_billing (created_at DESC)
    WHERE persen_terbayar_saat_diteruskan < 100;

DROP POLICY IF EXISTS client_external_billing_select ON public.client_external_billing;
CREATE POLICY client_external_billing_select ON public.client_external_billing FOR SELECT TO authenticated
USING (public.jwt_can_read_all()
       OR (public.jwt_is_lead() AND public.jwt_division() = 'Account')
       OR public.jwt_division() = 'Finance'
       OR private.jwt_owns_client(client_id));

COMMENT ON POLICY client_external_billing_select ON public.client_external_billing IS
  'Bridge Fase 1: read-all, lead Account, AM pemilik klien. BRIDGE-DP '
  '(2026-11-04): + divisi Finance semua level (follow-up klien belum lunas; '
  'preseden O41 20260729032805).';
