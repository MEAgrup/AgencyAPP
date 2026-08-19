# HANDOFF — Wave 3 gap-audit: sisa B kecil (M2/M3/M15) DITUTUP — Sesi 4

> Rantai: … → SESI2 (M13/M14 scheduler + M11-G3) → SESI3 (M2-G1 + M3-G1) →
> **SESI4 (ini — sisa B kecil: M2-G3/G5/G6, M3-G2/G3/G4, M15-G1/G2).**
> Baca yang bernomor tertinggi lebih dulu.
>
> **Status: klaster B Wave 3 HABIS.** Semua temuan A + B untuk M2/M3/M11/M13/M14 dan
> M15 (non-Client-Portal) ditutup. Yang tersisa Wave 3 = **C OPEN** (verifikasi/log,
> bukan build) + **Client Portal (M15 C-cluster)** yang diblokir O4+O5 & ditunda pemilik.

---

## 0. CARA MELANJUTKAN

### 0.0 Posisi branch & PR
| Hal | Nilai |
|---|---|
| **Repo** | `MEAgrup/AgencyAPP` |
| **Branch** | `claude/m2-g1-m3-g1-lanjutan-fqzra6` (SESI3 + SESI4). |
| **Migrasi** | **119** (NOL migrasi baru sepanjang SESI3+SESI4 — murni domain+API+wire+FE+tes). |
| **Gate** | `tabel public` 121 · `entity_prefix` 35 / `sm_machines` 23 / `notif_events` 58 **TETAP**. |
| **Backlog audit** | `docs/backlog/WAVE3_GAP_AUDIT.md` (STATUS SESI 4 + semua B ✅). |
| **Keputusan** | `docs/DECISIONS.md` **2026-08-19** baris teratas ("Wave 3 gap-audit SESI4"). |

### 0.1 Aturan main (tak berubah) — CLAUDE.md + SESI1..3
- Tes domain WAJIB serial (`--no-file-parallelism`); `npm ci` sebelum test; rebuild DB setelah migrasi baru.
- Wire snake_case lewat `apps/api/src/lib/wire.ts`; `null` eksplisit (bukan omitempty).
- `route-parity` `KNOWN_GAPS` **tetap kosong**; `shape-parity` `INLINE_NESTED` **tetap kosong**.
- `backend/**` = oracle paritas read-only; jangan tambah fitur di sana.
- ⚠️ **Catatan operasional:** Postgres di container bisa mati di tengah sesi (kejadian di
  SESI4 — vitest hang, output kosong). Kalau tes menggantung tanpa output: cek
  `service postgresql status`, `service postgresql start`, verifikasi via TCP
  `PGPASSWORD=postgres psql -h 127.0.0.1 -U postgres -d cdps -c '\dt'`.

### 0.2 Setup di container baru
```bash
service postgresql start
su postgres -c "psql -d postgres -c \"ALTER USER postgres WITH PASSWORD 'postgres';\""
npm ci
bash scripts/db-rebuild.sh --yes                # 'tabel public 121'
export DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps"
( cd apps/api && npx vitest run --no-file-parallelism )   # api hijau
```

---

## 1. Yang SELESAI sesi ini (jangan ulang)

### 1.1 M3-G2 — edit-field campaign (§6.1 "edit own") — KODE
`updateCampaign(sql, actor, id, input)` di `campaign.ts`: edit field wajib §6.3 (Name,
Channel, Online/Offline ≥1, Start Date). Gate `canManageCampaign` (owning staff / lead
division-wide / Director — otoritas sama dengan lifecycle). Validasi **mirror
`createCampaign`** sebelum tulis (semua wajib + tanggal valid). 1 baris audit before→after
(action `edit`). Owner/Status/End Date TAK dapat diedit di sini. Rute
`PATCH /marketing/campaigns/{id}` (di `[id]/route.ts`, di samping GET) + FE `updateCampaign`.

### 1.2 M15-G1 — filter "division mix" (§6.3) — KODE
Param `filterDivision` di `portal.managementDashboard` (sig BARU: …, filterAm,
**filterDivision**, sortBy). `clientIdsInDivision(sql, division)`: Account = seluruh buku
klien; divisi lain = klien dengan ≥1 Brief `assigned_division` — **scope identik `teamClients`**.
Wire `filter_division` + query `?division=` + FE opsi `division`.
⚠️ **Signature `managementDashboard` berubah** — semua pemanggil (route + tes) sudah di-update.

### 1.3 M15-G2 — `boardRef` drill-through Board (§6.3) — KODE
`MgmtRow.boardRef = /api/v1/board?client=<id>` (mirror `ClientShortcut.boardRef`, selalu ada)
di `mgmtRowFor`. Wire `board_ref` + FE. `snapshotId` = sibling drill-through M13.

### 1.4 M2-G3 — sort/flag low-ROAS — KEPUTUSAN (FE-owned, bukan kode)
`roas`/`lead_quality_rate`/`owner_employee_id` sudah di wire (M2-G1). Threshold "low" butuh
angka OKR yang tinggal di M13 (M2-G2, DECISIONS 296/153), bukan klaster M2. ⇒ sort/flag =
**presentasi FE** atas wire yang ada; server tak menambah endpoint. Ter-log DECISIONS SESI4.

### 1.5 M3-G4 — Marketing-Lead create — KEPUTUSAN (log, bukan restrict)
`canCreate` mengizinkan Lead: TIDAK di-restrict — Lead sudah manage tiap campaign
division-wide (`canManageCampaign`), jadi melarang create-saja = model otoritas tak
konsisten; sesuai oracle Go (hindari O43 break). Ter-log DECISIONS SESI4 + komentar `canCreate`.

### 1.6 M2-G5 + M2-G6 + M3-G3 — TES
- **M2-G5:** blok "verbatim BI messages on every error path" — assert `err.message` **persis** =
  `MSG_INCOMPLETE/FORBIDDEN/NOT_FOUND/DUPLICATE` (createRecord, getRecord, updateBudget).
- **M2-G6:** blok immutability DB — assert UPDATE & DELETE baris `audit_log`
  (`marketing_performance_record`) ditolak trigger `forbid_mutation()` (`/append-only\/immutable/`).
- **M3-G3:** tes "illegal edges" assert `res.message === bi.TRANSITION_NOT_ALLOWED`.

### 1.7 Berkas berubah
```
EDIT  packages/domain/src/campaign.ts            (updateCampaign + CampaignInput reuse + canCreate note)
EDIT  packages/domain/src/campaign.test.ts       (updateCampaign block + M3-G3 message assert + bi import)
EDIT  packages/domain/src/marketing.test.ts      (M2-G5 + M2-G6 blocks + MSG_* imports)
EDIT  packages/domain/src/portal.ts              (managementDashboard filterDivision + clientIdsInDivision + MgmtRow.boardRef)
EDIT  packages/domain/src/portal.test.ts         (mgmt sig +filterDivision, boardRef assert, M15-G1 division test)
EDIT  apps/api/src/app/api/v1/marketing/campaigns/[id]/route.ts   (+PATCH)
EDIT  apps/api/src/app/api/v1/portal/management/route.ts          (+?division=)
EDIT  apps/api/src/lib/wire.ts                   (MgmtRowWire.board_ref + ManagementDashboardWire.filter_division)
EDIT  web-internal/src/lib/marketing.ts          (updateCampaign)
EDIT  web-internal/src/lib/portal.ts             (MgmtRow.board_ref + ManagementDashboard.filter_division + division opt)
EDIT  docs/backlog/WAVE3_GAP_AUDIT.md            (STATUS SESI 4 + semua B ✅)
EDIT  docs/DECISIONS.md                          (baris teratas 2026-08-19 SESI4)
BARU  docs/handoff/HANDOFF_WAVE3_GAP_AUDIT_SESI4.md (ini)
```

## 2. Verifikasi
- domain hijau (serial): **campaign 28** (+3 updateCampaign), **marketing 17** (+2 M2-G5/G6),
  **portal 7** (+1 M15-G1); leads_campaign 18 sanity hijau.
- **api 359 hijau** (21 file — shape-parity + route-parity + wire + body-parity).
- typecheck api & domain bersih; web-internal bersih **selain** error `xlsx` pra-ada di
  `riset-awal.ts` (bukan dari sesi ini).
- **NOL migrasi baru** — DB tetap 119/121.

## 3. BERIKUTNYA — yang tersisa di Wave 3
Semua A + B (kecuali Client Portal) HABIS. Sisa:
1. **C OPEN — verifikasi/log, bukan build:**
   - **M11-G4** — My Tasks `dependencyBadge` selalu `''` (paritas Go); verifikasi intent → log 1 baris.
   - **M2-G4** — CPRL floor `Rp. 416.666,00` vs contoh PRD `416.667` (rounding, paritas Go) → terima + log.
   - **M2-G7** — Director tak diuji di path read metrics/dashboard → tambah 1 tes atau log.
   - **M3-G6** — Campaign Name "text only" tak enforce digit-only → log atau enforce ringan.
   - **M13-G2/G3, M14-G2..G5, M15-G3..G7** — sudah ter-log/observasi (lihat backlog); pastikan tercatat.
2. **Client Portal (M15 C-cluster) TERAKHIR** — diblokir O4 (embeddability) + O5 (security spec
   DRAFT, 10 OQ) + ditunda pemilik 2026-07-18. **JANGAN mulai** tanpa keputusan pemilik + head dev.

## 4. Sumber kebenaran
- `docs/backlog/WAVE3_GAP_AUDIT.md` — semua temuan + status + urutan.
- `docs/DECISIONS.md` 2026-08-19 (SESI4 baris teratas).
- Kode: `packages/domain/src/{campaign,marketing,portal}.ts`, `apps/api/src/lib/wire.ts`,
  `apps/api/src/app/api/v1/marketing/campaigns/[id]/route.ts`,
  `apps/api/src/app/api/v1/portal/management/route.ts`, `web-internal/src/lib/{marketing,portal}.ts`.
- PRD `docs/prd/CDPS_Module{2,3,15}_*.md`.
