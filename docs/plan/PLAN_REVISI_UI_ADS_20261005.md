# PLAN — Revisi UI Ads (M8) dari tim Advertiser

**Sumber:** Google Doc "Revisi CDPS" (tim Advertiser, dibaca 2026-10-05) — halaman `https://app.meagency.co.id/ads`.
**Pemilik permintaan:** Yohan Agustian (Director) — "baca, buat plan perbaikan dan perbaiki".
**Branch:** `claude/dazzling-keller-6k2kxa`
**Entri keputusan:** `docs/DECISIONS.md` 2026-10-05 `ADS-REVISI-UI` (deviasi M8 §4 Rule 1–3 / §9.3).

## 1. Butir revisi (verbatim ringkas) → perbaikan

| # | Keluhan tim Advertiser | Akar masalah di kode | Perbaikan |
|---|---|---|---|
| R1 | "Hitungan Budget di kolom ini untuk budget **harian** dan sistem otomatis menghitung berapa ads spent semenjak dinyalakan sampai dimatikan." | `ad_campaigns.budget` diberi label "Budget (Rp)" (anggaran total rencana); tidak ada turunan apa pun dari budget × hari tayang. | Label jadi **Budget Harian (Rp)**. Field turunan read-only baru **`hari_iklan_aktif`** (hari tayang dikurangi hari jeda, dari log transisi immutable) dan **`estimasi_budget_terpakai`** = Budget Harian × Hari Iklan Aktif — dihitung ulang tiap baca (house rule #4), tidak disimpan. |
| R2 | "Tanggal Selesai tidak diisi dari awal tapi bisa di-toggle oleh advertiser." | `end_date` NOT NULL di DB + wajib di `createCampaign`. | Migrasi `end_date` → NULLABLE. Form: toggle **"Tentukan tanggal selesai"** (default mati). Query overlap (SH-06 / PDT E-03) memperlakukan `end_date` NULL sebagai "terbuka". |
| R3 | "Target KPI sudah diisi di dalam brief jadi tidak perlu diisi kembali oleh advertiser." | Form meminta Target KPI teks bebas. KPI sebenarnya ada di Strategy (`strategy_plans.target_gmv/roas/ctr/cvr`, jalur STR-) atau baris Plan (`plan_row.hasil_diharapkan`, jalur M6B). | Server **mewarisi** Target KPI dari brief (Strategy → Plan row). Endpoint baru `GET /briefs/{id}/ads-target-kpi` untuk menampilkannya read-only di form. Input manual hanya muncul kalau brief tidak membawa KPI (fallback, tetap wajib). |
| R4 | "ID campaign yang telah dibuat tidak bisa dilihat kembali. Seharusnya ada list semua campaign yang sudah dibuat, lengkap dengan nama klien." + "dibutuhkan list semua campaign yang sudah dibuat per orang dengan detail nama klien, toko klien, tanggal buat campaign, fitur matikan / jeda campaign." | M8 tidak punya endpoint list; halaman hanya punya kotak "ketik ID ADC-". RLS `ad_campaigns_select` tidak punya arm Lead Ads. | Endpoint baru **`GET /campaigns`** (`?advertiser=`, `?q=`). Kartu **"Kampanye Saya"** (staff: buatan sendiri; Lead Ads/Director/OD: semua + filter advertiser) dengan kolom Kampanye, Klien, Toko, Platform/Tipe, Budget Harian, Estimasi Terpakai, Dibuat, Status, Aksi **Jeda / Lanjutkan / Matikan**. Migrasi: arm Lead Ads di `ad_campaigns_select` (cermin `canViewCampaign`). |
| R5 | "Shopee Ads tidak membutuhkan ID Creative, TikTok Ads juga tidak semua membutuhkan → buat opsional." | `validateBriefSubmit` mewajibkan ≥1 aset tertaut; `activate` (Mulai Iklan) mewajibkan ≥1 aset tertaut dan semuanya [Approved]. | Aset kreatif **opsional** untuk semua platform: submit brief cukup ≥1 kampanye; Mulai Iklan hanya mensyaratkan aset yang TERTAUT (kalau ada) sudah [Approved]. UI: label "(opsional)", alert merah dihapus. |
| R6 | "Antrean Brief Ads dibuat per klien yang dihandle oleh tim ads masing-masing agar tidak tercampur." | Antrean menampilkan seluruh brief divisi Ads dalam satu tabel datar. | Antrean **dikelompokkan per klien**, dengan filter **Klien saya** (default untuk staff) / **Semua klien**. "Klien saya" = klien yang salah satu brief Ads-nya ber-PIC saya, atau yang kampanyenya saya buat. Filter ini kenyamanan UI — RLS `briefs_select` tetap division-wide (B-1/B-4) karena staff harus bisa membuka brief yang belum ber-PIC. |
| R7 | "Penambahan fitur Search nama klien." | Tidak ada pencarian di `/ads`. | Kotak **Cari klien** (nama toko / ID klien / judul) menyaring antrean brief; `?q=` (nama klien / nama toko) menyaring daftar kampanye di server. |

## 2. Yang TIDAK berubah

- Mesin status `ad_campaign` (STATE_MACHINES §14) — nol edge baru; Jeda/Lanjutkan/Matikan memakai endpoint lifecycle yang sudah ada.
- `ad_campaigns.budget` tetap satu kolom; hanya semantiknya yang ditegaskan "harian". Penyesuaian budget lewat Optimization Log (>50% butuh sign-off) tetap berlaku pada angka harian.
- Total Spend / ROAS dari Metric Entry tetap angka **aktual**; Estimasi Budget Terpakai adalah angka **rencana** (budget × hari) — keduanya ditampilkan berdampingan, tidak saling menggantikan.
- Pesan BI verbatim (`MSG_CAMPAIGN_INCOMPLETE_FOR_SUBMIT`, dll.) tidak diganti.

## 3. Batasan yang disadari

- Estimasi memakai Budget Harian **saat ini**; perubahan budget di tengah jalan (Optimization "Budget") tidak dihitung bertahap. Follow-up bila tim Ads butuh estimasi per-segmen budget.
- Hari jeda dihitung per hari kalender dari log transisi `[Active]→[Paused]` … `[Paused]→[Active]` (jeda yang masih berlangsung dihitung sampai hari ini / tanggal selesai iklan). Dibaca lewat `private.ad_campaign_transisi` (SECURITY DEFINER) supaya AM/staff yang tidak menjeda sendiri tetap mendapat angka yang sama.

## 4. Urutan kerja

1. Migrasi `20261217010000_ads_revisi_ui.sql`: `end_date` nullable, arm Lead Ads `ad_campaigns_select`, fungsi `private.ad_campaign_transisi`.
2. Domain `packages/domain/src/ads.ts`: create (end opsional, KPI warisan), gate aset opsional, `hariIklanAktif`/`estimasiBudgetTerpakai`, `listCampaigns`, `targetKpiBrief`.
3. API: `GET /campaigns`, `GET /briefs/{id}/ads-target-kpi`, wire.
4. UI `/ads` + `/ads/[id]`.
5. Test domain + FE, `DECISIONS.md`.
6. **Sesudah merge:** terapkan migrasi ke live `CDPS SG` lewat `apply_migration` SEBELUM/bersamaan deploy (kode create tanpa `end_date` gagal NOT NULL kalau migrasi belum diterapkan).
