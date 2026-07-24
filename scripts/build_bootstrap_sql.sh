#!/usr/bin/env bash
# Build a single paste-once bootstrap SQL = every supabase/migrations/*.sql in
# order. For first-time setup of an EMPTY Supabase project when `supabase db
# push` (the preferred, history-tracking path) is not being used. Output is
# derived — not committed. See docs/GO_LIVE_RUNBOOK.md.
#
# Usage: scripts/build_bootstrap_sql.sh [out.sql]   (default: ./cdps_bootstrap.sql)
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="${1:-cdps_bootstrap.sql}"
{
  echo "-- CDPS bootstrap — SEMUA migrasi supabase/migrations/*.sql berurutan, digabung."
  echo "-- Tempel SEKALI di Supabase SQL editor (service-role) pada project KOSONG."
  echo "-- Alternatif lebih rapi: 'supabase db push' (menjaga migration history)."
  echo "-- Dihasilkan oleh scripts/build_bootstrap_sql.sh — jangan diedit manual."
  echo
  for f in $(ls supabase/migrations/*.sql | sort); do
    echo "-- ================================================================"
    echo "-- $(basename "$f")"
    echo "-- ================================================================"
    cat "$f"
    echo
  done
} > "$OUT"
echo "wrote $OUT ($(wc -l < "$OUT") lines, $(ls supabase/migrations/*.sql | wc -l) migrations)"
