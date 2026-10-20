<!-- Section asal docs/DECISIONS.md: Decided -->

| Date | Decision | Reason / trade-off | Approved by |
|---|---|---|---|
| 2026-09-08 | **🟠 UTANG YANG DISEBUT, BUKAN DIKLAIM BERES — `services.standard_price` belum dijaga pagar bulan tertutup.** Mengubah harga sebuah layanan mengubah pendapatan accrual bulan-bulan yang mungkin sudah ditutup. Pagar `jaga_periode_tertutup` menjaga `payment_verifications.received_date` dan `installments.verified_date` (tiga arah: mendarat, berangkat, dihapus), **tidak** harga layanan. | Pagarnya butuh menjalankan mesin accrual DI DALAM trigger untuk tahu bulan mana saja yang terpengaruh — mahal, dan melingkar. Yang benar adalah **melarang UPDATE harga pada layanan yang sudah pernah masuk snapshot mana pun**; itu pekerjaan terpisah, bukan tambalan di migrasi ini. Ditulis juga di komentar `20260925030000`. | Claude |
