# Handoff — M6D (Rekap Hasil Mingguan) SESI 7 — D-06 + D-07 + D-08 + D-09 (domain) mendarat

**Tanggal:** 2026-08-13 · **Branch kerja:** `claude/task-d06-d09-handoff-gdf3l0`

> Rantai M6D: SESI1 (spec) → SESI2 (RM-1…RM-11) → SESI3 (sign-off) → SESI4 (D-01 skema
> + D-02 mesin #18) → SESI5 (D-03 agregasi) → SESI6 (D-04 manual + D-05 tutup/append-only)
> → **SESI7 (ini) = D-06 + D-07 + D-08 + D-09 (domain)**. Baca SESI6 dulu untuk konteks
> D-01…D-05. **D-01…D-08 ✅ DONE; D-09 domain ✅ DONE, API+wire = D-09b (belum).**

---

## 0. Ringkasan sesi ini

1. **D-07** (didahulukan, katalog dibutuhkan D-06/D-09) — notif **v7 = 48** (+4 event).
   Migrasi `20260813070000_m6d_notif_v7.sql` + `packages/core/src/notification.ts` +
   gate `ci.yml`/`db-rebuild.sh` (44→48).
2. **D-06** — job `wrr_monday_job` + `wrr_reminder_tick`. Migrasi `20260813080000_m6d_wrr_job.sql`.
3. **D-08** — rollup **READ-ONLY** `wrr_plan_rollup(plan_id)` (RM-E). Migrasi `20260813090000_m6d_wrr_rollup.sql`.
4. **D-09 (domain)** — `recap.ts` lengkap (reads + writes + close-belt + reopen + rollup read)
   + RLS `20260813100000_m6d_wrr_domain_rls.sql` (O48 arm baca lead divisi + tulis catatan).
5. **Verifikasi hijau lokal:** rebuild bersih **100 migrasi** + seed 2× + semua gate
   (**112/33/21/48**) + 4 invariant SQL; suite rekap **75 lulus** (8 berkas: test/reals/
   aggregate/manual/close **+ job(9)/rollup(4)/domain(18)** baru); core **220 lulus**;
   typecheck 4 paket bersih.
6. **Keputusan dicatat:** `docs/DECISIONS.md` 2026-08-13 (empat baris teratas = D-09, D-08, D-07, D-06).

---

## 1. Yang MENDARAT

### D-07 — katalog notif v7=48 (`20260813070000_m6d_notif_v7.sql`)
4 event (owner sign-off 2026-08-13, cabut gerbang M6B PA-8): `rekap_mingguan_terbuka`
(explicit→AM), `rekap_mingguan_belum_dikonfirmasi` (explicitOrLeads→AM+SPV),
`rekap_sengketa_angka` (leadsOfDivision→SPV), `catatan_divisi_belum_diisi`
(explicitOrLeads→lead divisi+AM). Satu baris `notif_catalog_versions` (v7, `event_count:4`) —
**bukan literal** (O55); cermin TS + tes v7 di `notification.test.ts`. **Gate 44→48 di DUA
berkas** (`ci.yml` + `db-rebuild.sh`).

### D-06 — job terjadwal (`20260813080000_m6d_wrr_job.sql`)
`wrr_monday_job(p_now)` (Senin 00:00 WIB = Minggu 17:00 UTC, `0 17 * * 0`) + `wrr_reminder_tick(p_now)`
(harian). pg_cron dibungkus `IF EXISTS pg_available_extensions`. Idempoten (terima `p_now`).
- Buka rekap per klien aktif (`Terjadwal→Terbuka` 'SISTEM', tautkan Plan `Aktif`, `wrr_aggregate`,
  emit `rekap_mingguan_terbuka`).
- Force-close minggu lalu masih `Terbuka` lewat **N=2 hari kerja** (`working_days_between`>2 →
  `Ditutup Otomatis`, `pernah_ditutup_otomatis=true`, emit `catatan_divisi_belum_diisi`).
- Reminder `rekap_mingguan_belum_dikonfirmasi` (AM+SPV), idempoten via kolom penanda
  `belum_dikonfirmasi_terkirim` (kolom BARU, bukan tabel → gate tabel tetap).
- Tes `recap.job.test.ts` (9).
- **⚠️ RM-2 hold/paused = NO-OP hari ini** (lihat §3 ranjau).

### D-08 — rollup ke Plan READ-ONLY (`20260813090000_m6d_wrr_rollup.sql`)
`wrr_plan_rollup(plan_id)` konsolidasi rekap `Ditutup`/`Ditutup Otomatis` tertaut → per-minggu +
kumulatif (# video/# creator/# live/jam live/gmv interim/ad spend + ROAS minggu terakhir).
**TAK menulis `plan_actual`** — RM-E "(auto, read-only)"; PE-1 GMV single-source, PE-3 per-channel =
mismatch dimensi (rekap klien-level vs `plan_actual` per-platform-channel), PE-8 turunan `plan_row`.
Konsumen `getPlanRekapRollup` (digerbang). Tes `recap.rollup.test.ts` (4).

### D-09 (domain) — `recap.ts` lengkap + RLS (`20260813100000_m6d_wrr_domain_rls.sql`)
Domain (`packages/domain/src/recap.ts`, tulis lewat `db()` service-role → gerbang TS + belt, O37):
- **Reads:** `getRecapDetail` / `listRecapsForClient` / `getPlanRekapRollup`, gerbang `canReadRecap`
  (own AM / Account lead / OD+Director / **lead divisi yang sentuh — arm O48**).
- **Writes:** `saveRecapPembuka` (RM-A6), `saveRecapNarasi` (RM-D+RM-C9 full-replace),
  `recordRecapMetrikManual` (RM-C isi-atau-`—`; tolak clobber otomatis di TS), `fileRecapSengketa
  Metrik`/`fileRecapSengketaDivisi` (→ emit `rekap_sengketa_angka`), `addRecapCatatanDivisi`
  (RM-D6 append-only, `canWriteRecapDivisiNote`).
- **`closeRecap`** — **belt kelengkapan yang D-05 tunda**: RM-A6 + RM-D1/D3 + tiap RM-C
  `total_view`/`ctr`/`cvr` wajib ada baris (isi/manual/`—`), lalu transisi, lalu emit
  `catatan_divisi_belum_diisi` (job-c saat tutup). DB gerbang narasi = dinding kedua.
- **`reopenRecap`** — `Ditutup Otomatis→Terbuka`, **Head-only** (`canReopenRecap`), alasan wajib,
  `pernah_ditutup_otomatis` tak dicabut.
- **RLS** `20260813100000`: **O48 arm baca lead divisi** (SELECT `weekly_result_recap` +
  `private.jwt_can_read_recap` dilebarkan) + kebijakan tulis `wrr_catatan` (INSERT/UPDATE) &
  `wrr_catatan_divisi` (INSERT lead-divisi/Account) = dinding kedua.
- Tes `recap.domain.test.ts` (18: gate murni + integrasi).

---

## 2. Titik mulai sesi berikutnya — **D-09b** lalu **D-10…D-14**

- **D-09b (API + wire) — mulai di sini.** Route API di `apps/api/src/app/api/v1/**` (pola
  handler Strategi: `handle`→`requireActor`→`recap.<fn>(db(), actor, …)`→`json(<x>ToWire(…))`)
  untuk reads (`getRecapDetail`/`listRecapsForClient`/`getPlanRekapRollup`) + writes (pembuka/
  narasi/metrik manual/sengketa/catatan divisi/**tutup**/**buka-kembali**). Wire `*ToWire` di
  `apps/api/src/lib/wire.ts` (**null eksplisit, bukan omitempty — O43**) + antarmuka FE di
  `web-internal/src/lib/recap.ts` + daftar `WIRE_TO_FE`/`FE_FILES` (shape-parity). `route-parity`
  `KNOWN_GAPS` tetap **kosong**. **Konteks:** M6B pun belum punya route/wire (preseden — domain
  mendarat dulu); `web-internal` nol panggilan rekap hari ini, jadi UI (D-10) & D-09b bisa
  didesain bareng. Fungsi domain sudah siap dipanggil.
- **D-10** — UI rekap internal (desktop-first tutup; mobile read-only minggu berjalan).
- **D-11/D-12/D-13** — integrasi `/health` (H-1…H-4 + portfolio + degradasi per-blok O52).
  **Skor M13 TIDAK disentuh.** D-11 H-1 bisa memakai `getPlanRekapRollup` (D-08) + `getRecap
  Detail`. Dua GMV wajib berlabel beda (`GMV Growth` M4 vs `GMV Eksekusi interim` M6D).
- **D-14** — M14 komponen Disiplin Rekap (bobot AM 45/22.5/22.5/10; divisi +5%). M6D menyuplai
  sinyal mentah: status tutup + `pernah_ditutup_otomatis` + ada/tidak catatan divisi.

**Guardrail utama:** GMV single-source (rekap **tak pernah** tulis M6B PE-1 — D-08 patuh).

---

## 3. Ranjau repo (tetap + BARU dari D-06…D-09)

- Migrasi HANYA lewat `supabase/migrations/**` + `apply_migration` — **jangan** `psql -f` (O38).
  DB lokal rebuild HANYA `scripts/db-rebuild.sh`.
- **Gate hitung di DUA berkas** (`ci.yml` + `db-rebuild.sh`). **D-07 menaikkan notif_events 44→48**
  (v7). Invariant sebenarnya `SUM(event_count)=COUNT(notif_events)` (O55) — literal hanya kenyamanan.
- **BARU (D-06) RM-2 hold/paused = NO-OP.** Filter klien aktif hanya `NOT IN ('Done','[Cancelled —
  Service Voided]')` — mesin `service` tak punya state hold/paused, tak ada payment-hold di skema.
  Begitu state hold/paused lahir, tambahkan ke `WHERE` `wrr_monday_job` (dan cermin di mana pun).
- **BARU (D-06) sm_transition butuh aktor non-kosong** → 'SISTEM' (bukan NULL). "Aktor NULL" =
  `jwt_employee_id()` NULL (jalur service-role) yang membuat belt D-03 melewatkan tulisan auto.
- **BARU (D-06) job SQL memanggil `sm_transition`** (`SISTEM`,false,false) — pertama di repo yang
  begitu dari SQL (preseden lain = TS plan sweep). Edge `Terjadwal→Terbuka` & `Terbuka→Ditutup
  Otomatis` `require_lead=false`, jadi aktor tanpa peran lolos.
- **BARU (D-08) RM-E read-only** — rollup **tak pernah** tulis `plan_actual` (PE-1 GMV +
  PE-3 per-channel keduanya tak ditulis; alasan di DECISIONS). Jangan "melengkapi" jadi penulis
  tanpa keputusan owner + jembatan atribusi platform.
- **BARU (D-09) tulis lewat `db()` = RLS BYPASS (O37).** Gerbang utama = `canWrite*` TS + belt
  trigger; RLS/braces = dinding kedua (jalur `readAsActor`/uji `withClaims`). Karena `jwt_employee_id()`
  NULL di jalur db(), belt auto-block MELEWATKAN — jadi **larangan clobber angka otomatis di
  `recordRecapMetrikManual` ditegakkan di TS**, bukan bergantung belt.
- **BARU (D-09) O48 arm baca lead divisi** — SELECT `weekly_result_recap`/anak dilebarkan; setiap
  pelebaran baca butuh entri DECISIONS (sudah). Cermin TS `canReadRecap`.
- **(D-05 masih) gerbang narasi hanya `Terbuka→Ditutup`**; force-close & reopen sengaja lewat.
- Wire snake_case (D-09b): route kirim objek domain mentah = bug **O43**. `null` eksplisit.
- `route-parity.test.ts` `KNOWN_GAPS` tetap **kosong**.
- `backend/**` read-only (Go+MySQL pensiun).

---

## 4. Lingkungan dev lokal
- Postgres 16: `pg_ctlcluster 16 main start` lalu
  `su postgres -c "psql -c \"ALTER ROLE postgres WITH PASSWORD 'postgres';\""`.
- Install: **`npm ci`** (npm workspaces, BUKAN pnpm).
- Rebuild: `scripts/db-rebuild.sh --yes` (DATABASE_URL di-set).
- Tes DB: `cd packages/domain && DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps" npx vitest run src/recap`.
  Suite `*.reals/aggregate/manual/close/job/rollup/domain.test.ts` **skip tanpa DATABASE_URL**.
- Typecheck: `npm run -s typecheck` (root).
- **⚠️ Flake pra-ada (BUKAN M6D):** `interview.test.ts > "counts WORKING days … national holiday"`
  gagal di DB ini tergantung tanggal-nyata mesin (menyisipkan `hari_libur` untuk `current_date-8d`
  dan mengharap hitung hari-kerja kolaps ke 0). Terbukti gagal juga di baseline pra-perubahan
  (di-stash). `admin.test.ts` "hari libur" hanya gagal kalau suite dijalankan berulang di DB
  persisten (audit_log append-only akumulasi id tetap) — hijau di DB segar. Keduanya di luar rekap.

---

## 5. Sumber kebenaran
- `docs/prd/CDPS_Module6D_Rekap_Hasil_Mingguan.md` (§4 Rule 6/7/8, §5 RM-E "auto/read-only",
  §6 flow, §9 Scheduled jobs + katalog, §10.1-A RM-5/RM-2).
- `docs/backlog/M6D_BACKLOG.md` (D-01…D-08 ✅ DONE; D-09 domain done / D-09b API+wire).
- `docs/DECISIONS.md` 2026-08-13 (D-09, D-08, D-07, D-06 di atas D-05).
- Kode: `supabase/migrations/2026081307*`(notif v7) `08*`(job) `09*`(rollup) `10*`(domain RLS);
  `packages/core/src/notification.ts`; `packages/domain/src/recap.ts` (+ `recap.job/rollup/domain.test.ts`).
