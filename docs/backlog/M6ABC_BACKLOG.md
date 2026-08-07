# Backlog — M6A (Strategi) · M6B (Plan) · M6C (Plan Gate)

> Dibuat 2026-08-06 dari QA halaman `/account/services/SVC-202608-0002`.
> PRD: `docs/prd/CDPS_Module6A_Strategi.md`, `…6B_Plan.md`, `…6C_Plan_Gate_Satuan.md`.
> Keputusan & deviasi: `docs/DECISIONS.md` 2026-08-06 + 2026-08-07.
> **O54, O55, O58 SELESAI** (2026-08-07). **O57 sudah diputus, belum dieksekusi**
> — rancangannya di `docs/handoff/HANDOFF_M6ABC_SESI5.md` §4. **O56 masih terbuka.**

## 0. Kenapa urutannya begini

Ketiga PRD ini saling bergantung, dan urutan yang salah menghasilkan kode yang
tidak bisa dijangkau siapa pun:

```
entity_prefix registry  ──►  M6C tier + gate  ──►  M6A Strategi  ──►  M6B Plan
   (M6A §7)                  (jalur ditentukan)     (isi form)        (eksekusi)
                                    │                                     │
                                    └──── Rule 6 "Plan Satuan dibuka" ◄────┘
```

- **`entity_prefix` lebih dulu** karena M6A §7 menyebutnya "dev action BEFORE
  coding" — dan karena registry-lah yang memutuskan apakah `STRG`/`PLAN`/`VND`
  bebas atau harus jatuh ke fallback `STGY`/`PPRD`.
- **M6C lebih dulu dari M6A** karena M6A Rule 1 hanya berlaku untuk Service
  ber-`butuh_plan = true`, dan sebelum tier ada, **nol** entri katalog live
  memenuhi itu. Form Strategi yang dibangun lebih dulu tidak akan pernah muncul
  di halaman mana pun.
- **M6B paling akhir** karena ia mengonsumsi Strategi yang sudah disetujui
  (target D-2, floor price E-4, kuota F, fase G-1, tanggal besar G-2, asumsi
  D-8). Membangunnya lebih dulu berarti mengarang sumber untuk enam field itu.
- Satu simpul balik: **Rule 6 M6C** ("service pertama membuka Plan Satuan")
  butuh tabel `PLAN`, jadi ia baru bisa ditutup saat M6B mendarat.

## 1. SELESAI (2026-08-06)

| # | Ticket | Isi |
|---|---|---|
| A-00 | PRD masuk repo | Tiga berkas ke `docs/prd/`. Sebelumnya tidak ada di repo — kode M6 §4 dibangun tanpa spesifikasi ini |
| A-01 | `entity_prefix` registry + tes CI | Tabel PK-terkunci, backfill 26 prefix as-built, daftarkan `STRG`/`PLAN`/`VND`. Tes memindai call site & menemukan `ACT`/`LDR`/`DEMO` tak terdaftar; ketiganya dipindah ke wrapper bertipe `nextId` |
| C-01 | Tier katalog 3 nilai | `plan_tier` di `master_service_versions` + pin `services`, diikat CHECK ke boolean lama |
| C-02 | `plan_gate_config` | Ambang berversi (20/bulan · Rp 15jt/bulan · 1 bulan · Rp 15jt notif-join) |
| C-03 | `service_plan_gate` + mesin rekomendasi | 3 pemicu keras + 4 lunak (Rule 3), pemicu DISIMPAN bukan dihitung ulang, `kesesuaian` dijaga CHECK turunan |
| C-04 | Form G-A/G-B/G-C | `PlanGatePanel.tsx`, rekomendasi live dari server (bukan salinan kedua trigger table), matriks wajib-kondisional GB-5/6/8 |
| C-05 | Eskalasi / de-eskalasi | Rule 11 (AM, forward-only) vs Rule 12 (SPV-saja + wajib ringkasan GB-8) |
| C-06 | Gerbang Brief | `guardBriefCreation` menolak tier tengah yang belum dijawab dengan pesan sendiri; `nextOnboardingStep` dapat langkah pertama `determine_plan` |
| C-07 | Re-tier katalog live | 33 entri dipetakan dari contoh M6C §3. **Usulan, bukan keputusan pemilik** — O54 |

### Sesi 2 (2026-08-06) — M6A A-02 / A-03 / A-04

| # | Ticket | Isi |
|---|---|---|
| A-02 | `VND-` Vendor entity | Tabel `vendors` (8 field §7) + mesin `vendor` (`Aktif ⇄ Nonaktif`, keduanya → `Blacklist`, `Blacklist → Nonaktif` — sengaja BUKAN terminal). Tarif berpasangan dengan skemanya lewat CHECK: `bagi_hasil` persen, sisanya rupiah. Nama unik case-insensitive. Tulis lead Account/Direksi, baca semua (picker E-8) |
| A-03 | `STRG` + tabel anak | `strategi` + `strategi_channel` → `strategi_baseline_bulan` (baris per `(channel, month_index)`, D11) + `strategi_target` + `strategi_assumption` + `strategi_pillar` + `strategi_resource` + `strategi_risk` + `strategi_version` (append-only). Versi = BARIS (Rule 13). **Field per Section BELUM — itu A-05…A-09** |
| A-04 | Mesin status #15 | `Draft`/`Draft Revisi` → `Diajukan` → (`Aktif` \| kembali ke laci asalnya); `Aktif` → `Kedaluwarsa`/`Diarsipkan`. Gerbang kelengkapan (Rules 3/5/8/9/17 + minimum D-8/H-1) berjalan di transaksi yang sama dengan transisinya |

Domain `packages/domain/src/{vendor,strategi}.ts`, 17 route `apps/api`, tipe FE
`web-internal/src/lib/strategi.ts` (kontrak untuk form A-05…A-09; ia juga yang
membuat `shape-parity` bisa memeriksa converter-nya). Walk HTTP 40/40.

### Sesi 3 (2026-08-06) — M6A A-05 / A-06

| # | Ticket | Isi |
|---|---|---|
| A-05 | Section A (16 field) + A-15/A-16 | 20 kolom di `strategi` (Section A diisi SEKALI per Strategi, §4) + tabel `strategi_akses` (matriks channel × akses × status). **A-16 bukan tabel kedua** — ia flag `memblokir` + `target_tanggal_beres` di baris A-15 yang diblokirnya, dijaga CHECK. `channel = 'Umum'` disediakan karena akses gudang/stok bukan milik channel mana pun. Taksonomi tertutup A-14 dijaga containment jsonb (`<@`) |
| A-06 | Section B per channel (grup B-2…B-9) | ±45 kolom di `strategi_channel`. **Komposisi trafik B-2.3 = enam kolom**, bukan jsonb: CHECK §7 "berjumlah 100 ±0,5" akan LOLOS diam-diam kalau sebuah kunci jsonb hilang. `gmv_per_jam_live` GENERATED (aturan rumah #4), NULL saat nol jam live. **B-1.5 (tren) tanpa kolom** — diturunkan saat dibaca; arah `month_index` dinyatakan: 1 = bulan TERTUA |

Dua route baru (`PUT /strategi/{id}/konteks`, `PUT /strategi/{id}/akses`), 8
interface struct baru di `wire.ts` + tipe FE-nya, gerbang submit diperluas
(Section A per field-ID, A-15 per channel, B-2…B-9 per channel). Walk HTTP 42/42.
Gate tabel 68 → **69** di KEDUA berkas. Pertanyaan terbuka baru: **O58**.

## 2. BELUM — M6A Strategi (O56)

Prasyarat: **`VND-` entity** (M6A §7 menyebutnya blocker: "E-8 dan F-4 tidak bisa
diimplementasi sebelum ini mendarat, jadi ia masuk batch migrasi yang SAMA dengan
`STRG`"). Prefix-nya sudah terdaftar; tabelnya belum ada.

| # | Ticket | Catatan implementasi |
|---|---|---|
| ~~A-02~~ | ~~`VND-` Vendor entity~~ | ✅ **SELESAI sesi 2** |
| ~~A-03~~ | ~~`STRG` + child tables~~ | ✅ **SELESAI sesi 2** — bentuknya; field per Section tetap di A-05…A-09 |
| ~~A-04~~ | ~~Mesin status #15~~ | ✅ **SELESAI sesi 2.** `Aktif → Draft Revisi` TIDAK didaftarkan — bertentangan dengan Rule 13; revisi = baris baru. Lihat DECISIONS 2026-08-06 |
| ~~A-05~~ | ~~Section A (16 field)~~ | ✅ **SELESAI sesi 3** — data + domain + route + tipe FE + gerbang submit. **Form UI belum** (belum ada halaman Strategi sama sekali; lihat A-13 di bawah) |
| ~~A-06~~ | ~~Section B per channel (±45 field ↻)~~ | ✅ **SELESAI sesi 3** — sama cakupannya. Kelengkapan Rule 5 ditegakkan gerbang submit per grup per channel, bukan `NOT NULL`: §7 meminta autosave 20 detik dan §5 langkah 5 meminta hitungan hidup, keduanya butuh keadaan setengah-terisi bisa disimpan |
| A-07 | Section C + validasi kutipan baseline | Rule 6: setiap akar masalah WAJIB mereferensi ≥1 field-ID baseline, divalidasi ada di Strategi yang sama |
| A-08 | Section D + asumsi | Stretch `>=` floor di level CHECK DB. `STRG_ASSUMPTION.status ∈ Berlaku/Gugur/Terverifikasi`; flip ke `Gugur` memicu `strategi_revisi_disarankan` — **O55 SUDAH SELESAI 2026-08-07**, transisi + emit boleh disambung |
| A-09 | Section E/F/G/H/I/J | Floor price per hero SKU (E-4) dibaca validasi Brief; F soft-limit 20% (Rule 10); G-0 `tanggal_mulai_siklus` sekali-set (Rule 17) |
| A-10 | Dua tier visibilitas | `STRG_FIELD_VISIBILITY` overlay + daftar hard-internal sebagai konstanta `packages/core`, ditolak di predikat TS **dan** CHECK DB (invariant beku: keduanya tidak boleh menyimpang) |
| A-11 | Tautan klien read-only `/s/{token}` | Token 32-byte disimpan ter-hash, satu aktif per Strategi, version-pinned ke versi Aktif, revocable + expirable, access-logged. Filter visibilitas diterapkan **sebelum** serialisasi — nol field internal di payload HTML |
| A-12 | Revisi + versioning | Rule 13: versi `n` tetap `Aktif` sampai `n+1` disetujui. Wajib trigger (dari H-2) + alasan + asumsi mana yang gugur. **Mesinnya sudah jalan (A-04) dan carry-over Section A/B/akses sudah teruji** — yang tersisa UI-nya + diff J-4 |
| **A-13** | **Halaman & form Section A→J** (tiket BARU, dipisah dari A-05…A-09) | Belum ada satu pun halaman Strategi. Sepuluh seksi tidak bisa jadi satu form: ia butuh shell halaman + navigasi seksi + autosave 20 detik (§7) + panel "kekurangan" hidup (§5 langkah 5) yang membaca `GET /strategi/{id}/kekurangan` per `kode`. **Kontraknya sudah ada dan sudah dijaga `shape-parity`** — `web-internal/src/lib/strategi.ts` mendeklarasikan setiap field Section A/B, jadi form bisa dibangun tanpa menebak bentuk badan respons. Bacalah `web-internal/AGENTS.md` lebih dulu: versi Next di repo ini bukan yang ada di data latih |

## 3. BELUM — M6B Plan (O56)

| # | Ticket | Catatan implementasi |
|---|---|---|
| **B-00** | **Entitas `CONTRACT` (O57)** | 🔴 **PRASYARAT KERAS B-01.** Keputusan pemilik 2026-08-07: kontrak = kumpulan Service satu klien dalam satu kesepakatan ⇒ `strategi.service_id` → `contract_id`. Rancangan langkah-demi-langkah: `docs/handoff/HANDOFF_M6ABC_SESI5.md` §4. Membalikkannya murah SEKARANG (satu FK, nol data produksi) dan mahal setelah periode Plan digenerate di atasnya |
| B-01 | `PLAN` + 6 child tables | `PLAN_TARGET` (menyimpan `nilai_strategi` immutable **dan** `nilai_dipakai`), `PLAN_ROW`, `PLAN_ROW_WEEK`, `PLAN_ACTUAL`, `PLAN_REVIEW`, `PLAN_FLAG`. `lingkup ∈ kontrak/klien` + `strategi_id` nullable (Plan Satuan) + `status_dormansi` |
| B-02 | Generasi periode | Anniversary-month dari `tanggal_mulai_siklus`. **Simpan day-of-month yang DIMAKSUD terpisah** dari tanggal terhitung, supaya start tanggal 31 tidak hanyut permanen ke 28 setelah lewat Februari |
| B-03 | Mesin status #16 | Periode 1 butuh persetujuan SPV; 2…n auto-aktif 00:00 WIB; `Menunggu Persetujuan` hanya untuk `Turun >10%` |
| B-04 | Penyesuaian target asimetris | §3: naik bebas · turun ≤10% wajib alasan + notif · turun >10% butuh SPV. **`defisit_terbawa` computed, immutable, tidak pernah diketik** — dan tidak pernah dihapus, hanya dibawa |
| B-05 | Distribusi mingguan turunan | Trigger DB: Σ kuota mingguan = `PLAN_ROW.kuota`, tolak dengan row-ID + delta (bukan error generik). Minggu terakhir menyerap sisa 8–10 hari, bukan minggu stub |
| B-06 | Realisasi hybrid | GMV manual (+ lampiran + tanggal ambil, jendela 5 hari); metrik lain auto & `UPDATE`-blocked untuk role AM di level DB **dan** RLS |
| B-07 | Penutupan periode transaksional | Semua baris terminal + GMV manual + review lengkap, atau tidak sama sekali. Partial close bukan sebuah state |
| B-08 | Carry-over eksplisit | Baris `Sebagian`/`Tidak Dikerjakan` → dibawa / dibatalkan / naik jadi revisi Strategi. Baris terbawa ditandai `Terbawa` + periode asal |
| B-09 | Scheduled jobs | (a) 00:00 WIB aktivasi + force-close; (b) tengah periode → `Baris Belum Dieksekusi`; (c) tutup+5 hari → `plan_realisasi_belum_lengkap`. Idempoten, WIB |
| B-10 | Plan Satuan (M6C §7) | `lingkup='klien'`, parent = Service, `Di Luar Service` menggantikan `Di Luar Strategi`, review 4 field (bukan 8), dormansi mesin #17. **Menutup Rule 6 M6C** |
| B-11 | Constraint integritas §4(b) | Partial unique index: satu service ⇒ paling banyak satu Plan; service dalam kontrak full-management tidak boleh menunjuk Plan `lingkup='klien'` |

## 4. TERBLOKIR — bukan pekerjaan kode

| # | Item | Menunggu |
|---|---|---|
| ~~X-01~~ | ~~Katalog notifikasi v2~~ | ✅ **SELESAI 2026-08-07** — O55 pilihan (a). `notif_catalog_versions` + 14 event v2 (13 M6A/6B/6C + `m6.client.assigned` O53). Katalog ada; `emit()`-nya belum dipasang |
| ~~X-02~~ | ~~Konfirmasi tier 33 entri katalog~~ | ✅ **SELESAI 2026-08-07** — O54. `Customer Review Management` → `tanpa_plan`; tier tengah 33%. Tier kini disetel di admin MSL, bukan migrasi |
| X-03 | Ambang pemicu (20 item · Rp 15jt · 1 bulan) | M6A GA-1: nilai awal, belum diuji ke data service riil |
| X-04 | RA-4 (jendela baseline tak rata antar channel → warning) | Yohan, sebelum validasi D-3 dikode |
| X-05 | RA-5 (`tanggal_mulai_siklus` default = tanggal mulai kontrak) | Yulianti, sebelum generasi Plan dikode |
| X-06 | RA-7 (tautan klien hanya versi aktif, tanpa riwayat/diff) | Yohan, sebelum client view dibangun |
| X-07 | PA-2/PA-5 (jendela GMV manual 5 hari · force-close +7 hari) | Yulianti |
| X-08 | PA-3 (metrik auto PE-3 belum tentu tersedia semua) | Hans — metrik yang belum ada harus jatuh ke manual **secara eksplisit**, tidak dicampur diam-diam dengan yang auto |
| X-10 | **O58 — "tidak ada" vs "belum dijawab" untuk enam field daftar bertanda WAJIB** (A-11, A-14, B-5.3, B-8.1, B-8.2) | Yohan / Yulianti. Sesi 3 memilih bacaan yang tidak memblokir (gerbangi angka pendampingnya, bukan daftarnya) dan mencatatnya; menambah checkbox "tidak ada" berarti field yang PRD tidak mendefinisikan |
| X-09 | **Tidak ada entitas CONTRACT di CDPS** — Strategi diikat ke `service_id` dan durasi/floor dideklarasi AM | Yohan / Yulianti — **O57**. Murah dibalik sekarang, mahal setelah periode Plan M6B digenerate di atasnya |
