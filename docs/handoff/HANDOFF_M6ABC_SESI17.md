# HANDOFF — M6A/M6B/M6C Sesi 17 (titik mulai sesi berikutnya)

> Rantai: SESI1 → … → SESI16 → **SESI17 (ini, terbaru)**. Baca yang bernomor
> tertinggi lebih dulu; sesi sebelumnya hanya untuk konteks sejarah.

## 0. CARA MELANJUTKAN DI CHAT BARU — baca ini dulu

| | |
|---|---|
| **Repo** | `MEAgrup/AgencyAPP` |
| **Branch** | `claude/b-04-penyesuaian-rule9` — **PR sesi ini (B-04)**. Bercabang dari `main` (PR #116 B-01+B-02 **dan** PR #117 B-03 sudah ter-merge). Sudah merge → cabang BARU dari `main`; belum → lanjut di branch yang sama |
| **Basis** | `main` sudah memuat B-01+B-02 (#116) + B-03 (#117). Live `CDPS SG` sudah membawa migrasi B-01 (mesin #16 + tabel `plan`) sejak sebelumnya |

**Sesi ini menyelesaikan B-04.** M6B: 33% → **~42%** (4/12 tiket perilaku + B-00/B-01/B-02).

### 0.1 DB lokal — WAJIB, dan Postgres MATI SENDIRI

`packages/domain` melapor **~670 skip** tanpa `DATABASE_URL`. Sandbox punya PG16
tapi **tidak jalan otomatis** dan **mati sendiri**; nyalakan ulang lalu `db-rebuild`
kapan pun `pg_isready` bilang "no response".

```bash
mkdir -p /var/run/postgresql && chown postgres:postgres /var/run/postgresql
su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D /var/lib/postgresql/16/main \
  -o '-c config_file=/etc/postgresql/16/main/postgresql.conf' \
  -l /var/lib/postgresql/pg.log start"
su postgres -c "psql -q -c \"alter role postgres with password 'postgres'\""   # HANYA pertama kali
npm ci && scripts/db-rebuild.sh --yes
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps" npm test --workspaces --if-present
```

⚠️ Lint hanya `@cdps/api` & `web-internal`; `packages/domain` tidak dilint di CI.

### 0.2 Posisi persis (sesudah B-04)

| | |
|---|---|
| Migrasi | **74 berkas** · gerbang tabel **89** · prefix 31 · mesin **17** · event 34 · `CATALOG_VERSION` 4 (B-04 = perilaku, **NOL migrasi**) |
| Test | `apps/api` **340** · `core` **137** · `db` **15** · `domain` **983 + 1 skip** (`plan.test.ts` **45**: 29 B-01/02/03 + 16 B-04) · db-rebuild semua gate + 4 invariant hijau · `KNOWN_GAPS` kosong · typecheck 4 workspace bersih |
| Live `CDPS SG` | ✅ sinkron (B-01 sudah di-apply; B-02/B-03/B-04 murni kode) |
| Menggantung | Kode: **NOL**. Keputusan: X-16 · X-17 · O60 · O47b · O42-b · O59-b · O24 · O45 · X-06 · X-12 |

## 1. Apa yang berubah — B-04 (penyesuaian target asimetris + `defisit_terbawa`)

Semua di `packages/domain/src/plan.ts`, **NOL migrasi** (kolom B-01 diisi, deficit
computed). Ringkas — detail penuh di `docs/DECISIONS.md` 2026-08-10 (B-04):

- **`classifyAdjustment(nilaiStrategi, nilaiDipakai)`** — murni, teruji. naik bebas ·
  turun ≤10% wajib alasan · turun >10% wajib alasan+bukti+approval. Ambang di
  konstanta `DOWNWARD_APPROVAL_THRESHOLD_PCT = 10` (PA-1 "cheap to tune").
- **`adjustPlanTarget(...)`** — jalur tulis tunggal Rule 9. Hanya saat `Draft`/
  `Terjadwal`. Turun >10% pada `Terjadwal` → tahan periode `→ Menunggu Persetujuan`.
- **`approveTargetAdjustment` / `rejectTargetAdjustment`** (SPV) — set status
  `Disetujui`/`Ditolak` (reject revert ke `nilai_strategi` + catatan Rule 19).
  **TIDAK mengaktifkan periode** (aktivasi = job B-09).
- **`activatePlanPeriode` diperluas** — periode `Menunggu Persetujuan` saat aktivasi:
  permintaan yang masih pending → `Kedaluwarsa` + revert ke target asli, lalu `Aktif`
  (Rule 4). `Terjadwal` tetap aktivasi lurus.
- **`defisit_terbawa` (PA-6) computed** — `getPlanDetail(...).defisitTerbawa`
  (periode sebelumnya) + `contractDeficit(...)` (rollup). GMV saja, "Rp".

### 1.1 Tiga hal yang paling mudah salah dibaca

1. **Pending tidak dihitung ke defisit.** Filter `status_persetujuan is distinct
   from 'Menunggu Persetujuan'`. `Kedaluwarsa`/`Ditolak` sudah revert ke
   `arah='tetap'` (kontribusi 0); guard pending itu yang menahan >10% yang masih
   hidup keluar dari sum.
2. **Approve/reject TIDAK transisi periode.** Hanya set status pada `plan_target`.
   Yang memindahkan `Menunggu Persetujuan → Aktif` cuma `activatePlanPeriode`
   (dijadwal B-09) — supaya tak ada aktivasi dini sebelum tanggal mulai.
3. **Periode 1 (`Draft`) tidak ditahan** untuk >10% — loop SPV periode-nya sendiri
   (`submit`/`approve`) sudah gerbang manusianya; `status_persetujuan` tetap null.

### 1.2 Yang SENGAJA ditinggalkan untuk tiketnya

- **Notifikasi** (`plan_target_diturunkan` dll) tidak diemisikan — katalog M6B belum
  terdaftar (v-next, PA-8/O55). Seam sama dengan B-03.
- **Route/FE** belum ada (konsisten B-01/B-03: domain dulu). `route-parity` hijau
  karena belum ada halaman `web-internal` yang memanggilnya.
- **"plus Σ negative variance where chosen to carry"** (§263) = **B-08** (carry-over).
  Deficit B-04 hanya bagian penyesuaian turun; bagian varians menyusul di B-08.

## 2. 🔴 TUGAS BERIKUTNYA — M6B, urut

### 2.1 B-05 — distribusi mingguan turunan (BERIKUTNYA)

Trigger DB (Rule 7): Σ `plan_row_week.kuota` per baris = `plan_row.kuota`, tolak
dengan row-ID + delta (bukan error generik). Minggu terakhir menyerap sisa 8–10
hari, bukan minggu stub. Kolom `plan_row_week` sudah ada (B-01). Ini kemungkinan
BUTUH migrasi (trigger constraint di DB).

### 2.2 Sisa M6B (urut backlog)

B-06 realisasi hybrid + **blok UPDATE metrik `otomatis` untuk role AM** (invariant
beku: predikat TS + RLS tak boleh menyimpang) · B-07 tutup transaksional
(`Aktif → Ditutup`, lewat `transitionPlan`) · B-08 carry-over
(`plan_row.terbawa`/`periode_asal_id` ada) + **Σ negative variance ke deficit** ·
B-09 job WIB (aktivasi + force-close `Ditutup Otomatis` + panggil
`activatePlanPeriode` yang B-04 perluas) · B-10 Plan Satuan + mesin #17 +
`status_dormansi` (belum dibuat) + Rule 6 M6C · B-11 index integritas §4(b).

## 3. Sisa M6A + keputusan pemilik (tak berubah dari SESI16)

- **A-11** (`/s/{token}`) ada di PR #115 (masih terbuka). J-4 diff · Form Section J
  masih sisa M6A.
- **X-16** (6 field tak terklasifikasi) · **X-17** (`setAssumptionStatus` tanpa
  gerbang) · **O60** (detektor O48).
- **`status_dormansi` + mesin #17** DITUNDA ke B-10.

## 4. Perintah pertama di chat baru

```bash
# DB nyala + dibangun ulang (§0.1), lalu:
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps" \
  npx vitest run src/plan.test.ts --root packages/domain     # 45 hijau
scripts/db-rebuild.sh --yes                                    # gate 89/31/17/34 + 4 invariant
```

`plan.test.ts` merah pada `adjustPlanTarget` hold ⇒ routing `Terjadwal → Menunggu
Persetujuan` atau gerbang status rusak. Merah pada `defisit_terbawa` ⇒ filter
pending/committed di `deficitOfChain` keliru. Merah pada `activatePlanPeriode`
expiry ⇒ `expirePendingAdjustments` tak revert/transisi.
