package hris_test

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/events"
	"github.com/meagrup/agencyapp/backend/internal/core/hris"
)

// fakeDirectory is a mutable in-memory HRIS employee directory shared by both
// the CSV and HTTP source test constructors, so the exact same scenario
// (including live mutations between Sync calls) can be run against either
// EmployeeSource with zero changes to the Syncer or the test body — this is
// the "swap CSV<->HTTP source with zero consumer changes" AC.
type fakeDirectory struct {
	mu   sync.Mutex
	data []hris.Employee
	// failNext, when > 0, makes the next N Fetch calls fail (simulating HRIS
	// being unreachable), decrementing on each failure.
	failNext int
}

func newFakeDirectory(employees ...hris.Employee) *fakeDirectory {
	return &fakeDirectory{data: append([]hris.Employee(nil), employees...)}
}

func (d *fakeDirectory) set(employees []hris.Employee) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.data = append([]hris.Employee(nil), employees...)
}

func (d *fakeDirectory) failNextCalls(n int) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.failNext = n
}

func (d *fakeDirectory) snapshot(updatedSince time.Time) ([]hris.Employee, bool) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.failNext > 0 {
		d.failNext--
		return nil, true
	}
	var out []hris.Employee
	for _, e := range d.data {
		if updatedSince.IsZero() || !e.UpdatedAt.Before(updatedSince) {
			out = append(out, e)
		}
	}
	return out, false
}

// newCSVSourceFor builds a CSVSource that renders the directory's current
// state to CSV fresh on every Fetch call.
func newCSVSourceFor(t *testing.T, dir *fakeDirectory) hris.EmployeeSource {
	t.Helper()
	return &hris.CSVSource{
		Open: func() (io.ReadCloser, error) {
			emps, fail := dir.snapshot(time.Time{}) // CSVSource itself filters by updatedSince; hand it everything.
			if fail {
				return nil, fmt.Errorf("simulated HRIS/source outage")
			}
			var b strings.Builder
			w := csv.NewWriter(&b)
			_ = w.Write([]string{"employee_id", "nama", "email", "divisi", "jabatan", "status_aktif", "updated_at"})
			for _, e := range emps {
				_ = w.Write([]string{
					e.EmployeeID, e.Nama, e.Email, e.Divisi, e.Jabatan,
					strconv.FormatBool(e.StatusAktif), e.UpdatedAt.UTC().Format(time.RFC3339Nano),
				})
			}
			w.Flush()
			return io.NopCloser(strings.NewReader(b.String())), nil
		},
	}
}

// newHTTPSourceFor spins an httptest server implementing the
// GET /api/v1/employees contract (pagination + updated_since) over the
// directory's current state, and returns an HTTPSource pointed at it.
func newHTTPSourceFor(t *testing.T, dir *fakeDirectory) hris.EmployeeSource {
	t.Helper()

	const pageSize = 2 // small, to exercise pagination in tests
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/employees" {
			http.NotFound(w, r)
			return
		}
		if r.Header.Get("Authorization") != "Bearer test-service-token" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var since time.Time
		if v := r.URL.Query().Get("updated_since"); v != "" {
			parsed, err := time.Parse(time.RFC3339, v)
			if err != nil {
				http.Error(w, "bad updated_since", http.StatusBadRequest)
				return
			}
			since = parsed
		}

		all, fail := dir.snapshot(since)
		if fail {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		page, _ := strconv.Atoi(r.URL.Query().Get("page"))
		if page < 1 {
			page = 1
		}
		start := (page - 1) * pageSize
		end := start + pageSize
		if start > len(all) {
			start = len(all)
		}
		if end > len(all) {
			end = len(all)
		}
		chunk := all[start:end]

		type row struct {
			EmployeeID  string `json:"employee_id"`
			Nama        string `json:"nama"`
			Email       string `json:"email"`
			Divisi      string `json:"divisi"`
			Jabatan     string `json:"jabatan"`
			StatusAktif bool   `json:"status_aktif"`
			UpdatedAt   string `json:"updated_at"`
		}
		resp := struct {
			Data     []row `json:"data"`
			Page     int   `json:"page"`
			PageSize int   `json:"page_size"`
			Total    int   `json:"total"`
		}{Page: page, PageSize: pageSize, Total: len(all)}
		for _, e := range chunk {
			resp.Data = append(resp.Data, row{
				EmployeeID: e.EmployeeID, Nama: e.Nama, Email: e.Email, Divisi: e.Divisi, Jabatan: e.Jabatan,
				StatusAktif: e.StatusAktif, UpdatedAt: e.UpdatedAt.UTC().Format(time.RFC3339Nano),
			})
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	}))
	t.Cleanup(srv.Close)

	return &hris.HTTPSource{
		BaseURL:      srv.URL,
		ServiceToken: "test-service-token",
		PageSize:     pageSize,
	}
}

// recordingBus is a minimal events.Bus that records every published event,
// for assertions, without depending on internal/core/events' InMemoryBus
// dispatch semantics.
type recordingBus struct {
	mu     sync.Mutex
	events []eventRecord
}

type eventRecord struct {
	Name       string
	EntityType string
	EntityID   string
	Payload    map[string]any
}

func (b *recordingBus) Publish(_ context.Context, e events.Event) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.events = append(b.events, eventRecord{Name: e.Name, EntityType: e.EntityType, EntityID: e.EntityID, Payload: e.Payload})
}

func (b *recordingBus) Subscribe(string, events.Handler) {}

var _ events.Bus = (*recordingBus)(nil)

func (b *recordingBus) count(name string) int {
	b.mu.Lock()
	defer b.mu.Unlock()
	n := 0
	for _, e := range b.events {
		if e.Name == name {
			n++
		}
	}
	return n
}

func (b *recordingBus) namesFor(entityType string) []string {
	b.mu.Lock()
	defer b.mu.Unlock()
	var out []string
	for _, e := range b.events {
		if e.EntityType == entityType {
			out = append(out, e.EntityID)
		}
	}
	return out
}
