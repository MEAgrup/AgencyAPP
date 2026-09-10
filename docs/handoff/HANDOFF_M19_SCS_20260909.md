# Handoff — M19 separuh SCS selesai (2026-09-09)

**Baca ini lebih dulu di sesi baru.** Pendahulunya:
`HANDOFF_LANJUTAN_M19_20260909.md` (empat pertanyaan yang dijawab sesi ini),
`HANDOFF_M19_CREATIVE_DAILY_OPS_20260909.md` (separuh jadwal harian).

---

## 1. Posisi

| Apa | Nilai |
|---|---|
| PR | **#335 SUDAH DI-MERGE** (`a9cb9e0`). PR #334 juga sudah di-merge (`ad20659`) |
| Branch | `claude/peaceful-wozniak-25acg5` — di-reset ke `origin/main` sesudah merge |
| Migrasi di repo | **217** (`20260928010000_m19_scs_task_engine.sql`) |
| Gate repo | **155 tabel · 43 entity_prefix · 34 sm_machines · 73 notif_events** |
| Live `CDPS SG` | **nol MISSING** — setiap migrasi repo ada di live. Ledger 219 baris ≠ 217 berkas, dan selisihnya SUDAH DIKENAL (§1.2) |
| Tes | core 985 · db 98 · domain 2355 (+1 skip) · apps/api 496 · web-internal 736 |
| Typecheck | bersih di 6 target |
| Lint | 3 error + 61 warning — **identik baseline**, semuanya pre-existing |

**M19 LENGKAP.** Kedua separuhnya (jadwal harian Gap A/D/E/F + SCS Gap B/G/I)
sudah di `main` dan sudah di live. Tidak ada sisa M19 yang menunggu ketokan.

### 1.1 Yang benar-benar diverifikasi di live, bukan diasumsikan

Urutan O65 dipatuhi untuk KEDUA migrasi: **migrasi dulu lewat `apply_migration`,
merge kemudian.** Sesudah apply, angka di live di-probe langsung:

```
tabel public   155 ✓    entity_prefix 43 ✓    sm_machines 34 ✓    notif_events 73 ✓
notif katalog konsisten (SUM(event_count) = COUNT(notif_events)) ✓
scs_kategori 4 baris seed ✓   sm_edges scs_task 9 ✓   terminal 1 ✓
```

plus empat invariant yang di-probe di live karena hanya di sanalah ia berarti:

- himpunan state `scs_task` **identik** `brief_task` (minus state pembatalan
  ber-Service) — invariant yang menopang pemakaian ulang `computeMetrics`;
- `GRANT SELECT TO authenticated` ada di **kedua** tabel (tanpanya
  `readAsActor` gagal "permission denied" sebelum satu policy pun dievaluasi);
- **nol** write policy di kedua tabel;
- `scs_tasks.client_id` **nullable**.

`scripts/check-live-drift.sh` masih belum bisa dijalankan dari sandbox (egress
Supabase diblok kebijakan org). Yang LEWAT dari sandbox adalah
`mcp__Supabase__execute_sql` / `apply_migration` — itu yang dipakai di atas, dan
perbandingan per-slug di §1.2 dijalankan dengan cara yang sama.

### 1.2 Ledger live 219 baris vs 217 berkas repo — selisihnya sudah dikenal

Draf pertama handoff ini menulis *"217 migrasi — SINKRON dengan repo"*. **Itu
salah**, dan dikoreksi di sini karena angkanya di-probe sesudahnya. Yang benar,
dibandingkan PER-SLUG (bentuk yang sama dengan `check-live-drift.sh`, karena
nama di ledger tidak konsisten: sebagian ber-timestamp, sebagian slug telanjang):

```
ledger live : 219 baris, 217 slug unik
repo        : 217 berkas, 216 slug unik

MISSING (ada di repo, TIDAK di live) : NOL   ← ini yang penting, dan ia bersih
EXTRA   (ada di live, TIDAK di repo) : 1     ← d3_tutup_buku_pulihkan_komentar_jaga_transisi
slug ber-jumlah beda                 : m6a_section_d  live=2 repo=1
```

**Nol MISSING** berarti setiap migrasi di repo — termasuk kedua migrasi M19 —
benar-benar ada di live. Itu invariant yang dijaga, dan ia hijau.

Dua selisih sisanya BUKAN dibuat sesi ini dan bukan hal baru:
- `d3_tutup_buku_pulihkan_komentar_jaga_transisi` adalah **A2-DRIFT** persis,
  yang sudah tercatat di `DECISIONS.md` §Open sejak 2026-09-08. Sesi ini
  memberinya nama konkret untuk pertama kalinya — sebelumnya ia cuma "SATU
  migrasi tanpa berkas yang cocok".
- `m6a_section_d` punya DUA baris ledger (`20260808000000` dan
  `20260808020000`) untuk satu berkas repo — duplikat historis, bukan drift
  skema.

Keduanya perlu dituntaskan lewat A2-DRIFT, bukan lewat M19.

---

## 2. Empat ketokan pemilik, dan apa yang dilakukan atas masing-masing

Semuanya masuk `docs/DECISIONS.md` (baris `Decided` 2026-09-09).

### 2.1 🔴 `M19-SCS-ENGINE` → **opsi (b)**, mesin sendiri #34 — DIBANGUN

Baris `SMO & Content Strategist` dapat entitas, tabel, dan mesin sendiri.
`task.ts` (M12) **tidak disentuh sama sekali**.

**Yang membuat pilihan ini tidak kehilangan apa pun:** mesin #34 `scs_task`
adalah **SALINAN VERBATIM konfigurasi `brief_task`** — state sama, edge sama,
gerbang `require_lead` sama. Itu yang membuat `task.computeMetrics()` (exported,
pure) dipakai ULANG apa adanya, jadi Speed Score / turnaround / jumlah revisi
tetap punya SATU implementasi. Ini sekaligus rekonsiliasi dua pernyataan PRD
yang tampak bertentangan (Rule 5 "reuse the engine config" vs §5.4 "mesin #34"):
keduanya benar bila mesin #34 ADALAH konfigurasi engine M12 di bawah namanya
sendiri.

### 2.2 🟡 Kategori `Brief` → tetap `is_standing = false`, kini dengan ALASAN

Ketokan verbatim: *"brief SMO sebetulnya membantu team lain menyelesaikan task
dari AM"*. Dibaca sebagai: baris Brief SMO bukan pekerjaan berulang tanpa tujuan
(yang akan membuatnya standing) melainkan **DUKUNGAN** kepada divisi lain — jadi
yang membedakannya dari Brief Strategist adalah sifat **BARISNYA**, bukan sifat
**KATEGORINYA**.

Direalisasikan sebagai kolom `scs_tasks.mendukung_divisi` (FK
`division_registry`, nullable). Ia ber-FK ke divisi dan **BUKAN** ke `briefs`,
karena induk Brief akan menuntut barisnya di `HALAMAN_BRIEF`
(`stage-panel-coverage.test.ts`) sekaligus membangunkan seluruh rantai gerbang
Service/pembayaran yang justru dihindari `client_id` nullable.

### 2.3 🟡 Gap H-1 jurnal Content Creator → "jalan rekomendasi" — DIBANGUN

Karena SCS dapat mesin sendiri, rekomendasi itu berhenti butuh entitas apa pun:
jurnalnya cukup **satu baris `scs_kategori`** — `KOORDINASI`,
`is_standing = true`, nol SLA. Nol tabel, nol prefix, nol mesin baru.

### 2.4 🟡 KPI Profile M14 peran gabungan → tetap ditunda

Dan sekarang **dijaga tes**, bukan cuma catatan: satu tes memindai
`performance.ts` dan gagal kalau ia mengimpor `scs` — cermin penjaga D5 yang
sama untuk `dailyops`.

---

## 3. Yang BUTUH pemilik, dan kenapa tidak ditebak

**21 nama Kategori + 8 label Sub Type belum ada, dan tidak dikarang.**

Dokumen sumbernya, `CDPS_GapAnalysis_LeaderVideo_CreativeDailyOps.md`, dirujuk
PRD dan backlog M19 tapi **tidak ada di repo maupun di Google Drive** (dicari
keduanya). Ia kemungkinan dokumen yang diunggah ke sesi sebelumnya dan tidak
pernah di-commit.

Yang dilakukan sebagai gantinya, dicatat sebagai `M19-SCS-KATEGORI-DATA`:
taksonomi dibuat **admin-managed** (tabel `scs_kategori`, layar
`/creative/scs/kategori`), dan seed migrasinya **hanya empat Kategori yang
benar-benar terbukti di sumber**:

| Kode | Nama | standing | SLA | Dari mana |
|---|---|---|---|---|
| `SCRIPT` | Script | tidak | 24 jam | baris sheet `mamimegol: Script, qty 7` |
| `BRIEF` | Brief | tidak | 24 jam | baris sheet `all client: Brief` + ketokan §2.2 |
| `UPLOAD_CHECKLIST` | Upload & Checklist | **ya** | — | baris harian `sagata: qty 1` |
| `KOORDINASI` | Koordinasi | **ya** | — | ketokan Gap H-1 (§2.3) |

`sub_type` sengaja teks bebas, bukan CHECK constraint — mengunci delapan nama
berarti satu migrasi untuk setiap koreksi taksonomi.

**Dua jalan, keduanya sah:** Leader mengisinya sendiri lewat layar (nol migrasi,
bisa hari ini), atau kirimkan daftarnya ke sesi berikutnya untuk di-seed
sekaligus. **Pola "Task Additional" (Gap I)** juga menunggu dokumen yang sama.

---

## 4. TASK BERIKUTNYA — browser UAT enam layar, lalu enam butir Sales

Migrasi dan merge **sudah selesai** (§1.1). Yang tersisa dari M19 bukan lagi
kode, melainkan **satu-satunya jenis verifikasi yang belum pernah dijalankan**.

> **Langkah demi langkah untuk keempat butir §4.1–§4.4 ada di
> `TUTORIAL_UAT_M19_SALES_DRIFT_20260909.md`** — persiapan lingkungan (DB,
> fixture, EMPAT aktor termasuk Creative lead + OD murni yang seed TIDAK punya,
> token, dua server), tabel PASS/FAIL per butir per layar, cara mengisi
> taksonomi Kategori, cara membaca hasil drift check, dan **daftar pekerjaan
> belum selesai yang diperbarui** (tutorial §5, superset dari §8 di bawah).

### 4.1 🔴 Browser UAT — utang yang menumpuk dari DUA PR

Ini butir prioritas sesi berikutnya, dan alasannya spesifik: **keenam layar bisa
gagal murni secara visual**. `next build` sukses, typecheck bersih, 736 tes
`web-internal` hijau — dan grid-nya tetap bisa salah, karena tidak satu pun tes
itu me-render halaman di browser sungguhan.

Harness B2 sudah ada dan Chromium sudah terpasang:

```bash
node scripts/dev-jwt.mjs   ...   # cookie sesi lokal, klaim dari employee_claims()
node scripts/browser-tour.mjs --token "$(cat token.txt)" --pages pages.json
```

**Minimal empat aktor** untuk semuanya: staff Creative, lead Creative, OD,
Director — gerbang tampilannya berbeda di keempatnya.

**Tiga layar dari PR #334** (`/creative/schedule`, `/creative/schedule/rekap`,
`/creative/ketersediaan`). Yang harus dilihat, bukan cuma "200":
- grid menampilkan **keempat** studio termasuk yang nol slot ("Bebas");
- dua slot bertumpang **keduanya** tampil, yang bertumpang bergaris kuning;
- menyimpan slot yang bentrok memunculkan **"Tersimpan, dengan catatan"** —
  bukan pesan galat merah (warn-not-block adalah PERILAKU, D3/D4);
- halaman rekap menampilkan kalimat "bukan KPI";
- halaman ketersediaan menampilkan kotak "Ini bukan pengajuan cuti".

**Tiga layar dari PR #335** (`/creative/scs`, `/creative/scs/rekap`,
`/creative/scs/kategori`):
- baris tanpa klien menampilkan **"Semua klien"**, bukan sel kosong (sel kosong
  terbaca seperti data yang gagal dimuat);
- baris Kategori standing menampilkan penanda **"· standing"**;
- tombol aksi **berbeda** antara PIC baris itu dan lead — staff bukan-PIC tidak
  boleh melihat "Mulai"/"Submit" sama sekali;
- halaman rekap menampilkan kalimat **"Angka ini bukan KPI"**;
- layar Kategori: memilih standing = ya **mengosongkan dan mematikan** input
  SLA (kalau tidak, server menolaknya dan penolakannya jadi kejutan).

### 4.2 🟡 Browser UAT enam butir feedback Sales

Terbuka sejak sebelum M19 (`HANDOFF_FEEDBACK_SALES_TUTUP_20260909.md` §2.2).
Belum berubah, dan sekarang jadi tetangga sealur dengan §4.1 — dua-duanya
menunggu sesi yang menyalakan browser.

### 4.3 🟡 Isi 21 Kategori + 8 Sub Type (butuh pemilik — lihat §3)

Tidak memblokir apa pun: modulnya jalan penuh dengan empat Kategori seed.
Jalannya lewat layar `/creative/scs/kategori`, nol migrasi.

### 4.4 Drift check penuh sekali dari operator/CI

`bash scripts/check-live-drift.sh` harus nol MISSING. Tidak berfungsi dari
sandbox Claude Code (§1.1).

## 5. Delapan hal yang paling mudah dirusak sesi berikutnya

1. **Kosakata state mesin #34 HARUS identik `brief_task`.** "Merapikan"
   `[Approved]` jadi `[Selesai]` tidak menggagalkan apa pun secara mencolok —
   Speed Score seluruh baris SCS diam-diam jadi `null`, karena
   `computeMetrics` mencari nama-nama itu di `audit_log`.
   `packages/db/src/scs.registry.test.ts` membandingkan HIMPUNAN state dan edge
   kedua mesin; ia yang merah lebih dulu.
2. **`scs_tasks.client_id` HARUS tetap nullable.** Sebuah `NOT NULL` yang
   ditambahkan "untuk kebersihan data" membatalkan ketokan `M19-SCS-ENGINE` dan
   mengembalikan baris "all client" ke Google Sheets. Ada tesnya.
3. **Baris ber-`client_id` NULL tidak boleh masuk angka per-klien.** Setiap
   query per-klien wajib `client_id is not null`. Tabelnya **nol view** dengan
   sengaja — satu tes memaku ketiadaan itu, karena view adalah jalan tersembunyi
   ke M13/M6D/M15.
4. **Kategori standing ⇒ Speed Score `N/A`, bukan `0%`.** CHECK
   `ck_kategori_standing_tanpa_sla` memaksa `sla_jam IS NULL`; halaman tidak
   boleh menghitung persen sendiri (`pct ?? 0` merender "0%").
5. **`canWorkTask` LEBIH SEMPIT daripada gerbang M19.** Hanya PIC baris itu —
   lead pun tidak. Lead yang menandai baris orang lain `[In Progress]`
   memalsukan jangkar turnaround-nya. Kebalikannya `[Blocked]`: lead-saja,
   karena waktunya dikurangkan dari turnaround.
6. **Nol state pembatalan, dan itu keputusan.** Penggantinya DELETE yang
   dibatasi `[To Do]` (`trg_scs_tasks_hapus_hanya_todo`). Tanpa batas itu,
   "hapus lalu catat ulang" adalah cara termudah menghapus revisi dan
   keterlambatan dari catatan performa.
7. **`performance.ts` tidak boleh mengimpor `scs` maupun `dailyops`.** Dua tes
   memindainya. Mengimpor salah satunya membatalkan penundaan KPI M14 (atau D5)
   tanpa entri `DECISIONS.md`.
8. **Teardown tes SCS mematikan trigger DELETE secara eksplisit.** Itu bukan
   kecerobohan — trigger `[To Do]`-only menolak DELETE bahkan dari service-role,
   dan teardown yang diam-diam gagal menumpuk baris antar-run sampai hitungan
   tes berikutnya salah (persis yang terjadi saat berkas itu pertama dijalankan).

---

## 6. Dua bug yang ditemukan dengan MENJALANKAN, bukan dengan membaca ulang

Keduanya lolos typecheck dan lolos review mata sendiri:

1. **`ck_scs_submit_butuh_link` ditulis NEGATIF** (`status IN ('[To Do]',
   '[In Progress]')`) dan karena itu melewatkan `[Blocked]` — sebuah state KERJA
   yang dicapai dari `[In Progress]` justru SEBELUM ada hasil apa pun. Akibatnya
   **setiap** `blockScsTask` gagal dengan galat constraint mentah. Diperbaiki
   jadi daftar POSITIF (state yang MENUNTUT link).
2. **`submitScsTask` melempar SECARA SINKRON.** Ia `function` biasa yang
   `throw` sebelum `return drive(...)`, jadi pemanggil tidak pernah menerima
   promise dan galatnya lolos ke luar `try` — route handler-nya akan sama
   pecahnya. Diperbaiki jadi `async function`.

---

## 7. Jebakan lingkungan (kena sesi ini)

- **`postgres` tidak punya password** di cluster lokal: `db-rebuild.sh` gagal
  "password authentication failed" walau `pg_isready` hijau. Perbaikannya
  `su postgres -c "psql -c \"alter user postgres with password 'postgres';\""`.
- **`node_modules` kosong** di tiga workspace (`make install`).
- **`DATABASE_URL` tidak di-set** — yang paling berbahaya: seluruh tes DB/RLS
  di-skip diam-diam dan `make test` tetap lapor hijau. Patokan jumlah tes yang
  **jalan** ada di §1; kalau `db` melaporkan 0, variabelnya tidak sampai.
- **`audit_log` menolak DELETE**, termasuk dari service-role — jangan taruh
  pembersihan `audit_log` di `afterEach` (aturan rumah #3 bekerja).

---

## 8. Yang masih terbuka di luar M19

Belum berubah, dan tidak satu pun disentuh sesi ini:

| # | Apa | Catatan |
|---|---|---|
| **LT-2 / LT-8** | pipeline tahapan Store Operation | **ditahan pemilik 2026-09-08 — jangan tanya ulang** |
| **LT-1** | bobot KPI Store Operation | masih 0 |
| **O75** | Service tidak punya jalur ke Done | edge `[In Execution] → Done` ADA di `sm_edges` dengan **nol pemanggil** |
| **O76** | asal floor GMV bulanan | sisa O57 (b) yang K-2 tidak tutup |
| **A2-DRIFT** | migrasi live tanpa berkas yang cocok di `main` | ditemukan 2026-09-08. **Namanya kini konkret** (§1.2): `d3_tutup_buku_pulihkan_komentar_jaga_transisi`, plus baris ledger ganda `m6a_section_d`. Terpisah dari M19 |
| **M19-SCS-KATEGORI-DATA** | 21 Kategori + 8 Sub Type | §3 — data, bukan kode; nol yang terblokir |

Daftar yang lebih lengkap (verifikasi, data, cacat teknis, ketokan pemilik —
termasuk O59-b/O60/O48, KS-4, B23-SHP, REV-1…4, dan celah ±50 label notifikasi)
ada di `TUTORIAL_UAT_M19_SALES_DRIFT_20260909.md` §5.

Urutan yang disarankan untuk sesi berikutnya: **§4.1 browser UAT lebih dulu**
(ia utang verifikasi atas kode yang sudah berjalan di live), lalu §4.2, lalu
pilih dari tabel ini.
