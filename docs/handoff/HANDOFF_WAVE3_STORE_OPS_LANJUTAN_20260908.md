# Handoff — Wave 3 Store Operation: DELAPAN dari sepuluh butir selesai. Sisanya menunggu pemilik.

> **Ditulis 2026-09-08**, sesudah empat commit di branch
> `claude/handoff-store-ops-lanjutan-ovk4sh`. Ini titik mulai chat berikutnya.
>
> Pendahulunya: `HANDOFF_WAVE3_STORE_OPS_20260908.md` (rencana sepuluh butir) dan
> `HANDOFF_LANJUT_20260908_JALUR_A_TUTUP.md` §2 + §7 (**kesalahan yang sudah
> dibayar mahal + sembilan jebakan — masih berlaku, baca dulu**).

---

## 1. Posisi

| Apa | Nilai |
|---|---|
| Branch | `claude/handoff-store-ops-lanjutan-ovk4sh`, **4 commit** di atas `10d2023` |
| Migrasi | **204** (202 → +2: `20260924010000`, `20260924020000`) |
| Gate | **147** tabel · **41** entity_prefix · **32** sm_machines · **73** notif_events |
| Live (`CDPS SG`) | **BELUM di-apply** — lihat §5 |
| Feedback OD | **10 dari 10 keluhan tertutup.** Store Ops punya modul, entitas, halaman, dan angka |

```bash
cd /home/user/AgencyAPP
git fetch origin && git checkout claude/handoff-store-ops-lanjutan-ovk4sh
service postgresql start
su postgres -c "psql -c \"ALTER USER postgres PASSWORD 'postgres';\""
export DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps"
bash scripts/db-rebuild.sh --yes      # 204 migrasi, 4 gate + 4 invariant hijau
npm install && npm run typecheck --workspaces --if-present
(cd web-internal && npm install)
```

---

## 2. Yang sudah jadi — delapan butir

| # | Butir | Status | Di mana |
|---|---|---|---|
| 1 | PRD `CDPS_Module18_Store_Ops.md` | ✅ | + terdaftar di `CLAUDE.md` dan manifest `CDPS_Build_Plan.md` §1 |
| 2 | Prefix `SKU-` | ✅ | `entity_prefix` + `ident.ts`, gate 40→41 |
| 3 | Tabel anak + **dinding dua penulis** | ✅ | `store_ops_skus` + `trg_store_ops_skus_dinding_penulis`, gate 146→147 |
| 4 | Mesin + rollup | ✅ | mesin #32 `store_ops_sku` (gate 31→32) + `task.recomputeSkuBriefRollup` |
| 5 | Pipeline `STORE_OPS` (LT-2) | ❌ **MENUNGGU PEMILIK** | §4 |
| 6 | `StageTimelinePanel` di `/tasks/[id]` | ✅ | + `stage-panel-coverage.test.ts` yang menjaganya |
| 7 | Halaman `store-ops/` + nav | ✅ | `/store-ops` + `/store-ops/briefs/[id]`, href nav ditukar |
| 8 | Dua katalog + `punyaKuotaSatuan` | ✅ | + cabang `wrr_aggregate` (§3 butir 3) |
| 9 | Bobot KPI (LT-1) | ❌ **MENUNGGU PEMILIK** | §4 |
| 10 | Naikkan gate | ✅ | `db-rebuild.sh` **dan** `ci.yml`, di commit yang sama dengan migrasinya |

---

## 3. Tiga keputusan desain yang perlu diketahui sebelum menyentuh modul ini

### (1) Dinding dua penulis TIDAK memakai `jwt_division()` — dan itu disengaja

Ketokan 2026-09-08 minta kolom target read-only bagi Store Ops dan kolom hasil
read-only bagi AM, **ditegakkan di DB**. Jawaban yang jelas — trigger yang
membaca `jwt_division()` — **salah**, dan gagalnya senyap:

> Jalur TULIS CDPS berjalan privileged. `withClaims` (`packages/db/src/client.ts`)
> hanya dipakai jalur BACA, jadi setiap tulisan domain datang **tanpa klaim JWT**
> dan dengan role BYPASSRLS. Trigger ber-JWT melihat `NULL` pada SETIAP tulisan
> sungguhan — dinding yang selalu terbuka, dan itu lebih buruk daripada nol
> dinding karena ia terlihat seperti perlindungan. RLS juga bukan jawabannya:
> ia tidak pernah dievaluasi untuk penulis BYPASSRLS.

Yang dipakai: penanda sisi penulis **transaction-local**, `cdps.sku_writer`
(`'am'` | `'ops'`). Domain wajib memanggil `deklarasiPenulis(tx, …)` sebelum
UPDATE; **UPDATE tanpa penanda ditolak seluruhnya**, termasuk dari service role.
Satu pengecualian, sempit: UPDATE **status-saja**, yaitu pintu `sm_transition`.

Tesnya (`storeops-sku.rls.test.ts`) menulis dari sisi yang **salah** memakai
koneksi service-role dan menuntut kegagalan — jalur paling istimewa yang ada.

### (2) `[Terupload]` adalah SELESAI, `[Dievaluasi]` bukan syaratnya

K-6, dan ia muncul di **empat** tempat yang harus tetap sepakat:

- `storeops.SKU_PRODUKSI_SELESAI` (core) — `['[Terupload]', '[Dievaluasi]']`;
- `task.skuRollupTarget` — Brief menutup ke `[In Review]` saat semua baris tayang;
- `task.diagnoseBriefRollup` — `done` menghitung keduanya;
- `wrr_aggregate` — headline = `[Terupload]`, `[Dievaluasi]` di `rincian` terpisah.

Kalau salah satunya digeser jadi "hanya `[Dievaluasi]`", leadtime produksi divisi
ini mulai memuat ~30 hari waktu tunggu pasar. Ada tes untuk keempatnya.

### (3) Nol kolom `actual_done`

Worksheet aslinya punya kolom "Actual Done" yang diketik. Ia **tidak dibuat**:
`actual_done` = tanggal WIB transisi **pertama** ke `[Terupload]` di `audit_log`.
Alasannya bukan kerapian — tanggal yang diketik bisa **dimundurkan** setelah
tenggat lewat, dan itu menghapus keterlambatan dari catatan orang yang sedang
dinilai. Preseden: M16 Rule 4 dan `internal_tasks` ("NOL kolom keterlambatan").

---

## 4. Dua butir yang TIDAK dikerjakan, dan kenapa

> ### ✅ SUDAH DITANYAKAN 2026-09-08 — jawabannya "biarkan terbuka dulu"
>
> Keduanya diajukan ke pemilik di akhir sesi ini, dengan opsi konkret (termasuk
> tawaran memasang pipeline minimal ber-`Cek Brief AM` saja, dan tawaran
> menetapkan bobot KPI sekarang). **Pemilik memilih menahan dua-duanya.**
>
> Jadi **jangan tanyakan ulang** di sesi berikutnya, dan jangan pula
> menganggapnya lupa: menahan keduanya adalah pilihan sadar. Yang berubah dari
> keadaan sebelumnya hanya kepastiannya — ini bukan lagi "belum sempat dijawab",
> ini "diputuskan menunggu". Bangunkan lagi hanya kalau pemilik yang membawanya.

### LT-2 + LT-8 — daftar & urutan tahapan Store Operation

Ketokan 2026-09-08 menjawab *siapa yang mengisi daftar SKU dan targetnya* — ia
**tidak** menyebut satu pun nama tahap. Daftar & urutan kerja divisi adalah LT-2,
dijawab *"akan saya berikan menyusul"* (2026-08-29) dan **tetap ditahan** pada
pengecekan 2026-09-08.

> ⚠️ Handoff pendahulunya (§4 butir 5) menulis "Pipeline STORE_OPS (menutup
> LT-2)" seolah ketokan itu menutupnya. Tidak. Dan draf pertama PRD §7 sempat
> **mengarang enam nama tahap** sebelum dikoreksi di commit kedua — jangan ulangi:
> nama tahap yang salah bukan cuma label yang salah, `stage_definition.target_hari_kerja`
> menggantung padanya, jadi tebakan itu langsung jadi angka lead time yang
> dilaporkan ke COO.

Biayanya saat jawabannya datang tetap seperti yang dijanjikan
`20260830020000_m16_stage_seed.sql` — **satu migrasi, nol perubahan TS**:

1. `sm_machines` `stage_store_ops` + `sm_edges` antar tahap ⇒ **32 → 33**, gate di
   `db-rebuild.sh` **dan** `ci.yml` naik di commit yang sama;
2. satu baris `stage_pipeline` (`STORE_OPS`);
3. `n` baris `stage_definition`, `Cek Brief AM` sebagai checkpoint **pertama**
   (M16 Rule 10) + edge balik `Brief Dikembalikan ke AM → Cek Brief AM` (LT-4);
4. kode alasan LT-8 di `REASON_CODES_BY_DIVISION` (`stage.ts`) — sampai itu ada,
   divisi ini memakai fallback `['Brief kurang jelas']`.

Sampai jawabannya datang, `/store-ops` **menyatakan eksplisit** bahwa panel
Tahapan Produksi masih kosong karena LT-2, alih-alih membiarkannya terlihat
seperti kerusakan.

### LT-1 — bobot KPI M14 Store Operation

Tetap `0`, jadi performa divisi ini selalu `—`. Angkanya milik COO; menebaknya
berarti mengarang skor performa orang. `20260830040000_m16_perf_weights_zero.sql`.

Ditahan sadar pada pengecekan 2026-09-08, dengan alasan yang sama yang membuat
Sales dan AI Optimizer juga masuk berbobot 0 lebih dulu: bobot M14 §9
ditandatangani 2026-08-13 dan tiap profil peran pas 100, jadi menyisipkan
komponen berbobot sekarang berarti memotong ulang bobot itu **tanpa satu bulan
pun data nyata** dari divisi ini.

---

## 5. Live BELUM di-apply — dua migrasi baru

`20260924010000_m18_store_ops_sku.sql` dan `20260924020000_m18_store_ops_kuota_satuan.sql`
belum masuk `CDPS SG`. Ditambah `20260922100400` (backfill A-3, no-op) yang sudah
sengaja ditahan sejak sebelumnya.

**Aturan live yang berlaku:** hanya lewat `apply_migration`, **per berkas**, urut
nama. **JANGAN `supabase db push`** — ledger live memakai stempel waktu APPLY,
bukan nama berkas repo (O65).

⚠️ `20260924020000` menyentuh `wrr_aggregate`, fungsi yang dipakai job rekap
mingguan. Ia `CREATE OR REPLACE` (nol downtime), tapi apply-nya sebaiknya di luar
jam job berjalan.

---

## 6. Jebakan yang ditemukan sesi ini (di luar sembilan jebakan handoff pendahulu)

1. **`audit_log` menolak DELETE, jadi tes yang MENGHITUNG baris audit harus
   memakai id sekali-pakai per run.** Id bersama membuat hitungannya naik setiap
   kali suite dijalankan ulang atas DB yang sama. Polanya `RUN = Date.now()...`
   (sudah dipakai `showcase.test.ts` dan `recap.aggregate.test.ts`).
2. **`id_sequences` berkolom `next_n`, bukan `last_value`.** Tes "nol nomor
   terbakar" yang mengeja salah gagal dengan galat kolom, bukan assertion.
3. **`shape-parity` menolak interface wire baru yang belum terdaftar**, dan
   `FE_FILES` di berkas itu juga harus menyebut file lib FE-nya. Dua tempat.
4. **`punyaKuotaSatuan` menarik TIGA hal, bukan satu.** `TASK_CATALOG` yang
   didokumentasikan, **plus** CHECK constraint `wrr_divisi`/`wrr_catatan_divisi`
   (hardcode nama divisi, di luar "8 daftar duplikat" F-3), **plus** cabang
   `wrr_aggregate`. Yang ketiga paling berbahaya: divisi diakui tanpa cabang
   agregat ⇒ rekap melaporkan produksi **0** untuk tim yang bekerja, tanpa galat.
5. **Dua FAIL palsu A-T4 masih hidup** (`admin.test.ts` hari libur,
   `client.test.ts` Hold Service) saat suite domain dijalankan **dua kali** atas
   DB yang sama. `db-rebuild` dulu, baru percaya angkanya.
6. **`useAssignableEmployees` mengembalikan `AssignableEmployee[] | null`**, dan
   `EmployeePicker` menuntut `loading`/`error` — bukan `placeholder`.

---

## 7. Angka acuan — naik, tidak pernah turun

```
db-rebuild.sh  204 migrasi
  gate: 147 tabel · 41 entity_prefix · 32 sm_machines · 73 notif_events
  invariant: ident_checks · immutability_checks · rls_checks · auth_claims_checks

domain            2157 lulus (+1 skip) · 79 file · nol FAIL
core               983
db                  64
apps/api           493       route-parity (KNOWN_GAPS kosong) & shape-parity hijau
web-internal       693       (+ tsc --noEmit bersih + next build sukses)
web-client-portal   19
```

**Utang layar: 11** (9 lama + `/store-ops` + `/store-ops/briefs/[id]`), nol yang
pernah dilihat mata. Nol harness peramban di repo; Chromium di
`/opt/pw-browsers/chromium`. Dua halaman baru lulus `next build` dan terdaftar
di manifest rute — itu membuktikan ia merender, bukan bahwa tata letaknya benar.

---

## 8. Masih menunggu ketokan pemilik — tidak memblokir apa pun

- **LT-2 / LT-8** — §4. Menahan butir 5. **Ditanyakan 2026-09-08, pemilik memilih
  menahan.** Jangan tanyakan ulang.
- **LT-1** — bobot KPI. Menahan butir 9. **Ditanyakan 2026-09-08, pemilik memilih
  menahan.** Jangan tanyakan ulang.
- **O75** — Service nol jalur untuk SELESAI. Edge `[In Execution] → Done` ada di
  `sm_edges` tapi **nol pemanggil**.
- **O76** — dari mana floor GMV bulanan datang; selama itu terbuka, Sanggahan
  Target (D-7) kehilangan penegaknya.
