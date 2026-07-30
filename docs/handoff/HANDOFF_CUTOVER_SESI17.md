# HANDOFF — Cutover Sesi 17 (penggabungan Paket A + Paket B)

> **Pendahulu:** `HANDOFF_CUTOVER_SESI16A.md` (Paket A, **di `main`**) dan
> `HANDOFF_CUTOVER_SESI16B.md` (Paket B, hidup di PR #78).
> Yang masih berlaku tidak diulang — terutama SESI9 §6 (aturan rumah yang menggigit) dan
> SESI12 §2.4 (`npm run db:rebuild`, satu-satunya jalur benar untuk DB lokal).

## 0. Posisi persis — SALIN INI KE SESI BERIKUTNYA

| | |
|---|---|
| **`main`** | **`e5755ff`** = Merge PR #79 (Paket A). Berisi #75 → #77 → #76 → **#79**. |
| **Branch aktif** | `claude/go-retirement-progress-6r14e0` — **Paket B**, PR **#78** (draft) |
| **Basis #78** | `main@e5755ff` sudah di-merge masuk. **Nol konflik tersisa.** |
| **Diff #78 vs `main`** | **5 berkas**: `apps/api/src/lib/shape-parity.test.ts` (416) + 3 docs + 2 baris `DECISIONS.md` |
| **Live `CDPS SG`** | **40 migrasi · 54 tabel · 17 event** — tidak ditulis oleh paket mana pun |

**Angka acuan gabungan A+B (Postgres 16 lokal, DB dibangun ulang dari nol, 40 migrasi):**
`apps/api` **299** · `@cdps/domain` **566** (+1 skip) · `@cdps/core` **113** · `@cdps/db` **9** ·
`web-internal` **26** · 7 gate seed **PASS** · 4 invariant SQL **PASS** ·
`route-parity` **5/5, `KNOWN_GAPS` KOSONG** · typecheck bersih semua workspace ·
`npm run lint -w @cdps/api` **0 error, 1 warning** (T2b).

> Rincian 299: **290** dari `main@e5755ff` (246 basis + 44 `wire.delivery.test.ts` Paket A)
> **+ 9** gate `shape-parity.test.ts` Paket B.

**Cara melanjutkan:**
```bash
git fetch origin main claude/go-retirement-progress-6r14e0
git checkout claude/go-retirement-progress-6r14e0
git log --oneline -1                       # HEAD berisi merge main@e5755ff
npm ci && npm run db:rebuild -- --yes
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps" npm test --workspaces --if-present
```

> ⚠️ **Cek `list_pull_requests` sebelum apa pun, bukan hanya `git log`.** Sesi ini menyaksikan
> `main` maju **tiga kali** (#77 → #76 → #79) sementara PR #78 terbuka, dan tiap kali
> mengonflikkan #78. Handoff bertanggal menggambarkan kondisi saat ditulis; PR terbuka
> menggambarkan kondisi *sekarang*.

---

## 1. Penggabungan sudah DILAKUKAN, bukan direncanakan

Yang paling penting untuk diketahui: **gate Paket B belum pernah menilai kerja Paket A**, karena A
bercabang dari `main` yang belum punya `shape-parity.test.ts`. Kombinasinya baru diuji **di sesi
ini**, dan hasilnya:

| Cek gabungan | Hasil |
|---|---|
| Gate `shape-parity` (84 converter) terhadap kerja A | 🟢 **9/9 hijau** |
| `wire.delivery.test.ts` A (44) + gate B (9) berdampingan | 🟢 `apps/api` **299** |
| Registry `WIRE_TO_FE` masih lengkap sesudah A | 🟢 A **nol edit `wire.ts`** ⇒ nol interface baru ⇒ nol entri registry perlu ditambah |
| Eslint config A menilai berkas gate B | 🟢 **0 error** (1 warning pre-existing di `mslseed.ts`, T2b) |
| 4 invariant SQL + 7 gate seed pasca-merge | 🟢 PASS |

**Nol konflik nyata antar isi kedua paket.** Sebabnya bukan keberuntungan: aturan §3.1
`PENSIUN_GO_STATUS_DAN_TASK_PARALEL.md` memisahkan berkas test per akun
(`wire.delivery.test.ts` vs `shape-parity.test.ts`, nol edit `wire.test.ts` bersama), dan
**kedua audit berakhir nol cacat sehingga tak ada yang mengedit `wire.ts` sama sekali** —
justru berkas yang paling berisiko bertabrakan.

### 1.1 Satu-satunya berkas yang benar-benar konflik: `docs/DECISIONS.md` (3×)

Persis seperti yang diprediksi §3.1 butir 3 — keduanya menyisipkan di baris **teratas** tabel
`Decided`. Konfliknya terjadi **tiga kali** (satu per merge `main`), dan bentuknya berbeda-beda:

| Merge | Bentuk konflik | Resolusi |
|---|---|---|
| #77 | kedua sisi menyisipkan baris **2026-07-30** di posisi sama | simpan **kedua** baris |
| #76 | sisi `main` **kosong** di posisi itu (urutan baris tak bisa diselaraskan) | simpan baris O43(c) |
| #79 | kedua sisi menyisipkan baris **2026-07-30** (Paket A vs Paket B) | simpan **kedua**, baris A dulu (urutan `main`) lalu B ⇒ diff jadi satu insertion bersih |

Setiap kali **diverifikasi bahwa nol baris hilang dan nol baris terduplikasi** — kelima baris
teratas dicek satu per satu, masing-masing tepat ×1. Itu bukan formalitas: resolusi "ambil punyaku"
pada tabel append-only **menghapus keputusan orang lain secara senyap**, dan `DECISIONS.md` justru
berkas yang paling tidak boleh kehilangan baris.

> **Untuk paralelisasi berikutnya:** kalau ada 3+ sesi menulis `DECISIONS.md`, pertimbangkan
> menyisipkan di **bawah** blok tanggal alih-alih paling atas, atau satu berkas per tanggal yang
> di-concat. Tiga konflik untuk dua sesi sudah cukup jadi sinyal.

---

## 2. Hasil kedua paket, disatukan

### 2.1 Paket A (#79, di `main`) — 25 converter delivery

**Nol cacat pengeblank-halaman ⇒ nol edit `wire.ts`.** Yang ditambahkan adalah **bukti**:
`wire.delivery.test.ts` (+44 test), `toEqual` objek penuh + assertion **rekursif** nol kunci
camelCase + perilaku omitempty/null per edge. Ditambah **A2** eslint config `apps/api` (210 berkas
TS yang sebelumnya **tak pernah di-lint** — 0 error, 1 warning) dan **A3** dua rujukan path
pasca-Fase 0.

Tiga hal dari laporan A yang layak dibawa terus:
- **`assetToWire`**: `*float64,omitempty` ⇒ null **di-omit** tapi **0 DIKIRIM** — `attributed_gmv`
  "recorded 0" ≠ "never recorded". Itu perbedaan yang mudah dirusak refactor.
- **`creatorListToWire.last_compiled`**: dikirim `null` eksplisit walau Go `omitempty`. Sengaja —
  stance O43 house-wide. Tercatat di `DECISIONS.md`.
- **`perfSnapshotToWire` mengirim `id`** yang tipe FE tak deklarasikan: kunci **ekstra**, bukan
  hilang ⇒ tak mengeblank apa pun. Sudah terdaftar di `ALLOWED_EXTRA` gate B — **kedua sesi
  menemukan hal yang sama secara independen.**

### 2.2 Paket B (#78) — 29 converter commerce/portal + gate O43 (c)

**Nol cacat baru** dari 29 converter (metode dimekanisasi: 148 struct Go ↔ interface FE ↔ 84
`*Wire`). Satu divergensi yang muncul, `clientListRowToWire`, adalah **keputusan pemilik** O43 (a)
2026-07-29 — angka 11/3/8 identik dengan yang tercatat di sana.

Karena auditnya bersih, deliverable digeser ke **O43 butir (c)**:
`apps/api/src/lib/shape-parity.test.ts` — mendiff kunci **seluruh 84** converter terhadap tipe FE,
**di-anchor ke tipe FE bukan struct Go** supaya gate-nya **selamat** saat C-05 mengarsipkan
`backend/`. Tiga ledger pola `KNOWN_GAPS` (`WIRE_TO_FE` · `ALLOWED_EXTRA` ·
`APPROVED_DIVERGENCE`, 1 entri) + test "ledger jujur".

> ### 🔴 Pelajaran yang paling mahal di kedua paket
> Gate B **divalidasi dengan mutasi**, dan mutasi ketiga menyingkap **assertion anti-camelCase-nya
> sendiri HAMPA**: kelas karakter regex ekstraksi kunci `[a-z_0-9]` membuat kunci camelCase
> **tidak pernah terbaca**, jadi tidak mungkin ditandai. Sudah diperbaiki ke `[A-Za-z_]`.
>
> Tanpa mutasi itu, gate hampa akan ter-commit **sambil dilaporkan menutup kelas camelCase** —
> laporan palsu yang lolos review, karena test-nya ada dan hijau.
> **Gate yang belum pernah dibuktikan GAGAL belum diketahui bekerja.** Berlaku untuk gate apa pun
> yang ditambahkan sesudah ini: suntik cacatnya dulu, lihat merahnya, baru percaya.

### 2.3 Kenapa DUA audit berakhir nol cacat, dan kenapa itu bukan pemborosan

Ketiga preseden kelas-2 yang terbukti (`clientDetailToWire` O41, `InstallmentRow.proofOfPayment`,
`skippedApprovedBriefs`) semuanya di jalur **commerce/finance**, dan ketiganya sudah ditutup #75/#76
**sebelum** kedua paket mulai. Jadi "nol" adalah hasil yang benar, bukan audit yang lalai.

Nilainya ada di dua hal yang tidak dimiliki sebelumnya: **paritas 54 converter sekarang
DIBUKTIKAN**, bukan diasumsikan, dan pembuktiannya **dikunci test** — jadi ia tetap berlaku
sesudah `backend/` diarsipkan dan oracle Go hilang. Sebelum kedua paket, tidak ada satu pun test
yang gagal ketika sebuah kolom kosong.

---

## 3. Yang harus dikerjakan sesi berikutnya

### 3.1 Langkah pertama: merge #78

Itu satu-satunya PR paket yang belum masuk. CI-nya hijau, konfliknya sudah beres, dan
`main@e5755ff` sudah di-merge masuk. **Kalau `main` sudah maju lagi**, merge `main` dulu, jalankan
`db:rebuild` + suite penuh **di atas hasil merge** (jangan diasumsikan), lalu push.

### 3.2 Sisa engineering — semuanya kecil atau terkunci

| # | Sisa | Catatan |
|---|---|---|
| 1 | **3 interface nested inline** (`LeadDetailWire`, `ProposalWire`, `AttemptDetailWire`) belum dibandingkan gate | Ekstraksi gate hanya level-atas. Daftarnya **di-assert terhadap berkas** jadi tak bisa basi. Menutupnya = ekstrak interface bernama di `wire.ts`; sekarang **aman** dilakukan (nol sesi paralel yang mengedit `wire.ts`) |
| 2 | **T2b** — 1 warning eslint `mslseed.ts:36` (`'msl' is defined but never used`) | Di luar ruang lingkup A. Trivial |
| 3 | Panggil `npm run lint -w @cdps/api` di job `api` CI | A merekomendasikan; **aman sekarang** (eslint exit 0 pada warning). Untuk `--max-warnings 0`, bereskan T2b dulu |
| 4 | **T3** adapter CSV/dry-run di atas `POST /leads/bulk` | ⛔ **TERKUNCI O47.** Jangan mulai sebelum pemilik menjawab — kalau jawabannya "klien+ledger juga", desainnya berbeda |
| 5 | **Fase 5 / C-05** | ⛔ **TERKUNCI** gate GO **dan** O47 |

**Gate paritas bentuk sekarang membebaskan pekerjaan yang tadinya butuh Go.** Butir 1 dulunya
"butuh `backend/` masih ada"; sekarang tidak — gate ber-anchor tipe FE, jadi ia tetap bekerja
sesudah arsip. Itu mengubah urutan prioritas: **tekanan waktu "sebelum C-05" sudah hilang** untuk
kelas paritas bentuk.

### 3.3 Yang JANGAN dikerjakan

- **Jangan mulai C-05** (hapus job `backend`, arsipkan `backend/`, `Makefile`, config Railway)
  sebelum gate GO **dan** O47 dijawab.
- **Jangan menulis ke live `CDPS SG`** tanpa persetujuan eksplisit pemilik per-apply.
- **Jangan menambah baris ke `KNOWN_GAPS`** (`route-parity`) — harus tetap kosong.
- **Jangan menambah entri ke `ALLOWED_EXTRA`/`APPROVED_DIVERGENCE`** tanpa entri `DECISIONS.md`.
  Ketiganya ledger yang **hanya boleh menyusut**.
- **`backend/**` read-only.**

---

## 4. Jalur kritis: sekarang 100% di sisi pemilik

Sesudah #78 masuk, **nol butir sisa pensiun Go bisa ditutup Claude tanpa akses atau otoritas
pemilik.** Tujuh butir, dari `PENSIUN_GO_STATUS_DAN_TASK_PARALEL.md` §5:

| # | Butir | Memblokir |
|---|---|---|
| 1 | **C-03 — 3 SKIP**: jalankan `CUTOVER_C03_DEPLOYMENT_RUNBOOK.md` dari mesin ber-akses `*.vercel.app`. Skrip **sudah siap sejak 2026-07-29** — tinggal dijalankan, jangan disusun ulang | **gate C-04** |
| 2 | **O47** — `cmd/import` (~3.700 baris) port atau tinggalkan? | **C-05** + T3 |
| 3 | **O46** — 3 arm visibility RLS lebih sempit dari Go | klaim *"paritas Go"* |
| 4 | **O34 · O26 · O35 · O9** — aktor produksi + sub-tim Creative | **DoD C-04** |
| 5 | **Retensi PII** `backend/testdata/import_samples/` — arsip / hapus / anonimkan | **C-05** |
| 6 | **Backup MySQL Railway** + **OQ-2** (`count(*)` per tabel) | **gate GO** |
| 7 | **Rencana rollback** disepakati | **gate GO** |

Ditambah dua butir kebersihan yang tidak memblokir apa pun: **tutup #73 & #74** tanpa merge
(alasan di `PENSIUN_GO_STATUS_DAN_TASK_PARALEL.md` §2).

**Urutan tercepat menuju Go mati:** butir 1 → butir 4 → gate GO → butir 6 & 7 → Fase 5.
Butir 2 & 5 bisa dijawab kapan pun tapi **wajib sebelum** `backend/` diarsipkan; butir 3 tidak
memblokir cutover.
