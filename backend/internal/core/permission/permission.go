// Package permission holds the CDPS role model and the global permission
// matrix from PERMISSIONS.md.
//
// Universal pattern:
//   - Staff        = own data only
//   - Lead/SPV     = division-wide (own division)
//   - OD           = read-only everywhere + manages OKR (NEVER writes)
//   - Director     = full view + manage employees / role mappings / layered roles
//
// OD and Director are layered roles on top of a normal employee account.
package permission

// Level is the division seniority level from role_mappings.
const (
	LevelStaff = "staff"
	LevelLead  = "lead"
)

// CanonicalDivisions is the authoritative set of CDPS division names, in a
// stable order. These MUST match the constants the module permission gates
// compare against (e.g. module3_campaign.MarketingDivision = "Marketing",
// module10_livestream.LiveStreamDivision = "Live Stream") and the real seeded
// role_mappings — those comparisons are case-sensitive and space-sensitive, so
// any stored value that differs by case/spacing silently strips a division's
// permissions. Every division value written to role_mappings must be one of
// these exact strings.
var CanonicalDivisions = []string{
	"Marketing",
	"Sales",
	"Finance",
	"Account",
	"Creative",
	"Ads",
	"KOL",
	"Live Stream",
}

// divisionByKey maps a normalized key (lowercased, spaces and hyphens removed)
// to its canonical division string, so FE input like "marketing", "livestream",
// "live stream", "LIVE STREAM" or "kol" all resolve to the exact gate constant.
var divisionByKey = func() map[string]string {
	m := make(map[string]string, len(CanonicalDivisions))
	for _, d := range CanonicalDivisions {
		m[divisionKey(d)] = d
	}
	return m
}()

// divisionKey normalizes a division string for case/space-insensitive matching:
// lowercase, then drop spaces and hyphens.
func divisionKey(s string) string {
	var b []rune
	for _, r := range s {
		if r == ' ' || r == '-' {
			continue
		}
		if r >= 'A' && r <= 'Z' {
			r += 'a' - 'A'
		}
		b = append(b, r)
	}
	return string(b)
}

// NormalizeDivision maps an arbitrary division string to its canonical CDPS
// form, matching case-insensitively and ignoring spaces/hyphens. It returns the
// canonical value and true on success, or ("", false) for an unknown division.
func NormalizeDivision(s string) (string, bool) {
	c, ok := divisionByKey[divisionKey(s)]
	return c, ok
}

// Role is the resolved CDPS role for an authenticated employee.
type Role struct {
	Division string // CDPS division from role mapping (may be "" if unmapped)
	Level    string // staff | lead
	OD       bool   // layered read-only-everywhere role
	Director bool   // layered full-access role
}

// Actor is an authenticated employee plus resolved role, threaded through the
// engine and handlers.
type Actor struct {
	EmployeeID string
	Nama       string
	Email      string
	Divisi     string // raw HRIS division
	Jabatan    string // raw HRIS jabatan
	Role       Role
}

// IsLead reports whether the actor acts with lead/SPV authority in division.
// Directors carry lead authority everywhere. OD does NOT (read-only).
func (a Actor) IsLead(division string) bool {
	if a.Role.Director {
		return true
	}
	return a.Role.Level == LevelLead && a.Role.Division == division
}

// CanWrite reports whether the actor may perform write actions at all.
// OD is read-only; a pure-OD account (no division write scope) cannot write.
// Directors can always write. Staff/Lead write within their scope.
func (a Actor) CanWrite() bool {
	if a.Role.Director {
		return true
	}
	// A layered OD with an underlying division account still writes from the
	// division scope; only actions attempted "as OD" are read-only. Here we
	// simply require some division scope to exist.
	return a.Role.Division != ""
}

// CanManageAdmin reports whether the actor may manage employees, role mappings
// and layered roles. Director only.
func (a Actor) CanManageAdmin() bool {
	return a.Role.Director
}

// CanReadDivision reports read access to a division's data.
func (a Actor) CanReadDivision(division string) bool {
	if a.Role.Director || a.Role.OD {
		return true
	}
	if a.Role.Level == LevelLead && a.Role.Division == division {
		return true
	}
	return false
}

// CanReadAll reports cross-division read access (OD / Director).
func (a Actor) CanReadAll() bool {
	return a.Role.Director || a.Role.OD
}
