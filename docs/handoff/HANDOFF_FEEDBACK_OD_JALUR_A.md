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

## ⚠️ Irisan dengan pekerjaan lain — diperiksa 2026-09-07, dilaporkan ke pemilik

Guard §0 memerintahkan mencocokkan PR/branch yang berjalan dengan tabel kepemilikan
§2. Saat F mendarat: **nol PR terbuka**. Sesudah itu muncul branch
`claude/handoff-gelombang-d-lanjutan-m3qc8n` (satu commit, `10ffa19a` —
"D-KOM `pengakuan` di katalog + mesin accrual Gelombang D"). Itu memang pekerjaan
yang diperingatkan §0. Irisannya dipetakan, **bukan di-merge buta**:

| Berkas | Mereka | Jalur A (F) | Putusan |
|---|---|---|---|
| `docs/DECISIONS.md` | +6 baris | F-6 | 🔴 **AKAN konflik.** Keduanya menyisip di anchor yang SAMA (tepat sesudah `\|---\|---\|---\|---\|` di tabel `Decided`, dan sesudah header tabel `Open`). Keduanya **murni penyisipan** ⇒ resolusinya *simpan KEDUANYA*, nol baris dibuang. Ini pekerjaan langkah penggabungan (§4 butir 3), bukan pekerjaan di dalam jalur. |
| `apps/api/src/lib/wire.ts` | +3 (`MasterServiceWire`, baris ~33–60) | F-1 (`BriefWire` ~446, `TransactionWire` ~2860) | 🟢 Bersih. Jaraknya ~400 dan ~2.800 baris; git menggabungnya sendiri. |
| `apps/api/src/lib/wire.test.ts` | +2 (blok master-service) | F-1 (blok Brief) | 🟢 Bersih. |
| `packages/core/**` | `accrual.ts` (BARU) + `index.ts` +4 | F-3 (`notification.ts`, `notification.test.ts`) | 🟢 Berkas berbeda. Guard §0 butir 2 dipatuhi: F tidak menyentuh `packages/core` selain katalog notifikasi. |
| `scripts/db-rebuild.sh` · `.github/workflows/ci.yml` | **tidak disentuh** | F-5 (`notif_events` 69 → 73) | 🟢 **Nol konflik counter** — mereka menambah KOLOM, bukan tabel/mesin/event. |
| `supabase/migrations/` | `20260922010000` | `20260922100000`, `20260922100200` | 🟢 Nol tabrakan nama; punya mereka menyortir LEBIH DULU. Blok stempel §0 butir 7 bekerja. |

**Satu hal yang perlu dilihat saat menggabungkan:** commit mereka menyebut
migrasinya "migrasi **190**". Di pohon Jalur A, 190/191/192 adalah migrasi F.
Angka urutan itu narasi per-pohon, bukan identitas — **identitasnya nama berkas**,
dan nama berkasnya tidak bertabrakan. Jangan mencoba "membetulkan" salah satu
nomor; keduanya benar di pohonnya masing-masing.

## Temuan Jalur A (calon baris DECISIONS, dipindahkan di langkah penggabungan)

| # | Temuan | Status |
|---|---|---|
| A-T1 | **`join clients` di jalur Finance TIDAK mengulang O52** — `clients_select` yang HIDUP hari ini sudah punya lengan `jwt_division() = 'Finance'`, jauh lebih lebar daripada yang tertulis di `20260723064438_rls_baseline.sql`. Diverifikasi probe sebelum join ditulis, bukan dibaca dari berkas baseline. Pelajaran yang berlaku umum: **baca policy dari DB, jangan dari migrasi baseline** — sudah 190+ migrasi menumpuk di atasnya. | Ditutup di F-2. Dikunci tes (`reads_rls.test.ts` meng-assert premisnya juga, jadi ia gugur kalau policy berubah lagi). |
| A-T2 | **O57 (b) hanya separuh bisa ditutup K-2.** Bagian durasi: tertutup. Bagian floor GMV: TIDAK — katalog tidak memuat angka GMV dan `contracts` tidak punya kolom GMV sama sekali. Dicatat O76, tidak diputuskan sepihak. | Ditulis di F-6 (`DECISIONS.md` O76). **Butuh ketokan pemilik.** |
| A-T5 | **Lead Finance sama butanya dengan staf** terhadap CPR yang belum ia sentuh. Rencana A-2 menulis "staf Finance", tapi probe menunjukkan `jwt_is_lead()` tidak menolong sama sekali — `creator_payment_requests_select` tidak punya lengan divisi apa pun. Karena itu lengan yang ditambahkan **tidak** dibatasi ke lead: `public.jwt_division() = 'Finance'` saja. Membatasinya ke lead akan meninggalkan cacat yang sama untuk staf yang justru mengerjakan antreannya sehari-hari, dan `req.canProcess` memang sengaja membuka Creator Payment Approval ke Finance SEBAGAI DIVISI. | Ditutup di A-2, dikunci tes (`reads_rls.test.ts`, ikut meng-assert lead). |
| A-T6 | **`brief_id` dan `cpr_id` tidak pernah dicocokkan satu sama lain** pada `createPermintaan`. Sebuah REQ- bisa lahir menunjuk CPR klien A dengan `brief_id` klien B — dan `client_id`-nya ikut yang SALAH, artinya Finance menagih klien yang salah. Ditemukan saat mengerjakan A-2, bukan bagian keluhan. | Ditutup di A-2: untuk CPA, parent-nya **diturunkan dari CPR** (`resolveParent` jalur ketiga), jadi ketidakcocokan itu mustahil, bukan cuma tak disengaja. `brief_id` eksplisit tetap menang bila dikirim, supaya jalur lama nol perubahan perilaku. |
| A-T7 | **Tidak ada gerbang pengajuan ganda.** Tombol "Ajukan ke Finance" yang ditekan dua kali (atau dua orang KOL di dua tab) akan menaruh DUA baris untuk pembayaran yang SAMA di antrean Finance. Ini cacat yang HAMPIR gw ciptakan sendiri lewat A-2, bukan cacat lama. | Ditutup di A-2: `MSG_CPA_SUDAH_BERJALAN` (409), diperiksa DI DALAM transaksi insert-nya. Yang `[Ditolak]` sengaja TIDAK menghalangi — penolakan sering karena rekening salah, dan memblokir perbaikannya akan mematikan pembayaran creator. |
| A-T4 | **`admin.test.ts` "hari libur" tidak tahan dijalankan dua kali** atas DB yang sama: ia meng-assert `count(*) = 1` atas `audit_log` tanpa aktor unik, jadi jalan kedua melihat 7. `audit_log` menolak DELETE, jadi `afterEach` tidak bisa membersihkannya. Bukan bug produksi, dan **bukan** disebabkan A-5 — dibuktikan dengan `db-rebuild` lalu jalan ulang: 1991 lulus. Tapi ia memakan satu siklus dan akan memakan siklus Jalur B juga. Perbaikannya sudah ada polanya di repo: `aktorUnik()` (`showcase.test.ts`). | Belum diperbaiki — **di luar cakupan feedback OD**, dicatat supaya tidak dikira regresi. Kalau muncul: `db-rebuild` dulu, baru cari bug. |
| A-T3 | **Service tidak punya jalur untuk SELESAI.** `[In Execution] → Done` ada di `sm_edges` tapi nol pemanggil di seluruh domain. | Dicatat O75 di F-6. **Butuh ketokan pemilik.** Di luar cakupan feedback. |
| A-T8 | **K-2 dan Q3 saling menimpa soal qty, dan bacaan harfiah K-2 memendekkan kontrak.** K-2 menyebut sumber durasi `MAX(master_service_versions.durasi_bulan)`. Ketokan **Q3** (hari yang sama, pemilik yang sama) menyatakan `qty_menambah = 'durasi'` berarti **durasi total = qty × durasi_bulan** — contohnya sendiri "GMV Max beli 3 = 3 bulan". Dibaca harfiah, klien yang membeli 6 bulan GMV Max mendapat kontrak **1 bulan**, dan M6B melahirkan 1 periode Plan untuk kerja sama 6 bulan. A-4 karena itu memakai **MAX atas durasi EFEKTIF per baris** (qty dikalikan hanya untuk `qty_menambah = 'durasi'`). | ⚠️ **Butuh ketokan pemilik.** Kembali ke bacaan harfiah = **menghapus satu perkalian** di `sales.deriveDurasiBulan`, nol perubahan lain. Tesnya sudah memisahkan kedua kasus (`volume` tidak dikalikan, `durasi` dikalikan), jadi ketokan mana pun tinggal dipilih. |
| A-T9 | **`durasi_bulan` NULL = "sekali jadi" (Q4), jadi ada closing yang SAH tanpa jendela kontrak.** Basket yang seluruh layanannya sekali-jadi tidak mencetak baris `contracts` sama sekali — bukan kontrak 1 bulan karangan. `ClosingResult.contractId` karena itu nullable. Override Sales tetap bisa memberinya jendela kalau memang ada retainer yang disepakati terpisah. | Ditutup di A-4, dikunci tes. Tidak butuh ketokan; dicatat supaya tidak dikira bug saat ada klien tanpa `CTR-`. |
| A-T10 | **Turunan durasi bisa melebihi batas kontrak CDPS.** `ck_contracts_durasi` = 1..36; sebuah layanan `qty_menambah='durasi'` yang dibeli 40 unit menghasilkan 40. A-4 **membatasi ke 36 dan MENGATAKANNYA** (di `contracts.catatan` DAN baris audit) alih-alih menggagalkan closing — kehilangan deal yang sudah ditandatangani karena keanehan katalog adalah kerugian yang lebih besar daripada jendela yang terpotong dan tercatat. | Ditutup di A-4, dikunci tes. Kalau pemilik ingin closing GAGAL di kasus itu, ubah `Math.min` jadi lemparan — satu baris. |
| A-T11 | **`count(*)` atas unit kerja Brief SALAH di bawah RLS, dan salahnya tidak terlihat.** Policy hidup: `assets_select` hanya membuka ke PIC/pembuat aset + LEAD divisi pemilik Brief; `creator_bookings_select` **tidak punya lengan divisi sama sekali**. Jadi lead KOL membaca "0 dari 8" atas Brief divisinya sendiri, dan lead Account membaca "0 dari 12" — angka yang terlihat benar, tidak seperti layar kosong yang terlihat rusak. | Ditutup di A-req-3 lewat `private.brief_created_count` (O52 opsi (b), migrasi `20260922100500`), nol policy dilebarkan. Dikunci tes RLS yang meng-assert PREMIS-nya lebih dulu, jadi ia gugur kalau policy dilebarkan alih-alih lulus karena alasan yang salah. |
| A-T12 | **Sisa keluarga cacat yang sama, DI LUAR cakupan:** `creator_bookings_select` yang tanpa lengan divisi itu bukan hanya soal berhitung — AM pemilik klien dan lead KOL sama-sama tidak bisa MEMBUKA Booking-nya (404). Ini persisnya temuan pre-existing #2 Jalur B, dan bentuk perbaikannya sama dengan B-D4. | **Tidak ditambal**, di luar cakupan feedback OD. Dicatat supaya tidak hilang bersama tiket ini. |

## ⚠️ Utang UAT mata manusia

Rencana §6 menutup dengan peringatan yang lahir dari Gelombang C: *lolos `tsc` +
`vitest` + `next build` tapi tata letaknya tidak pernah dilihat siapa pun.* Utang
itu **belum dibayar** untuk perubahan render Jalur A, dan ditulis di sini supaya
tidak lewat:

| Yang perlu dilihat | Halaman | Penguji yang tepat |
|---|---|---|
| Nama toko jadi baris pertama, `CLI-…` baris kedua — muat di lebar kolom, tidak membuat baris tabel jadi dua kali tinggi | `/finance` | Finance (yang menulis keluhan #1) |
| Header transaksi: `Klien: Nama Toko (CLI-…)` | `/finance/transactions/{id}` | Finance |
| Catatan pengganti field PIC di form Brief — terbaca sebagai penjelasan, bukan sebagai error | `/account/services/{id}` | AM/CRO (keluhan Account #2) |
| Panel "Permintaan ke Finance" — 8 kolom, muat tanpa scroll horizontal; tombol Proses/Selesai/Tolak | `/finance` | Finance (keluhan #2) |
| Kartu "Permintaan ke Finance" di antrean persetujuan | `/persetujuan` | Finance |
| Tombol "Ajukan ke Finance" | `/kol/payment-requests/{id}` | KOL |

**Kenapa belum dilakukan di sesi ini, apa adanya:** repo ini tidak punya harness
peramban (nol Playwright di `scripts/` dan `package.json`; screenshot yang ada di
`docs/handoff/screenshots/` dibuat manual), dan menegakkan auth + API + dev server
hanya untuk memotret satu sel tabel bukan biaya yang sepadan di dalam sesi ini.
Yang SUDAH dibuktikan: `tsc` bersih, `next build` sukses dengan halaman-halaman itu
ikut ter-compile, dan rantai datanya utuh dari kueri sampai kunci wire (ada tes per
mata rantai). Yang BELUM: ada mata yang melihatnya.

Markup-nya sengaja dijaga rendah risiko: satu `<Link>` plus satu
`<div className="muted">` di dalam `<td>` yang sudah ada — pola yang sudah dipakai
di halaman yang sama (panel perubahan skema, baris 94) dan di `EmployeePicker`.

## Penyimpangan dari rencana (A-2) — keduanya disengaja

**1. Nol entri nav baru.** Rencana A-2 meminta "entri nav di anchor Keuangan".
Tidak gw tambahkan, karena antrean Permintaan Finance **sudah terjangkau dari nav
lewat DUA entri yang ada**: `/finance` (grup Keuangan — panelnya di situ) dan
`/persetujuan` (`ownedBy(SALES, ACCOUNT, FINANCE, KOL)` — sumber ke-9 di situ).
Entri ketiga akan menunjuk `/finance` yang sama, jadi ia menambah kekacauan nav
tanpa menambah satu pun jalur baru, dan memaksa `ALL_HREFS` di `nav.test.ts`
berubah untuk tautan duplikat. Maksud rencananya — **queue-nya harus terjangkau**
— sudah terpenuhi. Anchor `ANCHOR-NAV-KEUANGAN` tetap dipasang di F-7 dan tetap
kosong, siap dipakai kalau nanti ada halaman Keuangan yang benar-benar baru.

**2. `permintaanCols` — projeksi bersama, bukan tiga salinan.** Rencana tidak
menyebut refactor ini, tapi daftar kolom Permintaan disalin di **tiga** tempat
(`getPermintaan`, `listPermintaanForClient`, `listPermintaanQueue`), dan tiga
salinan adalah cara paling andal membuat satu field baru hadir di sebagian baca
dan hilang di sebagian lain — kelas O43 (halaman kosong walau route 200). Jadi
ketiganya disatukan lebih dulu, baru field barunya ditambahkan sekali.

`lockPermintaan` **sengaja tidak** memakai projeksi itu: baris yang dikunci harus
di-`select ... for update` dari tabel aslinya, dan `for update` tidak bisa
digabung dengan panggilan `private.*` yang STABLE plus subquery berkorelasi —
catatan O52 sendiri menyatakan jalur tulis dibiarkan dengan kuncinya. Gantinya
`permintaanIdentity()`, pola yang sama dengan `briefIdentity()` di F-2. Tanpa itu
`POST /permintaan/{id}/proses` akan menjawab 200 dengan `toko: ''` dan baris yang
baru saja ditindak Finance akan **kosong di tempat**.

## Permintaan ke Jalur B (berkas milik B — JANGAN diedit dari sini)

### Nol permintaan. Tiga pintu yang diminta Jalur B sudah TERBUKA.

`A-req-1` · `A-req-2` · `A-req-3` selesai, dan ketiganya aditif — nol perubahan
yang dibutuhkan di berkas Jalur B untuk membuatnya bekerja. Bentuk yang sudah
tersedia, apa adanya:

| Jalur B butuh | Bentuknya sekarang |
|---|---|
| B-3 — jendela + budget sebagai kolom sungguhan | `BriefInput.tanggalMulai` / `.tanggalAkhir` / `.budget` (string desimal mentah). Wire: `tanggal_mulai` · `tanggal_akhir` · `budget` · **`budget_display`** (sudah berformat `Rp. X.XXX.XXX,00`, aturan #7 — jangan format ulang). Cabang (c) `kol_reminder_tick` yang sudah MEMBACA `briefs.tanggal_akhir` langsung hidup begitu ada yang mengisinya. |
| B-5 — pengisian `source_creative_brief_id` | `BriefInput.sourceCreativeBriefId`, diisi AM lewat picker di form Brief (muncul hanya saat divisi tujuan = Ads). Filter K-3 di `ads.Campaign.sourceCreativeBriefId` hidup tanpa perubahan di Jalur B. |
| B-1a — pembilang "n dari N" di ANTREAN | `BriefWire.created_count` (dan `account.Brief.createdCount`). Penyebutnya `quantity_target` yang sudah ada. **Jangan** ganti dengan `count(*)` sendiri — lihat A-T11. |

Tiga hal yang perlu Jalur B tahu supaya tidak bertabrakan:

1. **`brief-inherit.ts` TIDAK disentuh** (berkas Jalur B, §2). `BriefInput`-nya
   sekarang menerima ketiga field; yang memindahkan budget keluar dari teks
   `instructions` (`brief-inherit.ts:181`) adalah Jalur B.
2. **`briefToWire` bertambah 5 kunci** (`tanggal_mulai`, `tanggal_akhir`,
   `budget`, `budget_display`, `created_count`, `source_creative_brief_id`).
   Semuanya nol omitempty. Keempat tipe `Brief` FE milik Jalur B perlu ikut
   mendeklarasikannya kalau halamannya mau membacanya — `web-internal/src/lib/account.ts`
   sudah, sisanya milik Jalur B.
3. **`account.listClientBriefs` + `GET /clients/{id}/briefs?division=` baru.**
   Client-scoped daftar Brief, dipakai picker A-req-2. Kalau Jalur B butuh
   daftar Brief per klien, pakai ini — jangan bikin rute kedua.

## Sisa pekerjaan Jalur A

| # | Item | Status |
|---|---|---|
| A-1 | Nama klien di antrean approval Finance (render) | ✅ **SELESAI** — ⚠️ **utang UAT mata manusia**, lihat di bawah |
| A-2 | Request pembayaran creator sampai ke Finance (+ migrasi RLS `…T10####`) | ✅ **SELESAI** — dua penyimpangan dari rencana, dicatat di bawah |
| A-3 | Status CRO mentok `[Awaiting Onboarding]` — jahitan STRG- → gerbang Brief | ✅ **SELESAI** (`9e44f3e`) — lihat §"A-3 selesai" |
| A-4 | Durasi kerja sama pindah dari CRO ke closing Sales (K-2) | ✅ **SELESAI** (`0c8a9a0`) — ⚠️ satu tafsir butuh ketokan, A-T8 |
| A-5 | AM berhenti memilih nama staff Creative (K-1 sisi AM) — **memblokir B-4** | ✅ **SELESAI** — lihat di bawah |
| A-req-1 | `BriefInput` + `Brief` membawa `tanggalMulai`/`tanggalAkhir`/`budget` (mengunci sisa B-3) | ✅ **SELESAI** (`897de64`) |
| A-req-2 | `createBrief` mengisi `source_creative_brief_id` + picker-nya (mengunci sisa B-5) | ✅ **SELESAI** (`b586fb3`) |
| A-req-3 | `created_count` pada baris antrean divisi (mengunci sisa B-1a) | ✅ **SELESAI** (`897de64`) |

**Jalur A TUTUP.** Yang tersisa dari rencana induk: penggabungan Jalur B (PR
#312) lalu Wave 3 Store Operation, plus utang UAT mata manusia di bawah.

### A-3 selesai — jahitannya ada TIGA bagian, bukan dua

Yang penting untuk pembaca berikutnya, karena dua bagian pertama saja tidak
memperbaiki apa pun:

1. `strategi.approveStrategi` mendorong Service `[Awaiting Onboarding]` →
   `[Strategy Approved]` di transaksi yang sama, lewat
   `account.advanceServicesToStrategyApproved`. **Lewat `contract_id`**, bukan
   satu Service: O57 memindahkan Strategi ke perjanjian, dan satu kontrak bisa
   menaungi beberapa layanan yang dibeli. Idempoten per baris ⇒ menyetujui
   revisi (Rule 13) atas Service yang sudah `[Briefed]` adalah no-op, bukan edge
   tak sah yang menggulung balik seluruh persetujuan.
2. `account.guardBriefCreation` menerima STRG- `Aktif` sebagai **dinding kedua**
   (`account.hasActiveStrategi`), untuk baris yang statusnya gagal bergerak.
3. **`resolveBriefStrategy` — bagian yang hampir terlewat.** Membuka gerbang di
   (2) saja hanya MEMINDAHKAN penolakan tiga baris ke bawah: Service plan-gated
   di jalur M6A punya NOL baris `strategy_plans`, jadi fungsi itu melempar
   `MSG_STRATEGY_REQUIRED` yang persis sama. Brief di jalur ini lahir tanpa
   `strategy_id` MAUPUN `plan_row_id` — bentuk yang sudah dipakai Brief Direct.

Backfill baris lama: `20260922100400`, lewat `sm_transition` beraktor `SISTEM`
(bukan `UPDATE` mentah — aturan rumah #2/#3; setiap metrik durasi diturunkan
dari stempel waktu baris audit itu). Tanpa backfill, perbaikan ini nol dampak
untuk klien yang sudah berjalan: sebuah Strategi `Aktif` tidak bisa kembali ke
`Diajukan`, jadi tidak ada "setujui ulang".

**Tes jahitannya** (§6 rencana meminta ini eksplisit): `strategi.test.ts` blok
`A-3` — approve STRG- → `createBrief` → bukan 409, satu tes yang memanggil KEDUA
sisi sungguhan. Dibuktikan tidak vacuous: dengan lengan STRG- di
`resolveBriefStrategy` dimatikan, tepat **3 tes jahitan merah, 5 tes batas tetap
hijau** — termasuk tes (1) yang tetap HIJAU, yang justru buktinya bahwa
memindahkan status Service saja tidak cukup.

### A-5 SUDAH MENDARAT — Jalur B boleh mulai B-4

Sisi AM K-1 sudah tertutup, jadi **B-4 tidak diblokir lagi.** Yang perlu Jalur B
tahu supaya sisi leader-nya nyambung, bukan bertumbukan:

- **Pintu penetapan PIC yang benar SUDAH ADA dan sudah digerbangi** —
  `task.assignPic` (Brief) dan `task.assignAssetPic` (Asset), keduanya lewat
  `canManageTask(actor, division)` = lead/SPV divisi tujuan atau Director, plus
  `validatePicForDivision` (staff AKTIF divisi itu, lewat `role_mappings`).
  **Jangan bangun pintu kedua untuk B-4** — itu yang dipakai leader membagi ke
  PIC per-Asset.
- **Server MENOLAK `assigned_pic` pada pembuatan Brief**, pesannya
  `MSG_PIC_BUKAN_WEWENANG_AM` =
  `[PIC ditetapkan lead divisi tujuan setelah Brief diterima, bukan saat Brief dibuat]`.
  Ditolak, bukan diabaikan — kalau ada kode Jalur B yang mengirim `assigned_pic`
  saat membuat Brief (mis. lewat `brief-inherit` atau form mana pun), ia akan
  GAGAL, bukan diam-diam kehilangan nilainya.
- **Kolom `briefs.assigned_pic` TETAP HIDUP.** Yang ditutup hanya pintu masuk
  sisi AM. `ads.canFileWeeklyReport` masih membacanya, dan `brief-inherit`
  memang tidak pernah mengisinya (diperiksa, bukan diasumsikan).
- **Brief kini sah lahir tanpa PIC** (`assignedPic === ''`), dan itu keadaan
  normal sekarang — bukan data yang kurang. Kalau layar Jalur B menampilkan PIC,
  render `—`, jangan `undefined` dan jangan anggap error.

---

## Konfirmasi ke Jalur B — `briefs_select` TIDAK ditambal dua kali

Jalur B menambal `briefs_select` (arm staff divisi pelaksana) sendiri di migrasi
`20260922200400`, PR #312. **Diperiksa terhadap rencana A-3/A-4: nol tabrakan.**

- A-3 tidak menyentuh satu pun policy. Ia menyentuh `sm_edges` (tidak, bahkan
  itu tidak — edge `service: [Awaiting Onboarding] → [Strategy Approved]` sudah
  ada sejak `20260723055732`), dua fungsi domain, dan satu backfill lewat
  `sm_transition`.
- A-4 tidak menyentuh satu pun policy.
- Migrasi Jalur A di sesi ini: `20260922100400` (backfill A-3, nol DDL) dan
  `20260922100500` (satu fungsi `private.*`, A-req-3). **Nol `CREATE POLICY`,
  nol `ALTER POLICY`, di kedua berkas.**
- Stempel `…T10####` dipatuhi; `…T20####` milik Jalur B tidak disentuh.

Konsekuensi arm itu yang RELEVAN bagi Jalur A, dicatat supaya tidak hilang: satu
tes RLS A-req-3 yang seharusnya paling langsung — "staff divisi membaca 3 dari
12" — **tidak bisa ditulis di branch ini**, karena tanpa arm Jalur B staff
Creative tidak bisa membaca baris Brief-nya sama sekali. Tesnya karena itu
ditulis dari dua kursi lain yang sama-sama salah hitung tanpa
`private.brief_created_count` (lead KOL dan lead Account). **Sesudah PR #312
mendarat, tambahkan kursi staff-divisi ke `reads_rls.test.ts`** — satu `it`,
polanya sudah ada persis di sebelahnya.

## Rebase ke `main` — Gelombang D mendarat di tengah sesi ini

`main` bergerak dari `e8cee053` ke **`1fee983`** (PR #309 — mesin accrual +
D-KOM `pengakuan` + **D-4 PPN per invoice**) sementara sesi ini berjalan.
Branch ini **sudah di-rebase ke situ**, bukan ditinggalkan di belakang.

Empat konflik, **semuanya di jalur closing dan semuanya PENYISIPAN MURNI** —
D-4 menambahkan tombol "Include PPN" ke `ClosingInput`/form closing, A-4
menambahkan durasi + alasan override ke tempat yang sama. Resolusinya *simpan
keduanya*, nol baris dibuang:

| Berkas | Resolusi |
|---|---|
| `packages/domain/src/sales.ts` | `ClosingInput` membawa `includePPN` **dan** `durasiBulanOverride`/`alasanOverride`. Badan `close()` auto-merge bersih (blok PPN di langkah 5/6, blok kontrak di 4b). |
| `apps/api/src/app/api/v1/attempts/[id]/close/route.ts` | `Body` + pemetaannya membawa ketiga field. |
| `web-internal/src/lib/sales.ts` | idem, sisi tipe FE. |
| `web-internal/src/app/(shell)/sales/[id]/page.tsx` | Baris field jadi tiga (skema · PPN · tanggal mulai) — tata letak `main` dipertahankan; A-4 hanya memperjelas label "Managed Since" jadi "Tanggal Mulai Kerja Sama" karena field itu kini benar-benar `contracts.tanggal_mulai`. ⚠️ **Tiga field dalam satu `formRow` belum pernah dilihat mata** — masuk daftar utang UAT di bawah. |

Migrasi Gelombang D (`20260922010000`, `20260923010000`) **nol tabrakan nama**
dengan blok `…T10####` Jalur A, dan menyortir mengapit — persis seperti yang
dipetakan sesi F. Gerbang angka juga tidak bergeser: mereka menambah KOLOM.

## Angka verifikasi §6 — apa adanya, PASCA-REBASE ke `1fee983`

Dijalankan di atas `db-rebuild` bersih dan sesudah `npm install` (jebakan A-T4:
`audit_log` menolak DELETE, jadi menjalankan suite domain berkali-kali atas DB
yang sama membuat tes berhitung-baris merah — rebuild dulu, baru simpulkan).

```
db-rebuild.sh   197 migrasi   (195 milik Jalur A + 2 Gelombang D)
  gate: 146 tabel · 40 entity_prefix · 31 sm_machines · 73 notif_events
        + notif_katalog_sesuai
  invariant: ident_checks · immutability_checks · rls_checks · auth_claims_checks
  → NOL counter digeser, oleh Jalur A maupun Gelombang D. Dua migrasi sesi ini
    nol tabel/prefix/mesin/event; Gelombang D menambah kolom.
```

| Suite | Acuan §6 | Pra-rebase | **Pasca-rebase** |
|---|---|---|---|
| `packages/domain` (sendirian, pasca-rebuild) | 1994 (+1 skip) | 2031 (+1 skip) | **2053** (+1 skip) |
| `packages/core` | 936 | 936 | **983** |
| `packages/db` | 53 | 53 | **53** |
| `apps/api` | 492 | 492 | **492** |
| `web-internal` | 650 | 655 | **655** |
| `web-client-portal` | 19 | 19 | **19** |

Kenaikan `core` 936 → 983 dan `domain` 2031 → 2053 adalah milik Gelombang D
(accrual + PPN), bukan sesi ini — dicatat apa adanya supaya angkanya tidak
terbaca sebagai klaim Jalur A.

`npm run typecheck --workspaces` sesudah `npm install`: empat workspace bersih.
`cd web-internal && rm -rf .next && npx tsc --noEmit && npm run build`: bersih,
seluruh halaman ter-compile. `npm run lint` (di `web-internal`): **1 error
PRE-EXISTING** — `react-hooks/static-components` di `admin/employees/page.tsx`,
sama persis dengan acuan §6, tidak disentuh sesi ini.

Naik atau sama di setiap kolom, tidak pernah turun. `apps/api` tetap 492 karena
tambahan sesi ini di sana adalah field pada tes wire yang SUDAH ada, bukan `it`
baru — sengaja: satu `it` per field wire akan membuat berkas itu tumbuh tanpa
menambah satu pun asersi yang tidak sudah dicakup `toEqual` penuhnya.

### Dibuktikan tidak vacuous (dua kali, keduanya diukur)

| Yang dimatikan | Yang merah | Yang tetap hijau |
|---|---|---|
| lengan STRG- di `resolveBriefStrategy` (A-3) | **3** tes jahitan | **5** tes batas, termasuk "Service pindah ke `[Strategy Approved]`" — buktinya memindahkan status saja tidak memperbaiki apa pun |
| `private.brief_created_count` → `count(*)` biasa (A-req-3) | **2** tes RLS (0 bukan 2; 0 bukan 3) | seluruh suite domain lainnya — persis sebabnya cacat ini tidak bisa ditangkap tes domain biasa (koneksinya BYPASSRLS) |

## ⚠️ Utang UAT mata manusia — BERTAMBAH, belum dibayar

Utang A-1 (dan A-2) dari sesi sebelumnya **belum dibayar**, dan sesi ini
menambah empat layar. Alasannya tidak berubah: repo ini tidak punya harness
peramban (nol Playwright di `scripts/` dan `package.json`), dan Chromium memang
sudah ada di container (`/opt/pw-browsers/chromium`) tapi yang kurang adalah
harness + jalur login — itu pekerjaan tersendiri, bukan sisipan di dalam sesi
build. Yang SUDAH dibuktikan untuk keempat layar baru: `tsc` bersih,
`next build` sukses, dan rantai datanya utuh dari kueri sampai kunci wire
(ada tes per mata rantai). Yang BELUM: ada mata yang melihatnya.

| Yang perlu dilihat | Halaman | Penguji yang tepat |
|---|---|---|
| _(utang lama, A-1/A-2)_ nama toko baris pertama + `CLI-…` baris kedua; panel "Permintaan ke Finance" 8 kolom | `/finance`, `/finance/transactions/{id}`, `/persetujuan`, `/kol/payment-requests/{id}` | Finance, KOL |
| _(utang lama, A-5)_ catatan pengganti field PIC — terbaca sebagai penjelasan, bukan error | `/account/services/{id}` | AM/CRO |
| **BARU (A-4)** dua field "Durasi Kerja Sama (bulan)" + "Alasan Override" di form closing — alasannya `disabled` sampai durasi diisi, dan labelnya tidak memotong | `/sales/{id}` | Sales |
| **BARU (pasca-rebase)** baris field pertama form closing kini bertiga: Payment Scheme · **Include PPN (11%)** · Tanggal Mulai Kerja Sama. Muat dalam satu baris tanpa checkbox PPN-nya terjepit? | `/sales/{id}` | Sales — irisan A-4 × D-4, dua tiket yang tidak saling melihat |
| **BARU (A-4)** tiga field jendela kontrak di form Strategi tampil **terkunci** dengan kalimat "diambil dari kontrak CTR-… yang dibuat Sales saat closing" — terbaca sebagai penjelasan, bukan form rusak | `/account/services/{id}` | AM/CRO |
| **BARU (A-req-2)** picker "Brief Creative sumber (opsional)" MUNCUL saat divisi tujuan diubah ke Ads dan HILANG saat diubah kembali | `/account/services/{id}` | AM |
| **BARU (A-3)** langkah onboarding untuk Service ber-STRG-: tidak lagi menawarkan "Buat Strategy & Plan" untuk Strategi yang sudah `Aktif` | `/account`, `/account/services/{id}` | AM/CRO — **ini keluhan Account #5 sendiri**, jadi penguji paling tepatnya yang menulis keluhannya |

## ⛔ Supabase live — masih NOL, dan daftarnya bertambah dua

Aturan emas §0 #4 tidak berubah: hanya langkah penggabungan yang push ke live,
**per berkas** lewat `apply_migration`, dalam urutan nama. **Nol
`supabase db push`, nol migrasi di-apply ke live dari sesi ini.**

Daftar migrasi Jalur A yang menunggu, dalam urutan apply:

| Urutan | Berkas | Isi | Menghapus sesuatu? |
|---|---|---|---|
| 1 | `20260922100000_f2_private_brief_client_dan_pic.sql` | 4 fungsi `private.*` | tidak — aditif |
| 2 | `20260922100100_f3_notif_feedback_od.sql` | katalog v15 | tidak — aditif |
| 3 | `20260922100200_f4_briefs_jendela_budget_sumber.sql` | 4 kolom `briefs` + 3 CHECK + FK + indeks | tidak — aditif, semua nullable |
| 4 | `20260922100300_a2_rls_cpr_lengan_finance.sql` | lengan Finance pada `creator_payment_requests_select` | tidak — policy dilebarkan |
| 5 | **`20260922100400_a3_backfill_service_strategy_approved.sql`** | backfill status Service lewat `sm_transition` | tidak — nol DDL. **Menulis baris `audit_log`**, jadi ia TIDAK idempoten dalam arti "tidak meninggalkan jejak": jalan kedua menemukan nol kandidat dan tidak menulis apa pun, tapi jalan pertama memang mencatat satu baris per Service. Itu yang diinginkan. |
| 6 | **`20260922100500_areq3_private_brief_created_count.sql`** | 1 fungsi `private.*` | tidak — aditif |

⚠️ **Urutan gabungan sesudah rebase.** Gelombang D menyelipkan dua berkas yang
mengapit blok Jalur A: `20260922010000_dkom_pengakuan_katalog.sql` menyortir
**sebelum** keenam berkas di atas, dan `20260923010000_d4_ppn_kolom_terpisah.sql`
**sesudah**. Urutan apply-nya tetap deterministik menurut nama; jangan menyusun
ulang atau "membetulkan" nomornya.

Verifikasi sesudah apply untuk dua yang baru (jangan percaya `success: true`):

```sql
-- 5. backfill A-3: nol Service tertinggal
select count(*) from services sv
  join strategi s on s.contract_id = sv.contract_id
 where sv.status = '[Awaiting Onboarding]' and s.status = 'Aktif';
-- harus 0

-- ...dan yang digerakkan meninggalkan jejaknya
select count(*) from audit_log
 where entity_type = 'service'
   and action = 'transition:[Awaiting Onboarding]->[Strategy Approved]'
   and actor_employee_id = 'SISTEM';
-- sama dengan jumlah baris yang dilaporkan RAISE NOTICE saat apply

-- 6. fungsi A-req-3 ada dan hanya bisa dipanggil authenticated/service_role
select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'private' and proname = 'brief_created_count';
-- 1 baris
select has_function_privilege('anon', 'private.brief_created_count(text)', 'execute');
-- harus false

-- gerbang tabel TIDAK boleh berubah
select count(*) from information_schema.tables
 where table_schema = 'public' and table_type = 'BASE TABLE';
-- harus 146
```
