# HANDOFF — M6A/M6B/M6C Sesi 12 (titik mulai sesi berikutnya)

> Rantai: SESI1 → … → SESI11 → **SESI12 (ini, terbaru)**. Baca yang bernomor
> tertinggi lebih dulu; sesi sebelumnya hanya untuk konteks sejarah.

## 0. CARA MELANJUTKAN DI CHAT BARU — baca ini dulu

| | |
|---|---|
| **Repo** | `MEAgrup/AgencyAPP` |
| **Branch** | **`claude/migrasi-a13c-editor-penyimpanan-64n1oe`** |
| **PR** | **#111** — terbuka, belum merge |
| **Basis** | `1f77e49` (merge PR #110, `main`) |
| **Commit terakhir** | `b4da86e` |

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

# 3. bangun DB dari nol (73 migrasi + seed Alpha Digital + gate + 4 invariant SQL)
npm ci && scripts/db-rebuild.sh --yes

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
| Migrasi | **73 berkas** (72 → 73: `20260809000000_m6a_a10_visibilitas_field.sql`) |
| Gate | tabel **82** (81 → 82) · prefix 31 · mesin 16 · event 34 · `CATALOG_VERSION` 4 · `role_mappings` 12 |
| Test | `web-internal` **158** · `apps/api` **340** · `packages/core` **137** · `packages/db` **15** · `packages/domain` **938 + 1 skip** · lint + typecheck + `next build` bersih · `KNOWN_GAPS` tetap **kosong** |
| Live `CDPS SG` | **Tidak disentuh.** ⚠️ Ada **satu migrasi baru** yang belum disusulkan — lihat §5 |
| Menggantung | Kode: **UI toggle A-10** (§4.2). Keputusan: X-16 · O60 · O47b rewrite · O42-b · O59-b · O24 · O45 · X-06 · X-12 |

## 1. Apa yang berubah di sesi ini

Satu commit: **A-10 bagian 2** — Rule 16 berhenti jadi konstanta dan jadi tabel
dengan tembok.

`b4da86e` mendaratkan `strategi_field_visibility`, semaian §4.1 saat
`createStrategi`, pewarisan saat revisi, `PUT /strategi/{id}/visibilitas`, dan
`shareableFieldIds()` — pintu tunggal yang A-11 akan render lewatnya.

### 1.1 CHECK-nya berisi DELAPAN ID, dan itu yang paling mudah ditebak salah

§4.1 menyebut **tujuh** field hard-internal. `ck_strfv_hard_internal` berisi
**delapan**. Itu bukan salah ketik.

§7 menuntut set hard-internal ditegakkan dua kali — predikat TS **dan** CHECK DB
— dan melarang keduanya menyimpang. Predikat TS-nya adalah `isHardInternal()`,
dan sejak bagian 1 ia menolak delapan: ketujuh anggota §4.1 **plus I-4**, yang
X-16 tinggalkan hard-internal sementara.

Jadi CHECK dibangun dari **`hardInternalFieldIds()`**, fungsi baru yang
MENGHITUNG daftarnya dari peta tier — bukan dari konstanta
`STRATEGI_HARD_INTERNAL`, yang hanya separuh jawaban. CHECK berisi tujuh akan
membiarkan I-4 diterbitkan lewat tulis langsung ke DB sementara TypeScript
bilang tidak.

Drift test-nya membandingkan `pg_get_constraintdef` dengan fungsi itu **dua
arah**. Arah tunggal ("setiap ID TS ada di CHECK") akan meloloskan CHECK yang
MEMBEKUKAN field yang TS izinkan dibagikan: AM mencentang, dapat 200, dan
tulisannya gagal di tembok tanpa satu pun pesan BI di dekatnya.

⚠️ **Kalau X-16 memindahkan I-4 keluar dari hard-internal**, biayanya satu
`DROP/ADD CONSTRAINT` **di commit yang sama** dengan perubahan TS-nya. Drift
test akan merah sampai keduanya bergerak.

### 1.2 Overlay disemai PENUH, ~116 baris per Strategi per versi

§7 menulis "seeded from the §4.1 defaults", dan itu diikuti harfiah. Overlay
jarang (hanya baris yang menyimpang) sebetulnya **tetap benar** di jalur baca —
`visibilitas` selalu dibaca `overlay[id] ?? defaultVisibility(id)`.

Yang dibeli dengan menyemai adalah sifat lain: **dokumen jadi terpaku**. Kalau
default §4.1 sebuah field diubah kelak, Strategi yang sudah disetujui dan sudah
dibaca klien tidak berubah isinya karena sebuah konstanta di-edit. Untuk dokumen
yang tidak bisa di-*un-publish*, "keadaan dokumen saat dibuat" dan "keadaan
aturan hari ini" harus dua hal terpisah.

Konsekuensinya roster field B dan G naik dari test ke modul
(`STRATEGI_SECTION_B_FIELD_IDS`, `..._G_...`, `STRATEGI_FIELD_ROSTER`). **`tierOf`
TIDAK ikut memakai enumerasi itu** — aturan seksi ("all of B") tetap yang
menjawab tier, dan itu penting: entri yang hilang dari roster hanya kehilangan
satu baris SEMAIAN dan tetap jatuh ke default §4.1-nya, sedangkan lubang di
`tierOf` butuh cabang default, dan kedua cabang default adalah bug.

### 1.3 Revisi MEWARISI keputusan berbagi

`copyChildren` membawa overlay beserta `diubah_oleh`/`diubah_pada`. Reset ke
default akan membuat setiap field yang AM bagikan di versi n **padam** begitu
n+1 disetujui — dan Rule 16(c) menyajikan klien dari versi aktif, jadi klien
akan menyaksikan dokumennya menipis tanpa ada yang memutuskan itu. Setelah
menyalin, `seedFieldVisibility` dijalankan lagi dengan `ON CONFLICT DO NOTHING`
untuk menambal field yang §4 dapatkan setelah versi n lahir.

### 1.4 Toggle BUKAN Draft-only

Setiap tulis Section A–I lain adalah Draft-only lewat `requireDraftAndWriter`.
`setFieldVisibility` sengaja tidak: Rule 16(c) menyajikan tampilan klien dari
versi **aktif**, jadi toggle Draft-only berarti satu-satunya cara membagikan satu
field lagi di tengah kontrak adalah membuka revisi — yang Rule 13 buat mahal
dengan sengaja (trigger H-2 + alasan tertulis + asumsi patah) untuk keputusan
yang tidak mengubah apa pun tentang strateginya. Preseden non-Draft yang sudah
ada: `setAssumptionStatus`.

Yang **ditolak** adalah `Diarsipkan` dan `Kedaluwarsa`: visibilitas versi itu
sudah jadi sejarah (Rule 13 "immutable, still readable"), dan mengubahnya berarti
menulis ulang jawaban atas *"apa yang dibagikan pada hari sengketa"*.

Rule 16(a) ditolak **dua arah**: `Internal Saja` atas field hard-internal pun
ditolak walau ia no-op, karena menerimanya menulis sebuah KEPUTUSAN visibilitas
tentang A-10 ke audit log, dan pembaca berikutnya akan wajar menyimpulkan arah
sebaliknya juga tersedia.

## 2. Dua gerbang yang ada bekerja pada pemakaian nyata — dan tidak dilemahkan

**`rls_checks.sql` ledger O48 langsung merah** menuntut entri untuk
`strategi_field_visibility_select`. Itu false-negative yang sudah
terdokumentasi (predikatnya `private.jwt_can_read_strategi`, satu tingkat di
balik SECURITY DEFINER, tempat detektor sintaktik tidak bisa melihat arm
lead/divisi). Yang dilakukan: **masuk ledger + entri `DECISIONS.md`**, persis
preseden A-09b — bukan detektornya yang diubah. Perbaikan sebenarnya tetap
**O60**, dan sengaja tidak dikerjakan di dalam tiket fitur.

**`shape-parity.test.ts` langsung merah** menuntut `web-internal`
mendeklarasikan bentuk respons baru. Itu sebabnya `StrategiFieldVisibility` dan
`setStrategiFieldVisibility()` ada di `web-internal/src/lib/strategi.ts` walau
belum ada halaman yang memanggilnya: guard itu memaksa kontraknya ditulis di
kedua sisi, bukan cuma di yang mengirim.

## 3. Yang TIDAK dikerjakan, dan kenapa

`E-3…E-10`, `D-7 Sanggahan`, flip D-8 `Gugur`, dan `A-12 revisi` masih tanpa
kontrol UI — tidak berubah dari SESI11 §6, dan alasannya masih sama. Ketiganya
lolos `gate-reachability` karena memang bukan syarat submit; guard itu menjawab
*"bisakah Strategi diajukan"*, bukan *"apakah semua fitur terpasang"*.

## 4. 🔴 TUGAS BERIKUTNYA

### 4.1 A-11 (`/s/{token}`) — masih DIBLOKIR X-16, jangan mulai

Halaman klien tidak boleh terbit sebelum keenam tier X-16 benar: di situlah
keputusannya jadi terlihat oleh klien, dan dokumen yang sudah dibaca tidak bisa
di-*un-publish*. Yang sudah siap untuknya: `shareableFieldIds()` adalah satu-
satunya pintu, jadi filter §7 yang wajib jalan **sebelum** serialisasi punya
tepat satu implementasi. Jangan menulis filter kedua di renderer.

### 4.2 A-13d — UI toggle visibilitas. TIDAK diblokir apa pun

Endpoint, tipe FE, dan fungsi pemanggilnya sudah ada; **nol halaman
memanggilnya**, jadi AM belum bisa menyentuh satu toggle pun.

Tiga hal yang akan salah kalau ditebak ulang:

1. **Jangan menghitung ulang tier di FE.** Respons membawa `tier` dan
   `dapat_diubah` sudah jadi. Peta §4.1 salinan ketiga di halaman adalah salinan
   yang paling mungkin melupakan satu field hard-internal — dan itu kebocoran,
   bukan bug tampilan.
2. **`dapat_diubah: false` dirender sebagai baris terkunci, bukan disembunyikan.**
   AM perlu tahu field itu ADA dan tidak pernah dibagikan; menyembunyikannya
   membuat "kenapa klien tidak lihat riwayat agensi" jadi pertanyaan tanpa jawaban
   di layar.
3. **Satu field per panggilan.** Jangan membungkusnya jadi autosave 20 detik yang
   mengirim seluruh overlay: audit log Rule 16(b) ada untuk menjawab *siapa
   memutuskan klien boleh lihat angka margin*, dan baris "116 field berubah"
   tidak menjawabnya.

### 4.3 A-12 revisi (UI) — mesinnya sudah teruji sejak A-04

`openStrategiRevision` nol pemanggil. Diff J-4 belum ada, dan ⚠️ lihat peringatan
J-4 di §5 sebelum membangunnya.

## 5. ⚠️ Satu migrasi belum disusulkan ke live

`20260809000000_m6a_a10_visibilitas_field.sql` ada di repo, **belum** di `CDPS
SG`. Sesi-sesi sebelumnya menetapkan urutannya: **merge PR dulu, baru
`apply_migration`, lalu verifikasi live ≡ repo lewat ISI** (sidik jari
struktural), bukan lewat hitungan tabel. Prosedurnya di SESI9 §5.

Migrasi ini aman disusulkan kapan pun setelah merge — ia hanya `CREATE TABLE`
baru dan nol perubahan atas tabel yang sudah ada, jadi tidak ada CHECK baru yang
bisa menolak baris live yang sudah terlanjur ada.

⚠️ **Strategi yang dibuat SEBELUM migrasi ini tidak punya baris overlay.** Nol
Strategi live hari ini, jadi nol data terdampak — tapi kalau itu berubah,
jalur bacanya `?? defaultVisibility(id)` sudah menanganinya: field tanpa baris
jatuh ke default §4.1-nya, bukan ke lubang.

## 6. 🟡 X-16 — keputusan yang masih menunggu pemilik

Tidak berubah dari SESI11 §5, dan sekarang **lebih mendesak**: nilai
sementaranya bukan lagi hanya konstanta TS, ia sudah jadi baris tersemai di
setiap Strategi baru dan satu anggota di dalam CHECK DB.

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
tim kita berulang di akun mereka. **Ia satu-satunya dari keenam yang sudah masuk
`ck_strfv_hard_internal`**, jadi memindahkannya butuh migrasi (§1.1).

⚠️ **J-4 membawa bahaya di luar tier-nya sendiri.** Ia auto-diff atas **seluruh**
rekaman, jadi J-4 yang shareable merender perubahan pada field yang sendirinya
hard-internal — misalnya `D-7 Sanggahan Target: kosong → "target Rp 460jt tidak
realistis"`. Bocor lewat pintu belakang sementara **setiap pemeriksaan per-field
tetap hijau**, karena yang dirender adalah J-4, bukan D-7. **Tier apa pun yang
J-4 dapat, generator diff wajib memfilter barisnya sendiri** — lewat
`shareableFieldIds()`, bukan lewat daftar sendiri.

## 7. Perintah pertama di chat baru

```bash
npx vitest run src/lib/gate-reachability.test.ts --root apps/api
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps" \
  npx vitest run src/strategi.test.ts --root packages/domain -t "A-10"
```

Yang pertama merah ⇒ form-nya rusak untuk pengguna **sekarang juga**. Yang kedua
merah pada `does not drift` ⇒ predikat TS dan CHECK DB sudah menyimpang, dan
salah satu arahnya adalah kebocoran ke klien.
