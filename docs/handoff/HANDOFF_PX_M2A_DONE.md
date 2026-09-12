# HANDOFF — PX-M2a selesai, PX-M2b & M1 (mcnapp) berikutnya

> Titik masuk **standalone** untuk sesi berikutnya di repo ini (`MEAgrup/AgencyAPP`). Tidak perlu
> membaca handoff cutover (`HANDOFF_CUTOVER_SESI*.md`) — itu rantai terpisah, sudah selesai jauh
> sebelum PX-M2a mulai.

## 0. Posisi persis (ditulis 2026-09-12)

| | |
|---|---|
| **Branch kerja** | `claude/eloquent-pasteur-uu7o20` |
| **Kondisi branch** | 2 commit di depan `main`, 0 di belakang — bersih, nol perubahan belum ter-commit |
| **Commit** | `c8ee6e2` (implementasi PX-M2a) → `af8322b` (commit PRD sumber + tutup gap DECISIONS.md) |
| **`main`** | `5ff3aff` (PR #349) |
| **PR terbuka** | **#350** — `feat(PX-M2a): Shop ID Gate & Eligibility Policy (Product Exchange)`, `claude/eloquent-pasteur-uu7o20` → `main`, **belum di-merge** (dibuat, belum direview/approve siapa pun) |
| **Live `CDPS SG`** (`egddxfcnrtecheiykhlf`, `ap-southeast-1`) | Migrasi `px_m2a_shop_id_eligibility_policy` **SUDAH di-apply** lewat `apply_migration` (bukan `db push`) — 161 tabel, `px_eligibility_policy` versi 1 ter-seed, `client_platforms.shop_id` ada. **Live sudah di depan `main`** sampai PR #350 merge — ini state sementara yang wajar untuk alur kerja repo ini (migrasi diterapkan duluan, kode menyusul lewat PR), tapi kalau ada migrasi LAIN yang perlu apply sebelum #350 merge, urutkan hati-hati. |

```bash
git fetch origin claude/eloquent-pasteur-uu7o20
git checkout claude/eloquent-pasteur-uu7o20
git pull origin claude/eloquent-pasteur-uu7o20
npm install                              # root
cd web-internal && npm install && cd ..
cd web-client-portal && npm install && cd ..
```

## 1. Apa yang sudah selesai (PX-M2a)

Sumber tugas: `02_SURAT_TUGAS_CDPS_PX-M2a.md` (upload pemilik) + PRD asli
`docs/prd/CDPS_ProductExchange_M1_M2.md` v1.0 (di-commit `af8322b`, dicocokkan baris-demi-baris —
nol penyesuaian kode diperlukan).

- Migrasi `supabase/migrations/20261008010000_px_m2a_shop_id_eligibility_policy.sql`: `client_platforms.shop_id` + index, tabel `px_eligibility_policy` (append-only, `aktif` tidak pernah dibalik — preseden `adsscanner_benchmark`). **Sudah di lokal DAN live.**
- `packages/domain/src/productexchange.ts` — `canKelolaPolicy` (Director saja), `canIsiShopId` (lead Account atau AM pemilik klien), `isiShopId`, `listEligibilityPolicy`, `createEligibilityPolicy`, `activeEligibilityPolicy`.
- `packages/domain/src/client.ts` — aturan 1 toko aktif per `(client_id, platform)` di `addPlatform` (`PlatformDuplicateError`).
- Route `GET|POST /api/v1/px/eligibility-policy`, `PUT /api/v1/clients/{id}/platforms/{pid}/shop-id`.
- FE: field Shop ID di `clients/[id]/page.tsx` (bagian Platform), halaman Director `/px/eligibility-policy`, nav.
- 5 entri `docs/DECISIONS.md` (tanggal 2026-09-12, cari `PX-M2a` — semuanya berurutan di bagian atas tabel `## Decided`).
- Test: `packages/domain/src/productexchange.test.ts` (baru), `client.test.ts` (+2 tes duplikat platform), `nav.test.ts` (+1 tes gerbang Director-only halaman baru). Semua suite hijau (`make db-rebuild` + `make typecheck` + `make test` + `web-internal vitest`).

**Yang SENGAJA belum dikerjakan** (bukan lupa — dicatat eksplisit di PRD & surat tugas):
- `px_sku`, `px_sku_volume`, `px_sku_eligibility`, fungsi evaluasi kelayakan (PRD §4 Flow D) — ditunda ke **PX-M2b**, karena FK-nya ke `px_sku` milik M3 yang PRD-nya belum ditulis. PRD sendiri melarang membuat `px_sku` versi sementara.
- `px_consents` — **dihapus permanen** dari scope (bukan ditunda), diganti `client_platforms.shop_id`. Jangan dibangun lagi tanpa ketokan pemilik baru.
- `UNIQUE (client_id, platform) WHERE active` di DB — masih ditegakkan di domain saja.

## 2. Dua hal yang butuh keputusan MANUSIA sebelum lanjut — bukan tugas coding

### 2.1 Bersihkan 2 pasang baris `client_platforms` kembar di live

Ditemukan saat verifikasi PRD terhadap live (menjawab **A-07** di PRD §5 — asumsi "tidak ada klien
dengan >1 toko aktif per platform", ternyata SALAH):

| client_id | Klien | Platform | id | Catatan |
|---|---|---|---|---|
| CLI-202608-0010 | lindahijab.id | TikTok Shop | 13 / 14 | id 13 tanpa `store_link`, id 14 punya |
| CLI-202609-0002 | efgh clothing | Shopee | 16 / 17 | id 16 ber-link `www.testingcloth1.com` — tampak data test |

**Jangan hapus tanpa konfirmasi Nerissa/Hans.** Begitu dibersihkan (nonaktifkan baris duplikat lewat
UI/`updatePlatform`, atau keputusan mana yang jadi baris kanonik), baru pasang:
```sql
CREATE UNIQUE INDEX ... ON client_platforms (client_id, platform) WHERE active;
```
sebagai migrasi baru, dan lepas gerbang domain jadi murni pengaman kedua (bukan satu-satunya).

### 2.2 SOP Shop ID belum disampaikan ke tim Account

Kode sudah jalan, tapi **Shop ID adalah pernyataan operasional** ("agency plan TAP/SAP sudah ada"),
bukan sekadar field data. Kalau AM mengisi asal-asalan, gerbang M3 nanti kebobolan tanpa satu pun
error kode yang bisa menyelamatkannya. Pastikan Anty/Nerissa menyampaikan ini ke tim Account
sebelum fitur dipakai beneran.

## 3. Task berikutnya yang realistis

**A. Merge PR #350** (kalau belum) — tidak butuh coding, tinggal review + approve + merge lewat GitHub. Live sudah di-apply, jadi merge ini murni menyamakan `main` dengan yang sudah jalan di production.

**B. PX-M2b** (M3 + sisa M2) — **JANGAN mulai sebelum PRD M3 ditulis.** PRD PX-M1/M2 §5 (Open
Assumptions A-08/A-09/A-10) eksplisit: dibutuhkan dulu **daftar field yang dikonsumsi & dihasilkan**
tiga tools yang sudah ada (AM Baseline, AM Co-pilot, report engine) — itu yang menentukan bentuk
`px_sku`, dan "tabel yang salah bentuk akan mahal diubah setelah berisi data". Kalau pemilik minta
mulai PX-M2b, langkah pertama adalah audit ketiga tools itu (bukan menulis migrasi), lalu PRD M3
ditulis, baru PX-M2b (yang mengonsumsi `px_sku`) dan M2b CDPS (`px_sku_volume`/`px_sku_eligibility`/
evaluator Flow D) bisa jalan.

**C. M1 (Creator Capability Registry)** — repo **`mcnapp`/MCN**, bukan repo ini (`agencyapp`).
Sesi terpisah, environment terpisah (Supabase MCN `bqknstylbpwsnlgnzayw`), jalur paralel yang PRD
sendiri bilang "tidak ada ketergantungan" dengan PX-M2. Kalau pemilik minta lanjut M1, itu perlu
sesi baru dengan akses ke repo `mcnapp`, bukan lanjutan sesi ini.

## 4. Rujukan cepat

- PRD: `docs/prd/CDPS_ProductExchange_M1_M2.md`
- Surat tugas asli (upload pemilik, tidak di-commit ke repo): `02_SURAT_TUGAS_CDPS_PX-M2a.md`
- Decision log: `docs/DECISIONS.md`, cari `PX-M2a` (5 entri, semua tanggal 2026-09-12, di bagian atas tabel)
- Domain: `packages/domain/src/productexchange.ts` + `productexchange.test.ts`
- PR: https://github.com/MEAgrup/AgencyAPP/pull/350
