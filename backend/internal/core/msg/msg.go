// Package msg centralises the exact Bahasa Indonesia validation/blocking
// messages specified by the PRDs (CLAUDE.md convention #5). Never rephrase
// or translate these strings; add new ones only with a PRD reference.
package msg

const (
	// Default mandatory-field validation failure (Phase 0).
	DataTidakLengkap = "[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]"
	// Default blocked state transition (docs/STATE_MACHINES.md).
	TransisiTidakDiizinkan = "[transisi status tidak diizinkan]"
	// HRIS unreachable at login (docs/HRIS API CONTRACT.md §3).
	HRISTidakDapatDihubungi = "[sistem HRIS tidak dapat dihubungi, coba beberapa saat lagi]"
	// Termin installment schedule does not sum to the transaction's agreed
	// total value (docs/prd/HRIS Module5 Admin Finance.md §4 flow rule 1:
	// "must sum to agreed total — system validates with ..."). W1-09 Closing
	// enforces this at submission for the Termin payment scheme.
	TotalTerminTidakSama = "[total termin tidak sama dengan nilai transaksi]"
)
