# Handoff — **Gelombang C dibuka**: delapan gerbang diketok, Showcase jadi dibangun

> **Baca ini dulu, lalu dua berkas ini, urut:**
> 1. `docs/DECISIONS.md` — **dua** baris 2026-09-07: *"TUJUH DARI DELAPAN GERBANG
>    C/D DIKETOK"* (isi ketokannya + konsekuensi yang WAJIB ikut dibangun) dan
>    *"D-3 DIKETOK"* (kunci tutup buku). Lalu §Open baris `C-4` dan `C-5` — dua
>    itu saja yang masih terbuka.
> 2. `docs/handoff/UAT_GELOMBANG_B_20260907.md` — posisi Gelombang B, dan §5-nya
>    (apa yang UAT itu **tidak** buktikan).
>
> `KEPUTUSAN_PEMILIK_GELOMBANG_C_D_20260907.md` adalah brief yang dipakai untuk
> mengetok; isinya masih berlaku sebagai konteks, tapi **hasil ketokannya ada di
> `DECISIONS.md`**, bukan di brief itu.

---

## 1. Posisi sebenarnya

| | Status |
|---|---|
| **Gelombang A · B1 · B2 · B3 · B4 · B5** | ✅ di `main` (PR #300 · #301 · #302 · #303) |
| **Uji terima §10 butir 1–7** | ✅ **lunas 2026-09-07** — dijalankan lewat rute; 1 jahitan bocor ditemukan & ditutup |
| **Gerbang keputusan C/D** | ✅ **8 dari 8 diketok 2026-09-07** |
| **Gelombang C — Showcase Klien Terbaik** | ▶️ **BOLEH DIBANGUN SEKARANG** — ini pekerjaan sesi berikutnya |
| **Gelombang D — laporan keuangan accrual** | ⏸️ aturan uangnya **lengkap**; sisa penghalangnya tinggal **DATA** — `durasi_jasa` MSL terisi 0/14 |

**Nol migrasi baru** sejauh ini ⇒ repo dan live (`egddxfcnrtecheiykhlf`) tetap di
**183** dan tidak drift.

---

## 2. Keputusan pemilik yang mengikat Gelombang C (2026-09-07, Nerissa/COO)

| Gerbang | Ketokan |
|---|---|
| **C-3** | **(b)** — angka klien boleh dipakai di materi pitch **hanya untuk klien yang izinnya sudah ada** (izin terpisah per klien, bukan bersandar pada anonimisasi) |
| **C-1** | **(a)** — **Sales DIBUKA aksesnya ke halaman Showcase** |
| **C-2** | **(a)** — **bangun sekarang**, alasan pemilik: *"supaya ketika ada report bisa otomatis terisi"* |

### 2.1 ⚠️ C-1 adalah pengecualian PERTAMA terhadap Role Matrix — empat pagarnya WAJIB ikut dibangun

Membuka Showcase ke Sales melanggar pola dasar permission CDPS (Fase 0 §4:
*Staff = data sendiri*). Pemilik memutuskan begitu, dan itu sah — tapi
pengecualian pertama adalah yang paling mahal karena ia jadi preseden. Empat
pagar berikut **bagian dari fiturnya**, bukan pekerjaan menyusul:

1. **Read-only, dan HANYA halaman Showcase.** Bukan laporan klien penuh, bukan
   Health Score, bukan halaman klien. Satu halaman, satu izin.
2. **Daftar Showcase hanya memuat klien ber-izin (C-3).** Ini membuat C-3
   **menggerbangi C-1 secara teknis** — bukan sekadar mendampinginya. Sebelum
   pagar ini ada, Showcase tidak boleh dibuka ke Sales sama sekali.
3. **Setiap akses Sales ke Showcase masuk audit log**, sehingga "siapa melihat
   angka klien mana" bisa dijawab.
4. **Tes permission per peran menyebut Sales eksplisit** (aturan rumah #6),
   supaya pelebaran diam-diam ke halaman lain memerahkan CI, bukan ditemukan
   manusia.

### 2.2 C-2: halaman akan KOSONG dulu — dan itu harus DIKATAKAN, bukan didiamkan

Angka live per 2026-09-07 (**diverifikasi lewat kueri katalog, bukan dikutip**):

| Yang diukur | Live |
|---|---|
| Klien | 10 |
| **Laporan klien** (`client_reports`) | **1** |
| Skor laporan itu | **4,5 — KRITIS** |
| Layanan / kontrak / strategi / periode Plan | 14 / 3 / 3 / 2 |
| `durasi_jasa` MSL terisi | **0 dari 14** layanan (2 dari 96 versi) |

> ⚠️ **Koreksi yang wajib dibawa:** `HANDOFF_GELOMBANG_B_20260906.md` §7 menyebut
> Showcase akan kosong karena *payload laporan pra-R3 beku dan tak bisa
> di-backfill*. **Itu salah sebab.** Payload laporan live justru **lengkap** — 21
> kunci termasuk `insight` (6 kunci), `produk`, `video`, `live`, `afiliasi`,
> `kpi`, schema `cdps.report.tiktok.v1`. Sebab sebenarnya: **laporannya baru 1 dan
> skornya KRITIS**. Jangan bangun mekanisme backfill apa pun — tidak ada yang
> perlu di-backfill.

Konsekuensinya untuk halaman: ia **wajib mengatakan alasan kosongnya** —
"belum ada klien yang memenuhi ambang", plus berapa laporan yang ada dan
ambangnya berapa. Tabel kosong tanpa penjelasan adalah kelas kekeliruan yang
sama dengan `0` vs `null` yang seluruh Gelombang B dibangun untuk mencegah.

---

## 3. Yang masih menunggu ketokan — JANGAN ditebak

| # | Pertanyaan | Memblokir |
|---|---|---|
| **C-5** | Di mana status izin klien (C-3) disimpan, dan siapa yang mencentangnya? Kolom di `clients` atau tabel izin tersendiri (kalau izinnya punya masa berlaku / dokumen lampiran)? Peran mana yang berhak mencentang — AM pemilik klien, atau Director saja? | **Ya** — daftar Showcase yang aman ditampilkan ke Sales |
| **C-4** | Ambang "klien terbaik": skor minimum berapa, dan perlu minimal N periode laporan supaya kenaikannya terbukti bukan kebetulan? | Tidak — bangun jalan terus; **ambang jadi konstanta bernama di `@cdps/core` dengan nilai sementara yang halaman SEBUTKAN di layar**, bukan angka diam-diam |

**D-3 sudah diketok** (✅ ya, ada kunci tutup buku) — awalnya sengaja tidak dicatat
karena jawabannya menggantung di antara dua pertanyaan lain, lalu dikonfirmasi.
Jadi yang tersisa hanya dua di atas, dan **keduanya tentang Gelombang C**.

---

## 4. Keputusan D yang SUDAH diketok — aturan uangnya LENGKAP (simpan untuk Gelombang D)

| Gerbang | Ketokan | Yang harus dibangun sesuai itu |
|---|---|---|
| **D-4** | **Bruto dulu untuk harga; Sales/Finance yang memilih kena PPN atau tidak** | Nilai disimpan **bruto**; perlakuan PPN jadi **pilihan eksplisit per transaksi**. Mesin accrual **TIDAK** menghitung PPN sendiri — ia menyimpan nilai bruto + penanda pilihan, manusia yang memilih |
| **D-2** | **Ya, `[On Hold]` menjeda pengakuan pendapatan** | Butuh riwayat hold (tanggal mulai/selesai) yang dibaca mesin laporan; skedul bergeser dan dihitung ulang. Risiko operasional: hold harus diinput saat kejadian, bukan diingat belakangan |
| **D-3** | **Ya, ada kunci tutup buku per bulan** | Satu peran yang berwenang **menutup** buku bulanan · sesudah tertutup angka bulan itu **tidak bisa diedit** — koreksi hanya lewat **jurnal koreksi di bulan berjalan** yang ikut masuk audit log · mesin laporan membaca bulan tertutup dari **angka yang dibekukan**, bukan menghitung ulang dari data mentah |
| **D-1** | **(a) HANGUS** | Layanan yang di-void di tengah periode diakui hanya untuk hari yang sudah jalan; sisanya tidak pernah diakui |
| **E9-RETENSI** | **(a)** — pilar `retensi` tetap ikut pola `sku`/`harga`, AM yang memilih | **Nol perubahan kode.** `planpillar.PILAR_PILIH_DIVISI` sudah benar apa adanya |

---

## 5. Rencana Gelombang C — urutan yang gw sarankan

Rancangan aslinya di `HANDOFF_GELOMBANG_B_20260906.md` §7 (bagian C). Yang di
bawah adalah urutan kerjanya sesudah ketokan hari ini.

1. **C-5 dulu, kalau sudah diketok** — tanpa tempat menyimpan status izin, daftar
   Showcase tidak boleh dilihat Sales sama sekali (pagar #2 di §2.1). Kalau C-5
   belum diketok saat sesi berikutnya mulai: **bangun Showcase-nya lebih dulu
   TANPA akses Sales**, dan tambahkan akses Sales sebagai langkah terakhir begitu
   izinnya punya rumah. Jangan tunggu — halamannya sendiri tidak diblokir.
2. **Read model + ambang** di `@cdps/core` (ambang = konstanta bernama, C-4).
3. **Halaman Showcase** di `web-internal`, dengan kalimat jujur saat kosong
   (§2.2).
4. **Akses Sales + empat pagar** (§2.1) — termasuk tes permission yang menyebut
   Sales eksplisit.
5. **Export materi pitch** (dokumen anonim) — tetap berguna walau Sales punya
   akses halaman: yang dikirim ke calon klien adalah dokumen, bukan link internal.

**Aturan yang dibawa dari Gelombang B dan terbukti dua kali** (B2↔B3, lalu
`angle_video` di UAT kemarin):

> Setiap jahitan wajib punya **satu tes yang memanggil KEDUA sisi sungguhan**.
> Fixture sintetis di masing-masing sisi tidak cukup — itulah cara dua fitur
> "selesai" tetap tidak berfungsi tanpa ada satu tes pun yang merah.

Untuk Gelombang C, jahitan yang paling mungkin bocor: **`client_reports.payload`
sungguhan → read model Showcase**, dan **status izin (C-5) → daftar yang Sales
lihat**. Dua-duanya butuh tes lintas-sisi, bukan fixture.

---

## 6. Verifikasi — perintah + angka acuan

```
service postgresql start
su postgres -c "psql -c \"ALTER USER postgres PASSWORD 'postgres';\""   # sekali per container
export DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps"
bash scripts/db-rebuild.sh --yes
npm install && npm test --workspaces && npm run typecheck --workspaces --if-present
cd web-internal && npm install && npx vitest run && npx tsc --noEmit && npm run build
cd ../web-client-portal && npx vitest run
```

| Suite | Angka acuan |
|---|---|
| core | **906** |
| db | 53 |
| apps/api | **478** |
| domain | 1930 (+1 skip) |
| web-internal | **624** |
| web-client-portal | 19 |
| migrasi db-rebuild | **183** |

### Jebakan yang sudah menggigit DUA sesi berturut-turut

- **Jalankan `packages/domain` SENDIRIAN sesudah `db-rebuild`.** Menjalankannya
  tanpa rebuild setelah suite lain ⇒ **788 kegagalan palsu**, semuanya berpangkal
  pada `plan.test.ts` yang menghapus `clients where created_by like 'ZZ-%'`
  sementara berkas tes lain masih memakai barisnya. **Rebuild dulu, baru cari
  bug** — jangan terbalik.
- **Postgres bisa mati sendiri di container ini.** Cek `pg_isready` sebelum
  menyimpulkan apa pun dari puluhan FAIL.
- **`next build` bisa meninggalkan lock.** Kalau muncul *"Another next build
  process is already running"*, `rm -rf web-internal/.next` lalu ulangi.
- `riset_awal_analisa` **immutable by trigger**: fixture varian payload harus
  di-`INSERT` dengan bentuknya, tidak bisa di-`UPDATE` sesudahnya.
- 1 error lint `react-hooks/static-components` di `admin/employees/page.tsx`
  **PRE-EXISTING**, di luar cakupan.

### Live DB

⛔ Tetap **JANGAN `supabase db push`** — ledger versi live berbeda *wholesale*
dari nama berkas repo (O65). Pakai `mcp__Supabase__apply_migration` per berkas.
Gelombang C **tidak** direncanakan menambah migrasi; Gelombang D menambah satu
(⇒ 184).

---

## 7. Dua pekerjaan operasional yang memblokir NILAI, bukan kode

Tidak butuh keputusan siapa pun, dan tidak ada kode yang bisa menggantikannya:

1. **Isi `durasi_jasa` di MSL** — 0 dari 14 layanan. Tanpa ini Gelombang D
   menghasilkan skedul pendapatan kosong untuk **semua** layanan, apa pun jawaban
   D-1…D-4.
2. **Naikkan jumlah laporan klien** — 1 dari 10 klien. Ini yang menentukan
   Showcase (C) punya isi atau tidak. Halaman boleh dibangun duluan (C-2 diketok
   begitu), tapi ia baru berguna saat laporan masuk.
