<!-- Section asal docs/DECISIONS.md: Decided -->

| Date | Decision | Reason / trade-off | Approved by |
|---|---|---|---|
| 2026-09-08 | **🟠 TEMUAN PROSES — A-req-3 (`private.brief_jumlah_anak`, migrasi `20260922100500`) TERTINGGAL dari live sampai 2026-09-08: kolom "Unit Kerja" di `/tasks` tidak pernah berfungsi di produksi sejak dirilis.** Ditemukan lewat **pembandingan repo↔live** (diff nama migrasi per-slug terhadap `supabase_migrations.schema_migrations`), **bukan** oleh tes mana pun — tes domain memakai koneksi service-role dan buta terhadap kelas cacat ini (kelas yang sama dengan `client_milestones`: subquery yang dipersempit RLS mengembalikan angka salah tanpa galat apa pun). Ditutup di A2 (baris di atas). | **Pembandingan repo↔live tidak punya gerbang otomatis sama sekali hari ini** — A-req-3 hilang dari live berbulan-bulan tanpa satu pun sinyal merah. Dicatat juga sebagai usulan proses: kandidat pekerjaan **B3** (`HANDOFF_PENUTUP_REVISI_OD_20260908.md` §4). | Claude |
