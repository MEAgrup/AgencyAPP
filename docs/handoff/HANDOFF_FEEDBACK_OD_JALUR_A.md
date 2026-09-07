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

_(belum ada)_

## Sisa pekerjaan Jalur A

| # | Item | Status |
|---|---|---|
| A-1 | Nama klien di antrean approval Finance (render) | ✅ **SELESAI** — ⚠️ **utang UAT mata manusia**, lihat di bawah |
| A-2 | Request pembayaran creator sampai ke Finance (+ migrasi RLS `…T10####`) | ✅ **SELESAI** — dua penyimpangan dari rencana, dicatat di bawah |
| A-3 | Status CRO mentok `[Awaiting Onboarding]` — jahitan STRG- → gerbang Brief | belum |
| A-4 | Durasi kerja sama pindah dari CRO ke closing Sales (K-2) | belum |
| A-5 | AM berhenti memilih nama staff Creative (K-1 sisi AM) — **memblokir B-4** | ✅ **SELESAI** — lihat di bawah |

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
