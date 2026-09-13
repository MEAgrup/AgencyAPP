# HANDOFF — PDT (Pusat Data Toko) SESI 3 → SESI 4

> **Dibuat 2026-09-13.** Baca berkas ini sebelum lanjut. Cabang kerja sesi ini:
> `claude/sleepy-mccarthy-v1zhvr` (**belum di-PR/merge** — pemilik belum meminta PR).
>
> **Status: G1-01 SELESAI (migrasi tabel + RLS + gerbang CI + tes + domain predikat).
> Diterapkan ke live `CDPS SG` (`egddxfcnrtecheiykhlf`).** Sesi 4 lanjut ke **G1-02**
> (seed `pdt_parser_modul` dari `PDT_KOLOM_DIPANEN.md`) — lihat §3.

---

## 0. Ringkasan 60 detik

Sesi 2 menutup G1-00 sebagian (CHECK `client_platforms.platform` `NOT VALID`; pembersihan
klien testing & assign AM masih **ditunda** pemilik — lihat `HANDOFF_PDT_SESI2.md` §2).
Sesi 3 (sesi ini) mengerjakan **G1-01**: 14 tabel `pdt_*` + enum `pdt_satuan_t` + RLS +
gerbang CI, mengikuti tepat spesifikasi `docs/backlog/PDT_BACKLOG.md` G1-01 dan
`docs/prd/CDPS_PDT_Pusat_Data_Toko.md` §6.1-6.6. **Nol seed** ditulis (sengaja — itu
tiket G1-02/G2-02/G4-01, bukan G1-01).

Migrasi `20261011010000_g1_01_pdt_tables.sql` sudah **diterapkan ke live** lewat
`apply_migration` (konsisten dengan pola sesi 1-2: setiap migrasi di repo = migrasi
yang sudah hidup di live). `db-rebuild.sh --yes` hijau (175/44/35/74 + 4 invariant SQL),
seluruh suite domain/core/db/apps-api hijau kecuali satu kegagalan **pra-ada** (§5).

---

## 1. Apa yang SELESAI di sesi ini (belum di-PR)

| Berkas | Isi |
|---|---|
| `supabase/migrations/20261011010000_g1_01_pdt_tables.sql` | 14 tabel + enum `pdt_satuan_t` + 3 helper RLS SECURITY DEFINER baru (`jwt_owns_pdt_batch_am`, `jwt_owns_client_platform_am`, `jwt_owns_pdt_sku_am`) + 2 ALTER `client_platforms` |
| `.github/workflows/ci.yml`, `scripts/db-rebuild.sh` | gerbang tabel `161→175`; prefix/mesin/event **tidak bergerak** |
| `packages/domain/src/pdt.ts` + `pdt.test.ts` | `canUploadBatch`/`canKelolaBenchmark`/`canKirimLaporan` — predikat murni, 11 tes |
| `supabase/tests/rls_checks.sql` | §46 baru (RLS per-role pdt_upload_batch/pdt_fact_shop_daily/pdt_parser_modul) + `pdt_benchmark`/`pdt_usulan_katalog` masuk §9 (locked table) + ledger §42/§44 diperbarui |
| `supabase/tests/immutability_checks.sql` | `pdt_benchmark`/`pdt_kolom_alias`/`pdt_laporan_kiriman` frozen-trigger assertions + tes behavioral unique-partial `pdt_upload_batch` |
| `docs/DATA_MODEL.md` | 14 baris entity registry baru |
| `docs/DECISIONS.md` | 1 baris baru (2026-09-13, atas): dua koreksi tipe PRD §6.1, keputusan status-turunan, ledger O48/§44 |

**Tabel yang lahir:** `pdt_parser_modul`, `pdt_kolom_alias`, `pdt_upload_batch`, `pdt_file`,
`pdt_fact_shop_daily`, `pdt_sku_master`, `pdt_fact_sku_period`, `pdt_fact_content`,
`pdt_fact_creator_period`, `pdt_fact_ads`, `pdt_benchmark`, `pdt_usulan_katalog`,
`pdt_usulan`, `pdt_laporan_kiriman`.

**Belum di-commit-push-kan sebagai PR** — commit sudah di-push ke
`claude/sleepy-mccarthy-v1zhvr`, tapi pemilik belum diminta approve PR (instruksi sesi ini
hanya "lanjutkan build", bukan "buka PR"). Kalau sesi 4 ingin PR, tinggal buka dari branch
yang sudah ter-push ini.

### 1.1 Dua koreksi terhadap PRD §6.1 (dicatat `DECISIONS.md`)
- `pdt_upload_batch.client_id` — PRD bilang `bigint`, tapi `clients.id` aktual
  `varchar(32)`. Dikoreksi ke `varchar(32)`.
- `pdt_upload_batch.dibuat_oleh` — PRD bilang `uuid FK team_members` (tabel yang tidak
  ada). Dikoreksi ke `varchar(64) REFERENCES employees(employee_id)`.

### 1.2 Status paket (Rule 11/50) SENGAJA tidak jadi kolom
`tersedia`/`kedaluwarsa`/`legal_hold`/`perlu_upload_ulang`/`tidak_dapat_dipulihkan` **tidak**
disimpan — semuanya diturunkan saat baca dari `legal_hold`+`raw_dihapus_pada`+
`retensi_sampai`+`periode_selesai`+`platform` (aturan rumah #4). **Siapa pun yang membangun
G1-10 (purge)/G1-11 (reparse)/G1-09 (UI status paket) harus menulis fungsi TURUNAN ini,
bukan menambah kolom status.** Ambang: TikTok >180 hari, Shopee >90 hari, dihitung dari
`periode_selesai`.

### 1.3 RLS — tiga kelas, konsisten di seluruh 14 tabel
- **Variant B** (AM pemilik/lead Account/Director-OD): `pdt_upload_batch`, `pdt_file`,
  keenam tabel fakta, `pdt_usulan`, `pdt_laporan_kiriman`.
- **Variant A** (nol GRANT sama sekali, service-role only): `pdt_benchmark`,
  `pdt_usulan_katalog` — cermin `adsscanner_benchmark`/`px_eligibility_policy`.
- **Kelas ketiga** (`USING (true)`, reference table lintas-divisi): `pdt_parser_modul`,
  `pdt_kolom_alias` — masuk ledger O48 dengan alasan tertulis (§42 `rls_checks.sql`).

---

## 2. Yang TIDAK disentuh sesi ini (di luar cakupan G1-01)

- **G1-00 sisa** (§2.1/§2.2 `HANDOFF_PDT_SESI2.md`) — pembersihan klien testing & assign AM
  **masih ditunda pemilik**. Belum ada instruksi baru.
- **Bug pra-ada `gelombang-c-showcase.e2e.test.ts`** (dicatat `HANDOFF_PDT_SESI2.md` §4) —
  direproduksi ulang sesi ini (`uq_client_platforms_active_platform` collision di
  `seedLaporan()`), masih **belum diperbaiki**. Proposed patch sudah tercatat di sana.
  Opsional, tidak menghalangi G1 lanjut.
- **Seed `pdt_parser_modul`/`pdt_kolom_alias`** — nol baris. Itu G1-02.

---

## 3. Rekomendasi urutan sesi 4 — mulai G1-02

`docs/backlog/PDT_BACKLOG.md` §1 G1-02: **"Seed `pdt_parser_modul` — menyatukan EMPAT
registry, bukan satu."**

1. Baca `docs/backlog/PDT_KOLOM_DIPANEN.md` (whitelist `kolom_dipanen` yang mengikat,
   bucket 1+2 lengkap — bucket 3 "human call" 11 kolom masih menunggu Hans/Anty, TIDAK
   memblokir G1-02).
2. Satukan tanda tangan kolom dari EMPAT registry lama (`packages/core/src/baseline/detect.ts`,
   `report/detect.ts`, `report/shopee/detect.ts`, `adsscanner/tiktok/detect.ts`) ke baris
   `pdt_parser_modul` (kolom `tanda_tangan_kolom jsonb` + `kolom_dipanen text[]` yang SUDAH
   ADA di skema — tabel ini kosong hari ini, hanya perlu di-seed via migrasi baru, BUKAN
   ALTER TABLE lagi).
3. Deteksi modul TIDAK BOLEH bergantung nama berkas (Rule 6) — uji terhadap 28 berkas sample
   (Fim Motor/Shopee, Avitaskin/TikTok), target nol salah-slot.
4. `pdt_kolom_alias` diisi untuk alias yang sudah diketahui dari sample.
5. Setelah G1-02, urutan alami: G1-03 (normalisasi angka → NaN) → G1-04 (bucket `pdt-raw` +
   pagar ZIP) → G1-05 (parse di server) → G1-06 (identitas toko dari berkas) → G1-07
   (rekonsiliasi) → G1-08 (kegagalan parse tidak ditelan) → G1-09 (halaman upload).

**Jangan lompat ke G1-09 (halaman upload) sebelum G1-02/03/04/05/06/07/08** — backlog
build order eksplisit menaruh parser/rekonsiliasi sebelum UI (PDT_BACKLOG.md §0 build order
tersirat dari penomoran G1-01→G1-11).

---

## 4. Rujukan

- `docs/prd/CDPS_PDT_Pusat_Data_Toko.md` (v1.2) — PRD.
- `docs/backlog/PDT_BACKLOG.md` — tiket G1-01…G5 (lihat G1-01 untuk detail lengkap yang
  sesi ini kerjakan, G1-02 untuk sesi berikutnya).
- `docs/backlog/PDT_KOLOM_DIPANEN.md` — whitelist `kolom_dipanen` mengikat.
- `docs/DECISIONS.md` — baris teratas (2026-09-13, PDT G1-01) mencatat semua deviasi sesi ini.
- `docs/DATA_MODEL.md` §1 — 14 baris entity PDT baru, di atas baris "Studio produksi".
- `supabase/migrations/20261011010000_g1_01_pdt_tables.sql` — migrasi lengkap, komentar
  inline menjelaskan tiap keputusan desain.
- Live: `CDPS SG` (`egddxfcnrtecheiykhlf`), migrasi `g1_01_pdt_tables` sudah live per
  `list_migrations`.
