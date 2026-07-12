# CDPS — Draft Role-Mapping HRIS → CDPS (dari data karyawan riil)

> **TERVALIDASI 2026-07-12 — semua [KONFIRMASI] dijawab Nerissa (interview), lihat `docs/DECISIONS.md` §"Wave 2 kickoff". Tabel §3 di bawah sudah mencerminkan jawaban final; boleh di-seed sebagai `role_mappings` begitu sheet karyawan asli terbaca.** (Teks asli draft:) Disusun dari kolom `DEPARTMENT`/`JABATAN` riil yang dilaporkan ada di sheet karyawan HRIS (lihat `docs/handoff/WAVE1_EXTERNAL_REQUESTS.md` §"Jawaban diterima (2026-07-10)"), **bukan** dari file sheet itu sendiri (belum di-commit ke `backend/testdata/import_samples/hris_karyawan.csv` saat draft ini ditulis). Begitu file asli tersedia, jalankan `hrisconvert --pairs` di atasnya untuk mendapat daftar pasangan `DEPARTMENT,JABATAN` **riil dengan hitungan kemunculan** dan bandingkan dengan tabel di bawah — beberapa baris di sini kemungkinan perlu direvisi begitu variasi ejaan/singkatan jabatan yang sesungguhnya terlihat.

---

## 1. Cara pakai dokumen ini

Tabel §3 adalah usulan pemetaan `role_mappings` (`divisi`, `jabatan` → `division`, `level`) sesuai model role CDPS di `PERMISSIONS.md` dan `backend/internal/core/permission/permission.go` + `backend/internal/admin/roles.go`. **Tidak ada baris yang di-`INSERT` ke `role_mappings` dari draft ini** — ini bahan diskusi untuk OD/Nerissa memvalidasi sebelum tim dev menjalankan `admin.UpsertRoleMapping` (pola yang sama seperti seed Alpha Digital di `backend/internal/seed/seed.go`).

Alur setelah divalidasi:
1. OD/Nerissa mengonfirmasi/mengoreksi tabel §3 (dan menjawab setiap butir bertanda **[KONFIRMASI]**).
2. Tim dev menjalankan `hrisconvert` (`backend/cmd/hrisconvert`) di atas sheet asli untuk menghasilkan CSV fallback `EmployeeSource` (`employee_id,nama,email,divisi,jabatan,status_aktif`) — lihat §5.
3. Baris tabel yang sudah disetujui di-input sebagai `role_mappings` (mis. lewat admin UI role-mapping atau seed script khusus data riil), **bukan** dengan menimpa `backend/internal/seed/seed.go` (itu tetap seed contoh Alpha Digital).

---

## 2. Model role CDPS (ringkasan, sumber: `PERMISSIONS.md` + `permission.go`)

- **Staff** = data sendiri saja.
- **Lead/SPV** (`level = "lead"`) = seluruh divisi (division-wide).
- **OD** = *layered role* read-only di semua tempat + mengelola OKR — **tidak pernah menulis**. OD **tidak** didapat lewat baris `role_mappings` (yang menentukan `division`+`level` dasar) — OD adalah flag terpisah yang di-set per `employee_id` lewat `admin.SetLayeredRole(ctx, d, actor, employeeID, "od", true)`, persis pola `Director` di `seed.go` (`directors = []string{"EMP-0008", ...}`, bukan lewat tabel departemen).
- **Director** = *layered role* akses penuh + kelola karyawan/role-mapping. Sama seperti OD: di-set per `employee_id`, bukan per departemen.

Konsekuensi untuk draft ini: kolom `DEPARTMENT`="OD" di sheet HRIS **bukan** berarti butuh baris `role_mappings` khusus divisi "OD" — itu sinyal bahwa karyawan tersebut kandidat layered role OD, dan employee_id-nya perlu ditambahkan ke daftar assignment OD (mekanisme yang sama dengan daftar `directors` di `seed.go`, tapi role `"od"`).

Divisi CDPS yang sudah punya modul & sudah dipakai di kode (`backend/internal/seed/seed.go`, `module4_client`, `module5_finance`, dll): **Sales, Account, Creative, Ads, KOL, Finance**. Tidak ada divisi CDPS lain yang sudah dikodekan — departemen HRIS yang tidak match salah satu dari enam ini butuh keputusan eksplisit (mapping ke salah satu di atas, divisi baru, atau tanpa akses).

**Heuristik level** (sesuai instruksi tugas ini): `JABATAN` mengandung `HEAD OF` / `SPV` / `SUPERVISOR` / `LEADER` / `LEAD` (case-insensitive) → `level = lead`; selain itu → `level = staff`. Ini heuristik kasar berbasis kata kunci — **setiap baris di §3 masih perlu dicek manual**, terutama jabatan yang tidak eksplisit menyebut kata-kata itu (mis. "Manager", "Kepala", "Koordinator").

---

## 3. Usulan pemetaan DEPARTMENT → CDPS division / level

| DEPARTMENT (riil) | CDPS division diusulkan | Level (heuristik jabatan) | Catatan |
|---|---|---|---|
| SALES | Sales | staff/lead sesuai jabatan | Match langsung ke modul M0 Sales. |
| ACCOUNT | Account | staff/lead sesuai jabatan | Match langsung ke modul M6 Account. |
| CREATIVE | Creative | staff/lead sesuai jabatan | Match langsung ke modul M7 Creative. |
| CREATIVE - EKSTERNAL | **tidak di-mapping (tanpa akses CDPS)** | — | ✅ **FINAL (2026-07-12):** freelance/vendor eksternal — TANPA akun CDPS, tidak di-sync sebagai user aktif. Pekerjaan mereka tercatat lewat brief/asset yang dipegang PIC internal. |
| ADVERTISER | Ads | staff/lead sesuai jabatan | ✅ **FINAL (2026-07-12):** dikonfirmasi — ADVERTISER = tim Ads (M8). |
| MCN | **tidak di-mapping (tanpa akses CDPS)** | — | ✅ **FINAL (2026-07-12):** MCN = **brand/tim BERBEDA** dari tim KOL agency (usulan map ke KOL DIBATALKAN). Seluruh divisi MCN tidak memerlukan CDPS. |
| AFFILIATE | **KOL** | staff/lead sesuai jabatan | ✅ **FINAL (2026-07-12):** gabung ke divisi KOL (M9) — pakai board & metrik KOL. |
| BUSINESS DEVELOPMENT | **Sales** | staff/lead sesuai jabatan | ✅ **FINAL (2026-07-12):** dikonfirmasi BD bekerja di alur M0 (lead→closing) → map ke Sales; ikut metrik closing & komisi. |
| GROWTH & BUSINESS CONSULTATION | **tidak di-mapping (tanpa akses CDPS)** | — | ✅ **FINAL (2026-07-12):** di luar CDPS — tanpa akun. |
| TIKTOK GO | **tidak di-mapping (di luar CDPS untuk saat ini)** | — | ✅ **FINAL (2026-07-12):** pekerjaan tim TikTok Go belum tercakup modul CDPS mana pun — tanpa mapping; dicatat untuk ditinjau di fase berikutnya. |
| FINANCE AND ACCOUNTING | Finance | staff/lead sesuai jabatan | Match langsung ke modul M5 Finance. |
| DATA & BUSINESS INTELLIGENCE | *(bukan baris role_mapping)* | — | ✅ **FINAL (2026-07-12):** layered **OD read-only** per-orang (pola `directors` di seed, role `od`) untuk kebutuhan reporting lintas divisi. Daftar employee_id menyusul bersama berkas HR. |
| IT | **role baru "admin sistem"** *(deviasi ter-log)* | — | ✅ **FINAL (2026-07-12):** role baru di luar matrix Phase 0 §4 (dicatat di DECISIONS.md): fungsi admin (role-mapping, sync HRIS, admin MSL, master data) TANPA akses data deal/komisi/finance. Diimplementasikan saat dibutuhkan — sementara IT belum di-seed sebagai user. |
| HRGA | *(bukan baris role_mapping)* | — | ✅ **FINAL (2026-07-12):** layered **OD penuh** per-orang — kebutuhan: menilai kinerja OKR tim; konsekuensi read-only seluruh sistem (termasuk data komersial) dipahami & diterima Nerissa. |
| SKILSKUL | tidak di-mapping (tanpa akses CDPS) | — | ✅ **FINAL (2026-07-12):** dikonfirmasi di luar cakupan CDPS. |
| OD | *(lihat §2 — bukan baris role_mapping)* | — | Karyawan di departemen ini adalah kandidat **layered role OD** (`employee_layered_roles`, role=`od`), di-assign per `employee_id`, sama pola dengan `directors` di `seed.go`. Divisi dasar (`role_mappings`) mereka mengikuti jabatan/riwayat lain jika ada, atau dikosongkan (Actor tetap dapat akses read-all lewat flag OD, terlepas dari `Role.Division`). |

**Departemen dengan modul CDPS (Sales/Account/Creative/Ads/KOL/Finance)** di atas masih perlu tabel `jabatan` per-departemen yang eksplisit (bukan hanya heuristik lead/staff) — heuristik di §2 adalah jaring pengaman awal, **bukan pengganti** peninjauan manual per jabatan riil begitu daftar pasangan `DEPARTMENT,JABATAN` lengkap (dari `hrisconvert --pairs`) tersedia.

---

## 4. Kotoran data yang sudah diketahui (dan bagaimana `hrisconvert` menanganinya)

Alat konversi `backend/cmd/hrisconvert` (baca `backend/internal/hris/convert.go`) menangani ini di sisi teknis — **tidak berhubungan langsung dengan tabel role-mapping di §3**, tapi relevan karena data yang sama dipakai untuk mengisi `divisi`/`jabatan` riil:

| Temuan | Perlakuan |
|---|---|
| Satu NIK 9 digit (`260210626` — contoh dari laporan, bukan data riil di dokumen ini) | **Warning**, baris tetap disertakan. |
| NIK duplikat | **Fatal** — dilaporkan (nomor baris + isi), tidak ada baris yang di-emit sampai diperbaiki. |
| Baris kosong / header gabungan terduplikasi (artefak merged-cell di sheet) | Dilewati otomatis (tidak dihitung sebagai baris data). |
| Baris data asli dengan NIK/NAMA/DEPARTMENT/JABATAN kosong | **Fatal** — tidak pernah di-skip diam-diam (beda dari baris header/kosong murni di atas). |
| Spasi di awal/akhir sel | Ditrim otomatis. |
| Kolom `JOIN DATE` (format tanggal Indonesia, mis. `24-Mei-2021`) | Diabaikan sepenuhnya — tidak diparse, tidak di-emit (tidak dibutuhkan format `EmployeeSource`). |
| Email | **Tidak ada** di sheet asli — kolom `email` output selalu kosong kecuali diisi lewat `--emails nik,email` (mapping terpisah dari HR). **Konsekuensi kalau tetap kosong:** login CDPS memakai email+password (`internal/httpapi/auth_handlers.go` `handleLogin`) — karyawan tanpa email **tidak bisa login** sampai HR menyediakan email. |
| `status_aktif` | Semua baris di sheet dianggap karyawan aktif saat ini (`true`) — karyawan yang sudah keluar ditangani lewat mekanisme *absence-on-full-sync* yang sudah ada (`flagged_for_review`, lihat `internal/hris/sync.go`), bukan lewat kolom status di sheet (sheet ini memang tidak punya kolom status). |

---

## 5. Cara menjalankan `hrisconvert`

```
hrisconvert <hris_karyawan.csv> -o employees_from_hris.csv
hrisconvert <hris_karyawan.csv> --emails nik_email.csv -o employees_from_hris.csv
hrisconvert <hris_karyawan.csv> --pairs -o department_jabatan_pairs.csv
```

Ringkasan (N baris masuk / N di-emit / N warning / N pasangan DEPARTMENT|JABATAN unik) selalu dicetak ke stderr, termasuk berapa karyawan yang emailnya kosong. Kalau ada NIK duplikat atau field wajib kosong pada baris data asli, alat **berhenti dengan kode keluar bukan-nol** dan mencetak setiap baris bermasalah (nomor baris + isi) — tidak ada baris yang didiamkan/di-drop.

---

## 6. Yang masih ditunggu

- Sheet asli (`hris_karyawan.csv`/`.xlsx`) di-commit ke `backend/testdata/import_samples/` atau konektor Google Drive diaktifkan (lihat `docs/handoff/WAVE1_EXTERNAL_REQUESTS.md` §"⚠ Kendala akses").
- ~~Jawaban OD/Nerissa untuk setiap [KONFIRMASI] di §3~~ ✅ **SELESAI 2026-07-12** (interview Nerissa, tercatat di DECISIONS.md).
- Daftar `jabatan` riil per divisi yang sudah bermodul (Sales/Account/Creative/Ads/KOL/Finance), untuk melengkapi heuristik lead/staff dengan tabel eksplisit seperti `roleMappings` di `seed.go`.
- Daftar employee_id kandidat layered role **OD** dan **Director** (bukan by-departemen — by-orang, sama pola `directors` di `seed.go`).

**Tabel §3 sudah divalidasi (2026-07-12) — seed `role_mappings` boleh dilakukan begitu sheet karyawan asli terbaca (`hrisconvert --pairs` untuk cek jabatan riil tetap wajib sebelum seed).**
