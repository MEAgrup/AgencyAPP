# Handoff — **Gelombang C SELESAI**: Showcase dibangun, sepuluh gerbang tertutup, Gelombang D tinggal DATA

> **Baca ini dulu, lalu dua berkas ini, urut:**
> 1. `docs/DECISIONS.md` — tiga baris 2026-09-07 paling atas: *"GELOMBANG C
>    DIBANGUN"*, *"C-5 DIKETOK"*, dan *"C-4 DIKETOK"* (yang terakhir memuat
>    koreksi yang wajib dibawa — lihat §4 di bawah).
> 2. `docs/handoff/HANDOFF_GELOMBANG_C_20260907.md` — handoff yang sesi ini
>    kerjakan. §5-nya adalah rencana yang dieksekusi; §7-nya masih berlaku
>    seluruhnya dan sekarang jadi satu-satunya penghalang yang tersisa.

---

## 1. Posisi sebenarnya

| | Status |
|---|---|
| **Gelombang A · B1…B5** | ✅ di `main` (PR #300 · #301 · #302 · #303) |
| **Uji terima §10 butir 1–7** | ✅ lunas 2026-09-07 |
| **Gerbang keputusan C/D** | ✅ **10 dari 10 diketok** — `C-4` dan `C-5` ditutup sesi ini |
| **Gelombang C — Showcase Klien Terbaik** | ✅ **SELESAI** — lima langkah §5 handoff sebelumnya, semuanya |
| **Gelombang D — laporan keuangan accrual** | ⏸️ aturan uangnya lengkap; penghalangnya **hanya DATA** (`durasi_jasa` MSL 0/14) |

**Dua migrasi baru** (184 · 185): `20260916010000_c5_izin_pitch_klien.sql` dan
`20260917010000_c5_harden_search_path.sql`.

> ✅ **SUDAH DI-APPLY KE LIVE 2026-09-07** — repo dan `CDPS SG` sama-sama di
> **185**, 146 tabel, tidak drift. Diverifikasi lewat kueri katalog. Butir §5
> nomor 1 yang dulu berbunyi "apply migrasi 184 ke live" **sudah lunas**;
> lihat `HANDOFF_LANJUT_20260907.md` untuk posisi terkini.

---

## 2. Apa yang dibangun

Lima langkah `HANDOFF_GELOMBANG_C_20260907.md` §5, berurutan, semuanya:

| # | Langkah | Mendarat di |
|---|---|---|
| 1 | Rumah izin (C-5) | `supabase/migrations/20260916010000_c5_izin_pitch_klien.sql` — `client_pitch_consents` |
| 2 | Read model + ambang (C-4) | `packages/core/src/showcase.ts` · `packages/domain/src/showcase.ts` |
| 3 | Halaman + kalimat jujur (C-2) | `web-internal/src/app/(shell)/showcase/page.tsx` · `web-internal/src/lib/showcase.ts` · baris nav |
| 4 | Akses Sales + empat pagar (C-1) | domain + `apps/api` + tes di empat berkas |
| 5 | Export materi pitch | `core.renderPitchDoc` · `domain.materiPitch` · `GET /showcase/pitch` |

Rute baru (semuanya di `route-parity`, `KNOWN_GAPS` **tetap kosong**):

```
GET  /api/v1/showcase
GET  /api/v1/showcase/pitch[?download=1]
GET  /api/v1/clients/{id}/izin-pitch
POST /api/v1/clients/{id}/izin-pitch
POST /api/v1/clients/{id}/izin-pitch/cabut
```

### 2.1 Empat pagar C-1 — di mana masing-masing tinggal

Pengecualian pertama terhadap Role Matrix Fase 0 §4 dibangun **bersama**
fiturnya, bukan sesudahnya:

| Pagar | Tinggal di | Diuji di |
|---|---|---|
| (a) read-only, satu halaman | `domain/showcase.canReadShowcase` — **berdiri sendiri**, tidak menumpang `canReadReport` | `nav.test.ts` (Sales TIDAK melihat `/health`, `/portal/management`, `/account`, `/account/rekap`) |
| (b) hanya klien ber-izin | `domain/showcase.listShowcase` — disaring di DOMAIN | `showcase.test.ts` domain + e2e rute |
| (c) akses Sales masuk audit | `listShowcase`, memuat **daftar klien yang terlihat** | e2e rute: `after_json.klien_terlihat` |
| (d) tes menyebut Sales eksplisit | empat berkas tes | — |

⚠️ **Kalau nanti ada permintaan "Sales juga perlu lihat X":** itu keputusan
pemilik BARU, bukan perluasan yang boleh diputuskan di dalam tiket. Bentuk
kodenya sengaja dibuat supaya pelebaran harus DITULIS seseorang — gerbangnya
terpisah, dan tes nav akan memerah lebih dulu.

### 2.2 Materi pitch punya gerbang yang LEBIH KETAT daripada halaman

Ini beda yang paling mudah dilanggar tanpa sadar:

* **Halaman** punya dua pandangan — Account/Director melihat klien yang belum
  berizin (supaya tahu izin mana yang perlu diminta), Sales tidak.
* **Dokumen** punya SATU — hanya klien ber-izin, **siapa pun yang meng-export,
  Director termasuk**.

Alasannya sifat berkasnya: halaman bisa ditutup, berkas yang sudah terkirim ke
calon klien tidak bisa ditarik kembali. Penyaringnya `domain.materiPitch`, dan
ada tesnya (`materiPitch — dokumen yang meninggalkan gedung`).

---

## 3. Angka acuan BARU — pakai ini, bukan yang di handoff sebelumnya

```
service postgresql start
su postgres -c "psql -c \"ALTER USER postgres PASSWORD 'postgres';\""   # sekali per container
export DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps"
bash scripts/db-rebuild.sh --yes
npm install && npm test --workspaces && npm run typecheck --workspaces --if-present
cd web-internal && npm install && npx vitest run && npx tsc --noEmit && npm run build
cd ../web-client-portal && npx vitest run
```

| Suite | Sebelum | **Sekarang** |
|---|---|---|
| core | 906 | **930** |
| db | 53 | 53 |
| apps/api | 478 | **490** |
| domain | 1930 (+1 skip) | **1977** (+1 skip) |
| web-internal | 624 | **640** |
| web-client-portal | 19 | 19 |
| migrasi db-rebuild | 183 | **184** |
| tabel `public` | 145 | **146** |

`entity_prefix` **40**, `sm_machines` **31**, `notif_events` **69** — ketiganya
TETAP. Gelombang C tidak menambah prefix ID, mesin status, maupun event
notifikasi.

> ⚠️ Gerbang hitungan tabel hidup di **DUA** berkas —
> `scripts/db-rebuild.sh` dan `.github/workflows/ci.yml`. Keduanya sudah
> dinaikkan ke 146 di commit yang sama; menaikkan salah satu saja membuat lokal
> hijau sementara CI merah (yang terjadi pada PR #170).

### Jebakan yang masih berlaku

- ⚠️ **`npm run typecheck --workspaces` WAJIB diulang SESUDAH `npm install`
  selesai — dan keluarannya dibaca, bukan cuma exit code-nya.** Ini menggigit
  sesi ini dan memerahkan tiga job CI (`core-engines`, `api`,
  `db-and-migrations`) pada commit pertama. Di container yang `node_modules`-nya
  belum terpasang, `tsc` membanjiri keluaran dengan *"Cannot find module
  'vitest'"* dan *"Cannot find name 'node:fs'"* untuk SETIAP berkas tes — dan
  tiga baris galat yang sungguhan tenggelam di antaranya. Perintah di blok §3
  sudah berurutan benar (`npm install &&` lebih dulu); yang salah adalah
  menjalankannya terpisah lalu menganggap yang pertama sudah cukup.
  **Ketiga job CI itu mengompilasi `@cdps/core`**, jadi satu galat tipe di
  `packages/core` memerahkan ketiganya sekaligus dengan pesan yang tampak
  seperti tiga masalah berbeda.
- **Jalankan `packages/domain` SENDIRIAN sesudah `db-rebuild`** — tanpa itu,
  ~788 kegagalan palsu dari `plan.test.ts` yang menyapu `clients`.
- **`audit_log` menolak DELETE** (aturan rumah #3). Tes baru yang menghitung
  baris audit **tidak boleh** membersihkannya; pakai id aktor unik per jalan
  (pola `aktorUnik()` di `packages/domain/src/showcase.test.ts`).
- `client_pitch_consents` menolak UPDATE **dan** DELETE. Fixture membersihkannya
  dengan mematikan trigger sebagai superuser lalu **mengembalikannya di
  `finally`** — pola yang sama `client_report_insight`.
- **Postgres bisa mati sendiri di container ini** — `pg_isready` dulu.
- `rm -rf web-internal/.next` kalau muncul *"Another next build process is
  already running"*.
- 1 error lint `react-hooks/static-components` di `admin/employees/page.tsx`
  **PRE-EXISTING**, di luar cakupan.

---

## 4. ⚠️ Koreksi yang WAJIB dibawa: ambang C-4 pertama salah dasar

Opsi C-4 diajukan ke pemilik dengan alasan *"7,0 = batas bawah label SEHAT"*.
**Itu salah.** `report/skor.ts` dan `report/shopee/skor.ts` dua-duanya memakai
pita `>= 8` SEHAT · `>= 6` PERLU PERHATIAN · sisanya KRITIS — 7,0 ada di tengah
pita **PERLU PERHATIAN**. Ambang 7,0 akan meloloskan klien berlabel "PERLU
PERHATIAN" ke materi pitch.

Kekeliruan itu dilaporkan sebelum satu baris pun dibangun di atasnya, dan
pemilik menggeser ambang ke **8,0**. Perbaikannya struktural, bukan cuma
angkanya: pita label sekarang konstanta bernama `SKOR_SEHAT_MIN` /
`SKOR_PERHATIAN_MIN` + `labelSkor()` di `report/skor.ts`, mesin Shopee
mengimpornya (dua salinan angka jadi satu), dan `showcase.AMBANG_SKOR_MIN`
**mengimpor** `SKOR_SEHAT_MIN` alih-alih menyalin `8`.

**Pelajaran yang layak dibawa melewati tiket ini:** sebuah opsi keputusan yang
membawa alasan teknis wajib **diperiksa ke kode sebelum diajukan**, bukan
sesudah diketok. Kekeliruan ini tertangkap hanya karena implementasinya membuka
`skor.ts` untuk menulis komentar provenance — kalau ambangnya ditulis sebagai
literal `7.0`, ia akan mendarat, hijau, dan baru ketahuan saat seorang Sales
mengirim materi pitch berisi klien "PERLU PERHATIAN".

---

## 5. Pekerjaan sesi berikutnya, urut

1. ~~**Apply migrasi 184 ke live**~~ — ✅ **SELESAI 2026-09-07**, bersama
   migrasi 185 (pengerasan `search_path` yang advisor Supabase minta). Live
   sekarang 146 tabel; prefix/mesin/event tetap 40/31/69.
2. **Dua pekerjaan operasional dari §7 handoff sebelumnya** — keduanya masih
   memblokir NILAI, bukan kode, dan tidak ada kode yang bisa menggantikannya:
   - **Isi `durasi_jasa` di MSL** (0 dari 14 layanan). Tanpa ini Gelombang D
     menghasilkan skedul pendapatan kosong untuk **semua** layanan, apa pun
     jawaban D-1…D-4 yang sudah diketok.
   - **Naikkan jumlah laporan klien** (1 dari 10 klien). Halaman Showcase
     sekarang ADA dan jujur mengatakan kenapa ia kosong — tapi ia baru berguna
     saat laporan masuk. Dengan ambang 8,0 × 3 periode, klien pertama muncul
     paling cepat sesudah tiga bulan laporan ber-skor SEHAT.
   - **Minta izin pitch ke klien** — pekerjaan ketiga yang baru lahir sesi ini.
     Tanpa satu pun baris `beri`, daftar yang divisi Sales lihat kosong secara
     SAH, dan halaman mengatakannya. AM mencatatnya lewat tombol "Catat izin"
     di `/showcase`.
3. **Gelombang D** — begitu `durasi_jasa` terisi. Empat aturan uangnya sudah
   lengkap dan tercatat di `HANDOFF_GELOMBANG_C_20260907.md` §4 (D-1 hangus ·
   D-2 hold menjeda · D-3 kunci tutup buku · D-4 bruto + pilihan PPN per
   transaksi). Diperkirakan menambah satu migrasi ⇒ **185**.

---

## 6. Status CI PR #305

Hijau seluruhnya pada head `a6be7be` — 11 dari 11 check, `mergeable_state:
clean`, nol review thread terbuka, ketiga preview Vercel Ready. Repo ini
**tidak** menjalankan check *Claude Approvals*.

Commit pertama (`e6f3c8d`) merah di tiga job karena satu galat tipe di
`packages/core/src/showcase.ts` (lihat jebakan pertama di §3); `a6be7be`
memperbaikinya dengan tipe bernama `LaporanBerskor`, **bukan** dengan `!` —
`!` di situ akan mematikan justru penjagaan yang paling penting di modul itu
("laporan tanpa skor bukan laporan ber-skor nol").

Satu catatan dari log CI yang layak dibawa: `db-and-migrations` pada commit
merah itu sudah melewati **seluruh 184 migrasi**, gerbang **146 tabel**,
`rls_checks: PASS`, dan `auth_claims_checks: PASS` sebelum jatuh di langkah
typecheck. Jadi migrasi 184 dan gerbang hitungannya memang sudah terbukti hijau
di CI, bukan hanya di container lokal.

---

## 7. Yang sesi ini TIDAK buktikan — disebut jujur

- **Piksel React.** Halaman `/showcase` lolos `tsc`, `vitest`, dan `next build`,
  dan badan JSON yang ia baca diuji lewat rute — tapi tak ada seorang pun yang
  membukanya di peramban. Yang terbukti adalah kontraknya, bukan tata letaknya.
- **Perilaku di data live.** Semua tes berjalan di atas DB lokal hasil
  `db-rebuild` + fixture. Live punya 1 laporan ber-skor 4,5 dan nol baris izin
  ⇒ halaman di produksi akan menampilkan jalur KOSONG-nya, dan itulah yang
  pertama layak dilihat sesudah migrasi 184 di-apply.
- **`materiPitch` dengan banyak klien.** Diuji dengan 0 dan 1 klien ber-izin;
  tata letak tabel dengan sepuluh baris belum pernah dilihat mata.
