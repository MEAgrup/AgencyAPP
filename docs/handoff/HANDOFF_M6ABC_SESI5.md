# HANDOFF — M6A/M6B/M6C Sesi 5 (titik mulai sesi berikutnya)

> **Konteks:** lanjutan `HANDOFF_M6ABC_SESI4.md`. Sesi ini menerima **keputusan
> pemilik atas empat pertanyaan terbuka** (O54, O55, O57, O58), mengeksekusi
> tiga di antaranya, dan **menutup drift migrasi O38 ronde 3** dengan menerapkan
> 11 migrasi tertunda ke live. Berkas SESI1–SESI4 tetap berlaku.

---

## 0. Posisi persis — SALIN INI KE SESI BERIKUTNYA

| | |
|---|---|
| **Branch kerja** | `claude/ci-gates-db-migrations-101jt4` |
| **Commit terakhir** | `8e142c1` — "docs(handoff): SESI5 final" |
| **Sinkron dengan remote** | ✅ ya, working tree bersih |
| **PR** | **#103** TERBUKA — dari branch ini → `main`. Menumpuk di atasnya |
| **Migrasi** | **63 berkas** lokal, **63 tercatat di live** — sinkron penuh |
| **Tabel** | **74** · **`sm_machines` 16** · **`notif_events` 31** (17 v1 + 14 v2) |
| **Test** | **824 pass** (packages+apps, dengan DATABASE_URL) · **116 pass** (web-internal) |
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

> ⚠️ **Postgres mati tiga kali di tengah sesi ini** (container). Kalau test
> tiba-tiba merah dengan `ECONNREFUSED 127.0.0.1:5432`, itu **bukan regresi** —
> `service postgresql start`, ulangi `db:rebuild`, jalankan lagi.

---

## 1. PR #103 — inilah PR aktifnya sekarang

**[#103](https://github.com/MEAgrup/AgencyAPP/pull/103)** — `claude/ci-gates-db-migrations-101jt4` → `main`.
Menumpuk di atasnya untuk kerja berikutnya.

**#101 ditutup sebagai superseded.** Ia menunjuk branch LAIN
(`claude/m6ab-strategi-plan-3x7p0a`, head `ece2a4c`) yang tertinggal 11 commit,
dan tidak akan pernah menampilkan A-05…A-07, O54, O55, O58, merge `main`, maupun
penerapan migrasi ke live. Catatan SESI4 "sesi ini menumpuk DI ATAS #101" benar
dalam arti **git ancestry** (kerja #101 seluruhnya ada di branch ini), tapi salah
dalam arti **PR**.

**Isi #103:** seluruh jalur M6A A-02…A-07 + tiga keputusan pemilik 2026-08-07 +
penutupan drift migrasi O38 ronde 3. 58 berkas, ~12.5k baris.

**PR terbuka lain:** #91 (M5-OA-7, Finance — tidak berhubungan, menggantung sejak
2026-08-05).

---

## 2. Keputusan pemilik 2026-08-07 — semuanya di `docs/DECISIONS.md`

| # | Keputusan | Status |
|---|---|---|
| **O54** | Tier dikonfirmasi + `Customer Review Management` → `tanpa_plan`; tier jadi **pilihan di admin MSL** | ✅ **SELESAI** |
| **O55** | Pilihan (a) — katalog notifikasi **berversi** | ✅ **SELESAI** (menutup O53 juga) |
| **O58** | Pilihan (a) — **checkbox eksplisit "tidak ada"** | ✅ **SELESAI** (kecuali UI, §4) |
| **O57** | Entitas **`CONTRACT` BARU**; floor GMV = input AM + persetujuan Head | 🔴 **BELUM DIKERJAKAN** — §6 |

### 2.1 O54 — tier katalog + admin MSL (`58f6588`)

Koreksi pemilik dipasang di `20260806062000_m6c_retier_catalog.sql`:
`Customer Review Management` keluar dari tier tengah — tersisa **12 nama**.
Di katalog live: **12 dari 73 entri efektif = 16,4%**, jauh di bawah ambang §12
(<40%).

Yang lebih besar dari koreksi itu: jawaban butir (1) — *"service dibuat dinamis
mengikuti kebutuhan klien, buat supaya AM ada pilihan"* — dieksekusi sebagai
**fitur**, bukan baris migrasi. Tier disetel per entri di **admin Master Service
List**: `msl.ServiceInput.planTier` → route → wire → selector di
`/master-services`, plus kolom "Strategi & Plan" di tabel utama & riwayat versi.

> **`reconcileTier` adalah cermin baris-per-baris trigger DB `normalize_plan_tier`.**
> Urutan cabangnya menentukan kolom mana yang menang saat keduanya berselisih.
> Yang paling mudah salah: `tier='tanpa_plan'` + `boolean=true` menghasilkan
> **`plan_wajib`**, bukan `tanpa_plan`. 4 tes unit mengunci tiap cabang; 2 tes
> integrasi membuktikan nilai pilihan Sales Head selamat melewati trigger.

`shape-parity` kehilangan izin extra `MasterServiceWire.requires_strategy_plan`.
**Jangan tambahkan kembali** — halaman yang menyetel tier harus bisa melihatnya.

### 2.2 O55 — katalog notifikasi v2 (`58f6588`)

Migrasi `20260807010000_notif_catalog_v2.sql`:

1. **`notif_catalog_versions`** — registry, satu baris per versi, dengan
   `event_count` yang versi itu perkenalkan. **Di sinilah angkanya sekarang
   hidup.** Tes berhenti meng-assert literal `== 15`/`== 17` dan mulai
   meng-assert `events().length == registeredEventCount()` + per-versi. Menambah
   event tanpa mendaftarkan versinya tetap merah **walau seseorang ikut
   menaikkan literalnya** — itu yang dibeli O55.
2. **14 event v2** — 4 Strategi + 6 Plan + 3 Gate + `m6.client.assigned` (O53).
3. **Trigger `trg_notif_events_v1_frozen`** — 17 baris v1 tidak bisa
   di-UPDATE/DELETE. Diuji dengan mutasi, **lokal dan di live**.

> **PENAMAAN — jangan "dirapikan".** 13 event M6A/6B/6C ditulis persis seperti
> PRD-nya (`strategi_diajukan`), tanpa prefix `mN.`. Mengarang ulang identifier
> yang PRD tulis eksplisit adalah rename yang dilarang aturan rumah. Dikunci
> assertion daftar penuh di `notification.test.ts`.

### 2.3 O58 — "tidak ada" vs "belum dijawab" (`291a6b5`)

Migrasi `20260807020000_m6a_tidak_ada_flags.sql`. **Lima** field, bukan enam
(O58 menghitung B-3.5/B-4.5 yang sudah opsional).

**Dua aturan, sengaja di dua lapisan** — bagian yang paling mudah dirusak:

| Aturan | Di mana | Kenapa di sana |
|---|---|---|
| Kontradiksi (daftar terisi **DAN** dicentang) | **CHECK di DB** | Tidak pernah sah. Tidak boleh bisa DISIMPAN |
| Belum dijawab (kosong **DAN** tidak dicentang) | **`checkCompleteness`** | Sah selama Draft. Kalau di CHECK, AM tidak bisa menyimpan draft |

> **Kenapa jumlah tesnya penting.** Menambah gerbang ini tidak mengubah satu pun
> dari 91 tes yang ada, karena fixture mengisi kelima daftar. Gerbang yang hanya
> pernah melihat cabang "terisi" tidak bisa dibedakan dari tidak ada gerbang.
> 6 tes baru menguji **kedua** cabang, divalidasi dengan mutasi.

**Jebakan yang sudah dihindari:** kelima kolom ditambahkan ke `openRevision` dan
`copyChildren`. Kolom Section A yang lupa disalin membuat **setiap revisi** mulai
dengan field kosong sementara semua tes pada versi 1 tetap hijau.

### 2.4 Perbaikan — A-07 Section C tidak pernah dijalankan terhadap DB

`saveDiagnosa` menulis `JSON.stringify(ids)` lalu di-cast `::jsonb`. postgres.js
mengikat parameter itu **sebagai jsonb**, jadi ia meng-encode ulang string yang
sudah di-encode: kolom berisi jsonb *string*, bukan array, dan
`ck_strdiag_field_ids_array` menolak setiap baris. Diganti
`to_jsonb(<array>::text[])`.

**44 dari 91 tes MERAH di HEAD.** SESI4 melaporkan "9 pass · 82 skip" karena
dijalankan **tanpa** `DATABASE_URL`. Setelah perbaikan: 91/91.

> **Aturan yang lahir dari ini: jangan pernah melaporkan hijau dari run tanpa
> `DATABASE_URL`.** "82 skip" bukan "82 lolos".

`health.ts:698` memakai idiom yang sama untuk `components_json`. **Bukan bug
hidup** — kedua pembacanya mem-parse string itu. Sengaja tidak diubah.

---

## 3. ✅ Migrasi — SELESAI, live sinkron penuh

**Teka-teki SESI1 terpecahkan, dan bukan seperti dugaan PR #98.** SQL
`20260805060000` **sudah jalan** di live (fungsi `private.jwt_is_am_of_service`
ada; ketiga policy predikatnya sama persis dengan repo) tetapi **tidak punya
baris di `schema_migrations`** — baik `20260805060000` maupun `20260805160305`.
Baris riwayatnya yatim: objek masuk, catatan tidak.

**Penyebab struktural, dikonfirmasi pemilik:** dua akun Claude Code paralel — AM
(M6A/6B/6C) di sini, QA sales (M0/M1) di akun lain. Migrasi sales
`20260806050000` sudah di live sementara migrasi AM `20260805060000` yang
bernomor **lebih kecil** belum. Itulah out-of-order-nya.

**Yang dikerjakan:** repair (catat baris, nol SQL diulang) → merge `main` →
11 migrasi diterapkan berurutan, masing-masing dengan baris riwayatnya di batch
yang SAMA.

| | Sebelum | Sesudah |
|---|---|---|
| Tabel | 55 | **74** |
| `sm_machines` | 14 | **16** |
| `notif_events` | 17 | **31** |
| Migrasi tercatat | 51 | **63** |

Invariant O55 dicek **di live**: registry `SUM(event_count)` = `COUNT(notif_events)`
= 31. Trigger pembekuan v1 diuji **di live** — UPDATE baris v1 ditolak.

**Cara penerapan (penting untuk diulang benar):** CLI Supabase tidak bisa dipakai
di container ini (tidak ada `SUPABASE_ACCESS_TOKEN` maupun `DATABASE_URL` live),
jadi lewat MCP `execute_sql` dengan **versi riwayat dikontrol manual** — sengaja
**bukan `apply_migration`**, yang menghasilkan versi dari timestamp saat itu dan
justru melahirkan drift ini. Atomisitas dibuktikan dulu dengan probe; komentar
SQL dibuang dan kesetaraannya dibuktikan `pg_dump --schema-only` (identik di
4415 baris).

### ⚠️ Yang BERUBAH untuk AM — perlu diberitahukan ke tim

| Service | Tier baru | Efek |
|---|---|---|
| `SVC-202608-0002`, `0003`, `0005` | `plan_wajib` | Berhenti menawarkan form Brief; menuntut Strategi & Plan |
| `SVC-202608-0004` | `ditentukan_am` | Form G-B muncul (AM memutuskan) |

Benar menurut M6A Rule 1, tapi **mengubah alur kerja AM pada layanan yang sudah
ada** — dan form Strategi lengkapnya **belum dibangun** (O56), jadi yang muncul
masih form 6-field M6 §4.

---

## 4. Yang BELUM — dan itu bukan kelalaian

1. **UI checkbox O58** — form Section A/B belum dibangun (O56). DB, domain, wire,
   tipe FE sudah siap. Menyusul bersama **A-13**.
2. **14 event v2 belum diemisikan** — katalognya ada, `emit()`-nya belum dipasang.
   **A-08 tidak lagi terblokir**: transisi `strategi_revisi_disarankan` boleh
   disambung sekarang (SESI4 §2 menyuruh menundanya "sampai O55 selesai" —
   sudah selesai).
3. **O57 belum dikerjakan** — §6.

---

## 5. PR yang ditutup sesi ini

**#95 dan #98** — keduanya perubahan yang sama (rename `20260805060000` →
`20260805160305`) di branch berbeda. Ditutup karena:

* riwayat live **tidak memuat** `20260805160305` maupun `20260805060000`,
  sementara objeknya ada semua ⇒ masalahnya baris yatim, bukan nomor berbeda;
* rename tidak menolong: tidak ada baris untuk dicocokkan, **dan**
  `20260805160305` tetap < `20260806050000` yang sudah ter-apply ⇒ tuntutan
  `--include-all` tetap muncul;
* **merge-nya sekarang justru melahirkan drift baru** — berkas repo jadi
  `20260805160305` sementara riwayat live memuat `20260805060000`.

**#101** — ditutup sebagai **superseded**, digantikan **#103** (lihat §1).

**#97 TIDAK ditutup** — sudah merged 2026-08-06, isinya benar (tab "Lead Saya"),
tidak berhubungan dengan diagnosis migrasi. (Permintaan pemilik menyebut "#95 &
#97"; #97 ternyata salah ketik untuk #98 — diperiksa dulu, tidak ditutup.)

**Papan PR sesudah sesi ini:** #103 terbuka (kerja ini) · #91 terbuka (Finance,
tidak berhubungan) · #95/#98/#101 ditutup.

---

## 6. O57 — BELUM DIKERJAKAN, ini rancangannya

Keputusan pemilik: **(a) "Kontrak" = kumpulan Service satu klien dalam satu
kesepakatan** ⇒ entitas `CONTRACT` baru, `strategi.service_id` → `contract_id`.
Klien yang membeli Store Management + GMV Max + Nano KOL dalam satu kesepakatan
12 bulan mendapat **SATU** Strategi. **(b) Floor GMV = input AM + persetujuan
Head**, bukan field baru di closing M0.

Tidak dikerjakan karena ini refactor terbesar dari keempatnya dan setengah-jadi
lebih berbahaya daripada belum mulai: `strategi.service_id` adalah titik join
gerbang M6C.

**Blast radius lebih kecil dari kelihatannya.** RLS hanya menyentuh `service_id`
di **dua** tempat — policy `strategi_select` dan `private.jwt_can_read_strategi()`.
Kelima tabel anak mewarisi lewat `EXISTS`, jadi **tidak** perlu disentuh.

**Delapan langkah:**

1. **Prefix `CTR-`** — `entity_prefix` (29 → 30) + `PREFIXES` di
   `packages/core/src/ident.ts`. `ident.registry.test.ts` memeriksa keduanya
   cocok, jadi lupa salah satu = merah.
2. **Tabel `contracts`** — `id CTR-`, `client_id`, `durasi_bulan`,
   `tanggal_mulai`, `tanggal_akhir`, `created_by`. Belum perlu mesin status.
3. **`services.contract_id`** nullable FK → `contracts` (Service tanpa kesepakatan
   payung tetap sah).
4. **`strategi.contract_id`** NOT NULL FK menggantikan `service_id`. Ketiga indeks
   unik ikut: `uq_strategi_aktif_per_service` → `_per_contract`, idem
   `uq_strategi_inflight_per_service` dan `uq_strategi_versi`.
5. **Backfill** — untuk tiap `strategi` yang ada, buat satu `contracts` dari
   service-nya (1:1) lalu tautkan. **Di live nol baris**, tapi tetap harus benar
   untuk DB lokal & CI.
6. **RLS** — padanan `jwt_is_am_of_service` berbasis kontrak. Dua tempat.
7. **`/services/{id}/strategi`** dipertahankan: resolve service → contract di
   dalam route. Jangan ubah kontrak URL (`route-parity` akan merah).
8. **Floor GMV butir (b)** — `strategi_target.sumber_floor` berhenti berarti
   "kontraktual vs input sendiri" dan mulai mencatat **jalur persetujuan**.
   Rule 7 "read-only" dibaca sebagai **read-only setelah disetujui Head**; D-7
   Sanggahan Target tetap punya penegak karena yang menyetujui bukan yang
   mengetik.

> **Kenapa SEBELUM M6B B-01:** membalikkan (a) murah sekarang (satu FK, nol data
> produksi) dan mahal setelah periode Plan digenerate di atasnya.

---

## 7. Pertanyaan terbuka & cacat yang masih hidup

**Memblokir build berikutnya:**

| # | Pemutus | Isi |
|---|---|---|
| **O57** | — | **Sudah diputus**, belum dieksekusi (§6). Blokir keras M6B B-01 |
| **O56** | Yohan | Urutan ronde berikutnya: **M6A dulu** (form Strategi, paling terlihat di halaman yang di-QA) atau **M6B dulu** (periode Plan, menutup `planSatuanStatus = belum_tersedia`) |

**Cacat 🔴 yang masih terbuka (bukan dari sesi ini, tapi jangan hilang):**

| # | Isi |
|---|---|
| **O52** | Halaman detail Task/Asset/Booking **404 untuk divisi eksekusinya sendiri** — `account.loadBrief` men-join `services` + `clients`, kedua policy tidak punya arm divisi eksekusi |
| **O51** | `GET /portal/me` menabrak `role_mappings` yang default-deny ⇒ 500. Halaman `/portal` belum pernah diuji |
| **O48** | Kelas cacat O46 ternyata **36 policy lebar**, bukan 3 arm |
| **O45** | Invariant lokal secara struktural tidak bisa melihat grant yang bocor di live |
| **O42** | Tidak ada jalur admin untuk `role_mappings`, padahal tabel itu menentukan SELURUH permission |

**Catatan, bukan blocker:** `Shopee`/`TikTok Rating Optimization` tidak dijawab
eksplisit di O54 — ditahan di tier tengah, reversibel nol-biaya lewat admin MSL.

---

## 8. Aturan supaya drift migrasi tidak lahir ronde keempat

1. **Satu pintu push.** Merge ke `main` dulu, push dari satu tempat. Dua akun
   boleh menulis migrasi paralel; yang tidak boleh adalah dua akun sama-sama push.
2. **Jangan `apply_migration` MCP untuk skema** — versinya di-generate dari
   timestamp, bukan dari nama berkas. Itu sumber drift ronde 1, 2, dan 3.
3. **Jangan pernah `psql -f`** ke live.
4. **Timestamp = waktu UTC sebenarnya saat berkas dibuat.** Hampir kejadian lagi:
   `20260807010000`/`020000` kita bernomor di bawah `20260807040000` milik sales.

---

## 9. Jebakan sesi ini — tambahan atas SESI1 §5, SESI2 §6, SESI4

1. **`JSON.stringify(x)` + cast `::jsonb` di postgres.js adalah bug, bukan idiom.**
   Parameter yang diterima kolom jsonb di-encode **lagi**. Pakai
   `to_jsonb(<array>::text[])` atau `sql.json(x)`. Sudah memakan A-07 sekali.
2. **"82 skip" bukan "82 lolos".** Selalu laporkan hijau dari run **dengan**
   `DATABASE_URL`.
3. **Gerbang baru yang tidak mengubah satu pun tes patut dicurigai.** Mutasikan
   predikatnya dan pastikan tes yang tepat berubah merah.
4. **Gate angka hidup di DUA berkas** — `scripts/db-rebuild.sh` dan
   `.github/workflows/ci.yml`. Sesi ini menaikkan tabel 73→74 dan notif 17→31 di
   keduanya, plus gate baru `count(notif_events) = SUM(event_count)`.
5. **`types.ts` tidak boleh meng-import `account.ts`** — arahnya sebaliknya.
   `PlanTier` dipindah ke `types.ts` dan di-**re-export** dari `account.ts`.
6. **Postgres bisa mati di tengah sesi.** `ECONNREFUSED` bukan regresi.
7. **Cek branch PR sebelum percaya "menumpuk di atasnya".** SESI4 menulis PR #101
   sebagai PR aktif; ternyata head-nya branch lain dan tertinggal 11 commit.
8. **Checkout lokal bisa MUNDUR tanpa pemberitahuan; remote yang benar.** Sesi
   ini `git log` lokal tiba-tiba kehilangan dua commit yang sudah ter-push, dan
   reflog pun tidak menyimpan jejaknya — sempat terbaca sebagai "commit hilang".
   Padahal `origin` memegang keduanya dengan utuh; yang stale adalah checkout-nya.
   **Sebelum menyimpulkan kerja hilang dan membuatnya ulang, `git fetch` lalu
   baca `git log origin/<branch>`.** Membuat ulang di atas checkout yang stale
   menghasilkan commit duplikat yang harus di-`reset --hard` lagi.
