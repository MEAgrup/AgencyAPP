# Handoff — M6D (Rekap Hasil Mingguan) SESI 1

**Tanggal:** 2026-08-12 · **Branch:** `claude/cm-cro-weekly-results-3ptcb5`
**Sifat sesi ini: SPEC-ONLY. Nol kode, nol migrasi, nol perubahan skema.**
Semua yang mendarat adalah dokumen. Sesi berikutnya adalah sesi implementasi pertama.

---

## 1. Kenapa modul ini ada (permintaan pemilik, verbatim)

> *"Setelah team AM / CRO membagi brief ke divisi terkait, saya tidak menemukan bagian untuk CM / CRO mengupdate hasil. Seharusnya ada bagian untuk update hasil secara mingguan. Cek buildplan apakah sudah ada? Kalau belum ada buatkan bagian ini. Hal yang perlu di cek adalah progress yang dibuat dari setiap team. Creative berhasil membuat berapa video, live stream total live, kol berapa video creator. Dan dari semua produksi harus ada perhitungan hasil berupa total view, gmv, ctr, cvr, roas."*

Lanjutan pada sesi yang sama:

> *"Kita sudah memiliki bagian client health report: https://app.meagency.co.id/health — bagian ini sudah seharusnya merupakan summary dari semua report, progress, ada komplain atau tidak dan hasil. Pastikan nanti report yang dibuat terhubung kesini."* (+ *"interview kalau dibutuhkan"*)

**Catatan istilah penting:** di CDPS **AM = CRO = fungsi yang sama** (`DECISIONS.md` 2026-08-04, klarifikasi pemilik: keduanya memetakan ke `Account/staff`). Tidak ada entitas/peran "CRO" atau "CM" terpisah. Jangan membuat peran baru.

---

## 2. Hasil audit: apa yang SUDAH ada vs yang TIDAK ada

Ini bagian paling penting untuk sesi berikutnya — jangan bangun ulang yang sudah ada.

| Sudah ada | Cadence | Batas / kenapa tidak menjawab permintaan |
|---|---|---|
| Realisasi Plan **M6B §5 P-E** (GMV manual + metrik auto: ad spend, ROAS, jumlah video, kreator, jam live, brief selesai) | **BULANAN** per periode | Hanya untuk service **plan-gated** (Full-Mgmt M6A/M6B atau Plan Satuan M6C) |
| **Metric Entry M8** (`MTR-`): Spend, GMV from Ads, ROAS, CTR/CVR | **MINGGUAN** (M8-OA-2 dikonfirmasi) | **Ads saja**, diisi staff Ads — bukan rekap lintas divisi milik AM |
| Daily Output **M7** (Asset `[Approved]`, headline # video) | Harian → rollup mingguan/bulanan | Creative saja |
| Laporan bulanan **M9** (# creator `[QC Passed]`) | Bulanan | KOL saja |
| Session **M10** (`LSS-`: # live, viewers, GMV from Live) | Per session (paket mingguan) | Live saja, entry manual AM dari laporan vendor |
| Entitas `RPT-` "Report weekly/monthly → Account" | — | **Dicadangkan Phase 0 tapi TAK PERNAH dibangun**; OA-11 mengalihkan pelaporan *client-facing* ke `mea-client-reporting` eksternal, dan langkah *internal* "divisi lapor mingguan ke Account" (Phase 0 Diagram alur langkah 6) dibiarkan tanpa spec |

**TIDAK ADA** rekap **mingguan, lintas-divisi, tingkat-klien** milik AM/CRO. Dan gap paling tajam: **klien Direct-path / `Tanpa Plan` tidak punya catatan hasil periodik sama sekali** — dieksekusi di luar pengetahuan sistem sampai ada komplain.

**Metrik yang belum dimodelkan di mana pun:** CTR lintas-divisi (hanya Ads punya, "where platform provides"), **view video organik** (tak ada sumber ter-track), **CPL**, **impressions**, **CPC/CPM**, **Upcoming Milestones**. Jangan mengarang pipeline auto untuk ini (keputusan R3).

### Temuan atas halaman `/health` yang hidup

Dibaca dari kode, bukan diasumsikan:

- `web-internal/src/app/(shell)/health/page.tsx` — landing **hanya** tombol "Jalankan Pemindaian" + link ke `/clients`. Bukan portfolio.
- `web-internal/src/app/(shell)/health/[clientId]/page.tsx` — merender **aritmetika skor**: skor+band, breakdown 7 komponen (raw/capped/base/effective weight), trend snapshot, toggle ROAS. Setia M13 §5.
- **Belum** ada progress, hasil produksi, komplain, atau status laporan di halaman itu — padahal **Phase 0 v2 Diagram 3** sudah menyebut dashboard ini memuat Alerts (issue count), per-platform Project Status, dan Performance Metrics.
- Domain: `packages/domain/src/health.ts` (885 baris) — `runScan`, `getSnapshot`, `trend`, `preview`, `getRoasToggle`/`setRoasToggle`, gate `canView`/`canScope`/`canRunScan`/`canToggleRoas`. **Tidak ada** endpoint list/portfolio (butuh dibuat untuk D-12).
- Komplain sudah tersedia: `packages/domain/src/account.ts:2247` `listClientComplaints`.
- Interview verdict: `packages/domain/src/interview.ts:331` `getInterviewVerdict` (+ `canReadVerdict` baris 100, scope **lebih sempit**: Account + sales closing + Sales lead), dan `listInterviewsByClient` (per klien).

---

## 3. Keputusan yang SUDAH diambil (jangan dibuka ulang tanpa alasan baru)

Tiga fork arsitektur **ditanyakan ke pemilik dan dijawab** (bukan dipilih diam-diam):

| # | Keputusan | Isi |
|---|---|---|
| **R1** | Relasi ke Plan bulanan | **Lapisan mingguan BARU yang feed ke M6B P-E** — bukan mengubah M6B jadi mingguan, bukan entitas berdiri sendiri yang menduplikasi actual. Plan tetap lapisan akuntabilitas bulanan |
| **R2** | Cakupan | **Semua klien aktif, lintas divisi, dengan ATAU tanpa Plan** — menutup gap Direct/`Tanpa Plan` |
| **R3** | Metrik belum dimodelkan | **Pakai yang sudah dimiliki + entry manual bersumber untuk sisanya, atau `—`.** Nol pipeline auto baru |

Keputusan integrasi health (sesi yang sama):

| # | Keputusan | Isi |
|---|---|---|
| **H** | `/health` = permukaan RINGKASAN | Halaman health dapat 4 blok read-only (H-1 hasil & progress mingguan · H-2 status laporan · H-3 komplain · H-4 verdict Interview) + landing jadi tabel portfolio. **LAPISAN TAMPILAN saja** |
| **H-skor** | Skor M13 **TIDAK disentuh** | 7 komponen + bobot terkonfirmasi + redistribusi + band + snapshot immutable semuanya tetap. Nol perubahan scoring `health.ts` |

### Dua guardrail yang wajib dijaga saat implementasi

1. **Single-source GMV.** Rekap hanya punya **`GMV Eksekusi (interim)`** (Σ GMV Ads + GMV Live + affiliate, **read-only**). GMV bulanan otoritatif tetap entry manual AM di **M6B Rule 11** (jendela 5 hari, lock saat `Ditutup`). Rekap **tak pernah** menulis PE-1. Di halaman health nanti **dua angka GMV muncul bersamaan** — `GMV Growth` (klien, M4, resmi) vs `GMV Eksekusi (interim)` (M6D, mingguan) — **wajib berlabel beda dan tak pernah dijumlahkan**. Idem ROAS: ROAS channel Ads vs ROAS Attainment ber-cap & ber-toggle.
2. **Disiplin rekap DITAMPILKAN, tidak DINILAI.** H-2 memperlihatkan freshness/AM-closed/sengketa, tapi tidak menjadi komponen skor ke-8 (itu memaksa re-weight bobot terkonfirmasi + menilai form-filling AM di dalam angka kesehatan *klien*). Kalau pemilik mau dinilai → **M14 Team Performance** peran AM. Terbuka sebagai **RM-9**.

---

## 4. Yang mendarat di sesi ini (dokumen)

| Berkas | Isi |
|---|---|
| `docs/prd/CDPS_Module6D_Rekap_Hasil_Mingguan.md` | **PRD baru.** §1 background · §2 locked decisions R1–R5 · §3 guardrail single-source GMV · §4 Rules 1–11 · §5 form RM-A…RM-F · §6 flow · §7 contoh Alpha Digital · **§8 integrasi Health (H-1…H-4 + 8 rules + kenapa bukan komponen skor)** · §9 System Requirements (entitas, mesin #18, job, katalog v3, permission, matriks kepemilikan metrik) · §10 Open Assumptions RM-1…RM-11 · §11 Success Metrics |
| `docs/prd/CDPS_Module13_Client_Health_Report.md` | **Amandemen §8 baru** — health view sebagai permukaan ringkasan; menegaskan skor tak berubah + 5 invariant + apa yang sengaja tidak dilakukan |
| `docs/prd/CDPS_Build_Plan.md` | Entri manifest (baris 6D) + scope **akhir Wave 2** + catatan keterhubungan ke M13 |
| `docs/STATE_MACHINES.md` | **§15 — mesin #18** `WRR-`: `Terjadwal` → `Terbuka` → `Ditutup` \| `Ditutup Otomatis` |
| `docs/DATA_MODEL.md` | Entitas `WRR-` + anak + relasi + catatan dibaca halaman health |
| `docs/backlog/M6D_BACKLOG.md` | **Tiket D-01…D-13** + dependensi + DoD + open questions |
| `docs/DECISIONS.md` | **2 entri** 2026-08-12: (a) modul M6D + 3 fork; (b) integrasi health view-only |

---

## 5. Mulai dari mana di sesi berikutnya

**BLOCKER dulu — jangan mulai D-01 sebelum ini dicek.** Urutan build: M6D dijadwalkan **akhir Wave 2, sesudah M7/M8/M9/M10 mengekspos metrik auto** (dependensi yang sama dengan M6B P-E — lihat M6B PA-3: *"Any metric not yet available must fall back to manual"*). Kalau sumber divisi belum hijau, seluruh RM-B/RM-C jatuh jadi entry manual dan modulnya melanggar R3.

Cek kesiapan sumber:

```
# 1. Apakah M7/M8/M9/M10 sudah mengekspos hitungan per-window?
grep -rn "Approved" packages/domain/src/creative.ts | head
grep -rn "QC Passed\|qc_passed" packages/domain/src/kol.ts | head
grep -rn "Reconciled\|reconciled" packages/domain/src/livestream.ts | head
grep -rn "MTR-\|metric" packages/domain/src/ads.ts | head

# 2. Baca posisi cutover/wave sebenarnya (handoff bernomor TERTINGGI dulu)
ls docs/handoff/HANDOFF_CUTOVER_SESI*.md | sort -V | tail -3
```

Lalu urutan tiket (detail lengkap di `docs/backlog/M6D_BACKLOG.md`):

1. **D-01** skema + prefix `WRR` (di **dua** tempat: `entity_prefix` + `packages/core/src/ident.ts::PREFIXES` — ada test yang gagal kalau cuma satu)
2. **D-02** mesin #18 (`sm_edges` + `sm_terminal_states`; gerbang SIAPA di domain, bukan di mesin)
3. **D-03** agregasi auto + **UPDATE-block di DB + RLS** (bentuk sama `plan_actual` M6B — invariant beku, TS predikat & RLS tak boleh divergen)
4. **D-04** entry manual + `—` · **D-05** narasi + `Sengketa Angka` · **D-06** job (pg_cron **wajib dibungkus guard** `IF EXISTS pg_available_extensions` — absen di Postgres polos CI) · **D-07** katalog v3 · **D-08** rollup ke Plan
5. **D-09** domain+API+wire · **D-10** UI rekap
6. **D-11…D-13** integrasi `/health` (blok H-1…H-4, portfolio landing, degradasi per-blok)

### Ranjau yang sudah diketahui di repo ini

- **Migrasi HANYA** lewat `supabase/migrations/**` + `apply_migration` / `supabase db push`. **Jangan pernah** `psql -f` (itu yang melahirkan drift O38). DB lokal dibangun ulang **hanya** lewat `scripts/db-rebuild.sh`.
- **Wire snake_case**: route yang mengirim objek domain mentah = bug kelas **O43** (halaman blank walau 200). Penerjemah **satu-satunya** `apps/api/src/lib/wire.ts` (`*ToWire`). Kunci HILANG lebih bahaya daripada null — kirim `null` eksplisit, jangan `omitempty`. Daftarkan converter baru ke shape-parity (guard-nya memang menangkap yang belum terdaftar).
- **`KNOWN_GAPS` di `apps/api/src/lib/route-parity.test.ts` harus tetap KOSONG.** Menambah satu baris = mengakui satu halaman mati ⇒ butuh entri `DECISIONS.md`.
- **Kelas O52:** read/join yang gagal jangan mem-blank seluruh halaman. Load tiap blok health **terpisah** (preseden "Riwayat Interview" 2026-08-12).
- **O48:** melebarkan SELECT/RLS per tabel butuh entri ledger tersendiri. D-12 (portfolio) jangan melebarkan RLS tanpa itu.
- **`backend/**` adalah referensi read-only** (oracle paritas Go). Jangan bangun apa pun di sana — Go + MySQL sudah dipensiunkan.
- Status **hanya** lewat `sm_transition`. Derived field **selalu** recomputable dari log, jangan disimpan sebagai kolom mutable.
- Bagi-nol (ROAS/CTR/CVR) render `—`, **jangan** error (aturan rumah #7). IDR `Rp. X.XXX.XXX,00`.

---

## 6. Pertanyaan terbuka untuk pemilik (jawab sebelum/saat implementasi)

| ID | Pertanyaan | Kenapa penting |
|---|---|---|
| **RM-9** | Disiplin rekap perlu **dinilai** atau cukup ditampilkan (H-2)? | Kalau dinilai: rekomendasi taruh di **M14** peran AM, BUKAN komponen ke-8 M13 (butuh re-weight + mengubah arti historis `CHR-` yang immutable) |
| **RM-5** | Jendela force-close / peringatan `belum dikonfirmasi` = N hari? | M6B pakai 5 hari untuk bulanan; mingguan kemungkinan 1–2 hari |
| **RM-3** | Perlu **ROAS blend** seluruh klien (organik+live+paid)? | Butuh definisi denominator dulu — spend mana yang dihitung. Sekarang hanya ROAS channel Ads yang ditampilkan |
| **RM-8** | Catatan divisi (RM-D6) opsional atau **wajib** (divisi *harus* lapor mingguan)? | Kalau wajib: jadi field mandatory + reminder sendiri (versi literal langkah Phase 0) |
| **RM-10** | Blok **H-4 (verdict Interview)** memang diinginkan di halaman health? | Menghapusnya nol biaya bagi modul lain |
| **RM-1 / RM-2** | Minggu ISO Sen–Min WIB sudah benar? Definisi "klien aktif" = ≥1 Service non-terminal — perlu kecualikan klien payment-hold/paused? | Menentukan berapa banyak rekap terbentuk tiap Senin |
| **RM-4 / RM-11 / RM-7** | CPL, impressions, CPC/CPM, view video organik, Upcoming Milestones — perlu dimodelkan? | Semua belum ada sumbernya. Kalau perlu, **tambah di modul pemiliknya dulu** (M8/M7), jangan dikarang di M6D |
| **RM-6** | Sign-off katalog notifikasi (kini v3 = 31 event) | Terbawa dari M6B PA-8, masih terbuka |

---

## 7. Definition of Done (tambahan khusus M6D)

Selain DoD standar CLAUDE.md (validasi server-side + pesan BI `[...]`, tes izin per role incl. layered OD/Director, tes immutability, derived recomputable-from-log, fixture Alpha Digital, event notif terdaftar):

- **Tes single-source GMV:** buktikan rekap **tak pernah** menulis M6B PE-1.
- **Tes cakupan non-Plan:** klien `Tanpa Plan` tetap mendapat rekap (`plan_id` NULL), tidak diblokir.
- **Tes UPDATE-block:** aktor JWT (AM) tak bisa mengubah baris `otomatis` — di DB **dan** lewat RLS (dua-duanya, invariant beku).
- **Tes skor M13 tak berubah:** setelah D-11…D-13, snapshot/skor/bobot identik dengan sebelum integrasi (regression guard atas guardrail utama).
