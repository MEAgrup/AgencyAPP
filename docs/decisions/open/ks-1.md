<!-- Section asal docs/DECISIONS.md: Open -->

| # | Item | Needed from | Blocking? |
|---|---|---|---|
| KS-1 | ✅ **DIJAWAB 2026-08-29 (pemilik) — TIDAK DIBANGUN, dan tidak akan dibangun.** Tiering T1–T5 ternyata adalah nilai perhitungan KOMISI yang didapat tim sales dari hasil penjualan (bukan band performa independen seperti diduga), dan ambangnya berubah PER KUARTAL. Karena CDPS sudah mencatat nilai penjualan sales (`salesperf.bySalesperson`/`byMonth`), pemilik memilih menghitungnya manual di luar sistem tiap kuartal — mengkodekan tabel tier yang berubah tiap 3 bulan adalah kerja migrasi berulang untuk sesuatu yang sudah bisa dibaca dari dashboard yang ada. _Konteks asli:_ Tiering T1–T5 (sheet `Rekapan input sales`) tidak punya definisi di PRD manapun; beda kelas dari Level Sales (§3a, dari `employees.jabatan`). | Ditutup — Pemilik | Tidak pernah memblokir; sekarang resmi di luar cakupan |
