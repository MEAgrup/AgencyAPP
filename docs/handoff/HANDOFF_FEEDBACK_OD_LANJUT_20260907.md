# Handoff — lanjut build Feedback OD (Jalur A sisa + penggabungan B)

> **Ditulis 2026-09-07, sesudah PR #310 di-merge.** Ini titik mulai untuk sesi
> berikutnya. Baca §1 dan §2 sampai habis sebelum menyentuh apa pun.
>
> Rencana induknya `docs/handoff/PARALEL_FEEDBACK_OD_DUA_AKUN.md` (disetujui
> pemilik 2026-09-07) — masih berlaku apa adanya, jangan diketok ulang.

---

## 1. Posisi branch — persisnya

| Apa | Nilai |
|---|---|
| **`main` sekarang** | `b309e3bc` — *Merge PR #310: fondasi F + Jalur A (A-5, A-1, A-2)* |
| **Branch Jalur A** | `claude/cdps-user-feedback-account-a-igix3n` — sudah **fast-forward ke `b309e3bc`**, identik dengan `main`, nol commit menggantung |
| **Commit fondasi F** | `b240f47d` (di dalam `main`) |
| **Branch Jalur B** | `claude/cdps-user-feedback-70vbho-b` — **BELUM di-merge**, 3 commit di atas `b240f47d` |
| **Branch pekerjaan Finance** | `claude/handoff-gelombang-d-lanjutan-m3qc8n` — **BELUM di-merge**, `bc09d328` |
| PR yang sudah selesai | [#310](https://github.com/MEAgrup/AgencyAPP/pull/310) — merged |

**Kalau melanjutkan Jalur A:** branch `claude/cdps-user-feedback-account-a-igix3n`
sudah bersih dan sejajar `main`. Lanjutkan di situ, atau buat branch baru dari
`main` — dua-duanya aman karena tidak ada commit yang belum ter-merge.

```
git fetch origin
git checkout claude/cdps-user-feedback-account-a-igix3n
git reset --hard origin/main     # sudah sama, ini cuma penegasan
```

### Yang SUDAH di `main` (13 commit, PR #310)

| # | Commit | Isi singkat |
|---|---|---|
| F-2 | `25fb3f12` | `financeQueue`/`loadTransactionAggregate` join clients → `toko` |
| F-2 | `0390aadb` | migrasi `20260922100000` 4 fungsi `private.*`; `briefCols` bawa identitas klien+PIC |
| F-1 | `aa908cbc` | `wire.ts` field baru + **2 anchor**; tipe FE ikut |
| F-3+F-5 | `af12237a` | katalog **v15** 4 event; gate `notif_events` 69 → **73** di 2 berkas |
| F-4 | `2aa77ed6` | migrasi `20260922100200` kolom `briefs` + 3 CHECK |
| F-6 | `352d9fb1` | `DECISIONS.md` K-1…K-7, O57(b) separuh, **O75** + **O76** |
| F-7+F-8 | `b240f47d` | 2 anchor `nav.ts` + 2 file handoff ← **titik cabang Jalur B** |
| — | `74e1e92e`, `98f94dcc`, `808b9ab5` | rencana induk dibawa ke pohon, SHA F dicatat, irisan Gelombang D dipetakan |
| A-5 | `8dabef67` | AM pilih DIVISI saja (K-1 sisi AM) — **membuka B-4** |
| A-1 | `cba8dcf4` | antrean Finance menyebut nama toko |
| A-2 | `6adb59c0` | request pembayaran creator sampai ke antrean Finance + migrasi `20260922100300` |

---

## 2. ⛔ SUPABASE LIVE — belum, dan urutannya BERBEDA dari preseden 186

**Nol migrasi di-apply ke live dari sesi ini. Nol `supabase db push`.** Aturan
emas §0 #4: hanya langkah penggabungan yang push ke live, **per berkas** lewat
`apply_migration`, dalam urutan nama.

**Keadaan live terverifikasi** (`list_migrations` pada proyek `CDPS SG`,
`egddxfcnrtecheiykhlf`, dibaca 2026-09-07): entri terakhir
`d0_store_management_qty_durasi`. Artinya live mutakhir sampai migrasi terakhir
yang sudah ter-merge sebelum PR #310, dan **empat migrasi di bawah belum ada di
live**:

| Urutan | Berkas | Isi | Menghapus sesuatu? |
|---|---|---|---|
| 1 | `20260922100000_f2_private_brief_client_dan_pic.sql` | 4 fungsi `private.*` | tidak — aditif |
| 2 | `20260922100100_f3_notif_feedback_od.sql` | katalog v15, 4 baris `notif_events` + 1 `notif_catalog_versions` | tidak — aditif |
| 3 | `20260922100200_f4_briefs_jendela_budget_sumber.sql` | 4 kolom `briefs` + 3 CHECK + 1 FK + 1 indeks | tidak — aditif, semua nullable |
| 4 | `20260922100300_a2_rls_cpr_lengan_finance.sql` | lengan divisi Finance pada `creator_payment_requests_select` | tidak — policy dilebarkan |

### ⚠️ Bacaan yang berbeda dari preseden 186 — jangan ikut buta

Ketokan pemilik untuk 186/187/188 adalah **merge → tunggu deploy READY → baru
apply**. Alasannya: **186 MENGHAPUS kolom** (`durasi_jasa`), jadi kode lama harus
berhenti memakainya lebih dulu.

**Keempat migrasi di atas tidak menghapus apa pun** — semuanya aditif — dan kode
BARU-nya justru **membutuhkan** mereka:

- tanpa #1, setiap baca Brief memanggil `private.brief_client_id` yang belum ada
  ⇒ **500 di seluruh antrean divisi dan halaman Brief**;
- tanpa #2, invariant O55 di live tidak konsisten dan emitter v15 tidak punya
  event-nya;
- tanpa #4, panel "Permintaan ke Finance" **kosong** untuk Finance (baris CPR
  tidak terlihat) — persis cacat yang A-2 perbaiki.

⇒ **Apply keempatnya SEBELUM (atau bersamaan dengan) deploy**, bukan sesudah.
Karena aditif, mereka aman dijalankan mendahului deploy: kode lama tidak tahu
mereka ada.

### Verifikasi sesudah apply — jangan percaya `success: true`

```sql
-- 1. keempat fungsi private.* ada
select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='private'
   and proname in ('service_client_id','brief_client_id','client_toko','brief_client_toko');
-- harus 4 baris

-- 2. katalog v15 (invariant O55 harus tetap seimbang)
select (select count(*) from notif_events) as events,
       (select coalesce(sum(event_count),0) from notif_catalog_versions) as registry;
-- keduanya harus 73 DAN sama
select event_type, resolver from notif_events where catalog_version = 15 order by 1;
-- 4 baris: m6.brief.selesai · m6.brief.siap_review_am ·
--          m9.booking.jatuh_tempo · m9.campaign.mendekati_akhir

-- 3. kolom briefs + constraint-nya
select column_name from information_schema.columns where table_name='briefs'
   and column_name in ('tanggal_mulai','tanggal_akhir','budget','source_creative_brief_id');
-- 4 baris
select conname from pg_constraint where conname in
  ('ck_briefs_jendela_urut','ck_briefs_budget_non_negatif',
   'ck_briefs_sumber_bukan_diri','fk_briefs_source_creative_brief');
-- 4 baris

-- 4. lengan Finance pada policy CPR
select pg_get_expr(polqual, polrelid) from pg_policy p
  join pg_class c on c.oid=p.polrelid
 where c.relname='creator_payment_requests' and polcmd='r';
-- harus memuat: jwt_division() = 'Finance'

-- 5. gate tabel TIDAK boleh berubah
select count(*) from information_schema.tables
 where table_schema='public' and table_type='BASE TABLE';
-- harus 146
```

> Catatan O65 yang masih berlaku: **ledger live memakai stempel waktu APPLY**,
> bukan nama berkas repo (lihat daftar `list_migrations` — `20260907095709` untuk
> berkas `20260921010000_...`). Itu sebabnya `supabase db push` terlarang: ia
> membandingkan ledger yang memang berbeda wholesale.

---

## 3. Sisa pekerjaan Jalur A — dua item, keduanya berdiri sendiri

Tidak memblokir Jalur B, dan tidak saling memblokir.

### A-3 · Status CRO mentok `[Awaiting Onboarding]` — akar terdalam Account #5

Jalur pengiriman yang **diputuskan** (STRG- M6A + Plan M6B) tidak pernah
menyentuh mesin status `service`. Yang menyentuhnya jalur lama `STR-`, dan itu
di-hide `SHOW_LEGACY_STR_PATH = false`. Akibatnya `services.status` tak pernah
bergerak dan `guardBriefCreation` menolak Brief dengan
`[layanan ini wajib memiliki Strategy & Plan yang disetujui sebelum dibuatkan Brief]`
**padahal STRG- sudah `Aktif`**.

Yang harus dikerjakan (semua berkas milik Jalur A):
- `strategi.approveStrategi` — transisi Service `[Awaiting Onboarding] → [Strategy Approved]`
  dalam transaksi yang sama. **Tiru persis** `account.approveStrategy` (`account.ts:1009-1016`).
- `account.guardBriefCreation` — STRG- `Aktif` ikut membuka gerbang.
- `web-internal/src/lib/account.ts` — `ServiceQueueRow` tambah `strategi_id`/`strategi_status`;
  `nextOnboardingStep` baca jalur STRG- supaya AM berhenti melihat "Buat Strategy & Plan"
  untuk Strategi yang sudah jadi.
- **Migrasi backfill** stempel `…T10####`: Service ber-STRG- `Aktif` tapi masih
  `[Awaiting Onboarding]` didorong lewat `sm_transition` dengan aktor sistem —
  **bukan `UPDATE` mentah** (aturan rumah #2/#3).
- Perbarui catatan `docs/STATE_MACHINES.md:132` yang menyatakan lubang ini.

**Tes yang wajib** (rencana §6): **tes jahitan** — setujui STRG- → buat Brief →
**tidak 409**. Satu tes yang memanggil KEDUA sisi sungguhan; tes unit di kedua
sisi bisa hijau sementara jahitannya putus.

### A-4 · Durasi kerja sama pindah dari CRO ke closing Sales (ketokan K-2)

Hari ini satu-satunya UI yang menulis `contracts.durasi_bulan` adalah **form
Strategi milik AM** (`account/services/[id]/page.tsx` "Durasi kontrak (bulan)")
→ `contract.ensureContractForService`. `sales.ClosingInput` tidak punya field
durasi sama sekali, dan `sales.close` **tidak pernah mencetak baris `contracts`**.

- `ClosingInput` tambah `durasiBulanOverride?` + `alasanOverride?` (pakai
  `managedSince` yang sudah ada sebagai tanggal mulai).
- `sales.close` — cetak baris `contracts`. Durasi diturunkan
  `MAX(master_service_versions.durasi_bulan)` atas layanan yang ditutup (K-2);
  override menang bila diisi, **alasan wajib**. `tanggal_akhir` lewat
  `tz.addMonthsToDate` (kalender-aware, clamp akhir bulan) — **bukan `+30 hari`**.
- Rambatkan: `attempts/[id]/close/route.ts`, `web-internal/src/lib/sales.ts`,
  `sales/[id]/page.tsx`.
- Form Strategi jadi **read-only** untuk ketiga field itu.

**Tes yang wajib**: durasi turunan `MAX(durasi_bulan)`; override menang + alasan
wajib; tanggal akhir kalender-aware (**mulai tgl 31 ⇒ `tz.addMonthsToDate`**).

> ⚠️ A-4 bersinggungan dengan katalog MSL yang baru diisi Gelombang D
> (`durasi_bulan` untuk 80 layanan, migrasi 187). Datanya sudah ada — **jangan
> tambah field**, cukup dibaca.

---

## 4. Penggabungan Jalur B — SUDAH DISIMULASIKAN, jauh lebih bersih dari dugaan rencana

`claude/cdps-user-feedback-70vbho-b` punya **4 commit** di atas `b240f47d`:

| Commit | Isi |
|---|---|
| `f52aa0f3` | Jalur B pra-F — gerbang QC lead Creative (B-4), picker aset Ads (B-5), progres KOL (B-3) |
| `6e95e3ab` | B-1 dan B-2 — rollup yang diam sekarang bersuara, dan AM diberi tahu |
| `e4424ddf` | B-3 tick pengingat KOL + B-5 filter Brief sumber tersambung |
| `58bc99c3` | fix(ads): filter Brief sumber B-5 tidak pernah berlaku — jebakan O52 di jalur bacanya |

Migrasinya memakai blok stempel yang benar (`…T20####`) — **4 berkas**:
`20260922200000`, `20260922200100`, `20260922200200`, `20260922200300`. **Nol
tabrakan** dengan `…T10####` milik A. Urutan apply gabungan deterministik menurut
nama: `…100000 → …100100 → …100200 → …100300 → …200000 → …200100 → …200200 →
…200300`.

### Hasil simulasi merge kering (`git merge-tree origin/main <branch-B>`)

**Satu konflik saja, dan itu sebuah dokumen:**

```
CONFLICT (content): docs/handoff/HANDOFF_FEEDBACK_OD_JALUR_B.md
```

Itu file handoff milik B sendiri yang A buat di F-8 lalu A sunting lagi (SHA F).
Resolusinya sepele: simpan isi B, pastikan blok SHA F tetap benar.

**Berkas yang berpotensi bertabrakan tapi TERNYATA BERSIH** — dan ini bukan
keberuntungan, ini anchor F-1 yang bekerja:

| Berkas | Hasil |
|---|---|
| `apps/api/src/lib/wire.ts` | 🟢 **bersih.** A menyisip di `ANCHOR-WIRE-KEUANGAN` (~2.860) dan `PermintaanWire` (~6.970); B di `ANCHOR-WIRE-DELIVERY` (~446). Dua anchor berjauhan itu memang untuk ini |
| `apps/api/src/lib/wire.test.ts` | 🟢 bersih — blok tesnya berbeda |
| `scripts/db-rebuild.sh` · `.github/workflows/ci.yml` | 🟢 **B TIDAK menyentuhnya sesudah F** ⇒ **nol konflik counter** |
| `docs/DECISIONS.md` | 🟢 **B TIDAK menyentuhnya sesudah F** ⇒ aturan emas #3 dipatuhi |
| `web-internal/src/app/(shell)/account/services/[id]/page.tsx` | 🟢 B tidak mengubahnya, jadi rebase mengambil versi A-5 apa adanya — **A-5 tidak akan terbalik** |

### Koreksi atas rencana §4 butir 1 — dan atas dugaan gw sendiri

Rencana menulis: *"A merge lebih dulu (jejak counter-nya nol: hanya migrasi RLS +
backfill)"*. **Bagian "jejak counter nol" itu salah** — F-5 menaikkan
`notif_events` 69 → 73. Tapi karena B tidak menyentuh kedua berkas counter,
**praktisnya tetap tidak ada konflik counter.** Yang penting untuk sesi
penggabungan:

1. Rebase/merge B ke `main` (`b309e3bc`) — hanya 1 konflik dokumen di atas.
2. **Sesudahnya jalankan `bash scripts/db-rebuild.sh --yes` dan BACA angkanya.**
   B menambah 4 migrasi; kalau ada yang menambah tabel/prefix/mesin/event, gate
   di `db-rebuild.sh` **dan** `ci.yml` harus dinaikkan **di commit yang sama**.
   Counter itu **absolut, bukan delta**, dan basis `notif_events` sekarang
   **73**, bukan 69. Jangan menebak — ambil angka dari hasil rebuild.
3. **Periksa relasi B-4 ↔ A-5 sesudah merge.** Commit pertama B bernama "pra-F"
   dan mengerjakan B-4, sementara rencana menyatakan B-4 menunggu A-5. Sudah
   diperiksa dan **aman**: nol tes/kode B yang mengirim `assigned_pic` ke
   `createBrief` (yang ada `createAssetBatch` dengan `assignedPic` per-Asset —
   itu justru pintu lead yang K-1 kehendaki). Tetap jalankan suite penuh sesudah
   merge untuk memastikan.
4. B sudah menemukan sendiri satu jebakan O52 di jalur bacanya (`58bc99c3`) —
   pertanda handoff-nya terbaca. Perangkap itu nyata; lihat §7 butir 6.

### Irisan dengan pekerjaan Finance (Gelombang D accrual)

`claude/handoff-gelombang-d-lanjutan-m3qc8n` (`bc09d328`, **belum di-merge**).
Pemetaan per berkas ada di `HANDOFF_FEEDBACK_OD_JALUR_A.md`. Ringkasnya:

- `docs/DECISIONS.md` — 🔴 **akan konflik** dengan F-6. Keduanya murni
  PENYISIPAN di anchor yang sama ⇒ resolusinya **simpan keduanya**, nol baris
  dibuang. Periksa jangan ada baris K-1…K-7 / O75 / O76 yang terbuang.
- `apps/api/src/lib/wire.ts`, `wire.test.ts` — 🟢 hunk mereka di
  `MasterServiceWire` (~33), jauh dari milik A dan B.
- `scripts/db-rebuild.sh` + `ci.yml` — 🟢 **tidak mereka sentuh** (mereka
  menambah KOLOM, bukan tabel/mesin/event).
- Stempel migrasi `20260922010000` — 🟢 menyortir **lebih dulu** dari milik A/B.
- Commit mereka menyebut migrasinya "**190**"; di pohon A 190/191/192 adalah
  migrasi F. Nomor urut itu **narasi per-pohon**, identitasnya nama berkas —
  jangan "membetulkan" salah satunya.

## 5. Utang yang belum dibayar — 6 layar, nol yang pernah dilihat mata

Rencana §6 menutup dengan peringatan dari Gelombang C: *lolos `tsc` + `vitest` +
`next build` tapi tata letaknya tidak pernah dilihat siapa pun.* Utang itu
**belum dibayar** untuk seluruh perubahan render sesi ini.

| Layar | Yang perlu dilihat | Penguji yang tepat |
|---|---|---|
| `/finance` | nama toko baris pertama + `CLI-…` baris kedua; muat di lebar kolom | Finance (keluhan #1) |
| `/finance` | panel "Permintaan ke Finance" — 8 kolom, tanpa scroll horizontal | Finance (keluhan #2) |
| `/finance/transactions/{id}` | header `Klien: Nama Toko (CLI-…)` | Finance |
| `/persetujuan` | kartu "Permintaan ke Finance" | Finance |
| `/kol/payment-requests/{id}` | tombol "Ajukan ke Finance" | KOL |
| `/account/services/{id}` | catatan pengganti field PIC — terbaca sebagai penjelasan, **bukan** error | AM/CRO (keluhan Account #2) |

**Kenapa belum:** repo ini tidak punya harness peramban (nol Playwright di
`scripts/` dan `package.json`; screenshot di `docs/handoff/screenshots/` dibuat
manual). Menegakkan auth + API + dev server hanya untuk memotret satu sel tabel
bukan biaya yang sepadan di dalam satu sesi build. **Kalau sesi berikutnya mau
membayar utang ini, itu pekerjaan tersendiri** — Chromium sudah ada di container
(`/opt/pw-browsers/chromium`, `PLAYWRIGHT_BROWSERS_PATH` sudah di-set), jadi yang
kurang hanya harness + jalur login.

---

## 6. Dua pertanyaan yang MENUNGGU KETOKAN PEMILIK

Keduanya sudah ditulis di `docs/DECISIONS.md` bagian **Open**, dan keduanya
**tidak** memblokir A-3/A-4 atau Jalur B.

- **O75 — Service tidak punya satu pun jalur untuk SELESAI.** Edge
  `[In Execution] → Done` ada di `sm_edges` (`20260723055732`) tapi **nol
  pemanggil di seluruh `packages/domain`**: tidak ada Service yang pernah bisa
  mencapai terminal, jadi setiap Service yang pekerjaannya tuntas menumpuk
  selamanya. Yang perlu diketok: **siapa** yang boleh menutup Service, dan **apa
  gerbangnya** (kontrak habis? seluruh Brief selesai? Finance lunas?).
- **O76 — dari mana floor GMV bulanan datang** (sisa O57 (b) yang K-2 tidak
  tutup). Katalog tidak memuat angka GMV dan `contracts` tidak punya kolom GMV,
  jadi `strategi_target.sumber_floor = 'kontrak'` menunjuk sesuatu yang belum
  ada — dan selama itu benar, **Sanggahan Target (D-7) kehilangan penegaknya**:
  AM menyanggah angka yang AM sendiri ketik.

Selain itu, satu jebakan tes dicatat sebagai **A-T4** (di
`HANDOFF_FEEDBACK_OD_JALUR_A.md`) dan **bukan** regresi: `admin.test.ts`
"hari libur" meng-assert `count(*) = 1` atas `audit_log` tanpa aktor unik, jadi
jalan kedua atas DB yang sama melihat 7 — dan `audit_log` menolak DELETE
sehingga `afterEach` tidak bisa membersihkannya. **Kalau muncul: `db-rebuild`
dulu, baru cari bug.** Polanya sudah ada di repo (`aktorUnik()` di
`showcase.test.ts`); di luar cakupan feedback OD.

---

## 7. Angka acuan verifikasi — naik, tidak pernah turun

Dari `main` `b309e3bc`, seluruhnya hijau:

```
db-rebuild.sh  193 migrasi
  gate: 146 tabel · 40 entity_prefix · 31 sm_machines · 73 notif_events
        + notif_katalog_sesuai
  invariant: ident_checks · immutability_checks · rls_checks · auth_claims_checks

domain            1994 lulus (+1 skip)
core               936
db                  53
apps/api           492
web-internal       650   (+ tsc --noEmit bersih + next build sukses)
web-client-portal   19
```

### Jebakan yang sudah terbukti mahal di sesi ini

1. **`npm run typecheck --workspaces` WAJIB diulang SESUDAH `npm install`, dan
   keluarannya DIBACA.** Ia menangkap galat sungguhan dua kali sesi ini (empat
   fixture `account.Brief` + jalur kelahiran Brief) yang semuanya lolos kalau
   outputnya cuma dilirik.
2. **`cd web-internal && npm install` terpisah.** Tanpa itu `tsc` membanjir
   *"Cannot find module 'xlsx'"* dan galat sungguhan tenggelam.
3. **Jalankan `packages/domain` SENDIRIAN sesudah `db-rebuild`.**
4. **Postgres di container ini butuh password di-set sekali:**
   `su postgres -c "psql -c \"ALTER USER postgres PASSWORD 'postgres';\""`
   sebelum `db-rebuild.sh` bisa jalan. Dan ia **mati sendiri** sewaktu-waktu —
   terjadi dua kali sesi ini. `pg_isready` dulu sebelum menyimpulkan apa pun
   dari `Connection refused` atau dari puluhan FAIL.
5. **Baca policy RLS dari DB, jangan dari `rls_baseline.sql`.** Sudah 190+
   migrasi menumpuk di atasnya — `clients_select` yang hidup jauh lebih lebar
   (lengan Finance, Account lead, Sales lead, Ads) daripada yang tertulis di
   baseline. Asumsi dari baseline hampir membuat F-2 dikerjakan dengan cara yang
   salah.
6. **Perangkap O52, dengan angkanya.** Satu Brief Creative, dibaca sebagai lead
   Creative di bawah RLS: `from briefs` saja **1** baris · `+ join services +
   clients + employees` **0** baris · `+ private.*` **1** baris. Join tidak
   mengosongkan kolom — ia **membuang barisnya**. Fungsi `private.*` yang
   tersedia: `brief_client_id` · `brief_client_toko` · `client_toko` ·
   `service_client_id` · `brief_owner_am` · `service_owner_am` ·
   `employee_display_name`.
7. **Gerbang `rls_checks.sql` §43 (ledger O48) akan MERAH** kalau sebuah policy
   diberi lengan lead/divisi tanpa mengeluarkannya dari daftar `expected` **di
   commit yang sama**. Itu bukan gangguan, itu gerbangnya bekerja.

---

## 8. Cara memulai sesi berikutnya (copy-paste)

```bash
cd /home/user/AgencyAPP
git fetch origin
git checkout claude/cdps-user-feedback-account-a-igix3n
git reset --hard origin/main          # b309e3bc

service postgresql start
su postgres -c "psql -c \"ALTER USER postgres PASSWORD 'postgres';\""
export DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps"
bash scripts/db-rebuild.sh --yes      # harus 193 migrasi, semua gate hijau

npm install
npm run typecheck --workspaces --if-present   # BACA keluarannya
(cd web-internal && npm install)
```

Lalu: **A-3 dulu** (akar terdalam, punya tes jahitan yang jelas), baru **A-4**.
Sesudah keduanya mendarat, Jalur A tutup dan yang tersisa hanyalah §4
(penggabungan B) lalu Wave 3 Store Operation (rencana §3).
