# HANDOFF — M6A/M6B/M6C Sesi 10 (titik mulai sesi berikutnya)

> Rantai: SESI1 → … → SESI9 → **SESI10 (ini, terbaru)**. Baca yang bernomor
> tertinggi lebih dulu; sesi sebelumnya hanya untuk konteks sejarah.
>
> **Sesi ini: A-13b (Section A/B/C/E/F) — PR #110.** Halaman Strategi sekarang
> melayani **sembilan dari sepuluh seksi**. Nol pekerjaan menggantung:
> ter-commit, ter-push, ter-merge.
>
> 🔴 **SATU temuan yang lebih besar dari tiketnya, dan ia MEMBATALKAN kalimat
> "form Strategi selesai":** sembilan seksi punya pintu, tapi **gerbang submit
> masih mustahil dilewati dari UI**. Tiga field WAJIB — D-2, D-8, E-12 — tidak
> punya editor di mana pun, jadi setiap Strategi akan selamanya menampilkan
> hitungan kekurangan dan tombol Ajukan akan selalu dijawab
> `[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]`. Lihat §2.
> **Ini tiket berikutnya, bukan catatan kaki.**

## 0. Posisi persis — VERIFIKASI SEBELUM MENYALIN

| | |
|---|---|
| Branch | `claude/sesi6-migration-handoff-1afolk` — sudah ter-merge ke `main` lewat #110 |
| Commit | `581cd19` (A-13b) + commit dokumen ini |
| PR | **NOL terbuka.** #110 ter-merge sesi ini. #107/#108/#109 ter-merge sesi lalu |
| Migrasi | **72 berkas — TIDAK BERUBAH.** A-13b murni frontend; nol migrasi, nol perubahan domain/route |
| Gate | tabel 81 · prefix 31 · mesin 16 · event 34 · `CATALOG_VERSION` 4 · `role_mappings` 12 — semuanya tidak disentuh |
| Test | `web-internal` **128 hijau** · `apps/api` **317 + 7 skip** · `packages/core` **118** · `packages/db` **7 + 8 skip** · `packages/domain` **250 + 670 skip** (skip = tanpa DB lokal; CI menjalankannya penuh) · `route-parity` **5 hijau**, `KNOWN_GAPS` tetap **kosong** · lint + typecheck + `next build` bersih |
| Live `CDPS SG` | **Tidak disentuh sesi ini** — tidak ada migrasi. Status terakhir yang terverifikasi: SESI9 §5 (sidik jari `d8daaa25…`, 148 fakta identik) |
| Menggantung | Kode: **NOL**. Keputusan yang diwarisi: O60 · O47b rewrite · O42-b · O59-b · O24 · O45 · X-06 · X-12 |

### 0.1 Skor — dan kenapa angkanya menyesatkan (lagi)

M6A **13/16 tiket** · M6B **1/12**.

**Jangan baca "9 dari 10 seksi" sebagai 90%.** Yang benar: sembilan seksi bisa
**dibuka dan disimpan**; yang belum, **tidak seorang pun bisa mengajukan
Strategi** karena tiga field wajib tidak punya kotak isian. Sebuah form yang
setiap seksinya menyimpan tapi tidak pernah bisa lolos gerbang adalah form yang
belum jadi — lihat §2.

## 1. Yang mendarat: A-13b

Lima komponen seksi baru, ±4.300 baris, di `web-internal/src/components/strategi/`.

| Seksi | Cakupan | Yang perlu diingat |
|---|---|---|
| **A** | A-1…A-16 | Matriks akses A-15 hanya menawarkan channel yang **ada di kontrak** (`detail.channels`), bukan seluruh enum `CHANNELS`. Akses ke channel yang tidak dibeli bukan blocker, dan menawarkannya membuat AM mengisi baris yang tidak akan pernah digerbangi |
| **B** | B-1…B-9 | **Dua endpoint berurutan, bukan paralel.** `saveStrategiChannels` dulu — id channel lahir di sana — lalu `saveStrategiBaseline` per channel memakai id dari respons. Membalik urutannya berarti menyimpan baseline ke id yang belum ada |
| **C** | C-1…C-8 | Diagnosa (field-ID Rule 6 divalidasi server saat simpan), quick win, risiko struktural, prasyarat klien |
| **E** | E-1 · E-11 · E-13 | **E-3…E-10 tidak punya editor** — hanya ringkasan baca. Saat menyimpan Section E, pillar non-`tidak_dikerjakan` dari `detail.pillars` **dipertahankan dan dikirim ulang**; `saveStrategiPillars` mengganti seluruh daftar, jadi tanpa itu Section E akan menghapus pillar yang tidak pernah ia tampilkan |
| **F** | F-1…F-7 | Lihat §3 — dua bug penyimpanan diam |

`NarasiDraft` disatukan: E-1/E-13 dan H-3/H-4 berbagi endpoint `/narasi`, jadi
keempatnya selalu dikirim bersama. Halaman memegang **satu** salinan di
`drafts.sectionE.narasi`; Section H membaca dan menambal objek yang sama.
Mengirim hanya dua field akan mengosongkan dua field milik seksi lain.

`RepeatList` dapat `max` (B-3.3 top-5 SKU, B-9.1 kompetitor). Tidak seperti
`min`, `max` **menyembunyikan** tombol tambah: baris di atas plafon adalah
penolakan server yang pasti, bukan kekurangan yang sedang AM perbaiki.

## 2. 🔴 Gerbang submit belum bisa dilewati dari UI — ini tiket berikutnya

`checkCompleteness` (`packages/domain/src/strategi.ts`) menuntut tiga hal yang
**tidak punya editor di halaman mana pun**:

| Kode | Yang dituntut | Endpoint | Pemanggil di FE |
|---|---|---|---|
| **D-2** | target GMV bulanan untuk **setiap** channel | `PUT /strategi/{id}/targets` | **nol** |
| **D-8** | minimal 3 asumsi, dan Rule 8: tiap target GMV tertutup asumsi | `PUT /strategi/{id}/assumptions` | **nol** |
| **E-12** | minimal 1 ketergantungan klien | `PUT /strategi/{id}/ketergantungan` | **nol** |

Perintah yang memastikannya, jalankan dari `web-internal/`:

```
grep -rn "saveStrategiTargets\|saveStrategiAssumptions\|saveStrategiKetergantungan" src/
```

Nol hasil. Fungsi kliennya **ada** di `src/lib/strategi.ts` sejak A-03…A-09b;
yang tidak ada adalah manusia yang bisa sampai ke sana.

Ikut kosong tanpa pemanggil, dengan konsekuensi lebih kecil karena field-nya
opsional atau di luar Draft: `raiseStrategiSanggahan` (D-7, `O`),
`setStrategiAssumptionStatus` (flip `Gugur` saat `Aktif`), `openStrategiRevision`
(A-12).

**Kenapa ini lolos dari semua pagar yang ada.** `route-parity` memeriksa apakah
path yang dipanggil FE dilayani `apps/api` — ia tidak bisa melihat path yang
**tidak dipanggil siapa pun**. Ini persis kelas temuan SESI9 §8, satu lapis
lebih dalam: dulu seluruh `lib/strategi.ts` tidak punya pemanggil; sekarang
sebagian besar punya, dan yang tersisa justru yang digerbangi submit.

Catatan yang menghemat waktu: dokumen komponen `SectionD.tsx` sendiri menulis
*"D-1/D-2/D-4 … dan D-8/D-9 … land in A-13b"*. Tidak terjadi. Ruang lingkup
A-13b di backlog berbunyi "Section A, B, C, E, F", dan matriks target D-2 tidak
masuk salah satunya — dua kalimat itu tidak pernah dipertemukan. Jangan
mengulang polanya: **cek gerbang submit, bukan daftar seksi.**

### 2.1 Bentuk tiket yang disarankan (A-13c)

1. **D-2 matriks target** — GMV per channel per bulan, `durasi_kontrak_bulan`
   kolom. Stretch `>=` floor sudah ditegakkan DB (`ck_strtg_stretch_gmv`);
   jangan tulis ulang aturannya di TS. D-3 **derivatif** (X-11) — render angka,
   jangan input.
2. **D-8 asumsi** — min 3, tiap asumsi menunjuk `target_terkait`. Rule 8 diperiksa
   terhadap target GMV, jadi UI-nya harus menampilkan target mana yang masih
   telanjang, bukan sekadar "minimal 3".
3. **E-12 ketergantungan klien** — repeatable struct (`item`, `kapan`,
   `konsekuensi`). Dokumen `SectionE.tsx` menyebut tempatnya di UI Section G;
   `KalenderDraft` belum memuatnya.
4. Sesudah ketiganya: **jalankan alur ujung-ke-ujung** dengan fixture Alpha
   Digital sampai `submitStrategi` menjawab 200. Itu satu-satunya bukti yang
   berarti untuk seksi ini.

## 3. Section F: dua bug penyimpanan diam yang ditemukan sambil jalan

**3.1 `strategi_resource` tidak punya kolom `detail`.** Draft F-2/F-3 menulis
ke sana. Kuota video/foto/desain dan video-per-kreator akan **hilang tanpa satu
pun pesan galat** — route menjawab `200`, `strategiResourcesFromWire` tidak
membaca kunci itu, dan pemuatan berikutnya menampilkan kotak kosong. Kelas O43,
versi yang lebih sunyi: bukan halaman blank, tapi angka yang menguap.

Sekarang **satu baris per metrik**, dibedakan `satuan` — kolom yang memang ada
untuk itu. Peta lengkapnya ada di komentar kepala `SectionF.tsx`; ringkasnya:

| jenis | `nilai` | `jumlah` | `satuan` |
|---|---|---|---|
| `konten` | — | kuota/bulan | `video` \| `foto` \| `desain` |
| `kol` | nilai sampel (di baris `kreator`) | jumlah | `kreator` \| `video_per_kreator` |
| `live_vendor` | tarif | jam/bulan | `jam` |
| `divisi` | — | estimasi beban | `jam` \| `slot` |

Ikut terpasang karena §4 memintanya dan input-nya belum pernah ada: **F-4
tarif**, **F-5 beban + satuan**, dan editor **F-6 tools**.

**3.2 F-7 bukan baris resource.** Ia `strategi.toleransi_over_persen`, dan hanya
endpoint header (`PUT /strategi/{id}`) yang menyentuhnya. Sebelumnya angkanya
bisa diketik dan tidak pernah tersimpan. Sekarang disimpan lewat
`updateStrategiHeader`, **dilewati saat nilainya tidak berubah** — endpoint itu
juga menulis `contracts` kalau jendela kontrak berubah, dan menyimpan Section F
tidak boleh menyentuhnya tanpa alasan.

## 4. Sisa M6A sesudah A-13c

| Tiket | Isi | Catatan |
|---|---|---|
| **A-13c** (baru) | D-2 · D-8 · E-12 | §2. **Prasyarat semua yang di bawah** — tanpa ini tidak ada Strategi yang bisa `Diajukan`, jadi A-10/A-11 tidak punya rekaman nyata untuk diuji |
| **A-10** | Tier visibilitas §4.1 | Hard-internal: A-10, D-7, F-5, F-7, H-4, J-2, J-3. Form sudah menandainya dengan badge; penegakannya belum |
| **A-11** | Tautan klien `/s/{token}` | **Serialiser terpisah**, bukan view internal yang dipangkas izin — itu keputusan arsitektur, bukan preferensi |
| **A-12** | UI revisi | `openStrategiRevision` belum punya pemanggil. Rule 13: alasan revisi wajib mengutip trigger yang dideklarasikan H-2 |
| **E-3…E-10** | Editor pillar | Belum bertiket. Tidak digerbangi submit, tapi tanpanya Section E hanya menyimpan tiga field dari sebelas |

Section **J** tidak butuh form: J-1/J-4 derivatif, J-2/J-3 lewat aksi
Setujui/Kembalikan yang sudah ada di shell.

## 5. Yang TIDAK berubah sesi ini

Nol migrasi. Nol perubahan `packages/domain`, `packages/core`, `packages/db`,
`apps/api`. Nol perubahan `backend/` (Go — pensiun, oracle paritas saja).
Angka gerbang, katalog event, dan live `CDPS SG` semuanya tidak tersentuh.
