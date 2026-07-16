# W1-20 — Runbook UAT Wave 1 (satu deal end-to-end)

> Prasyarat & data: lihat `WAVE1_EXTERNAL_REQUESTS.md` Permintaan #1–#4. Jalankan di staging setelah PR foundation + PR Akun A (M0/M1) + PR stream B ter-merge. Setiap langkah mencantumkan **aktor**, **aksi**, dan **hasil yang diverifikasi** (status persis, pesan BI persis, audit). Kegagalan di langkah mana pun = no-go, catat di DECISIONS.md.

## A. Persiapan
1. **Dev** — migrasi 0001–0013 up bersih; sync HRIS riil jalan; role mapping terisi dari daftar divisi/jabatan riil; MSL riil terinput (versioned).
2. **Dev** — login tiap peran (Sales Staff, Sales Head, Finance Staff, Finance Head, Account Staff, Account Lead, OD, Director) berhasil; OD terbukti read-only.

## B. Akuisisi → Closing (stream A: M1 + M0)
3. **Sales Staff** — registrasi lead deal UAT. ✔ `LEAD-YYYYMM-NNNN` terbit hanya setelah field wajib lengkap; registrasi ulang nomor yang sama oleh salesperson yang SAMA ⇒ ditolak `[lead ini sudah anda pegang & masih diproses]` (M1 v2, DECISIONS 2026-07-16).
3b. **Sales Staff kedua** — registrasi nomor yang sama dari akun sales lain. ✔ TIDAK ditolak (dedup kolaboratif M1 v2, DECISIONS 2026-07-16): attempt paralel `PRSP-` terbit pada lead yang sama (1 lead, 2 attempt); respons membawa info `[lead juga sedang dikerjakan sales lain (nama)]`; sales pertama menerima notifikasi `m1.lead.collab_joined`; audit `collab_joined` tercatat pada lead. Saat deal ditutup di langkah 7, attempt kolaborator yang kalah auto `[Closed - Kalah Kompetisi]`.
4. **Sales Staff** — attempt berjalan `New Lead → Contacted`. ✔ transisi di luar tabel diblokir `[transisi status tidak diizinkan]`.
5. **Sales Staff** — submit Qualified Form (identitas, platform, GMV baseline 3 bulan, target, budget, layanan ≤5). ✔ Estimasi Nilai + Komisi terhitung otomatis dari versi MSL pada tanggal itu; **Sales Head spot-check komisi manual vs MSL** (AC W1-20); field terkunci pasca-submit ⇒ edit ditolak `[field ini terkunci, tidak bisa diubah]`.
6. **Sales Staff + Sales Head** — negosiasi (custom term bila ada di deal riil) ⇒ approval SPV; ✔ proposal versioned & immutable, notifikasi approval masuk.
7. **Sales Staff** — Closing Form: salespeople ≤5, alokasi Σ=100%, Commission & Payment PIC. ✔ `CLI-`/`TRX-`/`SVC-` terbit **atomik**; Σ≠100% diblokir `[total alokasi sales harus 100%]`.

## C. Klien → Uang (stream B: M4 + M5)
8. **Semua peran** — buka `/clients`. ✔ Client Record mewarisi provenance lengkap (identitas Qualified terkunci, Origin Campaign, Sales PIC, Commission & Payment PIC, Sales Allocation Σ100% read-only); **Account belum melihat klien** (pra-verifikasi); Sales lain tak melihat; anggota alokasi melihat.
9. **Sales PIC** — set Payment Intent (skema deal riil, mis. `[Termin]`) di `/clients/{id}`. ✔ hanya 4 opsi persis; peran lain ditolak; TRX tampil di `/finance` (antrean, `[Menunggu Verifikasi]`).
10. **Finance Staff** — buat jadwal Termin (amount + due date per termin). ✔ Σ ≠ total diblokir `[total termin tidak sama dengan nilai transaksi]`; baris `INST-` terbit status `[Belum Jatuh Tempo]`.
11. **Finance Staff** — verifikasi pembayaran pertama (nominal, tanggal, link bukti). ✔ INST → `[Terverifikasi]`; TRX → `[Terverifikasi - Sebagian]`; Amount Verified/Outstanding terformat `Rp. X.XXX.XXX,00`; **klien rilis ke Account saat itu juga** (fire-once, audit `released_to_account` mereferensikan verifikasi pemicu); **Account kini melihat klien**; verifikasi kedua tidak mengubah timestamp rilis.
12. **Finance Staff** — coba verifikasi melebihi sisa. ✔ diblokir `[jumlah melebihi total transaksi, periksa kembali]`, tanpa jejak tertulis.
13. **Finance/Sales** — upload kontrak; lalu verifikasi termin terakhir. ✔ tanpa kontrak, verifikasi penutup diblokir `[kontrak belum diupload, lengkapi sebelum verifikasi penuh]`; setelah kontrak ada ⇒ TRX `[Lunas]` hanya saat SEMUA INST `[Terverifikasi]`.
14. **Sistem/Finance** — `/finance/reminders` + scan dengan satu termin dibiarkan lewat due date (atau due date di-set dekat untuk simulasi). ✔ INST → `[Jatuh Tempo]`, label persis `[jatuh tempo X hari, segera tindak lanjuti]`; notifikasi `EvInstallmentDue` diterima **Commission & Payment PIC dan lead Finance** (dual audiens); H-3 terkirim sekali (fire-once).
15. **Finance + kedua SPV** — (opsional, jalur sengketa) flag `[Bermasalah]` + resolusi. ✔ butuh suara SPV Finance **dan** SPV Account; beda pendapat ⇒ eskalasi Director; klien tidak ditarik dari Account.

## D. Lintas-peran & penutup
16. **OD** — telusuri audit log seluruh perjalanan (lead → closing → verifikasi → rilis). ✔ rantai immutable lengkap (actor, before→after, timestamp), tidak ada jalur edit/hapus.
17. **Dev** — recompute: Amount Verified/Outstanding & komisi dihitung ulang dari log/`payment_verifications` = nilai yang tampil.
18. **Nerissa/Yohan + head dev** — putuskan go/no-go Wave 2; catat hasil + temuan di `docs/DECISIONS.md`.
