# HANDOFF — M6A/M6B/M6C Sesi 11 (titik mulai sesi berikutnya)

> Rantai: SESI1 → … → SESI10 → **SESI11 (ini, terbaru)**. Baca yang bernomor
> tertinggi lebih dulu; sesi sebelumnya hanya untuk konteks sejarah.

## 0. CARA MELANJUTKAN DI CHAT BARU — baca ini dulu

| | |
|---|---|
| **Repo** | `MEAgrup/AgencyAPP` |
| **Branch** | **`claude/migrasi-a13c-editor-penyimpanan-64n1oe`** |
| **PR** | **#111** — terbuka, belum merge |
| **Basis** | `1f77e49` (merge PR #110, `main`) |
| **Commit terakhir** | `f0da5eb` |

```bash
git fetch origin claude/migrasi-a13c-editor-penyimpanan-64n1oe
git checkout claude/migrasi-a13c-editor-penyimpanan-64n1oe
```

> ⚠️ **Kalau PR #111 sudah ter-merge saat Anda membaca ini**, jangan menumpuk
> commit di atasnya. Mulai ulang dari `main`:
> `git fetch origin main && git checkout -B <branch-baru> origin/main`.

### 0.1 DB lokal — WAJIB, dan angka test menyesatkan tanpanya

`packages/domain` melaporkan **~670 skip** kalau `DATABASE_URL` tidak di-set.
Itu **bukan** keadaan normal — itu berarti Anda tidak menguji apa pun yang
menyentuh DB. Sandbox punya PostgreSQL 16 tapi **tidak berjalan otomatis** dan
**mati sendiri** setelah beberapa saat (container mereklamasinya).

```bash
# 1. nyalakan (ulangi kapan pun `pg_isready` bilang "no response")
mkdir -p /var/run/postgresql && chown postgres:postgres /var/run/postgresql
su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D /var/lib/postgresql/16/main \
  -o '-c config_file=/etc/postgresql/16/main/postgresql.conf' \
  -l /var/lib/postgresql/pg.log start"

# 2. HANYA PERTAMA KALI — role postgres tidak punya password, jadi koneksi TCP ditolak
su postgres -c "psql -q -c \"alter role postgres with password 'postgres'\""

# 3. bangun DB dari nol (72 migrasi + seed Alpha Digital + gate + 4 invariant SQL)
scripts/db-rebuild.sh --yes

# 4. jalankan
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps" npm test --workspaces --if-present
cd web-internal && npm ci && npm test && npx tsc --noEmit && npx eslint && npm run build
```

`web-internal` **bukan** anggota workspace (root hanya `apps/*` + `packages/*`),
jadi ia butuh `npm ci` dan perintah test sendiri. Melewatkannya adalah cara
paling gampang mengira semuanya hijau.

### 0.2 Posisi persis

| | |
|---|---|
| Migrasi | **72 berkas — TIDAK BERUBAH** sepanjang sesi ini. Nol migrasi di A-13c, X-15 maupun A-10 bagian 1 |
| Gate | tabel 81 · prefix 31 · mesin 16 · event 34 · `CATALOG_VERSION` 4 · `role_mappings` 12 — semuanya tidak disentuh |
| Test | `web-internal` **158** · `apps/api` **338** · `packages/core` **134** · `packages/db` **15** · `packages/domain` **922 + 1 skip** · lint + typecheck + `next build` bersih · `KNOWN_GAPS` tetap **kosong** |
| Live `CDPS SG` | **Tidak disentuh** — tidak ada migrasi. Status terakhir terverifikasi: SESI9 §5 |
| Menggantung | Kode: **NOL**. Keputusan: **X-16 (baru, butuh pemilik)** · O60 · O47b rewrite · O42-b · O59-b · O24 · O45 · X-06 · X-12 |

## 1. Apa yang berubah di sesi ini

Tiga commit, satu tema: **halaman Strategi berhenti jadi form yang tidak bisa
dikirim.**

| Commit | Isi |
|---|---|
| `96648a8` | **A-13c** — D-2 matriks target, D-8/D-9 asumsi, E-12 ketergantungan + tiga guard baru |
| `0de8b7b` | **A-10 bagian 1** — peta visibilitas §4.1 sebagai peta TOTAL di `packages/core` |
| `f0da5eb` | **X-15 dieksekusi** — gerbang ringan D-4 (keputusan pemilik) |

### 1.1 A-13c — gerbang Ajukan akhirnya bisa dilewati

Sebelum sesi ini **tidak ada satu pun Strategi** yang bisa diajukan dari halaman
mana pun: D-2, D-8 dan E-12 adalah syarat submit yang tidak punya kotak isian.
Sembilan seksi punya pintu, gerbangnya tetap mustahil.

Empat hal yang akan salah kalau ditebak ulang:

- **Bulan target 1-based**, baseline Section B 0-based. Memang beda: baseline
  adalah offset ke jendela masa lalu, target adalah bulan kontrak M1.
- **Rule 7 (`stretch >= floor`) tidak ditulis ulang di TS** — ia
  `ck_strtg_stretch_gmv`. Form menampilkan selisihnya dan tidak memblokir
  ketikan; jawaban PRD atas stretch di bawah floor adalah **D-7 Sanggahan**.
- **Sel GMV terisi separuh dilaporkan, tidak dikirim, tidak dibuang.** Baris GMV
  tak bisa ada separuh. Mengirimnya ⇒ autosave gagal tiap 20 detik dan sel yang
  lengkap ikut tidak mendarat. Membuangnya ⇒ kelas O43, sama persis dengan bug
  F-2/F-3 sesi lalu.
- **Urutan simpan Section D adalah ATURAN:** `targets → assumptions → kpi`.
  `saveAssumptions` menolak **seluruh** panggilan untuk satu referensi D-9 yang
  menggantung, dan sel separuh-terisi menghasilkan referensi menggantung persis
  begitu. Itu sebabnya `pruneTargetTerkait` dijalankan terhadap
  `offerableTargetKeys(draft)`, bukan terhadap seluruh grid.

E-12 ditempatkan di **Section E**, bukan Section G seperti dokumen komponen
sempat klaim: kode kekurangannya `E-12`, jadi navigasi mengirim AM ke E.

### 1.2 X-15 — gerbang ringan D-4 (KEPUTUSAN PEMILIK, sudah dieksekusi)

Pemilik: *"D-4 buat gerbang ringan"*. Gerbangnya **minimal satu target metrik
pendukung per channel** — bukan matriks penuh.

Sebelumnya §4 menandai D-4 `W` tapi tidak ada yang memeriksanya sejak A-08, jadi
Strategi bisa diajukan **dan disetujui** tanpa satu pun metrik pendukung. Saat
GMV meleset 30% di bulan ketiga, tidak ada angka untuk diuji — kegagalan yang
M6A §2 (c) sebut sendiri.

Kenapa satu dan bukan matriks: 9 metrik × n bulan × n channel = **108 kotak**
pada kontrak 6 bulan 2 channel, dan field wajib seharga 108 kotak diisi dengan
menyalin satu angka ke bawah. PRD beralasan identik atas kosakata yang **sama**
satu field sebelumnya — D-6 dibatasi maks 5 karena *"kalau semuanya dipantau,
tidak ada yang dipantau"*.

**Dua hal tersingkap saat mengeksekusinya, keduanya sehat:**

1. `gate-reachability.test.ts` **langsung merah** menuntut baris `DOORS` untuk
   `D-4`. Guard yang dibangun beberapa jam sebelumnya bekerja persis sebagaimana
   dirancang pada pemakaian nyata pertamanya.
2. Assertion Rule 13 `expect(copied.targets).toHaveLength(1)` jadi basi. Diubah
   memeriksa **metrik** (`['cr','gmv']`) bukan hitungan — yang penting adalah
   revisi tidak lahir dengan kekurangan D-4 di hari pertama, yang akan terjadi
   kalau `copyChildren` hanya membawa `gmv`.

### 1.3 A-10 bagian 1 — peta visibilitas

`packages/core/src/visibility.ts`. Set hard-internal (7 field) dan set
togglable (6 field) dari §4.1, dipaku member-per-member oleh test.

**`tierOf` sengaja TOTAL — tidak ada cabang default.** Itu properti keamanannya:
peta berlubang butuh fallback, dan **kedua** fallback adalah bug. Jatuh ke
*shareable* menerbitkan field yang tak pernah diklasifikasi ke klien; jatuh ke
*internal* membuat field baru hilang diam-diam dari dokumen klien sampai ada
klien bertanya kenapa deknya menipis. Test gagal **menyebut nama** field yang
belum bertier. Jangan tambahkan cabang default supaya ia berhenti merah.

Filter hard-internal diterapkan **terakhir dan tanpa syarat**: overlay adalah
tabel yang AM tulis, jadi baris yang mengaku `A-10` shareable adalah data untuk
diabaikan, bukan instruksi untuk dipatuhi.

## 2. Tiga guard baru — dan kenapa dua di antaranya ada

### 2.1 `apps/api/src/lib/gate-reachability.test.ts`

Tiap kode yang `checkCompleteness` bisa keluarkan wajib punya baris `DOORS` yang
menyebut fungsi FE penjawabnya, **dan** fungsi itu wajib punya pemanggil di luar
`lib/strategi.ts`.

**Diverifikasi negatif:** `page.tsx` dikembalikan ke versi A-13b ⇒ merah, menyebut
`saveStrategiAssumptions, saveStrategiKetergantungan, saveStrategiTargets` per
nama. `route-parity` tidak bisa melihat ini — ia berangkat dari panggilan yang FE
**sudah** buat, jadi path yang tidak dipanggil siapa pun tak terlihat olehnya.

⚠️ **Kalau merah, jangan hapus barisnya.** Merah = gerbang baru tanpa pintu
(⇒ field tidak bisa dijawab) atau pintu tanpa pemanggil (⇒ pasang form-nya).

### 2.2 `apps/api/src/lib/wire.strategi-sectiond.test.ts`

`body-parity` hanya memeriksa kunci **top-level**. Ketiga body A-13c adalah satu
kunci membungkus ARRAY struct, jadi setiap field yang membawa jawaban
(`month_index`, `cara_verifikasi`, `target_terkait`, `konsekuensi`) ada satu
lapis di bawah, tempat tidak ada yang melihat. Berbahaya di sini karena
`*FromWire` membaca kunci hilang lewat `str()` / `Number(x ?? 0)`: kunci salah
eja tiba sebagai `''` atau `0`, yaitu **permintaan lain yang tampak sah**.

### 2.3 `web-internal/src/lib/strategi-target.ts` + test

Logika yang membawa aturan dipisah dari JSX (pola `strategi-sections.ts`), 30
test. Memaku format kunci target `metric:channel:monthIndex` ke string harfiah,
perhitungan cakupan Rule 8, cermin gerbang D-4, dan perlakuan sel separuh-terisi.

Ditambah perbaikan kecil berakibat besar: `sectionOf('Rule 8')` dulu jatuh ke
`lain`, tempat halaman menulis *"tidak dikenali seksinya — laporkan ke tim
sistem"* untuk kekurangan yang diperbaiki dengan **mencentang satu checkbox**.

## 3. Bukti "gerbang bisa dilewati" — dan kenapa bentuknya begini

Fixture Alpha Digital, lalu Section D dan E-12 dibangun ulang lewat **fungsi
transformasi FE yang sungguhan** (`gmvGridOf` → `gmvCellsToBody` →
`assumptionsToBody` → `pruneTargetTerkait`), diimpor langsung dari
`web-internal/src/lib/strategi-target.ts` ke harness domain. Termasuk dua kasus
yang jadi intinya: satu sel sengaja separuh terisi, dan satu kunci D-9 basi.

Hasil: `checkCompleteness` → `[]`, `submitStrategi` → **`Diajukan`**.

**Test itu TIDAK di-commit, dan itu disengaja** — ia mengimpor `web-internal` dari
`packages/domain`, membalik arah ketergantungan. Sebagai verifikasi sekali jalan
ia benar; sebagai berkas permanen ia aturan arsitektur yang dilanggar. Yang
di-commit adalah tiga guard di §2, yang menjaga hal yang sama dari sisi benar.

Untuk mengulanginya: tempel blok `describeDb` ke ekor
`packages/domain/src/strategi.test.ts`, jalankan `-t "A-13c"`, lalu
`git checkout` berkasnya.

## 4. 🔴 TUGAS BERIKUTNYA

### 4.1 A-10 bagian 2 — TIDAK diblokir apa pun, kerjakan ini dulu

Sisa A-10 setelah peta konstantanya mendarat:

1. **Migrasi** `STRG_FIELD_VISIBILITY` (`strategi_id`, `field_id`, `visibilitas`,
   `diubah_oleh`, `diubah_pada`) — tabel **81 → 82**, dan ingat gerbang hitungan
   tabel ada di **DUA** berkas: `.github/workflows/ci.yml` **dan**
   `scripts/db-rebuild.sh`. Menaikkan satu saja = seluruh test hijau sementara CI
   merah (kesalahan yang sudah terjadi sekali, lihat komentar di ci.yml).
2. **CHECK DB yang mencerminkan set hard-internal.** §7 menyebutnya invariant
   beku: predikat TS dan CHECK tidak boleh menyimpang. Pola yang sudah ada dan
   harus diikuti: `ck_strategi_leading_indicator` (keanggotaan set tertutup lewat
   `<@`), plus test SQL yang membandingkan **isi** CHECK dengan konstanta TS —
   `A-09b closed sets do not drift` di `strategi.test.ts` adalah contohnya.
3. **Endpoint toggle** + audit (Rule 16 menuntut toggle-nya audit-logged), dengan
   penolakan hard-internal di domain **dan** di CHECK.
4. Seed overlay saat `createStrategi` dari `defaultVisibility`.

### 4.2 A-11 (`/s/{token}`) — DIBLOKIR X-16, jangan mulai

Halaman klien tidak boleh terbit sebelum keenam tier X-16 benar: di situlah
keputusannya jadi terlihat oleh klien, dan dokumen yang sudah dibaca tidak bisa
di-*un-publish*.

## 5. 🟡 X-16 — keputusan yang masih menunggu pemilik

§4.1 membantah dirinya sendiri: baris ketiga berbunyi *"everything else"* lalu
**mendaftar** apa yang dimaksud, dan enam field ID tidak ada di daftar mana pun.

| Field | Isi | Nilai sementara | Rekomendasi |
|---|---|---|---|
| **A-15** | akses & hak per channel | `default_internal` | shareable — argumen sama dengan C-7 yang PRD sudah tetapkan shareable |
| **A-16** | blocker akses + target tanggal | `default_internal` | shareable — yang harus memberi akses adalah klien |
| **I-1** | ringkasan turunan ke kerangka Plan | `default_internal` | shareable |
| **J-1** | versi, status, tanggal submit, AM | `default_internal` | shareable — ini identitas dokumennya |
| **I-4** | catatan per divisi eksekusi | **`hard_internal`** | tetap hard-internal — lihat bawah |
| **J-4** | auto-diff vs versi sebelumnya | `default_internal` | tetap internal + filter wajib — lihat bawah |

**I-4** = *"hal yang mudah salah dipahami"* untuk divisi kita sendiri. Contoh
realistis: *"Divisi Ads: klien ini tidak mau diskon di bawah 15%, tim sering lupa
dan pasang voucher 20% — cek dua kali."* Dibaca klien, itu daftar kesalahan yang
tim kita berulang di akun mereka.

⚠️ **J-4 membawa bahaya di luar tier-nya sendiri.** Ia auto-diff atas **seluruh**
rekaman, jadi J-4 yang shareable merender perubahan pada field yang sendirinya
hard-internal — misalnya `D-7 Sanggahan Target: kosong → "target Rp 460jt tidak
realistis"`. Bocor lewat pintu belakang sementara **setiap pemeriksaan per-field
tetap hijau**, karena yang dirender adalah J-4, bukan D-7. **Tier apa pun yang
J-4 dapat, generator diff wajib memfilter barisnya sendiri.** Itu tidak tersirat
dari tabel tier dan tidak boleh dianggap otomatis.

## 6. Yang masih belum punya editor (dan itu disengaja)

| Field | Keadaan | Catatan |
|---|---|---|
| **E-3…E-10** | ringkasan baca saja | Pilar strategi per jenis aktivitas. **Tidak digerbangi submit**, jadi tidak memblokir apa pun |
| **D-7 Sanggahan** | baca saja | `raiseStrategiSanggahan` nol pemanggil. `O`, jadi bukan gerbang — tapi ia satu-satunya jalur Rule 19 |
| **flip D-8 `Gugur`** | belum ada kontrol | `setStrategiAssumptionStatus` nol pemanggil. **Sengaja tidak di form ini**: ia bisa dijangkau saat `Aktif`, satu-satunya tulis Section D yang bukan Draft-only |
| **A-12 revisi** | belum ada kontrol | `openStrategiRevision` nol pemanggil |

Ketiganya **lolos `gate-reachability`** karena memang bukan syarat submit — guard
itu menjawab *"bisakah Strategi diajukan"*, bukan *"apakah semua fitur
terpasang"*. Jangan baca hijaunya sebagai yang kedua.

## 7. Perintah pertama di chat baru

```bash
npx vitest run src/lib/gate-reachability.test.ts --root apps/api
```

Kalau merah, form-nya rusak untuk pengguna **sekarang juga**, dan itu didahulukan
di atas tiket apa pun yang sedang Anda pegang.
