# HANDOFF — PDT (Pusat Data Toko) SESI 16 → SESI 17

> **Dibuat 2026-09-14.** Baca berkas ini sebelum lanjut (rantai: … → sesi 15 →
> berkas ini; `docs/handoff/HANDOFF_PDT_SESI15.md` untuk detail teknis
> `tt_video`/`shopee_ads_live` kalau perlu — TIDAK diulang di sini).
> Instruksi sesi ini (pemilik, Nerissa): **"buat pr merge, kemudian buat
> handoff untuk lanjut build di chat berikutnya."**
>
> **Status: PR #368 SUDAH DI-MERGE ke `main`.** Sub-langkah 2a (commit
> batch), 2b-i (rekonsiliasi Shopee), dan 2b-ii DUA modul pertama
> (`shopee_ads_live` → `pdt_fact_ads`, `tt_video` → `pdt_fact_content`)
> SEMUANYA sudah di `main`. **Sesi berikutnya mulai kerja dari `main`
> langsung** (`git fetch origin main && git checkout -b <branch-baru>
> origin/main`) — TIDAK ADA lagi branch PR yang perlu ditumpuk/dilanjutkan.

---

## 0. Apa yang terjadi sesi ini (murni merge, NOL kode baru)

Sesi ini TIDAK menambah modul/fitur baru — kerjanya administratif menutup
rantai PR yang menumpuk sejak sesi 12:

1. **Konteks awal**: kerja sesi 14 (`shopee_ads_live`) + sesi 15
   (`tt_video`) ada di branch sesi `claude/bold-ride-83f352` (fast-forward
   dari tip PR #368), BELUM jadi bagian PR #368 (PR itu masih menunjuk
   commit lama, sebelum sesi 14/15).
2. **Push commit sesi 14+15 ke branch PR #368** (`claude/handoff-sesi10-
   build-gei0gn`) — fast-forward murni (diverifikasi `git merge-base
   --is-ancestor` sebelum push), NOL rebase/force-push. PR #368 otomatis
   ikut memuat sub-langkah 2b-ii (dua modul).
3. **CI check `db-and-migrations` merah** di HEAD PR — **diinvestigasi,
   dikonfirmasi PRA-ADA**: check yang SAMA merah identik di `main` HEAD
   SEBELUM PR ini disentuh (`103747109587`, `2026-09-13T15:35:31Z`,
   dicek lewat GitHub API `/commits/main/check-runs`), pola sama seperti
   bug `client_platforms` unique-active-platform collision yang sudah
   dikonfirmasi berulang di `gelombang-c-showcase.e2e.test.ts` sesi 2-15
   (kali ini muncul di job `packages/db` yang terpisah — kemungkinan akar
   masalah sama, fixture/seed antar test file saling bentrok). Dicatat
   sebagai komentar di PR #368 (bukan diabaikan diam-diam), TIDAK menahan
   merge. Job lain (`api`, `core-engines`, `web-internal`,
   `web-client-portal`) hijau konsisten di seluruh run.
4. **Judul + body PR #368 diperbarui** merangkum SELURUH cakupan (2a+2b-i+
   2b-ii dua modul), bukan cuma 2a+2b-i seperti draf asli.
5. **PR #368 di-MERGE** (merge commit, bukan squash — `2ef5da5528ed4c7e
   8feb4dfa347b2f9e7843b04c`) ke `main` atas instruksi eksplisit pemilik.
   **Catatan penting**: ini SATU-SATUNYA kali sesi PDT langsung merge tanpa
   review manusia terpisah di GitHub — sesi-sesi sebelumnya (12-15)
   konsisten mencatat "Claude TIDAK meng-approve/merge PR ini sendiri, itu
   keputusan manusia" sebagai prinsip operasi; sesi ini instruksi merge
   datang LANGSUNG dari pemilik (Nerissa) di chat, jadi dieksekusi. **Kalau
   pola ini mau jadi default ke depan (auto-merge tanpa review terpisah),
   itu keputusan pemilik untuk ditegaskan — bukan diasumsikan otomatis
   berlaku untuk PR PDT berikutnya.**
6. **Branch sesi (`claude/bold-ride-83f352`, branch yang ditugaskan untuk
   sesi ini) di-restart dari `main` pasca-merge** (fast-forward, nol
   riwayat baru selain merge commit yang sudah ada di `main`) dan
   di-push — status bersih, siap dipakai lagi kalau sesi berikutnya
   kebetulan melanjutkan di branch yang sama.

**NOL perubahan kode/skema sesi ini** — semua isi PR #368 (dan karenanya
sekarang `main`) sudah didokumentasikan lengkap di
`docs/handoff/HANDOFF_PDT_SESI14.md`/`HANDOFF_PDT_SESI15.md` +
`docs/DECISIONS.md` (baris-baris 2026-09-14, sub-langkah 2b-ii modul 1 & 2).

---

## 1. Yang perlu ditindaklanjuti sesi berikutnya

**Sama seperti rekomendasi sesi 15 (belum berubah — nol kerja modul baru
sesi ini):**

1. **Rekomendasi utama — lanjutkan G1-09 sub-langkah 2b-ii ke modul
   KETIGA.** Kandidat (verifikasi ulang dulu sebelum membangun, jangan
   warisi tanpa cek — pola yang sudah terbukti perlu setiap sesi sejauh
   ini):
   - **`pdt_sku_master`** — PRASYARAT untuk `shopee_ads_cpc`,
     `pdt_fact_sku_period`, dan `sku_id` di modul manapun. Target PALING
     BERHARGA (membuka banyak modul sekaligus) TAPI PALING RUMIT (upsert
     lintas platform, `Kode Produk` Shopee vs `ID Produk`/`ID produk`
     TikTok, Rule 19 `status_listing`/`last_seen_at`).
   - **`shopee_video`/`shopee_live` → `pdt_fact_content`** — BELUM
     diinvestigasi sama sekali (beda dari `tt_live`, yang sudah dicek
     sesi 15 dan ditemukan BLOCKED). Kandidat paling segar untuk dicek.
   - **`tt_live` → `pdt_fact_content`** — BLOCKED, `G1-09-2BII-TTLIVE`
     (Open, `docs/DECISIONS.md`). Nol kolom identitas sesi live di
     `kolomDipanen`. JANGAN dibangun sebelum sample asli diverifikasi.
   - **`shopee_ads_cpc`/`shopee_ads_search`** — BLOCKED,
     `G1-09-2BII-ADS-CPC`/`G1-09-2BII-ADS-SEARCH`. Jangan dikerjakan
     sebelum `pdt_sku_master` (cpc) atau jawaban Q-6/sample asli (search).
2. Item lama masih terbuka, tidak tersentuh sejak sesi 13-15: `G1-07-
   PERSKU-PESANAN`, `G1-07-TIKTOK-REKONSILIASI`, `G1-09-DETEKSI-PREAMBLE-
   AMBIGU`, `G1-08-SEBAGIAN`, `G1-06-PERIODE-TIKTOK`, `G1-07-PERSKU-
   DIBAYAR`.
3. G1-09 sub-langkah 3 (halaman upload `web-internal`) dan endpoint
   konfirmasi identitas AM (`usulkan_ikat` → menulis
   `client_platforms.shop_id`/`akun_konten_toko`) — masih belum ada.
4. **Bug jsonb double-encoding** (ditemukan+diperbaiki sesi 15, HANYA di
   test fixture) — kalau/ketika endpoint konfirmasi AM (butir 3 di atas)
   menulis `client_platforms.akun_konten_toko` sungguhan, WAJIB pakai
   `sql.json(value)`, BUKAN `${JSON.stringify(value)}::jsonb` — pola salah
   ini sudah dua kali ditemukan (sub-langkah 2a `identitas_sumber`, sesi
   15 test fixture), gampang terulang kalau tidak diwaspadai.
5. **CI `db-and-migrations` — pra-ada, BELUM diperbaiki.** Merah di `main`
   sejak sebelum sesi ini (dan sebelumnya juga, kemungkinan sama
   root-cause dengan `gelombang-c-showcase.e2e.test.ts`). Bukan blocker PDT
   (tidak menyentuh kode PDT sama sekali), tapi layak diperbaiki kapan-
   kapan sebagai kebersihan CI umum — di luar cakupan PDT murni, catat
   sebagai kandidat kalau ada sesi non-PDT yang mau mengambilnya.

## 2. Konteks penting untuk sesi berikutnya

- **Mulai dari `main` langsung** — tidak ada lagi branch PR PDT yang
  menggantung. Kalau sesi berikutnya dapat branch sesi baru, buat branch
  itu dari `origin/main` seperti biasa; kalau kebetulan dapat
  `claude/bold-ride-83f352` lagi, branch itu SUDAH di-restart dari `main`
  pasca-merge (bersih, nol commit tambahan di atas `main`).
- **Sebelas commit** kini di `main` untuk seluruh rantai G1-09 sub-langkah
  1 s.d. 2b-ii (pratinjau → BODY-BESAR → commit 2a → rekonsiliasi 2b-i →
  fakta 2b-ii dua modul → merge commit). Rincian teknis lengkap: PR #368
  (sekarang tertutup/merged, `https://github.com/MEAgrup/AgencyAPP/pull/368`)
  + `docs/handoff/HANDOFF_PDT_SESI12.md`…`SESI15.md`.
- **Progress ringkas G1-09** (lihat `docs/backlog/PDT_BACKLOG.md` untuk
  detail): 5 dari ~6 sub-langkah; sub-langkah 2b-ii sendiri baru 2 dari 25
  modul/2 dari 6 tabel fakta. Sub-langkah 3 (UI) dan endpoint konfirmasi AM
  belum tersentuh sama sekali.

---

## 3. Rujukan

- `docs/handoff/HANDOFF_PDT_SESI14.md` — modul pertama (`shopee_ads_live`
  → `pdt_fact_ads`), detail teknis lengkap.
- `docs/handoff/HANDOFF_PDT_SESI15.md` — modul kedua (`tt_video` →
  `pdt_fact_content`), bug jsonb, kandidat modul ketiga (§1).
- `docs/DECISIONS.md` — baris-baris 2026-09-14 (sub-langkah 2b-ii modul 1
  & 2) + Open items (`G1-09-2BII-ADS-CPC`, `G1-09-2BII-ADS-SEARCH`,
  `G1-09-2BII-TTLIVE`, dan yang lebih lama).
- `docs/backlog/PDT_BACKLOG.md` §G1-09 — status ringkas seluruh
  sub-langkah.
- PR #368 (merged) — `https://github.com/MEAgrup/AgencyAPP/pull/368`.
