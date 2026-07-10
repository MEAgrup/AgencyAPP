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

// CSVSource is the dev/staging contingency EmployeeSource (Build Plan R1,
// docs/HRIS API CONTRACT.md §3), used before the HRIS HTTP endpoints exist or
// as a manual fallback. It must satisfy the exact same EmployeeSource
// contract as HTTPSource: Fetch(ctx, updatedSince) filters rows whose
// updated_at is on/after updatedSince, and a zero updatedSince returns every
// row (full sync).
//
// Expected CSV shape (header row required, any column order):
//
//	employee_id,nama,email,divisi,jabatan,status_aktif,updated_at
//
// status_aktif accepts true/false/1/0 (anything strconv.ParseBool accepts).
// updated_at is RFC3339.
type CSVSource struct {
	// Open returns a fresh reader over the CSV data for each Fetch call, so
	// the same CSVSource can be reused across repeated syncs against a
	// changing file/buffer. Required.
	Open func() (io.ReadCloser, error)
}

// NewCSVFileSource builds a CSVSource reading from the file at path.
func NewCSVFileSource(path string) *CSVSource {
	return &CSVSource{
		Open: func() (io.ReadCloser, error) {
			return os.Open(path)
		},
	}
}

var csvColumns = []string{"employee_id", "nama", "email", "divisi", "jabatan", "status_aktif", "updated_at"}

func (c *CSVSource) Fetch(ctx context.Context, updatedSince time.Time) ([]Employee, error) {
	if c.Open == nil {
		return nil, fmt.Errorf("hris: CSVSource.Open is nil")
	}
	rc, err := c.Open()
	if err != nil {
		return nil, fmt.Errorf("hris: open csv source: %w", err)
	}
	defer rc.Close()

	r := csv.NewReader(rc)
	r.TrimLeadingSpace = true

	header, err := r.Read()
	if err != nil {
		if err == io.EOF {
			return nil, fmt.Errorf("hris: empty csv source, expected header row %v", csvColumns)
		}
		return nil, fmt.Errorf("hris: read csv header: %w", err)
	}
	idx := make(map[string]int, len(header))
	for i, col := range header {
		idx[strings.TrimSpace(strings.ToLower(col))] = i
	}
	for _, want := range csvColumns {
		if _, ok := idx[want]; !ok {
			return nil, fmt.Errorf("hris: csv source missing required column %q", want)
		}
	}

	var out []Employee
	for {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		record, err := r.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("hris: read csv row: %w", err)
		}

		emp, err := parseCSVRow(idx, record)
		if err != nil {
			return nil, err
		}
		if !updatedSince.IsZero() && emp.UpdatedAt.Before(updatedSince) {
			continue
		}
		out = append(out, emp)
	}
	return out, nil
}

func parseCSVRow(idx map[string]int, record []string) (Employee, error) {
	field := func(name string) (string, error) {
		i, ok := idx[name]
		if !ok || i >= len(record) {
			return "", fmt.Errorf("hris: csv row missing column %q", name)
		}
		return strings.TrimSpace(record[i]), nil
	}

	employeeID, err := field("employee_id")
	if err != nil {
		return Employee{}, err
	}
	nama, err := field("nama")
	if err != nil {
		return Employee{}, err
	}
	email, err := field("email")
	if err != nil {
		return Employee{}, err
	}
	divisi, err := field("divisi")
	if err != nil {
		return Employee{}, err
	}
	jabatan, err := field("jabatan")
	if err != nil {
		return Employee{}, err
	}
	statusRaw, err := field("status_aktif")
	if err != nil {
		return Employee{}, err
	}
	updatedRaw, err := field("updated_at")
	if err != nil {
		return Employee{}, err
	}

	statusAktif, err := strconv.ParseBool(statusRaw)
	if err != nil {
		return Employee{}, fmt.Errorf("hris: csv row %s: invalid status_aktif %q: %w", employeeID, statusRaw, err)
	}
	updatedAt, err := time.Parse(time.RFC3339, updatedRaw)
	if err != nil {
		return Employee{}, fmt.Errorf("hris: csv row %s: invalid updated_at %q: %w", employeeID, updatedRaw, err)
	}

	return Employee{
		EmployeeID:  employeeID,
		Nama:        nama,
		Email:       email,
		Divisi:      divisi,
		Jabatan:     jabatan,
		StatusAktif: statusAktif,
		UpdatedAt:   updatedAt.UTC(),
	}, nil
}
