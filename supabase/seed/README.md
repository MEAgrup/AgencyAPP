# `supabase/seed/` — data kanonik non-Go

Berkas di sini adalah **data organisasi riil**, bukan fixture test. Ia **disalin** keluar dari
`backend/` pada 2026-07-29 sebagai prasyarat pensiun Go (C-05): opsi "tag rilis lalu hapus
`backend/`" di `docs/backlog/CUTOVER_BACKLOG.md` §C-05 butir 2 akan **ikut menghapus data ini**
kalau ia hanya tinggal di sana. Kode Go boleh diarsipkan; konfigurasi organisasi tidak.

> **Disalin, BUKAN dipindah — dan itu koreksi.** Percobaan pertama memindahkannya dengan
> `git mv`, dan CI memerahkan job `backend`: lima test `cmd/rolemapseed` membuka kedua CSV riil
> lewat helper `FindRoleMappingsCSV()` / `FindLayeredRolesCSV()`, **bukan** lewat nama berkas
> literal, sehingga grep atas string nama berkas di `*_test.go` tidak menemukan apa pun dan
> pemindahan itu terlihat aman. `go vet` juga lolos — vet tidak menjalankan test. Sampai job
> `backend` dicabut di Fase 5, ketiga berkas ini harus **ada di kedua tempat**, byte-identik,
> persis seperti `msl_kalkulator.csv` yang sudah begitu sejak C-04.

| Berkas | Isi | Provenance |
|---|---|---|
| `msl_kalkulator.csv` | 32 layanan MSL v2 (sumber seed C-04) | DECISIONS 2026-07-28 — seed MSL kanonik, **bukan** `MSL_DRAFT_KOMPILASI.csv` |
| `role_mappings_riil.csv` | 23 mapping HRIS `divisi,jabatan` → CDPS `division,level`. **Tanpa baris header** | DECISIONS 2026-07-17 "Role mapping riil batch-1" |
| `layered_roles_riil.csv` | layered role OD/Director (`employee_id,role`) | idem |
| `hris_department_jabatan_pairs.csv` | 28 pasangan `department,jabatan,count` dari roster HR riil — himpunan input yang harus tercakup `role_mappings` | O21, roster HR 2026-07-17 |

## Duplikat di `backend/seed/` — jangan dihapus sebelum Fase 5

`backend/seed/` memuat ketiga berkas yang sama, byte-identik (diverifikasi md5):
`msl_kalkulator.csv` · `role_mappings_riil.csv` · `layered_roles_riil.csv`. Keduanya harus tetap
sinkron sampai job `backend` dicabut dari CI, karena `cmd/mslseed` dan `cmd/rolemapseed`
(termasuk **test**-nya) mencarinya dengan menaiki direktori sampai menemukan `seed/<nama>.csv`.

**Saat Fase 5 mencabut `backend/`, salinan di sini menjadi satu-satunya — dan itulah tujuannya.**
Stack baru sudah memakai yang di sini (`apps/api/scripts/mslseed.ts`), dan padanan produksi
`rolemapseed` adalah halaman admin role-mappings (6 route admin yang diport di O44(b)).

Kalau perlu menjalankan CLI Go-nya terhadap salinan di sini sebelum arsip:

```bash
CDPS_ROLE_MAP_CSV=supabase/seed/role_mappings_riil.csv \
CDPS_LAYERED_ROLE_CSV=supabase/seed/layered_roles_riil.csv \
  go run ./cmd/rolemapseed …
```

## ✅ Roster PII era Go sudah DIHAPUS dari repo (2026-07-30)

`backend/testdata/import_samples/` — 7 CSV + README — **dihapus** atas keputusan pemilik
(`docs/DECISIONS.md` 2026-07-30). Isinya PII riil: roster HR (`hris_karyawan.csv`: NIK, nama
lengkap, tanggal join, department/jabatan), pemetaan `nik_email.csv`, `employees_from_hris.csv`
/ `employees_cdps.csv` / `employees_uat.csv`, plus fixture `*_uat.csv` era Go.

Menghapusnya aman karena berkas-berkas itu adalah salinan **input impor satu kali**, bukan
sumber kebenaran: live `CDPS SG` sudah memuat **69 karyawan** di
`employees`/`employee_credentials`/`auth.users`/`auth.identities`, dan `role_mappings`
(**39**) sudah ter-seed. Sinkronisasi karyawan berikutnya memakai import CSV admin-triggered
(OQ-4, DECISIONS 2026-07-22) dengan berkas yang disediakan HR saat itu — bukan salinan beku
di repo. Mapping riil yang masih dibutuhkan tetap ada di folder ini:
`role_mappings_riil.csv` · `layered_roles_riil.csv` · `hris_department_jabatan_pairs.csv`
(ketiganya **tanpa** nama/email; `layered_roles_riil.csv` hanya `employee_id,role`).

> ⚠️ **Penghapusan ini tidak menghapus PII dari histori git.** Commit-commit lama masih
> memuat isi berkasnya (`git show <commit>:backend/testdata/import_samples/…`). Membersihkan
> histori butuh rewrite paksa (`git filter-repo`) + re-clone terkoordinasi seluruh
> kontributor — keputusan & eksekusi pemilik, belum dilakukan. Kalau kebijakan retensi
> menuntut PII benar-benar hilang dari repo, itu langkah terpisah yang masih terbuka.

`backend/testdata/employees.csv` **sengaja ditinggalkan**: isinya fixture sintetis
(`EMP-0001 Budi Santoso`, dst.), bukan PII, dan ia default yang dibaca `cmd/cdps` +
`internal/seed` — menghapusnya akan mematikan job `backend` sebelum C-05 mencabutnya.
