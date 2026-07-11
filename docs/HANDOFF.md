# CDPS — Session Handoff (living document)

> Update this file at the end of every build session: what landed, what's next, what's blocked. Read it FIRST when resuming work. Complements (never replaces) `docs/DECISIONS.md`.

## 2026-07-11 (sesi lanjutan #2) — Wave 1 Fase 4 landed (W1-09 Closing)

**Branch:** `claude/handoff-process-continuation-69uk1f` · **PR #5** · **`go test ./...` hijau penuh** (MariaDB lokal); migrasi 0001–0049 up→down→up bersih.

### Ticket status delta

| Ticket | Status | Where |
|---|---|---|
| W1-09 Closing Form (M0 §6) | ✅ | `module0_sales/closing.go` (`Closing`, `NewClosing(attempts, win)`, `SubmitClosing`, `GetClient`); migrasi `0047_clients`(+`sales_allocations`), `0048_client_services`, `0049_transactions`(+`installments`); string BI `[total termin tidak sama dengan nilai transaksi]` di `msg` |

Closing melahirkan Client (`CLI-`), Transaction (`TRX-`), Service(s) (`SVC-`), dan (Termin/Bayar di Belakang) Installment(s) (`INST-`) atomik dalam satu `engine.InTx`; transisi attempt pemenang → `Closed-Success`; memanggil win-resolution (M1 §6 rule 5) untuk menutup kompetitor pool `[Closed - Kalah Kompetisi]`.

### Koreksi arsitektur penting (vs kontrak handoff sebelumnya)
Kontrak lama menulis "W1-09 memanggil `leads.Service.ResolveWin(...)`". Implementasi final **TIDAK meng-import `module1_leads` dari `module0_sales`** (itu memicu import cycle karena `claim_test.go` package `leads` sudah meng-import `module0_sales`). Sebagai gantinya, `SubmitClosing` menerima **`WinResolverFunc`** (callback tanpa tipe leads); lapisan wiring/test mengikatnya ke `leads.Service.ResolveWin` dengan `*sales.Attempts` sebagai resolver. Ini justru memenuhi "tanpa import silang" lebih tepat. Detail di DECISIONS.md baris W1-09.

### Kontrak untuk fase berikutnya
- **M4 (Fase 5, W1-10…13)** dan **M5 (Fase 6, W1-14…18)** membangun DI ATAS tabel kelahiran ini: `clients`, `sales_allocations`, `client_services`, `transactions`, `installments` sudah ada (skema minimal). Tambah kolom/behavior via migrasi baru — jangan buat ulang tabelnya. `transactions.payment_status` & `installments.status` sudah lahir di initial state dan siap dipakai Store adapter statemachine M5 (label byte-exact sudah cocok dengan `machines.go`).
- **Wiring produksi belum ada** (belum ada HTTP/app layer): `Closing` perlu di-construct dengan `WinResolverFunc` yang mengikat `leads.Service.ResolveWin`. Contoh binding ada di `closing_test.go newClosingEnv`.
- **Catatan penting untuk M4/M5 stream paralel (PR #2, Akun B):** Akun B sudah membangun M4/M5 di branch terpisah dengan skema tabelnya sendiri. Fase 5–6 di branch ini kemungkinan besar **rekonsiliasi/merge** dengan hasil Akun B, bukan bangun dari nol — cek `WAVE1_PARALLEL_PLAN.md` di branch Akun B sebelum mulai.

### Open baru/relevan
- **O18** (siapa accept counter-offer) & **O21** (resubmit setelah Reject) masih open (dari Fase 3).
- Tidak ada open baru dari W1-09; semua ambiguitas M0 §6 (string BI closing, batas visibilitas Account) di-encode konservatif dan dicatat di baris DECISIONS W1-09.

## 2026-07-11 (sesi lanjutan) — Wave 1 Fase 3 landed (W1-07/08 Negosiasi)

**Branch:** `claude/handoff-process-continuation-69uk1f` (rebased di atas `claude/cdps-sprint-0-handoff-c48u62` @ `aeb4680`) · **`go test ./...` hijau penuh** (MariaDB lokal).

### Ticket status delta

| Ticket | Status | Where |
|---|---|---|
| W1-07 Negotiation — non-nego path (M0 §5) | ✅ | `module0_sales/negotiation.go` `SubmitNoNegotiation` — standard terms only, custom term → `ErrCustomTermRequiresNegotiation` (AC "forces switch"), status `Negotiation - Auto Approved`, versi 1 `standard` langsung approved; migrasi 0043–0046 |
| W1-08 Negotiation — full flow + approval (M0 §5) | ✅ | `SubmitNegotiation` (submit & resubmit, versi berjalan), `ApproveNegotiation` / `CounterNegotiation` (notes wajib) / `RejectNegotiation` (notes wajib) / `AcceptCounterOffer` ("system syncs values" = pin `approved_version` ke versi counter), `GetNegotiation`; history 3 tabel append-only + trigger; notifikasi katalog O15 via `WireNegotiationNotifications` |

### Kontrak untuk W1-09 (Closing) — Fase 4 berikutnya
- **Baca hasil negosiasi:** `sales.GetNegotiation(...)` → `Negotiation.Approved()` = versi ter-approve: `TotalValue` = *final approved transaction value* (M0 §6 rule 6), `Services` = jasa final (nama/harga/komisi/terms ter-pin per versi MSL). `nil` selama belum approved — closing hanya legal dari `Approved`/`Auto Approved` (engine yang menegakkan).
- **Tetap wajib** (kontrak lama, belum berubah): panggil `leads.Service.ResolveWin(ctx, tx, resolver, ...)` DI DALAM transaksi closing setelah attempt pemenang `Closed-Success`; `resolver` = `*sales.Attempts`.
- **Migrasi:** 0043–0046 terpakai (negotiations, versions, version_services, decisions); range M0 sisa **0047–0049** untuk W1-09.
- **Bootstrap notifikasi:** panggil `sales.WireNegotiationNotifications(center)` sekali di app bootstrap setelah `notify.NewCenter(DefaultCatalog())` — belum ada main wiring produksi (menyusul saat HTTP layer).

### Keputusan & open baru
- **DECISIONS.md 2026-07-11 (W1-07/08)**: baris dev-level lengkap (skema header+history, baseline pin MSL, re-evaluasi komisi vs harga proposal, % nego = rule percent, non-nego sentinel tanpa BI string, payment terms bebas ≤255, accept = pin versi counter, set jasa nego tak dibatasi 5, resolver notifikasi + COLLATE fix).
- **O21 (baru):** M0 §5 prose bilang setelah Reject salesperson boleh "submit a fresh proposal", tapi SM §1 tidak punya edge `Rejected → Pending Approval` (O11: keluar Rejected hanya `Closed-Lost`). Berjalan ikut mesin — resubmit setelah Reject diblokir.
- **O18 (masih open):** siapa yang boleh accept counter-offer. Encoding berjalan tetap `lead_spv`-only (edge mesin); `AcceptCounterOffer` mendelegasikan penuh ke engine, jadi resolusi O18 = perubahan 1 baris di `machines.go` + flip 1 assert di `negotiation_test.go` (`TestNegotiation_CounterThenAccept`).

### Langkah berikutnya
1. **Fase 4 — W1-09 Closing** (M0 §6): alokasi Σ=100%, ≤5 sales, Commission & Payment PIC, generate `CLI-`/`TRX-`/`SVC-` atomik (`ids.Generator` satu tx), panggil `ResolveWin`, Payment Intent → antrian M5. Baca PRD M0 §6 + M4 v2 §2–3 + M5 §2 penuh dulu.
2. Fase 5 — M4 (W1-10…13), Fase 6 — M5 (W1-14…18), Fase 7 — QC + seed end-to-end + retarget PR.

## 2026-07-11 — Wave 1 Fase 1–2 landed (W1-01/02/05 + W1-03/04/06)

**Branch:** `claude/cdps-sprint-0-handoff-c48u62` · **Base:** `claude/platform-dev-continue-c3vtde` (stacked di atas PR #3) · **PR:** #4 (draft) · **Commit terakhir:** `de0ea64` · **`go test ./...` hijau penuh** (MariaDB lokal: `service mariadb start` dulu — test DB-bound skip diam-diam bila DB mati).

### Ticket status (docs/backlog/WAVE1 BACKLOG.md)

| Ticket | Status | Where |
|---|---|---|
| W1-01 LEAD registry + pintu registrasi Sales | ✅ | `internal/module1_leads` — dedup engine (`dedup.go` decision table §5), normalisasi telepon, reopen, manual-review M1-OA-4; migrasi 0030–0031 |
| W1-02 Bulk import Marketing (CSV) + campaign gate stub | ✅ | `import.go` + `campaign_stub` (migrasi 0031); laporan per-baris byte-exact |
| W1-05 Attempt lifecycle (PRSP-) | ✅ | `internal/module0_sales` — semua edge §1 via engine; `UpdateStatus`/`QualifyFromForm`/`SystemTransition` |
| W1-03 Pool claim + win resolution (M1 §6) | ✅ | `module1_leads/claim.go` (`ClaimPoolLead`, `ResolveWin`) + `module0_sales/competition.go` (`OpenAttempts`, `CloseKalah`) lewat seam `CompetitionResolver`; migrasi 0032; AC dua-klaiman end-to-end di `claim_test.go` |
| W1-04 Taksonomi NQ Reason + junk breakdown | ✅ | `module0_sales/status.go` (7 pilihan tertutup M1-OA-8, `[Lainnya ...]` wajib detail) + `module1_leads/junk.go` |
| W1-06 Qualified Lead Form (M0 §4.3) | ✅ | `module0_sales/qualified.go` + `commission.go`; migrasi 0041–0042; contoh Alpha Digital `Rp. 21.900.000,00` direproduksi di test; version-pinning MSL + recompute test |
| W1-07…W1-18 | ⬜ | belum mulai (lihat "Langkah berikutnya") |

### Kontrak antar-tiket yang SUDAH disiapkan (jangan bangun ulang)
- **W1-09 (Closing) wajib memanggil** `leads.Service.ResolveWin(ctx, tx, resolver, leadID, winningProspectID, winnerEmployeeID, now)` DI DALAM transaksi closing yang sama, SETELAH attempt pemenang bertransisi `Closed-Success`. `resolver` = `*sales.Attempts` (structural match, tanpa import silang).
- **W1-07/08 (Negosiasi) membaca baseline** dari `sales.GetQualifiedForm` (jasa terpilih + harga/komisi versi ter-pin) dan **re-evaluasi komisi** dengan `sales.EvaluateCommissionRule` yang sama terhadap harga proposal. Transisi negosiasi sudah ter-encode di mesin §1 (Pending Approval/Approved/Revision/Rejected, role `lead_spv` untuk keputusan superior).
- **Uang:** selalu sen IDR integer (`ParseDecimalCents`/`CentsToDecimal`) atau literal DECIMAL(18,2); render `FormatIDR` (`Rp. X.XXX.XXX,00`, Dash `—` bila pending). Jangan float.
- Rule komisi seed masih `pending_master_list` ⇒ komisi NULL + flag pending — TIDAK pernah dihitung/ditebak (Build Plan R3).

### Keputusan & pertanyaan terbuka baru
- **DECISIONS.md 2026-07-11**: baris dev-level W1-03/04/06 (klaim ganda staf sama ditolak; re-claim = reopen; ResolveWin dalam-tx; format simpan `[Lainnya ...] <teks>`; submit form = transisi satu transaksi; grammar rule komisi v1).
- **O20 (baru):** backlog W1-03 menyebut "+ notification" tapi katalog O15 tak punya slug `m1.*` untuk Kalah Kompetisi — berjalan tanpa publish, menunggu keputusan Yohan.
- **O18 (masih open, kena W1-08):** edge "accept revision" di mesin = `lead_spv`-only vs prosa M0 §5 (salesperson yang accept). Encoding berjalan ikut mesin.

### Langkah berikutnya (urutan fase orkestrasi)
1. **Fase 3 — W1-07+08 Negosiasi** (M0 §5): tabel negosiasi versioned (proposal per jasa: harga/komisi/termin + notes), non-nego validasi standard-terms → `Auto Approved`, approval superior (Approve/Counter wajib notes/Reject), sinkron nilai saat accept counter. Rentang migrasi M0 = 0040–0049 (0043+ bebas).
2. **Fase 4 — W1-09 Closing**: alokasi Σ=100%, ≤5 sales, Commission & Payment PIC, generate `CLI-`/`TRX-`/`SVC-` atomik (`ids.Generator` dalam satu tx), panggil `ResolveWin`, tulis Payment Intent → antrian M5.
3. **Fase 5 — M4** (W1-10…13), **Fase 6 — M5** (W1-14…18), **Fase 7 — QC + seed end-to-end + retarget PR**.
4. Setiap fase: baca PRD modul penuh + `DATA_MODEL.md` + `STATE_MACHINES.md`; DoD per CLAUDE.md (BI byte-exact, permission per role, immutability, recompute-from-log, fixture Alpha Digital).

## 2026-07-10 — Sprint 0 (Foundation) implemented

**Branch:** `claude/platform-dev-continue-c3vtde` · **Base:** `main` (docs-only)

### Ticket status (docs/backlog/SPRINT0 BACKLOG.md)

| Ticket | Status | Where |
|---|---|---|
| S0-01 Repo & scaffolding | ✅ | monorepo: `backend/` (Go), `web-internal/` + `web-client-portal/` (shells), `.github/workflows/ci.yml` (vet+test dengan MySQL service), `Makefile` |
| S0-02 DB & migration tooling | ✅ | golang-migrate (`cmd/migrate`), `backend/migrations/` — up/down/re-up terverifikasi penuh; numbering range per area di `docs/DEV_ENVIRONMENT.md` |
| S0-03 ID generator | ✅ | `internal/core/ids` — `PREFIX-YYYYMM-NNNN`, atomic `LAST_INSERT_ID(seq+1)` row-lock; paralel tanpa gap/duplikat; rollback tidak mengonsumsi nomor |
| S0-04 Audit log engine | ✅ | `internal/core/audit` — append-only; UPDATE/DELETE diblok trigger `SIGNAL 45000` di storage layer; actor wajib |
| S0-05 Status-machine engine | ✅ | `internal/core/statemachine` — 10 mesin / 76 transisi dari `STATE_MACHINES.md`, byte-exact BI messages, role-gated `[Blocked]`, flag paralel; 469 kasus test |
| S0-06 HRIS employee sync | ✅ | `internal/core/hris` — `EmployeeSource` CSV + HTTP (kontrak §1), sync idempoten, deaktivasi revoke session, missing-from-full-sync flag, alert 2 kegagalan beruntun |
| S0-07 HRIS auth | ✅ | `internal/core/auth` — delegasi verify ke HRIS (fail-closed `[sistem HRIS tidak dapat dihubungi…]`), session token hash-only, middleware Bearer; tanpa password store |
| S0-08 Role mapping + permission | ✅ | `internal/core/authz` — matrix Phase 0 §4, layered OD/Director, mapping efektif tanpa redeploy, admin Director-only + audited |
| S0-09 Master Service List | ✅ | `internal/core/msl` — versioned full-snapshot, write Sales Head/SPV+Director saja, `EffectiveAt` lookup versi-pada-tanggal (money-critical, boundary-tested) |
| S0-10 Notification center | ✅ | `internal/core/notify` — 14 entri katalog §9 (resolver placeholder "not yet wired", lihat O15), inbox/unread/mark-read; no-delete ditegakkan trigger |
| S0-11 Seed & fixtures | ✅ | `internal/seed` + `cmd/seed` (`make seed`, idempoten) — roster OA-14 (Budi/Sinta/Rian/Kenny/Putri dst. via CSV sync), mapping+override, 3 jasa Alpha Digital (M0 §4.3); smoke test = gladi resik S0-12 |
| S0-12 Sprint 0 exit review | ⬜ | **Manusia:** demo di staging + go/no-go Wave 1 dicatat di DECISIONS.md. Rehearsal otomatisnya sudah jalan di CI (`internal/seed` TestSprint0Smoke) |

### Cara menjalankan
Lihat `docs/DEV_ENVIRONMENT.md`. Ringkas: MySQL/MariaDB lokal → `make migrate-up` → `make seed` → `make test`. Test DB-bound membuat database terisolasi per run dan skip bila DB tak tersedia.

### Code review Sprint 0 (2026-07-10, high-effort, 8 finder + verify)
22 kandidat → 12 dilaporkan. **Diperbaiki di commit review-fix:**
- **Auto-edge enforcement** (statemachine): edge `Auto` (Void cascade, intake-collision, Jatuh Tempo, Kalah Kompetisi) kini hanya boleh oleh aktor `"system"` — sebelumnya staff mana pun bisa memicunya.
- **Event override** per edge state-machine agar slug katalog notifikasi (m0/m9/m10) benar-benar terpicu — sebelumnya nama event generik tak pernah match katalog.
- **Notifikasi transaksional**: `Engine.InTx` + buffer pending-event → publish HANYA setelah commit; rollback membuang event (tidak ada notifikasi phantom).
- **notify `Catalog.Replace`**: modul Wave-1 bisa mengganti resolver placeholder `notYetWired` tanpa membangun ulang katalog.
- **ID bulan = WIB** (O10): `ids.PeriodZone` UTC+7 sebelum format `YYYYMM`.
- **db.WithParams**: perbaiki bug `&parseTime` di cmd/seed (DSN tanpa `?` merusak nama DB) + multiStatements di cmd/migrate.
- **hris flagMissing** kini revoke session karyawan yang hilang dari full-sync; **sync ditulis ke audit log** (opsional `Syncer.Audit`, di-wire di seed).
- **msl read** mengembalikan `authz.DeniedError`, bukan pesan validasi field.
- **authz HTTP middleware** (S0-08 AC) + **testdb down-migration test** (CI kini menguji `.down.sql`) + `HTTPSource.MaxPages` diexport.
- **Cleanup ditunda** (dicatat, non-blocking): shared `audittest` fake (3 fake audit.Logger drift), batch upsert syncer & batch insert notify (N+1 di skala 100+), helper audit-append bersama, dimensi Field/Stage di `authz.Request` untuk lock-matrix W1-11 (aditif, kerjakan saat M4), `msl.Store` pakai `*sql.DB` bukan `db.Queryer` (perlu Queryer untuk closing atomik W1-09), `Resolver` interface single-impl, loop parse CSV.

### Keputusan & pertanyaan terbuka
- **Decided baru (2026-07-10, Yohan):** O1 (`SVC-YYYYMM-NNNN`), O10 (ID bulan WIB), O11 (`Closed-Lost` hanya dari `Negotiation - Rejected`), O15 (14 slug event notifikasi kanonik). Lihat `docs/DECISIONS.md`.
- **Masih Open** menandai wave berikut: **O12** (source-set Kalah Kompetisi — Wave 1 W1-03), **O16** (recipient event ops HRIS — S0-12), **O17** (`audit.Entry.At` wajib?), O13/O14 (Wave 2 M6/M9).
- Commission rule di seed MSL = placeholder `{"type":"pending_master_list"}` — menunggu daftar tervalidasi Sales Head (Build Plan R3). Wave 1 W1-06 TIDAK boleh menghitung komisi dari placeholder ini.

### Langkah berikutnya (jalur 1/A)
1. **S0-12** exit review (manusia) + go/no-go Wave 1.
2. Selesaikan **O10–O17** yang menandai Wave 1.
3. Mulai **Wave 1** per `docs/backlog/WAVE1 BACKLOG.md`: epics M1 (W1-01…04) dan M0 (W1-05…09) bisa paralel; M4 menunggu closing M0; M5 menunggu handoff M4. Semua create-flow memakai `ids.Generator` + `statemachine.Engine` + `audit.Logger` yang sudah ada — jangan tulis jalur status/ID sendiri.
4. Eksternal (blocker nyata): 2 endpoint HRIS (kontrak `docs/HRIS API CONTRACT.md` perlu sign-off maintainer), daftar Master Service List dari Sales Head.
