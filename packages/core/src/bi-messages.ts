// Single source of Bahasa Indonesia validation/enforcement messages
// (CLAUDE.md #5, SUPABASE_MIGRATION_TECH_APPENDIX §G).
//
// House rule: validation/enforcement messages are Bahasa Indonesia in square
// brackets, using the EXACT strings from the PRDs/DECISIONS. To keep them from
// diverging (a BI string hardcoded twice can drift), every engine and route
// handler imports its strings from here — mirroring the Go pattern of package
// constants (`statemachine.DefaultBlockMessage`, etc.). Tests assert the exact
// string from this module, so there is one place to keep in sync with the PRD.
//
// This module starts with the strings the ported core engines use. Module ports
// (Fase 1+) extend it with their own PRD strings — always add here, never inline.

/** Default block message for an unlisted state-machine transition (statemachine.go). */
export const DefaultBlockMessage = "[transisi status tidak diizinkan]";

/** Role-restriction denial for a lead/SPV-only transition (statemachine.go). */
export const RoleDeniedMessage =
  "[anda tidak memiliki akses untuk melakukan transisi ini]";

/** Default mandatory-fields message (CLAUDE.md #5). */
export const MandatoryFieldsMessage =
  "[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]";

/** Sales allocation must sum to exactly 100% (M0/M4 allocation Σ=100%, §G). */
export const AllocationMustBe100 = "[total alokasi sales harus 100%]";
