# Handoff — titik lanjut Feedback OD sesudah Jalur B (PR #312)

> Dibuat sesi Jalur B, 2026-09-07. **Baca ini lebih dulu di chat berikutnya**,
> lalu `HANDOFF_FEEDBACK_OD_JALUR_B.md` untuk detail per keputusan.
>
> Rencana induk: `docs/handoff/PARALEL_FEEDBACK_OD_DUA_AKUN.md`.

## Posisi, sejujurnya

```
main                : e8cee053  (F + A-1 + A-2 + A-5, lewat PR #310 & #311)
PR Jalur B          : #312  claude/cdps-user-feedback-70vbho-b -> main
                      6 commit · 50 berkas · +4023/-118 · SUDAH di-rebase ke main
Branch Jalur A      : claude/cdps-user-feedback-account-a-igix3n  (A-3, A-4 belum)
Pekerjaan lain jalan: PR #309 Gelombang D accrual (Finance) — MASIH TERBUKA
```

| Keluhan divisi | Tiket | Status |
|---|---|---|
| Creative #1 (rollup diam) | B-1a | ✅ di PR #312 — kecuali pembilang di ANTREAN (butuh A-req-3) |
| Account #3 & #4 (nol notifikasi) | B-1b | ✅ di PR #312 |
| Creative #2 (leader tak bisa approve) | B-4 + A-5 | ✅ dua sisi lengkap |
| Creative #3 (leader tak lihat brand/PIC) | B-2 | ✅ di PR #312 |
| Ads (tak bisa temukan aset) | B-5 | ✅ sisi baca; PENGISIAN kolom butuh A-req-2 |
| KOL #1 (deadline/budget/pengingat) | B-3 | ⚠️ tick + jatuh tempo + progres ✅; **jendela + budget butuh A-req-1** |
| Finance #1 & #2 | A-1, A-2 | ✅ sudah di `main` |
| Account #5 (CRO mentok) | A-3 | ⛔ **BELUM** |
| Account #1 (durasi dari CRO) | A-4 | ⛔ **BELUM** |
| Store Ops (K-4/K-5/K-6) | Wave 3 | ⛔ belum mulai — sesudah A & B tergabung |

## Yang harus dikerjakan berikutnya, berurutan

### 1. Tunggu / dorong PR #312 sampai hijau lalu merge
Sesi ini sudah `subscribe_pr_activity` ke #312. Kalau CI merah saat chat
berikutnya mulai: baca check run-nya, perbaiki, push. Jangan buka PR baru.

### 2. Kirim prompt cek ke Akun A
`docs/handoff/PROMPT_CEK_JALUR_A_SISA_FEEDBACK_OD.md` — tempel apa adanya ke
sesi Akun A. Isinya enam pertanyaan berbukti (A-3, A-4, A-req-1..3, utang UAT
A-1) plus dua hal yang wajib A ketahui dari Jalur B.

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
  dibaca sebagai *"untuk orang lain"*, BUKAN *"lebih dari satu unit"*. Kalau
  pemilik memaksudkan cap literal satu unit, itu satu baris di
  `creative.createAssetBatch` + satu penyesuaian tes. Alasan lengkap di
  handoff §"B-D2 rinci".
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

`scripts/db-rebuild.sh` — **198 migrasi**, gerbang **tabel 146 · entity_prefix 40
· sm_machines 31 · notif_events 73**, seluruh invariant SQL hijau.

| Suite | Acuan §6 | Terakhir |
|---|---|---|
| `packages/core` | 930 | **936** |
| `packages/db` | 53 | **53** |
| `apps/api` | 490 | **493** |
| `packages/domain` | 1977 (+1 skip) | **2040** (+1 skip) |
| `web-internal` | 640 | **677** |
| `web-client-portal` | 19 | **19** |

`tsc --noEmit` + `next build` web-internal bersih. `route-parity` `KNOWN_GAPS`
**kosong**. `npm run lint`: 1 error PRE-EXISTING
(`react-hooks/static-components` di `admin/employees/page.tsx`).
