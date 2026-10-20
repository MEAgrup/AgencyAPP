<!-- Section asal docs/DECISIONS.md: Open -->

| # | Item | Needed from | Blocking? |
|---|---|---|---|
| RA-1 | ✅ **DIJAWAB 2026-08-13 (lihat Decided baris teratas) — 2–3 hari kerja, dan pemilik sekaligus memberi ambang langkah 2 (1–2) & 3 (5–7).** Terpasang sebagai `kelola_klien_sla_config` v1 + tiga flag harian. Baris asli: ambang SLA langkah 1 (Riset Awal): berapa lama riset awal BOLEH berjalan? Pengukurannya sudah hidup (`interview_riset_awal`; durasi turunan dari `dimulai_pada`/`disubmit_pada`), tapi TIDAK ada ambang, flag terlambat, maupun eskalasi — berapa hari itu "wajar" adalah fakta bisnis Account, bukan tebakan. Begitu pemilik menyebut angkanya, ia masuk sebagai config berversi (pola `kualifikasi_config`) + flag harian (pola `prasyarat_bersyarat_terlambat`), bukan literal di kode. | Pemilik / Head of Account | Tidak — pengukuran & UI langkah 1 sudah berjalan tanpa ambang |
