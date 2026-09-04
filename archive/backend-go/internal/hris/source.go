// Package hris integrates CDPS with the existing HRIS: read-only employee sync
// (S0-06) and credential verification (S0-07). CDPS never stores passwords and
// never writes to HRIS.
package hris

import (
	"context"
	"encoding/csv"
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"
	"time"
)

// Employee is the HRIS people record CDPS consumes.
type Employee struct {
	EmployeeID  string    `json:"employee_id"`
	Nama        string    `json:"nama"`
	Email       string    `json:"email"`
	Divisi      string    `json:"divisi"`
	Jabatan     string    `json:"jabatan"`
	StatusAktif bool      `json:"status_aktif"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// EmployeeSource abstracts where employee data comes from. HTTP is production;
// CSV is the dev/contingency fallback (Build Plan R1). Consumers depend only on
// this interface, so swapping implementations requires zero consumer changes.
type EmployeeSource interface {
	// Fetch returns employees updated since the given time (zero => full sync).
	Fetch(ctx context.Context, updatedSince time.Time) ([]Employee, error)
	// Name identifies the source (for logs/audit).
	Name() string
}

// CSVSource reads employees from a CSV file.
// Columns: employee_id,nama,email,divisi,jabatan,status_aktif[,password]
// (password is consumed by the mock HRIS auth, ignored by sync).
type CSVSource struct {
	Path string
}

// NewCSVSource builds a CSV-backed source.
func NewCSVSource(path string) *CSVSource { return &CSVSource{Path: path} }

// Name implements EmployeeSource.
func (c *CSVSource) Name() string { return "csv:" + c.Path }

// Fetch implements EmployeeSource. updatedSince filters by the CSV has no
// updated_at column, so it returns all rows (a full CSV is always a full set).
func (c *CSVSource) Fetch(_ context.Context, _ time.Time) ([]Employee, error) {
	f, err := os.Open(c.Path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	recs, err := ParseEmployeeCSV(f)
	if err != nil {
		return nil, err
	}
	out := make([]Employee, len(recs))
	for i, r := range recs {
		out[i] = r.Employee
	}
	return out, nil
}

// CSVRecord is a parsed CSV row including the (auth-only) password.
type CSVRecord struct {
	Employee Employee
	Password string
}

// ParseEmployeeCSV parses the employee CSV format. The header row is required.
func ParseEmployeeCSV(r io.Reader) ([]CSVRecord, error) {
	cr := csv.NewReader(r)
	cr.TrimLeadingSpace = true
	cr.FieldsPerRecord = -1
	var out []CSVRecord
	header := true
	for {
		row, err := cr.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, err
		}
		if header {
			header = false
			continue
		}
		if len(row) < 6 {
			return nil, fmt.Errorf("hris csv: expected >=6 columns, got %d", len(row))
		}
		active, _ := strconv.ParseBool(strings.TrimSpace(row[5]))
		rec := CSVRecord{
			Employee: Employee{
				EmployeeID:  strings.TrimSpace(row[0]),
				Nama:        strings.TrimSpace(row[1]),
				Email:       strings.TrimSpace(row[2]),
				Divisi:      strings.TrimSpace(row[3]),
				Jabatan:     strings.TrimSpace(row[4]),
				StatusAktif: active,
				UpdatedAt:   time.Now(),
			},
		}
		if len(row) >= 7 && strings.TrimSpace(row[6]) != "" {
			rec.Password = strings.TrimSpace(row[6])
		} else {
			rec.Password = "rahasia123"
		}
		out = append(out, rec)
	}
	return out, nil
}
