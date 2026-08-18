# HANDOFF — Wave 2 Gap Audit (Kelas A selesai) + peta Kelas B/C — Sesi 41

> Rantai: … → SESI39 (RAB-16/17/18, PR #180) → SESI40 (RAB-19/20, PR **#181 MERGE**)
> → **SESI41 (ini, terbaru — Wave 2 gap audit, Kelas A, PR #182).**
> Baca yang bernomor tertinggi lebih dulu.
>
> **Status: seluruh RAB-01…RAB-20 TUNTAS (merged). Wave 2 gap audit Kelas A TUNTAS (merged).**
> **Kelas B (4 item) + Kelas C (7 item) BELUM — menunggu keputusan pemilik.**

## 0. CARA MELANJUTKAN DI CHAT BARU — baca ini dulu

### 0.0 Posisi branch & PR
| Hal | Nilai |
|---|---|
| **Repo** | `MEAgrup/AgencyAPP` |
| **PR #181** | RAB-19/20 (dokumen Wave E) — **MERGED** ke `main`. |
| **PR #182** | Wave 2 gap audit Kelas A (M6D freeze-on-close + M9 notif) — **MERGED** ke `main`. |
| **Branch berikutnya** | Restart dari `main` terbaru: `git fetch origin main && git checkout -B <branch-baru> origin/main`. |

> ⚠️ **Kedua PR sudah merge.** Jangan menumpuk commit di branch lama. Kerja baru = branch baru dari `main`.

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

---

## 1. Yang SUDAH selesai sesi ini (PR #182, jangan ulang)

Audit paritas PRD↔kode enam modul delivery Wave 2 (M12/M7/M8/M9/M10/M6D — semua sudah terbangun via
cutover, `KNOWN_GAPS` kosong). **Nol blocker keamanan/permission/immutability.** Register lengkap:
**`docs/backlog/WAVE2_GAP_AUDIT.md`** (baca ini untuk daftar B/C terperinci).

### 1.1 A1 — M6D freeze-as-of-close
`wrr_aggregate` dulu jalan **sekali** di `wrr_monday_job` saat open (minggu baru mulai ⇒ `audit_log` kosong
⇒ angka otomatis 0/NULL), tak pernah refresh ⇒ **kedua** jalur tutup (AM `closeRecap` + auto force-close
`Ditutup Otomatis`) membekukan angka kosong ⇒ rollup kosong ke M6B PE-3/PE-8 + Health H-1. STATE_MACHINES §15
berjanji "dibekukan as-of penutupan"; PRD §9 "refreshed on demand".
- **Fix** (`supabase/migrations/20260818010000_m6d_wrr_freeze_on_close.sql`): trigger `trg_wrr_reaggregate_on_close`
  (`AFTER UPDATE OF status`, `WHEN new.status IN ('Ditutup','Ditutup Otomatis')`) → `wrr_aggregate(NEW.id)` —
  satu tempat, kedua jalur, tanpa menulis ulang `wrr_monday_job`.
- Write-primitive `wrr__upsert_metrik`/`wrr__upsert_divisi` di-hardening **skip baris ber-`sengketa`** (RM Rule 7:
  Sengketa Angka membekukan angka disengketakan; re-agregasi menyegar baris non-sengketa saja).
- **Nol kolom/tabel/mesin/prefix/event** ⇒ gate 118/23/57 TETAP. +2 tes `recap.close.test.ts`.

### 1.2 A2 — M9 notifikasi QC-fail/escalate
`failQC` & `escalate` tak pernah mengemit `KOLQCFailedOrEscalated` (`m9.kol.qc_failed_or_escalated`, resolver
`leadsOfDivision`→KOL Lead) walau event **sudah terdaftar** & M10 mengemit analognya.
- **Fix** (`packages/domain/src/kol.ts`): param `after` baru di helper `edge` (post-transisi, dalam transaksi);
  `failQC`/`escalate` emit via `emitQcFailedOrEscalated` (mirror `livestream.flagDiscrepancy`). Nol migrasi.
- +1 tes `kol.test.ts` (failQC→lead, escalate→lead via aktor Director agar tak self-excluded).

### 1.3 A3 — DIBATALKAN (false positive)
Audit M12 menandai `assetToWire` omitempty (`hours_logged` dkk) sebagai pelanggaran O43. **Bukan bug:** FE
mendeklarasikannya opsional (`web-internal/src/lib/creative.ts:71-74`) & `wire.delivery.test.ts:109` **sengaja**
menguji omitempty itu sebagai paritas Go tercatat. Membaliknya memecah tes. **Pelajaran: verifikasi klaim auditor
sebelum ubah kode.**

### 1.4 Verifikasi (DB fresh, serial)
domain **1383** hijau (+2), api **351** hijau (route/shape-parity tak tersentuh), typecheck core/db/domain/api
bersih. Gate 118/23/57 TETAP (`db-rebuild` memverifikasi, kini **115 migrasi**).

---

## 2. BERIKUTNYA — Kelas B & C (butuh keputusan pemilik)

**Sumber lengkap: `docs/backlog/WAVE2_GAP_AUDIT.md`.** Ringkas:

### Kelas B — gap nyata, butuh entri DECISIONS sebelum fix (CLAUDE.md "flag, jangan pilih diam")
- **B1 (M9)** Kreator unresponsive di `[Content In Progress]` **buntu** — tak bisa escalate (butuh `[QC Review]`)
  maupun drop. Butuh edge baru `[Content In Progress]→[Escalated]` + DECISIONS. (STATE_MACHINES §8.)
- **B2 (M9)** §10.1 beri Coordinator hak "escalate", tapi `canEscalate` kunci ke lead/Director. Konflik PRD vs SPV-lock.
- **B3 (M12)** Flow step 4 sebut `[Blocked]` dari `[In Review]`, tapi edge hanya dari `[In Progress]`.
  Inkonsistensi **internal PRD** (Rules 2/7/8 + STATE_MACHINES §7 setuju kode) — kemungkinan koreksi PRD, bukan kode.
- **B4 (M8)** Target KPI di-set Advertiser tanpa gate approval AM/SPV (§4 Rule 1). Sama dengan oracle Go.

### Kelas C — integrasi/fitur lintas-modul lebih besar (tiket tersendiri)
- **C1 (M10)** GMV live/KOL → sinyal GMV klien untuk Health Score — **lintas-sistem**: `clients.total_sales`
  tak ditulis apa pun di seluruh proyek; jalur Ads yang mesti ditiru pun belum ada. (M10+M13.)
- **C2 (M9)** Attributed GMV diketik manual, bukan dari affiliate-link tracking (§10.3). Tema sama C1/C3.
- **C3 (M7)** Monthly review-and-lock Attributed GMV (§8 Rule 3). Scope M8/M13.
- **C4 (M8)** Eskalasi ROAS <target 2 periode hanya flag pasif, tak notif/log (katalog beku).
- **C5 (M7)** Antrean Asset pribadi per-PIC lintas Brief (§3 Rule 2) — belum ada read/route (MINOR).
- **C6 (M9)** Flag sourcing-stall (§4 Rule 4) + baris spend laporan KOL bulanan (§9).
- **C7 (M6D)** Field display RM-A5 (Service Aktif) & RM-D4 (Keluhan Terkait) belum di read-model `getRecapDetail`.

**Rekomendasi urutan:** mulai Kelas B (kecil, butuh keputusan) — tanya pemilik B1/B2/B3/B4 satu-satu, tulis
DECISIONS, lalu fix. Kelas C1–C4 (GMV→Health/attribution) sebaiknya satu desain lintas-modul terpadu karena
`clients.total_sales` adalah lubang bersama; C5/C7 kecil & berdiri sendiri.

---

## 3. Jebakan yang MASIH relevan
1. Tes domain WAJIB serial; rebuild DB sebelum suite penuh & setelah migrasi baru.
2. web-internal app Next MANDIRI — `cd web-internal && npm install` terpisah.
3. `wrr_aggregate` idempoten & preserve manual/sengketa — aman dipanggil ulang; **jangan** timpa baris sengketa
   (upsert sudah dijaga `sengketa IS NULL`).
4. M9 `edge` helper kini punya param `after` (post-transisi, dalam transaksi) — pola untuk emit notif atomik.
5. Jangan asumsikan temuan auditor otomatis benar — verifikasi vs FE + tes (kasus A3).

## 4. Sumber kebenaran
- **Gap register:** `docs/backlog/WAVE2_GAP_AUDIT.md`.
- `docs/DECISIONS.md` 2026-08-18 (entri "Wave 2 gap audit — Kelas A" di baris teratas).
- **Kode berubah sesi ini:** `packages/domain/src/kol.ts` (+ `kol.test.ts`), `packages/domain/src/recap.close.test.ts`,
  `supabase/migrations/20260818010000_m6d_wrr_freeze_on_close.sql`.
- `CLAUDE.md` aturan rumah #1–#8.
