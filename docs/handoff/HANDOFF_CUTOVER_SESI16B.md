# HANDOFF — Cutover Sesi 16B (Paket B: paritas wire commerce/portal + gate O43 c)

> **Pendahulu:** `HANDOFF_CUTOVER_SESI14.md` (PR #76). Yang masih berlaku tidak diulang —
> terutama SESI9 §6 (aturan rumah yang menggigit) dan SESI12 §2.4 (`npm run db:rebuild`,
> satu-satunya jalur benar untuk DB lokal).
> **Sesi paralel:** Paket A (`HANDOFF_CUTOVER_SESI16A.md`) — jalur delivery. Pembagian &
> aturan anti-tabrakan: `docs/backlog/PENSIUN_GO_STATUS_DAN_TASK_PARALEL.md` §3.

## 0. Posisi persis — SALIN INI KE SESI BERIKUTNYA

| | |
|---|---|
| **Branch** | `claude/go-retirement-progress-6r14e0` |
| **Basis** | `main@a37e432` **+ merge `claude/cdps-sg-cutover-sesi13-2kmgy4` (HEAD #76)** — PR ini **bertumpuk di atas #76** |
| **PR** | **#78** → `main`, draft |
| **Live `CDPS SG`** | **40 migrasi · 54 tabel · 17 event** — **tidak ditulis** sesi ini (nol perubahan skema) |

**Angka acuan (Postgres 16 lokal, DB dibangun ulang dari nol dengan 40 migrasi):**
`@cdps/domain` **566** (+1 skip) · `apps/api` **255** · `@cdps/core` **113** · `@cdps/db` **9** ·
`web-internal` **26** · 7 gate seed **PASS** · keempat invariant SQL **PASS** · typecheck bersih
semua workspace.

> Beda dari SESI14: `apps/api` **246 → 255** (+9, seluruhnya `shape-parity.test.ts`). Sisanya
> tidak bergerak — sesi ini **nol perubahan** pada `wire.ts`, `packages/domain`, dan
> `supabase/**`.

> ⚠️ **Kenapa bertumpuk di atas #76, bukan dari `main`.** #76 mengubah `wire.ts` (menambah 6
> converter) dan `packages/domain/src/{sales,client,employees}.ts`. Mengerjakan Paket B dari
> `main` berarti gate paritas ini tidak akan pernah melihat converter #76, dan `wire.ts` akan
> konflik saat #76 masuk. **Merge #76 dulu, lalu #78.**

---

## 1. Apa yang sesi ini benar-benar hasilkan

Task-nya: **paritas field-by-field 29 converter commerce/portal.** Hasilnya bukan yang
diperkirakan, dan itu bagian dari laporan.

### 1.1 Audit 29 converter: NOL cacat baru 🟢

Metode SESI14 §5 T1 (diff tipe FE ↔ struct Go ↔ converter) dijalankan atas seluruh 29 — bukan
disampel. Supaya tidak bergantung pada ketelitian mata, diff-nya **dimekanisasi**: ekstrak
`json` tag dari `backend/internal/**` (148 struct), ekstrak `interface` FE, ekstrak `*Wire`,
lalu bandingkan himpunan kuncinya.

| Modul | Converter | Hasil |
|---|---|---|
| `sales.ts` | `masterServiceToWire` · `quoteToWire` | ✅ cocok Go |
| `leads.ts` | `leadStubToWire` · `attemptStubToWire` · `poolRowToWire` · `leadRowToWire` · `leadDetailToWire` · `deleteRequestToWire` · `deleteRequestQueueRowToWire` | ✅ |
| `clients.ts` | `intakeClientToWire` · `amWorkloadToWire` · `assignmentToWire` · `strategyToWire` · `strategyRequirementToWire` · `clientDetailToWire` | ✅ |
| `clients.ts` | `clientListRowToWire` | ⚠️ divergen — **sudah diputus pemilik**, §1.2 |
| `marketing.ts` | `marketingCampaignToWire` · `campaignRollupToWire` · `performanceRecordToWire` · `marketingMetricsToWire` | ✅ |
| `portal.ts` | `staffLandingToWire` · `teamPortalToWire` · `managementDashboardToWire` | ✅ (catatan §1.4) |
| admin/auth | `adminEmployeeToWire` · `roleMappingToWire` · `layeredRoleToWire` · `credentialInfoToWire` | ✅ |
| notifikasi | `notificationToWire` · `inboxToWire` | ✅ |

Tiga kelas yang nama-field tidak bisa tangkap juga diperiksa terpisah:

1. **`Date` lupa `.toISOString()`** — nol. Semua kandidat (`effective_from`, `start_date`,
   `end_date`, `period`) memang **sudah `string`** di read model domain, bukan `Date`.
2. **Kunci nullable HILANG alih-alih `null`** (pelajaran O43) — nol pelanggaran di Paket B.
   `assignmentToWire` (`previous_am`, `reason`) dan `strategyToWire` (`approved_by`,
   `revision_notes`) memang menghilangkan kuncinya saat falsy, **dan itu benar**: tipe FE
   mendeklarasikan keempatnya **opsional** (`previous_am?`), bukan `string | null`. Yang
   dilarang adalah menghilangkan kunci yang FE deklarasikan `| null`.
3. **Nilai diambil dari field yang salah** (kelas `reason`←`note` yang membuat tombol
   `[Bermasalah]` mati) — diperiksa dengan heuristik: setiap `snake_key: x.camelSource`
   di-cek apakah `camelCase(snake_key) == camelSource`. 28 ketidakcocokan muncul, **semuanya
   alias yang sah** dan sudah terverifikasi ke Go — mis. `strategyRequirementToWire`
   mengirim `pinned_requires_strategy_plan ← r.pinnedRequirement`, asimetri nama yang **persis
   ada di struct Go**, dan `financeScanResultToWire` `overdue_flagged ← markedOverdue`
   (pemetaan semantik #76).

### 1.2 `clientListRowToWire` — divergen, tapi JANGAN "diperbaiki"

Diff mekanis menemukan `GET /clients` mengirim 11 kunci sementara FE mengetikkannya `Client[]`
(19 kunci): **11 kunci Go tidak dikirim** (`link_toko` · `gmv_baseline` · `target_gmv` ·
`total_sales` · `marketing_budget` · `origin_campaign_id` · `commission_payment_pic_id` ·
`transaction_id` · `platforms` · `sales_allocation` · `services`) dan **3 kunci dikirim yang
`clientView` Go tidak punya** (`sales_pic_nama` · `assigned_am_id` · `created_at`).

**Ini sudah diputus pemilik 2026-07-29 — DECISIONS O43 (a), "proyeksi sempit DIPERTAHANKAN".**
Halaman roster merender 7 kolom, semuanya dikirim; memperlebarnya = N+1 atas
platforms/allocations/services untuk kolom yang tidak pernah dibaca. Angka 11/3/8 yang saya
temukan **identik** dengan yang tercatat di keputusan itu — konfirmasi independen bahwa
metodenya bekerja, bukan temuan baru.

> **Pelajaran prosedural, dan ini yang mahal:** saya sempat menyiapkan "perbaikan" untuk ini
> sebelum membaca DECISIONS sampai selesai. Diff mekanis tidak bisa membedakan **cacat** dari
> **keputusan**. Sebelum memperbaiki divergensi apa pun: **grep `DECISIONS.md` untuk nama
> converter-nya.**

### 1.3 Karena audit manual nol, deliverable-nya digeser: **O43 butir (c)** 🟢

O43 mencatat tiga tuntutan. (a) sudah diputus pemilik; (b) *"berapa endpoint lain yang salah
bentuk?"*; (c) **test paritas-bentuk otomatis** — dan (c) disebut O43 sendiri sebagai
*"satu-satunya cara kelas ini berhenti lolos CI"*. (c) belum pernah dikerjakan.

Audit manual saya menemukan nol cacat. Itu justru argumen terkuat untuk (c): yang mahal bukan
cacat hari ini, tapi cacat **berikutnya** — dan kelas ini sudah lolos CI **empat kali**
(C03-F2 · O43 #1 · lapisan wire M5 · 9 endpoint Fase 2), setiap kali dengan route yang ADA dan
menjawab **200**.

**`apps/api/src/lib/shape-parity.test.ts`** (9 test) mendiff kunci **seluruh 84** `*Wire`
terhadap `interface` FE yang dilayaninya, persis seperti `route-parity` mendiff path.

**Di-anchor ke tipe FE, BUKAN struct Go — itu keputusan desain, bukan jalan pintas.** Go
dibekukan dan diarsipkan di C-05, jadi gate ber-anchor Go akan **mati bersama `backend/`**;
ditambah dua endpoint (`/transactions/{id}/commission`, `/payment`) tidak punya handler Go sama
sekali. Tipe FE **selamat** dari pensiun Go, dan logikanya cukup: halaman tidak bisa membaca
kunci yang tidak ia deklarasikan, dan tidak bisa merender kunci yang tidak dikirim ⇒
*dideklarasikan-tapi-tidak-dikirim* adalah cacat **by construction**, tanpa perlu oracle.

Tiga ledger, semuanya pola `KNOWN_GAPS` (**hanya boleh menyusut**):

| Ledger | Isi | Kalau ditambah |
|---|---|---|
| `WIRE_TO_FE` | registry 84 pasangan, **file-qualified** | converter baru tanpa entri ⇒ **CI merah** |
| `ALLOWED_EXTRA` | kunci di luar kontrak FE (8 converter) | bukan cacat (tak bisa mengeblank halaman), tapi **inilah jalan masuk kontrak karangan** — tiap entri hari ini diwarisi struct Go |
| `APPROVED_DIVERGENCE` | **1 entri**: `ClientListRowWire` (O43 a) | butuh entri DECISIONS |

Plus test *"ledger jujur"*: merah begitu sebuah entri jadi fiksi (converter diperbaiki tapi
pengecualiannya tertinggal sebagai dokumentasi cacat yang sudah tidak ada).

**Registry-nya file-qualified, dan itu bukan kerapian.** Enam nama tipe FE dipakai di lebih
dari satu berkas (`Brief` di `account.ts`+`kol.ts`+`creative.ts`; `Metrics` di
`tasks.ts`+`creative.ts`+`marketing.ts`; juga `Campaign`, `Card`, `Snapshot`, `ScanResult`,
`PendingBlockRequest`). Prototipe pertama saya memasangkan per nama polos dan **membandingkan
`PendingBlockRequestWire` terhadap `block-requests.ts::PendingBlockRequest`** — tipe
**sisi-klien** 3 kunci camelCase yang diturunkan dari audit trail dan **tidak pernah dikirim
route mana pun**. Hasilnya: 7 "kunci ekstra" palsu. Pasangan yang benar `tasks.ts` (8 kunci).
Memasangkan per nama polos = membandingkan converter dengan tipe tak terkait lalu menyebutnya
paritas.

### 1.4 Batas yang DINYATAKAN, bukan disembunyikan

- **Ekstraksi hanya level-atas.** Tiga interface ber-objek nested inline —
  `LeadDetailWire`, `ProposalWire`, `AttemptDetailWire` — kunci dalamnya **tidak
  dibandingkan**. Daftarnya **di-assert terhadap berkas**, jadi ia tidak bisa basi. Menutupnya
  = mengekstrak interface bernama di `wire.ts`, dan me-refactor blok converter bersama sementara
  sesi paralel mengeditnya adalah cara membuat konflik merge. **Sengaja ditinggal sebagai
  lanjutan.**
- **Gate ini membandingkan BENTUK, bukan NILAI.** Ia tidak akan menangkap
  `reason: domain.note` — kuncinya benar, isinya salah. Kelas itu masih butuh mata (atau Go),
  dan heuristik §1.1 butir 3 adalah alat terbaik yang saya punya untuknya.
- **Ketiga converter portal adalah komposit.** `staffLandingToWire` mendelegasi ke `cardToWire`
  + `perfSnapshotToWire`; `teamPortalToWire` ke `perfTeamRollupToWire` +
  `pendingBlockRequestToWire`. Ketiganya **milik Paket A**, jadi paritas portal dibatasi paritas
  Paket A. Bentuk level-atasnya cocok Go persis; gate §1.3 mengecek converter delegasinya
  langsung, jadi celahnya tertutup dari sisi lain.

---

## 2. Pelajaran yang paling penting: gate saya sendiri sempat HAMPA

Test-nya **divalidasi dengan mutasi, bukan hanya dijalankan.** Empat cacat disuntik satu per
satu ke `wire.ts` dan tiap satu harus memerahkan test yang tepat:

| Mutasi | Hasil |
|---|---|
| hapus kunci FE dari `LeadRowWire` | 🔴 *"never emits: id"* ✅ |
| kunci `totalHarga` camelCase menyeberang | 🟢 **HIJAU — gagal menangkap** |
| `NewThingWire` baru tanpa entri registry | 🔴 *"unregistered wire interfaces"* ✅ |
| perlebar roster tapi biarkan entri divergence | 🔴 *"delete from APPROVED_DIVERGENCE"* ✅ |

Mutasi kedua menyingkap **assertion anti-camelCase saya tidak mungkin gagal**: kelas karakter
regex ekstraksi kunci `[a-z_0-9]` membuat `totalHarga` **tidak pernah terbaca**, jadi tidak
pernah ada yang bisa menandainya. Diperbaiki ke `[A-Za-z_]`; mutasi kedua sekarang merah.

> **Generalisasinya, dan biayanya nyata:** **gate yang belum pernah dibuktikan GAGAL belum
> diketahui bekerja.** Kalau saya hanya menjalankan test dan melihat 9 hijau, saya akan
> men-commit sebuah assertion hampa **sambil melaporkan bahwa kelas cacat camelCase sudah
> ditutup** — laporan palsu yang lolos review, karena test-nya ada dan hijau. Untuk gate apa
> pun yang Anda tambahkan setelah ini: suntik cacatnya dulu, lihat merahnya, baru percaya.

---

## 3. Yang TIDAK disentuh sesi ini

Nol perubahan pada `wire.ts` (mutasi dipulihkan, `git diff` bersih — diverifikasi), nol pada
`packages/**`, `supabase/migrations/**`, `web-internal/**`, `backend/**`,
`.github/workflows/ci.yml`, `CLAUDE.md`. **Live `CDPS SG` tidak ditulis.** Converter Paket A
tidak disentuh; gate §1.3 **mengeceknya** tapi tidak mengeditnya.

## 4. Lanjut dari sini

1. **Merge #76 lalu #78** (urutan itu — #78 bertumpuk).
2. **Paket A** (`PROMPT_PAKET_A_WIRE_PARITY.md`) belum dijalankan. Gate §1.3 sekarang menjaga
   converter Paket A juga, jadi kalau A menemukan cacat, gate ini akan **ikut merah sampai
   diperbaiki** — itu memang yang diinginkan.
3. **Lanjutan yang tersisa dari sesi ini:** 3 interface nested inline (§1.4) · `apps/api` masih
   **tanpa eslint config** (~250 berkas TS tak pernah di-lint; jatah Paket A T2).
4. **Tujuh butir Fase 4 tidak bergerak** — semuanya butuh akses/otoritas pemilik. Daftar
   lengkap: `PENSIUN_GO_STATUS_DAN_TASK_PARALEL.md` §5. Jalur tercepat tetap **eksekusi C-03
   dari mesin ber-akses**; skripnya sudah siap sejak 2026-07-29.
