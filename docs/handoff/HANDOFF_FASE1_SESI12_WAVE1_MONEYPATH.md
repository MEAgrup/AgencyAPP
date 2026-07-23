# HANDOFF — Fase 1: Wave 1 money-path hampir tuntas (M1 claim, M5 lengkap, M4 lock matrix) — sesi 12

> Standalone. Konsolidasi status seluruh kerja sesi 11–12. Menggantikan/melengkapi
> `HANDOFF_FASE1_SESI11_M1_CLAIM_M5_FINANCE.md` (yang hanya mencakup #37+#38).
> Baca bersama `packages/domain/src/{leads,sales,finance,client}.ts`, `docs/DECISIONS.md`
> (5 entri baru 2026-07-23), dan PRD M1 §6 / M0 §5–§6 / M5 / M4.

---

## ⭐ STATUS: tiga PR TERSTACK, BELUM di-merge

`main` masih di `bde32d4` (Merge PR #36 — M0 Closing). Tiga PR terbuka membentuk **stack linear**
(masing-masing base = PR sebelumnya) supaya **bebas konflik** — satu-satunya file yang bentrok antar-PR
adalah `docs/DECISIONS.md` (append di anchor sama), sudah dihilangkan dengan stacking.

```
main (bde32d4)
 └─ PR #37  claude/m1-pool-claim-attempt-client-syt5jx   — M1 Pool claim + read model
     └─ PR #38  claude/m5-finance-payment-verification    — M5 Admin & Finance (LENGKAP)
         └─ PR #39  claude/m4-client-lock-matrix           — M4 Client Record (lock matrix + platforms)
```

**Urutan merge WAJIB: #37 → #38 → #39.** Saat parent merge ke `main`, GitHub auto-retarget base child
ke `main` dan diff tetap bersih (tak perlu resolusi konflik manual). Bila #37 di-merge duluan lalu perlu
kerja BARU di atas `main`, buat branch baru dari `origin/main` terbaru (jangan menumpuk di stack lama).

---

## Isi tiap PR

### PR #37 — M1 Pool claim + read model attempt/client (money-path M1/M0/M4-baca)
- **`leads.claim`** (M1 §6) + `decideClaim` murni: won→`[lead sudah menjadi klien]`; sudah pegang
  attempt→`[anda sudah memiliki prospek aktif untuk lead ini]`; `[Pool]`→claim; `[Rejected]`/`[Not Qualified]`
  →reclaim (reopen `→[Pool]`); scouted-eksklusif→`[lead sedang diproses oleh sales lain (nama)]`.
  Lock `FOR UPDATE`, audit `claim`/`claim_blocked`; kompetisi multi-sales by design (M1-OA-1).
- **Read model** (`sales.ts`): `listAttempts`, `getAttempt` (Qualified draft + proposal terakhir=quote),
  `getClient` (M4 dasar: client + platforms + alokasi + services + transaction+installments).
- **API:** `POST /leads/{id}/claim`, `GET /attempts` `/attempts/{id}` `/clients/{id}`.
- Verifikasi: core 106, db 9, domain 109, api 29.

### PR #38 — M5 Admin & Finance LENGKAP (§3–§7 + OA-1/3/4/5/6)
Modul baru `packages/domain/src/finance.ts`:
- **`verifyPayment`** (§3/§4/§5) — event immutable `payment_verifications` → `installment→[Terverifikasi]`
  → roll-up `transaction_payment` (`[Menunggu Verifikasi]`→`[Terverifikasi - Sebagian]`→`[Lunas]`) →
  **routing gate** (verifikasi pertama merilis client ke Account). Guard: over-verifikasi + gate kontrak
  sebelum `[Lunas]`. `[Lunas]` roll-up per §4 Rule 3 (berjadwal=semua installment; Lunas/Sebagian=jumlah).
- **`attachContract`**, **`scanReminders`** (§6/§7 fire-once: overdue `→[Jatuh Tempo]`, H-3, soft 7-hari
  kontrak), **`reminderDashboard`** (READ), **`flagBermasalah`/`resolveBermasalah`** (M5-OA-5 joint SPV/
  Director), **`changeScheme`** (M5-OA-6, pra-verifikasi saja).
- **Read DERIVED** (house rule #4, nol tabel): `getPaymentStatus`, `commissionAchievement` (M0 §5,
  pro-rata ke Amount Verified). Primitif uang baru **`money.proRata`** di `@cdps/core`.
- **API:** `POST /transactions/{id}/verify` `/contract` `/scheme` `/bermasalah` `/bermasalah/resolve`,
  `GET /transactions/{id}/payment` `/commission`, `GET /reminders`, `POST /reminders/scan`.
- Verifikasi: core 112 (+6 proRata), db 9, domain 122 (finance 31), api 29.

### PR #39 — M4 Client Record LENGKAP (§2–§6 + OA-1..6)
Modul baru `packages/domain/src/client.ts`:
- **`updateClient`** (lock matrix §4) — satu-satunya jalur tulis ke Client Record pasca-closing; cek
  matriks §4 tiap field SEBELUM tulis (atomik), audit `client_field_edited` before→after. Editable:
  profil→Account Lead/OD/Director; gmv_baseline→OD/Director; target_gmv/marketing_budget→Account/Director;
  PIC→Sales Lead/Director. Field sistem/immutable → `LockedFieldError`.
- **Platform List** (§3/§4): `addPlatform` / `updatePlatform` (Account Lead/OD/Director; add + koreksi
  store_link/managed_since + deactivate `active`), audited.
- **`voidService`** (M4-OA-5) — SPV/Account Lead/Director, alasan wajib; Service `→[Cancelled — Service
  Voided]` + **cascade** child Briefs bukan-`[Approved]`. **Efek komisi (KEPUTUSAN PEMILIK, interview):**
  total transaksi tetap immutable, tapi `finance.commissionAchievement` MENGECUALIKAN service voided.
- **`listClients`** (§6) — roster RLS-scoped (own/alokasi/divisi/OD/Director), newest-first.
- **§5 payment-intent handoff** — NOL kode baru (sudah ditutup `sales.close`; perubahan scheme = M5 `changeScheme`).
- **API:** `PATCH /clients/{id}`, `POST /clients/{id}/platforms`, `PATCH /clients/{id}/platforms/{pid}`,
  `POST /services/{id}/void`, `GET /clients`.
- 2 string BI baru (lock matrix): `[anda tidak memiliki akses untuk mengubah field ini]`, `[field ini terkunci dan tidak dapat diubah]`.
- Verifikasi: core 112, db 9, **domain 170** (client 30 + finance 31 hijau dgn filter void), api 29.

> **Cara jalankan integration test lokal:** butuh Postgres 16 (`initdb`/`pg_ctl` sebagai user `postgres`,
> BUKAN root — root ditolak), `createdb cdps`, apply `supabase/migrations/*.sql` berurut → 53 tabel, lalu
> `DATABASE_URL=postgres://postgres@127.0.0.1:5433/cdps npm test` di tiap paket (`packages/core`,
> `packages/db`, `packages/domain`, `apps/api`). Tanpa `DATABASE_URL`, test integration otomatis skip.

---

## Langkah kode berikutnya (urut) — TASK TERDEKAT

**Wave 1 money-path (M0/M1/M4/M5) TUNTAS secara kode** (PR #37/#38/#39). Tersisa gate manusia:

1. **Gate exit Wave 1 (UAT)** — Build Plan §4: satu deal riil end-to-end (register→qualified→negotiated
   →closed→IDs→Termin→Finance verify→routing ke Account; komisi dicek silang vs MSL). Pola runbook:
   `docs/handoff/W1-20_UAT_RUNBOOK.md`. **Gerbang manusia** (pilot Sales+Finance) — agent tak bisa eksekusi.
   (Prasyarat: merge #37→#38→#39 ke `main` dulu.)
2. Setelah exit Wave 1 → **Wave 2** (M6 Account & Service, **M12 early**, M7–M10). JANGAN mulai tiket
   Wave 2 sebelum kriteria exit Wave 1 lolos (Build Plan §4 / R5). Catatan: sebagian skema/mesin Wave 2
   sudah ada (briefs stub 0010, mesin brief_task/strategy_plan/dst di 0002-statemachine, `assigned_am_id`
   0020) — M6 tinggal mengisi logika di atasnya.

> **M4 catatan interview 2026-07-23:** efek finansial Void Service = "exclude dari komisi" (pilihan
> pemilik) — total transaksi immutable, `commissionAchievement` kecualikan service voided. Bila kelak
> pemilik mau rekonsiliasi uang atas service voided, itu keputusan/kluster baru (kemungkinan via M5).

## Peringatan (tetap berlaku)

- **Ketiga PR belum di-merge**; merge berurutan #37→#38→#39. `DECISIONS.md` satu-satunya titik konflik
  antar-PR (sudah dihindari via stacking). Bila di-merge di luar urutan, retarget/rebase base yang salah.
- Status birth (LEAD/PRSP/CLI/TRX/SVC/INST) di-insert = state awal; transisi lanjutan HANYA `sm_transition`.
  Uang HANYA `@cdps/core money` (bigint). Auto-calc (Amount Verified, commission achievement) = DERIVED
  dari log, nol kolom mutable, recomputable (house rule #4). ID hanya pasca-validasi & tak reuse.
- Katalog notifikasi FROZEN 15 event; string BI `[...]` persis. **5 entri DECISIONS baru 2026-07-23**
  (M1 claim, M5 money-in, M5 lengkap, M4 lock matrix, + M4 platform) mencatat tiap interpretasi &
  string BI baru. Predikat izin 3 implementasi (permission.ts / RLS / claims) tak boleh divergen.
- **Interpretasi ter-log penting:** commission achievement pro-rata ke Amount Verified (M0 §5 §138);
  `[Jatuh Tempo]` = status + boolean mirror; `changeScheme` pra-verifikasi saja; OD boleh koreksi
  gmv_baseline/profil per matriks M4 §4 (PRD menang atas CLAUDE.md §6 "OD read-only").
- Gate CI-infra & gate manusia Fase 1 (handoff sesi 4 auth, sesi 5 §2/§3) masih berlaku.
