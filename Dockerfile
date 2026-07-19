# CDPS backend — Railway deploy image.
# Multi-stage: build the cdps API server, then ship a slim runtime that also
# carries the SQL migrations (the server auto-migrates on boot).

# ---- build stage ----
FROM golang:1.24-alpine AS build
WORKDIR /src

# Module files first for a cached dependency layer.
COPY backend/go.mod backend/go.sum ./backend/
WORKDIR /src/backend
RUN go mod download

# Source.
COPY backend/ ./

# Static binary so it runs on the slim runtime image.
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/cdps ./cmd/cdps

# ---- runtime stage ----
FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata && adduser -D -u 10001 cdps
WORKDIR /app

COPY --from=build /out/cdps /app/cdps
# Migrations are read at runtime; CDPS_MIGRATIONS_DIR points the server at them.
COPY --from=build /src/backend/migrations /app/migrations

ENV CDPS_MIGRATIONS_DIR=/app/migrations
USER cdps

# The server binds $PORT when Railway provides it (falls back to :8080).
EXPOSE 8080
ENTRYPOINT ["/app/cdps"]
