# HANDOFF — M6A/M6B/M6C Sesi 14 (titik mulai sesi berikutnya)

> Rantai: SESI1 → … → SESI13 → **SESI14 (ini, terbaru)**. Baca yang bernomor
> tertinggi lebih dulu; sesi sebelumnya hanya untuk konteks sejarah.

## 0. CARA MELANJUTKAN DI CHAT BARU — baca ini dulu

| | |
|---|---|
| **Repo** | `MEAgrup/AgencyAPP` |
| **Branch** | `claude/handoff-sesi14-m6abc-28hc3m` (PR sesi ini). Sudah merge → cabang BARU dari `main`; belum → lanjut di branch yang sama |
| **`main` di** | `6ed2534` (merge PR #114) saat sesi ini mulai |

**Sesi ini menyelesaikan B-01** — pekerjaan M6B pertama sejak B-00 (Contract).
M6B pindah dari 8% ke 17%.

### 0.1 DB lokal — WAJIB, dan angka test menyesatkan tanpanya

Identik SESI13. `packages/domain` melaporkan **~670 skip** kalau `DATABASE_URL`
tidak di-set — itu berarti Anda tidak menguji apa pun yang menyentuh DB. Sandbox
punya PostgreSQL 16 tapi **tidak berjalan otomatis** dan **mati sendiri** setelah
beberapa saat.

```bash
# 1. nyalakan (ulangi kapan pun `pg_isready` bilang "no response")
mkdir -p /var/run/postgresql && chown postgres:postgres /var/run/postgresql
su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D /var/lib/postgresql/16/main \
  -o '-c config_file=/etc/postgresql/16/main/postgresql.conf' \
  -l /var/lib/postgresql/pg.log start"
# 2. HANYA PERTAMA KALI
su postgres -c "psql -q -c \"alter role postgres with password 'postgres'\""
# 3. bangun DB dari nol (74 migrasi + seed + gate + 4 invariant SQL)
npm ci && scripts/db-rebuild.sh --yes
# 4. jalankan
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps" npm test --workspaces --if-present
```

⚠️ **Jangan pipe eslint.** `npx eslint | tail` membuat exit code jadi milik
`tail`. Jalankan `npx eslint; echo $?`. (Lint hanya untuk `@cdps/api` &
`web-internal` — `packages/domain` tidak dilint di CI.)

### 0.2 Posisi persis (sesudah B-01)

| | |
|---|---|
| Migrasi | **74 berkas** · gerbang tabel **89** · prefix 31 · mesin **17** · event 34 · `CATALOG_VERSION` 4 |
| Test | `apps/api` **340** · `packages/core` **137** · `packages/db` **15** · `packages/domain` **952 + 1 skip** (+14 `plan`) · db-rebuild semua gate + 4 invariant hijau · `@cdps/api` lint bersih · `KNOWN_GAPS` tetap **kosong** |
| Live `CDPS SG` | ⚠️ **BELUM disusul migrasi B-01** — lihat §2 |
| Menggantung | Kode: **NOL**. Keputusan: X-16 · X-17 · O60 · O47b rewrite · O42-b · O59-b · O24 · O45 · X-06 · X-12 |

## 1. Apa yang berubah di sesi ini — B-01

Satu migrasi, satu modul domain, satu berkas test. **Bentuk** M6B berdiri; belum
ada satu pun perilakunya (itu B-02…B-11).

| Berkas | Isi |
|---|---|
| `supabase/migrations/20260810000000_m6b_plan.sql` | Tabel `plan` + 6 anak (82→89), mesin #16 (16→17), RLS, trigger immutability `nilai_strategi` |
| `packages/domain/src/plan.ts` | Types + mapper + reads (`getPlan`/`getPlanDetail`/`listPlansForContract`/`listPlansForClient`) + `canReadPlan`/`canWritePlan`. **Tanpa write** |
| `packages/domain/src/plan.test.ts` | 14 test: mesin #16, shape `lingkup`, `nilai_strategi` beku, asal-tunggal baris, hybrid actuals, Rule 5 satu `Aktif` |
| STATE_MACHINES §6d · DATA_MODEL · DECISIONS (3 baris) · backlog · ci.yml · db-rebuild.sh · rls_checks (ledger O48) | dok + gate |

### 1.1 Yang paling mudah salah dibaca: B-01 adalah BENTUK, bukan perilaku

`plan.ts` sengaja **tidak punya `createPlan`**. Rule 1: periode lahir HANYA saat
Strategi disetujui (generasi = B-02), bukan dibuat manual. Test menyisipkan
periode langsung lewat SQL (persis yang generator B-02 akan lakukan). Kalau chat
berikutnya mencari "kenapa tidak ada tombol buat Plan" — memang belum ada, dan
tidak boleh ada jalur manual.

### 1.2 Mesin #16 di B-01, gerbangnya di B-03 — sengaja

`sm_edges` mesin `plan` didaftarkan di B-01 (mengikuti preseden A-03+A-04 satu
migrasi: kolom `status` tak bermakna tanpa mesinnya). Tapi **edge = "transisi
mana yang sah"**, bukan **"siapa & kapan"**. Gerbang domain (periode 1 butuh SPV,
2..n auto 00:00 WIB, `Menunggu Persetujuan` hanya untuk `Turun >10%`) adalah
**B-03**. `Terjadwal → Aktif` sengaja **bukan** `require_lead` — aktivasi auto
dijalankan job service-role (B-09), bukan seorang lead.

### 1.3 `status_dormansi` DITUNDA ke B-10 (beda dari kalimat backlog B-01)

Backlog B-01 menyebut `status_dormansi`. **Tidak dibuat.** Ia sebuah status, dan
aturan rumah #2 melarang kolom status tanpa mesin di STATE_MACHINES.md. Mesin #17
(`Aktif ⇄ Dorman`) adalah rancangan B-10 — dorman itu properti RANTAI periode
Plan Satuan, bukan satu periode. `lingkup` & `strategi_id` nullable **sudah**
dibuat, jadi B-10 tak perlu migrasi kolom. (DECISIONS 2026-08-10; preseden
`contracts` menolak mesin kosong.)

## 2. 🔴 Live `CDPS SG` — B-01 BELUM disusul

Berbeda dari A-08/A-09/A-10 yang sudah direkonsiliasi ke live, migrasi B-01
**belum** di-`apply_migration` ke `CDPS SG`. `strategi` live masih 0 baris, jadi
nol data terdampak, tapi urutan rumah tetap: merge PR → `apply_migration` →
verifikasi lewat isi (tabel live harus 89, `sm_machines` 17, sidik jari
`ck_plan_*` cocok DB lokal). Lakukan sesudah PR sesi ini merge.

## 3. 🔴 TUGAS BERIKUTNYA — M6B, urut

### 3.1 B-02 — generasi periode (tiket berikutnya yang wajar)

Anniversary-month dari `contracts.tanggal_mulai` + `strategi.tanggal_mulai_siklus`
(G-0/Rule 17). n periode = `contracts.durasi_bulan`. Periode 1 = `Draft`, 2..n =
`Terjadwal`, tiap-tiap prefilled target dari D-2 (`plan_target`, arah `tetap`,
`nilai_dipakai = nilai_strategi`) + rangka baris dari E/F. Lahir HANYA saat
Strategi disetujui (kait ke transisi `Diajukan → Aktif` strategi).

⚠️ **Simpan day-of-month yang DIMAKSUD terpisah** dari tanggal terhitung: start
tanggal 31 tidak boleh hanyut permanen ke 28 setelah lewat Februari. Kolom itu
BELUM ada di `plan` (B-01 tak membuatnya) — B-02 menambahnya, atau menaruhnya di
mana ia paling masuk akal (mungkin `contracts`/`strategi`, karena siklusnya
milik kontrak, bukan tiap periode). Pikirkan sebelum menambah kolom.

### 3.2 B-03 — gerbang transisi + wrapper `transitionPlan` domain

Edge sudah ada. Yang kurang: wrapper domain yang memilih tujuan & memaksa peran
(periode 1 `Diajukan → Aktif` requireLead; auto 2..n via job). Pola: lihat
`strategi` transition di `packages/domain/src/strategi.ts`.

### 3.3 Sisa M6B: B-04 (penyesuaian asimetris Rule 9 + `defisit_terbawa`), B-05
(trigger Σ minggu), B-06 (hybrid actuals + blok UPDATE metrik otomatis role AM),
B-07 (tutup transaksional), B-08 (carry-over), B-09 (job WIB), B-10 (Plan Satuan
+ mesin #17 + `status_dormansi`), B-11 (index integritas §4(b)). Kolomnya sudah
ada di B-01; yang tersisa perilaku.

## 4. Sisa M6A yang belum tuntas (dari SESI13, MASIH berlaku)

- **A-11** (`/s/{token}` HTML klien) — masih **DIBLOKIR X-16** (enam tier field
  belum diputus pemilik). `shareableFieldIds()` pintu tunggal. Jangan tulis
  filter kedua di renderer.
- **J-4 diff** — sisa terakhir A-12, tidak diblokir. ⚠️ **wajib memfilter
  barisnya sendiri lewat `shareableFieldIds()`** apa pun tier J-4 (baca SESI13
  §3.2 — auto-diff merender perubahan pada field hard-internal lewat pintu
  belakang).
- **Form Section J** — `WIRED` di `page.tsx` A…I; J-1/J-4 punya toggle
  visibilitas tak terjangkau sampai form-nya ada.

## 5. 🟡 Keputusan menunggu pemilik (tak berubah dari SESI13)

X-16 (enam field tak terklasifikasi — sekarang lebih mendesak, memblokir A-11) ·
X-17 (`setAssumptionStatus` tanpa gerbang status) · O60 (detektor O48 tembus satu
indireksi — sekarang 15 baris ledger: 11 `strategi_*` + 4 `plan_*`). Lihat SESI13
§4 untuk detailnya.

## 6. Perintah pertama di chat baru

```bash
# DB nyala + dibangun ulang (lihat §0.1), lalu:
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps" \
  npx vitest run src/plan.test.ts --root packages/domain
scripts/db-rebuild.sh --yes   # semua gate 89/31/17/34 + 4 invariant harus hijau
```

`plan.test.ts` merah pada `machine #16` ⇒ mesin tidak terdaftar / edge berubah.
`db-rebuild` merah pada `rls_checks` ⇒ ledger O48 tak sinkron dengan policy baru.
`tabel public 89` merah ⇒ ada migrasi tabel yang belum menaikkan gate di ci.yml
**dan** db-rebuild.sh (keduanya, di commit yang sama).
