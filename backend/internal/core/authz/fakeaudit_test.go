package authz_test

import (
	"context"
	"sync"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
	"github.com/meagrup/agencyapp/backend/internal/core/db"
)

// fakeAuditLogger is a recording fake for audit.Logger, used instead of the
// real MySQL-backed implementation (which is owned by a different agent and
// built concurrently). It satisfies the frozen audit.Logger interface.
type fakeAuditLogger struct {
	mu      sync.Mutex
	entries []audit.Entry
	nextID  int64
}

var _ audit.Logger = (*fakeAuditLogger)(nil)

func (f *fakeAuditLogger) Append(_ context.Context, _ db.Queryer, e audit.Entry) (int64, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.nextID++
	f.entries = append(f.entries, e)
	return f.nextID, nil
}

func (f *fakeAuditLogger) List(_ context.Context, _ db.Queryer, filter audit.Filter) ([]audit.Record, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []audit.Record
	for i, e := range f.entries {
		if filter.EntityType != "" && filter.EntityType != e.EntityType {
			continue
		}
		if filter.EntityID != "" && filter.EntityID != e.EntityID {
			continue
		}
		if filter.Actor != "" && filter.Actor != e.Actor {
			continue
		}
		if filter.Action != "" && filter.Action != e.Action {
			continue
		}
		out = append(out, audit.Record{ID: int64(i + 1), Entry: e})
	}
	return out, nil
}

func (f *fakeAuditLogger) all() []audit.Entry {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]audit.Entry, len(f.entries))
	copy(out, f.entries)
	return out
}
