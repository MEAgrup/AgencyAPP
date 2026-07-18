# W3 — Runbook UAT Wave 3 (gate exit Wave 3)

> Prasyarat & data: jalankan di stack UAT mock-HRIS-data-riil setelah boot order
> `backend/testdata/import_samples/README.md` §"UAT login gate" dan setelah gate exit
> Wave 2 GO (DECISIONS 2026-07-17). Mengikuti pola W1-20/W2: setiap langkah mencantumkan
> **aktor**, **aksi** (endpoint), dan **hasil yang diverifikasi** (status persis dalam
> `[...]`, pesan BI persis, audit). Kegagalan di langkah mana pun = no-go, catat di
> `docs/DECISIONS.md`. Semua status & pesan BI di runbook ini disalin persis dari kode
> (`internal/module3_campaign`, `module2_marketing`, `module1_leads`, `module11_board`,
> `module13_health`, `module14_performance`, `module15_portal`, `core/statemachine/
> config.go`) atau entri Decided Wave 3 (2026-07-17/18) di `docs/DECISIONS.md` — rujukan
> `file:baris` dicantumkan untuk pesan kunci.
>
> **Cakupan Wave 3 = M2, M3, M11, M13, M14, M15-C1.** **M15-C2 Client Portal DITUNDA**
> (Decided 2026-07-18) — TIDAK di-UAT (lihat langkah 42). Klaster diurut sesuai dependensi
> (M3 core → M3 linkage → M2 → CAT-1 → M11 → M13 → M14 → M15-C1), bukan urutan epic.
>
> Gap aktor riil (**divisi Marketing tanpa lead**: roster HR punya 2 staf Marketing riil
> tetapi TANPA lead) ditutup dengan **fixture UAT berlabel** mengikuti preseden **O34**
> (Wave 2): baris `UATMKT0001` di `employees_uat.csv` + mapping di `role_mappings_uat.csv`.
> Titik bertanda ⚠ = langkah yang memakai fixture Marketing-lead (bukan aktor riil).
> Fixture Wave 2 (Director O26, Finance O33, KOL/Creative-lead/Ads-lead/LS O34) hanya
> muncul di prasyarat login lintas-peran (bagian A).

## Roster aktor UAT (riil kecuali ditandai fixture)

| Peran runbook | Akun | Riil/fixture |
|---|---|---|
| Director (layered) | `UATDIR0001` / `UATDIR0002` | **fixture O26** (ganti baris riil Yohan & Nerissa) |
| OD (layered, read-only) | OKFA RENDI WIRATAMA (`2409230432`, HRGA) | riil |
| Marketing Staff (A) — owner campaign | INSAN FAZRUL RAMADHAN (`2411250460`, SEO CONTENT WRITER) | riil |
| Marketing Staff (B) — target reassign / co-owner | TRI NURIF HADI MARIF (`2411250461`, PUBLIC RELATION) | riil |
| Marketing Lead (SPV) | `UATMKT0001` (HEAD OF BUSINESS DEVELOPMENT → Marketing lead) | ⚠ **fixture O34** (tidak ada lead Marketing riil) |
| Sales Staff (register lead ber-campaign) | SAFFIRA MARWAH DESINTA (`2404160367`) | riil (email uppercase) |
| Account Lead (Head/SPV) | YULIANTI HANDAYANI (`2305100275`, Head of Account) | riil |
| AM (Account staff, owning) | SYIFA NUR ALYA PUTRI (`2412090425`, CRO) | riil; alt SEPRI (`2203220082`) |
| Creative Staff (PIC Asset) | MOCHAMAD ARIF (`2111040039`, Graphic) | riil |
| Creative Lead | `UATCRE0001` | ⚠ **fixture O34** |
| Ads Staff (Advertiser, scored M14) | KENNY (`2206060100`) | riil |
| Ads Lead (SPV Ads) | `UATADS0001` | ⚠ **fixture O34** |
| KOL Staff/Lead | `UATKOL0001` / `UATKOL0002` | ⚠ **fixture O34** |
| Live Stream Staff | `UATLSS0001` | ⚠ **fixture O34** |
| Finance Staff / Head | `UATFIN0001` / `UATFIN0002` | **fixture O33** |

Fixture `UATMKT0001` (`employees_uat.csv` + mapping `role_mappings_uat.csv`) UAT-only,
berlabel eksplisit FIXTURE; aktor Marketing-lead produksi = keputusan Yohan/HR (preseden
Open O34, kini meluas ke divisi Marketing Wave 3). ⚠ pada langkah = peran dieksekusi
fixture — bawa ke catatan go/no-go. **Catatan otoritas** (dari kode `campaign.go:249`
`canReassign = a.IsLead(Marketing)` yang true untuk Director): reassign M3-OA-6 SEBENARNYA
bisa dijalankan Director tanpa fixture; fixture Marketing-lead tetap diperlukan untuk
menguji cabang izin yang KHAS-lead dan berbeda dari OD/Director — (a) visibilitas
"lead melihat SEMUA campaign" M3 §5 (`read.go:53`), dan (b) uji negatif M2 §5 Rule 3
"lead non-owner READ-ONLY atas record" (`marketing.go:246`). Tanpa lead riil, kedua cabang
itu tak terjangkau dengan level peran yang benar.

---

## A. Persiapan & login lintas-peran

1. **Dev** — boot order UAT (semua dari `backend/`, README §"UAT login gate"):
   `migrate up` (migrasi **0001–0036** bersih); `cmd/mockhris` + `cmd/cdps` dengan
   `CDPS_SEED_CSV=…/employees_uat.csv` (auto-sync **43 baris** = 42 Wave 2 + fixture Wave 3
   `UATMKT0001`); `rolemapseed --role-csv …/role_mappings_uat.csv --layered-csv
   …/layered_roles_uat.csv --apply` (**31 mapping** = 30 + `BUSINESS DEVELOPMENT,HEAD OF
   BUSINESS DEVELOPMENT → Marketing,lead` + 3 layered); `mslseed --actor 2101180004
   --apply`. ✔ sync `43/43` bersih; rolemapseed idempoten; `UATMKT0001` resolve ke
   `Marketing/lead`; OD OKFA `od:true`; fixture Director `director:true`.
2. **Semua peran** — login lintas peran Wave 3 (Director fixture, OD OKFA, Marketing staf
   INSAN & TRI, Marketing lead `UATMKT0001`, Sales SAFFIRA, Account Lead YULIANTI, AM
   SYIFA, Creative ARIF, Ads KENNY) email riil + `rahasia123`. ✔ login OK, role resolution
   benar; password salah → `[email atau password salah]`; email luar roster ditolak; **OD
   terbukti read-only** (semua write Wave 3 → `[anda tidak memiliki akses ke data ini]`);
   HRIS mati → `[sistem HRIS tidak dapat dihubungi, coba beberapa saat lagi]`.
3. **Dev/precondition** — pastikan hasil-akhir walk W2 tersedia (rantai M0→M5→M6→M12/M7/M8
   penuh): ≥1 klien released dengan `assigned_am_id` (SYIFA), ≥1 Service `[Briefed]`/
   `[In Execution]` ber-Brief divisi Ads & Creative, ≥1 Asset Creative, ≥1 ADC dengan
   metric entries. ✔ dicetak via API (atau precondition dari W2 report). Data ini adalah
   basis M11 (Dependency Brief↔Brief), M13 (Health), M14 (Performance) dan M15 (agregasi).

## B. M3-C1 — Campaign core (create + lifecycle + ownership + visibilitas)

4. **Marketing Staff (INSAN)** — `POST /api/v1/marketing/campaigns` dengan field WAJIB
   tak lengkap (Name/Channel/Start Date kosong, ATAU Online=Offline=false) ⇒ ditolak
   `[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]` (`campaign.go:59`,
   §3 Rule 2). ✔ **tidak ada `CMP-` yang di-mint** (sequence tak dikonsumsi — house rule 1).
   Rute di bawah prefix `/api/v1/marketing/campaigns` (deviasi disetujui: `/campaigns/{id}`
   milik frozen M8 ADC, Decided W3-M3-C1).
5. **Marketing Staff (INSAN)** — create valid (Name, Channel free-text mis. `TikTok Ads`,
   Online=true, Start Date). ✔ `CMP-YYYYMM-NNNN` lahir status **`Draft`** (label TANPA
   bracket persis engine, `config.go:124`); Owner = INSAN (creator); audit `create`.
   Negatif: **staf divisi lain** (mis. AM SYIFA) create ⇒ `[anda tidak memiliki akses ke
   data ini]` (`campaign.go:66`, gate `canCreate` §6.1).
6. **Marketing Staff (INSAN)** — lifecycle via engine `POST .../{id}/transition`:
   `Draft→Active` OK; `Active→Paused` OK; `Paused→Active` OK; `Active→Closed` ⇒ status
   `Closed` **dan** `end_date` ter-set ke tanggal WIB se-transaksi + audit `set_end_date`
   (kolom data, bukan status — `lifecycle.go:49`); `Closed→Archived` OK (terminal §3).
   Negatif: edge ilegal (mis. `Draft→Closed`, `Active→Archived`, `Paused→Draft`) ⇒
   `[transisi status tidak diizinkan]` (engine default, `statemachine.go:25`); status
   HANYA berubah lewat engine (house rule 2).
7. **Marketing Lead (`UATMKT0001`) / Director** — reassign ownership `POST
   .../{id}/reassign` ke **TRI** (staff Marketing aktif, §5 Rule 1). ✔ `owner_employee_id`
   = TRI; audit `owner_reassigned` before→after (`campaign.go:187`, M3-OA-6, history
   immutable). ⚠ aktor lead = fixture O34 (Director riil juga sah — `canReassign`
   `campaign.go:249`). Negatif: **Marketing staff** (INSAN owner) reassign ⇒ `[anda tidak
   memiliki akses ke data ini]` (`canReassign` false untuk staff); target **bukan
   staff Marketing aktif** (mis. AM SYIFA, atau lead `UATMKT0001` yang level≠staff) ⇒
   `[data tidak ditemukan]` (`validateOwnerCandidate` `campaign.go:265`).
8. **Visibilitas §5** (`GET .../campaigns` list + `GET .../campaigns/{id}`):
   **Marketing staff (INSAN)** melihat HANYA campaign miliknya (own-only, `read.go:55`);
   **Marketing staff (TRI)** melihat campaign yang kini owner-nya TRI (pasca-reassign);
   ⚠ **Marketing Lead (`UATMKT0001`)** melihat **SEMUA** campaign lintas staff
   (`CanReadDivision(Marketing)`, `read.go:54`); **OD** melihat semua (read-only);
   **Director** melihat semua (full). Negatif: **divisi lain** (AM SYIFA) list ⇒
   `[anda tidak memiliki akses ke data ini]` (`read.go:57`).

## C. M3-C2 — Linkage M1/M0 (O13 gate, Source auto, Origin stamp, rollup)

9. **Marketing Staff (INSAN)** — siapkan campaign uji O13: satu `CMP-` di status `Draft`
   (mis. dari langkah 5, Channel `TikTok Ads`), satu di `Paused`, satu di `Closed`, satu
   di `Archived`. **Marketing Staff/Lead** — `POST /api/v1/leads/bulk` (pintu import
   Marketing §3) dengan `campaign_id` = campaign `Draft`. ✔ **O13 auto-activate**:
   campaign `Draft→Active` via engine + audit `campaign_auto_activated`
   (`campaign_link.go:129`, trigger `lead_intake`), import JALAN (bukan blokir). Ulangi
   dengan campaign `Paused` ⇒ auto-activate `Paused→Active` + audit. (O13 = "tim lupa
   menyalakan campaign", Decided 2026-07-09 / W3-M3-C2.)
10. **Marketing Staff/Lead** — `POST /api/v1/leads/bulk` `campaign_id` = campaign
    **`Closed`**, lalu **`Archived`** ⇒ **DIBLOKIR** `[campaign belum/tidak aktif, lead
    tidak bisa diimport]` (`campaign_link.go:55`, verbatim STATE_MACHINES §2 — mesin
    campaign tak punya edge dari Closed/Archived ke Active). ✔ tidak ada lead lahir; O13
    hanya membuka campaign yang lupa dinyalakan, bukan membuka kembali campaign tertutup.
    Negatif: `campaign_id` tak dikenal ⇒ `[data tidak ditemukan]` (`campaign_link.go:59`).
11. **Marketing Staff/Lead** — verifikasi **Source auto dari Channel** pada lead hasil
    import langkah 9: campaign Channel `TikTok Ads` ⇒ lead `source` = `Leads - Iklan`
    (peta incremental `campaign_link.go:72`, M3 §2 — campaign-derived Source MENANG atas
    Source baris); Channel unmapped ⇒ Source = string Channel apa adanya (VARCHAR bebas,
    M3-OA-2). ✔ verifikasi **Origin/Last-Touch (M1 §5)**: lead BARU lahir ber-campaign ⇒
    `origin_campaign_id` = `last_touch_campaign_id` = campaign (origin IMMUTABLE selamanya);
    sentuhan campaign berbeda pada lead existing (reopen/join/block-Pool) ⇒ update
    `last_touch` saja + audit `last_touch_updated` (`campaign_link.go:146`).
12. **Sales Staff (SAFFIRA) → closing → Origin stamp M0** — jalankan (atau rujuk dari W2
    chain) satu lead ber-`origin_campaign_id` sampai closing. ✔ saat closing, `CLI-`
    mewarisi `origin_campaign_id` (stamp permanen ke Client, `sales.go`/`closing.go`;
    sudah terpasang sejak fondasi 0002 — Decided W3-M3-C2 butir 1). Divergensi sah:
    Origin (permanen) vs Last-Touch (M2 Attributed Sales) — by design (M2-OA-2).
13. **Marketing staff (owner) / lead / OD / Director** — `GET
    /api/v1/marketing/campaigns/{id}/rollup` (gate visibilitas = Get, `rollup.go:51`).
    ✔ empat angka **derived on read** (`rollup.go`): `leads_generated` (COUNT Origin),
    `real_leads` (COUNT DISTINCT lead dengan attempt ber-audit
    `transition:Contacted->Qualified`), `clients_won` (COUNT Origin), `total_value_won`
    (Σ `total_agreed_value`, format `Rp. X.XXX.XXX,00`). Window 3 bulan M3-OA-4 SENGAJA
    belum di rollup (lineage Origin permanen; window = metrik kredit M2 §D). Negatif:
    campaign tak terlihat ⇒ `[anda tidak memiliki akses ke data ini]` / tak ada ⇒
    `[data tidak ditemukan]`.

## D. M2-C1 — Marketing Performance Record + Auto-Metrics

14. **Marketing Staff (owner campaign)** — `POST
    /api/v1/marketing/campaigns/{id}/performance` (record 1:1, M3-OA-5). Budget WAJIB > 0:
    kosong/non-angka/≤0 ⇒ `[data tidak lengkap, silahkan lengkapi semua pertanyaan
    wajib!]` (`marketing.go:44`, sebelum insert). ✔ budget valid ⇒ record lahir (PK
    `campaign_id` 1:1); audit `create`. Negatif: record kedua utk campaign sama ⇒
    `[performance record untuk campaign ini sudah ada]` (`marketing.go:53`, **1 string BI
    baru Wave 3 disetujui**).
15. **Gate tulis M2 §5 Rule 3** — ⚠ **Marketing Lead (`UATMKT0001`) NON-owner** coba
    `POST .../performance` atau `POST .../performance/budget` pada campaign milik staf ⇒
    **DITOLAK** `[anda tidak memiliki akses ke data ini]` (`canManageRecord`
    `marketing.go:246` — lead "monitor, not edit" MENANG atas pola manage M3). ✔ hanya
    **owner campaign / Director** yang boleh tulis; **OD** ditolak (read-only). Owner
    edit budget ⇒ audit `budget_edited` before→after (bukan status, `marketing.go:187`).
    ⚠ langkah negatif ini butuh Marketing lead riil (fixture O34) untuk cabang izin yang
    benar (Director akan diizinkan; OD ditolak-di-mana-mana = cabang berbeda).
16. **Marketing staff (owner)** — `GET /api/v1/marketing/campaigns/{id}/performance` dan
    Auto-Metrics via dashboard (langkah 17). ✔ **semua metrik derived read-only**
    (`metrics.go`): `lead_by_dashboard` (COUNT Origin), `lead_real_by_sales` (COUNT DISTINCT
    ≥Qualified), `lead_quality_rate` (`NN%` atau `—`), `attributed_sales` (LAST-TOUCH,
    M2-OA-2, window 3 bulan pasca-Close M3-OA-4 — win date = audit `closing`),
    `cost_per_lead`/`cost_per_real_lead` (IDR atau `—`), `roas` (`X.XX` atau `—`),
    `collected_sales` + `collected_roas` (basis Amount Verified M5 = Σ INST `[Terverifikasi]`
    + verifikasi direct, M2-OA-5), `junk_breakdown` (COUNT per reason NQ, label verbatim).
    Div-by-zero ⇒ literal `—` (house rule #7, `metrics.go:25`); uang `Rp. X.XXX.XXX,00`;
    nol sah = `Rp. 0,00`.
17. **Dashboard split M2 §5** — `GET /api/v1/marketing/performance-dashboard`:
    **Marketing staff** melihat metrik campaign OWN saja; ⚠ **Marketing lead
    (`UATMKT0001`)** / **OD** / **Director** melihat SEMUA campaign (bandingkan
    CPL/CPRL/ROAS/Quality lintas staf, `metrics.go:253`). ✔ campaign tanpa record tetap
    tampil (metrik ber-budget render `—`). Negatif: divisi lain ⇒ `[anda tidak memiliki
    akses ke data ini]`.

## E. CAT-1 — Sweep `EvHoursLoggedReminder` (EOD WIB)

18. **Creative any-level / Director** — `POST /api/v1/assets/reminders/scan` (sweep manual
    on-demand, pola M5 `ScanReminders`, `reminder.go:82`). ✔ untuk tiap Asset "aktif"
    (ber-PIC, status bukan `[Approved]`/`[Blocked]`) TANPA baris audit `hours_logged` di
    jendela hari kalender WIB, emisi `EvHoursLoggedReminder` (`m7.hours_logged.reminder`,
    event ke-15 katalog — satu-satunya pembukaan Wave 3, W3-CAT-1) ke PIC Asset; fire-once
    per hari via `assets.hours_reminder_sent_at` (dibanding per-hari-WIB ⇒ berulang lintas
    hari, tak pernah dobel sehari). Verifikasi teknis: catat Hours pada satu Asset
    (`POST /api/v1/assets/{id}/hours`) lalu scan ⇒ Asset itu TIDAK dapat reminder; Asset
    aktif tanpa Hours ⇒ dapat reminder (cek notifikasi in-app PIC). Negatif: aktor tak
    berhak (mis. AM / divisi lain) ⇒ `[anda tidak memiliki akses untuk menjalankan
    pemindaian pengingat Hours Logged]` (`reminder.go:61`).

## F. M11 — Unified Board: Dependency + gate blocking + My Tasks/board

19. **Owning AM (SYIFA) / Account lead / Director** — `POST /api/v1/dependencies` (Brief↔
    Brief, same-Client). ✔ `DEP-YYYYMM-NNNN` lahir setelah validasi (house rule 1); status
    **DERIVED** (Pending/Blocking/Satisfied, tanpa kolom status `board.go:57`); audit
    `create`; tipe `Blocking`/`Informational`. Negatif (semua create-time, sebelum mint ID):
    field wajib kosong ⇒ `[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]`
    (`board.go:84`); tipe di luar enum ⇒ `[tipe dependency tidak valid: harus Blocking atau
    Informational]` (`board.go:86`); entity bukan Brief ⇒ `[dependency hanya dapat dibuat
    antar Brief]` (`board.go:89`); source=target ⇒ `[Source dan Target Dependency tidak
    boleh Brief yang sama]` (`board.go:91`); brief tak ada ⇒ `[brief tidak ditemukan]`
    (`board.go:93`).
20. **AM / Account lead / Director** — uji constraint graf. Dua Brief beda Client ⇒
    `[dependency hanya bisa dibuat antar Brief dalam Client yang sama]` (`board.go:95`,
    §2 Rule 4); pasangan (Source,Target) yang sudah ada ⇒ `[dependency untuk pasangan Brief
    ini sudah ada]` (`board.go:98`); dependency yang membentuk siklus (BFS reachable,
    `board.go:329`) ⇒ `[dependency ini membentuk siklus (circular dependency) dan ditolak]`
    (`board.go:101`). Negatif otoritas: **staf divisi / AM non-owner** ⇒ `[hanya Account
    Manager pemilik klien atau SPV/Lead Account yang dapat membuat Dependency]`
    (`board.go:82`, §6.1).
21. **Gate blocking (M11 §2 Rule 7 / §6.3)** — buat Dependency **Blocking** Source→Target,
    Source belum terminal (`[Approved]`). **AM (SYIFA)** — approve Target Brief
    (`POST /api/v1/tasks/{targetBriefId}/...` menuju `[Approved]`) ⇒ **DIBLOKIR** oleh
    `ValidateBriefApproval` (`gate.go:51`) dengan pesan template §12:
    `Brief ini belum bisa lanjut ke [Approved] karena menunggu <BRF-…> selesai Approved.`
    (`gate.go:40` — bracket status + id Source = isian dinamis; Resolved §6.3 `[Approved]`
    MENANG atas contoh `[In Execution]`). ✔ Dependency `Informational` TIDAK memblokir;
    start/edge non-final TIDAK di-gate (§2 Rule 7). Setelah Source mencapai `[Approved]`,
    Target boleh di-approve.
22. **Emisi `EvDependencySatisfied`** — saat Source Brief mencapai `[Approved]` (via engine,
    hook `httpapi.onTransition` → `OnBriefReachedTerminal` `gate.go:105`), tiap Dependency
    **Blocking** ber-Source itu ⇒ Satisfied + emisi `EvDependencySatisfied` (event existing,
    katalog tetap FROZEN 15) **fire-once** (`satisfied_notified_at` row-lock) ke **PIC
    Target Brief**. ✔ cek notifikasi in-app PIC Target; re-run tidak dobel. (Deferral
    tercatat: Source brief LS close off-machine §10 belum ter-cover — edge non-blocking.)
23. **My Tasks + Client Board (read-model §5)** — `GET /api/v1/my-tasks` (aktor: unit
    kerja sendiri lintas Client — Brief Ads / Asset Creative / Booking KOL / LS via brief
    PIC) dan `GET /api/v1/board?client={id}` (kolom universal §5.2). ✔ staf = own; AM/
    Account lead/OD/Director lebih luas (`canSeeClient` `board.go:484`); `GET
    /api/v1/dependencies?source=/&target=` + `GET .../{id}` scoped visibilitas Client;
    guardrail implicit Asset→Launch M8 TIDAK pernah muncul sebagai baris Dependency.

## G. M13 — Client Health snapshot (`CHR-`)

24. **Account any-level (AM/lead) / Director** — `POST /api/v1/health/snapshots/scan`
    (sweep bulanan WIB, HANYA bulan kalender terakhir yang sudah tutup, fire-once row-lock
    pola M5/M7). ✔ untuk tiap klien lahir `CHR-YYYYMM-NNNN` (bucket = bulan PERIODE yang
    di-skor), UNIQUE `(client_id, period_start)` = idempotensi batch; **IMMUTABLE via
    trigger DB BEFORE UPDATE/DELETE** (pola audit_log 0001 — CHR tak pernah transisi, nol
    kolom status). Negatif: **OD** scan ⇒ `[anda tidak memiliki akses untuk menjalankan
    pemindaian skor kesehatan klien]` (`service.go:41`, OD ditolak walau read-all).
25. **Any read** — `GET /api/v1/clients/{id}/health`. ✔ `components_json` menyimpan per
    komponen raw UNCAPPED + capped + bobot base/effective + included/excluded + alasan
    (§5.1/§5.6); **7 sub-score** dengan **redistribusi bobot** untuk komponen excluded
    (penyebut nol / missing data ⇒ excluded, BUKAN error); band = **`Healthy`** (80–100) /
    **`Watch`** (60–79) / **`At Risk`** (<60) (`health.go:48-50`, Rule 7); skor all-excluded
    defensif ⇒ NULL render `—` (house #7). Satisfaction/CSAT SELALU N/A (Rule 2, portal
    ditunda). Grace Rule 8 (bulan penuh pertama GMV excluded).
26. **AM (own-book) / Account lead / Director** — toggle ROAS `PUT
    /api/v1/clients/{id}/health/roas-toggle` (kolom nullable override, NULL=default;
    default = ada ADC `[Active]`). ✔ ter-audit before→after; `GET .../roas-toggle` baca
    keadaan. Negatif: aktor tak berhak (mis. divisi lain) ditolak.
27. **Live preview (Rule 10)** — `GET /api/v1/clients/{id}/health/preview` derived-on-read,
    **TIDAK pernah disimpan**. ✔ nilai = recompute komponen saat ini (tanpa insert snapshot).
    `GET .../health/trend` = deret snapshot tersimpan.
28. **Emisi `EvClientBandDrop` (Rule 12)** — jalankan snapshot dua periode di mana band
    klien TURUN (mis. `Healthy→Watch`). ✔ emisi `EvClientBandDrop` (event existing, katalog
    FROZEN) DALAM tx INSERT snapshot (fire-once by construction — INSERT unik), recipient
    resolver `leadsOfDivision(Account)` = SPV/lead Account (visibility-only). `band_drops_
    flagged` terhitung di hasil sweep (`snapshot.go:78`).
29. **Worked example Alpha Digital §4** — verifikasi vektor terkunci test: final health
    score **≈ 74,56** ⇒ band **`Watch`** (redistribusi ÷0,9; Current GMV = `clients.
    total_sales`, Target ROAS = MEAN `ParseROASTarget` ADC klien). ✔ recompute = nilai
    tampil (house #4). Scope task v1 = Creative Assets + Ads Briefs-as-task (KOL/LS
    off-machine sengaja di luar v1 — deferral tercatat).

## H. M14 — Team Performance snapshot (`PERF-`)

30. **Director** — config KPI weights `PUT /api/v1/performance/config/weights` (OA-5,
    admin-configurable, seed §2 Rule 2 verbatim: Creative 30/25/25/20, Ads 25/30/25/20,
    KOL 30/25/20/25, AM 50/25/25). ✔ Σ per role_type = 100 divalidasi server-side;
    Σ≠100 ⇒ `[total bobot KPI harus berjumlah 100]` (`perf.go:118`). Negatif: **non-Director**
    (staf/lead/OD) tulis weights atau targets ⇒ `[anda tidak memiliki akses untuk mengubah
    konfigurasi KPI performa]` (`perf.go:115`, config = artefak lintas divisi milik
    Director/HR, beda dari MSL milik Head of Sales). `GET .../config/weights` +
    `GET .../config/targets` = baca oleh aktor ber-scope.
31. **O9 targets placeholder** — `GET /api/v1/performance/config/targets`. ✔ semua seed
    `perf_period_targets` `is_placeholder=1`; snapshot mengekspos `targets_placeholder`
    (O9 target periode riil TETAP TERBUKA — non-blocking; tidak ada angka target dikarang).
    Target riil masuk kelak via endpoint config tanpa perubahan kode.
32. **Director** — `POST /api/v1/performance/snapshots/scan` (sweep bulanan, LINTAS SEMUA
    divisi, beda dari scan divisi M13). ✔ untuk tiap staf ber-profil (Creative/Ads/KOL
    staff / Account staff→AM) lahir `PERF-YYYYMM-NNNN` (IMMUTABLE trigger BEFORE
    UPDATE/DELETE, UNIQUE `(staff_id, period_start)`, `components_json` raw+sub-score+bobot+
    included/excluded); lead & divisi tanpa profile (Sales/Finance/Marketing) → TANPA
    snapshot. Negatif: **non-Director** sweep ⇒ `[anda tidak memiliki akses untuk
    menjalankan pemindaian skor performa tim]` (`perf.go:112`); **OD** read-only.
33. **Any scoped read** — `GET /api/v1/staff/{id}/performance` + `.../trend` + team rollup
    `GET /api/v1/performance/teams/{division}` (Creative/Ads/KOL/AM). ✔ breakdown penuh di
    tiap respons (Rule 8/§5.5): profile score + **Client-Outcome Modifier §5.3** (dari CHR
    `components_json`, WAJIB ada CHR periode sama; tanpa sumber → modifier ABSEN/efektif 0
    tercatat, bukan 0-dari-80 karangan); **AM CHR Average = mean `final_health_score`
    portofolio** (menutup M13 OA-8); Final = profile+modifier bounded 0–100; team rollup =
    simple average per divisi derived-on-read (tak disimpan). Modifier §5.3 tak berlaku AM
    (Rule 3).
34. **Emisi `EvPerformancePublished` + worked example Kenny** — sweep memancarkan
    `EvPerformancePublished` per staf DALAM tx insert (fire-once by construction, katalog
    FROZEN). ✔ worked example KENNY (Ads) terkunci test: profile **86.4**, modifier **+2**
    (avg CHR 84), final **88.4** (Decided W3-M14-C1). Recompute-from-log = nilai tampil.

## I. M15-C1 — Team Portal (INTERNAL, read-model)

35. **Staff (mis. KENNY Ads / ARIF Creative)** — `GET /api/v1/portal/me` (Rule 9). ✔ open
    tasks read-model M11 milik aktor TERURUT SLA-risk (`Overdue` → `DueDate` terdekat →
    tanpa-due terakhir; `Done` dikecualikan) + **running Performance Score bulan berjalan**
    (`module14_performance.PreviewCurrent` computed-on-read, TANPA insert/emisi, paralel
    Rule 10 M13); staf tanpa KPI Profile → running score `null` (bukan error). Quick actions
    = delegasi rute existing (tanpa endpoint baru).
36. **Lead (Account lead YULIANTI / Director) + block-approval queue** — `GET
    /api/v1/portal/team` (Rule 10). ✔ team rollup M14 divisi + ringkas Client Board +
    **block-approval queue** (`module12_task.PendingBlockRequests`, union brief+asset, scope
    `actor.IsLead(division)` identik gate `decideBlockRequest`; Director semua). Approve/
    reject block = **delegasi penuh** ke fungsi decide M12 existing: approve ⇒ `[Blocked]`
    via engine + `EvBlockRequestDecided`; **reject TANPA alasan** (OA-6). ✔ satu emisi tetap
    di M12 (portal nol emisi).
37. **Edge lead divisi non-scored (404 by design)** — ⚠ **Marketing Lead (`UATMKT0001`)**
    (ATAU Sales/Finance lead) — `GET /api/v1/portal/team` ⇒ **404** dari rollup M14
    (`module14_performance.ErrNotFound` → `portal_handlers.go:75`): audiens Rule 10 = divisi
    ber-skor (Creative/Ads/KOL/AM); queue mereka kosong by construction. ✔ perilaku
    terdokumentasi (Decided 2026-07-18, bukan bug). Sama: `GET /api/v1/performance/teams/
    Marketing` ⇒ 404.
38. **Management Dashboard (Director/OD SAJA)** — `GET /api/v1/portal/management`
    (Rule 11/§6.3). ✔ SEMUA klien × CHR terbaru: band, arah trend (score terbaru vs
    sebelumnya; tanpa-prev = flat), **dragging component** (capped sub-score terendah yang
    included dari `components_json` M13), AM; filter `?band=&am=` + sort `?sort=` (default
    `At Risk` dulu); klien tanpa snapshot tetap tampil (band kosong, skor `—`, sort
    terakhir). Negatif: **selain Director/OD** (staf/lead divisi) ⇒ `[anda tidak memiliki
    akses ke data ini]` (`portal.go:285`, Role Matrix tidak punya role manajemen lain).
39. **M15-C2 Client Portal — TIDAK diuji.** Klaster realm-auth-terpisah + allow-list +
    embed `mea-client-reporting` **DITUNDA** (Decided 2026-07-18); tidak ada kode/endpoint
    portal klien. Lewati; catat di penutup (langkah 42).

## J. Audit immutable + recompute derived Wave 3

40. **OD (OKFA, read-only)** — telusuri audit log seluruh perjalanan Wave 3: campaign
    `create`/transition/`set_end_date`/`owner_reassigned`/`campaign_auto_activated`;
    lead `last_touch_updated`; M2 `create`/`budget_edited`; Dependency `create`;
    snapshot CHR-/PERF- (trigger DB memblokir UPDATE/DELETE). ✔ rantai immutable (actor,
    before→after, timestamp); **CHR-/PERF- tak dapat di-UPDATE/DELETE** (trigger); OD semua
    write Wave 3 ⇒ ditolak.
41. **Dev** — recompute derived = nilai tampil: (a) rollup M3 (leads/real/clients/value)
    dari linkage + audit; (b) Auto-Metrics M2 (ROAS/Collected-ROAS/CPL/CPRL/Quality/junk,
    window 3 bulan) dari Leads DB + ledger M5; (c) Health Score M13 dari `components_json`
    + log; (d) Performance M14 dari log task/GMV/optimization + CHR; (e) Dependency status
    dari status Source live. ✔ semua recomputable, tidak ada kolom running mutable.

## K. Penutup — Go/No-Go manusia

42. **Nerissa/Yohan + head dev** — putuskan go/no-go **gate exit Wave 3** (Build Plan §4);
    catat hasil + temuan di `docs/DECISIONS.md`. Pola langkah 49 W2 / langkah 18 W1-20 —
    keputusan manusia, bukan agent. **Catatan wajib dibawa ke keputusan:**
    (1) **M15-C2 Client Portal DITUNDA** (Decided 2026-07-18) sehingga **TIDAK di-UAT** —
    fitur bergantung portal (CSAT/Satisfaction M13, kanal komplain portal M6, metrik M15 §8
    sisi klien) ikut tertunda by design; O4/O5 tetap prasyarat bila portal dihidupkan lagi.
    (2) **Peran ber-fixture ⚠**: Marketing lead = fixture `UATMKT0001` (preseden O34,
    roster HR tanpa lead Marketing) — aktor produksi = keputusan Yohan/HR; fixture Wave 2
    (KOL/Creative-lead/Ads-lead/LS O34, Finance O33, Director O26) tetap dipakai di rantai
    precondition. (3) **O9** target periode M14 masih terbuka (configurable + placeholder,
    non-blocking).
