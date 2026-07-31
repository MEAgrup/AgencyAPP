# RUNBOOK — membersihkan residu UAT di produksi (`CDPS SG`)

> **Status:** dipakai pertama kali 2026-07-31 untuk residu run C-03 `30600363211`.
> **Berlaku untuk:** setiap run smoke/walk yang menulis ke deployment produksi.
> **Prasyarat mutlak:** `clients` = 0 dan `transactions` = 0. Begitu ada klien/transaksi
> riil, runbook ini **tidak berlaku lagi** dan penghapusan apa pun butuh keputusan
> tersendiri di `DECISIONS.md`.

## 0. Kenapa runbook ini menggantikan prosedur lama

Prosedur lama berbunyi *"cari lead ber-prefix `ZZC03` lalu hapus"*. Ia **cacat**, dan
run 2026-07-31 membuktikannya: `auth-smoke.mjs` punya konvensi penamaan sendiri dan
menulis lead bernama **`Smoke`** — tanpa marker `ZZC03`. Pencarian berbasis marker
melewatkannya, dan lead uji itu akan lolos ke gate GO sambil terlihat seperti data bisnis.

**Aturan penggantinya, dan alasannya jauh lebih kuat:**

> Sebelum go-live, `leads` di produksi **seharusnya kosong**. Jadi jangan mencari marker —
> **daftar SEMUA lead, lalu buktikan satu per satu bahwa ia data uji.**

Marker dipakai untuk *menjelaskan* asal sebuah baris, **bukan** untuk menemukannya. Setiap
skrip smoke baru boleh punya konvensi penamaan sendiri tanpa merusak prosedur ini.

## 1. Apa yang BOLEH dan TIDAK BOLEH dihapus

| Tabel | Boleh dihapus? | Penjagaan di DB |
|---|---|---|
| `leads` · `prospect_attempts` | ✅ ya | tak ada trigger; FK biasa (bukan `ON DELETE CASCADE`) |
| `qualified_forms` · `qualified_form_services` · `negotiation_proposals` · `prospect_attempt_nq_reasons` · `lead_delete_requests` | ✅ ya | anak dari `prospect_attempts`; hapus lebih dulu bila ada |
| **`audit_log`** | ❌ **TIDAK PERNAH** | `audit_log_no_delete` + `audit_log_no_update` (aturan rumah #3) |
| **`notifications`** | ❌ **TIDAK BISA** | `notifications_no_delete` — aturan rumah #8 (*"never deletable, only read/unread"*) |
| **`performance_snapshots`** | ❌ **TIDAK BISA** | `performance_snapshots_no_delete` + `_no_update` |
| **`id_sequences`** | ❌ **JANGAN DISENTUH** | aturan rumah #1: ID **tidak pernah dipakai ulang** |

**Ketiga "TIDAK BISA" itu bukan pilihan gaya — DB yang menolak.** `forbid_mutation()`
melempar `% is append-only/immutable: % forbidden`, transaksi ter-rollback utuh.
Satu-satunya cara menembusnya adalah menonaktifkan trigger immutability di produksi,
yang berarti membongkar jaminan demi kosmetika tabel. **Jangan.**

### Konsekuensi yang harus diterima sadar

1. **`audit_log` akan menunjuk ke entity yang sudah tidak ada.** Itu **benar**, bukan bug:
   riwayat mencatat bahwa lead uji itu pernah ada dan siapa yang membuatnya. Yang hilang
   adalah datanya, bukan jejaknya.
2. **Nomor ID yang terpakai tetap terpakai.** Setelah 6 lead dihapus, lead berikutnya
   **tetap `LEAD-202607-0007`**, bukan `0001`. `id_sequences` tidak di-rewind — aturan rumah #1.
3. **Notifikasi & snapshot sintetis menetap selamanya.** Catat sebagai **dikenal**, jangan
   didiamkan (DoD C-04 butir 2). Untuk notifikasi ada mitigasi nyata — lihat §7.

## 2. Langkah 1 — dry-run: daftar SEMUA lead

Jalankan dan **baca setiap baris**. Jangan lanjut kalau ada satu saja yang tidak bisa Anda
jelaskan asalnya.

```sql
select l.id, l.lead_name, l.record_status, l.source, l.created_by, l.created_at,
       (select count(*) from public.prospect_attempts a where a.lead_id = l.id) as attempts
from public.leads l
order by l.id;
```

Lead uji **wajib** memenuhi salah satu: namanya jelas artifisial (`ZZC03 …`, `Smoke`,
`test …`, `prospek1`), **atau** `created_by` adalah akun fixture (pola `99%`).
**Kalau ragu — berhenti dan tanya pemilik.** Menghapus lead bisnis riil tidak bisa dibatalkan.

## 3. Langkah 2 — hitung anak yang menggantung

```sql
select l.id,
  (select count(*) from public.prospect_attempts a where a.lead_id=l.id) as attempts,
  (select count(*) from public.prospect_attempt_nq_reasons r
     join public.prospect_attempts a on a.id=r.attempt_id where a.lead_id=l.id) as nq_reasons,
  (select count(*) from public.negotiation_proposals np
     join public.prospect_attempts a on a.id=np.attempt_id where a.lead_id=l.id) as neg_proposals,
  (select count(*) from public.qualified_forms qf
     join public.prospect_attempts a on a.id=qf.attempt_id where a.lead_id=l.id) as qualified_forms,
  (select count(*) from public.qualified_form_services qs
     join public.prospect_attempts a on a.id=qs.attempt_id where a.lead_id=l.id) as qf_services,
  (select count(*) from public.lead_delete_requests d where d.lead_id=l.id) as delete_requests
from public.leads l order by l.id;
```

## 4. Langkah 3 — hapus, satu transaksi, ID eksplisit

**Isi daftar ID dari hasil langkah 2 — jangan pakai `LIKE`, jangan pakai `where true`.**
Daftar eksplisit adalah pengamannya: kalau Anda salah menyalin, yang terjadi adalah
"lebih sedikit terhapus", bukan "seluruh tabel terhapus".

```sql
begin;

with target(id) as (values
  ('LEAD-202607-0001'),('LEAD-202607-0002'),('LEAD-202607-0003'),
  ('LEAD-202607-0004'),('LEAD-202607-0005'),('LEAD-202607-0006')
), att as (
  select a.id from public.prospect_attempts a join target t on t.id = a.lead_id
)
-- urutan wajib: cucu → anak → induk
, d1 as (delete from public.qualified_form_services  where attempt_id in (select id from att) returning 1)
, d2 as (delete from public.qualified_forms          where attempt_id in (select id from att) returning 1)
, d3 as (delete from public.negotiation_proposals    where attempt_id in (select id from att) returning 1)
, d4 as (delete from public.prospect_attempt_nq_reasons where attempt_id in (select id from att) returning 1)
, d5 as (delete from public.lead_delete_requests     where lead_id in (select id from target) returning 1)
, d6 as (delete from public.prospect_attempts        where id in (select id from att) returning 1)
, d7 as (delete from public.leads                    where id in (select id from target) returning 1)
select (select count(*) from d6) as attempts_dihapus,
       (select count(*) from d7) as leads_dihapus;
```

> **Kenapa `leads.winning_attempt_id` tidak di-`null`-kan lebih dulu:** kolom itu **tidak
> punya FK** ke `prospect_attempts` (diverifikasi di live 2026-07-31), jadi tidak ada
> constraint yang perlu dilepas. Menambahkan `UPDATE leads` ke statement yang juga
> `DELETE FROM leads` berarti memodifikasi tabel yang sama dua kali dalam satu statement —
> perilakunya tidak terdefinisi di Postgres. Jangan lakukan itu.

```sql

-- BACA hasilnya. Cocok dengan yang diharapkan? -> commit. Tidak? -> rollback.
commit;
```

## 5. Langkah 4 — verifikasi sesudahnya

```sql
select 'leads' k, count(*)::text v from public.leads
union all select 'prospect_attempts', count(*)::text from public.prospect_attempts
union all select 'clients', count(*)::text from public.clients
union all select 'transactions', count(*)::text from public.transactions
-- yang HARUS tetap utuh:
union all select 'audit_log (wajib TIDAK berubah)', count(*)::text from public.audit_log
union all select 'notifications (tak bisa dihapus)', count(*)::text from public.notifications
union all select 'performance_snapshots (tak bisa dihapus)', count(*)::text from public.performance_snapshots
union all select 'id_sequences LEAD next_n (wajib TIDAK di-rewind)',
  coalesce((select next_n::text from public.id_sequences where prefix='LEAD' and period='202607'), '-');
```

**Kriteria lulus:** `leads` = 0 · `prospect_attempts` = 0 · `audit_log` **sama seperti
sebelum** · `id_sequences` **tidak berubah**.

## 6. Sesudah setiap run C-03 berikutnya

Satu run menulis kira-kira: **2 lead `ZZC03` + 1 lead `Smoke`** (+ attempt masing-masing),
baris `audit_log`, dan — **hanya kalau bulan WIB yang diskor belum punya snapshot** —
satu batch `performance_snapshots` + notifikasi sejumlah staf eligible.

⚠️ **Biaya yang tidak terlihat saat menjalankan.** `POST /performance/snapshots/scan`
idempoten **per periode**, bukan per run: ia menskor **bulan WIB terakhir yang sudah
tutup**. Jadi run pertama di sebuah bulan menulis satu batch snapshot + notifikasi yang
**permanen tidak bisa dihapus**; run berikutnya di bulan yang sama menulis **nol**.
Kalau Anda punya kelonggaran memilih waktu, jalankan run C-03 **di bulan yang batch-nya
sudah ada** — biayanya nol baris permanen.

## 7. Notifikasi: tidak bisa dihapus, TAPI bisa ditandai terbaca

`notifications` punya `notifications_no_delete` — **tidak ada** trigger `no_update`.
Artinya `read_at` **boleh** ditulis: itu memang satu-satunya mutasi yang aturan rumah #8
izinkan (*"only read/unread"*). Jadi bentuk "bersih" yang diizinkan skema untuk notifikasi
**bukan menghapus, melainkan menandai terbaca**.

Ini penting karena residu 2026-07-31 **terlihat oleh orang**: dari 38 notifikasi
`m14.performance.published`, penerimanya **34 karyawan riil** + 4 fixture nonaktif. Ke-34
orang itu akan melihat badge berisi notifikasi performa yang dihitung dari produksi
nol-klien-nol-transaksi.

> ⚠️ **URUTAN PENTING — jangan tandai terbaca sebelum QA badge selesai.** Ke-38 notifikasi
> belum-dibaca ini adalah **satu-satunya bahan uji** untuk QA badge `web-internal`
> (eks-SKIP-2 C-03); sebelum 2026-07-31 tabelnya kosong. Karena tak bisa dihapus, bahan itu
> **tidak akan hilang** oleh bersih-bersih lead — tapi akan hilang maknanya begitu ditandai
> terbaca. **Kerjakan QA badge dulu, baru jalankan ini.**

```sql
-- Jalankan HANYA setelah QA badge (eks-SKIP-2) selesai.
update public.notifications
   set read_at = now()
 where event_type = 'm14.performance.published'
   and read_at is null;
```

Sesudahnya, badge ke-34 orang itu bersih tanpa satu baris pun dibuang, dan riwayat bahwa
notifikasi itu pernah terkirim tetap utuh.
