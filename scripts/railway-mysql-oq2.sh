#!/usr/bin/env bash
# ============================================================================
# OQ-2 — hitungan baris MySQL Railway, READ-ONLY.
#
# Menjawab satu pertanyaan yang sampai sekarang belum pernah dijawab dengan
# bukti: apakah MySQL Railway memuat data produksi, atau ia memang kosong?
#
# `docs/DECISIONS.md` 2026-07-29 mencatat batasnya dengan tepat:
#
#   "'0 baris' pada DB kosong tidak bisa dibedakan dari '0 baris karena
#    querynya salah' … Sampai hitungan itu ada, OQ-2 berstatus terjawab untuk
#    perencanaan, belum terverifikasi untuk dekomisi."
#
# Maka skrip ini tidak berhenti pada COUNT(*). Ia mencetak, dalam satu keluaran:
#
#   1. identitas sambungan  — versi server, DATABASE(), CURRENT_USER()
#      ⇒ membuktikan kita bicara dengan sebuah DB, dan dengan yang MANA
#   2. jumlah kolom per tabel
#      ⇒ tabel ber-12-kolom yang melaporkan 0 baris TERBUKTI ada dan terbaca;
#        tabel yang tidak ada tidak akan muncul di daftar sama sekali
#   3. COUNT(*) sungguhan, bukan taksiran information_schema.table_rows
#   4. selisih terhadap daftar tabel yang diharapkan, dibaca dari
#      backend/migrations/*.up.sql
#
# Nol tulis: tidak ada INSERT/UPDATE/DELETE/DDL di berkas ini.
#
# Keluaran laporan HANYA memuat nama tabel + angka — nol PII, jadi ia aman
# di-commit ke repo (yang saat ini PUBLIK) dan aman diunggah sebagai artifact.
#
# Exit code: 0 sukses · 1 gagal sambung/urai · 2 tabel inti tidak ditemukan
# ============================================================================
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/.." && pwd)"
# shellcheck source=lib/railway-mysql-common.sh
. "$HERE/lib/railway-mysql-common.sh"
trap rm_cleanup EXIT

URL=""
OUT=""
SHOW_HOST=0

usage() {
  cat <<'EOF'
Pemakaian: scripts/railway-mysql-oq2.sh [opsi]

  --url <mysql://…>   URL koneksi. Default: $RAILWAY_MYSQL_URL, lalu
                      $MYSQL_PUBLIC_URL, lalu $MYSQL_URL.
                      WAJIB URL PUBLIK (host *.proxy.rlwy.net) — host
                      *.railway.internal hanya hidup di dalam Railway.
  --out <berkas.md>   Tulis laporan Markdown ke berkas ini.
  --show-host         Cetak host:port apa adanya. Default: disamarkan, karena
                      laporan ini ditujukan untuk repo yang publik.
  -h, --help          Bantuan ini.
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --url) URL="${2:-}"; shift 2 ;;
    --out) OUT="${2:-}"; shift 2 ;;
    --show-host) SHOW_HOST=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) rm_die "Opsi tidak dikenal: $1" ;;
  esac
done

[ -n "$URL" ] || URL="${RAILWAY_MYSQL_URL:-${MYSQL_PUBLIC_URL:-${MYSQL_URL:-}}}"
[ -n "$URL" ] || rm_die "URL koneksi tidak diberikan.
   Isi \$RAILWAY_MYSQL_URL atau pakai --url.
   Railway > proyek CDPS > service MySQL > Variables > MYSQL_PUBLIC_URL."

rm_require_client
rm_parse_url "$URL"
rm_write_cnf

if [ "$SHOW_HOST" = "1" ]; then
  ENDPOINT="$RM_HOST:$RM_PORT"
else
  ENDPOINT="$(printf '%s' "$RM_HOST" | sed -E 's/^[^.]+/<disamarkan>/'):$RM_PORT"
fi
STAMP="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"

echo "== OQ-2 · hitungan baris MySQL Railway =="
echo "   endpoint : $ENDPOINT"
echo "   database : $RM_DB"
echo "   waktu    : $STAMP"
echo

BANNER="$(rm_connect_banner)"
SRV_VERSION="$(printf '%s' "$BANNER" | cut -f1)"
SRV_DB="$(printf '%s' "$BANNER" | cut -f2)"
SRV_USER="$(printf '%s' "$BANNER" | cut -f3)"
SRV_NOW="$(printf '%s' "$BANNER" | cut -f4)"

echo "✅ tersambung — server $SRV_VERSION · DATABASE()=$SRV_DB · user=${SRV_USER%%@*}@… · jam server $SRV_NOW"

if [ "$SRV_DB" != "$RM_DB" ]; then
  rm_die "DATABASE() melaporkan '$SRV_DB', bukan '$RM_DB' yang diminta URL. Hentikan — hitungan apa pun sesudah ini menghitung DB yang salah."
fi

# --- inventaris ------------------------------------------------------------
COLS="$RM_TMPDIR/cols.tsv"
ROWS="$RM_TMPDIR/rows.tsv"
rm_column_counts >"$COLS"
rm_row_counts    >"$ROWS"

TABLE_COUNT="$(wc -l <"$ROWS" | tr -d ' ')"
if [ "$TABLE_COUNT" = "0" ]; then
  rm_die "Nol BASE TABLE di schema '$RM_DB'. Itu bukan 'DB kosong' — itu DB yang SALAH,
   atau user tanpa hak baca information_schema. Jangan catat ini sebagai OQ-2 terverifikasi." 2
fi

TOTAL_ROWS=0
while IFS=$'\t' read -r _t n; do
  TOTAL_ROWS=$(( TOTAL_ROWS + n ))
done <"$ROWS"

# --- selisih terhadap migrasi Go -------------------------------------------
EXPECTED="$RM_TMPDIR/expected.txt"
ACTUAL="$RM_TMPDIR/actual.txt"
rm_expected_tables "$REPO_ROOT/backend/migrations" >"$EXPECTED"
cut -f1 "$ROWS" | LC_ALL=C sort -u >"$ACTUAL"   # LC_ALL=C: comm mensyaratkan urutan yang SAMA di kedua sisi

MISSING="$(comm -23 "$EXPECTED" "$ACTUAL" | tr '\n' ' ' | sed 's/ *$//')"
EXTRA="$(comm -13 "$EXPECTED" "$ACTUAL" | tr '\n' ' ' | sed 's/ *$//')"
EXPECTED_COUNT="$(wc -l <"$EXPECTED" | tr -d ' ')"

# --- tabel inti ------------------------------------------------------------
# DECISIONS 2026-07-29 menyebut tiga tabel ini secara eksplisit sebagai minimum
# yang harus dilampirkan sebelum Railway dimatikan.
CORE="leads clients transactions"
CORE_OK=1
CORE_LINES=""
for t in $CORE; do
  n="$(awk -F'\t' -v t="$t" '$1==t {print $2}' "$ROWS")"
  c="$(awk -F'\t' -v t="$t" '$1==t {print $2}' "$COLS")"
  if [ -z "$n" ]; then
    CORE_OK=0
    CORE_LINES+="| \`$t\` | **TIDAK ADA** | — | 🔴 tabel tidak ditemukan di schema |"$'\n'
  else
    CORE_LINES+="| \`$t\` | $c | **$n** | $( [ "$n" = "0" ] && echo "✅ kosong — dan terbukti ada ($c kolom terbaca)" || echo "🟠 BERISI DATA — dekomisi butuh rencana ekspor" ) |"$'\n'
  fi
done

echo
printf '%-42s %6s %12s\n' "TABEL" "KOLOM" "BARIS"
printf '%-42s %6s %12s\n' "------------------------------------------" "------" "------------"
while IFS=$'\t' read -r t n; do
  c="$(awk -F'\t' -v t="$t" '$1==t {print $2}' "$COLS")"
  printf '%-42s %6s %12s\n' "$t" "${c:-?}" "$n"
done <"$ROWS"
printf '%-42s %6s %12s\n' "------------------------------------------" "------" "------------"
printf '%-42s %6s %12s\n' "TOTAL ($TABLE_COUNT tabel)" "" "$TOTAL_ROWS"
echo

[ -n "$MISSING" ] && echo "🟠 ada di migrasi Go, TIDAK ada di DB : $MISSING"
[ -n "$EXTRA" ]   && echo "🟠 ada di DB, TIDAK ada di migrasi Go : $EXTRA"

if [ "$CORE_OK" = "0" ]; then
  echo
  echo "🔴 Satu atau lebih tabel inti (leads/clients/transactions) tidak ada di schema ini."
  echo "   OQ-2 TIDAK boleh dicatat terverifikasi dari run ini."
fi

# --- laporan Markdown ------------------------------------------------------
if [ -n "$OUT" ]; then
  {
    echo "# OQ-2 — hitungan baris MySQL Railway ($STAMP)"
    echo
    echo "> Dihasilkan \`scripts/railway-mysql-oq2.sh\`, read-only. Isinya nama tabel + angka saja — nol PII."
    echo
    echo "| | |"
    echo "|---|---|"
    echo "| Waktu (UTC) | \`$STAMP\` |"
    echo "| Endpoint | \`$ENDPOINT\` |"
    echo "| Database | \`$RM_DB\` (DATABASE() melaporkan \`$SRV_DB\`) |"
    echo "| Server | \`$SRV_VERSION\` |"
    echo "| User | \`${SRV_USER%%@*}@…\` |"
    echo "| BASE TABLE terbaca | **$TABLE_COUNT** |"
    echo "| Tabel diharapkan (dari \`backend/migrations/*.up.sql\`) | $EXPECTED_COUNT |"
    echo "| **Total baris seluruh tabel** | **$TOTAL_ROWS** |"
    echo
    echo "## Tabel inti — yang diminta DECISIONS 2026-07-29"
    echo
    echo "| Tabel | Kolom | Baris | Pembacaan |"
    echo "|---|---:|---:|---|"
    printf '%s' "$CORE_LINES"
    echo
    echo "> Kolom **Kolom** ada supaya \"0\" bisa dipertanggungjawabkan: tabel yang melaporkan"
    echo "> 0 baris **sekaligus** melaporkan jumlah kolomnya terbukti ada dan terbaca oleh"
    echo "> sambungan ini. Tabel yang tidak ada tidak akan muncul di daftar mana pun di bawah."
    echo
    echo "## Seluruh tabel"
    echo
    echo "| Tabel | Kolom | Baris |"
    echo "|---|---:|---:|"
    while IFS=$'\t' read -r t n; do
      c="$(awk -F'\t' -v t="$t" '$1==t {print $2}' "$COLS")"
      echo "| \`$t\` | ${c:-?} | $n |"
    done <"$ROWS"
    echo "| **TOTAL ($TABLE_COUNT tabel)** | | **$TOTAL_ROWS** |"
    echo
    echo "## Selisih terhadap migrasi Go"
    echo
    if [ -z "$MISSING" ] && [ -z "$EXTRA" ]; then
      echo "✅ Nol selisih — schema di Railway persis daftar tabel \`backend/migrations/*.up.sql\` (+ \`schema_migrations\`)."
    else
      [ -n "$MISSING" ] && echo "- 🟠 Ada di migrasi, tidak ada di DB: $MISSING"
      [ -n "$EXTRA" ]   && echo "- 🟠 Ada di DB, tidak ada di migrasi: $EXTRA"
    fi
    echo
    echo "## Catatan metode"
    echo
    echo "- Angka baris dari \`COUNT(*)\` **sungguhan**, bukan \`information_schema.tables.table_rows\`"
    echo "  (untuk InnoDB kolom itu taksiran statistik dan bisa melaporkan angka bukan-nol pada tabel kosong)."
    echo "- Skrip ini **nol tulis**: tidak ada INSERT/UPDATE/DELETE/DDL."
    echo "- Password dibaca lewat option file 0600, tidak pernah lewat argumen proses."
  } >"$OUT"
  echo "📄 laporan Markdown : $OUT"
fi

if [ "$CORE_OK" = "0" ]; then exit 2; fi

echo
if [ "$TOTAL_ROWS" = "0" ]; then
  echo "✅ SELESAI — $TABLE_COUNT tabel, TOTAL 0 baris. DB terbukti ada, terbaca, dan kosong."
else
  echo "✅ SELESAI — $TABLE_COUNT tabel, total $TOTAL_ROWS baris."
  echo "   Baris bukan-nol ⇒ baca kembali C-04: apakah entitas itu perlu ikut pindah?"
fi
