package module11_board

import (
	"context"
	"errors"
	"regexp"
	"strings"
	"testing"

	"github.com/meagrup/agencyapp/backend/internal/core/notification"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
	"github.com/meagrup/agencyapp/backend/internal/module6_account"
	"github.com/meagrup/agencyapp/backend/internal/testutil"
)

var depID = regexp.MustCompile(`^DEP-\d{6}-\d{4}$`)

// ---- actors -------------------------------------------------------------------

func director(id string) permission.Actor {
	return permission.Actor{EmployeeID: id, Role: permission.Role{Director: true}}
}
func accountLead(id string) permission.Actor {
	return permission.Actor{EmployeeID: id, Role: permission.Role{Division: AccountDivision, Level: permission.LevelLead}}
}
func accountStaff(id string) permission.Actor {
	return permission.Actor{EmployeeID: id, Role: permission.Role{Division: AccountDivision, Level: permission.LevelStaff}}
}
func divStaff(division, id string) permission.Actor {
	return permission.Actor{EmployeeID: id, Role: permission.Role{Division: division, Level: permission.LevelStaff}}
}
func odActor(id string) permission.Actor {
	return permission.Actor{EmployeeID: id, Role: permission.Role{OD: true}}
}

// ---- fixtures -----------------------------------------------------------------

func newBoardSvc(t *testing.T) *Service {
	d := testutil.DB(t)
	testutil.Clean(t, d)
	return &Service{DB: d, Catalog: notification.NewCatalog()}
}

func insertClient(t *testing.T, s *Service, id, amID string) {
	t.Helper()
	am := "NULL"
	if amID != "" {
		am = "'" + amID + "'"
	}
	if _, err := s.DB.Exec(
		`INSERT INTO clients (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv,
		   total_sales, sales_pic_id, commission_payment_pic_id, released_to_account_at, assigned_am_id, created_by)
		 VALUES (?, 'PIC', ?, 'Bandung', 'link', 'Fashion', '0.00','0.00','0.00','EMP-BUDI','EMP-BUDI', NOW(), `+am+`, 'TEST')`,
		id, id); err != nil {
		t.Fatalf("insert client %s: %v", id, err)
	}
}

func insertService(t *testing.T, s *Service, svcID, clientID string) {
	t.Helper()
	if _, err := s.DB.Exec(
		`INSERT INTO services (id, client_id, master_service_id, master_version_no, name,
		   standard_price, commission_rule, status, requires_strategy_plan, created_by)
		 VALUES (?, ?, 'MSV-X', 1, 'Svc', '0.00', 'rule', '[In Execution]', 0, 'TEST')`,
		svcID, clientID); err != nil {
		t.Fatalf("insert service %s: %v", svcID, err)
	}
}

func insertBrief(t *testing.T, s *Service, id, svcID, division, pic, status string) {
	t.Helper()
	p := "NULL"
	if pic != "" {
		p = "'" + pic + "'"
	}
	if _, err := s.DB.Exec(
		`INSERT INTO briefs (id, service_id, assigned_division, assigned_pic, deliverable_type,
		   quantity_target, due_date, priority, title, status, created_by)
		 VALUES (?, ?, ?, `+p+`, 'Deliverable', 1, '2026-08-30', 'High', 'Brief', ?, 'TEST')`,
		id, svcID, division, status); err != nil {
		t.Fatalf("insert brief %s: %v", id, err)
	}
}

func insertAsset(t *testing.T, s *Service, id, briefID string, seq int, pic, status string) {
	t.Helper()
	p := "NULL"
	if pic != "" {
		p = "'" + pic + "'"
	}
	if _, err := s.DB.Exec(
		`INSERT INTO assets (id, brief_id, asset_type, sequence_no, assigned_pic, status, created_by)
		 VALUES (?, ?, 'Video', ?, `+p+`, ?, 'TEST')`,
		id, briefID, seq, status); err != nil {
		t.Fatalf("insert asset %s: %v", id, err)
	}
}

func insertBooking(t *testing.T, s *Service, id, briefID, coordinator, status string) {
	t.Helper()
	var coord any
	if coordinator != "" {
		coord = coordinator
	}
	if _, err := s.DB.Exec(
		`INSERT INTO creator_bookings (id, brief_id, creator_name, platform, source_pool, agreed_rate,
		   status, assigned_coordinator, created_by)
		 VALUES (?, ?, 'Creator', 'TikTok', 'Ad-hoc New', '0.00', ?, ?, 'TEST')`,
		id, briefID, status, coord); err != nil {
		t.Fatalf("insert booking %s: %v", id, err)
	}
}

func setBriefStatus(t *testing.T, s *Service, briefID, status string) {
	t.Helper()
	if _, err := s.DB.Exec(`UPDATE briefs SET status = ? WHERE id = ?`, status, briefID); err != nil {
		t.Fatalf("set brief status: %v", err)
	}
}

// ---- CreateDependency validations --------------------------------------------

// TestCreateDependency_SameClientOnly: cross-Client is rejected (§2 Rule 4); same
// Client (even different Service) is accepted.
func TestCreateDependency_SameClientOnly(t *testing.T) {
	s := newBoardSvc(t)
	insertClient(t, s, "CLI-A", "EMP-AM")
	insertClient(t, s, "CLI-B", "EMP-AM")
	insertService(t, s, "SVC-A1", "CLI-A")
	insertService(t, s, "SVC-A2", "CLI-A")
	insertService(t, s, "SVC-B1", "CLI-B")
	insertBrief(t, s, "BRF-A1", "SVC-A1", "Creative", "EMP-C", "[To Do]")
	insertBrief(t, s, "BRF-A2", "SVC-A2", "Ads", "EMP-AD", "[To Do]")
	insertBrief(t, s, "BRF-B1", "SVC-B1", "Ads", "EMP-AD", "[To Do]")

	// Cross-Client rejected.
	if _, err := s.CreateDependency(context.Background(), director("EMP-DIR"), DependencyInput{
		SourceID: "BRF-A1", TargetID: "BRF-B1", Type: TypeBlocking,
	}); !errors.Is(err, ErrDepCrossClient) {
		t.Fatalf("cross-client: want ErrDepCrossClient, got %v", err)
	}
	// Same-Client, cross-Service accepted.
	dep, err := s.CreateDependency(context.Background(), director("EMP-DIR"), DependencyInput{
		SourceID: "BRF-A1", TargetID: "BRF-A2", Type: TypeBlocking,
	})
	if err != nil {
		t.Fatalf("same-client: %v", err)
	}
	if !depID.MatchString(dep.ID) {
		t.Fatalf("dep id %q not DEP-YYYYMM-NNNN", dep.ID)
	}
	if dep.ClientID != "CLI-A" || dep.Status != StatusPending {
		t.Fatalf("dep = %+v, want client CLI-A / Pending", dep)
	}
}

// TestCreateDependency_DuplicatePair: the same ordered (Source,Target) pair may have
// only one active Dependency (§5.1).
func TestCreateDependency_DuplicatePair(t *testing.T) {
	s := newBoardSvc(t)
	seedPair(t, s)
	in := DependencyInput{SourceID: "BRF-1", TargetID: "BRF-2", Type: TypeBlocking}
	if _, err := s.CreateDependency(context.Background(), director("EMP-DIR"), in); err != nil {
		t.Fatalf("first create: %v", err)
	}
	if _, err := s.CreateDependency(context.Background(), director("EMP-DIR"), in); !errors.Is(err, ErrDepDuplicate) {
		t.Fatalf("duplicate: want ErrDepDuplicate, got %v", err)
	}
}

// TestCreateDependency_Cycle: a direct 2-cycle (A->B then B->A) and a 3-chain cycle
// (A->B, B->C, then C->A) are both rejected (§2 Rule 6).
func TestCreateDependency_Cycle(t *testing.T) {
	s := newBoardSvc(t)
	insertClient(t, s, "CLI-1", "EMP-AM")
	insertService(t, s, "SVC-1", "CLI-1")
	for _, b := range []string{"BRF-1", "BRF-2", "BRF-3"} {
		insertBrief(t, s, b, "SVC-1", "Creative", "EMP-C", "[To Do]")
	}
	mk := func(src, tgt string) error {
		_, err := s.CreateDependency(context.Background(), director("EMP-DIR"),
			DependencyInput{SourceID: src, TargetID: tgt, Type: TypeBlocking})
		return err
	}
	if err := mk("BRF-1", "BRF-2"); err != nil {
		t.Fatalf("A->B: %v", err)
	}
	// Direct 2-cycle.
	if err := mk("BRF-2", "BRF-1"); !errors.Is(err, ErrDepCycle) {
		t.Fatalf("B->A: want ErrDepCycle, got %v", err)
	}
	// 3-chain cycle: A->B, B->C exist; C->A closes the loop.
	if err := mk("BRF-2", "BRF-3"); err != nil {
		t.Fatalf("B->C: %v", err)
	}
	if err := mk("BRF-3", "BRF-1"); !errors.Is(err, ErrDepCycle) {
		t.Fatalf("C->A: want ErrDepCycle, got %v", err)
	}
}

// TestCreateDependency_TypeAndSelfAndEntity: invalid type, self-reference, and a
// non-Brief entity are each rejected.
func TestCreateDependency_TypeAndSelfAndEntity(t *testing.T) {
	s := newBoardSvc(t)
	seedPair(t, s)
	base := DependencyInput{SourceID: "BRF-1", TargetID: "BRF-2"}

	b := base
	b.Type = "Blokir"
	if _, err := s.CreateDependency(context.Background(), director("EMP-DIR"), b); !errors.Is(err, ErrDepInvalidType) {
		t.Fatalf("bad type: want ErrDepInvalidType, got %v", err)
	}
	b = base
	b.Type = TypeBlocking
	b.TargetID = "BRF-1"
	if _, err := s.CreateDependency(context.Background(), director("EMP-DIR"), b); !errors.Is(err, ErrDepSelf) {
		t.Fatalf("self: want ErrDepSelf, got %v", err)
	}
	b = base
	b.Type = TypeBlocking
	b.SourceType = "asset"
	if _, err := s.CreateDependency(context.Background(), director("EMP-DIR"), b); !errors.Is(err, ErrDepInvalidEntity) {
		t.Fatalf("entity: want ErrDepInvalidEntity, got %v", err)
	}
}

// TestCreateDependency_Permission: only the owning AM, Account lead/SPV, or Director
// may declare a Dependency (§6.1); other AMs, division staff and OD are denied.
func TestCreateDependency_Permission(t *testing.T) {
	s := newBoardSvc(t)
	insertClient(t, s, "CLI-1", "EMP-OWNER")
	insertService(t, s, "SVC-1", "CLI-1")
	insertBrief(t, s, "BRF-1", "SVC-1", "Creative", "EMP-C", "[To Do]")
	insertBrief(t, s, "BRF-2", "SVC-1", "Ads", "EMP-AD", "[To Do]")

	cases := []struct {
		name  string
		actor permission.Actor
		allow bool
	}{
		{"owning AM", accountStaff("EMP-OWNER"), true},
		{"account lead", accountLead("EMP-ALEAD"), true},
		{"director", director("EMP-DIR"), true},
		{"other AM", accountStaff("EMP-OTHER"), false},
		{"creative staff", divStaff("Creative", "EMP-C"), false},
		{"OD", odActor("EMP-OD"), false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			// fresh pair each subtest to avoid duplicate-pair collisions.
			_, _ = s.DB.Exec(`DELETE FROM dependencies`)
			_, err := s.CreateDependency(context.Background(), c.actor,
				DependencyInput{SourceID: "BRF-1", TargetID: "BRF-2", Type: TypeBlocking})
			if c.allow && err != nil {
				t.Fatalf("expected allow, got %v", err)
			}
			if !c.allow && !errors.Is(err, ErrDepCreateForbidden) {
				t.Fatalf("expected ErrDepCreateForbidden, got %v", err)
			}
		})
	}
}

// TestCreateDependency_ImmutableAudit: creating a Dependency appends an immutable
// audit row (house rule 3); there is no delete/cancel path.
func TestCreateDependency_ImmutableAudit(t *testing.T) {
	s := newBoardSvc(t)
	seedPair(t, s)
	dep, err := s.CreateDependency(context.Background(), director("EMP-DIR"),
		DependencyInput{SourceID: "BRF-1", TargetID: "BRF-2", Type: TypeBlocking})
	if err != nil {
		t.Fatal(err)
	}
	var n int
	if err := s.DB.QueryRow(
		`SELECT COUNT(*) FROM audit_log WHERE entity_type='dependency' AND entity_id=? AND action='create'`,
		dep.ID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("audit rows = %d, want 1", n)
	}
	// The append-only trigger forbids UPDATE of an audit row.
	if _, err := s.DB.Exec(`UPDATE audit_log SET action='x' WHERE entity_type='dependency'`); err == nil {
		t.Fatalf("expected audit_log UPDATE to be rejected by the immutability trigger")
	}
}

// ---- derived status -----------------------------------------------------------

// TestDerivedStatus: Pending (Source not started) / Blocking (Source in progress &
// type Blocking) / Satisfied (Source terminal); Informational never shows Blocking.
func TestDerivedStatus(t *testing.T) {
	s := newBoardSvc(t)
	insertClient(t, s, "CLI-1", "EMP-AM")
	insertService(t, s, "SVC-1", "CLI-1")
	insertBrief(t, s, "BRF-SRC", "SVC-1", "Creative", "EMP-C", "[To Do]")
	insertBrief(t, s, "BRF-TGT", "SVC-1", "Ads", "EMP-AD", "[To Do]")
	dep, err := s.CreateDependency(context.Background(), director("EMP-DIR"),
		DependencyInput{SourceID: "BRF-SRC", TargetID: "BRF-TGT", Type: TypeBlocking})
	if err != nil {
		t.Fatal(err)
	}

	check := func(want string) {
		got, err := s.GetDependency(context.Background(), director("EMP-DIR"), dep.ID)
		if err != nil {
			t.Fatal(err)
		}
		if got.Status != want {
			t.Fatalf("status = %q, want %q", got.Status, want)
		}
	}
	check(StatusPending) // Source [To Do]
	setBriefStatus(t, s, "BRF-SRC", "[In Progress]")
	check(StatusBlocking) // Source started, type Blocking
	setBriefStatus(t, s, "BRF-SRC", "[Approved]")
	check(StatusSatisfied) // Source terminal

	// Informational never shows Blocking even mid-flight.
	insertBrief(t, s, "BRF-SRC2", "SVC-1", "Creative", "EMP-C", "[In Progress]")
	insertBrief(t, s, "BRF-TGT2", "SVC-1", "Ads", "EMP-AD", "[To Do]")
	info, err := s.CreateDependency(context.Background(), director("EMP-DIR"),
		DependencyInput{SourceID: "BRF-SRC2", TargetID: "BRF-TGT2", Type: TypeInformational})
	if err != nil {
		t.Fatal(err)
	}
	if info.Status != StatusPending {
		t.Fatalf("informational mid-flight status = %q, want Pending", info.Status)
	}
}

// ---- gate + emission (integration with M6 ApproveBrief) -----------------------

// boardWithBriefMachine wires an M6 Account service whose engine fires the M11
// emission hook on Brief -> [Approved] and whose ApproveGuard is the board's
// Blocking gate — mirroring the httpapi wiring.
func boardWithBriefMachine(t *testing.T) (*Service, *module6_account.Service) {
	s := newBoardSvc(t)
	eng := statemachine.New()
	eng.SetHook(func(ev statemachine.Event) error {
		if ev.Machine == statemachine.MBriefTask && ev.To == "[Approved]" {
			return s.OnBriefReachedTerminal(ev.Ctx, ev.Tx, ev.Actor, ev.EntityID)
		}
		return nil
	})
	acct := &module6_account.Service{DB: s.DB, Engine: eng, Catalog: s.Catalog, ApproveGuard: s}
	return s, acct
}

// drive moves a brief through the brief_task engine (test setup only).
func drive(t *testing.T, eng *statemachine.Engine, s *Service, briefID, to string, actor permission.Actor) {
	t.Helper()
	tx, err := s.DB.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	if _, err := eng.Transition(context.Background(), tx, statemachine.Request{
		Machine: statemachine.MBriefTask, EntityType: "brief", Table: "briefs", EntityID: briefID, To: to, Actor: actor,
	}); err != nil {
		t.Fatalf("drive %s -> %s: %v", briefID, to, err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
}

// TestBlockingGate_And_Emission: the Target's final transition ([In Review] ->
// [Approved]) is rejected with the §12 template message while the Source is not
// terminal; approving the Source fires EvDependencySatisfied once to the Target PIC
// and unblocks the Target's approval.
func TestBlockingGate_And_Emission(t *testing.T) {
	s, acct := boardWithBriefMachine(t)
	eng := acct.Engine
	insertClient(t, s, "CLI-1", "EMP-AM")
	insertService(t, s, "SVC-1", "CLI-1")
	// Source + Target are Ads Brief-as-tasks (single-unit, driven via the engine).
	insertBrief(t, s, "BRF-SRC", "SVC-1", "Ads", "EMP-SRC-PIC", "[To Do]")
	insertBrief(t, s, "BRF-TGT", "SVC-1", "Ads", "EMP-TGT-PIC", "[To Do]")
	dep, err := s.CreateDependency(context.Background(), director("EMP-DIR"),
		DependencyInput{SourceID: "BRF-SRC", TargetID: "BRF-TGT", Type: TypeBlocking})
	if err != nil {
		t.Fatal(err)
	}

	// Drive both to [In Review] (PIC keeps working — start is NOT gated, §2 Rule 7).
	for _, b := range []string{"BRF-SRC", "BRF-TGT"} {
		drive(t, eng, s, b, "[In Progress]", divStaff("Ads", "EMP-X"))
		drive(t, eng, s, b, "[Submitted]", divStaff("Ads", "EMP-X"))
		drive(t, eng, s, b, "[In Review]", divStaff("Ads", "EMP-X"))
	}

	// Gate: approving the Target is rejected with the template message.
	_, err = acct.ApproveBrief(context.Background(), director("EMP-DIR"), "BRF-TGT")
	var be *statemachine.BlockedError
	if !errors.As(err, &be) {
		t.Fatalf("target approve: want BlockedError, got %v", err)
	}
	wantPrefix := "Brief ini belum bisa lanjut ke [Approved] karena menunggu "
	if !strings.HasPrefix(be.Message, wantPrefix) || !strings.Contains(be.Message, "BRF-SRC") ||
		!strings.HasSuffix(be.Message, "selesai Approved.") {
		t.Fatalf("gate message = %q, want template with BRF-SRC", be.Message)
	}

	// Approve the Source -> Satisfied -> EvDependencySatisfied fires to Target PIC.
	if _, err := acct.ApproveBrief(context.Background(), director("EMP-DIR"), "BRF-SRC"); err != nil {
		t.Fatalf("approve source: %v", err)
	}
	if got, _ := s.GetDependency(context.Background(), director("EMP-DIR"), dep.ID); got.Status != StatusSatisfied {
		t.Fatalf("dep status after source approved = %q, want Satisfied", got.Status)
	}
	assertNotifCount(t, s, "EMP-TGT-PIC", 1)

	// Fire-once: a re-run of the emission hook adds no second notification.
	tx, _ := s.DB.Begin()
	if err := s.OnBriefReachedTerminal(context.Background(), tx, director("EMP-DIR"), "BRF-SRC"); err != nil {
		t.Fatal(err)
	}
	_ = tx.Commit()
	assertNotifCount(t, s, "EMP-TGT-PIC", 1)

	// Now the Target's approval proceeds.
	if _, err := acct.ApproveBrief(context.Background(), director("EMP-DIR"), "BRF-TGT"); err != nil {
		t.Fatalf("approve target after source terminal: %v", err)
	}
	if st, _ := briefStatus(context.Background(), s.DB, "BRF-TGT"); st != "[Approved]" {
		t.Fatalf("target status = %q, want [Approved]", st)
	}
}

func assertNotifCount(t *testing.T, s *Service, recipient string, want int) {
	t.Helper()
	var n int
	if err := s.DB.QueryRow(
		`SELECT COUNT(*) FROM notifications WHERE recipient_employee_id=? AND event_type=?`,
		recipient, string(notification.EvDependencySatisfied)).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != want {
		t.Fatalf("EvDependencySatisfied to %s = %d, want %d", recipient, n, want)
	}
}

// ---- implicit M8 dependency is never a row ------------------------------------

// TestImplicitM8DependencyNotListed: the built-in Asset->Launch guardrail (§2 Rule 9
// / §6.4) is hardcoded in M8 and never declared, so it never appears as a DEP row.
func TestImplicitM8DependencyNotListed(t *testing.T) {
	s := newBoardSvc(t)
	insertClient(t, s, "CLI-1", "EMP-AM")
	insertService(t, s, "SVC-1", "CLI-1")
	insertBrief(t, s, "BRF-CREA", "SVC-1", "Creative", "EMP-C", "[In Progress]")
	insertBrief(t, s, "BRF-ADS", "SVC-1", "Ads", "EMP-AD", "[In Progress]")
	// No Dependency declared for the Creative->Ads launch relationship.
	deps, err := s.ListDependencies(context.Background(), director("EMP-DIR"), "", "BRF-ADS")
	if err != nil {
		t.Fatal(err)
	}
	if len(deps) != 0 {
		t.Fatalf("dependencies targeting Ads brief = %d, want 0 (implicit M8 guardrail is not a row)", len(deps))
	}
}

// ---- My Tasks -----------------------------------------------------------------

// TestMyTasks_OwnUnitsAcrossModules: My Tasks lists the actor's own units across ≥2
// modules with correct Universal Columns; another staff's units are excluded; a
// staff member may not read someone else's tasks.
func TestMyTasks_OwnUnitsAcrossModules(t *testing.T) {
	s := newBoardSvc(t)
	insertClient(t, s, "CLI-1", "EMP-AM")
	insertService(t, s, "SVC-1", "CLI-1")
	// Ads Brief-as-task the actor PICs (module 12 / Ads).
	insertBrief(t, s, "BRF-ADS", "SVC-1", "Ads", "EMP-ME", "[In Progress]")
	// Creative Brief holds the actor's Asset (module 7).
	insertBrief(t, s, "BRF-CREA", "SVC-1", "Creative", "EMP-OTHER", "[In Progress]")
	insertAsset(t, s, "AST-1", "BRF-CREA", 1, "EMP-ME", "[Submitted]")
	// KOL Brief holds the actor's Booking (module 9).
	insertBrief(t, s, "BRF-KOL", "SVC-1", "KOL", "", "[To Do]")
	insertBooking(t, s, "BKG-1", "BRF-KOL", "EMP-ME", "[Content In Progress]")
	// A unit owned by someone else must NOT appear.
	insertBrief(t, s, "BRF-OTHER", "SVC-1", "Ads", "EMP-OTHER", "[In Progress]")

	cards, err := s.MyTasks(context.Background(), divStaff("Ads", "EMP-ME"), "")
	if err != nil {
		t.Fatal(err)
	}
	byID := map[string]Card{}
	for _, c := range cards {
		byID[c.ID] = c
	}
	if len(byID) != 3 {
		t.Fatalf("cards = %d (%v), want 3", len(byID), byID)
	}
	if byID["BRF-ADS"].UniversalCol != UCInProgress {
		t.Errorf("Ads brief UC = %q, want In Progress", byID["BRF-ADS"].UniversalCol)
	}
	if byID["AST-1"].UniversalCol != UCAwaitingRev {
		t.Errorf("Asset UC = %q, want Awaiting Review", byID["AST-1"].UniversalCol)
	}
	if byID["BKG-1"].UniversalCol != UCInProgress {
		t.Errorf("Booking UC = %q, want In Progress", byID["BKG-1"].UniversalCol)
	}
	if _, ok := byID["BRF-OTHER"]; ok {
		t.Errorf("another staff's brief leaked into My Tasks")
	}

	// A staff member cannot read another employee's tasks.
	if _, err := s.MyTasks(context.Background(), divStaff("Ads", "EMP-ME"), "EMP-OTHER"); !errors.Is(err, ErrDepViewForbidden) {
		t.Fatalf("cross-employee my-tasks: want ErrDepViewForbidden, got %v", err)
	}
	// Director may.
	other, err := s.MyTasks(context.Background(), director("EMP-DIR"), "EMP-OTHER")
	if err != nil {
		t.Fatalf("director view: %v", err)
	}
	if len(other) == 0 {
		t.Fatalf("director view of EMP-OTHER returned no cards")
	}
}

// ---- Client Board -------------------------------------------------------------

// TestClientBoard_ScopeAndUniversalColumns: the board lists all Briefs of a Client
// with Universal Columns + Dependency badge; a non-PIC staff of that Client cannot
// read it.
func TestClientBoard_ScopeAndUniversalColumns(t *testing.T) {
	s := newBoardSvc(t)
	insertClient(t, s, "CLI-1", "EMP-AM")
	insertService(t, s, "SVC-1", "CLI-1")
	insertBrief(t, s, "BRF-CREA", "SVC-1", "Creative", "EMP-C", "[Approved]")
	insertBrief(t, s, "BRF-ADS", "SVC-1", "Ads", "EMP-AD", "[In Progress]")
	// Blocking dep: Creative (Approved -> Satisfied) does NOT badge; make an
	// unsatisfied one to show the badge on the Ads target.
	insertBrief(t, s, "BRF-SRC", "SVC-1", "KOL", "", "[In Progress]")
	if _, err := s.CreateDependency(context.Background(), director("EMP-DIR"),
		DependencyInput{SourceID: "BRF-SRC", TargetID: "BRF-ADS", Type: TypeBlocking}); err != nil {
		t.Fatal(err)
	}

	cards, err := s.ClientBoard(context.Background(), accountLead("EMP-ALEAD"), "CLI-1")
	if err != nil {
		t.Fatal(err)
	}
	byID := map[string]Card{}
	for _, c := range cards {
		byID[c.ID] = c
	}
	if byID["BRF-CREA"].UniversalCol != UCDone {
		t.Errorf("Creative brief UC = %q, want Done", byID["BRF-CREA"].UniversalCol)
	}
	if byID["BRF-ADS"].UniversalCol != UCInProgress {
		t.Errorf("Ads brief UC = %q, want In Progress", byID["BRF-ADS"].UniversalCol)
	}
	if byID["BRF-ADS"].DependencyNote != "Menunggu Dependency" {
		t.Errorf("Ads brief badge = %q, want Menunggu Dependency", byID["BRF-ADS"].DependencyNote)
	}

	// A Creative staff who is NOT PIC of any unit of this Client cannot read it.
	if _, err := s.ClientBoard(context.Background(), divStaff("Ads", "EMP-NOBODY"), "CLI-1"); !errors.Is(err, ErrDepViewForbidden) {
		t.Fatalf("non-PIC staff board: want ErrDepViewForbidden, got %v", err)
	}
}

// seedPair creates one client + service + two Briefs (BRF-1, BRF-2) for the simple
// validation tests.
func seedPair(t *testing.T, s *Service) {
	t.Helper()
	insertClient(t, s, "CLI-1", "EMP-AM")
	insertService(t, s, "SVC-1", "CLI-1")
	insertBrief(t, s, "BRF-1", "SVC-1", "Creative", "EMP-C", "[To Do]")
	insertBrief(t, s, "BRF-2", "SVC-1", "Ads", "EMP-AD", "[To Do]")
}
