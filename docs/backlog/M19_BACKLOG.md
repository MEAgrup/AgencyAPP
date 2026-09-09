# M19 — Creative Daily Ops: backlog

Sumber: `CDPS_GapAnalysis_LeaderVideo_CreativeDailyOps.md` (Gap A–I, keputusan
D1–D9) + `docs/prd/CDPS_Module19_Creative_Daily_Ops.md`. Format sama dengan
`REVISI_CDPS_SALES_CREATIVE_PERFORMA.md`.

## Titik gabung dengan `main`

Sebelum M19 (per `1947262^`): **150 tabel · 41 entity_prefix · 33 sm_machines ·
73 notif_events**, migrasi terakhir `20260926010000_fs6b_tenor_di_deal.sql`.
Sesudah separuh jadwal harian (PR #334, sudah di-merge + sudah diterapkan ke
live `CDPS SG`): **153 · 42 · 33 · 73**,
migrasi `20260927010000_m19_creative_daily_ops.sql`.
Sesudah separuh SCS: **155 · 43 · 34 · 73**,
migrasi `20260928010000_m19_scs_task_engine.sql`.

## Context

Leader Video menyusun ULANG jadwal produksi dengan tangan setiap hari di dua
Google Sheets (4.154 baris). CDPS memodelkan Brief → Asset (M7) tapi nol lapisan
di bawahnya: nol hari × studio × PIC × slot waktu, nol pengetahuan siapa sedang
cuti, nol rumah untuk "apakah yang dijadwalkan hari itu selesai hari itu".

### Keputusan pemilik yang sudah diambil

D1 entitas ringan `PROD-SLOT` tanpa mesin · D3 konflik studio warn-only ·
D4 Leader yang mencatat ketidaktersediaan · D5 penyelesaian hari-sama di luar
M14 · D7 Content Creator satu peran · D8 konten internal di luar cakupan ·
peran `SMO & Content Strategist` di bawah divisi Creative (2026-09-09).

---

## Bagian A — fondasi (A1–A3) · ✅ SELESAI

### A1 · migrasi + kosakata + registry test — ✅ `1947262`

`supabase/migrations/20260927010000_m19_creative_daily_ops.sql` (350 baris, enam
bagian bernomor pola M18): prefix `SLOT` · **nol** `sm_machines` (dengan komentar
yang menyatakan itu keputusan) · `studios` + seed 4 baris · `pic_unavailability` ·
`prod_slots` · RLS ketiga tabel · trigger `forbid_mutation` pada
`pic_unavailability`.

`packages/core/src/dailyops.ts` — `TASK_TYPES`, `ALASAN_TIDAK_TERSEDIA`,
`STUDIOS`, plus `waktuBertumpang` (setengah terbuka) dan `tanggalDalamRentang`
(inklusif). `packages/db/src/dailyops.registry.test.ts` — 17 tes set-equal.

**AC tercapai:** `db-rebuild` hijau 153/42/33/73 + keempat invariant SQL;
registry test memaku KETIADAAN nama state dan KETIADAAN kolom turunan tersimpan.

### A2 · gerbang hitung — ✅ `1947262`

`scripts/db-rebuild.sh` **dan** `.github/workflows/ci.yml` (judul step ikut
memuat angkanya) dinaikkan di commit yang SAMA. Ledger O48 di
`supabase/tests/rls_checks.sql` menerima `studios_select` dengan alasan tertulis.

### A3 · dokumen — ✅

PRD `docs/prd/CDPS_Module19_Creative_Daily_Ops.md` · `DECISIONS.md` (satu baris
`Decided` + satu baris `Open` `M19-SCS-ENGINE`) · `DATA_MODEL.md` (tiga entri) ·
`Build_Plan.md` §1 · `CLAUDE.md`. **`STATE_MACHINES.md` TIDAK disentuh** — nol
mesin adalah bagian desainnya.

---

## Bagian B — domain (B1–B2) · ✅ SELESAI

### B1 · `packages/domain/src/dailyops.ts` — ✅ `9140ec6`

`createSlot` · `updateSlot` · `enterActual` · `markUnavailable` ·
`removeUnavailability` · `daySchedule` · `getSlot` · `listUnavailability` ·
`sameDaySummary` · `listStudios`, plus predikat izin murni. **Nol
`statemachine.transition`** (nol mesin).

Bentuk hasil tulisan: `{ slot, peringatan: string[] }` — array **selalu ada**,
kosong berarti bersih (kunci yang hilang lebih berbahaya daripada null, O43).

Gerbang PIC **dipakai ulang**: `creative.validateCreativeStaff` di-export
alih-alih ditulis kedua kali.

### B2 · tes — ✅ `9140ec6` + `65c67d4`

`dailyops.test.ts` (48) + `dailyops-scope.rls.test.ts` (19). Suite domain penuh
**2298 lulus**, nol regresi.

**AC tercapai:** warn-not-block meng-assert pesan DAN keberadaan baris · matriks
peran termasuk `staff+od` berlapis · immutability dari koneksi service-role ·
recompute-from-log tiap angka turunan · satu tes memindai `performance.ts` untuk
menjaga D5.

---

## Bagian C — rute + layar (C1–C3) · ✅ SELESAI

### C1 · rute `apps/api` — ✅ `65c67d4`

Delapan rute di bawah `/api/v1/creative/`. Empat baris `DailyOps*Error` di
`http.ts` (ditempatkan alfabetis). Sembilan converter di `wire.ts` + dua
`to*Input`.

**Dua pintu terpisah** untuk satu baris: `PUT /slots/{id}` menulis RENCANA,
`POST /slots/{id}/actual` menulis HASIL.

### C2 · `web-internal` — ✅ `65c67d4`

`src/lib/dailyops.ts` + tiga halaman (`creative/schedule`,
`creative/schedule/rekap`, `creative/ketersediaan`), dijangkau dari `/creative`
(pola Daily Output). **Nol perubahan `nav.ts`** — menaruhnya di nav akan membuat
Creative satu-satunya divisi ber-sub-item dan memecah simetri yang dijaga
`nav.test.ts`.

### C3 · tiga penjaga — ✅ `65c67d4`

`route-parity` (`KNOWN_GAPS` tetap kosong) · `shape-parity` (**dua** titik
registrasi: `FE_FILES` + sembilan `WIRE_TO_FE`) · `wire.datecolumns`
(`DATE_BACKED_WIRE_KEYS` +3 kunci; `RFC3339_PENDING_DECISION` tetap kosong).

---

## Bagian D — separuh SCS · ✅ SELESAI (ketokan 2026-09-09, opsi b)

### D1 · antrean `SMO & Content Strategist` — ✅

`M19-SCS-ENGINE` diketok **opsi (b): mesin SENDIRI #34 `scs_task`**, pola
`internal_tasks`. Yang dibangun:

- **Migrasi** `20260928010000_m19_scs_task_engine.sql` (481 baris, tujuh bagian
  bernomor): prefix `SCS` · mesin #34 (SALINAN VERBATIM konfigurasi
  `brief_task`, minus state pembatalan ber-Service) · `scs_kategori` + seed 4
  baris · `scs_tasks` · RLS + `GRANT` keduanya · `trg_scs_tasks_beku` ·
  `trg_scs_tasks_hapus_hanya_todo`. Ledger O48 menerima `scs_kategori_select`
  dengan alasan tertulis.
- **Gerbang hitung** dinaikkan di `scripts/db-rebuild.sh` **DAN**
  `.github/workflows/ci.yml` di commit yang SAMA: **155 · 43 · 34 · 73**.
- **`packages/core/src/ident.ts`** — `PREFIXES.SCS`. Nol berkas kosakata baru:
  taksonomi Kategori adalah DATA (tabel), dan nama state di-RE-EXPORT dari
  `task.ts` alih-alih dituliskan kedua kali.
- **`packages/domain/src/scs.ts`** — `createScsTask`/`updateScsTask`/
  `deleteScsTask` · delapan transisi lewat `sm_transition` · `queueScsTasks` ·
  `scsTaskMetrics` (memanggil `task.computeMetrics()`) · `scsPicSummary` ·
  `listKategori`/`createKategori`/`updateKategori`, plus predikat izin murni.
- **Enam rute** `/api/v1/creative/scs/**` + 6 converter `wire.ts` + 2 `to*Input`
  + 4 baris `Scs*Error` di `http.ts` (ditempatkan alfabetis).
- **Tiga layar** `/creative/scs`, `/creative/scs/rekap`, `/creative/scs/kategori`
  + `web-internal/src/lib/scs.ts`. **Nol perubahan `nav.ts`** — dijangkau dari
  `/creative`, pola Daily Output.
- **Tes:** `scs.registry.test.ts` (17) · `scs.test.ts` (41) ·
  `scs-scope.rls.test.ts` (14) · `web-internal/src/lib/scs.test.ts` (7).

**AC tercapai:** himpunan state DAN edge mesin #34 dibandingkan dengan
`brief_task` (bukan dihitung) · `client_id` nullable dipaku sebagai KEPUTUSAN ·
Kategori standing ⇒ Speed Score `N/A` bukan `0%` · warn/beku/hapus ditegakkan
DUA kali (domain + trigger, diuji dari koneksi service-role) · matriks peran
termasuk `staff+od` berlapis · recompute-from-log tiap angka turunan · satu tes
memindai `performance.ts` untuk menjaga penundaan KPI M14.

**Yang TIDAK dibangun, dan sebabnya bukan kelalaian:**
- **21 nama Kategori sisanya + 8 label Sub Type.** Dokumen sumbernya
  (`CDPS_GapAnalysis_LeaderVideo_CreativeDailyOps.md`) tidak ada di repo maupun
  di Drive. Taksonomi karena itu dibuat ADMIN-MANAGED (`scs_kategori`, layar
  `/creative/scs/kategori`) dan seed-nya hanya empat baris yang terbukti di
  sumber — lihat `DECISIONS.md` `M19-SCS-KATEGORI-DATA`. **Butuh pemilik:** isi
  lewat layar (nol migrasi), atau kirim daftarnya untuk di-seed sekaligus.
- **Pola "Task Additional" (Gap I).** Detailnya hanya ada di dokumen yang sama.
  Tidak ditebak.
- **State pembatalan.** Nama barunya butuh ketokan; penggantinya hari ini adalah
  DELETE yang dibatasi `[To Do]`.

### D2 · jurnal koordinasi Content Creator (Gap H-1) — ✅

Ketokan 2026-09-09: **"jalan rekomendasi"** ⇒ ia satu **Kategori** di dalam
modul SCS, bukan entitas ketiga. Direalisasikan sebagai baris `scs_kategori`
**`KOORDINASI`, `is_standing = true`, nol SLA**. Nol tabel, nol prefix, nol
mesin baru untuk butir ini. Hak tulis kalendernya sudah ada sejak PR #334.

### D3 · KPI Profile M14 untuk peran gabungan — ⏸️ TETAP DITUNDA

Ketokan 2026-09-09: **"ditunda dengan sengaja"**. Alasan berangkanya di PRD §5.5
dan `DECISIONS.md`: 47,5% bobot profil "Creative" secara struktural nol untuk
peran ini, dan M14 Rule 6 meredistribusinya sampai Speed Score jadi ~54% seluruh
skor orang itu. Skor yang absen jujur; skor yang salah dipakai di review
kinerja. Dijaga tes yang memindai `performance.ts`. Revisit sesudah 2–3 bulan
data Kategori nyata, lalu Output Quantity diukur sebagai *baris Kategori selesai
vs target periode* — bukan Approved Assets.

---

## Verifikasi (semua tiket)

```bash
pg_ctlcluster 16 main start && pg_isready
export DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/cdps
make db-rebuild                              # 155 · 43 · 34 · 73 + 4 invariant
make test-core test-db test-domain test-api  # test-domain SENDIRIAN
npx vitest run --root web-internal           # TIDAK tercakup `make test`
make typecheck && make lint
```

Patokan jumlah tes yang **jalan** (bukan "0 failed") sesudah separuh SCS:
`core 985 · db 98 · domain 2355 · apps/api 496 · web-internal 736`. Kalau `db`
melaporkan 0, `DATABASE_URL` tidak sampai dan seluruh tes DB/RLS di-skip
diam-diam sementara `make test` tetap lapor hijau.

Lint: **3 error + 61 warning, identik dengan baseline** — ketiganya pre-existing
(`admin/employees`, `performance/page.tsx`), nol tambahan dari M19.

## Deviasi PRD — lihat `docs/DECISIONS.md`

1. Draft PRD §5.8 menulis gate `149 → 153`; angka live adalah **150 → 153**
   (FS-6 `master_service_duration_options` mendarat sesudah M18).
2. Draft PRD §6-item-3 menulis "tambahkan `smo_content_strategist` ke
   `role_mappings`"; tabel itu tidak punya kolom nama-peran (`UNIQUE (divisi,
   jabatan)` → `(division, level)`, `level` hanya `staff|lead`). Ketokan pemilik:
   peran itu duduk di bawah divisi Creative.
3. Draft PRD menamai kolom `pic_user_id`/`user_id` "ref User"; tidak ada entitas
   User di CDPS — yang ada `employees.employee_id`. Dipakai `assigned_pic` /
   `employee_id`, pola M7/M18.
4. Draft PRD §5.4 memesan mesin #34 sambil Rule 5 memasukkan SCS ke engine M12.
   Dicabut ke §12 sebagai pertanyaan terbuka.

## Deviasi tambahan — separuh SCS

5. Draft PRD §12 menyebut "taksonomi 24 Kategori + 8 Sub Type"; dokumen
   sumbernya tidak ada di repo maupun Drive, jadi taksonomi dibuat
   admin-managed dan hanya empat Kategori yang terbukti yang di-seed
   (`DECISIONS.md` `M19-SCS-KATEGORI-DATA`).
6. Draft §5.4 memesan mesin #34 sambil Rule 5 memasukkan SCS ke engine M12.
   Keduanya dipenuhi: mesin #34 ADALAH konfigurasi engine M12, disalin verbatim
   di bawah namanya sendiri (PRD §12.1).
7. Draft menyebut "Support-VG cross-link"; direalisasikan sebagai
   `scs_tasks.mendukung_divisi` (FK `division_registry`), bukan tautan ke
   `briefs` — alasannya di PRD §13 Rule 6 dan `DECISIONS.md` 2026-09-09.
