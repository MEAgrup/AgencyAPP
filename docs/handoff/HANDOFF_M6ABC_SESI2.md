# HANDOFF — M6A/M6B/M6C Sesi 2 (titik mulai sesi berikutnya)

> **Konteks:** lanjutan `HANDOFF_M6ABC_SESI1.md`. Sesi ini mengerjakan tiket
> **A-02 (`VND-`)**, **A-03 (`STRG` + tabel anak)** dan **A-04 (mesin #15)** —
> yaitu KERANGKA M6A. Form Section A→J (A-05…A-09) belum.
>
> Berkas SESI1 **tetap berlaku** dan tidak digantikan: §4 (migrasi belum
> diterapkan ke live + PR #98), §5 (cara mengulang walk HTTP + dua jebakannya),
> §6 (O54/O55/O56) semuanya masih akurat. Yang di bawah hanya menambah.

## 0. Posisi persis — SALIN INI KE SESI BERIKUTNYA

| | |
|---|---|
| **Branch kerja** | `claude/m6ab-strategi-plan-3x7p0a` |
| **Migrasi** | **57 berkas** lokal. **5 BARU belum diterapkan ke live `CDPS SG`** — 3 dari sesi 1 + 2 sesi ini |
| **Tabel** | **68** lokal (dari 58). +`vendors` +`strategi` +7 anak |
| **`sm_machines`** | **16** (dari 14). +`vendor` +`strategi` (#15) |
| **`notif_events`** | **17 — TIDAK disentuh.** 13 event M6A/6B/6C masih belum ada (O55) |
| **Test** | api 324 · core 113 · db 15 · domain **754** (+1 skip) · web-internal 116. Semua hijau |
| **Build** | `npx next build web-internal` EXIT 0 |
| **Walk HTTP** | **40/40** lewat route nyata (`apps/api` :3111) |

**Perintah untuk melanjutkan:**

```bash
git fetch origin main
git checkout claude/m6ab-strategi-plan-3x7p0a
npm install
service postgresql start
su postgres -c "psql -c \"ALTER USER postgres WITH PASSWORD 'postgres';\""
npm run db:rebuild -- --yes
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps" npm test --workspaces --if-present
npx vitest run --root web-internal      # TERPISAH — bukan anggota `workspaces`
```

---

## 1. Yang SELESAI sesi ini

### A-02 — entitas `VND-` Vendor (`20260806063000_m6a_vendor.sql`)

Delapan field §7, tidak lebih. Bukan modul manajemen vendor: vendor cuma perlu
bisa **dipilih** di E-8, **dibooking** di F-4, dan **dipensiunkan** tanpa
menghapus baris Strategi yang sudah menunjuknya.

Tiga hal yang bukan detail:

1. **Tarif berpasangan dengan skemanya** (CHECK). `bagi_hasil` memakai persen
   dan hanya persen; tiga skema lain rupiah dan hanya rupiah. Tanpa ini, `15`
   yang tersimpan di kolom rupiah terbaca **Rp 15** di layar F-4.
2. **Mesin `vendor`**, semua edge `require_lead`. Vendor adalah master record
   bersama — satu AM tidak boleh mem-blacklist vendor yang dibooking AM lain.
3. **`Blacklist` SENGAJA bukan terminal.** Jalan pulangnya
   `Blacklist → Nonaktif → Aktif`: dua langkah, dua baris audit. Terminal berarti
   satu-satunya cara membatalkan blacklist yang salah adalah UPDATE mentah.

### A-03 + A-04 — `STRG` + 8 tabel anak + mesin #15 (`20260806064000_m6a_strategi.sql`)

Yang dibangun adalah **BENTUK** yang aturan M6A butuhkan supaya bisa ditegakkan
di DB. Field per Section (A-05…A-09) menempel di atasnya nanti — mereka ALTER,
bukan desain ulang.

Penegakan yang hidup di DB, bukan cuma di TS:

| Aturan | Penegaknya |
|---|---|
| Rule 2 (satu Aktif per kontrak) | index parsial `uq_strategi_aktif_per_service` |
| — (satu revisi berjalan) | `uq_strategi_inflight_per_service` |
| Rule 4 (`Belum Aktif` tetap wajib rencana buka) | `ck_strch_belum_aktif` |
| Rule 5 (blank tidak, `0` boleh) | kolom baseline `NOT NULL` **tanpa default** |
| Rule 5a (<3 bulan wajib beralasan) | `ck_strch_alasan_pendek` |
| Rule 7 (stretch ≥ floor) | `ck_strtg_stretch_gmv` |
| Rule 11 (floor price guardrail) | `ck_strpil_floor_sku` + `ck_strpil_promo_floor` |
| Rule 17 (siklus beku setelah periode 1 tutup) | trigger `guard_siklus_terkunci` |
| Rule 18 (live = vendor, bukan kapasitas internal) | `ck_strpil_vendor_live` + `ck_strres_vendor_only_live` |
| Aturan rumah #3 (riwayat immutable) | `forbid_mutation()` di `strategi_version` |
| Aturan rumah #4/#7 (AOV terhitung, bagi-nol → `—`) | kolom `aov` GENERATED, NULL saat pesanan 0 |

Dua bentuk yang perlu diingat sebelum menyentuh kode ini:

1. **Satu versi = satu BARIS** (Rule 13). Versi n tetap `Aktif` sementara n+1
   duduk di `Draft Revisi`; satu baris tidak bisa memegang dua status.
   `openRevision` INSERT baris baru + menyalin anak-anaknya;
   `approveStrategi` yang mengarsipkan pendahulunya, di transaksi yang sama.
2. **Pengembalian mendarat di laci asalnya** (Rule 12). `sm_edges` tidak bisa
   melihat asal sebuah `Diajukan`, jadi DUA edge terdaftar
   (`Diajukan → Draft` dan `Diajukan → Draft Revisi`) dan domain memilih tujuan
   dari `versi_no`.

### Permukaan yang dibangun

- `packages/domain/src/vendor.ts` · `strategi.ts`
- 17 route `apps/api` (`/vendors*`, `/strategi/{id}*`, `/services/{id}/strategi`)
- `apps/api/src/lib/wire.ts` — converter keluar + **mapper masuk** untuk setiap
  section (pelajaran sesi 1: route yang menyerahkan body mentah ke domain
  menolak permintaan yang sah dengan pesan yang menyalahkan pemanggil)
- `web-internal/src/lib/strategi.ts` — tipe + fetcher. **Belum ada halaman.**
  Berkas ini ada sekarang karena `shape-parity.test.ts` memakai interface FE
  sebagai sumber kebenaran: converter tanpa tipe FE adalah converter yang tidak
  diperiksa siapa pun.

---

## 2. Yang BELUM — dan urutan yang benar

```
entity_prefix ─► M6C tier+gate ─► M6A kerangka ─► M6A form A→J ─► M6B Plan
   ✅ SESI1        ✅ SESI1        ✅ SESI2         ❌ A-05…A-12    ❌ B-01…B-11
                        ▲                                              │
                        └──────── Rule 6 "Plan Satuan" ◄───────────────┘
```

Ticket per-ticket tetap di `docs/backlog/M6ABC_BACKLOG.md` §2 dan §3.

**A-05…A-09 sekarang jauh lebih murah** daripada sebelum sesi ini: tabelnya ada,
gerbang kelengkapan (`checkCompleteness`) sudah menjadi daftar yang tinggal
ditambah, dan setiap `save*` sudah replace-set ber-audit. Yang tersisa untuk
tiap Section adalah kolom + validasi + field form.

**A-10/A-11 sengaja belum disentuh** (overlay visibilitas Rule 16 dan tautan
klien `/s/{token}` D20). Keduanya butuh daftar hard-internal sebagai konstanta
`packages/core` yang ditolak di predikat TS **dan** CHECK DB. Membuat tabel
overlay sekarang tanpa daftar itu = penjagaan yang tidak menolak apa pun, dan itu
lebih berbahaya daripada tidak ada karena ia *terlihat* seperti penjagaan.

---

## 3. ⚠️ Yang belum tersambung — jangan diklaim sudah

1. **Persetujuan `STRG` BELUM membuka gerbang Brief.** M6A §5.7 mengatakan
   seharusnya begitu. Gerbang hari ini (`account.guardBriefCreation`) membaca
   entitas M6 §4 (`STR-`) yang masih dipakai halaman Service. Menyambungkan
   sekarang = dua pintu untuk satu kunci selama form lama masih satu-satunya UI.
   Penyambungannya ikut penggantian form (A-05…A-09).
2. **Nol notifikasi M6A.** Empat event masih terblokir O55. Transisinya tetap
   tercatat penuh di `audit_log` lewat `sm_transition`.
3. **Belum ada halaman.** `web-internal/src/lib/strategi.ts` adalah kontrak;
   form Section A→J adalah A-05…A-09.
4. **FK `plan_id`** dari `service_plan_gate` masih menunggu tabel `PLAN` (M6B).

---

## 4. Migrasi — sekarang LIMA yang belum di-push ke live

SESI1 §4 masih berlaku seutuhnya (**PR #98 wajib mendarat dulu**; jangan pernah
`psql -f`). Yang bertambah:

| Migrasi | Isi |
|---|---|
| `20260806063000_m6a_vendor.sql` | tabel `vendors` + mesin `vendor` + RLS |
| `20260806064000_m6a_strategi.sql` | `strategi` + 7 tabel anak + mesin #15 + trigger Rule 17 + RLS |

Keduanya bernomor di atas migrasi sesi 1, jadi urutan lexicographic lestari dan
push berikutnya tetap berbentuk teraman: migrasi baru di ujung, tanpa flag.

**Yang berubah di live setelah diterapkan:** hanya penambahan — nol tabel lama
diubah, nol baris lama disentuh. Berbeda dengan migrasi sesi 1
(`20260806062000_m6c_retier_catalog.sql`), yang mengubah jalur kerja AM pada
layanan yang sudah ada dan karena itu menunggu konfirmasi O54.

Gate jumlah tabel/mesin dinaikkan di **DUA** tempat — tabel 58→**68**,
`sm_machines` 14→**16**:

- `scripts/db-rebuild.sh` (gate lokal)
- `.github/workflows/ci.yml` (job `db-and-migrations`)

Keduanya menegakkan hal yang sama dan **mudah ketinggalan satu**: sesi ini
menaikkan yang pertama saja, dan CI merah dengan `expected 14 machines`
sementara seluruh test suite hijau. Kalau menambah tabel atau mesin, ubah
keduanya dalam commit yang sama.

`notif_events` di kedua gate TETAP **17** — itu yang membuat penambahan event
tanpa keputusan O55 langsung merah.

---

## 5. Pertanyaan terbuka yang memblokir klaim

O54 / O55 / O56 dari SESI1 **semuanya masih terbuka**. Yang baru:

| # | Butuh dari | Memblokir |
|---|---|---|
| **O57** | Yohan / Yulianti | **CDPS tidak punya entitas CONTRACT.** M6A menggantungkan Rule 2, D-1 dan generasi periode Plan padanya. Yang diambil: Strategi diikat ke `service_id`, durasi + jendela kontrak dideklarasi AM (preseden M6C GA-2). Akibatnya Rule 7 ("floor read-only, ditarik dari Contract") belum punya sumber otoritatif — mitigasinya kolom `sumber_floor ∈ kontrak\|input_am`, bukan penyelesaian. **Murah dibalik sekarang, mahal setelah periode Plan M6B digenerate di atasnya** |

---

## 6. Jebakan sesi ini — tambahan atas SESI1 §5

1. **`strategi` tidak bisa di-DELETE begitu punya riwayat.** `strategi_version`
   append-only, dan DELETE berantai (`ON DELETE CASCADE`) **tetap memicu**
   trigger barisnya. Itu benar untuk produksi dan merepotkan untuk fixture:
   `packages/domain/src/strategi.test.ts` memakai `truncate strategi_version`
   (TRUNCATE melewati trigger baris — preseden `client_health_snapshots` di
   `health.test.ts`) sebelum menghapus induknya.
2. **jsonb lewat postgres.js: JANGAN `JSON.stringify`.** Nilai yang sudah
   di-stringify masuk sebagai *string JSON* (`jsonb_typeof` = `'string'`) dan
   melanggar CHECK `= 'array'`. Serahkan objek/array apa adanya
   (`${nilai as never}`), seperti `plangate.ts` sudah lakukan.
3. **Route file Next tidak boleh meng-export apa pun selain handler HTTP.**
   Mapper wire masuk hidup di `apps/api/src/lib/wire.ts` — yang memang
   satu-satunya tempatnya menurut CLAUDE.md.

---

## 7. PROMPT untuk sesi berikutnya — salin utuh

```
Lanjutkan pembangunan M6A (form Section A→J) di CDPS.

BACA DULU, urut:
1. docs/handoff/HANDOFF_M6ABC_SESI2.md   ← posisi persis (ini yang terbaru)
2. docs/handoff/HANDOFF_M6ABC_SESI1.md   ← §4 (PR #98 memblokir db push) & §5
                                           (cara walk HTTP + dua jebakannya)
                                           MASIH BERLAKU
3. docs/backlog/M6ABC_BACKLOG.md         ← A-05…A-12 (M6A) & B-01…B-11 (M6B)
4. docs/prd/CDPS_Module6A_Strategi.md    ← §4 Section A→J, penuh
5. docs/DECISIONS.md, cari O54/O55/O56/O57
6. CLAUDE.md                             ← aturan rumah; Go/MySQL PENSIUN

KEADAAN SEKARANG:
- Gerbang M6C SELESAI (sesi 1). Kerangka M6A SELESAI (sesi 2): entitas VND-,
  entitas STRG- + 8 tabel anak, mesin #15, 17 route, tipe FE, walk HTTP 40/40.
- BELUM: field per Section (A-05…A-09), dua tier visibilitas (A-10), tautan
  klien /s/{token} (A-11), versioning UI (A-12), dan seluruh M6B.
- Persetujuan STRG BELUM membuka gerbang Brief — gerbangnya masih membaca
  entitas M6 §4 lama. Penyambungannya ikut penggantian form.

TUGAS: A-05 (Section A, 16 field) lalu A-06 (Section B per channel), kecuali
saya bilang lain. Keduanya ALTER di atas tabel yang sudah ada + field form +
tambahan ke checkCompleteness — bukan desain ulang.

BATASAN YANG TIDAK BOLEH DILANGGAR:
- Jangan tambah baris ke notif_events (O55 masih menunggu tanda tangan).
- Format ID PREFIX-YYYYMM-NNNN (CLAUDE.md #1), BUKAN STRG-YYYY-NNNNN.
- Riwayat immutable hidup di audit_log + strategi_version (append-only).
- Transisi status HANYA lewat sm_transition. Jangan daftarkan edge
  `Aktif → Draft Revisi` — bertentangan dengan Rule 13, sudah dicatat.
- Migrasi HANYA lewat supabase/migrations/** + db push / apply_migration.
  JANGAN psql -f.
- Lima migrasi belum diterapkan ke live; db push masih terblokir PR #98.
- KNOWN_GAPS di apps/api/src/lib/route-parity.test.ts harus tetap KOSONG, dan
  setiap wire interface baru wajib punya tipe FE di WIRE_TO_FE.
- Response snake_case, diterjemahkan HANYA di apps/api/src/lib/wire.ts. Kunci
  yang HILANG lebih berbahaya daripada null.

VERIFIKASI YANG SAYA HARAPKAN:
- npm run db:rebuild -- --yes  (update gate jumlah tabel kalau menambah tabel)
- DATABASE_URL=... npm test --workspaces --if-present
- npx vitest run --root web-internal      ← TERPISAH
- walk HTTP lewat route nyata (pola SESI1 §5), bukan cuma memanggil domain
- npx next build web-internal

Kalau PRD ambigu atau dua modul bertabrakan: STOP dan catat di DECISIONS.md.
Jangan diam-diam memilih tafsir.

Kerjakan di branch claude/m6ab-strategi-plan-3x7p0a, commit, push. Jangan buka
PR kecuali saya minta.
```
