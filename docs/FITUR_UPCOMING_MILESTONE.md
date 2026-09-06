# Fitur: Upcoming Milestones

> **Untuk siapa dokumen ini.** Account Manager, Account Lead, dan Director — bukan
> developer. Ditulis karena fiturnya sudah jalan tapi belum pernah dijelaskan, jadi
> orang menganggapnya belum ada (QA pemilik 2026-09-06).

## Gunanya

Mencatat **tonggak yang dijanjikan ke klien** beserta tanggal targetnya, supaya janji itu
tidak hidup hanya di kepala AM atau tenggelam di thread chat. Contoh isian nyata:

- "Live perdana"
- "Katalog 50 SKU tayang"
- "Campaign Ramadan mulai"

Lahir dari keputusan pemilik **2026-08-14** (`docs/DECISIONS.md`, T-4c / M6D RM-11:
*"milestone terstruktur"*), yang menggantikan catatan teks bebas RM-C9. Bedanya: catatan
teks bebas tidak bisa ditagih, tidak punya tanggal yang bisa dibandingkan, dan hilang saat
AM berganti. Milestone punya ketiganya.

## Di mana letaknya

| Tempat | Bisa apa |
|---|---|
| Halaman klien `/clients/{id}` — blok **"Upcoming Milestones"** di **paling bawah** halaman | Tambah · tandai Selesai · Batalkan |
| Detail Rekap Mingguan `/account/rekap/{id}` | **Hanya membaca**, disaring hanya yang masih `[Upcoming]`, target terdekat lebih dulu |

⚠️ **Letaknya di paling bawah halaman klien, di bawah blok "Koreksi Field"** — ini yang
paling sering ditanyakan, karena mudah terlewat kalau halamannya tidak di-scroll habis.

## Cara pakai

1. Isi **"Tonggak baru"** (judul) + **"Tanggal Target"**.
2. Tekan **Tambah Milestone**.

Kedua isian **wajib**. Kosong salah satu ⇒
`[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]`

Baris yang masih `[Upcoming]` punya dua tombol: **Selesai** dan **Batalkan**.

## Aturan yang mengejutkan orang, dan alasannya

**1. Status hanya bergerak satu arah, dan keduanya final.**

```
[Upcoming] → [Done]
[Upcoming] → [Cancelled]
```

`[Done]` dan `[Cancelled]` **terminal** — sekali ditandai selesai atau dibatalkan, tidak
bisa dikembalikan ke `[Upcoming]`. Ini bukan kelalaian: mesinnya (`client_milestone`,
`docs/STATE_MACHINES.md` §16) memang hanya punya dua edge itu, dan penegakannya di
database, bukan di tombol.

**2. Judul dan tanggal target TIDAK BISA disunting setelah dibuat.**

Tidak ada jalur ubah — bukan disembunyikan, memang tidak ada
(`packages/domain/src/milestone.ts` hanya punya buat / baca / pindah-status).

**Kenapa sengaja begitu:** tonggak yang bisa digeser diam-diam bukan lagi janji. Kalau
tanggalnya meleset, cara yang benar adalah **buat tonggak baru dan batalkan yang lama** —
dan justru riwayat itulah yang bernilai saat review dengan klien: kelihatan bahwa target
pertama tidak tercapai dan diganti, bukan seolah target barunya selalu segitu.

Setiap perpindahan status tercatat permanen di `audit_log` (siapa, kapan, dari apa ke apa),
dan tidak ada jalur hapus.

## Siapa yang boleh apa

| Peran | Lihat | Tambah / Selesai / Batalkan |
|---|---|---|
| AM (pemilik klien itu) | ✅ hanya kliennya sendiri | ✅ hanya kliennya sendiri |
| Account Lead / SPV | ✅ seluruh klien divisi | ✅ |
| Director | ✅ semua | ✅ |
| OD (Org Development) | ✅ semua | ❌ **hanya membaca** |
| Divisi lain (Sales, Ads, Creative, KOL, Live, Finance, …) | ❌ | ❌ |

Sumber: `canView` / `canManage` di `packages/domain/src/milestone.ts`; RLS
`client_milestones_select` adalah kunci keduanya.

## Yang BUKAN fitur ini

Disebutkan eksplisit karena lebih berguna daripada membiarkan orang berasumsi:

- ❌ **Tidak mengirim notifikasi** apa pun — tidak saat dibuat, tidak saat tanggal target
  mendekat, tidak saat lewat.
- ❌ **Tidak menagih siapa pun** kalau tanggal targetnya lewat. Tidak ada flag, tidak ada
  badge merah, tidak ada baris di dashboard SPV.
- ❌ **Tidak muncul di dashboard** mana pun.
- ❌ **Tidak masuk skor Health Score (M13)** maupun **Team Performance (M14)**.

Ia adalah **catatan janji yang rapi dan tak bisa diutak-atik** — bukan sistem pengingat,
dan bukan komponen penilaian.

Kalau salah satu dari empat hal di atas memang diinginkan (mis. notifikasi saat tanggal
target lewat, atau milestone terlambat memotong Health Score), itu **tiket tersendiri** —
bukan bug pada fitur ini.

## Rujukan teknis

- Entitas: `client_milestones`, prefix ID **`MLS-YYYYMM-NNNN`**
- Mesin: `client_milestone` — `docs/STATE_MACHINES.md` §16
- Domain: `packages/domain/src/milestone.ts`
- Migrasi: `supabase/migrations/20260814070000_t4c_milestones.sql`
- Keputusan pemilik: `docs/DECISIONS.md` 2026-08-14 (T-4c / M6D RM-11)
