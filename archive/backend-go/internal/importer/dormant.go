package importer

// dormant.go lands NON-ACTIVE ledger clients as archive-only client records
// (O23 RESOLVED, DECISIONS 2026-07-10): a dormant client is a CLI- row with
// dormant_at stamped and NO TRX/SVC/INST — the deal history is summarised in the
// import provenance audit row so CRO keeps a complete database for retention /
// cross-sell. Distinct platforms land as client_platforms (M4-OA-2 shape).
//
// A dormant client carries no money path, so it is never released to Account
// (released_to_account_at stays NULL) and has no sales_pic_id / commission PIC
// (the ledger only has a sales NICKNAME, not a synced NIK; it is preserved in
// the provenance row, not written to a FK-less scalar we cannot trust). This is
// a deliberate go-live choice, flagged for docs/DECISIONS.md.
//
// Director-only, same as DryRun/Apply. DryRunDormant writes under a savepoint
// and rolls back (zero mutation); ApplyDormant commits per row (one bad row
// never stops the rest).

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
	"github.com/meagrup/agencyapp/backend/internal/core/ident"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
)

// validateDormant is the light parse-side check for an archive record: it must
// be identifiable (an ID and a name/store). Deal detail may legitimately be
// sparse in the ledger, so nothing else is required.
func validateDormant(c LedgerClient) error {
	if strings.TrimSpace(c.ID) == "" || (strings.TrimSpace(c.Toko) == "" && strings.TrimSpace(c.NamaPIC) == "") {
		return errClientIncomplete
	}
	return nil
}

// DryRunDormant validates + lands every dormant client under a savepoint and
// rolls the whole batch back — the DB is never mutated.
func (s *Service) DryRunDormant(ctx context.Context, actor permission.Actor, clients []LedgerClient) (Report, error) {
	if err := permit(actor); err != nil {
		return Report{}, err
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return Report{}, err
	}
	defer tx.Rollback()

	var rep Report
	for i, c := range clients {
		out := RowOutcome{Index: i, Entity: "client"}
		if err := validateDormant(c); err != nil {
			out.Status, out.Message = RowError, err.Error()
			rep.add(out)
			continue
		}
		sp := fmt.Sprintf("sp_dormant_%d", i)
		if err := savepoint(ctx, tx, sp); err != nil {
			out.Status, out.Message = RowError, err.Error()
			rep.add(out)
			continue
		}
		if _, err := s.landDormantTx(ctx, tx, actor, c, i); err != nil {
			if fatal := rollbackToSavepoint(ctx, tx, sp); fatal != nil {
				return Report{}, fatal
			}
			out.Status, out.Message = RowError, err.Error()
			rep.add(out)
			continue
		}
		if fatal := rollbackToSavepoint(ctx, tx, sp); fatal != nil {
			return Report{}, fatal
		}
		out.Status = RowValid
		rep.add(out)
	}
	rep.recount()
	if err := tx.Rollback(); err != nil {
		return Report{}, err
	}
	return rep, nil
}

// ApplyDormant lands the dormant clients for real, one commit per row.
func (s *Service) ApplyDormant(ctx context.Context, actor permission.Actor, clients []LedgerClient) (Report, error) {
	if err := permit(actor); err != nil {
		return Report{}, err
	}
	var rep Report
	for i, c := range clients {
		out := RowOutcome{Index: i, Entity: "client"}
		if err := validateDormant(c); err != nil {
			out.Status, out.Message = RowFailed, err.Error()
			rep.add(out)
			continue
		}
		tx, err := s.DB.BeginTx(ctx, nil)
		if err != nil {
			out.Status, out.Message = RowFailed, err.Error()
			rep.add(out)
			continue
		}
		cliID, err := s.landDormantTx(ctx, tx, actor, c, i)
		if err != nil {
			_ = tx.Rollback()
			out.Status, out.Message = RowFailed, err.Error()
			rep.add(out)
			continue
		}
		if err := tx.Commit(); err != nil {
			out.Status, out.Message = RowFailed, err.Error()
			rep.add(out)
			continue
		}
		out.Status, out.IssuedIDs = RowApplied, []string{cliID}
		rep.add(out)
	}
	rep.recount()
	return rep, nil
}

// landDormantTx mints CLI-, inserts the dormant client + its platforms, and
// writes the provenance summary. No TRX/SVC/INST. Caller owns the transaction.
func (s *Service) landDormantTx(ctx context.Context, tx *sql.Tx, actor permission.Actor, c LedgerClient, index int) (string, error) {
	now := time.Now()
	cliID, err := ident.Next(ctx, tx, "CLI", now)
	if err != nil {
		return "", err
	}

	// dormant_at stamped; money zeros; sales/commission PIC empty (see file
	// header); transaction_id / payment_intent NULL (no TRX). total_sales births
	// at 0 like a live client (M4-OA-1: outcome field, never seeded from a deal).
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO clients
		 (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv, marketing_budget,
		  total_sales, sales_pic_id, commission_payment_pic_id, transaction_id, payment_intent, dormant_at, created_by)
		 VALUES (?, ?, ?, '', ?, '', 0, 0, NULL, 0, '', '', NULL, NULL, ?, ?)`,
		cliID, c.NamaPIC, c.Toko, c.LinkToko, now.Format("2006-01-02 15:04:05"), actor.EmployeeID); err != nil {
		return "", err
	}

	// Distinct platforms (M4-OA-2), normalized casing.
	for _, p := range c.distinctPlatforms() {
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO client_platforms (client_id, platform, store_link, managed_since, active, created_by)
			 VALUES (?, ?, ?, NULL, 1, ?)`,
			cliID, p, nullStr(c.LinkToko), actor.EmployeeID); err != nil {
			return "", err
		}
	}

	// Provenance: the summarised deal history (no TRX to hang it on).
	layanan := make([]string, 0, len(c.Lines))
	schemesRaw := make([]string, 0, len(c.Lines))
	for _, l := range c.Lines {
		layanan = append(layanan, l.DetailJasa)
		schemesRaw = append(schemesRaw, l.SchemeRaw)
	}
	if err := audit.Write(ctx, tx, audit.Record{
		EntityType: "client", EntityID: cliID, Actor: actor.EmployeeID,
		Action: "import:client_dormant",
		After: map[string]any{
			"row_index":     index,
			"source":        "spreadsheet",
			"id_ledger":     c.ID,
			"toko":          c.Toko,
			"nama_sales":    c.NamaSales,
			"jumlah_deal":   len(c.Lines),
			"total_nominal": c.TotalNominal().Decimal(),
			"layanan":       layanan,
			"skema":         sortedDistinct(schemesRaw),
			"platforms":     c.distinctPlatforms(),
		},
	}); err != nil {
		return "", err
	}
	return cliID, nil
}
