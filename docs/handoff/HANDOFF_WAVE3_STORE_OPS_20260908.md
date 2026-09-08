# Handoff — Wave 3 Store Operation. Task berikutnya, ketokan sudah lengkap.

> **Ditulis 2026-09-08, sesudah PR #317 di-merge.** Ini titik mulai chat baru.
> Pendahulunya `HANDOFF_LANJUT_20260908_JALUR_A_TUTUP.md` — §2 dan §7 di sana
> (kesalahan yang sudah dibayar mahal + sembilan jebakan) **masih berlaku, baca
> dulu**. Berkas ini hanya menambahkan apa yang khusus Store Ops.

---

## 1. Posisi

| Apa | Nilai |
|---|---|
| **`main`** | `7afe80ec` — *Merge PR #317* |
| Migrasi | **202** |
| Gate | **146** tabel · **40** entity_prefix · **31** sm_machines · **73** notif_events |
| Live | mutakhir **kecuali** `20260922100400` (backfill A-3 — **no-op**, 0 baris; lihat handoff pendahulu §4) |
| Feedback OD | **9 dari 10 keluhan tertutup.** Yang tersisa: Store Ops ⟵ **berkas ini** |

```bash
cd /home/user/AgencyAPP
git fetch origin && git checkout main && git reset --hard origin/main
service postgresql start
su postgres -c "psql -c \"ALTER USER postgres PASSWORD 'postgres';\""
export DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps"
bash scripts/db-rebuild.sh --yes      # 202 migrasi, semua gate hijau
npm install && npm run typecheck --workspaces --if-present
(cd web-internal && npm install)
```

---

## 2. ✅ KETOKAN PEMILIK 2026-09-08 — pertanyaan terbuka SUDAH DIJAWAB

Handoff sebelumnya menahan Wave 3 karena satu pertanyaan: *daftar jenis SKU dan
siapa yang mengisi targetnya.* Nerissa (COO) sudah mengetoknya:

> **Daftar jenis SKU yang dioptimasi diisi oleh AM, beserta targetnya.
> Store Ops menjalankan dan mengevaluasi.**

Jadi **satu baris SKU punya TIGA momen dan DUA penulis**:

| Momen | Siapa | Menulis apa |
|---|---|---|
| 1. Lahir | **AM** | SKU mana, jenis optimasinya, **target**-nya |
| 2. Eksekusi | **Store Ops** | hasil kerja; **selesai saat gambar ter-upload** (K-6) |
| 3. Evaluasi | **Store Ops** | CTR / CVR / rating **sesudah ±30 hari**, langkah TERPISAH (K-6) |

### Tiga konsekuensi yang harus dibangun, bukan diasumsikan

1. **Kolom target read-only bagi Store Ops; kolom hasil read-only bagi AM** —
   ditegakkan **di DB**, bukan cuma TS. Presedennya sudah ada:
   `trg_strategi_target_guard_floor` (O57 (b)). Dua penulis pada satu baris
   tanpa dinding adalah cara termudah target berubah sesudah hasilnya keluar.
2. **`selesai` TIDAK boleh menunggu angka dampak** (K-6). SKU selesai saat
   gambar ter-upload; CTR/CVR wajib tapi di langkah review kemudian. Kalau
   digabung, leadtime **produksi** Store Ops ternoda waktu tunggu pasar, dan
   angka leadtime yang mengukur dua hal sekaligus tidak mengukur apa pun.
3. **Ini TIDAK bertentangan dengan K-1/A-5.** K-1 mencabut hak AM memilih nama
   *staff*; ia tidak mencabut hak AM menetapkan *cakupan*. Baris SKU adalah
   cakupan (apa + target), bukan penugasan (siapa) — yang terakhir tetap leader
   divisi. Kalau nanti ada yang mengira ini regresi K-1, tunjuk baris ini.

---

## 3. Fondasinya lebih matang dari dugaan — apa yang SUDAH ada

Jangan bangun dari nol; empat hal sudah berdiri:

| Sudah ada | Di mana | Catatan |
|---|---|---|
| Registry divisi | `packages/core/src/division.ts:83` + `20260829001000_m16_fondasi.sql:99` | `briefAssignable: true`, `dispatchTarget: true`, `punyaKuotaSatuan: **false**` |
| **Tiga jenis pekerjaan, SUDAH DIRATIFIKASI pemilik 2026-09-02** | `packages/core/src/plantask.ts:96-99` | `banding_pelanggaran` (kasus) · `setup_promo_toko` (promo) · `qc_konten_toko` (konten) |
| Slot pipeline tahapan | `20260830020000_m16_stage_seed.sql:132` | STORE_OPS **sengaja** tanpa baris (Rule 12). Komentarnya menyatakan: menyeed-nya nanti = **satu migrasi**, **nol perubahan TS** |
| Jumlah unit kerja anak di antrean | `private.brief_jumlah_anak` (A-req-3, `20260922100500`) | Sudah memakai `CASE` per divisi dan `ELSE 0`. **Tambahkan cabang Store Ops di situ**, jangan bikin fungsi kedua |

### ⚠️ Dua katalog yang bertengkar — dan urutan amannya

- `plantask.PLAN_TASK_CATALOG` → **3 jenis** Store Ops (di atas).
- `account.TASK_CATALOG` → **NOL** entri Store Ops (diperiksa: `grep -c "'Store Operation'"` = 0).

`division.ts:48-52` memperingatkan eksplisit: **`punyaKuotaSatuan` wajib `false`
selama `TASK_CATALOG` belum punya barisnya** — membaliknya lebih dulu meng-crash
komparator `normalizeTasks` di `undefined`. Jadi urutannya **isi `TASK_CATALOG`
DULU, baru nyalakan flag-nya**, dalam commit yang sama, dengan tesnya. Ada tes
jembatan `jenis` di `packages/domain/src/division.test.ts:74` — pakai itu.

---

## 4. Sepuluh butir Wave 3 (rencana induk §3), diurutkan ulang untuk ketokan §2

Sumber: `docs/handoff/PARALEL_FEEDBACK_OD_DUA_AKUN.md` §3.

1. **PRD** `docs/prd/CDPS_Module18_Store_Ops.md` — **belum ada** (diperiksa: nol
   berkas Store Ops di `docs/prd/`, total 26 PRD). Daftarkan di `CLAUDE.md` +
   `docs/prd/CDPS_Build_Plan.md`. **Tulis pembagian peran §2 di sana sebagai
   Rule, bukan catatan** — itu yang akan dibaca orang berikutnya.
2. **Prefix baru** untuk baris SKU — `docs/DATA_MODEL.md` + `entity_prefix` +
   `packages/core/src/ident.ts` (dual-home, `ident.registry.test.ts`).
   ⚠️ **Ini menaikkan gate `entity_prefix` 40 → 41.**
3. **Tabel anak** di bawah `briefs`, satu baris per SKU (K-5, pola sama
   `assets`/`creator_bookings`). Kolomnya **dua kelompok terpisah**: cakupan +
   target (AM) dan hasil + dampak (Store Ops) — plus **trigger** yang menjaga
   masing-masing (§2 butir 1). ⚠️ **Menaikkan gate tabel 146 → 147.**
4. **Mesin status + rollup** meniru `task.recomputeBriefRollup` /
   `kol.recomputeBriefRollup`. **Bawa pelajaran B-1a**: progres "n dari N" harus
   terlihat, jangan mati diam. ⚠️ **Menaikkan `sm_machines` 31 → 32.**
5. **Pipeline `STORE_OPS`** (menutup LT-2) + kode alasan pengembalian brief
   (menutup LT-8, `stage.ts:83`). Satu migrasi, nol TS.
6. **Pasang `StageTimelinePanel` di `/tasks/[id]`** — ini memperbaiki gerbang
   intake untuk **SEMUA** divisi tanpa halaman sendiri, bukan cuma Store Ops.
   Nilai tertinggi per baris kode di daftar ini.
7. **Halaman** `web-internal/src/app/(shell)/store-ops/` + tukar href nav
   `?division=Store+Operation` (catatan `nav.ts:243-254`).
8. **Rapikan dua katalog** — §3, urutan aman: `TASK_CATALOG` dulu, baru
   `punyaKuotaSatuan: true`.
9. **Bobot KPI** Store Ops semuanya `0`
   (`20260830040000_m16_perf_weights_zero.sql`) ⇒ performa selalu `—`. Isi
   sesudah metriknya ada (LT-1).
10. **Naikkan gate di `db-rebuild.sh` DAN `ci.yml`** — **di commit yang sama**
    dengan migrasinya. Counter itu **absolut, bukan delta**; ambil angkanya dari
    hasil `db-rebuild`, **jangan menebak**.

### Saran pemecahan PR

Wave 3 satu-satunya pekerjaan yang menaikkan gate, jadi jangan satu PR raksasa:

- **PR 1** — butir 1 (PRD) + 2 (prefix) + 3 (tabel + trigger) + 10 (gate).
  Di sinilah semua kenaikan counter terjadi, sekaligus.
- **PR 2** — butir 4 (mesin + rollup) + 5 (pipeline) + domain.
- **PR 3** — butir 6 (`StageTimelinePanel`, **bisa berdiri sendiri dan
  memperbaiki divisi lain juga**) + 7 (halaman).
- **PR 4** — butir 8 (katalog + flag) + 9 (bobot KPI).

Butir **6 bisa didahulukan kapan saja** — ia tidak bergantung pada 1–5 dan
langsung membayar utang divisi lain.

---

## 5. Jebakan khusus Wave 3 (di luar sembilan jebakan di handoff pendahulu)

1. **`punyaKuotaSatuan` adalah flag yang meng-crash `normalizeTasks`** kalau
   dinyalakan tanpa `TASK_CATALOG`. Peringatannya ada di `division.ts:48-52`;
   percayai.
2. **Jangan bikin fungsi jumlah-anak kedua.** `private.brief_jumlah_anak` sudah
   ber-`CASE` per divisi dengan `ELSE 0` — Store Ops hari ini jatuh ke `ELSE`.
   Tambahkan cabangnya di situ. Dua fungsi yang menjawab "berapa anaknya" adalah
   dua jawaban yang menunggu berbeda.
3. **Baris SKU akan dibaca divisi eksekusi DI BAWAH RLS.** Jangan
   `join services`/`clients` di jalur bacanya — itu perangkap O52, dan ia
   **membuang barisnya**, bukan mengosongkan kolomnya. Pakai pintu `private.*`
   SECURITY DEFINER (O52 opsi (b), diketok 2026-08-07). Fungsi yang sudah
   tersedia: `brief_client_id` · `brief_client_toko` · `client_toko` ·
   `service_client_id` · `brief_owner_am` · `service_owner_am` ·
   `brief_source_creative_id` · `employee_display_name` · `brief_jumlah_anak`.
4. **`rls_checks.sql` §43 (ledger O48) akan MERAH** kalau sebuah policy diberi
   lengan lead/divisi tanpa dikeluarkan dari daftar `expected` **di commit yang
   sama**. Itu bukan gangguan, itu gerbangnya bekerja.
5. **Empat bentuk `Brief` paralel di FE** (`account.ts`, `tasks.ts`,
   `creative.ts`, `kol.ts`) — hanya `account.ts::Brief` yang diikat
   `shape-parity`. Kalau Wave 3 menambah field Brief, tambahkan di **dua** tempat
   minimal atau halamannya `undefined` sementara parity tetap hijau. Menyatukan
   keempatnya masih utang terbuka.
6. **Tes yang menyeed tabel anak akan merusak SETIAP tes sesudahnya** di berkas
   yang cleanup-nya belum tahu (FK NO ACTION). Sudah kena dua kali:
   `briefs` di `strategi.test.ts`, `assets` di `account.test.ts`. Begitu tabel
   SKU ada, tambahkan barisnya di `afterEach` **sebelum** `delete from briefs`.

---

## 6. Definition of Done Wave 3 (di luar DoD standar `CLAUDE.md`)

- Pembagian peran §2 ditegakkan **di DB** (trigger), dan ada tes yang mencoba
  menulis dari sisi yang salah lalu **diharapkan gagal**.
- `selesai` **tidak** menunggu CTR/CVR, dan ada tesnya (K-6).
- Rollup memperlihatkan "n dari N", tidak mati diam (pelajaran B-1a).
- Gate baru di `db-rebuild.sh` **dan** `ci.yml`, angkanya dari hasil rebuild.
- `KNOWN_GAPS` di `route-parity.test.ts` **tetap kosong**.
- Tes RLS untuk baris SKU: staff Store Ops melihat barisnya sendiri, AM pemilik
  melihat semuanya, divisi lain **tidak**.

---

## 7. Masih menunggu ketokan pemilik — tidak memblokir Wave 3

- **O75** — Service nol jalur untuk SELESAI. Edge `[In Execution] → Done` ada di
  `sm_edges` tapi **nol pemanggil**. Perlu diketok: siapa yang boleh menutup
  Service, dan apa gerbangnya.
- **O76** — dari mana floor GMV bulanan datang. A-4 menutup separuh O57(b)
  (durasi) tapi bukan floor GMV; selama itu benar, **Sanggahan Target (D-7)
  kehilangan penegaknya**.

> Catatan: ketokan §2 memakai **logika yang sama** dengan O76 — angka yang
> dijanjikan ke klien harus datang dari yang menyepakatinya, bukan dari
> pelaksana. Kalau O76 nanti diketok, kemungkinan besar arahnya sejalan.

---

## 8. Angka acuan — naik, tidak pernah turun

```
db-rebuild.sh  202 migrasi
  gate: 146 tabel · 40 entity_prefix · 31 sm_machines · 73 notif_events
        ⚠️ Wave 3 akan menaikkan TIGA dari empat: tabel, entity_prefix, sm_machines

domain            2101 lulus (+1 skip) · 76 file · nol FAIL
core               983
db                  53
apps/api           445 lulus (+48 skip)   route-parity & shape-parity hijau
web-internal       684   (+ tsc --noEmit bersih + next build sukses)
web-client-portal   19
```

**Utang layar: 9, nol yang pernah dilihat mata.** Nol harness peramban di repo;
Chromium ada di `/opt/pw-browsers/chromium` — periksa path-nya
(`PLAYWRIGHT_BROWSERS_PATH`) sebelum memakainya. Daftar layarnya di handoff
pendahulu §5(b).
