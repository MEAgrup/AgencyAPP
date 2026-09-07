# Handoff — Gelombang **B3 + B4 SELESAI**; sisa: B1, B2, B5, C, D

> **Baca ini bersama** `docs/handoff/HANDOFF_GELOMBANG_B_20260906.md` (ada di branch
> `claude/cdps-build-plan-update-4v8vth`, **belum merge**). Dokumen itu memuat audit
> akar masalah §4 yang paling mahal untuk ditemukan ulang; dokumen ini hanya
> mencatat apa yang berubah sesudahnya.
>
> Branch sesi ini: **`claude/baca-handoff-b3-b4-build-t3ajru`**, dibangun dari `main`.

---

## 1. Posisi sebenarnya

| Gelombang | Isi | Status |
|---|---|---|
| **A** | PR kecil QA | ✅ selesai — **PR #300** (draft), belum merge |
| **B1** | Perluas payload baseline TikTok (+4 turunan) | ⏸️ **dikerjakan paralel di sesi lain**, belum PR |
| **B2** | Engine baseline Shopee | ⏸️ **dikerjakan paralel di sesi lain**, belum PR |
| **B3** | Section B terisi dari satu upload | ✅ **SELESAI (sesi ini)** |
| **B4** | AM Co-Pilot mengisi Section E dari server | ✅ **SELESAI (sesi ini)** |
| **B5** | Baris Plan tersemai dari Section E | ▶️ **MULAI DI SINI** |
| **C** | Showcase Klien Terbaik | ⏸️ belum |
| **D** | Laporan keuangan accrual | ⏸️ belum |

B3 dikerjakan **mendahului** B1/B2 atas instruksi pemilik, menyimpang dari
`HANDOFF_GELOMBANG_B` §5. Alasan itu bisa dibenarkan dicatat di `DECISIONS.md`
2026-09-06; ringkasnya ada di §3 di bawah.

---

## 2. Kenapa ini TIDAK menciptakan drift dengan B1/B2

Ini bagian terpenting dokumen ini. Yang menjaganya **bukan koordinasi**, melainkan
bentuk kodenya.

### 2.1 Satu pemeta, nol cabang platform

`packages/core/src/baseline/section-b.ts` membaca **jalur kunci bersama** yang setiap
schema payload baseline punya (`toko`, `gmv_mix`, `produk`, `iklan`, `afiliasi`,
`video`, `live`) — aturan B2 §6.5 #1 mewajibkan payload Shopee sekongruen mungkin
dengan `cdps.baseline.tiktok.v1`, jadi selama aturan itu dipatuhi **tidak ada satu
pun `if (platform === …)` yang perlu ditulis**. Kunci yang sebuah platform tak punya
jatuh ke `null`, dan `null` berarti **manual** — bukan nol.

### 2.2 Kunci B1 SUDAH dibaca hari ini

Keempat kunci yang B1 tambahkan dibaca di pemeta itu **sekarang**:

| Kunci B1 | Section B | Keadaan hari ini |
|---|---|---|
| `produk.sku_pareto_80` | B-3.2 | absen ⇒ `null` |
| `produk.sku_slow_moving` | B-3.4 | absen ⇒ `null` |
| `iklan.jumlah_kampanye` | B-5.3 | absen ⇒ `null` |
| `iklan.tipe_materi[]` | B-5.3 | absen ⇒ `[]` |

Begitu B1 mendarat, keempatnya **menyala sendiri — nol sunting di B3**. Dua tes
memaku kedua sisi (`section-b.test.ts`: "kunci B1 yang belum ada di payload jadi
null" dan "membaca kunci B1 begitu payload membawanya — tanpa perubahan pemeta").

### 2.3 Berkas yang disentuh vs berkas B1/B2

**Nol berkas B1/B2 disentuh:** `packages/core/src/baseline/payload.ts`,
`baseline/baseline.test.ts`, `baseline/shopee/**`, `packages/domain/src/riset-awal.ts`,
`riset-awal.test.ts`, `RisetAwalPanel.tsx` — semuanya utuh.

Satu-satunya irisan yang mungkin adalah **dua baris `export`** di barrel
`packages/core/src/index.ts` dan `packages/core/src/baseline/index.ts`. Kalau B2
menambah `export * from './shopee'` di baris sebelah, itu konflik satu baris —
selesaikan dengan menyimpan **keduanya**.

### 2.4 Yang HARUS diperiksa saat B1/B2 merge

1. Payload Shopee memakai nama kunci yang sama (`toko.pengunjung`, `toko.konversi`,
   `produk.sku_total`, `afiliasi.kreator_posting`, `video.toko.*`, `live.toko.jam`, …).
   Kalau tidak, B3 akan mengembalikan `null` untuk Shopee — **bukan angka salah**,
   tapi tetap fitur yang tidak jalan. Perbaikannya di pemeta, bukan di domain/FE.
2. `iklan.tipe_materi[]` harus berbentuk **key** (`video_ads`/`live_ads`/`gmv_max`).
   Domain menyaringnya ke `CAMPAIGN_TYPES`; kunci yang tidak dikenal dibuang diam-diam.
3. `benchmark_dipakai` Shopee (kalau ada) memakai kunci yang berbeda dari
   `report_benchmark_shopee` ⇒ pemicu B4 tidak menyala untuk Shopee. Itu **aman**
   (usulan lebih sedikit, bukan salah) dan halaman mengatakannya, tapi kalau
   Section E Shopee diinginkan, pemetaan kunci benchmark-nya tiket tersendiri.

---

## 3. B3 — apa yang persisnya dibangun

### Berkas

| Berkas | Isi |
|---|---|
| `packages/core/src/baseline/section-b.ts` *(baru)* | `mapPayloadToSectionB` — satu pemeta, semua schema |
| `packages/core/src/baseline/section-b.test.ts` *(baru)* | 20 tes, sebagian besar tentang **absen ≠ nol** |
| `packages/domain/src/strategi.ts` | `ChannelBaselineSuggestion` 4 → **24** field usulan |
| `apps/api/src/lib/wire.ts` | `StrategiTopSkuSuggestionWire` + `StrategiTopKreatorSuggestionWire` + 30 kunci baru |
| `web-internal/src/lib/strategi.ts` | tipe FE (**ditulis lebih dulu** — jangkar `shape-parity`) |
| `web-internal/src/lib/strategi-baseline-inherit.ts` | `mergeSectionBFigures` + `ringkasBaseline` + `SELALU_MANUAL` |
| `web-internal/src/components/strategi/SectionB.tsx` | chip per-field + panel `RingkasanOtomatis` |

### Aturan yang dipegang (jangan dilonggarkan tanpa entri `DECISIONS.md`)

1. **Hanya field kosong yang diisi**; list hanya bila list tujuan kosong. Ada tes
   "never clobbers a figure the AM already typed" dan tes idempotensi.
2. **B-2.3 organik & affiliate SELALU `null`.** Organik sebagai residu = angka
   karangan (share boleh tumpang tindih & >100%, `DECISIONS.md` 2026-08-22);
   affiliate sudah ikut di bucket video & LIVE ⇒ mengisinya dobel hitung.
3. **B-1.4 (% batal) mendarat di SATU bulan** — yang labelnya persis
   `klien.periode_referensi`. Ia agregat periode. Belanja iklan & ROAS per bulan
   tetap manual sepenuhnya.
4. **B-3.3 hero SKU**: hanya nama + GMV. `unit_terjual`/`harga_jual`/`margin_persen`
   dibiarkan kosong — tidak ada export yang membawanya, dan justru ketiganya yang
   dipakai margin math.
5. **B-6.5**: hanya JUMLAH sampel (jadi catatan, template tetap). Siapa yang
   menanggung program (`program_sampel`, enum) tetap manual dan tetap menggerbang.
6. **B-4 tetap manual seluruhnya.** Untuk Shopee sumbernya ADA tapi itu
   pertanyaan terbuka §8 #1 yang **belum diketok pemilik** — jangan isi diam-diam.

---

## 4. B4 — apa yang persisnya dibangun

### Berkas

| Berkas | Isi |
|---|---|
| `packages/core/src/copilot.ts` *(baru)* | katalog 4 pilar × 20 aksi, `verdict`, `skor`, `saranD5`, `peringkatAngleVideo`, `susunUsulan` |
| `packages/core/src/copilot.test.ts` *(baru)* | 45 tes; `verdict` + `skor` ditulis lebih dulu |
| `packages/domain/src/strategi.ts` | `susunPilarUsulan` |
| `apps/api/src/app/api/v1/strategi/[id]/copilot/route.ts` *(baru)* | `GET`, pola baca identik `baseline-prefill` |
| `apps/api/src/lib/wire.ts` | `strategiCopilotUsulanToWire` + 6 tipe wire |
| `apps/api/src/lib/wire.copilot.test.ts` *(baru)* | kunci bersarang, `null` eksplisit (kelas O43) |
| `web-internal/src/lib/strategi-copilot.ts` *(baru)* | `buildCopilotPillars` |
| `web-internal/src/components/strategi/CopilotPanel.tsx` *(baru)* | tombol + daftar centang |
| `web-internal/src/components/strategi/SectionE.tsx` | panel dipasang di atas E-1 |

### Aturan yang dipegang

1. **Nol ambang baru.** Setiap pemicu = satu metrik payload vs satu kunci
   `benchmark_dipakai` yang engine baseline sudah pakai. Dua ambang non-benchmark
   adalah aturan MEA yang tool sendiri kunci (K2 15%, konsentrasi kreator 30%).
2. **Payload tanpa benchmark ⇒ usulan lebih SEDIKIT, bukan ditebak** — dan panel
   mengatakannya: *"bukan berarti tokonya sehat, hanya berarti pembandingnya tidak ada"*.
3. **Angle video**: jangkar `gpm`, penguat `tuntas`+`ctr`, maks 5, seri `gmv` desc
   lalu `judul` asc. Video tanpa `gpm` **dibuang**. Tanpa `top_video` ⇒ pilar konten
   tetap disusun **tanpa** blok angle dan mengatakannya.
4. ⚠️ **Label pilar masuk `detail`, BUKAN `peran`.** `ck_strpil_peran` enum peran SKU
   tertutup; bug ini sudah pernah terjadi (`DECISIONS.md`:500). Ada tes yang memakunya.
5. Identitas baris `"{kode} {nama}"` **identik** dengan `buildCockpitPillars` supaya
   `mergeCockpitPillars` memutakhirkan di tempat, bukan menduplikasi.
6. `CockpitImportPanel`, tombol Salin/Unduh JSON, dan panel Video Factory **tetap
   dirender** — pemilik menolak pencabutannya.

---

## 5. ▶️ B5 — baris Plan tersemai dari Section E (mulai di sini)

Rancangannya utuh di `HANDOFF_GELOMBANG_B_20260906.md` §7 B5. Yang **berubah** karena
B4 sudah mendarat:

- Section E sekarang benar-benar bisa terisi ⇒ prasyarat B5 terpenuhi.
- Baris pilar dari Co-Pilot membawa `detail.angle_video` (array kalimat BI). Saat
  `suggestRowFromPillar` menyusun `instruksi_brief`, **angle itulah yang harus ikut** —
  itu "lanjutan brief ke creative" yang pemilik minta 2026-09-06.
- `detail.jembatan` / `.unit` / `.arah` / `.minggu_terlihat` juga tersedia untuk
  mengisi `hasil_diharapkan` (PC-11) tanpa AM mengarang.
- Ingat: `kuota` yang tak terbaca ⇒ baris **tidak** disemai (bukan `kuota=0`;
  `brief-inherit.ts` melewati baris `kuota_nol`, jadi baris kuota-0 = baris mati).
- Pilar `sku`/`harga`/`retensi` tidak pernah diusulkan Co-Pilot (katalognya hanya
  4 pilar), jadi panel "Pilar Strategi menunggu divisi" tetap dibutuhkan untuk pilar
  yang AM tulis manual.

---

## 6. Verifikasi — angka acuan BARU

Angka `HANDOFF_GELOMBANG_B` §9 sudah usang untuk core/api/domain/web-internal.

| Suite | Sekarang | Sebelum (akhir Gelombang A) |
|---|---|---|
| core | **732** | 667 |
| db | 53 | 53 |
| apps/api | **454** | 447 |
| domain | **1915** (+1 skip) | 1903 (+1 skip) |
| web-internal | **588** | 565 |
| web-client-portal | 19 | 19 |
| migrasi db-rebuild | **182** | 182 |
| gate db-rebuild | 145 / 40 / 31 / 69 | sama |

**Nol migrasi baru.** Gelombang B seluruhnya nol migrasi; D menambah satu (→ 183).

```
service postgresql start
su postgres -c "psql -c \"ALTER USER postgres PASSWORD 'postgres';\""   # sekali per container
export DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps"
bash scripts/db-rebuild.sh --yes
npm install && npm test --workspaces && npm run typecheck --workspaces --if-present
cd web-internal && npm install && npx vitest run && npx tsc --noEmit && npm run build
```

Jebakan yang masih berlaku (semuanya sudah terbukti menggigit lagi di sesi ini):

- **Suite dijalankan dua kali di DB yang sama tanpa rebuild ⇒ 2 kegagalan PALSU**
  (`admin.test.ts` hari libur `expected 7 to be 1`, `client.test.ts` Hold Service
  `expected 3 to be 1` — keduanya menghitung baris `audit_log`). **Rebuild dulu.**
- `riset_awal_analisa` **immutable by trigger**: fixture varian payload harus
  di-`INSERT` dengan bentuk yang diinginkan, tidak bisa di-`UPDATE` sesudahnya.
- 1 error lint `react-hooks/static-components` di `admin/employees/page.tsx`
  **PRE-EXISTING**, di luar cakupan.

---

## 7. Yang BELUM dikerjakan / belum bisa diklaim

1. **Uji terima §10 butir 1–7 belum dijalankan end-to-end** di aplikasi nyata. Yang
   terbukti di sini adalah tesnya, bukan layarnya. Butir 2 (upload Shopee) baru bisa
   diuji setelah B2 mendarat.
2. **Pertanyaan terbuka `HANDOFF_GELOMBANG_B` §8 masih terbuka semua.** Yang paling
   memblokir: **#1 B-4 untuk Shopee** (engine Shopee mem-parse chat response rate,
   response time, poin penalti — isi otomatis atau tetap manual demi keseragaman?),
   dan **#3 pemilik pilar `retensi`**.
3. B5, C, D belum disentuh.
