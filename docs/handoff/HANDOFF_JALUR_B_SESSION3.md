# Handoff — Sesi 3 Jalur B (setelah jawaban OD 2026-07-11)

> Lanjutan dari `HANDOFF_JALUR_B_SESSION2.md`. Sesi ini memproses jawaban manusia
> yang sudah masuk (validasi role mapping, penyederhanaan sales-map, sumber MSL),
> dan membangun tooling yang tersirat dari keputusan itu. Baca dokumen ini +
> Session 2 sebelum lanjut.

## Status saat handoff (2026-07-11)

**Branch:** `jalur-b-session2` (lokal, dari `claude/jalur-b-completion-72zpda`) — 4 commit baru:

| Commit | Isi |
|---|---|
| `bff7364` | docs: jawaban OD diterapkan (role mapping, sales-map, sumber MSL) |
| `b4c35ea` | docs+data: rekonsiliasi pricelist → 180 layanan MSL (prefill 4 harga) |
| `daf2d49` | feat(importer): resolusi sales by nama lengkap + laporan unresolved |
| `5ded9f0` | feat(hris): `--exclude-dept` + CLI `seedroles` dari policy tervalidasi |

**Verifikasi (Go 1.24.7 diunduh ke scratchpad — TIDAK ada Go/MySQL pra-instal di lingkungan ini):**
- `go build ./...` ✅  `go vet ./...` ✅
- `go test ./...` ✅ semua `ok`; test DB-backed **skip** otomatis tanpa MySQL lokal (pola `testutil.DB` existing)
- **BELUM diverifikasi:** jalur tulis DB nyata (`seedroles --apply`, `LoadEmployeeNameIndex` dari DB, replay import). Perlu run sekali di lingkungan ber-MySQL sebelum go-live:
  ```
  cd backend && CDPS_TEST_DSN=<dsn> go test ./cmd/seedroles/... ./internal/importer/... -count=1
  ```

## Jawaban manusia yang sudah diproses (dari Nerissa/OD, 2026-07-11)

1. **Role mapping 6 [KONFIRMASI]** → semua terjawab, diterapkan ke `HRIS_ROLE_MAPPING_DRAFT.md` §0 + `configs/role_mapping_dept.csv`:
   - CREATIVE - EKSTERNAL → **exclude** (vendor tanpa akun)
   - ADVERTISER → **Ads** · AFFILIATE → **KOL** · GROWTH & BUSINESS CONSULTATION → **Account**
   - MCN → **exclude** (sister company)
   - BUSINESS DEVELOPMENT → **no-access** (di luar modul; 1 orang marketing pembuat leads = kandidat M2 nanti, per-orang)
2. **Sales-map** → tidak ada sistem nickname; semua sales pakai nama lengkap (kecuali "Cena" = Sales Head). Importer sekarang resolusi otomatis by nama.
3. **Sumber MSL** → pricelist resmi (Google Sheets) = basis `standard_price`; harga deal ledger = nego per-klien.

## Tooling baru — cara pakai

### 1. hrisconvert dengan exclusion
```bash
hrisconvert hris_karyawan.csv --emails nik_email.csv \
  --exclude-dept "MCN,CREATIVE - EKSTERNAL" -o employees.csv
# Baris MCN & Creative-Eksternal TIDAK masuk employees.csv; jumlahnya
# dilaporkan per-dept di stderr (bukan drop diam-diam).
# --pairs sengaja TETAP melihat semua baris (alat discovery exclude list).
```

### 2. seedroles — seed role_mappings dari policy tervalidasi
```bash
# Dry-run dulu (default): cetak rencana lengkap, tidak menulis apa pun
seedroles --employees employees.csv --actor <DIRECTOR_NIK>
# (--policy default = configs/role_mapping_dept.csv)

# Apply (satu-satunya gate tulis):
seedroles --employees employees.csv --actor <DIRECTOR_NIK> --apply

# + assignment layered OD/Director (per-orang, file employee_id,role):
seedroles --employees employees.csv --actor <DIRECTOR_NIK> \
  --layered layered_roles.csv --apply
```
- Departemen yang TIDAK ada di `configs/role_mapping_dept.csv` = **hard-error** (tidak menebak). Kalau HRIS memunculkan departemen baru, tambahkan barisnya ke policy CSV dulu.
- `role_mappings` di-key pada `(divisi DEPARTMENT mentah, jabatan)` → cocok dengan `auth.ResolveActor`. Level via heuristik `HEAD OF/SPV/SUPERVISOR/LEADER/LEAD` — **masih perlu review per-jabatan manual** begitu daftar jabatan riil (`hrisconvert --pairs`) tersedia.

### 3. import leads — resolusi sales otomatis
```bash
# sales_map.csv kini MINIMAL (hanya pengecualian), contoh:
#   nama_sheet,employee_id
#   Cena,<NIK Sales Head>
import leads-dryrun --actor <DIRECTOR_NIK> --file daily_leads.csv --sales-map sales_map.csv
# Laporan dry-run menampilkan DAFTAR nama tak ter-resolusi (+penanda [AMBIGU]) —
# lengkapi sales_map.csv untuk nama-nama itu bila perlu, lalu ulang.
```

### 4. MSL — pricelist sudah di-prefill sebagian
- `MSL_DRAFT_KOMPILASI.csv`: 4 layanan confidence-tinggi sudah terisi `usulan_standard_price`; 1 (Store Management) terisi `usulan_commission_rule` = `5% of standard price`.
- `MSL_PRICELIST_REKONSILIASI.md`: worksheet review Sales Head (per-layanan, confidence, rumus turunan, anomali). **Mayoritas 159/180 layanan tidak dicakup pricelist** (paket ads bertingkat: GMV Max, Meta CPAS, Traffic Marketplace) — ini gap cakupan pricelist, bukan kegagalan matching; Sales Head tetap mengisi harga untuk baris itu.

## Yang MASIH ditunggu dari manusia

| Item | Dari | Blokir |
|---|---|---|
| NIK→email karyawan (`nik_email.csv`) | HR | Login CDPS (O21) |
| Form pelengkap 239 klien (terisi) | CRO + Finance | Import klien aktif |
| NIK Sales Head untuk baris `Cena` di sales_map | Sales Head | Atribusi lead Sales Head |
| Sheet HRIS asli (untuk `hrisconvert`) | HR | Sync karyawan |
| Keputusan TIKTOK GO & DATA & BI (kini default no-access) | OD | Tidak (default aman) |
| Daftar employee_id OD & Director (`layered_roles.csv`) | OD | Akses layered |
| Review harga MSL 159 baris + validasi 4 prefill | Sales Head | Kalkulasi komisi |
| Identitas 1 orang BD (marketing pembuat leads) | OD | Akses M2 (Wave 3) |

## Catatan untuk sesi berikutnya

- Toolchain Go tidak pra-instal di lingkungan build ini; sesi ini mengunduh Go 1.24.7 ke `scratchpad/goinstall`. Lingkungan CI (`.github/workflows/ci.yml`) tetap sumber kebenaran verifikasi.
- Urutan go-live tidak berubah dari Session 2 §A/§B/§C, dengan tambahan: jalankan `hrisconvert --exclude-dept` → `seedroles --apply` sebelum import klien (agar PIC/alokasi bisa diresolusi ke karyawan yang sudah tersinkron).
- Branch siap PR: scope Session 2 (M4+M5+import+HRIS tooling) + Session 3 (resolusi sales + seedroles + MSL pricelist). Belum di-push (auth gagal di lingkungan ini — `git push` perlu kredensial user).
