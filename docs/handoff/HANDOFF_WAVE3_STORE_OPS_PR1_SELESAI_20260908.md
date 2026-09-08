# Handoff — Wave 3 Store Ops **PR 1 selesai**. Titik lanjut: PR 2 (domain + rollup).

> **Ditulis 2026-09-08.** Pendahulunya `HANDOFF_WAVE3_STORE_OPS_20260908.md` —
> §2 (ketokan pemilik) dan §5 (jebakan khusus Wave 3) di sana **masih berlaku**.
> Pendahulunya lagi `HANDOFF_LANJUT_20260908_JALUR_A_TUTUP.md` §2 + §7 (sembilan
> jebakan) — **juga masih berlaku**. Berkas ini hanya menambahkan apa yang
> berubah karena PR 1.

---

## 1. Posisi

| Apa | Nilai |
|---|---|
| Branch | `claude/handoff-feedback-lanjutan-bai2g0` (dari `main` `10d2023`) |
| Migrasi | **203** (+1: `20260924010000_w3_store_ops_sku.sql`) |
| Gate | **147** tabel · **41** entity_prefix · **32** sm_machines · **73** notif_events |
| Live (`CDPS SG`) | ⛔ **BELUM di-apply** — lihat §4 |
| Feedback OD | 9 dari 10 tertutup; Store Ops **fondasinya berdiri**, alurnya belum |

```bash
cd /home/user/AgencyAPP
git fetch origin && git checkout claude/handoff-feedback-lanjutan-bai2g0
service postgresql start
su postgres -c "psql -c \"ALTER USER postgres PASSWORD 'postgres';\""
export DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps"
bash scripts/db-rebuild.sh --yes      # 203 migrasi, gate 147/41/32/73
npm install && (cd web-internal && npm install)   # KEDUANYA — lihat §5 butir 2
npm run typecheck --workspaces --if-present       # BACA keluarannya
```

---

## 2. Apa yang PR 1 kerjakan

Butir **1 + 2 + 3 + 10** dari sepuluh butir Wave 3 (`PARALEL_FEEDBACK_OD_DUA_AKUN.md` §3).

| Butir | Hasil |
|---|---|
| 1. PRD | `docs/prd/CDPS_Module18_Store_Ops.md` — 14 Rule. Terdaftar di `CLAUDE.md` + `docs/prd/CDPS_Build_Plan.md` (manifest itu sempat berhenti di 15; baris **16/17/18** ditambahkan sekalian, karena manifest yang melompat 15→18 lebih membingungkan daripada tidak ada) |
| 2. Prefix | `SKU` dual-home: `entity_prefix` + `packages/core/src/ident.ts`. 40 → **41** |
| 3. Tabel + trigger | `sku_optimizations` (anak `briefs`, `sequence_no` unik per Brief) + `trg_sku_dinding`. 146 → **147** |
| — | Mesin **#32** `store_ops_sku` (`STATE_MACHINES.md` §22). 31 → **32** |
| — | RLS `sku_optimizations_select` 4 arm + `GRANT SELECT TO authenticated` |
| — | Cabang `Store Operation` ditambahkan ke `private.brief_jumlah_anak` yang SUDAH ada (A-req-3) |
| 10. Gate | `scripts/db-rebuild.sh` **dan** `.github/workflows/ci.yml`, keduanya di commit yang sama, angkanya dari hasil rebuild |

### Tiga keputusan yang bentuknya beda dari dugaan handoff pendahulu

1. **Dinding dua penulis BERSYARAT-STATE, bukan bersyarat-aktor.** §2 handoff
   pendahulu menuntut "kolom target read-only bagi Store Ops; kolom hasil
   read-only bagi AM, ditegakkan di DB" dan menunjuk preseden
   `trg_strategi_target_guard_floor` (O57 (b)). Preseden itu memang
   bersyarat-state, dan itu bukan kebetulan: satu-satunya sumber jawaban "siapa
   yang menulis ini" di CDPS adalah klaim JWT, dan **setiap tulisan domain masuk
   lewat koneksi service-role yang nol klaim**. Trigger bersyarat-aktor akan
   diam persis di jalur yang ia klaim jaga — teater, bukan dinding.

   Jadi yang ditegakkan DB adalah: cakupan+target **beku** begitu baris
   meninggalkan `[Belum Dikerjakan]`; hasil+dampak **ditolak** selama masih di
   sana; jangkar sekali-tulis; `link_output` beku setelah `[Terupload]`; angka
   dampak beku setelah `[Dievaluasi]`. Mode gagal yang ketokan §2 sebut sendiri
   ("target berubah sesudah hasilnya keluar") tertutup untuk **semua** koneksi.

   **Gerbang PERAN (siapa boleh menulis kolom mana) tetap utang PR 2**, di
   `packages/domain` dengan pesan `[...]` BI. Jangan kira PR 1 sudah membayarnya.

2. **`[Terupload]` = "selesai", dan ia sengaja BUKAN terminal.** K-6 dipenuhi
   sebagai **sepasang CHECK**: `ck_sku_terupload` (menuntut `terupload_pada` +
   `link_output`, dan **nol kolom dampak** — itu isi ketokannya) berpasangan
   `ck_sku_dievaluasi` (CTR/CVR sebelum+sesudah wajib, satu state kemudian).

   ⚠️ **Konsekuensi untuk PR 2, dan ini yang paling mudah salah:** rollup
   "selesai" **wajib membaca `[Terupload]` ATAU `[Dievaluasi]`**. Rollup yang
   membaca `sm_terminal_states` akan memperlihatkan produksi Store Ops mandek
   sebulan penuh setiap kali — pelajaran B-1a dalam bentuk lain. Ditulis sebagai
   PRD Rule 8 dan diulang di `STATE_MACHINES.md` §22 supaya tidak bisa terlewat.

3. **`assigned_pic` ada di kelompok B (Store Ops), bukan kelompok A (AM).** AM
   menetapkan **cakupan** (apa + target), lead divisi menetapkan **siapa** —
   K-1/A-5. Kalau nanti ada yang mengira baris SKU adalah regresi K-1, PRD
   Rule 6 adalah jawabannya.

---

## 3. Angka acuan — di atas branch ini

```
db-rebuild.sh  203 migrasi
  gate: 147 tabel · 41 entity_prefix · 32 sm_machines · 73 notif_events
  invariant: ident_checks · immutability_checks · rls_checks · auth_claims_checks — semua hijau

domain            2140 lulus (+1 skip) · 78 file   (2101 → +39: 26 dinding + 13 RLS)
core               983   (tidak bergeser)
db                  53   (tidak bergeser)
apps/api           493   route-parity & shape-parity hijau, KNOWN_GAPS kosong
web-internal       684   (+ tsc --noEmit bersih + next build sukses)
web-client-portal   19
```

`npm run lint`: **1 error PRE-EXISTING** (`react-hooks/static-components` di
`admin/employees/page.tsx`) + 61 warning. Sama persis dengan acuan sebelumnya —
PR 1 nol berkas FE.

---

## 4. ⛔ DUA migrasi belum di-apply ke live — dan alasannya berbeda

| Migrasi | Kenapa belum |
|---|---|
| `20260922100400_a3_backfill_service_strategy_approved.sql` | **Sengaja**, dari sesi sebelumnya. No-op di live (0 baris memenuhi kriterianya, sudah diverifikasi). Pemeriksanya ada di `HANDOFF_LANJUT_20260908_JALUR_A_TUTUP.md` §4 |
| `20260924010000_w3_store_ops_sku.sql` | **Karena PR-nya belum merge.** Ia mengubah SKEMA produksi (tabel + prefix + mesin baru); menerapkannya dari branch yang belum ditinjau berarti live mendahului `main`. Apply **sesudah merge**, bukan sebelum |

**Aturan live yang berlaku, tidak berubah:** hanya lewat `apply_migration`,
**per berkas**, urut nama, lalu **verifikasi dengan kueri katalog** — jangan
percaya `success: true` saja. ⛔ **JANGAN `supabase db push`** (ledger live
memakai stempel waktu APPLY, bukan nama berkas repo — O65, masih terbuka).

Verifikasi sesudah apply:

```sql
select count(*) from information_schema.tables
 where table_schema='public' and table_type='BASE TABLE';   -- 147
select count(*) from entity_prefix;                          -- 41
select count(*) from sm_machines;                            -- 32
select count(*) from sm_edges where machine='store_ops_sku'; -- 5
select relrowsecurity from pg_class where relname='sku_optimizations'; -- t
```

---

## 5. Jebakan yang PR 1 sendiri kena — supaya PR 2 tidak mengulang

1. **`audit_log` menolak DELETE, jadi hitungan baris ABSOLUT dalam satu berkas
   tes akan menumpuk.** Tes "setiap transisi meninggalkan baris audit" gw tulis
   `toBe(2)` dan ia merah di angka **25** — bukan bug, itu baris dari tes-tes
   sebelumnya di berkas yang sama pada `entity_id` yang sama. Bentuk yang benar:
   **DELTA** (hitung sebelum, hitung sesudah, assert selisihnya). Ranjau ini
   sudah memakan dua siklus sesi lain; sekarang tiga.
2. **`(cd web-internal && npm install)` adalah langkah TERPISAH dari `npm install`
   root, dan melewatkannya memberi FAIL yang menyesatkan.**
   `report-shopee-parse.test.ts` gagal dengan *"Cannot find package 'xlsx'"* —
   terbaca seperti dependensi hilang di repo, padahal cuma workspace yang belum
   di-install. 679 lulus + 1 suite gagal, bukan 684 lulus.
3. **`ck_sku_terupload` non-deferrable meledak DI DALAM `sm_transition`** sebagai
   galat Postgres, bukan `{ok:false}` yang sopan (transaksinya ter-rollback
   penuh, status tidak bergerak). Konsekuensinya untuk PR 2: **domain WAJIB
   menulis bukti produksi SEBELUM memanggil transisi**, dalam transaksi yang
   sama — pola persis `internal_tasks.link_hasil` dan `riset_awal.disubmit_pada`.
4. **`sku_optimizations` punya FK ke `employees`** (`assigned_pic`, `created_by`)
   — beda dari `assets` yang tidak punya. Tes yang menyeed baris SKU harus
   menyeed karyawannya lebih dulu, dan membersihkannya di `afterAll`.
5. **Jebakan #6 handoff pendahulu sekarang PUNYA tabel barunya.** Begitu ada tes
   di berkas lain yang menyeed `sku_optimizations`, `afterEach`-nya wajib
   menghapus baris SKU **sebelum** `delete from briefs` (FK NO ACTION). Sudah
   kena dua kali di sesi lain (`briefs` di `strategi.test.ts`, `assets` di
   `account.test.ts`). Hari ini nol berkas lain menyeednya, jadi belum ada yang
   perlu diubah — tapi PR 2 akan membuatnya relevan.

---

## 6. Berikutnya — PR 2, dan urutan yang disarankan

Butir **4 + 5** dari sepuluh butir Wave 3, plus lapisan domain-nya.

1. **Domain `packages/domain/src/storeops.ts`** — buat baris (AM: cakupan+target),
   tugaskan PIC (lead), mulai/upload (PIC), evaluasi (Store Ops), batalkan (lead).
   **Di sinilah gerbang PERAN + pesan `[...]` BI ditulis** — DB hanya memikul
   dinding kolom (§2 butir 1). Tulis bukti SEBELUM transisi (§5 butir 3).
2. **Rollup Brief** meniru `task.recomputeBriefRollup`/`kol.recomputeBriefRollup`
   — dengan `[Terupload]` **atau** `[Dievaluasi]` sebagai "selesai" (§2 butir 2).
   Pakai `web-internal/src/lib/brief-progress.ts` yang sudah ada
   (`hitungProgres`/`labelProgres`) di sisi FE; **jangan tulis aturan "n dari N"
   untuk kedua kalinya.**
3. **Pipeline `STORE_OPS`** (menutup LT-2) + kode alasan pengembalian brief
   (menutup LT-8, `stage.ts:83`). **Satu migrasi, nol TS** — komentarnya sudah
   menyatakan itu di `20260830020000_m16_stage_seed.sql:132`. ⚠️ Ia menambah
   **satu mesin lagi** (`stage_store_ops`) ⇒ `sm_machines` 32 → **33**; naikkan
   kedua gate lagi di commit yang sama.
4. **Rute + `route-parity`** — `KNOWN_GAPS` wajib tetap **kosong**.

Butir **6** (`StageTimelinePanel` di `/tasks/[id]`) tetap **bisa didahulukan
kapan saja** — ia tidak bergantung pada 1–5 dan langsung membayar utang gerbang
intake **semua** divisi, bukan cuma Store Ops. Nilai tertinggi per baris kode di
seluruh daftar Wave 3.

Butir **8** (`account.TASK_CATALOG` lalu `punyaKuotaSatuan: true`) — urutan itu
wajib, `division.ts:48-52`. Butir **9** (bobot KPI) sesudah metriknya berjalan.

---

## 7. Masih menunggu ketokan pemilik — tidak memblokir PR 2

Keduanya tidak bergerak sejak handoff pendahulu:

- **O75** — Service nol jalur untuk SELESAI. Edge `[In Execution] → Done` ada di
  `sm_edges`, nol pemanggil. Perlu diketok: siapa yang boleh menutup Service, dan
  apa gerbangnya.
- **O76** — dari mana floor GMV bulanan datang. Selama belum diketok, **Sanggahan
  Target (D-7) kehilangan penegaknya**.

Satu pertanyaan **baru** yang PR 1 munculkan, dan sengaja tidak dipilih sendiri:

- **O77 — siapa yang memicu langkah evaluasi ±30 hari, dan apa yang terjadi kalau
  tidak ada yang memicunya?** Baris `[Terupload]` yang tidak pernah dievaluasi
  hari ini **diam selamanya**: ia sudah "selesai" untuk leadtime produksi (benar,
  K-6) sekaligus tidak pernah menghasilkan angka dampak (tidak benar — K-6 bilang
  CTR/CVR **wajib**). Ada dua bentuk jawaban, dan keduanya masuk akal:
  **(a)** job pengingat harian seperti `kol_reminder_tick`/`penugasan_reminder_tick`
  (`[Terupload]` + `terupload_pada` lewat 30 hari ⇒ notifikasi ke PIC + lead), atau
  **(b)** antrean "Menunggu Evaluasi" di halaman Store Ops, tanpa notifikasi.
  (a) menambah event katalog (`notif_events` 73 → 74+); (b) nol. **Jangan pilih
  diam-diam** — tanyakan sebelum menulis PR 2, karena pilihannya menentukan
  apakah PR 2 menaikkan gate keempat.
