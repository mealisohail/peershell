// Package modecontrol holds the single source of truth for the agent's
// session-permission mode (full | view-only). The mode can change at
// runtime when the user presses `v` between viewer sessions, so we
// expose a thread-safe Controller that listeners can subscribe to.
package modecontrol

import (
	"sync"
	"sync/atomic"
)

type Mode string

const (
	Full     Mode = "full"
	ViewOnly Mode = "view-only"
)

func (m Mode) String() string { return string(m) }

func (m Mode) Pretty() string {
	if m == ViewOnly {
		return "View only"
	}
	return "Full access"
}

// Controller is the per-process owner of the session mode. Safe for
// concurrent reads + writes; writes notify subscribed listeners.
type Controller struct {
	mu        sync.Mutex
	mode      atomic.Value // Mode
	locked    bool         // true while a viewer is connected
	listeners []func(Mode)
}

func New(initial Mode) *Controller {
	c := &Controller{}
	c.mode.Store(initial)
	return c
}

func (c *Controller) Current() Mode {
	v, ok := c.mode.Load().(Mode)
	if !ok {
		return Full
	}
	return v
}

// Toggle flips the mode between Full and ViewOnly. Returns the new mode
// plus a boolean indicating whether the change actually took effect
// (locked sessions reject the toggle).
func (c *Controller) Toggle() (Mode, bool) {
	c.mu.Lock()
	if c.locked {
		current := c.Current()
		c.mu.Unlock()
		return current, false
	}
	next := Full
	if c.Current() == Full {
		next = ViewOnly
	}
	c.mode.Store(next)
	listeners := append([]func(Mode){}, c.listeners...)
	c.mu.Unlock()
	for _, l := range listeners {
		l(next)
	}
	return next, true
}

// Lock marks the controller as in-session — Toggle becomes a no-op until
// the matching Unlock fires. Used to prevent mid-session mode flips per
// the brief: "When a viewer is connected, mode is locked for that session."
func (c *Controller) Lock() {
	c.mu.Lock()
	c.locked = true
	c.mu.Unlock()
}

func (c *Controller) Unlock() {
	c.mu.Lock()
	c.locked = false
	c.mu.Unlock()
}

func (c *Controller) IsLocked() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.locked
}

// OnChange registers a callback invoked synchronously every time the mode
// changes. Returns an unsubscribe function.
func (c *Controller) OnChange(fn func(Mode)) func() {
	c.mu.Lock()
	c.listeners = append(c.listeners, fn)
	idx := len(c.listeners) - 1
	c.mu.Unlock()
	return func() {
		c.mu.Lock()
		defer c.mu.Unlock()
		if idx < len(c.listeners) {
			c.listeners = append(c.listeners[:idx], c.listeners[idx+1:]...)
		}
	}
}
