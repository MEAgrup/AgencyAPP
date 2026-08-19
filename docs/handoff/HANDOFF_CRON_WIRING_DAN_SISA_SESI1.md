# HANDOFF — Wiring cron `internal/*/tick` + sisa task (Sesi 1)

> Rantai konteks: Wave 3 gap-audit SESI5 (C OPEN ditutup) → beres-beres 3 PR lama
> (#171/#172/#187) → **handoff ini: cron wiring + lapisan anti-regresi #171 + sisa Wave 3.**
> Baca `docs/DECISIONS.md` 2026-08-19 (3 baris teratas) untuk keputusan terkini.

---

## 0. POSISI SAAT INI

| Hal | Nilai |
|---|---|
| **Repo** | `MEAgrup/AgencyAPP` |
| **Branch** | `claude/wave3-gap-audit-handoff-gws02u` (isinya: Wave3 SESI5 + re-land #187 + hardening #171). |
| **Migrasi** | **120** (`…819010000_harden_secdef_execute_from_anon` migrasi terakhir; +1 dari 119). |
| **Gate** | `tabel public` **121** TETAP (migrasi hardening nol tabel) · prefix 35 / mesin 23 / event 58 TETAP. |
| **Hijau** | `db-rebuild` 120 migrasi + 4 invariant (incl `rls_checks`) · api **359** · domain ads **24** · marketing/campaign/board **63**. |
| **PR** | #172 & #187 DITUTUP (superseded / re-landed). #171 **tetap terbuka** (fix aman sudah di branch ini; lapisan anti-regresi + apply-live = sesi berikut). |

### Setup container baru
```bash
service postgresql start
su postgres -c "psql -d postgres -c \"ALTER USER postgres WITH PASSWORD 'postgres';\""
npm ci
bash scripts/db-rebuild.sh --yes                # 'tabel public 121', 120 migrasi
export DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps"
( cd apps/api && npx vitest run --no-file-parallelism )   # api 359 hijau
```
⚠️ Postgres di container bisa mati di tengah sesi (tes hang, output kosong / timeout 5000ms
di SEMUA tes). Cek `service postgresql status`; `start`; verif `psql -h 127.0.0.1 -U postgres -d cdps -c '\dt'`.

---

## 1. TASK UTAMA — WIRING CRON `internal/*/tick` (ditunda pemilik, Pattern A)

### 1.1 Yang sudah ada (jangan bangun ulang)
Empat rute HTTP tick, semua **POST**, semua digerbang **shared-secret**:
| Rute | Kerja | Cadence dimaksud | Body |
|---|---|---|---|
| `POST /api/v1/internal/health/tick` | `health.runSnapshotJob` — snapshot Health Score semua klien | **bulanan** | `{waktu?}` RFC3339 override "now" |
| `POST /api/v1/internal/performance/tick` | `performance.runSnapshotJob` — snapshot Team Perf | **bulanan** | `{waktu?}` |
| `POST /api/v1/internal/plan/tick` | `plan.runPlanTick` — dorong plan/notif jatuh tempo | harian | `{}` (pakai `today`) |
| `POST /api/v1/internal/penugasan/tick` | reminder penugasan internal | harian | `{}` |

**Gerbang:** header `x-plan-tick-secret` dibandingkan `process.env.PLAN_TICK_SECRET`.
Secret **unset ⇒ endpoint tertutup (403)** (fail-closed). Semua job **idempotent** (panggilan
kedua untuk periode sama = no-op) — aman kalau cron dobel-fire.

### 1.2 Yang BELUM ada
- **Tak ada `vercel.json`** dan **tak ada workflow cron** (`.github/workflows/` hanya `ci.yml`,
  `c03-deployment-uat.yml`, `railway-mysql-backup.yml`).
- Env `PLAN_TICK_SECRET` belum di-set di environment produksi (Vercel) — set dulu sebelum wiring.

### 1.3 Keputusan yang PERLU pemilik sebelum mulai
1. **Provider cron.** Dua opsi, ada jebakan header:
   - **GitHub Actions (disarankan untuk cocok dgn gate saat ini):** workflow `schedule:` yang
     `curl -X POST -H "x-plan-tick-secret: $SECRET" https://<app>/api/v1/internal/<job>/tick`.
     Bisa kirim header custom → **cocok dengan gate `x-plan-tick-secret` tanpa ubah kode**.
     Secret disimpan di GitHub Actions secret. Jebakan: waktu cron GH Actions "best-effort".
   - **Vercel Cron:** hanya bisa memanggil path di deployment sendiri & **menambah
     `Authorization: Bearer $CRON_SECRET` sendiri** — **tidak bisa** kirim header
     `x-plan-tick-secret`. Kalau pilih ini, rute harus **juga menerima** `Authorization: Bearer`
     (adaptasi kecil + tes). Butuh Vercel plan yang mengizinkan Cron.
2. **Jadwal tepat (WIB→UTC).** Bulanan health/performance: tanggal berapa? (mis. tanggal 1
   00:05 WIB = `5 17 L * *` UTC — hati-hati konversi hari). Harian plan/penugasan: jam berapa?
3. **Un-defer.** Keputusan pemilik 2026-08-19 = Pattern A (HTTP tick), wiring provider DITUNDA.
   Wiring = mencabut penundaan itu → butuh "go" pemilik + set `PLAN_TICK_SECRET`.

### 1.4 Catatan penting
- `penugasan_reminder_tick` **juga** terjadwal sebagai **pg_cron** di live (`0 0 * * *`, terlihat
  saat apply #170). Jadi penugasan mungkin sudah jalan via pg_cron — **konfirmasi dulu** agar tak
  dobel jalur (pg_cron + HTTP tick). health/performance/plan **belum** punya pg_cron.
- Uji lokal: `curl -X POST -H "x-plan-tick-secret: <secret>" localhost:3000/api/v1/internal/health/tick`.

---

## 2. TASK — LAPISAN ANTI-REGRESI #171 (ditunda dari fix aman)

Fix aman #171 **sudah di branch ini** (migrasi `20260819010000`): 0 fungsi SECURITY DEFINER
`anon`-executable, `authenticated` dipertahankan untuk helper RLS. Yang **belum** (sengaja
ditunda karena berisiko bikin CI merah — PR #171 §4):
1. **Tiru default-privileges Supabase** di `scripts/db-rebuild.sh` + `ci.yml`:
   `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES/FUNCTIONS TO anon, authenticated,
   service_role` **sebelum** migrasi diterapkan — supaya Postgres polos berperilaku seperti live
   dan kelas cacat "fungsi baru anon-executable" bisa **merah di CI**.
2. **Gate umum di `supabase/tests/rls_checks.sql`:** assert NOL fungsi SECURITY DEFINER boleh
   dieksekusi `anon` (tanpa kecuali) + daftar putih eksplisit `authenticated` untuk helper predikat.
   Tanpa langkah 1, gate ini **palsu-hijau** di Postgres polos — kerjakan berpasangan.
3. **Apply fix ke live:** migrasi `20260819010000` idempotent & aman; apply lewat **deploy normal**
   branch ini (bukan out-of-band). Verif sesudah: `select count(*) ... has_function_privilege('anon',
   oid,'EXECUTE') and prosecdef` = **0** di CDPS SG (`egddxfcnrtecheiykhlf`).
4. **Tutup PR #171** sesudah langkah 1–3 mendarat (fix + gate + live selaras).

---

## 3. SISA TASK LAIN (status)

### 3.1 Wave 3 — HANYA Client Portal tersisa
Semua A+B+C non-portal HABIS (gap-audit SESI1–5). Sisa **Client Portal (M15 C-cluster,
M15-G3..G7)**: realm auth terpisah, allow-list data layer, service-progress client-facing, form
komplain source=Portal. **Diblokir O4 (embeddability) + O5 (security spec DRAFT, 10 OQ) + ditunda
pemilik 2026-07-18.** **JANGAN mulai** tanpa keputusan pemilik + head dev menutup O4+O5.
Prasyarat: spec keamanan Portal + cek embeddability `mea-client-reporting` (fallback: link-out).

### 3.2 Wave 2 — residual by-design (jangan mulai tanpa keputusan pemilik)
- **C2 (M9 §10.3)** Attributed GMV dari affiliate-link tracking; **C3 (M7 §8)** review-and-lock
  bulanan. Keduanya butuh pipeline affiliate-link tracking yang **belum ada**.
- **B1-residual** (`creator_blacklist`), **B2-residual** (aksi SPV→Director eksplisit + notif) —
  kecil, "bila dibutuhkan", butuh bentuk dari pemilik.

### 3.3 Follow-up dari #172 (opsional, butuh keputusan pemilik)
"Laporan mingguan Advertiser per-brief" (analisa+saran, `ads_weekly_reports`) BUKAN duplikat M6D
WRR. Kalau masih diinginkan → tiket baru di atas model `main` sekarang (M6D WRR + report engine C1),
bukan menghidupkan PR #172 lama.

---

## 4. SUMBER KEBENARAN
- `docs/DECISIONS.md` 2026-08-19 (3 baris teratas: 3-PR triage + #171 fix, SESI5, dst).
- `docs/backlog/WAVE3_GAP_AUDIT.md` (tabel: non-portal HABIS) · `WAVE2_GAP_AUDIT.md` (B4 ✅).
- Rute tick: `apps/api/src/app/api/v1/internal/{health,performance,plan,penugasan}/tick/route.ts`.
- Migrasi hardening: `supabase/migrations/20260819010000_harden_secdef_execute_from_anon.sql`.
- Live proacl (CDPS SG `egddxfcnrtecheiykhlf`): verifikasi via Supabase MCP `execute_sql`.
