# Kinerja Sales (M0 §7.1) + Renewal — Rencana

## Context

**Permintaan.** Head of Sales (Cena) mengirim
[`dashboard sales yang cena butuhin`](https://docs.google.com/document/d/1JnReZmoueTyQDL_lPMdjFaXy4WHYKewSqN04cwRLSOQ/edit):
jumlah klien + omzet semua sales difilter per sales / per bulan / all periode;
data lead per sumber (scouting, sosmed, iklan) dengan filter campaign; poin OKR;
rekap tahunan per sales.

Isi gambarnya tidak terbaca lewat ekstraksi teks, tapi **spreadsheet sumbernya
berhasil dibaca** — link-nya sudah tercatat di
`docs/handoff/WAVE1_EXTERNAL_REQUESTS.md` sejak 2026-07-10, waktu itu tertahan
karena environment belum bisa membuka `docs.google.com` (`DECISIONS.md` O6). Jadi
layout kolom di §3 **bukan tebakan** — verbatim dari sheet yang dipakai tim.

**Kenapa perlu dibangun.** Bukan fitur di luar PRD; ini bagian M0 yang tidak
pernah ditiketkan (nol hit di 11 berkas `docs/backlog/`):

- `CDPS_Module0_Sales.md` §7.1 — Head/SPV Sales berhak atas *"sales analytics
  dashboard + monthly achievement vs OKR"*; OD *"inputs/manages Sales OKR"*.
- `CDPS_Module0_Sales.md` §8 — north-star *"closing rate + deal-cycle duration per
  salesperson (from immutable timestamps)"*; leading indicator *qualified rate per
  source*, *contested-lead win rate*.
- `CDPS_Module1_Leads_Database.md` §7 — Sales Lead/Head: *"Dashboard over all sales
  attempts; monitor contested leads + win/loss; closing-skill leaderboard"*.

**Outcome.** Head/SPV Sales, OD, Director membuka satu halaman di CDPS dan
mendapat angka yang selama ini disusun manual di spreadsheet — dihitung ulang
dari log immutable (house rule #3/#4), jadi tidak bisa dikarang.

---

## 1. Kondisi repo

M0–M15 selesai & produksi. M16/M17 fase 0–4 merge ke `main` (PR #247) dan sudah
di-push live ke `CDPS SG` (PR #248). Gate live: **128 tabel / 36 prefix / 29 state
machine / 65 notif event**. Handoff tertinggi:
`docs/handoff/HANDOFF_M16_SELESAI_20260829.md`.

Transaksional Sales lengkap: `sales.ts` (pricing MSL v2, komisi, negosiasi
berversi, closing + alokasi Σ=100% basis points maks 5 sales), `leads.ts` (dedup
v2, Pool/claim, contest), `activity.ts` (`ACT-` append-only + `effortCounts`),
`finance.ts` (`commissionAchievement`), `contract.ts` + tabel `contracts` (`CTR-`).
Halaman: `/sales`, `/sales/[id]`, `/sales/kalkulator`, `/leads`, `/clients/[id]`.

**Gap:**
1. **Nol fungsi agregasi.** `sales.ts`/`leads.ts` hanya read baris. Tidak ada
   closing rate, deal cycle, win rate, leaderboard. Satu-satunya route di bawah
   `/api/v1/sales/` adalah `quote-preview`.
2. **M14 sengaja tidak mencakup Sales** (`performance.ts:43-53`).
3. **Target/OKR Sales tidak punya rumah** — tidak ada entitas OKR di `DATA_MODEL.md`.
4. **Tidak ada jalur renewal / cross-sell** — §4.

---

## 2. 🔴 Blocker: RLS memutus Head Sales dari data timnya

Harus lebih dulu; kalau tidak, dashboard-nya diam-diam salah.

Pola repo: tiap kali Lead sebuah divisi butuh baca se-divisi, sebuah migrasi
menambah arm `jwt_is_lead() AND jwt_division() = '<Divisi>'`. Finance dapat
(baseline), Account dua kali, `prospect_activities` dapat arm Sales-lead-nya di
`20260806050000` — komentarnya verbatim: *"Head Sales membaca effort seluruh
timnya, yang justru alasan fitur ini diminta."*

**Sales tidak pernah dapat arm itu untuk tabel intinya:**

| Policy | Definisi terakhir | Arm Sales lead? |
|---|---|---|
| `leads_select` | `20260729031525:61` | ✅ ada |
| `prospect_activities_select` | `20260806050000:85` | ✅ ada |
| **`prospect_attempts_select`** | `20260723064438:241` | ❌ **tidak ada arm lead sama sekali** |
| **`clients_select`** | `20260805030100:54` | ❌ hanya `jwt_division()='Account'` |
| `transactions_select` / `installments_select` | baseline `:268`/`:273` | ❌ Sales hanya lewat `jwt_owns_client`/`jwt_owns_transaction` (cocok `employee_id`, bukan divisi) |

Head Sales yang membaca lewat `readAsActor` (RLS aktif) **hanya melihat baris
miliknya sendiri** — dashboard hijau, angka salah, tanpa error. Persis kelas cacat
yang sudah dua kali menggigit repo ini (`20260805060000`, lalu `20260806050000`),
dan melanggar CLAUDE.md #6 + `PERMISSIONS.md` §M0 yang sudah menjanjikannya.

Perbaiki RLS-nya (bukan bypass service-role), ikut pola tiga divisi lain. Ini
mengubah apa yang Head Sales lihat di `/sales` dan `/clients` yang sudah ada — ke
arah yang CLAUDE.md #6 sudah janjikan, jadi **perbaikan cacat, bukan pelebaran
hak**. Wajib satu entri `DECISIONS.md`.

---

## 3. Peta kolom sheet → data CDPS

Sumber: `Dashboard sales` (`1ZeRvOvtW6rTgP0tK7B-N3ziRTxQEUgKMZ2wVMDyEtGs`) +
`Rekapan input sales` (`1KtN_vAo1U6hK9r3aFl45fMzezL7sy38cm0uA_3NQoIo`).
Sheet ketiga (`19pfVwm…`) **tidak bisa diakses** ("Requested entity was not
found") — minta dibagikan ulang kalau isinya penting.

View: **1** REPORT ACTIVITY AND CLOSING (satu baris per sales) · **2** FILTER BY
NAME (satu sales, baris = Year-Month) · **3** DASHBOARD LEAD (filter bulan/tahun/
staff/campaign) · **4** target/OKR (`omzet bulan lalu | bulan ini | Kenaikan % |
Target perbulan | Sisa Target Bulan | per Minggu | per Hari`; target tahunan juga,
Cena Rp1.400.000.000) · **5** rekap tahunan per sales per tanggal masuk lead.

| Kolom sheet | Sumber CDPS | Putusan |
|---|---|---|
| Chat Pagi / Chat Total / Sisa Chat / Blaster / Jumlah Respon / Call | — | ❌ **tidak dibuat** |
| **Scouting** | `count(leads)` di mana `source='Scouting'` dan `created_by`=sales itu | ✅ |
| **Contacted** | transisi `->Contacted` di `audit_log` | ✅ metrik effort tim |
| Follow Up / Visit / Online Meet | `prospect_activities.activity_type` | ✅ (hanya sejak Qualified — batas yang memang ada di `ACTIVITY_ALLOWED_STATUSES`) |
| Jml Klien Closing, Result Nominal Closing | `clients` × `client_sales_allocations` × `transactions` | ✅ tertimbang alokasi (angka pecahan di sheet = ini) |
| Komisi | `finance.commissionAchievement()` | ✅ kontrak vs diakui (M0 §6 Rule 9) |
| % dari bulan sebelumnya | turunan dua periode | ✅ |
| Data lead per sumber / campaign | `leads.source`, `origin_campaign_id` | ✅ |
| ~~Lead Seller / Lead Affiliator~~ | `prospect_attempts.status` | ✅ **pakai istilah yang sudah ada: Qualified Leads / Non-Qualified.** Istilah "Seller"/"Affiliator" **tidak diperkenalkan** di kode maupun UI. Rincian alasan dari `prospect_attempt_nq_reasons` |
| **Level Sales (Senior/Junior)** | `employees.jabatan` (sync HRIS) | ✅ §3a |
| **Baru / Perpanjangan / Cross Sell** | — | 🔨 dibangun, §4 |
| Tiering T1–T5 | — | ❓ pertanyaan terbuka (band performa, bukan jabatan) |

### 3a. Level Sales dari daftar karyawan — bisa

`supabase/seed/hris_department_jabatan_pairs.csv` (data HRIS riil, 39 karyawan)
sudah membedakan jabatan divisi SALES: `HEAD OF SALES JASA` (1, lead) ·
`SENIOR SALES JASA` (1) · `SALES JASA` (5) · `SALES` (1) · `ADMIN SALES` (1) ·
`CUSTOMER RELATION OFFICER` (1) — semuanya `staff` di `role_mappings_riil.csv`.

Jadi "Sales Senior / Junior" **tidak butuh field baru** — cukup tabel pemetaan
`jabatan → label level`, pola dual-home yang sudah dipakai `role_mappings` /
`division_registry` (tabel + konstanta TS + registry test).

**Dua caveat yang dicatat, bukan diabaikan:**
1. `jabatan` dimiliki HRIS, sync read-only — HRIS mengganti nama jabatan = label
   ikut berubah tanpa migrasi.
2. `employees` menyimpan jabatan **saat ini**, bukan riwayatnya. Sales yang naik
   jadi Senior bulan lalu akan tampil "Senior" untuk periode lama juga — untuk
   periode tertutup itu salah. **Rekomendasi: terima "level saat ini"**, catat
   batasannya di UI + `DECISIONS.md`. Snapshot per periode baru perlu kalau level
   dipakai untuk komisi/skor, yang belum.

---

## 4. Renewal & Cross-Sell — arah (a), disetujui pemilik

**Kenapa ini fitur, bukan label.** `sales.close()` (`sales.ts:1350`) **selalu
mencetak `CLI-` baru** — setiap closing melahirkan Client Record baru. Menjual
lagi ke klien yang sudah ada hari ini akan menghasilkan **klien duplikat**.

Yang sudah pas: `contracts` (`CTR-`) sudah berupa *kumpulan Service satu klien
dalam satu kesepakatan* dengan jendela tanggal. Jadi **perpanjangan = `CTR-` kedua
pada `CLI-` yang sama**, **cross-sell = `SVC-` baru di luar cakupan kontrak
berjalan**. Entitasnya ada; pintu masuknya yang tidak ada.

**Arah (a) — pintu dari Client Record** (keputusan pemilik): tombol "Perpanjangan
/ Cross Sell" di `/clients/[id]` → form penawaran (pakai ulang kalkulator MSL +
`previewQuote`) → jalur approval negosiasi yang sama → menulis `CTR-` + `SVC-` +
`TRX-` ke klien yang **sudah ada**. Nol `LEAD-`/`PRSP-` palsu, jadi metrik lead
dan closing-rate di dashboard tetap bersih.

### ⛔ Dua hal yang membuat (a) berhenti menunggu pekerjaan Account

1. **`canWriteContract` (`contract.ts:141`) hanya mengizinkan AM pemilik, Account
   lead, atau Director — Sales tidak boleh membuat kontrak sama sekali.**
   Membuka pintu untuk Sales = mengubah gate milik Account.
2. **Kontrak baru mewajibkan Strategi + Plan baru.** M6A Rule 2 = "exactly one
   active Strategi per Contract"; M6B B-02 = "n periode Plan = n bulan kontrak"
   (`contract.ts:351` `hasStrategi` adalah kaitnya). Jadi setiap perpanjangan
   memicu siklus Strategi/Plan — mesin yang sedang Anda perbaiki.

Karena itu Stream B dipecah di §6: bagian skema + read-model jalan sekarang,
pintunya berhenti di garis stop.

**Masih perlu keputusan pemilik sebelum R-03** (jangan ditafsirkan sendiri):
siapa dapat kredit alokasi pada perpanjangan (sales lama / yang memperpanjang /
dibagi), dan apakah aturan komisi perpanjangan sama dengan penjualan baru.

---

## 5. Stream A — Dashboard (jalan penuh, paralel dengan M16/M17)

### ⬥ S-01 — Perbaiki RLS scope Sales lead (blocker §2)

Migrasi `supabase/migrations/<ts>_rls_sales_lead_scope.sql`, ikuti bentuk
`20260805030100_rls_account_lead_client_scope.sql` (**baca header komentarnya
dulu** — menjelaskan kenapa arm-nya `jwt_is_lead() AND jwt_division()`):

- `prospect_attempts_select` — tambah `OR (jwt_is_lead() AND EXISTS (SELECT 1 FROM
  leads l WHERE l.id = prospect_attempts.lead_id AND l.origin_division =
  jwt_division()))`, sengaja dikembarkan dengan arm di
  `prospect_activities_select` (`20260806050000:93-97`) supaya attempt dan
  effort-nya tak pernah beda jawaban.
- `clients_select` — tambah `OR (jwt_is_lead() AND jwt_division() = 'Sales')` di
  sebelah arm `'Account'`. **Pertahankan semua arm lama** (Finance, Account lead,
  sales_pic / assigned_am / commission_pic / created_by).
- `transactions_select` + `installments_select` — tambah arm yang sama, sejajar
  arm `'Finance'`.
- `jwt_owns_lead` dipanggil ber-skema `private.` (dipindah oleh `20260727072443`);
  tanpa skema akan gagal di DB yang sudah di-harden.

Tes: tambah kasus di `packages/domain/src/reads_rls.test.ts` — Sales lead vs Sales
staff vs lead divisi lain, untuk keempat tabel.

### ⬥ S-02 — `sales_targets` (target/OKR)

```sql
CREATE TABLE sales_targets (
    salesperson_id varchar(64)   NOT NULL,
    period_start   date          NOT NULL,   -- tgl 1 bulan (WIB); 1 Jan = target tahunan
    period_kind    varchar(8)    NOT NULL,   -- 'bulan' | 'tahun'
    target_omzet   numeric(15,2) NOT NULL,
    updated_at     timestamptz   NOT NULL DEFAULT now(),
    updated_by     varchar(64)   NOT NULL,
    PRIMARY KEY (salesperson_id, period_start, period_kind)
);
```

- **Nol prefix baru** — kunci alami; preseden `plan_satuan` / `riset_awal` /
  `division_registry` (`DATA_MODEL.md` 25/29/45). Prefix tetap 36.
- Trigger `set_updated_at` (sudah ada, dipakai `perf_period_targets`).
- Bukan history immutable — config yang boleh direvisi, sama seperti
  `perf_period_targets`; perubahannya masuk `audit_log` lewat domain.
- RLS `SELECT`: `jwt_can_read_all() OR jwt_employee_id() = salesperson_id OR
  (jwt_is_lead() AND jwt_division() = 'Sales')`. Tulis lewat RPC/service-role +
  gate TS. **`GRANT SELECT TO authenticated` wajib** — tanpa itu `readAsActor`
  ditolak sebelum policy dievaluasi (jebakan tercatat di `DATA_MODEL.md` 44).

### ⬥ S-03 — `packages/domain/src/salesperf.ts` (baru)

File baru, bukan tambahan ke `sales.ts` (sudah 2098 baris; ini murni read-model —
pemisahan sama seperti `marketing.ts` vs `campaign.ts`).

**Template wajib dibaca dulu:** `marketing.ts` `metrics()` / `dashboard()` —
agregat per-aktor di bawah RLS, termasuk join `prospect_attempt_nq_reasons →
prospect_attempts → leads` (baris 424-429) yang langsung dipakai ulang untuk
breakdown Non-Qualified.

```ts
export interface PeriodFilter { from: string; to: string }   // YYYY-MM inklusif
export interface SalesPerfFilter {
  period: PeriodFilter | null;    // null = all periode
  salespersonId: string | null;   // null = semua sales
  source: string | null;          // salah satu leads.SOURCES
  campaignId: string | null;      // CMP-
}

export interface SalesPerfRow {
  salespersonId: string; nama: string; levelSales: string;   // §3a
  leadsRegistered: number; leadsScouting: number;
  contacted: number;                                          // effort tim
  qualified: number; nonQualified: number;                    // istilah kanonik
  nqBreakdown: Record<string, number>;
  negotiating: number; closedSuccess: number; closedLost: number;
  closingRatePct: number | null;    // null → render "—" (house rule #7)
  qualifiedRatePct: number | null;
  avgDealCycleDays: number | null;
  effortFollowUp: number; effortVisit: number; effortOnlineMeeting: number;
  klienBaru: string; klienPerpanjangan: string; klienCrossSell: string;  // §4, desimal
  klienCount: string;               // total tertimbang alokasi
  omzet: money.Money;
  komisiKontrak: money.Money; komisiDiakui: money.Money;
  targetOmzet: money.Money | null; pencapaianPct: number | null;
  sisaTarget: money.Money | null; sisaPerMinggu: money.Money | null; sisaPerHari: money.Money | null;
  momPct: number | null;
}
export interface SalesPerfMonthRow extends SalesPerfRow { period: string }
export interface LeadSourceRow {
  period: string; source: string; campaignId: string | null; campaignName: string | null;
  salespersonId: string | null; leads: number; qualified: number; nonQualified: number;
  closing: number; omzet: money.Money; nqBreakdown: Record<string, number>;
}

export function canViewSalesPerf(actor: Actor): boolean;
export function scopeFor(actor: Actor): { ownOnly: boolean } | null;
export async function bySalesperson(sql: Queryable, actor: Actor, f: SalesPerfFilter): Promise<SalesPerfRow[]>;
export async function byMonth(sql: Queryable, actor: Actor, f: SalesPerfFilter): Promise<SalesPerfMonthRow[]>;
export async function bySource(sql: Queryable, actor: Actor, f: SalesPerfFilter): Promise<LeadSourceRow[]>;
export async function listTargets(sql: Queryable, actor: Actor, periodStart: string): Promise<TargetRow[]>;
export async function setTarget(sql: Sql, actor: Actor, input: SetTargetInput): Promise<void>;
```

Derivasi (semua dihitung saat baca — house rule #4, nol kolom simpan):

| Angka | Sumber |
|---|---|
| leads terdaftar / scouting / per source / per campaign | `leads.created_by`, `.source`, `.origin_campaign_id`, `.created_at` |
| contacted / qualified / non-qualified / closed | `audit_log` `action LIKE 'transition:%->Contacted'` dst.; transisi pertama = jangkar |
| deal cycle | `audit_log` `->Contacted` pertama → `->Closed-Success`, per attempt |
| effort | `activity.effortCounts(attemptIds)` — **pakai ulang, jangan query baru** |
| jumlah klien (pecahan) | `Σ client_sales_allocations.basis_points / 10000` |
| omzet tertimbang | `money.proRata(transactions.total_agreed_value, basisPoints, 10000n)` |
| komisi | `finance.commissionAchievement(sql, trxId)` (M0 §6 Rule 9) |
| baru / perpanjangan / cross-sell | `contracts.jenis` (R-01) |
| level sales | `employees.jabatan` → tabel pemetaan (§3a) |
| sisa target per hari | `working_days_between()` (`20260813000000:69`) — Sen–Jum minus `hari_libur`; **hari kerja, bukan kalender** |
| bucket periode | `tz.period(t)` (WIB) |
| bagi nol | render `—`, jangan error (house rule #7) |

**Pakai ulang, jangan tulis ulang:** `core/money.ts` (`proRata`, `format`,
`parse`), `core/tz.ts` (`period`, `dateString`), `core/permission.ts`,
`domain/activity.ts` (`effortCounts`), `domain/finance.ts`
(`commissionAchievement`), `domain/leads.ts` (`SOURCES`, `leadListScope`).

### ⬥ S-04 — Route API

Di bawah `apps/api/src/app/api/v1/sales/` (mendampingi `quote-preview`):
`GET /sales/performance` `?from=&to=&salesperson=&source=&campaign=` (View 1) ·
`GET /sales/performance/monthly` (View 2 & 5) · `GET /sales/performance/sources`
(View 3) · `GET|PUT /sales/targets` (View 4; PUT: OD/Head/Director).

Handler = shell tipis: resolve actor dari klaim JWT → validasi → panggil domain,
lewat `readAsActor` (`apps/api/src/lib/db.ts:75`). Penerjemah wire
(`salesPerfRowToWire`, `leadSourceRowToWire`, `salesTargetToWire`) **hanya** di
`apps/api/src/lib/wire.ts` — route yang mengirim objek domain mentah = bug kelas
O43 (halaman blank walau 200). Kunci hilang lebih berbahaya daripada null: kirim
`null` eksplisit.

### ⬥ S-05 — UI

- Halaman baru `web-internal/src/app/(shell)/sales/kinerja/page.tsx`. Template:
  `(shell)/marketing/performance/page.tsx` (dashboard agregat + gate divisi) dan
  `(shell)/performance/page.tsx` (selector periode). Tab: **Per Sales** · **Per
  Bulan** · **Sumber Lead** · **Target**. Filter: periode (`from`–`to` atau "All
  Periode"), sales, source, campaign — pakai ulang `components/CampaignPicker.tsx`.
- Client lib `web-internal/src/lib/salesperf.ts` (pola `lib/marketing.ts`).
- `web-internal/src/lib/nav.ts` — tambah `{ href: '/sales/kinerja', label:
  'Kinerja Sales', access: ownedBy(SALES) }` di `ACQUISITION_LINKS`; `ownedBy`
  sudah memasukkan OD/Director (`nav.ts:85-87`). Perbarui `nav.test.ts`.
- **`/performance` (M14) tidak disentuh** — Sales tetap di luar cakupannya.
- IDR `Rp. X.XXX.XXX,00` lewat `lib/money.ts` `formatIDR`; bagi nol → `—`.

### Permission

| Peran | Lihat |
|---|---|
| Sales staff | barisnya sendiri saja (RLS + `scopeFor`) |
| Sales Lead/SPV | se-divisi — **butuh S-01**, kalau tidak diam-diam jadi "sendiri saja" |
| OD | read-only semua + tulis target (M0 §7.1) |
| Director | penuh |

OD-murni (`od && !director`) tidak menulis apa pun kecuali target.

---

## 6. Stream B — Renewal, dengan garis stop

### ✅ Jalan sekarang (aman, additive, tidak menyentuh Strategi/Plan)

- ⬥ **R-01** — Migrasi: `contracts.jenis` ∈ `baru`|`perpanjangan`|`cross_sell`
  (NOT NULL, default `baru`) + `contract_sebelumnya_id` nullable (rantai
  perpanjangan) + CHECK. Backfill semua kontrak yang ada sebagai `baru`.
  **Nol prefix baru** (`CTR-` sudah terdaftar), **nol perubahan FK**, tidak
  menyentuh `strategi`. Klasifikasi disimpan sekali di titik pembuatan kontrak
  (bukan angka turunan yang berubah-ubah); audit-nya di `audit_log`.
- ⬥ **R-02** — Read-model: `salesperf.ts` membaca `contracts.jenis` dan mengisi
  kolom Baru / Perpanjangan / Cross Sell (tertimbang alokasi). Read-only.
  Bergantung S-03.

### ⛔ GARIS STOP — berhenti di sini sampai pekerjaan Account selesai

- ⬥ **R-03** — Pintu renewal dari Client Record: membuka `canWriteContract`
  (`contract.ts:141`) untuk Sales PIC / Sales Lead, memfaktorkan bagian "buat
  CTR/SVC/TRX" dari `sales.close()` supaya satu aturan bukan dua, dan menangani
  Strategi + Plan yang wajib lahir bersama kontrak baru (M6A Rule 2, M6B B-02).
- ⬥ **R-04** — UI tombol di `/clients/[id]` + notifikasi.

**Alasan berhenti** (§4): R-03 mengubah gate milik Account **dan** setiap kontrak
baru mewajibkan siklus Strategi/Plan baru — persis mesin yang sedang diperbaiki.
Membangun di atasnya sekarang berarti membangun di atas kode yang sedang berubah.

**Prasyarat untuk melanjutkan R-03:** (1) pekerjaan Account Service mendarat di
`main`; (2) keputusan pemilik soal kredit alokasi + aturan komisi perpanjangan
(§4) tercatat di `DECISIONS.md`.

---

## 7. Paralelisasi dengan perbaikan M16/M17

**Stream A (S-01..S-05) + R-01/R-02: aman jalan paralel.** File intinya baru
semua (`salesperf.ts`, route `sales/performance*`, halaman `sales/kinerja`) dan
tidak bersinggungan dengan wilayah M16/M17 (`stage.ts`, `leadtime.ts`, `req.ts`,
`ads.ts`, `vendor.ts`, `livestream.ts`, halaman Ads/Permintaan, bobot
`performance.ts` LT-1).

**Titik gesek yang harus dijaga:**

| Berkas | Risiko | Mitigasi |
|---|---|---|
| **`clients_select` / policy RLS** | 🔴 **Tertinggi.** S-01 me-`DROP`/`CREATE` ulang `clients_select`, `prospect_attempts_select`, `transactions_select`, `installments_select`. **O61** (back-port migrasi hardening live-only) juga bergerak di wilayah RLS/GRANT. Yang di-apply terakhir menang — satu arm bisa hilang diam-diam | Sepakati: hanya SATU stream yang menyentuh policy ini. Kalau O61 dikerjakan bersamaan, S-01 harus rebase di atasnya, bukan sebaliknya |
| `docs/DECISIONS.md` | Sedang — dua stream menambah baris di puncak tabel yang sama | Konflik teks sepele; **jangan pernah menimpa baris lama**, selalu tambah baris baru bertanggal |
| `apps/api/src/lib/wire.ts` | Rendah — M16/17 juga menambah type Ads/Permintaan | Append di region berbeda |
| `web-internal/src/lib/nav.ts` | Rendah — satu baris masing-masing | — |
| Nama berkas migrasi | Rendah | Ambil timestamp saat menulis, jangan tanggal bulat |

**Catatan jujur:** `DECISIONS.md` 2026-08-29 mencatat keputusan proses pemilik
untuk **berhenti memecah kerja ke akun paralel** (konteks M16/M17; alasannya dua
sesi menafsirkan spec yang sama secara berbeda). Di sini risikonya lebih kecil —
dua spec berbeda, dua modul berbeda — tapi baris `clients_select` di tabel di atas
adalah satu hal yang benar-benar bisa merusak diam-diam.

---

## 8. Test (Definition of Done)

- **Permission per peran** untuk keempat route, termasuk OD/Director berlapis:
  Sales staff / Sales lead / Sales staff divisi lain / Marketing lead / OD /
  Director. Pola: `packages/domain/src/reads_rls.test.ts`.
- **RLS S-01**: Sales lead membaca attempt+klien+transaksi rekan setimnya; Sales
  staff tidak; lead divisi lain tidak. Ini tes yang membuktikan §2 tertutup.
- **Recompute-from-log**: `byMonth` untuk periode tertutup identik saat dipanggil
  dua kali, dan cocok dengan penjumlahan manual atas `audit_log`.
- **Money**: omzet tertimbang menjumlah persis ke `total_agreed_value` saat semua
  sales satu klien dijumlahkan (Σ basis_points = 10000); komisi diakui ≤ kontrak.
- **Bagi nol** → `—`, bukan error atau `NaN` (house rule #7).
- **Immutability**: tidak ada jalur mutasi ke `audit_log`/`prospect_activities`
  lewat route baru (semua GET kecuali PUT target).
- **BI messages**: `[anda tidak memiliki akses ke data ini]` untuk 403;
  `[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]` untuk PUT
  target tanpa nilai.
- **Route parity**: `apps/api/src/lib/route-parity.test.ts` — `KNOWN_GAPS` tetap kosong.
- **Fixture Alpha Digital** end-to-end tetap lulus.
- Jalankan `npm run test --workspaces --if-present` dari root — **jangan**
  `npx vitest run` dari root (melewati `fileParallelism: false`, ratusan
  false-failure; `RENCANA_INDUK_M16_M17.md` §5).

---

## 9. Dokumentasi

**`DECISIONS.md`** — baris baru bertanggal (jangan menimpa baris lama):
1. 🔴 RLS Sales lead scope hilang untuk `prospect_attempts` / `clients` /
   `transactions` / `installments`; melanggar CLAUDE.md #6 + PERMISSIONS.md §M0;
   diperbaiki mengikuti preseden Finance/Account. **Konsekuensi: Head Sales kini
   melihat data se-divisi di `/sales` dan `/clients`.**
2. Entitas `sales_targets` — rumah Sales OKR yang M0 §7.1 sebut tapi tak pernah
   dispesifikasikan; nol prefix baru; kenapa bukan `perf_period_targets`
   (menghindari menarik Sales ke kerangka skor M14 sebelum bobotnya
   ditandatangani — sejajar guardrail X-12 / LT-1).
3. Cakupan: metrik chat/blaster/respon/call **tidak dibuat**; istilah **Qualified
   / Non-Qualified dipertahankan** (bukan Seller/Affiliator); Level Sales
   diturunkan dari `employees.jabatan` dengan batasan "level saat ini".
4. 🔶 **Deviasi PRD M0 §6** — renewal arah (a): closing tidak lagi selalu mencetak
   `CLI-` baru; pintu dari Client Record. Catat juga garis stop §6 dan alasannya.

**`DECISIONS.md` §Open** — pertanyaan terbuka (CLAUDE.md: kalau PRD ambigu, STOP
dan catat, jangan tafsirkan sendiri):
- **Tiering T1–T5** — band performa, tidak ada aturannya di PRD mana pun. Butuh
  definisi dari Cena.
- **Kredit alokasi + aturan komisi pada perpanjangan** — prasyarat R-03.
- **Level per periode** — terima "level saat ini" atau snapshot per periode.
- Sheet `19pfVwm…` tidak bisa diakses; minta dibagikan ulang.

**`DATA_MODEL.md`** — baris `sales_targets` (entitas, PK, pemilik modul, "Nol
prefix baru"); perbarui baris `contracts` dengan `jenis` + `contract_sebelumnya_id`.

**`docs/backlog/SALESPERF_BACKLOG.md`** (baru) — tiket S-01..S-05 + R-01..R-04
dengan garis stop ditandai eksplisit; pola `LEADTIME_BACKLOG.md`: nama migrasi +
nama test persis per klaim, karena itulah satu-satunya sumber status tiket yang
otoritatif di repo ini.

**`PERMISSIONS.md`** — baris M0 diperbarui menyebut cakupan baca Sales lead
setelah S-01.

---

## 10. Verifikasi

1. `npm run test --workspaces --if-present` dari root — hijau, termasuk
   `route-parity.test.ts` dengan `KNOWN_GAPS` kosong.
2. `scripts/db-rebuild.sh` untuk DB lokal (**jangan** `psql -f` — itulah yang
   melahirkan drift O38), lalu jalankan tes RLS S-01: satu akun Sales lead dan
   satu Sales staff; buktikan lead melihat baris rekan setimnya dan staff tidak.
3. Jalankan `/sales/kinerja` lokal (skill `run`) sebagai tiga peran (Sales staff /
   Sales lead / Director); bandingkan angka satu bulan tertutup dengan
   penjumlahan manual atas `audit_log` + `client_sales_allocations`.
4. Setelah merge ke `main` — dan **hanya** setelah itu (aturan O38: live tidak
   boleh mendahului `main`) — `apply_migration` ke `CDPS SG` satu per satu urut
   nama berkas, lalu **wajib** `mcp__Supabase__get_advisors` (preseden O61 +
   temuan `stage_overdue_tick`). Gate pasca-push Stream A + R-01: tabel **129**,
   entity_prefix **36** (tidak berubah), sm_machines **29**, notif_events **65**.

---

## 11. Yang tidak dikerjakan

| Item | Status |
|---|---|
| Chat Pagi/Total/Sisa, Blaster, Jumlah Respon, Call | ❌ tidak dibuat |
| R-03 / R-04 (pintu renewal + UI) | ⛔ berhenti sampai pekerjaan Account mendarat + keputusan alokasi/komisi |
| Tiering T1–T5 | ❓ pertanyaan terbuka ke Cena |
| Role type `Sales` di M14 + skor `PERF-` | ⏸ setelah S-03 mendarat, daftarkan bobot 0 mengikuti preseden LT-32/LT-33 (guardrail X-12/LT-1: jangan mengarang bobot) |
| Snapshot Level Sales per periode | ⏸ baru perlu kalau level dipakai untuk komisi/skor |
