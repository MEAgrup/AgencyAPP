# CDPS — Module 18: Store Operation

**Status:** Ketokan pemilik lengkap — K-4/K-5/K-6/K-7 (`docs/DECISIONS.md` 2026-09-07) + pembagian peran AM ⇄ Store Ops (Nerissa/COO, 2026-09-08)
**Worked example:** Alpha Digital, Brief Store Ops berisi 5 baris SKU — 3 `Shopee New`, 2 `Tiktok Revision`
**Depends on:** Module 6 (Brief), Module 6B (Plan), Module 12 (Task Execution), Module 16 (Lead Time), Module 14 (Team Performance — bobot masih 0)

---

## 1. Background

Store Operation adalah divisi keenam yang mencoba CDPS pada putaran Feedback OD, dan satu-satunya yang keluhannya tidak bisa dijawab dengan perbaikan: **modulnya memang belum ada.** Sampai Wave 3, Store Ops adalah satu baris registry divisi (`packages/core/src/division.ts:83`) — nol PRD, nol tabel, nol rute, nol halaman, dan pipeline tahapannya sengaja dikosongkan (LT-2).

Pekerjaan mereka, dari worksheet yang divisi itu pakai hari ini, adalah **produksi dan upload gambar SKU klien** di Shopee/TikTok Shop/CPAS: satu Brief dari AM membawa sejumlah SKU, tiap SKU digarap sendiri-sendiri, hasilnya ter-upload, lalu **±30 hari kemudian** dampaknya (CTR/CVR/rating) dibaca dari Seller Center dan dibandingkan dengan target.

Bentuk itu — **1 Brief → n unit kerja** — persis bentuk yang sudah dipikul Creative (`AST-`) dan KOL (`BKG-`). Modul ini karena itu **tidak menciptakan pola baru**; ia memberi Store Ops unit kerjanya (K-5) dengan satu hal yang tidak dimiliki divisi lain: **dua penulis pada satu baris.**

---

## 2. Rules

1. **Store Operation adalah divisi eksekusi biasa** di `division_registry` (`brief_assignable=true`, `dispatch_target=true`, `vendor_managed=false`). Tidak ada jalur istimewa. Brief masuk lewat jalur yang sama: AM menurunkan baris Plan → Brief → divisi mengerjakan → AM review.

2. **Satu Brief Store Ops pecah jadi n baris SKU** (`SKU-YYYYMM-NNNN`, tabel `sku_optimizations`), satu baris per SKU yang dioptimasi. Pola induk-anak persis `assets`/`creator_bookings`: FK ke `briefs`, `sequence_no` unik per Brief, slot yang kosong dipakai ulang. **K-5.**

3. **SATU BARIS, TIGA MOMEN, DUA PENULIS.** Ketokan pemilik 2026-09-08: *"Daftar jenis SKU yang dioptimasi diisi oleh AM, beserta targetnya. Store Ops menjalankan dan mengevaluasi."*

   | Momen | Siapa | Menulis apa |
   |---|---|---|
   | 1. Lahir | **AM** | SKU mana, jenis permintaan, jenis gambar, jumlah gambar, tenggat, dan **target** |
   | 2. Eksekusi | **Store Ops** | hasil kerja — **selesai saat gambar ter-upload** |
   | 3. Evaluasi | **Store Ops** | CTR / CVR (+rating) sesudah ±30 hari — **langkah terpisah** |

4. **Target WAJIB diisi saat baris lahir.** `target_ctr` dan `target_cvr` `NOT NULL` di DB — terjemahan langsung dari *"beserta targetnya"*. Baris SKU tanpa target adalah baris yang evaluasinya nanti akan diisi oleh orang yang sudah tahu hasilnya. `target_rating` opsional: rating tidak selalu bergerak untuk tiap SKU, dan K-6 menyebut CTR/CVR sebagai yang wajib.

5. **Kolom target read-only bagi Store Ops; kolom hasil read-only bagi AM — ditegakkan di DB.** Trigger `trg_sku_dinding`, **bersyarat-STATE** (preseden `trg_strategi_target_guard_floor`, O57 (b)):
   - cakupan + target **beku** begitu baris meninggalkan `[Belum Dikerjakan]`;
   - hasil + dampak **ditolak** selama baris masih `[Belum Dikerjakan]`;
   - jangkar `terupload_pada`/`dievaluasi_pada`/`dibatalkan_pada` **sekali tulis**;
   - `link_output` beku setelah `[Terupload]`; angka dampak beku setelah `[Dievaluasi]`.

   **Kenapa bersyarat-state, bukan bersyarat-aktor.** Trigger yang bertanya "siapa yang menulis ini" hanya punya satu sumber jawaban di CDPS — klaim JWT — dan setiap tulisan domain masuk lewat koneksi service-role yang nol klaim. Trigger bersyarat-aktor karena itu akan **diam untuk persis jalur yang ia klaim jaga**: teater, bukan dinding. Pembagian peran yang sesungguhnya dipikul bertingkat: gerbang peran + pesan BI di `packages/domain`, RLS untuk siapa yang barisnya kelihatan, dan trigger ini untuk kolom mana yang masih boleh bergerak. Yang terakhir adalah satu-satunya yang tidak bisa dilewati siapa pun.

6. **`assigned_pic` milik Store Ops, bukan AM.** Menugaskan nama orang adalah wewenang lead divisi — **K-1/A-5**. AM menetapkan **cakupan** (apa + target), lead divisi menetapkan **siapa**. Kalau ada yang mengira Rule 3 adalah regresi K-1, Rule inilah jawabannya: baris SKU adalah cakupan, bukan penugasan.

7. **"Selesai" TIDAK menunggu angka dampak — K-6.** SKU selesai saat gambar ter-upload (`[Terupload]`: `terupload_pada` + `link_output`, **nol kolom dampak disebut**). CTR/CVR wajib, tapi di langkah review kemudian (`[Dievaluasi]`). Kalau keduanya digabung, leadtime **produksi** Store Ops ternoda waktu tunggu pasar, dan angka leadtime yang mengukur dua hal sekaligus tidak mengukur apa pun.

8. **`[Terupload]` adalah "selesai", dan ia sengaja BUKAN state terminal.** Konsekuensi yang wajib dibawa setiap pembacanya: **rollup "selesai" membaca `[Terupload]` ATAU `[Dievaluasi]`.** Rollup yang hanya membaca `sm_terminal_states` akan memperlihatkan produksi Store Ops mandek sebulan penuh setiap kali. Ini pelajaran B-1a dalam bentuk lain — progres yang mati diam lebih buruk daripada nol progres.

9. **Nol kolom turunan** (aturan rumah #4). `On Time`/`Late`, `%Ontime`, `% SKU Gagal Upload`, dan `% Achievement` dihitung saat baca dari jangkar + target, tidak pernah disimpan. Rumusnya di §5.

10. **Satu jangkar untuk "Actual Done" dan "Upload Date".** Worksheet menulis keduanya; keduanya momen yang sama — saat gambar ter-upload. `terupload_pada` melayani dua-duanya dan menjadi titik nol baseline *"rata-rata 30 hari sebelum"*. Dua kolom untuk satu fakta adalah dua jawaban yang menunggu berbeda.

11. **Nol loop revisi per baris SKU.** `Shopee Revision`/`Tiktok Revision` adalah **jenis permintaan** — baris SKU tersendiri, bukan putaran review di dalam satu baris. Worksheet Store Ops tidak mengenal putaran itu, dan mengarangnya berarti menambah transisi yang tidak ada spesifikasinya.

12. **Kosakata worksheet dipakai harfiah, dan ia tertutup.** Tujuh `request_type` dan empat `jenis_gambar` di §3 adalah CHECK constraint, bukan teks bebas. Menambah nilai = satu migrasi + satu baris di PRD ini.

13. **Pembatalan baris SKU digerbang lead divisi** (`require_lead=true`). Membatalkan baris mencabutnya dari penyebut `%Ontime`, dan orang yang sedang diukur tidak boleh bisa mencabut ukurannya sendiri — gerbang yang sama dengan alasan M12 §5.3a mengunci `[Blocked]` ke SPV/Lead.

14. **Bobot M14 = 0 saat rilis.** Lead time Store Ops terukur dan terlihat sejak hari pertama, tapi belum menggerakkan skor performa sampai COO menetapkan bobot (`DECISIONS.md` LT-1). Selama itu benar, performa Store Ops merender `—`, bukan `0` — pembagian-nol merender `—` (aturan rumah #7).

---

## 3. Kosakata

### 3.1 `request_type` — tujuh nilai

| Nilai | Arti |
|---|---|
| `Shopee New` | SKU baru di Shopee, gambar dari nol |
| `Shopee Revision` | SKU Shopee yang gambarnya diperbaiki |
| `Shopee Additional` | Tambahan gambar untuk SKU Shopee yang sudah ada |
| `Tiktok New` · `Tiktok Revision` · `Tiktok Additional` | Tiga di atas, untuk TikTok Shop |
| `CPAS New` | Materi untuk kampanye CPAS |

### 3.2 `jenis_gambar` — empat nilai

`Cover Only` · `Cover + Pendamping` · `Varian + Pendamping` · `Iklan CPAS`

---

## 4. Mesin status

Mesin **#32** `store_ops_sku` (`docs/STATE_MACHINES.md` §22):

```
[Belum Dikerjakan] → [Dikerjakan] → [Terupload] → [Dievaluasi]   (terminal)
[Belum Dikerjakan] → [Dibatalkan]                                 (terminal, lead)
[Dikerjakan]       → [Dibatalkan]                                 (terminal, lead)
```

| From → To | Gerbang | Yang wajib ada |
|---|---|---|
| `[Belum Dikerjakan]` → `[Dikerjakan]` | PIC Store Ops | — (sejak sini **cakupan + target beku**) |
| `[Dikerjakan]` → `[Terupload]` | PIC Store Ops | `link_output` + `terupload_pada`. **Nol angka dampak** — Rule 7 |
| `[Terupload]` → `[Dievaluasi]` | Store Ops | `ctr_sebelum`, `cvr_sebelum`, `ctr_sesudah`, `cvr_sesudah`, `dievaluasi_pada` |
| → `[Dibatalkan]` | **lead divisi** | `alasan_pembatalan` + `dibatalkan_pada` |

**Nol edge mundur.** Tidak ada `[Terupload]` → `[Dikerjakan]` (`terupload_pada` beku ⇒ barisnya akan punya jangkar produksi yang sudah lewat sementara statusnya bilang belum) dan tidak ada "buka kembali" dari `[Dievaluasi]` (ia memindahkan angka yang sudah dilaporkan ke klien). Salah upload ⇒ baris SKU baru. Salah angka ⇒ keputusan pemilik lebih dulu, pola mesin #20/#21.

---

## 5. Angka turunan — rumusnya, dan kenapa tidak disimpan

Semua dihitung saat baca dari kolom yang sudah beku. Tidak satu pun jadi kolom (aturan rumah #4), sehingga tidak ada angka yang bisa berbohong terhadap jangkarnya dan semuanya recomputable.

| Angka | Rumus | Catatan |
|---|---|---|
| **On Time / Late** (per baris) | `(terupload_pada AT TIME ZONE 'Asia/Jakarta')::date <= expected_done` | Baris yang belum `[Terupload]` dan `expected_done` sudah lewat = **terlambat berjalan** |
| **%Ontime** (per Brief / periode) | `# On Time ÷ # baris yang sudah [Terupload]/[Dievaluasi]` | Baris `[Dibatalkan]` **keluar dari penyebut** — itulah kenapa pembatalan digerbang lead (Rule 13) |
| **% SKU Gagal Upload** | `# baris lewat expected_done yang belum [Terupload] ÷ # baris aktif` | |
| **% Achievement** | `ctr_sesudah ÷ target_ctr` dan `cvr_sesudah ÷ target_cvr` | Verdict `achieve` bila ≥ 100%, selain itu `under target`. **Pembagi nol ⇒ `—`**, bukan galat (aturan rumah #7) |
| **Progres Brief "n dari N"** | `n` = baris `[Terupload]`/`[Dievaluasi]`, `N` = baris non-`[Dibatalkan]` | Rule 8. `N` juga tersedia lewat `private.brief_jumlah_anak` untuk baris antrean |

`private.brief_jumlah_anak` (A-req-3) mendapat **cabang Store Operation**, bukan fungsi kedua — dua fungsi yang menjawab "berapa anaknya" adalah dua jawaban yang menunggu berbeda. Angka itu menghitung **semua** baris termasuk `[Dibatalkan]`: ia menjawab *"Brief ini sudah dipecah jadi berapa unit kerja"*, bukan *"berapa yang masih hidup"*.

---

## 6. Permission

| Peran | Baris SKU |
|---|---|
| **AM pemilik klien** | Buat baris (cakupan + target); baca semua baris Brief-nya; **tidak** boleh menulis hasil/dampak, dan **tidak** boleh menggeser target setelah pekerjaan dimulai |
| **Lead/SPV Store Operation** | Baca seluruh divisinya; tugaskan `assigned_pic`; batalkan baris |
| **Staff Store Operation** | Baca baris yang ditugaskan padanya; tulis hasil + dampak; **tidak** boleh menyentuh cakupan/target |
| **OD / Director** | Baca semua (OD read-only) |
| **Divisi lain** | **Nol akses** — tidak ada halaman divisi lain yang membaca baris SKU |

RLS `sku_optimizations_select` mencerminkan tabel di atas dengan empat arm. Arm AM memakai pintu `private.brief_owner_am` **SECURITY DEFINER**, bukan join `briefs`/`services`/`clients` di dalam predikat — itu perangkap O52, dan ia **membuang barisnya** alih-alih mengosongkan kolomnya: halaman menjawab 404, bukan 403, sementara seluruh suite domain tetap hijau karena koneksi tes BYPASSRLS.

`GRANT SELECT ... TO authenticated` wajib menyertainya: `readAsActor` berpindah ke role `authenticated` sebelum membaca, dan tanpa GRANT policy-nya tidak pernah sempat dievaluasi.

---

## 7. Definition of Done

Di luar DoD standar `CLAUDE.md`:

- [x] Pembagian peran Rule 3/5 ditegakkan **di DB**, dan ada tes yang menulis dari sisi yang salah lalu **diharapkan gagal**.
- [x] `[Terupload]` **tidak** menuntut satu pun angka dampak, dan ada tesnya (Rule 7 / K-6).
- [x] `[Dievaluasi]` menuntut CTR/CVR sebelum & sesudah.
- [x] Gate baru di `scripts/db-rebuild.sh` **dan** `.github/workflows/ci.yml`, angkanya dari hasil rebuild: **147** tabel · **41** prefix · **32** mesin · **73** event.
- [x] Tes RLS dengan `withClaims` + `SET LOCAL ROLE authenticated`: staff Store Ops melihat barisnya sendiri, AM pemilik melihat semuanya, divisi lain tidak.
- [ ] Rollup memperlihatkan "n dari N", tidak mati diam (Rule 8) — **PR 2**.
- [ ] `KNOWN_GAPS` di `route-parity.test.ts` tetap kosong — **PR 2/3** (PR ini nol rute).

---

## 8. Cakupan bertahap

| PR | Isi | Status |
|---|---|---|
| **1** | PRD ini · prefix `SKU` · tabel + trigger + mesin · gate | **berkas ini** |
| **2** | Domain: buat/tugaskan/kerjakan/upload/evaluasi + rollup Brief · pipeline `STORE_OPS` (menutup LT-2) + kode alasan pengembalian brief (menutup LT-8) | berikutnya |
| **3** | `StageTimelinePanel` di `/tasks/[id]` (**memperbaiki gerbang intake SEMUA divisi**, bukan cuma Store Ops) · halaman `store-ops/` | berikutnya |
| **4** | `account.TASK_CATALOG` diisi **lalu** `punyaKuotaSatuan: true` — urutan itu wajib, `division.ts:48-52` · bobot KPI M14 | berikutnya |

⚠️ Butir PR 4: `division.ts:48-52` memperingatkan bahwa membalik `punyaKuotaSatuan` sebelum `TASK_CATALOG` punya barisnya akan meng-crash komparator `normalizeTasks` di `undefined`. Isi katalog dulu, nyalakan flag-nya kemudian, dalam commit yang sama, dengan tesnya.

---

## 9. Yang sengaja TIDAK ada di v1

- **Nol kolom `actual_done`/`upload_date` terpisah** — Rule 10.
- **Nol bobot M14** — Rule 14.
- **Nol event notifikasi baru** (`notif_events` tetap 73). Notifikasi rollup menyusul bersama mesin rollup-nya di PR 2; mendaftarkan event tanpa emitter lebih dulu tidak membantu siapa pun.
- **Nol pipeline tahapan** — `stage_pipeline` Store Ops masih kosong (LT-2), ditutup PR 2. Konsekuensinya sampai saat itu Store Ops masih belum punya gerbang intake *Terima & proses* / *Brief Dikembalikan ke AM*.
