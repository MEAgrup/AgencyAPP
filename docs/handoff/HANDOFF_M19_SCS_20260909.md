# Handoff — M19 separuh SCS selesai (2026-09-09)

**Baca ini lebih dulu di sesi baru.** Pendahulunya:
`HANDOFF_LANJUTAN_M19_20260909.md` (empat pertanyaan yang dijawab sesi ini),
`HANDOFF_M19_CREATIVE_DAILY_OPS_20260909.md` (separuh jadwal harian).

---

## 1. Posisi

| Apa | Nilai |
|---|---|
| Branch | `claude/peaceful-wozniak-25acg5` — **belum ada PR** (tidak diminta) |
| Migrasi di repo | **217** (`20260928010000_m19_scs_task_engine.sql`) |
| Gate repo | **155 tabel · 43 entity_prefix · 34 sm_machines · 73 notif_events** |
| Live `CDPS SG` | **216 migrasi — M19 separuh SCS BELUM diterapkan** (lihat §4) |
| Tes | core 985 · db 98 · domain 2355 (+1 skip) · apps/api 496 · web-internal 736 |
| Typecheck | bersih di 6 target |
| Lint | 3 error + 61 warning — **identik baseline**, semuanya pre-existing |

**Yang berubah sejak handoff sebelumnya, dan perlu diketahui:** PR #334 sudah
**di-merge** (2026-09-09 16:55 UTC) dan migrasi M19 separuh jadwal harian
**sudah diterapkan ke live** — live sekarang 153 · 42 · 33 · 73. Langkah §2.1
handoff sebelumnya karena itu **sudah selesai**, bukan tertunda.

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

## 4. Langkah berikutnya, berurutan

### 4.1 Terapkan migrasi ke live — **belum dilakukan, dan sengaja**

```
apply_migration  20260928010000_m19_scs_task_engine.sql   ← satu berkas, satu panggilan
```

O65 dan preseden 2026-09-09: **migrasi dulu, merge kemudian**. Sesi ini
**tidak** menerapkannya karena tidak ada PR yang diminta dan karenanya tidak ada
merge yang diurutkan terhadapnya — menulis ke basis data produksi untuk cabang
yang belum ditinjau siapa pun adalah keputusan pemilik, bukan keputusan sesi.

Jangan `supabase db push`. Jangan `psql -f` (itu yang melahirkan drift O38).
Verifikasi angka di live sesudah apply: **155 · 43 · 34 · 73**.
`scripts/check-live-drift.sh` harus nol MISSING — **tidak berfungsi dari sandbox
Claude Code** (egress Supabase diblok kebijakan org); jalankan dari operator
atau CI runner. (Catatan: `mcp__Supabase__execute_sql`/`apply_migration` LEWAT
dari sandbox — itu yang dipakai sesi ini untuk memverifikasi posisi live.)

### 4.2 Browser UAT — **belum dilakukan** (dua bagian)

Yang tertunggak dari handoff sebelumnya (§2.2, tiga layar jadwal harian) **plus**
tiga layar baru sesi ini. Ketiganya bisa gagal **murni secara visual**:
`next build` sukses, nol error, tabelnya salah.

```bash
node scripts/dev-jwt.mjs   ...   # cookie sesi lokal, klaim dari employee_claims()
node scripts/browser-tour.mjs --token "$(cat token.txt)" --pages pages.json
```

Halaman lama: `/creative/schedule`, `/creative/schedule/rekap`,
`/creative/ketersediaan`. Halaman baru: `/creative/scs`, `/creative/scs/rekap`,
`/creative/scs/kategori`. **Minimal empat aktor**: staff Creative, lead
Creative, OD, Director.

Yang harus dilihat di layar baru, bukan cuma "200":
- baris tanpa klien menampilkan **"Semua klien"**, bukan sel kosong;
- baris Kategori standing menampilkan penanda **"· standing"**;
- tombol aksi yang muncul **berbeda** antara PIC baris itu dan lead — staff
  bukan-PIC tidak boleh melihat "Mulai"/"Submit" sama sekali;
- halaman rekap menampilkan kalimat **"Angka ini bukan KPI"**;
- layar Kategori: memilih standing = ya **mengosongkan dan mematikan** input SLA.

### 4.3 Sisa yang tidak berubah

**§2.2 browser UAT enam butir feedback Sales** masih terbuka dari handoff
sebelumnya.

---

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

Belum berubah: **LT-2/LT-8** (pipeline tahapan Store Operation, ditahan pemilik
2026-09-08 — jangan tanya ulang), **LT-1** (bobot KPI Store Operation, masih 0),
**O75** (Service tidak punya jalur ke Done — edge `[In Execution] → Done` ada di
`sm_edges` dengan nol pemanggil), **O76** (asal floor GMV bulanan), **A2-DRIFT**.
