# HANDOFF — M6A/M6B/M6C Sesi 13 (titik mulai sesi berikutnya)

> Rantai: SESI1 → … → SESI12 → **SESI13 (ini, terbaru)**. Baca yang bernomor
> tertinggi lebih dulu; sesi sebelumnya hanya untuk konteks sejarah.

## 0. CARA MELANJUTKAN DI CHAT BARU — baca ini dulu

| | |
|---|---|
| **Repo** | `MEAgrup/AgencyAPP` |
| **Branch** | **`main`** — mulai cabang BARU dari sini |
| **PR terbuka** | **NIHIL** — semua sudah merge |
| **`main` di** | `ac372e5` (merge PR #113) |

```bash
git fetch origin main && git checkout -B <cabang-baru> origin/main
```

**Semua PR sesi ini sudah ter-merge:** #111 (`af8813e`) → #112 (`66f5710`) →
#113 (`ac372e5`). Tidak ada cabang yang perlu dilanjutkan dan tidak ada commit
yang menggantung — mulai bersih dari `main`.

### 0.1 DB lokal — WAJIB, dan angka test menyesatkan tanpanya

`packages/domain` melaporkan **~670 skip** kalau `DATABASE_URL` tidak di-set.
Itu **bukan** keadaan normal — itu berarti Anda tidak menguji apa pun yang
menyentuh DB. Sandbox punya PostgreSQL 16 tapi **tidak berjalan otomatis** dan
**mati sendiri** setelah beberapa saat (container mereklamasinya — terjadi tiga
kali di sesi ini; ulangi langkah 1 kapan pun `pg_isready` bilang "no response").

```bash
# 1. nyalakan
mkdir -p /var/run/postgresql && chown postgres:postgres /var/run/postgresql
su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D /var/lib/postgresql/16/main \
  -o '-c config_file=/etc/postgresql/16/main/postgresql.conf' \
  -l /var/lib/postgresql/pg.log start"

# 2. HANYA PERTAMA KALI — role postgres tidak punya password, jadi koneksi TCP ditolak
su postgres -c "psql -q -c \"alter role postgres with password 'postgres'\""

# 3. bangun DB dari nol (73 migrasi + seed Alpha Digital + gate + 4 invariant SQL)
npm ci && scripts/db-rebuild.sh --yes

# 4. jalankan
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps" npm test --workspaces --if-present
cd web-internal && npm ci && npm test && npx tsc --noEmit && npx eslint && npm run build
```

`web-internal` **bukan** anggota workspace (root hanya `apps/*` + `packages/*`),
jadi ia butuh `npm ci` dan perintah test sendiri.

⚠️ **Jangan pipe eslint.** `npx eslint | tail` membuat exit code jadi milik
`tail`, dan sesi ini sempat melaporkan "LINT OK" di atas 17 error karenanya.
Jalankan `npx eslint; echo $?`.

### 0.2 Posisi persis

| | |
|---|---|
| Migrasi | **73 berkas** · gerbang tabel **82** · prefix 31 · mesin 16 · event 34 · `CATALOG_VERSION` 4 |
| Test | `web-internal` **191** · `apps/api` **340** · `packages/core` **137** · `packages/db` **15** · `packages/domain` **938 + 1 skip** · lint + typecheck + `next build` bersih · `KNOWN_GAPS` tetap **kosong** |
| Live `CDPS SG` | ✅ **SINKRON** — migrasi A-10 sudah disusul, 12/12 fakta sidik jari cocok. Laporan: `docs/handoff/LIVE_MIGRASI_A10_REPORT_20260809.md` |
| Menggantung | Kode: **NOL**. Keputusan: **X-17 (baru)** · X-16 · O60 · O47b rewrite · O42-b · O59-b · O24 · O45 · X-06 · X-12 |

## 1. Apa yang berubah di sesi ini

Empat commit, dan M6A berpindah dari "mesinnya ada" ke "AM bisa menjalankannya".

| Commit | Isi |
|---|---|
| `b4da86e` | **A-10 bagian 2** — tabel `strategi_field_visibility`, semaian §4.1, endpoint toggle, CHECK berisi delapan ID |
| `f3aa183` | **A-13d** — panel "Visibilitas klien" di halaman Strategi |
| `85961c7` | **A-12 + D-7 + flip D-8** — kontrol yang hidup setelah Strategi jalan |
| — | Migrasi A-10 **disusulkan ke live** `CDPS SG`, diverifikasi lewat isi |

### 1.1 A-10 bagian 2 — CHECK-nya berisi DELAPAN ID, bukan tujuh

Yang paling mudah ditebak salah. §4.1 menyebut **tujuh** field hard-internal;
`ck_strfv_hard_internal` berisi **delapan**. Itu bukan salah ketik.

§7 menuntut set hard-internal ditegakkan dua kali — predikat TS **dan** CHECK DB
— dan melarang keduanya menyimpang. Predikat TS-nya `isHardInternal()` menolak
delapan: ketujuh §4.1 **plus I-4** (hard-internal sementara, X-16). Jadi CHECK
dibangun dari **`hardInternalFieldIds()`**, fungsi yang MENGHITUNG daftarnya dari
peta tier. Drift test membandingkan `pg_get_constraintdef` dengan fungsi itu
**dua arah** — arah tunggal akan meloloskan CHECK yang membekukan field yang TS
izinkan dibagikan, dan AM akan dapat 200 lalu tulisannya gagal di tembok tanpa
satu pun pesan BI di dekatnya.

⚠️ **Kalau X-16 memindahkan I-4 keluar**, biayanya satu `DROP/ADD CONSTRAINT`
**di commit yang sama** dengan perubahan TS-nya. Drift test merah sampai keduanya
bergerak.

### 1.2 A-13d — panel visibilitas

Di-chapter per seksi seperti panel kekurangan. Tiga bentuk yang datang dari PRD:
baris hard-internal **ditampilkan terkunci, bukan disembunyikan**; **satu field
per klik, di luar autosave** (Rule 16(b) menuntut audit-logged, dan log yang
berbunyi "116 field berubah" tidak menjawab pertanyaan yang log itu ada untuk
menjawab); **tier tidak pernah dihitung ulang di FE**.

### 1.3 A-12 + D-7 + flip D-8 — TIGA gerbang status, bukan satu

| Kontrol | Terbuka saat | Kenapa |
|---|---|---|
| D-7 Sanggahan | `Draft` / `Draft Revisi` | argumen tentang target yang sedang DITETAPKAN |
| A-12 buka revisi | **`Aktif` saja** | Rule 13: versi n harus jadi versi aktif yang disetujui sebelum n+1 ada |
| Flip D-8 | seluruh versi hidup | asumsi patah saat eksekusi — justru ketika semua pintu edit tertutup |

Menggabungkan dua saja darinya adalah cara sebuah kontrol muncul di status yang
server tolak, atau hilang di status tempat ia satu-satunya yang menolong. Di
`Aktif`: satu tertutup, dua terbuka. Test memaku `ALL.filter(pred)` per predikat
supaya penggabungan itu merah, bukan diam.

Trigger yang ditawarkan dialog dibatasi ke yang H-2 **deklarasikan** — daftar
global berarti menyodorkan pilihan yang dijamin ditolak.

## 2. ✅ Live `CDPS SG` sekarang SINKRON

Urutan rumah dijalankan apa adanya: merge PR → `apply_migration` → verifikasi
lewat **isi**. Live 81 → **82** tabel; 12 dari 12 fakta sidik jari identik
dengan DB lokal hasil `db-rebuild.sh`, termasuk isi `ck_strfv_hard_internal`
(delapan anggota) dan `anon` yang **tidak** boleh SELECT. Nol temuan advisor
baru. Detail: `docs/handoff/LIVE_MIGRASI_A10_REPORT_20260809.md`.

`strategi` live masih **0 baris**, jadi nol data terdampak.

## 3. 🔴 TUGAS BERIKUTNYA

### 3.1 A-11 (`/s/{token}`) — masih DIBLOKIR X-16, jangan mulai

Halaman klien tidak boleh terbit sebelum keenam tier X-16 benar: di situlah
keputusannya jadi terlihat oleh klien, dan dokumen yang sudah dibaca tidak bisa
di-*un-publish*.

Yang sudah siap untuknya: **`shareableFieldIds()` adalah pintu tunggal.** Filter
§7 yang wajib jalan SEBELUM serialisasi punya tepat satu implementasi. **Jangan
menulis filter kedua di renderer.**

### 3.2 J-4 diff — TIDAK diblokir, tapi baca peringatannya dulu

Sisa terakhir A-12. ⚠️ **J-4 membawa bahaya di luar tier-nya sendiri**: ia
auto-diff atas **seluruh** rekaman, jadi J-4 yang shareable merender perubahan
pada field yang sendirinya hard-internal — misalnya
`D-7 Sanggahan Target: kosong → "target Rp 460jt tidak realistis"`. Bocor lewat
pintu belakang sementara **setiap pemeriksaan per-field tetap hijau**, karena
yang dirender adalah J-4, bukan D-7.

**Generator diff wajib memfilter barisnya sendiri lewat `shareableFieldIds()`**,
apa pun tier yang J-4 dapat. Itu tidak tersirat dari tabel tier.

### 3.3 Section J belum punya form — dan itu sekarang punya konsekuensi

`WIRED` di `page.tsx` berisi A…I. Navigasi mematikan J, jadi **J-1 dan J-4 punya
toggle visibilitas yang tak terjangkau siapa pun**. Panel A-13d menyebutnya di
kaki daftar ("belum terjangkau") alih-alih membiarkannya senyap, tapi itu laporan,
bukan perbaikan. Perbaikannya adalah form Section J — bukan jalur navigasi kedua
yang dibaut ke panel visibilitas.

## 4. 🟡 Keputusan yang menunggu pemilik

### 4.1 X-16 — enam field tak terklasifikasi (SEKARANG LEBIH MENDESAK)

Nilai sementaranya bukan lagi konstanta TS saja: ia sudah jadi **baris tersemai
di setiap Strategi baru** dan **satu anggota di dalam CHECK DB** (I-4), di repo
**dan di live**.

| Field | Isi | Nilai sementara | Rekomendasi |
|---|---|---|---|
| **A-15** | akses & hak per channel | `default_internal` | shareable — argumen sama dengan C-7 yang PRD sudah tetapkan shareable |
| **A-16** | blocker akses + target tanggal | `default_internal` | shareable — yang harus memberi akses adalah klien |
| **I-1** | ringkasan turunan ke kerangka Plan | `default_internal` | shareable |
| **J-1** | versi, status, tanggal submit, AM | `default_internal` | shareable — ini identitas dokumennya |
| **I-4** | catatan per divisi eksekusi | **`hard_internal`** | tetap hard-internal |
| **J-4** | auto-diff vs versi sebelumnya | `default_internal` | tetap internal + filter wajib (§3.2) |

**I-4** = *"hal yang mudah salah dipahami"* untuk divisi kita sendiri. Contoh
realistis: *"Divisi Ads: klien ini tidak mau diskon di bawah 15%, tim sering lupa
dan pasang voucher 20% — cek dua kali."* Dibaca klien, itu daftar kesalahan yang
tim kita berulang di akun mereka. **Ia satu-satunya dari keenam yang sudah masuk
`ck_strfv_hard_internal`**, jadi memindahkannya butuh migrasi.

### 4.2 X-17 — `setAssumptionStatus` tidak punya gerbang status (BARU)

`setAssumptionStatus` di domain memeriksa kepemilikan lalu menulis; `Diarsipkan`
dan `Kedaluwarsa` ikut lolos. Flip ke `Gugur` memicu
`strategi_revisi_disarankan` — jadi jalur yang terbuka adalah notifikasi *"revisi
disarankan"* atas versi yang **sudah digantikan**, pesan yang tidak punya
tindakan benar bagi penerimanya.

**Yang dilakukan sesi ini: UI menyempit** (`canFlipAsumsi` menolak keduanya),
server **tidak** disentuh — melebarkan atau menyempitkan aturan server yang PRD
tidak tuliskan adalah persis "never invent" yang CLAUDE.md larang. Permukaan yang
tersisa hanya API langsung / service-role.

**Pertanyaannya:** apakah domain harus menolak kedua status itu (butuh pesan BI
baru + test), atau flip pada versi arsip punya arti yang belum terlihat?

## 5. Yang masih belum punya UI (dan itu disengaja)

| Field | Keadaan | Catatan |
|---|---|---|
| **E-3…E-10** | ringkasan baca saja | Pilar strategi per jenis aktivitas. **Tidak digerbangi submit** |
| **Section J** | belum ada form | Lihat §3.3 — sekarang punya konsekuensi di panel visibilitas |
| **J-4 diff** | belum ada | §3.2, dan baca peringatannya dulu |

Semuanya lolos `gate-reachability` karena memang bukan syarat submit — guard itu
menjawab *"bisakah Strategi diajukan"*, bukan *"apakah semua fitur terpasang"*.
Jangan baca hijaunya sebagai yang kedua.

## 6. Perintah pertama di chat baru

```bash
npx vitest run src/lib/gate-reachability.test.ts --root apps/api
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps" \
  npx vitest run src/strategi.test.ts --root packages/domain -t "A-10"
cd web-internal && npx vitest run src/lib/strategi-revisi.test.ts
```

Yang pertama merah ⇒ form-nya rusak untuk pengguna **sekarang juga**.
Yang kedua merah pada `does not drift` ⇒ predikat TS dan CHECK DB sudah
menyimpang, dan salah satu arahnya adalah kebocoran ke klien — **dan sekarang
CHECK itu juga hidup di live**, jadi perbaikannya butuh migrasi yang disusulkan.
Yang ketiga merah pada `ALL.filter(pred)` ⇒ tiga gerbang status Rule 13/19 sudah
runtuh jadi satu.
