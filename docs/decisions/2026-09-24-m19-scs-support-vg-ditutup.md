<!-- Section asal docs/DECISIONS.md: Bridge MSDPS→CDPS Fase 1 (2026-09-10) — MENGGANTIKAN butir (7) entri 2026-07-12 -->

| Tanggal | Keputusan | Alasan | Approved by |
|---|---|---|---|
| 2026-09-24 | **M19-SCS-SUPPORT-VG DITUTUP — pemilik memilih deviasi sadar dari Gap B: cross-link `support_vg` TIDAK dibangun.** Dijawab via `AskUserQuestion` sebagai bagian dari survei backlog pasca-M20/A2-DRIFT/LIVE-MIGRATION-LAG-F0X (nol item otonom tersisa). SCS (`scs_tasks`) dan grid jadwal produksi M19 (`prod_slots`) tetap TIDAK bertaut — kolom `support_vg` FK `employees` tidak ditambahkan ke `scs_tasks`. **Nol perubahan skema/kode.** Konsekuensi diterima sadar: kemampuan lapor "shoot siapa yang ditopang minggu ini" tidak akan ada sampai pemilik meminta ulang; 21 Kategori dan seluruh alur SCS tetap berjalan penuh tanpanya (baris Open aslinya sudah mencatat ini nol blocker). | Yohan Agustian, via `AskUserQuestion`: **"No, leave it out (Recommended for now)"** | Yohan Agustian |
