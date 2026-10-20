<!-- Section asal docs/DECISIONS.md: Open -->

| # | Item | Needed from | Blocking? |
|---|---|---|---|
| LT-7 | ✅ **RESOLVED 2026-08-29 (lihat Decided) — dikonfirmasi, tetap identik kecuali checkpoint intake Live Stream (LT-5).** Teks asli: 🟡 **BARU 2026-08-31 (M16, Akun A) — `stage_definition.label` diisi identik `stage_code` di seed**, karena tak satu pun dokumen memberi contoh di mana label BI berbeda dari kode tahap. Kalau nanti dibutuhkan label tampil terpisah dari kode, itu satu migrasi `UPDATE stage_definition` — tapi mengubah `stage_code` SETELAH Brief berjalan berarti migrasi data pada `briefs.production_stage` + `sm_edges`, jadi sebaiknya diputuskan sebelum divisi pertama mulai memakai pipeline. | Pemilik | **Tidak** memblokir — kosmetik; makin lama ditunda makin mahal diubah (migrasi data, bukan cuma seed) |
