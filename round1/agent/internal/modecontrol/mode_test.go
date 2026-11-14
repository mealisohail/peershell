package modecontrol

import (
	"testing"
)

func TestNewStartsAtInitial(t *testing.T) {
	c := New(Full)
	if c.Current() != Full {
		t.Fatalf("Current = %s, want full", c.Current())
	}
}

func TestTogglesBetweenModes(t *testing.T) {
	c := New(Full)
	next, ok := c.Toggle()
	if !ok || next != ViewOnly {
		t.Fatalf("Toggle: ok=%v next=%s, want true view-only", ok, next)
	}
	next, ok = c.Toggle()
	if !ok || next != Full {
		t.Fatalf("Toggle: ok=%v next=%s, want true full", ok, next)
	}
}

func TestToggleBlockedWhenLocked(t *testing.T) {
	c := New(Full)
	c.Lock()
	next, ok := c.Toggle()
	if ok {
		t.Fatalf("Toggle returned ok=true while locked")
	}
	if next != Full {
		t.Fatalf("locked Toggle changed mode to %s", next)
	}
	c.Unlock()
	if _, ok := c.Toggle(); !ok {
		t.Fatalf("Toggle after Unlock returned ok=false")
	}
}

func TestOnChangeFiresOnToggle(t *testing.T) {
	c := New(Full)
	seen := []Mode{}
	c.OnChange(func(m Mode) { seen = append(seen, m) })
	c.Toggle()
	c.Toggle()
	if len(seen) != 2 || seen[0] != ViewOnly || seen[1] != Full {
		t.Fatalf("listener calls: %v", seen)
	}
}

func TestOnChangeUnsubscribe(t *testing.T) {
	c := New(Full)
	calls := 0
	unsub := c.OnChange(func(Mode) { calls++ })
	c.Toggle()
	unsub()
	c.Toggle()
	if calls != 1 {
		t.Fatalf("calls = %d, want 1 after unsubscribe", calls)
	}
}

func TestPrettyAndString(t *testing.T) {
	if Full.Pretty() != "Full access" {
		t.Fatalf("Full.Pretty()=%q", Full.Pretty())
	}
	if ViewOnly.Pretty() != "View only" {
		t.Fatalf("ViewOnly.Pretty()=%q", ViewOnly.Pretty())
	}
	if Full.String() != "full" {
		t.Fatalf("Full.String()=%q", Full.String())
	}
}
