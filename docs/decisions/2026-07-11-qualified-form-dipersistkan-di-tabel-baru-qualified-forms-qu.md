<!-- Section asal docs/DECISIONS.md: Wave 1 Integration (A↔B merge — 2026-07-11) -->

| Date | Decision | Reason / trade-off | Approved by |
|---|---|---|---|
| 2026-07-11 | **Qualified Form dipersistkan di tabel baru `qualified_forms` + `qualified_form_services` (migrasi 0006).** 0002 tidak punya tabel qualified form; ia menyimpan client-draft + layanan terpilih (versi MSL di-pin saat submit) di antara qualifikasi dan closing. Closing membaca ini + proposal versi ter-approve untuk melahirkan baris `clients`/`services`. Rentang migrasi integrasi: M1 tidak butuh migrasi baru (`leads.winning_attempt_id` sudah ada di 0002); M0 = 0006 (qualified forms). | Kontrak 0002 beku; kolom baru hanya via migrasi baru. | Dev (integrator) |
