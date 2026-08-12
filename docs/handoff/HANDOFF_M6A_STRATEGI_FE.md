# HANDOFF — Frontend Strategi (M6A) + wiring Blok D handoff

> Untuk sesi FE berikutnya. Ditulis akhir SESI30 (langkah 8+9 Interview merged/di-PR #141).
> Backend Strategi + handoff Interview→Strategi **sudah lengkap**; yang belum ada
> adalah **UI Strategi** di `web-internal`. Dokumen ini memetakan apa yang siap
> dipakai FE dan di mana persisnya menyambungkannya.

## 0. Mulai di chat baru

| Hal | Nilai |
|---|---|
| **Repo** | `MEAgrup/AgencyAPP` · FE app = **`web-internal/`** (repo root, BUKAN `apps/`) |
| **Base** | `git fetch origin main && git checkout -B <branch-fe-baru> origin/main` (setelah #141 merge). Kalau #141 belum merge & butuh backend-nya: base dari `claude/strategi-prefill-fixture-oo5ck3`. |
| **⚠️ Next.js** | `web-internal/AGENTS.md`: "This is NOT the Next.js you know" — baca `node_modules/next/dist/docs/` sebelum menulis kode; API/konvensi mungkin beda dari ingatan. |
| **Setup** | `cd web-internal && npm install`. Test: `npm test`. Typecheck: `npm run typecheck`. Build: `npm run build`. |
| **Skoring live** | Scorer FE `web-internal/src/lib/interview-scoring.ts` = **port verbatim** core `hitungKualifikasi`; jaga lock-step (jangan menyimpang). |

## 1. Peta FE saat ini (yang SUDAH ada)

- **Interview "Kelola Klien"** (langkah 7, #139) — SUDAH ada: form Section B0–B11,
  progressive disclosure, autosave 20s, sidebar skoring live, kontrol prasyarat.
  Cari halaman/komponennya di `web-internal/src/app/**` (rute klien) + lib
  `interview.ts` / `interview-fields.ts` / `interview-scoring.ts`.
- **Tipe FE Strategi** `web-internal/src/lib/strategi.ts` — SUDAH ada & terdaftar
  shape-parity (`StrategiWire` ↔ `strategi.ts::Strategi`). **Kolom Blok D baru
  sudah ada di tipe ini** (`sumber`, `interview_id`, `interview_version`,
  `blok_d_flags: string[]`). Juga ada helper `strategi-sections.ts`,
  `strategi-revisi.ts`.
- **BELUM ada:** halaman/form Strategi (Section A–J) di `web-internal`. Tidak ada
  komponen yang memanggil endpoint `strategi` mana pun (route-parity `KNOWN_GAPS`
  kosong justru karena belum ada panggilan). Ini pekerjaan FE besar M6A (backlog
  A-05…A-09) dan ADALAH tugas utama sesi FE berikutnya kalau memang mau bikin form-nya.

## 2. Yang langkah 8 SIAPKAN untuk FE (hook Blok D)

Backend sudah menyediakan tiga hal; FE tinggal memakainya saat form Strategi lahir:

### (a) Membuka Strategi DARI Interview — kirim `interview_id`
`POST /api/v1/services/{id}/strategi` sekarang menerima field opsional
`interview_id` di body (di samping `durasi_kontrak_bulan`, `tanggal_mulai_kontrak`,
`tanggal_akhir_kontrak`, `tanggal_mulai_siklus`, `toleransi_over_persen`).
- Bila diisi → baris Strategi di-stamp `sumber='interview'`, `interview_id`,
  `interview_version`, dan `blok_d_flags` dari verdict (advisory).
- **Tanpa gate verdict:** `tidak_siap` pun boleh — tombol "Buka Strategi" TIDAK
  perlu di-disable berdasarkan verdict.
- Guard server: Interview wajib ada & milik klien Service yang sama
  (`[Interview tidak ditemukan]` / `[Interview ini bukan milik klien layanan ini]`).
- Respons `GET/POST` Strategi kini memuat `sumber`/`interview_id`/`interview_version`/
  `blok_d_flags` (lihat `StrategiWire`).

### (b) Pra-isi Section A dari jawaban Interview — `buildStrategiPrefill`
Fungsi murni **core** `interview.buildStrategiPrefill(answers)` (di `@cdps/core`,
`packages/core/src/interview.ts`) mengembalikan `{ interviewField, strategiField,
value, catatan? }[]`:
- Input = jawaban Interview (`{ fieldKey, value }[]`) — FE sudah memuat jawaban di
  halaman Kelola Klien.
- Output = nilai untuk field Section A Strategi (`A-1`…`A-16`, plus `C-7`/`E-4`),
  **sudah difilter** supaya baseline numerik Section B (`B-1`…`B-8`) tak pernah
  ikut. Jawaban kosong dilewati (tak ada prefill string-kosong).
- **Cara pakai di form:** saat form Strategi dibuka dari sebuah Interview, panggil
  `buildStrategiPrefill(answers)` lalu petakan `strategiField` → input form Section A
  untuk **pra-isi (AM meninjau, autosave)**. Jangan reimplement PREFILL_MAPPING di
  FE — panggil fungsi core ini (mirip pola `interview-scoring.ts`). Catatan: beberapa
  `strategiField` bisa datang dari >1 sumber (mis. `A-10` ← `B1-9`+`B10-1`,
  `A-11` ← `B8-1`…`B8-6`) — form yang memutuskan cara menggabungkan (mis. concat).
- **Field enum/child sengaja TIDAK di-terjemahkan** kosakatanya (A-2 model bisnis,
  A-4 posisi harga, A-11 pantangan, dst.) — kosakata Interview↔Strategi tidak
  PRD-spesifik 1:1. `buildStrategiPrefill` tetap mengembalikan nilai mentahnya; form
  boleh menyajikannya sebagai **saran** (bukan auto-commit ke enum) supaya AM memilih.

### (c) Menampilkan provenance + flag lemah
`blok_d_flags` (subset `sasaran_konservatif` / `hambatan_mendasar_tercatat` /
`risiko_tinggi`) + `sumber='interview'` + `interview_id` sudah di respons Strategi.
Saat panel/header Strategi dibangun, tampilkan sebagai **badge advisory** (mis.
"Diturunkan dari Interview · sasaran konservatif") — tidak memblok apa pun.

## 3. Rekomendasi urutan kerja FE (kalau membangun form Strategi)

Ini pekerjaan besar; potong kecil (PR per Section cluster), rujuk PRD
`docs/prd/CDPS_Module6A_Strategi.md`. Urutan yang selaras backend:
1. **Kerangka halaman + header (Section J-1) + create** — daftar versi
   (`GET /services/{id}/strategi`), tombol create (`POST …/strategi`) yang **boleh
   menyertakan `interview_id`** bila datang dari Kelola Klien. Tampilkan badge Blok D (§2c).
2. **Section A (Konteks)** dengan **pra-isi `buildStrategiPrefill`** (§2b) — ini
   momen di mana handoff langkah 8 benar-benar terpakai user.
3. Section B (channel + baseline), C (diagnosa), D (target/asumsi), E–I, J (read-only
   diff) — ikuti tabel field PRD + `strategi-sections.ts`.
4. **Route-parity:** setiap path `strategi` yang dipanggil web-internal WAJIB dilayani
   `apps/api` (sudah lengkap). `KNOWN_GAPS` di `apps/api/src/lib/route-parity.test.ts`
   **wajib tetap kosong**.

## 4. Alternatif ringan (kalau BELUM mau bikin form penuh)
Kalau sesi FE berikutnya kecil: tambahkan di halaman **Kelola Klien** sebuah tombol
"Buka Strategi" yang memanggil `POST /services/{id}/strategi` dengan `interview_id`
(butuh service_id klien) + toast hasil. Ini mengaktifkan jalur handoff end-to-end
tanpa membangun seluruh form — dan `route-parity` tetap hijau (path sudah dilayani).
Catatan: `interview_id` FE→API baru benar-benar terpakai begitu ini ada.

## 5. Gotcha
- **FE app di `web-internal/`**, bukan `apps/`. Workspace globs `apps/*`+`packages/*`
  TIDAK memasukkannya — typecheck/test/build web-internal dijalankan terpisah
  (`cd web-internal && npm run …`).
- **Shape-parity:** kalau menambah field ke tipe FE `strategi.ts`, pasangannya di
  `StrategiWire` (`apps/api/src/lib/wire.ts`) harus cocok (test `shape-parity.test.ts`).
- **Money** = minor units; format `Rp. X.XXX.XXX,00`; div-by-zero → `—`.
- **Skoring** jangan diduplikasi — core adalah sumber; FE port-verbatim yang sudah ada.

## 6. Sumber kebenaran
- `docs/handoff/HANDOFF_M6ABC_SESI30.md` — status backend langkah 8+9 (baca ini juga).
- PR #141 — perubahan langkah 8+9.
- `packages/core/src/interview.ts` — `buildStrategiPrefill`, `PREFILL_MAPPING`,
  `handoffKeStrategi`, `STRATEGI_FLAG`, `isStrategiBaselineForbidden`.
- `web-internal/src/lib/strategi.ts` — tipe FE (kolom Blok D sudah ada).
- `apps/api/src/lib/wire.ts` — `strategiHeaderFromWire` (`interview_id`), `strategiToWire`.
- `docs/prd/CDPS_Module6A_Strategi.md` — spec form Section A–J.
- `CLAUDE.md`, `web-internal/AGENTS.md`.
