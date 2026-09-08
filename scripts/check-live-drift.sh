#!/usr/bin/env bash
# =============================================================================
# Bandingkan supabase/migrations/**  (repo, "main" adalah sumber kebenaran)
# terhadap  supabase_migrations.schema_migrations  (ledger live) — B3,
# HANDOFF_PENUTUP_REVISI_OD_LANJUT_20260908.md §3.
#
# KENAPA INI ADA. A-req-3 (`private.brief_jumlah_anak`, migrasi
# `20260922100500`) hilang dari live berbulan-bulan tanpa satu sinyal merah —
# tes domain memakai koneksi service-role dan buta terhadap kelas cacat
# "migrasi ada di repo, belum di-apply ke live". Ditemukan lewat pembandingan
# MANUAL repo↔live (A2, 2026-09-08). Skrip ini membuat pembandingan itu bisa
# diulang satu perintah, alih-alih ketik ulang query tiap kali.
#
# ATURAN PENCOCOKAN — per-SLUG, BUKAN per-nomor (O65). `version` di ledger live
# adalah stempel waktu APPLY, bukan prefix nama berkas repo — keduanya sering
# tidak cocok walau isinya sama persis. Sebagian baris ledger live bahkan
# menyimpan nama berkas ASLI (dengan timestamp lama sendiri) di kolom `name`,
# bukan cuma slug — jadi normalisasinya: lucuti SATU prefix numerik terkemuka
# (angka+underscore) dari kedua sisi, apa pun panjangnya, baru bandingkan.
#
# DUA ARAH DRIFT:
#   - MISSING ON LIVE  (ada di repo, slug-nya TIDAK ada di live)
#       ⇒ cacat nyata: migrasi belum ter-apply, kode mengasumsikan skema yang
#         live tidak punya. Skrip SELALU keluar tidak-nol untuk ini.
#   - EXTRA ON LIVE    (ada di live, slug-nya TIDAK ada di repo)
#       ⇒ live punya sesuatu yang repo tidak punya riwayatnya — bisa migrasi
#         yang belum di-back-port (lihat A2-DRIFT, DECISIONS.md), bisa juga
#         baris ledger duplikat dari apply ganda lama (lihat catatan
#         `m6a_section_d`, DECISIONS.md 2026-09-06). Dicocokkan dulu terhadap
#         `scripts/known-live-drift.txt` (anomali yang SUDAH dicatat di
#         DECISIONS.md) — hanya slug yang BUKAN anggota allowlist itu yang
#         membuat skrip keluar tidak-nol. Anomali baru selalu harus dicatat
#         di DECISIONS.md, bukan didiamkan lewat allowlist tanpa entri.
#
# JALUR KONEKSI KE LIVE (pilih salah satu; skrip tidak menebak):
#   1. LIVE_DATABASE_URL   — connection string Postgres langsung (psql).
#      Contoh: postgres://postgres:***@db.<ref>.supabase.co:5432/postgres
#   2. SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF — Management API
#      (POST /v1/projects/<ref>/database/query), lewat curl+jq.
#
# CATATAN SANDBOX (2026-09-08): dari sesi Claude Code di lingkungan sandbox
# ini, KEDUA jalur di atas TIDAK bisa dicoba — egress proxy menolak CONNECT ke
# `api.supabase.com:443` (403, kebijakan organisasi) dan koneksi TCP langsung
# ke `*.supabase.co:5432`/`:6543` time-out (tidak ada di allowlist proxy).
# Dari sandbox seperti ini, JALUR YANG BEKERJA adalah `mcp__Supabase__list_
# migrations` (MCP, bukan skrip shell) — itulah yang dipakai A2 untuk apply
# empat migrasi tertinggal, dan langkah manualnya didokumentasikan di §3
# handoff ini. Skrip ini untuk operator/CI runner yang PUNYA akses jaringan
# nyata ke Supabase (laptop pemilik, atau runner dengan egress yang diizinkan)
# — logika pencocokannya sudah diuji (lihat commit ini) terhadap data live
# sungguhan yang diambil lewat MCP, bukan cuma data sintetis.
#
# PEMAKAIAN
#   LIVE_DATABASE_URL="postgres://…" scripts/check-live-drift.sh
#   SUPABASE_ACCESS_TOKEN=… SUPABASE_PROJECT_REF=egddxfcnrtecheiykhlf \
#     scripts/check-live-drift.sh
#   scripts/check-live-drift.sh --strict   # EXTRA ON LIVE yang belum di-
#                                           # allowlist juga bikin exit tidak-nol
# =============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."
MIG_DIR="supabase/migrations"
ALLOWLIST="scripts/known-live-drift.txt"
STRICT="no"
[[ "${1:-}" == "--strict" ]] && STRICT="yes"

[[ -d "$MIG_DIR" ]] || { echo "FATAL: $MIG_DIR tidak ada — jalankan dari dalam repo." >&2; exit 1; }

# --- ambil ledger live -------------------------------------------------------
LIVE_TSV="$(mktemp)"
trap 'rm -f "$LIVE_TSV"' EXIT

if [[ -n "${LIVE_DATABASE_URL:-}" ]]; then
  echo "→ ambil ledger live lewat psql (LIVE_DATABASE_URL)" >&2
  psql "$LIVE_DATABASE_URL" -v ON_ERROR_STOP=1 -tA -F"$(printf '\t')" \
    -c "select version, name from supabase_migrations.schema_migrations order by version" \
    > "$LIVE_TSV"
elif [[ -n "${SUPABASE_ACCESS_TOKEN:-}" && -n "${SUPABASE_PROJECT_REF:-}" ]]; then
  echo "→ ambil ledger live lewat Management API (SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF)" >&2
  curl -sS -X POST \
    "https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/database/query" \
    -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
    -H "Content-Type: application/json" \
    -d '{"query":"select version, name from supabase_migrations.schema_migrations order by version"}' \
    | jq -r '.[] | [.version, .name] | @tsv' \
    > "$LIVE_TSV"
else
  echo "FATAL: tidak ada jalur koneksi ke live." >&2
  echo "       Set LIVE_DATABASE_URL, atau SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF." >&2
  echo "       Dari sesi Claude Code di sandbox ini, jalur ini biasanya TIDAK tersedia" >&2
  echo "       (lihat catatan sandbox di kepala skrip) — pakai mcp__Supabase__list_migrations" >&2
  echo "       + langkah manual §3 handoff sebagai gantinya." >&2
  exit 1
fi

[[ -s "$LIVE_TSV" ]] || { echo "FATAL: ledger live kosong atau gagal dibaca." >&2; exit 1; }
echo "  $(wc -l < "$LIVE_TSV") baris ledger live" >&2

# --- normalisasi: lucuti SATU prefix numerik terkemuka ("<digit+>_") --------
strip_prefix() { sed -E 's/^[0-9]+_//'; }

REPO_SLUGS="$(mktemp)"; LIVE_SLUGS="$(mktemp)"
trap 'rm -f "$LIVE_TSV" "$REPO_SLUGS" "$LIVE_SLUGS"' EXIT

ls "$MIG_DIR"/*.sql | xargs -n1 basename | sed 's/\.sql$//' | strip_prefix | sort -u > "$REPO_SLUGS"
cut -f2 "$LIVE_TSV" | strip_prefix | sort -u > "$LIVE_SLUGS"

MISSING_ON_LIVE="$(comm -23 "$REPO_SLUGS" "$LIVE_SLUGS" || true)"
EXTRA_ON_LIVE="$(comm -13 "$REPO_SLUGS" "$LIVE_SLUGS" || true)"

# --- allowlist untuk EXTRA ON LIVE yang sudah dicatat di DECISIONS.md -------
KNOWN_EXTRA=""
if [[ -f "$ALLOWLIST" ]]; then
  KNOWN_EXTRA="$(grep -vE '^\s*(#|$)' "$ALLOWLIST" | sort -u || true)"
fi
NEW_EXTRA=""
if [[ -n "$EXTRA_ON_LIVE" ]]; then
  NEW_EXTRA="$(comm -23 <(echo "$EXTRA_ON_LIVE") <(echo "$KNOWN_EXTRA") || true)"
fi

STATUS=0

echo ""
if [[ -n "$MISSING_ON_LIVE" ]]; then
  echo "❌ MISSING ON LIVE — ada di repo, BELUM ter-apply ke live:"
  echo "$MISSING_ON_LIVE" | sed 's/^/   - /'
  STATUS=1
else
  echo "✓ nol migrasi repo yang tertinggal dari live."
fi

echo ""
if [[ -n "$EXTRA_ON_LIVE" ]]; then
  echo "🟡 EXTRA ON LIVE — ada di live, tidak ada berkas repo yang cocok:"
  echo "$EXTRA_ON_LIVE" | while IFS= read -r slug; do
    [[ -z "$slug" ]] && continue
    if echo "$KNOWN_EXTRA" | grep -qxF "$slug"; then
      echo "   - $slug   (sudah di-allowlist — lihat DECISIONS.md)"
    else
      echo "   - $slug   ⚠️  BARU, belum di-allowlist"
    fi
  done
  if [[ -n "$NEW_EXTRA" ]]; then
    echo "   ⇒ catat di docs/DECISIONS.md dulu (kelas A2-DRIFT), baru tambahkan ke $ALLOWLIST."
    [[ "$STRICT" == "yes" ]] && STATUS=1
  fi
else
  echo "✓ nol migrasi live tanpa berkas repo yang cocok."
fi

echo ""
if [[ "$STATUS" == "0" ]]; then
  echo "✅ GERBANG LOLOS — repo dan live sinkron (drift ter-allowlist tidak menghitung)."
else
  echo "❌ GERBANG GAGAL — lihat detail di atas."
fi
exit "$STATUS"
