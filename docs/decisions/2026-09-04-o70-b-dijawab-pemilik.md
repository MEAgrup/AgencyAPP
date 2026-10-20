<!-- Section asal docs/DECISIONS.md: Decided -->

| Date | Decision | Reason / trade-off | Approved by |
|---|---|---|---|
| 2026-09-04 | **🟢 O70-b dijawab pemilik — Ads Scanner BELUM dipakai di aplikasi, jadi tidak ada scan produksi yang perlu dijalankan ulang.** Peringatan "scan tersimpan sebelum 2026-09-04 memuat angka salah" (O70) **tidak berlaku** untuk data nyata mana pun: baris `adsscanner_run` yang ada hanyalah hasil uji. | Menghapus satu-satunya konsekuensi retroaktif O70. Tetap dicatat di sini alih-alih dihapus diam-diam, supaya pembaca O70 tahu kenapa tak ada pekerjaan migrasi data yang menyertainya — dan supaya kalau kelak ditemukan scan lama, jelas bahwa asumsi ini yang dipakai. | Yohan (via Nerissa) |
