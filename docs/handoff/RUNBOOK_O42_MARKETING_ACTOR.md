# RUNBOOK — O42: menghidupkan divisi `Marketing` di produksi

> Prasyarat: **O44(b) sudah ter-merge** (6 route admin diport). Sebelum itu kedua halaman admin
> mati dan satu-satunya jalur adalah SQL manual.
>
> Status: ✅ **SELESAI DIEKSEKUSI ke `CDPS SG` 2026-07-29** — §2 (impor NIKEN) dan §3 (baris mapping
> `BUSINESS DEVELOPMENT`×`MARKETING STRATEGIST` → `Marketing`/`staff`) sudah ter-apply, §4 diverifikasi
> lulus di live. Hasil persisnya di **§7**; entri `DECISIONS` 2026-07-29 memuat rekonsiliasi lengkap.
> Runbook ini kini **catatan sejarah + prosedur untuk pemetaan divisi berikutnya**, bukan pekerjaan
> tertunda. Rantainya lebih dulu diverifikasi ujung-ke-ujung di Postgres lokal termigrasi dengan data
> NIKEN riil — 11/11 PASS, §6.
>
> **Masih terbuka (tidak diblokir oleh apa pun di sini):** `Marketing`/`lead` kosong (§3) dan
> O42 pertanyaan (3) rekonsiliasi `role_mappings` (§5).

## 0. Kenapa urutannya tidak boleh dibalik

Pemilik mengonfirmasi **(B)**: NIKEN belum ter-sync ke `public.employees`. Karena
`campaign.validateOwnerCandidate` mewajibkan kandidat **aktif** DAN ber-`division='Marketing'`
DAN `level='staff'`, membuat baris mapping lebih dulu hanya menghasilkan **baris yatim**:

| Urutan | Hasil |
|---|---|
| mapping dulu, impor kemudian | mapping tidak menunjuk siapa pun; **M3-OA-6 tetap mati**; O42 *terlihat* selesai padahal tidak |
| **impor dulu, mapping kemudian** ✅ | claims ter-resolve, M3-OA-6 hidup, arm `0009` jadi bisa diuji |

Mapping ber-grain **divisi×jabatan** (`uq_role_mapping`), jadi **satu baris tidak mengangkat jabatan
lain**. Karena itu §1 mengumpulkan daftar jabatan **lengkap** sebelum menulis apa pun.

## 1. Ambil daftar yang sebenarnya perlu dibuat (read-only)

```sql
-- 1a. Siapa saja karyawan aktif di bawah divisi Marketing/BD di HRIS?
SELECT employee_id, nama, divisi, jabatan, status_aktif
FROM public.employees
WHERE divisi ILIKE '%BUSINESS DEVELOPMENT%' OR divisi ILIKE '%MARKETING%'
ORDER BY divisi, jabatan;

-- 1b. Pasangan divisi×jabatan AKTIF yang belum punya mapping.
--     Ini daftar baris mapping yang benar-benar perlu dibuat.
SELECT e.divisi, e.jabatan, count(*) AS karyawan_aktif
FROM public.employees e
LEFT JOIN public.role_mappings m
       ON m.divisi = e.divisi AND m.jabatan = e.jabatan
WHERE e.status_aktif AND m.id IS NULL
GROUP BY 1, 2
ORDER BY 1, 2;
```

Hasil **1b** sekaligus menguji ulang klaim audit `3818d4a` (*"7 karyawan sengaja tanpa mapping"*):
kalau yang keluar **bukan** tepat ketujuh pemegang `employee_layered_roles`, audit itu perlu
dikoreksi.

## 2. Impor karyawan — lewat UI (bukan SQL)

Halaman **Karyawan** (`/admin/employees`, Director-only untuk aksi impor) sekarang punya kotak
**Impor CSV**. Sumber karyawan = **CSV admin**, bukan pull HRIS (**OQ-4**).

Format header wajib:

```csv
employee_id,nama,email,divisi,jabatan,status_aktif
2504240539,NIKEN SEPTA ARISANDHY,arisandhyyy@gmail.com,BUSINESS DEVELOPMENT,MARKETING STRATEGIST,true
```

Catatan:

- **Idempoten** — menjalankan ulang dengan data sama tidak menduplikasi.
- Kolom `password` opsional (kolom ke-7). Bila kosong, kredensial dibuat dengan password sementara
  default + `must_change_password=true`. **Untuk impor riil, isi password per baris.**
- Centang **"Impor penuh"** HANYA bila CSV memuat SELURUH roster: karyawan yang ada di CDPS tapi
  tidak ada di CSV akan **ditandai untuk review** (tidak pernah dihapus). Untuk menambah satu orang,
  **jangan** dicentang.
- Satu transaksi: sync `employees` → provision kredensial → link GoTrue. Gagal di tengah = rollback penuh.

## 3. Buat baris mapping — lewat UI

Halaman **Role Mapping** (`/admin/role-mappings`, Director-only untuk tulis). Untuk setiap pasangan
dari §1b yang memang divisi Marketing:

| divisi (HRIS) | jabatan (HRIS) | division (CDPS) | level |
|---|---|---|---|
| `BUSINESS DEVELOPMENT` | `MARKETING STRATEGIST` | `Marketing` | `staff` |

> **Marketing `lead` masih kosong.** Arm Marketing-lead di `leads.leadListScope` dan
> `campaign.canReassign` butuh pemegang `level='lead'`. Tetapkan `lead` HANYA bila ada jabatan kepala
> BD/Marketing yang **aktif** — jangan mengarang jabatan. Selama kosong, **reassign owner Campaign
> tetap hanya bisa oleh Director**.

Setiap tulis di sini **meng-ulang-terbitkan claims** untuk SEMUA karyawan ber-divisi+jabatan itu
(trigger `trg_sync_claims_mapping`), berlaku pada penerbitan/refresh token berikutnya.

## 4. Verifikasi (read-only)

```sql
-- 4a. Claims ter-resolve?
SELECT public.employee_claims('2504240539');
-- harus memuat: "division": "Marketing", "level": "staff"

-- 4b. Predikat owner-candidate M3-OA-6 menerima dia?
SELECT e.employee_id, e.status_aktif, rm.division, rm.level
FROM public.employees e
LEFT JOIN public.role_mappings rm
       ON rm.divisi = e.divisi AND rm.jabatan = e.jabatan
WHERE e.employee_id = '2504240539';
-- harus: status_aktif = true, division = 'Marketing', level = 'staff'

-- 4c. Sudah ada aktor untuk arm own-campaign migrasi 0009?
SELECT count(*) AS marketing_staff_aktif
FROM public.employees e
JOIN public.role_mappings rm
     ON rm.divisi = e.divisi AND rm.jabatan = e.jabatan
WHERE e.status_aktif AND rm.division = 'Marketing' AND rm.level = 'staff';
-- >= 1 ⇒ arm 0009 akhirnya bisa diuji (sebelumnya aktornya tak bisa ada)
```

Lalu QA di UI sebagai Director: buka **Campaign**, jalankan **reassign owner** (M3 §5 Rule 1 /
M3-OA-6) dan pastikan kandidat Marketing/staff kini muncul, bukan `NotFoundError`.

## 5. Yang TIDAK ditutup oleh runbook ini

- **O42 pertanyaan (3)** — rekonsiliasi `role_mappings` **38** (live) vs **23**
  (`backend/seed/role_mappings_riil.csv`) vs **12** (`supabase/seed.sql`): mana sumber kebenaran.
  Masih keputusan pemilik.
- **Marketing `lead`** — lihat peringatan §3.
- Arm `0009` baru **bisa diuji**, belum **teruji**: masih butuh satu campaign nyata.

## 6. Bukti rantai (Postgres lokal termigrasi, 2026-07-29)

Dijalankan dengan data NIKEN yang riil melalui jalur kode yang sama dengan UI
(`employees.importEmployees` + `admin.upsertRoleMapping`). **11/11 PASS:**

```
PASS  BEFORE: NIKEN absent from employees (the (B) diagnosis)
PASS  BEFORE: zero mappings resolve to division='Marketing' — n=0
PASS  1. import synced exactly 1 employee — {"synced":1,...}
PASS  1. NIKEN now present and active — NIKEN SEPTA ARISANDHY / BUSINESS DEVELOPMENT / MARKETING STRATEGIST
PASS  2. mapping created (not an orphan row)
PASS  3. employee_claims -> division=Marketing
PASS  3. employee_claims -> level=staff
PASS  4. validateOwnerCandidate predicate accepts NIKEN (M3-OA-6 revives)
PASS  5. campaign.canCreate(NIKEN) is true
PASS  5. campaign.canReassign(NIKEN) still FALSE (staff, not lead — unchanged)
PASS  6. >=1 active Marketing/staff actor exists (0009 arm testable)
```

Yang dibuktikan bukan hanya "berhasil", tapi juga **batasnya**: `canReassign` tetap `false` untuk
staff, jadi menghidupkan Marketing/staff **tidak** diam-diam memberi wewenang reassign — itu tetap
milik lead/Director, persis seperti M3 §6.1.

## 7. Hasil eksekusi live (`CDPS SG`, 2026-07-29)

Dua tulis, urutan §0 dipatuhi. Nol SQL ad-hoc: impor lewat `employees.importEmployees` (jalur kode
yang sama dengan UI), mapping lewat baris `role_mappings` sesuai tabel §3.

| Langkah | Hasil di live |
|---|---|
| §2 impor | `2504240539` NIKEN SEPTA ARISANDHY · `BUSINESS DEVELOPMENT` / `MARKETING STRATEGIST` · `status_aktif=true` · `auth_user_id` terisi · `must_change_password=true` · audit `employee_credential/password_set_admin` (`audit_log id=42`) |
| §3 mapping | `role_mappings id=40` — `BUSINESS DEVELOPMENT`×`MARKETING STRATEGIST` → `Marketing`/`staff` (**persis** tabel §3) |
| §4a claims | `{"division":"Marketing","level":"staff","od":false,"director":false}` ✅ |
| §4b predikat owner | `status_aktif=true` + `division='Marketing'` + `level='staff'` ⇒ M3-OA-6 menerima ✅ |
| §4c aktor arm `0009` | `marketing_staff_aktif` **0 → 1** ⇒ arm own-campaign akhirnya **bisa** diuji ✅ |

**Rekonsiliasi (tidak ada efek samping):** `employees`/`employee_credentials`/`auth.users`/
`auth.identities` = **69/69/69/69** (bergerak bersama ⇒ nol karyawan tanpa jalur login) ·
`role_mappings` 38 → **39** · `flagged_for_review` **0** ("Impor penuh" **tidak** dicentang — kalau
tercentang, 68 karyawan lain akan tertandai) · `auth.refresh_tokens` tetap **2** (sesi hidup utuh) ·
`master_services` **32** · 53 tabel · 39 migrasi.

**Klaim audit `3818d4a` diuji ulang seperti diminta §1 — BERTAHAN:** `aktif_tanpa_mapping` tetap **7**,
dan **7/7** memang pemegang `employee_layered_roles` (3 Director + 4 OD), NIKEN sudah tidak termasuk.
Jadi tidak ada koreksi audit yang perlu ditulis.

### Yang masih belum tertutup sesudah eksekusi

- **`Marketing`/`lead` = 0.** Reassign owner Campaign di produksi **tetap hanya Director**; arm
  Marketing-lead `leads.leadListScope` tetap mati. Konsekuensi struktur organisasi, dicatat sebagai
  keputusan sadar di `DECISIONS` — bukan bug, dan jabatan tidak dikarang untuk mengisinya.
- **Arm `0009` baru *bisa* diuji, belum *teruji*** — masih butuh satu campaign nyata (§5).
- **Orang eksekutor ads** — tetap pertanyaan pemilik, tapi **tidak terhalang**: grain mapping
  divisi×**jabatan**, jadi baris `MARKETING STRATEGIST` di atas tidak mengangkat jabatan lain di bawah
  `BUSINESS DEVELOPMENT`. Ia bisa dipetakan ke `Ads` tanpa menyentuh baris ini.
