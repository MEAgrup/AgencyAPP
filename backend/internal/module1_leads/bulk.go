// bulk.go — Marketing bulk-import door via the M1 handler (M1 §3, "single +
// bulk import"). Each row is a single registration processed with IMPORT-door
// semantics: it reuses the LIVE dedup engine (MatchByPhone + Decide with
// ChannelImport) — never a mirrored copy (DECISIONS.md O19) — so a duplicate row
// is BLOCKED per-row with the verbatim Bahasa Indonesia reason (NOT the
// collaborative co-pursuit join, which is ChannelSingleReg only), an incomplete
// row is rejected with [data tidak lengkap, baris tidak diimport], and a LEAD-
// id is minted ONLY for a valid, unique row. Valid rows land as [Pool] with no
// attempt (Marketing door, §3 rule 4); terminal records reopen to [Pool]
// (§3 Flow step 6). One bad row never blocks the rest — each row runs in its own
// transaction (§3 rule 5).
//
// This is a SEPARATE path from the W1-19 file importer (internal/importer),
// which stays canonical and untouched; this door is the M1 API surface Marketing
// uses to register many rows at once.
//
// Scoped deferral (M3 not built): §3 rule 3's campaign linkage + Source
// auto-derivation and the "parent Campaign must be Active" gate need the M3
// Campaign entity, which does not exist yet. Until then Source is supplied
// explicitly per row (the §9.3 mandatory field) and origin_campaign_id is left
// NULL. Recorded as an open item for M3 — not silently decided.
package module1_leads

import (
	"context"
	"fmt"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
	"github.com/meagrup/agencyapp/backend/internal/core/ident"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
)

// MarketingDivision is the CDPS division that owns pool leads from the import
// door (origin_division on created records + the write gate, M1 §9.1).
const MarketingDivision = "Marketing"

// BulkRow is one intake row on the Marketing bulk-import door.
type BulkRow struct {
	LeadName    string `json:"lead_name"`
	PhoneNumber string `json:"phone_number"`
	Email       string `json:"email"`
	Source      string `json:"source"`
}

// mandatoryOK gates the §9.3 mandatory fields (Lead Name, Phone, Source) before
// any id is minted (§3 Flow steps 2/4).
func (r BulkRow) mandatoryOK() bool {
	return r.LeadName != "" && r.PhoneNumber != "" && r.Source != ""
}

// BulkRowResult is the per-row verdict feeding the §3 rule 6 rejection list.
type BulkRowResult struct {
	// RowNumber is 1-based over the input rows.
	RowNumber int    `json:"row_number"`
	LeadName  string `json:"lead_name"`
	Phone     string `json:"phone_number"`
	// Imported is true when the row produced a [Pool] lead (new or reopened).
	Imported bool `json:"imported"`
	// Reopened marks a [Rejected]/[Not Qualified] record reopened to [Pool]
	// (§3 Flow step 6) — counted as imported.
	Reopened bool `json:"reopened,omitempty"`
	// LeadID is the created/reopened LEAD id, or the EXISTING lead the row
	// duplicated (so the rejection list can point at it).
	LeadID string `json:"lead_id,omitempty"`
	// Reason is the verbatim BI rejection reason for a rejected row; empty for
	// imported rows.
	Reason string `json:"reason,omitempty"`
}

// BulkReport is the §3 rule 6 summary + downloadable rejection list.
type BulkReport struct {
	Imported int             `json:"imported"`
	Rejected int             `json:"rejected"`
	Rows     []BulkRowResult `json:"rows"`
}

// Summary renders the byte-exact §3 Flow step 7 summary line.
func (r BulkReport) Summary() string {
	return fmt.Sprintf("[%d lead berhasil diimport, %d ditolak (duplikat/data tidak lengkap)]", r.Imported, r.Rejected)
}

// Rejections returns only the rejected rows (the downloadable rejection list).
func (r BulkReport) Rejections() []BulkRowResult {
	out := []BulkRowResult{}
	for _, row := range r.Rows {
		if !row.Imported {
			out = append(out, row)
		}
	}
	return out
}

// CanBulkImport reports whether actor may run the Marketing bulk-import door
// (M1 §9.1: Marketing Staff/Lead add/import leads; Director full). A pure-OD
// account (read-only, no division) is denied.
func CanBulkImport(actor permission.Actor) bool {
	return actor.Role.Director || actor.Role.Division == MarketingDivision
}

// BulkImport runs the Marketing bulk-import door for rows (M1 §3). The whole
// request is refused with the canonical role-denied message when the actor may
// not import; otherwise every row is processed independently and the report
// reconciles (Imported + Rejected == len(Rows)).
func (s *Service) BulkImport(ctx context.Context, actor permission.Actor, rows []BulkRow) (*BulkReport, error) {
	if !CanBulkImport(actor) {
		return nil, &ErrBlocked{Message: statemachine.RoleDeniedMessage}
	}
	report := &BulkReport{Rows: make([]BulkRowResult, 0, len(rows))}
	for i, row := range rows {
		res := s.importOneBulkRow(ctx, actor, i+1, row)
		if res.Imported {
			report.Imported++
		} else {
			report.Rejected++
		}
		report.Rows = append(report.Rows, res)
	}
	return report, nil
}

// importOneBulkRow processes one row in its own transaction so a row-level
// failure rejects only that row (§3 rule 5). The row must carry the mandatory
// fields; the dedup verdict comes from the live engine.
func (s *Service) importOneBulkRow(ctx context.Context, actor permission.Actor, rowNum int, row BulkRow) BulkRowResult {
	res := BulkRowResult{RowNumber: rowNum, LeadName: row.LeadName, Phone: row.PhoneNumber}

	// Mandatory-field validation BEFORE any id issue (§3 Flow steps 2/4).
	if !row.mandatoryOK() {
		res.Reason = MsgRowIncomplete
		return res
	}
	phoneNorm := NormalizePhone(row.PhoneNumber)
	if phoneNorm == "" {
		res.Reason = MsgRowIncomplete
		return res
	}

	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		res.Reason = MsgRowIncomplete
		return res
	}
	defer tx.Rollback()

	match, err := MatchByPhone(ctx, tx, phoneNorm)
	if err != nil {
		res.Reason = MsgRowIncomplete
		return res
	}
	// Import never distinguishes the acting salesperson: pass "" so Decide's
	// import branch blocks on ANY open attempt regardless of who holds it, and
	// never joins as a co-pursuit (M1-OA-6, dedup v2 join is single-reg only).
	dec := Decide(ChannelImport, match, "")

	switch dec.Outcome {
	case OutcomeCreate:
		leadID, err := ident.Next(ctx, tx, "LEAD", time.Now())
		if err != nil {
			res.Reason = MsgRowIncomplete
			return res
		}
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO leads (id, lead_name, phone_number, phone_norm, email, source, origin_division, record_status, created_by)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			leadID, row.LeadName, row.PhoneNumber, phoneNorm, nullString(row.Email), row.Source,
			MarketingDivision, RecordPool, actor.EmployeeID); err != nil {
			res.Reason = MsgRowIncomplete
			return res
		}
		if err := audit.Write(ctx, tx, audit.Record{
			EntityType: "lead", EntityID: leadID, Actor: actor.EmployeeID,
			Action: "create",
			After:  map[string]any{"record_status": RecordPool, "source": row.Source, "channel": "bulk_import"},
		}); err != nil {
			res.Reason = MsgRowIncomplete
			return res
		}
		if err := tx.Commit(); err != nil {
			res.Reason = MsgRowIncomplete
			return res
		}
		res.Imported = true
		res.LeadID = leadID
		return res

	case OutcomeReopen:
		// Terminal ([Rejected]/[Not Qualified]) -> [Pool] via the engine; the
		// Marketing door spawns no attempt (record stays [Pool]).
		if _, err := s.Engine.Transition(ctx, tx, statemachine.Request{
			Machine:      statemachine.MLeadRecord,
			EntityType:   "lead",
			Table:        "leads",
			StatusColumn: "record_status",
			EntityID:     dec.ReopenLeadID,
			To:           RecordPool,
			Actor:        actor,
		}); err != nil {
			res.Reason = MsgRowIncomplete
			return res
		}
		if err := audit.Write(ctx, tx, audit.Record{
			EntityType: "lead", EntityID: dec.ReopenLeadID, Actor: actor.EmployeeID,
			Action: "dedup_reopen",
			After:  map[string]any{"channel": "bulk_import", "source": row.Source},
		}); err != nil {
			res.Reason = MsgRowIncomplete
			return res
		}
		if err := tx.Commit(); err != nil {
			res.Reason = MsgRowIncomplete
			return res
		}
		res.Imported = true
		res.Reopened = true
		res.LeadID = dec.ReopenLeadID
		return res

	default: // OutcomeBlock — Decide never returns OutcomeJoin on ChannelImport.
		// Attribution attempt logged on the existing record but never counted
		// (M1-OA-6); the existing record is not mutated.
		if match != nil {
			if err := audit.Write(ctx, tx, audit.Record{
				EntityType: "lead", EntityID: match.ID, Actor: actor.EmployeeID,
				Action: "dedup_blocked",
				After:  map[string]any{"channel": "bulk_import", "row_index": rowNum, "message": dec.Message},
			}); err != nil {
				res.Reason = MsgRowIncomplete
				return res
			}
			if err := tx.Commit(); err != nil {
				res.Reason = MsgRowIncomplete
				return res
			}
			res.LeadID = match.ID
		}
		res.Reason = dec.Message
		return res
	}
}
