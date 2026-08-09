# HANDOFF — M6A/M6B/M6C Sesi 11 (titik mulai sesi berikutnya)

> Rantai: SESI1 → … → SESI10 → **SESI11 (ini, terbaru)**. Baca yang bernomor
> tertinggi lebih dulu; sesi sebelumnya hanya untuk konteks sejarah.
>
> **Sesi ini: A-13c (D-2 · D-8/D-9 · E-12) — gerbang Ajukan akhirnya bisa
> dilewati dari UI.** Sebelum sesi ini **tidak ada satu pun Strategi** yang bisa
> diajukan dari halaman mana pun, karena tiga field wajib tidak punya kotak
> isian. Sekarang bisa, dan itu dibuktikan ujung-ke-ujung, bukan diklaim.
>
> 🟡 **Satu ketidakcocokan PRD↔kode ditemukan dan TIDAK diputus sendiri:** D-4
> ditandai `W` di §4 tapi tidak pernah digerbangi `checkCompleteness` — sudah
> begitu sejak A-08. Editornya dibangun, gerbangnya tidak disentuh, dan
> pertanyaannya dibuka sebagai **X-15**. Lihat §4.

## 0. Posisi persis — VERIFIKASI SEBELUM MENYALIN

| | |
|---|---|
| Branch | `claude/migrasi-a13c-editor-penyimpanan-64n1oe` |
| Basis | `1f77e49` (merge PR #110) |
| Migrasi | **72 berkas — TIDAK BERUBAH.** A-13c murni frontend + tes; nol migrasi, nol perubahan domain, nol perubahan route |
| Gate | tabel 81 · prefix 31 · mesin 16 · event 34 · `CATALOG_VERSION` 4 · `role_mappings` 12 — semuanya tidak disentuh |
| Test | `web-internal` **154** (+26) · `apps/api` **338** (+14) · `packages/core` **118** · `packages/db` **15** · `packages/domain` **919 + 1 skip** · `route-parity` hijau, `KNOWN_GAPS` tetap **kosong** · lint + typecheck + `next build` bersih |
| Live `CDPS SG` | **Tidak disentuh sesi ini** — tidak ada migrasi. Status terakhir terverifikasi: SESI9 §5 |
| Menggantung | Kode: **NOL**. Keputusan yang diwarisi: **X-15 (baru)** · O60 · O47b rewrite · O42-b · O59-b · O24 · O45 · X-06 · X-12 |

> ⚠️ **Test dijalankan dengan DB lokal penuh.** Kalau di sesi Anda `packages/domain`
> melaporkan ~670 skip, itu bukan keadaan normal — itu berarti `DATABASE_URL`
> tidak di-set. Bangun DB-nya (`scripts/db-rebuild.sh --yes`) lalu jalankan dengan
> `DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps"`. Angka di atas
> adalah angka DB-penuh; membandingkan dengan angka skip akan menyesatkan.

## 1. Yang mendarat

Sepuluh dari sepuluh seksi Strategi kini punya pintu masuk. Tapi angka itu bukan
inti sesi ini — **inti sesi ini adalah gerbangnya bisa dilewati**, dan itu
pernyataan yang berbeda (SESI10 §0.1 menulis alasannya).

### 1.1 D-2 — matriks target (`SectionD.tsx`)

Channel × bulan kontrak (M1…Mn), floor (D-1) + stretch (D-2) per sel.

Tiga hal yang akan salah kalau ditebak ulang:

- **Bulan 1-based.** `ck_strtg_month CHECK (month_index BETWEEN 1 AND 36)`.
  Baseline Section B **0-based**. Keduanya memang beda: baseline adalah offset ke
  jendela masa lalu, target adalah bulan kontrak M1.
- **Rule 7 (`stretch >= floor`) TIDAK ditulis ulang di TS.** Ia
  `ck_strtg_stretch_gmv`. Form menampilkan selisihnya di sebelah sel dan tidak
  memblokir ketikan — jawaban PRD atas "stretch di bawah floor" adalah D-7
  Sanggahan Target (Rule 19), bukan aturan klien yang lebih lunak.
- **Sel terisi separuh DILAPORKAN, tidak dikirim, tidak dibuang.** Baris GMV
  tidak bisa ada separuh (`nilai_stretch` NOT NULL + CHECK menuntut floor di
  sebelahnya). Mengirimnya ⇒ autosave gagal tiap 20 detik dan sel yang lengkap
  ikut tidak mendarat. Membuangnya diam-diam ⇒ kelas O43 yang sama persis dengan
  bug F-2/F-3 sesi lalu. Jadi ia dilewati **dan disebut namanya di layar**.

Tombol *"samakan semua bulan dengan M1"* bukan pemanis: X-04 menjangkarkan target
tiap channel ke baseline channel itu sendiri, jadi angka bulanan yang rata adalah
titik awal yang biasa, dan kontrak 12 bulan tanpa itu adalah 24 kotak berisi dua
angka yang sama.

### 1.2 D-8 / D-9 — asumsi (`SectionD.tsx`)

Min 3, tiap asumsi punya kode/asumsi/pemilik/cara verifikasi + pemetaan D-9
sebagai checkbox atas target GMV.

- **Checkbox D-9 diisi dari DRAFT, bukan dari `detail.targets`.** AM mengetik
  matriks dan asumsi di seksi yang sama dan simpan yang sama; picker yang
  bersumber dari data tersimpan akan **kosong sampai simpan pertama** dan AM
  tidak punya cara tahu kenapa.
- **Panel Rule 8 hidup.** `checkCompleteness` melaporkan **satu** baris `Rule 8`
  untuk berapa pun target yang telanjang. Tanpa panel yang menyebut
  *"Shopee · M5, Shopee · M6"*, AM tahu ada yang kurang tapi tidak tahu di mana.
  Perhitungannya ada di `lib/strategi-target.ts` dengan test yang memakukannya ke
  cara server menghitung — satu-satunya tempat di form ini di mana salinan kedua
  aturan server layak dibayar, karena alternatifnya adalah kekurangan yang tidak
  bisa ditemukan AM.

### 1.3 E-12 — ketergantungan klien (`SectionE.tsx`)

Repeatable struct (item, kapan, konsekuensi), min 1.

**Ditempatkan di Section E, bukan Section G** — dokumen `SectionE.tsx` sebelumnya
menulis *"lives in Section G's UI"* dan itu salah: kode kekurangannya `E-12`,
jadi navigasi mengirim AM ke seksi **E**. Editor di G berarti badge di satu bab
dan kotaknya di bab lain. Tetap endpoint sendiri (`/ketergantungan`), tidak
pernah dilipat ke `saveKalender`.

### 1.4 Urutan simpan Section D adalah ATURAN, bukan gaya

```
saveStrategiTargets → saveStrategiAssumptions → saveStrategiKpi
```

`saveAssumptions` menolak **seluruh** panggilan untuk satu referensi D-9 yang
menggantung (`MSG_ASSUMPTION_TARGET_UNKNOWN`). Jadi target harus mendarat lebih
dulu, dan asumsi yang menyusul hanya boleh menunjuk yang **benar-benar mendarat** —
sel separuh-terisi tidak, itulah kenapa `pruneTargetTerkait` dijalankan terhadap
`offerableTargetKeys(draft)` dan bukan terhadap seluruh grid.

Ini jebakan yang sama dengan Section B (channels dulu, baru baseline, karena id
channel lahir di respons pertama). Sekarang tertulis di kepala `page.tsx`.

## 2. 🟢 Tiga guard baru — dua untuk kelas cacat yang lolos A-13b

### 2.1 `apps/api/src/lib/gate-reachability.test.ts`

**Ini guard yang seharusnya ada sebelum A-13b.**

Tiap kode yang `checkCompleteness` bisa keluarkan wajib punya baris di `DOORS`
yang menyebut fungsi FE penjawabnya, **dan** fungsi itu wajib punya pemanggil di
`web-internal/src` di luar berkas definisinya.

**Diverifikasi secara NEGATIF, bukan diasumsikan:** `page.tsx` dikembalikan ke
versi A-13b, dan test-nya merah sambil menyebut ketiganya per nama —
`saveStrategiAssumptions, saveStrategiKetergantungan, saveStrategiTargets`.

Kenapa `route-parity` tidak bisa menangkapnya: ia berangkat dari panggilan yang
FE **sudah** buat. Path yang tidak dipanggil siapa pun tidak terlihat olehnya —
sementara bagi pengguna itu justru fatal.

⚠️ **Kalau ia merah, jangan hapus barisnya.** Merah berarti salah satu dari dua:
gerbang baru tanpa pintu (⇒ field-nya tidak bisa dijawab, itu bug-nya), atau
pintu tanpa pemanggil (⇒ pasang form-nya). Menghapus baris untuk menghijaukan
akan membuat ulang lubang yang persis ini dibangun untuk menutup.

### 2.2 `apps/api/src/lib/wire.strategi-sectiond.test.ts`

**`body-parity` hanya memeriksa kunci TOP-LEVEL.** Ketiga body A-13c adalah satu
kunci membungkus ARRAY struct (`{ targets: [...] }`), jadi body-parity
membuktikan tepat satu hal: kata `targets` muncul di kedua sisi. Setiap field
yang benar-benar membawa jawaban — `month_index`, `nilai_floor`,
`cara_verifikasi`, `target_terkait`, `konsekuensi` — ada satu lapis di bawah,
tempat tidak ada yang melihat.

Itu lebih berbahaya di sini daripada di body datar: `*FromWire` membaca kunci
yang hilang lewat `str()` / `Number(x ?? 0)`, jadi kunci salah eja **tidak**
melempar dan **tidak** tiba sebagai `undefined` — ia tiba sebagai `''` atau `0`,
yaitu permintaan lain yang tampak sah. `month_index` yang terbaca `0` gagal di
pemeriksaan rentang domain dengan `[data tidak lengkap …]`: pesan yang menyebut
masalah yang salah dan mengirim AM memeriksa kotak yang sudah benar mereka isi.

### 2.3 `web-internal/src/lib/strategi-target.ts` + test

Logika yang membawa aturan dipisah dari JSX (pola `strategi-sections.ts` /
`nav.ts`), 26 test. Yang dipakukan: format kunci target
`metric:channel:monthIndex` sebagai string harfiah (kalau ia melenceng dari
`targetKey` di `packages/domain`, **setiap** pemetaan D-9 ditolak dan tidak ada
hal lain yang gagal lebih dulu), perhitungan cakupan Rule 8, dan perlakuan sel
separuh-terisi.

### 2.4 Perbaikan kecil dengan akibat besar: `sectionOf('Rule 8')`

Dulu jatuh ke `lain`, tempat halaman menulis *"tidak dikenali seksinya — laporkan
ke tim sistem"*. Untuk kekurangan yang diperbaiki dengan **mencentang satu
checkbox dua kartu di atasnya.** Sekarang dipetakan ke D lewat
`KODE_SECTION_OVERRIDE` — daftar untuk kode yang server memang keluarkan tanpa
field ID, **bukan** tempat menambal kode yang seharusnya punya satu (`Z-9` tetap
ke `lain`, sengaja).

## 3. Bukti "selesai" — dan kenapa bentuknya begini

Backlog menulis: *"Selesai = `submitStrategi` menjawab 200 atas fixture Alpha
Digital, bukan tiga form terpasang"*.

Yang dijalankan: fixture Alpha Digital (`seedSubmittable`), lalu Section D dan
E-12 dibangun ulang lewat **fungsi transformasi FE yang sungguhan** —
`gmvGridOf` → `gmvCellsToBody` → `assumptionsToBody` → `pruneTargetTerkait` —
diimpor langsung dari `web-internal/src/lib/strategi-target.ts` ke dalam harness
domain. Termasuk dua kasus yang justru jadi intinya:

- satu sel sengaja diisi separuh ⇒ tidak dikirim, dan `checkCompleteness` tetap
  menjawab `[]` (gerbang D-2 adalah "≥1 target GMV per channel", bukan per bulan);
- satu kunci D-9 basi (`gmv:Lazada:99`) ⇒ dipangkas, karena tanpa itu **seluruh**
  panggilan asumsi ditolak.

Hasil: `checkCompleteness` → `[]`, `submitStrategi` → **`Diajukan`**.

**Test itu TIDAK di-commit, dan itu disengaja.** Ia mengimpor `web-internal` dari
`packages/domain`, yang membalik arah ketergantungan — paket domain tidak boleh
tahu frontend ada. Sebagai verifikasi sekali jalan ia benar; sebagai berkas
permanen ia adalah aturan arsitektur yang dilanggar. Yang di-commit adalah tiga
guard di §2, yang menjaga hal yang sama dari sisi yang benar.

Kalau Anda ingin menjalankannya lagi, bentuknya ada di riwayat sesi ini: tempel
blok `describeDb` ke ekor `packages/domain/src/strategi.test.ts`, jalankan
`-t "A-13c"`, lalu `git checkout` berkasnya.

## 4. 🟡 X-15 — D-4 wajib di atas kertas, opsional di mesin

§4 menandai D-4 (target metrik pendukung per channel) `W`, sama seperti D-2, D-5,
D-6, D-8 — yang semuanya punya baris di gerbang submit. **D-4 tidak punya**, dan
sudah begitu sejak A-08. Jadi hari ini sebuah Strategi bisa diajukan **dan
disetujui** tanpa satu pun target metrik pendukung.

Yang dilakukan sesi ini: **editornya dibangun** (sebelumnya nol input di mana pun,
jadi field `W` ini tidak bisa dijawab sama sekali), **gerbangnya tidak disentuh**.

Kenapa tidak diputus sendiri: menambah gerbang mengubah apa yang membuat sebuah
Strategi sah. Setiap Strategi yang lolos hari ini berhenti lolos, `seedSubmittable`
dan sepuluh test yang bersandar padanya jadi merah, dan aturan rumah melarang
memilih diam-diam saat PRD dan kode berselisih.

Detail dua bacaan yang sah ada di `docs/DECISIONS.md` → Open → **X-15**. Satu
catatan yang mempersempit pilihan dan layak dibaca sebelum menjawab: D-6 memakai
**kosakata yang sama** dan dibatasi maks 5 dengan alasan eksplisit *"kalau
semuanya dipantau, tidak ada yang dipantau"* — logika yang sama menentang
mewajibkan sepuluh metrik D-4.

## 5. Yang masih belum punya editor (dan itu disengaja)

| Field | Keadaan | Catatan |
|---|---|---|
| **E-3…E-10** | ringkasan baca saja | Pilar strategi per jenis aktivitas — struct kaya, ruang lingkupnya sendiri. **Tidak digerbangi submit**, jadi ia tidak memblokir apa pun hari ini |
| **D-7 Sanggahan** | baca saja | `raiseStrategiSanggahan` masih nol pemanggil. `O` (opsional), jadi bukan gerbang — tapi ia satu-satunya jalur Rule 19 dan AM belum bisa mengajukannya |
| **flip D-8 `Gugur`** | belum ada kontrol | `setStrategiAssumptionStatus` nol pemanggil. **Sengaja tidak di form ini**: ia bisa dijangkau saat `Aktif`, satu-satunya tulis Section D yang bukan Draft-only, karena asumsi gugur saat EKSEKUSI. Rumahnya bukan form draft |
| **A-12 revisi** | belum ada kontrol | `openStrategiRevision` nol pemanggil |

Ketiga yang terakhir **lolos `gate-reachability`** karena memang bukan syarat
submit — guard itu menjawab "bisakah Strategi diajukan", bukan "apakah semua
fitur terpasang". Jangan baca hijaunya sebagai yang kedua.

## 6. Tugas berikutnya

**A-10 / A-11 / A-12** sekarang tidak lagi terhalang: prasyaratnya adalah
"ada Strategi yang bisa mencapai `Diajukan` dari UI", dan itu sudah benar.

Sebelum mulai apa pun di M6A, jalankan dulu:

```
npx vitest run src/lib/gate-reachability.test.ts --root apps/api
```

Kalau ia merah, form-nya rusak untuk pengguna sekarang juga, dan itu didahulukan
di atas tiket apa pun yang sedang Anda pegang.
