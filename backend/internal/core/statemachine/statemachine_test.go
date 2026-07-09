package statemachine_test

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"testing"

	"github.com/meagrup/agencyapp/backend/internal/core/permission"
	sm "github.com/meagrup/agencyapp/backend/internal/core/statemachine"
	"github.com/meagrup/agencyapp/backend/internal/testutil"
)

func ensureProbe(t *testing.T, d *sql.DB) {
	t.Helper()
	if _, err := d.Exec(`CREATE TABLE IF NOT EXISTS sm_probe (
		id VARCHAR(64) NOT NULL PRIMARY KEY,
		status VARCHAR(64) NOT NULL,
		created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		created_by VARCHAR(64) NOT NULL DEFAULT 'TEST'
	) ENGINE=InnoDB`); err != nil {
		t.Fatalf("create probe: %v", err)
	}
	if _, err := d.Exec(`TRUNCATE TABLE sm_probe`); err != nil {
		t.Fatalf("truncate probe: %v", err)
	}
}

func seedProbe(t *testing.T, d *sql.DB, id, status string) {
	t.Helper()
	if _, err := d.Exec(`INSERT INTO sm_probe (id, status) VALUES (?, ?)`, id, status); err != nil {
		t.Fatalf("seed probe: %v", err)
	}
}

func probeStatus(t *testing.T, d *sql.DB, id string) string {
	t.Helper()
	var s string
	if err := d.QueryRow(`SELECT status FROM sm_probe WHERE id=?`, id).Scan(&s); err != nil {
		t.Fatalf("read probe: %v", err)
	}
	return s
}

func transition(t *testing.T, d *sql.DB, e *sm.Engine, machine, id, to string, actor permission.Actor) error {
	t.Helper()
	ctx := context.Background()
	tx, err := d.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	_, err = e.Transition(ctx, tx, sm.Request{
		Machine: machine, EntityType: "sm_probe", Table: "sm_probe",
		EntityID: id, To: to, Actor: actor,
	})
	if err != nil {
		tx.Rollback()
		return err
	}
	return tx.Commit()
}

var leadActor = permission.Actor{EmployeeID: "LEAD-1", Role: permission.Role{Level: permission.LevelLead, Division: "X"}}
var staffActor = permission.Actor{EmployeeID: "STAFF-1", Role: permission.Role{Level: permission.LevelStaff, Division: "X"}}

// Every allowed transition in every machine must succeed; a representative
// invalid transition per from-state must be blocked with the BI message and
// change nothing.
func TestAllMachines_AllowedAndBlocked(t *testing.T) {
	d := testutil.DB(t)
	testutil.Clean(t, d)
	ensureProbe(t, d)
	engine := sm.New()

	n := 0
	for _, m := range engine.Machines() {
		if m.AutoComputed {
			continue
		}
		froms := map[string]bool{}
		for i, edge := range m.Edges() {
			froms[edge.From] = true
			id := fmt.Sprintf("%s-ok-%d", m.Name, i)
			seedProbe(t, d, id, edge.From)
			actor := staffActor
			if edge.RequireLead {
				actor = leadActor
			}
			if err := transition(t, d, engine, m.Name, id, edge.To, actor); err != nil {
				t.Errorf("[%s] allowed %q->%q failed: %v", m.Name, edge.From, edge.To, err)
				continue
			}
			if got := probeStatus(t, d, id); got != edge.To {
				t.Errorf("[%s] %q->%q: status=%q", m.Name, edge.From, edge.To, got)
			}
			n++
		}

		// One invalid transition per from-state.
		for from := range froms {
			id := fmt.Sprintf("%s-bad-%s", m.Name, from)
			seedProbe(t, d, id, from)
			err := transition(t, d, engine, m.Name, id, "[__unlisted__]", leadActor)
			var be *sm.BlockedError
			if !errors.As(err, &be) {
				t.Errorf("[%s] invalid from %q: expected BlockedError, got %v", m.Name, from, err)
				continue
			}
			if be.Message != m.BlockMessage {
				t.Errorf("[%s] block message=%q want %q", m.Name, be.Message, m.BlockMessage)
			}
			if got := probeStatus(t, d, id); got != from {
				t.Errorf("[%s] blocked transition changed status: %q != %q", m.Name, got, from)
			}
		}
	}
	if n == 0 {
		t.Fatal("no transitions exercised")
	}
	t.Logf("exercised %d allowed transitions across machines", n)
}

func TestBriefTask_BlockedIsLeadOnly(t *testing.T) {
	d := testutil.DB(t)
	testutil.Clean(t, d)
	ensureProbe(t, d)
	engine := sm.New()

	// Staff cannot set [Blocked].
	seedProbe(t, d, "b1", "[In Progress]")
	err := transition(t, d, engine, sm.MBriefTask, "b1", "[Blocked]", staffActor)
	var re *sm.RoleError
	if !errors.As(err, &re) {
		t.Fatalf("staff [Blocked]: expected RoleError, got %v", err)
	}
	if got := probeStatus(t, d, "b1"); got != "[In Progress]" {
		t.Fatalf("staff denied but status changed to %q", got)
	}

	// Lead can.
	seedProbe(t, d, "b2", "[In Progress]")
	if err := transition(t, d, engine, sm.MBriefTask, "b2", "[Blocked]", leadActor); err != nil {
		t.Fatalf("lead [Blocked] failed: %v", err)
	}
	if got := probeStatus(t, d, "b2"); got != "[Blocked]" {
		t.Fatalf("lead [Blocked]: status=%q", got)
	}
}

func TestBriefTask_IllegalJumpBlocked(t *testing.T) {
	d := testutil.DB(t)
	testutil.Clean(t, d)
	ensureProbe(t, d)
	engine := sm.New()
	seedProbe(t, d, "j1", "[To Do]")
	err := transition(t, d, engine, sm.MBriefTask, "j1", "[Approved]", leadActor)
	var be *sm.BlockedError
	if !errors.As(err, &be) || be.Message != sm.DefaultBlockMessage {
		t.Fatalf("illegal jump: expected default BI block message, got %v", err)
	}
}

func TestDependency_NoManualTransition(t *testing.T) {
	d := testutil.DB(t)
	testutil.Clean(t, d)
	ensureProbe(t, d)
	engine := sm.New()
	seedProbe(t, d, "dep1", "Pending")
	err := transition(t, d, engine, sm.MDependency, "dep1", "Satisfied", leadActor)
	if err == nil {
		t.Fatal("expected dependency manual transition to be rejected")
	}
	var be *sm.BlockedError
	if errors.As(err, &be) {
		t.Fatalf("dependency should not return BlockedError, got config error instead: %v", err)
	}
}
