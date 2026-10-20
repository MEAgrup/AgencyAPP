<!-- Section asal docs/DECISIONS.md: Bridge MSDPS→CDPS Fase 1 (2026-09-10) — MENGGANTIKAN butir (7) entri 2026-07-12 -->

| Tanggal | Keputusan | Alasan | Approved by |
|---|---|---|---|
| 2026-09-10 | **Opsi A (order bridge) dikunci: MSDPS mendorong work order ke inbox CDPS (`ORD-`); manusia CDPS menerima; CDPS menjalankan eksekusi. Fase 1 = SATU ARAH, TANPA callback.** Opsi B (staff agency dapat akun MSDPS) ditolak — akan membuat MSDPS M6–M10 jadi source-of-truth eksekusi KEDUA dan menskor orang yang sama dua kali di M14. Opsi C (merge satu app) ditolak untuk sekarang — 217+80 migrasi, dua auth realm, dua prefix registry; program dua-kuartal, bukan bridge; Opsi A tidak menutup jalan ke sana nanti. | MSDPS memiliki merchant/deal/uang/eksekusi creator-POI; CDPS memiliki eksekusi divisi agency + orang yang mengerjakannya. Neither writes the other's rows, ever. | Yohan Agustian |
