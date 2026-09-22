-- M20 Gelombang E, E-03: penulis entri metrik Ads dari laporan PDT (ROAS
-- Attainment). `metric_entries` (M8, migrasi 20260722055644) sebelumnya
-- "periodic performance input, additive" — nol kolom penanda asal baris, nol
-- jalan hapus. PDT butuh KEDUANYA: `pdt_laporan_kiriman` BUKAN append-only
-- sekali per periode seperti `client_reports` M14 (AM boleh Cabut lalu
-- Terbitkan-Ulang periode yang sama berkali-kali, R4/R5), jadi baris yang
-- ditulis mesin PDT untuk satu (toko, bulan) harus bisa ditulis ULANG UTUH
-- setiap kali status terbit toko+bulan itu berubah — bukan menumpuk versi
-- lama selamanya. Keputusan pemilik (`AskUserQuestion`, dicatat
-- `docs/DECISIONS.md` M20-E03-ADS-METRIC-ENTRIES): hapus-tulis-ulang per
-- transisi terbit, digenerasi ulang dari agregat `pdt_fact_ads` terkini.
--
-- `source` nullable — baris LAMA (manual/M14 SH-06) tidak tersentuh, tetap
-- NULL selamanya. `pdt_client_platform_id`/`pdt_periode` adalah kunci
-- hapus-tulis-ulang (satu toko + satu bulan = satu generasi baris PDT).
-- Constraint menjaga ketiganya konsisten: `source='pdt'` WAJIB membawa
-- keduanya, baris non-PDT WAJIB nol keduanya — supaya query hapus-tulis-ulang
-- (`delete ... where source='pdt' and pdt_client_platform_id=... and
-- pdt_periode=...`) tidak bisa salah sasaran menghapus baris lain.
ALTER TABLE metric_entries
  ADD COLUMN source varchar(16) NULL,
  ADD COLUMN pdt_client_platform_id bigint NULL REFERENCES client_platforms (id),
  ADD COLUMN pdt_periode date NULL,
  ADD CONSTRAINT ck_mtr_pdt_scope CHECK (
    (source = 'pdt' AND pdt_client_platform_id IS NOT NULL AND pdt_periode IS NOT NULL)
    OR (source IS DISTINCT FROM 'pdt' AND pdt_client_platform_id IS NULL AND pdt_periode IS NULL)
  );

CREATE INDEX idx_mtr_pdt_scope ON metric_entries (pdt_client_platform_id, pdt_periode) WHERE source = 'pdt';
