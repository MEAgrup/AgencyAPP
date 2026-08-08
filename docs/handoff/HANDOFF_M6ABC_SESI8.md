# HANDOFF — M6A/M6B/M6C Sesi 8 (titik mulai sesi berikutnya)

> Rantai: SESI1 → … → SESI7 → **SESI8 (ini, terbaru)**. Baca yang bernomor
> tertinggi lebih dulu; sesi sebelumnya hanya untuk konteks sejarah.
>
> **Sesi ini: A-08 (Section D lengkap) + A-09a (narasi E/H) + koreksi O47b +
> detail cek O42.** Kode ter-commit, ter-push, PR **#107** terbuka.
> **Live `CDPS SG` SUDAH direkonsiliasi** — pemilik memutuskan O59 = (b) repo
> menang, dan itu sudah dieksekusi + terverifikasi. Live **≡ repo** untuk
> Section D + A-09a. Lihat §10.
>
> 🔴 **DUA premis tercatat runtuh sesi ini:** O59 (§4 — **sudah diselesaikan**,
> lihat §10) dan **O47b §0** (`main` TERNYATA memuat PII ⇒ rewrite tetap wajib,
> §8 — **belum** diselesaikan, menunggu #107 merge).
>
> | Bagian | Isi |
> |---|---|
> | 0 | Posisi persis — **dan koreksi atas handoff yang masuk ke sesi ini** |
> | 1 | A-08 — D-5, D-6, D-7, flip D-8 → notifikasi. Nol tabel baru |
> | 2 | Dua deviasi tercatat: katalog v4 · D-7 tanpa ping ulang |
> | 3 | Bug `openRevision` yang tersingkap — dan kenapa ia tidak diam |
> | 4 | ~~O59 — live memuat migrasi Section D yang tidak ada di repo~~ → **SELESAI, §10** |
> | 5 | X-13 dibuka: PRD tidak pernah menulis daftar enum D-6 |
> | 6 | Apa yang tersisa dan urutannya |
> | 7 | Jebakan lingkungan (bertambah dua) |
> | 8 | 🔴 **O47b — premis §0 runtuh: `main` MEMUAT PII, rewrite tetap wajib** |
> | 9 | O42 — detail cek disiapkan · A-09a mendarat · A-09b di-scope |
> | 10 | ✅ **O59 DIEKSEKUSI — live ≡ repo. Dan temuan nama event yang lolos semua gerbang** |

## 0. Posisi persis — SALIN INI KE SESI BERIKUTNYA

| | |
|---|---|
| Branch | `claude/handoff-sesi6-migration-mrqglv` |
| `main` | `1316705` — PR #106 ter-merge |
| PR terbuka | **#107** (A-08) — dibuka sesi ini, belum di-review |
| Migrasi | **71 berkas** (68 + A-08 + A-09a + O59 `20260808030000`). ✅ **Live ≡ repo** — O59 direkonsiliasi & diverifikasi. Lokal: 71 migrasi bersih |
| Gate | tabel **76** (tidak berubah) · prefix **31** · mesin **16** · event **33 → 34** · `CATALOG_VERSION` **3 → 4** |
| Skor | M6A **~68%** (9,5/14) — A-08 + A-09a mendarat, A-09b tersisa · M6B **8%** (1/12) |
| Test | domain **895 hijau + 1 skipped** · `apps/api` **324** · `packages/core` **118** · `packages/db` **15** · 4 invariant SQL hijau · typecheck FE bersih |
| Menggantung | Kode: **NOL**. Keputusan: **O59 ✅ selesai** · **X-13 ✅ ditutup** · **O47b** rewrite dijadwalkan sesudah #107 merge · **O42-b** tiket seed HRIS (keputusan sudah ada, eksekusi belum) |

### 0.1 ⚠️ Handoff yang masuk ke sesi ini SALAH di empat titik

Ini bukan catatan kaki — kalau dipercaya, sesi berikutnya membangun A-09 di
atas fondasi yang tidak ada.

| Klaim | Kenyataan (diperiksa, bukan diasumsikan) |
|---|---|
| *"69 berkas (68 + A-08) · A-08 mendarat"* | Repo punya **68**. A-08 tidak ada di commit mana pun, branch mana pun. Skor *"M6B 8% (1/12) — A-08 mendarat"* juga salah kolom: A-08 adalah tiket **M6A** |
| *"Branch `-yntcgg`, di-restart dari main sesudah #106 merge"* | Branch yang ada `-mrqglv`. `-yntcgg` tidak pernah ada di remote |
| *"PR terbuka NOL"* + perintah *"selesaikan pr menggantung"* | Benar bahwa nol — jadi **tidak ada** PR menggantung untuk diselesaikan. #106 sudah merge (`origin/main` lokal hanya **stale**; `git fetch` menyelesaikannya) |
| *"Live sinkron & terverifikasi, sidik jari `951050fc…` \| 149 fakta"* | Live memuat migrasi A-08 yang **tidak pernah masuk repo** ⇒ itu drift, bukan sinkron. Sidik jari itu **tidak bisa** dibuat ulang dari repo |
| *"event 34 (+1, katalog v4)"* | Satu-satunya klaim yang ternyata **benar arah**-nya — dan ia jadi petunjuk berguna: sesi hilang itu juga menyimpulkan D-7 butuh event baru di versi katalog baru. Sesi ini sampai ke kesimpulan yang sama dari PRD-nya sendiri |

**Pelajarannya, dan ini kejadian KETIGA berturut-turut** (X-10 basi, O44 basi,
sekarang seluruh baris posisi): **verifikasi posisi terhadap git dan DB sebelum
menyalinnya.** `git log`, `git fetch`, `ls supabase/migrations | wc -l`,
`list_migrations`. Empat perintah, dan ketiga kejadian ini terhindar.

## 1. A-08 — Section D lengkap

`supabase/migrations/20260808000000_m6a_section_d.sql`. **Nol tabel baru**,
gerbang tabel tetap **76**.

Yang sudah ada dan karenanya tidak dibangun ulang: D-1/D-2/D-4 di
`strategi_target` dan D-8/D-9 di `strategi_assumption` (sejak A-03), dan **D-3
tanpa kolom sama sekali** (X-11: turunan, `komposisiKontribusi`). Jadi A-08 =
tiga field + satu jalur emit.

| Field | Bentuk | Kenapa bukan tabel anak |
|---|---|---|
| **D-5** definisi berhasil 30/60/90 | 3 kolom `definisi_berhasil_*` | Kardinalitas **TETAP tiga**. A-07 pakai tabel anak untuk C-5/C-6/C-7 karena ketiganya daftar berulang; D-5 tidak, jadi tabel anak hanya menukar satu CHECK dengan `COUNT` |
| **D-6** leading indicator mingguan | array jsonb `leading_indicator` | Multi-enum tertutup + cap = preseden A-05 §(2)/A-06 §(4). Menyimpang = cara **kedua** menyimpan checkbox tertutup |
| **D-7** Sanggahan Target | 5 kolom `sanggahan_*` | Paling banyak satu per Strategi, opsional |

**D-6 ditegakkan DB untuk TIGA hal, bukan satu:** bentuk array, cap 5, dan
keanggotaan set tertutup lewat `<@`. Lapisan TS ada untuk **menamai**
kegagalannya dalam BI, bukan menjadi satu-satunya penjaga — ada test yang
menembak `UPDATE` langsung ke tabel dan menuntut CHECK-nya menolak.

**D-7 tidak bisa menurunkan floor, dan bukan karena kesepakatan:** jalur
tulisnya tidak menyentuh `strategi_target`, tempat `ck_strtg_stretch_gmv`
hidup. Itu Rule 19. Ada test yang mengajukan "target realistis" **di bawah
floor** dan membuktikan floor-nya tidak bergerak.

**Kedua angka D-7 adalah UANG, jadi string** — satuan minor bilangan bulat,
sama seperti `nilai_floor`/`nilai_stretch`/`gmv`. Sempat ditulis `number` di
sesi ini dan diperbaiki sebelum merge: `number` untuk rupiah adalah
representasi KEDUA untuk jenis nilai yang sama, kelas yang sama dengan dua
daftar tertutup yang bisa menyimpang (O48/O51). Bukan bug hari ini (Rp 320jt
aman di double) — jalur kedua yang selalu ditagih belakangan.

Domain: `saveKpi` · `raiseSanggahan` · `setAssumptionStatus` · gerbang submit
`D-5`/`D-6`.
Route: `PUT /strategi/{id}/kpi` · `POST /strategi/{id}/sanggahan` ·
`PUT /strategi/{id}/assumptions/{kode}/status`.

**`setAssumptionStatus` sengaja bisa dijangkau saat `Aktif`** — berbeda dari
SETIAP tulis Section D lainnya. Asumsi gugur saat **eksekusi** (budget iklan
cair terlambat di bulan 3), tepat ketika setiap pintu edit tertutup;
melewatkannya lewat `requireDraftAndWriter` membuat fitur ini tak terjangkau di
satu-satunya momen ia berarti. Flip ke `Gugur` mengemisikan
`strategi_revisi_disarankan` dan **tidak** membuka revisi — Rule 13 menuntut
trigger + alasan + asumsi mana yang gugur, ketiganya keputusan manusia.

## 2. Dua deviasi tercatat — butuh konfirmasi pemilik

### 2.1 Katalog notifikasi naik ke v4 untuk satu event

§4 menandai D-7 `O (notif SPV + Head of Sales)`. §7 D12 mendaftar **empat**
event Strategi dan tidak satu pun sanggahan. **PRD membantah PRD**, jadi §4
dimenangkan (aturan rumah: PRD menang) lewat mekanisme yang O55 sediakan.

- **v4, bukan tumpangan di v2** — alasan yang sama yang dipakai v3: v2 adalah
  amandemen M6A/6B/6C §7, dan menyelipkan event yang §7 tidak sebut membuat
  registry berbohong tentang apa yang v2 perkenalkan.
- **Nama bertitik** `m6a.strategi.sanggahan_target`. Aturan penamaan v2
  menyatakan gaya polos `strategi_*` dipakai **justru karena PRD menulisnya**;
  PRD tidak menulis yang ini ⇒ konvensi rumah `mN.entitas.aksi`, persis alasan
  `m6.client.assigned` (O53) bertitik.
- Resolver `explicitOrLeads`: penerimanya melintasi **dua** divisi. `notify_emit`
  hanya menyelesaikan lead untuk **satu** divisi, jadi SPV Account dari
  `division` dan Head of Sales lewat `explicit` yang domain isi
  (`leadsOfDivision`, mirror persis candidate CTE `notify_emit` termasuk
  `status_aktif`).
- Gerbang bergerak di **satu commit**: `notif_events` 33→34 di `ci.yml` +
  `db-rebuild.sh`, `CATALOG_VERSION` 3→4 di `packages/core`.

### 2.2 D-7 tidak menotifikasi ulang saat dikoreksi

Ping hanya pada pengajuan **pertama** (`null` → terisi). Koreksi selagi draft
masuk audit log sebagai `edit_sanggahan`. PRD tidak membahasnya; sebaliknya
berarti Head of Sales diping sekali per autosave.

## 3. Bug `openRevision` — dan kenapa ia tidak diam

`openRevision` melakukan `INSERT … SELECT` atas header. Komentar di sana sudah
meramalkan: *"the day one is added and not appended there, every revision would
silently start with a blank Section A while every test on version 1 still
passed."*

A-08 adalah hari itu. **Tapi ia tidak diam** — karena D-5/D-6 adalah syarat
submit, revisinya **gagal di gerbang** alih-alih mendarat separuh kosong. Dua
test Rule 13 yang sudah ada langsung merah.

Diperbaiki, dan **D-7 sengaja TIDAK ikut tersalin**: sanggahan adalah
**tindakan** dengan aktor dan timestamp yang menyasar floor satu versi;
menyalinnya membuat versi baru tampak disanggah oleh orang yang tidak pernah
menyanggahnya. Versi n tetap memegang sanggahannya sendiri, immutable dan
terbaca. Dikunci test yang meng-assert carry D-5/D-6 **dan** non-carry D-7.

**Konsekuensi untuk A-09:** setiap kolom header baru wajib ditambahkan ke DUA
daftar di `openRevision`. Kalau field A-09 tidak jadi syarat submit, ia akan
hilang di revisi **tanpa satu test pun merah**. Itu perangkap yang masih aktif.

## 4. ~~🔴 O59 — drift migrasi ronde kelima (BLOCKER deploy)~~ → **SELESAI, lihat §10**

> ✅ **Diputus pemilik 2026-08-08: (b) repo menang, dan sudah dieksekusi.**
> Bagian ini dipertahankan karena ia memuat diagnosis awalnya; **status dan
> angkanya sudah usang** — §10 yang berlaku. Yang §4 belum tahu: drift-nya
> ternyata TIGA perbedaan, dan yang ketiga (nama event v4) lolos semua gerbang.

Ditemukan saat hendak menerapkan A-08 ke live. `list_migrations` menunjukkan
baris terakhir live = `20260808024726` bernama **`20260808020000_m6a_section_d`**
— migrasi A-08 dari sesi hilang, **berkasnya tidak pernah masuk repo**.

Dipastikan lewat kueri kolom:

| | Live | Repo (PR #107) |
|---|---|---|
| `leading_indicator` | ✅ jsonb NOT NULL `'[]'` | ✅ sama |
| `sanggahan_*` (5 kolom) | ✅ ada | ✅ sama |
| `definisi_berhasil_30/60/90` | ❌ **tidak ada** | ✅ ada |

**D-5 live berbentuk lain** — kemungkinan tabel anak, **belum diverifikasi**.
Konsekuensi: migrasi repo **akan gagal** di live (`ADD COLUMN` atas kolom yang
sudah ada), dan jumlah tabel live mungkin sudah **77** sementara gerbang repo
**76**.

**Verifikasi berhenti di situ dengan sengaja.** Kueri lanjutan ke live ditolak
di sesi ini, jadi bentuk D-5 live, isi `notif_catalog_versions` live, dan sidik
jari strukturalnya **belum** diperiksa — dan tidak diklaim. Sesi berikutnya
**mulai dari sini**, dan langkah pertamanya adalah membaca DDL live:

```sql
-- 1. Bentuk D-5 live: kolom, tabel anak, atau tak ada sama sekali?
select table_name from information_schema.tables
 where table_schema='public' and table_name like 'strategi%' order by 1;
-- 2. Apakah live sudah punya event/versi katalog untuk D-7?
select * from notif_catalog_versions order by version;
select event_type, catalog_version from notif_events where catalog_version >= 4;
-- 3. Apakah `strategi` live punya baris produksi? Ini yang menentukan (b) aman atau tidak.
select count(*) from strategi;
```

**Pilihan:** (a) live menang — selaraskan repo ke live; (b) repo menang —
migrasi penyelaras yang membongkar bentuk D-5 live (**aman hanya kalau
`strategi` live nol baris**, dan itu harus dibuktikan lewat kueri (3) di atas);
(c) samakan penomoran, dua bentuk berdampingan — **ditolak**: kelas O38, dan
D-5 syarat submit ⇒ dua bentuk = dua jawaban untuk "boleh submit atau tidak".

**Rekomendasi: (a) atau (b) sesudah DDL live dibaca. JANGAN (c).**

Sampai diputus: **jangan klaim repo ≡ live**, dan **jangan tambah migrasi A-09**
sebelum penomorannya jelas — A-09 bertimestamp lebih besar akan menumpuk di
atas fondasi yang bercabang.

## 5. X-13 — PRD tidak pernah menulis daftar enum D-6

§4 hanya menyebut *"Leading indicator yang dipantau mingguan (maks 5) ·
Multi-enum (≤5)"*. §9 "Leading indicators" **bukan** ini: itu metrik sukses
produk (median waktu approval, return rate). Bernama sama, hal berbeda —
jebakan yang mudah kena kalau grep saja.

Dipakai: **kosakata metrik D-4 yang PRD tulis sendiri** — 10 nilai identik
dengan `ck_strtg_metric`. Nol vocabulary dikarang. Ada test yang meng-assert
`LEADING_INDICATORS` ≡ `TARGET_METRICS`, karena dua set tertutup yang bisa
menyimpang adalah kelas cacat O48/O51.

Perlu dikonfirmasi: apakah ada indikator mingguan yang **bukan** metrik D-4
(mis. *"jumlah listing diperbaiki"*, *"kecepatan approval klien"*).
Membalikkan MURAH: satu `ALTER … DROP/ADD CONSTRAINT` + satu literal di
`packages/core` dan FE, nol data produksi selama belum ada Strategi live yang
memilihnya.

## 6. Apa yang tersisa — dan urutannya

### 6.1 Lebih dulu daripada fitur apa pun

1. **O59** (§4) — keputusan pemilik + baca DDL live. Ini memblokir deploy dan
   memblokir penomoran migrasi A-09.
2. **Review PR #107.**

### 6.2 Butuh izin/orang, bukan kode

| # | Isi | Kenapa bukan saya |
|---|---|---|
| **O47b langkah (1)** | Hapus 26 branch pembawa PII → verifikasi → tiket GitHub Support | Hapus-branch ditolak `403`. Nol rewrite, nol force-push. Runbook: `docs/handoff/RUNBOOK_O47b_SCRUB_PII.md` |
| **O42 (3)** | Rekonsiliasi `role_mappings` **38-vs-23-vs-12** | Keputusan pemilik: mana sumber kebenarannya |
| **O24** | `commission_rule` riil per 32 layanan MSL | Rate per layanan (Sales Head) |
| **O45** | Cek paritas-grant menembak live | Langkah QA ber-service-role, bukan CI |
| **X-06** | RA-7 — tautan klien tanpa riwayat/diff | Konfirmasi posisi, sebelum A-11 |
| **X-12** | Rumah komponen KPI keterlambatan Plan | Pemilik: *"menyusul"* |
| **X-13** | Daftar enum D-6 (§5) | Konfirmasi kosakata |

### 6.3 Fitur M6 — jalur yang sekarang terbuka

1. **A-09** — Section E/F/G/H/I/J. Floor price per hero SKU (E-4) dibaca
   validasi Brief; F soft-limit 20% (Rule 10); G-0 sekali-set (Rule 17, default
   RA-5 sudah ada). ⚠️ **Baca §3 dulu**: setiap kolom header baru wajib masuk
   DUA daftar di `openRevision`, dan kalau field-nya bukan syarat submit,
   hilangnya **tidak** membuat satu test pun merah.
2. **A-13** — halaman & form Section A→J. Baca `web-internal/AGENTS.md` lebih
   dulu: versi Next di repo ini bukan yang ada di data latih. ⚠️ Halaman
   `account/strategies/[id]` yang ADA adalah entitas **lama** M6 §4
   (`strategy_plan`/`STR`) — jangan pakai sebagai titik mulai. Kontrak Section
   A/B/C/**D** sudah ada di `web-internal/src/lib/strategi.ts` dan dijaga
   `shape-parity`, jadi form bisa dibangun tanpa menebak bentuk respons.
3. **B-01** — `PLAN` + 6 tabel anak. Tidak terblokir sejak B-00.
   **B-06/B-07/B-09 wajib dibaca ulang dengan deviasi X-07**: penutupan periode
   **berhenti mengunci**; keterlambatan jadi sinyal kinerja, dan sampai X-12
   punya rumah ia hanya boleh masuk audit log.
4. **A-10** — dua tier visibilitas. Sekarang punya pelanggan konkret: **D-7
   hard-internal belum ditegakkan**. Sampai A-10 mendarat, setiap aktor yang
   lolos `strategi_select` (AM pemilik, lead Account, OD/Direksi) melihat
   sanggahan. Ketiganya internal ⇒ nol kebocoran ke luar, tapi **jangan** dibaca
   sebagai "tier sudah ditegakkan".

### 6.4 Yang JANGAN dikerjakan

- ~~Jangan menerapkan migrasi A-08 ke live sebelum O59 diputus~~ ✅ sudah
  diterapkan & diverifikasi (§10). Yang masih berlaku: **jangan** membuat migrasi
  Section D baru tanpa memeriksa `list_migrations` live lebih dulu — riwayat live
  memakai versi yang di-generate saat apply, bukan persis nama berkas repo.
- **Jangan** menambah kolom penyimpan untuk D-3 (X-11).
- **Jangan** menyentuh `backend/**` kecuali menjaga job-nya hijau (CLAUDE.md).
- **Jangan** menambah baris ke `KNOWN_GAPS` di `route-parity.test.ts` — kosong,
  dan harus tetap kosong.
- **Jangan** melaporkan PII sudah bersih sebelum O47b (2)+(3) selesai.
- **Jangan** menyalin baris posisi handoff tanpa memverifikasinya (§0.1).

## 7. Jebakan lingkungan

Selain yang SESI6/SESI7 catat, sesi ini menemukan dua yang memakan waktu:

1. **Postgres mati DUA KALI dalam satu sesi** (jadi kambuh keempat & kelima).
   Kali pertama: password tidak selamat **dan** DB `cdps` hilang ⇒
   `service postgresql start` + `alter user postgres with password 'postgres'`
   + `npm run db:rebuild -- --yes`. Kali kedua (di tengah menjalankan test,
   gejalanya `connect ECONNREFUSED 127.0.0.1:5432` di setiap test DB): cukup
   `service postgresql start`, DB-nya selamat. **Jangan simpulkan test Anda
   merah** sebelum `pg_isready` diperiksa — ECONNREFUSED di SEMUA test DB
   sekaligus adalah gejala server mati, bukan gejala kode.
2. **`npx tsc` me-resolve TypeScript 6.0.2 global** sementara repo pin `^5`, dan
   ia gagal dengan `TS5101 baseUrl is deprecated` — **bukan** error kode Anda.
   `node_modules` juga bisa kosong di container baru: jalankan `npm install`
   dari root dulu, kalau tidak setiap test mati dengan
   `Cannot find package '@cdps/core'`. Gerbang yang sesungguhnya adalah **test**,
   bukan `npm run typecheck` di lingkungan ini.
3. **Jangan jalankan seluruh workspace test dalam satu perintah vitest** dari
   root (`npx vitest run packages/... apps/...`): puluhan test merah karena
   pool postgres berebut satu DB. `packages/domain/vitest.config.ts` menyetel
   `fileParallelism: false` justru untuk itu — jalankan **per workspace**
   (`cd packages/domain && npm test`).

## 8. 🔴 O47b — premis §0 runbook runtuh: `main` MEMUAT PII

Pemilik minta *"jalankan sesuai rekomendasi"*. Premisnya diperiksa lebih dulu —
dan runtuh, jadi yang mendarat adalah koreksinya, bukan eksekusinya.

**Kekeliruannya pada pemilihan penanda, bukan pada perintahnya.** Seluruh §0
`RUNBOOK_O47b_SCRUB_PII.md` bersandar pada `f8faf12` sebagai "commit PII":

```
git show --stat f8faf12
#  docs/DECISIONS.md · docs/handoff/HANDOFF_SESSION_20260717C.md
git show f8faf12:docs/handoff/HANDOFF_SESSION_20260717C.md \
  | grep -icE '@meagency\.co\.id|password|sandi'          # -> 0
```

`f8faf12` adalah commit **dokumentasi** (entri Open O35) dengan **nol** pola PII.
Jadi `is-ancestor f8faf12 origin/main` = FALSE membuktikan `main` tidak
menjangkau **satu commit docs** — bukan apa pun soal PII.

**PII yang sesungguhnya:** CSV karyawan `backend/testdata/import_samples/`
(`employees_cdps`, `employees_from_hris`, `employees_uat`, `nik_email`), dihapus
commit `22af45b`. Dan `22af45b` **ADA DI `main`** — keempat blob-nya ditemukan di
`git rev-list origin/main --objects`. Penghapusan 2026-07-30 mengeluarkannya dari
**tree**, bukan dari **histori**: persis laporan palsu pertama.

| | §0 mengklaim | Kenyataan |
|---|---|---|
| Rewrite `main` · force-push · re-clone | tidak perlu | **WAJIB** |
| Hapus 26 ref | inti scrub | **nol efek untuk PII** (berbagi blob dengan `main`) |
| Tiket Support | wajib | wajib |

Jadi rencana (b) **sebagaimana DECISIONS 2026-08-07 menuliskannya** benar sejak
awal; yang salah hanya "jalan pintas" yang ditemukan sesudahnya.

**Status:** Langkah 1 (hapus 25 ref — bukan 26; `claude/fase1-sesi4-handoff-1x8v1i`
false positive) **BELUM**: dicoba, **ditolak classifier izin**. Rewrite **tidak**
dijalankan — biayanya jatuh ke orang lain (semua kontributor re-clone, PR #107
mati, branch protection, redeploy Vercel SHA lama), jadi bukan langkah sesi agen.

**Runbook sudah diperbaiki:** blok koreksi di kepala + **§5 verifikasi yang
menguji BLOB**, bukan `f8faf12`, dengan gerbang laporan tiga syarat. §0 tidak
dihapus, ditandai DIBATALKAN supaya cara kesimpulan salah itu terbentuk terbaca.

⚠️ **JANGAN laporkan PII bersih sampai rewrite selesai.** Menghapus ref lalu
menyebut O47b selesai = laporan palsu KETIGA untuk masalah yang sama.

## 9. O42 detail cek · A-09a mendarat · A-09b di-scope

### 9.1 O42 — `docs/handoff/O42_REKONSILIASI_ROLE_MAPPINGS.md`

6 kueri berurut + 3 keputusan. **Temuan yang mengubah bentuk pertanyaannya:**
`38 vs 23 vs 12` BUKAN tiga versi satu daftar.

| Sumber | Baris | Bentuk kunci |
|---|---|---|
| `supabase/seed.sql` | 12 | **Title Case** karangan CDPS (`Sales`/`Sales Executive`) |
| `supabase/seed/role_mappings_riil.csv` | 23 | **UPPERCASE** HRIS (`SALES`/`SALES JASA`) |
| live `CDPS SG` | 38 (→39) | UPPERCASE + tambahan |

Join `rm.divisi = e.divisi AND rm.jabatan = e.jabatan` **peka huruf besar-kecil**
⇒ A dan B beririsan **NOL baris**. Jadi 12 itu **fixture**, bukan versi kurang
lengkap dari 38 — dan pertanyaan sebenarnya: **apakah `employees` produksi
menyimpan string HRIS mentah?** Karyawan seed memang Title Case, itu sebabnya
fixture-nya cocok.

Dampaknya kalau salah: `private.employee_role` INNER JOIN ⇒ karyawan tanpa
mapping **404 di `/portal`** dan **tidak pernah** jadi penerima `notify_emit`,
jadi notifikasi ke lead divisinya menguap **tanpa error** (nol penerima sah).
Live dilaporkan 7 karyawan aktif tanpa mapping; 3 `Management/Director` sengaja
(layered role), **4 sisanya perlu diputuskan**.

### 9.2 A-09a — narasi Section E/H (SELESAI)

Migrasi `20260808010000`, **nol tabel baru**, gerbang tabel tetap **76**.
E-1 `growth_thesis` · E-13 `urutan_eksekusi_alasan` · H-3 `skenario_mundur` ·
H-4 `kondisi_stop_scope`. Tiga pertama `W` + digerbangi; H-4 `O`, sengaja tidak.

Dua keputusan yang bisa salah kalau ditebak:

1. **H-4 IKUT tersalin ke revisi** walau `O` — ia **KONTEN** (kondisi yang
   berlaku terus). Bandingkan **D-7 yang sengaja TIDAK tersalin**: sanggahan
   adalah **TINDAKAN** dengan aktor + timestamp. Bedanya itu, bukan wajib/opsional.
2. **H-4 tidak ditulis ke `audit_log`.** Ia hard-internal §4.1 dan `audit_log`
   punya read-scope berbeda dari `strategi` ⇒ menyalin paragrafnya ke sana
   memperluas siapa yang bisa membacanya. Yang dicatat: field MANA yang terjawab.
   Ada test yang meng-assert marker rahasia TIDAK muncul di `after_json`.

### 9.3 A-09b — sisa Section E/F/G/H/I (analisis celah SUDAH dikerjakan)

**Jangan ulangi analisisnya**, ada di `docs/backlog/M6ABC_BACKLOG.md`. Ringkas:

- **Sudah ada:** E-3…E-11 (`strategi_pillar`) · F-1…F-6 (`strategi_resource`) ·
  F-7 + G-0 (header) · H-1 (`strategi_risk`) · J-1/J-2 (header) · J-3
  (`strategi_version`) · **I-1 + J-4 turunan, tidak pernah disimpan**.
- **Belum ada:** E-2 · E-12 · G-1 · G-2 · G-3/G-4 · H-2 · I-2 · I-3 · I-4.
- ⚠️ **H-2 harus memakai set enum yang SAMA** dengan
  `strategi_version.trigger_revisi` (J-3) yang sudah memakai kode trigger — dua
  daftar tertutup yang bisa menyimpang adalah kelas O48/O51.
- ⚠️ **Setiap kolom header baru WAJIB masuk DUA daftar di `openRevision`**
  (§3). Kalau field-nya bukan syarat submit, hilangnya **tidak** membuat satu
  test pun merah — perangkap yang masih aktif.
- E-4 floor price sudah ada (`strategi_pillar.floor_price`); yang belum adalah
  validasi Brief yang MEMBACANYA — tiket M7/M12, bukan M6A.

## 10. ✅ O59 DIEKSEKUSI — live ≡ repo, dan satu temuan yang lolos semua gerbang

Pemilik memutuskan **(b) repo menang**. Premisnya diverifikasi lebih dulu, bukan
dipercaya: `strategi` live **0 baris** (juga `strategi_target`,
`strategi_assumption`, `strategi_definisi_berhasil`) ⇒ membongkar bentuk live
nol kehilangan data.

### 10.1 Drift-nya TIGA perbedaan, bukan satu

| Hal | Live (sesi hilang) | Repo | Aksi |
|---|---|---|---|
| D-5 | tabel anak `strategi_definisi_berhasil` | 3 kolom `definisi_berhasil_*` | tabel dibongkar |
| CHECK D-6 | `ck_strategi_leading_{array,maks,taksonomi}` | `ck_strategi_leading_indicator` | nama live dibuang |
| CHECK D-7 | `ck_strategi_sanggahan` | `ck_strategi_sanggahan_utuh` | nama live dibuang |
| **event v4** | **`strategi_sanggahan_target`** | **`m6a.strategi.sanggahan_target`** | disatukan |

### 10.2 🔴 Yang ketiga adalah temuan terpenting sesi ini

**Perbedaan nama event lolos SEMUA gerbang.** Keduanya "1 event di versi 4", jadi
`COUNT(notif_events) = 34` **dan** `SUM(event_count) = 34` **cocok di kedua
sisi** — sepanjang waktu, hijau. Gerbang berbasis **hitungan** tidak bisa melihat
nama yang berbeda.

Akibatnya bukan kosmetik: `raiseSanggahan` memanggil
`notify_emit('m6a.strategi.sanggahan_target')`, dan live akan
`RAISE EXCEPTION 'notification: unknown event %'` ⇒ **Sanggahan Target GAGAL
TOTAL di produksi**, bukan sekadar tidak menotifikasi.

**Aturan yang lahir dari ini:** gerbang hitungan cukup mendeteksi event yang
**HILANG**, tidak yang **SALAH NAMA**. Migrasi rekonsiliasi §5 sekarang
meng-assert nama secara eksplisit, termasuk bahwa nama versi live sudah TIDAK
ADA lagi.

### 10.3 Cara eksekusinya — dan satu kegagalan yang mengajari sesuatu

`20260808000000` (A-08) dan `20260808010000` (A-09a) dibuat **KONVERGEN**
(`ADD COLUMN IF NOT EXISTS`, `DROP CONSTRAINT IF EXISTS` sebelum `ADD`,
`ON CONFLICT DO NOTHING`) — wajib, karena versinya tidak ada di riwayat live
sehingga `db push` akan mencobanya di sana dan `ADD COLUMN` polos akan gagal.

Lalu `20260808030000_o59_rekonsiliasi_section_d`, dengan **guard sebelum DROP**:
menolak berjalan (`RAISE EXCEPTION`) kalau `strategi_definisi_berhasil` memuat
>0 baris. Premis "tabel kosong" ditegakkan, bukan dipercaya — kalau seseorang
mengisinya antara keputusan dan penerapan, lebih baik merah di deploy daripada
hilang di produksi.

**Penerapan pertama GAGAL**, dan itu berguna: `UPDATE … SET event_type = <bertitik>`
menabrak PK, karena `20260808000000` **sudah** meng-INSERT nama bertitik ⇒ live
sempat memuat KEDUA nama (35 event vs 34 terdaftar, katalog tidak konsisten).
Diperbaiki jadi **dua cabang**: nama bertitik sudah ada ⇒ HAPUS yang polos;
belum ada ⇒ RENAME. Itu membuatnya idempoten atas urutan penerapan yang berbeda
antara live (sudah lewat 20260808000000) dan DB kosong (belum).

### 10.4 Hasil terverifikasi di live

| | Sebelum | Sesudah |
|---|---|---|
| tabel `public` | 77 | **76** |
| `notif_events` / terdaftar | 35 / 34 ❌ | **34 / 34** |
| event v4 | dua nama | **`m6a.strategi.sanggahan_target`** |
| D-5 | tabel anak | **3 kolom** |
| narasi A-09a | 0 kolom | **4 kolom** |
| nama CHECK | versi live | **5 nama repo** |
| prefix · mesin | 31 · 16 | **31 · 16** |

Lokal: **71 migrasi** bersih, domain **895 + 1 skipped**, `apps/api` **324**.

⚠️ **Riwayat migrasi live memakai versi yang di-generate saat apply**, bukan
persis nama berkas repo (pola yang sudah ada di repo ini sejak
`20260807174753`). Nama-nya sengaja disamakan dengan nama berkas repo supaya
pemetaan 1:1 tetap terbaca.

### 10.5 O47b · O42 · X-13 — status sesudah keputusan

- **O47b = (b)**, rewrite **sesudah #107 merge**. Urutan di §8 + runbook §5.4.
  Sampai langkah Support selesai: **PII belum bersih.**
- **O42**: (a) sumber kebenaran = **live**; (b) seed pindah ke mapping **B**
  (UPPERCASE HRIS) ⇒ **tiket `O42-b`** di backlog, karena ia mengharuskan 10
  karyawan seed ikut berubah bentuk (join peka huruf besar-kecil) dan menyentuh
  gerbang `role_mappings = 12`; (c) **Direktur memang tidak punya divisi** ⇒
  `Management/Director` tanpa mapping BENAR, INNER JOIN O51 tetap, dan
  `m5.transaction.change_requested` tetap `explicit` — jangan pernah
  `leadsOfDivision`.
- **X-13 ✅ ditutup** — set D-6 = kosakata metrik D-4 apa adanya. Nol perubahan
  kode; yang berubah hanya statusnya.
