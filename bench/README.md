# `bench/` — harness pengukuran P-1 (lokal saja)

Bukan bagian dari aplikasi, bukan bagian dari CI, tidak pernah dideploy. Ini alat
untuk **mengukur sebelum mengubah**, karena handoff P-1 mensyaratkan angka
before/after dan bukan tebakan.

Yang diukur adalah **jumlah query per pembacaan**, bukan wall-clock. Itu disengaja:
CDPS lambat karena *latency-bound* (tiap query = satu round-trip ke pooler
Supabase), sementara Postgres lokal menjawab dalam ~0.05 ms lewat socket — jadi
stopwatch lokal justru MENYEMBUNYIKAN masalah yang sedang diperbaiki. Jumlah
round-trip deterministik dan berkorelasi langsung dengan latensi produksi.

## Pakai

```bash
# 1. DB lokal bersih dari migrasi repo
scripts/db-rebuild.sh --yes

# 2. DB terpisah untuk benchmark — JANGAN pakai DB yang dipakai test.
#    Baris sintetis di sini membuat test yang meng-assert hitungan absolut merah.
export PGPASSWORD=postgres
psql -h 127.0.0.1 -U postgres -d postgres -c 'drop database if exists cdps_bench'
psql -h 127.0.0.1 -U postgres -d postgres -c 'create database cdps_bench template cdps'
psql -h 127.0.0.1 -U postgres -d cdps_bench -f bench/seed-bench.sql

# 3. Ukur
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps_bench" npx tsx bench/bench.ts
DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/cdps_bench" npx tsx bench/claims-bench.ts
```

## Isi

| Berkas | Apa |
|---|---|
| `seed-bench.sql` | Beban sintetis: 25 klien × 2 layanan × 3 brief × 3 asset + booking, komplain, campaign, metric entry, dan baris transisi `audit_log`. Cukup untuk membuat N+1 terlihat, cukup kecil untuk dimuat dalam hitungan detik. |
| `bench.ts` | Hitung query + wall-clock untuk pembacaan terpanas (`health.portfolio`, `health.preview`, `performance.previewCurrent` per role, `teamRollup`). |
| `claims-bench.ts` | Biaya tetap amplop klaim RLS (`withClaims`) per pembacaan — SET berurutan vs ter-pipeline. |

## Yang TIDAK dijamin harness ini

Ia mengukur lapisan domain terhadap Postgres lokal. Ia **tidak** mengukur p95
produksi: hop `browser → web-internal → apps/api → pooler` dan RTT lintas-region
tidak ada di sini. Untuk angka produksi, pakai Vercel Analytics / Supabase
`query_logs` pada deployment yang sebenarnya.
