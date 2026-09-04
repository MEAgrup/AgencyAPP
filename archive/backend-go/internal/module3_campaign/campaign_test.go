package module3_campaign

import (
	"context"
	"errors"
	"regexp"
	"testing"

	"github.com/meagrup/agencyapp/backend/internal/core/permission"
	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
	"github.com/meagrup/agencyapp/backend/internal/testutil"
)

// ---- actor helpers ----

func mktStaff(id string) permission.Actor {
	return permission.Actor{EmployeeID: id, Role: permission.Role{Division: MarketingDivision, Level: permission.LevelStaff}}
}
func mktLead(id string) permission.Actor {
	return permission.Actor{EmployeeID: id, Role: permission.Role{Division: MarketingDivision, Level: permission.LevelLead}}
}
func salesStaff(id string) permission.Actor {
	return permission.Actor{EmployeeID: id, Role: permission.Role{Division: "Sales", Level: permission.LevelStaff}}
}

// od is a layered read-only-everywhere account (Management underlying division).
func od(id string) permission.Actor {
	return permission.Actor{EmployeeID: id, Role: permission.Role{Division: "Management", Level: permission.LevelStaff, OD: true}}
}
func director(id string) permission.Actor {
	return permission.Actor{EmployeeID: id, Role: permission.Role{Division: "Management", Level: permission.LevelStaff, Director: true}}
}

func newService(t *testing.T) *Service {
	t.Helper()
	d := testutil.DB(t)
	testutil.Clean(t, d)
	// A candidate Marketing staff for reassignment tests.
	testutil.InsertRoleMapping(t, d, "Marketing", "Marketing Staff", MarketingDivision, permission.LevelStaff)
	testutil.InsertRoleMapping(t, d, "Marketing", "Marketing Head", MarketingDivision, permission.LevelLead)
	testutil.InsertRoleMapping(t, d, "Sales", "Sales Executive", "Sales", permission.LevelStaff)
	testutil.InsertEmployee(t, d, "EMP-LIA", "Lia", "lia@mea.co.id", "Marketing", "Marketing Staff", true)
	testutil.InsertEmployee(t, d, "EMP-DINA", "Dina", "dina@mea.co.id", "Marketing", "Marketing Staff", true)
	testutil.InsertEmployee(t, d, "EMP-MHEAD", "Maya", "maya@mea.co.id", "Marketing", "Marketing Head", true)
	testutil.InsertEmployee(t, d, "EMP-INACT", "Ina", "ina@mea.co.id", "Marketing", "Marketing Staff", false)
	testutil.InsertEmployee(t, d, "EMP-SAL", "Sam", "sam@mea.co.id", "Sales", "Sales Executive", true)
	return &Service{DB: d, Engine: statemachine.New()}
}

func validInput() CampaignInput {
	return CampaignInput{Name: "Promo Skilskul Maret", Channel: "TikTok Ads", Online: true, StartDate: "2026-03-02"}
}

var idRe = regexp.MustCompile(`^CMP-\d{6}-\d{4}$`)

// ---- Create: validation, id format, mint-after-validation ----

func TestCreate_ValidatesBeforeMintingID(t *testing.T) {
	s := newService(t)
	ctx := context.Background()

	// Incomplete: missing name -> ErrIncomplete, no row, no sequence consumed.
	bad := validInput()
	bad.Name = "   "
	if _, err := s.Create(ctx, mktStaff("EMP-LIA"), bad); !errors.Is(err, ErrIncomplete) {
		t.Fatalf("missing name err=%v want ErrIncomplete", err)
	}
	// Incomplete: neither Online nor Offline checked.
	noChecklist := validInput()
	noChecklist.Online, noChecklist.Offline = false, false
	if _, err := s.Create(ctx, mktStaff("EMP-LIA"), noChecklist); !errors.Is(err, ErrIncomplete) {
		t.Fatalf("no checklist err=%v want ErrIncomplete", err)
	}

	// No campaigns, and the CMP sequence was NOT consumed by the failed creates.
	assertCount(t, s, "SELECT COUNT(*) FROM campaigns", 0)
	assertCount(t, s, "SELECT COUNT(*) FROM id_sequences WHERE prefix='CMP'", 0)

	// Valid create -> id minted, format correct, first number 0001.
	c, err := s.Create(ctx, mktStaff("EMP-LIA"), validInput())
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if !idRe.MatchString(c.ID) {
		t.Fatalf("id %q does not match CMP-YYYYMM-NNNN", c.ID)
	}
	if c.Status != StatusDraft {
		t.Fatalf("born status=%q want %q", c.Status, StatusDraft)
	}
	if c.Owner != "EMP-LIA" {
		t.Fatalf("owner=%q want EMP-LIA", c.Owner)
	}
	if c.EndDate != nil {
		t.Fatalf("new campaign end_date=%v want nil", *c.EndDate)
	}
}

func TestCreate_ForbiddenForNonMarketing(t *testing.T) {
	s := newService(t)
	ctx := context.Background()
	if _, err := s.Create(ctx, salesStaff("EMP-SAL"), validInput()); !errors.Is(err, ErrForbidden) {
		t.Fatalf("sales create err=%v want ErrForbidden", err)
	}
	if _, err := s.Create(ctx, od("EMP-OD"), validInput()); !errors.Is(err, ErrForbidden) {
		t.Fatalf("OD create err=%v want ErrForbidden", err)
	}
	// Director may create (owns the campaign).
	if c, err := s.Create(ctx, director("EMP-DIR"), validInput()); err != nil || c.Owner != "EMP-DIR" {
		t.Fatalf("director create: c=%+v err=%v", c, err)
	}
}

// ---- State machine: every legal edge, illegal edges blocked, end_date on Closed ----

func TestTransition_LegalPathAndClosedSetsEndDate(t *testing.T) {
	s := newService(t)
	ctx := context.Background()
	owner := mktStaff("EMP-LIA")
	c, err := s.Create(ctx, owner, validInput())
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	// Draft -> Active -> Paused -> Active -> Closed -> Archived (all legal edges).
	for _, to := range []string{StatusActive, StatusPaused, StatusActive, StatusClosed, StatusArchived} {
		if _, err := s.Transition(ctx, owner, c.ID, to); err != nil {
			t.Fatalf("transition ->%s: %v", to, err)
		}
	}
	got, err := s.Get(ctx, owner, c.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.Status != StatusArchived {
		t.Fatalf("final status=%q want Archived", got.Status)
	}
	// end_date was stamped when it entered Closed (§6.3).
	if got.EndDate == nil {
		t.Fatalf("end_date nil after Closed; want set")
	}
}

func TestTransition_IllegalEdgesBlocked(t *testing.T) {
	s := newService(t)
	ctx := context.Background()
	owner := mktStaff("EMP-LIA")
	c, _ := s.Create(ctx, owner, validInput())

	// Draft -> Closed is illegal.
	if _, err := s.Transition(ctx, owner, c.ID, StatusClosed); !isBlocked(err) {
		t.Fatalf("Draft->Closed err=%v want blocked", err)
	}
	// Advance to Closed legally, then try Closed -> Active (illegal) and Archived -> Active.
	mustTransition(t, s, owner, c.ID, StatusActive)
	mustTransition(t, s, owner, c.ID, StatusClosed)
	if _, err := s.Transition(ctx, owner, c.ID, StatusActive); !isBlocked(err) {
		t.Fatalf("Closed->Active err=%v want blocked", err)
	}
	mustTransition(t, s, owner, c.ID, StatusArchived)
	if _, err := s.Transition(ctx, owner, c.ID, StatusActive); !isBlocked(err) {
		t.Fatalf("Archived->Active (terminal) err=%v want blocked", err)
	}
}

// ---- Permissions: transition authority per role ----

func TestTransition_Authority(t *testing.T) {
	s := newService(t)
	ctx := context.Background()
	c, _ := s.Create(ctx, mktStaff("EMP-LIA"), validInput())

	// A different Marketing staff cannot transition someone else's campaign.
	if _, err := s.Transition(ctx, mktStaff("EMP-DINA"), c.ID, StatusActive); !errors.Is(err, ErrForbidden) {
		t.Fatalf("other staff transition err=%v want ErrForbidden", err)
	}
	// Foreign division denied.
	if _, err := s.Transition(ctx, salesStaff("EMP-SAL"), c.ID, StatusActive); !errors.Is(err, ErrForbidden) {
		t.Fatalf("sales transition err=%v want ErrForbidden", err)
	}
	// OD is read-only -> denied.
	if _, err := s.Transition(ctx, od("EMP-OD"), c.ID, StatusActive); !errors.Is(err, ErrForbidden) {
		t.Fatalf("OD transition err=%v want ErrForbidden", err)
	}
	// Marketing lead (division-wide) may transition.
	if _, err := s.Transition(ctx, mktLead("EMP-MHEAD"), c.ID, StatusActive); err != nil {
		t.Fatalf("lead transition: %v", err)
	}
	// Director may transition.
	if _, err := s.Transition(ctx, director("EMP-DIR"), c.ID, StatusPaused); err != nil {
		t.Fatalf("director transition: %v", err)
	}
	// Owner may transition their own.
	if _, err := s.Transition(ctx, mktStaff("EMP-LIA"), c.ID, StatusActive); err != nil {
		t.Fatalf("owner transition: %v", err)
	}
}

// ---- Get/List visibility ----

func TestGetList_Visibility(t *testing.T) {
	s := newService(t)
	ctx := context.Background()
	lia := mktStaff("EMP-LIA")
	dina := mktStaff("EMP-DINA")
	cLia, _ := s.Create(ctx, lia, validInput())
	cDina, _ := s.Create(ctx, dina, validInput())

	// Staff sees own only.
	if list, err := s.List(ctx, lia); err != nil || len(list) != 1 || list[0].ID != cLia.ID {
		t.Fatalf("lia list=%v err=%v want only %s", list, err, cLia.ID)
	}
	if _, err := s.Get(ctx, lia, cDina.ID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("lia get dina err=%v want ErrForbidden", err)
	}
	// Lead sees all.
	if list, err := s.List(ctx, mktLead("EMP-MHEAD")); err != nil || len(list) != 2 {
		t.Fatalf("lead list len=%d err=%v want 2", len(list), err)
	}
	// OD sees all (read-only).
	if list, err := s.List(ctx, od("EMP-OD")); err != nil || len(list) != 2 {
		t.Fatalf("OD list len=%d err=%v want 2", len(list), err)
	}
	// Director sees all.
	if list, err := s.List(ctx, director("EMP-DIR")); err != nil || len(list) != 2 {
		t.Fatalf("director list len=%d err=%v want 2", len(list), err)
	}
	// Foreign division denied on List; not-found vs forbidden on Get.
	if _, err := s.List(ctx, salesStaff("EMP-SAL")); !errors.Is(err, ErrForbidden) {
		t.Fatalf("sales list err=%v want ErrForbidden", err)
	}
	if _, err := s.Get(ctx, salesStaff("EMP-SAL"), cLia.ID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("sales get err=%v want ErrForbidden", err)
	}
	if _, err := s.Get(ctx, lia, "CMP-000000-9999"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing get err=%v want ErrNotFound", err)
	}
}

// ---- Reassign: authority + target validation + audit ----

func TestReassign_AuthorityAndTarget(t *testing.T) {
	s := newService(t)
	ctx := context.Background()
	lia := mktStaff("EMP-LIA")
	c, _ := s.Create(ctx, lia, validInput())

	// Staff (even the owner) cannot reassign.
	if _, err := s.Reassign(ctx, lia, c.ID, "EMP-DINA"); !errors.Is(err, ErrForbidden) {
		t.Fatalf("owner reassign err=%v want ErrForbidden", err)
	}
	// OD read-only -> denied.
	if _, err := s.Reassign(ctx, od("EMP-OD"), c.ID, "EMP-DINA"); !errors.Is(err, ErrForbidden) {
		t.Fatalf("OD reassign err=%v want ErrForbidden", err)
	}
	// Target must be an active Marketing employee.
	if _, err := s.Reassign(ctx, mktLead("EMP-MHEAD"), c.ID, "EMP-SAL"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("reassign to sales err=%v want ErrNotFound", err)
	}
	if _, err := s.Reassign(ctx, mktLead("EMP-MHEAD"), c.ID, "EMP-INACT"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("reassign to inactive err=%v want ErrNotFound", err)
	}
	if _, err := s.Reassign(ctx, mktLead("EMP-MHEAD"), c.ID, "  "); !errors.Is(err, ErrIncomplete) {
		t.Fatalf("reassign empty target err=%v want ErrIncomplete", err)
	}
	// Marketing lead reassigns Lia -> Dina.
	got, err := s.Reassign(ctx, mktLead("EMP-MHEAD"), c.ID, "EMP-DINA")
	if err != nil {
		t.Fatalf("lead reassign: %v", err)
	}
	if got.Owner != "EMP-DINA" {
		t.Fatalf("owner after reassign=%q want EMP-DINA", got.Owner)
	}
	// Dina now manages it; Lia loses staff visibility.
	if _, err := s.Get(ctx, mktStaff("EMP-DINA"), c.ID); err != nil {
		t.Fatalf("dina get after reassign: %v", err)
	}
	if _, err := s.Get(ctx, lia, c.ID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("lia get after handover err=%v want ErrForbidden", err)
	}
	// Director may also reassign.
	if _, err := s.Reassign(ctx, director("EMP-DIR"), c.ID, "EMP-LIA"); err != nil {
		t.Fatalf("director reassign: %v", err)
	}
}

// ---- Immutability: transitions + reassign append audit rows, never mutate history ----

func TestAudit_AppendOnlyTrail(t *testing.T) {
	s := newService(t)
	ctx := context.Background()
	lia := mktStaff("EMP-LIA")
	c, _ := s.Create(ctx, lia, validInput())
	mustTransition(t, s, lia, c.ID, StatusActive)
	mustTransition(t, s, lia, c.ID, StatusClosed) // adds transition + set_end_date rows
	if _, err := s.Reassign(ctx, mktLead("EMP-MHEAD"), c.ID, "EMP-DINA"); err != nil {
		t.Fatalf("reassign: %v", err)
	}

	// create + 2 transitions + set_end_date + owner_reassigned = 5 rows minimum.
	var n int
	if err := s.DB.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM audit_log WHERE entity_type='campaign' AND entity_id=?`, c.ID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n < 5 {
		t.Fatalf("audit rows=%d want >=5", n)
	}
	// The transition row records status before->after (immutable append log).
	var before, after string
	if err := s.DB.QueryRowContext(ctx,
		`SELECT before_json, after_json FROM audit_log
		  WHERE entity_type='campaign' AND entity_id=? AND action='transition:Active->Closed'`, c.ID).
		Scan(&before, &after); err != nil {
		t.Fatalf("closed transition audit row missing: %v", err)
	}
}

// ---- helpers ----

func assertCount(t *testing.T, s *Service, query string, want int) {
	t.Helper()
	var n int
	if err := s.DB.QueryRow(query).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != want {
		t.Fatalf("%s = %d want %d", query, n, want)
	}
}

func mustTransition(t *testing.T, s *Service, actor permission.Actor, id, to string) {
	t.Helper()
	if _, err := s.Transition(context.Background(), actor, id, to); err != nil {
		t.Fatalf("transition ->%s: %v", to, err)
	}
}

func isBlocked(err error) bool {
	var be *statemachine.BlockedError
	return errors.As(err, &be) && be.Message == statemachine.DefaultBlockMessage
}
