# CDPS — root Makefile. Backend targets shell into backend/ ; the frontend
# agent owns web-internal/ (run-web is a placeholder).

GO ?= go
BACKEND_DIR := backend
CDPS_DSN ?= cdps:cdps_dev@tcp(127.0.0.1:3306)/cdps?parseTime=true&multiStatements=true
CDPS_TEST_DSN ?= cdps:cdps_dev@tcp(127.0.0.1:3306)/cdps_test?parseTime=true&multiStatements=true

.PHONY: test migrate-up migrate-down seed run-backend run-mockhris run-web vet build tidy

## test: run backend tests (packages serialized so DB-backed tests don't collide)
test:
	cd $(BACKEND_DIR) && CDPS_TEST_DSN="$(CDPS_TEST_DSN)" $(GO) test -p 1 -count=1 ./...

## vet: go vet the backend
vet:
	cd $(BACKEND_DIR) && $(GO) vet ./...

## build: compile all backend binaries
build:
	cd $(BACKEND_DIR) && $(GO) build ./...

## tidy: go mod tidy
tidy:
	cd $(BACKEND_DIR) && $(GO) mod tidy

## migrate-up: apply all pending migrations
migrate-up:
	cd $(BACKEND_DIR) && CDPS_DSN="$(CDPS_DSN)" $(GO) run ./cmd/migrate up

## migrate-down: roll back the most recent migration (use ARGS=all for everything)
migrate-down:
	cd $(BACKEND_DIR) && CDPS_DSN="$(CDPS_DSN)" $(GO) run ./cmd/migrate down $(ARGS)

## seed: load the Alpha Digital worked-example fixture (idempotent)
seed:
	cd $(BACKEND_DIR) && CDPS_DSN="$(CDPS_DSN)" $(GO) run ./cmd/seed

## run-backend: run the CDPS API server (auto-migrates on boot)
run-backend:
	cd $(BACKEND_DIR) && CDPS_DSN="$(CDPS_DSN)" $(GO) run ./cmd/cdps

## run-mockhris: run the dev-only mock HRIS (contract endpoints from seed CSV)
run-mockhris:
	cd $(BACKEND_DIR) && $(GO) run ./cmd/mockhris

## run-web: placeholder — the frontend agent owns web-internal/
run-web:
	@echo "web-internal/ is owned by the frontend agent."
	@echo "Once it exists:  cd web-internal && npm ci && npm run dev"
