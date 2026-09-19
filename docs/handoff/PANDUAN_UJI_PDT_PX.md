# Panduan Uji Coba — PDT (Pusat Data Toko) & PX (Product Exchange)

> **Dibuat 2026-09-19.** Panduan ini menulis apa yang **benar-benar bisa diklik hari ini**,
> bukan apa yang ada di PRD. Setiap klaim diverifikasi ke kode, dan hal yang **belum ada**
> ditulis terang-terangan supaya tidak ada yang menunggu tombol yang memang tidak dibangun.

---

## 0. Baca ini dulu — apa yang bisa & belum bisa

| Fitur | Status uji | Prasyarat |
|---|---|---|
| **PDT — Upload & pratinjau** | ✅ Bisa penuh | Klien + toko dibuat manual, **Supabase Storage nyata** |
| **PDT — Riwayat batch & konfirmasi identitas** | ✅ Bisa penuh | idem |
| **PDT — Laporan per toko + kirim ke klien** | ✅ Bisa penuh | cukup 1 batch ter-commit (**tidak** harus `verified`) |
| **PDT — Kalibrasi benchmark** | ✅ Bisa penuh (Director) | — |
| **PX — Kebijakan kelayakan** | ✅ Bisa penuh (Director) | — (data versi 1–3 sudah ada dari migrasi) |
| **PX — Kandidat & konfirmasi kategori** | ⚠️ Halaman tampil, **isinya kosong** | butuh batch PDT `verified` + tick evaluate dipicu manual |
| **PX — Katalog** | ⚠️ Halaman tampil, **isinya kosong** | butuh `px_coverage_snapshot` dari repo **`mcnapp`** — tidak bisa diisi dari repo ini |

> 🔴 **Mau uji langsung di PRODUKSI, bukan lokal? Loncat ke §8 dulu.** Kode & database
> produksi sudah benar, tapi `SUPABASE_SERVICE_ROLE_KEY` belum dipasang di Vercel —
> tanpa itu seluruh alur upload PDT menjawab 500. §8.2 memuat langkah pemasangannya.

### Yang memang BELUM ADA (jangan dicari)
- Tombol **reparse manual**. Reparse hanya terjadi (a) lewat cron harian, atau (b) sebagai efek
  samping tombol "Konfirmasi Identitas".
- Tombol **unduh paket ZIP asli**. Fungsinya ada di kode tapi belum dipanggil halaman mana pun.
- **Halaman sisi kreator PX** — itu M4/M5, belum dibangun.
- **Seed data PDT/PX siap pakai.** `supabase/seed.sql` hanya berisi 11 karyawan + 3 layanan;
  **nol baris klien, nol toko**. Jadi klien & toko harus dibuat manual (§3).
- **Cron untuk `px/evaluate/tick`** — sengaja belum dijadwalkan; harus dipicu manual (§5.2).

---

## 1. Menjalankan sistem secara lokal

```bash
make install                 # npm install di root + kedua frontend
export DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps"
make db-rebuild              # bangun ulang DB dari nol (273 migrasi + gate + invariant)
```

`db-rebuild` harus berakhir dengan **semua gate ✓** — kalau ada `✗`, berhenti dan perbaiki dulu,
jangan lanjut.

Lalu **tiga terminal terpisah** (port-nya wajib, bukan default `next dev`):

```bash
# Terminal 1 — API
npm run dev -w @cdps/api -- -p 3001

# Terminal 2 — web internal
cd web-internal && npm run dev        # port 3000

# Terminal 3 (opsional, tidak dipakai PDT/PX)
cd web-client-portal && npm run dev -- -p 3002
```

Buka **http://127.0.0.1:3000**.

### 1.1 ⚠️ Untuk upload PDT, Postgres lokal saja TIDAK CUKUP

Upload PDT menaruh ZIP di **Supabase Storage** (bucket `pdt-raw`), dan `db-rebuild.sh` hanya
membangun Postgres — skema `storage`-nya cuma stub. Jadi untuk menguji alur upload, `apps/api`
harus menunjuk ke proyek Supabase yang punya Storage nyata:

```
NEXT_PUBLIC_SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

Tanpa dua yang pertama, API melempar `Supabase URL / service role key tidak dikonfigurasi`.
Bagian **laporan**, **benchmark**, dan **PX policy** tetap bisa diuji tanpa Storage.

---

## 2. Login

Pakai JWT dev lokal — tidak perlu lewat Supabase Auth:

```bash
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps" \
SUPABASE_JWT_SECRET="<sama persis dengan apps/api/.env.local>" \
node scripts/dev-jwt.mjs --employee EMP-0008
```

Token dicetak ke stdout. Pasang sebagai cookie bernama **`cdps_access_token`** di
`127.0.0.1:3000` (DevTools → Application → Cookies), lalu refresh.

| Employee | Peran | Untuk menguji |
|---|---|---|
| `EMP-0008` | Director | Semua halaman, termasuk benchmark & PX policy |
| `EMP-0002` | Account staff (AM) | Batasan "AM hanya kliennya sendiri" |

> Jangan mengarang isi klaim JWT. Klaim **harus** datang dari fungsi `employee_claims()` di DB —
> `--employee` sudah melakukannya. (Contoh jebakan: `division` seorang Director adalah string
> kosong, bukan `'Management'`.)

---

## 3. Prasyarat data — buat klien & toko dulu

Tidak ada seed PDT, jadi ini langkah wajib pertama. **Login sebagai `EMP-0008` (Director).**

1. Buat klien lewat alur normal (Leads → closing → pembayaran), atau pakai
   `npm run tour:seed` yang menjalankan satu rantai klien realistis lewat panggilan domain nyata.
   > `tour:seed` **tidak idempoten** — jalankan sekali per `db-rebuild`. Ia **tidak** membuat
   > baris toko, jadi langkah 2–3 tetap manual.
2. Buka **`/clients/{id}`** → tambahkan platform toko. Platform **harus persis**
   `Shopee` atau `TikTok Shop`.
   > Tokopedia/Lazada/Blibli **ditolak server** dengan
   > `[platform toko '...' tidak didukung PDT — Tokopedia/Lazada/Blibli tetap manual (PDT-22)]`.
   > Itu perilaku benar, bukan bug.
3. Pastikan klien punya **AM (`assigned_am_id`)**. Klien tanpa AM **tidak bisa** di-upload oleh
   AM biasa (hanya lead/Director Account).
4. **`shop_id` TIDAK perlu diisi dulu untuk PDT** — ini sering disalahpahami. Biarkan kosong;
   batch pertama akan lahir berstatus `identitas_belum_terikat` dan Anda mengikatnya lewat tombol
   di §4. (Untuk **PX**, `shop_id` wajib — lihat §5.)

---

## 4. Menguji PDT

### 4.1 Upload → pratinjau → commit

Buka **`/account/pdt/upload`**.

1. Pilih **klien** → pilih **toko** (dropdown hanya menampilkan toko aktif Shopee/TikTok Shop).
2. Pilih berkas **ZIP** berisi ekspor platform → tekan tombol pratinjau.
3. **Tabel pratinjau muncul** — setiap berkas di dalam ZIP, modul apa yang terdeteksi, dan
   kolom apa yang dipanen. **Nol baris ditulis ke DB di tahap ini.** Ini tempat yang tepat untuk
   memeriksa apakah deteksi modulnya benar.
4. Kalau ada berkas yang salah terdeteksi, **override modulnya** lewat dropdown di baris itu.
5. Tekan **"Simpan Batch"** (ada konfirmasi). Server **menjalankan ulang seluruh pipeline dari
   nol** — hasil pratinjau di browser tidak dipercaya, jadi tidak bisa dicurangi dari sisi klien.

### 4.2 Membaca statusnya — ini bagian terpenting

Batch berakhir di salah satu dari lima status:

| Status | Artinya | Yang harus dilakukan |
|---|---|---|
| `verified` | Rekonsiliasi lolos (selisih ≤ 0,5%) | Selesai — ini yang dibutuhkan PX |
| `identitas_belum_terikat` | Toko belum punya `shop_id` tersimpan | Tekan **"Konfirmasi Identitas"** |
| `ditolak` | Berkas menyebut toko **lain**, atau selisih rekonsiliasi **> 0,5%** | Baca `alasan_ditolak` |
| `parsing` | Pasangan berkas rekonsiliasi **tidak lengkap** di dalam ZIP | Lihat peringatan di bawah |
| `digantikan` | Batch lama untuk periode sama, sudah diganti yang baru | Normal |

> ⚠️ **ZIP yang cuma berisi satu-dua berkas TIDAK AKAN PERNAH jadi `verified`** — ia berhenti di
> `parsing`, dan itu bukan error. Rekonsiliasi hanya jalan kalau **pasangan yang tepat** ada:
>
> | Platform | Wajib ada DUA-DUANYA |
> |---|---|
> | Shopee | ekspor **Data Toko** (`shopee_shop_stats`) **+** **Produk Induk/SKU** (`shopee_parent_sku`) |
> | TikTok | ekspor **Analisis Toko** (`tt_shop_analytics`) **+** **Analisis Produk** (`tt_product_analytics`) |
>
> Sistem membandingkan GMV tingkat-toko lawan Σ GMV per-SKU. Kalau selisihnya ≤ 0,5% → `verified`.
> Untuk TikTok, **Pesanan** juga dibandingkan. Untuk Shopee, perbandingan pesanan sengaja dilewati
> (kolom pesanan per-SKU belum terverifikasi).

### 4.3 Konfirmasi identitas (batch pertama sebuah toko)

Di tabel **Riwayat Batch**, batch ber-status `identitas_belum_terikat` punya tombol
**"Konfirmasi Identitas"**. Menekannya:
1. mengikat `shop_id`/akun konten dari berkas ke toko **secara permanen**, dan
2. **langsung menjalankan reparse** batch itu — status berpindah saat itu juga, tidak perlu
   menunggu cron besok. Hasilnya muncul sebagai `status_setelah_reparse`.

Sesudah terikat, ZIP yang menyebut toko lain akan **ditolak**. Itu pagar yang benar.

### 4.4 Laporan

Buka **`/account/pdt/laporan`** → pilih toko + periode.

> **Laporan TIDAK menuntut status `verified`.** Begitu ada satu batch ter-commit dengan identitas
> valid, laporannya sudah bisa dibuka. (Ini beda dari PX, yang memang menuntut `verified`.)

Yang bisa dicoba: KPI ringkas, rincian kanal/iklan/live/video/produk/afiliasi, skor, insight yang
bisa disunting AM, tombol **"Kirim ke Klien"** (membekukan snapshot laporan), dan **Riwayat
Pengiriman**.

### 4.5 Kalibrasi benchmark (Director)

**`/pdt/benchmark`** — daftar versi benchmark (append-only, versi lama tidak pernah diubah) dan
form menambah versi baru yang ter-prefill dari versi aktif.

> Halaman ini **TikTok saja**. Ambang Shopee masih hardcode di kode.

---

## 5. Menguji PX

### 5.1 Yang bisa langsung diklik — kebijakan kelayakan (Director)

**`/px/eligibility-policy`** — satu-satunya bagian PX yang **langsung berisi data** setelah
`db-rebuild` (versi 1, 2, 3 ditanam migrasi). Bisa dilihat isinya dan dibuat versi baru
(ambang penjualan, basis, jendela, lantai komisi, syarat stok, platform).

### 5.2 Rantai supaya kandidat & katalog terisi

Ini **rantai berlapis** — setiap mata rantai wajib, dan yang terakhir ada di repo lain:

| # | Lapis | Syarat | Bisa dipenuhi dari repo ini? |
|---|---|---|---|
| 1 | — | `px_eligibility_policy` aktif | ✅ sudah ada |
| 2 | **L1** | `client_platforms.shop_id` **terisi** (di `/clients/{id}`) | ✅ |
| 3 | **L2** | **≥1 batch PDT `verified`** + baris fakta SKU basis `dibayar` | ✅ (lihat §4.2) |
| 4 | — | **tick evaluate dipicu manual** (tidak ada cron) | ✅ |
| 5 | **L3** | harga satuan SKU + kategori dikonfirmasi AM di `/px/kandidat` | ✅ |
| 6 | **L4** | `px_coverage_snapshot` dari **`mcnapp`** | ❌ **repo lain** |

Memicu tick evaluate (langkah 4):

```bash
curl -X POST http://127.0.0.1:3001/api/v1/internal/px/evaluate/tick \
  -H "Authorization: Bearer $PLAN_TICK_SECRET" \
  -H 'Content-Type: application/json' \
  -d '{"client_platform_id": 123}'      # hilangkan body untuk semua toko
```

> Kalau `PLAN_TICK_SECRET` tidak diset, endpoint-nya **tertutup**, bukan terbuka. Itu perilaku
> aman yang benar.

Sesudah tick, buka **`/px/kandidat`** — produk yang lolos L1–L2 muncul, dan AM bisa mengonfirmasi
`level2_category` per produk lewat dropdown.

### 5.3 ⚠️ Kenapa `/px/katalog` akan tetap kosong

Verdict `lolos` (yang membuat SKU masuk katalog) butuh **L4**, dan L4 membaca
`px_coverage_snapshot` — data cakupan kreator yang **dikirim mesin dari repo `mcnapp`** lewat
`POST /api/v1/internal/bridge/px-coverage`. Tidak ada UI maupun skrip di repo ini yang mengisinya.

Tanpa snapshot itu, **semua produk berhenti di verdict `kreator_kosong`**, katalog kosong, dan
dropdown kategori di `/px/kandidat` juga kosong (opsinya diambil dari snapshot yang sama).

**Jadi: verdict `lolos` tidak bisa dicapai hanya dari repo ini.** Yang bisa diuji sampai tuntas
adalah L1–L3 plus laporan **`kreator_kosong`** di `/px/katalog` — dan laporan itu justru berguna:
ia menjawab "kategori/segmen apa yang ada permintaannya tapi nol kreator".

---

## 6. Kalau ada yang tidak beres

| Gejala | Kemungkinan besar |
|---|---|
| Batch berhenti di `parsing`, tidak pernah `verified` | ZIP kurang pasangan berkas rekonsiliasi (§4.2) — ini **paling sering** |
| `[platform toko '...' tidak didukung PDT ...]` | Platform bukan `Shopee`/`TikTok Shop` — benar, bukan bug |
| Upload gagal, error Supabase URL / service role key | Env Storage belum diisi (§1.1) |
| Batch `ditolak` walau angkanya kelihatan benar | Berkas menyebut `shop_id` **lain** dari yang sudah terikat, ATAU selisih rekonsiliasi > 0,5% — baca `alasan_ditolak` |
| Halaman terbuka tapi API 403 | Tidak ada guard role di level route; gerbangnya di server. Cek peran employee token Anda |
| `/px/kandidat` kosong padahal sudah upload | Batch belum `verified`, atau tick evaluate belum dipicu (§5.2) |
| `/px/katalog` kosong | Normal — butuh coverage dari `mcnapp` (§5.3) |
| Berkas terdeteksi modul yang salah | Override lewat dropdown di tabel pratinjau sebelum commit (§4.1 langkah 4) |

### 6.1 Satu hal yang baru saja diperbaiki, supaya tidak salah paham

Sebelum 2026-09-19, **tidak satu pun klien bisa mencapai `verified`** — lima nama kolom di
whitelist tidak pernah cocok dengan ekspor platform yang sebenarnya, sehingga berkasnya dibuang
diam-diam **tanpa memunculkan error**. Sesudah diperbaiki, 10 dari 10 klien sample mencapai
`verified` dengan **selisih GMV 0,0000%**.

Artinya: kalau Anda menguji dengan build lama dan melihat semuanya gagal, itu bug yang sudah
ditutup — bukan bukti PDT tidak akurat. Pastikan DB yang dipakai sudah memuat migrasi
`20261122010000`.

---

## 7. Urutan uji yang disarankan (paling cepat sampai paling dalam)

1. **`/px/eligibility-policy`** — nol prasyarat, langsung ada isinya. Pemanasan 2 menit.
2. **`/pdt/benchmark`** — nol prasyarat, coba tambah satu versi.
3. **Buat klien + toko** (§3) — ini investasi yang dipakai semua langkah berikutnya.
4. **Upload PDT dengan ZIP kecil** (1–2 berkas) — lihat tabel pratinjau & override modul.
   Harapkan berhenti di `parsing`; itu benar.
5. **Upload ZIP lengkap** (pasangan shop-level + per-SKU) — kejar `verified`, dan konfirmasi
   identitas kalau diminta.
6. **`/account/pdt/laporan`** — buka laporannya, sunting insight, kirim ke klien.
7. **Picu tick evaluate PX** (§5.2) → **`/px/kandidat`** — konfirmasi kategori beberapa produk.
8. **`/px/katalog`** — harapkan kosong; baca laporan `kreator_kosong`.

---

## 8. Menguji langsung di PRODUKSI (`app.meagency.co.id`)

Bagian §1–§7 di atas menulis jalur **lokal**. Bagian ini menjawab satu pertanyaan
berbeda: **apakah PDT & PX bisa diuji langsung di produksi hari ini?**

Jawabannya: **hampir** — kode dan database produksi sudah benar, tapi **satu variabel
environment belum dipasang**, dan tanpa itu seluruh jalur upload PDT mati.

### 8.1 Yang sudah siap di produksi (diverifikasi 2026-09-19)

| Hal | Keadaan |
|---|---|
| Kode `agency-app-api` | `main` @ `2cf20d3` — **sudah** memuat perbaikan whitelist |
| Kode `web-internal-mea` | `main` @ `2cf20d3` — sama |
| Migrasi live `CDPS SG` | 4 migrasi terakhir sudah mendarat; 184 tabel, 12 alias |
| Registry parser DB | set-identik dengan registry TS (26 modul) |
| Bucket Storage `pdt-raw` | ada, privat, plafon 50 MB (sesuai Rule 42) |
| Menu PDT & PX | terdaftar di `nav.ts`, gerbang izin mencerminkan domain |
| Akun yang bisa upload | 6 AM divisi Account (punya login) + 2 Director |
| `px_eligibility_policy` | 3 versi sudah ada |

### 8.2 🔴 Pemblokir tunggal — `SUPABASE_SERVICE_ROLE_KEY` belum dipasang

Project Vercel `agency-app-api` (production) saat ini memuat 9 variabel:
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_JWT_SECRET`,
`SUPABASE_JWT_PUBLIC_JWK`, `DATABASE_URL`, `CRON_SECRET`, `PLAN_TICK_SECRET`,
`BRIDGE_INGEST_SECRET`, `MEAGO_BRIDGE_EMPLOYEE_ID`.

**`SUPABASE_SERVICE_ROLE_KEY` tidak ada di antaranya.**

`apps/api/src/lib/pdt-storage.ts` menuntutnya (bersama `NEXT_PUBLIC_SUPABASE_URL`) dan
melempar `Supabase URL / service role key tidak dikonfigurasi` bila salah satu kosong.
Enam route memakainya, dan **empat di antaranya adalah seluruh alur Flow A**:

| Route | Akibat tanpa kunci |
|---|---|
| `POST /account/pdt/batches/upload-url` | tombol "Pilih ZIP" gagal di langkah pertama |
| `POST /account/pdt/batches/preview` | pratinjau tidak pernah muncul |
| `POST /account/pdt/batches` (commit) | batch tidak pernah tersimpan |
| `POST /account/pdt/batches/konfirmasi-identitas` | `shop_id` tidak pernah bisa diikat |
| `internal/pdt/reparse/tick` | reparse harian mati |
| `internal/pdt/purge/tick` | purge retensi (Rule 45) mati |

> Gejalanya di layar adalah **error 500**, bukan pesan `[...]` Bahasa Indonesia —
> ini kegagalan konfigurasi server, bukan kegagalan validasi. Jangan dibaca sebagai
> "PDT-nya rusak".

**Cara memasang (hanya pemilik yang bisa — kuncinya rahasia dan tidak terbaca lewat tooling):**

1. Supabase → project **CDPS SG** → *Project Settings* → *API Keys* → salin **`service_role`** (bukan `anon`).
2. Vercel → team `meagency` → project **`agency-app-api`** → *Settings* → *Environment Variables*.
3. Tambah `SUPABASE_SERVICE_ROLE_KEY`, nilai = kunci tadi, target **Production** (tandai *Sensitive*).
4. **Redeploy** — variabel environment hanya terbaca oleh build/deploy baru.

Kunci ini **tidak boleh** dipasang di `web-internal-mea`: ia melewati batas server dan
akan bocor ke browser. Hanya `agency-app-api` yang memakainya, dan hanya dari route handler.

### 8.3 🟡 `BRIDGE_PX_SECRET` juga belum ada — memblokir L4 PX saja

`bridgePxSecretOk` bersikap *fail-closed*: tanpa secret, **setiap** request ke
`POST /internal/bridge/px-coverage` ditolak. Itu satu-satunya pintu masuk
`px_coverage_snapshot`, jadi lapis 4 (cakupan kreator) **tidak akan pernah** memberi
verdict `lolos` sampai secret ini dipasang di `agency-app-api` **dan** nilai yang sama
dipasang di pipeline `mcnapp`.

Ini **tidak** memblokir PDT, dan **tidak** memblokir halaman PX — kandidat tetap
terevaluasi sampai lapis 3. Kerjakan setelah §8.2 beres.

### 8.4 Yang terlihat kosong tapi BUKAN bug

Snapshot produksi 2026-09-19: **29 klien**, **35 toko** (28 di antaranya Shopee/TikTok Shop
aktif), **0 toko ber-`shop_id`**, **0 batch PDT**, **0 baris coverage**.

`shop_id` kosong di semua toko adalah **keadaan awal yang benar**, bukan data yang hilang.
Ia tidak diisi manusia lewat form: ia lahir dari batch PDT pertama toko itu — batch
pertama berstatus `identitas_belum_terikat`, lalu tombol **"Konfirmasi Identitas"**
yang menuliskannya (`pdt.ts` → `update client_platforms set shop_id = …`) sekaligus
memicu reparse. Jadi urutannya searah:

```
upload PDT → batch identitas_belum_terikat → Konfirmasi Identitas → shop_id terisi
          → batch berikutnya bisa verified → PX lapis 1 & 2 terbuka
```

Artinya PX **tidak bisa** diuji lebih dulu daripada PDT — dan PDT belum bisa diuji
sama sekali sampai §8.2 selesai.

### 8.5 Urutan setelah kuncinya terpasang

1. Redeploy `agency-app-api`, pastikan deployment production hijau.
2. Login sebagai AM pemilik toko (atau Director) → menu **"Upload Data Toko (PDT)"**.
3. Upload ZIP ekspor **lengkap** satu toko — ingat §0: ZIP isi satu-dua berkas tidak
   akan pernah `verified`. Shopee butuh `shopee_shop_stats` **+** `shopee_parent_sku`;
   TikTok butuh `tt_shop_analytics` **+** `tt_product_analytics`.
4. Commit → batch akan berstatus `identitas_belum_terikat` → klik **Konfirmasi Identitas**.
5. Upload periode kedua toko yang sama → sekarang seharusnya `verified`.
6. Ulangi sampai 10 toko `verified` — itulah gerbang bisnis G3-10 yang tersisa
   (`docs/backlog/PDT_BACKLOG.md`), dan satu-satunya cara menutupnya adalah
   dengan data produksi nyata, bukan simulasi.
