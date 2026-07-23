# Laporan UAT Wave 1 — DRY-RUN OTOMATIS (agent, lapisan domain)

> **Sifat laporan:** ini **bukan** gate manusia. Ini eksekusi otomatis money-path
> end-to-end oleh agent lewat fungsi `@cdps/domain` langsung terhadap Postgres 16
> ber-migrasi (semua 53 tabel), mengikuti `WAVE1_EXIT_UAT_RUNBOOK.md` langkah demi
> langkah. Tujuannya: memflush cacat kode sebelum pilot Sales+Finance duduk. Gate
> resmi (pilot pada UI staging, spot-check komisi manual, keputusan go/no-go) tetap
> **milik manusia** dan belum dieksekusi.
>
> **Harness:** `packages/domain/src/wave1_uat.e2e.test.ts` — env-gated `UAT=1`.
> Jalankan ulang: `DATABASE_URL=<fresh-migrated-db> UAT=1 npm run uat:wave1`
> (di `packages/domain`, DB **segar/terdedikasi** — notifikasi & audit append-only).

- **Tanggal:** 2026-07-23
- **Build:** `main` @ `7bf4829` (Merge PR #37/#38/#39) + branch `claude/cdps-phase1-wave2-exit-kqeg6c`
- **Lingkungan:** PG16 fresh + 53 migrasi; deal contoh = M0 §4 worked example (3 layanan @10% → Rp. 21.900.000,00 / komisi Rp. 2.190.000,00)
- **Hasil:** **30/30 langkah PASS**, typecheck bersih, suite default tetap 170 hijau (harness ter-gate keluar).

## Hasil per langkah (verbatim dari harness)

| Langkah | Aktor | Status | Bukti |
|---|---|---|---|
| B1 register lead | Sales Budi | ✅ | `LEAD-…` + `PRSP-…` (New Lead); ID hanya pasca-validasi |
| B1 duplicate register blocked | Sales Budi | ✅ | `[anda sudah memiliki prospek aktif untuk lead ini]` |
| B2 claim pool lead | Sales Budi | ✅ | `PRSP-…` New Lead, audit `claim` ×1 |
| B3 New Lead → Contacted | Sales Budi | ✅ | `Contacted` |
| B3 non-owner transition denied | Sales Andi | ✅ | `[anda tidak memiliki akses untuk melakukan transisi ini]` |
| B4 Qualified Form | Sales Budi | ✅ | `Qualified` (estimasi auto-calc) |
| B5 commission cross-check vs MSL | Sales Head | ✅ | Estimasi `Rp. 21.900.000,00`, Komisi `Rp. 2.190.000,00` |
| B6 custom nego + SPV approval | Sales Budi + Sales Lead | ✅ | `Negotiation - Pending Approval` → `Negotiation - Approved` |
| B7 Σ≠100% blocked | Sales Budi | ✅ | `[total alokasi sales harus 100%]` |
| B7 closing atomic | Sales Budi | ✅ | `CLI-…` / `TRX-…` / 2 `INST-…` lahir atomik; TRX `[Menunggu Verifikasi]` |
| C1 client provenance (pra-verif) | read | ✅ | toko, Σ=10000, 3 SVC, TRX `[Menunggu Verifikasi]`, 2 INST |
| C2 lock matrix edit | Account Lead | ✅ | toko diedit + audit `client_field_edited` |
| C2 role-denied field | Sales Budi | ✅ | `[anda tidak memiliki akses untuk mengubah field ini]` |
| C2 locked/system field | Account Lead | ✅ | `[field ini terkunci dan tidak dapat diubah]` |
| C3 platform add/deactivate | Account Lead | ✅ | Shopee tetap; TikTok `active=false` (tanpa DELETE) |
| C4 schedule-total guard | Finance SPV | ✅ | `[total termin tidak sama dengan nilai transaksi]` |
| C4 initial payment status | Finance | ✅ | Verified `Rp. 0,00`, Outstanding `Rp. 21.900.000,00` |
| C9 reminder → Jatuh Tempo | Finance/System | ✅ | `[Jatuh Tempo]`, label `[jatuh tempo 22 hari, segera tindak lanjuti]` |
| C7 over-verification blocked | Finance | ✅ | `[jumlah melebihi total transaksi, periksa kembali]` (tanpa jejak) |
| C5 verify #1 + routing gate | Finance | ✅ | TRX `[Terverifikasi - Sebagian]`, `released_to_account=true`, Verified `Rp. 10.000.000,00` |
| C4 scheme locked post-verify | Finance SPV | ✅ | `[transisi status tidak diizinkan]` (SchemeLockedError) |
| C8 contract gate before Lunas | Finance | ✅ | `[kontrak belum diupload, lengkapi sebelum verifikasi penuh]` |
| C8 contract gate → [Lunas] | Finance | ✅ | TRX `[Lunas]`; timestamp rilis stabil (rilis sekali) |
| C8 all INST verified | Finance | ✅ | `[Terverifikasi]` |
| C8 final payment status | Finance | ✅ | Verified `Rp. 21.900.000,00`, Outstanding `Rp. 0,00` |
| D1 commission achievement | Sales Head/Finance | ✅ | total `Rp. 2.190.000,00`, recognized `Rp. 2.190.000,00`, Budi `Rp. 2.190.000,00` |
| D2 void service excludes commission | Account Lead | ✅ | SVC `[Cancelled — Service Voided]`; komisi `Rp. 2.190.000,00` → `Rp. 1.290.000,00`; TRX total immutable `Rp. 21.900.000,00` |
| D3 audit UPDATE blocked | Dev/OD | ✅ | `audit_log is append-only/immutable: UPDATE forbidden` |
| D3 audit DELETE blocked | Dev/OD | ✅ | `audit_log is append-only/immutable: DELETE forbidden` |
| D4 recompute from log | Dev | ✅ | Amount Verified & komisi recompute = nilai tampil (derived, house rule #4) |

## Temuan

| # | Severity | Deskripsi | Status |
|---|---|---|---|
| — | — | Nol cacat kode. Dua bug ditemukan & diperbaiki di **harness UAT** (bukan produk): aktor `changeScheme` harus Finance SPV/Head (bukan staff); `notifications`/`audit_log` append-only ⇒ harness harus jalan di DB segar (env-gated `UAT=1` agar keluar dari suite default). | Closed |

## Cakupan yang TIDAK tercakup dry-run ini (tetap butuh gate manusia)

- **Visibility RLS §6** (Account belum lihat klien pra-verifikasi; Sales lain tak lihat): ditegakkan RLS pada sesi auth Postgres, bukan lapisan domain (harness jalan sebagai superuser, RLS bypass). Wajib diuji pilot pada UI/sesi ber-claim.
- **Login per-peran, sync HRIS riil, role mapping, MSL riil**, dan **spot-check komisi manual oleh Sales Head**.
- **Notifikasi in-app dual-audiens** diterima di UI oleh Commission&Payment PIC + lead Finance (harness memverifikasi baris tertulis, bukan tampilan).
- **Keputusan go/no-go Wave 2** — pemilik + head dev, dicatat di `docs/DECISIONS.md`.

## Kesimpulan

Money-path M0/M1/M4/M5 **lolos dry-run otomatis end-to-end (30/30)** pada kode `main`
pasca-merge. Tidak ada penghalang kode untuk menjadwalkan **gate UAT manusia** memakai
`WAVE1_EXIT_UAT_RUNBOOK.md`. Setelah gate manusia lolos & dicatat → Wave 2 boleh mulai.
