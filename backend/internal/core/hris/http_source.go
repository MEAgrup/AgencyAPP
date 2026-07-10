package hris

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// HTTPSource is the production EmployeeSource: GET /api/v1/employees per
// docs/HRIS API CONTRACT.md §1, server-to-server with a static bearer service
// token. It loops the page/page_size pagination internally so callers (the
// Syncer) always see one flat slice, exactly like CSVSource.
type HTTPSource struct {
	// BaseURL is the HRIS root, e.g. "https://hris.internal". Required.
	BaseURL string
	// ServiceToken is sent as "Authorization: Bearer <token>". Required.
	ServiceToken string
	// HTTPClient defaults to http.DefaultClient when nil.
	HTTPClient *http.Client
	// PageSize defaults to 100 when <= 0.
	PageSize int
	// MaxPages guards against a misbehaving server looping forever; 0 (or <= 0)
	// means use the package default (defaultMaxPages).
	MaxPages int
}

const (
	defaultPageSize = 100
	defaultMaxPages = 1000
)

type employeesPage struct {
	Data []struct {
		EmployeeID  string `json:"employee_id"`
		Nama        string `json:"nama"`
		Email       string `json:"email"`
		Divisi      string `json:"divisi"`
		Jabatan     string `json:"jabatan"`
		StatusAktif bool   `json:"status_aktif"`
		UpdatedAt   string `json:"updated_at"`
	} `json:"data"`
	Page     int `json:"page"`
	PageSize int `json:"page_size"`
	Total    int `json:"total"`
}

func (h *HTTPSource) Fetch(ctx context.Context, updatedSince time.Time) ([]Employee, error) {
	if h.BaseURL == "" {
		return nil, fmt.Errorf("hris: HTTPSource.BaseURL is required")
	}
	client := h.HTTPClient
	if client == nil {
		client = http.DefaultClient
	}
	pageSize := h.PageSize
	if pageSize <= 0 {
		pageSize = defaultPageSize
	}
	maxPages := h.MaxPages
	if maxPages <= 0 {
		maxPages = defaultMaxPages
	}

	var out []Employee
	page := 1
	for {
		if page > maxPages {
			return nil, fmt.Errorf("hris: employees pagination exceeded %d pages, aborting", maxPages)
		}

		body, err := h.fetchPage(ctx, client, updatedSince, page, pageSize)
		if err != nil {
			return nil, err
		}

		for _, row := range body.Data {
			updatedAt, err := time.Parse(time.RFC3339, row.UpdatedAt)
			if err != nil {
				return nil, fmt.Errorf("hris: employee %s: invalid updated_at %q: %w", row.EmployeeID, row.UpdatedAt, err)
			}
			out = append(out, Employee{
				EmployeeID:  row.EmployeeID,
				Nama:        row.Nama,
				Email:       row.Email,
				Divisi:      row.Divisi,
				Jabatan:     row.Jabatan,
				StatusAktif: row.StatusAktif,
				UpdatedAt:   updatedAt.UTC(),
			})
		}

		if len(body.Data) == 0 || len(body.Data) < pageSize || (body.Total > 0 && len(out) >= body.Total) {
			break
		}
		page++
	}
	return out, nil
}

func (h *HTTPSource) fetchPage(ctx context.Context, client *http.Client, updatedSince time.Time, page, pageSize int) (*employeesPage, error) {
	u, err := url.Parse(strings.TrimRight(h.BaseURL, "/") + "/api/v1/employees")
	if err != nil {
		return nil, fmt.Errorf("hris: invalid BaseURL: %w", err)
	}
	q := u.Query()
	if !updatedSince.IsZero() {
		q.Set("updated_since", updatedSince.UTC().Format(time.RFC3339))
	}
	q.Set("page", strconv.Itoa(page))
	q.Set("page_size", strconv.Itoa(pageSize))
	u.RawQuery = q.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, fmt.Errorf("hris: build employees request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+h.ServiceToken)
	req.Header.Set("Accept", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrHRISUnreachable, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 500 {
		return nil, fmt.Errorf("%w: employees status %d", ErrHRISUnreachable, resp.StatusCode)
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("hris: employees unexpected status %d", resp.StatusCode)
	}

	var out employeesPage
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, fmt.Errorf("hris: decode employees response: %w", err)
	}
	return &out, nil
}
