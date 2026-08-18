# HANDOFF — Riset Awal Baseline / M6B: **Wave E SELESAI (RAB-19 + RAB-20) — SELURUH RAB-01…RAB-20 TUNTAS** — Sesi 40

> Rantai: … → SESI38 (RAB-14/15, PR #179 — MERGE) → SESI39 (RAB-16/17/18, PR #180 — **MERGE**)
> → **SESI40 (ini, terbaru — RAB-19 + RAB-20).**
> Baca yang bernomor tertinggi lebih dulu; **SESI31 tetap sumber SPEK & KEPUTUSAN** (jangan tanya ulang).
>
> **Status: RAB-01…RAB-20 SELESAI, teruji. Backlog `RISET_AWAL_BASELINE_BACKLOG.md` TUNTAS
> (Wave A+B+C+D+E semua hijau).** Tak ada tiket RAB tersisa.

## 0. CARA MELANJUTKAN DI CHAT BARU — baca ini dulu

### 0.0 Posisi branch & PR

| Hal | Nilai |
|---|---|
| **Repo** | `MEAgrup/AgencyAPP` |
| **Branch sesi ini** | `claude/rab-19-20-lanjutan-21vttq` |
| **PR sesi ini** | (lihat catatan setelah push — RAB-19 + RAB-20, base `main`). |
| **Base saat kerja** | `main` (`d588ebc`, hasil merge #180). Branch di-restart dari `main` (PR #180 sudah merge). |

**Backlog Riset Awal Baseline TUNTAS.** Kalau chat berikut melanjutkan pekerjaan, ia bukan lagi tiket RAB —
lanjut ke Wave 2 build order berikutnya (`CDPS_Build_Plan.md` §4: M12 early → M7/M8/M9/M10 → M6D).

### 0.1 Aturan main yang MASIH berlaku (SESI31 §0.2 — jangan dilanggar)
- Migrasi HANYA lewat `supabase/migrations/**` + `apply_migration`. DB lokal HANYA lewat `scripts/db-rebuild.sh`.
- Tulis via service-role + gate domain; RLS memikul row-scope. Wire snake_case lewat `apps/api/src/lib/wire.ts`.
- **Rute = shell**: `requireActor` → validasi/map body → domain. **Jangan taruh logika di rute.**
- Setiap wire interface yang dibaca `web-internal` wajib dipasangkan di `shape-parity.test.ts` (`WIRE_TO_FE`)
  **dan** file FE-nya di `FE_FILES`. Import tipe FE lintas-lib WAJIB pakai alias `@/lib/xxx`.
- `route-parity.test.ts` `KNOWN_GAPS` **tetap kosong**.

### 0.2 Setup DB lokal + install deps (kalau container baru)
```
pg_ctlcluster 16 main start
sudo -u postgres psql -c "ALTER USER postgres PASSWORD 'postgres';"
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps" bash scripts/db-rebuild.sh --yes
npm install                          # root workspaces
cd web-internal && npm install       # web-internal app Next MANDIRI — install terpisah
```
⚠️ Tes domain integration WAJIB serial. Rebuild DB sebelum run ulang suite penuh & SETELAH menambah migrasi.

---

## 1. Yang SUDAH selesai sesi ini (jangan ulang)

### 1.1 RAB-19 — Koreksi PRD (satu keputusan di lima titik) + satu entri `DECISIONS.md`
SESI31 §0.2 menangguhkan aturan "PRD menang" untuk lima titik ini. **Dokumen-saja, nol kode/migrasi/tes.**
Tiap titik ditandai inline `⟳ RAB-19 (DECISIONS 2026-08-18)` dengan teks lama disebut "superseded original":

| Berkas | Titik | Koreksi |
|---|---|---|
| `CDPS_Module6A_Strategi.md:38` | D5 | angka boleh **dari mesin Riset Awal** (usulan); wajib = **konfirmasi AM per angka** |
| `CDPS_Module6A_Strategi.md:51` | D18 | sumber sah bertambah: **export seller-centre yang AM tarik sendiri**; **tetap tanpa auto-pull API** |
| `CDPS_Module6A_Strategi.md` OA-9 | §8.1 | auto-population **masuk cakupan**, model usulan→konfirmasi |
| `CDPS_Module6A_Strategi.md:64` | Rule 5 | **TIDAK dilonggarkan** — justru *dipenuhi* (`riset_awal_*` sha256 + tanggal ambil) |
| `CDPS_Module6B_Plan.md:37` | P3 | "no auto-Brief" **USANG** — RAB-16 "satu klik warisi-semua"; jalur STR- tetap dilayani |

**Ketiga baris M6A = satu keputusan** — dikoreksi bersama supaya tiket berikutnya tak memakai dua sisanya untuk
membatalkan pekerjaan Wave A–D. Satu baris `DECISIONS.md` 2026-08-18 (di puncak tabel Decided) melipat kelimanya.

### 1.2 RAB-20 — Build Plan + dokumen registry
**Dokumen-saja, nol kode/migrasi/tes.**
- **`CDPS_Build_Plan.md` Wave 2** — bullet baru "Riset Awal Baseline Engine + M6B Route Surface + Brief inherit
  (RAB-01…RAB-20)": tiga klaster (a. baseline 4 tabel + engine + gerbang + prefill, b. rute M6B, c. Brief inherit),
  + rujukan RAB-19/RAB-18. **Exit criteria Wave 2 ditambah baris "Riset-awal path proven"** (riset awal → gerbang →
  Section B → inherit Brief satu-klik).
- **`DATA_MODEL.md`** — baris **Brief** kini mencatat kolom `briefs.plan_row_id` (dua asal eksklusif, `uq_briefs_plan_row`,
  KOLOM bukan tabel ⇒ gate 118 tetap); baris **Riset Awal** kini mendaftar **4 tabel baseline as-built** (RAB-01:
  `riset_awal_analisa` · `riset_awal_sumber_berkas` · `interview_riset_awal_isian` · `riset_awal_benchmark`) —
  klausa lama "belum dibangun" diganti.
- **`STATE_MACHINES.md §6f`** — subseksi baru **"Gerbang prasyarat — `assertRisetAwalGate`"**: bukan edge mesin #20,
  melainkan gerbang yang mesin #19 lewati di dua transisi mulai (`scheduleInterview → Terjadwal`,
  `transitionInterview → Sedang Berlangsung`); tiga syarat (submit + setiap platform aktif ber-baseline +
  setiap isian terkonfirmasi); **per-platform = bebas-deadlock** (Shopee-saja lolos manual); pesan BI lengkap.

### 1.3 Verifikasi
- **Dokumen-saja.** Nol kode/migrasi/tes berubah ⇒ tak ada suite yang perlu dijalankan ulang (dikonfirmasi:
  tak ada tes yang mem-parse isi file doc — hanya menyebut namanya di komentar).
- Gate tabel/mesin/prefix/event **TETAP** (118/23/…/57) — nol perubahan skema.

---

## 2. BERIKUTNYA — backlog RAB TUNTAS, lanjut Wave 2 build order

Tak ada tiket RAB tersisa. Urutan build berikutnya (`CDPS_Build_Plan.md` §4 Wave 2):
**M12 Task Execution (early)** → M7 Creative / M8 Ads / M9 KOL / M10 Live Stream → **M6D Rekap Hasil Mingguan**
(di akhir wave, setelah M7–M10 mengekspos metriknya).

**Sisa OPEN QUESTION dari RAB-16 (belum menghalangi):** resolusi service untuk baris `strategi_pillar_id`
Full-Management — apakah kontrak kanoniknya satu service, atau baris pilar wajib ber-`service_id` eksplisit?
Sampai diputuskan pemilik, ambigu = `service_ambigu` (skip aman). Lihat `DECISIONS.md` 2026-08-18 RAB-16/17.

---

## 3. Jebakan yang MASIH relevan
1. Tes domain integration WAJIB serial. Rebuild DB sebelum run ulang suite penuh & SETELAH menulis migrasi baru.
2. web-internal app Next MANDIRI — `cd web-internal && npm install` terpisah.
3. Import tipe FE lintas-lib WAJIB `@/lib/xxx`, bukan relatif.
4. `strategi` (STRG-) terikat KONTRAK, bukan service — `strategi.service_id` tak ada lagi.
5. Rute = shell, logika di domain. `activatePlanPeriode` SENGAJA tidak auto-menjalankan pewarisan Brief.
6. Migrasi hanya lewat `supabase/migrations/**`; nambah **tabel** naikkan gate di DUA tempat — **kolom** tidak.

---

## 4. Sumber kebenaran
- **Backlog:** `docs/backlog/RISET_AWAL_BASELINE_BACKLOG.md` (§5 = Wave E — kini **TUNTAS**).
- **Spek/keputusan:** `HANDOFF_M6ABC_SESI31.md` (+ SESI32…39).
- `docs/DECISIONS.md` 2026-08-18 (RAB-19 di baris teratas; lalu RAB-18, RAB-16/17, RAB-14/15…).
- **PRD:** `docs/prd/CDPS_Module6_Interview.md` (RAB-18), `CDPS_Module6A_Strategi.md` + `CDPS_Module6B_Plan.md` (koreksi RAB-19).
- **Dokumen berubah sesi ini (6, semua docs):**
  - `docs/prd/CDPS_Module6A_Strategi.md` (D5/D18/OA-9/Rule 5).
  - `docs/prd/CDPS_Module6B_Plan.md` (P3).
  - `docs/DECISIONS.md` (+1 baris RAB-19).
  - `docs/prd/CDPS_Build_Plan.md` (Wave 2 bullet + exit criteria).
  - `docs/DATA_MODEL.md` (Brief `plan_row_id` + 4 tabel Riset Awal).
  - `docs/STATE_MACHINES.md` (§6f subseksi gerbang prasyarat).
- `CLAUDE.md` aturan rumah #1–#8.
