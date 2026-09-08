# Handoff — `STR-` dipensiunkan, live disusulkan, dan koreksi atas kesalahan A-3

> **Ditulis 2026-09-08.** Ini menggantikan §1–§2 `HANDOFF_FEEDBACK_OD_A3_A4_SELESAI_20260907.md`
> soal Supabase live (sudah dikerjakan) dan **mengoreksi** klaim A-3 di sana.
> Baca §1 sampai habis sebelum menyentuh apa pun.

---

## 1. ⛔ KOREKSI — premis A-3 SALAH, dan ia sudah ter-merge sehari

**Yang gw klaim di PR #315:** jalur `STR-` mati, buktinya `SHOW_LEGACY_STR_PATH = false`.

**Yang benar:** flag itu **hanya** menyembunyikan form **BUAT** STR- di satu
halaman (`account/services/[id]`). Pintu **APPROVE**-nya hidup penuh di tempat
yang tidak pernah gw cek:

| Titik | Keadaan sebelum 2026-09-08 |
|---|---|
| `web-internal/src/lib/nav.ts:153` | `/persetujuan` — menu **AKTIF** untuk Sales, Account, Finance, KOL |
| `/persetujuan` seksi "Review Strategi & Plan" | tombol Setujui hidup, confirm-nya **mengiklankan** "Service lanjut ke [Strategy Approved] dan Brief boleh dibuat" |
| `/account/strategies/[id]` | tombol Setujui kedua |
| `POST /api/v1/strategies/[id]/approve` | route melayani |

Jadi selama sehari CDPS punya **dua penulis hidup** ke `services.status`.

### Tabrakannya DIUKUR, bukan diasumsikan

Tes probe (sekali pakai, tidak dibawa ke pohon):

```
STRG- disetujui lebih dulu  ⇒ Service ke [Strategy Approved]
SPV tekan Setujui di /persetujuan pada STR- Service yang SAMA
  ⇒ galat: [transisi status tidak diizinkan]
  ⇒ STR- ter-rollback SELURUHNYA: status tetap [Strategy Submitted for Approval],
     approved_by tetap null
  ⇒ SPV TERKUNCI PERMANEN dari Plan itu, dengan galat yang tidak menyebut apa pun
```

Asimetris: jalur A-3 memfilter `status = '[Awaiting Onboarding]'` jadi ia
melewati diam-diam; `account.approveStrategy` **melempar** dan ter-rollback.

### Kenapa tidak jadi insiden: nol instance di produksi

Dibaca langsung ke `CDPS SG`, bukan diasumsikan:

| Fakta | Angka |
|---|---|
| Service memegang **STR- dan STRG- sekaligus** | **0** ⇒ tabrakan laten, bukan aktif |
| Service ber-STRG- `Aktif` masih `[Awaiting Onboarding]` | **0** (satu-satunya, `SVC-202608-0008`, sudah `[In Execution]`) |
| ⇒ Service yang akan dipindahkan backfill `20260922100400` | **0** — no-op di produksi |
| `strategy_plans` menunggu ACC | **0** (dua baris, dua-duanya sudah `[Strategy Approved]`) |

**Dan keluhan Account #5 bukan pola yang A-3 perbaiki.** 15 Service yang mentok
di `[Awaiting Onboarding]`: 5 `plan_wajib` **nol Strategy jenis apa pun**, 3
punya STRG- yang masih menunggu ACC, 1 G-B belum dijawab, 5 Direct yang cuma
belum dibuatkan Brief. Jejak keluhan itu cuma `SVC-202608-0008`, dan itu sudah
di-workaround sampai `[In Execution]`.

### Pelajarannya, karena ia akan terulang

> **Flag `false` cuma membuktikan SATU pintu tertutup.** Sebelum menyimpulkan
> sebuah jalur mati, **grep route dan nav**, bukan satu halaman. Ditulis juga di
> header `packages/domain/src/strategi.ts`.

Kredit: Jalur B yang menemukannya, dan keempat titiknya benar — diverifikasi
ulang sendiri sebelum ditindak.

---

## 2. Ketokan pemilik 2026-09-08 + apa yang dikerjakan

**Nerissa (COO) ketok: `STRG-` KANONIK, pensiunkan `STR-` sungguhan.**

Dicabut, dalam SATU commit (aturannya: "setengah pensiun lebih buruk daripada
tidak pensiun"):

| Apa | Di mana |
|---|---|
| Seksi "Review Strategi & Plan" | `/persetujuan` — `StrategyCard`, state, entri `SECTION_LABELS` **dan** `jumpTargets` (labelnya dipetakan POSISI-PER-POSISI ke `Promise.allSettled`, jadi dua-duanya) |
| Tiga seksi tulis → pemberitahuan baca-saja | `/account/strategies/[id]` |
| **Lima route tulis → 410 Gone** | `POST /strategies/{id}/{approve,request-revision,submit,approve-gmv}` + `PUT /strategies/{id}` |
| Enam pembungkus FE | `web-internal/src/lib/account.ts` |
| **Flag `SHOW_LEGACY_STR_PATH` + 5 blok matinya (274 baris)** | `account/services/[id]/page.tsx` |
| Klaim yang sudah tidak benar | `qa-jalur-plan/page.tsx` (tabelnya dulu bilang STR- YA / STRG- TIDAK) |

**Yang TETAP hidup:** `GET /strategies`, `GET /strategies/{id}`, dan halaman
detailnya. Dua baris `STR-` di produksi adalah riwayat kesepakatan sungguhan —
riwayat tidak dipensiunkan, hanya pintu majunya (aturan rumah #3).

`account.approveStrategy` **ditahan** di domain, ditandai unreachable: tesnya
adalah catatan bagaimana dua baris itu sampai ke `[Strategy Approved]`, dan kaki
keduanya adalah bentuk yang `strategi.ts` harus tiru.

### Satu jahitan yang nyaris terlewat

Gerbang form Brief di halaman layanan berbunyi
`{(!planGated || approvedStrategy || SHOW_LEGACY_STR_PATH) && (`. Menghapus
flag-nya saja akan **menutup form itu selamanya** untuk layanan tergerbang-Plan,
karena `approvedStrategy` (baris `STR-`) selamanya null di jalur yang diputuskan.
Kondisinya sekarang membaca `strgAktif`. **Kalau lu menyentuh halaman itu,
periksa kondisi ini dulu.**

### Kenapa 410 dan bukan menghapus route

`route-parity.test.ts` menuntut setiap path yang dipanggil FE dilayani API, dan
path yang **hilang** tidak bisa dibedakan dari salah tulis. 404 terbaca "id
salah", 405 "method salah" — dua-duanya mengirim orang mencari bug yang tidak
ada. Alasan + pesan BI-nya di `apps/api/src/lib/retired-str.ts`.

---

## 3. Supabase live — SUDAH disusulkan (dan ada temuan yang bukan punya A-3)

**Temuan yang lebih besar dari masalah A-3:** kode di `main` memanggil
`private.brief_client_id`, `private.client_toko`, dan
`private.brief_source_creative_id` di jalur baca **Brief, antrean divisi, dan
antrean Permintaan** — dan ketiganya **belum ada di live**. Live tertinggal
**10 migrasi** sejak PR #310 (sebelum sesi A-3), diperparah #312. Kalau produksi
menjalankan `main`, ketiga jalur itu 500.

**Diketok Nerissa: apply 9, tunda backfill A-3.** Sudah dikerjakan, per berkas,
urut nama, lewat `apply_migration`:

| # | Berkas | Verifikasi |
|---|---|---|
| 1 | `f2_private_brief_client_dan_pic` | 4 fungsi `private.*` ada; smoke: `brief_client_toko` mengembalikan nama toko sungguhan |
| 2 | `f3_notif_feedback_od` | `notif_events` 69 → **73**, `= sum(event_count)` (O55 seimbang), v15 = 4 baris |
| 3 | `f4_briefs_jendela_budget_sumber` | 4 kolom + 4 constraint |
| 4 | `a2_rls_cpr_lengan_finance` | policy dilebarkan |
| 5 | `b4_gerbang_lead_creative` | edge `brief_task [Submitted]→[Revision Requested]` ada |
| 6 | `b45_assets_select_am_ads` | policy |
| 7 | `b3_kol_reminder_tick` | 3 kolom penanda + trigger + `kol_reminder_tick` + cron harian |
| 8 | `b5_private_brief_source_creative` | fungsi ada |
| 9 | `b1_briefs_select_arm_staff_divisi` | policy |

**Gate live sesudahnya: 146 tabel · 40 prefix · 31 mesin · 73 event — TETAP.**

### ⚠️ `20260922100400` (backfill A-3) SENGAJA BELUM DI-APPLY

Ia satu-satunya yang mengubah **DATA**. Di live ia **no-op** (0 baris memenuhi
kriterianya — diverifikasi), jadi menundanya nol biaya. Sesudah pensiun STR-
mendarat, ia aman di-apply kapan pun; ia juga tetap aman **tidak** di-apply,
karena nol baris yang perlu didorong. Query pemeriksanya:

```sql
select count(*) from services sv
  left join service_plan_gate g on g.service_id = sv.id
 where sv.status = '[Awaiting Onboarding]'
   and exists (select 1 from strategi s
                where s.contract_id = sv.contract_id and s.status = 'Aktif')
   and case when sv.requires_strategy_plan_override is not null
                 then sv.requires_strategy_plan_override
            when g.keputusan_am is not null then g.keputusan_am = 'butuh_plan'
            else sv.plan_tier = 'plan_wajib' end;
-- 0 hari ini. Kalau > 0, backfill-nya baru ada gunanya.
```

---

## 4. A-req-1 · A-req-2 · A-req-3 — SELESAI di sesi ini

Ketiganya dikerjakan sesudah pensiun STR-, urutan sesuai Jalur B. Ringkasnya di
`DECISIONS.md` 2026-09-08; yang perlu dipegang penerus:

- **A-req-1** — `BriefInput`/`Brief` membuka `tanggalMulai`/`tanggalAkhir`/`budget`.
  Nol migrasi (kolom F-4). `validateBrief` mencerminkan kedua CHECK-nya jadi
  pesan BI; budget dinormalkan `money.decimal`.
- **A-req-2** — sisi TULIS saja. `createBrief` mengisi
  `source_creative_brief_id` + picker di form Brief AM (hanya untuk Brief Ads).
  **Nol baris disentuh** di `ads.ts` / AssetPicker / `wire.ts` bagian Campaign.
  Gerbangnya **tiga**: ada, divisi Creative, dan **klien yang sama** — yang
  terakhir mencegah kebocoran, karena `assets_select` lengan Ads-nya **buta
  klien** sehingga kolom inilah satu-satunya yang mempersempit picker.
- **A-req-3** — `jumlahAnak` pada baris antrean, lewat migrasi
  `20260922100500` (`private.brief_jumlah_anak`). Dirender di `/tasks` sebagai
  kolom "Unit Kerja"; `0` ⇒ badge "belum dipecah".
  **Jangan "sederhanakan" jadi `count(*)`.** `briefCols` dibaca di bawah RLS;
  `assets_select` punya lengan `assigned_pic`, jadi staff akan melihat angka
  yang SALAH tanpa galat. Ada tes yang menjalankannya di bawah RLS dan menuntut
  angka penuh.

### ⚠️ Utang yang DITEMUKAN sesi ini, belum dibayar

**Ada EMPAT bentuk `Brief` paralel di FE** — `lib/account.ts`, `lib/tasks.ts`,
`lib/creative.ts`, `lib/kol.ts` — dan hanya `account.ts::Brief` yang diikat
`shape-parity.test.ts` ke `BriefWire`. Keempatnya disuapi wire yang **sama**,
jadi setiap field Brief baru harus ditambahkan di **dua** tempat minimal, atau
halaman yang membaca bentuk tak-ber-anchor itu melihat `undefined` **sementara
parity tetap hijau**. Sesi ini menambahkannya ke `account.ts` + `tasks.ts`
(yang dirender); `creative.ts` dan `kol.ts` belum. Menyatukannya adalah
pekerjaan tersendiri.

---

## 4b. (riwayat) Rincian ketiga A-req sebagaimana Jalur B menuliskannya

Ketiganya **tidak** tersentuh temuan STR-/STRG- dan nol di antaranya menunggu
ketokan. Masing-masing satu-dua baris per tempat, dan masing-masing membuka satu
sisa Jalur B yang **sisi bacanya sudah mendarat di #312**.

### A-req-1 · `BriefInput`/`Brief` buka `tanggalMulai`/`tanggalAkhir`/`budget`
Keempat kolomnya **sudah ada** dari F-4 ⇒ **nol migrasi baru**, murni jalur TS.
`brief-inherit.planRowToBriefInput` sudah siap mengisinya — **jangan sentuh**,
cukup buka `BriefInput`-nya.

### A-req-2 · sisi TULIS `source_creative_brief_id` SAJA
**Sisi bacanya SUDAH SELESAI PENUH di #312** (19 hit: `ads.ts` 284/381/449/1039,
`wire.ts` 1040/1061, `ads.test.ts` 210-291, AssetPicker). Yang kurang: isi
`briefs.source_creative_brief_id` di `account.createBrief` + picker-nya di form
Brief AM. **Jangan bangun jalur bacanya** (duplikat), **jangan sentuh** `ads.ts`
/ AssetPicker / bagian Campaign di `wire.ts`. Begitu kolomnya terisi, filter K-3
hidup tanpa satu baris pun berubah.

### A-req-3 · satu field jumlah anak pada BARIS ANTREAN
`listDivisionQueue` + `wire.ts`. **Bukan** rute baru — memanggil
`GET /briefs/{id}/rollup` per baris antrean adalah N+1.
⚠️ Ada `createdCount` di `creative/briefs/[id]/page.tsx:335`, tapi itu **variabel
FE lokal di halaman DETAIL** yang menghitung aset ter-fetch — **bukan** field
pada baris antrean. Jangan tertipu dan berhenti.

---

## 5. Angka acuan — naik, tidak pernah turun

```
db-rebuild.sh  202 migrasi
  gate: 146 tabel · 40 entity_prefix · 31 sm_machines · 73 notif_events  ← TETAP
  invariant: ident_checks · immutability_checks · rls_checks · auth_claims_checks

domain            2101 lulus (+1 skip) · 76 file · nol FAIL   (dari 2039)
core               983
db                  53
apps/api           445 lulus (+48 skip)   route-parity & shape-parity hijau
web-internal       684   (+ tsc --noEmit bersih + next build sukses)
web-client-portal   19
```

### Jebakan yang sudah terbukti mahal

1. **Flag `false` ≠ jalur mati.** §1. Ini yang paling mahal sesi ini.
2. **`SECTION_LABELS` di `/persetujuan` dipetakan POSISI-PER-POSISI** ke array
   `Promise.allSettled`. Mencabut satu antrian berarti mencabut dari
   **keduanya**, di posisi yang sama — kalau tidak, galat satu antrian dilabeli
   nama antrian lain.
3. **`noUnusedLocals` MATI** di `web-internal`. `tsc` hijau **tidak** berarti nol
   handler mati. Sesudah mencabut JSX, grep handler + state-nya sendiri.
4. **Backtick di komentar SQL yang ada di template literal memutus template-nya.**
   Penjelasan SQL taruh di JSDoc, jangan di dalam string-nya.
5. **A-T4**: jalan kedua suite domain atas DB yang sama memberi FAIL palsu
   (`admin.test.ts` "hari libur", `client.test.ts` "Hold Service"). `db-rebuild`
   dulu, baru cari bug.
6. **Subquery yang diblokir RLS tidak melempar** — ia diam-diam `NULL`. Lebih
   buruk dari 404 O52: halaman menjawab 200 dengan nilai salah.

---

## 6. Cara memulai sesi berikutnya

```bash
cd /home/user/AgencyAPP
git fetch origin && git checkout main && git reset --hard origin/main

service postgresql start
su postgres -c "psql -c \"ALTER USER postgres PASSWORD 'postgres';\""
export DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps"
bash scripts/db-rebuild.sh --yes      # 201 migrasi, semua gate hijau

npm install
npm run typecheck --workspaces --if-present   # BACA keluarannya
(cd web-internal && npm install)
```

Lalu **A-req-1 → A-req-2 → A-req-3** (§4). Sesudahnya Wave 3 Store Operation.

**Masih menunggu ketokan pemilik:** O75 (Service nol jalur untuk SELESAI) dan
O76 (dari mana floor GMV datang). A-4 **tidak** menutup O76.

**Utang layar: 8, nol yang pernah dilihat mata.** Sesi ini menambah dua lagi
(pemberitahuan pensiun di `/account/strategies/[id]`, dan `/persetujuan` tanpa
seksi Strategi). Nol harness peramban di repo; Chromium ada di
`/opt/pw-browsers/chromium`.
