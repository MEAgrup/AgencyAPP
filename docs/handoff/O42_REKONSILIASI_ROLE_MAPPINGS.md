# O42 pertanyaan (3) — rekonsiliasi `role_mappings`: detail yang perlu dicek

> Dibuat 2026-08-08 atas permintaan pemilik: *"berikan saya detail yg perlu di cek"*.
>
> **Ini bukan keputusan yang bisa saya ambil**, dan alasannya bukan formalitas:
> `role_mappings` adalah satu-satunya tabel yang menerjemahkan jabatan HRIS →
> peran CDPS, jadi ia menentukan **seluruh permission** (`jwt_division`,
> `jwt_is_lead`, RLS setiap tabel) **dan seluruh perutean notifikasi**
> (`notify_emit` mencari lead lewat tabel ini). Salah pilih sumber kebenaran =
> orang melihat data yang bukan haknya, atau tidak diberi tahu saat harus.

## 1. Temuan terpenting — ketiga angka BUKAN tiga versi dari satu daftar

Ini yang harus dilihat lebih dulu, karena ia mengubah bentuk pertanyaannya.
`38 vs 23 vs 12` terbaca seolah satu daftar yang tiga kali disalin dengan
kelengkapan berbeda. **Bukan.** Dua di antaranya memakai **kunci join yang
berbeda**, dan karena itu tidak saling menimpa — mereka hidup di dua dunia.

| Sumber | Baris | Bentuk kunci (`divisi` / `jabatan`) | Contoh |
|---|---|---|---|
| **A** `supabase/seed.sql` | **12** | **Title Case**, kosakata karangan CDPS | `Sales` / `Sales Executive` |
| **B** `supabase/seed/role_mappings_riil.csv` | **23** | **UPPERCASE**, string HRIS asli | `SALES` / `SALES JASA` |
| **C** live `CDPS SG` tabel `role_mappings` | **38** (→ 39 sesudah runbook O42 §5 menambah id=40) | **UPPERCASE** (kelompok B + tambahan) | `BUSINESS DEVELOPMENT` / `MARKETING STRATEGIST` |

Join-nya **exact match dan case-sensitive** di kedua pemakai:

```sql
-- private.employee_role (O51) dan notify_emit memakai bentuk yang sama:
from employees e join role_mappings rm
  on rm.divisi = e.divisi and rm.jabatan = e.jabatan
```

Postgres `=` atas `text` peka huruf besar-kecil, jadi **A dan B beririsan NOL
baris**. `('Sales','Sales Executive')` tidak pernah cocok dengan
`('SALES','SALES')`.

**Konsekuensinya:** A bukan "versi kurang lengkap" dari C. A adalah **fixture
test**, dan ia cocok karena 10 karyawan seed juga ditulis Title Case:

```
Sales / Sales Executive        ← employees seed
Account / Account Manager
Creative / Creative Designer
Ads / Ads Specialist
KOL / KOL Specialist
Sales / Sales Head
Finance / Finance Staff
Management / Director   ×3     ← sengaja TANPA mapping (lihat §3)
```

Jadi pertanyaan sebenarnya **bukan** "mana yang paling lengkap", melainkan:

> **Apakah `employees` produksi diisi dengan string HRIS mentah (UPPERCASE)?**

Kalau ya, hanya B/C yang relevan untuk produksi dan A tetap fixture selamanya.
Kalau `employees` produksi dinormalisasi ke Title Case saat sync, maka C yang
salah bentuk dan 38 baris itu tidak pernah cocok dengan siapa pun.

## 2. Yang perlu dicek — urut, dan tiap langkah menjawab satu hal

Jalankan **di live `CDPS SG`** (saya tidak menjalankannya: kueri live ditolak di
sesi ini, dan §1 di atas disimpulkan dari repo + DB lokal, bukan dari live).

### Cek 1 — bentuk kunci di `employees` live. Ini penentu utama.

```sql
select divisi, jabatan, count(*) as n
  from employees group by 1,2 order by 1,2;
```

Yang dicari: **UPPERCASE atau Title Case?** Kalau campur, itu temuan sendiri —
berarti sync HRIS tidak konsisten dan tidak ada satu pun daftar mapping yang
bisa benar sampai normalisasinya diputuskan.

### Cek 2 — berapa karyawan aktif yang JATUH dari join (paling berdampak)

```sql
select e.employee_id, e.divisi, e.jabatan, e.status_aktif
  from employees e
  left join role_mappings rm
    on rm.divisi = e.divisi and rm.jabatan = e.jabatan
 where rm.divisi is null and e.status_aktif = true
 order by e.divisi, e.jabatan;
```

Runbook O42 §5 melaporkan angka ini **7** dan klaim audit `3818d4a`
(*"7 karyawan sengaja tanpa mapping"*) **bertahan** saat diuji ulang. Yang perlu
mata pemilik: **apakah ketujuhnya memang sengaja.** Karena INNER JOIN
dipertahankan di `private.employee_role` (keputusan O51, dan itu benar),
karyawan tanpa mapping berarti:

- `GET /portal/me` → **404** untuk orang itu (nol baris, bukan `('','')`);
- ia **tidak pernah** ikut ter-resolve sebagai lead oleh `notify_emit`, jadi
  setiap event ber-resolver `leadsOfDivision`/`explicitOrLeads` untuk divisinya
  **hilang tanpa jejak** — tidak error, hanya nol penerima.

Tiga dari tujuh sudah diketahui sengaja: `Management / Director` ×3 (Director
adalah **layered role** di `employee_layered_roles`, bukan lead divisi — itu
sebabnya `m5.transaction.change_requested` memakai resolver `explicit`, bukan
`leadsOfDivision`). **Empat sisanya yang perlu diputuskan.**

### Cek 3 — divisi yang tidak punya SATU PUN lead

Ini yang membuat notifikasi hilang diam-diam, dan tidak ada test yang bisa
menangkapnya karena "nol penerima" adalah hasil yang sah.

```sql
select rm.division,
       count(*) filter (where rm.level = 'lead')  as baris_lead,
       count(distinct e.employee_id) filter (where rm.level = 'lead'
                                              and e.status_aktif) as orang_lead_aktif
  from role_mappings rm
  left join employees e
    on e.divisi = rm.divisi and e.jabatan = rm.jabatan
 group by rm.division order by rm.division;
```

`orang_lead_aktif = 0` untuk sebuah divisi berarti setiap notifikasi ke
lead divisi itu menguap. **Yang paling perlu diperiksa:**

| Divisi | Event yang mati kalau nol lead aktif |
|---|---|
| **Account** | `strategi_diajukan` (SPV/Head of Account tidak tahu ada Strategi menunggu) · lengan SPV dari `strategi_revisi_disarankan`, `plan_*`, `gate_*` |
| **Sales** | `m6a.strategi.sanggahan_target` (A-08, katalog v4) — Head of Sales adalah **satu-satunya** penerima non-Account event ini |
| **Finance** | `m5.contract.not_received`, lengan Finance dari `strategi_disetujui` |

⚠️ Di DB **lokal/CI** hari ini: `Account Lead` **ada** sebagai baris mapping tapi
**tidak ada karyawan** yang memegangnya, jadi lengan SPV Account ber-nol
penerima. Itu sebabnya test A-08 menotifikasi lewat SPV harus memakai
`explicitRecipients`, dan sebabnya satu test A-08 saya tulis dengan aktor SPV —
dengan aktor AM hitungannya 0 karena satu-satunya penerima adalah aktor sendiri.
**Jangan simpulkan produksi sama**; Cek 3 yang menjawabnya.

### Cek 4 — baris mapping yang tidak dipakai siapa pun (arah sebaliknya)

```sql
select rm.divisi, rm.jabatan, rm.division, rm.level
  from role_mappings rm
  left join employees e
    on e.divisi = rm.divisi and e.jabatan = rm.jabatan
 where e.employee_id is null
 order by rm.divisi, rm.jabatan;
```

Kalau live punya 38–39 baris sementara HRIS hanya memakai belasan, sisanya
adalah tebakan yang belum pernah diuji kenyataan. Tidak berbahaya hari ini —
**tapi** setiap baris di sini adalah `division`/`level` yang akan berlaku begitu
seseorang dipromosikan ke jabatan itu, tanpa review.

### Cek 5 — duplikat yang memberi dua jawaban untuk satu orang

```sql
select divisi, jabatan, count(*) from role_mappings group by 1,2 having count(*) > 1;
```

Harus kosong. `(divisi, jabatan)` seharusnya unik — B sendiri memuat pasangan
yang mencurigakan: `CUSTOMER RELATION OFFICER` **dan**
`CUSTOMER RELATIONS OFFICER` (dengan/tanpa `S`), dan `CUSTOMER RELATION OFFICER`
muncul di **dua divisi** (`ACCOUNT` dan `SALES`). Yang kedua sah kalau HRIS
memang punya jabatan sama di dua divisi; yang pertama hampir pasti **typo yang
dilegalkan** — dan mapping yang menerima typo berarti salah ketik di HRIS
menghasilkan peran yang salah, bukan error.

### Cek 6 — cakupan divisi B vs kebutuhan CDPS

CSV B hanya menyentuh **5** `divisi` HRIS: `ACCOUNT`, `ADVERTISER`,
`BUSINESS DEVELOPMENT`, `CREATIVE`, `SALES`. Tidak ada baris untuk **KOL**,
**Finance**, **Live Stream**, **Management**. Live punya 38, jadi live
menambahkan sesuatu — **apa**, dan siapa yang menyetujuinya?

```sql
-- bandingkan live terhadap B (23 baris) untuk melihat 15 tambahannya
select divisi, jabatan, division, level from role_mappings order by divisi, jabatan;
```

## 3. Keputusan yang saya minta — tiga, bukan satu

| # | Keputusan | Kenapa tidak bisa saya tebak |
|---|---|---|
| **(a)** | **Mana sumber kebenaran: live (C) atau berkas repo (B)?** | Kalau **C**, maka B harus di-regenerate DARI live dan repo berhenti mengklaim punya seed riil. Kalau **B**, maka 15 baris ekstra di live harus dijelaskan atau dihapus — dan menghapus baris mapping **mencabut akses orang**, jadi itu bukan pembersihan, itu perubahan permission |
| **(b)** | **Apakah A (12) tetap fixture selamanya?** | Kalau ya: beri komentar eksplisit di `seed.sql` bahwa ia **bukan** data riil dan gerbang `role_mappings = 12` di `db-rebuild.sh`/`ci.yml` adalah gerbang FIXTURE. Kalau tidak: A dan B harus disatukan, dan itu berarti seed employees ikut berubah bentuk ⇒ banyak test menyentuh casing |
| **(c)** | **Empat karyawan aktif tanpa mapping (7 − 3 Director): sengaja?** | Masing-masing hari ini tidak bisa membuka `/portal` dan tidak pernah jadi penerima notifikasi. Kalau tidak sengaja, ia butuh baris mapping; kalau sengaja, ia butuh alasan tertulis supaya audit berikutnya tidak menghitungnya sebagai cacat lagi |

## 4. Yang JANGAN dilakukan sebelum (a) diputus

- **Jangan** `INSERT`/`DELETE` di `role_mappings` live. Menambah baris memberi
  akses; menghapus baris mencabutnya. Keduanya perubahan permission tanpa entri
  `DECISIONS.md`.
- **Jangan** naikkan gerbang `role_mappings` dari 12 agar "cocok live". Gerbang
  itu menjaga **fixture**, dan menaikkannya agar cocok dengan produksi justru
  menghapus kemampuannya mendeteksi seed yang berubah.
- **Jangan** ubah INNER JOIN di `private.employee_role` menjadi LEFT supaya
  keempat karyawan itu "tidak 404". Itu keputusan O51 yang sudah diambil dengan
  alasan tertulis: `('','')` membuat `roleTypeFor` memutuskan atas divisi kosong
  — jawaban yang **terlihat** valid untuk pertanyaan yang seharusnya tidak punya
  jawaban.
