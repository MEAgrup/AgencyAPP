# HANDOFF — Wave 2 Gap Audit (Kelas B selesai) + peta Kelas C & residual — Sesi 42

> Rantai: … → SESI40 (RAB-19/20, PR **#181 MERGE**) → SESI41 (Kelas A, PR **#182 MERGE**)
> → **SESI42 (ini, terbaru — Kelas B, PR #183 MERGE + resolusi konflik #182).**
> Baca yang bernomor tertinggi lebih dulu.
>
> **Status: Kelas A (#182) + Kelas B (#183) DUA-DUANYA MERGE ke `main` sesi ini. Konflik `kol.ts` sudah diselesaikan (simpan KEDUA: notif A2 + gate/tier B2). TIDAK ADA yang menggantung.**
> **Sisa Wave 2 = Kelas C (7 item) + residual B (3) — siap dibangun; lihat §2 (contoh kasus + rekomendasi) & §3.**

---

## 0. CARA MELANJUTKAN DI CHAT BARU — baca ini dulu

### 0.0 Posisi branch & PR
| Hal | Nilai |
|---|---|
| **Repo** | `MEAgrup/AgencyAPP` |
| **PR #183** | Wave 2 gap audit **Kelas B** (B1–B4). **MERGE ke `main`.** |
| **PR #182** | Wave 2 gap audit **Kelas A** (M6D freeze-on-close + M9 notif QC-fail/escalate). **MERGE ke `main`** (setelah `main` di-merge ke branch-nya & konflik `kol.ts`/`kol.test.ts`/`DECISIONS.md` diselesaikan). |
| **Branch berikutnya** | Restart dari `main` terbaru: `git fetch origin main && git checkout -B <branch-baru> origin/main`. **`main` kini punya A+B lengkap (117 migrasi).** |

> ✅ **KONFLIK #182 ↔ #183 SUDAH DISELESAIKAN (arsip — tak perlu aksi).** Keduanya mengedit `packages/domain/src/kol.ts` fungsi `escalate`. Resolusi: `escalate` sekarang **menyimpan KEDUA** perubahan — gate `canExecute` (B2, Coordinator boleh) + tulis baris audit `escalated` bertier SPV/Director (B2) **DAN** emit notifikasi `KOLQCFailedOrEscalated` ke KOL Lead via callback `after` (A2). `failQC` juga tetap emit (A2). `kol.test.ts` menyimpan keempat tes (2 escalate B2 + 1 drop-from-Content-In-Progress B1 + 1 notif A2); `DECISIONS.md` menyimpan kelima baris (Kelas A + B1–B4). Diverifikasi: **domain 1391 hijau (117 migrasi), api 351, web-internal 257, typecheck bersih.**

### 0.1 Aturan main (tak berubah)
- Migrasi HANYA lewat `supabase/migrations/**` + `apply_migration`. DB lokal HANYA lewat `scripts/db-rebuild.sh`.
- Tulis via service-role + gate domain; RLS row-scope. Wire snake_case lewat `apps/api/src/lib/wire.ts`.
- Rute = shell (`requireActor` → validasi → domain). `route-parity.test.ts` `KNOWN_GAPS` tetap kosong.
- Tes domain integration WAJIB serial (`npm run -w @cdps/domain test`, `fileParallelism:false`).
  **Rebuild DB sebelum run suite penuh & SETELAH menulis migrasi baru.**
- `backend/**` = oracle paritas read-only (jangan tambah fitur; job-nya harus tetap hijau).

### 0.2 Setup DB lokal (container baru)
```
sudo pg_ctlcluster 16 main start
sudo -u postgres psql -c "ALTER USER postgres PASSWORD 'postgres';"
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps" bash scripts/db-rebuild.sh --yes
npm install
cd web-internal && npm install
```
> Catatan container: postgres bisa mati sendiri antar-langkah; kalau `psql` connection refused, jalankan lagi `pg_ctlcluster 16 main start` + `ALTER USER`.

---

## 1. Yang SUDAH selesai sesi ini (PR #183, jangan ulang)

Audit paritas Kelas B — 4 gap yang butuh keputusan pemilik. Pemilik menjawab; tiap item punya entri
`docs/DECISIONS.md` 2026-08-18 (4 baris teratas). **Nol blocker keamanan/permission/immutability.**

| # | Modul | Fix | Berkas kunci |
|---|---|---|---|
| **B1** | M9 | Edge `[Content In Progress] → [Dropped]` (lead-gated) — kreator unresponsif pasca-terms tak lagi buntu. Blacklist ke Google Sheets manual (belum ada tabel; alasan tersimpan di `audit_log`). | migrasi `20260818020000`, `kol.ts` `drop()`, FE booking page, STATE_MACHINES §8, +1 tes |
| **B2** | M9 §10.1 | Coordinator boleh `escalate` (gate `canExecute`, edge lepas `require_lead`); tier eskalasi (`escalated_to` SPV/Director, M9-OA-6) dicatat `audit_log`. | migrasi `20260818030000`, `kol.ts` `escalate`/`canEscalate`, FE `canEscalateBooking`, STATE_MACHINES §8, +2 tes |
| **B3** | M12 | **Koreksi PRD**: `[Blocked]` masuk dari `[In Progress]` (Rules 2/7/8 + §7), bukan verdict reviewer dari `[In Review]`. Dokumen-saja. | `CDPS_Module12_Task_Execution.md` Flow 4/4b |
| **B4** | M8 §4 | Target KPI **GMV** < `gmv_baseline × 1.20` (20%/kuartal) diblok pesan BI `MSG_KPI_BELOW_STANDARD`; SPV Ads/AM/Director boleh sign-off. ROAS/Spend tak digerbang. Domain-saja. | `ads.ts` `hasKpiSignOff`/`gmvTargetBelowStandard`/`parseGmvTarget` + gate `createCampaign`, +5 tes |

**Verifikasi (DB fresh, serial):** domain **1389** hijau, api **351** hijau, web-internal **257** hijau; typecheck
core/domain/api/web-internal + lint FE bersih. DB dibangun dari **116 migrasi**, semua gate & invariant lolos.
`sm_edges` tidak dihitung gate; nol tabel/mesin/prefix/event baru.

> ℹ️ **Kelas A (#182)** semula belum ada di `main` saat Kelas B dibangun (SESI41 salah klaim merge). Kelas B
> dibangun di atas `main` NYATA, lalu **#182 di-merge belakangan** dengan resolusi konflik `kol.ts` (§0.0).
> `main` sekarang lengkap A+B.

---

## 2. BERIKUTNYA — Kelas C + residual B (butuh keputusan / desain lintas-modul)

> Pemilik minta: untuk tiap pertanyaan yang **belum dijawab**, sertakan **contoh kasus + rekomendasi**. Di bawah ini.

### 2.1 Tema besar: `clients.total_sales` adalah lubang bersama (C1/C2/C3/B4-residual)

Pemilik sudah memberi arah: **"GMV live autogenerate dari report yang di-upload ke sistem (fitur upload untuk
membuat report sekaligus regenerate semua reporting). Reporting dibuat SETELAH fitur management toko klien
selesai."** ⇒ **satu desain lintas-modul**, bukan tambal per-modul.

- **C1 (M10) — GMV live/KOL reconciled → sinyal GMV klien untuk Health Score (§6.2 #5, §5 Rule 1).**
  `clients.total_sales` **tak pernah ditulis apa pun** di seluruh proyek; jalur Ads yang mesti ditiru pun belum ada.
  - **Contoh kasus:** Sesi live-stream Alpha Digital rekonsiliasi GMV Rp 50.000.000. Angka itu hanya hidup di
    baris `live_stream_session`; `clients.total_sales` tetap 0 ⇒ sinyal tren-GMV Health Score BUTA ⇒ H-1 salah.
  - **Rekomendasi:** Bangun berurutan — **(1)** fitur *manajemen toko klien* (registry toko/platform per klien),
    **(2)** *upload report + engine regenerate* yang menulis `clients.total_sales` + tren GMV dari report ter-upload
    (tiru pola parse-export Riset Awal yang SUDAH ada: browser parse xlsx→AoA+sha256, server jalankan engine),
    **(3)** sambungkan Health Score membaca GMV hasil regenerate. **Engine reporting = SATU-SATUNYA penulis**
    `clients.total_sales`; GMV live/KOL/Ads jadi **input rekonsiliasi**, bukan penulis tandingan (kalau M10/M9/M8
    menulis langsung, lahir dua versi kebenaran — persis yang CLAUDE.md larang).

- **C2 (M9 §10.3) — Attributed GMV diketik manual, bukan dari affiliate-link tracking ("read-only, via trackable link, never estimated").**
  - **Contoh kasus:** Coordinator Putri mengetik "Attributed GMV = Rp 3.000.000" untuk sebuah Booking — itu
    *estimasi*, bertentangan dengan §10.3.
  - **Rekomendasi:** Satu keluarga dengan C1. Sampai pipeline tracking-link ada, tandai angka manual sebagai
    **provisional** dan rekonsiliasi ke report ter-upload. Fix penuh = ingest affiliate-link tracking (tiket C1/C3).

- **C3 (M7 §8 Rule 3) — review-and-lock bulanan Attributed GMV (provisional s.d. lock bulanan).**
  - **Contoh kasus:** Attributed GMV sebuah Asset menumpuk sepanjang bulan dari metric entries; di akhir bulan AM
    review & **lock** agar koreksi belakangan tak diam-diam menggeser angka bulan yang sudah tutup.
  - **Rekomendasi:** Bangun lock bulanan sebagai bagian cadence reporting (saat upload menutup bulan);
    `locked_at`/period-lock pada atribusi. Gabung ke C1.

**Rekomendasi urutan besar:** C1+C2+C3+B4-residual = **satu tiket desain lintas-modul** ("GMV → Health/attribution"),
dikerjakan **setelah** fitur manajemen toko klien. Jangan mulai sebelum registry toko ada.

### 2.2 C4 (M8) — eskalasi ROAS pasif → butuh event (katalog beku)
- **Contoh kasus:** ADC-… ber-ROAS 3.1x lalu 2.8x vs target 4x (dua periode di bawah). `escalationFlagged=true`
  muncul di read, tapi **tak ada notifikasi** ke AM/SPV Ads dan **tak ada baris log** eskalasi (oracle Go
  `ads.go:168-172` "emits NOTHING").
- **Rekomendasi:** Tambah **satu event notifikasi baru** (mis. `m8.ads.roas_underperforming`) → butuh **ACC pemilik
  membuka katalog** untuk event ini (katalog beku by-design). Emit saat transisi ke periode ke-2 berturut di bawah
  target (derived dari metric entries, idempoten), resolver ke owning AM + SPV Ads. Kecil & berdiri sendiri, TAPI
  butuh keputusan "boleh nambah event".

### 2.3 C5 & C7 — kecil, standalone, TANPA risiko invariant (pickup pertama yang bagus)
- **C5 (M7 §3 Rule 2 / §9.1) — antrean Asset pribadi per-PIC lintas Brief.**
  - **Contoh kasus:** Creative PIC Rian ingin "antrean saya" — semua Asset yang ditugaskan ke dia lintas
    klien/Brief, urut jatuh tempo. Sekarang tak ada read-nya; ia harus buka tiap Brief.
  - **Rekomendasi:** Tambah read `listMyAssets(actor)` + rute `GET /assets/mine` (atau `/creative/queue`) + panel FE.
    Nol migrasi, nol invariant baru. **Kerjakan mandiri.**
- **C7 (M6D) — field display RM-A5 (Service Aktif Minggu Ini) & RM-D4 (Keluhan Terkait) belum di `getRecapDetail`.**
  - **Contoh kasus:** Halaman detail rekap mingguan seharusnya menampilkan service aktif minggu ini (RM-A5) &
    keluhan terkait (RM-D4); read-model menghilangkannya ⇒ halaman tak bisa merender.
  - **Rekomendasi:** Tambah 2 field ke read-model `getRecapDetail` + wire + FE. Display-only, kecil. **Pair dengan C5.**

### 2.4 C6 (M9) — dua bagian kecil
- **(a) Flag sourcing-stall dini (§4 Rule 4):** Booking di `[Sourcing]` lewat separuh window Brief.
  - **Contoh kasus:** BKG-… duduk di `[Sourcing]` melewati separuh sisa waktu Brief — mesti flag Coordinator/Lead
    sebelum jadi telat. Sekarang tak ada tick/flag.
  - **Rekomendasi:** Flag derived saat read (umur booking vs window Brief), pola sama `escalationFlagged` Ads —
    tanpa notif (read-only), atau tick kalau mau push.
- **(b) Baris "total spend = Σ Agreed Rate" di laporan KOL bulanan (§9).**
  - **Contoh kasus:** Laporan Juni Putri harus menampilkan "total creator spend Rp 9.200.000" (Σ agreed rate).
    Komponen M14 ada; baris spend + surface standalone belum.
  - **Rekomendasi:** Tambah satu read; kecil. Pair dengan C5/C7.

### 2.5 Residual dari Kelas B (terbuka, kecil)
- **B1-residual — tabel blacklist kreator.** Sekarang manual ke Sheets. **Rekomendasi:** setelah pemilik
  konfirmasi bentuk registry, buat tabel `creator_blacklist` (handle/nama, alasan, ref booking di-drop, added_by/at)
  + peringatan saat create Booking ("kreator ini di-blacklist").
- **B2-residual — aksi SPV→Director eksplisit + notif.** Sekarang cukup tie-breaker M9-OA-6 + audit tier.
  **Rekomendasi:** hanya bila tie-breaker terbukti kurang; butuh event katalog (sama pertimbangan beku dg C4).
- **B4-residual — baseline pertumbuhan penuh (per-kuartal majemuk dari reporting hidup).** Sekarang floor statis
  `clients.gmv_baseline`. **Rekomendasi:** lipat ke desain C1/C3.

---

## 3. Sisa pekerjaan Wave 2 (peta lengkap)

Wave 2 = M6(+M6A–D), **M12 early**, M7, M8, M9, M10 — semua modul **sudah terbangun** via cutover; gap audit
menutup paritas PRD↔kode.

| Bucket | Status |
|---|---|
| **Kelas A** (A1 M6D freeze-on-close, A2 M9 QC-fail/escalate notif) | ✅ **PR #182 — MERGE** (konflik `kol.ts` diselesaikan, §0.0). |
| **Kelas B** (B1–B4) | ✅ **PR #183 — MERGE.** |
| **Kelas C1/C2/C3** (GMV→Health/attribution) | ❌ Satu tiket desain lintas-modul; **setelah** fitur manajemen toko klien + reporting. |
| **Kelas C4** (notif eskalasi ROAS) | ❌ Butuh ACC pemilik menambah event katalog. |
| **Kelas C5** (antrean Asset per-PIC) | ❌ Kecil, standalone — pickup pertama. |
| **Kelas C6** (sourcing-stall flag + baris spend KOL) | ❌ Kecil. |
| **Kelas C7** (RM-A5/RM-D4 di `getRecapDetail`) | ❌ Kecil, standalone — pair C5. |

**Exit Wave 2** (Build Plan §4): semua gap di atas tertutup / disepakati ditunda + kriteria exit Wave 2 lolos →
baru **Wave 3** (M2, M3, M11, M13, M14, M15 — Client Portal terakhir, pasca-spek keamanan).

**Rekomendasi urutan sesi berikutnya (A & B sudah beres — langsung build Kelas C):**
1. **C5 + C7** (kecil, berdiri sendiri, nol risiko invariant) sebagai quick win pembuka — §2.3.
2. **C4** bila pemilik setuju membuka satu event katalog notifikasi; **C6** menyusul (§2.2 & §2.4).
3. **C1+C2+C3+B4-residual** sebagai satu desain besar "GMV→Health/attribution" — mulai HANYA setelah fitur manajemen toko klien + reporting engine ada (pemilik yang menentukan kapan; §2.1).
4. **B1-residual / B2-residual** (§2.5) hanya bila dibutuhkan.

---

## 4. Jebakan yang MASIH relevan
1. Tes domain WAJIB serial; rebuild DB sebelum suite penuh & setelah migrasi baru.
2. web-internal app Next MANDIRI — `cd web-internal && npm install` terpisah; jangan salin `@cdps/core` ke browser.
3. **`main` kini lengkap A+B (117 migrasi).** `escalate` melakukan DUA hal (audit tier B2 + emit notif A2) via `edge(..., mutate, after)`; jangan buang salah satu saat menyentuh `kol.ts` lagi.
4. B4 `target_kpi` free-text: angka GMV dibaca whole-rupiah ('.'/','=grouping); error parse bias ke arah "minta ACC SPV" (aman).
5. `clients.total_sales` = penulis tunggal (engine reporting) — jangan tulis dari M8/M9/M10 langsung.
6. Jangan tulis `clients.total_sales`/atribusi tanpa jalur report — itu C1, bukan tambal.

## 5. Sumber kebenaran
- **Kode berubah sesi ini (#183):** `packages/domain/src/{kol,ads}.ts` (+ `.test.ts`),
  `supabase/migrations/20260818020000_m9_drop_from_content_in_progress.sql`,
  `supabase/migrations/20260818030000_m9_coordinator_escalate.sql`,
  `web-internal/src/lib/kol.ts` + `web-internal/src/app/(shell)/kol/bookings/[id]/page.tsx`,
  `docs/STATE_MACHINES.md` §8, `docs/prd/CDPS_Module12_Task_Execution.md` Flow.
- `docs/DECISIONS.md` 2026-08-18 (5 baris teratas: Kelas A + B1/B2/B3/B4).
- **Gap register terperinci Kelas B/C:** `docs/backlog/WAVE2_GAP_AUDIT.md` (kini di `main` via #182).
- `CLAUDE.md` aturan rumah #1–#8 + build order.
