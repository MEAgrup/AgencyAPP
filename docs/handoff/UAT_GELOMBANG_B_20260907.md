# UAT — Uji terima Gelombang B §10 butir 1–7, dijalankan lewat RUTE

**Tanggal:** 2026-09-07 · **Menutup:** `HANDOFF_GELOMBANG_B_TUTUP_20260907.md` §4
butir 1 — *"Uji terima §10 butir 1–7 belum dijalankan end-to-end di aplikasi
nyata. Yang terbukti adalah tesnya, bukan layarnya. Ini pekerjaan pertama yang
layak dilakukan sebelum Gelombang C."*

**Berkasnya:** `apps/api/src/e2e/gelombang-b-uat.e2e.test.ts` — 24 pemeriksaan,
satu klien, satu rantai: unggah Riset Awal → Section B → Section E (Co-Pilot) →
submit → approve → Plan periode 1 → Brief Creative.

---

## 1. Verdict

| §10 | Butir | Hasil |
|---|---|---|
| 1 | Satu upload TikTok mengisi Section B (B-1, B-2.1/2.2, B-3.1–3.4, B-5.3, B-6.1/6.2/6.4/6.5, B-7.1/7.2) tanpa Video Factory | ✅ **lolos** |
| 2 | Satu upload Shopee ⇒ `analisa_penuh` ber-skor + `kondisi_toko` terhitung, Section B Shopee ikut terisi | ✅ **lolos** |
| 3 | Yang manual tetap terlihat manual (B-4 TikTok, B-8, B-9, host/studio) dan tetap menggerbang submit | ✅ **lolos** |
| 4 | Klien lama tidak rusak — 4 field lama saja, halaman MENGATAKAN payloadnya versi lama | ✅ **lolos** |
| 5 | Section E otomatis + angle video, tanpa export/paste/file | ✅ **lolos** |
| 6 | Baris Plan periode 1 tersemai ber-`strategi_pillar_id`; `sku`/`harga` menunggu divisi | ✅ **lolos** |
| 7 | Brief satu klik **dan angle-nya ikut** | ❌ **GAGAL** → §3, sudah diperbaiki di sesi ini |

**Satu jahitan bocor ditemukan** (§3), kelas yang sama persis dengan bocornya
B2↔B3 kemarin: fitur yang selesai di sisi penulis dan tak pernah ada pembacanya.

---

## 2. Cara diuji — dan apa artinya "lewat rute"

Setiap langkah §10 dipanggil sebagai `Request` ke **route handler `apps/api` yang
sungguhan**: `requireActor` memverifikasi JWT HS256 yang di-mint tes ini,
`wire.ts` menerjemahkan snake↔camel, domain menegakkan gerbangnya, dan Postgres
lokal hasil `scripts/db-rebuild.sh` (183 migrasi) menegakkan CHECK, RLS dan
trigger immutability-nya.

Rute yang benar-benar dilalui, berurutan:

```
POST /interview/{id}/baseline                    (×2: TikTok 8 berkas, Shopee 6 berkas)
GET  /interview/{id}/baseline
POST /interview/{id}/baseline/confirm
POST /services/{id}/strategi
GET  /strategi/{id}/baseline-prefill
PUT  /strategi/{id}/channels                     · PUT …/channels/{cid}/baseline
GET  /strategi/{id}/kekurangan
GET  /strategi/{id}/copilot
PUT  /strategi/{id}/pillars
PUT  …/konteks · akses · diagnosa · targets · assumptions · kpi · narasi
     · risks · ketergantungan · kalender · trigger-revisi · handoff
POST /strategi/{id}/submit  →  POST /strategi/{id}/approve   (aktor lead)
GET  /plan/{id}                                  (periode 1 dan 2)
POST /plan/{id}/submit                           (Draft → Aktif)
POST /plan/{id}/briefs                           (RAB-16 "satu klik")
GET  /briefs/{id}
```

**Kenapa di lapis rute, bukan domain.** Bug kelas O43 (kunci wire hilang ⇒
halaman blank walau rute menjawab 200) hidup PERSIS di antara domain dan halaman.
Itulah lapis yang rantai B1→B5 belum pernah lalui dari ujung ke ujung, dan
`shape-parity.test.ts` menjaga sisanya (bentuk wire ber-anchor tipe FE).

**Berkas yang diunggah** dibangun menurut bentuk export asli — bukan payload
karangan: 8 berkas TikTok (`shop_tt`, `prod_tt`, `vid_toko`, `vid_aff`,
`live_toko`, `live_aff`, `aff_kr`, `ads_prod`; kedelapan-delapannya terdeteksi
tipenya, pemisahan toko-vs-afiliasi benar lewat `linked_accounts`) dan 6 berkas
Shopee (`bisnis_home`, `layanan_chat`, `bisnis_kesehatan`, `bisnis_produk`,
`ads_toko`, `aff_creator`).

---

## 3. Temuan — angle video berhenti di Section E (butir 7)

### Gejalanya

Brief Creative yang lahir dari pilar `konten` berisi:

```
Kanal: TikTok Shop
Pilar: konten
Aksi: V1 …
```

…dan **tidak satu pun angle video**, padahal Section E pilar itu membawa
`detail.angle_video = ["Racun skincare #serum #glowing — GPM Rp. 250.000,00 ·
tuntas 35,0% · CTR 3,0% · GMV Rp. 30.000.000,00 · 120.000 views (akun …)"]` —
angka yang benar-benar berasal dari export video yang diunggah di butir 1.

### Sebabnya

`angle_video` **ditulis** oleh `web-internal/src/lib/strategi-copilot.ts`
(`buildCopilotPillars`), dengan komentar yang menyebut sendiri tujuannya:

> *"angle video yang SUDAH perform … supaya `planRowToBriefInput` bisa
> meneruskannya ke `instructions` brief Creative — itulah 'lanjutan brief ke
> creative' yang pemilik minta (2026-09-06)."*

Tapi **tak ada satu pun pembacanya**. `grep -rn angle_video` di seluruh repo
hanya menemukan tempat ia ditulis, dan tesnya. Rantainya putus di satu tempat:
`seedRowsFromPillars` (`packages/domain/src/plan.ts`) menulis sepuluh kolom
`plan_row` dan **`instruksi_brief` bukan salah satunya** — padahal justru kolom
itulah yang `brief-inherit.planRowToBriefInput` sambung ke `instructions`
(pemilik, 2026-09-02). `instruksi_brief` sampai hari ini hanya pernah terisi
kalau AM **mengetiknya sendiri** di halaman Plan.

Ini kelas kesalahan yang sama dengan jahitan B2↔B3 (`DECISIONS.md` 2026-09-06):
keputusan pemilik mendarat di sisi penulis, berhenti di situ, dan fiturnya
terlihat selesai di dua PR sekaligus.

### Perbaikannya

| Berkas | Perubahan |
|---|---|
| `packages/core/src/planpillar.ts` | `angleVideoDariDetail(detail)` — `detail.angle_video` → satu baris teks; `null` kalau kosong. `PillarSeedInput.detail`, `SeededPlanRow.instruksiBrief` |
| `packages/domain/src/plan.ts` | `seedRowsFromPillars` membaca `detail`, menulis `plan_row.instruksi_brief`, dan mencatatnya di baris audit `baris_disemai` |
| `web-internal/src/lib/plan-row-suggest.ts` | cermin `angleVideoDariDetail`; `suggestRowFromPillar` mengusulkan `instruksiBrief` |
| `web-internal/src/app/(shell)/account/plan/[id]/page.tsx` | usulan itu mengisi `instruksi_brief` draft baris **hanya bila AM belum mengetik apa pun** (pola RAB-19) |

**Tidak ada kolom baru dan tidak ada bidang PC yang dikarang.** `instruksi_brief`
sudah ada, memang teks bebas, dan memang disambung ke `instructions`. `null`
untuk pilar tanpa angle, supaya brief tak pernah memuat `Instruksi Brief: `
kosong.

**Bukti bahwa perbaikannya yang menentukan:** dengan `planpillar.ts` +
`plan.ts` di-`git stash`, butir 7 **merah** (23/24); dengan keduanya, **hijau**
(24/24). Sisanya tidak berubah sama sekali.

---

## 4. Yang butir-butir lain buktikan (ringkas, angkanya nyata)

- **Butir 1.** Satu unggahan ⇒ `pengunjung 250.000`, `CR 2,00%`, `SKU terdaftar
  5 / aktif 3`, `pareto` & `slow moving` (kunci B1) terisi, `top SKU[0] = "Serum
  Zeta 30ml"`, `3 kampanye` + tipe materi, `sampel 35`, `7 video`, `665.000
  views`, `11,5 jam live`. `trafik_organik` dan `trafik_affiliate` **selalu
  `null`** — organik sebagai residu tetap tidak pernah dikarang.
- **Butir 2.** Shopee `analisa_penuh`, `parser cdps-baseline-shopee-v1`,
  `benchmark_versi_shopee = 1` sementara `benchmark_versi` **null**
  (`ck_analisa_benchmark_xor` di DB yang menegakkannya). B-4 Shopee terisi
  otomatis (`chat response`, `waktu respon`, `poin penalti = 3`) — keputusan
  pemilik 2026-09-06 benar-benar berfungsi di layar, bukan hanya di payload.
- **Butir 3.** Panel Kekurangan menyebut **`B-4/TikTok Shop` dengan keenam
  kolomnya**, sementara `B-4/Shopee` hanya menyisakan tiga yang memang tak punya
  export di platform mana pun (rating, jumlah ulasan, % pesanan terlambat).
  `B-8`, `B-9`, `B-9.1` dan host/studio (di grup `B-7`) tersisa di **kedua**
  kanal. Submit ditolak 400 selama kekurangan ada.
- **Butir 4.** Payload lama (hanya `gmv_baseline`) ⇒ `payload_terbaca: false`,
  `payload_schema: null`, dan **dua belas** angka B-2…B-7 semuanya `null`,
  bukan `0`. Empat field lama tetap terisi.
- **Butir 5.** `GET /copilot` mengembalikan pilar untuk dua kanal tanpa satu pun
  export/tempel; angle video membawa judul + GMV + VV asli dari export butir 1.
  Aksi konten yang memang tak punya video ber-penjualan membawa `angle: []` —
  itu benar, bukan celah.
- **Butir 6.** Approve ⇒ **6 periode** (durasi kontrak 6 bulan). Periode 1
  bernomor baris ber-`strategi_pillar_id` dengan `di_luar_strategi = false`,
  kuota > 0 dan divisi terisi; periode 2 **kosong** (aturan: hanya periode 1).
  Pilar `sku` dan `harga` **tidak** disemai — merekalah isi panel "menunggu
  divisi", persis keputusan pemilik 2026-09-06.
- **Butir 7.** Setelah perbaikan §3: Brief mewarisi divisi, deliverable, kuota,
  judul dan jejak instruksi; AM hanya mengisi `due_date` + `priority`; dan
  `instructions` Brief pilar konten **memuat angle video Section E**.

### Dua hal yang tetap manual, dan memang benar begitu

1. **`ad_spend` / `roas` / `acos` per bulan (B-1)** tidak diwarisi: angka payload
   adalah **agregat periode**, dan menyebarnya ke enam bulan mengarang angka.
   `saveBaseline` mewajibkan ketiganya, jadi AM mengetiknya — itu yang butir 3
   sebut "manual tetap manual", bukan celah pewarisan.
2. **Kuota pilar Co-Pilot** tetap diketik AM (satu angka per baris). `target`
   Co-Pilot berbentuk *jembatan* ("median VV 10,0 → 12,5"), bukan *berapa
   deliverable dibuat* — menyemainya sebagai kuota melahirkan baris kerja yang
   menuntut 12.500 unit pekerjaan. Sudah diketok di
   `HANDOFF_GELOMBANG_B_TUTUP_20260907.md` §2.3; UAT ini mengkonfirmasinya di
   jalur produksi.

---

## 5. Yang UAT ini TIDAK buktikan — sebut jujur

1. **Piksel React.** Yang dibuktikan adalah bahwa rute mengembalikan data yang
   benar dengan kunci wire yang benar; bahwa React merendernya dijaga
   `shape-parity.test.ts` (ber-anchor `interface` di `web-internal/src/lib`),
   bukan oleh UAT ini.
2. **Satu jahitan masih ber-fixture:** prefill **sungguhan** →
   `mergeBaselinePrefill`. Rantainya sekarang: mesin nyata → pemeta
   (`section-b.test.ts`, nyata↔nyata) → wire (UAT ini, nyata↔nyata) → tipe FE
   (`shape-parity`) → `mergeBaselinePrefill` (**fixture buatan tangan**). Satu
   mata rantai terakhir itu yang belum pernah bertemu keluaran server asli.
   `web-internal` tak punya dependency `@cdps/*` (dan itu disengaja), jadi
   menutupnya butuh keputusan tersendiri — bukan diam-diam menambah dependency.
3. **Utang lama yang tidak berubah:** `flashsale_aktif` masih tidak diemit (B-8
   Shopee tetap manual untuk baris itu), dan **B23-SHP** (`gmv_mix` Shopee mana
   mengisi kolom B-2.3 mana) masih terbuka ⇒ B-2.3 Shopee tetap manual.

---

## 6. Angka acuan sesudah sesi ini

| Suite | Sekarang | Sebelum (handoff TUTUP) |
|---|---|---|
| core | **906** | 900 |
| db | 53 | 53 |
| apps/api | **478** | 454 |
| domain | 1930 (+1 skip) | 1930 (+1 skip) |
| web-internal | **624** | 621 |
| web-client-portal | 19 | 19 |
| migrasi db-rebuild | 183 | 183 |

**Nol migrasi baru** ⇒ repo dan live (`egddxfcnrtecheiykhlf`) tetap tidak drift.
`npx tsc --noEmit` bersih di seluruh workspace + `web-internal`; `next build`
web-internal sukses.

```
service postgresql start
su postgres -c "psql -c \"ALTER USER postgres PASSWORD 'postgres';\""   # sekali per container
export DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps"
bash scripts/db-rebuild.sh --yes
npm install && npm test --workspaces && npm run typecheck --workspaces --if-present
cd web-internal && npm install && npx vitest run && npx tsc --noEmit && npm run build
cd ../web-client-portal && npx vitest run
```

⚠️ **Jebakan yang menggigit LAGI di sesi ini** (sama seperti handoff sebelumnya):
menjalankan suite `domain` tanpa rebuild setelah suite lain ⇒ **788 kegagalan
palsu**, semuanya berpangkal pada `plan.test.ts` yang menghapus
`clients where created_by like 'ZZ-%'` sementara berkas tes lain masih memakai
barisnya. **Rebuild dulu, lalu jalankan `packages/domain` sendirian** — 1930
hijau. Jangan mulai mencari bug sebelum itu.

---

## 7. Pekerjaan berikutnya

Utang §4 butir 1 handoff sebelumnya **lunas**. Yang tersisa, urut prioritas:

1. **Gelombang C (Showcase Klien Terbaik)** atau **Gelombang D (laporan
   keuangan accrual)** — rancangan keduanya di `HANDOFF_GELOMBANG_B_20260906.md`
   §7. Baca peringatan di muka: halaman Showcase akan **KOSONG** hari ini
   (laporan live pra-R3 payload-nya beku), dan skedul pendapatan hanya mencakup
   3 dari 14 layanan. D menambah **satu** migrasi ⇒ 184.
2. **Pertanyaan terbuka yang masih menggantung** (`DECISIONS.md` §Open): B23-SHP,
   pemilik pilar `retensi` (E-9), dan lima pertanyaan Gelombang C/D.
3. **Jahitan fixture terakhir** (§5 butir 2) — kalau pemilik mau ditutup, ia
   butuh keputusan tentang bagaimana `web-internal` boleh melihat keluaran server
   asli di tesnya.

> **Aturan yang dibawa dari Gelombang B masih berlaku, dan sesi ini membuktikannya
> sekali lagi:** setiap jahitan antar-gelombang wajib punya satu tes yang
> memanggil **KEDUA sisi sungguhan**. `angle_video` punya tes di sisi penulis
> (`strategi-copilot.test.ts`) dan tes di sisi pembaca (`brief-inherit.test.ts`),
> keduanya hijau selama ini — dan tak satu pun menguji bahwa yang satu benar-benar
> sampai ke yang lain.
