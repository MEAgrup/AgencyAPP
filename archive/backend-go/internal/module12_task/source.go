// This file generalises the Task Execution engine from the single hard-coded
// `briefs` table to a parametric "task source" (ticket W2-M7-C1). "Task" is a
// ROLE, not an entity (DATA_MODEL §1): today two row types play it —
//
//   - sourceBrief : the Brief itself, for single-unit divisions like Ads
//     (BRF-as-task, M12 §5.3b). Its parent for the [In Execution] hook is the
//     Service; it has no submit-link requirement.
//   - sourceAsset : a Creative Asset (AST-, M7). Its parent is a Brief, whose
//     status is a roll-up of its Assets (M7 §2); submission requires an output
//     link (§4 Rule 3).
//
// M9's Creator Booking (BKG-) becomes a third source by registering one more
// `taskSource` value and its thin wrappers — the transition, permission, block
// and metric machinery below is shared, never duplicated.
//
// The canonical state machine (STATE_MACHINES §7, statemachine.MBriefTask) is the
// SAME for every source — an Asset is NOT a different lifecycle, only a different
// row the same lifecycle is stored on.
package module12_task

// taskSource describes one registered canonical-Task row type. It carries only
// storage/shape differences; the lifecycle (MBriefTask) and all gates are shared.
type taskSource struct {
	entityType string // audit entity_type + notification entity type ("brief"|"asset")
	table      string // storage table the status column lives on ("briefs"|"assets")
	// submitLinkCol, when non-empty, is a column that MUST be non-empty before the
	// row may enter [Submitted] (Asset output link, §4 Rule 3). Empty => no gate.
	submitLinkCol string
	// errLinkRequired is returned when submitLinkCol is set but the supplied link
	// is blank. Nil for sources without a link gate.
	errLinkRequired error
	// blockTable / blockFKCol / blockIDPrefix back the §5.3a pending block-request
	// queue for this source (brief_block_requests vs asset_block_requests).
	blockTable    string
	blockFKCol    string
	blockIDPrefix string
}

var (
	// sourceBrief: the Brief-as-task (Ads / single-unit). Parent = Service.
	sourceBrief = taskSource{
		entityType:    "brief",
		table:         "briefs",
		blockTable:    "brief_block_requests",
		blockFKCol:    "brief_id",
		blockIDPrefix: "BBR",
	}
	// sourceAsset: a Creative Asset (M7). Parent = Brief (roll-up, M7 §2); submit
	// requires an output link (§4 Rule 3).
	sourceAsset = taskSource{
		entityType:      "asset",
		table:           "assets",
		submitLinkCol:   "output_link",
		errLinkRequired: ErrOutputLinkRequired,
		blockTable:      "asset_block_requests",
		blockFKCol:      "asset_id",
		blockIDPrefix:   "ABR",
	}
)
