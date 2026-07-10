// Package events is the in-process event bus: state transitions and entity
// changes publish events; notification fan-out and derived-field recompute
// subscribe. v1 is synchronous and in-memory (modular monolith).
package events

import (
	"context"
	"sync"
	"time"
)

type Event struct {
	Name       string // catalog name, Phase 0 v2 §9
	EntityType string
	EntityID   string
	Actor      string
	At         time.Time
	Payload    map[string]any
}

type Handler func(ctx context.Context, e Event)

type Bus interface {
	Publish(ctx context.Context, e Event)
	// Subscribe registers a handler for an event name; "*" receives all.
	Subscribe(name string, h Handler)
}

type InMemoryBus struct {
	mu       sync.RWMutex
	handlers map[string][]Handler
}

func NewInMemoryBus() *InMemoryBus {
	return &InMemoryBus{handlers: map[string][]Handler{}}
}

func (b *InMemoryBus) Subscribe(name string, h Handler) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.handlers[name] = append(b.handlers[name], h)
}

func (b *InMemoryBus) Publish(ctx context.Context, e Event) {
	b.mu.RLock()
	hs := append(append([]Handler{}, b.handlers[e.Name]...), b.handlers["*"]...)
	b.mu.RUnlock()
	for _, h := range hs {
		h(ctx, e)
	}
}
