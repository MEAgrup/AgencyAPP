# HANDOFF — M6A/M6B/M6C Sesi 20 (titik mulai sesi berikutnya)

> Rantai: SESI1 → … → SESI18 → SESI19 → **SESI20 (ini, terbaru)**. Baca yang
> bernomor tertinggi lebih dulu; sesi sebelumnya hanya konteks sejarah.

## 0. CARA MELANJUTKAN DI CHAT BARU — baca ini dulu

### 0.0 Posisi branch (persis, per akhir sesi 19→20 — SUDAH MERGE)

| Hal | Nilai |
|---|---|
| **Repo** | `MEAgrup/AgencyAPP` |
| **`main` (default)** | memuat **B-00…B-07 + M6A A-00…A-13d + #123 admin/employees**. **B-06 + B-07 SUDAH di `main`** lewat merge commit **`05608a4`** (PR **#124**). **MULAI B-08 DARI SINI.** |
| **PR ter-merge** | **#124** — B-06 realisasi hybrid + B-07 penutupan transaksional (di-rebase bersih ke `main` terkini lalu di-merge bersama). Branch kerja `claude/handoff-m6abc-sesi19-l35gzg` sudah merge, boleh dihapus |
| **PR ditutup** | **#121** — B-06 lama (jadi *dirty* setelah #123); digantikan #124 |
| **PR MASIH TERBUKA** | **#115** — M6A A-11 (`/s/{token}`) + X-16/X-17 (keputusan pemilik) |
| **Branch untuk B-08** | Buat BARU dari `main`: `git fetch origin main && git checkout -B claude/b-08-carry-over origin/main` |

> ⚠️ **Catatan riwayat (sudah selesai, tak perlu tindakan):** B-07 semula ditumpuk
> di atas B-06 karena #121 belum merge saat sesi 19→20 mulai; lalu #123
> (admin/employees, keputusan final pemilik untuk halaman karyawan) masuk `main`
> dan membuat #121 *dirty*. B-06 + B-07 di-rebase bersih ke `main` terkini
> (konflik HANYA `docs/DECISIONS.md` — kedua baris #123 dipertahankan) dan
> di-merge sebagai satu PR #124. Tidak ada sisa yang menggantung.

### 0.1 DB lokal — WAJIB, dan Postgres MATI SENDIRI

Sama dengan SESI18/19 §0.1: PG16 ada tapi tidak jalan otomatis & mati sendiri.
Nyalakan ulang + `db-rebuild` kapan pun `pg_isready` bilang "no response".

```bash
mkdir -p /var/run/postgresql && chown postgres:postgres /var/run/postgresql
su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D /var/lib/postgresql/16/main \
  -o '-c config_file=/etc/postgresql/16/main/postgresql.conf' \
  -l /var/lib/postgresql/pg.log start"
su postgres -c "psql -q -c \"alter role postgres with password 'postgres'\""   # HANYA pertama kali
npm ci && scripts/db-rebuild.sh --yes
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps" npm test --workspaces --if-present
```

⚠️ Lint CI hanya `@cdps/api` & `web-internal` (root-level, BUKAN workspace —
`cd web-internal && npm run lint`); `packages/domain` tidak dilint (typecheck iya).

### 0.2 Posisi persis (sesudah B-07)

| | |
|---|---|
| Migrasi | **76 berkas — tidak berubah** (B-07 NOL migrasi) · gerbang tabel **89** · prefix 31 · mesin **17** · event 34 · `CATALOG_VERSION` 4 |
| Test | `apps/api` **340** · `core` **137** · `db` **15** · `domain` **1035 + 1 skip** (`plan.test.ts` **90** + `plan.reals.test.ts` **7**) · db-rebuild gate + invariant hijau · typecheck 4 workspace bersih · `KNOWN_GAPS` kosong |
| Live `CDPS SG` (`egddxfcnrtecheiykhlf`) | ✅ **≡ repo s/d B-06** — B-07 NOL migrasi, jadi **tak ada penyusulan live** yang dibutuhkan. (B-06 sudah di-apply per SESI19.) |
| Menggantung | Kode: **NOL** (M6B s/d B-07). Keputusan pemilik: X-06 · X-08 (`jam_live` manual?) · X-12 · X-16 · X-17 · O59-b · O42-b · O60 · O47b |

## 1. Apa yang berubah sesi ini — B-07 penutupan transaksional

`packages/domain/src/plan.ts` + `packages/domain/src/plan.test.ts`. **NOL migrasi.**
Detail penuh: `docs/DECISIONS.md` 2026-08-10 (B-07) + `docs/backlog/M6ABC_BACKLOG.md`.

**Rule 15 — "penutupan itu langkah nyata, bukan tanggal".** Dua jalur tutup dari
dua edge `Aktif → {Ditutup, Ditutup Otomatis}` (didaftar B-01):

- **`closePlanPeriode(sql, actor, planId)`** (AM, `Aktif → Ditutup`) — menegakkan
  TIGA precondition Rule 15 **dalam satu transaksi, atau tidak sama sekali**:
  1. GMV manual ada untuk **setiap channel** ber-target GMV (PE-1);
  2. setiap `plan_row` **terminal** (`Selesai`/`Sebagian`/`Tidak Dikerjakan`, dua
     terakhir + alasan);
  3. review P-F lengkap.
  Gagal satu → `ValidationError` dengan pesan BI persis untuk precondition
  **PERTAMA** yang tak terpenuhi, **nol perubahan** ("partial close bukan state"
  ditegakkan oleh transaksi, bukan status antara).
- **`forceClosePlanPeriode(sql, actor, planId)`** (sistem, `Aktif → Ditutup
  Otomatis`) — TIDAK menegakkan precondition; memaksa tiap baris non-terminal →
  `Tidak Dikerjakan` beralasan `tanpa keterangan` (konstanta `FORCE_CLOSE_ALASAN`,
  sengaja jelek di laporan), baris terminal nyata AM dipertahankan. **Tak
  menyentuh `plan_actual`** (X-07: tutup tak mengunci).

**Gerbang murni:** `checkCloseReadiness(...)` (teruji tanpa DB) satu-sumber
"layak tutup" — juga membawa flag `varianceNegative` yang menentukan apakah PF-3
wajib.

**Jalur tulis pendukung** (yang membuat gate itu terjangkau & teruji):
- `setRowStatus(sql, actor, planRowId, status, alasan?)` — PC-14, alasan wajib
  `Sebagian`/`Tidak Dikerjakan`, alasan basi dibersihkan saat pindah ke non-
  terminal/`Selesai`, hanya saat `Aktif`.
- `savePlanReview(sql, actor, planId, input)` — Section P-F, **full-replace**
  (form P-F kirim seluruh review; field yang tak dikirim = null, tak di-merge),
  hanya saat `Aktif`.

**Keputusan tercatat (DECISIONS 2026-08-10 B-07):**
- **PF-3 (Diagnosa Gap) wajib HANYA saat variance negatif** (Σ GMV aktual manual
  < Σ GMV `nilai_dipakai`) — persis "W (kalau variance negatif)" PRD; saat wajib,
  butuh enum DAN bukti PE-8.
- **PF-4 (status asumsi → `strategi_assumption`) & PF-5 (carry-over →
  `plan_row.terbawa`) BUKAN precondition di sini** — keduanya bukan kolom
  `plan_review`. Mekanisme carry-over = **B-08**.
- `forceClose` seperti `activatePlanPeriode`: bukan lead-gated tapi wajib
  `canWritePlan`; aktor job mana yang menjalankannya = keputusan **B-09**.
- Notifikasi (`plan_periode_ditutup`) TIDAK diemisikan (katalog M6B belum
  terdaftar, PA-8/O55) — seam sama B-03…B-06.

## 2. 🔴 TUGAS BERIKUTNYA — M6B, urut (sisa 4 tiket kode)

### 2.1 B-08 — carry-over eksplisit (BERIKUTNYA)

PRD Rule 16 / PF-5. Baris `Sebagian`/`Tidak Dikerjakan` di periode yang ditutup →
keputusan per baris: **dibawa** / **dibatalkan** / **naik jadi revisi Strategi**.
Baris terbawa muncul di periode berikutnya ditandai `Terbawa` + periode asalnya —
kolom **`plan_row.terbawa` / `periode_asal_id` sudah ada** (B-01), `fk_plan_row_asal`
juga. **PLUS** bagian §263 yang B-04 tunda: **Σ negative variance yang dipilih
dibawa masuk ke `defisit_terbawa`** — `defisit_terbawa` saat ini (B-04) hanya
menghitung penyesuaian target turun; B-08 menambah komponen negative-variance.
⚠️ Perhatikan: keputusan carry-over diambil **per baris tak-selesai** (bukan
otomatis) — kemungkinan butuh kolom/tabel untuk merekam pilihan (dibawa/batal/
revisi) ATAU cukup jejak audit + flag `terbawa`. Baca §263 `defisit_terbawa`
(computed, jangan jadikan kolom) + cara `deficitOfChain` di `plan.ts` sebelum
memutuskan bentuk.

### 2.2 Sisa M6B

B-09 job WIB (00:00 aktivasi — panggil `activatePlanPeriode` — + **force-close
`Ditutup Otomatis`** = panggil `forceClosePlanPeriode` yang B-07 sediakan — +
tengah-periode `Baris Belum Dieksekusi` + tutup+5hr `plan_realisasi_belum_lengkap`;
idempoten; keterlambatan ke audit log TAPI belum ke KPI — X-12; aktor job = lihat
catatan B-07) · B-10 Plan Satuan + mesin #17 + `status_dormansi` (**menutup Rule 6
M6C**) · B-11 constraint integritas §4(b).

## 3. Sisa M6A + keputusan pemilik

Sama dengan SESI18/19 §3: **PR #115** (A-11 `/s/{token}` + X-16/X-17) masih
terbuka; Form Section J (J-1/J-4 toggle tak terjangkau) + J-4 diff. Tak berubah
sesi ini.

## 4. Katalog notifikasi (blocker lintas-modul) — TETAP

Event M6B (`plan_periode_aktif`, `plan_periode_ditutup`,
`plan_realisasi_belum_lengkap`, sengketa→SPV, dll) **belum terdaftar** di
`notif_events` — butuh **PA-8/O55**. Semua seam notifikasi B-03…B-07 sengaja
**TIDAK emit**. Emisikan hanya setelah katalog dinaikkan.

## 5. Perintah pertama di chat baru

```bash
# DB nyala + dibangun ulang (§0.1), lalu:
scripts/db-rebuild.sh --yes                                    # 76 migrasi, gate 89/31/17/34 + invariant
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps" \
  npx vitest run src/plan.test.ts src/plan.reals.test.ts --root packages/domain   # 97 hijau (90 + 7)

# lalu mulai B-08 (B-06 + B-07 sudah di main via #124):
git fetch origin main && git checkout -B claude/b-08-carry-over origin/main
```

`checkCloseReadiness` merah ⇒ definisi "layak tutup" bergeser: cek urutan
precondition (gmv → baris terminal → review) dan syarat PF-3 (wajib hanya saat
variance negatif). `closePlanPeriode` merah "masih Aktif setelah gagal" ⇒
transaksi tak roll-back / precondition dicek setelah transisi (harus SEBELUM).
`forceClosePlanPeriode` merah "baris terminal ikut ditimpa" ⇒ filter `status_baris
not in (…)` keliru — baris `Selesai`/`Sebagian`/`Tidak Dikerjakan` nyata AM harus
dipertahankan. `setRowStatus`/`savePlanReview` merah pada gate `Aktif` ⇒ status
periode salah dibaca.
