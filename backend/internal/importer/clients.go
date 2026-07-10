package importer

// clients.go rebuilds a pre-CDPS closed client (Permintaan #3 path 2).
//
// createClientTx does the whole CLI/platforms/allocation/SVC/TRX/INST creation
// inside ONE caller-owned transaction (atomic birth of the record). Payment
// REPLAY is deliberately a SEPARATE post-commit phase (replayPayments): the
// official money paths — module5_finance.Verify / AttachContract — each manage
// their own transaction (they lock the TRX row FOR UPDATE, drive the payment
// state machine, append the verification log and fire the routing gate). They
// cannot enrol in an outer transaction, and they must see committed rows. So the
// atomicity guarantee is moved EARLIER: validateClientRow (incl. validatePayments)
// proves the whole plan — schedule sums, per-installment amounts, over-verify and
// the [Lunas] contract gate — BEFORE the creation transaction commits. A row that
// would fail replay is rejected before a single INSERT; once created, replay is
// guaranteed to succeed. Any residual unexpected replay error is reported per row
// with the IDs already issued (report contract).

import (
	"context"
	"database/sql"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
	"github.com/meagrup/agencyapp/backend/internal/core/ident"
	"github.com/meagrup/agencyapp/backend/internal/core/money"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
	"github.com/meagrup/agencyapp/backend/internal/module5_finance"
)

// clientIDs are the entities minted for one imported client.
type clientIDs struct {
	Client       string
	Transaction  string
	Services     []string
	Installments []string
}

func (c clientIDs) all() []string {
	out := make([]string, 0, 2+len(c.Services)+len(c.Installments))
	out = append(out, c.Client, c.Transaction)
	out = append(out, c.Services...)
	out = append(out, c.Installments...)
	return out
}

// serviceInitialStatus is the MService machine's initial state (config.go).
const serviceInitialStatus = "Intake"

// createClientTx mints and inserts CLI-/SVC-/TRX-/INST- inside tx. The row must
// already have passed validateClientRow.
//
// NOTE on legacy services: the import contract carries only service name + deal
// price, so the MSL-linkage columns (master_service_id, master_version_no,
// commission_rule) have no source and are stored blank/zero for these historical
// lines; standard_price holds the deal price. Flagged for the orchestrator.
func (s *Service) createClientTx(ctx context.Context, tx *sql.Tx, actor permission.Actor, row ClientRow, index int) (clientIDs, error) {
	var ids clientIDs
	now := time.Now()

	cliID, err := ident.Next(ctx, tx, "CLI", now)
	if err != nil {
		return ids, err
	}
	trxID, err := ident.Next(ctx, tx, "TRX", now)
	if err != nil {
		return ids, err
	}
	ids.Client, ids.Transaction = cliID, trxID

	pic := row.closingParties().ResolvedPIC() // solo -> primary (OD-1)

	// Client first (TRX FK -> clients). clients.transaction_id has no FK, so the
	// forward reference to the not-yet-inserted TRX id is safe.
	//
	// total_sales births at 0: per M4-OA-1 it is the client's cumulative actual
	// sales/GMV on MEA-managed channels (execution data, accrues post-import) —
	// NOT the deal value. It is an auto-computed outcome field nobody types into
	// (M4 §4), so import must not seed it from nilai_transaksi_total.
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO clients
		 (id, nama_pic, toko, kota, link_toko, kategori, gmv_baseline, target_gmv, marketing_budget,
		  total_sales, sales_pic_id, commission_payment_pic_id, transaction_id, payment_intent, created_by)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
		cliID, row.NamaPIC, row.Toko, row.Kota, row.LinkToko, row.Kategori,
		row.GMVBaselineBulanan.Decimal(), row.TargetGMV.Decimal(), nullMoney(row.MarketingBudget),
		row.SalesPIC, pic, trxID, row.SkemaPembayaran, actor.EmployeeID); err != nil {
		return ids, err
	}
	if err := audit.Write(ctx, tx, audit.Record{
		EntityType: "client", EntityID: cliID, Actor: actor.EmployeeID,
		Action: "import:client",
		After:  map[string]any{"row_index": index, "source": "spreadsheet", "toko": row.Toko, "scheme": row.SkemaPembayaran},
	}); err != nil {
		return ids, err
	}

	// Platforms.
	for _, p := range row.Platforms {
		var since any
		if p.TanggalMulai != nil {
			since = p.TanggalMulai.Format("2006-01-02")
		}
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO client_platforms (client_id, platform, store_link, managed_since, active, created_by)
			 VALUES (?, ?, ?, ?, 1, ?)`,
			cliID, p.Platform, nullStr(p.Link), since, actor.EmployeeID); err != nil {
			return ids, err
		}
	}

	// Sales allocation (basis points; Σ=10000 already validated).
	for _, a := range row.AlokasiSales {
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO client_sales_allocations (client_id, salesperson_id, basis_points, created_by)
			 VALUES (?, ?, ?, ?)`,
			cliID, a.SalespersonID, a.BasisPoints, actor.EmployeeID); err != nil {
			return ids, err
		}
	}

	// Services (SVC-) at the MService initial state.
	for _, svc := range row.Layanan {
		svcID, err := ident.Next(ctx, tx, "SVC", now)
		if err != nil {
			return ids, err
		}
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO services (id, client_id, master_service_id, master_version_no, name, standard_price, commission_rule, status, created_by)
			 VALUES (?, ?, '', 0, ?, ?, '', ?, ?)`,
			svcID, cliID, svc.Nama, svc.HargaDeal.Decimal(), serviceInitialStatus, actor.EmployeeID); err != nil {
			return ids, err
		}
		ids.Services = append(ids.Services, svcID)
		if err := audit.Write(ctx, tx, audit.Record{
			EntityType: "service", EntityID: svcID, Actor: actor.EmployeeID,
			Action: "import:service",
			After:  map[string]any{"row_index": index, "client_id": cliID, "name": svc.Nama},
		}); err != nil {
			return ids, err
		}
	}

	// Transaction (TRX-) at [Menunggu Verifikasi]; contract attached later.
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO transactions (id, client_id, payment_intent_scheme, total_agreed_value, payment_status, created_by)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		trxID, cliID, row.SkemaPembayaran, row.NilaiTransaksiTotal.Decimal(),
		module5_finance.TrxMenungguVerifikasi, actor.EmployeeID); err != nil {
		return ids, err
	}
	if err := audit.Write(ctx, tx, audit.Record{
		EntityType: "transaction", EntityID: trxID, Actor: actor.EmployeeID,
		Action: "import:transaction",
		After:  map[string]any{"row_index": index, "client_id": cliID, "scheme": row.SkemaPembayaran, "total": row.NilaiTransaksiTotal.Decimal()},
	}); err != nil {
		return ids, err
	}

	// Installments (INST-) for Termin / Bayar di Belakang, consistent with
	// module5_finance.CreateSchedule (same initial status + one summary audit).
	if hasSchedule(row.SkemaPembayaran) {
		for i, t := range row.JadwalTermin {
			instID, err := ident.Next(ctx, tx, "INST", now)
			if err != nil {
				return ids, err
			}
			if _, err := tx.ExecContext(ctx,
				`INSERT INTO installments (id, transaction_id, installment_no, amount, due_date, status, created_by)
				 VALUES (?, ?, ?, ?, ?, ?, ?)`,
				instID, trxID, i+1, t.Amount.Decimal(), t.DueDate.Format("2006-01-02"),
				module5_finance.InstBelumJatuhTempo, actor.EmployeeID); err != nil {
				return ids, err
			}
			ids.Installments = append(ids.Installments, instID)
		}
		if err := audit.Write(ctx, tx, audit.Record{
			EntityType: "transaction", EntityID: trxID, Actor: actor.EmployeeID,
			Action: "import:schedule",
			After:  map[string]any{"row_index": index, "installments": len(ids.Installments)},
		}); err != nil {
			return ids, err
		}
	}

	return ids, nil
}

// replayPayments re-plays each already-verified payment through the OFFICIAL
// verification path so payment status, the verification log and the routing gate
// all fire authentically. Contract (if any) is attached BEFORE replay so the
// closing payment clears the [Lunas] gate. Amounts/mappings were pre-validated,
// so this cannot fail on a business rule.
func (s *Service) replayPayments(ctx context.Context, actor permission.Actor, row ClientRow, ids clientIDs) error {
	fin := s.finance()

	if row.LinkKontrak != "" {
		if err := fin.AttachContract(ctx, actor, ids.Transaction, row.LinkKontrak); err != nil {
			return err
		}
	}

	for i, p := range row.PembayaranTerverifikasi {
		req := module5_finance.VerifyRequest{Amount: p.Amount, ReceivedDate: p.Tanggal}
		if hasSchedule(row.SkemaPembayaran) {
			req.InstallmentID = ids.Installments[i] // sequential mapping (validated)
		}
		if _, err := fin.Verify(ctx, actor, ids.Transaction, req); err != nil {
			return err
		}
	}
	return nil
}

func hasSchedule(scheme string) bool {
	return scheme == module5_finance.SchemeTermin || scheme == module5_finance.SchemeBayarDiBelakang
}

func nullMoney(m *money.Money) any {
	if m == nil {
		return nil
	}
	return m.Decimal()
}
