# Handoff — M6D (Rekap Hasil Mingguan) SESI 4 — implementasi D-01 + D-02 + rekomendasi PR #141/#142

**Tanggal:** 2026-08-13 · **Branch:** `claude/m6d-handoff-weekly-report-dw7s0f`

> Rantai M6D: SESI1 (spec) → SESI2 (resolusi RM-1…RM-11) → SESI3 (sign-off pemilik + antrean PR)
> → **SESI4 (ini)**. SESI4 = **implementasi pertama** — D-01 (skema) + D-02 (mesin #18) **MERGED ke main**,
> plus rekomendasi resolusi PR #141 vs #142. Baca SESI3 untuk konteks antrean PR.

---

## 0. Ringkasan sesi ini

1. **D-01 + D-02 diimplementasikan, CI hijau, MERGED ke main** (PR #154 → `c68f4dc`). Main kini punya
   skema `WRR-` + mesin #18. Ini kode pertama M6D (sebelumnya semua spec-only).
2. **PR #154 (M6D) merged.** Sekaligus memperbaiki drift gate CI (ci.yml vs db-rebuild.sh).
3. **Rekomendasi #141 vs #142** (blocker warisan SESI3) — lihat §3. **Belum dieksekusi** (eksekusi = chat berikutnya, sesuai arahan pemilik).

---

## 1. Yang MENDARAT (D-01 + D-02, sudah di main)

### D-01 — skema + prefix (`316defb`)
- Migrasi `supabase/migrations/20260813010000_m6d_wrr_schema.sql`:
  - Induk **`weekly_result_recap`** (`WRR-`) + 4 anak: `wrr_divisi` (RM-B), `wrr_metrik` (RM-C, bentuk
    sama `plan_actual`), `wrr_catatan` (RM-D 1:1), `wrr_catatan_divisi` (RM-D6 thread).
  - FK `plan_id` **nullable** (klien Tanpa Plan, R2, ON DELETE SET NULL); index unik `(client_id,
    iso_year, iso_week)`; kunci minggu ISO disimpan eksplisit; `pernah_ditutup_otomatis` (default false).
  - `wrr_metrik`: kolom `sumber ∈ otomatis/manual/tidak_tersedia`, `nilai` NULLABLE (`—`),
    `nilai_minggu_lalu` (delta RM-C8), `sengketa` (hanya saat `otomatis`).
- Prefix `WRR` di **dua tempat** (M6A §7): `entity_prefix` + `packages/core/src/ident.ts::PREFIXES`.
- RLS SELECT: `jwt_can_read_all()` + `jwt_owns_client_am(client_id)` + Account-lead. Anak scope via
  `private.jwt_can_read_recap` (SECURITY DEFINER, cermin induk). **Jalur tulis tetap default-deny** sampai D-03/D-09.
- 4 `wrr_*_select` masuk **ledger O48** `supabase/tests/rls_checks.sql` (kelas false-negative sama seperti
  anak Plan/Strategi) + entri `docs/DECISIONS.md` 2026-08-13.

### D-02 — mesin #18 + gerbang domain (`1692b97`)
- Migrasi `supabase/migrations/20260813020000_m6d_wrr_machine.sql`:
  - `sm_machines`/`sm_edges`/`sm_terminal_states` untuk `weekly_result_recap`. Edge:
    `Terjadwal→Terbuka` (sistem), `Terbuka→Ditutup` (AM), `Terbuka→Ditutup Otomatis` (sistem),
    `Ditutup Otomatis→Terbuka` (Head, **require_lead**). Terminal SEJATI **hanya `Ditutup`**
    (`Ditutup Otomatis` quasi-terminal — satu edge keluar untuk Head).
  - Guard trigger `guard_wrr_pernah_ditutup_otomatis`: tolak `true→false` (flag permanen RM-5/RM-9).
- `packages/domain/src/recap.ts`: `transitionRecap` (wrapper `sm_transition`, satu jalur transisi) +
  gerbang murni **`canCloseRecap`** (AM pemilik / Head Account / Direktur) & **`canReopenRecap`**
  (Head Account / Direktur, **BUKAN** AM pemilik — RM-5). Konstanta mesin/state. Diekspor di `index.ts` barrel.
- `packages/domain/src/recap.test.ts`: 18 tes (12 gerbang murni + 6 DB).

### Gate CI diselaraskan (`a605547`)
Angka hitung hidup di **DUA** tempat — `.github/workflows/ci.yml` **dan** `scripts/db-rebuild.sh`. D-01/D-02
menaikkan keduanya: **tabel 107→112, entity_prefix 32→33, sm_machines 20→21** (notif_events tetap 44 — v7
menyusul D-07). ⚠️ **Menambah tabel/mesin/prefix = edit KEDUA berkas dalam commit yang sama** (jebakan yang
membuat CI merah walau suite lokal hijau).

**Verifikasi (hijau di CI + lokal):** db-rebuild semua gate + 4 invariant SQL; `@cdps/core` 219,
`@cdps/db` 48, `@cdps/domain` 1183 + `recap.test.ts` 18; typecheck 4 paket bersih.

---

## 2. Titik mulai sesi berikutnya — **D-03** (jalur kritis M6D)

Sumber divisi **sudah hijau** (dicek SESI4): `creative.ts` (`[Approved]`), `ads.ts` (`MTR-`),
`kol.ts` (`[QC Passed]`), `livestream.ts` (`[Reconciled]`) — **tidak ada blocker sumber**.

Urutan tiket tersisa (detail `docs/backlog/M6D_BACKLOG.md`):
- **D-03** — agregasi auto (read-only) isi `wrr_divisi`/`wrr_metrik` `otomatis` dari M7/M8/M9/M10 per klien
  per window minggu. **UPDATE-block baris `otomatis`** di DB (trigger) **+** RLS `WITH CHECK` (invariant beku,
  bentuk sama `plan_actual` M6B — TS predikat & RLS tak boleh divergen). ← **mulai di sini**
- **D-04** — jalur manual RM-C + `—` + CHECK `file_bukti`/`tanggal_ambil` NOT NULL saat `manual` + field
  teks-only **RM-C9** "Catatan Metrik Tambahan" (di `wrr_catatan`; ALTER TABLE ADD COLUMN).
- **D-05** — narasi wajib saat tutup + `Sengketa Angka` (notif SPV, tak blok tutup) + append-only guard
  `wrr_catatan_divisi`.
- **D-06** — job Senin 00:00 WIB (buka rekap klien aktif kecuali hold/paused + force-close N=2 hari kerja)
  + reminder. **pg_cron dibungkus guard `IF EXISTS pg_available_extensions`** (absen di Postgres polos CI).
- **D-07** — notif **v7=48** (+4 event) — satu baris `notif_catalog_versions` (`eventCount: 4`), **jangan**
  setel literal. ⚠️ Ini juga menaikkan `notif_events` 44→48 → **edit gate di ci.yml + db-rebuild.sh**.
- **D-08** — rollup rekap `Ditutup` → PE-3/PE-8 Plan M6B (klien Tanpa Plan berdiri sendiri).
- **D-09** — domain `recap.ts` lengkap (reads own-clients/SPV all + write RM-A6/RM-C/RM-D/close) + route
  API + wire `*ToWire` (null eksplisit, hindari O43) + shape-parity. `KNOWN_GAPS` tetap kosong.
  (Di sinilah arm baca **lead divisi** ditambahkan bersama jalur tulis RM-D6 — dgn entri O48 tersendiri.)
- **D-10** — UI rekap internal.
- **D-11/D-12/D-13** — integrasi `/health` (4 blok H-1…H-4 + portfolio landing + degradasi per-blok O52).
  **Skor M13 TIDAK disentuh.** D-12 butuh endpoint list baru (belum ada di `health.ts`) — jangan lebarkan RLS tanpa entri O48.
- **D-14** — M14 komponen Disiplin Rekap (bobot AM 45/22.5/22.5/10 sudah ditandatangani RM-9a).

**Guardrail utama:** GMV single-source (rekap **tak pernah** tulis M6B PE-1); di `/health` dua GMV wajib
berlabel beda (`GMV Growth` M4 vs `GMV Eksekusi interim` M6D), tak dijumlahkan.

---

## 3. ⭐ Rekomendasi resolusi PR #141 vs #142 (blocker warisan SESI3)

**Konteks:** keduanya mengimplementasikan fitur SAMA (M6A langkah 8 — handoff Interview→Strategi:
kolom `sumber`/`interview_id`/`interview_version`/`blok_d_flags` di `strategi`) lewat migrasi berbeda
(`20260811090000` vs `20260812000000`). **Cuma satu boleh masuk** (dua = kolom dobel, rantai migrasi rusak).
Keduanya authored `yohanagustian-del`, base `6d68cb9` (kini di belakang main `c68f4dc`).

### Bukti baru (CI) yang MEMBALIK rekomendasi SESI3

SESI3 condong ke **#141** (lebih lengkap). **SESI4 memeriksa status CI aktual** dan menemukan pembalik:

| | **#141** (`strategi-prefill-fixture`) | **#142** (`strategi-form-fe-handoff`) |
|---|---|---|
| Cakupan | langkah **8 + 9** (fixture Alpha Digital) | langkah **8** saja |
| Frontend | wire-mirror saja (shape-parity) | **UI kaya**: `StrategiHandoffCard`, tab "Strategi" di Interview, badge flag Blok D |
| **CI `db-and-migrations`** | **❌ MERAH** | **✅ HIJAU** |
| CI lain (core/api/web/backend) | ✅ hijau | ✅ hijau |
| Baris | +730/-8 | +951/-9 |
| Migrasi | `20260811090000` (FK RESTRICT) | `20260812000000` |

Keduanya diuji atas base yang SAMA (`6d68cb9`), jadi merah-nya #141 **intrinsik**, bukan drift main.
Penyebab paling mungkin: **fixture langkah-9 di `seed.sql`** (#141) yang lulus lokal PG16 tapi memecah
`db-and-migrations` di CI PG17 — persis komponen unik #141 yang jadi bumerang.

### 🎯 Rekomendasi: **ambil #142, tutup #141, + follow-up fixture**

**Alasan:** #142 CI hijau penuh **dan** membawa FE terlengkap (bagian termahal untuk dibangun ulang).
Satu-satunya kekurangan #142 = fixture Alpha Digital langkah-9 (item DoD) — yang justru adalah bagian yang
**memecah CI #141**. Jadi: ambil basis yang hijau + FE-lengkap, lalu tambahkan fixture-nya **hati-hati**
sebagai follow-up kecil (hindari kesalahan yang membuat #141 merah).

**Langkah eksekusi (chat berikutnya):**
1. Update branch #142 (`claude/strategi-form-fe-handoff-a8xctz`) ke `main` terkini (`c68f4dc`) — cek konflik
   di `strategi.ts`/`interview.ts`/`wire.ts` (M6D #154 tak menyentuhnya, risiko rendah).
2. Jalankan CI; pastikan `db-and-migrations` tetap hijau atas main terkini (gate kini 112/33/21; #142 tambah
   0 tabel/mesin/prefix → tetap lolos).
3. **Merge #142.** **Tutup #141** dengan komentar sopan: fitur duplikat, #142 dipilih karena CI hijau + FE
   lengkap; fixture langkah-9 di-port terpisah.
4. **Follow-up (tiket baru):** port fixture Alpha Digital langkah-9 dari #141 (`seed.sql` seksi 6:
   klien + Interview `Selesai` + `interview_kualifikasi` growth_ready@100) — DoD "fixture Alpha Digital
   end-to-end". **Debug dulu kenapa versi #141 memecah `db-and-migrations`** sebelum menyalin (kemungkinan
   gate seed/idempotensi atau interaksi tes domain), supaya tak mengulang merah.

**Alternatif** (kalau pemilik prioritaskan kelengkapan langkah-9 sekarang): ambil #141 sebagai basis, **tapi
wajib** perbaiki dulu kegagalan `db-and-migrations`-nya + graft FE `StrategiHandoffCard` dari #142 — lebih
banyak kerja & risiko. Tidak direkomendasikan.

### #140 (draft docs SESI30)
Masih **draft**, isinya handoff SESI30 (mungkin usang). Rekomendasi: konfirmasi ke pemilik lalu **tutup**
(bukan merge) — atau biarkan; bukan blocker.

---

## 4. Ranjau repo (tetap berlaku)
- Migrasi HANYA lewat `supabase/migrations/**` + `apply_migration`/`supabase db push` — **jangan** `psql -f` (O38).
  DB lokal rebuild HANYA `scripts/db-rebuild.sh`.
- **Gate hitung di DUA berkas** (`ci.yml` + `db-rebuild.sh`) — naikkan KEDUANYA bersama migrasi yang menambah tabel/mesin/prefix/event.
- Wire snake_case: route yang kirim objek domain mentah = bug **O43** (halaman blank walau 200). `*ToWire` satu-satunya penerjemah; `null` eksplisit, bukan `omitempty`.
- `route-parity.test.ts` `KNOWN_GAPS` tetap **kosong**.
- **O48**: melebarkan SELECT/RLS per tabel butuh entri ledger + `DECISIONS.md`. (D-09/D-12.)
- Kelas **O52**: read/join gagal jangan mem-blank seluruh halaman — load per blok terpisah.
- `backend/**` read-only (Go + MySQL pensiun).
- Status hanya lewat `sm_transition`; derived field recomputable dari log; bagi-nol render `—` (aturan rumah #7).

## 5. Lingkungan dev lokal (untuk sesi implementasi)
- Postgres tidak auto-start di container: `pg_ctlcluster 16 main start` lalu
  `su postgres -c "psql -c \"ALTER ROLE postgres WITH PASSWORD 'postgres';\""` (untuk auth TCP).
- Rebuild: `scripts/db-rebuild.sh --yes`. Tes: `DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps" npm test --workspace @cdps/<pkg>`.
- **npm workspaces, BUKAN pnpm** (pnpm-lock.yaml stray → hapus). `npm ci` untuk install.

## 6. Sumber kebenaran
- `docs/prd/CDPS_Module6D_Rekap_Hasil_Mingguan.md` (§4/§5/§9/§10).
- `docs/backlog/M6D_BACKLOG.md` (D-01…D-14; D-01/D-02 kini DONE).
- `docs/STATE_MACHINES.md` §15 (mesin #18). `docs/DATA_MODEL.md` (WRR-).
- `docs/DECISIONS.md` 2026-08-13 (D-01 O48 ledger + resolusi RM + sign-off).
- Kode: `supabase/migrations/2026081301*/2026081302*`, `packages/domain/src/recap.ts`, `packages/core/src/ident.ts`.
