package seed

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
	"github.com/meagrup/agencyapp/backend/internal/core/authz"
	"github.com/meagrup/agencyapp/backend/internal/core/db"
	"github.com/meagrup/agencyapp/backend/internal/core/events"
	"github.com/meagrup/agencyapp/backend/internal/core/msg"
	"github.com/meagrup/agencyapp/backend/internal/core/msl"
	"github.com/meagrup/agencyapp/backend/internal/core/notify"
	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
	"github.com/meagrup/agencyapp/backend/internal/core/testdb"
)

// TestSprint0Smoke is the CI rehearsal of the S0-12 exit demo: seed the
// fixture, resolve HRIS-synced employees to mapped roles, walk a dummy entity
// through a state machine with a blocked transition + BI message + full audit
// trail, and land a notification in-app.
func TestSprint0Smoke(t *testing.T) {
	conn := testdb.New(t)
	ctx := context.Background()

	if err := Seed(ctx, conn); err != nil {
		t.Fatalf("first Seed: %v", err)
	}

	t.Run("idempotent re-run", func(t *testing.T) {
		counts := func() (emp, maps, ovr, entries, versions, auditRows int) {
			for q, dst := range map[string]*int{
				"SELECT COUNT(*) FROM employees":              &emp,
				"SELECT COUNT(*) FROM role_mappings":          &maps,
				"SELECT COUNT(*) FROM role_overrides":         &ovr,
				"SELECT COUNT(*) FROM service_entries":        &entries,
				"SELECT COUNT(*) FROM service_entry_versions": &versions,
				"SELECT COUNT(*) FROM audit_log":              &auditRows,
			} {
				if err := conn.QueryRowContext(ctx, q).Scan(dst); err != nil {
					t.Fatal(err)
				}
			}
			return
		}
		e1, m1, o1, s1, v1, a1 := counts()
		if e1 != 12 || m1 != 12 || o1 != 2 || s1 != 3 || v1 != 3 {
			t.Fatalf("unexpected fixture counts: emp=%d maps=%d ovr=%d entries=%d versions=%d", e1, m1, o1, s1, v1)
		}
		if err := Seed(ctx, conn); err != nil {
			t.Fatalf("second Seed: %v", err)
		}
		e2, m2, o2, s2, v2, a2 := counts()
		if e1 != e2 || m1 != m2 || o1 != o2 || s1 != s2 || v1 != v2 || a1 != a2 {
			t.Fatalf("second Seed changed state: emp %d→%d maps %d→%d ovr %d→%d entries %d→%d versions %d→%d audit %d→%d",
				e1, e2, m1, m2, o1, o2, s1, s2, v1, v2, a1, a2)
		}
	})

	resolver := authz.NewSQLResolver()

	t.Run("role resolution", func(t *testing.T) {
		budi, err := resolver.Resolve(ctx, conn, EmpBudiSales, "Sales", "Sales Executive")
		if err != nil {
			t.Fatal(err)
		}
		if !budi.Has(authz.RoleStaff) || budi.Has(authz.RoleLeadSPV) || budi.Divisi != "Sales" {
			t.Fatalf("Budi should be plain Sales staff, got %+v", budi)
		}
		yohan, err := resolver.Resolve(ctx, conn, EmpYohanStaffOD, "Operations", "OD Officer")
		if err != nil {
			t.Fatal(err)
		}
		if !yohan.Has(authz.RoleStaff) || !yohan.Has(authz.RoleOD) {
			t.Fatalf("Yohan should be layered staff+od, got %+v", yohan)
		}
	})

	t.Run("mapping change effective without redeploy", func(t *testing.T) {
		admin := authz.NewMappingAdmin(authz.NewMatrixChecker(), audit.NewMySQL())
		created, err := admin.CreateMapping(ctx, conn, directorIdentity(), "Sales", "Senior Sales Executive", authz.RoleStaff)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := admin.UpdateMapping(ctx, conn, directorIdentity(), created.ID, authz.RoleLeadSPV); err != nil {
			t.Fatal(err)
		}
		id, err := resolver.Resolve(ctx, conn, "EMP-9999", "Sales", "Senior Sales Executive")
		if err != nil {
			t.Fatal(err)
		}
		if !id.Has(authz.RoleLeadSPV) {
			t.Fatalf("mapping update not visible on next resolution: %+v", id)
		}
	})

	t.Run("state machine walk with audit trail", func(t *testing.T) {
		store := &memStore{status: map[string]statemachine.Status{}}
		logger := audit.NewMySQL()
		bus := events.NewInMemoryBus()
		engine := statemachine.New(store, &memFlags{}, logger, bus)

		const prspID = "PRSP-202607-0001"
		store.status[prspID] = "Pending Validation"

		budiRoles := []statemachine.Role{"staff"}
		for _, to := range []statemachine.Status{"New Lead", "Contacted", "Qualified"} {
			err := engine.Transition(ctx, conn, statemachine.TransitionRequest{
				EntityType: statemachine.EntityProspect, EntityID: prspID,
				To: to, Actor: EmpBudiSales, ActorRoles: budiRoles,
			})
			if err != nil {
				t.Fatalf("allowed transition to %q failed: %v", to, err)
			}
		}

		// Blocked: Qualified → Closed-Success without negotiation approval.
		err := engine.Transition(ctx, conn, statemachine.TransitionRequest{
			EntityType: statemachine.EntityProspect, EntityID: prspID,
			To: "Closed-Success", Actor: EmpBudiSales, ActorRoles: budiRoles,
		})
		var blocked *statemachine.BlockedError
		if !errors.As(err, &blocked) {
			t.Fatalf("expected BlockedError, got %v", err)
		}
		if blocked.Message != msg.TransisiTidakDiizinkan {
			t.Fatalf("BI message mismatch: %q", blocked.Message)
		}
		if got := store.status[prspID]; got != "Qualified" {
			t.Fatalf("blocked transition must not change status, got %q", got)
		}

		records, err := audit.NewMySQL().List(ctx, conn, audit.Filter{EntityType: string(statemachine.EntityProspect), EntityID: prspID})
		if err != nil {
			t.Fatal(err)
		}
		if len(records) != 3 {
			t.Fatalf("want exactly 3 audit rows for 3 allowed transitions, got %d", len(records))
		}
	})

	t.Run("notification lands in-app", func(t *testing.T) {
		bus := events.NewInMemoryBus()
		center := notify.NewCenter(notify.NewCatalog())
		err := center.Register(notify.CatalogEntry{
			EventName:   "prospect.status_transition",
			Module:      "M0",
			Description: "smoke-test entry: salesperson notified on own prospect transition",
			Recipients: func(ctx context.Context, q db.Queryer, e events.Event) ([]string, error) {
				return []string{EmpBudiSales}, nil
			},
			Render: func(e events.Event) (string, string, string) {
				return "Status prospek berubah", "Prospek " + e.EntityID + " bertransisi.", "/prospects/" + e.EntityID
			},
		})
		if err != nil {
			t.Fatal(err)
		}
		center.Subscribe(bus, conn)

		store := &memStore{status: map[string]statemachine.Status{"PRSP-202607-0002": "Pending Validation"}}
		engine := statemachine.New(store, &memFlags{}, audit.NewMySQL(), bus)
		if err := engine.Transition(ctx, conn, statemachine.TransitionRequest{
			EntityType: statemachine.EntityProspect, EntityID: "PRSP-202607-0002",
			To: "New Lead", Actor: EmpBudiSales, ActorRoles: []statemachine.Role{"staff"},
		}); err != nil {
			t.Fatal(err)
		}

		n, err := center.UnreadCount(ctx, conn, EmpBudiSales)
		if err != nil {
			t.Fatal(err)
		}
		if n != 1 {
			t.Fatalf("want 1 unread notification for Budi, got %d", n)
		}
		inbox, err := center.Inbox(ctx, conn, EmpBudiSales, true, 10, 0)
		if err != nil {
			t.Fatal(err)
		}
		if len(inbox) != 1 || inbox[0].DeepLink != "/prospects/PRSP-202607-0002" {
			t.Fatalf("unexpected inbox: %+v", inbox)
		}
	})

	t.Run("master service list", func(t *testing.T) {
		salesHead := salesHeadIdentity()
		entries, err := msl.ListEntries(ctx, conn, salesHead)
		if err != nil {
			t.Fatal(err)
		}
		var establishTikTok int64
		for _, e := range entries {
			if e.Name == "Pendampingan Establish TikTok" {
				establishTikTok = e.ID
			}
		}
		if establishTikTok == 0 {
			t.Fatal("seeded MSL entry not found")
		}
		// Deal-date lookup on the worked example's qualification date.
		v, err := msl.EffectiveAt(ctx, conn, establishTikTok, time.Date(2026, 4, 20, 0, 0, 0, 0, time.UTC))
		if err != nil {
			t.Fatal(err)
		}
		if v.StandardPrice != "9000000.00" {
			t.Fatalf("want Alpha Digital price 9000000.00, got %q", v.StandardPrice)
		}
		// Plain salesperson may not write the master list (M0 OD-2 guardrail).
		budi := authz.Identity{EmployeeID: EmpBudiSales, Divisi: "Sales", Roles: []authz.Role{authz.RoleStaff}}
		_, err = msl.NewStore(authz.NewMatrixChecker(), audit.NewMySQL()).CreateEntry(ctx, conn, budi, msl.CreateInput{
			Name: "Jasa Ilegal", StandardPrice: "1.00", CommissionRule: "{}", EffectiveFrom: time.Now(),
		})
		if err == nil {
			t.Fatal("plain Sales staff must be denied MSL writes")
		}
	})
}

// memStore / memFlags are the dummy-entity persistence for the smoke test —
// Sprint 0 ships no entity tables (statuses live on module tables in Wave 1+).
type memStore struct {
	status map[string]statemachine.Status
}

func (s *memStore) GetStatus(_ context.Context, _ db.Queryer, _ statemachine.EntityType, id string) (statemachine.Status, error) {
	st, ok := s.status[id]
	if !ok {
		return "", errors.New("entity not found")
	}
	return st, nil
}

func (s *memStore) SetStatus(_ context.Context, _ db.Queryer, _ statemachine.EntityType, id string, to statemachine.Status) error {
	s.status[id] = to
	return nil
}

type memFlags struct{}

func (memFlags) SetFlag(context.Context, db.Queryer, statemachine.EntityType, string, statemachine.Flag) error {
	return nil
}
func (memFlags) ClearFlag(context.Context, db.Queryer, statemachine.EntityType, string, statemachine.Flag) error {
	return nil
}
