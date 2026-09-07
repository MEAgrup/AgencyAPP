# Handoff — **Gelombang D: mesin accrual + D-KOM + D-4 selesai. D-3 sudah tidak buntu.**

> **Baca ini dulu, lalu:**
> 1. `docs/DECISIONS.md` — tujuh baris `Decided` bertanggal **2026-09-08**, dan
>    **§Open: NOL baris 🔴 tersisa.** `D-3-PERAN` dan `D-4-DASAR` sudah ✅
>    diketok pemilik 2026-09-08. Yang perlu dibaca justru baris `Decided`-nya —
>    terutama **"KOREKSI D-4"**, yang membatalkan bentuk yang sempat dibangun
>    beberapa jam sebelumnya.
> 2. `docs/handoff/HANDOFF_GELOMBANG_D_20260907.md` — handoff pendahulunya.
>    §7 (aturan urutan rilis) **wajib** sebelum menyentuh live. §2 (lima ketokan)
>    tetap spesifikasi D; jangan ketok ulang.

---

## 1. Posisi

| | Status |
|---|---|
| Gelombang A · B · C | ✅ tutup |
| **D langkah 1 — kolom `pengakuan` (D-KOM)** | ✅ **SELESAI** — migrasi 190, domain, wire, form admin, tabel |
| **D langkah 2 — mesin accrual** | ✅ **SELESAI** — `packages/core/src/accrual.ts`, 47 tes, 6 mutasi |
| **D langkah 3 — kunci tutup buku (D-3)** | 🟢 **SIAP DIBANGUN** — perannya diketok 2026-09-08: `Finance` level `lead` + `Director`. Belum ada kodenya. Lihat §3 |
| **D langkah 4 — PPN (D-4)** | ✅ **SELESAI** — semua harga non-PPN; PPN tombol Sales per invoice. Lihat §4 |

Migrasi: repo **195** sesudah merge `main` (PR #310/#311 Feedback OD membawa
empat migrasi tambahan yang JUGA belum di-live). **Live kurang ENAM**, bukan dua.
Urutan apply + alasannya di §5 — dan **`20260923010000` (D-4) WAJIB MENYUSUL
deploy kodenya**, tidak boleh mendahului.

---

## 2. Yang dibangun

### 2.1 Migrasi 190 — `20260922010000_dkom_pengakuan_katalog.sql`

Kolom `master_service_versions.pengakuan`, tiga nilai, plus dua CHECK:

| Pagar | Yang dijaga |
|---|---|
| `ck_msv_pengakuan` | hanya `per_periode` · `saat_selesai` · `bulan_berikutnya` |
| `ck_msv_per_periode_butuh_durasi_bulan` | `per_periode` mustahil tanpa periode untuk disebari |

Tiga hal yang disengaja dan perlu diketahui sebelum menyentuhnya:

1. **Kolomnya ditambah NULLABLE, diisi eksplisit, BARU dikunci `NOT NULL`, dan
   default dipasang PALING AKHIR.** Jadi tidak ada satu baris pun yang memakai
   default sebagai jawaban.
2. **Backfill menyentuh SELURUH baris, bukan hanya versi aktif terkini.** Versi
   lama tetap dibaca `msl.effectiveAt` untuk kontrak yang mem-pin versi itu
   (aturan rumah #3) — meninggalkannya NULL berarti mesin accrual bertemu lubang
   justru pada kontrak yang paling lama berjalan.
3. **Default `'saat_selesai'`** dipilih dengan alasan yang sama dengan default
   `'volume'` pada `qty_menambah`: salah menandai layanan berdurasi sebagai
   `saat_selesai` menumpuk pendapatannya di satu bulan — lonjakan yang
   **kelihatan** dan terbatas. `per_periode` yang keliru menyebarnya **diam-diam**
   bertahun-tahun.

### 2.2 Mesin accrual — `packages/core/src/accrual.ts`

Murni: **tanpa DB, tanpa `new Date()` di mana pun.** Semua yang menentukan hasil
datang dari argumennya, jadi skedul yang sama bisa dihitung ulang persis sama
kapan pun — syarat aturan rumah #4 dan syarat D-3 (angka bulan tertutup
dibandingkan dengan hasil hitung ulang saat mencari selisih).

```
hitungSkedul(input) -> { baris[], perBulan[], totalDiakui, totalHangus, alasanKosong }
totalBulan(durasiBulan, qty, qtyMenambah)   // qty x durasi vs durasi saja
bagiRata(total, n)                          // Σ bagian PERSIS = total
```

| Ketokan | Bagaimana ia dipatuhi |
|---|---|
| **D-1** hangus | irisan sebelum void utuh · irisan yang MEMUAT void di-pro-rate per hari (dibulatkan **ke bawah**) · sesudahnya nol. Yang hangus **dilaporkan** (`totalHangus`), tidak lenyap |
| **D-2** hold menjeda | batas irisan = `mulai + k BULAN` lalu **didorong maju** sepanjang hari hold di dalamnya, dicari titik tetapnya. Hold **bertindihan/bersarang tidak dihitung dua kali**; hold yang **belum selesai** belum menggeser apa pun (pola `ads.computeTotalHariHold`) |
| **D-KOM** | tiga penanda, termasuk `bulan_berikutnya` yang menggeser satu bulan kalender |
| **D-4** | mesin **tidak menyentuh PPN sama sekali** — ada tesnya |
| aturan rumah #4 | `alasanKosong` — skedul kosong **selalu mengatakan sebabnya** dalam BI `[...]` |

**⚠️ Tafsir D-1 yang dipilih, dan kenapa** (dicatat 🟡 di `DECISIONS.md`,
menunggu konfirmasi pemilik): D-1 menyebut HARI, D-KOM menyebut RATA per periode.
Keduanya hanya bisa berdiri bersama dengan irisan bulanan + pro-rate hanya di
irisan yang kena void. **Alasannya bukan selera, tapi D-3**: kalau seluruh masa
layanan di-pro-rate sebagai satu blok, void di bulan ke-5 MENGUBAH angka bulan
ke-1..ke-4 — dan bulan-bulan itu mungkin sudah **ditutup**. Ada tesnya
(*"void TIDAK menjangkau ke belakang"*). Kalau pemilik membacanya lain, **itu
yang dikoreksi lebih dulu**; sisa mesinnya tidak berubah.

### 2.3 Gerbang baru di MSL: `pengakuan` wajib untuk layanan berdurasi

`msl.normalizeInput` menolak layanan yang punya `durasiBulan` tapi tidak menyebut
`pengakuan` (`[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]`).
Boleh dihilangkan **hanya** kalau durasinya kosong — di situ hanya satu arti yang
tersisa.

Hari ini 42 dari 42 layanan berdurasi memang `per_periode`, **tapi itu keadaan
data, bukan aturan.** Menjadikannya default berarti menurunkan `pengakuan` dari
`durasi_bulan` lagi — hal yang persis dilarang D-KOM.

Gerbang ini **langsung memerahkan 4 fixture** `msl.test.ts` yang tadinya diam;
keempatnya kini menyebut maksudnya. Itu perilaku yang diinginkan.

---

## 3. 🟢 D-3 — perannya diketok, tinggal dibangun

Ketokan pemilik 2026-09-08: yang berwenang **menutup buku bulanan** adalah
**Senior Finance / Lead Finance** dan **Director**.

Pemetaan ke model peran yang sudah ada — pola yang sama dengan
`finance.canVoteBermasalah` ("SPV Finance", lead level):

```ts
role.division === 'Finance' && role.level === 'lead'   // Senior/Lead Finance
|| role.director                                        // Director
```

### 3.1 Buka-ulang: DIKETOK, dan wewenangnya BERTINGKAT

Pemilik mengoreksi asumsi awal ("tidak ada jalan buka-ulang") di hari yang sama:
**bulan yang sudah ditutup BISA dibuka lagi, dan HANYA oleh `Director`.**

| Aksi | Siapa |
|---|---|
| **Menutup** bulan | `Finance` level `lead` **ATAU** `Director` |
| **Membuka kembali** | **`Director` SAJA** |

`Finance` lead yang menutup **tidak bisa membatalkan tutupannya sendiri**.
Asimetri itu yang membuat kuncinya tetap menjaga sesuatu — kalau peran yang sama
bisa menutup dan membuka sesuka hati, "tertutup" tidak berarti apa-apa.

Yang **tetap** berlaku: bulan tertutup tidak bisa DIEDIT selagi tertutup. Yang
berubah: ada pintu untuk MEMBUKANYA lebih dulu, dan pintu itu lebih sempit.

**Tiga konsekuensi yang WAJIB ikut dibangun** (`DECISIONS.md` 2026-09-08):

1. Buka-ulang adalah **TRANSISI di mesin status**, dengan **alasan tertulis
   wajib**, masuk `audit_log` seperti transisi lain — bukan `UPDATE` diam-diam.
2. Angka beku **TIDAK dihapus** saat dibuka — ia jadi **versi**, supaya "berapa
   angkanya waktu ditutup pertama kali" tetap bisa dijawab selamanya.
3. Tutup-ulang membekukan angka **BARU**, dan **selisihnya terhadap versi
   sebelumnya harus bisa ditampilkan**. Tanpa ini, buka-tutup jadi cara
   mengubah angka keuangan yang tidak meninggalkan jejak apa pun.

### 3.1a Satu turunan yang MASIH ASUMSI, belum diketok

**Jurnal koreksi** di bulan berjalan dibatasi ke peran yang **SAMA dengan
penutup** (`Finance` lead atau `Director`). Memperlebarnya berarti orang yang
tidak boleh menutup buku tetap bisa mengubah angkanya lewat pintu samping.

⚠️ Ini **asumsi**, bukan ketokan. Kalau keliru, **koreksinya sebelum mesin
statusnya didaftarkan** — sesudah itu ia jadi transisi yang sudah tercatat di
`audit_log` dan tidak bisa ditarik.

### 3.2 Yang belum ada sama sekali

Nol baris kode. Yang dibutuhkan D-3, berurutan:

1. Tabel bulan-tertutup + **angka yang dibekukan** per bulan (mesin laporan
   membaca bulan tertutup dari sini, BUKAN menghitung ulang dari data mentah).
2. Mesin status tutup-buku (`sm_machines` 31 → 32) dengan **dua gerbang peran
   yang BERBEDA**: tutup (Finance lead ATAU Director) dan buka-ulang
   (Director SAJA). Satu gerbang untuk keduanya adalah cacatnya.
3. Jalur **jurnal koreksi** di bulan berjalan, ikut masuk `audit_log`.
4. Pagar: bulan tertutup menolak tulisan apa pun — di DB, bukan hanya di TS.
5. **Versi angka beku** + tampilan selisih antar versi (§3.1 konsekuensi 2 & 3).

Mesin accrual (§2.2) sudah memenuhi syaratnya: ia **deterministik dan bebas
jam**, jadi angka beku bisa dibandingkan dengan hasil hitung ulang kapan saja
untuk mencari selisih.

---

## 4. ✅ D-4 — SELESAI, dan bentuknya SEMPAT SALAH sebelum dikoreksi

Pemilik mengetok **dua kali dalam satu hari**, dan yang kedua mengubah bentuknya.
Urutan itu penting untuk yang membaca commit-nya nanti:

| | Ketokan | Yang dibangun |
|---|---|---|
| pertama | *"semua laporan accrual sebelum PPN, PPN kolom tambahan"* | PPN diturunkan dari `master_service_versions.apply_ppn`, kolom PPN di **lima** tabel |
| kedua | *"semua harga non ppn, negosiasi maupun non nego. Berlaku untuk SEMUA MSL. Sales klik tombol include ppn, harga bertambah 11% di invoice"* | ✅ **bentuk final**: satu penanda di **`transactions`**, katalog tidak menentukan apa pun |

**Kenapa yang kedua benar dan yang pertama tidak:** PPN bukan sifat sebuah
layanan. Layanan yang sama bisa ditagih ber-PPN ke satu klien dan tidak ke klien
lain — yang menentukan status transaksinya, bukan jenis jasanya. Menaruh
penandanya di katalog berarti satu keputusan pajak dipakai ulang untuk semua
klien, dan itu salah untuk sebagian dari mereka **tanpa ada yang melihatnya**.

Migrasi 191 **ditulis ULANG di tempat**, bukan ditumpuk migrasi koreksi: ia belum
pernah diterapkan ke live (live 189), jadi menyuntingnya tidak melanggar larangan
menyunting migrasi yang sudah berjalan.

### 4.1 Dua cacat yang ditemukan saat membangunnya

Keduanya dibuktikan lewat **kode berjalan**, bukan dari membaca:

1. Laporan accrual akan mengakui pendapatan **11% lebih besar** dari yang
   benar-benar milik perusahaan. PPN titipan negara, bukan pendapatan.
2. `buildQuote` menghitung **komisi dari nilai yang sudah ber-PPN**.
   Rp 10.000.000 dengan aturan `10% of standard price` membayar
   **Rp 1.110.000**, bukan Rp 1.000.000 — komisi atas uang pajak.

**Cacat #2 belum pernah merugikan di live**, dan itu perlu disebut apa adanya:
keempat baris live yang ber-PPN semuanya beraturan `0% of standard price`, jadi
selisihnya nol rupiah. Laten, bukan kerugian yang sudah terjadi.

### 4.2 Bentuk final

```
transactions.include_ppn   boolean  — tombol yang Sales tekan
transactions.total_ppn     numeric  — rupiahnya, DIBEKUKAN
total_agreed_value                  — SELALU non-PPN
```

- `computeSubtotal` tidak punya input PPN sama sekali — bukan hanya
  "tidak membacanya". Ia **tidak bisa** melebur pajak walau salah tulis.
- **PPN dihitung SEKALI atas total invoice**, bukan per baris lalu dijumlah.
  11% dari 5.000.005 dua kali membulat berbeda dari 11% dari 10.000.010 sekali,
  dan yang dibayar klien adalah invoice-nya.
- **Komisi dari nilai non-PPN.**
- **Cicilan divalidasi terhadap dasar + PPN** — pagar terpenting: skedul yang
  hanya menjumlah dasarnya terlihat benar dari segala arah (ia cocok dengan
  `total_agreed_value`) dan tetap menagih klien 11% kurang dari fakturnya.
- `total_ppn` **dibekukan**, tidak dihitung ulang dari tarif hari ini — tarif PPN
  berubah lewat undang-undang, dan invoice lama harus tetap menyebut pajak yang
  benar-benar ditagihkan waktu itu.
- Dua CHECK DB: `total_ppn >= 0`, dan `include_ppn OR total_ppn = 0`.
- `apply_ppn` di katalog & snapshot: **DEPRECATED**, tidak dibaca jalur harga
  mana pun. Belum di-drop — itu migrasi tersendiri sesudah kode ter-deploy.

Default tombol **MATI**: invoice yang tidak ditandai ditagih tanpa pajak — kurang
tagih yang kelihatan dan bisa dikoreksi, bukan lebih tagih ke klien yang tidak
pernah menyetujuinya.

### 4.3 Uji-kering backfill ke live (read-only, 2026-09-08) — dan yang SENGAJA dilewat

| TRX | Status | Sebelum | Dasar | PPN | 11% tepat? |
|---|---|---|---|---|---|
| TRX-202608-0008 | `[Lunas]` | 57.720.000 | 52.000.000 | 5.720.000 | ✅ |
| TRX-202608-0009 | Menunggu | 22.200.000 | 20.000.000 | 2.200.000 | ✅ |
| TRX-202608-0010 | `[Lunas]` | 72.150.000 | 65.000.000 | 7.150.000 | ✅ |
| **TRX-202609-0002** | `[Lunas]` | 23.575.000 | — | — | ⛔ **tidak disentuh** |

Ketiga yang dipisah: **nilai ditagih tidak bergeser satu sen**, dan ketiganya
memenuhi 11% tepat.

**Yang keempat sengaja dilewat, dan itu temuan uji-keringnya.** Versi pertama
migrasi ini menelusuri lewat `clients.lead_id` dan menyapunya masuk. Totalnya
23.575.000 sementara baris ber-PPN-nya hanya 5.550.000 — sisanya Rp 18.025.000
dari baris lain yang tidak bisa diatribusikan. Kalau tetap dipisah, hasilnya
`total_ppn` 550.000 atas dasar 23.025.000, yaitu **2,4%, bukan 11%**: baris yang
terlihat sah di setiap layar dan tidak akan pernah bisa dijelaskan siapa pun.

Jadi §3e sekarang punya **dua pagar** — telusur lewat `services` yang
benar-benar cocok, DAN hasil pisahnya wajib 11% tepat. Ia ditinggalkan utuh:
nilai tercatat = ditagih = dibayar, ketiganya tetap benar.

---

## 5. ⚠️ Migrasi 190 BELUM diterapkan ke live — urutannya WAJIB

Repo **190**, live **189**.

⛔ **JANGAN `supabase db push`** (ledger versi live berbeda wholesale dari nama
berkas repo — `O65`, masih terbuka). Pakai `mcp__Supabase__apply_migration`
**per berkas**, lalu **verifikasi lewat kueri katalog** — jangan percaya
`success: true` saja. Proyek live: `egddxfcnrtecheiykhlf` (`CDPS SG`).

**Migrasi 190 dan 191 punya aturan urutan yang BERBEDA. Jangan disamakan.**

**190** aditif murni (kolom baru + backfill, nol rename, nol drop) ⇒ **boleh
mendahului kode**.

⛔ **191 WAJIB MENYUSUL deploy kodenya.** Ia menulis ulang
`subtotal`/`proposed_price`/`total_agreed_value` jadi 11% lebih kecil dan
memindahkan selisihnya ke kolom PPN baru. Kode LAMA membaca kolom-kolom itu
sebagai satu angka utuh — jadi di antara apply dan deploy, setiap halaman uang
akan menampilkan dan menagih **11% lebih kecil dari yang benar**, tanpa error di
mana pun. Ini kelas yang sama dengan migrasi 186 (§7 handoff sebelumnya), bukan
kelas 187.

Urutan yang terbukti dan yang harus dipakai untuk keduanya:

> **merge → tunggu tiga deploy Vercel produksi READY di commit merge → apply per
> berkas → verifikasi kueri katalog.**

Kueri verifikasinya sesudah apply — angka yang HARUS keluar:

```sql
WITH terkini AS (
  SELECT DISTINCT ON (service_id) name, durasi_bulan, pengakuan, active
    FROM master_service_versions ORDER BY service_id, version_no DESC)
SELECT pengakuan, count(*) FROM terkini WHERE active GROUP BY pengakuan;
--  per_periode       42
--  saat_selesai      37     <- 38 dikurangi Komisi
--  bulan_berikutnya   1     <- Komisi
```

### Verifikasi migrasi 191 sesudah apply — angka yang HARUS keluar

```sql
select count(*)                                as trx_ber_ppn,   -- 3
       sum(total_agreed_value)                 as dasar,          -- 137.000.000
       sum(total_ppn)                          as ppn,            -- 15.070.000
       sum(total_agreed_value + total_ppn)     as ditagih,        -- 152.070.000
       bool_and(round(total_agreed_value * 0.11, 0) = total_ppn) as semua_11_persen  -- true
  from transactions where include_ppn;
```

Yang WAJIB dicek: **`ditagih` harus sama persis dengan Σ `total_agreed_value`
tiga TRX itu SEBELUM migrasi** (152.070.000). Kalau bergeser, transaksi yang
sudah dibayar tidak lagi cocok dengan uang yang masuk — **hentikan, jangan
lanjutkan.**

Dan pastikan **`TRX-202609-0002` TIDAK ikut** (`include_ppn = false`,
`total_ppn = 0`) — itu disengaja, alasannya §4.3.

Dan: **migrasi yang SUDAH di-apply ke live tidak boleh disunting.** Perbaikan
atasnya = migrasi BARU (kelas drift yang O38 lahir darinya).

---

## 6. Verifikasi — perintah + angka acuan TERKINI

```
service postgresql start
su postgres -c "psql -c \\"ALTER USER postgres PASSWORD 'postgres';\\""   # sekali per container
export DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps"
bash scripts/db-rebuild.sh --yes
npm install && npm run typecheck --workspaces --if-present
npx vitest run --root packages/core
npx vitest run --root packages/db
npx vitest run --root packages/domain      # SENDIRIAN, sesudah db-rebuild
npx vitest run --root apps/api
cd web-internal && npm install && npx vitest run && npx tsc --noEmit && npm run build && npm run lint
cd ../web-client-portal && npx vitest run
```

| Suite | Sebelumnya | **Sekarang** |
|---|---|---|
| core | 935 | **982** (+47 accrual) |
| db | 53 | 53 |
| apps/api | 490 | **492** (+2 dari main) |
| **catatan** | | shape-parity & round-trip FE **sempat merah** saat kunci PPN ditambah — itu tugasnya; keduanya hijau lagi sesudah kontrak FE dilengkapi |
| domain | 1988 (+1 skip) | **2016** (+1 skip) (+8 pengakuan, +14 PPN, sisanya dari main) |
| web-internal | 650 | 650 |
| web-client-portal | 19 | 19 |
| migrasi `db-rebuild` | 189 | **195** (191 milik sesi ini + 4 dari main) |

`entity_prefix` 40 · `sm_machines` 31 · `notif_events` 69 — **tidak berubah**
(migrasi 190 murni kolom + data).

### Jebakan — yang paling mahal lebih dulu

- ⚠️ **`cd web-internal && npm install` TERPISAH dari `npm install` root.** Tanpa
  itu `xlsx` tidak ada dan `report-shopee-parse.test.ts` gagal **collect** —
  yang tampil sebagai "2 test file gagal" padahal hanya 1 tes yang benar-benar
  merah. Terjadi sesi ini.
- ⚠️ **`npm run typecheck --workspaces` WAJIB diulang SESUDAH `npm install`, dan
  keluarannya DIBACA.** Tanpa `node_modules`, `tsc` membanjiri keluaran dengan
  *"Cannot find module …"* dan galat sungguhan tenggelam. `core-engines`, `api`,
  DAN `db-and-migrations` ketiganya mengompilasi `@cdps/core`.
- ⚠️ **Jalankan `packages/domain` SENDIRIAN sesudah `db-rebuild`, dan JANGAN
  pernah menjalankan dua `db-rebuild` bersamaan.** Terbukti dua kali sesi ini.
  Yang kedua paling mahal: dua job latar sempat me-rebuild DB sementara suite
  berjalan, dan hasilnya **1055 tes merah** — angka yang terlihat seperti
  bencana dan sepenuhnya palsu. Dijalankan ulang berurutan: 2010 hijau.
  **Rebuild dulu, sendirian, baru cari bug.**
- ⚠️ **Postgres mati sendiri DUA KALI sesi ini**, dan salah satunya membuat
  `db-rebuild` gagal dengan pesan yang terlihat seperti cacat migrasi. `pg_isready`
  dulu — `service postgresql start` menyelesaikannya, migrasinya tidak apa-apa.
- **Postgres bisa mati sendiri di container ini** — `pg_isready` dulu sebelum
  menyimpulkan apa pun dari puluhan FAIL.
- `audit_log` menolak DELETE; `client_pitch_consents` menolak UPDATE dan DELETE.
- `rm -rf web-internal/.next` kalau muncul *"Another next build process is
  already running"*.
- 1 error lint `react-hooks/static-components` di `admin/employees/page.tsx`
  **PRE-EXISTING**, di luar cakupan. Nol error lint baru dari sesi ini.

---

## 7. Aturan kerja yang terbukti — dua yang BARU dari sesi ini

Delapan aturan di `HANDOFF_GELOMBANG_D_20260907.md` §8 tetap berlaku. Dua
tambahan yang lahir dari sesi ini:

9. **Tes yang belum pernah dibuat merah belum menjaga apa pun.** Enam mutasi
   sengaja dijalankan atas `accrual.ts`; **lima memerah**. Yang keenam TETAP
   HIJAU — dan itu **bukan** celah tes: dua pagar berbeda sama-sama menutup
   kasus yang sama, jadi mencabut salah satunya tidak mengubah hasil. Dibuktikan
   dengan mencabut **keduanya sekaligus**, yang langsung memerah.

   **Mutasi yang tetap hijau wajib dijelaskan, bukan diabaikan.** Sesi ini
   menemukan bahwa jawabannya bisa ada TIGA, bukan dua: "kodenya berlebihan",
   "tesnya bohong", atau — yang paling mahal — **"field itu memang tidak pernah
   terpakai"**. Yang ketiga terjadi di D-4: memutasi `standardLines` agar
   membuang PPN pinnya tidak memerahkan apa pun, karena
   `resolveProposalLine` memang sudah menghitung ulang PPN dari katalog dan
   field pinnya tidak pernah dibaca siapa pun. Itu bug yang hanya ketahuan
   karena mutasinya ditanyakan, bukan karena ada tes yang gagal.
10. **Bentuk keluaran mesin dipilih oleh gerbang yang paling kaku, bukan oleh
    yang paling enak dibaca.** Irisan bulanan dipilih bukan karena lebih rapi,
    tapi karena D-3 (bulan tertutup tidak bisa diedit) **melarang** bentuk yang
    lain. Ketika dua ketokan tampak bertabrakan, yang menutup pilihan biasanya
    ketokan ketiga yang sedang tidak dibicarakan.

---

## 8. Yang masih BELUM dibuktikan — disebut jujur

- **Piksel React.** Dropdown **Kapan Pendapatan Diakui** dan kolom **Pengakuan**
  di `/master-services` lolos `tsc`, `vitest`, `next build`, `lint`, dan rutenya
  diuji — **tapi belum ada yang membukanya di peramban.** Sama seperti **Durasi
  Jasa (bulan)** dan **Kalau Klien Beli Lebih dari Satu** dari sesi sebelumnya,
  yang **juga masih belum dibuka.** Utang ini sekarang tiga field.
- **`/showcase` di peramban** — utang lama Gelombang C, masih belum dibayar.
- **Mesin accrual belum punya satu pemanggil pun.** Ia lengkap dan teruji, tapi
  belum ada route, halaman, atau laporan yang memakainya. Jahitan
  `domain -> core` untuk accrual **belum ada**, jadi aturan kerja #1 ("setiap
  jahitan wajib punya satu tes yang memanggil KEDUA sisi sungguhan") belum bisa
  dipenuhi untuk mesin ini. **Itu pekerjaan pertama sesudah D-3 diketok.**
- **Riwayat hold belum diturunkan dari `audit_log` untuk layanan.** Mesin
  menerima `Hold[]`, dan `ads.computeTotalHariHold` adalah polanya — tapi
  penurun untuk entitas layanan/kontrak **belum ditulis**.
- **Migrasi 190 dan 191 belum di-live** (§5). 191 punya aturan urutan yang
  BERBEDA dari 190 — ia wajib MENYUSUL deploy kodenya, tidak boleh mendahului.
- **Halaman uang belum dibuka di peramban sesudah D-4.** Kalkulator Sales dan
  halaman attempt kini menampilkan tiga angka (dasar · PPN · ditagih) alih-alih
  satu. Lolos `tsc`, `vitest`, `next build`, `lint`, dan gerbang shape-parity —
  tapi tata letak tiga kolom itu belum pernah dilihat manusia.
- **Turunan D-4 yang menggeser tagihan** (§4.3) belum dikonfirmasi pemilik: harga
  negosiasi kini diperlakukan sebagai dasar dan dikenai PPN di atasnya.
