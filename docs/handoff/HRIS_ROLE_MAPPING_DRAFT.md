# CDPS — Draft Role-Mapping HRIS → CDPS (dari data karyawan riil)

> **DRAFT — butuh validasi, jangan di-seed sebelum disetujui.** Disusun dari kolom `DEPARTMENT`/`JABATAN` riil yang dilaporkan ada di sheet karyawan HRIS (lihat `docs/handoff/WAVE1_EXTERNAL_REQUESTS.md` §"Jawaban diterima (2026-07-10)"), **bukan** dari file sheet itu sendiri (belum di-commit ke `backend/testdata/import_samples/hris_karyawan.csv` saat draft ini ditulis). Begitu file asli tersedia, jalankan `hrisconvert --pairs` di atasnya untuk mendapat daftar pasangan `DEPARTMENT,JABATAN` **riil dengan hitungan kemunculan** dan bandingkan dengan tabel di bawah — beberapa baris di sini kemungkinan perlu direvisi begitu variasi ejaan/singkatan jabatan yang sesungguhnya terlihat.

---

## 0. ADDENDUM — Validasi terhadap data riil (2026-07-11)

Sheet HRIS asli sudah diterima (Google Sheet "Data Karyawan", 186 karyawan, **termasuk kolom EMAIL**) dan `hrisconvert --pairs` sudah dijalankan: **123 pasangan `DEPARTMENT,JABATAN` unik**, agregat lengkap di `docs/handoff/DEPARTMENT_JABATAN_PAIRS.csv` (tanpa PII). Gate kualitas data lolos: 0 NIK duplikat, 1 warning NIK 9 digit (`260210626`), 1 email `#N/A` (NIK 2309010304). Hasil pembandingan tabel §3 vs data riil:

**Nama departemen: draft 100% akurat** — 16 departemen riil = 16 baris §3, tidak ada yang baru/hantu. Tapi isi jabatan riil mengubah beberapa asumsi:

| Item §3 | Hasil validasi data riil |
|---|---|
| ADVERTISER → Ads | **✅ Terkonfirmasi kuat** — 7 orang, semua jabatan varian advertiser (ad-ops M8). |
| MCN → KOL | **✅ Terkonfirmasi kuat** — 51 orang, didominasi CREATOR MANAGER (11), KOL CAMPAIGN/AKUISISI/SPECIALIST, INTERN KOL/MCN. |
| AFFILIATE | **➡ Condong KOL** — hanya 1 orang ("AFFILIATE & BRAND SUPPORT"); fungsi affiliate lain justru hidup di dalam MCN (MENTOR AFFILIATE ×2, KOL & AFFILIATE SPECIALIST ×2, dll). |
| BUSINESS DEVELOPMENT → Sales *(tentatif)* | **❌ TERBANTAH** — 7 orang, jabatan riil = CONTENT CREATOR (PERSONAL BRANDING) ×2, MARKETING STRATEGIST, PUBLIC RELATION, SEO CONTENT WRITER, SOCIAL MEDIA OFFICER, BD INTERN. Ini tim marketing/PR internal, bukan alur M0 lead→closing. Jangan seed → butuh keputusan (O25). |
| TIKTOK GO | **⚠ Skala tak terduga: 21 orang** (dept terbesar ke-3) — LEADER TIKTOK GO, BUSINESS GROWTH & CAMPAIGN LEAD, BD & CM REGIONAL (Jakarta/Yogyakarta), CM TOP CREATOR, INTERN KOL ×5, dll. Bukan pola "vendor live-stream + AM" M10 — butuh keputusan OD eksplisit (O25). |
| DATA & BUSINESS INTELLIGENCE | 4 orang, semua Data Analyst (1 senior, 1 mid, 2 intern) — asumsi draft (read-only/tanpa akun) tetap valid, keputusan akses tetap manusia. |
| CREATIVE - EKSTERNAL | 6 orang, murni peran produksi (GRAPHIC DESIGNER ×3, VIDEOGRAPHER ×2, PROJECT LEAD - CONTENT STRATEGIST) — pertanyaan tersisa hanya: butuh login CDPS atau freelance tanpa akun? |
| GROWTH & BUSINESS CONSULTATION | 2 orang, keduanya BUSINESS CONSULTANT — data tidak cukup menjawab; tetap butuh manusia. |
| **OD** | **🚨 TABRAKAN ISTILAH (temuan kritis, O24)** — 2 karyawan dept OD adalah *Organization Development* (NIK 2501140493 SENIOR ORG DEV; NIK 2607060683 JR ORG DEV), fungsi HR/people-development. **BUKAN** otomatis kandidat layered role OD read-all CDPS seperti asumsi §2. Layered OD/Director harus ditetapkan per-orang oleh manajemen, bukan dari departemen ini. |

**Kandidat `level=lead` eksplisit dari jabatan riil (14 orang):** SALES: 2101180004 (HEAD OF SALES JASA), 2508010558 (CRO MENTOR TIKTOK). ACCOUNT: 2305100275 (HEAD OF ACCOUNT), 2310020314 (LEADER CRO). CREATIVE: 2412230480 (LEADER VIDEOGRAPHER). CREATIVE-EKSTERNAL: 2410010436 (PROJECT LEAD). MCN: 2307310296 (SUPERVISOR MCN), 2601120599 (LEADER CELEBRITY & INFLUENCER CREATOR), 2504080534 + 260210626 (MENTOR AFFILIATE). TIKTOK GO: 2509010568 (LEADER TIKTOK GO), 2508260566 (BUSINESS GROWTH & CAMPAIGN LEAD). HRGA: 2409230432 (SUPERVISOR HR). SKILSKUL: 2201280064 (SPV SKILSKUL).
**Lubang lead (O26):** Ads dan Finance tidak punya satu pun jabatan lead-pattern; "CREATOR MANAGER" (11 org, MCN) dan "ACCOUNT MANAGER" (2 org, Account) kemungkinan besar IC = `staff`, bukan lead — konfirmasi.

**Status per departemen setelah validasi:** siap seed begitu lead dikonfirmasi: SALES, ACCOUNT, CREATIVE, ADVERTISER→Ads, MCN→KOL, FINANCE AND ACCOUNTING→Finance (114 karyawan). Usul tanpa akses (tinggal konfirmasi): IT (25), HRGA (8), SKILSKUL (3). Butuh keputusan (O24/O25): BUSINESS DEVELOPMENT, TIKTOK GO, DATA & BI, GROWTH & BUSINESS CONSULTATION, CREATIVE - EKSTERNAL, AFFILIATE, OD.

Open item terkait: **O24** (tabrakan istilah OD), **O25** (7 dept belum terpetakan), **O26** (lead per divisi) di `docs/DECISIONS.md`.

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
| CREATIVE - EKSTERNAL | Creative *(tentatif)* | staff (kecuali jabatan lead-pattern) | **[KONFIRMASI]** Apakah "eksternal" berarti freelance/vendor yang **tidak** perlu akun CDPS sama sekali (mirip vendor Live Stream di M10, yang eksplisit *tanpa akses* per PRD)? Kalau mereka tetap PIC internal untuk Asset/Brief di CDPS, map ke Creative staff; kalau murni eksternal tanpa login, jangan disync sebagai user aktif. |
| ADVERTISER | Ads | staff/lead sesuai jabatan | Nama departemen ≠ nama divisi CDPS ("Ads") — **[KONFIRMASI]** penamaan ini yang dimaksud tim Ads (M8) dan bukan istilah lain (mis. akun iklan klien). |
| MCN | KOL | staff/lead sesuai jabatan | Multi-Channel-Network erat dengan pengelolaan KOL/influencer (M9). **[KONFIRMASI]** apakah MCN memang setara KOL divisi CDPS atau unit terpisah (mis. hubungan platform, bukan eksekusi brief KOL). |
| AFFILIATE | *(belum dipetakan)* | — | **[KONFIRMASI]** Affiliate marketing bisa dekat dengan KOL (kerja sama afiliasi/influencer) atau Ads (performance marketing) — tidak ada modul CDPS khusus "Affiliate". Butuh arahan OD: gabung ke KOL, gabung ke Ads, atau divisi baru. |
| BUSINESS DEVELOPMENT | Sales *(tentatif)* | staff/lead sesuai jabatan | **[KONFIRMASI]** BD sering pre-sales/partnership — perlu dipastikan apakah stafnya benar-benar bekerja dalam alur M0 (lead → closing) atau di luar cakupan modul saat ini (mis. kemitraan, bukan closing klien). |
| GROWTH & BUSINESS CONSULTATION | *(belum dipetakan)* | — | **[KONFIRMASI]** Tidak ada modul CDPS yang jelas mencakup ini. Perlu tahu ruang lingkup kerja tim ini (konsultasi ke klien existing → mungkin dekat Account; growth internal → mungkin di luar CDPS sepenuhnya) sebelum diusulkan sebagai divisi. |
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

- ~~Sheet asli (`hris_karyawan.csv`/`.xlsx`) di-commit ke `backend/testdata/import_samples/` atau konektor Google Drive diaktifkan~~ **✅ selesai 2026-07-11 — sheet terbaca via konektor Google Drive, `--pairs` sudah dijalankan (lihat §0).**
- Jawaban OD/Nerissa untuk setiap **[KONFIRMASI]** di §3 yang belum terjawab data (lihat §0; item resmi: O24/O25/O26 di `DECISIONS.md`).
- Daftar `jabatan` riil per divisi yang sudah bermodul (Sales/Account/Creative/Ads/KOL/Finance), untuk melengkapi heuristik lead/staff dengan tabel eksplisit seperti `roleMappings` di `seed.go`.
- Daftar employee_id kandidat layered role **OD** dan **Director** (bukan by-departemen — by-orang, sama pola `directors` di `seed.go`).

**Jangan seed tabel `role_mappings` dari draft ini sebelum baris di §3 divalidasi OD/Nerissa.**
