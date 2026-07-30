# HANDOFF — Cutover Sesi 14 (pensiun Go dicatat · Fase 2 · Fase 3)

> **Pendahulu:** `HANDOFF_CUTOVER_SESI13.md`. Yang masih berlaku tidak diulang —
> terutama SESI9 §6 (aturan rumah yang menggigit) dan SESI12 §2.4
> (`scripts/db-rebuild.sh`, satu-satunya jalur yang benar untuk DB lokal).

## 0. Posisi persis — SALIN INI KE SESI BERIKUTNYA

| | |
|---|---|
| **Repo** | `MEAgrup/AgencyAPP` |
| **Branch** | `claude/cdps-sg-cutover-sesi13-2kmgy4` |
| **HEAD** | **`9675dcd`** — sudah dipush, working tree **bersih**, nol pekerjaan tertinggal di disk |
| **Base** | `main@a37e432` (yaitu **sesudah** #75 di-merge) |
| **Isi branch** | **8 commit** (termasuk 1 merge): `e48e3fd` Fase 2 → `c1585d8` pensiun Go + Fase 3 → `f6ae287` handoff → `98bfa3f` fix collation → `df250d4` handoff → `e4530fe` merge `main` → `9675dcd` cabut perubahan finder + koreksi handoff |
| **PR** | **#76** → `main`, **masih draft**, CI **5/5 hijau**, `mergeable_state=clean`, nol review comment |
| **Live `CDPS SG`** | **40 migrasi · 54 tabel · 17 event** (tidak bergerak sesi ini — nol perubahan skema) |

**Cara melanjutkan (branch sudah ada di remote, jangan buat baru):**
```bash
git fetch origin claude/cdps-sg-cutover-sesi13-2kmgy4
git checkout claude/cdps-sg-cutover-sesi13-2kmgy4    # atau: git reset --hard origin/<branch>
git log --oneline -1                                  # harus 9675dcd
```

> ⚠️ **Branch berpindah nama, DAN #75 sudah di-merge.** SESI13 bekerja di
> `claude/cdps-sg-cutover-migrasi-azzlwr` (PR #75); sesi ini ditugaskan ke
> `claude/cdps-sg-cutover-sesi13-2kmgy4`, di-reset ke `16b2504` lalu dilanjutkan.
> **Pemilik me-merge #75 pukul 17:46 UTC** (`main@a37e432`), jadi keempat commit
> SESI13 kini ada di `main` — bukan lagi bagian dari branch ini. PR sesi ini adalah
> **#76**, isinya hanya pekerjaan baru. `main` sudah di-merge ke branch ini, jadi CI
> menguji keadaan pasca-merge yang sebenarnya, bukan tebakan.
>
> Jangan menghidupkan kembali branch lama, dan jangan menumpuk commit di atas
> riwayat yang sudah ter-merge.

**Angka acuan (Postgres 16 lokal, DB dibangun ulang dari nol dengan 40 migrasi):**
`@cdps/domain` **566** (+1 skip) · `apps/api` **246** · `@cdps/core` **113** ·
`@cdps/db` **9** · `web-internal` **26** · 7 gate seed **PASS** · keempat invariant
SQL **PASS** · `route-parity` **5/5 dengan `KNOWN_GAPS` KOSONG** · typecheck bersih
semua workspace · eslint `web-internal` bersih · `go vet ./...` bersih.

> Beda dari SESI13: domain **552 → 566** (+14), apps/api **211 → 246** (+35).

> ⚠️ **Postgres sandbox bisa mati di tengah sesi.** Kalau tiba-tiba banyak test
> DB-touching gagal serentak (`@cdps/db` integration, `mslseed/engine`), cek
> `pg_isready` **sebelum** menduga regresi kode — itu terjadi sekali sesi ini, dan
> semuanya hijau lagi setelah restart + `db:rebuild`.

**Setup sandbox yang dibutuhkan** (tidak persisten antar sesi):
```bash
service postgresql start
su postgres -c "psql -c \"alter user postgres with password 'postgres'\""   # untuk koneksi TCP
npm ci && npm run db:rebuild -- --yes
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps" npm test --workspaces --if-present
```

---

## 1. Job `backend` yang merah — SUDAH DIPERBAIKI DI #75 SENDIRI, bukan di sini

**Koreksi terhadap versi awal handoff ini.** Saya sempat menulis bahwa SESI13
melaporkan job `backend` hijau padahal merah, lalu memperbaikinya sendiri lewat
finder (`a4fc289`). Bagian pertama benar untuk sesaat, bagian kedua sudah tidak
berlaku:

- SESI13 **menemukan dan memperbaiki sendiri** kerusakan itu sebelum #75 di-merge,
  di commit **`5453f69`** — dengan pendekatan berbeda: menyalin kedua CSV **kembali**
  ke `backend/seed/` sebagai duplikat byte-identik (md5 diverifikasi), bukan mengubah
  finder. CI final #75 di `faea775` hijau seluruhnya, termasuk `backend`.
- Saya membaca check-run pada `16b2504` (commit sebelum perbaikan itu), jadi kesimpulan
  "dilaporkan hijau padahal merah" itu **melihat snapshot yang sudah kedaluwarsa**.
  SESI13 juga sudah mencatat sebab kesalahan verifikasinya sendiri di
  `supabase/seed/README.md`: grep nama berkas literal di `*_test.go` mengembalikan nol
  karena test membukanya lewat helper, dan `go vet` yang lolos tidak membuktikan apa pun.

**Perubahan finder saya sudah DICABUT** (`paths.go` kini identik dengan `main`).
Alasannya aturan rumah yang saya sendiri tulis ke `CLAUDE.md` sesi ini: `backend/**`
read-only, dan satu-satunya perubahan yang wajar adalah menjaga job `backend` hijau.
Job itu sudah hijau tanpa saya, dan `paths.go` toh ikut terhapus di Fase 5 — jadi
perubahan saya tinggal mekanisme kedua tanpa manfaat tahan-lama, plus membuat
`supabase/seed/README.md` (yang menjelaskan mekanisme duplikat) jadi tidak akurat.
Mekanisme yang berlaku: **duplikat byte-identik di kedua tempat sampai Fase 5**.

> **Pelajaran yang tetap berlaku, dan justru menggigit saya sendiri:** jangan menilai
> status CI dari check-run sebuah commit yang bukan HEAD. Snapshot lama terlihat
> identik dengan kerusakan yang masih hidup. Baca check-run **HEAD**, dan kalau
> menuduh sesi sebelumnya salah lapor, periksa dulu apakah ia sudah memperbaikinya
> sendiri di commit berikutnya.

## 2. Go DITINGGALKAN secara resmi — `CLAUDE.md` §Stack (`c1585d8`)

Rekomendasi SESI13 §5 ("makin mendesak") dieksekusi. `CLAUDE.md` sebelumnya masih
menyatakan Go + MySQL, jadi sesi Claude baru mana pun akan membangun di Go.

Sekarang §Stack menyatakan TypeScript + Supabase/Postgres dengan blokade eksplisit
di atasnya, plus tiga hal yang sebelumnya hanya hidup di handoff: penegakan ada di
DB (`sm_transition` + RLS + trigger), batas camelCase↔snake_case tunggal di
`wire.ts`, dan `supabase db push`/`apply_migration` sebagai satu-satunya jalur
migrasi. §Working style: `backend/**` read-only, `KNOWN_GAPS` wajib kosong.

Tiga entri `DECISIONS.md` baru (Pensiun Go · O43 Fase 2 · Fase 3).

## 3. Fase 2 — O43 (`e48e3fd`)

9 endpoint salah bentuk. **Semuanya route yang ADA dan menjawab 200** — itulah
kenapa `route-parity` 5/5 hijau sementara halamannya blank.

| Endpoint | Yang salah |
|---|---|
| `GET /attempts` | `{attempts}` camelCase lawan `{data:[...]}`; kehilangan `phone_number`+`source`; filter `?status=` diabaikan total |
| `GET /attempts/{id}` | dibungkus `{attempt:…}` (Go top-level) **dan** detailnya tidak lengkap: nol blok `lead`, nol `nq_reasons`, nol `allowed_transitions`, `qualified_form` tanpa `services[]`, hanya proposal terakhir bukan riwayat |
| `POST /bookings/{id}/sla` · `/hours` | meng-echo kunci REQUEST (`hours`); Go mengirim `sla_target_hours`/`hours_logged` |
| `POST /finance/reminders/scan` | dibungkus `{summary}`; 4 counter camelCase lawan 3 kunci wire |
| `POST /services/{id}/void` | objek domain mentah ⇒ 3 kunci `undefined`, dan `skippedApprovedBriefs` **tidak ada di domain** |
| `GET /demo-tasks` · `/{id}` · `POST` | `{tasks}`/`{task}` lawan `{data:[...]}` dan envelope 3-kunci |

`demo-tasks/{id}` satu-satunya yang **CRASH** bukan blank: halaman
men-destrukturisasi `{task, allowed_transitions, audit}` lalu langsung membaca
`allowed_transitions.length` ⇒ TypeError.

**Modul baru `domain/engine.ts`** — `allowedTransitions` atas `sm_edges`, tabel yang
SAMA yang divalidasi `sm_transition`, jadi tombol yang dirender dan edge yang
diterima tidak bisa berpisah. Read-only by construction seperti `audit.ts`.

> ### ⚠️ `order by … collate "C"` di `engine.ts` LOAD-BEARING — jangan dilepas
> CI menangkap ini, lokal tidak. **Postgres CI diinisialisasi dengan `en_US.utf8`;
> Postgres sandbox lokal `C`.** Collation glibc `en_US` mengabaikan tanda baca,
> jadi `order by to_state` biasa menaruh `[Closed - Kalah Kompetisi]` **di depan**
> `Qualified`, sementara `C` (dan Go, dan `Array.sort()` JS) menaruhnya **di
> belakang**. Tanpa collation dipatok, **urutan tombol di badan respons bergantung
> locale cluster DB** — dan Go mengurutkan byte-wise (`sort.Strings`), jadi
> `collate "C"` sekaligus memulihkan paritas persis.
>
> Direproduksi lokal tanpa menunggu CI: `order by to_state collate "en-US-x-icu"`
> lawan `collate "C"` pada DB yang sama memberi dua urutan berbeda. Dikunci test
> *"puts a bracketed status LAST regardless of the cluster locale"*.
>
> **Pelajaran yang lebih umum:** perbedaan locale Postgres lokal↔CI bisa mengubah
> urutan hasil di endpoint MANA PUN yang mengurutkan kolom teks ber-`[...]` — dan
> seluruh status CDPS ber-`[...]`.
>
> **Sudah disisir, bukan cuma dikhawatirkan:** seluruh `packages/domain/src/**`
> digrep untuk `order by` pada kolom status/state. `engine.ts` **satu-satunya**
> instans; tiga sisanya (`kol.ts` ×2, `finance.ts`) mengurutkan `id`, yang bebas
> locale. Jadi jebakan ini nol sisa hari ini — tapi kalau menambah read model yang
> mengurutkan kolom status, patok collation-nya.

**Pemetaan tally scan diambil dari SEMANTIK Go, bukan kemiripan nama:**
`overdue_flagged` ← `markedOverdue` (Go menghitung TRANSISI ke [Jatuh Tempo]),
bukan `overdueNotified`. `overdueNotified` sengaja tidak menyeberang — Go tidak
punya counter itu.

### Residu Fase 2 yang SENGAJA dibiarkan

`GET /transactions/{id}/commission` dan `/payment` tetap mengirim read model
camelCase mentah. Keduanya mengaku mem-port handler Go yang **tidak ada**, dan
`web-internal` tidak memanggil keduanya dari mana pun. Tanpa oracle DAN tanpa
konsumen, menamai kunci wire = mengarang kontrak. Komentar palsunya dikoreksi dan
keduanya ditandai di dalam kode.

> **Yang belum disisir:** paritas **field-by-field** untuk ~54 converter yang SUDAH
> ada. Sesi ini menutup kelas "endpoint tanpa converter" (metode SESI13 §3) secara
> menyeluruh, bukan kelas "converter ada tapi satu field-nya salah". Kalau mau
> lanjut, itu pekerjaan berikutnya — dan ia masih butuh Go.

## 4. Fase 3 — keempat CLI diputuskan (`c1585d8`)

| CLI | Keputusan |
|---|---|
| `rolemapseed` | **DIPORT** → `apps/api/scripts/rolemapseed.ts` (preseden `mslseed.ts`). Diuji end-to-end di DB lokal: dry-run → apply (12→35) → rerun idempoten → gate NIK tak dikenal membatalkan tanpa menulis. 16 test parser. |
| `setpass` | **TIDAK diport** → `RUNBOOK_BOOTSTRAP_DEPLOYMENT_BARU.md` (5 langkah). Seluruh SQL-nya **diverifikasi end-to-end** di transaksi yang di-rollback, bukan ditulis dari ingatan. |
| `hrisconvert` | **TIDAK diport, tapi GATE-nya dipindah** ke `parseEmployeeCsv`: NIK duplikat & field wajib kosong sekarang menolak berkas UTUH. Gate itu sebelumnya **hilang** di jalur produksi — `syncEmployees` upsert per `employee_id`, jadi NIK duplikat = "baris terakhir menang". |
| `import` | **TETAP TERBUKA → O47** (baru). Tidak diputuskan sendiri. |

**O47 butuh keputusan Anda.** Jalur lead sudah tertutup (`POST /leads/bulk` hidup ⇒
sisanya adapter CSV kecil). Yang belum ada padanannya: `gen-form`,
`clients-dryrun/apply`, `dormant-*` — ketiganya memintas engine M0 Closing, jadi
mem-port-nya = membangun jalur tulis privileged KEDUA ke
`clients`/`transactions`/`installments`. Pertanyaannya: (a) riwayat klien pra-CDPS
harus masuk CDPS, atau cukup arsip spreadsheet? (b) kalau masuk — lead saja (kecil)
atau klien+ledger juga (besar)? **Memblokir C-05**, karena sesudah `backend/`
diarsipkan spesifikasi ketiga alur itu hanya ada di kode yang sudah dihapus.

---

## 5. Lanjut dari sini

### Fase 4 — gate manusia (BUKAN pekerjaan code)
| Gate | Status |
|---|---|
| C-03 — 3 SKIP dari deployment Vercel | ⛔ butuh mesin ber-akses; skrip **sudah siap** (`CUTOVER_C03_DEPLOYMENT_RUNBOOK.md`) |
| C-04 — O22 · O34 · O26 · O35 | ⛔ butuh data + keputusan pemilik |
| Backup MySQL Railway terakhir | ⛔ butuh akses Railway |
| Rencana rollback disepakati | ⛔ keputusan pemilik |
| **O46** — 3 arm visibility RLS lebih sempit dari Go | ⛔ keputusan pemilik |
| **O47** — impor historis (§4) | ⛔ keputusan pemilik, **memblokir C-05** |
| PII `backend/testdata/import_samples/` | ⛔ arsip / hapus / anonimkan — keputusan pemilik |

Nol dari tujuh ini bisa saya tutup: semuanya butuh akses atau otoritas yang tidak
saya punya. Melaporkannya "selesai" akan jadi laporan palsu.

### Fase 5 — pencabutan mekanis (C-05, hanya SETELAH gate GO **dan** O47)
Job `backend` di CI · `Makefile` (100% Go, 11 target) · tag lalu arsipkan
`backend/` · config mati (`railway.json` ×2, `Dockerfile`,
`docs/DEPLOY_RAILWAY.md`) · entri DECISIONS · ~20 komentar provenance
`backend/internal/...`.

> `CLAUDE.md` §Stack **sudah** dikoreksi sesi ini, jadi ia bukan lagi bagian C-05.

### TASK BERIKUTNYA — ambil dari atas, urutannya sengaja

Nol dari ini memblokir apa pun; semuanya bisa dikerjakan tanpa menunggu jawaban
pemilik. Urutannya disusun dari **yang nilainya hilang kalau ditunda**.

#### T1 · Paritas field-by-field ~54 converter `wire.ts` lama 🔴 MENDESAK
**Kenapa nomor satu:** ini satu-satunya pekerjaan yang **butuh `backend/` masih ada**.
Begitu C-05 mengarsipkan Go, oracle-nya hilang dan pekerjaan ini tidak bisa dikerjakan
lagi — nilainya jatuh ke nol, bukan berkurang.

Sesi 14 menutup kelas *"endpoint tanpa converter"* secara menyeluruh. Yang **belum**
disisir adalah kelas *"converter ADA tapi satu field-nya salah/hilang"* — dan
`clientDetailToWire` (O41 #1) membuktikan kelas itu nyata.

Metodenya, per converter:
1. Ambil tipe FE yang dilayaninya (`web-internal/src/lib/*.ts` atau `lib/types.ts`).
2. Ambil struct Go padanannya + json tag-nya (`backend/internal/module*/`).
3. Diff **ketiganya**. Yang dicari: field FE yang tidak pernah diisi converter, nama
   snake_case yang beda, `Date` yang lupa `.toISOString()`, dan **kunci nullable yang
   hilang alih-alih dikirim `null`** (pelajaran O43 — kunci HILANG mengeblank halaman,
   `null` tidak).
4. Test di `wire.test.ts` pakai pola yang sudah ada di sana: `toEqual` objek penuh +
   assertion "nol kunci camelCase".

Mulai dari modul yang halamannya paling ramai dipakai: `board` (`cardToWire`),
`task`/`creative` (`assetToWire`, `briefToWire`, `metricsToWire`), `portal`
(`staffLandingToWire`, `teamPortalToWire`, `managementDashboardToWire`).

#### T2 · `apps/api` tidak punya eslint config
`npm run lint -w @cdps/api` **selalu** gagal: `ESLint couldn't find an
eslint.config.js`. Pre-existing (bukan dari sesi 14), tapi artinya **~250 berkas TS
tidak pernah di-lint sama sekali** — termasuk seluruh route handler dan `wire.ts`.
`web-internal` punya config dan bersih; contoh polanya ada di sana. Perlu diputuskan
apakah job `api` di CI ikut memanggil lint setelah config-nya ada (kalau ya, siapkan
diri untuk gelombang temuan pertama).

#### T3 · Adapter CSV/dry-run di atas `POST /leads/bulk`
**Hanya kalau O47 dijawab "lead saja".** Kecil: `/leads/bulk` sudah hidup dan sudah
diuji, jadi yang tersisa cuma parsing CSV + mode dry-run, pola `mslseed.ts` /
`rolemapseed.ts` sudah jadi cetakannya. Jangan mulai sebelum O47 dijawab — kalau
jawabannya "klien+ledger juga", desainnya berbeda.

### Yang JANGAN dikerjakan
- **Jangan sentuh `backend/**`** kecuali menjaga job `backend` hijau. Sesi 14 sempat
  melanggar ini (mengubah `findSeedFile`) lalu mencabutnya sendiri — lihat §1.
- **Jangan mulai C-05** (Fase 5) sebelum gate GO **dan** O47 dijawab.
- **Jangan menambah baris ke `KNOWN_GAPS`** di `route-parity.test.ts`. Ia harus tetap
  kosong; satu baris = satu halaman tidak berfungsi, dan itu butuh entri DECISIONS.
