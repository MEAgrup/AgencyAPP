// Package demo implements the Sprint 0 demo path (S0-12): a demo_tasks entity
// (prefix DEMO-) running on the canonical brief_task state machine, plus the
// staff-submits / SPV-approves block-request flow that exercises the notif
// catalog and the SPV/Lead-only [Blocked] transition.
package demo

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/meagrup/agencyapp/backend/internal/core/audit"
	"github.com/meagrup/agencyapp/backend/internal/core/ident"
	"github.com/meagrup/agencyapp/backend/internal/core/notification"
	"github.com/meagrup/agencyapp/backend/internal/core/permission"
	"github.com/meagrup/agencyapp/backend/internal/core/statemachine"
)

// IncompleteMessage is the exact BI message for a failed mandatory-field gate.
const IncompleteMessage = "[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]"

// InitialStatus is the brief_task machine's initial state.
const InitialStatus = "[To Do]"

// Sentinel errors.
var (
	ErrIncomplete    = errors.New(IncompleteMessage)
	ErrNotFound      = errors.New("demo task not found")
	ErrRequestClosed = errors.New("block request already resolved")
	ErrForbidden     = errors.New(statemachine.RoleDeniedMessage)
)

// Task is a demo task row.
type Task struct {
	ID          string    `json:"id"`
	Title       string    `json:"title"`
	Description string    `json:"description"`
	Division    string    `json:"division"`
	Status      string    `json:"status"`
	CreatedBy   string    `json:"created_by"`
	CreatedAt   time.Time `json:"created_at"`
}

// BlockRequest is a pending/resolved block request.
type BlockRequest struct {
	ID          string     `json:"id"`
	TaskID      string     `json:"task_id"`
	Reason      string     `json:"reason"`
	Status      string     `json:"status"`
	RequestedBy string     `json:"requested_by"`
	ResolvedBy  *string    `json:"resolved_by"`
	ResolvedAt  *time.Time `json:"resolved_at"`
	CreatedAt   time.Time  `json:"created_at"`
}

// Service bundles the dependencies the demo handlers need.
type Service struct {
	DB      *sql.DB
	Engine  *statemachine.Engine
	Catalog *notification.Catalog
}

// Create validates mandatory fields, then (only after validation passes)
// allocates a DEMO- id and inserts the task in [To Do]. Division is the actor's
// CDPS division (falling back to raw HRIS divisi).
func (s *Service) Create(ctx context.Context, actor permission.Actor, title, description string) (Task, error) {
	if title == "" {
		return Task{}, ErrIncomplete
	}
	division := actor.Role.Division
	if division == "" {
		division = actor.Divisi
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return Task{}, err
	}
	defer tx.Rollback()

	id, err := ident.Next(ctx, tx, "DEMO", time.Now())
	if err != nil {
		return Task{}, err
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO demo_tasks (id, title, description, division, status, created_by) VALUES (?, ?, ?, ?, ?, ?)`,
		id, title, description, division, InitialStatus, actor.EmployeeID); err != nil {
		return Task{}, err
	}
	if err := audit.Write(ctx, tx, audit.Record{
		EntityType: "demo_task", EntityID: id, Actor: actor.EmployeeID,
		Action: "create", After: map[string]any{"status": InitialStatus, "title": title},
	}); err != nil {
		return Task{}, err
	}
	if err := tx.Commit(); err != nil {
		return Task{}, err
	}
	return Task{ID: id, Title: title, Description: description, Division: division, Status: InitialStatus, CreatedBy: actor.EmployeeID, CreatedAt: time.Now()}, nil
}

// Get returns a task with its allowed transitions and full audit trail.
func (s *Service) Get(ctx context.Context, id string) (Task, []string, []audit.Entry, error) {
	t, err := s.load(ctx, id)
	if err != nil {
		return Task{}, nil, nil, err
	}
	m, _ := s.Engine.Machine(statemachine.MBriefTask)
	allowed := m.AllowedFrom(t.Status)
	if allowed == nil {
		allowed = []string{}
	}
	entries, err := audit.List(ctx, s.DB, audit.Filter{EntityType: "demo_task", EntityID: id})
	if err != nil {
		return Task{}, nil, nil, err
	}
	return t, allowed, entries, nil
}

// List returns all demo tasks, newest first.
func (s *Service) List(ctx context.Context) ([]Task, error) {
	rows, err := s.DB.QueryContext(ctx,
		`SELECT id, title, description, division, status, created_by, created_at FROM demo_tasks ORDER BY id DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Task{}
	for rows.Next() {
		var t Task
		var desc sql.NullString
		if err := rows.Scan(&t.ID, &t.Title, &desc, &t.Division, &t.Status, &t.CreatedBy, &t.CreatedAt); err != nil {
			return nil, err
		}
		t.Description = desc.String
		out = append(out, t)
	}
	return out, rows.Err()
}

func (s *Service) load(ctx context.Context, id string) (Task, error) {
	var t Task
	var desc sql.NullString
	err := s.DB.QueryRowContext(ctx,
		`SELECT id, title, description, division, status, created_by, created_at FROM demo_tasks WHERE id = ?`, id).
		Scan(&t.ID, &t.Title, &desc, &t.Division, &t.Status, &t.CreatedBy, &t.CreatedAt)
	if err == sql.ErrNoRows {
		return t, ErrNotFound
	}
	if err != nil {
		return t, err
	}
	t.Description = desc.String
	return t, nil
}

// Transition drives the brief_task machine for a demo task. Role-restricted
// edges (e.g. [Blocked]) are enforced by the engine.
func (s *Service) Transition(ctx context.Context, actor permission.Actor, id, to string) (statemachine.Result, error) {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return statemachine.Result{}, err
	}
	defer tx.Rollback()
	res, err := s.Engine.Transition(ctx, tx, statemachine.Request{
		Machine:    statemachine.MBriefTask,
		EntityType: "demo_task",
		Table:      "demo_tasks",
		EntityID:   id,
		To:         to,
		Actor:      actor,
	})
	if err != nil {
		return statemachine.Result{}, err
	}
	if err := tx.Commit(); err != nil {
		return statemachine.Result{}, err
	}
	return res, nil
}

// SubmitBlockRequest lets a staff/AM submit a block request (they cannot set
// [Blocked] themselves). It creates a pending request and notifies the division
// leads (M12 catalog: block request submitted).
func (s *Service) SubmitBlockRequest(ctx context.Context, actor permission.Actor, taskID, reason string) (BlockRequest, error) {
	if reason == "" {
		return BlockRequest{}, ErrIncomplete
	}
	t, err := s.load(ctx, taskID)
	if err != nil {
		return BlockRequest{}, err
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return BlockRequest{}, err
	}
	defer tx.Rollback()

	reqID, err := ident.Next(ctx, tx, "DBR", time.Now())
	if err != nil {
		return BlockRequest{}, err
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO demo_task_block_requests (id, task_id, reason, status, requested_by, created_by)
		 VALUES (?, ?, ?, 'pending', ?, ?)`,
		reqID, taskID, reason, actor.EmployeeID, actor.EmployeeID); err != nil {
		return BlockRequest{}, err
	}
	if err := audit.Write(ctx, tx, audit.Record{
		EntityType: "demo_task", EntityID: taskID, Actor: actor.EmployeeID,
		Action: "block_request_submitted", After: map[string]any{"request_id": reqID, "reason": reason},
	}); err != nil {
		return BlockRequest{}, err
	}
	if _, err := s.Catalog.Emit(ctx, tx, notification.Emission{
		Event: notification.EvBlockRequestSubmitted, EntityType: "demo_task", EntityID: taskID,
		Actor: actor.EmployeeID, Division: t.Division, DeepLink: "/demo-tasks/" + taskID,
	}); err != nil {
		return BlockRequest{}, err
	}
	if err := tx.Commit(); err != nil {
		return BlockRequest{}, err
	}
	return BlockRequest{ID: reqID, TaskID: taskID, Reason: reason, Status: "pending", RequestedBy: actor.EmployeeID, CreatedAt: time.Now()}, nil
}

// ApproveBlockRequest lets a division lead (or Director) approve a pending block
// request: it marks the request approved, drives the task into [Blocked] via the
// engine (SPV/Lead-only edge), and notifies the requester (M12: block decided).
func (s *Service) ApproveBlockRequest(ctx context.Context, actor permission.Actor, taskID, reqID string) error {
	t, err := s.load(ctx, taskID)
	if err != nil {
		return err
	}
	if !actor.IsLead(t.Division) {
		return ErrForbidden
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// Lock + validate the request is still pending.
	var status, requestedBy string
	err = tx.QueryRowContext(ctx,
		`SELECT status, requested_by FROM demo_task_block_requests WHERE id = ? AND task_id = ? FOR UPDATE`,
		reqID, taskID).Scan(&status, &requestedBy)
	if err == sql.ErrNoRows {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if status != "pending" {
		return ErrRequestClosed
	}

	// Drive the SPV/Lead-only [Blocked] transition.
	if _, err := s.Engine.Transition(ctx, tx, statemachine.Request{
		Machine:    statemachine.MBriefTask,
		EntityType: "demo_task",
		Table:      "demo_tasks",
		EntityID:   taskID,
		To:         "[Blocked]",
		Actor:      actor,
	}); err != nil {
		return err
	}

	if _, err := tx.ExecContext(ctx,
		`UPDATE demo_task_block_requests SET status='approved', resolved_by=?, resolved_at=NOW() WHERE id=?`,
		actor.EmployeeID, reqID); err != nil {
		return err
	}
	if err := audit.Write(ctx, tx, audit.Record{
		EntityType: "demo_task", EntityID: taskID, Actor: actor.EmployeeID,
		Action: "block_request_approved", After: map[string]any{"request_id": reqID},
	}); err != nil {
		return err
	}
	if _, err := s.Catalog.Emit(ctx, tx, notification.Emission{
		Event: notification.EvBlockRequestDecided, EntityType: "demo_task", EntityID: taskID,
		Actor: actor.EmployeeID, ExplicitRecipients: []string{requestedBy}, DeepLink: "/demo-tasks/" + taskID,
	}); err != nil {
		return err
	}
	return tx.Commit()
}
