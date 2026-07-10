package leads

import (
	"context"
	"database/sql"
	"encoding/csv"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/authz"
	"github.com/meagrup/agencyapp/backend/internal/core/db"
	"github.com/meagrup/agencyapp/backend/internal/core/ids"
)

// ---- W1-02 · Marketing bulk + single import (M1 §3) -------------------------

// ImportRow is one intake row. On bulk import rows come from the CSV parser;
// the Marketing single-lead form is a one-row import (§3 rule 1: "one at a
// time or bulk", same validation + dedup pipeline).
type ImportRow struct {
	LeadName string
	Phone    string
	Email    string // optional
}

func (r ImportRow) mandatoryOK() bool {
	return strings.TrimSpace(r.LeadName) != "" && strings.TrimSpace(r.Phone) != ""
}

// RowResult is the per-row verdict, feeding the §3 rule 6 rejection list.
type RowResult struct {
	// RowNumber is 1-based over the input rows (excluding the CSV header).
	RowNumber int
	LeadName  string
	Phone     string
	// Imported is true when the row produced a [Pool] lead (new or reopened).
	Imported bool
	// Reopened marks a Rejected/Not Qualified record reopened to [Pool]
	// (§3 Flow step 6) — counted as imported.
	Reopened bool
	// LeadID is the created/reopened LEAD id, or the EXISTING lead the row
	// duplicated (so the rejection list can point at it).
	LeadID string
	// Reason is the byte-exact BI rejection reason for rejected rows; empty
	// for imported rows.
	Reason string
}

// ImportReport is the §3 rule 6 summary + downloadable rejection list.
type ImportReport struct {
	CampaignID string
	Imported   int
	Rejected   int
	Rows       []RowResult
}

// Summary renders the byte-exact §3 Flow step 7 summary line:
// `[X lead berhasil diimport, Y ditolak (duplikat/data tidak lengkap)]`.
func (r ImportReport) Summary() string {
	return fmt.Sprintf("[%d lead berhasil diimport, %d ditolak (duplikat/data tidak lengkap)]", r.Imported, r.Rejected)
}

// Rejections returns only the rejected rows (the downloadable rejection list).
func (r ImportReport) Rejections() []RowResult {
	var out []RowResult
	for _, row := range r.Rows {
		if !row.Imported {
			out = append(out, row)
		}
	}
	return out
}

// reconciled reports whether Imported+Rejected covers every row — the W1-02
// AC guard, also verified in tests.
func (r ImportReport) reconciled() bool {
	return r.Imported+r.Rejected == len(r.Rows)
}

// ImportLeads runs the Marketing import (single row or bulk) under campaignID.
//
// Gate (W1-02 / STATE_MACHINES §2): the parent Campaign must be `Active`,
// otherwise the whole import is refused with *ValidationError
// `[campaign belum/tidak aktif, lead tidak bisa diimport]`. The Campaign
// entity itself is the Wave-3 M3 stub (campaign_stub, migrations/0031).
//
// Row-level processing (§3 rule 5): each row is validated + deduped in its own
// transaction, so one bad row never blocks the rest and a rejected row changes
// no lead data (its only trace is the immutable audit attribution log,
// M1-OA-6). Source is auto-derived from the campaign (M1-OA-3).
func (s *Service) ImportLeads(ctx context.Context, conn *sql.DB, actor authz.Identity, campaignID string, rows []ImportRow) (*ImportReport, error) {
	campaign, err := getCampaignStub(ctx, conn, campaignID)
	if err != nil {
		if errors.Is(err, ErrCampaignNotFound) {
			return nil, &ValidationError{Message: MsgCampaignTidakAktif}
		}
		return nil, err
	}
	if err := s.authorizeMarketingImport(actor, campaign); err != nil {
		return nil, err
	}
	if campaign.Status != campaignActiveStatus {
		return nil, &ValidationError{Message: MsgCampaignTidakAktif}
	}

	report := &ImportReport{CampaignID: campaignID}
	for i, row := range rows {
		res := s.importOneRow(ctx, conn, actor, campaign, i+1, row)
		if res.Imported {
			report.Imported++
		} else {
			report.Rejected++
		}
		report.Rows = append(report.Rows, res)
	}
	if !report.reconciled() {
		// Defensive: by construction every row is exactly imported or rejected.
		return nil, fmt.Errorf("leads: import report does not reconcile: %d+%d != %d",
			report.Imported, report.Rejected, len(report.Rows))
	}
	return report, nil
}

// importOneRow processes one row in its own transaction. A row-level failure
// (validation, dedup block, even an unexpected DB error) rejects only that row.
func (s *Service) importOneRow(ctx context.Context, conn *sql.DB, actor authz.Identity, campaign *CampaignStub, rowNum int, row ImportRow) RowResult {
	res := RowResult{RowNumber: rowNum, LeadName: row.LeadName, Phone: row.Phone}

	// Mandatory-field validation BEFORE any id issue (§3 Flow steps 2/4).
	if !row.mandatoryOK() {
		res.Reason = MsgDataTidakLengkapBaris
		return res
	}
	key := s.norm.Normalize(row.Phone)
	if key == "" {
		res.Reason = MsgDataTidakLengkapBaris
		return res
	}
	// M1-OA-3: Source auto-derived from campaign type; Origin Campaign is
	// mandatory when the derived Source requires it — satisfied by definition
	// here since the import runs under the campaign.
	source := campaign.Source
	if !isValidSource(source) {
		res.Reason = MsgDataTidakLengkapBaris
		return res
	}

	err := db.WithTx(ctx, conn, func(tx *sql.Tx) error {
		now := time.Now().UTC()
		existing, err := findByPhone(ctx, tx, key)
		if err != nil && err != ErrLeadNotFound {
			return err
		}

		snap := s.snapshot(ctx, tx, existing)
		dec := Decide(snap, DoorMarketingImport, campaign.CampaignID)

		// M1-OA-4 manual-review flag on any phone match with a substantially
		// different name.
		if existing != nil && nameDiffersSubstantially(existing.LeadName, row.LeadName) {
			if err := s.raiseManualReview(ctx, tx, actor, existing.LeadID, now); err != nil {
				return err
			}
		}

		switch dec.Outcome {
		case OutcomeCreate:
			// §3 Flow step 3: LEAD generated, [Pool], Campaign linked, Source
			// auto-set, timestamp recorded.
			leadID, err := s.ids.Next(ctx, tx, ids.PrefixLead, now)
			if err != nil {
				return err
			}
			l := Lead{
				LeadID: leadID, LeadName: row.LeadName, PhoneRaw: row.Phone, PhoneNormalized: key,
				Email: row.Email, Source: source, OriginDivision: DivisiMarketing,
				OriginCampaign: campaign.CampaignID, RecordStatus: StatusPool,
			}
			if err := insertLead(ctx, tx, l, now); err != nil {
				return err
			}
			if err := s.auditLead(ctx, tx, actor.EmployeeID, leadID, actionCreate, nil, leadAfterDoc(l)); err != nil {
				return err
			}
			res.Imported = true
			res.LeadID = leadID
			return nil

		case OutcomeReopen:
			// §3 Flow step 6: re-entry allowed; existing record reopened to
			// [Pool]. No attempt is spawned (Marketing door), full history kept.
			before := leadAfterDoc(*existing)
			if err := setRecordStatus(ctx, tx, existing.LeadID, StatusPool, "", now); err != nil {
				return err
			}
			reopened := *existing
			reopened.RecordStatus = StatusPool
			reopened.ScoutedOwnerEmployeeID = ""
			if err := s.auditLead(ctx, tx, actor.EmployeeID, existing.LeadID, actionReopen, before, leadAfterDoc(reopened)); err != nil {
				return err
			}
			res.Imported = true
			res.Reopened = true
			res.LeadID = existing.LeadID
			return nil

		case OutcomeBlockPool:
			// §5 row 2: duplicate record — point to existing lead; write
			// Last-Touch when the campaign differs (never touches Origin).
			if dec.WriteLastTouch {
				if err := s.writeLastTouch(ctx, tx, actor, existing.LeadID, campaign.CampaignID, existing.OriginCampaign, now); err != nil {
					return err
				}
			}
			if err := s.logBlockedDuplicate(ctx, tx, actor, existing.LeadID, dec.Outcome, campaign.CampaignID, now); err != nil {
				return err
			}
			res.LeadID = existing.LeadID
			res.Reason = MsgLeadSudahAdaDiproses
			return nil

		case OutcomeBlockScouted:
			// §3 Flow step 5 (M1-OA-6): duplicate of an active external lead —
			// rejected, attribution attempt logged on the existing record but
			// never counted.
			if err := s.logBlockedDuplicate(ctx, tx, actor, existing.LeadID, dec.Outcome, campaign.CampaignID, now); err != nil {
				return err
			}
			res.LeadID = existing.LeadID
			res.Reason = MsgLeadSudahAdaDiproses
			return nil

		default: // OutcomeBlockClient
			if err := s.logBlockedDuplicate(ctx, tx, actor, existing.LeadID, dec.Outcome, campaign.CampaignID, now); err != nil {
				return err
			}
			res.LeadID = existing.LeadID
			res.Reason = MsgLeadSudahKlien
			return nil
		}
	})
	if err != nil {
		// Row-level infrastructure failure: reject only this row, never the
		// batch (§3 rule 5). Nothing committed for it (tx rolled back).
		res.Imported = false
		res.Reopened = false
		res.LeadID = ""
		res.Reason = MsgDataTidakLengkapBaris
	}
	return res
}

// ---- CSV parsing (v1: CSV only; XLSX deferred, see build report) -----------

// csvHeaderAliases maps accepted header names (lowercased, trimmed) to the
// ImportRow field. Ads-platform / event-registration exports vary; the three
// mandatory concepts are lead name, phone, email.
var csvHeaderAliases = map[string]string{
	"lead name": "name", "nama": "name", "name": "name", "lead_name": "name",
	"phone": "phone", "phone number": "phone", "telepon": "phone", "no hp": "phone", "phone_number": "phone",
	"email": "email", "e-mail": "email",
}

// ParseCSV reads an import file into rows. The first record is the header;
// columns are matched case-insensitively via csvHeaderAliases. Files without
// a recognisable Lead Name + Phone column fail with *ValidationError
// (mandatory columns absent — nothing importable).
func ParseCSV(r io.Reader) ([]ImportRow, error) {
	cr := csv.NewReader(r)
	cr.TrimLeadingSpace = true
	cr.FieldsPerRecord = -1 // ragged rows become per-row rejections, not a file error

	header, err := cr.Read()
	if err != nil {
		return nil, &ValidationError{Message: MsgDataTidakLengkapForm}
	}
	idx := map[string]int{}
	for i, h := range header {
		if field, ok := csvHeaderAliases[strings.ToLower(strings.TrimSpace(h))]; ok {
			if _, dup := idx[field]; !dup {
				idx[field] = i
			}
		}
	}
	if _, ok := idx["name"]; !ok {
		return nil, &ValidationError{Message: MsgDataTidakLengkapForm}
	}
	if _, ok := idx["phone"]; !ok {
		return nil, &ValidationError{Message: MsgDataTidakLengkapForm}
	}

	var rows []ImportRow
	for {
		rec, err := cr.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			// Malformed line: keep it as an (empty) row so it surfaces as a
			// per-row rejection rather than aborting the batch (§3 rule 5).
			rows = append(rows, ImportRow{})
			continue
		}
		get := func(field string) string {
			i, ok := idx[field]
			if !ok || i >= len(rec) {
				return ""
			}
			return strings.TrimSpace(rec[i])
		}
		rows = append(rows, ImportRow{LeadName: get("name"), Phone: get("phone"), Email: get("email")})
	}
	return rows, nil
}
