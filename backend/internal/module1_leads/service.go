package leads

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
	"github.com/meagrup/agencyapp/backend/internal/core/authz"
	"github.com/meagrup/agencyapp/backend/internal/core/db"
	"github.com/meagrup/agencyapp/backend/internal/core/ids"
)

// Audit action strings (entity_type is always "lead").
const (
	auditEntityLead  = "lead"
	actionCreate     = "create"
	actionReopen     = "reopen"
	actionBlockedDup = "dedup_blocked_duplicate" // M1-OA-6: attribution logged, not counted
	actionLastTouch  = "last_touch_update"
	actionManualFlag = "manual_review_flag"
)

// ValidationError carries a byte-exact BI mandatory-field message (CLAUDE.md
// convention #5). No LEAD id is ever issued when this is returned.
type ValidationError struct{ Message string }

func (e *ValidationError) Error() string { return e.Message }

// BlockedError is returned when the dedup engine blocks an intake. Message is
// the byte-exact BI string when the PRD specifies one; for the [Pool]
// duplicate case the PRD specifies no user string, so Message is empty and the
// caller uses Outcome + ExistingLeadID to point at the existing record.
type BlockedError struct {
	Outcome        Outcome
	ExistingLeadID string
	Message        string
}

func (e *BlockedError) Error() string {
	if e.Message != "" {
		return e.Message
	}
	return fmt.Sprintf("leads: intake blocked (%s); existing lead %s", e.Outcome, e.ExistingLeadID)
}

// Service is the Module 1 intake + dedup orchestrator.
type Service struct {
	checker  authz.Checker
	audit    audit.Logger
	ids      ids.Generator
	attempts AttemptCreator
	norm     Normalizer
}

// NewService wires the Module 1 service. norm may be the zero Normalizer, in
// which case the M1 §9.4 default is used.
func NewService(checker authz.Checker, logger audit.Logger, idgen ids.Generator, attempts AttemptCreator, norm Normalizer) *Service {
	if len(norm.StripPrefixes) == 0 && !norm.StripSpaces {
		norm = DefaultNormalizer()
	}
	return &Service{checker: checker, audit: logger, ids: idgen, attempts: attempts, norm: norm}
}

// ---- Sales single registration (§4 / M0 §3) --------------------------------

// SalesRegistrationForm is the Sales registration door form (§4 rule 1).
type SalesRegistrationForm struct {
	LeadName       string
	Phone          string
	Email          string // optional
	Source         string // reference list (§4 rule 3)
	OriginCampaign string // conditional (§9.3): mandatory for {Iklan, Broadcast, Event, Kulwa}
}

func (f SalesRegistrationForm) validate() error {
	if f.LeadName == "" || f.Phone == "" || f.Source == "" || !isValidSource(f.Source) {
		return &ValidationError{Message: MsgDataTidakLengkapForm}
	}
	if requiresOriginCampaign(f.Source) && f.OriginCampaign == "" {
		return &ValidationError{Message: MsgDataTidakLengkapForm}
	}
	return nil
}

// RegistrationResult is returned on a successful Sales registration.
type RegistrationResult struct {
	Lead       *Lead
	ProspectID string
	Reopened   bool // the record existed as Rejected/Not Qualified and was reopened
}

// RegisterSalesLead runs the Sales single-registration door (§4). On success
// it creates the LEAD (Origin Division = Sales, exclusive scouted) and spawns
// a Prospect attempt through the injected AttemptCreator, atomically. On a
// dedup collision it returns *BlockedError (nothing created for a hard block;
// block side effects — Last-Touch, manual-review flag, attribution audit — DO
// commit). Mandatory-field failure returns *ValidationError before any id is
// issued.
func (s *Service) RegisterSalesLead(ctx context.Context, conn *sql.DB, actor authz.Identity, form SalesRegistrationForm) (*RegistrationResult, error) {
	if err := s.authorizeSales(actor); err != nil {
		return nil, err
	}
	if err := form.validate(); err != nil {
		return nil, err
	}

	key := s.norm.Normalize(form.Phone)
	if key == "" {
		return nil, &ValidationError{Message: MsgDataTidakLengkapForm}
	}

	var (
		result   *RegistrationResult
		blockErr *BlockedError
	)
	err := db.WithTx(ctx, conn, func(tx *sql.Tx) error {
		now := time.Now().UTC()
		existing, err := findByPhone(ctx, tx, key)
		if err != nil && err != ErrLeadNotFound {
			return err
		}

		snap := s.snapshot(ctx, tx, existing)
		dec := Decide(snap, DoorSalesRegistration, form.OriginCampaign)

		// M1-OA-4: phone matched but name differs substantially → raise a
		// manual-review flag on the existing record (never a silent merge, and
		// never a second record). Applies to every matched outcome.
		if existing != nil && nameDiffersSubstantially(existing.LeadName, form.LeadName) {
			if err := s.raiseManualReview(ctx, tx, actor, existing.LeadID, now); err != nil {
				return err
			}
		}

		switch dec.Outcome {
		case OutcomeCreate:
			result, err = s.createScouted(ctx, tx, actor, form, key, now)
			return err

		case OutcomeReopen:
			result, err = s.reopenForSales(ctx, tx, actor, existing, now)
			return err

		case OutcomeBlockPool:
			if dec.WriteLastTouch {
				if err := s.writeLastTouch(ctx, tx, actor, existing.LeadID, form.OriginCampaign, existing.OriginCampaign, now); err != nil {
					return err
				}
			}
			if err := s.logBlockedDuplicate(ctx, tx, actor, existing.LeadID, dec.Outcome, form.OriginCampaign, now); err != nil {
				return err
			}
			blockErr = &BlockedError{Outcome: dec.Outcome, ExistingLeadID: dec.ExistingLeadID, Message: dec.Message}
			return nil

		default: // OutcomeBlockScouted, OutcomeBlockClient
			if err := s.logBlockedDuplicate(ctx, tx, actor, existing.LeadID, dec.Outcome, form.OriginCampaign, now); err != nil {
				return err
			}
			blockErr = &BlockedError{Outcome: dec.Outcome, ExistingLeadID: dec.ExistingLeadID, Message: dec.Message}
			return nil
		}
	})
	if err != nil {
		return nil, err
	}
	if blockErr != nil {
		return nil, blockErr
	}
	return result, nil
}

func (s *Service) createScouted(ctx context.Context, tx *sql.Tx, actor authz.Identity, form SalesRegistrationForm, key string, now time.Time) (*RegistrationResult, error) {
	leadID, err := s.ids.Next(ctx, tx, ids.PrefixLead, now)
	if err != nil {
		return nil, err
	}
	l := Lead{
		LeadID: leadID, LeadName: form.LeadName, PhoneRaw: form.Phone, PhoneNormalized: key,
		Email: form.Email, Source: form.Source, OriginDivision: DivisiSales,
		OriginCampaign: form.OriginCampaign, RecordStatus: StatusScoutedActive,
		ScoutedOwnerEmployeeID: actor.EmployeeID,
	}
	if err := insertLead(ctx, tx, l, now); err != nil {
		return nil, err
	}
	if err := s.auditLead(ctx, tx, actor.EmployeeID, leadID, actionCreate, nil, leadAfterDoc(l)); err != nil {
		return nil, err
	}
	prsp, err := s.attempts.CreateAttempt(ctx, tx, leadID, actor.EmployeeID, now)
	if err != nil {
		return nil, err
	}
	return &RegistrationResult{Lead: &l, ProspectID: prsp}, nil
}

// reopenForSales reopens a Rejected/Not Qualified record to [Pool] (§5 rule 4
// row 3, history retained, never a duplicate) and — because the door is an
// active salesperson re-engaging (M0 §3 reopen) — spawns a fresh attempt for
// them. FLAGGED interpretation (see build report): §5 reopens to [Pool] while
// M0 §3 gives the re-registrant an attempt; combining both yields a [Pool]
// record carrying the re-registrant's attempt.
func (s *Service) reopenForSales(ctx context.Context, tx *sql.Tx, actor authz.Identity, existing *Lead, now time.Time) (*RegistrationResult, error) {
	before := leadAfterDoc(*existing)
	if err := setRecordStatus(ctx, tx, existing.LeadID, StatusPool, "", now); err != nil {
		return nil, err
	}
	existing.RecordStatus = StatusPool
	existing.ScoutedOwnerEmployeeID = ""
	if err := s.auditLead(ctx, tx, actor.EmployeeID, existing.LeadID, actionReopen, before, leadAfterDoc(*existing)); err != nil {
		return nil, err
	}
	prsp, err := s.attempts.CreateAttempt(ctx, tx, existing.LeadID, actor.EmployeeID, now)
	if err != nil {
		return nil, err
	}
	return &RegistrationResult{Lead: existing, ProspectID: prsp, Reopened: true}, nil
}

// ---- shared write helpers --------------------------------------------------

func (s *Service) snapshot(ctx context.Context, tx *sql.Tx, existing *Lead) *RecordSnapshot {
	if existing == nil {
		return nil
	}
	snap := &RecordSnapshot{
		LeadID:            existing.LeadID,
		RecordStatus:      existing.RecordStatus,
		OriginCampaign:    existing.OriginCampaign,
		LastTouchCampaign: existing.LastTouchCampaign,
	}
	if existing.RecordStatus == StatusScoutedActive {
		snap.ScoutedOwnerName = employeeName(ctx, tx, existing.ScoutedOwnerEmployeeID)
	}
	return snap
}

func (s *Service) raiseManualReview(ctx context.Context, tx *sql.Tx, actor authz.Identity, leadID string, now time.Time) error {
	if err := setManualReviewFlag(ctx, tx, leadID, now); err != nil {
		return err
	}
	return s.auditLead(ctx, tx, actor.EmployeeID, leadID, actionManualFlag,
		mustDoc(map[string]any{"manual_review_flag": false}),
		mustDoc(map[string]any{"manual_review_flag": true, "reason": "phone match, lead name differs substantially (M1-OA-4)"}))
}

func (s *Service) writeLastTouch(ctx context.Context, tx *sql.Tx, actor authz.Identity, leadID, newCampaign, originCampaign string, now time.Time) error {
	if err := setLastTouchCampaign(ctx, tx, leadID, newCampaign, now); err != nil {
		return err
	}
	return s.auditLead(ctx, tx, actor.EmployeeID, leadID, actionLastTouch,
		mustDoc(map[string]any{"last_touch_campaign": nil, "origin_campaign": originCampaign}),
		mustDoc(map[string]any{"last_touch_campaign": newCampaign, "origin_campaign": originCampaign, "note": "non-destructive; origin_campaign untouched"}))
}

func (s *Service) logBlockedDuplicate(ctx context.Context, tx *sql.Tx, actor authz.Identity, leadID string, outcome Outcome, intakeCampaign string, now time.Time) error {
	return s.auditLead(ctx, tx, actor.EmployeeID, leadID, actionBlockedDup, nil,
		mustDoc(map[string]any{
			"outcome":         string(outcome),
			"intake_campaign": intakeCampaign,
			"counted":         false, // M1-OA-6: attribution logged, never counted toward CPL
		}))
}

func (s *Service) auditLead(ctx context.Context, tx *sql.Tx, actorID, leadID, action string, before, after json.RawMessage) error {
	_, err := s.audit.Append(ctx, tx, audit.Entry{
		EntityType: auditEntityLead, EntityID: leadID, Actor: actorID,
		Action: action, Before: before, After: after, At: time.Now().UTC(),
	})
	return err
}

// ---- permission gates (§9.1) -----------------------------------------------

// authorizeSales enforces "Sales Staff registers own scouted leads" (§9.1):
// the actor must belong to the Sales division (Staff/Lead-SPV) or be Director,
// then pass the matrix as own-data (Staff) / division-wide (Lead-SPV) write.
func (s *Service) authorizeSales(actor authz.Identity) error {
	if !actor.Has(authz.RoleDirector) && actor.Divisi != DivisiSales {
		return &authz.DeniedError{EmployeeID: actor.EmployeeID, Reason: "sales registration is restricted to the Sales division"}
	}
	return s.checker.Check(actor, authz.Request{
		Action: authz.ActionWrite, Division: DivisiSales, OwnerEmployeeID: actor.EmployeeID,
	})
}

// authorizeMarketingImport enforces "Marketing Staff import under own
// campaigns; Marketing Lead all" (§9.1). Ownership is checked against the
// campaign owner (own-campaign for Staff, division-wide for Lead-SPV).
func (s *Service) authorizeMarketingImport(actor authz.Identity, campaign *CampaignStub) error {
	if !actor.Has(authz.RoleDirector) && actor.Divisi != DivisiMarketing {
		return &authz.DeniedError{EmployeeID: actor.EmployeeID, Reason: "marketing import is restricted to the Marketing division"}
	}
	return s.checker.Check(actor, authz.Request{
		Action: authz.ActionWrite, Division: DivisiMarketing, OwnerEmployeeID: campaign.OwnerEmployeeID,
	})
}

// ---- audit/json helpers ----------------------------------------------------

func mustDoc(v any) json.RawMessage {
	b, _ := json.Marshal(v)
	return b
}

// leadAfterDoc is the audit "after" snapshot of a lead row.
func leadAfterDoc(l Lead) json.RawMessage {
	return mustDoc(map[string]any{
		"lead_id":                   l.LeadID,
		"lead_name":                 l.LeadName,
		"phone_normalized":          l.PhoneNormalized,
		"source":                    l.Source,
		"origin_division":           l.OriginDivision,
		"origin_campaign":           l.OriginCampaign,
		"last_touch_campaign":       l.LastTouchCampaign,
		"record_status":             string(l.RecordStatus),
		"scouted_owner_employee_id": l.ScoutedOwnerEmployeeID,
		"manual_review_flag":        l.ManualReviewFlag,
	})
}
