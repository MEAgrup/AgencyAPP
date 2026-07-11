package sales

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
	"github.com/meagrup/agencyapp/backend/internal/core/authz"
	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
)

// allowedContactActionTypes is the closed list of "real actions" M0 §4 rule 1
// requires before New Lead -> Contacted: call, chat, meeting, visit. Not a
// PRD-provided multiple-choice field spec by name (§4 just prose-lists the
// four), so the values are the lowercase English words from the rule text
// itself -- no BI label invented.
var allowedContactActionTypes = map[string]bool{
	"call":    true,
	"chat":    true,
	"meeting": true,
	"visit":   true,
}

// Not-Qualified Reason taxonomy (M1-OA-8, W1-04). The closed list is
// byte-exact from the PRD: six fixed reasons plus the confirmed-essential
// `[Lainnya ...]` free-text fallback. On the fallback the free text is
// MANDATORY and is stored appended to the label -- "[Lainnya ...] <teks>" --
// in the single not_qualified_reason VARCHAR(255) column (no new migration).
const (
	NQReasonBukanSeller     = "[Bukan seller]"
	NQReasonTidakAdaBudget  = "[Tidak ada budget]"
	NQReasonKontakSalah     = "[Kontak salah/tidak valid]"
	NQReasonTidakAdaRespon  = "[Tidak ada respon]"
	NQReasonSudahJadiKlien  = "[Sudah jadi klien]"
	NQReasonSpamDuplikat    = "[Spam/duplikat]"
	NQReasonLainnya         = "[Lainnya ...]" // requires NotQualifiedReasonDetail
	nqReasonStoredMaxLength = 255             // prospect_attempts.not_qualified_reason VARCHAR(255)
)

// NotQualifiedReasons is the closed M1-OA-8 list in PRD order, exported so
// API/frontend layers render exactly this multiple-choice set and never
// invent labels.
var NotQualifiedReasons = []string{
	NQReasonBukanSeller,
	NQReasonTidakAdaBudget,
	NQReasonKontakSalah,
	NQReasonTidakAdaRespon,
	NQReasonSudahJadiKlien,
	NQReasonSpamDuplikat,
	NQReasonLainnya,
}

var notQualifiedReasonSet = func() map[string]bool {
	m := make(map[string]bool, len(NotQualifiedReasons))
	for _, r := range NotQualifiedReasons {
		m[r] = true
	}
	return m
}()

// notQualifiedReasonValue validates the (reason, detail) pair against the
// M1-OA-8 taxonomy and returns the value to store:
//   - reason must be EXACTLY one of NotQualifiedReasons (byte-exact);
//   - reason == NQReasonLainnya additionally requires a non-blank detail;
//     the stored value is "[Lainnya ...] <detail>";
//   - every other reason must carry NO detail (closed choices are stored
//     verbatim; free text exists only for the fallback);
//   - the stored value must fit the VARCHAR(255) column.
//
// ok == false means the pair fails mandatory-field validation.
func notQualifiedReasonValue(reason, detail string) (stored string, ok bool) {
	if !notQualifiedReasonSet[reason] {
		return "", false
	}
	trimmed := strings.TrimSpace(detail)
	if reason == NQReasonLainnya {
		if trimmed == "" {
			return "", false
		}
		stored = NQReasonLainnya + " " + trimmed
	} else {
		if trimmed != "" {
			return "", false
		}
		stored = reason
	}
	if len(stored) > nqReasonStoredMaxLength {
		return "", false
	}
	return stored, true
}

// UpdateStatusInput is the payload for UpdateStatus.
type UpdateStatusInput struct {
	To statemachine.Status
	// ActionType is mandatory when To == statemachine.ProspectContacted (M0
	// §4 rule 1): one of call/chat/meeting/visit. Ignored for every other
	// target status.
	ActionType string
	// NotQualifiedReason is mandatory when To == statemachine.ProspectNotQualified
	// (M1 §9.3 "Mandatory when status -> Not Qualified", M1-OA-8) and must be
	// EXACTLY one of NotQualifiedReasons. For any other target status it must
	// be empty. Missing/invalid -> mandatory-field validation failure with
	// zero side effects (no transition, no writes, no audit).
	NotQualifiedReason string
	// NotQualifiedReasonDetail is the free text for the `[Lainnya ...]`
	// fallback: MANDATORY (non-blank) when NotQualifiedReason ==
	// NQReasonLainnya, and must be empty otherwise. Stored combined as
	// "[Lainnya ...] <detail>" in the not_qualified_reason column.
	NotQualifiedReasonDetail string
}

// UpdateStatus is the public status-update API (M0 §4 rules) for a Prospect
// attempt. It is the ONLY entry point besides QualifyFromForm and
// SystemTransition that can move an attempt's status, and it always goes
// through statemachine.Engine.Transition -- never a raw column update.
//
// Rules enforced at this layer (on top of the engine's own from->to and role
// validation):
//   - To == Qualified is rejected outright (DirectQualifyDeniedError) before
//     the engine is even consulted: Qualified is reachable only via a
//     successful Qualified Lead Form submit (QualifyFromForm, W1-06).
//   - To == Contacted requires a real ActionType (call/chat/meeting/visit);
//     missing/invalid -> the default BI mandatory-field message, no side
//     effects. On success, the action type is recorded both on the row
//     (queryable) and as its own immutable audit row (auditable) -- but only
//     AFTER the engine's own transition succeeds, so a from-state that isn't
//     actually New Lead still blocks with zero side effects.
//   - To == Not Qualified requires a valid NotQualifiedReason from the closed
//     M1-OA-8 taxonomy (plus mandatory NotQualifiedReasonDetail for the
//     `[Lainnya ...]` fallback); missing/off-list -> the default BI
//     mandatory-field message, no side effects (W1-04). For every OTHER
//     target status the reason/detail must be empty. On success the stored
//     reason is written (row + its own immutable audit entry) only AFTER the
//     engine's transition succeeds, so a blocked from-state still yields
//     zero side effects.
//   - Any attempt currently `Blocked` has no outgoing edge in the machine, so
//     every UpdateStatus call against it is rejected by the engine itself
//     (M0 §4 rule 2: "Blocked attempts cannot be updated or followed up").
//
// Permission (M0 §7.1): Staff may update only an attempt they own; Head/SPV
// Sales update division-wide; Director full; OD is read-only (denied here
// even if layered on the account, since it grants no ActionWrite).
// Role-restricted edges (e.g. negotiation approval, Sales Head/SPV-only) are
// additionally enforced by the engine via ActorRoles.
func (s *Attempts) UpdateStatus(ctx context.Context, conn *sql.DB, actor authz.Identity, prospectID string, in UpdateStatusInput) error {
	if in.To == statemachine.ProspectQualified {
		return DirectQualifyDeniedError{}
	}
	if in.To == "" {
		return validationErr()
	}
	if in.To == statemachine.ProspectContacted && !allowedContactActionTypes[in.ActionType] {
		return validationErr()
	}
	// M1-OA-8 taxonomy gate (W1-04): To == Not Qualified requires a valid
	// (reason, detail) pair; any other target must carry neither. Failure is
	// the default BI mandatory-field message with zero side effects.
	var nqStored string
	if in.To == statemachine.ProspectNotQualified {
		v, ok := notQualifiedReasonValue(in.NotQualifiedReason, in.NotQualifiedReasonDetail)
		if !ok {
			return validationErr()
		}
		nqStored = v
	} else if in.NotQualifiedReason != "" || strings.TrimSpace(in.NotQualifiedReasonDetail) != "" {
		return validationErr()
	}

	roles := toStatemachineRoles(actor.Roles)

	return s.engine.InTx(ctx, conn, func(tx *sql.Tx) error {
		att, err := loadAttempt(ctx, tx, prospectID)
		if err != nil {
			return err
		}
		if err := s.requireWrite(actor, att.OwnerEmployeeID); err != nil {
			return err
		}

		if err := s.engine.Transition(ctx, tx, statemachine.TransitionRequest{
			EntityType: statemachine.EntityProspect,
			EntityID:   prospectID,
			To:         in.To,
			Actor:      actor.EmployeeID,
			ActorRoles: roles,
		}); err != nil {
			return err
		}

		// Supplementary, non-status metadata: written ONLY after the engine
		// accepted the transition, so a blocked transition leaves the row
		// (and audit trail) completely untouched.
		switch in.To {
		case statemachine.ProspectContacted:
			if _, err := tx.ExecContext(ctx,
				`UPDATE prospect_attempts SET contact_action_type = ? WHERE prospect_id = ?`,
				in.ActionType, prospectID,
			); err != nil {
				return fmt.Errorf("sales: record contact action type: %w", err)
			}
			after, _ := json.Marshal(map[string]any{"action_type": in.ActionType})
			if _, err := s.auditLg.Append(ctx, tx, audit.Entry{
				EntityType: string(statemachine.EntityProspect),
				EntityID:   prospectID,
				Actor:      actor.EmployeeID,
				Action:     "contact_action_recorded",
				After:      after,
				At:         time.Now().UTC(),
			}); err != nil {
				return fmt.Errorf("sales: audit contact action: %w", err)
			}
		case statemachine.ProspectNotQualified:
			// nqStored is guaranteed non-empty here (validated pre-engine).
			if _, err := tx.ExecContext(ctx,
				`UPDATE prospect_attempts SET not_qualified_reason = ? WHERE prospect_id = ?`,
				nqStored, prospectID,
			); err != nil {
				return fmt.Errorf("sales: record not-qualified reason: %w", err)
			}
			after, _ := json.Marshal(map[string]any{"not_qualified_reason": nqStored})
			if _, err := s.auditLg.Append(ctx, tx, audit.Entry{
				EntityType: string(statemachine.EntityProspect),
				EntityID:   prospectID,
				Actor:      actor.EmployeeID,
				Action:     "not_qualified_reason_recorded",
				After:      after,
				At:         time.Now().UTC(),
			}); err != nil {
				return fmt.Errorf("sales: audit not-qualified reason: %w", err)
			}
		}
		return nil
	})
}

// QualifyFromForm transitions a Contacted attempt to Qualified.
//
// This is the ONLY path to Qualified in this package (M0 §4: "Selecting
// Qualified opens the Qualified Lead Form; the status does not change until
// the form is successfully submitted"). It is documented here as consumed
// EXCLUSIVELY by ticket W1-06 (Qualified Lead Form): W1-06 owns all of the
// form's own rules -- mandatory fields, max-5 services
// `[maksimal pilih 5 jasa saja!]`, auto-computed Estimasi Nilai
// Transaksi/Perhitungan Komisi from the Master Service List, and locking the
// entered client data on submit -- and must have fully validated and
// persisted the form BEFORE calling this method. QualifyFromForm itself only
// performs the permission check + status transition + immutable audit, like
// every other engine-backed transition in this package; it does not know
// about or validate any Qualified Lead Form field.
func (s *Attempts) QualifyFromForm(ctx context.Context, conn *sql.DB, actor authz.Identity, prospectID string) error {
	roles := toStatemachineRoles(actor.Roles)
	return s.engine.InTx(ctx, conn, func(tx *sql.Tx) error {
		att, err := loadAttempt(ctx, tx, prospectID)
		if err != nil {
			return err
		}
		if err := s.requireWrite(actor, att.OwnerEmployeeID); err != nil {
			return err
		}
		return s.engine.Transition(ctx, tx, statemachine.TransitionRequest{
			EntityType: statemachine.EntityProspect,
			EntityID:   prospectID,
			To:         statemachine.ProspectQualified,
			Actor:      actor.EmployeeID,
			ActorRoles: roles,
		})
	})
}

// SystemTransition performs a system/cascade-driven transition -- there is no
// human actor to permission-check, so this bypasses authz.Checker entirely
// and relies on statemachine.Engine's own enforcement that an Auto edge may
// only be taken by statemachine.ActorSystem (a human actor attempting the
// same edge through UpdateStatus is blocked with zero side effects, reason
// "auto_only" -- see the package tests).
//
// Intended callers: module1_leads' win-resolution logic (W1-03), which calls
// this with To=statemachine.ProspectClosedKalah for every open competing
// attempt once one attempt on the same Lead record reaches Closed-Success
// (M1 §6 rule 5); and, in principle, an intake-collision auto-block
// (Pending Validation -> Blocked) though CreateAttempt's own flow never
// leaves a row addressable in that state in production (see CreateAttempt's
// doc comment).
func (s *Attempts) SystemTransition(ctx context.Context, conn *sql.DB, prospectID string, to statemachine.Status) error {
	return s.engine.InTx(ctx, conn, func(tx *sql.Tx) error {
		return s.engine.Transition(ctx, tx, statemachine.TransitionRequest{
			EntityType: statemachine.EntityProspect,
			EntityID:   prospectID,
			To:         to,
			Actor:      statemachine.ActorSystem,
		})
	})
}
