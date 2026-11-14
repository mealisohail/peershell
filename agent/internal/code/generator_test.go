package code

import (
	"regexp"
	"testing"
)

var sixDigit = regexp.MustCompile(`^[0-9]{6}$`)

func TestGenerateMatchesSixDigitPattern(t *testing.T) {
	c, err := Generate()
	if err != nil {
		t.Fatalf("Generate: %v", err)
	}
	if !sixDigit.MatchString(c) {
		t.Fatalf("expected 6-digit numeric string, got %q", c)
	}
}

func TestGenerateAlwaysSixCharactersIncludingLeadingZeros(t *testing.T) {
	// Run enough iterations that we are highly likely to hit values like
	// 000123 — if the implementation forgot to pad, this will catch it.
	for i := 0; i < 5000; i++ {
		c, err := Generate()
		if err != nil {
			t.Fatalf("Generate iter %d: %v", i, err)
		}
		if len(c) != 6 {
			t.Fatalf("iter %d: expected length 6, got %d (%q)", i, len(c), c)
		}
	}
}

func TestGenerateProducesVariedOutput(t *testing.T) {
	// 1024 draws from a 1,000,000-space; collisions possible but uniqueness
	// >50% is a safe floor for "actually random, not constant".
	seen := make(map[string]struct{}, 1024)
	for i := 0; i < 1024; i++ {
		c, err := Generate()
		if err != nil {
			t.Fatalf("Generate: %v", err)
		}
		seen[c] = struct{}{}
	}
	if len(seen) < 512 {
		t.Fatalf("too few unique codes: %d out of 1024 — generator likely not random", len(seen))
	}
}

func TestFormatGroupsThreeAndThree(t *testing.T) {
	got := Format("483291")
	want := "483-291"
	if got != want {
		t.Fatalf("Format(\"483291\") = %q, want %q", got, want)
	}
}

func TestFormatPreservesLeadingZeros(t *testing.T) {
	got := Format("000123")
	want := "000-123"
	if got != want {
		t.Fatalf("Format(\"000123\") = %q, want %q", got, want)
	}
}
