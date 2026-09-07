# Handoff — **Gelombang C tutup, live sinkron**. Yang tersisa: Gelombang D, dan tiga pekerjaan DATA

> **Baca ini dulu, lalu tiga berkas ini, urut:**
> 1. `docs/DECISIONS.md` — empat baris teratas bertanggal 2026-09-07 (migrasi ke
>    live · Gelombang C dibangun · C-5 diketok · C-4 diketok). Lalu §Open: hanya
>    **tiga** baris 🔴 tersisa, dan **tak satu pun** tentang Gelombang C.
> 2. `docs/handoff/HANDOFF_GELOMBANG_C_SELESAI_20260907.md` — apa yang dibangun
>    dan jebakan verifikasinya (§3 wajib dibaca sebelum menjalankan tes).
> 3. `docs/handoff/HANDOFF_GELOMBANG_C_20260907.md` §4 — empat aturan uang
>    Gelombang D yang sudah diketok. Itu spesifikasi D; jangan ketok ulang.

---

## 1. Posisi sebenarnya

| | Status |
|---|---|
| **Gelombang A · B1…B5** | ✅ di `main` |
| **Gelombang C — Showcase Klien Terbaik** | ✅ **TUTUP** — lima langkah, nol sisa |
| **Gerbang keputusan C/D** | ✅ **10 dari 10 diketok** |
| **Migrasi live** | ✅ **SINKRON** — repo & `CDPS SG` sama-sama **185**, 146 tabel |
| **Gelombang D — laporan keuangan accrual** | ⏸️ aturan uang lengkap; penghalangnya **hanya DATA** |

**Nol sisa Gelombang C.** §Open `DECISIONS.md` tidak memuat satu pun baris C.
Tiga yang masih 🔴 semuanya di luar C:

| # | Ringkas | Memblokir |
|---|---|---|
| `B23-SHP` | kanal `gmv_mix` Shopee mana mengisi kolom B-2.3 mana | Section B Shopee saja; sengaja tidak ditebak (taksonomi kanalnya tumpang tindih ⇒ menebak = angka karangan di baseline yang dibaca klien) |
| `O65` | ledger migrasi live berbeda *wholesale* dari nama berkas repo | Tidak memblokir fitur; **memblokir `supabase db push` selamanya** — lihat §4 |
| `KS-4` | gap desain OKR Sales (closing ratio dari qualified leads) | Kinerja Sales, bukan C/D |

---

## 2. Keadaan live — diverifikasi, bukan diasumsikan

Dua migrasi di-apply 2026-09-07 lewat `mcp__Supabase__apply_migration` per berkas:

| # | Berkas | Isi |
|---|---|---|
| **184** | `20260916010000_c5_izin_pitch_klien.sql` | `client_pitch_consents` — ledger izin pitch |
| **185** | `20260917010000_c5_harden_search_path.sql` | kunci `search_path` fungsi trigger-nya |

Diverifikasi lewat kueri katalog:

```
tabel_public 146 · entity_prefix 40 · sm_machines 31 · notif_events 69
client_pitch_consents: 8 kolom · 2 trigger beku (UPDATE + DELETE)
RLS aktif · 1 policy · authenticated SELECT=true INSERT=false · anon nol · 0 baris
client_pitch_consents_frozen.proconfig = {search_path=public}
```

**Halaman `/showcase` sekarang berfungsi di produksi** — dan yang akan terlihat
adalah jalur KOSONG-nya, dengan kalimat yang menjelaskan sebabnya. Itu benar,
bukan cacat (lihat §3).

### Advisor keamanan

`get_advisors(security)` sesudah 185: **nol temuan baru dari Gelombang C.** Sisanya
pra-ada dan di luar cakupan — 30 `rls_enabled_no_policy` (INFO, tabel
config/registry yang memang default-deny), `security_definer_view` pada
`interview_verdict` (ERROR, pra-ada), enam fungsi lama ber-`search_path` mutable,
dan `auth_leaked_password_protection` (setelan proyek, bukan skema). Kalau
suatu saat dikerjakan, itu tiket tersendiri.

---

## 3. TIGA pekerjaan yang memblokir NILAI — dan tak ada kode yang bisa menggantikannya

Ini yang tersisa, dan ketiganya pekerjaan **admin/operasional**, bukan dev.

1. **Isi `durasi_jasa` di MSL — 0 dari 14 layanan.**
   Ini **satu-satunya** penghalang Gelombang D. Tanpa ia, mesin accrual
   menerbitkan skedul pendapatan kosong untuk **semua** layanan, apa pun jawaban
   D-1…D-4 yang sudah diketok. Membangun D lebih dulu berarti kerja dua kali
   dengan nol nilai di antaranya (keputusan pemilik 2026-09-07).

2. **Naikkan jumlah laporan klien — 1 dari 10 klien.**
   Halaman Showcase sudah ada dan jujur mengatakan kenapa ia kosong. Dengan
   ambang **skor ≥ 8,0 × 3 periode ber-skor**, klien pertama muncul paling cepat
   sesudah tiga periode laporan ber-label SEHAT. Satu-satunya laporan live
   hari ini ber-skor **4,5 (KRITIS)**.

3. **Minta izin pitch ke klien — 0 baris di `client_pitch_consents`.**
   Pekerjaan baru yang lahir dari C-5. Tanpa satu pun baris `beri`, daftar yang
   divisi **Sales** lihat kosong **secara sah** — dan halaman mengatakannya.
   AM mencatatnya lewat tombol **"Catat izin"** di `/showcase`; yang dicatat
   adalah rujukan buktinya (nomor PKS, subjek email, tanggal percakapan) dan
   opsional masa berlakunya.

> ⚠️ Ketiganya saling bebas. Nomor 1 membuka Gelombang D; nomor 2 dan 3
> **bersama-sama** yang membuat Showcase berisi — laporan tanpa izin tak
> terlihat Sales, izin tanpa laporan tak punya apa pun untuk ditampilkan.

---

## 4. Gelombang D — apa yang sudah diputuskan, jangan ketok ulang

Keempat aturan uangnya **lengkap** (rinciannya di
`HANDOFF_GELOMBANG_C_20260907.md` §4 dan baris `Decided` 2026-09-07):

| Gerbang | Ketokan | Konsekuensi yang wajib ikut dibangun |
|---|---|---|
| **D-1** | (a) **HANGUS** | Layanan di-void di tengah periode diakui hanya untuk hari yang sudah jalan; sisanya tidak pernah diakui |
| **D-2** | (a) **`[On Hold]` MENJEDA** pengakuan pendapatan | Butuh riwayat hold (mulai/selesai) yang dibaca mesin laporan; skedul bergeser & dihitung ulang. Risiko operasional: hold harus diinput **saat kejadian**, bukan diingat belakangan |
| **D-3** | **YA, ada kunci tutup buku per bulan** | Satu peran berwenang **menutup** · bulan tertutup **tidak bisa diedit sama sekali**, koreksi hanya lewat **jurnal koreksi di bulan berjalan** yang ikut masuk audit log · mesin laporan membaca bulan tertutup dari **angka yang dibekukan**, bukan menghitung ulang dari data mentah |
| **D-4** | **Bruto dulu; Sales/Finance yang memilih kena PPN atau tidak** | Nilai disimpan **bruto** + penanda pilihan per transaksi. Mesin accrual **TIDAK** menghitung PPN sendiri — manusia yang memilih |

Perkiraan: Gelombang D menambah **satu migrasi ⇒ 186**.

---

## 5. Verifikasi — perintah + angka acuan TERKINI

```
service postgresql start
su postgres -c "psql -c \"ALTER USER postgres PASSWORD 'postgres';\""   # sekali per container
export DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps"
bash scripts/db-rebuild.sh --yes
npm install && npm run typecheck --workspaces --if-present && npm test --workspaces
cd web-internal && npm install && npx vitest run && npx tsc --noEmit && npm run build
cd ../web-client-portal && npx vitest run
```

| Suite | Angka acuan |
|---|---|
| core | **930** |
| db | 53 |
| apps/api | **490** |
| domain | **1977** (+1 skip) |
| web-internal | **640** |
| web-client-portal | 19 |
| migrasi `db-rebuild` | **185** |
| tabel `public` | **146** |

`entity_prefix` **40** · `sm_machines` **31** · `notif_events` **69**.

### Jebakan — dua yang paling mahal lebih dulu

- ⚠️ **`npm run typecheck --workspaces` WAJIB diulang SESUDAH `npm install`
  selesai, dan keluarannya DIBACA.** Ini memerahkan tiga job CI di sesi
  Gelombang C. Di container yang `node_modules`-nya belum terpasang, `tsc`
  membanjiri keluaran dengan *"Cannot find module 'vitest'"* untuk setiap berkas
  tes, dan galat yang sungguhan tenggelam di antaranya. **`core-engines`, `api`,
  DAN `db-and-migrations` ketiganya mengompilasi `@cdps/core`**, jadi satu galat
  tipe di sana tampak seperti tiga masalah berbeda.
- ⚠️ **Jalankan `packages/domain` SENDIRIAN sesudah `db-rebuild`.** Tanpa itu,
  ~788 kegagalan palsu berpangkal `plan.test.ts` yang menyapu `clients`.
  **Rebuild dulu, baru cari bug** — jangan terbalik.
- **`audit_log` menolak DELETE** (aturan rumah #3). Tes yang menghitung baris
  audit tidak boleh membersihkannya; pakai id aktor unik per jalan (pola
  `aktorUnik()` di `packages/domain/src/showcase.test.ts`).
- **`client_pitch_consents` menolak UPDATE dan DELETE.** Fixture membersihkannya
  dengan mematikan trigger sebagai superuser lalu **mengembalikannya di
  `finally`** — pola yang sama `client_report_insight`.
- **Postgres bisa mati sendiri di container ini** — `pg_isready` dulu sebelum
  menyimpulkan apa pun dari puluhan FAIL.
- `rm -rf web-internal/.next` kalau muncul *"Another next build process is
  already running"*.
- 1 error lint `react-hooks/static-components` di `admin/employees/page.tsx`
  **PRE-EXISTING**, di luar cakupan.

### Live DB

⛔ **JANGAN `supabase db push`** — ledger versi live berbeda *wholesale* dari
nama berkas repo (`O65`, masih terbuka). Pakai `mcp__Supabase__apply_migration`
**per berkas**, lalu **verifikasi lewat kueri katalog** — jangan percaya
`success: true` saja. Proyek live: `egddxfcnrtecheiykhlf` (`CDPS SG`).

Dan satu aturan yang lahir sesi ini: **migrasi yang SUDAH di-apply ke live tidak
boleh disunting.** Perbaikan atasnya = migrasi baru ber-`CREATE OR REPLACE`.
Menyunting berkas yang sudah berjalan membuat repo dan live berhenti
menggambarkan hal yang sama — kelas drift yang O38 lahir darinya.

---

## 6. Aturan kerja yang terbukti dan wajib dibawa

1. **Setiap jahitan wajib punya satu tes yang memanggil KEDUA sisi sungguhan.**
   Terbukti tiga kali (B2↔B3, `angle_video`, lalu mesin laporan → Showcase):
   tes unit di kedua sisi bisa hijau sementara jahitannya putus, karena
   masing-masing memakai fixture-nya sendiri.
2. **Cabang tes jangan ditebak — turunkan dari data nyata.** Sebuah `if (lolos)`
   telanjang hijau juga saat cabang yang menarik tak pernah dijalani; pola yang
   dipakai: hitung `harusLolos` dari keluaran mesin, lalu `expect` kedua sisinya.
3. **Opsi keputusan yang membawa alasan teknis wajib diperiksa ke kode SEBELUM
   diajukan ke pemilik.** Ambang C-4 pertama (7,0) diketok atas dasar klaim
   keliru bahwa 7,0 = batas SEHAT; batas sebenarnya 8,0. Tertangkap hanya karena
   implementasinya kebetulan membuka `skor.ts`.
4. **Ketiadaan yang diam tidak bisa dibedakan dari kerusakan.** Halaman kosong
   wajib mengatakan sebabnya; daftar yang disaring wajib mengatakan berapa yang
   disembunyikan. Ini kelas kekeliruan yang sama dengan `0` vs `null`.

---

## 7. Urutan yang gw sarankan untuk sesi berikutnya

1. **Kalau `durasi_jasa` MSL sudah terisi** → bangun **Gelombang D** sesuai §4.
   Mulai dari mesin accrual di `@cdps/core` (tes ditulis DULUAN untuk pro-rate
   hangus D-1 dan pergeseran hold D-2), lalu kunci tutup buku D-3 sebagai
   mesin status + jalur jurnal koreksi, lalu D-4 sebagai penanda pilihan per
   transaksi.
2. **Kalau belum terisi** → jangan mulai D (kerja dua kali, nol nilai di
   antaranya — keputusan pemilik). Yang layak dikerjakan sebagai gantinya:
   - **`B23-SHP`** kalau pemilik sudah bisa mengetoknya (butuh contoh berkas
     Shopee untuk memetakan taksonomi kanalnya, bukan tebakan);
   - **UAT `/showcase` di peramban** — satu-satunya hal Gelombang C yang belum
     dibuktikan mata (§8 handoff C-selesai);
   - **`KS-4`** kalau Kinerja Sales jadi prioritas.

---

## 8. Yang masih BELUM dibuktikan tentang Gelombang C — disebut jujur

- **Piksel React.** `/showcase` lolos `tsc`, `vitest`, `next build`, dan badan
  JSON-nya diuji lewat rute — tapi tak ada seorang pun yang membukanya di
  peramban. Yang terbukti kontraknya, bukan tata letaknya.
- **`materiPitch` dengan banyak klien.** Diuji dengan 0 dan 1 klien ber-izin;
  tata letak tabel sepuluh baris belum pernah dilihat mata.
- **Perilaku trigger beku di live.** Sengaja tidak diuji di produksi — sudah
  dibuktikan tes domain lokal + `immutability_checks` di CI. Mengujinya di live
  berarti menulis baris ke sana untuk alasan yang bukan alasan bisnis.
