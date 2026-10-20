<!-- Section asal docs/DECISIONS.md: Decided -->

| Date | Decision | Reason / trade-off | Approved by |
|---|---|---|---|
| 2026-09-20 | **B-4.1/B-4.3 (rating, jumlah ulasan, % pesanan terlambat), B-6.3 (komisi open/target), B-7.3/B-7.4 (host & studio), B-8.3 (beban promo terhadap margin) dan B-9 DIPASTIKAN tetap manual** — `SELALU_MANUAL` benar, bukan daftar usang. | Diperiksa ulang atas ZIP Shopee nyata (fim motor, Jul 2026, 15 berkas): modul `shopee_kesehatan` hanya memanen `Poin Penalti`/`Deskripsi`/`Durasi`, jadi rating/ulasan/pesanan-terlambat memang tidak punya kolom di export mana pun. `pdt_fact_promo` (G4-03) ADA isinya (5 baris) tapi hanya membawa `penjualan_dibuat`/`penjualan_siap_dikirim` — penjualan LEWAT promo, bukan BIAYA promo; PRD B-8.3 meminta "beban promo terhadap MARGIN", jadi menurunkannya dari situ berarti memasang label yang salah pada angka yang lain. Tidak mengarang lebih baik daripada mengisi otomatis dengan metrik yang berbeda. | Claude Code |
