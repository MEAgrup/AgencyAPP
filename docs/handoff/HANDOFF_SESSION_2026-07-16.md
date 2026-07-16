# Handoff — Sesi 2026-07-16 (M1 v2 dedup kolaboratif + O19)

> Sesi orkestrasi multi-model (Fable orchestrator/QC; eksekutor Opus/Sonnet/Haiku).
> Baca setelah `HANDOFF_JALUR_B_SESSION2.md` — dokumen itu tetap berlaku untuk
> langkah import data riil; dokumen ini mencatat apa yang berubah sesudahnya.

## Yang selesai di sesi ini (branch `claude/fable-orchestrator-multi-model-arqtkn`)

1. **M1 v2 — dedup kolaboratif** (keputusan Nerissa 2026-07-10, dulu handoff ke
   stream A; stream sudah menyatu sehingga dikerjakan di sini):
   - Registrasi tunggal Sales atas lead yang dipegang sales lain = **JOIN**
     (attempt paralel dilampirkan), bukan blokir. Pesan blokir lama pensiun.
   - Re-registrasi pemegang sama diblokir `[lead ini sudah anda pegang & masih diproses]`.
   - Joiner menerima info non-blocking `[lead juga sedang dikerjakan sales lain (nama)]`
     di respons registrasi; pemilik existing dinotifikasi via event katalog baru
     `m1.lead.collab_joined` (katalog 13→14).
   - Import Marketing TIDAK berubah (hard-dedup tetap).
   - Win resolution existing tetap menutup kolaborator kalah `[Closed - Kalah Kompetisi]`.
2. **O19 RESOLVED**: `MatchByPhone` + `IsTerminalAttempt` diekspor dari
   `module1_leads`; mirror di importer dihapus; match pindah `JOIN`→`LEFT JOIN`
   (attempt milik karyawan belum tersinkron HRIS tetap terhitung aktif).
   Efek: hasil dry-run import lead bisa bergeser kecil vs angka referensi
   2026-07-10 untuk lead beratempt karyawan belum sync — disengaja.
3. Docs: `DECISIONS.md` (2 baris Decided + O19 resolved), `STATE_MACHINES.md`
   §1–2, `DATA_MODEL.md` (catatan multi-attempt `PRSP-`).

Commits: `3897cb4` (docs) → `55fc21d` (core M1 v2) → `52a7d77` (importer).
Test: 19 paket `go test -p 1 -count=1 ./...` hijau (paritas CI), build+vet bersih,
frontend tidak tersentuh. Catatan QC orkestrator: solo-join lead `[Pool]` tanpa
kolaborator TIDAK membawa info/notifikasi (revisi atas draft eksekutor).

## Yang masih menunggu (tidak berubah dari handoff sebelumnya)

| Item | Menunggu siapa |
|---|---|
| O21 — daftar NIK→email (blokir login riil) | HR / maintainer HRIS |
| O20 — keputusan UTC vs Asia/Jakarta (sebelum UAT W1-20) | Nerissa/Yohan |
| O18 — linkage MSL layanan legacy import | Yohan + Sales Head |
| Validasi MSL draft (standard_price + commission_rule) | Sales Head |
| Form pelengkap klien aktif (239 kandidat) | CRO + Finance |
| Eksekusi import riil (dry-run → apply, urutan di HANDOFF_JALUR_B_SESSION2 §A) | Setelah data di atas masuk |
| W1-20 UAT + exit review Wave 1 (gate Wave 2) | Pilot Sales+Finance + Nerissa |

## Untuk sesi berikutnya

- Jika data manusia sudah masuk → jalankan urutan import §A handoff Jalur B
  (angka referensi dry-run boleh bergeser kecil karena LEFT JOIN, lihat atas).
- Jika belum → kandidat kerja tanpa input manusia berikutnya: UI leads di
  `web-internal` (belum ada halaman M0/M1 — backend-first sampai kini), atau
  persiapan Wave 2 HANYA setelah exit criteria Wave 1 lolos (Build Plan §4 —
  jangan lompat gate).
