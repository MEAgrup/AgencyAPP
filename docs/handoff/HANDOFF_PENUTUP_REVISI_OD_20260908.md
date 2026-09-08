# Handoff — Penutup program Revisi OD: langkah A (tutup) lalu B (utang teknis)

> **Ditulis 2026-09-08**, sesudah Wave 3 Store Operation di-merge ke `main`.
> Ini titik mulai chat berikutnya. **Baca §0 dulu** — ada satu langkah di §2
> yang salah urutannya berakibat pada keamanan, bukan cuma kerapian.
>
> Pendahulunya: `HANDOFF_WAVE3_STORE_OPS_LANJUTAN_20260908.md` (apa yang sudah
> dibangun + jebakan sesi itu) dan `HANDOFF_LANJUT_20260908_JALUR_A_TUTUP.md`
> §2 + §7 (kesalahan yang sudah dibayar mahal + sembilan jebakan — **masih
> berlaku**).

---

## 0. Posisi & rekomendasi urutan

| Apa | Nilai |
|---|---|
| Feedback OD | **10 dari 10 keluhan tertutup** |
| Wave 3 | **8 dari 10 butir selesai**; butir 5 (pipeline, LT-2) dan 9 (bobot KPI, LT-1) **ditahan pemilik 2026-09-08** — jangan tanyakan ulang |
| Migrasi di repo | **204** |
| Gate | 147 tabel · 41 entity_prefix · 32 sm_machines · 73 notif_events |
| Live (`CDPS SG`, `egddxfcnrtecheiykhlf`) | **200 migrasi — tertinggal EMPAT.** Lihat §2 |

### Mulai dari mana — rekomendasi

**Kerjakan A sampai habis dulu, baru B.** Alasannya bukan kerapian: sampai §2
selesai, **produksi menjalankan kode yang berbeda dari yang diuji CI**, dan setiap
temuan baru di B akan sulit dipisahkan dari akibat drift itu.

Di dalam A, urutannya **A1 → A2 → A3**, dan A2 tidak boleh dilompati ke A3.

Di dalam B, mulai dari **B1 (`Makefile`)** — lima menit, dan ia satu-satunya yang
saat ini bisa membuat orang menjalankan perintah yang menunjuk pohon yang sudah
diarsip. Lalu **B2 (harness peramban)**, karena ia membuka jalan untuk semua utang
layar sekaligus dan dipakai selamanya sesudahnya.

---

## 1. A1 — sudah SELESAI (dicatat supaya tidak dikerjakan ulang)

Branch `claude/handoff-store-ops-lanjutan-ovk4sh` sudah di-merge ke `main` lewat
PR. Termasuk di dalamnya: merge `origin/main` (PR #320/#321, penyatuan bentuk
`Brief` FE) ke dalam branch, diverifikasi ulang penuh sesudahnya.

> ⚠️ **Utang "empat bentuk `Brief` paralel di FE" SUDAH DIBAYAR** oleh PR #320 —
> rumahnya sekarang `web-internal/src/lib/brief.ts`, dan `account.ts`/`tasks.ts`/
> `creative.ts`/`kol.ts` me-re-export dari sana. Handoff-handoff LAMA masih
> menyebutnya sebagai utang terbuka; **itu sudah kedaluwarsa, jangan dikerjakan
> lagi.**

---

## 2. A2 — apply EMPAT migrasi ke live `CDPS SG`

### ⛔ Urutan bukan preferensi. Ini yang harus diapply, PERSIS urut nama:

| # | Berkas | Kenapa belum ada di live |
|---|---|---|
| 1 | `20260922100400_a3_backfill_service_strategy_approved.sql` | Satu-satunya yang mengubah **DATA**. Di live ia **no-op** (0 baris memenuhi kriterianya, diverifikasi). Aman di-apply dan aman tidak |
| 2 | `20260922100500_areq3_private_brief_jumlah_anak.sql` | **Tertinggal tanpa disengaja.** Ia MEMBUAT `private.brief_jumlah_anak` — artinya kolom "Unit Kerja" di `/tasks` **tidak berfungsi di produksi hari ini** |
| 3 | `20260924010000_m18_store_ops_sku.sql` | M18 — tabel `store_ops_skus`, prefix `SKU`, mesin #32 |
| 4 | `20260924020000_m18_store_ops_kuota_satuan.sql` | M18 — kuota satuan + `wrr_aggregate` |

**Aturan live (O65):** hanya lewat `apply_migration`, **per berkas**, urut nama.
**JANGAN `supabase db push`** — ledger live memakai stempel waktu APPLY, bukan
nama berkas repo, jadi push membandingkan dua hal yang memang berbeda wholesale.

### Dua hal yang harus diketahui sebelum menekan apply

1. **Berkas #4 menyentuh `wrr_aggregate`**, fungsi yang dipakai job rekap
   mingguan. Ia `CREATE OR REPLACE` (nol downtime), tapi jalankan **di luar jam
   job** supaya tidak ada rekap yang setengah memakai definisi lama.
2. **Berkas #2 sebelum #3 — ini soal keamanan, bukan kerapian.** #3 me-`CREATE
   OR REPLACE` `private.brief_jumlah_anak` untuk menambah cabang Store Operation.
   Kalau #3 jalan lebih dulu di DB yang belum punya fungsinya, fungsinya **lahir
   baru**, dan fungsi baru di Postgres lahir dengan `EXECUTE` untuk **PUBLIC**.
   Untuk fungsi SECURITY DEFINER itu bukan detail.
   > Sudah dipagari 2026-09-08: #3 sekarang menegakkan sendiri REVOKE/GRANT-nya,
   > divalidasi-mutasi dua arah. Jadi urutan yang salah **tidak lagi** berakibat
   > buruk — tetapi tetap jalankan urut nama, karena pagar itu satu-satunya yang
   > menahan dan pagar tidak dipakai untuk dilanggar.

### Sesudah apply — verifikasi, jangan percaya `success: true`

```sql
-- gate harus SAMA dengan lokal
select (select count(*) from information_schema.tables
         where table_schema='public' and table_type='BASE TABLE') as tabel,   -- 147
       (select count(*) from entity_prefix)  as prefix,                        -- 41
       (select count(*) from sm_machines)    as mesin,                         -- 32
       (select count(*) from notif_events)   as event;                         -- 73

-- permukaan EXECUTE fungsi SECURITY DEFINER yang baru (harus EKSPLISIT, bukan NULL)
select proacl from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='private' and p.proname='brief_jumlah_anak';
-- harapan: {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
-- NULL berarti default PUBLIC ⇒ berhenti, jangan lanjut.

-- baris SKU bisa dibaca `authenticated` (jebakan client_milestones)
select has_table_privilege('authenticated','public.store_ops_skus','SELECT');   -- t
```

Lalu jalankan `get_advisors` (security) dan bandingkan dengan temuan sebelumnya —
**nol temuan BARU**, bukan "nol temuan".

---

## 3. A3 — entri `docs/DECISIONS.md`

Dokumen `PARALEL_FEEDBACK_OD_DUA_AKUN.md` §4 langkah 3 mensyaratkan temuan
dipindahkan ke `DECISIONS.md` **di langkah penggabungan, bukan dari dalam jalur** —
karena itu berkas yang paling mahal kalau salah merge. Sesi-sesi Wave 3 mematuhi
itu, jadi **belum ada satu pun entri M18 di sana.** Yang layak ditulis:

1. **Dinding dua penulis M18 dan kenapa BUKAN `jwt_division()`.** Jalur tulis CDPS
   berjalan privileged tanpa klaim JWT; trigger ber-JWT akan melihat `NULL` pada
   setiap tulisan sungguhan — dinding yang selalu terbuka, lebih buruk daripada
   nol dinding karena ia *terlihat* seperti perlindungan. Yang dipakai penanda
   transaction-local `cdps.sku_writer`.
2. **`actual_done` diturunkan, bukan kolom.** Worksheet aslinya punya kolom yang
   diketik; tanggal yang diketik bisa **dimundurkan** sesudah tenggat lewat.
   Preseden M16 Rule 4 + `internal_tasks`.
3. **LT-2 dan LT-1 ditahan pemilik 2026-09-08**, sesudah ditanyakan dengan opsi
   konkret. Statusnya "diputuskan menunggu", bukan "belum dijawab".
4. **A-req-3 tertinggal dari live** sampai 2026-09-08 — kolom "Unit Kerja" tidak
   pernah berfungsi di produksi sejak dirilis. Ditemukan lewat pembandingan
   repo↔live, **bukan** oleh tes mana pun; tes domain memakai koneksi service-role
   dan buta terhadap kelas cacat ini (kelas yang sama dengan `client_milestones`).

Butir 4 layak juga jadi **usulan proses**: pembandingan repo↔live tidak punya
gerbang otomatis sama sekali hari ini. Itu kandidat B berikutnya kalau pemilik mau.

---

## 4. B — utang teknis, sesudah A selesai

Diurutkan sesuai rekomendasi §0.

| # | Utang | Ukuran | Kenapa di urutan ini |
|---|---|---|---|
| **B1** | **`Makefile` masih shell ke `backend/`** yang sudah diarsip C-05 | ~5 menit | Satu-satunya yang bisa membuat orang menjalankan perintah ke pohon yang sudah tidak ada. Murah, dan menghapus jebakan |
| **B2** | **Harness peramban + 11 layar yang belum pernah dilihat mata** | 1 sesi | Chromium sudah ada di `/opt/pw-browsers/chromium` (`PLAYWRIGHT_BROWSERS_PATH` sudah di-set) — yang kurang **harness + jalur login**. Sekali bangun, dipakai selamanya. Setiap perubahan render sejak Gelombang C lolos `tsc` + `vitest` + `next build` **tanpa satu mata pun melihat tata letaknya** |
| **B3** | **Gerbang drift repo↔live** | ½ sesi | Lihat §3 butir 4. Hari ini nol gerbang; A-req-3 hilang berbulan-bulan tanpa ada yang merah |
| **B4** | **P2.5 — pangkas round-trip `withClaims`** | ½ sesi | `REVISI_CDPS_SALES_CREATIVE_PERFORMA.md` masih ⬜. **Baca catatan risikonya dulu** — ada peringatan kebocoran klaim antar-request di sana |
| **B5** | **X-12 — komponen KPI "point log buruk"** | menunggu pemilik | `M6ABC_BACKLOG.md`, 🟡 *"rumahnya akan dibuat menyusul"*. **Batasnya sudah tertulis:** B-09 boleh mencatat ke audit log, **tidak boleh** mengklaim memengaruhi Performance Score |

### Daftar 11 layar untuk B2

Sembilan lama (handoff `JALUR_A_TUTUP` §5b): `/finance` (nama toko baris pertama;
panel "Permintaan ke Finance" 8 kolom tanpa scroll horizontal) · `/finance/transactions/{id}`
· `/persetujuan` (kartu Finance **dan** seksi Strategi) · `/kol/payment-requests/{id}`
· `/account/services/{id}` · `/sales/{id}` · `/account/strategies/{id}` · `/tasks`
(kolom "Unit Kerja" + badge "belum dipecah").
Dua baru (M18): **`/store-ops`** dan **`/store-ops/briefs/[id]`**.

> `/tasks` dan `/store-ops` **baru akan menampilkan angka yang benar sesudah A2** —
> `private.brief_jumlah_anak` belum ada di live. Jadi B2 sesudah A, bukan sebelum.

---

## 5. Jebakan yang masih hidup — bayar sekali, jangan dua kali

1. **Postgres di container ini MATI SENDIRI** sewaktu-waktu, termasuk di tengah
   sesi. `pg_isready` dulu sebelum menyimpulkan apa pun dari puluhan FAIL.
2. **Jangan jalankan dua suite `packages/domain` bersamaan atas DB yang sama.**
   Menghasilkan dua FAIL palsu yang sama persis setiap kali (`admin.test.ts` hari
   libur, `client.test.ts` Hold Service) — `audit_log` menolak DELETE jadi
   `afterEach` tidak bisa membersihkannya. **`db-rebuild` dulu, baru percaya
   angkanya.**
3. **`npm run typecheck --workspaces` WAJIB diulang SESUDAH `npm install`.**
4. **Tes yang MENGHITUNG baris audit butuh id sekali-pakai per run** (pola
   `RUN = Date.now()...`), karena `audit_log` menolak DELETE.
5. **`shape-parity` punya DUA tempat pendaftaran** — `WIRE_TO_FE` dan `FE_FILES`.
6. **`punyaKuotaSatuan` menarik TIGA hal**, bukan satu: `TASK_CATALOG`, CHECK
   constraint `wrr_divisi`/`wrr_catatan_divisi`, dan cabang `wrr_aggregate`. Yang
   ketiga paling berbahaya — divisi diakui tanpa cabang agregat ⇒ rekap melaporkan
   produksi **0** untuk tim yang bekerja, tanpa galat.
7. **`KNOWN_GAPS` di `route-parity.test.ts` wajib tetap kosong.**

---

## 6. Angka acuan — naik, tidak pernah turun

```
db-rebuild.sh  204 migrasi
  gate: 147 tabel · 41 entity_prefix · 32 sm_machines · 73 notif_events
  invariant: ident_checks · immutability_checks · rls_checks · auth_claims_checks

domain            2157 lulus (+1 skip) · 79 file · nol FAIL
core               983
db                  64
apps/api           494       route-parity (KNOWN_GAPS kosong) & shape-parity hijau
web-internal       694       (+ tsc --noEmit bersih + next build sukses)
web-client-portal   19
```

---

## 7. Menunggu ketokan pemilik — tidak memblokir A maupun B

- **LT-2 / LT-8** — daftar & urutan tahapan Store Operation. **Ditahan
  2026-09-08, jangan tanyakan ulang.** Biaya memasangnya nanti: satu migrasi
  (mesin `stage_store_ops` ⇒ gate 32→33 di `db-rebuild.sh` **dan** `ci.yml`,
  satu baris `stage_pipeline`, n baris `stage_definition` dengan `Cek Brief AM`
  di depan + edge balik LT-4) + kode alasan LT-8 di `REASON_CODES_BY_DIVISION`.
- **LT-1** — bobot KPI Store Operation, tetap 0. **Ditahan 2026-09-08.**
- **O75** — Service tidak punya satu pun jalur untuk SELESAI. Edge
  `[In Execution] → Done` ada di `sm_edges`, **nol pemanggil** di seluruh
  `packages/domain`. Setiap Service yang pekerjaannya tuntas menumpuk selamanya.
- **O76** — dari mana floor GMV bulanan datang. Selama terbuka, Sanggahan Target
  (D-7) kehilangan penegaknya.
- **Peran Creative terpisah** (Strategist / Content Creator / SMO) + jadwal harian
  leader — K-1 menyisihkannya sebagai wave sendiri.
