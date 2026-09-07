# Handoff — **Gelombang D siap dibangun. Nol keputusan tersisa.**

> **Baca ini dulu, lalu dua berkas ini, urut:**
> 1. `docs/DECISIONS.md` — baris `Decided` bertanggal **2026-09-07** (ada
>    enam; yang menentukan D: *tujuh ketokan durasi Q1–Q7*, *klasifikasi 80
>    layanan*, dan *D-KOM diketok opsi (a)*). Lalu §Open: **tidak ada satu pun
>    baris 🔴 yang memblokir Gelombang D.**
> 2. `docs/handoff/HANDOFF_GELOMBANG_C_20260907.md` §4 — empat aturan uang
>    D-1…D-4 yang sudah diketok. **Itu spesifikasi D; jangan ketok ulang.**
>
> Latar belakang bagaimana durasi sampai ke bentuk sekarang ada di
> `HANDOFF_DURASI_BULAN_20260907.md`. Tidak wajib dibaca untuk membangun D,
> tapi §5-nya (aturan urutan rilis) **wajib** sebelum menyentuh live.

---

## 1. Posisi

| | Status |
|---|---|
| Gelombang A · B · C | ✅ tutup |
| Penghalang D #1 — data durasi MSL | ✅ **TUTUP** — 80/80 layanan terisi & terverifikasi di live |
| Gerbang keputusan D | ✅ **D-1 · D-2 · D-3 · D-4 · D-KOM — lima dari lima diketok** |
| **Gelombang D — laporan keuangan accrual** | 🟢 **SIAP DIBANGUN** |
| Penghalang #2 (jumlah laporan klien) | ⏸️ operasional, di luar D |
| Penghalang #3 (izin pitch, 0 baris) | ⏸️ operasional, di luar D |

Migrasi: repo **189**, live **189** (nomor 186–189 diterapkan 2026-09-07).

---

## 2. Lima aturan uang yang sudah diketok — JANGAN ketok ulang

| Gerbang | Ketokan | Yang wajib ikut dibangun |
|---|---|---|
| **D-1** | **HANGUS** | Layanan yang di-void di tengah periode diakui hanya untuk hari yang sudah jalan; sisanya tidak pernah diakui |
| **D-2** | **`[On Hold]` MENJEDA** pengakuan | Butuh riwayat hold (mulai/selesai) yang dibaca mesin laporan; skedul bergeser & dihitung ulang. Risiko operasional: hold harus diinput **saat kejadian**, bukan diingat belakangan |
| **D-3** | **ADA kunci tutup buku per bulan** | Satu peran berwenang **menutup** · bulan tertutup **tidak bisa diedit sama sekali**, koreksi hanya lewat **jurnal koreksi di bulan berjalan** yang ikut masuk audit log · mesin laporan membaca bulan tertutup dari **angka yang dibekukan**, bukan menghitung ulang dari data mentah |
| **D-4** | **Bruto dulu; Sales/Finance memilih kena PPN atau tidak** | Nilai disimpan **bruto** + penanda pilihan per transaksi. Mesin accrual **TIDAK** menghitung PPN sendiri |
| **D-KOM** | **Penanda `pengakuan` di katalog** (opsi a) | Tiga nilai; rinci di §4 |

---

## 3. Fondasi yang SUDAH ada — jangan bangun ulang

| Yang tersedia | Di mana |
|---|---|
| `master_service_versions.durasi_bulan` | BULAN kalender · NULL = sekali jadi |
| `master_service_versions.qty_menambah` | `'durasi'` \| `'volume'` |
| `tz.addMonthsToDate(ymd, n)` | `@cdps/core` — bulan kalender, clamp akhir bulan (31 Jan + 1 bln = 28/29 Feb) |
| `contracts.durasi_bulan` + `tanggal_mulai` / `tanggal_akhir` | periode kontrak per KLIEN |
| `ads.computeAdsManagementEndDate` | contoh terpakai: `start + durasi_bulan BULAN + hari tambahan + hari hold` |
| riwayat hold Ads | diturunkan dari `audit_log` (`computeTotalHariHold`) — **pola yang sama dipakai D-2** |

### Keadaan katalog live (terverifikasi 2026-09-07)

80 layanan aktif — **42 punya durasi** (7×6 bln · 1×3 · 1×12 · 33×1) dan
**38 sekali jadi** (`durasi_bulan IS NULL`). **38** ber-`qty_menambah='durasi'`,
**42** `volume`. Nol `unit` yang masih berisi angka. Nol pelanggaran
`ck_msv_qty_durasi_butuh_durasi_bulan`.

### Perhitungan durasi total sebuah layanan yang dibeli

```
qty_menambah = 'durasi'  ⇒  durasi total = qty × durasi_bulan
qty_menambah = 'volume'  ⇒  durasi total = durasi_bulan (qty tidak mengubahnya)
durasi_bulan  = NULL     ⇒  tidak punya periode — lihat `pengakuan`
```

Contoh nyata: `GMV MAX MEA PRO` = 6 bulan, `qty_menambah='durasi'` ⇒ beli 2
berarti 12 bulan. `Nano KOL` = NULL, `volume` ⇒ beli 10 adalah 10 KOL dalam
satu pekerjaan, bukan kontrak 10 bulan.

---

## 4. D-KOM — apa yang harus dibangun PERTAMA

Kolom **`pengakuan`** di `master_service_versions`, tiga nilai:

| Nilai | Artinya | Contoh |
|---|---|---|
| `per_periode` | diakui rata sepanjang `durasi_bulan` | `GMV MAX MEA PRO`, `Store Management` |
| `saat_selesai` | diakui **penuh** saat status layanan selesai | `Jasa Pengajuan Shopee Mall`, `Nano KOL` |
| `bulan_berikutnya` | diakui **satu bulan sesudah** penjualan yang melahirkannya | `Komisi` |

**Pemetaan awal — diturunkan dari data, bukan ditebak:**

```
durasi_bulan IS NOT NULL          -> 'per_periode'       (42 layanan)
durasi_bulan IS NULL              -> 'saat_selesai'      (38 layanan)
name = 'Komisi'                   -> 'bulan_berikutnya'  (1, mengalahkan aturan di atas)
```

**Kenapa kolom ini wajib ada dan tidak boleh diturunkan dari `durasi_bulan`:**
sesudah pengisian 2026-09-07, `Komisi` dan `Jasa Pengajuan Shopee Mall`
sama-sama `durasi_bulan = NULL` — **dua arti berbeda dengan satu nilai yang
sama**. Tidak ada aturan turunan yang bisa memisahkannya. Ini aturan kerja #4:
*ketiadaan yang diam tidak bisa dibedakan dari kerusakan*.

Kata pemilik tentang `Komisi`: *"service pelengkap tambahan yang tidak bisa
di-track di awal karena bentuknya komisi dari hasil penjualan yang diketahui di
bulan depannya, maka dari itu dibuat bisa diisi sendiri oleh Sales."* ⇒ nilainya
**diinput Sales per transaksi**, bukan dihitung mesin dari katalog.

---

## 5. Urutan membangun yang disarankan

1. **Migrasi `pengakuan`** (§4) + pemetaan awalnya. Aditif ⇒ **boleh mendahului
   kode** (lihat §7).
2. **Mesin accrual di `@cdps/core`** — **tes ditulis DULUAN**, minimal untuk:
   - pro-rate **hangus** D-1 (void di tengah periode ⇒ hanya hari yang sudah jalan);
   - **pergeseran hold** D-2 (skedul mundur sepanjang hold, dihitung ulang);
   - ketiga nilai `pengakuan`, termasuk `bulan_berikutnya` yang menggeser satu bulan;
   - batas periode kalender-aware (mulai tanggal 31 ⇒ pakai `tz.addMonthsToDate`,
     bukan +30 hari).
3. **Kunci tutup buku D-3** sebagai mesin status + jalur jurnal koreksi.
   Bulan tertutup dibaca dari **angka beku**, bukan dihitung ulang.
4. **D-4** sebagai penanda pilihan PPN per transaksi. Mesin **tidak** menghitung
   PPN sendiri.

---

## 6. Verifikasi — perintah + angka acuan TERKINI

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

| Suite | Angka acuan |
|---|---|
| core | **935** |
| db | 53 |
| apps/api | **490** |
| domain | **1988** (+1 skip) |
| web-internal | **650** |
| web-client-portal | 19 |
| migrasi `db-rebuild` | **189** |
| tabel `public` | **146** |

`entity_prefix` 40 · `sm_machines` 31 · `notif_events` 69.

### Jebakan — yang paling mahal lebih dulu

- ⚠️ **`npm run typecheck --workspaces` WAJIB diulang SESUDAH `npm install`,
  dan keluarannya DIBACA.** Tanpa `node_modules`, `tsc` membanjiri keluaran
  dengan *"Cannot find module …"* per berkas tes dan galat sungguhan tenggelam.
  `core-engines`, `api`, DAN `db-and-migrations` ketiganya mengompilasi
  `@cdps/core` ⇒ satu galat tipe di sana tampak seperti tiga masalah berbeda.
- ⚠️ **Jalankan `packages/domain` SENDIRIAN sesudah `db-rebuild`.** Tanpa itu,
  ~788 kegagalan palsu berpangkal `plan.test.ts` yang menyapu `clients`.
  **Rebuild dulu, baru cari bug.**
- **Postgres bisa mati sendiri di container ini** — `pg_isready` dulu sebelum
  menyimpulkan apa pun dari puluhan FAIL. (Terjadi dua kali sesi ini.)
- `audit_log` menolak DELETE; `client_pitch_consents` menolak UPDATE dan DELETE.
- `rm -rf web-internal/.next` kalau muncul *"Another next build process is
  already running"*.
- 1 error lint `react-hooks/static-components` di `admin/employees/page.tsx`
  **PRE-EXISTING**, di luar cakupan.

---

## 7. ⚠️ Aturan urutan rilis — BACA SEBELUM MENYENTUH LIVE

⛔ **JANGAN `supabase db push`** — ledger versi live berbeda *wholesale* dari
nama berkas repo (`O65`, masih terbuka). Pakai `mcp__Supabase__apply_migration`
**per berkas**, lalu **verifikasi lewat kueri katalog** — jangan percaya
`success: true` saja. Proyek live: `egddxfcnrtecheiykhlf` (`CDPS SG`).

> **Migrasi ADITIF boleh mendahului kode.**
> **Migrasi yang me-RENAME atau MENGHAPUS kolom harus MENYUSUL deploy kodenya.**

Kebiasaan lama "apply dulu, merge belakangan" aman selama semua migrasi kebetulan
aditif. Migrasi 186 me-rename kolom yang dibaca kode berjalan; menerapkannya
lebih dulu akan membuat `/master-services` dan Ads Management Date menjawab 500.
Urutan yang dipakai dan terbukti: **merge → tunggu tiga deploy Vercel produksi
READY di commit merge → apply per berkas → verifikasi kueri katalog → isi data.**

Dan: **migrasi yang SUDAH di-apply ke live tidak boleh disunting.** Perbaikan
atasnya = migrasi BARU. Menyunting berkas yang sudah berjalan membuat repo dan
live berhenti menggambarkan hal yang sama — kelas drift yang O38 lahir darinya.

---

## 8. Aturan kerja yang terbukti dan wajib dibawa

1. **Setiap jahitan wajib punya satu tes yang memanggil KEDUA sisi sungguhan.**
   Terbukti berkali-kali: tes unit di kedua sisi bisa hijau sementara jahitannya
   putus, karena masing-masing memakai fixture-nya sendiri.
2. **Cabang tes jangan ditebak — turunkan dari data nyata**, lalu **buktikan tes
   itu bisa merah** dengan mutasi sengaja. Sesi ini memvalidasi tiga gerbang
   dengan cara itu; dua di antaranya ternyata sudah menangkap cacat nyata.
3. **Opsi keputusan yang membawa alasan teknis wajib diperiksa ke kode SEBELUM
   diajukan ke pemilik.**
4. **Ketiadaan yang diam tidak bisa dibedakan dari kerusakan.** Halaman kosong
   wajib mengatakan sebabnya; dua arti berbeda tidak boleh berbagi satu nilai
   kosong. `D-KOM` lahir persis dari sini.
5. **Instruksi pemilik pun diadu dengan data sebelum dieksekusi.** "Semua
   layanan lama jadi 1 bulan" terdengar sederhana dan tetap salah untuk 9
   layanan — Rp 16.666.667 kelebihan akui per layanan per klien. Yang
   menemukannya satu kueri `group by`, bukan review kode.
6. **Gerbang yang memerah karena refactor kadang benar-benar sedang bekerja.**
   Jawabannya menyesuaikan kode ke pola yang gerbang itu jaga, **bukan**
   mengecualikan gerbangnya. Gerbang yang "diperbaiki" dengan pengecualian
   berhenti menjaga apa pun, dan diamnya tidak bisa dibedakan dari hijau.
7. **Audit yang diturunkan dari `UPDATE ... RETURNING`, bukan dari predikat atas
   nilai baru.** Migrasi 188 memakai `WHERE unit = 'paket'` yang dievaluasi
   SESUDAH `UPDATE`, sehingga mencatat 44 layanan untuk 16 yang berubah —
   permanen, karena `audit_log` menolak DELETE. Migrasi 189 memakai pola yang
   benar; tirulah yang itu.

---

## 9. Yang masih BELUM dibuktikan — disebut jujur

- **Piksel React.** Field **Durasi Jasa (bulan)** dan dropdown **Kalau Klien
  Beli Lebih dari Satu** di `/master-services` lolos `tsc`, `vitest`,
  `next build`, dan rutenya diuji — tapi **belum ada yang membukanya di
  peramban**. Yang terbukti kontraknya, bukan tata letaknya.
- **`/showcase` di peramban** — utang lama Gelombang C, masih belum dibayar.
- **Baris audit `koreksi_unit_sisa_angka` mencatat 44 layanan padahal hanya 16
  yang berubah** (cacat migrasi 188, permanen). Data katalognya BENAR; yang
  keliru hanya narasi auditnya. Cara membaca angkanya + pelajarannya ada di
  `DECISIONS.md` 2026-09-07.
- **Perilaku mesin accrual dengan hold yang bersarang / berulang** — belum ada
  kodenya sama sekali, disebut supaya tidak diasumsikan sudah dipikirkan.
