# HANDOFF — M6A/M6B/M6C Sesi 16 (titik mulai sesi berikutnya)

> Rantai: SESI1 → … → SESI15 → **SESI16 (ini, terbaru)**. Baca yang bernomor
> tertinggi lebih dulu; sesi sebelumnya hanya untuk konteks sejarah.

## 0. CARA MELANJUTKAN DI CHAT BARU — baca ini dulu

| | |
|---|---|
| **Repo** | `MEAgrup/AgencyAPP` |
| **Branch** | `claude/b-03-mesin-transisi-p4bfmr` — **PR sesi ini (B-03)**. Ditumpuk di atas PR #116 (B-01+B-02). Sudah merge → cabang BARU dari `main`; belum → lanjut di branch yang sama |
| **Basis** | Branch ini bercabang dari `claude/handoff-sesi14-m6abc-28hc3m` (PR #116), BUKAN dari `main`. B-03 butuh tabel `plan` + mesin #16 yang B-01 buat. Merge PR #116 lebih dulu, lalu PR B-03 |

**Sesi ini menyelesaikan B-03.** M6B: 25% → **~33%** (3/12 tiket perilaku + B-00/B-01/B-02).

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

### 0.2 Posisi persis (sesudah B-03)

| | |
|---|---|
| Migrasi | **74 berkas** · gerbang tabel **89** · prefix 31 · mesin **17** · event 34 · `CATALOG_VERSION` 4 (B-03 = perilaku, NOL migrasi) |
| Test | `apps/api` **340** · `core` **137** · `db` **15** · `domain` **967 + 1 skip** (`plan.test.ts` **29**: 19 B-01/B-02 + 10 B-03) · db-rebuild semua gate + 4 invariant hijau · `@cdps/api` lint bersih · `KNOWN_GAPS` kosong |
| Live `CDPS SG` | ⚠️ **BELUM disusul migrasi B-01** — lihat §2 (B-02/B-03 murni kode, tetap satu susulan migrasi) |
| Menggantung | Kode: **NOL**. Keputusan: X-16 · X-17 · O60 · O47b · O42-b · O59-b · O24 · O45 · X-06 · X-12 |

## 1. Apa yang berubah — B-03 (gerbang transisi mesin #16)

Lapisan domain di atas edge yang B-01 daftarkan (STATE_MACHINES §6d). Semua di
`packages/domain/src/plan.ts`, NOL migrasi:

- **`transitionPlan(tx, actor, planId, to)`** — satu-satunya jalur status Plan
  (pola `strategi.ts`): jalankan `sm_transition` (row lock + edge + gate
  `require_lead` + baris audit immutable) dan petakan penolakan ke taksonomi
  error domain. Gerbang divisi-spesifik ada di operasi bernama yang memanggilnya;
  B-04…B-09 ikut memakainya.
- **Periode 1 (loop review manusia):** `submitPlanPeriode` (`Draft → Diajukan`,
  AM pemilik, PA-7 `catatan_pembuka` wajib saat submit) · `approvePlanPeriode`
  (`Diajukan → Aktif`, gerbang `isLead(Account)` — SPV/Head, bukan lead divisi
  lain) · `returnPlanPeriode` (`Diajukan → Draft`, catatan WAJIB).
- **Periode 2..n:** `activatePlanPeriode` (`Terjadwal → Aktif`) — **TIDAK
  lead-gated** (edge tanpa `require_lead`, cocok dengan job service-role B-09).

### 1.1 Dua hal yang paling mudah salah dibaca

1. **Catatan pengembalian ada di `audit_log`, bukan kolom.** Tak ada
   `catatan_reviewer` di `plan` (B-01 hanya kasih PA-7). `returnPlanPeriode`
   menulis baris `action='dikembalikan'` dengan `after_json.catatan` (Rule 19,
   log immutable) di samping baris `transition:` `sm_transition`. Jangan tambah
   kolom untuk ini.
2. **Periode 1 dikurung MESIN, bukan cek `periode_no`.** Hanya periode 1 pernah
   `Draft` (generasi B-02 menaruh 2..n di `Terjadwal`), jadi `Terjadwal` tak
   punya edge `→ Diajukan` dan engine memblokir submit atasnya. Tidak ada guard
   `periode_no===1` — mesinnya sudah menegakkannya. Kalau kelak ada operasi
   `Terjadwal → Draft` untuk periode 1 (edge ada, belum dipakai domain), tinjau
   ulang asumsi ini.

### 1.2 Yang SENGAJA ditinggalkan untuk tiketnya (seam didokumentasikan di kode)

- **`Menunggu Persetujuan` (`Turun >10%` tertunda) = B-04.** `activatePlanPeriode`
  saat ini aktivasi lurus `Terjadwal → Aktif`. B-04 yang punya rekaman
  penyesuaian; ia menyisipkan routing ke `Menunggu Persetujuan` sebelum aktivasi.
- **Job 00:00 WIB (aktivasi + force-close overdue) = B-09.** `activatePlanPeriode`
  adalah fungsi yang job itu panggil; scheduler-nya B-09. Rule 5 (satu `Aktif`
  per rantai) dijaga index `uq_plan_aktif_*` — mengaktifkan n+1 saat n masih
  `Aktif` ditolak DB; job force-close pendahulunya dulu.
- **Notifikasi TIDAK diemisikan.** Katalog M6B (`plan_periode_aktif` dll) belum
  didaftarkan (v-next, butuh PA-8/O55). Emisikan hanya setelah event terdaftar —
  `notify_emit` event tak terdaftar akan gagal.

## 2. 🔴 Live `CDPS SG` — B-01 BELUM disusul (tak berubah dari SESI15)

Migrasi `20260810000000_m6b_plan.sql` belum di-`apply_migration` ke live.
`strategi` live 0 baris ⇒ nol data terdampak. Sesudah PR merge: `apply_migration`
→ verifikasi lewat isi (live harus 89 tabel, `sm_machines` 17, sidik jari
`ck_plan_*` + edge mesin `plan` cocok DB lokal). B-02/B-03 murni kode, jadi cukup
satu susulan migrasi B-01.

## 3. 🔴 TUGAS BERIKUTNYA — M6B, urut

### 3.1 B-04 — penyesuaian asimetris Rule 9 + `defisit_terbawa` (BERIKUTNYA)

Kolom `plan_target.status_persetujuan` + `plan_target.nilai_dipakai`/`arah`/
`alasan` sudah ada (B-01). Yang kurang perilaku:
- Penyesuaian target `turun ≤10%` → langsung berlaku + notifikasi SPV;
  `turun >10%` → butuh persetujuan SPV, MENAHAN aktivasi periode di
  `Menunggu Persetujuan` (kaitkan ke `activatePlanPeriode` B-03: sisipkan routing
  hold sebelum `Terjadwal → Aktif`). Tak terjawab di tanggal mulai ⇒ aktif dengan
  target Strategi asli, request ditandai `Kedaluwarsa`.
- `defisit_terbawa` (level kontrak, **computed** — aturan rumah #4, dari log,
  bukan diketik). Muncul di tiap periode sisa + tampilan kontrak.
- `nilai_strategi` beku (jangkar PE-5) sudah ditegakkan trigger B-01; jangan
  reimplementasi di TS.

### 3.2 Sisa M6B (urut backlog)

B-05 trigger Σ minggu = `plan_row.kuota` (kolom `plan_row_week` ada) · B-06
realisasi hybrid + **blok UPDATE metrik `otomatis` untuk role AM** (invariant
beku: predikat TS + RLS tak boleh menyimpang) · B-07 tutup transaksional
(`Aktif → Ditutup`, lewat `transitionPlan`) · B-08 carry-over
(`plan_row.terbawa`/`periode_asal_id` ada) · B-09 job WIB (aktivasi +
force-close `Ditutup Otomatis`) · B-10 Plan Satuan + mesin #17 +
`status_dormansi` (belum dibuat — §4) + B-11 index integritas.

## 4. Sisa M6A + keputusan pemilik (tak berubah dari SESI15)

- **A-11** (`/s/{token}`) DIBLOKIR **X-16** · **J-4 diff** · **Form Section J**.
- **X-16** (6 field tak terklasifikasi) · **X-17** (`setAssumptionStatus` tanpa
  gerbang) · **O60** (detektor O48, 15 baris ledger).
- **`status_dormansi` + mesin #17** DITUNDA ke B-10. `lingkup`+`strategi_id`
  nullable sudah dibuat, jadi B-10 tak perlu migrasi kolom.

## 5. Perintah pertama di chat baru

```bash
# DB nyala + dibangun ulang (§0.1), lalu:
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps" \
  npx vitest run src/plan.test.ts --root packages/domain     # 29 hijau
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps" \
  npx vitest run src/strategi.test.ts --root packages/domain  # tetap hijau (approval → generasi)
scripts/db-rebuild.sh --yes                                    # gate 89/31/17/34 + 4 invariant
```

`plan.test.ts` merah pada gerbang `approvePlanPeriode`/`returnPlanPeriode` ⇒
gerbang `isLead(Account)` atau routing `sm_transition` rusak. Merah pada
`activatePlanPeriode` ⇒ edge `Terjadwal → Aktif` keliru jadi `require_lead`.
Merah `dikembalikan` audit ⇒ baris catatan tak tertulis (Rule 19).
