# HANDOFF — Wave 3 gap-audit: C OPEN (non-Client-Portal) DITUTUP — Sesi 5

> Rantai: … → SESI3 (M2-G1 + M3-G1) → SESI4 (sisa B kecil) →
> **SESI5 (ini — C OPEN non-portal: M2-G7 tes, M11-G4/M2-G4/M3-G6 terima+log,
> M13/M14/M15 C dikonfirmasi ter-log).**
> Baca yang bernomor tertinggi lebih dulu.
>
> **Status: Wave 3 gap-audit non-portal SELESAI.** Semua temuan **A + B + C** untuk
> M2/M3/M11/M13/M14 dan M15 (non-Client-Portal) DITUTUP. Satu-satunya sisa Wave 3 =
> **Client Portal (M15 C-cluster / M15-G3..G7)** yang diblokir O4 + O5 dan ditunda pemilik.

---

## 0. CARA MELANJUTKAN

### 0.0 Posisi branch & PR
| Hal | Nilai |
|---|---|
| **Repo** | `MEAgrup/AgencyAPP` |
| **Branch** | `claude/wave3-gap-audit-handoff-gws02u` (SESI5). |
| **Migrasi** | **119** (NOL migrasi baru — murni tes + komentar + dok). |
| **Gate** | `tabel public` 121 · `entity_prefix` 35 / `sm_machines` 23 / `notif_events` 58 **TETAP**. |
| **Backlog audit** | `docs/backlog/WAVE3_GAP_AUDIT.md` (STATUS SESI 5 — semua C ✅ kecuali Client Portal). |
| **Keputusan** | `docs/DECISIONS.md` **2026-08-19** baris teratas ("Wave 3 gap-audit SESI5"). |

### 0.1 Aturan main (tak berubah) — CLAUDE.md + SESI1..4
- Tes domain WAJIB serial (`--no-file-parallelism`); `npm ci` sebelum test; rebuild DB setelah migrasi baru.
- Wire snake_case lewat `apps/api/src/lib/wire.ts`; `null` eksplisit (bukan omitempty).
- `route-parity` `KNOWN_GAPS` **tetap kosong**; `shape-parity` `INLINE_NESTED` **tetap kosong**.
- `backend/**` = oracle paritas read-only; jangan tambah fitur di sana.
- ⚠️ Postgres di container bisa mati di tengah sesi; kalau tes menggantung: `service postgresql
  status` / `start`, verifikasi via `PGPASSWORD=postgres psql -h 127.0.0.1 -U postgres -d cdps -c '\dt'`.

### 0.2 Setup di container baru
```bash
service postgresql start
su postgres -c "psql -d postgres -c \"ALTER USER postgres WITH PASSWORD 'postgres';\""
npm ci
bash scripts/db-rebuild.sh --yes                # 'tabel public 121', 119 migrasi
export DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps"
( cd apps/api && npx vitest run --no-file-parallelism )   # api 359 hijau
```

---

## 1. Yang SELESAI sesi ini (jangan ulang)

Semua item C-OPEN Wave 3 non-portal. **Metode:** tiap C dinilai vs PRD + Go oracle + house
rules. Yang menyimpang dari contoh PRD tapi byte-exact dengan oracle, ATAU ambigu di PRD →
**terima + log** (bukan ubah-diam, agar tak fork paritas oracle / kelas O43). Yang murni gap
tes/DoD → tambah tes.

### 1.1 M2-G7 — Director di read path — TES (satu-satunya perubahan tes)
`marketing.test.ts` blok "dashboard split (§5)" kini meng-assert read path untuk Director:
`dashboard(director('ZZ-DIR'))` melihat ≥2 campaign termasuk `lia`, dan
`metrics(director, lia).owner === 'ZZ-LIA'`. Sebelumnya read gate hanya diuji di write path
(`createRecord`). Nol endpoint/query baru.

### 1.2 M11-G4 — My-Tasks `dependencyBadge` selalu `''` — TERIMA + LOG
By design, paritas Go: `scanUnitRows`/`scanChildUnitRows` di `backend/.../module11_board/views.go`
tak pernah set `DependencyNote`; badge dihitung HANYA di path Client Board (`dependencyBadge()`).
§5.4 "same card structure" TERPENUHI secara struktur (bentuk `Card` identik) — hanya nilai badge
beda per-surface (board publik vs to-do pribadi). Komentar ditambah di `makeUnitCard` (`board.ts`).

### 1.3 M2-G4 — CPRL floor `Rp. 416.666,00` — TERIMA + LOG
`moneyDivCount` membagi minor-unit dengan **floor/truncate** (`budget / BigInt(count)`), jadi
5.000.000/12 = `Rp. 416.666,00`, bukan contoh PRD `416.667`. Byte-exact dengan Go oracle
(`module2_marketing/metrics.go`: `money.Money(int64(budget)/int64(count))`, tes oracle assert
`Rp. 416.666,00`). Diterima; komentar ditambah di `moneyDivCount` (`marketing.ts`). Ubah-diam =
fork kontrak derived-money (O43).

### 1.4 M3-G6 — Campaign Name "text only" tak enforce digit-only — TERIMA + LOG
"text only" (§6.3) = field free-text, divalidasi **non-empty saja**, TIDAK menolak nama digit-only:
PRD tak beri aturan digit-exclusion, dan enforce akan menolak label sah ("11.11 Sale", "2026 Q1");
paritas Go (tak ada name-charset check). Komentar ditambah di `createCampaign` (`campaign.ts`).

### 1.5 M13-G2/G3, M14-G2..G5, M15-G3..G7 — DIKONFIRMASI TER-LOG
Sudah ter-log/observasi sebelumnya (DECISIONS 298, W3-M14-C1, W3-M15-C2 + bagian "Temuan per
modul" di `WAVE3_GAP_AUDIT.md`). Dikonfirmasi tercatat; tak ada aksi baru. (M15-G3..G7 = Client
Portal, sengaja TIDAK dikerjakan — lihat §3.)

### 1.6 Berkas berubah
```
EDIT  packages/domain/src/marketing.test.ts   (M2-G7: assert Director read path di dashboard split)
EDIT  packages/domain/src/marketing.ts        (M2-G4: komentar floor di moneyDivCount)
EDIT  packages/domain/src/campaign.ts         (M3-G6: komentar text-only di createCampaign)
EDIT  packages/domain/src/board.ts            (M11-G4: komentar dependencyBadge di makeUnitCard)
EDIT  docs/backlog/WAVE3_GAP_AUDIT.md         (STATUS SESI 5 + tabel + finding C ✅)
EDIT  docs/DECISIONS.md                       (baris teratas 2026-08-19 SESI5)
BARU  docs/handoff/HANDOFF_WAVE3_GAP_AUDIT_SESI5.md (ini)
```

## 2. Verifikasi
- domain hijau (serial): **campaign 28**, **board 18**, **marketing 17** (M2-G7 = assert baru
  di tes yang ada, jumlah tetap 17).
- **api 359 hijau** (21 file — route-parity 5 `KNOWN_GAPS` kosong, shape-parity, wire, body-parity).
- typecheck domain bersih.
- **NOL migrasi baru** — DB tetap 119/121.

## 3. BERIKUTNYA — status Wave 3 & langkah berikut

### Wave 3 — apa yang tersisa
Gap-audit Wave 3 **HABIS untuk semua modul kecuali Client Portal**. Satu-satunya pekerjaan
Wave 3 yang belum = **Client Portal (M15 C-cluster / M15-G3..G7)**:
- Diblokir **O4** (embeddability — OPEN, de-risked oleh report engine `report.ts` + `mode=klien`).
- Diblokir **O5** (security spec masih DRAFT, 10 OQ terbuka).
- **OQ-6** (ambiguitas PRD): Rule 7 menyiratkan surface invoice/payment yang tak didefinisikan
  §2–§6 → butuh keputusan pemilik (M15 vs M5).
- **Ditunda eksplisit oleh pemilik 2026-07-18.**
- **JANGAN mulai** tanpa keputusan pemilik + head dev menutup O4 + O5.

### Bisa lanjut ke wave berikutnya?
Menurut Build Plan (CLAUDE.md "Build order"), **M15 Client Portal adalah item TERAKHIR Wave 3
dan seluruh sistem** ("Client Portal last, after security spec"). Tak ada "Wave 4" build-module
di Build Plan — Wave 3 adalah wave modul terakhir. Jadi:
- **Tidak ada modul wave berikutnya untuk dikerjakan.** Yang tersisa adalah (a) Client Portal
  begitu O4+O5 ditutup pemilik, dan (b) item lintas-wave operasional yang sudah ter-log:
  wiring cron provider aktual untuk `internal/{health,performance,plan}/tick` (Pattern A —
  ditunda seperti plan/tick, keputusan pemilik 2026-08-19).
- **Rekomendasi ke pemilik:** karena semua modul buildable sudah lewat gap-audit, langkah nyata
  berikut adalah **keputusan O4/O5 Client Portal** (butuh pemilik + head dev), lalu deploy
  wiring cron. Sampai itu, tak ada dev-work modul baru yang boleh dimulai tanpa keputusan.

## 4. Sumber kebenaran
- `docs/backlog/WAVE3_GAP_AUDIT.md` — semua temuan + status (tabel ringkasan: non-portal HABIS).
- `docs/DECISIONS.md` 2026-08-19 (SESI5 baris teratas).
- Kode: `packages/domain/src/{marketing,campaign,board}.ts` (+ `.test.ts`).
- Go oracle: `backend/internal/module{2,11}_*` (paritas floor CPRL + My-Tasks badge).
- PRD `docs/prd/CDPS_Module{2,3,11,15}_*.md`; `docs/prd/CDPS_Build_Plan.md` (build order).
