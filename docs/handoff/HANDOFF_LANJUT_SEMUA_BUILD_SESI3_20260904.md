# HANDOFF — LANJUT SEMUA BUILD, SESI 3

> Melanjutkan `HANDOFF_LANJUT_SEMUA_BUILD_SESI2_20260904.md`. Dokumen itu (dan
> induknya, `HANDOFF_LANJUT_SEMUA_BUILD_20260904.md` di PR #281) **belum
> digantikan** — §2 (6 keputusan pemilik), §3 (tiket tersisa) dan §4 (gate
> cutover) **carry-over apa adanya** kecuali yang disebut berubah di sini.

## 0. TL;DR — apa yang berubah sesi ini

| # | Pekerjaan | Status |
|---|---|---|
| 1 | **UAT dua engine TikTok dengan export ASLI** (SESI2 §0 baris 2) | ✅ **SELESAI** — dan menemukan 1 bug berat, lihat §1.1 |
| 2 | **O70** — Ads Scanner baca kolom dari seksi yang salah (86% GMV hilang) | ✅ **DIPERBAIKI + dites** |
| 3 | Rename grup sidebar → **"MEA AI Tools"** + kunci visibilitas per divisi | ✅ **SELESAI** (§2) |
| 3b | **Sidebar IA v3 diimplementasi** — 9 grup, accordion, kotak cari, Papan Divisi | ✅ **SELESAI** (§2) — badge §5.4 ditunda |
| 3c | **Diuji di browser sungguhan** + 1 bug accordion ditemukan & diperbaiki | ✅ **SELESAI** (§2.1) |
| 3d | Cek migrasi Supabase yang belum diterapkan ke live | ✅ **NIHIL** — live & repo cocok persis (§5) |
| 4 | Jawab 6 keputusan pemilik (SESI2 §2) | ⬜ belum — 2 pertanyaan BARU sesi ini (O71, O70-b) **sudah dijawab & ditindaklanjuti**, §3 |
| 5 | Tiket kode tersisa (SESI2 §3) | ⬜ belum tersentuh |
| 6 | Gate GO cutover → C-05 | ⬜ belum |
| — | **PR #283 (seluruh kerja sesi ini) — sudah DI-MERGE ke `main`** (`d51866f`) | ✅ CI hijau 6/6 + 3 deploy Vercel sebelum merge |
| — | PR #281 masih draft (SESI2 §5) | ⬜ masih perlu keputusan Nerissa/Yohan |
| — | **PR #171 masih terbuka sejak 15 Agu** — migrasinya sudah mendarat lewat jalur lain, tapi **invariant `rls_checks` §44 belum ada** (§5.1) | 🟠 keadaan aman hari ini, tapi tak ada yang menjaganya |

---

## 1. UAT TikTok dari export asli — laporan penuh di dokumen sendiri

**Baca `docs/handoff/UAT_TIKTOK_AVITASKIN_20260904.md`.** Ringkasnya:

### 1.1 🔴 O70 — bug berat di Ads Scanner, ditemukan & diperbaiki

Export **"Analitik Produk"** yang sebenarnya adalah tabel **176 kolom dalam 5
seksi** (`Semua`, `LIVE penjual`, `Video penjual`, `Afiliasi`, `Kartu produk
penjual`) dengan **30 nama kolom berulang**. `rowsToObjects` (port verbatim dari
tool pemilik) memakai aturan "yang terakhir menang", jadi **setiap metrik
headline SKU** dibaca dari seksi terakhir:

| | dibaca engine | sebenarnya |
|---|---|---|
| Σ GMV 24 SKU | Rp 3.743.633 | **Rp 26.560.049** |
| Σ Impresi | 55.345 | **832.842** |
| CTR SKU teratas | 2,36% | **3,51%** |
| CTOR SKU teratas | 3,39% | **0,40%** |

Oracle-nya silang-berkas: Σ kolom pertama = persis GMV export Analitik Toko
(`shop_tt`). Dampaknya bukan cuma angka — **nasihatnya berbalik arah**: SKU
teratas berubah dari *"kreatif/hook lemah, butuh angle baru"* jadi *"konversi
bocor — cek harga, review, foto & deskripsi halaman produk"*.

**Perbaikan:** `rowsToObjects` kini "kemunculan PERTAMA menang" + kunci bersuffix
`nama#<kolom>` untuk sisanya — **persis aturan `baseline/sheet.ts:readSheet`**
yang sudah dipakai mesin baseline/report, jadi repo ini berhenti punya dua aturan
untuk satu masalah. Ini satu-satunya penyimpangan dari tool pemilik di mesin ini,
dicatat di `DECISIONS.md` **O70** dan di komentar modulnya.

### 1.2 ✅ Report Engine: bersih

12 dari 12 berkas dikenali benar, semua KPI headline cocok **persis** ke berkas
mentah (GMV, pesanan, pembeli, pengunjung, CVR digit-demi-digit, impresi, klik),
periode terbaca dari berkas, `createReport` sukses (skor 4,5 KRITIS).

Satu konsekuensi operasional: 4 berkas video/LIVE ditandai **ambigu** (toko vs
afiliasi) dan `createReport` menolak 400 sampai klien punya akun tertaut →
**`client_platforms` klien TikTok harus terisi handle tokonya**.

### 1.3 ✅ O67 terverifikasi di data nyata

Kosakata status produk TikTok yang asli: **`Aktif` / `Nonaktif`**. Produk
`Nonaktif` masuk bucket **DIBLOKIR** dengan blocker yang benar — perbaikan
`\baktif\b` sesi lalu terbukti benar, keraguan "vocabulary belum diverifikasi"
di handoff SESI2 §1.2 tertutup.

### 1.4 Temuan kecil

- ✅ **O71 (dijawab pemilik, diperbaiki)** — Report Engine membuang video yang
  captionnya kosong (16 video, 15 di antaranya VV>0) dari penyebut. Pemilik:
  **tetap dihitung, diberi nama `(tanpa caption)`**. Baris kini dibuang hanya
  bila caption DAN `ID Video` sama-sama kosong. Terverifikasi ke export asli:
  34 dari **664** (dari 648).
- ✅ **O70-b (dijawab pemilik)** — Ads Scanner **belum dipakai di aplikasi**,
  jadi tak ada scan produksi yang perlu dijalankan ulang setelah O70.
- ✅ Pesan `[berkas ini ekspor "Ringkasan data"…]` kini **menyebut nama
  berkasnya** — sebelumnya satu folder 12 berkas ditolak tanpa petunjuk yang mana.

---

## 2. Navigasi — Sidebar IA v3 SUDAH mendarat

Saat sesi ini dimulai, jawaban atas *"plan navigasi sudah sampai mana?"* adalah:
**spek ada, implementasi nol** — kecuali satu label grup. Sekarang tidak lagi.

**Yang terpasang** (`web-internal/src/lib/nav.ts` + `Sidebar.tsx`):

- **9 grup** sesuai IA v3 §2: Beranda · Akuisisi · Katalog & Penawaran · Klien ·
  Delivery · MEA AI Tools · Keuangan · Tim · Admin.
- **Grup "Portal" dibubarkan**: `Portal Saya`→Beranda `Kinerja Saya`,
  `Portal Tim`→Tim `Kinerja Divisi`, `Manajemen`→Klien `Pantauan Risiko Klien`,
  `Kontak Klien (Portal)`→Admin `Akses Portal Klien`. Plus `Klien`→`Direktori
  Klien`, `Perlu Persetujuan Saya`→`Persetujuan`.
- **`Notifikasi` + `Ganti Password` pindah ke header** (v3 §2 "Avatar menu") —
  bel & Keluar sudah ada di sana, `Ganti Password` ditambahkan. Tetap tanpa
  gerbang, alasan O44(c) yang sama.
- **Accordion** (satu grup terbuka; grup rute aktif terbuka saat muat),
  **kotak cari ⌘K/Ctrl+K**, **sub-grup `Papan Divisi`** kedalaman-2 yang
  mengingat lipatannya di localStorage, rail 270px sticky, a11y penuh.
- **Auto-scope Papan Divisi** ternyata bukan aturan baru: ia jatuh dari
  `divisionQueue` yang sudah ada. Creative staff melihat satu papan; Direktur/OD
  tujuh.

**Empat penyimpangan dari dokumen, semuanya disengaja & tercatat:**

1. **Badge angka (§5.4) DITUNDA** — pilihan pemilik. Tiap badge butuh endpoint
   hitungan sendiri di `apps/api` (Persetujuan, Leads, Task Execution, Reminder)
   berikut tes izin per peran. **Itu tiket berikutnya kalau badge dimau.**
2. **§4 dijawab pemilik: ketiga pasang halaman DIPERTAHANKAN** → 33 item, bukan
   30. Ketiganya beda kemampuan, bukan cuma scope (lihat DECISIONS 2026-09-04).
3. **Label dua alat di MEA AI Tools tidak diubah** — pemilik hanya minta nama
   grupnya.
4. **`Screening SKU` + `Ads Scanner` ditambahkan ke Delivery** — mendarat sesudah
   v3 ditulis; keduanya halaman React ber-API/ber-RLS milik divisi Ads, bukan
   HTML embed, jadi bukan anggota grup MEA AI Tools.

**Yang menjaga supaya tidak ada halaman kehilangan pintu:** satu tes menyebutkan
37 href satu per satu dan gagal kalau salah satunya hilang dari model, plus tes
"tidak ada href ganda". Logika accordion & pencarian dipindah ke `nav.ts` sebagai
fungsi murni (`isActiveHref`/`sectionOfRoute`/`filterNav`) supaya bisa dites tanpa
DOM; `Sidebar.tsx` tinggal renderer.

### 2.1 ✅ Diuji di browser — dan itu menemukan bug yang 534 tes lewatkan

`apps/api` di :3001 + `web-internal` di :3000 di atas DB lokal, sesi JWT
di-mint lokal (GoTrue live TIDAK dipakai — lihat §6.2 untuk caranya), Chromium
via Playwright, 5 keadaan, **nol error console**:

| Keadaan | Hasil |
|---|---|
| Direktur di `/` | hanya **Beranda** terbuka; 4 tautan terlihat dari 37 |
| Direktur di `/creative` | **Delivery** + sub-grup **Papan Divisi** terbuka sendiri, `Creative` bertanda aktif |
| cari `"papan"` | hanya **Delivery › Papan Divisi**, 7 papan |
| staff Creative di `/creative` | **auto-scope: SATU papan** (Creative); 5 grup |
| staff Finance di `/finance` | 5 grup, Keuangan terbuka, nol menu Admin/Delivery |

🔴 **Bug yang ketahuan hanya dari screenshot:** accordion-nya **tidak melipat
apa pun**. `aria-expanded="false"` benar, chevron `▸` benar, `hidden` terpasang
— tapi setiap grup "tertutup" tetap memperlihatkan seluruh isinya.

Sebabnya spesifisitas CSS: `[hidden] { display: none }` datang dari stylesheet
**bawaan browser**, dan stylesheet penulis selalu mengalahkannya — jadi
`.navGroupItems { display: flex }` membatalkan atribut `hidden`. Sudah
diperbaiki (`.navGroupItems[hidden] { display: none }`, plus `.navSubItems`
untuk panel sub-grup yang belum berkelas).

**Pelajaran yang layak dibawa:** 534 tes hijau tidak membuktikan UI bekerja.
Suite ini tak punya DOM, jadi penjaganya sekarang mengunci **sebabnya**: dua tes
membaca `Shell.module.css` sebagai teks dan menuntut setiap kelas panel punya
aturan `[hidden]` tandingan. Diverifikasi dengan menghapus aturannya (kedua tes
gagal) lalu dikembalikan (lolos).

---

## 3. Keputusan pemilik yang menahan kode — 6 lama + 2 baru

Enam yang lama tidak berubah (SESI2 §2: SCR-UI-1, LT-2+LT-8, LT-1 sisa,
KS-4/KS-4b, X-12, O65). Dua tambahan sesi ini, keduanya di `DECISIONS.md` bagian
`Open`:

Dua pertanyaan yang lahir dari UAT sesi ini **sudah dijawab pemilik pada hari
yang sama** dan sudah ditindaklanjuti — nol yang menggantung:

| # | Pertanyaan | Jawaban | Tindak lanjut |
|---|---|---|---|
| **O71** | Video tanpa caption: hitung atau buang? | **Hitung**, beri nama `(tanpa caption)` | ✅ dibangun + 3 tes |
| **O70-b** | Ada scan Ads Scanner produksi sebelum 2026-09-04? | **Belum dipakai di aplikasi** | ✅ nol pekerjaan retroaktif |

Yang masih menahan: 6 keputusan lama SESI2 §2, plus pertanyaan navigasi §2
(3 pasang halaman duplikat) yang menahan Sidebar IA v3.

---

## 4. Yang TIDAK dikerjakan sesi ini

Seluruh tabel tiket SESI2 §3 (X-08, CR-12, LT-12/LT-14, O60, O59-b, O48 sisa,
O47b sisa, W2-C2/C3, M15-G3…G7, O7, O8, C-05) **masih terbuka, nol tersentuh**.
Peringatan SESI2 tetap berlaku: **`ls` artefak kodenya dulu sebelum percaya
status "siap"/"belum"** di berkas backlog.

---

## 5. Supabase — TIDAK ada push yang menggantung

Diperiksa langsung ke proyek live `CDPS SG` (`egddxfcnrtecheiykhlf`):

| Gerbang | Live | Repo (hasil `db-rebuild.sh`) | |
|---|---|---|---|
| tabel `public` | 145 | 145 | ✅ |
| `entity_prefix` | 40 | 40 | ✅ |
| `sm_machines` | 31 | 31 | ✅ |
| `notif_events` | 67 | 67 | ✅ |

Migrasi terakhir di ledger live adalah `20260910010000_gelombang4_adsscanner`
(diterapkan sesi lalu), dan itu **berkas terakhir** di `supabase/migrations/`
(172 berkas). Sesi ini **nol** migrasi baru. Jadi: tak ada yang perlu di-push.

**Sekalian menutup satu kebingungan dari handoff SESI2 §1.1**, yang mencatat
"live 146 tabel vs baseline 144/145 — kemungkinan drift kecil". Bukan drift:
`information_schema.tables` **tanpa** filter `table_type` ikut menghitung 1
VIEW (`interview_verdict`). Diukur benar: `pg_tables` = 145 = `base_table` =
145 = repo. Tidak pernah ada drift; itu perbedaan cara menghitung.

Catatan ledger (**O65**, masih terbuka): ledger live punya **178** baris untuk
172 berkas repo, karena baris-baris awal dibuat lewat `apply_migration` dengan
nama yang tidak persis nama berkas (dan ada dua baris `m6a_section_d`).
Skema-nya identik — yang berbeda hanya penamaan riwayat. Itu sebabnya
membandingkan **per nama** akan menyesatkan, dan perbandingan yang benar adalah
lewat empat gerbang di atas.

`get_advisors security` sesudahnya: **nol temuan baru**. Yang ada semuanya
pre-existing dan sudah pernah dicatat — 29 `rls_enabled_no_policy` pada tabel
config yang memang hanya dibaca service-role (pola SENGAJA), view
`interview_verdict` SECURITY DEFINER, 7 `function_search_path_mutable` (WARN),
4 fungsi SECURITY DEFINER yang bisa dieksekusi peran `authenticated`
(`jwt_owns_client_am`, `jwt_owns_interview_am`, `working_days_between`,
`wrr_reaggregate_on_close`), dan proteksi password-bocor GoTrue yang masih mati.

### 5.1 ⚠️ Dua PR masih terbuka — dan #171 menyimpan satu invariant yang HILANG

`list_pull_requests state=open` mengembalikan **dua**, bukan satu:

**PR #281** (draft, 4 Sep) — peta pekerjaan sisa + koreksi 3 backlog basi.
Masih butuh keputusan Nerissa/Yohan: merge, atau tutup sebagai superseded.
Tidak blocking kode.

**PR #171** (BUKAN draft, 15 Agu — **tiga minggu terbuka**) — pengerasan
`SECURITY DEFINER` dari `anon`. Diperiksa sesi ini: **sebagian besar isinya
sudah mendarat lewat jalur lain**, tapi bagian yang paling tahan lama justru
belum.

Sudah ada di `main` (di-rename ke nama ledger live, rekonsiliasi O65):
`20260815094622_harden_job_execute_surface.sql` dan
`20260815105659_harden_secdef_execute_sweep.sql`. Keadaan ACL live **dan** DB
lokal hasil repo sudah sesuai yang PR itu tuju — diprobe langsung:
`wrr_monday_job` / `wrr_reminder_tick` / `penugasan_reminder_tick` /
`wrr_aggregate` tertutup untuk `anon` **dan** `authenticated`;
`jwt_owns_client_am` / `jwt_owns_interview_am` tertutup untuk `anon` tapi tetap
terbuka untuk `authenticated` (wajib — 10 policy `TO authenticated` bergantung
padanya).

**Yang TIDAK mendarat, dan ini yang penting:**

1. **Gerbang invariant `rls_checks.sql` §44** — `grep -c prosecdef
   supabase/tests/rls_checks.sql` = **0**. Artinya **tidak ada apa pun** yang
   mencegah migrasi berikutnya membuka kembali EXECUTE `anon` pada sebuah
   fungsi `SECURITY DEFINER`. Keadaannya benar hari ini; yang tidak ada adalah
   yang menjaganya tetap benar.
2. **Peniruan `ALTER DEFAULT PRIVILEGES` di `scripts/db-rebuild.sh` + `ci.yml`**
   — `grep -c "DEFAULT PRIVILEGES"` = **0** di keduanya.

Butir 2 melemahkan butir 1 lebih jauh, dan ini yang paling mudah salah dibaca:
DB lokal terlihat "sudah aman" **sebagian karena Postgres polos tidak punya
default privileges Supabase sama sekali** — ACL-nya bersih dengan sendirinya.
Jadi kalimat "lokal cocok dengan live" di atas **bukan** bukti gerbangnya
bekerja; justru itu argumen PR #171 sendiri: kelas cacat ini **secara
struktural tidak bisa merah di CI** selama lingkungannya tidak ditiru.

**Rekomendasi** (keputusan pemilik): tutup #171 sebagai superseded untuk bagian
migrasinya, lalu selamatkan dua butir di atas sebagai tiket kecil tersendiri —
bukan merge PR-nya apa adanya, karena basisnya (`5a8483f`) sudah 3 minggu
tertinggal dan dua migrasinya kini akan bentrok dengan nama yang sudah ada.

> ⚠️ Satu koreksi kecil untuk pembaca handoff lama: `working_days_between`
> ditutup dari **`anon`** (migrasi `20260908040000`), **bukan** dari
> `authenticated` — ia masih muncul di advisor. Kalau memang harus ditutup dari
> `authenticated` juga, itu tiket tersendiri, bukan regresi.

---

## 6. Catatan teknis untuk sesi berikutnya

### 6.1 DB lokal wajib bersih sebelum `npm test`

Baris UAT yang ditinggalkan di `clients` membuat 2 tes `portal.test.ts`
(management dashboard, Rule 11) gagal — **bukan** regresi kode. `adsscanner_run`
immutable jadi tak bisa di-`delete`; jalan keluarnya `scripts/db-rebuild.sh --yes`.

### 6.2 Cara menyalakan stack lokal + login TANPA GoTrue live

Ini yang dipakai untuk screenshot §2.1, dan layak diulang:

```bash
pg_ctlcluster 16 main start
su postgres -c "psql -c \"alter user postgres with password 'postgres';\""
scripts/db-rebuild.sh --yes

# API di :3001
cd apps/api && DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps" \
  SUPABASE_JWT_SECRET="<rahasia-lokal-apa-saja>" npx next dev -p 3001

# web-internal di :3000
cd web-internal && BACKEND_URL="http://127.0.0.1:3001" npx next dev -p 3000
```

Login tidak bisa dipakai lokal (`POST /auth/login` menukar kredensial ke GoTrue
**live**). Gantinya: **mint JWT HS256 sendiri** dengan rahasia yang sama, isi
`app_metadata` = `{employee_id, division, level, od, director}` (bentuknya
`permission.actorFromClaims`), lalu pasang sebagai cookie `cdps_access_token`.
Karyawan seed yang berguna: `EMP-0009` (Direktur), `EMP-0002` (AM),
`EMP-0003` (Creative staff), `EMP-0007` (Finance).

Playwright: paket `playwright` di repo mengharap build browser 1234 sementara
sandbox punya 1194 — **jangan** `playwright install`, cukup
`chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })`.

### 6.3 Dua hal lain

- **`npm install` di root DAN di `web-internal`** — dua lockfile terpisah.
- **Ada 1 error eslint PRE-EXISTING** di
  `web-internal/src/app/(shell)/admin/employees/page.tsx:447`
  (`react-hooks/static-components` — `<PositionOptions />` dibuat saat render).
  Gagal juga di tree bersih, **bukan** dari perubahan sesi ini, tapi ia membuat
  `eslint src` merah — jangan salah sangka itu ulah perubahan Anda.
- Export asli klien **tidak** disimpan di repo. Cara mengulang UAT ada di §6
  dokumen UAT.

---

## 7. Kerja berikutnya yang paling jelas

Diurut dari yang paling siap:

1. **Badge angka sidebar (§5.4 IA v3)** — satu-satunya bagian IA v3 yang
   sengaja ditunda. Butuh 4 endpoint hitungan di `apps/api` (Persetujuan, Leads,
   Task Execution, Reminder Pembayaran) yang masing-masing ber-scope peran +
   tes izin, lalu satu hook di rail. Aturannya sudah ditulis di dokumen: scoped
   ke pemakai, sembunyi saat 0, `99+` di atas 99.
2. **Tiket "nol — siap" dari SESI2 §3** — X-08, CR-12, O60, O59-b, O47b sisa.
   Ulangi cek yang menemukan B-03 basi: `ls` artefak kodenya dulu.
3. **Selamatkan dua butir dari PR #171** (§5.1) — gerbang invariant
   `rls_checks` §44 (nol fungsi `SECURITY DEFINER` boleh dieksekusi `anon`,
   dengan daftar putih eksplisit untuk 5 helper predikat RLS) + peniruan
   `ALTER DEFAULT PRIVILEGES` Supabase di `db-rebuild.sh` & `ci.yml`. Nol
   migrasi baru; ini murni gerbang + kesetiaan lingkungan.
4. **6 keputusan pemilik SESI2 §2** yang masih menahan kode (SCR-UI-1,
   LT-2+LT-8, LT-1 sisa, KS-4/KS-4b, X-12, O65).
5. **Gate GO cutover → C-05** (pensiun Go).

## 8. Prompt siap tempel untuk chat berikutnya

> Baca `docs/handoff/HANDOFF_LANJUT_SEMUA_BUILD_SESI3_20260904.md` (dan
> `UAT_TIKTOK_AVITASKIN_20260904.md` kalau menyentuh mesin TikTok). PR #283
> sudah di-merge, jadi `main` sudah memuat semuanya — yang masih menggantung
> hanya **PR #281** (draft, butuh keputusan Nerissa/Yohan). Lalu pilih SATU
> pekerjaan dari §7 —
> **verifikasi dulu ke kode** sebelum menulis apa pun (pola §1.3 SESI2), baca
> PRD terkait penuh, kerjakan dengan tes. Kalau menyentuh UI, **nyalakan stack
> lokal dan lihat hasilnya di browser** (§6.2) — sesi ini membuktikan 534 tes
> hijau tidak membuktikan UI bekerja.
