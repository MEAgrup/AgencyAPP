<!-- Section asal docs/DECISIONS.md: Decided -->

| Date | Decision | Reason / trade-off | Approved by |
|---|---|---|---|
| 2026-08-29 | **🟢 LT-6 DIKONFIRMASI — `gate_pihak='AM'` memang gerbang PERAN, bukan pengecualian lead time; tetap terhitung.** Pemilik: "jalankan rekomendasi" (rekomendasinya sendiri murni konfirmasi, bukan perubahan). Nol kode berubah — interpretasi konservatif ini sudah berjalan sejak `stage_definition` pertama kali diseed (`Approve` AI Optimizer SKU) dan tetap dipakai identik untuk checkpoint AM baru LT-4/LT-5 (`Brief Dikembalikan ke AM`). Didokumentasikan verbatim di `STATE_MACHINES.md` §18. | Interpretasi konservatif berarti risiko salah hanya under-count (bukan over-count) — aman dipertahankan tanpa perubahan kode. | Pemilik 2026-08-29 |
