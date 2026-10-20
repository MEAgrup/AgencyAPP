<!-- Section asal docs/DECISIONS.md: Decided -->

| Date | Decision | Reason / trade-off | Approved by |
|---|---|---|---|
| 2026-09-14 | **`BRF-202609-0003` dipindah dari divisi `Ops` ke `Store Operation`** (migrasi `20261016010000_brief_ops_yatim_ke_store_operation.sql`, sudah diterapkan ke live). Pemilik mengonfirmasi Brief itu artefak testing dan boleh dihapus atau dipindah; dipilih dipindah karena rumah tangga #3 tidak menyediakan jalur DELETE bagi baris berjejak audit, dan `sku` memang pekerjaan toko. | Brief itu macet dua belas hari justru karena divisinya nol karyawan. `Store Operation` akan diisi tiga orang pada perapihan ini. | **Nerissa (COO/Director)** |
