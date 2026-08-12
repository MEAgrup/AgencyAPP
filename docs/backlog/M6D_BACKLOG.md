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
| **D-02** | Mesin #18 | Edge `Terjadwal→Terbuka` (sistem), `Terbuka→Ditutup` (AM pemilik), `Terbuka→Ditutup Otomatis` (sistem). Terminal: `Ditutup`, `Ditutup Otomatis`. Semua via `sm_transition`. `sm_edges` + `sm_terminal_states`. | Gerbang SIAPA di domain (`recap.ts`), bukan di mesin — pola `plan.ts`. |
| **D-03** | Agregasi auto (read-only) | Job/fungsi yang mengisi `WRR_DIVISI` (# video/# creator/# live + Brief bergerak) & `WRR_METRIK` `otomatis` (GMV interim, ROAS Ads, Spend, CTR/CVR bila ada, view) dari M7/M8/M9/M10 by client + window minggu. | Baris `otomatis` **UPDATE-blocked** utk aktor JWT (AM) di DB (trigger) **+** RLS `WITH CHECK` — TS predikat & RLS tak boleh divergen (invariant beku, bentuk sama `plan_actual`). |
| **D-04** | Entry manual + `—` | Fallback RM-C (view organik, CTR/CVR non-Ads): `sumber ∈ otomatis/manual/tidak_tersedia`; DB check `file_bukti`+`tanggal_ambil` NOT NULL saat `manual`. Bagi-nol ROAS/CTR/CVR → `—` (house #7). | Nol pipeline auto baru untuk CTR/view/CPL (R3). CPL/impressions tetap tak dimodelkan (RM-4). |
| **D-05** | Narasi + `Sengketa Angka` | RM-D (RM-D1/RM-D3 wajib saat tutup); `Sengketa Angka` → notif SPV, tak memblok tutup, tak mengubah angka auto (pola M6B PE-6). `WRR_CATATAN_DIVISI` append-only. | GMV single-source: rekap **tak pernah** menulis M6B PE-1 (guardrail §3). |
| **D-06** | Job terjadwal | (a) Senin 00:00 WIB — buka rekap per klien aktif + force-close minggu lalu yang masih `Terbuka`; (b) tutup+N hari — `rekap_mingguan_belum_dikonfirmasi`. Idempoten, WIB. | Terima "sekarang" sbg argumen (idempotensi teruji tanpa jam dinding, pola `interview_*_tick`). pg_cron dibungkus guard `IF EXISTS pg_available_extensions` (absen di Postgres polos CI). |
| **D-07** | Notif v3 | +3 event → total 31 (`rekap_mingguan_terbuka`, `rekap_mingguan_belum_dikonfirmasi`, `rekap_sengketa_angka`). Satu migrasi. | Re-baseline invariant katalog; sign-off M6B PA-8 masih terbuka (RM-6). |
| **D-08** | Rollup ke Plan | Rekap `Ditutup` memasok PE-3/PE-8 periode `Aktif` tertaut (M6B). Klien `Tanpa Plan` → rekap berdiri sendiri. | Rollup, bukan pengganti (R1). |
| **D-09** | Domain + API + wire | `recap.ts` (read own-clients / SPV all; write RM-A6/RM-C manual/RM-D/`Sengketa`/tutup). Route baca + tutup + `sengketa`. Wire `*ToWire` (null eksplisit, bukan omitempty — hindari O43); daftar ke shape-parity. | `route-parity` `KNOWN_GAPS` tetap kosong. |
| **D-10** | UI internal | Halaman rekap mingguan per klien (desktop-first tutup; mobile read-only minggu berjalan). **Bukan** permukaan klien (Rule 9 — nol paparan Client Portal allow-list). | Picker karyawan/format mengikuti pola yang sudah ada bila perlu. |
| **D-11** | **Integrasi Health — blok ringkasan** (M6D §8, M13 §8) | Tambah 4 blok read-only ke `web-internal/src/app/(shell)/health/[clientId]`: **H-1** hasil & progress mingguan (# video/# live/# creator/# campaign + view/GMV interim/CTR/CVR/ROAS/spend + delta + headline narasi), **H-2** status laporan (freshness, AM-closed vs `Ditutup Otomatis` 4 minggu, `Sengketa Angka` terbuka), **H-3** komplain aktif (`listClientComplaints`, sudah ada di `account.ts:2247`), **H-4** verdict Interview (opsional, advisory). | **Skor TIDAK disentuh** — nol perubahan `packages/domain/src/health.ts` scoring (7 komponen + bobot tetap). Dua GMV di satu halaman **wajib berlabel beda**: `GMV Growth` (klien, M4) vs `GMV Eksekusi (interim)` (M6D) — jangan dijumlahkan. Idem ROAS (Ads vs ROAS Attainment ber-toggle). |
| **D-12** | **Integrasi Health — portfolio landing** | `web-internal/src/app/(shell)/health/page.tsx` sekarang hanya tombol scan + link ke `/clients`. Jadikan tabel portfolio: satu baris per klien aktif — band, flag band-drop (M13 Rule 12), jumlah komplain terbuka, **freshness rekap** (minggu terakhir `Ditutup`). | Butuh endpoint list (belum ada — `health.ts` hanya punya per-klien + scan). Gate baca = `canScope`/`canView` yang sudah ada; jangan melebarkan RLS demi tabel ini tanpa entri O48. |
| **D-13** | Degradasi per-blok | Tiap blok H-1…H-4 menghormati scope sumbernya dan **absen (bukan error)** bila aktor tak berhak — khususnya H-4 (`canReadVerdict` lebih sempit: Account + sales closing + Sales lead). | Kelas O52: join/read yang gagal jangan mem-blank seluruh halaman. Pola yang sudah dipakai: load terpisah per blok (preseden "Riwayat Interview" 2026-08-12). |

## 2. Definition of Done (tiap tiket)

Sama seperti CLAUDE.md: validasi server-side + pesan BI `[...]`; tes izin per-role (incl. layered OD/Director); tes immutability (rekap `Ditutup` tak punya jalur UPDATE/DELETE, koreksi = amendment audit-logged); derived/auto recomputable-from-log; seed fixture Alpha Digital lolos; event notif terdaftar. **Tambahan M6D:** tes single-source GMV (rekap tak pernah menulis PE-1); tes cakupan klien `Tanpa Plan` (rekap tetap terbentuk tanpa `plan_id`).

## 3. Open questions (dari PRD §10 — perlu jawaban pemilik sebelum/ saat implementasi)

- **RM-3** — apakah perlu ROAS blend seluruh klien? Kalau ya, definisikan denominator (spend mana yang dihitung) dulu.
- **RM-5** — jendela force-close/`belum dikonfirmasi` N hari (M6B pakai 5 hari utk bulanan; mingguan kemungkinan 1–2 hari).
- **RM-8** — apakah catatan divisi (RM-D6) wajib (divisi *harus* lapor mingguan) atau tetap opsional?
- **RM-9** — apakah disiplin rekap perlu **dinilai** (bukan cuma ditampilkan di H-2)? Rekomendasi: kalau ya, taruh di **M14 Team Performance** peran AM, BUKAN komponen ke-8 M13 (butuh re-weight + menilai form-filling AM di dalam angka kesehatan klien).
- **RM-10** — apakah blok H-4 (verdict Interview) memang diinginkan di halaman health? Menghapusnya nol biaya bagi modul lain.
- **RM-11** — CPC/CPM + Upcoming Milestones (Phase 0 Diagram 3) belum dimodelkan di mana pun ⇒ di luar cakupan H-1 sampai sumbernya ada.
