# CDPS — Role-Mapping HRIS → CDPS (dari data karyawan riil)

> **UPDATE 2026-07-11 — 6 butir [KONFIRMASI] SUDAH DIJAWAB OD (Nerissa).** Hasil validasi dirangkum di §0 di bawah dan sudah diterapkan ke tabel §3. Yang masih terbuka: TIKTOK GO, DATA & BUSINESS INTELLIGENCE, konfirmasi akhir IT/HRGA/SKILSKUL, dan daftar employee_id OD/Director. Baris yang sudah tervalidasi **boleh di-seed** (lihat `docs/DECISIONS.md` 2026-07-11).

---

## 0. Hasil validasi OD (Nerissa, 2026-07-11)

| DEPARTMENT | Keputusan | Konsekuensi teknis |
|---|---|---|
| CREATIVE - EKSTERNAL | Freelance/vendor **tanpa akun CDPS** | Jangan disync sebagai user aktif — dikecualikan dari emit `hrisconvert` (exclusion list). |
| ADVERTISER | Benar = tim Ads (M8) | Map ke division **Ads**, level per heuristik jabatan. |
| MCN | **Keluar dari CDPS** — divisi lain di sister company | Dikecualikan dari sync sepenuhnya (exclusion list). |
| AFFILIATE | **Gabung ke KOL** | Map ke division **KOL**, level per heuristik jabatan. |
| BUSINESS DEVELOPMENT | **Di luar modul CDPS.** Catatan: 1 orang di BD adalah bagian marketing yang membuat leads di awal funnel | Tanpa baris `role_mappings` (sync tanpa akses). Orang marketing tsb = kandidat akses M2 Marketing (Wave 3) — assignment per-orang menyusul, bukan per-departemen. |
| GROWTH & BUSINESS CONSULTATION | **Bagian dari Account** | Map ke division **Account**, level per heuristik jabatan. |

Keputusan terkait dari sesi yang sama: **tidak ada sistem nickname sales** — di data sumber semua sales ditulis dengan nama lengkap, satu-satunya pengecualian adalah Sales Head yang memakai nickname **"Cena"**. Konsekuensi untuk import & sales-map: lihat `LANGKAH_MANUSIA_GO_LIVE.md` §2 (revisi 2026-07-11).

> **DRAFT sebagian —** baris yang belum tervalidasi di §3 tetap jangan di-seed sebelum disetujui. Disusun dari kolom `DEPARTMENT`/`JABATAN` riil yang dilaporkan ada di sheet karyawan HRIS (lihat `docs/handoff/WAVE1_EXTERNAL_REQUESTS.md` §"Jawaban diterima (2026-07-10)"), **bukan** dari file sheet itu sendiri (belum di-commit ke `backend/testdata/import_samples/hris_karyawan.csv` saat draft ini ditulis). Begitu file asli tersedia, jalankan `hrisconvert --pairs` di atasnya untuk mendapat daftar pasangan `DEPARTMENT,JABATAN` **riil dengan hitungan kemunculan** dan bandingkan dengan tabel di bawah — beberapa baris di sini kemungkinan perlu direvisi begitu variasi ejaan/singkatan jabatan yang sesungguhnya terlihat.

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
| CREATIVE - EKSTERNAL | **tidak disync (tanpa akun CDPS)** | — | ✅ **VALIDATED 2026-07-11:** freelance/vendor tanpa akun CDPS (pola vendor Live Stream M10). Masuk exclusion list `hrisconvert` — tidak di-emit sebagai user aktif. |
| ADVERTISER | **Ads** | staff/lead sesuai jabatan | ✅ **VALIDATED 2026-07-11:** benar tim Ads (M8). |
| MCN | **keluar dari CDPS (exclusion)** | — | ✅ **VALIDATED 2026-07-11:** divisi lain di sister company — dikeluarkan dari CDPS sepenuhnya, tidak disync. |
| AFFILIATE | **KOL** | staff/lead sesuai jabatan | ✅ **VALIDATED 2026-07-11:** gabung ke KOL (M9). |
| BUSINESS DEVELOPMENT | **tidak di-mapping (di luar modul)** | — | ✅ **VALIDATED 2026-07-11:** di luar cakupan modul CDPS — sync tanpa role (tanpa akses). Catatan: 1 orang BD adalah bagian marketing pembuat leads awal → kandidat akses M2 Marketing (Wave 3), assignment per-orang menyusul. |
| GROWTH & BUSINESS CONSULTATION | **Account** | staff/lead sesuai jabatan | ✅ **VALIDATED 2026-07-11:** bagian dari Account (M6). |
| TIKTOK GO | *(belum dipetakan)* | — | **[KONFIRMASI]** M10 Live Stream (PRD §6.1) sengaja **tidak** punya role staf eksekusi internal — live stream sepenuhnya dikerjakan vendor sister-company, dan **AM (Account) yang memegang request + rekonsiliasi**, bukan staf divisi tersendiri. Kalau tim "TikTok Go" ini adalah tim internal yang mengelola akun TikTok Shop klien secara langsung (bukan AM Account biasa), ini kemungkinan pekerjaan **di luar cakupan modul CDPS saat ini** — perlu keputusan OD, bukan tebakan mapping. |
| FINANCE AND ACCOUNTING | Finance | staff/lead sesuai jabatan | Match langsung ke modul M5 Finance. |
| DATA & BUSINESS INTELLIGENCE | *(belum dipetakan)* | — | **[KONFIRMASI]** Tidak ada modul CDPS untuk tim data/BI sebagai *user role* — rollup (ROAS/Health Score/dsb.) di CDPS dihitung otomatis dari log, bukan diinput tim ini. Kemungkinan kandidat layered **OD** (read-only lintas divisi untuk kebutuhan reporting) daripada divisi eksekusi — perlu konfirmasi apakah tim ini butuh akses CDPS sama sekali atau konsumsi data lewat jalur lain. |
| IT | tidak di-mapping (tanpa akses CDPS) | — | Bukan divisi delivery klien; tidak ada modul CDPS yang relevan. **Konfirmasi** ke OD sebelum benar-benar tanpa akun (mis. kebutuhan admin teknis). |
| HRGA | tidak di-mapping (tanpa akses CDPS) | — | HR & General Affairs adalah bagian dari sistem HRIS itu sendiri (sumber data, bukan konsumen CDPS) — CDPS hanya *membaca* dari HRIS, tidak mengelola HR. **Konfirmasi** ke OD. |
| SKILSKUL | tidak di-mapping (tanpa akses CDPS) | — | Tidak match modul CDPS mana pun yang terdaftar di PRD. Kemungkinan unit bisnis/brand terpisah dari lini delivery client MEA Agency yang dicakup CDPS. **Konfirmasi** ke OD apakah unit ini di luar cakupan CDPS sepenuhnya. |
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

- Sheet asli (`hris_karyawan.csv`/`.xlsx`) di-commit ke `backend/testdata/import_samples/` atau dibagikan ke konektor Google Drive (konektor kini AKTIF — pricelist MSL sudah terbaca 2026-07-11).
- ~~Jawaban 6 [KONFIRMASI]~~ ✅ **selesai 2026-07-11** (lihat §0). Masih terbuka: **TIKTOK GO** dan **DATA & BUSINESS INTELLIGENCE**, plus konfirmasi akhir IT/HRGA/SKILSKUL (default saat ini: tanpa akses).
- Daftar `jabatan` riil per divisi yang sudah bermodul (Sales/Account/Creative/Ads/KOL/Finance), untuk melengkapi heuristik lead/staff dengan tabel eksplisit seperti `roleMappings` di `seed.go` — didapat dari `hrisconvert --pairs` begitu sheet asli terbaca.
- Daftar employee_id kandidat layered role **OD** dan **Director** (bukan by-departemen — by-orang, sama pola `directors` di `seed.go`).
- Identitas 1 orang BD (marketing pembuat leads) untuk assignment akses M2 nanti.

**Baris §3 yang bertanda ✅ VALIDATED boleh di-seed; baris lain tetap menunggu keputusan.**
