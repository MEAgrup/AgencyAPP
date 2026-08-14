# Handoff — M6D (Rekap Hasil Mingguan) SESI 9 — D-11 + D-12 + D-13 (integrasi Health) mendarat

**Tanggal:** 2026-08-14 · **Branch kerja:** `claude/d11-12-handoff-tewau1`

> Rantai M6D: SESI1 (spec) → … → SESI7 (D-06/D-07/D-08 + D-09 domain) → SESI8 (D-09b + D-10)
> → **SESI9 (ini) = D-11 (4 blok ringkasan) + D-12 (portfolio landing) + D-13 (degradasi per-blok)**.
> Baca SESI8 dulu untuk konteks route/wire/FE recap. **D-01…D-13 ✅ DONE.** Sisa M6D = **D-14**
> (M14 komponen Disiplin Rekap) — satu-satunya tiket tersisa, di modul M14 bukan M6D.

---

## 0. Ringkasan sesi ini

1. **D-11** — 4 blok read-only (M6D §8.2) di halaman health per-klien
   (`web-internal/src/app/(shell)/health/[clientId]/page.tsx`), di bawah header skor.
2. **D-12** — `health/page.tsx` jadi **tabel portfolio** klien aktif; butuh **endpoint baru**
   `health.portfolio` (domain) → `GET /api/v1/health/portfolio` (route) → wire → FE.
3. **D-13** — degradasi per-blok: tiap blok load terpisah `try/catch`, **absen bukan error**.
4. **Skor M13 TIDAK disentuh** — nol perubahan `packages/domain/src/health.ts` scoring
   (fungsi `portfolio` baru hanya membaca, tak menyentuh 7 komponen/bobot).
5. **Nol migrasi baru, nol event baru** → gate **112/33/21/48 TETAP**.
6. Verifikasi hijau (DB segar via `scripts/db-rebuild.sh`): domain **1242 pass / 1 skip**,
   apps/api **345 pass**, web-internal **238 pass**; typecheck+lint bersih; parity route/shape/body hijau.

---

## 1. Yang MENDARAT

### D-11 — 4 blok ringkasan (`health/[clientId]/page.tsx`)
Semua pakai FE-lib yang **sudah** ada (recap D-09b, complaint M6, interview). Nol endpoint baru untuk D-11.
- **H-1 Hasil & Progress Mingguan** — rekap minggu **`Ditutup`/`Ditutup Otomatis`** terbaru
  (`listRecapsForClient` → cari yang tertutup → `getRecapDetail`): tabel produksi per divisi +
  tabel metrik terkonsolidasi + **Δ vs minggu lalu** (dari `nilai_minggu_lalu` per baris metrik) +
  headline narasi RM-D1 «Yang Bergerak»/RM-D2 «Yang Tertahan» + **kumulatif Plan RM-E**
  (`getPlanRekapRollup` bila `plan_id`). Label **GMV Eksekusi (interim)** vs **GMV Growth**, dan
  **ROAS (Ads)** vs **ROAS Attainment**, + catatan "tidak dijumlahkan" (§8.3 Rule 2/3).
- **H-2 Status Laporan** — status minggu berjalan (`recaps[0]`) + badge `pernah_ditutup_otomatis`,
  hitung **AM-closed vs Auto-Closed** dari 4 rekap teratas, **Sengketa Angka terbuka** (dihitung dari
  detail minggu **berjalan** — tempat sengketa hidup, bukan minggu tertutup).
- **H-3 Komplain Aktif** — `listComplaints(clientId)`, filter `[Open]`/`[In Progress]`.
- **H-4 Kesiapan Klien** — `listInterviewsByClient(clientId)`, ambil verdict+prasyarat baris terbaru
  (advisory; InterviewListRow **sudah** membawa `verdict`+`prasyarat_status`, tak perlu call kedua).

### D-12 — portfolio landing (endpoint BARU)
- **Domain** `packages/domain/src/health.ts::portfolio(sql, actor)` → `PortfolioRow[]`:
  klien **aktif** (RM-2 = EXISTS service `status NOT IN ('Done','[Cancelled — Service Voided]')`),
  per baris: band+score snapshot terbaru, **flag band-drop** (band terbaru < band sebelumnya, Rule 12),
  komplain terbuka (`[Open]`+`[In Progress]`), **freshness** (`iso_year-Www` minggu `Ditutup` terakhir).
  Gerbang: `canScope` masuk (else Forbidden) → filter baris `canView(actor, ownerAm)`.
- **Route** `apps/api/src/app/api/v1/health/portfolio/route.ts` — `GET`, pakai **`db()`** (bukan
  `readAsActor`), balik `{ data: HealthPortfolioRowWire[] }`.
- **Wire** `wire.ts::HealthPortfolioRowWire` + `healthPortfolioRowToWire`, didaftar `WIRE_TO_FE`
  (`health.ts::HealthPortfolioRow`).
- **FE** `web-internal/src/lib/health.ts`: `HealthPortfolioRow` (kunci identik wire) + `getHealthPortfolio()`;
  `health/page.tsx` = tabel (tombol scan dipertahankan, refresh tabel sesudah sweep).

### D-13 — degradasi per-blok
Tiap blok (H-1…H-4 + rollup) di-load lewat loader terpisah dgn `try/catch` → state kosong bila gagal →
blok tak dirender. Halaman **tak pernah blank** karena satu sumber 403/kosong (O52 / §8.3 Rule 5).
H-4 otomatis hormati `canReadVerdict` yang lebih sempit: bila route interview menolak, blok absen.

---

## 2. Titik mulai sesi berikutnya — **D-14** (satu-satunya sisa)

- **D-14** — M14 komponen **Disiplin Rekap Mingguan** (RM-9/RM-9a, **bobot sudah ditandatangani**
  pemilik 2026-08-13): profil AM **45/22.5/22.5/10** (carve 10% Disiplin Rekap), profil divisi
  Creative/Ads/KOL carve **5%** Kepatuhan Catatan. **Bukan** komponen ke-8 M13. M6D **sudah menyuplai
  sinyal mentah**: status tutup rekap + `pernah_ditutup_otomatis` + ada/tidak `wrr_catatan_divisi`.
  D-14 = **amandemen M14** yang menghitung, bukan pekerjaan M6D lagi. Detail: M14 PRD §9 + backlog
  M6D §4 (tabel D-14) + `docs/DECISIONS.md` 2026-08-13. **Diurut bareng/sesudah M14.**

---

## 3. Ranjau repo (tetap + BARU dari D-11/D-12)

- **BARU (D-12) portfolio pakai `db()` + `canView`, BUKAN `readAsActor`.** Read fan-out ke
  clients/snapshots/complaints/recaps; RLS blank spurious di sub-select akan **menjatuhkan baris
  diam-diam** (bukan error yang kelihatan). `canView` = otorisasi M13 yang **sama** dgn halaman
  per-klien, jadi tabel **tak melebarkan** cakupan baca — **tak menyentuh RLS** (konteks O48).
  Preseden: read recap D-09b + health scan, keduanya `db()`.
- **BARU (D-11) H-1 = minggu `Ditutup` terbaru** (hasil final), **Sengketa dihitung dari minggu
  BERJALAN** (dua detail berbeda di-load). Jangan gabung — minggu tertutup jarang punya sengketa aktif.
- **BARU (D-11) degradasi = per-blok `try/catch`, bukan satu load besar.** Menggabung load akan
  membuat satu 403 mem-blank blok lain. Tiap blok punya loader + state sendiri.
- **BARU (shape-parity) `HealthPortfolioRowWire` wajib punya kunci identik dgn FE `HealthPortfolioRow`.**
  Skalar+`| null`; tak ada nested → aman. Sudah didaftar `WIRE_TO_FE`.
- **BARU (route-parity) `getHealthPortfolio` FE dilayani `/health/portfolio`.** `KNOWN_GAPS` tetap **kosong**.
- **Skor M13 tak boleh disentuh** — `portfolio` hanya baca band tersimpan, tak memanggil `score()`
  atau menulis snapshot. Band-drop dihitung dari dua snapshot terakhir, **tak** meng-emit notif
  (itu tugas `fireSnapshot` saat sweep, bukan tampilan).
- Wire snake_case: `null` eksplisit, bukan omitempty (O43). `backend/**` read-only (Go+MySQL pensiun).
- Migrasi HANYA lewat `supabase/migrations/**` + `apply_migration` (O38); DB rebuild HANYA
  `scripts/db-rebuild.sh`. **Sesi ini nol migrasi.**

---

## 4. Lingkungan dev lokal
- Install: **`npm ci`** (npm workspaces, BUKAN pnpm) — wajib dulu, node_modules tak ter-commit.
- Typecheck: `npm run -s typecheck` (root, semua workspace).
- Tes DB (Postgres 16): `scripts/db-rebuild.sh --yes` (butuh server jalan + role `postgres`/pwd
  `postgres` utk koneksi TCP; sandbox: `service postgresql start` lalu
  `ALTER USER postgres PASSWORD 'postgres'`), lalu
  `DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps" npx vitest run` di tiap workspace.
  Tanpa `DATABASE_URL`, suite DB **skip** (portfolio test ada di `health.test.ts` `describeDb`).
- Lint: `cd web-internal && npx eslint <path>` / `cd apps/api && npx eslint <path>`.

---

## 5. Sumber kebenaran
- `docs/prd/CDPS_Module6D_Rekap_Hasil_Mingguan.md` §8 (kontrak integrasi Health: H-1…H-4, §8.3 rules).
- `docs/backlog/M6D_BACKLOG.md` (D-01…D-13 ✅ DONE; sisa **D-14** di §4).
- `docs/DECISIONS.md` 2026-08-14 (D-11/D-12/D-13 — baris teratas) & 2026-08-14 (D-09b/D-10) & 2026-08-13.
- Kode: `packages/domain/src/health.ts` (`portfolio`, `PortfolioRow`) + `health.test.ts` (+2);
  `apps/api/src/app/api/v1/health/portfolio/route.ts`; `apps/api/src/lib/wire.ts` (`HealthPortfolioRowWire`);
  `apps/api/src/lib/shape-parity.test.ts` (`WIRE_TO_FE`);
  `web-internal/src/lib/health.ts` (`getHealthPortfolio`);
  `web-internal/src/app/(shell)/health/page.tsx` (portfolio) + `health/[clientId]/page.tsx` (H-1…H-4).
