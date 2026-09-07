# Handoff — Jalur A (Uang & Klien), perbaikan dari "Feedback Final - OD"

> Rencana induk: `docs/handoff/PARALEL_FEEDBACK_OD_DUA_AKUN.md` (disetujui pemilik
> 2026-09-07). Baca §0 sampai habis sebelum menyentuh apa pun.
>
> Berkas ini adalah tempat Jalur A menulis temuan, permintaan lintas-jalur, dan
> keputusan kecil — **supaya `docs/DECISIONS.md` tidak disentuh lagi** setelah F-6
> (aturan emas #3). Langkah penggabungan (§4 rencana) yang memindahkan isinya ke
> DECISIONS.

## Commit fondasi F

```
Commit fondasi F : b240f47d   ← F-1..F-8 SELESAI, 2026-09-07
Branch Jalur A   : claude/cdps-user-feedback-account-a-igix3n
Branch Jalur B   : claude/cdps-user-feedback-70vbho-b (cabangkan dari b240f47d)
```

> ⚠️ **Catatan penamaan branch.** Rencana induk §0 menyebut branch
> `claude/cdps-user-feedback-70vbho` untuk F + Jalur A. Sesi ini ditugaskan ke
> `claude/cdps-user-feedback-account-a-igix3n` dan **tidak boleh push ke branch
> lain**, jadi F mendarat di branch itu. Yang penting bagi Jalur B hanyalah SHA
> commit F — bercabanglah dari SHA itu, bukan dari nama branch.

## Isi F (fondasi, sudah mendarat)

| # | Commit | Isi |
|---|---|---|
| F-2 (finance) | `25fb3f12` | `financeQueue` + `loadTransactionAggregate` `join clients` → `toko`. Commit PERTAMA, terkecil, berdiri sendiri (guard §0). |
| F-2 (account) | `0390aadb` | Migrasi `20260922100000` — empat fungsi `private.*`; `briefCols` membawa `client_id`/`client_nama`/`assigned_pic_nama` di SETIAP baca Brief. |
| F-1 | `aa908cbc` | `wire.ts`: `TransactionWire.toko` + tiga field `BriefWire`; **dua anchor** `ANCHOR-WIRE-KEUANGAN` / `ANCHOR-WIRE-DELIVERY`. Tipe FE ikut dideklarasikan. |
| F-3 + F-5 | `af12237a` | Katalog notifikasi **v15**, 4 event, SATU bump. Gate `notif_events` 69 → **73** di `db-rebuild.sh` DAN `ci.yml`. |
| F-4 | `2aa77ed6` | Migrasi `20260922100200` — `briefs`: `tanggal_mulai`, `tanggal_akhir`, `budget`, `source_creative_brief_id`. |
| F-6 | `352d9fb1` | `DECISIONS.md`: K-1…K-7, O57 (b) separuh ditutup, O75 + O76 baru. **Sentuhan terakhir ke DECISIONS.** |
| F-7 + F-8 | `b240f47d` | Dua anchor `nav.ts` + dua file handoff. |

### Yang Jalur B perlu tahu dari F

1. **Empat event katalog v15 sudah TERDAFTAR, emitternya belum ada.** Itu aman
   dan disengaja — gate katalog membandingkan NAMA event, bukan pemanggilnya.
   Nama yang harus dipanggil emitter Jalur B, apa adanya:
   - `m6.brief.siap_review_am` (resolver `explicit` → AM pemilik klien)
   - `m6.brief.selesai` (resolver `explicit` → AM pemilik klien)
   - `m9.booking.jatuh_tempo` (resolver `explicitOrLeads`)
   - `m9.campaign.mendekati_akhir` (resolver `explicitOrLeads`)
   Konstanta TS-nya `EVENTS.BriefSiapReviewAm`, `EVENTS.BriefSelesai`,
   `EVENTS.BookingJatuhTempo`, `EVENTS.CampaignMendekatiAkhir`.
2. **JANGAN naikkan counter apa pun.** `notif_events` sudah di 73 di kedua
   berkas. Kalau migrasi Jalur B menambah TABEL/PREFIX/MESIN, itu counter yang
   berbeda barisnya — dan saat menaikkannya: **rebase, jalankan ulang
   `scripts/db-rebuild.sh`, ambil angka yang SEBENARNYA.** Counter itu absolut,
   bukan delta.
3. **Kolom `briefs` dari F-4 sudah ada** — `tanggal_mulai`, `tanggal_akhir`,
   `budget` (`numeric(18,2)`), `source_creative_brief_id` (FK self-ref,
   nullable). Tiga CHECK sudah menjaganya (jendela terurut, budget ≥ 0, sumber ≠
   diri sendiri) — jangan tulis ulang validasi itu di TS, ia sudah di DB.
4. **Perangkap O52 sudah dibuktikan ulang di repo ini, hari ini.** Satu Brief
   Creative, dibaca sebagai lead Creative di bawah RLS: `from briefs` saja = 1
   baris; **+ `join services join clients join employees` = 0 baris**; +
   `private.*` = 1 baris. Kalau Jalur B butuh kolom dari `services`/`clients`/
   `employees` di jalur baca divisi eksekusi, **pakai `private.*`** — yang sudah
   tersedia: `brief_client_id`, `brief_client_toko`, `client_toko`,
   `service_client_id`, `brief_owner_am`, `service_owner_am`,
   `employee_display_name`. Jangan bikin cara ketiga, dan jangan lebarkan
   `services_select`/`clients_select` (itu opsi (a) yang sudah ditolak pemilik
   2026-08-07).
5. **Anchor.** `wire.ts` → sisip di `ANCHOR-WIRE-DELIVERY`. `nav.ts` → sisip di
   `ANCHOR-NAV-DELIVERY`. Jangan pakai anchor Keuangan.
6. **`reads_rls.test.ts` sekarang punya dua tes baru** (Finance #1 dan Creative
   #3). Kalau Jalur B menambah tes RLS di berkas itu: **tambahkan di ujung,
   jangan susun ulang** — berkas ini tidak punya pemilik di §2 dan itu satu-satunya
   cara membuatnya tidak jadi sesi merge-conflict.

## Temuan Jalur A (calon baris DECISIONS, dipindahkan di langkah penggabungan)

| # | Temuan | Status |
|---|---|---|
| A-T1 | **`join clients` di jalur Finance TIDAK mengulang O52** — `clients_select` yang HIDUP hari ini sudah punya lengan `jwt_division() = 'Finance'`, jauh lebih lebar daripada yang tertulis di `20260723064438_rls_baseline.sql`. Diverifikasi probe sebelum join ditulis, bukan dibaca dari berkas baseline. Pelajaran yang berlaku umum: **baca policy dari DB, jangan dari migrasi baseline** — sudah 190+ migrasi menumpuk di atasnya. | Ditutup di F-2. Dikunci tes (`reads_rls.test.ts` meng-assert premisnya juga, jadi ia gugur kalau policy berubah lagi). |
| A-T2 | **O57 (b) hanya separuh bisa ditutup K-2.** Bagian durasi: tertutup. Bagian floor GMV: TIDAK — katalog tidak memuat angka GMV dan `contracts` tidak punya kolom GMV sama sekali. Dicatat O76, tidak diputuskan sepihak. | Ditulis di F-6 (`DECISIONS.md` O76). **Butuh ketokan pemilik.** |
| A-T3 | **Service tidak punya jalur untuk SELESAI.** `[In Execution] → Done` ada di `sm_edges` tapi nol pemanggil di seluruh domain. | Dicatat O75 di F-6. **Butuh ketokan pemilik.** Di luar cakupan feedback. |

## Permintaan ke Jalur B (berkas milik B — JANGAN diedit dari sini)

_(belum ada)_

## Sisa pekerjaan Jalur A

| # | Item | Status |
|---|---|---|
| A-1 | Nama klien di antrean approval Finance (render) | belum |
| A-2 | Request pembayaran creator sampai ke Finance (+ migrasi RLS `…T10####`) | belum |
| A-3 | Status CRO mentok `[Awaiting Onboarding]` — jahitan STRG- → gerbang Brief | belum |
| A-4 | Durasi kerja sama pindah dari CRO ke closing Sales (K-2) | belum |
| A-5 | AM berhenti memilih nama staff Creative (K-1 sisi AM) — **memblokir B-4** | belum |
