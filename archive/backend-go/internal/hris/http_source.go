package hris

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"time"
)

// HTTPSource fetches employees from the HRIS per docs/HRIS_API_CONTRACT.md:
// GET /api/v1/employees?updated_since&page&page_size with a Bearer service token.
type HTTPSource struct {
	BaseURL      string
	ServiceToken string
	PageSize     int
	Client       *http.Client
}

// NewHTTPSource builds an HTTP-backed source.
func NewHTTPSource(baseURL, serviceToken string) *HTTPSource {
	return &HTTPSource{
		BaseURL:      baseURL,
		ServiceToken: serviceToken,
		PageSize:     100,
		Client:       &http.Client{Timeout: 15 * time.Second},
	}
}

// Name implements EmployeeSource.
func (h *HTTPSource) Name() string { return "http:" + h.BaseURL }

type employeesResponse struct {
	Data     []Employee `json:"data"`
	Page     int        `json:"page"`
	PageSize int        `json:"page_size"`
	Total    int        `json:"total"`
}

// Fetch implements EmployeeSource, paginating through all pages.
func (h *HTTPSource) Fetch(ctx context.Context, updatedSince time.Time) ([]Employee, error) {
	pageSize := h.PageSize
	if pageSize <= 0 {
		pageSize = 100
	}
	var all []Employee
	page := 1
	for {
		q := url.Values{}
		q.Set("page", strconv.Itoa(page))
		q.Set("page_size", strconv.Itoa(pageSize))
		if !updatedSince.IsZero() {
			q.Set("updated_since", updatedSince.Format(time.RFC3339))
		}
		reqURL := fmt.Sprintf("%s/api/v1/employees?%s", h.BaseURL, q.Encode())
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
		if err != nil {
			return nil, err
		}
		if h.ServiceToken != "" {
			req.Header.Set("Authorization", "Bearer "+h.ServiceToken)
		}
		resp, err := h.Client.Do(req)
		if err != nil {
			return nil, err
		}
		if resp.StatusCode != http.StatusOK {
			resp.Body.Close()
			return nil, fmt.Errorf("hris: employees fetch status %d", resp.StatusCode)
		}
		var er employeesResponse
		if err := json.NewDecoder(resp.Body).Decode(&er); err != nil {
			resp.Body.Close()
			return nil, err
		}
		resp.Body.Close()
		all = append(all, er.Data...)
		if len(er.Data) < pageSize || len(all) >= er.Total || len(er.Data) == 0 {
			break
		}
		page++
	}
	return all, nil
}
