# Handoff — Sesi Lanjutan Jalur B (setelah data manusia masuk)

> Dokumen ini berisi semua konteks yang dibutuhkan sesi build berikutnya untuk
> melanjutkan pekerjaan Jalur B. Baca dokumen ini sebelum mulai.

## Status saat handoff (2026-07-10)

**Branch:** `claude/jalur-b-completion-72zpda` — 12 commit, semua CI hijau.

**Apa yang sudah selesai (kode):**
- W1-10 sampai W1-18: Module 4 (Client Record) + Module 5 (Admin & Finance) — lengkap + QC
- W1-19: import engine + parsers + CLI + dormant path + migrasi 0013
- HRIS converter (`cmd/hrisconvert`) + draft role mapping
- MSL draft compilation (180 layanan dari 1.517 deal)
- Source mapping analysis + keputusan O22/O23 resolved

**Apa yang menunggu input manusia:**
- 5 file/jawaban (lihat `docs/handoff/LANGKAH_MANUSIA_GO_LIVE.md`)

**Test status:**
- 18 paket backend hijau, `go vet` bersih, `go build ./...` bersih
- Frontend build+lint hijau
- Migrasi 0001-0013 up→down→up reversible (MariaDB)

## Pekerjaan sesi berikutnya

### A. Begitu data manusia masuk — jalankan import

Urutan eksekusi (WAJIB dry-run dulu, baru apply):

```bash
# 0. Pastikan DB sudah migrasi
migrate up

# 1. LEADS — butuh: daily_leads.csv + sales_map.csv + --actor NIK Director
import leads-dryrun  --actor <DIRECTOR_NIK> --file daily_leads.csv --sales-map sales_map.csv [--since 2026-01-10]
# Periksa output: "X lead lolos filter B" + "0 error" → lanjut apply
import leads-apply   --actor <DIRECTOR_NIK> --file daily_leads.csv --sales-map sales_map.csv [--since 2026-01-10]

# 2. CLIENTS AKTIF — butuh: form_pelengkap.csv (terisi)
import clients-dryrun --actor <DIRECTOR_NIK> --form form_pelengkap_terisi.csv
# Periksa: "X aktif, Y dormant (konfirmasi N), Z bermasalah"
import clients-apply  --actor <DIRECTOR_NIK> --form form_pelengkap_terisi.csv

# 3. DORMANT — butuh: db_jasa.csv (export spreadsheet, sudah ada)
import dormant-dryrun --actor <DIRECTOR_NIK> --db-jasa db_jasa.csv --run-date 2026-07-10
# Periksa: "1097 dormant" (mungkin bergeser sedikit jika run-date berbeda)
import dormant-apply  --actor <DIRECTOR_NIK> --db-jasa db_jasa.csv --run-date 2026-07-10
```

**Catatan operasional:**
- Dry-run menahan lock `id_sequences` selama batch — jalankan saat traffic rendah
- 1 baris error data riil ditemukan di smoke test: `link_toko` terlalu panjang untuk satu klien dormant — koreksi di CSV sumber (atau ALTER kolom jika sah)
- `--since` default = 6 bulan sebelum hari ini; override dengan tanggal pasti jika ingin cut-off beda
- `--run-date` = tanggal acuan klasifikasi aktif/dormant; default hari ini

### B. Sync karyawan + role mapping

```bash
# 1. Convert sheet HRIS → CSV EmployeeSource
hrisconvert hris_karyawan.csv --emails nik_email.csv -o employees.csv

# 2. (Opsional) cek pasangan departemen/jabatan riil
hrisconvert hris_karyawan.csv --pairs -o pairs.csv
# Bandingkan dengan draft docs/handoff/HRIS_ROLE_MAPPING_DRAFT.md

# 3. Seed role_mappings dari jawaban [KONFIRMASI] yang sudah divalidasi
# → Tulis script seed atau pakai admin.UpsertRoleMapping
# → Jangan timpa seed.go (itu contoh Alpha Digital)

# 4. Seed layered roles OD + Director
# → admin.SetLayeredRole per employee_id, pola directors di seed.go

# 5. Import CSV employees via HRIS sync fallback
# → internal/hris/sync.go sudah mendukung CSV source
```

### C. Seed MSL

Setelah `MSL_DRAFT_KOMPILASI.csv` divalidasi Sales Head (standard_price + commission_rule terisi):
- Input via admin MSL (`/master-services`) atau script seed khusus
- Set `effective_from` per entry
- Jangan lupa: deal historis mengunci versi harga pada tanggal closing masing-masing

### D. Bersihkan / lanjutkan

- **Merge/PR:** branch siap di-review. Scope = M4 + M5 + import pipeline + HRIS tooling + MSL draft. 12 commit.
- **Akun A handoff:** M1 dedup harus didesain ulang jadi KOLABORATIF (bukan exclusive). Detail keputusan ada di `DECISIONS.md` 2026-07-10 baris "M1 DEDUP DIREDESAIN". Import W1-19 sementara memakai `Decide` existing — begitu M1 v2 ada, importer mengikuti.

## Open items di DECISIONS.md

| ID | Topik | Status | Blocking? |
|---|---|---|---|
| O20 | UTC vs WIB bucketing (tanggal di audit/metrik) | Open | Tidak (konsisten intra-sistem cukup untuk v1, tapi putuskan sebelum reporting Wave 2) |
| O21 | Employee email sumber | Open → **menunggu HR menyerahkan NIK→email** | Ya — blokir login |
| Akun A | M1 dedup kolaboratif | Handoff ke stream A | Tidak untuk Jalur B |

## Peta file kunci

### Importer (W1-19)
- `backend/cmd/import/main.go` — CLI entry point, semua subcommand
- `backend/internal/importer/run.go` — engine orchestrator (DryRun/Apply/ApplyDormant)
- `backend/internal/importer/clients.go` — landing klien aktif (landClientTx)
- `backend/internal/importer/dormant.go` — landing klien dormant (landDormantTx)
- `backend/internal/importer/leads.go` — landing lead (matchByPhone mirror)
- `backend/internal/importer/validate.go` — pre-insert validation
- `backend/internal/importer/parse_leads.go` — Daily Leads parser (filter B)
- `backend/internal/importer/parse_clients.go` — db_jasa parser + form r/w (~820 baris)
- `backend/internal/importer/parse_common.go` — shared: parseIndoDate, parseLedgerMoney, cleanPhone, etc.
- `backend/internal/importer/parse_test.go` — pure + DB tests

### Module 4 + 5
- `backend/internal/module4_client/` — client CRUD, lock matrix, void service
- `backend/internal/module5_finance/` — verification, scheduling, bermasalah, reminders, routing gate
- `backend/internal/module5_finance/verification.go` — Verify/AttachContract + InTx exports

### HRIS tooling
- `backend/cmd/hrisconvert/main.go` — CLI converter
- `backend/internal/hris/convert.go` — format adapter logic

### Migrasi (rentang Akun B = 0010–0019)
- `0010` — clients lock matrix + briefs stub
- `0011` — payment_verifications (immutable event log)
- `0012` — fire-once reminder columns + transaction_issue_approvals
- `0013` — clients.dormant_at

### Handoff docs
- `docs/handoff/LANGKAH_MANUSIA_GO_LIVE.md` — instruksi lengkap untuk CRO/Finance/HR/Sales Head
- `docs/handoff/HRIS_ROLE_MAPPING_DRAFT.md` — 16 dept → CDPS division, 6 [KONFIRMASI]
- `docs/handoff/MSL_DRAFT_KOMPILASI.{csv,md}` — 180 layanan, worksheet validasi
- `docs/handoff/W1-19_SOURCE_MAPPING.md` — pemetaan sumber → kontrak import
- `docs/handoff/W1-20_UAT_RUNBOOK.md` — runbook UAT end-to-end
- `docs/handoff/WAVE1_PARALLEL_PLAN.md` — aturan main paralel Akun A/B
- `docs/handoff/WAVE1_EXTERNAL_REQUESTS.md` — log permintaan data eksternal

### Keputusan & konvensi
- `docs/DECISIONS.md` — 25+ baris keputusan, sumber kebenaran deviasi PRD
- `CLAUDE.md` — 8 konvensi non-negotiable (IDs, state machine, audit, etc.)

## Smoke test angka referensi (run-date 2026-07-10)

| Metrik | Nilai |
|---|---|
| Ledger total rows | 1.517 |
| Klien unik (by ID) | 1.336 |
| Kandidat aktif (form pelengkap) | 239 |
| Dormant | 1.097 (1.096 valid, 1 error link_toko) |
| Daily Leads total rows | 1.769 |
| Leads lolos filter B | 18 |
| Duplikat intra-batch | 0 |
| Leads error | 0 |

## Environment notes

- MariaDB perlu distart (`service mariadb start`) — tidak auto-start di container
- `CDPS_DSN` env var untuk koneksi DB
- Google Drive connector tersedia untuk baca spreadsheet langsung (jika butuh refresh data)
- Chromium pre-installed untuk Playwright (frontend E2E jika diperlukan)
