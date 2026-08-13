# Backlog — M6D (Rekap Hasil Mingguan / Weekly Result Update)

> Dibuat 2026-08-12 dari permintaan pemilik (tak ada bagian AM/CRO update hasil mingguan).
> PRD: `docs/prd/CDPS_Module6D_Rekap_Hasil_Mingguan.md`.
> Keputusan & 3 fork arsitektur: `docs/DECISIONS.md` 2026-08-12.
> Mesin #18: `docs/STATE_MACHINES.md` §15. Entitas `WRR-`: `docs/DATA_MODEL.md`.
>
> **Status: SPEC-ONLY. Belum ada migrasi/kode.** Diurut **akhir Wave 2**, sesudah
> M7/M8/M9/M10 mengekspos metrik auto (dependensi sama seperti M6B P-E, lihat
> M6B PA-3). Jangan mulai sebelum sumber metrik divisi hijau — kalau tidak,
> RM-B/RM-C tak punya sumber dan seluruh modul jadi entry manual (melanggar R3).

## 0. Dependensi (blocker sebelum D-01)

- **M7 Creative** — count Asset `[Approved]` per minggu per jenis (headline # video).
- **M8 Ads** — Metric Entry mingguan (`MTR-`): Spend, GMV from Ads, ROAS, CTR/CVR; `OPT-` count.
- **M9 KOL** — count Booking `[QC Passed]` per minggu (# creator); affiliate Attributed GMV.
- **M10 Live Stream** — count Session `[Completed]`/`[Reconciled]` per minggu (# live); viewers; GMV from Live.
- **M6B Plan** — periode `Aktif` untuk ditaut (nullable; klien `Tanpa Plan` = null).

## 1. Tiket

| # | Tiket | Isi | Catatan konvensi |
|---|---|---|---|
| **D-01** | Skema + prefix | Tabel `weekly_result_recap` (`WRR-`) + anak `WRR_DIVISI`, `WRR_METRIK`, `WRR_CATATAN`, `WRR_CATATAN_DIVISI`. Index parsial `(client_id, iso_year, iso_week)`. FK `plan_id` nullable. Register `WRR` di `entity_prefix` **dan** `packages/core/src/ident.ts::PREFIXES` (dua tempat, M6A §7). | Migrasi lewat `supabase/migrations/**` + `apply_migration`; **jangan** `psql -f` (O38). ID `WRR-YYYYMM-NNNN` via `ident_next` (preseden STRG/PLAN/VND — bukan format PRD berbeda). |
| **D-02** | Mesin #18 | Edge `Terjadwal→Terbuka` (sistem), `Terbuka→Ditutup` (AM pemilik), `Terbuka→Ditutup Otomatis` (sistem), **`Ditutup Otomatis→Terbuka` (Head of Account, buka-kembali RM-5, alasan wajib)**. Terminal: **hanya `Ditutup`** (`Ditutup Otomatis` quasi-terminal — satu edge keluar utk Head). Semua via `sm_transition`. `sm_edges` + `sm_terminal_states`. | Gerbang SIAPA di domain (`recap.ts`), bukan di mesin — pola `plan.ts`. Kolom `pernah_ditutup_otomatis` di-set true saat force-close, **tak pernah** dicabut (trigger jaga, seperti jangkar riset-awal) — buka-kembali menyelamatkan data, bukan nilai AM. |
| **D-03** ✅ **DONE** (`20260813030000`+`20260813040000`) | Agregasi auto (read-only) | `wrr_aggregate(recap_id)` mengisi `WRR_DIVISI` (# video/# creator/# live/# campaign + Brief bergerak) & `WRR_METRIK` `otomatis` (`gmv_interim`, `ad_spend`, `roas_ads`, `total_view`=Σ viewers M10) dari M7/M8/M9/M10 by client + window minggu ISO WIB, dibaca dari `audit_log` (tak ada timestamp per-status). **`ctr`/`cvr` TIDAK auto** (M8 simpan persen saja, tak bisa dikonsolidasi tanpa clicks/impressions) → manual/`—` (D-04). Idempoten; tak timpa `sengketa`/manual. | Baris `otomatis` **UPDATE-blocked** utk aktor JWT (AM): trigger `guard_wrr_{metrik,divisi}_no_manual_auto` **+** RLS `WITH CHECK` (`private.jwt_can_write_recap`) **+** TS `canWriteRecap` — tiga tempat tak divergen (`recap.reals.test.ts`, kelas sama `plan_actual`). CHECK manual `file_bukti`/`tanggal_ambil` tetap D-04. Lihat `DECISIONS.md` 2026-08-13. |
| **D-04** ✅ **DONE** (`20260813050000`) | Entry manual + `—` + teks | Fallback RM-C (view organik, CTR/CVR non-Ads): `sumber ∈ otomatis/manual/tidak_tersedia`; DB check `ck_wrr_metrik_manual_bukti` (`file_bukti`+`tanggal_ambil` NOT NULL saat `manual`, cermin `ck_plan_actual_manual_bukti`). RLS INSERT `wrr_metrik` dilebarkan `sumber<>'otomatis'` (jalur `—`/`tidak_tersedia` bisa ditulis AM; invariant auto-block utuh — `otomatis` tetap ditolak braces+belt). Bagi-nol ROAS/CTR/CVR → `—` (house #7). **+ field teks-only RM-C9 "Catatan Metrik Tambahan"** (`wrr_catatan.catatan_metrik_tambahan`, RM-4/RM-7/RM-11): CPL/impressions/CPC/CPM/view-organik sbg prosa pencatatan — BUKAN metrik, tak masuk delta/rollup/skor, sistem tak pernah parse angka darinya. Penegakan close 'isi atau —' = D-05; jalur tulis `wrr_catatan` = D-09. Tes `recap.manual.test.ts` (6). Lihat `DECISIONS.md` 2026-08-13. | Nol pipeline auto baru untuk CTR/view/CPL (R3). CPL/impressions/CPC/CPM tetap tak dimodelkan (RM-4/11) — RM-C9 hanya catatan, bukan jalan belakang buat mengetik metrik palsu. |
| **D-05** ✅ **DONE** (`20260813060000`) | Narasi + `Sengketa Angka` | RM-D (RM-D1/RM-D3 wajib saat tutup + RM-D2 bila ada blocker): trigger `guard_wrr_narasi_saat_tutup` memblok edge AM `Terbuka→Ditutup`; force-close/buka-kembali tak kena (Rule 8). `WRR_CATATAN_DIVISI` append-only (`forbid_mutation` no UPDATE/DELETE, pola `audit_log`). `Sengketa Angka` tak memblok tutup & tak mengubah angka auto — sudah dipegang invariant D-03; **emisi notif SPV = D-07** (butuh event katalog). **Kelengkapan metrik saat tutup ('isi atau —') = domain close D-09** (gerbang DB tak tahu apakah agregasi D-06 sudah jalan). Tes `recap.close.test.ts` (8). Lihat `DECISIONS.md` 2026-08-13. | GMV single-source: rekap **tak pernah** menulis M6B PE-1 (guardrail §3). |
| **D-06** | Job terjadwal | (a) Senin 00:00 WIB — buka rekap per klien aktif (**kecuali hold/paused**, RM-2) + force-close minggu lalu yang masih `Terbuka`; (b) tutup + **N=2 hari kerja** (RM-5) — `rekap_mingguan_belum_dikonfirmasi`; (c) saat tutup — divisi yang berutang catatan wajib (RM-8) belum isi → `catatan_divisi_belum_diisi`. Idempoten, WIB, pakai `working_days_between`. | Terima "sekarang" sbg argumen (idempotensi teruji tanpa jam dinding, pola `interview_*_tick`). pg_cron dibungkus guard `IF EXISTS pg_available_extensions` (absen di Postgres polos CI). |
| **D-07** | Notif **v7** | ⚠️ Premis SESI1 basi ("v2=28→v3=31"). Katalog live sudah **v6=44** (registry O55). M6D daftar **versi baru v7 = +4 event → 48**: `rekap_mingguan_terbuka`, `rekap_mingguan_belum_dikonfirmasi`, `rekap_sengketa_angka`, **`catatan_divisi_belum_diisi`** (RM-8). Satu migrasi + satu baris `notif_catalog_versions` (eventCount: 4). | Re-baseline lewat baris versi, **bukan** literal. **Sign-off katalog M6B PA-8 kini LULUS (RM-6 ditandatangani 2026-08-13, `DECISIONS.md`)** — D-07 tak lagi terblokir; v7=48 disetujui. Daftar penuh v1→v6 di HANDOFF_M6D_SESI2 §Katalog. |
| **D-08** | Rollup ke Plan | Rekap `Ditutup` memasok PE-3/PE-8 periode `Aktif` tertaut (M6B). Klien `Tanpa Plan` → rekap berdiri sendiri. | Rollup, bukan pengganti (R1). |
| **D-09** | Domain + API + wire | `recap.ts` (read own-clients / SPV all; write RM-A6/RM-C manual/RM-D/`Sengketa`/tutup). Route baca + tutup + `sengketa`. Wire `*ToWire` (null eksplisit, bukan omitempty — hindari O43); daftar ke shape-parity. | `route-parity` `KNOWN_GAPS` tetap kosong. |
| **D-10** | UI internal | Halaman rekap mingguan per klien (desktop-first tutup; mobile read-only minggu berjalan). **Bukan** permukaan klien (Rule 9 — nol paparan Client Portal allow-list). | Picker karyawan/format mengikuti pola yang sudah ada bila perlu. |
| **D-11** | **Integrasi Health — blok ringkasan** (M6D §8, M13 §8) | Tambah 4 blok read-only ke `web-internal/src/app/(shell)/health/[clientId]`: **H-1** hasil & progress mingguan (# video/# live/# creator/# campaign + view/GMV interim/CTR/CVR/ROAS/spend + delta + headline narasi), **H-2** status laporan (freshness, AM-closed vs `Ditutup Otomatis` 4 minggu, `Sengketa Angka` terbuka), **H-3** komplain aktif (`listClientComplaints`, sudah ada di `account.ts:2247`), **H-4** verdict Interview (opsional, advisory). | **Skor TIDAK disentuh** — nol perubahan `packages/domain/src/health.ts` scoring (7 komponen + bobot tetap). Dua GMV di satu halaman **wajib berlabel beda**: `GMV Growth` (klien, M4) vs `GMV Eksekusi (interim)` (M6D) — jangan dijumlahkan. Idem ROAS (Ads vs ROAS Attainment ber-toggle). |
| **D-12** | **Integrasi Health — portfolio landing** | `web-internal/src/app/(shell)/health/page.tsx` sekarang hanya tombol scan + link ke `/clients`. Jadikan tabel portfolio: satu baris per klien aktif — band, flag band-drop (M13 Rule 12), jumlah komplain terbuka, **freshness rekap** (minggu terakhir `Ditutup`). | Butuh endpoint list (belum ada — `health.ts` hanya punya per-klien + scan). Gate baca = `canScope`/`canView` yang sudah ada; jangan melebarkan RLS demi tabel ini tanpa entri O48. |
| **D-13** | Degradasi per-blok | Tiap blok H-1…H-4 menghormati scope sumbernya dan **absen (bukan error)** bila aktor tak berhak — khususnya H-4 (`canReadVerdict` lebih sempit: Account + sales closing + Sales lead). | Kelas O52: join/read yang gagal jangan mem-blank seluruh halaman. Pola yang sudah dipakai: load terpisah per blok (preseden "Riwayat Interview" 2026-08-12). |

## 2. Definition of Done (tiap tiket)

Sama seperti CLAUDE.md: validasi server-side + pesan BI `[...]`; tes izin per-role (incl. layered OD/Director); tes immutability (rekap `Ditutup` tak punya jalur UPDATE/DELETE, koreksi = amendment audit-logged); derived/auto recomputable-from-log; seed fixture Alpha Digital lolos; event notif terdaftar. **Tambahan M6D:** tes single-source GMV (rekap tak pernah menulis PE-1); tes cakupan klien `Tanpa Plan` (rekap tetap terbentuk tanpa `plan_id`).

## 3. Open questions — **dijawab pemilik 2026-08-13** (detail: PRD §10 + `DECISIONS.md` 2026-08-13)

**✅ Terputus (decided):**
- **RM-1** — minggu ISO Sen–Min WIB **benar**, tak berubah.
- **RM-2** — klien aktif = **≥1 service non-terminal, kecuali yang semua service-nya hold/paused** ⇒ filter di job D-06/D-03.
- **RM-3** — **tidak ada ROAS blend. ROAS = kanal Ads saja** (RM-C2 tetap `GMV Ads ÷ Spend`). Tertutup permanen.
- **RM-4** — CPL/impressions **tidak dimodelkan**, tapi ada field **teks-only RM-C9** untuk pencatatan (owner 2026-08-13). Bukan metrik.
- **RM-5** — force-close **N = 2 hari kerja** + **Head boleh buka-kembali** rekap `Ditutup Otomatis`; `pernah_ditutup_otomatis` permanen (nilai AM tetap tercatat). PRD §10.1-A.
- **RM-8** — catatan divisi **WAJIB** (divisi berutang laporan mingguan) ⇒ RM-D6 wajib + reminder `catatan_divisi_belum_diisi`; **tak memblok tutup rekap AM** (kewajiban di divisi).
- **RM-9** — disiplin **ditampilkan (H-2) DAN dinilai**. Nilai lands di **M14** (peran AM utk tutup rekap tepat waktu, hitung `pernah_ditutup_otomatis`; peran divisi utk catatan wajib) — **BUKAN** komponen ke-8 M13. Butuh amandemen M14 (re-weight profil AM 50/25/25). Lihat **D-14** + PRD §10 RM-9a.
- **RM-10** — H-4 verdict Interview **tetap** di halaman health (advisory).
- **RM-6** — ✅ **ditandatangani 2026-08-13** (pemilik: *"Iya ini benar."*): katalog notifikasi **v7 = 48** (44 event live v1–v6 + 4 event M6D). **Gerbang M6B PA-8 kini LULUS** — D-07 tak lagi terblokir. Registrasi lewat baris `notif_catalog_versions` (`eventCount: 4`), bukan literal (O55).
- **RM-9a** — ✅ **ditandatangani 2026-08-13** (pemilik: *"jalankan Rekomendasi… 45/22.5/22.5/10… + slice kepatuhan-catatan di profil tiap divisi"*): profil AM **45/22.5/22.5/10** (carve 10% proporsional utk Disiplin Rekap); profil divisi Creative/Ads/KOL di-carve **5% proporsional** utk Kepatuhan Catatan (28.5/23.75/23.75/19/**5** dst). D-14 tak lagi terblokir. Detail di M14 PRD §9.
- **RM-7 / RM-11** — ✅ **diputuskan 2026-08-13** (pemilik: *"tidak perlu bangun dulu, buat saja kolom dengan text only, saat ini belum dibutuhkan"*): view organik / CPC / CPM / impressions / Upcoming Milestones **tidak dimodelkan** sekarang — kolom metrik `—`, dicatat di field teks **RM-C9** (kelas sama RM-4). Auto hanya kalau kelak sumbernya dibangun di M7/M8. Penjelasan "dimodelkan" di PRD §10.1-B.

**⏳ Masih perlu pemilik:** — *tidak ada. Seluruh RM-1…RM-11 sudah decided/ditandatangani per 2026-08-13.*

## 4. Tiket baru dari resolusi 2026-08-13

| # | Tiket | Isi | Catatan |
|---|---|---|---|
| **D-14** | **M14 — komponen disiplin rekap (RM-9)** | Amandemen M14: tambah komponen KPI **Disiplin Rekap Mingguan** ke profil peran **AM** (% klien aktif AM yang rekap minggu berjalan-nya ditutup AM tepat waktu, bukan `Ditutup Otomatis`) + komponen **catatan mingguan** ke profil peran **divisi**. Re-weight profil AM terkonfirmasi (50/25/25 → **45/22.5/22.5/10**, carve 10% proporsional) + profil divisi Creative/Ads/KOL carve **5% proporsional** utk Kepatuhan Catatan. **Bukan** komponen ke-8 M13. | **✅ Bobot ditandatangani pemilik 2026-08-13** (`DECISIONS.md` / M14 §9): AM 45/22.5/22.5/10; divisi +5% (Creative 28.5/23.75/23.75/19/5, Ads 23.75/28.5/23.75/19/5, KOL 28.5/23.75/19/23.75/5). D-14 tak lagi terblokir. M6D hanya menyuplai sinyal mentah (status tutup rekap + `pernah_ditutup_otomatis` + ada/tidak catatan divisi); M14 yang menghitung. Diurut **bareng/ sesudah** implementasi M6D. |
