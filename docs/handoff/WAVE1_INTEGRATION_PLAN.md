# CDPS — Rencana Integrasi Wave 1 (Penyatuan Dua Fondasi)

> **Masalah:** kedua stream Wave 1 TIDAK fork dari fondasi bersama (merge-base = initial commit). Akun A membangun Sprint 0 + M0/M1 sendiri; Akun B membangun Sprint 0 + M4/M5 + httpapi + UI sendiri. "Merge" = **porting terarah**, bukan git merge.

## 0. Peta situasi (per 11 Jul 2026)

| | Akun A | Akun B |
|---|---|---|
| Branch final | `claude/handoff-process-continuation-69uk1f` (tip `beca815`, PR #5) | `claude/jalur-b-completion-72zpda` (tip `2e762e0`, lanjutan PR #2) |
| Isi | W1-01..09 lengkap: M1 (registry, dedup, import, pool, junk) + M0 (attempt, qualified, negosiasi, **closing atomik** + win-resolution) | W1-10..18 lengkap: M4 + M5 + httpapi + web-internal (32 file UI) + importer W1-19 + admin MSL + hrisconvert |
| Core | `ids, notify, authz, msl, auth, hris, testdb, events, msg` | `ident, notification, permission, money, statemachine(config), audit` + `internal/{auth,hris,db,admin,testutil,httpapi}` |
| Lapisan HTTP | **tidak ada** | lengkap (api.go + handlers + routes) |
| Skema | migrasi sendiri 0001–0049 (termasuk tabel kelahiran client/transaction versi A) | `0002_wave1_money_path` = **kontrak beku** WAVE1_PARALLEL_PLAN §4 (+0010–0013) |

**KEPUTUSAN KANONIK: fondasi B menang.** Alasan: aplikasi utuh (HTTP, UI, importer, admin), dan skema 0002 adalah kontrak handoff resmi yang M4/M5 sudah konsumsi. Yang di-port dari A: domain logic M0/M1 (+ test suite-nya). Catat di DECISIONS.md.

## 1. Peta padanan core (porter WAJIB adaptasi import; verifikasi signature aktual saat porting)

| Fondasi A | Fondasi B (kanonik) | Catatan |
|---|---|---|
| `core/ids` | `core/ident` | Generator `PREFIX-YYYYMM-NNNN` pasca-validasi |
| `core/notify` | `core/notification` | Event nego (`EvNegotiationPendingApproval`, `EvNegotiationDecision`) harus ada di katalog B — kalau belum, tambah lewat integrator |
| `core/authz` | `core/permission` | Cek fitur role-override A; port hanya jika dipakai M0/M1 |
| `core/msl` | `internal/admin/master_service` + `core/money` | W1-06 butuh lookup harga/komisi **version-at-date** — verifikasi B punya; kalau tidak, port `core/msl` A sebagai pengecualian |
| `core/statemachine` (engine+machines.go) | `core/statemachine` (config.go) | Edge M0/M1 milik A (termasuk O16; O18 accept-counter & O21 resubmit-after-reject masih open 1 baris) → masukkan ke config B via INTEGRATOR (single owner) |
| `core/testdb` | `internal/testutil` | |
| `core/auth`, `core/hris` | `internal/auth`, `internal/hris` | Pakai milik B |
| `core/audit` | `core/audit` | Bandingkan kontrak append; pakai B, adaptasi call-site |
| `internal/seed` | `internal/seed` | Fixture Alpha Digital = UNION kedua versi (A: lead→closing; B: client→verifikasi→routing) |

## 2. Pembagian porter (paralel, file disjoint)

### Porter C — `module1_leads` (W1-01..04)
- Sumber: branch A. Rekonsiliasi dengan `module1_leads` eksisting B (dedup W1-01 versi foundation): **versi A lebih lengkap** (import, pool, junk, normalize, messages) — jadikan A sumber utama, pertahankan perilaku yang test B sudah kunci.
- Adaptasi import core per §1. Migrasi baru yang dibutuhkan → rentang **0003–0005** (hanya kolom/tabel yang belum ada di skema B; tabel `leads`/`prospect_attempts` SUDAH ada di 0002 — jangan buat ulang, `ALTER` bila perlu).
- Tulis `leads_handlers.go` di atas `routes_leads_sales.go` B + test permission per role.

### Porter D — `module0_sales` (W1-05..09)
- Sumber: branch A. JANGAN ubah signature `commission.go`/`allocation.go` milik B (frozen sejak plan paralel).
- Port: attempt lifecycle, qualified form (sambungkan ke MSL B), negosiasi versioned + approval, **closing**.
- **Remap closing:** tulisan atomik ke tabel skema 0002 (`clients`, `client_platforms`, `client_sales_allocations`, `services`, `transactions` status awal `[Menunggu Verifikasi]`, `installments`) — BUKAN tabel kelahiran versi A. `WinResolverFunc` callback dipertahankan (module0 tidak boleh import module1); contoh binding ada di `closing_test.go` branch A.
- Migrasi baru (qualified_forms dkk. yang belum ada di 0002) → rentang **0006–0009**.
- Tulis `sales_handlers.go` + test permission.

### Integrator (orchestrator sesi) — sesudah C & D mendarat
1. Wiring `httpapi/api.go`: konstruksi closing dengan binding `WinResolverFunc` → win-resolution M1; registrasi route kedua handler.
2. Edge state machine A → `config.go` B (satu commit; termasuk resolve O18/O21 → catat DECISIONS).
3. Katalog notifikasi: tambah event nego bila belum ada.
4. `DECISIONS.md`: union kedua branch (append-only; konflik = pertahankan keduanya) + entri keputusan kanonik §0.
5. Seed fixture union + jalankan end-to-end.

## 3. QC gate integrasi (sebelum merge ke main)
1. `go test ./...` hijau penuh (MariaDB, `-p 1`); migrasi up→down→up bersih.
2. String BI `[...]` verbatim vs PRD (M0 §4-6, M1 §3-7, M4, M5) — tidak ada yang hilang saat porting.
3. Test permission per role tiap endpoint (termasuk OD/Director berlapis) — porter wajib bawa test A ikut.
4. Immutability & recompute-from-log tetap teruji (jangan drop test A).
5. **Uji alur silang (inti integrasi):** registrasi → qualified (komisi dari MSL) → nego approval → closing → baris lahir di tabel 0002 → M5 verifikasi → routing gate rilis ke Account → M4 lock matrix berlaku pada data warisan closing. Ini = W1-20 versi otomatis.
6. Fixture Alpha Digital union lulus.

## 4. Urutan eksekusi & sisa Wave 1
1. Integrator: `git checkout -b wave1-integration origin/claude/jalur-b-completion-72zpda`; baseline test hijau.
2. Spawn Porter C + D paralel (subagent, worktree terpisah), lalu merge keduanya.
3. Wiring + QC §3.
4. Buka PR `wave1-integration` → `main`; tutup/supersede PR #1/#2/#5 dengan catatan.
5. W1-19 import data riil — menunggu data Yohan (tidak memblokir merge; importer sudah siap).
6. W1-20 UAT manusia per `W1-20_UAT_RUNBOOK.md` + spot-check komisi Sales Head → go/no-go Wave 2 di DECISIONS.md.
7. Setelah merge: orchestrator Wave 2 jalankan Fase F (`WAVE2_PARALLEL_PLAN.md`).

## 5. Catatan lingkungan
Mesin orchestrator (Mac Nerissa) tidak punya Go/MariaDB/kredensial GitHub — dokumen ini dieksekusi oleh **satu sesi container baru (Akun Integrator)** yang men-spawn porter C/D sebagai subagent paralel (konsep Fable-planner: draft oleh agent, integrator = planner+QC).
