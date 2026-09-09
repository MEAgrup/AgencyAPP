# CDPS — Module 19: Creative Daily Ops

**Status:** **LENGKAP 2026-09-09.** Separuh jadwal harian (Gap A/D/E/F, ketokan D1/D3/D4/D5/D8) + separuh `SMO & Content Strategist` (Gap B/G/I) sesudah ketokan `M19-SCS-ENGINE` opsi (b) — lihat §12 (riwayat pertanyaannya) dan §13 (yang dibangun)
**Worked example:** Kamis 10 Sep 2026 — tiga slot di dua studio, satu bertumpang, satu PIC cuti (§4)
**Depends on:** Module 6 (Brief), Module 7 (Creative Asset — lapisan eksekusi di atas modul ini), Module 12 (Task Execution engine), Phase 0 (Role Matrix, ID, audit)
**Resolves:** `docs/DECISIONS.md` K-1 (2026-09-07) — bagian "jadwal harian leader" dari wave yang ditunda

---

## 1. Background

Leader Video menjalankan seluruh produksi kreatif MEA dari dua Google Sheets
(4.154 baris, Jan–Sep 2026) plus tiga worksheet per-peran. Modul 7 memodelkan
Brief → Asset dengan loop review, tapi **lapisan di bawahnya tidak ada di CDPS
sama sekali**:

- **Perencanaan adalah grid hari × studio × PIC × slot waktu.** Jadwal besok
  disusun HARI INI, sebelum satu pun Asset ada. Antrean M7 adalah per-PIC
  per-status — nol konsep hari, nol studio, nol slot waktu.
- **Tidak ada yang tahu seorang PIC sedang tidak ada.** Baris di sheet secara
  literal berbunyi "RAMDANI CUTI"; Leader mengingatnya sendiri.
- **Tidak ada yang mencegah dua klien masuk satu studio pada jam yang sama** —
  dan ternyata itu memang tidak selalu salah (lihat Rule 8).
- **"Apakah PIC menyelesaikan yang dijadwalkan HARI INI" tidak punya rumah.**
  Speed Score M12 mengukur SLA turnaround multi-hari per Asset — grain yang
  salah untuk slot shoot-lalu-edit dalam satu sesi.

Modul ini membangun lapisan **RENCANA** di bawah lapisan **EKSEKUSI** milik M7.
Ia tidak memperkenalkan jalur istimewa: PIC tetap membuat Asset secara
inkremental lewat pintu M7 yang sama, dan review tetap milik AM.

---

## 2. Rules

1. **`PROD-SLOT` adalah RENCANA, bukan deliverable.** Ia mencatat niat (hari,
   studio, PIC, klien, paket, target qty, waktu) dan **tidak punya mesin status
   maupun SLA sendiri**. Eksekusi dan review tetap milik Asset/Task (M7/M12).
   Satu slot boleh menghasilkan nol atau banyak Asset.
2. **Slot tidak pernah membuat Asset lebih awal.** Ini yang menjaga **M7-OA-6**
   ("PIC creates Assets incrementally as work starts, not all pre-created
   upfront"). Merencanakan besok tidak boleh memaksa baris Asset lahir hari ini.
3. **Slot ber-`client_id`, BUKAN `brief_id`** — konsekuensi langsung Rule 2.
   Sebuah view di atas Asset hanya bisa menampilkan baris yang sudah ada, jadi
   pendekatan "cukup bikin view" akan membatalkan M7-OA-6 (rasionalisasi penuh:
   gap analysis §7.1).
4. **Tumpang-tindih studio MEMPERINGATKAN dan tetap menyimpan** (D3). Slot kedua
   di studio yang sama pada jendela waktu yang bertumpang menampilkan peringatan
   dan **tersimpan**. Nol blokir server-side. Alasannya bukan kelonggaran:
   tumpang-tindih memang kadang benar ("dua shoot berbagi sudut ruangan yang
   sama"), dan sistem yang memblokirnya akan dilewati dengan mencatat jadwal di
   luar sistem — persis keadaan yang modul ini ada untuk mengakhiri.
5. **Tumpang-tindih itu SETENGAH TERBUKA.** 09.00–12.00 dan 12.00–14.00 adalah
   dua sesi bersambung, **bukan** konflik. Perbandingan tertutup akan
   memperingatkan setiap pasangan slot yang berurutan rapi — yaitu justru jadwal
   yang paling benar, dan peringatan yang selalu muncul adalah peringatan yang
   berhenti dibaca.
6. **`Luar Kantor` tidak pernah diperiksa konflik.** Ia bukan satu ruangan
   melainkan catch-all lokasi luar; dua shoot di dua lokasi luar berbeda bukan
   konflik. Flag per-baris `studios.cek_konflik`, bukan pengecualian di kode.
7. **Ketidaktersediaan PIC ditulis Leader saja** (D4) — bukan self-service PIC.
   Ia **MEMPERINGATKAN** saat Leader menjadwalkan orang yang tidak ada; ia tidak
   memblokir (konsisten Rule 4 — modul ini memperingatkan, ia tidak menggerbang).
8. **Rentang ketidaktersediaan INKLUSIF dua ujung** — beda dari Rule 5, dan
   bedanya disengaja: cuti "10–12 September" berarti tanggal 12 orangnya masih
   tidak ada.
9. **Ketidaktersediaan adalah catatan PRODUKSI, bukan catatan cuti HR.**
   `CLAUDE.md` eksplisit bahwa CDPS bukan HRIS dan integrasinya read-only
   `GET /employees` tanpa endpoint cuti. Tabelnya karena itu **nol approval, nol
   saldo, nol kuota, nol entitlement, nol carry-over** — dan batas itu ditegakkan
   oleh apa yang tidak ada di skemanya, bukan oleh komentar. Pengecualian
   berbatas ini dicatat di `docs/DECISIONS.md` 2026-09-09.
10. **Penyelesaian hari-sama adalah angka OPERASIONAL Leader** (D5).
    `actual_qty ÷ target_qty`, di-rollup per PIC per periode. Ia **TIDAK** masuk
    Modul 14 dan tidak punya bobot KPI. Speed Score M12 (SLA multi-hari) dan
    angka ini mengukur hal berbeda dan mendarat di tempat berbeda — jangan
    dicampur saat membangun. Dijaga tes, bukan cuma komentar: satu tes memindai
    `performance.ts` dan gagal kalau ia mengimpor modul ini.
11. **Konten internal/rumah di luar cakupan** (D8). DEVTALK, Skilskul, Sebari,
    MEA Digi tidak dilacak, tidak dihitung, dan tidak dibuatkan record "klien
    internal". CDPS tidak punya pendapat tentangnya.
12. **Field turunan read-only dan bisa dihitung ulang** (aturan rumah #4). Nol
    kolom `sisa`, nol `persen`, nol `on_time`, nol durasi tersimpan. Pembagian
    nol dirender `—`, bukan 0 dan bukan galat (aturan rumah #7).
13. **Sisa tidak di-rollover otomatis.** Slot yang tercapai 9 dari 15
    mempertahankan angka 9/15-nya; Leader membuat slot BARU besok. Auto-rollover
    berarti angka slot pertama bisa berubah sesudah faktanya.

---

## 3. Entitas

### 3.1 `prod_slots` — prefix `SLOT`, NOL mesin status (Rule 1)

| Field | Tipe | Catatan |
|---|---|---|
| `id` | `SLOT-YYYYMM-NNNN` | di-mint HANYA sesudah validasi field wajib lolos (aturan rumah #1) |
| `tanggal` | date | **wajib** |
| `client_id` | ref `clients` | **wajib**. Bukan `brief_id` — Rule 3 |
| `studio_code` | ref `studios` | **wajib** |
| `waktu_mulai` / `waktu_selesai` | time | **wajib**, `selesai > mulai`. Kolom `time` PERTAMA di CDPS |
| `assigned_pic` | ref `employees` | **wajib**. Divalidasi `creative.validateCreativeStaff` (aktif + divisi Creative + level staff) |
| `jenis_paket` | text | kolom "Jenis Paket" di sheet |
| `task_type` | enum: Shoot / Edit / Script / Voice Over / Other | **wajib**, enum tertutup |
| `target_qty` | int > 0 | **wajib** |
| `actual_qty` | int ≥ 0, nullable | diisi saat slot ditutup. **NULL = belum ditutup, BUKAN nol** |
| `notes` | text | |

`actual_qty` NULL vs 0 adalah beda yang dipakai **dua angka berbeda**: slot fill
membaca null/not-null, penyelesaian hari-sama membaca angkanya. Men-default-kan
NULL ke 0 membuat slot yang belum ditutup terbaca sebagai slot yang gagal total.

### 3.2 `pic_unavailability` — nol prefix, Leader-written (Rule 7/9)

| Field | Tipe | Catatan |
|---|---|---|
| `id` | bigint identity | tidak ada manusia yang menyebut baris ini lewat ID — ia disebut "Ramdani, 10 September" |
| `employee_id` | ref `employees` | **wajib** |
| `tanggal_mulai` / `tanggal_selesai` | date | **wajib**, `selesai >= mulai` |
| `alasan` | enum: Cuti / Sakit / Izin / Dinas Luar | **wajib**, enum tertutup. BUKAN taksonomi cuti HR |
| `catatan` | text | |
| `dicatat_oleh` | ref `employees` | Leader/SPV. **Bukan "penyetuju"** — tidak ada yang disetujui |

**Ada DELETE, tidak ada UPDATE** (trigger `forbid_mutation`): salah catat harus
bisa dicabut, tapi menyunting rentang sesudah jadwal disusun di atasnya mengubah
arti peringatan yang sudah ditampilkan. Cabut lalu catat ulang.

### 3.3 `studios` — registry, di-seed di migrasi

`Kasuari` · `Rajawali` · `Cempaka` · `Luar Kantor` (yang terakhir
`cek_konflik = false`, Rule 6). Pola `division_registry`: di-seed di dalam
migrasi (bukan `seed.sql`, jadi gerbang seed tidak bergerak), ber-kunci `code`,
tiap sifat punya kolomnya sendiri.

---

## 4. Example — Kamis 10 Sep 2026

Leader menyusun Kamis pada Rabu sore.

| Slot | Klien | Studio | Waktu | PIC | Task | Target |
|---|---|---|---|---|---|---|
| `SLOT-202609-0041` | Bakoel Tas | Kasuari | 09.00–12.00 | Killa | Shoot | 25 |
| `SLOT-202609-0042` | Avitaskin | Kasuari | 11.00–14.00 | Alvi | Shoot | 15 |
| `SLOT-202609-0043` | Sagata | Rajawali | 13.00–16.00 | Abay | Edit | 20 |

- Slot 0042 **tersimpan** dengan peringatan
  **`[studio Kasuari sudah dipakai pada rentang waktu ini]`** — Kasuari bertumpang
  11.00–12.00 dengan slot 0041. Leader menerimanya. Rule 4 — warn, never block.
  Keduanya muncul di grid, ditandai dari `bentrok_ids`.
- Ramdani ditandai tidak tersedia 10 Sep (`Cuti`). Menjadwalkannya akan
  memperingatkan **`[PIC tidak tersedia pada tanggal ini]`**; ia tidak
  dijadwalkan, jadi tidak ada yang menyala.
- Kalau slot berikutnya dibuat 12.00–14.00 di Kasuari, **nol peringatan**: ia
  bersambung dengan 0041, bukan bertumpang (Rule 5).

Akhir hari, aktual diisi: Killa 25/25, Alvi 9/15, Abay 20/20.

**Penyelesaian hari-sama Killa** 25 ÷ 25 = 100%. **Alvi** 9 ÷ 15 = 60% — Leader
melihat kekurangan 6 unit di dashboard. Angka ini **tidak pernah** sampai ke
Modul 14 (Rule 10). Slot 0042 tetap 9/15 yang jujur; Leader membuat
`SLOT-202609-0051` Jumat untuk sisa 6 (Rule 13).

---

## 5. System Requirements

### 5.1 Angka turunan — dihitung saat baca, nol kolom penyimpan (Rule 12)

| Angka | Rumus | Tujuan |
|---|---|---|
| Sisa (slot) | `target_qty − actual_qty` | grid; `null` selama belum ditutup |
| Penyelesaian hari-sama (slot) | `actual_qty ÷ target_qty` | grid + dashboard Leader **saja** |
| Penyelesaian hari-sama (PIC, periode) | Σ`actual_qty` ÷ Σ`target_qty` | dashboard Leader **saja** |
| Slot fill | slot ber-`actual_qty` not null ÷ total slot | dashboard Leader |
| `bentrok_ids` (per studio per hari) | `waktuBertumpang` antar saudara sekolom | grid |

`bentrok_ids` dihitung **di server**, dan itu bukan kerapian: `web-internal`
adalah app Next yang berdiri sendiri tanpa `@cdps/core`, jadi menandai bentrok di
halaman berarti definisi KEDUA "bertumpang" — yang akan lupa Rule 5. Faktanya
ber-scope HARI, jadi ia hidup di kolom studio, bukan di baris slot.

### 5.2 Permission (Phase 0 §4 Role Matrix)

| Aksi | Siapa |
|---|---|
| Buat/sunting `PROD-SLOT` | Lead/SPV Creative, Director |
| Isi `actual_qty` | PIC slot itu, atau Lead/SPV Creative, Director |
| Tulis `pic_unavailability` | Lead/SPV Creative **saja** (Rule 7 / D4) |
| Baca jadwal + dashboard | Lead/SPV = seluruh divisi · staff = barisnya sendiri · OD/Director = read-only di mana pun |

**NOL akses AM**, dengan sengaja. Menambahkannya "karena kelihatannya berguna"
adalah menciptakan izin yang tidak pernah diketok siapa pun.

**Catatan peran (koreksi terhadap draft):** `role_mappings` berkunci
`UNIQUE (divisi, jabatan)` → `(division, level)` dengan `level` hanya
`staff`|`lead`; ia tidak punya kolom nama-peran, dan JWT hanya membawa lima
klaim. Ketokan pemilik 2026-09-09: **peran `SMO & Content Strategist` duduk DI
BAWAH divisi Creative** ⇒ nol baris `division_registry` baru, nol level klaim
baru, nol perubahan `employee_claims`. Gerbang yang sudah ada
(`permission.isLead(actor, 'Creative')`) langsung berlaku.

### 5.3 Pesan validasi (aturan rumah #5 — BI, string persis)

**Menolak (4xx):**
- `[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]` — default
- `[jumlah target harus lebih dari 0]`
- `[jumlah aktual tidak boleh melebihi target]`
- `[studio tidak dikenal]` · `[jenis pekerjaan tidak dikenal]`
- `[waktu selesai harus setelah waktu mulai]` · `[tanggal selesai tidak boleh sebelum tanggal mulai]`
- `[alasan tidak tersedia tidak dikenal]`
- `[PIC tidak valid: harus staff divisi Creative yang aktif]` (dari M7, dipakai ulang)

**MEMPERINGATKAN — baris tetap tersimpan (Rule 4/7):**
- `[studio Kasuari sudah dipakai pada rentang waktu ini]` (nama studio sungguhan disisipkan)
- `[PIC tidak tersedia pada tanggal ini]`

### 5.4 Angka gerbang

```
tabel public   150 → 153   studios, prod_slots, pic_unavailability
entity_prefix   41 →  42   SLOT
sm_machines      33 → 33   TETAP — PROD-SLOT sengaja tanpa mesin (Rule 1)
notif_events     73 → 73   TETAP — nol event; peringatan bersifat INLINE di
                           layar perencana, bukan notifikasi ke orang lain
```

Dinaikkan di `scripts/db-rebuild.sh` **DAN** `.github/workflows/ci.yml` di commit
yang sama. `SLOT` juga masuk `PREFIXES` (`packages/core/src/ident.ts`, dual-home
dijaga `ident.registry.test.ts`). **`docs/STATE_MACHINES.md` tidak disentuh** —
nol mesin adalah bagian desainnya.

`studios_select` tidak punya lengan lead/divisi dan karena itu **masuk ledger
O48** (`supabase/tests/rls_checks.sql`) dengan alasan tertulis: empat nama
ruangan, tidak lebih sensitif daripada `standard_price` yang sudah terbuka, dan
setiap pembuka layar jadwal butuh daftarnya untuk merender kolom grid — termasuk
pada hari nol slot.

### 5.5 Yang SENGAJA tidak dibangun

- **Nol `EXCLUDE USING gist`** untuk tumpang-tindih. Jawaban Postgres yang
  "benar" justru salah di sini karena ia MEMBLOKIR (Rule 4).
- **Nol mesin status pada `PROD-SLOT`** (Rule 1). Ia catatan rencana; memberinya
  lifecycle berarti engine paralel kedua di sebelah `brief_task`.
- **Nol auto-rollover** sisa qty (Rule 13).
- **Nol hard block** di mana pun (Rule 4/7).
- **Nol pelacakan konten internal** (Rule 11 / D8).
- **Nol mesin recurring-task** (D9) — cukup flag `is_standing`, dan itu pun ikut
  separuh SCS yang ditahan (§12).
- **Nol KPI Profile M14** untuk peran gabungan. Kalau ia mewarisi profil
  "Creative", dua dari lima komponennya secara struktural tidak ada (Output
  Quantity = *Approved Assets*, dan GMV Impact melekat pada Asset — penulis
  skrip tidak memiliki Asset): 47,5% bobot hilang, lalu M14 Rule 6
  meredistribusinya sehingga Speed Score jadi ~54% seluruh skor seseorang. Skor
  yang absen itu jujur; skor yang salah dipakai di review kinerja.

### 5.6 Definition of Done — status nyata

- ✅ Validasi server-side dengan string `[...]` persis §5.3, di-assert ke
  konstanta `MSG_*` bukan literal
- ✅ Tes izin per peran §5.2, termasuk OD/Director berlapis (`staff+od`)
- ✅ Tes immutability: `pic_unavailability` menolak UPDATE dari koneksi
  service-role
- ✅ Tes recompute-from-log untuk setiap angka turunan §5.1
- ✅ Tes warn-not-block: konflik studio dan PIC tidak tersedia **berhasil
  menyimpan** dengan payload peringatan
- ✅ Tes RLS terpisah lewat `withClaims` (koneksi tes domain BYPASSRLS)
- ✅ Seed fixture Alpha Digital tetap lulus end-to-end (`db-rebuild` hijau)
- ✅ Nol event notifikasi — dan itu keputusan, dicatat di komentar migrasi

---

## 6. Alur

**A. Leader menyusun besok**
1. Buka Jadwal Produksi untuk tanggal target → grid studio × slot →
2. Buat `PROD-SLOT`: klien, paket, jenis pekerjaan, PIC, studio, jendela waktu,
   `target_qty` →
3. Sistem **memperingatkan (tidak pernah memblokir)** kalau studionya sudah
   dipakai di jendela yang bertumpang (Rule 4) atau PIC-nya ditandai tidak
   tersedia (Rule 7) →
4. Slot tersimpan sebagai `SLOT-YYYYMM-NNNN`.

**B. PIC mengeksekusi**
5. PIC mengerjakan slot → membuat baris Asset secara inkremental lewat pintu M7
   yang sama (Rule 2, tidak berubah) →
6. Akhir sesi, `actual_qty` diisi (PIC-nya sendiri atau Leader) →
7. Sisa **tidak** di-rollover (Rule 13).

**C. Leader membaca angkanya**
8. Penyelesaian hari-sama per PIC per periode = Σ`actual_qty` ÷ Σ`target_qty` →
9. Angka itu berhenti di dashboard Leader (Rule 10).

---

## 7. Layar (`web-internal`)

Ketiganya dijangkau dari `/creative`, **bukan** dari menu utama — pola yang sama
dengan Daily Output. Menaruhnya di nav akan membuat Creative satu-satunya divisi
ber-sub-item, dan simetri lima papan divisi itu yang dijaga `nav.test.ts`.

| Halaman | Isi |
|---|---|
| `/creative/schedule` | Grid studio × slot untuk satu tanggal; target/aktual/sisa per slot; date picker dengan tombol **Besok** sedekat **Hari ini** (jadwal besok disusun hari ini); form tambah slot inline. Studio nol slot tetap dirender "Bebas". Slot bertumpang keduanya tampil, ditandai dari `bentrok_ids`. Peringatan ditampilkan **sesudah** pesan sukses. |
| `/creative/schedule/rekap` | Dashboard Leader, read-only. **Menyatakan di layar** bahwa angkanya bukan KPI dan tidak masuk Modul 14 (Rule 10). Picker PIC hanya untuk lead/OD/Director. |
| `/creative/ketersediaan` | Catat/cabut ketidaktersediaan. **Menyatakan di layar** bahwa ini bukan pengajuan cuti dan tidak menggantikan HRIS (Rule 9), dan bahwa menjadwalkan orang yang ditandai **tetap bisa dilakukan**. |

Grid dibangun dengan CSS grid `auto-fit`, **nol dependency kalender baru** — repo
tidak punya satu pun komponen kalender atau grid tanggal (yang terdekat,
`StageTimelinePanel` / `interview/TimelinePanel` / `admin/hari-libur`, semuanya
daftar linear). Di layar sempit kolomnya bertumpuk, bukan menggulir horizontal.

---

## 8. Rute (`apps/api`)

| Path | Method | Untuk |
|---|---|---|
| `creative/schedule/{tanggal}` | GET | jadwal satu hari, ter-grup studio |
| `creative/slots` | POST | buat slot (201 + `peringatan`) |
| `creative/slots/{id}` | GET · PUT | detail · sunting RENCANA |
| `creative/slots/{id}/actual` | POST | tutup slot dengan HASIL |
| `creative/studios` | GET | registry |
| `creative/unavailability` | GET · POST | jendela tanggal · catat |
| `creative/unavailability/{id}` | DELETE | cabut |
| `creative/slot-summary` | GET | rollup dashboard Leader |

**Dua pintu terpisah untuk satu baris, dengan sengaja:** `PUT /slots/{id}`
menulis RENCANA, `POST /slots/{id}/actual` menulis HASIL. Penulisnya berbeda dan
artinya berbeda; satu pintu untuk keduanya berarti angka hasil bisa diubah oleh
siapa pun yang boleh menyunting rencana.

---

## 9. Notifikasi

**Nol event baru**, dan itu keputusan. Konflik studio dan PIC tidak tersedia
adalah **peringatan inline di layar perencana**, bukan pesan ke orang lain:
Leader sedang melihat layarnya saat peringatan itu relevan. Mendaftarkan event
yang tidak pernah diemisikan membuat katalog berbohong (preseden v9
`internal_tasks`, dan M18).

---

## 10. Reuse — yang TIDAK ditulis ulang

| Dipakai ulang | Dari | Kenapa penting |
|---|---|---|
| `creative.validateCreativeStaff` | `packages/domain/src/creative.ts` (di-export untuk ini) | dua definisi "staff Creative aktif" adalah dua jawaban yang menunggu menyimpang; ia juga yang menutup rantai HRIS (`status_aktif`) |
| `private.jwt_division_owns_client` | — **TIDAK dipakai** | ia true bila PIC KLIEN sedivisi dengan aktor (orang Sales/Account) ⇒ **selalu false** untuk lead Creative. Memakainya akan membuat Leader Video tidak melihat jadwalnya sendiri |
| `hari_libur` + `working_days_between()` | `20260813000000_kelola_klien_sla.sql` | satu helper hari kerja untuk seluruh sistem; tersedia bila denominator hari-kerja dibutuhkan nanti |
| `set_updated_at`, `forbid_mutation` | `20260722052710_pg_foundation.sql` | trigger fondasi |
| `tz.dateString` | `packages/core/src/tz.ts` | kolom `date` dikirim `YYYY-MM-DD`, bukan RFC3339 |

---

## 11. Sumber

- Google Sheets "jadwal baru" (2.712 baris, Jan–Sep 2026) dan "jadwal lama"
  (1.442 baris, Jan–Mar 2026)
- Worksheet Content Strategist, Content Creator, Social Media Officer
- Job description Leader Video (Bandung, 24 Jun 2026)
- `CDPS_GapAnalysis_LeaderVideo_CreativeDailyOps.md` — Gap A–I, keputusan D1–D9
- `CDPS_Module7_Creative.md` (M7-OA-1 / M7-OA-6), `CDPS_Module12_Task_Execution.md`
  (§2 Rule 1, §5), `CDPS_Module14_Team_Performance.md` (§2 Rule 2, Rule 6),
  `CDPS_Module18_Store_Ops.md` (preseden entitas/gerbang), `CLAUDE.md`

---

## 12. `M19-SCS-ENGINE` — pertanyaannya, dan kenapa jawabannya (b)

**DIKETOK 2026-09-09: opsi (b), mesin sendiri #34.** Bagian ini disimpan karena
ia satu-satunya tempat alasan pilihan itu tertulis lengkap; yang DIBANGUN ada di
§13.

Gap B/G/I (antrean peran gabungan, taksonomi Kategori, flag `is_standing`)
sempat ditahan satu pertanyaan arsitektur.

Draft modul ini menyatakan dua hal yang tidak bisa dua-duanya benar: Rule 5-nya
bilang baris SCS "masuk penuh ke Task Execution Engine", sementara §5.4-nya
memesan **mesin #34** sekaligus berkata "reuse the engine config, do not write a
variant".

Yang membuatnya tegas adalah kodenya sendiri:

- **Asset tidak punya mesin sendiri.** `packages/domain/src/task.ts:8` menulisnya
  eksplisit — *"an Asset is not a different lifecycle"*. Brief-as-task dan Asset
  dua-duanya memakai `MACHINE_BRIEF_TASK = 'brief_task'`, dibedakan lewat
  `entityType`/`table` pada `sm_transition`. Jadi **kalau SCS benar sebuah Task
  M12, ia memakai `brief_task` dan `sm_machines` TETAP 33** — mesin #34 adalah
  bentuk jawaban yang berlawanan.
- **M12 §2 Rule 1 MEMBEKUKAN** Task = Asset | Creator Booking | Brief-as-task,
  ketiganya wajib turunan Klien → Service → Brief.
- `scs_tasks.client_id` yang **nullable** (kasus "all client" di sheet) melanggar
  invarian itu. `PREFIXES.REQ` (`packages/core/src/ident.ts`) menambahkan alasan
  kedua: melonggarkan `client_id` *"akan membongkar gerbang pembayaran M4/M5"*.
- Presedennya sudah memilih arah lain. `internal_tasks.ts:4-10`:
  > *KENAPA MODUL SENDIRI, BUKAN M12 — PRD M12 §2 Rule 1 membekukan "Task" =
  > Asset | Creator Booking | Brief-as-task … `task.ts` (M12) tidak disentuh
  > sama sekali, jadi tidak ada dua definisi Speed Score / turnaround.*

**Diketok: mesin sendiri, pola `internal_tasks`** — M12 tidak disentuh,
`client_id` boleh nullable, dan `task.computeMetrics()` (sudah exported, pure)
tetap dipakai ulang sehingga tidak ada definisi kedua Speed Score.

### 12.1 Bagaimana kedua pernyataan PRD yang bertentangan jadi sama-sama benar

Draft Rule 5 bilang baris SCS *"masuk penuh ke Task Execution Engine"* dan
*"reuse the engine config, do not write a variant"*; §5.4-nya memesan mesin #34.
Keduanya benar SEKALIGUS bila mesin #34 adalah **salinan verbatim konfigurasi
`brief_task`** di bawah namanya sendiri: state yang SAMA, edge yang SAMA,
gerbang `require_lead` yang SAMA. Yang berbeda hanya NAMA mesinnya — karena
`sm_transition` mengunci mesin ke pasangan entityType/table, dan dua entitas yang
berbagi satu baris `sm_machines` berarti gerbang role salah satunya tidak bisa
digeser tanpa menggeser yang lain.

Konsekuensinya justru alasan utama pilihan ini: `computeMetrics` membaca nama
state `[In Progress]`/`[Approved]`/`[Revision Requested]`/`[Blocked]`/
`[Submitted]`/`[In Review]` dari `audit_log`, jadi kosakata yang identik berarti
rumus Speed Score, turnaround, dan jumlah revisi punya SATU implementasi.

⚠️ Mode gagalnya senyap: kalau seseorang "merapikan" `[Approved]` jadi
`[Selesai]` di migrasi, tidak ada yang gagal secara mencolok — Speed Score
seluruh baris SCS diam-diam jadi `null`. Yang merah lebih dulu adalah
`packages/db/src/scs.registry.test.ts`, yang membandingkan HIMPUNAN state dan
edge kedua mesin.

Dua item §6 draft yang lain **diputuskan** dan sudah masuk:
`pic_unavailability` dibangun sebagai ketidaktersediaan produksi berbatas
(Rule 9), dan KPI Profile M14 ditunda (§5.5).

---

## 13. `SMO & Content Strategist` (`SCS-`) — yang dibangun

Realisasi Gap B/G/I sesudah ketokan §12. Migrasi
`20260928010000_m19_scs_task_engine.sql`, domain `packages/domain/src/scs.ts`.

### 13.1 Rules

1. **Sebuah baris SCS adalah PEKERJAAN, bukan rencana.** Beda dari `PROD-SLOT`
   (Rule 1), ia PUNYA mesin status — karena ia memang di-review dan
   di-turnaround-kan. Mesinnya #34 `scs_task`.
2. **Mesin #34 adalah salinan verbatim `brief_task`** (§12.1). Nol nama state
   baru, nol edge baru. Yang tidak ikut: `[Cancelled — Service Voided]`, karena
   baris SCS tidak punya Service sehingga sebab itu tak pernah terjadi.
3. **Nol edge pembatalan pengganti.** Nama state pembatalan baru TIDAK dikarang
   — ia butuh ketokan pemilik lebih dulu, sikap yang sama yang diambil mesin
   #21 `internal_task` terhadap edge "buka kembali" yang juga tidak ada.
   Penggantinya: baris `[To Do]` boleh DIHAPUS (Rule 7).
4. **`client_id` NULLABLE, dan itu seluruh alasan modul ini berdiri sendiri.**
   Baris `all client` berlaku lintas klien (§12). Konsekuensi yang mengikat:
   baris ber-NULL **tidak boleh ikut ke angka per-klien mana pun** — health
   score M13, rekap klien M6D, laporan Client Portal M15. Setiap query per-klien
   memfilter `client_id is not null`, dan tabelnya **nol view** sehingga tidak
   ada jalan tersembunyi ke sana (ada tesnya).
5. **`is_standing` adalah sifat KATEGORI, bukan sifat baris.** Kategori standing
   = pekerjaan berulang harian; ia dihitung sebagai VOLUME, bukan deliverable
   yang diseri. Skema memaksa `is_standing ⇒ sla_jam IS NULL`, dan
   `computeMetrics(evs, null)` mengembalikan Speed Score **`N/A`** — jadi
   "standing tidak di-SLA-kan" ditegakkan SKEMA, bukan kesopanan pemakai layar.
6. **Kategori `Brief` `is_standing = false`, dan itu ketokan.** Pemilik
   2026-09-09: *"brief SMO sebetulnya membantu team lain menyelesaikan task dari
   AM"*. Yang membedakan Brief SMO dari Brief Strategist karena itu adalah
   `mendukung_divisi` pada BARISNYA. Menandai Kategorinya standing akan membuat
   deliverable Brief Strategist yang sungguhan HILANG dari seri deliverable.
7. **Baris beku begitu ia meninggalkan `[To Do]`.** Tanggal, Kategori, PIC,
   target qty, dan klien tidak bisa disunting sesudahnya — Kategori membawa SLA
   yang dipakai menghitung Speed Score baris yang sedang dinilai. Sebelum itu ia
   bebas diperbaiki: baris SCS diketik cepat di awal hari dan salah ketik nyata
   harus bisa dibetulkan sebelum ada satu pun jejak pengerjaan. Ditegakkan DUA
   kali (pesan BI + trigger `scs_tasks_beku()`).
8. **Taksonomi Kategori adalah DATA, bukan skema** (`M19-SCS-KATEGORI-DATA`).
   Hanya empat Kategori yang TERBUKTI di sumber yang di-seed; sisanya diisi lead
   Creative lewat layar admin. `sub_type` sengaja teks bebas.
9. **Angka turunan dari `audit_log`, nol kolom jangkar.** Turnaround, Speed
   Score, dan jumlah revisi dihitung ulang lewat `task.computeMetrics()`
   (aturan rumah #3/#4).
10. **Nol bobot Modul 14.** KPI Profile peran gabungan ditunda dengan sengaja
    (§5.5). Dijaga tes yang memindai `performance.ts`, cermin penjaga D5.

### 13.2 Entitas

#### `scs_kategori` — registry, dikelola lead Creative

| Field | Tipe | Catatan |
|---|---|---|
| `kode` | varchar PK | dinormalkan huruf besar |
| `nama` | text | unik |
| `sub_type` | text, nullable | label worksheet. **Bukan** enum tertutup (Rule 8) |
| `is_standing` | bool | Rule 5 |
| `sla_jam` | int, nullable | satuan sama dengan `briefs.sla_target_hours`. NULL ⇒ Speed Score `N/A` |
| `aktif` · `urutan` | bool · int | nonaktif = hilang dari picker, tetap terbaca di baris lama |

Seed: `SCRIPT` (SLA 24) · `BRIEF` (SLA 24) · `UPLOAD_CHECKLIST` (standing) ·
`KOORDINASI` (standing — jurnal Content Creator, Gap H-1).

**Nol jalur DELETE**: baris pekerjaan historis menunjuknya lewat FK (nol
CASCADE, nol SET NULL). Menonaktifkan lewat `aktif = false`.

#### `scs_tasks` — prefix `SCS`, mesin #34

| Field | Tipe | Catatan |
|---|---|---|
| `id` | `SCS-YYYYMM-NNNN` | di-mint HANYA sesudah validasi lolos |
| `tanggal` | date | hari kerja baris ini |
| `kategori_kode` | ref `scs_kategori` | membawa SLA-nya |
| `judul` | text | pekerjaannya |
| `client_id` | ref `clients`, **nullable** | NULL = "all client" (Rule 4) |
| `mendukung_divisi` | ref `division_registry`, nullable | Rule 6 |
| `assigned_pic` | ref `employees` | `creative.validateCreativeStaff` |
| `target_qty` | int > 0 | |
| `status` | varchar | eksklusif lewat `sm_transition` |
| `link_hasil` | text | WAJIB pada `[Submitted]` dan sesudahnya |

Nol kolom jangkar waktu, nol kolom turunan (Rule 9).

### 13.3 Permission

| Aksi | Siapa |
|---|---|
| Buat/sunting/cabut baris · kelola Kategori | Lead/SPV Creative, Director |
| `[To Do]`→`[In Progress]`, submit, kerjakan ulang | **PIC baris itu SAJA** |
| Buka review, setujui, minta revisi, blokir | Lead/SPV Creative, Director |
| Baca | Lead/SPV = divisi · staff = barisnya sendiri · OD/Director = di mana pun |

**NOL akses AM**, berbeda dari Asset M7 (yang review-nya memang milik AM):
baris SCS tidak punya induk Brief, jadi tidak ada AM yang memilikinya — dan
untuk baris "all client" tidak ada klien sama sekali.

**Mengerjakan lebih sempit daripada M19**: `canWorkTask` menolak lead, karena
lead yang menandai baris orang lain `[In Progress]` memalsukan jangkar yang
turnaround-nya diukur dari situ. `[Blocked]` sebaliknya lead-saja: waktu blocked
DIKURANGKAN dari turnaround, jadi PIC yang bisa memblokir barinya sendiri
memotong sendiri angka yang menilainya (gerbang M12 §5.3a).

Peran `SMO & Content Strategist` duduk DI BAWAH divisi Creative (ketokan
2026-09-09) ⇒ nol level klaim baru, nol baris `division_registry` baru.

### 13.4 Pesan validasi (BI, string persis)

`[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]` ·
`[jumlah target harus lebih dari 0]` · `[kategori pekerjaan tidak dikenal]` ·
`[kategori pekerjaan sudah tidak aktif]` · `[kode kategori sudah dipakai]` ·
`[kategori standing tidak boleh punya SLA — pekerjaan berulang tidak diukur kecepatannya]` ·
`[divisi yang didukung tidak dikenal]` · `[baris pekerjaan tidak ditemukan]` ·
`[link hasil kerja wajib diisi untuk submit]` ·
`[baris yang sudah dikerjakan tidak bisa disunting — ia membawa SLA yang dipakai menghitung Speed Score]` ·
`[hanya baris yang belum dikerjakan bisa dihapus]` ·
`[hanya PIC baris ini yang bisa mengerjakannya]` ·
`[hanya lead divisi yang bisa me-review baris pekerjaan ini]` ·
`[anda tidak memiliki akses ke antrean pekerjaan ini]` ·
`[PIC tidak valid: harus staff divisi Creative yang aktif]` (dari M7, dipakai ulang).

### 13.5 Angka gerbang

```
tabel public   153 → 155   scs_kategori, scs_tasks
entity_prefix   42 →  43   SCS
sm_machines      33 →  34   mesin #34 `scs_task`
notif_events     73 →  73   TETAP — nol event; antrean adalah LAYAR yang dibuka
                            setiap hari, bukan sesuatu yang butuh inbox
                            (preseden v9 `internal_tasks`, dan M18)
```

`scs_kategori_select` tidak punya lengan lead/divisi dan karena itu masuk ledger
O48 (`supabase/tests/rls_checks.sql`) dengan alasan tertulis — cermin
`studios_select`. Baris KERJA-nya (`scs_tasks`) tetap ber-lengan lead/divisi.

### 13.6 Rute + layar

| Path | Method |
|---|---|
| `creative/scs/tasks` | GET · POST |
| `creative/scs/tasks/{id}` | GET · PUT · DELETE |
| `creative/scs/tasks/{id}/transition` | POST (`aksi`, bukan nama state mentah) |
| `creative/scs/kategori` | GET · POST |
| `creative/scs/kategori/{kode}` | PUT |
| `creative/scs/summary` | GET |

Tiga layar: `/creative/scs` (antrean + form), `/creative/scs/rekap` (rekap per
PIC — **menyatakan di layar** bahwa angkanya bukan KPI), `/creative/scs/kategori`
(taksonomi). Dijangkau dari `/creative`, **nol perubahan `nav.ts`** — pola yang
sama dengan Daily Output dan Jadwal Produksi.

**SATU pintu transisi, `aksi` bukan `to`:** sebuah body `{to: '[Approved]'}`
akan melewati gerbang peran yang menempel pada aksinya.

### 13.7 Yang SENGAJA tidak dibangun

- **Nol 24 baris Kategori di seed** (Rule 8) — dokumen taksonomi sumbernya tidak
  ada di repo; mengarang 21 nama berarti menaruh tebakan di dalam migrasi.
- **Nol state pembatalan** (Rule 3).
- **Nol event notifikasi** (§13.5).
- **Nol lengan RLS `mendukung_divisi`** — lead divisi lain tetap tidak boleh
  membaca baris kerja Creative "karena dibantu": izin itu tidak pernah diketok.
- **Nol bobot M14** (Rule 10).
- **Pola "Task Additional" (Gap I)** — detailnya hanya ada di dokumen gap
  analysis yang tidak ada di repo. Belum dibangun, dan tidak ditebak.
