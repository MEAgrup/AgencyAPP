# O48 — analisis untuk keputusan (BUKAN keputusan)

> ## Status per 2026-07-30 — SEBAGIAN SUDAH DIPUTUS
>
> | Grup | Status |
> |---|---|
> | **C** (3 antrean block request) · **D** (3 M14 performance) | ✅ **DIPUTUS & TER-IMPLEMENTASI** — migrasi `20260730160000`, entri Decided ada di `docs/DECISIONS.md`. **BELUM di-apply ke live** (repo 43 vs live 42, selisih disengaja) |
> | **A** (7 keluarga Klien) · **B** (12 tabel primer) · **E** (7 sisanya) | 🟠 **MASIH TERBUKA** — butuh keputusan pemilik + head dev |
>
> Analisis di bawah ditulis **sebelum** keputusan itu dan dibiarkan apa adanya sebagai dasar
> keputusannya — kecuali dua koreksi yang ditandai di §3 (Grup C ternyata **dorman**, bukan bug
> hidup; Grup D justru bug hidup). Disusun **sesudah** O46 terbukti menyala (`20260730120433`).

## 0. Ringkasan untuk yang memutuskan

| | |
|---|---|
| Angka yang beredar | *"36 dari 45 policy SELECT tanpa arm lead"* |
| **Angka terukur hari ini** | **35 dari 45** tanpa arm · **10** punya (bukan 9) |
| Dari 35 itu, **sengaja** tidak ber-divisi | **3** (`notifications`, `master_services`, `master_service_versions`) |
| **Kandidat gap sebenarnya** | **32** |
| Helper baru yang perlu ditulis | **NOL** — §2 |

**Temuan yang paling mengubah bentuk keputusan:** kedua helper yang dibutuhkan
(`private.jwt_same_division`, `private.jwt_division_owns_client`) **sudah ada di produksi dan sudah
terbukti menyala** lewat probe O46 8-skenario. O48 karena itu bukan *"tulis primitif keamanan baru"*
melainkan *"pakai dua helper yang sudah terbukti di tempat yang lebih luas"* — profil risiko yang
jauh berbeda dari yang tersirat di catatan aslinya.

## 1. Cara angkanya diukur (supaya bisa diulang, bukan dipercaya)

```sql
select c.relname, p.polname, pg_get_expr(p.polqual, p.polrelid)
from pg_policy p
join pg_class c on c.oid = p.polrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and p.polcmd in ('r','*')
order by c.relname;
```

Dijalankan terhadap **live `CDPS SG`**, bukan terhadap DB lokal — aturan yang lahir sesi ini:
*membangun ulang DB lokal membuktikan repo konsisten dengan dirinya sendiri; ia tidak bisa memberi
tahu isi `CDPS SG`.*

**10 policy yang SUDAH punya arm:** `audit_log`, `transactions` (keduanya dari O46) · `briefs` ·
`client_health_snapshots` · `demo_tasks` · `lead_delete_requests` · `leads` ·
`transaction_issue_approvals` · `installments` + `payment_verifications` (arm `jwt_division() =
'Finance'`, berbasis divisi tapi bukan `jwt_is_lead`).

> Catatan kecil: survei lama mencatat 9/36, saya mengukur 10/35. Selisih satu policy. Saya **tidak**
> merekonstruksi dari mana selisihnya — angka yang dipakai untuk memutuskan sebaiknya yang **baru
> diukur**, bukan yang diwariskan. Query di atas adalah sumbernya.

## 2. 🔴 Koreksi premis: "tabel anak ikut induknya" hanya benar untuk SATU tabel

Catatan O48 asli menulis: *"Sebagian dari 36 itu tabel anak yang visibilitasnya mengalir dari induk
lewat `jwt_owns_transaction`/`jwt_owns_client` — memperbaiki induknya memperbaiki mereka, jadi bukan
36 gap independen."*

**Itu tidak benar untuk mayoritasnya.** Saya periksa satu per satu:

| "Tabel anak" | Predikatnya sebenarnya | Ikut induk? |
|---|---|---|
| `metric_entry_assets` | `EXISTS (SELECT 1 FROM metric_entries …)` | ✅ **ya** — satu-satunya |
| `ad_campaign_assets` | `created_by = jwt_employee_id()` | ❌ tidak |
| `qualified_form_services` | `created_by = …` | ❌ tidak |
| `prospect_attempt_nq_reasons` | `created_by = …` | ❌ tidak |
| `negotiation_proposal_lines` | `created_by = …` | ❌ tidak |

Mereka **bernama** seperti tabel anak tapi mem-filter dengan `created_by` langsung. Memperbaiki
induknya **tidak** memperbaiki mereka. Konsekuensinya untuk keputusan: opsi *"perbaiki beberapa induk
saja, anaknya ikut"* — yang terdengar hemat — **tidak tersedia** kecuali untuk `metric_entry_assets`.

## 3. Ke-32 kandidat, dikelompokkan menurut apa yang dibutuhkan

### Grup A — keluarga Klien (7 policy, helper SUDAH ADA & SUDAH TERBUKTI)

`clients` · `ad_campaigns` · `client_platforms` · `client_sales_allocations` · `complaints` ·
`dependencies` · `services`

Ketujuhnya sudah memakai `private.jwt_owns_client(client_id)` (kepemilikan **per-orang**). Yang
kurang hanyalah pasangan divisinya: **`private.jwt_division_owns_client(client_id)`** — helper yang
`transactions_select` sudah pakai, sudah live, dan sudah lewat probe O46.

> Ini grup dengan rasio manfaat/risiko terbaik: satu helper, sudah terbukti, dan `clients_select`
> adalah tabel yang paling sering jadi pintu masuk halaman.

### Grup B — tabel primer per divisi (12 policy, helper SUDAH ADA)

Semuanya mem-filter lewat **satu kolom orang**, jadi semuanya bisa memakai
**`private.jwt_same_division(<kolom_orang>)`** — helper yang `audit_log_select` sudah pakai.

| Policy | Kolom orang | Divisi yang dirugikan |
|---|---|---|
| `assets` | `assigned_pic` | **Creative** — lead tidak melihat asset divisinya |
| `employees` | `employee_id` | **semua** — lead tidak melihat anggota divisinya |
| `campaigns` | `owner_employee_id` | Marketing |
| `marketing_performance_records` | `created_by` | Marketing |
| `metric_entries` | `entered_by` | Ads |
| `optimization_logs` | `actor` | Ads |
| `creator_bookings` | `assigned_coordinator` | KOL |
| `creator_lists` | `created_by` | KOL |
| `creator_payment_requests` | `requested_by` | KOL |
| `strategy_plans` | `approved_by` | Account |
| `negotiation_proposals` | `proposed_by` | Sales |
| `live_stream_sessions` | `created_by` | M10 (vendor — mungkin sengaja) |

### Grup C — antrean block request (3 policy) — 🔴 KOREKSI: DORMAN, bukan gap fungsional

`asset_block_requests` · `brief_block_requests` · `demo_task_block_requests`

> **Versi pertama bagian ini salah dan dibiarkan tercatat di sini, bukan dihapus.** Ia menulis:
> *"orang yang WAJIB menyetujui tidak bisa MELIHAT antreannya … alur kerja yang tidak bisa dimulai"*,
> dan menaruh Grup C sebagai prioritas tertinggi. Itu disimpulkan dari **teks policy** tanpa
> memeriksa **jalur mana yang benar-benar mengeksekusinya** — persis kesalahan yang §1 memperingatkan
> untuk survei O48 itu sendiri.

Yang sebenarnya, setelah kode diperiksa:

| Bukti | Isi |
|---|---|
| Route approve/reject | Memakai **`db()`** — service role, **RLS DI-BYPASS**. Berfungsi hari ini; gate-nya di TS (`permission.isLead`) |
| `pendingBlockRequests` (`task.ts:684`) | Ada + ber-test, tapi **nol route di `apps/api` memanggilnya** |
| FE | Menurunkan status pending dari **heuristik audit-trail** (`creative.ts:306`), bukan dari tabel ini — dan `audit_log` sudah dapat arm lead dari O46 |

Jadi ketiga policy ini **dorman**: ranjau untuk siapa pun yang mem-porting endpoint antrean, bukan
kerusakan hari ini. Rekomendasi saya berubah jadi **tunda + ikat ke tiket porting**.

**Pemilik memutuskan mengerjakannya sekarang** (2026-07-30), dan itu dieksekusi di
`20260730160000`. Yang dibuktikan: arm-nya benar **di lapisan DB** (check 24–28). Yang **belum**
dibuktikan: jalur aplikasinya — tertutup saat `pendingBlockRequests` di-porting.

> **Catatan implementasi yang mahal kalau terlewat:** tabelnya tidak punya kolom divisi, dan
> `EXISTS` inline **tidak bisa dipakai** — subquery di dalam policy ikut kena RLS, dan
> `assets_select` belum punya arm lead (Grup B), jadi arm-nya akan selalu false. Ketiga helper wajib
> `SECURITY DEFINER`. Dibuktikan dengan mutasi: `SECURITY DEFINER` → `INVOKER` membuat check 25
> **merah**.

### Grup D — M14 Performance (3 policy) — DB lebih sempit daripada entri Decided

`performance_snapshots` (`staff_id = me`) · `perf_kpi_weights` + `perf_period_targets`
(`jwt_can_read_all()` saja).

Entri Decided W3-M14-C1 (2026-07-18) menuliskan: *"config weights+targets TULIS = Director saja …
**BACA = semua aktor ber-scope**"*, dan M14 Rule 7 memisahkan **Leader/SPV: team** sebagai viewer.

> Ini kelas yang **berbeda** dari sisa O48. Sisanya adalah *"DB lebih sempit daripada PRD"*; yang ini
> *"DB lebih sempit daripada keputusan yang sudah dicatat di `DECISIONS.md`"*. Menutupnya bukan
> perluasan cakupan baru — ia menegakkan keputusan yang sudah diambil.

### Grup E — sisanya (7 policy)

`ad_campaign_assets` · `qualified_form_services` · `prospect_attempt_nq_reasons` ·
`negotiation_proposal_lines` (keempatnya `created_by`, §2) · `metric_entry_assets` (ikut induk) ·
`qualified_forms` · `prospect_attempts` (keduanya sudah punya `jwt_owns_lead`, kurang pasangan
divisinya).

### Yang TIDAK boleh disapu (3)

| Policy | Kenapa |
|---|---|
| `notifications` | `recipient_employee_id = me`. **Sengaja pribadi** (Phase 0 §8). Memberi lead arm = lead membaca notifikasi anggotanya. **Jangan.** |
| `master_services` · `master_service_versions` | `true` — katalog MSL memang dibaca semua orang |

## 4. Yang perlu Anda putuskan — tiga pertanyaan, bukan satu

1. ~~**Sapu sekaligus atau bertahap?**~~ ✅ **TERJAWAB 2026-07-30: bertahap.** Catatan asli
   membingkainya sebagai satu keputusan; setelah dipilah ia sebenarnya beberapa. **Grup D**
   (menegakkan entri Decided yang sudah ada) dan **Grup C** (dorman — §3, bukan gap fungsional
   seperti dugaan awal saya) diputus dan dikerjakan di `20260730160000`. **Grup A/B/E belum**, dan
   pertanyaan 2–3 di bawah masih menunggu jawaban.
2. **Grup B `live_stream_sessions`** — M10 adalah vendor. Apakah ia memang sengaja tidak ber-divisi?
   Kalau ya, ia pindah ke daftar "jangan disapu" dan kandidatnya jadi 31.
3. **Grup B `employees`** — memberi lead daftar anggota divisinya terdengar wajar, tapi
   `employees` memuat data pribadi. Perlu ditegaskan **kolom mana** yang boleh dilihat, bukan cuma
   baris mana.

**Rekomendasi saya:** putuskan **Grup C + D lebih dulu** (6 policy, dasar terkuat, blast radius
kecil), lalu Grup A (7 policy, satu helper terbukti), lalu Grup B sebagai keputusan tersendiri.
Menyapu 32 policy dalam satu migrasi memang mungkin, tapi ia menggabungkan tiga kualitas argumen yang
berbeda menjadi satu tombol — dan kalau salah satunya keliru, yang lain ikut tertarik mundur.

## 5. Prasyarat yang sering terlewat: arm tanpa pemegang tidak melakukan apa pun

Diukur di live hari ini:

| Divisi CDPS | Karyawan | Pemegang `level=lead` |
|---|---|---|
| Account | 15 | 3 |
| Sales | 15 | 2 |
| Creative | 11 | 1 |
| Finance | 4 | 1 |
| **Ads** | **11** | 🔴 **0** |
| **KOL** | **5** | 🔴 **0** |
| **Marketing** | **1** | 🔴 **0** |
| **(tidak terpetakan)** | **7** | 🔴 **0** |

**24 dari 69 karyawan** berada di divisi yang **nol** pemegang lead. Untuk mereka, arm O48 —
seberapa pun luas disapu — **tidak menyalakan apa pun**. Itu pekerjaan **A4**
(`O34_O26_O35_WORKSHEET_ROSTER_V2.md` §3.2), bukan pekerjaan RLS.

> Urutannya karena itu **bukan** selera: menyapu O48 sebelum A4 dijawab menghasilkan migrasi yang
> tidak bisa dibuktikan bekerja di Ads/KOL/Marketing — persis kelas kesalahan O46, di mana policy
> yang benar terlihat selesai padahal nol pemegang membuatnya tak teramati.
