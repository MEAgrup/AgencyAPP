<!-- Section asal docs/DECISIONS.md: Open -->

| # | Item | Needed from | Blocking? |
|---|---|---|---|
| D-4-DASAR | ✅ **DIKETOK 2026-09-08 — SEBELUM PPN, dan PPN jadi kolom tambahan.** Dibangun di migrasi 191 + `sales.ts`/`renewal.ts`; rinciannya di baris `Decided` 2026-09-08. Baris ini ditinggalkan sebagai jejak, bukan sebagai pertanyaan terbuka. ~~**(dibuka 2026-09-08) Laporan accrual membaca angka SEBELUM atau SESUDAH PPN?**~~ `sales.ts` hari ini menyimpan `subtotal` yang **sudah ditambah 11%** ketika `apply_ppn` menyala. Mesin accrual menerima apa pun yang diberikan dan tidak menghitung PPN sendiri (sesuai D-4), jadi pertanyaannya ada di pemanggilnya. | Tidak memblokir mesin; memblokir **wiring laporan**. Penanda dan subtotal sama-sama tersimpan sehingga kedua angka masih bisa dipulihkan kapan pun — tapi memilihnya diam-diam berarti seluruh laporan keuangan berbeda 11% tanpa ada yang menyebutkannya. | ✅ Yohan Agustian, 2026-09-08 | ✅ **tidak lagi** |
