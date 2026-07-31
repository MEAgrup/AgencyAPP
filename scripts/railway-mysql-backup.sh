#!/usr/bin/env bash
# ============================================================================
# Backup MySQL Railway terakhir — gate GO, butir 6 (CUTOVER_BACKLOG §2).
#
# Sebuah berkas dump BUKAN backup sampai ada yang membuktikan isinya. Skrip ini
# karena itu tidak berhenti pada `mysqldump`; ia memverifikasi hasilnya di tiga
# lapis, dari yang termurah ke yang termahal:
#
#   1. STRUKTUR — setiap BASE TABLE yang ada di server muncul sebagai
#      CREATE TABLE di dump, dan sebaliknya. Selisih sekecil apa pun = FAIL.
#   2. BARIS    — dump diambil dengan --skip-extended-insert, jadi satu baris
#      data = satu pernyataan INSERT. Jumlah INSERT per tabel dibandingkan
#      dengan COUNT(*) yang diambil dari server SEBELUM dump. Ini verifikasi
#      per-tabel yang tidak butuh server MySQL kedua.
#   3. TRIGGER  — CDPS menaruh 7 trigger imutabilitas di MySQL (aturan rumah #3:
#      audit_log/notifications/*_snapshots tidak punya jalur UPDATE/DELETE).
#      Dump yang kehilangan trigger adalah dump dari skema yang lebih lemah
#      daripada yang ia klaim — itu harus ketahuan sekarang, bukan saat restore.
#
#   opsional 4. RESTORE SUNGGUHAN — --verify-restore-into <url-mysql-kosong>
#      memuat ulang dump ke server lain lalu menghitung ulang seluruh tabel dan
#      membandingkannya dengan sumber. Ini satu-satunya lapis yang membuktikan
#      dump-nya benar-benar bisa dieksekusi, bukan cuma terlihat benar.
#
# Enkripsi WAJIB secara default. Repo ini publik (HANDOFF_CUTOVER_SESI24 §1.4)
# dan artifact GitHub Actions pada repo publik bisa diunduh siapa saja; dump
# produksi tanpa enkripsi di sana = kebocoran, bukan backup.
#
# Terhadap produksi skrip ini READ-ONLY (mysqldump --single-transaction; nol
# LOCK TABLES, nol tulis). Yang berbahaya di sini bukan tulisnya — melainkan
# ke mana berkas hasilnya pergi.
# ============================================================================
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/railway-mysql-common.sh
. "$HERE/lib/railway-mysql-common.sh"
trap rm_cleanup EXIT

URL=""
OUTDIR="."
LABEL="cdps"
RESTORE_URL=""
ENCRYPT="auto"     # auto = wajib kalau passphrase ada, gagal kalau tidak
KEEP_DEFINER=0
DEGRADED=""
DEFINER_NOTE=""

usage() {
  cat <<'EOF'
Pemakaian: scripts/railway-mysql-backup.sh [opsi]

  --url <mysql://…>            URL sumber. Default: $RAILWAY_MYSQL_URL,
                               lalu $MYSQL_PUBLIC_URL, lalu $MYSQL_URL.
  --outdir <dir>               Direktori hasil (default: direktori saat ini).
  --label <nama>               Awalan nama berkas (default: cdps).
  --verify-restore-into <url>  Muat ulang dump ke MySQL KOSONG ini lalu hitung
                               ulang dan bandingkan. Database tujuan HARUS sudah
                               ada dan HARUS bukan produksi — isinya ditimpa.
  --no-encrypt                 Hasilkan .sql.gz polos. Hanya untuk backup yang
                               tidak pernah meninggalkan mesin Anda.
  --keep-definer               Pertahankan klausa DEFINER=… pada trigger.
                               Default: dilucuti, karena kehadirannya membuat
                               restore GAGAL untuk user tanpa privilege SUPER.
  -h, --help                   Bantuan ini.

Enkripsi memakai $RAILWAY_BACKUP_PASSPHRASE (openssl aes-256-cbc, PBKDF2).
Tanpa passphrase dan tanpa --no-encrypt, skrip berhenti — itu disengaja.
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --url) URL="${2:-}"; shift 2 ;;
    --outdir) OUTDIR="${2:-}"; shift 2 ;;
    --label) LABEL="${2:-}"; shift 2 ;;
    --verify-restore-into) RESTORE_URL="${2:-}"; shift 2 ;;
    --no-encrypt) ENCRYPT="no"; shift ;;
    --keep-definer) KEEP_DEFINER=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) rm_die "Opsi tidak dikenal: $1" ;;
  esac
done

[ -n "$URL" ] || URL="${RAILWAY_MYSQL_URL:-${MYSQL_PUBLIC_URL:-${MYSQL_URL:-}}}"
[ -n "$URL" ] || rm_die "URL koneksi tidak diberikan (\$RAILWAY_MYSQL_URL atau --url)."

if [ "$ENCRYPT" = "auto" ] && [ -z "${RAILWAY_BACKUP_PASSPHRASE:-}" ]; then
  rm_die "RAILWAY_BACKUP_PASSPHRASE belum diisi.
   Dump ini memuat SELURUH isi DB produksi. Kalau ia akan menyeberang ke mana pun
   (artifact CI, cloud drive, chat), ia wajib terenkripsi.
   Simpan passphrase-nya di password manager SEBELUM menjalankan ulang — dump
   terenkripsi tanpa passphrase yang tersimpan sama saja dengan tidak punya backup.
   Sengaja tanpa enkripsi (berkas tidak akan meninggalkan mesin ini)? --no-encrypt."
fi

rm_require_client
rm_require_dump
rm_parse_url "$URL"
rm_write_cnf

SRC_HOST="$RM_HOST"; SRC_PORT="$RM_PORT"; SRC_DB="$RM_DB"; SRC_CNF="$RM_CNF"
STAMP="$(date -u '+%Y%m%dT%H%M%SZ')"
STAMP_ISO="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
mkdir -p "$OUTDIR"
BASE="$OUTDIR/${LABEL}-mysql-${SRC_DB}-${STAMP}"
DUMP="$BASE.sql"
MANIFEST="$BASE.manifest.md"

echo "== Backup MySQL Railway =="
echo "   database : $SRC_DB"
echo "   waktu    : $STAMP_ISO"
echo

BANNER="$(rm_connect_banner)"
SRV_VERSION="$(printf '%s' "$BANNER" | cut -f1)"
SRV_DB="$(printf '%s' "$BANNER" | cut -f2)"
echo "✅ tersambung — server $SRV_VERSION · DATABASE()=$SRV_DB"
[ "$SRV_DB" = "$SRC_DB" ] || rm_die "DATABASE() melaporkan '$SRV_DB', bukan '$SRC_DB'. Hentikan."

# ---------------------------------------------------------------------------
# Kebenaran acuan diambil SEBELUM dump. Menghitung sesudahnya membuat setiap
# perubahan yang terjadi selama dump tidak terlihat — dan dump --single-transaction
# adalah snapshot pada saat ia MULAI, bukan saat ia selesai.
# ---------------------------------------------------------------------------
SRC_ROWS="$RM_TMPDIR/src_rows.tsv"
SRC_TABLES="$RM_TMPDIR/src_tables.txt"
rm_row_counts >"$SRC_ROWS"
cut -f1 "$SRC_ROWS" | LC_ALL=C sort -u >"$SRC_TABLES"
SRC_TABLE_COUNT="$(wc -l <"$SRC_TABLES" | tr -d ' ')"
SRC_TOTAL=0
while IFS=$'\t' read -r _t n; do SRC_TOTAL=$(( SRC_TOTAL + n )); done <"$SRC_ROWS"

SRC_TRIGGERS="$(rm_q "SELECT COUNT(*) FROM information_schema.triggers WHERE trigger_schema = '$SRC_DB'")"

echo "   $SRC_TABLE_COUNT tabel · $SRC_TOTAL baris · $SRC_TRIGGERS trigger (acuan, diambil sebelum dump)"
[ "$SRC_TABLE_COUNT" -gt 0 ] || rm_die "Nol tabel di '$SRC_DB' — periksa URL/hak akses sebelum mem-backup apa pun." 2

# --- dump ------------------------------------------------------------------
# --skip-extended-insert: 1 baris data = 1 INSERT ⇒ verifikasi baris bisa
#   dilakukan atas berkasnya sendiri, tanpa server kedua.
# --no-tablespaces: menghindari kebutuhan privilege PROCESS (MySQL 8), yang
#   sering tidak dimiliki user selain root.
# Flag yang tidak dikenal klien setempat (mariadb-dump vs mysqldump) DIDETEKSI,
# bukan diasumsikan — perbedaan ini yang membuat runbook gagal di laptop lain.
DUMP_FLAGS=(--single-transaction --quick --hex-blob --skip-extended-insert
            --default-character-set=utf8mb4 --routines --triggers --events)
HELP="$(mysqldump --help 2>/dev/null || true)"
case "$HELP" in *--no-tablespaces*) DUMP_FLAGS+=(--no-tablespaces) ;; esac
case "$HELP" in *set-gtid-purged*) DUMP_FLAGS+=(--set-gtid-purged=OFF) ;; esac
case "$HELP" in *column-statistics*) DUMP_FLAGS+=(--column-statistics=0) ;; esac

echo
echo "→ mysqldump ${#DUMP_FLAGS[@]} flag …"
if ! mysqldump --defaults-file="$SRC_CNF" "${DUMP_FLAGS[@]}" "$SRC_DB" >"$DUMP" 2>"$RM_TMPDIR/dump.err"; then
  echo "   ⚠️  gagal dengan flag lengkap:"
  sed 's/^/      /' "$RM_TMPDIR/dump.err" >&2
  echo "   → mencoba ulang tanpa --routines/--events (privilege yang paling sering kurang) …"
  FALLBACK=()
  for f in "${DUMP_FLAGS[@]}"; do
    case "$f" in --routines|--events) continue ;; esac
    FALLBACK+=("$f")
  done
  mysqldump --defaults-file="$SRC_CNF" "${FALLBACK[@]}" "$SRC_DB" >"$DUMP" 2>"$RM_TMPDIR/dump2.err" \
    || rm_die "mysqldump tetap gagal: $(cat "$RM_TMPDIR/dump2.err")"
  DEGRADED="stored routine & event TIDAK ikut ter-dump (privilege kurang); tabel, data, dan trigger ikut"
  echo "   ⚠️  $DEGRADED"
fi

# ---------------------------------------------------------------------------
# DEFINER dilucuti — dan ini BUKAN kerapian.
#
# mysqldump menandai setiap trigger dengan DEFINER=`root`@`localhost`. Saat
# dipulihkan oleh user yang bukan root, MySQL menuntut privilege SUPER/SET USER
# dan restore MATI DI TENGAH JALAN (ERROR 1227) — sesudah sebagian tabel sudah
# masuk. Ditemukan oleh lapis 4 pada tulisan skrip ini, bukan diteorikan.
#
# Untuk CDPS identitas definer tidak memikul apa pun: ketujuh trigger hanya
# SIGNAL menolak UPDATE/DELETE (aturan rumah #3). Mempertahankannya hanya
# membuat backup lebih sulit dipulihkan, tepat pada hari ia dibutuhkan.
# --keep-definer menyimpan dump apa adanya untuk yang butuh fidelitas persis.
# ---------------------------------------------------------------------------
DEFINERS="$(grep -coE 'DEFINER=`[^`]+`@`[^`]+`' "$DUMP" || true)"
if [ "$KEEP_DEFINER" = "0" ] && [ "${DEFINERS:-0}" != "0" ]; then
  sed -E 's/DEFINER=`[^`]+`@`[^`]+`//g' "$DUMP" >"$DUMP.tmp" && mv "$DUMP.tmp" "$DUMP"
  DEFINER_NOTE="DEFINER dilucuti dari $DEFINERS objek supaya dump bisa dipulihkan tanpa privilege SUPER"
  echo "   $DEFINER_NOTE"
else
  DEFINER_NOTE="DEFINER dipertahankan ($DEFINERS objek) — restore butuh SUPER/SET USER"
fi

DUMP_BYTES="$(wc -c <"$DUMP" | tr -d ' ')"
echo "   dump: $DUMP ($DUMP_BYTES byte)"

# --- lapis 1: struktur -----------------------------------------------------
DUMP_TABLES="$RM_TMPDIR/dump_tables.txt"
grep -oE '^CREATE TABLE `[^`]+`' "$DUMP" | sed 's/^CREATE TABLE `//; s/`$//' | LC_ALL=C sort -u >"$DUMP_TABLES" || true
MISS_IN_DUMP="$(comm -23 "$SRC_TABLES" "$DUMP_TABLES" | tr '\n' ' ' | sed 's/ *$//')"
EXTRA_IN_DUMP="$(comm -13 "$SRC_TABLES" "$DUMP_TABLES" | tr '\n' ' ' | sed 's/ *$//')"

FAIL=0
echo
echo "— lapis 1 · struktur"
if [ -z "$MISS_IN_DUMP" ] && [ -z "$EXTRA_IN_DUMP" ]; then
  echo "  ✅ $SRC_TABLE_COUNT/$SRC_TABLE_COUNT tabel ada di dump, nol tabel asing"
else
  FAIL=1
  [ -n "$MISS_IN_DUMP" ]  && echo "  🔴 ADA DI SERVER, TIDAK DI DUMP : $MISS_IN_DUMP"
  [ -n "$EXTRA_IN_DUMP" ] && echo "  🔴 ADA DI DUMP, TIDAK DI SERVER : $EXTRA_IN_DUMP"
fi

# --- lapis 2: baris --------------------------------------------------------
DUMP_ROWS="$RM_TMPDIR/dump_rows.tsv"
awk -F'`' '/^INSERT INTO `/ {print $2}' "$DUMP" | LC_ALL=C sort | uniq -c \
  | awk '{print $2 "\t" $1}' | LC_ALL=C sort >"$DUMP_ROWS" || true

echo "— lapis 2 · baris (COUNT(*) server vs INSERT di dump)"
ROW_MISMATCH=""
while IFS=$'\t' read -r t n; do
  d="$(awk -F'\t' -v t="$t" '$1==t {print $2}' "$DUMP_ROWS")"
  d="${d:-0}"
  if [ "$d" != "$n" ]; then
    ROW_MISMATCH+="$t (server=$n dump=$d) "
    FAIL=1
  fi
done <"$SRC_ROWS"
if [ -z "$ROW_MISMATCH" ]; then
  echo "  ✅ $SRC_TOTAL/$SRC_TOTAL baris cocok di seluruh $SRC_TABLE_COUNT tabel"
else
  echo "  🔴 SELISIH: $ROW_MISMATCH"
fi

# --- lapis 3: trigger ------------------------------------------------------
DUMP_TRIGGERS="$(grep -cE '^\s*(/\*!50003 )?CREATE.*TRIGGER' "$DUMP" || true)"
echo "— lapis 3 · trigger imutabilitas (aturan rumah #3)"
if [ "$DUMP_TRIGGERS" = "$SRC_TRIGGERS" ]; then
  echo "  ✅ $DUMP_TRIGGERS/$SRC_TRIGGERS trigger ikut ter-dump"
else
  FAIL=1
  echo "  🔴 server punya $SRC_TRIGGERS trigger, dump memuat $DUMP_TRIGGERS"
fi

# --- lapis 4 (opsional): restore sungguhan ---------------------------------
RESTORE_NOTE="tidak dijalankan"
if [ -n "$RESTORE_URL" ]; then
  echo "— lapis 4 · restore sungguhan"
  rm_parse_url "$RESTORE_URL"
  if [ "$RM_HOST:$RM_PORT/$RM_DB" = "$SRC_HOST:$SRC_PORT/$SRC_DB" ]; then
    rm_die "Target restore SAMA dengan sumber. Menolak — itu menimpa produksi dengan dirinya sendiri."
  fi
  RESTORE_CNF="$RM_TMPDIR/restore.cnf"

  {
    printf '[client]\nhost=%s\nport=%s\nuser=%s\n' "$RM_HOST" "$RM_PORT" "$RM_USER"
    esc="${RM_PASS//\\/\\\\}"; printf 'password="%s"\n' "${esc//\"/\\\"}"
  } >"$RESTORE_CNF"
  chmod 600 "$RESTORE_CNF"

  # Target WAJIB kosong. Restore yang mati di tengah meninggalkan schema
  # separuh-terisi; kalau target ternyata berisi sesuatu yang berharga, kerusakan
  # itu permanen dan skrip ini yang menyebabkannya.
  RM_CNF="$RESTORE_CNF"
  DST_EXISTING="$(rm_base_tables | grep -c . || true)"
  RM_CNF="$SRC_CNF"
  if [ "$DST_EXISTING" != "0" ]; then
    RM_DB="$SRC_DB"
    rm_die "Database tujuan restore sudah memuat $DST_EXISTING tabel. Menolak menimpanya.
   Pakai database kosong yang memang sekali-pakai."
  fi

  mysql --defaults-file="$RESTORE_CNF" "$RM_DB" <"$DUMP" \
    || rm_die "Restore GAGAL — dump-nya tidak bisa dieksekusi. Ini justru temuan paling penting yang bisa dihasilkan skrip ini."

  RM_CNF="$RESTORE_CNF"            # rm_row_counts memakai RM_CNF/RM_DB
  DST_ROWS="$RM_TMPDIR/dst_rows.tsv"
  rm_row_counts | LC_ALL=C sort >"$DST_ROWS"
  DST_TRIGGERS="$(rm_q "SELECT COUNT(*) FROM information_schema.triggers WHERE trigger_schema = '$RM_DB'")"
  RM_CNF="$SRC_CNF"; RM_DB="$SRC_DB"

  if diff <(LC_ALL=C sort "$SRC_ROWS") "$DST_ROWS" >"$RM_TMPDIR/restore.diff"; then
    if [ "$DST_TRIGGERS" = "$SRC_TRIGGERS" ]; then
      RESTORE_NOTE="✅ LOLOS — $SRC_TABLE_COUNT tabel · $SRC_TOTAL baris · $SRC_TRIGGERS trigger identik sesudah restore"
      echo "  $RESTORE_NOTE"
    else
      FAIL=1
      RESTORE_NOTE="🔴 baris identik tapi trigger $DST_TRIGGERS ≠ $SRC_TRIGGERS"
      echo "  $RESTORE_NOTE"
    fi
  else
    FAIL=1
    RESTORE_NOTE="🔴 GAGAL — hitungan sesudah restore berbeda dari sumber"
    echo "  $RESTORE_NOTE"
    sed 's/^/     /' "$RM_TMPDIR/restore.diff"
  fi
fi

# --- kompresi, checksum, enkripsi ------------------------------------------
echo
gzip -9 -f "$DUMP"
GZ="$DUMP.gz"
GZ_BYTES="$(wc -c <"$GZ" | tr -d ' ')"
gzip -t "$GZ" || rm_die "Berkas .gz gagal uji integritas gzip."
FINAL="$GZ"
ENC_NOTE="tidak terenkripsi (--no-encrypt)"

if [ "$ENCRYPT" != "no" ]; then
  command -v openssl >/dev/null 2>&1 || rm_die "openssl tidak ada di PATH — tidak bisa mengenkripsi."
  ENC="$GZ.enc"
  openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -md sha512 -salt \
    -in "$GZ" -out "$ENC" -pass env:RAILWAY_BACKUP_PASSPHRASE
  # Dibuktikan bisa dibuka kembali SEKARANG, selagi passphrase-nya masih di
  # tangan. Backup terenkripsi yang tidak pernah diuji dekripsi adalah backup
  # yang kegagalannya baru ketahuan pada hari ia dibutuhkan.
  openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -md sha512 \
    -in "$ENC" -out "$RM_TMPDIR/roundtrip.gz" -pass env:RAILWAY_BACKUP_PASSPHRASE \
    || rm_die "Dekripsi uji GAGAL — jangan pakai berkas ini sebagai backup."
  if ! cmp -s "$GZ" "$RM_TMPDIR/roundtrip.gz"; then
    rm_die "Hasil dekripsi TIDAK identik dengan sumbernya."
  fi
  rm -f "$GZ"
  FINAL="$ENC"
  ENC_NOTE="aes-256-cbc · pbkdf2 600000 iterasi · sha512 · salted; round-trip dekripsi DIUJI dan identik"
  echo "🔒 terenkripsi + round-trip dekripsi terbukti identik"
fi

SHA="$(sha256sum "$FINAL" | cut -d' ' -f1)"
FINAL_BYTES="$(wc -c <"$FINAL" | tr -d ' ')"

{
  echo "# Manifest backup MySQL Railway — $STAMP_ISO"
  echo
  echo "| | |"
  echo "|---|---|"
  echo "| Berkas | \`$(basename "$FINAL")\` |"
  echo "| Ukuran | $FINAL_BYTES byte (sql $DUMP_BYTES → gz $GZ_BYTES) |"
  echo "| SHA-256 | \`$SHA\` |"
  echo "| Database | \`$SRC_DB\` · server \`$SRV_VERSION\` |"
  echo "| Tabel | $SRC_TABLE_COUNT |"
  echo "| Baris (total) | $SRC_TOTAL |"
  echo "| Trigger | $SRC_TRIGGERS |"
  echo "| Enkripsi | $ENC_NOTE |"
  echo "| Verifikasi struktur | $( [ -z "$MISS_IN_DUMP$EXTRA_IN_DUMP" ] && echo "✅ LOLOS" || echo "🔴 GAGAL" ) |"
  echo "| Verifikasi baris | $( [ -z "$ROW_MISMATCH" ] && echo "✅ LOLOS" || echo "🔴 GAGAL — $ROW_MISMATCH" ) |"
  echo "| Verifikasi trigger | $( [ "$DUMP_TRIGGERS" = "$SRC_TRIGGERS" ] && echo "✅ LOLOS" || echo "🔴 GAGAL" ) |"
  echo "| Restore sungguhan | $RESTORE_NOTE |"
  echo "| DEFINER | $DEFINER_NOTE |"
  [ -n "$DEGRADED" ] && echo "| ⚠️ Catatan | $DEGRADED |"
  echo
  echo "## Cara memulihkan"
  echo
  echo '```bash'
  if [ "$ENCRYPT" != "no" ]; then
    echo "openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -md sha512 \\"
    echo "  -in $(basename "$FINAL") -out dump.sql.gz -pass env:RAILWAY_BACKUP_PASSPHRASE"
    echo "gunzip dump.sql.gz"
  else
    echo "gunzip -k $(basename "$FINAL")"
  fi
  echo "mysql -h <host> -P <port> -u <user> -p <database> < dump.sql"
  echo '```'
  echo
  echo "Verifikasi ulang kapan pun: \`sha256sum $(basename "$FINAL")\` harus sama dengan di atas."
} >"$MANIFEST"

echo
echo "📦 $FINAL"
echo "   sha256 : $SHA"
echo "📄 $MANIFEST"

if [ "$FAIL" != "0" ]; then
  echo
  echo "🔴 SATU ATAU LEBIH LAPIS VERIFIKASI GAGAL — jangan catat butir 6 gate GO sebagai selesai."
  exit 3
fi
echo
echo "✅ SELESAI — dump terverifikasi $( [ -n "$RESTORE_URL" ] && echo "4" || echo "3" ) lapis."
