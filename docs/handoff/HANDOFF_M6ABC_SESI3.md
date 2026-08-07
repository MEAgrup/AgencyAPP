# HANDOFF — M6A/M6B/M6C Sesi 3 (titik mulai sesi berikutnya)

> **Konteks:** lanjutan `HANDOFF_M6ABC_SESI2.md`. Sesi ini mengerjakan **A-05**
> (Section A — Konteks Klien & Bisnis, 16 field + matriks akses A-15/A-16) dan
> **A-06** (Section B grup B-2…B-9 per channel).
>
> Berkas SESI1 dan SESI2 **tetap berlaku** dan tidak digantikan:
> SESI1 §4 (PR #98 memblokir `db push`) & §5 (cara mengulang walk HTTP + dua
> jebakannya), SESI2 §3 (yang belum tersambung), §5 (O54–O57), §6 (tiga jebakan).
> Yang di bawah hanya menambah — **dan mengoreksi satu hal**: SESI2 §4 menyebut
> gate jumlah tabel hidup di dua tempat; itu masih benar, dan sesi ini menaikkan
> keduanya sekaligus (68 → **69**) plus memasang komentar saling-menyebut di
> kedua berkas supaya kelas kesalahan itu tidak lahir untuk ketiga kalinya.

## 0. Posisi persis — SALIN INI KE SESI BERIKUTNYA

| | |
|---|---|
| **Branch kerja** | `claude/ci-gates-db-migrations-101jt4` (dicabangkan dari tip PR #101, yang **belum** mendarat di `main`) |
| **PR sebelumnya** | **#101** masih TERBUKA (`mergeable_state: clean`, semua check hijau di `ece2a4c`). Sesi ini menumpuk DI ATASNYA, bukan menggantinya |
| **Migrasi** | **59 berkas** lokal. **7 BARU belum diterapkan ke live `CDPS SG`** — 3 sesi 1 + 2 sesi 2 + 2 sesi ini |
| **Tabel** | **69** lokal (dari 68). +`strategi_akses`. A-06 hanya menambah KOLOM |
| **`sm_machines`** | **16 — TIDAK disentuh** |
| **`notif_events`** | **17 — TIDAK disentuh.** 13 event M6A/6B/6C masih belum ada (O55) |
| **Test** | api 324 · core 113 · db 15 · domain **784** (+1 skip) · web-internal 116. Semua hijau |
| **Build** | `npm run build --prefix web-internal` EXIT 0 |
| **Walk HTTP** | **42/42** lewat route nyata (`apps/api` :3111) |

**Perintah untuk melanjutkan:**

```bash
git fetch origin main
git checkout claude/ci-gates-db-migrations-101jt4
npm install
service postgresql start
su postgres -c "psql -c \"ALTER USER postgres WITH PASSWORD 'postgres';\""
npm run db:rebuild -- --yes
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps" npm test --workspaces --if-present
npx vitest run --root web-internal      # TERPISAH — bukan anggota `workspaces`
```

---

## 1. Yang SELESAI sesi ini

### A-05 — Section A + A-15/A-16 (`20260806065000_m6a_section_a.sql`)

**Section A adalah 20 KOLOM di `strategi`, bukan tabel.** §4 menyatakan ia diisi
sekali per Strategi ("Filled once, not per channel"). Yang menjadi tabel sendiri
hanya A-15 — satu-satunya bagian Section A yang berbentuk MATRIKS.

Tiga hal yang bukan detail:

1. **A-16 BUKAN tabel kedua.** Ia flag `memblokir` + `target_tanggal_beres` pada
   baris A-15 yang diblokirnya, dijaga CHECK: memblokir hanya sah kalau
   statusnya bukan `sudah` DAN ada tanggalnya. Dua tabel berarti pasangan
   `(channel, akses)` tersimpan dua kali dan bisa berselisih — dan blocker yang
   tidak menunjuk baris akses mana pun adalah blocker yang tidak bisa dibereskan
   siapa pun. Tanpa tanggal, "memblokir" adalah keluhan; dengan tanggal ia
   pekerjaan yang bisa jatuh tempo dan muncul di dashboard SPV (§5 langkah 3).
2. **`channel = 'Umum'`.** A-15 menyebut lima akses "per channel", tapi akses
   gudang/stok bukan milik channel mana pun. Tanpa `Umum`, ia harus dicatat di
   bawah channel yang dikarang dan matriksnya berbohong tentang apa yang
   diblokir. Channel selain `Umum` **wajib** salah satu channel kontrak Strategi
   itu (divalidasi domain) — akses ke channel yang tidak dijual adalah blocker
   yang tidak akan pernah dibereskan.
3. **Taksonomi tertutup dijaga containment jsonb (`<@`), bukan subquery.**
   CHECK Postgres **tidak boleh** mengandung subquery, jadi
   `NOT EXISTS (select … jsonb_array_elements_text …)` bukan pilihan yang ada.

### A-06 — Section B grup B-2…B-9 (`20260806066000_m6a_section_b.sql`)

±45 kolom di `strategi_channel` (satu angka per channel; yang per bulan tetap
baris di `strategi_baseline_bulan`, A-03).

Tiga bentuk yang perlu diketahui sebelum menyentuh kode ini:

1. **Komposisi trafik B-2.3 = ENAM KOLOM, bukan satu jsonb.** §7 mewajibkan CHECK
   "berjumlah 100 ±0,5". Dengan jsonb, kunci yang HILANG membuat
   `(t->>'organik')::numeric` NULL, seluruh ekspresi NULL, dan CHECK ber-NULL
   **LOLOS** — gate-nya akan diam persis pada input yang cacat. Ditegakkan
   "semua enam kosong ATAU semua terisi dan berjumlah 100": lima dari enam
   adalah komposisi yang tidak bisa dijumlahkan.
2. **`gmv_per_jam_live` GENERATED, tidak diketik.** B-7.2 menuliskannya
   "Number × 3", tapi angka ketiga adalah hasil bagi dua yang pertama, dan
   aturan rumah #4 menyatakan field terhitung read-only. Angka ketiga yang bisa
   diketik adalah angka yang bisa **membantah** dua di atasnya, dan tidak ada
   cara memilih mana yang benar setelahnya. Bagi-nol → NULL → `—` (aturan #7).
3. **B-1.5 (tren) tidak punya kolom sama sekali.** Ia `A` (auto), diturunkan saat
   dibaca (`trenBaseline`). Menyimpannya berarti angka yang bisa basi terhadap
   baseline yang melahirkannya.

**Dua konvensi yang sebelumnya tak tertulis, sekarang DINYATAKAN** (keduanya
lewat `COMMENT ON` di migrasi A-06 — bukan dengan mengedit migrasi A-03 yang
sudah diterapkan):

- **`month_index` 1 = bulan TERTUA** dalam jendela B-0.7 (`periode_mulai`),
  n = terbaru. Alasannya bukan selera: matriks target Section D mengindeks bulan
  MAJU (M1…Mn ke depan), dan baseline yang mengindeks mundur akan membuat setiap
  pembacaan lintas-seksi menjadi jebakan.
- **Band `stabil` B-1.5 = ±5%**, dipilih karena §6 sendiri menyebut baseline
  Alpha Digital (180/165/172jt, sebaran 4,4%) *"flat"*. Band yang lebih sempit
  akan membantah contoh kerja PRD-nya sendiri. Konstanta:
  `TREN_STABIL_BAND_PERSEN`.

### Kenapa kolom Section A/B NULLable — dan di mana Rule 5 sesungguhnya ditegakkan

Setiap field Section A/B bertanda `W`. Tetap NULLable, dan itu **bukan**
kelonggaran: record lahir `Draft`, §7 Non-functional meminta **autosave tiap 20
detik**, dan §5 langkah 5 meminta tombol submit menampilkan *"hitungan hidup
field wajib yang belum terisi"*. Ketiganya butuh keadaan setengah-terisi BISA
disimpan; `NOT NULL` berarti autosave pertama gagal sampai field terakhir terisi.

Jadi pembagiannya:

| Ditegakkan di | Apa |
|---|---|
| CHECK DB | rentang (persen 0–100, rating 0–5, jumlah ≥ 0), taksonomi tertutup, konsistensi (`sku_aktif ≤ sku_listed`, `sku_pareto_80 ≤ sku_aktif`), jumlah trafik = 100 ±0,5, aturan blocker A-16 |
| Validasi domain | hal yang sama + pesan BI `[...]`, plus yang butuh kueri (channel akses harus channel kontrak, tidak ada sel matriks kembar) |
| **Gerbang submit** (`checkCompleteness`, di transaksi yang SAMA dengan transisinya) | **KEHADIRAN** — Section A per field-ID (`A-1`, `A-9`, …), `A-15/<channel>`, dan `B-2/<channel>` … `B-9/<channel>` hanya untuk channel `Eksisting` |

Baris baseline BULANAN tetap `NOT NULL` tanpa default (A-03) — di sana barisnya
di-INSERT utuh, jadi "blank" memang harfiah tidak bisa disimpan.

Semua tes kehadiran memakai `!== null`, **bukan** truthiness: toko dengan nol jam
live, nol affiliate, atau nol poin penalti sudah MENJAWAB, dan gate yang
menganggap `0` sebagai kosong akan menolak jawaban jujur dan menghadiahi tebakan.

### Permukaan yang dibangun

- `packages/domain/src/strategi.ts` — `saveKonteks`, `saveAkses`, `ChannelInput`
  diperluas, `trenBaseline` (diekspor & diuji terpisah), `checkCompleteness`
  diperluas
- 2 route baru: `PUT /strategi/{id}/konteks`, `PUT /strategi/{id}/akses`
- `apps/api/src/lib/wire.ts` — 8 interface struct baru + converter masuk/keluar
- `web-internal/src/lib/strategi.ts` — tipe FE + `saveStrategiKonteks` /
  `saveStrategiAkses`. **Masih belum ada halaman** (lihat §3)
- Fixture tes memakai angka **§6 Alpha Digital yang sebenarnya**, bukan angka
  karangan: itulah yang membuat asersi field turunan bisa diperiksa terhadap
  sesuatu di luar berkas tesnya sendiri (`tren` harus keluar `stabil`, karena §6
  menyebut baseline itu "flat")

---

## 2. Yang BELUM — dan urutan yang benar

```
entity_prefix ─► M6C gate ─► M6A kerangka ─► A-05/A-06 ─► A-07…A-09 ─► M6B Plan
  ✅ SESI1        ✅ SESI1     ✅ SESI2        ✅ SESI3     ❌           ❌ B-01…B-11
                                                             │
                              A-13 halaman & form ◄───────────┘ (tiket BARU)
```

Tiket per-tiket di `docs/backlog/M6ABC_BACKLOG.md` §2/§3. Yang berikutnya:

- **A-07** Section C — Rule 6: setiap akar masalah WAJIB mereferensi ≥1 field-ID
  baseline, divalidasi ada di Strategi yang sama. Sekarang jauh lebih murah:
  field-ID baseline yang bisa dirujuk **sudah ada semuanya** setelah A-06 —
  sebelum sesi ini, Rule 6 tidak punya apa pun untuk dikutip.
- **A-08** Section D + asumsi (flip `Gugur` → `strategi_revisi_disarankan` tetap
  **terblokir O55**).
- **A-09** Section E/F/G/H/I/J.
- **A-13 (BARU)** halaman + form. Dipisah dari A-05…A-09 dengan sengaja: sepuluh
  seksi bukan satu form, dan menumpangkannya ke tiket data membuat "A-05 selesai"
  berarti dua hal berbeda. Kontraknya sudah dijaga `shape-parity`, jadi form bisa
  dibangun tanpa menebak bentuk badan respons. **Baca `web-internal/AGENTS.md`
  lebih dulu** — versi Next di repo ini bukan yang ada di data latih.

---

## 3. ⚠️ Yang belum tersambung — jangan diklaim sudah

1. **Belum ada halaman Strategi sama sekali.** A-05/A-06 lengkap sampai kontrak
   FE (tipe + fetcher), dan `shape-parity` memeriksanya — tapi tidak ada satu
   pun form yang dirender. Itu tiket **A-13**.
2. **Enam field `W` berbentuk daftar TIDAK digerbangi** — A-11, A-14, B-5.3,
   B-8.1, B-8.2. Bukan kelalaian: daftar kosong berarti dua hal yang berbeda
   ("tidak ada" vs "belum dijawab") dan CDPS tidak punya cara mengatakan yang
   pertama. Yang digerbangi adalah angka pendampingnya. **Pertanyaan terbuka
   O58** — di sana ada tiga pilihannya dan alasan kenapa tidak dipilih sendiri.
3. **Persetujuan `STRG` masih BELUM membuka gerbang Brief.** SESI2 §3.1 berlaku
   utuh: gerbangnya (`account.guardBriefCreation`) masih membaca entitas M6 §4
   (`STR-`) yang dipakai halaman Service. Penyambungannya ikut A-13, bukan A-05.
4. **Nol notifikasi M6A** (O55). Transisi tetap tercatat penuh di `audit_log`.
5. **Overlay visibilitas Rule 16 belum ada** (A-10). A-3/A-13 default `Internal
   Saja` dan A-10 hard-internal menurut §4.1, dan itu **tercatat di COMMENT
   kolom** — tapi belum ada yang menegakkannya. Selama A-10 belum mendarat,
   jangan bangun tautan klien `/s/{token}` (A-11): filter visibilitas harus
   diterapkan SEBELUM serialisasi, dan tanpa daftar hard-internal ia tidak
   memfilter apa pun.

---

## 4. Migrasi — sekarang TUJUH yang belum di-push ke live

SESI1 §4 masih berlaku seutuhnya (**PR #98 wajib mendarat dulu**; jangan pernah
`psql -f`). Yang bertambah:

| Migrasi | Isi |
|---|---|
| `20260806065000_m6a_section_a.sql` | 20 kolom Section A di `strategi` + tabel `strategi_akses` + RLS |
| `20260806066000_m6a_section_b.sql` | ±45 kolom B-2…B-9 di `strategi_channel` + `gmv_per_jam_live` GENERATED + CHECK |

Keduanya **penambahan murni**: nol tabel lama diubah bentuknya, nol baris lama
disentuh. `ALTER TABLE … ADD COLUMN` dengan default konstan tidak menulis ulang
tabel di PG11+, jadi tidak ada rewrite pada data live.

### Gate jumlah tabel/mesin — DUA berkas, dan sekarang keduanya saling menyebut

Tabel 68 → **69** (+`strategi_akses`), dinaikkan di:

- `scripts/db-rebuild.sh` (gate lokal)
- `.github/workflows/ci.yml`, job `db-and-migrations`

Sesi 2 menaikkan satu saja dan CI merah dengan `expected 14 machines` sementara
seluruh test suite hijau. Sesi ini memasang komentar **KEEP IN STEP WITH …** di
kedua berkas yang saling menunjuk, jadi pembaca berikutnya melihat pasangannya
tanpa harus tahu sejarahnya. Menambah tabel atau mesin = mengubah keduanya di
commit yang sama.

`sm_machines` **16** dan `notif_events` **17** TIDAK disentuh — yang kedua itulah
yang membuat penambahan event tanpa keputusan O55 langsung merah.

---

## 5. Pertanyaan terbuka yang memblokir klaim

O54 / O55 / O56 / O57 **semuanya masih terbuka**. Yang baru:

| # | Butuh dari | Memblokir |
|---|---|---|
| **O58** | Yohan / Yulianti | **"tidak ada" tidak bisa dibedakan dari "belum dijawab"** untuk enam field `W` berbentuk daftar (A-11, A-14, B-5.3, B-8.1, B-8.2). Bacaan yang diambil: gerbangi angka pendampingnya, bukan daftarnya — `0` yang sah membuktikan pertanyaannya sudah dijawab. **Tidak** memblokir A-05/A-06. **Memblokir** klaim *"seluruh field wajib Section A/B ditegakkan"* |

---

## 6. Jebakan sesi ini — tambahan atas SESI1 §5 dan SESI2 §6

1. **CHECK Postgres tidak boleh mengandung subquery.** Memvalidasi elemen sebuah
   array jsonb terhadap daftar tertutup **tidak bisa** ditulis
   `NOT EXISTS (select … jsonb_array_elements_text …)`. Yang dipakai: containment
   `kolom <@ '["a","b"]'::jsonb` — set-containment, mengabaikan urutan & duplikat,
   yang justru benar untuk checkbox.
2. **CHECK yang bernilai NULL LOLOS.** Inilah alasan komposisi trafik jadi enam
   kolom dan bukan jsonb: satu kunci hilang ⇒ ekspresi NULL ⇒ gate diam. Kalau
   Anda menulis CHECK atas nilai yang bisa NULL, tulis eksplisit
   "semua NULL ATAU semua terisi dan …".
3. **`INSERT … SELECT`, bukan `VALUES`, untuk menyalin versi.** `openRevision`
   sekarang menyalin baris `strategi` dengan `INSERT … SELECT` dari versi yang
   direvisi. Dengan `VALUES`, ke-20 kolom Section A harus di-marshal ulang — dan
   hari ada satu kolom baru yang lupa ditambahkan di sana, **setiap revisi akan
   dimulai dengan Section A kosong sementara semua tes pada versi 1 tetap hijau**.
4. **Route pembuatan membalas 201, bukan 200.** Walk pertama sesi ini melaporkan
   dua "kegagalan" yang ternyata asersi saya sendiri. Kalau Anda membangun walk
   baru: `POST /services/{id}/strategi` dan `POST /strategi/{id}/revision`
   keduanya **201**.
5. **Fixture walk tidak bisa dihapus tanpa `truncate strategi_version`.**
   Perluasan SESI2 §6.1: `delete from clients where id like 'ZZW-%'` gagal dengan
   *"strategi_version is append-only"* karena CASCADE tetap memicu trigger
   barisnya. Urutannya: `truncate strategi_version` → hapus `strategi` →
   `services` → `clients`. Dan bersihkan `ZZW-%` sebelum menyimpulkan apa pun
   dari `portal.test.ts` (SESI1 §5.2).

---

## 7. PROMPT untuk sesi berikutnya — salin utuh

```
Lanjutkan pembangunan M6A di CDPS.

BACA DULU, urut:
1. docs/handoff/HANDOFF_M6ABC_SESI3.md   ← posisi persis (ini yang terbaru)
2. docs/handoff/HANDOFF_M6ABC_SESI2.md   ← §3 (yang belum tersambung), §6 (jebakan)
3. docs/handoff/HANDOFF_M6ABC_SESI1.md   ← §4 (PR #98 memblokir db push) & §5
                                           (cara walk HTTP) MASIH BERLAKU
4. docs/backlog/M6ABC_BACKLOG.md         ← A-07…A-13 (M6A) & B-01…B-11 (M6B)
5. docs/prd/CDPS_Module6A_Strategi.md    ← §4 Section C→J, penuh
6. docs/DECISIONS.md, cari O54/O55/O56/O57/O58
7. CLAUDE.md                             ← aturan rumah; Go/MySQL PENSIUN

KEADAAN SEKARANG:
- Gerbang M6C SELESAI (sesi 1). Kerangka M6A SELESAI (sesi 2). Section A + matriks
  akses A-15/A-16 + Section B grup B-2…B-9 SELESAI (sesi 3) — data, domain, route,
  tipe FE, gerbang submit, walk HTTP 42/42.
- BELUM: Section C (A-07), Section D + asumsi (A-08), Section E/F/G/H/I/J (A-09),
  overlay visibilitas (A-10), tautan klien /s/{token} (A-11), versioning UI (A-12),
  HALAMAN & FORM (A-13 — belum ada satu pun halaman Strategi), dan seluruh M6B.
- Persetujuan STRG BELUM membuka gerbang Brief — gerbangnya masih membaca entitas
  M6 §4 lama. Penyambungannya ikut A-13.

TUGAS: A-07 (Section C, termasuk validasi Rule 6 "setiap akar masalah wajib
mengutip ≥1 field-ID baseline") lalu A-08 (Section D + asumsi), kecuali saya
bilang lain. Keduanya ALTER/tabel anak di atas bentuk yang sudah ada + tambahan
ke checkCompleteness.

BATASAN YANG TIDAK BOLEH DILANGGAR:
- Jangan tambah baris ke notif_events (O55 masih menunggu tanda tangan).
- Format ID PREFIX-YYYYMM-NNNN (CLAUDE.md #1).
- Riwayat immutable hidup di audit_log + strategi_version (append-only).
- Transisi status HANYA lewat sm_transition. Jangan daftarkan edge
  `Aktif → Draft Revisi` — bertentangan dengan Rule 13, sudah dicatat.
- Migrasi HANYA lewat supabase/migrations/** + db push / apply_migration.
  JANGAN psql -f. Jangan edit migrasi yang sudah diterapkan — pakai COMMENT ON
  di migrasi baru kalau perlu menajamkan dokumentasi.
- Kalau menambah tabel/mesin: naikkan gate di scripts/db-rebuild.sh DAN
  .github/workflows/ci.yml, di commit yang SAMA.
- Tujuh migrasi belum diterapkan ke live; db push masih terblokir PR #98.
- KNOWN_GAPS di apps/api/src/lib/route-parity.test.ts harus tetap KOSONG, dan
  setiap wire interface baru wajib punya tipe FE di WIRE_TO_FE.
- Response snake_case, diterjemahkan HANYA di apps/api/src/lib/wire.ts. Kunci
  yang HILANG lebih berbahaya daripada null.
- Kalau menambah kolom ke `strategi`: tambahkan juga ke INSERT … SELECT di
  openRevision, atau setiap revisi akan mulai dengan kolom itu kosong.

VERIFIKASI YANG SAYA HARAPKAN:
- npm run db:rebuild -- --yes  (update KEDUA gate kalau menambah tabel)
- DATABASE_URL=... npm test --workspaces --if-present
- npx vitest run --root web-internal      ← TERPISAH
- walk HTTP lewat route nyata (pola SESI1 §5; ingat 201 untuk create)
- npm run build --prefix web-internal

Kalau PRD ambigu atau dua modul bertabrakan: STOP dan catat di DECISIONS.md.
Jangan diam-diam memilih tafsir.

Kerjakan di branch claude/ci-gates-db-migrations-101jt4, commit, push. Jangan
buka PR kecuali saya minta.
```
