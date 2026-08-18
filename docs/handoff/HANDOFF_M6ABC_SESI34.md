# HANDOFF — Riset Awal Baseline: **RAB-06 + RAB-07 selesai, lanjut RAB-08 (Wave B) + UI RAB-04 sisa** — Sesi 34

> Rantai: … → SESI31 (spek + 7 keputusan pemilik) → SESI32 (RAB-01 skema + RAB-02 mesin, PR #173)
> → SESI33 (RAB-03 kosakata + RAB-04 submit + RAB-05 auto-fill, PR #174)
> → **SESI34 (ini, terbaru — RAB-06 kunci skor server-authoritative + RAB-07 gerbang prasyarat).**
> Baca yang bernomor tertinggi lebih dulu; SESI31 tetap sumber SPEK & KEPUTUSAN (jangan tanya ulang).
>
> **Status: RAB-01…RAB-07 SELESAI, teruji.** Berikutnya **RAB-08** (dedup pertanyaan interview,
> awal Wave B) dan **UI RisetAwalPanel penuh** (sisa RAB-04 — data-layer siap, panel belum dirakit).

## 0. CARA MELANJUTKAN DI CHAT BARU — baca ini dulu

### 0.0 Posisi branch & PR

| Hal | Nilai |
|---|---|
| **Repo** | `MEAgrup/AgencyAPP` |
| **Branch sesi ini** | `claude/handoff-m6abc-sesi33-rch9k5` |
| **PR RAB-06/07** | **#175** (base `main`). |
| **RAB-03/04/05** | PR **#174** — sudah **MERGE** ke `main`. |
| **RAB-01/02** | PR **#173** — sudah **MERGE** ke `main`. |
| **Base saat kerja** | `main` (59364ad). Branch di-restart dari `main` karena #173 & #174 sudah merge. |

**Cek status merge dulu sebelum lanjut RAB-08:**
- **Kalau PR RAB-06/07 SUDAH merge ke `main`:** restart branch baru dari main —
  `git fetch origin main && git checkout -B <branch-baru> origin/main`, kerjakan RAB-08 → PR baru.
- **Kalau belum:** lanjut di branch sesi ini di atas commit RAB-06/07, atau branch baru dari situ.

### 0.1 Aturan main yang MASIH berlaku (SESI31 §0.2 — jangan dilanggar)
- **PRD boleh dikoreksi** di 5 titik Wave E (RAB-19) lewat `DECISIONS.md`.
- Migrasi HANYA lewat `supabase/migrations/**` + `apply_migration`. DB lokal HANYA lewat `scripts/db-rebuild.sh`.
- Tulis via service-role + gate domain; RLS memikul row-scope. Wire snake_case lewat `apps/api/src/lib/wire.ts`.
- **Mesin baseline jalan di SERVER, bukan browser** (SESI33 §1.4 — jangan impor `@cdps/core` ke `web-internal`).

### 0.2 Setup DB lokal + install deps (kalau container baru)
```
pg_ctlcluster 16 main start
sudo -u postgres psql -c "ALTER USER postgres PASSWORD 'postgres';"
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps" bash scripts/db-rebuild.sh --yes
npm install                       # node_modules TIDAK ikut clone — wajib install
```
⚠️ **Tes domain integration WAJIB serial** — jalankan lewat `npm run -w @cdps/domain test`
(config paket `fileParallelism:false`). `npx vitest run` dari ROOT **mengabaikan** config itu
→ file dijalankan paralel → `interview.test.ts` & `riset-awal.integration.test.ts` berbagi
`CLI-ZZI-0001` dan saling mengotori platform ⇒ failure PALSU (dialami & dikonfirmasi sesi ini).

---

## 1. Yang SUDAH selesai sesi ini (jangan ulang)

### 1.1 RAB-06 — kunci skor riset awal jadi otoritatif server (tes TERPENTING backlog)
- **`scoreInterview`** (`packages/domain/src/interview.ts`) sekarang memanggil
  **`mergeRisetAwalScoredInputs(tx, id, input)`** sebelum `persistKualifikasi`.
- Konstanta baru **`RISET_AWAL_SCORED_KEYS = ['B2-9','B2-3']`** = satu-satunya daftar kunci riset
  awal yang masuk kualifikasi (B2-9 AOV→`aov` money, B2-3 SKU→`skuSiap` count).
- Logika: kalau ada `interview_riset_awal_isian` **`dikonfirmasi=true`** untuk kunci itu, nilainya
  meng-override `input`; nilai kunci sama di **body** `/score` **diabaikan**. Tak ada isian
  terkonfirmasi ⇒ body dipakai apa adanya ⇒ **interview tanpa riset awal skornya IDENTIK**.
- **Rute `POST …/score` TIDAK berubah** — merge di lapisan domain (tempat penegakan aturan). Body
  tetap lewat `interviewScoreFromWire`, lalu domain menimpanya.
- ⛔ **`SCORED_FIELD_KEYS` & `hitungKualifikasi` NOL perubahan** (jebakan §4 no.3).
- Tes (`interview.test.ts` blok "RAB-06"): isian terkonfirmasi kuat + body lemah ⇒ skor = seakan
  body kuat (`I1==I2`) & ≠ body lemah (`I1≠I3`); usulan **belum** dikonfirmasi tak pernah
  meng-override (`I4==I5`, sekaligus jaminan fixture tak berubah). Helper `baseScoreInput`.

### 1.2 RAB-07 — gerbang prasyarat (Interview butuh riset awal submit)
- **`assertRisetAwalGate(sql, id, clientId)`** (`interview.ts`), dipanggil di:
  - `scheduleInterview` sebelum transisi `BelumDijadwalkan/DijadwalkanUlang → Terjadwal`;
  - `transitionInterview` saat `to === SedangBerlangsung` (start langsung maupun setelah jadwal).
- Gerbang lolos hanya bila **KETIGA**: (1) `interview_riset_awal.status = Selesai` (submit),
  (2) **setiap** `client_platforms` aktif klien punya baris `riset_awal_analisa` (analisa **atau**
  manual), (3) semua isian auto-fill terkonfirmasi (`semua_terkonfirmasi`). Gagal ⇒ `ValidationError`
  **`MSG_RISET_AWAL_BELUM_LENGKAP`** (BI `[...]`).
- **Anti-deadlock Shopee-only** (Shopee 156× vs TikTok 16× di seed): definisi per-platform + manual
  membuat klien Shopee-only bisa lolos tanpa analisa TikTok. Tes membuktikan: start & schedule
  ditolak sebelum riset awal; baseline+konfirmasi **tanpa submit** masih ditolak; submit ⇒ lolos.
- Gerbang **tidak** dipasang di `runTransition` generik (biar `Dibatalkan`/reviewer edge tak
  ikut terblok) dan **tidak** menggembok `submitRisetAwal` (punya tes durasi sendiri).
- Tes lama yang memulai interview kini menyiapkan riset awal via helper baru
  **`completeRisetAwal`** / **`seedManualBaseline`** di `interview.test.ts`.

### 1.3 Verifikasi yang dijalankan
- core **248** hijau; **domain suite penuh 1355 hijau** (serial, `npm run -w @cdps/domain test`);
  api **345** hijau (route-parity `KNOWN_GAPS` **kosong** + shape-parity).
- typecheck core/db/domain/api bersih. `web-internal` **tak disentuh** sesi ini (app Next mandiri,
  bukan npm workspace — butuh install terpisah; status typecheck-nya sama dengan baseline SESI33).
- **NOL tabel/migrasi/mesin/prefix/event baru** ⇒ gate 118/35/23/57 TETAP.

---

## 2. BERIKUTNYA — RAB-08 dan seterusnya (`RISET_AWAL_BASELINE_BACKLOG.md`)

### RAB-04 SISA (UI) — belum dirakit (bisa dikerjakan kapan saja, prasyarat sudah lengkap)
Data-layer FE (`web-internal/src/lib/riset-awal.ts`) + adapter xlsx **siap**, tapi
**`RisetAwalPanel.tsx` penuh belum dibangun**: sub-bagian per `client_platforms` aktif, unggah +
`detect().ambiguous`→konfirmasi toko/afiliasi, grid konfirmasi per-angka, entri manual minimal,
tombol submit yang butuh `semua_terkonfirmasi`. Panel sekarang masih hanya paruh pengukuran M6A
(timer). Sekarang **gerbang RAB-07 sudah aktif**, jadi UI harus menuntun AM menuntaskan riset awal
(baseline tiap platform + konfirmasi + submit) sebelum tombol "Jadwalkan/Mulai Interview" hidup.

### RAB-08 · Dedup pertanyaan (awal Wave B)
Pintu Interview membaca `clients` + `qualified_forms` + isian riset awal; sembunyikan/tandai
pertanyaan yang sudah terjawab, **dengan tombol "berbeda dari data"**. Hilangkan pengetikan ulang,
**jangan** hilangkan kemampuan mengoreksi.

### RAB-09 · Hidupkan `PREFILL_MAPPING` + `handoffKeStrategi`
Sudah ditulis & diuji (`packages/core/src/interview.ts:1058`) tapi **nol pemanggil produksi**.
Sambungkan ke jalur Interview→Strategi. **Jangan tulis ulang.**

### RAB-10 · Enam seksi belum dibangun
B0, B5, B8–B11 (`interview-fields.ts`) diselesaikan **atau** dinyatakan sengaja keluar cakupan di
PRD Interview yang baru. Jangan menggantung tanpa status.

**Wave C–E** (RAB-11…RAB-20) tak berubah — lihat backlog + SESI31/32/33.

---

## 3. Jebakan yang MASIH relevan
1. **Tes domain integration WAJIB serial** — `npm run -w @cdps/domain test`, JANGAN `npx vitest run`
   dari root. Paralel ⇒ `CLI-ZZI-0001` diperebutkan dua file ⇒ failure palsu (§0.2).
2. **`SCORED_FIELD_KEYS` & `hitungKualifikasi` nol perubahan**; kunci skor riset awal hanya
   **B2-9/B2-3** (`RISET_AWAL_SCORED_KEYS`). Hanya isian **`dikonfirmasi`** yang meng-override body.
3. **Gerbang RAB-07 = status Selesai + per-platform baseline + semua_terkonfirmasi.** Kalau nanti
   menambah platform aktif ke klien setelah interview mulai, gerbang start tak menghitung ulang —
   pertimbangkan saat merancang UI penambahan platform.
4. `median_6m`≠`B1-5` (§5.2); `B3-3`/`B7-3` tetap pertanyaan interview (penilaian manusia).
5. Mesin baseline di server, bukan browser (SESI33 §1.4) — jangan impor `@cdps/core` ke `web-internal`.
6. Jangan matikan `STR-` sebelum UI pindah; `KNOWN_GAPS` route-parity tetap **kosong**.
7. Migrasi hanya lewat `supabase/migrations/**`; kalau nambah tabel, naikkan gate di DUA tempat.
8. `node_modules` tidak ikut clone container — `npm install` dulu sebelum tes/typecheck.

---

## 4. Sumber kebenaran
- **Backlog:** `docs/backlog/RISET_AWAL_BASELINE_BACKLOG.md` · **Spek/keputusan:**
  `HANDOFF_M6ABC_SESI31.md` (+ SESI32/SESI33).
- `docs/DECISIONS.md` 2026-08-18 (RAB-06/07 di baris teratas; RAB-03/04/05 + klarifikasi
  mesin-di-server; RAB §5) & 2026-08-17 (7 keputusan pemilik).
- **Kode berubah sesi ini:** `packages/domain/src/interview.ts`
  (`RISET_AWAL_SCORED_KEYS`, `mergeRisetAwalScoredInputs`, `assertRisetAwalGate`,
  `MSG_RISET_AWAL_BELUM_LENGKAP`, gerbang di `scheduleInterview`/`transitionInterview`) ·
  `packages/domain/src/interview.test.ts` (helper `seedManualBaseline`/`completeRisetAwal`;
  blok tes "RAB-06" & "RAB-07"; tes start lama diperbarui menyertakan riset awal).
- **Arsip tool (rujukan port satu arah):** `docs/design/BASELINE_TOOL_TIKTOK_v1.html` — jangan pelihara paralel.
- `CLAUDE.md` aturan rumah #1–#8.
