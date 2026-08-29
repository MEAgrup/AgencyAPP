# RENCANA INDUK — M16 Lead Time per Tahapan Divisi + M17 AI Optimizer

> **Dokumen ini adalah rujukan konteks/keputusan/desain untuk M16+M17.**
> Ia TIDAK menduplikasi status tiket — status hidup **satu-satunya** di
> `docs/backlog/LEADTIME_BACKLOG.md` (diperbarui oleh sesi yang benar-benar
> mengerjakan tiketnya) supaya tidak ada dua daftar centang yang bisa
> berbeda satu sama lain. Baca dokumen ini untuk memahami **kenapa** dan
> **bagaimana** modul ini dirancang; baca backlog untuk **sudah sampai
> mana**.
>
> `docs/handoff/PARALEL_M16_DUA_AKUN.md` **SELESAI DIPAKAI** — pekerjaan
> yang direncanakannya sudah dieksekusi, digabung, dan merge ke `main` lewat
> PR #247 (2026-08-29). Lihat §5 dokumen ini untuk riwayat singkatnya.
> Dipertahankan sebagai catatan historis, bukan pintu masuk kerja baru.

---

## 0. Ringkasan tercepat (2026-08-29, setelah PR #247 DAN #248)

- **Fase 0–4 (spec sampai AI Optimizer) SELESAI, MERGE ke `main` (PR #247,
  commit `d231a71`), DAN SUDAH DI PRODUKSI** (PR #248, commit `cc13018`) —
  lihat `docs/backlog/LEADTIME_BACKLOG.md` untuk daftar tiket + berkas
  migrasi + nama test persisnya, semua ✅.
- **Migrasi M16/M17 SUDAH di-push ke `CDPS SG` live** lewat `apply_migration`
  satu per satu urut nama berkas (bukan `db push` mentah — pola nyata repo
  ini). Gate pasca-push diverifikasi persis: tabel 128, entity_prefix 36,
  sm_machines 29, notif_events 65. **Ini bukan lagi next action** — sudah
  tuntas, jangan diulang.
- **Temuan keamanan pasca-push, ditambal SAMA SESI (bukan ditunda):**
  `get_advisors` menemukan `stage_overdue_tick` (callable **tanpa login
  sama sekali**) dan `permintaan_reminder_tick` (callable oleh siapa pun
  yang login) — dua fungsi job baru M16 terbuka ke `anon`/`authenticated`
  gara-gara Supabase memasang `ALTER DEFAULT PRIVILEGES` yang tidak
  tercabut oleh `REVOKE ... FROM PUBLIC` saja (pola sama dengan O61 lama).
  Ditambal migrasi `20260831090000_harden_m16_tick_execute.sql`, diterapkan
  live, `get_advisors` re-run bersih.
- Sesi yang sama juga menemukan **`m6b_carry_over.sql`** (fitur tak
  terkait M16, merge sejak 2026-08-10) ternyata belum pernah di-push ke
  live — ditambal sekalian.
- **Dua item drift live-only PRA-M16 dicatat** (`docs/DECISIONS.md` §Open
  `O61`/`O62`) — **live sudah benar** untuk keduanya, ini murni utang
  dokumentasi repo (migrasi hardening 2026-07/08 yang aktif di live tapi
  tanpa berkas git, dan satu migrasi ter-apply dua kali). Tidak terkait
  M16, tidak mendesak, butuh sesi fokus terpisah.
- **Fase 5 (portal vendor Live) belum**: LT-60 (input internal atas nama
  vendor) terbuka, belum bergantung apa pun; LT-61 (login vendor sendiri)
  **terblokir** — butuh realm auth eksternal yang belum ada di CDPS. **JANGAN
  mulai** sampai ada spec keamanan client-portal-style untuk vendor.
- **8 keputusan implementasi masih terbuka** (`DECISIONS.md` §Open, kode
  `LT-4`..`LT-11`) — **tidak ada yang memblokir**, semua sudah dijawab
  dengan interpretasi konservatif dan dicatat. (`LT-12`/`LT-14` sekadar
  catatan struktur, sudah ditambal, tidak butuh keputusan pemilik.)
- **Halaman FE penuh untuk Ads/Permintaan belum ada** — PR #247 hanya
  membawa type declaration minimal untuk paritas wire, bukan UI-nya.
- **Keputusan proses (2026-08-29):** pekerjaan M16/M17 **selanjutnya**
  dikerjakan **single-track**, tidak dipecah ke akun paralel lagi, untuk
  meminimalkan risiko dua sesi menafsirkan spec berbeda. Ini tidak
  membatalkan apa pun yang sudah dikerjakan lewat split sebelumnya (itu
  sudah selesai, tervalidasi, dan sekarang di produksi) — ini kebijakan
  untuk pekerjaan berikutnya (resolusi LT-4..LT-11, Fase 5a, FE
  Ads/Permintaan, O61/O62, dst).
- **Baca lebih dulu kalau melanjutkan sesi ini:**
  `docs/handoff/HANDOFF_M16_SELESAI_20260829.md` — nomor tertinggi di
  rantai handoff M16, menyatakan eksplisit apa yang TIDAK perlu dikerjakan
  lagi.

---

## 1. Kenapa modul ini ada

CDPS sebelum M16 hanya punya **satu angka waktu** di sisi delivery:
`turnaround` = `[In Progress]` pertama → `[Approved]` pertama, minus
interval `[Blocked]` (`packages/domain/src/task.ts` `computeMetrics`).

Tiga hal yang dikeluhkan pemilik karena tidak terlihat sama sekali:

1. **Serah-terima AM → divisi tidak terukur.** Brief dikirim lewat
   `assigned_division`, tapi **tidak ada notifikasi dispatch sama sekali**
   — divisi harus memantau antrian sendiri (`listDivisionQueue`). Tidak ada
   jejak kapan divisi menerima, menolak, atau menunjuk PIC.
2. **Tahapan produksi tidak ada.** Antara `[In Progress]` dan `[Submitted]`,
   pekerjaan bersifat atom. Script/shooting/editing/QC/posting tidak pernah
   dispesifikasikan di PRD mana pun sebelum M16 — diverifikasi lewat grep
   `shooting|syuting|konsep|storyboard|editing` di seluruh `docs/`, nol hit
   relevan.
3. **Latensi review AM tersembunyi.** Karena jam berhenti di `[Approved]`,
   waktu Brief mengendap menunggu AM ikut dibebankan ke divisi (§4).

Istilah "lead time" sebelum modul ini hanya berarti `lead_time_restock_hari`
— lead time restock stok **klien** di STRG A-6. Modul ini memberi istilah
itu arti kedua: **lead time delivery**.

**Tujuan:** AM bisa melihat tiap Brief sedang di tahap apa, berapa lama
tiap tahap, dan tahap mana yang lewat target — tanpa membongkar satu pun
mesin status yang sudah berjalan. **Tujuan ini sudah tercapai di kode** —
lihat backlog untuk buktinya (nama test persis per klaim).

---

## 2. Temuan repo yang menentukan bentuk solusi

1. **State machine sudah DATA, bukan kode.** `sm_machines` / `sm_edges`
   (punya `require_lead`) / `sm_terminal_states`, di-seed `INSERT`
   (`20260723055732_statemachine.sql`). `sm_transition` generik penuh
   (`p_table`, `p_id_col`, `p_status_col`). Pipeline divisi baru = satu
   migrasi, nol perubahan engine — **terbukti**: pipeline Store Operation
   sengaja kosong dan Brief tetap jalan (uji wajib #10/#11 di backlog).
2. **`audit_log.entity_type` = `varchar(64)` tanpa constraint.**
   `sm_transition` menulis action `'transition:'||from||'->'||to`. Kalau
   tahapan Brief ditulis dengan `entity_type='brief'`, ia **bercampur
   dengan transisi status dan merusak `computeMetrics`**. Dengan
   `entity_type='brief_stage'` log terpisah bersih. **Ini kunci teknis
   paling penting di seluruh modul** — dibuktikan uji wajib #1 di backlog
   (`computeMetrics` identik sebelum/sesudah tahapan aktif).
3. **`working_days_between` sudah ada dan sudah benar**
   (`20260813000000_kelola_klien_sla.sql`): Sen–Jum minus tabel
   `hari_libur`. Dipakai apa adanya di `leadtime.ts`, tidak ada helper baru.
4. **`ads_weekly_reports` sudah ada** (`20260819020000`) — dipakai apa
   adanya sebagai dasar Mini/Monthly/Content Analysis, tidak dibangun
   ulang.
5. **`internal_tasks` (`TSK-`) sengaja tanpa `client_id`/`service_id`** —
   melahirkan entitas baru `REQ-` (`packages/domain/src/req.ts`).
6. **Durasi tidak boleh disimpan** (house rule 3/4). Semua angka lead time
   diturunkan dari `audit_log` — termasuk metrik AM di §4.
7. **`perf_kpi_weights` sudah berupa data**, Director-gated, Σ=100
   ditegakkan server, Rule 6 meredistribusi komponen tak-tersedia. Dipakai
   untuk mendaftarkan `kecepatan_review_am` + role divisi baru dengan
   **bobot 0** tanpa menggeser skor siapa pun.
8. **`asset_type` di-hardcode** — ternyata bukan di tiga fungsi terpisah
   seperti dugaan awal, tapi **satu fungsi (`wrr_aggregate`) yang
   di-`CREATE OR REPLACE` tiga kali secara historis** (temuan LT-12,
   ditambal migrasi keempat, bukan mengedit migrasi lama).

---

## 3. Keputusan pemilik (lengkap)

| # | Topik | Keputusan |
|---|---|---|
| 1 | Granularitas | Tahapan **per Brief (batch)**, bukan per Asset |
| 2 | Relasi ke approval | Tahapan di dalam siklus lama; `brief_task` tidak dibongkar |
| 3 | "QC Account Service" / "Revisi" | Dipetakan ke `[In Review]` / `[Revision Requested]` — bukan status baru |
| 4 | Satuan leadtime | **Hari kerja** (Sen–Jum minus `hari_libur`) |
| 5 | Target SLA | Default per divisi, bisa dioverride per brief |
| 6 | Ads | Pakai `ADC-` yang ada; tambah state **Setting** |
| 7 | KOL | `BKG-` dipertahankan; urutan versi kedua (yang ada leadtime-nya) |
| 8 | Tipe Program KOL | 4 pilihan (Open-plan/Targeted-plan/TAP/Influencer-BA) |
| 9 | Approval Sampel | **Klien** yang approve → jam berhenti selagi menunggu klien |
| 10 | Sampel | Terpisah per divisi, bukan satu konsep bersama |
| 11 | Reporting Ads | Pakai `ads_weekly_reports` + 3 jenis baru |
| 12 | Deadline Top-up Saldo | 1 hari kerja |
| 13 | "Task" Top-up/Contract/Payment | Entitas baru "Permintaan" (`REQ-`) |
| 14 | Live | Vendor mengerjakan; input internal dulu, login vendor menyusul (blocker, §6) |
| 15 | Divisi baru | Bertahap: registry data dulu, UI admin belakangan |
| 16 | AI Optimizer | Deliverable + sinkron SKU balik ke STRG sebagai revisi bernomor |
| 17 | Divisi baru kedua | Store Operation — didaftarkan, daftar pekerjaan menyusul |
| 18 | End-Date Ads | Hari hold memperpanjang End-Date |
| 19 | Bobot M14 divisi baru | Diukur lead time-nya, bobot awal 0 sampai COO menetapkan |
| 20 | Cutover Speed Score | Sekarang — periode tertutup tidak disentuh |
| 21 | Kelambatan AM | Masuk skor AM lewat `kecepatan_review_am`, bobot 0 |
| 22 | Target tahap KOL 7 & 8 | 14 hk masing-masing |
| 23 | LT-13 (sync AI Optimizer vs asumsi gugur) | **Arah (a)**: sync jalan otomatis untuk semua klien Aktif, termasuk yang berasumsi — diputuskan via `AskUserQuestion` 2026-08-29, sudah diimplementasikan |
| 24 | Eksekusi paralel 2 akun | **Dijalankan sekali** (berhasil, PR #247 merge) → **dihentikan untuk pekerjaan selanjutnya**, minimalkan drift (2026-08-29) |

Rasional detail tiap baris: `docs/DECISIONS.md`, cari `M16` (bertanggal
2026-08-28 dan 2026-08-29). **Jangan menimpa baris lama** — tambahkan baris
baru bertanggal hari itu untuk keputusan baru.

### Kamus istilah — 12 tabrakan nama diselesaikan

| Istilah requirement | Sudah dipakai CDPS untuk | Nama yang dipakai |
|---|---|---|
| "Campaign" (Ads) | `CMP-` akuisisi, `ADC-` iklan klien | **Tipe Iklan** |
| "Campaign" (KOL) | idem | **Tipe Program KOL** |
| "Interview Klien" (Live) | `ITV-` Interview Kualifikasi Klien | **Briefing Klien Live** |
| "Listing Creator" (KOL) | "kualitas listing" marketplace | **Daftar Creator** |
| "Riset" (Ads) | "Riset Awal" (mesin #20) | **Setting** |
| "Tolak & Hold" (intake) | Service `[On Hold]`, ADC `[Paused]` | **Brief Dikembalikan ke AM** |
| "Hold" (Ads) | Service `[On Hold]` | **Hold** = ADC `[Paused]` |
| "Task" (Top-up/Contract/Payment) | `TSK-`, "Task" M12 | **Permintaan (`REQ-`)** |
| "Review Brief" | `[In Review]` (AM review hasil) | **Cek Brief AM** |
| "QC team Account" | `[In Review]` | **QC Account Service**, dipetakan |
| "Revisi" | `[Revision Requested]` | dipetakan |
| "Weekly Report" | `ads_weekly_reports` | pakai yang ada |

Teks tampilan saja: TAP (program TikTok, komisi seller dibagi langsung
antara creator dan agency), BA (Brand Ambassador produk seller).

---

## 4. Latensi review AM — masalah, contoh, yang dipasang

`turnaroundHours` dihitung `[In Progress]` → `[Approved]` pertama, padahal
jalurnya melewati AM (`[Submitted]`→`[In Review]`→`[Approved]`), dan hanya
`[Blocked]` yang dipotong — waktu menunggu AM tidak.

**Contoh (juga jadi test persis — lihat backlog uji #6):** SLA 24 jam. PIC
mulai Senin 09:00, submit Selasa 09:00 (kerja **24 jam, tepat target**), AM
buka Kamis 09:00, approve Kamis 11:00. Sebelum M16: turnaround **74 jam**,
Speed Score **308%** → transform M14 di-floor **0** — PIC dapat skor nol
padahal tepat waktu.

**Yang dipasang** (nama field aktual di kode, lihat `task.ts`):

| Angka | Rentang | Dipakai |
|---|---|---|
| `turnaroundHours` | **tidak berubah** | kontinuitas historis; `PERF-` lama tetap reproducible |
| `turnaroundKerjaHours` | minus tunggu AM | dasar `speedScoreKerjaPct` |
| `speedScoreKerjaPct` | `turnaroundKerjaHours ÷ SLA` | Speed Score divisi (live, dihitung ulang tiap request untuk periode berjalan) |
| `waktuAmBelumBukaHours` | `[Submitted]`→`[In Review]` | **satu-satunya yang diberi bobot** (`kecepatan_review_am`) |
| `waktuAmReviewHours` | `[In Review]`→`[Approved]` | diagnostik, tanpa bobot (bisa memuat konsultasi klien) |

Contoh di atas jadi: `turnaround` 74 jam (tetap), `turnaroundKerja` **24 jam
→ Speed 100%**, `waktuAmBelumBukaHours` **48**, `waktuAmReviewHours` **2**.

**Cutover:** periode tertutup (snapshot immutable) tidak disentuh; periode
berjalan dihitung ulang live lewat `previewCurrent` — otomatis konsisten
satu definisi, tidak ada split manual per tanggal.

**Skor AM:** `kecepatan_review_am` didaftarkan di `perf_kpi_weights` dengan
bobot **0** (migrasi `20260830040000`) — Rule 6 meredistribusi, nol skor
bergeser sampai Director menetapkan angkanya lewat config.

---

## 5. Riwayat eksekusi — bagaimana ini benar-benar dibangun

Ringkas (detail penuh: `HANDOFF_M16_PENGGABUNGAN.md`,
`HANDOFF_M16_LT13_MERGE_20260829.md`):

1. **Tahap F (fondasi)** — registry divisi + choke point paralel (katalog
   notif v12, prefix `REQ`, gate hitung) — commit `2b71dba`/`7fefa2d` di
   `claude/buildplan-lead-time-tracking-g62d2i`.
2. **Split 2 akun dijalankan** sesuai `PARALEL_M16_DUA_AKUN.md`:
   - **Akun A** (`claude/m16-akun-a-tahapan-metrik`) — Fase 2+2b
     (LT-20..LT-33): pipeline tahapan, `leadtime.ts`, metrik AM.
   - **Akun B** — Fase 3+4 (LT-40..LT-55): Ads, `REQ-`, AI Optimizer.
3. **Digabung** ke `claude/buildplan-lead-time-tracking-g62d2i`
   (`9e83ed8` merge B, `2fdfd8f` merge A, `30e27ff` penggabungan: gate
   hitung gabungan 128/36/29/65, uji lintas-stream baru
   `m16_cross_stream.test.ts`, 11 baris `DECISIONS.md` baru).
4. **PR #247 dibuka**, satu keputusan tertunda (**LT-13**) diputuskan
   pemilik via `AskUserQuestion` (arah a), diimplementasikan
   (`af47bfc`, migrasi `20260831080000`).
5. **PR #247 di-merge ke `main`** 2026-08-29 08:13:54Z (merge commit
   `d231a71`) — Fase 0–4 M16/M17 resmi jadi bagian `main`.
6. **PR #248 (`claude/supabase-db-push-live-inbv0l`)**: 13 migrasi M16/M17
   di-`apply_migration` ke `CDPS SG` live urut nama berkas; `m6b_carry_over.sql`
   (tak terkait M16, lolos sejak 2026-08-10) ikut di-push karena kelalaian
   sebelumnya; `get_advisors` menemukan 2 fungsi job baru terbuka ke
   `anon`/`authenticated`, ditambal migrasi `20260831090000` sama sesi;
   dua drift live-only pra-M16 dicatat sebagai `O61`/`O62` (tidak terkait
   M16, live sudah benar, tidak mendesak). Merge ke `main` 2026-08-29
   (commit `cc13018`).
7. **Keputusan proses**: pemilik menghentikan pola split-2-akun untuk
   pekerjaan selanjutnya (dokumen ini lahir dari keputusan itu, ditulis
   ulang setelah PR #248 juga merge untuk memastikan statusnya akurat).

**Pelajaran yang perlu diketahui sesi berikutnya (dari `HANDOFF_M16_PENGGABUNGAN.md`):**
jangan jalankan `npx vitest run` dari root repo — itu melewati
`packages/domain/vitest.config.ts` (`fileParallelism: false`, sengaja
menyerialkan test karena berbagi satu koneksi Postgres) dan menghasilkan
ratusan false-failure. Selalu pakai `npm run test --workspaces --if-present`
dari root, atau `cd packages/domain && npx vitest run`.

---

## 6. Yang masih tersisa (kerjakan single-track)

| # | Isi | Sifat |
|---|---|---|
| LT-60 | Input tahapan Live oleh tim internal atas nama vendor | Terbuka, tidak bergantung apa pun |
| LT-61 | Login vendor sendiri (realm auth eksternal) | 🔴 Terblokir — CDPS belum punya realm auth eksternal; tunggu spec keamanan (sama dengan blocker M15 Client Portal) |
| — | Halaman FE penuh Ads/Permintaan | PR #247 hanya bawa type declaration minimal untuk paritas wire, bukan UI |
| LT-4..LT-11 | 8 keputusan implementasi terbuka, nol yang memblokir | Lihat `docs/DECISIONS.md` §Open — baca sebelum menyentuh berkas terkait, jangan menjawab ulang tanpa konfirmasi pemilik |
| LT-1/LT-2/LT-3 | Bobot M14 final, daftar pekerjaan Store Operation, konfirmasi target 14hk KOL | Lihat `docs/DECISIONS.md` §Open |
| O61 | Dua migrasi hardening keamanan live-only tanpa berkas git (Juli/Agustus, **pra-M16**) | Tidak terkait M16; live sudah benar; butuh back-port berkas riwayat verbatim (preseden 2026-07-29), sesi fokus terpisah |
| O62 | Migrasi `m6a_section_d` ter-`apply` dua kali di live (**pra-M16**) | Tidak terkait M16; belum diverifikasi harmless atau tidak; sesi fokus terpisah |

**Sudah selesai, jangan diulang:** push migrasi M16/M17 ke `CDPS SG` live
(PR #248), resolusi LT-12/LT-14 (catatan struktur, sudah ditambal).

**Kebijakan proses untuk semua baris di atas dan pekerjaan M16/M17
berikutnya: single-track, tidak dipecah ke akun paralel** — supaya tidak
ada dua sesi menafsirkan spec/keputusan yang sama secara berbeda.

---

## 7. Berkas kanonik (rujukan lengkap, tidak diduplikasi di sini)

| Berkas | Isi |
|---|---|
| `docs/backlog/LEADTIME_BACKLOG.md` | **Status tiket otoritatif** — nama migrasi + nama test persis per klaim |
| `docs/prd/CDPS_Module16_Lead_Time.md` | Spec lengkap M16, 13 rules |
| `docs/prd/CDPS_Module17_AI_Optimizer.md` | Spec lengkap M17 |
| `docs/STATE_MACHINES.md` §18–§19 | Mesin `brief_stage` + `REQ-` |
| `docs/DATA_MODEL.md` | Entitas baru + computation registry |
| `docs/DECISIONS.md` (cari `M16`, tanggal 2026-08-28/29) | Rasional penuh tiap keputusan, termasuk LT-4..LT-14 |
| `docs/handoff/HANDOFF_M16_AKUN_A.md` / `_B.md` | Detail implementasi per stream (kontrak `stage.ts`, dsb.) |
| `docs/handoff/HANDOFF_M16_PENGGABUNGAN.md` | Detail langkah penggabungan + jebakan `vitest` |
| `docs/handoff/HANDOFF_M16_LT13_MERGE_20260829.md` | Keputusan LT-13 + status PR #247 menuju merge |
| `docs/handoff/HANDOFF_SUPABASE_PUSH_20260829.md` | Alasan push M16 sempat ditahan, lalu dijalankan setelah merge |
| `docs/handoff/HANDOFF_M16_SELESAI_20260829.md` | **Paling baru** — PR #247+#248 selesai, live sudah di-push+ditambal, daftar sisa non-mendesak |
| `docs/handoff/PARALEL_M16_DUA_AKUN.md` | Historis: rencana split yang benar-benar dieksekusi |

## 8. Aturan operasional (berlaku untuk sisa pekerjaan)

- Migrasi **hanya** lewat `supabase/migrations/**` + `supabase db push` /
  `apply_migration`. **Jangan `psql -f`**. DB lokal dibangun ulang hanya
  via `scripts/db-rebuild.sh`.
- Migrasi M16/M17 **sudah** di-push ke live (§0/§5) — aturan "live tidak
  boleh mendahului `main`" (O38) tetap berlaku untuk migrasi BARU
  selanjutnya (mis. hasil resolusi LT-4..LT-11 kalau butuh migrasi):
  merge ke `main` dulu, baru `apply_migration` ke `CDPS SG`, dan tetap
  jalankan `mcp__Supabase__get_advisors` setelah setiap push (preseden
  O61 + temuan `stage_overdue_tick`/`permintaan_reminder_tick`).
- `backend/**` tidak disentuh (Go sudah dipensiunkan; hanya oracle
  paritas).
- Setiap penyimpangan/keputusan baru **wajib** dicatat sebagai baris baru
  di `docs/DECISIONS.md` (jangan menimpa baris yang sudah ada).
