# CDPS — Module 17: AI Optimizer

**Status:** Approved by owner 2026-08-28 (lihat `docs/DECISIONS.md` baris 2026-08-28 M16)
**Worked example:** Alpha Digital, Brief `BRF-202608-0044` — optimasi 7 SKU Pareto
**Depends on:** Module 6 (Brief), Module 6A (Strategi / STRG), Module 12 (Task Execution), Module 16 (Lead Time), Admin (Master Service List)

---

## 1. Background

AI Optimizer adalah divisi eksekusi baru dengan dua jenis pekerjaan:

1. **Optimasi SKU** — memperbaiki SKU klien yang terdaftar di STRG (judul, deskripsi, atribut, foto) supaya kualitas listing naik.
2. **AI Video** — memproduksi video dengan bantuan AI, tanpa tahap shooting.

Divisi ini masuk lewat jalur yang sama dengan divisi eksekusi lain: AM menurunkan Plan row → Brief → divisi mengerjakan → AM review. Yang membedakan hanya isi pipeline-nya (M16 §4.5) dan, untuk Optimasi SKU, adanya **jalur balik ke STRG**.

---

## 2. Rules

1. **AI Optimizer adalah divisi eksekusi biasa** di `division_registry` (`dispatch_target=true`, `brief_assignable=true`, `vendor_managed=false`). Tidak ada jalur istimewa.
2. **Dua deliverable type, dua pipeline** (M16 §4.5) — dipilih dari `stage_pipeline.deliverable_type`.
3. **Optimasi SKU dikerjakan sebagai deliverable, bukan sebagai edit langsung ke STRG.** Brief membawa daftar SKU yang akan digarap; STRG adalah **sumber** daftarnya, bukan yang diedit selama pengerjaan.
4. **Hasil optimasi disinkronkan balik ke STRG sebagai REVISI BERNOMOR**, lewat jalur versioning STRG yang sudah ada (M6A Section E-3 + machine #15 `Draft Revisi`). **Tidak menembus aturan freeze/approval STRG** — tidak ada edit senyap ke dokumen `Aktif`.
5. **Tahap `Terapkan` adalah tahap yang menulis balik.** Sebelum itu, hasil perbaikan hidup di baris kerja Brief, bukan di STRG.
6. **`asset_type` baru:** `AI Video` dan `Optimasi SKU`. Keduanya wajib ditambahkan ke **tiga fungsi agregat SQL** yang saat ini meng-hardcode daftar `asset_type` — kalau tidak, produksi AI Optimizer tidak terhitung di Rekap Mingguan (lihat §5.2).
7. **Master Service List** mendapat dua item layanan baru: `AI Video` dan `Optimasi SKU`, agar keduanya bisa dijual dan punya `durasi_jasa`.
8. **Bobot M14 = 0** pada saat rilis. Lead time AI Optimizer terukur dan terlihat sejak hari pertama, tapi belum menggerakkan skor performa sampai COO menetapkan bobot (`DECISIONS.md` LT-1).

---

## 3. Pipeline

### 3.1 Optimasi SKU

`Cek Brief AM → Ambil SKU → Riset → Perbaikan → QC → Approve → Terapkan`

| Tahap | Isi |
|---|---|
| Cek Brief AM | Terima & proses, atau kembalikan ke AM dengan alasan |
| Ambil SKU | Tarik daftar SKU sasaran dari STRG (Section E-3 hero SKU / daftar Pareto) |
| Riset | Riset kata kunci, kompetitor, dan pola listing yang menang |
| Perbaikan | Tulis ulang judul/deskripsi/atribut |
| QC | Pemeriksaan internal divisi |
| Approve | Persetujuan AM (`gate_pihak='AM'`) |
| Terapkan | Terapkan di marketplace **dan** sinkronkan balik ke STRG sebagai revisi bernomor |

### 3.2 AI Video

`Cek Brief AM → Script → Generate AI → Edit → QC → Jadwal Posting`

Sama seperti Creative Content Production tetapi **tanpa Shooting** — `Generate AI` menggantikannya.

Target hari kerja per tahap menyusul bersama daftar resmi dari pemilik; sampai itu ada, tahap tanpa target menghasilkan `N/A` dan tidak pernah di-default diam-diam (M16 Rule 8).

---

## 4. Sinkronisasi balik ke STRG

Ini satu-satunya bagian yang menyentuh dokumen milik modul lain, jadi aturannya ketat:

1. Tahap `Terapkan` mengumpulkan SKU yang berubah beserta nilai sebelum→sesudah.
2. Perubahan masuk sebagai **revisi STRG bernomor** melalui mesin `STRG-` yang sudah ada (`Aktif` → `Draft Revisi` → `Diajukan` → `Aktif`), bukan `UPDATE` langsung.
3. Setiap perubahan menulis baris `audit_log` dengan aktor sungguhan — tidak ada penulisan atas nama `SYSTEM` untuk perubahan yang berasal dari keputusan manusia.
4. Kalau STRG sedang tidak `Aktif`, sinkronisasi **ditunda**, bukan dipaksa: Brief tetap boleh selesai, dan penerapan ke STRG menunggu dokumen kembali `Aktif`.

**Kenapa begini:** STRG punya aturan approval dan freeze sendiri (M6A machine #15). Menulis langsung ke dokumen `Aktif` dari modul lain akan membuat versi dokumen yang tidak pernah disetujui siapa pun — persis yang dicegah aturan rumah #3.

---

## 5. System Requirements

### 5.1 Registry

Baris `division_registry`: `code='AI_OPT'`, `nama='AI Optimizer'`, `dispatch_target=true`, `brief_assignable=true`, `vendor_managed=false`.

Plus baris `role_mappings` untuk jabatan HRIS divisi ini, agar karyawannya mendapat `division='AI Optimizer'` di klaim JWT.

### 5.2 `asset_type` — tiga fungsi agregat yang harus diperluas

Nilai `asset_type` saat ini (`Video`, `Gambar`, `Desain`, `SKU Setup`, `Copy`) di-hardcode sebagai `count(*) FILTER (WHERE asset_type = …)` di:

- `supabase/migrations/20260813040000_m6d_wrr_aggregate.sql`
- `supabase/migrations/20260814040000_t3_ad_metrics.sql`
- `supabase/migrations/20260814060000_t4b_cpl.sql`

Menambah `AI Video` dan `Optimasi SKU` **tanpa** memperluas ketiganya membuat produksi divisi ini tidak terhitung di Rekap Hasil Mingguan (M6D Section RM-B). Ini bukan opsional.

### 5.3 Rekap Mingguan

`wrr_divisi` mendapat baris untuk AI Optimizer, dengan `rincian` berisi jumlah SKU dioptimasi dan jumlah AI video selesai pada minggu ISO berjalan — mengikuti pola per-divisi M6D Rule 3.

### 5.4 Master Service List

Dua item baru (`AI Video`, `Optimasi SKU`) dengan `plan_tier` dan `durasi_jasa` ditetapkan Admin. `durasi_jasa` dipakai Ads Management Date hanya untuk layanan Ads; untuk dua item ini ia menentukan periode langganan biasa.

---

## 6. Success Metrics

- Brief AI Optimizer bergerak lewat pipeline-nya dan lead time tiap tahap muncul di panel AM, sama seperti divisi lain.
- SKU yang dioptimasi terlihat di STRG sebagai revisi bernomor dengan jejak sebelum→sesudah, bukan sebagai perubahan tanpa asal-usul.
- Produksi divisi ini terhitung di Rekap Hasil Mingguan sejak minggu pertama.
