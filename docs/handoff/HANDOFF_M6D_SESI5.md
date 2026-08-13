# Handoff — M6D (Rekap Hasil Mingguan) SESI 5 — D-03 mendarat + PR #141/#142/#140 ditutup

**Tanggal:** 2026-08-13 · **Branch:** `claude/d02-merged-pr-review-4j16ef` (PR ke `main`)

> Rantai M6D: SESI1 (spec) → SESI2 (RM-1…RM-11) → SESI3 (sign-off + antrean PR) →
> SESI4 (D-01 skema + D-02 mesin #18, MERGED; rekomendasi PR #141/#142) →
> **SESI5 (ini)**. SESI5 = **D-03** (agregasi auto + UPDATE-block baris otomatis) +
> **resolusi final PR #141/#142/#140**. Baca SESI4 dulu untuk konteks D-01/D-02.

---

## 0. Ringkasan sesi ini

1. **D-03 diimplementasikan** (jalur kritis M6D) — dua bagian, keduanya invariant beku
   bentuk sama `plan_actual` M6B. Ada di PR branch `claude/d02-merged-pr-review-4j16ef`.
2. **PR #141, #142, #140 DITUTUP** (bukan merge) — keputusan pemilik: halaman
   strategi/interview yang dipakai sudah selesai; **Strategi M6A (`STRG-`) tidak diadopsi**,
   dan ketiga PR itu M6A. Lihat §3.

---

## 1. Yang MENDARAT — D-03 (agregasi auto + UPDATE-block)

Dua migrasi + gerbang domain + tes. Gate **112/33/21/44 tetap** (nol tabel/mesin/prefix/event baru).

### Part B — auto-metric UPDATE-block (`20260813030000_m6d_wrr_autoblock.sql`)
Invariant beku "TS predikat & RLS tak boleh divergen", cermin persis `plan_actual` M6B B-06:
- **`private.jwt_can_write_recap(recap_id)`** (SECURITY DEFINER) — write-scope: AM pemilik
  ATAU Head/lead Account (Director tercakup `jwt_is_lead`); OD read-only. Kembar TS
  **`canWriteRecap`** di `packages/domain/src/recap.ts`.
- **Belt**: trigger `guard_wrr_metrik_no_manual_auto` + `guard_wrr_divisi_no_manual_auto`.
  Aktor JWT tak boleh insert/overwrite baris `otomatis`; **hanya `sengketa` yang boleh
  gerak** (RM-B6/RM-C). Aktor **NULL = sistem**, dilewatkan (jalur agregasi/job).
- **Braces**: RLS `WITH CHECK`. `wrr_metrik` buka INSERT (manual-only) + UPDATE (scope recap
  milik); `wrr_divisi` UPDATE-only (baris produksi selalu lahir-sistem).
- **Tes**: `packages/domain/src/recap.reals.test.ts` (8 tes, kelas sama `plan.reals.test.ts`) —
  termasuk `jwt_can_write_recap ≡ canWriteRecap` (assertion "tak boleh divergen").

### Part A — agregasi (`20260813040000_m6d_wrr_aggregate.sql`)
- **`wrr_aggregate(recap_id)`** mengisi `wrr_divisi` (RM-B) + baris `otomatis` `wrr_metrik`
  (RM-C) dari M7/M8/M9/M10 + M6 briefs, per klien + window minggu ISO WIB.
- **Windowing lewat `audit_log`** — tabel eksekusi TAK punya kolom timestamp per-status;
  "capai status X minggu ini" = `audit_log` filter `entity_type` + `action LIKE
  'transition:%->[X]'` + `wib_date(created_at)` dalam [`minggu_mulai`,`minggu_akhir`].
  (Pola sama Daily Output M7 `creative.ts`.) Log Ads append-only (`metric_entries` by
  `period_end`, `optimization_logs` by `created_at`) dibaca langsung.
- **Cakupan metrik auto**: `gmv_interim` (ΣAds+Live+affiliate), `ad_spend`, `roas_ads`
  (spend=0 ⇒ NULL/`—`, house #7), `total_view` (=Σ viewers M10; **Ads tak punya kolom
  impressions/views**). **`ctr`/`cvr` TIDAK di-auto** — `metric_entries` cuma simpan persen
  ctr/cvr, tanpa clicks/impressions untuk konsolidasi lintas-kampanye (merata-ratakan persen
  = mengarang). Jatuh ke manual/`—` (D-04); patuh RM-C4/C5 "isi atau —".
- **Idempoten** (house #4), tak pernah timpa `sengketa` maupun baris `manual`. **Sistem-only**:
  self-enforcing lewat belt trigger (aktor JWT ditolak). SECURITY DEFINER hanya agar baca
  lintas-klien tak ter-RLS (return void — tak bocorkan baris).
- **Tes**: `packages/domain/src/recap.aggregate.test.ts` (4 tes: metrik konsolidasi
  = 41jt seperti contoh PRD §7, ROAS bagi-nol, baris divisi headline+rincian, idempotensi +
  sengketa lestari).

**Verifikasi (hijau lokal):** rebuild bersih 94 migrasi + seed 2× + semua gate + 4 invariant
SQL; domain suite **1195 lulus** (+12: 8 invariant + 4 agregasi) 1 skip; typecheck 4 paket bersih.

**Keputusan dicatat:** `docs/DECISIONS.md` 2026-08-13 (baris teratas — cakupan metrik + invariant).

---

## 2. Titik mulai sesi berikutnya — **D-04** (lalu D-05…D-14)

Urutan sisa (detail `docs/backlog/M6D_BACKLOG.md`; D-01/D-02/D-03 kini ✅ DONE):

- **D-04** — jalur **manual** RM-C + `—` + teks. ← **mulai di sini**
  - **CHECK kondisional** `file_bukti` + `tanggal_ambil` NOT NULL saat `wrr_metrik.sumber='manual'`
    (RM-C7). **D-03 sengaja menundanya** (D-01 menugaskannya ke D-04; B-06 pun buka jalur tulis
    sebelum CHECK manual-nya) — jadi jalur INSERT manual sudah TERBUKA di D-03, tinggal
    diperketat CHECK-nya di sini. **Ini gap nyata sampai D-04 landing** (AM bisa isi manual tanpa
    bukti) — prioritaskan.
  - `sumber='tidak_tersedia'` → `nilai` NULL → render `—` (sudah ada `ck_wrr_metrik_kosong` di D-01).
  - **Field teks-only RM-C9** "Catatan Metrik Tambahan" di `wrr_catatan` (ALTER TABLE ADD COLUMN).
    Bukan metrik — tak masuk delta/rollup/skor, sistem tak pernah parse angka (RM-4/RM-7/RM-11).
- **D-05** — narasi wajib saat tutup + `Sengketa Angka` (notif SPV, tak blok tutup) + append-only
  guard `wrr_catatan_divisi` (immutability — no UPDATE/DELETE).
- **D-06** — job Senin 00:00 WIB (buka rekap klien aktif kecuali hold/paused RM-2 + force-close
  N=2 hari kerja lewat `working_days_between`) + reminder. **pg_cron dibungkus guard
  `IF EXISTS pg_available_extensions`** (absen di Postgres polos CI). Job ini yang **memanggil
  `wrr_aggregate`** (service-role, aktor NULL).
- **D-07** — notif **v7=48** (+4 event) — satu baris `notif_catalog_versions` (`eventCount: 4`),
  **jangan** setel literal (O55). ⚠️ Menaikkan `notif_events` 44→48 → **edit gate di
  `.github/workflows/ci.yml` + `scripts/db-rebuild.sh`** (dua tempat!).
- **D-08** — rollup rekap `Ditutup` → PE-3/PE-8 Plan M6B (klien Tanpa Plan berdiri sendiri).
- **D-09** — domain `recap.ts` lengkap (reads own-clients/SPV all + lead divisi RM-D6 + write
  RM-A6/RM-C/RM-D/close) + route API + wire `*ToWire` (null eksplisit, hindari O43) + shape-parity.
  `KNOWN_GAPS` tetap kosong. (Arm baca **lead divisi** ditambah di sini — entri O48 tersendiri.)
- **D-10** — UI rekap internal.
- **D-11/D-12/D-13** — integrasi `/health` (H-1…H-4 + portfolio landing + degradasi per-blok O52).
  **Skor M13 TIDAK disentuh.** D-12 butuh endpoint list baru — jangan lebarkan RLS tanpa entri O48.
- **D-14** — M14 komponen Disiplin Rekap (bobot AM 45/22.5/22.5/10 ditandatangani RM-9a).

**Guardrail utama:** GMV single-source (rekap **tak pernah** tulis M6B PE-1); di `/health` dua GMV
wajib berlabel beda (`GMV Growth` M4 vs `GMV Eksekusi interim` M6D), tak dijumlahkan.

---

## 3. PR #141 / #142 / #140 — DITUTUP (keputusan pemilik)

**Keputusan pemilik (2026-08-13):** *"Halaman strategi & interview yang dipakai saat ini sudah
selesai, bukan Strategi M6A. Kalau PR #141 & #142 berisi M6A, kita tidak akan menggunakannya."*

- #141 & #142 mengimplementasikan **Strategi M6A** (`STRG-`, handoff Interview→Strategi langkah 8,
  #141 + fixture langkah 9). Karena M6A tidak diadopsi → **ditutup, tidak digabung.**
- Temuan teknis saat uji-gabung #142 ke `main` terkini (arsip): backend (migrasi kolom
  `sumber`/`interview_id`/`blok_d_flags`, `createStrategi(interviewId)`, prefill, wire) menyatu
  bersih, TAPI **FE bentrok arsitektural** — `main` sudah didesain ulang (kerja "Riset Awal") jadi
  halaman Interview memakai tab `riset | interview` dan Strategi dicapai via **tautan ke Service
  hub**, bukan tab. Tab "Strategi" + `StrategiHandoffCard` di #142 bertabrakan dengan model itu.
  Ini **membalik** rekomendasi SESI4 ("ambil #142 karena FE terlengkap") — FE-nya justru yang usang.
- #140 (draft docs handoff SESI30) — usang, ditutup.
- (Token GitHub sesi ini terautentikasi sebagai `yohanagustian-del`, penulis ketiga PR — jadi
  merge/close = operasi akun sendiri, bukan branch orang lain.)

---

## 4. Ranjau repo (tetap berlaku + BARU dari D-03)

- Migrasi HANYA lewat `supabase/migrations/**` + `apply_migration`/`supabase db push` — **jangan**
  `psql -f` (O38). DB lokal rebuild HANYA `scripts/db-rebuild.sh`.
- **Gate hitung di DUA berkas** (`ci.yml` + `db-rebuild.sh`) — naikkan KEDUANYA bersama migrasi yang
  menambah tabel/mesin/prefix/event. (D-07 akan mengenai ini: 44→48.)
- **BARU (D-03): tak ada kolom timestamp per-status** di modul eksekusi — semua "capai status X
  minggu ini" via `audit_log` (`transition:%->[X]` + `wib_date`). Kalau kelak menambah agregasi,
  pakai pola yang sama; jangan cari kolom `*_at`.
- **BARU (D-03): `wrr_aggregate` sistem-only** — panggil dengan **service-role / aktor NULL** saja
  (D-06 job). Kalau dipanggil di jalur authenticated (aktor JWT), belt trigger MENOLAK tulisannya.
- **BARU (D-03): `audit_log` append-only** (no UPDATE/DELETE) — tes yang menyuntik baris audit
  langsung tak bisa membersihkannya; `recap.aggregate.test.ts` pakai **ID unik per-run** (bukan
  fixed) supaya baris audit lama tak dobel-hitung di run berikutnya.
- Wire snake_case: route yang kirim objek domain mentah = bug **O43** (halaman blank walau 200).
  `*ToWire` satu-satunya penerjemah; `null` eksplisit, bukan `omitempty`. (Relevan D-09.)
- `route-parity.test.ts` `KNOWN_GAPS` tetap **kosong**.
- **O48**: melebarkan SELECT/RLS per tabel butuh entri ledger + `DECISIONS.md`. (D-09/D-12.)
- Kelas **O52**: read/join gagal jangan mem-blank seluruh halaman — load per blok terpisah. (D-11/12/13.)
- `backend/**` read-only (Go + MySQL pensiun).
- Status hanya lewat `sm_transition`; derived field recomputable dari log; bagi-nol render `—` (#7).

---

## 5. Lingkungan dev lokal (untuk sesi implementasi)
- Postgres 16 di container biasanya sudah online; kalau tidak: `pg_ctlcluster 16 main start` lalu
  `su postgres -c "psql -c \"ALTER ROLE postgres WITH PASSWORD 'postgres';\""` (auth TCP).
- Install: **`npm ci`** (npm workspaces, BUKAN pnpm — hapus `pnpm-lock.yaml` kalau muncul).
- Rebuild: `scripts/db-rebuild.sh --yes`.
- Tes DB: `cd packages/<pkg> && DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps" npx vitest run src/<pola>`
  (root vitest tak pakai `--project`; jalankan dari folder paket). Suite `*.reals.test.ts` /
  `recap.aggregate.test.ts` **skip tanpa DATABASE_URL** — "N skip" bukan "N pass".
- Typecheck: `npm run -s typecheck` (root).

---

## 6. Sumber kebenaran
- `docs/prd/CDPS_Module6D_Rekap_Hasil_Mingguan.md` (§4/§5/§9/§10 — matriks kepemilikan metrik §9).
- `docs/backlog/M6D_BACKLOG.md` (D-01…D-14; D-01/D-02/D-03 kini ✅ DONE).
- `docs/STATE_MACHINES.md` §15 (mesin #18). `docs/DATA_MODEL.md` (WRR-).
- `docs/DECISIONS.md` 2026-08-13 (baris teratas = D-03; + D-01 O48 ledger + resolusi RM + sign-off).
- Kode: `supabase/migrations/2026081303*` (autoblock) `+2026081304*` (aggregate);
  `packages/domain/src/recap.ts` (+`canWriteRecap`), `recap.reals.test.ts`, `recap.aggregate.test.ts`.
