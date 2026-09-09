# Handoff — lanjutan sesudah M19 (2026-09-09)

**Baca ini lebih dulu di sesi baru.** Ia menjawab tiga hal: posisi sekarang, apa
yang harus dikerjakan berikutnya, dan **empat keputusan yang menunggu pemilik**
— masing-masing dengan contoh nyata dan rekomendasi.

Pendahulunya: `HANDOFF_M19_CREATIVE_DAILY_OPS_20260909.md` (detail modulnya),
`HANDOFF_FEEDBACK_SALES_TUTUP_20260909.md` (posisi sebelum M19).

---

## 1. Posisi

| Apa | Nilai |
|---|---|
| PR | **#334** `claude/eloquent-clarke-qmk87m` → `main`, **BELUM di-merge** |
| Commit | `1947262` · `9140ec6` · `65c67d4` · `28c8863` |
| Migrasi di repo | **216** (`20260927010000_m19_creative_daily_ops.sql`) |
| Gate repo | **153 tabel · 42 entity_prefix · 33 sm_machines · 73 notif_events** |
| Live `CDPS SG` | **215 migrasi — M19 BELUM diterapkan** |
| Tes | core 985 · db 81 · domain 2300 · apps/api 496 · web-internal 729 · typecheck bersih |
| Lint | 3 error + 61 warning — **identik baseline**, semuanya pre-existing |

M19 menutup Gap A/D/E/F (kalender harian, ketidaktersediaan PIC, booking studio,
penyelesaian hari-sama). Separuh `SMO & Content Strategist` (Gap B/G/I) ditahan.

---

## 2. Langkah berikutnya, berurutan

### 2.1 Terapkan migrasi ke live, LALU merge (urutannya wajib)

O65 dan preseden 2026-09-09: **migrasi dulu, merge kemudian** — bukan sebaliknya.

```
apply_migration  20260927010000_m19_creative_daily_ops.sql   ← satu berkas, satu panggilan
```

Jangan `supabase db push`. Jangan `psql -f` (itu yang melahirkan drift O38).
Sesudah apply: `scripts/check-live-drift.sh` harus nol MISSING — **tidak
berfungsi dari sandbox Claude Code** (egress Supabase diblok kebijakan org),
jalankan dari operator atau CI runner.

Verifikasi angka di live sesudah apply: `153 · 42 · 33 · 73`.

### 2.2 Browser UAT tiga layar baru

Ketiganya bisa gagal **murni secara visual** — `next build` sukses, nol error,
grid-nya salah. Harness B2 sudah ada dan Chromium sudah terpasang:

```bash
node scripts/dev-jwt.mjs   ...   # cookie sesi lokal, klaim dari employee_claims()
node scripts/browser-tour.mjs --token "$(cat token.txt)" --pages pages.json
```

Halaman: `/creative/schedule`, `/creative/schedule/rekap`,
`/creative/ketersediaan`. **Minimal empat aktor**: staff Creative, lead Creative,
OD, Director — karena gerbang tampilannya berbeda di keempatnya.

Yang harus dilihat, bukan cuma "200":
- grid menampilkan **keempat** studio termasuk yang nol slot ("Bebas");
- dua slot bertumpang **keduanya** tampil, yang bertumpang bergaris kuning;
- menyimpan slot yang bentrok memunculkan **"Tersimpan, dengan catatan"** —
  bukan pesan galat merah;
- halaman rekap menampilkan kalimat "bukan KPI";
- halaman ketersediaan menampilkan kotak "Ini bukan pengajuan cuti".

### 2.3 Baru sesudah itu: separuh SCS (butuh ketokan §3.1)

---

## 3. Empat keputusan yang menunggu pemilik

### 3.1 🔴 `M19-SCS-ENGINE` — MEMBLOKIR separuh SCS

**Pertanyaannya satu kalimat:** baris pekerjaan `SMO & Content Strategist`
memakai mesin **`brief_task`** yang sudah ada (jadi ia Task M12 keempat), atau
mesin **sendiri #34** seperti Penugasan Internal (`TSK-`)?

**Kenapa ini tidak bisa dipilih diam-diam.** Draft PRD menyatakan dua hal yang
tidak bisa dua-duanya benar: Rule 5-nya bilang baris SCS *"masuk penuh ke Task
Execution Engine"*, sementara §5.4-nya memesan **mesin #34**. Kodenya yang
membuatnya tegas — `packages/domain/src/task.ts:8`: *"an Asset is not a different
lifecycle"*. Asset **tidak punya mesin sendiri**; ia dan Brief-as-task
dua-duanya memakai `brief_task`. Jadi kalau SCS benar sebuah Task M12,
`sm_machines` **tetap 33** dan mesin #34 tidak pernah ada — mesin #34 adalah
bentuk jawaban yang **berlawanan**.

#### Contoh nyata dari sheet — tiga baris, dan apa yang terjadi pada masing-masing

| Baris di sheet | Opsi (a) Task M12 | Opsi (b) mesin sendiri |
|---|---|---|
| `mamimegol: Script, qty 7` | ✅ jalan | ✅ jalan |
| `sagata: Upload & Checklist, qty 1` (harian) | ✅ jalan, tapi Speed Score-nya harus di-N/A-kan | ✅ jalan |
| **`all client: Brief`** (tanpa nama klien) | ❌ **tidak bisa** | ✅ jalan |

Baris ketiga itu intinya. M12 §2 Rule 1 **membekukan** Task = Asset \| Creator
Booking \| Brief-as-task, ketiganya **wajib turunan Klien → Service → Brief**.
Baris "all client" tidak punya klien. Untuk memaksanya masuk opsi (a), salah
satu dari tiga hal harus terjadi:

1. **`client_id` dibikin wajib** ⇒ baris "all client" hilang dari sistem, dan
   Nisa kembali mencatatnya di luar CDPS;
2. **dibuat klien palsu "ALL CLIENT"** ⇒ sebuah baris di tabel `clients` yang
   bukan klien, yang akan ikut ke setiap laporan, setiap health score, setiap
   rekap — dan `PREFIXES.REQ` di `ident.ts` sudah mencatat kenapa jalan ini
   ditolak sebelumnya: melonggarkan `client_id` *"akan membongkar gerbang
   pembayaran M4/M5"*;
3. **M12 §2 Rule 1 diamandemen** ⇒ PRD berubah, dan setiap modul yang
   mengandalkan invarian "setiap Task punya klien yang membayar" perlu ditinjau.

#### Rekomendasi: **opsi (b), mesin sendiri #34**

Presedennya sudah memilih arah ini secara eksplisit, untuk alasan yang persis
sama — `packages/domain/src/internaltask.ts:4-10`:

> *KENAPA MODUL SENDIRI, BUKAN M12 — PRD M12 §2 Rule 1 membekukan "Task" = Asset
> \| Creator Booking \| Brief-as-task … `task.ts` (M12) tidak disentuh sama
> sekali, jadi tidak ada dua definisi Speed Score / turnaround.*

Yang **tidak** hilang dengan opsi (b): Speed Score tetap ada dan tetap satu
definisi, karena `task.computeMetrics()` sudah `export`ed dan pure — modul SCS
memanggilnya, bukan menulis ulang rumusnya.

Yang **berubah** kalau (b) dipilih: `sm_machines` 33 → 34, `entity_prefix`
42 → 43 (`SCS`), plus tabel `scs_tasks` dan `scs_kategori`.

**Kalau (a) yang dipilih**, tolong sebutkan sekalian mana dari tiga jalan di
atas yang diambil untuk baris "all client".

---

### 3.2 🟡 Apakah Kategori `Brief` juga `is_standing`?

**Sudah diputuskan `false` untuk v1** (sesi ini), tapi ia perlu ditinjau ulang
sesudah 2–3 bulan data nyata — jadi dicatat di sini supaya tidak hilang.

**Contohnya.** Rule 4 menggabungkan `Brief` milik Strategist (deliverable
kreatif sungguhan) dengan `Brief` milik SMO (yang dicatat hampir tiap hari
terhadap "all client" — pola standing). Sekarang satu Kategori memikul dua arti,
dan `is_standing` adalah sifat **Kategori**, bukan sifat baris.

**Kenapa `false` yang dipilih:** kalau salah, deliverable nyata yang salah
ditandai standing akan **hilang sepenuhnya** dari seri deliverable — kesalahan
yang lebih buruk daripada sebaliknya (volume standing sedikit terlalu tinggi).

---

### 3.3 🟡 Jurnal koordinasi Content Creator (Gap H-1)

D7 sudah mengetok "satu peran, bukan dipecah". Yang belum: **bentuk** jurnalnya.

**Contohnya.** Worksheet Boy Ginting berisi baris bebas seperti *"koordinasi
dengan Rani soal properti shoot"*, *"QC 12 konten klien X"*, *"submit via
WhatsApp dan Trello"*, dan **"Bikin Jadwal VG buat Hari Selasa"**.

Yang sudah dibangun: **hak tulisnya atas kalender** — ia memakai layar
`/creative/schedule` yang sama dengan Leader (menumpang `lead` Creative).

Yang belum: jurnalnya sendiri. Gap H-1 menyarankan **checklist sederhana, bukan
entitas Task-Execution**, karena isinya bukan deliverable yang di-review siapa
pun. **Rekomendasi: setuju** — dan tundanya sampai `M19-SCS-ENGINE` diketok,
karena kalau SCS dapat mesin sendiri, jurnal ini kemungkinan cukup jadi satu
Kategori di dalamnya alih-alih entitas ketiga.

---

### 3.4 🟡 KPI Profile Modul 14 untuk peran gabungan

**Ditunda dengan sengaja**, dan ini bukan kelalaian yang perlu dikejar.

**Contohnya, dengan angka.** Kalau peran gabungan mewarisi profil "Creative"
apa adanya, skor September Rani dihitung begini:

| Komponen | Bobot | Yang Rani punya |
|---|---|---|
| Speed Score (M12) | 28,5% | ✅ ada |
| Output Quantity — *Approved Assets* | 23,75% | ❌ **nol** — outputnya brief, skrip, copy. Itu tidak pernah jadi Asset |
| GMV Impact | 23,75% | ❌ **nol** — GMV melekat pada Asset; penulis skrip tidak memiliki Asset |
| Revision Count (inverse) | 19% | ✅ ada |
| Weekly-Note Compliance | 5% | ✅ ada |

47,5% bobot hilang, lalu **M14 Rule 6 meredistribusinya** ke komponen yang
tersisa ⇒ Speed Score jadi **28,5 ÷ 52,5 = ~54%** seluruh skor Rani. Seluruh
penilaiannya runtuh jadi "seberapa cepat kamu", tanpa satu pun ukuran seberapa
banyak yang ia hasilkan.

**Rekomendasi: tetap tunda.** Skor yang **absen** itu jujur; skor yang **salah**
dipakai di review kinerja. Revisit sesudah 2–3 bulan data Kategori nyata, lalu
definisikan profilnya sendiri dengan Output Quantity diukur sebagai *baris
Kategori selesai vs target periode* — bukan Approved Assets. Ini sikap yang sama
yang sudah diambil M14 terhadap dirinya sendiri (GMV Impact dan Optimization
Activity memakai *"illustrative period-target figures"* sampai target nyata ada).

Nol yang terblokir karenanya: kalender, cuti, booking, dan dashboard semuanya
jalan tanpa profil KPI.

---

## 4. Enam hal yang paling mudah dirusak

Disalin dari handoff modul karena sesi baru kemungkinan menyentuh kodenya:

1. **Warn-not-block adalah perilaku.** Tes yang meng-assert 4xx pada konflik
   studio / PIC tidak tersedia menguji perilaku yang **salah** dan akan
   **hijau** kalau modulnya diubah jadi memblokir.
2. **Nol `EXCLUDE USING gist`** — jawaban Postgres yang "benar" memblokir.
3. **Tumpang-tindih setengah terbuka; rentang cuti inklusif.** Dua fungsi
   berbeda di `core/dailyops.ts`, masing-masing ada tesnya.
4. **`actual_qty` NULL ≠ 0.** NULL = slot belum ditutup.
5. **D5: penyelesaian hari-sama tidak boleh masuk M14.** Dijaga tes yang
   memindai `performance.ts`.
6. **Nol mesin pada `PROD-SLOT`.** Kalau `status` muncul di `prod_slots` atau
   `SLOT_STATES` di `core/dailyops.ts`, D1 sedang dibatalkan tanpa entri
   `DECISIONS.md`.

## 5. Jebakan lingkungan (kena sesi ini)

- **Cluster Postgres 16 `main` mati sendiri** di tengah sesi.
  `pg_ctlcluster 16 main start && pg_isready` sebelum menyimpulkan apa pun.
- **`node_modules` kosong** di tiga workspace (`make install`).
- **`DATABASE_URL` tidak di-set** — dan itu yang paling berbahaya: seluruh tes
  DB/RLS di-skip diam-diam dan `make test` tetap lapor hijau. Patokan jumlah tes
  yang **jalan** ada di §1; kalau `db` melaporkan 0, variabelnya tidak sampai.

## 6. Yang masih terbuka di luar M19

Dari handoff sebelumnya, belum berubah: **LT-2/LT-8** (pipeline tahapan Store
Operation, ditahan pemilik 2026-09-08 — jangan tanya ulang), **LT-1** (bobot KPI
Store Operation, masih 0), **O75** (Service tidak punya jalur ke Done — edge
`[In Execution] → Done` ada di `sm_edges` dengan nol pemanggil), **O76** (asal
floor GMV bulanan), dan **§2.2 browser UAT enam butir feedback Sales**.
