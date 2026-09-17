# HANDOFF — PDT (Pusat Data Toko) SESI 35 → SESI 36

> **Dibuat 2026-09-17.** Sesi ini berjalan di bawah mode operasi otonom (`docs/DECISIONS.md`
> 2026-09-16 "Operating mode", ditokan Yohan Agustian/CEO): kerja tiket demi tiket dari
> `docs/backlog/PDT_BACKLOG.md` tanpa berhenti minta persetujuan per-tiket, auto-merge PR sendiri
> begitu CI hijau, migrasi live otomatis lewat `apply_migration`, batch keputusan pemilik ke
> checkpoint gelombang — KECUALI ambiguitas PRD genuine, yang tetap wajib berhenti+catat.
>
> ⚠️ **Catatan penomoran**: `docs/DECISIONS.md`/`PDT_BACKLOG.md` sudah menyebut "sesi 34"/"sesi 35"
> sebelum berkas ini ditulis (pekerjaan drift-fix + G4-02 di sesi ini sendiri dicatat "sesi 35"),
> tapi **`HANDOFF_PDT_SESI34.md`/`SESI35.md` tidak pernah ada** — rantai handoff melompat dari
> `SESI33.md` langsung ke berkas ini. Gap ini DICATAT, bukan diisi mundur (pekerjaan sesi
> sebelumnya sudah terekam lengkap di `DECISIONS.md`/commit history — menulis handoff palsu untuk
> sesi yang sudah lewat berisiko lebih besar daripada gap kosong). Rantai: `HANDOFF_PDT_SESI33.md`
> → (gap 34/35, lihat `DECISIONS.md` 2026-09-16/2026-09-17 untuk apa yang terjadi) → berkas ini.

---

## 0. Apa yang terjadi sesi ini (ringkasan padat)

1. **Verifikasi awal** — dikonfirmasi PR #432 (governance) dan #433 (halaman upload AM G1-09
   sub-langkah 3) SUDAH merged oleh sesi sebelumnya (tidak perlu dikerjakan ulang).
2. **Drift skema live ditemukan+ditutup** — proyek Supabase live `CDPS SG` (`egddxfcnrtecheiykhlf`)
   ternyata tertinggal **23 migrasi** dari repo (`20261018010000`…`20261109010000`), meski
   backlog/DECISIONS mencatatnya DITUTUP. Diterapkan satu-per-satu via `apply_migration`,
   diverifikasi gerbang CI cocok persis lokal. **PR #436, merged.** Detail lengkap:
   `docs/DECISIONS.md` 2026-09-17 "DRIFT SKEMA LIVE DITEMUKAN+DITUTUP (sesi 35)".
3. **G4-02 (Satuan bertipe) — DITUTUP.** `plan_row.satuan_kategori` +
   `strategi_resource.jumlah_satuan_kategori`, keduanya `pdt_satuan_t` (dipakai ulang dari G4-01,
   bukan enum baru). Satu mapper+formatter baru (`packages/core/src/satuan.ts`), dipanggil di
   SETIAP jalur tulis (`seedRowFromPillar`/`createPlanRow`/`seedRowsFromPillars`/
   `copyRowToPeriod`/`strategi.saveResources`). Migrasi `20261110010000` diterapkan ke live,
   diverifikasi (gerbang tidak bergerak: 182/45/35/76; backfill 0 null/0 pelanggaran CHECK).
   **PR #438, merged.** Detail: `docs/DECISIONS.md` 2026-09-17 "G4-02 DITUTUP (sesi 35)".
4. **G4-03 — BERHENTI, dicatat sebagai keputusan terbuka (bukan ditebak).** Sebelum menulis kode,
   ditemukan gap arsitektur nyata: PRD Flow C minta mesin usulan yang membaca `pdt_fact_*` +
   menulis `pdt_usulan` (evaluasi per-batch, loop verdict); mesin yang SUNGGUH jalan hari ini
   (`copilot.susunUsulan`/`strategi.susunPilarUsulan`) membaca `riset_awal_analisa.payload` dan
   HANYA mengisi Strategi Section E — **nol baris TS pernah menyentuh `pdt_usulan`** (diverifikasi
   grep, bukan asumsi). Dua opsi bercabang dicatat, TIDAK dipilih sepihak — lihat §2 di bawah.
5. **G3 (Prefill) dipecah jadi 10 tiket bernomor** (G3-01…G3-10), field-by-field digrounding ke
   `CREATE TABLE` sungguhan (`g1_01_pdt_tables.sql`, `g2_01_shopee_kesehatan_writer.sql`) — bukan
   ditebak. Satu gap ditemukan: Section B `chatResponseRatePersen`/`chatResponseMenit` belum
   punya tabel fakta (pola sama `pdt_fact_kesehatan_penalti` sebelum G2-01 menutupnya) — dicatat
   sebagai prasyarat G3-02, bukan diabaikan. **Backlog-grooming murni, nol kode/migrasi.**

Full test suite dijalankan bersih sebelum SETIAP push (per Definition of Done): `db-rebuild.sh`
(260 migrasi, gerbang tetap 182/45/35/76), `@cdps/core`/`@cdps/db`/`@cdps/api` semua hijau,
`@cdps/domain` 2807/2808 (1 skip — 2 gagal adalah flake audit-count di bawah beban paralel yang
SUDAH terdokumentasi, diverifikasi bersih pada re-run terisolasi, bukan regresi), `web-internal`
767/767, typecheck seluruh paket + `web-internal` bersih, lint `@cdps/api --max-warnings 0`
bersih, `next build` `web-internal` sukses, `route-parity`/`shape-parity` bersih.

---

## 1. PR yang lahir sesi ini

| PR | Judul | Status |
|---|---|---|
| [#436](https://github.com/MEAgrup/AgencyAPP/pull/436) | docs: record live schema drift (23 migrations) found and closed | **Merged** |
| [#438](https://github.com/MEAgrup/AgencyAPP/pull/438) | G4-02: typed satuan/target values (pdt_satuan_t on plan_row & strategi_resource) | **Merged** |

Keduanya di-merge sendiri (squash) setelah CI hijau penuh, sesuai wewenang mode operasi — nol
review manusia diminta, konsisten dengan otorisasi 2026-09-16.

---

## 2. Keputusan yang MENUNGGU pemilik (jangan ditebak sesi berikutnya)

### G4-03-VERDICT-ENGINE (`docs/DECISIONS.md` §Open — BARU sesi ini)
**Pertanyaan intinya:** loop verdict PDT (Rule 31 — `pdt_usulan.verdict`: `tidak_dikerjakan`/
`gagal`/`tercapai`, dievaluasi ulang tiap batch berikutnya) harus dibangun sebagai:

- **(A) Mesin baru** yang membaca `pdt_fact_*` langsung per `client_platform_id`+periode, dipicu
  saat batch `'verified'`, menulis `pdt_usulan` (`batch_id` FK) — pembacaan PRD paling literal,
  tapi PRD tidak merinci jendela agregasi/pemetaan field→aksi persis (butuh keputusan desain per
  aksi, bukan cuma pipa data), **ATAU**
- **(B) Snapshot** dari usulan Section E yang SAMA (baseline-driven, mesin yang sudah ada) setiap
  kali batch PDT diverifikasi, isi `realisasi_nilai` dari Riset Awal berikutnya — jauh lebih murah,
  tapi bertentangan literal dengan "fakta baru" Flow C langkah 4, dan Riset Awal historis TIDAK
  per-periode sehingga loop nyaris tidak pernah terisi (gagal menutup Rule 31 dengan cara yang
  sama seperti masalah yang ingin ditutup).

Bila (A): pemilik/tim juga perlu mengonfirmasi/mengoreksi calon **6 aksi khusus Shopee** (Rule 30)
yang dirancang dari field yang SUDAH terparse — cancel rate (`pesanan_dibatalkan`), chat/response
penalti (`pdt_fact_kesehatan_penalti`), efisiensi CPC/AMS (`pdt_fact_ads`), flash sale/diskon
(modul `diskon_flashsale_video`), live GMV/jam Shopee-benchmarked, affiliate/KOL Shopee — SEBELUM
ditulis jadi migrasi+kode. **Jangan mulai coding G4-03 sebelum ini diputuskan** — baris lengkap
ada di `docs/DECISIONS.md` §Open baris `G4-03-VERDICT-ENGINE` dan
`docs/backlog/PDT_BACKLOG.md` §4 (callout STOP di atas G4-03).

### G3 breakdown (backlog-grooming, bukan blocker keras — tapi perlu konfirmasi arah)
G3-01…G3-10 sudah ditulis sebagai USULAN struktur tiket (lihat `docs/backlog/PDT_BACKLOG.md` §3),
digrounding ke tabel fakta yang sungguh ada. Ini BELUM diimplementasikan sama sekali — pemilik
boleh mengoreksi urutan/cakupannya sebelum sesi berikutnya mulai coding G3-01, tapi tidak ada
ambiguitas PRD yang menahannya (Rule 33-37 preskriptif, bukan penilaian bisnis) — sesi berikutnya
BOLEH langsung mulai G3-01 tanpa menunggu jawaban, kecuali pemilik ingin urutan berbeda.

---

## 3. Posisi PDT sekarang (per gelombang)

- **G1** — selesai (lihat handoff sesi 27-33 untuk riwayat lengkap TikTok/Shopee sample).
- **G2** — G2-01/G2-02 DITUTUP (laporan sebagai view, benchmark per-platform, revoke mechanism
  Rule 24 masih terbuka — dicatat terpisah, di luar DoD "UI admin kalibrasi").
- **G3** — dipecah jadi G3-01…G3-10 sesi ini, **nol diimplementasikan**. Siap dikerjakan sesi
  berikutnya tanpa menunggu keputusan pemilik (lihat §2 di atas).
- **G4** — G4-01 DITUTUP (katalog kode→DB), **G4-02 DITUTUP** (sesi ini), **G4-03 BERHENTI**
  menunggu keputusan pemilik (§2 di atas) — jangan mulai coding.
- **G5** — tetap diblokir (P-02/P-03 belum terjawab), jangan dijadwalkan.

**Tidak ada tiket coding yang genuinely unblocked selain G3-01…G3-10.** Sesi berikutnya sebaiknya
mulai dari G3-01 (pembaca fakta bersama) sambil menunggu jawaban G4-03 di checkpoint berikutnya.

---

## 4. Verifikasi wajib di AWAL sesi berikutnya (pelajaran drift sesi ini)

Sebelum mengklaim status apa pun "sudah live":
```
mcp__Supabase__list_migrations({ project_id: "egddxfcnrtecheiykhlf" })
```
lalu bandingkan LANGSUNG ke `supabase/migrations/**` lokal — jangan percaya catatan sesi
sebelumnya (termasuk berkas ini) tanpa verifikasi. Sesi ini menemukan drift 23 migrasi persis
karena asumsi "sudah di-apply" tidak diverifikasi ulang.
