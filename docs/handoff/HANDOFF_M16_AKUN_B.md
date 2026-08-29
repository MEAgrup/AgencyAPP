# HANDOFF — M16/M17 Akun B ("Divisi & Permintaan")

> Stream: Fase 3 (Ads, LT-40..LT-43) + Fase 4 (`REQ-` + AI Optimizer, LT-50..LT-55)
> Branch: `claude/m16-akun-b-divisi-permintaan-36u91r` (dari fondasi `25c9c94`,
> base `claude/buildplan-lead-time-tracking-g62d2i`)
> Kontrak kerja: `docs/handoff/PARALEL_M16_DUA_AKUN.md`
> Ini berkas MILIK Akun B — jangan diedit Akun A. Update terus selama bekerja.

## Status: ✅ SELURUH Fase 3 + Fase 4 SELESAI, terverifikasi dengan DB nyata

Migrasi diterapkan lewat `scripts/db-rebuild.sh --yes` (Postgres 16 lokal) dua kali
berturut-turut (idempotensi seed) tanpa error SQL satu pun. Test suite penuh
hijau **setelah** DB dibangun ulang bersih (lihat catatan flakiness di §"Uji"):

| Paket | Hasil |
|---|---|
| `@cdps/core` | 290/290 |
| `@cdps/db` | 53/53 |
| `@cdps/domain` | 1510/1510 (1 e2e skip, tidak berubah) |
| `@cdps/api` | 383/383 |
| `web-internal` | 374/374 |
| `tsc --noEmit` | bersih di kelima paket |

Tiga baris gate `scripts/db-rebuild.sh` GAGAL by design pada solo-run ini — **jangan
diperbaiki sebelum merge**, lihat §"Gate hitung — status transisi" di bawah:

```
✗ tabel public      124 (harusnya 123)   ← +1 permintaan (LT-50)
✗ sm_machines       24 (harusnya 23)     ← +1 mesin permintaan (LT-50)
✓ master_services   6  (SUDAH diperbaiki — lihat catatan di bawah, ini BUKAN F-only)
```

## Setup note

Branch lokal awalnya salah init (nyangkut di tip `main`, bukan di commit fondasi
F). Diperbaiki dengan `git checkout -B claude/m16-akun-b-divisi-permintaan-36u91r
25c9c94` sebelum kode apa pun ditulis — nol commit hilang (working tree bersih
sebelum perbaikan). Root cause kemungkinan race saat container di-provision;
dicatat di sini murni sebagai jejak, bukan keputusan produk.

## Migrasi (rentang `20260831*`, urutan penerapan)

| # | File | Isi |
|---|---|---|
| 1 | `20260831010000_adc_setting_state.sql` | LT-40 — state `[Setting]` baru pada mesin `ad_campaign` |
| 2 | `20260831020000_ads_tipe_iklan_management_date.sql` | LT-41 (`tipe_iklan`) + LT-42 (`additional_days` + `master_service_versions.durasi_jasa`) |
| 3 | `20260831030000_ads_reports_jenis.sql` | LT-43 — `ads_weekly_reports.jenis_laporan` + PK diperluas |
| 4 | `20260831040000_req_permintaan.sql` | LT-50 — tabel `permintaan`, mesin, trigger beku, RLS, helper `add_working_days` |
| 5 | `20260831050000_req_reminder_tick.sql` | LT-50 lanjutan — `permintaan_reminder_tick` + pg_cron |
| 6 | `20260831060000_ai_optimizer_wrr_aggregate.sql` | LT-52 + LT-55 — perluas `wrr_aggregate` + CHECK `wrr_divisi`/`wrr_catatan_divisi`/`strategi_dispatch` |
| 7 | `20260831070000_msl_ai_optimizer_items.sql` | LT-53 — item MSL `AI Video` + `Optimasi SKU` |

LT-51 dan LT-54 **tidak menghasilkan migrasi baru** — lihat penjelasan masing-masing di bawah.

## Per tiket — apa yang sebenarnya dibangun dan kenapa

### LT-40 — state `[Setting]` pada `ADC-`

`[Setting]` menggantikan `[Paused]` sebagai birth status Ad Campaign (`ads.ts
createCampaign` sekarang INSERT `status='[Setting]'`, bukan `'[Paused]'`).
`[Paused]` sekarang HANYA berarti "pernah Active, sedang di-Hold" — dua fakta
yang sebelumnya berbagi satu status kini terpisah. Edge baru: `[Setting]->[Active]`
(Launch, guard KODE sama persis dengan `[Paused]->[Active]` lama — Brief
`[Approved]` + semua Asset tertaut `[Approved]`; `activate()` di `ads.ts` tidak
perlu diubah sama sekali karena `statemachine.transition` mencari edge dari
status SAAT INI di DB, bukan hardcode `from`) dan `[Setting]->[Ended]`
(mencerminkan preseden `[Paused]->[Ended]` — batalkan sebelum pernah jalan).
`STATE_MACHINES.md §14` diupdate (bukan file eksklusif §3 manapun, murni
deliverable Ads).

### LT-41 — Tipe Iklan

Kolom `ad_campaigns.tipe_iklan` (CHECK `GMV Max Product|GMV Max Live|TTAM`),
wajib diisi di `createCampaign` sama seperti `platform`/`objective`.

### LT-42 — Ads Management Date

**Keputusan implementasi (flag untuk DECISIONS.md saat merge):** `end_date`
turunan BUKAN kolom `ad_campaigns.end_date` yang sudah ada — kolom lama itu
adalah target tanggal selesai CAMPAIGN yang diisi manual saat create (M8 §9.3,
dipasangkan `target_kpi`), semantik berbeda dari "batas masa kelola MEA atas
layanan Ads klien". Menimpanya akan merusak arti lama. Ads Management Date
dibaca lewat fungsi terpisah `computeAdsManagementEndDate` (baru, tidak
disimpan sama sekali):

```
end_date = ad_campaigns.start_date (dipakai apa adanya, jangkar mulai)
         + durasi_jasa   (BARU — master_service_versions.durasi_jasa, hari
                           kalender, dipin via services.master_service_id/
                           master_version_no — pola sama msl.ts effectiveAt)
         + additional_days (BARU — kolom ad_campaigns, default 0, settable
                           lewat setAdditionalDays())
         + total_hari_hold (TIDAK PERNAH kolom — dijumlah dari pasangan
                           [Active]->[Paused] lalu [Paused]->[Active] di
                           audit_log; hold yang BELUM di-resume tidak
                           menambah apa pun — "bergerak sendiri SETIAP
                           di-resume", bukan selama masih Hold)
```

**Keputusan implementasi kedua (flag):** satuan durasi_jasa/additional_days/
hold di sini KALENDER, bukan hari kerja — Ads Management Date adalah konsep
masa-langganan (preseden `lead_time_restock_hari` STRG A-6), berbeda dari
lead time produksi (M16 Rule 6, hari kerja). PRD tidak menyebutkan satuan
eksplisit untuk ini; perlu konfirmasi pemilik.

`durasi_jasa` ditambahkan sebagai kolom GENERIK di `master_service_versions`
(bukan Ads-spesifik) karena M17 §5.4 juga memakainya untuk item MSL AI
Optimizer — jadi satu kolom, dua konsumen. `msl.ts` (`ServiceInput`/
`ServiceView`/`createService`/`updateService`) diperluas untuk membacanya/
menulisnya; route `apps/api/.../master-services` + wire `MasterServiceWire`
ikut diperluas. FE `web-internal/src/lib/types.ts MasterService` + `lib/ads.ts
AdsManagementDate` (baru) juga diperluas — WAJIB karena
`shape-parity.test.ts` (O43 c) menuntut setiap field wire punya konsumen FE
nyata (bukan Go oracle untuk fitur baru).

Route baru: `GET /api/v1/campaigns/{id}/management-date`,
`PATCH /api/v1/campaigns/{id}/additional-days`.

### LT-43 — Mini/Monthly/Content Analysis

`ads_weekly_reports.jenis_laporan` (`'Weekly'` default | `Mini` | `Monthly` |
`Content Analysis`), PRIMARY KEY diperluas jadi `(brief_id, iso_year, iso_week,
jenis_laporan)` — beberapa jenis boleh hidup berdampingan untuk minggu ISO yang
sama (mis. Weekly DAN Monthly di-file bersamaan saat bulan tutup), tapi jenis
yang SAMA untuk minggu yang sama tetap append-only-once. `listWeeklyReports`/
`fileWeeklyReport` dapat parameter `jenis` opsional (default `'Weekly'`) —
mekanisme SAMA, tidak dibangun ulang. Route `GET .../weekly-reports?jenis=`.

### LT-50 — `packages/domain/src/req.ts` (Permintaan, REQ-)

Berkas baru, pola `internaltask.ts` (TSK-) sedekat mungkin. Perbedaan
struktural: `client_id`/`brief_id`/`service_id`/`tujuan_divisi`/
`tujuan_employee_id`/`cpr_id`. Helper SQL baru `add_working_days(d_from, n)` —
companion TERBALIK `working_days_between` yang sudah ada (yang itu menghitung
MUNDUR/selisih; ini MAJU/tanggal jatuh tempo), satu definisi hari kerja untuk
keduanya (Sen-Jum minus `hari_libur`).

**Keputusan implementasi (flag untuk DECISIONS.md):** spec M16 §5.5 menulis
tujuan `Contract Creator` hanya sebagai "(KOL)" tanpa menyebut divisi TUJUAN
eksplisit (beda dengan `Top-up Saldo (Ads → AM)` dan `Creator Payment Approval
(KOL → Finance)` yang eksplisit). Diimplementasikan **routing ke AM pemilik
klien** (sama seperti Top-up Saldo) sebagai default paling dekat — perlu
diverifikasi pemilik.

`canProcess` mengizinkan SIAPA PUN di divisi tujuan (bukan hanya lead) untuk
memproses/menyelesaikan/menolak — karena Creator Payment Approval menuju
Finance sebagai DIVISI (bukan pegawai bernama), membatasi ke "lead saja" akan
membuat staff Finance biasa tidak bisa memproses antrean timnya sendiri.

Route: `POST/GET /api/v1/permintaan`, `GET/POST /api/v1/permintaan/{id}` +
`/proses` + `/selesai` + `/tolak`, `GET /api/v1/clients/{id}/permintaan`.

### LT-51 — role_mappings AI Optimizer + Store Operation

**Ditemukan: TIDAK BUTUH migrasi atau kode apa pun.** `role_mappings` TERNYATA
sudah 100% dikelola lewat admin UI generik (`admin.ts upsertRoleMapping`), yang
menerima `division` sebagai STRING BEBAS tanpa validasi terhadap daftar
tertutup — sudah mendukung `division='AI Optimizer'`/`'Store Operation'` sejak
`division_registry` didaftarkan di fondasi F, tanpa perubahan apa pun. Tidak
ada migrasi manapun yang men-seed `role_mappings` (semua row dibuat Director
lewat UI, sesuai jabatan HRIS riil yang tidak boleh saya karang). LT-51
selesai murni lewat verifikasi, tercatat di sini sebagai temuan.

### LT-52 — asset_type `AI Video` + `Optimasi SKU`

**Temuan penting:** "3 fungsi agregat SQL" yang disebut backlog TERNYATA satu
fungsi `wrr_aggregate(p_recap_id text)` yang di-`CREATE OR REPLACE` TIGA KALI
berturut oleh tiga migrasi lama (masing-masing menyalin ulang seluruh isi
fungsi + menambah bagiannya sendiri — Postgres tidak bisa "tempel section").
Definisi yang benar-benar HIDUP hanyalah migrasi TERAKHIR
(`20260814060000_t4b_cpl.sql`). Migrasi LT-52/LT-55 saya (`20260831060000`)
meng-CREATE-OR-REPLACE SEKALI LAGI dengan isi identik + dua nilai baru di
FILTER list + blok divisi AI Optimizer — jadi efektif "memperluas ketiganya"
tanpa mengedit migrasi lama (immutable, aturan rumah). Dicatat sebagai temuan,
bukan penyimpangan.

`assets.asset_type` TERNYATA tidak punya CHECK constraint DB maupun union type
TS (diverifikasi eksplisit) — jadi tidak ada skema lain yang perlu diperluas.

### LT-53 — Item MSL

Dua baris master service baru (`AI Video`, `Optimasi SKU`) via migrasi seed
idempoten (pola `20260806050000`), `durasi_jasa=30` hari (nilai awal, bisa
diubah Admin), `requires_strategy_plan=true` HANYA untuk `Optimasi SKU`
(karena "Ambil SKU" menarik dari STRG E-3 — tanpa Strategi Aktif tidak ada SKU
untuk digarap), `false` untuk `AI Video` (pipeline-nya tidak bergantung STRG).

### LT-54 — Sinkron SKU balik ke STRG

Fungsi baru `syncAiOptimizerSkuRevision(sql, actor, clientId, briefId,
changes[])` di `strategi.ts` (file milik B). Per SKU: resolve STRG Aktif klien
yang benar-benar punya pilar `jenis='sku'` dengan SKU itu (klien bisa punya
lebih dari satu kontrak Full-Management Aktif — DECISIONS.md 2026-08-28
"STRG list yg ada di akun tersebut"), kelompokkan per STRG, `openRevision`
(trigger `'lainnya'` — katalog H-2 pemersatu) lalu merge field yang berubah ke
`strategi_pillar.detail`, tulis audit_log dengan AKTOR SUNGGUHAN (bukan
SYSTEM), lalu `submitStrategi` (Diajukan) — TIDAK auto-approve, mengantre
persetujuan manusia yang SAMA seperti revisi manual manapun (Rule 4: "tidak
menembus aturan freeze/approval STRG"). Kegagalan per-STRG (SKU tak ditemukan,
revisi lain sedang in-flight, trigger H-2 tak dideklarasikan, aktor bukan AM
pemilik) di-catch dan dilaporkan `ditunda` per SKU — TIDAK melempar error yang
menggagalkan seluruh batch atau memaksa Brief AI Optimizer gagal selesai
(M17 §4 Rule 4).

**TEMUAN PENTING (flag untuk DECISIONS.md — berpotensi signifikan):**
`openRevision` mewajibkan `asumsiGugur` (menyebut assumption code yang
"gugur") kapan pun Strategi punya BARIS `strategi_assumption` SAMA SEKALI
(Rule 13(c)), terlepas statusnya. Sinkronisasi otomatis AI Optimizer TIDAK
PUNYA assumption yang masuk akal untuk disebut gugur — perbaikan listing SKU
bukan tentang asumsi klien yang runtuh. Karena fungsi ini SENGAJA tidak pernah
mengarang nilai `asumsiGugur`, **setiap klien yang punya SATU SAJA baris
`strategi_assumption` (Section D-8) — yang dalam praktiknya kemungkinan besar
SEMUA klien aktif — akan selalu mendapat hasil `ditunda` dengan alasan
`MSG_REVISION_INCOMPLETE`, bukan `synced`.** Ini bukan bug implementasi;
ini konsekuensi jujur dari menolak memalsukan data. Tapi artinya LT-54, seperti
ditulis, mungkin TIDAK PERNAH benar-benar mencapai `synced` untuk klien nyata
manapun sampai pemilik memutuskan salah satu:
(a) `openRevision` diberi jalur "tanpa D-8" untuk revisi non-D-8-related, atau
(b) sinkronisasi AI Optimizer memang dimaksud SELALU menunggu manusia membuka
    revisi secara manual (mengutip alasan sungguhan) lalu AI Optimizer hanya
    mengisi kontennya, bukan membuka revisinya sendiri.
**Test unit LT-54 membuktikan kedua jalur (`synced` DAN `ditunda` karena ini)
secara eksplisit** — lihat `strategi.test.ts describeDb('syncAiOptimizerSkuRevision…')`.

### LT-55 — baris `wrr_divisi` AI Optimizer

`recap.ts DIVISIONS` SUDAH `division.kuotaSatuanNames()` sejak Tahap F — nol
perubahan TS dibutuhkan. Hanya CHECK constraint DB yang perlu diperluas (lihat
temuan di bawah) + blok baru di `wrr_aggregate` (sama migrasi dengan LT-52).

### Temuan lintas-tiket: CHECK constraint DB yang terlewat Tahap F

`wrr_divisi.ck_wrr_divisi_nama`, `wrr_catatan_divisi.ck_wrr_catatan_divisi_nama`,
dan `strategi_dispatch.ck_strdisp_divisi` MASIH hardcode
`('Creative','Ads','KOL','Live Stream')` — TIDAK terdaftar di F-3 (yang hanya
membereskan 9 tempat TS). Ini memblokir `'AI Optimizer'`/`'Store Operation'` di
level DB walau `division_registry`+`recap.ts` sudah menerimanya sejak F.
Diperluas di migrasi `20260831060000` (bukan gate F — perlu di-flag untuk
DECISIONS.md sebagai gap Tahap F yang ditambal B, bukan penyimpangan disengaja).

## Gate hitung — status transisi (JANGAN diperbaiki sekarang)

Per §4 `PARALEL_M16_DUA_AKUN.md`, `scripts/db-rebuild.sh` (dan gate kembar di
`.github/workflows/ci.yml`) untuk **tabel/entity_prefix/sm_machines/notif_events**
adalah **"F saja"** — angkanya HANYA direkonsiliasi sekali di langkah
penggabungan §5, setelah kedua stream digabung dan jumlah SEBENARNYA diketahui.

Solo-run stream ini SENGAJA menyisakan DUA baris gagal (bukti migrasi saya
sendiri diterapkan bersih, verifikasi lain semua hijau):
- `tabel public`: 124, bukan 123 (+1 tabel `permintaan`)
- `sm_machines`: 24, bukan 23 (+1 mesin `permintaan`)

**`master_services` (4→6) SUDAH saya perbaiki di kedua file** (bukan bagian
dari 4 gate F-only) — itu murni assertion isi fixture seed Alpha Digital yang
langsung terkena dua item MSL baru saya, tidak overlap dengan Akun A.

**Di langkah penggabungan (§5, saya yang menjalankan):** setelah merge Akun A +
Akun B, hitung ulang SEMUA gate dari database gabungan yang sebenarnya
(`select count(*) from information_schema.tables ...`, dll — JANGAN menjumlahkan
delta secara manual, karena Akun A mungkin menambah tabel/mesin yang jumlahnya
tidak saya ketahui persis), lalu tulis angka final ke `scripts/db-rebuild.sh`
DAN `.github/workflows/ci.yml` dalam SATU commit.

## Berkas milik Akun A yang perlu disambungkan (JANGAN saya edit sendiri sebelum cek merge)

- **`packages/domain/src/stage.ts`** (eksklusif Akun A): tahap `Terapkan` pada
  pipeline `optimasi_sku` (mesin tahapan AI Optimizer, di-seed Akun A) perlu
  SATU pemanggilan ke `strategi.syncAiOptimizerSkuRevision(sql, actor, clientId,
  briefId, changes)` saat transisi MASUK ke tahap `Terapkan` — `changes[]`
  (daftar `{sku, field, before, after}`) harus dikumpulkan Akun A dari
  mekanisme kerja tahap `Perbaikan` (belum ada spesifikasinya di PRD M17 —
  kemungkinan disimpan sementara di `detail` Brief atau Asset selama
  pengerjaan, lalu dibaca saat masuk `Terapkan`). **Kontrak fungsi sudah siap
  dipakai** (lihat signature + docblock di `strategi.ts`); saya BELUM
  menyambungkan panggilannya dari `stage.ts` karena itu file eksklusif Akun A.
  **Kalau belum tersambung saat saya sampai di langkah penggabungan §5, saya
  yang akan menyambungkannya** (satu baris panggilan di titik transisi
  `Terapkan`), dicatat sebagai bagian dari langkah penggabungan bukan
  pelanggaran kepemilikan berkas (kedua stream sudah selesai di titik itu).
- **`docs/STATE_MACHINES.md` §14** (Ad Campaign) — diupdate sendiri (bukan
  eksklusif §3), murni deliverable Ads (LT-40).

## Ambiguitas/keputusan/temuan untuk dipindah ke DECISIONS.md saat merge

Ringkasan (detail lengkap ada di tiap tiket di atas):

1. **LT-42** — Ads Management Date pakai kolom BARU (bukan `end_date` lama),
   dan satuannya KALENDER bukan hari kerja. Kedua pilihan implementasi, perlu
   konfirmasi pemilik.
2. **LT-50** — `Contract Creator` routing default ke AM (spec tidak eksplisit).
3. **LT-52** — "3 fungsi agregat" ternyata 1 fungsi diredefinisi 3x; migrasi
   4 ditambahkan alih-alih mengedit yang lama.
4. **LT-54** — gap signifikan: `openRevision`'s Rule 13(c) (asumsi gugur wajib)
   membuat sinkronisasi otomatis defer untuk hampir semua klien nyata. Butuh
   keputusan pemilik (jalur baru di `openRevision`, atau desain ulang alur
   "manusia buka revisi, AI Optimizer hanya isi konten").
5. **Gap Tahap F** — 3 CHECK constraint DB (`wrr_divisi`, `wrr_catatan_divisi`,
   `strategi_dispatch`) yang lolos dari F-3 tapi menghadang divisi baru di
   level DB. Ditambal migrasi B, dicatat sebagai gap bukan penyimpangan.
6. **Setup branch** — container awalnya salah init (lihat "Setup note").

## Yang SENGAJA tidak dibangun (di luar cakupan efektif)

- **FE Ads/Permintaan penuh** (halaman `/ads/*` untuk Tipe Iklan/Ads
  Management Date/jenis laporan; halaman `/permintaan` untuk antrean/aksi) —
  TIDAK dibangun. Hanya type declarations minimal (`web-internal/src/lib/
  ads.ts AdsManagementDate`, `permintaan.ts` baru lengkap dengan fungsi
  `api.get/post` wrapper) ditambahkan SEMATA supaya `shape-parity.test.ts`
  (O43 c) punya konsumen FE nyata untuk setiap field wire baru — bukan UI
  yang dipakai pengguna. `permintaan.ts` sudah punya seluruh fungsi client
  (`listPermintaanQueue`, `createPermintaan`, `prosesPermintaan`, dll) siap
  dipakai halaman kapan pun dibangun.
- Ini murni keputusan skala/waktu, bukan keputusan produk — dicatat di sini
  supaya terlihat jelas saat merge, dan Direktur/pemilik bisa memutuskan
  apakah FE ini masuk tiket lanjutan.

## Log kemajuan

- [x] LT-40 state Setting ADC-
- [x] LT-41 Tipe Iklan
- [x] LT-42 Ads Management Date
- [x] LT-43 Mini/Monthly/Content Analysis
- [x] LT-50 entitas REQ-
- [x] LT-51 role_mappings AI_OPT/STORE_OPS (verifikasi — nol kode)
- [x] LT-52 asset_type 3 fungsi agregat
- [x] LT-53 item MSL
- [x] LT-54 sinkron STRG
- [x] LT-55 wrr_divisi AI Optimizer
- [x] Route apps/api + wire (ANCHOR WIRE B) + FE type minimal (shape-parity)
- [x] db-rebuild.sh --yes + full test suite (bersih setelah rebuild fresh)
- [ ] Menunggu Akun A push ke `claude/m16-akun-a-tahapan-metrik` → langkah
      penggabungan §5 (saya yang menjalankan)

## Catatan proses: flakiness test suite saat DB tidak di-rebuild ulang

Selama development, menjalankan file test individual berulang kali TANPA
rebuild DB di antaranya menyebabkan 2 test gagal (`admin.test.ts` hari_libur
audit count, `client.test.ts` Hold Service audit count) — keduanya memakai ID
TETAP (bukan namespaced per-run), jadi row menumpuk lintas invocation manual
saya. **Bukan regresi kode** — dikonfirmasi hijau kembali 100% setelah
`scripts/db-rebuild.sh --yes` dijalankan ulang. Dicatat di sini murni supaya
langkah penggabungan tidak salah sangka kalau melihat pola serupa — selalu
`db-rebuild.sh --yes` dulu sebelum menyimpulkan dari test run manapun.
