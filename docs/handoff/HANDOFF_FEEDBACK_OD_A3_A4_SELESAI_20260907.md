# Handoff — Jalur A TUTUP (A-3 + A-4 mendarat). Sisa: penggabungan Jalur B.

> **Ditulis 2026-09-07.** Pendahulunya `HANDOFF_FEEDBACK_OD_LANJUT_20260907.md`
> (§1–§2 di sana soal Supabase live **masih berlaku dan masih belum dikerjakan** —
> baca ulang sebelum menyentuh live). Rencana induk
> `docs/handoff/PARALEL_FEEDBACK_OD_DUA_AKUN.md` tidak berubah.

---

## 1. Yang mendarat di sesi ini

Branch: `claude/handoff-feedback-lanjutan-t6urof`, dicabang dari `main` `e8cee053`.

### A-3 · Status CRO tidak lagi mentok `[Awaiting Onboarding]` (keluhan Account #5)

| Berkas | Perubahan |
|---|---|
| `packages/domain/src/strategi.ts` | `approveStrategi` mendorong Service `[Awaiting Onboarding]` → `[Strategy Approved]` di transaksi persetujuan, lewat helper baru `driveServicesToStrategyApproved`. Header modul yang menyatakan "does not unlock Brief dispatch yet" diperbarui — pernyataan itu sudah tidak benar |
| `packages/domain/src/account.ts` | `guardBriefCreation` dapat **lengan kedua**: STRG- `Aktif` pada kontrak Service itu ikut membuka gerbang. `SERVICE_STATUS_*` + `MACHINE_SERVICE` di-export supaya nol duplikasi nama state |
| `packages/domain/src/account.ts` | **`resolveBriefStrategy`** — pintu KEDUA, lihat §2 |
| `supabase/migrations/20260922100400_a3_backfill_service_strategy_approved.sql` | Backfill lewat `sm_transition` aktor `SISTEM`, bukan `UPDATE` mentah |
| `docs/STATE_MACHINES.md:132` | Catatan "belum membuka gerbang Brief" diganti dengan aturan yang sekarang berlaku |

**Dua bentuk yang berbeda dari `account.approveStrategy` yang ditiru:**

1. **n Service, bukan satu.** Sejak O57 `strategi.service_id` **DIHAPUS** — satu
   Strategi menggantung di **kontrak**. Jadi persetujuan mendorong setiap Service
   tergerbang-Plan pada kontrak itu. Layanan **Direct tidak disentuh** (jalurnya
   `[Awaiting Onboarding]` → `[Briefed]`, edge-nya ada), begitu juga
   `ditentukan_am` yang G-B-nya belum dijawab.
2. **Gerbangnya perlu DUA lengan.** Service yang menempel ke kontrak SESUDAH
   Strategi-nya disetujui tidak pernah hadir di momen persetujuan ⇒ nol yang
   menggerakkan statusnya. Membaca status saja akan menguncinya **selamanya**.

FE: `ServiceQueueRow` dapat `strategi_id` / `strategi_status` / `contract_id`
(domain → `wire.ts` → tipe FE, satu jalur); `nextOnboardingStep` membaca jalur
STRG- lebih dulu lewat `strategiOnboardingStep`.

### A-4 · Durasi kerja sama pindah ke closing Sales (ketokan K-2)

| Berkas | Perubahan |
|---|---|
| `packages/domain/src/sales.ts` | `ClosingInput` += `durasiBulanOverride?` / `alasanOverride?`; **`sales.close` sekarang mencetak baris `contracts`** (`jenis = 'baru'`) dan menggantungkan setiap Service di bawahnya; `deriveDuration` + `resolveClosingWindow` di-export supaya aturannya bisa diuji tanpa DB; `OverrideReasonRequiredError` baru; `loadApprovedLines` membawa `durasi_bulan` dari KEDUA sumber enrichment-nya |
| `apps/api/.../attempts/[id]/close/route.ts` | Dua field body baru, diteruskan apa adanya (`undefined` ≠ `null` di sini — lihat komentarnya) |
| `web-internal/src/lib/sales.ts` + `sales/[id]/page.tsx` | Field "Durasi Kerja Sama (bulan, opsional)"; kotak alasan **hanya muncul** begitu ada angka |
| `web-internal/.../account/services/[id]/page.tsx` | Jendela kontrak jadi **read-only** kalau Service-nya bernaung kontrak; prefill dari `getContract` |

**Aturannya, dan dua hal yang BUKAN aturannya:**

- `MAX(durasi_bulan)` atas layanan yang ditutup. **Bukan SUM** (12 bulan + 3
  bulan = kesepakatan dua belas bulan, bukan lima belas), **bukan MIN** (periode
  Plan terakhir layanan terpanjang akan jatuh di luar jendela kontraknya sendiri).
- `durasi_bulan = null` **DILEWATI, bukan dibaca nol** (ketokan Q5): null berarti
  layanan sekali jadi, nol periode. Deal yang seluruhnya sekali-jadi ⇒
  **nol kontrak dicetak**, bukan kontrak satu bulan.
- `tanggal_akhir` lewat `tz.addMonthsToDate` — bulan **kalender** dengan clamp.
  31 Jan + 1 bulan = 28 Feb (29 Feb di tahun kabisat). `+30 hari` akan bilang
  2 Maret, dan setiap batas periode Plan sesudahnya mewarisi selisih itu.
- `tanggal_mulai` = `managedSince`, jatuh kembali ke tanggal closing **WIB**
  (`tz.dateString`). 23:30 UTC tanggal 8 sudah tanggal 9 di WIB.

**Kenapa override tetap ada:** `negotiation_proposal_lines` **tidak punya kolom
qty**, jadi penskalaan `qty_menambah = 'durasi'` yang MSL jelaskan (beli 3 GMV
Max ⇒ 3 bulan) tidak bisa diturunkan di sini. Override adalah tempat AM
menyatakannya — dengan alasan wajib.

**Kenapa read-only-nya BERSYARAT:** mengunci tanpa syarat berarti Service yang
tidak bernaung kontrak (deal sekali-jadi, atau closing sebelum A-4) tidak bisa
dibuatkan Strategi sama sekali.

---

## 2. Temuan yang tidak ada di rencana mana pun — dan bagaimana ia ketemu

Rencana A-3 menyebut dua berkas domain. **Ada tiga.**

`account.resolveBriefStrategy` menuntut baris `strategy_plans`, dan komentarnya
sendiri menyebut cabang nol-baris itu *"unreachable past the guard, defensive"*.
Selama gerbangnya hanya tahu jalur `STR-`, itu benar. Begitu lengan STRG-
dipasang, cabang itu jadi **terjangkau DAN jadi seluruh cacatnya satu lapis di
bawah gerbang**: gerbangnya lolos, lalu `createBrief` menolak dengan pesan yang
persis sama.

Yang menemukannya adalah **tes jahitan**, di menit pertama ia dijalankan. Tes
unit di kedua sisi sudah hijau — dan memang begitulah bug ini bertahan sampai
keluhan Account #5. Kalau sesi berikutnya menyentuh jahitan lain, tirulah
bentuknya: **satu tes yang memanggil KEDUA sisi sungguhan**.

Resolusinya: Brief jalur STRG- menyimpan `briefs.strategy_id = NULL`. FK-nya ke
`strategy_plans` dan baris `STR-`-nya memang tidak ada; konvensi ini sudah
ditetapkan jalur pewarisan M6B (`brief-inherit.ts` menulis `strategyId: null` dan
menyambung lewat `plan_row_id`).

---

## 3. Angka acuan — naik, tidak pernah turun

```
db-rebuild.sh  194 migrasi   (dari 193)
  gate: 146 tabel · 40 entity_prefix · 31 sm_machines · 73 notif_events
        + notif_katalog_sesuai              ← SEMUA TETAP, migrasi A-3 aditif murni
  invariant: ident_checks · immutability_checks · rls_checks · auth_claims_checks

domain            2017 lulus (+1 skip)   (dari 1994; +8 jahitan A-3, +14 A-4, +1 RLS A-3)
                  74 file lulus, NOL FAIL di DB bersih — diverifikasi terpisah
core               936
db                  53
apps/api           492   (route-parity & shape-parity hijau)
web-internal       657   (dari 650; + tsc --noEmit bersih + next build sukses)
web-client-portal   19
```

### ⚠️ A-T4 muncul, persis seperti diperingatkan

Jalan KEDUA suite domain atas DB yang sama memberi 2 FAIL
(`admin.test.ts` "hari libur", `client.test.ts` "Hold Service"). Suite yang
sama, dijalankan SEKALI sesudah `db-rebuild`, memberi **74 file lulus / 2017
tes lulus / nol FAIL** — jadi keduanya **lulus di DB bersih** — pencemaran `audit_log` tanpa aktor unik, `audit_log`
menolak DELETE sehingga `afterEach` tidak bisa membersihkannya. **Bukan
regresi.** Kalau muncul: `db-rebuild` dulu, baru cari bug. Polanya sudah ada di
repo (`aktorUnik()` di `showcase.test.ts`); di luar cakupan feedback OD.

### Jebakan yang gw kena sendiri sesi ini (tambahan atas daftar handoff lama)

1. **Backtick di dalam komentar SQL yang ada di template literal MEMUTUS
   template-nya.** `` sql`… -- pakai `order by` …` `` menghasilkan empat galat TS
   yang menunjuk ke baris yang kelihatan tidak bersalah. Penjelasan SQL ditaruh
   di JSDoc fungsinya, jangan di dalam string-nya.
2. **Tes yang membuat Brief di berkas yang cleanup-nya tidak tahu soal Brief
   akan merusak SETIAP tes sesudahnya**, bukan cuma dirinya: `fk_briefs_service`
   NO ACTION membuat `delete from services` gagal. `strategi.test.ts` sekarang
   membersihkan `brief_stage_sla` lalu `briefs`.
3. **`serviceQueue`/`getService` jalan DI BAWAH RLS** (`readAsActor`). Subquery
   yang diblokir RLS **tidak** melempar dan **tidak** membuang barisnya — ia
   diam-diam menghasilkan `NULL`. Itu lebih buruk dari 404 O52: halamannya
   menjawab 200 dengan nilai yang salah. Lengan `strategi` yang gw tambahkan
   diuji ke EMPAT peran yang bisa mencapai read itu
   (`reads_rls.test.ts`, "carries strategi_id/status to EVERY role") — bukan
   disimpulkan dari penalaran atas `rls_baseline.sql`.

---

## 4. Migrasi yang BELUM di-apply ke live — sekarang LIMA

§2 handoff pendahulu masih berlaku apa adanya, plus satu berkas:

| Urutan | Berkas | Isi | Menghapus? |
|---|---|---|---|
| 1 | `20260922100000_f2_private_brief_client_dan_pic.sql` | 4 fungsi `private.*` | tidak |
| 2 | `20260922100100_f3_notif_feedback_od.sql` | katalog v15, 4 event | tidak |
| 3 | `20260922100200_f4_briefs_jendela_budget_sumber.sql` | 4 kolom `briefs` + 3 CHECK | tidak |
| 4 | `20260922100300_a2_rls_cpr_lengan_finance.sql` | lengan Finance policy CPR | tidak |
| **5** | **`20260922100400_a3_backfill_service_strategy_approved.sql`** | **backfill status Service** | **tidak** |

Berkas 5 **tidak** aditif-skema — ia mengubah DATA (status Service). Dua hal:

- **Ia harus di-apply SESUDAH kode A-3 ter-deploy**, bukan sebelum. Alasannya
  kebalikan dari berkas 1–4: mendorong Service ke `[Strategy Approved]` sementara
  kode lama masih jalan akan membuat Service terlihat siap di-Brief oleh jalur
  `STR-` yang gerbangnya belum tahu STRG-. Aditif ≠ tak berdampak.
- **Idempoten dan terverifikasi.** Di container ini seed-nya nol baris (nol
  `strategi` di seed), jadi ia diuji terhadap fixture sintetis di dalam transaksi
  yang di-rollback: 2 Service tergerbang pindah (plan_wajib + override),
  Direct dan `ditentukan_am`-belum-dijawab **tetap**, `audit_log` terisi
  `transition:[Awaiting Onboarding]->[Strategy Approved]`, dan jalan kedua
  memindahkan **0**. Skripnya:
  `scratchpad/a3_backfill_check.sql` (tidak dibawa ke pohon — fixture sekali pakai).

Verifikasi tambahan sesudah apply:

```sql
-- nol Service yang tertinggal: ber-STRG- Aktif, tergerbang, tapi masih menunggu
select count(*) from services sv
  left join service_plan_gate g on g.service_id = sv.id
 where sv.status = '[Awaiting Onboarding]'
   and exists (select 1 from strategi s
                where s.contract_id = sv.contract_id and s.status = 'Aktif')
   and case when sv.requires_strategy_plan_override is not null
                 then sv.requires_strategy_plan_override
            when g.keputusan_am is not null then g.keputusan_am = 'butuh_plan'
            else sv.plan_tier = 'plan_wajib' end;
-- harus 0
```

---

## 4a. Gelombang D sudah masuk `main` lebih dulu — dan konfliknya EMPAT, bukan satu

Handoff pendahulu memprediksi satu konflik dengan pekerjaan Finance:
`docs/DECISIONS.md`. Waktu PR #309 (Gelombang D accrual + D-4 PPN) ter-merge ke
`main` dan sesi ini membawanya masuk, konfliknya **empat**:

| Berkas | Kenapa |
|---|---|
| `docs/DECISIONS.md` | Diprediksi. Penyisipan murni di anchor yang sama ⇒ **simpan keduanya**, nol baris dibuang: 10 baris Gelombang D (09-08) di atas, 2 baris A-3/A-4 (09-07) di bawah — konvensi terbaru-di-atas |
| `packages/domain/src/sales.ts` | **TIDAK diprediksi.** D-4 menambah `ClosingInput.includePPN` di blok yang sama dengan `durasiBulanOverride`/`alasanOverride` milik A-4 |
| `apps/api/.../attempts/[id]/close/route.ts` | idem — `include_ppn` di body yang sama |
| `web-internal/src/lib/sales.ts` | idem — tipe `ClosingInput` FE |

Keempatnya **penyisipan murni di dua sisi**, jadi resolusinya seragam: simpan
keduanya. **Pelajarannya buat penggabungan Jalur B:** pemetaan per-berkas di
handoff pendahulu memetakan `wire.ts`/`wire.test.ts`/`db-rebuild.sh`/`ci.yml`
dan menyimpulkan Gelombang D "tidak menyentuh" jalur closing — padahal D-4
menyentuhnya di tiga berkas. **Jangan percaya pemetaan konflik yang tidak
disimulasikan ulang.**

Sesudah merge: **196 migrasi**, seluruh gate TETAP (146/40/31/73). A-3
`20260922100400` menyortir **sebelum** D `20260923010000` — nol tabrakan stempel.

---

## 5. Sisa pekerjaan

1. **Penggabungan Jalur B** — §4 handoff pendahulu **sudah tidak bisa dipakai apa
   adanya**: simulasinya dijalankan terhadap `main` `b309e3bc`, dan `main`
   sekarang `1fee9839` (PR #309) **plus** merge sesi ini. Sesi ini menambah hunk
   di `wire.ts` (blok `ServiceQueueRowWire`), `packages/domain/src/account.ts`,
   `sales.ts`, dan FE `sales.ts`. Jalur B menyentuh `ANCHOR-WIRE-DELIVERY` (~446)
   ⇒ penilaian gw masih nol konflik di `wire.ts`, **tapi itu penilaian, bukan
   hasil**. **Simulasikan ulang `git merge-tree` sebelum merge** — §4a di atas
   adalah bukti bahwa pemetaan yang tidak disimulasikan ulang salah.
2. **Utang 6 layar yang belum pernah dilihat mata** (§5 handoff pendahulu) —
   **belum dibayar, dan sesi ini menambah dua**: form closing Sales (field durasi
   + kotak alasan yang muncul bersyarat) dan form Strategi dalam keadaan
   read-only + kartu info `CTR-`. Alasannya sama: nol harness peramban di repo.
   Chromium ada di `/opt/pw-browsers/chromium`.
3. **O75 dan O76 masih menunggu ketokan pemilik.** Keduanya tidak memblokir
   penggabungan B. A-4 **tidak** menutup O76 — katalog tetap tidak memuat angka
   GMV, jadi `sumber_floor = 'kontrak'` masih menunjuk sesuatu yang belum ada.

---

## 6. Cara memulai sesi berikutnya (copy-paste)

```bash
cd /home/user/AgencyAPP
git fetch origin
git checkout claude/handoff-feedback-lanjutan-t6urof

service postgresql start
su postgres -c "psql -c \"ALTER USER postgres PASSWORD 'postgres';\""
export DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps"
bash scripts/db-rebuild.sh --yes      # harus 194 migrasi, semua gate hijau

npm install
npm run typecheck --workspaces --if-present   # BACA keluarannya
(cd web-internal && npm install)
```

Lalu: **penggabungan Jalur B** (§5 butir 1), lalu Wave 3 Store Operation.
