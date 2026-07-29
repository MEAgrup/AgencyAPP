# `supabase/seed/` — data kanonik non-Go

Berkas di sini adalah **data organisasi riil**, bukan fixture test. Ia dipindahkan keluar dari
`backend/` pada 2026-07-29 sebagai prasyarat pensiun Go (C-05): opsi "tag rilis lalu hapus
`backend/`" di `docs/backlog/CUTOVER_BACKLOG.md` §C-05 butir 2 akan **ikut menghapus data ini**
kalau ia masih tinggal di sana. Kode Go boleh diarsipkan; konfigurasi organisasi tidak.

| Berkas | Isi | Provenance |
|---|---|---|
| `msl_kalkulator.csv` | 32 layanan MSL v2 (sumber seed C-04) | DECISIONS 2026-07-28 — seed MSL kanonik, **bukan** `MSL_DRAFT_KOMPILASI.csv` |
| `role_mappings_riil.csv` | 23 mapping HRIS `divisi,jabatan` → CDPS `division,level`. **Tanpa baris header** | DECISIONS 2026-07-17 "Role mapping riil batch-1" |
| `layered_roles_riil.csv` | layered role OD/Director (`employee_id,role`) | idem |
| `hris_department_jabatan_pairs.csv` | 28 pasangan `department,jabatan,count` dari roster HR riil — himpunan input yang harus tercakup `role_mappings` | O21, roster HR 2026-07-17 |

## Yang berubah untuk `cmd/rolemapseed` (Go)

`backend/cmd/rolemapseed` mencari kedua CSV riil dengan menaiki direktori sampai menemukan
`seed/<nama>.csv`, jadi **path default-nya kini tidak ketemu**. Itu disengaja — CLI itu bagian
dari stack yang dipensiunkan, dan padanan produksinya sudah ada (halaman admin role-mappings,
6 route admin yang diport di O44(b)). Kalau masih perlu dijalankan sebelum arsip:

```bash
CDPS_ROLE_MAP_CSV=supabase/seed/role_mappings_riil.csv \
CDPS_LAYERED_ROLE_CSV=supabase/seed/layered_roles_riil.csv \
  go run ./cmd/rolemapseed …
```

`backend/seed/msl_kalkulator.csv` **sengaja ditinggal** (duplikat byte-identik) supaya
`cmd/mslseed` Go tetap jalan sampai job `backend` dicabut di Fase 5; `apps/api/scripts/mslseed.ts`
sudah memakai salinan di sini.

## ⚠️ Yang MASIH di `backend/` dan butuh keputusan pemilik sebelum dihapus

`backend/testdata/import_samples/` memuat **PII** — roster HR riil (`hris_karyawan.csv`),
pemetaan `nik_email.csv`, dan `employees_from_hris.csv` — plus fixture `*_uat.csv` era Go.
README di folder itu sendiri memperingatkan datanya berisi nama & telepon.

Ia **tidak** dipindahkan ke sini: menyebarkan PII ke folder yang dibaca tooling seed bukan
perbaikan, dan retensi data pribadi adalah keputusan pemilik, bukan keputusan teknis. Yang
dibutuhkan sebelum C-05 memilih opsi "hapus": putuskan apakah roster PII itu diarsipkan
(bukan dihapus), dihapus, atau dianonimkan. Live sudah memuat 69 karyawan, jadi berkas-berkas
itu **bukan** lagi satu-satunya salinan data karyawan — ia salinan *input impor* satu kali.
