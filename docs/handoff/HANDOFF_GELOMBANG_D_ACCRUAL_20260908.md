# Handoff — **Mesin accrual Gelombang D ada. D-3 buntu di satu pertanyaan pemilik.**

> **Baca ini dulu, lalu:**
> 1. `docs/DECISIONS.md` — tujuh baris `Decided` bertanggal **2026-09-08**, dan
>    **§Open: `D-3-PERAN` masih 🔴 dan memblokir seluruh D-3 — jangan ditebak.**
>    (`D-4-DASAR` sudah ✅ diketok pemilik 2026-09-08; lihat §4.)
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
| **D langkah 3 — kunci tutup buku (D-3)** | 🔴 **BUNTU** — peran yang berwenang menutup tidak pernah disebut siapa pun |
| **D langkah 4 — PPN (D-4)** | ✅ **DIKETOK & DIBANGUN 2026-09-08** — nilai disimpan sebelum PPN, PPN kolom tambahan. Lihat §4 |

Migrasi: repo **191**, live **189** — **190 dan 191 BELUM diterapkan ke live.** Lihat §5.
⚠️ **191 WAJIB MENYUSUL deploy kodenya**, tidak boleh mendahului. Alasannya di §5.

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

## 3. 🔴 Yang MEMBLOKIR langkah berikutnya — jangan ditebak

**`D-3-PERAN`: peran mana yang berwenang MENUTUP buku bulanan?**

D-3 diketok *"ya, ada kunci tutup buku"* dan menyebut *"satu peran berwenang
menutup"* — tapi **peran itu tidak pernah disebut**. Dicari 2026-09-08 di
`DECISIONS.md`, `docs/prd/`, dan seluruh `docs/handoff/`: **nol hasil.**

Yang harus ditanyakan ke pemilik sekaligus, karena ketiganya satu paket:

1. Peran mana yang boleh **menutup** bulan — Director? Finance lead? OD?
2. Peran mana yang boleh menulis **jurnal koreksi** di bulan berjalan — sama,
   atau lebih luas?
3. Bulan yang sudah ditutup, boleh **dibuka lagi** oleh siapa pun, atau tidak
   sama sekali? (D-3 bilang "tidak bisa diedit sama sekali" — perlu ditegaskan
   apakah itu berarti tidak ada jalan buka-ulang.)

Tanpa jawaban #1, mesin statusnya tidak bisa didaftarkan — dan menebaknya berarti
mengarang siapa yang boleh membekukan angka keuangan perusahaan.

**Sisa Gelombang D tidak diblokir olehnya**, dan sudah dibangun.

---

## 4. ✅ D-4 — diketok pemilik 2026-09-08 dan sudah dibangun

Ketokannya: *"semua laporan keuangan accrual dibuat sebelum PPN. PPN adalah
penambahan. Cek juga MSL supaya semua transaksi dibuat sebelum PPN, nanti PPN
adalah kolom tambahan."*

### 4.1 Dua cacat yang ditemukan saat membangunnya

Keduanya dibuktikan lewat **kode berjalan**, bukan dari membaca:

1. Laporan accrual akan mengakui pendapatan **11% lebih besar** dari yang
   benar-benar milik perusahaan. PPN titipan negara, bukan pendapatan.
2. `buildQuote` menghitung **komisi dari nilai yang sudah ber-PPN**.
   Rp 10.000.000 dengan aturan `10% of standard price` membayar
   **Rp 1.110.000**, bukan Rp 1.000.000 — komisi atas uang pajak.

**Cacat #2 belum pernah merugikan di live**, dan itu perlu disebut apa adanya:
keempat baris live yang ber-PPN semuanya beraturan `0% of standard price`, jadi
selisihnya nol rupiah. Ia laten, bukan kerugian yang sudah terjadi.

### 4.2 Yang dibangun

`computeSubtotal` berhenti melebur 11% dan mengembalikan **DASAR**; `computePPN`
baru mengembalikan pajaknya terpisah. Lima tabel jalur uang dapat kolom PPN
sendiri:

```
qualified_form_services.ppn · negotiation_proposal_lines.ppn
renewal_proposal_lines.ppn  · services.ppn · transactions.total_ppn
```

Komisi kini dihitung dari **dasar**, dan skedul cicilan divalidasi terhadap
**dasar + PPN** — karena itulah yang ditagih. Pagar terakhir itu yang paling
penting: skedul yang hanya menjumlah dasarnya terlihat benar dari segala arah
(ia cocok dengan `total_agreed_value`) dan tetap menagih klien 11% kurang dari
fakturnya.

### 4.3 ⚠️ Satu turunan yang MENGGESER rupiah tagihan

Harga **negosiasi** kini diperlakukan sebagai DASAR, dan PPN ditambahkan di
atasnya dari penanda katalog. Sebelumnya baris negosiasi tidak pernah kena PPN
sama sekali. Artinya baris negosiasi Rp 50.000.000 atas layanan ber-PPN yang
tadinya ditagih Rp 50.000.000 **kini ditagih Rp 55.500.000**.

Itu turunan langsung dari kata "**semua** transaksi dibuat sebelum PPN", tapi ia
satu-satunya bagian D-4 yang menggeser rupiah tagihan, jadi ia ditulis
terang-terangan (🟡 di `DECISIONS.md`) alih-alih diselipkan. **Kalau maksud
pemilik adalah harga negosiasi sudah termasuk PPN, ini yang dikoreksi lebih
dulu.** Nol baris live terdampak.

### 4.4 Cacat ketiga, ditemukan lewat mutasi yang TETAP HIJAU

`standardLines` sudah membawa `ppn` pinnya, tapi `resolveProposalLine`
memperlakukan baris berharga sebagai custom dan **menghitung ulang PPN dari
katalog hari itu** — field pinnya tidak pernah terpakai. Akibatnya admin yang
mematikan `apply_ppn` antara kualifikasi dan closing diam-diam mengubah tagihan
deal yang **sudah disepakati**.

Diperbaiki: pin menang, dan `submitNegotiation` **membuang** `pinnedPPN` dari
baris kiriman wire supaya klien tidak bisa menamai pajaknya sendiri
(CLAUDE.md #4). Ada tes untuk keduanya.

### 4.5 Uji-kering backfill terhadap data live (read-only, 2026-09-08)

| Yang diukur | Hasil |
|---|---|
| Baris QFS ber-PPN | 4 |
| Bisa dipisah **eksak** | **4 dari 4** |
| Baris negosiasi tertelusuri | 4 · renewal 0 · services 3 · TRX 3 |
| Σ dasar + Σ PPN | 142.000.000 + 15.620.000 = **157.620.000** |
| Nilai lama | **157.620.000** — tidak bergeser satu sen |
| TRX `[Lunas]` yang terdampak | 2, keduanya nilai tagihnya **tetap** |

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

Uji-keringnya sudah dijalankan terhadap live 2026-09-08 (read-only) dan hasilnya
di §4.5. Sesudah apply, angka ini harus sama:

```sql
select sum(total_agreed_value) as dasar, sum(total_ppn) as ppn,
       sum(total_agreed_value + total_ppn) as ditagih
  from transactions where total_ppn > 0;
--  dasar 137.000.000 | ppn 15.070.000 | ditagih 152.070.000
--  (tiga TRX: 0008, 0009, 0010 — dua di antaranya sudah [Lunas])
```

Yang WAJIB dicek: **`ditagih` harus sama persis dengan `total_agreed_value`
sebelum migrasi**. Kalau bergeser, transaksi yang sudah dibayar tidak lagi cocok
dengan uang yang masuk — hentikan dan jangan lanjutkan.

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
| apps/api | 490 | 490 |
| **catatan** | | shape-parity & round-trip FE **sempat merah** saat kunci PPN ditambah — itu tugasnya; keduanya hijau lagi sesudah kontrak FE dilengkapi |
| domain | 1988 (+1 skip) | **2010** (+1 skip) (+8 pengakuan, +14 PPN) |
| web-internal | 650 | 650 |
| web-client-portal | 19 | 19 |
| migrasi `db-rebuild` | 189 | **191** |

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
- ⚠️ **Jalankan `packages/domain` SENDIRIAN sesudah `db-rebuild`.** Terbukti lagi
  sesi ini: tanpa rebuild, 2 tes merah palsu; sesudah rebuild, 1996 hijau.
  **Rebuild dulu, baru cari bug.**
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
