# Perbaikan CDPS dari "Feedback Final - OD" — eksekusi 2 akun paralel

> **Status: 🟢 disetujui pemilik 2026-09-07, BELUM ada satu baris kode pun ditulis.**
> Dokumen ini adalah titik mulai untuk dua sesi Claude yang berjalan bersamaan.
> Baca §0 (aturan emas + guard) **sampai habis** sebelum menyentuh apa pun —
> ada pekerjaan lain (sistem Finance / laporan otomatis) yang sedang jalan
> di repo yang sama.

## Context

Enam divisi (Finance, Account/CRO, Ads, Creative, Store Ops, KOL) sudah mencoba CDPS
dan menulis feedback di
[dokumen ini](https://docs.google.com/document/d/1VYHZcA_46dlQLtu6qmM2wbT0DbRe8hX8lFcnwvQZ9l0/edit).
Sepuluh keluhan. **Semuanya sudah diverifikasi ke kode** — tidak ada satu pun yang
salah lapor.

Tiga di antaranya bukan bug kecil melainkan **jahitan yang memang tidak pernah
tersambung**, dan gejalanya sudah pernah dicatat sendiri oleh repo ini
(`STATE_MACHINES.md:132` "belum membuka gerbang Brief", `LEADTIME_BACKLOG.md` LT-2
"menunggu pemilik", `web-internal/src/lib/kol.ts:527` "No list/queue endpoint
exists"). Feedback divisi adalah tagihan atas hutang itu.

Hasil yang dituju: setiap keluhan punya perubahan kode yang bisa ditunjuk, dan tim
berhenti memakai worksheet Google Sheet paralel untuk pekerjaan yang seharusnya
sudah dipegang CDPS.

**Dikerjakan dua akun Claude bersamaan.** Pembagiannya disusun dari **kepemilikan
berkas**, bukan dari besar pekerjaan — supaya penggabungan di akhir bukan sesi
merge-conflict. Ini mengikuti protokol yang sudah terbukti di
`docs/handoff/PARALEL_M16_DUA_AKUN.md` (M16, PR #247); aturan emasnya dipakai ulang
apa adanya, bukan bikin cara baru.

### Ketokan pemilik (Nerissa, 2026-09-07) — jangan diketok ulang

| # | Gerbang | Ketokan |
|---|---|---|
| K-1 | Alur Creative | **Opsi B** — Leader jadi gerbang + leader bisa approve. AM pilih **divisi saja**, tidak lagi memilih nama staff. Leader membagi ke PIC per-Asset, dan boleh meloloskan/menolak hasil PIC sebelum naik ke AM. **AM tetap pemegang approval akhir.** Peran Strategist/Creator/SMO dan jadwal harian **TIDAK** dibangun sekarang. |
| K-2 | Durasi kerja sama | **Otomatis dari katalog + Sales boleh override.** Durasi = layanan terpanjang yang dibeli (ketokan Q7). Sales isi tanggal mulai; override butuh **alasan wajib**. CRO **read-only**. |
| K-3 | Ads ↔ Creative | **Picker + brief Ads menunjuk brief Creative sumbernya.** |
| K-4 | Store Ops | **Bangun modulnya**, wave terpisah. |
| K-5 | Unit kerja Store Ops | **1 Brief → banyak baris SKU** (pola sama Creative/Asset, KOL/Booking). |
| K-6 | CTR/CVR Store Ops | **Store Ops yang isi, wajib, tapi TERPISAH dari "selesai".** SKU selesai saat gambar ter-upload; angka dampak langkah review kemudian, supaya leadtime produksi tidak ternoda tunggu 30 hari. |
| K-7 | Urutan | **Bug dulu → alur → Store Ops.** |

---

## 0. Aturan emas (berlaku untuk KEDUA akun)

1. **Fondasi (§1) WAJIB mendarat lebih dulu.** Kedua jalur bercabang dari commit F.
   Mulai sebelum F selesai = dua jalur menulis ulang berkas yang sama.
2. **Satu berkas punya SATU pemilik** (§2). Kalau butuh menyentuh berkas jalur lain:
   **tulis di file handoff Anda, jangan diedit.**
3. **Jangan sentuh `docs/DECISIONS.md` dari dalam jalur.** Semua ketokan K-1…K-7
   ditulis sekali di F. Temuan baru masuk file handoff jalur masing-masing; langkah
   penggabungan yang memindahkannya. DECISIONS adalah berkas yang paling mahal
   kalau salah merge.
4. **Jangan menjalankan migrasi ke Supabase live (`CDPS SG`).** Kedua jalur hanya
   DB lokal (`scripts/db-rebuild.sh`). Hanya langkah penggabungan yang push ke live,
   **per berkas lewat `apply_migration`, dalam urutan nama berkas**, lalu diverifikasi
   kueri katalog — ⛔ **jangan `supabase db push`** (ledger live berbeda wholesale,
   O65 masih terbuka).
5. **Migrasi yang SUDAH di-apply ke live tidak boleh disunting.** Perbaikan atasnya =
   migrasi baru ber-`CREATE OR REPLACE`.
6. **Jangan sentuh `archive/backend-go/**`.**
7. **Blok penamaan migrasi**: Jalur A memakai stempel `…T10####`, Jalur B `…T20####`.
   Nol tabrakan nama, dan urutan apply tetap deterministik.

### ⚠️ Ada perbaikan lain yang sedang berjalan — guard wajib

**Dikonfirmasi pemilik 2026-09-07: yang sedang dibangun adalah _sistem Finance /
laporan otomatis_.** Artinya `packages/domain/src/finance.ts` **hampir pasti
tersentuh pekerjaan itu**, dan kemungkinan besar `@cdps/core` serta migrasi tabel
laporan baru. Itu bertabrakan langsung dengan **F-2 dan Jalur A**.

**Penyesuaian yang WAJIB diambil karenanya:**

1. **Sentuhan `finance.ts` dijadikan commit PERTAMA, PALING KECIL, dan berdiri
   sendiri.** Isinya cuma dua fungsi — `financeQueue` (~:1878) dan
   `loadTransactionAggregate` (~:1910) — plus dua tipe baris. **Jangan digabung**
   dengan pekerjaan F lain, jangan reformat apa pun di sekitarnya, jangan sekalian
   merapikan. Semakin kecil dan semakin cepat mendarat, semakin murah rebase-nya
   bagi pekerjaan laporan otomatis (dan sebaliknya).
2. **Jangan menyentuh `@cdps/core` di luar satu baris katalog notifikasi (F-3).**
   Kalau ada dorongan merapikan sesuatu di `packages/core/**`: jangan.
3. **Counter di `db-rebuild.sh` / `ci.yml`.** F hanya menaikkan `notif_events`.
   Kalau sistem laporan otomatis menambah tabel, dia menaikkan hitungan **tabel**.
   Barisnya berbeda, jadi konfliknya kecil — tapi **saat resolusi, jangan menebak
   angka**: rebase, jalankan ulang `scripts/db-rebuild.sh`, ambil angka yang
   sebenarnya. Counter itu absolut, bukan delta.
4. **Blok stempel migrasi**: pekerjaan laporan otomatis kemungkinan memakai stempel
   bebas. Jalur A tetap `…T10####`, Jalur B `…T20####` — kalau tabrakan nama,
   **jalur inilah yang mengalah dan menggeser**, bukan pekerjaan yang sudah jalan.

**Sebelum menulis baris pertama, WAJIB:**

```
git fetch origin && git log origin/main --oneline -25
```

lalu daftar PR terbuka, dan cocokkan berkas yang mereka sentuh dengan tabel
kepemilikan §2.

- **Jangan merge buta.** Laporkan irisannya ke pemilik dan minta urutan.
- **Rebase ke `origin/main` setiap hari**, bukan sekali di akhir.
- Kalau berkas milik Anda ternyata sedang diubah pekerjaan lain: **berhenti,
  tulis di handoff, tanya** — jangan tambal paralel.

### Jalur B boleh mulai SEBELUM F mendarat

Aturan emas #1 tetap berlaku untuk apa pun yang menyentuh berkas F. Tapi tiga
pekerjaan Jalur B tidak menyentuh satu pun berkas F, jadi **B tidak perlu
menganggur menunggu**:

| Boleh dikerjakan sebelum F | Kenapa aman |
|---|---|
| **B-4** gerbang leader Creative — migrasi `sm_edges`, `creative.ts`, halaman `creative/**`, PRD M7, `STATE_MACHINES.md` §7 | Nol irisan dengan berkas F. ⚠️ Kecuali bagian yang menunggu **A-5** (sisi AM) — kerjakan sisi leader dulu, sisi AM belakangan. |
| **B-5** picker Ads — `creative.listApprovedAssetsForClient`, pelebaran `canSeeAsset`, rute `GET /clients/{id}/assets`, komponen `AssetPicker`, halaman `ads/**` | Nol irisan. Satu-satunya bagian yang menunggu F adalah **pengisian** `briefs.source_creative_brief_id` (kolomnya lahir di F-4) — bangun picker-nya dulu tanpa filter itu, filternya dipasang sesudah F. |
| **B-3** render field KOL yang **sudah ada** (`agreed_rate`, `due_date`, progres `quantity_target`) di `kol/briefs` & `kol/bookings` | Field-nya sudah ada di wire hari ini. Yang menunggu F-4 hanya jendela campaign + budget. |

Yang **wajib** menunggu F: B-1 (emitter notifikasi butuh F-3), B-2 (butuh field wire
F-1/F-2), sisa B-3 (butuh kolom F-4).

### Branch

| Peran | Branch |
|---|---|
| Fondasi F + **Jalur A** | `claude/cdps-user-feedback-70vbho` (branch yang ditugaskan) |
| **Jalur B** | `claude/cdps-user-feedback-70vbho-b` — dibuat dari commit F |

> Branch kedua ini konsekuensi langsung dari permintaan "bisa dikerjakan 2 akun
> bersamaan". Gw sebut eksplisit di sini supaya tercatat: Jalur B push ke branch
> tersebut, bukan ke branch yang ditugaskan.

Tulis SHA commit F di sini begitu mendarat, dan di kedua file handoff:

```
Commit fondasi F : ________
Branch dasar     : claude/cdps-user-feedback-70vbho
Branch Jalur B   : claude/cdps-user-feedback-70vbho-b
```

---

## 1. Fondasi F — satu akun, sebelum split

Semua di bawah ini **choke point global**: berkas tunggal yang invariant-nya pecah
kalau dua jalur menyentuhnya.

| # | Isi | Kenapa harus di F |
|---|---|---|
| **F-1** | `apps/api/src/lib/wire.ts` — tambah **semua** field wire baru sekaligus: `TransactionWire.toko` (~:2868) dan `BriefWire.client_id` / `client_nama` / `assigned_pic_nama` (~:446). **Kirim `null` eksplisit, jangan hilang.** Plus **dua anchor komentar** yang berjauhan sebagai titik sisip masing-masing jalur. | Batas camelCase→snake_case **satu-satunya**; `shape-parity.test.ts` menjaganya global. Dua jalur menyunting berkas ini = konflik pasti. |
| **F-2** | Kueri yang memberi makan F-1: `finance.financeQueue` (~:1878) + `loadTransactionAggregate` (~:1910) `join clients`; `account.listDivisionQueue` (~:1986) join `services→clients.toko` dan `employees.nama`. | Sama alasannya — dan `account.ts` dipakai kedua jalur. ⚠️ **Perangkap O52**: join `services`/`clients` di bawah RLS menghapus baris untuk divisi eksekusi. Pola yang sudah terbukti ada dua — `creative.listMyAssets` (`creative.ts:717-736`, jalur service-role) dan `private.brief_owner_am` (`account.ts:637`). Pakai salah satunya, **jangan bikin cara ketiga**. Preseden join Finance: `finance.ts:1498`. |
| **F-3** | Registrasi **SELURUH** event notifikasi baru dalam **SATU** bump `CATALOG_VERSIONS` (`packages/core/src/notification.ts`): (a) Brief siap direview AM, (b) Brief selesai, (c) Booking KOL mendekati/lewat jatuh tempo, (d) campaign KOL mendekati `end date`. **Semua → AM pemilik klien / koordinator KOL.** | `notification.test.ts` meng-assert `events()` == Σ `eventCount` per versi, dan `notif_catalog.reals.test.ts` meng-assert TS ≡ DB set-equal. Dua jalur menambah versi ⇒ invariant pecah dua kali. **Mendaftarkan event tanpa emitter itu aman** — emitter dipasang jalur masing-masing. |
| **F-4** | Migrasi aditif kolom `briefs`: jendela campaign (`tanggal_mulai`/`tanggal_akhir`), `budget`, dan `source_creative_brief_id` (nullable FK ke `briefs`). | `briefs` adalah tabel paling dipakai bersama di repo. Satu `ALTER TABLE` di F jauh lebih murah daripada dua migrasi dari dua jalur. |
| **F-5** | Naikkan gate hitungan di **`scripts/db-rebuild.sh:178-181` DAN `.github/workflows/ci.yml`** untuk delta `notif_events` dari F-3. Nilai sekarang: tabel **146** · `entity_prefix` **40** · `sm_machines` **31** · `notif_events` **69** — **baca ulang dari berkas, jangan percaya angka di sini.** | Angka yang sama hidup di DUA berkas; menaikkan salah satu saja = lokal hijau, CI merah (persis PR #170). Dipusatkan di F ⇒ **setelah F, tidak satu pun jalur menyentuh counter.** |
| **F-6** | Tulis ketokan **K-1…K-7** sebagai baris `Decided` di `docs/DECISIONS.md`, bertanggal 2026-09-07, satu blok. Tutup sekalian pertanyaan terbuka **O57 (b)** (`DECISIONS.md:592` — "dari mana floor GMV / durasi seharusnya datang") dengan ketokan K-2. | Aturan emas #3 — sesudah ini tidak ada jalur yang menyentuh DECISIONS. |
| **F-7** | Anchor komentar di `web-internal/src/lib/nav.ts` (grup Keuangan untuk A, grup Delivery untuk B). | Berkas kecil yang kedua jalur perlu sisipi. |
| **F-8** | Buat dua file handoff kosong: `docs/handoff/HANDOFF_FEEDBACK_OD_JALUR_A.md` dan `_JALUR_B.md`. | Tempat menulis temuan/keputusan tanpa menyentuh DECISIONS. |

**Exit criteria F:** seluruh suite existing lulus **tanpa perubahan perilaku**;
`ident.registry.test.ts` hijau; `notif_catalog.reals.test.ts` hijau;
`scripts/db-rebuild.sh` lolos **semua** gate; `shape-parity.test.ts` hijau dengan
field baru; `route-parity.test.ts` `KNOWN_GAPS` **tetap kosong**.

---

## 2. Pembagian jalur

### Kepemilikan berkas — satu pemilik, tanpa perkecualian

| Jalur A — **Uang & Klien** | Jalur B — **Delivery** |
|---|---|
| `packages/domain/src/{finance,req,strategi,account,sales,contract}.ts` | `packages/domain/src/{creative,task,kol,ads,brief-inherit,stage}.ts` |
| `apps/api/src/app/api/v1/{finance,permintaan,attempts,contracts,services}/**` | `apps/api/src/app/api/v1/{assets,briefs,campaigns,bookings,divisions,clients/[id]/assets}/**` |
| `web-internal/src/app/(shell)/{finance,account,sales,persetujuan,clients}/**` **+ `kol/payment-requests/**`** | `web-internal/src/app/(shell)/{creative,ads,tasks}/**` **+ `kol/{page.tsx,briefs,bookings}`** |
| `web-internal/src/lib/{finance,account,permintaan,sales,contract}.ts` | `web-internal/src/lib/{creative,kol,ads,tasks,stage}.ts` |
| `nav.ts` anchor **Keuangan** | `nav.ts` anchor **Delivery** |
| `docs/STATE_MACHINES.md` §6 (Service) | `docs/STATE_MACHINES.md` §7 (Brief) |
| — | `docs/prd/CDPS_Module7_Creative.md`, `CDPS_Module8_Ads.md` |

> Perhatikan: **`kol/payment-requests/**` milik A** (itu layar Finance yang kebetulan
> tinggal di folder KOL), sementara halaman KOL lainnya milik B. Berkasnya beda,
> jadi tidak bertabrakan.

---

### Jalur A — Uang & Klien
*Menutup keluhan Finance #1 & #2, Account #1 & #5, dan sisi-AM dari Creative #2.*

**A-1 · Nama klien di antrean approval Finance** — *Finance #1*
Kuerinya sudah dibereskan di F-2; A tinggal merender.
- `web-internal/src/app/(shell)/finance/page.tsx:137` — render `{t.toko}`, ID jadi
  baris kedua. Preseden render: `finance/reminders/page.tsx:105`.
- `finance/transactions/[id]/page.tsx` — header.
- `web-internal/src/lib/finance.ts:23` — `Transaction` tambah `toko`.

**A-2 · Request pembayaran creator sampai ke Finance** — *Finance #2 + KOL*
Jembatannya **sudah dibangun 90%** dan tinggal dirakit: tabel `permintaan` (`REQ-`,
`20260831040000_req_permintaan.sql`) sudah punya FK ke `creator_payment_requests`,
`client_id NOT NULL`, rute `GET /permintaan?divisi=Finance`, dan klien FE
`web-internal/src/lib/permintaan.ts` — **yang nol importir.** Persis kelas
kekeliruan yang dijaga `gate-reachability.test.ts`.
- Panel di `finance/page.tsx` — `listPermintaanQueue('Finance')`. Kolom: ID · Jenis ·
  Klien · Nominal · Diajukan oleh · Jatuh tempo · Aksi (Proses/Selesai/Tolak).
- Tombol "Ajukan ke Finance" di `kol/payment-requests/[id]/page.tsx` →
  `createPermintaan({ jenis: 'Creator Payment Approval', cpr_id })`.
- Sumber ke-8 di `/persetujuan` (`persetujuan/page.tsx:38-46`).
- Entri nav di anchor Keuangan.
- ⚠️ **Migrasi RLS (`…T10####`).** `creator_payment_requests_select`
  (`20260723064438_rls_baseline.sql:339`) hanya membuka baris kepada
  `(requested_by, paid_by, created_by)` — staf Finance yang belum pernah menyentuh
  CPR **tidak melihat apa pun**: ayam-telur. Lebarkan dengan lengan divisi Finance
  memakai `public.jwt_division()` yang sudah ada (`rls_baseline.sql:77`).
  **Nol tabel baru ⇒ nol counter berubah.**

**A-3 · Status CRO mentok `[Awaiting Onboarding]`** — *Account #5, akar terdalam*
Jalur pengiriman yang **diputuskan** (STRG- M6A + Plan M6B) tidak pernah menyentuh
mesin status `service`. Yang menyentuhnya jalur lama `STR-`, dan itu di-hide
`SHOW_LEGACY_STR_PATH = false`. Akibatnya `services.status` tak pernah bergerak dan
`guardBriefCreation` menolak Brief dengan
`[layanan ini wajib memiliki Strategy & Plan yang disetujui sebelum dibuatkan Brief]`
**padahal STRG- sudah `Aktif`**.
- `strategi.approveStrategi` (~:6923) — transisi Service
  `[Awaiting Onboarding] → [Strategy Approved]` dalam transaksi yang sama.
  **Tiru persis** `account.approveStrategy` (`account.ts:1009-1016`).
- `account.guardBriefCreation` (~:1341) — STRG- `Aktif` ikut membuka gerbang.
- `web-internal/src/lib/account.ts` — `ServiceQueueRow` (~:151) tambah
  `strategi_id`/`strategi_status`; `nextOnboardingStep` (~:416) baca jalur STRG-,
  supaya AM berhenti melihat "Buat Strategy & Plan" untuk Strategi yang sudah jadi.
- **Migrasi backfill**: Service ber-STRG- `Aktif` tapi masih `[Awaiting Onboarding]`
  didorong lewat `sm_transition` dengan aktor sistem — **bukan `UPDATE` mentah**
  (aturan rumah #2/#3).
- Perbarui catatan `docs/STATE_MACHINES.md:132` yang menyatakan lubang ini.

**A-4 · Durasi kerja sama pindah dari CRO** — *Account #1, ketokan K-2*
Hari ini satu-satunya UI yang menulis `contracts.durasi_bulan` adalah **form Strategi
milik AM** (`account/services/[id]/page.tsx:799` "Durasi kontrak (bulan)") →
`contract.ensureContractForService` (`contract.ts:447`). `sales.ClosingInput`
(`sales.ts:1223`) tidak punya field durasi sama sekali, dan `sales.close` tidak
pernah mencetak baris `contracts`.
- `ClosingInput` tambah `durasiBulanOverride?` + `alasanOverride?` (pakai
  `managedSince` yang sudah ada sebagai tanggal mulai).
- `sales.close` (~:1424) — cetak baris `contracts`. Durasi diturunkan
  `MAX(master_service_versions.durasi_bulan)` atas layanan yang ditutup (K-2);
  override menang bila diisi, **alasan wajib**. `tanggal_akhir` lewat
  `tz.addMonthsToDate` (kalender-aware, clamp akhir bulan) — **bukan `+30 hari`**.
- Rambatkan: `attempts/[id]/close/route.ts:22`, `web-internal/src/lib/sales.ts:215`,
  `sales/[id]/page.tsx:830`.
- Form Strategi jadi **read-only** untuk ketiga field itu.

**A-5 · AM berhenti memilih nama staff Creative** — *Account #2, sisi AM dari K-1*
⚠️ **Jalur B bergantung pada ini.** Kerjakan lebih awal dan beri tahu B saat mendarat.
- `account/services/[id]/page.tsx` — hapus `useAssignableEmployees` (~:186) dan
  `EmployeePicker` (~:1203); berhenti mengirim `assigned_pic` (~:446).
- `account.validateBrief` (~:1678) hari ini **tidak memvalidasi `assignedPic` sama
  sekali** — tutup pintunya di server juga, jangan hanya di UI.

---

### Jalur B — Delivery
*Menutup keluhan Creative #1–#3, Ads, KOL #1, dan Account #3 & #4.*

**B-1 · Divisi bilang "done" tapi CRO tidak berubah** — *Account #3 & #4*
Dua sebab terpisah, keduanya nyata.

*(a) Rollup mati diam.* `task.rollupTarget` (`task.ts:1058`) dan `kol.rollupTarget`
(`kol.ts:944`) memakai `allExist = created >= quantity_target`. Aset/Booking sengaja
dibuat bertahap, jadi Brief "12 video" dengan 3 Aset yang **semuanya selesai** tetap
`[In Progress]` selamanya. Kandidat terkuat gejala yang dilaporkan.
→ **Jangan diam-diam mengubah semantik rollup.** Yang dibangun: **tampilkan
progresnya.** "**n dari N dibuat**" wajib muncul di antrean divisi, halaman Brief
divisi, dan halaman Brief AM. Aturan kerja #4: *ketiadaan yang diam tidak bisa
dibedakan dari kerusakan* — halaman wajib mengatakan kenapa ia belum bergerak.
→ Dua jalan keluar diam lainnya juga harus bersuara: `chainRank < 0` (`kol.ts:895` —
status Brief keluar dari rantai 5-state ⇒ rollup mati **permanen**) dan
`BoardConflictError` yang ditelan (`kol.ts:916-925` — dependency M11 belum puas).

*(b) Nol notifikasi.* Katalog hari ini memberi tahu AM saat divisi **menerima** atau
**mengembalikan** brief — dan tidak pernah lagi. Event-nya sudah didaftarkan di F-3;
**B memasang emitter-nya** di `task.recomputeBriefRollup` (~:997) dan
`kol.recomputeBriefRollup` (~:886).

**B-2 · Leader lihat brand & PIC** — *Creative #3*
Kueri sudah dibereskan F-2, wire sudah F-1. B merender:
`creative/page.tsx:229-251`, `tasks/page.tsx:250`, `kol/briefs/[id]`, dan
`creative/briefs/[id]/page.tsx:373` (yang sekarang menampilkan `service_id` telanjang).

**B-3 · KOL: deadline, budget, pengingat** — *KOL #1*
Worksheet KOL asli (sudah dibaca) memuat persis yang diminta: `Duration · end date ·
Nb of Creators · Nb of Video · Setting Komisi · Harga Jasa · Urgency`. Di CDPS,
jendela campaign ada di `plan.tanggal_mulai`/`tanggal_akhir` tapi **tidak pernah
diproyeksikan**, dan budget hanya "nyangkut" sebagai teks di dalam `instructions`
(`brief-inherit.ts:181`).
- `brief-inherit.planRowToBriefInput` (~:169) — isi kolom `briefs` yang sudah
  disiapkan F-4, **sebagai kolom sungguhan, bukan string**.
- Render di `kol/briefs/[id]/page.tsx` dan `kol/bookings/[id]/page.tsx:433`: jatuh
  tempo, jendela campaign, budget, `agreed_rate`, dan progres "n dari N creator"
  (`quantity_target` — hari ini tidak dirender di mana pun padahal ia yang mengunci
  rollup, lihat B-1a).
- **Tick pengingat** meniru `internal/penugasan/tick`, memancarkan event F-3 (c)/(d).

**B-4 · Leader Creative boleh approve** — *Creative #2, ketokan K-1*
⚠️ **Menunggu A-5 mendarat** (sisi AM).
Hari ini `creative.lockAssetOwner` (`creative.ts:441-456`) menolak siapa pun selain
AM pemilik klien dengan
`[hanya Account Manager pemilik klien yang dapat mereview aset ini]` — leader kena
403, dan UI-nya pun menyembunyikan tombolnya (`assets/[id]/page.tsx:190`).
- **Tanpa mengarang state baru** (aturan rumah #2): lebarkan aktor edge
  `[Submitted] → [In Review]` supaya **lead divisi** boleh menjalankannya
  (= "lolos QC internal, teruskan ke AM"), dan **tambah satu edge**
  `[Submitted] → [Revision Requested]` (= "QC internal gagal, balik ke PIC"),
  lead-only, feedback wajib. Edge baru = baris `sm_edges` lewat migrasi `…T20####`
  + entri `STATE_MACHINES.md` §7. **Nol mesin baru ⇒ `sm_machines` tetap 31.**
- `[In Review] → [Approved]` **tetap milik AM** — dia proxy klien, itu tidak berubah.
- UI: buka tombol untuk `isCreativeLead(role)` di `creative/assets/[id]/page.tsx`
  dan panel massal `creative/briefs/[id]/page.tsx:574`.
- `creative.canCreateAsset` (`creative.ts:148`) hari ini mengizinkan staf Creative
  mana pun menjalankan `createAssetBatch` — batasi **batch assign** ke lead;
  self-claim satu aset tetap boleh.
- **PRD M7 ikut berubah**: §3 Rule 4 dan M7-OA-1 menuliskan auto-assign by workload
  yang tidak pernah dibangun dan sekarang resmi ditinggalkan. Jangan biarkan PRD dan
  kode saling membantah.

**B-5 · Ads bisa menemukan aset** — *Ads, ketokan K-3*
Kebuntuannya berlapis tiga, dan ketiganya harus dibuka bersamaan atau tidak sama
sekali: (i) tidak ada picker — `ads/[id]/page.tsx:448` adalah **textbox ketik
`AST-…` dari ingatan**; (ii) tidak ada endpoint daftar aset per klien; (iii)
`creative.canSeeAsset` (`creative.ts:159-173`) **menolak Advertiser membaca aset sama
sekali** — menebak ID yang benar pun tetap 403.
- `creative.listApprovedAssetsForClient(clientId, sourceBriefId?)` — pola
  service-role sama `listMyAssets` (perangkap O52).
- Lebarkan `canSeeAsset` dengan lengan divisi Ads (baca saja). PRD M8 §9.1 memang
  sudah memberi Advertiser kapabilitas "link Creative Assets" — gerbang M7 yang
  tidak pernah ikut dilebarkan.
- Rute baru `GET /clients/{id}/assets`. **Cek `route-parity.test.ts` sebelum
  menambah; `KNOWN_GAPS` tetap kosong.**
- Isi `briefs.source_creative_brief_id` (kolomnya sudah ada dari F-4) saat AM membuat
  brief Ads; picker menyaring ke situ, kalau kosong jatuh ke semua aset `[Approved]`
  milik klien itu.
- Komponen `AssetPicker` mengikuti pola `components/AdsClientPicker.tsx` /
  `EmployeePicker.tsx`; pasang di `ads/[id]/page.tsx:448` **dan** form Creative Swap
  (~:666).

---

## 3. Wave 3 — modul Store Operation

**Mulai setelah A dan B tergabung**, karena ia satu-satunya yang menaikkan gate
tabel/prefix/mesin. Sebagian besar berkas baru ⇒ konflik rendah; boleh dikerjakan
satu akun, atau dipecah PRD+migrasi+domain / halaman.

Hari ini Store Operation adalah **satu baris registry** (`packages/core/src/division.ts:83`)
tanpa PRD, tanpa domain, tanpa rute, tanpa halaman. Pipeline tahapannya sengaja
dikosongkan (`20260830020000_m16_stage_seed.sql:132`, LT-2). Lebih parah:
`StageTimelinePanel` — satu-satunya UI *Terima & proses* / *Brief Dikembalikan ke AM*
— **tidak dipasang di `/tasks/[id]`**, jadi Store Ops **secara harfiah tidak punya
cara menerima brief.**

Dari worksheet aslinya, pekerjaan mereka adalah **produksi & upload gambar SKU**:

| Aspek | Nilai dari worksheet |
|---|---|
| Request Type | `Shopee New` · `Shopee Revision` · `Shopee Additional` · `Tiktok New` · `Tiktok Revision` · `Tiktok Additional` · `CPAS New` |
| Jenis Gambar | `Cover Only` · `Cover + Pendamping` · `Varian + Pendamping` · `Iklan CPAS` |
| Per baris SKU | Nama Produk · Link SKU · Total Req Picture · Expected Done · Actual Done · Link Output · PIC · Notes |
| Turunan | Leadtime `On Time`/`Late` · %Ontime · % SKU Gagal Upload |
| Dampak (langkah terpisah, K-6) | Upload Date → CTR / CVR / Rating rata-rata 30 hari sebelum → Target → After → % Achievement → `achieve`/`under target` |

1. **PRD** `docs/prd/CDPS_Module18_Store_Ops.md`; daftarkan di `CLAUDE.md` dan
   `docs/prd/CDPS_Build_Plan.md`.
2. **Prefix baru** untuk baris SKU — `docs/DATA_MODEL.md` + `entity_prefix` +
   `packages/core/src/ident.ts` (dual-home, `ident.registry.test.ts`).
3. **Tabel anak** di bawah `briefs`, satu baris per SKU (K-5), plus kolom dampak yang
   **tidak** menggerbangi status selesai (K-6).
4. **Mesin status** + rollup meniru `task.recomputeBriefRollup`/`kol.recomputeBriefRollup`
   — dengan pelajaran B-1a ikut dibawa: progres "n dari N" harus terlihat, jangan mati
   diam.
5. **Pipeline tahapan `STORE_OPS`** (menutup LT-2) + kode alasan pengembalian brief
   (menutup LT-8, `stage.ts:83`).
6. **Pasang `StageTimelinePanel` di `/tasks/[id]`** — memperbaiki gerbang intake untuk
   **semua** divisi tanpa halaman sendiri, bukan hanya Store Ops.
7. **Halaman** `web-internal/src/app/(shell)/store-ops/` + tukar href nav
   `?division=Store+Operation` (sesuai catatan `nav.ts:243-254`).
8. **Rapikan dua katalog yang bertengkar**: `plantask.PLAN_TASK_CATALOG:96` punya 3
   jenis Store Ops, `account.TASK_CATALOG:408` punya nol. Setelah modulnya ada,
   `punyaKuotaSatuan` bisa dinyalakan — ⚠️ `division.ts:48-52` memperingatkan
   membaliknya tanpa katalog membuat komparator `normalizeTasks` jatuh di `undefined`.
9. **Bobot KPI** Store Ops semuanya `0` (`20260830040000_m16_perf_weights_zero.sql`)
   ⇒ performa selalu `—`. Isi setelah metriknya ada (LT-1).
10. **Naikkan gate** tabel/prefix/mesin di `db-rebuild.sh` **dan** `ci.yml`.

---

## 4. Penggabungan

1. **A merge lebih dulu** (jejak counter-nya nol: hanya migrasi RLS + backfill).
2. **B rebase ke `main` sesudahnya**, jalankan ulang `scripts/db-rebuild.sh`, dan
   **baca angka gate yang sebenarnya** — counter itu absolut, bukan delta. Jangan
   menebak saat resolusi konflik.
3. Pindahkan temuan dari kedua file handoff ke `docs/DECISIONS.md` — **di langkah
   ini, bukan di dalam jalur**.
4. Baru setelah keduanya di `main`: apply migrasi ke live **per berkas** lewat
   `apply_migration` dalam urutan nama, lalu **verifikasi dengan kueri katalog** —
   jangan percaya `success: true` saja.
5. Wave 3 mulai dari sini.

---

## 5. Yang sengaja TIDAK dikerjakan (dan kenapa)

- **Peran Creative terpisah (Strategist / Content Creator / SMO) & jadwal harian
  leader.** Ketokan K-1 opsi B. Model peran hari ini hanya `staff`|`lead`
  (`role_mappings`), jadi ini menyentuh HRIS mapping + Team Performance + PRD M7.
  Wave sendiri.
- **Gelombang D (laporan keuangan accrual).** Siap dibangun, nol keputusan tersisa —
  tapi tidak bersinggungan dengan feedback ini, **dan besar kemungkinan itulah
  "perbaikan lain" yang sedang berjalan** (lihat guard §0).
- **`[In Execution] → Done` untuk Service.** Edge-nya ada di `sm_edges`
  (`20260723055732_statemachine.sql:317`) tapi **nol pemanggil di seluruh domain** —
  tidak ada Service yang pernah bisa selesai. Ditemukan sesi ini, di luar cakupan
  feedback; **catat sebagai pertanyaan terbuka di `DECISIONS.md` (di F-6)**, jangan
  diam-diam ditambal.
- **`Makefile`** masih menunjuk `backend/` Go/MySQL yang sudah diarsip. Kotor, bukan
  bagian dari feedback.

---

## 6. Verifikasi

Per jalur, sebelum push:

```
service postgresql start
export DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps"
bash scripts/db-rebuild.sh --yes             # gerbang angka harus HIJAU
npm install
npm run typecheck --workspaces --if-present  # ulangi SESUDAH install, BACA keluarannya
npm test --workspaces
cd web-internal && npm install && npx vitest run && npx tsc --noEmit && npm run build
```

Angka acuan terakhir yang tercatat: core 930 · db 53 · apps/api 490 ·
domain 1977 (+1 skip) · web-internal 640 · web-client-portal 19. **Naik, tidak pernah
turun.**

Jebakan yang sudah terbukti mahal:
- **`npm run typecheck --workspaces` WAJIB diulang SESUDAH `npm install`, dan
  keluarannya DIBACA.** Tanpa `node_modules`, `tsc` membanjiri keluaran dengan
  *"Cannot find module 'vitest'"* dan galat sungguhan tenggelam. `core-engines`,
  `api`, dan `db-and-migrations` ketiganya mengompilasi `@cdps/core` — satu galat
  tipe tampak seperti tiga masalah berbeda.
- **Jalankan `packages/domain` SENDIRIAN sesudah `db-rebuild`** — tanpa itu ~788
  kegagalan palsu berpangkal `plan.test.ts`. Rebuild dulu, baru cari bug.
- `audit_log` **menolak DELETE**; tes yang menghitung baris audit pakai aktor unik
  per jalan (pola `aktorUnik()` di `showcase.test.ts`).
- **Postgres bisa mati sendiri di container ini** — `pg_isready` dulu sebelum
  menyimpulkan apa pun dari puluhan FAIL.
- `rm -rf web-internal/.next` kalau muncul *"Another next build process is already
  running"*.
- 1 error lint `react-hooks/static-components` di `admin/employees/page.tsx`
  **PRE-EXISTING**, di luar cakupan.

### Tes yang wajib ada, bukan sekadar "hijau"

| Item | Tes yang membuktikannya |
|---|---|
| F-1/F-2 | `shape-parity` (domain→wire→FE); payload antrean divisi memuat `client_nama` + `assigned_pic_nama` **di bawah RLS divisi eksekusi** (perangkap O52) |
| A-2 | Tes RLS: Finance melihat CPR yang **belum pernah ia sentuh**; divisi lain tidak |
| A-3 | **Tes jahitan** (aturan kerja #1): setujui STRG- → buat Brief → tidak 409. Satu tes yang memanggil **kedua sisi sungguhan** — tes unit di kedua sisi bisa hijau sementara jahitannya putus |
| A-4 | Durasi turunan `MAX(durasi_bulan)`; override menang + alasan wajib; tanggal akhir kalender-aware (mulai tgl 31 ⇒ `tz.addMonthsToDate`) |
| B-1 | `created < quantity_target` ⇒ layar mengatakan "n dari N"; event notifikasi benar-benar terkirim ke AM pemilik |
| B-4 | Lead boleh `[Submitted]→[In Review]` **dan** `[Submitted]→[Revision Requested]`; lead **tidak** boleh `[In Review]→[Approved]`; AM tetap boleh |
| B-5 | Advertiser membaca daftar aset `[Approved]` kliennya; **tidak** membaca aset klien lain |
| Wave 3 | Rollup SKU; leadtime On Time/Late; angka dampak **tidak** menggerbangi status selesai |

Cabang tes jangan ditebak — turunkan dari data nyata (aturan kerja #2): sebuah
`if (lolos)` telanjang juga hijau saat cabang menariknya tak pernah dijalani. Pola
yang dipakai: hitung `harusLolos` dari keluaran mesin, lalu `expect` kedua sisinya.

**UAT mata manusia per jalur** — buka halamannya di peramban. Gelombang C lolos
`tsc` + `vitest` + `next build` tapi tata letaknya tidak pernah dilihat siapa pun;
jangan ulangi. Untuk feedback ini, orang yang menulis keluhannya adalah penguji yang
tepat.
