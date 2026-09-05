package module1_leads

import (
	"context"
	"errors"
	"testing"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
)

// TestRegisterClientBlocked ports register_test.go (stream A) ClientBlocked to
// dedup v2: a Sales single registration on a phone that already became a client
// ([Closed-Success]) is blocked with the verbatim already-client reason, the
// block is audited on the existing record, and no new lead/attempt is created.
func TestRegisterClientBlocked(t *testing.T) {
	s := newService(t)
	ctx := context.Background()

	if _, err := s.DB.ExecContext(ctx,
		`INSERT INTO leads (id, lead_name, phone_number, phone_norm, source, origin_division, record_status, created_by)
		 VALUES ('LEAD-CLIENT', 'Sudah Klien', '0812 999 0002', ?, 'Scouting', 'Sales', '[Closed-Success]', 'TEST')`,
		NormalizePhone("0812 999 0002")); err != nil {
		t.Fatal(err)
	}

	_, _, _, err := s.Register(ctx, salesActor("EMP-BUDI"), RegisterInput{
		LeadName: "Coba Lagi", PhoneNumber: "0812 999 0002", Source: "Scouting",
	})
	var blocked *ErrBlocked
	if !errors.As(err, &blocked) {
		t.Fatalf("err = %v, want *ErrBlocked", err)
	}
	if blocked.Message != MsgAlreadyClient {
		t.Fatalf("message = %q, want %q", blocked.Message, MsgAlreadyClient)
	}
	var leads, attempts int
	s.DB.QueryRow(`SELECT COUNT(*) FROM leads`).Scan(&leads)
	s.DB.QueryRow(`SELECT COUNT(*) FROM prospect_attempts`).Scan(&attempts)
	if leads != 1 || attempts != 0 {
		t.Fatalf("client-blocked register must create nothing: leads=%d attempts=%d", leads, attempts)
	}
	le, _ := audit.List(ctx, s.DB, audit.Filter{EntityType: "lead", EntityID: "LEAD-CLIENT"})
	var sawBlock bool
	for _, e := range le {
		if e.Action == "dedup_blocked" {
			sawBlock = true
		}
	}
	if !sawBlock {
		t.Fatal("client-blocked register must be audited on the existing record")
	}
}

// TestRegisterPoolDuplicateBlocked ports register_test.go (stream A)
// PoolDuplicatePointsAtExisting: a Sales single registration on a phone already
// sitting in [Pool] with no open attempt is blocked as a duplicate record (the
// official path is the Pool claim, §6) — no second record is created.
func TestRegisterPoolDuplicateBlocked(t *testing.T) {
	s := newService(t)
	ctx := context.Background()

	if _, err := s.DB.ExecContext(ctx,
		`INSERT INTO leads (id, lead_name, phone_number, phone_norm, source, origin_division, record_status, created_by)
		 VALUES ('LEAD-POOL2', 'Toko Pool', '0812 777 0002', ?, 'Leads - Iklan', 'Marketing', '[Pool]', 'TEST')`,
		NormalizePhone("0812 777 0002")); err != nil {
		t.Fatal(err)
	}

	_, _, _, err := s.Register(ctx, salesActor("EMP-BUDI"), RegisterInput{
		LeadName: "Toko Pool", PhoneNumber: "0812-777-0002", Source: "Scouting",
	})
	var blocked *ErrBlocked
	if !errors.As(err, &blocked) {
		t.Fatalf("err = %v, want *ErrBlocked", err)
	}
	if blocked.Message != MsgDuplicatePool {
		t.Fatalf("message = %q, want %q", blocked.Message, MsgDuplicatePool)
	}
	var n int
	s.DB.QueryRow(`SELECT COUNT(*) FROM leads`).Scan(&n)
	if n != 1 {
		t.Fatalf("pool duplicate must not create a second record, got %d leads", n)
	}
}
