# Handoff — Sesi Lanjutan Jalur B #3 (pasca data HRIS riil masuk)

> Baca `HANDOFF_JALUR_B_SESSION2.md` dulu untuk konteks penuh Jalur B.
> Dokumen ini mencatat apa yang terjadi di sesi 2026-07-11 dan apa yang tersisa.

## Catatan rekonstruksi

Sesi sebelumnya (2026-07-10 malam, environment lokal) sempat menyelesaikan QC + verifikasi
`go build/vet/test` tetapi **commit lokalnya (branch `jalur-b-session2`) tidak pernah
ter-push** — environment tersebut tidak punya kredensial GitHub dan sesinya berakhir karena
limit. Sesi ini (environment remote dengan akses GitHub) melanjutkan dari titik push terakhir
(`claude/jalur-b-completion-72zpda`, 12 commit) dan **mengulang bagian yang hilang yang masih
relevan**: menjalankan pipeline role-mapping terhadap data HRIS produksi. Pekerjaan sesi ini
di-push ke branch `claude/fable-orchestrator-workflow-6iz7fl`.

## Yang dikerjakan sesi ini (2026-07-11)

1. **Pipeline role-mapping dijalankan atas data produksi** (dry-run, tanpa DB) —
   sheet HRIS lengkap 186 karyawan **dengan kolom EMAIL** diterima via Google Sheet
   "Data Karyawan" (ID `1rLCbdGk7zZ6TaK2-3f2DO4PwhS4TIxh7Nz8uHmq8_g8`), dibaca langsung
   lewat konektor Google Drive:
   - `hrisconvert --emails` → **gate LOLOS**: 186/186 baris emit, 0 NIK duplikat,
     0 email kosong, 1 warning (NIK 9 digit `260210626`).
   - `hrisconvert --pairs` → **123 pasangan DEPARTMENT|JABATAN** unik; agregat
     di-commit ke `docs/handoff/DEPARTMENT_JABATAN_PAIRS.csv` (bebas PII).
   - File turunan ber-PII (`employees.csv`, `nik_email.csv`, sheet mentah — memuat
     email pribadi + NIK KTP) **sengaja TIDAK di-commit**; regenerasi kapan pun via
     `hrisconvert` dari sheet sumber.
2. **Validasi draft role-mapping vs data riil** → addendum §0 di
   `HRIS_ROLE_MAPPING_DRAFT.md`. Ringkas: ADVERTISER→Ads dan MCN→KOL terkonfirmasi;
   BD→Sales **terbantah**; TikTok Go ternyata 21 orang; **tabrakan istilah OD**
   (dept OD = Organization Development/HR, bukan kandidat layered OD). Tiga open item
   baru: **O24, O25, O26** di `docs/DECISIONS.md`.
3. **O21 RESOLVED** (email login) — dicatat di `DECISIONS.md`; §4
   `LANGKAH_MANUSIA_GO_LIVE.md` ditandai selesai (sisa: 1 email `#N/A`).
4. **Bug fix `cmd/hrisconvert`**: flag (`--emails`, `-o`) yang ditulis *setelah* path
   input sebelumnya diabaikan diam-diam oleh parser flag Go (persis pola pemanggilan
   yang didokumentasikan §5 draft — menghasilkan 186 email kosong dengan exit 0).
   Kini flag pasca-positional tetap diparse; argumen positional ekstra ditolak.
   Regression test ditambahkan (`main_test.go`).
5. QC penuh: `go build ./...`, `go vet ./...`, `go test ./...` — 18 paket hijau.

## Temuan data untuk ditindaklanjuti HR (sumber: sheet "Data Karyawan")

| # | Temuan | Baris sheet | Tindakan |
|---|---|---|---|
| 1 | Email `#N/A` — TINA JULYANA, NIK 2309010304 | 31 | HR isi email resmi; sampai itu, ybs tidak bisa login |
| 2 | NIK 9 digit `260210626` — DELLIQ HASTARIQ ATFHAL | 132 | Verifikasi NIK benar (10 digit) |
| 3 | NIK KTP notasi ilmiah (`3,27E+15`) — NIK 2404160366, 2601270617, 2509230573 | 40, 128, 129 | Format ulang kolom sebagai teks di sheet |
| 4 | NIK KTP kosong (TINA JULYANA) & 17 digit (NIK 2510020578) | 31, 107 | Lengkapi/koreksi (informasional — tidak dipakai CDPS) |
| 5 | 12 email seluruhnya huruf besar | — | Kemungkinan kosmetik, tapi verifikasi login didelegasikan ke endpoint auth HRIS (`HRISAuthenticator.Verify`) — pastikan sistem HRIS tidak case-sensitive, atau normalisasi ke huruf kecil di sheet sumber supaya aman |

## Menunggu manusia (blocking go-live berikutnya)

Semua dari `LANGKAH_MANUSIA_GO_LIVE.md`, status per 2026-07-11:

| Item | Pemilik | Status |
|---|---|---|
| §4 NIK→email | HR | **✅ selesai** (sisa 1 `#N/A`, lihat atas) |
| §5 Validasi role mapping — kini konkret: jawab **O24/O25/O26** | OD/Nerissa | ⏳ diperbarui dgn data riil, tinggal jawaban |
| §2 Sales-map nama panggilan→NIK (Cena, Esal, …) | Sales Head + HR | ⏳ belum |
| §1 Form pelengkap 239 klien aktif | CRO + Finance | ⏳ belum |
| §3 Validasi MSL (180 layanan: standard_price + commission_rule) | Sales Head | ⏳ belum |
| NIK Director untuk `--actor` import | Nerissa | ⏳ belum |

## Sesi berikutnya

1. Begitu jawaban O24–O26 masuk: tulis seed script `role_mappings` + layered roles
   (pola `admin.UpsertRoleMapping` / `admin.SetLayeredRole`, JANGAN timpa `seed.go`),
   lalu sync karyawan via CSV fallback (`internal/hris/sync.go`).
2. Begitu form pelengkap + sales-map masuk: jalankan urutan import §A
   `HANDOFF_JALUR_B_SESSION2.md` (leads → clients → dormant; dry-run dulu).
   **Catatan CLI:** sejak fix sesi ini urutan flag bebas, tapi konvensi aman tetap
   flag sebelum path: `hrisconvert --emails nik_email.csv -o out.csv sheet.csv`.
3. MSL seed setelah validasi Sales Head.
