<!-- Section asal docs/DECISIONS.md: Open -->

| # | Item | Needed from | Blocking? |
|---|---|---|---|
| JALUR-PLAN-WAJIB-DIRECT | 🟡 **BARU 2026-10-19 — bolehkah service ber-tier `plan_wajib` diubah ke jalur Direct lewat override M6-OA-1?** M6-OA-1 (2026-07-14) mengizinkan override ke dua arah untuk layanan apa pun; M6C S4 (2026-08-06) mengunci `plan_wajib` "locked on". Sampai diputus, server MENOLAK override ke Direct untuk `plan_wajib`. Dua hal butuh jawaban: (a) kebijakannya — tetap terkunci, atau boleh dengan persetujuan siapa (Hans/Director)?; (b) persetujuan string BI `[layanan ber-tier Plan Wajib tidak dapat diubah ke jalur Direct tanpa persetujuan]`. | Hans | Tidak — override ke arah Plan-gated dan untuk tier lain tetap jalan |
