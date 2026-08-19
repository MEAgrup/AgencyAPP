# HANDOFF — Wave 2 Gap Audit (Kelas C4–C7 selesai) — Sesi 43

> Rantai: … → SESI41 (Kelas A, PR **#182 MERGE**) → SESI42 (Kelas B, PR **#183 MERGE**)
> → **SESI43 (ini, terbaru — Kelas C4 + C5 + C6 + C7).**
> Baca yang bernomor tertinggi lebih dulu.
>
> **Status: C5, C7, C4, C6 SELESAI & teruji — PR #184 MERGE ke `main`. Sisa Wave 2 = C1/C2/C3 (satu desain
> lintas-modul GMV→Health/attribution) + residual B1/B2/B4 — SEMUA menunggu fitur manajemen toko klien +
> reporting engine.**

---

## 0. CARA MELANJUTKAN

### 0.0 Posisi branch & PR
| Hal | Nilai |
|---|---|
| **Repo** | `MEAgrup/AgencyAPP` |
| **PR #184** | Wave 2 gap audit **Kelas C4–C7**. **MERGE ke `main`.** |
| **Branch berikutnya** | Restart dari `main` terbaru: `git fetch origin main && git checkout -B <branch-baru> origin/main`. **`main` kini punya A+B + C4–C7 (119 migrasi).** |
| **Commit (arsip)** | `2d9f273` C5+C7 · `1cc4705` C4 · `7cde9f9` C6 · `3e57281` handoff (di atas `066fdab` = `main` A+B). |
| **Migrasi** | **119** total (satu baru: `20260818040000_m8_roas_underperforming_notif.sql`, katalog v11). |
| **Gate** | `notif_events` 57→**58** (v11), dinaikkan di `ci.yml` + `db-rebuild.sh`. Mesin 23 / prefix 35 TETAP. |

### 0.1 Aturan main (tak berubah) — lihat SESI42 §0.1 + `CLAUDE.md`
- Migrasi HANYA lewat `supabase/migrations/**` + `apply_migration`; DB lokal HANYA `scripts/db-rebuild.sh`.
- Tes domain WAJIB serial; **rebuild DB setelah migrasi baru**. Wire snake_case lewat `apps/api/src/lib/wire.ts`.
- `route-parity`/`shape-parity` `KNOWN_GAPS`/registry harus tetap konsisten (setiap wire baru didaftarkan).

### 0.2 Setup DB lokal — lihat SESI42 §0.2 (tak berubah).

---

## 1. Yang SELESAI sesi ini (jangan ulang)

Tiap item punya entri `docs/DECISIONS.md` 2026-08-18 (baris teratas). **Nol blocker keamanan/permission/immutability.**

| # | Modul | Fix | Berkas kunci |
|---|---|---|---|
| **C5** | M7 §3 Rule 2 / §9.1 | **Antrean Asset pribadi per-PIC lintas Brief.** `creative.listMyAssets(sql, actor)` (service-role, hard-scope `assigned_pic=actor`, hindari O52 join-erasure) + `GET /assets/mine` + panel FE "Antrean Aset Saya". Tanpa filter status (PRD "*all* Assets assigned"), urut due_date. | `creative.ts` `listMyAssets`, `assets/mine/route.ts`, `wire.ts` `MyAssetQueueItemWire`, `web-internal/.../creative/page.tsx` + `lib/creative.ts` |
| **C7** | M6D | **RM-A5 Service Aktif Minggu Ini + RM-D4 Keluhan Terkait** diturunkan live di `getRecapDetail` atas jendela WIB minggu recap. Keanggotaan di-anchor ke fakta immutable (created_at + transisi audit) ⇒ recap tertutup tetap stabil; status RM-D4 = terkini (cross-reference hidup). | `recap.ts` `serviceAktifMingguIni`/`keluhanTerkaitMingguIni` + `RecapDetail`, `wire.ts` 2 wire baru, `.../account/rekap/[id]/page.tsx` + `lib/recap.ts` |
| **C4** | M8 §8 Rule 4 / M8-OA-5 | **Notif eskalasi ROAS underperforming** (event baru `m8.ads.roas_underperforming`, **katalog v11**, `explicitOrLeads`→AM pemilik + SPV Ads). Emit dari `ads.logMetricEntry` saat trailing under-target streak jadi **tepat 2** (idempoten tanpa kolom penanda). Non-ROAS target tak pernah mengemit. | migrasi `20260818040000`, `core/notification.ts` (EVENTS/CATALOG/VERSIONS), `ads.ts` `computeUnderTargetStreak` + emit, `ci.yml`/`db-rebuild.sh` 57→58 |
| **C6** | M9 §4 Rule 4 & §9 | **(a)** flag sourcing-stall dini: `sourcingStallFlagged(status,createdAt,dueDate,now)` derived di read booking, **read-only tanpa notif**, wire `sourcing_stall_flagged` + banner FE. **(b)** **Laporan Bulanan KOL** `monthlyKolReport` (total booking, QC pass rate, avg sourcing, **total spend=Σ Agreed Rate**, escalation count) + `GET /kol/monthly-report` + section FE. | `kol.ts` `sourcingStallFlagged`/`monthlyKolReport`/`canSeeMonthlyReport`, `kol/monthly-report/route.ts`, `wire.ts` `MonthlyKolReportWire`, `.../kol/page.tsx` + `.../kol/bookings/[id]/page.tsx` + `lib/kol.ts` |

**Verifikasi (DB fresh 119 migrasi, serial):** core **252** hijau, domain **1398** hijau (+8 tes C4–C7),
api **351** hijau, web-internal **257** hijau; typecheck core/domain/api/web-internal + lint FE bersih;
route-parity + shape-parity hijau (3 wire baru terdaftar: `MyAssetQueueItemWire`, `RecapServiceAktifWire`+`RecapKeluhanTerkaitWire`, `MonthlyKolReportWire`).

> ⚠️ **Satu tes GAGAL, pra-eksis & TAK terkait perubahan ini:** `interview.test.ts` › "counts WORKING days:
> a registered national holiday does not count against the AM" (`expected 1 to be 0`). Bergantung pada
> **tanggal kalender container saat run** (aritmetika hari-kerja vs `current_date`), bukan pada kode yang
> disentuh sesi ini (`interview.*` + logika hari-libur byte-identik dengan `main`). Bukan regresi.

---

## 2. BERIKUTNYA — sisa Wave 2 (C1/C2/C3 + residual B)

### 2.1 C1 + C2 + C3 + B4-residual = SATU desain lintas-modul "GMV → Health/attribution"
**JANGAN mulai sebelum fitur manajemen toko klien + reporting engine ada.** Arah pemilik (SESI42 §2.1):
"GMV live autogenerate dari report yang di-upload ke sistem (fitur upload → buat report + regenerate semua
reporting). Reporting dibuat SETELAH fitur management toko klien selesai." Engine reporting = **penulis tunggal**
`clients.total_sales`; GMV live/KOL/Ads jadi input rekonsiliasi (jangan tulis langsung dari M8/M9/M10).

- **C1 (M10):** GMV live/KOL reconciled → sinyal GMV klien untuk Health Score (§6.2 #5, §5 Rule 1).
- **C2 (M9 §10.3):** Attributed GMV via affiliate-link tracking (bukan ketik manual) — provisional s.d. pipeline tracking ada.
- **C3 (M7 §8 Rule 3):** review-and-lock bulanan Attributed GMV (period-lock).
- **B4-residual:** baseline pertumbuhan majemuk per-kuartal dari reporting hidup (kini floor statis `clients.gmv_baseline`).

> **📌 CATATAN PEMILIK (SESI43):** pemilik punya **contoh HTML autoreport dari sheets klien** dan akan
> **mengirimnya saat mulai build C1** (setelah fitur manajemen toko selesai) sebagai **format target output**
> engine reporting. Rencana: (1) registry toko/platform per klien → (2) upload report + engine regenerate
> (tiru pola parse-export Riset Awal yang SUDAH ada: browser parse xlsx→AoA+sha256, server jalankan engine;
> HTML autoreport = template output) yang menulis `clients.total_sales` + tren GMV → (3) sambungkan Health Score.

### 2.2 Residual B (kecil, opsional)
- **B1-residual — tabel `creator_blacklist`.** Sekarang blacklist manual ke Google Sheets (alasan di `audit_log`).
  Buat tabel (handle/nama, alasan, ref booking di-drop, added_by/at) + peringatan saat create Booking — **setelah
  pemilik konfirmasi bentuk registry** (kemungkinan menyatu dengan registry toko C1).
- **B2-residual — aksi SPV→Director eksplisit + notif.** Hanya bila tie-breaker M9-OA-6 terbukti kurang; butuh
  event katalog (pertimbangan beku sama seperti C4 — perlu ACC pemilik).

---

## 3. Peta Wave 2 (diperbarui)

| Bucket | Status |
|---|---|
| Kelas A (#182), Kelas B (#183) | ✅ MERGE ke `main`. |
| **Kelas C4** (notif eskalasi ROAS) | ✅ **SESI43** (katalog v11). |
| **Kelas C5** (antrean Asset per-PIC) | ✅ **SESI43**. |
| **Kelas C6** (sourcing-stall flag + Laporan Bulanan KOL) | ✅ **SESI43**. |
| **Kelas C7** (RM-A5/RM-D4 di `getRecapDetail`) | ✅ **SESI43**. |
| **Kelas C1/C2/C3 + B4-residual** (GMV→Health/attribution) | ❌ Satu desain lintas-modul; **setelah** manajemen toko + reporting engine (pemilik kirim HTML autoreport saat mulai). |
| **B1/B2-residual** | ❌ Kecil; hanya bila dibutuhkan (B1 menyatu registry toko; B2 butuh event katalog). |

**Exit Wave 2:** setelah C1/C2/C3 tertutup / disepakati ditunda + kriteria exit Wave 2 → **Wave 3** (M2, M3, M11, M13, M14, M15 — Client Portal terakhir).

## 4. Jebakan yang MASIH relevan (lihat juga SESI42 §4)
1. Tes domain WAJIB serial; rebuild DB setelah migrasi baru.
2. `clients.total_sales` = penulis tunggal (engine reporting) — jangan tulis dari M8/M9/M10 langsung (itu C1, bukan tambal).
3. Katalog notifikasi beku: menambah event butuh baris `notif_catalog_versions` + `notif_events` + naikkan gate `notif_events` di `ci.yml` & `db-rebuild.sh` (satu commit) + selaraskan `core/notification.ts`. Invariant O55 = SUM(event_count)=COUNT(notif_events); jangan hardcode angka.
4. Reads gated yang butuh data lintas-scope (C5/C7/C6b) dijalankan pada service-role `db()` dengan **gate in-app + hard self/scope filter** (pola `getRecapDetail`), untuk menghindari O52 join-erasure — jangan `readAsActor` bila join `clients`/`services` menghapus baris divisi eksekusi.
5. `interview.test.ts` "counts WORKING days" bisa gagal tergantung tanggal container — pra-eksis, bukan regresi.

## 5. Sumber kebenaran
- **Kode berubah sesi ini:** lihat tabel §1 + `docs/DECISIONS.md` 2026-08-18 (3 baris teratas: C5+C7, C4, C6).
- Gap register: `docs/backlog/WAVE2_GAP_AUDIT.md` (C4–C7 kini tertutup; C1/C2/C3 tetap terbuka).
- `CLAUDE.md` aturan rumah #1–#8 + build order.
