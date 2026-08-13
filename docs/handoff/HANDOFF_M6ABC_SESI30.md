# HANDOFF — "Kelola Klien" langkah 1 **Riset Awal** (bagian 1: pengukuran waktu) — Sesi 30

> Rantai: … → SESI28 (langkah 4–6, #137) → SESI29 (prasyarat bagian 2) → **SESI30 (ini, terbaru)**.
> Baca yang bernomor tertinggi lebih dulu; sesi sebelumnya hanya konteks sejarah.
>
> SESI30 menutup temuan QA pemilik 2026-08-12: **alur "Kelola Klien" kehilangan satu langkah**.
> Yang dikerjakan = **bagian 1 dari 2** yang pemilik minta (pengukuran waktu). **Bagian 2
> (kolom isian riset awal) BELUM dikerjakan** — spesifikasinya di §3.

## 0. CARA MELANJUTKAN DI CHAT BARU — baca ini dulu

### 0.0 Posisi branch

| Hal | Nilai |
|---|---|
| **Repo** | `MEAgrup/AgencyAPP` |
| **Branch sesi ini** | `claude/qa-riset-awal-step-1r347m` (dari `main` @ `3cf31b8`, merge PR #148) |
| **Mulai kerja berikut** | Kalau branch ini SUDAH merge: `git fetch origin main && git checkout -B <branch-baru> origin/main`. Kalau BELUM: lanjut di branch ini. JANGAN menumpuk di atas history yang sudah merge. |

### 0.1 Apa yang pemilik minta (verbatim, diringkas)

Ketika AM klik "Kelola Klien" seharusnya ada **3 langkah**:

1. **Riset awal** — user login toko klien dan mencatat semua data baseline
2. **Interview**
3. **Buat strategi**

Semua langkah **diukur** supaya timeline tidak terlewat (berpengaruh ke kinerja klien).
CDPS hanya punya langkah 2 & 3. Pemilik membagi perbaikannya jadi dua:

- **Langkah 1 (SELESAI sesi ini):** catat kapan riset awal dimulai (klik "Kelola Klien" =
  sudah mulai riset awal) dan kapan submit, lalu hitung lamanya.
- **Langkah 2 (BELUM):** kolom isian riset awal — sebagian pindahan dari daftar
  pertanyaan Interview.

PRD (M6 / M6A) **tidak pernah menyebut** langkah ini ⇒ ini penambahan atas permintaan
pemilik, tercatat di `docs/DECISIONS.md` **2026-08-12** (baris teratas).

### 0.2 DB lokal — WAJIB sebelum kerja DB/domain/api

Sandbox PG16 (CI = PG17, otoritas). Bootstrap yang dipakai sesi ini — perhatikan `initdb`
**tidak bisa jalan sebagai root**, jalankan lewat user `postgres`:

```bash
BASE=/tmp/cdpspg; PGBIN=/usr/lib/postgresql/16/bin
mkdir -p $BASE && chown -R postgres:postgres $BASE
su postgres -c "$PGBIN/initdb -D $BASE/data -U postgres --auth=trust"
su postgres -c "$PGBIN/pg_ctl -D $BASE/data -o '-p 5433 -k /tmp' -l $BASE/server.log start"
psql -h 127.0.0.1 -p 5433 -U postgres -d postgres -c "create database cdps;"
for f in $(ls supabase/migrations/*.sql | sort); do
  psql -h 127.0.0.1 -p 5433 -U postgres -d cdps -v ON_ERROR_STOP=1 -q -f "$f"; done
psql -h 127.0.0.1 -p 5433 -U postgres -d cdps -q -f supabase/seed.sql   # 2x (idempotensi)
npm install                       # node_modules TIDAK persist antar sesi
export DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5433/cdps"
```

DB direklaim saat idle — kalau `psql` bilang "Connection refused", `pg_ctl … start` lagi
(datadir biasanya masih ada; kalau hilang, ulangi dari `initdb`).

### 0.3 Posisi persis (akhir sesi 30)

| | |
|---|---|
| Migrasi | **87 berkas** (+ `20260812100000_interview_riset_awal`) |
| Gate CI (ci.yml + db-rebuild.sh) | tabel **105** · mesin **20** · event **44** · prefix **32** — tabel 104→105 (`interview_riset_awal`) dan mesin 19→20 (`riset_awal`) **DINAIKKAN DI KEDUA BERKAS** (gate kembar). Prefix & event TIDAK berubah: riset awal anak `interview` (nol ID baru), nol event notifikasi baru |
| Test | core **213** · db **43** · domain **1148** (+1 skip) · api **345** · web-internal **234** — semua hijau lokal (PG16) |
| Typecheck | `@cdps/core\|db\|domain\|api` + `web-internal` bersih; `web-internal` lint + `next build` hijau |
| Invariant SQL | `auth_claims`/`ident`/`immutability`/`rls_checks` (O48) **PASS** — ledger O48 TIDAK tumbuh (policy baru punya arm lead/divisi inline) |
| `KNOWN_GAPS` (route-parity) | tetap **kosong** |

## 1. Yang berubah sesi ini

Detail penuh + alasan: `docs/DECISIONS.md` **2026-08-12** baris teratas.

### 1.1 Bentuk data — kenapa tabel anak, bukan entitas baru

`interview_riset_awal`, **PK `interview_id`**, 1:1 dengan `interview`, **tanpa prefix ID
baru** (preseden `plan_satuan`: kunci alami = kunci rantai). Riset awal bukan entitas
berdiri sendiri — ia langkah pertama dari SATU sesi Kelola Klien, dan sesi itu = satu ITV.

Kolom: `status` · `dimulai_pada`/`dimulai_oleh` · `disubmit_pada`/`disubmit_oleh`.
**Tidak ada kolom durasi.** Durasi diturunkan saat baca oleh SATU fungsi core
`iv.durasiRisetAwalMenit(mulai, submit)` — `null` selama berjalan (UI `—`, bukan `0`).

### 1.2 Kapan jamnya mulai

Di transaksi yang SAMA dengan `createInterview` (`dbi.startRisetAwal`). **Tidak ada tombol
"mulai"**: membuka Kelola Klien ITU mulainya, sesuai kalimat pemilik. Tombol mulai adalah
tombol yang bisa ditekan terlambat.

### 1.3 Mesin #20 `riset_awal`

`Berjalan → Selesai` (Selesai terminal, **tanpa edge buka-kembali**). Dijalankan
`sm_transition` dengan `id_col='interview_id'` — fungsi SQL-nya memang menerima kolom id
sebagai parameter, jadi tak perlu mengarang surrogate key. Submit = satu baris `audit_log`
immutable ⇒ durasi bisa direkonstruksi **dari log saja** (ada tesnya).

### 1.4 Yang menjaga angkanya tidak bisa dikarang

- Trigger `trg_riset_awal_jangkar`: ubah `dimulai_pada`, timpa `disubmit_pada`, atau balik
  dari `Selesai` ⇒ **ditolak DB**, termasuk lewat service-role.
- CHECK `ck_riset_awal_selesai` (Selesai wajib punya jangkar submit) & `ck_riset_awal_urutan`
  (submit tak pernah mendahului mulai).
- Submit kedua ⇒ **409** `[riset awal sudah disubmit]`, bukan no-op diam.

### 1.5 Konsekuensi ikutan yang WAJIB dipahami sebelum menyentuh modul ini

**Tombol "Kelola Klien" sekarang MELANJUTKAN sesi terbuka, bukan selalu bikin ITV baru.**
`POST /interview` memanggil `interview.openKelolaKlien` (bukan `createInterview` langsung):
kalau klien punya interview non-terminal untuk `service_id` yang sama, ia dikembalikan apa
adanya. Ini bukan kenyamanan — tanpa itu, AM yang kembali setelah dua hari riset akan
mendarat di baris baru dan durasinya tercatat beberapa detik. Efek sampingnya bagus:
penumpukan ITV kosong (yang melahirkan filter log 2026-08-12) berhenti di sumbernya.

`createInterview` **tetap ada** sebagai primitif (dipakai tes + jalur re-interview nanti).

Filter "Riwayat Interview" ditambah satu jalan masuk: riset awal yang **sudah disubmit**
ikut tampil walau interview masih `Belum Dijadwalkan` — itu kerja yang benar-benar tersimpan.
Riset awal yang masih berjalan tetap disembunyikan; jalan kembalinya lewat tombol yang
melanjutkan tadi.

### 1.6 Permukaan API & UI

| Lapis | Perubahan |
|---|---|
| `packages/core/src/interview.ts` | `RISET_AWAL_MACHINE`/`RISET_AWAL_STATES`/`isRisetAwalSelesai`, `durasiRisetAwalMenit`, `durasiBerjalanMenit` (murni, floor, `null`-bukan-`0`) |
| `packages/db/src/interview.ts` | `startRisetAwal` (idempoten), `stampRisetAwalSubmit` (sekali, kembalikan `false` kalau sudah) |
| `packages/domain/src/interview.ts` | `RisetAwal` + `InterviewDetail.risetAwal`, `submitRisetAwal`, `openKelolaKlien`, kolom riset awal di `InterviewListRow`, `MSG_RISET_AWAL_*` |
| `apps/api` | `POST /api/v1/interview/{id}/riset-awal`; `InterviewRisetAwalWire` (+ terdaftar di `WIRE_TO_FE`), `riset_awal` di `InterviewDetailWire`, 4 kolom `riset_awal_*` di `InterviewListRowWire` |
| `web-internal` | Tab "Kelola Klien" jadi **3**: `1 · Riset Awal` (panel baru `RisetAwalPanel`, penghitung berjalan + tombol submit), `2 · Interview / Kualifikasi`, `3 · Strategi & Plan →`. Halaman mendarat di tab 1 selama riset awal berjalan. Kolom "Riset awal" di Riwayat halaman Klien; teks tombol/konfirmasi di halaman Klien & Service menyebut riset awal mulai terhitung |

## 2. Gotcha (baca sebelum lanjut)

1. **Jangan tambah kolom durasi.** Setiap layer menurunkannya dari dua jangkar lewat fungsi
   core yang sama. Menyimpannya = angka yang bisa berbohong terhadap jangkarnya.
2. **Jangan tambah edge `Selesai → Berjalan`** tanpa keputusan pemilik: itu memindahkan
   jangkar yang jadi alasan langkah ini ada.
3. **Belum ada ambang SLA** (berapa lama riset awal boleh berjalan) — fakta bisnis yang
   belum diberikan pemilik. Tercatat sebagai pertanyaan terbuka **RA-1** di `DECISIONS.md`.
   Kalau angkanya turun: config berversi (pola `kualifikasi_config`) + flag harian (pola
   `prasyarat_bersyarat_terlambat`), **bukan** literal di kode.
4. **Sales tidak boleh melihat riset awal.** RLS-nya cermin `interview_jadwal` (scope
   Account) — data baseline toko klien sekelas Blok B, bukan permukaan verdict. Ada tesnya
   di `interview.rls.test.ts` (sales closing melihat verdict, TIDAK melihat riset awal).
5. **Tes berbagi klien fixture.** `openKelolaKlien` mengembalikan sesi terbuka, jadi tes
   "klik berikutnya membuka sesi baru" memakai klien terpisah (`CLI-ZZI-0002`). Kalau
   menambah tes yang meninggalkan sesi terbuka di `CLI-ZZI-0001`, jangan kaget.

## 3. Tugas berikutnya — **bagian 2: kolom isian Riset Awal**

Yang pemilik sebut: *"Ada kolom isian yg diisi (sebagian berisi dari daftar interview).
Artinya ada list interview yg pindah kolom."*

Yang **belum** diketahui dan HARUS ditanyakan ke pemilik sebelum menulis kode — jangan
menebak, ini menentukan skor Blok C:

1. **Field mana persisnya yang pindah** dari daftar pertanyaan Interview (`INTERVIEW_FIELDS`
   di `web-internal/src/lib/interview-fields.ts`, section B0–B11) ke Riset Awal?
2. **Field skor ikut pindah atau tidak?** `SCORED_FIELD_KEYS` di `packages/core/src/interview.ts`
   adalah 15 field yang memberi skor kualifikasi. Kalau salah satunya pindah, ia harus tetap
   sampai ke `hitungKualifikasi` — kalau tidak, verdict berubah diam-diam. Ini pertanyaan
   yang paling mahal kalau salah tebak.
3. **Riset awal jadi prasyarat interview atau tidak?** Sekarang **tidak** memblok apa pun
   (sengaja: pemilik hanya minta pengukuran).

Bentuk yang sudah disiapkan supaya bagian 2 tidak membongkar apa pun: tambah tabel anak
`interview_riset_awal_isian` (pola `interview_answer`: baris per field, kolom bertipe),
BUKAN kolom-kolom baru di `interview_riset_awal` — tabel itu sengaja tipis dan hanya berisi
jangkar waktu.

## 4. Sumber kebenaran
- `docs/DECISIONS.md` 2026-08-12 baris teratas (Decided) + **RA-1** (Open).
- `supabase/migrations/20260812100000_interview_riset_awal.sql` — tabel, trigger, mesin #20, RLS, backfill.
- `docs/STATE_MACHINES.md` §6f · `docs/DATA_MODEL.md` (registry: Interview + Riset Awal).
- `packages/core/src/interview.ts` (durasi + mesin) · `packages/domain/src/interview.ts` (izin + orkestrasi).
- `CLAUDE.md` aturan rumah #2 (mesin), #3 (riwayat immutable), #4 (field terhitung), #7 (`—`).
