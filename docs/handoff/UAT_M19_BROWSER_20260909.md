# UAT peramban — M19 enam layar (2026-09-09)

Menjalankan `TUTORIAL_UAT_M19_SALES_DRIFT_20260909.md` §0 + §1. **Utang B2 atas
kedua PR M19 (#334, #335) sekarang lunas** — keenam layar sudah dilihat
di Chromium sungguhan, bukan sekadar lolos `next build`.

| | |
|---|---|
| Commit | `c14ac5e` (branch `claude/dreamy-noether-ur790j`) |
| DB | lokal, `db-rebuild.sh` → gate **155 · 43 · 34 · 73** + 4 invariant hijau |
| Fixture | `seed-browser-tour.ts` → `CLI-202609-0001` |
| Aktor | EMP-0003 Creative staff · EMP-0011 Creative **lead** · EMP-0012 **OD murni** · EMP-0008 Director · (EMP-0013 staff Creative kedua, lihat §5) |
| Server | `apps/api` :3001 + `web-internal` :3000, proxy terbukti (401 tanpa cookie → 200 dengan cookie) |
| Tangkapan layar | 26 PNG; empat bukti kunci di `screenshots/uat-m19-*.png` |

## 1 · Hasil ringkas

| | Butir | PASS | FAIL |
|---|---|---|---|
| Tur pasif 6 layar × 4 aktor | 24 | 24 | 0 |
| §1.1–§1.3 interaktif (jadwal, rekap, ketersediaan) | 28 | 26 | **2** |
| §1.4–§1.6 interaktif (SCS, rekap, kategori) | 34 | 33 | **1** |
| **Total** | **86** | **83** | **3** |

**Ketiga FAIL adalah SATU cacat yang sama** (§2). Nol cacat lain. Tur pasif:
`status: 200` dan `console-errors: 0` di 24/24 — tetapi itu syarat minimum, dan
justru cacat §2 membuktikan kenapa: ia lolos 200, lolos nol console error,
lolos typecheck, lolos 736 tes — dan tetap salah di layar.

## 2 · ✅ TEMUAN (SUDAH DIPERBAIKI 2026-09-10) — nama klien & nama PIC hilang, tepat untuk peran yang paling memakainya

> **STATUS: DIPERBAIKI & DIVERIFIKASI.** Ketujuh situs `left join` diganti
> pemanggilan resolver; UAT yang menemukannya dijalankan ulang dan kini
> **62/62 PASS** (dari 59/62). Rinciannya §2b.
> → `screenshots/uat-m19-05-nama-sesudah-perbaikan.png`

**Gejala.** Untuk **lead Creative** — pengguna utama layar jadwal, "Leader Video"
yang menyusunnya — setiap kartu slot menampilkan `CLI-202609-0001` dan
`EMP-0003`, bukan "Tur Browser Demo Store" dan "Rian Pratama". Sama di tiga
tempat:

| Layar | Kolom | Yang tampil (lead) | Seharusnya |
|---|---|---|---|
| `/creative/schedule` | kartu slot | `CLI-202609-0001` · `EMP-0003` | nama klien · nama PIC |
| `/creative/schedule` | "Tidak tersedia hari ini" | `EMP-0003 (Cuti)` | `Rian Pratama (Cuti)` |
| `/creative/scs/rekap` | kolom PIC | `EMP-0003` | `Rian Pratama` |

**Bukan cacat kelas O43** (kunci hilang): kuncinya ADA, isinya **string kosong**.
FE sudah benar — ia punya fallback `s.assigned_pic_nama || s.assigned_pic`, dan
fallback itulah yang kita lihat bekerja.

**Payload sungguhan, per peran** (`GET /creative/schedule/<hari>`):

| Aktor | `assigned_pic_nama` | `client_name` |
|---|---|---|
| **EMP-0011 Creative lead** | `''` | `''` |
| EMP-0003 Creative staff | `'Rian Pratama'` (barisnya sendiri) | `''` |
| EMP-0008 Director | `'Rian Pratama'` | `'Tur Browser Demo Store'` |
| EMP-0012 OD murni | `'Rian Pratama'` | `'Tur Browser Demo Store'` |

**Akar, terverifikasi di `pg_policy`.** `dailyops.ts` `SLOT_FROM` memakai
`left join clients` + `left join employees`, dan bacanya lewat `readAsActor` —
jadi RLS kedua tabel itulah yang menentukan apakah join menghasilkan baris:

```
employees_select : jwt_can_read_all() OR employee_id = jwt_employee_id()
                                      OR created_by  = jwt_employee_id()
clients_select   : jwt_can_read_all() OR sales_pic/assigned_am/... = diri
                                      OR jwt_division() = 'Finance'
                                      OR (jwt_is_lead() AND jwt_division() = 'Account') ...
```

Tidak satu pun lengan itu memuat lead Creative. `LEFT JOIN` → NULL →
`?? ''` → sel kosong → FE jatuh ke ID. Staff melihat namanya SENDIRI hanya
karena lengan `employee_id = jwt_employee_id()`, dan itu sekaligus menjelaskan
kenapa `client_name` tetap kosong untuknya.

**Kenapa ini lolos selama ini, dan kenapa itu penting.** Ia **tidak bisa
terlihat** oleh Director maupun OD — keduanya lolos `jwt_can_read_all()`. Ini
persis bentuk cacat feedback Sales `#2` ("Owner tampil nama, bukan `EMP-…`"),
yang catatan handoff-nya sendiri sudah memperingatkan: *"OD/Director lolos
`jwt_can_read_all()` dan tidak pernah melihat bug-nya"*. Kelas cacat yang sama
muncul lagi di modul baru — dan hanya ketahuan karena UAT ini menjalankan
peran lead, bukan Director.

**Belum diperbaiki**, tapi lihat koreksi di bawah — ia jauh lebih kecil daripada
yang ditulis draf pertama laporan ini.

### 2a · KOREKSI (2026-09-10) — resolvernya SUDAH ADA; ini bukan pertanyaan desain

Draf pertama §2 menyimpulkan perbaikannya "menyentuh permukaan permission, jadi
butuh ketokan" antara membangun resolver `SECURITY DEFINER` atau menambah lengan
RLS. **Itu salah, dan dikoreksi di sini.** Ditemukan saat UAT Sales keesokan
harinya: `sales.ts` baris 2240 memanggil `private.employee_display_name(...)` —
resolver yang persis dimaksud, dan ia sudah ada sejak **O37**
(`20260724134427_employee_display_name.sql`):

```sql
CREATE FUNCTION private.employee_display_name(p_employee_id text) RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce((SELECT e.nama FROM public.employees e
                    WHERE e.employee_id = p_employee_id), p_employee_id) $$;
-- GRANT EXECUTE ... TO authenticated, service_role
```

Ia sudah di-`GRANT` ke `authenticated`, sudah jatuh balik ke id-nya sendiri bila
tidak ketemu, dan **sudah dipakai 9 modul domain** (`account`, `activity`,
`client`, `finance`, `sales`, …). Padanan untuk nama klien juga ada:
`private.client_toko`.

**Jadi M19 tidak menemukan lubang arsitektur — M19 menyimpang dari pola rumah
yang sudah berdiri.** Tujuh tempat memakai join mentah alih-alih resolver:

```
packages/domain/src/dailyops.ts:307, 695, 795, 826, 858   left join employees …
packages/domain/src/scs.ts:350, 986                        left join employees …
+ `left join clients c` di SLOT_FROM (nama klien)
```

Konsekuensinya untuk rencana kerja:

| | Draf pertama | Sebenarnya |
|---|---|---|
| Butuh ketokan pemilik | ya, dua opsi | **tidak** |
| Butuh migrasi | ya (fungsi baru) | **tidak** — fungsinya sudah di live |
| Butuh perubahan izin | mungkin | **tidak** — nol policy disentuh |
| Bentuk pekerjaan | desain + implementasi | **mekanis**: ganti 7 join dengan pemanggilan resolver, plus tes |

⚠️ Yang TETAP berlaku dari draf pertama: **sapu dulu**. Sapuannya sudah
dikerjakan — hasilnya §2c.

### 2b · Perbaikan yang mendarat (2026-09-10)

`packages/domain/src/dailyops.ts` (5 situs) dan `scs.ts` (2 situs):
`left join clients`/`left join employees` → `private.client_toko(...)` /
`private.employee_display_name(...)`, termasuk `order by`/`group by` yang ikut
bergantung padanya. **Nol migrasi, nol policy, nol perubahan izin.**

Payload yang sama, diukur ulang per peran sesudah perbaikan:

| Aktor | `assigned_pic_nama` | `client_name` |
|---|---|---|
| **EMP-0011 Creative lead** | `'Rian Pratama'` | `'Tur Browser Demo Store'` |
| EMP-0003 Creative staff | `'Rian Pratama'` | `'Tur Browser Demo Store'` |
| EMP-0008 Director | `'Rian Pratama'` | `'Tur Browser Demo Store'` |

**Enam tes regresi** di `dailyops-scope.rls.test.ts` (3) dan
`scs-scope.rls.test.ts` (3) — di berkas `*-scope.rls.test.ts` karena hanya
`withClaims` yang bisa membedakan resolver dari join; `dailyops.test.ts` dan
`scs.test.ts` BYPASSRLS dan hijau di kedua bentuk.

**Keenamnya dibuktikan MERAH tanpa perbaikannya**: kode sengaja dikembalikan ke
bentuk join, keenam tes gagal, lalu perbaikannya dipasang lagi. Dan yang paling
penting dari percobaan itu: **19 tes lama tetap HIJAU saat cacatnya hidup** —
bukti langsung bahwa suite yang ada memang tidak bisa menangkap kelas cacat ini.

Satu invariant M19 dijaga ke arah SEBALIKNYA: baris "all client"
(`client_id` NULL) harus tetap ber-`clientName` **null**. `client_toko(NULL)`
mengembalikan NULL — mengubahnya jadi `coalesce(..., client_id)` gaya
`employee_display_name` akan membuat FE berhenti merender "Semua klien".

### 2c · Hasil sapuan modul lain

Sapuan atas SETIAP `left join employees` / `left join clients` di
`packages/domain`. Yang menentukan bukan bentuk join-nya, melainkan **apakah
baca itu berjalan di bawah RLS**:

| Situs | Jalur baca | Terdampak? |
|---|---|---|
| `dailyops.ts` ×5, `scs.ts` ×2 | `readAsActor` | **YA — diperbaiki** |
| `kol.ts:236` (`coordinator_nama`) | `db()`, sengaja unscoped & berdokumentasi di rutenya | tidak |
| `task.ts:947,960` (`requested_by_nama`) | `db()` (rute block-request) | tidak |
| `leads.ts:1393,1422` (`owner_name`) | `tx` privileged di dalam transaksi tulis, DAN sudah `coalesce(e.nama, id)` | tidak |
| `finance.ts:1633` (`directorIds`) | inner join, jalur notifikasi privileged, bukan nama tampilan | tidak |
| ±60 `join clients` lain | INNER join sebagai mekanisme row-scoping RLS | tidak — **jangan disentuh** |

**Kesimpulan sapuan: kelasnya terbatas pada M19 saja.** Modul lain sudah memakai
resolver (9 modul) atau memang membaca unscoped dengan sengaja. Yang tersisa
sebagai pelajaran, bukan sebagai tiket: `left join` untuk NAMA hanya aman di
jalur yang tidak ber-RLS, dan itu tidak terbaca dari bentuk kuerinya — harus
dilacak sampai rutenya.

## 3 · Yang TERBUKTI benar (83 butir)

### §1.1 Jadwal produksi — *warn-not-block* nyata, bukan sekadar teks
- Keempat studio tampil; studio nol slot merender **"Bebas"** (4/4 sebelum ada slot).
- Luar Kantor berlencana **"tanpa cek konflik"**.
- **Dua slot bertumpang: KEDUANYA tersimpan dan KEDUANYA tampil**, dua kartu
  bergaris kuning, pita **"Tersimpan, dengan catatan"** berisi `[studio Kasuari
  sudah dipakai pada rentang waktu ini]`, dan **nol** `.alertError`.
  → `screenshots/uat-m19-01-bentrok-warn-not-block.png`
- Studio ber-`cek_konflik = false`: tumpang-tindih **tanpa** peringatan.
- Form "Tambah slot" ada untuk lead, **hilang** untuk staff dan OD.

### §1.2 Rekap jadwal
- **"Bukan KPI"** + "Modul 14" dinyatakan di layar.
- Staff melihat "Anda melihat baris Anda sendiri"; lead dan OD tidak (tidak terkunci).

### §1.3 Ketersediaan
- Kotak **"Ini bukan pengajuan cuti."** ada.
- Ketidaktersediaan tersimpan → muncul di "Tidak tersedia hari ini" pada jadwal.
- Menjadwalkan PIC yang tidak tersedia: peringatan `[PIC tidak tersedia pada
  tanggal ini]` **dan slotnya tetap tersimpan**.
  → `screenshots/uat-m19-02-pic-tidak-tersedia.png`
- Staff: nol form (D4 Leader-saja).

### §1.4 Antrean SCS — gerbang peran, butir yang paling mudah dirusak
- Baris tanpa klien merender **"Semua klien"**, bukan sel kosong.
  → `screenshots/uat-m19-03-semua-klien.png`
- Kategori standing bertanda **"· standing"** (`Upload & Checklist · standing`).
- **`canWorkTask` terbukti lebih sempit:** lead melihat hanya `Cabut` pada baris
  orang lain — **nol** `Mulai`/`Submit`. PIC-nya melihat `Mulai` → `[In Progress]`,
  lalu `Submit` → `[Submitted]`.
- **Kebalikannya juga terbukti:** pada `[In Progress]`, PIC melihat `Submit`
  saja dan **lead** yang melihat `Blokir`.
- Lead pada `[Submitted]`: `Buka review` + `Minta revisi`; pada `[In Review]`:
  `Setujui`.
- OD murni: tabel penuh terbaca, **nol** tombol aksi, **nol** form.

### §1.5 Rekap SCS
- **"Angka ini bukan KPI."** dinyatakan di layar.
- Kolom **Standing selesai** terpisah dari **Deliverable selesai**.

### §1.6 Kategori
- Empat Kategori seed tampil; SLA dua Kategori standing kosong.
- **standing = ya MENGOSONGKAN dan MEMATIKAN (`disabled`) input SLA** — penolakan
  server `[kategori standing tidak boleh punya SLA …]` tidak pernah jadi kejutan.
  → `screenshots/uat-m19-04-kategori-sla-standing.png`
- Kategori baru tersimpan dan langsung muncul di dropdown antrean.
- Staff dan OD: daftar terbaca, nol form.

### Invariant Speed Score — dibuktikan di API, bukan di layar (lihat §4)
Satu baris standing dan satu baris deliverable dibawa sampai `[Approved]`:

| Baris | Kategori | standing | status | `speed_score_display` |
|---|---|---|---|---|
| `SCS-…-0010` | `UPLOAD_CHECKLIST` | **true** | `[Approved]` | **`N/A`** |
| `SCS-…-0009` | `SCRIPT` | false | `[Approved]` | `0.01%` |

Standing tetap `N/A` **walau sudah Approved** — bukan `0%`, dan bukan sekadar
efek "belum selesai".

## 4 · Tiga koreksi atas tutorialnya sendiri

Ditemukan dengan MENJALANKANNYA. Tutorial sudah diperbarui pada commit yang sama.

1. **§1.5(c) tidak bisa diuji di layar.** Speed Score **tidak dirender** di
   antrean maupun rekap SCS — kolomnya tidak ada. `speed_score_display` hanya
   ada di `GET /creative/scs/tasks/{id}`. Butirnya dipindah jadi cek API.
2. **§1.2(b)/(c) salah alat.** Halaman rekap jadwal **tidak punya picker PIC**;
   cakupan ditentukan server (`canSeeAllPics`) dan yang tampak di layar adalah
   kalimat "Anda melihat baris Anda sendiri" pada yang TERKUNCI saja.
3. **§1.4(h) understated.** `ownRowsOnly(actor)` mengunci antrean staff ke
   `assigned_pic = dirinya`, jadi baris orang lain **tidak ada** di antrean —
   bukan sekadar kehilangan tombol. Asersinya diperkuat.

Plus dua detail lingkungan: picker PIC ketersediaan ber-id **`orang`** (bukan
`pic`), dan `innerText` mengembalikan teks SESUDAH `text-transform` CSS —
perbandingan judul kolom harus case-insensitive.

## 5 · Aktor yang dibutuhkan, di luar yang sudah ditulis tutorial

Seed Sprint-0 tidak punya Creative lead maupun OD murni — itu sudah ada di
tutorial §0.5. Yang **belum** dan ditambahkan sekarang: **staff Creative
KEDUA** (`EMP-0013`, Creative Designer). Tanpanya §1.4(h) tidak bisa diuji sama
sekali: "baris milik PIC lain" mustahil dibuat kalau hanya ada satu staff
Creative.

## 6 · Yang TIDAK dijalankan

- **§2 UAT enam butir Sales** — belum. Lingkungannya masih nyala dan siap.
- **§3 mengisi 21 Kategori + 8 Sub Type** — butuh pemilik.
- **§4 drift check penuh** — tetap tidak bisa dari sandbox.
- ~~Perbaikan temuan §2~~ — ✅ selesai 2026-09-10 (§2b), termasuk sapuan (§2c).
