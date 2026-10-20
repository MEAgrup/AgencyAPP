<!-- Section asal docs/DECISIONS.md: Decided -->

| Date | Decision | Reason / trade-off | Approved by |
|---|---|---|---|
| 2026-08-29 | **🟢 LT-7 DIKONFIRMASI — tidak ada perubahan; `label` tetap identik `stage_code` di mana pun belum ada kebutuhan nyata.** Pemilik: "Aman dibiarkan kosmetik". Satu-satunya baris yang sekarang MEMANFAATKAN divergensi label/kode adalah checkpoint intake baru Live Stream (LT-5): `stage_code='Cek Brief AM'` (kontrak `reviewBrief`) dengan `label='Terima Brief AM'`. Selebihnya tetap identik sampai ada kebutuhan spesifik lain. | Mengubah `stage_code` setelah Brief berjalan lebih mahal (migrasi data) daripada mengubah `label` (nol biaya) — tidak ada urgensi mengubah lebih dari yang diminta. | Pemilik 2026-08-29 |
