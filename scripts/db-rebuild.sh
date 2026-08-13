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
check "tabel public"     "select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'" "107"
check "entity_prefix"    "select count(*) from entity_prefix"    "32"
check "sm_machines"      "select count(*) from sm_machines"      "20"
check "notif_events"     "select count(*) from notif_events"     "44"
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
check "master_services"  "select count(*) from master_services"  "4"
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
