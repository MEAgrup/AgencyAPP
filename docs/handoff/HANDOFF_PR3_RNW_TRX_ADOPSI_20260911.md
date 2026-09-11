# Handoff — utang uang terakhir LUNAS + ketokan Adopsi; sisa murni UAT & konfigurasi (2026-09-11)

> **Baca ini lebih dulu.** Ia menggantikan §4 dari `HANDOFF_PR5_20260911.md`
> (sesi sebelumnya), yang tetap berguna untuk §1–§3 isi PR-5 dan §5 lingkungan.
> Langkah UAT per aktor tetap di `HANDOFF_PR3_PR4_20260911.md` §6a/§6b.

## 0. Posisi

| Butir §4 handoff sebelumnya | Status sesudah sesi ini |
|---|---|
| 1. UAT peramban PR-3 / PR-4 | ⬜ **masih belum dijalankan** — butuh manusia di peramban |
| 2. `role_mappings` → `Finance` | ⬜ konfigurasi Director lewat `/admin/role-mappings` |
| 3. `role_mappings` → `HR` | ⬜ sama |
| 4. Ketokan `PR4-SIAPA-BOLEH-LIHAT` | ✅ **DIKETOK & DIBANGUN sesi ini** — lead divisi boleh, divisinya sendiri |
| 5. `PR3-RNW-TRX` (utang uang) | ✅ **LUNAS sesi ini**, dan cakupannya jauh lebih besar dari dugaan baris Open-nya |

**Tidak ada lagi utang kode yang terbuka.** Yang tersisa adalah UAT manual dan
dua baris `role_mappings` — keduanya pekerjaan manusia, bukan sesi coding.

---

## 1. 🔴 Yang paling penting: laporan penjualan KURANG melaporkan 71% penjualan

Baris Open `PR3-RNW-TRX` menduga masalahnya kecil dan belum menggigit
("nol klien live punya >1 kontrak hari ini"). **Dua-duanya salah**, dan
keduanya diperiksa ke `CDPS SG` sebelum sebaris kode ditulis:

```
omzet terlapor         Rp 151.075.000   (9 dari 25 klien)
penjualan sebenarnya   Rp 516.307.615   (26 transaksi)
selisih                Rp 365.232.615   — 71%, tanpa satu galat pun
```

Selisihnya dua sebab yang berbeda:

1. **Rp 359.232.615 — klien tanpa baris Kontrak.** `loadDealFacts` memagari
   himpunan uangnya dengan `exists (contracts)`. Closing yang SEMUA barisnya
   one-off tidak melahirkan kontrak sama sekali (`resolveClosingWindow`
   mengembalikan `null`, dan itu SAH) — jadi uangnya hilang seluruhnya.
   **16 dari 25 klien live.** Lubang ini **tidak pernah tercatat di mana pun**;
   pagarnya diwarisi dari join `clients ⋈ contracts` yang lama, bukan dipilih.
2. **Rp 6.000.000 — perpanjangan.** Dan ini pun berlawanan dengan catatan
   handoff sebelumnya: **perpanjangan pertama SUDAH dieksekusi di produksi
   2026-08-31** (`RNW-202608-0001` → `CTR-202608-0003` + `TRX-202608-0011`).
   Angka yang salah itu sudah ada di layar, bukan ancaman masa depan.

### 1a. Bentuk perbaikannya: **satu deal = satu TRANSAKSI**

Unitnya berpindah dari klien/kontrak ke transaksi.

| | sebelum | sesudah |
|---|---|---|
| himpunan uang | `clients.transaction_id`, dipagari `exists (contracts)` | setiap baris `transactions` milik klien yang punya alokasi |
| bucket | `transactions.created_at` | sama |
| bauran deal (`baru`/`perpanjangan`/`cross_sell`) | `contracts`, bucket `contracts.created_at` | `coalesce(renewal_requests.jenis, contracts.jenis, 'baru')`, bucket sama dengan uangnya |
| `bayar_komisi` | tak terhitung karena kebetulan tak punya kontrak | dikecualikan EKSPLISIT lewat `renewal_requests.jenis` |

Bauran deal dan uang sekarang keluar dari **satu daftar** (`facts.deals`), jadi
keduanya tidak bisa lagi menyebut periode atau himpunan yang berbeda.

### 🔴 1b. Jebakan yang TIDAK disebut baris Open-nya — dan yang akan diam-diam membuka lubang baru

Rencana di baris Open berbunyi: *"tautan `contracts.transaction_id`, lalu
`loadDealFacts.money` di-bucket per kontrak."* **Kalau itu dikerjakan apa
adanya, lubang omzet tertutup dan lubang KOMISI terbuka.**

`finance.commissionAchievement` menghitung komisi satu transaksi sebagai Σ
komisi **seluruh Service kliennya**. Selama satu klien = satu transaksi itu
benar. Begitu klien punya dua transaksi (closing + perpanjangan), KEDUANYA
melaporkan komisi yang sama — dan siapa pun yang menjumlahkannya mendapat
komisi dua kali lipat. Itu persis kelas bug yang ditutup untuk omzet sehari
sebelumnya, satu kolom di sebelahnya.

Penutupnya `finance.dealServices`: pemetaan Service → **tepat satu** transaksi.

```
Service punya kontrak yang punya transaksi  → transaksi kontrak itu
selain itu                                  → clients.transaction_id
                                              (coalesce ke transaksi TERAWAL klien)
```

`coalesce` itu bukan kerapian — ia yang membuat pemetaannya **total**, sehingga
Σ komisi seluruh transaksi seorang klien tetap PERSIS sama dengan Σ komisi
seluruh Service-nya. Untuk setiap klien satu-transaksi (yakni setiap kasus yang
selama ini benar) angkanya **tidak bergerak satu rupiah pun**.

### 🔴 1c. Jebakan kedua, ditabrak sungguhan: `ON DELETE SET NULL` pada FK KOMPOSIT

Tanpa daftar kolom, `ON DELETE SET NULL` menge-null-kan **SELURUH** kolom FK —
termasuk `client_id`, yang NOT NULL. Gejalanya bukan galat yang jujur di tempat
kejadian melainkan `null value in column "client_id"` yang muncul jauh dari
sebabnya dan **merobohkan 34 berkas tes sekaligus**. Yang benar:
`ON DELETE SET NULL (transaction_id)` (PG 15+). Sudah dicatat di migrasinya.

### 1d. Dibuktikan menggigit dengan mutasi, bukan diasumsikan

| mutasi | tes yang memerah |
|---|---|
| cakupan komisi dikembalikan ke per-klien | `expected '3200000.00' to be '1600000.00'` |
| pagar `exists (contracts)` dikembalikan | `expected '0.00' to be '10000000.00'` |
| penyaring divisi Adopsi dilumpuhkan | `expected true to be false` (baris divisi lain bocor) |

---

## 2. Ketokan `PR4-SIAPA-BOLEH-LIHAT` — lead divisi, divisinya sendiri

`adopsiScopeFor` menggantikan gerbang biner:

```
OD / Director   → { division: null }   seluruh agensi
lead divisi     → { division: 'X' }    barisnya divisi X saja
staff / tak ter-map → null             ditolak
```

Penyaringannya **hanya di server** (`adopsiReport`). Cermin FE (`nav.ts`,
`lib/adopsi.ts`) memutuskan apakah pintunya terlihat dan **tidak pernah**
menyaring baris — dua penyaring berarti dua yang bisa berselisih, dan yang
kalah adalah yang tidak diuji.

Yang TIDAK ikut melebar, dan itu yang menjaga kalimat pemilik ("indikator
adaptasi tim, BUKAN komponen reward") tetap benar: nol peringkat, nol skor, nol
ambang, nol sambungan ke `performance` (M14).

Orang yang tidak ada di roster atau belum ter-map divisi **tidak** ditampilkan
ke lead mana pun — "tidak diketahui" bukan alasan untuk menebak.

---

## 3. Verifikasi sesi ini

```
db-rebuild.sh --yes    224 migrasi bersih (223 → 224, +1 PR3-RNW-TRX)
gate                   156 tabel · 43 prefix · 34 mesin · 73 event (NOL gerak — cuma kolom)
invariant SQL          ident ✓  immutability ✓  rls ✓  auth_claims ✓
packages/core          985 lolos
packages/db            98 lolos
packages/domain        2443 lolos + 1 skip (baseline 2439 → +4 tes baru)
apps/api               509 lolos
web-internal           757 lolos
typecheck              bersih, 5 target (core/db/domain/api/web-internal)
lint web-internal      3 error + 61 warning — IDENTIK baseline, nol baru
```

**Baseline dikontrol, bukan diasumsikan.** Perubahan sempat memerahkan 34
berkas tes dengan jumlah kegagalan yang BERBEDA setiap run (466 → 158 → 862 →
1335). Yang menyesatkan: angka yang berayun itu terbaca seperti flake, padahal
sebabnya satu — teardown yang gagal di tengah (§1c) meninggalkan baris fixture,
dan berkas BERIKUTNYA memerah karena data yang bukan miliknya. Yang
menyelesaikannya adalah kontrol, bukan menebak: `git stash -u` + rebuild + run
ulang pada pohon bersih (2439 lolos), baru `stash pop`. Lakukan itu LEBIH DULU
kalau suite ini memerah secara luas.

---

## 4. Keputusan bentuk yang jangan dibongkar tanpa alasan baru

1. **`bayar_komisi` dikecualikan lewat `renewal_requests.jenis`, BUKAN lewat
   ada-tidaknya kontrak.** Seluruh bug di §1 lahir dari "tidak punya kontrak"
   yang dipakai sebagai proksi untuk hal lain. Jangan ulangi polanya.
2. **`services` tetap tanpa `transaction_id`.** Pemetaannya diturunkan
   (`dealServices`), tidak disimpan — aturan rumah #4: field turunan
   dihitung ulang, tidak diketik.
3. **`renewal_proposal_lines` masih nol perubahan** (warisan PR-5 §3.4).
4. **Cakupan Adopsi tidak dicerminkan di FE.** Lihat §2.
5. **`mulaiTercatat` TIDAK ikut disaring cakupan** — ia menyatakan sejak kapan
   pencatatan ADA, bukan data per-orang.

---

## 5. Yang masih menggantung — semuanya pekerjaan manusia

1. **🔴 Migrasi `20261005010000` BELUM diterapkan ke live.** Sengaja: ia jalur
   uang, dan menerapkannya sebelum PR-nya ditinjau menciptakan drift
   repo↔live (kelas O38). Sesudah ditinjau, terapkan lewat
   `supabase db push` / `apply_migration` — **jangan** `psql -f` — lalu
   buktikan dengan kueri, bukan dengan `success: true`. Backfill-nya akan
   menyentuh 9 kontrak live: `CTR-202608-0003` → `TRX-202608-0011` (tahap A,
   dari `renewal_requests`), delapan sisanya → `clients.transaction_id`
   (tahap B).
2. **🔴 Angka di layar akan BERUBAH besar** begitu ini live: omzet Kinerja
   Sales & Laporan Penjualan naik dari Rp 151.075.000 ke Rp 516.307.615.
   Itu koreksi, bukan regresi — tapi beri tahu Finance & Head Sales SEBELUM
   mereka melihatnya sendiri.
3. **🔴 UAT peramban PR-3 (`/sales/kinerja`) & PR-4 (`/admin/adopsi`)** —
   langkah per aktor di `HANDOFF_PR3_PR4_20260911.md` §6a/§6b. Tambahkan satu
   aktor baru: **lead divisi mana pun** harus melihat menu *Adopsi Sistem* dan
   HANYA baris divisinya.
4. **`role_mappings` → `Finance` dan `HR`.** Tanpa keduanya, Laporan Penjualan
   dan mutasi/resign praktis Director-only dan akan TERBACA seperti tidak
   jalan. Periksa SEBELUM UAT.

---

## 6. Lingkungan (biar tidak dicari ulang)

- `npm ci` di root **dan** `npm ci --prefix web-internal` (bukan anggota
  workspace — tanpa ini `report-shopee-parse.test.ts` gagal *collect* dengan
  "Cannot find package 'xlsx'", dan suite-nya terlihat seperti 752/757).
- Postgres: `pg_ctlcluster 16 main start`, lalu
  `su postgres -c "psql -c \"ALTER USER postgres WITH PASSWORD 'postgres';\""`.
- Tes domain WAJIB `scripts/db-rebuild.sh --yes` dulu (`audit_log` append-only).
- Jalankan suite lewat `npm test -w @cdps/domain` (ia memakai
  `fileParallelism: false` dari `packages/domain/vitest.config.ts` — berkas
  integrasi berbagi SATU DB, dan menjalankannya paralel menghabiskan slot
  koneksi).
- `web-internal`: `npx vitest run --root web-internal`.
