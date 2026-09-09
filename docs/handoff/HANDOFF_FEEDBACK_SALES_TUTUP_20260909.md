# Handoff — Feedback tim Sales **TUTUP** di `main` dan di live. Tugas berikutnya: tenor MSL ke jalur deal.

> **Titik mulai chat baru.** Baca ini dulu, lalu `docs/DECISIONS.md` baris
> **2026-09-09** (paling atas) untuk angka live dan cara memverifikasinya.
>
> Handoff ini **bukan ringkasan pekerjaan yang sudah selesai**. Bagian §1 hanya
> memastikan Anda tidak mengulang apa yang sudah ada. Isi sebenarnya ada di
> **§3 — tugas berikutnya**, yang ditulis supaya bisa langsung dikerjakan.

---

## 1 · Posisi (semua terverifikasi, bukan diwarisi)

| | |
|---|---|
| PR [#325](https://github.com/MEAgrup/AgencyAPP/pull/325) | ✅ merged `4613ede` — enam butir feedback Sales |
| PR [#329](https://github.com/MEAgrup/AgencyAPP/pull/329) | ✅ merged `60d2a0f` — perbaikan `main` merah + catatan migrasi live |
| `main` | ✅ **hijau** di `60d2a0f` |
| Live `CDPS SG` | ✅ 4 migrasi FS terpasang · gate **150 / 41 / 33 / 73** |
| Drift repo↔live | **nol MISSING**, 1 EXTRA ter-allowlist (`A2-DRIFT`, milik jalur D-3) |
| Produksi Vercel | ✅ `web-internal-mea` · `agency-app-api` · `web-client-portal` READY |

Enam butirnya: `#1` tombol WhatsApp · `#2` Owner tampil nama · `#3` prospek
bersama · `#4` jenis `bayar_komisi` · `#5` durasi kontrak di Client Record ·
`#6` opsi durasi MSL **(sisi katalog saja — lihat §3)**.

**Migrasi diterapkan SEBELUM merge**, berlawanan dengan preseden PR #309.
Alasannya mengikat dan berlaku untuk PR berikutnya juga: kode membaca skema
baru **tanpa syarat**, jadi deploy yang mendahului migrasi = **500** di halaman,
bukan halaman kosong.

---

## 2 · Satu episode yang layak diingat: `main` merah karena TANGGAL

Sesudah #325 di-merge, `db-and-migrations` merah di `main`. Ternyata **bukan**
dari diff itu — dibuktikan, bukan disimpulkan:

- tes yang sama gagal **identik** di `122a841` (main **sebelum** merge);
- `git diff --name-only 122a841 4613ede` → **nol** berkas showcase/izin.

`showcase.test.ts` (C-5, Gelombang C) meng-hardcode `berlakuSampai:
'2026-09-08'` — hari tes itu ditulis. `beriIzinPitch` menolak masa berlaku
lampau, jadi begitu kalender lewat, tesnya gagal **di setup-nya sendiri**.

Dua akibat, dan yang kedua lebih buruk daripada merahnya:

1. Merah selamanya sesudah tanggal itu, di **setiap PR siapa pun**.
2. Selama hijau ia **tidak pernah menguji apa yang namanya klaim** — namanya
   *"izin yang KEDALUWARSA boleh dicabut"*, padahal pada hari ditulis izinnya
   masih berlaku (batas inklusif). Ia lulus karena menguji hal lain.

Diperbaiki dengan tanggal relatif (`setahunLagi()`), nol kode produksi.

> 🔎 **Belum dikerjakan, layak ditiketkan:** menyisir repo untuk tanggal literal
> lain yang menunggu giliran meledak. Pola cari: literal `'20\d\d-\d\d-\d\d'`
> di `*.test.ts` yang dipakai sebagai *input* ke validasi, bukan sebagai
> `hariIni` yang diteruskan. Yang aman adalah yang diteruskan sebagai argumen
> (pola `statusIzinDariPeristiwa`); yang berbahaya adalah yang dibandingkan
> dengan `new Date()` di dalam kode produksi.

---

## 3 · TUGAS BERIKUTNYA — `#6` baru separuh: tenor belum bisa DIJUAL

### 3.1 Apa yang sudah ada, dan kenapa itu belum cukup

Sisi **katalog** mendarat: `master_service_duration_options` (`version_id`,
`durasi_bulan`, `harga`) + CONSTRAINT TRIGGER `trg_msdo_terpendek` di kedua
sisi, editor barisnya di form MSL, dan `durasi_options` mengalir
domain→wire→FE.

Yang **tidak** ada: jalan bagi tenor itu untuk sampai ke deal.

- `durasi_options` **berhenti di layar MSL**. Satu-satunya berkas `web-internal`
  yang menyentuhnya di luar `lib/msl.ts` adalah `master-services/page.tsx`.
- **Nol kolom `durasi_bulan`** di keempat tabel jalur deal. Diverifikasi
  langsung ke skema:

  ```
  qualified_form_services   … master_version_no, name, standard_price, quantity,
                              input_amount, unit, min_qty, pricing_mode,
                              apply_ppn, subtotal      ← TIDAK ada durasi_bulan
  negotiation_proposal_lines  proposal_id, master_service_id, proposed_price,
                              commission_rule, payment_terms   ← idem
  renewal_proposal_lines      (sama persis bentuknya)          ← idem
  services                  … master_version_no, …, contract_id, qty ← idem
  ```

**Mekanisme yang menentukan** ada di `packages/domain/src/sales.ts:1850`,
di dalam kueri `approvedLines`:

```sql
coalesce(pinned.durasi_bulan, at_proposal.durasi_bulan) as durasi_bulan
--        ^ master_service_versions via qfs.master_version_no
--                                ^ versi yang berlaku saat proposal dibuat
```

Lalu `deriveDuration` (`sales.ts:1516`) mengambil **`MAX`** dari situ.

⇒ Karena invarian FS-6 memaksa **opsi terpendek = `standard_price` +
`durasi_bulan` versinya**, angka yang terbaca **selalu paket terpendek**.
Untuk menjual paket 12 bulan berdiskon, tim Sales **masih** harus memakai
sembilan layanan lama yang terpecah — **yaitu keluhan aslinya.**

> Ini **bukan** regresi dan bukan klaim yang meleset: entri `DECISIONS.md` FS-4
> tidak pernah menyatakan sisi deal-nya dibangun. Tapi butir `#6` belum
> menghasilkan efek yang diminta sampai bagian ini ada.

### 3.2 Bentuk pekerjaannya

1. **Kolom snapshot `durasi_bulan integer NULL`** di keempat tabel.
   `NULL` = *"pakai durasi versi"* ⇒ **perilaku hari ini**, jadi backfill tidak
   perlu menebak apa pun dan baris lama tetap benar.
2. **`approvedLines` membaca snapshot lebih dulu:**
   `coalesce(qfs.durasi_bulan, pinned.durasi_bulan, at_proposal.durasi_bulan)`.
   Itu satu-satunya titik yang perlu diubah untuk closing — `deriveDuration`
   sendiri tidak perlu disentuh.
3. **Validasi:** tenor yang dipilih WAJIB salah satu baris
   `master_service_duration_options` versi yang di-pin. Menerima angka bebas
   berarti harga dan durasi bisa berpisah, dan invarian FS-6 tidak lagi
   menjamin apa pun. Pesan BI `[...]` sesuai aturan rumah #5.
4. **Harga ikut tenor:** memilih tenor harus memakai `harga` baris opsi itu,
   bukan `standard_price` versi. Ini bagian yang paling mudah luput dan paling
   mahal kalau luput.
5. **Pemilih tenor di FE:** kalkulator (`sales/kalkulator/page.tsx`), Qualified
   Form & negosiasi (`sales/[id]/page.tsx`), `RenewalPanel`. Tampilkan hanya
   bila layanan itu punya `durasi_options`.
6. `wire.ts` + `shape-parity` + `body-parity` + `route-parity`
   (**`KNOWN_GAPS` wajib tetap kosong**).

### 3.3 Batas yang DITERIMA apa adanya

`uq_qfs UNIQUE (attempt_id, master_service_id)`
(`20260722055205_qualified_forms.sql:37`) ⇒ satu deal tidak bisa memuat layanan
yang **sama** dengan **dua** tenor berbeda. Itu memang tidak dibutuhkan.
Dicatat di sini supaya tidak ditemukan ulang sebagai "bug".

Catatan bentuk: `negotiation_proposal_lines` dan `renewal_proposal_lines`
**tidak** membawa `master_version_no` (hanya `qualified_form_services` dan
`services` yang punya). Jadi snapshot tenor di kedua tabel proposal berdiri
sendiri — jangan berasumsi ia bisa diturunkan dari versi.

### 3.4 ⚠️ Ini JALUR UANG

Harga yang dipilih mengalir `qualified_form_services` →
`negotiation_proposal_lines` → `services` → `transactions` → mesin accrual
Gelombang D. **PR-nya sendiri, tes uang ditulis lebih dulu.** Minimal:

- tenor dipilih ⇒ `contracts.durasi_bulan` = tenor itu, bukan yang terpendek;
- tenor **tidak** dipilih ⇒ angka **persis sama** dengan hari ini (uji regresi
  yang membandingkan sebelum/sesudah, bukan sekadar "ada barisnya");
- tenor di luar daftar opsi ⇒ ditolak dengan pesan BI;
- harga yang tercatat = `harga` baris opsi, bukan `standard_price` versi.

---

## 4 · Tugas kedua: UAT peramban (utang B2)

Harness **sudah ada** sejak PR #324 — ini bukan lagi "tidak ada alatnya",
melainkan "belum dijalankan":

```
npm run tour:seed
npm run tour:jwt --employee EMP-0008
npm run tour:run --token ... --pages ...
```

| Layar | Peran | Membuktikan |
|---|---|---|
| `/sales` — kolom Owner | **Head Sales** | `#2` — nama, bukan `EMP-…` |
| `/clients/{id}` — panel Kontrak | **Sales staff** | `#5` — nol 403 |
| `/master-services` — form MSL | **Sales Head** | `#6` — editor baris opsi |

Kolom Owner sebagai Head Sales adalah bukti utama: gejalanya **hanya** muncul
di layar itu, karena OD/Director lolos `jwt_can_read_all()` dan tidak pernah
melihat bug-nya.

---

## 5 · Jebakan yang BENAR-BENAR kena di sesi ini

1. **`web-internal` BUKAN workspace npm** (`workspaces` = `apps/*`,
   `packages/*`). `npm install` di akar tidak pernah memasang deps-nya — itulah
   sumber banjir *"Cannot find module 'xlsx'"*. Obatnya `npm install` **di
   dalam** `web-internal/`.
2. **Menyunting `wire.ts` tanpa `npm test -w apps/api`.** Di commit F-3 itu
   memerahkan **dua** check CI (`api` dan `db-and-migrations` — job kedua juga
   menjalankan suite `@cdps/api`). Sesudah menyentuh `wire.ts`, keempat suite
   wajib diulang, bukan tiga.
3. **Postgres di container ini mati sendiri.** `pg_isready` dulu sebelum
   menyimpulkan apa pun dari puluhan FAIL.
4. **Dua false-FAIL yang selalu sama** (`admin.test.ts` hari libur,
   `client.test.ts` Hold Service) dari baris `audit_log` sisa run sebelumnya.
   Jalankan `scripts/db-rebuild.sh --yes` lalu ulangi — bukan bug.
5. **`list_migrations` bukan hitungan baris ledger.** Menghitungnya dengan mata
   melahirkan selisih 216 vs 212 yang sempat terlihat seperti drift. Yang
   otoritatif: `select count(*) from supabase_migrations.schema_migrations`,
   lalu bandingkan **per-slug** (`scripts/check-live-drift.sh`).
6. **Fixture yang tidak sengaja membuka RLS.** Versi pertama tes F-2 **LOLOS
   padahal bug-nya hidup**, karena fixture mengisi `employees.created_by`
   dengan id pembaca — membuka arm ketiga `employees_select`. Sinkronisasi HRIS
   sungguhan menulis `'SYSTEM'`. **Kalau sebuah tes RLS hijau di percobaan
   pertama, curigai fixture-nya dulu.**
7. **Tanggal literal di tes** — §2. Hijau sehari, merah selamanya, dan merahnya
   muncul di PR orang lain.

---

## 6 · Cara memverifikasi klaim handoff ini

```bash
pg_isready -h 127.0.0.1 -p 5432 || service postgresql start
./scripts/db-rebuild.sh --yes            # gate 150 · 41 · 33 · 73
export DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps"
npm test -w packages/core -w packages/db -w packages/domain
npm test -w apps/api                     # route/shape/body-parity
cd web-internal && npm install && npm test && npx tsc --noEmit && npm run build
```

Angka acuan terakhir (diukur di `60d2a0f`): domain **2220** · apps/api **495** ·
core **985** · db **64** · `typecheck --workspaces` bersih. Angka naik, tidak
pernah turun.

Live: `mcp__Supabase__list_migrations` (project `egddxfcnrtecheiykhlf`) lalu
bandingkan per-slug. Apply HANYA lewat `apply_migration`, **per berkas, urut
nama** (O65) — jangan `supabase db push`, jangan `psql -f`.

**Lint:** 1 error pre-existing (`react-hooks/static-components` di
`admin/employees/page.tsx`), di luar cakupan, sudah tercatat sejak handoff
sebelumnya.
