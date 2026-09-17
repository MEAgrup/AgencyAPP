#!/usr/bin/env bash
# =============================================================================
# GERBANG: nomor versi migrasi tidak boleh bertabrakan LAGI.
#
# KENAPA INI ADA. `supabase/migrations/**` sudah memuat SEBELAS pasang berkas
# yang berbagi prefix versi yang sama — pasangan pertama sejak 2026-09-01.
# Penyebabnya struktural, bukan kecerobohan: repo ini dikerjakan beberapa aliran
# paralel (lih. `docs/handoff/PARALEL_M16_DUA_AKUN.md`), dan dua orang yang
# bercabang dari `main` yang sama pada hari yang sama akan memilih nomor
# berikutnya yang sama pula. Tidak ada yang menabraknya sampai seseorang
# menjalankan Supabase CLI.
#
# AKIBATNYA, DIVERIFIKASI LANGSUNG (2026-09-17, supabase CLI 2.117.0, DB kosong):
#
#   Applying migration 20260901010000_lt1_am_review_weight.sql...
#   Applying migration 20260901010000_rls_sales_lead_scope.sql...
#   ERROR: duplicate key value violates unique constraint "schema_migrations_pkey"
#   Key (version)=(20260901010000) already exists.
#
# `supabase db push` MATI di pasangan PERTAMA. CLI memakai 14 digit pertama nama
# berkas sebagai PRIMARY KEY `supabase_migrations.schema_migrations`, jadi dua
# berkas dengan prefix sama adalah satu baris yang ditulis dua kali.
#
# YANG TIDAK TERSENTUH — dan itulah kenapa ini tidak pernah ketahuan:
#   * CI (`db-and-migrations`) memakai `ls supabase/migrations/*.sql | sort`,
#     yaitu urut NAMA PENUH. Duplikat prefix tetap terurut deterministik
#     (`…_g4_02_…` sebelum `…_rls_head_…`), jadi CI hijau dan tetap hijau.
#   * `scripts/db-rebuild.sh` memakai pola yang sama.
#   * Produksi (`CDPS SG`) diterapkan lewat `apply_migration`, yang memberi
#     versi timestamp SAAT PENERAPAN, bukan prefix berkas — jadi riwayat di sana
#     utuh dan tidak punya duplikat sama sekali.
#
# KENAPA SEBELASNYA TIDAK DINOMORI ULANG (keputusan `docs/DECISIONS.md`
# 2026-09-17). Kesebelas nomor itu dirujuk 132 kali di `docs/`,
# `supabase/tests/`, dan kode — dan setiap rujukan itu AMBIGU justru karena
# nomornya dipakai berdua. Menomori ulang berarti menafsir ulang 132 rujukan
# satu per satu; satu salah tafsir menghasilkan dokumen yang menunjuk migrasi
# yang KELIRU, yang lebih berbahaya daripada `db push` yang mati — apalagi
# `db push` bukan jalur yang dipakai repo ini (tidak ada `supabase/config.toml`,
# dan produksi memakai `apply_migration`).
#
# JADI GERBANG INI TIDAK MENYEMBUHKAN YANG LAMA. Ia mencegah yang KEDUA BELAS,
# dan membuat sebelas yang ada berhenti menjadi pengetahuan lisan.
#
# ATURAN daftar `SUDAH_ADA` di bawah — sama dengan ledger O48 di
# `supabase/tests/rls_checks.sql` §42: ia hanya boleh MENYUSUT. Bertambah satu
# baris = sebuah migrasi baru mendarat di nomor yang sudah terpakai; perbaiki
# NOMOR MIGRASINYA, jangan tambahkan barisnya ke sini.
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

MIG_DIR="supabase/migrations"
[[ -d "$MIG_DIR" ]] || { echo "FATAL: $MIG_DIR tidak ada — jalankan dari dalam repo." >&2; exit 1; }

# Sebelas pasang yang SUDAH ADA sebelum gerbang ini dipasang (2026-09-17).
SUDAH_ADA="20260901010000
20260901020000
20260901030000
20260901040000
20260925010000
20260925020000
20260925030000
20260925040000
20261020010000
20261021010000
20261110010000"

AKTUAL="$(ls "$MIG_DIR"/*.sql | sed 's|.*/||' | cut -c1-14 | sort | uniq -d)"

BARU="$(comm -13 <(echo "$SUDAH_ADA" | sort) <(echo "$AKTUAL" | sort) | sed '/^$/d')"
HILANG="$(comm -23 <(echo "$SUDAH_ADA" | sort) <(echo "$AKTUAL" | sort) | sed '/^$/d')"

status=0

if [[ -n "$BARU" ]]; then
  status=1
  echo "❌ TABRAKAN NOMOR MIGRASI BARU:" >&2
  while read -r v; do
    [[ -z "$v" ]] && continue
    echo "   $v dipakai oleh:" >&2
    ls "$MIG_DIR/${v}"_*.sql | sed 's|.*/|     |' >&2
  done <<< "$BARU"
  cat >&2 <<'MSG'

   `supabase db push` memakai 14 digit pertama nama berkas sebagai PRIMARY KEY
   dan akan gagal dengan SQLSTATE 23505. Beri migrasi baru Anda nomor yang
   BELUM dipakai — JANGAN tambahkan barisnya ke `SUDAH_ADA` di skrip ini.
MSG
fi

if [[ -n "$HILANG" ]]; then
  status=1
  echo "ℹ️  Daftar SUDAH_ADA MENYUSUT (bagus) — tabrakan ini sudah tidak ada lagi:" >&2
  echo "$HILANG" | sed 's/^/   /' >&2
  echo "   Hapus barisnya dari \`SUDAH_ADA\` di skrip ini, di commit yang SAMA." >&2
fi

if [[ $status -eq 0 ]]; then
  echo "✓ nomor migrasi: nol tabrakan baru ($(echo "$SUDAH_ADA" | wc -l | tr -d ' ') pasang lama terdaftar)"
fi
exit $status
