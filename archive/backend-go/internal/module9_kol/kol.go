// Package module9_kol is Module 9 (KOL). It introduces the Creator Booking (BKG-),
// KOL's unit of work: one row per creator secured to produce content for a client's
// campaign (M9 §2 — a Brief for "Book 5 Micro KOLs" fans out into up to 5 Booking
// rows, the same principle as Creative's Asset and Ads' Ad Campaign).
//
// Why KOL is different from Creative/Ads (M9 §1/§2): the creator is an EXTERNAL
// party MEA does not fully control. So a Booking has its OWN native lifecycle
// (STATE_MACHINES §8, machine creator_booking) with room for sourcing/negotiation
// and a real failure path (escalation → drop → re-source), which the internal-staff
// modules do not need. A Booking is therefore NOT a canonical Task row: it is not
// registered as a module12_task source (its machine differs). For Module 12 Speed
// Score its 8 native states are MAPPED onto the canonical 6-state machine (§11) and
// fed through a thin translation layer into M12's pure metric core — see metrics.go.
//
// Division of responsibility:
//   - This package owns the Booking ENTITY end to end: creation (Brief breakdown,
//     §4), the whole native lifecycle incl. QC (done by KOL itself, §5 — NOT the AM,
//     unlike M7), coordinator assignment (§3), the Creator Payment Request (§8), the
//     compiled Creator List (§6), and the Brief↔Booking roll-up (§2).
//   - module6_account owns the KOL Brief's own creation/review and the Service
//     advance hook (OnBriefLeavesToDo), which this package calls when the Brief
//     first leaves [To Do] via the roll-up — the same one-way injection M7/M12 use.
//   - module5_finance is the authority that actually pays; KOL only REQUESTS (§8
//     Rule 1 / M9-OA-5). The CPR lifecycle's Finance-side edges are gated to Finance.
//
// House rules honoured here:
//   - the BKG-/CPR- id is minted (ident.Next) ONLY after mandatory-field validation
//     passes (house rule 1);
//   - the birth status is set at INSERT (a creation, not a transition — same
//     precedent as Asset/Brief/ADC birth statuses); every later status move goes
//     through the engine, never a raw UPDATE (house rule 2);
//   - Revision Count / Sourcing & Delivery Turnaround / Speed Score / Payment Status
//     are DERIVED from the immutable log, never stored as mutable columns (rules 3/4);
//   - money renders "Rp. X.XXX.XXX,00" (house rule 7).
package module9_kol

import (
	"context"
	"database/sql"
	"errors"

	"github.com/meagrup/agencyapp/backend/internal/core/permission"
	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
)

// CDPS divisions this module reasons about.
const (
	// KOLDivision owns Creator Bookings (DECISIONS 2026-07-12: HRIS AFFILIATE joins
	// divisi KOL). Its staff are Coordinators; its lead is the KOL Team Leader.
	KOLDivision = "KOL"
	// AccountDivision is the client-owning division; its lead (SPV/Head Account) is
	// the M9-OA-6 tie-breaker on escalated Bookings and reads cross-division.
	AccountDivision = "Account"
	// FinanceDivision executes creator payments (§8 Rule 1 / M9-OA-5).
	FinanceDivision = "Finance"
)

// Creator Booking statuses — the creator_booking machine (STATE_MACHINES §8).
const (
	BkgSourcing      = "[Sourcing]"
	BkgBooked        = "[Booked]"
	BkgContentInProg = "[Content In Progress]"
	BkgContentSubmit = "[Content Submitted]"
	BkgQCReview      = "[QC Review]"
	BkgQCPassed      = "[QC Passed]" // terminal
	BkgQCFailed      = "[QC Failed - Revision Requested]"
	BkgEscalated     = "[Escalated - Creator Unresponsive]"
	BkgDropped       = "[Dropped]" // terminal
)

// Creator Payment Request statuses — the creator_payment_request machine (§9).
const (
	CprRequested = "[Requested]"
	CprReceived  = "[Received by Finance]"
	CprPaid      = "[Paid]"     // terminal
	CprRejected  = "[Rejected]" // terminal
)

// Source Pool enum (§10.3 / M9-OA-1: MCN MEA Roster → KOL External Pool → Ad-hoc).
const (
	SourcePoolMCN    = "MCN MEA Roster"
	SourcePoolExtern = "KOL External Pool"
	SourcePoolAdHoc  = "Ad-hoc New"
)

var validSourcePools = map[string]bool{
	SourcePoolMCN: true, SourcePoolExtern: true, SourcePoolAdHoc: true,
}

// revisionCap is the M9-OA-2 allowance: 1 revision round per Booking before it must
// be escalated. Derived from the audit log, never a stored tally (§5 Rule 3).
const revisionCap = 1

// Sentinel errors carrying the exact Bahasa Indonesia message (house rule 5). The
// PRD quotes none of these verbatim, so they follow the W1-09 precedent and are
// listed in the report for orchestrator sign-off. Where a string already exists in
// a sibling module for the same meaning it is REUSED verbatim (noted inline).
var (
	// ErrIncomplete: a mandatory field is missing (house-convention default; reused).
	ErrIncomplete = errors.New("[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]")
	// ErrBriefNotFound: the parent Brief does not exist (reused from M6/M7/M8).
	ErrBriefNotFound = errors.New("[brief tidak ditemukan]")
	// ErrNotKOLBrief: the Brief is not a KOL Brief, so it has no Bookings.
	ErrNotKOLBrief = errors.New("[brief ini bukan brief divisi KOL]")
	// ErrBriefNotBookable: the Brief is terminal ([Approved]/[Cancelled]) — no Booking.
	ErrBriefNotBookable = errors.New("[booking tidak dapat dibuat untuk brief pada status ini]")
	// ErrInvalidSourcePool: Source Pool is outside the M9-OA-1 set.
	ErrInvalidSourcePool = errors.New("[source pool tidak valid]")
	// ErrBookingNotFound: the referenced Booking does not exist.
	ErrBookingNotFound = errors.New("[booking tidak ditemukan]")
	// ErrBookingViewForbidden: actor may not read this Booking (§10.1 read gate).
	ErrBookingViewForbidden = errors.New("[anda tidak memiliki akses ke booking ini]")
	// ErrExecForbidden: actor may not drive this Booking's lifecycle (not the KOL
	// division's staff/lead, not the assigned Coordinator where one is set).
	ErrExecForbidden = errors.New("[anda tidak memiliki akses untuk mengerjakan booking ini]")
	// ErrEscalateForbidden: actor may not escalate this Booking (KOL lead/Director).
	ErrEscalateForbidden = errors.New("[anda tidak memiliki akses untuk mengeskalasi booking ini]")
	// ErrDropForbidden: actor may not drop this Booking (KOL lead / Account lead
	// tie-breaker / Director, §5 Rule 4 / M9-OA-6).
	ErrDropForbidden = errors.New("[anda tidak memiliki akses untuk men-drop booking ini]")
	// ErrAssignForbidden: actor may not assign/reassign a Coordinator or set the SLA
	// (KOL Team Leader/Director only, §3 Rule 3).
	ErrAssignForbidden = errors.New("[anda tidak memiliki akses untuk menugaskan Coordinator atau menetapkan SLA booking ini]")
	// ErrInvalidCoordinator: chosen Coordinator is not an active KOL-division staff.
	ErrInvalidCoordinator = errors.New("[Coordinator tidak valid: harus staff divisi KOL yang aktif]")
	// ErrReassignReasonRequired: a Coordinator reassignment must carry a reason (§3 Rule 3).
	ErrReassignReasonRequired = errors.New("[alasan reassignment wajib diisi]")
	// ErrInvalidSLA: SLA Target must be a positive number of hours (reused meaning).
	ErrInvalidSLA = errors.New("[target SLA harus lebih dari 0 jam]")
	// ErrContentLinkRequired: a Booking cannot enter [Content Submitted] without a
	// content link (§4 Rule 3 — the KOL analogue of M7's output-link gate).
	ErrContentLinkRequired = errors.New("[link konten wajib diisi sebelum submit]")
	// ErrQCNotesRequired: QC Notes are mandatory on fail/escalate (§10.3).
	ErrQCNotesRequired = errors.New("[catatan QC wajib diisi]")
	// ErrDropReasonRequired: a drop must carry a reason (§5 Rule 4 — logged).
	ErrDropReasonRequired = errors.New("[alasan drop wajib diisi]")
	// ErrRevisionCapReached: the M9-OA-2 revision cap (1) is reached — the only move
	// left is escalation (§5 Rule 3).
	ErrRevisionCapReached = errors.New("[batas revisi kreator tercapai, silakan eskalasi booking]")
	// ErrPaymentBookingNotPassed: a Creator Payment Request is created only once the
	// Booking is [QC Passed] (§8 Rule 2).
	ErrPaymentBookingNotPassed = errors.New("[permintaan pembayaran hanya dapat dibuat setelah booking QC Passed]")
	// ErrPaymentDetailsRequired: creator payment details are mandatory (§10.4).
	ErrPaymentDetailsRequired = errors.New("[detail pembayaran kreator wajib diisi]")
	// ErrPaymentAmountMismatch: the request Amount must equal the Agreed Rate (§8 Rule 2 / §10.4).
	ErrPaymentAmountMismatch = errors.New("[jumlah pembayaran harus sama dengan Agreed Rate booking]")
	// ErrPaymentAlreadyRequested: an active (non-[Rejected]) request already exists.
	ErrPaymentAlreadyRequested = errors.New("[permintaan pembayaran untuk booking ini sudah ada]")
	// ErrPaymentRequestNotFound: no such Creator Payment Request.
	ErrPaymentRequestNotFound = errors.New("[permintaan pembayaran tidak ditemukan]")
	// ErrPaymentManageForbidden: actor may not create this Creator Payment Request
	// (the Booking's Coordinator or Director, request side of §8).
	ErrPaymentManageForbidden = errors.New("[anda tidak memiliki akses untuk membuat permintaan pembayaran booking ini]")
	// ErrFinanceForbidden: actor may not action this request (Finance staff/lead or
	// Director only — the executing side of §8).
	ErrFinanceForbidden = errors.New("[anda tidak memiliki akses untuk memproses permintaan pembayaran ini]")
	// ErrRejectionReasonRequired: a rejected payment request must carry a reason (§8 Rule 3).
	ErrRejectionReasonRequired = errors.New("[alasan penolakan wajib diisi]")
	// ErrCreatorListForbidden: actor may not generate/refresh this Brief's Creator
	// List (the Brief's KOL Coordinator/lead, owning AM, or Director; §6 Rule 2).
	ErrCreatorListForbidden = errors.New("[anda tidak memiliki akses untuk menyusun Creator List brief ini]")
	// ErrCreatorListLinkRequired: the Coordinator must supply the Drive document link.
	ErrCreatorListLinkRequired = errors.New("[link Creator List wajib diisi]")
	// ErrBadAmount: a money field could not be parsed (reused meaning from M8).
	ErrBadAmount = errors.New("[nilai uang tidak valid]")
	// ErrGMVBookingNotPassed: Attributed GMV (M9-OA-4) is a FEEDBACK signal on
	// confirmed, delivered content — recordable only once the Booking is [QC Passed].
	// PRD §10.3/§11 are silent on timing; [QC Passed] is chosen as the gate because it
	// is the point the deliverable is confirmed live & accepted (mirroring the CPR §8
	// Rule 2 gate) and it excludes [Dropped]/[Escalated]/unresolved bookings from ever
	// carrying an attributed figure. Interpretation logged for orchestrator sign-off.
	ErrGMVBookingNotPassed = errors.New("[GMV teratribusi hanya dapat dicatat setelah booking QC Passed]")
)

// AccountService is the one-way hook into module6_account: when the KOL Brief first
// leaves [To Do] via the Booking roll-up, its parent Service advances [Briefed] →
// [In Execution] in the caller's transaction (M6 §5 Flow 3). *module6_account.Service
// satisfies it — the same interface module12_task uses. Kept as an interface so this
// package does not hard-depend on module6_account's Service type (no import cycle).
type AccountService interface {
	OnBriefLeavesToDo(ctx context.Context, tx *sql.Tx, actor permission.Actor, serviceID string) error
}

// Service is the M9 persistence surface.
type Service struct {
	DB     *sql.DB
	Engine *statemachine.Engine
	// Account advances the parent Service when the KOL Brief first leaves [To Do]
	// (Booking roll-up, §2). Required for the first Booking to start; nil-guarded.
	Account AccountService
}

// engine returns the configured engine, or a fresh canonical one if unset (the
// config is stateless — same fallback as the sibling modules).
func (s *Service) engine() *statemachine.Engine {
	if s.Engine != nil {
		return s.Engine
	}
	return statemachine.New()
}
