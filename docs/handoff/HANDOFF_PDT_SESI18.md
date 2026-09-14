# HANDOFF — PDT (Pusat Data Toko) SESI 18 → SESI 19

> **Dibuat 2026-09-14.** Baca berkas ini sebelum lanjut (rantai: … → sesi 17 →
> berkas ini; `docs/handoff/HANDOFF_PDT_SESI17.md` untuk detail teknis LENGKAP
> tiga modul sesi lalu — `pdt_sku_master` (modul 3), `tt_transaction_creator`
> (modul 4), `shopee_ams_afiliasi` (modul 5) — TIDAK diulang di sini).
> Instruksi sesi ini (pemilik, Nerissa): **"buat pr merge, kemudian buat
> handoff untuk lanjut task di chat berikutnya."**

---

## 0. Apa yang terjadi sesi ini (murni PR/merge, NOL kode baru)

Sesi ini TIDAK menambah modul/fitur baru — kerjanya administratif menutup
rantai kerja sesi 17 (tiga modul PDT: `pdt_sku_master`, `pdt_fact_creator_period`
×2 sumber) yang sampai akhir sesi 17 baru ada di branch sesi, belum di-PR:

1. **Branch sesi (`claude/ecstatic-cannon-78wwsn`) sudah tertinggal dari
   `main`, DUA KALI berturut-turut** — `main` maju lewat PR #371 (HR: 3 operasi
   roster + gerbang CI suite senyap) lalu PR #372 (catatan eksekusi pencabutan
   `director`), keduanya tidak terkait PDT. Branch di-merge dengan
   `origin/main` DUA KALI (`git merge origin/main`, sekali per PR yang masuk)
   supaya PR mergeable bersih — **konflik di `docs/DECISIONS.md` kedua kali**,
   tapi BEDA JENIS resolusi masing-masing: merge pertama (vs PR #371) kedua
   sisi baris DIPERTAHANKAN (baris berbeda, ditambah berdampingan, digabung
   berurutan); merge kedua (vs PR #372) baris `origin/main` MENGGANTIKAN baris
   `HEAD` sepenuhnya (PR #372 ternyata REVISI-DI-TEMPAT baris yang SAMA persis
   yang sudah masuk dari merge pertama — menambahkan bagian "DIEKSEKUSI" ke
   baris yang identik — bukan baris baru, jadi versi lama harus dibuang, bukan
   dipertahankan berdampingan; salah baca jenis konflik ini akan menduplikasi
   satu baris decision log).
2. **Verifikasi PENUH dijalankan ULANG setelah kedua merge** (bukan cuma
   dipercaya dari commit sesi 17) — DB lokal di-rebuild dari 234 migrasi (naik
   dari 232 sesi 17, dua migrasi baru dari PR #371 yang MASUK lewat merge,
   bukan ditulis sesi ini), semua gate CI lolos. `npm run typecheck --workspaces`
   bersih; `@cdps/core` **1174 tes**; `@cdps/domain` **2574 tes/1 skip**
   (naik dari 2570 — bertambah dari test suite PR #371, bukan dari kerja PDT);
   `@cdps/api` **567 tes/2 skip** (SEMUA, bukan cuma filter `pdt` seperti sesi
   17 — termasuk `gelombang-c-showcase.e2e.test.ts`, yang sesi-sesi
   sebelumnya (2-15) selalu mencatat sebagai kegagalan pra-ada/flake, sekarang
   **LOLOS** — kemungkinan ikut diperbaiki PR #371, bukan disentuh sesi ini);
   `web-internal` (workspace TERPISAH, bukan bagian `npm workspaces` root —
   `cd web-internal && npm install && npm test`) **763 tes** + typecheck
   bersih; `npm run lint --workspaces` bersih.
3. **PR #373 dibuat** dari `claude/ecstatic-cannon-78wwsn` ke `main`, judul
   merangkum ketiga modul (bukan cuma modul terakhir), body mencantumkan
   ringkasan tiap modul + hasil verifikasi lengkap.
4. **CI PR #373 ditunggu sampai selesai SEBELUM merge** (bukan langsung
   di-merge begitu dibuat) — 6 check (`api`, `core-engines`, `db-and-migrations`,
   `web-client-portal`, `web-internal`, Vercel preview) semua **hijau**, dan
   `mergeable_state` dikonfirmasi `clean` sesudah merge kedua (vs PR #372) di
   atas. Merge run pertama sempat terpicu SEBELUM merge kedua selesai — GitHub
   otomatis menjalankan CI run KEDUA setelah push susulan; kedua run dicek
   hijau, bukan cuma yang terakhir.
5. **PR #373 di-MERGE** (merge commit `e7305db`) atas instruksi eksplisit
   pemilik di chat (sama pola `HANDOFF_PDT_SESI16.md` — sekali lagi bukan
   default baru, instruksi eksplisit per sesi).
6. **Branch sesi di-restart dari `main` pasca-merge** (`git reset --hard
   origin/main`, fast-forward, nol riwayat baru selain merge commit yang sudah
   di `main`) dan di-push — status bersih, siap dipakai lagi kalau sesi
   berikutnya kebetulan melanjutkan di branch yang sama (pola identik
   `HANDOFF_PDT_SESI16.md` §0 butir 6).
7. Cluster Postgres lokal sempat perlu di-restart ulang + password di-set
   ulang di tengah sesi ini juga (bukan cuma sesi 17) — lihat §2 untuk urutan
   perintahnya, KEMUNGKINAN perlu diulang lagi sesi berikutnya kalau
   kontainer/cluster tidak persisten antar sesi.

**NOL perubahan kode/skema PDT sesi ini** — seluruh isi PR #373 (sekarang di
`main`) sudah didokumentasikan lengkap di `docs/handoff/HANDOFF_PDT_SESI17.md`
+ `docs/DECISIONS.md` (tiga baris Decided 2026-09-14, modul 3/4/5).

---

## 1. Yang perlu ditindaklanjuti sesi berikutnya

**Sama seperti rekomendasi sesi 17 (belum berubah — nol kerja modul baru
sesi ini):**

1. **Kandidat modul KEENAM — butuh pola BARU (lookup lintas-tabel ke
   `pdt_sku_master.id`), belum ada preseden di PDT:**
   - `tt_transaction_product` → `pdt_fact_sku_period`. Grain PER PRODUK
     (`Product ID`, `PDT_KOLOM_DIPANEN.md` §1.3 eksplisit per-produk, TIDAK
     ada ambiguitas legacy-parser seperti `shopee_ads_cpc`) — tapi
     `pdt_fact_sku_period.sku_id` adalah FK ke `pdt_sku_master`, bukan
     `platform_product_id` langsung. Verifikasi dulu: apakah `Product ID`
     modul ini SAMA dengan `platform_product_id` yang sudah ditulis
     `pdt_sku_master` dari `tt_orders` (`SKU ID`) — DUA nama kolom berbeda
     untuk kemungkinan konsep yang sama, atau genuinely dua level berbeda
     (ingat kasus `tt_transaction_product` vs `tt_orders` yang jadi alasan
     deviasi Rule 18 di `pdt_sku_master` sesi 17 — pola serupa bisa terulang
     di sini, JANGAN diasumsikan sama tanpa cek).
   - `shopee_ams_produk` → grain PER PRODUK (`Kode Item`) — sama kelas
     kebutuhan lookup, sama peringatan: `Kode Item` vs `Kode Produk`
     (`shopee_parent_sku`, sudah di `pdt_sku_master`) perlu diverifikasi
     apakah kolom yang SAMA atau BEDA sebelum dipakai sebagai kunci lookup.
2. **`shopee_ads_cpc` — JANGAN dibangun tanpa sample asli** (`G1-09-2BII-ADS-CPC`,
   diperbarui sesi 17) — grain baris (per-produk vs per-iklan) belum
   terverifikasi, salah pilih `kampanye_id` berisiko unique-violation runtime.
3. **Resolusi `sku_id` untuk `tt_video`/`shopee_ads_live` yang SUDAH ditulis**
   — keduanya masih `sku_id=NULL` selamanya. `tt_video` sumber SKU-nya kolom
   `Produk`, BELUM diverifikasi formatnya cocok dengan `tt_orders.SKU ID`/
   `Product Name` — verifikasi dulu, jangan tebak.
4. **`shopee_video`/`tt_live` masih BLOCKED** (`G1-09-2BII-SHOPEELIVE` +
   `G1-09-2BII-TTLIVE`) — jangan diulang kecuali ada sample asli baru.
5. **`G1-09-2BII-SKU-STATUS-TRANSISI`** — kriteria `status_listing` →
   `nonaktif`/`dihapus_platform` belum ditentukan PRD; perlu keputusan
   pemilik/Hans-Anty sebelum dibangun.
6. Item lama masih terbuka, tidak tersentuh sejak sesi 13-17: `G1-07-
   PERSKU-PESANAN`, `G1-07-TIKTOK-REKONSILIASI`, `G1-09-DETEKSI-PREAMBLE-
   AMBIGU`, `G1-08-SEBAGIAN`, `G1-06-PERIODE-TIKTOK`, `G1-07-PERSKU-DIBAYAR`.
7. G1-09 sub-langkah 3 (halaman upload `web-internal`) dan endpoint konfirmasi
   identitas AM (`usulkan_ikat` → menulis `client_platforms.shop_id`/
   `akun_konten_toko`) — masih belum ada.
8. **CI `db-and-migrations`** — **HIJAU** dikonfirmasi sebelum merge PR #373
   (dicek langsung lewat `get_check_runs`, bukan diasumsikan) — pra-ada
   kegagalan sesi-sesi lalu (`client_platforms` unique-active-platform
   collision) TIDAK terulang di run ini. Kalau merah lagi di `main` sesi
   berikutnya, itu masalah BARU (atau flake baru), bukan yang sudah dikenal.

## 2. Konteks penting untuk sesi berikutnya

- **Mulai dari `main` langsung** — PR #373 SUDAH di-merge (`e7305db`), tidak
  ada lagi branch PR PDT yang menggantung. Sesi berikutnya: `git fetch origin
  main && git checkout -b <branch-baru> origin/main`; kalau kebetulan dapat
  `claude/ecstatic-cannon-78wwsn` lagi, branch itu SUDAH di-restart dari
  `main` pasca-merge (bersih, nol commit tambahan di atas `main`).
- **Lima modul/empat tabel fakta (dari enam) kini punya penulis**:
  `pdt_fact_ads` (`shopee_ads_live`), `pdt_fact_content` (`tt_video`),
  `pdt_sku_master` (`shopee_parent_sku`+`tt_orders`), `pdt_fact_creator_period`
  (`tt_transaction_creator` + `shopee_ams_afiliasi`, KEDUA platform). **Sisa
  SATU tabel fakta tanpa penulis: `pdt_fact_sku_period`** + 19 modul lain
  belum dipetakan.
- **Setup DB lokal (kalau kontainer baru, ulangi urutan ini):**
  ```
  pg_ctlcluster 16 main start
  su postgres -c "psql -c \"ALTER USER postgres WITH PASSWORD 'postgres';\""
  bash scripts/db-rebuild.sh --yes
  ```
  Password TIDAK persisten antar restart cluster — kena lagi kalau sesi
  sebelumnya restart container. `npm install` di root (dependencies juga
  kosong di kontainer baru) DAN `cd web-internal && npm install` terpisah
  (bukan bagian `npm workspaces` root).
- **Progress ringkas G1-09**: lihat `docs/backlog/PDT_BACKLOG.md` §G1-09
  status teratas (lima update status sudah tercatat, modul 1-5).

---

## 3. Rujukan

- `docs/handoff/HANDOFF_PDT_SESI17.md` — detail teknis LENGKAP modul 3/4/5
  (pemetaan kolom, alasan tiap deviasi, blocker `shopee_ads_cpc` yang
  ditemukan ulang).
- `docs/handoff/HANDOFF_PDT_SESI14.md`/`SESI15.md` — modul 1/2.
- `docs/DECISIONS.md` — tiga baris Decided 2026-09-14 (modul 5, 4, 3, paling
  atas) + Open `G1-09-2BII-SHOPEELIVE`, `G1-09-2BII-SKU-STATUS-TRANSISI`,
  `G1-09-2BII-ADS-CPC` (diperbarui).
- `docs/backlog/PDT_BACKLOG.md` §G1-09 — status ringkas seluruh sub-langkah.
- PR #373 (merged, `e7305db`) — `https://github.com/MEAgrup/AgencyAPP/pull/373`.
