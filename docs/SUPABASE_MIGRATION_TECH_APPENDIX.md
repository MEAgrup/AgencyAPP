# LAMPIRAN TEKNIS — Migrasi CDPS: Go+MySQL(Railway) → Supabase Postgres + TypeScript/Next.js (Vercel)

**Dokumen induk:** `SUPABASE_MIGRATION_PLAN.md` · **Inventaris as-built:** `SUPABASE_MIGRATION_INVENTORY.md`
**Status:** Draf teknis pendukung keputusan migrasi. **Keputusan final (interview pemilik):** strategi **hybrid/strangler** — sistem Go+MySQL existing **di-freeze** (tidak diubah lagi) sampai cutover; skema di-port ke Supabase Postgres; backend baru ditulis di Next.js API routes di Vercel; autentikasi pindah ke Supabase Auth; Row Level Security (RLS) dipakai sebagai lapisan isolasi data; data operasional saat ini diasumsikan masih UAT/seed (fixture Alpha Digital + importer), dengan jalur cadangan pgloader bila ternyata sudah ada data produksi riil.

Sumber: 37 file migrasi `backend/migrations/*.up.sql` (49 tabel, tidak ada `ENUM`, tidak ada backtick-quoting riil pada identifier — hanya di komentar), `backend/internal/auth/`, `backend/internal/core/{ident,statemachine,audit,permission,money,notification,tz}`, `backend/internal/importer/`, `docs/HRIS_API_CONTRACT.md`, `docs/DECISIONS.md`, `docs/M15C2_CLIENT_PORTAL_SECURITY_SPEC.md`, `CLAUDE.md`.

---

## A. Konversi skema MySQL → Postgres

### A.1 Inventarisasi konstruksi MySQL riil yang dipakai (bukan tebakan)

Hasil scan `grep`/`awk` atas seluruh 37 file `*.up.sql`:

| Konstruksi MySQL | Ditemukan di | Jumlah |
|---|---|---|
| `ENUM(...)` | **Tidak ditemukan sama sekali** — semua status disimpan `VARCHAR`, divalidasi di `statemachine` engine (bukan constraint DB) | 0 |
| `AUTO_INCREMENT` (PK `BIGINT`) | `audit_log`, `role_mappings`, `employee_layered_roles`, `master_service_versions`, `notifications`, `prospect_attempt_nq_reasons`, `negotiation_proposal_lines`, `client_platforms`, `client_sales_allocations`, `qualified_form_services`, `payment_verifications`, `transaction_issue_approvals`, `ad_campaign_assets` | 13 tabel |
| `TINYINT(1)` (boolean) | 10 file — `employees.status_aktif/flagged_for_review`, `clients.roas_health_included_override`, `installments.jatuh_tempo`, `transactions.bermasalah`, `client_health_snapshots.roas_toggle_state`, `perf_period_targets.is_placeholder`, dll | ~18 kolom |
| `DATETIME ... ON UPDATE CURRENT_TIMESTAMP` | `employee_credentials.updated_at`, `perf_kpi_weights.updated_at`, `perf_period_targets.updated_at`, `ad_campaigns.updated_at`, plus tabel di 0021/0022/0023/0025/0027/0028/0030/0033 | 11 file |
| `JSON` | `audit_log.before_json/after_json`, `client_health_snapshots.components_json`, `performance_snapshots.components_json` (kolom `TEXT` berkomentar "JSON snapshot" di `ad_campaigns.included_bookings` — **bukan** tipe JSON asli, tetap `TEXT`) | 3 tabel bertipe JSON asli |
| `CREATE TRIGGER ... SIGNAL SQLSTATE '45000'` (immutability guard) | `audit_log` (0001), `notifications` (0001), `client_health_snapshots` (0035), `performance_snapshots` (0036) | 4 pasang trigger (no-update + no-delete) |
| `ENGINE=InnoDB DEFAULT CHARSET=utf8mb4` | Setiap `CREATE TABLE` (49×) | seragam, tidak ada varian collation lain |
| Backtick `` ` `` sebagai quote identifier | **Tidak ada** — semua backtick yang muncul di file (0010/0021/0022/0023/0024/0029/0037) ada di **komentar SQL**, bukan identifier ter-quote | 0 riil |
| `FULLTEXT` / `SPATIAL` index | Tidak ditemukan | 0 |
| Computed/`GENERATED` column | Tidak ditemukan — semua field turunan (ROAS, Speed Score, Health Score) dihitung di kode Go, bukan generated column SQL | 0 |
| `DECIMAL(15,2)` / `DECIMAL(20,2)` / `DECIMAL(6,3)` / `DECIMAL(20,4)` | Uang & skor — `services.standard_price`, `transactions.total_agreed_value`, `installments.amount`, `ad_campaigns.budget` (20,2), `client_health_snapshots.final_health_score` (6,3), `perf_period_targets.target_value` (20,4) | luas, presisi bervariasi per konteks |

Karena **tidak ada `ENUM` riil**, bagian yang biasanya paling rawan dalam migrasi MySQL→Postgres (`ENUM` → tipe domain) **tidak relevan** di sini — statusnya sudah bebas-string dan validasinya sudah hidup di luar DB (state-machine engine), jadi portingnya justru lurus: kolom `VARCHAR` tetap `text`/`varchar`, TANPA `CHECK` daftar-nilai baru dipaksakan (menghormati "jangan menambah aturan yang tidak ada di kode/PRD" — CLAUDE.md "never invent fields/statuses").

**Rekomendasi tambahan (opsional, bukan wajib):** untuk kolom `band`, `role_type`, `platform`, dsb yang nilainya sudah difinalisasi di PRD (mis. `'Healthy'|'Watch'|'At Risk'`), boleh ditambah `CHECK (band IN (...))` di Postgres sebagai defense-in-depth — TAPI ini keputusan tambahan yang harus dicatat sebagai entri `docs/DECISIONS.md` baru sebelum dieksekusi, karena constraint DB baru bisa mem-block importer/pgloader kalau ada data legacy dengan casing/nilai yang meleset.

### A.2 Tabel pemetaan tipe

| MySQL | Postgres | Catatan |
|---|---|---|
| `VARCHAR(n)` | `varchar(n)` | identik |
| `TEXT` | `text` | identik |
| `TINYINT(1)` | `boolean` | migrasi nilai `0/1` → `false/true` otomatis oleh sebagian besar tool (pgloader melakukan ini native); untuk hand-port, cast eksplisit `CASE WHEN col=1 THEN true ELSE false END` |
| `INT` / `BIGINT` | `integer` / `bigint` | identik |
| `BIGINT ... AUTO_INCREMENT PRIMARY KEY` | `bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY` | pola Postgres modern (bukan `SERIAL`, yang legacy); `GENERATED ALWAYS` menolak insert manual nilai PK kecuali `OVERRIDING SYSTEM VALUE` — penting saat pgloader/import replay butuh set nilai historis, lihat §F |
| `DECIMAL(p,s)` | `numeric(p,s)` | identik, tidak ada kehilangan presisi |
| `DATE` | `date` | identik |
| `DATETIME` | `timestamp` (tanpa timezone) | **keputusan penting** — lihat §A.3 |
| `DATETIME(3)` | `timestamp(3)` | presisi milidetik dipertahankan (dipakai `audit_log.created_at`, `notifications.created_at`) |
| `... DEFAULT CURRENT_TIMESTAMP` | `... DEFAULT now()` atau `DEFAULT clock_timestamp()` | `now()` = waktu awal transaksi (cukup untuk semua kasus di sini karena tiap insert satu baris per statement) |
| `... ON UPDATE CURRENT_TIMESTAMP` | Tidak ada native equivalent → **trigger `BEFORE UPDATE`** per tabel yang set `NEW.updated_at = now()` | lihat daftar 11 file di §A.1; buat satu fungsi trigger reusable `set_updated_at()` dipasang ke tiap tabel yang butuh, bukan diduplikasi per tabel |
| `JSON` | `jsonb` | **rekomendasi `jsonb` bukan `json`** — mendukung index GIN, operator `->`/`@>`, dan lebih hemat storage; tidak ada kebutuhan preservasi urutan key/whitespace di `components_json`/`before_json`/`after_json` |
| `CREATE TRIGGER ... SIGNAL SQLSTATE '45000'` | Fungsi trigger Postgres `RAISE EXCEPTION` + `BEFORE UPDATE/DELETE` | lihat §B.3 (audit) — pola sama persis, sintaks beda |
| Backtick identifier quoting | Double quote `"..."` | tidak dipakai di migrasi asli (§A.1), jadi tidak ada migrasi identifier yang perlu dilakukan; tetap dokumentasikan untuk kode aplikasi baru yang mungkin memakai nama reserved (`status`, `read` dsb — belum ada di skema ini) |
| `ENGINE=InnoDB DEFAULT CHARSET=utf8mb4` | Dihapus — Postgres tidak punya storage engine pilihan; encoding project Supabase default `UTF8` | tidak perlu port apa pun, cukup drop klausanya |
| `FOREIGN KEY ... REFERENCES` (tanpa `ON DELETE CASCADE` — house rule "no ON DELETE CASCADE for audited entities") | `FOREIGN KEY ... REFERENCES` polos, tanpa `ON DELETE` clause (default `NO ACTION`) | konvensi house dipertahankan; jangan tambah `ON DELETE CASCADE` saat porting |
| `UNIQUE KEY name (cols)` / `KEY name (cols)` | `UNIQUE (cols)` / `CREATE INDEX name ON tbl(cols)` | index biasa (`KEY` non-unique) jadi statement `CREATE INDEX` terpisah setelah `CREATE TABLE`, bukan inline |

### A.3 `DATETIME` vs `TIMESTAMPTZ` — keputusan yang wajib eksplisit

Ini titik konversi paling berisiko salah tanpa disadari, karena rumah sudah punya keputusan zona waktu eksplisit (DECISIONS **O20**, 2026-07-17/19): bucketing kalender pakai **WIB (Asia/Jakarta, UTC+7 fixed, tanpa DST)** via `time.FixedZone`, sedangkan timestamp absolut (audit `created_at`, sesi `expires_at`, dll) disimpan **tanpa** konversi zona (MySQL `DATETIME` polos, naive, diperlakukan sebagai "jam server").

Rekomendasi porting:
- Semua kolom `DATETIME`/`DATETIME(3)` di 49 tabel → **`timestamptz`** (bukan `timestamp` naif) di Postgres, dan **koneksi/session selalu di-set `TIMEZONE=UTC`** di level Supabase (default project) — ini menjadikan semantik "instant absolut" eksplisit dan aman lintas region, alih-alih bergantung pada jam server seperti MySQL `NOW()` lakukan implisit.
- Derivasi kalender WIB (`tz.Period`, `tz.Date`, `tz.DaysBetween`, `tz.DateString`) **tetap murni logika aplikasi/fungsi SQL** — TIDAK diserahkan ke `timestamptz AT TIME ZONE` runtime Postgres kecuali dengan fixed-offset eksplisit (`AT TIME ZONE 'UTC+7'` interval-based atau literal `INTERVAL '7 hours'`), **bukan** `AT TIME ZONE 'Asia/Jakarta'` dari tzdata OS — poin O20 asli sengaja pilih `FixedZone` supaya tidak bergantung tzdata; port SQL-nya harus mempertahankan sifat itu (`(now() + interval '7 hours')::date` sebagai idiom, dibungkus fungsi `wib_date(ts timestamptz) RETURNS date`).
- Kolom `DATE` murni (`due_date`, `period_start`, `period_end`, `effective_from`) tetap `date` — tidak ada perubahan zona waktu karena sudah civil-date tanpa jam.

### A.4 Tabel yang butuh perhatian khusus saat porting

| Tabel | Kenapa perlu perhatian |
|---|---|
| `audit_log` | `BIGINT AUTO_INCREMENT` → `IDENTITY`; `JSON` → `jsonb`; 2 trigger immutability harus di-port persis (§B.3); kolom `created_at DATETIME(3)` → `timestamptz(3)` |
| `client_health_snapshots`, `performance_snapshots` | Trigger immutability ganda (no-update + no-delete) — sama pola `audit_log`; `components_json JSON NOT NULL` → `jsonb NOT NULL`; `UNIQUE KEY (client_id, period_start)` / `(staff_id, period_start)` adalah **idempotency key batch bulanan** — jaga sebagai `UNIQUE` constraint asli, jangan hilang saat pemodelan ulang |
| `id_sequences` | Jantung generator ID — PK komposit `(prefix, period)`, ditulis via `INSERT ... ON DUPLICATE KEY UPDATE next_n = LAST_INSERT_ID(next_n+1)` (MySQL upsert idiom) → wajib diganti pola `INSERT ... ON CONFLICT (prefix, period) DO UPDATE ... RETURNING next_n` di fungsi Postgres, LOCK row semantics harus dipertahankan (SELECT FOR UPDATE implisit dalam UPSERT) — lihat §B.1 |
| `employee_credentials` | `updated_at ... ON UPDATE CURRENT_TIMESTAMP` → butuh trigger `set_updated_at`; TIDAK PERNAH ditulis ke `audit_log` (house rule "no password ke audit") — port harus mempertahankan larangan ini di level kode aplikasi (RLS tidak bisa mencegah developer menulis field salah, ini tanggung jawab code review) |
| `perf_kpi_weights`, `perf_period_targets` | PK komposit non-surrogate (`(role_type, component)`, `(role_type, component, period_start)`) + `updated_at ON UPDATE` — port lurus, tidak ada isu spesial selain trigger `updated_at` |
| `demo_tasks`, `demo_task_block_requests` | Tabel demo Sprint-0 (`DEMO-` prefix) — **kandidat untuk TIDAK di-port** ke produksi Supabase kalau tidak dipakai di UAT nyata; konfirmasi dengan tim sebelum drop, tapi flag di sini supaya tidak lolos tanpa keputusan sadar |
| Semua tabel dengan `ON UPDATE CURRENT_TIMESTAMP` (11 file) | Masing-masing butuh trigger `BEFORE UPDATE` terpasang — pakai SATU fungsi `set_updated_at()` reusable, dipasang lewat `CREATE TRIGGER trg_<table>_updated_at BEFORE UPDATE ON <table> FOR EACH ROW EXECUTE FUNCTION set_updated_at();` per tabel, bukan menulis ulang fungsi tiap tabel |

### A.5 Konvensi schema: satu `public` vs schema per modul

**Rekomendasi: satu schema `public`**, dengan penamaan tabel apa adanya (snake_case, prefiks implisit lewat nama tabel seperti sekarang — `client_health_snapshots`, `performance_snapshots`, dst), BUKAN schema per modul (`module13.client_health_snapshots`, dst).

Alasan:
1. **FK lintas modul sudah dalam menyatu** di skema asli — `services.client_id → clients.id`, `installments.transaction_id → transactions.id`, `client_health_snapshots.client_id → clients.id`, dst. Skema asli SENGAJA satu database "modular monolith di atas satu skema" (bukan modular di level storage) — mem-split ke schema per modul memaksa `search_path` juggling atau FQN di setiap query lintas modul, tanpa manfaat isolasi nyata karena RLS (§D) sudah jadi lapisan isolasi yang sebenarnya, bukan schema boundary.
2. **RLS Postgres beroperasi per tabel**, bukan per schema — jadi keputusan schema-per-modul tidak menambah keamanan; yang menambah keamanan adalah policy per tabel (§D).
3. **Supabase tooling** (auto-generated REST via PostgREST, `mcp__Supabase__generate_typescript_types`, dashboard Table Editor) berasumsi `public` sebagai default expose schema — schema tambahan butuh konfigurasi eksplisit (`db.schemas` di config) tanpa manfaat proporsional untuk domain seukuran ini (49 tabel).
4. Modularitas kode (paket Go `module0_sales`, dst) **tetap dipertahankan di level kode TypeScript** (folder-per-modul di `src/modules/moduleX/...`), bukan di level skema DB — konsisten dengan filosofi awal "modular monolith = module boundary di kode, satu skema di DB".

**Pengecualian yang wajar:** schema `auth` (dikelola Supabase/GoTrue, lihat §C) dan schema internal Supabase lain (`storage`, `realtime` bila dipakai) tetap terpisah — itu given dari platform, bukan pilihan desain kita.

### A.6 Strategi penomoran ulang migrasi via `supabase/migrations`

- Supabase CLI menuntut file migrasi bernama `<timestamp>_<slug>.sql` (format `YYYYMMDDHHMMSS`), berbeda dari konvensi Go-migrate `000N_slug.up.sql`/`.down.sql` yang dipakai backend lama.
- **Rekomendasi:** satu migrasi Postgres BARU per migrasi MySQL lama, **urut dan diberi timestamp sintetis berurutan** yang meniru urutan asli (mis. migrasi `0001_init` → `20260722053824_init.sql`, `0002_wave1_money_path` → `20260722053923_wave1_money_path.sql`, dst, hingga `0037_local_auth` → `20260722060454_local_auth.sql`) — supaya sejarah 37 file lama tetap terbaca 1:1 di `git log`/review, dan setiap migrasi tetap membawa komentar asli (banyak keputusan produk didokumentasikan sebagai komentar SQL panjang, JANGAN dihapus saat port — itu bagian dari `docs/DECISIONS.md`/PRD trail).
- **JANGAN** menggabungkan (squash) 37 file jadi satu migrasi besar — histori per-cluster (Sprint 0, Wave 1 money path, Wave 2 M6/M12/M7-M10, Wave 3 M2/M3/M13/M14) adalah dokumentasi build-order yang bernilai (CLAUDE.md "Build order — do not jump ahead"); mempertahankan 1:1 memudahkan audit "migrasi mana yang mengimplementasikan modul mana".
- Migrasi *tambahan* untuk hal yang baru dibutuhkan stack Postgres (fungsi `set_updated_at()`, fungsi `ident_next()`, RLS policy per tabel, trigger immutability versi Postgres) ditulis sebagai file-file BARU **setelah** timestamp `20260722060454...` — bukan disisipkan ke tengah 37 file port, supaya jelas mana "port skema lama" vs mana "penambahan native Postgres/Supabase".
- Down-migration: `.down.sql` lama (asumsi ada, tidak diminta dibaca tapi konsisten pola go-migrate) → Supabase CLI modern tidak selalu memakai pasangan up/down secara default (branching + `supabase db diff` biasa dipakai), tapi kalau tim ingin mempertahankan reversibilitas eksplisit, simpan sebagai kombinasi migrasi maju yang idempotent + backup sebelum `db reset`, bukan bergantung file down manual.

---

### A.7 Penyelarasan versi repo ↔ riwayat remote (dieksekusi 2026-07-29)

Sampai 2026-07-29 penomoran di `supabase/migrations/` (`20260101…`/`20260102…`) **tidak pernah
cocok** dengan versi yang tercatat di `supabase_migrations.schema_migrations` milik `CDPS SG`
(`202607…`). Sebabnya historis: deploy selalu per-migrasi lewat `apply_migration`, yang
memberi versi **timestamp saat apply** dan mengabaikan nama berkas repo. Selama tidak ada yang
menjalankan `supabase db push` hal itu tidak menggigit — tapi begitu dijalankan, CLI melihat
39 versi lokal yang tak dikenal remote dan mencoba **meng-apply ulang semuanya** di atas skema
yang sudah terisi. (39 berkas saat itu; kini 40 — lihat back-port di bawah.)

Ditutup dengan arah yang sama seperti O38 opsi (A): **repo mengikuti live.** 39 berkas
di-rename ke versi remote, dipetakan **1:1 berdasarkan nama migrasi** (bukan urutan, bukan
tebakan) — 39/39 cocok. Urutan lexicographic lestari, jadi `for f in $(ls
supabase/migrations/*.sql | sort)` di CI tetap menerapkan urutan yang sama.

| Lama (repo) | Baru (= versi live) | Nama |
|---|---|---|
| `20260101000000` | `20260722052710` | `pg_foundation` |
| `20260101000001` | `20260722053824` | `init` |
| `20260101000002` | `20260722053923` | `wave1_money_path` |
| `20260101000006` | `20260722055205` | `qualified_forms` |
| `20260101000010` | `20260722055221` | `briefs_stub` |
| `20260101000011` | `20260722055237` | `payment_verifications` |
| `20260101000012` | `20260722055255` | `reminders_bermasalah` |
| `20260101000013` | `20260722055312` | `client_dormant` |
| `20260101000014` | `20260722055336` | `msl_calculator` |
| `20260101000020` | `20260722055400` | `account_am_assignment` |
| `20260101000021` | `20260722055421` | `strategy_plan` |
| `20260101000022` | `20260722055450` | `briefs_full` |
| `20260101000023` | `20260722055518` | `complaints` |
| `20260101000024` | `20260722055539` | `task_execution` |
| `20260101000025` | `20260722055609` | `assets` |
| `20260101000026` | `20260722055644` | `ad_campaigns` |
| `20260101000027` | `20260722055735` | `kol` |
| `20260101000028` | `20260722055759` | `live_stream_sessions` |
| `20260101000029` | `20260722055815` | `strategy_requirement_override` |
| `20260101000030` | `20260722055948` | `campaigns` |
| `20260101000031` | `20260722060046` | `hours_reminder` |
| `20260101000032` | `20260722060059` | `campaign_linkage` |
| `20260101000033` | `20260722060116` | `marketing_performance_records` |
| `20260101000034` | `20260722060132` | `dependencies` |
| `20260101000035` | `20260722060217` | `client_health` |
| `20260101000036` | `20260722060429` | `team_performance` |
| `20260101000037` | `20260722060454` | `local_auth` |
| `20260102000001` | `20260722060601` | `ident_next` |
| `20260102000002` | `20260723055732` | `statemachine` |
| `20260102000003` | `20260723064438` | `rls_baseline` |
| _(tidak ada)_ | `20260723064826` | `rls_harden_execute_surface` — back-port riwayat, lihat di bawah |
| `20260102000004` | `20260723071013` | `supabase_auth` |
| `20260102000005` | `20260724132631` | `fk_covering_indexes` |
| `20260102000006` | `20260724134427` | `employee_display_name` |
| `20260102000007` | `20260724161750` | `change_password` |
| `20260102000008` | `20260727072443` | `harden_secdef_helpers_to_private_schema` |
| `20260102000009` | `20260729031525` | `rls_leads_campaign_scope` |
| `20260102000010` | `20260729032805` | `rls_finance_staff_queue_scope` |
| `20260102000011` | `20260729104209` | `admin_set_password` |
| `20260102000012` | `20260729162101` | `lead_delete_request` |

> ⚠️ **JANGAN pakai tabel ini untuk menerjemahkan komentar/dokumen yang ditulis SEBELUM
> 2026-07-28 (O38).** Tabel di atas memetakan **berkas**, dan untuk itu ia benar. Tapi O38
> sendiri sudah pernah menomori ulang rentang `0005`–`0009`: sebelum O38, **`…0005` adalah
> C-01 `rls_leads_campaign_scope`** (yang O38 pindahkan ke `…0009`), sementara `…0005`
> *sesudah* O38 adalah `fk_covering_indexes` — migrasi yang sama sekali lain (3 covering
> index FK, nol policy). Jadi rujukan pra-O38 ke `…0005` harus diterjemahkan ke
> **`20260729031525`**, bukan `20260724132631`.
>
> Ini bukan bahaya hipotetis: penyelarasan 2026-07-29 mengganti rujukan versi lewat
> substitusi nomor, dan **dua rujukan pra-O38 karenanya menunjuk migrasi yang salah** —
> `packages/domain/src/leads.ts` dan `supabase/tests/rls_checks.sql` check 13, keduanya
> membicarakan arm *own-campaign-origin* pada `leads_select` (dibuat oleh
> `20260729031525`, lihat baris 22 & 44 berkas itu) tapi tertulis `20260724132631`.
> Diperbaiki 2026-07-30. **Untuk penyelarasan berikutnya: petakan per makna, jangan per
> nomor** — periksa isi migrasi tujuan benar-benar membuat hal yang dibicarakan komentar.

### A.7b Penyelarasan RONDE KEDUA (dieksekusi 2026-08-05)

Drift yang sama muncul lagi, sebabnya sama: empat migrasi 2026-08-03/04 di-apply ke live lewat
`apply_migration` (versi = timestamp saat apply), sedangkan berkas repo memakai nomor yang
dipilih penulisnya. Ditemukan oleh **pemilik** saat menjalankan `supabase migration list
--linked` sebelum `db push` — gate "STOP kalau ada versi remote yang tak dikenal lokal"
bekerja sebagaimana mestinya.

Arah tetap **O38 opsi (A): repo mengikuti live**, dipetakan **1:1 berdasarkan nama migrasi**
yang dibaca dari `supabase_migrations.schema_migrations.name` (bukan tebakan, bukan urutan):

| Lama (repo) | Baru (= versi live) | Nama |
|---|---|---|
| `20260803120000` | `20260803123327` | `rls_sm_edges_read_path` |
| `20260804035500` | `20260804073744` | `rls_finance_client_scope` |
| `20260804061500` | `20260805022245` | `campaign_picker` |
| `20260804154000` | `20260805022807` | `campaign_picker_all_statuses` |

**Dua berkas yang BELUM ter-apply di mana pun ikut di-rename, dan itu keputusan tersendiri:**

| Lama (repo) | Baru | Nama |
|---|---|---|
| `20260804170000` | `20260805030000` | `employee_picker` |
| `20260804180000` | `20260805030100` | `rls_account_lead_client_scope` |

Alasannya: sesudah keempat rename di atas, versi live terakhir adalah `20260805022807`,
sehingga dua berkas `202608041…` itu akan menjadi **out-of-order** terhadap riwayat remote —
`db push` mempersoalkan berkas lokal yang harus disisipkan SEBELUM migrasi terakhir di remote
dan menuntut `--include-all`, flag yang pada keadaan drift justru berbahaya. Karena keduanya
belum tercatat di riwayat mana pun, menggeser nomornya **gratis** dan membuat push berikutnya
kembali menjadi "dua migrasi baru di ujung" — tanpa flag khusus.

**Urutan lexicographic lestari DAN diverifikasi, bukan diasumsikan.** Rename mengubah urutan
apply pada DB baru: `employee_picker` kini SESUDAH kedua picker campaign, dan
`rls_account_lead_client_scope` tetap **sesudah** `rls_finance_client_scope` — yang terakhir ini
load-bearing, karena keduanya menulis ulang SELURUH policy `clients_select`, jadi urutan
terbalik akan menghapus arm Finance tanpa suara. Dibuktikan dengan **rebuild dari nol** (50
migrasi + seed): `clients_select` berakhir dengan arm Finance DAN arm `jwt_is_lead() AND
jwt_division() = 'Account'`, ketiga fungsi `private.*` picker ada, 54 tabel, 4 invariant SQL
PASS, `@cdps/domain` 623 + `apps/api` 318 hijau.

**23 rujukan versi di kode/test/header migrasi diperbarui** — dan sesuai peringatan di atas
("petakan per makna, jangan per nomor") setiap rujukan diaudit terhadap ISI migrasi tujuannya,
plus diverifikasi lewat `git log --all --diff-filter=A` bahwa keenam nomor baru **belum pernah**
dipakai untuk migrasi lain (jadi jebakan `…0005` pra-O38 tidak berlaku di sini).
`docs/DECISIONS.md` **sengaja TIDAK ditulis ulang** — ia catatan historis; tabel di atas adalah
alat terjemahannya.

**Baris live-only `20260723064826_rls_harden_execute_surface` — DITUTUP dengan back-port
riwayat (2026-07-29).** Semula ini satu-satunya sisa: live punya 40 baris riwayat, repo 39
berkas. `db push` sendiri hanya mendorong versi lokal yang belum ada di remote, jadi baris
remote-only tidak memblokirnya — tapi beberapa versi CLI mempersoalkan versi remote yang tidak
punya berkas lokal, dan selisih itu tidak ada gunanya dipertahankan. Repo kini punya
berkasnya, jadi **repo 40 berkas = live 40 baris, 1:1 penuh.**

O38 butir 3 (yang memutuskan *tidak* mem-back-port) **dipersempit, bukan dibalik**: alasannya
tetap berlaku untuk *isi* — statements-nya memang sudah termuat di `rls_baseline` §9 — tetapi
alasan itu tidak menjawab *penomoran*, yang O38 sendiri catat sebagai di luar scope-nya.
Berkasnya diberi header yang menyatakan dengan gamblang bahwa ia back-port riwayat, bukan
perubahan skema baru.

Arah alternatifnya (`supabase migration repair --status reverted 20260723064826`) **tidak**
dipilih: ia menulis ke bookkeeping produksi dan **menghapus jejak** bahwa hardening itu pernah
dijalankan — bertentangan dengan aturan rumah #3 (riwayat immutable), demi keuntungan nol.

**Dibuktikan no-op, bukan diasumsikan.** DB dibangun dari nol dua kali — 39 berkas lalu 40 —
dan empat snapshot dibandingkan: ACL + `proconfig` semua fungsi (`public` & `private`),
seluruh 536 kolom, 49 policy (termasuk ekspresi `qual`/`with_check`), dan ACL 54 tabel.
Keempatnya **identik byte-per-byte**. Itu memang yang diharapkan: seluruh statements-nya
REVOKE/GRANT/`ALTER FUNCTION … SET search_path`, yang menetapkan keadaan akhir, bukan delta.

**Konsekuensi untuk DB lokal yang sudah ada — sudah ada skripnya.** Riwayat migrasi lokal
siapa pun masih memuat versi lama, jadi berkas yang di-rename akan terlihat "belum pernah
di-apply", dan **apply selektif tidak bisa menambalnya** (nama berkas berubah, isi skemanya
tidak ⇒ yang "hilang" akan gagal dengan *already exists*, bukan mengisi kekurangan). Jalur
yang benar hanya satu, bangun ulang dari nol, dan kini satu perintah:

```bash
scripts/db-rebuild.sh              # dry-run — laporkan rencana, nol tulis
scripts/db-rebuild.sh --yes        # drop → 40 migrasi → seed 2× → gate → 4 invariant
npm run db:rebuild -- --yes        # sama, lewat npm
```

Skrip itu mencerminkan job `db-and-migrations` di CI (CI tetap otoritasnya), mendeteksi
riwayat basi `202601…` dan menyebutkannya sebelum drop, serta menolak jalan bila `DB_NAME`
tidak cocok dengan basis di `DATABASE_URL` — karena satu env var basi cukup untuk menghapus
basis yang salah.

**Divergensi komentar yang disengaja.** Referensi silang antar-migrasi (mis. *"lihat
20260102000003"*) ikut diperbarui ke versi baru, jadi komentar berkas repo kini berbeda tipis
dari blob `statements` yang tersimpan di remote untuk migrasi yang sudah ter-apply. Nol
dampak skema; yang dijaga adalah pointer di komentar tidak menggantung. Yang **tidak**
ditulis ulang: `docs/handoff/**` dan entri lama `docs/DECISIONS.md` — keduanya catatan
bertanggal, dan tabel di atas adalah penerjemahnya.

---

## B. Port core engines ke stack baru

Prinsip pemetaan umum: **apa pun yang harus atomik dengan satu baris/transaksi tunggal dan harus benar walau dua request bersamaan** (alokasi ID, transisi status, immutability, trigger `updated_at`) → **fungsi/trigger Postgres** (dieksekusi di dalam transaksi DB, tidak bisa "dilewati" oleh bug di layer TypeScript). **Apa pun yang murni komputasi/format/validasi tanpa concurrency hazard** (formatting IDR, resolusi role dari klaim, transisi lookup-table yang tidak butuh row-lock lintas-request) → **library TypeScript**, supaya mudah di-unit-test dan diubah tanpa migrasi.

### B.1 `ident` — generator ID `PREFIX-YYYYMM-NNNN`

Kode asli (`ident.Next`): satu `INSERT ... ON DUPLICATE KEY UPDATE next_n = LAST_INSERT_ID(next_n+1)` di dalam transaksi Go (`*sql.Tx`) yang sama dengan insert entity — mengandalkan row-lock implisit MySQL upsert supaya gap-free dan aman dari rollback (rollback = angka tidak terpakai, dikembalikan ke committer berikutnya).

**Port → fungsi Postgres `ident_next(prefix text, at timestamptz) RETURNS text`:**

```sql
CREATE TABLE id_sequences (
    prefix     varchar(16) NOT NULL,
    period     char(6)     NOT NULL,
    next_n     integer     NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by varchar(64) NOT NULL DEFAULT 'SYSTEM',
    PRIMARY KEY (prefix, period)
);

CREATE FUNCTION ident_next(p_prefix text, p_at timestamptz)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
    v_period text := to_char(p_at AT TIME ZONE 'UTC' + interval '7 hours', 'YYYYMM'); -- WIB fixed-offset, O20
    v_n      integer;
BEGIN
    INSERT INTO id_sequences (prefix, period, next_n, created_by)
    VALUES (p_prefix, v_period, 1, 'SYSTEM')
    ON CONFLICT (prefix, period)
    DO UPDATE SET next_n = id_sequences.next_n + 1
    RETURNING next_n INTO v_n;

    RETURN p_prefix || '-' || v_period || '-' || lpad(v_n::text, 4, '0');
END;
$$;
```

- `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` mengambil row-level lock yang setara `SELECT ... FOR UPDATE` (Postgres upsert selalu mengunci baris target) — properti gap-free/no-double-alloc/rollback-safe dari kode Go **dipertahankan by construction** selama fungsi dipanggil di dalam transaksi request (Next.js API route route handler membungkus insert entity + panggilan `ident_next` dalam SATU `BEGIN...COMMIT` lewat `postgres.js`/klien transaksi — **bukan** dua roundtrip terpisah lewat `supabase-js` REST, yang tidak berbagi transaksi).
- **Rule "ID hanya terbit setelah validasi lolos" tetap murni tanggung jawab kode TypeScript** (route handler) — fungsi ini TIDAK dipanggil sampai semua validasi field wajib (dan pesan BI `[...]`-nya) lolos, persis pola Go sekarang (`ident.Next` dipanggil setelah `Validate()`). Fungsi SQL sendiri tidak dan tidak boleh melakukan validasi bisnis — itu tetap di TypeScript supaya pesan BI tetap satu sumber (tidak terbelah SQL vs TS).
- Bucket periode WIB memakai idiom fixed-offset (`+ interval '7 hours'`), BUKAN `AT TIME ZONE 'Asia/Jakarta'` (yang bergantung tzdata OS dan punya semantik DST-aware yang tidak relevan tapi berisiko berbeda perilaku antar versi Postgres) — konsisten alasan asli O20 memilih `time.FixedZone`.

### B.2 `statemachine` — engine transisi

Kode asli: `Machine`/`Engine` = **data statis di kode Go** (`config.go`, 14 machine: `prospect_attempt`, `lead_record`, `campaign`, `transaction_payment`, `installment`, `service`, `strategy_plan`, `brief_task`, `creator_booking`, `creator_payment_request`, `live_stream_session`, `complaint`, `dependency`, `ad_campaign`) + satu fungsi generik `Transition()` yang: lock baris (`SELECT ... FOR UPDATE`) → validasi edge (termasuk `requireLead`) → `UPDATE` kolom status → tulis `audit_log` → panggil hook notifikasi — semua dalam satu `*sql.Tx`.

**Port: tabel transisi (data) + satu fungsi transisi generik, TIDAK per-entity trigger.**

- **Tabel edges** (data, bukan hardcode kode) — opsional tapi direkomendasikan supaya `docs/STATE_MACHINES.md` bisa langsung jadi seed, dan penambahan machine baru tidak butuh redeploy kode:
  ```sql
  CREATE TABLE sm_machines (name text PRIMARY KEY, initial_state text NOT NULL, block_message text NOT NULL DEFAULT '[transisi status tidak diizinkan]', auto_computed boolean NOT NULL DEFAULT false);
  CREATE TABLE sm_edges (machine text REFERENCES sm_machines(name), from_state text NOT NULL, to_state text NOT NULL, require_lead boolean NOT NULL DEFAULT false, PRIMARY KEY (machine, from_state, to_state));
  ```
- **Satu fungsi transisi tunggal**, mis. `sm_transition(p_machine text, p_table regclass, p_id_col text, p_status_col text, p_entity_id text, p_to text, p_actor_employee_id text, p_role_director boolean, p_role_lead boolean, p_role_division text) RETURNS jsonb` — mengeksekusi `SELECT ... FOR UPDATE` dinamis (via `format()%I`/`EXECUTE`), cek edge dari `sm_edges`, cek `require_lead` vs parameter role, `UPDATE`, INSERT ke `audit_log`. Ini **satu fungsi generik**, persis filosofi `Engine.Transition()` Go — bukan 14 fungsi terpisah per machine, supaya "no raw UPDATE ever sets status" tetap dijamin arsitektur (satu satu-satunya jalur tulis kolom status).
- **Role-gating (`requireLead`) tetap dievaluasi di dalam fungsi SQL** (bukan hanya di TypeScript) — supaya bahkan panggilan langsung ke Postgres lewat service-role key tanpa lewat API route TIDAK bisa melewati gate lead/Director. Actor & role di-resolve di TypeScript (dari JWT claim, §C) dan **diteruskan sebagai parameter eksplisit** ke fungsi (bukan di-lookup ulang oleh fungsi dari tabel `employees` — menghindari mismatch antara "role effektif saat login" vs "role di DB saat ini" jika keduanya tidak disinkronkan sengaja).
- **Event hook notifikasi**: kode Go memanggil `EventHook` di akhir `Transition()` dalam transaksi yang sama. Port paling aman = fungsi SQL yang sama langsung INSERT ke tabel `notifications` (port dari `notification.Catalog.Emit`, lihat §B.5) di dalam fungsi PL/pgSQL — BUKAN dipisah ke webhook/Edge Function asinkron, karena house rule menuntut notifikasi *derived dari* transisi yang sama, atomik, tidak best-effort.
- **`BlockedError`/`RoleError`** (pesan BI persis) → fungsi `RAISE EXCEPTION 'BLOCKED: %', v_message` (atau kolom hasil terstruktur `{ok: false, message: '[...]'}` dikembalikan sebagai `jsonb` alih-alih exception, supaya route handler bisa memetakan ke HTTP 409/403 dengan pesan tanpa parsing teks exception — **direkomendasikan pendekatan return value terstruktur**, bukan exception, karena lebih mudah di-assert di test TS/pgTAP tanpa string-matching error Postgres yang rapuh).

### B.3 `audit` — log append-only

Kode asli: `audit.Write()` (INSERT murni, tanpa update/delete code path) + 2 trigger MySQL `SIGNAL SQLSTATE '45000'` pada `BEFORE UPDATE`/`BEFORE DELETE` di `audit_log`, juga dipakai identik pada `notifications`, `client_health_snapshots`, `performance_snapshots`.

**Port:**
- **Trigger Postgres** (pola sama, sintaks beda):
  ```sql
  CREATE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN
      RAISE EXCEPTION '% is append-only/immutable: % forbidden', TG_TABLE_NAME, TG_OP;
  END;
  $$;
  CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
  CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
  -- ulangi untuk notifications, client_health_snapshots, performance_snapshots
  ```
  Satu fungsi generik `forbid_mutation()` dipakai di semua trigger (bukan 8 fungsi terpisah) — mengurangi duplikasi dan memastikan pesan konsisten.
- **Lapis kedua (defense-in-depth khas Postgres, tidak ada equivalent MySQL yang dipakai kode asli):** `REVOKE UPDATE, DELETE ON audit_log, notifications, client_health_snapshots, performance_snapshots FROM authenticated, anon;` — supaya bahkan sebelum trigger sempat jalan, role Postgres level (dipakai lewat RLS + `GRANT`, §D) sudah tidak punya privilege. Trigger tetap dipasang sebagai lapis kedua untuk jalur yang memakai `service_role` (yang secara default bypass RLS tapi TIDAK bypass trigger biasa) — supaya immutability tidak bergantung hanya pada RLS/GRANT yang bisa dilewati service key.
- **`Write()` sebagai fungsi TypeScript tipis** (bukan SQL) yang menyusun payload dan memanggil `INSERT INTO audit_log (...)` — validasi "`Actor` wajib" (`ErrNoActor`) tetap di TypeScript sebelum insert (atau tambahkan `CHECK (actor_employee_id <> '')`/`NOT NULL` di kolom sebagai jaring pengaman kedua).
- **`before_json`/`after_json`** tetap `jsonb`; TIDAK PERNAH menulis field password/hash — ini didokumentasikan sebagai code-review rule, RLS/trigger tidak bisa menegakkan "field mana yang boleh masuk JSON", jadi tetap tanggung jawab reviewer manusia + lint/test (unit test yang menegaskan `password_hash` tidak pernah muncul di payload before/after untuk `employee_credential`).

### B.4 `permission` — role model (Division/Level/OD/Director layered)

Kode asli: struct murni Go (`Role{Division, Level, OD, Director}`, `Actor`) + method predikat (`IsLead`, `CanWrite`, `CanReadDivision`, `CanReadAll`, `CanManageAdmin`) — TANPA query DB sendiri (dipanggil oleh `auth.ResolveActor` yang query `employees`+`role_mappings`+`employee_layered_roles`).

**Port:**
- **Resolusi role tetap query gabungan** (`employees` JOIN `role_mappings` + `employee_layered_roles`) — port ke TypeScript sebagai fungsi `resolveActor(employeeId)` dipanggil SEKALI saat sesi dibuat/refresh, hasilnya ditulis sebagai **custom claim `app_metadata`** di JWT Supabase Auth (§C) — supaya predikat `IsLead`/`CanWrite`/`CanReadDivision`/`CanReadAll` bisa dievaluasi murni dari klaim JWT tanpa round-trip DB di setiap request (persis semangat Go: `Actor` di-resolve sekali per request dari sesi, bukan re-query tiap predikat).
- **Predikat murni (`IsLead`, `CanWrite`, dst)** → port 1:1 sebagai fungsi TypeScript murni (tidak butuh DB, tidak butuh jadi SQL function) — dipakai di route handler untuk keputusan otorisasi aplikatif (mis. field mana yang boleh diedit, tombol mana yang tampil).
- **RLS policy (§D) mengevaluasi predikat yang SAMA secara independen di level Postgres**, dibaca dari klaim JWT (`auth.jwt() -> 'app_metadata'`) — INI PENTING: predikat harus diimplementasikan DUA KALI dengan definisi identik (TypeScript untuk UX/validasi awal, SQL/RLS untuk enforcement sesungguhnya) karena route handler bisa salah tapi RLS adalah jaring pengaman terakhir; keduanya diturunkan dari `PERMISSIONS.md` yang sama sehingga tidak boleh divergen — rekomendasikan test kontrak (pgTAP + vitest) yang menjalankan matriks kasus yang sama di kedua sisi (§G).

### B.5 `money` (format IDR)

Kode asli: `Money` = `int64` minor-unit (1/100 rupiah) dengan `Parse`/`Decimal`/`Format` (`"Rp. X.XXX.XXX,00"`) + `PercentOf`/`Mul` pakai `math/big` untuk presisi eksak, tanpa float sama sekali.

**Port → library TypeScript murni**, TANPA fungsi SQL:
- Representasi: **`bigint`** (bukan `number`) untuk minor-units di TypeScript, mem-port sifat "tidak pernah float" — `number` JS punya batas presisi aman 2^53 yang CUKUP untuk rupiah tapi `bigint` lebih eksplisit dan konsisten filosofi asli.
- Kolom DB tetap `numeric(15,2)`/`numeric(20,2)` (Postgres `numeric` = presisi eksak, setara `DECIMAL` MySQL) — konversi `numeric` (dibaca sebagai string oleh driver `postgres.js`/`pg` secara default, BUKAN `number`) ↔ `bigint` minor-unit dilakukan di layer TypeScript, persis pola `Parse`/`Decimal` Go sekarang.
- `Format()` (`"Rp. X.XXX.XXX,00"`) dan `PercentOf`/`Mul` (round-half-up eksak) → port 1:1 sebagai fungsi murni, idealnya **package shared** dipakai baik oleh `web-internal` (comment asli menyebut `web-internal/src/lib/money.ts` SUDAH ADA dan harus match persis) maupun backend API baru — jangan duplikasi rumus pembulatan.
- **Tidak perlu jadi fungsi Postgres** karena semua komputasi uang (komisi, alokasi, rollup) terjadi di request path TypeScript sebelum ditulis sebagai nilai final ke kolom `numeric` — tidak ada kebutuhan komputasi uang di dalam trigger/RLS.

### B.6 `notification` (in-app, derived dari audit)

Kode asli: `Catalog` = 15 event terdaftar (`EvNegotiationPendingApproval` … `EvHoursLoggedReminder`) + resolver recipient (`leadsOfDivision`, `explicit`, `explicitOrLeads`) + `Emit()` INSERT ke `notifications` dalam transaksi yang sama dengan trigger perubahannya; `MarkRead` = satu-satunya mutasi yang diizinkan (tidak ada delete path, ditegakkan trigger `notifications_no_delete`).

**Port:**
- **Katalog event (FROZEN per DECISIONS)** → konstanta TypeScript `enum`/`const object`, TIDAK berubah semantik — 15 event dipertahankan verbatim (nama, deskripsi, resolver).
- **Resolver recipient** (`leadsOfDivision` query `employees JOIN role_mappings`) → port sebagai fungsi SQL (dipanggil dari dalam fungsi `sm_transition`/handler transaksi yang sama, §B.2) ATAU fungsi TypeScript yang dipanggil di transaksi yang sama via `postgres.js` — pilih **fungsi SQL** jika emisi terjadi di dalam `sm_transition` (paling umum, karena kebanyakan notifikasi dipicu transisi status), supaya tetap SATU transaksi DB tanpa round-trip TypeScript↔Postgres di tengah.
- **`Emit()` = INSERT ke `notifications`** — identik pola, tetap dalam transaksi yang memicu (parameter `Division`/`ExplicitRecipients`/`NotifyActor` dipetakan sebagai argumen fungsi SQL).
- **`MarkRead`/`List`/`UnreadCount`** → cukup **query TypeScript biasa via `supabase-js`** (baca sendiri, RLS `recipient_employee_id = auth.uid()`-equivalent akan membatasi baris yang terlihat — lihat §D) TANPA butuh fungsi SQL khusus, karena ini bukan operasi lintas-baris/concurrency-sensitive seperti `ident`/`statemachine`.
- **Immutability (no-delete)** → trigger `forbid_mutation()` yang sama dipasang HANYA pada `DELETE` untuk `notifications` (UPDATE tetap diizinkan terbatas ke kolom `read_at` — beda dengan `audit_log`/snapshot yang no-update-no-delete total); gunakan `CREATE TRIGGER notifications_no_delete BEFORE DELETE ...` + RLS policy `UPDATE` yang HANYA mengizinkan `read_at` berubah lewat `WITH CHECK` yang membandingkan kolom lain tidak berubah, atau lebih simpel: RPC `mark_notification_read(id)` sebagai satu-satunya jalur UPDATE (mirror method `MarkRead` Go), dengan `REVOKE UPDATE ... FROM authenticated` langsung dan hanya RPC (`SECURITY DEFINER`) yang boleh menyentuh kolom `read_at`.

### B.7 `tz` (bucketing WIB)

Kode asli: `tz.WIB = time.FixedZone("WIB", 7*3600)` + `Date`/`DateString`/`Period`/`DaysBetween` — SEMUA murni fungsi tanpa I/O.

**Port:**
- **TypeScript murni** untuk semua pemakaian di route handler/komputasi metrik (Speed Score, Health Score, dsb) — port 1:1 pakai `Date`/`Intl` atau library ringan (`date-fns-tz` dengan offset tetap `+07:00`, BUKAN nama zona `Asia/Jakarta` dari tzdata sistem, supaya sifat "fixed offset, tidak bergantung tzdata" dipertahankan — walau di Node tzdata biasanya tersedia, konsistensi dengan alasan desain asli tetap dijaga: pakai offset literal `+07:00`, bukan lookup nama zona).
- **Fungsi SQL `wib_date`/`wib_period`** (§B.1) untuk kasus yang HARUS dievaluasi di dalam fungsi Postgres (`ident_next`, sweep/batch bulanan `client_health_snapshots`/`performance_snapshots`, kolom generated jika dipakai) — idiom `timestamptz + interval '7 hours'` lalu `::date`/`to_char(...,'YYYYMM')`, TIDAK memakai `AT TIME ZONE 'Asia/Jakarta'`.
- **Satu sumber definisi offset** (`+7 jam`, tanpa DST) didokumentasikan di SATU tempat (mis. konstanta `WIB_OFFSET_HOURS = 7`) dan dipakai konsisten oleh TypeScript maupun SQL — mismatch antara dua implementasi adalah kelas bug paling berbahaya untuk reminder H-3/jatuh-tempo (persis alasan O20 awalnya jadi keputusan formal, bukan asumsi diam-diam).

---

## C. Migrasi auth → Supabase Auth

### C.1 Pemetaan tabel auth lokal existing

Dari `0037_local_auth.up.sql` + `backend/internal/auth/{local.go,session.go,actor.go}`:

| Tabel/kolom lama (MySQL) | Padanan Supabase Auth | Catatan porting |
|---|---|---|
| `employees` (employee_id PK, nama, email, divisi, jabatan, status_aktif, flagged_for_review, synced_at) | **Tabel profil publik BARU** `public.employees` (bukan `auth.users`) — HRIS tetap sumber kebenaran data karyawan, sync tidak berubah | `auth.users` Supabase **hanya** menyimpan identitas login (email + password hash terkelola GoTrue); `employee_id` (HRIS-issued) disimpan sebagai kolom di `public.employees` DAN sebagai `app_metadata.employee_id` di `auth.users`, dihubungkan lewat `auth.users.id` (UUID) ↔ `public.employees.auth_user_id` (kolom baru, FK ke `auth.users.id`) |
| `employee_credentials` (password_hash bcrypt, must_change_password, failed_attempts, locked_until, password_changed_at) | **DIHAPUS sebagai tabel terpisah** — password hash & lockout kini dikelola **GoTrue** (`auth.users.encrypted_password`, dan GoTrue punya mekanisme lockout/rate-limit sendiri) | Lihat §C.2 untuk strategi import password bcrypt existing; `must_change_password` TIDAK punya padanan native GoTrue → simpan sebagai kolom kustom `public.employees.must_change_password boolean` (atau `app_metadata`), DIPERIKSA MANUAL oleh middleware/route handler pasca-login (gate blocking, persis pola lama) |
| `sessions` (token, employee_id, expires_at, revoked_at) | **DIHAPUS sebagai tabel terpisah** — sesi kini JWT Supabase (access token pendek + refresh token), disimpan/divalidasi oleh GoTrue, BUKAN tabel kustom | Revoke sesi (`RevokeAllSessions`/`RevokeOtherSessions`) → API admin GoTrue `supabase.auth.admin.signOut(userId, scope)` (scope `'global'` untuk semua sesi, `'others'` tidak native — perlu pola: increment counter `session_generation` di `app_metadata`, JWT lama dianggap invalid oleh middleware bila `session_generation` klaim < nilai terbaru — **jalur cadangan**, karena GoTrue tidak native punya "revoke semua kecuali sesi ini") |
| `role_mappings` (divisi, jabatan → division, level) | **Tetap tabel Postgres biasa** `public.role_mappings` — TIDAK ada padanan Supabase Auth khusus, ini murni data aplikasi | Dibaca oleh trigger/fungsi `sync_employee_claims()` (§C.3) saat provisioning/reaktivasi |
| `employee_layered_roles` (employee_id, role od/director, enabled) | **Tetap tabel Postgres biasa** `public.employee_layered_roles` | idem — sumber `app_metadata.od`/`app_metadata.director` |
| Audit `employee_credential` actions (`password_set_admin`, `password_changed_self`, `account_locked`) | **Tetap ditulis ke `audit_log`**, tapi trigger sumbernya sekarang webhook GoTrue (`auth.audit_log_entries` internal Supabase — TIDAK dipakai sebagai pengganti; tetap tulis eksplisit ke `public.audit_log` dari Edge Function/route handler yang menangani admin-set-password) | Supabase punya `auth.audit_log_entries` internal sendiri (event login/logout GoTrue) — **jangan campur** dengan `public.audit_log` house; keduanya hidup berdampingan, `public.audit_log` tetap satu-satunya sumber untuk kebutuhan house rule #3 (before→after, actor, recompute) |

### C.2 Import password bcrypt existing ke GoTrue

Karena **asumsi data masih UAT/seed** (bukan data produksi riil dengan karyawan aktif banyak), dan CLAUDE.md secara eksplisit meminta jalur importer/CSV-fallback dipakai untuk data non-live:

**Rekomendasi: reset paksa (Opsi B), bukan import hash langsung** — alasan:
1. **GoTrue mendukung import bcrypt hash secara teknis** (`encrypted_password` kompatibel format bcrypt `$2a$`/`$2b$`) via `auth.users` insert langsung (service-role, bypass API) — TAPI ini jalur "tidak resmi"/tidak didukung penuh oleh SDK admin API standar (`admin.createUser` menerima `password` plaintext, bukan hash pre-computed, di versi GoTrue umum), butuh manipulasi tabel `auth.users` secara langsung via SQL yang rawan salah kolom (`email_confirmed_at`, `aud`, `role` internal GoTrue, `raw_app_meta_data` format JSON tertentu) dan tidak terverifikasi lintas versi Supabase.
2. Skala kecil (fixture Alpha Digital + karyawan UAT, bukan ratusan karyawan produksi) membuat **biaya reset paksa jauh lebih rendah** daripada risiko keliru pada migrasi hash yang menyentuh keamanan login.
3. Pola **provisioning admin-driven sudah ada** di house rule (admin set temp password → `must_change_password=1` → user wajib ganti) — reset paksa pasca-migrasi HANYA memperpanjang pola yang SUDAH jadi keputusan produk (DECISIONS 2026-07-19), bukan pola baru: setiap karyawan di-provision ulang lewat `supabase.auth.admin.createUser({email, password: <temp>, app_metadata: {...}})` + tabel kustom `must_change_password=true`, employee login pertama wajib ganti — user experience-nya SAMA dengan hari ini.
4. Jika ternyata pada saat cutover data SUDAH produksi riil (bukan lagi UAT) dan reset paksa untuk seluruh karyawan tidak akceptable secara operasional, opsi hash-import langsung tetap terbuka sebagai fallback — TAPI itu harus jadi entri `docs/DECISIONS.md` baru sebelum dieksekusi (bukan dipilih diam-diam di tengah migrasi), karena menyentuh tabel internal `auth.users` di luar API resmi.

Bootstrap Director pertama pasca-migrasi: port pola `cmd/setpass` (CLI ops-only existing, DECISIONS 2026-07-19) → skrip Node/`supabase-js` service-role yang dijalankan manual sekali oleh ops (bukan endpoint HTTP), konsisten alasan asli "authority ops di host/DSN, bukan backdoor HTTP".

### C.3 Custom claims (division, level, od, director) via `app_metadata` + hook

- **`app_metadata`** (bukan `user_metadata` — `user_metadata` bisa diedit user sendiri via client SDK, TIDAK aman untuk klaim otorisasi) menyimpan: `employee_id`, `division`, `level` (`staff`/`lead`), `od` (boolean), `director` (boolean) — persis field `permission.Role` Go.
- **Sinkronisasi klaim**: fungsi Postgres `sync_employee_claims(p_employee_id)` (dipanggil dari trigger `AFTER INSERT/UPDATE` pada `public.role_mappings`/`public.employee_layered_roles`/`public.employees.status_aktif`, ATAU dari job sync HRIS) yang mem-`UPDATE auth.users SET raw_app_meta_data = raw_app_meta_data || jsonb_build_object(...)` — memakai **Custom Access Token Hook** Supabase (`auth.custom_access_token_hook`, terdaftar di `config.toml`/dashboard) supaya klaim disuntik ke JWT setiap kali token diterbitkan/refresh (bukan hanya saat provisioning), memastikan perubahan role_mapping/layered_role ter-refleksi di token BERIKUTNYA tanpa perlu re-provision manual.
- **Deaktivasi HRIS ⇒ ban user**: sync HRIS (job scheduled, port dari `internal/hris`) yang mendeteksi `status_aktif=false` pada full/incremental sync memanggil `supabase.auth.admin.updateUserById(userId, {ban_duration: 'none'| '876000h'})` (GoTrue native "ban" — efeknya user tidak bisa login/refresh token walau password benar) — port 1:1 dari perilaku lama "employee deactivated ⇒ akses CDPS dicabut pada sync berikutnya" (CLAUDE.md, Integration section). Reaktivasi HRIS → un-ban (`ban_duration: 'none'`).

### C.4 Alur HRIS sync tetap

- `GET /employees` (HRIS, read-only, tanpa auth endpoint — `docs/HRIS_API_CONTRACT.md` v2 2026-07-19) **tidak berubah** — dikonsumsi oleh scheduled job (Vercel Cron / Supabase Edge Function terjadwal) yang meng-upsert `public.employees`, lalu:
  - Employee baru/reaktivasi aktif → `supabase.auth.admin.createUser`/`updateUserById` (un-ban) + `sync_employee_claims`.
  - Employee `status_aktif=false` → ban (§C.3) + `RevokeAllSessions`-equivalent (`admin.signOut(userId, 'global')`).
  - Employee hilang dari full sync (bukan delete) → tetap **flagged for review**, TIDAK auto-ban (port perilaku "no auto-delete", CLAUDE.md).
- CSV-import fallback (dev/staging, disebutkan `HRIS_API_CONTRACT.md §2`) tetap dipertahankan sebagai jalur alternatif di belakang interface `EmployeeSource` yang sama — port sebagai interface TypeScript `EmployeeSource` (implementasi `HrisApiSource` vs `CsvImportSource`), dipilih via env var, sama seperti Go.

### C.5 Realm terpisah Client Portal

**Rekomendasi: SATU project Supabase, dengan role `client` terpisah + RLS ketat** (bukan dua project Supabase terpisah) — dengan syarat isolasi berikut dipenuhi persis semangat `M15C2_CLIENT_PORTAL_SECURITY_SPEC.md`:

1. **Tabel kredensial/sesi kontak klien TERPISAH TOTAL** dari `auth.users` karyawan — TAPI karena Supabase Auth adalah satu sistem identitas per project, "terpisah total" di sini berarti: kontak klien **JUGA** row di `auth.users` (Supabase tidak punya "auth.users kedua" native), dibedakan lewat `app_metadata.realm = 'client_portal'` DAN skema RLS yang sepenuhnya berbeda query path (bukan endpoint internal dengan role dipangkas) — poin krusial (§4.2 spec) tetap dipenuhi: **portal handler TIDAK PERNAH memanggil query internal yang sama dengan Team Portal**, hanya lewat proyeksi allow-list terpisah (view/RPC khusus Portal). Ini memenuhi maksud "separate auth realm" secara substansi (tidak ada jalur credential/role klien menembus ke sesi karyawan) meskipun secara literal satu tabel `auth.users` dipakai bersama sebagai penyedia identitas dasar.
2. **Alasan pilih satu project, bukan dua:**
   - Dua project Supabase terpisah berarti **dua database terpisah** — data Client Portal (Service Progress, Health band, komplain) butuh join/derivasi dari data internal (`services`, `client_health_snapshots`, dst) yang HANYA ada di project utama; project kedua akan butuh sinkronisasi data lintas-project (replikasi/ETL) HANYA untuk memenuhi "keterpisahan auth" — kompleksitas operasional yang tidak proporsional untuk manfaat isolasi yang SUDAH bisa dicapai dengan RLS + view allow-list dalam satu project.
   - RLS Postgres, dikombinasikan dengan `app_metadata.realm` dan view/RPC allow-list yang secara arsitektur terpisah dari query internal (§D, §M15C2 §4.2), memberi isolasi yang setara untuk kelas ancaman yang relevan (IDOR, cross-tenant leak, over-exposure lewat reuse) — ancaman itu dicegah oleh DISIPLIN QUERY (view khusus, tidak pernah reuse endpoint internal), bukan oleh "project Supabase yang berbeda".
   - Biaya operasional (monitoring, migrasi, backup, secrets) DUA KALI LIPAT untuk isolasi tambahan yang marjinal, mengingat baseline §11 PRD Phase 0 sendiri tidak mensyaratkan "database terpisah", hanya "**auth realm** terpisah + **query-layer isolation**" — dua hal yang sudah tercapai dalam satu project via app_metadata+RLS+view.
3. **Cookie/sesi tetap dibedakan** sesuai spec (`cdps_portal_session` vs sesi Team Portal) — di Supabase Auth ini berarti: **dua Supabase client instance berbeda** di sisi Next.js (satu untuk `web-internal`, satu untuk `web-client-portal`), masing-masing dengan storage cookie terpisah (nama berbeda), TIDAK saling membaca token satu sama lain — walau backend Postgres-nya satu, secara operasional pengguna tidak pernah bisa "pindah realm" lewat token yang sama.
4. Ini **rekomendasi teknis**, BUKAN keputusan final produk — `docs/M15C2_CLIENT_PORTAL_SECURITY_SPEC.md` sendiri menandai Client Portal **masih DITUNDA** menunggu keputusan manusia O4/O5; migrasi stack ini tidak mengubah status penundaan tersebut, hanya menyiapkan pilihan arsitektur bila/ketika O4/O5 diputuskan GO.

---

## D. Desain RLS

### D.1 Baseline kebijakan per role matrix

Prinsip umum (dari `PERMISSIONS.md`/`permission.go`, port ke RLS): setiap tabel domain punya kolom yang bisa dipetakan ke salah satu dari: **kepemilikan langsung** (`created_by`/PIC/owner employee_id), **scope divisi** (lewat kolom relasi ke `role_mappings.division`), atau **tanpa scope** (readable semua staff, jarang). Predikat dasar yang dipakai di semua policy (didefinisikan sebagai fungsi SQL `SECURITY DEFINER` reusable, bukan diulang tiap policy):

```sql
CREATE FUNCTION jwt_employee_id() RETURNS text LANGUAGE sql STABLE AS
  $$ SELECT auth.jwt() -> 'app_metadata' ->> 'employee_id' $$;
CREATE FUNCTION jwt_division() RETURNS text LANGUAGE sql STABLE AS
  $$ SELECT auth.jwt() -> 'app_metadata' ->> 'division' $$;
CREATE FUNCTION jwt_is_lead() RETURNS boolean LANGUAGE sql STABLE AS
  $$ SELECT coalesce((auth.jwt() -> 'app_metadata' ->> 'level') = 'lead', false) $$;
CREATE FUNCTION jwt_is_od() RETURNS boolean LANGUAGE sql STABLE AS
  $$ SELECT coalesce((auth.jwt() -> 'app_metadata' ->> 'od')::boolean, false) $$;
CREATE FUNCTION jwt_is_director() RETURNS boolean LANGUAGE sql STABLE AS
  $$ SELECT coalesce((auth.jwt() -> 'app_metadata' ->> 'director')::boolean, false) $$;
```

Pola universal per tabel domain (mirror `permission.go`):
- **Staff** → baris `WHERE owner_col = jwt_employee_id()`.
- **Lead/SPV** → tambahan `OR (jwt_is_lead() AND division_col = jwt_division())`.
- **OD** → tambahan `OR jwt_is_od()` (read-only — hanya di policy `SELECT`, TIDAK PERNAH di policy `INSERT`/`UPDATE`/`DELETE`, mirror `Role.OD` yang tidak pernah punya jalur tulis di kode Go).
- **Director** → tambahan `OR jwt_is_director()` di SEMUA policy (read maupun write).

### D.2 Contoh policy SQL — 2-3 tabel representatif (ILUSTRATIF, bukan implementasi final)

**`leads`** (kolom relevan: tidak ada owner langsung di tabel `leads` sendiri — kepemilikan ada di `prospect_attempts.owner_employee_id`; `leads.origin_division` adalah kolom scope divisi yang paling dekat):

```sql
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY leads_select ON leads FOR SELECT
USING (
    jwt_is_director() OR jwt_is_od()
    OR (jwt_is_lead() AND origin_division = jwt_division())
    OR EXISTS (
        SELECT 1 FROM prospect_attempts pa
        WHERE pa.lead_id = leads.id AND pa.owner_employee_id = jwt_employee_id()
    )
);

-- Tidak ada policy INSERT/UPDATE langsung untuk "authenticated" biasa:
-- penulisan leads HANYA lewat RPC (fungsi SECURITY DEFINER yang membungkus
-- dedup engine module1_leads.Decide, bukan INSERT/UPDATE langsung dari klien) —
-- lihat catatan §D.3 kapan pakai service-role vs RLS murni.
```

**`transactions`** (Finance-only untuk set Payment Status; visibilitas dasarnya via klien terkait):

```sql
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY transactions_select ON transactions FOR SELECT
USING (
    jwt_is_director() OR jwt_is_od()
    OR (jwt_is_lead() AND jwt_division() = 'Finance')
    OR EXISTS (
        SELECT 1 FROM clients c
        WHERE c.id = transactions.client_id AND c.sales_pic_id = jwt_employee_id()
    )
);

-- UPDATE kolom payment_status TIDAK diberi policy UPDATE langsung sama sekali —
-- house rule "Only Finance sets authoritative Payment Status" melalui fungsi
-- transisi (sm_transition, §B.2), dipanggil lewat RPC yang menjalankan
-- pengecekan jwt_division()='Finance' di DALAM fungsi (SECURITY DEFINER),
-- bukan lewat RLS UPDATE policy langsung dari klien.
REVOKE UPDATE, DELETE ON transactions FROM authenticated;
```

**`client_health_snapshots`** (read visibility AM/SPV/OD/Director per `PERMISSIONS.md` M13; immutable — no write policy sama sekali untuk `authenticated`):

```sql
ALTER TABLE client_health_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY chr_select ON client_health_snapshots FOR SELECT
USING (
    jwt_is_director() OR jwt_is_od()
    OR (jwt_is_lead() AND jwt_division() = 'Account')
    OR EXISTS (
        SELECT 1 FROM clients c
        WHERE c.id = client_health_snapshots.client_id AND c.sales_pic_id = jwt_employee_id()
        -- catatan ilustratif: PIC/AM assignment sesungguhnya ada di tabel
        -- account_am_assignment (0020) — contoh ini disederhanakan, BUKAN final
    )
);
-- Tidak ada policy INSERT/UPDATE/DELETE untuk role authenticated sama sekali —
-- hanya batch job (service-role) yang menulis, plus trigger forbid_mutation()
-- sebagai lapis kedua (§B.3).
```

Contoh-contoh di atas **ilustratif** — pemetaan kolom owner/divisi yang presisi (mis. `account_am_assignment` untuk AM↔Client, bukan `sales_pic_id`) harus diverifikasi ulang terhadap `docs/DATA_MODEL.md` sebelum diimplementasikan sebagai migrasi RLS final.

### D.3 Hubungan RLS dengan service-role key di API routes

- **`anon`/`authenticated` key (RLS aktif)**: dipakai untuk SEMUA baca data yang direpresentasikan sebagai "pengguna login melihat datanya sendiri" — baik dari `supabase-js` di server component MAUPUN dari koneksi Postgres langsung (`postgres.js`) di route handler yang MENYERTAKAN JWT pengguna (lewat `SET request.jwt.claims` di sesi koneksi) — ini jalur DEFAULT dan PREFERRED, karena kebocoran bug di satu route handler tidak otomatis membuka semua data (RLS tetap jaring pengaman).
- **`service_role` key (bypass RLS)**: dipakai HANYA untuk operasi yang secara desain LINTAS-SCOPE dan sudah punya otorisasinya sendiri di level fungsi, yaitu:
  1. **Fungsi transisi (`sm_transition`) dan `ident_next`** — dipanggil sebagai RPC `SECURITY DEFINER` (berjalan dengan privilege pemilik fungsi, bukan privilege caller) sehingga bisa membaca/menulis lintas tabel/lintas scope untuk melakukan lock+validasi+audit+notifikasi dalam satu transaksi — otorisasi "siapa boleh transisi apa" dicek EKSPLISIT DI DALAM fungsi (parameter role dari JWT), BUKAN diserahkan ke RLS caller.
  2. **Batch/scheduled job** (sweep reminder H-3/jatuh-tempo, monthly `client_health_snapshots`/`performance_snapshots` compute, sync HRIS) — berjalan sebagai cron/Edge Function tanpa sesi user, wajib `service_role`.
  3. **Admin operations** (set password/ban user, import via importer/pgloader §F) — eksplisit gate `jwt_is_director()`/`jwt_is_lead()` DI DALAM route handler SEBELUM memanggil service-role, karena setelah service-role dipakai TIDAK ADA lagi jaring pengaman RLS.
  4. **Notification `Emit`/resolver `leadsOfDivision`** — perlu baca lintas-employee untuk resolve recipient, dipanggil dari dalam fungsi `SECURITY DEFINER` yang sama dengan transisi (§B.2/§B.6), bukan dari client-side.
- **Aturan umum: service-role/`SECURITY DEFINER` HANYA untuk kode yang menggantikan house engine (ident/statemachine/audit/notification) atau operasi admin/batch eksplisit — TIDAK PERNAH dipakai sebagai jalan pintas untuk "biar query gampang" di endpoint CRUD biasa.** Setiap pemakaian service-role di luar 4 kategori di atas adalah red flag review.

---

## E. Topologi Vercel & repo

### E.1 Struktur monorepo yang diusulkan

```
AgencyAPP/
├── backend/                  # FROZEN — Go+MySQL, tidak disentuh sampai cutover
├── web-internal/             # existing Next.js — tetap, migrasi bertahap ke API routes baru
├── web-client-portal/        # existing Next.js — idem
├── packages/                 # BARU — kode bersama
│   ├── db/                   #   klien Postgres (postgres.js/drizzle), tipe hasil generate_typescript_types
│   ├── core/                 #   port money.ts, tz.ts, permission.ts (predikat murni)
│   └── supabase-migrations/  #   symlink/reference ke supabase/migrations (root)
├── supabase/
│   ├── migrations/           # BARU — port 37 file + migrasi tambahan (fungsi/trigger/RLS)
│   ├── config.toml
│   └── seed.sql              # fixture Alpha Digital + seed perf_kpi_weights/perf_period_targets
└── (Next.js API routes baru hidup DI DALAM web-internal/src/app/api/... dan
     web-client-portal/src/app/api/... — bukan servis Node terpisah, konsisten
     model serverless Vercel; modul dikelompokkan per folder mis. api/leads/,
     api/finance/, api/health/, mirror nama package Go module0_sales..module15_portal)
```

- **Tidak membuat backend Node terpisah** — route handler Next.js App Router (`app/api/**/route.ts`) DI DALAM `web-internal` dan `web-client-portal` masing-masing adalah "backend"-nya, sesuai model serverless Vercel dan keputusan awal ("backend baru Next.js API routes di Vercel").
- Modularitas kode (paket Go `module0_sales`…`module15_portal`) di-port sebagai **folder per modul** di `packages/core` atau langsung di `src/modules/` masing-masing app — nama folder MENGIKUTI nama modul PRD, bukan direorganisasi bebas (memudahkan pembaca lintas repo lama↔baru).

### E.2 Koneksi DB dari Vercel: `supabase-js` vs `postgres.js`/drizzle via pooler

- **`supabase-js` (REST via PostgREST)**: dipakai untuk **operasi CRUD sederhana yang murni bergantung RLS** (baca notifikasi milik sendiri, baca daftar client yang terlihat, dsb) — tidak butuh transaksi multi-statement, cocok untuk fungsi serverless pendek, otomatis meneruskan JWT pengguna sehingga RLS aktif tanpa kerja tambahan.
- **`postgres.js`/`drizzle` (koneksi Postgres langsung)**: WAJIB dipakai untuk **apa pun yang butuh transaksi eksplisit lintas-statement** — insert entity baru + panggil `ident_next` + panggil `sm_transition` + insert audit dalam SATU `BEGIN...COMMIT` (PostgREST/`supabase-js` TIDAK mendukung transaksi multi-request dari klien). Ini mencakup SEMUA jalur "create entity dengan ID" dan "transisi status" — inti dari house rules #1-#4.
- **Wajib lewat connection pooler Supavisor, MODE TRANSAKSI, port 6543** (bukan port 5432 langsung ke Postgres) — karena fungsi serverless Vercel membuka-tutup koneksi sangat sering (setiap invocation dingin = koneksi baru), dan Postgres punya batas koneksi keras; Supavisor transaction-mode memultipleks banyak koneksi logis ke sedikit koneksi fisik.
- **Implikasi mode transaksi pooler: TIDAK ADA prepared statement lintas-request** (`PREPARE`/`session-level state` tidak persisten karena koneksi fisik bisa dipakai ulang oleh request lain di antara statement) — `postgres.js` punya opsi `{ prepare: false }` yang WAJIB diset untuk koneksi lewat port 6543 (default `postgres.js` memakai prepared statement, yang akan gagal/salah di belakang pooler transaksi); Drizzle ORM juga perlu dikonfigurasi setara. Untuk operasi yang butuh session-level state (`SET LOCAL`, `SELECT ... FOR UPDATE` lintas beberapa statement dalam satu request) → **fungsi PL/pgSQL tunggal** (`sm_transition`, `ident_next`) yang membungkus semuanya sebagai SATU statement `SELECT fungsi(...)`, sehingga tidak bergantung pada state sesi yang dipertahankan lintas roundtrip — ini alasan tambahan kenapa §B mendesain `ident`/`statemachine` sebagai fungsi tunggal, bukan urutan query dari TypeScript.
- **Port 5432 (session mode) direkomendasikan HANYA untuk**: migrasi (`supabase db push`), skrip admin/ops sekali-jalan (bootstrap Director, pgloader §F), dan CI/testing lokal (`supabase start`) — bukan untuk traffic aplikasi runtime Vercel.

### E.3 Environment variables

| Variabel | Isi | Scope |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | URL project | client + server, aman public |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon key (RLS aktif) | client + server, aman public |
| `SUPABASE_SERVICE_ROLE_KEY` | service role (bypass RLS) | **server-only**, Vercel env "Sensitive"/encrypted, TIDAK PERNAH di-`NEXT_PUBLIC_` |
| `DATABASE_URL` (pooler 6543, transaction mode) | koneksi `postgres.js`/drizzle runtime | server-only |
| `DIRECT_URL` (5432, session mode) | migrasi & skrip ops | server-only, dipakai CI/CLI, tidak dipakai runtime request |
| `SUPABASE_JWT_SECRET` | verifikasi JWT bila perlu decode manual di luar SDK | server-only |
| Realm Client Portal: cookie name kustom, TTL sesi lebih pendek (env terpisah per §C.5) | — | dua set env berbeda untuk dua app (`web-internal` vs `web-client-portal`), walau menunjuk project Supabase yang sama |

### E.4 Preview deployments + Supabase branch

- Tiap PR Vercel preview dipasangkan dengan **Supabase branch** (fitur branching Supabase — satu database terisolasi per branch, migrasi `supabase/migrations` di-apply otomatis ke branch tsb) supaya preview deployment tidak pernah menulis ke project produksi/staging bersama.
- Seed data (Alpha Digital fixture, `perf_kpi_weights`/`perf_period_targets` default) dijalankan otomatis di setiap branch baru lewat `supabase/seed.sql` — port dari fixture yang sudah dipakai test Go (`docs/handoff` worked example), memastikan preview selalu punya data yang sama untuk demo/QA manual.
- Branch dihapus otomatis saat PR ditutup/merge (siklus hidup branch Supabase mengikuti siklus hidup branch Git, dikonfigurasi lewat integrasi GitHub Supabase).

---

## F. Migrasi data

### F.1 Jalur utama: re-seed/importer (asumsi data masih UAT/seed)

- Port `backend/internal/importer/` (paket `importer.Service`, struct `LeadRow`/`ClientRow`/`PlatformRow`/`AllocationRow`/`ServiceRow`/`TerminRow`/`PaymentRow`) 1:1 sebagai modul TypeScript `packages/core/importer/` — filosofi asli dipertahankan PERSIS: data lama (lead in-flight, client sudah closed) di-**replay lewat jalur domain yang sama seperti user asli** (dedup engine untuk lead, `sm_transition`+`ident_next`+audit untuk client/service/transaction/installment), **BUKAN** raw `INSERT` ke tabel manapun.
- Dua entry point tetap sama: `LeadRow` → dedup decision table (port module1), dan `ClientRow` → CLI-/SVC-/TRX-/INST- dibangun via fungsi domain (port module0/module4/module5) + payment verification di-replay via padanan `Verify` module5 — sehingga status/rollup akhir konsisten dengan yang akan terjadi bila data itu benar-benar dimasukkan user hari ini.
- Setiap baris yang landed tetap membawa `audit_log` provenance (`import:*` action + index baris sumber) — port field `Detail`/`IssuedIDs`/`Message` dari `RowOutcome` apa adanya.
- **Gate Director-only** (`permit()` di kode asli) → port sebagai pengecekan `jwt_is_director()` di route handler SEBELUM memanggil importer (importer sendiri berjalan lewat service-role setelah gate lolos, §D.3 kategori admin operation).
- Fixture Alpha Digital (worked example dipakai di seluruh test suite Go) di-port sebagai `supabase/seed.sql` DAN sebagai kasus uji vitest (§G) — memastikan hasil akhir angka (Speed Score 112.5%, Health Score ≈74.56 → Watch, dst yang tercatat di DECISIONS) tetap tereproduksi persis di stack baru sebagai kriteria lulus port.

### F.2 Jalur cadangan: pgloader MySQL → Postgres (bila data riil sudah ada saat cutover)

Langkah-langkah:
1. **Freeze tulis** di sisi Go+MySQL (mode read-only atau jendela maintenance) sebelum ekspor — cutover satu-arah, tidak ada dual-write.
2. **Urutan FK** (topological, dari parent ke child) mengikuti dependency asli: `employees` → `role_mappings`/`employee_layered_roles` → `master_services`/`master_service_versions` → `leads` → `prospect_attempts` → `prospect_attempt_nq_reasons`/`negotiation_proposals`/`negotiation_proposal_lines` → `clients` → `client_platforms`/`client_sales_allocations` → `services` → `transactions` → `installments`/`payment_verifications`/`transaction_issue_approvals` → (Wave 2/3 tables mengikuti pola serupa: `campaigns` sebelum `marketing_performance_records`, `briefs` sebelum `assets`/`ad_campaigns`/`creator_bookings`/`live_stream_sessions`, dst) → `audit_log`/`notifications` TERAKHIR (mereferensikan entity_id sebagai string longgar, bukan FK terikat, jadi urutannya paling fleksibel tapi disarankan terakhir supaya seluruh entity sudah ada untuk validasi silang manual).
3. **Jalankan pgloader** dengan script eksplisit per tabel (bukan `pgloader mysql://... postgresql://...` auto-mode polos) supaya kontrol penuh atas: (a) `TINYINT(1)` → `boolean` cast eksplisit, (b) `JSON` (MySQL) → `jsonb`, (c) `AUTO_INCREMENT` kolom di-`SELECT setval()` ulang setelah load supaya sequence Postgres (`IDENTITY`) melanjutkan dari nilai tertinggi yang di-import, BUKAN mulai dari 1 lagi (`ALTER TABLE tbl ALTER COLUMN id RESTART WITH (SELECT MAX(id)+1 FROM tbl)` pasca-load untuk 13 tabel `AUTO_INCREMENT` di §A.1).
4. **`id_sequences`** (tabel counter house-ID) diimpor APA ADANYA (nilai `next_n` per `prefix`+`period` dipertahankan persis) — supaya generator `ident_next` yang baru MELANJUTKAN nomor yang sama, tidak collision dengan ID yang sudah terbit sebelum cutover.
5. **Trigger immutability DINONAKTIFKAN SEMENTARA** selama proses load pgloader (`ALTER TABLE audit_log DISABLE TRIGGER ALL` dst), lalu **DIAKTIFKAN KEMBALI** segera setelah load selesai dan diverifikasi — supaya insert massal historis tidak diblokir (yang tidak relevan karena semua trigger di kode asli hanya melarang UPDATE/DELETE, bukan INSERT — TAPI tetap prosedur aman standar untuk load massal: disable-load-enable, verifikasi tidak ada mutasi terjadi selama window itu).
6. **Verifikasi row count** per tabel: `SELECT count(*) FROM <tbl>` MySQL vs Postgres, harus sama persis untuk seluruh 49 tabel — script otomatis membandingkan, bukan spot-check manual.
7. **Verifikasi checksum**: untuk tabel kritis uang/ID (`transactions`, `installments`, `services`, `id_sequences`, `audit_log`), hitung checksum agregat per tabel (mis. `md5(string_agg(id || total_agreed_value::text, ',' ORDER BY id))` atau setara) di kedua sisi SEBELUM dan SESUDAH load, harus identik.
8. **Verifikasi silang bisnis**: total `installments.amount` per `transaction_id` = `transactions.total_agreed_value` (invariant existing house rule), Σ `client_sales_allocations.basis_points` per client = 10000 — jalankan ulang invariant checker yang sudah ada di test Go (port sebagai script verifikasi pasca-pgloader, bukan hanya row-count).
9. **Cutover final**: setelah verifikasi lolos, DNS/traffic dialihkan ke stack baru; Go+MySQL tetap freeze (read-only arsip) sesuai keputusan strangler, tidak dimatikan langsung sampai periode observasi selesai.

---

## G. Testing & CI paritas

Tujuan: mereplikasi Definition of Done (CLAUDE.md) di stack TypeScript — pesan BI persis, transisi ilegal terblokir, permission per role (termasuk layered OD/Director), immutability, recompute-from-log — dengan bukti yang setara kekuatannya dengan test suite Go yang ada.

| House DoD item | Strategi test TS |
|---|---|
| **Validasi server-side + pesan BI persis** | **vitest** unit test per route handler: setiap validator harus di-assert mengembalikan STRING PERSIS dari daftar `docs/DECISIONS.md`/PRD (mis. `[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]`, `[total alokasi sales harus 100%]`, dll) — bukan hanya "returns 400". Bangun satu file constants `bi-messages.ts` sebagai SATU sumber string (mirror pola Go `const DefaultBlockMessage = "..."`), test mengimpor dari sana supaya tidak ada string BI hardcoded ganda yang bisa divergen. |
| **Transisi ilegal terblokir server-side** | **pgTAP** (test SQL native, jalan di `supabase test db` / `supabase start`) untuk fungsi `sm_transition` LANGSUNG di level Postgres — memverifikasi bahwa memanggil fungsi dengan edge yang tidak ada di `sm_edges` mengembalikan hasil blocked + state TIDAK berubah (row status tetap sama, TIDAK ada baris `audit_log` baru ditulis) — ini penting karena harus terbukti benar DI LEVEL DB, bukan hanya "route handler kita tidak memanggilnya", sesuai semangat asli "invalid transitions blocked server-side" (bukan hanya di client). Duplikasi kasus yang sama di vitest (lewat RPC call) untuk memverifikasi HTTP-level behavior (status code, body pesan). |
| **Permission tests per role (termasuk layered OD/Director)** | Matriks test digenerate dari `PERMISSIONS.md`/tabel di §D — untuk SETIAP endpoint: (allow) role bernama, (deny) role selevel di bawah, (deny) divisi lain level sama, (allow read-only) OD, (allow) Director. **Kasus layered wajib**: satu fixture user Staff+OD harus lulus test "menulis dari staff scope" DAN "membaca all-division dari OD scope" TAPI GAGAL "menulis sebagai OD" (persis skenario yang di-highlight `PERMISSIONS.md` test-suite note) — jalankan di DUA lapis: pgTAP untuk RLS policy langsung (koneksi test sebagai role Postgres dengan JWT klaim disimulasikan via `set_config('request.jwt.claims', ..., true)`), dan vitest/Playwright API-level untuk route handler (memverifikasi gate TypeScript + respons HTTP). |
| **Immutability (tidak ada mutation path pada history)** | pgTAP: `UPDATE`/`DELETE` langsung ke `audit_log`, `notifications` (delete saja), `client_health_snapshots`, `performance_snapshots` HARUS gagal (exception tertangkap) baik sebagai role `authenticated` (diblokir REVOKE+RLS) MAUPUN sebagai `service_role` (diblokir trigger `forbid_mutation()`, lapis kedua) — dua skenario wajib diuji terpisah karena keduanya punya jalur proteksi berbeda (§B.3). |
| **Derived fields (recompute-from-log)** | vitest: untuk setiap field auto-computed (ROAS, CPL, Speed Score, Health Score, commission, turnaround) — test membangun urutan event/transisi lewat RPC yang sama seperti user asli, LALU memanggil fungsi kalkulasi ULANG dari log dan assert hasilnya sama dengan snapshot yang tersimpan (mirror worked example Alpha Digital: Speed Score 54÷48=112.5%, Health Score ≈74.56→Watch). Tidak boleh ada test yang menulis nilai derived langsung ke kolom lalu memverifikasi dibaca kembali (itu tidak menguji recompute, hanya round-trip storage). |
| **Seed fixture Alpha Digital tetap lulus end-to-end** | Satu test suite `alpha-digital.e2e.test.ts` yang menjalankan urutan penuh lead→closing→payment→delivery→health→performance via RPC/route handler sungguhan terhadap `supabase start` lokal (Postgres asli, bukan mock), dijalankan di CI setiap PR — port langsung dari runbook UAT Go (`docs/handoff/W2_UAT_RUNBOOK.md` pola 49 langkah) sebagai daftar assertion. |
| **Notification events registered where catalog requires** | vitest: setelah setiap transisi yang menurut katalog (`EvNegotiationPendingApproval`, dst — 15 event FROZEN) harus emit, assert baris `notifications` untuk recipient yang benar muncul — dan sebaliknya, test negatif bahwa event YANG TIDAK ADA di katalog tidak pernah dipanggil (grep source untuk pemakaian event string di luar 15 konstanta terdaftar, port dari kebiasaan QC Go "grep raw-update/emisi/string liar nihil" yang disebut di `DECISIONS.md`). |

**Infrastruktur CI**: `supabase start` (Postgres + GoTrue + PostgREST lokal via Docker) dijalankan di GitHub Actions sebagai service container; migrasi `supabase/migrations` di-apply (`supabase db reset`) di awal job; pgTAP dijalankan via `supabase test db`; vitest dijalankan terhadap instance lokal tsb (bukan mock Postgres) supaya RLS dan fungsi PL/pgSQL benar-benar diuji, bukan disimulasikan — paritas langsung dengan kebiasaan Go asli yang selalu test terhadap MySQL asli (bukan sqlmock) untuk lapisan house engine.

---

*Draf ini dibaca bersama `docs/DECISIONS.md` (khususnya O20 WIB, entri 2026-07-19 AUTH DIREDESAIN, dan entri Wave 1-3 yang relevan) dan `docs/M15C2_CLIENT_PORTAL_SECURITY_SPEC.md`. Bagian yang bersentuhan dengan keputusan produk yang belum final (Client Portal O4/O5, reset-vs-import password, schema-per-modul) ditandai eksplisit sebagai rekomendasi berikut alasannya, bukan keputusan tertutup — sesuai instruksi CLAUDE.md: bila PRD/keputusan ambigu, catat sebagai open question, jangan diam-diam memilih.*
