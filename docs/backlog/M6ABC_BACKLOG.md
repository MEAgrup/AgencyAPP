# Backlog — M6A (Strategi) · M6B (Plan) · M6C (Plan Gate)

> Dibuat 2026-08-06 dari QA halaman `/account/services/SVC-202608-0002`.
> PRD: `docs/prd/CDPS_Module6A_Strategi.md`, `…6B_Plan.md`, `…6C_Plan_Gate_Satuan.md`.
> Keputusan & deviasi: `docs/DECISIONS.md` 2026-08-06 + 2026-08-07.
> **O54, O55, O57, O58 SELESAI** (2026-08-07). **O56 sudah dijawab pemilik
> 2026-08-07: ronde berikutnya adalah CACAT 🔴 (O52/O51/O42) lebih dulu, bukan
> M6A A-13 maupun M6B B-01.**
> **QA pemilik ronde 2 (2026-08-07): X-03/X-04/X-05/X-07 dijawab; X-10 dicoret
> (sudah selesai sejak sesi 5, barisnya basi); O26/O34/O35/O25/O6/O9 ditutup.**
> **RONDE CACAT DIEKSEKUSI 2026-08-07 — O52 (b) · O51 (a) · O48 (b)+ledger sudah
> mendarat & di-apply ke live. O47b diputus (b) dan cakupannya menyusut drastis
> (`main` tidak memuat PII). O44-asal ternyata sudah selesai sejak 29 Juli.
> X-11 diputus provisional & diimplementasi (D-3 turunan). Semua di
> `HANDOFF_M6ABC_SESI7.md` — baca itu untuk memulai.**

## 0a. Papan skor (per 2026-08-07, sesudah B-00)

Hitungan tiket, bukan effort — A-13 sendirian lebih besar dari A-05…A-07 digabung.

| Bagian | Selesai | Total | % |
|---|---|---|---|
| **M6A Strategi** | A-00…A-07 = **8** | 14 | **57%** |
| **M6B Plan** | B-00 = **1** | 12 | **8%** |
| M6C Plan Gate | C-01…C-07 = 7 | 8 (B-10 menutup Rule 6) | 88% |
| **M6A+M6B gabungan** | **9** | 26 | **35%** |

Yang membuat angka M6A menyesatkan kalau dibaca sendirian:

- **Lapisan data+domain M6A ≈ 70%** — 16 tabel, mesin #15, 137 test domain hijau.
- **Lapisan UI M6A = 0%.** Tidak ada satu pun halaman `strategi`/`STRG`. Halaman
  `account/strategies/[id]` yang ada adalah entitas **lama** M6 §4
  (`strategy_plan`/`STR`, PR #37) — bukan entitas ini. Jangan tertipu namanya.
- **Section A→J: 4 dari 10 mendarat + narasi E/H** (A ✅ B ✅ C ✅ **D ✅** · narasi E/H ✅ A-09a · sisa = **A-09b**).
- ✅ **O59 SELESAI 2026-08-08** — pemilik pilih (b) repo menang, sudah dieksekusi.
  Live `CDPS SG` **≡ repo** untuk Section D + A-09a: tabel 77→**76**, event
  **34/34**, event v4 hanya `m6a.strategi.sanggahan_target`, D-5 3 kolom, narasi
  4 kolom, kelima nama CHECK repo. Migrasi `20260808030000_o59_rekonsiliasi_section_d`.
- **M6B nol tabel `PLAN`** — `plan_gate_config` milik M6C, bukan M6B. Mesin #16
  belum ada.

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

### Sesi 4 (2026-08-07) — M6A A-07

| # | Ticket | Isi |
|---|---|---|
| A-07 | Section C (Diagnosa & Akar Masalah) | `strategi_diagnosa`: `bottleneck` enum tertutup, `field_ids` array jsonb, `akar_masalah`/`gap_kompetitor` non-kosong dijaga CHECK. Rule 6 ditegakkan atas **set tertutup** `VALID_BASELINE_FIELD_IDS` — kutipan ke field-ID yang tidak dikenal ditolak, bukan hanya "≥1 kutipan" |

### Sesi 5–6 (2026-08-07) — B-00 + penutupan drift migrasi

| # | Ticket | Isi |
|---|---|---|
| B-00 | Entitas `CONTRACT` (O57) | Lihat §3. Prasyarat keras M6B B-01 — satu-satunya tiket M6B yang selesai |

Sesi 5 juga menerapkan **11 migrasi tertunda** ke live `CDPS SG` (drift O38 ronde 3
ditutup) dan mengeksekusi O54/O55/O58. Sesi 6 memverifikasi live ≡ repo lewat
**sidik jari struktural** (133 fakta: kolom, constraint, indeks, RLS policy,
definisi fungsi, trigger) — `4e2580fd4a47bec0f05777dd2c19569e` identik di kedua
sisi. Metode itu, bukan "migrasi jalan tanpa error", yang membuktikan tidak ada
drift ronde keempat.

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
| ~~A-07~~ | ~~Section C + validasi kutipan baseline~~ | ✅ **SELESAI sesi 4** (`a9b7a47`, migrasi `20260807000000_m6a_section_c.sql`, merged PR #103). Rule 6 ditegakkan atas **set field-ID tertutup** (`VALID_BASELINE_FIELD_IDS`), bukan string bebas: kutipan ke field yang tidak ada ditolak `MSG_DIAGNOSA_INVALID_FIELD_ID`, nol kutipan ditolak `MSG_DIAGNOSA_FIELD_ID_REQUIRED`. `field_ids` disimpan sebagai array jsonb (bukan objek) — perbaikan `58f6588` yang membuat A-07 bisa diuji terhadap DB. **Form UI belum** (A-13) |
| ~~A-08~~ | ~~Section D + asumsi~~ | ✅ **SELESAI 2026-08-08** — migrasi `20260808000000_m6a_section_d.sql`, **nol tabel baru** (gerbang tetap 76). D-5 = tiga kolom `definisi_berhasil_30/60/90` (kardinalitas tetap ⇒ bukan tabel anak); D-6 = array jsonb `leading_indicator`, DB menegakkan bentuk + cap 5 + keanggotaan set tertutup lewat `<@`; D-7 = lima kolom `sanggahan_*` + CHECK semua-atau-tidak-ada, dan ia **tidak bisa** menurunkan floor karena jalurnya tidak menyentuh `strategi_target`. Stretch `>=` floor sudah ada sejak A-03 (`ck_strtg_stretch_gmv`), tidak diubah. Flip `STRG_ASSUMPTION.status` → `Gugur` **sudah** mengemisikan `strategi_revisi_disarankan`, dan endpoint-nya sengaja bisa dijangkau saat `Aktif` — asumsi gugur saat eksekusi, bukan saat draft. **Katalog naik ke v4** untuk `m6a.strategi.sanggahan_target` (§4 vs §7 D12; deviasi tercatat, gerbang event 33→34). D-3 tidak disentuh (X-11: turunan). Bonus: memperbaiki bug `openRevision` yang men-drop kolom header baru. **Form UI belum** (A-13). ⚠️ **Belum di live — O59** |
| ~~A-09a~~ | ~~Field NARASI Section E & H~~ | ✅ **SELESAI 2026-08-08** — migrasi `20260808010000`, **nol tabel baru** (gerbang tetap 76). E-1 `growth_thesis`, E-13 `urutan_eksekusi_alasan`, H-3 `skenario_mundur`, H-4 `kondisi_stop_scope`. Tiga pertama `W` dan digerbangi (`E-1`/`E-13`/`H-3`); H-4 `O` dan **sengaja tidak** digerbangi. Semua ikut tersalin ke revisi — H-4 juga, karena ia KONTEN (kondisi yang berlaku terus), berbeda dari D-7 yang sebuah TINDAKAN. **H-4 tidak ditulis ke `audit_log`**: ia hard-internal §4.1 dan `audit_log` punya read-scope berbeda dari `strategi`, jadi yang dicatat adalah field MANA yang terjawab, bukan isinya. `saveNarasi` · `PUT /strategi/{id}/narasi` |
| **O42-b** | **Seed `role_mappings` pindah ke string HRIS (keputusan pemilik 2026-08-08)** | Pemilik: sumber kebenaran = **live**; seed pakai mapping dari **B** (`supabase/seed/role_mappings_riil.csv`, UPPERCASE), bukan 12 baris Title Case karangan di `seed.sql`. ⚠️ **Bukan tempelan — ini tiket tersendiri.** Join `rm.divisi = e.divisi AND rm.jabatan = e.jabatan` **peka huruf besar-kecil**, jadi menukar mapping seed ke UPPERCASE **mengharuskan 10 karyawan seed ikut berubah** ke string HRIS; kalau tidak, join nol ⇒ `private.employee_role` dan resolusi lead `notify_emit` mati di CI. Yang ikut bergerak: gerbang `role_mappings = 12` di `ci.yml` + `db-rebuild.sh`, dan setiap test yang bersandar pada lead ter-resolve (mis. test A-08 Sanggahan Target yang memakai `EMP-0006` Sales Head). Regenerate B **dari live** lebih dulu (live 39 baris vs B 23). Enam kueri verifikasi di `docs/handoff/O42_REKONSILIASI_ROLE_MAPPINGS.md`. **(c) sudah dijawab:** Direktur memang tidak punya divisi ⇒ `Management/Director` tanpa mapping adalah BENAR; INNER JOIN O51 tetap, dan `m5.transaction.change_requested` tetap `explicit` (jangan pernah `leadsOfDivision`) |
| **A-09b** | **Sisa Section E/F/G/H/I** (tiket BARU, dipisah dari A-09) | Analisis celah SUDAH dikerjakan 2026-08-08 — jangan ulangi. **Sudah ada, jangan bangun ulang:** E-3…E-11 (`strategi_pillar`, enum `jenis` lengkap) · F-1…F-6 (`strategi_resource`) · F-7 + G-0 (kolom header) · H-1 (`strategi_risk`) · J-1/J-2 (header) · J-3 (`strategi_version`) · I-1 + J-4 **turunan, tidak pernah disimpan**. **Belum ada:** **E-2** prioritas channel (kolom `strategi_channel` + catatan) · **E-12** ketergantungan klien (tabel anak) · **G-1** fase kerja (tabel anak, min 2) · **G-2** tanggal besar (tabel anak) · **G-3/G-4** jadwal review klien & SPV (kolom header) · **H-2** trigger revisi multi-enum + threshold — ⚠️ `strategi_version.trigger_revisi` (J-3) SUDAH memakai kode trigger, jadi set enum H-2 harus set yang SAMA, bukan daftar kedua (kelas O48/O51) · **I-2** divisi penerima Brief + urutan dispatch · **I-3** metrik laporan klien · **I-4** catatan per divisi (`O`). E-4 floor price sudah ada (`strategi_pillar.floor_price` + `ck_strpil_floor_sku`); yang belum adalah validasi Brief yang MEMBACANYA — itu tiket M7/M12, bukan M6A. ⚠️ Setiap kolom header baru WAJIB masuk DUA daftar di `openRevision`, dan kalau field-nya bukan syarat submit, hilangnya tidak membuat satu test pun merah |
| A-10 | Dua tier visibilitas | `STRG_FIELD_VISIBILITY` overlay + daftar hard-internal sebagai konstanta `packages/core`, ditolak di predikat TS **dan** CHECK DB (invariant beku: keduanya tidak boleh menyimpang) |
| A-11 | Tautan klien read-only `/s/{token}` | Token 32-byte disimpan ter-hash, satu aktif per Strategi, version-pinned ke versi Aktif, revocable + expirable, access-logged. Filter visibilitas diterapkan **sebelum** serialisasi — nol field internal di payload HTML |
| A-12 | Revisi + versioning | Rule 13: versi `n` tetap `Aktif` sampai `n+1` disetujui. Wajib trigger (dari H-2) + alasan + asumsi mana yang gugur. **Mesinnya sudah jalan (A-04) dan carry-over Section A/B/akses sudah teruji** — yang tersisa UI-nya + diff J-4 |
| **A-13** | **Halaman & form Section A→J** (tiket BARU, dipisah dari A-05…A-09) | Belum ada satu pun halaman Strategi. Sepuluh seksi tidak bisa jadi satu form: ia butuh shell halaman + navigasi seksi + autosave 20 detik (§7) + panel "kekurangan" hidup (§5 langkah 5) yang membaca `GET /strategi/{id}/kekurangan` per `kode`. **Kontraknya sudah ada dan sudah dijaga `shape-parity`** — `web-internal/src/lib/strategi.ts` mendeklarasikan setiap field Section A/B, jadi form bisa dibangun tanpa menebak bentuk badan respons. Bacalah `web-internal/AGENTS.md` lebih dulu: versi Next di repo ini bukan yang ada di data latih |

## 3. BELUM — M6B Plan (O56)

| # | Ticket | Catatan implementasi |
|---|---|---|
| ~~B-00~~ | ~~Entitas `CONTRACT` (O57)~~ | ✅ **SELESAI 2026-08-07** — migrasi `20260807120000`, domain `packages/domain/src/contract.ts`, 4 route baru. Prefix `CTR` (registry 29→30), tabel `contracts` (tabel 74→75), `services.contract_id` nullable, `strategi.contract_id` NOT NULL menggantikan `service_id`, tiga indeks unik jadi per-kontrak, RLS `private.jwt_is_am_of_contract` di dua tempat. Jendela kontrak PINDAH (tidak disalin) — lihat DECISIONS 2026-08-07 "O57 DIEKSEKUSI". `POST /services/{id}/strategi` tidak berubah: ia mencetak kontrak 1:1 kalau Service belum punya. **B-01 tidak lagi terblokir** |
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
| ~~X-03~~ | ~~Ambang pemicu M6C (20 item/bln · Rp 15jt/bln · durasi >1 bulan)~~ | ✅ **SELESAI 2026-08-07** — pemilik: *"case ini butuh plan"*. Angka PRD dipertahankan; hard trigger durasi >1 bulan memang dimaksudkan menyala, dan yang menanganinya adalah M6C Rule 4 (keputusan AM adalah keputusannya). GA-1 dikode apa adanya, tanpa menunggu data service riil |
| ~~X-04~~ | ~~RA-4 (jendela baseline tak rata antar channel)~~ | ✅ **SELESAI 2026-08-07** — pemilik: *"tidak ada rumus untuk kasus ini, target GMV dibuat per platform sama dengan baseline"*. **Nol warning dibangun**: tidak ada angka yang menyeberang antar channel, jadi premis RA-4 hilang. Konsekuensinya untuk D-3 dibuka sebagai **X-11**, tidak diputuskan diam-diam |
| ~~X-05~~ | ~~RA-5 (`tanggal_mulai_siklus` default = tanggal mulai kontrak)~~ | ✅ **SELESAI 2026-08-07** — dijawab pemilik ("tanggal mulai siklus = tanggal mulai kontrak") dan langsung diimplementasi: `normalizeHeader` mengisi G-0 dari `tanggalMulaiKontrak` saat kosong; override AM tetap hidup; Rule 17 tidak dilonggarkan. Nol migrasi. Lihat DECISIONS 2026-08-07 |
| X-06 | RA-7 (tautan klien hanya versi aktif, tanpa riwayat/diff) | Yohan, sebelum A-11 dibangun. **Contoh:** Strategi v1 janji ROAS 4,0; v2 (revisi bulan ke-3) menurunkannya jadi 3,2. Klien membuka `/s/{token}` dan melihat **3,2 saja** — tanpa jejak bahwa pernah 4,0. PRD memang meminta itu (AM menjelaskan di meeting). Yang perlu ditegaskan: apakah itu tetap posisi MEA kalau kliennya menanyakannya |
| ~~X-07~~ | ~~PA-2/PA-5 (jendela GMV manual 5 hari · force-close +7 hari)~~ | ✅ **SELESAI 2026-08-07 — 🔶 DEVIASI PRD.** Pemilik: *"jangan buat jendela ditutup tidak bisa update, biarkan tetap terbuka, tapi jadi point log buruk untuk kinerja AM"*. State `Ditutup Otomatis` **tetap ada dan tetap otomatis** (mesin #16 tidak berubah); yang dicabut adalah **efek kuncinya**. B-06/B-07/B-09 wajib dibaca ulang dengan ini. Komponen KPI-nya belum ada ⇒ **X-12** |
| X-08 | PA-3 (metrik auto PE-3 belum tentu tersedia semua) | Hans / developer — bukan pemilik. **Contoh:** PE-3 mendaftar 6 metrik auto (ad spend, ROAS/ACOS, jumlah video selesai, kreator aktif, **jam live vendor**, Brief selesai/total). Jam live vendor datang dari M10 yang vendornya melapor **di luar sistem** (PA-4) ⇒ metrik itu de-facto manual. Yang wajib: daftar metrik manual ditulis **eksplisit** di UI, tidak dicampur diam-diam dengan yang auto, supaya AM tahu angka mana yang dia pertanggungjawabkan |
| ~~X-10~~ | ~~O58 — "tidak ada" vs "belum dijawab" untuk field daftar bertanda WAJIB~~ | ✅ **SELESAI 2026-08-07** — O58 dijawab pemilik (pilihan (a)) dan sudah mendarat: kolom `{field}_tidak_ada` untuk **lima** field (A-11, A-14, B-5.3, B-8.1, B-8.2 — bukan enam; B-3.5/B-4.5 sudah opsional), gerbang submit jadi "daftar terisi XOR checkbox dicentang", pesan `MSG_TIDAK_ADA_BELUM_DIJAWAB`. Baris ini basi sejak sesi 5; UI checkbox-nya menunggu A-13 |
| ~~X-11~~ | ~~D-3 turunan atau diketik?~~ | ✅ **SELESAI 2026-08-07 (provisional)** — pemilik: *"buat target turunan dulu, biarkan nanti saya QC di production"*. `komposisiKontribusi()` dihitung dari D-2 metrik `gmv`; **nol kolom penyimpan, nol migrasi** supaya berubah pikiran tetap murah. Deviasi PRD tercatat (`W`→Auto). A-08 **tidak lagi terblokir** |
| ~~X-13~~ | ~~Daftar enum D-6~~ | ✅ **SELESAI 2026-08-08** — pemilik: *"jalankan rekomendasi"*. Set D-6 = kosakata metrik **D-4** apa adanya (10 nilai = `ck_strtg_metric`). Alasannya bertahan: D-6 meminta yang dipantau mingguan **sebagai angka**; *"listing selesai ditulis ulang"* adalah **tugas**, rumahnya `PLAN_ROW` (M6B), dan memasukkannya ke D-6 membuat D-6 duplikat Plan. **Nol perubahan kode** — implementasinya sudah begitu sejak A-08 |
| X-12 | "Point log buruk" X-07 belum punya komponen KPI | 🟡 **DIJADWALKAN 2026-08-07** — pemilik: *"rumahnya akan dibuat menyusul"*. Bukan blocker. **Batas sampai rumahnya ada:** B-09 boleh mencatat keterlambatan ke audit log, **tidak boleh** mengklaim ia memengaruhi Performance Score, dan tidak boleh mengarang bobotnya |
| ~~X-09~~ | ~~Tidak ada entitas CONTRACT di CDPS~~ | ✅ **SELESAI 2026-08-07** — O57 diputus & dieksekusi (B-00) |
