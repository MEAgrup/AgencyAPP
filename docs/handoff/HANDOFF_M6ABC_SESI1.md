# HANDOFF — M6A/M6B/M6C Sesi 1 (titik mulai sesi berikutnya)

> **Konteks:** QA pemilik atas `https://web-internal-mea.vercel.app/account/services/SVC-202608-0002`,
> bagian **Strategi & Plan**, terhadap tiga PRD baru yang diunggah di sesi ini.
> Rantai handoff cutover (`HANDOFF_CUTOVER_SESI*.md`) **tetap berlaku** dan tidak
> digantikan berkas ini — yang ini khusus M6A/6B/6C.
>
> Masih berlaku dan tidak diulang: SESI9 §6 (aturan rumah) · SESI12 §2.4
> (`npm run db:rebuild`) · SESI24 §1.4 (repo publik ⇒ jangan tambah NIK/PII).

## 0. Posisi persis — SALIN INI KE SESI BERIKUTNYA

| | |
|---|---|
| **Branch kerja** | `claude/qa-onboarding-service-account-1yrl1l` (di-reset dari `origin/main` @ `9aa9090`, PR #97) |
| **Migrasi** | **55 berkas** lokal. **3 BARU sesi ini, BELUM diterapkan ke live `CDPS SG`** — lihat §4 |
| **Tabel** | 58 lokal (dari 55). `entity_prefix`, `plan_gate_config`, `service_plan_gate` |
| **`notif_events`** | **17 — TIDAK disentuh.** 13 event M6A/6B/6C belum ada (O55) |
| **Test** | api 324 · core 113 · db 15 · domain 686 (+1 skip) · web-internal 116. **Semua hijau** |
| **Build** | `npx next build web-internal` EXIT 0 |
| **Walk HTTP** | 48/48 lewat route nyata (`apps/api` :3111), skrip di §5 |

**Perintah untuk melanjutkan:**

```bash
git fetch origin main
git checkout claude/qa-onboarding-service-account-1yrl1l   # atau -B dari origin/main kalau sudah merge
npm install
service postgresql start
su postgres -c "psql -c \"ALTER USER postgres WITH PASSWORD 'postgres';\""
npm run db:rebuild -- --yes
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps" npm test --workspaces --if-present
npx vitest run --root web-internal      # TERPISAH — bukan anggota `workspaces`
```

---

## 1. Temuan QA utama — dan kenapa itu bukan bug kode

**Semua 36 baris `master_service_versions` di live `CDPS SG` ber-`requires_strategy_plan = false`**,
termasuk **"Store Management (Paket)"**. Konsekuensinya: nol layanan di produksi
plan-gated, jadi seluruh jalur Strategi & Plan **tidak bisa dijangkau siapa pun** —
halaman melabeli setiap layanan "Direct (tanpa Plan)" lalu menawarkan form Brief.

`SVC-202608-0002` sendiri: `Store Management (Paket)`, `[Awaiting Onboarding]`,
`requires_strategy_plan = false`, `override = null`, AM `2305290280`, klien
`CLI-202608-0002` ("toko ku").

Kode menghormati flag itu dengan benar. **Datanya** yang belum pernah ditetapkan —
dan M6C GA-2 sudah menduganya: *"every catalog entry needs re-tiering, which is a
data task, not a code task."*

Temuan kedua, ditemukan tanpa dicari, oleh tes CI yang baru: **tiga prefix mencetak
ID di produksi tanpa terdaftar di registry TS** — `ACT` (`activity.ts:210`),
`LDR` (`leads.ts:1455`), `DEMO` (`demo.ts:87`) semuanya memanggil
`ex.ident.identNext('…')` mentah, melewati wrapper bertipe `nextId` yang
memeriksa `isRegisteredPrefix`. Sementara `DBR` duduk di `PREFIXES` tanpa satu pun
pemakai. Tes `ident.test.ts` bahkan **meng-assert `DEMO` TIDAK terdaftar** —
komentar warisan dari port Go yang sudah tidak benar.

---

## 2. Yang SELESAI sesi ini (M6C + fondasi)

Rinciannya di `docs/backlog/M6ABC_BACKLOG.md` §1. Ringkas:

1. **Tiga PRD masuk repo** — `docs/prd/CDPS_Module6A_Strategi.md`,
   `…6B_Plan.md`, `…6C_Plan_Gate_Satuan.md`. Sebelumnya tidak ada di repo.
2. **`entity_prefix` registry + tes CI** (M6A §7, "dev action BEFORE coding").
   `STRG`/`PLAN`/`VND` terbukti BEBAS ⇒ fallback `STGY`/`PPRD` tidak dipakai.
   Tiga call site dipindah ke wrapper bertipe.
3. **Tier katalog tiga nilai** + pin di `services`, diikat CHECK, dinormalkan
   trigger `normalize_plan_tier()` supaya INSERT lama tidak perlu tahu dua kolom.
4. **`plan_gate_config`** — ambang berversi (20/bulan · Rp 15jt/bulan · 1 bulan).
5. **`service_plan_gate` + mesin rekomendasi** — 3 pemicu keras, 4 lunak,
   pemicu DISIMPAN (tidak dihitung ulang), `kesesuaian` dijaga CHECK turunan.
6. **Form G-A/G-B/G-C** (`web-internal/src/components/PlanGatePanel.tsx`),
   rekomendasi live dari server (bukan salinan kedua trigger table).
7. **Eskalasi vs de-eskalasi asimetris** (Rules 11/12), de-eskalasi wajib
   ringkasan GB-8.
8. **Langkah onboarding PERTAMA baru `determine_plan`** —
   `guardBriefCreation` menolak tier tengah yang belum dijawab dengan pesan
   sendiri, dan `nextOnboardingStep` memeriksanya SEBELUM `requires_strategy_plan`.
9. **Re-tier 33 entri katalog live** — usulan mekanis dari contoh M6C §3 (O54).

### Bug nyata yang ditemukan walk HTTP (bukan test unit)

Route plan-gate menyerahkan `b.ringkasan_penugasan` mentah ke domain, yang
membaca `divisiPic`/`hasilDiharapkan`. Semua field datang `undefined`, jadi
de-eskalasi yang MEMBAWA ringkasan lengkap ditolak
`[ringkasan penugasan wajib diisi untuk jalur tanpa Plan]` — error validasi yang
menyalahkan pemanggil atas terjemahan yang route-nya sendiri tidak lakukan.
Diperbaiki dengan `assignmentSummaryFromWire` di `wire.ts` (satu-satunya tempat
batas camelCase↔snake_case, CLAUDE.md) + 6 test regresi.
**Pelajarannya: unit test per sisi hijau sementara pasangannya rusak.**

---

## 3. Yang BELUM — dan urutan yang benar

```
entity_prefix ──► M6C tier+gate ──► M6A Strategi ──► M6B Plan
   ✅ SELESAI        ✅ SELESAI        ❌ BELUM         ❌ BELUM
                          ▲                                │
                          └──── Rule 6 "Plan Satuan" ◄──────┘
```

**Form Strategi di halaman itu masih 6 field M6 §4** (`objective`,
`target_kpi`, `divisions_involved`, `planned_brief_outline`,
`timeline_start/end`) — **bukan** Section A→J M6A (±100 field, baseline numerik
per channel, diagnosa yang WAJIB mengutip field-ID baseline, register asumsi,
floor price per hero SKU, tautan read-only ber-token untuk klien). **Entitas
`PLAN` belum ada sama sekali.**

Ticket per-ticket + catatan implementasinya ada di
`docs/backlog/M6ABC_BACKLOG.md` §2 (A-02…A-12) dan §3 (B-01…B-11).

**Prasyarat M6A yang sering dilupakan:** `VND-` Vendor entity. M6A §7 menyebutnya
blocker — E-8 dan F-4 tidak bisa diimplementasi sebelum tabelnya ada, dan ia
"belongs in the same migration batch as `STRG`". Prefix-nya sudah terdaftar,
tabelnya belum.

---

## 4. ⚠️ Migrasi BELUM diterapkan ke live

Tiga migrasi baru **hanya diterapkan ke DB lokal** (`npm run db:rebuild`):

| Migrasi | Isi |
|---|---|
| `20260806060000_entity_prefix_registry.sql` | tabel + backfill 29 prefix |
| `20260806061000_m6c_plan_gate.sql` | tier + `plan_gate_config` + `service_plan_gate` + trigger normalisasi + RLS |
| `20260806062000_m6c_retier_catalog.sql` | penetapan tier 33 entri + re-pin Service yang belum jalan |

Terapkan HANYA lewat `supabase db push` / `apply_migration` — **jangan pernah
`psql -f`** (itu yang melahirkan drift O38).

### ⛔ `db push` masih TERBLOKIR PR #98 — landasannya dulu

**PR #98 terbuka dan wajib mendarat SEBELUM ketiga migrasi ini bisa di-push.**
Riwayat live memuat `20260805160305_rls_account_lead_service_scope` sementara
berkas repo masih bernama `20260805060000_…` — migrasi yang sama, nomor berbeda.
Tanpa rename itu, `db push` menganggapnya belum ter-apply **dan** out-of-order,
lalu menuntut `--include-all` — flag yang pada keadaan drift justru memaksa apply
ulang migrasi yang sudah berjalan. Itu ronde KETIGA dari drift yang sama; sebabnya
tetap deploy campur `apply_migration` (MCP) + `db push`.

**Konflik yang PR #99 tinggalkan untuk #98 — sudah diuji, bukan dugaan.**
`git merge` #98 ke `main` sekarang:

| Berkas | Hasil |
|---|---|
| `packages/domain/src/account.ts` | **auto-merge bersih** (perubahannya satu baris komentar; PR #99 menyentuh region lain) |
| `docs/DECISIONS.md` | **KONFLIK** — keduanya menyisipkan baris baru di puncak tabel `## Decided` |

Resolusinya sepele: **pertahankan KEDUA baris** (urutan menurut tanggal, entri
2026-08-06 keduanya). Tidak ada logika yang bertabrakan.

Nomor migrasi M6A/6B/6C (`20260806060000`/`061000`/`062000`) **tidak terpengaruh**
rename #98 — ketiganya sudah di atas `20260806050000`, jadi urutan lexicographic
tetap lestari dan push berikutnya kembali ke bentuk teraman: migrasi baru di
ujung, tanpa flag.

**Yang berubah di live setelah diterapkan** (dan kenapa ini butuh mata pemilik):
`SVC-202608-0002` akan menjadi `plan_tier = 'plan_wajib'` ⇒ **plan-gated**, jadi
halamannya berhenti menawarkan form Brief dan mulai menuntut Strategy & Plan.
Itu memang perilaku yang benar menurut M6A Rule 1 — tapi ia **mengubah jalur
kerja AM pada layanan yang sudah ada**, jadi konfirmasikan O54 dulu.

Re-pin dibatasi ke Service yang masih `[Awaiting Onboarding]`, tanpa override,
tanpa Strategy. Yang sudah lewat gerbangnya tidak disentuh.

---

## 5. Cara mengulang walk HTTP

Skrip walk **tidak** di-commit (ia berumur satu sesi dan menulis fixture `ZZW-`).
Kalau perlu lagi, bangun ulang dari pola ini:

```bash
cat > apps/api/.env.local <<'EOF'
SUPABASE_JWT_SECRET=local-dev-secret-local-dev-secret-1234
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/cdps
DIRECT_URL=postgres://postgres:postgres@127.0.0.1:5432/cdps
EOF
npx next dev --port 3111 apps/api &
# token: signToken() dari apps/api/scripts/lib/actors.mjs
# aktor seed: EMP-0002 Account/staff (AM), EMP-0005 Account/lead (SPV),
#             EMP-0003 Creative/staff (harus ditolak)
```

**Dua jebakan yang memakan waktu sesi ini — jangan ulangi:**

1. `audit_log` **append-only**: fixture dengan id tetap membuat assertion
   "tepat satu baris audit" lolos/gagal tergantung riwayat run. Pakai id unik
   per RUN (bukan per test), atau assert **dua terakhir**.
2. `portal.test.ts > management dashboard` **menghitung SEMUA klien** (bukan
   ber-namespace). Fixture walk yang tertinggal membuatnya merah dengan
   "expected 3, got 4" — yang terlihat seperti regresi M6C padahal sampah walk.
   Bersihkan `ZZW-%` sebelum menyimpulkan apa pun.

---

## 6. Pertanyaan terbuka yang memblokir klaim (bukan pekerjaan)

Ketiganya sudah dicatat di `docs/DECISIONS.md`:

| # | Butuh dari | Memblokir |
|---|---|---|
| **O54** | Yohan / Yulianti | penetapan tier 33 entri katalog adalah **usulan Claude**, bukan keputusan pemilik. 12/33 (36%) di tier tengah — di bawah ambang §12 (<40%) tapi tipis |
| **O55** | Hans (pemilik invariant) + Yohan | katalog notifikasi v2 (28 event) tetap terblokir ⇒ **13 event tidak diemisikan**. Untuk M6C: override AM **tercatat penuh** tapi SPV **tidak diberi tahu**. Kelas yang SAMA dengan O53 — sebaiknya diputuskan sekali untuk keduanya |
| **O56** | Yohan | urutan ronde berikutnya: **(a) M6A dulu** (form Strategi, paling terlihat di halaman yang di-QA) atau **(b) M6B dulu** (periode Plan, menutup `planSatuanStatus = belum_tersedia` dan mengaktifkan Rule 6 M6C) |

Tambahan yang belum dikonfirmasi, tercatat di backlog §4: ambang pemicu (GA-1),
RA-4/RA-5/RA-7 (M6A), PA-2/PA-3/PA-5 (M6B).

---

## 7. Deviasi PRD yang sudah dicatat — jangan "perbaiki" tanpa membaca alasannya

1. **Format ID.** PRD menulis `STRG-YYYY-NNNNN`; dipakai `STRG-YYYYMM-NNNN`
   (CLAUDE.md #1 non-negotiable, dan `ident_next` hanya bisa bentuk itu).
2. **`riwayat jsonb[]`** (M6C §10) TIDAK dibuat — riwayat immutable hidup di
   `audit_log` (aturan rumah 3). GC-1/GC-3 dibaca dari sana.
3. **`plan_id` tanpa FK** — tabel `PLAN` belum ada. FK menyusul di migrasi M6B,
   bersama partial unique index §4(b).
4. **Rule 6 belum jalan** — `planSatuanStatus` melapor `belum_tersedia` alih-alih
   berpura-pura Plan sudah dibuka.

---

## 8. PROMPT untuk sesi berikutnya — salin utuh

> Berkas ini adalah handoff-nya: `docs/handoff/HANDOFF_M6ABC_SESI1.md`.
> Backlog per-ticket: `docs/backlog/M6ABC_BACKLOG.md`.
> Prompt di bawah sengaja menyuruh keduanya dibaca lebih dulu, karena separuh
> jebakan sesi ini bukan soal kode melainkan soal urutan dan data.

```
Lanjutkan pembangunan M6A/M6B (Strategi & Plan) di CDPS.

BACA DULU, urut:
1. docs/handoff/HANDOFF_M6ABC_SESI1.md   ← posisi persis + jebakan yang sudah
                                           memakan waktu; jangan ulangi
2. docs/backlog/M6ABC_BACKLOG.md         ← ticket A-02…A-12 (M6A) & B-01…B-11 (M6B)
3. docs/prd/CDPS_Module6A_Strategi.md    ← spesifikasi form Strategi, penuh
4. docs/prd/CDPS_Module6B_Plan.md        ← spesifikasi Plan
5. docs/DECISIONS.md, cari O54/O55/O56   ← tiga pertanyaan terbuka
6. CLAUDE.md                             ← aturan rumah; Go/MySQL SUDAH PENSIUN,
                                           jangan sentuh backend/

KEADAAN SEKARANG (sesi lalu):
- Gerbang M6C SELESAI dan teruji: tier katalog tiga nilai, plan_gate_config,
  service_plan_gate + mesin rekomendasi, form G-A/G-B/G-C, eskalasi/de-eskalasi,
  langkah onboarding `determine_plan`.
- entity_prefix registry + tes CI SELESAI. STRG/PLAN/VND sudah terdaftar.
- M6A dan M6B BELUM ADA. Form Strategi di halaman Service masih 6 field M6 §4,
  bukan Section A→J. Entitas PLAN belum ada sama sekali.

TUGAS: mulai dari ticket M6A A-02 (entitas VND-) lalu A-03 (STRG + child tables),
kecuali saya bilang lain. VND adalah blocker yang M6A §7 minta masuk batch
migrasi yang SAMA dengan STRG — jangan tunda ke belakang.

BATASAN YANG TIDAK BOLEH DILANGGAR:
- Jangan tambah baris ke notif_events. Katalog notifikasi invariant BEKU dan
  amandemen v2 masih menunggu tanda tangan (O55). Implementasi tanpa emisi
  event, catat apa yang belum diemisikan.
- Format ID pakai konvensi rumah PREFIX-YYYYMM-NNNN (CLAUDE.md #1), BUKAN
  STRG-YYYY-NNNNN seperti tertulis di PRD. Deviasi ini sudah dicatat di
  DECISIONS.md 2026-08-06 — jangan "perbaiki" balik.
- Riwayat immutable hidup di audit_log, bukan kolom jsonb[] tersendiri.
- Transisi status HANYA lewat sm_transition. Mesin #15 (STRG) dan #16 (PLAN)
  belum terdaftar — daftarkan lewat migrasi, jangan reimplementasi di TS.
- Migrasi HANYA lewat supabase/migrations/** + supabase db push /
  apply_migration. JANGAN psql -f (itu yang melahirkan drift O38).
- Tiga migrasi sesi lalu BELUM diterapkan ke live, dan db push masih TERBLOKIR
  PR #98 (rename 20260805060000 -> 20260805160305 supaya cocok riwayat live).
  Landaskan #98 dulu; konfliknya hanya DECISIONS.md puncak tabel, pertahankan
  kedua baris. Lihat handoff §4.
- Sebelum menambah endpoint: cek apps/api/src/lib/route-parity.test.ts.
  KNOWN_GAPS harus tetap KOSONG.
- Setiap response body snake_case, diterjemahkan HANYA di apps/api/src/lib/wire.ts.
  Kunci yang HILANG lebih berbahaya daripada null — kirim null eksplisit.
  Ini bukan teori: sesi lalu route plan-gate menyerahkan body mentah ke domain
  dan sebuah fitur ditolak dengan pesan validasi yang menyalahkan pemanggil.

VERIFIKASI YANG SAYA HARAPKAN, bukan cuma unit test:
- npm run db:rebuild -- --yes  (update gate jumlah tabel kalau menambah tabel)
- DATABASE_URL=... npm test --workspaces --if-present
- npx vitest run --root web-internal      ← TERPISAH, bukan anggota workspaces
- walk HTTP lewat route nyata (pola di handoff §5), bukan cuma memanggil domain
- npx next build web-internal

DUA JEBAKAN DARI SESI LALU — handoff §5 menjelaskannya:
- audit_log append-only: fixture ber-id tetap membuat assertion "tepat satu
  baris audit" lolos/gagal tergantung riwayat run.
- portal.test.ts > management dashboard menghitung SEMUA klien, tidak
  ber-namespace. Fixture walk yang tertinggal membuatnya merah dan terlihat
  seperti regresi. Bersihkan fixture sebelum menyimpulkan apa pun.

Kalau PRD ambigu atau dua modul bertabrakan: STOP dan catat di DECISIONS.md
sebagai pertanyaan terbuka. Jangan diam-diam memilih tafsir.

Kerjakan di branch baru dari main, commit, push. Jangan buka PR kecuali saya minta.
```
