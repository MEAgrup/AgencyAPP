# CDPS — Module 16: Lead Time per Tahapan Divisi

**Status:** Approved by owner 2026-08-28 (interview lengkap; lihat `docs/DECISIONS.md` baris 2026-08-28 M16)
**Worked example:** Alpha Digital, Brief Creative `BRF-202608-0031` (12 video), PIC Rian
**Depends on:** Module 6 (Brief + dispatch), Module 7 (Asset), Module 8 (Ad Campaign), Module 9 (Creator Booking), Module 10 (Live Stream), Module 12 (Task Execution engine), Module 14 (Team Performance)

---

## 1. Background

Setelah AM menyusun **STRG** (M6A) dan **Plan** (M6B) lalu mengirim Brief ke divisi eksekusi, CDPS berhenti mengukur. Yang tersedia hari ini hanya **satu angka**: `turnaround` = `[In Progress]` pertama → `[Approved]` pertama, minus interval `[Blocked]` (M12 Rule 4/7).

Tiga hal yang dikeluhkan AM karena tidak terlihat sama sekali:

1. **Serah-terima AM → divisi tidak terukur.** Brief dikirim lewat `assigned_division`, tapi tidak ada notifikasi dispatch apa pun — divisi harus melihat antrian sendiri. Tidak ada jejak kapan divisi menerima brief, menolaknya, atau menunjuk PIC.
2. **Langkah di dalam divisi tidak ada.** Antara `[In Progress]` dan `[Submitted]`, pekerjaan bersifat **atom**. Script/shooting/editing/QC/posting tidak pernah dispesifikasikan di PRD mana pun.
3. **Latensi review AM tersembunyi.** Karena jam berhenti di `[Approved]`, waktu Brief mengendap menunggu AM ikut dibebankan ke divisi (lihat §6).

Istilah "lead time" sebelum modul ini hanya pernah berarti `lead_time_restock_hari` — lead time restock stok **klien** di STRG A-6. Modul ini memberi istilah itu arti kedua yang eksplisit: **lead time delivery**.

Hasil yang dituju: AM bisa melihat tiap Brief sedang di tahap apa, berapa lama tiap tahap, dan tahap mana yang lewat target — tanpa membongkar satu pun mesin status yang sudah berjalan.

---

## 2. Rules

1. **Tahapan menempel pada BRIEF, bukan pada Asset.** Satu Brief punya satu `production_stage` aktif. Konsekuensi yang diterima sadar: Brief berisi 12 video menampilkan satu tahap; *item mana* yang tertinggal tetap dilihat dari status Asset masing-masing (M7).
2. **Tahapan tidak pernah menulis kolom `status`.** Mesin tahapan dan mesin `brief_task` (M12 Rule 2) berjalan berdampingan pada baris yang sama, di kolom berbeda. Aturan rumah #2 tetap utuh.
3. **Satu checkpoint bisa berasal dari dua sumber.** `stage_definition.sumber`:
   - `'stage'` — punya state sendiri di mesin tahapan.
   - `'status_brief'` — **tidak menyimpan apa pun**; `status_dipetakan` menunjuk status Brief yang sudah ada, dan durasinya diturunkan dari log status itu. Dipakai untuk **QC Account Service** (`[In Review]`) dan **Revisi** (`[Revision Requested]`).
4. **Durasi tidak pernah disimpan.** Setiap angka lead time diturunkan dari `audit_log` (aturan rumah #3/#4). Tidak ada kolom durasi, tidak ada kolom "mulai tahap".
5. **Log tahapan ber-namespace `entity_type='brief_stage'`.** Transisi tahapan memakai `sm_transition` dengan `p_entity_type='brief_stage'`, `p_table='briefs'`, `p_status_col='production_stage'`. Menulisnya sebagai `'brief'` akan mencemari perhitungan M12 — lihat §5.2.
6. **Satuan lead time adalah HARI KERJA**, dihitung `working_days_between` (Sen–Jum minus tabel `hari_libur`). Bukan jam, bukan hari kalendar.
7. **Target per tahap: default per divisi, boleh dioverride per Brief.** Default ada di `stage_definition.target_hari_kerja`; override di `brief_stage_sla`, gerbang tulis `isLead(division)` — pola yang sama dengan `setSlaTarget` M12.
8. **Tahap tanpa target menghasilkan `N/A`**, tidak pernah di-default diam-diam maupun di-backfill dari Brief (konsisten M12 §5.3).
9. **Gate klien menghentikan jam.** Tahap dengan `gate_pihak='KLIEN'` (mis. Approval Sampel KOL) dicatat durasinya tapi **dikeluarkan** dari lead time divisi — perlakuan identik dengan interval `[Blocked]` (M12 Rule 7). Menunggu klien bukan kelambatan tim.
10. **Cek Brief AM adalah gerbang intake wajib di semua divisi.** Divisi memilih *Terima & proses* atau *Brief Dikembalikan ke AM* + alasan terstruktur. Ini rentang yang menjawab "lead time dari AM ke team".
11. **Brief tidak boleh masuk `[Submitted]` sebelum tahapannya mencapai state terminal pipeline.** Ditegakkan satu arah sebagai guard di `submitTask` — mesin tahapan tidak pernah mendorong status.
12. **Divisi boleh aktif tanpa pipeline.** Brief tetap bisa didispatch dan `Cek Brief AM` tetap terukur; pipeline di-seed belakangan lewat satu migrasi tanpa perubahan kode (kasus Store Operation).
13. **Transisi tahapan ilegal diblokir di DB**, bukan hanya di TS — `sm_edges` yang menentukan, dengan pesan BI dari `sm_machines.block_message`.

---

## 3. Rentang yang diukur

Empat rentang, semuanya turunan `audit_log`:

| Rentang | Dari | Sampai | Menjawab |
|---|---|---|---|
| Strategi → Brief pertama | STRG `transition:*->Aktif` | `min(briefs.created_at)` per contract | seberapa cepat AM menurunkan strategi jadi kerja |
| AM kirim → divisi merespons | `briefs.created_at` | transisi keluar `Cek Brief AM` | seberapa cepat divisi mengakui brief |
| Divisi terima → PIC ditunjuk | keluar `Cek Brief AM` | `setPic` | berapa lama brief menganggur di antrian |
| Antar tahapan produksi | masuk tahap | keluar tahap | tahap mana yang jadi bottleneck |

---

## 4. Pipeline per divisi

Singkatan **hk = hari kerja**. `⟨…⟩` = checkpoint `sumber='status_brief'`.

### 4.1 Creative — Content Production

`Cek Brief AM → Script (1hk) → QC internal (1hk) → Shooting (1hk) → Edit (1hk) → ⟨QC Account Service = [In Review]⟩ (1hk) → ⟨Revisi = [Revision Requested]⟩ (1hk) → Jadwal Posting (1hk)`

Alasan pengembalian brief (enum): `Brief kurang jelas` · `Sampel belum diterima` · `Talent tidak tersedia` · `Properti tidak tersedia` · `Lokasi butuh approval`.

### 4.2 Ads

Status Ads dipetakan ke mesin **`ADC-`** yang sudah ada — `ADC-` tetap satu-satunya pemilik kebenaran "iklan jalan/hold/stop":

| Label Ads | State `ADC-` |
|---|---|
| Setting | `[Setting]` (state awal **baru**) |
| Running | `[Active]` |
| Hold | `[Paused]` |
| End | `[Ended]` |

- **Tipe Iklan:** `GMV Max Product` · `GMV Max Live` · `TTAM`
- **Ads Management Date** — `end_date` adalah turunan read-only (aturan rumah #4):
  `end_date = start_date + durasi_jasa + additional_days + total_hari_hold`
  **Hari hold memperpanjang End-Date**: masa management tidak hangus saat iklan dipause. `total_hari_hold` diturunkan dari riwayat transisi `Hold`, jadi `end_date` bergerak sendiri setiap iklan di-resume dan tetap recomputable dari log. `additional_days` untuk tambahan seperti libur Lebaran. `durasi_jasa` dari Service/Master Service List.
- **Reporting Ads** (dikirim ke divisi terkait): `Weekly Report` memakai `ads_weekly_reports` yang **sudah ada**; ditambah `Mini Report`, `Monthly Report`, `Content Analysis`.

### 4.3 KOL

`Cek Brief AM → Buat Campaign (1hk) → Approach Creator & Sebar Link Product (3hk) → Buat & Update Daftar Creator (1hk) → Nego & Dealing Creator (2hk) → Approval Sampel (1hk, gate KLIEN) → Follow up Video Creator (14hk) → QC & Approval Video Creator (1hk)`

- Alasan pengembalian brief: `Brief kurang jelas` · `Data tidak lengkap`.
- **Tipe Program KOL:** `Open-plan` · `Targeted-plan` · `TAP` · `Influencer/BA`.
  **TAP** = program TikTok yang membagi komisi seller langsung antara creator dan agency. **BA** = Brand Ambassador untuk produk seller. Keduanya teks tampilan, tidak jadi logika.
- `BKG-` (Creator Booking, M9) **tidak disentuh** — tahapan ada di level Brief.
- `Follow up Video Creator` bertarget 14 hk walau bergantung creator eksternal (keputusan pemilik: tanpa deadline tahap ini paling mudah menggantung). Jendela 14 hk itu **hanya** miliknya — LT-3 dijawab pemilik 2026-08-29 ("14 hari kerja hanya untuk follow up memastikan video di post, sisanya buat sesuai standar"), jadi `QC & Approval Video Creator` memakai standar QC internal CDPS = 1 hk, sama dengan setiap checkpoint QC lain. Lihat `DECISIONS.md` LT-3.

### 4.4 Live Stream

`Terima Brief AM (gerbang intake, gate_pihak=AM keluar) → Terima Sampel → Briefing Klien Live → Live Start`

Pelaporan progres vendor. **Tidak menyentuh mesin `LSS-`** sama sekali — rekonsiliasi vendor M10 tetap utuh. Menyimpang dari M6 §6 Rule 2 + M10 yang menyatakan Live tanpa status kerja internal; dicatat di `DECISIONS.md`.

**LT-5 (pemilik 2026-08-29): Live Stream bukan lagi pengecualian dari gerbang intake wajib §2 Rule 10.** Ia mendapat checkpoint pertama yang sama seperti keempat pipeline lain — secara `stage_code` PERSIS `Cek Brief AM` (supaya `reviewBrief` menggerakkannya lewat kontrak yang sudah ada, nol kode TS), tapi **label tampil "Terima Brief AM"** sesuai permintaan pemilik ("nama baru yg lebih relevan" — pekerjaan Live dikerjakan vendor, jadi "menerima brief dari AM" lebih pas daripada "memeriksa"). Divergensi label/kode ini adalah kasus pertama LT-7 dipakai sungguhan. Brief yang dikembalikan bisa dikirim ulang lewat edge balik yang sama seperti LT-4 (gerbang `gate_pihak='AM'`). Lihat `DECISIONS.md` LT-5.

### 4.5 AI Optimizer (M17)

- **Optimasi SKU:** `Cek Brief AM → Ambil SKU → Riset → Perbaikan → QC → Approve → Terapkan`
- **AI Video:** `Cek Brief AM → Script → Generate AI → Edit → QC → Jadwal Posting`

### 4.6 Store Operation

Divisi terdaftar, **pipeline menyusul** (`DECISIONS.md` LT-2). Pekerjaan yang sudah disebut, belum berurutan: Banding Pelanggaran · Setup Promo Toko · QC Konten Toko.

---

## 5. System Requirements

### 5.1 Tabel baru

```
division_registry(code PK, nama, aktif, brief_assignable, dispatch_target,
                  vendor_managed, urutan)

stage_pipeline(code PK, division_code FK, deliverable_type NULL,
               machine_name, aktif)

stage_definition(pipeline_code, stage_code, label, urutan,
                 sumber            -- 'stage' | 'status_brief'
                 status_dipetakan, -- utk 'status_brief'
                 gate_pihak,       -- NULL | 'AM' | 'KLIEN'
                 target_hari_kerja,
                 PRIMARY KEY (pipeline_code, stage_code))

brief_stage_sla(brief_id, stage_code, target_hari_kerja, set_by, created_at)

brief_review(brief_id PK, keputusan, alasan_kode, catatan,
             actor_employee_id, created_at)
```

Kolom baru pada `briefs`: `production_stage`, `stage_pipeline_code`.

### 5.2 Kenapa `entity_type='brief_stage'` wajib

`sm_transition` menulis baris audit dengan action `'transition:' || from || '->' || to` dan `entity_type = p_entity_type`. `computeMetrics` (M12) membaca `audit_log` dengan filter `entity_type='brief'` + `action like 'transition:%'`.

Kalau transisi tahapan ditulis sebagai `entity_type='brief'`, baris tahapan akan **ikut terbaca** sebagai transisi status dan merusak turnaround, Speed Score, serta revision count setiap Brief. `audit_log.entity_type` adalah `varchar(64)` tanpa constraint, jadi namespace terpisah tidak butuh perubahan skema — dan `loadTransitions` dipakai apa adanya dengan argumen `'brief_stage'`.

**Uji wajib:** setelah sejumlah transisi tahapan, `computeMetrics` untuk Brief yang sama harus mengembalikan `turnaroundHours` dan `speedScoreDisplay` **identik** dengan sebelum modul ini ada.

### 5.3 Perhitungan

`computeStageLeadTime(stageEvents, statusEvents, defs, overrides)` mengembalikan per tahap: `masukPada`, `keluarPada`, `hariKerja`, `targetHariKerja`, `status`; plus `totalHariKerja` dan `tahapAktif`.

Kosakata status per tahap memakai yang sudah dipakai timeline Kelola Klien: `belum_mulai` · `tepat_waktu` · `mendekati_batas` · `terlambat` · `tidak_berlaku`.

Pembagian nol → `—`. Target kosong → `N/A`. Keduanya mengikuti konvensi `speedScore()` M12.

### 5.4 Notifikasi

Event baru (turunan audit log, aturan rumah #8): `brief_dispatched` (→ lead divisi tujuan — menutup gap lama "dispatch tanpa notifikasi apa pun"), `brief_diterima_divisi`, `brief_dikembalikan_ke_am` (+ alasan), `tahap_maju` (→ AM pemilik klien), `tahap_lewat_target` (→ PIC + lead + AM), `permintaan_jatuh_tempo`.

Deteksi pelanggaran lewat tick harian, pola `interview_daily_tick`.

### 5.5 Permintaan (`REQ-`)

Entitas baru untuk permintaan yang **terkait klien**, dipisahkan dari `TSK-` Penugasan Internal yang sengaja tidak punya `client_id`/`service_id`.

`REQ-YYYYMM-NNNN`, parent Brief/Service, `jenis` ∈ {`Top-up Saldo`, `Contract Creator`, `Creator Payment Approval`}, mesin `[Diajukan]` → `[Diproses]` → `[Selesai]` / `[Ditolak]`.

Deadline **1 hari kerja**. Keterlambatan **diturunkan saat baca** dari `due_date` + `selesai_pada` (WIB), meniru `internal_tasks` — termasuk trigger pembeku `due_date`, karena menggesernya adalah cara termudah menghapus keterlambatan dari catatan performa. `Creator Payment Approval` menyambung ke `CPR-` (M9) yang sudah ada, tidak menggantikannya.

---

## 6. Latensi review AM

### 6.1 Masalah

`turnaroundHours` berhenti di `[Approved]` pertama, padahal jalur ke sana melewati AM:

```
[In Progress] → [Submitted] → [In Review] → [Approved]
└─ kerja divisi ─┘└──── menunggu & review AM ────┘
        keduanya masuk ke SATU angka milik divisi
```

Hanya `[Blocked]` yang dipotong; waktu menunggu AM tidak.

**Contoh** — SLA target 24 jam:

| Waktu | Kejadian |
|---|---|
| Senin 09:00 | PIC mulai — `[In Progress]` |
| Selasa 09:00 | PIC submit — kerja divisi **24 jam, tepat target** |
| Kamis 09:00 | AM baru membuka — `[In Review]` |
| Kamis 11:00 | AM setuju — `[Approved]` |

Tercatat: turnaround **74 jam**, Speed Score **308%**, transform M14 `200−308` → di-floor **0**. PIC dapat skor kecepatan nol padahal tepat waktu; di M13 task ini dihitung gagal dan ikut menurunkan Health Score klien. Sementara bobot AM di M14 tidak punya komponen kecepatan review sama sekali — keterlambatan AM dibebankan ke divisi dan tidak dikreditkan ke siapa pun.

### 6.2 Yang dipasang

| Angka | Rentang | Dipakai |
|---|---|---|
| `turnaroundHours` | **tidak berubah** | kontinuitas historis; `PERF-` lama tetap reproducible |
| `turnaroundKerjaHours` | minus tunggu AM | Speed Score divisi |
| `waktuAmBelumBuka` | `[Submitted]`→`[In Review]` | **murni latensi AM** — diberi bobot |
| `waktuAmReview` | `[In Review]`→`[Approved]` | bisa memuat konsultasi klien — diagnostik, tanpa bobot |

Contoh di atas menjadi: `turnaround` 74 jam (tetap), `turnaroundKerja` **24 jam → Speed 100%**, `waktuAmBelumBuka` **48 jam**, `waktuAmReview` **2 jam**.

Mekanismenya identik dengan `blockedMs()` M12 pada rentang berbeda — nol kolom durasi baru.

### 6.3 Cutover

Berlaku **seketika**. Periode yang sudah ditutup **tidak disentuh**; periode yang sedang berjalan **dihitung ulang seluruhnya**, sehingga tidak ada satu periode pun berisi dua definisi — mencegah dua staff berperforma identik mendapat skor berbeda hanya karena kapan AM sempat klik.

`turnaroundHours` lama ditampilkan berdampingan selama 1–2 periode pertama agar tim dapat melihat selisihnya.

### 6.4 Skor AM

Component key baru `kecepatan_review_am` (sumber: `waktuAmBelumBuka`) didaftarkan dengan **bobot 0**. M14 Rule 6 meredistribusi bobot komponen yang tidak tersedia, jadi **tidak ada skor AM yang bergeser** sampai Director menetapkan angkanya lewat `perf_kpi_weights` — data, bukan kode, dengan Σ per `role_type` = 100 ditegakkan server. Lihat `DECISIONS.md` LT-1.

**LT-1 DIPUTUS (pemilik/COO, 2026-08-29):** bobot ditetapkan **10%**, di-carve proporsional dari profil AM (45/22,5/22,5/10 → 40,5/20,25/20,25/9 + 10). Target normalisasi diseed **24 jam**, `is_placeholder=true` (angka belum dikonfirmasi COO).

**LT-9 DIPUTUS (pemilik, 2026-08-29, "ya perlu diperluas"):** portofolio Task yang mengumpankan `kecepatan_review_am` DAN `revision_escalation_rate` (komponen skor AM yang sudah ada) diperluas dari Creative Assets + Ads Briefs menjadi **Creative Assets + Briefs-as-Task di Ads, AI Optimizer, DAN Store Operation** — ketiganya sama-sama mengalir lewat mesin `brief_task` (§7). KOL dan Live Stream TIDAK ikut: KOL dilacak lewat `BKG-` Creator Booking (entitas berbeda), Live Stream adalah pelaporan progres vendor tanpa status kerja `brief_task` internal (§4.4).

## 7. Success Metrics

- AM dapat menyebutkan, tanpa bertanya ke divisi, tahap mana yang sedang berjalan pada Brief mana pun dan sudah berapa hari kerja.
- Setiap Brief yang dikembalikan ke AM punya alasan terstruktur yang bisa diagregasi — "brief kurang jelas" bisa dihitung per AM.
- Waktu review AM muncul sebagai angka tersendiri, bukan lagi tersembunyi di dalam skor divisi.
- Menambah divisi baru beserta pipeline-nya = satu migrasi, nol perubahan kode TS.
