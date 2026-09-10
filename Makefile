# CDPS — root Makefile. Stack: TypeScript + Supabase/Postgres (`docs/DECISIONS.md`
# 2026-07-29 "Pensiun Go"). `backend/` (Go) sudah PINDAH ke `archive/backend-go/`
# sejak C-05 (2026-09-04) — arsip read-only, tidak dijalankan CI, tidak
# di-deploy. Jangan tambah target yang shell ke sana.
#
# Modul kerjanya: `apps/api` (route handler, Next.js) di atas `packages/domain`
# di atas `packages/core` + `packages/db`. Frontend: `web-internal` (internal)
# + `web-client-portal` (portal klien, realm auth terpisah). DB: Supabase/Postgres
# lokal via `scripts/db-rebuild.sh`; migrasi live HANYA lewat `apply_migration`
# per berkas — JANGAN `supabase db push` (O65).

.PHONY: install db-rebuild check-live-drift typecheck test test-domain test-core test-db test-api \
        build lint dev-api dev-web dev-portal

## install: install semua dependency workspace (root + web-internal + web-client-portal)
install:
	npm install
	cd web-internal && npm install
	cd web-client-portal && npm install

## db-rebuild: bangun ulang DB lokal DARI NOL (drop → migrasi → seed → gate → invariant)
##   Butuh DATABASE_URL, mis. postgres://postgres:postgres@127.0.0.1:5432/cdps
db-rebuild:
	bash scripts/db-rebuild.sh --yes

## check-live-drift: bandingkan supabase/migrations/** vs ledger live per-slug (B3)
##   Butuh LIVE_DATABASE_URL, atau SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF —
##   lihat kepala scripts/check-live-drift.sh. Kedua jalur itu membuka soket ke
##   Supabase sendiri, dan itu diblok kebijakan organisasi dari sandbox Claude
##   Code, jadi TARGET INI jalankan dari operator atau CI runner dengan akses
##   jaringan nyata ke Supabase.
##   DARI SANDBOX, pakai jalur ke-3 (bukan target ini): ambil ledger lewat MCP
##   Supabase `execute_sql`, simpan sebagai TSV `version<TAB>name`, lalu
##     LIVE_LEDGER_TSV=/path/ke/ledger.tsv bash scripts/check-live-drift.sh
##   Gerbang dan aturan pencocokannya persis sama; yang beda hanya asal ledger.
check-live-drift:
	bash scripts/check-live-drift.sh

## typecheck: tsc --noEmit di seluruh workspace root, plus kedua app frontend
typecheck:
	npm run typecheck --workspaces --if-present
	cd web-internal && npx tsc --noEmit
	cd web-client-portal && npx tsc --noEmit

## test: seluruh suite backend (core, db, domain, api) — JALANKAN SETELAH db-rebuild,
##   JANGAN paralel dengan test lain di atas DB yang sama (domain test
##   menghitung baris; dua run bersamaan = FAIL palsu)
test: test-core test-db test-domain test-api

## test-core: packages/core (murni, tanpa DB)
test-core:
	npx vitest run --root packages/core

## test-db: packages/db (registry dual-home, butuh DB)
test-db:
	npx vitest run --root packages/db

## test-domain: packages/domain — SENDIRIAN, sesudah db-rebuild, bukan bersamaan
test-domain:
	npx vitest run --root packages/domain

## test-api: apps/api (route handler + route-parity + shape-parity)
test-api:
	npx vitest run --root apps/api

## build: build produksi apps/api + kedua frontend
build:
	npm run build -w @cdps/api
	cd web-internal && npm run build
	cd web-client-portal && npm run build

## lint: eslint kedua frontend (apps/api tidak punya halaman, dicek typecheck)
lint:
	cd web-internal && npm run lint
	cd web-client-portal && npm run lint

## dev-api: jalankan apps/api (Next.js route handlers) secara lokal
dev-api:
	npm run dev -w @cdps/api

## dev-web: jalankan web-internal (workspaces/boards/dashboards)
dev-web:
	cd web-internal && npm run dev

## dev-portal: jalankan web-client-portal (portal klien, realm auth terpisah)
dev-portal:
	cd web-client-portal && npm run dev
