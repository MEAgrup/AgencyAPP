<!-- Section asal docs/DECISIONS.md: Wave 1 Integration (A↔B merge — 2026-07-11) -->

| Date | Decision | Reason / trade-off | Approved by |
|---|---|---|---|
| 2026-07-16 | **Basis komisi persentase = subtotal baris.** Grammar O14 tetap dua bentuk; `"<N>% of standard price"` kini dihitung dari subtotal baris kalkulator (nilai jasa terhitung), bukan unit price; `"flat Rp <N>"` tidak berubah. Backward-compatible: baris lama flat qty=1 → subtotal = standard_price. | dengan harga ber-satuan, unit price bukan lagi nilai deal; komisi wajar dihitung dari nilai baris. | Yohan (paket keputusan MSL v2). |
