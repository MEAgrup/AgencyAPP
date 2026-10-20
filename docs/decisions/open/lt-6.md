<!-- Section asal docs/DECISIONS.md: Open -->

| # | Item | Needed from | Blocking? |
|---|---|---|---|
| LT-6 | ✅ **RESOLVED 2026-08-29 (lihat Decided) — dikonfirmasi, nol kode berubah.** Teks asli: 🟡 **BARU 2026-08-31 (M16, Akun A) — `gate_pihak='AM'` dipilih sebagai gerbang PERAN (hanya AM pemilik klien/Director boleh menjalankan transisi keluar), BUKAN pengecualian dari lead time.** Hanya `gate_pihak='KLIEN'` yang dikecualikan dari `computeStageLeadTime`, sesuai teks Rule 9 yang literal — latensi AM sudah diukur terpisah lewat `turnaroundKerjaHours`/`waktuAmBelumBuka` (§6 PRD, mesin `brief_task`), jadi mengecualikan `'AM'` JUGA dari lead time `brief_stage` akan menghilangkan sinyal "tahap Approve lambat" tanpa alasan eksplisit di PRD. Perlu konfirmasi makna `gate_pihak='AM'`. | Pemilik | **Tidak** memblokir — interpretasi konservatif (tetap terukur) dipilih; salah pilih di sini under-count, bukan over-count |
