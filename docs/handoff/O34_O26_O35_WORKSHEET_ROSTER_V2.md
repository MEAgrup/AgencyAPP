# Worksheet aktor produksi — roster HR **V2** (O26 · O34 · O35)

> **Disusun 2026-07-30** dari sheet *"Copy of Data Karyawan V2"* yang diberikan pemilik
> (68 karyawan + 2 Director). **Sheet itu SENGAJA tidak disalin ke repo** — keputusan retensi PII
> 2026-07-30 (`docs/DECISIONS.md`) baru saja mengeluarkan roster PII dari repo, dan menariknya
> kembali lewat pintu lain akan membatalkan keputusan itu. Dokumen ini hanya memuat
> **pasangan `DEPARTMENT,JABATAN`** (bukan nama, bukan NIK, bukan email) — yaitu satu-satunya
> bagian yang dibutuhkan untuk memutuskan role mapping.
>
> Data karyawannya sendiri masuk ke live lewat **`POST /api/v1/admin/employee-import`**
> (Director-only, satu transaksi: sync `employees` → provision credentials → link GoTrue),
> dengan berkas yang Anda unduh dari sheet saat itu. Bukan lewat repo.

---

## 1. Apa yang roster V2 JAWAB, dan apa yang tidak

| Butir | Status | Catatan |
|---|---|---|
| **O26** — NIK + email Director | 🟢 **TERJAWAB** | Yohan `200000001` · Nerissa `200000002`, keduanya `Director/Director`. Layered role sudah masuk `supabase/seed/layered_roles_riil.csv`. **Sisa satu keputusan kecil** — §3.1 |
| **O34 (a)–(c), (e)** — lead KOL · lead Creative · SPV Ads · lead Marketing/BD | 🟡 **SEBAGIAN** | Orangnya ada; **penanda lead/SPV-nya tidak ada** untuk Ads, Marketing, dan KOL. Creative punya kandidat (`LEADER VIDEOGRAPHER`) — §3.2 |
| **O34 (d)** — staf Live-Stream | 🔴 **TIDAK ADA di roster** | Nol jabatan Live-Stream/LS di 68 baris. Konsisten dengan M10 = **vendor**, jadi kemungkinan besar ini bukan gap tapi jawaban: tidak ada staf internal LS. **Perlu konfirmasi**, karena "tidak ada" dan "belum diisi" tidak bisa dibedakan dari sheet — §3.3 |
| **O35** — sub-tim Creative Video/Graphic | 🔴 **BELUM TERJAWAB** | Roster justru memperkuat pertanyaannya: ada `LEADER VIDEOGRAPHER` tapi **nol** pemimpin sisi Graphic, padahal `GRAPHIC DESIGNER` ada — §3.4 |
| **O9** — target periode M14 | 🔴 **BELUM TERJAWAB** | Tidak ada di sheet mana pun; ini angka target, bukan data karyawan. Non-blocking (`is_placeholder`) |

---

## 2. 🔴 Temuan baru: 29 pasangan `DEPARTMENT,JABATAN` di V2 belum punya mapping kanonik

`supabase/seed/role_mappings_riil.csv` memuat **23** mapping (batch-1, 2026-07-17). Roster V2 memuat
**49** pasangan berbeda ⇒ **29 belum terpetakan**. Live `CDPS SG` sendiri sudah punya **39**
`role_mappings` (sesudah O42), jadi **live lebih maju daripada CSV di repo** — jangan regenerasi CSV
ini dari nol, tambahkan saja.

### 2.1 Bisa diturunkan dari pola yang SUDAH diputus (aman, tinggal di-acc)

Pola `HEAD OF` / `LEADER` / `SENIOR …` yang sudah dipakai batch-1 dan O33:

| DEPARTMENT | JABATAN | Usul → divisi/level | Dasar |
|---|---|---|---|
| CREATIVE | `LEADER VIDEOGRAPHER` | `Creative` / **lead** | pola `LEADER …` = lead (preseden `ACCOUNT,LEADER CUSTOMER RELATIONS OFFICER`) |
| CREATIVE | `SOCIAL MEDIA OFFICER` | `Creative` / staff | — |
| CREATIVE | `CONTENT CREATOR` | `Creative` / staff | — |
| CREATIVE | `VIDEOGRAPHER FREELANCE` | `Creative` / staff | ⚠️ freelance — cek §3.5 |
| CREATIVE | `ADMIN SOCIAL MEDIA INTERN` | `Creative` / staff | — |
| ACCOUNT | `ACCOUNT MANAGER` | `Account` / staff | AM = peran inti M4/M5, level staff |
| ACCOUNT | `ADMIN A&S` | `Account` / staff | — |
| SALES | `SALES ASSISTANT` | `Sales` / staff | — |
| FINANCE AND ACCOUNTING | `FINANCE AND ACCOUNTING` | `Finance` / staff | O33 Decided 2026-07-29 |
| FINANCE AND ACCOUNTING | `SENIOR FINANCE, ACCOUNTING & TAX` | `Finance` / **lead** | O33 Decided 2026-07-29 (eksplisit) |
| FINANCE AND ACCOUNTING | `ACCOUNTING INTERN` | `Finance` / staff | — |
| ADVERTISER | `ADVERTISER INTERN` | `Ads` / staff | pola `ADVERTISER,*` = `Ads` |
| Marketing | `SEO CONTENT WRITER` | `Marketing` / staff | dept berubah `BUSINESS DEVELOPMENT` → `Marketing`; mapping lama perlu **ditambah**, bukan diganti (§3.6) |
| Marketing | `PUBLIC RELATION` | `Marketing` / staff | idem |
| Marketing | `CONTENT CREATOR (PERSONAL BRANDING)` | `Marketing` / staff | — |
| Marketing | `MARKETING STRATEGIST` | `Marketing` / staff **atau lead** | ⚠️ §3.2 — ini satu-satunya kandidat lead Marketing |
| Marketing | `BUSINESS DEVELOPMENT INTERN` | `Marketing` / staff | — |

### 2.2 🔴 TIDAK bisa diturunkan — butuh keputusan Anda

**Empat pasangan di mana DEPARTMENT (HR) dan JABATAN (pekerjaan) menunjuk divisi CDPS berbeda.**
Ini bukan kerapian: `role_mappings` menentukan `division` di klaim JWT, dan **klaim itulah yang
dipakai RLS** untuk memutuskan siapa melihat apa. Salah petakan = orang melihat papan divisi yang
salah, atau tidak melihat papannya sendiri.

| DEPARTMENT | JABATAN | Pilihan | Kenapa tidak bisa saya putuskan |
|---|---|---|---|
| ACCOUNT | `KOL SPECIALIST` (×2) | `Account`/staff **atau** `KOL`/staff | **`KOL` adalah divisi CDPS** (M9). Orangnya duduk di dept ACCOUNT tapi pekerjaannya KOL. Kalau dipetakan ke `Account`, mereka tidak melihat papan KOL-nya sendiri |
| ACCOUNT | `INTERN KOL` (×2) | idem | idem |
| ACCOUNT | `ADVERTISER` (×2) | `Account`/staff **atau** `Ads`/staff | `Ads` divisi CDPS (M8). Sama polanya |
| ACCOUNT | `ADVERTISER INTERN` | idem | idem |
| SALES | `CONTENT CREATOR` | `Sales`/staff **atau** `Creative`/staff | jabatan creative di dept sales |

**Tiga DEPARTMENT yang bukan divisi CDPS sama sekali** — mereka butuh keputusan "dipetakan ke apa,
atau tidak dipetakan (tanpa akses papan divisi)":

| DEPARTMENT | JABATAN | Catatan |
|---|---|---|
| HRGA | `SUPERVISOR HR` | pemegangnya sudah punya layered role **`od`** (`2409230432`), jadi ia sudah bisa baca-semua lewat OD. Mapping divisi dasarnya tetap perlu diputus |
| OD | `SENIOR ORGANIZATION DEVELOPMENT` · `SENIOR DATA ANALYST` · `JR ORGANIZATION DEVELOPMENT` (×3 orang) | `OD` adalah **layered role**, bukan divisi. Perlu: siapa dari ketiganya yang dapat layered `od`, dan divisi dasarnya apa |
| DATA & BUSINESS INTELLIGENCE | `DATA ANALYST INTERN` | tidak ada divisi CDPS padanannya |

---

## 3. Pertanyaan yang harus dijawab — daftar tertutup

### 3.1 O26 — divisi dasar akun Director
Yohan & Nerissa ber-`DEPARTMENT,JABATAN` = `Director,Director`, tapi **`Director` bukan divisi** —
ia layered role di atas akun biasa (`CLAUDE.md` §6). Layered role-nya sudah di-seed. Yang belum:
`role_mappings` butuh baris `Director,Director → <divisi>,<level>`.
**Pilihan:** (a) petakan ke divisi mana pun yang wajar (mis. `Sales`/`lead`) — tidak berpengaruh
karena layered `director` sudah memberi akses penuh; (b) buat mapping eksplisit yang menandakan
"tanpa divisi operasional". **Rekomendasi: (a)** — paling sedikit permukaan baru, dan `director`
sudah menang di setiap gate.

### 3.2 O34 — siapa **lead** untuk Ads, Marketing, dan KOL?
Roster tidak punya `HEAD OF`/`LEADER`/`SUPERVISOR` untuk ketiganya:
- **Ads:** kandidat `SENIOR ADVERTISER` (×2 orang). Batch-1 memetakan `SENIOR ADVERTISER → Ads/staff`
  (bukan lead). Siapa SPV Ads?
- **Marketing:** kandidat tunggal `MARKETING STRATEGIST`. Lead atau staff?
- **KOL:** kandidat `KOL SPECIALIST` (×2) — tapi hanya relevan kalau §2.2 diputus ke divisi `KOL`.

Tanpa lead per divisi, **arm "Lead/SPV = division-wide" yang baru saja dipasang O46 tidak punya
pemegang** di ketiga divisi itu — policy-nya ada, tapi nol orang memenuhinya.

### 3.3 O34 (d) — konfirmasi: memang tidak ada staf Live-Stream internal?
Nol jabatan LS di roster. M10 adalah **Live-Stream vendor**, jadi ini masuk akal sebagai jawaban
"tidak ada, dan tidak perlu ada". **Butuh satu kalimat konfirmasi** — supaya butir O34 (d) bisa
ditutup sebagai *"nihil by design"* alih-alih menggantung sebagai *"belum diisi"*.

### 3.4 O35 — model sub-tim Creative
Roster memperkuat pertanyaannya, bukan menjawabnya: ada `LEADER VIDEOGRAPHER` (sisi Video) tapi
**nol** pemimpin sisi Graphic, padahal `GRAPHIC DESIGNER` ada. Kalau Creative dipecah Video/Graphic
(M7 §3), `LEADER VIDEOGRAPHER` memimpin **Video saja** dan Graphic tanpa lead. Kalau tidak dipecah,
ia lead seluruh Creative. Keduanya konsisten dengan roster — datanya tidak memutuskan.

### 3.5 `VIDEOGRAPHER FREELANCE` — karyawan CDPS atau vendor?
Kalau freelance diperlakukan seperti karyawan (punya akun, mengerjakan task), ia butuh mapping.
Kalau ia vendor, ia **tidak** boleh masuk `employees`. Preseden: batch-1 sengaja mengeluarkan
5 `CREATIVE - EKSTERNAL` dari 39 roster.

### 3.6 `BUSINESS DEVELOPMENT` → `Marketing`: tambah atau ganti?
V2 memindahkan orang-orang BD ke `DEPARTMENT = Marketing`. Mapping lama
(`BUSINESS DEVELOPMENT,PUBLIC RELATION` dan `…,SEO CONTENT WRITER`) jadi tidak punya pemegang.
**Rekomendasi: TAMBAH baris `Marketing,…`, JANGAN hapus baris `BUSINESS DEVELOPMENT,…`** — mapping
adalah tabel lookup, baris tanpa pemegang tidak berbahaya, sedangkan menghapusnya membuat re-import
roster lama gagal senyap.

---

## 4. Cara mengeksekusinya sesudah dijawab

1. Baris mapping yang di-acc masuk `supabase/seed/role_mappings_riil.csv` (**tambah**, jangan tulis
   ulang — live sudah 39 baris).
2. Seed ke live: `npm run rolemap:seed -w @cdps/api -- --apply` (dry-run default, idempoten) —
   atau lewat halaman admin role-mapping.
3. Karyawan: unduh sheet → `POST /api/v1/admin/employee-import` (Director-only). **Berkasnya tidak
   di-commit** (retensi PII 2026-07-30).
4. Verifikasi klaim JWT ikut merambat: `trg_sync_claims_mapping` (preseden verifikasi O33 2026-07-29).
5. Cek DoD C-04 *"nol fixture UAT di jalur produksi"* — fixture `UAT*` era Go sudah tidak ada di repo,
   tapi **kalau live masih memuatnya**, itu yang harus dibersihkan.

---

## 5. Verifikasi terhadap LIVE — 2026-07-30 (ditambahkan sesudah O46 terbukti menyala)

Worksheet di atas disusun dari **sheet HR**. Bagian ini mengukur akibatnya di **live `CDPS SG`**,
karena sheet dan live bisa berbeda — dan pertanyaan §3.2 baru punya bobot kalau akibatnya terukur.

| Divisi CDPS | Karyawan di live | Pemegang `level=lead` |
|---|---|---|
| Account | 15 | 3 |
| Sales | 15 | 2 |
| Creative | 11 | 1 |
| Finance | 4 | 1 |
| **Ads** | **11** | 🔴 **0** |
| **KOL** | **5** | 🔴 **0** |
| **Marketing** | **1** | 🔴 **0** |
| **(tidak terpetakan)** | **7** | 🔴 **0** |
| | **69** | **7** |

```sql
select coalesce(nullif(public.employee_claims(e.employee_id)->>'division',''),'(TIDAK TERPETAKAN)'),
       count(*), count(*) filter (where public.employee_claims(e.employee_id)->>'level'='lead')
from public.employees e group by 1 order by 1;
```

**Yang dikonfirmasi angka ini:**

1. **§3.2 terbukti, dan skalanya 27 orang.** Ads (11) + KOL (5) + Marketing (1) = **17 karyawan** di
   divisi tanpa satu pun pemegang lead, plus **7** yang tidak terpetakan sama sekali = **24 dari 69**.
   Untuk mereka, arm *"Lead/SPV = division-wide"* yang dipasang O46 **ada di policy tapi nol
   pemegang** — fitur yang tidak bisa diamati bekerja maupun rusak.
2. **7 karyawan "tidak terpetakan" adalah orang yang sama** yang membuat guard `jwt_division() <> ''`
   di `20260730120433` menjadi *load-bearing*. Selama §2.2 dan §3 belum dijawab, ketujuhnya tidak
   mendapat scope divisi apa pun — arahnya aman (lebih sempit), tapi disebut di sini supaya tidak
   ditemukan lagi sebagai kejutan.
3. **`role_mappings` live = 39 baris, 5 di antaranya `level=lead`, 6 divisi.** Konsisten dengan §2
   ("live lebih maju daripada CSV repo — tambahkan, jangan regenerasi").

> **Konsekuensi urutan, dan ini mengikat:** **A4 mendahului O48.** Menyapu arm divisi ke 32 policy
> (`O48_ANALISIS_KEPUTUSAN.md`) sebelum Ads/KOL/Marketing punya pemegang lead menghasilkan migrasi
> yang **tidak bisa dibuktikan bekerja** di tiga divisi itu — persis kelas kesalahan O46, di mana
> policy yang benar terlihat selesai karena tidak ada yang bisa memicunya.

---

## 6. ✅ §3.2 DITUTUP 2026-07-30 — dan mekanismenya bukan `role_mappings`

Pemilik menunjuk: **Ads `2307100292`** · **KOL `2602190630`** · **Marketing `2504240539`**.

**`role_mappings` tidak bisa dipakai untuk ini.** Ia berkunci `UNIQUE (divisi, jabatan)` dan
`employee_claims` menurunkan `level` HANYA dari sana, jadi level melekat pada **jabatan**, bukan
orang. Diukur di live:

| employee_id | jabatan | pemegang jabatan yang sama |
|---|---|---|
| `2307100292` | `SENIOR ADVERTISER` | **3** |
| `2602190630` | `KOL SPECIALIST` | **3** |
| `2504240539` | `MARKETING STRATEGIST` | 1 |

Memetakan jabatannya ke `lead` akan menaikkan **3 orang** di Ads dan **3** di KOL — dua di antaranya
bukan lead, dan itu tidak akan terlihat: mereka sekadar mulai melihat data se-divisi.

**Mengganti `employees.jabatan` juga bukan jalannya:** `employees` disinkronkan **read-only dari
HRIS**, jadi sinkronisasi berikutnya mengembalikan jabatannya dan **mencabut kepemimpinannya secara
senyap**.

**Jalur yang dipakai: layered role `lead`** (migrasi `20260730154210`) — CDPS-lokal (kebal sinkron
HRIS), per-orang, dan sudah punya trigger perambatan klaim. Persis cara `od`/`director` bekerja.

### Hasil terverifikasi di live

| Divisi | Karyawan | Pemegang lead |
|---|---|---|
| Account | 15 | 3 |
| Sales | 15 | 2 |
| Creative | 11 | 1 |
| Finance | 4 | 1 |
| **Ads** | 11 | ✅ **1** |
| **KOL** | 5 | ✅ **1** |
| **Marketing** | 1 | ✅ **1** |
| (tidak terpetakan) | 7 | 0 |

**4 rekan sejabatan tetap `staff`** — nol kenaikan kolateral. Probe klaim **tersimpan** (bukan
karangan) untuk `2307100292`: `division=Ads` · `jwt_is_lead()=true` · `jwt_same_division(rekan
Ads)=true` · `jwt_same_division(Sales)=false`.

> ⚠️ **Angka di tabel ini masih memuat 10 akun fixture `99000000xx`** — lihat **O50** di
> `DECISIONS.md`. Headcount riil ≈ **59 + 10 fixture**, dan dua fixture (`9900000009`,
> `9900000010`) ikut terhitung sebagai "rekan sejabatan" di verifikasi di atas.

**Yang MASIH terbuka dari worksheet ini:** §2.2 (4 pasangan DEPARTMENT/JABATAN ambigu) · §3.1 divisi
dasar Director · §3.3 konfirmasi staf Live-Stream nihil · §3.4 **O35** sub-tim Creative · §3.5
`VIDEOGRAPHER FREELANCE` · §3.6 BD→Marketing · **7 karyawan tidak terpetakan**.
