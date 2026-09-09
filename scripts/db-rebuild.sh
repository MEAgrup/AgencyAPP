#!/usr/bin/env bash
# =============================================================================
# Bangun ulang DB CDPS lokal DARI NOL: drop → terapkan semua migrasi urut →
# seed (dua kali, uji idempotensi) → verifikasi gate → jalankan 4 invariant SQL.
#
# KENAPA INI ADA. Penomoran versi migrasi diselaraskan ke riwayat remote pada
# 2026-07-29 (`202601…` → `202607…`, lihat SUPABASE_MIGRATION_TECH_APPENDIX §A.7).
# Sejak itu DB lokal mana pun yang dibangun sebelum rename BUKAN lagi cerminan
# repo, dan apply selektif tidak bisa memperbaikinya — nama berkas berubah,
# isi skemanya tidak, jadi migrasi yang "hilang" akan gagal dengan
# "already exists" alih-alih menambal apa pun. Satu-satunya jalur yang benar
# adalah bangun ulang, dan skrip ini membuatnya satu perintah.
#
# Ini juga mencerminkan job `db-and-migrations` di .github/workflows/ci.yml.
# CI tetap otoritasnya; kalau keduanya berbeda, CI yang benar.
#
# PEMAKAIAN
#   scripts/db-rebuild.sh                 # dry-run: laporkan rencana, nol tulis
#   scripts/db-rebuild.sh --yes           # jalankan (DROP DATABASE!)
#   DB_NAME=cdps_scratch scripts/db-rebuild.sh --yes
#   DATABASE_URL=postgres://… scripts/db-rebuild.sh --yes
#
# MODE KONEKSI (dipilih otomatis)
#   1. `DATABASE_URL` di-set  → dipakai apa adanya; admin-connect ke basis
#      `postgres` di host yang sama untuk drop/create.
#   2. Tidak di-set, jalan sebagai root, ada OS user `postgres` → `su postgres`
#      lewat socket lokal (pola sandbox, handoff SESI9 §7).
# =============================================================================
set -euo pipefail

DB_NAME_EXPLICIT="${DB_NAME:-}"
DB_NAME="${DB_NAME:-cdps}"
CONFIRM="no"
[[ "${1:-}" == "--yes" ]] && CONFIRM="yes"

cd "$(dirname "$0")/.."
MIG_DIR="supabase/migrations"
[[ -d "$MIG_DIR" ]] || { echo "FATAL: $MIG_DIR tidak ada — jalankan dari dalam repo." >&2; exit 1; }

# --- pilih mode koneksi ------------------------------------------------------
MODE=""
if [[ -n "${DATABASE_URL:-}" ]]; then
  MODE="url"
  ADMIN_URL="${DATABASE_URL%/*}/postgres"
  # Basis yang DI-DROP harus basis yang DATABASE_URL tunjuk — bukan $DB_NAME.
  # Kalau keduanya boleh berbeda, satu env var basi cukup untuk menghapus basis
  # yang salah. Jadi: turunkan dari URL, dan TOLAK kalau DB_NAME eksplisit beda.
  url_db="${DATABASE_URL##*/}"; url_db="${url_db%%\?*}"
  if [[ -n "${DB_NAME_EXPLICIT:-}" && "$DB_NAME" != "$url_db" ]]; then
    echo "FATAL: DB_NAME=\"$DB_NAME\" tidak cocok dengan basis di DATABASE_URL (\"$url_db\")." >&2
    echo "       Set satu saja — skrip ini tidak menebak yang mana yang Anda maksud." >&2
    exit 1
  fi
  DB_NAME="$url_db"
elif [[ "$(id -u)" == "0" ]] && id postgres >/dev/null 2>&1; then
  MODE="su"
else
  echo "FATAL: tidak ada jalur koneksi. Set DATABASE_URL, atau jalankan sebagai root" >&2
  echo "       di mesin yang punya OS user 'postgres'." >&2
  exit 1
fi

# q <sql>            → jalankan SQL di DB target, keluaran dibuang
# qv <sql>           → jalankan SQL di DB target, kembalikan satu nilai
# qadmin <sql>       → jalankan SQL di basis 'postgres' (untuk DROP/CREATE)
# qfile <path>       → jalankan berkas .sql di DB target
case "$MODE" in
  url)
    q()      { psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -c "$1" >/dev/null; }
    qv()     { psql "$DATABASE_URL" -tAc "$1"; }
    qadmin() { psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -q -c "$1" >/dev/null; }
    qfile()  { psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$1" >/dev/null; }
    WHERE="DATABASE_URL (host: $(sed -E 's#.*@([^/?]+).*#\1#' <<<"$DATABASE_URL"))"
    ;;
  su)
    # psql berjalan sebagai OS user 'postgres', jadi berkas repo harus dapat
    # dibaca user itu. Berkas di bawah $HOME root biasanya tidak — makanya
    # setiap .sql disalin ke staging dir yang world-readable dulu.
    STAGE="$(mktemp -d)"; chmod 755 "$STAGE"
    trap 'rm -rf "$STAGE"' EXIT
    q()      { su postgres -c "psql -d '$DB_NAME' -v ON_ERROR_STOP=1 -q -c \"$1\"" >/dev/null; }
    qv()     { su postgres -c "psql -d '$DB_NAME' -tAc \"$1\""; }
    qadmin() { su postgres -c "psql -v ON_ERROR_STOP=1 -q -c \"$1\"" >/dev/null; }
    qfile()  { local s="$STAGE/$(basename "$1")"; cp "$1" "$s"; chmod 644 "$s"
               su postgres -c "psql -d '$DB_NAME' -v ON_ERROR_STOP=1 -q -f '$s'" >/dev/null; }
    WHERE="su postgres (socket lokal)"
    ;;
esac

MIGRATIONS=()
while IFS= read -r f; do MIGRATIONS+=("$f"); done < <(find "$MIG_DIR" -maxdepth 1 -name '*.sql' | sort)
[[ ${#MIGRATIONS[@]} -gt 0 ]] || { echo "FATAL: nol berkas migrasi di $MIG_DIR" >&2; exit 1; }

echo "══ rebuild DB CDPS ══"
echo "  basis data : $DB_NAME"
echo "  koneksi    : $WHERE"
echo "  migrasi    : ${#MIGRATIONS[@]} berkas ($(basename "${MIGRATIONS[0]}") … $(basename "${MIGRATIONS[-1]}"))"

# --- diagnosa riwayat basi (sebelum drop, supaya penyebabnya terlihat) -------
if [[ "$(qv "select 1 from pg_database where datname='$DB_NAME'" 2>/dev/null || true)" == "1" ]] \
   || qv "select 1" >/dev/null 2>&1; then
  stale="$(qv "select count(*) from supabase_migrations.schema_migrations where version like '202601%'" 2>/dev/null || echo "")"
  if [[ -n "$stale" && "$stale" != "0" ]]; then
    echo "  ⚠ riwayat basi: $stale baris ber-versi 202601… di supabase_migrations.schema_migrations."
    echo "    Itu penomoran PRA-2026-07-29. Rebuild ini yang memperbaikinya; apply selektif tidak bisa."
  fi
fi

if [[ "$CONFIRM" != "yes" ]]; then
  echo
  echo "DRY-RUN — nol perubahan. Jalankan lagi dengan --yes untuk DROP DATABASE \"$DB_NAME\" dan bangun ulang."
  exit 0
fi

echo
echo "→ drop + create \"$DB_NAME\""
qadmin "DROP DATABASE IF EXISTS \"$DB_NAME\" WITH (FORCE)"
qadmin "CREATE DATABASE \"$DB_NAME\""

# --- Tiru DEFAULT PRIVILEGES Supabase SEBELUM migrasi -------------------------
# Proyek Supabase memasang `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL
# ON TABLES/FUNCTIONS TO anon, authenticated, service_role`. Postgres polos
# TIDAK, dan selisih itu melahirkan satu kelas cacat yang STRUKTURAL tidak bisa
# merah di sini: sebuah migrasi menulis `REVOKE EXECUTE ... FROM PUBLIC` (yang
# tidak menyentuh hibah eksplisit per-role), lokal tampak bersih, dan di
# produksi fungsi SECURITY DEFINER-nya bisa dipanggil `anon`.
#
# Sudah terjadi TIGA KALI, dan ketiganya hanya ketahuan karena seseorang membaca
# ACL live sesudah apply — nol test merah:
#   1. wrr_monday_job / wrr_reminder_tick / penugasan_reminder_tick (2026-08-14)
#   2. stage_overdue_tick / permintaan_reminder_tick        (2026-08-31)
#   3. leads_unrespon_tick                                  (2026-09-04)
#
# Menyalakannya di sini membuat DB lokal & CI setia pada produksi, sehingga
# gerbang `rls_checks` §44 punya arti. Role dibuat lebih dulu karena
# ALTER DEFAULT PRIVILEGES menuntutnya ada; migrasi rls_baseline membuat role
# yang sama dengan IF NOT EXISTS, jadi ia melewatinya tanpa keluhan.
# Lewat BERKAS + qfile(), bukan q() -c: SQL ini multi-baris dan memakai $$,
# yang tidak selamat melewati pembungkus `su postgres -c "psql ... -c \"…\""`.
# qfile() sudah menangani staging world-readable untuk mode `su`.
echo "→ tiru default privileges Supabase (anon/authenticated/service_role)"
SUPABASE_GRANTS_SQL="$(mktemp --suffix=.sql)"
trap 'rm -f "$SUPABASE_GRANTS_SQL"' EXIT
cat > "$SUPABASE_GRANTS_SQL" <<'SQLSETUP'
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES    TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
SQLSETUP
qfile "$SUPABASE_GRANTS_SQL"

echo "→ terapkan ${#MIGRATIONS[@]} migrasi (urut lexicographic — urutan berkas ADALAH urutan apply)"
for f in "${MIGRATIONS[@]}"; do
  printf '   %s' "$(basename "$f")"
  if qfile "$f"; then echo " ✓"; else echo " ✗"; echo "FATAL: gagal di $f" >&2; exit 1; fi
done

# Dua kali: seed harus idempoten, sama seperti gate CI. Sekali saja tidak
# membuktikan apa pun — bug idempotensi hanya muncul pada apply kedua.
echo "→ seed Alpha Digital (dua kali — uji idempotensi)"
qfile supabase/seed.sql
qfile supabase/seed.sql

echo "→ verifikasi gate"
# KEEP IN STEP WITH `.github/workflows/ci.yml` job `db-and-migrations` — angka di
# bawah hidup di DUA berkas. Sesi lalu hanya menaikkan yang di sini, dan CI merah
# dengan `expected 14 machines` sementara seluruh test suite hijau. Menambah tabel
# atau mesin berarti mengubah KEDUANYA di commit yang sama.
fail=0
check() { # nama · sql · harapan
  local got; got="$(qv "$2")"
  if [[ "$got" == "$3" ]]; then printf '   ✓ %-28s %s\n' "$1" "$got"
  else printf '   ✗ %-28s %s (harusnya %s)\n' "$1" "$got" "$3"; fail=1; fi
}
check "tabel public"     "select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'" "153"
check "entity_prefix"    "select count(*) from entity_prefix"    "42"
check "sm_machines"      "select count(*) from sm_machines"      "33"
check "notif_events"     "select count(*) from notif_events"     "73"
# --- M19 Creative Daily Ops (20260927010000_m19_creative_daily_ops.sql) ------
# 153 = 150 + `studios` + `prod_slots` + `pic_unavailability` — lapisan RENCANA
#       di bawah lapisan eksekusi M7: hari x studio x PIC x slot waktu, plus
#       ketidaktersediaan produksi seorang PIC. Jadwal harian Leader Video yang
#       hari ini disusun ulang dengan tangan setiap hari.
#  42 =  41 + prefix `SLOT` (dual-home dengan PREFIXES di ident.ts). Prefix
#       `SCS` (SMO & Content Strategist) SENGAJA belum didaftarkan — bentuknya
#       masih pertanyaan terbuka `M19-SCS-ENGINE` di DECISIONS.md §Open.
#  33 TETAP — `PROD-SLOT` sengaja TANPA mesin status (PRD Rule 1/D1: ia catatan
#       rencana, bukan deliverable). Eksekusi/review tetap milik Asset lewat
#       mesin `brief_task`; memberi slot lifecycle sendiri berarti mesin paralel
#       kedua. `packages/db/src/dailyops.registry.test.ts` memaku ketiadaan itu.
#  73 TETAP — modul ini nol event. Konflik studio dan PIC tidak tersedia adalah
#       PERINGATAN INLINE di layar perencana (D3/D4 "warn, never block"), bukan
#       notifikasi ke orang lain. Mendaftarkan event yang tak pernah diemisikan
#       membuat katalog berbohong (preseden `internal_tasks` / M18).
# FS-6 (20260925040000_fs6_msl_opsi_durasi.sql): 150 = 149 +
#       `master_service_duration_options` — pilihan tenor per VERSI layanan
#       (1/3/6/12 bulan dengan harga PAKET berbeda), supaya satu layanan tidak
#       lagi dipecah jadi tiga baris katalog. Nol prefix (anak ber-identity,
#       pola `renewal_proposals`), nol mesin, nol event ⇒ 41/32/73 TETAP.
# --- M18 Store Operation (20260924010000_m18_store_ops_sku.sql) --------------
# 147 = 146 + `store_ops_skus` — unit kerja divisi Store Operation, satu baris
#       per SKU di bawah satu Brief (ketokan K-5, pola AST-/ADC-/BKG-/LSS-).
#  41 =  40 + prefix `SKU` (M6A §7; dual-home dengan PREFIXES di ident.ts).
#  32 =  31 + mesin #32 `store_ops_sku`
#       ([Menunggu Eksekusi] -> [Dikerjakan] -> [Terupload] -> [Dievaluasi],
#       plus [Gagal Upload] dua arah dari [Dikerjakan]). [Terupload] SELESAI
#       produksi dan sengaja bukan terminal — K-6 memisahkan angka dampak dari
#       "selesai" supaya leadtime produksi tidak ternoda tunggu pasar ~30 hari.
#  73 TETAP — event Store Ops didaftarkan BERSAMA emitternya (preseden v9
#       `internal_tasks`); Brief-nya sudah ikut BriefSiapReviewAm/BriefSelesai
#       (B-1). Mendaftarkan event yang tak pernah diemisikan membuat katalog
#       berbohong.
# M18 butir 8 (20260924020000_m18_store_ops_kuota_satuan.sql): KEEMPATNYA TETAP
#       147/41/32/73. Ia hanya memperluas dua CHECK constraint WRR, membalik
#       `division_registry.punya_kuota_satuan`, dan meredefinisi `wrr_aggregate`
#       — nol tabel, nol prefix, nol mesin, nol event baru.
# 73 = 69 + 4 event Feedback OD 2026-09-07 (katalog v15,
#      20260922100100_f3_notif_feedback_od.sql): `m6.brief.siap_review_am` dan
#      `m6.brief.selesai` (resolver 'explicit' -> AM pemilik klien, menutup
#      ujung diam yang dikeluhkan Account #3 & #4), `m9.booking.jatuh_tempo`
#      dan `m9.campaign.mendekati_akhir` (resolver 'explicitOrLeads' ->
#      koordinator KOL + AM, keluhan KOL #1). SATU bump untuk keempatnya —
#      dua jalur paralel memasang emitternya masing-masing, dan mendaftarkan
#      event tanpa emitter itu aman (gate membandingkan NAMA event). Nol
#      tabel/prefix/mesin baru ⇒ 146 tabel/40 prefix/31 mesin TETAP.
# 69 = 67 + 2 event Revisi Sales/Creative/Performa L2 (katalog v14:
#      m1.attempt.unrespon / m1.attempt.auto_not_qualified, keduanya resolver
#      'explicit' -> pemilik attempt; emitter job leads_unrespon_tick).
#      20260911050000_m1_unrespon_notif.sql. Nol tabel/prefix/mesin baru ⇒
#      145 tabel/40 prefix/31 mesin TETAP. Lihat
#      docs/backlog/REVISI_CDPS_SALES_CREATIVE_PERFORMA.md L2.
# 149 = 147 + 2 tabel Gelombang D / kunci tutup buku D-3
#       (20260925020000_d3_tutup_buku.sql): `book_periods` (satu baris per
#       bulan, kunci utamanya BULAN itu sendiri — "Agustus 2026" hanya ada
#       satu, jadi ID surrogate hanya akan membuat duplikat "tidak seharusnya
#       terjadi" alih-alih mustahil) dan `book_period_snapshots` (angka beku
#       BERVERSI, immutable tanpa jalur UPDATE/DELETE — buka-ulang tidak
#       menghapus versi lama, tutup-ulang menambah versi baru).
#       Nol prefix baru (kunci alami `date`, tak pernah disebut manusia lewat
#       ID — pola sama `client_reports`) ⇒ entity_prefix TETAP 40.
#       +1 mesin `book_period` (32→33, STATE_MACHINES.md §23) — DUA gerbang
#       yang sengaja berbeda: menutup = Finance lead ATAU Director, membuka
#       kembali = Director SAJA. Nol event katalog baru ⇒ notif_events TETAP 73.
# 146 = 145 + 1 tabel Gelombang C / gerbang C-5
#       (20260916010000_c5_izin_pitch_klien.sql): `client_pitch_consents` —
#       ledger append-only izin pemakaian angka klien di materi pitch (satu
#       baris per peristiwa beri/cabut; status hari ini adalah TURUNAN dari
#       baris terakhir, tidak disimpan). Keputusan pemilik 2026-09-07 atas C-5.
#       Nol prefix baru (anak `clients`, PK identity, tak pernah disebut manusia
#       lewat ID-nya — pola sama `client_reports`) ⇒ entity_prefix TETAP 40.
#       Nol mesin baru (izin bukan siklus status: ia ledger, bukan entitas
#       ber-lifecycle) ⇒ sm_machines TETAP 31. Nol event katalog baru
#       ⇒ notif_events TETAP 69.
# 145 = 143 + 2 tabel Gelombang 4 TikTok Ads Scanner
#       (20260910010000_gelombang4_adsscanner.sql): `adsscanner_run` (ASR-,
#       satu baris per scan mingguan satu klien, SELURUH baris beku) dan
#       `adsscanner_benchmark` (kategori→{roi,tr,gpm} berversi/append-only,
#       POLICY nol/default-deny — pola sama report_benchmark_shopee). +1
#       prefix ASR (39→40). Nol mesin baru (scan tidak punya siklus status —
#       sekali dihitung, beku) ⇒ sm_machines TETAP 31; nol event katalog baru
#       ⇒ notif_events TETAP 67 (alat kerja internal divisi Ads; tak ada
#       seorang pun yang harus belajar inbox kedua untuk memakainya).
# 143 = 142 + 1 tabel Gelombang 2 Shopee Report Engine
#       (20260909010000_sh01_shopee_report_engine.sql): `report_benchmark_shopee`
#       (padanan Shopee dari `report_benchmark`, berversi/append-only, POLICY
#       nol/default-deny). `client_reports` dapat kolom baru lewat ALTER TABLE
#       (payload_schema, benchmark_versi_shopee) TANPA tabel baru — nol prefix
#       baru, nol mesin baru, nol event katalog baru, semua tiga gerbang lain
#       TETAP di angka Gelombang 3 di bawah.
# 142 = 139 + 3 tabel Gelombang 3 SKU Screener SC-01..SC-07
#       (20260908050000_gelombang3_sku_screener.sql): `screening_run` (Modul
#       A/B, SCR-, payload beku), `ads_decision_log` (Modul C, ADL-,
#       append-only, R13-R16), `optimization_tracker` (Modul D, anak
#       screening_run PK (screening_id,product_code), NOL prefix sendiri). +2
#       prefix SCR/ADL (37→39). Nol mesin baru (screening_run tidak punya
#       siklus status — sekali dihitung, beku; ads_decision_log append-only
#       tanpa status; optimization_tracker mutable tapi tanpa status field) ⇒
#       sm_machines TETAP 31; nol event katalog baru ⇒ notif_events TETAP 67.
#       Schema-only pass — belum ada domain/route layer (SC-08 + wrapper
#       domain menyusul tiket lain). Lihat DECISIONS.md 2026-09-08 (Gelombang 3).
# 139 = 136 + 3 tabel klaster C1 insight/publikasi laporan klien
#       (20260908010000_c1_laporan_insight_publikasi.sql): `client_report_insight`
#       (revisi teks, append-only), `client_report_publikasi` (status + revisi
#       yang dipaku), `complaint_rate_limit_attempts` (spec §5.2, pola
#       login_rate_limit_attempts). Nol prefix baru (kedua tabel pertama
#       ber-PK/FK report_id bigint, bukan PREFIX- id) ⇒ entity_prefix TETAP 37;
#       +1 mesin `client_report` (30→31, STATE_MACHINES.md §21); nol event
#       katalog baru — komplain portal memakai `m6.complaint.logged` yang sudah
#       ada ⇒ notif_events TETAP 67. Lihat DECISIONS.md 2026-09-08.
# 136 = 135 + login_rate_limit_attempts (20260906010000_login_rate_limit.sql,
#       M15-C2 follow-up: uniform per-IP login throttle counter, spec §5.2
#       OQ-5, DECISIONS.md O64 closed). Nol prefix baru (bigserial PK) ⇒
#       entity_prefix TETAP 37; nol mesin baru ⇒ sm_machines TETAP 30; nol
#       event katalog ⇒ notif_events TETAP 67.
# 135 = 134 + client_contacts (20260905010000_m15c2_client_portal_auth.sql,
#       M15-C2: the Client Portal contact's Supabase Auth link table — third
#       non-HRIS realm, same shape as vendor_accounts). The companion migration
#       20260905020000 (admin provisioning functions) adds ZERO tables. Nol
#       prefix baru (auth_user_id PK, bukan PREFIX- id) ⇒ entity_prefix TETAP
#       37; nol mesin baru ⇒ sm_machines TETAP 30; nol event katalog ⇒
#       notif_events TETAP 67.
# 134 = 133 + vendor_accounts (20260903010000_lt61_vendor_auth.sql, LT-61: the
#       Live Stream vendor's Supabase Auth link table). Nol prefix baru
#       (auth_user_id PK, bukan PREFIX- id) ⇒ entity_prefix TETAP 37; nol mesin
#       baru ⇒ sm_machines TETAP 30; nol event katalog ⇒ notif_events TETAP 67.
# 133 = 130 + 3 tabel Kinerja Sales R-03 (20260902020000_renewal_request.sql):
#       `renewal_requests` (parent) + `renewal_proposals` + `renewal_proposal_lines`
#       (versioned line-item snapshot, pola negotiation_proposals/_lines). +1
#       prefix RNW (36→37) + 1 mesin `renewal_request` (29→30, STATE_MACHINES.md
#       §20). 67 = 65 + 2 event R-04 (20260902030000_renewal_notif.sql, katalog
#       v13): `m0.renewal.pending_approval`/`m0.renewal.decision`, sama peran
#       persis dengan `m0.negotiation.*` (M0 §5) — lihat DECISIONS.md Kinerja
#       Sales #5.
# 130 = 128 + 2 tabel Kinerja Sales S-02/§3a (20260901020000_sales_targets.sql +
#       20260901030000_sales_level_labels.sql): `sales_targets` (Sales OKR) +
#       `sales_level_labels` (jabatan→label Level Sales). Nol prefix baru (kunci
#       alami) ⇒ entity_prefix TETAP 36; nol status ⇒ sm_machines TETAP 29; nol
#       event ⇒ notif_events TETAP 65.
# 128 = 127 + 1 tabel Akun B Fase 4 (20260831040000_req_permintaan.sql):
#       `permintaan` (REQ-, M16 §5.5). 29 = 28 + 1 mesin `permintaan`
#       ([Diajukan]->[Diproses]->[Selesai]|[Ditolak], STATE_MACHINES §19).
#       Nol prefix/event baru (sudah dibereskan Tahap F). Angka final ini
#       ditulis di LANGKAH PENGGABUNGAN §5 PARALEL_M16_DUA_AKUN.md, setelah
#       kedua stream digabung dan dihitung ulang dari database gabungan yang
#       SEBENARNYA (bukan dijumlahkan manual) — lihat HANDOFF_M16_AKUN_B.md.
# 127 = 123 + 4 tabel M16 Akun A Fase 2 (20260830010000_m16_stage_schema.sql):
#       stage_pipeline, stage_definition, brief_stage_sla, brief_review. 28 =
#       23 + 5 mesin tahapan (20260830020000_m16_stage_seed.sql: stage_creative,
#       stage_kol, stage_live, stage_ai_opt_sku, stage_ai_opt_video). Nol prefix/
#       event baru (sudah dibereskan Tahap F). Menyimpang dari anotasi "F saja"
#       di docs/handoff/PARALEL_M16_DUA_AKUN.md §4 — dicatat sebagai deviasi
#       sadar di HANDOFF_M16_AKUN_A.md §4.
# 123 = 122 + division_registry (M16 fondasi, 20260829001000: divisi sebagai
#       DATA, menggantikan delapan daftar duplikat). 36 = 35 + REQ (Permintaan
#       terkait klien, M16 §5.5 — didaftarkan di fondasi supaya dua stream
#       paralel tidak sama-sama menyentuh registry prefix). 65 = 58 + 7 event
#       katalog v12 (3 Brief + 2 tahapan + 2 Permintaan) — SATU bump untuk
#       KEDUA stream: invariant menjumlahkan event_count per versi, jadi dua
#       bump terpisah memecahkannya dua kali. Mesin dulu TETAP 23 di fondasi
#       (mesin tahapan milik Akun A, mesin REQ milik Akun B, masing-masing di
#       migrasinya sendiri). Lihat docs/handoff/PARALEL_M16_DUA_AKUN.md.
# 21 = 20 + mesin #18 `weekly_result_recap` (Modul 6D D-02, 20260813020000:
#      Terjadwal→Terbuka→Ditutup|Ditutup Otomatis→(Head)Terbuka). nol tabel/prefix
#      baru di D-02.
# 122 = 121 + ads_weekly_reports (20260819020000, M8: laporan mingguan Advertiser
#       per brief per minggu ISO; follow-up PR #172, keputusan pemilik 2026-08-19).
#       PK (brief_id, iso_year, iso_week) tanpa ID sendiri ⇒ entity_prefix TETAP
#       35; nol status ⇒ 23 TETAP; nol event katalog ⇒ notif_events TETAP 58.
# 121 = 118 + 3 tabel Mesin Laporan Klien (C1, 20260819000000): report_benchmark
#       + client_reports + client_report_berkas. Semua bigint IDENTITY / versi
#       integer ⇒ entity_prefix TETAP 35; nol mesin baru ⇒ 23 TETAP; nol event
#       baru ⇒ notif_events TETAP 58.
# 118 = 114 + 4 tabel Riset Awal Baseline (RAB-01, 20260817000000): riset_awal_analisa
#       + riset_awal_sumber_berkas + interview_riset_awal_isian + riset_awal_benchmark.
#       Semua bigint IDENTITY / kunci alami / versi integer ⇒ 35 (entity_prefix) TETAP;
#       nol mesin baru ⇒ 23 TETAP; nol event baru ⇒ 57 TETAP.
# 114 = 113 + internal_tasks (Penugasan Internal, 20260814110000: tugas atasan→tim
#       di luar rantai Klien→Service→Brief). 35 = 34 + TSK. 23 = 22 + mesin #21
#       `internal_task` ([Ditugaskan]→[Dikerjakan]→[Selesai] | →[Dibatalkan]).
# 58 = 57 + 1 (v11: M8 Ads eskalasi ROAS underperforming — m8.ads.roas_underperforming,
#      20260818040000. Nol mesin/tabel/kolom/prefix baru ⇒ 23/35 TETAP).
# 57 = 54 + 3 (v10: Penugasan Internal jatuh tempo & pembatalan —
#      penugasan_mendekati_jatuh_tempo (H-1 ke PIC), penugasan_jatuh_tempo
#      (ke PIC + pemberi tugas + lead divisi), penugasan_dibatalkan (ke PIC);
#      20260814120000). Emitter (a)(b) = job harian penugasan_reminder_tick,
#      (c) = domain cancelTask. Nol tabel/mesin/prefix baru (dua KOLOM penanda)
#      ⇒ 114/35/23 TETAP.
# 54 = 52 + 2 (v9: Penugasan Internal — penugasan_ditugaskan, penugasan_selesai;
#      20260814110000, DECISIONS 2026-08-14). Notifikasi jatuh tempo BELUM ada:
#      emitter cron-nya belum dibangun, jadi event-nya sengaja tak didaftarkan.
# 52 = 48 + 4 (v8: T-2c Hold Service two-step — service_hold_requested,
#      service_held, service_hold_rejected, service_resumed; 20260814080000).
# 48 = 44 + 4 (v7: M6D Rekap Hasil Mingguan — rekap_mingguan_terbuka,
#      rekap_mingguan_belum_dikonfirmasi, rekap_sengketa_angka,
#      catatan_divisi_belum_diisi wajib RM-8; 20260813070000_m6d_notif_v7.sql,
#      DECISIONS 2026-08-13). Sama seperti v5/v6: literal hanya kenyamanan —
#      invariant sebenarnya SUM(event_count) di gate notif_katalog_sesuai.
# 113 = 112 + client_milestones (T-4c, 20260814070000: Upcoming Milestones
#       terstruktur RM-11). 34 = 33 + MLS. 22 = 21 + mesin client_milestone
#       ([Upcoming]→[Done]|[Cancelled]).
# 112 = 107 + 5 tabel Modul 6D D-01 (20260813010000: weekly_result_recap +
#       wrr_divisi/wrr_metrik/wrr_catatan/wrr_catatan_divisi). 33 = 32 + WRR.
#       D-01 = skema + prefix saja.
# 107 = 105 + hari_libur + kelola_klien_sla_config (20260813000000, SLA timeline
#       tiga langkah — kalender libur nasional + ambang berversi). Mesin/prefix/
#       event TIDAK berubah: nol mesin baru, nol ID baru, nol event notifikasi baru.
# 105 = 104 + interview_riset_awal (20260812100000, langkah 1 "Kelola Klien":
#       riset awal — jangkar mulai/submit, nol kolom durasi). 20 = 19 + mesin
#       `riset_awal` (Berjalan -> Selesai). entity_prefix TETAP 32: riset awal
#       anak interview (PK interview_id), tanpa ID sendiri.
# 104 = 103 + interview_prasyarat_eskalasi (20260811080000, Interview bagian 2:
#       rumah state per-AM untuk eskalasi re-armable — antrean AM, bukan interview).
# 103 = 92 + 11 tabel Modul Interview (20260811030000). 32 = 31 + ITV. 19 = 18 + mesin `interview`.
# 44 = 43 + 1 (v6: kualifikasi_prasyarat_menggantung, 20260811080000). 43 = 34 (v1..v4)
# + 9 (v5 Interview, 20260811020000). Angka ini TIDAK boleh dinaikkan sendirian: ia
# harus sama dengan SUM(event_count) di notif_catalog_versions, dan gate di
# bawah yang memaksanya. Menambah event tanpa mendaftarkan versinya = merah.
check "notif_katalog_sesuai" "select case when (select count(*) from notif_events) = (select coalesce(sum(event_count),0) from notif_catalog_versions) then 1 else 0 end" "1"
check "employees"        "select count(*) from employees"        "10"
check "role_mappings"    "select count(*) from role_mappings"    "12"
check "master_services"  "select count(*) from master_services"  "6"
check "demo_tasks"       "select count(*) from demo_tasks"       "1"

echo "→ invariant SQL"
for inv in ident_checks immutability_checks rls_checks auth_claims_checks; do
  if qfile "supabase/tests/$inv.sql" 2>/dev/null; then printf '   ✓ %s\n' "$inv"
  else printf '   ✗ %s\n' "$inv"; fail=1; fi
done

echo
if [[ "$fail" == "0" ]]; then
  echo "✅ SELESAI — \"$DB_NAME\" dibangun ulang dari ${#MIGRATIONS[@]} migrasi, semua gate & invariant lolos."
  echo "   Jalankan test: DATABASE_URL=\"postgres://postgres:postgres@127.0.0.1:5432/$DB_NAME\" npm test --workspaces --if-present"
else
  echo "❌ ADA YANG GAGAL di atas — jangan pakai DB ini untuk menyimpulkan apa pun." >&2
  exit 1
fi
