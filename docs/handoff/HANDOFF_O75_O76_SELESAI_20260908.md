# Handoff — O75 & O76 diketok pemilik dan SELESAI dibangun. Sisa satu ketokan baru (O77).

> **Ditulis 2026-09-08.** Dua pertanyaan terbuka terlama di `DECISIONS.md` sudah
> ditutup dan dieksekusi. Berkas ini titik lanjut untuk chat berikutnya di jalur
> ini; ia **tidak** menyentuh Wave 3 Store Ops (akun lain, lihat §5).

---

## 1. Posisi

| Apa | Nilai |
|---|---|
| Branch | `claude/wave-3-buildplan-tasks-8dca7k` |
| Commit | `ba43db2d` (O75) · `0fa94712` (O76) |
| Migrasi di pohon | **205** (203 → +2 O76) |
| Gate | 146 tabel · 40 entity_prefix · 31 sm_machines · **76** notif_events |
| Live (`CDPS SG`) | ⛔ **NOL migrasi baru di-apply.** Lihat §4 |
| Pertanyaan terbuka | O75 ✅ · O76 ✅ · **O77 BARU** (menahan backfill O75) |

```bash
cd /home/user/AgencyAPP
service postgresql start
su postgres -c "psql -c \"ALTER USER postgres PASSWORD 'postgres';\""
export DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps"
bash scripts/db-rebuild.sh --yes        # 205 migrasi, semua gate & invariant hijau
npm install && npm run typecheck --workspaces --if-present
(cd web-internal && npm install)
```

---

## 2. O75 — Service akhirnya bisa SELESAI (`ba43db2d`)

Sebelum ini edge `[In Execution] → Done` ada dengan **nol pemanggil**:
satu-satunya cara Service keluar dari peredaran adalah **dibatalkan**.

**Bentuknya dua langkah, menyalin T-2b Hold baris per baris** — karena `Done`
terminal, jadi ia satu-satunya keputusan pada mesin ini yang tidak bisa
dibatalkan, dan layak gerbang setidaknya sama ketat dengan *menjeda*-nya.

| Ketokan | Wujudnya di kode |
|---|---|
| AM pemilik mengajukan → Head of Account menyetujui | `client.ts::requestServiceCompletion`/`approveServiceCompletion`/`rejectServiceCompletion`; state `[Completion Requested]`; edge langsung `[In Execution] → Done` **DICABUT** |
| Gerbang wajib: `contracts.tanggal_akhir` sudah lewat | Ditegakkan **dua kali** — domain + trigger DB `trg_service_tutup_butuh_kontrak_berakhir`; keduanya menjawab `[service belum boleh ditutup sebelum kontraknya berakhir]`. Kontrak yang berakhir **hari ini** belum lewat |
| Tanggal `Done` = sumber `accrual.tanggalSelesai` | `private.service_tanggal_selesai` → `client.completionDate`. Dibaca dari `audit_log`, **bukan** kolom kedua yang bisa berbeda dari log-nya |
| Backfill lewat `sm_transition` aktor SISTEM, hanya sesudah bulan pengakuannya diketok | **SENGAJA BELUM DIJALANKAN** → O77, §3 |

Permukaannya: 4 rute (`POST /services/{id}/completion`, `/completion/approve`,
`/completion/reject`, `GET /services/completion-requests`), tombol di
`/clients/{id}`, dan **antrean ke-9 di `/persetujuan`**.

**Asumsi eksplisit yang perlu dilihat pemilik:** Service **tanpa** kontrak
(`contract_id` null ⇒ seluruh baris closing-nya sekali-jadi) **lolos gerbang
tanggal** — di situ "kontraknya berakhir" syarat yang TIDAK ADA, bukan yang
belum terpenuhi, dan justru layanan sekali-jadi itulah yang
`pengakuan = 'saat_selesai'`. Persetujuan Head tetap wajib. Membalikkannya =
satu `if` di `client.ts` + satu di trigger.

---

## 3. ⚠️ O77 — ketokan BARU yang menahan backfill

**Pendapatan Service yang kontraknya sudah lewat diakui di bulan mana?**

Kalau backfill dijalankan hari ini, tanggal `Done` Service lama menjadi **hari
deploy**, dan mesin accrual mengakui pendapatan lama itu di bulan yang kebetulan
sedang berjalan — keputusan keuangan yang diambil oleh efek samping sebuah
deploy. Pilihannya: (i) bulan `contracts.tanggal_akhir`, (ii) bulan dinyatakan
selesai, (iii) per baris, ditetapkan Finance sebelum backfill.

Kandidat barisnya (murni SELECT, kueri lengkapnya di migrasi
`20260925010000` §5):

```sql
select s.id, s.name, c.id as contract_id, c.tanggal_akhir
  from services s
  join contracts c on c.id = s.contract_id and c.client_id = s.client_id
 where s.status = '[In Execution]' and c.tanggal_akhir < wib_date(now())
 order by c.tanggal_akhir;
```

**Urutan yang penting:** O77 sebaiknya diketok **sebelum** D-3 dipakai menutup
bulan pertama. D-3 melarang mengedit bulan yang sudah ditutup, jadi rupiah yang
telat diakui tidak punya bulan untuk pulang.

---

## 4. O76 — floor GMV ber-anchor (`0fa94712`)

Diketok **opsi (iii)**: floor tetap input AM, tapi **diukur** terhadap
`clients.target_gmv` — angka yang Sales sepakati dengan klien di form Qualified
(`NOT NULL` sejak Wave 1 ⇒ nol klien tanpa angka ini, nol backfill).

- Snapshot: `strategi.client_target_gmv` saat matriks target disimpan.
- **Σ floor GMV per BULAN** (bukan per baris channel) diukur terhadapnya lewat
  `account.gmvGate` yang **dipakai ulang** dari jalur M6 lama.
- Di luar ±20% → alasan **wajib** + `menunggu_persetujuan`, di-stempel
  `disetujui` oleh `approveStrategi`.
- **Lubang yang ditutup bersamaan:** `clients.target_gmv` kini
  **Account lead/Director** (`canEditClientTargetGmv`). Anchor yang bisa digeser
  oleh orang yang dibatasinya bukan anchor. Konsekuensi: AM staff tidak lagi
  merevisi Target GMV sendiri (penyimpangan M4-OA-6, dicatat).
- **Perpanjangan R-03:** `renewal_requests.target_gmv_baru`, default angka lama
  di form, berlaku saat `executeRenewal` (bukan saat diusulkan), audit
  before→after ber-`sumber: 'renewal'`.

> **Catatan yang perlu dibaca sebelum menyentuh O76:** premis baris O76 aslinya
> **sudah usang** — nilai `sumber_floor = 'kontrak'` dihapus migrasi
> `20260807120000`, dan D-7 sebenarnya sudah punya tiga penegak. Yang kurang
> hanya ketertelusuran angkanya. Kalau nanti ada yang membaca baris O76 lama dan
> menyimpulkan "D-7 tanpa penegak", tunjuk baris ini.

---

## 5. ⛔ Live Supabase: NOL migrasi di-apply

Tiga migrasi baru (`20260925010000`, `20260926010000`, `20260927010000`) **hanya
ada di DB lokal**. Ditambah warisan `20260922100400` (backfill A-3, no-op) yang
juga belum di-apply.

Aturannya tidak berubah: **per berkas** lewat `apply_migration`, urut nama,
lalu **verifikasi dengan kueri katalog** — jangan percaya `success: true` saja.
⛔ **JANGAN `supabase db push`** (ledger live memakai stempel APPLY, bukan nama
berkas repo — O65).

Urutan apply yang benar:

```
20260922100400_a3_backfill_service_strategy_approved.sql   (no-op, aman kapan pun)
20260925010000_o75_service_tutup.sql
20260926010000_o76_floor_anchor_gmv.sql
20260927010000_o76b_renewal_target_gmv.sql
```

⚠️ **`20260925010000` menaikkan `notif_events` 73 → 76**, dan gate-nya sudah
dinaikkan di `db-rebuild.sh` **dan** `ci.yml` di commit yang sama. Kalau kode
di-deploy tanpa migrasinya, `notif_catalog.reals` merah menurut konstruksinya
sendiri — **migrasi dulu, atau bersamaan**.

---

## 6. Tabrakan yang perlu diketahui dengan Wave 3 Store Ops (akun lain)

Dua branch lain sedang membangun M18 Store Ops, dan **keduanya** menaikkan gate
**tabel/prefix/mesin** (146→147, 40→41, 31→32). Pekerjaan ini menaikkan
**`notif_events`** (73→76).

- **Barisnya berbeda** di `db-rebuild.sh` ⇒ konflik kecil.
- **Satu baris SAMA di `ci.yml`**: nama step `Verify migration seed counts
  (31 machines, 76 events, ...)` memuat **kedua** angka. Saat resolusi:
  **rebase, jalankan ulang `db-rebuild.sh`, ambil angka yang sebenarnya.**
  Counter itu **absolut, bukan delta** — jangan menebak.
- Stempel migrasi tidak bertabrakan (mereka `20260924010000`, ini
  `20260925…`/`26`/`27`).

---

## 7. Angka acuan — naik, tidak pernah turun

```
db-rebuild.sh  205 migrasi
  gate: 146 tabel · 40 entity_prefix · 31 sm_machines · 76 notif_events
        + notif_katalog_sesuai
  invariant: ident_checks · immutability_checks · rls_checks · auth_claims_checks

domain            2125 lulus (+1 skip) · 76 file · nol FAIL   (dari 2101)
core               983
db                  53
apps/api           493            route-parity & shape-parity hijau
web-internal       684            (+ tsc --noEmit bersih + next build sukses)
web-client-portal   19
```

`KNOWN_GAPS` di `route-parity.test.ts` **tetap kosong**.

---

## 8. Jebakan yang MEMAKAN WAKTU di sesi ini (di luar daftar handoff sebelumnya)

1. **Backtick di komentar SQL memutus template literal** — kena **dua kali**
   sesi ini (`client.ts`, lalu `strategi.ts`), padahal sudah tertulis sebagai
   jebakan #5 di handoff sebelumnya. Penjelasan ber-backtick taruh di komentar
   TS **di atas** kueri, jangan di dalam string-nya.
2. **`audit_log`/`notifications` menolak DELETE ⇒ tes yang MENGHITUNG barisnya
   gagal palsu di jalan kedua** atas DB yang sama (jebakan A-T4). Blok O75/O76
   memakai token per-jalan (`RUN`), dan tes Hold di berkas yang sama ikut
   dibetulkan — sekarang `client.test.ts` hijau dua kali berturut-turut tanpa
   rebuild.
3. **Urutan baris `sm_edges` mengikuti collation DB**, bukan urutan ASCII yang
   enak dibaca (`Done` sebelum `[In Execution]`). Jangan "merapikan" assertion-nya.
4. **`web-internal` butuh `npm install` SENDIRI.** Tanpa itu `tsc` membanjiri
   keluaran dengan galat `xlsx` yang bukan galat Anda.
5. **Postgres mati sendiri di container ini** — 59 tes "gagal" dengan
   `ECONNREFUSED`/timeout sebelum `pg_isready` mengaku. Cek dulu sebelum
   menyimpulkan apa pun.
