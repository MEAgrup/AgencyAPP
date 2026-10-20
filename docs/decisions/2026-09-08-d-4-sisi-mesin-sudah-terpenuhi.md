<!-- Section asal docs/DECISIONS.md: Decided -->

| Date | Decision | Reason / trade-off | Approved by |
|---|---|---|---|
| 2026-09-08 | **🟢 D-4 SISI MESIN SUDAH TERPENUHI — mesin accrual tidak menyentuh PPN, dan ada tesnya.** Penanda pilihan PPN per transaksi juga **sudah ada sejak dulu**: `sales.ts` menyimpan `apply_ppn` per BARIS kalkulator (di-seed dari `apply_ppn` versi MSL yang di-pin, lalu bisa diubah). | Yang TERSISA dari D-4 bukan pekerjaan mesin, melainkan satu keputusan wiring: angka mana yang dibaca laporan accrual — `subtotal` yang hari ini sudah **termasuk** PPN saat penandanya menyala (`sales.ts` menambah 11%), atau nilai sebelum PPN. Keduanya masih bisa dipulihkan karena penanda dan subtotalnya sama-sama tersimpan. Dicatat sebagai baris Open, bukan ditebak. | Claude (build) |
