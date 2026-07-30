# PROMPT — Paket A (jalur delivery) untuk akun paralel

> Salin **seluruh blok di bawah `---`** sebagai prompt pertama di sesi Claude Code akun lain.
> Paket B dikerjakan paralel di sesi ini (`claude/go-retirement-progress-6r14e0`).
> Pembagian & aturan anti-tabrakan: `docs/backlog/PENSIUN_GO_STATUS_DAN_TASK_PARALEL.md`.

---

Repo: `MEAgrup/AgencyAPP`. Kerjakan **PAKET A — paritas wire jalur delivery**, bagian dari task besar **pensiun Go** (retire stack Go, cutover ke TypeScript + Supabase).

Branch kamu: **`claude/wire-parity-delivery-a`**. Buat kalau belum ada. Jangan push ke branch lain.

## 0. Orientasi wajib sebelum menulis kode (jangan dilompati)

1. Baca `CLAUDE.md` — aturan rumah Phase 0 berlaku **bit-for-bit**.
2. Baca `docs/backlog/PENSIUN_GO_STATUS_DAN_TASK_PARALEL.md` — **§3.1 aturan main paralel** dan **PAKET A**. Itu kontrak kerja kamu.
3. Baca `docs/handoff/HANDOFF_CUTOVER_SESI13.md` (di `main`) dan `docs/handoff/HANDOFF_CUTOVER_SESI14.md` (**hidup di PR #76, belum ter-merge** — ambil dari branch `claude/cdps-sg-cutover-sesi13-2kmgy4`). SESI14 §5 T1 adalah asal-usul task kamu.
4. **Cek `list_pull_requests` sebelum mulai, bukan hanya `git log`.** Ini bukan formalitas: sesi #77 memulai di atas `main` yang basi beberapa menit kemudian, lalu **mengerjakan ulang dari nol dua task yang sudah ter-merge**. Yang menyingkapnya adalah daftar PR terbuka, bukan git.

## 1. Basis branch — PENTING, ada PR yang belum ter-merge

PR **#76** (`claude/cdps-sg-cutover-sesi13-2kmgy4`) memuat O43 Fase 2 dan **mengubah `apps/api/src/lib/wire.ts`** (menambah `attemptRowToWire`, `attemptDetailToWire`, `financeScanResultToWire`, `voidResultToWire`, `demoTaskToWire`, `demoTaskDetailToWire`) plus `packages/domain/src/{sales,client,employees}.ts`.

- Kalau **#76 sudah ter-merge** ke `main`: branch dari `main` terbaru.
- Kalau **#76 belum ter-merge**: branch dari `origin/claude/cdps-sg-cutover-sesi13-2kmgy4` (HEAD #76), **bukan** dari `main`. PR kamu jadi PR bertumpuk (*stacked*) — tulis itu di body PR: "bertumpuk di atas #76, merge #76 dulu".

Jangan mencampur: satu basis, jangan setengah dari `main` setengah dari #76.

Sesi paralel (Paket B) memakai basis yang **sama**.

## 2. Task A1 — paritas field-by-field 25 converter delivery 🔴 INI YANG UTAMA

### Kenapa ini mendesak, bukan sekadar penting

Ini **satu-satunya kelas pekerjaan yang butuh `backend/` masih ada.** Go adalah oracle paritas satu-satunya. Begitu C-05 mengarsipkan `backend/`, oracle-nya hilang dan nilai pekerjaan ini **jatuh ke nol** — bukan berkurang, nol. Semua task lain bisa ditunda; ini tidak.

### Kelas cacat yang kamu cari — dan bukti ia nyata

Ada dua kelas cacat bentuk respons:

- **Kelas 1: endpoint tanpa converter** → sudah **ditutup menyeluruh** oleh PR #76. Bukan tugas kamu.
- **Kelas 2: converter ADA, tapi satu field-nya salah/hilang** → **belum pernah disisir.** Ini tugas kamu.

Kelas 2 bukan hipotesis. Preseden yang sudah terbukti:
- `clientDetailToWire` (O41 temuan #1) — converter ada, field-nya kurang.
- `InstallmentRow` domain tidak punya `proofOfPayment` ⇒ kolom bukti bayar **selalu `undefined`** di UI.
- `skippedApprovedBriefs` **tidak ada di domain** sama sekali padahal FE menampilkannya.

Yang bikin kelas ini mahal: **route-nya ADA dan menjawab 200.** `route-parity` 5/5 hijau, CI hijau, tapi halamannya blank atau kolomnya kosong. Tidak ada test yang gagal untuk memberitahumu.

### Metode, per converter — kerjakan bertiga-diff, jangan bertdua

1. **Tipe FE** yang dilayani converter itu: `web-internal/src/lib/<modul>.ts` atau `web-internal/src/lib/types.ts`.
2. **Struct Go padanannya + json tag-nya**: `backend/internal/module*/`. Cari lewat nama handler atau nama field; kalau ragu, telusuri dari route Go di `backend/internal/httpapi/`.
3. **Converter sekarang**: `apps/api/src/lib/wire.ts`.
4. **Diff KETIGANYA.** Yang dicari:
   - field FE yang **tidak pernah diisi** converter;
   - nama snake_case yang **beda** dari json tag Go;
   - `Date` yang **lupa `.toISOString()`**;
   - **kunci nullable yang HILANG alih-alih dikirim `null`**.
5. **Test** di berkas BARU `apps/api/src/lib/wire.delivery.test.ts`. Pola diambil dari `wire.test.ts` yang sudah ada: `toEqual` objek penuh + assertion "nol kunci camelCase".

> ### ⚠️ Satu penyimpangan dari Go yang DISENGAJA — jangan "perbaiki" jadi seperti Go
> Go menandai banyak field `omitempty`, jadi tanggal null **menghilangkan kuncinya** dari JSON.
> Di sini null dikirim **eksplisit** (`"tanggal": null`), karena tipe FE mendeklarasikan
> `string | null` dan **kunci yang HILANG-lah yang mengeblank halaman** — itu pelajaran O43.
> Jadi: nama kunci & tipe = ikut Go; **hadir-atau-tidaknya kunci = ikut FE.** Kalau kamu
> tergoda menyederhanakan jadi `omitempty`, kamu sedang membuat ulang bug O43.

### 25 converter yang jadi milik kamu

| Modul FE | Converter |
|---|---|
| `board.ts`, `tasks.ts` | `cardToWire` · `dailyOutputToWire` · `dependencyToWire` · `scanHoursReminderResultToWire` |
| `creative.ts` | `assetToWire` · `briefToWire` · `metricsToWire` · `blockRequestToWire` · `pendingBlockRequestToWire` · `complaintToWire` |
| `ads.ts` | `campaignToWire` · `metricEntryToWire` · `optimizationToWire` |
| `kol.ts`, `livestream.ts` | `bookingToWire` · `paymentRequestToWire` · `bookingMetricsToWire` · `creatorListToWire` · `sessionToWire` |
| `health.ts` | `healthSnapshotToWire` · `roasToggleToWire` · `healthScanResultToWire` |
| `performance.ts` | `perfSnapshotToWire` · `perfTeamRollupToWire` · `perfWeightToWire` · `perfTargetToWire` |

**Mulai dari `cardToWire` (board) lalu `assetToWire`/`briefToWire`/`metricsToWire` (creative)** — halaman paling ramai dipakai, jadi cacat di sana paling mahal. Jangan mulai dari yang paling mudah.

### Kalau read model domain-nya kurang field

Preseden `InstallmentRow`/`skippedApprovedBriefs`: field itu ditambahkan ke **`packages/domain`** juga, bukan dikarang di converter. Dan kalau ia informasi yang perlu **dilihat orang** (bukan cuma dihitung), ikut ditulis ke **baris audit** supaya bisa direkonstruksi dari log — house rule #3 (riwayat immutable) & #4 (derived selalu recomputable).

### Yang JANGAN kamu sentuh, walau kelihatan salah

- `GET /transactions/{id}/commission` dan `/payment` — tetap camelCase mentah, **sengaja**. Kedua handler Go-nya **tidak ada**, dan `web-internal` tidak memanggil keduanya dari mana pun. Tanpa oracle DAN tanpa konsumen, menamai kunci wire = **mengarang kontrak**. Sudah ditandai di dalam kode oleh #76.
- Converter milik **Paket B** (sesi paralel): `masterServiceToWire`, `quoteToWire`, semua `lead*`/`attempt*`/`deleteRequest*`, `intakeClientToWire`, `amWorkloadToWire`, `assignmentToWire`, `strategy*`, `clientDetailToWire`, `clientListRowToWire`, `marketing*`, `campaignRollupToWire`, `performanceRecordToWire`, `staffLandingToWire`, `teamPortalToWire`, `managementDashboardToWire`, `adminEmployeeToWire`, `roleMappingToWire`, `layeredRoleToWire`, `credentialInfoToWire`, `notificationToWire`, `inboxToWire`.
  Ketemu bug di sana? **Jangan perbaiki** — tulis di body PR kamu sebagai temuan untuk Paket B.

### DoD A1

- Setiap converter punya test `toEqual` objek penuh + assertion nol kunci camelCase.
- Setiap temuan disebut **eksplisit** di body PR: endpoint · apa yang salah · **siapa yang membacanya dan apa akibatnya di UI**. "3 field diperbaiki" bukan laporan; "kolom bukti bayar selalu kosong di halaman verifikasi Finance" laporan.
- Converter yang setelah diaudit ternyata **sudah benar** juga disebut — daftar "diaudit, nol temuan" itu bagian dari hasil, karena ia yang membedakan "sudah disisir" dari "belum dilihat".
- Setiap deviasi dari Go yang disengaja ⇒ baris di `docs/DECISIONS.md`.
- CI 5/5 hijau.

## 3. Task A2 — `apps/api` tidak punya eslint config

`npm run lint -w @cdps/api` **selalu** gagal: `ESLint couldn't find an eslint.config.js`. Pre-existing (bukan dari #76), tapi artinya **~250 berkas TS tidak pernah di-lint sama sekali** — termasuk seluruh route handler dan `wire.ts`. `web-internal` punya config dan bersih; contoh polanya ada di sana.

**Batas ruang lingkup yang tegas, supaya tidak bertabrakan dengan Paket B:**
- Pasang config, jalankan, **laporkan jumlah + kategori temuan di body PR**.
- **Perbaiki NOL berkas** di luar blok converter Paket A. Sisanya jadi tiket lanjutan `T2b`.
- Beri rekomendasi: apakah job `api` di CI ikut memanggil lint? Kalau ya, gelombang temuan pertama harus dibereskan dulu — jangan bikin CI merah untuk semua orang.

## 4. Task A3 — rapikan rujukan path pasca-Fase 0

Data organisasi riil sudah pindah ke `supabase/seed/`, tapi tiga dokumen **operasional** masih menunjuk lokasi lama:
`docs/handoff/HRIS_ROLE_MAPPING_DRAFT.md` · `docs/handoff/RUNBOOK_O42_MARKETING_ACTOR.md` · `docs/handoff/LANGKAH_MANUSIA_GO_LIVE.md`

Perbarui ke `supabase/seed/…`.

- **Handoff bertanggal dan baris `DECISIONS.md` lama JANGAN ditulis ulang** — itu catatan historis, bukan dokumen hidup.
- **`supabase/seed/README.md` sudah benar** — ia menjelaskan mekanisme duplikat byte-identik sampai Fase 5. Jangan diubah.

## 5. Aturan yang kalau dilanggar bikin merge mahal

1. **Test masuk berkas BARU `wire.delivery.test.ts`.** **Nol edit** pada `wire.test.ts` bersama — sesi paralel memakai `wire.commerce.test.ts`.
2. **`wire.ts` diedit dua akun sekaligus, hanya di dalam blok converter sendiri.** Terlarang: menyentuh helper bersama di bagian atas berkas · mengurutkan ulang fungsi · merapikan blok `import` di luar menambah satu baris. Butuh helper baru? Definisikan **tepat di atas converter kamu sendiri**.
3. **`docs/DECISIONS.md` disisipkan di baris TERATAS tabel oleh kedua akun ⇒ konflik pasti.** Urutan merge dipatok: **Paket A merge dulu**, Paket B rebase. Jadi kamu boleh sisipkan normal; kalau ternyata B sudah merge lebih dulu, rebase dan **simpan kedua baris**.
4. **Handoff kamu: `docs/handoff/HANDOFF_CUTOVER_SESI16A.md`.** Jangan menulis ke `…SESI16B.md`.
5. **NOL tulis ke live `CDPS SG`.** Tidak ada `apply_migration`, tidak ada `supabase db push`, tidak ada `INSERT`/`UPDATE`/DDL. Paket ini **nol perubahan skema** — kalau kamu merasa butuh migrasi, itu tanda ruang lingkupnya salah: **STOP dan lapor, jangan improvisasi.** Aturan ini ada karena `42P07 relation already exists` di #77 **menandakan penulis kedua**, bukan artefak yang benign — dan sekarang memang ada dua sesi berjalan.
6. **`backend/**` read-only.** Ia dibaca sebagai oracle, tidak pernah diedit — bahkan kalau kamu yakin perbaikannya benar. #76 sempat melanggar ini lalu mencabutnya sendiri.
7. **Jangan menambah baris ke `KNOWN_GAPS`** di `route-parity.test.ts`. Harus tetap **kosong**. Satu baris = satu halaman tidak berfungsi, dan itu butuh entri `DECISIONS.md`.
8. **Nol string BI baru**; katalog notifikasi **FROZEN 17 event**; nol field/status/transisi yang tidak ada di PRD. Ambigu ⇒ **STOP** dan tulis baris **Open** di `docs/DECISIONS.md`, jangan pilih diam-diam.
9. **Jangan mulai Fase 5 / C-05** (hapus job `backend`, arsipkan `backend/`, `Makefile`, config Railway). Ia menunggu gate GO **dan** jawaban O47 — dan memulainya menghapus oracle yang A1 justru pakai.

## 6. Setup sandbox & verifikasi sebelum push

Sandbox tidak persisten antar sesi:

```bash
service postgresql start
su postgres -c "psql -c \"alter user postgres with password 'postgres'\""
npm ci && npm run db:rebuild -- --yes
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps" npm test --workspaces --if-present
npm run typecheck --workspaces --if-present
```

- `npm run db:rebuild` default **dry-run**; `--yes` baru menulis. Ia drop → apply semua migrasi urut → seed dua kali → 7 gate → 4 invariant SQL.
- **DB lokal apa pun yang dibangun sebelum rename penomoran migrasi sudah bukan cerminan repo**, dan apply selektif tidak bisa menambalnya. Bangun ulang dari nol.
- `@cdps/domain` menuntut **DB fresh** — re-run tanpa drop bikin akumulasi notifikasi `scanReminders` dan false-fail.
- ⚠️ **Postgres sandbox bisa mati di tengah sesi.** Kalau banyak test DB-touching gagal serentak, cek `pg_isready` **sebelum** menduga regresi kode.
- ⚠️ **Locale Postgres lokal ≠ CI.** CI `en_US.utf8`, sandbox `C`. Collation glibc `en_US` mengabaikan tanda baca, jadi `order by` pada kolom status bisa menaruh `[Closed - …]` **di depan** `Qualified` di CI tapi di belakang secara lokal. **Seluruh status CDPS ber-`[...]`**, jadi kalau kamu menambah/menyentuh `order by` pada kolom status, patok `collate "C"` (itu juga yang memulihkan paritas Go, yang mengurutkan byte-wise). Jangan lepas `collate "C"` yang sudah ada di `packages/domain/src/engine.ts` — ia load-bearing.

**Angka acuan di `main@a37e432`:** `@cdps/domain` 552 · `apps/api` 211 · `@cdps/core` 113 · `@cdps/db` 9 · `web-internal` 26 · `route-parity` 5/5 `KNOWN_GAPS` kosong · 4 invariant SQL PASS.
Kalau basis kamu HEAD #76: `@cdps/domain` **566** · `apps/api` **246**.

## 7. Cara melapor

- **Commit kecil per klaster** (mis. satu commit untuk creative, satu untuk board), sebut modul + section PRD di message.
- **PR draft** ke `main` (atau ke branch #76 kalau bertumpuk), body memuat: tabel temuan per endpoint dengan **akibat di UI** · daftar converter "diaudit, nol temuan" · angka test sebelum/sesudah · apa yang sengaja tidak dikerjakan dan kenapa.
- **Handoff** `docs/handoff/HANDOFF_CUTOVER_SESI16A.md` dengan §0 "posisi persis" (branch, HEAD, basis, PR, angka test) supaya sesi berikutnya bisa lanjut tanpa menebak.
- Kalau ada yang **tidak bisa** kamu selesaikan — butuh akses, butuh keputusan pemilik, atau PRD-nya ambigu — **katakan begitu**, jangan laporkan selesai. Laporan palsu jauh lebih mahal daripada task yang tertunda.
