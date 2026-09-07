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
Commit fondasi F : b240f47d  (di branch claude/cdps-user-feedback-account-a-igix3n)
Branch Jalur B   : claude/cdps-user-feedback-70vbho-b
Rebase           : dilakukan 2026-09-07 — B-3/B-4/B-5 pra-F dikerjakan lebih
                   dulu dari origin/main @ b8a76246 (§0 rencana mengizinkannya),
                   lalu di-rebase ke b240f47d. Hanya berkas ini yang konflik;
                   wire.ts auto-merge (lihat "Catatan berkas bersama").
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
situ: **tambahkan di UJUNG, jangan susun ulang isinya.** Jalur B tidak
menyentuhnya — tes RLS B-D4 ditaruh di berkas BARU
(`packages/domain/src/creative-asset-scope.rls.test.ts`), nol konflik.

`apps/api/src/lib/wire.ts` — blok B-5 (`ClientAssetOptionWire`) ditulis SEBELUM
rebase, jadi ia mendarat tepat di atas `assetToWire` dan **bukan** di
`ANCHOR-WIRE-DELIVERY`. Rebase-nya auto-merge bersih (jaraknya ±380 baris dari
`BriefWire` dan ±2.000 dari `TransactionWire`), jadi ia dibiarkan di tempatnya
alih-alih dipindah — memindahkannya sekarang hanya menciptakan hunk baru tanpa
manfaat. **Tambahan wire Jalur B berikutnya pakai `ANCHOR-WIRE-DELIVERY`.**

`apps/api/src/lib/shape-parity.test.ts` dan `route-parity.test.ts` juga tak
bertuan di §2 — masing-masing bertambah satu baris/satu `it`, lihat "Peta
perubahan".

## Temuan Jalur B (calon baris DECISIONS, dipindahkan di langkah penggabungan)

| # | Temuan | Status |
|---|---|---|
| B-D1 | Edge `sm_edges` baru `[Submitted]` → `[Revision Requested]`, lead-only (`require_lead=true`), migrasi `20260922200000`. Nol state/mesin baru. **Konsekuensi:** Revision Count diturunkan dari action **persis** `transition:[In Review]->[Revision Requested]`, jadi tolakan QC internal TIDAK terhitung — itu memang dikehendaki (ia mengukur revisi yang diminta klien, bukan ketegasan QC divisi sendiri), dan flag §6 Rule 4 karenanya hanya dievaluasi di pintu AM. | ✅ terbangun |
| B-D2 | Batas "batch assign" dibaca sebagai **untuk orang lain**, BUKAN "lebih dari satu unit" — lihat §"B-D2 rinci" di bawah. Butuh konfirmasi pemilik. | ⚠️ perlu ketokan |
| B-D3 | Tiga pesan BI baru untuk tiga pintu review yang sekarang berbeda aktornya (`MSG_REVIEW_START_FORBIDDEN`, `MSG_QC_REJECT_FORBIDDEN`, `MSG_BATCH_ASSIGN_FORBIDDEN`). `MSG_REVIEW_FORBIDDEN` lama dipertahankan untuk pintu yang memang milik AM. Nol label PRD di-rename. | ✅ terbangun |
| B-D4 | `assets_select` mendapat arm **AM pemilik klien / Account lead / divisi Ads (baca saja)**, migrasi `20260922200100`. Dua cacat: (1) AM pemilik NOL akses baca ke baris `assets` padahal ia satu-satunya peran yang boleh approve — **pre-existing**, panel review massal AM kosong & `GET /assets/{id}` 404; (2) B-5 membuat predikat TS meloloskan Ads sementara RLS mengosongkan barisnya. Nol arm TULIS. | ✅ terbangun |
| B-D6 | **`source_creative_brief_id` diproyeksikan lewat KAMPANYE, bukan lewat `GET /briefs/{id}`** (`ads.Campaign.sourceCreativeBriefId`). Dua alasan: `account.getBrief` milik Jalur A, DAN halaman yang butuh nilai ini (picker aset di halaman kampanye) sudah membaca kampanyenya. `LEFT join briefs` — kampanye yang brief-nya tak terbaca tetap harus terbaca. | ✅ terbangun |
| B-D7 | **Jendela pengingat campaign KOL = H-7, bukan H-1** (`kol_reminder_tick` cabang (c)). Campaign yang berakhir besok sudah tidak bisa diselamatkan — creator butuh waktu untuk brief, produksi, dan QC. H-1 tetap untuk Booking (satu deliverable, bukan campaign). Konsekuensi yang DITERIMA: pemberitahuan **sekali**, bukan eskalasi harian (pola `penugasan_reminder_tick`). | ✅ terbangun |
| B-D8 | **`RollupBlocker` — enam sebab yang bisa dibedakan** (`task.diagnoseBriefRollup`), menggantikan empat exit senyap `recomputeBriefRollup`. ⛔ Semantik rollup TIDAK diubah: `allExist` dibiarkan apa adanya karena mengubahnya menggeser setiap metrik turunan, dan itu belum diketok. Kalau pemilik memutuskan Brief boleh menutup pada unit yang ADA (bukan pada `quantity_target`), itu satu perubahan di `rollupTarget` — dan diagnosis ini yang akan menunjukkan berapa Brief yang terdampak. | ✅ terbangun (semantiknya: ⚠️ perlu ketokan) |
| B-D5 | **PRD M7 `M7-OA-1` ditandai SUPERSEDED oleh K-1.** Auto-assign-by-workload resmi ditinggalkan — ia memang belum pernah dibangun, dan tidak ada sinyal availability/workload di CDPS untuk membangunnya. Dicatat sebagai *retired*, bukan dihapus. | ✅ terbangun |

## Permintaan ke Jalur A (berkas milik A — JANGAN diedit dari sini)

### 🚨 BLOKER A-5 — `briefs_select` tidak punya arm staff divisi

**Baca ini sebelum mengerjakan A-5.**

`briefs_select` (`20260723064438_rls_baseline.sql`) berbunyi:

```
jwt_can_read_all()
OR jwt_employee_id() IN (assigned_pic, created_by)
OR (jwt_is_lead() AND assigned_division = jwt_division())
OR private.jwt_is_am_of_service(service_id)
OR (jwt_is_lead() AND jwt_division() = 'Account')
```

**Staff divisi** hanya melihat Brief kalau ia `assigned_pic`-nya atau pembuatnya.
Diverifikasi di DB dengan klaim sungguhan (`SET LOCAL ROLE authenticated`) DAN di
peramban:

| Aktor | `GET /briefs/{id}` Creative | `GET /briefs/{id}` KOL |
|---|---|---|
| lead Creative | **200** | 404 |
| staff Creative | **404** | 404 |
| staff KOL | 404 | **404** |
| AM pemilik | 200 | 200 |
| Director | 200 | 200 |

**A-5 menghapus pengiriman `assigned_pic` dari form Brief AM** (K-1: AM pilih
divisi saja). Setelah itu `briefs.assigned_pic` kosong dan arm satu-satunya yang
hari ini menyelamatkan staff divisi ikut mati:

* halaman Brief divisi **404 untuk SELURUH staff** — hanya lead yang bisa membuka;
* `GET /assets/{id}` juga 404 **untuk PIC-nya sendiri** — `creative.assetSelect`
  masih `join briefs` demi `b.assigned_division` (O52 memindahkan
  `assigned_am_id` ke `private.brief_owner_am` tapi meninggalkan join itu), jadi
  keterlihatan Aset menumpang keterlihatan Brief;
* `GET /bookings/{id}` sama — `kol.ts:233` `join briefs`;
* antrean divisi (`/divisions/{d}/brief-queue`) kosong untuk staff.

**Ini SUDAH menggigit hari ini**, sebelum A-5: fan-out multi-PIC (M7 §3 Rule 4,
"12 video dibagi dua Videographer") memberi `briefs.assigned_pic` ke **satu**
orang, jadi Videographer kedua tidak bisa membuka halaman Aset-nya sendiri.
Diverifikasi di peramban.

**Yang diminta:** arm staff divisi di `briefs_select` —

```sql
OR (public.jwt_division() = assigned_division AND public.jwt_employee_id() <> '')
```

Digerbang **divisi**, bukan level (staff sudah punya jalur `assigned_pic`; yang
hilang adalah "anggota divisi pelaksana"). Ini **menyamakan DB dengan predikat TS
yang sudah ada** (`account.canSeeBrief`), bukan pelonggaran baru. Preseden bentuk
+ alasannya: `20260807160000_o48_grup_b_assets_lead_arm.sql`.

⚠️ Perhatikan aturan O52: **bukan** dengan melebarkan `services_select` /
`clients_select` (opsi (a), sudah ditolak pemilik 2026-08-07) — ini arm pada
`briefs_select` sendiri, atas kolom yang sudah ada di baris yang dievaluasi.

**A-5 sebaiknya tidak mendarat sebelum arm itu ada**, atau halaman Brief seluruh
divisi eksekusi mati bersamaan — dan matinya **404, bukan 403**, jadi terbaca
sebagai "belum ada datanya", bukan sebagai masalah izin.

Jalur B tidak menambalnya sendiri: `briefs_select` policy bersama dan A-5 tiket
Jalur A (aturan emas #2 + guard §0 "berhenti, tulis di handoff, tanya").

### Tiga proyeksi kolom F-4 yang HANYA bisa dikerjakan Jalur A

F-4 membuat empat kolom di `briefs` (`tanggal_mulai`, `tanggal_akhir`, `budget`,
`source_creative_brief_id`) — tapi **setiap jalur tulis dan baca `briefs` ada di
`packages/domain/src/account.ts`**, yang menurut §2 rencana milik Jalur A.
Diperiksa: `BriefInput`, `Brief`, `insertBrief`, `createBrief`, `getBrief`,
`listDivisionQueue` — semuanya di sana, dan F **tidak** memproyeksikan keempat
kolom itu. Jadi tiga hal ini menganggur menunggu A, dan Jalur B tidak
menyentuhnya:

| # | Yang dibutuhkan | Berkas (milik A) | Untuk |
|---|---|---|---|
| **A-req-1** | `BriefInput` + `insertBrief` menerima `tanggalMulai` / `tanggalAkhir` / `budget`, dan `Brief` + `briefToWire` memproyeksikannya | `account.ts`, `wire.ts` | **B-3**: `brief-inherit.planRowToBriefInput` sudah siap mengisinya (hari ini budget hanya "nyangkut" sebagai teks di dalam `instructions`, `brief-inherit.ts:181`), dan halaman KOL sudah siap merendernya |
| **A-req-2** | `account.createBrief` mengisi `source_creative_brief_id` saat AM membuat Brief **Ads**, + pickernya di form Brief AM | `account.ts`, `account/services/[id]/page.tsx` | **B-5**: sisi BACA-nya sudah jalan penuh (lihat B-D6); yang belum cuma PENGISIANNYA |
| **A-req-3** | Satu field jumlah anak (mis. `created_count`) pada baris antrean divisi | `account.listDivisionQueue`, `wire.ts` | **B-1a**: progres "n dari N" di ANTREAN. Halaman Brief-nya sudah dapat (`RollupBlockerPanel`), tapi antrean butuh pembilangnya per baris — memanggil `GET /briefs/{id}/rollup` per baris adalah N+1 |

⚠️ **Ketiganya TIDAK memblokir apa pun yang sudah mendarat** — semuanya menambah
data ke jalur yang sudah bekerja. Tanpa A-req-3, antrean tetap menampilkan
`Target Creator` / `Target Qty`, hanya tanpa pembilangnya.

---

## Sisa pekerjaan Jalur B

| # | Item | Status |
|---|---|---|
| B-1 | Divisi bilang "done" tapi CRO tidak berubah — progres "n dari N" + emitter notifikasi | ✅ **selesai** kecuali antrean (A-req-3). **B-1b:** `task.notifyAmOnRollupEdge` memancarkan `BriefSiapReviewAm` di edge → `[In Review]` dan `BriefSelesai` di edge → `[Approved]`, dipakai BERSAMA oleh kedua rollup (task + kol). Edge antara sengaja senyap (progres divisi sendiri = kebisingan di inbox AM). Penerima lewat `private.brief_owner_am` (perangkap O52). `notifyActor` false: AM yang menggerakkan sendiri edge-nya tidak diberi tahu (kedua sisinya ada tesnya). **B-1a:** `task.diagnoseBriefRollup` + `GET /briefs/{id}/rollup` + `RollupBlockerPanel` di `/creative/briefs/[id]`, `/kol/briefs/[id]`, `/kol/bookings/[id]`, `/tasks/[id]` — keempat exit senyap sekarang punya kalimatnya sendiri. ~~belum~~ Sisa lama: Fondasi rendernya SUDAH ada: `web-internal/src/lib/brief-progress.ts` (murni, 9 tes) — `hitungProgres` / `labelProgres` / `pesanRollupTertahan`. B-1a tinggal memasangnya di antrean divisi & halaman Brief AM; **jangan tulis aturan "n dari N" untuk kedua kalinya.** B-1b memasang emitter `EVENTS.BriefSelesai` di kedua `recomputeBriefRollup`. |
| B-2 | Leader lihat brand & PIC (render; kueri + wire sudah dibereskan F) | ✅ **selesai**. Kolom Klien + PIC-by-nama di antrean `/creative`, `/tasks`, `/ads`, dan di halaman Brief Creative/KOL/tasks. Halaman Brief Creative sebelumnya menampilkan `service_id` TELANJANG sebagai satu-satunya petunjuk klien. Keempat tipe Brief FE Jalur B ikut mendeklarasikan ketiga field NON-opsional. ~~belum~~ Nol pekerjaan bisa dimulai pra-F, jadi tidak disentuh. |
| B-3 | KOL: deadline, budget, pengingat (kolom sudah ada dari F-4) | **separuh** — sisanya A-req-1. ✅ Sudah: progres "n dari N creator", jatuh tempo, `agreed_rate`, panel rollup — di `kol/briefs/[id]`, `kol/bookings/[id]` (kartu "Konteks Campaign" baru), kolom Target Creator di `kol/page.tsx`. ✅ **Tick pengingat SELESAI**: `kol_reminder_tick` (migrasi `20260922200200`) + `kol.runKolReminderTick` + `POST/GET /internal/kol/tick`, tiga cabang (H-1 Booking · lewat tenggat · campaign H-7), idempoten lewat tiga kolom penanda yang trigger-nya hanya izinkan false→true, pg_cron 07:00 WIB. Aturan seleksinya di SQL, bukan TS — preseden `penugasan_reminder_tick`: pg_cron memanggil SQL-nya langsung, jadi salinan kedua di TS adalah aturan yang bisa berbeda dari yang berjalan di produksi. ⛔ Belum: **jendela campaign + budget sebagai kolom sungguhan** (A-req-1). Cabang (c) tick sudah MEMBACA `briefs.tanggal_akhir`, jadi ia langsung hidup begitu ada yang mengisinya. |
| B-4 | Leader Creative boleh approve (K-1) | ✅ **selesai** (sisi leader **dan** sisi staff). Migrasi `20260922200000`; `creative.canDriveReviewEdge` + `reviewEdgeForbiddenMessage` + `canAssignAssetBatch`; `[In Review]→[Approved]` tetap milik AM. UI: tiga pintu terpisah di `creative/assets/[id]`, panel massal dipecah per pintu + kartu self-claim di `creative/briefs/[id]`. `STATE_MACHINES.md` §7 + PRD M7 diperbarui. **Tidak menunggu A-5** — sisi leader nol irisan dengan berkas A. |
| B-5 | Ads bisa menemukan aset (K-3) | ✅ **selesai** (sisi baca penuh). Rute `GET /clients/{id}/assets`, lengan Ads pada `creative.canSeeAsset` **plus arm RLS-nya** (B-D4), `creative.listApprovedAssetsForClient` (pola service-role seperti `listMyAssets`, gerbang dievaluasi SEBELUM baris aset dibaca), komponen `AssetPicker` menggantikan DUA kolom teks di `/ads/[id]`. **Filter `source_brief` SUDAH tersambung** lewat `ads.Campaign.sourceCreativeBriefId` (B-D6), plus jalan keluar "Tampilkan semua aset klien" saat penyempitannya berujung kosong — penjelasan yang benar tapi tanpa jalan keluar tetap mengirim orang kembali ke Google Sheet. ⛔ Sisa: PENGISIAN kolomnya saat AM membuat Brief Ads (A-req-2). |


---

## B-D2 rinci — kenapa "batch assign" dibatasi ke "untuk orang lain"

Rencana induk menulis: *"batasi **batch assign** ke lead; self-claim satu aset
tetap boleh."* Dibaca sebagai: yang dibatasi adalah **membagi ke PIC lain**;
self-claim tetap terbuka. **Tidak** dibatasi jadi tepat satu unit per panggilan.

**Kenapa.** Cap satu unit melanggar perilaku existing yang punya tesnya sendiri:
`createAssetBatch` adalah **satu-satunya** pintu yang memakai ulang celah
`sequence_no` (tes *"reuses the freed slot of a sequence gap"*), jadi cap itu akan
diam-diam mencabutnya dari si self-claimer. Dan staff yang mengambil 3 unit
**miliknya sendiri** bukan keluhan yang K-1 jawab — Account #2 adalah AM yang
memilih nama staff.

⚠️ **Kalau pemilik memaksudkan cap literal satu unit**, itu satu baris di
`creative.createAssetBatch` (kembalikan syarat `total !== 1`) + satu penyesuaian
tes. Ditulis di sini alih-alih diputuskan sendiri.

---

## Temuan PRE-EXISTING lain (di luar cakupan — JANGAN ditambal diam-diam)

Ketiganya ditemukan UAT peramban, **tidak ada** yang berasal dari diff Jalur B,
dan tidak satu pun ditambal. Dicatat supaya tidak hilang.

1. **`GET /assets/{id}/metrics` 404 untuk lead & staff Creative**, 200 untuk AM &
   Director. Pesannya `[task tidak ditemukan]` (M12 `task.assetMetrics`). Jalur
   bacanya menyentuh baris yang tak terlihat oleh divisi eksekusinya sendiri —
   keluarga O52 yang sama. Di UI muncul sebagai alert inline di kartu "Metrik",
   tidak meruntuhkan halaman.
2. **`creator_bookings_select` tidak punya arm AM maupun arm divisi** — hanya
   `assigned_coordinator` / `created_by` / read-all. AM pemilik klien tidak bisa
   membuka Booking KOL kliennya (404). Bentuk perbaikannya sama seperti B-D4.
3. **`creative.assetSelect` masih `join briefs`** demi `b.assigned_division`,
   sehingga keterlihatan Aset menumpang keterlihatan Brief — inilah yang membuat
   BLOKER-A5 di atas merambat ke halaman Aset. Perbaikan bersihnya: helper
   `private.*` kedua untuk `assigned_division`, pola sama `brief_owner_am`.
   **Menunggu keputusan BLOKER-A5 lebih dulu** — kalau `briefs_select` dapat arm
   staff divisi, join ini tidak lagi berbahaya dan perbaikan kedua jadi
   tidak perlu.

---

## Verifikasi yang benar-benar dijalankan — DUA KALI (pra-rebase & pasca-rebase)

`scripts/db-rebuild.sh --yes` di atas commit F: **194 migrasi**, seluruh gerbang
angka & invariant SQL (`ident_checks`, `immutability_checks`, `rls_checks`,
`auth_claims_checks`) hijau. Gerbangnya **tabel 146 · entity_prefix 40 ·
sm_machines 31 · notif_events 73** — angka F apa adanya, **tidak digeser Jalur B**
(sm_edges tidak dihitung, dan migrasi RLS nol tabel baru).

`npm run typecheck --workspaces` dijalankan **sesudah** `npm install` (jebakan §6):
empat workspace bersih.

| Suite | Acuan §6 | Pra-rebase | Pasca-rebase | **Pasca B-1/B-2/B-3/B-5** |
|---|---|---|---|---|
| `packages/core` | 930 | 935 | 936 | **936** |
| `packages/db` | 53 | 53 | 53 | **53** |
| `apps/api` | 490 | 491 | 491 | **491** |
| `packages/domain` (sendirian, pasca-rebuild bersih) | 1977 (+1 skip) | 2012 | 2014 | **2028** (+1 skip) |
| `web-internal` | 640 | 670 | 670 | **677** |
| `web-client-portal` | 19 | 19 | 19 | **19** |

`scripts/db-rebuild.sh` terakhir: **195 migrasi**, gerbang **146 / 40 / 31 / 73**
— tidak satu pun digeser Jalur B. Dua migrasi B terakhir nol tabel/prefix/mesin/
event baru (satu baris `sm_edges`, satu policy `FOR SELECT`, empat kolom penanda).

⚠️ **Invariant `rls_checks.sql` menangkap satu cacat nyata di migrasi B-3 saat
apply pertama:** `REVOKE EXECUTE ... FROM PUBLIC` **tidak cukup** di Supabase —
`anon` dan `authenticated` role bernama yang mewarisi grant-nya sendiri, jadi
sebuah fungsi SECURITY DEFINER tetap bisa dipanggil anon. Bentuk yang benar
(dan yang sekarang dipakai): `FROM public, anon, authenticated`. Dicatat di sini
karena migrasi Jalur A/Wave-3 berikutnya akan menabrak hal yang sama.

Naik atau sama di setiap kolom, tidak pernah turun. `cd web-internal &&
npx tsc --noEmit && npm run build` bersih pasca-rebase juga (`rm -rf .next` lebih
dulu). `npm run lint`: 1 error **PRE-EXISTING**
(`react-hooks/static-components` di `admin/employees/page.tsx`), sesuai §6.

### Tabel "tes yang wajib ada" (§6) — bagian Jalur B

| Item | Tes | Hasil |
|---|---|---|
| **B-4** lead boleh `[Submitted]→[In Review]` **dan** `→[Revision Requested]`; lead **tidak** boleh `[In Review]→[Approved]`; AM tetap boleh | `creative.test.ts` blok *"B-4 / K-1"* (7 tes) + tabel predikat `canDriveReviewEdge` (15 baris kasus) | ✅ |
| **B-5** Advertiser membaca daftar aset `[Approved]` kliennya; **tidak** membaca aset klien lain | `creative.test.ts` blok *"B-5 / K-3"* (4 tes) — termasuk 403 untuk AM asing & divisi lain, dan **404 untuk klien yang tidak ada** (daftar kosong tidak boleh menyamarkan ID salah tulis) | ✅ |
| **B-D4** arm RLS baru | `creative-asset-scope.rls.test.ts` (10 tes, `withClaims` + `SET LOCAL ROLE authenticated`). **Dibuktikan tidak vacuous:** dengan policy pra-migrasi dipasang ulang, tepat **5 tes arm baru merah**, 5 tes batas tetap hijau | ✅ |
| **B-1a** fondasi render "n dari N" | `web-internal/src/lib/brief-progress.test.ts` (9 tes) — batas `created >= target` diturunkan dari aturan rollup, **kedua sisinya** di-expect | ✅ |
| **B-5** aturan opsi picker | `web-internal/src/lib/asset-picker.test.ts` (11 tes) — invarian "value aktif selalu punya opsi yang cocok" | ✅ |
| **B-4** migrasi | tes membaca **`sm_edges` sungguhan** (bukan literal) + meng-assert himpunan state `brief_task` **tidak bertambah** | ✅ |
| **B-1b** event notifikasi benar-benar terkirim ke AM PEMILIK | `creative.test.ts` blok *"B-1"* — penerimanya di-assert (`ZZ-SINTA`, bukan aktornya), plus dua cabang negatif: Brief yang rollup-nya TIDAK menutup nol notifikasi, dan AM yang menggerakkan sendiri edge-nya tidak memberi tahu dirinya | ✅ |
| **B-1a** `created < quantity_target` ⇒ layar mengatakan "n dari N" | `creative.test.ts` (blocker `unit_belum_lengkap` pada kasus 3-dari-12 yang SEMUANYA selesai; `nol_unit` / `menunggu_pekerjaan` / `selesai` / `di_luar_rantai` dibedakan) + `web-internal/src/lib/rollup-blocker.test.ts` (7 tes — keenam sebab menghasilkan kalimat BERBEDA) | ✅ |
| **B-3** tick pengingat | `kol.test.ts` blok *"B-3"* (6 tes) — jam dinding DIPANCANG (`wib_date`), kedua sisi batas jendela H-7 di-expect, Booking terminal tidak diingatkan, idempotensi, dan penanda tidak bisa di-reset | ✅ |
| **B-5** filter Brief sumber | `ads.test.ts` blok *"B-5 / K-3"* (2 tes) — diproyeksikan di KEDUA jalur baca (`createCampaign` + `getCampaign`), dan `''` bukan null saat tanpa sumber | ✅ |

### UAT mata manusia (§6) — DIJALANKAN, dan ia yang menemukan B-D4

⚠️ `docs/handoff/FE_UAT_RUNBOOK.md` **kedaluwarsa**: boot order-nya menunjuk
`backend/testdata/…` + mockhris :8081 + cdps :8080, seluruhnya Go/MySQL yang
sudah diarsip C-05. Resep yang dipakai sesi ini, untuk pembaca berikutnya:

```
# 1. apps/api/.env.local  (JANGAN di-commit; *.local sudah di .gitignore)
SUPABASE_JWT_SECRET=<rahasia lokal apa pun>
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/cdps
# 2. apps/api: npx next dev -p 3001   ·   web-internal: npx next dev -p 3000
#    (next.config.ts sudah me-rewrite /api/v1/* -> 127.0.0.1:3001 di luar production)
# 3. Auth-nya HS256 SIMETRIS: cetak sendiri JWT ber-claim
#    { app_metadata: { employee_id, division, level, od, director } }, pasang
#    sebagai cookie `cdps_access_token`. Nol GoTrue, nol Supabase.
# 4. Fixture: seed punya 10 employees TAPI nol lead Creative dan nol data
#    delivery. Brief/aset/booking/kampanye dibuat lewat API SUNGGUHAN (bukan
#    SQL) supaya transisinya lewat mesin.
# 5. BERSIHKAN sesudahnya: fixture UAT yang tertinggal membuat 7 tes domain
#    merah (portal/admin/client/internaltask meng-assert himpunan GLOBAL).
#    Jalankan ulang scripts/db-rebuild.sh sebelum menyimpulkan apa pun.
```

Yang di-assert di DOM, per peran, di Chromium:

| Layar | Hasil |
|---|---|
| `/creative/assets/{AST}` **lead** | tombol `["Loloskan QC → Review AM","Tolak QC → Balik ke PIC"]` |
| `/creative/assets/{AST}` **AM** | tombol `["Loloskan QC → Review AM"]` — QC reject lead-only, approve muncul di `[In Review]` |
| `/creative/assets/{AST}` **staff** | `[]` — nol tombol review |
| `/creative/briefs/{BRF}` **lead** | seksi `Detail Brief · Tahapan Produksi · Asset (3/12) · QC Internal & Approve Massal · Assign Team … (Lead)` |
| `/ads/{ADC}` picker tautkan | opsi `["— pilih aset [Approved] —","Product Video #1 — Product Video Lebaran (AST-…-0001)"]` |
| `/ads/{ADC}` picker Creative Swap | opsi sama; picker "aset lama" hanya berisi yang **tertaut** |
| `/kol/briefs/{BRF}` | `"3 dari 8 creator"` (2×) + kalimat rollup tertahan + `Jatuh Tempo (Due Date) 2026-10-15` |
| `/kol/bookings/{BKG}` | `"3 dari 8 creator"` + kalimat rollup tertahan + `Jatuh Tempo Campaign (Due Date)` |
| `/kol` antrean | header `[…,"Jatuh Tempo","Target Creator"]`, baris `[…,"2026-10-15","8"]` |

Nol `pageerror` pada layar-layar itu. 404 yang tersisa di layar staff/KOL adalah
BLOKER-A5 dan temuan pre-existing di atas — **bukan** diff ini.

**Yang BELUM dilakukan, dan memang bukan tugas sesi ini:** UAT oleh orang yang
menulis keluhannya (§6 rencana: *"orang yang menulis keluhannya adalah penguji
yang tepat"*). Enam divisi itu yang harus melihat layarnya.

---

## Peta perubahan Jalur B (sejauh ini)

**Migrasi (blok `…T20####`, lokal saja — belum di-apply ke `CDPS SG`)**
* `20260922200000_b4_gerbang_lead_creative.sql` — satu baris `sm_edges`.
* `20260922200100_b45_assets_select_am_ads.sql` — `assets_select`, arm baca saja.

**Domain**
* `packages/domain/src/creative.ts` — `canDriveReviewEdge` +
  `reviewEdgeForbiddenMessage` + `canAssignAssetBatch` (predikat murni, bisa
  diuji tanpa DB); `lockAssetOwner` digerbang per-edge; `verdictForReview`
  memakai predikat **yang sama** (batch dan pintu tunggal tidak bisa berbeda
  pendapat); flag §6 Rule 4 dibatasi ke pintu AM; `canSeeAsset` + lengan Ads;
  **baru** `listApprovedAssetsForClient`.
* `creative.test.ts` 36 → 47 tes; **baru** `creative-asset-scope.rls.test.ts` (10).

**API**
* **baru** `apps/api/src/app/api/v1/clients/[id]/assets/route.ts`.
* `wire.ts` — `ClientAssetOptionWire` + `clientAssetOptionToWire`.
* `shape-parity.test.ts` — satu baris `WIRE_TO_FE`; `route-parity.test.ts` — satu
  asersi positif. `KNOWN_GAPS` **tetap kosong**, diverifikasi SESUDAH FE benar-benar
  memanggil rutenya.
* Dua komentar rute (`assets/[id]/review`, `.../request-revision`) diperbarui:
  satu rute, dua pintu. **Nol perubahan perilaku di rute itu** — gerbangnya di domain.

**web-internal**
* **baru** `components/AssetPicker.tsx`, `lib/asset-picker.ts` (+tes),
  `lib/brief-progress.ts` (+tes).
* `lib/creative.ts` — `ClientAssetOption` + `listClientApprovedAssets`.
* `creative/assets/[id]/page.tsx` — tiga pintu terpisah (`canStartReview` /
  `canQcReject` / `canAmVerdict`). **Jangan disatukan lagi jadi satu flag.**
* `creative/briefs/[id]/page.tsx` — panel massal dipecah per pintu; form assign
  jadi lead-only; kartu self-claim baru untuk staff.
* `ads/[id]/page.tsx` — dua kolom teks `AST-…` diganti picker.
* `kol/briefs/[id]`, `kol/bookings/[id]`, `kol/page.tsx` — progres, jatuh tempo,
  kolom Target Creator.

**Dokumen**
* `docs/STATE_MACHINES.md` §7 — edge baru + pelebaran aktor + catatan Revision Count.
* `docs/prd/CDPS_Module7_Creative.md` — §3 Rule 4, §3 Flow, **M7-OA-1 SUPERSEDED**.
* `docs/prd/CDPS_Module8_Ads.md` — §4 Rule 2 mencatat B-5/K-3.
