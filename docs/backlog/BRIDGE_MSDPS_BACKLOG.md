# Bridge MSDPS→CDPS Fase 1 — backlog

Sumber: `BRIDGING_MSDPS_CDPS_v1.0.md` (arsitektur, 16 keputusan terkunci
2026-09-10) + `RENCANA_BRIDGE_MSDPS_CDPS_FASE1.md` (verifikasi terhadap kode
berjalan, 4 temuan yang mengubah rencana, 3 amandemen). Format sama dengan
`M19_BACKLOG.md`. Bridge **bukan modul PRD** — otoritasnya `docs/DECISIONS.md`
2026-09-10 (menggantikan entri 2026-07-12 butir 7).

## Titik gabung dengan `main`

Sebelum bridge (per `1f4d28f`, head `main` saat kerja dimulai): **156 tabel ·
43 entity_prefix · 34 sm_machines · 73 notif_events**, migrasi terakhir
`20261006010000_m19_scs_subtype_ke_baris.sql`. PR #340 (resign permanen),
PR-2 (arsip/hapus MSL, `20260930010000_msl_arsip_hapus.sql`), dan PR-5
(layanan multi-platform, `20261004010000_pr5_multi_platform_services.sql`)
sudah merge ke `main` sebelum sesi ini dimulai — rebase yang diminta rencana
asli sudah tidak relevan, timestamp bridge dipilih **sesudah** kepala `main`
(`20261007010000`, bukan `20260930010000` yang sudah dipakai PR-2).

Sesudah Bagian A (CDPS): **160 · 44 · 35 · 74**, migrasi
`20261007010000_bridge_msdps_fase1.sql`.

## Context

MEAGO! (MSDPS) menutup deal dengan merchant POI, tapi tim yang mengerjakan
pekerjaan operasionalnya — Account, Ads, Creative, Store Operation — tidak
ada di MEAGO; semuanya duduk di MEA Agency dan bekerja di CDPS. Hari ini
penyerahannya ketik ulang manual. MSDPS M6–M10 dibangun lengkap sebagai
mesin eksekusi kedua dan tidak berpenghuni.

**Solusi (Opsi A).** MSDPS mendorong work order ke inbox CDPS; manusia CDPS
menerimanya; CDPS menjalankan eksekusi. Fase 1 = satu arah, tanpa callback.
Volume 10–20 deal/bulan.

### Keputusan pemilik yang sudah diambil

D1 divisi penerima (Account/Ads/Creative/Store Operation + KOL non-roster) ·
D2 Live Stream tetap di MSDPS · D3 merchant jadi `CLI-` penuh · D4+D13 hanya
deal berbayar+terverifikasi, gerbang di sumber · D6 GMV component
dikecualikan + redistribusi bobot · D7 GMV baseline/target diketik manusia ·
D9/D8/D11/D12/D15/D16 (lihat `docs/DECISIONS.md` 2026-09-10) · **D5 diamandemen
ke opsi (b)** (employee layanan tunggal, bukan sync per-BD) · **D10 dibaca
ulang** (lead Account + Director, bukan "Head Account saja") · **§4.3
diamandemen** (`services.sumber` + `clients.sumber`, bukan satu kolom).

---

## Bagian A — CDPS (`MEAgrup/AgencyAPP`) · ✅ SELESAI (kode); prasyarat non-kode terbuka

### A1 · migrasi + registry — ✅

`supabase/migrations/20261007010000_bridge_msdps_fase1.sql` (10 bagian
bernomor, pola M19): prefix `ORD` · mesin #35 `external_order` (`[Masuk]` →
`[Diterima]`\|`[Ditolak]`, `[Dibatalkan Sumber]` terdaftar tak terjangkau) ·
`clients.sumber` + `services.sumber` (DUA kolom, amandemen §4.3) ·
`client_external_ref` (dedup UNIQUE) · `client_external_billing` (atestasi
append-only, trigger blok UPDATE+DELETE **dengan** `SET search_path = public`
yang lupa dipasang di preseden `client_pitch_consents_frozen`) ·
`external_orders` (inbox, payload immutable, CHECK bentuk) ·
`external_service_map` (LAHIR KOSONG) · RLS kelima tabel + ledger O48
(`external_service_map_select`, `USING (true)`) · katalog notifikasi v16
(`bridge.order.masuk`, SATU event).

**AC tercapai:** gate 160/44/35/74 dinaikkan di `scripts/db-rebuild.sh` DAN
`.github/workflows/ci.yml` commit yang sama; `packages/core/src/ident.ts`
`PREFIXES.ORD` ditambahkan; `supabase/tests/immutability_checks.sql` +
`rls_checks.sql` diperbarui.

### A2 · domain `packages/domain/src/bridge.ts` — ✅

`intake` (idempoten, mint `ORD-`, notify) · `candidates` (dedup 3-tingkat,
tak pernah auto-select) · `accept` (satu transaksi: validasi atestasi →
resolusi MSL via `msl.sellableAt` [reuse, bukan query paralel] → attach/buat
`CLI-` → `client_external_ref` → `client_external_billing` →
`contract.createContract` [reuse] + `SVC-` per baris `sumber='meago'` →
stempel `released_to_account_at` → `sm_transition`) · `reject` · admin CRUD
`external_service_map`. Error class di-import dari `./account` (mapping
status HTTP otomatis lewat nama kelas, nol entri baru di `http.ts`).

**Judgment call dicatat, bukan diam-diam dipilih:** rencana hanya menyebut
`contract.createContract` untuk cabang tempel-ke-klien-lama; diperluas ke
cabang klien-baru juga (jendela kontrak dari `merchant.tanggal_mulai/akhir_
kontrak` di payload) supaya kedua cabang simetris di bawah O57. Dicatat di
`docs/DECISIONS.md` sebagai catatan implementasi, bukan keputusan pemilik
terpisah — reversibel tanpa migrasi bila ternyata salah arah.

### A3 · API + wire — ✅

`POST /api/v1/internal/bridge/orders` (`BRIDGE_INGEST_SECRET` terpisah,
`@/lib/bridge-auth`, fail-closed) · `GET /bridge/orders[/{id}]` ·
`POST /bridge/orders/{id}/accept|reject` · `GET/POST /admin/external-service-
map` + `POST .../{id}/deactivate` · wire.ts (`BridgeOrderSummaryWire`,
`BridgeOrderDetailWire`, `BridgeCandidateWire`, `ExternalServiceMapWire`,
nested payload types) + registrasi `WIRE_TO_FE` + `web-internal/src/lib/
bridge.ts` (FE home, `bridge.ts` ditambahkan ke `FE_FILES`).

### A4 · Frontend `/bridge/inbox` — ✅

Pola kartu-keputusan (`ApprovalCard`/`DecisionActions`/`MetaGrid`, preseden
`/persetujuan`), BUKAN drawer (nol hit di repo). List (`[Masuk]` + toggle
riwayat) + detail (payload terbaca, kandidat, empat field manual, Accept/
Reject). Nav lewat `KEUANGAN` (anchor `ANCHOR-NAV-KEUANGAN`) + satu baris
`nav.test.ts`. Gate D10 di FE (`isAccountLead(role) || role.director`) —
server tetap otoritas akhir.

### A5 · Tes — ✅ (unit domain); browser UAT belum dijalankan

`packages/domain/src/bridge.test.ts` — idempotency, no-attestation reject
(termasuk Director), unmapped service (atomik, nol baris tertinggal),
immutability (payload UPDATE; billing UPDATE+DELETE), dedup race, permission
per peran (OD read-only, AM biasa ditolak), nol `client_sales_allocations`,
nol TRX leakage, fixture Alpha Digital. A7 anti-drift: `tutupbuku.test.ts` +
`finance.test.ts` + `health.test.ts` ditambah kasus `sumber='meago'`.
**Belum dijalankan:** UAT browser 3 aktor (`scripts/browser-tour.mjs`) —
butuh `scripts/db-rebuild.sh` hijau di lingkungan yang bisa membuka
Playwright; dijadwalkan sebelum go-live, bukan sebelum merge.

### A6 · Dokumen — ✅

`docs/DECISIONS.md` (entri 2026-09-10, menggantikan butir 7 2026-07-12, 16
keputusan + 3 amandemen tercatat baris-per-baris) · `docs/DATA_MODEL.md` §1 ·
`docs/STATE_MACHINES.md` §25 · `docs/BRIDGE_MSDPS_CONTRACT.md` + fixture
`docs/fixtures/bridge_order_v1.json` · berkas ini.

### A7 · Anti-drift finance — ✅ (dipindah dari Fase 3, PR yang sama)

`tutupbuku.hitungAngkaPeriode` (`where s.sumber <> 'meago'`) ·
`finance.dealServices` (`and s.sumber <> 'meago'`, dipakai
`commissionAchievement` + `commissionAchievementBatch`) ·
`health.gmvCandidate` (cabang `sumber='meago'`, redistribusi bobot Rule 4).

---

## Prasyarat go-live (bukan kode, tidak memblokir merge)

1. Paket MEAGO dibuat di Master Service List lewat layar MSL (Sales Head +
   Head Account) — `external_service_map` tetap kosong sampai ini selesai.
2. Baris `external_service_map` diisi sesudah paket ada.
3. Satu employee layanan "MEAGO Bridge" dibuat (email nyata tim), nol baris
   `role_mappings`. `employee_id`-nya masuk env `MEAGO_BRIDGE_EMPLOYEE_ID`
   (dibaca API layer, divalidasi domain terhadap tabel `employees`).
4. Transaksi Finance MSDPS untuk deal pilot (lewat B0, Bagian B) diverifikasi
   sebelum accept pertama dicoba.

## Bagian B — MSDPS (`MEAgrup/MEAGO_MSDPS`) · belum dimulai

Menunggu Bagian A merge + `docs/BRIDGE_MSDPS_CONTRACT.md` tersedia (sudah).
B0 (sambungkan `create_poi_finance()` ke UI, nol SQL baru) adalah prasyarat
TEKNIS yang ditemukan lewat pengukuran langsung production MSDPS: gerbang
D13 hari ini menolak 100% deal (nol `transaction_id` terisi dari 82 deal,
17 Berbayar). Rincian lengkap B0–B6: lihat Bagian IV rencana
`RENCANA_BRIDGE_MSDPS_CDPS_FASE1.md`.

## Exit criteria Fase 1

5–10 deal nyata mengalir `DEAL-` → `ORD-` → `CLI-`/`SVC-`/`BRF-` → eksekusi
divisi, nol perbaikan DB manual, idempotency terbukti lewat kirim-ganda
sengaja, dan satu bulan buku ditutup dengan nol rupiah MEAGO di dalamnya.
Latensi accept diinstrumentasi sejak hari pertama (mengukur, bukan menebak,
kapan D10 perlu dilebarkan dari lead Account ke semua AM).
