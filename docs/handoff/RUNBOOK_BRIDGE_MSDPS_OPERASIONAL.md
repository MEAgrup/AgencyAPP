# Tutorial — Bridge MSDPS→CDPS: dari Deal sampai Dikerjakan Tim

> **Dibuat 2026-09-16, direstruktur 2026-09-16.** Kode di **kedua** repo
> (`MEAgrup/AgencyAPP` Bagian A, `MEAgrup/MEAGO_MSDPS` Bagian B) sudah ✅
> **SELESAI dan LIVE**, terbukti bekerja untuk deal nyata. Berkas ini
> menjawab tiga pertanyaan tim secara berurutan — **siapa boleh bikin deal
> & caranya**, **apa syarat deal bisa diteruskan ke CDPS**, dan **apa yang
> harus dikerjakan tim CDPS sampai pekerjaannya benar-benar berjalan** —
> masing-masing dengan contoh kasus yang mengalir dari bagian ke bagian.
>
> Status verifikasi live (angka & bukti query) dipindah ke **Lampiran** di
> bagian bawah supaya bagian tutorial tidak terpotong-potong.

---

## Ringkasan alur (peta sebelum masuk detail)

```
MSDPS (MEAGO!)                                    CDPS (MEA Agency)
──────────────────                                ──────────────────
1. Lead → Dealing/Renewal
2. BD/CM daftarkan DEAL- (Bagian 1)
3. Bentuk Kerjasama = Berbayar
   + Transaksi Finance diverifikasi   (Bagian 2)
4. "Teruskan ke CDPS" → ORD- terkirim
                                       5. /bridge/inbox → Accept   (Bagian 3)
                                          → CLI-/SVC-/CTR- terbentuk
                                       6. Intake Queue → assign AM
                                       7. Onboarding (Strategy kalau
                                          plan-gated) → Brief → Eksekusi
```

Tiga bagian di bawah mengikuti nomor ini. Contoh kasusnya satu cerita yang
sama dari awal sampai akhir: **"Kopi Kenangan Merdeka"**, merchant Dining
yang closing lewat MEAGO! dan pekerjaannya dieksekusi tim MEA Agency.

---

## Bagian 1 — Siapa yang bisa membuat deal, dan bagaimana caranya (MSDPS)

### 1.1 Siapa

| Peran | Bisa daftarkan deal? |
|---|---|
| BD (divisi `BizDev`) | ✅ |
| CM (divisi `CreatorManagement`) | ✅ |
| OD / Director | ✅ (akses penuh, `mgmt`) |
| Divisi lain (Ads, Creative, Finance, dst.) | ❌ |

Gerbangnya persis di kode (`app/(app)/deals/page.tsx`):
```
canRegister = mgmt (OD/Director) || division === 'BizDev' || division === 'CreatorManagement'
```
Kalau Anda login dan tombol "Daftarkan Transaksi" tidak muncul di `/deals`,
itu berarti divisi Anda memang bukan salah satu dari tiga di atas — bukan
bug.

### 1.2 Prasyarat: harus ada Lead berstatus Dealing/Renewal dulu

Deal **tidak bisa** didaftarkan dari nol. Ia harus dipilih dari pool Lead
yang sudah berstatus `Dealing` atau `Renewal` (query `page.tsx` memfilter
persis dua status ini). Kalau merchant belum ada di pool itu:

1. Buat Lead-nya dulu di `/leads` (bisa dibuat oleh BD, Marketing, atau
   Director).
2. Jalankan pipeline lead sampai negosiasi selesai, lalu klik **"Update
   Status Leads"** dan pilih status `Dealing` (atau `Renewal` untuk
   perpanjangan klien lama).

Baru sesudah itu merchant tersebut muncul di dropdown "Nama POI / Merchant
(Dealing/Renewal)" saat mendaftarkan deal.

### 1.3 Langkah mendaftarkan deal

Buka `/deals` → klik **"Daftarkan Transaksi"**. Isi:

| Field | Wajib? | Contoh kasus "Kopi Kenangan Merdeka" |
|---|---|---|
| Nama POI/Merchant | ✅ (pilih dari pool Dealing/Renewal) | Kopi Kenangan Merdeka |
| Nama BD | ✅ | Ajeng (auto-terisi dari Lead yang dipilih) |
| Nama OPS | ✅ | — |
| Kategori POI | ✅ | `Dining` |
| Bentuk Kerja Sama | ✅ | `Berbayar` |
| Nama PIC POI | ✅ | Budi (owner) |
| Nomor WhatsApp PIC | ✅ | 628123456789 |
| Tanggal Awal/Akhir Kerjasama | ✅ untuk kategori `Dining` | 2026-09-16 s/d 2027-09-15 |
| Nominal Deals | ✅ | Rp 15.000.000 |
| Benefit | opsional | — |

Klik submit. Sistem membuat baris `brand_deals` baru dengan kode otomatis
**`DEAL-202609-0099`** (format `DEAL-YYYYMM-NNNN`, immutable) —
`sourced_by_role` terisi `bd` atau `cm` otomatis sesuai divisi Anda, bukan
dipilih manual.

**Sampai titik ini, deal HANYA ada di MSDPS.** Belum ada apa pun yang
terkirim ke CDPS — itu Bagian 2.

---

## Bagian 2 — Apa syarat agar deal bisa diteruskan ke CDPS (MSDPS)

Tombol **"Teruskan ke CDPS"** di baris deal `DEAL-202609-0099` **tidak akan
muncul/berfungsi** sampai dua gerbang berikut lolos — ini gerbang di level
trigger database (D4 + D13), bukan pilihan UI yang bisa dilewati:

### 2.1 Gerbang 1 — Bentuk Kerjasama harus `Berbayar`

Deal `Free/Barter` tidak pernah bisa dibridge. Untuk "Kopi Kenangan
Merdeka", ini sudah terpenuhi sejak Bagian 1 (dipilih `Berbayar`).

### 2.2 Gerbang 2 — Transaksi Finance harus dibuat DAN diverifikasi

1. Selama deal belum punya transaksi sama sekali, baris deal menampilkan
   tombol **"Buat Transaksi Finance"** (memanggil `create_poi_finance()`).
   Klik itu — sistem membuat transaksi `TRX-202609-00xx` untuk deal ini.
   Tombolnya lalu hilang (tidak bisa membuat dua kali untuk deal yang
   sama — fungsi SQL-nya sendiri menolak dengan pesan
   `[transaksi untuk deal ini sudah dibuat]`).
2. Tim **Finance** memverifikasi transaksi itu di halaman Finance seperti
   transaksi biasa (bukti pembayaran, dsb). Begitu terverifikasi,
   `transactions.released_to_account_at` terisi — inilah yang dibaca
   gerbang D13.

**Baru sesudah kedua gerbang ini lolos**, tombol "Teruskan ke CDPS" aktif.

### 2.3 Langkah mengirim ke CDPS

1. Klik **"Teruskan ke CDPS"** di baris `DEAL-202609-0099`.
2. Di modal, tambahkan satu baris per **jenis pekerjaan** yang perlu
   dikerjakan tim MEA Agency. Untuk contoh kita, "Kopi Kenangan Merdeka"
   butuh dua jenis:
   - `Account` (qty 1, catatan "Account management bulanan")
   - `Ads` (qty 1, catatan "Ads TikTok + GoFood/GrabFood")

   Jenis yang tersedia: `Account`, `Ads`, `Creative`, `Store Operation`,
   `KOL-Non-Roster` (wajib isi `alasan_non_roster`), `Live Stream`.
3. Submit. Baris tersimpan sebagai `deal_bridge_lines`.
4. Job pengiriman otomatis jalan **tiap 10 menit** (`vercel.json` cron
   `*/10 * * * *`) — mengirim ke CDPS sebagai satu **order** `ORD-`. Gagal
   kirim → retry otomatis (backoff), sampai 5 kali → dead-letter di
   `platform_alerts`.
5. **Satu order per deal seumur Fase 1.** Kalau nanti "Kopi Kenangan
   Merdeka" butuh jenis pekerjaan tambahan (mis. `Creative` menyusul),
   Fase 1 belum punya cara menambah baris ke order yang sudah terkirim —
   hubungi tim CDPS dulu.

**Sampai titik ini, tugas tim MSDPS selesai.** Order `ORD-202609-00xx`
sekarang duduk di inbox CDPS, menunggu manusia di sana — itu Bagian 3.

---

## Bagian 3 — Apa yang harus dikerjakan tim CDPS sampai pekerjaannya selesai

Ini bagian terpanjang karena mencakup **seluruh rantai eksekusi**, bukan
cuma "terima order". Empat langkah, berurutan, tidak bisa dilompat.

### 3.1 Langkah 1 — Terima order di Bridge Inbox

**Siapa:** lead Account (SPV/Head Account) atau Director. OD bisa lihat
tapi tombolnya tidak aktif untuknya.

**Di mana:** menu **Keuangan → "Bridge MSDPS (MEAGO!)"** (`/bridge/inbox`).

1. Buka order `ORD-202609-00xx` (status `[Masuk]`).
2. Baca payload: merchant "Kopi Kenangan Merdeka", atestasi pembayaran
   (`TRX-202609-00xx`, diverifikasi kapan), dua baris jenis (`Account`,
   `Ads`), plus kandidat client yang mungkin cocok (dedup otomatis —
   sistem **tidak pernah** auto-pilih).
3. Isi **empat field manual** yang memang tidak dikirim MSDPS (datanya
   beda definisi di kedua sistem): `link toko`, `kategori`, `GMV
   baseline`, `target GMV`.
4. Klik **Accept**.

**Yang terjadi otomatis sesudah Accept** (satu transaksi, tidak bisa
setengah jalan):
- `CLI-202609-00xx` dibuat (atau di-attach ke client lama kalau kandidat
  dipilih).
- `client_external_ref` + `client_external_billing` (atestasi pembayaran,
  append-only, tidak bisa diedit siapa pun) dicatat.
- Satu `CTR-` (kontrak) dibuat dari jendela tanggal di payload
  (2026-09-16 s/d 2027-09-15).
- **Dua** `SVC-` dibuat — satu untuk `Account`, satu untuk `Ads` — masing-
  masing berstatus awal **`[Awaiting Onboarding]`**, ditandai
  `sumber='meago'` (supaya tidak ikut GMV/komisi AM CDPS biasa).
- Client ditandai `released_to_account_at` — **ini SATU-SATUNYA yang
  membuka jalur eksekusi normal.** Bridge **tidak** menunjuk AM — client
  masuk ke antrean umum, sama seperti client hasil closing sales biasa.

⚠️ **Kalau Accept gagal** dengan pesan
`[layanan MEAGO belum dipetakan ke Master Service List]`: salah satu jenis
di baris order itu (mis. `Live Stream`) belum punya padanan paket MSL —
lihat Lampiran §A untuk cara melengkapinya. Order tidak hilang, tetap bisa
dicoba lagi sesudah pemetaannya dilengkapi.

### 3.2 Langkah 2 — Assign Account Manager (AM)

Client `CLI-202609-00xx` sekarang **ada**, tapi **belum ada yang
memegangnya**. Ia duduk di **Unassigned Intake Queue**.

**Siapa yang menugaskan:** SPV/Head Account atau Director
(`canManageAssignment`) — **bukan** AM sendiri, dan **bukan** otomatis dari
bridge.

**Di mana:** halaman **`/account`**, bagian antrean intake (terlihat untuk
SPV/Head Account & OD/Director; diurutkan dari yang paling lama menunggu).

1. Buka `/account`, lihat "Kopi Kenangan Merdeka" muncul di antrean
   (bersama jumlah service-nya: 2).
2. Klik baris itu → pilih AM dari panel Assign — hanya karyawan **aktif**,
   **divisi Account**, **level staff** yang muncul sebagai kandidat (Lead/
   SPV bukan kandidat, mereka yang menugaskan).
3. Konfirmasi. AM terpilih (misal "Rani") sekarang jadi pemegang client
   ini — dashboard workload SPV juga naik satu untuk Rani.

**Tanpa langkah ini, dua `SVC-` tadi tidak akan pernah bergerak** —
`[Awaiting Onboarding]` tidak jalan sendiri, ia menunggu AM.

### 3.3 Langkah 3 — Onboarding: Strategy & Plan (kalau diwajibkan)

Setiap `SVC-` mewarisi flag `Requires Strategy Plan` dari paket MSL-nya
saat dibuat (`Yes` = plan-gated, `No` = Direct). Untuk contoh kita:

- **`SVC-` Account** → misal paketnya `Yes` (plan-gated).
- **`SVC-` Ads** → misal paketnya `No` (Direct).

**Untuk service plan-gated (Account):**
1. Rani (AM) membuka service itu, membuat **Strategy & Plan** (`STR-`) —
   status awal `[Strategy Drafting]`.
2. Rani submit untuk approval → `[Strategy Submitted for Approval]`.
3. **SPV/Head Account** (bukan Rani) me-review:
   - Setuju → `[Strategy Approved]`. Service induk (`SVC-` Account) ikut
     naik ke **`[Strategy Approved]`** di transaksi yang sama.
   - Minta revisi → `[Strategy Drafting]` lagi, wajib isi catatan revisi;
     Rani perbaiki dan submit ulang (revision count naik, terhitung dari
     audit log).

**Untuk service Direct (Ads):** tidak ada `STR-` sama sekali (§4 Rule 6) —
Rani bisa langsung lompat ke Langkah 4 untuk service ini begitu ditugaskan.

⚠️ **Gerbang yang sering salah paham:** service plan-gated **tidak bisa**
dibuatkan Brief sebelum `[Strategy Approved]` — mencoba langsung akan
ditolak dengan pesan
`[layanan ini wajib memiliki Strategy & Plan yang disetujui sebelum dibuatkan Brief]`.

### 3.4 Langkah 4 — Brief & eksekusi pekerjaan sehari-hari

Ini yang benar-benar disebut "dikerjakan sampai selesai" — siklusnya
berulang setiap periode (mis. bulanan), bukan sekali jalan.

1. Rani (atau tim pelaksana divisinya) membuat **Brief** (`BRF-`) untuk
   service yang sudah boleh (Direct langsung, plan-gated sesudah Strategy
   Approved). Service naik ke **`[Briefed]`**, lalu ke **`[In Execution]`**
   begitu Brief pertamanya keluar dari `[To Do]`.
2. Brief berjalan lewat mesin tugas standar CDPS:
   `[To Do]` → **PIC divisi pelaksana** mulai kerja → `[In Progress]` →
   PIC submit hasil → `[Submitted]` → **lead divisi pelaksana** melakukan
   QC internal:
   - Lolos → teruskan ke AM → `[In Review]`.
   - Tidak lolos → `[Revision Requested]` (feedback wajib) → kembali ke
     PIC di `[In Progress]` — **belum pernah sampai ke AM**, jadi tidak
     ikut terhitung sebagai revisi dari klien.
3. **Rani (AM pemilik client) yang punya keputusan akhir**: `[In Review]`
   → `[Approved]` (terminal untuk Brief itu). Kalau Rani sendiri yang
   minta revisi di titik ini, itu baru terhitung sebagai revisi klien
   (§6 Rule 4 — flag di revisi ke-3).
4. Untuk "Kopi Kenangan Merdeka": Brief bulan pertama untuk `Account`
   (mis. laporan onboarding) dan `Ads` (mis. campaign TikTok bulan
   berjalan) masing-masing berjalan lewat siklus di atas. Begitu
   ke-`[Approved]`, pekerjaan bulan itu **selesai** — bulan berikutnya
   Brief baru dibuat lagi untuk periode berikutnya (service tetap
   `[In Execution]` selama kontrak berjalan; ini bukan status sekali-jadi
   yang "tamat", melainkan kondisi normal client aktif).

**Kalau ada masalah di tengah jalan** (klien komplain, mau jeda sementara):
- **Hold** (dua langkah): Rani mengajukan `[In Execution] → [Hold
  Requested]` (wajib isi alasan) → Head of Account menyetujui →
  `[On Hold]`, atau menolak → balik `[In Execution]`. Resume juga lewat
  Head of Account.
- **Void** (batal total, mis. salah petakan MSL): SPV/Account Lead
  menyetujui → service + Brief yang belum `[Approved]` jadi
  `[Cancelled — Service Voided]`, terminal.

---

## Ringkasan siapa-mengerjakan-apa

| Tahap | Siapa | Sistem |
|---|---|---|
| Buat Lead | BD / Marketing / Director | MSDPS |
| Update status Lead → Dealing/Renewal | BD (pemilik lead) | MSDPS |
| Daftarkan Deal | BD / CM / Director | MSDPS |
| Buat Transaksi Finance | BD / CM / Director | MSDPS |
| Verifikasi Transaksi Finance | Finance | MSDPS |
| Teruskan ke CDPS | BD / CM / Director | MSDPS |
| Accept/Reject order | Lead Account / Director | CDPS |
| Assign AM | SPV/Head Account / Director | CDPS |
| Strategy & Plan (kalau plan-gated) | AM (draft) → SPV/Head Account (approve) | CDPS |
| Buat & kerjakan Brief | PIC divisi pelaksana | CDPS |
| QC internal Brief | Lead divisi pelaksana | CDPS |
| Approval akhir Brief | AM pemilik client | CDPS |

---

## Lampiran A — Melengkapi pemetaan Master Service List (Director/Sales Head/Head Account)

Kerja **data**, bukan kode, dan **belum ada layar admin** untuk langkah 2:

1. Buat/pilih paket di `/master-services` seperti paket layanan biasa —
   tidak ada flag khusus "paket MEAGO".
2. Petakan jenisnya lewat API (Director-only, belum ada UI):
   ```
   POST /api/v1/admin/external-service-map
   Authorization: Bearer <JWT Director>
   { "external_service_type": "Live Stream", "master_service_id": "MSV-...", "aktif": true }
   ```
   Gunakan `GET /api/v1/admin/external-service-map` untuk lihat baris yang
   sudah ada sebagai contoh bentuk. Kalau tidak bisa memanggil API langsung,
   minta bantuan tim teknis sekali jalan.
3. Nonaktifkan pemetaan lama (bukan hapus) lewat
   `POST /api/v1/admin/external-service-map/{id}/deactivate` kalau paketnya
   diganti.

## Lampiran B — Status terverifikasi live (2026-09-16)

Diverifikasi langsung ke `CDPS SG` (`egddxfcnrtecheiykhlf`) dan MSDPS
(`mvcckptntrvzujqaoxxh`) via SQL, bukan dikutip dari dokumen lama —
`docs/backlog/BRIDGE_MSDPS_BACKLOG.md` §"Prasyarat go-live" sempat menulis
klaim yang sudah usang, sudah dikoreksi di sana juga.

| Prasyarat go-live | Status | Bukti |
|---|---|---|
| Kode Bagian A (CDPS) & Bagian B (MSDPS) | ✅ selesai | `docs/backlog/BRIDGE_MSDPS_BACKLOG.md` |
| Paket MEAGO di MSL + `external_service_map` | ✅ **5 dari 6 jenis** (`Account`→`MSV-202609-0002`, `Ads`→`0003`, `Creative`→`0004`, `Store Operation`→`0005`, `KOL-Non-Roster`→`0006`) | query `external_service_map` |
| **`Live Stream`** dipetakan | ⬜ **BELUM** — order berjenis ini akan gagal Accept sampai dilengkapi (Lampiran A) | idem |
| Employee layanan bridge | ✅ `SVC-MEAGO-BRIDGE` ("MEAGO Bridge (layanan)", `mcnmeadigital@gmail.com`), aktif | query `employees` |
| Deal nyata mengalir ujung-ke-ujung | ✅ **1 deal**: `DEAL-202609-0078` (merchant "Salad Hut") → `ORD-202609-0001` → `CLI-202609-0017`, `[Diterima]` 2026-09-12 06:29 UTC oleh Director. Transaksi `TRX-202609-0001`. | query `external_orders` |
| Exit criteria Fase 1 (5–10 deal nyata) | ⬜ **1 dari 5–10** — `cdps_outbox` sisi MSDPS baru 1 baris `status='sent'` | query `cdps_outbox` |
| UAT browser 3 aktor | ⬜ belum dijalankan — sempat diblokir kebijakan jaringan sandbox, perlu dijalankan manusia dari jaringan normal | `MEAGO_MSDPS/docs/UAT_PENSIUN_BROWSER_RUNBOOK.md`, `scripts/browser-tour.mjs` |

**Kesimpulan:** bridge-nya sudah hidup dan terbukti bekerja untuk satu deal
nyata. Yang tersisa murni operasional — lengkapi pemetaan `Live Stream`, dan
pakai alur di Bagian 1–3 di atas untuk menambah volume deal nyata sampai
exit criteria Fase 1 terpenuhi.

## Referensi

- Kontrak payload lengkap: `docs/BRIDGE_MSDPS_CONTRACT.md` + fixture
  `docs/fixtures/bridge_order_v1.json` (identik di kedua repo).
- Rincian teknis per ticket (A1–A7, B0–B6): `docs/backlog/BRIDGE_MSDPS_BACKLOG.md`.
- Keputusan pemilik terkunci (D1–D16 + amandemen): `docs/DECISIONS.md` entri
  2026-09-10, amandemen D2 2026-09-12.
- Mesin status lengkap (Service, Strategy, Brief, dst.): `docs/STATE_MACHINES.md` §6–7.
- Sisi MSDPS — pensiun modul eksekusi lama & OKR baru:
  `MEAGO_MSDPS/docs/HANDOFF_PENSIUN_ACCOUNT_SERVICE_20260912.md`.
- Tutorial ringkas khusus tim MSDPS: `MEAGO_MSDPS/docs/TUTORIAL_BRIDGE_KE_CDPS.md`.
