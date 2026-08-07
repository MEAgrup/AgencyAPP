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
| **Migrasi** | **62 berkas** lokal. **11 BELUM diterapkan ke live `CDPS SG`** |
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
`Customer Review Management` keluar dari tier tengah. Tier tengah **11/33 (33%)**,
turun dari 36% — makin jauh di bawah ambang §12 (<40%).

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

## 5. ⚠️ Migrasi — sekarang SEBELAS yang belum di-push, dan satu hal harus dicek dulu

| Migrasi | Isi |
|---|---|
| `20260805060000_rls_account_lead_service_scope` | **lihat peringatan di bawah** |
| `20260806060000_entity_prefix_registry` | tabel + backfill 29 prefix |
| `20260806061000_m6c_plan_gate` | tier + gate config + `service_plan_gate` |
| `20260806062000_m6c_retier_catalog` | tier 33 entri — **kini dikonfirmasi pemilik (O54)** |
| `20260806063000_m6a_vendor` | entitas `VND-` |
| `20260806064000_m6a_strategi` | `strategi` + 8 tabel anak + mesin #15 |
| `20260806065000_m6a_section_a` | 20 kolom Section A + `strategi_akses` |
| `20260806066000_m6a_section_b` | ±45 kolom B-2…B-9 |
| `20260807000000_m6a_section_c` | 4 tabel Section C |
| `20260807010000_notif_catalog_v2` | **BARU** — registry versi + 14 event v2 |
| `20260807020000_m6a_tidak_ada_flags` | **BARU** — 5 kolom boolean + 6 CHECK |

Semuanya **penambahan murni**: nol tabel lama diubah bentuknya, nol baris lama
disentuh. Satu-satunya UPDATE atas baris lama adalah backfill tier di
`20260806062000`, dan itu dibatasi ke Service yang masih `[Awaiting Onboarding]`.

### ⛔ Yang HARUS diperiksa manusia sebelum `db push`

SESI1 §4 menyatakan riwayat live memuat `20260805160305_rls_account_lead_service_scope`
sementara berkas repo bernama `20260805060000_…`, dan bahwa **PR #98 wajib
mendarat dulu**.

**Pembacaan `list_migrations` di sesi ini TIDAK menampilkan `20260805160305`
maupun `20260805060000` di live.** Riwayat live berhenti di
`20260805030100_rls_account_lead_client_scope` lalu langsung
`20260806050000_prospect_activity_and_komisi_service`.

Dua bacaan itu tidak bisa dua-duanya benar, dan saya **tidak** menerapkan apa pun
ke live sebelum ini dijernihkan — kalau SESI1 benar, `db push` polos akan
out-of-order; kalau pembacaan sesi ini benar, migrasi `20260805060000` belum
pernah jalan di live sama sekali dan PR #98 menyelesaikan masalah yang berbeda
dari yang dikira.

**Jalankan ini dan bandingkan:**

```sql
select version, name
  from supabase_migrations.schema_migrations
 where version >= '20260805000000'
 order by version;
```

Sampai itu jelas: **jangan `db push`, jangan `--include-all`, dan jangan pernah
`psql -f`** (itu yang melahirkan drift O38, tiga ronde beruntun).

**PR yang masih terbuka dan saling terkait:** #101 (branch ini), #98 (rename
migrasi ronde 3), #95 (rename yang sama, ronde lebih awal), #91 (M5-OA-7).
#95 dan #98 tampaknya menyasar hal yang sama — perlu diputuskan mana yang hidup.

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
