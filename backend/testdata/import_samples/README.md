# Drop-zone: export spreadsheet untuk Jalur B (W1-19 / HRIS / MSL)

Environment build remote tidak bisa membuka `docs.google.com` (network policy), jadi
cara tercepat membuka blocker: **export tiap sheet ke CSV (satu file per tab) atau XLSX,
commit ke folder ini**, lalu minta sesi Claude Code melanjutkan — parser W1-19, adapter
HRIS, dan kompilasi MSL langsung dikerjakan dari file di sini.

Link sumber + konteks lengkap: `docs/handoff/WAVE1_EXTERNAL_REQUESTS.md` §"Jawaban diterima (2026-07-10)".

## Penamaan file yang diharapkan (per tab)

| Sumber | File |
|---|---|
| Data karyawan HRIS (format asli) | `hris_karyawan.csv` (atau `hris_karyawan.xlsx`) |
| Dashboard team account | `msl_team_account__<nama-tab>.csv` |
| Database client | `msl_database_client__<nama-tab>.csv` |
| Dashboard sales — tab dashboard iklan | `w119_dashboard_sales__iklan.csv` |
| Dashboard sales — tab dashboard organik | `w119_dashboard_sales__organik.csv` |
| Daily lead (quality lead) | `w119_daily_lead.csv` |
| Prospek dan closing | `w119_prospek_closing.csv` |
| Rekapan harian sales (seller/affiliate/ga respon/bad respon) | `w119_rekapan_harian.csv` |

Catatan:
- Export **apa adanya** — header asli, data kotor/tidak lengkap justru dibutuhkan
  (dry-run report W1-19 dirancang dari realita, lihat Permintaan #3).
- Kalau satu spreadsheet punya banyak tab dan ragu tab mana yang relevan, export semua tab.
- Data ini berisi PII (nama, telepon) — folder ini untuk kebutuhan migrasi go-live;
  jangan dipakai sebagai fixture test permanen tanpa anonimisasi.
