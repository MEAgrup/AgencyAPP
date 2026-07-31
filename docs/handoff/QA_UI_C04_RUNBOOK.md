# RUNBOOK — QA UI C-04 (tiga butir yang menggantung di gate C-04)

> **Status repo saat runbook ini ditulis (2026-07-31):** typecheck bersih · `@cdps/api` **313** ·
> `@cdps/core` **113** · `@cdps/db` **9** · `@cdps/domain` **567** (+1 skip) · `web-internal` **26** ·
> `apps/api build` **hijau** · `web-internal build` **hijau**. Tidak ada pekerjaan kode yang menahan
> QA ini — yang tersisa memang butuh **mata di browser**.
>
> **Semua angka harapan di bawah dihitung dari dua sumber, bukan dikira-kira:**
> (a) live `CDPS SG` dibaca 2026-07-31, (b) rumus di `packages/domain/src/sales.ts` §"Kalkulator
> Service Jasa" + `packages/core/src/money.ts`. Kalau yang muncul di layar berbeda dari kolom
> *"harapan"*, itu FAIL yang sungguhan — bukan selisih interpretasi.

## 0. Apa yang ditutup runbook ini

| Butir | Asal | Kenapa manual |
|---|---|---|
| **QA-1 — badge notifikasi** | eks **SKIP-2** C-03, dipindah ke C-04 2026-07-31 | butuh render di browser; tak bisa diotomatiskan tanpa menyimpan password user produksi sebagai secret |
| **QA-2 — `/master-services`** | sisa seed MSL 2026-07-28 | kontrak API sudah terbukti; **render**-nya belum pernah dilihat di deployment |
| **QA-3 — `/sales/kalkulator`** | idem | regresi C03-F2 (500 karena bigint mentah) paling mahal kalau kembali |

Menutup ketiganya memenuhi **DoD C-04 butir 3** *"login riil semua role lolos di deployment"*
untuk sisi UI, dan menutup satu-satunya butir C-03 yang masih terbuka.

---

## 1. URUTAN WAJIB — baca ini dulu atau bahan ujinya hilang

🔴 **QA-1 HARUS dikerjakan SEBELUM bersih-bersih residu C-03.**

Run C-03 `30600363211` meninggalkan **38 notifikasi belum-dibaca** di produksi. Sebelum 2026-07-31
tabel `notifications` **kosong**. Begitu residu itu dibersihkan (DoD C-04 butir 2), badge tidak
punya apa pun untuk dirender lagi, dan QA-1 kembali jadi SKIP — kali ini tanpa jalan keluar
selain menulis ke produksi lagi. Biaya menulis ke produksi sudah terbukti tidak selalu terlihat
saat dijalankan: `snapshots/scan` run yang sama **mengubah 4 fixture yang tadinya bisa dihapus
menjadi permanen** (`DECISIONS.md` 2026-07-31).

**Urutan: QA-1 → QA-2 → QA-3 → baru bersih-bersih.**

---

## 2. Prasyarat

| | |
|---|---|
| **Target** | `web-internal` **ter-deploy** (bukan `localhost`). API-nya `agency-app-api` |
| **Akun** | kredensial riil, per role. **Jangan** pakai fixture `99%` — kesepuluhnya sudah di-ban GoTrue (O50), jadi login-nya akan gagal dan itu bukan bug |
| **Bukti** | screenshot per butir; simpan hasil ke `docs/handoff/QA_UI_C04_REPORT_<YYYYMMDD>.md` |

### 2.1 Akun mana untuk halaman mana (gate-nya ada di `web-internal/src/lib/nav.ts`)

| Halaman | Gate | Siapa yang bisa |
|---|---|---|
| `/notifications` + badge | **ungated**, tapi isinya **per-penerima** | siapa pun — **tapi lihat §2.2** |
| `/master-services` | **ungated untuk baca** (`msl.canEditMasterServices` hanya menggate tombol ubah) | siapa pun yang login |
| `/sales/kalkulator` | `ownedBy(SALES)` | divisi **Sales**, ATAU layered **Director/OD** |

⇒ Paling efisien: **satu akun Sales** menutup QA-2 + QA-3, lalu QA-1 dengan akun mana pun yang
memenuhi §2.2. Kalau ada akun Sales yang **juga** salah satu dari 38 penerima notifikasi, satu
login menutup ketiganya.

### 2.2 🔴 Pilih akun QA-1 dari 38 penerima — kalau tidak, badge memang tidak akan muncul

38 notifikasi tersebar ke **38 penerima berbeda, tepat 1 notifikasi per orang**. Karyawan aktif
ada **59**. Jadi **21 dari 59 akun tidak punya notifikasi sama sekali** — login dengan salah satu
dari mereka menghasilkan bell tanpa badge, dan itu **benar**, bukan FAIL.

Baca dari live dulu, jangan menebak (kueri ini read-only):

```sql
-- Siapa yang punya unread (pakai salah satu dari daftar ini untuk QA-1)
select n.recipient_employee_id, e.divisi, e.jabatan, n.entity_id, n.deep_link
from public.notifications n
join public.employees e on e.employee_id = n.recipient_employee_id
where n.read_at is null
order by e.divisi, e.jabatan;

-- Sanity: harus 38 / 38 / 38
select count(*) as total, count(*) filter (where read_at is null) as unread,
       count(distinct recipient_employee_id) as penerima
from public.notifications;
```

---

## 3. QA-1 — Badge notifikasi (eks SKIP-2)

Login sebagai salah satu dari 38 penerima (§2.2).

| # | Langkah | Harapan **persis** | ✅/❌ |
|---|---|---|---|
| 1 | Lihat bell di header | Badge angka **`1`** — **bukan `38`**. Tiap penerima hanya punya 1 notifikasi; `38` adalah total sistem, dan badge sengaja per-penerima (Phase 0 §9) | |
| 2 | Klik bell | Pindah ke `/notifications`. Sub-judul: **`1 belum dibaca`** | |
| 3 | Baca kartunya | Judul `m14.performance.published` (**tebal** = unread) · baris kedua `performance_snapshot PERF-202606-00xx · oleh system · <tanggal id-ID>` | |
| 4 | Centang **Hanya yang belum dibaca** | Kartu tetap ada (masih unread) | |
| 5 | Klik **Tandai Dibaca** | Tombol → `Memproses...`, lalu daftar reload; judul jadi tidak tebal, tombol **hilang**; sub-judul jadi **`0 belum dibaca`** | |
| 6 | Centang **Hanya yang belum dibaca** lagi | **`Tidak ada notifikasi.`** | |
| 7 | Lihat bell **tanpa reload halaman** | ⏱️ Badge hilang **dalam ≤30 detik**, **tidak seketika** — `useUnreadCount` polling 30 s (`web-internal/src/lib/use-unread-count.ts`). **Badge yang belum hilang di detik ke-2 BUKAN FAIL**; yang FAIL adalah badge yang masih ada setelah 30 s | |
| 8 | Reload penuh (F5) | Badge tetap tidak ada; `/notifications` tetap menampilkan kartu itu sebagai sudah-dibaca (persisten, bukan state klien) | |
| 9 | **Immutability** — cari cara menghapus/mengubah notifikasi dari UI | Tidak ada tombol hapus/edit sama sekali. Aturan rumah #8: notifikasi **tidak pernah bisa dihapus**, hanya read/unread | |

### 3.1 🔴 Butir 10 sudah diketahui GAGAL sebelum QA dijalankan — konfirmasi saja, jangan kaget

| # | Langkah | Yang akan terjadi | Yang seharusnya |
|---|---|---|---|
| 10 | Klik **badan kartu** (judul/baris meta), bukan tombol Tandai Dibaca | Navigasi ke **`/performance_snapshot/PERF-202606-00xx`** ⇒ **404** | `/performance/PERF-202606-00xx` (`/performance/[id]` ada dan hidup) |

**Sebabnya sudah dilacak sampai akarnya**, jadi jangan dihabiskan waktu mendiagnosis ulang:
`performance.ts:1389` memanggil `notification.emit` **tanpa** `deepLink`, dan fungsi SQL
`notify_emit` mengisi defaultnya sebagai `'/' || entity_type || '/' || entity_id`
(`supabase/migrations/20260723055732_statemachine.sql:177`). Untuk `entity_type='performance_snapshot'`
hasilnya `/performance_snapshot/…`, sedangkan route Next-nya `/performance/[id]`.

**Dan ini tidak berdiri sendiri.** Audit seluruh 15 event katalog terhadap daftar route
`web-internal` (lihat §6) menunjukkan **hanya 2 dari 10 pola deep link yang benar-benar punya
route**. Karena itu butir 10 dicatat sebagai **FAIL yang dikenal** dengan tiket sendiri (**O51**,
`DECISIONS.md`) — **bukan** sebagai penahan QA-1. Sembilan butir lainnya tetap harus lolos.

---

## 4. QA-2 — `/master-services`

Live `CDPS SG` per 2026-07-31: `master_services` **32** · `master_service_versions` **32** ·
semua `active` · **8 kategori** · `effective_from` **2026-07-16** untuk ke-32 baris ·
**nol baris ber-`version_no` > 1**.

| # | Langkah | Harapan **persis** | ✅/❌ |
|---|---|---|---|
| 1 | Buka `/master-services` | **32 baris**. Judul "Master Service List" | |
| 2 | Kolom **Aktif** | ke-32 baris berlabel badge hijau **`Aktif`** | |
| 3 | Kolom **Versi** | **`1`** di ke-32 baris. Live belum punya versi ke-2 — **`1` di semua baris adalah BENAR**, bukan tanda versioning rusak | |
| 4 | Kolom **Berlaku Sejak** | **`2026-07-16`** di ke-32 baris | |
| 5 | Kolom **Harga Standar** — format IDR (aturan rumah #7) | Contoh yang bisa dicocokkan langsung: *Store Management (Paket)* → **`Rp. 6.000.000,00`** · *Banner / OBS Design* → **`Rp. 250.000,00`** · *Live with TC / KOL / Celebrities (10% Rate Card)* → **`Rp. 10.000.000,00`** | |
| 6 | Baris **passthrough** (mis. *GMV Max*, *Model (Add On) …*) | Harga Standar **`Rp. 0,00`** — harganya memang 0 di MSL karena nominalnya diisi saat quote. **Bukan FAIL** | |
| 7 | Kolom **Batas Minimal** | *Awareness & Consideration Ads Spending* → **`300`** (bulat, bukan `300.00`) · baris flat/passthrough → **`—`** | |
| 8 | Kolom **Mode** | ke-32 baris terisi salah satu dari `flat` / `min_floor` / `batch_ceiling` / `passthrough`. Sebaran live: **flat 7 · min_floor 15 · batch_ceiling 5 · passthrough 5** | |
| 9 | Kolom **PPN** | tepat **6 baris** `Ya`, sisanya `Tidak` | |
| 10 | Klik **Riwayat Versi** pada satu baris | Tabel anak muncul berisi **tepat 1 baris (Versi 1)** — konsisten dengan butir 3. Bukan kosong, bukan error | |
| 11 | Ubah **Berlaku Pada Tanggal** → `2026-07-15` (H-1 sebelum MSL berlaku) | **`Belum ada layanan pada tanggal ini.`** — ini yang membuktikan filter temporal hidup di deployment, dan **nol tulisan ke produksi** | |
| 12 | Kembalikan tanggal ke hari ini | 32 baris muncul lagi | |
| 13 | Tombol **Ubah** / **Tambah Layanan** — hanya cek form terbuka, **JANGAN Simpan** (lihat §4.1) | Form muncul; ganti Mode ke `min_floor`/`batch_ceiling` ⇒ field **Batas Minimal** muncul & wajib; ganti ke `passthrough` ⇒ **Harga Standar** ter-disable & terisi `0` | |

### 4.1 🔴 Jangan uji versioning dengan menulis ke MSL produksi

Menekan **Simpan** di produksi **menerbitkan versi ke-2 rate card yang riil** — ber-audit,
permanen, dan tidak bisa ditarik (aturan rumah #3). Rate card 32 layanan itu juga **masih
menunggu Sales Head** (`MSL_KALKULATOR_VALIDASI.md`), jadi versi ke-2 yang lahir dari QA akan
tampak seperti keputusan harga.

Versioning **sudah** ditutup uji otomatis — `scripts/mslseed/engine.test.ts` menguji tepat itu
(*"appends a NEW version when a price changes — never mutating version 1"*), dan lolos di
Postgres nyata. Kalau tetap ingin melihat rantai versinya di UI, jalankan lokal:

```bash
npm run db:rebuild -- --yes
npm run msl:seed -w @cdps/api -- --actor <NIK-Sales-lead> --apply
# ubah satu harga di UI lokal → Versi jadi 2, Riwayat Versi menampilkan 2 baris
```

### 4.2 Temuan kosmetik yang sudah diketahui (jangan dilaporkan sebagai baru)

`master-services/page.tsx:408` memakai `colSpan={12}` sementara tabel induknya punya **13**
kolom ⇒ baris "Riwayat Versi" tidak melebar penuh sampai kolom terakhir. Kosmetik murni, nol
dampak data. Ikut **O51**.

---

## 5. QA-3 — `/sales/kalkulator`

Login sebagai **Sales** (atau Director/OD). Rumus yang sedang diuji
(`packages/domain/src/sales.ts:141`):

```
flat:          subtotal = qty × harga
min_floor:     subtotal = max(qty, min_qty) × harga
batch_ceiling: subtotal = ceil(qty / min_qty) × min_qty × harga
passthrough:   subtotal = nominal input  (harga diabaikan)
apply_ppn:     subtotal += round_half_up(subtotal × 11%)
Estimasi Nilai = Σ subtotal   ·   Komisi dihitung per baris atas subtotal
```

| # | Langkah | Harapan **persis** | ✅/❌ |
|---|---|---|---|
| 1 | Buka `/sales/kalkulator` | **8 section kategori**, urut: Store Management · Ads Spending · Asset Produk · Konten Organik · KOL & Influencer · Affiliator · Live & Content Service · Social Proof. Urutan ini **sengaja** meniru sheet sales (`CATEGORY_ORDER`) — kategori tak dikenal akan muncul di **paling bawah**, dan kalau itu terjadi berarti nama kategori di live bergeser dari seed | |
| 2 | Jumlah baris | **32** total di kedelapan section (1 · 2 · 7 · 6 · 3 · 2 · 7 · 4) | |
| 3 | Baris passthrough | kolom **Harga** = **`—`**, input ber-placeholder **`Nominal (Rp)`**. Baris lain: placeholder **`Quantity`** | |
| 4 | Ringkasan sebelum apa pun diisi | **`Pilih minimal 1 layanan untuk melihat estimasi.`** | |

### 5.1 Enam kasus hitung — angkanya sudah dihitung, cocokkan saja

Isi **satu per satu**, tunggu **~0,4 s** (debounce 400 ms) tiap kali, lalu baca kolom **Subtotal**:

| # | Layanan | Mode | Isi | Perhitungan | **Subtotal harapan** | ✅/❌ |
|---|---|---|---|---|---|---|
| K1 | Store Management (Paket) | flat | qty **2** | 2 × 6.000.000 | **`Rp. 12.000.000,00`** | |
| K2 | Short Video (UGC Style) / Ad Content | min_floor (5) | qty **2** | max(2,5)=5 × 150.000 | **`Rp. 750.000,00`** ← qty 2 tapi ditagih 5: **inilah floor-nya bekerja** | |
| K3 | Awareness & Consideration Ads Spending | min_floor (300) **+PPN** | qty **100** | max(100,300)=300 × 10.000 = 3.000.000, +11% | **`Rp. 3.330.000,00`** | |
| K4 | Nano KOL (1K–10K followers) | min_floor (10) **+PPN** | qty **1** | 10 × 5.000.000 = 50.000.000, +11% | **`Rp. 55.500.000,00`** | |
| K5 | GMV Max | passthrough **+PPN** | nominal **100000000** | 100.000.000 +11% | **`Rp. 111.000.000,00`** ← **ini regresi C03-F2**: dulu 500 karena bigint mentah | |
| K6 | Product Catalog Photo – 1 Output | batch_ceiling (1) | qty **3** | ceil(3/1)×1×40.000 | **`Rp. 120.000,00`** | |

**Dengan K1–K6 terisi bersamaan:**

| Field | Harapan **persis** |
|---|---|
| **Estimasi Nilai** | **`Rp. 182.700.000,00`** |
| **Total Komisi** | **`Rp. 0,00`** — lihat §5.2 |

### 5.2 🔴 `Total Komisi` = `Rp. 0,00` adalah BENAR — jangan catat FAIL

**Ke-32 layanan di live ber-`commission_rule` = `"0% of standard price"`.** Jadi apa pun yang
dipilih, Total Komisi akan **selalu** `Rp. 0,00`. Itu bukan bug kalkulator: basis komisi rate
card memang **belum dikonfirmasi Sales Head** — `price_note` layanan pertama menyatakannya
verbatim (*"+ komisi 5% (basis belum dikonfirmasi — lihat worksheet validasi)"*).

⇒ Jalur komisi ≠ nol **tidak bisa diuji dari produksi hari ini**. Ia sudah ditutup
`packages/domain/src/sales.test.ts` (48 test, termasuk kedua bentuk grammar `"<N>% of standard
price"` dan `"flat Rp <N>"`). Ini bahan **O36/Sales Head**, bukan temuan QA.

### 5.3 Sisa cek

| # | Langkah | Harapan | ✅/❌ |
|---|---|---|---|
| 7 | Kosongkan semua input | Ringkasan balik ke **`Pilih minimal 1 layanan…`**, subtotal balik **`—`** | |
| 8 | Isi qty **0** lalu **-5** di satu baris | **tidak ada request** & tidak ada error — baris non-positif memang dibuang sebelum dikirim. Subtotal **`—`** | |
| 9 | Ketik cepat `1`→`12`→`123` di satu baris | Angka akhir yang menang (debounce + guard `requestSeq`); **tidak** ada nilai antara yang nyangkut | |
| 10 | Buka DevTools → Network selama butir K1–K6 | `POST /sales/quote-preview` → **200**. **Nol 500** — ini inti QA-3 | |
| 11 | Pastikan tak ada yang tertulis | `/sales/kalkulator` **read-only** (quote preview saja). Konfirmasi: `select count(*) from public.qualified_forms;` sebelum & sesudah **sama** | |

---

## 6. Yang TIDAK bisa dibuktikan dari produksi (dan di mana sudah dibuktikan)

Dicatat supaya tidak dilaporkan sebagai lolos padahal tak pernah diuji, maupun sebagai gagal
padahal memang di luar jangkauan produksi.

| Tidak terjangkau | Sebab di live | Sudah ditutup di mana |
|---|---|---|
| Badge **`99+`** | tiap penerima cuma punya 1 notifikasi (maks badge = 1) | `Header.tsx:41` (`unreadCount > 99`) |
| **Riwayat versi > 1** MSL | nol baris `version_no > 1`; menulis versi ke-2 = keputusan harga (§4.1) | `scripts/mslseed/engine.test.ts` |
| **`batch_ceiling` ≠ `flat`** | **kelima** layanan batch_ceiling ber-`min_qty = 1` ⇒ `ceil(q/1)×1 = q`, matematikanya identik dengan flat. **Mode ini tak bisa dibedakan lewat UI produksi** | `sales.test.ts` (fixture `min_qty` > 1) |
| **Komisi ≠ 0** | ke-32 rule = `0%` (§5.2) | `sales.test.ts` |
| **Deep link 8 event lain** | butuh entitas yang belum ada di produksi (0 klien · 0 transaksi · 0 lead) | belum — **O51** |

### 6.1 Audit deep link katalog notifikasi (statis, dari kode — konteks O51)

Hanya **2 dari 10** pola punya route. Ini yang membuat butir 10 di §3.1 bukan kecelakaan tunggal:

| Pola deep link yang dikirim | Sumber | Route `web-internal` | Status |
|---|---|---|---|
| `/demo-tasks/<id>` | `demo.ts` (eksplisit) | `/demo-tasks/[id]` | ✅ |
| `/leads/<id>` | `leads.ts` (eksplisit) | `/leads/[id]` | ✅ |
| `/transactions/<id>` | `finance.ts` (eksplisit) | tidak ada — yang ada `/finance/transactions/[id]` | ❌ |
| `/attempts/<id>` | `sales.ts` (eksplisit) | tidak ada — yang ada `/sales/[id]` | ❌ |
| `/brief/<id>` | `account.ts` (default) | `/account/briefs/[id]` | ❌ |
| `/complaint/<id>` | `account.ts` (default) | `/account/complaints/[id]` | ❌ |
| `/asset/<id>` | `creative.ts` (default) | `/creative/assets/[id]` | ❌ |
| `/client_health_snapshot/<id>` | `health.ts` (default) | `/health/[clientId]` (butuh **clientId**, bukan id snapshot) | ❌ |
| `/live_stream_session/<id>` | `livestream.ts` (default) | `/livestream/sessions/[id]` | ❌ |
| `/performance_snapshot/<id>` | `performance.ts` (default) | `/performance/[id]` | ❌ **hidup ×38 di produksi sekarang** |
| `/dependency/<id>` | `board.ts` (default) | tidak ada padanan | ❌ |

Pola: entity_type **snake_case tunggal** vs route **plural & bersarang di bawah divisi**. Default
`notify_emit` tidak bisa menebak itu ⇒ perbaikannya adalah `deepLink` eksplisit di tiap emitter,
bukan menambal fungsi SQL-nya.

---

## 7. Cara mencatat hasil

Tulis `docs/handoff/QA_UI_C04_REPORT_<YYYYMMDD>.md`:

1. **Header**: tanggal · URL deployment · commit `web-internal` yang diuji · role/divisi tiap
   akun yang dipakai (**jangan tulis NIK atau nama** — repo masih publik, SESI24 §1.4).
2. **Tabel per butir** QA-1/2/3 dengan ✅/❌ + nilai yang benar-benar terlihat kalau ❌.
3. **PASS / FAIL / KNOWN-FAIL** — butir 10 §3.1 masuk **KNOWN-FAIL (O51)**, bukan FAIL baru.
4. **Screenshot**: minimum badge sebelum-sesudah, 32 baris MSL, Ringkasan kalkulator K1–K6.
5. Kalau ada FAIL baru ⇒ satu baris **Open** di `DECISIONS.md`, jangan cuma di report.

**DoD runbook ini:** ketiga butir dijalankan terhadap deployment · report tersimpan · nol FAIL
selain KNOWN-FAIL O51 · dan **residu C-03 belum dibersihkan sampai QA-1 tercentang** (§1).
