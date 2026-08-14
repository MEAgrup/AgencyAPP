# Handoff — Optimasi Kecepatan + Penyelesaian Metrik Terbuka (SESI 1 / rencana)

**Tanggal:** 2026-08-14 · **Branch kerja saran:** buat branch baru per task (jangan tumpuk).

> Ditulis atas permintaan pemilik (management@smarketing.id) sesudah M6D D-14 mendarat.
> **Urutan WAJIB:** **P-1 optimasi kecepatan DULU**, baru T-1 → T-2 → T-3 → T-4.
> Tiap task = satu (atau beberapa) PR kecil. Konfirmasi "KEPUTUSAN PEMILIK" di tiap task
> **sebelum** koding bagian yang bergantung padanya — jangan pilih diam (CLAUDE.md).

---

## 0. Ringkasan tafsiran pemilik (dikonfirmasi 2026-08-14)

1. **O9** — target bulanan diisi lewat **dashboard CDPS** per team. ✅ (nuansa: per role-type, lihat T-1).
2. **RM-2** — tombol **Hold Service** oleh AM, perlu **ACC Head of Account**. ✅ (hold per-service, lihat T-2).
3. **RM-3/RM-C** — perbaikan di **M8** (tambah clicks/impressions). ✅ (lihat T-3).
4. **View organik** — **dimodelkan** supaya semua bisa dihitung. ✅ (paling besar, lihat T-4).
5. **BARU** — loading CDPS lambat walau data sedikit → **P-1** (akar: N+1 query, bukan volume).

---

## P-1 — OPTIMASI KECEPATAN LOADING *(dikerjakan PERTAMA)*

### Akar masalah (sudah didiagnosis, bukan tebakan)
Lambat walau data sedikit = **latency-bound, bukan volume-bound**. Lapisan domain penuh loop
**N+1**: tiap baris memicu satu round-trip terpisah ke Supabase pooler. Contoh terverifikasi di
`packages/domain/src/performance.ts`:
- `amCandidates` → loop tiap klien, query CHR snapshot per-klien.
- `amResolutionHours` → loop tiap komplain, `transitionsFor` (query `audit_log`) per-komplain.
- `amRevisionEscalation` → loop klien → query assets per-klien → `assetMetrics` per-asset
  (→ `transitionsFor` per-asset). Kompleksitas **O(klien × asset × transisi) round-trip**.
- `creativeCandidates` / `kolCandidates` → `transitionsFor` per-asset / per-booking.
- `health.ts::portfolio` (D-12) → fan-out per-klien ke snapshots/complaints/recaps.
- Pola `for (… of …) { await sql`…` }` tersebar di banyak modul domain.

Koneksi sendiri sudah benar: `apps/api/src/lib/db.ts::db()` = singleton, `prepare:false` (pooler-safe).
Jadi **fokus = kurangi jumlah round-trip**, bukan ganti driver.

### Langkah
1. **UKUR dulu (jangan tebak).** Pilih 3 endpoint terlambat (kandidat: `GET /health/portfolio`,
   snapshot scan M14 `runSnapshotJob`, `GET /rekap/[id]`). Tambah timing log sementara +
   hitung jumlah query per request (postgres.js `debug` hook / Supabase `query_logs`).
   Jalankan `EXPLAIN ANALYZE` pada query terpanas. **Catat baseline round-trip + p95** sebelum ubah.
2. **Eliminasi N+1 → query set-based.**
   - Ganti loop per-baris jadi satu query: `JOIN` + agregasi, atau `where id = ANY(${ids})`.
   - Batch `transitionsFor`: satu query `where entity_type = ${t} and entity_id = ANY(${ids})`,
     lalu kelompokkan di memori — bukan satu query per entity.
   - **WAJIB jaga semantik RLS/scope**: batching tak boleh membocorkan baris lintas-scope.
     Pertahankan gerbang `canView`/`canScope`/RLS yang sama; kalau read pakai `db()` service-role,
     pertahankan filter TS yang sama persis (preseden D-12).
3. **Indeks.** Verifikasi (via `EXPLAIN`) indeks pada kolom hot; tambah yang hilang lewat
   migrasi `supabase/migrations/**` (JANGAN `psql -f`, O38):
   `audit_log(entity_type, entity_id)`, `assets(assigned_pic)`, `assets(brief_id)`,
   `clients(assigned_am_id)`, `metric_entries(campaign_id, period_start)`,
   `weekly_result_recap(client_id, minggu_mulai)` (sebagian sudah ada — cek dulu, jangan duplikat).
4. **Pooler/koneksi.** Set eksplisit `max` + `idle_timeout` di `createClient` bila perlu; pastikan
   **tak ada `sql.end()`** di jalur request (hanya di teardown tes).
5. **Frontend (ukur, lalu perbaiki).**
   - Deteksi **waterfall**: halaman yang `await` endpoint berurutan → paralelkan (`Promise.all`).
   - Manfaatkan Server Component + streaming; tambah caching Next (`revalidate`) untuk data
     yang tak real-time. (Baca `web-internal/node_modules/next/dist/docs/` — Next ini bukan yang
     biasa, per `AGENTS.md`.)
   - Analisis bundle (`next build` output) untuk halaman berat; code-split komponen besar.
6. **DoD:**
   - Laporan **before/after**: jumlah query per request + p95 3 endpoint hot (target warm < ~300ms).
   - Nol regresi: suite domain (1246) + apps/api (345) + web-internal (238) tetap hijau;
     parity route/shape/body hijau; **nol perubahan perilaku bisnis** (skor/gerbang identik).
   - Setiap batangan optimasi punya tes yang membuktikan hasil hitung tak berubah.

### Estimasi: sedang–besar (paling berdampak; kerjakan bertahap per-modul, ukur tiap langkah).

---

## T-1 — O9: Target bulanan real lewat dashboard *(operasional + opsi kecil)*

### Yang sudah ada
`perf_period_targets` (PK `role_type, component, period_start`) + domain `setTarget`/`listTargets`
+ endpoint `performance/config/targets` + halaman `web-internal/(shell)/performance/config`.
Seed sekarang `is_placeholder=true`; snapshot menandai `targets_placeholder=true` bila memakainya.

### ⚠️ KEPUTUSAN PEMILIK
- **Target cukup per TEAM (role-type), atau perlu per INDIVIDU (per Advertiser/staff)?**
  Skema saat ini role-level. Per-staff = tambah kolom `staff_id` (nullable) ke PK
  `perf_period_targets` + resolver "exact-staff → role-default" (pola sama period exact→sentinel).

### Langkah (bila per-team cukup — jalur default)
1. Verifikasi halaman config bisa mengisi **semua** (role, komponen ber-target, bulan): Creative
   `output_quantity`/`gmv_impact`; Ads `gmv_impact`/`optimization_activity`; KOL `creator_count`;
   AM `complaint_resolution_speed`. Set `is_placeholder=false` saat angka real diisi.
2. (Opsional) tambah **import CSV massal** target per bulan supaya tak isi satu-satu.
3. Tulis SOP pengisian bulanan (dokumen singkat) — siapa isi, kapan (sebelum snapshot bulan berjalan).
4. **DoD:** ≥1 bulan target real terisi, snapshot terkait `targets_placeholder=false`, tes hijau.

### Langkah tambahan (bila per-staff diperlukan)
- Migrasi tambah `staff_id` ke `perf_period_targets`; update `targetFor` resolver (exact staff-first);
  update UI config (pilih staff opsional); tes resolusi target. Estimasi +kecil.

### Estimasi: kecil (per-team) / kecil-sedang (per-staff).

---

## T-2 — RM-2: Hold Service (tombol AM + approval Head of Account)

### Tujuan
Klien dengan **semua** service `On Hold` **tak** dibuka rekap mingguan (D-06) dan **tak** menghukum
AM di `weekly_recap_discipline` (D-14) — menutup no-op RM-2.

### Langkah
1. **Mesin service** (`docs/STATE_MACHINES.md` §service + migrasi `supabase/migrations/**`):
   tambah state `[On Hold]` + dua edge lewat `sm_transition`:
   - `[In Execution] → [On Hold]` — **diminta AM**, **butuh approval Head of Account**, alasan wajib.
   - `[On Hold] → [In Execution]` — resume (gate serupa).
   Gerbang SIAPA di **domain** (bukan mesin) — pola `plan.ts`/`recap.ts`. Pola approval = **Void
   Service (M4-OA-5)** yang sudah ada (SPV/Account Lead approval) — tiru alurnya.
2. **Filter klien aktif** (RM-2): di job D-06 (`wrr_monday_job`) dan `amRecapDisciplineCandidate`,
   klien aktif = "≥1 service NOT IN ('Done', '[Cancelled — Service Voided]', **'[On Hold]'**)".
   Klien yang **semua** service-nya `On Hold` → tak dibuka rekap; denominator disiplin ikut otomatis.
3. **FE:** tombol "Hold Service" di halaman service (M4) → modal alasan → status menunggu approval
   Head → Head ACC/tolak. Cermin UI Void Service.
4. **Notif:** kemungkinan event baru (`service_hold_requested` / `service_held`) → butuh katalog **v8**.
   (Registrasi lewat baris `notif_catalog_versions`, bukan literal — O55.)

### ⚠️ KEPUTUSAN PEMILIK
- **Klien all-hold juga skip Health snapshot (M13)?** Rekomendasi: **ya** (konsisten "tak aktif").
- **Hold meng-cascade paksa Brief/Asset/Campaign yang sedang jalan?** Rekomendasi: **tidak** —
  hold hanya menyetop kewajiban rekap + skoring, tak memaksa transisi anak (hindari efek samping
  merusak). Konfirmasi.
- **Butuh event notif baru (v8)?** atau cukup pakai pola approval existing tanpa event baru?

### DoD
Mesin + edge + gate role (tes per-role, termasuk immutability history), job D-06 exclude klien
all-hold (tes), UI hold+approval, tes disiplin D-14 (klien all-hold tak masuk denominator),
katalog notif konsisten bila event baru. Gate parity tetap hijau.

### Estimasi: sedang (mesin + gate + job + UI + notif).

---

## T-3 — M8: CTR/CVR/CPC/CPM otomatis (RM-3/RM-C)

### Langkah
1. **Migrasi** tambah ke `metric_entries` (`20260722055644_ad_campaigns.sql` = skema asal, JANGAN
   diedit — migrasi BARU): `clicks bigint NULL`, `impressions bigint NULL`
   (+ `conversions bigint NULL` bila CVR = conversions/clicks — lihat keputusan).
2. **M8 metric entry** (UI + domain): field opsional clicks/impressions/(conversions).
3. **`wrr_aggregate`** (M6D): hitung dari Σ, `—` bila denominator 0/absen (house #7):
   - CTR = Σclicks / Σimpressions × 100
   - CVR = Σconversions / Σclicks × 100  *(butuh definisi sumber conversions)*
   - CPC = Σspend / Σclicks · CPM = Σspend / Σimpressions × 1000
4. **Kosakata `wrr_metrik`** (CHECK `metrik IN (…)` di skema WRR): tambah `cpc`, `cpm` bila mau
   dikonsolidasi (migrasi). CTR/CVR sudah ada di kosakata.
5. **M13/M14 tak berubah** — CTR/CVR/CPC/CPM **bukan** komponen skor; hanya display rekap/health.

### ⚠️ KEPUTUSAN PEMILIK
- **Definisi CVR & sumber "conversions".** Conversions = order count? GMV-event? dari platform mana?
  Tanpa ini CVR tetap `—`. CTR/CPC/CPM bisa jalan lebih dulu (hanya butuh clicks/impressions).

### DoD
`metric_entries` punya clicks/impressions(/conversions); `wrr_aggregate` mengisi ctr/cvr/cpc/cpm
saat lengkap, `—` saat tidak; tes aggregate (kelas `recap.aggregate.test.ts`); nol perubahan skor.

### Estimasi: sedang.

---

## T-4 — View organik + CPL (+ Upcoming Milestones) *(paling besar — pecah sub-tiket)*

### Sub-T4a — View organik
- **⚠️ KEPUTUSAN PEMILIK: sumber datanya dari mana?** (M7 Creative content reach? M10 Live? organic
  reach platform? entri manual?) — belum ada modul yang menangkapnya.
- Rekomendasi bila manual/import: entitas metrik organik (tabel `organic_metrics` per klien/periode
  atau kolom di Daily Output M7) → `wrr_aggregate` konsolidasi ke view organik **terpisah** dari
  `total_view` berbayar (jangan campur paid vs organik — beda dimensi).

### Sub-T4b — CPL (Cost Per Lead)
- CPL = Σspend(klien, periode) ÷ count(leads klien periode). Butuh tautan **leads (M1) ↔ spend (M8)**
  per klien per periode.
- **⚠️ KEPUTUSAN: atribusi.** Rekomendasi: CPL **blended** (semua spend ÷ semua lead klien periode) —
  sederhana, dokumentasikan sebagai blended (bukan per-channel). Tambah metrik `cpl` (perluasan
  kosakata `wrr_metrik` + agregasi). Bagi-nol → `—`.

### Sub-T4c — Upcoming Milestones (RM-11)
- Ini **bukan metrik angka** — daftar item. Model = tabel milestone / field terstruktur.
- **⚠️ KEPUTUSAN: benar-benar dibutuhkan sekarang?** Bila tidak, tetap di RM-C9 text-only.

### DoD (per sub-tiket)
Sumber data termodelkan; agregasi mengisi metrik saat lengkap, `—` saat tidak; RM-C9 text-only
dipensiunkan **hanya** untuk metrik yang sudah benar-benar dimodelkan (sisanya tetap catatan).

### Estimasi: besar. Jangan satu PR — pecah T4a/T4b/T4c, prioritas T4a > T4b > T4c.

---

## Daftar KEPUTUSAN PEMILIK yang menunggu (kumpulan)
1. **T-1:** target per-team saja, atau per-individu staff?
2. **T-2:** klien all-hold skip Health snapshot? · hold cascade ke anak? · event notif v8 baru?
3. **T-3:** definisi CVR + sumber "conversions"?
4. **T-4:** sumber view organik? · atribusi CPL (blended?) · Upcoming Milestones perlu sekarang?

## Ranjau repo (tetap)
- Migrasi HANYA `supabase/migrations/**` + `apply_migration` (O38); DB rebuild HANYA
  `scripts/db-rebuild.sh`. `backend/**` read-only (Go+MySQL pensiun).
- Wire snake_case `null` eksplisit (O43); `KNOWN_GAPS` route-parity tetap **kosong**.
- Penegakan aturan di DB (sm_transition + RLS + trigger), TS = pembungkus.
- Notif re-baseline lewat baris `notif_catalog_versions`, bukan literal (O55).

## Sumber kebenaran
- Perf: `packages/domain/src/{performance,health,recap}.ts` (loop N+1), `packages/db/src/client.ts`,
  `apps/api/src/lib/db.ts`.
- O9: `perf_period_targets` + `performance.ts::{setTarget,targetFor}` + `performance/config` UI.
- RM-2: `docs/STATE_MACHINES.md` §service, Void Service M4-OA-5, `wrr_monday_job` (D-06),
  `performance.ts::amRecapDisciplineCandidate`.
- M8: `supabase/migrations/20260722055644_ad_campaigns.sql` (`metric_entries`),
  `wrr_aggregate` (`20260813040000_m6d_wrr_aggregate.sql`).
- View organik/CPL: `docs/backlog/M6D_BACKLOG.md` §3 (RM-4/RM-7/RM-11), M6D PRD §10.1-B.
