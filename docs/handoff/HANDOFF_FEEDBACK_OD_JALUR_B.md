# Handoff — Jalur B (Delivery), perbaikan dari "Feedback Final - OD"

> Rencana induk: `docs/handoff/PARALEL_FEEDBACK_OD_DUA_AKUN.md` (disetujui pemilik
> 2026-09-07). Baca §0 sampai habis sebelum menyentuh apa pun.
>
> Berkas ini milik **Jalur B**. Tulis temuan, permintaan lintas-jalur, dan
> keputusan kecil di sini — **jangan sentuh `docs/DECISIONS.md`** (aturan emas #3;
> sentuhan terakhirnya sudah dipakai F-6). Langkah penggabungan (§4 rencana) yang
> memindahkan isinya ke DECISIONS.

## Titik cabang

Fondasi F sudah mendarat. **Bercabanglah dari SHA commit F**, bukan dari nama
branch — sesi Jalur A ditugaskan ke branch bernama lain daripada yang ditulis di
rencana (`claude/cdps-user-feedback-account-a-igix3n`), dan SHA-nya yang mengikat.

```
Commit fondasi F : (lihat "Isi F" di HANDOFF_FEEDBACK_OD_JALUR_A.md)
Branch Jalur B   : claude/cdps-user-feedback-70vbho-b
```

## Yang sudah disiapkan F untukmu

1. **Katalog notifikasi v15 — 4 event TERDAFTAR, emitter belum ada.** Itu aman
   dan disengaja (gate membandingkan NAMA event, bukan pemanggilnya). Nama yang
   dipanggil emitter B, apa adanya:

   | Event | Resolver | Ke siapa | Emitter yang harus dibangun |
   |---|---|---|---|
   | `m6.brief.siap_review_am` | `explicit` | AM pemilik klien | B-4 (QC internal lolos) |
   | `m6.brief.selesai` | `explicit` | AM pemilik klien | B-1b (`recomputeBriefRollup`) |
   | `m9.booking.jatuh_tempo` | `explicitOrLeads` | koordinator KOL + AM | B-3 (tick) |
   | `m9.campaign.mendekati_akhir` | `explicitOrLeads` | koordinator KOL + AM | B-3 (tick) |

   Konstanta TS: `EVENTS.BriefSiapReviewAm`, `EVENTS.BriefSelesai`,
   `EVENTS.BookingJatuhTempo`, `EVENTS.CampaignMendekatiAkhir`.

2. **Field wire sudah ada** — `BriefWire.client_id` / `client_nama` /
   `assigned_pic_nama`, dan `TransactionWire.toko`. Tipe FE
   (`lib/account.ts::Brief`, `lib/finance.ts::Transaction`) ikut dideklarasikan,
   jadi B-2 tinggal MERENDER; jangan tambah field wire untuk itu lagi.

3. **Kolom `briefs` sudah ada** (F-4, migrasi `20260922100200`):
   `tanggal_mulai date`, `tanggal_akhir date`, `budget numeric(18,2)`,
   `source_creative_brief_id varchar(32)` FK self-ref nullable. Tiga CHECK sudah
   di DB — jendela terurut (NULL satu sisi tetap lolos), budget ≥ 0, sumber ≠
   diri sendiri. **Jangan tulis ulang validasi itu di TS.**

4. **Anchor titik sisip milikmu:**
   - `apps/api/src/lib/wire.ts` → `ANCHOR-WIRE-DELIVERY`
   - `web-internal/src/lib/nav.ts` → `ANCHOR-NAV-DELIVERY`
   Jangan pakai anchor Keuangan; itu punya Jalur A dan letaknya ~2.400 baris
   jauhnya justru supaya kalian tidak pernah menyunting hunk yang sama.

## ⚠️ Perangkap O52 — dibuktikan ulang di repo ini, 2026-09-07

Satu Brief Creative, dibaca **sebagai lead Creative di bawah RLS**
(`SET LOCAL ROLE authenticated` + klaim `{division:'Creative',level:'lead'}`):

```
A. from briefs saja ............................ 1 baris
B. + join services + clients + employees ....... 0 baris   ← barisnya HILANG
C. + private.* (yang dipakai F-2) .............. 1 baris
```

Join-nya tidak membuat kolomnya null — ia **membuang barisnya**, jadi halaman
tampak KOSONG dan bukan salah. Kalau Jalur B butuh kolom dari
`services`/`clients`/`employees` di jalur baca divisi eksekusi, **pakai
`private.*`**. Yang sudah tersedia:

`brief_client_id` · `brief_client_toko` · `client_toko` · `service_client_id` ·
`brief_owner_am` · `service_owner_am` · `employee_display_name`

**Jangan bikin cara ketiga**, dan **jangan lebarkan `services_select` /
`clients_select`** — itu opsi (a) yang sudah ditolak pemilik 2026-08-07 (O52).
Catatan untuk B-5: `clients_select` SUDAH punya lengan
`(jwt_division() = 'Ads') AND private.jwt_client_has_ads_brief(id)`, jadi
Advertiser bisa membaca baris klien yang ia punya Brief Ads-nya — periksa dulu
sebelum menambah apa pun.

## Aturan counter

**JANGAN naikkan `notif_events`** — sudah di **73** di `scripts/db-rebuild.sh`
DAN `.github/workflows/ci.yml`, dinaikkan sekali di F-5. Kalau migrasi Jalur B
menambah TABEL / PREFIX / MESIN, itu baris counter yang berbeda (146 / 40 / 31),
dan saat menaikkannya: **rebase ke `main`, jalankan ulang
`scripts/db-rebuild.sh`, ambil angka yang SEBENARNYA.** Counter itu absolut,
bukan delta — jangan menebak saat resolusi konflik.

Stempel migrasi Jalur B: `…T20####`. Jalur A memakai `…T10####` dan sudah
memakai `20260922100000` (F-2) dan `20260922100200` (F-4).

## Catatan berkas bersama

`packages/domain/src/reads_rls.test.ts` **tidak punya pemilik** di §2 dan sudah
bertambah dua tes di F (Finance #1, Creative #3). Kalau menambah tes RLS di
situ: **tambahkan di UJUNG, jangan susun ulang isinya.**

## Temuan Jalur B (calon baris DECISIONS, dipindahkan di langkah penggabungan)

| # | Temuan | Status |
|---|---|---|

## Permintaan ke Jalur A (berkas milik A — JANGAN diedit dari sini)

_(belum ada)_

## Sisa pekerjaan Jalur B

| # | Item | Status |
|---|---|---|
| B-1 | Divisi bilang "done" tapi CRO tidak berubah — progres "n dari N" + emitter notifikasi | belum |
| B-2 | Leader lihat brand & PIC (render; kueri + wire sudah dibereskan F) | belum |
| B-3 | KOL: deadline, budget, pengingat (kolom sudah ada dari F-4) | belum |
| B-4 | Leader Creative boleh approve (K-1) — **menunggu A-5 mendarat** | belum |
| B-5 | Ads bisa menemukan aset (K-3) | belum |
