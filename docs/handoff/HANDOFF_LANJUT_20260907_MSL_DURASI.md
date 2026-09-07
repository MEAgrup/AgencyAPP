# Handoff — penghalang #1 Gelombang D ternyata cacat UI, bukan pekerjaan admin

> Lanjutan `HANDOFF_LANJUT_20260907.md`. Baca yang itu dulu untuk posisi umum;
> berkas ini hanya mengoreksi **satu** hal darinya, dan mencatat apa yang
> dikerjakan sesi ini.

---

## 1. Koreksi terhadap handoff sebelumnya

`HANDOFF_LANJUT_20260907.md` §3 menyebut tiga pekerjaan yang memblokir nilai dan
menyatakan ketiganya **"pekerjaan admin/operasional, bukan dev"**, dengan judul
*"tak ada kode yang bisa menggantikannya"*.

Untuk nomor 1 — **isi `durasi_jasa` di MSL** — itu **keliru**, dan keliru dengan
cara yang mahal: pekerjaannya tidak bisa dilakukan admin sama sekali, karena
**form MSL admin tidak pernah punya field-nya.**

Diperiksa ke kode sebelum dikerjakan, sesuai aturan kerja #3 handoff itu sendiri
("opsi yang membawa alasan teknis wajib diperiksa ke kode SEBELUM diajukan").
Rantai backend-nya lengkap dan selalu lengkap:

| Lapis | Keadaan sebelum sesi ini |
|---|---|
| Kolom DB `master_service_versions.durasi_jasa` | ✅ ada sejak migrasi `20260831020000` |
| `packages/domain/src/msl.ts` | ✅ menerima & memvalidasi `durasiJasa` |
| `apps/api` POST + PUT `master-services` | ✅ membaca `durasi_jasa` |
| `apps/api/src/lib/wire.ts` | ✅ mengirimkannya ke FE |
| `web-internal/src/lib/types.ts` | ✅ mendeklarasikan `durasi_jasa: number \| null` |
| **`master-services/page.tsx`** | ❌ **tidak ada di form, tidak dibaca saat Ubah, tidak dikirim, tidak ditampilkan** |

Jadi nilai itu **mustahil** diisi lewat UI. Satu-satunya dua layanan yang
punya durasi (`AI Video`, `Optimasi SKU`, 30 hari) punya itu karena
**disemai migrasi** `20260831070000`, bukan karena ada yang mengisinya.

### Cacat kedua, yang lebih berbahaya dari yang pertama

`updateService` ber-semantik **FULL REPLACE**: setiap "Ubah" menulis baris versi
BARU dari isi payload. Field yang tidak dibawa form **bukan** "dibiarkan apa
adanya" — ia **terhapus** di versi baru.

Artinya: siapa pun yang mengubah harga `AI Video` lewat `/master-services`
akan menulis versi 2 ber-`durasi_jasa` **NULL**, tanpa peringatan, tanpa jejak
selain baris audit yang tidak menyebut field itu. Dua nilai yang ada di sistem
hari ini hidup hanya karena kebetulan belum ada yang menyunting keduanya.

---

## 2. Yang dikerjakan sesi ini

**Nol migrasi baru. Live tetap 185 migrasi / 146 tabel — tidak disentuh.**

1. **`web-internal/src/lib/msl.ts` (BARU)** — mapping form↔payload
   (`serviceToForm`, `formToPayload`, `parseDurasiJasa`, `formatDurasiJasa`)
   plus `saveMasterService()`, satu pintu tulis untuk create & update.
2. **`web-internal/src/lib/msl.test.ts` (BARU, 10 tes)** — inti-nya tes
   round-trip yang menyusuri **kunci milik payload sendiri**; lihat §3.
3. **`master-services/page.tsx`** — field **"Durasi Jasa (hari kalender)"** di
   form (dengan penjelasan bahwa kosong = *tidak berlaku*, bukan 0 hari), kolom
   **Durasi Jasa** di tabel utama **dan** di tabel Riwayat Versi, plus perbaikan
   `colSpan` yang sudah basi sejak sebelumnya (13 untuk 14 kolom → 15 untuk 15).
4. **`packages/domain/src/msl.ts`** — `durasiJasa?: number | null`. `null`
   sekarang berarti sama dengan undefined. Ini bukan kosmetik: pengirimnya
   adalah form yang **selalu** punya kuncinya, dan memaksanya menghilangkan
   kunci saat kosong adalah cara termudah menghilangkan nilai tanpa sadar —
   persis kelas cacat yang aturan rumah *"kunci hilang lebih berbahaya daripada
   null"* lahir untuk mencegah. Kedua route `apps/api` ikut diperlebar.
5. **`packages/domain/src/msl.test.ts` (+5 tes)** — `durasi_jasa` sebelumnya
   **nol tes**, di kedua sisi. Sekarang: persist saat create, **selamat** saat
   update yang membawanya, **terhapus** saat update yang tidak (semantik
   full-replace dinyatakan, bukan diasumsikan), `null` ≡ undefined, dan
   penolakan 0/negatif/pecahan.

---

## 3. Cara tes-nya ditulis, dan kenapa begitu

Kelas cacatnya **bukan** "field ini salah" melainkan **"field ini tidak pernah
dibawa"**. Assertion per-field yang ditulis tangan tidak bisa menjaga itu — ia
hanya menangkap field yang seseorang ingat untuk di-assert, dan yang lupa
di-assert justru yang lupa dibawa.

Jadi tes round-trip-nya menyusuri `Object.keys(payload)` dan menuntut tiap kunci
kembali dari baris `MasterService` sumbernya. Field yang ditambahkan ke
`MslPayload` tanpa dibaca di `serviceToForm` **gagal di situ**, bukan menghapus
dirinya sendiri di produksi pada "Ubah" berikutnya.

Fixture-nya sengaja memberi **nilai berbeda-beda di setiap field**: default
tidak berguna sebagai fixture, karena mapping yang menjatuhkan sebuah field
tetap "lolos" kalau nilai yang dijatuhkan kebetulan sama dengan nilai kosong.

**Divalidasi dengan dua mutasi**, bukan diasumsikan menangkap:
menjatuhkan `durasi_jasa` → merah; menjatuhkan `plan_tier` → merah; keduanya
dikembalikan.

---

## 4. Gerbang rumah yang sempat merah — dan kenapa itu jawaban yang benar

Memindahkan payload ke `lib/` **memerahkan `apps/api/src/lib/body-parity.test.ts`**:

```
PUT /master-services/{}  body=?  (…/master-services/page.tsx)
POST /master-services    body=?  (…/master-services/page.tsx)
```

Sebabnya: gerbang itu me-resolve badan request dari interface yang dideklarasikan
**di berkas yang SAMA** dengan panggilan `api.*`. Halaman yang mengirim payload
bertipe modul lain terbaca `unresolved` — dan **badan yang tidak ter-resolve
tidak memeriksa apa pun**. Jadi perbaikan yang naif (biarkan `page.tsx`
memanggil `api.put` langsung) akan diam-diam **mematikan** gerbang yang justru
ada untuk menangkap kelas cacat ini.

Yang dilakukan: panggilan tulisnya dipindah ke `saveMasterService()` di
`lib/msl.ts`, mengikuti pola rumah yang gerbang itu sendiri sebutkan — *"the FE
data layer is one thin function per endpoint"*. Gerbangnya **tidak** dikecualikan.

Dibuktikan hidup dengan mutasi: mengeja ulang kunci route jadi `durasi_jasa_hari`
membuat gerbang berteriak

```
PUT /master-services/{} sends body.durasi_jasa, which
apps/api/src/app/api/v1/master-services/[id]/route.ts never reads
(called from web-internal/src/lib/msl.ts, keys via interface)
```

`keys via interface` itu bukti bahwa badannya benar-benar ter-resolve lewat
`MslPayload`, bukan sekadar berhenti dipindai.

---

## 5. Verifikasi — angka acuan BARU

Semua dijalankan lokal terhadap DB yang dibangun ulang `scripts/db-rebuild.sh`.

| Suite | Sebelum | Sesudah | Selisih |
|---|---|---|---|
| core | 930 | **930** | — |
| db | 53 | **53** | — |
| apps/api | 490 | **490** | — |
| domain | 1977 (+1 skip) | **1982** (+1 skip) | **+5** (durasi_jasa) |
| web-internal | 640 | **650** | **+10** (`lib/msl.test.ts`) |
| web-client-portal | 19 | **19** | — |
| migrasi `db-rebuild` | 185 | **185** | — |

- `npm run typecheck --workspaces` **sesudah `npm install`**: bersih di empat
  workspace. (Jebakan handoff sebelumnya benar dan masih berlaku — sebelum
  `npm install`, `tsc` di `web-internal` membanjiri keluaran dengan
  *"Cannot find module 'xlsx'"* dan galat sungguhan tenggelam.)
- `web-internal`: `npx tsc --noEmit` bersih, `npm run build` sukses.
- `npm run lint`: **1 error, PRE-EXISTING** — `react-hooks/static-components`
  di `admin/employees/page.tsx`, di luar cakupan (sudah dicatat handoff sebelumnya).

---

## 6. Yang TIDAK dikerjakan, dan kenapa

**Nilai durasinya tidak diisi.** Itu data bisnis: berapa hari kalender tiap
layanan berjalan. Menebaknya berarti angka karangan yang langsung masuk skedul
pengakuan pendapatan Gelombang D dan Management Date Ads. Dicatat sebagai
`D-DUR` di §Open `DECISIONS.md`.

Satu jebakan untuk yang mengisinya nanti: layanan yang namanya menyebut satuan
waktu (`… 150 JAM`, `… 16/30/60 Jam Night`) hampir pasti butuh durasi kalender
yang **berbeda** dari angka jam di namanya — jam itu volume kerja, bukan rentang
tanggal.

---

## 7. Posisi sesudah sesi ini

| | Status |
|---|---|
| Gelombang A · B · C | ✅ tutup |
| **Penghalang D #1 (`durasi_jasa`)** | 🟡 **sisi kode SELESAI** — tinggal nilainya (`D-DUR`) |
| Penghalang #2 (jumlah laporan klien) | ⏸️ tetap operasional |
| Penghalang #3 (izin pitch, 0 baris) | ⏸️ tetap operasional |
| Gelombang D | ⏸️ menunggu `D-DUR` |

Begitu `D-DUR` terisi, urutan Gelombang D di `HANDOFF_LANJUT_20260907.md` §7
langkah 1 berlaku apa adanya — empat aturan uangnya sudah diketok, jangan
diketok ulang.

Yang layak dikerjakan sementara menunggu, tidak berubah dari daftar sebelumnya:
**UAT `/showcase` di peramban** (satu-satunya hal Gelombang C yang belum
dibuktikan mata), `B23-SHP`, atau `KS-4`.

---

## 8. Pelajaran yang layak dibawa

**Sebuah handoff yang menyatakan "ini bukan pekerjaan dev" tetap perlu
diperiksa ke kode.** Kalimat itu ditulis dengan yakin, tiga kali, dan tetap
keliru — karena yang diperiksa saat menulisnya adalah *ada tidaknya nilai di
DB*, bukan *ada tidaknya jalan untuk mengisinya*. Pertanyaan yang membedakan
keduanya cuma satu, dan murah: **"kalau admin mau melakukan ini sekarang, di
layar mana dia mengetiknya?"**

Ini varian dari aturan #4 handoff sebelumnya — *"ketiadaan yang diam tidak bisa
dibedakan dari kerusakan"*. Kolom `durasi_jasa` yang kosong terbaca seperti
"belum sempat diisi", padahal artinya "tidak pernah bisa diisi". Dua sebab yang
sangat berbeda, satu tampilan yang sama.
