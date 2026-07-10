package statemachine

import (
	"context"
	"errors"
	"fmt"
	"testing"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
	"github.com/meagrup/agencyapp/backend/internal/core/db"
	"github.com/meagrup/agencyapp/backend/internal/core/events"
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
	eng    *Engine
	store  *memStore
	flags  *memFlags
	logger *recLogger
	events int
}

func newHarness() *harness {
	h := &harness{store: newMemStore(), flags: newMemFlags(), logger: &recLogger{}}
	bus := events.NewInMemoryBus()
	bus.Subscribe("*", func(_ context.Context, _ events.Event) { h.events++ })
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
				// supply the highest-privilege role so role-restricted edges pass
				err := h.eng.Transition(ctx, nil, TransitionRequest{
					EntityType: et, EntityID: id, To: tr.To,
					Actor: "emp-1", ActorRoles: []Role{RoleLeadSPV},
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
				if e.Actor != "emp-1" || e.Action != "transition" {
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
