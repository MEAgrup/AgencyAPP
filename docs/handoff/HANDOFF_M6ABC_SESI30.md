# HANDOFF — Modul Interview ("Kelola Klien") Sesi 30 (titik mulai sesi berikutnya)

> Rantai: … → SESI27 (fondasi #136) → SESI28 (langkah 4–6, #137) → SESI29 (langkah 5/6 lanjut, #138) → **SESI30 (ini, terbaru — langkah 7, #139)**.
> Baca yang bernomor tertinggi lebih dulu; sesi sebelumnya hanya konteks sejarah.
>
> SESI30 menyelesaikan **langkah 7** (UI "Kelola Klien" + sidebar skoring live) dan
> **MERGE PR #139**. **Langkah 8 & 9 tersisa** — dispesifikasi di §2.

## 0. CARA MELANJUTKAN DI CHAT BARU — baca ini dulu

### 0.0 Posisi branch (persis, akhir sesi 30)

| Hal | Nilai |
|---|---|
| **Repo** | `MEAgrup/AgencyAPP` |
| **`main` HEAD** | `6d68cb9` — **Merge PR #139** (SESI30 / langkah 7). Sudah termuat semua: #136/#137/#138 + #139. |
| **Branch tugas sesi ini** | `claude/handoff-m6abc-sesi29-x3nf7q` — PR #139 **SUDAH MERGE**. |
| **Mulai kerja berikut** | PR #139 selesai. **Restart dari main terbaru:** `git fetch origin main && git checkout -B <branch-baru> origin/main`. JANGAN menumpuk di atas history yang sudah merge. |

### 0.1 Status modul Interview — **langkah 1–7 selesai, 2 langkah tersisa**

| # | Langkah | Status |
|---|---|---|
| 1–3 | Rekon / migrasi / core engine | ✅ #136 |
| 4 | `packages/db` executor | ✅ #137 |
| 5 | pg_cron reminder/SLA + eskalasi prasyarat N=2 | ✅ #137 + #138 |
| 6 | `apps/api` + paritas 7-role | ✅ #137 + #138 |
| 7 | **UI "Kelola Klien" + sidebar skoring live** | ✅ **#139 (SESI30)** |
| 8 | **Blok D prefill + flag verdict Strategi** | ⬜ **tugas utama berikutnya** |
| 9 | Seed fixture Alpha Digital + CI hijau | ⬜ |

### 0.2 Posisi persis (akhir sesi 30, setelah #139)

| | |
|---|---|
| Migrasi | **86 berkas** (tak berubah — langkah 7 FE-only) |
| Gate CI (ci.yml + db-rebuild.sh) | tabel **104** · mesin **19** · event **44** · prefix **32** (tak berubah) |
| Test | core **16** · db **25** · domain **24** · api **344** · **web-internal 227** (+36 sesi ini: interview-scoring 20 + interview-fields 16) — semua hijau (CI 11 job hijau) |
| Typecheck | `@cdps/core\|db\|domain\|api` + `web-internal` bersih. **`web-internal/tsconfig.json` target dinaikkan ES2017→ES2020** (literal BigInt di scorer) |
| `KNOWN_GAPS` (route-parity) | tetap **kosong**. UI kini memanggil 8 path interview — semua dilayani `apps/api`. route/body/shape-parity hijau |

### 0.3 DB lokal — WAJIB sebelum kerja DB/domain/api (langkah 8 menyentuh Strategi)

Sandbox PG16 (CI = PG17, otoritas). Bootstrap sama seperti SESI29 (§0.3 handoff itu):
initdb → pg_ctl port 5433 → `create database cdps` → apply 86 migrasi urut + seed 2× →
`npm install` (node_modules TIDAK persist antar sesi) → `DATABASE_URL=… npm test -w @cdps/{db,domain,api}`.
**web-internal terpisah** (bukan workspace root; `apps/*`+`packages/*` saja): `cd web-internal && npm install && npx vitest run && npx tsc --noEmit && npx eslint 'src/**/*.{ts,tsx}'`.

## 1. Apa yang dibangun sesi ini (#139) — FE-only, nol `apps/api`/migrasi

Detail penuh: `docs/DECISIONS.md` **2026-08-11** baris teratas (langkah 7).

- **`web-internal/src/lib/interview-scoring.ts` (+test)** — **PORT VERBATIM** scorer murni dari
  `packages/core/src/interview.ts` (`hitungKualifikasi`/`hitungVerdict`/`resolveMargin`/
  `hitungBepRoas` + enum/config/band). Ada karena `web-internal` tak punya dependensi
  `@cdps/core` dan `POST /score` mem-persist + nge-ping SPV (tak boleh per-ketuk).
  **Dijaga lock-step** oleh `interview-scoring.test.ts` (menyalin batas band + deal-breaker core).
- **`lib/interview-fields.ts` (+test)** — katalog Blok B (hanya field yang didefinisikan core:
  15 field skor + money/enum + B2-7a/b derivasi + prasyarat B7-9), label enum BI, konversi
  money minor↔rupiah (satu tempat), mapper `draft↔answers wire`, `draft→KualifikasiInput` +
  score wire, `previewKualifikasi` (cek kelengkapan).
- **`lib/interview.ts`** — DIPERLUAS: klien API (get/create/answers/score/verdict/prasyarat/
  jadwal/transition), `INTERVIEW_EDGES` cermin `sm_edges` + `availableTransitions`, label
  status/verdict/prasyarat/kualitas/hambatan, `CreateInterviewBody`/`JadwalWire` (named agar
  body-parity bisa baca key-nya).
- **`components/interview/{FieldInput,ScoringSidebar,PrasyaratPanel}.tsx`**.
- **`app/(shell)/account/interview/[id]/page.tsx`** — shell + tab, Blok A jadwal, Blok B
  progressive disclosure + autosave 20s (`PUT /answers`), sidebar skoring pinned, "Hitung &
  simpan skor" (`POST /score`), kontrol prasyarat, transisi lifecycle, print internal + print
  klien (prasyarat saja), notice `<1280px`.
- **`clients/[id]`** — entri "Buat & buka interview" (gate `canWriteInterview`).
- **`globals.css`** — gaya `@media print`. **`tsconfig` target ES2020**.

### Catatan mekanis / gotcha (BACA sebelum langkah 8)

1. **Skoring FE = PORT, jaga lock-step.** Kalau `packages/core/src/interview.ts` (band/config/
   verdict/margin) berubah, **`web-internal/src/lib/interview-scoring.ts` HARUS ikut** dan tes-nya
   menyalin kasus core. Ini kompromi yang disahkan pemilik (bukan reimplement diam-diam).
2. **Katalog Blok B sengaja SUBSET.** Hanya field yang core definisikan. Field deskriptif/prefill
   (mis. B2-1, B3-2, B1-8, …) BELUM ada di form — itu masuk ranah **langkah 8** (`PREFILL_MAPPING`).
   Jangan mengarang label field baru.
3. **Katalog Blok B9 config-driven + threshold config belum ada route** (`interview_kategori_blok`,
   `kualifikasi_config` default-deny). Kalau langkah lanjutan mau render B9 dinamis / ambang ke form,
   **butuh route baru `apps/api`** (service-role) dulu → lalu FE + route-parity.
4. **Durasi/flag prasyarat otoritatif ada di `interview_flag` — belum ter-ekspos route.** Panel
   sekarang cuma hint indikatif (`prasyarat_status` + `dihitung_pada`, ambang ≥7). Kalau butuh angka
   `hari_penyelesaian` / flag `prasyarat_bersyarat_terlambat` yang sebenarnya di UI, tambah route
   pembaca `interview_flag` (read-only) dulu.
5. **Belum ada route LIST interview per klien.** Entri klien = create-per-klik (konfirmasi). Kalau
   mau daftar interview per klien / cegah duplikat, itu route `apps/api` baru (langkah backend).
6. **Money = minor units** (rupiah×100); format `Rp. X.XXX.XXX,00`; div-by-zero → `—`.
   `web-internal` bukan workspace root — punya `package.json`/`node_modules`/`tsconfig` sendiri.

## 2. Tugas berikutnya (urut; tiap langkah PR kecil)

**Langkah 8 — Blok D prefill + flag verdict Strategi (BACKEND + sedikit FE).** Tambah kolom
prefill (`sumber`,`interview_id`,`interview_version`) ke tabel Strategi yang relevan + flag lemah
(`sasaran_konservatif`/`hambatan_mendasar_tercatat`/`risiko_tinggi`). Pakai `PREFILL_MAPPING` +
`handoffKeStrategi` dari **`packages/core`** (sudah ada). **Tes wajib:** (a) Section B numeric
baseline (`B-1…B-8`, `isStrategiBaselineForbidden`) **TAK PERNAH** di-prefill; (b) `tidak_siap`
**BISA** membuat Strategi & Strategi itu membawa flag. **TANPA gate verdict** (verdict advisory —
jangan menambah enum routing / jalur reject / kolom override). Migrasi baru (`CREATE OR REPLACE`,
hindari drift O38); naikkan gate hitungan tabel/kolom bila perlu (edit **ci.yml DAN db-rebuild.sh**,
gate kembar).

**Langkah 9 — seed fixture + CI hijau.** Perluas `supabase/seed.sql` (Alpha Digital) dengan 1
interview + kualifikasi (idempotent, seed 2×). Naikkan gate hitungan seed bila perlu. Semua CI hijau.

## 3. Sumber kebenaran
- `docs/DECISIONS.md` 2026-08-11 (semua baris Interview; teratas = langkah 7 sesi ini).
- `packages/core/src/interview.ts` = kontrak skoring (satu implementasi; FE port di
  `web-internal/src/lib/interview-scoring.ts` harus lock-step) · `PREFILL_MAPPING` +
  `handoffKeStrategi` = bahan langkah 8.
- `packages/domain/src/interview.ts` · `packages/db/src/interview.ts` · `apps/api/.../interview/**`.
- `web-internal/src/lib/interview*.ts` + `app/(shell)/account/interview/[id]/page.tsx` = UI langkah 7.
- `CLAUDE.md`, `docs/STATE_MACHINES.md`, `docs/DATA_MODEL.md`.
