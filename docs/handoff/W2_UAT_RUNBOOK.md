# W2 — Runbook UAT Wave 2 (gate exit Wave 2)

> Prasyarat & data: jalankan di stack UAT mock-HRIS-data-riil setelah boot order
> `backend/testdata/import_samples/README.md` §"UAT login gate" dan setelah gate exit
> Wave 1 GO (DECISIONS 2026-07-17). Mengikuti pola W1-20: setiap langkah mencantumkan
> **aktor**, **aksi**, dan **hasil yang diverifikasi** (status persis dalam `[...]`,
> pesan BI persis, audit). Kegagalan di langkah mana pun = no-go, catat di
> `docs/DECISIONS.md`. Semua status & pesan BI di runbook ini disalin persis dari
> `statemachine/config.go`, `docs/STATE_MACHINES.md`, atau entri Decided Wave 2 di
> `docs/DECISIONS.md` (sesi 2026-07-12..14 + integrasi 2026-07-17; peta renumber
> O30/O31/O32).
>
> Gap aktor riil (divisi KOL kosong; tanpa lead Creative/Ads; tanpa staf Live Stream)
> ditutup dengan **fixture UAT berlabel** mengikuti preseden O26/O33 — lihat **Open O34**
> di `docs/DECISIONS.md`: aktor produksi untuk peran-peran ini tetap butuh keputusan
> Yohan. Titik bertanda ⚠ = langkah yang memakai fixture O34 (bukan aktor riil).

## Roster aktor UAT (riil kecuali ditandai fixture)

| Peran runbook | Akun | Riil/fixture |
|---|---|---|
| Director (layered) | `UATDIR0001` / `UATDIR0002` | **fixture O26** (ganti baris riil Yohan & Nerissa) |
| OD (layered, read-only) | OKFA RENDI WIRATAMA (`2409230432`, HRGA) | riil |
| Sales Head (lead) | CUCU NURHAYATI (`2101180004`) | riil |
| Sales Staff | SAFFIRA MARWAH DESINTA (`2404160367`) | riil (email uppercase) |
| Account Lead (Head/SPV) | YULIANTI HANDAYANI (`2305100275`, Head of Account) | riil; alt MERYNTAN (`2310020314`, Leader CRO) |
| Account Staff (AM kandidat) | SYIFA NUR ALYA PUTRI (`2412090425`, CRO) | riil; alt SEPRI (`2203220082`), NURUL (`2304030267`) |
| Creative Staff | MOCHAMAD ARIF (`2111040039`, Graphic), ASSIFA (`2203020078`, Sr Videographer) | riil |
| Creative Lead / Team Leader | `UATCRE0001` | ⚠ **fixture O34** (tidak ada lead Creative riil) |
| Ads Staff (Advertiser) | KENNY (`2206060100`), ERLINA (`2307100292`), IBNU (`2309250310`) | riil |
| Ads Lead (SPV Ads) | `UATADS0001` | ⚠ **fixture O34** (tidak ada SPV Ads riil) |
| KOL Staff / Coordinator | `UATKOL0001` | ⚠ **fixture O34** (divisi KOL kosong di roster riil) |
| KOL Lead | `UATKOL0002` | ⚠ **fixture O34** |
| Live Stream Staff (divisi, queue-viewer) | `UATLSS0001` | ⚠ **fixture O34** (M10 = AM-owned; fixture hanya untuk uji queue divisi) |
| Finance Staff / Head | `UATFIN0001` / `UATFIN0002` | **fixture O33** (aktor Finance produksi belum diputus) |

Fixture O34 (`employees_uat.csv` + mapping `role_mappings_uat.csv`) UAT-only, berlabel
eksplisit FIXTURE; aktor produksi = keputusan Yohan (Open O34). ⚠ pada langkah = peran
dieksekusi fixture, bukan aktor riil — bawa ke catatan go/no-go.

---

## A. Persiapan

1. **Dev** — boot order UAT (semua dari `backend/`): `migrate up` (migrasi 0001–0029
   bersih), `cmd/mockhris` + `cmd/cdps` dengan `CDPS_SEED_CSV=…/employees_uat.csv`
   (auto-sync semua baris: 33 riil + 2 Director fixture O26 + 2 Finance fixture O33 +
   5 fixture O34 KOL/Creative-lead/Ads-lead/LS = 42),
   `rolemapseed --layered-csv …/layered_roles_uat.csv --apply`, `mslseed --actor
   2101180004 --apply`. ✔ sync `N/N` bersih; rolemapseed idempoten; OD OKFA `od:true`.
2. **Semua peran** — login lintas peran Wave 2 (Director fixture, OD OKFA, Sales Head,
   Account Lead YULIANTI, AM SYIFA, Creative ARIF, Ads KENNY, Finance fixture) dengan
   email riil + `rahasia123`. ✔ login OK, role resolution benar; password salah →
   `[email atau password salah]`; email luar roster ditolak; **OD terbukti read-only**
   (semua write → `[anda tidak memiliki akses ke data ini]`); HRIS mati →
   `[sistem HRIS tidak dapat dihubungi, coba beberapa saat lagi]`.
3. **Dev/precondition** — pastikan ≥1 klien `released_to_account_at IS NOT NULL` (hasil
   akhir W1-20, mis. `CLI-202607-0002`) dengan ≥1 baris `services` (`SVC-…`). ✔ Service
   lahir dan berstatus `[Awaiting Onboarding]` (config.go initial §6); flag
   `requires_strategy_plan` ter-pin read-only dari MSL (default `No` ⇒ jalur Direct,
   O18/O30).

## B. M6 — Onboarding & AM assignment (§3)

4. **Account Lead (YULIANTI)** — `GET /api/v1/account/intake` (antrean intake belum
   ter-assign). ✔ klien released tampil. **AM staff (SYIFA)** buka intake ⇒ ditolak
   `[anda tidak memiliki akses ke antrean intake Account]`.
5. **Account Lead** — `POST /api/v1/clients/{id}/assign-am` ke SYIFA (staff Account
   aktif). ✔ `clients.assigned_am_id` = SYIFA, audit `am_assigned` (immutable). Negatif:
   assign ke **YULIANTI** (lead, bukan staff) ⇒ `[Account Manager tidak valid: harus
   staff divisi Account yang aktif]`; assign lagi (sudah ada AM) ⇒ `[klien sudah memiliki
   Account Manager, gunakan reassignment]`; **AM staff** mencoba assign ⇒ `[anda tidak
   memiliki akses untuk menugaskan Account Manager]`.
6. **Account Lead** — `POST /api/v1/clients/{id}/reassign-am` tanpa alasan ⇒ `[alasan
   reassignment wajib diisi]`; ke AM yang sama ⇒ `[Account Manager tujuan sama dengan
   yang sekarang]`; dengan alasan valid ke AM lain lalu balik ke SYIFA ⇒ audit
   `am_reassigned` (reason tercatat, history immutable, M6 §3 Rule 3).
7. **Visibilitas pasca-assign** — **AM SYIFA** kini melihat klien assigned; **AM lain
   (SEPRI)** ⇒ 404 (pelunasan W1-10, M6 §3); **Account Lead** melihat semua klien
   released. ✔ konsisten laporan W1-20 catatan [11].

## C. M6 §4 — Strategy & Plan (plan-gated) + jalur Direct + override M6-OA-1

8. **AM (SYIFA)** — untuk Service Direct (flag pin `No`): `POST /api/v1/services/{A}/
   strategy` ⇒ `[layanan ini tidak memerlukan Strategy & Plan]` (guard flag efektif).
9. **AM (SYIFA)** — M6-OA-1 override per-engagement pada Service `B`
   (`POST /api/v1/services/{B}/strategy-requirement`, requires=Yes + alasan). ✔ flag
   efektif flip via `COALESCE(override, pin)`, audit before→after + reason. Negatif:
   alasan kosong ⇒ `[alasan perubahan kebutuhan Strategy & Plan wajib diisi]`; **OD /
   AM lain / divisi lain** ⇒ `[anda tidak memiliki akses untuk mengubah kebutuhan
   Strategy & Plan layanan ini]`; Service bukan `[Awaiting Onboarding]` atau Strategy
   sudah ada ⇒ `[kebutuhan Strategy & Plan hanya dapat diubah saat layanan berstatus
   Awaiting Onboarding]`. (Gate = owning AM + Account lead/SPV + Director, W2-M6-C5.)
10. **AM (SYIFA)** — `POST /api/v1/services/{B}/strategy` ⇒ `STR-…` lahir `[Strategy
    Drafting]`. Negatif: **AM lain** ⇒ `[hanya Account Manager pemilik klien yang dapat
    mengelola Strategy & Plan layanan ini]`; buat kedua kali ⇒ `[Strategy & Plan untuk
    layanan ini sudah ada]`. Lalu `PUT /api/v1/strategies/{id}` (update draft) OK.
11. **AM (SYIFA)** — `POST /api/v1/strategies/{id}/submit` ⇒ `[Strategy Drafting]` →
    `[Strategy Submitted for Approval]`. Negatif: update draft pasca-submit ⇒ `[Strategy
    & Plan hanya dapat diubah saat berstatus Strategy Drafting]`.
12. **Account Lead (YULIANTI)** — `POST /api/v1/strategies/{id}/request-revision` tanpa
    notes ⇒ `[catatan revisi wajib diisi]`; dengan notes ⇒ `[Strategy Submitted for
    Approval]` → `[Strategy Drafting]`, Revision Count +1 **derived dari audit log**
    (tanpa tally tersimpan). AM re-submit lagi. **AM mencoba approve** ⇒ `[anda tidak
    memiliki akses untuk menyetujui atau meminta revisi Strategy & Plan]`.
13. **Account Lead (YULIANTI)** — `POST /api/v1/strategies/{id}/approve` ⇒ transisi
    ganda dalam SATU transaksi: `STR-` → `[Strategy Approved]` (terminal) **dan** Service
    `B` `[Awaiting Onboarding]` → `[Strategy Approved]` (config.go §6/§6a). ✔ `Approved
    By` tercatat.

## D. M6 §5–§6 — Brief breakdown & dispatch per divisi

14. **AM (SYIFA)** — guard Brief sebelum approval: pada Service plan-gated yang MASIH
    `[Awaiting Onboarding]`, `POST /api/v1/services/{id}/briefs` ⇒ `[layanan ini wajib
    memiliki Strategy & Plan yang disetujui sebelum dibuatkan Brief]` (GuardBriefCreation,
    `strategy.go:83`).
15. **AM (SYIFA)** — CreateBrief jalur Direct (Service `A`, tanpa `strategy_id`) ⇒ brief
    pertama menggerakkan Service `A` `[Awaiting Onboarding]` → `[Briefed]` (edge Direct,
    config.go:166). Negatif: Direct + `strategy_id` terisi ⇒ `[layanan Direct tidak boleh
    memiliki Strategy ID pada brief]`.
16. **AM (SYIFA)** — CreateBrief jalur plan-gated (Service `B`, `strategy_id` = STR
    approved) untuk divisi Creative, Ads, KOL, Live Stream. ✔ `BRF-…` lahir `[To Do]`;
    Service `B` `[Strategy Approved]` → `[Briefed]`. Negatif: `strategy_id` salah/bukan
    approved ⇒ `[Strategy ID brief harus menunjuk Strategy & Plan yang disetujui untuk
    layanan ini]`; divisi invalid ⇒ `[divisi tujuan tidak valid]`; prioritas invalid ⇒
    `[prioritas tidak valid]`; **AM lain** ⇒ `[hanya Account Manager pemilik klien yang
    dapat membuat Brief untuk layanan ini]`.
17. **AM (SYIFA)** — Brief divisi **Live Stream** lahir **off-machine** `[Dispatched to
    Vendor]` (STATE_MACHINES §7: LS skip mesin task; status off-machine DISETUJUI Nerissa
    W2-M6-C3). ✔ tidak masuk mesin §7; tidak bisa digerakkan edge task.
18. **Divisi target + Account lead + OD + Director** — `GET /api/v1/divisions/{division}/
    brief-queue`. ✔ staf+lead divisi target, Account lead, OD, Director melihat antrean.
    Negatif: staf divisi lain ⇒ `[anda tidak memiliki akses ke antrean brief divisi
    ini]`. ⚠ Staf-viewer antrean **KOL** (`UATKOL0001`) & **Live Stream** (`UATLSS0001`)
    = fixture O34 (Account lead/OD/Director riil tetap memantau).

## E. M12 — Task Execution (Brief-as-task) + hook `[In Execution]`

19. **Staf divisi target** — `POST /api/v1/tasks/{id}/start` ⇒ `[To Do]` → `[In
    Progress]` (model KLAIM W2-M12-C1: pra-PIC semua staf/lead divisi target boleh).
    ✔ brief pertama meninggalkan `[To Do]` memanggil `OnBriefLeavesToDo` ⇒ Service →
    `[In Execution]` (config.go:168) se-transaksi. Negatif: transisi ilegal (mis. start
    saat `[Submitted]`) ⇒ `[transisi status tidak diizinkan]`.
20. **Lead divisi / Director** — `POST /api/v1/tasks/{id}/assign-pic` + `POST
    /api/v1/tasks/{id}/sla`. ✔ PIC & SLA ter-audit. Negatif: PIC bukan staff aktif divisi
    tujuan ⇒ `[PIC tidak valid: harus staff divisi tujuan yang aktif]`; SLA ≤0 ⇒ `[target
    SLA harus lebih dari 0 jam]`; **staf/AM** menugaskan ⇒ `[anda tidak memiliki akses
    untuk menugaskan PIC atau menetapkan SLA task ini]`.
21. **Non-PIC (staf lain)** — pasca-PIC, start/submit oleh non-PIC ⇒ `[anda tidak memiliki
    akses untuk mengerjakan task ini]` (klaim terkunci ke PIC + lead + Director).
22. **PIC** — `POST /api/v1/tasks/{id}/submit` ⇒ `[In Progress]` → `[Submitted]`.
    **AM (SYIFA)** — `review` ⇒ `[In Review]`, lalu `approve` ⇒ `[Approved]` (terminal),
    atau `request-revision` ⇒ `[Revision Requested]`; **PIC** `rework` ⇒ `[Revision
    Requested]` → `[In Progress]` (turnaround TIDAK reset, Revision Count +1 derived).
23. **Alur block (§5.3a)** — **staf** `POST /api/v1/tasks/{id}/block-request` tanpa alasan
    ⇒ `[alasan permintaan block wajib diisi]`; dengan alasan ⇒ notifikasi
    `EvBlockRequestSubmitted` (katalog existing). **Lead/Director**
    `.../block-requests/{reqId}/approve` ⇒ `[Blocked]` + `EvBlockRequestDecided`; **staf**
    memutuskan ⇒ `[anda tidak memiliki akses untuk memutuskan permintaan block]`;
    request sudah diproses ⇒ `[permintaan block sudah diproses]`. **Lead/Director** `resume`
    ⇒ `[Blocked]` → `[In Progress]` (STATE_MACHINES §7: pause/resume = SPV/Lead-only;
    interval Blocked dikecualikan dari turnaround).
24. **Any read** — `GET /api/v1/tasks/{id}/metrics`. ✔ Speed Score = turnaround ÷ SLA
    (uncapped, §5.1); SLA absen ⇒ `"N/A"`; div-by-zero ⇒ `"—"` (konvensi #7); bucketing
    periode WIB (O20). Worked example Alpha Digital 54÷48 = 112.5% tereproduksi.

## F. M7 — Creative Asset + Daily Output (WIB, EOD lock)

25. **Creative staf (ARIF)** — `POST /api/v1/briefs/{id}/assets` (sequence 1..
    quantity_target). ✔ `AST-…` lahir `[To Do]`. Negatif: seq di luar rentang ⇒ `[nomor
    urut aset harus antara 1 dan jumlah target brief]`; seq dobel ⇒ `[nomor urut aset
    sudah digunakan pada brief ini]`; brief bukan Creative ⇒ `[brief ini bukan brief
    divisi Creative]`; PIC invalid saat CreateAsset ⇒ `[PIC tidak valid: harus staff
    divisi Creative yang aktif]`.
26. **Creative staf (ARIF)** — edge eksekusi Asset via engine M12: `POST /api/v1/assets/
    {id}/start` ⇒ roll-up forward-only: asset pertama keluar `[To Do]` ⇒ Brief `[In
    Progress]` ⇒ (brief pertama) Service `[In Execution]`. `submit` tanpa link output ⇒
    `[link output wajib diisi sebelum submit]` (PRD verbatim, `task.go:101`). Negatif:
    `assign-pic` Asset oleh non-lead ⇒ pesan M12 `[PIC tidak valid: harus staff divisi
    tujuan yang aktif]` (AssignAssetPIC = metode M12, W2-API-1). ⚠ assign-PIC/SLA Asset =
    lead Creative + Director; lead Creative = fixture `UATCRE0001` (O34).
27. **AM (SYIFA)** — review/approve per-Asset (`review` / `approve` / `request-revision`).
    ✔ `[Submitted]` → `[In Review]` → `[Approved]`. Negatif: **AM lain** ⇒ `[hanya Account
    Manager pemilik klien yang dapat mereview aset ini]`; request-revision tanpa feedback
    ⇒ `[feedback revisi wajib diisi]`. (Brief ber-asset TIDAK pernah `[Revision
    Requested]` — revisi per-Asset.)
28. **PIC / Creative lead / Director** — `POST /api/v1/assets/{id}/hours` (manual
    overwrite-and-audit). Negatif: nilai ≤0 ⇒ `[jumlah Hours Logged harus lebih dari 0]`;
    aktor tak berhak ⇒ `[anda tidak memiliki akses untuk mencatat Hours Logged aset ini]`.
29. **PIC (ARIF) / Creative lead / OD / Director** — `GET /api/v1/daily-output/{picId}
    ?date=YYYY-MM-DD` (default hari ini WIB). ✔ feed turunan murni dari audit transisi;
    hari WIB lampau ⇒ `locked=true` (immutability by construction); tanggal malformed ⇒
    `[format data tidak valid]`. Negatif: **staf Creative lain / AM / divisi asing** ⇒
    `[anda tidak memiliki akses ke Daily Output ini]` (read gate lebih sempit, W2-M7-C2).

## G. M8 — Ad Campaign + gate Launch dua sisi (born-`[Paused]`, O32)

30. **Ads staf (KENNY)** — `POST /api/v1/briefs/{id}/campaigns` saat brief Ads `[In
    Progress]` ⇒ `ADC-…` **lahir `[Paused]`** (birth-status INSERT, belum spend riil,
    O32). Negatif: brief bukan `[In Progress]` ⇒ `[kampanye iklan hanya dapat dibuat saat
    brief berstatus In Progress]`; brief bukan Ads ⇒ `[brief ini bukan brief divisi
    Ads]`; platform invalid ⇒ `[platform tidak valid]`; tanggal invalid ⇒ `[tanggal mulai
    dan selesai kampanye tidak valid]`.
31. **Ads staf (KENNY)** — `POST /api/v1/campaigns/{id}/assets` tautkan Creative Asset.
    Negatif: aset belum `[Approved]` ⇒ `[aset kreatif harus disetujui sebelum
    ditautkan]`; aset klien lain ⇒ `[aset kreatif bukan milik klien layanan ini]`; tautan
    dobel ⇒ `[aset kreatif sudah ditautkan ke kampanye ini]`.
32. **PIC Ads / staf** — `POST /api/v1/tasks/{briefId}/submit` untuk brief setup Ads
    TANPA ADC ber-aset ⇒ `[campaign belum lengkap, lengkapi platform/budget/aset kreatif
    sebelum submit]` (PRD verbatim, guard M12 §4 Rule 3 via `BriefSubmitGuard`, W2-API-3).
33. **Ads staf (KENNY)** — `POST /api/v1/campaigns/{id}/launch` (`[Paused]` → `[Active]`)
    diuji **dua sisi** code guard §12: (a) brief setup belum `[Approved]` ⇒ `[kampanye
    belum dapat diluncurkan, brief setup belum disetujui]` (`ads.go:138`); (b) brief
    approved tapi ada aset tertaut belum `[Approved]` ⇒ `[kampanye belum dapat
    diluncurkan, aset kreatif tertaut harus disetujui]` (`ads.go:141`). Setelah brief
    `[Approved]` + SEMUA aset tertaut `[Approved]` ⇒ Launch OK ⇒ `[Active]`.
34. **Ads staf (KENNY)** — `pause` (`[Active]` → `[Paused]`), `end` (`[Active]`/`[Paused]`
    → `[Ended]`, terminal). Negatif: transisi di luar 3-status ⇒ `[transisi status tidak
    diizinkan]` (§14, config.go:287–293). **Revisi 2026-07-20 (gate M8, DECISIONS):**
    metric entry pada kampanye `[Ended]` kini DITOLAK **422** `[ad campaign sudah
    berakhir, metric entry tidak bisa dicatat]` — karena itu langkah 35 (entri metrik)
    DIEKSEKUSI SEBELUM `end` langkah ini, dan langkah ini menambah satu assertion
    negatif: POST metrics pasca-`end` ⇒ 422 string tsb.
35. **Ads staf (KENNY)** — `POST /api/v1/campaigns/{id}/metrics` (append-only; dieksekusi
    saat kampanye masih `[Active]` — lihat catatan langkah 34). Negatif:
    spend/GMV negatif ⇒ `[nilai spend dan GMV tidak boleh negatif]`; metode input invalid
    ⇒ `[metode input tidak valid]`. ✔ Total Spend/GMV/ROAS **derived** (Σ metric_entries;
    div-by-zero ⇒ `—`); Attributed GMV per-aset = Σ (entry.gmv ÷ jumlah aset snapshot),
    equal-split + Creative-Swap-safe (§7), dimaterialisasi via recompute-from-scratch.
36. **Advertiser polos vs owning AM/Director** — `POST /api/v1/campaigns/{id}/
    optimizations` dengan penyesuaian budget >50% oleh Advertiser polos ⇒ **403**
    `[penyesuaian budget lebih dari 50% memerlukan persetujuan AM/SPV Ads]` (M8-OA-3).
    ⚠ Otoritas sah = owning AM / **SPV Ads** / Director; SPV Ads = fixture `UATADS0001`
    (O34) — uji jalur "diizinkan" via SPV Ads fixture DAN owning AM (SYIFA).

## H. M9 — KOL Booking + CPR + Attributed GMV  ⚠ (aktor KOL = fixture O34)

> ⚠ Divisi KOL tidak memiliki aktor riil di roster HR — bagian H dijalankan dengan
> **fixture O34**: `UATKOL0001` (staff/Coordinator kandidat) + `UATKOL0002` (KOL lead).
> Model klaim pra-/pasca-Coordinator dan otoritas lead teruji dengan LEVEL peran yang
> benar, tetapi tetap fixture — aktor KOL produksi = keputusan Yohan (Open O34).

37. **KOL staff (`UATKOL0001`)** — `POST /api/v1/briefs/{id}/bookings` pada brief KOL ⇒ `BKG-…`
    lahir `[Sourcing]`. Negatif: brief bukan KOL ⇒ `[brief ini bukan brief divisi KOL]`;
    brief status salah ⇒ `[booking tidak dapat dibuat untuk brief pada status ini]`;
    source pool invalid ⇒ `[source pool tidak valid]`. Roll-up: BKG pertama keluar
    `[Sourcing]` ⇒ Brief `[In Progress]` ⇒ Service `[In Execution]`.
38. **KOL staff/lead (fixture O34)** — lifecycle native §8: `book` ⇒ `[Booked]`, `start-content` ⇒
    `[Content In Progress]`, `submit-content` ⇒ `[Content Submitted]` (link wajib ⇒
    `[link konten wajib diisi sebelum submit]`), `send-qc` ⇒ `[QC Review]`, `pass-qc` ⇒
    `[QC Passed]` (terminal). Negatif: `fail-qc`/`escalate` tanpa catatan ⇒ `[catatan QC
    wajib diisi]`; cap revisi 1 tercapai lalu FailQC ⇒ `[batas revisi kreator tercapai,
    silakan eskalasi booking]`; `drop` tanpa alasan ⇒ `[alasan drop wajib diisi]`
    (`[Dropped]` = EXCLUDED total dari Speed Score).
39. **Coordinator/KOL lead (fixture O34)** — `POST /api/v1/bookings/{id}/attributed-gmv` (M9-OA-4). Gate:
    hanya saat `[QC Passed]` ⇒ selain itu `[GMV teratribusi hanya dapat dicatat setelah
    booking QC Passed]` (`kol.go:172`); overwrite-and-audit (`attributed_gmv_recorded`);
    NULL = tak ada trackable link (render `—`), 0 = pembacaan sah. Otoritas = Coordinator
    booking / KOL lead / Director (TANPA AM — **AM ditolak** = uji negatif) ⚠ fixture O34.
40. **KOL staff/lead (fixture O34)** — `POST /api/v1/bookings/{id}/payment-request` hanya
    saat `[QC Passed]` ⇒ selain itu `[permintaan pembayaran hanya dapat dibuat setelah
    booking QC Passed]`; amount ≠ Agreed Rate ⇒ `[jumlah pembayaran harus sama dengan
    Agreed Rate booking]` (`kol.go:146`); dobel ⇒ `[permintaan pembayaran untuk booking
    ini sudah ada]`. ✔ `CPR-…` `[Requested]`.
41. **Finance fixture (`UATFIN0001/0002`)** — sisi Finance CPR: `receive` ⇒ `[Received by
    Finance]`, `pay` ⇒ `[Paid]`, atau `reject` (reason wajib ⇒ `[alasan penolakan wajib
    diisi]`) ⇒ `[Rejected]`. ✔ Payment Status di BKG = refleksi CPR terderivasi. ⚠ aktor
    Finance = fixture O33.

## I. M10 — Live Stream Session (LSS-) vendor tracker (AM-owned)

42. **AM (SYIFA) / Director** — `POST /api/v1/briefs/{id}/sessions` pada brief LS
    `[Dispatched to Vendor]` ⇒ `LSS-…` lahir `[Requested]`. Negatif: brief bukan LS ⇒
    `[brief ini bukan brief divisi Live Stream]`; platform di luar enum ⇒ `[platform
    tidak valid]`; durasi ≤0 ⇒ `[durasi harus lebih dari 0 jam]`; datetime malformed ⇒
    `[format tanggal/waktu tidak valid]`. **Staf non-AM** ⇒ `[anda tidak memiliki akses
    untuk mengelola sesi live stream ini]`.
43. **AM (SYIFA)** — `confirm` ⇒ `[Confirmed by Vendor]`; `results` ⇒ `[Completed]` (gate
    §4 Rule 2: actual datetime/duration/orders/GMV wajib + Vendor Report Link wajib ⇒
    `[link laporan vendor wajib diisi sebelum sesi selesai]`, `livestream.go:123`).
    Data Confidence Tier auto `Vendor-Reported` (GMV tidak didiskon).
44. **AM (SYIFA)** — `reconcile` ⇒ `[Reconciled]` (terminal), ATAU `flag-discrepancy`
    (notes wajib ⇒ `[catatan rekonsiliasi wajib diisi]`; NON-BLOCKING ⇒ boleh lanjut
    `[Reconciled]`) ⇒ notifikasi real-time `EvSessionDiscrepancyFlagged` (katalog
    existing, via `onTransition`). ✔ saat SEMUA session brief `[Reconciled]` (≥1), brief
    LS di-UPDATE `[Dispatched to Vendor]` → `[Approved]` + audit `ls_brief_reconciled`
    (off-machine, bukan engine).
45. **AM (SYIFA) / Director** — reopen O27-b: `POST /api/v1/briefs/{id}/reopen`
    (`[Approved]` → `[Dispatched to Vendor]`, M10-OA-4) + audit `ls_brief_reopened`.
    Negatif: **AM lain / Account lead / OD / staf divisi lain** ⇒ `[anda tidak memiliki
    akses untuk membuka kembali brief ini]`; brief bukan `[Approved]` ⇒ `[brief tidak
    dapat dibuka kembali pada status ini]`. ✔ session baru bisa dibuat pasca-reopen;
    roll-up menutup ulang brief saat semua session (lama+baru) `[Reconciled]`.
46. **Interaksi void** — pada brief ter-void `[Cancelled — Service Voided]`,
    `CreateSession` ⇒ `[brief untuk sesi ini telah dibatalkan]`; pada brief `[Approved]`
    ⇒ `[sesi tidak dapat dibuat untuk brief pada status ini]`; session milik brief
    ter-void DIBEKUKAN (semua edge lifecycle ditolak, status tak berubah).

## J. Audit immutable + recompute derived fields

47. **OD (OKFA, read-only)** — telusuri audit log seluruh perjalanan Wave 2 (am_assigned/
    reassigned → STR submit/revisi/approve → brief dispatch → task start/submit/review/
    approve/block → asset transitions → ADC metrics/optimizations → BKG lifecycle → LSS
    reconcile/reopen). ✔ rantai immutable (actor, before→after, timestamp); tidak ada
    jalur UPDATE/DELETE; OD semua write ⇒ ditolak.
48. **Dev** — recompute derived dari log = nilai tampil: (a) Speed Score / turnaround /
    Revision Count M12 dari transisi; (b) Daily Output M7 dari audit transisi Asset (WIB,
    lock); (c) ADC Total Spend/GMV/ROAS + Attributed GMV per-aset dari `metric_entries` +
    snapshot `metric_entry_assets`; (d) GMV booking / session `[Reconciled]`. ✔ semua
    recomputable, tidak ada kolom running mutable.

## K. Penutup — Go/No-Go manusia

49. **Nerissa/Yohan + head dev** — putuskan go/no-go **gate exit Wave 2** (Build Plan §4);
    catat hasil + temuan (termasuk peran ber-fixture ⚠: KOL + Creative/Ads lead + LS staf
    = fixture O34, Finance fixture O33, Director fixture O26) di `docs/DECISIONS.md`.
    Pola langkah 18 W1-20 — keputusan manusia, bukan agent.
