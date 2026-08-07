# HANDOFF — M6A/M6B/M6C Sesi 5 (titik mulai sesi berikutnya)

> **Konteks:** lanjutan `HANDOFF_M6ABC_SESI4.md`. Sesi ini menerima **keputusan
> pemilik atas empat pertanyaan terbuka** (O54, O55, O57, O58) dan mengeksekusi
> tiga di antaranya. Berkas SESI1–SESI4 tetap berlaku.

---

## 0. Posisi persis — SALIN INI KE SESI BERIKUTNYA

| | |
|---|---|
| **Branch kerja** | `claude/ci-gates-db-migrations-101jt4` |
| **PR aktif** | **#101** masih TERBUKA. Sesi ini menumpuk DI ATASNYA |
| **Migrasi** | **63 berkas** lokal, **63 tercatat di live** — sinkron penuh per 2026-08-07 (lihat §5) |
| **Tabel** | **74** (dari 73). +`notif_catalog_versions` |
| **`sm_machines`** | **16 — TIDAK disentuh** |
| **`notif_events`** | **31** (dari 17) — 17 v1 + 14 v2. O55 SELESAI |
| **Test** | **810 pass** (packages+apps, dengan DATABASE_URL) · **116 pass** (web-internal) |
| **TypeScript** | `tsc --noEmit` EXIT 0 (core + domain + api + web-internal) |

**Perintah untuk melanjutkan:**

```bash
git fetch origin claude/ci-gates-db-migrations-101jt4
git checkout claude/ci-gates-db-migrations-101jt4
npm install
service postgresql start
su postgres -c "psql -c \"ALTER USER postgres WITH PASSWORD 'postgres';\""
npm run db:rebuild -- --yes
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps" npm test --workspaces --if-present
npx vitest run --root web-internal      # TERPISAH — bukan anggota workspaces
```

> ⚠️ **Postgres mati dua kali di tengah sesi ini** (container). Kalau test tiba-tiba
> merah dengan `ECONNREFUSED 127.0.0.1:5432`, itu bukan regresi — `service
> postgresql start`, ulangi `db:rebuild`, jalankan lagi.

---

## 1. Keputusan pemilik 2026-08-07 — semuanya di `docs/DECISIONS.md`

| # | Keputusan | Status |
|---|---|---|
| **O54** | Tier dikonfirmasi + `Customer Review Management` → `tanpa_plan`; tier jadi **pilihan di admin MSL** | ✅ **SELESAI** |
| **O55** | Pilihan (a) — katalog notifikasi **berversi**, `notification_catalog_version = 2` | ✅ **SELESAI** (menutup O53 juga) |
| **O58** | Pilihan (a) — **checkbox eksplisit "tidak ada"** per field daftar wajib | ✅ **SELESAI** (kecuali UI, lihat §3) |
| **O57** | Entitas **`CONTRACT` BARU**; floor GMV = input AM + persetujuan Head | 🔴 **BELUM DIKERJAKAN** — lihat §4 |

---

## 2. Yang SELESAI sesi ini

### 2.1 O54 — tier katalog + admin MSL (commit `58f6588`)

Koreksi pemilik dipasang di `20260806062000_m6c_retier_catalog.sql`:
`Customer Review Management` keluar dari tier tengah — tersisa **12 nama**.
Diterapkan ke katalog live: **12 dari 73 entri efektif = 16,4%**, jauh di bawah
ambang §12 (<40%).

Yang lebih penting dari koreksi itu: jawaban butir (1) pemilik — *"kedepan sangat
mungkin ada service lain yang perlu plan, maka buat supaya AM ada pilihan, karena
service dibuat dinamis mengikuti kebutuhan klien"* — dieksekusi sebagai **fitur**,
bukan sebagai baris migrasi. Tier sekarang disetel per entri di **admin Master
Service List**: `msl.ServiceInput.planTier` → route → wire → selector di halaman
`/master-services`, plus kolom "Strategi & Plan" di tabel utama dan riwayat versi.
Layanan baru yang butuh Plan tidak lagi menunggu rilis engineering.

**`reconcileTier` adalah cermin baris-per-baris trigger DB `normalize_plan_tier`.**
Urutan cabangnya tidak sembarang — ia menentukan kolom mana yang menang saat
keduanya berselisih. Yang paling mudah salah: `tier='tanpa_plan'` + `boolean=true`
menghasilkan **`plan_wajib`**, bukan `tanpa_plan`, karena penulis pra-M6C bicara
lewat boolean. Ada 4 tes unit yang mengunci tiap cabang dan 2 tes integrasi yang
membuktikan nilai pilihan Sales Head selamat melewati trigger tanpa berubah.

`shape-parity` kehilangan izin extra `MasterServiceWire.requires_strategy_plan` —
halaman yang menyetel tier harus bisa melihatnya. **Jangan tambahkan kembali.**

### 2.2 O55 — katalog notifikasi v2 (commit `58f6588`)

Migrasi `20260807010000_notif_catalog_v2.sql`. Tiga bagian:

1. **`notif_catalog_versions`** — registry, satu baris per versi, dengan
   `event_count` yang versi itu perkenalkan. **Di sinilah angkanya sekarang
   hidup.** Tes berhenti meng-assert literal `== 15`/`== 17` dan mulai
   meng-assert `events().length == registeredEventCount()` + per-versi.
   Menambah event tanpa mendaftarkan versinya tetap merah **walau seseorang ikut
   menaikkan literalnya** — itu yang dibeli O55.
2. **14 event v2** — 4 Strategi + 6 Plan + 3 Gate + `m6.client.assigned` (O53).
3. **Trigger `trg_notif_events_v1_frozen`** — 17 baris v1 tidak bisa
   di-UPDATE/DELETE. "15 event lama tak disentuh" jadi ditegakkan, bukan
   dijanjikan. Diuji dengan mutasi: UPDATE v1 ditolak, DELETE v1 ditolak,
   UPDATE v2 lolos.

> **PENAMAAN — jangan "dirapikan".** 13 event M6A/6B/6C ditulis persis seperti
> PRD-nya (`strategi_diajukan`), tanpa prefix `mN.` yang dipakai 17 event v1.
> Mengarang ulang identifier yang PRD tulis eksplisit adalah rename yang dilarang
> aturan rumah. Dikunci assertion daftar penuh di `notification.test.ts` — kalau
> Anda "memperbaiki" namanya, tes itu merah, dan itu memang gunanya.

**Yang O55 buka tapi BELUM disambung:** ke-14 event sudah ada di katalog, tapi
belum ada satu pun `emit()` yang memanggilnya. A-08 secara khusus menunggu ini —
flip asumsi ke `Gugur` sekarang boleh memicu transisi `strategi_revisi_disarankan`
(SESI4 §2 menyuruh menundanya "sampai O55 selesai" — **sudah selesai**).

### 2.3 O58 — "tidak ada" vs "belum dijawab" (commit `291a6b5`)

Migrasi `20260807020000_m6a_tidak_ada_flags.sql`. **Lima** field, bukan enam:
O58 menghitung B-3.5/B-4.5 yang sudah opsional dan tidak pernah digerbangi.

**Dua aturan, sengaja di dua lapisan** — ini bagian yang paling mudah dirusak:

| Aturan | Di mana | Kenapa di sana |
|---|---|---|
| Kontradiksi (daftar terisi **DAN** checkbox dicentang) | **CHECK di DB** | Tidak pernah sah di state mana pun. Tidak boleh bisa DISIMPAN |
| Belum dijawab (kosong **DAN** tidak dicentang) | **`checkCompleteness`** | Sah selama Draft — itulah rupa form setengah isi. Kalau ditaruh di CHECK, AM tidak bisa menyimpan draft sama sekali |

Angka pendamping **tetap** digerbangi (`jumlah_kampanye_aktif`,
`beban_promo_persen`) — jalur bukti berbeda, keduanya murah, salah satu sendirian
meninggalkan lubang.

> **Kenapa jumlah tesnya penting.** Menambah gerbang ini tidak mengubah satu pun
> dari 91 tes yang ada, karena fixture `seedSubmittable` mengisi kelima daftar.
> Gerbang yang hanya pernah melihat cabang "terisi" tidak bisa dibedakan dari
> tidak ada gerbang. 6 tes baru menguji **kedua** cabang, dan divalidasi dengan
> mutasi: mengganti dua predikat gerbang dengan `true` membuat **tepat dua** tes
> baru merah.

**Jebakan yang sudah dihindari:** kelima kolom ditambahkan ke `openRevision`
(INSERT … SELECT Section A) dan `copyChildren`. Komentar di `openRevision` sudah
memperingatkan persis ini — kolom Section A yang lupa disalin membuat **setiap
revisi** mulai dengan field kosong sementara semua tes pada versi 1 tetap hijau.

### 2.4 Perbaikan — A-07 Section C tidak pernah dijalankan terhadap DB

`saveDiagnosa` menulis `${JSON.stringify(ids)}::jsonb`. postgres.js mengikat
parameter itu **sebagai jsonb**, jadi ia meng-encode ulang string yang sudah
di-encode: kolom berisi jsonb *string* `"[\"A-1\"]"`, bukan array `["A-1"]`, dan
`ck_strdiag_field_ids_array` menolak setiap baris. Diganti
`to_jsonb(<array>::text[])`.

**Ini membuat 44 dari 91 tes `strategi.test.ts` MERAH di HEAD.** SESI4 melaporkan
"9 pass · 82 skip" karena dijalankan **tanpa** `DATABASE_URL` — seluruh jalur DB
Section C tidak pernah tereksekusi. Setelah perbaikan: 91/91.

> **Aturan yang lahir dari ini: jangan pernah melaporkan hijau dari run tanpa
> `DATABASE_URL`.** "82 skip" bukan "82 lolos".

`health.ts:698` memakai idiom yang sama untuk `components_json`. **Bukan bug
hidup** — `jsonToComponents` dan `portal.draggingComponent` sama-sama mem-parse
string itu, jadi round-trip-nya benar. Sengaja tidak diubah: mengubah bentuk
tulisnya akan memecahkan dua pembaca yang mengkompensasinya, dan itu perubahan
M13 yang tidak diminta.

---

## 3. Yang BELUM — dan itu bukan kelalaian

**Checkbox O58 belum punya UI.** Form Section A/B memang belum dibangun (O56):
halaman Service masih menampilkan form 6-field M6 §4. DB, domain, wire, dan tipe
FE sudah siap menerimanya — checkbox-nya menyusul bersama **A-13**.

**14 event v2 belum diemisikan.** Katalognya ada; `emit()`-nya belum dipasang.

---

## 4. O57 — BELUM DIKERJAKAN, dan ini rancangannya

Keputusan pemilik: **(a) "Kontrak" = kumpulan Service satu klien dalam satu
kesepakatan** ⇒ entitas `CONTRACT` baru, `strategi.service_id` → `contract_id`.
Klien yang membeli Store Management + GMV Max + Nano KOL dalam satu kesepakatan
12 bulan mendapat **SATU** Strategi. **(b) Floor GMV = input AM + persetujuan
Head**, bukan field baru di closing M0.

Tidak dikerjakan sesi ini karena ini refactor terbesar dari keempatnya dan
setengah-jadi lebih berbahaya daripada belum mulai: `strategi.service_id` adalah
titik join gerbang M6C, dan ia muncul di RLS, tiga indeks unik, FK, dan ~20 route.
Ketiga keputusan lain sudah mendarat utuh dan teruji; O57 dimulai dari bersih.

### Yang sudah dipetakan (hemat waktu sesi berikutnya)

**Blast radius sebenarnya lebih kecil dari kelihatannya.** RLS hanya menyentuh
`service_id` di **dua** tempat — policy `strategi_select` dan
`private.jwt_can_read_strategi()`. Kelima tabel anak mewarisi lewat `EXISTS` ke
`strategi`, jadi mereka **tidak** perlu disentuh sama sekali.

**Langkah yang disarankan:**

1. **Prefix `CTR-`** — `entity_prefix` (29 → 30) + `PREFIXES` di
   `packages/core/src/ident.ts`. `packages/db/src/ident.registry.test.ts`
   memeriksa keduanya cocok, jadi lupa salah satu = merah.
2. **Tabel `contracts`** — `id CTR-`, `client_id`, `durasi_bulan`,
   `tanggal_mulai`, `tanggal_akhir`, `created_by`. Belum perlu mesin status.
3. **`services.contract_id`** nullable FK → `contracts`. Nullable karena Service
   yang di-closing tanpa kesepakatan payung tetap sah.
4. **`strategi.contract_id`** NOT NULL FK menggantikan `service_id`. Ketiga
   indeks unik ikut: `uq_strategi_aktif_per_service` → `_per_contract`, idem
   `uq_strategi_inflight_per_service` dan `uq_strategi_versi`.
5. **Backfill** — untuk tiap `strategi` yang ada, buat satu `contracts` dari
   service-nya (1:1) lalu tautkan. **Di live ini nol baris** (M6A belum
   di-deploy), tapi tetap harus ditulis benar untuk DB lokal & CI.
6. **RLS** — `private.jwt_is_am_of_service(service_id)` perlu padanan berbasis
   kontrak (AM dari klien pemilik kontrak). Dua tempat, itu saja.
7. **`/services/{id}/strategi`** tetap dipertahankan: resolve service → contract
   di dalam route, jangan ubah kontrak URL-nya (`route-parity` akan merah).
8. **Floor GMV butir (b)** — `strategi_target.sumber_floor` berhenti berarti
   "kontraktual vs input sendiri" dan mulai mencatat **jalur persetujuan**.
   Rule 7 "read-only" dibaca sebagai **read-only setelah disetujui Head**; D-7
   Sanggahan Target tetap punya penegak karena yang menyetujui bukan yang
   mengetik.

> **Kenapa ini harus SEBELUM M6B B-01:** membalikkan (a) murah sekarang (satu FK,
> nol data produksi) dan mahal setelah periode Plan digenerate di atasnya.

---

## 5. ✅ Migrasi — SELESAI diterapkan ke live `CDPS SG` 2026-08-07

**Teka-teki SESI1 terpecahkan, dan bukan seperti dugaan PR #98.** Pengecekan
langsung ke live menunjukkan: SQL `20260805060000` **sudah jalan** (fungsi
`private.jwt_is_am_of_service` ada; ketiga policy predikatnya sama persis dengan
repo) tetapi **tidak punya baris di `schema_migrations`** — baik dengan nama
`20260805060000` maupun `20260805160305`. Baris riwayatnya yatim, khas
`apply_migration` MCP atau `psql -f`: objeknya masuk, catatannya tidak.

⇒ **PR #98 dan #95 memperbaiki masalah yang salah.** Rename ke `20260805160305`
tidak menolong (live tidak punya baris itu), dan `20260805160305` pun masih di
bawah `20260806050000`, jadi tetap out-of-order. **Tutup keduanya.**

### Yang dikerjakan

1. **Repair** — baris `20260805060000` dicatat, **nol SQL dijalankan ulang**.
   Setelah itu tidak ada lagi migrasi belum-jalan yang bernomor di bawah garis.
2. **11 migrasi diterapkan berurutan**, masing-masing dengan baris riwayatnya
   di batch yang SAMA (atomik — dibuktikan lebih dulu dengan probe: CREATE TABLE
   ikut ter-rollback saat statement berikutnya gagal, nol residu).

### Hasil — live cocok dengan gate CI

| | Sebelum | Sesudah |
|---|---|---|
| Tabel | 55 | **74** |
| `sm_machines` | 14 | **16** |
| `notif_events` | 17 | **31** (17 v1 + 14 v2) |
| `entity_prefix` | – | **29** |
| Migrasi tercatat | 51 | **63** |

Invariant O55 dicek di live: `SUM(event_count)` registry = `COUNT(notif_events)`
= 31. Trigger pembekuan v1 diuji **di live** — UPDATE baris v1 ditolak, resolver
utuh.

Tier efektif katalog live: **12 dari 73 entri (16,4%)** di `ditentukan_am` —
jauh di bawah ambang §12 (<40%).

### ⚠️ Yang BERUBAH untuk AM — perlu diberitahukan

Tiga Service yang masih `[Awaiting Onboarding]` kini **plan-gated**:
`SVC-202608-0002`, `SVC-202608-0003`, `SVC-202608-0005` → `plan_wajib`.
`SVC-202608-0004` → `ditentukan_am` (form G-B muncul). Halaman ketiganya berhenti
menawarkan form Brief dan mulai menuntut Strategi & Plan. Itu perilaku yang benar
menurut M6A Rule 1, tapi **mengubah alur kerja AM pada layanan yang sudah ada**.

### Catatan cara penerapan

CLI Supabase tidak bisa dipakai di container ini (tidak ada
`SUPABASE_ACCESS_TOKEN` maupun `DATABASE_URL` live), jadi penerapan lewat MCP
`execute_sql` dengan **versi riwayat dikontrol manual** — bukan `apply_migration`,
yang menghasilkan versi dari timestamp saat itu dan justru melahirkan drift yang
sesi ini perbaiki. Komentar SQL dibuang sebelum dikirim; kesetaraannya dibuktikan
dengan `pg_dump --schema-only` versi asli vs telanjang: **identik di 4415 baris**
(hanya nonce `\restrict` pg_dump yang berbeda) + row-count konfigurasi sama.

### Aturan supaya tidak terjadi ronde keempat

1. **Satu pintu push.** Merge ke `main` dulu, push dari satu tempat. Dua akun
   boleh menulis migrasi paralel; yang tidak boleh adalah dua akun sama-sama push.
2. **Jangan `apply_migration` MCP untuk skema** — versinya di-generate dari
   timestamp, bukan dari nama berkas. Itu sumber drift O38 dan yang ini.
3. **Timestamp = waktu UTC sebenarnya saat berkas dibuat.** Hampir kejadian lagi:
   `20260807010000`/`020000` kita bernomor di bawah `20260807040000` milik sales.

---

## 6. Pertanyaan terbuka setelah sesi ini

| # | Pemutus | Isi |
|---|---|---|
| **O57** | Yohan / Yulianti | **SUDAH DIPUTUS**, belum dieksekusi — rancangan di §4. Blokir keras M6B B-01 |
| **O56** | Yohan | urutan ronde berikutnya: M6A dulu (form Strategi) atau M6B dulu (periode Plan) |
| **O54 sisa** | Yohan / Yulianti | `Shopee`/`TikTok Rating Optimization` tidak dijawab eksplisit — ditahan di tier tengah. Reversibel nol-biaya lewat admin MSL, jadi ini catatan, bukan blocker |

---

## 7. Jebakan sesi ini — tambahan atas SESI1 §5, SESI2 §6, SESI4

1. **`JSON.stringify(x)::jsonb` di postgres.js adalah bug, bukan idiom.**
   Parameter yang diterima kolom jsonb di-encode **lagi**. Pakai
   `to_jsonb(<array>::text[])`, atau `sql.json(x)`. Sudah memakan A-07 sekali.
2. **"82 skip" bukan "82 lolos".** Run tanpa `DATABASE_URL` melewati seluruh
   jalur DB. Selalu laporkan hijau dari run **dengan** `DATABASE_URL`.
3. **Gerbang baru yang tidak mengubah satu pun tes patut dicurigai.** Fixture
   yang lengkap membuat gerbang baru tak pernah tersentuh cabang gagalnya.
   Mutasikan predikatnya dan pastikan tes yang tepat berubah merah.
4. **Gate angka hidup di DUA berkas** — `scripts/db-rebuild.sh` dan
   `.github/workflows/ci.yml`. Sesi ini menaikkan tabel 73→74 dan notif 17→31 di
   keduanya, plus gate baru `count(notif_events) = SUM(event_count)`.
5. **`types.ts` tidak boleh meng-import `account.ts`** — `account.ts` sudah
   meng-import `types.ts`. `PlanTier` dipindah ke `types.ts` dan di-**re-export**
   dari `account.ts` supaya importer lama tidak berubah.
6. **Postgres bisa mati di tengah sesi.** `ECONNREFUSED 127.0.0.1:5432` di test
   bukan regresi — restart, `db:rebuild`, ulangi.
