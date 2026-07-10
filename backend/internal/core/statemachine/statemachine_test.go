package statemachine

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"testing"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
	"github.com/meagrup/agencyapp/backend/internal/core/db"
	"github.com/meagrup/agencyapp/backend/internal/core/events"
	"github.com/meagrup/agencyapp/backend/internal/core/notify"
	"github.com/meagrup/agencyapp/backend/internal/core/testdb"
)

// ---- in-memory fakes -------------------------------------------------------

func key(e EntityType, id string) string { return string(e) + "|" + id }

type memStore struct {
	status   map[string]Status
	setCalls int
}

func newMemStore() *memStore { return &memStore{status: map[string]Status{}} }

func (s *memStore) seed(e EntityType, id string, st Status) { s.status[key(e, id)] = st }

func (s *memStore) GetStatus(_ context.Context, _ db.Queryer, e EntityType, id string) (Status, error) {
	v, ok := s.status[key(e, id)]
	if !ok {
		return "", fmt.Errorf("no such entity %s/%s", e, id)
	}
	return v, nil
}

func (s *memStore) SetStatus(_ context.Context, _ db.Queryer, e EntityType, id string, to Status) error {
	s.status[key(e, id)] = to
	s.setCalls++
	return nil
}

type memFlags struct {
	flags    map[string]map[Flag]bool
	setCalls int
	clrCalls int
}

func newMemFlags() *memFlags { return &memFlags{flags: map[string]map[Flag]bool{}} }

func (f *memFlags) SetFlag(_ context.Context, _ db.Queryer, e EntityType, id string, fl Flag) error {
	if f.flags[key(e, id)] == nil {
		f.flags[key(e, id)] = map[Flag]bool{}
	}
	f.flags[key(e, id)][fl] = true
	f.setCalls++
	return nil
}

func (f *memFlags) ClearFlag(_ context.Context, _ db.Queryer, e EntityType, id string, fl Flag) error {
	if f.flags[key(e, id)] == nil {
		f.flags[key(e, id)] = map[Flag]bool{}
	}
	f.flags[key(e, id)][fl] = false
	f.clrCalls++
	return nil
}

func (f *memFlags) isSet(e EntityType, id string, fl Flag) bool {
	m := f.flags[key(e, id)]
	return m != nil && m[fl]
}

type recLogger struct{ entries []audit.Entry }

func (l *recLogger) Append(_ context.Context, _ db.Queryer, e audit.Entry) (int64, error) {
	l.entries = append(l.entries, e)
	return int64(len(l.entries)), nil
}

func (l *recLogger) List(_ context.Context, _ db.Queryer, _ audit.Filter) ([]audit.Record, error) {
	return nil, nil
}

type harness struct {
	eng       *Engine
	store     *memStore
	flags     *memFlags
	logger    *recLogger
	events    int
	lastEvent events.Event
}

func newHarness() *harness {
	h := &harness{store: newMemStore(), flags: newMemFlags(), logger: &recLogger{}}
	bus := events.NewInMemoryBus()
	bus.Subscribe("*", func(_ context.Context, e events.Event) {
		h.events++
		h.lastEvent = e
	})
	h.eng = New(h.store, h.flags, h.logger, bus)
	return h
}

func (h *harness) sideEffects() (setStatus, audit, events int) {
	return h.store.setCalls, len(h.logger.entries), h.events
}

// ---- config integrity ------------------------------------------------------

func TestConfigIntegrity(t *testing.T) {
	if len(machines) != 10 {
		t.Fatalf("expected 10 machines, got %d", len(machines))
	}
	total := 0
	for et, m := range machines {
		if m.Entity != et {
			t.Errorf("%s: machine.Entity=%s mismatched with registry key", et, m.Entity)
		}
		if len(m.Initial) == 0 {
			t.Errorf("%s: no initial state declared", et)
		}
		if m.BlockMsg == "" {
			t.Errorf("%s: no BlockMsg", et)
		}
		if m.EventName == "" {
			t.Errorf("%s: no EventName", et)
		}
		// initial states must be real states of the machine
		states := map[Status]bool{}
		for _, s := range m.States() {
			states[s] = true
		}
		for _, in := range m.Initial {
			if !states[in] {
				t.Errorf("%s: initial %q not in states", et, in)
			}
		}
		// terminal states must have no outgoing edges
		for _, term := range m.Terminal {
			for _, tr := range m.Transitions {
				if tr.From == term {
					t.Errorf("%s: terminal %q has outgoing edge to %q", et, term, tr.To)
				}
			}
		}
		// no duplicate edges
		seen := map[string]bool{}
		for _, tr := range m.Transitions {
			k := string(tr.From) + ">>" + string(tr.To)
			if seen[k] {
				t.Errorf("%s: duplicate edge %s", et, k)
			}
			seen[k] = true
		}
		total += len(m.Transitions)
		t.Logf("machine %-24s states=%2d transitions=%2d terminals=%d flags=%d",
			et, len(m.States()), len(m.Transitions), len(m.Terminal), len(m.Flags))
	}
	t.Logf("TOTAL: %d machines, %d transitions encoded", len(machines), total)

	// flags only where the PRD declares them (§4 transaction).
	for et, m := range machines {
		if et == EntityTransaction {
			if len(m.Flags) != 2 {
				t.Errorf("transaction should have 2 flags, got %d", len(m.Flags))
			}
		} else if len(m.Flags) != 0 {
			t.Errorf("%s: unexpected flags %v", et, m.Flags)
		}
	}
}

// ---- every allowed transition passes with exactly one audit row + event ----

func TestAllowedTransitions(t *testing.T) {
	ctx := context.Background()
	for et, m := range machines {
		for _, tr := range m.Transitions {
			tr := tr
			name := fmt.Sprintf("%s:%s->%s", et, tr.From, tr.To)
			t.Run(name, func(t *testing.T) {
				h := newHarness()
				id := "X-1"
				h.store.seed(et, id, tr.From)
				// Auto edges are system-only; human edges get the
				// highest-privilege role so role-restricted edges pass.
				actor := "emp-1"
				if tr.Auto {
					actor = ActorSystem
				}
				err := h.eng.Transition(ctx, nil, TransitionRequest{
					EntityType: et, EntityID: id, To: tr.To,
					Actor: actor, ActorRoles: []Role{RoleLeadSPV},
				})
				if err != nil {
					t.Fatalf("expected success, got %v", err)
				}
				if got := h.store.status[key(et, id)]; got != tr.To {
					t.Errorf("status = %q, want %q", got, tr.To)
				}
				ss, au, ev := h.sideEffects()
				if ss != 1 || au != 1 || ev != 1 {
					t.Errorf("side effects setStatus=%d audit=%d events=%d, want 1/1/1", ss, au, ev)
				}
				// audit before/after must reflect the transition
				e := h.logger.entries[0]
				if e.Actor != actor || e.Action != "transition" {
					t.Errorf("audit entry = %+v", e)
				}
				if string(e.Before) != `{"status":"`+string(tr.From)+`"}` {
					t.Errorf("audit before = %s", e.Before)
				}
				if string(e.After) != `{"status":"`+string(tr.To)+`"}` {
					t.Errorf("audit after = %s", e.After)
				}
			})
		}
	}
}

// ---- full sweep: every from->to NOT in the table is blocked, zero effects --

func TestBlockedSweepAllUnlistedPairs(t *testing.T) {
	ctx := context.Background()
	for et, m := range machines {
		states := m.States()
		for _, from := range states {
			for _, to := range states {
				if m.find(from, to) != nil {
					continue // listed edge; covered by TestAllowedTransitions
				}
				from, to := from, to
				t.Run(fmt.Sprintf("%s:%s-x>%s", et, from, to), func(t *testing.T) {
					h := newHarness()
					id := "X-1"
					h.store.seed(et, id, from)
					err := h.eng.Transition(ctx, nil, TransitionRequest{
						EntityType: et, EntityID: id, To: to,
						Actor: "emp-1", ActorRoles: []Role{RoleLeadSPV},
					})
					var be *BlockedError
					if !errors.As(err, &be) {
						t.Fatalf("expected *BlockedError, got %v", err)
					}
					if be.Message != m.BlockMsg {
						t.Errorf("message = %q, want %q", be.Message, m.BlockMsg)
					}
					// nothing changed
					if got := h.store.status[key(et, id)]; got != from {
						t.Errorf("status mutated to %q", got)
					}
					if ss, au, ev := h.sideEffects(); ss != 0 || au != 0 || ev != 0 {
						t.Errorf("blocked transition had side effects: setStatus=%d audit=%d events=%d", ss, au, ev)
					}
				})
			}
		}
	}
}

// ---- representative unlisted transition per machine (explicit) -------------

func TestRepresentativeUnlistedPerMachine(t *testing.T) {
	ctx := context.Background()
	cases := []struct {
		et       EntityType
		from, to Status
	}{
		{EntityProspect, ProspectNewLead, ProspectClosedSuccess},
		{EntityCampaign, CampaignDraft, CampaignArchived},
		{EntityTransaction, TxnLunas, TxnMenungguVerifikasi},
		{EntityInstallment, InstTerverifikasi, InstBelumJatuhTempo},
		{EntityService, ServiceInExecution, ServiceIntake},
		{EntityBrief, BriefApproved, BriefInProgress},
		{EntityCreatorBooking, BkgQCPassed, BkgSourcing},
		{EntityCreatorPaymentRequest, CprRequested, CprPaid},
		{EntityLiveStreamSession, LssRequested, LssReconciled},
		{EntityComplaint, CplOpen, CplClosed},
	}
	for _, c := range cases {
		h := newHarness()
		h.store.seed(c.et, "X-1", c.from)
		err := h.eng.Transition(ctx, nil, TransitionRequest{
			EntityType: c.et, EntityID: "X-1", To: c.to, Actor: "emp-1", ActorRoles: []Role{RoleLeadSPV},
		})
		var be *BlockedError
		if !errors.As(err, &be) {
			t.Errorf("%s %s->%s: expected BlockedError, got %v", c.et, c.from, c.to, err)
			continue
		}
		if be.Message != machines[c.et].BlockMsg {
			t.Errorf("%s: message = %q", c.et, be.Message)
		}
	}
}

// ---- terminal states have no exit ------------------------------------------

func TestTerminalNoExit(t *testing.T) {
	ctx := context.Background()
	for et, m := range machines {
		for _, term := range m.Terminal {
			h := newHarness()
			h.store.seed(et, "X-1", term)
			// try every state as a target; all must block
			for _, to := range m.States() {
				err := h.eng.Transition(ctx, nil, TransitionRequest{
					EntityType: et, EntityID: "X-1", To: to, Actor: "emp-1", ActorRoles: []Role{RoleLeadSPV},
				})
				var be *BlockedError
				if !errors.As(err, &be) {
					t.Errorf("%s terminal %s->%s: expected block, got %v", et, term, to, err)
				}
			}
		}
	}
}

// ---- role-restricted transition: staff denied, lead_spv allowed ------------

func TestRoleRestrictedBriefBlocked(t *testing.T) {
	ctx := context.Background()

	// staff denied
	h := newHarness()
	h.store.seed(EntityBrief, "BRF-1", BriefToDo)
	err := h.eng.Transition(ctx, nil, TransitionRequest{
		EntityType: EntityBrief, EntityID: "BRF-1", To: BriefBlocked,
		Actor: "staff-1", ActorRoles: []Role{"staff"},
	})
	var be *BlockedError
	if !errors.As(err, &be) {
		t.Fatalf("staff: expected BlockedError, got %v", err)
	}
	if be.Reason != reasonRoleDenied {
		t.Errorf("staff: reason = %q, want role_denied", be.Reason)
	}
	if be.Message != machines[EntityBrief].BlockMsg {
		t.Errorf("staff: message = %q", be.Message)
	}
	if ss, au, ev := h.sideEffects(); ss != 0 || au != 0 || ev != 0 {
		t.Errorf("role-denied had side effects: %d/%d/%d", ss, au, ev)
	}

	// lead_spv allowed
	h2 := newHarness()
	h2.store.seed(EntityBrief, "BRF-1", BriefToDo)
	if err := h2.eng.Transition(ctx, nil, TransitionRequest{
		EntityType: EntityBrief, EntityID: "BRF-1", To: BriefBlocked,
		Actor: "spv-1", ActorRoles: []Role{RoleLeadSPV},
	}); err != nil {
		t.Fatalf("lead_spv: expected success, got %v", err)
	}
	if h2.store.status[key(EntityBrief, "BRF-1")] != BriefBlocked {
		t.Errorf("lead_spv: status not updated")
	}

	// layered role (staff+lead_spv) allowed
	h3 := newHarness()
	h3.store.seed(EntityBrief, "BRF-1", BriefToDo)
	if err := h3.eng.Transition(ctx, nil, TransitionRequest{
		EntityType: EntityBrief, EntityID: "BRF-1", To: BriefBlocked,
		Actor: "emp-1", ActorRoles: []Role{"staff", RoleLeadSPV},
	}); err != nil {
		t.Fatalf("layered: expected success, got %v", err)
	}
}

// prospect negotiation approval is also SPV/Lead-only (PERMISSIONS M0).
func TestRoleRestrictedNegotiationApproval(t *testing.T) {
	ctx := context.Background()
	h := newHarness()
	h.store.seed(EntityProspect, "PRSP-1", ProspectNegPendingApprove)
	err := h.eng.Transition(ctx, nil, TransitionRequest{
		EntityType: EntityProspect, EntityID: "PRSP-1", To: ProspectNegApproved,
		Actor: "sales-1", ActorRoles: []Role{"staff"},
	})
	var be *BlockedError
	if !errors.As(err, &be) || be.Reason != reasonRoleDenied {
		t.Fatalf("staff approving negotiation should be role-denied, got %v", err)
	}
}

// ---- missing actor rejected, zero side effects -----------------------------

func TestMissingActorRejected(t *testing.T) {
	ctx := context.Background()
	h := newHarness()
	h.store.seed(EntityCampaign, "CMP-1", CampaignDraft)
	err := h.eng.Transition(ctx, nil, TransitionRequest{
		EntityType: EntityCampaign, EntityID: "CMP-1", To: CampaignActive, Actor: "",
	})
	if !errors.Is(err, ErrActorRequired) {
		t.Fatalf("expected ErrActorRequired, got %v", err)
	}
	if got := h.store.status[key(EntityCampaign, "CMP-1")]; got != CampaignDraft {
		t.Errorf("status mutated to %q", got)
	}
	if ss, au, ev := h.sideEffects(); ss != 0 || au != 0 || ev != 0 {
		t.Errorf("missing-actor had side effects: %d/%d/%d", ss, au, ev)
	}
}

func TestUnknownEntityRejected(t *testing.T) {
	h := newHarness()
	err := h.eng.Transition(context.Background(), nil, TransitionRequest{
		EntityType: "nonesuch", EntityID: "X", To: "Y", Actor: "emp-1",
	})
	if !errors.Is(err, ErrUnknownEntity) {
		t.Fatalf("expected ErrUnknownEntity, got %v", err)
	}
}

// ---- flags: set/clear independent of status, audited, not in validation ----

func TestFlagsIndependentOfStatus(t *testing.T) {
	ctx := context.Background()
	h := newHarness()
	// status is terminal [Lunas]; flags must still work independently.
	h.store.seed(EntityTransaction, "TRX-1", TxnLunas)

	if err := h.eng.SetFlag(ctx, nil, FlagRequest{
		EntityType: EntityTransaction, EntityID: "TRX-1", Flag: FlagJatuhTempo, Actor: "fin-1",
	}); err != nil {
		t.Fatalf("SetFlag: %v", err)
	}
	if !h.flags.isSet(EntityTransaction, "TRX-1", FlagJatuhTempo) {
		t.Errorf("flag not set")
	}
	// status untouched, no SetStatus call; one audit row + one event for the flag.
	if h.store.setCalls != 0 {
		t.Errorf("flag change touched status store")
	}
	if got := h.store.status[key(EntityTransaction, "TRX-1")]; got != TxnLunas {
		t.Errorf("status changed to %q", got)
	}
	if len(h.logger.entries) != 1 || h.logger.entries[0].Action != "flag_set" {
		t.Errorf("expected 1 flag_set audit row, got %+v", h.logger.entries)
	}
	if h.events != 1 {
		t.Errorf("expected 1 flag event, got %d", h.events)
	}

	if err := h.eng.SetFlag(ctx, nil, FlagRequest{
		EntityType: EntityTransaction, EntityID: "TRX-1", Flag: FlagBermasalah, Actor: "fin-1",
	}); err != nil {
		t.Fatalf("SetFlag Bermasalah: %v", err)
	}
	if err := h.eng.ClearFlag(ctx, nil, FlagRequest{
		EntityType: EntityTransaction, EntityID: "TRX-1", Flag: FlagJatuhTempo, Actor: "fin-1",
	}); err != nil {
		t.Fatalf("ClearFlag: %v", err)
	}
	if h.flags.isSet(EntityTransaction, "TRX-1", FlagJatuhTempo) {
		t.Errorf("flag still set after clear")
	}
	if h.logger.entries[2].Action != "flag_clear" {
		t.Errorf("expected flag_clear audit, got %q", h.logger.entries[2].Action)
	}
}

func TestFlagRejections(t *testing.T) {
	ctx := context.Background()
	h := newHarness()

	// unknown flag on a machine that has no flags
	err := h.eng.SetFlag(ctx, nil, FlagRequest{
		EntityType: EntityCampaign, EntityID: "CMP-1", Flag: FlagJatuhTempo, Actor: "emp-1",
	})
	if !errors.Is(err, ErrUnknownFlag) {
		t.Errorf("expected ErrUnknownFlag, got %v", err)
	}

	// missing actor
	err = h.eng.SetFlag(ctx, nil, FlagRequest{
		EntityType: EntityTransaction, EntityID: "TRX-1", Flag: FlagJatuhTempo, Actor: "",
	})
	if !errors.Is(err, ErrActorRequired) {
		t.Errorf("expected ErrActorRequired, got %v", err)
	}
	if h.flags.setCalls != 0 || len(h.logger.entries) != 0 {
		t.Errorf("rejected flag op had side effects")
	}
}

// ---- FIX 1: Auto edges are system-only -------------------------------------

// Every Auto edge in the registry must pass for the system actor and be
// blocked (reason auto_only, zero side effects) for a human/role actor.
func TestAutoEdgesAreSystemOnly(t *testing.T) {
	ctx := context.Background()
	autoSeen := 0
	for et, m := range machines {
		for _, tr := range m.Transitions {
			if !tr.Auto {
				continue
			}
			autoSeen++

			// system actor: allowed
			hs := newHarness()
			hs.store.seed(et, "X-1", tr.From)
			if err := hs.eng.Transition(ctx, nil, TransitionRequest{
				EntityType: et, EntityID: "X-1", To: tr.To, Actor: ActorSystem,
			}); err != nil {
				t.Errorf("%s %s->%s: system actor should pass, got %v", et, tr.From, tr.To, err)
			} else if ss, au, ev := hs.sideEffects(); ss != 1 || au != 1 || ev != 1 {
				t.Errorf("%s %s->%s: system side effects %d/%d/%d, want 1/1/1", et, tr.From, tr.To, ss, au, ev)
			}

			// human/role actor: blocked auto_only, zero side effects
			hh := newHarness()
			hh.store.seed(et, "X-1", tr.From)
			err := hh.eng.Transition(ctx, nil, TransitionRequest{
				EntityType: et, EntityID: "X-1", To: tr.To, Actor: "emp-1", ActorRoles: []Role{RoleLeadSPV},
			})
			var be *BlockedError
			if !errors.As(err, &be) {
				t.Errorf("%s %s->%s: staff should be blocked, got %v", et, tr.From, tr.To, err)
				continue
			}
			if be.Reason != reasonAutoOnly {
				t.Errorf("%s %s->%s: reason = %q, want auto_only", et, tr.From, tr.To, be.Reason)
			}
			if be.Message != m.BlockMsg {
				t.Errorf("%s %s->%s: message = %q, want %q", et, tr.From, tr.To, be.Message, m.BlockMsg)
			}
			if got := hh.store.status[key(et, "X-1")]; got != tr.From {
				t.Errorf("%s %s->%s: status mutated to %q", et, tr.From, tr.To, got)
			}
			if ss, au, ev := hh.sideEffects(); ss != 0 || au != 0 || ev != 0 {
				t.Errorf("%s %s->%s: blocked auto had side effects %d/%d/%d", et, tr.From, tr.To, ss, au, ev)
			}
		}
	}
	if autoSeen == 0 {
		t.Fatal("expected at least one Auto edge in the registry")
	}
}

// ---- FIX 2: per-edge Event overrides fire the catalog slug -----------------

// Each edge that carries a Transition.Event must publish that slug (not the
// machine-generic EventName); a plain edge still uses the generic name.
func TestPerEdgeEventOverridesArePublished(t *testing.T) {
	ctx := context.Background()
	cases := []struct {
		et       EntityType
		from, to Status
		want     string
	}{
		{EntityProspect, ProspectQualified, ProspectNegPendingApprove, "m0.negotiation.pending_approval_submitted"},
		{EntityProspect, ProspectNegRevisionReq, ProspectNegPendingApprove, "m0.negotiation.pending_approval_submitted"},
		{EntityProspect, ProspectNegPendingApprove, ProspectNegApproved, "m0.negotiation.decision"},
		{EntityProspect, ProspectNegPendingApprove, ProspectNegRevisionReq, "m0.negotiation.decision"},
		{EntityProspect, ProspectNegPendingApprove, ProspectNegRejected, "m0.negotiation.decision"},
		{EntityCreatorBooking, BkgQCReview, BkgEscalated, "m9.qc_or_booking.escalated"},
		{EntityLiveStreamSession, LssCompleted, LssDiscrepancy, "m10.session.discrepancy_flagged"},
	}
	for _, c := range cases {
		h := newHarness()
		h.store.seed(c.et, "X-1", c.from)
		if err := h.eng.Transition(ctx, nil, TransitionRequest{
			EntityType: c.et, EntityID: "X-1", To: c.to, Actor: "emp-1", ActorRoles: []Role{RoleLeadSPV},
		}); err != nil {
			t.Fatalf("%s %s->%s: %v", c.et, c.from, c.to, err)
		}
		if h.lastEvent.Name != c.want {
			t.Errorf("%s %s->%s: event = %q, want %q", c.et, c.from, c.to, h.lastEvent.Name, c.want)
		}
	}

	// A non-override edge still publishes the machine-generic EventName.
	h := newHarness()
	h.store.seed(EntityCampaign, "CMP-1", CampaignDraft)
	if err := h.eng.Transition(ctx, nil, TransitionRequest{
		EntityType: EntityCampaign, EntityID: "CMP-1", To: CampaignActive, Actor: "emp-1",
	}); err != nil {
		t.Fatal(err)
	}
	if h.lastEvent.Name != "campaign.status_transition" {
		t.Errorf("generic edge event = %q, want campaign.status_transition", h.lastEvent.Name)
	}
}

// Every non-empty Transition.Event across all machines must be a real slug in
// notify's DefaultCatalog, otherwise the event fires but produces no
// notification (silent no-op in Center.handle).
func TestAllEdgeEventOverridesAreCataloged(t *testing.T) {
	cataloged := map[string]bool{}
	for _, name := range notify.DefaultCatalog().EventNames() {
		cataloged[name] = true
	}
	for et, m := range machines {
		for _, tr := range m.Transitions {
			if tr.Event == "" {
				continue
			}
			if !cataloged[tr.Event] {
				t.Errorf("%s %s->%s: Event %q is not registered in notify.DefaultCatalog()", et, tr.From, tr.To, tr.Event)
			}
		}
	}
}

// ---- FIX 3: transaction-aware event buffering ------------------------------

// dbStatusStore is a Store backed by a real table, so a *sql.Tx rollback
// actually undoes the status write (the in-memory memStore cannot model tx
// semantics).
type dbStatusStore struct{}

func (dbStatusStore) GetStatus(ctx context.Context, q db.Queryer, e EntityType, id string) (Status, error) {
	var s string
	if err := q.QueryRowContext(ctx,
		"SELECT status FROM sm_test_status WHERE entity=? AND id=?", string(e), id).Scan(&s); err != nil {
		return "", err
	}
	return Status(s), nil
}

func (dbStatusStore) SetStatus(ctx context.Context, q db.Queryer, e EntityType, id string, to Status) error {
	_, err := q.ExecContext(ctx,
		"INSERT INTO sm_test_status (entity, id, status) VALUES (?,?,?) ON DUPLICATE KEY UPDATE status=VALUES(status)",
		string(e), id, string(to))
	return err
}

// newTxHarness returns an Engine backed by a real DB (dbStatusStore + the
// MySQL audit logger) and an *int that counts events actually published on
// the bus.
func newTxHarness(t *testing.T) (*Engine, *sql.DB, *int) {
	t.Helper()
	conn := testdb.New(t)
	if _, err := conn.Exec(`CREATE TABLE sm_test_status (
		entity VARCHAR(64)  NOT NULL,
		id     VARCHAR(64)  NOT NULL,
		status VARCHAR(191) NOT NULL,
		PRIMARY KEY (entity, id))`); err != nil {
		t.Fatalf("create sm_test_status: %v", err)
	}
	count := new(int)
	bus := events.NewInMemoryBus()
	bus.Subscribe("*", func(_ context.Context, _ events.Event) { *count++ })
	eng := New(dbStatusStore{}, nil, audit.NewMySQL(), bus)
	return eng, conn, count
}

func seedDBStatus(t *testing.T, conn *sql.DB, e EntityType, id string, s Status) {
	t.Helper()
	if _, err := conn.Exec("INSERT INTO sm_test_status (entity, id, status) VALUES (?,?,?)", string(e), id, string(s)); err != nil {
		t.Fatalf("seed status: %v", err)
	}
}

func getDBStatus(t *testing.T, conn *sql.DB, e EntityType, id string) Status {
	t.Helper()
	var s string
	if err := conn.QueryRow("SELECT status FROM sm_test_status WHERE entity=? AND id=?", string(e), id).Scan(&s); err != nil {
		t.Fatalf("get status: %v", err)
	}
	return Status(s)
}

func auditCount(t *testing.T, conn *sql.DB) int {
	t.Helper()
	var n int
	if err := conn.QueryRow("SELECT COUNT(*) FROM audit_log").Scan(&n); err != nil {
		t.Fatalf("audit count: %v", err)
	}
	return n
}

// (a) InTx with a failing fn rolls back status + audit AND publishes no event.
func TestInTx_RollbackDropsStatusAuditAndEvents(t *testing.T) {
	ctx := context.Background()
	eng, conn, count := newTxHarness(t)
	seedDBStatus(t, conn, EntityCampaign, "CMP-1", CampaignDraft)

	boom := errors.New("boom")
	err := eng.InTx(ctx, conn, func(tx *sql.Tx) error {
		if err := eng.Transition(ctx, tx, TransitionRequest{
			EntityType: EntityCampaign, EntityID: "CMP-1", To: CampaignActive, Actor: "emp-1",
		}); err != nil {
			return err
		}
		return boom // force rollback AFTER a successful transition
	})
	if !errors.Is(err, boom) {
		t.Fatalf("expected boom, got %v", err)
	}
	if got := getDBStatus(t, conn, EntityCampaign, "CMP-1"); got != CampaignDraft {
		t.Errorf("status = %q, want rolled back to Draft", got)
	}
	if n := auditCount(t, conn); n != 0 {
		t.Errorf("audit rows = %d, want 0 (rolled back)", n)
	}
	if *count != 0 {
		t.Errorf("events published = %d, want 0 (dropped on rollback)", *count)
	}
}

// (b) InTx success publishes exactly one event, and only AFTER commit.
func TestInTx_CommitPublishesExactlyOneEventAfterCommit(t *testing.T) {
	ctx := context.Background()
	eng, conn, count := newTxHarness(t)
	seedDBStatus(t, conn, EntityCampaign, "CMP-1", CampaignDraft)

	err := eng.InTx(ctx, conn, func(tx *sql.Tx) error {
		if err := eng.Transition(ctx, tx, TransitionRequest{
			EntityType: EntityCampaign, EntityID: "CMP-1", To: CampaignActive, Actor: "emp-1",
		}); err != nil {
			return err
		}
		if *count != 0 {
			t.Errorf("event published before commit: count=%d, want 0 (buffered)", *count)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("InTx: %v", err)
	}
	if got := getDBStatus(t, conn, EntityCampaign, "CMP-1"); got != CampaignActive {
		t.Errorf("status = %q, want Active", got)
	}
	if n := auditCount(t, conn); n != 1 {
		t.Errorf("audit rows = %d, want 1", n)
	}
	if *count != 1 {
		t.Errorf("events published = %d, want 1 (after commit)", *count)
	}
}

// (c) A raw *sql.Tx whose buffer is never drained publishes nothing; and
// DropPending clears the buffer so a later PublishPending is a no-op.
func TestRawTx_WithoutPublishPending_NoPublish(t *testing.T) {
	ctx := context.Background()
	eng, conn, count := newTxHarness(t)
	seedDBStatus(t, conn, EntityCampaign, "CMP-1", CampaignDraft)

	tx, err := conn.BeginTx(ctx, nil)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	if err := eng.Transition(ctx, tx, TransitionRequest{
		EntityType: EntityCampaign, EntityID: "CMP-1", To: CampaignActive, Actor: "emp-1",
	}); err != nil {
		_ = tx.Rollback()
		t.Fatalf("transition: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("commit: %v", err)
	}
	// Buffered but never drained by the caller => no publish.
	if *count != 0 {
		t.Errorf("events = %d, want 0 (never PublishPending'd)", *count)
	}
	// DropPending clears it: a subsequent PublishPending publishes nothing.
	eng.DropPending(tx)
	eng.PublishPending(ctx, tx)
	if *count != 0 {
		t.Errorf("events after Drop+Publish = %d, want 0 (buffer cleared)", *count)
	}
}

// (d) A plain *sql.DB Queryer keeps today's immediate-publish behaviour.
func TestPlainDB_PublishesImmediately(t *testing.T) {
	ctx := context.Background()
	eng, conn, count := newTxHarness(t)
	seedDBStatus(t, conn, EntityCampaign, "CMP-1", CampaignDraft)

	if err := eng.Transition(ctx, conn, TransitionRequest{
		EntityType: EntityCampaign, EntityID: "CMP-1", To: CampaignActive, Actor: "emp-1",
	}); err != nil {
		t.Fatalf("transition: %v", err)
	}
	if got := getDBStatus(t, conn, EntityCampaign, "CMP-1"); got != CampaignActive {
		t.Errorf("status = %q, want Active", got)
	}
	if *count != 1 {
		t.Errorf("events = %d, want 1 (immediate publish on *sql.DB)", *count)
	}
}

// setting a flag never satisfies a status transition (validation ignores flags)
func TestFlagNotPartOfTransitionValidation(t *testing.T) {
	ctx := context.Background()
	h := newHarness()
	h.store.seed(EntityTransaction, "TRX-1", TxnMenungguVerifikasi)
	// set both flags
	_ = h.eng.SetFlag(ctx, nil, FlagRequest{EntityType: EntityTransaction, EntityID: "TRX-1", Flag: FlagJatuhTempo, Actor: "fin-1"})
	_ = h.eng.SetFlag(ctx, nil, FlagRequest{EntityType: EntityTransaction, EntityID: "TRX-1", Flag: FlagBermasalah, Actor: "fin-1"})
	// an unlisted transition is STILL blocked regardless of flags
	err := h.eng.Transition(ctx, nil, TransitionRequest{
		EntityType: EntityTransaction, EntityID: "TRX-1", To: TxnMenungguVerifikasi, Actor: "fin-1",
	})
	var be *BlockedError
	if !errors.As(err, &be) {
		t.Fatalf("expected blocked self-transition, got %v", err)
	}
}
