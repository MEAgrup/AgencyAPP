# Handoff — **Gelombang D dibangun. Empat dari empat butir §5. Belum menyentuh live.**

> **Baca ini dulu, lalu tiga berkas ini, urut:**
> 1. `docs/handoff/HANDOFF_GELOMBANG_D_20260907.md` — handoff yang sesi ini
>    kerjakan. §7 (aturan urutan rilis) **wajib** sebelum menyentuh live, dan ia
>    belum kedaluwarsa: **nol dari TIGA migrasi sesi ini sudah di-apply.**
> 2. `docs/DECISIONS.md` — baris `Decided` bertanggal **2026-09-07** (dua yang
>    baru: *D-KOM dibangun + mesin accrual*, dan *D-3 + D-4 dibangun*). Lalu
>    §Open: **empat baris 🟡 baru, `D-ACC-1`…`D-ACC-4`** — semuanya pilihan yang
>    diambil TANPA ketokan, dengan default yang sudah jalan.
> 3. `docs/STATE_MACHINES.md` §22 — mesin **#32** `periode_buku`, satu edge,
>    tanpa jalan buka kembali, dan kenapa.

---

## 1. Posisi

| | Status |
|---|---|
| Gelombang A · B · C | ✅ tutup |
| Penghalang D #1 — data durasi MSL | ✅ tutup (80/80, sesi sebelumnya) |
| Gerbang keputusan D (D-1…D-4 · D-KOM) | ✅ lima dari lima diketok |
| **D-KOM — kolom `pengakuan` di katalog** | ✅ **dibangun** (migrasi 190), 9 tes domain + 2 tes FE |
| **Mesin accrual `@cdps/core`** | ✅ **dibangun**, 52 tes murni |
| **Jahitan accrual (data nyata)** | ✅ **dibangun**, 20 tes ber-DB |
| **D-3 — kunci tutup buku + jurnal koreksi** | ✅ **dibangun** (migrasi 191), 26 tes |
| **D-4 — penanda pilihan PPN per transaksi** | ✅ **dibangun** (migrasi 192), 11 tes domain + 8 tes core |
| **Apply ke live** | 🔴 **BELUM. Nol dari tiga migrasi.** Lihat §5 |
| Piksel React yang baru | 🔴 belum pernah dibuka di peramban — lihat §7 |

Migrasi: repo **192 berkas**, live **189**. **TIGA berkas menunggu**, dan
ketiganya **ADITIF** — §7 mengizinkan mereka mendahului deploy kode:

| Berkas | Isi | Nomor urut repo |
|---|---|---|
| `20260922010000_dkom_pengakuan.sql` | kolom `pengakuan` + pemetaan awal | 190 |
| `20260923010000_d3_tutup_buku.sql` | `periode_buku` + `periode_buku_baris` + `jurnal_koreksi` + mesin #32 | 191 |
| `20260924010000_d4_ppn_pilihan.sql` | `transactions.ppn_pilihan` | 192 |

("Migrasi 190/191/192" di tabel Posisi adalah nomor urut berkas itu, bukan tiga
berkas per baris.)

---

## 2. Apa yang dibangun, dan di mana

### 2.1 D-KOM — `master_service_versions.pengakuan`

Tiga nilai (`per_periode` · `saat_selesai` · `bulan_berikutnya`), pemetaan awal
diturunkan dari data (`durasi_bulan IS NOT NULL` ⇒ per_periode · NULL ⇒
saat_selesai · `Komisi` ⇒ bulan_berikutnya, mengalahkan keduanya).

- **DEFAULT `saat_selesai`** — satu-satunya nilai yang SAH untuk setiap
  `durasi_bulan` (termasuk NULL), jadi ia tidak bisa bertabrakan dengan CHECK
  baru; dan ia sisi yang KELIHATAN kalau salah (layanan berdurasi yang
  tertinggal di situ menumpuk pendapatannya di satu bulan — benjolan yang
  dilaporkan). Logika identik dengan DEFAULT `volume` untuk `qty_menambah`.
- **`ck_msv_pengakuan_periode_butuh_durasi_bulan` SATU ARAH.** `per_periode`
  menuntut durasi; layanan berdurasi TIDAK dipaksa `per_periode` (layanan 1
  bulan yang dibayar saat kelar adalah kombinasi sah). Menegakkannya dua arah
  berarti mengarang aturan yang tidak pernah diketok.
- Jalur kodenya penuh: `msl.ts` → `wire.ts` → dua route `/master-services` →
  `lib/msl.ts` → form + dua tabel `/master-services`.
- Gate baru `pengakuan_komisi` di `db-rebuild.sh`.

### 2.2 Mesin accrual — `packages/core/src/accrual.ts`

Satu fungsi murni `jadwalkan()`. **Tes ditulis DULUAN** (52).

- Keluaran per **BULAN KALENDER** (`YYYY-MM`), satu bulan satu baris — satuan
  yang D-3 kunci.
- **Satu invariant menjaga seluruh cabangnya:**
  `nilaiBruto = diakui + hangus + belumDiakui`, tanpa kecuali. Tiga ember
  terpisah karena "hilang" (D-1) dan "belum datang" adalah dua kalimat berbeda
  di rapat penutupan buku.
- **Satu aturan void untuk ketiga pengakuan:** `tanggalVoid` adalah hari
  PERTAMA yang tidak diakui, jadi sesuatu diakui kalau titik pengakuannya jatuh
  SEBELUM tanggal itu. Hari ke-11 tidak diakui saat void 11 Januari; layanan
  sekali-jadi tidak diakui saat void pada hari selesainya; komisi tidak diakui
  saat void pada tanggal 1 bulan pengakuannya.
- Hold bersarang/berulang/tumpang-tindih = **GABUNGAN hari** (§9 handoff lama
  menyebutnya belum dipikirkan). Hold yang **masih berjalan** memotong jadwal
  dan menandainya `terpotongHold` alih-alih menebak tanggal selesainya.
- **Pembulatan:** yang dibulatkan adalah KUMULATIF-nya, tiap bulan lahir sebagai
  SELISIH dua titik kumulatif, dan titik terakhir dipaku persis ke nilai bruto —
  sen dan sisa pembagian jatuh di bulan terakhir, tempat akuntan mencarinya.
- `tz.daysBetweenDate` ditambahkan (selisih hari kalender, half-open) + 7 tesnya, termasuk yang mengadu KONSISTENSI-nya dengan `addMonthsToDate`/`addDaysToDate` — bukan masing-masing sendiri-sendiri.

### 2.3 Jahitan — `packages/domain/src/accrual.ts`

Merakit masukan mesin dari data nyata. **Semua tanggalnya diturunkan dari
`audit_log`, nol kolom baru** (aturan rumah #3):

```
mulai jalan   transisi PERTAMA `-> [In Execution]`
hold          pasangan `-> [On Hold]` … `-> [In Execution]`
void          `-> [Cancelled — Service Voided]`
selesai       `-> Done`
penjualan     `services.created_at` (baris lahir di Closing)
```

- **`[Hold Requested]` BUKAN hold** (migrasi `20260814080000` menyatakannya
  ACTIVE): pengakuan berhenti saat Head MENYETUJUI. Karena penolakan hold juga
  berakhir di `-> [In Execution]`, ronde minta-lalu-DITOLAK diuji utuh.
- **Qty mengalikan DURASI, tidak pernah mengalikan UANG.** `services
  .standard_price` = harga negosiasi per baris, dan Σ-nya =
  `transactions.total_agreed_value`; tesnya mengadu keduanya. Qty hanya ada di
  `qualified_form_services.quantity` (lewat `clients.winning_attempt_id`).
- Versi MSL yang dibaca adalah versi yang **DIPIN**, bukan yang terbaru.
- Baris yang masukannya ditolak mesin (qty pecahan pada layanan berdurasi)
  TETAP muncul dengan `galat` terisi.
- `riwayatTransisi` **batched**: jumlah kueri tidak tumbuh bersama jumlah
  layanan, dijaga hitungan kueri (pola `perf_n1.test.ts`).

### 2.4 D-3 — `packages/domain/src/tutupbuku.ts` + migrasi `20260923010000`

- Mesin **#32** `periode_buku`: `Terbuka → Ditutup`, `require_lead`, terminal,
  **nol jalan buka kembali**. Trigger `guard_periode_buku_tertutup` menolak
  SETIAP `UPDATE` **dan** `DELETE` atas baris tertutup — termasuk dari `psql`.
- `periode_buku_baris` — angka pengakuan yang **DIBEKUKAN** saat tutup,
  append-only, satu baris per `(bulan, layanan)`, plus provenance.
- `jurnal_koreksi` (`JRK-`) — satu-satunya jalan memperbaiki bulan tertutup.
  `nilai` **BERTANDA**, `alasan` wajib, append-only.
- `laporanBulan` mengembalikan **`sumber: 'beku' | 'dihitung'`**.
- Tiga gerbang: bulan belum berakhir · sudah tertutup · **tutup BERURUTAN**.
- `PBK-` dicetak dengan stempel hari pertama bulan yang diwakilinya, bukan
  `now()`: buku Maret tetap `PBK-202603-0001` walau ditutup April.

### 2.5 D-4 — `transactions.ppn_pilihan` + migrasi `20260924010000`

- `'kena'` | `'tidak_kena'` | **NULL = belum ada yang memilih**. Nullable
  TANPA default — itu seluruh isinya (lihat §4 butir 2).
- Sales memilih saat Closing (`sales.ClosingInput.ppn`); Finance segala
  level/Director mengubahnya sesudah itu (`finance.setPpnPilihan`), ber-audit
  before→after termasuk perubahan PERTAMA dari NULL.
- `total_agreed_value` **tidak disentuh**. Panel di
  `/finance/transactions/{id}` menyebut kalimat itu di layar.
- Tarif 11% pindah ke `@cdps/core` `ppn.ts` sebagai konstanta bernama;
  `sales.ts` mengimpornya. Satu tarif pajak, satu definisi.
- `apply_ppn` katalog **DIBIARKAN** apa adanya — ia masukan kalkulator
  PENAWARAN pra-negosiasi yang dipin sebagai snapshot M0. Batasnya:
  **katalog memberi SARAN untuk penawaran; `ppn_pilihan` mencatat KEPUTUSAN
  untuk transaksi.**

---

## 3. Verifikasi — perintah + angka acuan TERKINI

```
service postgresql start
su postgres -c "psql -c \"ALTER USER postgres PASSWORD 'postgres';\""   # sekali per container
export DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps"
bash scripts/db-rebuild.sh --yes
npm install && npm run typecheck --workspaces --if-present
npx vitest run --root packages/core
npx vitest run --root packages/db
npx vitest run --root packages/domain      # SENDIRIAN, sesudah db-rebuild
npx vitest run --root apps/api
cd web-internal && npm install && npx vitest run && npx tsc --noEmit && npm run build
cd ../web-client-portal && npx vitest run
```

| Suite | Sebelum | **Sesudah** |
|---|---|---|
| core | 935 | **1002** (+52 accrual, +8 ppn, +7 `tz.daysBetweenDate`) |
| db | 53 | **53** |
| apps/api | 490 | **490** |
| domain | 1988 (+1 skip) | **2054** (+1 skip) |
| web-internal | 650 | **652** |
| web-client-portal | 19 | **19** |
| migrasi `db-rebuild` | 189 | **192** |
| tabel `public` | 146 | **149** |
| `entity_prefix` | 40 | **42** (+PBK, +JRK) |
| `sm_machines` | 31 | **32** (+periode_buku) |
| `notif_events` | 69 | **69** (nol event baru — lihat §4 butir 4) |

⚠️ **Gate hitung ada DUA kali** — `scripts/db-rebuild.sh` dan
`.github/workflows/ci.yml`. Keduanya sudah dinaikkan **di commit yang sama**
(pelajaran PR #170: menaikkan salah satu saja membuat lokal hijau dan CI merah).

---

## 4. Jebakan yang DITEMUKAN sesi ini — yang paling mahal lebih dulu

1. ⚠️⚠️ **Sebuah gerbang tes bisa hijau karena "yang diubah ternyata tidak
   mengubah apa pun".** Mutasi sengaja yang mencabut cabang *"bulan tertutup
   dibaca dari angka beku"* — inti tuntutan D-3 — **tidak membuat satu tes pun
   merah**. Sebabnya: "data mentah yang diubah" di tes versi pertama adalah
   sebuah void HARI INI, dan void hari ini tidak menyentuh bulan yang sudah
   lewat. Tesnya sekarang punya DUA bagian: (a) suntikan hold di tengah bulan
   tertutup dibuktikan MENGUBAH angka kalau dihitung ulang — dengan memanggil
   mesin accrual langsung, yang tidak pernah membeku; dan (b) laporannya tetap
   menyebut angka beku. **Pelajarannya umum:** sebuah tes "X tidak berubah"
   wajib membuktikan lebih dulu bahwa ada sesuatu yang SEHARUSNYA mengubahnya.
2. ⚠️ **Mutasi yang tidak bisa merah kadang menandai kode yang tidak
   load-bearing, bukan lubang tes.** Mencabut penggabungan interval hold di
   `core/accrual.ts` tidak membuat satu tes pun merah — dan sesudah diperiksa,
   penggabungan itu memang salinan kedua dari aturan yang sudah dijaga
   penjalanannya sendiri (kursor melompat ke akhir hold, lalu bertanya lagi).
   Ia **dibuang**, bukan ditambahi tes untuk membenarkan keberadaannya.
3. ⚠️ **`ck_pbk_tutup_lengkap` versi pertama bertabrakan dengan trigger
   kekekalannya sendiri.** CHECK dua arah (`status='Ditutup'` ⟺ stempel ada)
   mustahil dipenuhi, karena trigger menolak UPDATE atas baris tertutup ⇒
   stempelnya WAJIB ditulis SEBELUM transisinya, dan pada pernyataan itu
   statusnya masih `Terbuka`. CHECK-nya dibuat satu arah. **Kalau ada yang
   membalik urutan tulis di `tutupBulan`, DB-nya gagal keras — dan itu memang
   yang diinginkan.**
4. ⚠️ **Menambah notifikasi butuh naik versi katalog + DUA gate hitung.**
   Sesi ini **tidak** menambah event: tidak ada entri katalog Fase 0 v2 §9 yang
   meminta notifikasi tutup buku, dan mengarang satu berarti mengarang entri
   katalog. Kalau pemilik nanti mau notifikasi "buku bulan X ditutup", jalurnya
   `notif_catalog_versions` + `notif_events` + `db-rebuild.sh` + `ci.yml`,
   semuanya satu commit.
5. ⚠️ **`audit_log` menolak UPDATE dan DELETE, dan itu membentuk cara tes
   ditulis.** Rentang MULTI-BULAN tidak bisa diuji dengan menggeser tanggal
   baris yang ada; yang dipakai adalah menyisipkan baris audit bertanggal
   lampau yang **`action`-nya dibaca ulang dari baris yang mesin status tulis
   sendiri** — jadi string transisi tidak bisa menyimpang dari produksi tanpa
   membuat tes merah.
6. ⚠️ **Dua tes lain memerah karena DB TIDAK di-rebuild, bukan karena kode.**
   `admin.test.ts` (hari libur) dan `client.test.ts` (hold notif) menghitung
   baris `audit_log`/notifikasi yang MENUMPUK antar-run. Handoff lama sudah
   menyebut ini; sesi ini mengalaminya. **Rebuild dulu, baru cari bug.** Tes
   baru sesi ini yang menghitung baris audit memakai id aktor ber-`Date.now()`
   supaya ia tetap tepat pada run kedua.
7. ⚠️ **Teardown tidak boleh mematikan invariant untuk seluruh suite.**
   `tutupbuku.test.ts` harus menghapus baris yang jalur produksinya sengaja
   tidak bisa menghapus. Ia memakai `SET LOCAL session_replication_role =
   replica` **di dalam satu transaksi** — berlaku hanya untuk koneksi itu.
   `ALTER TABLE ... DISABLE TRIGGER` sengaja TIDAK dipakai: vitest menjalankan
   berkas tes paralel, dan itu akan membuka jendela di mana kekekalan tabel mati
   untuk semua orang.
8. **`react-hooks/static-components` di `admin/employees/page.tsx`** tetap 1
   error lint **PRE-EXISTING**, di luar cakupan.

---

## 5. ⚠️ Yang HARUS dilakukan sebelum menyentuh live

**Nol dari tiga migrasi sesi ini sudah di-apply.** Urutan yang §7 handoff lama
tetapkan dan yang terbukti:

> **merge → tunggu tiga deploy Vercel produksi READY di commit merge → apply
> per berkas lewat `mcp__Supabase__apply_migration` → verifikasi lewat kueri
> katalog → isi data.**

⛔ **JANGAN `supabase db push`** — ledger versi live berbeda *wholesale* dari
nama berkas repo (`O65`, masih terbuka). Proyek live: `egddxfcnrtecheiykhlf`
(`CDPS SG`).

Ketiga berkas **ADITIF** (nol kolom di-rename/dihapus, nol tabel lama
disentuh), jadi aturan §7 mengizinkan mereka mendahului deploy kode. Tapi
urutan merge-dulu tetap disarankan: kode yang sudah tayang akan langsung
membaca kolom baru itu, dan tidak ada yang rugi kalau ia menunggu.

Kueri verifikasi sesudah apply:

```sql
-- 20260922010000 (pengakuan)
select pengakuan, count(*) from master_service_versions group by 1 order by 1;
--   harapkan: bulan_berikutnya = jumlah versi `Komisi`; per_periode = versi
--   ber-durasi; saat_selesai = sisanya. Nol pelanggaran CHECK.
select count(*) from master_service_versions where pengakuan = 'per_periode' and durasi_bulan is null;  -- 0

-- 20260923010000 (tutup buku)
select count(*) from information_schema.tables
 where table_schema = 'public' and table_name in ('periode_buku','periode_buku_baris','jurnal_koreksi');  -- 3
select count(*) from sm_edges where machine = 'periode_buku';        -- 1
select count(*) from sm_edges where machine = 'periode_buku' and from_state = 'Ditutup';  -- 0
select prefix from entity_prefix where prefix in ('PBK','JRK') order by 1;  -- PBK, JRK

-- 20260924010000 (ppn_pilihan)
select ppn_pilihan, count(*) from transactions group by 1;  -- harapkan semuanya NULL
```

**Migrasi yang SUDAH di-apply ke live tidak boleh disunting.** Perbaikan
atasnya = migrasi BARU.

---

## 6. Pertanyaan terbuka yang sesi ini BUKA — semuanya non-blocking

Keempatnya adalah pilihan yang diambil **tanpa ketokan**, dengan default yang
sudah jalan. Rinciannya di `DECISIONS.md` §Open.

| # | Pertanyaan | Default yang dibangun | Kalau dibalik, yang berubah |
|---|---|---|---|
| **D-ACC-1** | granularitas "diakui rata sepanjang `durasi_bulan`" | **per HARI**, lalu dijumlah per bulan kalender (layanan 1 bulan yang mulai 15 Maret mengakui DUA bulan) | fungsi `jadwalPerPeriode` di `core/accrual.ts` saja |
| **D-ACC-2** | "tanggal mulai jalan" sebuah layanan | transisi PERTAMA `-> [In Execution]` di `audit_log` | `riwayatTransisi` di `domain/accrual.ts` saja |
| **D-ACC-3** | siapa "satu peran berwenang menutup buku" | Head of Finance (Finance lead) atau Director; OD di luar | `tutupbuku.canTutupBuku` (+ `sm_edges.require_lead` kalau mau sampai DB) |
| **D-ACC-4** | pembagian "Sales/Finance yang memilih" PPN | Sales saat Closing; Finance segala level/Director sesudahnya | `finance.canPilihPpn` saja |

Aturan kerja yang ini semua lahir dari: **CLAUDE.md menuntut bacaan yang
ambigu DIAJUKAN alih-alih dipilih diam-diam.** Keempatnya diajukan, dan
keempatnya juga sudah punya default yang jalan — karena menahan seluruh
Gelombang D untuk empat pertanyaan yang tidak memblokir apa pun akan
menghasilkan nol kode dan empat pertanyaan.

---

## 7. Yang masih BELUM dibuktikan — disebut jujur

- 🔴 **Nol dari tiga migrasi sudah di-apply ke live.** Seluruh §2 hijau di
  Postgres lokal yang dibangun ulang dari 192 migrasi, dan **belum pernah**
  menyentuh `CDPS SG`.
- 🔴 **Piksel React.** Tiga permukaan baru — dropdown **Kapan Pendapatannya
  Diakui** + kolom **Pengakuan** di `/master-services`, dan panel **Perlakuan
  PPN** di `/finance/transactions/{id}` — lolos `tsc`, `vitest`,
  `next build`, dan gerbang `shape-parity`/`body-parity`/`route-parity`, tapi
  **belum ada yang membukanya di peramban.** Yang terbukti kontraknya, bukan
  tata letaknya. (Utang yang sama masih berlaku untuk field **Durasi Jasa** dan
  dropdown **Kalau Klien Beli Lebih dari Satu** dari sesi sebelumnya.)
  **Kenapa belum:** `FE_UAT_RUNBOOK.md` prasyaratnya masih menyebut stack Go
  (`cdps :8080`) yang sudah diarsip, dan login CDPS ada di Supabase GoTrue —
  bukan di Postgres lokal. Membukanya di peramban menuntut deploy Vercel atau
  runbook baru; keduanya di luar apa yang bisa dilakukan tanpa menyentuh live.
- 🔴 **`/showcase` di peramban** — utang lama Gelombang C, masih belum dibayar.
- 🟡 **Mesin accrual belum punya PERMUKAAN.** `domain/accrual.ts` dan
  `domain/tutupbuku.ts` lengkap dan teruji, tapi **belum ada route `apps/api`
  dan belum ada halaman** untuk laporan pengakuan bulanan / tombol tutup buku /
  form jurnal koreksi. Yang ada baru satu route baru:
  `PUT /transactions/{id}/ppn`. **Itu butir berikutnya yang paling jelas**, dan
  `KNOWN_GAPS` di `route-parity.test.ts` tetap **kosong** karena belum ada
  halaman yang memanggil apa pun yang belum ada.
- 🟡 **Nol data uji di live untuk mencoba tutup buku sungguhan.** Live punya 11
  transaksi dan nol layanan yang pernah melewati `[In Execution]` dengan
  riwayat hold; jadi jalur D-2/D-3 di live belum pernah dijalani dengan angka
  nyata, hanya dengan fixture.
- 🟡 **Baris audit `koreksi_unit_sisa_angka` mencatat 44 layanan padahal hanya
  16 yang berubah** (cacat migrasi 188, permanen). Data katalognya BENAR.

---

## 8. Aturan kerja yang terbukti dan wajib dibawa

Tujuh dari handoff sebelumnya tetap berlaku apa adanya. Sesi ini menambah tiga:

8. **Tes "X tidak berubah" wajib membuktikan lebih dulu bahwa ada sesuatu yang
   SEHARUSNYA mengubahnya.** Tanpa bagian itu, ia hijau karena tidak ada yang
   menggeser apa pun — dan gerbangnya bisa dicabut tanpa satu tes pun merah
   (§4 butir 1, kejadian nyata sesi ini atas inti tuntutan D-3).
9. **Mutasi yang tidak bisa merah punya DUA arti, dan keduanya harus
   diperiksa:** lubang tes, atau kode yang tidak load-bearing. Yang pertama
   ditambal, yang kedua **dibuang** — menambahkan tes untuk membenarkan salinan
   kedua dari sebuah aturan bisnis adalah cara membekukan salinan itu selamanya
   (§4 butir 2).
10. **Sebuah saringan pada laporan KEUANGAN yang bisa membuang baris adalah
    cacat, bukan optimasi.** Versi pertama `jadwalSemua` menyaring layanan
    menurut `services.created_at`; alasannya terdengar benar dan langsung
    terbukti bisa keliru (hari pengakuan diturunkan dari `audit_log`, yang bisa
    bertanggal lebih awal daripada baris `services`-nya). Saringan itu dicabut:
    laporan yang terlihat lengkap dan berjumlah kurang tidak bisa dibedakan dari
    laporan yang benar.
