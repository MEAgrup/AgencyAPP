<!-- Section asal docs/DECISIONS.md: Decided -->

| Date | Decision | Reason / trade-off | Approved by |
|---|---|---|---|
| 2026-08-29 | **🟢 LT-10 DIKONFIRMASI — Ads Management Date memang HARI KALENDER, bukan hari kerja.** Pemilik: "Gunakan hari kalender. bukan hari kerja". Nol kode berubah — implementasi `addCalendarDays` (`ads.ts` computeManagementDate) sudah kalender sejak awal (tebakan implementasi ternyata tepat); PRD §Ads Management Date + `DATA_MODEL.md` M16 sekarang menyatakannya eksplisit supaya baris Open LT-10 tidak lagi mengandalkan bacaan implisit. Kolom BARU (bukan `end_date` lama `ADC-`) juga tidak dipersoalkan pemilik — dianggap terkonfirmasi bersamaan. | Konfirmasi eksplisit menutup risiko "tebakan implementasi meleset lalu perlu migrasi data `ads_management_date`" yang dicatat di baris Open aslinya — sekarang tidak ada risiko itu lagi karena tebakannya benar. | Pemilik 2026-08-29 |
