# Handoff — M6D (Rekap Hasil Mingguan) SESI 6 — D-04 + D-05 mendarat (jalur manual, narasi tutup, append-only)

**Tanggal:** 2026-08-13 · **Branch kerja:** `claude/baca-handoff-build-kmlfuo` (di-*merge* ke `main`)

> Rantai M6D: SESI1 (spec) → SESI2 (RM-1…RM-11) → SESI3 (sign-off) → SESI4 (D-01 skema
> + D-02 mesin #18) → SESI5 (D-03 agregasi + auto-block) → **SESI6 (ini) = D-04 + D-05**.
> Baca SESI5 dulu untuk konteks D-01/D-02/D-03. D-01/D-02/D-03/**D-04/D-05 kini ✅ DONE**.

---

## 0. Ringkasan sesi ini

1. **D-04 diimplementasikan** — jalur manual RM-C7 + `—` + teks RM-C9. Migrasi
   `20260813050000_m6d_wrr_manual.sql`.
2. **D-05 diimplementasikan** — narasi wajib saat tutup (RM-D/Rule 8) +
   `wrr_catatan_divisi` append-only (RM-D6/Rule 10). Migrasi
   `20260813060000_m6d_wrr_close_guards.sql`.
3. **PR ini (SESI6) di-merge ke `main`**; ia MEMUAT D-03 (dari PR #156) + D-04 + D-05
   sekaligus karena branch kerja adalah superset PR #156. **PR #156 ditutup sebagai
   superseded** (isinya — D-03 — tercakup penuh di sini).
4. Gate **112/33/21/44 tetap** sepanjang D-03/D-04/D-05 (nol tabel/mesin/prefix/event baru).

---

## 1. Yang MENDARAT

### D-04 — jalur manual + `—` + teks (`20260813050000_m6d_wrr_manual.sql`)
Menutup trio fallback RM-C. Nol tabel/mesin/prefix/event.
- **RM-C7 CHECK** `ck_wrr_metrik_manual_bukti` — baris `manual` WAJIB `file_bukti`
  (non-blank) + `tanggal_ambil`; bentuk sama `ck_plan_actual_manual_bukti` (M6B).
  `otomatis`/`tidak_tersedia` dikecualikan. Ditunda dari D-01/D-03 ke sini (cermin
  B-06 buka `plan_actual` sebelum B-01 punya CHECK-nya).
- **Jalur `—` (RM-C3/C4/C5 'W isi atau —')** — RLS INSERT `wrr_metrik` dilebarkan
  `sumber='manual'` → `sumber <> 'otomatis'` supaya AM bisa menuliskan `tidak_tersedia`
  (nilai NULL → render `—`). **Invariant auto-block UTUH** (`otomatis` tetap ditolak
  braces RLS + belt trigger). Bukan pelebaran read-scope → **O48 tak tersentuh**.
- **RM-C9** kolom teks-only `wrr_catatan.catatan_metrik_tambahan` (RM-4/RM-7/RM-11) —
  catatan bebas CPL/impressions/CPC/CPM/view-organik. **BUKAN metrik**: tak diparse,
  tak masuk delta/rollup/skor. Jalur tulis `wrr_catatan` (domain) = D-09.
- Tes `recap.manual.test.ts` (6).

### D-05 — narasi wajib saat tutup + append-only (`20260813060000_m6d_wrr_close_guards.sql`)
Dua penegakan DB. Nol tabel/mesin/prefix/event.
- **Gerbang narasi (RM-D / Rule 8)** — trigger BEFORE UPDATE `guard_wrr_narasi_saat_tutup`
  memblok edge AM `Terbuka→Ditutup` bila RM-D1 «Yang Bergerak» / RM-D3 «Fokus Minggu
  Depan» kosong; RM-D2 «Yang Tertahan» wajib **bila ada blocker** (Brief `[Blocked]`
  minggu ini, terbaca `wrr_divisi.rincian.brief.blocked > 0`). **Force-close
  (`→ Ditutup Otomatis`) & buka-kembali (`→ Terbuka`) SENGAJA tak kena** (Rule 8:
  force-close menandai tak-lengkap, bukan memblokir).
- **`wrr_catatan_divisi` append-only (RM-D6/Rule 10)** — `forbid_mutation()` BEFORE
  UPDATE/DELETE (pola `audit_log`); INSERT tetap terbuka (jalur tulis divisi = D-09).
- Tes `recap.close.test.ts` (8) + `recap.test.ts` (close D-02 kini menyemai narasi).

**Verifikasi (hijau lokal):** rebuild bersih **96 migrasi** + seed 2× + semua gate
(112/33/21/44) + 4 invariant SQL; domain suite **1209 lulus** (+14 sejak D-03: 6 D-04
+ 8 D-05) 1 skip; typecheck 4 paket bersih.

**Keputusan dicatat:** `docs/DECISIONS.md` 2026-08-13 (dua baris teratas = D-05 lalu D-04).

---

## 2. Titik mulai sesi berikutnya — **D-06** (lalu D-07…D-14)

Urutan sisa (detail `docs/backlog/M6D_BACKLOG.md`; D-01…D-05 kini ✅ DONE):

- **D-06** — **job Senin 00:00 WIB** ← **mulai di sini**
  - Buka rekap tiap klien aktif (kecuali `hold`/`paused` RM-2), `Terjadwal → Terbuka`,
    tautkan ke periode Plan `Aktif` bila ada (else `Tanpa Plan`). **Idempoten** (satu
    rekap per klien per minggu ISO — unik sudah ada D-01).
  - **Force-close** rekap minggu lalu yang belum `Ditutup` setelah **N=2 hari kerja**
    (`working_days_between` — cek apakah helper sudah ada; RM-5) → `Terbuka → Ditutup
    Otomatis` + set `pernah_ditutup_otomatis=true` (guard D-02 sudah melindungi permanensi).
  - **Job ini yang MEMANGGIL `wrr_aggregate(recap_id)`** — service-role / **aktor NULL**
    (belt trigger D-03 menolak aktor JWT). Panggil untuk rekap `Terbuka` minggu berjalan.
  - **pg_cron DIBUNGKUS** `IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name='pg_cron')`
    — absen di Postgres polos CI, jadi migrasi harus tetap apply di CI tanpa cron.
    Logika job sebagai fungsi SQL yang bisa dipanggil manual (tes) + dijadwalkan cron bila ada.
  - Reminder (RM): notif menjelang deadline — **tapi emisi notif = butuh katalog D-07**
    (lihat ranjau). Kalau D-06 mendahului D-07, sisakan hook reminder tanpa `notify_emit`,
    atau kerjakan D-07 lebih dulu bila reminder-nya kritikal. **Rekomendasi: D-07 sebelum
    reminder-emitting bagian D-06**, atau gabung urutannya.
- **D-07** — notif **v7=48** (+4 event M6D). Satu baris `notif_catalog_versions`
  (`eventCount: 4`), **jangan** setel literal (O55). ⚠️ Menaikkan `notif_events` 44→48 →
  **edit gate di DUA berkas**: `.github/workflows/ci.yml` + `scripts/db-rebuild.sh`.
  Kandidat 4 event M6D: `sengketa_angka` (RM-B6/RM-C → SPV), `catatan_divisi_belum_diisi`
  (RM-D6 → lead divisi + AM), `rekap_dibuka`/reminder (D-06), `rekap_ditutup_otomatis`
  (force-close). **Konfirmasi daftar tepat dari PRD §9 katalog sebelum menyetel.**
  Di sinilah **emisi Sengketa Angka** (yang D-05 tunda) & **catatan_divisi_belum_diisi**
  dipasang (`notify_emit` di transaksi pemicu).
- **D-08** — rollup rekap `Ditutup` → PE-3/PE-8 Plan M6B (klien Tanpa Plan berdiri sendiri).
  **Guardrail: rekap TAK PERNAH menulis M6B PE-1 (GMV manual).**
- **D-09** — domain `recap.ts` lengkap: reads (own-clients / SPV all / **lead divisi RM-D6**
  — arm baca lead divisi ditambah DI SINI, entri O48 tersendiri) + write RM-A6/RM-C/RM-D/
  **close** + route API + wire `*ToWire` (null eksplisit, hindari O43) + shape-parity.
  `KNOWN_GAPS` tetap kosong. **Kelengkapan metrik saat tutup ('isi atau —') dikerjakan
  DI SINI** (D-05 sengaja memindahnya ke domain close — lihat §3).
- **D-10** — UI rekap internal.
- **D-11/D-12/D-13** — integrasi `/health` (H-1…H-4 + portfolio landing + degradasi
  per-blok O52). **Skor M13 TIDAK disentuh.** D-12 butuh endpoint list baru — jangan
  lebarkan RLS tanpa entri O48.
- **D-14** — M14 komponen Disiplin Rekap (bobot AM 45/22.5/22.5/10, RM-9a).

**Guardrail utama:** GMV single-source (rekap **tak pernah** tulis M6B PE-1); di `/health`
dua GMV wajib berlabel beda (`GMV Growth` M4 vs `GMV Eksekusi interim` M6D), tak dijumlahkan.

---

## 3. Ranjau repo (tetap berlaku + BARU dari D-04/D-05)

- Migrasi HANYA lewat `supabase/migrations/**` + `apply_migration` — **jangan** `psql -f`
  (O38). DB lokal rebuild HANYA `scripts/db-rebuild.sh`.
- **Gate hitung di DUA berkas** (`ci.yml` + `db-rebuild.sh`) — naikkan KEDUANYA bersama
  migrasi yang menambah tabel/mesin/prefix/event. **D-07 akan mengenai ini: 44→48.**
- **BARU (D-04): RLS INSERT `wrr_metrik` = `sumber <> 'otomatis'`** (bukan lagi `='manual'`).
  AM boleh tulis `manual` DAN `tidak_tersedia`. `otomatis` tetap ditolak (braces+belt).
  Jangan "perketat" balik ke `='manual'` — itu memutus jalur `—` (RM-C4/C5).
- **BARU (D-05): `wrr_catatan_divisi` append-only** — no UPDATE/DELETE dari SIAPA pun
  (termasuk service-role). Ia punya FK `ON DELETE CASCADE` ke recap ⇒ **cascade-delete
  parent akan MEMICU guard no-delete**. Di TES pakai **`TRUNCATE wrr_catatan_divisi`**
  sebelum menghapus recap induk (preseden `strategi_version` di `strategi.test.ts`), bukan
  `DELETE`. Sama untuk produksi: rekap tak pernah di-hard-delete.
- **BARU (D-05): gerbang narasi hanya `Terbuka→Ditutup`** — kalau menambah edge/transisi
  ke mesin #18, ingat trigger `guard_wrr_narasi_saat_tutup` mem-branch di
  `OLD.status='Terbuka' AND NEW.status='Ditutup'`. Force-close & reopen sengaja lewat.
- **BARU (D-05): dua hal DITUNDA dari D-05** — (a) **emisi notif Sengketa Angka** →
  **D-07** (butuh event katalog; `notify_emit` menolak event hantu); (b) **kelengkapan
  metrik saat tutup** → **D-09 domain close** (gerbang DB tak tahu apakah agregasi D-06
  jalan; validasi field wajib = tanggung jawab route handler per kontrak `sm_transition`).
- **(D-03, masih berlaku): tak ada kolom timestamp per-status** — "capai status X minggu
  ini" via `audit_log` (`transition:%->[X]` + `wib_date`). `wrr_aggregate` **sistem-only**
  (aktor NULL). `audit_log` append-only → tes suntik audit pakai **ID unik per-run**.
- Wire snake_case: route kirim objek domain mentah = bug **O43** (blank walau 200).
  `*ToWire` satu-satunya penerjemah; `null` eksplisit, bukan `omitempty`. (Relevan D-09.)
- `route-parity.test.ts` `KNOWN_GAPS` tetap **kosong**.
- **O48**: melebarkan SELECT/RLS-baca per tabel butuh entri ledger + `DECISIONS.md`. (D-09/D-12.)
  Catatan: pelebaran RLS **INSERT** D-04 (`sumber<>'otomatis'`) BUKAN O48 — `rls_checks.sql`
  hanya memindai kebijakan baca (`r`/`*`).
- Kelas **O52**: read/join gagal jangan mem-blank seluruh halaman — load per blok. (D-11/12/13.)
- `backend/**` read-only (Go + MySQL pensiun). Status hanya lewat `sm_transition`; derived
  field recomputable dari log; bagi-nol render `—` (#7).

---

## 4. Lingkungan dev lokal
- Postgres 16: `pg_ctlcluster 16 main start` lalu
  `su postgres -c "psql -c \"ALTER ROLE postgres WITH PASSWORD 'postgres';\""` (auth TCP).
- Install: **`npm ci`** (npm workspaces, BUKAN pnpm — hapus `pnpm-lock.yaml` kalau muncul).
- Rebuild: `scripts/db-rebuild.sh --yes`.
- Tes DB: `cd packages/domain && DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps" npx vitest run src/<pola>`.
  Suite `*.reals/aggregate/manual/close.test.ts` **skip tanpa DATABASE_URL** — "N skip" bukan "N pass".
- Typecheck: `npm run -s typecheck` (root).

---

## 5. Sumber kebenaran
- `docs/prd/CDPS_Module6D_Rekap_Hasil_Mingguan.md` (§4 Rule 7/8/10 · §5 flow · §9 · matriks §9).
- `docs/backlog/M6D_BACKLOG.md` (D-01…D-14; D-01…D-05 ✅ DONE).
- `docs/STATE_MACHINES.md` §15 (mesin #18). `docs/DATA_MODEL.md` (WRR-).
- `docs/DECISIONS.md` 2026-08-13 (baris teratas = D-05, lalu D-04, lalu D-03 …).
- Kode: `supabase/migrations/2026081303*`(autoblock) `04*`(aggregate) `05*`(manual) `06*`(close_guards);
  `packages/domain/src/recap.ts` (+`canWriteRecap`), `recap.test.ts`, `recap.reals.test.ts`,
  `recap.aggregate.test.ts`, `recap.manual.test.ts`, `recap.close.test.ts`.
