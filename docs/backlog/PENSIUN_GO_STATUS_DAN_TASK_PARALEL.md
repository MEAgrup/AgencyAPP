# PENSIUN GO — Status per 2026-07-30 & pembagian task 2 akun paralel

> **Dokumen standalone.** Disusun 2026-07-30 di atas `main@a37e432`; **diperbarui terakhir
> ~05:0x UTC** sesudah #77, #76, lalu **#79 (Paket A)** di-merge (`main@e5755ff`) dan sesudah
> Paket B (PR #78) direkonsiliasi di atasnya. **Kedua paket paralel SELESAI.**
> Sumber: `CUTOVER_BACKLOG.md` (gate C-00…C-06) + handoff SESI13/14/15/16A (semua di `main`)
> + SESI16B & SESI17 (PR #78).
> Aturan rumah `CLAUDE.md` §Phase 0 tetap berlaku bit-for-bit. PRD menang atas kode.

---

## 0. Ringkasan satu paragraf

Peta pensiun Go punya **6 fase**. **Fase 0 & 1 selesai penuh dan sudah di `main`.**
**Fase 2 praktis SELESAI:** kelas-1 (#76), kelas-2 **kedua paruhnya** — 29 converter
commerce/portal (Paket B) + 25 converter delivery (Paket A), **nol cacat di keduanya**, dikunci
44 test A + gate otomatis 84 converter B. **Fase 3 selesai sebagian** (3 dari 4 CLI; `cmd/import`
menunggu O47).
**Fase 4 (gate manusia) tidak bisa disentuh Claude sama sekali** — tujuh butir, semuanya butuh
akses atau otoritas pemilik. **Fase 5 (pencabutan mekanis) 0% dan memang belum boleh dimulai** —
ia menunggu gate GO **dan** jawaban O47.

Jalur kritis pensiun Go **bukan lagi engineering**: jalur kritisnya adalah **eksekusi C-03 dari
mesin ber-akses** + **empat keputusan pemilik** (O47, O46, O34/O26/O35, retensi PII).

---

## 1. Progress — angka yang bisa dipertanggungjawabkan

### 1.1 Per fase

| Fase | Isi | Status | % |
|---|---|---|---|
| **Fase 0** | Data organisasi riil dikeluarkan dari `backend/` | 🟢 **SELESAI** — di `main` (#75) | **100%** |
| **Fase 1** | O41 — 6 route hilang diport, `KNOWN_GAPS` kosong | 🟢 **SELESAI** — di `main` (#75) | **100%** |
| **Fase 2** | O43 — paritas bentuk respons | 🟢 **praktis SELESAI.** kelas-1 tutup (#76); kelas-2 **seluruh 54 converter** diaudit — 29 commerce/portal (B, #78) + 25 delivery (A, #79), **nol cacat di keduanya**, dikunci 44 test + gate otomatis 84 converter. Sisa: **3 interface nested inline** (dinyatakan, di-assert) | **~95%** |
| **Fase 3** | 4 CLI Go tanpa padanan | 🟡 3 dari 4 diputuskan & dieksekusi (#76, **di `main`**); `cmd/import` → **O47 terbuka** | **~75%** |
| **Fase 4** | Gate manusia (7 butir) | 🔴 **nol butir ditutup Claude** — semuanya butuh pemilik. Sebagian C-04 sudah jalan (MSL 32 layanan, 69 karyawan, O42) | **~30%** |
| **Fase 5** | Pencabutan mekanis (C-05) | 🔴 belum boleh dimulai. Hanya `CLAUDE.md` §Stack yang sudah dikoreksi lebih awal (PR #76) | **~10%** |

### 1.2 Dibagi per siapa yang bisa mengerjakan — ini yang berguna

| Sisi | % | Sisa |
|---|---|---|
| **Engineering (Claude)** | **~95%** *(~80% → ~85% Paket B → ~95% Paket A)* | Sisanya **kecil atau terkunci**: 3 interface nested inline · **T2b** 1 warning eslint `mslseed.ts` · rekomendasi memanggil lint di job `api` CI · T3 adapter CSV (**terkunci O47**) · Fase 5 (**terkunci gate GO**) |
| **Sisi pemilik (Yohan/Nerissa)** | **~35%** | C-03 eksekusi dari deployment · O47 · O46 · O34/O26/O35 · backup + rollback Railway · retensi PII |
| **Gabungan pensiun Go** | **~78%** | jalur kritisnya **100% sisi pemilik** — §5 |

> ⚠️ **Koreksi terhadap angka lama.** PR #73 (handoff SESI12) menyatakan *"engineering ~95%"*.
> Angka itu **terlalu optimistis, dan sudah terbukti begitu** — SESI13 menemukan seluruh lapisan
> wire M5 **tidak ada**, SESI14 menemukan **9 endpoint** lain salah bentuk. Keduanya route yang
> **menjawab 200** sehingga `route-parity` 5/5 hijau sementara halamannya blank. Kelas cacat yang
> sama (**~54 converter yang belum diaudit field-by-field**) masih terbuka, jadi engineering
> jujurnya **~80%**, bukan 95%. Angka turun karena cakupan yang ditemukan, bukan karena regresi.

### 1.3 Angka acuan test

**Di `main@5944aa1`** (sesudah #76+#77): `@cdps/domain` **566** (+1 skip) · `apps/api` **246** ·
`@cdps/core` **113** · `@cdps/db` **9** · `web-internal` **26** · `route-parity` **5/5,
`KNOWN_GAPS` KOSONG** · 4 invariant SQL **PASS** · Live `CDPS SG` **40 migrasi · 54 tabel ·
17 event**, repo cocok 1:1.

**Di `main@e5755ff`** (sesudah #79/Paket A): `apps/api` **290** (+44 `wire.delivery.test.ts`).

**Gabungan A+B** (PR #78 di atas `main@e5755ff`): `apps/api` **299** (290 + 9 gate). Domain/core/
db/web-internal tidak bergerak. `npm run lint -w @cdps/api` **0 error, 1 warning** (T2b).

<sub>Angka lama, sebelum #76/#77 masuk (`main@a37e432`): domain 552 · `apps/api` 211.</sub>

---

## 2. Pekerjaan terakhir — PR #73 sampai #79

| PR | Isi | Status | Rekomendasi |
|---|---|---|---|
| **#73** | Handoff SESI12 (docs saja) | 🟢 terbuka, tapi **isinya sudah ada di `main`** — `HANDOFF_CUTOVER_SESI12.md` masuk lewat #75 (`38fed0c`) | **TUTUP** tanpa merge (redundan) |
| **#74** | Fase 0 versi pertama: `git mv` data riil + `import_samples` keluar dari `backend/` | 🟢 draft, base `main@7bbd5e1` (basi) | **TUTUP** tanpa merge — **digantikan #75** yang memakai pendekatan berbeda (**salin**, bukan pindah, karena `git mv` membuat job `backend` merah). Dan #74 memindahkan `import_samples` yang **memuat PII** ke folder yang dibaca tooling seed — justru yang SESI13 sengaja tidak lakukan. Perubahan `paths.go`-nya juga sudah dicabut di #76 (`backend/**` read-only) |
| **#75** | Fase 0 + Fase 1 (O41, 6 route, lapisan wire M5, bug vote Director) + apply migrasi + selaraskan penomoran | 🟣 **MERGED** → `main@a37e432` | — |
| **#76** | Go ditinggalkan resmi (`CLAUDE.md` §Stack) + O43 Fase 2 (9 endpoint) + Fase 3 (4 CLI diputuskan) + `collate "C"` | 🟣 **MERGED 2026-07-30** → `main@5944aa1` | — |
| **#77** | Dua rujukan versi migrasi menunjuk berkas salah (komentar + docs saja) | 🟣 **MERGED 2026-07-30** → `cc667ff` | — |
| **#78** | **Paket B**: gate paritas BENTUK respons atas 84 converter (O43 c) + dokumen ini + prompt Paket A | 🟢 draft, direkonsiliasi di atas `main@e5755ff` | **REVIEW & MERGE** — satu-satunya PR paket yang belum masuk |
| **#79** | **Paket A**: 25 converter delivery diaudit (nol cacat) + 44 test pengunci + eslint config `apps/api` + 2 rujukan path | 🟣 **MERGED 2026-07-30** → `main@e5755ff` | — |

### 2.1 Tiga pelajaran dari #74–#77 yang harus dibawa ke sesi paralel

1. **`git fetch` di awal sesi TIDAK cukup.** #77 memulai di atas `main@7bbd5e1` yang basi
   beberapa menit kemudian, lalu **mengerjakan ulang dari nol dua task yang sudah ter-merge**
   lewat #75. Yang menyingkapnya bukan git, tapi **daftar PR terbuka**.
   ⇒ **Wajib `list_pull_requests` sebelum mulai, bukan hanya `git log`.**
2. **Jangan menilai status CI dari check-run commit yang bukan HEAD.** #76 sempat menuduh #75
   melaporkan job `backend` hijau padahal merah — padahal #75 sudah memperbaikinya sendiri di
   commit berikutnya (`5453f69`). Snapshot lama terlihat identik dengan kerusakan yang masih hidup.
3. **`42P07 relation already exists` dari `apply_migration` BUKAN benign.** Di #77 ia menandakan
   **penulis kedua** (sesi paralel meng-apply di detik yang sama). Ini justru risiko utama mode
   2-akun paralel — lihat aturan §3.1 butir 5.

---

## 3. Task paralel — 2 akun

### 3.0 Prasyarat sebelum KEDUA akun mulai

> **✅ DIPERBARUI 2026-07-30 ~04:45 UTC — dua dari empat prasyarat sudah dipenuhi pemilik.**
> **#77 ter-merge** (`cc667ff`) lalu **#76 ter-merge** (`main@5944aa1`). Instruksi asli
> ("bertumpuk di atas #76") **sudah tidak berlaku** — kedua akun sekarang **branch dari `main`
> terbaru**.

| # | Prasyarat | Status |
|---|---|---|
| 1 | Merge **#76** (Fase 2 kelas-1 + Fase 3) | ✅ `main@5944aa1` |
| 2 | Merge **#77** (komentar + docs) | ✅ `cc667ff` |
| 3 | **Tutup #73 dan #74** tanpa merge (alasan §2) | ⛔ belum — keputusan pemilik |
| 4 | Kedua akun branch dari **hash `main` yang SAMA** | ⛔ Paket A belum dijalankan |

Butir 3 **tidak memblokir** Paket A/B — ia kebersihan daftar PR. Butir 4 masih berlaku: catat
`git log --oneline origin/main -1` dan pakai hash itu untuk kedua akun. Satu basis, dua branch —
jangan setengah dari `main` setengah dari branch lain.

> **Paket B (PR #78) sudah dikerjakan** dan menambahkan gate `shape-parity.test.ts` yang menilai
> converter **kedua** paket. Paket A wajib membaca §1b prompt-nya sebelum mulai.

### 3.1 Aturan main paralel (dilanggar = konflik merge yang mahal)

1. **Satu berkas test per akun, JANGAN berbagi `wire.test.ts`.**
   Akun A → `apps/api/src/lib/wire.delivery.test.ts` (baru).
   Pola assertion diambil dari `wire.test.ts` yang sudah ada (`toEqual` objek penuh + assertion
   "nol kunci camelCase"). **Nol edit pada `wire.test.ts` lama.**

   > **Diperbarui:** Paket B **tidak** membuat `wire.commerce.test.ts` — auditnya nol cacat, jadi
   > tidak ada perbaikan yang perlu dikunci per-converter; yang ia hasilkan adalah
   > `shape-parity.test.ts`, gate atas **seluruh 84** converter. Jadi aturan ini sekarang hanya
   > mengikat Akun A, dan `shape-parity.test.ts` bukan milik siapa pun — **tapi kalau A menambah
   > converter, A wajib menambah entri `WIRE_TO_FE` di sana** (kalau tidak, CI merah).
2. **`wire.ts` diedit KEDUA akun — hanya di dalam blok converter milik sendiri.**
   Terlarang: menyentuh helper bersama di bagian atas berkas, mengurutkan ulang fungsi,
   merapikan blok `import` di luar menambah satu baris di akhir. Butuh helper baru? Definisikan
   **tepat di atas converter Anda sendiri**, jangan di area bersama.
3. **`docs/DECISIONS.md` disisipkan di baris paling atas tabel oleh keduanya ⇒ konflik pasti.**
   Urutan merge dipatok: **A merge dulu, B rebase ke `main` sebelum push final.** Resolusinya
   trivial (simpan kedua baris) tapi harus disengaja, bukan ditemukan.
4. **Handoff terpisah:** `HANDOFF_CUTOVER_SESI16A.md` (A) dan `…SESI16B.md` (B). Jangan menulis ke
   berkas handoff akun lain.
5. **NOL tulis ke live `CDPS SG` dari kedua akun.** Tidak ada `apply_migration`, tidak ada
   `supabase db push`, tidak ada `INSERT`/`UPDATE`. Kedua paket ini **nol perubahan skema** —
   kalau Anda merasa butuh migrasi, itu tanda ruang lingkupnya salah: **STOP dan lapor**. Ini
   aturan yang mencegah terulangnya `42P07` #77.
6. **`backend/**` read-only.** Ia dibaca sebagai oracle paritas, tidak pernah diedit. Satu-satunya
   pengecualian yang pernah wajar (menjaga job `backend` hijau) sudah tidak berlaku — job itu
   hijau.
7. **Jangan menambah baris ke `KNOWN_GAPS`** di `route-parity.test.ts`. Harus tetap kosong.
8. **Nol string BI baru**, katalog notifikasi tetap **FROZEN 17 event**, nol field/status/transisi
   yang tidak ada di PRD.
9. Sebelum push: `npm run db:rebuild -- --yes` lalu `npm test --workspaces --if-present` +
   `npm run typecheck --workspaces --if-present`. Laporkan angka test di body PR.

---

## PAKET A — jalur delivery (M6/M7/M8/M9/M10/M13/M14)

**Branch:** `claude/wire-parity-delivery-<suffix>` · **PR:** draft ke `main`

### A1 · Paritas field-by-field 25 converter delivery 🔴 MENDESAK

**Kenapa mendesak:** ini satu-satunya kelas pekerjaan yang **butuh `backend/` masih ada**. Begitu
C-05 mengarsipkan Go, oracle-nya hilang dan nilainya **jatuh ke nol**, bukan berkurang.

Metode per converter (dari SESI14 §5 T1):

1. Ambil tipe FE yang dilayani (`web-internal/src/lib/*.ts` atau `lib/types.ts`).
2. Ambil struct Go padanannya **+ json tag**-nya (`backend/internal/module*/`).
3. **Diff ketiganya.** Yang dicari: field FE yang tidak pernah diisi converter · nama snake_case
   yang beda · `Date` yang lupa `.toISOString()` · **kunci nullable yang HILANG alih-alih dikirim
   `null`** (pelajaran O43: kunci hilang mengeblank halaman, `null` tidak — jangan
   "sederhanakan" jadi `omitempty` gaya Go).
4. Test di `wire.delivery.test.ts`.

| Modul FE | Converter (25) |
|---|---|
| `board.ts`, `tasks.ts` | `cardToWire` · `dailyOutputToWire` · `dependencyToWire` · `scanHoursReminderResultToWire` |
| `creative.ts` | `assetToWire` · `briefToWire` · `metricsToWire` · `blockRequestToWire` · `pendingBlockRequestToWire` · `complaintToWire` |
| `ads.ts` | `campaignToWire` · `metricEntryToWire` · `optimizationToWire` |
| `kol.ts`, `livestream.ts` | `bookingToWire` · `paymentRequestToWire` · `bookingMetricsToWire` · `creatorListToWire` · `sessionToWire` |
| `health.ts` | `healthSnapshotToWire` · `roasToggleToWire` · `healthScanResultToWire` |
| `performance.ts` | `perfSnapshotToWire` · `perfTeamRollupToWire` · `perfWeightToWire` · `perfTargetToWire` |

**Mulai dari `cardToWire` (board) dan `assetToWire`/`briefToWire`/`metricsToWire` (creative)** —
halaman paling ramai dipakai, jadi cacat di sana paling mahal.

> ⚠️ Kalau menemukan read model domain yang **tidak punya** field yang dibutuhkan FE (preseden:
> `InstallmentRow` tanpa `proofOfPayment` di SESI13, `skippedApprovedBriefs` di SESI14), field itu
> ditambahkan ke **domain** juga — dan kalau ia informasi yang perlu dilihat orang, ikut ke baris
> audit supaya bisa direkonstruksi dari log (house rule #3/#4).

**DoD A1:** setiap converter punya test `toEqual` objek penuh + assertion nol kunci camelCase ·
setiap temuan disebut eksplisit di body PR (endpoint, apa yang salah, siapa yang membacanya) ·
setiap deviasi dari Go yang disengaja masuk `DECISIONS.md` dengan alasannya · CI 5/5 hijau.

### A2 · `apps/api` tidak punya eslint config (T2)

`npm run lint -w @cdps/api` **selalu** gagal: `ESLint couldn't find an eslint.config.js`.
Pre-existing, tapi artinya **~250 berkas TS tidak pernah di-lint** — termasuk seluruh route
handler dan `wire.ts`. `web-internal` punya config yang bersih; contoh polanya ada di sana.

**Batas ruang lingkup yang tegas (supaya tidak bertabrakan dengan Paket B):**
tambahkan config + jalankan + **laporkan jumlah temuan di body PR**. **Perbaiki NOL berkas di
luar blok converter Paket A.** Sisanya jadi tiket lanjutan `T2b`, plus rekomendasi apakah job
`api` di CI ikut memanggil lint (kalau ya, gelombang temuan pertama harus dibereskan dulu).

### A3 · Rapikan rujukan path pasca-Fase 0 (sisa #74 yang masih valid)

Data riil sudah pindah, tapi tiga dokumen **operasional** masih menunjuk lokasi lama:
`docs/handoff/HRIS_ROLE_MAPPING_DRAFT.md` · `docs/handoff/RUNBOOK_O42_MARKETING_ACTOR.md` ·
`docs/handoff/LANGKAH_MANUSIA_GO_LIVE.md`.
Perbarui ke `supabase/seed/…`. **Handoff bertanggal & baris `DECISIONS.md` lama JANGAN ditulis
ulang** — itu catatan historis. `supabase/seed/README.md` sudah benar (ia menjelaskan mekanisme
duplikat byte-identik sampai Fase 5) — jangan diubah.

---

## PAKET B — jalur commerce & portal (M0/M1/M2/M3/M4/M11/M12/M15 + admin)

**Branch:** `claude/wire-parity-commerce-<suffix>` · **PR:** draft ke `main`

### B1 · Paritas field-by-field 29 converter commerce/portal 🔴 MENDESAK

Metode **identik A1** (baca A1 langkah 1–4 — jangan disusun ulang). Test → `wire.commerce.test.ts`.

| Modul FE | Converter (29) |
|---|---|
| `sales.ts` | `masterServiceToWire` · `quoteToWire` |
| `leads.ts` | `leadStubToWire` · `attemptStubToWire` · `poolRowToWire` · `leadRowToWire` · `leadDetailToWire` · `deleteRequestToWire` · `deleteRequestQueueRowToWire` |
| `clients.ts` | `intakeClientToWire` · `amWorkloadToWire` · `assignmentToWire` · `strategyToWire` · `strategyRequirementToWire` · `clientDetailToWire` · `clientListRowToWire` |
| `marketing.ts` | `marketingCampaignToWire` · `campaignRollupToWire` · `performanceRecordToWire` · `marketingMetricsToWire` |
| `portal.ts` | `staffLandingToWire` · `teamPortalToWire` · `managementDashboardToWire` |
| `account.ts` / admin | `adminEmployeeToWire` · `roleMappingToWire` · `layeredRoleToWire` · `credentialInfoToWire` |
| notifikasi | `notificationToWire` · `inboxToWire` |

**Mulai dari `clientDetailToWire`** — ia **sudah terbukti** anggota kelas cacat ini (O41 #1), jadi
ia oracle terdekat untuk mengkalibrasi seberapa dalam auditnya perlu. Lalu `leadDetailToWire` dan
ketiga converter `portal.ts` (halaman landing tiap role — blank di sana = orang tidak bisa kerja).

**Yang SENGAJA di luar ruang lingkup, jangan "diperbaiki":**
`GET /transactions/{id}/commission` dan `/payment` tetap camelCase mentah. Kedua handler Go-nya
**tidak ada** dan `web-internal` tidak memanggil keduanya dari mana pun ⇒ tanpa oracle DAN tanpa
konsumen, menamai kunci wire = **mengarang kontrak**. Sudah ditandai di dalam kode oleh #76.

**DoD B1:** sama dengan A1.

### B2 · Verifikasi `collate "C"` tidak punya sisa di ruang lingkup B

#76 memasang `order by … collate "C"` di `domain/engine.ts` karena **Postgres CI `en_US.utf8`,
sandbox lokal `C`** — collation glibc `en_US` mengabaikan tanda baca, jadi `[Closed - …]` bisa
naik **di depan** `Qualified`, dan urutan tombol di badan respons jadi bergantung locale cluster.
Go mengurutkan byte-wise, jadi `collate "C"` sekaligus memulihkan paritas.

#76 sudah menyisir seluruh `packages/domain/src/**` dan `engine.ts` satu-satunya instans.
**Tugas B2 kecil:** ulangi sisiran itu untuk read model **yang Anda sentuh sendiri di B1** —
setiap `order by` pada kolom status/state harus dipatok `collate "C"`. Seluruh status CDPS
ber-`[...]`, jadi jebakan ini hidup di endpoint mana pun yang mengurutkan kolom teks status.
**Jangan lepas `collate "C"` dari `engine.ts` — ia load-bearing.**

### B3 · Adapter CSV/dry-run di atas `POST /leads/bulk` (T3) — **TERKUNCI O47**

**Jangan mulai sebelum pemilik menjawab O47.** Kalau jawabannya *"lead saja"*: kecil —
`/leads/bulk` sudah hidup & teruji, sisanya parsing CSV + mode dry-run, cetakannya
`mslseed.ts`/`rolemapseed.ts`. Kalau jawabannya *"klien + ledger juga"*: **desainnya berbeda** dan
butuh tiket sendiri (ia jadi jalur tulis privileged kedua ke `clients`/`transactions`/`installments`).

---

## 4. Yang TIDAK boleh dikerjakan kedua akun

- **Fase 5 / C-05** (hapus job `backend`, arsipkan `backend/`, `Makefile`, config Railway) —
  menunggu gate GO **dan** O47. Memulainya menghapus oracle paritas yang A1/B1 justru pakai.
- **Menulis ke live `CDPS SG`** — dalam bentuk apa pun.
- **Migrasi baru** — kedua paket nol perubahan skema.
- **Menutup butir Fase 4** — nol dari tujuh butir itu bisa ditutup Claude. Melaporkannya selesai
  = laporan palsu.

---

## 5. Yang hanya bisa Yohan/Nerissa kerjakan — ini jalur kritis pensiun Go

Dua akun di §3 **tidak memindahkan satu pun** dari tujuh butir ini. Sesudah A+B selesai,
engineering ≈ selesai dan **100% sisa pensiun Go ada di daftar ini.**

| # | Butir | Kenapa terkunci | Memblokir |
|---|---|---|---|
| 1 | **C-03 — 3 SKIP** | butuh mesin ber-akses `*.vercel.app` + kredensial per-role. Skrip **sudah siap** sejak 2026-07-29 → `docs/handoff/CUTOVER_C03_DEPLOYMENT_RUNBOOK.md`. Jangan disusun ulang, cuma dijalankan | **gate C-04** |
| 2 | **O47** — `cmd/import` (~3.700 baris) port atau tinggalkan? (a) riwayat klien pra-CDPS masuk CDPS atau cukup arsip spreadsheet? (b) kalau masuk — lead saja, atau klien+ledger juga? | keputusan pemilik | **C-05** + task B3 |
| 3 | **O46** — 3 arm visibility RLS lebih sempit dari Go (`transactions_select` tanpa arm Sales-Lead · `audit_log_select` staff hanya lihat entri sendiri · arm Account pasca-rilis) | melonggarkan RLS = keputusan keamanan. Arahnya **lebih sempit** ⇒ nol kebocoran, tapi ada data tak terlihat | klaim *"apps/api paritas Go"* |
| 4 | **O34 · O26 · O35 · O9** | aktor produksi + sub-tim Creative | **DoD C-04** ("nol fixture") |
| 5 | **Retensi PII** `backend/testdata/import_samples/` (roster HR, `nik_email.csv`) | arsip / hapus / anonimkan — keputusan pemilik data | **C-05** (opsi "hapus `backend/`") |
| 6 | **Backup MySQL Railway terakhir** + **OQ-2** (`SELECT count(*)` per tabel: minimal `leads`, `clients`, `transactions`) | butuh akses Railway | **gate GO** |
| 7 | **Rencana rollback disepakati** (Railway hidup N hari pasca-cutover) | keputusan pemilik | **gate GO** |

**Urutan tercepat menuju Go mati:** butir 1 (eksekusi C-03) → butir 4 → gate GO → butir 6 & 7 →
Fase 5. Butir 2 & 5 bisa dijawab kapan pun tapi **wajib sebelum** `backend/` diarsipkan; butir 3
tidak memblokir cutover.
