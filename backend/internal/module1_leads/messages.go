package leads

import (
	"fmt"

	"github.com/meagrup/agencyapp/backend/internal/core/msg"
)

// Bahasa Indonesia messages for Module 1 (CLAUDE.md convention #5 — byte-exact,
// never rephrased). The generic mandatory-field default lives in core/msg;
// M1-specific strings are transcribed here from the PRD sections noted.
const (
	// MsgDataTidakLengkapForm — single-form mandatory-field failure (Sales
	// registration §4 / Marketing single §3, Phase 0 default). Re-exported from
	// core/msg so callers of this package need not import both.
	MsgDataTidakLengkapForm = msg.DataTidakLengkap

	// MsgDataTidakLengkapBaris — bulk-import row missing mandatory data
	// (M1 §3 Flow step 4). Byte-exact.
	MsgDataTidakLengkapBaris = "[data tidak lengkap, baris tidak diimport]"

	// MsgLeadSudahAdaDiproses — bulk-import row is a duplicate of an existing
	// active/external lead (M1 §3 Flow step 5). Attribution attempt is logged
	// but not counted (M1-OA-6). Byte-exact.
	MsgLeadSudahAdaDiproses = "[lead sudah ada & sedang diproses, tidak diimport]"

	// MsgLeadSudahKlien — intake collides with a lead that already became a
	// client (§5 rule 4 row 4 / M1-OA-4). Byte-exact.
	MsgLeadSudahKlien = "[lead sudah menjadi klien]"

	// MsgCampaignTidakAktif — bulk-import gate: parent Campaign is not [Active]
	// (STATE_MACHINES §2 / WAVE1 W1-02). Byte-exact.
	MsgCampaignTidakAktif = "[campaign belum/tidak aktif, lead tidak bisa diimport]"
)

// msgScoutedDedup is the §5 deduplication-engine block message when an intake
// collides with another salesperson's ACTIVE scouted lead. The literal PRD
// template is `[lead sedang diproses oleh sales lain (nama)]`; "nama" is
// replaced by the real owner name (WAVE1 W1-01). Used as the canonical dedup
// engine output and for the Marketing single/import dedup context.
func msgScoutedDedup(ownerName string) string {
	return fmt.Sprintf("[lead sedang diproses oleh sales lain (%s)]", ownerName)
}

// msgScoutedRegistrationDoor is the M0 §3 Sales-registration-door variant of
// the same collision, literal template
// `[tidak bisa ditambahkan, lead sedang diproses oleh sales lain (nama sales)]`;
// "nama sales" is replaced by the real owner name. Both this and
// msgScoutedDedup exist in the PRD for different doors (see build report).
func msgScoutedRegistrationDoor(ownerName string) string {
	return fmt.Sprintf("[tidak bisa ditambahkan, lead sedang diproses oleh sales lain (%s)]", ownerName)
}
