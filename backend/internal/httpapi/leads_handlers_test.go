package httpapi

import (
	"encoding/json"
	"errors"
	"net/http/httptest"
	"testing"

	"github.com/meagrup/agencyapp/backend/internal/module1_leads"
)

// TestWriteDomainErr_AlreadyPursuing pins the same-salesperson guard mapping:
// with collaborative dedup (DECISIONS 2026-07-10) Register can surface
// ErrAlreadyPursuing directly to the user, so it must map to 409 + the verbatim
// BI string — never the 500 [terjadi kesalahan] fallback.
func TestWriteDomainErr_AlreadyPursuing(t *testing.T) {
	a := &App{}
	rec := httptest.NewRecorder()
	a.writeDomainErr(rec, module1_leads.ErrAlreadyPursuing)

	if rec.Code != 409 {
		t.Fatalf("status = %d, want 409", rec.Code)
	}
	var body map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("unmarshal body: %v", err)
	}
	if body["message"] != module1_leads.MsgAlreadyPursuing {
		t.Fatalf("message = %q, want %q", body["message"], module1_leads.MsgAlreadyPursuing)
	}
	if module1_leads.MsgAlreadyPursuing != "[anda sudah memproses lead ini]" {
		t.Fatalf("MsgAlreadyPursuing = %q, want verbatim BI string", module1_leads.MsgAlreadyPursuing)
	}
}

// TestWriteDomainErr_WrappedAlreadyPursuing ensures wrapping still maps via
// errors.Is, not string comparison.
func TestWriteDomainErr_WrappedAlreadyPursuing(t *testing.T) {
	a := &App{}
	rec := httptest.NewRecorder()
	a.writeDomainErr(rec, errors.Join(module1_leads.ErrAlreadyPursuing))
	if rec.Code != 409 {
		t.Fatalf("status = %d, want 409", rec.Code)
	}
}
