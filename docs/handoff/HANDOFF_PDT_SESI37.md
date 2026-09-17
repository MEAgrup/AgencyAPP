# HANDOFF — PDT (Pusat Data Toko) SESI 36 → SESI 37

> **Dibuat 2026-09-17.** Sesi ini berjalan di bawah mode operasi otonom (`docs/DECISIONS.md`
> 2026-09-16 "Operating mode", ditokan Yohan Agustian/CEO): kerja tiket demi tiket dari
> `docs/backlog/PDT_BACKLOG.md` tanpa berhenti minta persetujuan per-tiket, auto-merge PR sendiri
> begitu CI hijau, migrasi live otomatis lewat `apply_migration`, batch keputusan pemilik ke
> checkpoint gelombang — KECUALI ambiguitas PRD genuine, yang tetap wajib berhenti+catat.

---

## 0. Apa yang terjadi sesi ini (ringkasan padat)

1. **PR #443 (G3-07, ditulis sesi 36) di-drive ke hijau dan di-merge** sesi ini — CI penuh
   (`core-engines`/`web-internal`/`web-client-portal`/`api`/`db-and-migrations`) hijau, tidak ada
   perubahan diminta.
2. **G3-08 (jalur koreksi, Rule 36) — DITUTUP, dengan temuan.** Diverifikasi: setiap pembaca
   G3-01/G3-07 (`bacaFaktaShopDaily`/`bacaFaktaSkuPeriode`/`bacaFaktaContent`/
   `bacaFaktaCreatorPeriode`/`bacaFaktaAds`/`bacaFaktaKesehatanPenalti`/
   `bacaPeriodeTerverifikasiTerbaru`) menyaring `status='verified'` eksplisit — klaim tiket
   terpenuhi. **Temuan sampingan bukan blocker**: `status='digantikan'` sendiri **tidak pernah
   bisa terjadi** di kode hari ini — `PdtCommitStatus` (`pdt.ts:538`) cuma punya EMPAT dari LIMA
   nilai CHECK, dan tidak ada baris kode yang pernah menulis `'digantikan'` atau mengisi
   `menggantikan_batch_id`. Separuh kedua Rule 36 ("submit kedua bikin batch baru yang
   menggantikan") belum diimplementasikan — jalur koreksi yang ADA cuma reparse-in-place (G1-11).
   Dicatat sebagai kandidat tiket G1 lanjutan ("G1-12 · Jalur supersede batch verified"), di luar
   cakupan G3 — **tidak dikerjakan sesi ini** (scope creep tanpa tiket sendiri).
3. **G3-09 (`tanggal_tarik_data` jam server, Rule 37) — DITUTUP, bersih.** Kolomnya
   `pdt_upload_batch.dibuat_pada` (`20261011010000:139`) — `timestamptz NOT NULL DEFAULT now()`,
   enforced di DB. Diaudit: `commitUploadBatch`'s INSERT dan `reparsePdtBatch`'s UPDATE
   sama-sama tidak pernah menyentuh kolom ini (selalu jatuh ke DEFAULT server Postgres). Nol
   jalur client-supplied timestamp ditemukan. Nol perubahan kode.
4. **PR #444 (G3-08/G3-09, docs-only) dibuat, di-drive ke hijau, di-merge.**
5. **Ditemukan: PDT backlog genap tidak punya tiket coding yang unblocked** setelah G3-08/G3-09
   tutup — lihat §2 di bawah untuk rincian tiap gelombang.

Nol migrasi ditulis sesi ini (G3-07/G3-08/G3-09 seluruhnya baca-saja/dokumentasi). Live
`CDPS SG` (`egddxfcnrtecheiykhlf`) diverifikasi **cocok persis** dengan
`supabase/migrations/**` lokal (migrasi terbaru kedua sisi: `20261110010000_rls_head_sales_baca
_angka_negosiasi`) — nol drift, sesuai pelajaran §4 handoff sesi 36.

---

## 1. PR yang lahir/di-drive sesi ini

| PR | Judul | Status |
|---|---|---|
| [#443](https://github.com/MEAgrup/AgencyAPP/pull/443) | G3-07: GMV history (baselineBulan) sourced from pdt_fact_shop_daily | **Merged** (ditulis sesi 36, di-drive ke hijau + merge sesi ini) |
| [#444](https://github.com/MEAgrup/AgencyAPP/pull/444) | G3-08/G3-09: verify supersede-batch read path + server-clock provenance | **Merged** (docs-only, nol kode) |

Keduanya di-merge sendiri (squash) setelah CI hijau penuh, sesuai wewenang mode operasi — nol
review manusia diminta.

---

## 2. Posisi PDT sekarang (per gelombang) — **nol tiket coding unblocked**

- **G1** — selesai.
- **G2** — G2-01/G2-02 DITUTUP (revoke mechanism Rule 24 masih terbuka, di luar DoD, dicatat
  terpisah).
- **G3** — **G3-01, G3-07, G3-08, G3-09 DITUTUP.** G3-02…G3-06 **STOP**, menunggu
  `docs/DECISIONS.md` §Open `G3-REFERENCE-PERIODE` (belum dijawab pemilik — pertanyaannya:
  begitu Section B jadi multi-periode PDT, periode PDT MANA yang jadi `periodeReferensi` untuk
  field snapshot-satu-periode). G3-10 **transitively blocked** (backlognya sendiri mensyaratkan
  G3-02…G3-09 tutup dulu).
- **G4** — G4-01 DITUTUP sebagian (sisa "≥6 aksi Shopee"+"UI admin CRUD" dilipat ke G4-03).
  G4-02 DITUTUP. **G4-03 STOP**, menunggu `docs/DECISIONS.md` §Open `G4-03-VERDICT-ENGINE`
  (belum dijawab pemilik sejak sesi 35/36 — mesin baru baca `pdt_fact_*` vs snapshot Section E).
- **G5** — tetap **diblokir** (P-02/P-03, taksonomi `level2_category`/`price_segment` hidup di
  MCN bukan CDPS) — jangan dijadwalkan.
- **§7 (bukan tiket coding)** — semuanya menunggu manusia (Hans/Anty/Nerissa): P-07 (kapasitas
  partisi), sample tambahan ≥2 klien/platform, SOP AM, matikan tulis tool lama, cek tarif GB
  Supabase.

**Tidak ada satu pun tiket coding yang genuinely unblocked di seluruh `PDT_BACKLOG.md` saat ini.**
Dua keputusan pemilik (`G3-REFERENCE-PERIODE`, `G4-03-VERDICT-ENGINE`) adalah satu-satunya yang
membuka jalur berikutnya — keduanya sudah tercatat lengkap (dua opsi bercabang per baris) di
`docs/DECISIONS.md` §Open sejak sesi 36 dan sebelumnya, menunggu ketokan.

---

## 3. Keputusan yang MENUNGGU pemilik (jangan ditebak sesi berikutnya)

Tidak ada baris BARU ditambahkan sesi ini — dua yang sudah ada (`G3-REFERENCE-PERIODE` dari sesi
36, `G4-03-VERDICT-ENGINE` dari sesi 35) **masih terbuka**, dan sekarang keduanya-lah yang
memblokir SELURUH sisa pekerjaan coding di backlog ini. Lihat `docs/DECISIONS.md` §Open untuk
teks lengkap tiap opsi.

---

## 4. Saran sesi berikutnya

Tanpa jawaban pemilik untuk salah satu dari dua baris di atas, sesi berikutnya **tidak punya
tiket PDT untuk dikerjakan**. Opsi yang wajar (bukan keputusan sepihak, sekadar saran urutan):
- Cek apakah ada gelombang/modul CDPS LAIN (di luar PDT) yang punya tiket unblocked — backlog
  lain di `docs/backlog/` mungkin punya pekerjaan yang tidak bergantung pada dua keputusan ini.
- Bila kedua baris `DECISIONS.md` sudah dijawab sebelum sesi berikutnya mulai: verifikasi
  ketokannya, MULAI dari opsi yang dipilih (bukan menebak ulang), dan jangan lupa jalankan
  ulang `mcp__Supabase__list_migrations` di awal untuk cross-check drift (pelajaran sesi 35/36).
