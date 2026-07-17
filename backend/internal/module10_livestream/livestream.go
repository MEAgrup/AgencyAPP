// Package module10_livestream is Module 10 (Live Stream). It introduces the Live
// Stream Session (LSS-), MEA's record of what the AM REQUESTED from the outsourced
// sister-company vendor and what the vendor actually DELIVERED (M10 §2). Unlike the
// other execution modules (Creative/Ads/KOL) this is a TRACKER, not an execution
// system: MEA does not run the stream, so a Session has no internal "work-in-progress"
// Kanban — its lifecycle only records request → vendor confirmation → result →
// reconciliation.
//
// Why Live Stream is different (M10 §1/§2): the broadcast is run by a vendor with NO
// CDPS access. So the module records the request/result pair on one row and the AM
// (not an internal PIC) owns the whole thing: create the request, log the
// vendor-reported result, reconcile requested-vs-actual, flag a discrepancy. The
// vendor is represented entirely through AM-entered data (§6.1).
//
// Parent = a Live Stream Brief (M6 §6 Rule 2). That Brief is OFF-MACHINE: it is born
// [Dispatched to Vendor] and skips the canonical brief_task machine entirely
// (STATE_MACHINES §7; DECISIONS W2-M6-C3). A single Brief holds MANY Sessions across a
// recurring package's life (M10-OA-4). When every Session of a Brief reaches
// [Reconciled] the Brief closes to [Approved] via an audited off-machine UPDATE
// (action ls_brief_reconciled — the same off-machine precedent as void_cascade_offmachine,
// NOT the engine, since the Brief is not on the machine).
//
// House rules honoured here:
//   - the LSS- id is minted (ident.Next) ONLY after mandatory-field validation passes
//     (house rule 1); the birth status [Requested] is set at INSERT (a creation, not a
//     transition — same precedent as Asset/Booking/ADC), every later status move goes
//     through the transition engine, never a raw UPDATE (house rule 2);
//   - GMV / Data Confidence Tier are read-only vendor-reported facts; money renders
//     "Rp. X.XXX.XXX,00" (house rule 7); vendor-reported GMV counts at FULL value —
//     never numerically discounted, only badged (M10-OA-5).
package module10_livestream

import (
	"database/sql"
	"errors"

	"github.com/meagrup/agencyapp/backend/internal/core/permission"
	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
)

// CDPS divisions this module reasons about.
const (
	// LiveStreamDivision is the outsourced-vendor division whose Briefs are born
	// off-machine [Dispatched to Vendor] (M6 §6 Rule 2). It mirrors
	// module6_account.DivisionLiveStream, duplicated locally to keep the dependency
	// direction one-way (no import of module6 for a constant).
	LiveStreamDivision = "Live Stream"
	// AccountDivision is the client-owning division; its lead (SPV/Head Account) has
	// division-wide read visibility on all Sessions and owns the vendor-relationship
	// follow-up on a discrepancy (§6.1 / M10-OA-3).
	AccountDivision = "Account"
)

// Live Stream Session statuses — the live_stream_session machine (STATE_MACHINES §10).
const (
	LssRequested   = "[Requested]"
	LssConfirmed   = "[Confirmed by Vendor]"
	LssCompleted   = "[Completed]"
	LssReconciled  = "[Reconciled]" // terminal
	LssDiscrepancy = "[Discrepancy Flagged]"
)

// Off-machine Brief statuses this module observes (mirrors module6_account /
// module4_client constants; duplicated locally for a one-way dependency).
const (
	// BriefVendorDispatched is the LS Brief's off-machine birth status (§6 Rule 2).
	BriefVendorDispatched = "[Dispatched to Vendor]"
	// BriefApproved is where the LS Brief closes once all its Sessions reconcile.
	BriefApproved = "[Approved]"
	// BriefVoided is the void-cascade terminal (M4-OA-5); a voided Brief accepts no
	// new Sessions and never rolls up.
	BriefVoided = "[Cancelled — Service Voided]"
)

// Platform enum (§6.3): the two live-commerce platforms the vendor streams on.
const (
	PlatformTikTok = "TikTok Shop Live"
	PlatformShopee = "Shopee Live"
)

var validPlatforms = map[string]bool{PlatformTikTok: true, PlatformShopee: true}

// DataConfidenceVendorReported is the default (and only) confidence tier for a Live
// Stream Session's numbers (§5 Rule 2 / M10-OA-5): the GMV is self-reported by the
// vendor, so it is BADGED Vendor-Reported — but it still counts at full value toward
// the client's GMV signal, never numerically discounted against Platform-Verified
// sources (DATA_MODEL §3).
const DataConfidenceVendorReported = "Vendor-Reported"

// Sentinel errors carrying the exact Bahasa Indonesia message (house rule 5). The PRD
// quotes none of these verbatim, so — following the W1-09 / M9 precedent — they are
// listed in the cluster report for orchestrator sign-off. Strings that already exist
// in a sibling module for the same meaning are REUSED verbatim (noted inline).
var (
	// ErrIncomplete: a mandatory field is missing (house-convention default; reused).
	ErrIncomplete = errors.New("[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]")
	// ErrBriefNotFound: the parent Brief does not exist (reused from M6/M7/M8/M9).
	ErrBriefNotFound = errors.New("[brief tidak ditemukan]")
	// ErrNotLiveStreamBrief: the Brief is not a Live Stream Brief (analogue of M9's
	// [brief ini bukan brief divisi KOL]).
	ErrNotLiveStreamBrief = errors.New("[brief ini bukan brief divisi Live Stream]")
	// ErrBriefNotOpenForSession: the Brief is not accepting new Sessions (already
	// [Approved]); analogue of M9's [booking tidak dapat dibuat untuk brief pada status ini].
	ErrBriefNotOpenForSession = errors.New("[sesi tidak dapat dibuat untuk brief pada status ini]")
	// ErrBriefVoided: the parent Brief has been cancelled via the void cascade — it
	// accepts no new Sessions and its Sessions are frozen (scope: void interaction).
	ErrBriefVoided = errors.New("[brief untuk sesi ini telah dibatalkan]")
	// ErrInvalidPlatform: Platform is outside the §6.3 enum.
	ErrInvalidPlatform = errors.New("[platform tidak valid]")
	// ErrInvalidDuration: a duration (target/actual) must be a positive number of hours.
	ErrInvalidDuration = errors.New("[durasi harus lebih dari 0 jam]")
	// ErrBadDatetime: a datetime field could not be parsed.
	ErrBadDatetime = errors.New("[format tanggal/waktu tidak valid]")
	// ErrSessionNotFound: the referenced Session does not exist.
	ErrSessionNotFound = errors.New("[sesi tidak ditemukan]")
	// ErrSessionViewForbidden: actor may not read this Session (§6.1 read gate).
	ErrSessionViewForbidden = errors.New("[anda tidak memiliki akses ke sesi ini]")
	// ErrSessionManageForbidden: actor may not create/log/reconcile/flag this Session
	// (owning AM + Director only, §6.1 / precedent W1-13).
	ErrSessionManageForbidden = errors.New("[anda tidak memiliki akses untuk mengelola sesi live stream ini]")
	// ErrVendorReportLinkRequired: a Vendor Report Link is mandatory before [Completed]
	// (§6.3 — the audit-trail proof of the vendor's reported numbers).
	ErrVendorReportLinkRequired = errors.New("[link laporan vendor wajib diisi sebelum sesi selesai]")
	// ErrReconNotesRequired: Reconciliation Notes are mandatory on [Discrepancy Flagged]
	// (§4 Rule 3 / §6.3).
	ErrReconNotesRequired = errors.New("[catatan rekonsiliasi wajib diisi]")
	// ErrBadAmount: a money field could not be parsed (reused meaning from M8/M9).
	ErrBadAmount = errors.New("[nilai uang tidak valid]")
	// ErrBriefReopenForbidden: actor may not reopen this Brief (owning AM + Director
	// only, DECISIONS O27 / W2-M10-C2 — reopen gate same as create/manage Session).
	ErrBriefReopenForbidden = errors.New("[anda tidak memiliki akses untuk membuka kembali brief ini]")
	// ErrBriefNotReopenable: the Brief's current status does not permit reopening
	// (only [Approved] can be reopened, DECISIONS O27 / W2-M10-C2).
	ErrBriefNotReopenable = errors.New("[brief tidak dapat dibuka kembali pada status ini]")
)

// Service is the M10 persistence surface. It owns the Live Stream Session entity end
// to end and, on reconciliation, rolls the parent (off-machine) Brief up to [Approved].
type Service struct {
	DB     *sql.DB
	Engine *statemachine.Engine
}

// engine returns the configured engine, or a fresh canonical one if unset (the config
// is stateless — same fallback as the sibling modules).
func (s *Service) engine() *statemachine.Engine {
	if s.Engine != nil {
		return s.Engine
	}
	return statemachine.New()
}

// canManageSession is the §6.1 write gate for create/results/reconcile/flag: the
// owning AM (the client's Account Manager) or Director (precedent W1-13 — owner OR
// Director). Account lead/SPV, OD and other divisions cannot WRITE (Account lead has
// read visibility + the off-system vendor follow-up, but the in-system record is the
// owning AM's; §6.1).
func canManageSession(a permission.Actor, ownerAM string) bool {
	return a.Role.Director || (ownerAM != "" && a.EmployeeID == ownerAM)
}

// canSeeSession is the §6.1 read gate: OD/Director everywhere; Account lead/SPV
// (division-wide, incl. all discrepancies); and the owning AM. No execution-division
// staff and no vendor (the vendor has no CDPS role at all).
func canSeeSession(a permission.Actor, ownerAM string) bool {
	if a.CanReadAll() { // OD / Director
		return true
	}
	if a.IsLead(AccountDivision) { // Account lead / SPV (division-wide)
		return true
	}
	return ownerAM != "" && a.EmployeeID == ownerAM
}
