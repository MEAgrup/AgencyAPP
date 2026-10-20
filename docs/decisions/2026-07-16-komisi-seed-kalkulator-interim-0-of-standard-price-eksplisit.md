<!-- Section asal docs/DECISIONS.md: Wave 1 Integration (A↔B merge — 2026-07-11) -->

| Date | Decision | Reason / trade-off | Approved by |
|---|---|---|---|
| 2026-07-16 | **Komisi seed kalkulator = interim `0% of standard price` (eksplisit).** Sheet kalkulator tidak memuat aturan komisi sales; sesuai O3/OD-2 penetapnya Sales Head. Seed memakai 0% eksplisit (komisi Rp0 terlihat jelas, tidak menghitung komisi fiktif) sampai Sales Head mengisi via admin MSL — dicatat sebagai Open O24. | tidak menebak angka komisi (house rule); 0% eksplisit lebih aman daripada placeholder yang gagal parse di jalur uang. | Yohan (paket keputusan MSL v2). |
