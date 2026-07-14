package httpapi

import "net/http"

// registerTaskRoutes wires the Module 12 (Task Execution) HTTP routes — the
// division-side execution edges, PIC/SLA assignment, the §5.3a block-request
// queue and the recompute-from-log metrics, for BOTH task sources that exist
// today: the Brief-as-task (/tasks/{id}, single-unit divisions like Ads) and the
// Creative Asset (/assets/{id}, M7). The Asset ENTITY endpoints (create/review/
// hours) live in registerCreativeRoutes; here we only expose the shared M12 engine
// surface an Asset plugs into.
//
// Kept in its own registration file per the per-stream convention, so the Wave-1
// and Cluster-1 router blocks stay untouched.
func (a *App) registerTaskRoutes(mux *http.ServeMux) {
	// Brief-as-task execution edges (M12 §3). Claim model (DECISIONS W2-M12-C1 §4):
	// pre-PIC any target-division staff/lead; post-PIC only the PIC + division lead
	// + Director. [Blocked] is reached only through the request/approve queue.
	mux.HandleFunc("POST /api/v1/tasks/{id}/start", a.protect(a.handleStartTask))
	mux.HandleFunc("POST /api/v1/tasks/{id}/submit", a.protect(a.handleSubmitTask))
	mux.HandleFunc("POST /api/v1/tasks/{id}/rework", a.protect(a.handleReworkTask))
	mux.HandleFunc("POST /api/v1/tasks/{id}/resume", a.protect(a.handleResumeTask))
	// PIC assignment + SLA target (M12 §5.3): target-division Lead/SPV or Director.
	mux.HandleFunc("POST /api/v1/tasks/{id}/assign-pic", a.protect(a.handleAssignTaskPIC))
	mux.HandleFunc("POST /api/v1/tasks/{id}/sla", a.protect(a.handleSetTaskSLA))
	// Block-request queue (M12 §5.3a): staff/AM request, only SPV/Lead action it.
	mux.HandleFunc("POST /api/v1/tasks/{id}/block-request", a.protect(a.handleTaskBlockRequest))
	mux.HandleFunc("POST /api/v1/tasks/{id}/block-requests/{reqId}/approve", a.protect(a.handleApproveTaskBlock))
	mux.HandleFunc("POST /api/v1/tasks/{id}/block-requests/{reqId}/reject", a.protect(a.handleRejectTaskBlock))
	// Recompute-from-log metrics (M12 §5.1).
	mux.HandleFunc("GET /api/v1/tasks/{id}/metrics", a.protect(a.handleTaskMetrics))

	// Creative Asset execution edges (same shared M12 engine, Asset source).
	mux.HandleFunc("POST /api/v1/assets/{id}/start", a.protect(a.handleStartAsset))
	mux.HandleFunc("POST /api/v1/assets/{id}/submit", a.protect(a.handleSubmitAsset))
	mux.HandleFunc("POST /api/v1/assets/{id}/rework", a.protect(a.handleReworkAsset))
	mux.HandleFunc("POST /api/v1/assets/{id}/resume", a.protect(a.handleResumeAsset))
	mux.HandleFunc("POST /api/v1/assets/{id}/assign-pic", a.protect(a.handleAssignAssetPIC))
	mux.HandleFunc("POST /api/v1/assets/{id}/sla", a.protect(a.handleSetAssetSLA))
	mux.HandleFunc("POST /api/v1/assets/{id}/revision-sla", a.protect(a.handleSetAssetRevisionSLA))
	mux.HandleFunc("POST /api/v1/assets/{id}/block-request", a.protect(a.handleAssetBlockRequest))
	mux.HandleFunc("POST /api/v1/assets/{id}/block-requests/{reqId}/approve", a.protect(a.handleApproveAssetBlock))
	mux.HandleFunc("POST /api/v1/assets/{id}/block-requests/{reqId}/reject", a.protect(a.handleRejectAssetBlock))
	mux.HandleFunc("GET /api/v1/assets/{id}/metrics", a.protect(a.handleAssetMetrics))
}
