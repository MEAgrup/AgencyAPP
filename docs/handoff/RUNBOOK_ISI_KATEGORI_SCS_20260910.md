# Runbook — mengisi 21 Kategori SCS lewat `/creative/scs/kategori`

**Untuk:** lead Creative (Leader Video). **Nol migrasi, nol deploy** — ini murni
pengisian data lewat layar admin yang sudah live.

Dokumen sumbernya akhirnya masuk repo di sesi ini:
`docs/prd/CDPS_GapAnalysis_LeaderVideo_CreativeDailyOps.md` (Gap B, "Locked
Kategori list for the merged role"). Angka "21" di handoff terbukti tepat: daftar
terkunci berisi **24 Kategori**, **tiga** di antaranya sudah di-seed migrasi
(`Script`, `Brief`, `Upload & Checklist`), jadi **21 sisanya** diisi lewat layar.
Kategori keempat yang sudah ada (`Koordinasi`) **bukan** dari daftar ini — ia
lahir dari ketokan Gap H-1 2026-09-09 — jadi totalnya nanti **25 baris**, bukan 24.

---

## 1. Sebelum mulai

| Hal | Nilai |
|---|---|
| Layar | `/creative/scs/kategori` |
| Siapa yang boleh | **lead divisi Creative**, atau **Director** (`isLead` true untuk Director) |
| Siapa yang TIDAK boleh | staff Creative, lead divisi lain, dan **OD** (OD read-only) — ditolak `[anda tidak memiliki akses untuk mengatur kategori pekerjaan]` |
| Bisa diulang? | Ya. `kode` tidak bisa diubah sesudah dibuat, **semua field lain bisa** disunting lewat layar yang sama. Nol jalur DELETE (baris pekerjaan historis menunjuk Kategori lewat FK) — yang salah **dinonaktifkan** (`aktif = tidak`), bukan dihapus |

---

## 2. Aturan per field — dan pesan penolakannya kalau dilanggar

| Field | Aturan | Kalau dilanggar |
|---|---|---|
| **Kode** | wajib, tidak boleh kosong. **Otomatis di-UPPERCASE** server, jadi tidak perlu diketik kapital. Maks 48 karakter. Harus unik | kosong ⇒ `[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]` · sudah dipakai ⇒ `[kode kategori sudah dipakai]` |
| **Nama** | wajib, tidak boleh kosong/spasi saja. Maks 191 karakter. **Harus unik** (`UNIQUE` di DB) | `[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]` |
| **Sub Type** | **JANGAN DIISI DI PUTARAN INI** — lihat §4. Kosongkan | — |
| **Standing** | `ya` = pekerjaan berulang harian (dihitung sebagai *volume*, Speed Score `N/A`). Default `tidak` | — |
| **SLA (jam)** | bilangan bulat **> 0**. Kosong = tidak di-SLA-kan. **Standing ⇒ WAJIB kosong** | `0`/negatif ⇒ `[data tidak lengkap...]` · standing + SLA ⇒ `[kategori standing tidak boleh punya SLA — pekerjaan berulang tidak diukur kecepatannya]` |
| **Aktif** | default `ya` | — |
| **Urutan** | bilangan bulat **> 0** (urutan tampil) | `0`/negatif ⇒ `[data tidak lengkap...]` |

**Layar sudah menjaga jebakan yang paling gampang kena:** memilih Standing = `ya`
akan **mengosongkan dan mematikan** input SLA sendiri, jadi kombinasi terlarang
itu tidak bisa dikirim dari layar. Yang tetap perlu diperhatikan: kalau sebuah
Kategori diubah dari standing ke non-standing, SLA-nya kembali ke default 24 jam
di form — **periksa angkanya sebelum simpan**, jangan diloloskan begitu saja.

---

## 3. Ke-21 baris yang perlu diketik

Urut sesuai daftar terkunci di sumber. `urutan` mulai dari 5 supaya tidak
bertabrakan dengan empat baris yang sudah ada (1–4).

| # | Kode | Nama | Standing | SLA (jam) | Urutan |
|---|---|---|---|---|---|
| 1 | `CONTENT_IDEA` | Content Idea | tidak | *lihat §3.1* | 5 |
| 2 | `CONTENT_PLAN` | Content Plan | tidak | *§3.1* | 6 |
| 3 | `QC` | QC | tidak | *§3.1* | 7 |
| 4 | `BRIEF_GUIDELINE_VG` | Brief/Guideline VG | tidak | *§3.1* | 8 |
| 5 | `DOP_VIDEO` | DOP Video | tidak | *§3.1* | 9 |
| 6 | `DOP_FOTO` | DOP Foto | tidak | *§3.1* | 10 |
| 7 | `PREPARE_PRODUCT` | Prepare product | tidak | *§3.1* | 11 |
| 8 | `PREPARE_TALENT` | Prepare talent | tidak | *§3.1* | 12 |
| 9 | `PREPARE_LOKASI_SHOOTING` | Prepare lokasi shooting | tidak | *§3.1* | 13 |
| 10 | `COPY_MARKETPLACE` | Copy - Marketplace | tidak | *§3.1* | 14 |
| 11 | `COPY_SOCMED` | Copy - Socmed | tidak | *§3.1* | 15 |
| 12 | `COPY_PUBLIKASI` | Copy - Publikasi | tidak | *§3.1* | 16 |
| 13 | `WEEKLY_REPORT` | Weekly Report | tidak | *§3.1* | 17 |
| 14 | `MONTHLY_REPORT` | Monthly Report | tidak | *§3.1* | 18 |
| 15 | `REQ_TAMBAHAN_CLIENT` | Req Tambahan - Client | tidak | *§3.1* | 19 |
| 16 | `REQ_TAMBAHAN_INTERNAL` | Req Tambahan - Internal | tidak | *§3.1* | 20 |
| 17 | `REWORK_CLIENT` | Rework - Client | tidak | *§3.1* | 21 |
| 18 | `REWORK_INTERNAL` | Rework - Internal | tidak | *§3.1* | 22 |
| 19 | `OTHERS_SHOOTING_TALENT` | Others - Shooting/Talent | tidak | *§3.1* | 23 |
| 20 | `OTHERS_VOICE_OVER` | Others - Voice Over | tidak | *§3.1* | 24 |
| 21 | `OTHERS` | Others | tidak | *§3.1* | 25 |

Nama kolom **Nama** sengaja disalin **verbatim** dari sumber, termasuk kapitalisasi
yang tidak konsisten (`Prepare product` huruf kecil, `DOP Foto` kapital) dan spasi
di sekitar tanda hubung (`Copy - Socmed`). Aturan rumah: jangan pernah mengganti
nama label. Kalau Leader mau merapikannya, itu keputusan sendiri — rapikan di layar
sesudah semuanya masuk, bukan sambil mengetik.

### 3.1 Kolom Standing dan SLA: yang sumber TIDAK katakan

Dua kolom di tabel atas sengaja tidak saya isi dengan angka, karena **sumbernya
tidak memuatnya** dan mengarangnya akan langsung masuk ke Speed Score orang:

- **SLA per Kategori tidak ada di sumber mana pun.** Sheet-nya tidak punya konsep
  SLA sama sekali (Gap Analysis §5: *"the sheets today track them without any SLA
  concept"*). Angka 24 jam pada `Script` dan `Brief` yang sudah di-seed pun adalah
  pilihan implementasi, bukan kutipan. **Leader menentukan sendiri per Kategori**,
  dan boleh dikosongkan — kosong berarti "tidak di-SLA-kan", dan Speed Score
  barisnya jadi `N/A`, bukan 0%. Mengosongkan lebih jujur daripada menebak.
- **Standing hanya disebut untuk SATU Kategori di sumber:** `Upload & Checklist`
  (sudah di-seed standing). Daftar di atas karena itu **semuanya `tidak`**. Kalau
  ternyata `Weekly Report`/`Monthly Report` juga terasa "berulang tanpa
  deliverable", itu ketokan Leader — dan konsekuensinya perlu disadari: menandai
  sebuah deliverable NYATA sebagai standing membuatnya **hilang sepenuhnya** dari
  seri deliverable, kesalahan yang lebih buruk daripada sebaliknya. `is_standing`
  boleh diubah kapan pun lewat layar, dan Speed Score dihitung ulang dari log —
  jadi mulai dari `tidak` lalu naikkan kalau datanya membuktikan, bukan sebaliknya.

---

## 4. Kenapa kolom Sub Type harus DIKOSONGKAN dulu

Delapan label Sub Type-nya ada di sumber dan tidak hilang:

> Brief Feed · Brief Story · Script Video · Content Plan · Caption · Angle Content
> · Copy SKU · Copy Banner

Tapi **jangan diisi ke tabel Kategori**, karena di sumber Sub Type adalah field
**per-BARIS pekerjaan**, bukan atribut Kategori — dan sebagaimana terbangun
sekarang ia kolom di `scs_kategori`. Bedanya bukan kosmetik: seluruh alasan
`Brief`, `Script`, dan `QC` digabung jadi satu Kategori adalah *"Sub Type carries
the distinction where it matters (Brief Feed / Brief Story)"*. Dengan Sub Type
menempel di Kategori, satu baris `Brief` hari Senin tidak bisa `Brief Feed`
sementara baris `Brief` hari Selasa `Brief Story` — persis pembedaan yang
penggabungannya mengandalkan.

Mengisi kolom itu sekarang akan **memaku satu label ke seluruh Kategori** dan
membuat penggabungan itu tidak bisa dibatalkan tanpa migrasi. Karena itu
ketidaksesuaiannya dicatat sebagai pertanyaan terbuka `M19-SCS-SUBTYPE-GRAIN`
di `docs/DECISIONS.md` (§Open) untuk diketok pemilik, bukan ditebak di sini.

Empat baris yang sudah di-seed **sudah** membawa nilai di kolom itu (`Content`,
`Operasional`) — dan keduanya **bukan** anggota delapan label terkunci di atas.
Itu bagian dari pertanyaan yang sama; jangan diikuti polanya.

---

## 5. Verifikasi sesudah selesai

1. Layar `/creative/scs/kategori` menampilkan **25 baris** (21 baru + 4 seed).
2. Buka `/creative/scs` dan tambah satu baris percobaan: dropdown Kategori-nya
   memuat semua yang aktif. **Hapus baris percobaan itu** sesudahnya — hanya baris
   `[To Do]` yang bisa dihapus, jadi jangan digerakkan statusnya dulu.
3. Baris Kategori standing tampil dengan penanda `· standing`, dan kolom SLA-nya
   `—` (bukan `0`).

Kalau ada baris yang ditolak dan pesannya tidak ada di tabel §2, catat pesan
persisnya — itu berarti ada aturan yang runbook ini belum tangkap.
