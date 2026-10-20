<!-- Section asal docs/DECISIONS.md: Decided -->

| Date | Decision | Reason / trade-off | Approved by |
|---|---|---|---|
| 2026-09-20 | **Tes G3-03 lama menaruh fakta SKU HANYA di TikTok, dan meng-assert Shopee kosong justru karena Shopee-nya nol batch** — jalur Shopee ber-fakta tidak pernah dijalankan sama sekali. Ditambah tes Shopee terpisah yang memakai basis `dibayar` (yang writer sungguhan tulis). | Inilah alasan cacat di atas hidup tanpa satu pun tes merah: basis TikTok (`net`) kebetulan cocok dengan yang diminta, jadi satu-satunya platform yang diuji adalah platform yang tidak punya masalah. Tes baru terbukti merah tanpa perbaikan (`expected null to be 1`). Ia juga sengaja memakai `nama_produk` null, karena `shopee_ams_produk` memang tidak menulis kolom itu dan B-3.3 jatuh ke `platform_product_id` — mengunci perilaku apa adanya, bukan versi idealnya. | Claude Code |
