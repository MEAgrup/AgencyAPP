# HANDOFF — Embed alat HTML AM di CDPS (§3.B, separuh) **PR (branch `claude/mea-video-factory-html-thi3p3`)** → sisa: importer server-side + platform lain + A-9 — Sesi 43

> Rantai: … → SESI41 (QA Strategi Fase 1, PR #200; rencana Fase 2, PR #201) → SESI42 (QA Strategi Fase 2 non-HTML, PR #202/#203) → **SESI43 (ini, terbaru — embed MEA Video Factory di CDPS + pola embedded-tools reusable).**
> Baca yang bernomor tertinggi lebih dulu; **SESI31 tetap sumber SPEK inti**, SESI42 sumber sisa §3.B + A-9.

## 0. Posisi branch & PR

| Hal | Nilai |
|---|---|
| **Repo** | `MEAgrup/AgencyAPP` |
| **Branch sesi ini** | `claude/mea-video-factory-html-thi3p3` (dari `main` @ f5aa103). |
| **Base** | `main`. |

## 1. Yang SUDAH selesai sesi ini (jangan ulang)

Keputusan pemilik (QA 2026-08-21): **embed alat HTML AM di CDPS + telan payload — BUKAN port logika ke backend.** Satu baris di puncak `docs/DECISIONS.md` (2026-08-21).

- **Alat pertama = MEA Video Factory v3** (skema `mea.videofactory.v3`) di-embed di `web-internal` lewat `<iframe>`. Tab: Papan (angka target Creative + sumber angle, untuk AM), Tracker (kinerja video MEA via hashtag, untuk CC/Leader Video), Export sheet (baris Video Master).
- **Berkas:**
  - `web-internal/public/tools/video-factory.html` — alat self-contained; **SheetJS di-vendor lokal** `web-internal/public/tools/xlsx.full.min.js` (dari dep `xlsx@0.18.5`) menggantikan `<script>` CDN cloudflare. Google Fonts tetap CDN (kosmetik, ada fallback).
  - `web-internal/src/lib/embedded-tools.ts` — **registry reusable**. Alat berikutnya = drop `.html` + 1 entri registry + 1 baris nav.
  - `web-internal/src/app/(shell)/tools/[slug]/page.tsx` — host iframe generik (`allow="clipboard-write"`, tanpa sandbox karena konten first-party same-origin).
  - `web-internal/src/lib/nav.ts` — seksi baru **"Alat"**, item `/tools/video-factory` di-gate `ownedBy(Account, Creative)` (+ OD/Director). Tes per-peran di `web-internal/src/lib/nav.test.ts`.
  - `web-internal/eslint.config.mjs` — ignore `public/**` (jangan lint bundle vendored minified).
- **Preseden yang diikuti:** `apps/api/.../interview/[id]/baseline/route.ts` — browser hitung payload `cdps.baseline.tiktok.v1`, server telan tipis + re-derive field kritis ("a tampered payload is rejected"). Kontrak sudah nyambung: `parseBaselineJson` di Video Factory membaca `klien.{toko,nama,periode_referensi,kategori}` + `produk.{sku_total,sku_ada_penjualan,top_sku[]}` = persis output `buildPayload()` (`packages/core/src/baseline/payload.ts`).
- **Validasi:** web-internal `tsc` + `lint` bersih · **276** vitest hijau (incl. 4 tes nav baru) · `next build` OK (`/tools/[slug]` terdaftar) · guard apps/api (route/shape/body/gate-reachability) **25** hijau · `KNOWN_GAPS` tetap kosong.

## 2. Yang HARUS dikerjakan berikutnya (BELUM — semua BLOKIR KEPUTUSAN/INPUT)

### 2.A Importer server-side `mea.videofactory.v3` → tabel CDPS ⛳ MENUNGGU KEPUTUSAN PEMILIK
Embed = alat dipakai sebagai utilitas (output brief `.xlsx/.csv` + payload `.json` untuk tim video). **Belum** ada yang menelan payload video-factory ke data CDPS. Bila pemilik mau angka video-brief masuk ke tabel: bangun importer **usulan → konfirmasi AM per angka** (pola RAB-19/route baseline), **re-derive server-side** angka apa pun yang mengatur gerbang (jangan percaya angka browser mentah). Keputusan yang dibutuhkan: mau masuk ke entitas mana (Brief M6B? baseline? tabel baru)?

### 2.B §3.B importer platform LAIN (Shopee/Tokopedia) ⛳ MENUNGGU CONTOH EXPORT
TikTok Shop sudah dilayani (alat baseline `cdps.baseline.tiktok.v1` + embed sesi ini). Untuk platform lain masih butuh contoh export (lihat SESI42 §2.A butir 1–4). Simpan di `docs/samples/platform-export/<platform>/…`.

### 2.C A-9 — ekspektasi klien → "target terukur" ⛳ MENUNGGU KEPUTUSAN KOSAKATA METRIK
Tidak berubah dari SESI42 §2.B: GMV=D-2 sudah ada, ROAS≠`roas_min`, "total view" tak ada di `TARGET_METRICS`. **Usulkan pemetaan di `DECISIONS.md` dulu**, lalu bangun (perluas `TARGET_METRICS` + `ck_strtg_metric` + `LEADING_INDICATORS`, satu commit). A-9 sekarang masih free-text gated (tidak rusak).

## 3. Catatan
- Jangan sentuh `backend/**` (Go/MySQL pensiun; oracle paritas read-only).
- Setelah tiap PR: `route-parity`/`shape-parity`/`gate-reachability` hijau, `KNOWN_GAPS` kosong, satu baris `DECISIONS.md` per deviasi PRD.
