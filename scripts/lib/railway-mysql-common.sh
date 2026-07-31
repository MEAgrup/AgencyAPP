# shellcheck shell=bash
# ============================================================================
# Helper bersama untuk dua skrip Railway MySQL:
#   scripts/railway-mysql-oq2.sh      — hitungan baris (OQ-2), read-only
#   scripts/railway-mysql-backup.sh   — dump + verifikasi + enkripsi
#
# Berkas ini di-source, bukan dieksekusi.
#
# KENAPA ADA LAPISAN INI
# Keduanya butuh hal yang persis sama: mengurai URL Railway, menaruh password
# di tempat yang TIDAK terlihat di `ps`, dan menghitung baris dengan cara yang
# bisa dipertanggungjawabkan. Menyalinnya dua kali berarti dua versi yang bisa
# menyimpang — dan yang menyimpang di sini adalah bukti dekomisi.
# ============================================================================

RM_TMPDIR=""
RM_CNF=""
RM_USER=""
RM_PASS=""
RM_HOST=""
RM_PORT=""
RM_DB=""

rm_die() {
  printf '\n\033[31m✗ GAGAL:\033[0m %s\n' "$1" >&2
  exit "${2:-1}"
}

rm_info() { printf '%s\n' "$*" >&2; }

rm_cleanup() {
  [ -n "$RM_TMPDIR" ] && [ -d "$RM_TMPDIR" ] && rm -rf "$RM_TMPDIR"
  return 0
}

# Percent-decoding untuk komponen URL (password Railway kerap ber-karakter khusus).
rm_urldecode() {
  local s="${1//+/ }"
  printf '%b' "${s//%/\\x}"
}

# ----------------------------------------------------------------------------
# rm_parse_url <url> — mengisi RM_USER/RM_PASS/RM_HOST/RM_PORT/RM_DB.
#
# Pemotongan sengaja memakai `%@*` (dari KANAN) dan `##*@` supaya password yang
# memuat '@' tidak memotong URL di tempat yang salah — kegagalan yang tidak
# menghasilkan error, hanya "host tidak dikenal" yang menyesatkan.
# ----------------------------------------------------------------------------
rm_parse_url() {
  local url="$1"
  case "$url" in
    mysql://*)  url="${url#mysql://}" ;;
    mysql2://*) url="${url#mysql2://}" ;;
    *) rm_die "URL harus berbentuk mysql://user:password@host:port/database" ;;
  esac
  case "$url" in
    *@*) ;;
    *) rm_die "URL tidak memuat '@' — ini bukan URL koneksi MySQL yang lengkap." ;;
  esac

  local creds rest hostport dbq
  creds="${url%@*}"
  rest="${url##*@}"

  RM_USER="$(rm_urldecode "${creds%%:*}")"
  case "$creds" in
    *:*) RM_PASS="$(rm_urldecode "${creds#*:}")" ;;
    *)   RM_PASS="" ;;
  esac

  hostport="${rest%%/*}"
  case "$rest" in
    */*) dbq="${rest#*/}" ;;
    *)   dbq="" ;;
  esac
  RM_DB="${dbq%%\?*}"

  case "$hostport" in
    *:*) RM_HOST="${hostport%%:*}"; RM_PORT="${hostport##*:}" ;;
    *)   RM_HOST="$hostport"; RM_PORT="3306" ;;
  esac

  [ -n "$RM_HOST" ] || rm_die "Host kosong sesudah diurai — periksa URL-nya."
  [ -n "$RM_DB" ]   || rm_die "Nama database kosong sesudah diurai — URL harus berakhir /<database>."

  # Host internal Railway hanya bisa dijangkau DARI DALAM proyek Railway. Dari
  # laptop atau runner GitHub ia gagal sebagai timeout DNS — gejala yang mudah
  # dibaca keliru sebagai "DB-nya mati", padahal cuma URL-nya yang salah pilih.
  case "$RM_HOST" in
    *.railway.internal)
      rm_die "Host '$RM_HOST' adalah alamat privat Railway; ia hanya hidup di dalam proyek Railway.
   Pakai MYSQL_PUBLIC_URL (host *.proxy.rlwy.net) — Railway > service MySQL > tab Variables."
      ;;
  esac
}

# ----------------------------------------------------------------------------
# rm_write_cnf — menulis option file 0600 supaya password TIDAK pernah muncul
# di argumen proses (`ps aux` terbaca oleh proses lain, dan di runner CI ia
# ikut ter-log kalau `set -x` menyala di suatu tempat).
# ----------------------------------------------------------------------------
rm_write_cnf() {
  RM_TMPDIR="$(mktemp -d)"
  chmod 700 "$RM_TMPDIR"
  RM_CNF="$RM_TMPDIR/my.cnf"

  # Nilai ber-kutip di option file MySQL mengenal escape \\ dan \" — keduanya
  # harus di-escape, sisanya (termasuk '#') aman di dalam kutip.
  local esc="${RM_PASS//\\/\\\\}"
  esc="${esc//\"/\\\"}"

  umask 077
  cat >"$RM_CNF" <<EOF
[client]
host=$RM_HOST
port=$RM_PORT
user=$RM_USER
password="$esc"
EOF
  chmod 600 "$RM_CNF"
}

rm_require_client() {
  command -v mysql >/dev/null 2>&1 || rm_die "Perintah 'mysql' tidak ada di PATH.
   Ubuntu/Debian : sudo apt-get install -y mariadb-client   (atau mysql-client)
   macOS         : brew install mysql-client
   Windows       : pakai jalur GitHub Actions di runbook — tidak perlu instal apa pun."
}

rm_require_dump() {
  command -v mysqldump >/dev/null 2>&1 || rm_die "Perintah 'mysqldump' tidak ada di PATH (paket yang sama dengan klien 'mysql')."
}

# rm_q <sql> — satu query, keluaran TSV tanpa header.
rm_q() {
  mysql --defaults-file="$RM_CNF" --batch --raw --skip-column-names "$RM_DB" -e "$1"
}

# rm_connect_banner — membuktikan sambungannya hidup DAN menunjuk DB yang benar.
# Dicetak sebelum apa pun yang lain: hitungan "0" hanya bermakna kalau baris ini
# lebih dulu membuktikan kita memang bicara dengan database yang dimaksud.
rm_connect_banner() {
  local out
  out="$(rm_q "SELECT VERSION(), DATABASE(), CURRENT_USER(), NOW()" 2>&1)" \
    || rm_die "Tidak bisa menyambung ke $RM_HOST:$RM_PORT/$RM_DB.
   Pesan asli: $out"
  printf '%s' "$out"
}

# rm_base_tables — daftar BASE TABLE di schema, satu per baris, terurut.
rm_base_tables() {
  rm_q "SELECT table_name FROM information_schema.tables
        WHERE table_schema = '$RM_DB' AND table_type = 'BASE TABLE'
        ORDER BY table_name"
}

# rm_column_counts — 'tabel<TAB>jumlah_kolom'.
#
# Ini bukan hiasan: ia yang membedakan "0 baris karena tabelnya memang kosong"
# dari "0 baris karena querynya salah/DB-nya salah". Tabel dengan 12 kolom yang
# melaporkan 0 baris terbukti ADA dan terbaca; tabel yang tidak ada tidak akan
# pernah muncul di daftar ini sama sekali.
rm_column_counts() {
  rm_q "SELECT table_name, COUNT(*) FROM information_schema.columns
        WHERE table_schema = '$RM_DB'
        GROUP BY table_name ORDER BY table_name"
}

# rm_row_counts — 'tabel<TAB>jumlah_baris' dengan COUNT(*) SUNGGUHAN.
#
# information_schema.tables.table_rows SENGAJA tidak dipakai: untuk InnoDB ia
# taksiran dari statistik, bisa meleset jauh, dan pada tabel kosong ia kadang
# melaporkan angka bukan-nol. Untuk keputusan dekomisi, taksiran tidak cukup.
rm_row_counts() {
  local tables sql t
  tables="$(rm_base_tables)"
  [ -n "$tables" ] || return 0

  sql=""
  while IFS= read -r t; do
    [ -n "$t" ] || continue
    sql+="SELECT '$t' AS t, COUNT(*) AS n FROM \`$t\` UNION ALL "
  done <<<"$tables"
  sql="${sql% UNION ALL }"

  rm_q "$sql"
}

# rm_expected_tables <dir-migrasi> — daftar tabel yang SEHARUSNYA ada, dibaca
# dari berkas migrasi Go, bukan dari daftar yang di-hardcode di sini. Daftar
# hardcode akan basi diam-diam; berkas migrasi tidak bisa basi terhadap dirinya
# sendiri.
rm_expected_tables() {
  local dir="$1"
  [ -d "$dir" ] || return 0
  {
    grep -h -ioE 'create[[:space:]]+table[[:space:]]+(if[[:space:]]+not[[:space:]]+exists[[:space:]]+)?`?[a-z0-9_]+`?' "$dir"/*.up.sql 2>/dev/null \
      | sed -E 's/.*[[:space:]]//; s/`//g'
    # Dibuat oleh runner migrasi (backend/internal/db/migrate.go), bukan oleh
    # salah satu berkas migrasi — jadi ia tidak akan tertangkap grep di atas.
    echo "schema_migrations"
  } | LC_ALL=C sort -u
}
