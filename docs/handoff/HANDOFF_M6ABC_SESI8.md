# HANDOFF — M6A/M6B/M6C Sesi 8 (titik mulai sesi berikutnya)

> Rantai: SESI1 → … → SESI7 → **SESI8 (ini, terbaru)**. Baca yang bernomor
> tertinggi lebih dulu; sesi sebelumnya hanya untuk konteks sejarah.
>
> **Sesi ini menutup ronde cacat (merge PR #106) lalu mengeksekusi A-08** —
> Section D lengkap. Nol pekerjaan menggantung.
>
> **Mulai dari sini:** §5 — **A-09** (Section E/F/G/H/I/J), lalu A-13 → B-01.

## 0. Posisi persis — SALIN INI KE SESI BERIKUTNYA

| | |
|---|---|
| Branch | `claude/handoff-sesi6-migration-yntcgg` (di-restart dari main sesudah #106 merge) |
| `main` | `1316705` — **PR #106 ter-merge** (ronde cacat O52/O51/O48 + X-11 + O47b) |
| PR terbuka | **NOL** per akhir sesi ini |
| Migrasi | **69 berkas** (68 + A-08). Live `CDPS SG` **sinkron & terverifikasi** — sidik jari `951050fc676838044cc28684346c4880` \| 149 fakta, identik lokal & live |
| Gate | tabel **77** (+1) · prefix **31** · mesin **16** · event **34** (+1, katalog **v4**) |
| Skor | M6A **64%** (9/14) · M6B **8%** (1/12) — A-08 mendarat |
| Test | domain **894/894** hijau (suite penuh) · `apps/api` **324** · `packages/core` **118** · 4 invariant SQL hijau |
| Menggantung | **NOL.** Working tree bersih, lokal ≡ remote, nol migrasi tertunda |

## 1. Yang mendarat sesi ini

### 1.0 PR #106 di-merge lebih dulu — dan itu bukan basa-basi

SESI7 selesai dengan #106 terbuka dan hijau. SESI6 §4b sudah membayar pelajaran
ini sekali: #91 menganggur tiga hari dan butuh **tiga** perbaikan yang tak satu
pun terlihat sebagai konflik git. #106 di-merge di menit-menit pertama sesi ini,
sebelum satu baris A-08 ditulis, supaya A-08 dibangun di atas main yang sudah
memuatnya — bukan di atas cabang yang harus di-rebase belakangan.

### 1.1 A-08 — Section D lengkap (migrasi `20260808020000_m6a_section_d.sql`)

Section D sudah **separuh** ada sebelum tiket ini, dan itu penting supaya tidak
ada yang mengira A-08 membangun ulang: D-1/D-2/D-4 = `strategi_target` (A-03,
stretch `>=` floor di CHECK), D-3 = turunan (X-11), D-8/D-9 =
`strategi_assumption` (A-03). Yang mendarat sekarang adalah **tiga field yang
belum punya rumah sama sekali** plus **pemanggil `emit()` pertama** untuk
katalog v2.

| Field | Bentuk | Kenapa bentuk itu |
|---|---|---|
| **D-5** definisi berhasil 30/60/90 | tabel anak `strategi_definisi_berhasil`, PK `(strategi_id, horizon_hari)`, CHECK `IN (30,60,90)` | Horizon adalah **data**, bukan nama kolom. Sebagai baris ia bisa ditutup sebagai set; sebagai tiga kolom `definisi_30/60/90`, "definisi di 45 hari" hanya bisa ditolak oleh kode yang kebetulan ingat |
| **D-6** leading indicator mingguan | kolom `strategi.leading_indicator` jsonb, CHECK ≤5 + taksonomi `<@` | Multi-enum berbatas tanpa atribut per baris — persis bentuk `aset_dari_klien` (A-05) |
| **D-7** Sanggahan Target | 5 kolom header + CHECK all-or-nothing + event katalog **v4** | `O` dan tunggal di PRD: satu sanggahan per versi. Berubah pikiran = EDIT (audit menyimpan before/after), bukan sanggahan kedua |

**Kelengkapan ketiganya adalah gerbang submit, bukan `NOT NULL`.** Alasannya
sama dengan Section B: §7 meminta autosave 20 detik, jadi keadaan
setengah-terisi **wajib** bisa disimpan. D-5 dilaporkan **per horizon**
(`D-5/30`, `D-5/60`, `D-5/90`) supaya form bisa melompat ke yang kurang, bukan
mengatakan "Section D belum lengkap" tiga kali.

### 1.2 Rule 19 ditegakkan oleh LETAK, bukan oleh teks

D-7 adalah tempat paling mudah untuk menulis aturan yang benar dan penegak yang
tidak ada. Rule 19 berkata sanggahan **advisory**: floor kontrak tidak bergerak.
Yang membuat itu benar di sini bukan komentar melainkan **nol jalur** dari
`saveSanggahan` ke `strategi_target`. Ada test yang menuntutnya secara langsung:
sesudah sanggahan diajukan, `nilaiFloor` masih persis sama **dan** stretch di
bawah floor tetap ditolak. Kalau seseorang kelak "menghubungkan" keduanya, test
itu merah sebelum PRD-nya sempat dibaca ulang.

### 1.3 Katalog notifikasi v4 — dan kenapa bukan menumpang v2

PRD menuntut notifikasi D-7 di **dua** tempat (§4 baris D-7 `O (notif SPV + Head
of Sales)` dan Rule 19), sementara §7 hanya mengatalogkan **empat** event
Strategi — keempatnya siklus hidup. Jadi sanggahan tidak punya event untuk
ditumpangi, dan menumpangkannya ke `strategi_diajukan` akan **lebih buruk
daripada tidak mengirim apa pun**: penerimanya berbeda (Head of Sales tidak
menerima pengajuan Strategi) dan artinya berbeda ("menunggu persetujuan Anda" vs
"AM menilai floor-nya tidak realistis").

Versi **4**, bukan sisipan ke v2, dengan alasan yang persis sama seperti v3
Finance: v2 adalah amandemen M6A/6B/6C **sebagaimana ia mendarat**.

**Satu detail resolver yang akan salah kalau ditebak ulang:** satu emisi membawa
**SATU** divisi, dan event ini punya **dua** audiens di **dua** divisi. Jadi SPV
datang lewat arm divisi (Account) dan Head of Sales di-resolve di TS
(`salesLeadIds`) lalu dikirim eksplisit — memakai join `role_mappings` yang
**sama persis** dengan yang dipakai `notify_emit`, supaya keduanya tidak bisa
berselisih soal apa itu "lead".

### 1.4 Flip asumsi → `Gugur`: pemanggil `emit()` PERTAMA untuk katalog v2

O55 menutup blokirnya 2026-08-07; katalognya ada sejak itu, pemanggilnya belum.
A-08 menyambungkannya karena A-08 adalah tiket yang menciptakan kesempatannya.

⚠️ **`setAssumptionStatus` sengaja TIDAK dibatasi Draft** — satu-satunya tulis
konten di modul ini yang begitu, jadi jangan "perbaiki" jadi konsisten. Asumsi
gugur baru berarti saat Strategi sudah **`Aktif`**; itulah keadaan yang membuat
"revisi disarankan" punya makna. Membatasinya ke Draft membuat event yang Rule
13 dibangun di atasnya **tidak pernah menyala di situasi yang PRD tulis
untuknya**.

Ia tetap **flip status, bukan revisi**: revisi adalah baris baru dengan trigger +
alasan + asumsi gugur (`openRevision`). Fungsi ini hanya mencatat bahwa tanahnya
bergeser, lalu memberi tahu dua orang yang memutuskan.

**Idempoten, dan itu bukan kerapian:** menyetel status yang sudah berlaku menulis
nol baris audit dan nol notifikasi. Tanpa itu, form yang menyimpan saat blur akan
memberi tahu SPV sekali per jeda ketik.

### 1.5 Revisi (Rule 13) — apa yang ikut, apa yang tidak

D-5 dan D-6 **ikut terbawa**. D-7 **sengaja tidak**: sanggahan mengobjeksi target
**versi ini**, dan membawanya ke versi yang targetnya belum ditulis berarti
melekatkan objeksi pada angka yang belum ada. Ada test untuk ketiganya sekaligus.

### 1.6 X-13 dibuka, bukan ditebak

PRD menulis D-6 sebagai "Multi-enum (≤5)" dan **tidak pernah mendaftar
nilainya**. Yang dipakai adalah kosakata metrik D-4 yang **sudah** ada di DB
(`ck_strtg_metric`) — nol nama baru dikarang. Tapi itu tetap sebuah pembacaan,
jadi ia dibuka sebagai **X-13** (backlog §4): kalau AM ingin memantau "jumlah
keluhan masuk" mingguan, itu bukan metrik target dan sekarang ditolak.
Menambahkannya adalah penambahan taksonomi (satu CHECK), bukan pembongkaran
bentuk — murah nanti, jadi tidak perlu ditebak sekarang.

## 2. Bukti live ≡ repo

Sidik jari struktural atas `strategi` + `strategi_definisi_berhasil` +
`strategi_assumption` + seluruh katalog notifikasi — kolom/tipe/nullability,
constraint, indeks, RLS policy, trigger, event, versi katalog:

| | Hash |
|---|---|
| Lokal (`db-rebuild.sh`, 69 migrasi dari nol) | `951050fc676838044cc28684346c4880` \| **149** |
| Live `CDPS SG` | `951050fc676838044cc28684346c4880` \| **149** |

Live: **77 tabel · 31 prefix · 16 mesin · 34 event · katalog konsisten
(SUM = 34) · v1 tetap beku di 17.** Nol migrasi tertunda.

Kuerinya ada di riwayat sesi ini. **Jalankan ulang setiap kali habis `db push`**
— ia menangkap kelas kesalahan yang `list_migrations` tidak bisa: migrasi
tercatat "applied" padahal isinya sebagian gagal.

## 3. Ledger O48 BERTAMBAH satu baris — dan itu dicatat, bukan diselundupkan

`rls_checks.sql` §42 sekarang memuat `strategi_definisi_berhasil_select`.
Aturannya berkata daftar itu **hanya boleh menyusut**, dan menambah baris butuh
entri Decided — entrinya ada (`DECISIONS.md` 2026-08-08).

Alasannya: tabel anak Strategi mewarisi visibilitas dari induknya lewat
`private.jwt_can_read_strategi`, persis seperti **11 saudaranya** yang sudah ada
di daftar itu. Deteksi ledger bersifat sintaktik (`jwt_is_lead`/`jwt_division`),
jadi pewarisan lewat induk selalu terbaca "tanpa arm". Alternatifnya — memberi
tabel ini arm sendiri — akan membuat definisi berhasil terbaca oleh divisi yang
**tidak bisa membaca Strategi induknya**.

## 4. Jebakan lingkungan — kambuh lagi, persis seperti diperingatkan

1. **Container start tanpa `node_modules`.** `npx vitest` mengunduh vitest 4 dan
   gagal dengan `Could not resolve 'vitest/config'`. `npm ci` **dari root repo**
   (jangan dari `packages/*` — SESI7 §5.1).
2. **Postgres di-SIGKILL di tengah sesi** (SESI6 §3.2, SESI7 §7 — sekarang tiga
   sesi berturut-turut). Kali ini gejalanya `connection refused` di tengah
   verifikasi sidik jari. `service postgresql start` + set ulang password;
   DB `cdps` selamat (77 tabel utuh), tapi jangan berasumsi.
3. Suite penuh domain **jalan andal** sesi ini: 894 test / 37 detik, dua kali.

**Yang layak ditiru:** angka baseline diverifikasi, bukan disalin. SESI7 mencatat
"domain 864". Sesudah A-08 hasilnya 894 — selisih 30, sementara blok test yang
ditulis sesi ini berisi 30 `it`. Itu dicek dengan `git stash` + menjalankan suite
di HEAD (864 persis), bukan disimpulkan dari aritmetika. Selisih yang "kira-kira
cocok" adalah cara paling mudah melewatkan test yang diam-diam berhenti jalan.

## 5. Apa yang tersisa — dan urutannya

**Nol pekerjaan menggantung.** Yang di bawah ini pekerjaan berikutnya.

### 5.1 M6A — jalur yang terbuka sekarang

1. **A-09 — Section E/F/G/H/I/J.** Tiket besar berikutnya, dan satu-satunya yang
   memisahkan M6A dari "seluruh field mendarat". Floor price per hero SKU (E-4)
   dibaca validasi Brief; F soft-limit 20% (Rule 10); G-0 sekali-set (Rule 17,
   default RA-5 sudah ada). **Tabel `strategi_pillar`/`strategi_resource`/
   `strategi_risk` SUDAH ADA** (A-03) — A-09 mengisi field per Section, tidak
   membuat ulang bentuknya.
2. **A-13 — halaman & form Section A→J.** Empat dari sepuluh seksi sekarang punya
   kontrak lengkap (A/B/C/D), dan `shape-parity` menjaganya, jadi form bisa
   dibangun tanpa menebak bentuk badan respons. ⚠️ Baca `web-internal/AGENTS.md`
   lebih dulu; dan halaman `account/strategies/[id]` yang ADA adalah entitas
   **lama** M6 §4 (`strategy_plan`/`STR`) — jangan pakai sebagai titik mulai.
3. **B-01 — `PLAN` + 6 tabel anak.** Tidak terblokir sejak B-00. B-06/B-07/B-09
   wajib dibaca ulang dengan deviasi X-07 (penutupan periode berhenti mengunci).

### 5.2 Butuh izin/orang, bukan kode

| # | Isi | Kenapa bukan saya |
|---|---|---|
| **O47b langkah (1)** | Hapus 26 branch pembawa PII → verifikasi → tiket GitHub Support | Hapus-branch ditolak `403` dari sesi CCR. **Bukan operasi berisiko**: nol rewrite, nol force-push. Runbook: `docs/handoff/RUNBOOK_O47b_SCRUB_PII.md` |
| **O42 (3)** | Rekonsiliasi `role_mappings` **38-vs-23-vs-12** | Keputusan pemilik: mana sumber kebenarannya |
| **O24** | `commission_rule` riil per 32 layanan MSL | Rate per layanan (Sales Head) |
| **O45** | Cek paritas-grant menembak live | Langkah QA ber-service-role, bukan CI (SESI7 §2.5) |
| **X-06** | RA-7 — tautan klien tanpa riwayat/diff | Konfirmasi posisi, sebelum A-11 |
| **X-12** | Rumah komponen KPI keterlambatan Plan | Pemilik: *"menyusul"*. Batasnya di SESI7 §1.5 |
| **X-13** | 🆕 D-6 — cukupkah kosakata metrik D-4 untuk leading indicator? | Yohan/Yulianti, sebelum A-13 membangun form Section D. **Tidak memblokir** — §1.6 |

### 5.3 Yang JANGAN dikerjakan

- **Jangan** menambah kolom penyimpan untuk D-3 (X-11) sebelum QC produksi.
- **Jangan** membatasi `setAssumptionStatus` ke Draft "supaya konsisten" (§1.4).
- **Jangan** menghubungkan D-7 ke `strategi_target` dalam bentuk apa pun (§1.2).
- **Jangan** membawa sanggahan ke versi revisi (§1.5).
- **Jangan** menyentuh `backend/**` kecuali menjaga job-nya hijau (CLAUDE.md).
- **Jangan** menambah baris ke `KNOWN_GAPS` di `route-parity.test.ts` — kosong.
- **Jangan** melaporkan PII sudah bersih sebelum O47b (2)+(3) selesai.

## 6. Aturan migrasi — tidak berubah, diulang karena mahal

1. Migrasi **hanya** lewat `supabase/migrations/**` + `db push` /
   `apply_migration`. **Jangan pernah** `psql -f` ke live (asal drift O38).
2. DB lokal dibangun ulang **hanya** lewat `scripts/db-rebuild.sh`.
3. Angka gate hidup di **DUA** berkas (`scripts/db-rebuild.sh` +
   `.github/workflows/ci.yml`). Menaikkan satu saja = CI merah dengan seluruh
   test suite hijau. Sesi ini menaikkan **empat** angka di kedua berkas
   (tabel 76→77, event 33→34) dalam satu commit.
4. Sesudah `db push`, jalankan **sidik jari struktural** (§2). Jangan percaya
   "tidak error".
5. Menambah event notifikasi berarti menyentuh **tiga** tempat yang saling
   menjaga: migrasi (`notif_catalog_versions` + `notif_events`),
   `packages/core/src/notification.ts` (`EVENTS` + `CATALOG` + `CATALOG_VERSIONS`),
   dan `notification.test.ts` (keanggotaan versi). Melewatkan satu = merah, dan
   itu memang tujuannya.
