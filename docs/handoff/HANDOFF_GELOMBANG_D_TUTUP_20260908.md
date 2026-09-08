# Handoff — **Gelombang D TUTUP. 5 dari 5 diketok, dibangun, dan di live.**

> **Titik mulai chat berikutnya.** Gelombang D tidak menyisakan pekerjaan yang
> memblokir apa pun. Yang tersisa disebut di §4 sebagai utang bernama, bukan
> sebagai "belum selesai" — bedanya penting: tidak ada yang perlu diselesaikan
> sebelum Gelombang berikutnya boleh mulai.
>
> **Baca berurutan kalau butuh konteks penuh:**
> 1. `HANDOFF_GELOMBANG_D_ACCRUAL_20260908.md` — apa yang dibangun & **kenapa**
> 2. `HANDOFF_GELOMBANG_D_D3_20260908.md` — D-3 dan urutan rilisnya yang mengikat
> 3. `docs/DECISIONS.md` — baris `Decided` 2026-09-07 & 2026-09-08

---

## 1. Posisi — semua hijau

| Item | Ketokan | Kode | Live |
|---|---|---|---|
| **D-KOM** — penanda `pengakuan` di katalog | ✅ 2026-09-07 | ✅ | ✅ |
| **D-1** — void di tengah periode **HANGUS** | ✅ 2026-09-07 | ✅ | ✅ |
| **D-2** — `[On Hold]` **MENJEDA** pengakuan | ✅ 2026-09-07 | ✅ | ✅ |
| **D-3** — kunci tutup buku per bulan | ✅ 2026-09-07/08 | ✅ | ✅ |
| **D-4** — bruto + penanda PPN per transaksi | ✅ 2026-09-07/08 | ✅ | ✅ |

**Nol pertanyaan terbuka di jalur D.** Ketokan terakhir (siapa boleh menulis
jurnal koreksi) diambil pemilik 2026-09-08: peran yang **sama** dengan yang
menutup.

### Keadaan live, diverifikasi lewat kueri (bukan `success: true`)

```
212 migrasi · 149 tabel · 33 mesin · 41 prefix · 73 notif_events
sm_transition: TEPAT SATU overload, 11 argumen, SECURITY DEFINER,
               proacl = {postgres, service_role}   ← anon/authenticated TIDAK bisa
book_periods: 0 baris · book_period_snapshots: 0 baris   ← belum ada bulan ditutup
```

Angka gate-nya **cocok persis** dengan `scripts/db-rebuild.sh` dari `main`, jadi
`main` merekonstruksi live. Selisih M18 yang sempat ada sudah ditutup jalur M18
sendiri.

### Angka acuan suite (dari jalan ulang, bukan ingatan)

```
core 985 · db 64 · domain 2188 (+1 skip) · api 494 · web-internal 695 · portal 19
db-rebuild: 209 migrasi, semua gate & invariant lolos
```

---

## 2. Apa yang D-3 benar-benar tegakkan

| Aksi | Siapa | Ditegakkan di mana |
|---|---|---|
| **Menutup** bulan | Finance lead **ATAU** Director | `sm_edges.require_lead` + `require_division='Finance'` |
| **Membuka kembali** | **Director SAJA** | `sm_edges.require_director` |
| **Jurnal koreksi** | sama dengan yang menutup | domain + `periode_tertutup()` |

Finance lead yang menutup **tidak bisa** membatalkan tutupannya sendiri.
Asimetri itulah yang membuat kunci ini menjaga sesuatu.

**Pagar bulan tertutup menolak TIGA arah**, bukan satu: mendarat di bulan
tertutup, **berangkat** dari bulan tertutup, dan dihapus dari bulan tertutup.
Arah kedua yang paling mudah terlupa dan paling mahal — memindahkan penerimaan
dari Agustus (tertutup) ke September mengubah angka Agustus tanpa pernah menulis
satu baris pun bertanggal Agustus.

---

## 3. Lima jebakan yang MAHAL di jalur ini — semuanya sudah kena sekali

Ditulis supaya tidak kena dua kali. Empat dari lima sudah tertulis di suatu
tempat sebelum sesi ini dan **tetap** kena.

1. **`CREATE OR REPLACE FUNCTION` mengembalikan atribut opsional yang tidak
   disebut ulang ke nilai bakunya.** `sm_transition` diam-diam kehilangan
   `SECURITY DEFINER` sejak `20260908020000` karena itu. Ditemukan dengan
   membandingkan `prosecdef` terhadap dua saudaranya, bukan dengan membaca kode.
   `rls_checks` **tidak** menangkapnya — ia memeriksa tabel, bukan ACL fungsi.

2. **`DROP FUNCTION` membuang ACL fungsi bersama fungsinya.** Fungsi penggantinya
   lahir `EXECUTE` untuk `PUBLIC`. Kalau Anda men-drop fungsi ber-ACL, `REVOKE`
   + `GRANT` ulang **di migrasi yang sama**.

3. **Tanda tangan baru = fungsi BARU.** Menambah parameter lalu membuang versi
   lama di migrasi yang sama menciptakan jendela di mana **setiap transisi status
   di seluruh sistem** gagal. Aturan rilis rumah: **aditif boleh mendahului kode,
   DROP wajib mengikutinya.** Itu sebabnya D-3 punya lima migrasi, bukan empat.

4. **PL/pgSQL me-resolve nama fungsi saat EKSEKUSI.** `wrr_monday_job` dan
   `leads_unrespon_tick` memanggil `sm_transition` dari dalam badannya, jadi
   keduanya patah saat tanda tangannya berubah — dan patahnya baru terlihat
   **saat job-nya jalan**, bukan saat migrasi di-apply. Sebelum mengubah tanda
   tangan fungsi apa pun, pindai `pg_proc.prosrc` untuk pemanggil SQL-nya.

5. **CHECK constraint tidak melihat `OLD`, jadi ia tidak bisa membedakan ARAH
   perpindahan status.** Versi pertama D-3 memakai dua CHECK yang saling
   mengunci sehingga penutupan **pertama** mustahil dari dua arah. Ditemukan
   dengan **menjalankannya**, bukan membacanya. Pelajaran ini sudah tertulis di
   `ck_crp_cabut_lengkap` (`20260908010000`) dan tetap terulang. Kalau syaratnya
   menengok ke tabel lain atau ke arah transisi → **trigger**, bukan CHECK.

**Jebakan lingkungan, bukan kode:** Postgres lokal mati beberapa kali di sesi
ini. `47 failed` di `packages/db` yang semuanya berbunyi
`ECONNREFUSED 127.0.0.1:5432` adalah itu — `service postgresql start`, jalankan
ulang, hijau lagi. Jangan diagnosa sebagai regresi. Dan menjalankan suite domain
dua kali **tanpa rebuild** menghasilkan kegagalan palsu dari akumulasi baris.

---

## 4. Utang yang tersisa — disebut, bukan diklaim beres

Tidak satu pun memblokir Gelombang berikutnya.

### 4.1 🟠 `services.standard_price` belum dijaga pagar bulan tertutup

Mengubah harga sebuah layanan mengubah pendapatan accrual bulan-bulan yang
mungkin **sudah ditutup**. `jaga_periode_tertutup` menjaga
`payment_verifications.received_date` dan `installments.verified_date` — fakta
uang yang membawa tanggalnya sendiri — tapi harga tidak membawa tanggal.

**Kenapa tidak sekalian dikerjakan:** pagarnya butuh menjalankan mesin accrual
**di dalam trigger** untuk tahu bulan mana saja yang terpengaruh — mahal, dan
melingkar. **Bentuk yang benar:** larang `UPDATE` harga pada layanan yang sudah
pernah masuk `book_period_snapshots` mana pun. Itu satu trigger dan satu
`EXISTS`, tapi ia butuh ketokan: apa yang harus terjadi kalau harganya memang
salah ketik dan bulannya sudah ditutup? (Dugaan yang belum diketok: buka bulan →
perbaiki → tutup ulang, karena jalur itu sudah ada dan berversi.)

Tercatat di `DECISIONS.md` baris 2026-09-08.

### 4.2 Tiga hal yang belum pernah dibuktikan di dunia nyata

| Apa | Kenapa belum | Biaya membuktikannya |
|---|---|---|
| Halaman `/finance/tutup-buku` belum pernah **dibuka di peramban** | Lolos `tsc`, `vitest`, `next build`, `lint`, shape-parity DAN body-parity — yang terbukti **kontraknya, bukan tata letaknya** | Buka halamannya sebagai Finance lead. Lima menit |
| **Gerbang dua tingkat belum pernah diuji di live** | Gerbangnya diperiksa **sesudah** lookup edge, yang butuh baris `book_periods` nyata. Menanam baris uji di tabel keuangan produksi bukan harga yang pantas dibayar | Ikut terbukti sendiri saat bulan pertama benar-benar ditutup |
| **Angka D-3 belum pernah dihitung atas data live** | `book_periods` masih 0 baris. Semua tes memakai fikstur | Tutup satu bulan yang sudah lewat, lalu adu angkanya dengan pembukuan manual |

Ketiganya menyatu jadi **satu tindakan**: minta Finance menutup satu bulan yang
sudah lewat (mis. Agustus 2026) di halaman itu. Itu sekaligus membuka halamannya,
melewati gerbangnya, dan menghasilkan snapshot pertama. **Itu rekomendasi
langkah berikutnya yang paling murah dan paling banyak membuktikan.**

### 4.3 Satu layanan sengaja tidak punya qty, dan itu benar

`SVC-202609-0003` — layanan nego (Rp 6.000.000 atas katalog Rp 7.500.000, rasio
**0,8**) — satu-satunya layanan `qty_menambah='durasi'` yang `qty`-nya `NULL`
dari 14 yang ada.

Kolomnya sengaja **NULLABLE tanpa `DEFAULT 1`**. Mesin accrual **menolak
menghitung** layanan `durasi` ber-`qty` NULL alih-alih menebak 1, dan
melaporkannya sebagai `tidak_terhitung` dengan sebabnya. Kalau di kemudian hari
ada yang tergoda menurunkan qty dari harga: **datanya sudah menolak rumus itu** —
dua layanan ber-katalog Rp 0 memberi pembagian nol, dan pembelian 3 unit
berdiskon sepertiga memberi rasio **tepat 2,0**, bilangan bulat yang lolos setiap
penyaringan dan salah.

Yang benar: isi `qty`-nya dari kontrak/Form Qualified aslinya, sekali, lalu
layanan itu ikut terhitung.

### 4.4 O65 — ledger live berkunci stempel APPLY

Nama berkas repo (`20260925010000`) **tidak** sama dengan versi di ledger live
(`20260908083750`). Itu berlaku untuk **kelima** migrasi D-3 dan sudah lama jadi
keadaan repo ini secara umum.

Konsekuensi praktisnya cuma satu dan sudah tertulis di `CLAUDE.md`:
⛔ **JANGAN `supabase db push`** — pakai `apply_migration` per berkas.

Temuan `A2-DRIFT` dari jalur A2 lahir dari sini dan **sudah ditutup 2026-09-08**
dengan bukti: `md5(prosrc)` ketujuh fungsi D-3 cocok byte-per-byte antara live
dan DB lokal hasil `db-rebuild` dari `main`. Bukan drift skema — `main` tetap
merekonstruksi live.

---

## 5. Cara memverifikasi klaim handoff ini sendiri

Jangan percaya tabel di §1. Jalankan:

```bash
pg_isready || service postgresql start
export DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps"
bash scripts/db-rebuild.sh --yes          # gate: 149 · 41 · 33 · 73
npx vitest run --root packages/core        # 985
npx vitest run --root packages/db          # 64
npx vitest run --root packages/domain      # 2188 +1 skip
npx vitest run --root apps/api             # 494
npx vitest run --root web-internal         # 695
npx vitest run --root web-client-portal    # 19
```

Untuk live, kueri ini menjawab "apakah D-3 benar-benar terpasang":

```sql
select
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname='sm_transition') as overload,  -- harus 1
  (select p.pronargs from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname='sm_transition') as argumen,   -- harus 11
  (select count(*) from sm_edges where machine='book_period') as edge_bp,  -- harus 2
  (select count(*) from pg_trigger where tgname in
     ('trg_payver_periode_tertutup','trg_inst_periode_tertutup')) as pagar; -- harus 2
```

⛔ **Jangan percaya `success: true`** dari `apply_migration`. Verifikasi lewat
kueri, selalu.

---

## 6. Kalau chat berikutnya menyentuh migrasi

Urutan yang terbukti di sesi ini dan layak diulang:

> **uji-kering ke live dulu → periksa INVARIANNYA, bukan jumlah barisnya →
> `apply_migration` per berkas → verifikasi lewat KUERI → baru simpulkan.**

Dan satu langkah yang tidak ada di runbook mana pun sebelum sesi ini, tapi
terbukti menangkap kesalahan nyata:

> **Sesudah apply, adu `md5(prosrc)` fungsi di live dengan DB lokal hasil
> `db-rebuild` dari `main`.** Kalau berbeda, salah satu dari dua hal terjadi:
> transkripsi Anda ke `apply_migration` tidak persis sama dengan berkas repo,
> atau ada yang mengubah live di luar repo. Keduanya perlu diketahui, dan
> keduanya tidak akan pernah muncul dari membaca `success: true`.

---

_Gelombang D tutup. Tidak ada yang menunggu di sini._
