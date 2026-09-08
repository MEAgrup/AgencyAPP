# CDPS — Module 18: Store Operation

**Status:** Approved by owner 2026-09-08 (ketokan Nerissa/COO — lihat `docs/DECISIONS.md` baris 2026-09-08 "STORE OPS DIKETOK"; ketokan pendahulunya K-4/K-5/K-6 pada baris 2026-09-07)
**Worked example:** Alpha Digital, Brief `BRF-202609-00xx` — 7 baris SKU Shopee, `Cover + Pendamping`
**Depends on:** Module 6 (Brief + dispatch), Module 6A (Strategi / `STRG-`), Module 6B (Plan), Module 12 (Task Execution engine), Module 16 (Lead Time per tahapan), Phase 0 (Role Matrix, ID, audit)

---

## 1. Background

Store Operation adalah divisi eksekusi yang sudah **terdaftar** sejak M16
(`packages/core/src/division.ts`, `division_registry`) tetapi tidak pernah punya
apa-apa selain baris registry itu: nol PRD, nol unit kerja, nol pipeline tahapan
(`20260830020000_m16_stage_seed.sql` mengosongkannya dengan sengaja — M16 Rule 12),
dan nol halaman. Konsekuensi yang dilaporkan divisinya sendiri saat mencoba CDPS
(Feedback OD 2026-09-07, keluhan ke-10): pekerjaan mereka **tidak bisa dicatat sama
sekali** — satu Brief "optimasi 7 SKU" hanya bisa dinyatakan sebagai satu baris
atom yang selesai atau belum, dan siapa pun yang bertanya "SKU mana yang sudah
naik?" tidak punya tempat untuk melihatnya.

Pekerjaan nyata divisi ini, dari worksheet yang mereka pakai hari ini di luar
CDPS, adalah **produksi & upload gambar SKU** klien di marketplace: satu Brief
membawa sejumlah SKU; tiap SKU punya jenis permintaan (Shopee/TikTok/CPAS,
baru/revisi/tambahan), jenis gambar yang diminta, jumlah gambar, tenggat, PIC,
link output, dan — **±30 hari kemudian** — angka dampak (CTR / CVR / rating
sebelum vs sesudah) terhadap target.

Modul ini memberi pekerjaan itu satu entitas, satu mesin status, dan satu dinding
kepemilikan kolom. Ia **tidak** memperkenalkan jalur istimewa: Store Operation
masuk lewat pintu yang sama dengan Creative, Ads, KOL, dan Live Stream — AM
menurunkan baris Plan → Brief → divisi mengerjakan → AM review.

---

## 2. Rules

1. **Unit kerja Store Operation adalah BARIS SKU** (`SKU-`), anak dari `briefs` —
   pola yang sama persis dengan Creative/`AST-` (M7), Ads/`ADC-` (M8), KOL/`BKG-`
   (M9), Live Stream/`LSS-` (M10). Satu Brief → n baris SKU (ketokan K-5).
2. **Satu baris SKU punya TIGA momen dan DUA penulis** (ketokan 2026-09-08):

   | Momen | Penulis | Menulis |
   |---|---|---|
   | 1. Lahir | **AM** | SKU mana, jenis permintaan, jenis gambar, jumlah gambar, tenggat, **target** CTR/CVR/rating |
   | 2. Eksekusi | **Store Operation** | PIC, link output, catatan — **selesai saat gambar ter-upload** |
   | 3. Evaluasi | **Store Operation** | CTR / CVR / rating sebelum & sesudah, **±30 hari kemudian**, langkah TERPISAH |

3. **Kolom cakupan + target adalah READ-ONLY bagi Store Operation; kolom hasil +
   dampak adalah READ-ONLY bagi AM.** Ditegakkan **di DB**, bukan hanya di TS —
   preseden `trg_strategi_target_guard_floor` (O57 (b)). Lihat §6 untuk
   mekanismenya.
4. **`[Terupload]` TIDAK menunggu angka dampak** (ketokan K-6). Sebuah SKU selesai
   diproduksi saat gambarnya ter-upload; CTR/CVR **wajib** tetapi diisi di langkah
   review kemudian, sebagai transisi terpisah `[Terupload] → [Dievaluasi]`.
   Menggabungkannya akan mencemari leadtime **produksi** dengan ~30 hari waktu
   tunggu pasar, dan angka leadtime yang mengukur dua hal sekaligus tidak
   mengukur apa pun.
5. **Ini BUKAN regresi K-1/A-5.** K-1 mencabut hak AM memilih nama *staff*; ia
   tidak mencabut hak AM menetapkan *cakupan*. Baris SKU adalah **cakupan** (apa +
   target), bukan **penugasan** (siapa) — `assigned_pic` per baris SKU tetap diisi
   **leader divisi**, sama seperti PIC per Asset di Creative pasca-K-1.
6. **Nol kolom durasi, nol kolom keterlambatan, nol kolom "tanggal selesai".**
   `actual_done`, "Leadtime On Time/Late", "%Ontime", "% SKU Gagal Upload",
   "% Achievement", dan `achieve`/`under target` **semuanya diturunkan saat baca**
   (aturan rumah #3/#4). Jangkarnya adalah stempel waktu transisi di `audit_log`,
   bukan sebuah tanggal yang diketik. Alasannya di §5.
7. **Status ditulis eksklusif oleh `sm_transition`** (aturan rumah #2). Mesin
   `store_ops_sku`, §4. Tidak ada UPDATE mentah ke kolom `status`.
8. **Kosakata `request_type` dan `jenis_gambar` adalah enum tertutup** dari
   worksheet divisi, hidup di DUA tempat yang dijaga identik: CHECK constraint di
   DB dan konstanta di `packages/core/src/storeops.ts` (pola dual-home yang sama
   dengan `division_registry` ↔ `DIVISIONS` dan `entity_prefix` ↔ `PREFIXES`).
9. **Bobot KPI M14 = 0 saat rilis** — sama dengan AI Optimizer (M17 Rule 8).
   Lead time Store Operation terukur dan terlihat sejak hari pertama, tapi belum
   menggerakkan skor performa sampai COO menetapkan bobotnya (`DECISIONS.md` LT-1).
10. **Baris SKU dibaca DI BAWAH RLS oleh divisi eksekusi.** Setiap angka turunan
    yang butuh melewati `briefs`/`services`/`clients` wajib lewat pintu
    `private.*` SECURITY DEFINER (O52 opsi (b), diketok 2026-08-07) — sebuah
    subquery langsung akan dipersempit policy pembacanya dan mengembalikan angka
    yang **salah tanpa galat apa pun**.

---

## 3. Entitas — baris SKU (`SKU-`)

Tabel `store_ops_skus`, anak `briefs`. ID `SKU-YYYYMM-NNNN`, dicetak **hanya
setelah** validasi field wajib lolos (aturan rumah #1).

### 3.1 Kelompok 1 — cakupan + target. Penulis: **AM**.

| Field | Wajib | Catatan |
|---|---|---|
| `nama_produk` | ✅ | Nama Produk pada worksheet |
| `link_sku` | — | Link SKU di marketplace |
| `request_type` | ✅ | Enum §3.3 |
| `jenis_gambar` | ✅ | Enum §3.4 |
| `total_req_picture` | ✅ | > 0. "Total Req Picture" pada worksheet |
| `expected_done` | — | Tenggat yang dijanjikan. NULL ⇒ leadtime `—`, **tidak pernah di-default diam-diam** (konsisten M16 Rule 8) |
| `target_ctr` | — | Persen. Janji ke klien |
| `target_cvr` | — | Persen |
| `target_rating` | — | 0..5 |
| `catatan_am` | — | |

### 3.2 Kelompok 2 — hasil + dampak. Penulis: **Store Operation**.

| Field | Wajib | Catatan |
|---|---|---|
| `assigned_pic` | — | Diisi **leader** divisi (Rule 5). NULL ⇒ baris belum dibagi |
| `link_output` | ✅ saat `[Terupload]` | Cermin `assets.output_link` (M7) |
| `catatan_ops` | ✅ saat `[Gagal Upload]` | Alasan gagal |
| `ctr_sebelum` · `cvr_sebelum` · `rating_sebelum` | ✅ saat `[Dievaluasi]` | Rata-rata 30 hari **sebelum** upload |
| `ctr_sesudah` · `cvr_sesudah` · `rating_sesudah` | ✅ saat `[Dievaluasi]` | Rata-rata 30 hari **sesudah** upload |

### 3.3 `request_type` — tujuh nilai, dari worksheet

`Shopee New` · `Shopee Revision` · `Shopee Additional` · `Tiktok New` ·
`Tiktok Revision` · `Tiktok Additional` · `CPAS New`

### 3.4 `jenis_gambar` — empat nilai, dari worksheet

`Cover Only` · `Cover + Pendamping` · `Varian + Pendamping` · `Iklan CPAS`

---

## 4. Mesin status `store_ops_sku` (mesin #32)

```
[Menunggu Eksekusi] ──► [Dikerjakan] ──► [Terupload] ──► [Dievaluasi]
                             │  ▲
                             ▼  │
                        [Gagal Upload]
```

| Dari | Ke | `require_lead` | Arti |
|---|---|---|---|
| `[Menunggu Eksekusi]` | `[Dikerjakan]` | — | PIC mulai mengerjakan |
| `[Dikerjakan]` | `[Terupload]` | — | **SELESAI produksi** (K-6). `link_output` wajib |
| `[Dikerjakan]` | `[Gagal Upload]` | — | Upload ditolak marketplace. `catatan_ops` wajib |
| `[Gagal Upload]` | `[Dikerjakan]` | — | Coba lagi pada baris yang SAMA (bukan SKU baru) |
| `[Terupload]` | `[Dievaluasi]` | — | Langkah review ±30 hari. Enam angka dampak wajib |

- **Lahir** `[Menunggu Eksekusi]` — di-INSERT saat AM membuat barisnya, bukan lewat
  `sm_transition` (tidak ada "from state" untuk baris baru), pola `creator_bookings`.
- **Terminal:** `[Dievaluasi]`.
- **Kenapa `[Gagal Upload]` sebuah STATE dan bukan flag:** worksheet divisi
  menghitung "% SKU Gagal Upload" sebagai metrik. Sebuah flag boolean bisa ditulis
  ulang oleh orang yang sedang dinilai; sebuah state meninggalkan baris `audit_log`
  yang tidak bisa dihapus (aturan rumah #3) — mode gagal yang sama dengan alasan
  `internal_tasks` menolak kolom `pernah_terlambat`.
- **Kenapa `[Gagal Upload] → [Dikerjakan]` dan bukan baris SKU baru:** SKU-nya sama,
  targetnya sama, janjinya ke klien sama. Baris baru akan menyembunyikan kegagalan
  pertama dari penyebut "% SKU Gagal Upload".

---

## 5. Angka turunan — semuanya dihitung saat baca

Aturan rumah #4: dihitung, tidak pernah diketik, selalu bisa dihitung ulang dari log.

| Angka | Rumus | Kalau tidak bisa dihitung |
|---|---|---|
| `actual_done` | tanggal (WIB) transisi **pertama** ke `[Terupload]` di `audit_log` | `—` selama belum `[Terupload]` |
| Leadtime | `On Time` bila `actual_done <= expected_done`, selain itu `Late` | `—` bila `expected_done` NULL |
| `%Ontime` (per Brief) | Σ `On Time` ÷ Σ baris ber-`expected_done` | `—` bila penyebut 0 (aturan rumah #7) |
| `% SKU Gagal Upload` (per Brief) | Σ baris yang **pernah** menyentuh `[Gagal Upload]` ÷ Σ baris | `—` bila penyebut 0 |
| `% Achievement` CTR | `ctr_sesudah ÷ target_ctr` | `—` bila target NULL atau 0 |
| Verdict | `achieve` bila `% Achievement >= 100`, selain itu `under target` | `—` bila `% Achievement` `—` |

**Kenapa `actual_done` diturunkan dan bukan kolom.** Worksheet aslinya punya kolom
"Actual Done" yang diketik. Menyalinnya apa adanya berarti menyimpan dua kali fakta
yang sama — sekali sebagai tanggal yang diketik, sekali sebagai stempel transisi
`[Terupload]` di `audit_log` — dan dua salinan satu fakta pada akhirnya berbeda.
Yang lebih berat: kolom yang diketik bisa dimundurkan setelah tenggat lewat, dan
itu menghapus keterlambatan dari catatan orang yang sedang dinilai. Preseden yang
sama sudah diambil dua kali di CDPS: M16 Rule 4 ("durasi tidak pernah disimpan")
dan `internal_tasks` ("NOL kolom keterlambatan"). Konsekuensi yang diterima sadar:
kalau transisi dicatat terlambat, `actual_done` ikut mundur — jawabannya adalah
mencatat transisinya saat kejadian, bukan membuka kolom yang bisa dikarang.

**Kenapa "pernah menyentuh `[Gagal Upload]`" dan bukan "status = `[Gagal Upload]`".**
Sebuah SKU yang gagal lalu berhasil pada percobaan kedua **tetap** pernah gagal.
Membaca status terkini akan melaporkan 0% gagal untuk divisi yang gagal setiap
kali dan mengulang setiap kali. Penyebutnya dibaca dari `audit_log`.

---

## 6. Dinding dua penulis — bagaimana Rule 3 ditegakkan di DB

Masalahnya: jalur tulis CDPS berjalan **privileged** (service role, tanpa klaim
JWT — `packages/db/src/client.ts`, `withClaims` hanya dipakai jalur BACA). Jadi
sebuah trigger yang membaca `jwt_division()` akan melihat NULL pada setiap tulisan
domain dan tidak menjaga apa pun. RLS juga bukan jawabannya, karena RLS tidak
pernah dievaluasi untuk penulis yang BYPASSRLS.

Yang dipakai: **trigger `trg_store_ops_skus_dinding_penulis` + penanda penulis
transaction-local.**

1. Setiap UPDATE ke `store_ops_skus` wajib mendeklarasikan sisinya lebih dulu:
   `select set_config('cdps.sku_writer', 'am' | 'ops', true)` — `true` = **local**,
   jadi ia hilang saat COMMIT/ROLLBACK dan tidak pernah bocor ke sesi berikutnya di
   pooler mode-transaksi (kekhawatiran yang sama dengan `withClaims`).
2. `writer = 'ops'` yang menyentuh kolom Kelompok 1 ⇒
   `[kolom cakupan dan target SKU hanya boleh diisi Account Manager]`.
3. `writer = 'am'` yang menyentuh kolom Kelompok 2 ⇒
   `[kolom hasil dan dampak SKU hanya boleh diisi Store Operation]`.
4. `writer = 'am'` pada baris yang statusnya sudah **bukan** `[Menunggu Eksekusi]` ⇒
   `[cakupan dan target SKU tidak dapat diubah setelah Store Operation mulai mengerjakan]`.
   Ini bagian yang menjawab kekhawatiran aslinya: **target tidak boleh berubah
   setelah hasilnya keluar.**
5. UPDATE **tanpa** penanda ditolak seluruhnya ⇒
   `[baris SKU hanya boleh diubah lewat jalur AM atau Store Operation]` — sehingga
   tidak ada jalur tulis mentah yang lolos, termasuk dari service role.
6. **Satu pengecualian, sempit dan disengaja:** UPDATE yang hanya menyentuh
   `status` (dan `updated_at`) lolos tanpa penanda. Itu pintu `sm_transition`, yang
   sudah punya gerbangnya sendiri (edge + role + audit) dan merupakan satu-satunya
   penulis sah kolom `status` (aturan rumah #2). Melebarkannya lebih dari itu akan
   membuka kembali jalur yang butir 5 tutup.

Tesnya menulis dari sisi yang **salah** dan menuntut kegagalan — dua arah, plus
UPDATE telanjang tanpa penanda.

---

## 7. Pipeline tahapan (M16)

Store Operation mendapat pipeline `STORE_OPS` — menutup `LEADTIME_BACKLOG.md`
LT-2. **Satu migrasi, nol perubahan TS**, persis seperti yang dijanjikan komentar
di `20260830020000_m16_stage_seed.sql` (M16 Rule 12).

`Cek Brief AM → Siapkan Materi → Produksi Gambar → QC internal → Upload → Review Dampak`

| Tahap | `sumber` | `gate_pihak` | Isi |
|---|---|---|---|
| Cek Brief AM | `stage` | — | Gerbang intake wajib semua divisi (M16 Rule 10): *Terima & proses*, atau *Brief Dikembalikan ke AM* + alasan terstruktur |
| Siapkan Materi | `stage` | — | Kumpulkan foto produk, spesifikasi, referensi |
| Produksi Gambar | `stage` | — | Desain cover/pendamping/varian |
| QC internal | `stage` | — | Pemeriksaan internal divisi |
| Upload | `stage` | — | Naikkan ke marketplace ⇒ baris SKU `[Terupload]` |
| Review Dampak | `stage` | — | ±30 hari kemudian ⇒ baris SKU `[Dievaluasi]` |

Target hari kerja per tahap **menyusul dari pemilik**; sampai itu ada, tahap tanpa
target menghasilkan `N/A` dan tidak pernah di-default diam-diam (M16 Rule 8).
Tahap `Review Dampak` sengaja **ada di dalam pipeline** meski jam produksinya sudah
berhenti — supaya langkah evaluasi terlihat sebagai pekerjaan yang tertunggak, bukan
menghilang dari papan. Durasinya dilaporkan terpisah, tidak dijumlahkan ke lead time
produksi (perlakuan yang sama dengan gate `KLIEN`, M16 Rule 9).

---

## 8. Rollup ke Brief

Meniru `task.recomputeBriefRollup` / `kol.recomputeBriefRollup`, dengan satu
perbedaan yang berasal dari K-6:

- Brief Store Operation **siap di-review AM** saat **semua** baris SKU-nya mencapai
  `[Terupload]` atau lebih. **Bukan** `[Dievaluasi]` — menunggu evaluasi berarti
  menahan Brief selama ~30 hari setelah pekerjaannya betul-betul selesai.
- Progres wajib terlihat sebagai **"n dari N"** pada baris antrean dan pada halaman
  Brief (pelajaran B-1a: jangan mati diam). Angkanya lewat
  `private.brief_jumlah_anak`, yang mendapat cabang `'Store Operation'` — **bukan**
  fungsi hitung kedua.
- Baris `[Gagal Upload]` **menahan** rollup: ia belum selesai dan memang harus
  terlihat sebagai penghambat.

---

## 9. Permission (Phase 0 §4 Role Matrix)

| Aksi | Siapa |
|---|---|
| Buat / ubah baris SKU (cakupan + target) | **AM pemilik Service**-nya. Head/SPV Account se-divisi. Director |
| Ubah target setelah eksekusi mulai | **tidak ada** (Rule 3 / §6 butir 4) |
| Tetapkan `assigned_pic` | **Lead/SPV Store Operation** (K-1: siapa = leader divisi) |
| `[Dikerjakan]` / `[Terupload]` / `[Gagal Upload]` | PIC baris itu, atau lead divisinya |
| `[Dievaluasi]` + enam angka dampak | Store Operation (PIC atau lead) |
| Baca | OD & Director di mana pun; AM pemilik atas semua baris Brief-nya; lead Store Operation se-divisi; staff Store Operation atas barisnya sendiri; lead Account |
| Divisi lain | **tidak sama sekali** |

RLS `store_ops_skus_select` mencerminkan baris "Baca" itu persis, meniru
`assets_select`. Karena ia punya lengan `jwt_is_lead()`/`jwt_division()`, ia **tidak**
masuk daftar `expected` ledger O48 (`supabase/tests/rls_checks.sql` §43).

---

## 10. Notifikasi

Katalog Phase 0 v2 §9. Event Store Operation didaftarkan **bersama emitternya**,
bukan sebelumnya — mendaftarkan event yang tak pernah diemisikan hanya membuat
katalog berbohong (preseden `internal_tasks` v9). Brief Store Operation sudah ikut
`BriefSiapReviewAm` / `BriefSelesai` yang ada (B-1), jadi rilis pertama menambah
**nol** event baru.

---

## 11. Yang SENGAJA tidak dibangun

- **Bobot KPI M14** — Rule 9; menunggu COO (LT-1).
- **Integrasi seller center** untuk menarik CTR/CVR otomatis — angkanya diketik
  Store Operation dari seller center (ketokan: "dia yang memegang datanya").
  Menariknya otomatis adalah modul integrasi tersendiri.
- **Notifikasi "waktunya evaluasi" H+30** — butuh job terjadwal tersendiri (pola
  `permintaan_reminder_tick`), tiket terpisah. Sampai itu ada, tahap `Review Dampak`
  di papan tahapan adalah yang membuatnya terlihat.
- **Kuota satuan Plan** — `punyaKuotaSatuan` baru boleh dinyalakan **setelah**
  `account.TASK_CATALOG` punya baris Store Operation, dalam commit yang sama
  (peringatan `division.ts`: membaliknya lebih dulu meng-crash `normalizeTasks`).
