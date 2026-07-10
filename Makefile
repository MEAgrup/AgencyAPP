.PHONY: test build lint migrate-up migrate-down seed

GO := cd backend && go

build:
	$(GO) build ./...

test:
	$(GO) test ./...

lint:
	$(GO) vet ./...

# Local dev DB (see docs/DEV_ENVIRONMENT.md)
DEV_DSN ?= cdps:cdps@tcp(127.0.0.1:3306)/cdps_dev?multiStatements=true

migrate-up:
	$(GO) run ./cmd/migrate -dsn "$(DEV_DSN)" -dir up

migrate-down:
	$(GO) run ./cmd/migrate -dsn "$(DEV_DSN)" -dir down

seed:
	$(GO) run ./cmd/seed -dsn "$(DEV_DSN)"
