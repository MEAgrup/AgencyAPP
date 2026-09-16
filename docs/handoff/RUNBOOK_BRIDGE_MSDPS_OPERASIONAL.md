# RUNBOOK — Bridge MSDPS→CDPS Fase 1: status live & tutorial operasional

> **Dibuat 2026-09-16.** Kode di **kedua** repo (`MEAgrup/AgencyAPP` Bagian A,
> `MEAgrup/MEAGO_MSDPS` Bagian B) sudah ✅ **SELESAI dan LIVE** — bukan lagi
> "belum selesai". Angka di bawah **diverifikasi langsung ke database produksi**
> (`CDPS SG` = `egddxfcnrtecheiykhlf`, `MSDPS` = `mvcckptntrvzujqaoxxh`) hari ini,
> bukan dikutip dari dokumen lama. `docs/backlog/BRIDGE_MSDPS_BACKLOG.md` §"Prasyarat
> go-live" ditulis 2026-09-10/11 dan **sudah usang** di beberapa baris — lihat
> catatan tambahan di bagian bawah berkas itu.
>
> **Untuk siapa berkas ini:** tim MSDPS (BD/CM/Finance MEAGO!) yang mengirim deal,
> dan tim CDPS (Account/Director MEA Agency) yang menerima & mengeksekusinya.
> Bukan berkas developer — untuk detail kontrak payload/kode, lihat
> `docs/BRIDGE_MSDPS_CONTRACT.md` dan `docs/backlog/BRIDGE_MSDPS_BACKLOG.md`.

---

## 1. Ringkasan 60 detik

**Apa ini.** MEAGO! (MSDPS) menutup deal dengan merchant POI (Dining, Hotel,
dst). Pekerjaan operasionalnya — Account, Ads, Creative, Store Operation,
Live Stream, KOL-Non-Roster — dikerjakan oleh tim MEA Agency di CDPS, bukan
di MEAGO. Bridge ini yang memindahkan deal dari MSDPS ke inbox CDPS, satu
arah, tanpa ketik ulang manual.

**Status per hari ini (2026-09-16), diverifikasi ke DB live:**

| Prasyarat go-live | Status | Bukti |
|---|---|---|
| Kode Bagian A (CDPS) | ✅ selesai | `docs/backlog/BRIDGE_MSDPS_BACKLOG.md` A1–A7 |
| Kode Bagian B (MSDPS) | ✅ selesai | `MEAGO_MSDPS/docs/BUILD_PLAN.md` baris Bridge |
| Paket MEAGO di Master Service List | ✅ **5 dari 6 jenis** dipetakan | lihat §2 |
| `external_service_map` terisi | ✅ 5 baris aktif | lihat §2 |
| Employee layanan "MEAGO Bridge" + env | ✅ `SVC-MEAGO-BRIDGE` aktif | lihat §2 |
| Transaksi Finance MSDPS pilot diverifikasi | ✅ `TRX-202609-0001` | lihat §3 |
| **Live Stream** dipetakan ke MSL | ⬜ **BELUM** | lihat §2, ini yang paling mendesak |
| Deal nyata mengalir ujung-ke-ujung | ✅ **1 deal** (`DEAL-202609-0078`) | lihat §3 |
| Exit criteria Fase 1 (5–10 deal) | ⬜ **1 dari 5–10**, belum tercapai | lihat §4 |
| UAT browser 3 aktor | ⬜ belum dijalankan | lihat §4 |

**Kesimpulan:** bridge-nya **sudah hidup dan sudah terbukti bekerja** untuk
satu deal nyata — ini bukan lagi status "belum selesai" dalam artian kode atau
konfigurasi. Yang tersisa adalah **operasional**: memetakan "Live Stream" (satu
baris data), dan menjalankan lebih banyak deal nyata sampai exit criteria Fase 1
(5–10 deal) terpenuhi, plus UAT browser yang belum sempat dijalankan manusia.
Bagian §5–§7 di bawah adalah tutorial detail untuk tim kedua sisi menjalankan
ini sehari-hari.

---

## 2. Detail verifikasi live — Master Service List & pemetaan

Query terhadap `CDPS SG` (project `egddxfcnrtecheiykhlf`) hari ini:

```sql
select external_service_type, master_service_id, aktif
from external_service_map order by id;
```

| `external_service_type` | `master_service_id` | aktif |
|---|---|---|
| Account | `MSV-202609-0002` | ✅ |
| Ads | `MSV-202609-0003` | ✅ |
| Creative | `MSV-202609-0004` | ✅ |
| Store Operation | `MSV-202609-0005` | ✅ |
| KOL-Non-Roster | `MSV-202609-0006` | ✅ |
| **Live Stream** | — | ⬜ **tidak ada baris** |

`jenis` bridge punya ENAM nilai sah sejak D2 dibalik 2026-09-12 (lihat
`docs/DECISIONS.md`), tapi baru **lima** yang punya paket MSL + pemetaan.
Selama baris "Live Stream" belum ada di `external_service_map`, **setiap**
order yang punya baris `jenis='Live Stream'` akan gagal di-Accept dengan pesan:

```
[layanan MEAGO belum dipetakan ke Master Service List]
```

Cara menutup celah ini ada di §7 di bawah — ini pekerjaan satu paket MSL +
satu pemetaan, nol kode.

Employee layanan (D5 opsi b — satu employee bersama, bukan sync per-BD):

```sql
select employee_id, nama, email, divisi, jabatan, status_aktif
from employees where employee_id = 'SVC-MEAGO-BRIDGE';
-- SVC-MEAGO-BRIDGE · "MEAGO Bridge (layanan)" · mcnmeadigital@gmail.com
-- · divisi Account · status_aktif = true
```

Ini sudah cocok dengan yang env `MEAGO_BRIDGE_EMPLOYEE_ID` (dibaca
`apps/api/src/app/api/v1/bridge/orders/[id]/accept/route.ts`) rujuk — kalau
tidak cocok, `accept()` akan gagal karena employee tidak ditemukan, dan deal
pilot §3 di bawah tidak akan pernah berhasil. Jadi env ini **sudah terbukti
benar di produksi**, tidak perlu diutak-atik lagi kecuali karyawan itu diganti.

---

## 3. Bukti deal pilot yang sudah berhasil

```sql
select id, external_deal_code, status, client_id, diterima_pada, diputus_pada
from external_orders;
```

| Field | Nilai |
|---|---|
| `id` (kode order) | `ORD-202609-0001` |
| `external_deal_code` | `DEAL-202609-0078` |
| merchant | "Salad Hut" (Dining) |
| baris (`jenis`) | 2× Account, 1× Creative, 1× Store Operation |
| `attestation.external_trx_ref` | `TRX-202609-0001` |
| `attestation.diverifikasi_pada` | 2026-09-12 06:14 UTC (Finance MSDPS) |
| `status` | `[Diterima]` |
| `client_id` hasil | `CLI-202609-0017` |
| diputuskan oleh | `200000001` (Director) pada 2026-09-12 06:29 UTC |

Ini deal **nyata**, bukan data uji — mengonfirmasi seluruh rantai: gerbang
D4+D13 di sisi MSDPS (trigger `deal_bridge_lines_gate`) → payload terkirim →
`bridge.accept()` di CDPS (resolusi MSL, buat/attach `CLI-`, `client_external_ref`,
`client_external_billing`, kontrak + `SVC-` per baris) → status `[Diterima]`.

`cdps_outbox` di sisi MSDPS mengonfirmasi angka yang sama: **1 baris,
`status='sent'`** — belum ada deal kedua yang dikirim.

---

## 4. Yang benar-benar tersisa (bukan kode)

1. **Paket "Live Stream" di MSL + pemetaan** (§2) — kalau ada deal berisi
   pekerjaan live-stream merchant MEAGO yang mau dibridge, ini blocker
   langsungnya. Lihat langkah di §7.
2. **Exit criteria Fase 1 belum tercapai**: rencana aslinya minta 5–10 deal
   nyata mengalir `DEAL-` → `ORD-` → `CLI-`/`SVC-`/`BRF-` dengan nol
   perbaikan DB manual dan idempotency terbukti (kirim-ganda sengaja). Baru 1.
   Ini murni soal **volume pemakaian nyata** oleh tim BD MEAGO (§5) dan tim
   Account CDPS (§6) — bukan sesuatu yang bisa "dikerjakan" lewat kode.
3. **UAT browser 3 aktor** (`scripts/browser-tour.mjs` sisi CDPS) belum
   dijalankan — sesi sandbox sebelumnya (baik di CDPS maupun MSDPS,
   `MEAGO_MSDPS/docs/UAT_PENSIUN_BROWSER_RUNBOOK.md`) diblokir kebijakan
   jaringan egress terhadap `*.supabase.co`. Perlu dijalankan manusia dari
   jaringan normal, bukan dari sesi Claude Code sandboxed.
4. **Latensi accept** — rencana asli minta ini diinstrumentasi sejak deal
   pertama untuk mengukur kapan gerbang D10 (lead Account + Director) perlu
   dilebarkan ke semua AM. Belum ada bukti dashboard/metrik untuk ini di kode
   yang diperiksa — kalau dibutuhkan, ini tiket kecil terpisah, bukan bagian
   dari "menyelesaikan bridge".

Item 2 dan 4 bukan pekerjaan yang bisa "diselesaikan sekali duduk" — itu
tercapai dengan cara tim kedua sisi memakainya untuk deal nyata berikutnya.
Karena itulah runbook ini juga berisi tutorial pemakaian di §5–§7: supaya
volume itu bisa mulai naik.

---

## 5. Tutorial — sisi MSDPS (BD/CM/Finance MEAGO!)

**Prasyarat sebelum sebuah deal bisa diteruskan:**
- Deal harus `bentuk_kerjasama = 'Berbayar'` (Free/Barter tidak pernah bisa
  dibridge — ini gerbang D4, dipaksa di level trigger, bukan pilihan UI).
- Deal harus sudah punya transaksi Finance yang **terverifikasi**
  (`transactions.released_to_account_at` terisi) — gerbang D13. Kalau deal
  belum punya transaksi sama sekali, tombol **"Buat Transaksi Finance"**
  muncul dulu di baris deal itu (B0, `create_poi_finance()`); sekali dibuat,
  tombol itu hilang (tidak bisa dobel).
- Selama salah satu syarat di atas belum terpenuhi, tombol "Teruskan ke CDPS"
  di baris deal itu **tidak akan pernah muncul/berhasil** — ini gerbang di
  sumber, bukan sesuatu yang bisa dilewati dari UI.

**Langkah:**
1. Buka `/deals`, cari deal yang sudah Berbayar + terverifikasi.
2. Klik **"Teruskan ke CDPS"**.
3. Di modal: pilih satu atau lebih baris **jenis** pekerjaan — `Account`,
   `Ads`, `Creative`, `Store Operation`, `KOL-Non-Roster`, atau `Live Stream`.
   Satu deal bisa punya beberapa baris jenis berbeda (mis. Account + Creative)
   kalau paketnya membundel beberapa pekerjaan.
4. Isi per baris: `qty`, `catatan` (opsional), `nilai_cross_charge` (opsional
   — panel referensi harga di modal membantu mengetik ini, tidak mengisi
   otomatis). Untuk `KOL-Non-Roster`, **`alasan_non_roster` wajib** — modal
   akan menolak submit tanpa itu.
5. Submit. Baris tersimpan sebagai `deal_bridge_lines`. **Satu order per deal
   seumur Fase 1** — kalau nanti perlu menambah baris jenis lain untuk deal
   yang sama, itu belum didukung Fase 1 (`cdps_outbox_deal_id_uniq`); hubungi
   tim CDPS dulu sebelum mengulang submit untuk deal yang sama.
6. Pengiriman ke CDPS **tidak instan** — job pengiriman jalan tiap **10
   menit** (`vercel.json` cron `*/10 * * * *`). Badge status di baris deal
   berubah begitu terkirim.
7. Kalau gagal terkirim: retry otomatis dengan backoff eksponensial, sampai
   5 percobaan; sesudah itu masuk `platform_alerts` sebagai dead-letter dan
   perlu diperiksa manual (hubungi tim teknis, bawa kode deal-nya).

**Yang TIDAK pernah dikirim lewat bridge ini** (supaya tidak salah ekspektasi):
kebutuhan kreator/konten (`kreator_needed`/`konten_needed`), jadwal visit,
laporan VT — semua itu tetap di MEAGO/MCN MEA, tidak ada jalur callback balik
dari CDPS di Fase 1.

---

## 6. Tutorial — sisi CDPS (Account/Director MEA Agency)

**Ke mana:** menu **Keuangan → "Bridge MSDPS (MEAGO!)"** di web-internal
(`/bridge/inbox`). Terlihat untuk lead Account, Director, dan OD (OD hanya
baca).

**Langkah:**
1. Buka `/bridge/inbox` — daftar order berstatus `[Masuk]` (toggle untuk
   lihat riwayat yang sudah diputus).
2. Klik satu order untuk buka detail: payload asli terbaca apa adanya
   (merchant, atestasi pembayaran, baris jenis pekerjaan), plus **kandidat
   client** yang mungkin cocok (dedup otomatis 3-tingkat — sistem **tidak
   pernah** auto-pilih, keputusan tetap manual).
3. Isi **empat field manual** yang memang tidak dikirim MSDPS (D7 — datanya
   beda definisi di kedua sistem, sengaja tidak diwariskan mentah):
   `link toko`, `kategori`, `GMV baseline`, `target GMV`.
4. Pilih **Accept** atau **Reject**.
   - **Accept**: sistem otomatis — attach ke client lama (kalau kandidat
     dipilih) atau buat `CLI-` baru, catat `client_external_ref` +
     `client_external_billing` (atestasi pembayaran, append-only, tidak
     bisa diedit/dihapus siapa pun), buat/perpanjang kontrak, buat `SVC-`
     per baris jenis (bertanda `sumber='meago'` supaya tidak ikut hitung
     GMV/komisi/tutup-buku milik AM CDPS biasa — house rule anti-drift).
     Order jadi `[Diterima]`.
   - **Reject**: order jadi `[Ditolak]`, nol perubahan data client.
5. Kalau Accept gagal dengan pesan
   `[layanan MEAGO belum dipetakan ke Master Service List]`: itu bukan bug —
   artinya salah satu `jenis` di baris order itu belum punya padanan di
   `external_service_map` (lihat status "Live Stream" di §2). Eskalasi ke
   Director/Sales Head untuk melengkapi paket MSL-nya (§7), baru coba Accept
   lagi — order tetap tersimpan menunggu, tidak hilang.

**Siapa boleh apa:** Accept/Reject hanya lead Account atau Director (D10).
OD melihat semuanya tapi tombolnya tidak aktif untuknya. Ini digerbang di
server, bukan cuma disembunyikan di UI.

---

## 7. Tutorial — melengkapi paket MSL & pemetaan (Director / Sales Head / Head Account)

Ini kerja **data**, bukan kode, dan **tidak ada layar admin khusus** untuk
langkah kedua di bawah ini hari ini — dicatat sebagai catatan, bukan
dikerjakan diam-diam:

1. **Buat paket di Master Service List** — `/master-services`, seperti
   membuat paket layanan biasa (nama, harga, dsb). Tidak ada flag khusus
   "ini paket MEAGO" — `sumber='meago'` ditulis otomatis oleh `accept()` ke
   `services`, bukan dipilih di layar MSL.
2. **Petakan `external_service_type` ke paket itu.** **Belum ada halaman UI**
   untuk ini — hanya API, Director-only:
   ```
   POST /api/v1/admin/external-service-map
   Authorization: Bearer <JWT Director>
   Content-Type: application/json

   { "external_service_type": "Live Stream", "master_service_id": "MSV-...", "aktif": true }
   ```
   Isi `master_service_id` dengan ID paket yang baru dibuat di langkah 1
   (lihat responsnya, atau `GET /api/v1/admin/external-service-map` untuk
   lihat baris yang sudah ada sebagai contoh bentuk). Kalau tidak ada akses
   memanggil API langsung (Postman/curl), minta tim teknis membantu sekali
   jalan — dan pertimbangkan menambah tiket UI admin kecil untuk layar ini
   supaya langkah ini tidak terus bergantung API mentah.
3. Nonaktifkan pemetaan lama (tanpa menghapus) lewat
   `POST /api/v1/admin/external-service-map/{id}/deactivate` kalau paketnya
   diganti — baris lama tidak pernah dihapus (house rule imutabilitas).

---

## 8. Referensi

- Kontrak payload lengkap: `docs/BRIDGE_MSDPS_CONTRACT.md` + fixture
  `docs/fixtures/bridge_order_v1.json` (identik di kedua repo).
- Rincian teknis per ticket (A1–A7, B0–B6): `docs/backlog/BRIDGE_MSDPS_BACKLOG.md`.
- Keputusan pemilik terkunci (D1–D16 + amandemen): `docs/DECISIONS.md` entri
  2026-09-10, amandemen D2 2026-09-12.
- Sisi MSDPS — pensiun modul eksekusi lama & OKR baru:
  `MEAGO_MSDPS/docs/HANDOFF_PENSIUN_ACCOUNT_SERVICE_20260912.md`.
- UAT browser yang masih tertunda: `MEAGO_MSDPS/docs/UAT_PENSIUN_BROWSER_RUNBOOK.md`
  (8 halaman nisan + jalur "Teruskan ke CDPS") dan `scripts/browser-tour.mjs`
  sisi CDPS (3 aktor: BD MSDPS, Account CDPS, Director).
