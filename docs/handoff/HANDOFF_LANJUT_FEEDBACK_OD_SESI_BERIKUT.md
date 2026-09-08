# Handoff — lanjut Jalur B sesudah PR #312 MERGE

> Dibuat sesi Jalur B, 2026-09-07, diperbarui 2026-09-08 saat PR #312 di-merge
> atas perintah pemilik. **Baca ini lebih dulu di chat berikutnya**, lalu
> `HANDOFF_FEEDBACK_OD_JALUR_B.md` untuk detail per keputusan.
>
> Rencana induk: `docs/handoff/PARALEL_FEEDBACK_OD_DUA_AKUN.md`.
>
> ## Angka terverifikasi di `main` gabungan (`a78f12be`), 2026-09-08
>
> Dijalankan SESUDAH kedua PR merge, bukan diwarisi dari salah satu PR:
> **201 migrasi**, gerbang **146 tabel · 40 entity_prefix · 31 sm_machines ·
> 73 notif_events** (tidak bergeser), keempat invariant SQL hijau. Suite:
> `core` **983** · `db` **53** · `api` **493** · `domain` **2085** (+1 skip) ·
> `web-internal` **684** · `portal` **19**. **Nol bentrok semantik** antara #315
> dan #312 — yang sempat kucurigai (`reads_rls.test.ts` milik A meng-exercise
> `getBrief`/`listDivisionQueue` sementara migrasiku menulis ulang
> `briefs_select`) ternyata tidak terjadi.
>
> ## Mulai dari mana, dalam satu paragraf
>
> Kelima tiket Jalur B (B-1…B-5) **sudah di `main`**. Yang tersisa untuk Jalur B
> cuma **tiga serpihan**, dan ketiganya menunggu `A-req-1/2/3` di `account.ts`
> (berkas Jalur A) — lihat §3. Kalau A-req belum mendarat saat chat baru dimulai,
> **tidak ada pekerjaan Jalur B yang bisa maju**; yang produktif adalah §5 (UAT
> keenam divisi) dan §4 (langkah penggabungan: B-D1..B-D10 → `DECISIONS.md`,
> apply lima migrasi ke Supabase live). Jangan mulai Wave 3 (§6) sebelum A
> tergabung.

## Posisi, sejujurnya

```
main                : PR #312 MERGE 2026-09-08 (atas perintah pemilik).
                      Isi: F + A-1 + A-2 + A-5 (PR #310/#311) + Gelombang D
                      accrual (PR #309) + SELURUH Jalur B (B-1..B-5).
Branch Jalur B      : claude/cdps-user-feedback-70vbho-b — SUDAH MERGE, jangan
                      dipakai lagi. Pekerjaan lanjutan = branch BARU dari `main`.
Jalur A             : A-3 + A-4 SUDAH MERGE (PR #315, commit 9484656a — tepat
                      SEBELUM #312, jadi keduanya ada di main bersama).
                      A-req-1, A-req-2, A-req-3 MASIH BELUM — diukur di
                      a78f12be: nol `tanggalMulai`/`tanggalAkhir`/`budget` di
                      account.ts, nol `source_creative_brief_id`, nol
                      `created_count`. INI yang masih mengunci sisa Jalur B.
```

> ⚠️ **PR #312 sudah merge, jadi ia tidak bisa menampung pekerjaan baru.** Mulai
> dari `main` terbaru dengan nama branch baru; jangan menumpuk commit di atas
> history yang sudah tergabung.

> **Kenapa merge, bukan rebase.** Branch ini sudah terbit di PR #312 sejak
> commit `3f8e1a25`; §4 rencana minta "rebase harian", tapi rebase atas branch
> yang PR-nya sudah dibaca orang berarti force-push. Sesudah PR terbuka,
> `main` masuk lewat **merge commit** (`07b6338b`). Sebelum PR terbuka, branch
> ini memang di-rebase dua kali (ke commit F, lalu ke `main` sesudah #310/#311)
> — itu yang §4 maksud.

| Keluhan divisi | Tiket | Status |
|---|---|---|
| Creative #1 (rollup diam) | B-1a | ✅ di PR #312 — kecuali pembilang di ANTREAN (butuh A-req-3) |
| Account #3 & #4 (nol notifikasi) | B-1b | ✅ di PR #312 |
| Creative #2 (leader tak bisa approve) | B-4 + A-5 | ✅ dua sisi lengkap |
| Creative #3 (leader tak lihat brand/PIC) | B-2 | ✅ di PR #312 |
| Ads (tak bisa temukan aset) | B-5 | ✅ sisi baca; PENGISIAN kolom butuh A-req-2 |
| KOL #1 (deadline/budget/pengingat) | B-3 | ⚠️ tick + jatuh tempo + progres ✅; **jendela + budget butuh A-req-1** |
| Finance #1 & #2 | A-1, A-2 | ✅ sudah di `main` |
| Account #5 (CRO mentok) | A-3 | ✅ **SELESAI** — PR #315, lewat gerbang baca-ganda (lihat §2c) |
| Account #1 (durasi dari CRO) | A-4 | ✅ **SELESAI** — PR #315 |
| Store Ops (K-4/K-5/K-6) | Wave 3 | ⛔ belum mulai — sesudah A & B tergabung |

## Yang harus dikerjakan berikutnya, berurutan

### 1. ~~Dorong PR #312 sampai hijau lalu merge~~ — SELESAI 2026-09-08

Merge-nya sudah dilakukan. Keadaan terakhir sebelum merge: **sebelas check run
success** di head `ec81a5e7`, `mergeable_state: clean`, `main` sudah di-merge
masuk lewat `07b6338b` (PR #309). Nol review manusia — pemilik memerintahkan
merge langsung.

Kalau ada yang perlu diperbaiki dari isi #312: **PR baru dari branch baru.**

### 2. Kirim prompt cek ke Akun A
`docs/handoff/PROMPT_CEK_JALUR_A_SISA_FEEDBACK_OD.md` — tempel apa adanya ke
sesi Akun A. Isinya enam pertanyaan berbukti (A-3, A-4, A-req-1..3, utang UAT
A-1) plus dua hal yang wajib A ketahui dari Jalur B.

### 2b. Jawaban Akun A sudah masuk (2026-09-08) — keenam butir `belum`

A menjawab prompt ronde 1 dengan bukti berkas+baris. **Keenamnya `belum`**, dan
Jalur B sudah memverifikasi keenamnya sendiri terhadap `origin/main` — substansinya
benar semua. Artinya **ketiga sisa Jalur B masih terkunci**; nol pekerjaan Jalur B
yang bisa maju sampai A-req mendarat.

| Butir | Status | Verifikasi Jalur B atas bukti A |
|---|---|---|
| A-3 (CRO mentok) | ~~belum~~ **SELESAI** PR #315 | Bukan dengan menulis `services`, tapi dengan gerbang baca-ganda — §2c |
| A-4 (durasi dari CRO) | ~~belum~~ **SELESAI** PR #315 | `sales.ts` +199, `sales.test.ts` +282 |
| A-req-1 (jendela+budget) | belum | Benar. Keempat kolom F-4 memang sudah ada ⇒ murni jalur TS, nol migrasi |
| A-req-2 (isi kolom sumber) | belum | Benar untuk `main`. **Sisi BACA sudah 100% di #312** — grep A nol karena #312 belum ada di branch-nya |
| A-req-3 (jumlah anak) | belum | Benar substansinya. `createdCount` ADA tapi variabel FE lokal (`creative/briefs/[id]/page.tsx:335`), bukan field antrean |
| Utang UAT A-1 | belum dibayar | Diterima apa adanya — tak bisa diverifikasi dari luar |

**Tiga koreksi sudah ditulis lengkap di `PROMPT_CEK_JALUR_A_SISA_FEEDBACK_OD.md`
§"RONDE 2"** (tempel ke sesi A). Yang paling mengubah bentuk pekerjaan:

> **A-3 bukan pekerjaan desain, ia PORT.** Jalur STR- lama di `account.ts:1025-1026`
> SUDAH menggerakkan Service ke `[Strategy Approved]` dalam transaksi yang sama, dan
> header `account.ts:16-18` sudah menuliskannya sebagai perilaku yang ada. Yang tidak
> pernah mewarisi jahitan itu adalah modul **STRG-** baru di `strategi.ts` — dan itulah
> yang K-2/A-3 maksud. Gerbangnya sudah menerima hasilnya (`guardBriefCreation`
> `account.ts:1354`, lolos pada `[Strategy Approved]` di `:1606`).
>
> Satu pertanyaan tersisa yang BUTUH ketokan, jangan dipilih diam-diam: **STR- lama
> masih hidup atau sudah pensiun?** Kalau dua-duanya hidup, dua jalur berbeda bisa
> menggerakkan satu Service ke `[Strategy Approved]`.

Urutan termurah yang disarankan ke A: **A-req-1 → A-req-2 → A-req-3 → A-3 → A-4**
(tiga A-req masing-masing membuka satu sisa Jalur B yang fondasinya sudah mendarat).

### 2c. A-3 & A-4 SELESAI lewat PR #315 — dan A memilih desain yang LEBIH BAIK

**Diperbarui 2026-09-08 sesudah merge.** Bagian ini sebelumnya memasang
peringatan ⛔ "jangan sambungkan STRG- → Service, nanti ada dua penulis".
**Peringatan itu sudah tidak berlaku, dan usulan port-ku memang bukan yang
seharusnya dikerjakan.** Diukur di `main` (`a78f12be`):

`approveStrategi` di `strategi.ts` **tidak** menggerakkan `services` sama sekali.
A tidak mem-port jahitan `account.ts:1025`. Yang mereka ubah adalah
**gerbangnya**, bukan penulisnya — `account.guardBriefCreation` sekarang membaca
DUA sumber:

```sql
exists (select 1 from strategi s
          where s.contract_id = sv.contract_id and s.status = 'Aktif')
        as strategi_aktif
...
if (effectiveRequiresPlan(...) &&
    svc.status === SERVICE_STATUS_AWAITING_ONBOARDING &&
    !svc.strategi_aktif) throw new ConflictError(MSG_STRATEGY_REQUIRED);
```

Jadi Brief boleh dibuat kalau **salah satu** terpenuhi: Service sudah
`[Strategy Approved]` (jalur STR- lama, yang memang menulis status), **atau** ada
STRG- ber-status `Aktif` (jalur baru, yang tidak menulis status apa pun).

**Ini lebih baik daripada usulanku.** Port yang kusarankan akan menambah penulis
kedua ke `services.status`; bacaan-ganda A menambah **nol** penulis. Gerbangnya
satu, sumbernya dua. Ditambah migrasi backfill
`20260922100400_a3_backfill_service_strategy_approved.sql` untuk Service yang
sudah tersangkut.

**Yang MASIH terbuka, tapi turun dari ⛔ jadi catatan produk:** dua layar
Strategy tetap hidup bersamaan — `/persetujuan` + `/account/strategies/[id]`
(STR-, `nav.ts:153` masih aktif, rutenya masih ada) dan `/strategi/[id]` (STRG-).
Itu bukan lagi bahaya korupsi status, cuma dua pintu untuk pekerjaan yang mirip.
Pertanyaan untuk pemilik tinggal: **mana yang mau dipertahankan sebagai satu-satunya
pintu?** Tidak mendesak, tidak memblokir apa pun.

### 3. Sesudah A-req-1..3 mendarat — sisa Jalur B, kecil dan sudah dipetakan
Ketiganya **satu-dua baris per tempat**, bukan pekerjaan baru: fondasinya sudah
ada di PR #312.

| Sisa | Yang dilakukan | Menunggu |
|---|---|---|
| **B-3** jendela campaign + budget | `brief-inherit.planRowToBriefInput` mengisi `tanggalMulai`/`tanggalAkhir`/`budget` (hari ini budget cuma teks di `instructions`, `brief-inherit.ts:181`), lalu render di `kol/briefs/[id]` + `kol/bookings/[id]`. Cabang (c) `kol_reminder_tick` SUDAH membaca `briefs.tanggal_akhir`, jadi ia langsung hidup begitu terisi. | A-req-1 |
| **B-5** filter benar-benar menyempit di produksi | Nol perubahan di Jalur B. Begitu `account.createBrief` mengisi kolomnya, `ads.Campaign.sourceCreativeBriefId` → `AssetPicker` langsung menyaring. | A-req-2 |
| **B-1a** "n dari N" di ANTREAN divisi | Pakai `web-internal/src/lib/brief-progress.ts` yang sudah ada (`hitungProgres`/`labelProgres`) di `creative/page.tsx`, `tasks/page.tsx`, `ads/page.tsx`. **Jangan tulis aturan "n dari N" untuk kedua kalinya.** | A-req-3 |

### 4. Langkah penggabungan (§4 rencana) — jangan dilupakan
- **Pindahkan sepuluh temuan `B-D1..B-D10`** dari
  `HANDOFF_FEEDBACK_OD_JALUR_B.md` ke `docs/DECISIONS.md`. Aturan emas #3
  melarang jalur menyentuh DECISIONS; **langkah inilah** yang memindahkannya.
- **Satu di antaranya butuh ketokan pemilik: `B-D2`** — batas "batch assign"
  dibaca sebagai *"untuk orang lain"*, BUKAN *"lebih dari satu unit"*. **Masih
  TERBUKA per 2026-09-08** (ditanyakan, belum dijawab).

  Yang dibangun hari ini (`creative.ts:373-384`): non-lead boleh membuat batch
  **selama setiap barisnya untuk dirinya sendiri atau tanpa PIC**; begitu ada satu
  baris ber-PIC orang lain → `403 [hanya lead divisi Creative yang dapat membagi
  aset ke PIC lain]`.

  | Skenario (Budi = staff Creative, bukan lead) | Bacaan sekarang | Bacaan "satu unit" |
  |---|---|---|
  | Budi ambil **3 slot untuk dirinya** dalam satu klik | ✅ boleh | ❌ 403 — harus 3× klik |
  | Budi buat 2 baris **untuk Sari** | ❌ 403 | ❌ 403 |
  | Budi buat 1 baris **tanpa PIC** (masuk antrean umum) | ✅ boleh | ✅ boleh |
  | **Lead** Creative bagi 5 slot ke 5 orang | ✅ boleh | ✅ boleh |

  Kenapa dipilih bacaan "untuk orang lain": keluhan K-1 adalah **AM memilih nama
  staff**, bukan staff mengambil pekerjaannya sendiri banyak-banyak. Dan
  `createAssetBatch` adalah **satu-satunya pintu yang memakai ulang celah
  `sequence_no`** — mengecapnya di satu unit diam-diam mencabut itu dari
  self-claimer. Tes yang sudah ada ("reuses the freed slot of a sequence gap")
  memang memakai staff yang mengambil 2 unit sekaligus; bacaan "satu unit"
  memerahkannya.

  Kalau pemilik memaksudkan cap literal satu unit: satu baris di
  `creative.createAssetBatch` (tolak `total !== 1` untuk non-lead) + penyesuaian
  tes itu. Alasan lengkap di `HANDOFF_FEEDBACK_OD_JALUR_B.md` §"B-D2 rinci".
- **Apply migrasi ke Supabase live `CDPS SG` PER BERKAS lewat `apply_migration`,
  dalam urutan nama**, lalu **verifikasi dengan kueri katalog** — jangan percaya
  `success: true` saja. ⛔ **JANGAN `supabase db push`** (ledger live berbeda
  wholesale, O65 masih terbuka). Migrasi Jalur B, urut:
  ```
  20260922200000_b4_gerbang_lead_creative.sql
  20260922200100_b45_assets_select_am_ads.sql
  20260922200200_b3_kol_reminder_tick.sql
  20260922200300_b5_private_brief_source_creative.sql
  20260922200400_b1_briefs_select_arm_staff_divisi.sql
  ```

### 5. UAT oleh keenam divisi — utang yang belum dibayar
§6 rencana eksplisit: *"orang yang menulis keluhannya adalah penguji yang
tepat."* Sesi ini menjalankan UAT peramban per peran dengan asersi DOM (dan itu
yang menemukan tiga cacat RLS), tapi **keenam divisi belum melihat layarnya.**

### 6. Wave 3 — modul Store Operation (K-4/K-5/K-6)
Mulai **hanya sesudah** A dan B tergabung: ia satu-satunya yang menaikkan gate
tabel/prefix/mesin. Rinciannya §3 rencana induk.

## Ranjau yang sudah terbukti mahal di sesi ini

1. **`audit_log` menolak DELETE.** Menjalankan suite `packages/domain` berkali-kali
   atas DB yang sama membuat beberapa tes berhitung-baris merah
   (`admin.test.ts` "hari libur", `client.test.ts` Hold Service). **Bukan
   regresi.** `bash scripts/db-rebuild.sh --yes` dulu, baru cari bug. Memakan dua
   siklus sesi ini, dan Jalur A mencatat hal yang sama (A-T4).
2. **Fixture UAT yang tertinggal di DB lokal juga merahkan 7 tes** (portal /
   admin / client / internaltask meng-assert himpunan GLOBAL). Rebuild sesudah
   UAT.
3. **`npm run typecheck --workspaces` WAJIB diulang SESUDAH `npm install`, dan
   keluarannya DIBACA.** Tanpa `node_modules`, `tsc` membanjiri keluaran dengan
   *"Cannot find module 'vitest'"* dan galat sungguhan tenggelam.
4. **`REVOKE EXECUTE ... FROM PUBLIC` TIDAK cukup di Supabase.** `anon` dan
   `authenticated` role bernama yang mewarisi grant sendiri. Bentuk yang benar:
   `FROM public, anon, authenticated`. Invariant `rls_checks.sql` menangkapnya —
   ia menangkap migrasi B-3 pada apply pertama.
5. **Backtick di dalam komentar SQL yang ada di template literal TS memutus
   literalnya**, dan esbuild-nya gagal saat collect (bukan saat tes). Jangan
   pakai `` ` `` di komentar SQL di dalam `` sql`…` ``.
6. **`FE_UAT_RUNBOOK.md` KEDALUWARSA** — boot order-nya menunjuk
   `backend/testdata` + mockhris :8081 + cdps :8080, semuanya Go/MySQL yang
   sudah diarsip C-05. Resep yang benar untuk stack TS ada di
   `HANDOFF_FEEDBACK_OD_JALUR_B.md` §UAT (JWT HS256 dicetak sendiri, cookie
   `cdps_access_token`, apps/api :3001 + web-internal :3000).
7. **Kelas cacat yang paling sering muncul sesi ini, dan yang paling mahal:**
   predikat TS meloloskan, RLS mengosongkan barisnya, halaman menjawab **404 —
   bukan 403**, dan seluruh suite tetap hijau karena koneksi tes domain
   BYPASSRLS. Tiga kali dalam satu sesi. Kalau menambah jalur baca lintas-tabel,
   tulis tesnya dengan `withClaims` + `SET LOCAL ROLE authenticated` (pola
   `packages/domain/src/brief-scope.rls.test.ts` /
   `creative-asset-scope.rls.test.ts`), **jangan** hanya tes domain biasa.

## Angka acuan terakhir (di atas `main` + PR #312)

Diukur ULANG 2026-09-07 di atas merge `main`+#309 (`07b6338b`), bukan angka
sebelum merge:

`scripts/db-rebuild.sh` — **200 migrasi** (198 + dua migrasi Gelombang D:
`20260922010000_dkom_pengakuan_katalog.sql`, `20260923010000_d4_ppn_kolom_terpisah.sql`),
gerbang **tabel 146 · entity_prefix 40 · sm_machines 31 · notif_events 73**
(TIDAK bergeser — #309 menambah kolom dan baris katalog, bukan
tabel/prefix/mesin/event), seluruh invariant SQL hijau (`ident`,
`immutability`, `rls`, `auth_claims`).

| Suite | Acuan §6 | Sebelum merge #309 | Sesudah merge #309 |
|---|---|---|---|
| `packages/core` | 930 | 936 | **983** (+47 dari `accrual.test.ts` #309) |
| `packages/db` | 53 | 53 | **53** |
| `apps/api` | 490 | 493 | **493** |
| `packages/domain` | 1977 (+1 skip) | 2040 (+1 skip) | **2062** (+1 skip) |
| `web-internal` | 640 | 677 | **677** |
| `web-client-portal` | 19 | 19 | **19** |

`npm run typecheck --workspaces` bersih (dijalankan SESUDAH `npm install` —
ranjau #3 di bawah). `tsc --noEmit` + `next build` web-internal bersih.
`route-parity` `KNOWN_GAPS` **kosong**, `shape-parity` hijau (18 tes parity).
`npm run lint`: 1 error PRE-EXISTING (`react-hooks/static-components` di
`admin/employees/page.tsx`).
