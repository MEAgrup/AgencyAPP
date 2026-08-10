# HANDOFF — M6A/M6B/M6C Sesi 15 (titik mulai sesi berikutnya)

> Rantai: SESI1 → … → SESI14 → **SESI15 (ini, terbaru)**. Baca yang bernomor
> tertinggi lebih dulu; sesi sebelumnya hanya untuk konteks sejarah.

## 0. CARA MELANJUTKAN DI CHAT BARU — baca ini dulu

| | |
|---|---|
| **Repo** | `MEAgrup/AgencyAPP` |
| **Branch** | `claude/handoff-sesi14-m6abc-28hc3m` — **PR sesi ini (B-01 + B-02)**. Sudah merge → cabang BARU dari `main`; belum → lanjut di branch yang sama |
| **`main` di** | `6ed2534` saat branch ini bercabang |

**Sesi ini menyelesaikan B-01 + B-02.** M6B: 8% → **25%**. Dua commit:
`7cafb9f` (B-01 bentuk) → `ce5aa11` (B-02 generasi).

### 0.1 DB lokal — WAJIB, dan Postgres MATI SENDIRI

`packages/domain` melapor **~670 skip** tanpa `DATABASE_URL`. Sandbox punya PG16
tapi **tidak jalan otomatis** dan **mati sendiri** (terjadi lagi di sesi ini —
tengah menjalankan test, semua timeout; nyalakan ulang lalu `db-rebuild`).

```bash
# nyalakan (ulangi kapan pun `pg_isready` bilang "no response")
mkdir -p /var/run/postgresql && chown postgres:postgres /var/run/postgresql
su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D /var/lib/postgresql/16/main \
  -o '-c config_file=/etc/postgresql/16/main/postgresql.conf' \
  -l /var/lib/postgresql/pg.log start"
su postgres -c "psql -q -c \"alter role postgres with password 'postgres'\""   # HANYA pertama kali
npm ci && scripts/db-rebuild.sh --yes
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps" npm test --workspaces --if-present
```

⚠️ Jangan pipe eslint (`npx eslint; echo $?`). Lint hanya `@cdps/api` &
`web-internal`; `packages/domain` tidak dilint di CI.

### 0.2 Posisi persis (sesudah B-02)

| | |
|---|---|
| Migrasi | **74 berkas** · gerbang tabel **89** · prefix 31 · mesin **17** · event 34 · `CATALOG_VERSION` 4 |
| Test | `apps/api` **340** · `core` **137** · `db` **15** · `domain` **958 + 1 skip** (`plan` 19: 14 shape + 3 `computePeriods` + 2 `generate`) · db-rebuild semua gate + 4 invariant hijau · `@cdps/api` lint bersih · `KNOWN_GAPS` kosong |
| Live `CDPS SG` | ⚠️ **BELUM disusul migrasi B-01** — lihat §2 |
| Menggantung | Kode: **NOL**. Keputusan: X-16 · X-17 · O60 · O47b · O42-b · O59-b · O24 · O45 · X-06 · X-12 |

## 1. Apa yang berubah — B-01 (`7cafb9f`) + B-02 (`ce5aa11`)

- **B-01** — bentuk `PLAN` + 6 anak (`plan_target`/`plan_row`/`plan_row_week`/
  `plan_actual`/`plan_review`/`plan_flag`, tabel 82→89) + mesin #16 (16→17,
  STATE_MACHINES §6d). `lingkup ∈ kontrak/klien`; `nilai_strategi` beku trigger;
  `ck_plan_row_asal_tunggal`; RLS + 4 anak di ledger O48.
- **B-02** — `computePeriods` (murni) + `generatePlanPeriods` di `plan.ts`,
  dipasang **di dalam transaksi `approveStrategi`** (Rule 1). Prefill target dari
  D-2. Idempoten per kontrak.

### 1.1 Dua hal yang paling mudah salah dibaca

1. **Tidak ada `createPlan`.** Periode HANYA lahir di `approveStrategi`
   (Rule 1). Jangan tambahkan tombol/route "buat Plan".
2. **`generatePlanPeriods` hanya SEED target, bukan baris kerja.** Rangka baris
   E+F sengaja tidak digenerasi — `divisi_pic` NOT NULL tanpa default PRD =
   karangan (DECISIONS 2026-08-10). Baris diisi AM lewat form.

### 1.2 Konsekuensi FK yang wajib diingat

`plan.contract_id`/`plan.strategi_id` = **`ON DELETE CASCADE`**. Sebab: begitu
`approveStrategi` menggenerasi periode, cleanup test yang menghapus
`strategi`/`contracts` akan kena FK kalau bukan cascade. Di prod keduanya tak
pernah di-DELETE, jadi cascade = jaring pengaman + kebersihan test. **Test yang
mengapprove Strategi kini otomatis punya baris `plan`** — kalau menulis test
baru yang approve lalu hapus manual, hapus `plan` dulu atau andalkan cascade.

## 2. 🔴 Live `CDPS SG` — B-01/B-02 BELUM disusul

Migrasi `20260810000000_m6b_plan.sql` belum di-`apply_migration` ke live.
`strategi` live 0 baris ⇒ nol data terdampak. Sesudah PR merge: `apply_migration`
→ verifikasi lewat isi (live harus 89 tabel, `sm_machines` 17, sidik jari
`ck_plan_*` + edge mesin `plan` cocok DB lokal). B-02 murni kode (tak ada
migrasi baru selain B-01), jadi cukup satu susulan migrasi.

## 3. 🔴 TUGAS BERIKUTNYA — M6B, urut

### 3.1 B-03 — gerbang transisi mesin #16 + wrapper `transitionPlan` (BERIKUTNYA)

Edge sudah didaftar (B-01). Yang kurang lapisan domain:
- Wrapper `transitionPlan(sql, actor, planId, to)` (pola `strategi` transition di
  `strategi.ts`) yang memaksa gerbang.
- **Periode 1** `Diajukan → Aktif` requireLead (SPV); `Diajukan → Draft`
  (dikembalikan, catatan wajib).
- **Periode 2..n** auto `Terjadwal → Aktif` (job 00:00 WIB — B-09), TIDAK lewat
  seorang lead. `Menunggu Persetujuan` HANYA saat ada penyesuaian `Turun >10%`
  tertunda (kaitannya ke B-04). Kalau tak terjawab di tanggal mulai ⇒ aktif
  dengan target Strategi asli.
- Notifikasi `plan_periode_aktif` dll — **katalog belum didaftar** (v-next,
  butuh tanda tangan Hans PA-8/O55). Emisikan hanya setelah event terdaftar.

### 3.2 Sisa M6B (urut backlog)

B-04 penyesuaian asimetris Rule 9 + `defisit_terbawa` (level kontrak, computed) ·
B-05 trigger Σ minggu = `plan_row.kuota` (kolom `plan_row_week` sudah ada) ·
B-06 realisasi hybrid + **blok UPDATE metrik `otomatis` untuk role AM** (invariant
beku: TS predikat + RLS tak boleh menyimpang) · B-07 tutup transaksional · B-08
carry-over (`plan_row.terbawa`/`periode_asal_id` sudah ada) · B-09 job WIB · B-10
Plan Satuan + mesin #17 + **`status_dormansi`** (belum dibuat — lihat §4) + B-11
index integritas §4(b). Kolomnya sudah ada di B-01; sisanya perilaku.

## 4. Sisa M6A + keputusan pemilik (tak berubah dari SESI13/14)

- **A-11** (`/s/{token}`) DIBLOKIR **X-16** · **J-4 diff** (wajib filter
  `shareableFieldIds()`) · **Form Section J** (J-1/J-4 toggle tak terjangkau).
- **X-16** (6 field tak terklasifikasi, memblokir A-11) · **X-17**
  (`setAssumptionStatus` tanpa gerbang) · **O60** (detektor O48 tembus satu
  indireksi — kini **15 baris** ledger: 11 `strategi_*` + 4 `plan_*`).
- **`status_dormansi` + mesin #17** DITUNDA ke B-10 (status tanpa mesin melanggar
  aturan rumah #2; dorman = properti rantai Plan Satuan). `lingkup`+`strategi_id`
  nullable sudah dibuat, jadi B-10 tak perlu migrasi kolom.

## 5. Perintah pertama di chat baru

```bash
# DB nyala + dibangun ulang (§0.1), lalu:
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps" \
  npx vitest run src/plan.test.ts --root packages/domain     # 19 hijau
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps" \
  npx vitest run src/strategi.test.ts --root packages/domain  # approval kini generasi periode
scripts/db-rebuild.sh --yes                                    # gate 89/31/17/34 + 4 invariant
```

`plan.test.ts` merah pada `computePeriods drift` ⇒ math anniversary-month rusak.
`strategi.test.ts` merah pada cleanup/FK ⇒ cascade `plan` putus (lihat §1.2).
`db-rebuild` merah `rls_checks` ⇒ ledger O48 tak sinkron policy.
