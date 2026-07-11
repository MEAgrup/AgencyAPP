// Package leads is Module 1 — the Leads Database: the canonical registry of
// every lead from every source (docs/prd/HRIS Module1 Leads Database.md).
//
// It owns the central `LEAD-` record (§2, §9.3), the two intake doors —
// Sales single registration (§4) and Marketing single + bulk import (§3) —
// and the global, phone-keyed deduplication engine (§5). Prospect attempts
// (`PRSP-`) are a salesperson's working copy of a lead; their status machine
// lives in the shared statemachine engine (§1) and their creation is owned by
// Module 0 (Sales), consumed here through the AttemptCreator interface so the
// two modules can be built in parallel.
//
// Design note — Lead record status is NOT driven by the statemachine engine.
// The engine deliberately excludes §2 Lead record (see
// internal/core/statemachine/machines.go) because it is flag/dedup/pool logic,
// not a transition table. This package therefore maintains record_status
// directly, but every change is still appended to the immutable audit log
// (CLAUDE.md convention #3) exactly as a transition would be.
package leads

import "time"

// Division is a lead's Origin Division (§9.3, {Marketing, Sales}). The string
// values also match the HRIS `divisi` used by authz for the permission checks
// in §9.1.
const (
	DivisiSales     = "Sales"
	DivisiMarketing = "Marketing"
)

// RecordStatus is the Lead record's own lifecycle state, keyed on by the
// dedup decision table (§5 rule 4). Most values are byte-exact PRD strings;
// StatusScoutedActive is the one exception (see its comment) and is flagged in
// the build report / DECISIONS.md proposal.
type RecordStatus string

const (
	// StatusPool — Marketing-sourced or reopened lead, claimable, 0..N
	// attempts (§2 status table, byte-exact).
	StatusPool RecordStatus = "[Pool]"
	// StatusScoutedActive — a Sales-registered (scouted) lead with an active
	// exclusive attempt (New Lead … Negotiation). FLAGGED: §2 describes this
	// record state only as "active (scouted-owned)" and gives no bracketed BI
	// label, so this value is dev-defined (non-bracketed to signal it is not a
	// PRD label). It never surfaces to users — user-facing block messages are
	// the PRD strings in messages.go.
	StatusScoutedActive RecordStatus = "Scouted-Active"
	// StatusRejected / StatusNotQualified — every attempt terminated in a
	// rejecting state; re-entry reopens to [Pool] (§5 rule 4 row 3). Byte-exact
	// per §5 / STATE_MACHINES §2.
	StatusRejected     RecordStatus = "[Rejected]"
	StatusNotQualified RecordStatus = "[Not Qualified]"
	// StatusClient — a winning attempt reached Closed-Success; the lead is now
	// a client (§5 rule 4 row 4). Byte-exact per §5's decision-table label
	// `[Closed - Success]` (note this differs from the attempt-level label
	// `Closed-Success` in the statemachine — the PRD renders both spellings).
	StatusClient RecordStatus = "[Closed - Success]"
)

// Source is a lead's Source (§4 rule 3 reference list / §9.3). Values are
// byte-exact from §4. On Marketing import the Source is auto-derived from the
// campaign (M1-OA-3); on Sales registration the salesperson picks one.
const (
	SourceScouting  = "Scouting"
	SourceSocmed    = "Leads - Socmed"
	SourceIklan     = "Leads - Iklan"
	SourceWebsite   = "Website"
	SourceReferral  = "Referral (Affiliasi)"
	SourceBroadcast = "Broadcast"
	SourceEvent     = "Event"
	SourceKulwa     = "Kulwa"
	SourceDatabase  = "Database"
	SourceOthers    = "Others"
)

// validSources is the closed reference set (§4 rule 3). Any Source outside it
// fails mandatory validation.
var validSources = map[string]struct{}{
	SourceScouting: {}, SourceSocmed: {}, SourceIklan: {}, SourceWebsite: {},
	SourceReferral: {}, SourceBroadcast: {}, SourceEvent: {}, SourceKulwa: {},
	SourceDatabase: {}, SourceOthers: {},
}

// campaignRequiredSources is the subset for which Origin Campaign is mandatory
// (§9.3 Origin Campaign row / M1-OA-3): {Leads-Iklan, Broadcast, Event, Kulwa}.
var campaignRequiredSources = map[string]struct{}{
	SourceIklan: {}, SourceBroadcast: {}, SourceEvent: {}, SourceKulwa: {},
}

func isValidSource(s string) bool {
	_, ok := validSources[s]
	return ok
}

func requiresOriginCampaign(s string) bool {
	_, ok := campaignRequiredSources[s]
	return ok
}

// Lead is a materialised Lead record row (§9.3).
type Lead struct {
	LeadID                 string
	LeadName               string
	PhoneRaw               string
	PhoneNormalized        string
	Email                  string // "" when absent (optional)
	Source                 string
	OriginDivision         string
	OriginCampaign         string // "" when absent
	LastTouchCampaign      string // "" when absent
	RecordStatus           RecordStatus
	WinningAttempt         string // "" until win resolution (W1-03)
	WinningSalespersonID   string // "" until win resolution; owner of the winning attempt (M1 §6 rule 5)
	ScoutedOwnerEmployeeID string // "" for pool leads
	ManualReviewFlag       bool
	// PoolEnteredAt is when the record (re)entered [Pool]; zero when the lead
	// has never been in the pool. Basis of the COMPUTED 24h stale flag
	// (M1-OA-7) — the flag itself is never stored.
	PoolEnteredAt time.Time
}

// CampaignStub is a row of the temporary campaign gate stub (see
// migrations/0031). Replaced by the full M3 Campaign entity in Wave 3.
type CampaignStub struct {
	CampaignID      string
	Status          string // "Active" unlocks import
	Source          string // Source applied to leads imported under this campaign
	OwnerEmployeeID string
}

// campaignActiveStatus is the only gate value that unlocks import (M1 §3 /
// STATE_MACHINES §3 Active). Byte-exact.
const campaignActiveStatus = "Active"
