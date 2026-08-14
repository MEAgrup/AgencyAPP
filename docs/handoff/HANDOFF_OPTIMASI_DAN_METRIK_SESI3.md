# Handoff — Metrik Terbuka T-1…T-4 SELESAI (SESI 3) + task berikutnya

**Tanggal:** 2026-08-14 · **PR:** #163 (`claude/handoff-optimasi-metrik-tk5yd0`)
**Pendahulu:** `HANDOFF_OPTIMASI_DAN_METRIK_SESI1.md` (rencana) + `SESI2.md` (P-1 mendarat).
Baca ini paling akhir — ia menutup T-1…T-4.

> **Ringkas:** Keempat task terbuka SESI1/2 (T-1…T-4) **SELESAI & sudah di PR #163**,
> termasuk putaran lanjutan yang ditandatangani pemilik (T-2 dua-langkah + notif,
> T-4b CPL, T-4c milestones). P-1 (kecepatan) sudah mendarat di PR #161. Semua
> keputusan pemilik tercatat di `docs/DECISIONS.md` (blok Decided 2026-08-14).

---

## 0. MULAI DARI SINI

1. PR #163 memuat 6 commit fitur (T-2, T-3, T-4a, T-4b, T-4c, T-2b/T-2c) di atas
   P-1. Kalau belum di-merge, verifikasi CI hijau lalu merge.
2. Task berikutnya yang **nyata dan sudah tidak terblokir** ada di §3 — prioritas
   #1 adalah **D-14 (komponen Disiplin Rekap M14)**: bobotnya sudah ditandatangani
   pemilik 2026-08-13 tapi **skoringnya belum dibangun**.
3. Sisa "tuas kecepatan" P-1 (§4 SESI2) masih terbuka dan **owner-gated** — jangan
   mulai tanpa diminta.

---

## 1. Yang MENDARAT di PR #163 (T-1…T-4)

| Task | Ringkas | Migrasi |
|---|---|---|
| **T-1 (O9)** | Target normalisasi M14 **per-individu staff** — `perf_period_targets.staff_id` (sentinel `'*'` = role default), resolver staff-exact→role-default. UI config "Tambah Target Per-Staff". | `20260814020000` |
| **T-2 (RM-2)** | Hold Service + klien all-hold **tetap di Health report** (flag `onHold`); all-hold di-exclude dari rekap D-06. | `20260814030000` |
| **T-2b/T-2c** | Hold jadi **dua-langkah** (AM ajukan → Head ACC/tolak → resume) + **notif v8** (4 event). Edge langsung `[In Execution]→[On Hold]` dicabut. | `20260814080000` |
| **T-3 (M8)** | `metric_entries` + `clicks/impressions/conversions` (input platform); `wrr_aggregate` isi blended **CTR/CVR/CPC/CPM**, `—` saat penyebut 0. | `20260814040000` |
| **T-4a** | **View Organik** manual (input platform) terpisah dari paid `total_view` + summary "Total View (Blended)". | `20260814050000` |
| **T-4b** | **CPL blended** = Σspend ÷ Σconversions. | `20260814060000` |
| **T-4c** | **Upcoming Milestones terstruktur** — entitas `client_milestones` (prefix `MLS-`, mesin `client_milestone`), kelola di halaman klien + blok read-only di rekap. | `20260814070000` |

Keputusan pemilik + sub-keputusan lengkap: `docs/DECISIONS.md` blok **2026-08-14**.

## 2. Verifikasi (state PR #163)
- `packages/core` **221** · `packages/db` **48** · `packages/domain` **1264** (1 skip) · `apps/api` **345** · `web-internal` **238** — semua hijau.
- `scripts/db-rebuild.sh` hijau: **108 migrasi**, gate `tabel 113 / entity_prefix 34 / sm_machines 22 / notif_events 52`, 4 invariant SQL lolos.
- typecheck + eslint bersih (core/db/domain/api/web-internal). Parity route/shape/body hijau; `KNOWN_GAPS` **kosong**.
- Nol perubahan skor M13/M14: CTR/CVR/CPC/CPM/CPL/view organik = display, bukan komponen skor.

---

## 3. TASK BERIKUTNYA (prioritas)

### #1 — D-14: komponen "Disiplin Rekap Mingguan" di M14 *(sudah tidak terblokir)*
Bobot **ditandatangani pemilik 2026-08-13** (`DECISIONS.md`; M6D_BACKLOG §D-14 / M14 §9)
tapi **skoringnya belum ada di `performance.ts`**. Yang harus dibangun:
- Profil **AM** re-weight 50/25/25 → **45/22.5/22.5/10**: 10% baru = komponen
  *Disiplin Rekap* = % klien aktif AM yang rekap minggu-berjalannya **ditutup AM tepat
  waktu** (bukan `Ditutup Otomatis`). Sinyal mentah sudah ada di M6D
  (`weekly_result_recap.status` + `pernah_ditutup_otomatis`).
- Profil **divisi** (Creative/Ads/KOL) carve **5%** = komponen *Kepatuhan Catatan*
  = divisi mengisi `wrr_catatan_divisi` saat rekap tutup. Bobot final di M14 §9.
- **Definisi "klien aktif" HARUS memakai** filter yang sama dengan D-06 (kini
  meng-exclude `[On Hold]`, lihat `wrr_monday_job`) — supaya klien all-hold tak
  masuk denominator disiplin (RM-2). Ini yang saya catat saat T-2.
- DoD: recompute-from-log, tes per-role, nol placeholder di seed.

### #2 — Konfirmasi interpretasi yang masih "default Claude Code" (butuh tanda tangan)
Tercatat di `DECISIONS.md` 2026-08-14, aman dipakai tapi belum ditandatangani:
- **T-4b CPL sumber = `conversions`** (leads M1 tak aplikabel di level rekap performa
  klien). Kalau pemilik mau CPL dari lead-gen channel spesifik → butuh proyek
  atribusi lead↔klien↔periode tersendiri.
- **T-4a view organik = input manual** (bukan tabel `organic_metrics` auto). Kalau
  perlu split-by-source organik → follow-up.

### #3 — Sisa tuas kecepatan P-1 *(owner-gated — JANGAN mulai tanpa diminta)*
Dari `SESI2.md §4`, belum dikerjakan **sengaja**:
1. 🟡 Rewrite hop proxy `web-internal → apps/api` — **ukur dulu**; JANGAN jalan naif
   (`SameSite=None` buang proteksi CSRF). Butuh keputusan domain/CORS + `DECISIONS`.
2. 🟡 ±40 refresh pasca-mutasi berurutan di FE (`await load(); await loadMetrics()`).
3. 🟡 `runSnapshotJob` (M13/M14) satu transaksi per klien — batch `computeFor`, jangan longgarkan lock.
4. 🟢 N+1 jalur TULIS (`plan.ts`/`strategi.ts`/`sales.ts`/`employees.ts`).
5. p95 produksi **diukur pemilik sendiri** — jangan pasang instrumentasi tanpa diminta.

### #4 — Poles kecil (opsional)
- Milestone **edit** (judul/tanggal) — sekarang hanya create + transition (done/cancel).
- Recap page: blok "Upcoming Milestones" read-only sudah ada; bisa ditambah target-date
  highlight bila lewat jatuh tempo.

---

## 4. Ranjau repo (tetap berlaku)
- Migrasi HANYA `supabase/migrations/**` + `apply_migration` (O38); rebuild DB HANYA
  `scripts/db-rebuild.sh`. **Menambah tabel/prefix/mesin/notif = naikkan gate di
  DUA berkas** (`.github/workflows/ci.yml` + `scripts/db-rebuild.sh`) di commit yang
  sama — plus `PREFIXES` (`ident.ts`) untuk prefix baru & `CATALOG`/`CATALOG_VERSIONS`
  (`notification.ts`) untuk event notif baru.
- Wire snake_case `null` eksplisit (O43); `KNOWN_GAPS` route-parity **kosong**; setiap
  wire interface baru didaftarkan ke `shape-parity.test.ts` (WIRE_TO_FE + FE_FILES).
- Penegakan aturan di DB (sm_transition + RLS + trigger), TS = pembungkus. Status
  entitas **hanya** via `sm_transition`.
- RLS helper kepemilikan klien: pakai **`private.jwt_owns_client(client_id)`**
  (bukan `public.` — hanya versi private yang tersisa). `jwt_can_read_all()` /
  `jwt_is_lead()` / `jwt_division()` tetap `public.`.
- `backend/**` read-only (Go+MySQL pensiun) — job `backend` di CI cuma dijaga hijau.
- Test DB-backed: rebuild dulu sebelum menyimpulkan (beberapa test meng-assert
  hitungan absolut audit/notif; akumulasi antar-run bikin merah palsu).

## 5. Sumber kebenaran
- T-1: `performance.ts::{targetsForRole,setTarget}` + `perf_period_targets`.
- T-2/T-2b: `client.ts::{requestHold,approveHold,rejectHold,resumeService}`, `docs/STATE_MACHINES.md §6`, `wrr_monday_job` (D-06), `health.ts::portfolio`.
- T-2c: `packages/core/src/notification.ts` (CATALOG v8) + `20260814080000`.
- T-3/T-4b: `wrr_aggregate` (`20260814040000` → `20260814060000`), `ads.ts::logMetricEntry`.
- T-4a: `recap.ts` (MANUAL_ELIGIBLE_METRICS + `view_organik`), FE recap page.
- T-4c: `milestone.ts`, `docs/STATE_MACHINES.md §16`, `docs/DATA_MODEL.md` (MLS).
