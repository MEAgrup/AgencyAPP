# KINERJA SALES BACKLOG (M0 §7.1 + Renewal)

> **Konteks/keputusan/desain lengkap: `docs/handoff/RENCANA_KINERJA_SALES.md`
> (aslinya diberikan sebagai `RENCANA_KINERJA_SALES.md` di root repo, tidak
> ditiketkan sebelumnya — nol hit di 11 berkas `docs/backlog/` per audit awal).**
> Berkas ini adalah status tiket **otoritatif** — nama migrasi + nama test
> persis per klaim, karena itulah satu-satunya sumber status yang bisa
> diverifikasi tanpa membaca ulang seluruh rencana.
>
> Keputusan: `docs/DECISIONS.md` baris 2026-08-30 (cari "KINERJA SALES") — 4
> baris Decided + SP-1/SP-2/SP-3 Open.
> Permission: `PERMISSIONS.md` §M0 Sales (baris "Kinerja Sales dashboard").

## 0. Status

| Stream | Isi | Status |
|---|---|---|
| A (S-01..S-05) | Dashboard Kinerja Sales | ✅ SELESAI |
| B additive (R-01/R-02) | `contracts.jenis` + read-model | ✅ SELESAI |
| B pintu (R-03/R-04) | Renewal dari Client Record | ⛔ GARIS STOP — menunggu Account Service di `main` + SP-2 |

---

## Stream A — Dashboard

| # | Isi | Status |
|---|---|---|
| S-01 | RLS Sales lead scope — `prospect_attempts_select`/`clients_select`/`installments_select` | ✅ **SELESAI** — audit riwayat migrasi menemukan `transactions_select` sudah tercakup O46 (`jwt_division_owns_client`), jadi TIGA gap nyata bukan empat seperti rencana asli. Migrasi `20260901050000_rls_sales_lead_scope.sql`. Ledger O48 (`supabase/tests/rls_checks.sql`) diperbarui — baris `prospect_attempts_select` dihapus (arm sekarang ada) |
| S-02 | `sales_targets` (target/OKR) | ✅ **SELESAI** — migrasi `20260901070000_s02_sales_targets.sql`. Nol prefix baru; RLS `sales_targets_select` + `GRANT SELECT` eksplisit |
| S-03 | `packages/domain/src/salesperf.ts` | ✅ **SELESAI** — `bySalesperson`/`byMonth`/`bySource`/`listTargets`/`setTarget` + `canViewSalesPerf`/`scopeFor`/`canManageTarget`/`levelSalesFor`. Test `packages/domain/src/salesperf.test.ts` (9 kasus: permission murni, agregasi satu closing penuh, division-by-zero, scope staf-vs-lead, byMonth+target+pencapaian, bySource) |
| S-04 | Route API `apps/api/src/app/api/v1/sales/{performance,performance/monthly,performance/sources,targets}` | ✅ **SELESAI** — shell tipis, `readAsActor` untuk GET, `db()`+gate TS untuk PUT target (pola `performance/config/targets`). Wire: `salesPerfRowToWire`/`salesPerfMonthRowToWire`/`leadSourceRowToWire`/`salesTargetToWire` (`apps/api/src/lib/wire.ts`) |
| S-05 | UI `web-internal/src/app/(shell)/sales/kinerja/page.tsx` | ✅ **SELESAI** — 4 tab (Per Sales/Per Bulan/Sumber Lead/Target), filter periode+sales+source+campaign. Lib `web-internal/src/lib/salesperf.ts`. `nav.ts` — `{ href: '/sales/kinerja', ... }` ditambah ke `ACQUISITION_LINKS`; `nav.test.ts` diperbarui (3 assersi baru: Sales staff melihatnya, 4 divisi delivery tidak). **Deviasi kecil dari rencana**: filter Campaign memakai `<select>` bespoke, BUKAN `components/CampaignPicker.tsx` — komponen itu ber-semantik INTAKE (bahasa wajib, sentinel "di luar campaign", funnel picked-campaign) yang tidak cocok untuk filter dashboard opsional; data source (`listSelectableCampaigns`) tetap dipakai ulang |

### Permission (per S-03/PERMISSIONS.md)

| Peran | Lihat | Tulis target |
|---|---|---|
| Sales staff | barisnya sendiri saja | ❌ |
| Sales Lead/SPV | se-divisi (S-01) | ✅ |
| OD | read-only semua | ✅ |
| Director | penuh | ✅ |

---

## Stream B — Renewal & Cross-Sell

| # | Isi | Status |
|---|---|---|
| R-01 | Migrasi `contracts.jenis` + `contract_sebelumnya_id` | ✅ **SELESAI** — `20260901060000_r01_contract_jenis.sql`. DEFAULT `'baru'`, CHECK 3 nilai, FK self-referencing nullable, CHECK bentuk (non-null hanya saat `perpanjangan`). Nol prefix baru, nol FK ke tabel lain. `contract.ts` (`Contract`/`ContractRow`/`rowToContract`) + wire (`ContractWire`/`contractToWire`) + FE type (`web-internal/src/lib/contract.ts`) diperbarui supaya kolom baru tidak jadi bug kelas O43 (`shape-parity.test.ts` menegakkannya) |
| R-02 | Read-model `salesperf.ts` membaca `contracts.jenis` | ✅ **SELESAI** — kolom `klienBaru`/`klienPerpanjangan`/`klienCrossSell` tertimbang `client_sales_allocations.basis_points`. Klien tanpa baris `contracts` sama sekali → `'baru'` by elimination (sah karena R-03 belum ada) |
| R-03 | Pintu renewal — buka `canWriteContract` untuk Sales, faktorkan `sales.close()`'s pembuatan CTR/SVC/TRX, tangani siklus Strategi/Plan wajib | ⛔ **GARIS STOP** — menunggu (1) kerja Account Service mendarat `main`, (2) `docs/DECISIONS.md` SP-2 (kredit alokasi + aturan komisi perpanjangan) |
| R-04 | UI tombol "Perpanjangan/Cross Sell" di `/clients/[id]` + notifikasi | ⛔ **GARIS STOP** — sama seperti R-03 |

---

## 8. Test (Definition of Done) — status

| Klaim | Test |
|---|---|
| Permission per peran (staff/lead/OD/Director/divisi lain) | `salesperf.test.ts`: "canViewSalesPerf / scopeFor" (2 kasus) + "bySalesperson > scopes..."/"lets a Sales lead..." |
| RLS S-01 | `reads_rls.test.ts` "S-01: a Sales lead reads a teammate's attempt/client/installment; Sales staff and a foreign-division lead do not" — 9 assersi (3 tabel × lead/staff/divisi-asing) di bawah `withClaims` (RLS sungguhan, bukan koneksi BYPASSRLS) |
| Recompute-from-log | `salesperf.test.ts` "aggregates one closed deal" — angka closing/qualified/omzet/komisi dibandingkan terhadap fixture yang sama dua kali secara implisit (fungsi murni derive-on-read, tidak ada cache) |
| Money: omzet tertimbang + komisi ≤ kontrak | `salesperf.test.ts` — omzet = total_agreed_value penuh saat satu sales 100% alokasi; komisi_kontrak = 10% dari situ; komisi_diakui = 0 sebelum Finance memverifikasi (M0 §5) |
| Bagi nol → "—" | `salesperf.test.ts` "renders division-by-zero as null" — `closingRatePct`/`qualifiedRatePct`/`avgDealCycleDays` semuanya `null` (wire + UI merender "—") |
| Immutability | Tidak ada jalur mutasi baru ke `audit_log`/`prospect_activities` — setiap route baru GET kecuali `PUT /sales/targets` (config, bukan history) |
| BI messages | `salesperf.ts`: `MSG_FORBIDDEN` ('[anda tidak memiliki akses ke data ini]') dan `MSG_INCOMPLETE` untuk `setTarget` tanpa nilai — dilempar lewat `ForbiddenError`/`ValidationError`, dipetakan `apps/api/src/lib/http.ts` |
| Route parity | `route-parity.test.ts` — `KNOWN_GAPS` tetap kosong (rute baru otomatis lolos scan FE↔API karena `web-internal/src/lib/salesperf.ts` memanggilnya) |
| Shape parity | `shape-parity.test.ts` — 4 wire type baru terdaftar `WIRE_TO_FE` + FE type `salesperf.ts` (juga menutup regresi `ContractWire` dari R-01) |
| Fixture Alpha Digital | Tidak disentuh — gate `db-rebuild.sh` tetap 129/36/29/65 pasca migrasi baru |

---

## 9. Verifikasi dijalankan sesi ini

1. `scripts/db-rebuild.sh --yes` — 151 migrasi, gate 129 tabel / 36 prefix / 29 sm_machines / 65 notif_events, semua invariant (`ident_checks`/`immutability_checks`/`rls_checks`/`auth_claims_checks`) lolos.
2. `npm run test --workspaces --if-present` (root, `DATABASE_URL` ke Postgres lokal) — hijau bersih: `@cdps/core` 290/290, `@cdps/db` 53/53, `@cdps/domain` 1573/1574 (1 skip UAT e2e), `@cdps/api` 383/383 (termasuk `route-parity`/`shape-parity`). Catatan proses: dua run sebelumnya (sebelum sesi ini menyentuh kode apa pun) sempat menunjukkan 2-3 kegagalan berputar acak di `admin.test.ts`/`client.test.ts`/`strategi.test.ts` — pre-existing flake lintas-file tak terkait perubahan sesi ini, tidak hadir lagi di run final.
3. `web-internal`: `npm test` 379/379 (termasuk `nav.test.ts` 38/38). `npm run typecheck` — satu error PRA-ADA tak terkait (`riset-awal.ts` modul `xlsx` tidak ter-install di environment sandbox; berkas itu tidak disentuh sesi ini).
4. Local `/sales/kinerja` belum dijalankan lewat browser sungguhan (skill `run`) — di luar cakupan verifikasi non-interaktif sesi ini; API + domain tests membuktikan kontraknya.
