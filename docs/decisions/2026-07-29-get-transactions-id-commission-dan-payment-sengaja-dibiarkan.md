<!-- Section asal docs/DECISIONS.md: Decided -->

| Date | Decision | Reason / trade-off | Approved by |
|---|---|---|---|
| 2026-07-29 | **`GET /transactions/{id}/commission` dan `/payment` SENGAJA dibiarkan mengirim read model camelCase mentah.** Keduanya mengaku mem-port `handleGetCommissionAchievement`/`handleGetPaymentStatus`; kedua handler itu **tidak ada** di Go, dan `web-internal` tidak memanggil kedua path itu dari mana pun. Komentar provenance palsunya dikoreksi dan keduanya ditandai eksplisit sebagai residu O43 di dalam kode. | Tanpa oracle Go **dan** tanpa konsumen FE, menamai kunci wire sekarang berarti mengarang kontrak — persis yang dilarang aturan rumah ("never invent fields"). Menandainya di tempat lebih jujur daripada menebak snake_case lalu membuat penulis halaman pertama percaya bentuk itu sudah disepakati. Nol risiko hari ini (nol pemanggil); risikonya hanya laten. | Claude (keputusan teknis, dicatat bukan diputuskan sendiri untuk arah produk) |
